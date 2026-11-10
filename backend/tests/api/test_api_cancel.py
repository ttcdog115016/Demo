"""★ TTC 2026-10-31：取消運算（app.api.compute、app.core.cancellation）
涵蓋：
  - 前端呼叫 POST /runs/{handle}/cancel：運算於下一個斷點停下、回 499，運算名額立即釋放
  - 只能取消自己的運算；已結束的 handle 回 cancelled=false
  - 用戶端中斷連線：背景偵測到即設起取消旗標
  - 沒有旗標（CLI、單元測試）時 check_cancelled 不做事
"""
import asyncio
import threading
import time
import uuid

import httpx
import pytest

from app.api import compute, deid_router
from app.api.server import app
from app.core.cancellation import check_cancelled, run_with_cancel_event
from app.core.errors import PetsError

STEP_SECONDS = 0.05
STEPS = 100  # 不取消要跑 5 秒


def _config(payload):
    return ("config.json", payload, "application/json")


@pytest.fixture
def cancellable_k_anonymity(monkeypatch):
    real_engine = deid_router.run_k_anonymity

    def _slow(*args, **kwargs):
        for _ in range(STEPS):
            check_cancelled()
            time.sleep(STEP_SECONDS)
        return real_engine(*args, **kwargs)

    monkeypatch.setattr(deid_router, "run_k_anonymity", _slow)
    return real_engine


def test_cancel_endpoint_stops_computation_and_frees_slot(
    cancellable_k_anonymity, monkeypatch, sample_csv_bytes, kanon_bundle
):
    handle = str(uuid.uuid4())

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=30) as http:
            def post(headers=None):
                return http.post(
                    "/api/v1/k-anonymity",
                    files={"file": ("data.csv", sample_csv_bytes, "text/csv"), "config": _config(kanon_bundle)},
                    headers=headers or {},
                )

            started = time.perf_counter()
            first = asyncio.create_task(post({compute.CLIENT_RUN_ID_HEADER: handle}))
            await asyncio.sleep(0.3)
            cancel = await http.post(f"/api/v1/runs/{handle}/cancel")
            first_resp = await first
            first_seconds = time.perf_counter() - started

            # 名額已釋放：下一個請求（引擎不再拖時間）立刻開跑
            monkeypatch.setattr(deid_router, "run_k_anonymity", cancellable_k_anonymity)
            second_started = time.perf_counter()
            second_resp = await post()
            return cancel, first_resp, first_seconds, second_resp, time.perf_counter() - second_started

    cancel, first_resp, first_seconds, second_resp, second_seconds = asyncio.run(scenario())
    assert cancel.status_code == 200 and cancel.json() == {"cancelled": True}
    assert first_resp.status_code == 499
    assert first_resp.json()["error_code"] == "ERR_CANCELLED"
    assert first_seconds < STEPS * STEP_SECONDS / 2, f"取消後仍跑了 {first_seconds:.2f} 秒"
    assert second_resp.status_code == 200
    assert second_seconds < STEPS * STEP_SECONDS / 2
    assert handle not in compute._active_runs


def test_cancel_unknown_handle_returns_false(client):
    resp = client.post(f"/api/v1/runs/{uuid.uuid4()}/cancel")
    assert resp.status_code == 200
    assert resp.json() == {"cancelled": False}


def test_cannot_cancel_someone_elses_run(client):
    handle = str(uuid.uuid4())
    event = threading.Event()
    compute._active_runs[handle] = ("someone-else", event)
    try:
        resp = client.post(f"/api/v1/runs/{handle}/cancel")
        assert resp.status_code == 403
        assert not event.is_set()
    finally:
        compute._active_runs.pop(handle, None)


def test_invalid_handle_header_is_ignored():
    class _Req:
        headers = {compute.CLIENT_RUN_ID_HEADER: "../../etc"}

    assert compute._client_handle(_Req()) is None


def test_disconnect_sets_cancel_flag():
    class _Req:
        calls = 0

        async def receive(self):
            self.calls += 1
            return {"type": "http.request", "body": b""} if self.calls < 2 else {"type": "http.disconnect"}

    event = threading.Event()
    asyncio.run(asyncio.wait_for(compute._watch_disconnect(_Req(), event), timeout=5))
    assert event.is_set()


def test_check_cancelled_is_noop_without_flag():
    check_cancelled()  # CLI／單元測試沒有旗標，不得拋錯


def test_check_cancelled_raises_when_flag_set():
    event = threading.Event()
    event.set()
    with pytest.raises(PetsError) as exc_info:
        run_with_cancel_event(event, check_cancelled)
    assert exc_info.value.error_code == "ERR_CANCELLED"
    check_cancelled()  # 旗標只作用於該次執行，結束後還原
