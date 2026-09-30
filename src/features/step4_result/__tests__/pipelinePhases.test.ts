import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AttackReport } from '../../../api/apiService';

const apiMocks = vi.hoisted(() => ({ runKAnonymity: vi.fn(), runDifferentialPrivacy: vi.fn() }));
vi.mock('../../../api/apiService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../api/apiService')>()),
    runKAnonymity: apiMocks.runKAnonymity,
    runDifferentialPrivacy: apiMocks.runDifferentialPrivacy
}));

import { runDeidentificationPhase, extractProcessedCsvBlob } from '../pipeline/deidentificationPhase';
import { computeSimulationMetrics, computeDatasetRowStats, evaluateComplianceValidity, buildPipelineAuditLogEntry } from '../pipeline/pipelineResults';
import { describePipelineError } from '../backendErrorCatalog';

const attackReport = (singling: number, linkability: number, inference: number, sampleSize: number): AttackReport => ({
    singling_out_risk: singling, linkability_risk: linkability, inference_risk: inference,
    sample_size: sampleSize, linkability_evaluated: 1, n_repeats: 1, overlap_ratio: 0, processing_config: null, message: ''
});

const kAnonymitySettings = {
    kValue: 3, lValue: 2, tValue: 0.5, enableLDiversity: false, enableTCloseness: false,
    maxSuppression: 10, suppressionMethod: 'row_suppression', cellFillMethod: 'star' as const, limitExceededAction: 'stop_and_error'
};
const dpConfigInput = {
    dpFields: [{ fieldName: '薪資', enabled: true, fieldType: 'Numeric', epsilon: 0.5, delta: 1e-5 }, { fieldName: '地區', enabled: true, fieldType: 'Categorical', epsilon: 1 }],
    columnTypes: {}, accumulatedEpsilon: 2, accumulatedDelta: 0, targetDelta: 1e-5
};
const phaseInput = (privacyMode: string, configObject: Record<string, unknown> = {}) => ({
    privacyMode, safeDataFile: new File(['a,b\n1,2\n'], 'input_dataset.csv'), configFile: new File(['{}'], 'config.json'),
    configObject, kAnonymitySettings, dpConfigInput, requestOptions: {}
});

describe('去識別化階段', () => {
    beforeEach(() => { apiMocks.runKAnonymity.mockReset(); apiMocks.runDifferentialPrivacy.mockReset(); vi.spyOn(console, 'log').mockImplementation(() => {}); });

    it('K-匿名：送出表單參數，沒有報告時用預設報告，回傳 CSV', async () => {
        const csvBlob = new Blob(['a\n1\n']);
        apiMocks.runKAnonymity.mockResolvedValue({ success: true, blob: csvBlob });
        const result = await runDeidentificationPhase(phaseInput('k-anonymity'));
        expect(apiMocks.runKAnonymity.mock.calls[0][2]).toEqual({ k: 3, suppression_limit_percent: 10, suppression_method: 'row_suppression', limit_exceeded_action: 'stop_and_error' });
        expect(result).toMatchObject({ report: { is_valid: true, message: '成功完成去識別化處理' }, csvBlob, updatedDpAccumulated: null, logMessages: ['✅ K-Anonymity API 處理成功！'] });
    });

    it('K-匿名：API 失敗時丟出後端錯誤', async () => {
        const backendError = { response: { status: 422 } };
        apiMocks.runKAnonymity.mockResolvedValue({ success: false, error: backendError });
        await expect(runDeidentificationPhase(phaseInput('k-anonymity'))).rejects.toBe(backendError);
    });

    it('差分隱私：後端沒回累計值時以「基準＋本次消耗」推算，並寫回 config 供風險評估使用', async () => {
        apiMocks.runDifferentialPrivacy.mockResolvedValue({ success: true, data: 'x\n1\n' });
        const configObject = { differential_privacy: { accumulated_epsilon: 2, accumulated_delta: 0 } };
        const result = await runDeidentificationPhase(phaseInput('differential-privacy', configObject));
        expect(apiMocks.runDifferentialPrivacy.mock.calls[0][2]).toEqual({ accumulated_epsilon: 2, accumulated_delta: 0, default_delta: 1e-5 });
        expect(result!.updatedDpAccumulated).toEqual({ epsilon: 3.5, delta: 1e-5 });
        expect(configObject.differential_privacy).toEqual({ accumulated_epsilon: 3.5, accumulated_delta: 1e-5 });
        expect(result!.logMessages).toEqual(['✅ DP API 處理成功！噪聲已注入。', '📊 消耗隱私預算 (Epsilon): 1.5']);
        expect(await result!.csvBlob!.text()).toBe('x\n1\n');
    });

    it('差分隱私：後端有回累計值時以後端為準', async () => {
        apiMocks.runDifferentialPrivacy.mockResolvedValue({ success: true, report: { consumed_epsilon: 1, consumed_delta: 0, accumulated_epsilon: 9, accumulated_delta: 0.001, message: '', per_column: [] }, csv: 'c' });
        const result = await runDeidentificationPhase(phaseInput('differential-privacy'));
        expect(result!.updatedDpAccumulated).toEqual({ epsilon: 9, delta: 0.001 });
    });

    it('不明的隱私模式不呼叫 API；回傳內容沒有 CSV 時為 null', async () => {
        expect(await runDeidentificationPhase(phaseInput('unknown'))).toBeNull();
        expect(apiMocks.runKAnonymity).not.toHaveBeenCalled();
        expect(extractProcessedCsvBlob({ success: true })).toBeNull();
    });
});

