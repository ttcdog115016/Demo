"""★ TTC 2026-11-02：程式碼審查發現的 API／帳號安全問題（併發、無效輸入）
每項對應審查報告編號（B1…B17），修正前應失敗。
"""
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.api import compute
from app.governance.audit import AuditLogger
from app.governance.auth import LOGIN_MAX_ATTEMPTS, AuthManager
from app.governance.token import TokenManager

BASE = "/api/v1"


# ── B1：並發錯誤密碼不可繞過鎖定 ────────────────────────────────────────


def test_b1_concurrent_wrong_passwords_are_all_counted(tmp_path):
    manager = AuthManager(db_path=str(tmp_path / "users.db"))
    manager.create_user("victim", "right-pass", "user")
    attempts = LOGIN_MAX_ATTEMPTS - 1
    barrier = threading.Barrier(attempts)

    def wrong(i):
        barrier.wait()
        return manager.authenticate("victim", f"wrong-{i}")

    with ThreadPoolExecutor(attempts) as pool:
        list(pool.map(wrong, range(attempts)))
    counts = {u["username"]: u["failed_login_count"] for u in manager.list_users()}
    assert counts["victim"] == attempts


def test_b1_concurrent_burst_ends_locked(tmp_path):
    manager = AuthManager(db_path=str(tmp_path / "users.db"))
    manager.create_user("victim", "right-pass", "user")
    burst = 20
    barrier = threading.Barrier(burst)

    def wrong(i):
        barrier.wait()
        return manager.authenticate("victim", f"wrong-{i}")

    with ThreadPoolExecutor(burst) as pool:
        list(pool.map(wrong, range(burst)))
    assert manager.authenticate("victim", "right-pass").reason == "locked"


# ── B2：同一 refresh token 並發只能換發一次；重複使用撤銷全部 ─────────────


def test_b2_concurrent_refresh_only_one_succeeds(tmp_path):
    AuthManager(db_path=str(tmp_path / "users.db"))  # 建表
    tokens = TokenManager(str(tmp_path / "users.db"))
    old = tokens.issue("admin")
    barrier = threading.Barrier(8)

    def consume(_):
        barrier.wait()
        return tokens.consume(old)

    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(consume, range(8)))
    assert results.count("admin") == 1
    assert results.count(None) == 7


def test_b2_reused_token_revokes_whole_session_family(tmp_path):
    AuthManager(db_path=str(tmp_path / "users.db"))
    tokens = TokenManager(str(tmp_path / "users.db"))
    old = tokens.issue("admin")
    assert tokens.consume(old) == "admin"
    newer = tokens.issue("admin")
    # 舊 token 再次出現＝已外流：該帳號全部 token 作廢
    assert tokens.consume(old) is None
    assert tokens.resolve(newer) is None


def test_b2_refresh_endpoint_rejects_second_use(client, api_auth):
    issued = client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "user123"}
    ).json()["refresh_token"]
    first = client.post(f"{BASE}/auth/refresh", json={"refresh_token": issued})
    second = client.post(f"{BASE}/auth/refresh", json={"refresh_token": issued})
    assert first.status_code == 200
    assert second.status_code == 401
    # 重複使用後，第一次換發得到的新 token 也一併失效
    again = client.post(f"{BASE}/auth/refresh", json={"refresh_token": first.json()["refresh_token"]})
    assert again.status_code == 401


# ── B3：並發寫稽核日誌不可斷鏈 ──────────────────────────────────────────


