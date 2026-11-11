"""★ TTC 2026-11-02（資安掃描 2-4／B14）：跨網域與 Host 限制
涵蓋：
  - 未設定 OPEN_PETS_CORS_ORIGINS：不回 Access-Control-Allow-Origin（其他網站不能讀取本機後端的回應）
  - 設定白名單：只回清單內的來源，且不帶 credentials
  - 設定 OPEN_PETS_ALLOWED_HOSTS：外來 Host 回 400（防 DNS rebinding），本機位址正常
  - 正式 app 預設（未設定兩個變數）同源呼叫照常
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.server import register_cross_origin_policy


def _build_app() -> FastAPI:
    test_app = FastAPI()

    @test_app.get("/ping")
    def ping():
        return {"ok": True}

    register_cross_origin_policy(test_app)
    return test_app


def _preflight(client: TestClient, origin: str):
    return client.options(
        "/ping",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )


def test_no_cors_when_origins_not_configured(monkeypatch):
    monkeypatch.delenv("OPEN_PETS_CORS_ORIGINS", raising=False)
    monkeypatch.delenv("OPEN_PETS_ALLOWED_HOSTS", raising=False)
    client = TestClient(_build_app())
    resp = client.get("/ping", headers={"Origin": "https://evil.example"})
    assert resp.status_code == 200
    assert "access-control-allow-origin" not in resp.headers
    assert "access-control-allow-origin" not in _preflight(client, "https://evil.example").headers


def test_cors_allows_only_listed_origins_without_credentials(monkeypatch):
    monkeypatch.setenv("OPEN_PETS_CORS_ORIGINS", "https://demo.example.com, https://other.example.com")
    client = TestClient(_build_app())
    allowed = client.get("/ping", headers={"Origin": "https://demo.example.com"})
    assert allowed.headers["access-control-allow-origin"] == "https://demo.example.com"
    assert "access-control-allow-credentials" not in allowed.headers
    denied = client.get("/ping", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in denied.headers


def test_trusted_hosts_reject_foreign_host(monkeypatch):
    monkeypatch.setenv("OPEN_PETS_ALLOWED_HOSTS", "127.0.0.1,localhost")
    client = TestClient(_build_app())
    assert client.get("/ping", headers={"Host": "evil.example:8765"}).status_code == 400
    assert client.get("/ping", headers={"Host": "127.0.0.1:8765"}).status_code == 200
    assert client.get("/ping", headers={"Host": "localhost:8765"}).status_code == 200


def test_production_app_same_origin_unaffected_by_default(client):
    resp = client.get("/", headers={"Origin": "https://evil.example"})
    assert resp.status_code == 200
    assert "access-control-allow-origin" not in resp.headers
