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

    it('兩欄皆為數值時改用相關係數相似度：1 − |r原始 − r處理後| ÷ 2，泛化值以區間中點代表', () => {
        const numericHeader = ['年齡', '薪資', '疾病'];
        const numericOriginal = toCsv(numericHeader, [[31, 10, 'a'], [35, 20, 'a'], [42, 30, 'b'], [48, 40, 'b']]);
        const numericProcessed = toCsv(numericHeader, [['30-39', 10, 'a'], ['30-39', 20, 'a'], ['40-49', 30, 'b'], ['40-49', 40, 'b']]);
        const result = computeKAnonymityFidelity({ originalCsvText: numericOriginal, processedCsvText: numericProcessed, evaluatedColumns: ['年齡', '薪資'], anchorColumns: ['疾病'], numericColumns: ['年齡', '薪資'] })!;
        // numpy：r原始 0.99469、r處理後（年齡 33,33,45,45）0.89443 → 0.94987
        expect(result.columnPairTrends).toBeCloseTo(0.94987, 4);
    });

    it('未處理欄位都是常數時，依泛化設定配對，不會在刪除列之後整串錯位', () => {
        const stationHeader = ['車站', '業者'];
        const stationOriginal = toCsv(stationHeader, [['大安', 'T'], ['淡水', 'T'], ['大安', 'T'], ['板橋', 'T'], ['板橋', 'T']]);
        // 淡水那一筆被刪除；其餘泛化到「市」
        const stationProcessed = toCsv(stationHeader, [['臺北市', 'T'], ['臺北市', 'T'], ['新北市', 'T'], ['新北市', 'T']]);
        const config = {
            columns: { 車站: { role: 'quasi_identifier' }, 業者: { role: 'non_sensitive' } },
            generalization_matrices: { 車站: { mapping: { 大安: ['大安', '臺北市'], 淡水: ['淡水', '新北市'], 板橋: ['板橋', '新北市'] } } },
        };
        const result = computeKAnonymityFidelity({ originalCsvText: stationOriginal, processedCsvText: stationProcessed, evaluatedColumns: ['車站'], anchorColumns: ['業者'], kAnonymityConfig: config })!;
        // 正確配對：臺北市只涵蓋大安、新北市只涵蓋板橋 → 攤回後與原始分布只差被刪除的淡水（1 − 0.2 = 0.8）
        expect(result.columnShapes).toBeCloseTo(0.8, 5);
    });

    it('日期全在同一年時改以「日」分組，泛化到月會依天數平均攤回而扣分', () => {
        const dateHeader = ['時間', '業者'];
        // 1 月 1 日 100 筆、1 月 2～11 日各 1 筆（共 110 個不同時間，觸發分組）
        const rows: Array<[string, string]> = [];
        for (let index = 0; index < 100; index += 1) rows.push([`2024-01-01 08:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`, 'T']);
        for (let day = 2; day <= 11; day += 1) rows.push([`2024-01-${String(day).padStart(2, '0')} 08:00:00`, 'T']);
        const dateOriginal = toCsv(dateHeader, rows);
        const sameResult = computeKAnonymityFidelity({ originalCsvText: dateOriginal, processedCsvText: dateOriginal, evaluatedColumns: ['時間'], anchorColumns: ['業者'] })!;
        expect(sameResult.columnShapes).toBeCloseTo(1, 5);
        const monthResult = computeKAnonymityFidelity({ originalCsvText: dateOriginal, processedCsvText: toCsv(dateHeader, rows.map(() => ['2024-01', 'T'])), evaluatedColumns: ['時間'], anchorColumns: ['業者'] })!;
        // 攤回後 11 天各 1/11；原始 1 月 1 日佔 100/110 → 相似度 1 − (100/110 − 1/11) ≈ 0.18
        expect(monthResult.columnShapes).toBeCloseTo(1 - (100 / 110 - 1 / 11), 5);
    });

    it('未處理欄位被寫成小數（1 → 1.0）、日期格式不同時仍能配對，不會整個算不出來', () => {
        const mixedHeader = ['生日', '公車站數'];
        const mixedOriginal = toCsv(mixedHeader, [['1950/1/5', 1], ['1951/3/2', 2], ['1950/7/9', 1], ['1960/2/2', 3]]);
        // 1951 那筆被刪除；生日泛化到年；公車站數輸出成小數
        const mixedProcessed = toCsv(mixedHeader, [['1950', '1.0'], ['1950', '1.0'], ['1960', '3.0']]);
        const config = {
            columns: { 生日: { role: 'quasi_identifier' }, 公車站數: { role: 'non_sensitive' } },
            generalization_hierarchies: { 生日: { levels: ['day', 'month', 'year'] } },
        };
        const result = computeKAnonymityFidelity({ originalCsvText: mixedOriginal, processedCsvText: mixedProcessed, evaluatedColumns: ['生日', '公車站數'], anchorColumns: ['公車站數'], kAnonymityConfig: config });
        expect(result).not.toBeNull();
    });

    it('顯示捨去到小數二位，未達標不會顯示成 0.75', () => {
        expect(formatFidelityScore(0.7499)).toBe('0.74');
        expect(formatFidelityScore(0.9734)).toBe('0.97');
        expect(formatFidelityPercent(0.9634)).toBe('96%');
        expect(formatFidelityPercent(0.7499)).toBe('74%');
    });
});
