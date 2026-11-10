"""
會員管理 (RBAC) 與審計日誌 單元測試
"""
import hashlib
import json
import os
import sqlite3

import pytest

import app.governance.auth as auth_module
from app.core.errors import PetsError
from app.core.settings import get_data_dir
from app.governance.audit import AuditLogger
from app.governance.auth import LOGIN_MAX_ATTEMPTS, AuthManager


def test_admin_authenticate(auth_manager):
    """測試帳號（由 fixture 建立）可正常驗證"""
    result = auth_manager.authenticate("admin", "admin123")
    assert result.ok is True
    assert result.role == "admin"


def test_wrong_password_is_rejected(auth_manager):
    """錯誤密碼不得通過，且不得洩漏該帳號存在（原因一律為 invalid）"""
    result = auth_manager.authenticate("admin", "wrongpassword")
    assert result.ok is False
    assert result.reason == "invalid"
    assert result.role is None


def test_nonexistent_user_is_rejected(auth_manager):
    """不存在的帳號不得通過、不得拋出例外，且與密碼錯誤回同一種原因"""
    result = auth_manager.authenticate("ghost", "whatever")
    assert result.ok is False
    assert result.reason == "invalid"


def test_create_user_and_authenticate(auth_manager):
    """建立新使用者後可成功驗證"""
    auth_manager.create_user("tony", "secret123", "user")
    assert auth_manager.authenticate("tony", "secret123").role == "user"


def test_duplicate_user_creation_raises(auth_manager):
    """重複建立同名使用者應拋出可判讀的錯誤碼，而非回傳 False。

    回 False 只表示「沒建成」，分不出是重複、角色不合法還是寫入失敗，
    API 因此無從決定該回哪個狀態碼。
    """
    auth_manager.create_user("dup_user", "pass", "user")
    with pytest.raises(PetsError) as exc:
        auth_manager.create_user("dup_user", "pass2", "admin")
    assert exc.value.error_code == "ERR_USER_EXISTS"
    assert exc.value.http_status == 409


@pytest.mark.parametrize("role", ["guest", "root", "", "ADMINISTRATOR"])
def test_create_user_rejects_unknown_roles(auth_manager, role):
    """輸入端只收 admin／user：其他角色一律拒絕。"""
    with pytest.raises(PetsError) as exc:
        auth_manager.create_user("whoever", "pass", role)
    assert exc.value.error_code == "ERR_INVALID_PARAM"


def test_role_is_case_insensitive_and_trimmed(auth_manager):
    """角色大小寫與前後空白不影響判定，存進資料庫的一律是正規化後的值"""
    auth_manager.create_user("mixed", "pass", " Admin ")
    assert auth_manager.get_user("mixed")["role"] == "admin"


def test_init_db_creates_no_accounts(tmp_path):
    """初始化只建表不建帳號：寫死的預設帳密部署後刪不掉，一律不得自建"""
    manager = AuthManager(db_path=str(tmp_path / "empty.db"))
    with sqlite3.connect(manager.db_path) as conn:
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    assert count == 0
    assert manager.authenticate("admin", "admin123").ok is False


def test_password_stored_as_salted_kdf(auth_manager):
    """密碼須以自帶鹽值的 KDF 儲存：不留明文，且同密碼不得產生相同雜湊"""
    auth_manager.create_user("alice", "same-password", "user")
    auth_manager.create_user("bob", "same-password", "user")

    with sqlite3.connect(auth_manager.db_path) as conn:
        rows = dict(
            conn.execute(
                "SELECT username, password_hash FROM users WHERE username IN ('alice', 'bob')"
            ).fetchall()
        )

    for stored in rows.values():
        assert stored.startswith("scrypt$")
        assert "same-password" not in stored
    # 鹽值逐人隨機，故同一組密碼的兩筆紀錄必須不同（單輪無鹽雜湊會相同）
    assert rows["alice"] != rows["bob"]
    assert auth_manager.authenticate("alice", "same-password").role == "user"


def test_non_scrypt_record_is_rejected(auth_manager):
    """密碼紀錄不是 scrypt 格式（如無鹽 SHA-256）→ 無法驗證，且須明確告知需重建帳號"""
    bad_hash = hashlib.sha256(b"pw123").hexdigest()
    with sqlite3.connect(auth_manager.db_path) as conn:
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            ("bad_record_user", bad_hash, "user"),
        )
        conn.commit()

    with pytest.warns(UserWarning, match="重新建立"):
        assert auth_manager.authenticate("bad_record_user", "pw123").ok is False


