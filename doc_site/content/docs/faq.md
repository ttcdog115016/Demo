---
title: 常見問題
weight: 7
---

## 使用時

| 狀況 | 怎麼辦 |
| --- | --- |
| 忘記密碼，或帳號被鎖住 | 請管理員在「系統設定 → 帳號與權限管理」重設密碼，同時會解除鎖定。**管理員自己**忘記密碼，見下方「部署與連線」。 |
| 登入失敗太多次 | 180 秒內失敗 5 次會鎖定 15 分鐘，期間密碼正確也無法登入。等時間過去，或請管理員重設密碼。 |
| 操作到一半被登出 | 閒置超過管理員設定的時間會自動登出，重新登入即可。登出時會清除工作區與已上傳的檔案。 |
| 上傳失敗 | 確認是 CSV 或 Excel、不超過 1 GB、最多 50 個欄位。CSV 中文亂碼時，系統會自動轉換 Big5 等編碼。 |
| 按「下一步」沒反應 | 有必填設定沒完成，畫面右下角會說明原因。例如 K-匿名化至少要有 1 個敏感欄位。 |
| 運算很久或出現逾時 | ε 很小又用含 δ 的模式時會跑很久。後端一次只做一個運算，其他人的請求會排隊。請等幾分鐘再按，不要連續重按。 |

## 部署與連線

遇到問題先執行 `.\open-pets.ps1 status`（Linux：`./open-pets.sh status`）。它會告訴你目前的模式、容器是否正常，以及正確的網址。

### 安裝與工具

