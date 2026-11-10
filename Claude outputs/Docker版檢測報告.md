# 資料隱私保護技術套件 Docker 單一映像檔 原始碼檢測暨弱點掃描與實測報告

> **受測物**：`open-pets-app:2.0.2`，前端與後端合併的單一 Docker 映像檔（建置檔在 `docker/`）。交付包為 `docker/dist/open-pets-app_2.0.2/`，內有映像檔 tar、`docker-compose.yml`、`SHA256SUMS.txt`、部署說明。

> **版號說明（115/11/10）**：交付版號已改為 **2.0.0**（映像檔 `open-pets-app:2.0.0`、交付包 `open-pets-app_2.0.0/`、GHCR 標籤與 Release 皆以 2.0.0 為準）。本報告前面各節測試時映像檔的標籤是 `2.0.2`，內容相同（版號只影響標籤、檔名與文件）；**後端自己的版本仍是 2.0.2**（`/api/v1/status` 回傳 2.0.2，來源 commit `1520899`），兩者不同是刻意的。
> **檢測日期**：115 年 11 月 10 日。
> **方法**：沿用前次《單機版原始碼檢測報告》的工具與判讀方式，另加 Trivy 檢查映像檔的作業系統層，並對運行中的容器做功能實測。
> **處理方式**：屬實的高、中風險直接修補並複測（第六節）。後端為委外交付物，**原始碼未修改**。
> **原始輸出**：`Docker版檢測原始資料/`。

## 一、檢測資訊

### （一）受測標的

| 部分 | 來源 | 版本 | 範圍 | 檔案數 | 行數（ncloc） |
|---|---|---|---|---|---|
| 前端 | Demo repo，分支 `claude/docker-image-frontend-backend-c131d5`（基於 `feature/backend-v2-integration` 的 `cd198a7`） | — | `src/`、`index.html` | 119 | 24,447 |
| 後端 | 3.1 完整交付套件 `01_程式原始碼` | 2.0.2（`1520899`） | `app/` | 81 | 7,979 |
| 容器進入點 | `docker/openpets_server.py`、`packaging/launcher.py` | — | 2 個檔案 | 2 | 837 |
| **合計** | | | | **202** | **33,263** |

### （二）檢測工具

| 檢測項目 | 工具 | 版本 |
|---|---|---|
| 源碼掃描 | SonarQube Community Build ＋ SonarScanner CLI（品質設定檔 Sonar way） | 26.10.0.133078 ／ 8.1.0.6389 |
| 相依元件弱點 | OWASP Dependency-Check（加 `--enableExperimental`） | 12.2.2 |
| 交叉比對 | npm audit、pip-audit | npm 11.17.0、pip-audit 2.10.1 |
| 映像檔弱點 | Trivy（作業系統套件、Python 套件、祕密、Dockerfile 設定） | 0.76.2 |
| 執行期弱點 | OWASP ZAP（baseline 被動掃描、API 主動掃描） | 2.17.0 |

所有工具皆以官方映像檔在本機執行，原始碼以唯讀方式掛載。

### （三）掃描對象

| 工具 | 對象 |
|---|---|
| SonarQube | 上表三個部分的原始碼（各自一個專案） |
| Dependency-Check | 從映像檔取出的 `/opt/venv` Python 套件、映像檔內的前端建置產物 `/srv/frontend`、`package-lock.json` |
| Trivy | 完整映像檔 `open-pets-app:2.0.2`、`docker/Dockerfile` |
| ZAP | 運行中的容器（無登入的 baseline；以登入 token 對 OpenAPI 全部端點的 API 掃描） |

## 二、結果總表

| 項目 | 修補前 | 修補後 |
|---|---|---|
| SonarQube 品質門檻 | 三個部分全部通過 | 同左（未改動原始碼） |
| 屬實的安全性 Vulnerability（SonarQube） | 0 | 0 |
| 前端執行期 npm 相依弱點（npm audit `--omit=dev`） | 0 | 0 |
| 前端建置產物弱點（Dependency-Check） | **3**（`swagger-ui` 內嵌 DOMPurify 3.4.16：critical 1、high 1、low 1） | **0** |
| Python 套件弱點（pip-audit） | 0 | 0 |
| 映像檔 Python 套件弱點（Trivy） | **6**（pip 25.0.1，medium 5、low 1） | **0** |
| 映像檔作業系統套件弱點（Trivy，high／medium／low） | 49／75／65 | 47／74／65 |
| 其中已有修補版可升級者 | **2**（zlib1g） | **0** |
| 映像檔內的祕密、Dockerfile 設定缺失（Trivy） | 0、0 | 0、0 |
| ZAP baseline | 失敗 0、警告 5、通過 63 | 同左（最終映像檔重測） |
| ZAP API 掃描 | 失敗 0、警告 0、通過 120 | 未重測（swagger-ui 修補只動前端靜態檔） |
| 實際測試 | — | 全部通過（第七節） |

**沒有屬實且未處理的高風險或嚴重（critical）項目**。仍存在的 47 個作業系統層 HIGH，Debian 尚未提供修補版，列為風險接受（第四（二）節）。

## 三、源碼掃描（SonarQube）

