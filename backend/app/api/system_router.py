"""系統資料端點（★ TTC 2026-10-29）：處理紀錄、系統維運日誌、系統設定。

資料存放見 governance/system_store。權限：
    處理紀錄  登入者讀寫自己的；admin 可列出所有人的（?all=1）
    維運日誌  登入者可寫入；讀取與清除限 admin
    系統設定  免登入可讀（閒置登出時間；前端也用它檢查後端是否連得上）；修改限 admin
    介面偏好  登入者讀寫自己的（外觀主題、語系、字體大小）
（系統公告同日移除。）

維運日誌：登入成功／失敗、帳號鎖定、登出、每次處理 API 呼叫由後端自行記錄（origin=server，見 auth_router、
processing_guard）；前端只回報後端看不到的事件（閒置登出、設定變更、帳號管理等，origin=client），
且不得冒用後端事件的開頭文字，避免假造管理大廳統計。

處理紀錄寫入時由伺服器簽章（見 governance/history_signing），GET /history/{id}/verify 重算比對。
"""

import json
import threading
import time
import unicodedata
import uuid
from collections import deque
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.api.auth_router import get_current_user, require_role
from app.core.errors import PetsError
from app.governance.auth import get_password_min_length
from app.governance.history_signing import sign_record, verify_record
from app.governance.system_store import get_system_store

router = APIRouter(tags=["系統資料"])


# ── 處理紀錄 ────────────────────────────────────────────────────────────────
@router.get("/history")
def list_history(all: bool = False, user: dict = Depends(get_current_user)):
    """處理紀錄（新的在前）。一般使用者只看得到自己的；admin 帶 all=1 列出所有人的。"""
    if all and user["role"] != "admin":
        raise PetsError("ERR_FORBIDDEN", "權限不足，列出所有人的紀錄僅限 admin。")
    # ★ TTC 2026-11-02（B5）：以 user_id 篩選，同名的新帳號看不到前一人的紀錄
    records = get_system_store().list_history(None if all else user["user_id"])
    return {"records": records, "total": len(records)}


# ★ TTC 2026-11-02：處理紀錄上限（實際紀錄約數 KB；上限防止單一帳號灌入巨量資料拖慢列表）
MAX_HISTORY_RECORD_BYTES = 256 * 1024


def _require_storable_record(record: dict) -> None:
    """存檔前檢查：不可含 NaN／Infinity、不可過大。須在消耗 runId 之前，驗證失敗才能修正後重送。

    請求主體以 json.loads 解析，會接受 NaN；存進去之後回應時 JSONResponse 不允許 NaN，
    該帳號（與 admin 的全部列表）從此每次讀取都失敗。
    """
    try:
        encoded = json.dumps(record, allow_nan=False, ensure_ascii=False)
    except (ValueError, TypeError) as exc:
        raise PetsError("ERR_INVALID_PARAM", "處理紀錄含有無法保存的數值（NaN 或 Infinity）。") from exc
    if len(encoded.encode("utf-8")) > MAX_HISTORY_RECORD_BYTES:
        raise PetsError("ERR_INVALID_PARAM", f"處理紀錄過大（上限 {MAX_HISTORY_RECORD_BYTES // 1024} KB）。")


@router.post("/history", status_code=201)
def add_history(record: dict, user: dict = Depends(get_current_user)):
    """新增一筆自己的處理紀錄（內容由前端組好，整筆保存）。操作者一律以登入帳號為準，並由伺服器簽章。

    前端只需在 integrity 帶 inputFileSha256／outputFileSha256（檔案在瀏覽器端，伺服器不保留）。

    ★ 2026-10-29：須帶 runId——本帳號 24 小時內成功呼叫處理 API 時回應標頭 X-Run-Id 的值、且未被其他紀錄用過，
    證明這筆紀錄對應一次真的處理；同一 id 不得重送（409），簽過的紀錄不能被改寫重簽。
    """
    store = get_system_store()
    _require_storable_record(record)
    run_id = record.get("runId")
    if not isinstance(run_id, str) or not store.consume_run(run_id, user["username"], user["user_id"]):
        raise PetsError("ERR_RUN_INVALID", "找不到對應的處理執行紀錄（runId 不存在、不是本帳號、已過期或已被使用），無法存檔。")
    record_id = record.get("id")
    if not isinstance(record_id, str) or not record_id:
        record_id = str(uuid.uuid4())
    payload = {**record, "id": record_id, "operator": user["username"], "operatorRole": user["role"]}
    payload["integrity"] = sign_record(payload)
    if not store.add_history(user["username"], record_id, payload, user_id=user["user_id"]):
        raise PetsError("ERR_RECORD_EXISTS", "這筆處理紀錄已存在，不能覆寫。")
    return payload


@router.get("/history/{record_id}/verify")
def verify_history(record_id: str, user: dict = Depends(get_current_user)):
    """重算處理紀錄的指紋與簽章（本人或 admin）。status：valid／tampered／unsigned／unverifiable／missing。

    找不到（或不是本人的紀錄）一律回 missing，不透露紀錄是否存在。
    """
    found = get_system_store().get_history(record_id)
    if found is None or (found[0] != user["user_id"] and user["role"] != "admin"):
        return {"status": "missing", "fingerprintMatches": None, "signatureValid": None}
    return verify_record(found[1])


