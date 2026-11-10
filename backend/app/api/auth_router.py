"""身分驗證端點（/auth）：登入、登出、換發 token、變更自己的密碼。

★ TTC 2026-10-29：處理端點（去識別化、差分隱私、風險評估、前處理、報告）改須登入，
共用本檔的 get_current_user（見 processing_guard）；角色只用於決定誰能管理帳號（見 users_router）。

★get_current_user 每次都從資料庫重讀角色與啟用狀態，不採信 token 裡的 role：
token 一經簽出內容就固定了，若照它判斷，降級與停權要等到 token 過期才會生效。
"""

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.core.errors import PetsError
from app.governance.audit import get_audit_logger
from app.governance.auth import get_auth_manager
from app.governance.system_store import get_system_store
from app.governance.token import (
    ACCESS_TOKEN_TTL_MINUTES,
    create_access_token,
    decode_access_token,
    ensure_auth_enabled,
    get_token_manager,
)

router = APIRouter(tags=["身分驗證"])

# 以 HTTPBearer 而非 OAuth2PasswordBearer 表達驗證方式：本系統的登入收 JSON 而非表單，
# 用 Bearer 才能讓 /docs 的 Authorize 直接貼上 token，與實際呼叫方式一致。
# auto_error=False：缺標頭時交由本檔自行拋錯，確保錯誤回應與其他端點同一種形狀。
_bearer = HTTPBearer(
    auto_error=False, description="登入後取得的 access token（Authorization: Bearer <token>）"
)

# 帳號不存在、密碼錯誤、帳號已停用三者對外一律同一句話：分開講等於提供了
# 「這個帳號存不存在」的探測管道，攻擊者不必猜密碼就能先蒐集有效帳號清單。
_CREDENTIALS_MESSAGE = "帳號或密碼錯誤。"

def _system_log(level: str, event: str, source: str, username: str | None = None) -> None:
    """★ TTC 2026-10-29：後端自行寫入系統維運日誌（登入成功／失敗、鎖定、登出）。寫入失敗不影響登入流程。"""
    try:
        # 帳號字串可能來自未登入者的輸入，截斷避免灌爆日誌
        get_system_store().add_log(level, event, (source or "(未填帳號)")[:100], username)
    except Exception:  # noqa: BLE001
        pass



# ★ TTC 2026-11-02：欄位長度上限。原本不設限，未登入者可送數百 MB 的帳號或密碼，
#   拖住事件迴圈解析、整串寫進稽核日誌，並讓 scrypt 對巨量密碼運算。
MAX_USERNAME_LENGTH = 150
MAX_PASSWORD_LENGTH = 1024
MAX_TOKEN_LENGTH = 256


class LoginRequest(BaseModel):
    username: str = Field(..., max_length=MAX_USERNAME_LENGTH)
    password: str = Field(..., max_length=MAX_PASSWORD_LENGTH)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(
        ..., max_length=MAX_TOKEN_LENGTH, description="登入或上次換發時取得的 refresh token"
    )


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(..., min_length=1, max_length=MAX_PASSWORD_LENGTH)
    # ★ TTC 2026-10-30：目前這次登入的 refresh token；改密碼後其餘登入一律撤銷，只保留這一張
    refresh_token: str | None = Field(None, max_length=MAX_TOKEN_LENGTH)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _: None = Depends(ensure_auth_enabled),
) -> dict:
    """解出 access token 代表的使用者；供需要登入的端點以 Depends 掛載。"""
    if credentials is None:
        raise PetsError(
            "ERR_UNAUTHORIZED", "請於 Authorization 標頭帶入 Bearer access token。"
        )
    payload = decode_access_token(credentials.credentials)
    username = payload.get("sub")
    user = get_auth_manager().get_user(username) if username else None
    if user is None or not user["is_active"]:
        # 帳號在 token 有效期內被刪除或停用：token 本身驗得過，但持有者已無資格。
        raise PetsError("ERR_UNAUTHORIZED", "帳號不存在或已停用。")
    return user


