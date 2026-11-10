"""前處理動作的介面與參數取值工具。

一個動作＝「對指定欄位做一件事」。四層介面由寬到窄：

    PreprocessAction  拿得到整份資料——丟棄缺失值要刪整列，只看單欄辦不到
    ColumnAction      只改該欄的值、不動列數（多數功能屬此）
    ValueAction       逐格處理值：空的格子不動，其餘以原本的型別交給子類
    StringAction      逐格處理文字：同上，但一律先當字串處理

參數在建構時就驗完（工廠於動到資料之前組裝所有動作），符合「擋的檢查要前置」：
清單跑到第 5 列才發現參數寫錯時，前 4 列已經改過資料了。

各功能共通的一條參數規則：**列了某個功能就代表要它做事，跑完等於沒跑的設定一律報錯**。
如 slice 刪 0 個字元、normalize 兩個旋鈕都不給、clamp 上下界都不給、fill_default 填 null，
都不是「做完剛好沒變」，而是設定寫錯，靜默放行只會讓人以為自己設過了。
（值本身沒有可處理的內容——沒有空白可去、找不到錨點——則屬資料，不報錯。）
"""

from abc import ABC, abstractmethod
from typing import Any, ClassVar

import pandas as pd

from app.core.errors import PetsError


def reject_unknown_params(action: str, params: dict[str, Any], allowed: tuple[str, ...]) -> None:
    """不認識的參數一律擋。

    靜默忽略的話，把 count 打成 counts 的人會以為自己設過了，卻拿到沒設過的結果。
    """
    unknown = [key for key in params if key not in allowed]
    if unknown:
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 有不認識的參數 {unknown}；可用的參數為 {list(allowed)}。",
        )


def require_choice(
    action: str, params: dict[str, Any], name: str, choices: tuple[str, ...]
) -> str:
    """取一個必填的固定選項參數。"""
    value = params.get(name)
    if value not in choices:
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 的 {name} 必須是 {list(choices)} 其中之一，收到：{value!r}",
        )
    return value


def require_int(action: str, params: dict[str, Any], name: str, minimum: int = 0) -> int:
    """取一個必填的整數參數（布林值不算整數，擋掉 true/false 誤填）。"""
    value = params.get(name)
    if isinstance(value, bool) or not isinstance(value, int):
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 的 {name} 必須是整數，收到：{value!r}",
        )
    if value < minimum:
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 的 {name} 不可小於 {minimum}，收到：{value}",
        )
    return value


def require_char(action: str, params: dict[str, Any], name: str) -> str:
    """取一個必填的單一字元參數。"""
    value = params.get(name)
    if not isinstance(value, str) or len(value) != 1:
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 的 {name} 必須是單一字元，收到：{value!r}",
        )
    return value


def require_text(
    action: str, params: dict[str, Any], name: str, *, allow_empty: bool = False
) -> str:
    """取一個必填的字串參數（allow_empty 供「換成空字串＝刪掉」這類用途）。"""
    value = params.get(name)
    if not isinstance(value, str) or (not allow_empty and not value):
        wanted = "字串" if allow_empty else "非空字串"
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 的 {name} 必須是{wanted}，收到：{value!r}",
        )
    return value


def require_number(action: str, params: dict[str, Any], name: str) -> float:
    """取一個必填的數值參數（布林值不算數值）。"""
    value = params.get(name)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 的 {name} 必須是數值，收到：{value!r}",
        )
    return value


def optional_number(action: str, params: dict[str, Any], name: str) -> float | None:
    """取一個選填的數值參數；沒寫就是沒寫，寫了就要合法（不靜默忽略錯的值）。"""
    return None if name not in params else require_number(action, params, name)


def optional_choice(
    action: str, params: dict[str, Any], name: str, choices: tuple[str, ...]
) -> str | None:
    """取一個選填的固定選項參數；沒寫回傳 None，寫錯照樣報錯。"""
    return None if name not in params else require_choice(action, params, name, choices)


def require_value(action: str, params: dict[str, Any], name: str) -> Any:
    """取一個必填、不限型別的參數值（型別由設定檔決定，但不接受 null）。

    null 要與「沒寫」分開看：沒寫是漏了，寫 null 是把空值換成空值＝做了等於沒做，
    兩種都屬設定寫錯，訊息要講清楚是哪一種。
    """
    if name not in params:
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 缺少必填的 {name} 參數。",
        )
    if params[name] is None:
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 的 {name} 不可為 null。",
        )
    return params[name]


def require_value_list(action: str, params: dict[str, Any], name: str) -> list[str]:
    """取一個必填的對照清單，並轉成統一小寫的字串（比對時忽略大小寫）。

    設定檔裡寫 `["Y", 1]` 這種混型別的清單是常態，故一律以字串比對；
    清單本身不可為空——空清單代表這個方向永遠對不上，等於沒設。
    """
    value = params.get(name)
    if not isinstance(value, list) or not value:
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 的 {name} 必須是至少含一個值的清單，收到：{value!r}",
        )
    if any(item is None or isinstance(item, list | dict) for item in value):
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 的 {name} 只能列單純的值，收到：{value!r}",
        )
    return [str(item).lower() for item in value]


def reject_param(action: str, params: dict[str, Any], name: str, reason: str) -> None:
    """擋掉「參數本身認得、但在這組設定下無意義」的寫法。

    靜默忽略會讓人以為自己設過了（例如 type=bool 還寫 rounding），故一律報錯。
    """
    if name in params:
        raise PetsError(
            "ERR_PREPROCESS_PARAM_INVALID",
            f"功能 '{action}' 的 {name} 參數{reason}。",
        )


class PreprocessAction(ABC):
    """前處理動作基底：吃整份資料與目標欄位，回傳處理後的資料。

    name 為登記表上的功能名稱，錯誤訊息要指名是哪個功能出的問題，故存為類別屬性。

    needs_context 為 True 的動作，建構時會多收一個 BuildContext（見 types.py）：
    目前只有雜湊的 use_timestamp 需要「整份清單共用同一個時間戳」。
    """

    name: ClassVar[str] = ""
    needs_context: ClassVar[bool] = False

    @abstractmethod
    def apply(self, df: pd.DataFrame, column: str) -> pd.DataFrame:  # pragma: no cover - 介面
        ...


class ColumnAction(PreprocessAction):
    """只改該欄的值、不動列數的動作：子類只需實作 transform()。"""

    def apply(self, df: pd.DataFrame, column: str) -> pd.DataFrame:
        df[column] = self.transform(df[column])
        return df

    @abstractmethod
    def transform(self, series: pd.Series) -> pd.Series:  # pragma: no cover - 介面
        ...


class ValueAction(ColumnAction):
    """逐格處理值的動作：子類只需實作 transform_value()，值以原本的型別傳入。

    空的格子不動——沒有資料的格子沒有值可處理，補值是第 6～8 項功能的事。
    """

    def transform(self, series: pd.Series) -> pd.Series:
        return series.map(lambda v: v if pd.isna(v) else self.transform_value(v))

    @abstractmethod
    def transform_value(self, value: Any) -> Any:  # pragma: no cover - 介面
        ...


class StringAction(ValueAction):
    """逐格處理文字的動作：子類只需實作 transform_text()。

    在 ValueAction 的「空的格子不動」之上再加一條：非字串一律先當字串處理——
    會員編號常被讀成數字，限定字串欄會擋掉正常用法。
    """

    def transform_value(self, value: Any) -> str:
        return self.transform_text(str(value))

    @abstractmethod
    def transform_text(self, text: str) -> str:  # pragma: no cover - 介面
        ...
