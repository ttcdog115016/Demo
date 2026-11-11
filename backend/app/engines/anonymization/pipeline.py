"""K-匿名化主流程（Pipeline）。

Anonymizer 串起前置驗證與 Step1~5，每一步委派給對應的策略 / 檢測 / 抑制 class；
本模組只負責串接流程與彙整品質報告，各步驟的演算法都不寫在這裡。
"""

import math
import pandas as pd

from app.core.config import (
    TEMPORAL_TIME_LEVELS,
    ColumnConfig,
    parse_categorical_mapping,
    parse_level_value,
    parse_temporal_levels,
)
from app.core.cancellation import check_cancelled
from app.core.errors import PetsError
from .types import QualityReport, SuppressionOutcome
from .validation import ConfigValidator, validate_choice_param, validate_percent_param
from .strategies.masking import HashMask
from .metrics import KAnonymity, LDiversity, TCloseness, wildcard_group_sizes


def _validate_k_l_t(k, l, t) -> None:  # noqa: E741
    """★ TTC 2026-11-02：k／l／t 原本未驗證：k≤0 會跳過抑制卻回報成功，t 為 NaN 時每個比較皆為假而全數通過。"""
    if isinstance(k, bool) or not isinstance(k, int) or k < 1:
        raise PetsError("ERR_INVALID_PARAM", f"k 必須是大於或等於 1 的整數（收到 {k!r}）。")
    if l is not None and (isinstance(l, bool) or not isinstance(l, int) or l < 1):
        raise PetsError("ERR_INVALID_PARAM", f"l 必須是大於或等於 1 的整數（收到 {l!r}）。")
    if t is not None and not (isinstance(t, (int, float)) and math.isfinite(t) and 0 <= t <= 1):
        raise PetsError("ERR_INVALID_PARAM", f"t 必須介於 0 與 1 之間（收到 {t!r}）。")


