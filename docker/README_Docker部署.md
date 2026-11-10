# Open-PETs Docker 部署說明（前端＋後端單一映像檔）

一個映像檔 `open-pets-app:<版本>` 內含前端網頁與後端服務，同一個容器、同一個埠（8080）。不需要另外安裝 nginx、Python 或 Node.js。

## 需求
- Docker Engine 或 Docker Desktop（含 `docker compose`）
- 可用磁碟：映像檔約 1 GB；資料另計（上傳的處理暫存也放在資料磁碟區，大檔案請預留空間）

## 一、安裝（離線）
資料夾內有 `open-pets-app_<版本>.tar`、`docker-compose.yml`、`SHA256SUMS.txt`。

1. **核對完整性**：`SHA256SUMS.txt` 的檢查碼要與另一條管道取得的一致。
   - PowerShell：`Get-FileHash .\open-pets-app_2.0.2.tar -Algorithm SHA256`
   - Linux：`sha256sum -c SHA256SUMS.txt`
2. 匯入映像檔：`docker load -i open-pets-app_2.0.2.tar`
3. 啟動：`docker compose up -d`
4. 建立第一個系統管理員（互動輸入，密碼不會留在指令歷史）：
   ```
   docker exec -it open-pets python /opt/openpets/openpets_server.py create-admin
   ```
5. 瀏覽器開啟 http://localhost:8080 ，用剛建立的帳號登入。

## 二、升級
資料與金鑰都在 `open-pets-data` 磁碟區，換映像檔不會遺失。

1. 核對新版 tar 的 SHA256，`docker load -i open-pets-app_<新版本>.tar`
2. 把 `.env` 的 `OPEN_PETS_VERSION` 改成新版本（沒有 `.env` 就複製 `.env.example`）
3. `docker compose up -d`（自動以新映像檔重建容器）
4. 要退回：把 `OPEN_PETS_VERSION` 改回舊版再 `docker compose up -d`（舊映像檔還在就不必重新匯入）

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
- 上傳大檔失敗：預設上限 1024 MB（`OPEN_PETS_MAX_UPLOAD_MB`），前端也限制 1024 MB，要改需一起改
