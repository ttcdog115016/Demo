"""Open-PETs 單機版啟動器（打包成 OpenPETs.exe 的進入點）。

雙擊執行：
  1. 第一次執行時在 exe 旁建立 .env（隨機產生鹽值、稽核簽章金鑰、登入 token 金鑰）與 data/ 資料夾。
  2. 帳號資料庫沒有任何帳號時，在此視窗建立第一個管理員。
  3. 啟動後端（只聽本機 127.0.0.1），同一個埠同時提供前端網頁，並自動開啟瀏覽器。
  關閉此視窗（或按 Ctrl+C）即停止服務。

指令列（在 exe 所在資料夾開命令提示字元）：
  OpenPETs.exe                      啟動服務並開瀏覽器
  OpenPETs.exe --no-browser         啟動服務，不開瀏覽器
  OpenPETs.exe reset-password       重設某個帳號的密碼（忘記管理員密碼時用）
  OpenPETs.exe create-user ...      以下皆轉給後端 CLI（create-user、verify-log、k-anonymity…）
  OpenPETs.exe --help-cli           顯示後端 CLI 說明

不改動後端原始碼：前端靜態檔與 SPA 路由在此檔掛到後端的 FastAPI app 上。
"""
from __future__ import annotations

import getpass
import json
import multiprocessing
import os
import secrets
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

APP_TITLE = "Open-PETs 資料隱私保護工具"
DEFAULT_PORT = 8765
HOST = "127.0.0.1"  # 只聽本機：單機版不對外開放，資料不離開這台電腦
BACKEND_CLI_COMMANDS = {
    "create-user", "preprocess", "k-anonymity", "dp", "risk-k-anonymity",
    "risk-dp", "risk-cap", "verify-log", "report",
}


# ---------------------------------------------------------------- 路徑
def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def install_dir() -> Path:
    """使用者看得到、可寫入的資料夾（exe 所在處）。.env 與 data/ 放這裡。"""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def resource_dir() -> Path:
    """打包進去的唯讀資源（前端網頁）。"""
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", install_dir()))
    return Path(__file__).resolve().parent / "build"


def frontend_dir() -> Path:
    override = os.getenv("OPEN_PETS_FRONTEND_DIR")
    return Path(override) if override else resource_dir() / "frontend"


# ---------------------------------------------------------------- 主控台
def setup_console() -> None:
    # Windows 主控台預設 cp950，遇到無法編碼的字元會讓整個程式中止；改為替換字元。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleTitleW(APP_TITLE)
        except Exception:
            pass


def pause_before_exit() -> None:
    """雙擊開啟的視窗出錯時會瞬間關閉，看不到訊息；先停住。"""
    if os.name == "nt" and is_frozen():
        try:
            input("\n按 Enter 關閉視窗…")
        except Exception:
            pass


# ---------------------------------------------------------------- .env
def ensure_env_file(base: Path) -> Path:
    env_path = base / ".env"
    if env_path.exists():
        return env_path
    lines = [
        "# Open-PETs 單機版設定（第一次執行時自動產生）",
        "# ★ 請備份本檔並當作機密保管：",
        "#   OPEN_PETS_DEFAULT_SALT 變更或遺失，之後的雜湊結果就和過去對不起來；外流則失去防查表效果。",
        "#   OPEN_PETS_SYSTEM_MASTER_KEY 是稽核紀錄的簽章金鑰，變更後舊紀錄無法驗證。",
        "#   OPEN_PETS_JWT_SECRET 變更只會讓目前登入的人需要重新登入。",
        f"OPEN_PETS_DEFAULT_SALT={secrets.token_hex(32)}",
        f"OPEN_PETS_SYSTEM_MASTER_KEY={secrets.token_hex(32)}",
        f"OPEN_PETS_JWT_SECRET={secrets.token_hex(32)}",
        "",
        "# 資料（帳號資料庫 users.db、稽核紀錄 audit.jsonl、系統日誌）存放位置；相對路徑以本資料夾為準",
        "OPEN_PETS_DATA_DIR=data",
        "OPEN_PETS_LOG_FILE=data/logs/open-pets.log",
        "# 單次上傳上限（MB）；前端也限制 1024 MB，要改需一起改",
        "OPEN_PETS_MAX_UPLOAD_MB=1024",
        "# 服務埠號（只在本機 127.0.0.1）。處理紀錄存在 data/system.db，改埠號不影響",
        f"OPEN_PETS_PORT={DEFAULT_PORT}",
    ]
    # 無 BOM 的 UTF-8；後端以 utf-8-sig 讀，有無 BOM 皆可
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[初次設定] 已建立設定檔 {env_path}（含隨機產生的鹽值與金鑰，請備份）")
    return env_path


