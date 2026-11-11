import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.auth_router import router as auth_router
from app.api.compute import build_cancel_router
from app.api.deid_router import router as deid_router
from app.api.errors import register_error_handlers, register_upload_limit
from app.api.preprocess_router import router as preprocess_router
from app.api.processing_guard import register_processing_logging, require_processing_user
from app.api.risk_router import router as risk_router
from app.api.system_router import router as system_router
from app.api.users_router import router as users_router
from app.core.logging_setup import configure_logging
from app.core.settings import DEFAULT_SALT_ENV, get_allowed_hosts, get_cors_origins, get_default_salt
from app.governance.token import log_availability

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 系統日誌的落點與格式在此決定一次，之後模組層只管講話（見 core/logging_setup）。
    # 放在 lifespan 最前面：本函式之後的每一句話都應該進得了日誌。
    configure_logging()

    # 溫和提示（不中止服務）：未設定伺服器端預設鹽值時，雜湊一律不加鹽
    if get_default_salt() is None:
        # 注意：勿在此使用 emoji——Windows cp950 主控台無法編碼，會使啟動失敗
        logger.warning(
            "未設定 %s（.env）——假名化與雜湊將不加鹽，可被字典反查。"
            "如需伺服器端預設鹽值，請參考 .env.example 設定。",
            DEFAULT_SALT_ENV,
        )

    # 會員端點可不可用，在啟動當下就講一次——否則要等到有人來登入收到 503
    # 才會發現金鑰沒設，而那個人看到的訊息並不會告訴他缺的是什麼。
    log_availability()
    yield


app = FastAPI(
    title="通用資料去識別化與隱私保護 API 系統",
    description="提供資料前處理、K-匿名化、差分隱私、再識別風險評估與會員帳號管理服務。",
    version="2.0.0",
    lifespan=lifespan,
)

# 錯誤回應的形狀與狀態碼統一在此掛載
register_upload_limit(app)
register_error_handlers(app)
# ★ TTC 2026-10-29：處理端點呼叫紀錄（日誌＋X-Run-Id），見 api/processing_guard
register_processing_logging(app)


def register_cross_origin_policy(target_app: FastAPI) -> None:
    """★ TTC 2026-11-02（資安掃描 2-4／B14）：跨網域與 Host 限制，依環境變數設定。

    - OPEN_PETS_CORS_ORIGINS 未設定：不掛 CORS，只接受同源（.exe、Vite proxy、nginx 皆同源）。
      有設定：只允許清單內來源，且不帶 credentials（前端以 Authorization 標頭傳 token，不用 cookie）。
    - OPEN_PETS_ALLOWED_HOSTS 有設定：Host 不在清單內一律 400（擋 DNS rebinding）；單機版由 launcher 設定。
    須在其他中介層之後加入：後加入者在最外層，連上傳上限的 413 也會帶正確的 CORS 標頭。
    """
    cors_origins = get_cors_origins()
    if cors_origins:
        target_app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
            # ★ TTC 2026-10-29：前端需讀取的回應標頭（同源部署不受影響；跨網域時才需要）
            expose_headers=["X-Run-Id", "X-Quality-Report", "X-Budget-Report", "Content-Disposition", "Retry-After"],
        )
    allowed_hosts = get_allowed_hosts()
    if allowed_hosts:
        target_app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)


register_cross_origin_policy(app)

# 掛載路由：各路由保留完整路徑，統一掛在同一個版本前綴下
# ★ TTC 2026-10-29：處理端點改須登入（原本不掛身分驗證，透過公開網址任何人都能呼叫）
_processing_auth = [Depends(require_processing_user)]
app.include_router(preprocess_router, prefix="/api/v1", dependencies=_processing_auth)
app.include_router(deid_router, prefix="/api/v1", dependencies=_processing_auth)
app.include_router(risk_router, prefix="/api/v1", dependencies=_processing_auth)
# ★ TTC 2026-10-31：取消進行中的運算（見 api/compute）
app.include_router(build_cancel_router(require_processing_user), prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
# ★ TTC 2026-10-29：處理紀錄、系統維運日誌、系統設定、系統公告
app.include_router(system_router, prefix="/api/v1")


@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Open-PETs backend system",
        "version": "2.0.0",
    }
