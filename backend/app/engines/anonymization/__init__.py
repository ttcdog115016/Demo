"""K-匿名化引擎（模組化）。

對外門面：`run_k_anonymity()`。內部拆分為
  pipeline / strategies / metrics / suppression / validation / types / factory
各模組，方便替換演算法（Strategy + Pipeline）；值物件（QualityReport）統一放 types.py。

公開 API 為門面函式與各 OOP 擴充點類別（策略／檢測／抑制／驗證／工廠），
內部逐格運算 helper（apply_numeric_bins 等）不對外公開。
"""
import pandas as pd

from app.core.config import ColumnConfig

from .types import QualityReport
from .pipeline import Anonymizer
from .factory import AnonymizerFactory
from .validation import ConfigValidator
from .metrics import KAnonymity, LDiversity, TCloseness
from .strategies.masking import FullMask, PartialMask, HashMask
from .strategies.generalize import (
    NumericalGeneralizer,
    DatetimeGeneralizer,
    CategoricalGeneralizer,
    StringGeneralizer,
)
from .suppression import RowSuppressor, CellSuppressor


def run_k_anonymity(
    df: pd.DataFrame,
    config: ColumnConfig,
    k: int = 5,
    l: int | None = None,  # noqa: E741
    t: float | None = None,
    suppression_limit_percent: float = 20,
    limit_exceeded_action: str = "stop_and_error",
    salt_key: str | None = None,
    suppression_method: str = "row_suppression",
    cell_fill: str = "star",
    k_qi_subset: list[str] | None = None,
) -> tuple[pd.DataFrame, QualityReport]:
    """K-匿名化主流程（門面）：由 AnonymizerFactory 組裝並注入工人，再執行。

    泛化層級（規格 2.1(2)）一律由設定檔提供（config.qi_generalization_levels），
    不另開呼叫端覆蓋參數——逐欄設定歸設定檔、參數只放全域值。
    k_qi_subset：算 k 時使用的 QI 欄位子集（規格 2.1(4)「依指定準識別欄位組合計算」）。
    None＝用全部 QI（整體 k）；指定時 k/l/t/抑制皆以此子集定義等價類。
    cell_fill：值抑制挖掉的格子填什麼（"star" 填 * ／"missing" 填空值），僅值抑制時生效。
    """
    return AnonymizerFactory.create(
        config,
        k=k,
        l=l,
        t=t,
        suppression_limit_percent=suppression_limit_percent,
        limit_exceeded_action=limit_exceeded_action,
        salt_key=salt_key,
        suppression_method=suppression_method,
        cell_fill=cell_fill,
        k_qi_subset=k_qi_subset,
    ).run(df)


__all__ = [
    "run_k_anonymity",
    # 流程與組裝
    "Anonymizer",
    "AnonymizerFactory",
    "QualityReport",
    "ConfigValidator",
    # 檢測
    "KAnonymity",
    "LDiversity",
    "TCloseness",
    # 遮蔽策略
    "FullMask",
    "PartialMask",
    "HashMask",
    # 泛化策略
    "NumericalGeneralizer",
    "DatetimeGeneralizer",
    "CategoricalGeneralizer",
    "StringGeneralizer",
    # 抑制策略
    "RowSuppressor",
    "CellSuppressor",
]
