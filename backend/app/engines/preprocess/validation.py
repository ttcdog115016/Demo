"""前置驗證（PreprocessValidator）：設定檔對照實際資料。

比照 K-匿名 ConfigValidator 與 DP BudgetValidator 的分工：
  自我檢查（清單形狀）→ PreprocessConfig.validate_config()，解析設定檔時即擋
  參數檢查（各功能的參數）→ 各動作的建構子，由工廠在動到資料之前組裝時擋
  交互檢查（設定檔 vs 資料）→ 本模組：清單引用的欄位資料裡必須有

欄位名稱檢查一律前置，整張清單先核對完才開跑：跑到第 5 列才發現欄名打錯時，
前 4 列已經改過資料了。

型別對不上（如對字串欄用內插法）不在此處擋：清單由上往下跑，欄位型別會隨著前面的
動作改變（先 cast 成數值、後面才 clamp），開跑前看到的型別不等於該動作實際遇到的型別，
故由各動作於執行當下判斷。
"""

import pandas as pd

from app.core.config import PreprocessConfig
from app.core.errors import PetsError


class PreprocessValidator:
    """前處理前置驗證器：逐列檢查欄位名稱在資料中存在。"""

    def validate(self, df: pd.DataFrame, config: PreprocessConfig) -> None:
        for idx, entry in enumerate(config.columns):
            if entry.column not in df.columns:
                raise PetsError(
                    "ERR_PREPROCESS_COLUMN_NOT_FOUND",
                    f"前處理清單第 {idx + 1} 列引用了資料中不存在的欄位 "
                    f"'{entry.column}'，請檢查欄位名稱。",
                )
