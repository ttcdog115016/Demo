"""
★ TTC 2026-11-04：前處理雜湊預覽端點 POST /api/v1/preprocess/hash-preview
涵蓋：
  - 結果與 /preprocess 實際處理輸出相同（伺服器預設鹽值、自訂鹽值）
  - 須登入
  - use_timestamp、數量與長度上限、錯誤演算法皆擋
  - 不記 run（不算處理端點）
"""
import io
import json

import pandas as pd

URL = "/api/v1/preprocess/hash-preview"


def _preprocess_hash(client, values, params):
    csv_bytes = pd.DataFrame({"編號": values}).to_csv(index=False).encode("utf-8")
    config = {"preprocess": {"enabled": True, "columns": [{"column": "編號", "actions": [{"action": "hash", "params": params}]}]}}
    resp = client.post(
        "/api/v1/preprocess",
        files={
            "file": ("data.csv", csv_bytes, "text/csv"),
            "config": ("config.json", json.dumps(config).encode("utf-8"), "application/json"),
        },
    )
    assert resp.status_code == 200, resp.text
    return list(pd.read_csv(io.BytesIO(resp.content), dtype=str)["編號"])


def test_preview_matches_actual_preprocess_with_server_salt(client, monkeypatch):
    """沒給 salt＝伺服器預設鹽值：預覽與實際處理結果相同，且確實有加鹽。"""
    monkeypatch.setenv("OPEN_PETS_DEFAULT_SALT", "server-secret")
    values = ["宋淑偉", "M382671122"]
    resp = client.post(URL, json={"values": values, "algorithm": "sha3-256"})
    assert resp.status_code == 200, resp.text
    hashes = resp.json()["hashes"]
    assert hashes == _preprocess_hash(client, values, {"algorithm": "sha3-256"})
    assert "server-secret" not in resp.text

    monkeypatch.setenv("OPEN_PETS_DEFAULT_SALT", "another-secret")
    other = client.post(URL, json={"values": values, "algorithm": "sha3-256"}).json()["hashes"]
    assert other != hashes


def test_preview_matches_actual_preprocess_with_custom_salt_and_algorithm(client):
    values = ["A001"]
    resp = client.post(URL, json={"values": values, "algorithm": "sha3-512", "salt": "custom"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["hashes"] == _preprocess_hash(client, values, {"salt": "custom", "algorithm": "sha3-512"})
    assert len(resp.json()["hashes"][0]) == 128


def test_preview_empty_salt_means_server_salt(client, monkeypatch):
    monkeypatch.setenv("OPEN_PETS_DEFAULT_SALT", "server-secret")
    empty = client.post(URL, json={"values": ["A001"], "salt": ""}).json()["hashes"]
    omitted = client.post(URL, json={"values": ["A001"]}).json()["hashes"]
    assert empty == omitted


def test_preview_rejects_timestamp_salt(client):
    resp = client.post(URL, json={"values": ["A001"], "salt": "use_timestamp"})
    assert resp.status_code == 400


def test_preview_rejects_unknown_algorithm(client):
    resp = client.post(URL, json={"values": ["A001"], "algorithm": "md5"})
    assert resp.status_code == 400


def test_preview_limits_count_and_length(client):
    too_many = client.post(URL, json={"values": ["x"] * 21})
    too_long = client.post(URL, json={"values": ["x" * 257]})
    assert too_many.status_code in (400, 422)
    assert too_long.status_code == 400


def test_preview_requires_login(client, api_auth, real_processing_auth, login):
    assert client.post(URL, json={"values": ["A001"]}).status_code == 401
    resp = client.post(URL, json={"values": ["A001"]}, headers=login())
    assert resp.status_code == 200, resp.text


def test_preview_is_not_logged_as_processing_run():
    from app.api.processing_guard import PROCESSING_PATHS

    assert "/preprocess/hash-preview" not in PROCESSING_PATHS
