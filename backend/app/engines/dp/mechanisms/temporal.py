"""datetime 欄位的加噪機制：日期抖動（date jittering）。

原理：日期骨子裡是「量」（時間軸上的點），故轉成數值後復用數值機制——
    解析日期 → 對齊到指定單位 → 轉成該單位的序數（自 epoch 起算）
    → 離散型 Laplace/Gaussian 加噪 → 轉回日期
＝日期挪動 ±N 個單位，保住順序與遠近，輸出永遠是合法日期。

序數以 noise_unit 為刻度，本身就是整數；要更粗的刻度（如「以 5 分鐘為一格」）由
`noise_step` 指定幾個 noise_unit 算一格，換算與數值欄的 minimum_unit 同一套
（加噪前除、加噪後乘回），欄位名分開只是為了避免兩種型別的參數混填。
加噪機制為離散型，整數進整數出，加噪後不需再取整。

加噪後可再以 `time_clipping_bounds`（日期字串的上下界）與 `time_out_of_bounds_strategy`
（clamp／wrap／fold）把飄太遠的日期收回合理範圍——屬後處理，不影響隱私保證。
界線換算成序數後才比較，故三種策略的算術與數值欄完全一致；但界線本身不見得落在
noise_step 的格子上，clamp 到界線時會停在界線那一點（依定義如此，不對齊回格子）。

規則：
- 雜訊單位由設定檔的 `noise_unit` 指定（day／hour／minute／second，未給即 day）；
  **sensitivity 的單位跟著它走**——同樣申報 30，day 是 30 天、second 是 30 秒。
- 輸入寬鬆解析（pd.to_datetime，能讀就收）。
- δ=0 → 離散型 Laplace、δ>0 → 離散型 Gaussian（由 NumericNoiser 內部分派）。
- sensitivity 使用者申報優先；未申報則以序數的 max−min 推導（復用 SensitivityResolver），
  實際採用值隨結果一併回傳供報告揭露。
  ★ 自動推導與 noise_unit 無關痛癢：換單位時資料值與 sensitivity 同步放大，
  雜訊在真實時間上的幅度不變（跨數十年的欄位不申報就是偏移數十年）。
  noise_unit 改變的是對齊與輸出的精細度，不是擾動的幅度。

比單位更細的部分於加噪前捨棄（day 捨時分秒、hour 捨分秒、minute 捨秒）。
先對齊是必要的——否則序數帶小數，換算整數時會把後半個單位的資料推到下一個單位，
即使雜訊為零也會產生偏移。捨棄一事隨結果回報 pipeline 於報告告知。

輸出格式：日期部分沿用輸入（分隔符號與年月日的排列順序取自該欄第一筆非空原值），
時間部分依 noise_unit 決定要印到哪一位。整欄取一筆即可——BudgetValidator 已用
pd.to_datetime 掃過整欄，同欄混用兩種寫法會被擋在門外，故第一筆足以代表整欄。

空值（NaN/NaT）維持空值。加噪後若超出 pandas 可表示的時間範圍（極端 ε 過小），
該格以空值輸出（errors="coerce"），不中斷整欄。
"""

import re
from typing import NamedTuple

import pandas as pd

from ..discretize import apply_bounds, from_units, to_units
from ..sensitivity import SensitivityResolver
from .numeric import NumericNoiser

_EPOCH = pd.Timestamp("1970-01-01")
_ISO_DATE = "%Y-%m-%d"
_DIGITS = re.compile(r"\d+")



def _naive_utc(value):
    """★ TTC 2026-11-02：帶時區的日期（如 2024-03-15T10:00:00Z）先換算成 UTC 並去掉時區。

    運算基準點 _EPOCH 不帶時區，帶時區的值直接相減會 TypeError（API 回 500）。
    """
    if isinstance(value, pd.Series):
        return value.dt.tz_convert(None) if getattr(value.dt, "tz", None) is not None else value
    if getattr(value, "tzinfo", None) is not None:
        return value.tz_convert(None)
    return value

