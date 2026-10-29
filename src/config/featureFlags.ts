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
 * ★ 2026-10-29（TTC Wei 決定）：系統公告（系統設定分頁、首頁重要公告橫幅、右上角鈴鐺）、系統維運日誌分頁。
 *   這些資料原本只存在使用者自己的瀏覽器，一度在兩個版本都隱藏；同日改存後端資料庫（api/systemApi.ts）後，
 *   線上版恢復顯示。單機版一台電腦一個人用，沒有通知對象，仍隱藏。
 *   維運日誌在兩個版本都照常記錄（系統管理大廳的登入／API 統計由它計算）。
 *   全站維護模式同日刪除（單機版用不到）。
 */
export const SHOW_ANNOUNCEMENTS = !IS_DESKTOP_BUILD;
export const SHOW_SYSTEM_LOG_TAB = !IS_DESKTOP_BUILD;
