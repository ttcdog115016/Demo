import { describe, it, expect } from 'vitest';
import { applyPreprocessSteps, applyPreprocessStep, SERVER_SALT_HASH_PREVIEW_TEXT } from '../preprocessSteps';
import { sha3Hex } from '../sha3';

// ★ 2026-10-27：預覽規則改為與後端 /api/v1/preprocess 相同（app/engines/preprocess/actions/*.py）
describe('資料預先處理預覽', () => {
    it('沒有步驟或 none 時維持原值', () => {
        expect(applyPreprocessSteps('abc', [])).toBe('abc');
        expect(applyPreprocessSteps('abc', [{ action: 'none', params: {} }])).toBe('abc');
    });

    it('多個步驟依序套用', () => {
        expect(applyPreprocessSteps('  hello  ', [{ action: 'trim', params: {} }])).toBe('hello');
        expect(applyPreprocessSteps('  ａ b  ', [{ action: 'trim', params: { mode: 'all' } }, { action: 'normalize', params: { widthMode: 'full_to_half', caseMode: 'upper' } }])).toBe('AB');
    });

    it('字串截斷：刪除 N 個字元，長度不足時變空字串', () => {
        expect(applyPreprocessStep('台北市大安區', { action: 'slice', params: { direction: 'left', count: 3 } })).toBe('大安區');
        expect(applyPreprocessStep('A123456789', { action: 'slice', params: { direction: 'right', count: 6 } })).toBe('A123');
        expect(applyPreprocessStep('ab', { action: 'slice', params: { direction: 'left', count: 5 } })).toBe('');
    });

    it('相對保留與截斷：只裁選定方向那一側，另一側不動', () => {
        expect(applyPreprocessStep('2025-06-16', { action: 'anchor_truncate', params: { anchor: '-', direction: 'front', keepCount: 2 } })).toBe('5-06-16');
        expect(applyPreprocessStep('2025-06-16', { action: 'anchor_truncate', params: { anchor: '-', direction: 'back', keepCount: 2 } })).toBe('2025-06-1');
        expect(applyPreprocessStep('2025-06-16', { action: 'anchor_truncate', params: { anchor: '-', direction: 'back', keepCount: 0 } })).toBe('2025-06');
        expect(applyPreprocessStep('abc', { action: 'anchor_truncate', params: { anchor: '-', direction: 'front', keepCount: 1 } })).toBe('abc');
    });

    it('型態轉換：取出數字、整數四捨五入、取不出數字或布林表外的值原樣不動', () => {
        expect(applyPreprocessStep('25歲', { action: 'type_cast', params: { targetType: 'integer' } })).toBe('25');
        expect(applyPreprocessStep('27.5', { action: 'type_cast', params: { targetType: 'integer' } })).toBe('28');
        expect(applyPreprocessStep('-2.5', { action: 'type_cast', params: { targetType: 'integer' } })).toBe('-3');
        expect(applyPreprocessStep('NT$3,000', { action: 'type_cast', params: { targetType: 'float' } })).toBe('3000.0');
        expect(applyPreprocessStep('未知', { action: 'type_cast', params: { targetType: 'integer' } })).toBe('未知');
        expect(applyPreprocessStep('YES', { action: 'type_cast', params: { targetType: 'boolean' } })).toBe('True');
        expect(applyPreprocessStep('0', { action: 'type_cast', params: { targetType: 'boolean' } })).toBe('False');
        expect(applyPreprocessStep('maybe', { action: 'type_cast', params: { targetType: 'boolean' } })).toBe('maybe');
    });

    it('全形轉半形只轉英數字與空白，標點不轉', () => {
        expect(applyPreprocessStep('Ｊ９３！', { action: 'normalize', params: { widthMode: 'full_to_half' } })).toBe('J93！');
    });

    it('雜湊：三種演算法與後端相同（預覽截斷至 16 碼）；舊選項 SHA512 視為 SHA3-512', () => {
        // ★ 2026-10-28：以自訂鹽值驗證演算法（伺服器預設鹽值不顯示雜湊值）
        const fixedSalt = { seedMode: 'fixed', seedValue: 'k' };
        const sha256Preview = applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'sha256', ...fixedSalt } }]);
        expect(sha256Preview).toMatch(/^[0-9a-f]{16}\.\.\.$/);
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA256', ...fixedSalt } }])).toBe(sha256Preview);
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'sha3-256', ...fixedSalt } }])).toBe(`${sha3Hex('A123', 256, 'k').slice(0, 16)}...`);
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'SHA512', ...fixedSalt } }])).toBe(`${sha3Hex('A123', 512, 'k').slice(0, 16)}...`);
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'sha3-512', seedMode: 'fixed', seedValue: 'k' } }])).toBe(`${sha3Hex('A123', 512, 'k').slice(0, 16)}...`);
    });

    it('雜湊加鹽：自訂鹽值以 HMAC 計算，不同鹽值結果不同；系統隨機鹽值同一次操作內結果一致', () => {
        // ★ 2026-10-28：伺服器預設鹽值（none／未指定）只顯示說明文字
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'sha256', seedMode: 'none' } }])).toBe(SERVER_SALT_HASH_PREVIEW_TEXT);
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'sha256' } }])).toBe(SERVER_SALT_HASH_PREVIEW_TEXT);
        const unsaltedPreview = SERVER_SALT_HASH_PREVIEW_TEXT;
        const saltedPreviewA = applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'sha256', seedMode: 'fixed', seedValue: 'salt-A' } }]);
        const saltedPreviewB = applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'sha256', seedMode: 'fixed', seedValue: 'salt-B' } }]);
        expect(saltedPreviewA).not.toBe(unsaltedPreview);
        expect(saltedPreviewA).not.toBe(saltedPreviewB);
        const randomPreview = applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'sha256', seedMode: 'random' } }]);
        expect(randomPreview).not.toBe(unsaltedPreview);
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'sha256', seedMode: 'random' } }])).toBe(randomPreview);
        // 舊設定的 timestamp 視同系統隨機鹽值
        expect(applyPreprocessSteps('A123', [{ action: 'hash', params: { algorithm: 'sha256', seedMode: 'timestamp' } }])).toBe(randomPreview);
    });

    it('正則替換：替換文字當純文字', () => {
        expect(applyPreprocessStep('0912-345-678', { action: 'regex_replace', params: { pattern: '\\d', placeholder: '$1' } })).toBe('$1$1$1$1-$1$1$1-$1$1$1');
    });
});
