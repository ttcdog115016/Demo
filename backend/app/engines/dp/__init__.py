"""差分隱私引擎（模組化）。

對外門面：`run_dp()`。內部拆分為
  pipeline / accountant / sensitivity / discretize / mechanisms / types / factory
各模組（Strategy + Pipeline + Factory + DI，與 K-匿名引擎同範式）。

參數分工與 K-匿名一致：逐欄設定（ColumnBudget/DPColumnConfig，住 app.core.config）
由設定檔提供；全域旋鈕（累計／default_delta）為門面參數，比照 k/l/t。

無狀態設計：引擎不留存任何預算帳；累計消耗由呼叫方自帶，
BudgetReport 回報「本次消耗＋累計值」＝使用者下次呼叫要自帶的收據。
"""
import pandas as pd

from app.core.config import DPColumnConfig

from .types import BudgetReport, ColumnBudgetDetail, effective_delta
from .validation import BudgetValidator
from .accountant import BudgetAccountant
from .sensitivity import SensitivityResolver
from .mechanisms import NumericNoiser, KRandomizedResponse, DatetimeNoiser
from .pipeline import DPProcessor
from .factory import DPProcessorFactory


def run_dp(
    df: pd.DataFrame,
    config: DPColumnConfig,
    accumulated_epsilon: float = 0.0,
    accumulated_delta: float = 0.0,
    default_delta: float | None = None,
) -> tuple[pd.DataFrame, BudgetReport]:
    """差分隱私主流程（門面）：由 DPProcessorFactory 組裝並注入工人，再執行。

    逐欄預算（type/ε/δ/sensitivity）一律由設定檔提供（config.column_budgets），
    不另開呼叫端覆蓋參數——逐欄設定歸設定檔、參數只放全域值（與 K-匿名同原則）。
    accumulated_*：呼叫方自帶的已累計消耗（無狀態設計：引擎不記帳）。
    default_delta：全域（相同）δ，只補「沒設 δ 的 continuous/datetime 欄」。
    """
    return DPProcessorFactory.create(
        config,
        accumulated_epsilon=accumulated_epsilon,
        accumulated_delta=accumulated_delta,
        default_delta=default_delta,
    ).run(df)


__all__ = [
    "run_dp",
    # 流程與組裝
    "DPProcessor",
    "DPProcessorFactory",
    # 值物件
    "BudgetReport",
    "ColumnBudgetDetail",
    "effective_delta",
    # 工人（OOP 擴充點）
    "BudgetValidator",
    "BudgetAccountant",
    "SensitivityResolver",
    "NumericNoiser",
    "KRandomizedResponse",
    "DatetimeNoiser",
]
