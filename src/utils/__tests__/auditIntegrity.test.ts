/**
 * ★ 2026-10-29：處理紀錄改由後端以伺服器金鑰簽章（後端 tests/api/test_api_system.py 驗證簽章與竄改偵測）；
 *   前端只計算檔案指紋，驗證改呼叫 GET /api/v1/history/{id}/verify。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeFileFingerprints, verifyAuditIntegrity, sha256HexOfText } from '../auditIntegrity';

const { verifyHistoryRecordMock } = vi.hoisted(() => ({ verifyHistoryRecordMock: vi.fn() }));
vi.mock('../../api/systemApi', () => ({ verifyHistoryRecord: verifyHistoryRecordMock }));

describe('處理紀錄防篡改資料', () => {
    beforeEach(() => verifyHistoryRecordMock.mockReset());

    it('SHA-256 與已知值相符', async () => {
        expect(await sha256HexOfText('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('計算原始檔與輸出檔指紋（送後端由伺服器簽章）', async () => {
        const fingerprints = await computeFileFingerprints({ inputFile: new Blob(['a,b\n1,2\n']), outputFile: null });
        expect(fingerprints.inputFileSha256).toBe(await sha256HexOfText('a,b\n1,2\n'));
        expect(fingerprints.outputFileSha256).toBeNull();
    });

    it('驗證結果來自後端；連不到後端時回報 error', async () => {
        verifyHistoryRecordMock.mockResolvedValueOnce({ status: 'tampered', fingerprintMatches: false, signatureValid: false });
        expect((await verifyAuditIntegrity('r1')).status).toBe('tampered');
        expect(verifyHistoryRecordMock).toHaveBeenCalledWith('r1');

        verifyHistoryRecordMock.mockRejectedValueOnce(new Error('offline'));
        expect((await verifyAuditIntegrity('r1')).status).toBe('error');
    });
});
