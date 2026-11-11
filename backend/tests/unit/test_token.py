"""access token 與 refresh token 單元測試（app/governance/token.py）"""
import sqlite3
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core.errors import PetsError
from app.governance.token import (
    ACCESS_TOKEN_TTL_MINUTES,
    TokenManager,
    auth_enabled,
    create_access_token,
    decode_access_token,
    ensure_auth_enabled,
    hash_refresh_token,
    log_availability,
)

SECRET = "unit-test-jwt-secret"


@pytest.fixture
def jwt_secret(monkeypatch):
    monkeypatch.setenv("OPEN_PETS_JWT_SECRET", SECRET)
    return SECRET


@pytest.fixture
def tokens(auth_manager):
    """token 與帳號同一個資料庫檔（資料表由 AuthManager._init_db 一併建立）"""
    return TokenManager(auth_manager.db_path)


# ──────────────────────────────────────────────────────────────
# 未設定金鑰：會員端點停用，其餘功能不受影響
# ──────────────────────────────────────────────────────────────
def test_auth_is_disabled_without_secret(monkeypatch):
    """未設簽章金鑰時會員端點一律 503，且對外訊息不得提及環境變數名稱"""
    monkeypatch.delenv("OPEN_PETS_JWT_SECRET", raising=False)
    assert auth_enabled() is False

    with pytest.raises(PetsError) as exc:
        ensure_auth_enabled()
    assert exc.value.error_code == "ERR_AUTH_DISABLED"
    assert exc.value.http_status == 503
    # 這句話任何未登入者都看得到：講出內部設定名稱等於免費提供系統內部資訊
    assert "OPEN_PETS_JWT_SECRET" not in exc.value.message


def test_startup_log_names_the_missing_setting(monkeypatch, app_logs):
    """系統日誌（只有部署者看得到）則必須明講缺的是哪一個環境變數，且在啟動當下就講"""
    monkeypatch.delenv("OPEN_PETS_JWT_SECRET", raising=False)
    log_availability()
    messages = [record.getMessage() for record in app_logs.records]
    assert any("OPEN_PETS_JWT_SECRET" in message for message in messages)
    assert any("/auth" in message and "/users" in message for message in messages)


def test_startup_log_is_silent_when_configured(jwt_secret, app_logs):
    """設定妥當時不必多話"""
    log_availability()
    assert app_logs.records == []


# ──────────────────────────────────────────────────────────────
# access token
# ──────────────────────────────────────────────────────────────
def test_access_token_round_trip(jwt_secret):
    """簽出的 token 驗得回來，欄位沿用 JWT 標準命名"""
    payload = decode_access_token(create_access_token("admin", "admin"))
    assert payload["sub"] == "admin"
    assert payload["username"] == "admin"
    assert payload["role"] == "admin"
    assert payload["exp"] - payload["iat"] == ACCESS_TOKEN_TTL_MINUTES * 60
    assert payload["jti"]


def test_expired_access_token_is_rejected(jwt_secret):
    """過期的 token 不得通過，訊息要讓呼叫端知道該去換發"""
    expired = jwt.encode(
        {
            "sub": "admin",
            "role": "admin",
            "exp": int((datetime.now(UTC) - timedelta(seconds=1)).timestamp()),
        },
        SECRET,
        algorithm="HS256",
    )
    with pytest.raises(PetsError) as exc:
        decode_access_token(expired)
    assert exc.value.error_code == "ERR_UNAUTHORIZED"
    assert "過期" in exc.value.message


def test_token_signed_with_another_key_is_rejected(jwt_secret):
    """換一把金鑰簽出來的 token 驗不過——否則簽章形同虛設"""
    forged = jwt.encode({"sub": "admin", "role": "admin"}, "another-key", algorithm="HS256")
    with pytest.raises(PetsError) as exc:
        decode_access_token(forged)
    assert exc.value.error_code == "ERR_UNAUTHORIZED"


def test_unsigned_token_is_rejected(jwt_secret):
    """alg=none 的無簽章 token 不得被接受"""
    unsigned = jwt.encode({"sub": "admin", "role": "admin"}, key="", algorithm="none")
    with pytest.raises(PetsError):
        decode_access_token(unsigned)


# ──────────────────────────────────────────────────────────────
# refresh token
# ──────────────────────────────────────────────────────────────
def test_issue_and_resolve(tokens):
    token_id = tokens.issue("admin")
    assert tokens.resolve(token_id) == "admin"


def test_unknown_token_resolves_to_none(tokens):
    assert tokens.resolve("no-such-token") is None


def test_rotation_invalidates_the_old_token(tokens):
    """換發即輪替：舊的立刻作廢，被竊的舊 token 無法重複使用"""
    old = tokens.issue("admin")
    new = tokens.rotate(old, "admin")

    assert new != old
    assert tokens.resolve(old) is None
    assert tokens.resolve(new) == "admin"


def test_revoke_and_revoke_all(tokens):
    first = tokens.issue("admin")
    second = tokens.issue("admin")
    other = tokens.issue("user")

    tokens.revoke(first)
    assert tokens.resolve(first) is None
    assert tokens.resolve(second) == "admin"

    tokens.revoke_all("admin")
    assert tokens.resolve(second) is None
    # 只作廢該帳號的，不波及他人
    assert tokens.resolve(other) == "user"


def test_expired_refresh_token_is_rejected(tokens):
    """過期的 refresh token 無效（有效＝存在、未撤銷、未過期）"""
    token_id = tokens.issue("admin")
    with sqlite3.connect(tokens.db_path) as conn:
        conn.execute(
            "UPDATE refresh_tokens SET expires_at = ? WHERE token_id = ?",
            ((datetime.now(UTC) - timedelta(seconds=1)).isoformat(), hash_refresh_token(token_id)),
        )
        conn.commit()
    assert tokens.resolve(token_id) is None


def test_revoked_token_is_kept_for_the_record(tokens):
    """撤銷是標記而非刪除：紀錄上仍看得到這張 token 曾經存在"""
    token_id = tokens.issue("admin")
    tokens.revoke(token_id)
    with sqlite3.connect(tokens.db_path) as conn:
        revoked = conn.execute(
            "SELECT revoked FROM refresh_tokens WHERE token_id = ?", (hash_refresh_token(token_id),)
        ).fetchone()
    assert revoked == (1,)


def test_refresh_token_is_stored_hashed(tokens):
    """★ TTC 2026-10-30：資料庫只存摘要，讀出資料表也拿不到可換發的 token"""
    token_id = tokens.issue("admin")
    with sqlite3.connect(tokens.db_path) as conn:
        stored = [row[0] for row in conn.execute("SELECT token_id FROM refresh_tokens")]
    assert token_id not in stored
    assert hash_refresh_token(token_id) in stored
    assert tokens.resolve(stored[0]) is None
