"""字串類動作：去空白（trim）／截斷（slice）／相對保留與截斷（anchor_truncate）／
文字正規化（normalize）。"""

from typing import Any

from app.core.errors import PetsError

from .base import (
    StringAction,
    optional_choice,
    reject_unknown_params,
    require_char,
    require_choice,
    require_int,
)

# 去空白的清除對象：半形空格、Tab、換行（含歸位字元）、全形空格、零寬字元。
# 全形空格與零寬字元肉眼看不出來，卻會讓兩筆「一樣」的資料在後續比對時被當成不同值，
# 故一併視為空白；後五個以字碼列出，直接打在原始碼裡會分不出有幾個字元。
WHITESPACE_CHARS = "".join(
    chr(code)
    for code in (0x20, 0x09, 0x0D, 0x0A, 0x3000, 0x200B, 0x200C, 0x200D, 0xFEFF)
)

_REMOVE_ALL_WHITESPACE = str.maketrans("", "", WHITESPACE_CHARS)


class Trim(StringAction):
    """字串去空白。

    mode 決定要不要動字串中間：
      all   連字串中間的空白也清（"台北 市 大安區" → "台北市大安區"）
      edges 只清頭尾，中間的空白保留
    """

    name = "trim"

    def __init__(self, params: dict[str, Any]) -> None:
        reject_unknown_params(self.name, params, ("mode",))
        self.mode = require_choice(self.name, params, "mode", ("all", "edges"))

    def transform_text(self, text: str) -> str:
        if self.mode == "edges":
            return text.strip(WHITESPACE_CHARS)
        return text.translate(_REMOVE_ALL_WHITESPACE)


class Slice(StringAction):
    """字串截斷：從指定的一側「刪掉」count 個字元（不是保留 count 個）。

    以字元計而非位元組：中文一個字算一個。長度不足時整格變成空字串。
    一列只能挑一邊，要左右都刪就在清單裡排兩列（同一欄位可以出現多次）。
    """

    name = "slice"

    def __init__(self, params: dict[str, Any]) -> None:
        reject_unknown_params(self.name, params, ("side", "count"))
        self.side = require_choice(self.name, params, "side", ("left", "right"))
        # 至少刪一個字元：count=0 是「刪掉 0 個字元」，跑完與沒跑一樣，屬設定寫錯。
        self.count = require_int(self.name, params, "count", minimum=1)

    def transform_text(self, text: str) -> str:
        if self.count >= len(text):
            return ""
        return text[self.count :] if self.side == "left" else text[: -self.count]


class AnchorTruncate(StringAction):
    """相對保留與截斷：以錨點字元為基準，保留該側的 keep 個字元，其餘刪去。

    keep 含錨點本身（keep 為 0 時錨點也會被刪去）；錨點的另一側完全不動。
      direction=before 取由前往後的第一個錨點，保留錨點與它前面的字元
      direction=after  取最後一個錨點，保留錨點與它後面的字元
    找不到錨點時整格不動，也不報錯——那是資料本身沒有這個字元，不是設定寫錯。
    """

    name = "anchor_truncate"

    def __init__(self, params: dict[str, Any]) -> None:
        reject_unknown_params(self.name, params, ("anchor", "direction", "keep"))
        self.anchor = require_char(self.name, params, "anchor")
        self.direction = require_choice(self.name, params, "direction", ("before", "after"))
        self.keep = require_int(self.name, params, "keep")

    def transform_text(self, text: str) -> str:
        if self.direction == "before":
            idx = text.find(self.anchor)
            if idx < 0:
                return text
            kept = text[: idx + 1][-self.keep :] if self.keep else ""
            return kept + text[idx + 1 :]
        idx = text.rfind(self.anchor)
        if idx < 0:
            return text
        return text[:idx] + text[idx:][: self.keep]


# 全形與半形的字碼差：ASCII 的 ! (0x21) 對應全形的 ！(0xFF01)，整段等距排列。
_FULLWIDTH_OFFSET = 0xFEE0

# 只換數字與英文字母：標點交給呼叫方自己決定（中文句子裡的全形逗號轉半形會變得很怪，
# 那是排版偏好不是資料清洗）。
_CONVERTIBLE = [chr(code) for code in [*range(0x30, 0x3A), *range(0x41, 0x5B), *range(0x61, 0x7B)]]

# 全形空格不在上面那段等距排列裡（U+3000 與半形空格差 0x2FE0，不是 _FULLWIDTH_OFFSET），
# 所以另外補一條對映：規格的範例「Ｔａｉｐｅｉ　Ｃｉｔｙ」轉半形後，中間要是半形空格。
_FULLWIDTH_SPACE = "　"

_HALF_TO_FULL = str.maketrans(
    {half: chr(ord(half) + _FULLWIDTH_OFFSET) for half in _CONVERTIBLE} | {" ": _FULLWIDTH_SPACE}
)
_FULL_TO_HALF = str.maketrans(
    {chr(ord(half) + _FULLWIDTH_OFFSET): half for half in _CONVERTIBLE} | {_FULLWIDTH_SPACE: " "}
)


class Normalize(StringAction):
    """文字正規化：大小寫與全半形兩個互不相干的旋鈕。

      case  upper／lower（只影響英文字母）
      width half（全形轉半形）／full（半形轉全形）——雙向都提供

    兩個都選填，可單獨用也可一起用（規格的範例就是兩個一起），但至少要給一個：
    兩個都不給等於沒做事，只可能是設定寫錯。
    兩個一起給時先換大小寫再換全半形；兩者作用的字元互不重疊，順序不影響結果。
    """

    name = "normalize"

    def __init__(self, params: dict[str, Any]) -> None:
        reject_unknown_params(self.name, params, ("case", "width"))
        self.case = optional_choice(self.name, params, "case", ("upper", "lower"))
        self.width = optional_choice(self.name, params, "width", ("half", "full"))
        if self.case is None and self.width is None:
            raise PetsError(
                "ERR_PREPROCESS_PARAM_INVALID",
                f"功能 '{self.name}' 的 case 與 width 至少要給一個。",
            )

    def transform_text(self, text: str) -> str:
        if self.case == "upper":
            text = text.upper()
        elif self.case == "lower":
            text = text.lower()
        if self.width == "half":
            text = text.translate(_FULL_TO_HALF)
        elif self.width == "full":
            text = text.translate(_HALF_TO_FULL)
        return text
