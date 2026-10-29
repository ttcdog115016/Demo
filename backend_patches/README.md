# 後端（期末交付 open-pets 2.0.0）本地修改

期末交付包 `01_程式原始碼` 是廠商交付品，以下修改直接改在該資料夾，並在此保留 patch 以便追蹤、提供給後端廠商或重新套用。
`deploy_backend_v2.ps1` 以該資料夾建置映像檔，改完需重新執行部署腳本才會生效。

| 日期 | Patch | 內容 |
|---|---|---|
| 2026-10-28 | `2026-10-28_password_min_length.patch` | 密碼長度下限 12（建立帳號、變更密碼、重設密碼；環境變數 `OPEN_PETS_PASSWORD_MIN_LENGTH` 可調）；既有測試以 conftest 放寬為 1，新增 `tests/unit/test_password_min_length.py`。後端全套 701 項測試通過 |
| 2026-10-29 | `2026-10-29_system_data.patch` | 系統資料改存後端：新增 `/data/system.db`（`app/governance/system_store.py`）與 `app/api/system_router.py`——處理紀錄 `/history`、系統維運日誌 `/system-logs`、系統設定 `/settings`（閒置登出時間、維護模式）、系統公告 `/announcements`；維護模式中非 admin 登入與換發 token 回 503 `ERR_MAINTENANCE`；登入失敗、帳號鎖定寫入維運日誌。新增 `tests/api/test_api_system.py`，後端全套 710 項測試通過 |

重新套用（於 `01_程式原始碼` 目錄）：`git apply --ignore-whitespace <patch>`（交付包為 CRLF 換行，必要時先轉換）。
