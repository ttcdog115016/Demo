---
title: 部署教學
weight: 2
---

適用版本：前端 GitHub 原始碼＋後端 **v2.0.2**　｜　部署環境：**Windows 10／11＋Docker Desktop**

本頁說明如何從 GitHub 取得前端原始碼，在一台 Windows 電腦上用 Docker 建置並啟動 Open-PETs 線上版，讓使用者用瀏覽器操作。

{{< callout type="info" >}}
本文是線上版的先行實作。前端放在 GitHub `ttcdog115016/Demo`；後端原始碼尚未放上 GitHub，暫時從交付套件取得。日後正式線上版會改用甲方的 GitHub 帳號，屆時只要把文中的 `ttcdog115016/Demo` 換成新的 `<GitHub 帳號>/<repo>`，步驟不變。移轉方式見[第 11 節](#11-移轉到甲方-github-帳號)。
{{< /callout >}}

## 1. 架構

線上版由兩個容器組成：

```text
使用者瀏覽器
    │  http://<主機>:8080
    ▼
┌─────────────────────────────┐
│ 前端容器 open-pets-web       │  nginx，埠 8080
│  ・網頁畫面（React）          │
│  ・/api/ → host.docker.internal:8000
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ 後端容器 open-pets           │  FastAPI，埠 8000（只綁 127.0.0.1）
│  ・去識別化運算、帳號、稽核    │
└─────────────┬───────────────┘
              ▼
  C:\open-pets-data   帳號資料庫、處理紀錄、稽核紀錄
  C:\open-pets\.env   鹽值與金鑰
```

- 使用者只連前端的 8080。前端的 nginx 把 `/api/` 開頭的請求轉給後端。
- 後端只接受本機（127.0.0.1）連線，不直接對外開放。
- `host.docker.internal` 是 Docker Desktop 內建的名稱，代表本機。不需要另外設定。

| 元件 | 來源 | 映像檔 | 容器名稱 | 埠 |
| --- | --- | --- | --- | --- |
| 前端 | GitHub `ttcdog115016/Demo` | `open-pets-web` | `open-pets-web` | 8080 |
| 後端 | 交付套件 `01_程式原始碼` | `open-pets:2.0.2` | `open-pets` | 127.0.0.1:8000 |

## 2. 事前準備

| 項目 | 說明 |
| --- | --- |
| 作業系統 | Windows 10 或 11（64 位元），建議記憶體 16 GB 以上 |
| Docker Desktop | 到 Docker 官網下載安裝，安裝時選用 WSL 2。安裝後開啟 Docker Desktop，左下角顯示 **Engine running** 才能繼續 |
| Git for Windows | 到 git-scm.com 下載安裝，用來從 GitHub 下載前端 |
| 後端原始碼 | 交付套件 `3.1_完整交付套件\01_程式原始碼`（v2.0.2） |
| 網路 | 第一次建置要從網路下載基礎映像檔與套件，約需 10–20 分鐘 |

以下指令都在 **PowerShell** 執行。開啟方式：開始功能表搜尋「PowerShell」。

確認工具都裝好了：

```powershell
docker version
git --version
```

## 3. 從 GitHub 取得前端

前端 repo 是公開的，不需要登入 GitHub 就能下載。

```powershell
cd C:\
git clone https://github.com/ttcdog115016/Demo.git open-pets-web
cd C:\open-pets-web
```

### 選擇分支

| 分支 | 內容 | 是否用於線上版 |
| --- | --- | --- |
| `feature/backend-v2-integration` | 對接後端 v2.0.2：登入、帳號管理、稽核等 | **是**（合併到 main 之前用這個） |
| `main` | 舊版前端，沒有登入系統，nginx 聽 80 埠 | 否 |

```powershell
git checkout feature/backend-v2-integration
```

{{< callout type="info" >}}
合併到 `main` 之後，這一步改成 `git checkout main`。
如果出現 `pathspec ... did not match`，代表這個分支還沒推上 GitHub，請先請開發人員推上去。
{{< /callout >}}

確認取得的版本正確（應看到 `EXPOSE 8080`）：

```powershell
Select-String -Path .\Dockerfile -Pattern 'EXPOSE'
```

## 4. 建置並啟動後端

### 4-1 建置映像檔

把交付套件的 `01_程式原始碼` 資料夾複製到 `C:\open-pets-src`，然後建置：

```powershell
docker build -t open-pets:2.0.2 C:\open-pets-src
```

第一次約需 5–10 分鐘。最後出現 `naming to docker.io/library/open-pets:2.0.2` 就是成功。

### 4-2 準備資料夾與設定檔

```powershell
New-Item -ItemType Directory -Force C:\open-pets-data, C:\open-pets | Out-Null
```

產生 `C:\open-pets\.env`。下面的指令會用後端映像檔產生三組隨機金鑰，並用**無 BOM 的 UTF-8** 寫入（有 BOM 的話第一個設定會讀不到）：

```powershell
function New-Secret { (docker run --rm open-pets:2.0.2 python -c "import secrets; print(secrets.token_hex(32))").Trim() }
$content = @(
  '# 假名化與雜湊之鹽值（設定後不要再變更）'
  "OPEN_PETS_DEFAULT_SALT=$(New-Secret)"
  '# 稽核紀錄簽章金鑰'
  "OPEN_PETS_SYSTEM_MASTER_KEY=$(New-Secret)"
  '# 登入權杖簽章金鑰（必要，沒有就無法登入）'
  "OPEN_PETS_JWT_SECRET=$(New-Secret)"
)
[System.IO.File]::WriteAllLines('C:\open-pets\.env', $content, (New-Object System.Text.UTF8Encoding($false)))
```

{{< callout type="warning" >}}
**`C:\open-pets\.env` 已經存在時不要再執行上面的指令。** 重新產生會換掉鹽值，之後的雜湊結果就對不上以前的資料。
{{< /callout >}}

`.env` 可設定的項目：

| 變數 | 用途 | 未設定時 |
| --- | --- | --- |
| `OPEN_PETS_JWT_SECRET` | 登入權杖簽章金鑰，**必要** | 登入與所有處理功能回 503 |
| `OPEN_PETS_DEFAULT_SALT` | 假名化、雜湊用的鹽值 | 雜湊不加鹽 |
| `OPEN_PETS_SYSTEM_MASTER_KEY` | 稽核紀錄與處理紀錄的簽章金鑰 | 不簽章，無法驗證竄改 |
| `OPEN_PETS_MAX_UPLOAD_MB` | 單次上傳上限（MB），0 表示不限 | 1024 |
| `OPEN_PETS_ALLOWED_HOSTS` | 允許的網址主機名稱，逗號分隔，用來擋 DNS rebinding | 不限制 |
| `OPEN_PETS_CORS_ORIGINS` | 允許跨網域呼叫的來源 | 不開放；經前端 nginx 代理是同源，不需設定 |
| `OPEN_PETS_LOG_LEVEL` | 系統日誌等級 | WARNING |
| `OPEN_PETS_PASSWORD_MIN_LENGTH` | 密碼最短長度 | 12 |

### 4-3 啟動後端容器

```powershell
docker run -d --name open-pets --restart unless-stopped `
  -p 127.0.0.1:8000:8000 `
  -v C:\open-pets-data:/data `
  -v C:\open-pets\.env:/srv/.env:ro `
  open-pets:2.0.2
```

- `--restart unless-stopped`：電腦重開、Docker Desktop 重啟後自動啟動。
- `-p 127.0.0.1:8000:8000`：只開放本機連線。**不要**改成 `-p 8000:8000`，否則後端會用明文 HTTP 直接對外。

### 4-4 確認後端正常

```powershell
curl.exe http://127.0.0.1:8000/
```

應回應：

```json
{"status":"online","service":"Open-PETs backend system","version":"2.0.2"}
```

## 5. 建立第一個管理員

系統沒有預設帳號。用下面的指令建立第一個管理員（帳號建議用 Email）：

```powershell
docker exec open-pets python -m app.cli.main create-user -u admin@example.com -p '<密碼>' -r admin
```

- 密碼至少 12 個字元，要同時包含大寫、小寫、數字與符號。
- 密碼要用**單引號**包起來，避免 `$` 等符號被 PowerShell 當成變數。
- 一般使用者之後由管理員登入網頁，在「系統設定 → 帳號與權限管理」建立。

{{< callout type="error" >}}
專案裡的 `deploy_backend_v2.ps1` 會建立 `admin@test.com` 等 Demo 帳號，密碼寫在腳本裡且已公開在 GitHub。**正式或對外的環境不要使用這支腳本**，或用完立即刪除那些帳號。
{{< /callout >}}

## 6. 建置並啟動前端

回到前端資料夾建置映像檔：

```powershell
cd C:\open-pets-web
docker build -t open-pets-web .
```

第一次約需 5–10 分鐘（會先 `npm ci` 安裝套件，再打包）。

啟動：

```powershell
docker run -d --name open-pets-web --restart unless-stopped -p 8080:8080 open-pets-web
```

## 7. 確認部署成功

1. 執行 `docker ps`，應看到 `open-pets` 與 `open-pets-web` 兩個容器，狀態都是 `Up`。
2. 在這台電腦開瀏覽器，前往 **http://localhost:8080**，應出現登入頁。
3. 用第 5 節建立的管理員登入。
4. 上傳一份測試 CSV，完成一次 K-匿名化，確認可以下載結果。操作方式見[前端操作說明](../frontend/)。

API 互動文件（Swagger）在後端：在這台電腦開 **http://127.0.0.1:8000/docs**。API 的用法見 [API 使用說明](../api/)。

## 8. 開放給其他電腦使用（選用）

### 區域網路

1. 查這台電腦的 IP：`ipconfig`，找「IPv4 位址」，例如 `192.168.1.20`。
2. 用**系統管理員身分**開 PowerShell，開放防火牆 8080 埠：

    ```powershell
    New-NetFirewallRule -DisplayName "Open-PETs Web 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
    ```

3. 其他電腦開 `http://192.168.1.20:8080`。

### 透過網際網路

不要直接把 8080 開放到網際網路。請在前面加一層提供 HTTPS 的反向代理或通道，例如 Cloudflare Tunnel（作法見《Demo 展示環境建置與維運手冊（cloudflared 通道＋內網測試）》），把通道目標設為 `http://localhost:8080`。

- HTTPS 的 `Strict-Transport-Security` 標頭請在反向代理或通道層加上。前端 nginx 已經加好其他安全標頭。
- 確定對外網址後，在 `.env` 加上 `OPEN_PETS_ALLOWED_HOSTS`，列出使用者會用的主機名稱，例如：

    ```text
    OPEN_PETS_ALLOWED_HOSTS=pets.example.com,localhost,127.0.0.1
    ```

    改完執行 `docker restart open-pets`。漏列的主機名稱連進來會得到 400。

## 9. 更新版本與退回

### 更新前端（GitHub 有新版本時）

```powershell
cd C:\open-pets-web
git pull
docker build -t open-pets-web .
docker rm -f open-pets-web
docker run -d --name open-pets-web --restart unless-stopped -p 8080:8080 open-pets-web
```

前端容器不存資料，直接刪除重建即可。

### 更新後端（收到新版原始碼時）

以新版 `2.0.3` 為例。先保留舊容器，方便出問題時退回：

```powershell
docker build -t open-pets:2.0.3 C:\open-pets-src
docker stop open-pets
docker rename open-pets open-pets-old
docker run -d --name open-pets --restart unless-stopped `
  -p 127.0.0.1:8000:8000 `
  -v C:\open-pets-data:/data `
  -v C:\open-pets\.env:/srv/.env:ro `
  open-pets:2.0.3
curl.exe http://127.0.0.1:8000/
```

`.env` 與 `C:\open-pets-data` 沿用原本的，帳號、鹽值和稽核紀錄都會保留。

確認新版正常後刪除舊容器：`docker rm open-pets-old`。

### 退回舊版後端

```powershell
docker rm -f open-pets
docker rename open-pets-old open-pets
docker start open-pets
```

## 10. 備份與還原

需要備份的只有兩個位置：

| 路徑 | 內容 |
| --- | --- |
| `C:\open-pets\.env` | 鹽值與金鑰。**當作機密保管**，遺失後新的雜湊結果對不上以前的資料，稽核紀錄也無法再驗證 |
| `C:\open-pets-data` | `users.db`（帳號）、`system.db`（處理紀錄、系統設定）、`audit.jsonl`（稽核紀錄） |

備份（先停後端，避免資料庫寫到一半）：

```powershell
docker stop open-pets
Compress-Archive -Path C:\open-pets-data, C:\open-pets\.env -DestinationPath "D:\backup\open-pets_$(Get-Date -Format yyyyMMdd).zip"
docker start open-pets
```

還原或搬到新電腦：把備份解壓回 `C:\open-pets-data` 與 `C:\open-pets\.env`，再依第 4-1、4-3 節建置並啟動後端（跳過 4-2）。

## 11. 移轉到甲方 GitHub 帳號

正式上線時，前端改放到甲方的 GitHub 帳號。擇一進行：

**方式 A：GitHub 轉移所有權**（保留 Issues、Actions 設定與星號）

1. 在 `ttcdog115016/Demo` 的 **Settings → General → Danger Zone → Transfer ownership**，輸入甲方的帳號或組織名稱。
2. 甲方接受後，舊網址會自動導向新網址。

**方式 B：複製到甲方新建的 repo**

1. 甲方在 GitHub 建立空的 repo，例如 `<甲方組織>/open-pets-web`（不要勾選建立 README）。
2. 在已 clone 的資料夾推送全部分支與標籤：

    ```powershell
    cd C:\open-pets-web
    git remote set-url origin https://github.com/<甲方組織>/open-pets-web.git
    git push --all origin
    git push --tags origin
    ```

**移轉後檢查**

- [ ] repo 的可見度（公開或私有）符合甲方要求。改成私有後，部署主機 clone 時要先登入 GitHub（Git for Windows 會跳出登入視窗）。
- [ ] 預設分支設為 `main`，並確認對接後端 v2 的修改已合併進 `main`。
- [ ] **Settings → Branches** 為 `main` 加上分支保護：需經 Pull Request、需通過 CI 才能合併。
- [ ] **Actions** 分頁已啟用工作流程（複製過來的 repo 預設可能停用）。
- [ ] 部署主機執行 `git remote set-url origin <新網址>`，之後 `git pull` 才會抓新位置。
- [ ] 後端若也要放上 GitHub，比照前端建立私有 repo；後端原始碼與 `.env` 都不可公開。

## 12. GitHub Actions 自動檢查

前端 repo 內建 `.github/workflows/ci.yml`。推送或發 Pull Request 到 `main`（或 `master`）時，GitHub 會自動：

1. 用 Node.js 20 執行 `npm ci` 安裝套件
2. 執行 `npm run build`（型別檢查＋打包）
3. 執行 `npx vitest run`（單元測試）

結果在 repo 的 **Actions** 分頁。綠色勾勾代表通過；紅色叉叉點進去可看失敗的步驟與訊息。建議只部署 CI 通過的版本。

{{< callout type="info" >}}
目前 CI 只做檢查，不會產生 Docker 映像檔，部署時仍在主機上 `docker build`。日後若要改成自動發佈映像檔，可在工作流程加上建置並推送到 GitHub Container Registry（ghcr.io），主機改用 `docker pull`。
{{< /callout >}}

### 本文件網站

本網站的原始檔在 repo 的 `doc_site/`（Hugo＋Hextra 主題），由 `.github/workflows/pages.yml` 自動發佈：

- `doc_site/` 有修改並推送到 `main` 後，GitHub 會自動建置並更新網站，約 1–2 分鐘。也可以在 Actions 分頁手動執行「Deploy docs site to Pages」。
- 第一次使用前，請到 repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
- 本機預覽：安裝 Hugo extended（`winget install Hugo.Hugo.Extended`），clone 時加 `--recurse-submodules` 取得主題，然後在 `doc_site` 資料夾執行 `hugo server`，開 http://localhost:1313/Demo/ 。

## 13. 常見問題

部署時遇到的錯誤（502、登入 503、400、413、埠被占用等）與處理方式，見[常見問題](../faq/#部署與連線)。
