# 資料隱私保護技術套件 Docker 單一映像檔 原始碼檢測暨弱點掃描與實測報告

> **受測物**：`open-pets-app:2.0.2`，前端與後端合併的單一 Docker 映像檔（建置檔在 `docker/`）。交付包為 `docker/dist/open-pets-app_2.0.2/`，內有映像檔 tar、`docker-compose.yml`、`SHA256SUMS.txt`、部署說明。
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

## 附件：原始資料（`Docker版檢測原始資料/`）

| 位置 | 內容 |
|---|---|
| `sonarqube/` | 三個專案各類型的議題清單（JSON） |
| `dependency-check/` | `image-venv/`、`frontend-dist/`、`frontend-lock/` 的 Dependency-Check 報告（HTML、JSON）與紀錄；`pip-audit.json`、`npm-audit.json`（全部）、`npm-audit-prod.json`（執行期） |
| `trivy/` | 映像檔掃描（修補前 `trivy-image-before-fix.json`、修補後 `trivy-image-final.json`、交付映像檔 `trivy-image-delivered.json`）、Dockerfile 設定檢查、映像檔 SBOM（CycloneDX，修補前後各一份） |
| `zap/` | baseline（初測、最終映像檔）與 API 掃描報告（HTML、JSON、Markdown）及紀錄 |
| `e2e/` | 瀏覽器流程各步驟截圖、Playwright 結果 JSON、下載的使用注意事項 |
