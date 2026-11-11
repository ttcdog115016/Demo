"""類別欄位的加噪機制：k-元隨機回應（k-Randomized Response, k-RR）。

原理：設欄位有 k 種類別、隱私預算 ε，
    保留原值機率 p = e^ε / (e^ε + k − 1)；
    否則從其餘 k−1 種類別中「等機率」挑一個替換。
輸出永遠是原本的合法類別之一（不會輸出無意義的噪聲小數）。

特性：純 ε 機制（不需 δ / sensitivity）；k=2 時即等價於 Binary（Randomized Response）；
可吃任何標籤（文字或數字，數字型類別亦適用）；numpy 全欄向量化，空值（NaN）維持不變。
"""
import numpy as np
import pandas as pd


class KRandomizedResponse:
    """k-元隨機回應：在類別集合上以 ε 控制的機率翻面。"""

    def apply(self, series: pd.Series, epsilon: float) -> pd.Series:
        # 以資料實際出現的值作為類別集合。
        # factorize 只用來把標籤轉成索引以利向量化，抽樣後會映射回原始標籤輸出。
        codes, uniques = pd.factorize(series)  # NaN → code -1
        k = len(uniques)
        # 類別數 < 2：沒有其他值可翻，原樣返回（k=1 或全空）。
        if k < 2:
            return series.copy()

        n = len(series)
        # ★ TTC 2026-11-02：改寫成不會溢位的等價式。原式 e^ε/(e^ε+k−1) 在 ε≳710 時成 inf/inf＝NaN，
        #   保留機率比較全為假、每格都被換掉，二元欄位等於整欄反轉（直接還原原值）。
        p = 1.0 / (1.0 + (k - 1) * np.exp(-epsilon))
        rng = np.random.default_rng()

        keep = rng.random(n) < p
        # 從「其餘 k−1 種」等機率挑一個：抽 [0, k−1) 再對 >= 原碼者 +1，即跳過自己。
        alt = rng.integers(0, k - 1, size=n)
        alt = alt + (alt >= codes)
        out_codes = np.where(keep, codes, alt)

        # 映射回原始標籤；NaN 位置（原 code == -1）維持 NaN。
        out_codes = np.clip(out_codes, 0, k - 1)  # 防越界（NaN 列稍後覆寫）
        result = pd.Series(uniques[out_codes], index=series.index, name=series.name)
        result[codes == -1] = np.nan
        return result