### （一）總表

| 部分 | 品質門檻 | Bug | Vulnerability | Code Smell | 安全熱點 | 重複率 | 技術債 |
|---|---|---|---|---|---|---|---|
| 前端 | 通過 | 5 | 20 | 24 | 0 | 6.5% | 132 分鐘 |
| 後端 | 通過 | 0 | 0 | 3 | 0 | 1.2% | 15 分鐘 |
| 容器進入點 | 通過 | 0 | 8 | 0 | 0 | 0.0% | 0 分鐘 |

SonarQube 26.10 已把過去的「安全熱點」規則改列為 Vulnerability，所以熱點計數皆為 0，Vulnerability 需逐筆判讀。

### （二）容器進入點

新增的 `docker/openpets_server.py` **沒有任何議題**。8 筆 Vulnerability 全部在 `packaging/launcher.py`（S5332，使用 `http://`），位置與前次單機版報告相同，都是連到 `127.0.0.1` 的本機迴路位址，屬刻意設計。容器版沒有使用那幾行程式碼（容器內健康檢查由 Dockerfile 的 `HEALTHCHECK` 執行）。

### （三）後端（3 筆 Code Smell）

與前次結果完全一致：S8414（CORS 中介層順序，設計層級；容器版同源，未設定 CORS）、S6709 兩筆（亂數不指定種子，差分隱私與攻擊模擬的刻意設計）。

### （四）前端

| 規則 | 類型 | 筆數 | 判讀 |
|---|---|---|---|
| S2068 疑似寫死密碼 | Vulnerability | 8 | **誤判**：`i18n.ts` 內含「密碼」字樣的翻譯字串 |
| S2245 虛擬亂數 | Vulnerability | 10 | **非安全用途**：畫面元件的暫時識別碼 |
| S6389 雙向控制字元 | Vulnerability | 2 | **刻意使用**：偵測欄位名稱中的不可見字元 |
| S6324 正規式含控制字元 | Bug | 3 | 刻意：清理不可見字元 |
| S5850 正規式優先順序 | Bug | 1 | `authApi.ts:526` 時區判斷，只影響時間顯示，無安全影響 |
| S9383 Promise 未處理 | Bug | 1 | 可靠性議題（A10），前次為 24 筆，已大幅減少 |
| Code Smell | — | 24 | 寫法建議 |

與前次單機版相比，Bug 由 30 筆降為 5 筆，Vulnerability 同為 20 筆且全部是上表判讀的誤判或非安全用途。

## 四、弱點掃描

### （一）相依元件（Dependency-Check、npm audit、pip-audit）

**映像檔內 Python 套件**：Dependency-Check 辨識 396 個元件，7 個有比對命中，**全部是 CPE 名稱誤判**，與前次判讀一致。pip-audit 對 45 個實際安裝的套件比對，**0 筆弱點**。

| 命中元件 | 比對到的 CPE | 判讀 |
|---|---|---|
| PyJWT 2.15.1（`jwt`、`PyJWT` 各 1 次） | `jwt_project:jwt`（CVE-2025-45770） | 已被維護者提出爭議（呼叫端可選過短金鑰）；後端以系統產生的隨機金鑰簽署，pip-audit 未列出 |
| SQLAlchemy 的 `dialects/mysql` 子模組 | `mysql:mysql:1.4` | 比對到 MySQL 伺服器，本系統未使用 MySQL |
| SciPy 的 `signal` 子模組 | `signal:signal:1.19.0` | 比對到 Signal 通訊軟體 |
| fontTools 的 `t1Lib` 子模組 | `t1lib:t1lib:1.0b3` | 比對到 C 語言字型函式庫 |
| `setuptools/cli-32.exe`、`cli-64.exe` | `cli_project:cli` | 比對到 Node.js 套件，且為建置工具 |

**前端建置產物**：初測有 1 項屬實發現（見第六（一）節），修補後 8 個元件、**0 筆**。

**前端 `package-lock.json`**：Dependency-Check 的 Node 分析器沒有辨識出任何元件（與前次不同，前次辨識 556 項），因此**改以 npm audit 為準**：

| 範圍 | 結果 |
|---|---|
| 執行期相依（`--omit=dev`） | **0 筆** |
| 全部相依 | 28 筆（high 8、moderate 20），全是開發與建置工具（eslint、vite、vitest、postcss、typescript-eslint 等），**不會進入映像檔**：映像檔只含 `vite build` 的輸出 |

### （二）映像檔（Trivy）

**修補後**（交付的映像檔）：Debian 13.7 作業系統套件 186 項（high 47、medium 74、low 65），Python 套件 0 項，祕密 0 項，Dockerfile 設定檢查 0 項失敗。

**剩餘的 47 個 HIGH：Debian 尚未提供修補版（狀態 affected），無法以升級處理**，涉及 18 個套件、11 個 CVE：

