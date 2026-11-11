---
title: 命令列使用說明
weight: 6
---

命令列工具適合批次處理、排程作業，以及帳號維護。它和網頁、API 在同一個映像檔 `open-pets-app:<版本>` 裡，直接呼叫處理引擎，不經過 API，所以不需要登入。

以下指令都在**安裝主機**的 PowerShell 執行（Linux 的 bash 寫法見各節說明）。用 GHCR 安裝時，指令裡的映像檔 `open-pets-app:<版本>` 要換成 `ghcr.io/ttcdog115016/open-pets-app:<版本>`。

## 執行方式

命令列有兩種用法：

| 用途 | 做法 | 說明 |
| --- | --- | --- |
| 去識別化、風險評估、產生報告 | `docker run --rm …`（另起一個用完即刪的容器） | 把主機的工作資料夾掛到容器內的 `/work`，並掛上資料磁碟區 `open-pets_open-pets-data`（取得同一份雜湊鹽值） |
| 帳號維護、檢查稽核紀錄 | `docker exec open-pets …`（在執行中的容器內執行） | 直接使用執行中系統的帳號資料庫與稽核紀錄 |

所有指令都用同一個入口 `python /opt/openpets/openpets_server.py <子命令>`，它會先載入資料磁碟區裡的金鑰（雜湊鹽值等），再執行子命令。

### 準備工作資料夾

選一個資料夾當工作資料夾，例如 `C:\pets-work`，並建立三個子資料夾：

```powershell
New-Item -ItemType Directory -Force C:\pets-work\data, C:\pets-work\config, C:\pets-work\output
cd C:\pets-work
```

- 輸入資料放 `data`，設定檔放 `config`，結果會寫到 `output`。
- 容器內一律用 `/work/...` 的路徑指定檔案，例如 `/work/data/範例資料.csv`。

### 基本指令

```powershell
docker run --rm -v "${PWD}:/work" -v open-pets_open-pets-data:/data open-pets-app:<版本> python /opt/openpets/openpets_server.py --help-cli
```

- `-v "${PWD}:/work"`：把目前的 PowerShell 資料夾掛到容器內的 `/work`。
- `-v open-pets_open-pets-data:/data`：掛上系統使用中的資料磁碟區，使用同一份鹽值，雜湊結果才會和網頁版一致。磁碟區的實際名稱以 `docker volume ls` 為準。
- **一定要掛資料磁碟區。** 沒掛的話，這個一次性容器會自己產生一組臨時金鑰，雜湊結果就和網頁版對不上，而且用完即刪。
- Linux 的 bash 把 `${PWD}` 換成 `"$PWD"`。工作資料夾若是一般使用者建立的，容器（使用者 10001）寫不進去，先執行 `chmod -R a+rwX pets-work`。

### 全域選項

全域選項要寫在子命令**之前**：

| 選項 | 說明 |
| --- | --- |
| `--log-file <路徑>` | 系統日誌檔路徑；沒指定時只輸出到畫面 |
| `--log-level <等級>` | 日誌等級：DEBUG／INFO／WARNING（預設）／ERROR |

## 子命令總覽

| 子命令 | 用途 | 參數 |
| --- | --- | --- |
| `preprocess` | 資料前處理（去空白、型態轉換等 11 項） | `-i` 輸入檔、`-c` 設定檔、`-o` 輸出檔（皆必填）；`--table` |
| `k-anonymity` | K-匿名化（含 l-多樣性、t-相近性與抑制） | `-i`、`-c`、`-o`（皆必填）；`--table` |
| `dp` | 差分隱私加噪，並回報預算消耗 | `-i`、`-c`、`-o`（皆必填）；`--table` |
| `risk-k-anonymity` | 三攻擊風險評估（K-匿名化）：系統自動把原始資料切成 80／20 後評估 | `-i` 原始資料、`-c` 設定檔；`--table` |
| `risk-dp` | 三攻擊風險評估（差分隱私） | `-i` 原始資料、`-c` 設定檔；`--table` |
| `risk-cap` | CAP 前後對比：比較原始資料與已去識別的資料 | `-i` 原始資料、`-p` 處理後資料、`-c` 設定檔；`--table`、`--processed-table` |
| `report` | 由風險報告 JSON 產生 PDF | `-o` 輸出 PDF（必填）、`--attack-report`／`--cap-report`（至少一個）、`-t` 任務名稱（預設 `risk-report`） |
| `verify-log` | 檢查稽核紀錄的雜湊鏈，確認沒有被竄改、刪除或插入 | 無 |
| `create-user` | 建立帳號 | `-u` 帳號、`-p` 密碼（皆必填）、`-r` 角色 `admin`／`user`（預設 `user`） |

