"""帳號管理端點（/users）：列出、建立、改角色、重設密碼、停用、刪除。全組限 admin。

第一個管理員一律以 CLI 建立（`create-user`）：系統不自建任何預設帳號，
而本組端點需要有人先是 admin 才進得來，故 API 只負責第二個以後的帳號。

建立帳號與 CLI 走的是同一份 AuthManager.create_user()——角色白名單、密碼雜湊、
重複帳號的判斷只寫一次，兩個入口不可能出現不同的結果。差別只在本組端點要求 admin 身分，
CLI 不要求：能在機器上敲指令的人已經站在資料與設定檔前面，再要一次登入並無實益。
"""

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from app.api.auth_router import MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, require_role
from app.core.errors import PetsError
from app.governance.audit import get_audit_logger
from app.governance.auth import ROLES, get_auth_manager
from app.governance.token import get_token_manager

router = APIRouter(tags=["帳號管理"])

_ROLE_HELP = f"角色，必須為 {' 或 '.join(ROLES)}"


class CreateUserRequest(BaseModel):
    # ★ TTC 2026-11-02：長度上限與登入端點一致
    username: str = Field(..., min_length=1, max_length=MAX_USERNAME_LENGTH)
    password: str = Field(..., min_length=1, max_length=MAX_PASSWORD_LENGTH)
    role: str = Field(..., description=_ROLE_HELP)


class ChangeRoleRequest(BaseModel):
    role: str = Field(..., description=_ROLE_HELP)
    # ★ TTC 2026-11-02（B4）：把 admin 降級時須帶操作者自己的密碼再次確認
    current_password: str | None = Field(None, max_length=MAX_PASSWORD_LENGTH)


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=1, max_length=MAX_PASSWORD_LENGTH)


class SetActiveRequest(BaseModel):
    is_active: bool


@router.get("/users")
def list_users(admin: dict = Depends(require_role("admin"))):
    """列出所有帳號。回傳不含密碼雜湊。"""
    users = get_auth_manager().list_users()
    return {"users": users, "total": len(users)}


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(req: CreateUserRequest, admin: dict = Depends(require_role("admin"))):
    """建立帳號。帳號已存在回 409，角色不合法回 400。"""
    get_auth_manager().create_user(req.username, req.password, req.role)
    get_audit_logger().log_operation(
        "create_user",
        "success",
        {"target": req.username, "role": req.role.strip().lower()},
        user=admin["username"],
    )
    return {
        "username": req.username,
        "role": req.role.strip().lower(),
        "message": f"已建立使用者 [{req.username}]。",
    }


@router.patch("/users/{username}/role")
def change_role(
    username: str,
    req: ChangeRoleRequest,
    admin: dict = Depends(require_role("admin")),
):
    """變更他人的角色。admin 與 user 可互相升降。

    唯一的限制是不得變更自己的角色——管理者一旦把自己降級就再也改不回來，
    只能回到機器上用 CLI 重建帳號。此處刻意不做「系統至少要保留幾個 admin」的計數：
    兩個管理員同時降對方時，計數在併發下並不可靠，反而給出一種安全的錯覺。
    """
    if username == admin["username"]:
        raise PetsError("ERR_FORBIDDEN", "不得變更自己的角色。")

    manager = get_auth_manager()
    target = manager.get_user(username)
    demoting_admin = (
        target is not None and target["role"] == "admin" and req.role.strip().lower() != "admin"
    )
    if demoting_admin:
        # ★ TTC 2026-11-02（B4）：原本可「降級另一位 admin → 重設其密碼 → 升回 admin」接管對方帳號。
        #   降級 admin 須再次輸入自己的密碼（驗錯計入自己的登入鎖定），且被降級者 24 小時內不可被重設密碼。
        if not req.current_password or not manager.authenticate(admin["username"], req.current_password).ok:
            get_audit_logger().log_operation(
                "demote_admin", "failed", {"target": username, "reason": "reauth_failed"},
                user=admin["username"],
            )
            raise PetsError("ERR_FORBIDDEN", "降級管理員須輸入您自己的密碼確認，密碼不正確。")

    updated = manager.set_role(username, req.role)
    get_audit_logger().log_operation(
        "demote_admin" if demoting_admin else "change_role",
        "success",
        {"target": username, "new_role": updated["role"]},
        user=admin["username"],
    )
    return updated


@router.post("/users/{username}/reset-password")
def reset_password(
    username: str,
    req: ResetPasswordRequest,
    admin: dict = Depends(require_role("admin")),
):
    """重設他人的密碼（不需舊密碼），並強制該帳號重新登入。

    不得重設任何管理員的密碼（含自己）：管理者要改自己的密碼請走
    PATCH /auth/password，那條路徑要求先驗過舊密碼。若此處放行，
    任何取得管理員 token 的人都能直接接管其他管理員的帳號。
    """
    manager = get_auth_manager()
    target = manager.get_user(username)
    if target is None:
        raise PetsError("ERR_NOT_FOUND", f"使用者 [{username}] 不存在。")
    # ★ TTC 2026-11-02（B4）：24 小時內曾是 admin 者同樣不可重設，堵住「先降級再重設」
    if manager.was_admin_recently(username):
        raise PetsError(
            "ERR_FORBIDDEN",
            "不得重設管理員（含 24 小時內被降級者）的密碼；管理員請以 PATCH /auth/password 自行變更。",
        )

    manager.reset_password(username, req.new_password)
    # 密碼換了，既發出的 refresh token 一律作廢——否則舊密碼的持有者仍能繼續換發 access token。
    get_token_manager().revoke_all(username)
    get_audit_logger().log_operation(
        "reset_password", "success", {"target": username}, user=admin["username"]
    )
    return {"message": f"已重設使用者 [{username}] 的密碼，該帳號需重新登入。"}


@router.patch("/users/{username}/active")
def set_active(
    username: str,
    req: SetActiveRequest,
    admin: dict = Depends(require_role("admin")),
):
    """停用或恢復帳號。停用後該帳號無法登入，既有的 refresh token 一併作廢。

    不得停用自己：管理者停用自己之後就再也登不進來改回去。
    """
    if username == admin["username"]:
        raise PetsError("ERR_FORBIDDEN", "不得停用自己的帳號。")

    updated = get_auth_manager().set_active(username, req.is_active)
    if not req.is_active:
        get_token_manager().revoke_all(username)
    get_audit_logger().log_operation(
        "set_active",
        "success",
        {"target": username, "is_active": req.is_active},
        user=admin["username"],
    )
    return updated


@router.delete("/users/{username}")
def delete_user(username: str, admin: dict = Depends(require_role("admin"))):
    """刪除帳號（連同其所有 refresh token）。

    與停用並存而非取代：停用可回復，刪除不可回復。上線前要清除測試帳號與管理帳號時
    需要的是真的刪掉——只把旗標關掉，帳號紀錄仍留在資料庫裡。

    不得刪除自己：與停用同理，且刪掉自己之後連補救的身分都沒有了。
    """
    if username == admin["username"]:
        raise PetsError("ERR_FORBIDDEN", "不得刪除自己的帳號。")

    get_auth_manager().delete_user(username)
    get_audit_logger().log_operation(
        "delete_user", "success", {"target": username}, user=admin["username"]
    )
    return {"message": f"已刪除使用者 [{username}]。"}