class _Unit(NamedTuple):
    """一個 noise_unit 在各處要用的對應值（集中一處，免得四個地方各寫一份對照）。"""

    floor_freq: str  # pandas 對齊用的頻率字串
    span: pd.Timedelta  # 一個單位有多長（換算序數用）
    origin_unit: str  # pd.to_datetime(unit=...) 的單位代碼
    time_format: str  # 輸出的時間部分（空字串＝只印日期）
    dropped_label: str  # 被捨棄的部分叫什麼（報告用語）


UNITS = {
    "day": _Unit("D", pd.Timedelta(days=1), "D", "", "時分秒"),
    "hour": _Unit("h", pd.Timedelta(hours=1), "h", "%H:%M", "分秒"),
    "minute": _Unit("min", pd.Timedelta(minutes=1), "m", "%H:%M", "秒"),
    "second": _Unit("s", pd.Timedelta(seconds=1), "s", "%H:%M:%S", "毫秒以下的部分"),
}
DEFAULT_UNIT = "day"
# 未指定 noise_step 時的刻度：1 個 noise_unit。
DEFAULT_NOISE_STEP = 1


def detect_output_format(sample: object, parsed: pd.Timestamp, time_format: str) -> str:
    """從一筆原始日期字串推出輸出用的 strftime 格式（日期部分沿用輸入的寫法）。

    以解析結果回頭比對每一段數字是年、是月還是日——如此 `15/03/1999` 與
    `03/15/1999` 都能還原成各自的排列，不必猜也不會把兩者混為一談
    （日在前或月在前由 pandas 解析時決定，這裡只是照它的判讀還原）。

    比對不出來（段數不足、數字對不上）一律退回 ISO，寧可格式變動也不輸出錯的日期。
    時間部分不沿用輸入，由 noise_unit 決定印到哪一位——輸入有幾位跟輸出該有幾位
    是兩回事（輸入到秒但以小時加噪，印出秒只是假精度）。
    """
    date_format = _ISO_DATE
    date_time_sep = " "

    if isinstance(sample, str) and not pd.isna(parsed):
        runs = list(_DIGITS.finditer(sample))
        detected = _detect_date_format(sample, parsed, runs)
        if detected is not None:
            date_format = detected
            # 日期與時間之間的分隔符（`2024-03-15T14:30` 的 T）沿用輸入；
            # 只在日期恰為三段、其後還有數字時才有這個位置。
            if len(runs) >= 4:
                sep = sample[runs[2].end() : runs[3].start()]
                if len(sep) == 1 and sep != "%":
                    date_time_sep = sep

    if not time_format:
        return date_format
    return f"{date_format}{date_time_sep}{time_format}"


def _detect_date_format(sample: str, parsed: pd.Timestamp, runs: list) -> str | None:
    """推日期部分的格式；推不出來回 None（由呼叫端退回 ISO）。"""
    # 無分隔的緊排寫法（19990315）：整串就是一段八位數字
    if len(runs) == 1 and len(runs[0].group()) == 8:
        return "%Y%m%d"
    if len(runs) < 3:
        return None

    codes: list[str] = []
    for run in runs[:3]:
        text = run.group()
        value = int(text)
        if len(text) == 4 and value == parsed.year:
            codes.append("%Y")
        elif value == parsed.month and "%m" not in codes:
            codes.append("%m")
        elif value == parsed.day and "%d" not in codes:
            codes.append("%d")
        # 兩位數年（88/03/15）：沿用兩位數輸出，維持該欄原本的寬度
        elif len(text) == 2 and value == parsed.year % 100 and "%y" not in codes:
            codes.append("%y")
        else:
            return None
    if len(set(codes)) != 3:
        return None

    separators = [
        sample[runs[0].end() : runs[1].start()],
        sample[runs[1].end() : runs[2].start()],
    ]
    # 分隔符號本身含 % 會被 strftime 當成指示字元，這種資料退回 ISO
    if any("%" in sep for sep in separators):
        return None
    return f"{codes[0]}{separators[0]}{codes[1]}{separators[1]}{codes[2]}"


