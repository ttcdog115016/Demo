# 資料隱私保護技術套件 前端源碼掃描報告（SonarQube，正式版）

> 依據 RFP 貳、四、(一)、2：以第三方工具進行源碼檢測，工具須支援最新版本之 OWASP Top 10，並於交付原始碼時附上源碼檢測報告
> 本報告只涵蓋前端程式碼，結構與設定比照 115/11/03 之《前端SonarQube源碼掃描報告》，並新增「與 11/03 之差異」一節。
> 原始輸出：`前端檢測原始資料_正式版/sonarqube/`、`前端檢測原始資料_正式版/npm-audit/`、`前端檢測原始資料_正式版/zap/`

## 一、檢測資訊

| 項目 | 內容 |
|---|---|
| 受測標的 | 資料隱私保護技術套件前端（正式版，已移除 Demo 測試帳號） |
| 受測版本 | Git 分支 `chore/remove-demo-accounts`，以 `origin/main`（`6dcc304`，v2.0.0-rc5 之後）為基底，受測原始碼 commit `3f6d268` |
| 檢測執行 | 本案開發團隊，於本機以 Docker 執行 SonarQube 官方映像檔（臨時容器，掃描後移除） |
| 檢測日期 | 115 年 11 月 16 日 |
| 源碼掃描工具 | SonarQube Community Build 26.10.0.133078 加 SonarScanner CLI（`sonarsource/sonar-scanner-cli` 最新映像） |
| 品質設定檔 | Sonar way core（該版本內建預設，涵蓋 TypeScript、JavaScript、CSS、HTML、密鑰偵測） |
| 掃描範圍 | `src/` 與 `index.html`，**排除單元測試**（`__tests__/`、`*.test.ts(x)`），即實際打包的程式碼：121 個檔案、24,452 行程式碼 |
| 相依套件檢測 | npm audit（npm 11.17.0，比對 GitHub Advisory Database），全部套件與僅執行期（`--omit=dev`）各一份 |
| 弱點掃描工具 | OWASP ZAP 2.17.0（`zap-baseline.py` 被動式掃描，與 11/03 相同） |
| 弱點掃描範圍 | 依 repo 根目錄 `Dockerfile`、`nginx.conf` 建置之 nginx 容器（以同一份原始碼建置），共探索 8 個網址。測試容器放在專用 Docker 網路、不對外開埠，`/api/` 轉送目標指向不可連線之位址（回 502），掃描不會觸及任何後端 |
| 品質門檻 | Sonar way（內建），結果：**通過** |

## 二、OWASP Top 10 對應

SonarQube 的安全性規則依 CWE 與 OWASP Top 10 分類。結果依 **OWASP Top 10:2025**（最新版）彙整，並附 2021 版對照：

| 2025 類別 | 2021 對照 | 檢出筆數 | 人工判讀後屬實 | 結果 |
|---|---|---|---|---|
| A01 權限控制失效 | A01 | 0 | 0 | 通過 |
| A02 安全設定缺陷 | A05 | 0 | 0 | 通過 |
| A03 軟體供應鏈失效 | A06 | 無對應檢查類別 | — | 另以 npm audit 檢測：執行期相依弱點 **0 筆**（見第六節） |
| A04 加密機制失效 | A02 | 10（S2245 虛擬亂數） | 0 | 通過 |
| A05 注入 | A03 | 0 | 0 | 通過 |
| A06 不安全設計 | A04 | 無對應檢查類別 | — | — |
| A07 認證機制失效 | A07 | 8（S2068 疑似寫死密碼） | 0 | 通過 |
| A08 軟體或資料完整性失效 | A08 | 2（S6389 雙向控制字元） | 0 | 通過 |
| A09 安全記錄及警示失效 | A09 | 無對應檢查類別 | — | —（稽核紀錄由後端負責） |
| A10 例外狀況處理不當 | 無（2021 版 A10 為 SSRF，前端不適用） | 24（S9383 Promise 未處理，屬可靠性） | — | 待改善 |

**說明**：SonarQube 26.10 已將過去的「安全熱點」（Security Hotspot）規則改列為 Vulnerability（標籤 `former-hotspot`），所以本次安全熱點計數為 0。20 筆 Vulnerability 都屬於這類規則，工具本身也標示需要人工確認，判讀見第四節。

## 三、總體結果

| 類型 | MINOR | MAJOR | CRITICAL | BLOCKER | 合計 |
|---|---|---|---|---|---|
| Bug（可靠性） | 0 | 28 | 2 | 0 | 30 |
| Vulnerability（安全性） | 0 | 20 | 0 | 0 | 20 |
| Code Smell（可維護性） | 16 | 7 | 0 | 0 | 23 |
| **合計** | 16 | 55 | 2 | 0 | **73** |

- 安全熱點：0
- 品質門檻：通過
- 20 筆 Vulnerability 經逐筆人工判讀，**沒有屬實之安全性弱點**
- **`Login.tsx` 沒有任何議題**；全部原始碼搜尋不到 Demo 測試帳號之帳號與密碼（見第八節）

## 四、安全性議題（20 筆）逐筆判讀

