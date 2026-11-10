"""缺失值類動作：丟棄缺失值（drop_nulls）／預設值填充（fill_default）／策略填充（impute）。

「空值」的定義由規格自己給定：第 7 項那句「空字串（""）將被視為有效資料」＝
**空字串不算空值**，只有那一格根本沒資料（CSV 兩個逗號之間空的、SQLite NULL）才算。
此定義三個功能共用。
"""

from typing import Any

import pandas as pd

from .base import (
    ColumnAction,
    PreprocessAction,
    reject_unknown_params,
    require_choice,
    require_value,
)
from .numeric import is_numeric_column, require_numeric_column


class DropNulls(PreprocessAction):
    """丟棄缺失值：指定的那一欄為空，就刪掉整列。

    只看指定的欄位，其他欄位是不是空的不管；要多欄一起管就對每個欄位各排一列。
    無參數——規格沒有可調的東西，多寫的參數一律擋下。
    """

    name = "drop_nulls"

    def __init__(self, params: dict[str, Any]) -> None:
        reject_unknown_params(self.name, params, ())

    def apply(self, df: pd.DataFrame, column: str) -> pd.DataFrame:
        # 重排索引：刪列後索引會斷號，後續動作與輸出都以「第幾列」示人，斷號徒增困惑。
        return df[df[column].notna()].reset_index(drop=True)


class FillDefault(ColumnAction):
    """預設值填充：空的格子填入指定的值，設定檔寫什麼型別就填什麼。

    空字串不動（規格明定它是有效資料）；value 不可為 null——把空值換成空值等於沒做，
    只可能是設定寫錯（見 require_value）。
    """

    name = "fill_default"

    def __init__(self, params: dict[str, Any]) -> None:
        reject_unknown_params(self.name, params, ("value",))
        self.value = require_value(self.name, params, "value")

    def transform(self, series: pd.Series) -> pd.Series:
        return series.fillna(self.value)


class Impute(ColumnAction):
    """策略填充：以四種策略之一補上空的格子。

        ffill       用前一格的值補
        bfill       用後一格的值補
        interpolate 前後都有有效值時線性內插（連續空格會補出不同的值）
        mean        整欄有效值的平均

    型別限制：interpolate／mean 只能用在數值欄，用在字串欄直接報錯——這是規格開頭
    唯一明示的報錯例子（「對字串使用內插法或平均值」）。ffill／bfill 是搬前後那格的值，
    任何型別都能用。

    規格「若無有效值則視為 0 或空字串」是四種策略共通的通則：那一側整個找不到有效值時
    （第一列就空的 ffill、最後一列就空的 bfill、整欄全空的 mean、只有一側有值的內插），
    數值欄補 0、字串欄補空字串。`25, 空, 空, 28` 前後都找得到值，不算無有效值。

    算出來有小數就填小數，不取整（`25, 空, 空, 24` → 24.67、24.33）；
    要整數請自己再排一列 cast 並帶 rounding。
    """

    name = "impute"

    # 需要整欄一起算的兩種策略：只能用在數值欄。
    NUMERIC_ONLY = ("interpolate", "mean")

    def __init__(self, params: dict[str, Any]) -> None:
        reject_unknown_params(self.name, params, ("strategy",))
        self.strategy = require_choice(
            self.name, params, "strategy", ("ffill", "bfill", "interpolate", "mean")
        )

    def transform(self, series: pd.Series) -> pd.Series:
        if self.strategy in self.NUMERIC_ONLY:
            numeric = require_numeric_column(self.name, series)
            if self.strategy == "mean":
                average = numeric.mean()
                return numeric.fillna(0 if pd.isna(average) else average)
            # limit_area="inside"：只補前後都有有效值的空格。邊緣的空格有一側整個找不到
            # 有效值，屬上面說的「無有效值」，交給下面的 fillna 補 0。
            return numeric.interpolate(method="linear", limit_area="inside").fillna(0)

        filled = series.ffill() if self.strategy == "ffill" else series.bfill()
        return filled.fillna(self._empty_value(series))

    def _empty_value(self, series: pd.Series) -> Any:
        """那一側整個找不到有效值時要補的東西：數值欄 0、字串欄空字串。"""
        return 0 if is_numeric_column(series) else ""
