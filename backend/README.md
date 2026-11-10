# Open-PETs 隱私強化技術開發工具包

本專案提供一套用於資料去識別化與隱私保護的後端引擎，核心功能包含 **K-匿名化 (K-Anonymity)** 與 **差分隱私 (Differential Privacy)**。本系統旨在協助機關處理大規模資料集，同時確保資料發布之安全性與合規性。

本文件對應之版本為 **2.0.0**(以 `pyproject.toml` 之 `version` 為準)。

## 1. 系統架構說明
本系統採模組化設計，依職責分為五層，均位於 `app/`：

*   **`app/engines/` 核心引擎**
    *   Anonymization Engine：K-匿名化處理，含泛化、遮蔽、抑制，以及 l-多樣性與 t-相近性之達標檢測。
    *   DP Engine：差分隱私機制與隱私預算之累計管理。
    *   Risk Module：再識別風險量測，含三種基準攻擊模擬與 CAP 前後對比。
    *   Preprocess Engine：資料前處理十一項功能，依設定檔清單由上往下逐欄執行。
*   **`app/api/` HTTP 介面層**：以 FastAPI 提供 17 個端點(7 個處理功能、10 個身分驗證與帳號管理)，路徑前綴為 `/api/v1`。
*   **`app/cli/` 命令列介面層**：以 Typer 提供 9 個指令，處理功能與 API 端點對等。
*   **`app/core/` 共用基礎**：多格式資料讀寫、設定檔解析與驗證、預設值決議、錯誤碼定義、系統日誌設定。
*   **`app/governance/` 資料治理**：使用者帳號與角色管理、登入與 access token、鏈式防篡改稽核軌跡、PDF 報告輸出。

## 2. 環境建置
請確保環境已安裝 Python 3.12 以上版本(專案 `requires-python = ">=3.12"`)，並依照以下步驟初始化：

```bash
# 1. 建立並啟動虛擬環境 (Windows)
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. 安裝相依套件
pip install -r requirements.txt
```

### 2.1 部署設定：假名化鹽值(.env，選填)

假名化鹽值**只由部署者於 `.env` 設定 `OPEN_PETS_DEFAULT_SALT`**，API 與 CLI 都不接受呼叫端傳入：

*   鹽值是機密。若能隨表單參數傳送，會落入反向代理與閘道器的請求記錄；若寫進設定檔，則會被存檔、納入版本控管並隨交付包傳遞。兩條路徑都不該存在，故一律由部署環境提供。
*   鹽值為選填：未設定時 `/k-anonymity` 與 `/risk/k-anonymity`(及對應的 CLI 指令)照常執行，改為對值本身做雜湊；本次有沒有加鹽，寫在品質報告的 `hash_salted` 欄位。系統**不會**退回任何寫死的預設鹽值。
*   無鹽雜湊可被字典反查(身分證號之類的有限值域尤其如此)，要不要加鹽由部署者決定。

設定步驟：

```bash
# 1. 由範本建立 .env(.env 已列入 .gitignore，切勿提交真實秘密)
cp .env.example .env

# 2. 產生高強度隨機鹽值，填入 .env 的 OPEN_PETS_DEFAULT_SALT
python -c "import secrets; print(secrets.token_hex(32))"
```

補充說明：

*   未設定時伺服器仍可正常啟動，僅於啟動時顯示提醒訊息。
*   正式環境(Docker / CI 等)可直接注入作業系統環境變數，其優先於 `.env` 檔案內容。
*   直接呼叫函式庫(`run_k_anonymity()`)時 `salt_key` 為函式參數，由呼叫者自行提供；未帶 `salt_key` 時不報錯，改為對值本身做雜湊。

### 2.1.0 雜湊演算法

假名化與雜湊遮蔽的演算法由設定檔的 `algorithm` 三選一：`sha256`、`sha3-256`、`sha3-512`(全小寫，未填為 `sha3-256`)。此為**區塊層參數**，該區塊共用、不逐欄指定；資料前處理的 `hash` 功能亦以 `preprocess` 區塊的同名欄位指定。輸出為完整的十六進位字串，不截短(前兩者 64 碼、`sha3-512` 為 128 碼)。

### 2.1.1 一份大包設定檔，五個平行區塊