| 規則 | 內容 | 筆數 | 位置 | 判讀 | 理由 |
|---|---|---|---|---|---|
| S2068 | 疑似寫死之密碼 | 8 | `src/i18n.ts`（72、129、131、143、962、965、969、972 行） | **誤判** | 都是含「密碼」字樣之介面翻譯字串，例如「新密碼不可與目前密碼相同」「兩次輸入的密碼不一致」，不是密碼值。已逐行確認 |
| S2245 | 虛擬亂數產生器用於安全情境 | 10 | `KAnonymityMapping.tsx`（5）、`DifferentialPrivacyMapping.tsx`（2）、`useAuditStore.ts`（2）、`useSystemLogStore.ts`（1） | **非安全用途** | 位置分佈與 11/03 相同（5／2／2／1）：以 `Math.random()` 產生畫面元件或紀錄之識別碼，不用於金鑰、權杖、密碼或任何安全決策；憑證與權杖皆由後端產生 |
| S6389 | 原始碼含雙向控制字元 | 2 | `src/utils/csvUploadValidation.ts`（316、332 行） | **刻意使用** | 為了偵測並標示欄位名稱中的不可見字元（零寬字元、方向控制字元等），在正規式字元類別內直接寫入；與 11/03 相同 |

## 五、可靠性及可維護性議題

| 規則 | 類型 | 嚴重度 | 內容 | 筆數 | 位置 | 說明 |
|---|---|---|---|---|---|---|
| S9383 | Bug | MAJOR | Promise 未處理 | 24 | `App.tsx` 14、`MainLayout.tsx` 5、`SystemPreferences.tsx` 3、`AuditIntegrityPanel.tsx` 1、`i18n.ts` 1 | 非同步呼叫沒有加 `await` 或 `catch`；失敗時使用者可能看不到提示 |
| S2871 | Bug | CRITICAL | `sort()` 未指定比較函式 | 2 | `KAnonymityMapping.tsx` 828、829 行 | 排序後僅用來比較「欄位集合是否相同」（先排序再 `join(',')` 比對），順序是否符合語言習慣不影響結果 |
| S6324 | Bug | MAJOR | 正規式含控制字元 | 3 | `preprocessSteps.ts` 47 行 | 刻意比對後端認定之空白字元（Tab、CR、LF），與後端規則一致 |
| S5850 | Bug | MAJOR | 正規式錨點未分組 | 1 | `authApi.ts` 526 行 | 時區判斷之正規式，只影響時間顯示，與認證邏輯無關 |
| S7773 | Code Smell | MINOR | 應使用 `Number.parseInt` 等靜態方法 | 16 | 多個檔案 | 寫法建議 |
| S8786 | Code Smell | MAJOR | 正規式可能有超線性回溯 | 4 | `csvUploadValidation.ts`（333、666 行）、`configFileParse.ts` 46 行、`backendErrorExplain.ts` 59 行 | 處理對象是使用者自己的欄位名稱或錯誤訊息，在使用者自己的瀏覽器內執行，最壞情況是當前頁籤變慢 |
| S6848 | Code Smell | MAJOR | 非互動元素綁定互動事件 | 3 | `App.tsx` 405、441 行、`CollapsibleCardHeader.tsx` 55 行 | 無障礙性議題（鍵盤操作） |

## 六、相依套件檢測（npm audit）

| 範圍 | 嚴重 | 高 | 中 | 低 | 合計 |
|---|---|---|---|---|---|
| 全部套件（含開發與建置工具） | 0 | 3 | 17 | 0 | 20 |
| **僅執行期（`--omit=dev`，隨產品交付）** | **0** | **0** | **0** | **0** | **0** |

- 20 筆都屬開發與建置工具（`browserslist`、`undici`、`zod`〔高〕；`eslint`、`typescript-eslint` 系列、`@cyclonedx/cyclonedx-npm` 及其相依等〔中〕），不進入 `dist/` 與 Docker 映像檔。
- 與 osv-scanner 對 `package-lock.json` 的結果一致（唯一的執行期套件命中 `xlsx` 0.20.3 為誤報：本專案從 `cdn.sheetjs.com` 安裝已修正版本，npm 公共登錄沒有該版本）。

## 七、弱點掃描（OWASP ZAP）

**結果**：PASS 63、WARN 5、FAIL 0（11/03 修補後複測為 PASS 58、WARN 10、FAIL 0）。沒有發現注入、敏感資料外洩、Cookie 設定缺陷，或中風險以上的可利用弱點。

| 風險 | 警示 | 筆數 | 判讀 |
|---|---|---|---|
| 中 | CSP：`style-src` 含 `'unsafe-inline'`（10055） | 3 | **風險接受**，理由與 11/03 相同：antd 於執行時以 `<style>` 注入樣式；`script-src` 已限制為 `'self'`，不允許行內腳本 |
| 低 | Unix 時間戳記揭露（10096） | 5 | 誤判：打包後 JS 內的數字常數，不是敏感資訊 |
| 資訊 | 可疑註解（10027）、現代 Web 應用程式（10109）、可儲存與快取之內容（10049） | 2／3／3 | 屬預期行為，不需處置 |

