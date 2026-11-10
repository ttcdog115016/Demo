"""部署層級環境設定（.env）。

集中管理「伺服器端」的秘密與預設值（如預設 HMAC 鹽值），
與資料欄位設定（config.py 的 ColumnConfig）屬不同層次：
這裡是部署者設定一次的東西，不是使用者每次請求帶的東西。
"""
import logging
import math
import os
import warnings

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# 匯入時載入專案根目錄的 .env；檔案不存在時安靜略過，
# 且不覆蓋既有的作業系統環境變數（環境變數優先於 .env）
# 以 utf-8-sig 讀取：Windows 記事本存成 UTF-8 會在檔頭寫入 BOM，該三個位元組會被
# 併進第一行的變數名（成為 "﻿OPEN_PETS_..."），使該變數讀不到卻無任何錯誤訊息。
# utf-8-sig 有 BOM 則去除、無 BOM 亦照常解析，故一律以此讀取。
load_dotenv(encoding="utf-8-sig")

DEFAULT_SALT_ENV = "OPEN_PETS_DEFAULT_SALT"
SYSTEM_MASTER_KEY_ENV = "OPEN_PETS_SYSTEM_MASTER_KEY"
DATA_DIR_ENV = "OPEN_PETS_DATA_DIR"
MAX_UPLOAD_MB_ENV = "OPEN_PETS_MAX_UPLOAD_MB"
JWT_SECRET_ENV = "OPEN_PETS_JWT_SECRET"
# ★ TTC 2026-11-02（資安掃描 2-4）：跨網域與 Host 白名單（逗號分隔）。未設定＝不開放跨網域、不限制 Host。
CORS_ORIGINS_ENV = "OPEN_PETS_CORS_ORIGINS"
ALLOWED_HOSTS_ENV = "OPEN_PETS_ALLOWED_HOSTS"
# ★ TTC 2026-10-30：API 以 source 欄位讀伺服器本機檔案時允許的目錄（以作業系統路徑分隔字元
#   分隔多個，Windows 為「;」、Linux 為「:」）。未設定即停用，只收上傳檔案。
ALLOWED_SOURCE_DIRS_ENV = "OPEN_PETS_ALLOWED_SOURCE_DIRS"

# 系統日誌（application log）的三個環境變數。名稱集中列在此處與上面五個並列，
# 讓部署者與交付文件有單一清單可看；讀取與解讀的邏輯在 core/logging_setup.py。
# ★這三個只作用於系統日誌，與稽核軌跡無關——稽核的落點由 OPEN_PETS_DATA_DIR 決定，
# 且不開放以日誌設定關閉或改寫。
LOG_FILE_ENV = "OPEN_PETS_LOG_FILE"
LOG_LEVEL_ENV = "OPEN_PETS_LOG_LEVEL"
LOG_CONFIG_ENV = "OPEN_PETS_LOG_CONFIG"

# 未設定 OPEN_PETS_DATA_DIR 時，資料落在「執行時工作目錄」下的這個子目錄。
DEFAULT_DATA_DIRNAME = "data"

# 上傳大小上限的內建預設（MB）。實測 500 萬筆 × 10 欄的 CSV 約 430~540 MB，
# 故預設留到 1024 MB，既容得下規格要求的資料規模，又不至於讓單一請求無上限吃記憶體。
DEFAULT_MAX_UPLOAD_MB = 1024


def get_default_salt() -> str | None:
    """回傳伺服器端預設鹽值；未設定（或設為空字串）時回傳 None，由呼叫端決定如何處置。"""
    value = os.getenv(DEFAULT_SALT_ENV)
    return value if value else None


def get_system_master_key() -> str | None:
    """回傳審計日誌 HMAC 防篡改用的系統主金鑰；未設定（或空字串）時回傳 None。

    金鑰一律由部署者於 .env 設定、不寫死於原始碼——本專案開源，寫死金鑰等同於
    任何人都能用同一把金鑰重算整條鏈式雜湊、把竄改後的日誌補簽，防篡改形同虛設。
    缺值時回傳 None，由呼叫端（AuditLogger）決定如何處置。
    """
    value = os.getenv(SYSTEM_MASTER_KEY_ENV)
    return value if value else None


