"""Open-PETs 容器版進入點（docker/Dockerfile 打包進映像檔，不屬於後端原始碼）。

服務（映像檔預設指令）：
  uvicorn openpets_server:build_app --factory --host 0.0.0.0 --port 8080
  後端 /api/* 照舊；其餘路徑回前端網頁（React Router 用 index.html）；後端原本的 GET / 狀態 JSON 移到 /api/v1/status。
  與單機版 exe 共用 packaging/launcher.py 的 attach_frontend／attach_api_docs／SecurityHeadersMiddleware，
  不改動後端原始碼。

管理指令（docker exec -it open-pets python /opt/openpets/openpets_server.py <指令>）：
  create-admin      互動建立系統管理員（密碼不會出現在指令歷史或程序列表）
  reset-password    互動重設某個帳號的密碼（忘記管理員密碼時用）
  verify-log 等     其餘後端 CLI 指令原樣轉交（create-user、verify-log、k-anonymity、dp、report…）

模式：OPEN_PETS_MODE=offline（預設）或 online；OPEN_PETS_SHOW_DEMO_ACCOUNTS=true 才顯示登入頁的 Demo 測試帳號。
  同一份映像檔、同一份前端，模式由 /runtime-config.js 在執行期告訴前端（見 resolve_runtime_config）。

金鑰：OPEN_PETS_DEFAULT_SALT／OPEN_PETS_SYSTEM_MASTER_KEY／OPEN_PETS_JWT_SECRET 由環境變數提供；
沒有提供的，第一次啟動時隨機產生並存到 /data/.secrets.env（權限 600），之後沿用。
"""
import os
import secrets
import stat
import sys
from pathlib import Path

SECRET_KEYS = ("OPEN_PETS_DEFAULT_SALT", "OPEN_PETS_SYSTEM_MASTER_KEY", "OPEN_PETS_JWT_SECRET")
BACKEND_CLI_COMMANDS = {
    "create-user", "preprocess", "k-anonymity", "dp", "risk-k-anonymity",
    "risk-dp", "risk-cap", "verify-log", "report",
}


def data_dir() -> Path:
    return Path(os.getenv("OPEN_PETS_DATA_DIR", "/data"))


def prepare_runtime_dirs() -> None:
    base = data_dir()
    for sub in ("", "logs", "tmp"):
        (base / sub).mkdir(parents=True, exist_ok=True)


def ensure_secrets() -> None:
    """環境變數優先；缺的金鑰從 /data/.secrets.env 讀，檔案裡也沒有才隨機產生並寫入。"""
    missing = [key for key in SECRET_KEYS if not os.getenv(key)]
    if not missing:
        return
    secrets_file = data_dir() / ".secrets.env"
    stored: dict[str, str] = {}
    if secrets_file.is_file():
        for line in secrets_file.read_text(encoding="utf-8-sig").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() in SECRET_KEYS and value.strip():
                stored[key.strip()] = value.strip()
    created = [key for key in missing if key not in stored]
    for key in created:
        stored[key] = secrets.token_hex(32)
    if created:
        header = (
            "# Open-PETs 容器版金鑰（第一次啟動時自動產生）。請連同 /data 一起備份，並當作機密保管：\n"
            "#   OPEN_PETS_DEFAULT_SALT 遺失或變更，之後的雜湊結果就和過去對不起來；\n"
            "#   OPEN_PETS_SYSTEM_MASTER_KEY 是稽核紀錄的簽章金鑰，變更後舊紀錄無法驗證；\n"
            "#   OPEN_PETS_JWT_SECRET 變更只會讓目前登入的人需要重新登入。\n"
            "# 要把金鑰與資料分開保管，改用環境變數（或 Docker secrets）提供，環境變數優先於本檔。\n"
        )
        body = "".join(f"{key}={stored[key]}\n" for key in SECRET_KEYS if key in stored)
        secrets_file.write_text(header + body, encoding="utf-8")
        secrets_file.chmod(stat.S_IRUSR | stat.S_IWUSR)
        print(f"[初次設定] 已產生金鑰並存到 {secrets_file}：{', '.join(created)}（請備份 /data）", flush=True)
    for key in missing:
        os.environ[key] = stored[key]


VALID_MODES = ("offline", "online")
TRUE_VALUES = ("1", "true", "yes", "on")
FALSE_VALUES = ("", "0", "false", "no", "off")


