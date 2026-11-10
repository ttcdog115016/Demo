"""
API - 帳號管理端點（/users）整合測試
涵蓋：列出、建立、改角色、重設密碼、停用、刪除，以及全組限 admin 的權限守法。
測試帳號由 api_auth fixture 於測試期間建立（主程式啟動時不自建帳號）。
"""
import json

from app.governance.audit import AuditLogger

BASE = "/api/v1"


# ──────────────────────────────────────────────────────────────
# 權限守法：全組限 admin，且角色每次從資料庫重讀
# ──────────────────────────────────────────────────────────────
def test_user_role_is_forbidden(client, api_auth, login):
    """一般使用者不得管理帳號：身分沒問題但角色不足，回 403 而非 401"""
    resp = client.get(f"{BASE}/users", headers=login("user", "user123"))
    assert resp.status_code == 403
    assert resp.json()["error_code"] == "ERR_FORBIDDEN"


def test_anonymous_is_unauthorized(client, api_auth):
    """未帶 token 回 401"""
    assert client.get(f"{BASE}/users").status_code == 401


def test_role_is_reread_from_database(client, api_auth, login):
    """降級立即生效：token 裡的 role 不被採信，每次都從資料庫重讀。

    若照 token 判斷，被降級的管理員在 token 到期前都還能繼續管理帳號。
    """
    headers = login("admin", "admin123")
    assert client.get(f"{BASE}/users", headers=headers).status_code == 200

    api_auth.set_role("admin", "user")
    assert client.get(f"{BASE}/users", headers=headers).status_code == 403


# ──────────────────────────────────────────────────────────────
# 列出與建立
# ──────────────────────────────────────────────────────────────
def test_list_users(client, api_auth, login):
    resp = client.get(f"{BASE}/users", headers=login())
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert {u["username"] for u in body["users"]} == {"admin", "user"}
    # 密碼雜湊不得出現在回應裡
    assert "password_hash" not in json.dumps(body)


def test_create_user_then_login(client, api_auth, login):
    """API 建立的帳號可直接登入，與 CLI 建立的完全一樣（共用同一份建立邏輯）"""
    resp = client.post(
        f"{BASE}/users",
        json={"username": "bob", "password": "bob-pass", "role": "user"},
        headers=login(),
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "user"

    assert client.post(
        f"{BASE}/auth/login", json={"username": "bob", "password": "bob-pass"}
    ).status_code == 200


def test_create_duplicate_user_returns_409(client, api_auth, login):
    resp = client.post(
        f"{BASE}/users",
        json={"username": "admin", "password": "x", "role": "user"},
        headers=login(),
    )
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "ERR_USER_EXISTS"


def test_create_user_rejects_unknown_role(client, api_auth, login):
    """不支援的角色一律拒絕，回 400"""
    resp = client.post(
        f"{BASE}/users",
        json={"username": "carol", "password": "x", "role": "guest"},
        headers=login(),
    )
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "ERR_INVALID_PARAM"


def test_create_user_is_audited_with_actor_and_target(client, api_auth, login, monkeypatch, tmp_path):
    """帳號誰開的、開給誰，是稽核最想看的一段，兩者都要留痕"""
    headers = login()
    log_path = tmp_path / "audit_users.jsonl"
    monkeypatch.setattr(
        "app.governance.audit._audit_logger", AuditLogger(log_path=str(log_path))
    )

    client.post(
        f"{BASE}/users",
        json={"username": "dave", "password": "dave-pass", "role": "user"},
        headers=headers,
    )

    entries = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
    assert [e["operation"] for e in entries] == ["create_user"]
    assert entries[0]["user"] == "admin"
    assert entries[0]["parameters"] == {"target": "dave", "role": "user"}
    # 密碼不得入紀錄
    assert "dave-pass" not in log_path.read_text(encoding="utf-8")


# ──────────────────────────────────────────────────────────────
# 改角色（含管理員的自我保護）
# ──────────────────────────────────────────────────────────────
def test_change_role(client, api_auth, login):
    """admin 與 user 可互相升降"""
    resp = client.patch(
        f"{BASE}/users/user/role", json={"role": "admin"}, headers=login()
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_admin_cannot_change_own_role(client, api_auth, login):
    """不得變更自己的角色：降了自己就再也改不回來，只能回機器上用 CLI 重建帳號"""
    resp = client.patch(
        f"{BASE}/users/admin/role", json={"role": "user"}, headers=login()
    )
    assert resp.status_code == 403


def test_change_role_of_missing_user_returns_404(client, api_auth, login):
    resp = client.patch(
        f"{BASE}/users/ghost/role", json={"role": "user"}, headers=login()
    )
    assert resp.status_code == 404


# ──────────────────────────────────────────────────────────────
# 重設他人密碼
# ──────────────────────────────────────────────────────────────
def test_reset_password_forces_relogin(client, api_auth, login):
    """重設後新密碼可用，且該帳號既發出的 refresh token 一律作廢"""
    victim = client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "user123"}
    ).json()

    resp = client.post(
        f"{BASE}/users/user/reset-password",
        json={"new_password": "reset-pass"},
        headers=login(),
    )
    assert resp.status_code == 200

    assert client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "reset-pass"}
    ).status_code == 200
    assert client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": victim["refresh_token"]}
    ).status_code == 401


