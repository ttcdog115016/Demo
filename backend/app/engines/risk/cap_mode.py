"""CAP 前後對比獨立流程（CapAssessor）。

規格 §3(1)B：分別產生前／後資料之 CAP 風險評估並對比差異。吃「上傳的原始」與
「上傳的處理後」兩份現成資料，引擎不做去識別，只各自算一次 CAP 再對比
（cap_before／cap_after）。

CapAssessor 只算 CAP，不跑攻擊、不做切分。子群體限定由呼叫端事前對前後
兩份各篩一次（值篩，共用 subset 模組）後傳入，故本流程只認「傳進來的就是要評的範圍」。
"""

import pandas as pd

from .types import CapReport
from .validation import RiskInputValidator
from .cap import CAPCalculator


class CapAssessor:
    """CAP 前後對比評估器（無狀態：只吃前後兩份資料，不留存）。"""

    def __init__(
        self,
        qi_cols: list[str],
        sensitive_cols: list[str],
        *,
        validator=None,
        cap=None,
    ):
        self.qi_cols = qi_cols
        self.sensitive_cols = sensitive_cols
        self._validator = validator if validator is not None else RiskInputValidator()
        self._cap = cap if cap is not None else CAPCalculator()

    def run(
        self, original_df: pd.DataFrame, processed_df: pd.DataFrame
    ) -> CapReport:
        qi_cols = self.qi_cols
        sensitive_cols = self.sensitive_cols

        # ── Step 0：降級檢查（QI／敏感欄為空 → -1.0 收據，不拋錯，比照三攻擊）──────
        if len(qi_cols) == 0 or len(sensitive_cols) == 0:
            if len(qi_cols) == 0 and len(sensitive_cols) > 0:
                msg = "警告：您已指定敏感欄位，但準識別符 (QI) 數量為 0，CAP 無法分組，顯示之 -1.0 僅代表無法評估。"
            elif len(sensitive_cols) == 0 and len(qi_cols) > 0:
                msg = "警告：您已指定準識別符 (QI)，但敏感欄位數量為 0，CAP 無歸因目標，顯示之 -1.0 僅代表無法評估。"
            else:
                msg = "警告：準識別符與敏感欄位數量皆為 0，無法計算 CAP，顯示之 -1.0 僅代表無法評估。"
            return CapReport(
                cap_before=-1.0,
                cap_after=-1.0,
                n_original=len(original_df),
                n_processed=len(processed_df),
                message=msg,
            )

        # ── Step 1：前置驗證（欄位存在於前後兩份資料；缺欄 fail fast）──────────────
        self._validator.validate(original_df, processed_df, qi_cols, sensitive_cols)

        # ── Step 2：CAP 前後各算一次（只評第一個敏感欄，與三攻擊推斷性一致）──
        s_col = sensitive_cols[0]
        cap_before = self._cap.calculate(original_df, qi_cols, s_col)
        cap_after = self._cap.calculate(processed_df, qi_cols, s_col)

        msg = f"CAP 前後對比完成。原始: {cap_before:.2f}, 處理後: {cap_after:.2f}。"
        return CapReport(
            cap_before=round(cap_before, 4),
            cap_after=round(cap_after, 4),
            n_original=len(original_df),
            n_processed=len(processed_df),
            message=msg,
        )
