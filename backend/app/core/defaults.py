"""邊界層（API／CLI）的參數預設決議。

「使用者沒給這個參數時要用什麼值、並且怎麼告訴他」——這件事屬於介面層而非引擎：
引擎自己的預設值定義在 `run_k_anonymity()` 的簽章上，供直接呼叫函式庫者使用；本模組定義的
是「透過 API 或 CLI 進來時」採用的預設值，兩者刻意分開（例如超限行為，引擎預設拋錯、
介面預設僅警示）。

同一套決議在四個入口都需要——API 的 `/k-anonymity` 與 `/risk/k-anonymity`、
CLI 的 `k-anonymity` 與 `risk-k-anonymity`。集中於此，四個入口拿到的值與說法必然一致。

notes 的用途是「報告透明」：系統替使用者選了什麼，逐條寫進報告告知，不默默決定。
"""
from dataclasses import dataclass

# 介面層採用的預設值（與引擎簽章上的預設分開，理由見模組說明）
DEFAULT_K = 5
DEFAULT_SUPPRESSION_LIMIT_PERCENT = 20
DEFAULT_LIMIT_EXCEEDED_ACTION = "allow_with_warning"
DEFAULT_SUPPRESSION_METHOD = "row_suppression"
DEFAULT_CELL_FILL = "star"


@dataclass
class KAnonDefaults:
    """決議後的 K-匿名參數，以及「哪些是系統代選的」之告知文字。"""

    k: int
    suppression_limit_percent: float
    limit_exceeded_action: str
    suppression_method: str
    cell_fill: str
    notes: list[str]


def resolve_kanon_defaults(
    k: int | None,
    suppression_limit_percent: float | None,
    limit_exceeded_action: str | None,
    suppression_method: str | None,
    cell_fill: str | None,
) -> KAnonDefaults:
    """把「沒給」的 K-匿名參數填上介面層預設，並逐條記錄告知文字。

    傳入 None 代表呼叫端未提供；有給的值原樣沿用（合法性由引擎建構時驗證，此處不判斷）。
    """
    notes: list[str] = []
    if k is None:
        k = DEFAULT_K
        notes.append("未指定 k 值，已使用預設 k=5。")
    if suppression_limit_percent is None:
        suppression_limit_percent = DEFAULT_SUPPRESSION_LIMIT_PERCENT
        notes.append("未指定抑制上限，已使用預設 20（＝20%）。")
    if limit_exceeded_action is None:
        limit_exceeded_action = DEFAULT_LIMIT_EXCEEDED_ACTION
        notes.append("未指定超限行為，已使用預設 allow_with_warning（超限僅警示、不中止）。")
    if suppression_method is None:
        suppression_method = DEFAULT_SUPPRESSION_METHOD
        notes.append("未指定抑制方式，已使用預設列抑制（row_suppression）。")
    if cell_fill is None:
        cell_fill = DEFAULT_CELL_FILL
        # 只在真的走值抑制時才告知——列抑制沒有「格子填什麼」可言，講了是雜訊
        if suppression_method.lower() == "cell_suppression":
            notes.append(
                "未指定值抑制填充方式，已使用預設星號（star）；如需改填空值請指定 missing。"
            )

    return KAnonDefaults(
        k=k,
        suppression_limit_percent=suppression_limit_percent,
        limit_exceeded_action=limit_exceeded_action,
        suppression_method=suppression_method,
        cell_fill=cell_fill,
        notes=notes,
    )