| 套件（來源） | HIGH 數 | CVE | 實際暴露面判讀 |
|---|---|---|---|
| util-linux 系列：`bsdutils`、`libblkid1`、`libmount1`、`libsmartcols1`、`libuuid1`、`liblastlog2-2`、`login`、`mount`、`util-linux`（各 4） | 36 | CVE-2026-76642、78408、78409、78410 | 都是系統工具與函式庫。容器沒有登入 shell 服務、不掛載檔案系統、執行身分為非 root、`cap_drop: ALL`，服務不呼叫這些工具 |
| ncurses 系列：`libncursesw6`、`libtinfo6`、`ncurses-base`、`ncurses-bin` | 4 | CVE-2025-69720 | 終端機函式庫，服務不使用 |
| `libsqlite3-0` | 3 | CVE-2026-119373、119374、119379 | **後端會用到**：帳號與系統資料庫為 SQLite。SQL 由後端程式固定產生，使用者無法提供自訂 SQL，風險偏低，但屬實際執行期元件，建議追蹤 Debian 安全公告 |
| `libsystemd0`、`libudev1` | 2 | CVE-2026-16742 | 服務不使用 systemd／udev |
| `perl-base` | 1 | CVE-2026-9538 | 服務不使用 Perl |
| `libacl1` | 1 | CVE-2026-54369 | 服務不使用 |

**處置：風險接受**，條件是 Debian 一旦有修補版，下次重建映像檔（Dockerfile 已含 `apt-get upgrade`）即自動帶入。建議每月或每次安全公告後重建並重掃。

### （三）執行期（ZAP）

**baseline（無登入，修補後的最終映像檔）**：失敗 0、警告 5、通過 63。

| 風險 | 警示 | 判讀 |
|---|---|---|
| 中 | CSP `style-src 'unsafe-inline'` | **風險接受**，與前次相同：antd 執行時以 `<style>` 注入樣式；`script-src` 已限制為 `'self'` |
| 低 | Unix 時間戳記揭露 | 誤判，打包後 JS 內的數字常數 |
| 資訊 | 可疑註解、現代 Web 應用程式、可儲存內容 | 屬預期行為 |

回應沒有 `Server` 標頭，8 項安全標頭（CSP、X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy、三項 Cross-Origin）齊全。

**API 掃描（以管理員 token 對 OpenAPI 全部端點，主動式）**：失敗 0、警告 0、通過 120。只有 2 項資訊級警示（用戶端錯誤回應碼、不可儲存內容）。此次掃描於 swagger-ui 修補（第六（一））前執行，但已在 pip 移除與系統套件升級之後；swagger-ui 修補只動前端靜態檔，不影響後端 API，因此未重跑。登入 token 有效 15 分鐘，掃描中可能有部分請求落在 token 過期後，這部分屬未登入狀態的結果。

### （四）容器設定（人工檢查）

| 項目 | 結果 |
|---|---|
| 執行身分 | 非 root（uid 10001） |
| 根檔案系統 | 唯讀，寫入 `/srv` 被拒；只有 `/data` 可寫 |
| Linux capabilities | `cap_drop: ALL`；`no-new-privileges:true` |
| 對外埠 | compose 預設只綁 `127.0.0.1` |
| 映像檔內容 | 無 node、uv、pip；無開發機的 `.db`／`.jsonl`；Trivy 祕密掃描 0 筆 |
| 金鑰 | 預設第一次啟動產生於 `/data/.secrets.env`（權限 600）；可改以環境變數提供，且環境變數優先（已驗證） |
| 健康檢查 | `HEALTHCHECK` 已設定，容器狀態為 healthy |

## 五、OWASP Top 10:2025 對應

| 類別 | 前端 | 後端 | 容器進入點與映像檔 |
|---|---|---|---|
| A01 權限控制失效 | 通過 | 通過 | 通過（非 root、唯讀、capabilities 全移除） |
| A02 安全設定缺陷 | 通過（保留 `style-src 'unsafe-inline'` 風險接受） | 通過（S8414 屬設計層級） | 通過（Trivy 設定檢查 0 失敗） |
| A03 軟體供應鏈失效 | 通過（swagger-ui 內嵌 DOMPurify 已修補） | 通過 | 通過（pip 已移除；Debian 47 個 HIGH 尚無修補版，風險接受） |
| A04 加密機制失效 | 通過（S2245 非安全用途） | 通過 | 通過 |
| A05 注入 | 通過 | 通過 | 通過（ZAP API 主動掃描 0 失敗） |
| A07 認證機制失效 | 通過（S2068 誤判） | 通過 | 通過 |
| A08 軟體或資料完整性失效 | 通過 | 通過 | 通過（SHA256 校驗碼；稽核紀錄簽章驗證通過） |
| A10 例外狀況處理不當 | 待改善（S9383 1 筆） | 通過 | 通過 |
| A06、A09 | 無對應靜態檢查類別 | 同左 | 同左 |

## 六、修補紀錄

