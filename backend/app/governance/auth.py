import base64
import hashlib
import hmac
import logging
import math
import os
import secrets
import sqlite3
import uuid
import warnings
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.core.errors import PetsError
from app.core.settings import get_data_dir

logger = logging.getLogger(__name__)

# 系統只有兩種角色：admin 能管帳號，user 不能。
# ★ TTC 2026-10-29：處理端點（前處理、K-匿名、DP、風險評估、報告）須登入（見 api/processing_guard），
#   兩種角色皆可使用；未設定 OPEN_PETS_JWT_SECRET 時處理端點同樣回 503。
ROLES = ("admin", "user")

# 登入失敗鎖定：時間窗內連續失敗達門檻即鎖定一段時間，期間即使密碼正確也不放行。
# 數值固定為 5 次／180 秒窗／鎖 900 秒，不開放以環境變數調整——
# 這是防線本身的強度，交給部署設定等於允許被調到形同虛設。
LOGIN_MAX_ATTEMPTS = 5
LOGIN_ATTEMPT_WINDOW_SECONDS = 180
LOGIN_LOCKOUT_SECONDS = 900
# ★ TTC 2026-11-02（B4）：admin 被降級後多久內仍視同 admin（不可被他人重設密碼）
ADMIN_DEMOTION_COOLDOWN_HOURS = 24

# ★ TTC 2026-10-28：密碼長度下限（與前端「至少 12 個字元」一致），可用環境變數 OPEN_PETS_PASSWORD_MIN_LENGTH 調整。
#   建立帳號（含 CLI create-user）、本人變更密碼、管理者重設密碼一律檢查；
#   既有帳號的舊密碼仍可登入，下次變更時才套用。
PASSWORD_MIN_LENGTH_ENV = "OPEN_PETS_PASSWORD_MIN_LENGTH"
DEFAULT_PASSWORD_MIN_LENGTH = 12
# ★ TTC 2026-10-30：複雜度與前端一致（大小寫字母、數字、特殊符號各至少一個；任何非英數字皆算符號）。
#   設為 0 可關閉（僅供測試）；直接呼叫 API、CLI、桌面版首位管理員都套用同一規則。
PASSWORD_REQUIRE_COMPLEXITY_ENV = "OPEN_PETS_PASSWORD_REQUIRE_COMPLEXITY"


def get_password_min_length() -> int:
    """密碼長度下限；環境變數無法解讀或小於 1 時採預設 12。"""
    raw = os.getenv(PASSWORD_MIN_LENGTH_ENV)
    try:
        value = int(raw) if raw not in (None, "") else DEFAULT_PASSWORD_MIN_LENGTH
    except ValueError:
        value = DEFAULT_PASSWORD_MIN_LENGTH
    return value if value >= 1 else DEFAULT_PASSWORD_MIN_LENGTH


def password_complexity_required() -> bool:
    return os.getenv(PASSWORD_REQUIRE_COMPLEXITY_ENV, "1").strip() not in ("0", "false", "False")


def password_policy_error(password: str) -> str | None:
    """新密碼不合規則時回傳原因，合格回傳 None；供 API 與桌面版 launcher 共用。"""
    password = password or ""
    min_length = get_password_min_length()
    if len(password) < min_length:
        return f"密碼長度至少需 {min_length} 個字元。"
    if password_complexity_required() and not (
        any(c.islower() and c.isascii() for c in password)
        and any(c.isupper() and c.isascii() for c in password)
        and any(c.isdigit() and c.isascii() for c in password)
        and any(not (c.isascii() and c.isalnum()) for c in password)
    ):
        return "密碼需包含大寫字母、小寫字母、數字及特殊符號。"
    return None


def _require_password_length(password: str) -> None:
    """新密碼不合規則（長度、複雜度）時拋出 ERR_INVALID_PARAM（400）。"""
    error = password_policy_error(password)
    if error:
        raise PetsError("ERR_INVALID_PARAM", error)

# 密碼儲存採 scrypt（金鑰衍生函式，Python 標準庫內建，不新增相依、離線可部署）。
# 每位使用者一組獨立隨機鹽值，且刻意設定高記憶體成本，使字典攻擊與彩虹表失效——
# 單輪無鹽雜湊（如 SHA-256）算得太快、同密碼必得同雜湊，兩者皆不適合存放密碼。
_ALGO = "scrypt"
_SCRYPT_N = 2**14  # CPU/記憶體成本，約 16 MiB；互動式登入的常見建議值
_SCRYPT_R = 8
_SCRYPT_P = 1
_SALT_BYTES = 16
_DKLEN = 32

