"""Open-PETs 單機版啟動器（打包成 OpenPETs.exe／OpenPETs-cli.exe 的進入點）。

OpenPETs.exe（視窗版，安裝程式建立的捷徑指向這個）：
  1. 第一次執行時在 %LOCALAPPDATA%\\OpenPETs 建立 .env（隨機產生鹽值、稽核簽章金鑰、登入 token 金鑰）與 data/ 資料夾。
  2. 在背景啟動後端（只聽本機 127.0.0.1），同一個埠同時提供前端網頁。
  3. 開啟 App 視窗（WebView2，沒有網址列）；帳號資料庫沒有任何帳號時先顯示「建立系統管理員」畫面。
  關閉 App 視窗即停止服務。不會出現黑色主控台視窗；錯誤以對話框顯示，記錄在 data/logs/launcher.log。

OpenPETs-cli.exe（主控台版，給管理員維護用）：
  OpenPETs-cli.exe                  啟動服務並開瀏覽器（舊版行為；第一次在主控台建立管理員）
  OpenPETs-cli.exe --no-browser     啟動服務，不開瀏覽器
  OpenPETs-cli.exe reset-password   重設某個帳號的密碼（忘記管理員密碼時用）
  OpenPETs-cli.exe create-user ...  以下皆轉給後端 CLI（create-user、verify-log、k-anonymity…）
  OpenPETs-cli.exe --help-cli       顯示後端 CLI 說明

資料位置：環境變數 OPEN_PETS_HOME 優先；exe 旁已有 .env（舊版資料夾版）則沿用 exe 資料夾；否則 %LOCALAPPDATA%\\OpenPETs。
兩個 exe 讀同一份資料，帳號、鹽值、稽核紀錄共用。

不改動後端原始碼：前端靜態檔、SPA 路由與初次設定畫面在此檔掛到後端的 FastAPI app 上。
"""
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

from fastapi import Request

APP_TITLE = "Open-PETs 資料隱私保護工具"
DEFAULT_PORT = 8765
HOST = "127.0.0.1"  # 只聽本機：單機版不對外開放，資料不離開這台電腦
BACKEND_CLI_COMMANDS = {
    "create-user", "preprocess", "k-anonymity", "dp", "risk-k-anonymity",
    "risk-dp", "risk-cap", "verify-log", "report",
}
SETUP_PAGE_PATH = "/setup"
SETUP_API_PATH = "/api/v1/desktop/setup"


# ---------------------------------------------------------------- 路徑
def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def install_dir() -> Path:
    """exe 所在資料夾（程式本體）。"""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def is_cli_exe() -> bool:
    return is_frozen() and Path(sys.executable).stem.lower().endswith("-cli")


def home_dir() -> Path:
    """.env 與 data/ 所在處。安裝版的程式資料夾解除安裝時會刪除，資料另外放，才不會連帶刪掉帳號與鹽值。"""
    override = os.getenv("OPEN_PETS_HOME")
    if override:
        return Path(override)
    exe_dir = install_dir()
    if (exe_dir / ".env").exists() or not is_frozen():
        return exe_dir  # 舊版資料夾版（.env 在 exe 旁）沿用；開發時用 packaging/
    local_app_data = os.getenv("LOCALAPPDATA")
    return (Path(local_app_data) if local_app_data else Path.home()) / "OpenPETs"


def resource_dir() -> Path:
    """打包進去的唯讀資源（前端網頁）。"""
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", install_dir()))
    return Path(__file__).resolve().parent / "build"


def frontend_dir() -> Path:
    override = os.getenv("OPEN_PETS_FRONTEND_DIR")
    return Path(override) if override else resource_dir() / "frontend"


# ---------------------------------------------------------------- 主控台／對話框
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


def redirect_output_to_log(base: Path, heading: str = f"啟動 {APP_TITLE}") -> Path:
    """視窗版沒有主控台（sys.stdout 為 None，uvicorn 寫日誌會出錯）；輸出一律寫到檔案。"""
    log_path = base / "data" / "logs" / "launcher.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_file = open(log_path, "a", encoding="utf-8", errors="replace", buffering=1)
    sys.stdout = log_file
    sys.stderr = log_file
    print(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} {heading}")
    return log_path


def message_box(text: str, is_error: bool = False) -> None:
    if os.name != "nt":
        print(text)
        return
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, APP_TITLE, 0x10 if is_error else 0x40)
    except Exception:
        print(text)


def pause_before_exit() -> None:
    """雙擊開啟的主控台出錯時會瞬間關閉，看不到訊息；先停住。"""
    if os.name == "nt" and is_frozen() and sys.stdin is not None:
        try:
            input("\n按 Enter 關閉視窗…")
        except Exception:
            pass


