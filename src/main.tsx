/**
 * ============================================================================
 * 檔案名稱 (File): main.tsx
 * 模組功能 (Description): 前端 React 應用程式掛載進入點 (初始化 StrictMode、載入全域 CSS 與 i18n 多國語系配置、渲染 App 主視圖與 Vercel 工具列)
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

// 引入主應用程式與工具列組件
import App from './App.tsx';
import { VercelToolbar } from './VercelToolbar.tsx';

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
			<App />
			
			{/* Vercel 效能與審航除錯工具列：協助捕捉效能瓶頸 (僅於 Vercel 環境作動) */}
			<VercelToolbar />
		</StrictMode>
	);
}
else
{
	// 防呆錯誤處理：若在 HTML 中找不到對應的 root 節點，於瀏覽器主控台印出明確錯誤以便除錯
	console.error(`Initialization Error: Cannot find HTML element with ID '${ROOT_ELEMENT_ID_STRING}'. The React application failed to mount.`);
}