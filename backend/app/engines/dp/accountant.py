"""預算記帳（BudgetAccountant）。

無狀態：加總本次申報的 ε/δ（申報即消耗，與資料內容無關），再併入呼叫方自帶的
累計值，交回 pipeline 產出 BudgetReport（accumulated_* 即使用者下次呼叫要自帶的「收據」）。

只做「追蹤消耗」不做「上限守門」：規格要求的是累計與追蹤，未要求整體上限與超支拒絕。

全域旋鈕（累計值／default_delta）由呼叫端傳入而非藏在 config 裡，
比照 K-匿名把 k 傳給 KAnonymity.check()——工人保持無狀態、要什麼給什麼。
"""

from app.core.config import DPColumnConfig

from .types import effective_delta


class BudgetAccountant:
    """申報加總與累計併帳。"""

    def account(
        self,
        config: DPColumnConfig,
        *,
        default_delta: float | None = None,
        accumulated_epsilon: float = 0.0,
        accumulated_delta: float = 0.0,
    ) -> tuple[float, float, float, float]:
        """記帳：回傳 (本次 ε, 本次 δ, 累計後 ε, 累計後 δ)。

        本次申報的 ε/δ 為各欄直接相加（＝基本序列組合）；δ 以「實際生效值」入帳
        （欄位自設 > 全域 default_delta > 0），與機制分派同一真相來源
        （types.effective_delta），帳實相符。
        """
        req_eps = sum(col_b.epsilon_budget for col_b in config.column_budgets.values())
        req_del = sum(
            effective_delta(col_b, default_delta)
            for col_b in config.column_budgets.values()
        )
        return (
            req_eps,
            req_del,
            accumulated_epsilon + req_eps,
            accumulated_delta + req_del,
        )