# ── 系統維運日誌 ────────────────────────────────────────────────────────────
# 後端自行記錄的事件開頭；前端回報不得使用，避免冒充登入／API 統計
RESERVED_EVENT_PREFIXES = ("登入失敗", "登入被拒", "使用者登入成功", "使用者登出", "後端 API 呼叫")


class LogEntry(BaseModel):
    level: Literal["INFO", "WARN", "ERROR"]
    event: str = Field(..., min_length=1, max_length=500)
    source: str = Field("System", max_length=200)
    ts: int | None = None  # 舊版前端會送；一律改用伺服器時間


class LogBatch(BaseModel):
    entries: list[LogEntry] = Field(..., max_length=50)


# ★ TTC 2026-11-02（B8）：每個帳號每分鐘最多寫入的前端日誌筆數（前端一事件一請求，正常操作遠低於此）
CLIENT_LOG_ENTRIES_PER_MINUTE = 300
_client_log_windows: dict[str, deque] = {}
_client_log_lock = threading.Lock()
_INVISIBLE_CHARS = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff"))


def _normalized_event(event: str) -> str:
    """保留字比對前先正規化：全形半形統一、去掉零寬字元與前後空白，避免加個看不見的字元就繞過。"""
    return unicodedata.normalize("NFKC", event).translate(_INVISIBLE_CHARS).strip()


def _charge_client_log_quota(username: str, count: int) -> None:
    now = time.monotonic()
    with _client_log_lock:
        window = _client_log_windows.setdefault(username, deque())
        while window and now - window[0][0] > 60:
            window.popleft()
        used = sum(n for _, n in window)
        if used + count > CLIENT_LOG_ENTRIES_PER_MINUTE:
            raise PetsError("ERR_RATE_LIMITED", "日誌寫入過於頻繁，請稍後再試。")
        window.append((now, count))


@router.post("/system-logs", status_code=201)
def add_system_logs(batch: LogBatch, user: dict = Depends(get_current_user)):
    """批次寫入前端回報的事件（閒置登出、設定變更、帳號管理等），origin=client。"""
    for entry in batch.entries:
        if _normalized_event(entry.event).startswith(RESERVED_EVENT_PREFIXES):
            raise PetsError("ERR_INVALID_PARAM", f"「{entry.event[:20]}…」屬於後端自行記錄的事件，前端不得回報。")
    _charge_client_log_quota(user["username"], len(batch.entries))
    count = get_system_store().add_logs([e.model_dump() for e in batch.entries], user["username"], origin="client")
    return {"saved": count}


@router.get("/system-logs")
def list_system_logs(
    # ★ TTC 2026-11-02：限制範圍，超出 SQLite 整數範圍時原本回 500
    since: int | None = Query(None, ge=0, le=10**13),
    limit: int = 1000,
    _: dict = Depends(require_role("admin")),
):
    """日誌（新的在前）；since 為 epoch 毫秒。"""
    logs = get_system_store().list_logs(since, max(1, min(limit, 5000)))
    return {"logs": logs, "total": len(logs)}


@router.delete("/system-logs")
def clear_system_logs(_: dict = Depends(require_role("admin"))):
    get_system_store().clear_logs()
    return {"message": "日誌已清除。"}


# ── 介面偏好 ────────────────────────────────────────────────────────────────
class PreferencesUpdate(BaseModel):
    """只更新有送的欄位；theme 送 null 表示改回「跟隨作業系統」。"""
    theme: Literal["light", "dark"] | None = None
    language: Literal["zh_TW", "en_US"] | None = None
    font_size: Literal["small", "medium", "large", "extraLarge"] | None = None


@router.get("/preferences")
def get_preferences(user: dict = Depends(get_current_user)):
    """目前帳號的介面偏好；沒存過回空物件（前端用預設值）。"""
    return get_system_store().get_preferences(user["username"], user["user_id"])


@router.put("/preferences")
def update_preferences(req: PreferencesUpdate, user: dict = Depends(get_current_user)):
    return get_system_store().save_preferences(user["username"], req.model_dump(exclude_unset=True), user["user_id"])


# ── 系統設定 ────────────────────────────────────────────────────────────────
class SettingsUpdate(BaseModel):
    session_timeout_minutes: int | None = Field(None, ge=1, le=1440)


@router.get("/settings")
def get_settings():
    """系統設定（免登入：登入前就要知道閒置登出時間，也作為前端的後端連線檢查）。

    ★ TTC 2026-10-30：附帶唯讀的密碼長度下限，前端表單以此為準，不再寫死 12。
    """
    return {**get_system_store().get_settings(), "password_min_length": get_password_min_length()}


@router.put("/settings")
def update_settings(req: SettingsUpdate, user: dict = Depends(require_role("admin"))):
    return get_system_store().update_settings(req.model_dump(exclude_none=True), user["username"])
