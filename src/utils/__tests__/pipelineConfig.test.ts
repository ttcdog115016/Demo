import { describe, it, expect } from 'vitest';
import {
    buildKAnonymityConfig, buildDifferentialPrivacyConfig, buildKAnonymityApiOptions,
    buildDifferentialPrivacyApiOptions, computeDpTotalBudgets, type KAnonymityPipelineSettings
} from '../pipelineConfig';

const baseSettings: KAnonymityPipelineSettings = {
    kValue: 5, lValue: 2, tValue: 0.7, enableLDiversity: true, enableTCloseness: true,
    maxSuppression: 20, suppressionMethod: 'row_suppression', cellFillMethod: 'star', limitExceededAction: 'allow_with_warning'
};

// 對照 config_kanon.json（刪除驗證用設定檔）的欄位設定
const kanonFields = [
    { name: '姓名', role: 'Identifier', type: 'string', maskStrategy: 'hash' },
    { name: '身分證號', role: 'Identifier', type: 'string', maskStrategy: 'hash' },
    { name: '生日', role: 'Quasi-identifier', type: 'temporal', genStrategy: 'time_rounding', genMaxLevel: 3 },
    { name: '年齡', role: 'Quasi-identifier', type: 'numeric', genStrategy: 'custom_bins', genMaxLevel: 2,
      customBins: [{ min: null, max: 18, label: '未成年' }, { min: 18, max: 40, label: '青年' }, { min: 40, max: 65, label: '中年' }, { min: 65, max: null, label: '銀髮族' }] },
    { name: '薪資', role: 'Quasi-identifier', type: 'numeric', genStrategy: 'rounding', genParam: 50000 },
    { name: '就醫次數', role: 'Quasi-identifier', type: 'numeric', genStrategy: 'rounding', genParam: '10' },
    { name: '地區', role: 'Quasi-identifier', type: 'categorical', genMaxLevel: 2 },
    { name: '疾病', role: 'Sensitive', type: 'categorical' },
    { name: '婚姻狀況', role: 'Non-sensitive', type: 'categorical' }
];
const kanonHierarchies = [
    { fieldName: '地區', mappings: [['大安區', '臺北市', '北部', '全國'], ['板橋區', '新北市', '北部', '全國', ''], ['', 'x']] }
];
const buildKanon = (overrides: Partial<Parameters<typeof buildKAnonymityConfig>[0]> = {}) => buildKAnonymityConfig({
    ...baseSettings,
    processedColumnNames: kanonFields.map((field) => field.name),
    kAnonymityFields: kanonFields,
    kAnonymityHierarchies: kanonHierarchies,
    resolveFallbackUiRole: () => 'Non-sensitive',
    ...overrides
});