| 編號 | 發現 | 修補 | 複測 |
|---|---|---|---|
| （一） | Dependency-Check（RetireJS）在前端 `swagger-ui-bundle.js` 發現內嵌 **DOMPurify 3.4.16**，有 3 項已公告弱點：SAFE_FOR_TEMPLATES 繞過（critical）、IN_PLACE 鉤子（high）、SMIL 防護略過（low），皆於 3.4.17 修補。屬實：`/docs` 頁面會載入此檔 | `package.json`、`package-lock.json`：`swagger-ui-dist` 由 5.34.0 升至 **5.34.1**（內嵌 DOMPurify 3.4.17），只動這一個套件 | 重建後前端建置產物 Dependency-Check 0 筆；`/docs` 與 Swagger 檔案載入正常。**此項同時影響單機版 exe 的建置**（`build_exe.ps1` 也複製同一套件），exe 下次建置會一併帶入 |
| （二） | Trivy：基底映像檔的 `zlib1g` 有已修補的 2 項 HIGH | `docker/Dockerfile` 在交付階段加入 `apt-get upgrade`，建置時升級系統套件 | 複測：可修補的 HIGH 2 → 0 |
| （三） | Trivy：基底映像檔附的 `pip 25.0.1` 有 5 項 medium、1 項 low；執行時用不到 | `docker/Dockerfile` 移除 pip、setuptools、wheel（venv 內的套件不受影響） | 複測：Python 套件弱點 6 → 0，服務啟動與全部功能測試正常 |
| （四） | 交付包的 `SHA256SUMS.txt` 以 CRLF 換行輸出，Linux `sha256sum -c` 會找不到檔案（說明文件教 Linux 使用者這樣驗證） | `docker/build_image.ps1` 改以 LF 輸出 | `sha256sum -c SHA256SUMS.txt` 四個檔案皆 OK |

## 七、實際測試

測試對象為**由交付包 tar 重新匯入**的最終映像檔（映像檔 ID `fd33b982c09f`），以與 compose 相同的強化參數啟動（唯讀、`cap_drop ALL`、`no-new-privileges`）。

| 項目 | 方法 | 結果 |
|---|---|---|
| 啟動與健康檢查 | 全新磁碟區首次啟動 | healthy；自動產生 3 把金鑰 |
| 建立管理員、登入 | `docker exec ... create-admin`；第二次執行 | 建立成功；第二次被拒；登入取得 token |
| 前端流程（瀏覽器） | Playwright：登入 → 新增任務 → 上傳 5 萬筆 CSV → 屬性分類 → 隱私設定 → K-匿名化 → 下載 | 通過。風險評估通過、實用性達標，保留 50,000／50,000 筆 |
| 下載檔案 | 同上 | 結果 CSV（3.7 MB）與「使用注意事項」txt 皆下載成功，內容為去識別化後資料 |
| PDF 稽核報告 | 同上，點「輸出 PDF 紀錄」 | 下載有效 PDF（PDF-1.3、3 頁），Producer 為 **jsPDF 4.2.1**，頁面無 console 錯誤，CSP 未阻擋 |
| 登入頁 | 觀察 | 沒有顯示 Demo 測試帳號（交付版旗標生效） |
| K-匿名化 API | `/api/v1/k-anonymity`，5 萬筆 × 13 欄 | 200，抑制率 7.7%、k／l／t 皆通過 |
| 差分隱私 API | `/api/v1/dp`，同資料 | 200，輸出 7.3 MB，ε 消耗 7.0 |
| 風險評估 API | `/api/v1/risk/k-anonymity` | 200，再識別風險 0／0／0.6% |
| 稽核紀錄驗證 | `GET /history/{id}/verify`、`verify-log` | 簽章 valid；雜湊鏈完整，未發現篡改 |
| 重啟 | `docker restart` | `.secrets.env` 不變；登入與紀錄簽章驗證仍 valid |
| 環境變數金鑰 | 以環境變數提供三把金鑰啟動 | 不產生 `.secrets.env`，服務正常 |
| 上傳上限 | `OPEN_PETS_MAX_UPLOAD_MB=1`，上傳 3.3 MB | 回 413 與中文錯誤訊息 |
| 備份與還原 | 以 tar 備份資料磁碟區 → 還原到全新磁碟區 → 新容器 | 登入、5 筆紀錄、簽章驗證、`verify-log` 皆正常 |
| 唯讀環境運算 | 上述所有運算（含大於 1 MB 的上傳暫存） | 正常，暫存寫入 `/data/tmp` |
| 離線匯入 | 刪除本機映像檔 → `docker load -i` tar | 映像檔 ID 與匯入前一致 |
| 校驗碼 | `sha256sum -c SHA256SUMS.txt` | 4 個檔案 OK |
| compose 啟動 | `docker compose up -d`（以覆寫檔改容器名稱與埠，避免與本機既有的 `open-pets` 容器衝突） | healthy；非 root、唯讀、`cap_drop ALL`、`no-new-privileges`、只綁 127.0.0.1 皆確認 |

**既有 e2e 腳本需要更新**：`e2e/workflow.spec.ts` 是登入後直接上傳的舊流程，現在登入後會先進儀表板，要先按「新增去識別化任務」，腳本會在找不到上傳欄時逾時。這是腳本過時，與容器無關。新增 `e2e/docker_workflow.spec.ts` 與 `docker/playwright.docker.config.ts` 涵蓋新流程。

**未涵蓋的部分**

