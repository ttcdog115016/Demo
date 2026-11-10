"""前處理主流程（Pipeline）。

Preprocessor 串起「前置驗證 → 由上往下逐步套用」，每一步委派給注入的動作。

處理流程：
    Step 0 → 前置驗證：清單引用的欄位資料裡都要有（fail fast）
    Step 1 → 依排定順序逐步套用，每一步都用當下的資料

清單的順序即語意：同一欄位先去空白再截斷，與先截斷再去空白，結果本來就不同，
系統照著寫的順序做，不重排、不合併。
"""

import logging

import pandas as pd

from app.core.config import PreprocessConfig
from app.core.cancellation import check_cancelled
from app.core.errors import PetsError

from .types import PlannedAction
from .validation import PreprocessValidator

# 只記流程走到哪一步，不記任何欄位值：前處理經手的是尚未去識別化的原始資料，
# 把值寫進日誌等於把個資複製到另一個檔案。
logger = logging.getLogger(__name__)


class Preprocessor:
    """資料前處理器（無狀態：不留存資料，處理完即回傳新的 DataFrame）。

    參數說明：
        config : 前處理清單（來自設定檔），保留供呼叫端查閱本次用的設定
        validator : 前置驗證（欄位名稱存在）
        plan   : 已排定並驗過參數的步驟，由 PreprocessorFactory 攤平設定檔而來
    """

    def __init__(
        self,
        config: PreprocessConfig,
        *,
        # ── 注入的協作者：一律由 PreprocessorFactory 組好傳入，此處不自備預設 ──
        validator: PreprocessValidator,
        plan: list[PlannedAction],
    ):
        self.config = config
        self._validator = validator
        self._plan = plan

    def run(self, df: pd.DataFrame) -> pd.DataFrame:
        # ── Step 0：前置驗證（fail fast）──────────────────────────────────
        # 放在最前面 → 欄名對不上直接擋，不會出現前幾列已經改過資料才失敗的情況。
        self._validator.validate(df, self.config)

        # ── Step 1：由上往下逐步套用 ────────────────────────────────────────
        logger.info("前處理開始，共 %d 個步驟，資料 %d 列", len(self._plan), len(df))
        df_out = df.copy()
        for step in self._plan:
            check_cancelled()  # ★ TTC 2026-10-31
            # 前處理不產報告，一旦中途失敗，只從錯誤訊息看不出前面已經跑過哪幾步。
            logger.debug("套用 %s", step.where)
            try:
                df_out = step.action.apply(df_out, step.column)
            except PetsError as exc:
                # 動作只知道自己遇到什麼，補上它在清單裡的位置才找得到要改哪一行。
                raise PetsError(exc.error_code, f"{step.where}：{exc.message}") from exc
        logger.info("前處理完成，%d 個步驟全部套用", len(self._plan))
        return df_out
