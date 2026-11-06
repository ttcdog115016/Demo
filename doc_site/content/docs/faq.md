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
| `docker` 指令出現 `error during connect` | Docker Desktop 沒有啟動。開啟 Docker Desktop，等左下角顯示 Engine running |
| 網頁開得起來，但登入或處理時出現 502 Bad Gateway | 後端沒有啟動。執行 `docker ps` 確認 `open-pets` 是 `Up`，再執行 `curl.exe http://127.0.0.1:8000/` |
| 登入時出現 503 | `.env` 沒有 `OPEN_PETS_JWT_SECRET`，或 `.env` 有 BOM 導致第一行讀不到。依第 4-2 節的指令重寫（保留原本的鹽值），再 `docker restart open-pets` |
| 出現 400 Invalid host header | `OPEN_PETS_ALLOWED_HOSTS` 漏列了使用者用的主機名稱，見第 8 節 |
| 上傳時出現 413 | 檔案超過上傳上限（預設 1 GB）。可調整 `.env` 的 `OPEN_PETS_MAX_UPLOAD_MB`，但前端 nginx 也限制 1024 MB |
| `port is already allocated` | 8080 或 8000 已被其他程式使用。前端可改用其他埠，例如 `-p 9080:8080`，網址跟著改成 `:9080` |
| 容器名稱已存在（`Conflict. The container name ... is already in use`） | 先 `docker rm -f <容器名稱>` 再重新 `docker run`。後端容器刪除前請確認資料都在 `C:\open-pets-data` |
| 想看錯誤訊息 | `docker logs --tail 100 open-pets`（後端）或 `docker logs --tail 100 open-pets-web`（前端） |
| 忘記管理員密碼或帳號被鎖定 | 在主機執行下面的指令重設密碼（同時解除鎖定）：<br>`docker exec open-pets python -c "from app.governance.auth import get_auth_manager as g; g().reset_password('admin@example.com', '<新密碼>')"` |
