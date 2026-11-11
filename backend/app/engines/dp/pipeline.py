"""差分隱私主流程（Pipeline）。

DPProcessor 串起「記帳 → 逐欄加噪 → 產出預算報告」，每一步委派給注入的
工人（accountant / sensitivity resolver / 各機制）。

參數分工比照 K-匿名 Anonymizer：逐欄設定走 config（設定檔），全域旋鈕
（累計／default_delta）走建構參數，工人保持無狀態、呼叫時把值傳進去。

處理流程：
    Step 0 → 前置驗證：自我檢查、欄名存在、宣告型別與資料相符（fail fast）
    Step 1 → 記帳：申報加總＋併入自帶累計
    Step 2 → 逐欄加噪：依使用者宣告的 type 分派機制
             （continuous→整數化後離散型 Laplace/Gaussian；categorical→k-RR；
               datetime→日期抖動±N 個 noise_unit）
    Step 3 → 產出 BudgetReport（本次消耗＋累計＋逐欄明細＝使用者下次自帶的收據）
"""

import math

import pandas as pd

from app.core.cancellation import check_cancelled
from app.core.config import DPColumnConfig

from .types import BudgetReport, ColumnBudgetDetail, effective_delta
from .validation import BudgetValidator
from .accountant import BudgetAccountant
from .sensitivity import SensitivityResolver
from .discretize import (
    DEFAULT_MINIMUM_UNIT,
    apply_bounds,
    from_units,
    match_unit_precision,
    to_units,
)
from .mechanisms import NumericNoiser, KRandomizedResponse, DatetimeNoiser
from .mechanisms.temporal import DEFAULT_NOISE_STEP, DEFAULT_UNIT


def _format_delta(delta: float) -> str:
    """δ 一律以 1e-5 這種科學記號呈現：δ 通常極小，寫成小數會被捨成 0.00。"""
    if delta == 0:
        return "0"
    mantissa, exponent = f"{delta:e}".split("e")
    return f"{mantissa.rstrip('0').rstrip('.')}e{int(exponent)}"


