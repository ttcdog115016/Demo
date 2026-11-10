"""
API - 系統資料端點（★ TTC 2026-10-29）整合測試
涵蓋：處理紀錄（伺服器簽章、runId、不可覆寫）、系統維運日誌（origin、保留開頭、伺服器時間）、系統設定、
帳號清單的鎖定欄位、處理端點須登入並由後端記錄呼叫。
"""
import json

import pytest

from app.governance.system_store import SystemStore

BASE = "/api/v1"


@pytest.fixture(autouse=True)
def system_store(monkeypatch, tmp_path):
    """系統資料庫落在測試專屬暫存目錄，不動到部署環境的 system.db"""
    store = SystemStore(db_path=str(tmp_path / "system.db"))
    monkeypatch.setattr("app.governance.system_store._system_store", store)
    return store


@pytest.fixture
def make_run(system_store):
    """模擬一次處理呼叫，回傳可供處理紀錄引用的 runId。"""
    counter = {"n": 0}

    def _make(username: str = "user", status: int = 200) -> str:
        counter["n"] += 1
        run_id = f"run-{username}-{counter['n']}"
        system_store.add_run(run_id, username, "POST /api/v1/k-anonymity", status)
        return run_id

    return _make


# ──────────────────────────────────────────────────────────────
# 處理紀錄
# ──────────────────────────────────────────────────────────────
def test_history_is_per_user(client, api_auth, login, make_run):
    user_headers = login("user", "user123")
    resp = client.post(
        f"{BASE}/history",
        json={"id": "r1", "runId": make_run("user"), "fileName": "a.csv", "operator": "someone-else", "operatorRole": "admin"},
        headers=user_headers,
    )
    assert resp.status_code == 201
    # 操作者與角色一律以登入帳號為準，不採信前端送來的值
    assert resp.json()["operator"] == "user"
    assert resp.json()["operatorRole"] == "user"

    client.post(f"{BASE}/history", json={"id": "r2", "runId": make_run("admin")}, headers=login())

    records = client.get(f"{BASE}/history", headers=user_headers).json()["records"]
    assert [r["id"] for r in records] == ["r1"]


def test_history_all_is_admin_only(client, api_auth, login, make_run):
    client.post(f"{BASE}/history", json={"id": "r1", "runId": make_run("user")}, headers=login("user", "user123"))
    client.post(f"{BASE}/history", json={"id": "r2", "runId": make_run("admin")}, headers=login())

    assert client.get(f"{BASE}/history?all=1", headers=login("user", "user123")).status_code == 403
    records = client.get(f"{BASE}/history?all=1", headers=login()).json()["records"]
    assert {r["id"] for r in records} == {"r1", "r2"}


def test_history_requires_valid_unused_own_run(client, api_auth, login, make_run):
    headers = login("user", "user123")
    assert client.post(f"{BASE}/history", json={"id": "x1"}, headers=headers).status_code == 422
    assert client.post(f"{BASE}/history", json={"id": "x2", "runId": "nope"}, headers=headers).status_code == 422
    # 別人的 run、失敗的 run 都不行
    assert client.post(f"{BASE}/history", json={"id": "x3", "runId": make_run("admin")}, headers=headers).status_code == 422
    assert client.post(f"{BASE}/history", json={"id": "x4", "runId": make_run("user", status=500)}, headers=headers).status_code == 422

    run_id = make_run("user")
    assert client.post(f"{BASE}/history", json={"id": "x5", "runId": run_id}, headers=headers).status_code == 201
    resp = client.post(f"{BASE}/history", json={"id": "x6", "runId": run_id}, headers=headers)
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ERR_RUN_INVALID"


def test_history_cannot_be_overwritten(client, api_auth, login, make_run):
    headers = login("user", "user123")
    assert client.post(f"{BASE}/history", json={"id": "r1", "runId": make_run("user"), "status": "failed"}, headers=headers).status_code == 201
    resp = client.post(f"{BASE}/history", json={"id": "r1", "runId": make_run("user"), "status": "passed"}, headers=headers)
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "ERR_RECORD_EXISTS"
    # 別人也不能用同一個 id 蓋掉
    assert client.post(f"{BASE}/history", json={"id": "r1", "runId": make_run("admin")}, headers=login()).status_code == 409
    records = client.get(f"{BASE}/history", headers=headers).json()["records"]
    assert records[0]["status"] == "failed"


