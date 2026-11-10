"""子群體篩選（§3(1)C.ii 對象族群限定）——三攻擊與 CAP 端點共用的獨立純函式模組。

分工：
    三攻擊端點進引擎前對原始資料篩一次；CAP 端點對原始／處理後各篩一次。
    本模組只做「df ＋ 條件 → 篩過的 df ＋ 前後筆數」，不碰攻擊／CAP／去識別。

條件格式（JSON 物件，欄名 → 條件；多欄並列＝AND，須同時滿足）：
    數值區間：{"年齡": {"min": 30, "max": 40}}   閉區間，min／max 皆含（可只給一側）
    日期區間：{"就診日": {"min": "2024-01-01", "max": "2024-06-30"}}
                                                閉區間，邊界為日期字串（YYYY-MM-DD，可帶時間）；
                                                只給日期時以「日」比較，當天任何時刻皆含
    類別集合：{"地區": ["台北", "台中"]}          isin（成員需落在清單內）
    空條件（None／{}）＝不限定，全體參與。

前提（§3(1)C.ii 設計）：條件欄位須為明文、未去識別化，成員判定才有意義。

參數檢查分界：
    欄位不存在 → 擋（資料層對不上，fail fast，ERR_CONFIG_DATA_MISMATCH）。
    條件格式無法解讀 → 擋（無可解讀的降級語意，fail fast，ERR_SUBSET_COND_MALFORMED）。
    區間下在非數值欄 → 不擋不爆：以 to_numeric 強制轉換，轉不動者成 NaN 自然落選，備註告知。
    日期區間同理：以 to_datetime 強制轉換，轉不動者成 NaT 自然落選，備註告知。
    區間邊界一側數值、一側日期 → 擋（ERR_SUBSET_COND_MALFORMED）。
    篩不到（空群）→ 不擋：回空 df ＋前後筆數，交由端點據實告知（降級語意，非錯誤）。
"""
import re
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from app.core.errors import PetsError
from .types import AttackReport, CapReport


@dataclass
class SubsetResult:
    """篩選結果：篩過的 df ＋ 前後筆數 ＋ 透明化備註（供報告揭露系統做的隱性決定）。"""

    df: pd.DataFrame
    n_before: int
    n_after: int
    notes: list[str] = field(default_factory=list)


def select_subgroup(
    df: pd.DataFrame, conditions: dict[str, Any] | None
) -> SubsetResult:
    """依 conditions 篩出子群體（多欄 AND）。

    無條件（None／空 dict）直接原樣回傳、前後筆數相同。欄位不存在或條件畸形即 fail fast；
    空群不擋（回空 df），非數值欄套區間不爆（強制轉數值、落選並備註）。
    """
    n_before = len(df)
    if not conditions:
        return SubsetResult(df=df, n_before=n_before, n_after=n_before)

    notes: list[str] = []
    mask = pd.Series(True, index=df.index)
    for col, cond in conditions.items():
        if col not in df.columns:
            raise PetsError(
                "ERR_CONFIG_DATA_MISMATCH",
                f"子群體條件引用了資料中不存在的欄位 '{col}'，請檢查欄位名稱。",
            )
        mask &= _column_mask(df[col], col, cond, notes)

    sub = df[mask]
    return SubsetResult(df=sub, n_before=n_before, n_after=len(sub), notes=notes)


# ── 篩到了：把「篩了多少」寫進報告的說明文字 ──────────────────────────────────
# 報告透明：限定了子群體就等於改變了評估範圍，前後筆數與轉換備註都要如實告知，
# 否則使用者無從判斷分數是根據多少資料算出來的。API 與 CLI 的風險入口共用同一套說法。


def subgroup_notes(sub: SubsetResult) -> list[str]:
    """三攻擊：單一份資料的子群體前後筆數，後接篩選過程的轉換備註。"""
    return [f"子群體：篩選前 {sub.n_before} 筆、篩選後 {sub.n_after} 筆。", *sub.notes]


def subgroup_notes_before_after(
    sub_ori: SubsetResult, sub_proc: SubsetResult
) -> list[str]:
    """CAP：原始與處理後各自的前後筆數（同一條件各篩一次），後接兩邊的轉換備註。

    處理後篩成空群時另外點明：cap_after 的 0 是「這個範圍已經沒有資料」，
    不是「風險為零」——兩者數字相同但意義相反，不講清楚會被誤讀成安全。
    """
    notes = [
        f"子群體：原始篩選前 {sub_ori.n_before} 筆、篩選後 {sub_ori.n_after} 筆；"
        f"處理後篩選前 {sub_proc.n_before} 筆、篩選後 {sub_proc.n_after} 筆。",
        *sub_ori.notes,
        *sub_proc.notes,
    ]
    if sub_proc.n_after == 0:
        notes.append("處理後子群體為空，cap_after 之 0 僅代表該範圍已無資料、非零風險。")
    return notes


# ── 篩不到（空群）時的降級收據 ────────────────────────────────────────────────
# 空群不是錯誤而是降級語意（見模組開頭參數檢查分界），故不拋錯、改回一份「說明為何無法
# 評估」的報告。API 與 CLI 的風險入口都需要它，收在此處確保各入口的分數與說法一致。


def empty_subgroup_attack_report(sub: SubsetResult) -> AttackReport:
    """三攻擊：子群體篩不到＝無資料可評估，三個指標回 -1.0 並說明前後筆數。"""
    note = " ".join(sub.notes)
    return AttackReport(
        singling_out_risk=-1.0,
        linkability_risk=-1.0,
        inference_risk=-1.0,
        sample_size=0,
        message=(
            f"子群體條件篩選後為空（篩選前 {sub.n_before} 筆、篩選後 0 筆），"
            f"無資料可評估，顯示之 -1.0 僅代表無法評估。{note}"
        ).strip(),
    )


