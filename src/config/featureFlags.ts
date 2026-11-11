/**
 * 檔案名稱 (File): featureFlags.ts
 * 模組功能 (Description): 暫時關閉、程式保留的畫面功能開關；離線版／線上版的畫面差異。
 */

/**
 * 執行期設定：由 index.html 先載入的 /runtime-config.js 設定 window.__OPEN_PETS_CONFIG__。
 *   - Docker 單一映像檔：後端依環境變數 OPEN_PETS_MODE（offline／online）與 OPEN_PETS_SHOW_DEMO_ACCOUNTS 動態產生，
 *     同一份映像檔、同一份前端建置，使用者啟動時選模式（見 docker/openpets_server.py）。
 *   - 其他部署（nginx 版 Demo 站、npm run dev、單機版 exe）：public/runtime-config.js 內容為空物件，
 *     退回下方的「建置旗標」，行為與加入執行期設定之前完全相同。
 */
export interface RuntimeConfig
{
	mode?: 'offline' | 'online';
	showDemoAccounts?: boolean;
}

export interface ResolvedFlags
{
	isOfflineMode: boolean;
	showDemoAccounts: boolean;
	showSystemLogTab: boolean;
}

/**
 * 合併執行期設定與建置旗標（純函式，方便單元測試）。
 * @param runtimeConfig - window.__OPEN_PETS_CONFIG__（可能是空物件）
 * @param buildTarget - 建置時的 VITE_BUILD_TARGET（單機版為 'desktop'）
 */
export const resolveFlags = (runtimeConfig: RuntimeConfig, buildTarget: string | undefined): ResolvedFlags =>
{
	const isDesktopBuild = buildTarget === 'desktop';
	const isOfflineMode = runtimeConfig.mode ? runtimeConfig.mode === 'offline' : isDesktopBuild;
	// ★ 有執行期模式（容器版）時，Demo 帳號預設關閉，只有明確設定才顯示；沒有執行期設定時維持舊行為（非單機版建置顯示）
	const showDemoAccounts = typeof runtimeConfig.showDemoAccounts === 'boolean'
		? runtimeConfig.showDemoAccounts
		: (runtimeConfig.mode ? false : !isDesktopBuild);
	return { isOfflineMode, showDemoAccounts, showSystemLogTab: !isOfflineMode };
};

const runtimeConfig: RuntimeConfig = (globalThis as unknown as { __OPEN_PETS_CONFIG__?: RuntimeConfig }).__OPEN_PETS_CONFIG__ ?? {};
const resolvedFlags = resolveFlags(runtimeConfig, import.meta.env.VITE_BUILD_TARGET);

/**
 * ★ 2026-10-28：單機版執行檔（packaging/build_exe.ps1 以 `vite build --mode desktop` 建置，讀 .env.desktop）。
 *   單機版：不顯示 Demo 測試帳號（帳號由使用者第一次啟動時自建）。
 *   一般 Demo 建置（npm run build）不受影響。
 * ★ 2026-11-10：改為「離線模式」，可由執行期設定覆蓋（Docker 單一映像檔）。IS_DESKTOP_BUILD 為舊名稱，保留相容。
 */
export const IS_OFFLINE_MODE = resolvedFlags.isOfflineMode;
export const IS_DESKTOP_BUILD = IS_OFFLINE_MODE;
export const SHOW_DEMO_ACCOUNTS = resolvedFlags.showDemoAccounts;

/**
 * ★ 2026-10-29（TTC Wei 決定）：系統維運日誌分頁——資料存後端（api/systemApi.ts），線上版顯示；單機版一台電腦一個人用，隱藏。
 *   維運日誌在兩個版本都照常記錄（系統管理大廳的登入／API 統計由它計算）。
 *   全站維護模式、系統公告同日刪除。
 */
export const SHOW_SYSTEM_LOG_TAB = resolvedFlags.showSystemLogTab;
