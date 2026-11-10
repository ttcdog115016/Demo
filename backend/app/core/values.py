"""值的正規化（★ TTC 2026-11-02）。

CSV 讀入時，整數欄位只要有一格空值就會變成 float（100 → 100.0）。直接 str(val) 會得到 "100.0"，
與泛化矩陣的鍵 "100" 對不上、雜湊結果也與同一個人在沒有空值的檔案中不同。
比對或雜湊前先把「整數值的浮點數」寫回整數字串。
"""
import math
from typing import Any


def canonical_text(val: Any) -> str:
    """整數值的浮點數（100.0）寫成 "100"；其餘照 str()。"""
    if isinstance(val, float) and math.isfinite(val) and val.is_integer():
        return str(int(val))
    return str(val)