def get_jwt_secret() -> str | None:
    """回傳會員系統簽發 access token 用的簽章金鑰；未設定（或空字串）時回傳 None。

    比照 OPEN_PETS_SYSTEM_MASTER_KEY：金鑰一律由部署者於 .env 設定、不寫死於原始碼，
    本專案開源，寫死等同於任何人都能自行簽出一張看似合法的 token。

    缺值時不由程式隨機生成——每次重啟都會換一把，已登入者全數被踢出且查不出原因；
    也不使整台服務啟動失敗，故一律回傳 None，由呼叫端（governance.token）停用
    /auth 與 /users 兩組端點。
    ★ TTC 2026-10-29：處理端點改須登入（api/processing_guard），未設定金鑰時處理端點同樣回 503。
    """
    value = os.getenv(JWT_SECRET_ENV)
    return value if value else None


def get_data_dir() -> str:
    """回傳存放執行期資料（使用者資料庫、審計日誌）的目錄絕對路徑。

    這類檔案是「部署環境的資料」而非「程式碼的一部分」，寫進套件安裝目錄會在
    唯讀安裝、容器映像、多實例共用同一份程式碼時失敗或互相污染，也讓稽核日誌
    無法與程式碼分離保管。故一律由部署者以 OPEN_PETS_DATA_DIR 指定；未設定時
    退到執行時工作目錄下的 data/，並告知實際落點（不落在套件目錄）。
    """
    value = os.getenv(DATA_DIR_ENV)
    if value:
        return os.path.abspath(value)

    fallback = os.path.abspath(os.path.join(os.getcwd(), DEFAULT_DATA_DIRNAME))
    # 報告透明：系統替使用者決定了資料落點，須告知。
    # warnings 預設同一位置只顯示一次，不會逐次洗版。
    message = (
        f"未設定環境變數 {DATA_DIR_ENV}，使用者資料庫與審計日誌將寫入 {fallback}。"
        "正式部署請於 .env 指定可寫入且與程式碼分離的目錄。"
    )
    logger.warning(message)
    warnings.warn(message, stacklevel=2)
    return fallback


def get_allowed_source_dirs() -> list[str]:
    """回傳 API 可讀取伺服器本機資料來源的目錄（絕對、已解析符號連結）；未設定回傳空串列。

    source 欄位等於讓登入者指定伺服器上的任意路徑，不設範圍時連使用者資料庫
    （含密碼雜湊與 refresh token）都讀得到，故預設停用，由部署者明確開放特定目錄。
    """
    raw = os.getenv(ALLOWED_SOURCE_DIRS_ENV) or ""
    return [os.path.realpath(p) for p in raw.split(os.pathsep) if p.strip()]


def _split_env_list(name: str) -> list[str]:
    return [item.strip() for item in (os.getenv(name) or "").split(",") if item.strip()]


def get_cors_origins() -> list[str]:
    """允許跨網域呼叫 API 的來源；未設定回傳空串列（不掛 CORS，只接受同源）。

    .exe、線上 demo（Vite proxy）、nginx 部署都是同源，不需要 CORS。原本 allow_origins=["*"]
    加上 allow_credentials，使用者瀏覽的任何網站都能呼叫本機後端並讀取回應。
    """
    return _split_env_list(CORS_ORIGINS_ENV)


def get_allowed_hosts() -> list[str]:
    """允許的 Host 標頭（防 DNS rebinding）；未設定回傳空串列（不限制）。單機版由 launcher 設為本機位址。"""
    return _split_env_list(ALLOWED_HOSTS_ENV)


def get_max_upload_bytes() -> int:
    """回傳單次請求允許的最大位元組數；部署方可用環境變數調整。

    上限的用意是讓「檔案太大」成為一個講得清楚的拒絕（413），而不是讓伺服器
    整包讀完後才中斷。設為 0 或負數代表部署方明確要求不設限。
    值無法解讀時回退內建預設，不讓一個打錯的環境變數擋下整台服務。
    """
    raw = os.getenv(MAX_UPLOAD_MB_ENV)
    if raw is None or not raw.strip():
        mb = DEFAULT_MAX_UPLOAD_MB
    else:
        try:
            value = float(raw)
            if not math.isfinite(value):
                raise ValueError(raw)
            # ★ TTC 2026-11-02：小數無條件進位（原本 0.5 取整成 0＝不設限）；inf／nan 原本讓每個請求 500
            mb = math.ceil(value) if value > 0 else 0
        except ValueError:
            mb = DEFAULT_MAX_UPLOAD_MB
            # 報告透明：部署者以為自己設了上限，實際被系統換成預設值，不告知會查不出來。
            message = (
                f"環境變數 {MAX_UPLOAD_MB_ENV} 的值 {raw!r} 無法解讀為數字，"
                f"已改用預設上限 {DEFAULT_MAX_UPLOAD_MB} MB。"
            )
            logger.warning(message)
            warnings.warn(message, stacklevel=2)
    return mb * 1024 * 1024 if mb > 0 else 0
