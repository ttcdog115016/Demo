# Open-PETs（隱私強化工具包）

**Open-PETs 是一套資料去識別化工具。** 用 K-匿名化與差分隱私兩種方式保護資料，處理完會模擬「有人想把資料認回是誰」的攻擊並評估風險，最後產出可交付的資料與檢測報告。

它裝在一台電腦或主機上，使用者用瀏覽器操作。**所有運算都在這台主機上進行，資料不會傳到其他地方。**

> 目前最新版本是預發版 **`2.0.0-rc4`**，到 [Releases](https://github.com/ttcdog115016/Demo/releases) 下載。正式版 `2.0.0` 尚未發佈。

📖 **完整手冊（有圖、有排解）：https://ttcdog115016.github.io/Demo/**

---

## 三步驟安裝（Windows）

**1. 安裝 Docker Desktop** 並開啟，等左下角顯示綠色的 **Engine running**：https://www.docker.com/products/docker-desktop/（公司電腦請先向資訊人員確認授權）

**2. 下載安裝工具。** 開啟 PowerShell，一行一行貼上：

```powershell
New-Item -ItemType Directory -Force C:\open-pets-app | Out-Null
cd C:\open-pets-app
$v = '2.0.0-rc4'
Invoke-WebRequest -UseBasicParsing "https://github.com/ttcdog115016/Demo/releases/download/v$v/open-pets.ps1" -OutFile open-pets.ps1
Unblock-File .\open-pets.ps1
```

**3. 安裝。** 執行下面這行，**照畫面回答問題**（第一次要下載映像檔，需要幾分鐘）：

```powershell
.\open-pets.ps1 setup
```

完成後用 Chrome 或 Edge 開 **http://localhost:8080**，以剛建立的管理員帳號登入。

> **出現「已停用指令碼執行」？** 每個指令改成這樣寫（只對那一次有效，不改系統設定）：
> `powershell -ExecutionPolicy Bypass -File .\open-pets.ps1 setup`
>
> **沒有網路？** 使用「離線交付包」，裡面已有工具與映像檔，見下方「取得方式」。
>
> **Linux？** 下載 `open-pets.sh`，指令把 `.\open-pets.ps1` 換成 `./open-pets.sh`。

---

## 先選一種使用方式

同一份軟體有兩種模式，**不確定就先選「本地」**，之後一行指令就能切換，帳號與資料都會保留。

| | 本地（預設） | 內網 |
|---|---|---|
| 誰用 | 只有你自己 | 同一個辦公室、內網的同事 |
| 網址 | `http://localhost:8080` | `https://你電腦的IP` |
| 同事要做 | — | 每台電腦第一次要「信任憑證」 |
| 難度 | ★ | ★★ |
| 切換指令 | `.\open-pets.ps1 mode local` | `.\open-pets.ps1 mode lan` |

> 「線上（online）」模式已移除。原本用線上模式安裝的資料夾，請執行 `.\open-pets.ps1 mode lan -Hosts 內網IP`（或 `mode local`），帳號與資料不會不見。

### 內網：讓同事一起用

1. `.\open-pets.ps1 setup`，模式選 `2`，網址按 Enter 用偵測到的 IP（或輸入你的 IP）。
2. 照工具印出的指令**開防火牆**（用系統管理員身分的 PowerShell）。
3. `.\open-pets.ps1 export-ca`，把產生的 `open-pets-ca.crt` 和 `open-pets-colleague-guide.txt` 交給同事。
4. 同事照說明檔「信任憑證」一次，再用瀏覽器開 **`https://你的IP`**。

> ⚠️ **網址一定要打 `https://`。** 只打 IP 會走 `http://`，畫面會一直轉圈，最後顯示 `ERR_CONNECTION_TIMED_OUT`。
> 換了網路、IP 變了：`.\open-pets.ps1 mode lan -Hosts 新IP,舊IP`，根憑證不變，同事不用重新信任。

---

## 日常指令

在安裝資料夾的 PowerShell 執行：

| 我想要 | 指令 |
|---|---|
| 看目前模式、狀態與網址 | `.\open-pets.ps1 status` |
| 停止／重新啟動（資料保留） | `.\open-pets.ps1 stop`、`.\open-pets.ps1 start` |
| 建立管理員／忘記管理員密碼 | `.\open-pets.ps1 create-admin`、`.\open-pets.ps1 reset-password` |
| 備份（建議定期做，內有金鑰請保密） | `.\open-pets.ps1 backup` |
| 更新到新版（更新前自動備份） | `.\open-pets.ps1 update 新版本號` |
| 出問題時看原因 | `.\open-pets.ps1 logs` |
| 看全部指令 | `.\open-pets.ps1 help` |

一般使用者由管理員登入網頁後，在「系統設定 → 帳號與權限管理」建立，系統不開放自行註冊。登入後怎麼做去識別化，見[前端操作說明](https://ttcdog115016.github.io/Demo/docs/frontend/)。

## 遇到問題

| 你看到 | 怎麼辦 |
|---|---|
| 「Docker 沒有在執行」 | 開啟 Docker Desktop，等綠色 Engine running 再重跑 |
| 瀏覽器打不開網址 | `.\open-pets.ps1 status` 看正確網址（8080 被占用時工具會自動改埠） |
| 登入頁沒有帳號可選 | `.\open-pets.ps1 create-admin` |
| 登入失敗太多次被鎖住 | 等 15 分鐘，或請管理員重設密碼 |
| 內網：「您的連線不是私人連線」 | 這台電腦還沒信任憑證，照 `open-pets-colleague-guide.txt` 做一次 |
| 內網：一直轉圈 | 確認有打 `https://`；防火牆有沒有開；同事的電腦是否在同一個網路（手機熱點常隔離裝置） |

更多狀況見[常見問題](https://ttcdog115016.github.io/Demo/docs/faq/)。

---

## 取得方式

三種管道拿到的是**同一個版本**，依環境選一種：

| | 容器映像檔 | 離線安裝 | 原始碼 |
|---|---|---|---|
| 適用 | 主機可以上網 | 無網路或內網環境 | 想自行檢視、重新建置 |
| 取得 | `ghcr.io/ttcdog115016/open-pets-app:<版本>` | [Releases](https://github.com/ttcdog115016/Demo/releases) 的 `open-pets-app_<版本>.tar.gz` | Releases 的 `open-pets-source_<版本>.zip` 或本 repo |
| 使用 | 安裝工具會自動下載 | `docker load -i` 匯入後以工具或 compose 啟動 | 依 [`docker/REBUILD.md`](docker/REBUILD.md) 建置 |

版本號不含開頭的 `v`（例如 `2.0.0-rc4`）。系統不提供 `latest`，每次安裝或更新都要指定明確版本。

### 驗證下載的東西沒被動過

- **映像檔來源（cosign 簽章）：** 不用安裝 cosign，用 Docker 執行。把 `<digest>` 換成該版 Release 說明裡的 digest：

  ```powershell
  docker run --rm gcr.io/projectsigstore/cosign:latest verify "ghcr.io/ttcdog115016/open-pets-app@sha256:<digest>" --certificate-identity-regexp '^https://github.com/ttcdog115016/Demo/\.github/workflows/docker-image\.yml@refs/tags/v' --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```

  看到 `The following checks were performed on each of these signatures` 就通過；出現 `no matching signatures` 就**不要使用**。
- **離線包：** `sha256sum -c SHA256SUMS.txt`（Windows：`Get-FileHash 檔名 -Algorithm SHA256` 與 `SHA256SUMS.txt` 比對）。

詳見[手冊：驗證映像檔來源](https://ttcdog115016.github.io/Demo/docs/deploy/#12-驗證映像檔來源)。

---

## 給資訊人員與開發者

- **完整參考：** [安裝教學（手動設定、更新、備份、授權）](https://ttcdog115016.github.io/Demo/docs/deploy/)、[API](https://ttcdog115016.github.io/Demo/docs/api/)、[命令列](https://ttcdog115016.github.io/Demo/docs/cli/)、[`docker/README_Docker.md`](docker/README_Docker.md)。
- **架構：** 前端（React＋TypeScript＋Vite）與後端（FastAPI，`backend/`）合在同一個容器、同一個埠（8080）。模式由環境變數 `OPEN_PETS_MODE`（`local`／`lan`）決定，容器預設非 root、唯讀根檔案系統、只綁 `127.0.0.1`。
- **本機開發：**

  ```bash
  npm ci                # 前端相依套件
  npm run dev           # 前端開發伺服器
  npm test              # 前端單元測試（vitest）
  npm run build         # 型別檢查並打包
  cd backend && uv sync --locked --group test && uv run pytest -q   # 後端測試
  ```

- **自動化：** `.github/workflows/` 的 `ci.yml`（前後端測試）、`docker-image.yml`（推 `v*` 標籤時建置、Trivy 掃描、冒煙測試、推送 GHCR、cosign 簽章、產生離線包與 Release）、`pages.yml`（發佈手冊網站）。手冊原始檔在 `doc_site/`。

## 授權

本專案為 MIT 授權（[`LICENSE`](LICENSE)、`backend/LICENSE`）。第三方元件的授權與取得原始碼的方式見映像檔內的 `/licenses`，以及 Release 的 `THIRD_PARTY_NOTICES.txt`、`FRONTEND_THIRD_PARTY_LICENSES.md`。
