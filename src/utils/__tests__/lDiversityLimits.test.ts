import { describe, it, expect } from 'vitest';
import { findSmallestSensitiveColumnDistinct, computeEffectiveMaxLValue, computeLSliderMaxValue, isLValueExceedingSensitiveDistinct, isLNotLessThanK } from '../lDiversityLimits';
import type { DatasetProfile } from '../datasetProfile';

const buildProfile = (columns: Record<string, { distinctCount: number; isDistinctCountCapped?: boolean }>): DatasetProfile => ({
    fileKey: 'k', rowCount: 100, columnNamesList: Object.keys(columns), numericValues: {},
    columns: Object.fromEntries(Object.entries(columns).map(([name, info]) => [name, {
        nonEmptyCount: 100, distinctCount: info.distinctCount, isDistinctCountCapped: !!info.isDistinctCountCapped,
        topValues: [], numericCount: 0, nonNumericDistinctValues: []
    }]))
});

describe('l-多樣性上限', () => {
    const profile = buildProfile({ 疾病: { distinctCount: 5 }, 婚姻狀況: { distinctCount: 4 }, 身分證號: { distinctCount: 200000, isDistinctCountCapped: true } });

    it('多個敏感欄位時取相異值數最少者，忽略被截斷的極高基數欄位', () => {
        expect(findSmallestSensitiveColumnDistinct({ 疾病: 'Sensitive', 婚姻狀況: 'Sensitive', 身分證號: 'Sensitive', 年齡: 'Quasi-identifier' }, profile))
            .toEqual({ columnName: '婚姻狀況', distinctCount: 4 });
        expect(findSmallestSensitiveColumnDistinct({ 身分證號: 'Sensitive' }, profile)).toBeNull();
        expect(findSmallestSensitiveColumnDistinct({ 疾病: 'Sensitive' }, null)).toBeNull();
    });

    it('上限 = min(k, 相異值數)，沒有敏感欄位時退回備援上限', () => {
        const diseaseInfo = { columnName: '疾病', distinctCount: 5 };
        expect(computeEffectiveMaxLValue(diseaseInfo, 8, 1, 10)).toBe(5);
        expect(computeEffectiveMaxLValue(diseaseInfo, 3, 1, 10)).toBe(3);
        expect(computeEffectiveMaxLValue(null, 8, 1, 10)).toBe(8);
        expect(computeEffectiveMaxLValue(null, undefined, 1, 10)).toBe(10);
        expect(computeEffectiveMaxLValue({ columnName: 'x', distinctCount: 0 }, 8, 1, 10)).toBe(1);
    });

    it('l 超過相異值數時判定為必定無法通過', () => {
        expect(isLValueExceedingSensitiveDistinct(6, { columnName: '疾病', distinctCount: 5 })).toBe(true);
        expect(isLValueExceedingSensitiveDistinct(5, { columnName: '疾病', distinctCount: 5 })).toBe(false);
        expect(isLValueExceedingSensitiveDistinct(6, null)).toBe(false);
    });

    it('滑桿上限只受 K 限制且 l < K（上限 K − 1），不因敏感欄位相異值數少而鎖住（2026-10-13）', () => {
        expect(computeLSliderMaxValue(5, 1, 10)).toBe(4);
        expect(computeLSliderMaxValue(100, 1, 10)).toBe(99);
        expect(computeLSliderMaxValue(2, 1, 10)).toBe(1);
        expect(isLNotLessThanK(5, 5)).toBe(true);
        expect(isLNotLessThanK(4, 5)).toBe(false);
        expect(computeLSliderMaxValue(undefined, 1, 10)).toBe(10);
        expect(computeLSliderMaxValue(0, 1, 10)).toBe(10);
        // 敏感欄位只有 1 種值、K=5：可調到 4，但 l ≥ 2 會被判定為必定無法通過（畫面紅字＋擋下一步）
        expect(isLValueExceedingSensitiveDistinct(2, { columnName: '疾病', distinctCount: 1 })).toBe(true);
    });
});
