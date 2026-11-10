"""處理 API 的登入要求與呼叫紀錄（★ TTC 2026-10-29）。

原本前處理、去識別化、差分隱私、風險評估、報告端點不掛身分驗證，透過公開網址任何人都能呼叫，
處理紀錄也無從證明真的跑過。改為：
  1. require_processing_user：掛在處理路由上（server.py include_router 的 dependencies），未登入回 401。
  2. 中介層：每次呼叫由後端自行寫系統維運日誌（帳號、成功／失敗、HTTP 狀態、耗時；origin=server），
     並記一筆 run、回應標頭帶 X-Run-Id——前端存處理紀錄時須引用（見 system_router.add_history）。
路由檔本身不改：相依與中介層都在 server.py 掛上，引擎與既有端點邏輯不受影響。
"""

import time
import uuid

from fastapi import Depends, FastAPI, Request

from app.api.auth_router import get_current_user
from app.governance.system_store import get_system_store

# 需登入的處理端點（相對 /api/v1）
PROCESSING_PATHS = frozenset({
    "/preprocess", "/k-anonymity", "/dp", "/risk/k-anonymity", "/risk/dp", "/risk/cap", "/report",
})
API_PREFIX = "/api/v1"


def require_processing_user(request: Request, user: dict = Depends(get_current_user)) -> dict:
    """處理端點的登入要求；把帳號記在 request.state，供中介層寫日誌與 run。"""
    request.state.processing_user = user["username"]
    request.state.processing_user_id = user.get("user_id")  # ★ TTC 2026-11-02（B5）
    return user


def processing_operator(request: Request) -> str | None:
    """處理端點的登入帳號（★ TTC 2026-11-02：寫入稽核紀錄的操作者；原本處理端點的稽核紀錄沒有操作者）。"""
    return getattr(request.state, "processing_user", None)


def register_processing_logging(app: FastAPI) -> None:
    @app.middleware("http")
    async def _log_processing_call(request: Request, call_next):
        path = request.url.path
        if not (path.startswith(API_PREFIX) and path[len(API_PREFIX):] in PROCESSING_PATHS):
            return await call_next(request)

        started_at = time.perf_counter()
        response = await call_next(request)
        username = getattr(request.state, "processing_user", None)
        if username is None:
            # 未登入（401）或金鑰未設定：不記 run，也不寫日誌（避免未登入者灌爆日誌）
            return response

        elapsed_seconds = time.perf_counter() - started_at
        source = f"{request.method} {path}"
        status = response.status_code
        try:
            store = get_system_store()
            if status == 499:
                # ★ TTC 2026-10-31：使用者取消運算不算失敗
                store.add_log("INFO", f"使用者已取消運算（耗時 {elapsed_seconds:.1f} 秒）", source, username)
            elif 200 <= status < 300:
                run_id = uuid.uuid4().hex
                store.add_run(run_id, username, source, status, user_id=getattr(request.state, "processing_user_id", None))
                response.headers["X-Run-Id"] = run_id
                store.add_log("INFO", f"後端 API 呼叫成功（HTTP {status}，耗時 {elapsed_seconds:.1f} 秒）", source, username)
            else:
                store.add_log(
                    "WARN" if status < 500 else "ERROR",
                    f"後端 API 呼叫失敗（HTTP {status}，耗時 {elapsed_seconds:.1f} 秒）",
                    source, username,
                )
        except Exception:  # noqa: BLE001 — 紀錄失敗不影響處理結果回傳
            pass
        return response
