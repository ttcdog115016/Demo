"""重運算的排程：把引擎呼叫移出事件迴圈，並限制同時只跑一個。

路由都是 async def，引擎（K-匿名、差分隱私、三攻擊、CAP）若直接在裡面呼叫，運算期間
事件迴圈完全停擺，連 token 更新、讀設定、健康檢查都回不了，畫面看起來像「沒有回應」。
這裡改丟執行緒池，事件迴圈照常服務其他請求。

同時只跑一個：兩個運算會互搶 CPU 與記憶體，兩邊都更慢。

★ TTC 2026-10-31：取消運算。每次運算配一個取消旗標（見 core/cancellation），兩種情況會設起：
  1. 用戶端中斷連線（前端 abort）：背景等待下一個 ASGI 訊息。表單在進入路由前已讀完，
     之後伺服器只會送來 http.disconnect。不用 request.is_disconnected()：它在已取消的
     scope 內讀取，經過 @app.middleware("http") 中介層時永遠讀不到斷線訊息（實測不生效）。
  2. 前端呼叫 POST /runs/{handle}/cancel：handle 由前端以 X-Client-Run-Id 標頭帶入。
     走 cloudflared 等代理時連線中斷不一定傳得到後端，這條路徑確保取消一定送達。
引擎在迴圈斷點檢查旗標，被取消就拋 ERR_CANCELLED（499），運算名額立刻釋放給下一個請求。
排隊中就被取消的請求，輪到時不開算。
"""
import asyncio
import logging
import re
import threading
from collections.abc import Callable
from typing import TypeVar

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from app.core.cancellation import CANCELLED_MESSAGE, run_with_cancel_event
from app.core.errors import PetsError

T = TypeVar("T")
logger = logging.getLogger(__name__)

CLIENT_RUN_ID_HEADER = "X-Client-Run-Id"
_HANDLE_PATTERN = re.compile(r"^[0-9a-fA-F-]{32,36}$")

_compute_slot = asyncio.Semaphore(1)
# 進行中（含排隊中）的運算：handle → (帳號, 取消旗標)
_active_runs: dict[str, tuple[str | None, threading.Event]] = {}


def _client_handle(request: Request) -> str | None:
    handle = request.headers.get(CLIENT_RUN_ID_HEADER, "").strip()
    return handle if _HANDLE_PATTERN.match(handle) else None


async def _watch_disconnect(request: Request, event: threading.Event) -> None:
    while not event.is_set():
        message = await request.receive()
        if message["type"] == "http.disconnect":
            event.set()
            return
        await asyncio.sleep(0)


def _register_run(handle: str, username: str | None, event: threading.Event) -> bool:
    """登記可經取消端點取消的運算；handle 已被其他帳號使用時不登記（★ TTC 2026-11-02）。

    原本直接覆寫：他人送出同一個 handle 即可搶走登記，原主的取消請求反被以 403 拒絕。
    同一帳號重送同一個 handle 則以新的運算取代（前端每輪會產生新 handle，重複僅見於重試）。
    """
    existing = _active_runs.get(handle)
    if existing is not None and existing[0] != username:
        return False
    _active_runs[handle] = (username, event)
    return True


def _unregister_run(handle: str, event: threading.Event) -> None:
    """只移除自己的登記：同一 handle 已被後來的運算取代時保留對方的登記。"""
    existing = _active_runs.get(handle)
    if existing is not None and existing[1] is event:
        del _active_runs[handle]


def _log_watcher_failure(task: asyncio.Task) -> None:
    if not task.cancelled() and task.exception() is not None:
        logger.warning("斷線偵測意外結束，此次運算僅能經取消端點取消：%r", task.exception())


async def run_compute(request: Request, fn: Callable[..., T], *args, **kwargs) -> T:
    """在執行緒池執行 fn；用戶端離線或呼叫取消端點時，引擎於下一個斷點停下。"""
    event = threading.Event()
    handle = _client_handle(request)
    registered = bool(handle) and _register_run(
        handle, getattr(request.state, "processing_user", None), event
    )
    watcher = asyncio.create_task(_watch_disconnect(request, event))
    watcher.add_done_callback(_log_watcher_failure)
    try:
        async with _compute_slot:
            if event.is_set():
                raise PetsError("ERR_CANCELLED", f"{CANCELLED_MESSAGE}（尚未開始運算）")
            return await run_in_threadpool(run_with_cancel_event, event, fn, *args, **kwargs)
    finally:
        watcher.cancel()
        if registered:
            _unregister_run(handle, event)


def cancel_run(handle: str, username: str) -> bool:
    """取消自己進行中（或排隊中）的運算；找不到（已結束）回傳 False。"""
    entry = _active_runs.get(handle)
    if entry is None:
        return False
    owner, event = entry
    if owner is not None and owner != username:
        raise PetsError("ERR_FORBIDDEN", "只能取消自己的運算。")
    event.set()
    return True


def build_cancel_router(require_user: Callable) -> APIRouter:
    """POST /runs/{handle}/cancel；require_user 由 server.py 傳入處理端點的登入要求。"""
    router = APIRouter(tags=["Computation"])

    @router.post("/runs/{handle}/cancel")
    def cancel_computation(handle: str, user: dict = Depends(require_user)):
        return {"cancelled": cancel_run(handle, user["username"])}

    return router
