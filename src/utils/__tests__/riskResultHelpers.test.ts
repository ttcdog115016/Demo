import { describe, it, expect } from 'vitest';
import { extractCapRequestFailureReasonText, buildCapUnavailableReceipt, countCsvDataRowsForStats } from '../riskResultHelpers';

describe('Step4 風險結果小工具', () => {
    it('CAP 失敗原因：優先顯示後端錯誤碼與訊息', () => {
        expect(extractCapRequestFailureReasonText({ response: { status: 422, data: { error_code: 'ERR_CONFIG_DATA_MISMATCH', message: '欄位不存在' } } }))
            .toBe('HTTP 422 ERR_CONFIG_DATA_MISMATCH 欄位不存在');
        expect(extractCapRequestFailureReasonText({ response: { status: 502, data: 'Bad Gateway' } })).toBe('HTTP 502 Bad Gateway');
        expect(extractCapRequestFailureReasonText({ response: { status: 500 } })).toBe('HTTP 500');
        expect(extractCapRequestFailureReasonText({ code: 'ECONNABORTED', message: 'timeout' })).toBe('請求逾時');
        expect(extractCapRequestFailureReasonText(new Error('Network Error'))).toBe('Network Error');
    });

    it('無法評估收據：前後皆 -1，原因寫在 message', () => {
        expect(buildCapUnavailableReceipt('HTTP 500')).toEqual({
            cap_before: -1, cap_after: -1, n_original: 0, n_processed: 0, message: 'CAP 前後對比請求失敗，無法評估：HTTP 500'
        });
    });

    it('資料列數扣除表頭與空白行，支援各種換行', () => {
        expect(countCsvDataRowsForStats('a,b\n1,2\n3,4\n')).toBe(2);
        expect(countCsvDataRowsForStats('a,b\r\n1,2\r\n\r\n3,4')).toBe(2);
        expect(countCsvDataRowsForStats('a,b')).toBe(0);
        expect(countCsvDataRowsForStats('')).toBe(0);
    });
});