describe('K-匿名 config.json 組裝', () => {
    it('與 config_kanon.json 的結構一致', () => {
        expect(buildKanon()).toEqual({
            k_anonymity: {
                enabled: true, k: 5, l: 2, t: 0.7,
                suppression_limit_percent: 20, limit_exceeded_action: 'allow_with_warning', suppression_method: 'row_suppression',
                columns: {
                    姓名: { role: 'identifier', type: 'string', strategy: 'hash' },
                    身分證號: { role: 'identifier', type: 'string', strategy: 'hash' },
                    生日: { role: 'quasi_identifier', type: 'temporal' },
                    年齡: { role: 'quasi_identifier', type: 'numeric' },
                    薪資: { role: 'quasi_identifier', type: 'numeric' },
                    就醫次數: { role: 'quasi_identifier', type: 'numeric' },
                    地區: { role: 'quasi_identifier', type: 'categorical' },
                    疾病: { role: 'sensitive', type: 'categorical' },
                    婚姻狀況: { role: 'non_sensitive', type: 'categorical' }
                },
                generalization_hierarchies: {
                    生日: { levels: ['second', 'minute', 'hour', 'day', 'month', 'year'] },
                    年齡: { bins: [{ min: null, max: 18, label: '未成年' }, { min: 18, max: 40, label: '青年' }, { min: 40, max: 65, label: '中年' }, { min: 65, max: null, label: '銀髮族' }] },
                    薪資: { rounding: 50000 },
                    就醫次數: { rounding: 10 }
                },
                generalization_matrices: {
                    地區: { mapping: { 大安區: ['大安區', '臺北市', '北部', '全國'], 板橋區: ['板橋區', '新北市', '北部', '全國'] } }
                },
                // 數值型間接識別欄位不寫層級
                qi_generalization_levels: { 生日: 3, 地區: 2 }
            }
        });
    });

    it('未啟用 l／t 時不送；值抑制時才送 cell_fill', () => {
        const kanonBlock = buildKanon({ enableLDiversity: false, enableTCloseness: false, suppressionMethod: 'cell', cellFillMethod: 'missing' }).k_anonymity as Record<string, unknown>;
        expect(kanonBlock).not.toHaveProperty('l');
        expect(kanonBlock).not.toHaveProperty('t');
        expect(kanonBlock.suppression_method).toBe('cell_suppression');
        expect(kanonBlock.cell_fill).toBe('missing');
        expect(buildKanon().k_anonymity).not.toHaveProperty('cell_fill');
    });

    it('缺值時套用預設（抑制率 5、超限即停止）', () => {
        const kanonBlock = buildKanon({ maxSuppression: null, limitExceededAction: '' }).k_anonymity as Record<string, unknown>;
        expect(kanonBlock.suppression_limit_percent).toBe(5);
        expect(kanonBlock.limit_exceeded_action).toBe('stop_and_error');
    });

    it('欄位名稱去除 BOM／零寬空白；舊的 drop 轉為 remove；未設定欄位改用畫面角色', () => {
        const config = buildKAnonymityConfig({
            ...baseSettings,
            processedColumnNames: ['\uFEFF姓名', '\u200B地區', '備註'],
            kAnonymityFields: [{ name: '姓名', role: 'Identifier', type: 'string', maskStrategy: 'drop' }, { name: '\uFEFF地區', role: 'Quasi-identifier', type: 'categorical', genMaxLevel: 1 }],
            kAnonymityHierarchies: [{ fieldName: '\u200B地區', mappings: [['大安區', '臺北市']] }],
            resolveFallbackUiRole: (columnName) => (columnName === '備註' ? 'Sensitive' : 'Non-sensitive')
        }).k_anonymity as Record<string, Record<string, unknown>>;
        expect(config.columns).toEqual({
            姓名: { role: 'identifier', type: 'string', strategy: 'remove' },
            地區: { role: 'quasi_identifier', type: 'categorical' },
            備註: { role: 'sensitive', type: 'string' }
        });
        expect(Object.keys(config.generalization_matrices)).toEqual(['地區']);
        expect(config.qi_generalization_levels).toEqual({ 地區: 1 });
    });

    it('文字型遮蔽：保留後綴→suffix；依字串長度固定層級 1、bin_size 預設 5', () => {
        const config = buildKAnonymityConfig({
            ...baseSettings,
            processedColumnNames: ['地址', '備註'],
            kAnonymityFields: [
                { name: '地址', role: 'Quasi-identifier', type: 'string', genStrategy: 'prefix', genDirection: 'back', genMaxLevel: 3 },
                { name: '備註', role: 'Quasi-identifier', type: 'string', genStrategy: 'length', genMaxLevel: 4, genParam: 'abc' }
            ],
            kAnonymityHierarchies: [],
            resolveFallbackUiRole: () => 'Non-sensitive'
        }).k_anonymity as Record<string, unknown>;
        expect(config.columns).toEqual({
            地址: { role: 'quasi_identifier', type: 'string', mask_mode: 'suffix', mask_char: '*' },
            備註: { role: 'quasi_identifier', type: 'string', mask_mode: 'length', mask_char: '*' }
        });
        expect(config.qi_generalization_levels).toEqual({ 地址: 3, 備註: 1 });
        expect(config.generalization_hierarchies).toEqual({ 備註: { bin_size: 5 } });
    });

    it('時間區間：當日分鐘數轉 HH:MM', () => {
        const config = buildKAnonymityConfig({
            ...baseSettings,
            processedColumnNames: ['就診時間'],
            kAnonymityFields: [{ name: '就診時間', role: 'Quasi-identifier', type: 'temporal', genStrategy: 'time_range', genMaxLevel: 1,
                customBins: [{ min: null, max: 720, label: '上午' }, { min: 720, max: 1440, label: '下午' }] }],
            kAnonymityHierarchies: [],
            resolveFallbackUiRole: () => 'Non-sensitive'
        }).k_anonymity as Record<string, unknown>;
        expect(config.generalization_hierarchies).toEqual({
            就診時間: { levels: ['hour'], time_periods: [{ min: null, max: '12:00', label: '上午' }, { min: '12:00', max: '00:00', label: '下午' }] }
        });
    });

    it('沒有任何階層時不送空物件', () => {
        const config = buildKAnonymityConfig({
            ...baseSettings, processedColumnNames: ['疾病'], kAnonymityFields: [{ name: '疾病', role: 'Sensitive', type: 'categorical' }],
            kAnonymityHierarchies: [], resolveFallbackUiRole: () => 'Non-sensitive'
        }).k_anonymity as Record<string, unknown>;
        expect(config).not.toHaveProperty('generalization_hierarchies');
        expect(config).not.toHaveProperty('generalization_matrices');
        expect(config).not.toHaveProperty('qi_generalization_levels');
    });

    it('API 表單參數與 config 規則一致', () => {
        expect(buildKAnonymityApiOptions(baseSettings)).toEqual({
            k: 5, l: 2, t: 0.7, suppression_limit_percent: 20, suppression_method: 'row_suppression', limit_exceeded_action: 'allow_with_warning'
        });
        expect(buildKAnonymityApiOptions({ ...baseSettings, enableLDiversity: false, suppressionMethod: 'cell_suppression', cellFillMethod: null })).toEqual({
            k: 5, t: 0.7, suppression_limit_percent: 20, suppression_method: 'cell_suppression', cell_fill: 'star', limit_exceeded_action: 'allow_with_warning'
        });
    });
});

