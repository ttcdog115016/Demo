"""遮蔽類動作：雜湊（hash）／正則掃描與替換（regex_replace）。

兩者都繼承 StringAction：空的格子不動、非字串一律先當字串處理。
空格不雜湊是刻意的——整欄空格會雜湊成同一串代號，下游會把它當成「某人出現數千次」
而污染 K-匿名與風險分析；要讓空格也有代號，請自己先排一列 fill_default。
"""

import re
from typing import Any

from app.core.errors import PetsError
from app.engines.anonymization.strategies.masking import hash_mask, validate_hash_algorithm

from ..types import BuildContext
from .base import StringAction, reject_unknown_params, require_text

# 時間戳當鹽的保留字。一律以全小寫嚴格比對：大小寫變體（USE_TIMESTAMP）視為普通鹽值，
# 否則「剛好把鹽取名叫 Use_Timestamp」的人會拿到完全不同的東西卻無從察覺。
TIMESTAMP_SALT_KEYWORD = "use_timestamp"


def resolve_hash_salt(salt: str, default_salt: str | None, timestamp_salt: str) -> str | None:
    """有給 salt 時實際使用的鹽：保留字 use_timestamp → 時間戳；空字串 → .env 預設鹽。

    ★ TTC 2026-11-04：抽出供雜湊預覽端點共用，確保預覽與實際處理用的是同一把鹽。
    """
    if salt == TIMESTAMP_SALT_KEYWORD:
        return timestamp_salt
    return salt or default_salt


class Hash(StringAction):
    """雜湊：假名化，輸出完整的十六進位字串（不截短）。

    演算法使用去識別化的 hash_mask，可為 sha256、sha3-256 或 sha3-512：
    params 有給 algorithm 就用它（★ TTC 2026-11-04：可逐欄不同），
    沒給則用設定檔區塊層的 algorithm（整份清單的預設，見 BuildContext）。

    鹽是選填的，依序取三步：
      1. salt 參數有給 → 用它；填保留字 use_timestamp 則改用系統取的時間戳
         （整份清單共用同一個，見 BuildContext）
      2. 沒給或給空字串 → 用 .env 的 OPEN_PETS_DEFAULT_SALT
      3. .env 也沒設 → 不加鹽，直接對值本身做雜湊
    三步都不報錯、不警示：加不加鹽由呼叫方決定。
    """

    name = "hash"
    needs_context = True

    def __init__(self, params: dict[str, Any], context: BuildContext) -> None:
        reject_unknown_params(self.name, params, ("salt", "algorithm"))
        if "algorithm" in params:
            self.algorithm = validate_hash_algorithm(require_text(self.name, params, "algorithm"))
        else:
            self.algorithm = context.algorithm
        if "salt" not in params:
            self.salt = context.default_salt
            return
        salt = require_text(self.name, params, "salt", allow_empty=True)
        self.salt = resolve_hash_salt(salt, context.default_salt, context.timestamp_salt)

    def transform_text(self, text: str) -> str:
        return hash_mask(text, self.salt, self.algorithm)


class RegexReplace(StringAction):
    """正則掃描與替換：把命中的那一段換成指定的字，其餘的字留著。

    一格裡符合的全部換掉，不是只換第一個；找不到符合的就不動、也不報錯
    （那是資料本身沒有這種樣式，不是設定寫錯）。
    replacement 可以是空字串＝把命中的那段刪掉（例如 pattern="\\d" 即為移除所有數字）。

    不內建手機／Email 之類的樣式庫：規格沒有這回事，正則式由呼叫方自己寫。
    """

    name = "regex_replace"

    def __init__(self, params: dict[str, Any]) -> None:
        reject_unknown_params(self.name, params, ("pattern", "replacement"))
        pattern = require_text(self.name, params, "pattern")
        self.replacement = require_text(self.name, params, "replacement", allow_empty=True)
        try:
            # 開跑前就編譯：正則式寫錯屬設定寫錯，要在動到資料之前擋下，
            # 而不是每一格重編譯一次、跑到一半才爆。
            self.pattern = re.compile(pattern)
        except re.error as exc:
            raise PetsError(
                "ERR_PREPROCESS_PARAM_INVALID",
                f"功能 '{self.name}' 的 pattern 不是合法的正則式：{exc}",
            ) from exc
        # ★ TTC 2026-11-02：replacement 也在開跑前檢查（引用不存在的群組、不完整的跳脫）。
        #   對空字串套用即會解析替換字串；原本要等命中第一格才 re.error，前面步驟已跑過、API 回 500。
        try:
            self.pattern.sub(self.replacement, "")
        except (re.error, IndexError) as exc:
            raise PetsError(
                "ERR_PREPROCESS_PARAM_INVALID",
                f"功能 '{self.name}' 的 replacement 不是合法的替換字串：{exc}",
            ) from exc

    def transform_text(self, text: str) -> str:
        return self.pattern.sub(self.replacement, text)
