---
title: 安裝教學（完整參考）
weight: 3
---

適用版本：Open-PETs **2.0.0**（前端與後端在同一個 Docker 映像檔）｜環境：Windows 10／11＋Docker Desktop，附 Linux 指令

{{< callout type="info" >}}
**第一次安裝、不熟指令？請看[新手快速上手](../quickstart/)。** 那一頁用問答式小工具（`open-pets.ps1`／`open-pets.sh`）帶你安裝與切換模式。本頁是給資訊人員的**完整參考**：手動做法、進階設定、更新、備份、驗證與授權。
{{< /callout >}}

{{< callout type="warning" >}}
**目前 GitHub Releases 只有預發版（最新是 `2.0.0-rc3`），正式版 `2.0.0` 尚未發佈。** 現在安裝請填 **`2.0.0-rc3`**，填 `2.0.0` 會拉不到映像檔。
{{< /callout >}}

### 版本號怎麼填

文中的 `<版本>` 要換成**實際存在的版本號**：到 [Releases 頁](https://github.com/ttcdog115016/Demo/releases)，看你要裝的那一筆。

| Releases 頁上看到的 | 要填的版本號 |
| --- | --- |
| 標題 `Open-PETs 2.0.0-rc3`（標籤 `v2.0.0-rc3`，有 Pre-release 標示） | `2.0.0-rc3`（**不含開頭的 v**） |
| 日後正式版：標題 `Open-PETs 2.0.0`（標籤 `v2.0.0`） | `2.0.0` |

- 每次安裝或更新都要寫明確版本，系統不提供 `latest`。
- 帶 `-rc` 的是預發版，只用於試用與驗證；正式環境請等正式版。
- 離線交付包的檔名也帶同一個版本，例如 `open-pets-app_2.0.0-rc3.tar.gz`。

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

- 前端與後端在**同一個容器、同一個埠（8080）**，不需要另外裝 nginx、Python 或 Node.js。
- 容器預設只綁本機（`127.0.0.1`）。要讓其他電腦連入，見[第 9 節](#9-開放給其他電腦內網與線上)。
- 第一次啟動會自動產生雜湊鹽值與簽章金鑰，存在磁碟區的 `/data/.secrets.env`，**不用自己準備金鑰**。

## 2. 選擇取得方式

| | 方式一：容器映像檔（GHCR） | 方式二：離線安裝 | 方式三：原始碼 |
| --- | --- | --- | --- |
| 適用 | 主機能上網 | 無網路或內網環境 | 想檢視、重新建置，或替換 fpdf2、certifi 等第三方元件 |
| 取得 | `ghcr.io/ttcdog115016/open-pets-app:<版本>` | 交付包的 `open-pets-app_<版本>.tar.gz` | 交付包的 `open-pets-source_<版本>.zip`，或 GitHub repo |
| 驗證 | 映像檔 digest、cosign 簽章 | `SHA256SUMS.txt` | 壓縮檔註解內的 commit |
| 更新 | `docker compose pull` | 換新的 tar.gz，`docker load` | 重新建置 |
| 章節 | [第 4 節](#4-方式一容器映像檔ghcr) | [第 5 節](#5-方式二離線安裝) | [第 6 節](#6-方式三原始碼) |

三種方式拿到的是同一個版本。查映像檔對應哪個原始碼 commit：

```powershell
docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' open-pets-app:<版本>
```

## 3. 事前準備

| 項目 | 說明 |
| --- | --- |
| 作業系統 | Windows 10／11（64 位元）或 Linux。只提供 x86_64（amd64）映像檔，不支援 ARM |
| Docker | Windows：安裝 Docker Desktop（選用 WSL 2），開啟後左下角顯示 **Engine running**。Linux：Docker Engine＋Compose 外掛 |
| 磁碟 | 映像檔約 1 GB；資料另計，大檔案的處理暫存也放在資料磁碟區，請預留空間 |
| 網路 | 只有方式一、三需要。方式二安裝時不需要網路 |

確認 Docker 可用：

```powershell
docker version
docker compose version
```

先建立一個**全新的**安裝資料夾，之後的 `docker-compose.yml`、`.env` 都放這裡：

{{< callout type="warning" >}}
**不要用已在使用的資料夾。** 舊版（兩容器）的線上版把 `C:\open-pets\.env`（鹽值與金鑰）放在 `C:\open-pets`；在同一資料夾放新的 `.env` 會**覆蓋掉舊的鹽值與金鑰**，之後的雜湊結果就對不上以前的資料。下面一律用新名稱 `open-pets-app`。
{{< /callout >}}

{{< tabs >}}
{{< tab name="Windows（PowerShell）" >}}
```powershell
New-Item -ItemType Directory -Force C:\open-pets-app | Out-Null
cd C:\open-pets-app
```
{{< /tab >}}
{{< tab name="Linux（bash）" >}}
```bash
mkdir -p ~/open-pets-app && cd ~/open-pets-app
```
{{< /tab >}}
{{< /tabs >}}

## 4. 方式一：容器映像檔（GHCR）

{{< callout type="info" >}}
下面的指令都在終端機貼上執行，並要先 `cd` 進安裝資料夾。`OPEN_PETS_IMAGE=...` 這種 `名稱=值` 是寫在 `.env` **檔案裡**的內容，不是終端機指令，直接輸入會出現「無法辨識」。
{{< /callout >}}

1. 下載該版本的 `docker-compose.yml`（把版本換成你要的）：

    {{< tabs >}}
    {{< tab name="Windows（PowerShell）" >}}
    ```powershell
    $v = '2.0.0-rc3'
    Invoke-WebRequest -UseBasicParsing "https://github.com/ttcdog115016/Demo/releases/download/v$v/docker-compose.yml" -OutFile docker-compose.yml
    ```
    {{< /tab >}}
    {{< tab name="Linux（bash）" >}}
    ```bash
    v=2.0.0-rc3
    curl -fsSLO "https://github.com/ttcdog115016/Demo/releases/download/v$v/docker-compose.yml"
    ```
    {{< /tab >}}
    {{< /tabs >}}

2. 建立 `.env`（兩行：映像檔位置與版本）。用指令建立，不要用記事本另存（容易變成 `.env.txt` 或帶 BOM，compose 會讀不到）：

    {{< tabs >}}
    {{< tab name="Windows（PowerShell）" >}}
    ```powershell
    @"
    OPEN_PETS_IMAGE=ghcr.io/ttcdog115016/open-pets-app
    OPEN_PETS_VERSION=$v
    "@ | Set-Content -Encoding ascii .env
    ```
    {{< /tab >}}
    {{< tab name="Linux（bash）" >}}
    ```bash
    printf 'OPEN_PETS_IMAGE=ghcr.io/ttcdog115016/open-pets-app\nOPEN_PETS_VERSION=%s\n' "$v" > .env
    ```
    {{< /tab >}}
    {{< /tabs >}}

    確認內容（應有兩行）：`Get-Content .env`（Windows）或 `cat .env`（Linux）。

3. 套件若是私有的，先用 GitHub 的 `read:packages` 權限登入（公開的不需要）：

    ```powershell
    docker login ghcr.io -u <GitHub 帳號>
    ```

4. 取得映像檔並啟動：

    ```powershell
    docker compose pull
    docker compose up -d
    ```

接著做[第 7 節](#7-啟動後建立管理員並確認)。要驗證映像檔確實是官方建置的，見[第 12 節](#12-驗證映像檔來源)。

## 5. 方式二：離線安裝

交付包資料夾內的檔案：

| 檔案 | 用途 |
| --- | --- |
| `open-pets-app_<版本>.tar.gz` | 映像檔（`docker load` 直接讀，不用先解壓縮） |
| `docker-compose.yml`、`docker-compose.lan.yml`、`docker-compose.online.yml` | 啟動設定：本地（預設）、內網（內建 HTTPS）、線上（對外網域） |
| `Caddyfile.lan` | 內網模式的 Caddy 設定（一般不用改） |
| `Caddyfile.example`、`nginx.conf.example` | 線上模式的反向代理範例 |
| `open-pets.ps1`、`open-pets.sh` | 安裝與切換模式小工具（預設版本已換成該版） |
| `env.example` | 設定範本，複製成 `.env` |
| `SHA256SUMS.txt` | 完整性檢查碼；交付時請另用安全管道確認一份 |
| `README_Docker.md`、`REBUILD.md` | 安裝說明、重新建置說明 |
| `open-pets-source_<版本>.zip` | 全部原始碼（前端與 `backend/`） |
| `LICENSE`、`THIRD_PARTY_NOTICES.txt`、`FRONTEND_THIRD_PARTY_LICENSES.md`、`image-sbom.cdx.json` | 授權聲明與軟體物料清單 |

1. 把整個資料夾複製到主機，並在該資料夾開終端機。
2. 核對完整性（結果要與另一條管道取得的一致）：

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

4. 把 `env.example` 複製成 `.env`（只有一行 `OPEN_PETS_VERSION=<版本>`），啟動：

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

整個流程不需要網路，映像檔不會連到外部網站，前端也不載入外部字型或腳本。接著做[第 7 節](#7-啟動後建立管理員並確認)。

## 6. 方式三：原始碼

適合想檢視程式碼、重新建置，或依授權替換第三方元件的人。完整步驟見交付包的 `REBUILD.md`，基本流程如下。

1. 解開 `open-pets-source_<版本>.zip`（或 clone GitHub repo 的同一版本）。
2. 在解開後的 `open-pets` 資料夾建置映像檔（需要 Docker `buildx` 與網路）：

    ```powershell
    docker buildx build -f docker/Dockerfile --build-arg OPEN_PETS_VERSION=<版本> -t open-pets-app:<版本> --load .
    ```

3. 把 `docker/docker-compose.yml` 複製到安裝資料夾，建立 `.env`（一行，版本換成你建置時用的），再啟動：

    {{< tabs >}}
    {{< tab name="Windows（PowerShell）" >}}
    ```powershell
    "OPEN_PETS_VERSION=<版本>" | Set-Content -Encoding ascii .env
    docker compose up -d
    ```
    {{< /tab >}}
    {{< tab name="Linux（bash）" >}}
    ```bash
    echo "OPEN_PETS_VERSION=<版本>" > .env
    docker compose up -d
    ```
    {{< /tab >}}
    {{< /tabs >}}

{{< callout type="info" >}}
自己重建的映像檔，digest 一定與官方不同（前端打包工具每次輸出的檔名雜湊都可能不一樣，功能相同）。要確認拿到的是官方版本，請用方式一的 digest 與簽章，或方式二的 SHA256，不要拿重建的結果去比對。
{{< /callout >}}

替換 fpdf2（LGPL-3.0）等元件：修改 `backend/pyproject.toml`，在 `backend/` 執行 `uv lock`，再重新建置。細節見 `REBUILD.md`。

## 7. 啟動後：建立管理員並確認

1. 確認容器狀態是 `healthy`（剛啟動約 40 秒內會顯示 `starting`）：

    ```powershell
    docker ps
    ```

2. 建立第一個管理員。系統沒有預設帳號；指令會互動詢問帳號與密碼，密碼不會留在指令歷史：

    ```powershell
    docker exec -it open-pets python /opt/openpets/openpets_server.py create-admin
    ```

    - 帳號建議用 Email。密碼至少 12 個字元，要有大寫、小寫、數字、符號。
    - 已經有帳號時，這個指令會拒絕執行。其他使用者由管理員登入網頁，在「系統設定 → 帳號與權限管理」建立，系統不開放自行註冊。
    - 容器名稱以 `docker ps` 為準。用小工具安裝、而這台電腦已有同名容器時，名稱會是 `open-pets-app`。

3. 在這台電腦的瀏覽器開 **http://localhost:8080**，用剛建立的帳號登入。
4. 上傳一份測試 CSV，完成一次 K-匿名化並下載結果。操作見[前端操作說明](../frontend/)。

API 互動文件（Swagger）在 **http://localhost:8080/docs**，用法見 [API 使用說明](../api/)。

{{< callout type="info" >}}
**8080 埠被占用**（`port is already allocated`）：在 `.env` 加一行 `OPEN_PETS_PORT=8081`（任一空的埠），再 `docker compose up -d`，網址改用該埠。
{{< /callout >}}

## 8. 三種模式：本地、線上、內網

同一個映像檔，用環境變數 `OPEN_PETS_MODE` 選模式。預設是**本地**，不用設定。

| | 本地（預設） | 內網 | 線上 |
| --- | --- | --- | --- |
| `OPEN_PETS_MODE` | `local`（舊值 `offline` 仍接受，視為 `local`） | `lan` | `online` |
| 適用 | 一台電腦、無網路環境 | **同一個內網**的多台電腦，用內網 IP 或主機名稱連線 | 以**對外網域**提供服務（網際網路） |
| 啟動指令 | `docker compose up -d` | `docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d` | `docker compose -f docker-compose.yml -f docker-compose.online.yml up -d` |
| HTTPS | 不需要（本機） | **內建 Caddy HTTPS**（私有 CA，使用者電腦要信任根憑證） | 自備反向代理與正式憑證 |
| 必填設定 | 無 | `.env` 的 `OPEN_PETS_ALLOWED_HOSTS=內網IP,主機名稱`（例如 `192.168.1.20,pets-server`） | `.env` 的 `OPEN_PETS_ALLOWED_HOSTS=對外網域` |
| 「系統維運日誌」分頁（系統設定內） | 隱藏 | 顯示（管理員查看全站登入與 API 紀錄） | 顯示 |
| 登入頁 Demo 測試帳號 | 不顯示 | 不顯示 | 不顯示（`OPEN_PETS_SHOW_DEMO_ACCOUNTS=true` 僅限展示站） |
| 章節 | 第 7 節 | [第 9 節](#9-開放給其他電腦內網與線上) | [9-6](#9-6-線上模式online對外網域) |

- 內網、線上的 `OPEN_PETS_ALLOWED_HOSTS` 沒設定時，`docker compose` 會直接報錯（`required variable OPEN_PETS_ALLOWED_HOSTS is missing a value`），不會啟動。
- 三種模式的資料、帳號、稽核紀錄與金鑰格式相同，可以直接切換：停止容器，改用另一個啟動指令，資料磁碟區不變。
- `OPEN_PETS_MODE` 填了 `local`、`offline`、`online`、`lan` 以外的值，容器啟動時會報錯並結束（`docker logs` 看得到原因），不會悄悄退回預設。
- `local`、`lan` 兩個模式值與 `docker-compose.lan.yml`、小工具要 **2.0.0-rc3 起**才有；`2.0.0-rc2` 以前只認 `offline`、`online`。

### 用小工具切換，或手動切換

**用小工具（建議）：** 在安裝資料夾執行 `.\open-pets.ps1 mode local`、`mode lan` 或 `mode online`（Linux 用 `./open-pets.sh`）。工具會改好 `.env` 與設定檔並重啟，資料不會不見。細節見[新手快速上手的第 5 步](../quickstart/#第-5-步切換模式)。

**手動：** 工具其實只是在 `.env` 寫下下面幾行，之後單純 `docker compose up -d` 就會用對的設定檔，不必每次輸入一長串 `-f`：

| 模式 | `.env` 要有的行 |
| --- | --- |
| 本地 | `OPEN_PETS_MODE=local`<br>`COMPOSE_PATH_SEPARATOR=:`<br>`COMPOSE_FILE=docker-compose.yml` |
| 內網 | `OPEN_PETS_MODE=lan`<br>`OPEN_PETS_ALLOWED_HOSTS=192.168.1.20,pets-server`<br>`COMPOSE_PATH_SEPARATOR=:`<br>`COMPOSE_FILE=docker-compose.yml:docker-compose.lan.yml` |
| 線上 | `OPEN_PETS_MODE=online`<br>`OPEN_PETS_ALLOWED_HOSTS=pets.example.com`<br>`COMPOSE_PATH_SEPARATOR=:`<br>`COMPOSE_FILE=docker-compose.yml:docker-compose.online.yml` |

改完 `.env` 執行 `docker compose up -d --remove-orphans`（會把用不到的容器，例如從內網切回本地時的 HTTPS 容器，一併移除；資料不受影響）。

`.env` 其他可設定的項目：

| 變數 | 用途 | 未設定時 |
| --- | --- | --- |
| `OPEN_PETS_VERSION` | 映像檔版本 | 檔內預設版本 |
| `OPEN_PETS_IMAGE` | 映像檔名稱（用 GHCR 時填 `ghcr.io/ttcdog115016/open-pets-app`） | `open-pets-app` |
| `OPEN_PETS_MODE` | 模式：`local`、`lan`、`online` | `local` |
| `OPEN_PETS_PORT` | 應用程式在本機的埠 | 8080 |
| `OPEN_PETS_CONTAINER_NAME` | 容器名稱（同一台電腦裝多份時用） | `open-pets` |
| `OPEN_PETS_BIND` | 應用程式埠綁定的網卡位址；只在不用 HTTPS、直接以 HTTP 開放內網時才改（不建議） | `127.0.0.1`（只有本機） |
| `OPEN_PETS_HTTPS_PORT`、`OPEN_PETS_HTTPS_BIND` | 內網模式 HTTPS 代理對內網開放的埠與網卡位址 | 443、`0.0.0.0` |
| `OPEN_PETS_ALLOWED_HOSTS` | 允許的網址（內網 IP、主機名稱或網域），逗號分隔、**不加空格**，用來擋 DNS rebinding；內網模式的憑證也依這份清單簽發 | 本地模式不限制 |
| `OPEN_PETS_MAX_UPLOAD_MB` | 單次上傳上限（MB） | 1024 |
| `OPEN_PETS_DEFAULT_SALT`、`OPEN_PETS_SYSTEM_MASTER_KEY`、`OPEN_PETS_JWT_SECRET` | 要把金鑰與資料分開保管時才填（各 64 字元隨機字串，環境變數優先於自動產生的） | 第一次啟動自動產生 |

修改 `.env` 後執行 `docker compose up -d`，容器會用新設定重建。

## 9. 開放給其他電腦（內網與線上）

預設只有這台電腦（`127.0.0.1`）連得進來（本地模式）。要讓其他電腦用瀏覽器使用，有兩種做法：

- **同一個內網的多台電腦：用「內網模式（lan）」**（9-1 到 9-5）。主機多開一個 Caddy 容器終止 HTTPS，憑證由 Caddy 內建的私有 CA 簽發，**不需要對外網路，也不用申請網域或 Let's Encrypt**。
- **以對外網域提供服務：用「線上模式（online）」**（[9-6](#9-6-線上模式online對外網域)）。前面自備反向代理與正式憑證。

兩種做法，應用程式本身的 8080 都只綁本機，其他電腦只能走 HTTPS。

### 9-1. 先決定使用者輸入的網址

使用者會在瀏覽器輸入 `https://<網址>`。網址可以是主機的內網 IP（例如 `192.168.1.20`）、內網 DNS 的主機名稱（例如 `pets-server`），或兩者都有。

- **建議把主機 IP 固定下來**（路由器的 DHCP 保留，或在主機設固定 IP）。IP 變了，憑證與使用者的書籤都要跟著改。
- 查主機 IP：Windows 執行 `ipconfig`，找「IPv4 位址」；Linux 執行 `hostname -I`。
- 在安裝資料夾的 `.env` 加入這份清單（逗號分隔，**逗號前後不要空格**），**使用者會輸入的每個網址都要列**：

    ```text
    OPEN_PETS_ALLOWED_HOSTS=192.168.1.20,pets-server
    ```

    這份清單同時是應用程式的主機名稱檢查（漏列的網址會得到 400 `Invalid host header`）和憑證要簽發的名稱。
- 清單裡有 IP 時，**第一個 IP 是「沒有送主機名稱」的連線所用的預設憑證**。用 IP 當網址時瀏覽器不會送主機名稱，所以主機有多個 IP 時，請把使用者實際會用的那個放最前面。
- **換了網路、IP 變了**，要把新 IP 補進清單（舊的也可以留著）：`mode lan -Hosts 新IP,舊IP`，或改 `.env` 後 `docker compose up -d`。根憑證不會變，使用者不用重新信任。

### 9-2. 取得設定檔並啟動

從該版本的 [Releases 頁](https://github.com/ttcdog115016/Demo/releases)（離線交付包裡也有）取得這兩個檔案，放在安裝資料夾（和 `docker-compose.yml` 同一處）。**`2.0.0-rc2` 以前的版本沒有它們，也不認得模式值 `lan`**，請用 rc3 起的版本。

| 檔案 | 用途 |
| --- | --- |
| `docker-compose.lan.yml` | 內網模式：設定 `OPEN_PETS_MODE=lan`，多開 Caddy 容器終止 HTTPS |
| `Caddyfile.lan` | Caddy 設定，由 compose 掛載，一般不用改 |

{{< callout type="warning" >}}
**離線環境要先帶 Caddy 映像檔。** `docker-compose.lan.yml` 用到 `caddy:2.11.9`。在有網路的電腦執行 `docker pull caddy:2.11.9` 與 `docker save caddy:2.11.9 -o caddy.tar`，把 `caddy.tar` 帶到主機後 `docker load -i caddy.tar`。
{{< /callout >}}

啟動（兩個檔案疊加）：

```powershell
docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d
docker ps
```

應該看到兩個容器：`open-pets`（`healthy`）與 `open-pets-proxy-1`（`Up`）。沒設定 `OPEN_PETS_ALLOWED_HOSTS` 時，`docker compose` 會直接報錯，不會啟動。

### 9-3. 開放防火牆

內網其他電腦要連到主機的 443 埠：

{{< tabs >}}
{{< tab name="Windows（PowerShell）" >}}
用**系統管理員身分**開 PowerShell：

```powershell
New-NetFirewallRule -DisplayName "Open-PETs HTTPS 443" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```
{{< /tab >}}
{{< tab name="Linux（bash）" >}}
```bash
sudo ufw allow 443/tcp   # 以 ufw 為例；其他防火牆請用對應的指令
```
{{< /tab >}}
{{< /tabs >}}

主機的 443 已被占用時，在 `.env` 加 `OPEN_PETS_HTTPS_PORT=8443`（防火牆也開 8443），使用者的網址要加上埠：`https://192.168.1.20:8443`。

**測試連得通不通**（在使用者電腦執行，要顯示 `TcpTestSucceeded : True`）：

```powershell
Test-NetConnection 192.168.1.20 -Port 443
```

### 9-4. 讓使用者電腦信任根憑證

憑證是 Caddy 的私有 CA 簽發的，使用者電腦要**信任這個 CA 的根憑證**，瀏覽器才不會顯示「您的連線不是私人連線」。每台使用者電腦做一次。

**用小工具一鍵完成：** `.\open-pets.ps1 export-ca`（Linux：`./open-pets.sh export-ca`）會匯出 `open-pets-ca.crt`，並產生已填好網址與憑證指紋的「給同事的說明」`open-pets-colleague-guide.txt`。下面是手動做法。

1. 在主機匯出根憑證（只有憑證，不含私鑰，可以放心傳給使用者）：

    ```powershell
    docker compose -f docker-compose.yml -f docker-compose.lan.yml cp proxy:/data/caddy/pki/authorities/local/root.crt ./open-pets-ca.crt
    ```

2. 把 `open-pets-ca.crt` 交給使用者（隨身碟、內網檔案伺服器或 Email 都可以），並在每台使用者電腦安裝成「受信任的根憑證授權單位」：

    {{< tabs >}}
    {{< tab name="Windows" >}}
    在使用者電腦用**系統管理員身分**開 PowerShell：

    ```powershell
    certutil -addstore -f Root open-pets-ca.crt
    ```

    或雙擊 `open-pets-ca.crt` → 安裝憑證 → 本機電腦 → 選「將所有憑證放入以下的存放區」→ 受信任的根憑證授權單位。Chrome 與 Edge 使用 Windows 的憑證存放區，裝好後重開瀏覽器即可。公司有網域時，可用群組原則一次佈署到所有電腦。
    {{< /tab >}}
    {{< tab name="macOS" >}}
    ```bash
    sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain open-pets-ca.crt
    ```
    {{< /tab >}}
    {{< tab name="Firefox" >}}
    Firefox 有自己的憑證存放區：設定 → 隱私權與安全性 → 憑證 → 檢視憑證 → 憑證機構 → 匯入 `open-pets-ca.crt`，勾選「信任這個 CA 來識別網站」。
    {{< /tab >}}
    {{< /tabs >}}

3. 使用者開啟 `https://192.168.1.20`，網址列應顯示鎖頭，出現登入頁。**網址要換成你自己的**：就是 [9-1](#9-1-先決定使用者輸入的網址) 填進 `OPEN_PETS_ALLOWED_HOSTS` 的其中一個（用小工具則是 `mode lan -Hosts` 帶的值）。**一定要打 `https://`**，只打 IP 會走 `http://`（80 埠沒有服務）而逾時；輸入清單裡沒有的網址，會得到 400 `Invalid host header` 或憑證名稱不符。

{{< callout type="warning" >}}
**根憑證的私鑰在主機的 `caddy-data` 磁碟區，請當作機密保管，也要一起備份。** 主機換新、重裝或 `caddy-data` 遺失後，Caddy 會產生新的根憑證，所有使用者電腦都得重新信任。**不要把根憑證放到網際網路上讓人下載安裝**，信任它的電腦會相信這個 CA 簽發的任何憑證。
{{< /callout >}}

### 9-5. 憑證的更新

Caddy 簽發的內網憑證預設有效期約 12 小時，容器運行中會自動續期，不用處理；根憑證有效期約 10 年。只要 `proxy` 容器一直在運行（`restart: unless-stopped` 已設定），使用者不會遇到憑證過期。

### 不用 HTTPS 的簡化做法（不建議）

只在可信任、隔離的內網做測試時才用。帳號密碼與資料會以明文在內網傳輸，瀏覽器在非 HTTPS 網址也會停用部分功能（例如設定檔頁的「複製 JSON」按鈕）。在 `.env` 設定（不使用 `docker-compose.lan.yml`，所以沒有 Caddy 容器）：

```text
OPEN_PETS_MODE=lan
OPEN_PETS_BIND=0.0.0.0
OPEN_PETS_ALLOWED_HOSTS=192.168.1.20
```

防火牆開放 8080，使用者開 `http://192.168.1.20:8080`，再執行：

```powershell
docker compose up -d
```

### 9-6. 線上模式（online）：對外網域

不建議把系統直接放到網際網路。必須以對外網域提供服務時，用**線上模式**，並在前面放有正式憑證的反向代理（交付包附 `Caddyfile.example` 與 `nginx.conf.example`，原始碼在 `docker/proxy-examples/`，都已實測過 HTTPS 下的完整流程）：

1. 在 `.env` 設定對外網域（使用者會輸入的網址，逗號分隔、不加空格）：

    ```text
    OPEN_PETS_ALLOWED_HOSTS=pets.example.com
    ```

2. 用線上模式啟動（應用程式的 8080 仍只綁本機，由反向代理轉送到 `127.0.0.1:8080`）：

    ```powershell
    docker compose -f docker-compose.yml -f docker-compose.online.yml up -d
    ```

3. 設定反向代理（把範例裡的 `openpets.example.com` 換成你的網域），並確認：
    - 把 `Host` 標頭**原樣轉送**，否則會被主機名稱檢查擋掉。
    - 允許大檔案上傳（預設上限 1024 MB），不要先緩衝整個請求本文。
    - 逾時設長一點，大檔案的處理時間可能很久。
    - 在代理層加上 `Strict-Transport-Security`（範例已加）。

漏列的網域連進來會得到 400（`Invalid host header`）。容器自己健康檢查用的 `127.0.0.1`、`localhost` 不需要列。用 Cloudflare Tunnel 等通道時，把通道目標設為 `http://localhost:8080`（作法見《Demo 展示環境建置與維運手冊（cloudflared 通道＋內網測試）》）。

## 10. 更新與退回

資料與金鑰都在磁碟區 `open-pets-data`，換映像檔不會遺失。**用小工具最簡單：** `.\open-pets.ps1 update 新版本號`（更新前自動備份）。手動做法：

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

**退回舊版：** 把 `OPEN_PETS_VERSION` 改回舊版，再 `docker compose up -d`（舊映像檔還在本機就不用重新取得）。

版本一律指定明確的版號，不使用 `latest`（交付包與 GHCR 都不提供），避免無意間升級。

## 11. 備份與還原

需要備份的只有磁碟區 `open-pets-data`：帳號資料庫、處理紀錄、稽核紀錄與自動產生的金鑰。**用小工具最簡單：** `.\open-pets.ps1 backup`。手動做法如下。

{{< callout type="warning" >}}
**金鑰與稽核紀錄是一組的，要一起備份，並當作機密保管。** 鹽值（`OPEN_PETS_DEFAULT_SALT`）遺失或變更後，新的雜湊結果就對不上以前的資料；簽章金鑰（`OPEN_PETS_SYSTEM_MASTER_KEY`）變更後，舊的稽核紀錄無法再驗證。內網模式另外要備份 `caddy-data`（根憑證的私鑰）。
{{< /callout >}}

下面用映像檔本身執行 `tar`（不用另外下載映像檔，離線環境也能用）。磁碟區的實際名稱以 `docker volume ls` 為準，用 compose 啟動時是 `open-pets_open-pets-data`。指令裡的映像檔 `open-pets-app:<版本>`，用方式一（GHCR）時請換成 `ghcr.io/ttcdog115016/open-pets-app:<版本>`。

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

**還原**（到新的磁碟區或新主機；先 `docker compose down`，舊的磁碟區不要沿用）：

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

還原後登入網頁，並執行 `docker exec open-pets python /opt/openpets/openpets_server.py verify-log`，確認稽核紀錄驗證通過。

## 12. 驗證映像檔來源

映像檔由本專案的 GitHub Actions 建置，並用 cosign 簽署（無金鑰簽章）。Release 說明裡有該版本的映像檔 digest 與驗證指令。驗證要能連到 Sigstore。

**不想安裝 cosign：用 Docker 執行（建議）。** 把 `sha256:<digest>` 換成 Release 說明裡的 digest：

```powershell
docker run --rm gcr.io/projectsigstore/cosign:latest verify "ghcr.io/ttcdog115016/open-pets-app@sha256:<digest>" --certificate-identity-regexp '^https://github.com/ttcdog115016/Demo/\.github/workflows/docker-image\.yml@refs/tags/v' --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

看到 `The following checks were performed on each of these signatures`，且輸出裡有 `"githubWorkflowRepository":"ttcdog115016/Demo"` 與你要的版本標籤，就通過。出現 `no matching signatures` 等錯誤，**不要使用**該映像檔。

**已安裝 [cosign](https://docs.sigstore.dev/cosign/system_config/installation/)**（Windows 可用 `winget install sigstore.cosign`）：

```bash
cosign verify ghcr.io/ttcdog115016/open-pets-app@sha256:<digest> \
  --certificate-identity-regexp '^https://github.com/ttcdog115016/Demo/\.github/workflows/docker-image\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

**驗證離線包的 `SHA256SUMS.txt`**（先把 `SHA256SUMS.txt` 和 `SHA256SUMS.txt.sigstore.json` 放在目前資料夾；檔案可從 Release 下載）：

```powershell
docker run --rm -v "${PWD}:/w" -w /w gcr.io/projectsigstore/cosign:latest verify-blob --bundle SHA256SUMS.txt.sigstore.json --certificate-identity-regexp '^https://github.com/ttcdog115016/Demo/\.github/workflows/docker-image\.yml@refs/tags/v' --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS.txt
```

看到 `Verified OK` 就通過。確認清單沒被換掉後，再用 `Get-FileHash` 或 `sha256sum -c` 核對各檔案。

- 完全隔離的環境無法驗證簽章，以 `SHA256SUMS.txt`（另一條管道取得的檢查碼）為準。
- 簽章會記在公開的 Sigstore 透明日誌，其中包含本專案的 GitHub 帳號與 repo 名稱。

## 13. 授權與原始碼

- 本軟體（前端與後端程式碼）為 MIT 授權，全文見 `LICENSE`（後端另見 `backend/LICENSE`）。
- 映像檔含開源第三方元件，授權與取得原始碼的方式見 `THIRD_PARTY_NOTICES.txt`（Python 套件）與 `FRONTEND_THIRD_PARTY_LICENSES.md`（前端套件）。同樣的檔案也在映像檔內：`docker exec open-pets ls /licenses`。
- 其中 fpdf2（LGPL-3.0）以原始碼檔形式存在映像檔內，certifi（MPL-2.0）未經修改。要替換這些元件或自行重建，請依 `REBUILD.md`。全部原始碼都在 `open-pets-source_<版本>.zip`。
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
- [ ] GHCR 映像檔位置會跟著帳號改變（`ghcr.io/<新擁有者小寫>/open-pets-app`）。使用者的 `.env` 要把 `OPEN_PETS_IMAGE` 改成新位置；文件、Release 說明裡的網址與 cosign 驗證指令的 repo 名稱也要一併更新。
- [ ] 重新建置時用 `OPEN_PETS_SOURCE_URL` 指向新的 repo（工作流程會自動帶入）。
- [ ] 新帳號下的 GHCR 套件可見度：公開的可匿名 `docker pull`，私有的要用 GitHub 的 `read:packages` 權限登入。
- [ ] 部署主機執行 `git remote set-url origin <新網址>`，之後 `git pull` 才會抓新位置。

## 15. GitHub Actions 自動化

repo 的 `.github/workflows/` 有三個工作流程：

| 工作流程 | 觸發 | 內容 |
| --- | --- | --- |
| `ci.yml` | 推送或發 Pull Request 到 `main`、`master`、`feature/backend-v2-integration` | 前端 `npm ci`、型別檢查與打包、`vitest`；後端 `uv sync --locked`、`pytest` |
| `docker-image.yml` | 推送 `v*` 標籤（手動執行只做建置與打包，不發佈） | 建置映像檔 → Trivy 弱點掃描（有可修補的高風險就失敗）→ 冒煙測試（本地、`offline` 舊名稱、線上、內網，並確認不合法的模式值會被拒絕）→ 推送 GHCR → cosign 簽章 → 產生離線交付包 → 建立 Release |
| `pages.yml` | `doc_site/` 有修改並推送到 `main` | 建置並發佈本文件網站 |

- 結果在 repo 的 **Actions** 分頁：綠色勾勾代表通過；紅色叉叉點進去可看失敗的步驟與訊息。
- **發新版：** 在要發版的 commit 建立標籤並推送，例如 `v2.0.0`。版本含連字號（如 `2.0.0-rc3`）會被標為預發版。GHCR 映像檔、離線 tar.gz 與 Release 都由同一次建置產生，內容相同。**標籤一旦有對應的 Release 或映像檔，就不要刪除或改指別處，需要重發請改用新版本號。**
- 只使用 GitHub 內建的 `GITHUB_TOKEN`，不需要另外設定密碼或金鑰。

### 本文件網站

本網站的原始檔在 repo 的 `doc_site/`（Hugo＋Hextra 主題），由 `pages.yml` 自動發佈：

- `doc_site/` 有修改並推送到 `main` 後，GitHub 會自動建置並更新網站，約 1–2 分鐘。也可以在 Actions 分頁手動執行「Deploy docs site to Pages」。
- 第一次使用前，請到 repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
- 本機預覽：安裝 Hugo extended（`winget install Hugo.Hugo.Extended`），clone 時加 `--recurse-submodules` 取得主題，在 `doc_site` 資料夾執行 `hugo server`，開 http://localhost:1313/Demo/ 。

## 16. 疑難排解

安裝或使用時遇到的錯誤（埠被占用、400、413、容器不健康、校驗碼對不上等）與處理方式，見[常見問題](../faq/#部署與連線)。