# ---------------------------------------------------------------- .env
def ensure_env_file(base: Path) -> Path:
    base.mkdir(parents=True, exist_ok=True)
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
    # 相對路徑一律以資料資料夾為準，不受「從哪裡啟動」影響
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
def needs_first_admin() -> bool:
    from app.governance.auth import get_auth_manager

    return not get_auth_manager().list_users()


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
    """主控台版：在主控台建立第一個管理員。"""
    from app.core.errors import PetsError
    from app.governance.auth import get_auth_manager, get_password_min_length

    if not needs_first_admin():
        return
    manager = get_auth_manager()
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
        print("目前沒有任何帳號；開啟 Open-PETs 會引導建立管理員。")
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


# ---------------------------------------------------------------- 初次設定畫面（視窗版）
SETUP_PAGE_HTML = """<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>初次設定 - Open-PETs</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #f1f5f9; font-family: "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif; color: #0f172a; }
  .card { background: #fff; width: 420px; max-width: calc(100% - 32px); padding: 32px; border-radius: 12px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, .12); box-sizing: border-box; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p.lead { margin: 0 0 24px; color: #475569; line-height: 1.6; font-size: 14px; }
  label { display: block; font-size: 14px; font-weight: 600; margin: 16px 0 6px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 15px; border: 1px solid #cbd5e1; border-radius: 8px; }
  input:focus { outline: 2px solid #10b981; border-color: #10b981; }
  .hint { font-size: 12px; color: #64748b; margin-top: 4px; }
  button { width: 100%; margin-top: 24px; padding: 12px; font-size: 16px; font-weight: 600; color: #fff;
           background: #10b981; border: 0; border-radius: 8px; cursor: pointer; }
  button:disabled { background: #94a3b8; cursor: default; }
  .msg { margin-top: 16px; font-size: 14px; line-height: 1.6; min-height: 1.6em; }
  .msg.error { color: #dc2626; } .msg.ok { color: #059669; }
</style></head>
<body><form class="card" id="f" autocomplete="off">
  <h1>第一次使用：建立系統管理員</h1>
  <p class="lead">管理員可登入後在「系統設定 → 帳號管理」新增其他使用者。帳號與資料只存在這台電腦。</p>
  <label for="u">管理員帳號（建議用 Email）</label>
  <input id="u" required autofocus>
  <label for="p1">密碼</label>
  <input id="p1" type="password" required>
  <div class="hint" id="pwHint"></div>
  <label for="p2">再輸入一次密碼</label>
  <input id="p2" type="password" required>
  <button id="b" type="submit">建立管理員</button>
  <div class="msg" id="m" role="alert"></div>
</form>
<script>
(async () => {
  const api = "__SETUP_API__";
  const $ = (id) => document.getElementById(id);
  let minLength = 12;
  try {
    const s = await (await fetch(api)).json();
    if (!s.needs_setup) { location.replace("/"); return; }
    minLength = s.password_min_length || minLength;
  } catch (e) {}
  $("pwHint").textContent = "至少 " + minLength + " 個字元";
  const show = (text, cls) => { $("m").textContent = text; $("m").className = "msg " + cls; };
  $("f").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const username = $("u").value.trim(), password = $("p1").value;
    if (!username) return show("帳號不可空白。", "error");
    if (password.length < minLength) return show("密碼太短，至少需要 " + minLength + " 個字元。", "error");
    if (password !== $("p2").value) return show("兩次輸入的密碼不一致。", "error");
    $("b").disabled = true;
    try {
      const r = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { $("b").disabled = false; return show(body.message || "建立失敗，請再試一次。", "error"); }
      show("已建立管理員 [" + username + "]，即將前往登入頁…", "ok");
      setTimeout(() => location.replace("/"), 1200);
    } catch (e) { $("b").disabled = false; show("無法連線到服務，請關閉後重新開啟 Open-PETs。", "error"); }
  });
})();
</script></body></html>
""".replace("__SETUP_API__", SETUP_API_PATH)


