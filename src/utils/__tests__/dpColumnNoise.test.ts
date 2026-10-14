/**
 * ★ 2026-10-12：差分隱私逐欄雜訊判斷（取代以 ε 合計判斷的「雜訊少」）
 */
import { describe, it, expect } from 'vitest';
import { describeDpColumnNoise, classifyDpNoiseRatio, summarizeDpUtility, estimateDpColumnNoiseFromSettings, type DpColumnNoiseInfo } from '../dpColumnNoise';
import type { DpPerColumnBudgetReport } from '../../api/apiService';

const continuousReport = (overrides: Partial<DpPerColumnBudgetReport> = {}): DpPerColumnBudgetReport => ({
    column: '年齡', type: 'continuous', mechanism: 'DiscreteLaplace', epsilon: 3, sensitivity: 120, sensitivity_source: null, minimum_unit: 1, ...overrides
});

describe('describeDpColumnNoise', () => {
    it('門檻：< 5% 少、5%～15% 中等、≥ 15% 多', () => {
        expect(classifyDpNoiseRatio(0.049)).toBe(1);
        expect(classifyDpNoiseRatio(0.05)).toBe(2);
        expect(classifyDpNoiseRatio(0.149)).toBe(2);
        expect(classifyDpNoiseRatio(0.15)).toBe(3);
    });

    it('預設敏感度＝上下限寬度時，偏差比例 ≈ 1/ε：ε=3 → 約 33%，雜訊多（即使 6 欄合計 ε=17）', () => {
        const info = describeDpColumnNoise({ report: continuousReport(), lowerBound: 0, upperBound: 120 })!;
        expect(info.ratio).toBeCloseTo(1 / 3);
        expect(info.levelText).toBe('雜訊多');
        expect(info.detailText).toBe('平均偏差約 ±40（約範圍的 33%）');
    });

    it('使用者指定較小敏感度時雜訊變少；刻度換算回原單位', () => {
        // 薪資 0～200000、刻度 1000、敏感度 5（刻度）＝5000 元、ε=2 → 偏差 2.5 刻度＝2500 元，佔 1.25%
        const info = describeDpColumnNoise({
            report: continuousReport({ column: '薪資', epsilon: 2, sensitivity: 5, minimum_unit: 1000 }),
            lowerBound: 0, upperBound: 200000
        })!;
        expect(info.levelText).toBe('雜訊少');
        expect(info.detailText).toBe('平均偏差約 ±2,500（約範圍的 1%）');
    });

    it('日期型以雜訊單位顯示', () => {
        const info = describeDpColumnNoise({
            report: { column: '生日', type: 'datetime', mechanism: 'DiscreteLaplace', epsilon: 4, sensitivity: 36500, sensitivity_source: null, noise_unit: 'day', noise_step: 1 },
            lowerBound: '1925-01-01', upperBound: '2024-12-31'
        })!;
        expect(info.detailText.startsWith('平均偏差約 ±9,125 天')).toBe(true);
        expect(info.levelText).toBe('雜訊多');
    });

    it('高斯機制考慮 δ', () => {
        const laplace = describeDpColumnNoise({ report: continuousReport({ epsilon: 10, sensitivity: 10 }), lowerBound: 0, upperBound: 120 })!;
        const gaussian = describeDpColumnNoise({ report: continuousReport({ epsilon: 10, sensitivity: 10, mechanism: 'DiscreteGaussian', delta: 1e-5 }), lowerBound: 0, upperBound: 120 })!;
        expect(gaussian.ratio).toBeGreaterThan(laplace.ratio);
    });

    it('類別型 k-RR：被換掉的比例＝(k−1)/(e^ε+k−1)', () => {
        const info = describeDpColumnNoise({
            report: { column: '地區', type: 'categorical', mechanism: 'k-RR', epsilon: 3, sensitivity: null, sensitivity_source: null },
            categoryCount: 12
        })!;
        expect(info.ratio).toBeCloseTo(11 / (Math.exp(3) + 11));
        expect(info.levelText).toBe('雜訊多');
        expect(info.detailText).toContain('共 12 類');
    });

    it('資訊不足時回傳 null（不亂下結論）', () => {
        expect(describeDpColumnNoise({ report: continuousReport() })).toBeNull(); // 沒有上下限
        expect(describeDpColumnNoise({ report: { column: '地區', type: 'categorical', mechanism: 'k-RR', epsilon: 3, sensitivity: null, sensitivity_source: null } })).toBeNull();
        expect(describeDpColumnNoise({ report: continuousReport({ epsilon: 0 }), lowerBound: 0, upperBound: 120 })).toBeNull();
    });
});

