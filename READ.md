# 🛡️ Privacy App - 企業級數據隱私合規與去識別化平台

Privacy App 是一個專為企業 Data Owner 與系統管理員 (Admin) 設計的前端單頁應用程式 (SPA)。
本系統提供直覺的「數據去識別化嚮導 (Wizard)」，引導使用者透過 K-匿名化 (K-Anonymity) 或差分隱私 (Differential Privacy) 技術處理敏感資料，並在最終產出符合法規要求的「合規審計憑證 (Audit Certificate)」。

## ✨ 核心亮點功能 (Key Features)

* **🔐 雙重隱私保護引擎**：完整支援 K-Anonymity (屬性泛化與抑制) 與 Differential Privacy (拉普拉斯加噪與預算消耗) 設定。
* **🧙‍♂️ 四步引導嚮導 (Wizard)**：
  1. **資料匯入**：支援 CSV 格式巨量資料上傳與基本預覽。
  2. **屬性分類**：針對不同欄位設定清洗規則 (Regex、Trim) 與隱私角色 (直接識別碼、準識別碼等)。
  3. **隱私設定**：可視化調整 $K$ 值或配置每個數值/類別型欄位的 DP 參數 ($\epsilon$、上下界)。
  4. **預覽匯出**：非同步模擬運算管線，動態展示三大攻擊殘餘風險 (Singling/Linkability/Inference) 與數據可用性 (JSD/保留率)。
* **📜 歷史審計與憑證管理 (Audit Log Hub)**：基於 WORM 原則設計的不可篡改日誌庫，自動記錄每次合規操作，並支援一鍵匯出 PDF 高清實體憑證。
* **👮‍♂️ 嚴格的狀態與路由防護 (Gateway Guard & RBAC)**：
  * **RBAC 存取控制**：嚴格區分 Admin (系統管理) 與 Data Owner (業務操作) 視圖，程式碼完全解耦。
  * **路由越權防護**：絕對守門員機制，自動攔截惡意修改網址或跳躍步驟的行為，強制遣返未完成設定的頁面。
* **🌗 企業級 UI/UX**：支援深/淺色主題無縫切換、i18n 多國語系，並具備專業的資料視覺化圖表。

## 🛠️ 技術棧 (Tech Stack)

* **核心框架**: React 18 + TypeScript + Vite
* **狀態管理**: Zustand (無痛跨元件狀態共享)
* **UI 元件庫**: Ant Design (v5) + 自定義 Design Token
* **資料視覺化**: Apache ECharts (`echarts-for-react`)
* **路由管理**: React Router DOM (v6)
* **多國語系**: `react-i18next`
* **工具庫**: `html2pdf.js` (前端 PDF 渲染)

## 📂 專案架構 (Project Structure)

本專案嚴格遵循 **Feature-Sliced Design (FSD)**，將關注點高度分離，並保持核心路由檔的極致輕量：

~~~text
src/
├── features/                 # 🌟 依業務功能模組化 (Feature-sliced)
│   ├── admin/                # Admin 系統管理員專屬大廳
│   ├── workspace/            # Data Owner 去識別化嚮導主版面與防呆邏輯
│   │   ├── MainLayout.tsx
│   │   └── validateProgression.ts 
│   ├── audit_logs/           # 歷史審計憑證管理
│   ├── login/                # 登入與存取請求
│   ├── settings/             # 系統偏好與環境安全設定
│   ├── step1_upload/         # Wizard Step 1: 資料匯入
│   ├── step2_mapping/        # Wizard Step 2: 屬性分類
│   ├── step3_rules/          # Wizard Step 3: 隱私設定
│   └── step4_result/         # Wizard Step 4: 預覽與憑證產出
├── store/                    # 全域狀態管理 (usePrivacyStore)
├── utils/                    # 純工具與自動化測試專區 (__tests__)
├── App.tsx                   # 乾淨的頂層 Route 配置檔與全域守門員
└── main.tsx                  # 應用程式入口
~~~

## 🚀 快速開始 (Getting Started)

### 1. 安裝依賴 (Install Dependencies)
~~~bash
npm install
# 或使用 yarn
yarn install
~~~

### 2. 啟動開發伺服器 (Start Development Server)
~~~bash
npm run dev
~~~
啟動後，請在瀏覽器打開 `http://localhost:5173`。

### 3. 生產環境構建 (Build for Production)
~~~bash
npm run build
npm run preview
~~~

## 📋 開發者備忘錄與未來藍圖 (Roadmap & Backlog)

目前專案處於高保真 Prototype 階段（純前端狀態管理）。系統的**核心隱私運算引擎與後端基礎設施已全權委託外部團隊開發**。本專案未來的開發重點，將專注於前端架構的重構、API 串接以及防護邊界的強化：

### 🔌 API 串接與前端架構演進 (API Integration & Frontend Architecture)
- [ ] **API 規格定義與 Mocking (API Contract & Mock)**：
  - 於開發前期與外包團隊確立 OpenAPI (Swagger) 規格（包含 JSON 請求結構與風險分數回應格式）。
  - 在真實 API 交付前，導入 **MSW (Mock Service Worker)** 模擬非同步請求，確保前端 UI/UX 開發進度不受後端阻礙。
- [ ] **全域 API 攔截器與 JWT 驗證防護 (Axios Interceptors)**：
  - 將現有的「前端時間戳逾時機制」交接給真實的 JWT 驗證。
  - 實作 Axios 全域攔截器 (Interceptor)，當捕獲到 `401 Unauthorized` (Token 過期或被強制踢出) 或 `403 Forbidden` 時，統一觸發 Zustand 清空狀態並導回登入頁，實現伺服器級別的資安防護。
- [ ] **Zustand 狀態非同步化 (Async State Management)**：
  - 將 `usePrivacyStore` 中直接讀寫 `localStorage` 的同步邏輯，全面重構為呼叫後端 API 的非同步函式 (Async Actions)，由外包後端資料庫做為唯一的 Single Source of Truth。
- [ ] **長時間非同步任務管線與 UX 優化 (Long-polling & Task UI)**：
  - 針對 Step 4 (預覽與匯出) 耗時極長的大數據去識別化運算，實作真實的 Task ID 任務輪詢 (Polling) 或 WebSocket 監聽。
  - 完善進度條 (Progress Bar) 與骨架屏 (Skeleton Loading) 等 UI 回饋，確保在長時間等待中提供優良的使用者體驗。

## 🤝 貢獻指南 (Contributing)

1. 請確保每次提交前通過 TypeScript 編譯檢查 (`tsc --noEmit`)。
2. 遵守 React Fast Refresh 原則，單一 `.tsx` 檔案僅 export React Components，純函式與常數請拆分至獨立 `.ts` 檔。
3. 開發新功能請遵循 Feature-sliced 架構，將相關的 UI、邏輯封裝在同一個資料夾內。
4. 新增 Ant Design 元件時，請盡量使用 `theme.useToken()` 動態獲取顏色，以確保 Dark Mode 的完美兼容。

---
*Built with ❤️ by Privacy Engineering Team*