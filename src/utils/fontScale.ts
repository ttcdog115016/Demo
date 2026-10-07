/**
 * ============================================================================
 * 檔案名稱 (File): fontScale.ts
 * 模組功能 (Description): 全站字體依「系統偏好設定 → 字體大小」等比例縮放的共用工具
 * ============================================================================
 *
 * 原本各頁面以 inline style 寫死的 px 字級（如 fontSize: 12）不會跟著偏好設定改變，
 * 只有 Ant Design 元件（吃 ConfigProvider token.fontSize）會變大，造成同一畫面大小字混雜。
 *
 * 作法：App 根組件依字體級距把 --font-scale 寫到 <html>（中＝1），
 * 這裡把設計稿字級（以「中」為準）換成 calc(Npx * var(--font-scale))，由瀏覽器即時換算。
 * ECharts 不吃 CSS，需傳入數字，改用 scaleChartFontSize。
 */

/** 字體級距「中」的基準像素值；所有寫死的字級都是以此級距設計 */
export const FONT_SCALE_BASE_PX = 16;

/**
 * 函數名稱: scaleFontSize
 * 函數功能: 將以「中」級距設計的字級換成隨偏好設定縮放的 CSS 值。
 * 輸入參數: designPx (number) — 「中」級距下的字級像素值
 * 返回值: string — 例如 'calc(12px * var(--font-scale, 1))'
 */
export function scaleFontSize(designPx: number): string {
    return `calc(${designPx}px * var(--font-scale, 1))`;
}

/**
 * 函數名稱: scaleChartFontSize
 * 函數功能: ECharts 用，依目前 antd token.fontSize 換算字級數字。
 * 輸入參數: designPx (number) — 「中」級距下的字級；currentBaseFontSizePx (number) — 目前 token.fontSize
 * 返回值: number — 縮放後的像素值（四捨五入）
 */
export function scaleChartFontSize(designPx: number, currentBaseFontSizePx: number): number {
    return Math.round(designPx * currentBaseFontSizePx / FONT_SCALE_BASE_PX);
}