describe('結果計算', () => {
    it('風險分數以 1/樣本數為基準正規化，取三項最大值為綜合風險', () => {
        const metrics = computeSimulationMetrics(attackReport(0.6, 0.3, 0.05, 20));
        expect(metrics.singling).toEqual({ ori: 0.6, ctrl: 0, base: 0.05, risk: (0.6 - 0.05) / 0.95 });
        expect(metrics.inference.risk).toBe(0);
        expect(metrics.overallRiskPercent).toBe('57.9');
    });

    it('樣本數不明時不扣基準；沒有報告時全為 0', () => {
        expect(computeSimulationMetrics(attackReport(0.4, 0.2, 0.1, 0)).singling.risk).toBe(0.4);
        expect(computeSimulationMetrics(null).overallRiskPercent).toBe('0.0');
    });

    it('筆數統計：直接數資料列；讀不到去識別化結果時輸出視同輸入', async () => {
        const originalCsvText = '年齡,疾病\n30,感冒\n40,糖尿病\n50,感冒\n';
        expect(await computeDatasetRowStats(originalCsvText, async () => '年齡,疾病\n30,感冒\n')).toEqual({ input: 3, deleted: 2, output: 1 });
        expect(await computeDatasetRowStats(originalCsvText, null)).toEqual({ input: 3, deleted: 0, output: 3 });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(await computeDatasetRowStats(originalCsvText, async () => { throw new Error('read failed'); })).toEqual({ input: 3, deleted: 0, output: 3 });
    });

    it('合規判斷：K-匿名看 is_valid，差分隱私看 ε 是否超出預算', () => {
        expect(evaluateComplianceValidity('k-anonymity', { is_valid: false } as never, 10)).toBe(false);
        expect(evaluateComplianceValidity('differential-privacy', { consumed_epsilon: 11 } as never, 10)).toBe(false);
        expect(evaluateComplianceValidity('differential-privacy', { consumed_epsilon: 10 } as never, 10)).toBe(true);
        expect(evaluateComplianceValidity('k-anonymity', null, 10)).toBe(true);
    });

    it('稽核紀錄：沒有三攻擊報告時風險記「未評估」，並保存欄位角色與遮蔽策略快照', () => {
        const baseInput = {
            certificateId: 'PAC-1', auditTime: 't', auditTimestamp: 1, fileName: '', privacyMode: 'k-anonymity', operatorName: undefined, operatorRole: undefined,
            kValue: 5, queryCount: 1, simulationMetrics: computeSimulationMetrics(attackReport(0.5, 0.2, 0.1, 0)), datasetRowStats: { input: 10, deleted: 2, output: 8 },
            isComplianceValid: false, columnNames: ['姓名', '年齡'], dpEnabledFieldNames: [],
            resolveColumnRole: (columnName: string) => (columnName === '姓名' ? { role: 'Identifier', maskStrategy: 'hash' } : { role: 'Quasi-identifier' })
        };
        const withoutAttack = buildPipelineAuditLogEntry({ ...baseInput, hasAttackReport: false });
        expect(withoutAttack).toMatchObject({
            fileName: 'dataset.csv', operator: 'Admin.Test', operatorRole: 'admin', parameters: 'K = 5', status: 'failed',
            singlingRisk: '未評估', overallRisk: '未評估', deletedRowCount: 2,
            columnRoleSnapshot: { 姓名: 'Identifier', 年齡: 'Quasi-identifier' }, identifierMaskStrategySnapshot: { 姓名: 'hash' }
        });
        const withAttack = buildPipelineAuditLogEntry({ ...baseInput, hasAttackReport: true, privacyMode: 'differential-privacy', queryCount: 3 });
        expect(withAttack).toMatchObject({ singlingRisk: '50.0%', overallRisk: '50.0%', parameters: '發布次數 M = 3' });
    });
});

describe('錯誤訊息解析', () => {
    it('去識別化 API 回傳 Blob 形式的錯誤內容時先讀成 JSON，組出含錯誤碼與建議的訊息', async () => {
        const errorPayload = { response: { status: 422, data: new Blob([JSON.stringify({ error_code: 'ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED', message: '抑制率超限', recommendations: ['提高層級'] })]) } };
        const { errorMessage, responseData } = await describePipelineError(errorPayload);
        expect(errorMessage).toContain('[ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED · HTTP 422]');
        expect(errorMessage).toContain('：抑制率超限；建議：提高層級');
        expect(responseData).toMatchObject({ error_code: 'ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED' });
    });

    it('FastAPI 參數驗證錯誤、只有 HTTP 狀態碼、一般例外', async () => {
        const validation = await describePipelineError({ response: { status: 422, data: { detail: [{ loc: ['body', 'k'], msg: 'field required' }] } } });
        expect(validation.errorMessage).toBe('參數驗證失敗: [body.k] field required');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const statusOnly = await describePipelineError({ response: { status: 500, data: new Blob(['<html>Internal Server Error</html>']) } });
        expect(statusOnly.errorMessage).toBe('[HTTP 500] 系統內部錯誤，請聯絡系統管理員或稍後再試。');
        const plain = await describePipelineError(new Error('Network Error'));
        expect(plain).toMatchObject({ errorMessage: 'Network Error', displayNode: 'Network Error' });
    });
});
