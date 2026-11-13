# Open-PETs 安裝說明（離線交付包／Docker）

Open-PETs 是資料去識別化工具（K-匿名化與差分隱私）。前端網頁與後端服務在**同一個映像檔 `open-pets-app`、同一個容器、同一個埠（8080）**，不用另外裝 nginx、Python 或 Node.js。所有運算都在你的主機上進行，資料不會傳到其他地方。

完整圖文教學（含畫面說明與疑難排解）在網站：**https://ttcdog115016.github.io/Demo/docs/quickstart/**

## 一、最快上手（用附的小工具）

資料夾裡的 `open-pets.ps1`（Windows）與 `open-pets.sh`（Linux）用問答幫你安裝與切換模式，不用自己改設定檔。

**準備：** 已安裝 Docker Desktop（Windows）或 Docker Engine（Linux），並且開著（Windows 左下角顯示綠色 Engine running）。

**Windows：** 在這個資料夾開啟 PowerShell（資料夾空白處按住 Shift＋右鍵 →「在此處開啟 PowerShell 視窗」），執行：

```powershell
.\open-pets.ps1 setup
```

出現「已停用指令碼執行」時，改成：`powershell -ExecutionPolicy Bypass -File .\open-pets.ps1 setup`（只對這一次有效）。

**Linux：** `./open-pets.sh setup`（第一次先 `chmod +x open-pets.sh`）。

工具會問你要用哪種模式、要不要建立管理員，**照畫面回答**。之後常用指令：

| 我想要 | 指令（Linux 把 `.\open-pets.ps1` 換成 `./open-pets.sh`） |
|---|---|
| 切換模式（資料不會不見） | `.\open-pets.ps1 mode local`、`mode lan` |
| 看目前模式、狀態與網址 | `.\open-pets.ps1 status` |
| 停止／重新啟動 | `.\open-pets.ps1 stop`、`.\open-pets.ps1 start` |
| 建立管理員／忘記管理員密碼 | `.\open-pets.ps1 create-admin`、`.\open-pets.ps1 reset-password` |
| 備份 | `.\open-pets.ps1 backup` |
| 更新到新版 | `.\open-pets.ps1 update 新版本號` |
| 給同事憑證與說明（內網） | `.\open-pets.ps1 export-ca` |
| 看日誌、看全部指令 | `.\open-pets.ps1 logs`、`.\open-pets.ps1 help` |

工具只寫同資料夾的 `.env`、需要時下載缺少的設定檔、呼叫 `docker compose`，**不會修改系統設定**。

## 二、兩種模式

同一個映像檔，用環境變數 `OPEN_PETS_MODE` 選模式，預設是本地。**不確定就先選本地**，之後一行指令就能切換。

| | 本地（預設） | 內網 |
|---|---|---|
| `OPEN_PETS_MODE` | `local`（舊值 `offline` 仍接受，視為 `local`） | `lan` |
| 誰用 | 只有這台電腦 | 同一個內網的多台電腦 |
| 網址 | `http://localhost:8080` | `https://內網IP或主機名稱` |
| HTTPS | 不需要 | 內建 Caddy HTTPS（私有 CA，使用者電腦要信任根憑證） |
| 必填設定 | 無 | `.env` 的 `OPEN_PETS_ALLOWED_HOSTS=內網IP,主機名稱` |
| 啟動指令（不用小工具時） | `docker compose up -d` | `docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d` |
| 「系統維運日誌」分頁 | 隱藏 | 顯示（管理員） |

- 兩種模式的資料、帳號、稽核紀錄與金鑰格式相同，可直接切換，資料磁碟區不變。
- `OPEN_PETS_MODE` 填了 `local`、`offline`、`lan` 以外的值，容器會在啟動時報錯並結束，不會悄悄退回預設。
- **線上（`online`）模式已在 `2.0.0-rc5` 移除**：設成 `online` 一樣會拒絕啟動，並提示改用 `lan` 或 `local`。原本用線上模式的資料夾，執行 `.\open-pets.ps1 mode lan -Hosts 內網IP`（或 `mode local`）即可，資料不會不見；不想用內網 HTTPS 又要給其他電腦用的話，請改在前面自備反向代理，並由你自己承擔對外開放的安全責任（本專案不再提供範例與支援）。
- 內網沒設 `OPEN_PETS_ALLOWED_HOSTS` 時，`docker compose` 會直接報錯，不會啟動。
- `local`、`lan` 與 `docker-compose.lan.yml`、小工具要 **2.0.0-rc3 起**的版本才有。

### 內網模式要注意

