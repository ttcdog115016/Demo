"""運算中途取消（★ TTC 2026-10-31）。

API 把每次運算的取消旗標（threading.Event）放進 ContextVar，引擎在迴圈的自然斷點呼叫
check_cancelled()；旗標被設起（使用者按「取消運算」或連線中斷）就拋 ERR_CANCELLED，
運算就此停下、釋放運算名額與記憶體，不再把結果算完才丟掉。

CLI 與單元測試沒有設旗標，check_cancelled() 什麼都不做，引擎行為不變。
單一 pandas／scikit-learn 呼叫（如 groupby、RandomForest.fit）無法中途打斷，
最久要等目前這一步做完才會停。
"""
import threading
from contextvars import ContextVar

from app.core.errors import PetsError

_cancel_event: ContextVar[threading.Event | None] = ContextVar("open_pets_cancel_event", default=None)

CANCELLED_MESSAGE = "使用者已取消運算。"


def check_cancelled() -> None:
    """目前這次運算已被取消就拋 ERR_CANCELLED；沒有旗標（CLI、測試）時不做事。"""
    event = _cancel_event.get()
    if event is not None and event.is_set():
        raise PetsError("ERR_CANCELLED", CANCELLED_MESSAGE)


def run_with_cancel_event(event: threading.Event, fn, *args, **kwargs):
    """在目前執行緒設好取消旗標後執行 fn（供 API 丟進執行緒池時使用）。

    不依賴執行緒池是否複製 contextvars：旗標在 worker 執行緒內自行設定、結束時還原。
    """
    token = _cancel_event.set(event)
    try:
        return fn(*args, **kwargs)
    finally:
        _cancel_event.reset(token)
