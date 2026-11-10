"""權限控管與資料存取檢查（合約四、需求說明(四)2 之安全性測試）。

檢查項目：
    1. 以 CLI 建立兩種角色（admin／user）的使用者
    2. 帳密正確 → /auth/login 回 200 並帶出角色
    3. 密碼錯誤 → 回 401
    4. 帳號不存在 → 回 401
    5. 重複建立同一帳號 → CLI 以非零狀態碼結束
    6. 使用者密碼不以明文留存（直接讀 users.db 確認）
    7. 帳號管理端點限 admin：一般使用者呼叫 /users 回 403
    8. 稽核軌跡鏈式完整性校驗（verify-log）

會員系統與去識別化端點為各自獨立的兩套，去識別化端點不需登入即可呼叫，
故本檢查不測「未登入呼叫去識別化端點被擋」。

用法：python scenarios/check_access_control.py
"""

from __future__ import annotations

import json
import os
import socket
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "scenarios" / "out"
USERS = [
    ("scenario_admin", "Adm!n-2026-Test", "admin"),
    ("scenario_user", "Us3r-2026-Test", "user"),
]
# 會員端點需要簽章金鑰才會啟用（未設定時一律回 503，見 governance/token）。
# 檢查用的伺服器一律備妥一把，避免把「金鑰沒設」誤判成權限控管失效。
JWT_SECRET = "scenario-check-only-jwt-secret"
results: list[dict] = []


def record(item: str, expected: str, actual: str) -> None:
    ok = expected == actual
    results.append({"項目": item, "預期": expected, "實際": actual, "結果": "通過" if ok else "未通過"})
    print(f"  {'通過' if ok else '未通過'}  {item}：預期 {expected}，實得 {actual}")


def cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "app.cli.main", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("[權限控管與資料存取檢查]")

    for username, password, role in USERS:
        proc = cli("create-user", "-u", username, "-p", password, "-r", role)
        record(f"建立使用者 {username}（{role}）", "建立成功", "建立成功" if proc.returncode == 0 else "失敗")

    dup = cli("create-user", "-u", USERS[0][0], "-p", USERS[0][1], "-r", "admin")
    record("重複建立同一帳號", "非零狀態碼", "非零狀態碼" if dup.returncode != 0 else "狀態碼 0")

    port = free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.api.server:app", "--port", str(port)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={
            **os.environ,
            "PYTHONIOENCODING": "utf-8",
            "OPEN_PETS_JWT_SECRET": os.environ.get("OPEN_PETS_JWT_SECRET", JWT_SECRET),
        },
    )
    base = f"http://127.0.0.1:{port}/api/v1"
    try:
        for _ in range(60):
            try:
                requests.get(f"http://127.0.0.1:{port}/", timeout=1)
                break
            except requests.RequestException:
                time.sleep(0.5)

        resp = requests.post(
            f"{base}/auth/login", json={"username": USERS[1][0], "password": USERS[1][1]}, timeout=10
        )
        record("正確帳密登入", "200 且角色 user",
               f"{resp.status_code} 且角色 {resp.json().get('role')}" if resp.status_code == 200 else str(resp.status_code))

        # 一般使用者的 token 不得用於帳號管理：身分沒問題但角色不足，應回 403
        user_token = resp.json().get("access_token") if resp.status_code == 200 else ""
        forbidden = requests.get(
            f"{base}/users", headers={"Authorization": f"Bearer {user_token}"}, timeout=10
        )
        record("一般使用者呼叫帳號管理端點", "403", str(forbidden.status_code))

        resp = requests.post(
            f"{base}/auth/login", json={"username": USERS[1][0], "password": "wrong-password"}, timeout=10
        )
        record("密碼錯誤登入", "401", str(resp.status_code))

        resp = requests.post(
            f"{base}/auth/login", json={"username": "no_such_user", "password": "whatever"}, timeout=10
        )
        record("帳號不存在登入", "401", str(resp.status_code))
    finally:
        server.terminate()
        server.wait(timeout=30)

    db_path = Path(os.environ.get("OPEN_PETS_DATA_DIR", ROOT / "data")) / "users.db"
    with sqlite3.connect(db_path) as conn:
        stored = conn.execute(
            "SELECT * FROM users WHERE username = ?", (USERS[1][0],)
        ).fetchone()
    plaintext_found = any(USERS[1][1] == str(value) for value in stored)
    record("密碼未以明文留存", "查無明文", "查無明文" if not plaintext_found else "查到明文")

    proc = cli("verify-log")
    record("稽核軌跡完整性校驗", "校驗通過", "校驗通過" if proc.returncode == 0 else "校驗失敗")

    (OUT_DIR / "權限控管檢查結果.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    failed = [r for r in results if r["結果"] != "通過"]
    print(f"\n完成：{len(results)} 項，未通過 {len(failed)} 項")


if __name__ == "__main__":
    main()
