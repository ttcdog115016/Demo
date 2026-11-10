"""可預期錯誤的單一定義來源：錯誤碼、HTTP 狀態碼、CLI 離開代碼只寫在這一份。

本模組把分類收成一張表：引擎與設定檔解析一律拋 PetsError 並帶錯誤碼，
API 由統一的例外處理器轉成回應、CLI 由統一的收尾函式轉成訊息與離開代碼，
同一個問題在兩個介面必然得到同一個錯誤碼與同一句說明。

狀態碼分界（給整合方的判讀依據）：
    400 送來的東西讀不懂——語法壞掉、參數值不合法，要修的是請求本身。
    401 沒有身分或身分驗不過——沒帶 token、token 過期或帳密錯誤。
    403 身分沒問題但不准做——角色不足，或該操作本身被規則擋下。
    409 與現況衝突——要建立的帳號已經存在。
    413 內容過大——超過部署方設定的上傳上限。
    415 格式不收——副檔名不在支援清單內。
    422 讀得懂但講不通——設定檔語法正確，但內容與資料對不上或自相矛盾。
    423 帳號暫時鎖定——連續登入失敗達門檻，回應另帶 Retry-After。
    500 伺服器自己的問題，呼叫方改請求也修不了。
    503 會員端點所需的部署設定未備妥；三大功能不受影響。
"""

# ── 錯誤碼 → HTTP 狀態碼 ────────────────────────────────────────────────────
# 新增錯誤碼一律先登記於此；PetsError 建構時會檢查，打錯字在開發期就會炸。
ERROR_HTTP_STATUS: dict[str, int] = {
    # 400：請求本身讀不懂或參數不合法
    "ERR_BAD_REQUEST": 400,
    "ERR_INVALID_PARAM": 400,
    "ERR_CONFIG_MALFORMED": 400,
    # 資料檔本身讀不懂：空檔、編碼認不得、CSV／JSON 格式壞掉、Excel 毀損、不是 SQLite 資料庫
    "ERR_DATASET_UNREADABLE": 400,
    "ERR_SUBSET_COND_MALFORMED": 400,
    "ERR_DEID_METHOD_UNKNOWN": 400,
    "ERR_PREPROCESS_ACTION_UNKNOWN": 400,
    "ERR_PREPROCESS_PARAM_INVALID": 400,
    # 413：內容過大
    "ERR_PAYLOAD_TOO_LARGE": 413,
    # 415：格式不收
    "ERR_UNSUPPORTED_FILE_FORMAT": 415,
    "ERR_UNSUPPORTED_CONFIG_FORMAT": 415,
    # 401：身分驗證未通過（由登入與 token 驗證拋出，非引擎拋出）
    "ERR_UNAUTHORIZED": 401,
    # 403：身分確認無誤，但角色不足或該操作本身不被允許（會員系統的權限守法）
    "ERR_FORBIDDEN": 403,
    # 404／405：路徑或方法不存在（框架產生）
    "ERR_NOT_FOUND": 404,
    "ERR_METHOD_NOT_ALLOWED": 405,
    # 409：與現況衝突——要建立的帳號已經存在
    "ERR_USER_EXISTS": 409,
    # ★ TTC 2026-10-29：處理紀錄同一 id 已存在（簽過的紀錄不得覆寫）
    "ERR_RECORD_EXISTS": 409,
    # 423：帳號因連續登入失敗而暫時鎖定（回應另帶 Retry-After 標頭）
    "ERR_ACCOUNT_LOCKED": 423,
    # 503：會員端點所需的部署設定未備妥（未設簽章金鑰），三大功能不受影響
    "ERR_AUTH_DISABLED": 503,
    # 422：讀得懂但講不通
    "ERR_VALIDATION_FAILED": 422,
    # ★ TTC 2026-10-29：處理紀錄引用的 runId 無效（不存在、非本帳號、已過期或已被使用）
    "ERR_RUN_INVALID": 422,
    "ERR_CONFIG_INVALID": 422,
    # 大包設定檔缺了本次要跑的功能所需的區塊：檔案本身讀得懂，是內容與請求講不通
    "ERR_CONFIG_BLOCK_REQUIRED": 422,
    "ERR_CONFIG_DATA_MISMATCH": 422,
    "ERR_DP_INVALID_BUDGET": 422,
    "ERR_RISK_ROLE_OVERLAP": 422,
    "ERR_RISK_CONFIG_NO_SENSITIVE": 422,
    "ERR_RISK_CONFIG_MULTI_SENSITIVE": 422,
    "ERR_LINK_AB_INCOMPLETE": 422,
    "ERR_LINK_AB_OVERLAP": 422,
    "ERR_SPLIT_INFEASIBLE": 422,
    "ERR_DEID_CONFIG_MISMATCH": 422,
    "ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED": 422,
    # 前處理：清單的欄位名稱資料裡沒有、或功能與該欄的資料型別對不上
    "ERR_PREPROCESS_COLUMN_NOT_FOUND": 422,
    "ERR_PREPROCESS_TYPE_MISMATCH": 422,
    # ★ TTC 2026-11-02（B8）：寫入頻率超過上限
    "ERR_RATE_LIMITED": 429,
    # ★ TTC 2026-10-31：使用者取消運算（沿用 nginx 的 499「用戶端關閉請求」）
    "ERR_CANCELLED": 499,
    # 500：伺服器自身的問題，呼叫方改請求也修不了
    "ERR_INTERNAL": 500,
}