def resolve_runtime_config() -> dict:
    """讀環境變數決定前端的執行期設定；值不合法就中止啟動，不靜默退回預設（避免設錯了卻以為生效）。

    OPEN_PETS_MODE             offline（預設，本機／離線）或 online（多人使用的伺服器）；online 才顯示系統維運日誌分頁。
    OPEN_PETS_SHOW_DEMO_ACCOUNTS  true 才在登入頁顯示 Demo 測試帳號；預設 false，只給我們自己的 Demo 站開。
    """
    mode = os.getenv("OPEN_PETS_MODE", "").strip().lower() or "offline"
    if mode not in VALID_MODES:
        raise SystemExit(f"[設定錯誤] OPEN_PETS_MODE={mode!r} 不合法，只接受 {' 或 '.join(VALID_MODES)}。")
    demo_raw = os.getenv("OPEN_PETS_SHOW_DEMO_ACCOUNTS", "").strip().lower()
    if demo_raw not in TRUE_VALUES + FALSE_VALUES:
        raise SystemExit(f"[設定錯誤] OPEN_PETS_SHOW_DEMO_ACCOUNTS={demo_raw!r} 不合法，只接受 true 或 false。")
    return {"mode": mode, "showDemoAccounts": demo_raw in TRUE_VALUES}


def allow_loopback_hosts() -> None:
    """有設定 OPEN_PETS_ALLOWED_HOSTS 時補上 127.0.0.1／localhost：容器的 HEALTHCHECK 與同機反向代理都用這個 Host。
    DNS rebinding 攻擊用的是攻擊者自己的網域當 Host，不會是這兩個名稱，所以不削弱防護。"""
    raw = os.getenv("OPEN_PETS_ALLOWED_HOSTS", "").strip()
    if not raw:
        return
    hosts = [host.strip() for host in raw.split(",") if host.strip()]
    for loopback in ("127.0.0.1", "localhost"):
        if loopback not in hosts:
            hosts.append(loopback)
    os.environ["OPEN_PETS_ALLOWED_HOSTS"] = ",".join(hosts)


def attach_runtime_config(app, config: dict) -> None:
    """提供 /runtime-config.js（index.html 在主程式之前載入）。須在 launcher.attach_frontend 之前註冊，
    否則會被它的 /{full_path:path} 攔截而回傳 index.html。"""
    import json

    from fastapi.responses import Response

    body = f"window.__OPEN_PETS_CONFIG__ = {json.dumps(config)};\n"

    @app.get("/runtime-config.js", include_in_schema=False)
    def runtime_config_js():
        return Response(body, media_type="text/javascript", headers={"Cache-Control": "no-cache"})


def build_app():
    runtime_config = resolve_runtime_config()  # 最先檢查設定：錯了就直接中止，不產生金鑰、不載入後端
    prepare_runtime_dirs()
    ensure_secrets()
    allow_loopback_hosts()
    print(f"[啟動] 模式：{runtime_config['mode']}；Demo 帳號：{'顯示' if runtime_config['showDemoAccounts'] else '不顯示'}", flush=True)
    # 須在載入後端前設定好環境變數；後端設定一律以環境變數優先
    import launcher
    from app.api.server import app

    dist = launcher.frontend_dir()
    launcher.attach_api_docs(app, dist)
    attach_runtime_config(app, runtime_config)
    launcher.attach_frontend(app, dist)
    app.add_middleware(launcher.SecurityHeadersMiddleware)  # 最後加入＝最外層
    return app


def create_admin() -> int:
    import launcher
    from app.core.errors import PetsError
    from app.governance.auth import get_auth_manager, get_password_min_length

    manager = get_auth_manager()
    if manager.list_users():
        print("已經有帳號了。要新增其他使用者，請以管理員登入網頁，在「系統設定 → 帳號管理」新增；")
        print("忘記管理員密碼請執行 reset-password。")
        return 1
    print("建立系統管理員（之後可登入網頁新增其他使用者）")
    min_length = get_password_min_length()
    while True:
        username = input("  管理員帳號（建議用 Email）：").strip()
        if not username:
            print("  帳號不可空白。")
            continue
        password = launcher.prompt_new_password(min_length)
        try:
            manager.create_user(username, password, "admin")
        except PetsError as exc:
            print(f"  建立失敗：{exc}")
            continue
        print(f"已建立管理員 [{username}]。")
        return 0


def main(argv: list[str]) -> int:
    prepare_runtime_dirs()
    ensure_secrets()
    command = argv[0] if argv else ""
    if command == "create-admin":
        return create_admin()
    if command == "reset-password":
        import launcher

        return launcher.reset_password_interactive()
    if command in BACKEND_CLI_COMMANDS or command == "--help-cli":
        from app.cli.main import cli

        args = ["--help"] if command == "--help-cli" else argv
        try:
            cli(args=args, prog_name="openpets_server.py")
        except SystemExit as exc:
            return int(exc.code or 0) if not isinstance(exc.code, str) else 1
        return 0
    print(__doc__)
    return 0 if command in ("-h", "--help") else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
