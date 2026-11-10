"""遮蔽 / 雜湊策略（FullMask / PartialMask / HashMask）。

底層為 module 函式 `apply_masking`、`hash_mask`：
策略類別是它們的薄包裝，函式本身也供其他步驟（如識別欄位假名化）直接呼叫。
"""
import hashlib
import hmac
from abc import ABC, abstractmethod
from typing import Any

import pandas as pd

from app.core.values import canonical_text

from ..validation import validate_choice_param

# 演算法名稱 → hashlib 的雜湊建構函式。三者皆在 Python 標準庫內，不新增任何相依。
# 名稱一律小寫，與設定檔寫法一致；新增演算法只需在此登記一行。
HASH_ALGORITHMS = {
    "sha256": hashlib.sha256,
    "sha3-256": hashlib.sha3_256,
    "sha3-512": hashlib.sha3_512,
}

# 未指定演算法時採用的預設。
DEFAULT_HASH_ALGORITHM = "sha3-256"


def validate_hash_algorithm(algorithm: str) -> str:
    """雜湊演算法名稱驗證（fail fast）：非法值拋錯並列出合法選項，不靜默退回預設。"""
    return validate_choice_param("algorithm", algorithm, tuple(HASH_ALGORITHMS))


def hash_mask(
    val: Any, salt: str | None, algorithm: str = DEFAULT_HASH_ALGORITHM
) -> str:
    """對值進行雜湊遮蔽，回傳完整的十六進位字串（不截短）。

    鹽為選填：有給就走 HMAC，沒給（None 或空字串）就對值本身做雜湊。給不給由
    呼叫端決定——本函式不代為挑一把鹽，也不因為沒鹽而拒絕處理。

    輸出長度隨演算法而定：sha256 與 sha3-256 為 64 碼，sha3-512 為 128 碼。
    """
    if val is None or pd.isna(val):
        return ""
    digestmod = HASH_ALGORITHMS.get(algorithm)
    if digestmod is None:
        # 大小寫變體（"SHA3-256"）由驗證函式正規化後取回；真的寫錯才拋錯
        digestmod = HASH_ALGORITHMS[validate_hash_algorithm(algorithm)]
    val_bytes = canonical_text(val).encode("utf-8")  # ★ TTC 2026-11-02：同一識別碼不因欄位有無空值而雜湊不同
    if salt:
        return hmac.new(salt.encode("utf-8"), val_bytes, digestmod).hexdigest()
    return digestmod(val_bytes).hexdigest()


def apply_masking(
    val: Any,
    strategy: str,
    mask_char: str = "*",
    keep_chars: int = 3,
    mode: str = "prefix",
    mask_length: int | None = None,
) -> str:
    """
    字元遮蔽處理。
    strategy="full"    → 全部替換為遮蔽字元
    strategy="partial" → 保留前綴或後綴若干字元，其餘遮蔽

    mask_length 僅對全遮蔽有效：指定後一律輸出該數量的遮蔽字元，使輸出不再隨原值
    長短變化（原值長度本身也是一種資訊，例如信用卡號與身分證號可由星號數量分辨）；
    未指定則沿用原值長度。
    """
    if val is None or pd.isna(val):
        return ""
    val_str = str(val)
    if strategy == "full":
        return mask_char * (mask_length if mask_length else len(val_str))
    elif strategy == "partial":
        if len(val_str) <= keep_chars:
            return mask_char * len(val_str)
        if mode == "prefix":
            return val_str[:keep_chars] + mask_char * (len(val_str) - keep_chars)
        elif mode == "suffix":
            return mask_char * (len(val_str) - keep_chars) + val_str[-keep_chars:]
    return val_str


class MaskingStrategy(ABC):
    """欄位遮蔽策略基底：對一整欄 Series 套用遮蔽，回傳新的 Series。"""

    @abstractmethod
    def apply(self, series: pd.Series) -> pd.Series:  # pragma: no cover - 介面
        ...


class FullMask(MaskingStrategy):
    """全遮蔽：整個值換成遮蔽字元。

    未指定 mask_length 時輸出長度等於原值長度；指定後一律輸出固定
    數量，連原值有幾個字都不外露。
    """

    def __init__(self, mask_char: str = "*", mask_length: int | None = None):
        self.mask_char = mask_char or "*"
        self.mask_length = mask_length

    def apply(self, series: pd.Series) -> pd.Series:
        c, n = self.mask_char, self.mask_length
        return series.apply(
            lambda x: apply_masking(x, strategy="full", mask_char=c, mask_length=n)
        )


class PartialMask(MaskingStrategy):
    """部分遮蔽：保留前綴或後綴若干字元，其餘遮蔽。"""

    def __init__(self, keep_chars: int = 3, mode: str = "prefix", mask_char: str = "*"):
        self.keep_chars = keep_chars
        self.mode = mode
        self.mask_char = mask_char or "*"

    def apply(self, series: pd.Series) -> pd.Series:
        kc, m, c = self.keep_chars, self.mode, self.mask_char
        return series.apply(
            lambda x: apply_masking(
                x, strategy="partial", keep_chars=kc, mode=m, mask_char=c
            )
        )


class HashMask(MaskingStrategy):
    """雜湊遮蔽（假名化）：有鹽走 HMAC，沒鹽對值本身做雜湊。

    演算法於建構時驗證（fail fast），不留到逐格運算時才發現名稱寫錯。
    """

    def __init__(self, salt: str | None, algorithm: str = DEFAULT_HASH_ALGORITHM):
        self.salt = salt
        self.algorithm = validate_hash_algorithm(algorithm)

    def apply(self, series: pd.Series) -> pd.Series:
        s, a = self.salt, self.algorithm
        return series.apply(lambda x: hash_mask(x, s, a))