# 儲存格式：algo$n$r$p$salt$hash（鹽值與參數隨雜湊一起存）。
# 自帶參數的好處是日後調整成本或更換演算法時，舊紀錄仍能依自己的參數驗證。
_FIELD_SEP = "$"


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _now() -> datetime:
    return datetime.now(UTC)


def _to_text(moment: datetime | None) -> str | None:
    """時間一律以 UTC 的 ISO 8601 字串存放（SQLite 沒有原生的時間型別）。"""
    return moment.isoformat() if moment else None


def _from_text(raw: str | None) -> datetime | None:
    """讀回時間欄位；無法解析時視同沒有值，不讓一筆壞資料把登入流程打斷。"""
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


@dataclass(frozen=True)
class AuthResult:
    """登入驗證的結果。

    帶原因的結果物件，讓呼叫端分辨「密碼錯」「帳號被停用」「鎖定中」——三者要回的
    狀態碼並不相同（401／401／423），鎖定還得告訴對方還要等幾秒。

    ★注意 reason 只給伺服器判斷用，不得原樣回給呼叫端：帳號不存在、密碼錯誤與
    帳號已停用對外一律回同一句話，否則等於提供了帳號是否存在的探測管道。
    """

    username: str
    role: str | None = None
    reason: str = "ok"  # ok／invalid（帳密錯或帳號不存在）／inactive／locked
    retry_after: int | None = None  # 僅 locked 時有值，單位為秒

    @property
    def ok(self) -> bool:
        return self.reason == "ok"