def load_env(env_path: Path, base: Path) -> None:
    from dotenv import load_dotenv

    # 作業系統環境變數優先（override=False），與後端 settings.py 一致
    load_dotenv(env_path, encoding="utf-8-sig", override=False)
    # 相對路徑一律以 exe 資料夾為準，不受「從哪裡啟動」影響
    for key in ("OPEN_PETS_DATA_DIR", "OPEN_PETS_LOG_FILE"):
        value = os.getenv(key)
        if value and not os.path.isabs(value):
            os.environ[key] = str((base / value).resolve())
    os.environ.setdefault("OPEN_PETS_DATA_DIR", str((base / "data").resolve()))


def get_port() -> int:
    raw = os.getenv("OPEN_PETS_PORT", "")
    try:
        port = int(raw) if raw.strip() else DEFAULT_PORT
    except ValueError:
        print(f"[警告] OPEN_PETS_PORT={raw!r} 不是數字，改用 {DEFAULT_PORT}")
        port = DEFAULT_PORT
    return port


# ---------------------------------------------------------------- 帳號
def prompt_new_password(min_length: int) -> str:
    while True:
        pw1 = getpass.getpass(f"  密碼（至少 {min_length} 個字元，輸入時不會顯示）：")
        if len(pw1) < min_length:
            print(f"  密碼太短，至少需要 {min_length} 個字元。")
            continue
        pw2 = getpass.getpass("  再輸入一次密碼：")
        if pw1 != pw2:
            print("  兩次輸入不一致，請重新輸入。")
            continue
        return pw1


def ensure_first_admin() -> None:
    from app.core.errors import PetsError
    from app.governance.auth import get_auth_manager, get_password_min_length

    manager = get_auth_manager()
    if manager.list_users():
        return
    print()
    print("=" * 60)
    print(" 第一次使用：請建立系統管理員帳號")
    print(" （之後可登入網頁，在「系統設定 → 帳號管理」新增其他使用者）")
    print("=" * 60)
    min_length = get_password_min_length()
    while True:
        username = input("  管理員帳號（建議用 Email）：").strip()
        if not username:
            print("  帳號不可空白。")
            continue
        password = prompt_new_password(min_length)
        try:
            manager.create_user(username, password, "admin")
        except PetsError as exc:
            print(f"  建立失敗：{exc}")
            continue
        print(f"  已建立管理員 [{username}]。\n")
        return


def reset_password_interactive() -> int:
    from app.core.errors import PetsError
    from app.governance.auth import get_auth_manager, get_password_min_length

    manager = get_auth_manager()
    users = manager.list_users()
    if not users:
        print("目前沒有任何帳號；直接執行 OpenPETs.exe 會引導建立管理員。")
        return 1
    print("目前帳號：")
    for user in users:
        state = "" if user.get("is_active", True) else "（已停用）"
        print(f"  - {user['username']}  [{user['role']}]{state}")
    username = input("要重設密碼的帳號：").strip()
    password = prompt_new_password(get_password_min_length())
    try:
        manager.reset_password(username, password)
    except PetsError as exc:
        print(f"重設失敗：{exc}")
        return 1
    print(f"已重設 [{username}] 的密碼（同時解除登入鎖定）。")
    return 0


