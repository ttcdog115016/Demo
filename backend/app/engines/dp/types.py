"""差分隱私引擎的值物件（報告類）。

逐欄設定（ColumnBudget／DPColumnConfig）與其解析器住在 app.core.config，
比照 K-匿名的 ColumnInfo／ColumnConfig——設定檔是「進引擎前」的東西，
API／CLI／引擎共用，故歸 core；本模組只留引擎產出的報告值物件。
"""
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.core.config import ColumnBudget


def effective_delta(budget: ColumnBudget, default_delta: float | None) -> float:
    """欄位實際生效的 δ（單一真相來源：記帳與機制分派都用這裡）。

    優先序：categorical 恆 0（k-RR 純 ε）→ 欄位自設（含明確 0）→ 全域 default_delta → 0。

    設計為模組級純函式而非某個 class 的方法：δ 決議同時被 accountant（記帳）與
    pipeline（機制分派）需要，兩者皆須用同一份邏輯，帳實才會相符。
    """
    if budget.type == "categorical":
        return 0.0
    if budget.delta_budget is not None:
        return budget.delta_budget
    if default_delta is not None:
        return default_delta
    return 0.0


class ColumnBudgetDetail(BaseModel):
    """逐欄預算明細（報告透明）。

    讓使用者看到每一欄實際花了多少、用了什麼機制，以及系統替它做的決定
    （sensitivity 是使用者申報還是系統從資料推導）。
    """

    column: str
    # 使用者宣告的型別照實帶入明細。mechanism 保持純機制名（結構化資料不塞註解），
    # datetime 欄的加噪單位另見 noise_unit。
    type: Literal["continuous", "categorical", "datetime"]
    # 機制名採文獻通用名（讀報告的人不必先認得函式庫的類別名）：
    # DiscreteLaplace＝離散型拉普拉斯（純 ε，diffprivlib 的 Geometric）、
    # DiscreteGaussian＝離散型高斯（ε+δ，diffprivlib 的 GaussianDiscrete）。
    mechanism: Literal["DiscreteLaplace", "DiscreteGaussian", "k-RR"]
    epsilon: float
    delta: float
    # 純 ε 機制（k-RR）用不到 sensitivity → None；連續型別才有值。
    # ★單位是「整數個最小單位」（continuous 看 minimum_unit、datetime 看 noise_unit），
    # 不是原始單位——須與下面兩個欄位一起看才讀得懂。
    sensitivity: float | None = None
    # sensitivity 來源：使用者申報 / 系統以 max−min 推導 / None（k-RR 無此參數）。
    # 揭露來源＝報告透明原則：系統若替使用者決定了 sensitivity，使用者有權知道。
    sensitivity_source: Literal["user", "system"] | None = None
    # datetime 欄的加噪單位（未設定即 day）；其餘型別無此概念 → None。
    # 必須揭露：sensitivity 的單位跟著它走，只看數字無從判斷是 30 天還是 30 秒。
    noise_unit: Literal["day", "hour", "minute", "second"] | None = None
    # datetime 欄的刻度：一格＝noise_step 個 noise_unit（未設定即 1）；其餘型別 → None。
    # 與 noise_unit 一起看才知道 sensitivity 的一格有多長（minute + 5 ＝ 5 分鐘）。
    noise_step: int | None = None
    # continuous 欄加噪前後換算用的最小單位（未設定即 1）；其餘型別 → None。
    # 規格要求它是「公開」參數，且 sensitivity 以它為單位，故必須揭露。
    minimum_unit: float | None = None
    # 加噪後超出 clipping_bounds 時的處理方式；沒設界線 → None（系統未動過輸出值）。
    # 屬後處理：系統對輸出做了額外調整，依報告透明原則一併揭露。
    out_of_bounds_strategy: Literal["clamp", "wrap", "fold"] | None = None


class BudgetReport(BaseModel):
    consumed_epsilon: float
    consumed_delta: float
    accumulated_epsilon: float | None = None
    accumulated_delta: float | None = None
    message: str
    # 逐欄明細：有給預算的欄各一筆。
    per_column: list[ColumnBudgetDetail] = Field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """與其他三種報告（品質／三攻擊／CAP）一致的序列化入口。"""
        return self.model_dump()