class AuthManager:
    """使用者角色與權限管理 (SQLite)"""

    def __init__(self, db_path: str | None = None):
        if db_path is None:
            # 使用者資料庫屬部署環境的資料，落在部署者指定的資料目錄，不寫進套件安裝目錄
            self.db_path = os.path.join(get_data_dir(), "users.db")
        else:
            self.db_path = db_path

        parent_dir = os.path.dirname(os.path.abspath(self.db_path))
        os.makedirs(parent_dir, exist_ok=True)
        self._init_db()

    def _init_db(self):
        """只建立資料表，不建立任何帳號。

        寫死於程式碼的預設帳號刪不掉（下次啟動又重建），等同於部署後永遠存在一組
        公開帳密。正式環境的第一個管理員請以 CLI 建立：
            python -m app.cli.main create-user -u <帳號> -p <密碼> -r admin
        測試用帳號則由 pytest fixture 於測試期間建立（見 tests/conftest.py）。

        refresh_tokens 一併建在同一個資料庫檔：token 的存廢與帳號的存廢是同一件事
        （刪帳號必須連同其 token 一起消失），分成兩個檔會讓這件事無法在同一個交易內完成。
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            # 啟用 WAL 提升並發效能
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY,
                    password_hash TEXT,
                    role TEXT,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    failed_login_count INTEGER NOT NULL DEFAULT 0,
                    login_first_failed_at TEXT,
                    login_locked_until TEXT,
                    created_at TEXT
                )
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS refresh_tokens (
                    token_id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    issued_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    revoked INTEGER NOT NULL DEFAULT 0
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_refresh_tokens_username "
                "ON refresh_tokens (username)"
            )
            # ★ TTC 2026-11-02：舊資料庫補欄位。
            #   demoted_at（B4）：admin 被降級的時間，近期曾是 admin 者不可被重設密碼。
            #   user_id（B5）：不可變的使用者識別碼；處理紀錄等改綁 user_id，刪除後建立同名帳號看不到前一人的資料。
            columns = {row[1] for row in cursor.execute("PRAGMA table_info(users)")}
            if "demoted_at" not in columns:
                cursor.execute("ALTER TABLE users ADD COLUMN demoted_at TEXT")
            if "user_id" not in columns:
                cursor.execute("ALTER TABLE users ADD COLUMN user_id TEXT")
            for (username,) in cursor.execute(
                "SELECT username FROM users WHERE user_id IS NULL"
            ).fetchall():
                cursor.execute(
                    "UPDATE users SET user_id = ? WHERE username = ?", (uuid.uuid4().hex, username)
                )
            cursor.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_id ON users (user_id)"
            )
            conn.commit()

    def _hash_password(self, password: str, salt: bytes | None = None) -> str:
        """以 scrypt 衍生密碼雜湊，回傳自帶參數與鹽值的單欄字串。"""
        if salt is None:
            salt = secrets.token_bytes(_SALT_BYTES)
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=_SCRYPT_N,
            r=_SCRYPT_R,
            p=_SCRYPT_P,
            dklen=_DKLEN,
        )
        return _FIELD_SEP.join(
            [_ALGO, str(_SCRYPT_N), str(_SCRYPT_R), str(_SCRYPT_P), _b64(salt), _b64(derived)]
        )

    def _verify_password(self, password: str, stored: str) -> bool:
        """比對密碼與已儲存的雜湊；格式無法解析時一律視為驗證失敗並告知需重建帳號。"""
        parts = (stored or "").split(_FIELD_SEP)
        if len(parts) != 6 or parts[0] != _ALGO:
            message = (
                "偵測到非 scrypt 格式的密碼紀錄，"
                "此類帳號無法驗證，請以 CLI create-user 重新建立。"
            )
            # 密碼紀錄毀損屬資安事件性質，畫面上的提醒關掉主控台就沒了，須另行留檔。
            logger.warning(message)
            warnings.warn(message, stacklevel=2)
            return False

        try:
            _, n, r, p, salt_b64, hash_b64 = parts
            derived = hashlib.scrypt(
                password.encode("utf-8"),
                salt=base64.b64decode(salt_b64),
                n=int(n),
                r=int(r),
                p=int(p),
                dklen=len(base64.b64decode(hash_b64)),
            )
        except (ValueError, TypeError, MemoryError) as exc:
            # 參數毀損或不合法：視為驗證失敗，不讓畸形紀錄把登入流程打斷。
            # 比照上方格式不符的處理一併告知——否則帳號會「密碼明明沒錯卻一直登不進去」，
            # 管理者無從得知問題出在紀錄本身而非密碼。訊息不含雜湊或鹽值。
            message = (
                f"密碼紀錄的 scrypt 參數無法解讀（{type(exc).__name__}），該帳號無法驗證，"
                "請以 CLI create-user 重新建立。"
            )
            logger.warning(message)
            warnings.warn(message, stacklevel=2)
            return False

        # 逐位元組比對會因提早返回而洩漏相符長度，改用定時比較
        return hmac.compare_digest(derived, base64.b64decode(hash_b64))

    # ── 帳號的建立與查詢 ──────────────────────────────────────────────────
    def _normalize_role(self, role: str) -> str:
        """檢核角色字串（忽略大小寫與前後空白）；不在白名單內一律拒絕。"""
        normalized = (role or "").strip().lower()
        if normalized not in ROLES:
            raise PetsError(
                "ERR_INVALID_PARAM",
                f"不合法的角色 [{role}]，必須為 {' 或 '.join(ROLES)}。",
            )
        return normalized

    def create_user(self, username: str, password: str, role: str) -> None:
        """建立帳號；角色不合法或帳號已存在時拋出對應錯誤碼的例外。

        ★帳號重複以帶錯誤碼的例外表示，而非回傳 False：呼叫端才分得出是重複、
        角色不合法還是資料庫寫入失敗，CLI 與 API 兩個入口共用同一份判斷，回同一個錯誤碼。
        """
        role = self._normalize_role(role)
        _require_password_length(password)
        pwd_hash = self._hash_password(password)
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    "INSERT INTO users (username, password_hash, role, is_active, created_at, user_id) "
                    "VALUES (?, ?, ?, 1, ?, ?)",
                    (username, pwd_hash, role, _to_text(_now()), uuid.uuid4().hex),
                )
                conn.commit()
        except sqlite3.IntegrityError as exc:
            raise PetsError(
                "ERR_USER_EXISTS", f"使用者 [{username}] 已經存在。"
            ) from exc

    def get_user(self, username: str) -> dict | None:
        """回傳單一帳號的公開欄位（不含密碼雜湊）；帳號不存在時回傳 None。"""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT username, role, is_active, created_at, user_id FROM users WHERE username = ?",
                (username,),
            ).fetchone()
        # ★ TTC 2026-11-02（B5）：附上不可變的 user_id，供處理紀錄、偏好以 user_id 歸屬
        return {**self._as_public(row[:4]), "user_id": row[4]} if row else None

    def account_ids_with_creation_ms(self) -> dict[str, tuple[str, int]]:
        """帳號 → (user_id, 建立時間 epoch ms)；供系統資料庫舊紀錄補 user_id（★ TTC 2026-11-02 B5）。"""
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute("SELECT username, user_id, created_at FROM users").fetchall()
        result = {}
        for username, user_id, created_at in rows:
            created = _from_text(created_at)
            result[username] = (user_id, int(created.timestamp() * 1000) if created else 0)
        return result

    def list_users(self) -> list[dict]:
        """回傳所有帳號的公開欄位，依帳號排序。密碼雜湊一律不出現在回傳值裡。

        ★ TTC 2026-10-29：另附登入失敗次數與鎖定到期時間（管理員才看得到此清單），
        讓帳號管理畫面知道誰被鎖、可用「重設密碼」解除；鎖定已過期者回 None。
        """
        now = _now()
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT username, role, is_active, created_at, failed_login_count, login_locked_until "
                "FROM users ORDER BY username"
            ).fetchall()
        users = []
        for row in rows:
            locked_until = _from_text(row[5])
            users.append({
                **self._as_public(row[:4]),
                "failed_login_count": int(row[4] or 0),
                "login_locked_until": _to_text(locked_until) if locked_until and locked_until > now else None,
            })
        return users

    @staticmethod
    def _as_public(row: tuple) -> dict:
        username, role, is_active, created_at = row
        return {
            "username": username,
            "role": role,
            "is_active": bool(is_active),
            "created_at": created_at,
        }

    # ── 登入驗證與失敗鎖定 ────────────────────────────────────────────────
    def authenticate(self, username: str, password: str) -> AuthResult:
        """驗證帳號密碼，回傳帶原因的結果（見 AuthResult）。

        鹽值逐人不同，無法直接以 SQL 比對雜湊值，故先取回該帳號的紀錄再驗證。
        帳號不存在時仍走一次同等成本的雜湊計算，避免以回應快慢推測帳號是否存在。

        鎖定的判斷放在驗證密碼之前：鎖定期間即使密碼正確也不放行，否則猜中密碼的人
        不受鎖定影響，這道防線等於只擋住猜錯的人。
        """
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT password_hash, role, is_active, failed_login_count, "
                "login_first_failed_at, login_locked_until FROM users WHERE username = ?",
                (username,),
            ).fetchone()

        if row is None:
            self._hash_password(password)
            return AuthResult(username, reason="invalid")

        stored_hash, role, is_active, fail_count, first_failed_at, locked_until = row

        if not is_active:
            # 仍走一次雜湊計算：停用帳號若回得比較快，等於洩漏該帳號存在且已停用。
            self._hash_password(password)
            return AuthResult(username, reason="inactive")

        locked_until_dt = _from_text(locked_until)
        now = _now()
        if locked_until_dt and locked_until_dt > now:
            self._hash_password(password)
            return AuthResult(
                username,
                reason="locked",
                retry_after=math.ceil((locked_until_dt - now).total_seconds()),
            )

        if not self._verify_password(password, stored_hash):
            self._record_login_failure(username)
            return AuthResult(username, reason="invalid")

        # ★ TTC 2026-11-02：密碼驗證期間（scrypt 約數十毫秒）其他並發請求可能已觸發鎖定，
        #   清零前於同一交易內再確認一次，鎖定中即使密碼正確也不放行。
        retry_after = self._reset_login_failures_unless_locked(username)
        if retry_after is not None:
            return AuthResult(username, reason="locked", retry_after=retry_after)
        return AuthResult(username, role=role)

    def _record_login_failure(self, username: str) -> None:
        """記錄一次登入失敗；於時間窗內累積達門檻即上鎖。

        計數採「固定時間窗」（自該輪第一次失敗起算，逾時即重新計數）而非累計總數：
        偶爾打錯一次不該永遠留在計數裡，否則一個用了很久的帳號終究會被自己的歷史紀錄鎖住。

        ★ TTC 2026-11-02：「讀計數→加一→寫回」改在 BEGIN IMMEDIATE 交易內完成。原本沿用驗證前
        讀到的舊計數，並發的錯誤密碼請求都讀到同一個值、各寫回同一個 +1，鎖定門檻形同虛設。
        """
        now = _now()
        with sqlite3.connect(self.db_path, timeout=30) as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT failed_login_count, login_first_failed_at FROM users WHERE username = ?",
                (username,),
            ).fetchone()
            if row is None:
                conn.rollback()
                return
            fail_count, first_failed_at = int(row[0] or 0), _from_text(row[1])
            count, window_start, locked_until = self._next_failure_state(
                now, fail_count, first_failed_at
            )
            conn.execute(
                "UPDATE users SET failed_login_count = ?, login_first_failed_at = ?, "
                "login_locked_until = COALESCE(?, login_locked_until) WHERE username = ?",
                (count, _to_text(window_start), _to_text(locked_until), username),
            )
            conn.commit()

    @staticmethod
    def _next_failure_state(
        now: datetime, fail_count: int, first_failed_at: datetime | None
    ) -> tuple[int, datetime, datetime | None]:
        if (
            first_failed_at is None
            or (now - first_failed_at).total_seconds() > LOGIN_ATTEMPT_WINDOW_SECONDS
        ):
            # 超出時間窗：這次失敗視為新一輪的第一次
            count, window_start = 1, now
        else:
            count, window_start = fail_count + 1, first_failed_at

        locked_until = (
            now + timedelta(seconds=LOGIN_LOCKOUT_SECONDS)
            if count >= LOGIN_MAX_ATTEMPTS
            else None
        )
        return count, window_start, locked_until

    def _reset_login_failures_unless_locked(self, username: str) -> int | None:
        """驗證成功後清零失敗計數；若此刻已被鎖定則不清零，回傳剩餘秒數。"""
        with sqlite3.connect(self.db_path, timeout=30) as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT login_locked_until FROM users WHERE username = ?", (username,)
            ).fetchone()
            locked_until = _from_text(row[0]) if row else None
            now = _now()
            if locked_until and locked_until > now:
                conn.rollback()
                return math.ceil((locked_until - now).total_seconds())
            conn.execute(
                "UPDATE users SET failed_login_count = 0, login_first_failed_at = NULL, "
                "login_locked_until = NULL WHERE username = ?",
                (username,),
            )
            conn.commit()
        return None

    def is_locked(self, username: str) -> int | None:
        """帳號鎖定中回傳剩餘秒數，否則回傳 None（★ TTC 2026-11-02：供改密碼端點使用）。"""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT login_locked_until FROM users WHERE username = ?", (username,)
            ).fetchone()
        locked_until = _from_text(row[0]) if row else None
        now = _now()
        if locked_until and locked_until > now:
            return math.ceil((locked_until - now).total_seconds())
        return None

    # ── 帳號的維護 ────────────────────────────────────────────────────────
    def _require_user(self, conn: sqlite3.Connection, username: str) -> None:
        exists = conn.execute(
            "SELECT 1 FROM users WHERE username = ?", (username,)
        ).fetchone()
        if exists is None:
            raise PetsError("ERR_NOT_FOUND", f"使用者 [{username}] 不存在。")

    def change_password(
        self, username: str, current_password: str, new_password: str
    ) -> bool:
        """本人改密碼：驗過舊密碼才換。舊密碼不符或帳號不存在時回傳 False。

        兩種情形回同一個結果，是為了讓呼叫端只能回同一句話——分開講等於告訴對方
        「這個帳號存在，只是密碼打錯了」。
        """
        _require_password_length(new_password)
        if new_password == current_password:
            raise PetsError("ERR_INVALID_PARAM", "新密碼不可與目前密碼相同。")
        # ★ TTC 2026-11-02：拿到 token 的人可在此無限猜目前密碼；鎖定中一律拒絕，猜錯計入鎖定
        retry_after = self.is_locked(username)
        if retry_after is not None:
            raise PetsError(
                "ERR_ACCOUNT_LOCKED",
                f"帳號因連續驗證失敗已暫時鎖定，請於 {retry_after} 秒後再試。",
            )
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT password_hash FROM users WHERE username = ?", (username,)
            ).fetchone()
            if row is None or not self._verify_password(current_password, row[0]):
                if row is not None:
                    self._record_login_failure(username)
                return False
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE username = ?",
                (self._hash_password(new_password), username),
            )
            conn.commit()
        return True

    def reset_password(self, username: str, new_password: str) -> None:
        """管理者重設他人密碼：不需舊密碼，並一併解除該帳號的登入失敗鎖定。

        解鎖是重設的一部分：帳號被鎖住時管理者最常做的正是重設密碼，
        若不一併清零，使用者拿到新密碼仍得再等鎖定時間走完才進得來。
        """
        _require_password_length(new_password)
        with sqlite3.connect(self.db_path) as conn:
            self._require_user(conn, username)
            conn.execute(
                "UPDATE users SET password_hash = ?, failed_login_count = 0, "
                "login_first_failed_at = NULL, login_locked_until = NULL "
                "WHERE username = ?",
                (self._hash_password(new_password), username),
            )
            conn.commit()

    def set_role(self, username: str, role: str) -> dict:
        """變更角色，回傳變更後的帳號資料。"""
        role = self._normalize_role(role)
        with sqlite3.connect(self.db_path) as conn:
            self._require_user(conn, username)
            # ★ TTC 2026-11-02（B4）：admin 降為 user 時記下時間（見 was_admin_recently）
            conn.execute(
                "UPDATE users SET demoted_at = CASE WHEN role = 'admin' AND ? <> 'admin' THEN ? "
                "ELSE demoted_at END, role = ? WHERE username = ?",
                (role, _to_text(_now()), role, username),
            )
            conn.commit()
        return self.get_user(username)

    def was_admin_recently(self, username: str, hours: int = ADMIN_DEMOTION_COOLDOWN_HOURS) -> bool:
        """目前是 admin，或在最近 hours 小時內被降級過（★ TTC 2026-11-02 B4）。"""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT role, demoted_at FROM users WHERE username = ?", (username,)
            ).fetchone()
        if row is None:
            return False
        role, demoted_at = row
        demoted = _from_text(demoted_at)
        return role == "admin" or (
            demoted is not None and _now() - demoted < timedelta(hours=hours)
        )

    def get_user_id(self, username: str) -> str | None:
        """不可變的使用者識別碼（★ TTC 2026-11-02 B5）；帳號不存在回傳 None。"""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT user_id FROM users WHERE username = ?", (username,)
            ).fetchone()
        return row[0] if row else None

    def set_active(self, username: str, is_active: bool) -> dict:
        """停用或恢復帳號，回傳變更後的帳號資料。

        停用是可逆的（帳號與其操作紀錄都還在），刪除才是不可逆的；
        兩者並存，由管理者依情境選擇（見 delete_user）。
        """
        with sqlite3.connect(self.db_path) as conn:
            self._require_user(conn, username)
            conn.execute(
                "UPDATE users SET is_active = ? WHERE username = ?",
                (1 if is_active else 0, username),
            )
            conn.commit()
        return self.get_user(username)

    def delete_user(self, username: str) -> None:
        """刪除帳號，並在同一個交易內連同其所有 refresh token 一起刪除。

        保留刪除而不只提供停用：合約要求上線前清除測試帳號與管理帳號，
        停用只是把旗標關掉，帳號紀錄仍留在資料庫裡，不算清除乾淨。
        token 必須一起刪：帳號沒了卻留著可換發的 token，等於留下一條無主的入口。
        """
        with sqlite3.connect(self.db_path) as conn:
            self._require_user(conn, username)
            conn.execute("DELETE FROM refresh_tokens WHERE username = ?", (username,))
            conn.execute("DELETE FROM users WHERE username = ?", (username,))
            conn.commit()


_auth_manager: AuthManager | None = None


def get_auth_manager() -> AuthManager:
    """回傳全專案共用的帳號管理器；第一次呼叫時才建立。

    ★刻意採延後建立，理由與 audit.get_audit_logger() 同一條：__init__ 會呼叫
    get_data_dir()、建出資料目錄並開好 users.db，寫在模組層等於 import 就有副作用
    ——連 `python -m app.cli.main --help` 都會生出目錄與空的資料庫，且「未設定
    OPEN_PETS_DATA_DIR」那句告知發生在入口呼叫 configure_logging 之前，寫不進系統日誌。
    第一次真正要用到帳號時才建，兩者都不會發生。
    """
    global _auth_manager
    if _auth_manager is None:
        _auth_manager = AuthManager()
    return _auth_manager
