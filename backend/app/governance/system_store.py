"""系統資料（SQLite）：處理紀錄、處理執行紀錄（runs）、系統維運日誌、系統設定。

★ TTC 2026-10-29：前端原本把這些資料存在使用者自己的瀏覽器（localStorage），
換電腦或清快取就不見，管理員也看不到別人的紀錄；改為集中存在後端。

與帳號資料庫（users.db）分開成 system.db：帳號與 token 必須在同一個交易內同生同滅，
這裡的資料與帳號沒有那種綁定——刪帳號時處理紀錄仍保留，作為事後查核的依據。

處理紀錄的內容由前端組好（欄位很多且隨畫面演進），後端整筆以 JSON 存放，
只把查詢會用到的欄位（帳號、時間）另外拉成欄位。

★ TTC 2026-10-29（第二次）：系統公告整個移除（舊資料表留在檔案中，不再讀寫）；
處理 API 改須登入，每次呼叫記一筆 runs（處理紀錄須引用同帳號的 run 才能存）；
維運日誌加 origin（server＝後端自行記錄、client＝前端回報），時間一律用伺服器時間。
"""

import json
import os
import sqlite3
import time
from typing import Any

from app.core.settings import get_data_dir

# 每位使用者保留的處理紀錄筆數上限（新的在前），與前端原本的上限一致
MAX_HISTORY_PER_USER = 200
# 維運日誌保留筆數上限；超過時刪掉最舊的
MAX_SYSTEM_LOGS = 20000
# 處理紀錄引用的 run 須在此時間內（毫秒）
RUN_VALID_MS = 24 * 60 * 60 * 1000

# 系統設定的預設值；只接受這裡列出的鍵
DEFAULT_SETTINGS: dict[str, Any] = {
    "session_timeout_minutes": 15,
}


def _now_ms() -> int:
    return int(time.time() * 1000)