- `OPEN_PETS_ALLOWED_HOSTS` 要列出使用者會輸入的**每個**網址（逗號分隔、不加空格）。清單裡的**第一個 IP** 是沒送主機名稱的連線所用的預設憑證。
- 主機防火牆要開 443（`OPEN_PETS_HTTPS_PORT` 可改）。工具會印出要執行的指令。
- **每台使用者電腦要信任根憑證**：在主機執行 `.\open-pets.ps1 export-ca`，把 `open-pets-ca.crt` 與 `open-pets-colleague-guide.txt` 交給使用者照做。
- **使用者的網址一定要打 `https://`**。只打 IP 會走 `http://`，畫面會一直轉圈後顯示「回應時間過長」。
- **換了網路、IP 變了**：執行 `.\open-pets.ps1 mode lan -Hosts 新IP,舊IP`。根憑證不變，使用者不用重新信任。
- 根憑證的私鑰在 `caddy-data` 磁碟區，請當作機密並一起備份。
- 離線環境要先帶 Caddy 映像檔：`docker pull caddy:2.11.9`、`docker save`，到主機 `docker load`。

## 三、手動安裝（不用小工具）

### 離線：用交付包

1. **核對完整性**：`SHA256SUMS.txt` 的檢查碼要與另一條管道取得的一致。
   - PowerShell：`Get-FileHash .\open-pets-app_<版本>.tar.gz -Algorithm SHA256`
   - Linux：`sha256sum -c SHA256SUMS.txt`
2. **匯入映像檔**：`docker load -i open-pets-app_<版本>.tar.gz`（不用先解壓縮）
3. **設定版本**：把 `env.example` 複製成 `.env`（內容是 `OPEN_PETS_VERSION=<版本>`）。
4. **啟動**：`docker compose up -d`
5. **建立第一個管理員**（互動輸入，密碼不會留在指令歷史）：
   ```
   docker exec -it open-pets python /opt/openpets/openpets_server.py create-admin
   ```
6. 瀏覽器開 http://localhost:8080 ，用剛建立的帳號登入。

### 有網路：從 GHCR 取得

在 `.env` 寫兩行：`OPEN_PETS_IMAGE=ghcr.io/ttcdog115016/open-pets-app` 與 `OPEN_PETS_VERSION=<版本>`，然後 `docker compose pull`、`docker compose up -d`。套件若是私有的，先 `docker login ghcr.io -u <GitHub 帳號>`（需要 GitHub 的 `read:packages` 權限）。版本一律指定明確版號，**不使用 `latest`**。

### 原始碼

`open-pets-source_<版本>.zip` 含全部原始碼（前端與 `backend/`），重新建置與替換第三方元件見 `REBUILD.md`。

三種管道拿到的是同一個版本。要確認映像檔對應的原始碼 commit：
`docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' open-pets-app:<版本>`

## 四、驗證映像檔來源

映像檔由本專案的 GitHub Actions 建置並用 cosign 簽署。**不用安裝 cosign，用 Docker 執行**（要能連網；`<digest>` 見該版 Release 說明）：

```powershell
docker run --rm gcr.io/projectsigstore/cosign:latest verify "ghcr.io/ttcdog115016/open-pets-app@sha256:<digest>" --certificate-identity-regexp '^https://github.com/ttcdog115016/Demo/\.github/workflows/docker-image\.yml@refs/tags/v' --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

看到 `The following checks were performed on each of these signatures` 就通過；出現 `no matching signatures` 就**不要使用**該映像檔。

交付包內若有 `SHA256SUMS.txt.sigstore.json`，可在放有這兩個檔的資料夾驗證檢查碼清單沒被換掉：

```powershell
docker run --rm -v "${PWD}:/w" -w /w gcr.io/projectsigstore/cosign:latest verify-blob --bundle SHA256SUMS.txt.sigstore.json --certificate-identity-regexp '^https://github.com/ttcdog115016/Demo/\.github/workflows/docker-image\.yml@refs/tags/v' --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS.txt
```

完全隔離的環境無法驗證簽章，以 `SHA256SUMS.txt`（另一條管道取得）為準。

## 五、升級與退回

資料與金鑰都在 `open-pets-data` 磁碟區，換映像檔不會遺失。**最簡單：** `.\open-pets.ps1 update 新版本號`（更新前自動備份）。

手動：把 `.env` 的 `OPEN_PETS_VERSION` 改成新版本；離線要先 `docker load -i` 新的 tar.gz，有網路則 `docker compose pull`；然後 `docker compose up -d`。**退回**：把版本改回舊的再 `docker compose up -d`。

## 六、備份與還原

**最簡單：** `.\open-pets.ps1 backup`（備份檔在資料夾的 `backups`）。

要備份的是 `open-pets-data` 磁碟區。**金鑰與稽核紀錄是一組的，要一起備份、當作機密保管**：`OPEN_PETS_DEFAULT_SALT` 遺失或變更，之後的雜湊結果就對不上以前的資料；`OPEN_PETS_SYSTEM_MASTER_KEY` 變更，舊稽核紀錄無法驗證。內網模式另外要備份 `caddy-data`。

手動備份與還原（用映像檔本身的 `tar`，離線環境也能用；磁碟區名稱以 `docker volume ls` 為準）：

```
# 備份（先停服務，避免寫到一半）
docker compose stop
docker run --rm --user root --entrypoint tar -v open-pets_open-pets-data:/data -v "${PWD}:/backup" open-pets-app:<版本> czf /backup/open-pets-data.tgz -C /data .
docker compose start