| 項目 | 說明 |
|---|---|
| 差分隱私的瀏覽器操作流程 | 只以 API 測試，UI 流程未走 |
| 取消運算 | 只測了對不存在的運算代碼回 `{"cancelled":false}`，未在運算進行中取消 |
| 接近 1,024 MB 的大檔案 | 只驗證了上限機制（1 MB 設定回 413），沒有實際上傳 1 GB |
| 壓力測試 | 未執行 `stress-test/` |
| Linux 主機、非 Docker Desktop 環境 | 只在 Windows 的 Docker Desktop 驗證；Linux 的 `sha256sum -c` 以 Git Bash 的同名工具驗證 |
| 多人同時使用 | 未測 |

## 八、建議處置（只列建議）

| 優先 | 項目 | 建議 |
|---|---|---|
| 1 | Debian 47 個 HIGH（含執行期使用的 `libsqlite3-0`） | 每月或有安全公告時重建映像檔並重跑 Trivy；Dockerfile 已含 `apt-get upgrade`，Debian 一有修補版就會帶入 |
| 2 | 映像檔以 tag 引用基底映像檔（`python:3.12-slim`、`node:20-alpine`），重建結果每次不同（本次重建後映像檔 ID 即改變） | 正式交付前對基底映像檔固定 digest，並把「交付的映像檔」與「掃描的映像檔」維持為同一份 tar |
| 3 | 映像檔未簽章 | 現在只有 SHA256 校驗碼，需以另一條管道傳遞才有防篡改效果；可加 cosign 簽章，離線環境以公鑰驗證 |
| 4 | 容器內以明文 HTTP 提供服務 | 對外開放時由反向代理終止 HTTPS（說明文件已載明）；可另提供附 nginx／Caddy 與憑證的 compose 範例 |
| 5 | 前端 S9383、S5850 | 補 `.catch`、時區判斷正規式加括號 |
| 6 | 前端開發工具 28 項弱點 | 升級 vite、vitest、eslint 相關套件（不影響交付物） |
| 7 | 更新 `e2e/workflow.spec.ts` | 改成新增任務後上傳的流程，或併入 `docker_workflow.spec.ts` |

## 九、結論

Docker 單一映像檔通過 SonarQube 品質門檻，沒有屬實的程式碼安全弱點；Python 與前端執行期相依都沒有已知弱點。檢測中發現並修補 3 項：swagger-ui 內嵌 DOMPurify（critical／high）、基底映像檔的 zlib1g 與不需要的 pip，另修正一個交付包校驗檔的格式問題。修補後的映像檔經瀏覽器流程、API、重啟、環境變數金鑰、上傳上限、備份還原、離線匯入與 compose 啟動測試，全部通過。

保留的風險：Debian 作業系統層 47 個尚無修補版的 HIGH（以非 root、唯讀、無 capabilities 降低可利用性，並建議定期重建）、CSP `style-src 'unsafe-inline'`（元件庫所需），以及映像檔尚無簽章。

## 十、追加（115/11/10）：離線／線上模式切換與授權交付物

同一份映像檔新增執行期模式（`OPEN_PETS_MODE=offline|online`、`OPEN_PETS_SHOW_DEMO_ACCOUNTS`），並在映像檔與交付包加入授權聲明。這批改動動到前端旗標（`featureFlags.ts`）、`index.html`、容器進入點與 Dockerfile，因此重新建置並重跑相關檢測與測試。

### （一）新增的程式面

| 項目 | 內容 |
|---|---|
| 執行期設定 | 容器進入點新增 `GET /runtime-config.js`，內容由環境變數產生；`index.html` 在主程式之前載入。前端旗標改為「執行期設定優先，沒有就退回建置旗標」，單機版 exe 與 nginx 版 Demo 站的行為不變 |
| 設定驗證 | `OPEN_PETS_MODE` 或 `OPEN_PETS_SHOW_DEMO_ACCOUNTS` 填錯會在啟動時中止並印出原因，且在產生金鑰之前檢查，不會留下殘餘資料 |
| 主機限制 | 設定 `OPEN_PETS_ALLOWED_HOSTS` 時自動補上 `127.0.0.1`、`localhost`，否則容器的 `HEALTHCHECK` 會被自己的主機限制擋下而判成 unhealthy。DNS rebinding 用的是攻擊者的網域，不受影響 |
| 線上模式 compose | `docker-compose.online.yml`，缺 `OPEN_PETS_ALLOWED_HOSTS` 時 compose 直接拒絕啟動 |
| 授權交付物 | 映像檔內 `/licenses/`（`LICENSE`、`THIRD_PARTY_NOTICES.txt`、`FRONTEND_THIRD_PARTY_LICENSES.md`）、OCI 標籤（`licenses=MIT`、`source`）；交付包另附 `REBUILD.md`、前端原始碼壓縮檔、映像檔 SBOM |
| 前端 SBOM 更新 | 先前升級 swagger-ui-dist 後 `sbom/` 仍寫 5.34.0，已重新產生為 5.34.1 |

### （二）驗證結果

