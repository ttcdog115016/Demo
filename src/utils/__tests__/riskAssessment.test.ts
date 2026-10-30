import { describe, it, expect, vi } from 'vitest';
import type { AttackReport, CapReport } from '../../api/apiService';
import type { DatasetProfile } from '../datasetProfile';
import {
    RISK_ATTACK_DEFAULT_PARAMS, resolveKAnonymityRiskColumns, selectKAnonymitySensitiveCandidates, describeKAnonymityHighCardinalityHandling,
    buildKAnonymityRiskColumnsForCandidate, buildKAnonymityConfigBlockForRisk, selectDifferentialPrivacySensitiveCandidates, resolveDpFieldRiskRole,
    describeDifferentialPrivacyHighCardinalityHandling, buildDifferentialPrivacyRiskColumnsForCandidate, buildDifferentialPrivacyConfigBlockForRisk, isDpFieldSelectableAsRiskSensitive, buildRiskAttackConfigObject,
    buildCapConfigObject, mergeWorstCaseAttackReport, runWorstCaseAttackRounds, runWorstCaseCapRounds,
    hasDpRiskAttackSurface, DP_RISK_NO_ATTACK_SURFACE_TEXT
} from '../riskAssessment';

// 20 筆：疾病 3 類、薪資 20 個不同數值、備註 20 種文字、地區 2 類
const profile: DatasetProfile = {
    fileKey: 'k', rowCount: 20, columnNamesList: ['疾病', '薪資', '備註', '地區'],
    numericValues: { 薪資: Array.from({ length: 20 }, (_, index) => 30000 + index * 5000) },
    columns: {
        疾病: { nonEmptyCount: 20, distinctCount: 3, isDistinctCountCapped: false, topValues: [], numericCount: 0, nonNumericDistinctValues: ['感冒', '糖尿病', '高血壓'] },
        薪資: { nonEmptyCount: 20, distinctCount: 20, isDistinctCountCapped: false, topValues: [], numericCount: 20, nonNumericDistinctValues: [] },
        備註: { nonEmptyCount: 20, distinctCount: 20, isDistinctCountCapped: false, topValues: [], numericCount: 0, nonNumericDistinctValues: [] },
        地區: { nonEmptyCount: 20, distinctCount: 2, isDistinctCountCapped: false, topValues: [], numericCount: 0, nonNumericDistinctValues: ['北', '南'] }
    }
};

const attackReport = (singling: number, linkability: number, inference: number, message = ''): AttackReport => ({
    singling_out_risk: singling, linkability_risk: linkability, inference_risk: inference,
    sample_size: 100, linkability_evaluated: 1, n_repeats: 1, overlap_ratio: 0, processing_config: null, message
});
const capReport = (before: number, after: number, message = ''): CapReport => ({ cap_before: before, cap_after: after, n_original: 20, n_processed: 18, message });