# ── HTTP 狀態碼 → CLI 離開代碼 ──────────────────────────────────────────────
# CLI 沒有狀態碼可回，但腳本需要能分辨失敗的種類，故與 HTTP 分類一一對應。
# 0 保留給成功；1 保留給未預期錯誤（對應 HTTP 500）。
EXIT_OK = 0
EXIT_UNEXPECTED = 1
# 每個用戶端錯誤狀態碼都給一個離開代碼，不留「某些錯誤在 CLI 分不出來」的缺口。
# 404／405 實務上只會由 HTTP 框架產生，CLI 不會用到，列出只是讓對照表沒有空格。
HTTP_STATUS_EXIT_CODE: dict[int, int] = {
    400: 2,
    413: 3,
    415: 4,
    422: 5,
    401: 6,
    404: 7,
    405: 8,
    403: 9,
    409: 10,
    423: 11,
    429: 14,
    499: 13,
}

# verify-log 校驗未全數通過：不是程式出錯（1），也不是請求有誤，另給一個專用代碼，
# 讓呼叫的腳本分得出「日誌有問題」與「指令本身失敗」。
EXIT_AUDIT_UNVERIFIED = 12

# 框架自己產生的錯誤（找不到路徑的 404、方法不符的 405、請求欄位缺漏的 422）
# 沒有經過 PetsError，但回應主體仍須與引擎錯誤同一種形狀，故備一組預設碼。
DEFAULT_CODE_BY_STATUS: dict[int, str] = {
    400: "ERR_BAD_REQUEST",
    401: "ERR_UNAUTHORIZED",
    403: "ERR_FORBIDDEN",
    404: "ERR_NOT_FOUND",
    405: "ERR_METHOD_NOT_ALLOWED",
    409: "ERR_USER_EXISTS",
    413: "ERR_PAYLOAD_TOO_LARGE",
    415: "ERR_UNSUPPORTED_FILE_FORMAT",
    422: "ERR_VALIDATION_FAILED",
    423: "ERR_ACCOUNT_LOCKED",
    429: "ERR_RATE_LIMITED",
    500: "ERR_INTERNAL",
}


def default_code_for_status(status: int) -> str:
    """狀態碼 → 預設錯誤碼；未列出者一律歸為請求錯誤，不讓回應少掉 error_code 欄位。"""
    return DEFAULT_CODE_BY_STATUS.get(status, "ERR_BAD_REQUEST")


class PetsError(ValueError):
    """帶錯誤碼的可預期錯誤。

    繼承 ValueError：引擎的驗證錯誤屬於值錯誤，「except ValueError」的呼叫端一併接得到。

    str(e) 為「ERR_XXX: 說明」格式；要拿結構化內容請用 error_code／message／to_dict()，
    不要比對字串。
    """

    def __init__(
        self,
        error_code: str,
        message: str,
        recommendations: list[str] | None = None,
    ) -> None:
        if error_code not in ERROR_HTTP_STATUS:
            raise KeyError(
                f"未登記的錯誤碼 '{error_code}'，請先加入 app.core.errors.ERROR_HTTP_STATUS。"
            )
        self.error_code = error_code
        self.message = message
        self.recommendations: list[str] = list(recommendations or [])
        super().__init__(f"{error_code}: {message}")

    @property
    def http_status(self) -> int:
        """對應的 HTTP 狀態碼。"""
        return ERROR_HTTP_STATUS[self.error_code]

    @property
    def exit_code(self) -> int:
        """對應的 CLI 離開代碼。"""
        return HTTP_STATUS_EXIT_CODE.get(self.http_status, EXIT_UNEXPECTED)

    def to_dict(self) -> dict[str, object]:
        """API 回應主體：所有端點共用同一種形狀，整合方不必分端點處理。"""
        body: dict[str, object] = {
            "error_code": self.error_code,
            "message": self.message,
        }
        if self.recommendations:
            body["recommendations"] = self.recommendations
        return body
