"""加噪機制（Strategy）：一種加噪法一個 class，Series 進、Series 出。

numeric     : 離散型 Laplace（δ=0）/ 離散型 Gaussian（δ>0）— 整數刻度的加法雜訊
categorical : k-RR（k-元隨機回應）— 類別翻面，含 k=2 的 Binary 特例
temporal    : 日期抖動 — 對齊 noise_unit→轉序數→復用數值機制→轉回日期（格式沿用輸入）
              （需一併交回實際採用的 sensitivity 等報告素材，回傳為 DatetimeResult）
"""
from .numeric import NumericNoiser
from .categorical import KRandomizedResponse
from .temporal import DatetimeNoiser

__all__ = ["NumericNoiser", "KRandomizedResponse", "DatetimeNoiser"]
