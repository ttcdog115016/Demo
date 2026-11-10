"""DPProcessorFactory：組裝並注入所有工人，產出接好依賴的 DPProcessor。

對應 K-匿名的 AnonymizerFactory。
要替換演算法（如以其他機制取代 k-RR），只需在此改注入的實例，pipeline 不需改動。
"""

from app.core.config import DPColumnConfig

from .validation import BudgetValidator
from .accountant import BudgetAccountant
from .sensitivity import SensitivityResolver
from .mechanisms import NumericNoiser, KRandomizedResponse, DatetimeNoiser
from .pipeline import DPProcessor


class DPProcessorFactory:
    """組裝 DPProcessor（工人皆無狀態，直接 new 實例注入）。

    要替換/新增機制，只需改此處注入的實例，pipeline 不動。
    本類別是工人的唯一建立處：DPProcessor 與各機制都不自備預設，缺任何一個都會直接報錯。
    """

    @staticmethod
    def create(
        config: DPColumnConfig,
        accumulated_epsilon: float = 0.0,
        accumulated_delta: float = 0.0,
        default_delta: float | None = None,
    ):
        # DatetimeNoiser 內部復用數值加噪與 sensitivity 決議 → 共用同一組實例（皆無狀態）
        numeric = NumericNoiser()
        resolver = SensitivityResolver()
        return DPProcessor(
            config,
            accumulated_epsilon=accumulated_epsilon,
            accumulated_delta=accumulated_delta,
            default_delta=default_delta,
            # ── 把工人組好、注入 ──
            validator=BudgetValidator(),
            accountant=BudgetAccountant(),
            sensitivity_resolver=resolver,
            numeric_noiser=numeric,
            krr=KRandomizedResponse(),
            datetime_noiser=DatetimeNoiser(
                numeric_noiser=numeric, sensitivity_resolver=resolver
            ),
        )