| 項目 | 方法 | 結果 |
|---|---|---|
| 型別檢查 | `tsc -p tsconfig.app.json` | 通過 |
| 旗標單元測試 | 新增 `featureFlags.test.ts`（6 項）、既有 `desktopHiddenFeatures.test.tsx` | 全數通過 |
| 全套單元測試 | `vitest run` | 全套平行執行時 623 項中 39 項逾時失敗；放寬逾時並降低平行度後只剩 1 項（`kAnonymityStrategiesV2`）。**在未含本次改動的版本上同樣間歇失敗**，換上本次的 `featureFlags.ts` 則 8 項全過，判定為既有的不穩定測試，與本次無關 |
| 三種模式（瀏覽器） | Playwright `e2e/docker_modes.spec.ts`，三個容器 | offline：無 Demo 帳號、無維運日誌分頁；online：無 Demo 帳號、有維運日誌分頁；online＋`SHOW_DEMO_ACCOUNTS=true`：有 Demo 帳號、有維運日誌分頁。三種各 3 項測試全過，且兩個方向都有驗證 |
| `/runtime-config.js` | 三種模式 | 內容正確，`Content-Type` 為 JavaScript，`Cache-Control: no-cache`，未被 SPA 路由攔截成 index.html |
| 錯誤模式值 | `OPEN_PETS_MODE=foo` | 容器結束並印出「只接受 offline 或 online」，`/data` 保持空 |
| 線上模式主機限制 | `OPEN_PETS_ALLOWED_HOSTS=demo.example.test` | 容器 healthy；合法 Host 回 200，偽造 Host 回 400 |
| compose | 線上疊加（缺網域／有網域）、離線預設 | 缺網域時拒絕啟動；有網域時 healthy、非 root、唯讀、`cap_drop ALL`、只綁 127.0.0.1；離線預設 `offline`、不顯示 Demo 帳號 |
| 完整流程回歸 | `e2e/docker_workflow.spec.ts` | 通過：登入→上傳 5 萬筆→K-匿名化→下載 CSV 與 PDF，無 console 錯誤 |
| Trivy 映像檔 | 最終映像檔 | 與第四節修補後相同：作業系統 47 high／74 medium／65 low、可修補 0、Python 0、祕密 0 |
| ZAP baseline | 最終映像檔 | 失敗 0、警告 5、通過 63，與前次相同；新增的 `/runtime-config.js` 沒有帶來新警示 |
| 授權檔 | 進入映像檔 | `/licenses/` 三個檔案齊全；`THIRD_PARTY_NOTICES.txt` 列出 44 個 Python 套件（含 fpdf2 2.8.9、certifi 2026.10.23）；pip-licenses 及其相依未留在交付層 |
| 替換 fpdf2 | 照 `REBUILD.md`：複製後端原始碼（不動原件）→ `pyproject.toml` 改為 `fpdf2==2.8.8` → `uv lock` → 重新建置 | 建置成功；映像檔內 fpdf2 為 2.8.8，`THIRD_PARTY_NOTICES.txt` 自動同步為 2.8.8；以該映像檔實際產生中文 PDF 報告（`/api/v1/report`）成功 |
| 交付包 | `docker/build_image.ps1` | 11 個檔案，`sha256sum -c` 全數 OK；原始碼壓縮檔 1.1 MB，只含建置與說明所需的 300 個檔案，沒有 `cloudflared.exe`、簡報、內部報告 |

### （三）後端併入 repo 後的驗證（115/11/10 追加）

後端 `01_程式原始碼`（commit `1520899`，v2.0.2）以單一快照匯入 repo 的 `backend/`（174 個檔案，blob id 與來源逐檔相同），建置與 CI 改用它。

| 項目 | 方法 | 結果 |
|---|---|---|
| 只靠 repo 建置 | `docker buildx build -f docker/Dockerfile .`（不帶任何 `--build-context`） | 成功 |
| 後端內容未被改動 | 與搬位置之前（外部後端）的映像檔比對 | `/srv/app` 83 個檔案的雜湊逐檔相同；已安裝 Python 套件數相同（45） |
| 從原始碼壓縮檔建置 | 解開 `open-pets-source_<版本>.zip`，照 `REBUILD.md` 建置 | 成功；`/srv/app` 與正式映像檔相同。前端與授權檔的雜湊不同：前端是 Vite 把建置時間寫進程式，授權檔只差換行字元（`git archive` 在 Windows 依 `autocrlf` 轉成 CRLF，repo 內是 LF），內容相同 |
| 後端單元測試 | 乾淨容器：`uv sync --locked --group test` ＋ `uv run pytest -q` | **820 項全數通過**（80 秒）。測試相依在 `test` 群組，不在預設群組，只跑 `uv sync --locked` 會找不到 pytest |
| 三種模式、完整流程 | `docker_modes.spec.ts`（3 組）、`docker_workflow.spec.ts` | 全數通過；下載 CSV 與 PDF 正常，無 console 錯誤 |
| 交付包 | `dockeruild_image.ps1`（不再需要 `-BackendSrc`） | 12 個檔案，`sha256sum -c` 全數 OK；原始碼壓縮檔 6 MB，含 `backend/` 174 個檔案，無 `cloudflared.exe`、簡報、內部報告 |
| CI 與 Release 流程 | `actionlint`；workflow 內的打包 bash 與 Release 說明段落在本機實跑 | 無警告；打包產出與 `build_image.ps1` 相同的 12 個檔案；Release 說明內容正確 |