describe('K-匿名候選敏感欄位', () => {
    it('角色解析：去 BOM、只留間接識別／敏感欄位，找不到設定時用畫面角色', () => {
        const { riskColumnsMap, roleResolutionDiagnostics } = resolveKAnonymityRiskColumns({
            processedColumnNames: ['﻿疾病', '姓名', '年齡', '備註'],
            kAnonymityFields: [
                { name: '疾病', role: 'Sensitive', type: 'categorical' },
                { name: '姓名', role: 'Identifier', type: 'string' },
                { name: '年齡', role: 'Quasi-identifier', type: 'numeric' }
            ],
            resolveFallbackUiRole: () => 'Sensitive'
        });
        expect(riskColumnsMap).toEqual({
            疾病: { role: 'sensitive', type: 'categorical' },
            年齡: { role: 'quasi_identifier', type: 'numeric' },
            備註: { role: 'sensitive', type: 'string' }
        });
        expect(roleResolutionDiagnostics.map((item) => item.matchedInFieldsList)).toEqual([true, true, true, false]);
    });

    it('高唯一值：數值欄位自動分級距後保留，文字欄位略過，低唯一值照常', () => {
        const selection = selectKAnonymitySensitiveCandidates({
            candidateColumnNames: ['疾病', '薪資', '備註'], datasetProfile: profile, binWidthOverrides: {}, forceRunHighCardinality: false
        });
        expect(selection.effectiveCandidateColumnNames).toEqual(['疾病', '薪資']);
        expect(selection.binWidthMap).toEqual({ 薪資: 10000 });
        expect(selection.highCardinalityInfo).toEqual([
            { columnName: '薪資', uniqueRatioPercent: 100, handling: 'binned', binWidth: 10000, binCount: 10 },
            { columnName: '備註', uniqueRatioPercent: 100, handling: 'skipped' }
        ]);
    });

    it('使用者覆寫的級距太細 → 分級距後仍過高，略過；勾選強制執行 → 原值保留', () => {
        const tooFine = selectKAnonymitySensitiveCandidates({
            candidateColumnNames: ['薪資'], datasetProfile: profile, binWidthOverrides: { 薪資: 5000 }, forceRunHighCardinality: false
        });
        expect(tooFine.effectiveCandidateColumnNames).toEqual([]);
        expect(tooFine.highCardinalityInfo[0]).toMatchObject({ handling: 'skipped', binWidth: 5000, binCount: 20 });
        const forced = selectKAnonymitySensitiveCandidates({
            candidateColumnNames: ['薪資', '備註'], datasetProfile: profile, binWidthOverrides: {}, forceRunHighCardinality: true
        });
        expect(forced.effectiveCandidateColumnNames).toEqual(['薪資', '備註']);
        expect(forced.binWidthMap).toEqual({});
        expect(forced.highCardinalityInfo.map((item) => item.handling)).toEqual(['forced', 'forced']);
    });

    it('執行紀錄訊息依處理方式分組', () => {
        const messagesList = describeKAnonymityHighCardinalityHandling([
            { columnName: '薪資', uniqueRatioPercent: 100, handling: 'binned', binWidth: 10000, binCount: 10 },
            { columnName: '備註', uniqueRatioPercent: 95.5, handling: 'skipped' }
        ]);
        expect(messagesList).toHaveLength(2);
        expect(messagesList[0]).toContain('每 10,000 為一級距（共 10 級）');
        expect(messagesList[1]).toContain('「備註」(唯一值佔比 95.5%)');
        expect(describeKAnonymityHighCardinalityHandling([])).toEqual([]);
    });

    it('每輪欄位設定與送風險評估的 k_anonymity 區塊：已分級距欄位改為類別型', () => {
        const riskColumnsMap = { 疾病: { role: 'sensitive' as const, type: 'categorical' }, 薪資: { role: 'sensitive' as const, type: 'numeric' }, 年齡: { role: 'quasi_identifier' as const, type: 'numeric' } };
        expect(buildKAnonymityRiskColumnsForCandidate(riskColumnsMap, { 薪資: 10000 }, '薪資')).toEqual({
            疾病: { role: 'quasi_identifier', type: 'categorical' }, 薪資: { role: 'sensitive', type: 'categorical' }, 年齡: { role: 'quasi_identifier', type: 'numeric' }
        });
        const kAnonBlock = { k: 3, columns: { 薪資: { role: 'sensitive', type: 'numeric' } } };
        expect(buildKAnonymityConfigBlockForRisk(kAnonBlock, {})).toBe(kAnonBlock);
        expect(buildKAnonymityConfigBlockForRisk(kAnonBlock, { 薪資: 10000 })).toEqual({ k: 3, columns: { 薪資: { role: 'sensitive', type: 'categorical' } } });
        expect(kAnonBlock.columns.薪資.type).toBe('numeric');
    });
});

