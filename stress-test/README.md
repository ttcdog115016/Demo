# Demo 壓力測試：4 組同時使用

這支腳本模擬 Demo 當天 4 位使用者**同時**在 Step4 按「執行」。它會送出瀏覽器實際會送的同一串 API，順序和 multipart 欄位都與 `src/features/step4_result/pipeline/*.ts` 相同。預設組合是 2 位 K-匿名、2 位差分隱私。

| 使用者 | 依序呼叫 |
|---|---|
| K-匿名 ×2 | 載入頁面 → `/api/v1/k-anonymity` → `/risk/k-anonymity`（疾病，1 輪）→ `/risk/cap`（1 輪）→ `/report` PDF |
| 差分隱私 ×2 | 載入頁面 → `/api/v1/dp` → `/risk/dp`（地區、職業各 1 輪）→ `/risk/cap`（2 輪）→ `/report` PDF |

腳本會先**各跑 1 位單人基準**，再讓 4 位同時開跑，最後算出「同時使用比單人慢幾倍」。

## 執行前

1. 啟動後端 Docker（port 8000）。
2. 啟動前端：`run_preview.bat` 或 `npm run preview`（port 5173，會把 `/api` 代理到後端）。
3. 如果要測 cloudflared 通道（最接近 Demo 現場），也要啟動 `run_tunnel.bat`，再到 `cloudflared.log` 找出 `https://xxxx.trycloudflare.com` 網址。

Node 用專案現有的版本即可，**不需要 npm install**。

## 執行

在 Demo 專案根目錄執行：

```bat
:: 1) 本機（走 vite preview 代理），5000 筆合成資料
node stress-test\stress_demo.mjs

:: 2) 走 cloudflared 通道（建議 Demo 前最後再跑一次這個）
node stress-test\stress_demo.mjs --base https://xxxx.trycloudflare.com

:: 3) 改用 Demo 當天實際要用的資料（欄位需與 configs\ 內設定一致）
node stress-test\stress_demo.mjs --csv C:\path\to\demo.csv

:: 4) 連跑 3 回合，看會不會越跑越慢或記憶體一直漲
node stress-test\stress_demo.mjs --repeat 3
```

也可以直接點兩下 `stress-test\run_stress_test.bat`，它會跑第 1 種。

## 參數

| 參數 | 預設 | 說明 |
|---|---|---|
| `--base URL` | `http://localhost:5173` | 測試目標（前端網址，API 經由它代理） |
| `--users LIST` | `kanon,kanon,dp,dp` | 每位使用者的模式，以逗號分隔；人數 = 項目數 |
| `--rows N` | `5000` | 自動產生的合成資料筆數 |
| `--csv PATH` | 無 | 改用自己的 CSV 檔（會忽略 `--rows`） |
| `--stagger MS` | `0` | 每位使用者錯開幾毫秒才開始；0 = 同一瞬間 |
| `--repeat N` | `1` | 同時使用的測試要跑幾回合 |
| `--max-sec N` | `300` | 判定 PASS 的條件：最慢一位使用者的完整流程不超過幾秒 |
| `--timeout N` | `900` | 單一請求的逾時秒數，與前端的 15 分鐘一致 |
| `--no-baseline` | | 不跑單人基準 |
| `--no-report` | | 不呼叫 `/report` 產生 PDF |
| `--no-page-load` | | 不模擬載入首頁和 JS/CSS |
| `--no-docker` | | 不用 `docker stats` 監看後端 CPU 和記憶體 |
| `--user` / `--password` | `owner@test.com` / `Owner@123456` | 處理端點須登入，以此帳號取得 token（也可用環境變數 `STRESS_USER`、`STRESS_PASSWORD`） |

## 結果

結果檔會寫到 `stress-test\results\`：

- `stress_report_*.md`：結論（PASS/FAIL）、單人基準對照同時使用的時間、每位使用者每個步驟的耗時、每支 API 的中位數/P90/最大值，以及容器 CPU 和記憶體峰值。
- `stress_raw_*.json`：原始數據。
- `demo_stress_*.csv`：這次用的合成資料（全部是假資料）。

全部成功時 exit code 為 0，任何一位失敗則為 1。

## 怎麼看結果

- **出現 `socket hang up`、`ECONNRESET`、502/504**：後端在同時處理請求時斷線或重啟了。`preview.log` 裡已經有 `/risk/k-anonymity socket hang up` 的紀錄。這時請查看報告裡的容器記憶體峰值和 `docker logs <容器>`，常見原因是記憶體不足被 OOM kill。
- **全部成功，但變慢倍數接近 ×4**：後端是單一 worker，請求要依序排隊。Demo 時可以請大家錯開按「執行」，或請後端把 uvicorn/gunicorn 的 workers 調高。
- **變慢倍數只有 ×1～2**：後端能平行處理，4 人同時使用沒有問題。

## 設定檔

`configs\config_kanon.json` 和 `config_dp.json` 複製自專案的 `src/utils/__tests__/fixtures/backend_config_*.json`，內容是 K=5、L=2、T=0.7 與各欄的 ε 設定。如果 Demo 要用不同的欄位或參數，請在 Step3 按「匯出最終隱私設定 JSON」，再用匯出的檔案取代這兩個檔案。
