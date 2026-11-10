"""泛化策略（依欄位型別）。

各 Generalizer 類別封裝「對一整欄泛化」的邏輯，並回傳
(新 Series 或 None, 警示碼或 None)。warning="no_matrix" 代表類別欄未宣告階層、
"no_levels" 代表日期欄未宣告粒度階梯，兩者皆表示泛化未生效、由呼叫端寫進報告提醒。
數值欄「未指定 bins/rounding」不另設警示碼：呼叫端在進泛化前就自行判斷並提醒，
故此處回 None 即可。
類別/字串的逐格運算保留為 module 函式（categorical_mapping_generalize / string_length_grade），
由對應 Generalizer 內部呼叫；數值與日期則整欄向量化處理。
"""
from abc import ABC, abstractmethod
from typing import Any

import numpy as np
import pandas as pd

from app.core.config import (
    TEMPORAL_TIME_LEVELS,
    ColumnConfig,
    parse_categorical_mapping,
    parse_numeric_bins,
    parse_rounding_unit,
    parse_temporal_levels,
    parse_time_periods,
)
from app.core.values import canonical_text

from .masking import apply_masking

# 區間之間的空隙用的哨兵標籤：落入空隙者與落在所有區間之外者同樣視為未涵蓋。
_BIN_GAP = "\x00gap"


def categorical_mapping_generalize(val: Any, mapping: dict[str, list[str]], level: int) -> str:
    """
    類別型欄位依自訂階層泛化。
    mapping 格式：{原始值: [原始值, level1泛化, level2泛化, ...]}
    找不到對應值時回傳 "*"（視為全域類別）
    """
    # 空值沒有值可泛化 → 保持空值（不無中生有變成 "*"）。
    # 注意：這裡只保留「原本就空」的情況；「有值但不在階層裡」仍回 "*"（見下方 return）。
    if val is None or pd.isna(val):
        return val
    ladder = mapping.get(canonical_text(val).strip())  # ★ TTC 2026-11-02：100.0 與 "100" 視為同值
    if ladder is None:
        return "*"
    return ladder[min(level, len(ladder) - 1)]


def apply_numeric_bins(
    series: pd.Series, bins: list[tuple[float, float, str]]
) -> pd.Series:
    """依使用者自訂區間切箱（整欄向量化），輸出各段的 label。

    區間語意為 [下界, 上界)：含下界、不含上界。空值維持空值；有值但未落入任何區間
    （超出範圍、落在段與段的空隙、非數值）一律輸出 "*"，不回填原值以免洩漏未泛化的值。
    """
    edges: list[float] = [bins[0][0]]
    labels: list[str] = []
    for lo, hi, label in bins:
        if lo > edges[-1]:
            # 與前一段之間的空隙：補一段哨兵，使邊界維持遞增（pd.cut 的前提）
            edges.append(lo)
            labels.append(_BIN_GAP)
        edges.append(hi)
        labels.append(label)

    numeric = pd.to_numeric(series, errors="coerce")
    # ordered=False：允許使用者對不同段用相同 label（例如把頭尾都叫「其他」）
    cut = pd.cut(numeric, bins=edges, labels=labels, right=False, ordered=False)
    out = cut.astype(object)
    out[out == _BIN_GAP] = "*"
    out[series.notna() & out.isna()] = "*"
    return out


# 各粒度的輸出格式。欄位本身帶日期者印到該粒度為止；只有時間的欄位（levels 全為
# 時／分／秒）則只印時間部分，否則解析時補上的當日日期會憑空出現在輸出裡。
_LEVEL_FORMATS = {
    "second": "%Y-%m-%d %H:%M:%S",
    "minute": "%Y-%m-%d %H:%M",
    "hour": "%Y-%m-%d %H",
    "day": "%Y-%m-%d",
    "month": "%Y-%m",
    "year": "%Y",
}

_TIME_ONLY_FORMATS = {
    "second": "%H:%M:%S",
    "minute": "%H:%M",
    "hour": "%H",
}


def apply_time_periods(
    parsed: pd.Series, bins: list[tuple[float, float, str]], keep_date: bool
) -> pd.Series:
    """把每筆時間換成時段標籤；keep_date 為真時保留日期部分（如 "2016-10-23 下午"）。

    比對的是當日的第幾秒，故 06:30 這類非整點界線同樣判得出來。
    空值維持空值；未落入任何區間者沿用區間切法的慣例輸出 "*"。
    """
    seconds = parsed.dt.hour * 3600 + parsed.dt.minute * 60 + parsed.dt.second
    labels = apply_numeric_bins(seconds, bins)
    if not keep_date:
        return labels
    prefixes = parsed.dt.strftime("%Y-%m-%d ")
    out = [
        np.nan if pd.isna(prefix) or pd.isna(label) else f"{prefix}{label}"
        for prefix, label in zip(prefixes, labels)
    ]
    return pd.Series(out, index=parsed.index)


def apply_rounding(series: pd.Series, unit: float) -> pd.Series:
    """四捨五入至 unit 的倍數（標準四捨五入，非 Python round 的銀行家捨入）。

    輸出仍為數字；空值與無法轉成有限數字的值（含無限大）一律輸出空值（同樣不回填原值）。
    """
    numeric = pd.to_numeric(series, errors="coerce")
    numeric = numeric.where(np.isfinite(numeric))
    rounded = np.floor(numeric / unit + 0.5) * unit
    if float(unit).is_integer():
        # rounding 為整數時輸出整數，避免匯出 CSV 時平白多出小數點
        return rounded.astype("Int64")
    return rounded