class Anonymizer:
    """
    K-匿名化處理器。

    參數說明：
        k                      : 等價類最小列數門檻
        l                      : 敏感欄位多樣性門檻（選填）
        t                      : 敏感分佈距離門檻（選填）
        suppression_limit_percent : 允許的最大抑制率，以百分比表示（0~100），預設 20
        limit_exceeded_action  : 超出抑制上限時的行為，"stop_and_error" 拋錯 /
                                 "allow_with_warning" 僅警示
        salt_key               : 雜湊用的鹽值（選填；未給即對值本身做雜湊）
        suppression_method     : 抑制方式，"row_suppression" 列抑制 / "cell_suppression" 值抑制
        cell_fill              : 值抑制挖掉的格子填什麼，"star" 填 * / "missing" 填空值
                                 （僅 suppression_method="cell_suppression" 時生效）
        （泛化層級一律取自 config.qi_generalization_levels，不另設參數）

    處理流程：
        Step 1 → 依欄位策略套用遮蔽 / 雜湊
        Step 2 → 識別欄位：預設假名化（雜湊），明確 remove 才移除
        Step 3 → QI 欄位依泛化層級降階
        Step 4 → K-匿名抑制（列抑制或值抑制）
        Step 5 → l-diversity / t-closeness 檢測（僅回報達標與否與建議，不修改資料）
    """

    def __init__(
        self,
        config: ColumnConfig,
        k: int = 5,
        l: int | None = None,  # noqa: E741
        t: float | None = None,
        suppression_limit_percent: float = 20,
        limit_exceeded_action: str = "stop_and_error",
        salt_key: str | None = None,
        suppression_method: str = "row_suppression",
        cell_fill: str = "star",
        k_qi_subset: list | None = None,
        *,
        # ── 注入的協作者（工人）：一律由 AnonymizerFactory 組好傳入，此處不自備預設 ──
        validator: ConfigValidator,  # 前置驗證器
        generalizers: dict,          # 型別 → Generalizer 對應表
        suppressors: dict,           # 抑制方式 → Suppressor 建構函式 對應表
        masker_builders: dict,       # 遮蔽策略 → Mask 建構函式 對應表
        k_metric: KAnonymity,        # KAnonymity 檢測器
        l_metric: LDiversity,        # LDiversity 檢測器
        t_metric: TCloseness,        # TCloseness 檢測器
    ):
        _validate_k_l_t(k, l, t)
        self.config = config
        self.k = k
        self.l = l
        self.t = t
        # 抑制上限以百分比表示（20＝20%）。超出 0~100 者於建構時即擋——純參數即可判定，
        # 不留到跑完資料才發現（負數無意義；大於 100 等於「永遠不會超限」，多半是單位寫錯）。
        self.suppression_limit_percent = validate_percent_param(
            "suppression_limit_percent", suppression_limit_percent
        )
        # 單選字串參數在建構時即驗證（fail fast）：寬容大小寫、非法值拋錯列出合法選項，
        # 不靜默退回預設（打錯 "celll" 卻默默跑列抑制，使用者拿到的不是他要的東西）
        self.limit_exceeded_action = validate_choice_param(
            "limit_exceeded_action",
            limit_exceeded_action,
            ("stop_and_error", "allow_with_warning"),
        )
        self.salt_key = salt_key
        self.suppression_method = validate_choice_param(
            "suppression_method", suppression_method, ("row_suppression", "cell_suppression")
        )
        # 填充方式一律驗證（即使本次走列抑制），打錯值不因當下用不到就被放行——
        # 使用者選了 cell 卻打錯 fill 時才報錯，不如一次講清楚
        self.cell_fill = validate_choice_param("cell_fill", cell_fill, ("star", "missing"))
        self.k_qi_subset = k_qi_subset

        # 依賴注入：工人由 AnonymizerFactory 建立並傳入，本類別不決定要用哪個實作
        self._validator = validator
        self._generalizers = generalizers
        self._suppressors = suppressors
        self._masker_builders = masker_builders
        self._k_metric = k_metric
        self._l_metric = l_metric
        self._t_metric = t_metric

    def _violation_rate_at(self, base_df, config, levels, qi_cols, k_qi_cols, k):
        """在指定泛化層級下，計算「落單列（所屬等價類 < k）」佔全部列的比例。

        供 min/max 兩端的抑制率預覽用（只泛化 QI + 分組計數，不做實際抑制/輸出）。
        以「列落單比例」為單位，讓 min 與 max 兩個數字可直接比較（不受 row/cell 抑制方式影響）。
        """
        if not k_qi_cols or k <= 1 or len(base_df) == 0:
            return 0.0
        d = base_df.copy()
        for col in qi_cols:
            lvl = levels.get(col, 0)
            col_type = config.columns[col].type
            # 數值欄不吃層級，兩端一律照設定檔的切法泛化，才與實際輸出用同一把尺
            if lvl <= 0 and col_type != "numeric":
                continue
            gen = self._generalizers.get(config.columns[col].type)
            if gen is None:
                continue
            new_series, _warn = gen.generalize(d[col], col, lvl, config)
            if new_series is not None:
                d[col] = new_series
        # 與 KAnonymity.check 同一種計數（空值視為萬用字元）
        counts = wildcard_group_sizes(d[k_qi_cols])
        return int((counts < k).sum()) / len(base_df)

    def run(self, df: pd.DataFrame) -> tuple[pd.DataFrame, QualityReport]:
        config = self.config
        k = self.k
        l = self.l  # noqa: E741
        t = self.t
        suppression_limit_percent = self.suppression_limit_percent
        limit_exceeded_action = self.limit_exceeded_action
        salt_key = self.salt_key
        suppression_method = self.suppression_method

        # 前置驗證（fail fast）：自我檢查 → 交互檢查 → 參數檢查，委派給注入的驗證器。
        self._validator.validate(df, config, k, k_qi_subset=self.k_qi_subset)

        # 鹽值為選填：有給就走 HMAC、沒給就對值本身做雜湊，兩者皆照跑不擋。
        # 加不加鹽會寫進品質報告，讀報告的人看得到本次是哪一種。
        salted = bool((salt_key or "").strip())

        df_out = df.copy()
        n_original = len(df)

        # 泛化層級一律取自設定檔（逐欄設定歸設定檔；呼叫端無覆蓋參數）
        merged_levels = dict(config.qi_generalization_levels or {})
        # 解析每個層級值為 (min, max)（規格 2.1(2)）：單值→固定（min==max）、[min,max]→範圍。
        # 驗證於此進行（fail fast）。
        # applied_levels：實際套用的層級＝各欄 min（泛化最少、資料保留最多）；
        # max_levels：各欄 max，供報告呈現「泛化到 max 的抑制率」比較。
        applied_levels = {}
        max_levels = {}
        has_level_range = False  # 是否有任一欄設了 min≠max 的範圍
        for col, raw in merged_levels.items():
            lo, hi = parse_level_value(col, raw)
            applied_levels[col] = lo
            max_levels[col] = hi
            # 數值欄不吃層級（切法由使用者於設定檔寫死），對它設範圍不會有兩端差異，
            # 故不納入 min/max 評估，以免報告出現兩端相同的空洞比較。
            col_info = config.columns.get(col)
            if lo != hi and (col_info is None or col_info.type != "numeric"):
                has_level_range = True

        # ── Step 1：依欄位策略套用移除 / 遮蔽 / 雜湊 ──────────────────────────
        for col, info in config.columns.items():
            if col not in df_out.columns:
                continue
            if info.role == "identifier":
                # 識別欄位統一交給 Step 2 處理，避免在此先遮蔽/雜湊造成重複處理或碰撞
                continue
            strategy = info.get_effective_strategy()
            if strategy == "remove":
                # 規格 2.1(1)：移除為通用資料處理功能，不限角色。任何非 identifier 欄位
                # 明確設 remove 皆刪欄（identifier 的 remove 仍由 Step 2 處理）。
                df_out.drop(columns=[col], inplace=True)
            elif strategy == "clear":
                # 值清空、欄位保留。隱私效果與 remove 相同（值都不在了），差別只在
                # 下游拿到的欄位還在不在——供資料表欄位固定、少一欄就匯不進去的情境使用。
                df_out[col] = pd.NA
            else:
                # 遮蔽類（mask/partial/hash）查表分派：由 factory 依欄位設定/鹽值建構對應 Mask。
                # 新增遮蔽策略只需在 factory 登記一行，此處不動（generalize/none 無對應建構函式 → 跳過）。
                builder = self._masker_builders.get(strategy)
                if builder is not None:
                    df_out[col] = builder(info, salt_key, config.algorithm).apply(
                        df_out[col]
                    )

        # 角色欄位清單一律排除「已不在 df_out 的欄位」——涵蓋 remove 刪掉的欄，
        # 避免後續 Step3 泛化 / Step4 groupby 引用到已刪欄位而出錯。
        id_cols = [
            col for col, info in config.columns.items()
            if info.role == "identifier" and col in df_out.columns
        ]
        sensitive_cols = [
            col for col, info in config.columns.items()
            if info.role == "sensitive" and col in df_out.columns
        ]
        qi_cols = [
            col for col, info in config.columns.items()
            if info.role == "quasi_identifier" and col in df_out.columns
        ]

        # 算 k 用的 QI 欄位（規格 2.1(4)「整體 k 或依指定準識別欄位組合計算」）：
        # 未指定子集 → 用全部 QI（整體 k）；指定 → 以子集定義等價類（k/l/t/抑制皆據此）。
        # 泛化仍對「全部 QI」進行（Step3 不受子集影響）；子集只改變「分組」的欄位。
        # 子集合法性已於 Step 0（ConfigValidator._check_k_qi_subset）前置驗證，此處直接取用。
        k_qi_cols = list(self.k_qi_subset) if self.k_qi_subset else qi_cols

        # ── Step 2：識別欄位處理 ────────────────────────────────────────────
        # 識別欄位有三種有效處理：remove（刪欄）、clear（值清空、欄位保留）
        # 或假名化（HMAC，預設）。使用者顯式設了這三者以外的策略（none/mask/generalize）
        # 時，識別欄不支援、一律回退為假名化（安全兜底：識別欄絕不明碼輸出）。此為
        # 「策略放錯角色」的設定邏輯問題，規格未規定角色×策略相容性 → 不擋，照假名化
        # 跑並於報告提醒。
        # 雜湊對原始值進行（不受 Step 1 影響），確保不同個體不會碰撞。
        identifier_strategy_ignored = []  # (col, 使用者設定的策略) 供報告提醒
        for col in id_cols:
            strat = config.columns[col].strategy
            if strat == "remove":
                df_out.drop(columns=[col], inplace=True)
            elif strat == "clear":
                df_out[col] = pd.NA
            else:
                if strat is not None and strat != "hash":
                    identifier_strategy_ignored.append((col, strat))
                df_out[col] = HashMask(salt_key, config.algorithm).apply(df_out[col])

        # ── Step 3：QI 欄位泛化 ─────────────────────────────────────────────
        generalization_warnings = []   # 記錄設了層級卻無法泛化的欄位（如缺類別階層）
        level_missing_warnings = []    # 記錄定義了泛化格式卻沒給 level 的欄位
        level_zero_warnings = []       # 記錄定義了泛化格式、但明確把 level 設成 0（不泛化）的欄位
        level_clamped_warnings = []    # 記錄 level 超過矩陣深度、被夾到最粗級的欄位 (col, 設定level, 矩陣深度)
        not_in_matrix_warnings = []    # 類別欄有值但不在矩陣被泛化為 * 的統計 (col, 格數, 有值格數)
        numeric_no_spec_warnings = []  # 數值 QI 未指定 bins/rounding → 不泛化
        numeric_level_ignored = []     # 數值 QI 設了泛化層級 → 數值不吃層級，該設定未生效
        numeric_uncovered_warnings = []  # 數值欄未被任何區間涵蓋的統計 (col, 格數, 有值格數)
        datetime_no_levels_warnings = []  # 日期 QI 未宣告 levels → 不泛化
        time_periods_idle_warnings = []   # 本次泛化粒度粗於時 → 時段對照表未生效 (col, 本次粒度)
        time_periods_uncovered_warnings = []  # 時段對照表未涵蓋的值統計 (col, 格數, 有值格數)
        applied_defaults = []          # 使用者沒給、系統用了預設的項目（此處收集字串 bin_size；k／抑制等由 API/CLI 層補）
        # 泛化層級表指向了「存在但非 QI」的欄位：資料層對得上（前置驗證已放行），
        # 但泛化只作用 QI，此設定不會生效——屬設定邏輯無效，不擋、僅收集後於報告提醒。
        non_qi_level_warnings = [
            col for col in merged_levels.keys() if col not in qi_cols
        ]
        # 對非 QI 欄位顯式設 strategy=generalize（規格 2.1(2) 泛化僅針對 QI）。
        # 非 QI 角色的預設策略不是 generalize，故此清單只會收到「使用者明確設了 generalize 卻放錯角色」者，
        # 空轉無作用——同屬設定邏輯無效，提醒不擋。
        non_qi_generalize_warnings = [
            col for col, info in config.columns.items()
            if col in df_out.columns
            and info.role != "quasi_identifier"
            and info.get_effective_strategy() == "generalize"
        ]
        # 逐欄填入值只在「值抑制挖 QI 欄」時用得到。設在非 QI 欄位＝永遠不會生效；
        # 本次走列抑制＝這次不會生效。兩者皆屬設定邏輯無效（值本身合法、不涉資料），
        # 照既有分界提醒不擋。
        cell_fill_on_non_qi = [
            col for col, info in config.columns.items()
            if info.cell_fill_value is not None and info.role != "quasi_identifier"
        ]
        cell_fill_unused_in_row_mode = (
            [col for col, info in config.columns.items() if info.cell_fill_value is not None]
            if suppression_method == "row_suppression"
            else []
        )
        for col in qi_cols:
            check_cancelled()  # ★ TTC 2026-10-31
            col_type = config.columns[col].type
            level = applied_levels.get(col, 0)  # 實際套用各欄 min

            # 數值欄自成一條路：切法由使用者於設定檔寫死（bins 或 rounding），不吃層級。
            # 兩種都沒給＝這欄不泛化（維持原值），照既有分界提醒而不擋——
            # 沒設定不等於設定錯誤，且擋下來會讓「只想用其他欄做 k」的合法用法跑不動。
            if col_type == "numeric":
                spec = (config.generalization_hierarchies or {}).get(col)
                spec = spec if isinstance(spec, dict) else {}
                if col in merged_levels:
                    numeric_level_ignored.append(col)
                if "bins" not in spec and "rounding" not in spec:
                    numeric_no_spec_warnings.append(col)
                    continue
                new_series, _ = self._generalizers["numeric"].generalize(
                    df_out[col], col, level, config
                )
                # 有值卻沒被任何區間涵蓋（超出範圍／落在空隙／非數值）→ 已輸出 "*" 或空值。
                # 屬使用者自訂區間涵蓋不全（系統無從判斷該補哪一段），僅統計後於報告提醒。
                valued = int(df_out[col].notna().sum())
                if "bins" in spec:
                    uncovered = int((new_series == "*").sum())
                else:
                    uncovered = valued - int(new_series.notna().sum())
                if uncovered > 0:
                    numeric_uncovered_warnings.append((col, uncovered, valued))
                df_out[col] = new_series
                continue

            if level <= 0:
                # 給了泛化格式（類別階層／區間設定）卻沒設 level → 仍跳過不泛化，
                # 但記入警示（不靜默）；也不擅自猜一個 level 替使用者泛化
                # （不做未明確要求的資料轉換）。
                # 明確寫了 0 與根本沒寫要分開講：前者是使用者選擇不泛化（照做即可，
                # 但仍要讓他知道這欄沒泛化），後者才是漏填、該提示去補。
                has_matrix = bool(config.generalization_matrices) and col in config.generalization_matrices
                has_hier = bool(config.generalization_hierarchies) and col in config.generalization_hierarchies
                if has_matrix or has_hier:
                    if col in merged_levels:
                        level_zero_warnings.append(col)
                    else:
                        level_missing_warnings.append(col)
                continue  # level=0 表示不泛化，維持原值

            # 類別欄的 level 超過矩陣可提供的深度時，泛化會被夾到最粗級。
            # 此為 level 與 matrix 兩份設定間的邏輯偏差（值合法、不涉資料），照夾但提醒（不擋）。
            # 階梯格式 [原始值, level1, ...]，可泛化最大層級取各筆最保守（最小）者。
            if col_type == "categorical" and config.generalization_matrices and col in config.generalization_matrices:
                mapping = parse_categorical_mapping(col, config.generalization_matrices[col])
                max_level = min(len(ladder) - 1 for ladder in mapping.values())
                if level > max_level:
                    level_clamped_warnings.append((col, level, max_level))

            # 日期欄同理：level 超過宣告的粒度數時取最粗的一級，照夾但提醒。
            datetime_periods_active = False
            if col_type == "temporal":
                spec = (config.generalization_hierarchies or {}).get(col)
                if isinstance(spec, dict) and "levels" in spec:
                    levels = parse_temporal_levels(col, spec["levels"])
                    # 層級 1＝levels 第一項，故可用的最大層級即粒度個數（層級 0 是不泛化，
                    # 前面已攔下）。與類別階層同樣採「0＝原值、往上是泛化步數」。
                    max_level = len(levels)
                    if level > max_level:
                        level_clamped_warnings.append((col, level, max_level))
                    # 時段對照表換掉的是「一天之內的時間」，故只在本次泛化到時／分／秒時
                    # 才有東西可換；泛化到日以上時間已不在輸出裡，屬設定邏輯無效，提醒不擋。
                    if spec.get("time_periods"):
                        granularity = levels[min(level, max_level) - 1]
                        if granularity in TEMPORAL_TIME_LEVELS:
                            datetime_periods_active = True
                        else:
                            time_periods_idle_warnings.append((col, granularity))

            # applied_defaults 透明化：字串長度分級未指定 bin_size → 用了預設 5，告知
            hier = (config.generalization_hierarchies or {}).get(col)
            has_bin = isinstance(hier, dict) and "bin_size" in hier
            if not has_bin and col_type == "string" and config.columns[col].mask_mode == "length":
                applied_defaults.append(f"欄位 '{col}' 字串長度分級未指定 bin_size，已使用預設 5。")

            generalizer = self._generalizers.get(col_type)
            if generalizer is None:
                continue
            new_series, warn = generalizer.generalize(df_out[col], col, level, config)
            if warn == "no_levels":
                # 日期欄未宣告 levels → 系統不代為決定粒度，維持原值並提醒（比照數值欄的無預設原則）
                datetime_no_levels_warnings.append(col)
            elif warn == "no_matrix":
                # 防禦性後備：「類別 QI 設層級卻無矩陣」已於 ColumnConfig.validate_config()
                # 前置擋（fail fast），正常不會走到此分支；保留以防未經驗證的直呼路徑。
                generalization_warnings.append(col)
            elif new_series is not None:
                # 類別欄「有值但不在矩陣」會被泛化為 "*"。此時空值已為 nan、尚未抑制，
                # 故泛化結果中的 "*" 僅來自「不在矩陣」，可直接計數。屬矩陣涵蓋不全（使用者責任），
                # 不擋（規格明訂階層由使用者自訂、系統無從判斷），僅統計後於報告提醒。
                if col_type == "categorical":
                    not_in_matrix = int((new_series == "*").sum())
                    if not_in_matrix > 0:
                        valued = int(df_out[col].notna().sum())  # 分母取「有值」格數（不含空值）
                        not_in_matrix_warnings.append((col, not_in_matrix, valued))
                # 時段對照表未涵蓋的值會以 "*" 結尾（標籤一律排在最後、且禁止含 "*"，
                # 故此判斷不會誤傷正常標籤）。同屬對照表涵蓋不全，統計後提醒不擋。
                if datetime_periods_active:
                    uncovered = int(
                        new_series.dropna().astype(str).str.endswith("*").sum()
                    )
                    if uncovered > 0:
                        valued = int(df_out[col].notna().sum())
                        time_periods_uncovered_warnings.append((col, uncovered, valued))
                df_out[col] = new_series

        # ── Step 4：K-匿名抑制 ──────────────────────────────────────────────
        # 違規列數（兩種模式皆計算，供報告參考）；與 outcome.suppressed_count 不同——
        # 值抑制的抑制量以「格」計，落單的列並不會被刪掉。
        violation_row_count = 0
        violation_mask: pd.Series | None = None
        # 未執行抑制時的預設結果：抑制率 0、以列為單位，分母仍給原始列數以便對照
        outcome = SuppressionOutcome(0.0, "row", 0, n_original, "")
        if len(k_qi_cols) > 0 and k > 1:
            # 以「算 k 的 QI 欄位」（全部或指定子集）計算每列所屬等價類大小
            # 與 KAnonymity.check 同一種計數（空值視為萬用字元）
            counts = wildcard_group_sizes(df_out[k_qi_cols])
            violation_mask = counts < k
            if suppression_method == "row_suppression":
                # ★ TTC 2026-11-02：空值當萬用字元時，等價類大小不具單調性——完整列可能靠含空值的列
                #   湊滿 k，反之亦然；刪掉一批違規列後，原本靠它們撐住的列會落到 k 以下。
                #   原本只刪一次就釋出（k_passed=False 仍照樣輸出），改為重算到沒有違規列為止。
                for _ in range(len(df_out)):
                    remaining = df_out.loc[~violation_mask, k_qi_cols]
                    if remaining.empty:
                        break
                    newly = wildcard_group_sizes(remaining) < k
                    if not newly.any():
                        break
                    check_cancelled()
                    violation_mask = violation_mask | newly.reindex(violation_mask.index, fill_value=False)
            violation_row_count = int(violation_mask.sum())

            # 建構時已驗證過合法值，這裡直接取——若注入的自訂表漏了對應鍵，寧可在測試炸出也不靜默代換
            # 值抑制挖的是「定義等價類的欄位」（k_qi_cols），與分組基礎一致
            # 逐欄填入值（設定檔 cell_fill_value）：只取本次真正會被挖的欄位，
            # 未指定者由 Suppressor 沿用全域 cell_fill
            cell_fill_values = {
                col: config.columns[col].cell_fill_value
                for col in k_qi_cols
                if config.columns[col].cell_fill_value is not None
            }
            check_cancelled()
            suppressor = self._suppressors[suppression_method](
                self.cell_fill, cell_fill_values
            )
            df_out, outcome = suppressor.suppress(
                df_out, violation_mask, k_qi_cols, violation_row_count, n_original, k
            )

        # ── Step 5：l-diversity / t-closeness「檢測」（不修改資料）─────────────
        # 規格對 l/t 僅要求「自動檢測是否達標」與「未達標時提供調整建議」，
        # 並未要求系統自動修改資料來強制達成。故此處只判定達標與否、累計違規等價類數，
        # 不對敏感欄位做任何遮蔽；實際補救（提高泛化層級、抑制少數群組等）由使用者
        # 依建議清單調整設定後重跑。
        # 分組時空值與挖掉的格子不當萬用字元，而是當成一般的值（自成一組），全部列都檢查。
        l_passed = True
        t_passed = True
        l_fail_count = 0  # l-diversity 未通過的等價類數量
        t_fail_count = 0  # t-closeness 未通過的等價類數量
        masked_sensitive_lt = []  # 被遮蔽/雜湊卻仍要求 l/t 的敏感欄（矛盾設定）
        if sensitive_cols and len(k_qi_cols) > 0 and len(df_out) > 0:
            present_sensitive = [c for c in sensitive_cols if c in df_out.columns]
            # l/t 是對「敏感值本身」衡量多樣性／分佈。若敏感欄已被遮蔽/雜湊（Step1），
            # 檢測對象已非原始敏感值，結果不構成有效隱私保證。不擋（規格允許遮蔽敏感欄），
            # 但不跑該檢測、標記為未通過（不給假的綠燈），並於報告說明矛盾。
            if l is not None or t is not None:
                masked_sensitive_lt = [
                    c for c in present_sensitive
                    # ★ TTC 2026-11-02：partial（部分遮蔽）、clear（清空）同樣已非原始敏感值
                    if config.columns[c].get_effective_strategy() in ("mask", "hash", "partial", "clear")
                ]
            valid_lt_cols = [c for c in present_sensitive if c not in masked_sensitive_lt]

            # 用 is not None 而非 truthiness：t=0（最嚴格門檻＝分佈須完全一致）是合法值，
            # 不可與「未設定（None）」混為一談而被靜默跳過。l 同步一致（l=0 檢測必過但語義統一）。
            if l is not None:
                for s_col in valid_lt_cols:
                    check_cancelled()
                    l_ok, l_failures = self._l_metric.check(df_out, k_qi_cols, s_col, l)
                    if not l_ok:
                        l_passed = False
                        l_fail_count += len(l_failures)
                # 有敏感欄被遮蔽卻要求 l → 無法證成 l-diversity，不給假的通過
                if masked_sensitive_lt:
                    l_passed = False

            if t is not None:
                for s_col in valid_lt_cols:
                    check_cancelled()
                    global_dist = df[s_col].value_counts(normalize=True)
                    t_ok, t_failures = self._t_metric.check(
                        df_out, k_qi_cols, s_col, t, global_dist
                    )
                    if not t_ok:
                        t_passed = False
                        t_fail_count += len(t_failures)
                # 有敏感欄被遮蔽卻要求 t → 無法證成 t-closeness，不給假的通過
                if masked_sensitive_lt:
                    t_passed = False

        # ── 產出品質報告 ─────────────────────────────────────────────────────
        is_k_ok, _ = self._k_metric.check(
            df_out, k_qi_cols, k, suppressed=outcome.suppressed_cells
        )
        # 無 QI 欄位（含被 remove 刪光）且 k>1：k-匿名無從執行，不給假綠燈
        # （KAnonymity 對空 QI 會回傳 True，故此處明確覆寫）。
        no_qi_for_k = len(k_qi_cols) == 0 and k > 1
        if no_qi_for_k:
            is_k_ok = False
        # 設了 l/t 卻無敏感欄位（含被刪光）：檢測無對象，不給假的通過。
        lt_requested_no_sensitive = (l is not None or t is not None) and len(sensitive_cols) == 0
        if lt_requested_no_sensitive:
            if l is not None:
                l_passed = False
            if t is not None:
                t_passed = False
        # 上限與實際抑制率同為百分比，直接比較（單位一致，報告的人也不必自行換算）
        suppression_ok = outcome.rate_percent <= suppression_limit_percent
        # 整體達標：抑制率未超限，且 k／l／t 三項檢測皆通過
        is_valid = suppression_ok and is_k_ok and l_passed and t_passed

        if is_valid:
            msg = "K-匿名化處理成功，k／l／t 檢測均通過。"
        else:
            problems = []
            if not suppression_ok:
                problems.append("抑制率超過上限")
            if not is_k_ok:
                problems.append(
                    "未執行 k-匿名（無準識別欄位）" if no_qi_for_k else "部分等價類未達 k 值"
                )
            if not l_passed:
                problems.append(
                    "未執行 l-diversity（無敏感欄位）" if lt_requested_no_sensitive else "l-diversity 未通過"
                )
            if not t_passed:
                problems.append(
                    "未執行 t-closeness（無敏感欄位）" if lt_requested_no_sensitive else "t-closeness 未通過"
                )
            msg = "去識別化未完全達標：" + "、".join(problems) + "。"

        # 建議清單：附上實際數字以呈現「預期影響」
        recommendations = []
        if not suppression_ok or outcome.rate_percent > 5:
            current_levels = {c: applied_levels.get(c, 0) for c in qi_cols}
            prefix = (outcome.desc + "。") if outcome.desc else ""
            recommendations.append(
                f"{prefix}建議提高準識別符 (QI) 欄位的泛化層級以減少落單的等價類；"
                f"目前各 QI 泛化層級為 {current_levels}，提高泛化程度等級預期可進一步降低抑制率。"
            )
        # 僅在有「真實違規等價類」時才給這條達標建議，避免矛盾設定（計數為 0）時出現「0 個」誤導
        if (not l_passed or not t_passed) and (l_fail_count > 0 or t_fail_count > 0):
            recommendations.append(
                f"敏感欄位檢測未通過：l-diversity 不足的等價類 {l_fail_count} 個、"
                f"t-closeness 超標的等價類 {t_fail_count} 個。建議提高準識別符 (QI) 欄位的泛化層級，"
                f"使等價類合併變大（敏感值更趨多樣、分佈更接近整體），或抑制少數群組／極端值後重跑；"
                f"亦可放寬 l/t 門檻。（系統僅檢測與建議，不會自動修改敏感欄位資料。）"
            )
        # 敏感欄被遮蔽/雜湊卻要求 l/t 的矛盾設定 → 說明為何標記未通過（非真正達標失敗）
        if masked_sensitive_lt:
            recommendations.append(
                f"以下敏感欄位已套用遮蔽/雜湊，卻同時要求了 l/t 檢測：{masked_sensitive_lt}。"
                f"l-diversity/t-closeness 衡量的是『敏感值本身』的多樣性與分佈，欄位一旦被遮蔽/雜湊，"
                f"檢測對象已非原始敏感值，結果不構成有效隱私保證，故標記為未通過（此為設定矛盾，非真正達標失敗）。"
                f"建議二擇一：若要以 l/t 保護此欄，請移除其遮蔽/雜湊設定（保留原值，靠 QI 泛化間接保護）；"
                f"若確定要遮蔽此欄，請移除對它的 l/t 要求。"
            )
        if no_qi_for_k:
            recommendations.append(
                "未偵測到準識別欄位 (QI)（可能未設定或已被移除），k-匿名分組與抑制未執行、k 值未生效。"
                "若需 k-匿名保護，請至少指定一個 quasi_identifier 欄位後重跑。"
            )
        elif not is_k_ok:
            recommendations.append(
                "部分等價類未達到 k 值要求，建議以再識別風險評估（API /risk/k-anonymity 或 CLI risk-k-anonymity）進一步評估。"
            )
        if lt_requested_no_sensitive:
            recommendations.append(
                "已設定 l/t 門檻，但未偵測到敏感欄位（可能未設定或已被移除），"
                "l-diversity/t-closeness 檢測未執行、無法保證。"
                "若需檢測請指定 sensitive 欄位；若不需要可移除 l/t 設定。"
            )
        if generalization_warnings:
            recommendations.append(
                f"以下類別型欄位設定了泛化層級，但未在 generalization_matrices 提供對應階層，"
                f"泛化未生效：{generalization_warnings}。請補上類別階層或移除其泛化層級設定。"
            )
        if level_missing_warnings:
            recommendations.append(
                f"以下欄位已定義泛化格式（類別階層或區間設定），但未指定泛化層級 (level)，"
                f"因此未進行泛化：{level_missing_warnings}。請於 qi_generalization_levels 補上層級。"
            )
        if level_zero_warnings:
            recommendations.append(
                f"以下欄位的泛化層級設為 0，代表不泛化，因此維持原值："
                f"{level_zero_warnings}。若要泛化請改為 1 以上："
                f"層級 1 為第一級泛化（類別為階梯第一層、日期為 levels 第一個粒度），"
                f"數字越大泛化程度越高。"
            )
        if numeric_no_spec_warnings:
            recommendations.append(
                f"以下數值型準識別欄位未指定泛化方式，因此維持原值未泛化："
                f"{numeric_no_spec_warnings}。數值泛化須自行指定切法（無系統預設），"
                f"請於 generalization_hierarchies 擇一填入 bins（自訂區間）或 rounding（四捨五入到該數的倍數，如 10）。"
            )
        if numeric_level_ignored:
            recommendations.append(
                f"以下數值型欄位設定了泛化層級，數值欄位的泛化由 bins/rounding 決定，"
                f"不分層級，此設定未生效：{numeric_level_ignored}。可逕行移除。"
            )
        if numeric_uncovered_warnings:
            detail = "、".join(
                f"{col} {cnt}/{valued} 格（{(cnt / valued * 100 if valued else 0):.1f}%）"
                for col, cnt, valued in numeric_uncovered_warnings
            )
            recommendations.append(
                f"以下數值欄位有資料未被任何區間涵蓋（超出範圍、落在區間之間的空隙，"
                f"或該格不是數字），已輸出為未涵蓋標記而非原值：{detail}。"
                f"若不預期如此，請檢查 bins 的涵蓋範圍或資料本身。"
            )
        if non_qi_level_warnings:
            recommendations.append(
                f"以下欄位設定了泛化層級，但其角色並非準識別欄位 (quasi_identifier)，"
                f"泛化僅作用於 QI 欄位，此設定未生效：{non_qi_level_warnings}。"
                f"若欲泛化，請將該欄位角色設為 quasi_identifier；否則可移除其泛化層級設定。"
            )
        if non_qi_generalize_warnings:
            recommendations.append(
                f"以下欄位的策略設為 generalize，但其角色並非準識別欄位 (quasi_identifier)，"
                f"泛化僅作用於 QI 欄位，此設定未生效、欄位維持原值：{non_qi_generalize_warnings}。"
                f"若欲泛化，請將該欄位角色設為 quasi_identifier；否則請改用其他策略或移除。"
            )
        if not_in_matrix_warnings:
            detail = "、".join(
                f"'{col}'（{n}/{valued} 格，{(n / valued * 100 if valued else 0):.1f}%）"
                for col, n, valued in not_in_matrix_warnings
            )
            recommendations.append(
                f"以下類別欄位有部分值不在您提供的類別階層中，已泛化為 '*'（全域類別）：{detail}。"
                f"比例偏高代表矩陣涵蓋不全、過多資料被歸為無差別類別而降低可用性；"
                f"若在意，請補齊類別階層涵蓋這些值後重跑。"
            )
        if datetime_no_levels_warnings:
            recommendations.append(
                f"以下日期型準識別欄位未宣告粒度階梯 (levels)，因此維持原值未泛化："
                f"{datetime_no_levels_warnings}。系統不代為決定要泛化到哪一級，"
                f"請於 generalization_hierarchies 以 levels 由細到粗列出粒度"
                f"（如 day、month、year），泛化層級即代表取第幾個粒度。"
            )
        if time_periods_idle_warnings:
            detail = "、".join(
                f"'{col}'（本次泛化到「{granularity}」）"
                for col, granularity in time_periods_idle_warnings
            )
            recommendations.append(
                f"以下日期型欄位設定了時段對照表 (time_periods)，但本次泛化的粒度粗於「時」，"
                f"輸出已不含時間，因此未生效：{detail}。時段對照表只在泛化到 hour／minute／"
                f"second 時套用，請調降泛化層級，或移除此設定。"
            )
        if time_periods_uncovered_warnings:
            detail = "、".join(
                f"'{col}'（{n}/{valued} 格，{(n / valued * 100 if valued else 0):.1f}%）"
                for col, n, valued in time_periods_uncovered_warnings
            )
            recommendations.append(
                f"以下日期型欄位有部分值的時間未落入時段對照表 (time_periods) 的任何區間，"
                f"已輸出 '*'：{detail}。請確認對照表的區間涵蓋一整天"
                f"（由 00:00 到 24:00）。"
            )
        if cell_fill_on_non_qi:
            recommendations.append(
                f"以下欄位設定了值抑制填入值 (cell_fill_value)，但其角色並非準識別欄位 "
                f"(quasi_identifier)，值抑制只挖準識別欄位，此設定不會生效：{cell_fill_on_non_qi}。"
                f"若欲指定填入值，請將該欄位角色設為 quasi_identifier；否則可移除此設定。"
            )
        if cell_fill_unused_in_row_mode:
            recommendations.append(
                f"以下欄位設定了值抑制填入值 (cell_fill_value)，但本次採用列抑制 "
                f"(suppression_method=row_suppression)，違規列會整列刪除、不會填入任何值，"
                f"此設定本次未生效：{cell_fill_unused_in_row_mode}。"
                f"若要使用逐欄填入值，請改用值抑制 (suppression_method=cell_suppression)。"
            )
        if identifier_strategy_ignored:
            detail = "、".join(f"'{col}'（設定 {strat}）" for col, strat in identifier_strategy_ignored)
            recommendations.append(
                f"以下識別欄位設定的策略未被採用：{detail}。識別欄位僅支援 hash（假名化）、"
                f"remove（移除整個欄位）或 clear（值清空、欄位保留），"
                f"其他策略一律回退為假名化以確保識別欄不明碼輸出。"
                f"若要移除該欄請設 remove；若要保留欄位但不留值請設 clear；"
                f"若接受假名化可省略策略或設 hash。"
            )
        if level_clamped_warnings:
            detail = "、".join(
                f"'{col}'（設定 level={lv}，可用最大層級 {mx}）"
                for col, lv, mx in level_clamped_warnings
            )
            recommendations.append(
                f"以下欄位設定的泛化層級超過其階層可提供的深度，已泛化至最粗一級（未報錯）："
                f"{detail}。類別欄若需更粗請擴充階梯層數、日期欄請增加 levels 粒度；"
                f"否則可將 level 調整至可用層級以內。"
            )
        # 有欄位設了 min/max 範圍 → 呈現「套用 min」與「泛化到 max」兩端的落單比例
        # （規格 2.1(4)B「呈現預期影響」）。實際輸出的是 min 那份；達標與否看 min。
        if has_level_range and k_qi_cols and k > 1:
            min_rate = violation_row_count / n_original if n_original else 0.0
            max_rate = self._violation_rate_at(df, config, max_levels, qi_cols, k_qi_cols, k)
            if is_k_ok:
                recommendations.append(
                    f"泛化層級 min/max 範圍評估：目前套用最小層級（min），落單比例約 {min_rate:.1%}，"
                    f"已達到 k={k} 要求；若提高至最大層級（max），落單比例約 {max_rate:.1%}。"
                    f"（實際輸出為 min 那份；如需 max 版本請將層級設為 max 重跑。）"
                )
            else:
                recommendations.append(
                    f"泛化層級 min/max 範圍評估：目前套用最小層級（min），落單比例約 {min_rate:.1%}，"
                    f"未達 k={k} 要求；若提高至最大層級（max），落單比例約 {max_rate:.1%}。"
                    f"建議於 min~max 範圍內調高泛化層級後重跑。"
                )

        # 拋錯僅綁定「抑制率超限」此一情境，維持錯誤碼語意正確。
        # 說明與建議寫在引擎而非各介面，API 與 CLI 才會對同一個問題講同一句話。
        if not suppression_ok and limit_exceeded_action == "stop_and_error":
            raise PetsError(
                "ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED",
                f"去識別化失敗：計算之抑制率 {outcome.rate_percent:.2f}% "
                f"已超過設定的最高上限 {suppression_limit_percent:.2f}%。",
                recommendations=[
                    "建議提高準識別符 (QI) 欄位的泛化層級，或調整數值欄位的 bins／rounding 切法，"
                    "以降低抑制比例。"
                ],
            )

        return df_out, QualityReport(
            is_valid,
            outcome.rate_percent,
            msg,
            recommendations,
            k_passed=is_k_ok,
            l_passed=l_passed,
            t_passed=t_passed,
            suppression_unit=outcome.unit,
            suppressed_count=outcome.suppressed_count,
            suppression_total_count=outcome.total_count,
            applied_defaults=applied_defaults,
            hash_algorithm=config.algorithm,
            hash_salted=salted,
        )
