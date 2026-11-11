"""access token（JWT）與 refresh token。

分兩種 token 是為了同時滿足兩件互相拉扯的事：每支請求都要能便宜地驗身分（不必查資料庫），
但管理者停用帳號時又必須能立刻讓對方失效。

    access token：短效（15 分鐘）的簽章字串，內容自帶帳號與角色，驗章即可通過，不進資料庫。
    refresh token：長效（7 天）的隨機字串，本體存在資料庫裡，可撤銷；用它換發新的 access token，
              且一經換發舊的即作廢（輪替），被竊的舊 token 無法重複使用。

★ access token 裡的 role 只供除錯與顯示，權限判斷一律不採信——角色改了、帳號停用了，
既簽出去的 token 內容不會跟著變。真正的角色每次都從資料庫重讀（見 api/auth_router 的
get_current_user），停權與降級因此立即生效。

★ refresh token 放在回應主體，不放 cookie：本系統可能部署在純 http 的內網，而 cookie 若不加
secure 旗標即形同不設防、加了又只在 https 下才會送出——瀏覽器不送 cookie 時不會報錯，
使用者只會看到「登入後過一陣子就被登出」而查不出原因。放在主體則瀏覽器、curl、
腳本與後端串接都能一致使用，代價是由呼叫端自行妥善保管（勿存入 localStorage）。

refresh token 與帳號同放一個 SQLite 檔（users.db），資料表由 AuthManager._init_db 一併建立：
刪帳號必須連同其 token 一起消失，分成兩個檔就無法在同一個交易內完成。
"""

import hashlib
import logging
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta

import jwt

from app.core.errors import PetsError
from app.core.settings import JWT_SECRET_ENV, get_jwt_secret
from app.governance.auth import get_auth_manager

logger = logging.getLogger(__name__)

_ALGORITHM = "HS256"

# access token 刻意設短：它無法被撤銷，唯一的止血手段就是很快過期。
ACCESS_TOKEN_TTL_MINUTES = 15
# refresh token 較長，但可撤銷；登出、刪帳號、停用帳號、管理者重設密碼都會使其失效。
REFRESH_TOKEN_TTL_DAYS = 7

# 對外的訊息刻意不提環境變數名稱：這句話任何未登入者都看得到，
# 講出內部設定名稱等於免費提供系統內部資訊。部署者要看的說明寫在系統日誌（見下）。
AUTH_DISABLED_MESSAGE = "登入功能尚未啟用，請聯繫系統管理員。"


def auth_enabled() -> bool:
    """會員端點是否可用（等同於部署方是否設定了簽章金鑰）。"""
    return get_jwt_secret() is not None


def ensure_auth_enabled() -> None:
    """會員端點的共同前置：金鑰未備妥時一律回 503，不進入任何帳號邏輯。

    供 /auth 與 /users 的每一支端點以 Depends 掛載——缺了金鑰就連驗證都做不了，
    與其在流程中途才失敗，不如在最前面講清楚。
    """
    if not auth_enabled():
        raise PetsError("ERR_AUTH_DISABLED", AUTH_DISABLED_MESSAGE)


def log_availability() -> None:
    """服務啟動時就講一次會員端點能不能用，不必等有人來登入才發現。

    這一句只進系統日誌（部署者才看得到），故可以明講缺的是哪一個環境變數。
    """
    if auth_enabled():
        return
    logger.warning(
        "未設定 %s（.env）——/auth、/users 與須登入的處理端點（去識別化、差分隱私、"
        "風險評估、前處理、報告）一律回 503。"
        "如需啟用會員系統，請於 .env 設定該金鑰後重新啟動服務。",
        JWT_SECRET_ENV,
    )


def _secret() -> str:
    secret = get_jwt_secret()
    if secret is None:
        raise PetsError("ERR_AUTH_DISABLED", AUTH_DISABLED_MESSAGE)
    return secret


