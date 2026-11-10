"""去識別橋接（DeidBridge）——三攻擊評估專用。

三攻擊流程要求「只對 train（80%）去識別產 syn」，由引擎自行執行去識別。
橋接依 `method` 分派到 K-匿名／DP 門面（`run_k_anonymity()`／`run_dp()`），
去識別邏輯全由該門面負責；config 型別與 method 不符即 fail fast。

方法選擇（method）＋該方法原生 config 是「薄殼分派」：兩種方法需要的 config 天生不同
（K-匿名要泛化階層／DP 要 ε 預算），不合併成單一形狀，只在外層用 method 分流。
"""
from typing import Any

import pandas as pd

from app.core.config import ColumnConfig, DPColumnConfig
from app.core.errors import PetsError
from app.engines.anonymization import run_k_anonymity
from app.engines.dp import run_dp

# 對外接受的方法別名 → 正規名（避免呼叫端大小寫／連字號寫法不一致）
_K_ANON_ALIASES = {"k-anon", "kanon", "k_anon", "k-anonymity", "anonymize"}
_DP_ALIASES = {"dp", "differential-privacy", "differential_privacy"}


class DeidBridge:
    """依去識別方法分派，對 train 產生 syn（無狀態；只回資料集，去識別報告不外流）。"""

    def produce_syn(
        self,
        method: str,
        df: pd.DataFrame,
        config: Any,
        params: dict[str, Any] | None = None,
    ) -> pd.DataFrame:
        """對 df（train）套用指定去識別方法，回傳 syn。

        config：K-匿名為 ColumnConfig、DP 為 DPColumnConfig（型別不符即擋）。
        params：該方法的全域旋鈕（K-匿名 k/l/t/suppression_*、DP accumulated_*/default_delta），
                原樣轉交去識別門面，本橋接不介入其語意。
        """
        params = params or {}
        m = (method or "").strip().lower()

        if m in _K_ANON_ALIASES:
            if not isinstance(config, ColumnConfig):
                raise PetsError(
                    "ERR_DEID_CONFIG_MISMATCH",
                    "method 為 K-匿名，需搭配 K-匿名欄位設定（ColumnConfig），"
                    "收到的卻不是。請確認上傳的是 K-匿名 config。",
                )
            df_out, _ = run_k_anonymity(df, config=config, **params)
            return df_out

        if m in _DP_ALIASES:
            if not isinstance(config, DPColumnConfig):
                raise PetsError(
                    "ERR_DEID_CONFIG_MISMATCH",
                    "method 為 DP，需搭配 DP 預算設定（DPColumnConfig），"
                    "收到的卻不是。請確認上傳的是 DP config。",
                )
            df_out, _ = run_dp(df, config=config, **params)
            return df_out

        raise PetsError(
            "ERR_DEID_METHOD_UNKNOWN",
            f"不支援的去識別方法 '{method}'，請使用 'k-anon' 或 'dp'。",
        )