class SystemStore:
    """系統資料存取（SQLite）。"""

    def __init__(self, db_path: str | None = None):
        if db_path is None:
            self.db_path = os.path.join(get_data_dir(), "system.db")
        else:
            self.db_path = db_path
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS history (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_history_user ON history (username, created_at);
                CREATE TABLE IF NOT EXISTS system_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts INTEGER NOT NULL,
                    level TEXT NOT NULL,
                    event TEXT NOT NULL,
                    source TEXT NOT NULL,
                    username TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_system_logs_ts ON system_logs (ts);
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    updated_by TEXT
                );
                CREATE TABLE IF NOT EXISTS user_preferences (
                    username TEXT PRIMARY KEY,
                    prefs_json TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    endpoint TEXT NOT NULL,
                    status INTEGER NOT NULL,
                    created_at INTEGER NOT NULL,
                    used INTEGER NOT NULL DEFAULT 0
                );
                """
            )
            # 舊版 system_logs 沒有 origin 欄位：補上（舊紀錄視為前端回報）
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(system_logs)").fetchall()}
            if "origin" not in columns:
                conn.execute("ALTER TABLE system_logs ADD COLUMN origin TEXT NOT NULL DEFAULT 'client'")
            # ★ TTC 2026-11-02（B5）：處理紀錄、執行紀錄、偏好改綁不可變的 user_id（見 auth.users.user_id）。
            #   原本以帳號名稱為鍵：刪除帳號後建立同名帳號，就看得到前一人的處理紀錄（檔名、雜湊、參數）。
            for table in ("history", "runs", "user_preferences"):
                table_columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
                if "user_id" not in table_columns:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN user_id TEXT")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_user_id ON history (user_id, created_at)")

    def backfill_user_ids(self, accounts: dict[str, tuple[str, int]]) -> None:
        """舊資料補上 user_id（★ TTC 2026-11-02 B5）。

        accounts：帳號 → (user_id, 帳號建立時間 ms)。只認領帳號建立之後的紀錄——
        建立前的同名紀錄屬於之前被刪除的另一個人，維持 NULL（只有 admin 列出全部時看得到）。
        """
        with self._connect() as conn:
            for username, (user_id, created_ms) in accounts.items():
                for table in ("history", "runs"):
                    conn.execute(
                        f"UPDATE {table} SET user_id = ? WHERE user_id IS NULL AND username = ? AND created_at >= ?",
                        (user_id, username, created_ms),
                    )
                conn.execute(
                    "UPDATE user_preferences SET user_id = ? WHERE user_id IS NULL AND username = ? AND updated_at >= ?",
                    (user_id, username, created_ms),
                )

    # ── 處理紀錄 ──────────────────────────────────────────────────────────
    def add_history(self, username: str, record_id: str, payload: dict, user_id: str | None = None) -> bool:
        """新增一筆處理紀錄；id 已存在時不覆寫、回 False。超過上限時刪掉該使用者最舊的。

        排序時間一律用伺服器時間（前端給的時間不可信，未來的時間會讓紀錄永遠不被裁掉）。
        """
        with self._connect() as conn:
            inserted = conn.execute(
                "INSERT OR IGNORE INTO history (id, username, created_at, payload_json, user_id) VALUES (?, ?, ?, ?, ?)",
                (record_id, username, _now_ms(), json.dumps(payload, ensure_ascii=False), user_id),
            ).rowcount
            if not inserted:
                return False
            conn.execute(
                """DELETE FROM history WHERE user_id IS ? AND username = ? AND id NOT IN (
                       SELECT id FROM history WHERE user_id IS ? AND username = ? ORDER BY created_at DESC LIMIT ?)""",
                (user_id, username, user_id, username, MAX_HISTORY_PER_USER),
            )
        return True

    # ── 處理執行紀錄（runs） ──────────────────────────────────────────────
    def add_run(self, run_id: str, username: str, endpoint: str, status: int, user_id: str | None = None) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO runs (run_id, username, endpoint, status, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?)",
                (run_id, username, endpoint, status, _now_ms(), user_id),
            )
            conn.execute("DELETE FROM runs WHERE created_at < ?", (_now_ms() - 7 * RUN_VALID_MS,))

    def consume_run(self, run_id: str, username: str, user_id: str | None = None) -> bool:
        """處理紀錄引用一筆 run：須為同帳號、成功（2xx）、未過期、未被引用過；成功時標記為已用。

        ★ TTC 2026-11-02（B5）：有 user_id 的 run 必須同一個 user_id（同名的新帳號不算同一人）。
        """
        with self._connect() as conn:
            return conn.execute(
                """UPDATE runs SET used = 1
                   WHERE run_id = ? AND username = ? AND (user_id IS NULL OR user_id = ?)
                     AND used = 0 AND status BETWEEN 200 AND 299 AND created_at >= ?""",
                (run_id, username, user_id, _now_ms() - RUN_VALID_MS),
            ).rowcount == 1

    def get_history(self, record_id: str) -> tuple[str | None, dict] | None:
        """（擁有者 user_id, 紀錄內容）；不存在時回 None。舊紀錄未能歸屬時 user_id 為 None。"""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT user_id, payload_json FROM history WHERE id = ?", (record_id,)
            ).fetchone()
        return (row["user_id"], json.loads(row["payload_json"])) if row else None

    def list_history(self, user_id: str | None = None) -> list[dict]:
        """處理紀錄（新的在前）；user_id 為 None 時列出所有人的（★ TTC 2026-11-02 B5：以 user_id 篩選）。"""
        with self._connect() as conn:
            if user_id is None:
                rows = conn.execute("SELECT payload_json FROM history ORDER BY created_at DESC").fetchall()
            else:
                rows = conn.execute(
                    "SELECT payload_json FROM history WHERE user_id = ? ORDER BY created_at DESC",
                    (user_id,),
                ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

    # ── 系統維運日誌 ──────────────────────────────────────────────────────
    def add_logs(self, entries: list[dict], username: str | None, origin: str = "client") -> int:
        """批次寫入日誌；entries 每筆需有 level／event／source。時間一律用伺服器時間（前端時鐘不可信）。"""
        if not entries:
            return 0
        now = _now_ms()
        with self._connect() as conn:
            conn.executemany(
                "INSERT INTO system_logs (ts, level, event, source, username, origin) VALUES (?, ?, ?, ?, ?, ?)",
                [(now, e["level"], e["event"], e["source"], username, origin) for e in entries],
            )
            # ★ TTC 2026-11-02（B8）：依來源分別保留。原本不分來源只留最新 2 萬筆，任何登入者灌前端日誌
            #   就能把後端記錄的登入失敗、鎖定等安全事件擠掉。
            conn.execute(
                "DELETE FROM system_logs WHERE origin = ? AND id NOT IN "
                "(SELECT id FROM system_logs WHERE origin = ? ORDER BY id DESC LIMIT ?)",
                (origin, origin, MAX_SYSTEM_LOGS),
            )
        return len(entries)

    def add_log(self, level: str, event: str, source: str, username: str | None = None, origin: str = "server") -> None:
        """後端自行記錄的事件（預設 origin=server）。"""
        self.add_logs([{"level": level, "event": event, "source": source}], username, origin)

    def list_logs(self, since_ms: int | None = None, limit: int = 1000) -> list[dict]:
        """日誌（新的在前）。"""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, ts, level, event, source, username, origin FROM system_logs WHERE ts >= ? ORDER BY ts DESC, id DESC LIMIT ?",
                (since_ms or 0, limit),
            ).fetchall()
        return [
            {
                "id": str(r["id"]), "timestamp": r["ts"], "level": r["level"], "event": r["event"],
                "source": r["source"], "username": r["username"], "origin": r["origin"],
            }
            for r in rows
        ]

    def clear_logs(self) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM system_logs")

    # ── 介面偏好（★ TTC 2026-10-29：依帳號記住外觀主題、語系、字體大小） ──
    def get_preferences(self, username: str, user_id: str | None = None) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT prefs_json FROM user_preferences WHERE username = ? AND user_id IS ?", (username, user_id)
            ).fetchone()
        return json.loads(row["prefs_json"]) if row else {}

    def save_preferences(self, username: str, changes: dict[str, Any], user_id: str | None = None) -> dict[str, Any]:
        """只更新有送的欄位，回傳更新後的完整偏好。同名的前一個帳號留下的偏好不沿用（以新帳號的 user_id 覆寫）。"""
        merged = {**self.get_preferences(username, user_id), **changes}
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO user_preferences (username, prefs_json, updated_at, user_id) VALUES (?, ?, ?, ?)",
                (username, json.dumps(merged, ensure_ascii=False), _now_ms(), user_id),
            )
        return merged

    # ── 系統設定 ──────────────────────────────────────────────────────────
    def get_settings(self) -> dict[str, Any]:
        result = dict(DEFAULT_SETTINGS)
        with self._connect() as conn:
            for row in conn.execute("SELECT key, value_json FROM settings").fetchall():
                if row["key"] in DEFAULT_SETTINGS:
                    result[row["key"]] = json.loads(row["value_json"])
        return result

    def update_settings(self, changes: dict[str, Any], updated_by: str) -> dict[str, Any]:
        with self._connect() as conn:
            for key, value in changes.items():
                conn.execute(
                    "INSERT OR REPLACE INTO settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)",
                    (key, json.dumps(value), _now_ms(), updated_by),
                )
        return self.get_settings()


_system_store: SystemStore | None = None


def get_system_store() -> SystemStore:
    """全專案共用的系統資料存取；延後建立，理由同 auth.get_auth_manager()。"""
    global _system_store
    if _system_store is None:
        _system_store = SystemStore()
        # ★ TTC 2026-11-02（B5）：舊資料補上 user_id（只認領各帳號建立之後的紀錄）
        from app.governance.auth import get_auth_manager

        _system_store.backfill_user_ids(get_auth_manager().account_ids_with_creation_ms())
    return _system_store
