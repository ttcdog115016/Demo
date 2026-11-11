"""★ TTC 2026-10-30：帳號安全與前端一致性
涵蓋：
  - source 欄位只能讀部署者開放的目錄，且一律不能讀系統資料目錄（使用者資料庫等）
  - 密碼複雜度（大小寫、數字、符號）與前端同一規則；新舊密碼不得相同
  - 本人改密碼後，其他登入的 refresh token 全數失效，目前這一張保留
"""
import json
import sqlite3

import pytest

from app.core.errors import PetsError
from app.governance.auth import AuthManager, password_policy_error

BASE = "/api/v1"

TRIM_CONFIG = {"preprocess": {"enabled": True, "columns": [{"column": "地區", "actions": [{"action": "trim", "params": {"mode": "all"}}]}]}}


@pytest.fixture
def strict_policy(monkeypatch):
    monkeypatch.setenv("OPEN_PETS_PASSWORD_MIN_LENGTH", "12")
    monkeypatch.setenv("OPEN_PETS_PASSWORD_REQUIRE_COMPLEXITY", "1")


# ── source 目錄限制 ─────────────────────────────────────────────────────


def _preprocess_from_source(client, source, table):
    return client.post(
        f"{BASE}/preprocess",
        files={"config": ("config.json", json.dumps(TRIM_CONFIG), "application/json")},
        data={"source": source, "table": table},
    )


def test_source_disabled_when_no_dirs_allowed(client, sqlite_source, monkeypatch):
    monkeypatch.delenv("OPEN_PETS_ALLOWED_SOURCE_DIRS", raising=False)
    resp = _preprocess_from_source(client, sqlite_source.url, sqlite_source.table)
    assert resp.status_code == 403
    assert "上傳" in resp.json()["message"]


def test_source_outside_allowed_dirs_rejected(client, sqlite_source, tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_PETS_ALLOWED_SOURCE_DIRS", str(tmp_path / "elsewhere"))
    resp = _preprocess_from_source(client, sqlite_source.url, sqlite_source.table)
    assert resp.status_code == 403


def test_source_cannot_read_user_database(client, tmp_path, monkeypatch):
    """即使資料目錄落在開放範圍內，使用者資料庫仍不可當資料集讀出"""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    manager = AuthManager(db_path=str(data_dir / "users.db"))
    manager.create_user("victim", "Victim-Password-1", "admin")
    monkeypatch.setenv("OPEN_PETS_DATA_DIR", str(data_dir))
    monkeypatch.setenv("OPEN_PETS_ALLOWED_SOURCE_DIRS", str(tmp_path))

    resp = _preprocess_from_source(
        client, f"sqlite:///{(data_dir / 'users.db').as_posix()}", "users"
    )
    assert resp.status_code == 403
    # 以「..」繞道同樣擋下
    sneaky = (tmp_path / "x" / ".." / "data" / "users.db").as_posix()
    assert _preprocess_from_source(client, f"sqlite:///{sneaky}", "users").status_code == 403


# ── 密碼規則 ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "password",
    ["aaaaaaaaaaaa", "abcdefghijk1!", "ABCDEFGHIJK1!", "Abcdefghijkl!", "Abcdefghijk12"],
)
def test_weak_passwords_rejected(strict_policy, password):
    assert password_policy_error(password) is not None


@pytest.mark.parametrize("password", ["Abcdefghij1!", "Abcdefghij 1", "Passw0rd.long"])
def test_strong_passwords_accepted(strict_policy, password):
    """任何非英數字都算特殊符號，與前端 /[^A-Za-z\\d]/ 一致"""
    assert password_policy_error(password) is None


def test_create_user_applies_complexity(strict_policy, tmp_path):
    manager = AuthManager(db_path=str(tmp_path / "users.db"))
    with pytest.raises(PetsError):
        manager.create_user("bob", "aaaaaaaaaaaa", "user")


def test_new_password_must_differ(client, api_auth, strict_policy):
    api_auth.reset_password("user", "Old-Password-1")
    token = client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "Old-Password-1"}
    ).json()["access_token"]
    resp = client.patch(
        f"{BASE}/auth/password",
        json={"current_password": "Old-Password-1", "new_password": "Old-Password-1"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


# ── 改密碼撤銷其他登入 ──────────────────────────────────────────────────


def test_change_password_revokes_other_sessions(client, api_auth):
    def login():
        return client.post(
            f"{BASE}/auth/login", json={"username": "user", "password": "user123"}
        ).json()

    other = login()
    current = login()
    resp = client.patch(
        f"{BASE}/auth/password",
        json={
            "current_password": "user123",
            "new_password": "user-new-pass",
            "refresh_token": current["refresh_token"],
        },
        headers={"Authorization": f"Bearer {current['access_token']}"},
    )
    assert resp.status_code == 200

    assert client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": other["refresh_token"]}
    ).status_code == 401
    assert client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": current["refresh_token"]}
    ).status_code == 200


def test_refresh_tokens_not_stored_in_plaintext(client, api_auth):
    issued = client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "user123"}
    ).json()["refresh_token"]
    with sqlite3.connect(api_auth.db_path) as conn:
        stored = [row[0] for row in conn.execute("SELECT token_id FROM refresh_tokens")]
    assert issued not in stored