class DPProcessor:
    """差分隱私處理器（無狀態：不留存任何預算帳；帳本由呼叫方自帶）。

    參數說明：
        config              : 逐欄預算設定（來自設定檔）
        accumulated_epsilon : 呼叫方自帶的已累計 ε（無狀態設計：引擎不記帳）
        accumulated_delta   : 呼叫方自帶的已累計 δ
        default_delta       : 全域（相同）δ，只補「沒設 δ 的 continuous/datetime 欄」
    """

    def __init__(
        self,
        config: DPColumnConfig,
        accumulated_epsilon: float = 0.0,
        accumulated_delta: float = 0.0,
        default_delta: float | None = None,
        *,
        # ── 注入的協作者（工人）：一律由 DPProcessorFactory 組好傳入，此處不自備預設 ──
        validator: BudgetValidator,                 # 前置驗證（欄名/型別相符/值域）
        accountant: BudgetAccountant,               # 記帳
        sensitivity_resolver: SensitivityResolver,  # 敏感度決議（僅連續型別使用）
        numeric_noiser: NumericNoiser,              # 數值加噪（Laplace/Gaussian）
        krr: KRandomizedResponse,                   # 類別加噪（k-元隨機回應，含 Binary）
        datetime_noiser: DatetimeNoiser,            # 日期加噪（對齊 noise_unit→轉序數→數值加噪→轉回）
    ):
        self.config = config
        self.accumulated_epsilon = accumulated_epsilon
        self.accumulated_delta = accumulated_delta
        self.default_delta = default_delta

        # 依賴注入：工人由 DPProcessorFactory 建立並傳入，本類別不決定要用哪個實作
        self._validator = validator
        self._accountant = accountant
        self._sensitivity = sensitivity_resolver
        self._numeric = numeric_noiser
        self._krr = krr
        self._temporal = datetime_noiser

    def run(self, df: pd.DataFrame) -> tuple[pd.DataFrame, BudgetReport]:
        config = self.config
        default_delta = self.default_delta

        # ── Step 0：前置驗證（fail fast）：自我檢查、欄名存在、宣告型別與資料相符 ──
        # 放在最前面 → 資料層對不上直接擋，避免後續虛報消耗或加噪時底層拋不友善的錯。
        self._validator.validate(df, config, default_delta)

        # ── Step 1：記帳（申報即消耗，與資料內容無關）──────────────────────
        req_eps, req_del, total_eps, total_del = self._accountant.account(
            config,
            default_delta=default_delta,
            accumulated_epsilon=self.accumulated_epsilon,
            accumulated_delta=self.accumulated_delta,
        )

        df_out = df.copy()

        # ── Step 2：逐欄套用 DP 雜訊（依使用者宣告的 type 分派）──────────────
        # type 為必填（core.config.ColumnBudget 已驗證合法值），此處純照宣告分派、不以 dtype 猜測。
        # 欄位存在性已於 Step 0 驗證，此處不需再檢查跳過。
        # 邊加噪邊收集逐欄明細：機制、實際用的 sensitivity 及其來源，供報告透明呈現。
        per_column = []
        # 日期欄若帶有比 noise_unit 更細的部分，該部分於加噪前捨棄，於報告告知。
        # 依「被捨棄的是什麼」分組，同一種說法的欄位併成一句。
        datetime_dropped: dict[str, list[str]] = {}
        # 最小單位比資料本身還粗的欄位：能跑，但整欄會被壓成同一個刻度，於報告提醒。
        coarse_unit: list[str] = []
        for col, budget in config.column_budgets.items():
            check_cancelled()  # ★ TTC 2026-10-31
            # δ 取「實際生效值」：欄位自設（含明確 0）> 全域 default_delta > 0；
            # categorical 恆 0。與記帳（accountant）同一真相來源。
            delta = effective_delta(budget, default_delta)
            if budget.type == "continuous":
                # 離散型 DP：換算成整數個最小單位 → 加噪 → 乘回原單位 → 後處理超界值。
                minimum_unit = budget.minimum_unit or DEFAULT_MINIMUM_UNIT
                units = to_units(df_out[col], minimum_unit)
                # ★ TTC 2026-11-02：加噪前先夾到 clipping_bounds 內。原本只在加噪後才處理超界，
                #   遠超出範圍的極端值（如 980 萬）加完 ±sensitivity 的雜訊仍明顯超界，事後被夾到上界，
                #   等於確定性地洩漏「這筆是極端值」，ε 的保證不成立。
                if budget.clipping_bounds is not None:
                    low, high = budget.clipping_bounds
                    units = units.clip(
                        lower=math.ceil(low / minimum_unit), upper=math.floor(high / minimum_unit)
                    )
                # 刻度粗到整欄只剩一個值（資料 1、2、3 而刻度填 10）→ 加噪結果無意義，提醒。
                if units.dropna().nunique() <= 1 < df_out[col].dropna().nunique():
                    coarse_unit.append(col)
                # sensitivity 使用者申報優先，缺席才自動推導；單位一律是「整數個最小單位」
                sensitivity = self._sensitivity.resolve(
                    units, budget.sensitivity, minimum_unit
                )
                noised = self._numeric.apply(
                    units, budget.epsilon_budget, delta, sensitivity
                )
                df_out[col] = match_unit_precision(
                    apply_bounds(
                        from_units(noised, minimum_unit),
                        budget.clipping_bounds,
                        budget.out_of_bounds_strategy,
                    ),
                    minimum_unit,
                )
                per_column.append(
                    ColumnBudgetDetail(
                        column=col,
                        type=budget.type,
                        # 機制由生效 δ 隱含決定（與 NumericNoiser 內部分派一致）
                        mechanism="DiscreteGaussian" if delta > 0 else "DiscreteLaplace",
                        epsilon=budget.epsilon_budget,
                        delta=delta,
                        sensitivity=sensitivity,
                        # 使用者有申報→user；否則系統以 max−min 推導→system（須揭露）
                        sensitivity_source="user" if budget.sensitivity is not None else "system",
                        # 揭露刻度：sensitivity 以它為單位；有設界線才有超界處理可言
                        minimum_unit=minimum_unit,
                        out_of_bounds_strategy=(
                            (budget.out_of_bounds_strategy or "clamp")
                            if budget.clipping_bounds is not None
                            else None
                        ),
                    )
                )
            elif budget.type == "categorical":
                # 類別翻面（k-RR，含 k=2 的 Binary）；不需 delta/sensitivity
                df_out[col] = self._krr.apply(df_out[col], budget.epsilon_budget)
                per_column.append(
                    ColumnBudgetDetail(
                        column=col,
                        type=budget.type,
                        mechanism="k-RR",
                        epsilon=budget.epsilon_budget,
                        delta=delta,  # 恆 0（純 ε 機制；全域 δ 不派發給 categorical）
                        sensitivity=None,  # 純 ε 機制無 sensitivity
                        sensitivity_source=None,
                    )
                )
            else:  # datetime
                # 日期抖動：對齊 noise_unit→轉該單位的序數→復用數值加噪→轉回日期。
                # sensitivity（單位隨 noise_unit）與「更細的部分被捨棄」都於機制內部
                # 才算得出，隨結果交回供報告揭露。
                noise_unit = budget.noise_unit or DEFAULT_UNIT
                noise_step = budget.noise_step or DEFAULT_NOISE_STEP
                result = self._temporal.apply(
                    df_out[col],
                    budget.epsilon_budget,
                    delta,
                    budget.sensitivity,
                    noise_unit,
                    noise_step,
                    budget.time_clipping_bounds,
                    budget.time_out_of_bounds_strategy,
                )
                df_out[col] = result.series
                sensitivity = result.sensitivity
                if result.dropped:
                    datetime_dropped.setdefault(result.dropped, []).append(col)
                if result.coarse_step:
                    coarse_unit.append(col)
                per_column.append(
                    ColumnBudgetDetail(
                        column=col,
                        type=budget.type,
                        mechanism="DiscreteGaussian" if delta > 0 else "DiscreteLaplace",
                        epsilon=budget.epsilon_budget,
                        delta=delta,
                        sensitivity=sensitivity,
                        sensitivity_source="user" if budget.sensitivity is not None else "system",
                        # 揭露加噪單位與刻度：sensitivity 以「格」為單位，
                        # 一格＝noise_step 個 noise_unit，三者須一起看才讀得懂
                        noise_unit=noise_unit,
                        noise_step=noise_step,
                        out_of_bounds_strategy=(
                            (budget.time_out_of_bounds_strategy or "clamp")
                            if budget.time_clipping_bounds is not None
                            else None
                        ),
                    )
                )

        # ── Step 3：產出預算報告 ─────────────────────────────────────────────
        warnings = []
        if any(budget.epsilon_budget < 0.01 for budget in config.column_budgets.values()):
            warnings.append(
                "當前隱私預算（Epsilon）設定過低，雖然隱私強度極高，但產出之數值可能出現嚴重失真現象。"
            )

        # 報告透明：sensitivity 未申報而由系統推導的欄位，於摘要主動告知（明細見 per_column）。
        system_derived = [d.column for d in per_column if d.sensitivity_source == "system"]
        if system_derived:
            warnings.append(
                f"欄位 {system_derived} 未提供 sensitivity，系統已以資料實際 max-min 自動推導"
                f"（此值來自資料極值、本身具參考性風險，建議由使用者據實申報；詳見逐欄明細）。"
            )

        # 報告透明：刻度粗到整欄壓成同一個值＝加噪結果失去意義，須主動告知（能跑，故不擋）。
        if coarse_unit:
            warnings.append(
                f"欄位 {coarse_unit} 的刻度（continuous 看 minimum_unit、datetime 看 noise_step）"
                f"比資料本身的差距還粗，換算後整欄只剩單一刻度，加噪結果不具參考價值，請調小刻度。"
            )

        # 報告透明：捨棄比加噪單位更細的部分等於系統改了資料精度，須逐一告知。
        for label, cols in datetime_dropped.items():
            warnings.append(
                f"欄位 {cols} 的日期含{label}，加噪單位比它粗，"
                f"{label}已於處理時捨棄，輸出不含該部分。"
            )

        if warnings:
            msg = "處理成功。" + " ".join(warnings)
        else:
            msg = f"成功套用差分隱私雜訊。本次消耗 ε={req_eps:.2f}, δ={_format_delta(req_del)}。"

        return df_out, BudgetReport(
            consumed_epsilon=req_eps,
            consumed_delta=req_del,
            accumulated_epsilon=total_eps,
            accumulated_delta=total_del,
            message=msg,
            per_column=per_column,
        )
