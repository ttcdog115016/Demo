"""敏感度決議（SensitivityResolver）。

離散型 DP 的 sensitivity 與資料同一把尺：資料已換算成「整數個最小單位」，
sensitivity 也必須是整數個最小單位，否則雜訊尺度就算錯了。故：

    使用者申報 → 除以最小單位（他填的是原始單位），除不盡一律無條件進位。
    未申報     → 以換算後資料的 max−min 推導；資料本身已是整數，推導值自然是整數，不必再除。

進位而非四捨五入是刻意的：低估 sensitivity 等於雜訊加不足、隱私保證跳票，
寧可高估（多加一點雜訊）也不冒這個險。
（推導值來自資料本身而非外部值域，屬保守替代方案；報告已逐欄揭露 sensitivity 的
來源是使用者申報還是系統推導，見 types.ColumnBudgetDetail.sensitivity_source。）
"""

import math

import pandas as pd


class SensitivityResolver:
    """決定一個欄位實際使用的 sensitivity（使用者申報優先，缺席才推導）。

    回傳為整數個最小單位——離散機制（離散型 Laplace／Gaussian）只收整數 sensitivity。
    """

    def resolve(
        self, series: pd.Series, declared: float | None, minimum_unit: float = 1.0
    ) -> int:
        if declared is not None:
            # 申報值以原始單位計，換算成刻度數；除不盡無條件進位。
            return max(1, math.ceil(declared / minimum_unit))

        # 以下 series 已是換算後的刻度數，推導值即為整數，不需除以最小單位。
        if pd.api.types.is_numeric_dtype(series):
            val_max = series.max()
            val_min = series.min()
            if pd.isna(val_max) or pd.isna(val_min) or val_max == val_min:
                return 1
            return max(1, math.ceil(val_max - val_min))

        num_uniques = len(series.dropna().unique())
        if num_uniques > 1:
            return num_uniques - 1
        return 1
