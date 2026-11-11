# Open-PETs 功能測試說明（逐一手動測試）

本文件列出各項功能，供逐一手動測試。每個功能都附「輸入 / 輸出格式」與**可直接複製執行**的範例（範例輸入檔放在本資料夾 `docs/manual_test/`）。

> 本清單以**主要功能**為主，**不涵蓋參數檢查／錯誤情境**（欄位對不上、參數非法等驗證行為另行測試）。

---

## 前置準備

- **環境建置**（fresh clone 後先做一次）：需 Python 3.12 以上。本專案以 [uv](https://docs.astral.sh/uv/) 管理相依性，兩種安裝方式擇一：
  ```bash
  # 方式一（推薦，需先安裝 uv）：依 uv.lock 建立 .venv 並安裝相依套件
  uv sync

  # 方式二（僅用 pip）：自建虛擬環境後安裝
  python -m venv .venv
  .venv\Scripts\activate            # Windows PowerShell；macOS/Linux 為 source .venv/bin/activate
  pip install -r requirements.txt
  ```
  > 下方所有 `python ...` 與 `uvicorn ...` 指令：若用 uv，請在前面加 `uv run`（例如 `uv run uvicorn app.api.server:app --reload`）；或先啟用虛擬環境後直接執行。
- 兩種測試途徑，擇一即可：
  1. **API（建議先用這個）**：啟動伺服器後開瀏覽器互動測試。
     ```bash
     uvicorn app.api.server:app --host 127.0.0.1 --port 8000 --reload   # 啟動於 http://127.0.0.1:8000
     ```
     開 **http://127.0.0.1:8000/docs**（FastAPI 自動產生的 Swagger UI），可直接點選端點、上傳檔案、按 Execute 測試。所有 API 路徑前綴為 `/api/v1`。
  2. **CLI**：直接在終端逐一下指令（下方每個功能都有）。指令一律以 `python -m app.cli.main <子指令>` 執行，路徑相對於專案根目錄。
- **關於 salt（選填）**：假名化金鑰**只由 `.env` 的 `OPEN_PETS_DEFAULT_SALT` 提供**，指令列與 API 都無法傳入。沒設也跑得動（改為對值本身做雜湊），但兩次測試要比對得起來，建議測試前先設好：
  ```bash
  # .env（專案根目錄）
  OPEN_PETS_DEFAULT_SALT=測試用鹽值
  ```
  正式使用請填高強度隨機字串。鹽值刻意不放設定檔——設定檔會被存檔、納入版本控管並隨交付包傳遞，不該躺著機密。
- **關於參數**：`k`、抑制方式、累計預算、實驗參數、子群體條件、輸入格式等**一律寫在設定檔內**，指令列與 API 不另收這些選項。下方範例用的設定檔已備妥對應參數（如 `config_k_anonymity.json` 內的 `k: 2`）。
- **關於設定檔結構**：所有功能吃的都是**同一種大包設定檔**——根層放共通欄位
  （`version`／`dataset`／`input_format`），底下五個平行區塊各裝一種功能的設定，
  每個區塊以 `enabled` 表明這次用不用它：

  ```json
  {
    "version": "2026-08-26_10-00-00",
    "input_format": "csv",
    "preprocess":           { "enabled": false },
    "k_anonymity":          { "enabled": true,  "columns": {}, "k": 5 },
    "differential_privacy": { "enabled": false },
    "risk_attacks":         { "enabled": false },
    "risk_cap":             { "enabled": false }
  }
  ```

  **打哪個入口就取哪幾塊**：這次要跑的區塊必須開，其餘區塊開不開都不影響，
  故同一份設定檔可同時放五種處理的設定，六個入口共用。
  `enabled` 必填；整塊省略等同關閉，且本次用不到的區塊連內容都不看，
  只想跑 K-匿名的人不必為了通過驗證把其他四塊填成合法內容。
  不認識的欄位（根層、區塊內、逐欄那層）一律擋下，並指出無法辨識的欄位。
  `version` 會寫進稽核紀錄，事後查得到某次處理是用哪一版設定檔跑的。
  下方每個功能都附有備妥的範例設定檔，一個端點一份。

---

## 主要功能

### 1. K-匿名化（去識別化）
對資料做 K-匿名／l-多樣性／t-相近性的泛化與列抑制去識別。

- **輸入**：原始資料（CSV/JSON/Excel）＋設定檔（JSON，開啟 `k_anonymity` 區塊，內含各欄角色 identifier／quasi_identifier／sensitive／non_sensitive、泛化階層，以及 `k`／選填 `l`／`t`／抑制上限等整體參數）。
- **輸出**：去識別後 CSV。品質報告（抑制率、建議、已套用預設）—— CLI 以 JSON 輸出至標準輸出（操作訊息走標準錯誤，可用 `> 檔名` 只取報告）；API 放於 `X-Quality-Report` 回應標頭。兩者結構相同。
- **CLI**：
  ```bash
  python -m app.cli.main k-anonymity \
    -i docs/manual_test/sample_data.csv \
    -c docs/manual_test/config_k_anonymity.json \
    -o out_anonymized.csv
  ```
- **API**：`POST /api/v1/k-anonymity`（multipart：`file`＋`config`；`file` 可改成 `source`＋`table` 指定 SQLite 來源，二擇一）
  ```bash
  curl -X POST http://127.0.0.1:8000/api/v1/k-anonymity \
    -F "file=@docs/manual_test/sample_data.csv" \
    -F "config=@docs/manual_test/config_k_anonymity.json" \
    -o out_anonymized.csv -D headers.txt      # 品質報告在 headers.txt 的 X-Quality-Report
  ```
- **預期**：處理成功、k／l／t 檢測通過；本範例年齡被泛化成 10 歲一組、識別欄遮罩，抑制約 1 列（8.3%）。

### 2. 差分隱私（DP）
對指定欄位加入差分隱私雜訊，並回報預算消耗。

- **輸入**：原始資料＋設定檔（JSON，開啟 `differential_privacy` 區塊，內含逐欄 `type`/`epsilon_budget`/`delta_budget`/`sensitivity`）。加噪一律以整數刻度進行，數值欄的刻度由選填的 `minimum_unit` 指定（未填即 1）、日期欄由 `noise_unit` 搭 `noise_step` 指定（如 `minute` + `5` 即 5 分鐘一格）；加噪後可再以 `clipping_bounds`／`out_of_bounds_strategy`（數值欄）或 `time_clipping_bounds`／`time_out_of_bounds_strategy`（日期欄）把超出合理範圍的值收回，三種策略為 `clamp`／`wrap`／`fold`。同一個區塊內另可填選填的整體參數：`accumulated_epsilon`/`accumulated_delta`（無狀態、由呼叫方自帶累計，引擎只讀不寫，跑完須自行把報告回傳的新累計值填回設定檔）、`default_delta`。
- **輸出**：加噪後 CSV。預算報告（本次消耗／累計／逐欄明細）—— CLI 以 JSON 輸出至標準輸出；API 放於 `X-Budget-Report` 回應標頭。兩者結構相同。
- **CLI**：
  ```bash
  python -m app.cli.main dp \
    -i docs/manual_test/sample_data.csv \
    -c docs/manual_test/config_dp.json \
    -o out_dp.csv
  ```
- **API**：`POST /api/v1/dp`（multipart：`file`＋`config`；`file` 可改成 `source`＋`table` 指定 SQLite 來源，二擇一）
  ```bash
  curl -X POST http://127.0.0.1:8000/api/v1/dp \
    -F "file=@docs/manual_test/sample_data.csv" \
    -F "config=@docs/manual_test/config_dp.json" \
    -o out_dp.csv -D headers.txt              # 預算報告在 headers.txt 的 X-Budget-Report
  ```
- **預期**：年齡與生日走離散型 Laplace（報告記為 `DiscreteLaplace`）、地區走 k-RR；逐欄明細列出機制、ε/δ、實際採用的刻度與超界策略。年齡輸出落在 5 的倍數且介於 0～120，生日落在 30 天的格子上且不超出 1930-01-01～2026-12-31。

### 3. 再識別風險－三攻擊（K-匿名）
只上傳原始資料，引擎自己切 80/20、只對 80% 以 K-匿名產合成資料（syn）、20% 為真 holdout，跑指認性／連結性／推斷性三攻擊。

- **輸入**：原始資料＋一份**同時開兩塊**的設定檔——`risk_attacks`（宣告 QI／敏感角色，並填實驗參數 `n_iter`、選填 `n_repeats`／`subgroup` 等）與 `k_anonymity`（供引擎自產 syn，`k` 等 K-匿名參數填在這一塊）。兩塊各有自己的 `columns`，內容不同，須各寫一份。
- **輸出**：**JSON**（三攻擊三分數、實際評估筆數、重複輪數、處理配置回填、說明訊息）。
- **CLI**：
  ```bash
  python -m app.cli.main risk-k-anonymity \
    -i docs/manual_test/sample_data.csv \
    -c docs/manual_test/config_risk_k_anonymity.json
  ```
- **API**：`POST /api/v1/risk/k-anonymity`（multipart：`original`＋`config`；`original` 可改成 `source`＋`table` 指定 SQLite 來源，二擇一）
  ```bash
  curl -X POST http://127.0.0.1:8000/api/v1/risk/k-anonymity \
    -F "original=@docs/manual_test/sample_data.csv" \
    -F "config=@docs/manual_test/config_risk_k_anonymity.json"
  ```
- **預期**：回三攻擊分數（0~1，-1.0 代表無法評估）；小資料下連結性揭露「實際評估幾筆」。

### 4. 再識別風險－三攻擊（差分隱私）
同功能 3，唯去識別方法改為差分隱私（改開 `differential_privacy` 區塊、無需 salt）。

- **輸入**：原始資料＋一份同時開 `risk_attacks`（實驗參數、`subgroup`）與 `differential_privacy`（逐欄預算與 DP 整體參數）的設定檔。
- **輸出**：JSON（同功能 3）。
- **CLI**：
  ```bash
  python -m app.cli.main risk-dp \
    -i docs/manual_test/sample_data.csv \
    -c docs/manual_test/config_risk_dp.json
  ```
- **API**：`POST /api/v1/risk/dp`（multipart：`original`＋`config`；`original` 可改成 `source`＋`table` 指定 SQLite 來源，二擇一）
  ```bash
  curl -X POST http://127.0.0.1:8000/api/v1/risk/dp \
    -F "original=@docs/manual_test/sample_data.csv" \
    -F "config=@docs/manual_test/config_risk_dp.json"
  ```

### 5. 再識別風險－CAP 前後對比
同時上傳「原始」與「去識別後成品」兩份現成資料，引擎不做去識別，只各算一次正確歸因機率並對比（cap_before／cap_after）。

- **輸入**：原始資料＋去識別後資料＋設定檔（開啟 `risk_cap` 區塊，選填 `subgroup`，對前後兩份各以同一條件篩一次；原始資料的格式寫在根層 `input_format`、去識別後那份寫在區塊內的 `processed_format`）。
- **輸出**：JSON（`cap_before`、`cap_after`、參與計算筆數、說明）。
- **CLI**：
  ```bash
  python -m app.cli.main risk-cap \
    -i docs/manual_test/sample_data.csv \
    -p docs/manual_test/processed_data.csv \
    -c docs/manual_test/config_risk_cap.json
  ```
- **API**：`POST /api/v1/risk/cap`（multipart：`original`＋`processed`＋`config`；兩份各可改成 `original_source`＋`original_table`／`processed_source`＋`processed_table`，四種組合皆可）
  ```bash
  curl -X POST http://127.0.0.1:8000/api/v1/risk/cap \
    -F "original=@docs/manual_test/sample_data.csv" \
    -F "processed=@docs/manual_test/processed_data.csv" \
    -F "config=@docs/manual_test/config_risk_cap.json"
  ```

### 6. 資料前處理
依設定檔的清單**由上往下**對指定欄位執行去空白、截斷、錨點截斷、型態轉換、文字正規化、丟棄缺失值、預設值填充、策略填充、上下界截斷、雜湊、正則替換共 11 項功能，每一步都用當下的資料。同一欄位可在清單裡出現多次（例如左右各截斷一次就排兩列）。

- **輸入**：原始資料（CSV/JSON/Excel）＋大包設定檔（JSON/YAML，開 `preprocess` 區塊，區塊內的 `columns` 為陣列，每一列是「欄位名稱＋依序要做的動作」）。
- **輸出**：處理後的資料，沿用輸入格式。**沒有報告**——前處理只改資料、不產統計。
- **CLI**：
  ```bash
  python -m app.cli.main preprocess \
    -i docs/manual_test/sample_data.csv \
    -c docs/manual_test/config_preprocess.json \
    -o out_preprocess.csv
  ```
- **API**：`POST /api/v1/preprocess`（multipart：`file`＋`config`；`file` 可改成 `source`＋`table` 指定 SQLite 來源，二擇一）
  ```bash
  curl -X POST http://127.0.0.1:8000/api/v1/preprocess \
    -F "file=@docs/manual_test/sample_data.csv" \
    -F "config=@docs/manual_test/config_preprocess.json" \
    -o out_preprocess.csv                     # 無報告標頭，回應主體就是處理後的資料
  ```
- **預期**（範例設定檔用到 5 項功能）：姓名 → 64 字元雜湊；身分證號 → 刪去末 6 碼（`A123456789` → `A123`）；生日 → 以 `-` 為錨點只留年月（`1999-03-15` → `1999-03`）；薪資 → 上限 90000（91000／95000／110000 皆壓到 90000）；就醫次數 → 轉為浮點數（值為整數者輸出仍為 `2`）。
- **錯誤情境**：欄位名稱打錯（`ERR_PREPROCESS_COLUMN_NOT_FOUND`）、功能名稱不認得（`ERR_PREPROCESS_ACTION_UNKNOWN`）、參數不合法或跑完等於沒跑（`ERR_PREPROCESS_PARAM_INVALID`）、對字串欄用內插／平均等（`ERR_PREPROCESS_TYPE_MISMATCH`）。欄位名稱與參數都在動到資料**之前**檢查。

### 7. 產出報告（PDF）
把前述風險量測結果彙整輸出成 PDF 報告。把風險量測產出的報告 JSON 帶進來即可。

- **輸入**：三攻擊報告 JSON 與／或 CAP 報告 JSON 的**檔案路徑**（至少一包）。功能 3～5 的輸出導向存檔即可直接使用，API 端點的回傳存檔亦同。本資料夾附有範例：`example_attack_report.json`、`example_cap_report.json`，API 用的合併請求體為 `report_request.json`。
- **輸出**：PDF 檔（下載）。
- **CLI**（評估與產報告可一路走完，不需經過 API）：
  ```bash
  python -m app.cli.main risk-cap \
    -i docs/manual_test/sample_data.csv \
    -p docs/manual_test/processed_data.csv \
    -c docs/manual_test/config_risk_cap.json > cap_report.json

  python -m app.cli.main report \
    --attack-report docs/manual_test/example_attack_report.json \
    --cap-report cap_report.json \
    -o out_report.pdf -t demo-report
  ```
- **API**：`POST /api/v1/report`（JSON body：`{task_id, attack_report, cap_report}`）
  ```bash
  curl -X POST http://127.0.0.1:8000/api/v1/report \
    -H "Content-Type: application/json" \
    -d @docs/manual_test/report_request.json \
    -o out_report.pdf
  ```

---

## 治理輔助功能（非主要功能，附帶列出）

### 8. 帳號管理與登入（RBAC）

> **前置**：`/auth` 與 `/users` 兩組端點需先於 `.env` 設定 `OPEN_PETS_JWT_SECRET`，否則一律回 `503`。設定方式見專案根目錄 `README.md` 2.3 節。CLI 的 `create-user` 不受此限制。

- **建立第一個管理員（CLI）**：系統不內建任何預設帳號，第一個 `admin` 只能由此建立。
  ```bash
  python -m app.cli.main create-user -u tester -p pass1234 -r admin
  ```
  角色只收 `admin` 與 `user`（省略 `-r` 時為 `user`）。

- **登入（API）**：`POST /api/v1/auth/login`（JSON body：`{username, password}`），回 access token 與 refresh token。
  ```bash
  curl -X POST http://127.0.0.1:8000/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"tester\", \"password\": \"pass1234\"}"
  ```

- **帶 token 呼叫**：需登入的端點以 `Authorization: Bearer <access token>` 帶入。
  ```bash
  curl http://127.0.0.1:8000/api/v1/users -H "Authorization: Bearer <access token>"
  ```

- **其餘端點**：`POST /auth/refresh`（換發，舊的 refresh token 即作廢）、`POST /auth/logout`（作廢該張 refresh token）、`PATCH /auth/password`（改自己的密碼，須帶舊密碼）；帳號管理 `GET|POST /users`、`PATCH /users/{username}/role`、`POST /users/{username}/reset-password`、`PATCH /users/{username}/active`、`DELETE /users/{username}`，全部限 `admin`。

  > 註：帳號機制與上述處理功能各自獨立，**處理功能端點不需登入即可呼叫**，呼叫方式不因帳號設定而改變；角色只決定誰能管理帳號。

### 9. 審計日誌完整性校驗
校驗鏈式防篡改日誌是否遭竄改／刪除／插入。
```bash
python -m app.cli.main verify-log
```

---

## 補充說明

- 三種實務應用情境的端到端腳本用法見 `scenarios/README.md`；引擎層壓測腳本在 `benchmarks/`。
- 本清單**不含參數檢查／錯誤情境**（非法參數、欄位對不上、子群體篩空等的驗證與錯誤回應），另行測試。

---

## 附錄：範例檔清單（`docs/manual_test/`）

| 檔案 | 用途 |
|---|---|
| `sample_data.csv` | 通用原始資料（12 筆） |
| `processed_data.csv` | 去識別後成品（供功能 5 CAP） |
| `config_k_anonymity.json` | 功能 1 的設定檔：開 `k_anonymity` 區塊（含 `k: 2`） |
| `config_dp.json` | 功能 2 的設定檔：開 `differential_privacy` 區塊 |
| `config_risk_k_anonymity.json` | 功能 3 的設定檔：同時開 `risk_attacks`（含 `n_iter: 50`）與 `k_anonymity`（含 `k: 2`） |
| `config_risk_dp.json` | 功能 4 的設定檔：同時開 `risk_attacks` 與 `differential_privacy` |
| `config_risk_cap.json` | 功能 5 的設定檔：開 `risk_cap` 區塊 |
| `config_preprocess.json` | 功能 6 的設定檔：開 `preprocess` 區塊（區塊內為 `columns` 清單） |
| `example_attack_report.json` | 三攻擊報告範例（功能 7 輸入） |
| `example_cap_report.json` | CAP 報告範例（功能 7 輸入） |
| `report_request.json` | 報告端點合併請求體（功能 7 API 輸入） |