def test_history_is_signed_and_verifiable(client, api_auth, login, system_store, monkeypatch, make_run):
    monkeypatch.setenv("OPEN_PETS_SYSTEM_MASTER_KEY", "unit-test-master-key")
    headers = login("user", "user123")
    saved = client.post(
        f"{BASE}/history",
        json={"id": "r1", "runId": make_run("user"), "kAnonymity": 5, "integrity": {"inputFileSha256": "aa", "outputFileSha256": "bb"}},
        headers=headers,
    ).json()
    assert saved["integrity"]["algorithm"] == "HMAC-SHA256"
    assert saved["integrity"]["signature"]
    assert saved["integrity"]["inputFileSha256"] == "aa"
    assert client.get(f"{BASE}/history/r1/verify", headers=headers).json()["status"] == "valid"
    # admin 可驗別人的紀錄
    assert client.get(f"{BASE}/history/r1/verify", headers=login()).json()["status"] == "valid"

    # 直接改資料庫裡的內容 → 驗不過
    with system_store._connect() as conn:
        conn.execute("UPDATE history SET payload_json = ? WHERE id = 'r1'", (json.dumps({**saved, "kAnonymity": 50}),))
    assert client.get(f"{BASE}/history/r1/verify", headers=headers).json()["status"] == "tampered"
    # 不存在（或不是本人的）一律 missing
    assert client.get(f"{BASE}/history/nope/verify", headers=headers).json()["status"] == "missing"


def test_history_without_master_key_is_unsigned(client, api_auth, login, monkeypatch, make_run):
    monkeypatch.delenv("OPEN_PETS_SYSTEM_MASTER_KEY", raising=False)
    headers = login("user", "user123")
    saved = client.post(f"{BASE}/history", json={"id": "r9", "runId": make_run("user")}, headers=headers).json()
    assert saved["integrity"]["signature"] is None
    assert saved["integrity"]["unsignedReason"] == "server_key_missing"
    assert client.get(f"{BASE}/history/r9/verify", headers=headers).json()["status"] == "unsigned"


def test_user_list_includes_lock_state(client, api_auth, login):
    for _ in range(5):
        client.post(f"{BASE}/auth/login", json={"username": "user", "password": "wrong"})
    users = {u["username"]: u for u in client.get(f"{BASE}/users", headers=login()).json()["users"]}
    assert users["user"]["login_locked_until"] is not None
    assert users["admin"]["login_locked_until"] is None
    assert users["admin"]["failed_login_count"] == 0


def test_history_requires_login(client, api_auth):
    assert client.get(f"{BASE}/history").status_code == 401


# ──────────────────────────────────────────────────────────────
# 系統維運日誌
# ──────────────────────────────────────────────────────────────
def test_logs_write_by_user_read_by_admin(client, api_auth, login):
    resp = client.post(
        f"{BASE}/system-logs",
        json={"entries": [{"level": "WARN", "event": "閒置逾時，系統自動登出", "source": "user", "ts": 1}]},
        headers=login("user", "user123"),
    )
    assert resp.status_code == 201

    assert client.get(f"{BASE}/system-logs", headers=login("user", "user123")).status_code == 403
    logs = client.get(f"{BASE}/system-logs", headers=login()).json()["logs"]
    idle_log = next(log for log in logs if log["event"] == "閒置逾時，系統自動登出")
    assert idle_log["origin"] == "client" and idle_log["username"] == "user"
    assert idle_log["timestamp"] > 1  # 一律用伺服器時間，不採信前端的 ts

    admin_headers = login()
    assert client.delete(f"{BASE}/system-logs", headers=admin_headers).status_code == 200
    assert client.get(f"{BASE}/system-logs", headers=admin_headers).json()["logs"] == []


def test_client_cannot_post_backend_events(client, api_auth, login):
    headers = login("user", "user123")
    for event in ("後端 API 呼叫成功（HTTP 200）", "使用者登入成功（角色：Admin）", "登入失敗（帳號或密碼錯誤）"):
        resp = client.post(f"{BASE}/system-logs", json={"entries": [{"level": "INFO", "event": event, "source": "x"}]}, headers=headers)
        assert resp.status_code == 400, event
    too_many = [{"level": "INFO", "event": "e", "source": "x"}] * 51
    assert client.post(f"{BASE}/system-logs", json={"entries": too_many}, headers=headers).status_code == 422


