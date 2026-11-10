"""抑制策略（列抑制 / 值抑制）。"""
from abc import ABC, abstractmethod
from typing import Any

import numpy as np
import pandas as pd

from .metrics import wildcard_group_sizes
from .types import SuppressionOutcome

# 值抑制的填充方式 → 實際填入的值。
#   star   : 填 "*"（預設）
#   missing: 填空值——對應「將單元格設為缺失」的抑制表示法，且不必為了塞字串而把
#            數值欄轉成文字欄（空值本來就是各型別的合法成員）
CELL_FILL_VALUES = {
    "star": "*",
    "missing": np.nan,
}

# 報告用的中文說法（品質報告要說清楚被抑制的格子填了什麼）
CELL_FILL_LABELS = {
    "star": "星號 *",
    "missing": "空值",
}


def suppress_cells(df: pd.DataFrame, mask: pd.Series, col: str, fill_value: Any) -> None:
    """
    將 col 欄位中 mask 為 True 的儲存格抑制為 fill_value（原地修改 df）。

    填入字串（如 "*"）時先把欄位轉為 object 型別，避免在「數值欄位」寫入字串時拋出
    型別錯誤；填入空值則不轉型——數值欄可維持數值型別，下游（風險量測／匯出）拿到的
    仍是數字而非文字。
    """
    if col not in df.columns:
        return
    if isinstance(fill_value, str):
        df[col] = df[col].astype(object)
    df.loc[mask, col] = fill_value


class Suppressor(ABC):
    """抑制策略基底。

    suppress() 回傳 (處理後 df, SuppressionOutcome)。

    抑制率一律以百分比表示（15.0 代表 15%），與呼叫端傳入的 suppression_limit_percent
    同一把尺——上限與實際值若一個用 20、一個用 0.15，看報告的人得自己換算才比得出來。
    """

    @abstractmethod
    def suppress(
        self,
        df_out: pd.DataFrame,
        violation_mask: pd.Series,
        qi_cols: list[str],
        suppressed_count: int,
        n_original: int,
        k: int,
    ) -> tuple[pd.DataFrame, SuppressionOutcome]:  # pragma: no cover - 介面
        ...


class RowSuppressor(Suppressor):
    """列抑制：刪除等價類大小不足 k 的所有列；抑制率以「列」為單位。

    k 用不到（違規列已由呼叫端判定完畢、刪掉即結束，不需要重算等價類），
    收下只為與值抑制共用同一個介面。
    """

    def suppress(self, df_out, violation_mask, qi_cols, suppressed_count, n_original, k):
        df_out = df_out[~violation_mask].copy()
        rate_percent = 100 * suppressed_count / n_original if n_original > 0 else 0.0
        suppression_desc = (
            f"列抑制率 {rate_percent:.1f}%（共抑制 {suppressed_count} / {n_original} 列）"
        )
        return df_out, SuppressionOutcome(
            rate_percent, "row", suppressed_count, n_original, suppression_desc
        )


class CellSuppressor(Suppressor):
    """值抑制：違規列保留，逐欄挖掉 QI 值直到達標；抑制率以「格」為單位。

    採逐輪迭代（對齊統計揭露控制的 local suppression：挖個別的值，而非整列一次挖光）：
    每一輪挑一個欄位，只對「當下仍未達 k」的列挖掉該欄，挖完重算等價類，還有違規
    才進下一輪。因此常見情況只挖一兩欄就停，不會把所有 QI 欄一起挖掉。

    挑欄順序取「違規列中相異值最多」者——相異值越多識別力越強，挖掉它最能讓違規列
    併進既有等價類；同 sdcMicro 未指定 importance 時的預設傾向。

    迭代次數上限為 QI 欄數（每輪固定用掉一欄），且每輪只做一次整欄賦值與一次 groupby，
    兩者皆為向量化操作，故成本與列數幾乎無關——決定成本的是相異 QI 組合數。
    挖光所有 QI 欄仍未達標時停手，由後續 k 檢測據實回報。

    填什麼分兩層：欄位若於設定檔指定了 `cell_fill_value`（例如泛化樹頂層「台灣」）就填它，
    未指定者沿用全域的 cell_fill（star／missing）。全域值合法性於 Anonymizer 建構時已驗證，
    此處直接查表，查無即視為程式錯誤而非使用者輸入錯誤。
    """

    def __init__(self, cell_fill: str = "star", column_values: dict = None):
        self.cell_fill = cell_fill
        self.fill_value = CELL_FILL_VALUES[cell_fill]
        self.column_values = column_values or {}

    def suppress(self, df_out, violation_mask, qi_cols, suppressed_count, n_original, k):
        # 敏感欄位不在此處理（由 l/t 機制負責），避免過度抑制、損失資料價值
        remaining = list(qi_cols)
        mask = violation_mask
        suppressed_cells = 0
        used_cols: list[str] = []
        suppressed = pd.DataFrame(False, index=df_out.index, columns=list(qi_cols))
        while remaining and bool(mask.any()):
            col = max(
                remaining,
                key=lambda c: df_out.loc[mask, c].nunique(dropna=False),
            )
            suppress_cells(df_out, mask, col, self.column_values.get(col, self.fill_value))
            suppressed.loc[mask, col] = True
            suppressed_cells += int(mask.sum())
            used_cols.append(col)
            remaining.remove(col)
            # 重算等價類：挖掉的格子不論填了什麼都當空值（萬用字元）計算。
            # 挖空只會讓一列相容的對象變多，原本達標的列不會因此變成未達標。
            counts = wildcard_group_sizes(df_out[qi_cols].mask(suppressed))
            mask = counts < k

        # 抑制率以「值（格）」為單位：被挖格數 ÷ 總格數，符合規格之「N% 值」
        total_cells = len(df_out) * len(df_out.columns)
        rate_percent = 100 * suppressed_cells / total_cells if total_cells > 0 else 0.0
        # 逐欄指定的填法一併寫進描述，讓報告看得出哪一欄填了什麼（而非只講全域填法）
        overrides = {c: self.column_values[c] for c in used_cols if c in self.column_values}
        detail = (
            "；其中 " + "、".join(f"'{c}' 填「{v}」" for c, v in overrides.items())
            if overrides
            else ""
        )
        # 實際挖了哪幾欄要講出來：使用者宣告了三個 QI 欄卻只有一欄被動過，
        # 不說明會被當成漏處理。
        scope = f"實際挖除欄位：{used_cols}" if used_cols else "無須挖除任何欄位"
        suppression_desc = (
            f"值抑制率 {rate_percent:.1f}%（共抑制 {suppressed_cells} / {total_cells} 格，"
            f"填入{CELL_FILL_LABELS[self.cell_fill]}{detail}；{scope}）"
        )
        return df_out, SuppressionOutcome(
            rate_percent, "cell", suppressed_cells, total_cells, suppression_desc, suppressed
        )
