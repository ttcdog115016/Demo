---
title: 常見問題
weight: 6
---

## 使用時

| 狀況 | 處理方式 |
| --- | --- |
| 忘記密碼或帳號被鎖定 | 請管理員在「系統設定 → 帳號與權限管理」重設密碼，重設時會同時解除鎖定。管理員自己忘記密碼時，見下方「部署與連線」。 |
| 登入失敗太多次 | 180 秒內累計失敗 5 次會鎖定 15 分鐘，期間即使密碼正確也無法登入。等鎖定時間過去，或請管理員重設密碼。 |
| 操作到一半被登出 | 閒置超過管理員設定的時間會自動登出，重新登入即可。登出時會清除工作區與已上傳的檔案。 |
| 上傳檔案失敗 | 確認是 CSV 或 Excel、不超過 1 GB、最多 50 個欄位。CSV 中文亂碼時，系統會自動轉換 Big5 等編碼。 |
| 按「下一步」沒反應 | 必填設定沒通過，畫面右下角會說明原因。例如 K-匿名化至少要有 1 個敏感欄位。 |
| 運算很久或出現逾時 | ε 很小又用含 δ 的模式時會跑很久。後端一次只執行一個運算，其他人的請求會排隊。請等幾分鐘再按，不要連續重按。 |

## 部署與連線

| 狀況 | 原因與處理 |
| --- | --- |
| `docker` 指令出現 `error during connect`，或 `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`（較新版的 Docker 訊息） | Docker Desktop 沒有啟動，或剛啟動還沒就緒。開啟 Docker Desktop，等左下角顯示 Engine running，再執行 `docker version` 確認 Server 有版本資訊後重試 |
| `docker compose up` 回報 `port is already allocated` | 本機的 8080 埠已被其他程式占用。在 `.env` 加一行 `OPEN_PETS_PORT=8081`（任一空的埠），再 `docker compose up -d`，網址改用該埠 |
| 容器一直是 `starting` 或 `unhealthy`，或啟動後馬上結束 | 先看日誌：`docker logs --tail 100 open-pets`。常見原因：`OPEN_PETS_MODE` 填了 `local`、`offline`（等同 `local`）、`online`、`lan` 以外的值（容器會報錯並結束；新值 `local`、`lan` 要 2.0.0-rc2 之後的映像檔才認得）、線上或內網模式的 `OPEN_PETS_ALLOWED_HOSTS` 設錯。剛啟動約 40 秒內顯示 `starting` 是正常的。線上或內網模式沒設 `OPEN_PETS_ALLOWED_HOSTS` 時，`docker compose` 在啟動前就會報 `required variable ... is missing a value` |
| 出現 400 Invalid host header | `OPEN_PETS_ALLOWED_HOSTS` 漏列了使用者輸入的網址（IP、主機名稱或網域），補上後 `docker compose up -d`，見[安裝教學第 9 節](deploy/#9-開放給其他電腦內網與線上) |
| 內網其他電腦的瀏覽器顯示「您的連線不是私人連線」（`ERR_CERT_AUTHORITY_INVALID`） | 這台電腦還沒信任內網 HTTPS 的根憑證。從主機匯出 `open-pets-ca.crt`，在這台電腦安裝成「受信任的根憑證授權單位」，重開瀏覽器，見[安裝教學 9-4](deploy/#9-4-讓使用者電腦信任根憑證) |
| 內網其他電腦連不上（逾時）或 `ERR_CONNECTION_REFUSED` | 主機防火牆沒開 443（或你設的 `OPEN_PETS_HTTPS_PORT`）；或 `open-pets-proxy-1` 沒有在運行（`docker ps` 確認）；或網址的 IP 不對。在使用者電腦用 `Test-NetConnection <主機IP> -Port 443` 測試埠通不通 |
| 以 IP 連線時瀏覽器顯示 `ERR_SSL_PROTOCOL_ERROR` 或連線被重設 | 網址裡的 IP 沒有列在 `.env` 的 `OPEN_PETS_ALLOWED_HOSTS`，或有多個 IP 時用的不是清單裡的第一個 IP（沒送主機名稱的連線只會拿到第一個 IP 的憑證）。把使用者實際用的 IP 放在清單最前面，`docker compose up -d` |
| 啟動內網 HTTPS 時 `443` 或 `0.0.0.0:443` 回報 `port is already allocated` | 主機的 443 已被占用，在 `.env` 加 `OPEN_PETS_HTTPS_PORT=8443`，網址要加 `:8443` |
| 主機重裝或換新後，所有使用者又出現憑證警告 | `caddy-data` 磁碟區（含私有 CA 的根憑證與私鑰）沒有保留，Caddy 產生了新的根憑證。還原 `caddy-data` 的備份，或重新匯出並重新信任新的根憑證 |
| 上傳時出現 413 | 檔案超過上傳上限（預設 1 GB，`OPEN_PETS_MAX_UPLOAD_MB`）。經反向代理時，代理也有自己的上限（nginx 的 `client_max_body_size`、Caddy 的 `request_body max_size`），要一起調整 |
| 經反向代理連線時出現 502／504 | 代理轉不到容器。確認 `docker ps` 的 `open-pets` 是 `healthy`，並在主機執行 `curl http://127.0.0.1:8080/api/v1/status`；再檢查代理設定的上游位址與逾時 |
| 登入頁沒有帳號可用 | 還沒建立管理員。執行 `docker exec -it open-pets python /opt/openpets/openpets_server.py create-admin`，見[安裝教學第 7 節](deploy/#7-啟動後建立管理員並確認) |
| 忘記管理員密碼或帳號被鎖定 | 在主機執行互動式指令重設（同時解除鎖定）：`docker exec -it open-pets python /opt/openpets/openpets_server.py reset-password` |
| `sha256sum -c` 顯示 FAILED，或 `docker load` 回報檔案損毀 | 檔案下載或複製不完整，重新取得。檢查碼要與 `SHA256SUMS.txt`（另一條管道取得的）一致；檔名不能改 |
| `docker pull` 回報 `denied` 或 `unauthorized` | 套件是私有的。用有 `read:packages` 權限的 GitHub 權杖登入：`docker login ghcr.io -u <GitHub 帳號>` |
| 容器名稱已存在（`Conflict. The container name ... is already in use`） | 在安裝資料夾執行 `docker compose down`（資料在磁碟區，不會遺失），再 `docker compose up -d`。**不要加 `-v`**，那會連資料磁碟區一起刪除 |
| 換版本後資料不見了 | 資料在磁碟區 `open-pets-data`，換映像檔不會影響。確認 compose 的專案名稱沒變（安裝資料夾裡的 `docker-compose.yml` 沒改 `name:`），用 `docker volume ls` 看磁碟區是否還在 |
| 想看錯誤訊息 | `docker logs --tail 100 open-pets` |