def attach_first_run_setup(app) -> None:
    """沒有任何帳號時提供「建立系統管理員」畫面與 API；建立第一個帳號後兩者皆失效（只接受本機連線）。"""
    from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

    from app.core.errors import PetsError
    from app.governance.auth import get_auth_manager, get_password_min_length

    create_lock = threading.Lock()

    @app.get(SETUP_API_PATH, include_in_schema=False)
    def setup_status():
        return {"needs_setup": needs_first_admin(), "password_min_length": get_password_min_length()}

    @app.post(SETUP_API_PATH, include_in_schema=False)
    async def setup_create_admin(request: Request):
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        username = str(payload.get("username", "")).strip() if isinstance(payload, dict) else ""
        password = str(payload.get("password", "")) if isinstance(payload, dict) else ""
        if not username or not password:
            return JSONResponse({"message": "帳號與密碼不可空白。"}, status_code=400)
        with create_lock:  # 同時送出兩次時只有第一個成立
            if not needs_first_admin():
                return JSONResponse({"message": "已經有帳號了，請直接登入。"}, status_code=409)
            try:
                get_auth_manager().create_user(username, password, "admin")
            except PetsError as exc:
                return JSONResponse({"message": f"建立失敗：{exc}"}, status_code=400)
        print(f"[初次設定] 已建立管理員 [{username}]")
        return {"ok": True}

    @app.get(SETUP_PAGE_PATH, include_in_schema=False)
    def setup_page():
        if not needs_first_admin():
            return RedirectResponse("/")
        return HTMLResponse(SETUP_PAGE_HTML, headers={"Cache-Control": "no-cache"})


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


def build_app():
    from app.api.server import app

    attach_first_run_setup(app)  # 須在前端 catch-all 路由之前註冊
    attach_frontend(app, frontend_dir())
    return app


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
    """主控台版：前景執行服務，可選擇開瀏覽器。"""
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
    app = build_app()

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


# ---------------------------------------------------------------- 視窗版：後端子行程
# ★ 2026-10-30：後端原本跑在 App 視窗同一個行程的執行緒，與 WebView2 的事件處理共用 Python GIL；
#   後端運算佔住 GIL 時視窗的 UI 執行緒等不到，整個視窗卡住。改為同一個 exe 另開子行程跑後端。
SERVE_INTERNAL_FLAG = "--serve-internal"
PARENT_PID_FLAG = "--parent-pid"
SYNCHRONIZE = 0x00100000
INFINITE = 0xFFFFFFFF


def shutdown_event_name(parent_pid: int) -> str:
    """視窗關閉時父行程設定此具名事件，子行程收到後正常結束 uvicorn（不硬殺，避免稽核紀錄寫一半）。"""
    return f"Local\\OpenPETs-shutdown-{parent_pid}"


def server_subprocess_command(parent_pid: int) -> list[str]:
    entry = [sys.executable] if is_frozen() else [sys.executable, str(Path(__file__).resolve())]
    return [*entry, SERVE_INTERNAL_FLAG, PARENT_PID_FLAG, str(parent_pid)]


def parse_parent_pid(argv: list[str]) -> int | None:
    if PARENT_PID_FLAG in argv:
        index = argv.index(PARENT_PID_FLAG)
        if index + 1 < len(argv) and argv[index + 1].isdigit():
            return int(argv[index + 1])
    return None


def watch_parent_for_shutdown(parent_pid: int, server) -> None:
    """父行程結束（含當機）或設定關閉事件時，通知 uvicorn 結束。"""
    import ctypes

    kernel32 = ctypes.windll.kernel32
    handles = [
        kernel32.OpenProcess(SYNCHRONIZE, False, parent_pid),
        kernel32.OpenEventW(SYNCHRONIZE, False, shutdown_event_name(parent_pid)),
    ]
    handles = [handle for handle in handles if handle]
    if not handles:
        return

    def worker():
        handle_array = (ctypes.c_void_p * len(handles))(*handles)
        kernel32.WaitForMultipleObjects(len(handles), handle_array, False, INFINITE)
        server.should_exit = True

    threading.Thread(target=worker, name="open-pets-parent-watch", daemon=True).start()


def run_server_subprocess(parent_pid: int | None) -> int:
    """子行程：只跑後端服務（視窗版 OpenPETs.exe 以 --serve-internal 啟動）。"""
    import uvicorn

    server = uvicorn.Server(uvicorn.Config(
        build_app(), host=HOST, port=get_port(), server_header=False, log_level="warning", timeout_keep_alive=30,
    ))
    if parent_pid and os.name == "nt":
        watch_parent_for_shutdown(parent_pid, server)
    server.run()
    print("後端服務已停止。")
    return 0