describe('差分隱私候選敏感欄位', () => {
    const dpFields = [
        { fieldName: '疾病', enabled: true, fieldType: 'Categorical' },
        { fieldName: '備註', enabled: true, fieldType: 'Categorical' },
        { fieldName: '生日', enabled: true, fieldType: 'Numeric' },
        { fieldName: '地區', enabled: false, fieldType: 'Categorical' }
    ];

    it('只從已啟用的類別型欄位挑，排除高唯一值（強制執行則保留）', () => {
        const selection = selectDifferentialPrivacySensitiveCandidates({ dpFields, datasetProfile: profile, forceRunHighCardinality: false });
        expect(selection.enabledFields.map((field) => field.fieldName)).toEqual(['疾病', '備註', '生日']);
        expect(selection.effectiveCandidateColumnNames).toEqual(['疾病']);
        expect(selection.highCardinalityInfo).toEqual([{ columnName: '備註', uniqueRatioPercent: 100, handling: 'skipped' }]);
        expect(selectDifferentialPrivacySensitiveCandidates({ dpFields, datasetProfile: profile, forceRunHighCardinality: true }).effectiveCandidateColumnNames).toEqual(['疾病', '備註']);
        expect(describeDifferentialPrivacyHighCardinalityHandling(selection.highCardinalityInfo, false)[0]).toContain('已略過');
        expect(describeDifferentialPrivacyHighCardinalityHandling(selection.highCardinalityInfo, true)[0]).toContain('已依設定強制');
    });

    it('沒有已啟用欄位時丟錯；未點選敏感且沒有類別型欄位時略過風險評估（2026-10-30 起不丟錯）', () => {
        expect(() => selectDifferentialPrivacySensitiveCandidates({ dpFields: [], datasetProfile: profile, forceRunHighCardinality: false })).toThrow('至少 1 個已啟用');
        const numericOnly = [dpFields[2], { fieldName: '薪資', enabled: true, fieldType: 'Numeric' }];
        const selection = selectDifferentialPrivacySensitiveCandidates({ dpFields: numericOnly, datasetProfile: profile, forceRunHighCardinality: false });
        expect(selection.effectiveCandidateColumnNames).toEqual([]);
        expect(selection.skippedReason).toContain('類別型');
    });

    it('沒有攻擊面（只啟用 1 個欄位）：點選或未點選敏感都略過風險評估、不丟錯（2026-10-30）', () => {
        const singleUnmarked = [{ fieldName: 'PART_CODE', enabled: true, fieldType: 'Categorical' }];
        const singleMarked = [{ ...singleUnmarked[0], isRiskSensitive: true }];
        [singleUnmarked, singleMarked].forEach((fieldsList) => {
            expect(hasDpRiskAttackSurface(fieldsList)).toBe(false);
            const selection = selectDifferentialPrivacySensitiveCandidates({ dpFields: fieldsList, datasetProfile: profile, forceRunHighCardinality: false });
            expect(selection.effectiveCandidateColumnNames).toEqual([]);
            expect(selection.skippedReason).toBe(DP_RISK_NO_ATTACK_SURFACE_TEXT);
        });
        // 兩個已啟用欄位：未點選時可輪流；點選其中 1 個時另一個為間接識別
        const twoFields = [...singleUnmarked, { fieldName: '地區', enabled: true, fieldType: 'Categorical' }];
        expect(hasDpRiskAttackSurface(twoFields)).toBe(true);
        expect(hasDpRiskAttackSurface([singleMarked[0], twoFields[1]])).toBe(true);
        // 兩個都點選為敏感：沒有間接識別
        expect(hasDpRiskAttackSurface([singleMarked[0], { ...twoFields[1], isRiskSensitive: true }])).toBe(false);
    });

    it('Step2 點選敏感欄位：只評估該欄 1 輪，未啟用 DP 的敏感欄位也能參與，其餘已啟用欄位為間接識別', () => {
        const designatedFields = [
            { fieldName: '疾病', enabled: false, fieldType: 'Categorical', isRiskSensitive: true },
            { fieldName: '備註', enabled: true, fieldType: 'Categorical' },
            { fieldName: '生日', enabled: true, fieldType: 'Numeric' },
            { fieldName: '地區', enabled: false, fieldType: 'Categorical' }
        ];
        const selection = selectDifferentialPrivacySensitiveCandidates({ dpFields: designatedFields, datasetProfile: profile, forceRunHighCardinality: false });
        expect(selection.designatedSensitiveColumnNames).toEqual(['疾病']);
        expect(selection.effectiveCandidateColumnNames).toEqual(['疾病']);
        expect(selection.enabledFields.map((field) => field.fieldName)).toEqual(['疾病', '備註', '生日']);
        expect(resolveDpFieldRiskRole({ enabled: true })).toBe('quasi_identifier');
        expect(resolveDpFieldRiskRole({ enabled: false })).toBe('none');
        expect(resolveDpFieldRiskRole({ enabled: false, isRiskSensitive: true })).toBe('sensitive');
    });

    it('Step2 點選敏感欄位：日期時間型、文字型丟錯；沒有間接識別時略過風險評估', () => {
        const dateTimeSensitive = [{ fieldName: '生日', enabled: true, fieldType: 'Numeric', isRiskSensitive: true }, { fieldName: '地區', enabled: true, fieldType: 'Categorical' }];
        expect(() => selectDifferentialPrivacySensitiveCandidates({ dpFields: dateTimeSensitive, datasetProfile: profile, forceRunHighCardinality: false })).toThrow('日期時間型');
        const textSensitive = [{ fieldName: '備註', enabled: false, fieldType: 'Text', isRiskSensitive: true }, { fieldName: '地區', enabled: true, fieldType: 'Categorical' }];
        expect(() => selectDifferentialPrivacySensitiveCandidates({ dpFields: textSensitive, datasetProfile: profile, forceRunHighCardinality: false })).toThrow('文字型');
        const noQi = [{ fieldName: '疾病', enabled: true, fieldType: 'Categorical', isRiskSensitive: true }];
        expect(selectDifferentialPrivacySensitiveCandidates({ dpFields: noQi, datasetProfile: profile, forceRunHighCardinality: false }).skippedReason).toBe(DP_RISK_NO_ATTACK_SURFACE_TEXT);
        const twoSensitiveNoQi = [...noQi, { fieldName: '地區', enabled: true, fieldType: 'Categorical', isRiskSensitive: true }];
        const twoSensitiveSelection = selectDifferentialPrivacySensitiveCandidates({ dpFields: twoSensitiveNoQi, datasetProfile: profile, forceRunHighCardinality: false });
        expect(twoSensitiveSelection.effectiveCandidateColumnNames).toEqual([]);
        expect(twoSensitiveSelection.skippedReason).toBe(DP_RISK_NO_ATTACK_SURFACE_TEXT);
    });

    it('可點選為敏感欄位：類別型、連續數值型可以；文字型、日期時間型、未選型態不行', () => {
        expect(isDpFieldSelectableAsRiskSensitive({ fieldName: '疾病', fieldType: 'Categorical' })).toBe(true);
        expect(isDpFieldSelectableAsRiskSensitive({ fieldName: '薪資', fieldType: 'Numeric' })).toBe(true);
        expect(isDpFieldSelectableAsRiskSensitive({ fieldName: '生日', fieldType: 'Numeric' })).toBe(false);
        expect(isDpFieldSelectableAsRiskSensitive({ fieldName: '備註', fieldType: 'Text' })).toBe(false);
        expect(isDpFieldSelectableAsRiskSensitive({ fieldName: '某欄', fieldType: 'Unknown' })).toBe(false);
    });

    it('Step2 點選連續數值型敏感欄位：自動分級距（可覆寫寬度），風險評估時改宣告為類別型', () => {
        const salarySensitiveFields = [
            { fieldName: '薪資', enabled: true, fieldType: 'Numeric', isRiskSensitive: true },
            { fieldName: '地區', enabled: true, fieldType: 'Categorical' }
        ];
        const selection = selectDifferentialPrivacySensitiveCandidates({ dpFields: salarySensitiveFields, datasetProfile: profile, forceRunHighCardinality: false });
        expect(selection.effectiveCandidateColumnNames).toEqual(['薪資']);
        expect(selection.binWidthMap).toEqual({ 薪資: 10000 });
        expect(selection.categoricalOverrideColumnNames).toEqual(['薪資']);
        expect(selection.highCardinalityInfo[0]).toMatchObject({ columnName: '薪資', handling: 'binned', binWidth: 10000 });
        expect(describeDifferentialPrivacyHighCardinalityHandling(selection.highCardinalityInfo, false)[0]).toContain('一級距');
        expect(selectDifferentialPrivacySensitiveCandidates({ dpFields: salarySensitiveFields, datasetProfile: profile, forceRunHighCardinality: false, binWidthOverrides: { 薪資: 50000 } }).binWidthMap).toEqual({ 薪資: 50000 });
        expect(buildDifferentialPrivacyRiskColumnsForCandidate({ enabledFields: selection.enabledFields, dpFields: salarySensitiveFields, columnTypes: {}, categoricalOverrideColumnNames: selection.categoricalOverrideColumnNames }, '薪資')).toEqual({
            薪資: { role: 'sensitive', type: 'categorical' }, 地區: { role: 'quasi_identifier', type: 'categorical' }
        });
        const dpBlock = { enabled: true, column_budgets: { 薪資: { type: 'continuous', epsilon_budget: 0.5, delta_budget: 0, clipping_bounds: [0, 200000] }, 地區: { type: 'categorical', epsilon_budget: 0.5 } } };
        expect(buildDifferentialPrivacyConfigBlockForRisk(dpBlock, ['薪資'])).toEqual({ enabled: true, column_budgets: { 薪資: { type: 'categorical', epsilon_budget: 0.5 }, 地區: { type: 'categorical', epsilon_budget: 0.5 } } });
        expect(dpBlock.column_budgets.薪資.type).toBe('continuous');
    });

    it('Step2 點選多個敏感欄位：每輪只以其中 1 個為 sensitive，其他敏感欄位不放進該輪 columns', () => {
        const multiSensitiveFields = [
            { fieldName: '疾病', enabled: false, fieldType: 'Categorical', isRiskSensitive: true },
            { fieldName: '地區', enabled: true, fieldType: 'Categorical', isRiskSensitive: true },
            { fieldName: '生日', enabled: true, fieldType: 'Numeric' }
        ];
        const selection = selectDifferentialPrivacySensitiveCandidates({ dpFields: multiSensitiveFields, datasetProfile: profile, forceRunHighCardinality: false });
        expect(selection.designatedSensitiveColumnNames).toEqual(['疾病', '地區']);
        expect(selection.effectiveCandidateColumnNames).toEqual(['疾病', '地區']);
        const roundInput = { enabledFields: selection.enabledFields, dpFields: multiSensitiveFields, columnTypes: {} };
        expect(buildDifferentialPrivacyRiskColumnsForCandidate(roundInput, '疾病')).toEqual({
            疾病: { role: 'sensitive', type: 'categorical' }, 生日: { role: 'quasi_identifier', type: 'temporal' }
        });
        expect(buildDifferentialPrivacyRiskColumnsForCandidate(roundInput, '地區')).toEqual({
            地區: { role: 'sensitive', type: 'categorical' }, 生日: { role: 'quasi_identifier', type: 'temporal' }
        });
    });

    it('欄位型別：日期時間→temporal、數值→numeric、類別→categorical', () => {
        const enabledFields = dpFields.slice(0, 3);
        expect(buildDifferentialPrivacyRiskColumnsForCandidate({ enabledFields, dpFields, columnTypes: { 生日: 'date' } }, '疾病')).toEqual({
            疾病: { role: 'sensitive', type: 'categorical' }, 備註: { role: 'quasi_identifier', type: 'categorical' }, 生日: { role: 'quasi_identifier', type: 'temporal' }
        });
    });
});

