"""最小單位換算與後處理超界策略（離散型 DP 的前後兩端）。

規格要求「基於整數的離散型差分隱私」，作法分三段：

    加噪前：原始值 ÷ 公開最小單位 → 整數刻度數（to_units）
    加 噪 ：整數進、整數出（各機制自理，見 mechanisms/numeric.py）
    加噪後：整數刻度數 × 最小單位 → 回原單位（from_units）
            → 依 clipping_bounds 與 out_of_bounds_strategy 收回合理範圍（apply_bounds）

最小單位是「公開」參數，故除以它屬穩定轉換（stability transformation）、不消耗隱私預算；
超界處理發生在加噪之後、參數又是事先公開的，屬後處理，依後處理穩定性同樣不影響隱私保證。

除不盡時四捨五入到最近的刻度倍數（偏差最多半格）。半數（.5）依 numpy 慣例進位到偶數，
不採「一律進位」——後者會讓整欄資料系統性地往上偏移。
"""

from decimal import Decimal

import numpy as np
import pandas as pd

# 未指定最小單位時的刻度：1 個原單位（等同「資料本來就以整數為刻度」）。
DEFAULT_MINIMUM_UNIT = 1.0

# 超界處理策略（值取自規格用字）。
STRATEGY_CLAMP = "clamp"
STRATEGY_WRAP = "wrap"
STRATEGY_FOLD = "fold"
STRATEGIES = (STRATEGY_CLAMP, STRATEGY_WRAP, STRATEGY_FOLD)


def to_units(series: pd.Series, minimum_unit: float) -> pd.Series:
    """原始數值 → 整數個最小單位（例：最小單位 0.5 時 [5.5, 15.0, 20.5] → [11, 30, 41]）。

    回傳仍是 float dtype（整數值），如此空值可續以 NaN 表示、不必換成可空整數型別；
    加噪機制取值時再轉 int。無法轉數值者一律成為 NaN（可轉性已由 BudgetValidator 前置把關）。
    """
    scaled = pd.to_numeric(series, errors="coerce") / minimum_unit
    return scaled.round()


def from_units(series: pd.Series, minimum_unit: float) -> pd.Series:
    """整數個最小單位 → 原單位（加噪後回推）。"""
    return series * minimum_unit


def match_unit_precision(series: pd.Series, minimum_unit: float) -> pd.Series:
    """加噪結果依最小單位定輸出之位數：最小單位為整數者輸出整數，為小數者取至其小數位數。

    乘回最小單位後的值為 float（例：43.0、116.70000000000002），寫出時即帶多餘的 .0 或尾數；
    此處依最小單位之小數位數取整，最小單位為整數者轉為可空整數型別，空值仍維持空值。
    超界處理之界線若非最小單位之倍數，值即不在刻度上，此時原樣回傳，不改動界線值。
    """
    decimals = max(0, -Decimal(str(minimum_unit)).normalize().as_tuple().exponent)
    rounded = series.round(decimals)
    values, targets = series.dropna(), rounded.dropna()
    if not np.allclose(values, targets, rtol=0, atol=minimum_unit * 1e-6):
        return series
    return rounded.astype("Int64") if decimals == 0 else rounded


def apply_bounds(
    series: pd.Series,
    bounds: tuple[float, float] | None,
    strategy: str | None,
) -> pd.Series:
    """把超出 clipping_bounds 的加噪結果依策略收回範圍內；未設界線則原樣回傳。

    三種策略（範圍 0~100 的對照：105 → clamp 100／fold 95／wrap 5）：
      clamp：截斷至最近的邊界值。
      fold ：以邊界為鏡面反射（低於下界取 2×下界−值、高於上界取 2×上界−值），
             反射後若仍在範圍外就繼續折，直到落進範圍——「折到底」是 folded 機制定義的一部分，
             此處以三角波的封閉式一次算完，效果與逐次遞迴相同。
      wrap ：對範圍寬度取模，等同「值 ± (max−min) 加減到落進範圍為止」，繞很多圈也一次到位。
             頭尾視為同一點（規格舉例的一天內秒數 0~86400，86400 即隔天 0 點），
             故寬度為 max−min。

    空值不參與運算（維持空值）。上下界相等時範圍退化成一個點，三種策略皆回該點。
    """
    if bounds is None:
        return series

    low, high = bounds
    width = high - low
    if width == 0:
        # 範圍退化成單點：取模與反射都沒有意義，直接回該點（空值仍維持空值）。
        return series.where(series.isna(), low)

    if strategy == STRATEGY_WRAP:
        return low + np.mod(series - low, width)
    if strategy == STRATEGY_FOLD:
        # 三角波：以 2×寬度 為週期取模後，取「距離下界」與「距離上界的鏡像」中較小者。
        offset = np.mod(series - low, 2 * width)
        return low + np.minimum(offset, 2 * width - offset)
    # 未指定策略時採 clamp：三者中唯一不把值搬到範圍另一端的做法，偏差最小。
    return series.clip(lower=low, upper=high)
