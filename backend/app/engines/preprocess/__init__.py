"""資料前處理引擎（模組化）。

對外門面：`run_preprocess()`。內部拆分為
  pipeline / validation / factory / types / actions
各模組（Strategy + Pipeline + Factory + DI，與 K-匿名、差分隱私兩引擎同範式）。

設定形狀為一張有序的清單，每列是「欄位名稱 ＋ 依序要做的動作」：
清單由上往下跑，每一步都用當下的資料，同一個欄位可以出現多次。
清單住 app.core.config 的 PreprocessConfig，與另外三種設定同一個地方。

各項功能彼此獨立：每個動作只管自己的輸入、參數、輸出與邊界，
順序造成的結果差異屬呼叫方安排清單的結果，引擎不代為重排或合併。
"""

import pandas as pd

from app.core.config import PreprocessConfig

from .actions import (
    AnchorTruncate,
    Cast,
    Clamp,
    ColumnAction,
    DropNulls,
    FillDefault,
    Hash,
    Impute,
    Normalize,
    PreprocessAction,
    RegexReplace,
    Slice,
    StringAction,
    Trim,
    ValueAction,
)
from .factory import ACTION_BY_NAME, PreprocessorFactory, build_actions
from .pipeline import Preprocessor
from .types import BuildContext, PlannedAction
from .validation import PreprocessValidator


def run_preprocess(df: pd.DataFrame, config: PreprocessConfig) -> pd.DataFrame:
    """前處理主流程（門面）：由 PreprocessorFactory 組裝並注入工人，再執行。

    逐欄逐項的動作與參數一律由設定檔提供，不另開呼叫端覆蓋參數
    （與 K-匿名、差分隱私同原則）。
    """
    return PreprocessorFactory.create(config).run(df)


__all__ = [
    "run_preprocess",
    # 流程與組裝
    "Preprocessor",
    "PreprocessorFactory",
    "build_actions",
    "ACTION_BY_NAME",
    # 值物件
    "PlannedAction",
    "BuildContext",
    # 工人（OOP 擴充點）
    "PreprocessValidator",
    "PreprocessAction",
    "ColumnAction",
    "ValueAction",
    "StringAction",
    # 11 項功能
    "Trim",
    "Slice",
    "AnchorTruncate",
    "Cast",
    "Normalize",
    "DropNulls",
    "FillDefault",
    "Impute",
    "Clamp",
    "Hash",
    "RegexReplace",
]
