# Open-PETs Docker 部署說明（前端＋後端單一映像檔）

一個映像檔 `open-pets-app:<版本>` 內含前端網頁與後端服務，同一個容器、同一個埠（8080）。不需要另外安裝 nginx、Python 或 Node.js。

## 三種取得方式

同一個版本的三種管道內容相同（映像檔由同一次建置產生），依環境選一種即可。

| | 容器映像檔（GHCR） | 離線安裝（tar） | 原始碼 |
|---|---|---|---|
| 適用 | 可以連網、想用 `docker pull` 更新 | 無網路或內網環境 | 想自行檢視、重新建置，或替換 fpdf2、certifi 等第三方元件 |
| 取得 | `ghcr.io/<擁有者>/open-pets-app:<版本>`（私有時需登入，見「二、升級」） | 交付包內的 `open-pets-app_<版本>.tar` | 交付包內的 `open-pets-source_<版本>.zip`，或 GitHub repo 的同一個版本 |
| 驗證 | 映像檔 digest（Release 說明）；cosign 簽章 | `SHA256SUMS.txt` | 壓縮檔註解與映像檔 label 內的 commit |
| 使用 | `docker compose pull` → `up -d` | `docker load -i` → `docker compose up -d` | 依 `REBUILD.md` 建置後同樣用 compose 啟動 |

**確認映像檔對應哪個原始碼 commit**：`docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' open-pets-app:<版本>`；原始碼壓縮檔的 commit 可用 `unzip -z open-pets-source_<版本>.zip` 或解壓縮工具的「註解」欄位查看，兩者應相同。

## 需求
- Docker Engine 或 Docker Desktop（含 `docker compose`）
- 可用磁碟：映像檔約 1 GB；資料另計（上傳的處理暫存也放在資料磁碟區，大檔案請預留空間）

## 一、安裝（離線）
資料夾內有 `open-pets-app_<版本>.tar`、`docker-compose.yml`、`docker-compose.online.yml`、`SHA256SUMS.txt`，另有授權聲明與重新建置說明（見「八、授權與原始碼」）。

1. **核對完整性**：`SHA256SUMS.txt` 的檢查碼要與另一條管道取得的一致。
   - PowerShell：`Get-FileHash .\open-pets-app_2.0.2.tar -Algorithm SHA256`
   - Linux：`sha256sum -c SHA256SUMS.txt`
   - 若交付包內有 `SHA256SUMS.txt.sigstore.json`，連網時可再驗證 `SHA256SUMS.txt` 沒被換掉：`cosign verify-blob --bundle SHA256SUMS.txt.sigstore.json --certificate-identity-regexp '^https://github.com/<擁有者>/<repo>/\.github/workflows/docker-image\.yml@refs/tags/v' --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS.txt`
2. 匯入映像檔：`docker load -i open-pets-app_2.0.2.tar`
3. 啟動：`docker compose up -d`
4. 建立第一個系統管理員（互動輸入，密碼不會留在指令歷史）：
   ```
   docker exec -it open-pets python /opt/openpets/openpets_server.py create-admin
   ```
5. 瀏覽器開啟 http://localhost:8080 ，用剛建立的帳號登入。

## 選擇模式（同一份映像檔）
離線／本機與線上共用同一份映像檔，啟動時用環境變數選模式，不需要另外建置。

| | 離線模式（預設） | 線上模式 |
|---|---|---|
| 適用 | 一台電腦或內網單一用途、無網路環境 | 多人使用、以網域對外提供服務 |
| 啟動指令 | `docker compose up -d` | `docker compose -f docker-compose.yml -f docker-compose.online.yml up -d` |
| 環境變數 | `OPEN_PETS_MODE=offline`（預設） | `OPEN_PETS_MODE=online` |
| 系統設定的「系統維運日誌」分頁 | 隱藏 | 顯示（管理員查看全站登入與 API 紀錄） |
| 登入頁 Demo 測試帳號 | 不顯示 | 不顯示（要顯示須另設 `OPEN_PETS_SHOW_DEMO_ACCOUNTS=true`，僅限展示站） |
| 對外埠 | 只綁 `127.0.0.1` | 仍只綁 `127.0.0.1`，前面放反向代理並啟用 HTTPS |
| 必填設定 | 無 | `.env` 的 `OPEN_PETS_ALLOWED_HOSTS=你的網域`（沒設定會拒絕啟動） |

