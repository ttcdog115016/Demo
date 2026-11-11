"""再識別風險引擎的值物件（報告類）。"""
from typing import Any, Literal

from pydantic import BaseModel


class ProcessingConfig(BaseModel):
    """處理配置回填：這份風險是用什麼去識別方法、什麼參數評出來的。

    三攻擊由引擎自己切分、自己產 syn，故「用了什麼方法／參數」由引擎親手記錄，
    而非呼叫方事後填入；產出 PDF 時可如實揭露。
    deid_params 已剔除 salt_key 等機密（不得寫入報告）。
    """

    method: Literal["k-anon", "dp"]
    # 去識別參數（K-匿名 k/l/t/抑制…、DP accumulated_*／default_delta…），已剔除機密。
    deid_params: dict[str, Any] = {}
    # 風險實驗參數（seed／ctrl_ratio／n_iter／n_subset／n_repeats／overlap_ratio）。
    risk_params: dict[str, Any] = {}


class CapReport(BaseModel):
    """CAP 前後對比（規格 §3(1)B）——CAP 獨立端點專用報告。

    只算「上傳的原始」與「上傳的處理後」各自的正確歸因機率並對比，
    引擎本身不做去識別（去識別由呼叫端事前完成、直接上傳成品）。
    n_original／n_processed 為實際參與計算的筆數（子群體限定後可能較上傳量少）。
    -1.0 為降級哨兵值（僅代表無法評估，非風險值）。
    """

    cap_before: float
    cap_after: float
    n_original: int
    n_processed: int
    # 本次執行耗時（秒）：由 CLI／API 自收到請求至完成量測計時；降級報告不計時（None）。
    elapsed_seconds: float | None = None
    message: str

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump()


class AttackReport(BaseModel):
    """三攻擊風險（規格 §3(1)A）——三攻擊評估專用報告。

    系統先切 80/20、只對 80%（train）去識別產 syn、20%（holdout）為 ctrl，
    故報告只含三攻擊三指標，不含 CAP（CAP 屬 §3(1)B、走前後對比的另一條路徑）。
    -1.0 為降級哨兵值（僅代表無法評估，非風險值）。
    """

    singling_out_risk: float
    linkability_risk: float
    inference_risk: float
    # 本次實際進入評估的資料筆數（全份評估，不抽樣）
    sample_size: int
    # 連結性實際評估筆數（0＝未執行）；如實揭露跑了幾筆。
    linkability_evaluated: int = 0
    # 執行參數揭露：重複實驗輪數（預設 1＝單輪）與跨輪重疊比例。
    n_repeats: int = 1
    overlap_ratio: float = 0.0
    # 處理配置回填：引擎親手記錄本次用的去識別方法與參數；
    # 降級報告亦帶著，供 PDF 報告如實揭露。
    processing_config: ProcessingConfig | None = None
    # 本次執行耗時（秒）：由 CLI／API 自收到請求至完成量測計時；降級報告不計時（None）。
    elapsed_seconds: float | None = None
    message: str

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump()
