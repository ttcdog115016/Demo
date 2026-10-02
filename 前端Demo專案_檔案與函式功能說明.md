# 前端 Demo 專案（Privacy Toolkit）檔案與函式功能說明文件

> 專案位置：`C:\Users\TTCWEI\Desktop\Demo`
> 技術棧：React 19 + TypeScript + Vite + Ant Design 6 + Zustand + i18next + ECharts/Recharts
> 專案性質：K-匿名化（K-Anonymity）與差分隱私（Differential Privacy）資料去識別化工具的前端，操作流程分為 Step1 上傳 → Step2 欄位對應/清洗 → Step3 隱私規則設定 → Step4 執行結果與稽核，另含登入、儀表板、系統管理、審計歷史等模組。
> 本文件由程式碼實際內容分析整理而成，逐檔列出用途與函式/元件功能，供工程團隊快速掌握專案結構。

---

## 目錄

1. [專案總覽（package.json / vite.config.ts / 路由結構）](#一專案總覽)
2. [核心與共用檔案（App、main、api、store、config、i18n）](#二核心與共用檔案)
3. [登入 / 儀表板 / 設定 / 管理模組](#三登入儀表板設定管理模組)
4. [審計歷史（audit_logs）與工作區版面（workspace）](#四審計歷史與工作區版面)
5. [Step1 資料上傳 與 Step2 容器（資料預先處理）](#五step1資料上傳與step2容器)
6. [Step2 — K-匿名化欄位設定（KAnonymityMapping.tsx）](#六k匿名化欄位設定)
7. [Step2 — 差分隱私欄位設定（DifferentialPrivacyMapping.tsx）](#七差分隱私欄位設定)
8. [Step3 — 隱私規則設定（K-匿名 / 差分隱私）](#八step3隱私規則設定)
9. [Step4 — 執行結果、風險評估與稽核（Step4_Result.tsx）與測試檔案](#九step4執行結果與測試檔案)

---

## 一、專案總覽

### 1.1 package.json

- **專案名稱**：`privacy-toolkit`（`private: true`，版本 `0.0.0`，`type: module`）。
- **npm scripts**：
  - `dev`：啟動 Vite 開發伺服器
  - `build`：`tsc -b && vite build`（先型別檢查/專案參照建置，再打包）
  - `lint`：ESLint 檢查 `.ts/.tsx`，禁止未使用的 disable 指令，且警告數上限為 0（等同警告視為錯誤）
  - `preview`：本地預覽已建置的產出
  - `test`：執行 Vitest 單元測試
  - `test:e2e` / `test:e2e:ui`：執行 Playwright 端對端測試（含 UI 模式）
- **主要相依套件**：
  - 框架/核心：`react` / `react-dom` ^19.2.7（React 19）、`react-router-dom` ^7.18.2
  - UI 框架：`antd` ^6.5.0、`@ant-design/icons` ^6.3.2、`lucide-react`
  - 狀態管理：`zustand` ^5.0.14
  - 資料請求/查詢：`axios`、`@tanstack/react-query`
  - 資料處理：`papaparse`（CSV 解析）、`crypto-js`（雜湊/加密）
  - 圖表：`echarts` + `echarts-for-react`、`recharts`（同時使用兩套圖表庫）
  - 檔案上傳：`react-dropzone`
  - 多語系：`i18next` + `react-i18next`
  - 其他：`@vercel/toolbar`（Vercel 除錯工具列）
- **測試/開發工具**：`vitest`（單元測試）、`@playwright/test`（E2E）、`@testing-library/react` 全家桶（`jest-dom`、`user-event`）、`eslint` + `typescript-eslint` + `eslint-plugin-react-hooks`/`react-refresh`、`jsdom`、`typescript` ~6.0.2、`vite` ^8.1.1。

### 1.2 vite.config.ts

- `plugins: [react()]`：啟用 `@vitejs/plugin-react`（Vercel Toolbar 插件目前被註解停用）。
- `server`：
  - `host: '0.0.0.0'`：監聽所有網卡，允許外部裝置連入開發伺服器。
  - `allowedHosts: true`：解除 Vite 對外部網域名稱白名單的限制。
  - `proxy['/api']`：將 `/api/*` 請求轉發至 `http://127.0.0.1:8000`（本機 Docker 後端），並 `changeOrigin: true`，讓前端程式碼統一用相對路徑呼叫 API，避免瀏覽器端 CORS 問題。
- `preview`：預覽模式（`vite preview`）比照設定 `host`、`allowedHosts`、固定埠 `5173`，並同樣代理 `/api` 到本機後端 8000 埠。
- 檔案開頭 `/// <reference types="vitest" />` 表示此設定同時支援 Vitest 型別擴充。

### 1.3 路由結構（定義於 `src/App.tsx`）

- `/login` → `Login`
- `/forgot-password` → `ForgotPassword`
- `/request-access` → `RequestAccess`
- `/`（外層以 `RequireAuth` + `InnerApp` 包裹，需登入）
  - index → `RoleBasedRedirect`（依角色分流到 dashboard 或 admin）
  - 子群組一（`RBACGuard allowedRoles=['data_owner']`，越權導回 `/admin`）：
    - `dashboard` → `Dashboard`
    - `workspace` → `MainLayout`（去識別化精靈四步驟：Step1~Step4）
    - `audit` → `AuditLogHub`
  - 子群組二（`RBACGuard allowedRoles=['admin']`，越權導回 `/workspace?step=1`）：
    - `admin` → `AdminDashboard`
  - `settings/profile` → `ProfileSettings`（兩角色皆可）
  - `settings/preferences` → `SystemPreferences`（兩角色皆可）
  - `*` → 導回 `/`

---

## 二、核心與共用檔案

### `src/App.tsx`

**用途摘要**：整個前端 SPA 的根組件，負責掛載 React Router 路由表、以角色為基礎的存取控制 (RBAC)、Ant Design 全域佈局／主題／多語系 Provider，以及登入後主畫面 (側邊選單、頂部列、通知、使用者選單) 的渲染。

**常數**
- `DEFAULT_SESSION_TIMEOUT_MINUTES = 1800`：預設 session 閒置逾時分鐘數（備援值）。
- `MIN_STEP_INDEX=0` / `MAX_STEP_INDEX=3`：去識別化精靈的合法步驟範圍。
- `SIDER_WIDTH_LEVEL_PX_MAP`：依字體大小級距對應側邊欄展開寬度 (200~280px)。
- `FONT_SIZE_LEVEL_PX_MAP`：字體級距對應基準字級 (12~28px)。

**元件（內部關鍵邏輯）**
- `RequireAuth({children})`：讀取 `useAuthStore().isAuthenticated`，未登入則 `<Navigate to="/login" replace />`。
- `RBACGuard({allowedRoles, redirectPath})`：角色不在允許清單內時跳錯誤訊息並導向；符合則渲染 `<Outlet/>`。
- `RoleBasedRedirect()`：登入後首頁 `/` 的預設導向邏輯——`admin` 導向 `/admin`，其餘導向 `/dashboard`。
- `InnerApp({isDarkMode})`：登入後主佈局本體（Sider + Header + Content + Outlet），內含大量狀態與副作用：
  - 訂閱 `useAuthStore`、`useUIStore`、`useWorkspaceStore`（sessionTimeout、maintenanceMode、passwordExpired、currentStep、privacyMode、resetWorkspace）。
  - `useIdleTimeout(sessionTimeoutMinutesValue)`：呼叫外部 hook 啟動閒置登出計時。
  - 三個 `useEffect`：(1) 密碼過期強制彈出改密碼提示；(2) 維護模式開啟且角色為 `data_owner` 時強制登出；(3) 監聽網址參數 `?step=`，呼叫 `validateProgression` 驗證是否可跳頁，防止繞過必要設定直接改網址前進。
  - `handleLogoutConfirm()`：確認登出後執行 `logout()` + `resetWorkspaceAction()`。
  - `handleLogoClick()`：依角色與目前步驟決定點擊 Logo 的行為（導向 admin 首頁 或 確認後清空工作區並回 dashboard）。
  - 建立通知/使用者下拉選單，依角色動態組裝側邊選單項目。
  - `handleSidebarStepChange(targetStepIndex)`：側邊選單切換步驟時同樣呼叫 `validateProgression`。

**`export default function App()`**
- 讀取 `useUIStore`（深色模式、語言、字體級距）。
- `useEffect` 同步 `i18n.changeLanguage()`；監聽系統 `prefers-color-scheme`；把字體級距寫入 CSS 變數。
- `getAntdLocale()`：依語言代碼回傳 `zh_TW` / `en_US` antd locale。
- 包一層 `ConfigProvider`（主題演算法、主色 `#3f51b5`、圓角 12）與 `AntdApp`，內層是 `BrowserRouter`。

---

### `src/main.tsx`

**用途摘要**：React 應用程式的掛載進入點。

**啟動流程**
1. 匯入 `./index.css` 與 `./i18n`（先完成 i18next 初始化）。
2. `document.getElementById('root')` 取得容器，用 React 18 `createRoot(...).render()` 在 `<StrictMode>` 底下渲染 `<App/>` 與 `<VercelToolbar/>`。
3. 找不到 root 節點時於 console 印出錯誤訊息，不拋例外中斷程式。

---

### `src/App.css`

Vite/React 預設模板殘留的展示頁樣式（`.counter`、`.hero`、`#next-steps`、`.ticks` 等），與隱私保護核心業務邏輯無關，屬於範例首頁遺留樣式。

---

### `src/api/apiService.ts`

**用途摘要**：以 `axios` 封裝所有與後端去識別化／風險評估／報告產出相關的 REST API 呼叫，統一處理 multipart 表單組裝、回應 Header 報告解析、檔名解析與錯誤捕捉。

**型別**：K-匿名化群組（`KAnonymityOptions`、`KAnonymityQualityReport`、`KAnonymityResponse`）；差分隱私群組（`DifferentialPrivacyOptions`、`DpPerColumnBudgetReport`、`DpQualityReport`、`DpResponse`）；風險評估群組（`ProcessingConfig`、`AttackReport`、`CapReport`、`RiskAttackResponse`、`RiskCapResponse`、`ReportRequestPayload`、`ReportResponse`）。

**函式（皆為 async，統一 try/catch 回傳 `{success, ...}`）**
- `runKAnonymity(dataFile, configFile, options)`：POST `/api/v1/k-anonymity`，讀取 `x-quality-report` Header，回傳去識別化後 CSV Blob（不自動觸發下載）。
- `runDifferentialPrivacy(dataFile, configFile, options)`：POST `/api/v1/dp`，讀取 `x-budget-report` Header。
- `runRiskKAnonymity(originalFile, configFile)`：POST `/api/v1/risk/k-anonymity`，回傳三攻擊風險 `AttackReport`。
- `runRiskDp(originalFile, configFile)`：POST `/api/v1/risk/dp`。
- `runRiskCap(originalFile, processedFile, configFile)`：POST `/api/v1/risk/cap`，CAP 前後對比。
- `runReport(payload)`：POST `/api/v1/report`（JSON body），產出 PDF 報告 Blob。

所有函式皆以 console.error 記錄失敗原因並回傳 `{success:false, error}`，不讓例外往上拋。

---

### `src/components/ProtectedRoute.tsx`

**用途摘要**：一支獨立的、基於角色的路由防護組件（與 `App.tsx` 內部的 `RBACGuard` 功能重複，但改讀 `usePrivacyStore` 而非 `useAuthStore`，可能是重構過程留下的兩套並存實作）。

**`export default function ProtectedRoute({allowedRoles, redirectPath})`**：讀取角色、計算是否有權限，`useEffect` 中無權限時跳錯誤訊息，回傳 `<Navigate>` 或 `<Outlet/>`。

---

### `src/config/recommendationReferenceConfig.ts`

**用途摘要**：「套用系統推薦設定」按鈕使用的內嵌參考設定表。當資料集欄位名稱與此表鍵值完全相符時，優先套用此處參數；未列出的欄位則退回既有的中英文關鍵字判斷邏輯。

- `DP_COLUMN_BUDGETS_REFERENCE`：內建 5 個中文欄位（年齡、薪資、就醫次數、地區、生日）的 DP 型態/ε/δ/敏感度預設值。
- `KANON_COLUMNS_REFERENCE`：內建 10 個中文欄位（姓名、身分證號、生日、年齡、地區、職業、疾病、薪資、婚姻狀況、就醫次數）的隱私角色/型態/遮蔽策略。
- 檔案結尾註解說明：原規劃的「DP 敏感欄位自動判定」已被移除，因「DP 風險評估要求恰好指定 1 個敏感欄位」被確認為錯誤假設。

---

### `src/store/useAuditStore.ts`

**用途摘要**：獨立 Zustand store，管理歷史審計軌跡清單。**未使用 persist**。

- `auditLogs: AuditLogItem[]`：欄位含 `certificateId`、`fileName`、`privacyMode`、`operator`/`operatorRole`、三項風險、輸入/刪除/輸出筆數、以及「簽發當下快照」欄位（`columnsSnapshot`、`columnRoleSnapshot`、`identifierMaskStrategySnapshot`、`dpEnabledFieldNamesSnapshot`），確保歷史紀錄不受後續設定變更影響。
- `addAuditLog(entry)`：以 `crypto.randomUUID()` 產生 id，插入陣列最前端，**無去重邏輯**。

---

### `src/store/useAuthStore.ts`

**用途摘要**：獨立 Zustand store，管理使用者身分認證狀態。**未使用 persist**。

- State：`isAuthenticated`、`user: User | null`。
- Actions：`login(userData)`、`logout()`、`setUserRole(role)`（僅在 `user` 存在時更新）。

---

### `src/store/usePrivacyStore.ts`

**用途摘要**：整合式「主 Master 隱私 Store」，涵蓋身分認證、系統安全政策、去識別化精靈全部資料與參數、審計紀錄，使用 `persist` 中介層存到 **sessionStorage**（鍵名 `privacy-app-storage`）。與 `useAuthStore`、`useWorkspaceStore`、`useAuditStore`、`useUIStore` 有大量欄位重疊，疑似整合前的舊版全域 store 或規劃中要取代其他四支 store 的新版，實際使用情形需對照各功能元件的實際 import 才能確認。

**關鍵 Actions**：
- `addAuditLog`：**依 `certificateId` 去重**（與 `useAuditStore` 不同）。
- `getPermissions()`：只有 `data_owner` 角色才擁有全部權限，`admin` 角色權限開關全為 false。
- `setUserRole(role)`：直接寫死一組假使用者資料，屬於 demo/測試用捷徑。
- `setFileData(columns, data, fileName)`：依欄位名稱關鍵字自動建構初始 `dpFields` 陣列。
- `nextStep()`/`prevStep()`：以 `Math.min`/`Math.max` 夾住在 `[0,3]` 範圍內移動。
- `updateFieldDP`：同名函式三種多載（完整物件 / `(fieldName, partialObj)` / `(fieldName, key, value)`）。

`persist` 的 `partialize` 精選要持久化的欄位，**不含** `auditLogs`、`step4Cache`、`lastRunParamsHash`。

---

### `src/store/useUIStore.ts`

**用途摘要**：管理全域 UI 外觀偏好（深色模式、語系、字體大小級距），**未使用 persist**。

- State：`isDarkMode`（初始跟隨 `prefers-color-scheme`）、`language`（預設 `zh_TW`）、`fontSizeLevel`（預設 `medium`）。
- Actions：`setIsDarkMode`、`setLanguage`、`setFontSizeLevel`。

---

### `src/store/useWorkspaceStore.ts`

**用途摘要**：去識別化「工作區」專用 Zustand store，管理精靈四步驟的檔案、預處理規則、欄位分類、K-匿名/DP 詳細參數與 Step4 風險快照，是 `MainLayout` 底下各步驟元件實際操作的核心資料來源。**未使用 persist**（工作進度僅存在記憶體）。

**關鍵函式：`createInitialDPFields(datasetColumnsListArray)`**（模組內部函式）
- 依欄位名稱關鍵字（中英文）自動猜測型態（Numeric/Categorical/Text/Unknown）。
- **`Text` 型態預設停用 DP**（`enabled: type !== 'Text'`）——修正過的 bug：先前不分型態一律預設啟用，導致姓名/身分證等文字欄位一進畫面就顯示「已啟用差分隱私」。
- `Numeric` 型態額外帶入預設上下界（0~100）。

**State 重點欄位**：`dataFile`、`columns`、`previewData`、`preprocessingRules`、`missingValueRules`、`columnRoles`、`columnTypes`、`dpFields`、`datasetColumnNumericValuesMap`（數值型欄位完整實際數值快取，供跨步驟邊界涵蓋率校驗）、`step4Cache`、`lastRunParamsHash`、K-匿名參數（`kValue`/`lValue`/`tValue`/`enableLDiversity`/`enableTCloseness`/`maxSuppression`/`suppressionMethod`/`limitExceededAction`）、DP 參數（`queryCount`/`targetDelta`/`budgetLimitEpsilon`/`outOfBoundsStrategy`）。

**Actions**：`setDataFile`、`setPrivacyMode`、`nextStep`/`prevStep`（**不像 `usePrivacyStore` 一樣有夾範圍防呆**）、`setFileData`（呼叫 `createInitialDPFields`）、`resetWorkspace`（重置幾乎所有欄位，供 `App.tsx` 登出/點 Logo 時呼叫）。

---

### `src/i18n.ts`

**用途摘要**：以 `i18next` + `react-i18next` 建立全域多語系字典（`zh_TW` / `en_US`）並完成初始化，供全站文字透過 `useTranslation()` 的 `t()` 呼叫翻譯。字典依功能模組分成數十個一級分類（`common`/`login`/`admin`/`role`/`dashboard`/`step1`~`step4`/`menu`/`preferences`/`audit` 等），每個分類為扁平 key-value（部分含 i18next 內插變數）。呼叫慣例為 `t('分類.鍵名', 'fallback 預設文字')`，即使翻譯鍵不存在也能顯示合理訊息。`App.tsx` 以 `i18n.changeLanguage()` 因應 `useUIStore` 語言狀態變化即時切換。

---

## 三、登入/儀表板/設定/管理模組

### `src/features/login/Login.tsx`

**檔案用途**：登入頁面，提供帳密登入表單、Demo 測試帳號一鍵填入、快速免密登入。

- **內建 Demo 帳號**：`owner@test.com` / `password`（角色 `data_owner`）。
- `handleLogin(formValuesObj)`：模擬 800ms 網路延遲後比對 Demo 帳號，成功則 `login()` 寫入 AuthStore 並導回首頁；失敗顯示錯誤訊息。
- `handleQuickLogin()`：完全繞過帳密驗證，直接寫入固定的 `Data.Owner.A` 身份並導回首頁。
- `fillDemoAccount(emailKey)`：自動填入表單欄位，不自動送出。
- 另有「忘記密碼」「申請權限」連結。

---

### `src/features/login/ForgotPassword.tsx`

**檔案用途**：忘記密碼頁面。`handleResetPassword(formValues)`：模擬 1200ms 延遲後顯示成功訊息，1500ms 後導回登入頁。**全程沒有實際呼叫任何後端 API**，純前端模擬，無錯誤處理分支。

---

### `src/features/login/RequestAccess.tsx`

**檔案用途**：權限申請頁面（姓名/公司 Email/申請原因）。`handleRequest(formValuesObj)`：模擬 1500ms 延遲後顯示成功訊息，2000ms 後導回登入頁。同樣無實際 API 呼叫，無失敗分支。

---

### `src/features/dashboard/Dashboard.tsx`

**檔案用途**：一般使用者（Data Owner）登入後主控台，顯示歡迎訊息、建立新任務入口、本月處理任務統計卡片與最近處理紀錄表格。

- `recentLogs`（`useMemo`）：從 `useAuditStore` 訂閱的 `auditLogs` 取前 5 筆。
- `monthlyTaskStatistics`（`useMemo`）：用 `auditTimestamp`（非 `auditTime` 顯示字串）計算本月統計，計算總數/成功數/失敗數/成功率。
- 「新增去識別化任務」按鈕導向 `/workspace?step=1`；「查看完整紀錄」導向 `/audit`。
- `userInfo` 目前為寫死的 mock 資料（`Data.Owner.A`），尚未接上真實 Auth 使用者。

---

### `src/features/admin/AdminDashboard.tsx`

**檔案用途**：系統管理員登入後首頁，展示基礎設施健康狀態（皆為靜態展示數字）並提供密碼安全政策快速開關。

- `handleExpiryToggle(isChecked)`：切換密碼過期政策開關，整包寫回 `useWorkspaceStore` 安全設定。
- `handleDaysChange(days)`：驗證天數介於 1~365 之間才寫入，否則顯示錯誤且不寫入。
- 統計卡片數字（99.99% Uptime、3 次異常登入等）均為寫死靜態展示值。

---

### `src/features/settings/ProfileSettings.tsx`

**檔案用途**：個人資料與密碼變更頁，含即時密碼強度評估。

- `calculateStrength(password)`：0~100 分計分——長度計分（≥8 得 20 分，之後每字元 +5 分上限 40）、複雜度計分（大小寫/數字/符號各 +10）、易記性獎勵（≥16 字元 +15）、扣分懲罰（常見弱密碼樣式 -50、連續數字序列 -30、鍵盤序列 -30、重複字元 -20）。
- `getStrengthColor`/`getStrengthLabel`：依分數（≤40/≤80/其餘）回傳紅/橙/綠與弱/中/強標籤。
- `handleUpdatePassword()`：模擬 1000ms API 延遲後顯示成功訊息並清空表單；若使用者是因密碼過期被強制導來，解除過期標記並導回首頁。純前端模擬，未真的驗證「目前密碼」。
- 密碼規則：必填、最少 12 字元、需同時含大小寫數字符號、新密碼不可與舊密碼相同、兩次輸入需一致。

---

### `src/features/settings/SystemPreferences.tsx`

**檔案用途**：系統偏好與後台管理控制台。Admin 顯示三個管理分頁（帳號與權限管理／系統維運日誌／安全與環境參數）+ 共用「系統偏好設定」分頁；非 Admin 只顯示偏好設定分頁。

- 內部子元件 `BasicPreferences({currentUserRole})`：深色模式、語系、字體大小三項偏好設定，直接讀寫 `useUIStore`。
- `handleSaveEnvSettings()`：驗證表單後寫入 Session 逾時、密碼錯誤鎖定次數、密碼過期政策、維護模式等安全設定到 `useWorkspaceStore`。
- `handleAddUser`/`handleEditUser`/`handleDeleteUser`/`showDeleteConfirm`/`handleSaveUser`/`handleToggleStatus`：使用者清單 CRUD（本地 `useState`，非真實後端，`id` 用簡易生成）。
- `handleOpenResetPwd`/`handleSaveResetPwd`：強制重設密碼 Modal，**未真正呼叫任何 API**，純前端模擬。
- `handleTabChange`：把目前分頁寫入 URL query string，可被書籤/重新整理保留。
- 「系統維運日誌」分頁為純唯讀展示，並有 Alert 說明去識別化合規操作記錄需至前台 Audit Log 查看（呼應職責分離設計）。

---

### `src/features/settings/useIdleTimeout.ts`

**檔案用途**：自訂 Hook，實作「閒置逾時自動登出」機制。

**`useIdleTimeout(timeoutMinutesConfig = 30): void`**
- 未登入時 `useEffect` 立即 return，不註冊監聽器。
- 監聽事件：`mousemove`/`mousedown`/`keydown`/`scroll`/`touchstart`/`click`（`{passive:true}`），任一觸發更新 `lastActivityTimestampRef.current = Date.now()`。
- 每秒（`setInterval`）檢查：有效逾時分鐘數 `= max(1, timeoutMinutesConfig)`，若「目前時間 − 最後活動時間 ≥ 逾時毫秒數」則觸發登出：呼叫 `logout()`、顯示警告訊息、`clearInterval` 停止計時器。
- Cleanup：卸載時移除所有事件監聽並清除計時器，避免記憶體洩漏。
- 使用 `ref`（非 `state`）記錄活動時間戳，避免每次操作都觸發重新渲染。

---

## 四、審計歷史與工作區版面

### `src/features/audit_logs/AuditLogHub.tsx`

**檔案用途**：歷史審計軌跡與憑證數據庫檢視頁面，提供 KPI 統計、條件搜尋/過濾、Table 列表瀏覽，以及單筆憑證 Modal 詳情調閱與 PDF 憑證匯出。

- `filteredAuditLogsList`（`useMemo`）：依關鍵字（比對憑證編號/檔名/操作者）與保護模式雙條件過濾。
- `auditDashboardStatistics`（`useMemo`）：計算總憑證數與合格率。
- `dataTableColumnsConfig`：8 欄表格（憑證編號、檔案名稱、保護模式、操作者/角色、三項風險、綜合風險、審計時間、調閱操作）。
- `handleOpenCertificate(logItem)`：開啟憑證詳情 Modal。
- `getSnapshotRole(logItem, columnName)`：從紀錄的「簽發當下快照」讀取欄位角色，**不受後續 workspace 狀態變更影響**。
- 憑證調閱 Modal 內的「欄位處置與技術對照表」依角色與模式推導套用技術描述文字（完全移除/完全遮蔽/區間泛化/差分隱私加噪/保留原文）；底部顯示防篡改指紋與數位簽章（`components/AuditIntegrityPanel.tsx`，與 Step4 合規報告共用）。**2026-10-02 起改為真實值**（原為寫死的假字串）：
  - 產生（`utils/auditIntegrity.ts` 的 `createAuditIntegrity`，於 `usePipelineRunner` 寫入稽核紀錄前呼叫）：簽署文件＝憑證內容（不含 id）＋原始檔／輸出檔 SHA-256＋簽署時間＋金鑰 ID，以鍵值排序 JSON 序列化；指紋＝SHA-256(簽署文件)；簽章＝ECDSA P-256／SHA-256（Web Crypto）。結果存於 `AuditLogItem.integrity`。
  - 金鑰：瀏覽器端產生、私鑰不可匯出，存於 IndexedDB（無法使用時退回本次頁面記憶體）；公鑰（JWK）隨憑證保存，金鑰 ID＝公鑰指紋前 16 碼。
  - 驗證（`verifyAuditIntegrity`）：開啟憑證時依目前內容重組簽署文件，指紋不符、簽章驗不過或公鑰被換掉 → 顯示「驗證失敗，可能已被竄改」。
  - 限制：金鑰由使用者瀏覽器產生，只能證明「簽發後內容未被改動」，不能證明「由伺服器簽發」，正式環境應改由後端私鑰簽署；Web Crypto 僅在 HTTPS 或 localhost 可用，以 http://區網IP 開啟時只有指紋、無簽章；檔案超過 512MB 不計算檔案指紋。
- `handleDownloadPDF()`：動態從 CDN 載入 `html2pdf.js`，組裝參數後鏈式呼叫 `.set().from().save()` 匯出 PDF；`isPdfExporting` 狀態切換兩種 DOM 排版（匯出用/預覽用）。

---

### `src/features/workspace/MainLayout.tsx`

**檔案用途**：去識別化精靈主版面配置，負責頂部 Steps 導航條、中央動態分頁內容切換、底部上一步/下一步按鈕。

- `handleStepClick(targetStep)`：向前跨步時呼叫 `validateProgression` 驗證，失敗則顯示警告並把網址列導回目前合法步驟；向後回退不受限制。
- `handleNextStep()`/`handlePreviousStep()`：前進需驗證，後退呼叫 store 的 `prevStep()` 不需驗證。
- `handleResetWorkspace()`：`Popconfirm` 二次確認後清空全域狀態並導回 Step1。
- `renderCurrentStepContent()`：`switch` 對應渲染 `Step1_Upload`/`Step2_Mapping`/`Step3_Rules`/`Step4_Result`。

---

### `src/features/workspace/validateProgression.ts`

**檔案用途**：純函式，集中管理精靈四步驟「向前跳轉」的前置條件驗證邏輯。

**`validateProgression(target, current, workspaceStateSnapshot, translate): string | null`**
- 基礎跨步防呆：一次最多只能向前跳 1 步。
- 進入 Step2 門檻：需已完成資料匯入且已選擇隱私模式。
- 進入 Step3 門檻：K-匿名模式需至少標記一個 Quasi-identifier，且 Step2 本身驗證需通過；差分隱私模式需至少啟用一個 DP 欄位且所有啟用欄位參數設定完整（型態、數值邊界或類別清單）。
- 進入 Step4 門檻：Step3 本身驗證（K/L/T 參數或 DP 預算設定）需通過。
- 全數通過回傳 `null`，否則回傳對應的多語系錯誤訊息字串。
- 註解特別說明：DP 邊界是否涵蓋實際資料範圍**不在此處阻擋**（僅顯示橘色警告），因為加噪前仍會依邊界裁剪。

---

### `src/VercelToolbar.tsx`

**檔案用途**：載入並掛載 Vercel 開發者工具列的 wrapper 元件，不渲染任何 UI（回傳 `null`）。`useEffect` 掛載時呼叫 `mountVercelToolbar()`，卸載時執行其回傳的 cleanup。程式碼註解顯示**尚未區分開發/正式環境**，目前無論何種環境都會強制掛載，正式上線前建議加上環境判斷。

---

## 五、Step1資料上傳與Step2容器

### `src/features/step1_upload/Step1_Upload.tsx`

**檔案用途**：Step1 資料上傳頁面，負責拖拉上傳 CSV/Excel、CSV 編碼自動偵測與修正、解析預覽、選擇 K-匿名化或差分隱私保護模式。

**限制常數**：檔案大小上限 2GB、欄位數上限 50、預覽解析上限 1000 筆、畫面顯示前 5 筆。

**CSV 編碼偵測機制（重要 bug 修正）**：因後端 `_read_csv` 依序嘗試 `utf-8→utf-8-sig→big5`，容易把 GBK/Shift-JIS/Windows-1252 誤判為 Big5 產生亂碼且無錯誤提示，因此前移到前端處理：
- `detectCsvBytesEncoding(bytes)`：偵測 BOM，否則用 `TextDecoder`（嚴格模式）依序嘗試 utf-8 及候選編碼清單。
- `decodeCsvBytesToText(bytes, encoding)`：依偵測結果解碼為正確文字。
- `handleFileUpload(file)`：非 CSV（Excel）直接解析；CSV 則先偵測/解碼，若編碼非後端原生支援，重新用 `TextEncoder` 編碼為 UTF-8 位元組送出，並提示使用者「已自動轉換為 UTF-8」。
- `runPapaParseOnCsvText(text, fileName)`：對已解碼文字執行 `Papa.parse`，檢查欄位數上限，寫入 store 並預設隱私模式為 `k-anonymity`。
- `handleClear()`：清空檔案資料，回到初始上傳畫面。
- 畫面：未載入時顯示 `Dragger` 拖拉區；已載入時顯示預覽表格 + 「選擇脫敏保護模式」（K-匿名化/差分隱私 `Radio.Button`，各附 Tooltip 白話說明）+ 「並非互斥、可混合運用」提示 + 「前往 Step2」按鈕（未選模式前 disabled）。

---

### `src/features/step2_mapping/Step2_Mapping.tsx`

**檔案用途**：Step2「資料預先處理」容器/父層元件。第一階段設定缺失值處理與清洗策略鏈並即時預覽；第二階段依隱私模式切換渲染 `KAnonymityMapping` 或 `DifferentialPrivacyMapping` 子組件。

- `resolveTableScrollAreaAsPopupContainer(node)`：修正下拉選單因表格內部捲動區（`scroll={{y:250}}`）而浮貼蓋住標題列的跑版問題——找到 `.ant-table-body` 容器作掛載點，並明確賦予 `position:relative` 建立正確定位基準。
- `applyPreprocessStep(cellValue, step)`：單一清洗動作邏輯，支援 `trim`（去空白）、`slice`（截斷）、`anchor_truncate`（相對保留與截斷，如身分證部分遮蔽）、`type_cast`（型態轉換，**修正過**：整數轉換先 `parseFloat` 再 `Math.round`，避免 27.8 誤轉 278）、`normalize`（全形轉半形/大小寫）、`clamp`（上下界截斷）、`hash`（SHA-256／SHA-512 雜湊；鹽值可選不加鹽／自訂鹽值／系統隨機鹽值，加鹽時改用 HMAC 計算，2026-10-02 修正：原標示 SHA3 但實際為 SHA-2，已改標示；「目前時間戳」改為每次頁面載入產生一次的密碼學隨機鹽值。實作在 `utils/preprocessSteps.ts`，目前僅影響畫面預覽）、`regex_replace`（正則替換）。
- `applyPreprocessSteps(value, steps)`：依序套用多道策略；**雜湊為不可逆終點**，一旦執行即 `break` 不再繼續套用後續步驟。
- `handleStepActionChange`/`handleStepParamChange`/`handleAddPreprocessStep`/`handleRemovePreprocessStep`：欄位清洗策略鏈的 CRUD；新增/變更雜湊步驟時，其後步驟強制重設為「不處理」。
- `handleMissingValueStrategyChange`/`handleMissingValueParamChange`：缺失值策略（不處理/丟棄/常數填充/策略填充）設定。
- `renderSelectOptionWithHint`：共用渲染函式，在下拉選項旁加「？」懸浮說明圖示（缺失值策略/填充方法/清洗動作三處共用）。
- 僅 `data_owner` 角色可編輯（`isUserAllowedToEditRulesStatus`），其餘角色唯讀並顯示 Alert 警示。
- 下方「隱私強化技術設定」卡片依模式渲染對應子組件。

---

## 六、K匿名化欄位設定

### `src/features/step2_mapping/KAnonymityMapping.tsx`（全檔約 1976 行，本專案最大檔案）

**用途**：K-匿名化模式「資料表欄位設定清單」頁面，讓使用者設定每欄位的資料型態、隱私角色（Identifier/Quasi-identifier/Sensitive/Non-sensitive）、遮蔽/泛化策略及參數，並在「泛化階層對照」分頁維護類別階層樹、數值自訂區間、時間自訂區間。支援 JSON 匯入/匯出與即時預覽。

**頁面結構**：Tab1「欄位設定清單」（表格 + 展開列樣本預覽 + 顯示/隱藏 JSON 預覽 + 套用系統推薦設定 + 新增欄位）；Tab2「泛化階層對照」（數值/時間自訂區間卡片 + 類別階層映射表卡片）。

**關鍵型別**：`FieldDef`（單一欄位完整設定：type/role/maskStrategy/genStrategy/genParam/genMaxLevel/customBins 等）、`HierarchyTable`（類別階層映射表）、`CustomBin`、`GenHierarchySpec`。

**核心函式**：
- `buildExportJSON(fields, hierarchies)`：**全檔最核心的資料轉換函式**，把畫面設定轉為完整匯出 JSON（`field_attributes`/`masking_rules`/`generalization_rules`/`generalization_hierarchies`/`categorical_hierarchies`/`generalization_matrices` 等），同時是同步到 Zustand 與即時預覽的共同資料來源。
- `buildSpecCompliantPreviewJSON(fields, hierarchies)`：萃取出符合後端 v1.2.0 規格的精簡版本供預覽。
- `handleImportJSON(event)`：**全檔最複雜函式**，相容多種歷史/交付包 JSON 格式（`k_anonymity` 大包 vs 舊版 `privacy_targets.k_anonymity`；`generalization_matrices` 物件包 mapping vs 攤平陣列），逐欄位重建 `FieldDef`，並修正多項已知歷史 bug（詳見下方「已知問題」）。
- `handleApplyRecommendations()`：優先精確比對 `KANON_COLUMNS_REFERENCE`，否則用中英文關鍵字正則判斷角色/型態/策略。
- `getTransformedPreview(value, fieldConfig)`：模擬「此設定下原始值會被轉換成什麼樣子」供展開列預覽（數值 rounding/custom_bins、時間 time_rounding/time_range、類別 tree、字串 prefix/length 各自不同公式）。
- 表格 CRUD：`addField`/`removeField`；`addCustomBinRow`/`updateCustomBinField`/`removeCustomBinRow`；階層表 CRUD：`addHierarchyTable`/`removeHierarchyTable`/`addMappingRow`/`updateMappingCell`/`removeMappingRow`。
- 四個 `useEffect`：表單防呆驗證（回寫 `setStepValidation`）、初始化欄位清單（依欄位變動才重建，用模組快取避免覆蓋使用者設定）、**多對一同步至 Zustand**（欄位/階層表變動即整批寫入多個 store 欄位）、同步 Tree 策略對應的階層表。

**已知問題/修正歷史（程式碼內明確標註，供維護參考）**：
1. 字串「依長度」策略的 level 固定為 1（繞過後端 `bin_size×level` 雙參數設計）。
2. 字串「保留前後綴」策略改用 `genMaxLevel` 換算保留字數（`max(5-level,1)`），`genParam` 對此策略無效。
3. `type_cast` 整數轉換 bug 已修正（先 `parseFloat` 再 `Math.round`）。
4. `suppressionMethod` 等匯入/匯出格式不一致的一系列修正：匯入相容 v1.2.0 大包格式與舊版路徑；`generalization_matrices` 改為物件包 mapping 格式；`buildSpecCompliantPreviewJSON` 補上包在 `k_anonymity` 區塊內；數值型 `rounding` 策略補上處理；匯入時 `rounding` 分支補齊 `genMaxLevel=1`；類別型欄位層級 0 視為合法值不再被覆寫；Effect 2 快取鍵值 race condition 修正。
5. Effect 3（同步至 Zustand）改為「只要被觸發就必定寫入」，避免舊邏輯漏寫只改泛化參數/階層樹的情況。

---

## 七、差分隱私欄位設定

### `src/features/step2_mapping/DifferentialPrivacyMapping.tsx`（共 1218 行）

**用途**：差分隱私模式欄位設定頁面，設定每欄位型態（數值/類別/文字識別碼）、是否啟用 DP、數值裁剪邊界（lowerBound/upperBound）、文字最大長度。**本檔案不含雜湊演算法選單，也不含越界處理策略（截斷/環繞/鏡像）下拉選單**——這兩項屬於其他檔案（K-匿名頁面／全域參數）的功能，撰寫彙整文件時請勿混淆。

**核心函式**：
- `createInitialDPFields(columnNames)`：依欄位名稱關鍵字猜測型態（Numeric/Categorical/Unknown），給定初始 epsilon=1.0、delta=1e-5、數值型預設邊界 0~100。
- `updateFieldLocal(id, key, value)`：泛型輔助函式，更新單一欄位單一屬性。
- **邊界防呆檢查機制**：`useEffect` 監聽 `dataFile` 變化，用 `Papa.parse` **完整**（非預覽上限）重新解析 CSV，快取每個數值欄位的實際數值陣列到 `datasetColumnNumericValuesMap`（存在全域 store，供 `validateProgression.ts` 跨步驟驗證共用）。
- `boundRangeCoverageInfoMap`（`useMemo`）：計算每個啟用中的數值欄位，其設定邊界未涵蓋實際資料的筆數與百分比。
- `validationStatusResult`（`useMemo`）：每個啟用欄位需型態已選、數值型需邊界完整且下限<上限且邊界涵蓋實際資料範圍（**邊界未涵蓋視為硬性錯誤，會阻擋下一步**）、文字型需 `maxLength>0`。
- `generateExportJSON()`：組出完整匯出 JSON，含 `field_attributes`、`differential_privacy_rules`（內部格式）、`column_budgets`（符合 Open-PETs API 規格，含 `epsilon`/`delta`/數值型 `sensitivity=upperBound-lowerBound`）、`privacy_targets`。
- `buildSpecCompliantPreviewJSON()`：只萃取 `version`/`dataset`/`privacy_mode`/`column_budgets` 供預覽，與實際送後端格式一致。
- `handleImportJSON(event)`：相容三種格式——(A) v1.2.0 大包 `column_budgets`（`epsilon_budget`/`delta_budget`）；(B) 純陣列格式；(C) 「主 JSON」格式（`field_attributes`+`field_mechanisms`+`differential_privacy_rules`）。**匯入時絕對不覆蓋已存在的 `columns`**，避免破壞 Step1 已上傳的表頭。
- `handleApplyRecommendations()`：優先精確比對 `DP_COLUMN_BUDGETS_REFERENCE`，否則用關鍵字判斷數值型/類別型/識別碼型；數值型欄位邊界會**進一步重新完整解析 CSV**，改用實際資料的 min/max（`Math.floor`/`Math.ceil`）覆蓋預設邊界，比僅用關鍵字猜測更精確。
- `addField`/`removeField`：新增/刪除自訂欄位。

**表格欄位設定**：欄位名稱、資料型態（連續數值型/類別型/文字識別碼）、套用 DP 開關（文字型強制關閉）、邊界與規則設定（數值型：下限/上限 InputNumber，超界/順序錯誤時紅框並顯示常駐提示；類別型：顯示由系統自動萃取的唯讀提示；文字型：最大長度 InputNumber）、刪除操作。

---

## 八、Step3隱私規則設定

### `src/features/step3_rules/Step3_Rules.tsx`

**用途**：Step3 容器/父層，依 `privacyMode` 決定渲染 `KAnonymityRules` 或 `DifferentialPrivacyRules`，並提供「匯出最終隱私設定 JSON」功能。

- `handleExportJSON()`：彙整 Step1~3 全部工作區狀態，組裝合規 JSON（含 `field_attributes`/`masking_rules`/`generalization_rules`/`privacy_targets` 等），建立 Blob 並觸發瀏覽器下載。
- 若尚未選擇保護模式，顯示警告畫面並提供「返回上一步」按鈕。

---

### `src/features/step3_rules/KAnonymityRules.tsx`（約 700 行）

**用途**：K-匿名化「隱私防護與等價類設定」頁面：K/L/T 參數滑桿、QI 威脅組合選單、資料抑制策略設定、Pareto Front 隱私/效用權衡模擬圖表。

- **參數驗證 `useEffect`**：K≥2、K≤資料筆數、（啟用 l-diversity 時）K≥L、（啟用 t-closeness 時）0<T<1；全通過才 `setStepValidation(true,null)`。
- `enableLDiversity`/`enableTCloseness`：獨立開關，關閉時對應參數不送給後端（避免未指定敏感欄位時後端永遠回傳未通過）。
- **QI 威脅組合**：`quasiIdentifierColumnsArray` 篩出角色為 QI 的欄位；`addCombination`/`removeCombination`/`updateCombination` 管理多組自訂欄位子集（**目前僅前端本地 state，未接入匯出流程**，重新整理會遺失）。
- `getKAnonymityChartOption()`：計算 Pareto 邊界曲線（40點，凸曲線公式）+ 綜合隱私評分（K佔50%/L佔25%/T佔25%）+ 抑制率懲罰，產生 ECharts 長條圖設定。
- **抑制策略下拉選單**：「抑制方式」（`row_suppression` 列抑制 / `cell_suppression` 儲存格抑制）；「最大允許抑制率」滑桿（0~50%）；「超限處置」（停止並報錯 / 自動放寬K值 / 強制抑制）。

---

### `src/features/step3_rules/DifferentialPrivacyRules.tsx`（約 790 行）

**用途**：差分隱私「隱私預算/ε 參數」設定頁面：全域 δ 與總預算上限、每欄位獨立 ε/δ 微調（支援純 ε-DP 與 (ε,δ)-DP 混合模式）、跨 δ 基準等效 ε 換算、預算消耗儀表板、動態加噪分佈模擬圖。

- `updateFieldDP(id, key, value)`：欄位級 ε/δ/mode 更新共用入口。
- `handleApplyPrivacyLevelPreset(totalEpsilon)`：把目標總 ε 平均分配給所有已啟用欄位（**保留完整精度存入 store，不提前四捨五入**，避免除不盡時加總偏離設定值）。
- `equivalentConvertedFieldsList`（`useMemo`）：依「全域目標 δ」把每欄位原始 ε/δ 換算為「等效 ε」（公式：`equivalentEpsilon = originalEpsilon × log(1/globalTargetDelta)/log(1/originalDelta)`），供不同 δ 基準的欄位可放在同一標準下比較加總。
- **預算消耗判定**：使用率 ≥90% 危險、≥75% 警告；另用未封頂的原始總量判斷是否**已實際超支**（`isBudgetExceededStatus`）。
- 「當前保護強度」三級顯示：`ε≤1.0` 高強度/低風險（紫）、`1.0<ε≤10.0` 中強度/平衡（青）、`ε>10.0` 低強度/高風險（橘）——即使用者需求所稱「低風險/平衡/高風險」評估標準的實際呈現方式。
- **數值超出範圍處理方式**（`outOfBoundsStrategy`）：`clip`（截斷至邊界值）/`wrap`（環繞）/`reflect`（鏡像折返）——此為使用者需求所稱越界策略的實際所在檔案（非 DifferentialPrivacyMapping.tsx）。
- `getDPEchartsOption()`：模擬「原始分佈 vs. 加噪後分佈」折線圖，噪聲因子隨 ε 減少而增加（ε 越小曲線越趨平坦）。

---

## 九、Step4執行結果與測試檔案

### `src/features/step4_result/Step4_Result.tsx`（1762 行，全專案第二大檔案）

**用途**：Step4 執行結果頁面，組裝設定檔並呼叫後端 API 執行去識別化、呼叫風險評估 API（三攻擊 + CAP 前後對比）、結果視覺化、合規判定與錯誤處理、資料預覽、稽核憑證匯出。

> 說明：實際程式碼中**沒有** K-匿名化的「隱私與效用空間圖表（U/P軸）」散佈圖，效用面是以純文字/數字卡片（抑制率或消耗 ε、去識別欄位數）呈現，僅有一處 ECharts **長條圖**（三攻擊風險）。

**核心函式**：
- `evaluateComplianceValidity(mode, report, budgetLimit)`：K-匿名模式採後端 `is_valid`；差分隱私模式以「消耗 ε ≤ 使用者設定上限」判斷。
- **快取機制**：`currentParametersHashString`（參數指紋）+ `isAnalysisCacheValidStatus`（比對快取是否仍有效），避免設定未變時重複呼叫後端。
- `getCalculatedRole(columnName)`：計算欄位顯示角色（Identifier/Quasi-identifier/Sensitive/DP Sensitive/Retained/Non-sensitive），**修正過 bug**：`non-sensitive` 因含 `sensitive` 子字串曾被誤判為 Sensitive。
- **`runFullPipeline(isForceRun)`**：**全檔核心，約佔900行**，流程為：快取短路 → 組裝設定檔（K-匿名「大包」格式或DP `column_budgets`）→ 呼叫去識別化 API → 呼叫風險評估 API（DP模式因後端要求敏感欄位需為分類型，**逐一輪詢每個已啟用類別型欄位**取 worst-case 最大風險值）→ 呼叫 CAP 前後對比 API → 統計輸入/刪除/輸出筆數 → **風險分數正規化**（`normalizeAttackRiskScore`：`max(0,(S_ori−max(S_ctrl,S_base))/(1−max(S_ctrl,S_base)))`，`S_base=1/sample_size`）→ 寫入快取與稽核紀錄 → 錯誤處理（依 `error_code` 產生「技術版」與「白話版」兩種錯誤訊息）。
- `getAttackChartOption()`：產生三攻擊風險長條圖的 ECharts option（y軸最大值固定1.0，格式化為百分比）。
- `handleDownloadCSV()`：下載去識別化後 CSV。
- `handleDownloadPDF()`：動態載入 `html2pdf.js` 匯出合規審計報告 PDF。

---

### `src/features/step4_result/BackendReportDetails.tsx`（Step4「後端處理報告明細」，目前隱藏）

**用途**：以預設收合的面板顯示後端品質／預算報告中主畫面未呈現的項目——K-匿名：雜湊演算法、是否加鹽、系統套用的預設值、後端調整建議原文（含 Step2「最大層級」試算結果）；差分隱私：逐欄預算明細（型別、機制、ε、δ、換算為刻度後的敏感度、刻度、溢出處理）。顯示文字轉換在 `pipeline/backendReportFormat.ts`。

> **備註（2026-10-02）**：依使用者要求，此面板**暫不在 Step4 畫面顯示**，以免不熟悉技術細節的使用者更加混淆。`Step4_Result.tsx` 以常數 `SHOW_BACKEND_REPORT_DETAILS = false` 關閉；元件、文字轉換函式與單元測試（`__tests__/BackendReportDetails.test.tsx`）皆保留，日後要恢復時把常數改回 `true` 即可。相關功能一併隱藏：K-匿名 Step2「最大層級」欄位的「評估至／試算層級」（`qi_generalization_levels` 的上限，只用於後端報告的試算建議、不影響實際輸出）在 `KAnonymityMapping.tsx` 以常數 `SHOW_LEVEL_RANGE_TRIAL = false` 隱藏，類別型只剩層級數字、時間型不再出現「評估至」下拉；匯入設定檔帶入的上限仍保留並照原樣送出。恢復時兩個常數需同時改回 `true`。如需查閱試算結果，可從後端回應 Header `x-quality-report` 取得。

---

### 測試檔案

**`src/utils/__tests__/DifferentialPrivacyMapping.test.tsx`**：測試 DP 欄位設定表單，驗證數值型欄位未填上下界時阻擋「下一步」且顯示錯誤訊息；填齊合法參數後允許前進。

**`src/utils/__tests__/privacyEngine.test.ts`**：測試檔內自行定義三個示範版核心演算法（非直接 import 專案原始碼，供未來替換為實作檔案）：
- `generalizeNumeric(num, interval=10)`：數值區間化泛化，測試典型值、邊界值、自訂區間大小、負數/小數、`NaN`異常輸入。
- `generalizeDate(dateStr)`：日期截斷為 `YYYY-MM`，測試多種日期格式與異常輸入。
- `addLaplaceNoise(val, epsilon)`：差分隱私拉普拉斯加噪，測試型別正確性、ε越大噪聲越小、ε≤0防呆（`Math.max(epsilon,0.01)`）、`NaN`輸入安全回傳。

**`src/utils/__tests__/Step2_Mapping.test.tsx`**：測試 Step2 容器元件，mock 掉兩個子元件（`KAnonymityMapping`/`DifferentialPrivacyMapping`），驗證：(1) 正確顯示欄位名稱與預覽資料；(2) 依 `privacyMode` 狀態正確切換渲染對應子元件（`data-testid="dp-mapping"` / `"k-anon-mapping"`）。

---

## 附錄：檔案清單彙整

| 分類 | 檔案路徑 |
|---|---|
| 進入點/根組件 | `src/main.tsx`、`src/App.tsx`、`src/App.css`、`src/index.css`、`src/VercelToolbar.tsx` |
| API | `src/api/apiService.ts` |
| 共用元件 | `src/components/ProtectedRoute.tsx` |
| 設定檔 | `src/config/recommendationReferenceConfig.ts` |
| 狀態管理 | `src/store/useAuditStore.ts`、`useAuthStore.ts`、`usePrivacyStore.ts`、`useUIStore.ts`、`useWorkspaceStore.ts` |
| 多語系 | `src/i18n.ts` |
| 登入模組 | `src/features/login/Login.tsx`、`ForgotPassword.tsx`、`RequestAccess.tsx` |
| 儀表板/管理 | `src/features/dashboard/Dashboard.tsx`、`src/features/admin/AdminDashboard.tsx` |
| 設定 | `src/features/settings/ProfileSettings.tsx`、`SystemPreferences.tsx`、`useIdleTimeout.ts` |
| 審計 | `src/features/audit_logs/AuditLogHub.tsx` |
| 工作區版面 | `src/features/workspace/MainLayout.tsx`、`validateProgression.ts` |
| Step1 | `src/features/step1_upload/Step1_Upload.tsx` |
| Step2 | `src/features/step2_mapping/Step2_Mapping.tsx`、`KAnonymityMapping.tsx`、`DifferentialPrivacyMapping.tsx` |
| Step3 | `src/features/step3_rules/Step3_Rules.tsx`、`KAnonymityRules.tsx`、`DifferentialPrivacyRules.tsx` |
| Step4 | `src/features/step4_result/Step4_Result.tsx` |
| 測試 | `src/utils/__tests__/DifferentialPrivacyMapping.test.tsx`、`privacyEngine.test.ts`、`Step2_Mapping.test.tsx` |