describe('設定檔組裝', () => {
    it('三攻擊與 CAP 設定檔；未設定族群條件時不送 subgroup', () => {
        const columns = { 疾病: { role: 'sensitive' as const, type: 'categorical' } };
        expect(buildRiskAttackConfigObject({ version: 'step4_risk_dp', dataset: 'd', columns, subgroup: undefined, privacyBlock: { differential_privacy: { enabled: true } } })).toEqual({
            version: 'step4_risk_dp', dataset: 'd',
            risk_attacks: { enabled: true, columns, ...RISK_ATTACK_DEFAULT_PARAMS },
            differential_privacy: { enabled: true }
        });
        expect(buildCapConfigObject({ dataset: 'd', columns, subgroup: { 地區: ['北'] } })).toEqual({
            version: 'step4_risk_cap', dataset: 'd', risk_cap: { enabled: true, columns, subgroup: { 地區: ['北'] } }
        });
    });
});

describe('逐輪取最大值', () => {
    it('三攻擊：三項指標各自取最大值，中繼資料與欄位設定取最高那一輪', async () => {
        const reportsByCandidate: Record<string, AttackReport> = {
            疾病: attackReport(0.1, 0.6, 0.2, '疾病輪'),
            地區: attackReport(0.7, 0.3, 0.1, '地區輪'),
            職業: attackReport(0.2, 0.2, 0.5, '職業輪')
        };
        const onRoundStart = vi.fn();
        const result = await runWorstCaseAttackRounds({
            candidateColumnNames: ['疾病', '地區', '職業'],
            buildColumnsForCandidate: (candidate) => ({ [candidate]: { role: 'sensitive', type: 'categorical' } }),
            runRound: async (_columns, candidate) => reportsByCandidate[candidate],
            onRoundStart
        });
        expect(result.worstCaseReport).toMatchObject({ singling_out_risk: 0.7, linkability_risk: 0.6, inference_risk: 0.5, message: '地區輪' });
        expect(result.worstCaseColumns).toEqual({ 地區: { role: 'sensitive', type: 'categorical' } });
        expect(onRoundStart.mock.calls).toEqual([[0, 3], [1, 3], [2, 3]]);
        expect(mergeWorstCaseAttackReport(null, attackReport(0, 0, 0)).isThisRoundNewWorstCase).toBe(true);
    });

    it('三攻擊：沒有候選時不呼叫 API', async () => {
        const runRound = vi.fn();
        expect(await runWorstCaseAttackRounds({ candidateColumnNames: [], buildColumnsForCandidate: () => ({}), runRound })).toEqual({ worstCaseReport: null, worstCaseColumns: {} });
        expect(runRound).not.toHaveBeenCalled();
    });

    it('CAP：部分輪次失敗 → 其餘取最大值並在 message 註明失敗欄位', async () => {
        const onRoundFailed = vi.fn();
        const result = await runWorstCaseCapRounds({
            candidateColumnNames: ['疾病', '地區', '職業'],
            buildColumnsForCandidate: () => ({}),
            runRound: async (_columns, candidate) => (candidate === '地區'
                ? { success: false, error: { response: { status: 500, data: { error_code: 'E1', message: '炸了' } } } }
                : { success: true, report: candidate === '疾病' ? capReport(0.9, 0.2, 'A') : capReport(0.5, 0.4, 'B') }),
            onRoundFailed
        });
        expect(result).toMatchObject({ cap_before: 0.9, cap_after: 0.4 });
        expect(result!.message.startsWith('B 另有 1 個候選敏感欄位的 CAP 請求失敗')).toBe(true);
        expect(result!.message).toContain('「地區」');
        expect(onRoundFailed).toHaveBeenCalledWith(1, '地區', expect.any(String), expect.anything());
    });

    it('CAP：全部失敗 → 回傳 -1 的「無法評估」收據（同一原因只列一次）', async () => {
        const result = await runWorstCaseCapRounds({
            candidateColumnNames: ['疾病', '地區'],
            buildColumnsForCandidate: () => ({}),
            runRound: async () => ({ success: false, error: new Error('Network Error') })
        });
        expect(result).toMatchObject({ cap_before: -1, cap_after: -1 });
        expect(result!.message.match(/Network Error/g)).toHaveLength(1);
    });

    it('CAP：使用者取消時整個中止', async () => {
        const canceledError = Object.assign(new Error('canceled'), { name: 'CanceledError', code: 'ERR_CANCELED', __CANCEL__: true });
        const runRound = vi.fn(async () => ({ success: false, error: canceledError }));
        await expect(runWorstCaseCapRounds({ candidateColumnNames: ['疾病', '地區'], buildColumnsForCandidate: () => ({}), runRound })).rejects.toBe(canceledError);
        expect(runRound).toHaveBeenCalledTimes(1);
    });
});