def empty_subgroup_cap_report(
    sub_ori: SubsetResult, sub_proc: SubsetResult
) -> CapReport:
    """CAP：原始資料篩不到＝沒有基準可比，前後皆回 -1.0；處理後的筆數仍如實揭露。"""
    note = " ".join(sub_ori.notes)
    return CapReport(
        cap_before=-1.0,
        cap_after=-1.0,
        n_original=0,
        n_processed=sub_proc.n_after,
        message=(
            f"原始資料子群體條件篩選後為空（篩選前 {sub_ori.n_before} 筆、篩選後 0 筆），"
            f"無基準可比，顯示之 -1.0 僅代表無法評估。{note}"
        ).strip(),
    )


def _column_mask(
    series: pd.Series, col: str, cond: Any, notes: list[str]
) -> pd.Series:
    """單欄條件 → 布林遮罩。list／tuple／set＝類別 isin；dict＝數值區間；其餘擋。"""
    if isinstance(cond, (list, tuple, set)):
        return series.isin(list(cond))
    if isinstance(cond, dict):
        return _range_mask(series, col, cond, notes)
    raise PetsError(
        "ERR_SUBSET_COND_MALFORMED",
        f"欄位 '{col}' 的子群體條件格式無法解讀，"
        f"需為類別清單（list）或區間物件（{{\"min\": .., \"max\": ..}}）。",
    )


def _range_mask(
    series: pd.Series, col: str, cond: dict[str, Any], notes: list[str]
) -> pd.Series:
    """閉區間遮罩：min／max 皆含、可只給一側。邊界皆數值＝數值區間；皆日期字串＝日期區間。

    欄位內容轉不動（非數值／非日期）者不爆、落選並備註。
    """
    lo = cond.get("min")
    hi = cond.get("max")
    if lo is None and hi is None:
        raise PetsError(
            "ERR_SUBSET_COND_MALFORMED",
            f"欄位 '{col}' 的區間條件至少需提供 min 或 max。",
        )
    kinds = {
        _bound_kind(col, name, val)
        for name, val in (("min", lo), ("max", hi))
        if val is not None
    }
    if len(kinds) > 1:
        raise PetsError(
            "ERR_SUBSET_COND_MALFORMED",
            f"欄位 '{col}' 區間的 min／max 須同為數值或同為日期，收到 {lo!r}、{hi!r}。",
        )
    if kinds == {"date"}:
        return _date_range_mask(series, col, lo, hi, notes)

    # 非數值欄給區間＝不擋不爆：強制轉數值，原本有值卻轉不成數字者變 NaN、比較恆 False 而落選
    numeric = pd.to_numeric(series, errors="coerce")
    coerced = numeric.isna() & series.notna()
    if coerced.any():
        notes.append(
            f"子群體條件：欄位 '{col}' 含 {int(coerced.sum())} 筆非數值內容，"
            f"套用數值區間時該類紀錄一律落選。"
        )

    mask = pd.Series(True, index=series.index)
    if lo is not None:
        mask &= numeric >= lo
    if hi is not None:
        mask &= numeric <= hi
    return mask


# 日期邊界：YYYY-MM-DD（分隔可為 - / .），可帶時間；純數字字串（如 "30"）不視為日期
_DATE_BOUND_RE = re.compile(r"^\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T].*)?$")
_DATE_ONLY_RE = re.compile(r"^\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*$")


def _bound_kind(col: str, name: str, val: Any) -> str:
    """區間邊界種類：'number'（int／float）或 'date'（可解析的日期字串）；其餘擋。"""
    # 布林是 int 子類，但區間邊界寫 True／False 顯屬誤填，一併擋掉
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return "number"
    if isinstance(val, str) and _DATE_BOUND_RE.match(val):
        try:
            pd.Timestamp(val.strip())
            return "date"
        except (ValueError, TypeError):
            pass
    raise PetsError(
        "ERR_SUBSET_COND_MALFORMED",
        f"欄位 '{col}' 區間的 {name} 須為數值或日期字串（YYYY-MM-DD），收到 {val!r}。",
    )


def _date_range_mask(
    series: pd.Series, col: str, lo: str | None, hi: str | None, notes: list[str]
) -> pd.Series:
    """日期閉區間遮罩：欄位強制轉日期，轉不動者落選並備註。

    邊界只給日期（無時間）時以「日」比較：欄位先截成當天 00:00，使 max 當天任何時刻皆含。
    """
    dates = pd.to_datetime(series, errors="coerce", format="mixed")
    if getattr(dates.dt, "tz", None) is not None:
        dates = dates.dt.tz_localize(None)
    coerced = dates.isna() & series.notna()
    if coerced.any():
        notes.append(
            f"子群體條件：欄位 '{col}' 含 {int(coerced.sum())} 筆非日期內容，"
            f"套用日期區間時該類紀錄一律落選。"
        )

    mask = pd.Series(True, index=series.index)
    for val, keep in ((lo, lambda d, b: d >= b), (hi, lambda d, b: d <= b)):
        if val is None:
            continue
        bound = pd.Timestamp(val.strip())
        if bound.tzinfo is not None:
            # ★ TTC 2026-11-02：欄位已去掉時區（保留當地時刻），邊界比照處理；原本帶時區的邊界直接比較會 TypeError
            bound = bound.tz_localize(None)
        cells = dates.dt.normalize() if _DATE_ONLY_RE.match(val) else dates
        mask &= keep(cells, bound)
    return mask