def require_role(*roles: str):
    """產生「限定角色」的相依項，例：Depends(require_role("admin"))。

    直接比對角色字串，不另設一層動作對照表——本系統只有兩種角色、
    受管制的也只有帳號管理這一件事，多一層對照只會讓權限從哪裡來變得難查。
    """

    def _check(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles:
            raise PetsError(
                "ERR_FORBIDDEN", f"權限不足，本操作僅限 {'、'.join(roles)}。"
            )
        return user

    return _check


@router.post("/auth/login")
def login(req: LoginRequest, _: None = Depends(ensure_auth_enabled)):
    """帳密登入，成功時回傳一組 access token 與 refresh token。"""
    result = get_auth_manager().authenticate(req.username, req.password)
    audit = get_audit_logger()

    if result.reason == "locked":
        # 鎖定是系統依規則擋下來的，記為 blocked（與驗證失敗的 failed 意義不同）。
        audit.log_operation(
            "login", "blocked", {"username": req.username, "reason": "account_locked"}
        )
        _system_log(
            "WARN",
            f"登入失敗（帳號鎖定中，約 {max(1, -(-int(result.retry_after or 0) // 60))} 分鐘後解除）",
            req.username,
        )
        # ★ TTC 2026-11-02（B10）：對外與帳密錯誤回同一個 401、同一句話、不帶 Retry-After。
        #   原本回 423＋Retry-After，而不存在的帳號永遠是 401，錯 5 次就能分辨帳號是否存在。
        #   鎖定原因與剩餘時間只記在稽核紀錄與系統維運日誌（管理者看得到）。
        raise PetsError("ERR_UNAUTHORIZED", _CREDENTIALS_MESSAGE)

    if not result.ok:
        # 失敗也要留痕：只記成功的話，日誌上看得到誰進得來，卻看不到有人正在反覆嘗試。
        # 連續登入失敗是最典型的資安事件，稽核時需要的正是這一段。密碼不入紀錄。
        audit.log_operation("login", "failed", {"username": req.username})
        _system_log("WARN", "登入失敗（帳號或密碼錯誤）", req.username)
        raise PetsError("ERR_UNAUTHORIZED", _CREDENTIALS_MESSAGE)

    tokens = get_token_manager()
    access_token = create_access_token(result.username, result.role)
    refresh_token = tokens.issue(result.username)
    audit.log_operation(
        "login", "success", {"username": req.username}, user=result.username
    )
    # ★ TTC 2026-10-29：登入成功改由後端記錄（前端回報可被假造，管理大廳統計以此為準）
    _system_log("INFO", f"使用者登入成功（角色：{'Admin' if result.role == 'admin' else 'User'}）", result.username, result.username)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_TTL_MINUTES * 60,
        "username": result.username,
        "role": result.role,
        "message": "登入成功。",
    }


@router.post("/auth/refresh")
def refresh(req: RefreshRequest, _: None = Depends(ensure_auth_enabled)):
    """以 refresh token 換發新的 access token；舊的 refresh token 於此作廢，改發一張新的。"""
    tokens = get_token_manager()
    # ★ TTC 2026-11-02：查驗與作廢合併為一個原子操作，同一張 token 只能換發一次（見 TokenManager.consume）
    username = tokens.consume(req.refresh_token)
    if username is None:
        raise PetsError("ERR_UNAUTHORIZED", "refresh token 無效或已過期，請重新登入。")

    user = get_auth_manager().get_user(username)
    if user is None or not user["is_active"]:
        raise PetsError("ERR_UNAUTHORIZED", "帳號不存在或已停用。")

    new_refresh = tokens.issue(username)
    return {
        "access_token": create_access_token(username, user["role"]),
        "refresh_token": new_refresh,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_TTL_MINUTES * 60,
        "username": username,
        "role": user["role"],
    }


@router.post("/auth/logout")
def logout(req: RefreshRequest, _: None = Depends(ensure_auth_enabled)):
    """登出：作廢這一張 refresh token。

    以 refresh token 本身表明身分，不另外要求 access token—— access token 只有 15 分鐘，
    若過期就登不了出，反而會讓 token 留在資料庫裡繼續有效。
    既簽出的 access token 無法收回，最多存活到其到期時間，這是短效設計的取捨。
    """
    tokens = get_token_manager()
    username = tokens.resolve(req.refresh_token)
    if username is None:
        raise PetsError("ERR_UNAUTHORIZED", "refresh token 無效或已過期。")

    tokens.revoke(req.refresh_token)
    get_audit_logger().log_operation("logout", "success", {}, user=username)
    _system_log("INFO", "使用者登出", username, username)
    return {"message": "已登出，該 refresh token 已作廢。"}


@router.patch("/auth/password")
def change_password(
    req: ChangePasswordRequest, user: dict = Depends(get_current_user)
):
    """變更自己的密碼：須帶舊密碼，驗過才換。"""
    audit = get_audit_logger()
    changed = get_auth_manager().change_password(
        user["username"], req.current_password, req.new_password
    )
    if not changed:
        audit.log_operation(
            "change_password", "failed", {}, user=user["username"]
        )
        # 與登入失敗回同一句話，不額外提示「舊密碼錯誤」
        raise PetsError("ERR_UNAUTHORIZED", _CREDENTIALS_MESSAGE)

    get_token_manager().revoke_all(user["username"], keep=req.refresh_token)
    audit.log_operation("change_password", "success", {}, user=user["username"])
    return {"message": "密碼已變更。"}
