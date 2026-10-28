# 單機版執行檔打包（packaging/）

把前端（本 repo）與後端 v2.0.0（期末交付包 `01_程式原始碼`）打包成 Windows 資料夾版執行檔：
`OpenPETs.exe` 同時是後端 API 與前端網頁伺服器，只聽 `127.0.0.1:8765`，雙擊後自動開瀏覽器。

## 建置
1. 需求：Node.js（本 repo 已 `npm ci`）、**Python 3.12 64 位元**（後端所附 wheel 為 cp312）、可連網（裝 PyInstaller；其餘套件優先用交付包 `06_離線安裝/wheels/windows`）。
   - 沒有 3.12：安裝 python.org 的 3.12，或 `conda create -n openpets-build python=3.12` 後加 `-Python <env>\python.exe`。
2. 雙擊 `packaging\build_exe.bat`（或 PowerShell：`.\packaging\build_exe.ps1 [-BackendSrc <01_程式原始碼>] [-Python <python.exe>] [-Version 2.0.0]`）。
3. 產出：`packaging\dist\OpenPETs\`（約 250 MB）與 `packaging\dist\OpenPETs_<版本>_<日期>.zip`。發布用 zip。

## 檔案
| 檔案 | 用途 |
|---|---|
| `launcher.py` | exe 進入點：首次產生 `.env`（隨機鹽值／稽核金鑰／JWT 金鑰）、首次建立管理員、掛前端靜態檔與 SPA 路由、啟動 uvicorn、開瀏覽器；`reset-password`；其餘子指令轉後端 CLI |
| `OpenPETs.spec` | PyInstaller 設定（onedir、主控台、不用 UPX）；後端路徑與前端輸出由環境變數傳入 |
| `build_exe.ps1` / `.bat` | 一鍵建置：前端 `vite build --mode desktop` → Python 3.12 venv → PyInstaller → zip |
| `write_requirements.py` | 由後端 pyproject.toml 取執行相依（不含 dev/test） |
| `使用說明.txt` | 隨 exe 附給使用者 |

## 與 Docker 部署的差異
- **後端原始碼不改**。`launcher.py` 在後端 app 上加：`/` 與其他非 `/api` 路徑回前端網頁；後端原本的 `GET /`（狀態 JSON）移到 `GET /api/v1/status`。`/api/*` 找不到仍回 404 JSON。
- 前端單機版模式（`.env.desktop` → `VITE_BUILD_TARGET=desktop`，見 `src/config/featureFlags.ts`）：登入頁不顯示 Demo 測試帳號、API 錯誤不送 Google 表單。一般 `npm run build` 不受影響。
- 資料：`.env`、`data/users.db`、`data/audit.jsonl`、`data/logs/` 都在 exe 旁邊。
- 不支援後端「伺服器端 SQLite 資料來源」（前端本來就沒接）。
