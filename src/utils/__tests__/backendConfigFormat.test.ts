import { describe, it, expect } from 'vitest';
import {
    buildBackendConfigDocumentFromWorkspace, resolveDpSensitivity, computeDefaultDpSensitivity, parseExplicitDpSensitivity,
    type DpStoreField, type WorkspaceConfigSource
} from '../pipelineConfig';

// 後端提供的範例設定檔 docs/manual_test/config_dp.json（dataset 改為本測試的檔名）
const BACKEND_SAMPLE_CONFIG_DP = {
    version: '1.2.0',
    dataset: 'input_1m.csv',
    input_format: 'csv',
    differential_privacy: {
        enabled: true,
        accumulated_epsilon: 0.0,
        accumulated_delta: 0.0,
        default_delta: 1e-05,
        column_budgets: {
            年齡: { type: 'continuous', epsilon_budget: 5.0, delta_budget: 0.0, sensitivity: 71.0, minimum_unit: 1, clipping_bounds: [0, 120], out_of_bounds_strategy: 'clamp' },
            薪資: { type: 'continuous', epsilon_budget: 5.0, delta_budget: 1e-05, sensitivity: 125000.0, minimum_unit: 1000, clipping_bounds: [0, 300000], out_of_bounds_strategy: 'fold' },
            就醫次數: { type: 'continuous', epsilon_budget: 4.0, sensitivity: 19.0, minimum_unit: 1, clipping_bounds: [0, 20], out_of_bounds_strategy: 'wrap' },
            地區: { type: 'categorical', epsilon_budget: 1.0 },
            職業: { type: 'categorical', epsilon_budget: 1.0 },
            生日: { type: 'datetime', epsilon_budget: 1.0, delta_budget: 0.0, sensitivity: 365.0, noise_unit: 'day', noise_step: 7, time_clipping_bounds: ['1930-01-01', '2026-12-31'], time_out_of_bounds_strategy: 'clamp' }
        }
    }
};

// Step2「匯入配置」讀入上面的範例後得到的欄位設定（對照 DifferentialPrivacyMapping.tsx 匯入邏輯：
// 沒有 delta_budget 時 δ 取預設 0.0001、模式為 ε-DP；溢出策略 clamp／fold／wrap → clip／reflect／wrap）
const IMPORTED_DP_FIELDS: DpStoreField[] = [
    { fieldName: '年齡', fieldType: 'Numeric', enabled: true, mode: 'epsilon', epsilon: 5, delta: 0, lowerBound: 0, upperBound: 120, minimumUnit: 1, outOfBoundsStrategy: 'clip', sensitivity: 71 },
    { fieldName: '薪資', fieldType: 'Numeric', enabled: true, mode: 'epsilon-delta', epsilon: 5, delta: 1e-5, lowerBound: 0, upperBound: 300000, minimumUnit: 1000, outOfBoundsStrategy: 'reflect', sensitivity: 125000 },
    { fieldName: '就醫次數', fieldType: 'Numeric', enabled: true, mode: 'epsilon', epsilon: 4, delta: 0.0001, lowerBound: 0, upperBound: 20, minimumUnit: 1, outOfBoundsStrategy: 'wrap', sensitivity: 19 },
    { fieldName: '地區', fieldType: 'Categorical', enabled: true, mode: 'epsilon', epsilon: 1, delta: 0.0001, lowerBound: 0, upperBound: 1 },
    { fieldName: '職業', fieldType: 'Categorical', enabled: true, mode: 'epsilon', epsilon: 1, delta: 0.0001, lowerBound: 0, upperBound: 1 },
    { fieldName: '生日', fieldType: 'Numeric', enabled: true, mode: 'epsilon', epsilon: 1, delta: 0, lowerBound: '1930-01-01', upperBound: '2026-12-31', noiseStep: 7, outOfBoundsStrategy: 'clip', sensitivity: 365 },
    // 範例沒有列出、未啟用的欄位不應出現在 column_budgets
    { fieldName: '姓名', fieldType: 'Text', enabled: false }
];

const baseWorkspace: WorkspaceConfigSource = {
    privacyMode: 'differential-privacy', fileName: 'input_1m.csv', columns: [], columnRoles: {}, columnTypes: {},
    kValue: 5, lValue: 2, tValue: 0.7, enableLDiversity: false, enableTCloseness: false,
    maxSuppression: 20, suppressionMethod: 'row_suppression', cellFillMethod: 'star', limitExceededAction: 'allow_with_warning',
    dpFields: IMPORTED_DP_FIELDS, dpAccumulatedEpsilon: 0, dpAccumulatedDelta: 0, targetDelta: 1e-5
};