def test_audit_log_chain_integrity(temp_dir, monkeypatch):
    """審計日誌雜湊鏈應保持完整性，驗證結果為 True"""
    monkeypatch.setenv("OPEN_PETS_SYSTEM_MASTER_KEY", "unit-test-master-key")
    audit = AuditLogger(log_path=os.path.join(temp_dir, "audit.jsonl"))
    audit.log_operation("k_anonymity", "success", {"k": 5})
    audit.log_operation("dp", "success", {"eps": 1.0})
    audit.log_operation("risk_k_anonymity", "success", {"n_iter": 100})

    is_valid, problems, notes = audit.verify_audit_log()
    assert is_valid is True
    assert problems == []
    assert notes == []


def test_empty_log_reports_as_note_not_problem(temp_dir, monkeypatch):
    """日誌尚無紀錄：結論為通過，該事實記在說明欄，不得混入不通過的事由欄。"""
    monkeypatch.setenv("OPEN_PETS_SYSTEM_MASTER_KEY", "unit-test-master-key")
    audit = AuditLogger(log_path=os.path.join(temp_dir, "audit_empty.jsonl"))

    is_valid, problems, notes = audit.verify_audit_log()
    assert is_valid is True
    assert problems == []
    assert any("沒有紀錄可校驗" in n for n in notes)


def test_unsigned_when_master_key_missing(temp_dir, monkeypatch):
    """未設定金鑰：日誌照記但不簽章，且驗證須說明無法驗證、不謊稱已受保護。"""
    monkeypatch.delenv("OPEN_PETS_SYSTEM_MASTER_KEY", raising=False)
    log_path = os.path.join(temp_dir, "audit_unsigned.jsonl")
    audit = AuditLogger(log_path=log_path)
    audit.log_operation("k_anonymity", "success", {"k": 5})

    with open(log_path, encoding="utf-8") as f:
        entry = json.loads(f.readline())
    assert "hash" not in entry and "last_hash" not in entry
    assert entry["operation"] == "k_anonymity"  # 留痕本身不受影響

    is_valid, problems, _ = audit.verify_audit_log()
    assert is_valid is False  # 沒驗成不等於驗過了，不得回報通過
    assert any("無法驗證" in m for m in problems)
    assert not any("竄改" in m for m in problems)  # 也不得反過來指為遭竄改


def test_unsigned_line_is_flagged_when_key_is_set(temp_dir, monkeypatch):
    """設有金鑰卻讀到未簽章的行＝可疑，不得與「當初沒金鑰」一視同仁放行。

    攻擊者刪改內容後無法補出正確簽章，把整行的簽章欄位一起拿掉是最省事的做法；
    若未簽章一律視為無虞，等於替這種偽造紀錄背書。
    """
    monkeypatch.setenv("OPEN_PETS_SYSTEM_MASTER_KEY", "unit-test-master-key")
    log_path = os.path.join(temp_dir, "audit_mixed.jsonl")
    audit = AuditLogger(log_path=log_path)
    audit.log_operation("k_anonymity", "success", {"k": 5})

    # 事後補上一行沒有簽章的紀錄
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(
            json.dumps(
                {
                    "timestamp": "2026-08-24T10:00:00.000000Z",
                    "operation": "dp",
                    "status": "success",
                    "parameters": {"eps": 99.0},
                },
                ensure_ascii=False,
            )
            + "\n"
        )

    is_valid, problems, _ = audit.verify_audit_log()
    assert is_valid is False
    assert any("沒有簽章" in m for m in problems)


def test_audit_log_has_no_user_field(temp_dir):
    """三大功能不記錄操作者：端點未強制身分驗證，任何預設值都只是佔位、會誤導稽核人員。"""
    log_path = os.path.join(temp_dir, "audit_no_user.jsonl")
    audit = AuditLogger(log_path=log_path)
    audit.log_operation("k_anonymity", "success", {"k": 5})

    with open(log_path, encoding="utf-8") as f:
        entry = json.loads(f.readline())
    assert "user" not in entry