# ---------------------------------------------------------------- 網頁
def attach_frontend(app, dist: Path) -> None:
    """把前端 build 結果掛到後端 app：/api/* 照舊，其餘路徑回網頁（React Router 用 index.html）。"""
    from fastapi import HTTPException
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    index_file = dist / "index.html"
    if not index_file.is_file():
        raise FileNotFoundError(f"找不到前端網頁：{index_file}")

    # 後端原本的 GET / 回傳服務狀態 JSON；單機版改由 / 提供網頁，狀態移到 /api/v1/status
    for route in list(app.router.routes):
        if getattr(route, "path", None) == "/" and "GET" in (getattr(route, "methods", None) or set()):
            endpoint = route.endpoint
            app.router.routes.remove(route)
            app.add_api_route("/api/v1/status", endpoint, methods=["GET"], include_in_schema=False)

    assets_dir = dist / "assets"
    if assets_dir.is_dir():
        # 檔名含雜湊，可長期快取
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    no_cache = {"Cache-Control": "no-cache"}
    dist_resolved = dist.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        # /api 底下找不到的端點維持 404 JSON（系統管理大廳以此判斷後端連線），不回網頁
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        if full_path:
            candidate = (dist_resolved / full_path).resolve()
            if candidate.is_file() and dist_resolved in candidate.parents:
                return FileResponse(candidate)
        return FileResponse(index_file, headers=no_cache)


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((HOST, port)) == 0


def is_our_service(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://{HOST}:{port}/api/v1/status", timeout=2) as resp:
            return "Open-PETs" in json.loads(resp.read().decode("utf-8")).get("service", "")
    except Exception:
        return False


def open_browser_when_ready(url: str, port: int) -> None:
    def worker():
        for _ in range(240):  # 最多等 60 秒
            if port_in_use(port):
                webbrowser.open(url)
                return
            time.sleep(0.25)

    threading.Thread(target=worker, daemon=True).start()


def run_server(open_browser: bool) -> int:
    import uvicorn

    port = get_port()
    url = f"http://{HOST}:{port}/"
    if port_in_use(port):
        if is_our_service(port):
            print(f"服務已經在執行中，直接開啟 {url}")
            if open_browser:
                webbrowser.open(url)
            return 0
        print(f"[錯誤] 埠號 {port} 已被其他程式使用。請在 .env 修改 OPEN_PETS_PORT 後重新啟動。")
        return 1

    ensure_first_admin()

    from app.api.server import app

    attach_frontend(app, frontend_dir())

    print("=" * 60)
    print(f" {APP_TITLE}")
    print(f" 網址：{url}")
    print(f" 資料夾：{os.environ['OPEN_PETS_DATA_DIR']}")
    print(" 關閉此視窗（或按 Ctrl+C）即停止服務")
    print("=" * 60)
    if open_browser:
        open_browser_when_ready(url, port)
    uvicorn.run(
        app,
        host=HOST,
        port=port,
        server_header=False,
        log_level="warning",  # 系統日誌由後端 configure_logging 處理；uvicorn 只報警告以上
        timeout_keep_alive=30,
    )
    return 0


# ---------------------------------------------------------------- 進入點
def main(argv: list[str]) -> int:
    setup_console()
    base = install_dir()
    os.chdir(base)
    env_path = ensure_env_file(base)
    load_env(env_path, base)

    if argv and (argv[0] in BACKEND_CLI_COMMANDS or argv[0] == "--help-cli"):
        from app.cli.main import cli

        args = ["--help"] if argv[0] == "--help-cli" else argv
        try:
            cli(args=args, prog_name="OpenPETs.exe")
        except SystemExit as exc:
            return int(exc.code or 0) if not isinstance(exc.code, str) else 1
        return 0
    if argv and argv[0] == "reset-password":
        return reset_password_interactive()
    if argv and argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    return run_server(open_browser="--no-browser" not in argv)


if __name__ == "__main__":
    multiprocessing.freeze_support()  # 打包後 joblib／multiprocessing 子行程需要
    try:
        code = main(sys.argv[1:])
    except KeyboardInterrupt:
        code = 0
    except Exception as exc:  # 雙擊執行時讓使用者看得到錯誤
        import traceback

        traceback.print_exc()
        print(f"\n[錯誤] 啟動失敗：{exc}")
        pause_before_exit()
        code = 1
    else:
        if code:
            pause_before_exit()
    sys.exit(code)