const infoOf = (level: 1 | 2 | 3): DpColumnNoiseInfo => ({ level, levelText: '', ratio: 0, detailText: '' });

describe('summarizeDpUtility：看雜訊多的欄位佔多少', () => {
    it('沒有雜訊多、且超過一半雜訊少 → 高', () => {
        expect(summarizeDpUtility([{ column: 'a', info: infoOf(1) }, { column: 'b', info: infoOf(1) }, { column: 'c', info: infoOf(2) }])!.level).toBe(1);
    });
    it('沒有雜訊多、但雜訊少不到一半 → 中', () => {
        expect(summarizeDpUtility([{ column: 'a', info: infoOf(1) }, { column: 'b', info: infoOf(2) }])!.level).toBe(2);
    });
    it('有雜訊多但不到一半 → 中，並列出欄位', () => {
        const summary = summarizeDpUtility([{ column: '薪資', info: infoOf(3) }, { column: 'b', info: infoOf(1) }, { column: 'c', info: infoOf(1) }])!;
        expect(summary.level).toBe(2);
        expect(summary.noisyColumns).toEqual(['薪資']);
    });
    it('一半以上雜訊多 → 低；單一欄位不會因其他欄位被稀釋', () => {
        expect(summarizeDpUtility([{ column: 'a', info: infoOf(3) }, { column: 'b', info: infoOf(1) }])!.level).toBe(3);
    });
    it('無法判斷的欄位不計；全部無法判斷回傳 null', () => {
        expect(summarizeDpUtility([{ column: 'a', info: null }])).toBeNull();
        expect(summarizeDpUtility([{ column: 'a', info: null }, { column: 'b', info: infoOf(1) }])!.level).toBe(1);
    });
});

describe('estimateDpColumnNoiseFromSettings（Step3 預估）與 Step4 報告算法一致', () => {
    it('數值欄位：未指定敏感度＝上下限寬度，刻度換算', () => {
        const estimated = estimateDpColumnNoiseFromSettings({
            field: { fieldName: '薪資', fieldType: 'Numeric', epsilon: 2, lowerBound: 0, upperBound: 200000, minimumUnit: 1000, mode: 'epsilon' },
            epsilon: 2, globalDelta: 1e-5, isDateTime: false
        })!;
        const fromReport = describeDpColumnNoise({
            report: continuousReport({ column: '薪資', epsilon: 2, sensitivity: 200, minimum_unit: 1000 }), lowerBound: 0, upperBound: 200000
        })!;
        expect(estimated.ratio).toBeCloseTo(fromReport.ratio);
        expect(estimated.ratio).toBeCloseTo(0.5);
    });
    it('沿用全域 δ 時以 Gaussian 估算（偏差較大）', () => {
        const base = { fieldName: '年齡', fieldType: 'Numeric', lowerBound: 0, upperBound: 120, sensitivity: 10 } as const;
        const laplace = estimateDpColumnNoiseFromSettings({ field: { ...base, mode: 'epsilon' }, epsilon: 10, globalDelta: 1e-5, isDateTime: false })!;
        const gaussian = estimateDpColumnNoiseFromSettings({ field: { ...base, mode: 'default-delta' }, epsilon: 10, globalDelta: 1e-5, isDateTime: false })!;
        expect(gaussian.ratio).toBeGreaterThan(laplace.ratio);
    });
    it('類別欄位用類別數', () => {
        const info = estimateDpColumnNoiseFromSettings({ field: { fieldName: '地區', fieldType: 'Categorical' }, epsilon: 5, globalDelta: 1e-5, isDateTime: false, categoryCount: 4 })!;
        expect(info.ratio).toBeCloseTo(3 / (Math.exp(5) + 3));
        expect(info.levelText).toBe('雜訊少');
    });
});
