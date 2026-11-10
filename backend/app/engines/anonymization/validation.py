"""前置驗證：自我檢查 → 交互檢查 → 參數檢查。

組合式寫法（不用 ABC，因為驗證沒有「可互換版本」）：一個 ConfigValidator，
內部用方法呼叫方法——交互檢查本身再拆成三個更小的檢查方法。
"""
import pandas as pd

from app.core.config import ColumnConfig
from app.core.errors import PetsError


def validate_choice_param(name: str, value: str, allowed: tuple) -> str:
    """單選字串參數驗證（fail fast）。

    寬容大小寫：先正規化為小寫再比對（"Row" → "row" 視為明確意圖）；
    其餘一律拋錯並列出合法值，不做相似度猜測、不靜默退回預設。
    訊息格式與 ColumnInfo 的 field_validator 一致。
    """
    normalized = value.lower() if isinstance(value, str) else value
    if normalized not in allowed:
        raise PetsError(
            "ERR_INVALID_PARAM",
            f"不合法的 {name}: {value!r}。必須是 {list(allowed)} 之一。",
        )
    return normalized


def validate_percent_param(name: str, value: float) -> float:
    """百分比參數驗證（fail fast）：須為數字且落在 0~100。

    比照 validate_choice_param 於建構時就擋——純參數即可判定，不需比對資料，
    故不留到跑完整份資料才發現單位寫錯（例如把 20% 寫成 0.2）。
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PetsError(
            "ERR_INVALID_PARAM",
            f"不合法的 {name}: {value!r}。必須是 0~100 的數字（百分比）。",
        )
    if not (0 <= value <= 100):
        raise PetsError(
            "ERR_INVALID_PARAM",
            f"不合法的 {name}: {value}。必須介於 0~100（以百分比表示，20 代表 20%）。",
        )
    return float(value)


class ConfigValidator:
    """K-匿名化前置驗證器。依序執行三大類檢查，任一不通過即拋 ValueError。"""

    def validate(
        self,
        df: pd.DataFrame,
        config: ColumnConfig,
        k: int,
        k_qi_subset: list = None,
    ) -> None:
        self._self_check(config)          # 自我檢查：設定檔本身是否合理
        self._cross_check(df, config)     # 交互檢查：設定檔對照實際資料
        # 泛化層級表引用的欄位須存在於資料——屬「資料層對不上」故 fail fast
        self._check_qi_levels_columns_exist(df, config)
        # k_qi_subset 指定的欄位須為可用的 QI——前置擋，不留到分組流程中才發現
        self._check_k_qi_subset(df, config, k_qi_subset)
        self._sanity_check(df, k)         # 參數檢查：k 與資料規模是否合理

    # ── 自我檢查 ──────────────────────────────────────────────────────────
    def _self_check(self, config: ColumnConfig) -> None:
        # 委派設定檔自己的健檢（型別與策略衝突，如日期欄不可遮蔽）；
        # 該健檢在設定檔解析時也會用到，故保留在 ColumnConfig 內。
        config.validate_config()

    # ── 交互檢查（本身再分三種 → 三個小方法）──────────────────────────────
    def _cross_check(self, df: pd.DataFrame, config: ColumnConfig) -> None:
        self._check_columns_exist(df, config)   # 種類 1：欄位名稱存在
        self._check_numeric(df, config)        # 種類 2：numeric 可轉數值
        self._check_temporal(df, config)       # 種類 3：temporal 可解析成日期

    def _check_columns_exist(self, df: pd.DataFrame, config: ColumnConfig) -> None:
        for col in config.columns.keys():
            if col not in df.columns:
                raise PetsError(
                    "ERR_CONFIG_DATA_MISMATCH",
                    f"設定檔宣告的欄位 '{col}' 不存在於提供的資料中，請檢查欄位名稱。",
                )

    def _check_qi_levels_columns_exist(
        self, df: pd.DataFrame, config: ColumnConfig
    ) -> None:
        # 設定檔的泛化層級表，任一 key 指向資料中不存在的欄位＝資料層對不上 → 擋
        #（與 _check_columns_exist 同類錯誤）。
        # 註：「欄位存在但非 QI 角色」屬設定邏輯無效，不在此擋，由 Step3 收集進報告提醒。
        for col in (config.qi_generalization_levels or {}).keys():
            if col not in df.columns:
                raise PetsError(
                    "ERR_CONFIG_DATA_MISMATCH",
                    f"泛化層級設定引用了資料中不存在的欄位 '{col}'，請檢查欄位名稱。",
                )

    def _check_k_qi_subset(
        self, df: pd.DataFrame, config: ColumnConfig, k_qi_subset: list = None
    ) -> None:
        # k_qi_subset（算 k 時使用的 QI 子集）指定的欄位，須為「Step1 移除後仍存在的準識別欄位」：
        # 角色＝quasi_identifier、存在於資料、且未設 remove（會被 Step1 刪掉）。
        # 屬「資料層對不上」→ fail fast；前置於 Step 0，不留到後續分組流程中才發現。
        if not k_qi_subset:
            return
        surviving_qi = [
            col
            for col, info in config.columns.items()
            if info.role == "quasi_identifier"
            and col in df.columns
            and info.get_effective_strategy() != "remove"
        ]
        invalid = [c for c in k_qi_subset if c not in surviving_qi]
        if invalid:
            raise PetsError(
                "ERR_CONFIG_DATA_MISMATCH",
                f"k_qi_subset 指定了非準識別欄位、不存在或將被移除的欄位 {invalid}，"
                f"可用於計算 k 的準識別欄位為 {surviving_qi}。",
            )

    def _check_numeric(self, df: pd.DataFrame, config: ColumnConfig) -> None:
        for col, info in config.columns.items():
            if info.type == "numeric":
                non_null = df[col].dropna()
                if len(non_null) > 0:
                    try:
                        pd.to_numeric(non_null)
                    except (ValueError, TypeError) as exc:
                        # from exc 保留原始例外：轉成領域錯誤是為了給使用者看得懂的說法，
                        # 但除錯時仍需要知道 pandas 實際卡在哪個值。
                        raise PetsError(
                            "ERR_CONFIG_DATA_MISMATCH",
                            f"欄位 '{col}' 配置為 numeric，但實體資料包含無法轉換的非數值內容。",
                        ) from exc

    def _check_temporal(self, df: pd.DataFrame, config: ColumnConfig) -> None:
        # 日期泛化先解析成時間再依粒度輸出，故整欄須真的解析得動——解析不了就無從降階，
        # 屬資料層對不上 → 前置擋（與 numeric 欄位、DP 端的日期檢查同一套原則）。
        for col, info in config.columns.items():
            if info.type != "temporal":
                continue
            non_null = df[col].dropna()
            if len(non_null) == 0:
                continue
            try:
                pd.to_datetime(non_null)
            except (ValueError, TypeError) as exc:
                # from exc 保留原始例外：領域錯誤給使用者看，除錯時仍需知道卡在哪一筆
                raise PetsError(
                    "ERR_CONFIG_DATA_MISMATCH",
                    f"欄位 '{col}' 配置為 temporal，但實體資料包含無法解析的日期時間內容"
                    f"（須為西元格式，且同一欄格式一致）。",
                ) from exc

    # ── 參數檢查 ──────────────────────────────────────────────────────────────
    def _sanity_check(self, df: pd.DataFrame, k: int) -> None:
        if k > len(df):
            raise PetsError(
                "ERR_CONFIG_DATA_MISMATCH",
                f"K 值設定與資料源規模不符：k={k} 大於資料筆數 {len(df)}，請確認數值合理性。",
            )