def test_audit_records_verified_operator_when_given(temp_dir, monkeypatch):
    """會員系統的操作記得下操作者，且與三大功能的紀錄同在一條雜湊鏈上。

    這裡的操作者是真的驗證過的（端點要求登入），與三大功能那種「沒有可信的名字可寫」
    並不相同，故同一本日誌並存兩種形狀——這是事實，不是缺漏，驗證端兩種都要驗得過。
    """
    monkeypatch.setenv("OPEN_PETS_SYSTEM_MASTER_KEY", "unit-test-master-key")
    log_path = os.path.join(temp_dir, "audit_with_user.jsonl")
    audit = AuditLogger(log_path=log_path)
    audit.log_operation("k_anonymity", "success", {"k": 5})
    audit.log_operation(
        "create_user", "success", {"target": "bob", "role": "user"}, user="admin"
    )

    entries = [
        json.loads(line)
        for line in open(log_path, encoding="utf-8").read().splitlines()
    ]
    assert "user" not in entries[0]
    assert entries[1]["user"] == "admin"
    assert entries[1]["parameters"]["target"] == "bob"

    is_valid, problems, _ = audit.verify_audit_log()
    assert is_valid is True
    assert problems == []


# ──────────────────────────────────────────────────────────────
# 登入失敗鎖定
# ──────────────────────────────────────────────────────────────
def test_account_locks_after_repeated_failures(auth_manager):
    """時間窗內連續失敗達門檻即鎖定，且回應要能算出還要等幾秒"""
    for _ in range(LOGIN_MAX_ATTEMPTS):
        assert auth_manager.authenticate("admin", "wrong").reason == "invalid"

    result = auth_manager.authenticate("admin", "admin123")
    assert result.reason == "locked"
    assert result.retry_after > 0


def test_correct_password_is_refused_while_locked(auth_manager):
    """鎖定期間即使密碼正確也不放行——否則猜中的人不受鎖定影響，這道防線形同只擋猜錯的人"""
    for _ in range(LOGIN_MAX_ATTEMPTS):
        auth_manager.authenticate("admin", "wrong")
    assert auth_manager.authenticate("admin", "admin123").ok is False


def test_successful_login_clears_failure_count(auth_manager):
    """尚未達門檻時登入成功即清零，偶爾打錯不會累積到把自己鎖住"""
    for _ in range(LOGIN_MAX_ATTEMPTS - 1):
        auth_manager.authenticate("admin", "wrong")
    assert auth_manager.authenticate("admin", "admin123").ok is True

    with sqlite3.connect(auth_manager.db_path) as conn:
        count, first, until = conn.execute(
            "SELECT failed_login_count, login_first_failed_at, login_locked_until "
            "FROM users WHERE username = 'admin'"
        ).fetchone()
    assert (count, first, until) == (0, None, None)


def test_failures_outside_the_window_start_a_new_count(auth_manager):
    """計數採固定時間窗（自該輪第一次失敗起算）：超出時間窗的舊失敗不再累計，否則老帳號終將被自己的歷史鎖住"""
    for _ in range(LOGIN_MAX_ATTEMPTS - 1):
        auth_manager.authenticate("admin", "wrong")
    # 把時間窗起點推到很久以前，模擬失敗發生在窗外
    with sqlite3.connect(auth_manager.db_path) as conn:
        conn.execute(
            "UPDATE users SET login_first_failed_at = '2020-01-01T00:00:00+00:00' "
            "WHERE username = 'admin'"
        )
        conn.commit()

    assert auth_manager.authenticate("admin", "wrong").reason == "invalid"
    with sqlite3.connect(auth_manager.db_path) as conn:
        count = conn.execute(
            "SELECT failed_login_count FROM users WHERE username = 'admin'"
        ).fetchone()[0]
    assert count == 1


# ──────────────────────────────────────────────────────────────
# 帳號維護（改密碼、重設、角色、停用、刪除）
# ──────────────────────────────────────────────────────────────
def test_change_password_requires_current_password(auth_manager):
    """本人改密碼須驗過舊密碼；舊密碼錯誤時不得換掉"""
    assert auth_manager.change_password("admin", "wrong", "new-pass") is False
    assert auth_manager.authenticate("admin", "admin123").ok is True

    assert auth_manager.change_password("admin", "admin123", "new-pass") is True
    assert auth_manager.authenticate("admin", "new-pass").ok is True
    assert auth_manager.authenticate("admin", "admin123").ok is False


def test_change_password_on_missing_user_returns_false(auth_manager):
    """帳號不存在與舊密碼錯誤回同一種結果，呼叫端因此只能回同一句話"""
    assert auth_manager.change_password("ghost", "whatever", "new") is False