# 還原到新的磁碟區（先 docker compose down）
docker volume create open-pets_open-pets-data
docker run --rm --user root --entrypoint sh -v open-pets_open-pets-data:/data -v "${PWD}:/backup" open-pets-app:<版本> -c "tar xzf /backup/open-pets-data.tgz -C /data && chown -R 10001:10001 /data"
docker compose up -d
```

還原後執行 `docker exec open-pets python /opt/openpets/openpets_server.py verify-log`，確認稽核紀錄驗證通過。

## 七、金鑰

預設第一次啟動會自動產生三把金鑰，存在 `/data/.secrets.env`（權限 600）。要把金鑰與資料分開保管，在 `.env` 填 `OPEN_PETS_DEFAULT_SALT`、`OPEN_PETS_SYSTEM_MASTER_KEY`、`OPEN_PETS_JWT_SECRET`（各 64 字元隨機字串，環境變數優先）。產生方式：

```
docker run --rm open-pets-app:<版本> python -c "import secrets; print(secrets.token_hex(32))"
```

## 八、維護指令

```
docker exec -it open-pets python /opt/openpets/openpets_server.py reset-password   # 忘記密碼
docker exec -it open-pets python /opt/openpets/openpets_server.py verify-log ...   # 驗證稽核紀錄簽章
docker exec -it open-pets python /opt/openpets/openpets_server.py --help-cli       # 後端 CLI 說明
docker logs open-pets                                                              # 服務日誌
```

容器名稱以 `docker ps` 為準。API 互動文件：http://localhost:8080/docs

## 九、安全設定

| 項目 | 設定 |
|---|---|
| 對外埠 | 預設只綁 `127.0.0.1`。要讓其他電腦連入，用內網模式（內建 HTTPS）；不要直接以明文 HTTP 開放 |
| 允許的網址 | `OPEN_PETS_ALLOWED_HOSTS`（防 DNS rebinding） |
| 容器身分 | 非 root（uid 10001）；根檔案系統唯讀；`cap_drop: ALL`；`no-new-privileges` |
| 可寫位置 | 只有 `/data`（含上傳暫存 `/data/tmp`） |
| 映像檔內容 | 不含 node、uv、建置工具、開發機的帳號資料庫或稽核紀錄 |

## 十、疑難排解

| 你看到 | 怎麼辦 |
|---|---|
| 網頁打不開 | `.\open-pets.ps1 status` 看網址與狀態；`docker ps` 的 STATUS 應為 `healthy`；`docker logs open-pets` 看錯誤 |
| 「已停用指令碼執行」 | `powershell -ExecutionPolicy Bypass -File .\open-pets.ps1 指令` |
| 登入頁沒有帳號可用 | 還沒建立管理員：`.\open-pets.ps1 create-admin` |
| `port is already allocated` | 8080 被占用。在 `.env` 加 `OPEN_PETS_PORT=8081`（任一空的埠）再 `docker compose up -d`，網址改用該埠 |
| 內網一直轉圈、`ERR_CONNECTION_TIMED_OUT` | 網址要打完整的 `https://IP`；再檢查防火牆 443、同一個網路（手機熱點常隔離裝置） |
| 內網「您的連線不是私人連線」 | 使用者還沒信任根憑證，照 `open-pets-colleague-guide.txt` 做 |
| 上傳大檔失敗 | 預設上限 1024 MB（`OPEN_PETS_MAX_UPLOAD_MB`），前端也限制 1024 MB，要改需一起改 |

## 十一、授權與原始碼

- 本軟體（前端與後端程式碼）為 MIT 授權，全文見 `LICENSE`。
- 映像檔含開源第三方元件，授權與取得原始碼的方式見 `THIRD_PARTY_NOTICES.txt`（Python 套件）與 `FRONTEND_THIRD_PARTY_LICENSES.md`、`FRONTEND_LICENSES_FULLTEXT.txt`（前端套件清單與授權全文）。同樣的檔案也在映像檔內：`docker exec open-pets ls /licenses`。
- fpdf2（LGPL-3.0）以原始碼檔形式存在映像檔內，certifi（MPL-2.0）未經修改。要替換這些元件或自行重新建置，請依 `REBUILD.md`；全部原始碼在 `open-pets-source_<版本>.zip`。
- `image-sbom.cdx.json` 是映像檔（作業系統與 Python 套件）的軟體物料清單（CycloneDX），可匯入弱點管理工具；前端 npm 套件的物料清單是 `frontend-sbom.cdx.json`；內網模式用的 Caddy 是另外的映像檔，不在這兩份裡。