| 你看到 | 原因與怎麼辦 |
| --- | --- |
| 「因為這個系統上已停用指令碼執行」 | Windows 預設不讓下載來的指令檔直接執行。改用 `powershell -ExecutionPolicy Bypass -File .\open-pets.ps1 setup`（只對這一次有效，不改系統設定）。 |
| 「Docker 沒有在執行」，或 `error during connect`、`failed to connect to the docker API` | Docker Desktop 沒開，或剛開還沒就緒。開啟 Docker Desktop，等左下角顯示 Engine running，再執行 `docker version` 確認有 Server 版本後重試。 |
| 工具說「這台電腦上已經有一個叫 open-pets 的容器…新的會改叫…」 | 不是錯誤。這台電腦之前裝過舊版，工具已自動避開，不會動到舊的。用 `status` 看新的網址與埠。 |
| 工具說「8080 埠已經有別的程式在用，改用 8081」 | 不是錯誤。網址改用工具印出的新埠，例如 `http://localhost:8081`。手動安裝時，在 `.env` 加 `OPEN_PETS_PORT=8081` 再 `docker compose up -d`（`port is already allocated` 也是這個原因）。 |
| 登入頁沒有帳號可用 | 還沒建立管理員。執行 `.\open-pets.ps1 create-admin`（手動安裝：`docker exec -it open-pets python /opt/openpets/openpets_server.py create-admin`），見[安裝教學第 7 節](../deploy/#7-啟動後建立管理員並確認)。 |
| 忘記管理員密碼，或管理員被鎖住 | 在主機執行 `.\open-pets.ps1 reset-password`（手動安裝：`docker exec -it open-pets python /opt/openpets/openpets_server.py reset-password`），會同時解除鎖定。 |
| 容器一直是 `starting`、`unhealthy`，或啟動後馬上結束 | 先看日誌：`.\open-pets.ps1 logs`（手動：`docker logs --tail 100 open-pets`）。常見原因：`OPEN_PETS_MODE` 填了 `local`、`offline`（等同 `local`）、`lan` 以外的值（**`online` 已移除**，容器會說明要改用 `lan` 或 `local`）；`local`、`lan` 要 **2.0.0-rc3 起**的映像檔才認得；內網模式的 `OPEN_PETS_ALLOWED_HOSTS` 設錯。剛啟動約 40 秒內顯示 `starting` 是正常的。 |
| `docker compose` 回報 `required variable ... is missing a value` | 內網模式沒設 `OPEN_PETS_ALLOWED_HOSTS`。用 `mode lan -Hosts 網址` 帶入，或在 `.env` 補上。 |
| `Conflict. The container name ... is already in use` | 在安裝資料夾執行 `docker compose down`（資料在磁碟區，不會遺失），再 `docker compose up -d`。**不要加 `-v`**，那會連資料一起刪掉。 |
| 換版本後資料不見了 | 資料在磁碟區 `open-pets-data`，換映像檔不會影響。確認 `docker-compose.yml` 的專案名稱沒被改過（`name:`），並用 `docker volume ls` 看磁碟區還在不在。 |
| 想退回上一個模式 | 切換是可逆的，資料不會丟：`.\open-pets.ps1 mode 上一個模式`（local／lan）。從內網切回本地再切回來，憑證沿用，同事不用重新信任。 |

### 內網連線（同事連不上）

| 你看到 | 原因與怎麼辦 |
| --- | --- |
| 一直轉圈，最後顯示 `ERR_CONNECTION_TIMED_OUT`（回應時間過長） | **最常見：網址沒打 `https://`。** 只打 IP 時，瀏覽器會走沒有開放的 `http://`。請輸入完整的 `https://你的IP`。<br>還是不行：在使用者電腦執行 `Test-NetConnection 你的IP -Port 443`，要顯示 `TcpTestSucceeded : True`。`False` 代表網路不通，可能是主機防火牆沒開 443（`OPEN_PETS_HTTPS_PORT` 若有改，開那個埠）、主機沒開機、`open-pets-proxy-1` 容器沒在運行（用 `docker ps` 確認），或使用者的電腦不在同一個網路（**手機行動熱點、訪客網路常會隔離裝置**，連不到彼此）。 |
| `ERR_CONNECTION_REFUSED` | 同上；多半是防火牆沒開，或 HTTPS 容器沒在運行。 |
| 「您的連線不是私人連線」（`ERR_CERT_AUTHORITY_INVALID`） | 這台電腦還沒信任內網的根憑證。從主機執行 `.\open-pets.ps1 export-ca`，把 `open-pets-ca.crt` 與說明檔交給使用者，照說明安裝成「受信任的根憑證授權單位」，再重開瀏覽器。手動做法見[安裝教學 9-4](../deploy/#9-4-讓使用者電腦信任根憑證)。 |
| `ERR_SSL_PROTOCOL_ERROR`、憑證名稱不符，或連線被重設 | 使用者輸入的網址，沒有列在 `.env` 的 `OPEN_PETS_ALLOWED_HOSTS`。執行 `.\open-pets.ps1 mode lan -Hosts 網址1,網址2`（把所有會用的網址都列進去）。清單有多個 IP 時，把使用者實際用的放最前面。 |
| 400 Invalid host header | 同上：使用者輸入的網址漏列在 `OPEN_PETS_ALLOWED_HOSTS`，補上後重新套用，見[安裝教學第 9 節](../deploy/#9-開放給其他電腦內網)。 |
| **換了網路**（例如從手機熱點換到公司網路）後，原本連得上的網址連不上 | 這台電腦的 IP 變了，設定與憑證只認得舊 IP。用 `ipconfig` 查新 IP，執行 `.\open-pets.ps1 mode lan -Hosts 新IP,舊IP`。根憑證不會變，使用者不用重新信任；再 `export-ca` 讓說明檔換成新網址。 |
| 工具說「443 埠已經有別的程式在用，HTTPS 改用 8443」 | 不是錯誤。使用者的網址要加埠：`https://你的IP:8443`，防火牆也要開 8443。 |
| 切換模式後同事連不上 | 切到「本地」就只剩這台電腦能用。用 `status` 看目前模式；切回內網後記得開防火牆並 `export-ca`，見[新手快速上手](../quickstart/)。 |
| 主機重裝或換新後，所有使用者又出現憑證警告 | `caddy-data` 磁碟區（含根憑證的私鑰）沒有保留，Caddy 產生了新的根憑證。還原 `caddy-data` 的備份，或重新 `export-ca` 並讓使用者重新信任。 |

### 上傳與內網的 HTTPS 代理

| 你看到 | 原因與怎麼辦 |
| --- | --- |
| 上傳時出現 413 | 檔案超過上限（預設 1 GB，`OPEN_PETS_MAX_UPLOAD_MB`；前端也限制 1 GB，要改需一起改）。 |
| 內網模式出現 502 或 504 | 內網的 HTTPS 代理（容器名稱以 `-proxy-1` 結尾）轉不到應用程式容器。確認 `docker ps` 的 `open-pets` 是 `healthy`，在主機執行 `curl http://127.0.0.1:8080/api/v1/status`，再用 `.\open-pets.ps1 logs` 與 `docker logs <代理容器名稱>` 看原因。 |

### 下載與驗證

| 你看到 | 原因與怎麼辦 |
| --- | --- |
| `cosign` 指令找不到 | 不用安裝。改用 Docker 執行，指令見[安裝教學第 12 節](../deploy/#12-驗證映像檔來源)。 |
| `sha256sum -c` 顯示 FAILED，或 `docker load` 回報檔案損毀 | 檔案下載或複製不完整，請重新取得。檢查碼要與 `SHA256SUMS.txt`（另一條管道取得的）一致，檔名不能改。 |
| `docker pull` 回報 `denied` 或 `unauthorized` | 套件是私有的。用 GitHub 的 `read:packages` 權限登入：`docker login ghcr.io -u <GitHub 帳號>`。 |