def test_reset_password_clears_lockout(auth_manager):
    """管理者重設密碼＝連同解鎖：否則使用者拿到新密碼仍得等鎖定時間走完"""
    for _ in range(LOGIN_MAX_ATTEMPTS):
        auth_manager.authenticate("user", "wrong")
    assert auth_manager.authenticate("user", "user123").reason == "locked"

    auth_manager.reset_password("user", "brand-new")
    assert auth_manager.authenticate("user", "brand-new").ok is True


def test_maintenance_on_missing_user_raises_not_found(auth_manager):
    """對不存在的帳號做維護一律回 404，不靜靜地什麼都沒做"""
    for call in (
        lambda: auth_manager.reset_password("ghost", "x"),
        lambda: auth_manager.set_role("ghost", "admin"),
        lambda: auth_manager.set_active("ghost", False),
        lambda: auth_manager.delete_user("ghost"),
    ):
        with pytest.raises(PetsError) as exc:
            call()
        assert exc.value.error_code == "ERR_NOT_FOUND"


def test_set_role_and_set_active(auth_manager):
    """角色可升降；停用後即使密碼正確也不得通過，且原因與密碼錯誤分開（狀態碼相同）"""
    assert auth_manager.set_role("user", "admin")["role"] == "admin"

    auth_manager.set_active("user", False)
    result = auth_manager.authenticate("user", "user123")
    assert result.ok is False
    assert result.reason == "inactive"

    auth_manager.set_active("user", True)
    assert auth_manager.authenticate("user", "user123").ok is True


def test_delete_user_removes_account_and_tokens(auth_manager):
    """刪除帳號須連同其 refresh token 一起消失，不留下無主的入口"""
    from app.governance.token import TokenManager

    tokens = TokenManager(auth_manager.db_path)
    token_id = tokens.issue("user")
    assert tokens.resolve(token_id) == "user"

    auth_manager.delete_user("user")
    assert auth_manager.get_user("user") is None
    assert tokens.resolve(token_id) is None


def test_list_users_never_exposes_password_hash(auth_manager):
    """列出帳號不得帶出密碼雜湊"""
    users = auth_manager.list_users()
    assert [u["username"] for u in users] == ["admin", "user"]
    assert all("password" not in key for user in users for key in user)


# ──────────────────────────────────────────────────────────────
# 執行期資料落點（users.db / audit.jsonl 不得寫進套件安裝目錄）
# ──────────────────────────────────────────────────────────────
def test_data_dir_env_decides_default_paths(tmp_path, monkeypatch):
    """設定 OPEN_PETS_DATA_DIR 後，預設的使用者資料庫與審計日誌都落在該目錄"""
    data_dir = tmp_path / "deploy_data"
    monkeypatch.setenv("OPEN_PETS_DATA_DIR", str(data_dir))

    auth = AuthManager()
    audit = AuditLogger()

    assert auth.db_path == os.path.join(str(data_dir), "users.db")
    assert audit.log_path == os.path.join(str(data_dir), "audit.jsonl")
    assert os.path.isdir(str(data_dir))


def test_data_dir_never_falls_back_to_package_dir(monkeypatch):
    """未設定環境變數時退到工作目錄下的 data/，不得落在套件安裝目錄，且須告知"""
    monkeypatch.delenv("OPEN_PETS_DATA_DIR", raising=False)

    with pytest.warns(UserWarning, match="OPEN_PETS_DATA_DIR"):
        resolved = get_data_dir()

    package_dir = os.path.dirname(os.path.abspath(auth_module.__file__))
    assert not resolved.startswith(package_dir)
    assert resolved == os.path.abspath(os.path.join(os.getcwd(), "data"))


def test_auth_manager_is_created_only_when_used(monkeypatch, tmp_path):
    """帳號管理器延後建立：沒真的用到帳號功能就不建目錄，也不建 users.db。

    若在模組層建立，import 就會建出資料目錄——連 `--help` 都生得出來，且「未設定
    OPEN_PETS_DATA_DIR」的告知發生在入口呼叫 configure_logging 之前，寫不進系統日誌。
    """
    data_dir = tmp_path / "lazy"
    monkeypatch.setenv("OPEN_PETS_DATA_DIR", str(data_dir))
    monkeypatch.setattr(auth_module, "_auth_manager", None)

    assert not data_dir.exists()

    manager = auth_module.get_auth_manager()
    assert os.path.isfile(str(data_dir / "users.db"))
    # 共用同一份，不是每次呼叫都開一個新的
    assert auth_module.get_auth_manager() is manager
