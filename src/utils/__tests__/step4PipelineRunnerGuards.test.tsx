// @vitest-environment jsdom
/**
 * ★ 2026-11-02：Step4 管線（features/step4_result/usePipelineRunner.ts）的取消／登出／逾時防護：
 *   取消或登出後不再把結果寫回工作區、逾時與 524 時通知後端停止、補跑時進度畫面不被上一輪的延遲關閉蓋掉、
 *   新一輪開始時清掉上一輪的風險評估結果、沒有資料檔時不會一直顯示運算中。
 *   測試骨架比照 features/step4_result/__tests__/usePipelineRunner.test.tsx。
 */
import { renderHook, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError } from 'axios';

const stableTranslation = vi.hoisted(() => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));
const stableApp = vi.hoisted(() => ({ message: { success: () => {}, error: () => {}, warning: () => {}, info: () => {} } }));
vi.mock('antd', async (importOriginal) => {
    const actual = await importOriginal<typeof import('antd')>();
    return { ...actual, App: Object.assign(() => null, { useApp: () => stableApp }) };
});

const phaseMocks = vi.hoisted(() => ({ runDeidentificationPhase: vi.fn(), runRiskAssessmentPhase: vi.fn(), ensureDatasetProfile: vi.fn(), cancelBackendRun: vi.fn() }));
vi.mock('../../features/step4_result/pipeline/deidentificationPhase', () => ({ runDeidentificationPhase: phaseMocks.runDeidentificationPhase }));
vi.mock('../../features/step4_result/pipeline/riskAssessmentPhase', () => ({ runRiskAssessmentPhase: phaseMocks.runRiskAssessmentPhase }));
vi.mock('../../features/step4_result/pipeline/preprocessPhase', () => ({ runPreprocessPhase: () => Promise.resolve(null) }));
vi.mock('../datasetProfile', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../datasetProfile')>()),
    ensureDatasetProfile: phaseMocks.ensureDatasetProfile
}));
vi.mock('../../api/systemApi', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../api/systemApi')>()),
    cancelBackendRun: phaseMocks.cancelBackendRun
}));

import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { usePipelineRunner } from '../../features/step4_result/usePipelineRunner';
import { clearMemberSession } from '../../api/authApi';
import { clearBackendBusy, isBackendLikelyBusy } from '../backendBusyCooldown';
import { settle, settleUntil, SETTLE_TEST_TIMEOUT_MS } from '../../test/settle';

const hookInput = { actualProcessedColumnsList: ['年齡', '疾病'], getCalculatedRole: () => ({ role: 'Quasi-identifier' }) };

// 等待工具見 src/test/settle.ts：「預期會發生」用 settleUntil（等到條件成立），「預期不再發生」才用 settle（固定安靜期）
const deidentificationCalls = () => phaseMocks.runDeidentificationPhase.mock.calls.length;
const cancelCalls = () => phaseMocks.cancelBackendRun.mock.calls.length;

const dpDeidentificationSuccess = async () => ({
    report: { consumed_epsilon: 1, consumed_delta: 1e-5, accumulated_epsilon: 1, accumulated_delta: 1e-5, message: '', per_column: [] },
    csvBlob: new Blob(['年齡,疾病\n30,感冒\n']), updatedDpAccumulated: { epsilon: 1, delta: 1e-5 }, logMessages: []
});
const capReport = { cap_before: 0.5, cap_after: 0.3, n_original: 1, n_processed: 1, message: '' };
const attackReport = { singling_out_risk: 0.1, linkability_risk: 0.1, inference_risk: 0.1, sample_size: 1, linkability_evaluated: 1, n_repeats: 1, overlap_ratio: 0, processing_config: null, message: '' };

/** 先掛著、由測試決定何時完成的 Promise */
const deferred = <T,>() => {
    let resolveFn: (value: T) => void = () => {};
    const promise = new Promise<T>((resolve) => { resolveFn = resolve; });
    return { promise, resolve: resolveFn };
};

