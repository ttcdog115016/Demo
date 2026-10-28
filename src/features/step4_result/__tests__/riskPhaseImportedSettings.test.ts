/**
 * ★ 2026-10-28：Step4 風險評估階段使用自設定檔匯入的 risk_attacks 設定（欄位角色、連結性分組、實驗參數）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AttackReport, CapReport } from '../../../api/apiService';
import type { DatasetProfile } from '../../../utils/datasetProfile';

const apiMocks = vi.hoisted(() => ({ runRiskKAnonymity: vi.fn(), runRiskDp: vi.fn(), runRiskCap: vi.fn() }));
vi.mock('../../../api/apiService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../api/apiService')>()),
    runRiskKAnonymity: apiMocks.runRiskKAnonymity,
    runRiskDp: apiMocks.runRiskDp,
    runRiskCap: apiMocks.runRiskCap
}));

import { runRiskAssessmentPhase } from '../pipeline/riskAssessmentPhase';
import { RISK_ATTACK_DEFAULT_PARAMS } from '../../../utils/riskConfigImport';

const COLUMNS = ['年齡', '地址', '職業', '婚姻狀況', '疾病', '出生日期'];
const CSV = `${COLUMNS.join(',')}\n40,臺北市大安區,工程師,已婚,感冒,1985-01-01\n41,臺北市中正區,醫師,未婚,糖尿病,1984-02-02\n`;
const profile: DatasetProfile = {
    fileKey: 'k', rowCount: 2, columnNamesList: COLUMNS, numericValues: {},
    columns: Object.fromEntries(COLUMNS.map((name) => [name, { nonEmptyCount: 2, distinctCount: 1, isDistinctCountCapped: false, topValues: [], numericCount: 0, nonNumericDistinctValues: [] }]))
};
const attackReport: AttackReport = { singling_out_risk: 0.1, linkability_risk: 0.05, inference_risk: 0.2, sample_size: 2, linkability_evaluated: 1, n_repeats: 3, overlap_ratio: 0.1, processing_config: null, message: '' };
const capReport: CapReport = { cap_before: 0.5, cap_after: 0.3, n_original: 2, n_processed: 2, message: '' };

const OVERRIDES = {
    年齡: { role: 'quasi_identifier' as const, type: 'numeric' },
    地址: { role: 'quasi_identifier' as const, type: 'categorical' },
    職業: { role: 'quasi_identifier' as const, type: 'categorical' },
    婚姻狀況: { role: 'quasi_identifier' as const, type: 'categorical' },
    疾病: { role: 'sensitive' as const, type: 'categorical' },
};
const LINKABILITY = { A: ['年齡', '婚姻狀況'], B: ['地址', '職業'] };
const PARAMS = { n_iter: 500, ctrl_ratio: 0.2, seed: 42, n_subset: 500, n_repeats: 3, overlap_ratio: 0.1 };

const readSentConfig = async (mockFn: ReturnType<typeof vi.fn>, configArgIndex: number) => JSON.parse(await (mockFn.mock.calls[0][configArgIndex] as File).text());

const baseInput = (privacyMode: string, overrides: Partial<Parameters<typeof runRiskAssessmentPhase>[0]> = {}): Parameters<typeof runRiskAssessmentPhase>[0] => ({
    privacyMode,
    processedColumnNames: COLUMNS,
    // K-匿名角色：年齡、出生日期為間接識別，疾病敏感；職業、婚姻狀況非敏感
    kAnonymityFields: [
        { name: '年齡', role: 'Quasi-identifier', type: 'numeric' },
        { name: '出生日期', role: 'Quasi-identifier', type: 'temporal' },
        { name: '疾病', role: 'Sensitive', type: 'categorical' },
        { name: '職業', role: 'Non-sensitive', type: 'categorical' },
        { name: '婚姻狀況', role: 'Non-sensitive', type: 'categorical' },
        { name: '地址', role: 'Non-sensitive', type: 'categorical' },
    ],
    resolveColumnRole: () => ({ role: 'Non-sensitive' }),
    dpFields: [{ fieldName: '年齡', enabled: true, fieldType: 'Numeric', epsilon: 1, delta: 0, lowerBound: 0, upperBound: 120 }],
    columnTypes: {},
    datasetProfile: profile,
    binWidthOverrides: {},
    forceRunHighCardinality: false,
    cleanedCsvText: CSV,
    safeDataFile: new File([CSV], 'input_dataset.csv'),
    configObject: {
        k_anonymity: { enabled: true, k: 2, columns: { 年齡: { role: 'quasi_identifier', type: 'numeric' }, 出生日期: { role: 'quasi_identifier', type: 'temporal' }, 疾病: { role: 'sensitive', type: 'categorical' } } },
        differential_privacy: { enabled: true, column_budgets: { 年齡: { type: 'continuous', epsilon_budget: 1, clipping_bounds: [0, 120] } } }
    },
    datasetFileName: 'x.csv',
    riskSubgroupFilters: {},
    processedCsvBlob: new Blob([CSV]),
    readProcessedCsvText: async () => CSV,
    requestOptions: {},
    appendLog: () => {},
    onHighCardinalityInfo: () => {},
    onAttackReport: () => {},
    onCapReport: () => {},
    ...overrides
});

describe('Step4 風險評估使用匯入的 risk_attacks 設定', () => {
    beforeEach(() => {
        Object.values(apiMocks).forEach((mockFn) => mockFn.mockReset());
        apiMocks.runRiskKAnonymity.mockResolvedValue({ success: true, report: attackReport });
        apiMocks.runRiskDp.mockResolvedValue({ success: true, report: attackReport });
        apiMocks.runRiskCap.mockResolvedValue({ success: true, report: capReport });
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('K-匿名：三攻擊與 CAP 都依匯入的欄位角色，帶連結性分組與實驗參數；上傳資料保留 K-匿名原本的間接識別', async () => {
        const logs: string[] = [];
        await runRiskAssessmentPhase(baseInput('k-anonymity', { riskColumnOverrides: OVERRIDES, riskLinkability: LINKABILITY, riskAttackParams: PARAMS, appendLog: (text) => logs.push(text) }));
        const riskConfig = await readSentConfig(apiMocks.runRiskKAnonymity, 1);
        expect(riskConfig.risk_attacks.columns).toEqual(OVERRIDES);
        expect(riskConfig.risk_attacks.linkability).toEqual(LINKABILITY);
        expect(riskConfig.risk_attacks).toMatchObject(PARAMS);
        // K-匿名原本的間接識別（出生日期）仍保留在上傳資料與 k_anonymity 區塊
        expect(Object.keys(riskConfig.k_anonymity.columns)).toContain('出生日期');
        const uploadedHeader = (await (apiMocks.runRiskKAnonymity.mock.calls[0][0] as File).text()).split('\n')[0].split(',');
        expect(uploadedHeader).toEqual(expect.arrayContaining(['出生日期', '職業', '婚姻狀況', '地址']));
        const capConfig = await readSentConfig(apiMocks.runRiskCap, 2);
        expect(capConfig.risk_cap.columns).toEqual(OVERRIDES);
        expect(logs.some((text) => text.includes('風險評估欄位依匯入設定'))).toBe(true);
    });

    it('K-匿名：沒有匯入設定時與先前相同（依 K-匿名角色、前端預設參數、不送連結性分組）', async () => {
        await runRiskAssessmentPhase(baseInput('k-anonymity'));
        const riskConfig = await readSentConfig(apiMocks.runRiskKAnonymity, 1);
        expect(riskConfig.risk_attacks.columns).toEqual({
            年齡: { role: 'quasi_identifier', type: 'numeric' },
            出生日期: { role: 'quasi_identifier', type: 'temporal' },
            疾病: { role: 'sensitive', type: 'categorical' },
        });
        expect(riskConfig.risk_attacks).not.toHaveProperty('linkability');
        expect(riskConfig.risk_attacks).toMatchObject(RISK_ATTACK_DEFAULT_PARAMS);
    });

    it('差分隱私：敏感欄位不必是加噪欄位（疾病），依匯入的欄位角色評估', async () => {
        await runRiskAssessmentPhase(baseInput('differential-privacy', { riskColumnOverrides: OVERRIDES, riskLinkability: LINKABILITY, riskAttackParams: PARAMS }));
        const riskConfig = await readSentConfig(apiMocks.runRiskDp, 1);
        expect(riskConfig.risk_attacks.columns).toEqual(OVERRIDES);
        expect(riskConfig.risk_attacks.linkability).toEqual(LINKABILITY);
        expect(riskConfig.risk_attacks.n_repeats).toBe(3);
        expect(riskConfig.differential_privacy.column_budgets).toHaveProperty('年齡');
        expect((await readSentConfig(apiMocks.runRiskCap, 2)).risk_cap.columns).toEqual(OVERRIDES);
    });

    it('匯入的欄位在本次資料中缺敏感欄位時退回原本推導並記錄', async () => {
        const logs: string[] = [];
        await runRiskAssessmentPhase(baseInput('k-anonymity', {
            riskColumnOverrides: { 年齡: OVERRIDES.年齡, 不存在: { role: 'sensitive', type: 'categorical' } },
            appendLog: (text) => logs.push(text)
        }));
        expect((await readSentConfig(apiMocks.runRiskKAnonymity, 1)).risk_attacks.columns).toHaveProperty('出生日期');
        expect(logs.some((text) => text.includes('改依原本設定推導'))).toBe(true);
    });
});
