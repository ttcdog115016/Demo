import { describe, it, expect } from 'vitest';
import { applyPreprocessSteps } from '../preprocessSteps';

describe('資料預先處理預覽', () => {
    it('沒有步驟或 none 時維持原值', () => {
        expect(applyPreprocessSteps('abc', [])).toBe('abc');
        expect(applyPreprocessSteps('abc', [{ action: 'none', params: {} }])).toBe('abc');
    });

    it('多個步驟依序套用', () => {
        expect(applyPreprocessSteps('  hello  ', [{ action: 'trim', params: {} }])).toBe('hello');
    });

    it('雜湊：選項值 SHA512 與 SHA256 算出不同長度（預覽截斷至 16 碼）', () => {
        const sha256Preview = applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA256' } }]);
        const sha512Preview = applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA512' } }]);
        expect(sha256Preview).toMatch(/^[0-9a-f]{16}\.\.\.$/);
        expect(sha512Preview).toMatch(/^[0-9a-f]{16}\.\.\.$/);
        expect(sha512Preview).not.toBe(sha256Preview);
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA3-512' } }])).toBe(sha512Preview);
    });

    it('雜湊加鹽：自訂鹽值以 HMAC 計算，不同鹽值結果不同；系統隨機鹽值同一次操作內結果一致', () => {
        const unsaltedPreview = applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA256', seedMode: 'none' } }]);
        const saltedPreviewA = applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA256', seedMode: 'fixed', seedValue: 'salt-A' } }]);
        const saltedPreviewB = applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA256', seedMode: 'fixed', seedValue: 'salt-B' } }]);
        expect(saltedPreviewA).not.toBe(unsaltedPreview);
        expect(saltedPreviewA).not.toBe(saltedPreviewB);
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA256', seedMode: 'fixed', seedValue: 'salt-A' } }])).toBe(saltedPreviewA);
        const randomPreview = applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA256', seedMode: 'random' } }]);
        expect(randomPreview).not.toBe(unsaltedPreview);
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA256', seedMode: 'random' } }])).toBe(randomPreview);
        // 舊設定的 timestamp 視同系統隨機鹽值
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA256', seedMode: 'timestamp' } }])).toBe(randomPreview);
    });
});