- 兩種模式的資料、帳號、稽核紀錄與金鑰格式相同，可以直接切換：停止容器，改用另一個啟動指令即可，`/data` 磁碟區不變。
- `OPEN_PETS_MODE` 填了其他值，容器會在啟動時報錯並結束（`docker logs open-pets` 可看到原因），不會悄悄退回預設。
- 線上模式由反向代理終止 HTTPS；代理需把 `Host` 標頭原樣轉送、允許大檔案上傳（預設上限 1024 MB）、關閉請求緩衝。可直接改用交付包內的 `Caddyfile.example`（自動憑證）或 `nginx.conf.example`（原始碼的 `docker/proxy-examples/`），兩份都已實測過 HTTPS 下的完整流程（登入、上傳、K-匿名化、下載 CSV 與 PDF）。後端只認 `OPEN_PETS_ALLOWED_HOSTS` 內的 Host，其他網域直接連到容器會得到 400。後端不記錄用戶端 IP（稽核紀錄以帳號為準），所以不需要設定 `X-Forwarded-For` 的信任範圍。

## 二、升級
資料與金鑰都在 `open-pets-data` 磁碟區，換映像檔不會遺失。兩種取得新版的方式，同一個版本的映像檔內容相同。

**離線：用 tar**
1. 核對新版 tar 的 SHA256，`docker load -i open-pets-app_<新版本>.tar`
2. 把 `.env` 的 `OPEN_PETS_VERSION` 改成新版本（沒有 `.env` 就複製 `.env.example`）
3. `docker compose up -d`（自動以新映像檔重建容器）

**有網路：用 GitHub Container Registry（GHCR）**
1. 第一次：在 `.env` 加 `OPEN_PETS_IMAGE=ghcr.io/<擁有者>/open-pets-app`（擁有者名稱一律小寫）。如果套件是私有的，先用有 `read:packages` 權限的 token 登入：`docker login ghcr.io -u <GitHub 帳號>`。
2. 把 `.env` 的 `OPEN_PETS_VERSION` 改成新版本，執行 `docker compose pull`（只會下載有變更的層，通常遠小於整個 tar），再 `docker compose up -d`。
3. 要驗證下載的是對的版本：到 GitHub Releases 對照該版的 image digest（`docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/<擁有者>/open-pets-app:<版本>`）。
   也可以驗證映像檔確實由本專案的 GitHub Actions 建置（cosign 簽章，指令見該版 Release 說明的「驗證來源」）。需要安裝 [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) 並能連到 Sigstore；完全隔離的環境無法驗證簽章，以 SHA256 為準。簽章會記在公開的 Sigstore 透明日誌，其中包含本專案的 GitHub 帳號與 repo 名稱。
4. 版本一律指定明確的版號，不使用 `latest`（交付包與 GHCR 都不提供 `latest`），避免無意間升級。

**退回：** 把 `OPEN_PETS_VERSION` 改回舊版再 `docker compose up -d`（舊映像檔還在就不必重新取得）。

## 三、備份與還原
備份 `open-pets-data`（帳號、稽核日誌、金鑰）。**金鑰與稽核紀錄是一組的**：
- `OPEN_PETS_DEFAULT_SALT` 遺失或變更，之後的雜湊結果就和過去對不起來
- `OPEN_PETS_SYSTEM_MASTER_KEY` 變更，舊稽核紀錄無法驗證簽章

