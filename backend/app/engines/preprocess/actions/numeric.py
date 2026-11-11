"""數值類動作：上下界截斷（clamp），以及「這一欄是不是數值欄」的共同判斷。

判斷放這裡而不是前置驗證：清單由上往下跑，欄位型別會被前面的 cast 改掉，
開跑前看到的型別不算數，故由需要數值的動作（clamp、impute 的內插／平均）
在執行當下呼叫 require_numeric_column()。
"""

from typing import Any

import pandas as pd

from app.core.errors import PetsError

from .base import ColumnAction, optional_number, reject_unknown_params


def is_numeric_column(series: pd.Series) -> bool:
    """整欄是不是數值。

    除了 pandas 認定的數值型別，也接受「型別是 object、但非空的值全都是數字」——
    cast 逐格轉出來的欄位，只要其中一格是規格說的「原樣不動」（如 "25-30"），
    整欄就會落成 object，此時仍應由值本身決定是不是數值欄。
    布林不算數值：True/False 雖然可比大小，但截斷或取平均沒有意義。
    """
    if pd.api.types.is_bool_dtype(series):
        return False
    if pd.api.types.is_numeric_dtype(series):
        return True
    non_null = series.dropna()
    if len(non_null) == 0:
        return False
    return all(
        isinstance(value, int | float) and not isinstance(value, bool) for value in non_null
    )


def require_numeric_column(action: str, series: pd.Series) -> pd.Series:
    """要求該欄是數值欄，並回傳可直接運算的數值序列；不是就報錯。

    這是規格唯一明示的報錯情形（「對字串使用內插法或平均值」）的實作點，
    屬「用錯功能」而非「值很髒」，故報 TYPE_MISMATCH 而不是原樣不動。
    """
    if not is_numeric_column(series):
        raise PetsError(
            "ERR_PREPROCESS_TYPE_MISMATCH",
            f"功能 '{action}' 只能用在數值欄，這一欄的內容不是數值；"
            f"若原始資料是數字字串，請先在清單裡排一列 cast。",
        )
    if pd.api.types.is_numeric_dtype(series):
        return series
    return pd.to_numeric(series)


class Clamp(ColumnAction):
    """上下界截斷：超出範圍的值拉回邊界值。

    min／max 兩個都選填，但至少要給一個——兩個都不給等於沒做事，只可能是設定寫錯。
    只給 max 就只壓上界、只給 min 就只抬下界。
    剛好等於邊界值的不動（規格說的是「超出」範圍），空的格子也不動（填值是別的功能的事）。
    """

    name = "clamp"

    def __init__(self, params: dict[str, Any]) -> None:
        reject_unknown_params(self.name, params, ("min", "max"))
        self.minimum = optional_number(self.name, params, "min")
        self.maximum = optional_number(self.name, params, "max")
        if self.minimum is None and self.maximum is None:
            raise PetsError(
                "ERR_PREPROCESS_PARAM_INVALID",
                f"功能 '{self.name}' 的 min 與 max 至少要給一個。",
            )
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise PetsError(
                "ERR_PREPROCESS_PARAM_INVALID",
                f"功能 '{self.name}' 的 min（{self.minimum}）不可大於 max（{self.maximum}）。",
            )

    def transform(self, series: pd.Series) -> pd.Series:
        # clip 不動 NaN，故空的格子自然保持空的。
        return require_numeric_column(self.name, series).clip(
            lower=self.minimum, upper=self.maximum
        )