def test_cannot_reset_another_admin_password(client, api_auth, login):
    """不得重設管理員的密碼：否則任何取得管理員 token 的人都能直接接管其他管理員帳號"""
    api_auth.create_user("admin2", "admin2-pass", "admin")
    resp = client.post(
        f"{BASE}/users/admin2/reset-password",
        json={"new_password": "hijacked"},
        headers=login(),
    )
    assert resp.status_code == 403


# ──────────────────────────────────────────────────────────────
# 停用與刪除
# ──────────────────────────────────────────────────────────────
def test_deactivate_blocks_login(client, api_auth, login):
    resp = client.patch(
        f"{BASE}/users/user/active", json={"is_active": False}, headers=login()
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    assert client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "user123"}
    ).status_code == 401


def test_reactivate_restores_login(client, api_auth, login):
    headers = login()
    client.patch(f"{BASE}/users/user/active", json={"is_active": False}, headers=headers)
    client.patch(f"{BASE}/users/user/active", json={"is_active": True}, headers=headers)

    assert client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "user123"}
    ).status_code == 200


def test_admin_cannot_deactivate_self(client, api_auth, login):
    resp = client.patch(
        f"{BASE}/users/admin/active", json={"is_active": False}, headers=login()
    )
    assert resp.status_code == 403


def test_delete_user(client, api_auth, login):
    """刪除是真的從資料庫移除，不只是把旗標關掉——上線前清除帳號要的是這個"""
    resp = client.delete(f"{BASE}/users/user", headers=login())
    assert resp.status_code == 200
    assert api_auth.get_user("user") is None

    assert client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "user123"}
    ).status_code == 401


def test_admin_cannot_delete_self(client, api_auth, login):
    assert client.delete(f"{BASE}/users/admin", headers=login()).status_code == 403


def test_delete_missing_user_returns_404(client, api_auth, login):
    assert client.delete(f"{BASE}/users/ghost", headers=login()).status_code == 404


# ──────────────────────────────────────────────────────────────
# ★ TTC 2026-11-02（B4）：admin 不可藉「降級→重設密碼→升回」接管另一位 admin
# ──────────────────────────────────────────────────────────────
def test_demoting_admin_requires_operator_password(client, api_auth, login):
    api_auth.create_user("admin2", "admin2-pass", "admin")
    headers = login()
    missing = client.patch(f"{BASE}/users/admin2/role", json={"role": "user"}, headers=headers)
    assert missing.status_code == 403
    wrong = client.patch(
        f"{BASE}/users/admin2/role",
        json={"role": "user", "current_password": "not-my-password"},
        headers=headers,
    )
    assert wrong.status_code == 403
    assert api_auth.get_user("admin2")["role"] == "admin"
    ok = client.patch(
        f"{BASE}/users/admin2/role",
        json={"role": "user", "current_password": "admin123"},
        headers=headers,
    )
    assert ok.status_code == 200
    assert ok.json()["role"] == "user"


def test_recently_demoted_admin_cannot_be_reset(client, api_auth, login):
    api_auth.create_user("admin2", "admin2-pass", "admin")
    headers = login()
    client.patch(
        f"{BASE}/users/admin2/role",
        json={"role": "user", "current_password": "admin123"},
        headers=headers,
    )
    resp = client.post(
        f"{BASE}/users/admin2/reset-password", json={"new_password": "taken-over"}, headers=headers
    )
    assert resp.status_code == 403
    assert api_auth.authenticate("admin2", "admin2-pass").ok


def test_promoting_user_needs_no_password(client, api_auth, login):
    resp = client.patch(f"{BASE}/users/user/role", json={"role": "admin"}, headers=login())
    assert resp.status_code == 200
