/**
 * ============================================================================
 * 檔案名稱 (File): main.tsx
 * 模組功能 (Description): 前端 React 應用程式掛載進入點 (初始化 StrictMode、載入全域 CSS 與 i18n 多國語系配置、渲染 App 主視圖)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術字串與含義不明之變數) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// 引入全域樣式表配置 (符合規範 g)
import './index.css';

// 確保在 App 元件載入前完成 i18n 多國語系套件初始化 (符合規範 g)
import './i18n'; 

// 引入主應用程式組件
// ★ 2026-09-30：移除 Vercel Toolbar——本專案部署於 Docker／nginx 與 cloudflared，不在 Vercel 上，
//   該工具列原本被強制掛載（連正式環境也載入外部元件並輸出 console 訊息），已連同套件一併移除。
import App from './App.tsx';
import AppErrorBoundary from './components/AppErrorBoundary';

// ★ 新增：全域 API 錯誤診斷攔截器。必須在任何 API 呼叫發生前掛載，故於進入點最早期
// (App 掛載渲染前) 就執行註冊，確保之後全站任何一支 axios 呼叫失敗時都會被記錄下來，
// API 呼叫結果寫入後端系統維運日誌 (見 apiErrorInterceptor.ts)。
import { registerGlobalApiErrorInterceptor } from './api/apiErrorInterceptor';
import { logSystemEvent } from './store/useSystemLogStore';
import { useAuthStore } from './store/useAuthStore';
import { LEGACY_AUDIT_LOG_STORAGE_KEY } from './store/useAuditStore';
import { LEGACY_SYSTEM_LOG_STORAGE_KEY } from './store/useSystemLogStore';
import { LEGACY_SIGNING_KEY_DB_NAME } from './utils/auditIntegrity';
import { loadSystemSettings } from './utils/systemSettingsSync';
registerGlobalApiErrorInterceptor();

// ★ 2026-10-27：改由後端會員系統驗證帳號，清除舊版前端 Demo 帳號資料庫留在瀏覽器的資料（含密碼雜湊）
// ★ 2026-10-29：處理紀錄、維運日誌、系統公告改存後端，舊版留在瀏覽器的資料一併清除（不搬移）
for (const legacyStorageKey of ['privacy_accounts_v1', LEGACY_AUDIT_LOG_STORAGE_KEY, LEGACY_SYSTEM_LOG_STORAGE_KEY, 'privacy_announcements_v1', 'openpets_api_error_logs_v1'])
{
	try { window.localStorage.removeItem(legacyStorageKey); } catch { /* 無法存取 localStorage 時略過 */ }
}
// ★ 2026-10-29：處理紀錄改由伺服器簽章，刪除舊版各瀏覽器自產的簽章金鑰
try { window.indexedDB?.deleteDatabase(LEGACY_SIGNING_KEY_DB_NAME); } catch { /* 無法存取 IndexedDB 時略過 */ }

// ★ 2026-10-29：系統設定（閒置自動登出時間）改由後端提供
void loadSystemSettings();

// ★ 2026-10-27：重新整理頁面時以 sessionStorage 的 refresh token 向後端接續登入（期間 RequireAuth 顯示載入中）
// ★ 2026-10-07：系統維運日誌——記錄前端頁面載入（含重新整理）；2026-10-29 起日誌存後端，接續登入後才記得進去
void useAuthStore.getState().restoreSession().then(() => logSystemEvent('INFO', `前端頁面載入（${window.location.host}）`));

/**
 * ============================================================================
 * DOM 節點識別碼常數宣告 (DOM Element ID Constants)
 * ============================================================================
 * 規範對照: 符合規範 e) 避免使用不易理解之常數字串 (Magic String)
 */
const ROOT_ELEMENT_ID_STRING = 'root';

/**
 * ============================================================================
 * 應用程式啟動與掛載執行區塊 (Application Bootstrap & Mount Execution)
 * ============================================================================
 * 說明: 尋找 HTML 文件中對應之根節點，並使用 React 18 的 createRoot API 進行渲染。
 * 包含 StrictMode 以協助開發階段捕捉潛在的副作用或不安全的生命週期。
 */

// 尋找 HTML 頁面中之根容器元素 (符合規範 c, g: 變數明確標示 HtmlElement)
const rootContainerHtmlElement = document.getElementById(ROOT_ELEMENT_ID_STRING);

// 執行 React 18 createRoot 容器創建與 DOM 視圖渲染 (符合規範 g)
if (rootContainerHtmlElement) 
{
	createRoot(rootContainerHtmlElement).render(
		<StrictMode>
			{/* 全域主應用程式組件：負責掛載路由、主題與狀態管理 */}
			{/* ★ 2026-10-05：全域錯誤邊界，避免任何渲染例外直接讓整頁變空白 */}
			<AppErrorBoundary>
				<App />
			</AppErrorBoundary>
		</StrictMode>
	);
}
else
{
	// 防呆錯誤處理：若在 HTML 中找不到對應的 root 節點，於瀏覽器主控台印出明確錯誤以便除錯
	console.error(`Initialization Error: Cannot find HTML element with ID '${ROOT_ELEMENT_ID_STRING}'. The React application failed to mount.`);
}