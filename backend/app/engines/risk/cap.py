"""正確歸因機率（CAP, Correct Attribute Probability）計算。

規格 §3(1)B：分別產生前／後資料之 CAP 風險評估並對比差異——與三攻擊平行的
獨立指標（無 ctrl 對照，就是前後對比），演算法由工具內建（規格未指定）。

CAP 為分組式度量，QI 近乎唯一時
（如連續型數值加噪、值仍唯一）前後皆趨近 1.0，屬先天性質。規格只要求報值，
故如實回傳 cap_before／cap_after 即可，不自動判讀成因、不給去識別化建議。
"""

import pandas as pd


class CAPCalculator:
    """CAP 計算（無狀態）：給定一組 QI，推斷出正確敏感值的平均機率。"""

    def calculate(
        self, df_in: pd.DataFrame, qi_cols: list[str], sensitive_col: str
    ) -> float:
        """CAP ＝ Σ（各 QI 等價類中出現最多次的敏感值次數）÷ 總列數。

        每組的貢獻是「猜中率 × 組大小」，兩者的組大小相消後就等於該組眾數的出現次數，
        故以一次分組計數再取每組最大值加總算出。
        """
        n_total = len(df_in)
        if n_total == 0:
            return 0.0

        # 敏感值為缺值的列不算進分子（缺值不是攻擊者猜得中的「值」），但仍留在分母。
        attributable = df_in[df_in[sensitive_col].notna()]
        if attributable.empty:
            return 0.0

        # 兩次分組都要 dropna=False：QI 含缺值（NaN）的列須自成一組，否則會被丟出
        # 分子，但分母仍含它們，導致 CAP 被系統性低估（往「看起來較安全」偏）。
        pair_counts = attributable.groupby(
            qi_cols + [sensitive_col], dropna=False
        ).size()
        qi_levels = list(range(len(qi_cols)))
        best_per_group = pair_counts.groupby(level=qi_levels, dropna=False).max()
        return float(best_per_group.sum()) / n_total
