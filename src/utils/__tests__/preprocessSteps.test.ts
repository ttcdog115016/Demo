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
});
