"""重運算不卡住事件迴圈（app.api.compute）。

引擎若直接在 async 路由裡跑，運算期間整個服務停擺，連 token 更新、健康檢查都回不了，
使用者看到的就是「運算沒有回應」。這裡把引擎換成會睡幾秒的版本，確認運算期間其他請求照常回應。
"""
import asyncio
import time

import httpx
import pytest

from app.api import deid_router
from app.api.server import app

ENGINE_SECONDS = 2.0


def _config(payload, filename="config.json"):
    return (filename, payload, "application/json")


@pytest.fixture
def slow_k_anonymity(monkeypatch):
    real_engine = deid_router.run_k_anonymity

    def _slow(*args, **kwargs):
        time.sleep(ENGINE_SECONDS)  # 模擬吃 CPU 的長時間運算（阻塞所在執行緒）
        return real_engine(*args, **kwargs)

    monkeypatch.setattr(deid_router, "run_k_anonymity", _slow)


def test_other_requests_respond_while_computing(slow_k_anonymity, sample_csv_bytes, kanon_bundle):
    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=30) as http:
            compute_task = asyncio.create_task(http.post(
                "/api/v1/k-anonymity",
                files={"file": ("data.csv", sample_csv_bytes, "text/csv"), "config": _config(kanon_bundle)},
            ))
            # 計時從等待前開始：事件迴圈若被運算卡住，連這段 sleep 都要等運算結束才醒
            started = time.perf_counter()
            await asyncio.sleep(0.3)  # 讓運算先開始
            health = await http.get("/")
            health_seconds = time.perf_counter() - started
            compute_resp = await compute_task
            return health, health_seconds, compute_resp

    health, health_seconds, compute_resp = asyncio.run(scenario())
    assert health.status_code == 200
    assert health_seconds < 0.3 + ENGINE_SECONDS / 2, f"運算期間其他請求等了 {health_seconds:.2f} 秒"
    assert compute_resp.status_code == 200
    assert "X-Quality-Report" in compute_resp.headers


def test_computations_run_one_at_a_time(monkeypatch, sample_csv_bytes, kanon_bundle):
    """同時送兩個運算：依序執行，不會兩個一起搶 CPU／記憶體。"""
    real_engine = deid_router.run_k_anonymity
    running = 0
    max_running = 0

    def _tracked(*args, **kwargs):
        nonlocal running, max_running
        running += 1
        max_running = max(max_running, running)
        try:
            time.sleep(0.5)
            return real_engine(*args, **kwargs)
        finally:
            running -= 1

    monkeypatch.setattr(deid_router, "run_k_anonymity", _tracked)

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=30) as http:
            def post():
                return http.post(
                    "/api/v1/k-anonymity",
                    files={"file": ("data.csv", sample_csv_bytes, "text/csv"), "config": _config(kanon_bundle)},
                )

            return await asyncio.gather(post(), post())

    responses = asyncio.run(scenario())
    assert [resp.status_code for resp in responses] == [200, 200]
    assert max_running == 1