describe('差分隱私 config.json 組裝', () => {
    const dpInput = {
        dpFields: [
            { enabled: true, fieldName: '薪資', fieldType: 'Numeric', epsilon: 0.5, delta: 1e-5, mode: 'epsilon' as const, lowerBound: 20000, upperBound: '200000', outOfBoundsStrategy: 'clip' as const },
            { enabled: true, fieldName: '生日', fieldType: 'Numeric', epsilon: '1', delta: 1e-5, mode: 'epsilon-delta' as const, lowerBound: '1950-01-01', upperBound: '1950-01-31', noiseStep: 2, outOfBoundsStrategy: 'wrap' as const },
            { enabled: true, fieldName: '地區', fieldType: 'Categorical', epsilon: 2 },
            { enabled: true, fieldName: '備註', fieldType: 'Text' },
            { enabled: false, fieldName: '年齡', fieldType: 'Numeric', epsilon: 3 }
        ],
        columnTypes: { 生日: 'date' },
        accumulatedEpsilon: 1.5, accumulatedDelta: 0, targetDelta: null
    };

    it('逐欄預算：ε-DP 模式 delta 強制為 0；邊界、敏感度與溢出策略（clip→clamp）；停用欄位不送', () => {
        const config = buildDifferentialPrivacyConfig(dpInput).differential_privacy as Record<string, Record<string, Record<string, unknown>>>;
        expect(config.column_budgets.薪資).toEqual({
            type: 'continuous', epsilon_budget: 0.5, delta_budget: 0, sensitivity: 180000,
            clipping_bounds: [20000, 200000], minimum_unit: 1, out_of_bounds_strategy: 'clamp'
        });
        expect(config.column_budgets.生日).toMatchObject({
            type: 'datetime', epsilon_budget: 1, delta_budget: 1e-5, sensitivity: 30,
            time_clipping_bounds: ['1950-01-01', '1950-01-31'], noise_unit: 'day', noise_step: 2, time_out_of_bounds_strategy: 'wrap'
        });
        expect(config.column_budgets.地區).toEqual({ type: 'categorical', epsilon_budget: 2 });
        expect(config.column_budgets.備註).toEqual({ type: 'text', epsilon_budget: 1 });
        expect(config.column_budgets).not.toHaveProperty('年齡');
        expect(config).toMatchObject({ enabled: true, accumulated_epsilon: 1.5, accumulated_delta: 0, default_delta: 0.0001 });
    });

    it('表單參數與預算總和', () => {
        expect(buildDifferentialPrivacyApiOptions(dpInput)).toEqual({ accumulated_epsilon: 1.5, accumulated_delta: 0, default_delta: 0.0001 });
        expect(computeDpTotalBudgets(dpInput.dpFields)).toEqual({ totalEpsilonBudget: 4.5, totalDeltaBudget: 2e-5 });
        expect(computeDpTotalBudgets([])).toEqual({ totalEpsilonBudget: 1, totalDeltaBudget: 0 });
    });
});
