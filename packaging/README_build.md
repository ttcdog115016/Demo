# 單機版安裝程式打包（packaging/）

把前端（本 repo）與後端 v2.0.2（期末交付包 `01_程式原始碼`，已含 `backend_patches/`）打包成 Windows 安裝程式 `OpenPETs_Setup_<版本>.exe`。
安裝後從開始功能表開啟，是一個獨立的 App 視窗（WebView2，沒有網址列、沒有黑色主控台）；後端在同一個行程背景執行，只聽 `127.0.0.1:8765`，關閉視窗即停止。

## 建置
1. 需求：Node.js（本 repo 已 `npm ci`）、**Python 3.12 64 位元**（後端所附 wheel 為 cp312）、**Inno Setup 6**、可連網（裝 PyInstaller、pywebview；其餘套件優先用交付包 `06_離線安裝/wheels/windows`）。
   - 沒有 3.12：`py install 3.12`，或 `conda create -n openpets-build python=3.12` 後加 `-Python <env>\python.exe`。
   - 沒有 Inno Setup：`winget install JRSoftware.InnoSetup --scope user`。
2. 雙擊 `packaging\build_exe.bat`（或 PowerShell：`.\packaging\build_exe.ps1 [-BackendSrc <01_程式原始碼>] [-Python <python.exe>] [-Version 2.0.2]`）。
3. 產出：`packaging\dist\OpenPETs_Setup_<版本>.exe`（發布用）與 `packaging\dist\OpenPETs\`（安裝內容）。

## 檔案
| 檔案 | 用途 |
|---|---|
| `launcher.py` | exe 進入點。`OpenPETs.exe`：背景啟動 uvicorn、開 pywebview 視窗、沒有帳號時先顯示「建立系統管理員」畫面（`/setup`、`/api/v1/desktop/setup`，建立第一個帳號後失效）。`OpenPETs-cli.exe`：舊版主控台＋瀏覽器、`reset-password`、後端 CLI |
| `OpenPETs.spec` | PyInstaller 設定（onedir、不用 UPX）；同一份程式產出 `OpenPETs.exe`（無主控台）與 `OpenPETs-cli.exe`（主控台） |
| `OpenPETs.iss` | Inno Setup 安裝程式：只裝給目前使用者（`%LOCALAPPDATA%\Programs\OpenPETs`，免系統管理員權限）、開始功能表與桌面捷徑、解除安裝保留資料 |
| `build_exe.ps1` / `.bat` | 一鍵建置：前端 `vite build --mode desktop` → Python 3.12 venv → PyInstaller → Inno Setup |
| `write_requirements.py` | 由後端 pyproject.toml 取執行相依（不含 dev/test） |
| `使用說明.txt` | 隨程式安裝，開始功能表有捷徑 |

## 與 Docker 部署的差異
- **後端原始碼不改**。`launcher.py` 在後端 app 上加：`/` 與其他非 `/api` 路徑回前端網頁；後端原本的 `GET /`（狀態 JSON）移到 `GET /api/v1/status`。`/api/*` 找不到仍回 404 JSON。
- 前端單機版模式（`.env.desktop` → `VITE_BUILD_TARGET=desktop`，見 `src/config/featureFlags.ts`）：登入頁不顯示 Demo 測試帳號、API 錯誤不送 Google 表單。一般 `npm run build` 不受影響。
- 資料：`.env`、`data/`（users.db、system.db、audit.jsonl、logs/）與視窗的瀏覽器資料 `webview/` 都在 `%LOCALAPPDATA%\OpenPETs`，解除安裝不刪。環境變數 `OPEN_PETS_HOME` 可改位置；exe 旁已有 `.env`（舊版資料夾版）時沿用 exe 資料夾。
- 下載（結果、設定檔、報告）走 WebView2 的下載，存到「下載」資料夾。
- 安裝精靈為英文：Inno Setup 6 未內附繁體中文語系檔（`OpenPETs.iss` 會在有 `ChineseTraditional.isl` 時自動使用）。
- 不支援後端「伺服器端 SQLite 資料來源」（前端本來就沒接）。