def start_server_subprocess():
    """回傳 (子行程, 關閉事件 handle)。"""
    import ctypes
    import subprocess

    event_handle = ctypes.windll.kernel32.CreateEventW(None, True, False, shutdown_event_name(os.getpid()))
    process = subprocess.Popen(
        server_subprocess_command(os.getpid()),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return process, event_handle


def stop_server_subprocess(process, event_handle) -> None:
    import ctypes
    import subprocess

    if event_handle:
        ctypes.windll.kernel32.SetEvent(event_handle)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
    if event_handle:
        ctypes.windll.kernel32.CloseHandle(event_handle)


# ---------------------------------------------------------------- 視窗版：WebView2 調整
DOWNLOAD_PROGRESS_INTERVAL_SECONDS = 0.5


class DesktopApi:
    """前端以 window.pywebview.api 呼叫（下載完成通知的「開啟資料夾」）。"""

    def reveal_file(self, path: str) -> bool:
        import subprocess

        target = Path(str(path))
        if not target.is_file():
            return False
        subprocess.Popen(f'explorer /select,"{target}"')
        return True


def patch_webview_for_open_pets() -> None:
    """調整 pywebview 6 的 WebView2 行為（須在 webview.start 前呼叫）。

    ★ 2026-10-30：
    - pywebview 對每個請求／回應都掛 Python 處理函式（AddWebResourceRequestedFilter('*')），每次都要在 UI 執行緒
      取得 GIL；本專案沒用到 request_sent／response_received 事件，移除以免拖慢畫面。
    - 下載：pywebview 只跳「另存新檔」，之後交給 WebView2 內建下載視窗，大檔完成後仍停在「0 B/秒」且不會自己關閉。
      改為隱藏內建視窗，把進度與結果送給前端（window.__openPetsDownload），由前端顯示會自動關閉的通知。
    """
    from webview.platforms import edgechromium
    from Microsoft.Web.WebView2.Core import CoreWebView2WebResourceContext

    edge_chrome_class = edgechromium.EdgeChrome
    original_on_webview_ready = edge_chrome_class.on_webview_ready
    original_on_download_starting = edge_chrome_class.on_download_starting

    def on_webview_ready(self, sender, args):
        original_on_webview_ready(self, sender, args)
        if not args.IsSuccess:
            return
        try:
            sender.CoreWebView2.RemoveWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All)
        except Exception as exc:
            print(f"[警告] 無法移除 WebView2 請求攔截：{exc!r}")

    def on_download_starting(self, sender, args):
        original_on_download_starting(self, sender, args)  # 另存新檔對話框；按取消時 args.Cancel 為 True
        if args.Cancel:
            return
        args.Handled = True  # 不顯示 WebView2 內建下載視窗
        operation = args.DownloadOperation
        result_path = str(args.ResultFilePath)
        download_id = f"download-{time.time_ns()}"
        core_webview = self.webview.CoreWebView2
        last_progress_time = [0.0]
        handlers = {}

        def notify(state: str, reason: str = "") -> None:
            total_bytes = operation.TotalBytesToReceive
            payload = {
                "id": download_id, "fileName": Path(result_path).name, "path": result_path, "state": state,
                "received": int(operation.BytesReceived), "total": int(total_bytes) if total_bytes is not None else None,
                "reason": reason,
            }
            script = f"window.__openPetsDownload && window.__openPetsDownload({json.dumps(payload, ensure_ascii=False)})"
            try:
                core_webview.ExecuteScriptAsync(script)
            except Exception as exc:
                print(f"[警告] 下載通知送不到畫面：{exc!r}")

        def on_bytes_received_changed(_sender, _args):
            now = time.monotonic()
            if now - last_progress_time[0] >= DOWNLOAD_PROGRESS_INTERVAL_SECONDS:
                last_progress_time[0] = now
                notify("progress")

        def on_state_changed(_sender, _args):
            state_name = str(operation.State)
            if state_name == "InProgress":
                return
            if state_name == "Completed":
                notify("completed")
            else:
                reason = str(operation.InterruptReason)
                print(f"[警告] 下載中斷：{result_path}（{reason}）")
                notify("interrupted", reason)
            operation.BytesReceivedChanged -= handlers["bytes"]
            operation.StateChanged -= handlers["state"]
            self._open_pets_download_handlers.pop(download_id, None)

        handlers["bytes"] = on_bytes_received_changed
        handlers["state"] = on_state_changed
        # 保留參照，避免事件處理函式被回收
        if not hasattr(self, "_open_pets_download_handlers"):
            self._open_pets_download_handlers = {}
        self._open_pets_download_handlers[download_id] = handlers
        operation.BytesReceivedChanged += on_bytes_received_changed
        operation.StateChanged += on_state_changed
        notify("progress")

    edge_chrome_class.on_webview_ready = on_webview_ready
    edge_chrome_class.on_download_starting = on_download_starting
    edge_chrome_class.on_web_resource_request = lambda self, sender, args: None
    edge_chrome_class.on_web_resource_response = lambda self, sender, args: None