describe('Step4 管線取消／登出／逾時防護（★ 2026-11-02）', { timeout: SETTLE_TEST_TIMEOUT_MS }, () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        clearBackendBusy();
        phaseMocks.runDeidentificationPhase.mockReset().mockImplementation(dpDeidentificationSuccess);
        phaseMocks.runRiskAssessmentPhase.mockReset().mockResolvedValue({ attackReport: null, capReport: null, highCardinalityInfo: [] });
        phaseMocks.ensureDatasetProfile.mockReset().mockResolvedValue({ fileKey: 'k', rowCount: 1, columnNamesList: [], columns: {}, numericValues: {} });
        phaseMocks.cancelBackendRun.mockReset().mockResolvedValue(true);
        useWorkspaceStore.setState({
            dataFile: new File(['年齡,疾病\n30,感冒\n'], 'data.csv', { lastModified: 1 }), fileName: 'data.csv', columns: ['年齡', '疾病'],
            privacyMode: 'differential-privacy', kValue: 3, dpFields: [{ fieldName: '疾病', enabled: true, fieldType: 'Categorical', epsilon: 1 }] as never,
            kAnonymityFields: [], kAnonymityHierarchies: [], columnRoles: {}, columnTypes: {}, riskSubgroupFilters: {},
            dpAccumulatedEpsilon: 0, dpAccumulatedDelta: 0, step4Cache: null, lastRunParamsHash: null, lastAttemptedRunParamsHash: null
        });
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); clearBackendBusy(); });

    it('沒有網路請求的階段（讀取資料統計）按取消：之後的階段不再執行、不寫快取', async () => {
        const profileGate = deferred<unknown>();
        phaseMocks.ensureDatasetProfile.mockImplementation(() => profileGate.promise);
        const { result } = renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => phaseMocks.ensureDatasetProfile.mock.calls.length >= 1);
        expect(phaseMocks.ensureDatasetProfile).toHaveBeenCalledTimes(1);

        await act(async () => { result.current.handleCancelPipeline(); });
        profileGate.resolve({ fileKey: 'k', rowCount: 1, columnNamesList: [], columns: {}, numericValues: {} });
        await settleUntil(() => result.current.isPipelineCanceledStatus);
        await settle();

        expect(phaseMocks.runDeidentificationPhase).not.toHaveBeenCalled();
        expect(result.current.isPipelineCanceledStatus).toBe(true);
        expect(useWorkspaceStore.getState().step4Cache).toBeNull();
    });

    it('運算途中登出（登入世代改變）：DP 累計預算、快取都不寫回工作區', async () => {
        const deidentificationGate = deferred<unknown>();
        phaseMocks.runDeidentificationPhase.mockImplementation(() => deidentificationGate.promise);
        const { result } = renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => deidentificationCalls() >= 1);
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(1);

        clearMemberSession();
        deidentificationGate.resolve(await dpDeidentificationSuccess());
        // 先等這一輪真的收尾（偵測到登入世代改變而中止），再用安靜期確認「之後什麼都沒寫回」
        await settleUntil(() => !result.current.isPipelineCalculatingStatus);
        await settle();

        expect(useWorkspaceStore.getState().dpAccumulatedEpsilon).toBe(0);
        expect(useWorkspaceStore.getState().dpAccumulatedDelta).toBe(0);
        expect(useWorkspaceStore.getState().step4Cache).toBeNull();
        expect(phaseMocks.runRiskAssessmentPhase).not.toHaveBeenCalled();
    });

    it('補跑的一輪剛開始時，上一輪排定的「關閉運算中」不會把進度畫面藏起來', async () => {
        const firstRunGate = deferred<unknown>();
        phaseMocks.runDeidentificationPhase
            .mockImplementationOnce(() => firstRunGate.promise)
            .mockImplementationOnce(() => new Promise(() => {}));
        const { result } = renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => deidentificationCalls() >= 1);
        await act(async () => { useWorkspaceStore.setState({ privacyMode: 'k-anonymity' }); });
        await settle();

        firstRunGate.resolve(await dpDeidentificationSuccess());
        await settleUntil(() => deidentificationCalls() >= 2);
        // 補跑開始後再走完一段假時間，讓「上一輪排定的關閉運算中」有機會觸發（它若觸發就會把進度藏起來）
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(2);
        expect(result.current.isPipelineCalculatingStatus).toBe(true);
    });

    it('新一輪開始時清掉上一輪的 CAP／三攻擊／筆數統計／安全性指標', async () => {
        phaseMocks.runRiskAssessmentPhase.mockImplementationOnce(async (input: { onCapReport: (report: unknown) => void; onAttackReport: (report: unknown) => void }) => {
            input.onCapReport(capReport);
            input.onAttackReport(attackReport);
            return { attackReport, capReport, highCardinalityInfo: [] };
        });
        const { result } = renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => result.current.attackSimulationMetricsData !== null && result.current.datasetRowStatsData !== null);
        await settle();
        expect(result.current.capReportData).toEqual(capReport);
        expect(result.current.attackReportData).toEqual(attackReport);
        expect(result.current.datasetRowStatsData).not.toBeNull();
        expect(result.current.attackSimulationMetricsData).not.toBeNull();
        // 第一輪要先完整結束（「運算中」已關閉＝執行中旗標已清除），否則下面的「重新運算」會被當成重複呼叫而略過。
        // 結果資料一出現，這一輪還要再算檔案指紋、寫稽核紀錄才走到結尾，機器慢（如 CI）時可能尚未完成。
        await settleUntil(() => !result.current.isPipelineCalculatingStatus);
        await settle();

        phaseMocks.runRiskAssessmentPhase.mockRejectedValueOnce(new Error('風險評估失敗'));
        await act(async () => { void result.current.runFullPipeline(true); });
        await settleUntil(() => result.current.pipelineFailedMessage !== null && !result.current.isPipelineCalculatingStatus);
        await settle();
        expect(result.current.pipelineFailedMessage).not.toBeNull();
        expect(result.current.capReportData).toBeNull();
        expect(result.current.attackReportData).toBeNull();
        expect(result.current.datasetRowStatsData).toBeNull();
        expect(result.current.kAnonymityFidelityData).toBeNull();
        expect(result.current.attackSimulationMetricsData).toBeNull();
    });

    it('前端逾時：通知後端停止這一輪；後端收到取消就不標示「後端可能仍在計算」', async () => {
        phaseMocks.runRiskAssessmentPhase.mockRejectedValue(new AxiosError('timeout of 900000ms exceeded', 'ECONNABORTED'));
        const { result } = renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => result.current.pipelineFailedMessage !== null && cancelCalls() >= 1);
        await settle();
        expect(result.current.pipelineFailedMessage).not.toBeNull();
        expect(phaseMocks.cancelBackendRun).toHaveBeenCalledTimes(1);
        expect(typeof phaseMocks.cancelBackendRun.mock.calls[0][0]).toBe('string');
        expect(isBackendLikelyBusy()).toBe(false);
    });

    it('前端逾時且取消請求送不到後端：標示後端可能仍在計算', async () => {
        phaseMocks.cancelBackendRun.mockRejectedValue(new Error('network'));
        phaseMocks.runRiskAssessmentPhase.mockRejectedValue(new AxiosError('timeout of 900000ms exceeded', 'ECONNABORTED'));
        renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => cancelCalls() >= 1 && isBackendLikelyBusy());
        await settle();
        expect(phaseMocks.cancelBackendRun).toHaveBeenCalledTimes(1);
        expect(isBackendLikelyBusy()).toBe(true);
    });

    it('通道逾時（524）：通知後端停止；取消成功時不標示忙碌，失敗才標示', async () => {
        phaseMocks.runRiskAssessmentPhase.mockRejectedValue({ response: { status: 524 } });
        const { unmount } = renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => cancelCalls() >= 1);
        await settle();
        expect(phaseMocks.cancelBackendRun).toHaveBeenCalledTimes(1);
        expect(isBackendLikelyBusy()).toBe(false);
        unmount();

        phaseMocks.cancelBackendRun.mockReset().mockRejectedValue(new Error('network'));
        // ★ F5：同一組參數失敗後重新掛載不會自動重跑，這裡清掉「已嘗試」紀錄以模擬全新的一次執行
        useWorkspaceStore.setState({ step4Cache: null, lastRunParamsHash: null, lastAttemptedRunParamsHash: null });
        const second = renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => cancelCalls() >= 1 && isBackendLikelyBusy());
        await settle();
        expect(phaseMocks.cancelBackendRun).toHaveBeenCalledTimes(1);
        expect(isBackendLikelyBusy()).toBe(true);
        second.unmount();
    });

    it('運算途中離開 Step4（卸載）：通知後端停止這一輪', async () => {
        phaseMocks.runDeidentificationPhase.mockImplementation(() => new Promise(() => {}));
        const { unmount } = renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => deidentificationCalls() >= 1);
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(1);
        unmount();
        expect(phaseMocks.cancelBackendRun).toHaveBeenCalledTimes(1);
    });

    it('DP 去識別化成功但風險評估失敗後，離開再回到 Step4（重新掛載）不自動重跑、不再扣一次 ε（★ 2026-11-02 F5）', async () => {
        phaseMocks.runRiskAssessmentPhase.mockRejectedValue(new Error('三攻擊請求失敗'));
        const first = renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => first.result.current.pipelineFailedMessage !== null && !first.result.current.isPipelineCalculatingStatus);
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(1);
        expect(useWorkspaceStore.getState().step4Cache).toBeNull();
        first.unmount();

        renderHook(() => usePipelineRunner(hookInput));
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(1);
        expect(useWorkspaceStore.getState().dpAccumulatedEpsilon).toBe(1);
    });

    it('換一份資料集後，同一組參數仍會自動執行', async () => {
        phaseMocks.runRiskAssessmentPhase.mockRejectedValue(new Error('三攻擊請求失敗'));
        const first = renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => first.result.current.pipelineFailedMessage !== null && !first.result.current.isPipelineCalculatingStatus);
        await settle();
        first.unmount();
        useWorkspaceStore.getState().clearFileData();
        useWorkspaceStore.setState({
            dataFile: new File(['年齡,疾病\n30,感冒\n'], 'data.csv', { lastModified: 1 }), fileName: 'data.csv', columns: ['年齡', '疾病'],
            privacyMode: 'differential-privacy', dpFields: [{ fieldName: '疾病', enabled: true, fieldType: 'Categorical', epsilon: 1 }] as never
        });
        renderHook(() => usePipelineRunner(hookInput));
        await settleUntil(() => deidentificationCalls() >= 2);
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(2);
    });

    it('沒有原始資料檔：不會一直停在「運算中」', async () => {
        useWorkspaceStore.setState({ dataFile: null });
        const { result } = renderHook(() => usePipelineRunner(hookInput));
        await settle();
        expect(result.current.isPipelineCalculatingStatus).toBe(false);
        expect(phaseMocks.runDeidentificationPhase).not.toHaveBeenCalled();
    });
});