- 回應標頭確認具備：`Content-Security-Policy`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Permissions-Policy`、`Cross-Origin-Opener-Policy`、`Cross-Origin-Resource-Policy`；`Server` 標頭不再揭露版本。
- 與 11/03 修補後複測之保留項目完全一致，沒有新增警示。
- `Strict-Transport-Security` 需由提供 HTTPS 之反向代理設定（見 `nginx.conf` 註解），本次測試容器為 HTTP。

## 八、與 11/03 報告之差異（移除 Demo 測試帳號之影響）

| 項目 | 11/03 | 本次 | 說明 |
|---|---|---|---|
| 檔案數／程式碼行數 | 117／24,277 | 121／24,452 | 兩次受測版本不同（11/03 為 `feature/backend-v2-integration` 之 commit `e4ef1bd`） |
| 議題總數 | 73 | 73 | Bug 30、Vulnerability 20、Code Smell 23，分類與嚴重度分佈相同 |
| 安全熱點 | 0 | 0 | — |
| 品質門檻 | 通過 | 通過 | — |
| `Login.tsx` 議題 | S6848 一筆（Demo 帳號區塊以非互動元素綁定點擊） | **0 筆** | Demo 區塊已整個移除；S6848 的第三筆改為 `CollapsibleCardHeader.tsx` |
| 寫死之測試帳密 | 登入頁 Demo 區塊（`owner@test.com`、`admin@test.com` 及其密碼） | **無** | 另以 `git grep` 與 `dist/` 搜尋確認 |
| 執行期相依弱點（npm audit） | 0 | 0 | — |
| 弱點掃描（ZAP） | 修補後 PASS 58／WARN 10／FAIL 0 | PASS 63／WARN 5／FAIL 0 | 保留項目與 11/03 複測一致 |
| 重複率／可維護性評等 | 6.7%／A | 6.5%／A | — |

## 九、量測指標

| 指標 | 數值 |
|---|---|
| 檔案數 | 121 |
| 程式碼行數（ncloc） | 24,452 |
| 註解密度 | 18.3% |
| 重複率 | 6.5% |
| 技術債 | 127 分鐘 |
| 可維護性評等 | A |
| 可靠性評等 | D（受 2 筆 CRITICAL Bug 影響，即 S2871 排序） |
| 安全性評等 | C（20 筆 Vulnerability 均為待人工確認之原安全熱點規則；判讀後沒有屬實者） |

## 十、建議處置

**（一）不須修補**：S2068、S2245、S6389 共 20 筆，判讀為誤判、非安全用途或刻意使用，不構成安全性缺陷。若要消除工具告警，可選擇性調整：S2245 改用 `crypto.randomUUID()`；S6389 改用 `\u` 跳脫寫法。

**（二）建議納入後續維護**

| 優先 | 項目 | 建議 |
|---|---|---|
| 1 | S9383 Promise 未處理（24 筆） | 補上 `catch`，並以訊息提示使用者 |
| 2 | S2871 排序（2 筆） | 加上 `localeCompare` 比較函式（目前僅用於集合比對，不影響結果） |
| 3 | S8786 正規式回溯（4 筆） | 將 `/^ +\| +$/g` 改為先 `trimStart`／`trimEnd` 再計算空白數 |
| 4 | 其餘 Code Smell | 依寫法建議逐步調整 |

## 十一、結論

前端程式碼（121 個檔案、24,452 行）通過 SonarQube 品質門檻，沒有 BLOCKER 等級議題。

20 筆安全性議題都屬於工具要求人工確認的原安全熱點規則，經逐筆判讀，**沒有屬實的安全性弱點**；隨產品交付之執行期相依套件經 npm audit 檢測為 0 筆弱點。移除 Demo 測試帳號後，登入頁沒有任何議題，原始碼中也不再有寫死之測試帳號與密碼。OWASP ZAP 被動式掃描沒有 FAIL，5 筆警示皆為 11/03 已判讀之保留項目。依 OWASP Top 10:2025 分類，有對應檢查的類別都通過，A10 例外狀況處理有 24 筆可靠性議題，列為後續改善項目。

**本次未涵蓋**：後端 SonarQube／Greenbone（後端另有報告）；ZAP 為被動式掃描，未做主動攻擊式掃描。源碼有異動時，應重新掃描並更新本報告。

---

**重新掃描方式**

用 `sonarqube:community` 容器加上 `sonarsource/sonar-scanner-cli`，掃描參數如下：
- `sonar.sources=src,index.html`
- `sonar.exclusions=**/node_modules/**,**/__tests__/**,**/*.test.ts,**/*.test.tsx`
- 品質設定檔：Sonar way core（預設）；`sonar.scm.disabled=true`

相依套件：`npm audit --json` 與 `npm audit --omit=dev --json`。

弱點掃描：`docker build` 前端映像檔後，放入專用 Docker 網路並以 `--add-host host.docker.internal:127.0.0.1` 啟動（使 `/api/` 不會連到真實後端），再執行 `zap-baseline.py -t http://<容器名稱>:8080 -r zap-baseline.html -J zap-baseline.json -I`。
