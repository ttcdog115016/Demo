---
title: 安裝教學
weight: 2
---

適用版本：Open-PETs **2.0.0**（前端與後端合在同一個 Docker 映像檔）　｜　環境：**Windows 10／11＋Docker Desktop**，附 Linux 指令對照

本頁說明如何在一台電腦或主機上安裝 Open-PETs，讓使用者用瀏覽器操作。映像檔有三種取得方式（有網路、離線、原始碼），內容是同一個版本，裝好之後的操作完全一樣。

{{< callout type="warning" >}}
**目前 GitHub Releases 只有預發版（`2.0.0-rc2`），正式版 `2.0.0` 尚未發佈。** 現在要安裝，版本請填 **`2.0.0-rc2`**；填 `2.0.0` 會拉不到映像檔。
{{< /callout >}}

### 版本號怎麼填

文中的 `<版本>` 要換成**實際存在的版本號**。到 [Releases 頁](https://github.com/ttcdog115016/Demo/releases)，看你要安裝的那一筆：

| Releases 頁上看到的 | 要填的版本號 |
| --- | --- |
| 標題 `Open-PETs 2.0.0-rc2`（標籤 `v2.0.0-rc2`，有 Pre-release 標示） | `2.0.0-rc2`（**不含開頭的 v**） |
| 之後正式發佈時，標題 `Open-PETs 2.0.0`（標籤 `v2.0.0`） | `2.0.0` |

- 每次安裝或更新都要寫明確的版本，系統不提供 `latest`。
- 帶 `-rc` 的是預發版，只用來試用與驗證；正式環境等正式版發佈後再安裝。
- 離線交付包的檔名也帶同一個版本，例如 `open-pets-app_2.0.0-rc2.tar.gz`。

## 1. 架構

```text
使用者瀏覽器
    │  http://<主機>:8080（對外開放時前面放反向代理，改走 https）
    ▼
┌──────────────────────────────────────┐
│ 容器 open-pets                        │  埠 8080
│  ・網頁畫面（前端）                    │
│  ・去識別化運算、帳號、稽核（後端）      │
└───────────────┬──────────────────────┘
                ▼
   Docker 磁碟區 open-pets-data
   帳號資料庫、處理紀錄、稽核紀錄、自動產生的金鑰
```

- 前端與後端在**同一個容器、同一個埠（8080）**，不需要另外安裝 nginx、Python 或 Node.js。
- 容器預設只綁本機（`127.0.0.1`），要讓其他電腦連入請看[第 9 節](#9-開放給其他電腦)。
- 第一次啟動會自動產生雜湊鹽值與簽章金鑰，存在磁碟區的 `/data/.secrets.env`，**不需要自己準備 `.env` 的金鑰**。

## 2. 選擇取得方式

| | 方式一：容器映像檔（GHCR） | 方式二：離線安裝 | 方式三：原始碼 |
| --- | --- | --- | --- |
| 適用 | 主機可以上網，想用 `docker pull` 更新 | 無網路或內網環境 | 想自行檢視、重新建置，或替換 fpdf2、certifi 等第三方元件 |
| 取得 | `ghcr.io/ttcdog115016/open-pets-app:<版本>` | 交付包的 `open-pets-app_<版本>.tar.gz` | 交付包的 `open-pets-source_<版本>.zip`，或 GitHub repo |
| 驗證 | 映像檔 digest、cosign 簽章 | `SHA256SUMS.txt` | 壓縮檔註解內的 commit |
| 更新 | `docker compose pull` | 換新的 tar.gz，`docker load` | 重新建置 |
| 章節 | [第 4 節](#4-方式一容器映像檔ghcr) | [第 5 節](#5-方式二離線安裝) | [第 6 節](#6-方式三原始碼) |

三種方式拿到的是同一個版本。要確認映像檔對應哪個原始碼 commit：

```powershell
docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' open-pets-app:<版本>
```

## 3. 事前準備

| 項目 | 說明 |
| --- | --- |
| 作業系統 | Windows 10 或 11（64 位元），或 Linux。目前只提供 x86_64（amd64）的映像檔，不支援 ARM |
| Docker | Windows：到 Docker 官網下載 Docker Desktop，安裝時選用 WSL 2，安裝後開啟，左下角顯示 **Engine running**。Linux：安裝 Docker Engine 與 Compose 外掛 |
| 磁碟空間 | 映像檔約 1 GB；資料另計，大檔案的處理暫存也放在資料磁碟區，請預留空間。Windows 需要啟用虛擬化功能（Docker Desktop 的 WSL 2） |
| 網路 | 只有方式一與方式三需要（下載映像檔、基礎映像檔與套件）。方式二安裝時不需要網路 |

確認 Docker 可以用：

```powershell
docker version
docker compose version
```

{{< tabs >}}
{{< tab name="Windows（PowerShell）" >}}
以下指令都在 **PowerShell** 執行。開啟方式：開始功能表搜尋「PowerShell」。
{{< /tab >}}
{{< tab name="Linux（bash）" >}}
以下 Linux 指令在 bash 執行；`docker` 若需要 `sudo`，每行前面加上。
{{< /tab >}}
{{< /tabs >}}

先建立一個安裝資料夾，之後的 `docker-compose.yml`、`.env` 都放在這裡：

{{< tabs >}}
{{< tab name="Windows（PowerShell）" >}}
```powershell
New-Item -ItemType Directory -Force C:\open-pets | Out-Null
cd C:\open-pets
```
{{< /tab >}}
{{< tab name="Linux（bash）" >}}
```bash
mkdir -p ~/open-pets && cd ~/open-pets
```
{{< /tab >}}
{{< /tabs >}}

## 4. 方式一：容器映像檔（GHCR）

1. 到 [Releases 頁](https://github.com/ttcdog115016/Demo/releases)，把該版本的 `docker-compose.yml` 與 `env.example` 下載到安裝資料夾，並把 `env.example` 複製成 `.env`。
2. 用文字編輯器開啟 `.env`，內容改成下面這樣（目前請填 `2.0.0-rc2`，之後正式版發佈就換成正式版的版本號）：

    ```text
    OPEN_PETS_IMAGE=ghcr.io/ttcdog115016/open-pets-app
    OPEN_PETS_VERSION=2.0.0-rc2
    ```

3. 如果套件是私有的，先用有 `read:packages` 權限的 GitHub 權杖登入。公開的套件不需要這一步：

    ```powershell
    docker login ghcr.io -u <GitHub 帳號>
    ```

4. 取得映像檔並啟動：

    ```powershell
    docker compose pull
    docker compose up -d
    ```

啟動後請接著做[第 7 節](#7-啟動後建立管理員並確認)。要驗證下載的映像檔確實是官方建置的，見[第 12 節](#12-驗證映像檔來源)。

## 5. 方式二：離線安裝

交付包資料夾內有這些檔案：

| 檔案 | 用途 |
| --- | --- |
| `open-pets-app_<版本>.tar.gz` | 映像檔（`docker load` 直接讀取，不需要先解壓縮） |
| `docker-compose.yml`、`docker-compose.online.yml` | 啟動設定（離線／線上模式） |
| `env.example` | 設定範本，複製成 `.env` 使用 |
| `SHA256SUMS.txt` | 完整性檢查碼；交付時請另外用安全管道確認一份 |
| `README_Docker.md`、`REBUILD.md` | 安裝說明與重新建置說明 |
| `open-pets-source_<版本>.zip` | 全部原始碼（前端與 `backend/`） |
| `LICENSE`、`THIRD_PARTY_NOTICES.txt`、`FRONTEND_THIRD_PARTY_LICENSES.md`、`image-sbom.cdx.json` | 授權聲明與軟體物料清單 |
| `Caddyfile.example`、`nginx.conf.example` | 對外開放時的反向代理範例 |

1. 把整個資料夾複製到要安裝的主機，並在該資料夾開啟終端機。
2. 核對完整性（檢查碼要與另一條管道取得的一致）：

    {{< tabs >}}
    {{< tab name="Windows（PowerShell）" >}}
    ```powershell
    Get-FileHash .\open-pets-app_<版本>.tar.gz -Algorithm SHA256
    ```
    把結果與 `SHA256SUMS.txt` 裡該檔案那一行比對。
    {{< /tab >}}
    {{< tab name="Linux（bash）" >}}
    ```bash
    sha256sum -c SHA256SUMS.txt
    ```
    每個檔案都要顯示 `OK`。
    {{< /tab >}}
    {{< /tabs >}}

3. 匯入映像檔：

    ```powershell
    docker load -i open-pets-app_<版本>.tar.gz
    ```

4. 把 `env.example` 複製成 `.env`（內容只有一行 `OPEN_PETS_VERSION=<版本>`），再啟動：

    {{< tabs >}}
    {{< tab name="Windows（PowerShell）" >}}
    ```powershell
    Copy-Item env.example .env
    docker compose up -d
    ```
    {{< /tab >}}
    {{< tab name="Linux（bash）" >}}
    ```bash
    cp env.example .env
    docker compose up -d
    ```
    {{< /tab >}}
    {{< /tabs >}}

{{< callout type="info" >}}
整個流程不需要網路。映像檔不會連到外部網站，前端也不載入外部的字型或腳本。
{{< /callout >}}

接著做[第 7 節](#7-啟動後建立管理員並確認)。

## 6. 方式三：原始碼

適合想檢視程式碼、重新建置，或依授權替換第三方元件的人。完整步驟與替換元件的做法見交付包的 `REBUILD.md`，這裡列出基本流程。

1. 解開 `open-pets-source_<版本>.zip`（或 clone GitHub repo 的同一個版本）。
2. 在解開後的 `open-pets` 資料夾建置映像檔（需要 Docker 的 `buildx`，並且要連網）：

    ```powershell
    docker buildx build -f docker/Dockerfile --build-arg OPEN_PETS_VERSION=<版本> -t open-pets-app:<版本> --load .
    ```

3. 把 `docker/docker-compose.yml` 複製到安裝資料夾，新增 `.env`，內容 `OPEN_PETS_VERSION=<版本>`，然後 `docker compose up -d`。

{{< callout type="info" >}}
自己重建的映像檔，digest 一定與官方不同：前端打包工具每次輸出的檔名雜湊都可能不一樣，功能相同。要確認取得的是官方版本，請用方式一的 digest 與簽章，或方式二的 SHA256，不要拿重建的結果去比對。
{{< /callout >}}

替換 fpdf2（LGPL-3.0）等元件時，修改 `backend/pyproject.toml` 後在 `backend/` 執行 `uv lock`，再重新建置即可，細節見 `REBUILD.md`。

## 7. 啟動後：建立管理員並確認

1. 確認容器狀態是 `healthy`（剛啟動約 40 秒內會先顯示 `starting`）：

    ```powershell
    docker ps
    ```

2. 建立第一個管理員。系統沒有預設帳號；指令會互動詢問帳號與密碼，密碼不會留在指令歷史：

    ```powershell
    docker exec -it open-pets python /opt/openpets/openpets_server.py create-admin
    ```

    - 帳號建議用 Email。
    - 密碼至少 12 個字元，要同時包含大寫、小寫、數字與符號。
    - 已經有帳號時這個指令會拒絕執行。其他使用者之後由管理員登入網頁，在「系統設定 → 帳號與權限管理」建立，系統不開放自行註冊。

3. 在這台電腦開瀏覽器，前往 **http://localhost:8080**，用剛建立的帳號登入。
4. 上傳一份測試 CSV，完成一次 K-匿名化，確認可以下載結果。操作方式見[前端操作說明](../frontend/)。

API 互動文件（Swagger）在 **http://localhost:8080/docs**，用法見 [API 使用說明](../api/)。

{{< callout type="info" >}}
**8080 埠已被占用時**（`port is already allocated`）：在 `.env` 加一行 `OPEN_PETS_PORT=8081`（任一空的埠），再 `docker compose up -d`，網址改用該埠。
{{< /callout >}}

## 8. 離線模式與線上模式

同一個映像檔，用環境變數選模式。預設是**離線模式**，不需要設定。

| | 離線模式（預設） | 線上模式 |
| --- | --- | --- |
| 適用 | 一台電腦、內網單一用途、無網路環境 | 多人使用、以網域對外提供服務 |
| 啟動指令 | `docker compose up -d` | `docker compose -f docker-compose.yml -f docker-compose.online.yml up -d` |
| 環境變數 | `OPEN_PETS_MODE=offline`（預設） | `OPEN_PETS_MODE=online` |
| 系統設定的「系統維運日誌」分頁 | 隱藏 | 顯示（管理員查看全站登入與 API 紀錄） |
| 登入頁 Demo 測試帳號 | 不顯示 | 不顯示（`OPEN_PETS_SHOW_DEMO_ACCOUNTS=true` 僅限展示站） |
| 必填設定 | 無 | `.env` 的 `OPEN_PETS_ALLOWED_HOSTS=你的網域`。沒設定時 `docker compose` 會直接報錯（`required variable OPEN_PETS_ALLOWED_HOSTS is missing a value`），不會啟動 |

- 兩種模式的資料、帳號、稽核紀錄與金鑰格式相同，可以直接切換：停止容器，改用另一個啟動指令即可，資料磁碟區不變。
- `OPEN_PETS_MODE` 填了其他值，容器會在啟動時報錯並結束（`docker logs open-pets` 看得到原因），不會悄悄退回預設。

`.env` 其他可設定的項目：

| 變數 | 用途 | 未設定時 |
| --- | --- | --- |
| `OPEN_PETS_VERSION` | 要使用的映像檔版本 | 檔內預設版本 |
| `OPEN_PETS_IMAGE` | 映像檔名稱（用 GHCR 時填 `ghcr.io/ttcdog115016/open-pets-app`） | `open-pets-app` |
| `OPEN_PETS_PORT` | 本機對外的埠 | 8080 |
| `OPEN_PETS_ALLOWED_HOSTS` | 允許的網址主機名稱，逗號分隔，用來擋 DNS rebinding | 離線模式不限制 |
| `OPEN_PETS_MAX_UPLOAD_MB` | 單次上傳上限（MB） | 1024 |
| `OPEN_PETS_DEFAULT_SALT`、`OPEN_PETS_SYSTEM_MASTER_KEY`、`OPEN_PETS_JWT_SECRET` | 要把金鑰與資料分開保管時才填（各 64 字元隨機字串，環境變數優先於自動產生的） | 第一次啟動自動產生 |

修改 `.env` 後執行 `docker compose up -d`，容器會用新設定重建。

## 9. 開放給其他電腦

預設只有這台電腦（`127.0.0.1`）連得進來。**不要直接把 8080 以明文 HTTP 開放到區網或網際網路**，請在前面加一層提供 HTTPS 的反向代理。

### 反向代理與 HTTPS

交付包附兩份範例（原始碼在 `docker/proxy-examples/`），都已實測過 HTTPS 下的完整流程（登入、上傳、K-匿名化、下載 CSV 與 PDF）：

| 範例 | 特色 |
| --- | --- |
| `Caddyfile.example` | Caddy 自動申請並續期憑證，設定最短 |
| `nginx.conf.example` | nginx，憑證自行準備（例如 certbot 或內部 CA） |

使用時把範例裡的 `openpets.example.com` 換成你的網域。不論用哪種代理，這幾點都要做到：

- 把 `Host` 標頭**原樣轉送**，否則會被主機名稱檢查擋掉。
- 允許大檔案上傳（預設上限 1024 MB）、不要先緩衝整個請求本文。
- 逾時設長一點，大檔案的處理時間可能很久。
- 在代理層加上 `Strict-Transport-Security`（範例已加）。

### 設定線上模式與允許的網域

在 `.env` 填入使用者會用的主機名稱（逗號分隔），並用線上模式啟動：

```text
OPEN_PETS_ALLOWED_HOSTS=pets.example.com
```

```powershell
docker compose -f docker-compose.yml -f docker-compose.online.yml up -d
```

漏列的主機名稱連進來會得到 400（`Invalid host header`）。容器自己的健康檢查所用的 `127.0.0.1`、`localhost` 不需要列。

### 區域網路（不經反向代理，僅限內網測試）

如果只是內網測試，也可以在 `docker-compose.yml` 把 `ports` 的 `127.0.0.1:` 拿掉並在防火牆開放 8080；正式使用仍建議走反向代理與 HTTPS。

{{< tabs >}}
{{< tab name="Windows（PowerShell）" >}}
用**系統管理員身分**開 PowerShell：

```powershell
New-NetFirewallRule -DisplayName "Open-PETs 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```
{{< /tab >}}
{{< tab name="Linux（bash）" >}}
```bash
sudo ufw allow 8080/tcp   # 以 ufw 為例；其他防火牆請用對應的指令
```
{{< /tab >}}
{{< /tabs >}}

### 透過網際網路

用 Cloudflare Tunnel 等通道時，把通道目標設為 `http://localhost:8080`，並依上面設定線上模式與 `OPEN_PETS_ALLOWED_HOSTS`（作法見《Demo 展示環境建置與維運手冊（cloudflared 通道＋內網測試）》）。

## 10. 更新與退回

資料與金鑰都在磁碟區 `open-pets-data`，換映像檔不會遺失。

{{< tabs >}}
{{< tab name="方式一：GHCR" >}}
1. 把 `.env` 的 `OPEN_PETS_VERSION` 改成新版本。
2. 取得並重建容器：

    ```powershell
    docker compose pull
    docker compose up -d
    ```
{{< /tab >}}
{{< tab name="方式二：離線" >}}
1. 核對新版 `open-pets-app_<新版本>.tar.gz` 的 SHA256，再 `docker load -i open-pets-app_<新版本>.tar.gz`。
2. 把 `.env` 的 `OPEN_PETS_VERSION` 改成新版本。
3. `docker compose up -d`。
{{< /tab >}}
{{< tab name="方式三：原始碼" >}}
1. 取得新版原始碼，依[第 6 節](#6-方式三原始碼)重新建置。
2. 把 `.env` 的 `OPEN_PETS_VERSION` 改成新版本，`docker compose up -d`。
{{< /tab >}}
{{< /tabs >}}

更新後確認 `docker ps` 為 `healthy`，並登入網頁看一下。

**退回舊版：** 把 `OPEN_PETS_VERSION` 改回舊版本，再 `docker compose up -d`（舊映像檔還在本機就不需要重新取得）。

{{< callout type="info" >}}
版本一律指定明確的版號，不使用 `latest`（交付包與 GHCR 都不提供 `latest`），避免無意間升級。
{{< /callout >}}

## 11. 備份與還原

需要備份的只有磁碟區 `open-pets-data`，裡面有帳號資料庫、處理紀錄、稽核紀錄與自動產生的金鑰。

{{< callout type="warning" >}}
**金鑰與稽核紀錄是一組的，要一起備份，並當作機密保管。** 鹽值（`OPEN_PETS_DEFAULT_SALT`）遺失或變更後，新的雜湊結果就對不上以前的資料；簽章金鑰（`OPEN_PETS_SYSTEM_MASTER_KEY`）變更後，舊的稽核紀錄無法再驗證。
{{< /callout >}}

下面用映像檔本身執行 `tar`（不需要另外下載其他映像檔，離線環境也能用）。磁碟區的實際名稱以 `docker volume ls` 為準，用 compose 啟動時是 `open-pets_open-pets-data`。指令裡的映像檔 `open-pets-app:<版本>`，用方式一（GHCR）安裝時請換成 `ghcr.io/ttcdog115016/open-pets-app:<版本>`。

**備份**（先停服務，避免資料庫寫到一半）：

{{< tabs >}}
{{< tab name="Windows（PowerShell）" >}}
```powershell
docker compose stop
docker run --rm --user root --entrypoint tar `
  -v open-pets_open-pets-data:/data -v "${PWD}:/backup" `
  open-pets-app:<版本> czf /backup/open-pets-data.tgz -C /data .
docker compose start
```
{{< /tab >}}
{{< tab name="Linux（bash）" >}}
```bash
docker compose stop
docker run --rm --user root --entrypoint tar \
  -v open-pets_open-pets-data:/data -v "$PWD:/backup" \
  open-pets-app:<版本> czf /backup/open-pets-data.tgz -C /data .
docker compose start
```
{{< /tab >}}
{{< /tabs >}}

**還原**（到新的磁碟區或新的主機；先 `docker compose down`，舊的磁碟區不要沿用）：

{{< tabs >}}
{{< tab name="Windows（PowerShell）" >}}
```powershell
docker volume create open-pets_open-pets-data
docker run --rm --user root --entrypoint sh `
  -v open-pets_open-pets-data:/data -v "${PWD}:/backup" `
  open-pets-app:<版本> -c "tar xzf /backup/open-pets-data.tgz -C /data && chown -R 10001:10001 /data"
docker compose up -d
```
{{< /tab >}}
{{< tab name="Linux（bash）" >}}
```bash
docker volume create open-pets_open-pets-data
docker run --rm --user root --entrypoint sh \
  -v open-pets_open-pets-data:/data -v "$PWD:/backup" \
  open-pets-app:<版本> -c "tar xzf /backup/open-pets-data.tgz -C /data && chown -R 10001:10001 /data"
docker compose up -d
```
{{< /tab >}}
{{< /tabs >}}

還原後登入網頁，並執行 `docker exec open-pets python /opt/openpets/openpets_server.py verify-log` 確認稽核紀錄驗證通過。

## 12. 驗證映像檔來源

映像檔由本專案的 GitHub Actions 建置，並用 cosign 簽署（無金鑰簽章）。Release 說明裡有該版本的映像檔 digest 與完整的驗證指令；需要先安裝 [cosign](https://docs.sigstore.dev/cosign/system_config/installation/)，並且能連到 Sigstore：

```bash
cosign verify ghcr.io/ttcdog115016/open-pets-app@sha256:<digest> \
  --certificate-identity-regexp '^https://github.com/ttcdog115016/Demo/\.github/workflows/docker-image\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

離線安裝包內的 `SHA256SUMS.txt` 也有簽章（`SHA256SUMS.txt.sigstore.json`），連網時可以驗證它沒被換掉：

```bash
cosign verify-blob --bundle SHA256SUMS.txt.sigstore.json \
  --certificate-identity-regexp '^https://github.com/ttcdog115016/Demo/\.github/workflows/docker-image\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  SHA256SUMS.txt
```

- 完全隔離的環境無法驗證簽章，以 `SHA256SUMS.txt`（另一條管道取得的檢查碼）為準。
- 簽章會記在公開的 Sigstore 透明日誌，其中包含本專案的 GitHub 帳號與 repo 名稱。

## 13. 授權與原始碼

- 本軟體（前端與後端程式碼）為 MIT 授權，全文見 `LICENSE`（後端另見 `backend/LICENSE`）。
- 映像檔含開源第三方元件，授權與取得原始碼的方式見 `THIRD_PARTY_NOTICES.txt`（Python 套件）與 `FRONTEND_THIRD_PARTY_LICENSES.md`（前端套件）。同樣的檔案也在映像檔內：`docker exec open-pets ls /licenses`。
- 其中 fpdf2（LGPL-3.0）以原始碼檔形式存在映像檔內，certifi（MPL-2.0）未經修改。要替換這些元件或自行重新建置，請依 `REBUILD.md`。全部原始碼都在 `open-pets-source_<版本>.zip`。
- `image-sbom.cdx.json` 是映像檔的軟體物料清單（CycloneDX），可匯入弱點管理工具。

## 14. 移轉到甲方 GitHub 帳號

正式上線時，repo 改放到甲方的 GitHub 帳號。擇一進行：

**方式 A：GitHub 轉移所有權**（保留 Issues、Actions 設定與星號）

1. 在 `ttcdog115016/Demo` 的 **Settings → General → Danger Zone → Transfer ownership**，輸入甲方的帳號或組織名稱。
2. 甲方接受後，舊網址會自動導向新網址。

**方式 B：複製到甲方新建的 repo**

1. 甲方在 GitHub 建立空的 repo（不要勾選建立 README）。
2. 在已 clone 的資料夾推送全部分支與標籤：

    ```powershell
    git remote set-url origin https://github.com/<甲方組織>/<repo>.git
    git push --all origin
    git push --tags origin
    ```

**移轉後檢查**

- [ ] repo 的可見度（公開或私有）符合甲方要求。**`backend/` 在同一個 repo，repo 公開時後端原始碼也會公開。**
- [ ] 預設分支設為 `main`，並確認所有修改已合併進 `main`。
- [ ] **Settings → Branches** 為 `main` 加上分支保護：需經 Pull Request、需通過 CI 才能合併。
- [ ] **Actions** 分頁已啟用工作流程（複製過來的 repo 預設可能停用）。
- [ ] GHCR 映像檔位置會跟著帳號改變（`ghcr.io/<新擁有者小寫>/open-pets-app`）。使用者的 `.env` 要把 `OPEN_PETS_IMAGE` 改成新位置；說明文件與 Release 說明裡的網址、cosign 驗證指令的 repo 名稱也要一併更新。
- [ ] 重新建置時用 `OPEN_PETS_SOURCE_URL` 指向新的 repo（工作流程會自動帶入）。
- [ ] 新帳號下的 GHCR 套件可見度：公開的套件可匿名 `docker pull`，私有的要用有 `read:packages` 的權杖登入。
- [ ] 部署主機執行 `git remote set-url origin <新網址>`，之後 `git pull` 才會抓新位置。

## 15. GitHub Actions 自動化

repo 的 `.github/workflows/` 有三個工作流程：

| 工作流程 | 觸發 | 內容 |
| --- | --- | --- |
| `ci.yml` | 推送或發 Pull Request 到 `main`、`master`、`feature/backend-v2-integration` | 前端 `npm ci`、型別檢查與打包、`vitest`；後端 `uv sync --locked`、`pytest` |
| `docker-image.yml` | 推送 `v*` 標籤（手動執行只做建置與打包，不發佈） | 建置映像檔 → Trivy 弱點掃描（有可修補的高風險就失敗）→ 冒煙測試（離線、線上兩種模式）→ 推送 GHCR → cosign 簽章 → 產生離線交付包 → 建立 Release |
| `pages.yml` | `doc_site/` 有修改並推送到 `main` | 建置並發佈本文件網站 |

- 結果在 repo 的 **Actions** 分頁：綠色勾勾代表通過；紅色叉叉點進去可看失敗的步驟與訊息。
- **發新版的做法：** 在 `main`（或要發版的分支）的最新 commit 建立標籤並推送，例如 `v2.0.0`。版本含連字號（如 `2.0.0-rc1`）會被標為預發版（pre-release）。GHCR 映像檔、離線 tar.gz 與 Release 都由同一次建置產生，內容相同。
- 只使用 GitHub 內建的 `GITHUB_TOKEN`，不需要另外設定密碼或金鑰。

### 本文件網站

本網站的原始檔在 repo 的 `doc_site/`（Hugo＋Hextra 主題），由 `pages.yml` 自動發佈：

- `doc_site/` 有修改並推送到 `main` 後，GitHub 會自動建置並更新網站，約 1–2 分鐘。也可以在 Actions 分頁手動執行「Deploy docs site to Pages」。
- 第一次使用前，請到 repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
- 本機預覽：安裝 Hugo extended（`winget install Hugo.Hugo.Extended`），clone 時加 `--recurse-submodules` 取得主題，然後在 `doc_site` 資料夾執行 `hugo server`，開 http://localhost:1313/Demo/ 。

## 16. 疑難排解

安裝或使用時遇到的錯誤（埠被占用、400、413、容器不健康、校驗碼對不上等）與處理方式，見[常見問題](../faq/#部署與連線)。