```
# 備份（先停服務以免寫入中）
docker compose stop
docker run --rm -v open-pets_open-pets-data:/data -v "${PWD}:/backup" alpine tar czf /backup/open-pets-data.tgz -C /data .
docker compose start

# 還原到新的磁碟區
docker run --rm -v open-pets_open-pets-data:/data -v "${PWD}:/backup" alpine tar xzf /backup/open-pets-data.tgz -C /data
docker run --rm -v open-pets_open-pets-data:/data alpine chown -R 10001:10001 /data
```
（磁碟區實際名稱以 `docker volume ls` 為準；沒有 alpine 映像檔的離線環境可改用 `open-pets-app` 映像檔加 `--entrypoint tar` 與 `--user root`。）

## 四、金鑰
預設第一次啟動自動產生三把金鑰，存在 `/data/.secrets.env`（權限 600）。要把金鑰與資料分開保管，在 `.env` 填入 `OPEN_PETS_DEFAULT_SALT`、`OPEN_PETS_SYSTEM_MASTER_KEY`、`OPEN_PETS_JWT_SECRET`（各 64 字元隨機字串，環境變數優先於 `.secrets.env`）。產生方式：

```
docker run --rm open-pets-app:2.0.2 python -c "import secrets; print(secrets.token_hex(32))"
```

## 五、維護指令
```
docker exec -it open-pets python /opt/openpets/openpets_server.py reset-password   # 忘記密碼
docker exec -it open-pets python /opt/openpets/openpets_server.py verify-log ...   # 驗證稽核紀錄簽章
docker exec -it open-pets python /opt/openpets/openpets_server.py --help-cli       # 後端 CLI 說明
docker logs open-pets                                                              # 服務日誌
docker inspect --format '{{.State.Health.Status}}' open-pets                       # 健康狀態
```
API 互動文件：http://localhost:8080/docs

## 六、安全設定
| 項目 | 設定 |
|---|---|
| 對外埠 | 預設只綁 `127.0.0.1`。要讓區網連入，在前面放反向代理並啟用 HTTPS；不要直接以明文 HTTP 開放 |
| 反向代理的網域 | 在 `.env` 設 `OPEN_PETS_ALLOWED_HOSTS=網域`（防 DNS rebinding） |
| 容器身分 | 非 root（uid 10001）；根檔案系統唯讀；`cap_drop: ALL`；`no-new-privileges` |
| 可寫位置 | 只有 `/data`（含上傳暫存 `/data/tmp`） |
| 回應標頭 | CSP、X-Frame-Options、X-Content-Type-Options 等與單機版相同 |
| 映像檔內容 | 不含 node、uv、建置工具、開發機的帳號資料庫或稽核紀錄 |

## 七、疑難排解
- `docker compose up` 後網頁打不開：`docker logs open-pets` 看啟動錯誤；`docker ps` 的 STATUS 應為 `healthy`
- 登入頁沒有帳號可用：尚未建立管理員，見「一、安裝」第 4 步
- `docker compose up` 回報 `port is already allocated`：本機的 8080 埠已被其他程式佔用。在 `.env` 加一行 `OPEN_PETS_PORT=8081`（任一空的埠）再 `docker compose up -d`，瀏覽器改開該埠
- 上傳大檔失敗：預設上限 1024 MB（`OPEN_PETS_MAX_UPLOAD_MB`），前端也限制 1024 MB，要改需一起改

## 八、授權與原始碼
- 本軟體（前端與後端程式碼）為 MIT 授權，全文見 `LICENSE`。
- 映像檔含開源第三方元件，其授權與取得原始碼的方式見 `THIRD_PARTY_NOTICES.txt`（Python 套件）與 `FRONTEND_THIRD_PARTY_LICENSES.md`（前端套件）。同樣的檔案也在映像檔內：`docker exec open-pets ls /licenses`。
- 其中 fpdf2（LGPL-3.0）以原始碼檔形式存在映像檔內，certifi（MPL-2.0）未經修改。要替換這些元件或自行重新建置，請依 `REBUILD.md`，全部原始碼（前端與 `backend/`）都在 `open-pets-source_<版本>.zip`。
- `image-sbom.cdx.json` 是映像檔的軟體物料清單（CycloneDX），可匯入弱點管理工具。

