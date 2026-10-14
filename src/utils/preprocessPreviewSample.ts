/**
 * ============================================================================
 * 檔案名稱 (File): preprocessPreviewSample.ts
 * 模組功能 (Description): Step2「資料預先處理」即時預覽用的樣本挑選與空值計數。
 * ============================================================================
 * ★ 2026-10-07 QA 回饋：預覽原本固定取第一筆資料，若該筆為空值就只顯示「-」，看不到清洗效果；
 *   若前幾筆都沒有空值，也看不到缺值處理效果。改為：範例值取該欄第一個非空值；空值另外計數與預覽。
 *   空值判定與 utils/datasetProfile.ts 一致：undefined／null／去除前後空白後為空字串。
 */

type PreviewRow = Record<string, unknown>;

/** 是否為空值（與 datasetProfile 的 nonEmptyCount 判定一致） */
export const isPreviewCellMissing = (cellValue: unknown): boolean =>
    cellValue === undefined || cellValue === null || String(cellValue).trim() === '';

/** 取該欄第一個非空值；整欄都是空值時回傳 undefined */
export const pickPreviewSampleValue = (previewRows: PreviewRow[] | undefined, columnName: string): string | undefined => {
    const matchedRow = (previewRows || []).find((rowRecord) => !isPreviewCellMissing(rowRecord?.[columnName]));
    return matchedRow ? String(matchedRow[columnName]) : undefined;
};

/** 預覽樣本中該欄的空值筆數（尚未取得完整資料統計時的退路） */
export const countMissingInPreviewRows = (previewRows: PreviewRow[] | undefined, columnName: string): number =>
    (previewRows || []).reduce((missingCount, rowRecord) => missingCount + (isPreviewCellMissing(rowRecord?.[columnName]) ? 1 : 0), 0);