describe('與後端 config_dp.json 範例對齊', () => {
    it('匯入範例後組出的設定檔與範例一致（唯一差異：就醫次數明確送出 delta_budget 0）', () => {
        const expectedConfig = structuredClone(BACKEND_SAMPLE_CONFIG_DP);
        // 範例省略了「就醫次數」的 delta_budget；前端在 ε-DP 模式一律明確送 0（見 pipelineConfig.ts 說明）
        (expectedConfig.differential_privacy.column_budgets.就醫次數 as Record<string, unknown>).delta_budget = 0;
        expect(buildBackendConfigDocumentFromWorkspace(baseWorkspace)).toEqual(expectedConfig);
    });

    it('未指定敏感度時維持以邊界寬度計算（先前的行為）', () => {
        const withoutSensitivity = IMPORTED_DP_FIELDS.map((field) => ({ ...field, sensitivity: undefined }));
        const config = buildBackendConfigDocumentFromWorkspace({ ...baseWorkspace, dpFields: withoutSensitivity }) as typeof BACKEND_SAMPLE_CONFIG_DP;
        const budgets = config.differential_privacy.column_budgets;
        expect(budgets.年齡.sensitivity).toBe(120);
        expect(budgets.薪資.sensitivity).toBe(300000);
        expect(budgets.生日.sensitivity).toBe(35428);
    });

    it('敏感度：有效的明確值優先，0／負數／空字串視為未指定', () => {
        expect(parseExplicitDpSensitivity('')).toBeNull();
        expect(parseExplicitDpSensitivity(0)).toBeNull();
        expect(parseExplicitDpSensitivity(-3)).toBeNull();
        expect(parseExplicitDpSensitivity('71')).toBe(71);
        expect(resolveDpSensitivity({ lowerBound: 0, upperBound: 120, sensitivity: undefined }, false)).toBe(120);
        expect(resolveDpSensitivity({ lowerBound: 0, upperBound: 120, sensitivity: 71 }, false)).toBe(71);
        expect(computeDefaultDpSensitivity({ lowerBound: '2026-01-01', upperBound: '2026-12-31' }, true)).toBe(364);
        expect(computeDefaultDpSensitivity({ lowerBound: 'x', upperBound: '2026-12-31' }, true)).toBeNull();
        expect(computeDefaultDpSensitivity({ lowerBound: '', upperBound: 5 }, false)).toBeNull();
    });
});

describe('K-匿名後端設定檔外層格式', () => {
    it('外層為 version／dataset／input_format，k_anonymity 區塊與 Step4 送出一致；欄位不在設定清單時用 columnRoles', () => {
        const config = buildBackendConfigDocumentFromWorkspace({
            ...baseWorkspace,
            privacyMode: 'k-anonymity', fileName: 'input_test.csv',
            columns: ['﻿姓名', '疾病', '婚姻狀況'],
            columnRoles: { 婚姻狀況: 'Non-sensitive', 疾病: 'Sensitive' },
            kAnonymityFields: [{ name: '姓名', role: 'Identifier', type: 'string', maskStrategy: 'hash' }],
            kAnonymityHierarchies: []
        });
        expect(config).toEqual({
            version: '1.2.0', dataset: 'input_test.csv', input_format: 'csv',
            k_anonymity: {
                enabled: true, k: 5, suppression_limit_percent: 20, limit_exceeded_action: 'allow_with_warning', suppression_method: 'row_suppression',
                columns: {
                    姓名: { role: 'identifier', type: 'string', strategy: 'hash' },
                    疾病: { role: 'sensitive', type: 'string' },
                    婚姻狀況: { role: 'non_sensitive', type: 'string' }
                }
            }
        });
    });

    it('尚未選擇隱私模式時回傳 null；沒有檔名時用 dataset.csv', () => {
        expect(buildBackendConfigDocumentFromWorkspace({ ...baseWorkspace, privacyMode: null })).toBeNull();
        expect(buildBackendConfigDocumentFromWorkspace({ ...baseWorkspace, fileName: undefined })).toMatchObject({ dataset: 'dataset.csv' });
    });
});

describe('本次實際消耗的 ε／δ（Step3 預算中心與 Step4 共用）', () => {
    it('逐欄直接相加，與送出的 column_budgets 一致；不再把 (ε,δ)-DP 欄位換算成「等效 ε」', async () => {
        const { computeDpConsumedBudgetsByField, sumDpConsumedBudgets } = await import('../pipelineConfig');
        // 你的設定：薪資 ε=5、δ=1e-5（全域目標 δ=1e-4 時舊的「等效 ε」會算成 4，總和 16）
        expect(sumDpConsumedBudgets(IMPORTED_DP_FIELDS)).toEqual({ totalEpsilon: 17, totalDelta: 1e-5 });
        expect(computeDpConsumedBudgetsByField(IMPORTED_DP_FIELDS).薪資).toEqual({ epsilon: 5, delta: 1e-5 });
        // 類別型、ε-DP 模式欄位畫面上留著預設 δ，但實際送出 0，不計入
        expect(computeDpConsumedBudgetsByField(IMPORTED_DP_FIELDS).地區).toEqual({ epsilon: 1, delta: 0 });
        expect(computeDpConsumedBudgetsByField(IMPORTED_DP_FIELDS).就醫次數).toEqual({ epsilon: 4, delta: 0 });
        expect(computeDpConsumedBudgetsByField(IMPORTED_DP_FIELDS)).not.toHaveProperty('姓名');
    });
});