全系統只吃一種設定檔：根層放共通欄位(`version`/`dataset`/`input_format`)，底下五個平行區塊 `preprocess`/`k_anonymity`/`differential_privacy`/`risk_attacks`/`risk_cap` 各裝一種功能的設定，每塊以 `enabled` 表明這次用不用它。呼叫某端點時該端點要用的區塊必須開，其餘區塊開不開都不影響——同一份設定檔可同時放五種處理的設定，六個入口共用，打哪個入口就取哪幾塊。

`k`、抑制方式、累計預算、風險實驗參數、子群體條件、輸入格式等，全部寫在設定檔(YAML/JSON)內，API 端點與 CLI 指令不另提供這些參數欄位。這樣一份設定檔就能完整重現一次處理，便於版本控管與稽核。

可直接執行的範例在 `docs/manual_test/`，一個端點一份；結構、端點對區塊的對照與各參數預設值見隨案交付之「設定檔結構與參數說明」文件。

### 2.2 部署設定：使用者帳號

系統**不內建任何預設帳號**。啟動時只建立空的使用者資料表——寫死於程式碼的帳密在部署後刪不掉(下次啟動又會重建)，等同永久存在一組公開憑證。

正式環境的第一個管理員帳號請以 CLI 建立(此指令不需登入，能在機器上執行即代表已握有主機權限)：

```bash
python -m app.cli.main create-user -u <帳號> -p <密碼> -r admin
```

第一個管理員建立後，其餘帳號可由 `POST /api/v1/users` 建立(該端點限 `admin`)。

補充說明：

*   角色只有 **`admin`** 與 **`user`** 兩種：`admin` 可管理帳號(列出、建立、改角色、重設密碼、停用、刪除)，`user` 不可。角色僅作用於帳號管理端點，不影響去識別化等處理功能。
*   密碼以 **scrypt**(Python 標準庫內建的金鑰衍生函式)儲存，每位使用者一組獨立隨機鹽值，格式為 `algo$n$r$p$salt$hash`，參數隨雜湊一併存放以利日後調整成本或更換演算法。不新增第三方相依，符合離線部署需求。
*   連續登入失敗達五次(三分鐘內)該帳號鎖定十五分鐘，期間即使密碼正確亦不放行，回應為 `423` 並以 `Retry-After` 標頭告知剩餘秒數。管理員重設該帳號密碼即同時解除鎖定。
*   測試用的兩組角色帳號(admin/user)僅由 pytest fixture 於測試期間建立於暫存資料庫，不會進入任何部署環境。

### 2.3 部署設定：登入功能簽章金鑰(.env，選用)

登入與帳號管理(`/auth` 與 `/users` 兩組端點)需要一把簽章金鑰才會啟用，由部署者於 `.env` 設定 `OPEN_PETS_JWT_SECRET`：

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

*   **未設定時服務照常啟動**，去識別化、差分隱私、風險評估與資料前處理**完全不受影響**；僅 `/auth` 與 `/users` 停用，呼叫時一律回 `503`(錯誤碼 `ERR_AUTH_DISABLED`)，訊息為「登入功能尚未啟用，請聯繫系統管理員。」
*   對外訊息刻意不提設定名稱；**服務啟動當下即於系統日誌寫明缺少 `OPEN_PETS_JWT_SECRET`**，部署者不必等到有人登入失敗才發現。
*   系統**不會**自行產生隨機金鑰頂替：每次重啟都換一把的話，所有已登入者會無故被登出且查不出原因。
*   更換金鑰會使既已簽發的 access token 全數失效，所有人須重新登入。

### 2.4 部署設定：系統日誌(.env，選用)

系統日誌記錄的是「程式運行時發生什麼」(設定缺漏、日誌檔毀損、未預期例外)，與稽核軌跡是兩回事——稽核記的是「誰做了什麼」，不可遺失、不可關閉、有鏈式簽章，其落點由 `OPEN_PETS_DATA_DIR` 決定，不受本節設定影響。

| 設定 | 未設定時的行為 |
|---|---|
| `OPEN_PETS_LOG_FILE` | 僅輸出至畫面、不寫檔(唯讀環境亦可正常啟動)。指定後自動輪替，單檔 10 MB、保留 5 份，內容為每行一筆 JSON |
| `OPEN_PETS_LOG_LEVEL` | 採內建預設 `WARNING`。**此等級下 `INFO` 與 `DEBUG` 的訊息不會出現**，要看流程細節請設為 `INFO` 或 `DEBUG` |
| `OPEN_PETS_LOG_CONFIG` | 不使用外部設定。指定後整份取代內建設定(Python logging 的 `dictConfig` JSON)，此時上面兩項不再適用；檔案讀不到或無法解讀時退回內建設定並於啟動時告知 |