def create_access_token(username: str, role: str) -> str:
    """簽發 access token。欄位沿用 JWT 的標準命名（RFC 7519）：

    sub 主體（本系統以帳號為主鍵，故即帳號）、iat 簽發時間、exp 到期時間、
    jti 本張 token 的唯一識別，username／role 為附帶資訊。
    """
    now = datetime.now(UTC)
    payload = {
        "sub": username,
        "username": username,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES)).timestamp()),
        "jti": secrets.token_urlsafe(16),
    }
    return jwt.encode(payload, _secret(), algorithm=_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """驗章並解出內容；過期或簽章不符一律拋 401。

    過期與偽造分開講：前者是正常的生命週期，呼叫端看到就知道該去換發；
    後者才是異常。兩者都不透露金鑰或內部細節。
    """
    try:
        return jwt.decode(token, _secret(), algorithms=[_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise PetsError(
            "ERR_UNAUTHORIZED", "access token 已過期，請以 refresh token 換發或重新登入。"
        ) from exc
    except jwt.PyJWTError as exc:
        raise PetsError("ERR_UNAUTHORIZED", "access token 無效。") from exc


def hash_refresh_token(token: str) -> str:
    """★ TTC 2026-10-30：refresh token 只存 SHA-256 摘要，資料庫外流也拿不到可用的 token。

    token 本身是 32 bytes 亂數，無須加鹽或慢雜湊；查驗時以同一摘要比對。
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# refresh_tokens.revoked：0 有效；1 作廢（登出、改密碼、停用）；2 已換發（再出現即視為外流）
_ROTATED = 2


class TokenManager:
    """refresh token 的存放與生命週期（建立／輪替／撤銷／查驗）。"""

    def __init__(self, db_path: str):
        self.db_path = db_path

    def issue(self, username: str) -> str:
        """發一張新的 refresh token，回傳 token 本體。

        本體即機密（拿到就能換發），故以密碼學安全的亂數產生，不用可預測的流水號。
        """
        token_id = secrets.token_urlsafe(32)
        now = datetime.now(UTC)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO refresh_tokens (token_id, username, issued_at, expires_at, revoked) "
                "VALUES (?, ?, ?, ?, 0)",
                (
                    hash_refresh_token(token_id),
                    username,
                    now.isoformat(),
                    (now + timedelta(days=REFRESH_TOKEN_TTL_DAYS)).isoformat(),
                ),
            )
            conn.commit()
        return token_id

    def resolve(self, token_id: str) -> str | None:
        """查驗一張 refresh token，有效則回傳其所屬帳號，否則回傳 None。

        「有效」＝存在、未撤銷、未過期。三種無效原因對外不分別說明——
        分開講等於協助持有廢票的人判斷手上這張是哪一種。
        """
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT username, expires_at, revoked FROM refresh_tokens WHERE token_id = ?",
                (hash_refresh_token(token_id),),
            ).fetchone()
        if row is None:
            return None
        username, expires_at, revoked = row
        if revoked:
            return None
        try:
            expires = datetime.fromisoformat(expires_at)
        except ValueError:
            return None
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        return username if expires > datetime.now(UTC) else None

    def consume(self, token_id: str) -> str | None:
        """換發用：原子地作廢一張有效的 refresh token，回傳其帳號；無效回傳 None。

        ★ TTC 2026-11-02：原本「查驗→作廢→發新」分三步，並發兩個請求拿同一張 token 都會成功、
        各拿到一張新 token（外流的 token 能與本人並存）。改為只有 UPDATE 真正改到一列的那個請求成功。
        出示一張「已被換發過」的 token 代表它已外流（本人輪替後舊的不會再用），該帳號全部 token 一併作廢。
        以 revoked=2 標記換發過的 token，與登出、改密碼、停用帳號造成的作廢（revoked=1）區分——
        後者被拿出來只是舊分頁還留著，不是外流，不連帶登出目前的登入。
        """
        digest = hash_refresh_token(token_id)
        now = datetime.now(UTC)
        with sqlite3.connect(self.db_path, timeout=30) as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT username, expires_at, revoked FROM refresh_tokens WHERE token_id = ?",
                (digest,),
            ).fetchone()
            if row is None:
                conn.rollback()
                return None
            username, expires_at, revoked = row
            if revoked == _ROTATED:
                conn.execute(
                    "UPDATE refresh_tokens SET revoked = 1 WHERE username = ? AND revoked = 0",
                    (username,),
                )
                conn.commit()
                logger.warning("偵測到已換發的 refresh token 被重複使用，帳號 [%s] 的登入全部作廢。", username)
                return None
            if revoked:
                conn.rollback()
                return None
            try:
                expires = datetime.fromisoformat(expires_at)
            except ValueError:
                conn.rollback()
                return None
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=UTC)
            if expires <= now:
                conn.rollback()
                return None
            conn.execute(
                "UPDATE refresh_tokens SET revoked = ? WHERE token_id = ?", (_ROTATED, digest)
            )
            conn.commit()
        return username

    def rotate(self, token_id: str, username: str) -> str:
        """換發：舊的立刻作廢、發一張新的。

        不重複使用同一張是刻意的—— refresh token 長效，一旦外流又能一直用，等於一把不會過期的
        鑰匙。輪替之後，舊 token 再次出現即代表它已落到別人手上。
        """
        self.revoke(token_id)
        return self.issue(username)

    def revoke(self, token_id: str) -> None:
        """撤銷單一 token（登出）。標記為已撤銷而不刪除，讓紀錄仍看得到它曾存在。"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE refresh_tokens SET revoked = 1 WHERE token_id = ?",
                (hash_refresh_token(token_id),),
            )
            conn.commit()

    def revoke_all(self, username: str, keep: str | None = None) -> None:
        """撤銷某帳號的所有 token：管理者重設密碼、停用帳號時強制其重新登入。

        keep：本人改密碼時保留目前這一次登入，其餘裝置一律登出。
        """
        keep_hash = hash_refresh_token(keep) if keep else ""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE refresh_tokens SET revoked = 1 "
                "WHERE username = ? AND revoked = 0 AND token_id != ?",
                (username, keep_hash),
            )
            conn.commit()


def get_token_manager() -> TokenManager:
    """回傳指向目前帳號資料庫的 token 管理器。

    刻意不快取單一實例：本身不持有任何狀態（每次操作各開一次連線），
    而落點必須永遠跟著 AuthManager 走——測試會替換帳號資料庫，
    快取住舊路徑會讓 token 寫進另一個檔案。
    """
    return TokenManager(get_auth_manager().db_path)
