import { describe, it, expect } from 'vitest';
import { buildPreprocessBlock, convertPreprocessStep, convertMissingValueRule, normalizePreprocessHashAlgorithm } from '../preprocessConfig';

// ★ 2026-10-27：Step2「資料預先處理」→ 後端 /api/v1/preprocess 的 preprocess 區塊
describe('資料預先處理設定檔組裝', () => {
    it('沒有任何清洗步驟與缺失值處理時回傳 null（Step4 略過前處理）', () => {
        expect(buildPreprocessBlock(['a', 'b'], { a: [{ action: 'none', params: {} }] }, { b: { strategy: 'none' } })).toBeNull();
        expect(buildPreprocessBlock(['a'], undefined, undefined)).toBeNull();
    });

    it('各動作的參數對照後端名稱', () => {
        expect(convertPreprocessStep({ action: 'slice', params: { direction: 'right', count: 6 } })).toEqual({ action: 'slice', params: { side: 'right', count: 6 } });
        expect(convertPreprocessStep({ action: 'anchor_truncate', params: { anchor: '-', direction: 'back', keepCount: 0 } })).toEqual({ action: 'anchor_truncate', params: { anchor: '-', direction: 'after', keep: 0 } });
        expect(convertPreprocessStep({ action: 'type_cast', params: { targetType: 'integer' } })).toEqual({ action: 'cast', params: { type: 'int', rounding: 'round' } });
        expect(convertPreprocessStep({ action: 'type_cast', params: { targetType: 'boolean' } })).toMatchObject({ action: 'cast', params: { type: 'bool' } });
        expect(convertPreprocessStep({ action: 'normalize', params: { caseMode: 'none', widthMode: 'none' } })).toBeNull();
        expect(convertPreprocessStep({ action: 'normalize', params: { caseMode: 'upper', widthMode: 'full_to_half' } })).toEqual({ action: 'normalize', params: { case: 'upper', width: 'half' } });
        expect(convertPreprocessStep({ action: 'clamp', params: { min: 0, max: '' } })).toEqual({ action: 'clamp', params: { min: 0 } });
        expect(convertPreprocessStep({ action: 'regex_replace', params: { pattern: '\\d', placeholder: '' } })).toEqual({ action: 'regex_replace', params: { pattern: '\\d', replacement: '' } });
        expect(convertPreprocessStep({ action: 'slice', params: { direction: 'left', count: 0 } })).toBeNull();
    });

    it('雜湊鹽值：伺服器預設不帶 salt、自訂鹽值、系統隨機改用 use_timestamp', () => {
        // ★ 2026-11-04：每個雜湊動作都帶自己的 algorithm（未選＝sha3-256）
        expect(convertPreprocessStep({ action: 'hash', params: { seedMode: 'none' } })).toEqual({ action: 'hash', params: { algorithm: 'sha3-256' } });
        expect(convertPreprocessStep({ action: 'hash', params: { seedMode: 'fixed', seedValue: 'k' } })).toEqual({ action: 'hash', params: { algorithm: 'sha3-256', salt: 'k' } });
        expect(convertPreprocessStep({ action: 'hash', params: { seedMode: 'random' } })).toEqual({ action: 'hash', params: { algorithm: 'sha3-256', salt: 'use_timestamp' } });
        expect(convertPreprocessStep({ action: 'hash', params: { seedMode: 'timestamp' } })).toEqual({ action: 'hash', params: { algorithm: 'sha3-256', salt: 'use_timestamp' } });
    });

    it('演算法名稱：舊選項 SHA256→sha256、SHA512→sha3-512', () => {
        expect(normalizePreprocessHashAlgorithm('SHA256')).toBe('sha256');
        expect(normalizePreprocessHashAlgorithm('SHA512')).toBe('sha3-512');
        expect(normalizePreprocessHashAlgorithm('sha3-256')).toBe('sha3-256');
        // ★ 2026-10-28：未填時改為 sha3-256（與後端預設一致）
        expect(normalizePreprocessHashAlgorithm(undefined)).toBe('sha3-256');
        expect(normalizePreprocessHashAlgorithm('SHA-256')).toBe('sha256');
    });

    it('缺失值：丟棄／常數（數字以數字送出）／策略填充', () => {
        expect(convertMissingValueRule({ strategy: 'drop' })).toEqual({ action: 'drop_nulls', params: {} });
        expect(convertMissingValueRule({ strategy: 'constant', constantValue: '0' })).toEqual({ action: 'fill_default', params: { value: 0 } });
        expect(convertMissingValueRule({ strategy: 'constant', constantValue: '未知' })).toEqual({ action: 'fill_default', params: { value: '未知' } });
        expect(convertMissingValueRule({ strategy: 'fill', fillMethod: 'forward' })).toEqual({ action: 'impute', params: { strategy: 'ffill' } });
        expect(convertMissingValueRule({ strategy: 'fill' })).toEqual({ action: 'impute', params: { strategy: 'mean' } });
    });

    it('依資料集欄位順序；清洗步驟在前、缺失值處理在後；雜湊之後的步驟不送；演算法取雜湊步驟所選', () => {
        const block = buildPreprocessBlock(['姓名', '地址', '不存在於規則'], {
            地址: [{ action: 'trim', params: { mode: 'edges' } }],
            姓名: [{ action: 'hash', params: { algorithm: 'sha3-512', seedMode: 'none' } }, { action: 'trim', params: {} }],
            資料集沒有的欄位: [{ action: 'trim', params: {} }],
        }, { 地址: { strategy: 'constant', constantValue: '不詳' } });
        expect(block).toEqual({
            enabled: true,
            algorithm: 'sha3-512',
            columns: [
                { column: '姓名', actions: [{ action: 'hash', params: { algorithm: 'sha3-512' } }] },
                { column: '地址', actions: [{ action: 'trim', params: { mode: 'edges' } }, { action: 'fill_default', params: { value: '不詳' } }] },
            ],
        });
    });

    it('多欄雜湊各自送出自己的演算法（★ 2026-11-04 後端已支援逐欄指定）', () => {
        const block = buildPreprocessBlock(['姓名', '身分證號'], {
            姓名: [{ action: 'hash', params: { algorithm: 'sha256', seedMode: 'none' } }],
            身分證號: [{ action: 'hash', params: { algorithm: 'sha3-512', seedMode: 'fixed', seedValue: 'k' } }],
        }, {});
        expect(block?.algorithm).toBe('sha256');
        expect(block?.columns).toEqual([
            { column: '姓名', actions: [{ action: 'hash', params: { algorithm: 'sha256' } }] },
            { column: '身分證號', actions: [{ action: 'hash', params: { algorithm: 'sha3-512', salt: 'k' } }] },
        ]);
    });
});
