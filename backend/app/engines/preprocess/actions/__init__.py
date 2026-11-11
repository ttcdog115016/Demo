"""前處理的各項動作（一個功能一個類別，依性質分檔）。"""

from .base import ColumnAction, PreprocessAction, StringAction, ValueAction
from .casting import Cast
from .masking import Hash, RegexReplace
from .missing import DropNulls, FillDefault, Impute
from .numeric import Clamp, is_numeric_column, require_numeric_column
from .strings import AnchorTruncate, Normalize, Slice, Trim

__all__ = [
    # 介面
    "PreprocessAction",
    "ColumnAction",
    "ValueAction",
    "StringAction",
    # 字串類
    "Trim",
    "Slice",
    "AnchorTruncate",
    "Normalize",
    # 型態轉換
    "Cast",
    # 缺失值類
    "DropNulls",
    "FillDefault",
    "Impute",
    # 數值類
    "Clamp",
    "is_numeric_column",
    "require_numeric_column",
    # 遮蔽類
    "Hash",
    "RegexReplace",
]