### （四）限制與未涵蓋

| 項目 | 說明 |
|---|---|
| 原始碼壓縮檔取自已 commit 的內容 | 建置時若有尚未 commit 的變更，腳本會警告。本次驗證時新改動尚未 commit，所以該次輸出的壓縮檔不含這些改動；正式交付前須先 commit 再建置 |
| 線上模式的 HTTPS | 容器內仍是明文 HTTP，由反向代理終止 HTTPS；第十一節已用 Caddy、nginx 實測 |
| GHCR／Releases 自動建置 | 已寫成 `.github/workflows/docker-image.yml`（後端已併入 repo 的 `backend/`），`actionlint`（含 shellcheck）無警告，打包段落與 Release 說明在本機實跑通過；**尚未在 GitHub 上實際執行**，GHCR 推送與 Release 建立未實測，首次建議先用手動執行（`workflow_dispatch`，只建置、掃描、打包，不推送、不發版）試跑 |
| 法律意見 | `THIRD_PARTY_NOTICES.txt` 與 `REBUILD.md` 依「LGPL 與 MPL 對 MIT 授權之影響」整理，該文件為一般性說明，不是法律意見；本案為委託採購，交付前建議由法務確認合約對授權的要求 |

## 十一、追加（115/11/10）：基底映像檔固定、簽章、反向代理與 HTTPS 實測

### （一）加固內容
| 項目 | 做法 |
|---|---|
| 基底映像檔固定 digest | `docker/Dockerfile` 的 `node:20-alpine`、`python:3.12-slim`（兩處）、`ghcr.io/astral-sh/uv:0.11.15` 都改為 `標籤@sha256:…`；workflow 的 Trivy 映像檔也固定。重建時所有層命中快取，確認固定的 digest 與先前使用的基底內容相同 |
| 更新機制 | 新增 `.github/dependabot.yml`（`docker`、`github-actions` 每週），`REBUILD.md` 補「基底映像檔固定在 digest」的手動更新步驟；建置時仍執行 `apt-get upgrade` |
| 映像檔簽章 | `docker-image.yml` 在 `v*` tag 發版時以 cosign 無金鑰簽章：簽 GHCR 映像檔 digest，並簽 `SHA256SUMS.txt`（bundle 放進交付包）；Release 說明與 `README_Docker部署.md` 附驗證指令。手動試跑不簽 |
| 反向代理範例 | 新增 `docker/proxy-examples/Caddyfile`、`nginx.conf`；交付包以 `Caddyfile.example`、`nginx.conf.example` 附上 |

### （二）重新掃描（固定 digest 後的映像檔）
Trivy（0.76.2，固定 digest）：作業系統 HIGH 47、CRITICAL 0、**可修補 0**、祕密 0，與第四節相同；原始資料 `trivy/trivy-image-pinned-digest.json`。47 項仍是 Debian 尚未提供修補版，維持風險接受。

### （三）反向代理＋HTTPS 實測
環境：線上模式容器（`OPEN_PETS_MODE=online`、`OPEN_PETS_ALLOWED_HOSTS=openpets.test`，唯讀、`cap_drop ALL`）前面分別放 Caddy 2（`tls internal`）與 nginx（自簽憑證），使用 `docker/proxy-examples/` 的設定，只把上游位址換成容器網路名稱。

| 項目 | 結果 |
|---|---|
| HTTPS 下完整流程（登入→上傳 5 萬筆→K-匿名化→下載 CSV 與 PDF） | Caddy、nginx 皆通過，無 console 錯誤；CSV 約 870 KB、PDF 約 847 KB |
| 回應標頭 | 應用程式的 CSP、X-Frame-Options、COOP／COEP 等原樣通過；代理加上 `Strict-Transport-Security` |
| Host 檢查 | 以錯誤 Host 直連容器得到 400（`ALLOWED_HOSTS` 生效）；經 nginx 轉送也是 400；Caddy 對不認得的 Host 自己回空的 200，不會轉到應用程式 |
| 後端看到的來源 IP | 全部是代理的 IP（不處理 `X-Forwarded-For`）。檢查後端原始碼：沒有任何地方使用用戶端 IP（稽核紀錄以帳號為準、也沒有以 IP 限流），所以沒有功能影響，容器入口未改動 |
| 認證方式 | Bearer token（登入回傳 JSON），不使用 cookie，無 cookie 屬性需調整 |

未涵蓋：真實網域與 Let's Encrypt 憑證、Cloudflare Tunnel、接近 1 GB 的上傳經過代理（`client_max_body_size`／`request_body max_size` 只驗證設定，沒有實際傳大檔）。

**測試資料的備註**：`e2e/fixtures/mock_privacy_data.csv` 只有 5 筆，預設 K=5、刪除上限 20% 時結果會被判為未達標，「下載處理後資料」按鈕因此停用，流程在這一步停住。前面各節的流程測試用的是 5 萬筆的資料（不在 repo）。這是測試資料的問題，不是代理或模式造成的（直連、離線、線上三種情形都一樣）。要在別台機器重跑 `docker_workflow.spec.ts`，需用 `E2E_CSV` 指定足夠筆數的資料。

