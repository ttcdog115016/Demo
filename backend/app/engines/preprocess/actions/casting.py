"""型態轉換動作（cast）。"""

import math
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.core.errors import PetsError

from .base import (
    ValueAction,
    optional_choice,
    reject_param,
    reject_unknown_params,
    require_choice,
    require_value_list,
)

# 從髒字串裡撈數字時保留的字元：數字本身、負號與小數點。
# 負號與小數點是數值的一部分（-25、12.5），其餘黏著的文字（"歲"、"NT$"、千分位逗號）
# 都不是數值的一部分，濾掉後不改變數值大小。
_NUMBER_CHARS = frozenset("0123456789.-")


class Cast(ValueAction):
    """型態轉換：只換型態、不改數值。

    type=int／float
        先從值裡取出數字（"25歲" → 25、"NT$3,000" → 3000），
        取不出數字的（"25-30"）**原樣不動、不報錯**：那是某一格值很髒，
        不是用錯功能，而且沒有任何一種轉法算得上正確。
        轉 int 時遇到有小數的值，未給 rounding 就報錯——捨去或進位是另一件事，
        不替呼叫方決定；要取整就明講 floor／round／ceil。
    type=bool
        對照表由呼叫方給（true_values／false_values 兩張清單，必填）：
        「無」是「否」還是「沒資料」只有資料的主人知道，我方不寫死。
        比對忽略大小寫；兩張清單以外的值原樣不動。
    """

    name = "cast"

    def __init__(self, params: dict[str, Any]) -> None:
        reject_unknown_params(
            self.name, params, ("type", "rounding", "true_values", "false_values")
        )
        self.type = require_choice(self.name, params, "type", ("int", "float", "bool"))
        self.rounding: str | None = None
        self.true_values: list[str] = []
        self.false_values: list[str] = []

        if self.type == "bool":
            reject_param(self.name, params, "rounding", "只在 type=int 時有意義")
            self.true_values = require_value_list(self.name, params, "true_values")
            self.false_values = require_value_list(self.name, params, "false_values")
            overlap = sorted(set(self.true_values) & set(self.false_values))
            if overlap:
                raise PetsError(
                    "ERR_PREPROCESS_PARAM_INVALID",
                    f"功能 '{self.name}' 的 true_values 與 false_values 有重複的值 {overlap}；"
                    f"同一個值不可能既是真又是假（比對忽略大小寫）。",
                )
            return

        for name in ("true_values", "false_values"):
            reject_param(self.name, params, name, "只在 type=bool 時有意義")
        if self.type == "float":
            reject_param(self.name, params, "rounding", "只在 type=int 時有意義")
        else:
            self.rounding = optional_choice(
                self.name, params, "rounding", ("floor", "round", "ceil")
            )

    def transform_value(self, value: Any) -> Any:
        if self.type == "bool":
            return self._to_bool(value)
        number = self._to_number(value)
        if number is None:
            return value
        return float(number) if self.type == "float" else self._to_int(number)

    def _to_bool(self, value: Any) -> Any:
        text = str(value).lower()
        if text in self.true_values:
            return True
        if text in self.false_values:
            return False
        return value

    def _to_number(self, value: Any) -> float | None:
        """把一格值看成數字；看不出來就回 None（代表原樣不動）。"""
        if isinstance(value, int | float) and not isinstance(value, bool):
            # 本來就是數字的不繞字串：str(1e20) 會變成 "1e+20"，濾字元反而拿到錯的數。
            return float(value)
        # ★ TTC 2026-11-02：本身就是合法數字字串（含科學記號 1e5、1.5e3）先直接解析；
        #   原本一律只留數字字元，"1e5" 被濾成 "15"、"1.5e3" 變 1.53。
        text = str(value).strip()
        try:
            number = float(text)
            if math.isfinite(number):
                return number
        except ValueError:
            pass
        digits = "".join(char for char in text if char in _NUMBER_CHARS)
        try:
            return float(digits)
        except ValueError:
            return None

    def _to_int(self, number: float) -> int:
        if number.is_integer():
            return int(number)
        if self.rounding == "floor":
            return math.floor(number)
        if self.rounding == "ceil":
            return math.ceil(number)
        if self.rounding == "round":
            # 不用內建 round()：它是銀行家捨入（round(2.5) 得 2），與一般認知的
            # 四捨五入不同；以 Decimal 指定 ROUND_HALF_UP，負數則對稱地捨入（-2.5 → -3）。
            return int(Decimal(str(number)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
        raise PetsError(
            "ERR_PREPROCESS_TYPE_MISMATCH",
            f"功能 '{self.name}' 要轉成 int，但遇到有小數的值 {number}；"
            f"要捨去或進位請指定 rounding（floor／round／ceil）。",
        )