class DatetimeResult(NamedTuple):
    """日期加噪的結果：除了資料本身，還帶三件只有機制內部才算得出的報告素材。

    sensitivity 須待轉成序數才能決議（單位隨 noise_unit＋noise_step）；
    比單位更細的部分是否存在、刻度是否粗到整欄壓成同一格，也都要看過原始資料才知道。
    三者隨結果交回 pipeline 記入報告與逐欄明細（報告透明）。
    """

    series: pd.Series
    sensitivity: int
    dropped: str | None
    coarse_step: bool


class DatetimeNoiser:
    """對日期 Series 做「對齊單位→轉序數→數值加噪→轉回日期」的日期抖動。"""

    def __init__(
        self,
        numeric_noiser: NumericNoiser,
        sensitivity_resolver: SensitivityResolver,
    ):
        # 復用現成工人：加噪數學與 sensitivity 決議都不重寫。
        # 兩者由 DPProcessorFactory 傳入（與 DPProcessor 共用同一組實例），此處不自備預設。
        self._numeric = numeric_noiser
        self._sensitivity = sensitivity_resolver

    def apply(
        self,
        series: pd.Series,
        epsilon: float,
        delta: float,
        declared_sensitivity: float | None,
        noise_unit: str | None = None,
        noise_step: int | None = None,
        time_clipping_bounds: tuple[str, str] | None = None,
        time_out_of_bounds_strategy: str | None = None,
    ) -> DatetimeResult:
        unit = UNITS[noise_unit or DEFAULT_UNIT]
        step = noise_step or DEFAULT_NOISE_STEP

        # ① 寬鬆解析（可解析性已由 BudgetValidator 前置把關；此處 coerce 僅兜底）
        parsed = _naive_utc(pd.to_datetime(series, errors="coerce"))

        # ② 取該欄第一筆解析成功的值，推出輸出格式（原值與解析結果同一列）
        valid = parsed.notna()
        if valid.any():
            first = parsed.index[valid][0]
            out_format = detect_output_format(series[first], parsed[first], unit.time_format)
        else:
            out_format = detect_output_format(None, pd.NaT, unit.time_format)

        # ③ 對齊到指定單位後才換算序數，比單位更細的部分不參與加噪
        #    （不先對齊則序數帶小數，to_units 會把後半個單位的資料推到下一個單位）
        aligned = parsed.dt.floor(unit.floor_freq)
        dropped = unit.dropped_label if (valid & (parsed != aligned)).any() else None
        ordinals = (aligned - _EPOCH) / unit.span
        # 每 noise_step 個 noise_unit 算一格（step=1 時序數本來就是整數，換算是恆等的）
        values = to_units(ordinals, step)
        # 刻度粗到整欄只剩一格 → 加噪結果無意義，交回 pipeline 於報告提醒（能跑，故不擋）
        coarse_step = bool(values.dropna().nunique() <= 1 < ordinals.dropna().nunique())

        # ④ sensitivity 決議（申報值單位＝noise_unit，除以 step 換成格數）
        #    ＋復用數值機制加噪（NaN 自動跳過）
        sensitivity = self._sensitivity.resolve(values, declared_sensitivity, step)
        noised = self._numeric.apply(values, epsilon, delta, sensitivity)

        # ⑤ 乘回序數後做超界後處理（界線同樣換算成序數，算術與數值欄一致）
        out_ordinals = apply_bounds(
            from_units(noised, step),
            self._bounds_to_ordinals(time_clipping_bounds, unit),
            time_out_of_bounds_strategy,
        )

        # ⑥ 轉回日期，依偵測到的格式輸出；NaN 維持空值
        #    （離散機制整數進整數出，不必再取整）
        out_dt = pd.to_datetime(
            out_ordinals, unit=unit.origin_unit, origin="unix", errors="coerce"
        )
        return DatetimeResult(
            out_dt.dt.strftime(out_format), sensitivity, dropped, coarse_step
        )

    @staticmethod
    def _bounds_to_ordinals(
        bounds: tuple[str, str] | None, unit: _Unit
    ) -> tuple[float, float] | None:
        """日期字串的上下界 → 該 noise_unit 的序數（可解析性已由設定檔驗證時把關）。"""
        if bounds is None:
            return None
        low, high = (_naive_utc(pd.to_datetime(raw)) for raw in bounds)
        return (
            (low - _EPOCH) / unit.span,
            (high - _EPOCH) / unit.span,
        )
