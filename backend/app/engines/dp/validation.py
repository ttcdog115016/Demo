"""前置驗證（BudgetValidator）：自我檢查 → 交互檢查 → 參數檢查。

比照 K-匿名 ConfigValidator 的結構與精神（合法輸入順利執行、非法輸入 fail fast 並說清楚）：
  自我檢查：委派設定檔自己的健檢（DPColumnConfig.validate_config，純 config 的值域/型別衝突）
  交互檢查：設定檔對照實際資料（欄名存在、continuous 可轉數值、datetime 可解析）
  參數檢查：全域旋鈕與資料/設定的合理性（default_delta 值域）

純 config 的檢查由 DPColumnConfig.validate_config() 於解析設定檔時即擋；
此處再委派一次，確保「直接呼叫引擎（不經設定檔）」的人也受同一套保護。
"""

import numpy as np
import pandas as pd

from app.core.config import ColumnBudget, DPColumnConfig
from app.core.errors import PetsError


class BudgetValidator:
    """DP 前置驗證器：逐欄檢查欄名存在、宣告型別與資料相符；全域旋鈕值域。"""

    def validate(
        self,
        df: pd.DataFrame,
        config: DPColumnConfig,
        default_delta: float | None = None,
    ) -> None:
        self._self_check(config)              # 自我檢查：設定檔本身是否合理
        self._cross_check(df, config)         # 交互檢查：設定檔對照實際資料
        self._sanity_check(default_delta)     # 參數檢查：全域旋鈕是否合理

    # ── 自我檢查 ──────────────────────────────────────────────────────────
    def _self_check(self, config: DPColumnConfig) -> None:
        # 委派設定檔自己的健檢（ε/δ 值域、categorical 不該有 δ/sensitivity）；
        # 該健檢在設定檔解析時也會用到，故保留在 DPColumnConfig 內。
        config.validate_config()

    # ── 交互檢查（設定檔 vs 實際資料）─────────────────────────────────────
    def _cross_check(self, df: pd.DataFrame, config: DPColumnConfig) -> None:
        for col, budget in config.column_budgets.items():
            self._check_column_exists(df, col)  # 先擋欄名，後續才可安全存取 df[col]
            self._check_continuous_numeric(df, col, budget)
            self._check_datetime(df, col, budget)

    def _check_column_exists(self, df: pd.DataFrame, col: str) -> None:
        if col not in df.columns:
            raise PetsError(
                "ERR_CONFIG_DATA_MISMATCH",
                f"預算設定引用了資料中不存在的欄位 '{col}'，請檢查欄位名稱。",
            )

    def _check_continuous_numeric(
        self, df: pd.DataFrame, col: str, budget: ColumnBudget
    ) -> None:
        # 宣告 continuous 的欄位，實體資料須真的能轉數值，否則加噪時 diffprivlib 會直接
        # 拋 TypeError（不友善）。比照 K-匿名 _check_numeric，前置擋掉並回明確錯誤。
        if budget.type != "continuous":
            return
        non_null = df[col].dropna()
        if len(non_null) == 0:
            return
        try:
            numeric = pd.to_numeric(non_null)
        except (ValueError, TypeError) as exc:
            # from exc 保留原始例外：對外給的是看得懂的說法，除錯時仍需知道 pandas 卡在哪。
            raise PetsError(
                "ERR_CONFIG_DATA_MISMATCH",
                f"欄位 '{col}' 宣告為 continuous，但實體資料包含無法轉換的非數值內容。",
            ) from exc
        # 無限大換不成整數刻度，加噪無從進行
        if np.isinf(numeric).any():
            raise PetsError(
                "ERR_CONFIG_DATA_MISMATCH",
                f"欄位 '{col}' 宣告為 continuous，但實體資料包含無限大（inf）的值，請先清除或改為空值。",
            )

    def _check_datetime(self, df: pd.DataFrame, col: str, budget: ColumnBudget) -> None:
        # 宣告 datetime 的欄位，實體資料須真的能解析成日期（比照 K-匿名 _check_temporal）。
        # 輸入格式採寬鬆解析（pandas 能讀就收），解析不了才 fail fast。
        if budget.type != "datetime":
            return
        non_null = df[col].dropna()
        if len(non_null) == 0:
            return
        try:
            pd.to_datetime(non_null)
        except (ValueError, TypeError) as exc:
            raise PetsError(
                "ERR_CONFIG_DATA_MISMATCH",
                f"欄位 '{col}' 宣告為 datetime，但實體資料包含無法解析的日期時間格式。",
            ) from exc

    # ── 參數檢查 ──────────────────────────────────────────────────────────────
    def _sanity_check(self, default_delta: float | None) -> None:
        # 全域 default_delta 與逐欄 δ 適用同一值域規則（δ 為機率，須落在 [0, 1)）。
        # 引擎以參數接收此值，故驗在引擎入口，直接呼叫引擎者同樣受此檢查。
        if default_delta is not None and not (0 <= default_delta < 1):
            raise PetsError(
                "ERR_DP_INVALID_BUDGET",
                f"全域 default_delta 必須大於等於 0 且小於 1（收到 {default_delta}）。",
            )
