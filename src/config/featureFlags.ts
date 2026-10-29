/**
 * 檔案名稱 (File): featureFlags.ts
 * 模組功能 (Description): 暫時關閉、程式保留的畫面功能開關。
 */

/**
 * ★ 2026-10-27：最終版後端會員系統沒有「密碼最後變更時間」，也沒有密碼過期機制，
 *   「強制密碼過期輪替」設定（系統設定 → 安全與環境參數、系統管理大廳）先隱藏，程式保留。
 *   後端補上 password_changed_at 與過期判斷後改回 true，並把過期判斷接到登入流程（Login.tsx）。
 */
export const SHOW_PASSWORD_EXPIRY_POLICY = false;

/**
 * ★ 2026-10-28：單機版執行檔（packaging/build_exe.ps1 以 `vite build --mode desktop` 建置，讀 .env.desktop）。
 *   單機版：不顯示 Demo 測試帳號（帳號由使用者第一次啟動時自建）、API 錯誤不自動送 Google 表單（資料不離開本機）。
 *   一般 Demo 建置（npm run build）不受影響。
 */
export const IS_DESKTOP_BUILD = import.meta.env.VITE_BUILD_TARGET === 'desktop';
export const SHOW_DEMO_ACCOUNTS = !IS_DESKTOP_BUILD;
export const ENABLE_REMOTE_ERROR_REPORT = !IS_DESKTOP_BUILD;

/**
 * ★ 2026-10-29（TTC Wei 決定）：以下功能的資料只存在使用者自己的瀏覽器（localStorage），後端沒有對應 API。
 *   多人共用網址時，管理員發的公告、開的維護模式，別台電腦的人收不到；單機版一台電腦一個人用，也沒有通知對象。
 *   單機版隱藏：系統公告（系統設定分頁、首頁重要公告橫幅、右上角鈴鐺）、維護模式、系統維運日誌分頁。
 *   維運日誌仍在背景記錄（系統管理大廳的登入／API 統計由它計算），只是不顯示分頁。
 *   閒置逾時登出保留（本機也有意義，不需要後端）。一般 Demo 建置不受影響。
 */
export const SHOW_ANNOUNCEMENTS = !IS_DESKTOP_BUILD;
export const SHOW_MAINTENANCE_MODE = !IS_DESKTOP_BUILD;
export const SHOW_SYSTEM_LOG_TAB = !IS_DESKTOP_BUILD;
