import { describe, it, expect } from 'vitest';
import {
    generateEvenlyDistributedBins, generateUnitWidthBins, calculateNiceRoundingUnit,
    findNumericMinMax, computeUnitModeStartValue, extendFirstBinLowerBoundToZero, MAX_AUTO_GENERATED_BIN_COUNT
} from '../binGeneration';

const labels = (bins: { label: string }[]) => bins.map((bin) => bin.label);

describe('數值型自訂區間自動產生', () => {
    it('平均分配：切成指定數量，最後一格為不限', () => {
        const bins = generateEvenlyDistributedBins(18, 89, 5);
        expect(bins).toHaveLength(5);
        expect(labels(bins)).toEqual(['18 - 32.2', '32.2 - 46.4', '46.4 - 60.6', '60.6 - 74.8', '74.8 +']);
        expect(bins[4].max).toBeNull();
    });

    it('平均分配：第一格下限延伸至 0，區間數量不變', () => {
        const bins = extendFirstBinLowerBoundToZero(generateEvenlyDistributedBins(18, 89, 5), 18);
        expect(bins).toHaveLength(5);
        expect(bins[0]).toEqual({ min: 0, max: 32.2, label: '0 - 32.2' });
    });

    it('延伸至 0：最小值 ≤ 0 或第一格已 ≤ 0 時不改變', () => {
        const negativeBins = generateEvenlyDistributedBins(-10, 10, 2);
        expect(extendFirstBinLowerBoundToZero(negativeBins, -10)).toBe(negativeBins);
        const zeroStartBins = generateUnitWidthBins(18, 89, 10);
        expect(extendFirstBinLowerBoundToZero(zeroStartBins, 18)).toBe(zeroStartBins);
        expect(extendFirstBinLowerBoundToZero([], 5)).toEqual([]);
    });

    it('最小單位：自 0 起算固定級距，最後一格為不限', () => {
        expect(labels(generateUnitWidthBins(18, 89, 10))).toEqual(['0 - 10', '10 - 20', '20 - 30', '30 - 40', '40 - 50', '50 - 60', '60 - 70', '70 - 80', '80 +']);
        expect(labels(generateUnitWidthBins(25000, 149999, 20000))[0]).toBe('0 - 20000');
    });

    it('最小單位：含負數時自不大於最小值的整數倍起算', () => {
        expect(computeUnitModeStartValue(-15, 10)).toBe(-20);
        expect(computeUnitModeStartValue(18, 10)).toBe(0);
        expect(labels(generateUnitWidthBins(-15, 30, 10))).toEqual(['-20 - -10', '-10 - 0', '0 - 10', '10 - 20', '20 +']);
    });

    it('最小單位：區間數不超過上限', () => {
        expect(generateUnitWidthBins(0, 1000000, 1).length).toBe(MAX_AUTO_GENERATED_BIN_COUNT);
    });

    it('輸入不合法時回傳空陣列', () => {
        expect(generateEvenlyDistributedBins(5, 5, 3)).toEqual([]);
        expect(generateUnitWidthBins(0, 10, 0)).toEqual([]);
    });

    it('建議捨入單位取 1／2／5 × 10^n', () => {
        expect(calculateNiceRoundingUnit(18, 89, 5)).toBe(10);
        expect(calculateNiceRoundingUnit(25000, 150000, 5)).toBe(20000);
        expect(calculateNiceRoundingUnit(5, 5, 5)).toBeUndefined();
    });

    it('最小／最大值：大量資料不會 RangeError，忽略非有限值', () => {
        const largeList = Array.from({ length: 1_000_000 }, (_, index) => index);
        expect(findNumericMinMax(largeList)).toEqual({ min: 0, max: 999999 });
        expect(findNumericMinMax([3, Number.NaN, -2, Infinity])).toEqual({ min: -2, max: 3 });
        expect(findNumericMinMax([])).toBeNull();
    });
});
