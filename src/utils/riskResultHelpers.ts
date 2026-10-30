/**
 * ============================================================================
 * 檔案名稱 (File): riskResultHelpers.ts
 * 模組功能 (Description): Step4 風險評估結果的小型純運算（CAP 失敗原因、無法評估收據、資料列計數）。
 * ============================================================================
 * ★ 2026-09-30：由 features/step4_result/Step4_Result.tsx 的 runFullPipeline 內抽出，邏輯不變；
 *   單元測試見 utils/__tests__/riskResultHelpers.test.ts。
 */
import type { CapReport } from '../api/apiService';

/**
 * 把 CAP 請求失敗的錯誤轉成可顯示的原因文字：優先取後端回傳的 HTTP 狀態碼＋錯誤碼＋訊息，
 * 其次是回應文字、HTTP 狀態碼、逾時，最後才是例外本身的訊息。
 */
export const extractCapRequestFailureReasonText = (errorPayload: unknown): string => {
    const errorRecord = errorPayload as { response?: { status?: number; data?: unknown }; message?: string; code?: string } | undefined;
    const responseData = errorRecord?.response?.data as { error_code?: string; message?: string; detail?: unknown } | string | undefined;
    const statusText = errorRecord?.response?.status ? `HTTP ${errorRecord.response.status}` : '';
    if (responseData && typeof responseData === 'object') {
        const backendMessageText = responseData.message || (typeof responseData.detail === 'string' ? responseData.detail : responseData.detail ? JSON.stringify(responseData.detail) : '');
        const joinedText = [statusText, responseData.error_code, backendMessageText].filter(Boolean).join(' ');
        if (joinedText) return joinedText;
    }
    if (typeof responseData === 'string' && responseData.trim() !== '') return [statusText, responseData.trim().slice(0, 300)].filter(Boolean).join(' ');
    if (statusText) return statusText;
    if (errorRecord?.code === 'ECONNABORTED') return '請求逾時';
    return errorRecord?.message || String(errorPayload);
};

/** CAP 全部輪次都失敗時的「無法評估」收據（與後端降級收據同格式：前後皆 -1，原因寫在 message） */
export const buildCapUnavailableReceipt = (reasonText: string): CapReport => ({
    cap_before: -1,
    cap_after: -1,
    n_original: 0,
    n_processed: 0,
    message: `CAP 前後對比請求失敗，無法評估：${reasonText}`
});

/** String.prototype.trim 會去掉的空白字元 */
const isTrimWhitespaceCode = (charCode: number): boolean =>
    charCode === 0x20 || (charCode >= 0x09 && charCode <= 0x0D) || charCode === 0xA0 || charCode === 0x1680 ||
    (charCode >= 0x2000 && charCode <= 0x200A) || charCode === 0x2028 || charCode === 0x2029 || charCode === 0x202F ||
    charCode === 0x205F || charCode === 0x3000 || charCode === 0xFEFF;

/**
 * CSV 資料列數（扣除表頭與空白行），用於輸入／刪除／輸出筆數統計。
 * ★ 2026-10-30：逐字元計數，不再 split 成每行一個字串（大檔約多佔檔案大小 1.5～2 倍記憶體）；結果與 split 版相同。
 */
export const countCsvDataRowsForStats = (csvText: string): number => {
    let nonBlankLineCount = 0;
    let isCurrentLineNonBlank = false;
    for (let charIndex = 0; charIndex < csvText.length; charIndex++) {
        const charCode = csvText.charCodeAt(charIndex);
        if (charCode === 0x0A || charCode === 0x0D) {
            if (isCurrentLineNonBlank) nonBlankLineCount++;
            isCurrentLineNonBlank = false;
            if (charCode === 0x0D && csvText.charCodeAt(charIndex + 1) === 0x0A) charIndex++;
            continue;
        }
        if (!isCurrentLineNonBlank && !isTrimWhitespaceCode(charCode)) isCurrentLineNonBlank = true;
    }
    if (isCurrentLineNonBlank) nonBlankLineCount++;
    return Math.max(0, nonBlankLineCount - 1);
};
