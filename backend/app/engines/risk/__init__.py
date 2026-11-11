"""再識別風險評估引擎（模組化）。

對外門面：三攻擊 `run_attacks()`（引擎自產 syn）與 `run_cap()`（前後對比）。
內部拆分為 mode / cap_mode / splitter / attacks / cap / validation / formula / subset / types
各模組（Strategy + DI，與 K-匿名、DP 引擎同範式）。

三攻擊與 CAP 為兩條獨立路徑：三攻擊由引擎自行切分並產生 syn，CAP 吃呼叫端提供的
處理前後兩份資料。QI/敏感欄位由呼叫端自「帶 role 的欄位設定檔」萃取後傳入。
"""
from typing import Any

import pandas as pd

from .types import AttackReport, CapReport, ProcessingConfig
from .validation import RiskInputValidator
from .splitter import RepeatedSplitter
from .attacks import AttackStrategy, SinglingOutAttack, LinkabilityAttack, InferenceAttack
from .cap import CAPCalculator
from .formula import risk_score
from .deid_bridge import DeidBridge
from .mode import AttackAssessor
from .cap_mode import CapAssessor
from .subset import (
    SubsetResult,
    select_subgroup,
    subgroup_notes,
    subgroup_notes_before_after,
    empty_subgroup_attack_report,
    empty_subgroup_cap_report,
)


def run_attacks(
    original_df: pd.DataFrame,
    qi_cols: list[str],
    sensitive_cols: list[str],
    method: str,
    deid_config: Any,
    deid_params: dict | None = None,
    n_iter: int = 500,
    ctrl_ratio: float = 0.2,
    seed: int = 42,
    n_subset: int = 500,
    link_cols_a: list[str] | None = None,
    link_cols_b: list[str] | None = None,
    n_repeats: int = 1,
    overlap_ratio: float = 0.0,
) -> AttackReport:
    """三攻擊門面：只吃原始資料＋去識別方法＋該方法 config。

    引擎自己「切 80/20 → 只對 80% 去識別產 syn → 20% 為 holdout → 跑三攻擊」，
    只回三攻擊；CAP 由下方的 run_cap 負責。
    deid_config：K-匿名為 ColumnConfig、DP 為 DPColumnConfig（由呼叫端解析後傳入）。
    deid_params：該方法的全域旋鈕（K-匿名 k/l/t…、DP accumulated_*…），原樣轉交去識別引擎。
    n_repeats／overlap_ratio：重複實驗輪數與跨輪抽樣重疊比例，預設 1／0.0＝
    單輪；>1 才會反覆「切分→產 syn→評估」並回平均分數。
    """
    return AttackAssessor(
        qi_cols,
        sensitive_cols,
        method=method,
        deid_config=deid_config,
        deid_params=deid_params,
        n_iter=n_iter,
        ctrl_ratio=ctrl_ratio,
        seed=seed,
        n_subset=n_subset,
        link_cols_a=link_cols_a,
        link_cols_b=link_cols_b,
        n_repeats=n_repeats,
        overlap_ratio=overlap_ratio,
    ).run(original_df)


def run_cap(
    original_df: pd.DataFrame,
    processed_df: pd.DataFrame,
    qi_cols: list[str],
    sensitive_cols: list[str],
) -> CapReport:
    """CAP 前後對比門面（規格 §3(1)B）：吃上傳的原始與處理後兩份現成資料。

    引擎不做去識別（去識別由呼叫端事前完成），只各自算一次 CAP 再對比（cap_before／
    cap_after）。子群體限定由呼叫端事前對前後兩份各篩一次後傳入；本門面只評傳進來的範圍。
    """
    return CapAssessor(qi_cols, sensitive_cols).run(original_df, processed_df)


__all__ = [
    "run_attacks",
    "run_cap",
    # 流程與組裝
    "AttackAssessor",
    "CapAssessor",
    # 值物件與公式
    "AttackReport",
    "CapReport",
    "ProcessingConfig",
    "risk_score",
    # 工人（OOP 擴充點）
    "RiskInputValidator",
    "RepeatedSplitter",
    "AttackStrategy",
    "SinglingOutAttack",
    "LinkabilityAttack",
    "InferenceAttack",
    "CAPCalculator",
    "DeidBridge",
    # 子群體篩選（§3(1)C.ii；三攻擊／CAP 端點共用）
    "select_subgroup",
    "SubsetResult",
    "subgroup_notes",
    "subgroup_notes_before_after",
    "empty_subgroup_attack_report",
    "empty_subgroup_cap_report",
]
