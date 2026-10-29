/**
 * 檔案名稱 (File): featureFlags.ts
 * 模組功能 (Description): 暫時關閉、程式保留的畫面功能開關。
 */

/**
 * ★ 2026-10-28：單機版執行檔（packaging/build_exe.ps1 以 `vite build --mode desktop` 建置，讀 .env.desktop）。
 *   單機版：不顯示 Demo 測試帳號（帳號由使用者第一次啟動時自建）。
 *   一般 Demo 建置（npm run build）不受影響。
 */
export const IS_DESKTOP_BUILD = import.meta.env.VITE_BUILD_TARGET === 'desktop';
export const SHOW_DEMO_ACCOUNTS = !IS_DESKTOP_BUILD;

/**
 * ★ 2026-10-29（TTC Wei 決定）：系統維運日誌分頁——資料存後端（api/systemApi.ts），線上版顯示；單機版一台電腦一個人用，隱藏。
 *   維運日誌在兩個版本都照常記錄（系統管理大廳的登入／API 統計由它計算）。
 *   全站維護模式、系統公告同日刪除。
 */
export const SHOW_SYSTEM_LOG_TAB = !IS_DESKTOP_BUILD;
