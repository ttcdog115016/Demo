import { describe, it, expect } from 'vitest';
import { computeKAnonymityFidelity, formatFidelityScore, formatFidelityPercent, FIDELITY_PASS_THRESHOLD } from '../kAnonymityFidelity';

const toCsv = (header: string[], rows: Array<Array<string | number>>): string => [header.join(','), ...rows.map((row) => row.join(','))].join('\n');

describe('computeKAnonymityFidelity（指引保真度三項指標）', () => {
    const header = ['年齡', '疾病', '職業'];
    const original = toCsv(header, [[31, '感冒', 'A'], [35, '感冒', 'A'], [42, '糖尿病', 'B'], [48, '糖尿病', 'B']]);

    it('處理前後完全相同 → 三項皆 1，達標', () => {
        const result = computeKAnonymityFidelity({ originalCsvText: original, processedCsvText: original, evaluatedColumns: header, anchorColumns: ['疾病', '職業'] })!;
        expect(result.columnShapes).toBeCloseTo(1);
        expect(result.columnPairTrends).toBeCloseTo(1);
        expect(result.isPassed).toBe(true);
        expect(result.belowThresholdItems).toHaveLength(0);
    });

    it('泛化值平均攤回涵蓋的原始值：30-39 攤回 31、35，分布不變', () => {
        const processed = toCsv(header, [['30-39', '感冒', 'A'], ['30-39', '感冒', 'A'], ['40-49', '糖尿病', 'B'], ['40-49', '糖尿病', 'B']]);
        const result = computeKAnonymityFidelity({ originalCsvText: original, processedCsvText: processed, evaluatedColumns: header, anchorColumns: ['疾病', '職業'] })!;
        expect(result.columnShapes).toBeCloseTo(1);
        expect(result.isPassed).toBe(true);
    });

    it('全部遮成「*」→ 年齡與疾病的關聯消失，該欄位對低於 0.75', () => {
        const processed = toCsv(header, [['*', '感冒', 'A'], ['*', '感冒', 'A'], ['*', '糖尿病', 'B'], ['*', '糖尿病', 'B']]);
        const result = computeKAnonymityFidelity({ originalCsvText: original, processedCsvText: processed, evaluatedColumns: header, anchorColumns: ['疾病', '職業'] })!;
        expect(result.belowThresholdItems.map((item) => item.label)).toContain('年齡 × 疾病');
        expect(result.belowThresholdItems.every((item) => item.score < FIDELITY_PASS_THRESHOLD)).toBe(true);
    });

    it('有列被刪除時以未處理欄位配對；刪除造成分布偏移會扣分', () => {
        const processed = toCsv(header, [['30-39', '感冒', 'A'], ['30-39', '感冒', 'A']]);
        const result = computeKAnonymityFidelity({ originalCsvText: original, processedCsvText: processed, evaluatedColumns: header, anchorColumns: ['疾病', '職業'] })!;
        expect(result.columnShapes).toBeLessThan(FIDELITY_PASS_THRESHOLD);
        expect(result.isPassed).toBe(false);
    });

    it('配對失敗回傳 null', () => {
        const processed = toCsv(header, [['30-39', '不存在', 'Z']]);
        expect(computeKAnonymityFidelity({ originalCsvText: original, processedCsvText: processed, evaluatedColumns: header, anchorColumns: ['疾病', '職業'] })).toBeNull();
    });

    it('顯示捨去到小數二位，未達標不會顯示成 0.75', () => {
        expect(formatFidelityScore(0.7499)).toBe('0.74');
        expect(formatFidelityScore(0.9734)).toBe('0.97');
        expect(formatFidelityPercent(0.9634)).toBe('96%');
        expect(formatFidelityPercent(0.7499)).toBe('74%');
    });
});