CLI 亦可於指令列以 `--log-file`/`--log-level` 覆寫，優先於環境變數。

### 2.5 啟動服務

本系統以 ASGI 應用程式形式提供，啟動一律透過 `uvicorn` 指令，**監聽位址與埠號由指令參數指定**，程式碼中不寫死：

```bash
# 本機開發(僅接受本機連線，並於程式碼變動時自動重載)
uvicorn app.api.server:app --host 127.0.0.1 --port 8000 --reload

# 正式環境(接受外部連線，不啟用自動重載)
uvicorn app.api.server:app --host 0.0.0.0 --port 8000
```

啟動後開 `http://<位址>:<埠號>/docs` 可取得 Swagger UI 互動式介面。所有 API 路徑前綴為 `/api/v1`。

補充說明：

*   `--reload` 為開發用途，會另起監看程序追蹤檔案變動，**正式環境請勿使用**。
*   `--host 127.0.0.1` 僅接受本機連線；需由其他機器(或容器外部)連入時必須改為 `--host 0.0.0.0`。

## 3. 測試資料產生 (Data Generation)
為進行效能驗證，系統內建模擬資料生成器，可產生符合規模需求(500 萬筆以上)之測試資料。

*   **執行腳本**：`benchmarks/generate_data.py`
*   **執行指令**(一律於專案根目錄執行)：
    ```bash
    python -m benchmarks.generate_data 5000000
    ```
*   **產出成果**：
    *   測試資料：`scratch/test_data_5000k.csv`
    *   對應之設定檔：`benchmarks/config_kanon_5m.json`、`benchmarks/config_dp_5m.json`(隨腳本附上，壓力測試一律讀它們)

## 4. 壓力測試與效能驗證 (Performance Benchmark)
本專案依據需求書標準，設計壓力測試腳本以驗證系統穩定性與處理效能(目標：500 萬筆資料處理時間 < 4 小時)。壓力測試相關腳本一律置於 `benchmarks/`，以模組方式於專案根目錄執行。

*   **步驟 4.1：執行測試**
    ```bash
    python -m benchmarks.kanon
    ```
    不帶參數時使用 `scratch/test_data_5000k.csv`；亦可於指令後接資料集路徑指定其他資料集。
*   **步驟 4.2：產出報告**
    PDF 驗收報告已內建於壓力測試腳本，`benchmarks/kanon.py` 執行完畢會自動產出。

    *產出檔案：`scratch/performance_report.pdf`*

## 5. 差分隱私壓力測試
差分隱私的專屬壓力測試請執行 `python -m benchmarks.dp`，同樣會產出對應的驗收報告。

## 6. 功能測試 (Functional Testing)
若需確認各模組邏輯之正確性，請使用內建測試框架執行單元測試：

```bash
pytest tests
```

測試範圍限定於 `tests` 目錄。

另有三種實務應用情境(醫療研究、金融分析、交通流分析)之端到端腳本，涵蓋前處理、K-匿名化、差分隱私、再識別攻擊模擬與 CAP 前後對比，用法見 `scenarios/README.md`。

## 7. 介面規格

### 7.1 命令列介面

九個指令均以 `python -m app.cli.main <指令>` 執行。`--input`/`-i` 指定輸入資料集，`--config`/`-c` 指定設定檔，`--output`/`-o` 指定輸出路徑；其餘處理參數一律寫在設定檔內，指令列不另提供覆寫選項。

| 指令 | 用途 | 必要參數 |
|---|---|---|
| `create-user` | 建立使用者帳號 | `-u` 帳號、`-p` 密碼(`-r` 角色為選填，`admin` 或 `user`，預設 `user`) |
| `preprocess` | 資料前處理(十一項功能) | `-i`、`-c`、`-o` |
| `k-anonymity` | K-匿名化去識別 | `-i`、`-c`、`-o` |
| `dp` | 差分隱私去識別 | `-i`、`-c`、`-o` |
| `risk-k-anonymity` | 三攻擊模擬(K-匿名化) | `-i`、`-c` |
| `risk-dp` | 三攻擊模擬(差分隱私) | `-i`、`-c` |
| `risk-cap` | CAP 前後對比 | `-i`、`--processed`/`-p`、`-c` |
| `report` | 彙整風險量測結果並產出 PDF | `-o`，另需 `--attack-report` 或 `--cap-report` 至少一項 |
| `verify-log` | 校驗稽核軌跡之雜湊鏈完整性 | 無 |