- **輸入格式：** CSV、Excel（.xlsx）、JSON、JSONL，或 SQLite 連線字串 `sqlite:///…`（需搭配 `--table`）。
- **輸出格式：** 和輸入相同；SQLite 來源一律輸出為 CSV。
- 處理結果的報告（JSON）輸出到 **stdout**，進度與錯誤訊息輸出到 **stderr**。存成檔案的方式見下方執行範例。

## 設定檔

所有子命令共用**一份統合設定檔**（JSON 或 YAML），並用每個區塊的 `enabled` 決定要執行哪些處理。`k`、抑制上限、隱私預算等參數都寫在設定檔裡，不能從命令列指定。雜湊鹽值只從伺服器端的設定讀取（環境變數 `OPEN_PETS_DEFAULT_SALT`，沒有設定時用第一次啟動自動產生的 `/data/.secrets.env`）。

| 子命令 | 需啟用的區塊 |
| --- | --- |
| `preprocess` | `preprocess` |
| `k-anonymity` | `k_anonymity` |
| `dp` | `differential_privacy` |
| `risk-k-anonymity` | `risk_attacks` ＋ `k_anonymity` |
| `risk-dp` | `risk_attacks` ＋ `differential_privacy` |
| `risk-cap` | `risk_cap` |

設定檔結構（節錄）：

```json
{
  "version": "…",
  "dataset": "…",
  "input_format": "csv",
  "preprocess":           { "enabled": true,  "…": "…" },
  "k_anonymity":          { "enabled": true,  "k": 5, "l": 2, "t": 0.7,
                            "suppression_limit_percent": 20, "columns": { "…": "…" } },
  "differential_privacy": { "enabled": true,  "…": "…" },
  "risk_attacks":         { "enabled": true,  "…": "…" },
  "risk_cap":             { "enabled": true,  "…": "…" }
}
```

- **範例檔：** 交付套件的 `04_系統設定檔` 提供 `config_範例_JSON統合版.json`、`config_範例_YAML統合版.yaml`、`範例資料.csv` 與 `範例資料_去識別後.csv`。
- **參數說明：** 每個欄位的意思請見同一資料夾的 `設定檔結構與參數說明.md`。
- **自己準備設定檔：** 在網頁的 Step 2 或 Step 3 下載的設定檔，可以直接拿來用。
- 設定檔中不認得的欄位會被拒絕。

## 執行範例

以下範例在 `C:\pets-work` 執行，資料與設定檔使用交付套件 `04_系統設定檔` 的 `範例資料.csv` 與 `config_範例_JSON統合版.json`，事先複製到 `data` 與 `config`。

為了讓指令短一點，先把共用的部分存成變數：

```powershell
cd C:\pets-work
$img = 'run', '--rm', '-v', "${PWD}:/work", '-v', 'open-pets_open-pets-data:/data', 'open-pets-app:<版本>'
```

報告 JSON 要在容器內用 `sh -c '… > /work/output/xxx.json'` 存檔，不要用 PowerShell 的 `>` 或 `Out-File`：PowerShell 會改變中文的編碼，存下來的 JSON 無法給 `report` 子命令讀取。

### K-匿名化 → 風險評估 → PDF 報告

```powershell
# 1. K-匿名化，報告存成 kanon.json
docker @img sh -c 'python /opt/openpets/openpets_server.py k-anonymity -i /work/data/範例資料.csv -c /work/config/config_範例_JSON統合版.json -o /work/output/out.csv > /work/output/kanon.json'

# 2. 三攻擊風險評估，報告存成 attack.json
docker @img sh -c 'python /opt/openpets/openpets_server.py risk-k-anonymity -i /work/data/範例資料.csv -c /work/config/config_範例_JSON統合版.json > /work/output/attack.json'

# 3. 產生 PDF 報告
docker @img python /opt/openpets/openpets_server.py report --attack-report /work/output/attack.json -o /work/output/report.pdf -t demo
```

完成後，`C:\pets-work\output` 會有 `out.csv`、`kanon.json`、`attack.json` 與 `report.pdf`。

畫面輸出節錄：

