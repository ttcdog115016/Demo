"""
API - 身份驗證端點 整合測試
涵蓋：登入、換發 token、登出、變更自己的密碼，以及未設簽章金鑰時的停用行為。
測試帳號由 api_auth fixture 於測試期間建立（主程式啟動時不自建帳號）。
"""
from app.governance.auth import LOGIN_MAX_ATTEMPTS

BASE = "/api/v1"



def test_login_success(client, api_auth):
    """正確帳密應回傳 200，並帶出一組 access token 與 refresh token"""
    resp = client.post(f"{BASE}/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "admin"
    assert data["role"] == "admin"
    assert "登入成功" in data["message"]
    assert data["token_type"] == "bearer"
    assert data["access_token"] and data["refresh_token"]


def test_login_user_role(client, api_auth):
    """一般使用者帳號應正確回傳 user 角色"""
    resp = client.post(f"{BASE}/auth/login", json={"username": "user", "password": "user123"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "user"


def test_login_wrong_password(client, api_auth):
    """密碼錯誤應回傳 401"""
    resp = client.post(f"{BASE}/auth/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401


def test_login_nonexistent_user(client, api_auth):
    """不存在的帳號應回傳 401"""
    resp = client.post(f"{BASE}/auth/login", json={"username": "ghost", "password": "ghost"})
    assert resp.status_code == 401


def test_login_failure_is_audited(client, api_auth, monkeypatch, tmp_path):
    """登入失敗須留痕：只記成功的話，稽核看得到誰進得來，卻看不到有人反覆嘗試。"""
    import json

    from app.governance.audit import AuditLogger

    log_path = tmp_path / "audit_login.jsonl"
    monkeypatch.setattr(
        "app.governance.audit._audit_logger", AuditLogger(log_path=str(log_path))
    )

    resp = client.post(
        f"{BASE}/auth/login", json={"username": "admin", "password": "wrong"}
    )
    assert resp.status_code == 401

    entries = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
    assert [(e["operation"], e["status"]) for e in entries] == [("login", "failed")]
    # 帳號要記（才知道誰在試），密碼不得入紀錄
    assert entries[0]["parameters"] == {"username": "admin"}


def test_login_missing_fields(client, api_auth):
    """缺少 password 欄位應回傳 422 (Unprocessable Entity)"""
    resp = client.post(f"{BASE}/auth/login", json={"username": "admin"})
    assert resp.status_code == 422


def test_repeated_failures_lock_the_account(client, api_auth):
    """連續登入失敗達門檻即鎖定：鎖定期間即使密碼正確也登不進來。

    ★ TTC 2026-11-02（B10）：原本回 423＋Retry-After，不存在的帳號則永遠是 401，
    攻擊者錯 5 次就能分辨帳號是否存在；改為與帳密錯誤同一個 401 回應，鎖定原因只寫入稽核紀錄。
    """
    for _ in range(LOGIN_MAX_ATTEMPTS):
        client.post(f"{BASE}/auth/login", json={"username": "admin", "password": "wrong"})

    resp = client.post(f"{BASE}/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 401
    assert api_auth.authenticate("admin", "admin123").reason == "locked"


def test_locked_account_is_indistinguishable_from_unknown_account(client, api_auth):
    """B10：錯 5 次之後，存在（已鎖定）與不存在的帳號回應完全相同"""
    for _ in range(LOGIN_MAX_ATTEMPTS):
        client.post(f"{BASE}/auth/login", json={"username": "admin", "password": "wrong"})
        client.post(f"{BASE}/auth/login", json={"username": "nobody", "password": "wrong"})

    locked = client.post(f"{BASE}/auth/login", json={"username": "admin", "password": "wrong"})
    unknown = client.post(f"{BASE}/auth/login", json={"username": "nobody", "password": "wrong"})
    assert locked.status_code == unknown.status_code == 401
    assert locked.json() == unknown.json()
    assert "Retry-After" not in locked.headers


# ──────────────────────────────────────────────────────────────
# 換發與登出
# ──────────────────────────────────────────────────────────────
def test_refresh_rotates_the_token(client, api_auth):
    """換發後舊的 refresh token 立刻作廢，同一張不得用第二次"""
    login = client.post(
        f"{BASE}/auth/login", json={"username": "admin", "password": "admin123"}
    ).json()

    resp = client.post(f"{BASE}/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert resp.status_code == 200
    rotated = resp.json()
    assert rotated["refresh_token"] != login["refresh_token"]
    assert rotated["access_token"]

    reused = client.post(f"{BASE}/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert reused.status_code == 401


def test_refresh_rejects_unknown_token(client, api_auth):
    resp = client.post(f"{BASE}/auth/refresh", json={"refresh_token": "not-a-real-token"})
    assert resp.status_code == 401


def test_logout_revokes_the_refresh_token(client, api_auth):
    """登出後該 refresh token 不得再換發"""
    login = client.post(
        f"{BASE}/auth/login", json={"username": "admin", "password": "admin123"}
    ).json()

    resp = client.post(f"{BASE}/auth/logout", json={"refresh_token": login["refresh_token"]})
    assert resp.status_code == 200

    after = client.post(f"{BASE}/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert after.status_code == 401


def test_deactivated_account_cannot_refresh(client, api_auth):
    """帳號停用後，既有的 refresh token 不得再換出新的 access token"""
    login = client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "user123"}
    ).json()
    api_auth.set_active("user", False)

    resp = client.post(f"{BASE}/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert resp.status_code == 401


# ──────────────────────────────────────────────────────────────
# 變更自己的密碼
# ──────────────────────────────────────────────────────────────
def test_change_own_password(client, api_auth, login):
    """帶舊密碼變更自己的密碼，之後只有新密碼登得進來"""
    headers = login("user", "user123")
    resp = client.patch(
        f"{BASE}/auth/password",
        json={"current_password": "user123", "new_password": "user-new-pass"},
        headers=headers,
    )
    assert resp.status_code == 200

    assert client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "user123"}
    ).status_code == 401
    assert client.post(
        f"{BASE}/auth/login", json={"username": "user", "password": "user-new-pass"}
    ).status_code == 200


def test_change_password_with_wrong_current_password(client, api_auth, login):
    """舊密碼錯誤回 401，且與登入失敗同一句話，不額外提示是哪裡錯"""
    resp = client.patch(
        f"{BASE}/auth/password",
        json={"current_password": "not-my-password", "new_password": "whatever"},
        headers=login("user", "user123"),
    )
    assert resp.status_code == 401
    assert resp.json()["message"] == "帳號或密碼錯誤。"


def test_change_password_requires_a_token(client, api_auth):
    """未帶 access token 一律 401"""
    resp = client.patch(
        f"{BASE}/auth/password",
        json={"current_password": "user123", "new_password": "x"},
    )
    assert resp.status_code == 401


def test_forged_token_is_rejected(client, api_auth):
    """自製的 token 驗不過"""
    resp = client.patch(
        f"{BASE}/auth/password",
        json={"current_password": "user123", "new_password": "x"},
        headers={"Authorization": "Bearer not.a.jwt"},
    )
    assert resp.status_code == 401


def test_token_of_deleted_account_is_rejected(client, api_auth, login):
    """token 仍在有效期內，但帳號已被刪除：身分每次從資料庫重讀，故立刻失效"""
    headers = login("user", "user123")
    api_auth.delete_user("user")

    resp = client.patch(
        f"{BASE}/auth/password",
        json={"current_password": "user123", "new_password": "x"},
        headers=headers,
    )
    assert resp.status_code == 401


# ──────────────────────────────────────────────────────────────
# 未設簽章金鑰：只停用會員端點，三大功能不受影響
# ──────────────────────────────────────────────────────────────
def test_member_endpoints_return_503_without_secret(client, api_auth, monkeypatch):
    """未設金鑰時 /auth 回 503，訊息不得提及環境變數名稱"""
    monkeypatch.delenv("OPEN_PETS_JWT_SECRET", raising=False)

    resp = client.post(f"{BASE}/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 503
    body = resp.json()
    assert body["error_code"] == "ERR_AUTH_DISABLED"
    assert body["message"] == "登入功能尚未啟用，請聯繫系統管理員。"
    assert "OPEN_PETS_JWT_SECRET" not in body["message"]


def test_main_functions_still_work_without_secret(client, api_auth, monkeypatch, kanon_bundle, sample_csv_bytes):
    """會員系統的設定沒填不得拖垮三大功能——兩者本來就各自獨立"""
    monkeypatch.delenv("OPEN_PETS_JWT_SECRET", raising=False)

    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("sample.csv", sample_csv_bytes, "text/csv"),
            "config": ("config.json", kanon_bundle, "application/json"),
        },
    )
    assert resp.status_code == 200
