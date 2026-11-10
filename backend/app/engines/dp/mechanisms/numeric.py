"""數值欄位的加法雜訊機制：離散型（整數進、整數出）。

依規格採「基於整數的離散型差分隱私」，機制採用 diffprivlib 的離散版本：
    δ=0 → 離散型 Laplace（文獻亦稱 double geometric，diffprivlib 的 Geometric）
    δ>0 → 離散型 Gaussian（CKS 離散高斯，diffprivlib 的 GaussianDiscrete）
兩者的 value 與 sensitivity 都強制為整數，型別上就擋住浮點雜訊。

本工人只負責「整數序列加噪」——把原始值換算成整數個最小單位、加噪後再換算回去，
是呼叫端的事（見 app.engines.dp.discretize）。日期欄的機制（DatetimeNoiser）復用本工人，
故日期加噪同樣是離散的。

輸出仍以 float dtype 承載（值為整數），空值（NaN）跳過不加噪。
"""
import pandas as pd
from diffprivlib.mechanisms import GaussianDiscrete, Geometric


class NumericNoiser:
    """對整數刻度的 Series 逐格套用離散型 Laplace / Gaussian 雜訊。"""

    def apply(
        self, series: pd.Series, epsilon: float, delta: float, sensitivity: float
    ) -> pd.Series:
        # 兩個離散機制都要求 sensitivity 為整數；呼叫端（SensitivityResolver）已換算成
        # 整數個最小單位，此處僅作型別轉換，不改動大小。
        sens = int(sensitivity)
        if delta > 0:
            mech = GaussianDiscrete(epsilon=epsilon, delta=delta, sensitivity=sens)
        else:
            mech = Geometric(epsilon=epsilon, sensitivity=sens)
        return series.apply(
            lambda x: float(mech.randomise(int(x))) if not pd.isna(x) else x
        )