def test_b3_concurrent_audit_writes_keep_chain_valid(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_PETS_SYSTEM_MASTER_KEY", "audit-test-key")
    log_path = str(tmp_path / "audit.jsonl")
    audit = AuditLogger(log_path=log_path)
    writers = 16
    barrier = threading.Barrier(writers)

    def write(i):
        barrier.wait()
        for j in range(10):
            audit.log_operation("op", "success", {"i": i, "j": j})

    with ThreadPoolExecutor(writers) as pool:
        list(pool.map(write, range(writers)))
    result = audit.verify_audit_log()
    assert result.is_valid, result


def test_b3_last_hash_read_from_tail_of_large_log(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_PETS_SYSTEM_MASTER_KEY", "audit-test-key")
    log_path = str(tmp_path / "audit.jsonl")
    audit = AuditLogger(log_path=log_path)
    audit.log_operation("big", "success", {"blob": "x" * 200_000})  # 單行超過讀尾的區塊大小
    last = audit.log_operation("after", "success", {})
    assert audit.verify_audit_log().is_valid
    assert audit._get_last_hash() == last


# ── B12：取消 handle 衝突 ─────────────────────────────────────────────


def test_b12_handle_owned_by_other_user_is_not_overwritten():
    handle = str(uuid.uuid4())
    owner_event = threading.Event()
    compute._active_runs[handle] = ("alice", owner_event)
    try:
        assert compute._register_run(handle, "mallory", threading.Event()) is False
        assert compute._active_runs[handle] == ("alice", owner_event)
    finally:
        compute._active_runs.pop(handle, None)


def test_b12_finally_only_removes_own_registration():
    handle = str(uuid.uuid4())
    first, second = threading.Event(), threading.Event()
    assert compute._register_run(handle, "alice", first)
    compute._active_runs[handle] = ("alice", second)  # 同一帳號重試，以新的運算取代
    compute._unregister_run(handle, first)
    assert compute._active_runs.get(handle) == ("alice", second)
    compute._unregister_run(handle, second)
    assert handle not in compute._active_runs


# ── B15：改密碼猜舊密碼也要計入鎖定 ──────────────────────────────────


def test_b15_wrong_current_password_counts_toward_lockout(client, api_auth, login):
    headers = login("user", "user123")
    for _ in range(LOGIN_MAX_ATTEMPTS):
        client.patch(
            f"{BASE}/auth/password",
            json={"current_password": "guess", "new_password": "whatever-new"},
            headers=headers,
        )
    resp = client.patch(
        f"{BASE}/auth/password",
        json={"current_password": "user123", "new_password": "whatever-new"},
        headers=headers,
    )
    assert resp.status_code == 423


# ── B6：歷史紀錄不可存入 NaN；過大拒收 ─────────────────────────────────


def _run_id_for(username):
    from app.governance.system_store import get_system_store

    run_id = uuid.uuid4().hex
    get_system_store().add_run(run_id, username, "POST /k-anonymity", 200)
    return run_id


def test_b6_history_with_nan_rejected_and_listing_still_works(client, api_auth, login):
    headers = login("user", "user123")
    run_id = _run_id_for("user")
    body = '{"runId": "%s", "id": "r1", "x": NaN}' % run_id
    resp = client.post(
        f"{BASE}/history", content=body, headers={**headers, "Content-Type": "application/json"}
    )
    assert resp.status_code == 400
    assert client.get(f"{BASE}/history", headers=headers).status_code == 200
    # 驗證失敗不得消耗 run：修正內容後可用同一個 runId 重送
    ok = client.post(f"{BASE}/history", json={"runId": run_id, "id": "r1", "x": 1}, headers=headers)
    assert ok.status_code == 201, ok.text


def test_b6_oversized_history_rejected(client, api_auth, login):
    headers = login("user", "user123")
    resp = client.post(
        f"{BASE}/history",
        json={"runId": _run_id_for("user"), "id": "big", "blob": "x" * 400_000},
        headers=headers,
    )
    assert resp.status_code in (400, 413, 422)


# ── B7：登入欄位長度上限 ───────────────────────────────────────────────


def test_b7_login_rejects_oversized_fields(client, api_auth):
    resp = client.post(
        f"{BASE}/auth/login", json={"username": "u" * 10_000, "password": "p"}
    )
    assert resp.status_code == 422
    resp = client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "p" * 100_000}
    )
    assert resp.status_code == 422


# ── B16：上傳上限環境變數 ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw, expected_mb",
    [("0.5", 1), ("1.2", 2), ("inf", 1024), ("nan", 1024), ("-inf", 1024), ("0", 0)],
)
def test_b16_max_upload_parsing(monkeypatch, raw, expected_mb):
    from app.core.settings import get_max_upload_bytes

    monkeypatch.setenv("OPEN_PETS_MAX_UPLOAD_MB", raw)
    assert get_max_upload_bytes() == expected_mb * 1024 * 1024


# ── B17：since 參數界限 ────────────────────────────────────────────────


def test_b17_system_logs_since_out_of_range_is_422_not_500(client, api_auth, login):
    resp = client.get(f"{BASE}/system-logs", params={"since": 10**20}, headers=login())
    assert resp.status_code == 422


# ── B13：處理端點稽核紀錄帶操作者 ──────────────────────────────────────


def test_b13_processing_audit_records_operator(client, sample_csv_bytes, kanon_bundle, monkeypatch):
    captured = []
    from app.governance import audit as audit_module

    real = audit_module.AuditLogger.log_operation

    def spy(self, operation, status, params, user=None):
        captured.append((operation, user))
        return real(self, operation, status, params, user=user)

    monkeypatch.setattr(audit_module.AuditLogger, "log_operation", spy)
    monkeypatch.setenv("OPEN_PETS_DEFAULT_SALT", "test_salt")
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={"file": ("d.csv", sample_csv_bytes, "text/csv"),
               "config": ("c.json", kanon_bundle, "application/json")},
    )
    assert resp.status_code == 200, resp.text
    assert ("k_anonymity", "test-processing-user") in captured