```text
正在載入資料與設定檔...
正在進行 K-匿名化（泛化與抑制）去識別化...
正在匯出結果...
去識別化處理成功（耗時 0.18 秒）！結果已儲存至：/work/output/out.csv
```

`kanon.json` 節錄：

```json
{
  "is_valid": true,
  "k_passed": true,
  "l_passed": true,
  "t_passed": true,
  "suppression_rate_percent": 7.69,
  "hash_algorithm": "sha3-256",
  "hash_salted": true,
  "message": "K-匿名化處理成功，k／l／t 檢測均通過。"
}
```

`attack.json` 節錄：

```json
{
  "singling_out_risk": 0.0,
  "linkability_risk": 0.0046,
  "inference_risk": 0.0366,
  "sample_size": 771
}
```

### 差分隱私

```powershell
docker @img sh -c 'python /opt/openpets/openpets_server.py dp -i /work/data/範例資料.csv -c /work/config/config_範例_JSON統合版.json -o /work/output/out_dp.csv > /work/output/dp_budget.json'
```

### 檢查稽核紀錄

稽核紀錄在執行中的容器裡，所以用 `docker exec`：

```powershell
docker exec open-pets python /opt/openpets/openpets_server.py verify-log
```

```text
正在校驗審計日誌雜湊鏈條完整性...
校驗完成：每一行都已驗證，未發現篡改、刪除或非法插入。
```

## 帳號維護

帳號維護一律在執行中的容器內執行（`docker exec open-pets`）。

### 建立帳號

```powershell
docker exec open-pets python /opt/openpets/openpets_server.py create-user -u admin2@example.com -p 'Abcd-1234-xyz' -r admin
```

```text
成功建立使用者 [admin2@example.com]，角色為 [admin]。
```

- 密碼至少 12 個字元，並同時包含大寫、小寫、數字與符號。不符合時會顯示 `執行失敗［ERR_INVALID_PARAM］：密碼長度至少需 12 個字元。`，結束代碼為 2。
- 帳號已存在時會顯示 `執行失敗［ERR_USER_EXISTS］`，結束代碼為 10。
- 密碼請用單引號包起來，避免 `$` 等符號被 PowerShell 當成變數。
- 用 `-p` 帶入的密碼會留在 PowerShell 的歷史紀錄裡。建議建立後請對方登入網頁，到「個人設定」自行變更密碼。

### 重設密碼並解除鎖定

一般使用者忘記密碼時，由管理員在網頁的「帳號與權限管理」重設即可。管理員自己忘記密碼或被鎖定時，在安裝主機執行（互動式，會列出現有帳號，並詢問要重設的帳號與新密碼，密碼不會留在指令歷史）：

```powershell
docker exec -it open-pets python /opt/openpets/openpets_server.py reset-password
```

重設後帳號會同時解除鎖定。第一個管理員用 `create-admin` 建立（只有在系統還沒有任何帳號時可以執行），見[安裝教學第 7 節](../deploy/#7-啟動後建立管理員並確認)。

## 結束代碼

批次或排程執行時，可以用結束代碼判斷成功或失敗（PowerShell 中為 `$LASTEXITCODE`）。錯誤訊息的格式是 `執行失敗［ERR_xxx］：…`。

| 代碼 | 意義 |
| --- | --- |
| 0 | 成功 |
| 1 | 未預期的錯誤 |
| 2 | 參數、設定檔或資料錯誤（例：密碼不足 12 字、檔案不存在） |
| 3 | 檔案過大 |
| 4 | 不支援的檔案或設定檔格式 |
| 5 | 驗證失敗（設定檔與資料不符） |
| 6 | 未通過身分驗證 |
| 7 | 找不到對象 |
| 9 | 權限不足 |
| 10 | 已經存在（例：帳號重複） |
| 11 | 帳號已鎖定 |
| 12 | `verify-log` 未完全通過 |
| 13 | 已取消 |

## 相關設定（.env）

系統的設定檔是安裝資料夾裡的 `.env`（compose 會讀它），修改後執行 `docker compose up -d`，容器會用新設定重建。各變數的說明見[安裝教學第 8 節](../deploy/#8-三種模式本地線上內網)。

{{< callout type="warning" >}}
金鑰（鹽值、簽章金鑰）預設存在資料磁碟區的 `/data/.secrets.env`；若改成寫在 `.env`，這個檔案要當作機密保管，不要寄給他人。
{{< /callout >}}
