// @vitest-environment jsdom
import { renderHook, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 穩定的 i18n 與 antd App（真實環境中兩者在重新渲染之間參考值不變）
const stableTranslation = vi.hoisted(() => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));
const stableApp = vi.hoisted(() => ({ message: { success: () => {}, error: () => {}, warning: () => {}, info: () => {} } }));
vi.mock('antd', async (importOriginal) => {
    const actual = await importOriginal<typeof import('antd')>();
    return { ...actual, App: Object.assign(() => null, { useApp: () => stableApp }) };
});

const phaseMocks = vi.hoisted(() => ({ runDeidentificationPhase: vi.fn(), runRiskAssessmentPhase: vi.fn(), ensureDatasetProfile: vi.fn() }));
vi.mock('../pipeline/deidentificationPhase', () => ({ runDeidentificationPhase: phaseMocks.runDeidentificationPhase }));
vi.mock('../pipeline/riskAssessmentPhase', () => ({ runRiskAssessmentPhase: phaseMocks.runRiskAssessmentPhase }));
// ★ 2026-10-27：資料預先處理階段（/api/v1/preprocess）；本測試未設定清洗步驟，固定略過
vi.mock('../pipeline/preprocessPhase', () => ({ runPreprocessPhase: () => Promise.resolve(null) }));
vi.mock('../../../utils/datasetProfile', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../utils/datasetProfile')>()),
    ensureDatasetProfile: phaseMocks.ensureDatasetProfile
}));

import { useWorkspaceStore } from '../../../store/useWorkspaceStore';
import { usePipelineRunner } from '../usePipelineRunner';

const hookInput = { actualProcessedColumnsList: ['年齡', '疾病'], getCalculatedRole: () => ({ role: 'Quasi-identifier' }) };

// 推進假時鐘並讓檔案讀取等非計時器的非同步工作完成
const settle = async () => {
    for (let index = 0; index < 60; index++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });
        await new Promise((resolve) => setImmediate(resolve));
    }
};

let accumulatedDeltaValue = 0;
const dpDeidentificationSuccess = async () => {
    // 模擬後端沒回傳 accumulated_delta：累計值每輪都不同
    accumulatedDeltaValue += 1e-5;
    return { report: { consumed_epsilon: 1, consumed_delta: 1e-5, message: '', per_column: [] }, csvBlob: new Blob(['年齡,疾病\n30,感冒\n']), updatedDpAccumulated: { epsilon: 1, delta: accumulatedDeltaValue }, logMessages: [] };
};

describe('usePipelineRunner 自動執行時機', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        accumulatedDeltaValue = 0;
        phaseMocks.runDeidentificationPhase.mockReset().mockImplementation(dpDeidentificationSuccess);
        phaseMocks.runRiskAssessmentPhase.mockReset().mockResolvedValue({ attackReport: null, capReport: null, highCardinalityInfo: [] });
        phaseMocks.ensureDatasetProfile.mockReset().mockResolvedValue({ fileKey: 'k', rowCount: 1, columnNamesList: [], columns: {}, numericValues: {} });
        useWorkspaceStore.setState({
            dataFile: new File(['年齡,疾病\n30,感冒\n'], 'data.csv', { lastModified: 1 }), fileName: 'data.csv', columns: ['年齡', '疾病'],
            privacyMode: 'differential-privacy', kValue: 3, dpFields: [{ fieldName: '疾病', enabled: true, fieldType: 'Categorical', epsilon: 1 }] as never,
            kAnonymityFields: [], kAnonymityHierarchies: [], columnRoles: {}, columnTypes: {}, riskSubgroupFilters: {},
            dpAccumulatedEpsilon: 0, dpAccumulatedDelta: 0, step4Cache: null, lastRunParamsHash: null
        });
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

    it('DP 去識別化成功但風險評估失敗時只執行一次，不因寫回的累計值而反覆重跑', async () => {
        phaseMocks.runRiskAssessmentPhase.mockRejectedValue(new Error('風險評估的敏感欄位僅能從已啟用的「類別型」欄位中挑選'));
        const { result } = renderHook(() => usePipelineRunner(hookInput));
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(1);
        expect(useWorkspaceStore.getState().dpAccumulatedDelta).toBe(1e-5);
        expect(result.current.pipelineFailedMessage).not.toBeNull();
        expect(result.current.isPipelineCalculatingStatus).toBe(false);
    });

    it('成功後寫入快取、不再執行；使用者調整參數後自動重新執行', async () => {
        renderHook(() => usePipelineRunner(hookInput));
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(1);
        expect(useWorkspaceStore.getState().step4Cache).not.toBeNull();

        await act(async () => { useWorkspaceStore.setState({ targetDelta: 1e-6 }); });
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(2);
    });

    it('執行中調整參數：這一輪結束後以新參數補跑一次', async () => {
        let releaseFirstRun: () => void = () => {};
        phaseMocks.runDeidentificationPhase.mockImplementationOnce(() => new Promise((resolve) => { releaseFirstRun = () => resolve(dpDeidentificationSuccess()); }));
        renderHook(() => usePipelineRunner(hookInput));
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(1);

        await act(async () => { useWorkspaceStore.setState({ privacyMode: 'k-anonymity' }); });
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(1);

        releaseFirstRun();
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(2);
        expect(phaseMocks.runDeidentificationPhase.mock.calls[1][0].privacyMode).toBe('k-anonymity');
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(2);
    });

    it('失敗後按「重新運算」仍會執行', async () => {
        phaseMocks.runRiskAssessmentPhase.mockRejectedValue(new Error('fail'));
        const { result } = renderHook(() => usePipelineRunner(hookInput));
        await settle();
        await act(async () => { void result.current.runFullPipeline(true); });
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(2);
    });

    it('換上傳檔案（欄位設定相同）時快取失效並重新執行', async () => {
        renderHook(() => usePipelineRunner(hookInput));
        await settle();
        await act(async () => { useWorkspaceStore.setState({ dataFile: new File(['年齡,疾病\n40,糖尿病\n'], 'data.csv', { lastModified: 2 }) }); });
        await settle();
        expect(phaseMocks.runDeidentificationPhase).toHaveBeenCalledTimes(2);
    });
});
