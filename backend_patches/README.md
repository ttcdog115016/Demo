# 後端（期末交付 open-pets 2.0.0）本地修改

期末交付包 `01_程式原始碼` 是廠商交付品，以下修改直接改在該資料夾，並在此保留 patch 以便追蹤、提供給後端廠商或重新套用。
`deploy_backend_v2.ps1` 以該資料夾建置映像檔，改完需重新執行部署腳本才會生效。

| 日期 | Patch | 內容 |
|---|---|---|
| 2026-10-28 | `2026-10-28_password_min_length.patch` | 密碼長度下限 12（建立帳號、變更密碼、重設密碼；環境變數 `OPEN_PETS_PASSWORD_MIN_LENGTH` 可調）；既有測試以 conftest 放寬為 1，新增 `tests/unit/test_password_min_length.py`。後端全套 701 項測試通過 |
| 2026-10-29 | `2026-10-29_system_data.patch` | 系統資料改存後端：新增 `/data/system.db`（`app/governance/system_store.py`）與 `app/api/system_router.py`——處理紀錄 `/history`、系統維運日誌 `/system-logs`、系統設定 `/settings`（閒置登出時間、維護模式）、系統公告 `/announcements`；維護模式中非 admin 登入與換發 token 回 503 `ERR_MAINTENANCE`；登入失敗、帳號鎖定寫入維運日誌。新增 `tests/api/test_api_system.py`，後端全套 710 項測試通過 |
| 2026-10-29 | `2026-10-29_cleanup_and_signing.patch`（需先套用上一個） | 刪除全站維護模式（`ERR_MAINTENANCE`、`maintenance_mode` 設定）；處理紀錄改由伺服器簽章（新增 `app/governance/history_signing.py`，HMAC-SHA256，金鑰由 `OPEN_PETS_SYSTEM_MASTER_KEY` 衍生）與 `GET /history/{id}/verify`；`GET /users` 附 `failed_login_count`、`login_locked_until`。後端全套 712 項測試通過 |
| 2026-10-29 | `2026-10-29_subgroup_date_range.patch` | 風險評估子群體篩選支援日期區間：`app/engines/risk/subset.py` 區間 `min`／`max` 可為日期字串（`YYYY-MM-DD`，分隔可為 `-`／`/`／`.`，可帶時間），欄位以 `pd.to_datetime(errors="coerce")` 轉日期，轉不動者落選並備註；邊界只給日期時以「日」比較（`max` 當天任何時刻皆含）。數值邊界行為不變；其他字串、數值與日期混用仍回 `ERR_SUBSET_COND_MALFORMED`。`tests/unit/test_risk_subset.py` 新增 4 項，後端全套 716 項測試通過 |
| 2026-10-29 | `2026-10-29_auth_processing_and_cleanup.patch`（需先套用前面幾個） | 處理端點（前處理、K-匿名、DP、風險評估、報告）改須登入（`app/api/processing_guard.py`），每次呼叫由後端寫維運日誌並回 `X-Run-Id`（`runs` 表）；登入成功／登出改由後端記錄；日誌加 `origin`、`username`，時間一律用伺服器時間，前端不得回報後端事件、每批 ≤ 50；`POST /history` 須引用同帳號未用過的 runId、同 id 不可覆寫（`ERR_RUN_INVALID`、`ERR_RECORD_EXISTS`）；verify 找不到回 missing；移除系統公告端點；CORS `expose_headers`。後端全套 721 項測試通過 |

重新套用（於 `01_程式原始碼` 目錄）：`git apply --ignore-whitespace <patch>`（交付包為 CRLF 換行，必要時先轉換）。
