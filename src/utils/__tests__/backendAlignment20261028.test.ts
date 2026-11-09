/**
 * ★ 2026-10-28 前後端對齊：
 *   - 差分隱私：沒有上下界時不送超界策略（後端 ERR_DP_INVALID_BUDGET「填了超界策略卻未填上下界」）
 *   - 資料預先處理雜湊預設 sha3-256
 *   - 合規報告缺值時超限行為預設 allow_with_warning
 */
import { describe, it, expect } from 'vitest';
import { buildDifferentialPrivacyConfig } from '../pipelineConfig';
import { buildPreprocessBlock, DEFAULT_PREPROCESS_HASH_ALGORITHM } from '../preprocessConfig';
import { buildComplianceReportSnapshot } from '../complianceReport';
import { RISK_ATTACK_DEFAULT_PARAMS } from '../riskConfigImport';

describe('差分隱私超界策略只在有上下界時送出', () => {
    const buildBudgets = (dpFields: Parameters<typeof buildDifferentialPrivacyConfig>[0]['dpFields']) =>
        (buildDifferentialPrivacyConfig({ dpFields, columnTypes: {}, accumulatedEpsilon: 0, accumulatedDelta: 0, targetDelta: 1e-5 })
            .differential_privacy as { column_budgets: Record<string, Record<string, unknown>> }).column_budgets;

    it('連續數值：沒有上下界不送 out_of_bounds_strategy；有上下界照送', () => {
        const budgets = buildBudgets([
            { fieldName: '無邊界', enabled: true, fieldType: 'Numeric', mode: 'epsilon', epsilon: 1, delta: 0, lowerBound: '', upperBound: '', outOfBoundsStrategy: 'reflect' },
            { fieldName: '有邊界', enabled: true, fieldType: 'Numeric', mode: 'epsilon', epsilon: 1, delta: 0, lowerBound: 0, upperBound: 100, outOfBoundsStrategy: 'reflect' },
        ]);
        expect(budgets['無邊界']).not.toHaveProperty('out_of_bounds_strategy');
        expect(budgets['無邊界']).not.toHaveProperty('clipping_bounds');
        expect(budgets['有邊界']).toMatchObject({ clipping_bounds: [0, 100], out_of_bounds_strategy: 'fold' });
    });

    it('日期時間：沒有上下界不送 time_out_of_bounds_strategy', () => {
        const budgets = buildBudgets([
            { fieldName: '就診時間', enabled: true, fieldType: 'Numeric', isDateTime: true, mode: 'epsilon', epsilon: 1, delta: 0, lowerBound: '', upperBound: '', outOfBoundsStrategy: 'clip', noiseUnit: 'minute' },
        ]);
        expect(budgets['就診時間']).not.toHaveProperty('time_out_of_bounds_strategy');
        expect(budgets['就診時間']).not.toHaveProperty('time_clipping_bounds');
    });
});

describe('其他預設值', () => {
    it('資料預先處理雜湊未指定演算法時送 sha3-256', () => {
        expect(DEFAULT_PREPROCESS_HASH_ALGORITHM).toBe('sha3-256');
        expect(buildPreprocessBlock(['姓名'], { 姓名: [{ action: 'hash', params: { seedMode: 'none' } }] }, {})?.algorithm).toBe('sha3-256');
    });

    it('檢測報告：缺超限行為時記為 allow_with_warning（與送出的設定檔一致）', () => {
        const snapshot = buildComplianceReportSnapshot({
            privacyMode: 'k-anonymity', kValue: 5, maxSuppressionPercent: null, limitExceededAction: null, suppressionMethod: null, cellFillMethod: null,
            dpAccumulatedEpsilon: 0, dpAccumulatedDelta: 0, dpDefaultDelta: 0, riskAttackParams: RISK_ATTACK_DEFAULT_PARAMS,
            attackRisks: null, capReport: null, suppressionRatePercent: 0, consumedEpsilon: null, deidentifiedColumnsCount: 0, totalColumnsCount: 0
        });
        expect(snapshot.kAnonymityConfig).toMatchObject({ maxSuppressionPercent: 20, limitExceededAction: 'allow_with_warning' });
    });
});