def test_login_events_are_logged_by_backend(client, api_auth, system_store):
    client.post(f"{BASE}/auth/login", json={"username": "user", "password": "wrong"})
    tokens = client.post(f"{BASE}/auth/login", json={"username": "user", "password": "user123"}).json()
    client.post(f"{BASE}/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    events = {log["event"]: log for log in system_store.list_logs()}
    assert "登入失敗（帳號或密碼錯誤）" in events
    assert events["使用者登入成功（角色：User）"]["origin"] == "server"
    assert events["使用者登入成功（角色：User）"]["username"] == "user"
    assert events["使用者登出"]["username"] == "user"


# ──────────────────────────────────────────────────────────────
# 處理端點須登入，並由後端記錄呼叫與 run
# ──────────────────────────────────────────────────────────────
def _kanon_files(sample_csv_bytes, kanon_bundle) -> dict:
    return {"file": ("data.csv", sample_csv_bytes, "text/csv"), "config": ("config.json", kanon_bundle, "application/json")}


def test_processing_requires_login(client, api_auth, real_processing_auth, sample_csv_bytes, kanon_bundle):
    resp = client.post(f"{BASE}/k-anonymity", files=_kanon_files(sample_csv_bytes, kanon_bundle))
    assert resp.status_code == 401
    assert resp.json()["error_code"] == "ERR_UNAUTHORIZED"


def test_processing_call_is_logged_with_run_id(client, api_auth, real_processing_auth, login, system_store, sample_csv_bytes, kanon_bundle):
    headers = login("user", "user123")
    resp = client.post(f"{BASE}/k-anonymity", files=_kanon_files(sample_csv_bytes, kanon_bundle), headers=headers)
    assert resp.status_code == 200
    run_id = resp.headers["X-Run-Id"]

    api_log = next(log for log in system_store.list_logs() if log["source"] == "POST /api/v1/k-anonymity")
    assert api_log["event"].startswith("後端 API 呼叫成功（HTTP 200")
    assert api_log["origin"] == "server" and api_log["username"] == "user"

    # 這個 run 可以用來存一筆處理紀錄
    assert client.post(f"{BASE}/history", json={"id": "h1", "runId": run_id}, headers=headers).status_code == 201


# ──────────────────────────────────────────────────────────────
# 系統設定
# ──────────────────────────────────────────────────────────────
def test_settings_readable_without_login(client, api_auth):
    body = client.get(f"{BASE}/settings").json()
    # ★ TTC 2026-10-30：附帶唯讀的密碼長度下限（conftest 放寬為 1）
    assert body == {"session_timeout_minutes": 15, "password_min_length": 1}


def test_settings_update_admin_only(client, api_auth, login):
    assert client.put(
        f"{BASE}/settings", json={"session_timeout_minutes": 30}, headers=login("user", "user123")
    ).status_code == 403

    body = client.put(f"{BASE}/settings", json={"session_timeout_minutes": 30}, headers=login()).json()
    assert body["session_timeout_minutes"] == 30
    assert client.get(f"{BASE}/settings").json()["session_timeout_minutes"] == 30

    assert client.put(
        f"{BASE}/settings", json={"session_timeout_minutes": 0}, headers=login()
    ).status_code == 422


def test_preferences_are_per_user(client, api_auth, login):
    assert client.get(f"{BASE}/preferences").status_code == 401
    user_headers = login("user", "user123")
    assert client.get(f"{BASE}/preferences", headers=user_headers).json() == {}

    saved = client.put(f"{BASE}/preferences", json={"theme": "light", "language": "en_US"}, headers=user_headers).json()
    assert saved == {"theme": "light", "language": "en_US"}
    # 只更新有送的欄位
    saved = client.put(f"{BASE}/preferences", json={"font_size": "large"}, headers=user_headers).json()
    assert saved == {"theme": "light", "language": "en_US", "font_size": "large"}
    # theme 送 null＝改回跟隨作業系統
    assert client.put(f"{BASE}/preferences", json={"theme": None}, headers=user_headers).json()["theme"] is None

    # 別的帳號互不影響
    assert client.get(f"{BASE}/preferences", headers=login()).json() == {}
    assert client.put(f"{BASE}/preferences", json={"font_size": "huge"}, headers=user_headers).status_code == 422


def test_announcements_removed(client, api_auth, login):
    assert client.get(f"{BASE}/announcements", headers=login()).status_code == 404


# ──────────────────────────────────────────────────────────────
# ★ TTC 2026-11-02（B5）：處理紀錄與偏好綁不可變的 user_id；刪除後建立同名帳號看不到前一人的資料
# ──────────────────────────────────────────────────────────────
def _save_history_as(client, api_auth, login, username, password, record_id):
    from app.governance.system_store import get_system_store

    run_id = f"run-{record_id}"
    get_system_store().add_run(run_id, username, "POST /k-anonymity", 200, user_id=api_auth.get_user_id(username))
    resp = client.post(
        f"{BASE}/history", json={"runId": run_id, "id": record_id}, headers=login(username, password)
    )
    assert resp.status_code == 201, resp.text


def test_recreated_username_does_not_see_previous_owners_data(client, api_auth, login):
    api_auth.create_user("alice", "alice-pass", "user")
    _save_history_as(client, api_auth, login, "alice", "alice-pass", "old-record")
    client.put(f"{BASE}/preferences", json={"theme": "dark"}, headers=login("alice", "alice-pass"))

    api_auth.delete_user("alice")
    api_auth.create_user("alice", "new-alice-pass", "user")
    headers = login("alice", "new-alice-pass")

    assert client.get(f"{BASE}/history", headers=headers).json()["records"] == []
    assert client.get(f"{BASE}/history/old-record/verify", headers=headers).json()["status"] == "missing"
    assert client.get(f"{BASE}/preferences", headers=headers).json().get("theme") is None
    # 舊紀錄仍保留供稽核：admin 列出所有人的紀錄看得到
    admin_ids = [r["id"] for r in client.get(f"{BASE}/history", params={"all": 1}, headers=login()).json()["records"]]
    assert "old-record" in admin_ids


def test_legacy_rows_backfilled_only_for_records_after_account_creation(tmp_path):
    from app.governance.system_store import SystemStore

    store = SystemStore(db_path=str(tmp_path / "system.db"))
    store.add_history("bob", "before", {"id": "before"})
    store.add_history("bob", "after", {"id": "after"})
    with store._connect() as conn:
        conn.execute("UPDATE history SET user_id = NULL")
        conn.execute("UPDATE history SET created_at = 1000 WHERE id = 'before'")
    # bob 帳號建立於 2000 ms：1000 ms 那筆屬於之前同名的另一個人
    store.backfill_user_ids({"bob": ("uid-bob", 2000)})
    assert [r["id"] for r in store.list_history("uid-bob")] == ["after"]


# ──────────────────────────────────────────────────────────────
# ★ TTC 2026-11-02（B8）：前端回報的日誌不可擠掉後端記錄的安全事件；寫入頻率有上限
# ──────────────────────────────────────────────────────────────
def test_client_logs_do_not_evict_server_events(tmp_path, monkeypatch):
    from app.governance import system_store as store_module

    monkeypatch.setattr(store_module, "MAX_SYSTEM_LOGS", 10)
    store = store_module.SystemStore(db_path=str(tmp_path / "system.db"))
    store.add_log("WARN", "登入失敗（帳號或密碼錯誤）", "POST /auth/login", "victim")
    store.add_logs([{"level": "INFO", "event": f"灌水 {i}", "source": "x"} for i in range(50)], "mallory")
    events = [log["event"] for log in store.list_logs(limit=100)]
    assert "登入失敗（帳號或密碼錯誤）" in events
    assert sum(1 for e in events if e.startswith("灌水")) == 10


def test_client_log_posting_is_rate_limited(client, api_auth, login, monkeypatch):
    from app.api import system_router

    monkeypatch.setattr(system_router, "CLIENT_LOG_ENTRIES_PER_MINUTE", 60)
    system_router._client_log_windows.clear()
    headers = login("user", "user123")
    batch = {"entries": [{"level": "INFO", "event": "e", "source": "s"}] * 30}
    assert client.post(f"{BASE}/system-logs", json=batch, headers=headers).status_code == 201
    assert client.post(f"{BASE}/system-logs", json=batch, headers=headers).status_code == 201
    resp = client.post(f"{BASE}/system-logs", json=batch, headers=headers)
    assert resp.status_code == 429
    assert resp.json()["error_code"] == "ERR_RATE_LIMITED"


def test_reserved_prefix_cannot_be_bypassed_with_invisible_characters(client, api_auth, login):
    for disguised in ["\u200b登入失敗（偽造）", " 登入失敗（偽造）", "\ufeff使用者登入成功"]:
        resp = client.post(
            f"{BASE}/system-logs",
            json={"entries": [{"level": "INFO", "event": disguised, "source": "s"}]},
            headers=login("user", "user123"),
        )
        assert resp.status_code == 400, disguised