def string_length_grade(val: Any, bin_size: int = 5) -> str:
    """
    字串「以字元長度分級」：隱藏內容，只保留長度級距標籤，如 "0-4"、"5-9"。
    bin_size 為每個長度級距的寬度，預設 5。
    """
    if val is None or pd.isna(val):
        return ""
    length = len(str(val))
    low = (length // bin_size) * bin_size
    return f"{low}-{low + bin_size - 1}"


class Generalizer(ABC):
    """泛化策略基底：對一整欄依 level 泛化。"""

    @abstractmethod
    def generalize(
        self, series: pd.Series, col: str, level: int, config: ColumnConfig
    ) -> tuple[pd.Series | None, str | None]:  # pragma: no cover - 介面
        ...


class NumericalGeneralizer(Generalizer):
    """數值：依設定檔的 bins（自訂區間）或 rounding（四捨五入到該數的倍數）泛化。

    兩者由使用者擇一明確指定，系統不提供預設切法；都沒給即回 (None, None) 表示不泛化
    （該情境的報告提醒由呼叫端自行分流，見模組 docstring）。
    level 對數值欄不適用——切法已由使用者寫死，無層級可選。
    """

    def generalize(self, series, col, level, config):
        spec = (config.generalization_hierarchies or {}).get(col)
        if not isinstance(spec, dict):
            return None, None
        if "bins" in spec:
            return apply_numeric_bins(series, parse_numeric_bins(col, spec["bins"])), None
        if "rounding" in spec:
            return apply_rounding(series, parse_rounding_unit(col, spec["rounding"])), None
        return None, None


class DatetimeGeneralizer(Generalizer):
    """日期時間：依設定檔的 levels 決定粒度，泛化＝輸出到層級所指的粒度為止。

    輸入須為 pandas 解析得動的西元格式（整欄可解析於進引擎前即檢查），輸出為該粒度的
    標準寫法（如 1993-05）；因為解析後才輸出，欄位原本寫成什麼順序都不影響結果。
    未指定 levels 即回 warning="no_levels" 表示不泛化（由呼叫端提醒）。
    若該欄附了 time_periods，且本次泛化到時／分／秒，則把時間換成時段標籤
    （如「下午」）；泛化到日以上者本次不生效，由呼叫端於報告提醒
    （此處只做，不判斷該不該提醒）。
    """

    def generalize(self, series, col, level, config):
        spec = (config.generalization_hierarchies or {}).get(col)
        if not isinstance(spec, dict) or "levels" not in spec:
            return None, "no_levels"
        levels = parse_temporal_levels(col, spec["levels"])
        # 層級 1＝levels 第一項、層級 2＝第二項，依此類推（層級 0 代表不泛化、由呼叫端
        # 攔下，正常不會走到這裡；直呼引擎者若給 0 一律以最細的一級處理，不回退成原值）。
        # 層級超過宣告的粒度數時取最粗的一級（不會泛化成空值）。
        granularity = levels[min(max(level, 1), len(levels)) - 1]
        parsed = pd.to_datetime(series, errors="coerce")
        # 整欄只宣告時／分／秒＝這一欄本來就沒有日期，輸出不該冒出解析時補的當日日期
        time_only = all(lv in TEMPORAL_TIME_LEVELS for lv in levels)
        if spec.get("time_periods") and granularity in TEMPORAL_TIME_LEVELS:
            table = parse_time_periods(col, spec["time_periods"])
            return apply_time_periods(parsed, table, keep_date=not time_only), None
        formats = _TIME_ONLY_FORMATS if time_only else _LEVEL_FORMATS
        return parsed.dt.strftime(formats[granularity]), None


class CategoricalGeneralizer(Generalizer):
    """類別：依自訂階層泛化；未宣告階層時回傳 warning='no_matrix'（不靜默略過）。"""

    def generalize(self, series, col, level, config):
        if config.generalization_matrices and col in config.generalization_matrices:
            mapping = parse_categorical_mapping(col, config.generalization_matrices[col])
            new = series.apply(
                lambda x, m=mapping, lv=level: categorical_mapping_generalize(x, m, lv)
            )
            return new, None
        return None, "no_matrix"


class StringGeneralizer(Generalizer):
    """字串：mask_mode=length 用字元長度分級，否則用前綴/後綴保留。"""

    def generalize(self, series, col, level, config):
        mode = config.columns[col].mask_mode or "prefix"
        mc = config.columns[col].mask_char or "*"
        if mode == "length":
            # 長度級距寬度：bin_size（預設 5）× level，level 越大級距越粗
            hier = (config.generalization_hierarchies or {}).get(col, {})
            base = int(hier.get("bin_size", 5)) if isinstance(hier, dict) else 5
            width = max(base * level, 1)
            new = series.apply(lambda x, w=width: string_length_grade(x, w))
        else:
            # 保留字元數隨 level 遞減（level1 留4字、level2 留3字…，至少留1字）
            new = series.apply(
                lambda x, lv=level, m=mode, c=mc: apply_masking(
                    x, strategy="partial", keep_chars=max(5 - lv, 1), mode=m, mask_char=c
                )
            )
        return new, None
