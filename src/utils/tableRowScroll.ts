/**
 * ============================================================================
 * 檔案名稱 (File): tableRowScroll.ts
 * 模組功能 (Description): 讓 antd Table 的指定列（含新長出的參數欄位）捲動到看得到的位置。
 * ============================================================================
 * ★ 2026-10-08 諮詢會（張瑞益教授）：Step2 資料預先處理表格捲到最底端的欄位（例如「就醫次數」），
 *   選了清洗動作／缺失值策略或按「新增步驟」後，新出現的參數欄位在表格捲動區下方看不到，要再自己往下捲。
 *   改為設定變更後自動把該列捲進可視範圍（表格內部捲動區與整頁都會跟著調整，已看得到時不會移動）。
 */

/** 以 CSS 屬性選擇器安全引用欄位名稱（欄位名可能含引號、反斜線、空白等字元） */
const escapeAttributeValue = (rawValue: string): string =>
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(rawValue)
        : rawValue.replace(/["\\]/g, '\\$&');

/**
 * 函數名稱: scrollTableRowIntoView
 * 函數功能: 在 containerElement 內找到 data-row-key = rowKey 的表格列，以最小移動量捲到看得到的位置。
 * 回傳: 是否找到該列並執行捲動。
 */
export const scrollTableRowIntoView = (containerElement: HTMLElement | null | undefined, rowKey: string): boolean =>
{
    if (!containerElement) return false;
    const rowElement = containerElement.querySelector<HTMLElement>(`tr[data-row-key="${escapeAttributeValue(rowKey)}"]`);
    if (!rowElement || typeof rowElement.scrollIntoView !== 'function') return false;
    // block: 'nearest' → 已完全看得到時不動；被下緣切掉時只往下捲到剛好看到整列（含新長出的參數欄位）
    rowElement.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    return true;
};
