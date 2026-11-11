import { describe, it, expect } from 'vitest';
import {
    parseNumericCellForBinning, computeAutoNiceBinWidth, convertNumberToBinLabel,
    analyzeNumericColumnRange, computeBinnedColumnStats, applySensitiveBinningToCsvText
} from '../sensitiveBinning';
import type { DatasetProfile } from '../datasetProfile';

const salaryProfile: DatasetProfile = {
    fileKey: 'k', rowCount: 4, columnNamesList: ['薪資', '疾病'],
    numericValues: { 薪資: [56660, 140853, 72861, 118856] },
    columns: {
        薪資: { nonEmptyCount: 4, distinctCount: 4, isDistinctCountCapped: false, topValues: [], numericCount: 4, nonNumericDistinctValues: [] },
        疾病: { nonEmptyCount: 4, distinctCount: 2, isDistinctCountCapped: false, topValues: [], numericCount: 0, nonNumericDistinctValues: ['感冒', '高血壓'] }
    }
};

describe('敏感欄位自動分級距', () => {
    it('儲存格轉數字：容許千分位逗號，其餘回傳 null', () => {
        expect(parseNumericCellForBinning('52,000')).toBe(52000);
        expect(parseNumericCellForBinning(' 7 ')).toBe(7);
        expect(parseNumericCellForBinning('*')).toBeNull();
        expect(parseNumericCellForBinning('')).toBeNull();
    });

    it('自動寬度約分 10 級，取 1／2／5 × 10^n', () => {
        expect(computeAutoNiceBinWidth(23000, 187000)).toBe(20000);
        expect(computeAutoNiceBinWidth(18, 75)).toBe(10);
        expect(computeAutoNiceBinWidth(5, 5)).toBe(1);
    });

    it('級距標籤以 0 為原點切齊，並處理浮點誤差與負數', () => {
        expect(convertNumberToBinLabel(52340, 20000)).toBe('40000~60000');
        expect(convertNumberToBinLabel(0.3, 0.1)).toBe('0.3~0.4');
        expect(convertNumberToBinLabel(-1200, 500)).toBe('-1500~-1000');
    });

    it('只有幾乎全為數值的欄位才回傳範圍', () => {
        expect(analyzeNumericColumnRange(salaryProfile, '薪資')).toEqual({ min: 56660, max: 140853 });
        expect(analyzeNumericColumnRange(salaryProfile, '疾病')).toBeNull();
        expect(analyzeNumericColumnRange(salaryProfile, '不存在')).toBeNull();
    });

    it('分級距後的相異值數與佔比', () => {
        expect(computeBinnedColumnStats(salaryProfile, '薪資', 20000)).toEqual({ distinctCount: 4, uniqueRatio: 1 });
        expect(computeBinnedColumnStats(salaryProfile, '薪資', 50000)).toEqual({ distinctCount: 2, uniqueRatio: 0.5 });
        expect(computeBinnedColumnStats(salaryProfile, '疾病', 50000)).toEqual({ distinctCount: 2, uniqueRatio: 0.5 });
    });

    it('CSV 只轉換指定欄位，保留 BOM 與非數值儲存格', () => {
        const convertedText = applySensitiveBinningToCsvText('﻿薪資,疾病\n56660,感冒\n*,高血壓\n', { 薪資: 50000 });
        expect(convertedText.startsWith('﻿')).toBe(true);
        expect(convertedText.slice(1).split(/\r?\n/)).toEqual(['薪資,疾病', '50000~100000,感冒', '*,高血壓']);
        expect(applySensitiveBinningToCsvText('a\n1\n', {})).toBe('a\n1\n');
    });
});