## 十二、追加（115/11/10）：三條交付管道逐一驗證

交付方式定為三種：容器映像檔（GHCR）、原始碼、離線安裝（tar）。`.exe` 不再建置（已終止建置中的流程並清除產物，`packaging/` 程式碼保留，容器仍使用其中的 `launcher.py`）。

### （一）原始碼管道
| 項目 | 做法／結果 |
|---|---|
| 發現的問題 | Windows 工作資料夾的文字檔被轉成 CRLF，直接用它建出的映像檔與「解開原始碼壓縮檔後重建」的結果不同：`/srv/app` 83 個檔案中 76 個雜湊不同（前端打包檔與 `/opt/openpets` 也不同），差異只有換行 |
| 修正 | `docker/build_image.ps1` 改成先以 `git archive`（固定 `core.autocrlf=false`，輸出 repo 內的 LF）匯出原始碼，解開後從這份內容建置映像檔，再把同一個壓縮檔放進交付包 |
| 結果 | 交付映像檔與「解開壓縮檔、不靠 git、照 `REBUILD.md` 建置」的映像檔：`/srv/app`（83 檔）、`/srv/frontend`、`/opt/openpets` 三組內容雜湊完全相同 |
| 可追溯性 | 映像檔 label `org.opencontainers.image.revision` ＝ commit，與壓縮檔註解內的 commit 相同（實測皆為建置當下的 HEAD） |
| 壓縮檔內容 | 508 個項目；沒有 `cloudflared`、簡報、`node_modules`、`.env`、資料庫、紀錄檔、`__pycache__`、內部報告。有 17 個前端檔案本來就以 CRLF 存在 repo 裡（index 內即是 CRLF），GitHub Actions 的輸出相同 |

### （二）離線安裝（tar）管道
在全新資料夾、移除本機映像檔與磁碟區後，只憑交付包與 `README_Docker部署.md` 操作：

| 項目 | 結果 |
|---|---|
| `sha256sum -c SHA256SUMS.txt` | 13 個檔案（不含自身）全數 OK |
| `docker load -i` → `.env` → `docker compose up -d` → `create-user` | 通過，`healthy` |
| 外部請求 | 以 Playwright 攔截所有非本機請求，完整流程（登入、上傳 5 萬筆、K-匿名化、下載按鈕啟用）加上 `/docs`：**0 個外部請求** |
| 無對外網路 | 容器放在 `docker network create --internal` 網路，`healthcheck` 為 healthy，API 與登入正常；容器內連 `1.1.1.1`、`ghcr.io` 皆失敗（確認與網路隔離相容） |
| 升級與回退 | 以同一映像檔加標 `2.0.3`，改 `.env` 的 `OPEN_PETS_VERSION` 後 `up -d`：`.secrets.env` 雜湊不變、帳號仍可登入；改回 `2.0.2` 同樣正常 |
| 發現並補上的說明 | 本機 8080 已被其他容器佔用時，`compose up` 會報 `port is already allocated`；說明書疑難排解新增「在 `.env` 設 `OPEN_PETS_PORT`」 |
| 說明書補充 | 新增「三種取得方式」對照表、如何確認映像檔對應的 commit；根目錄 `README.md` 加交付方式簡介 |

離線環境無法驗證 cosign 簽章（需連到 Sigstore），以 SHA256 為準，說明書已載明。

### （三）容器映像檔（GHCR）管道
| 項目 | 結果 |
|---|---|
| workflow 調整 | 傳入 `OPEN_PETS_REVISION=$GITHUB_SHA`；版本含連字號（如 `2.0.0-rc1`）時 Release 標為預發版；`actionlint`（含 shellcheck）無警告 |
| 尚未驗證 | GHCR 推送、cosign 簽章與驗證、Release 建立、從 GHCR `docker pull`／`compose pull`、GHCR 映像檔與 Release 內 tar 為同一份內容。這些只有在 GitHub 上以 `v*` tag 實際執行才能驗證，建議先用 `v2.0.2-rc1` 預發版 tag 走一遍 |

## 附件：原始資料（`Docker版檢測原始資料/`）

| 位置 | 內容 |
|---|---|
| `sonarqube/` | 三個專案各類型的議題清單（JSON） |
| `dependency-check/` | `image-venv/`、`frontend-dist/`、`frontend-lock/` 的 Dependency-Check 報告（HTML、JSON）與紀錄；`pip-audit.json`、`npm-audit.json`（全部）、`npm-audit-prod.json`（執行期） |
| `trivy/` | 映像檔掃描（修補前 `trivy-image-before-fix.json`、修補後 `trivy-image-final.json`、交付映像檔 `trivy-image-delivered.json`）、Dockerfile 設定檢查、映像檔 SBOM（CycloneDX，修補前後各一份） |
| `zap/` | baseline（初測、最終映像檔）與 API 掃描報告（HTML、JSON、Markdown）及紀錄 |
| `e2e/` | 瀏覽器流程各步驟截圖、Playwright 結果 JSON、下載的使用注意事項 |
| `trivy/trivy-image-modes.json`、`zap/baseline-modes.*` | 第十節追加的最終映像檔掃描 |
