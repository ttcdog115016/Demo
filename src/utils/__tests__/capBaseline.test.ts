import { describe, it, expect } from 'vitest';
import { computeCapShuffleBaselineFromCsvText, computeCapExcessRisk, isCapExcessNotApplicable } from '../capBaseline';

describe('computeCapShuffleBaselineFromCsvText', () => {
    // 地區 A：否否是；地區 B：否是；地區 C：（缺值）
    const csvText = '地區,年齡,疾病\nA,30,否\nA,30,否\nA,40,是\nB,40,否\nB,50,是\nC,50,\n';
    it('重算的 CAP 與後端公式一致（Σ 各組眾數次數 ÷ 總列數，缺值不計分子、留在分母）', () => {
        const result = computeCapShuffleBaselineFromCsvText({ csvText, quasiIdentifierColumnNames: ['地區'], sensitiveColumnName: '疾病' })!;
        expect(result.recomputedCap).toBeCloseTo(3 / 6);
        expect(result.rowCount).toBe(6);
        expect(result.baseline).toBeGreaterThan(0);
        expect(result.baseline).toBeLessThanOrEqual(5 / 6);
    });
    it('固定種子，同一份資料結果相同', () => {
        const a = computeCapShuffleBaselineFromCsvText({ csvText, quasiIdentifierColumnNames: ['地區'], sensitiveColumnName: '疾病' })!;
        const b = computeCapShuffleBaselineFromCsvText({ csvText, quasiIdentifierColumnNames: ['地區'], sensitiveColumnName: '疾病' })!;
        expect(a.baseline).toBe(b.baseline);
    });
    it('只有一組時基線＝最常見值佔比', () => {
        const oneGroupCsv = 'g,s\nx,a\nx,a\nx,b\nx,a\n';
        expect(computeCapShuffleBaselineFromCsvText({ csvText: oneGroupCsv, quasiIdentifierColumnNames: ['g'], sensitiveColumnName: 's' })!.baseline).toBeCloseTo(3 / 4);
    });
    it('子群體條件先篩再算', () => {
        const result = computeCapShuffleBaselineFromCsvText({ csvText, quasiIdentifierColumnNames: ['地區'], sensitiveColumnName: '疾病', subgroupPayload: { 年齡: { min: 40, max: 50 } } })!;
        expect(result.rowCount).toBe(4);
    });
    it('日期區間條件與後端一致：以日比較、首尾皆含，可只給一側，轉不成日期者落選', () => {
        const dateCsv = '地區,就診日,疾病\nA,2024-01-01,否\nA,2024/03/15,是\nB,2024-06-30 23:59,否\nB,2024-07-01,是\nC,不詳,否\nC,2023-12-31,是\n';
        const runWith = (range: { min?: string; max?: string }) =>
            computeCapShuffleBaselineFromCsvText({ csvText: dateCsv, quasiIdentifierColumnNames: ['地區'], sensitiveColumnName: '疾病', subgroupPayload: { 就診日: range } })?.rowCount;
        expect(runWith({ min: '2024-01-01', max: '2024-06-30' })).toBe(3);
        expect(runWith({ min: '2024-06-30' })).toBe(2);
        expect(runWith({ max: '2023-12-31' })).toBe(1);
    });
    it('欄位不存在或篩選後無資料回傳 null', () => {
        expect(computeCapShuffleBaselineFromCsvText({ csvText, quasiIdentifierColumnNames: ['不存在'], sensitiveColumnName: '疾病' })).toBeNull();
        expect(computeCapShuffleBaselineFromCsvText({ csvText, quasiIdentifierColumnNames: ['地區'], sensitiveColumnName: '疾病', subgroupPayload: { 年齡: { min: 99 } } })).toBeNull();
    });
});

describe('computeCapExcessRisk', () => {
    it('(CAP − 基線) ÷ (1 − 基線)，下限 0', () => {
        expect(computeCapExcessRisk(0.487, 0.45)).toBeCloseTo(0.037 / 0.55);
        expect(computeCapExcessRisk(0.4, 0.45)).toBe(0);
        expect(computeCapExcessRisk(1, 0.45)).toBe(1);
    });
    it('CAP 未評估或無基線回傳 null', () => {
        expect(computeCapExcessRisk(-1, 0.4)).toBeNull();
        expect(computeCapExcessRisk(0.5, null)).toBeNull();
    });
    it('間接識別欄位幾乎每筆都不同（基線 ≥ 95%）時不適用，避免 CAP 1.0 vs 基線 0.9999 被放大成 100%', () => {
        expect(computeCapExcessRisk(1, 0.9999)).toBeNull();
        expect(computeCapExcessRisk(1, 1)).toBeNull();
        expect(isCapExcessNotApplicable(0.96)).toBe(true);
        expect(isCapExcessNotApplicable(0.9)).toBe(false);
        expect(computeCapExcessRisk(0.95, 0.9)).toBeCloseTo(0.5);
    });
});