輸入資料集為 SQLite 連線字串時，另以 `--table` 指定資料表名稱(`risk-cap` 之去識別後資料集則用 `--processed-table`)。

### 7.2 HTTP 介面

十七個端點路徑前綴均為 `/api/v1`。啟動服務後可於 `/docs` 取得 Swagger UI 與 OpenAPI 規格。

**處理功能(七個，一律採 `POST`，不需登入)**

| 端點 | 用途 |
|---|---|
| `/preprocess` | 資料前處理(十一項功能) |
| `/k-anonymity` | K-匿名化去識別 |
| `/dp` | 差分隱私去識別 |
| `/risk/k-anonymity` | 三攻擊模擬(K-匿名化) |
| `/risk/dp` | 三攻擊模擬(差分隱私) |
| `/risk/cap` | CAP 前後對比 |
| `/report` | 彙整風險量測結果並產出 PDF |

**身分驗證(四個)**

| 端點 | 方法 | 用途 |
|---|---|---|
| `/auth/login` | POST | 帳密登入，取得 access token 與 refresh token |
| `/auth/refresh` | POST | 以 refresh token 換發新的 access token(舊的即作廢) |
| `/auth/logout` | POST | 作廢該張 refresh token |
| `/auth/password` | PATCH | 變更自己的密碼(須帶舊密碼) |

**帳號管理(六個，全部限 `admin`)**

| 端點 | 方法 | 用途 |
|---|---|---|
| `/users` | GET | 列出所有帳號 |
| `/users` | POST | 建立帳號 |
| `/users/{username}/role` | PATCH | 變更角色 |
| `/users/{username}/reset-password` | POST | 重設密碼(不需舊密碼) |
| `/users/{username}/active` | PATCH | 停用或恢復帳號 |
| `/users/{username}` | DELETE | 刪除帳號 |

身分驗證與帳號管理和上述處理功能**各自獨立**：處理功能端點不掛身分驗證，呼叫方式不因帳號設定而改變；角色只決定誰能管理帳號。兩組端點需設定 `OPEN_PETS_JWT_SECRET` 才啟用，詳見 2.3。

需登入的端點以 `Authorization: Bearer <access token>` 帶入 token。access token 有效期十五分鐘、refresh token 七天，兩者皆置於回應主體(不使用 cookie，以利瀏覽器以外的呼叫端使用)。角色與帳號啟用狀態**每次請求都從資料庫重讀**，故降級與停用立即生效。**呼叫端請勿將 token 存入瀏覽器的 `localStorage`**，該處可被網頁上的指令碼讀取。

六個吃資料的端點(`/report` 以外的處理功能)，其資料集以檔案上傳(`file`/`original`/`processed`)，或以 `source` 給定 SQLite 連線字串並以 `table` 指定資料表名稱，二者擇一；同一份資料兩者都給或都不給均拒絕。`/risk/cap` 收前後兩份，欄位各帶前綴(`original_source`/`original_table` 與 `processed_source`/`processed_table`)，兩份各自選來源。連線字串所指為伺服器本機之路徑，服務以容器執行時須寫容器內之路徑。

### 7.3 輸入與輸出格式

*   **輸入**：資料集支援 CSV、JSON、Excel 與資料庫匯入；設定檔支援 YAML 與 JSON。
*   **輸出**：去識別後之結果資料沿用輸入資料集之格式(CSV 進 CSV 出、Excel 進 Excel 出、JSON 進 JSON 出並還原原本的 orient)；資料庫來源無對應之輸出語意，一律輸出 CSV。
*   **報告**：K-匿名化之品質報告置於回應標頭 `X-Quality-Report`，差分隱私之預算報告置於 `X-Budget-Report`，皆為 JSON 字串；風險量測端點直接以 JSON 回傳報告本體。
*   **函式庫呼叫**：核心引擎亦可直接以 Python 函式呼叫，參數定義見 `app/engines/` 下各函式之 Docstring。

## 8. 交付與部署說明
*   **原始碼交付**：本專案包含完整之模組化原始碼、系統設定檔範例與部署腳本。
*   **離線部署**：本系統不綁定外部服務，可於內網環境透過虛擬環境或容器映像檔獨立運行。
*   **建議硬體配置**：處理 500 萬筆級資料集時，建議至少 16 GB 記憶體與 8 核心處理器。