def wait_for_service(port: int, process) -> bool:
    for _ in range(240):  # 最多等 60 秒
        if process.poll() is not None:
            return False
        if is_our_service(port):
            return True
        time.sleep(0.25)
    return False


def run_app_window(base: Path) -> int:
    """視窗版：子行程執行服務，開 WebView2 App 視窗；關閉視窗即停止服務。"""
    port = get_port()
    url = f"http://{HOST}:{port}/"
    if port_in_use(port):
        if is_our_service(port):
            message_box("Open-PETs 已經在執行中，請切換到已開啟的視窗。")
            return 0
        message_box(f"埠號 {port} 已被其他程式使用。\n\n請用記事本開啟\n{base / '.env'}\n把 OPEN_PETS_PORT 改成其他數字（例如 {port + 1}）後再開啟 Open-PETs。", is_error=True)
        return 1

    server_process, shutdown_event = start_server_subprocess()
    try:
        if not wait_for_service(port, server_process):
            message_box(f"服務啟動失敗，詳見 {base / 'data' / 'logs' / 'launcher.log'}", is_error=True)
            return 1
        print(f"服務已啟動：{url}（資料夾 {os.environ['OPEN_PETS_DATA_DIR']}，後端行程 {server_process.pid}）")

        import webview

        webview.settings["ALLOW_DOWNLOADS"] = True  # 去識別化結果、設定檔、合規報告以下載方式存檔（存到「下載」資料夾）
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        patch_webview_for_open_pets()
        start_url = url.rstrip("/") + SETUP_PAGE_PATH if needs_first_admin() else url
        webview.create_window(
            APP_TITLE, start_url, width=1440, height=900, min_size=(1024, 680), maximized=True,
            text_select=True, zoomable=True, js_api=DesktopApi(),
        )
        try:
            # private_mode=False＋storage_path：瀏覽器端儲存（工作區、介面設定）在重開後保留
            webview.start(gui="edgechromium", private_mode=False, storage_path=str(base / "webview"))
        except Exception as exc:
            print(f"[錯誤] 無法開啟 App 視窗：{exc!r}")
            message_box(
                "無法開啟 Open-PETs 視窗：這台電腦可能沒有安裝 Microsoft Edge WebView2 Runtime。\n\n"
                "請至 https://go.microsoft.com/fwlink/p/?LinkId=2124703 下載安裝後再開啟。",
                is_error=True,
            )
            return 1
    finally:
        stop_server_subprocess(server_process, shutdown_event)
        print("視窗已關閉，服務停止。")
    return 0


# ---------------------------------------------------------------- 進入點
def main(argv: list[str], app_mode: bool) -> int:
    base = home_dir()
    if argv and argv[0] == SERVE_INTERNAL_FLAG:
        # 視窗版的後端子行程（沒有主控台），輸出寫到同一份 launcher.log
        redirect_output_to_log(base, heading="後端服務子行程")
        load_env(ensure_env_file(base), base)
        os.chdir(base)
        return run_server_subprocess(parse_parent_pid(argv))
    if app_mode:
        redirect_output_to_log(base)
    else:
        setup_console()
    env_path = ensure_env_file(base)
    load_env(env_path, base)
    os.chdir(base)

    if app_mode:
        return run_app_window(base)
    if argv and (argv[0] in BACKEND_CLI_COMMANDS or argv[0] == "--help-cli"):
        from app.cli.main import cli

        args = ["--help"] if argv[0] == "--help-cli" else argv
        try:
            cli(args=args, prog_name=Path(sys.executable).name if is_frozen() else "launcher.py")
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
    cli_args = sys.argv[1:]
    # 視窗版 OpenPETs.exe 一律開 App 視窗；OpenPETs-cli.exe 與開發時（加 --app 才開視窗）為主控台
    use_app_window = ((is_frozen() and not is_cli_exe()) or "--app" in cli_args) and SERVE_INTERNAL_FLAG not in cli_args
    try:
        code = main([a for a in cli_args if a != "--app"], use_app_window)
    except KeyboardInterrupt:
        code = 0
    except Exception as exc:  # 讓使用者看得到錯誤
        import traceback

        traceback.print_exc()
        if use_app_window:
            message_box(f"Open-PETs 啟動失敗：{exc}\n\n詳見 {home_dir() / 'data' / 'logs' / 'launcher.log'}", is_error=True)
        else:
            print(f"\n[錯誤] 啟動失敗：{exc}")
            pause_before_exit()
        code = 1
    else:
        if code and not use_app_window:
            pause_before_exit()
    sys.exit(code)
