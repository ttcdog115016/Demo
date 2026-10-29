// @vitest-environment jsdom
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import backendConfigDpText from './fixtures/backend_config_dp.json?raw';
import legacyExportText from './fixtures/legacy_final_privacy_config_dp.json?raw';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const stableTranslation = vi.hoisted(() => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));
const messageMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), destroy: vi.fn() }));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    MockApp.useApp = () => ({ message: messageMock, modal: { confirm: vi.fn() }, notification: { error: vi.fn(), warning: vi.fn() } });
    return { ...actual, App: MockApp };
});

import DifferentialPrivacyMapping from '../../features/step2_mapping/DifferentialPrivacyMapping';
import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';
import { buildBackendConfigDocumentFromWorkspace } from '../pipelineConfig';
import { parseBackendDpColumnBudgets } from '../dpConfigImport';
import { mapOutOfBoundsStrategyFromBackend, mapOutOfBoundsStrategyToBackend } from '../dpFieldHelpers';

const COLUMNS = ['姓名', '身分證號', '年齡', '地區', '生日', '疾病', '薪資', '職業', '婚姻狀況', '就醫次數'];
const backendSample = JSON.parse(backendConfigDpText);

const resetStore = (fileName: string) => useWorkspaceStore.setState({
    columns: COLUMNS, previewData: [], dataFile: null, fileName, dpFields: [], datasetColumnNumericValuesMap: {},
    preprocessingRules: {}, columnTypes: {}, privacyMode: 'differential-privacy', dpAccumulatedEpsilon: 0, dpAccumulatedDelta: 0, targetDelta: 1e-5
} as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

// 透過 Step2「匯入配置」的檔案選擇框實際匯入，等 FileReader 讀完寫入 store
const importThroughStep2 = async (jsonText: string, fileName: string): Promise<DPField[]> => {
    messageMock.success.mockClear();
    const { container } = render(<DifferentialPrivacyMapping />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([jsonText], fileName, { type: 'application/json' })] } });
    await waitFor(() => expect(messageMock.success).toHaveBeenCalled());
    return useWorkspaceStore.getState().dpFields;
};

const strategiesOf = (fields: DPField[]) => Object.fromEntries(fields.filter((field) => field.fieldType === 'Numeric').map((field) => [field.fieldName, field.outOfBoundsStrategy]));

describe('差分隱私設定檔：讀取與匯出的邊界溢出策略', () => {
    afterEach(() => { cleanup(); vi.clearAllMocks(); });

    it('匯入後端 config_dp.json：逐欄溢出策略正確讀入，匯出與原檔一致', async () => {
        resetStore('input_1m.csv');
        const importedFields = await importThroughStep2(backendConfigDpText, 'config_dp.json');
        // clamp→截斷、fold→鏡像、wrap→環繞；生日的 time_out_of_bounds_strategy 為 clamp
        expect(strategiesOf(importedFields)).toEqual({ 年齡: 'clip', 薪資: 'reflect', 就醫次數: 'wrap', 生日: 'clip' });
        expect(importedFields.find((field) => field.fieldName === '生日')).toMatchObject({ isDateTime: true, noiseStep: 7, sensitivity: 365 });

        // 就醫次數沒有 delta_budget → 沿用全域 δ（不送 delta_budget，由 default_delta 補足）
        expect(importedFields.find((field) => field.fieldName === '就醫次數')).toMatchObject({ mode: 'default-delta' });
        // 與後端範例逐字一致；唯一差異：生日下限向外對齊 7 天格點（1930-01-01 → 1929-12-26，見 alignDpDateTimeBoundsToNoiseGrid）
        const expectedExport = structuredClone(backendSample);
        expectedExport.differential_privacy.column_budgets.生日.time_clipping_bounds = ['1929-12-26', '2026-12-31'];
        expect(buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState())).toEqual(expectedExport);
    });

    it('匯出的檔案再匯入後再匯出，內容完全相同', async () => {
        resetStore('input_1m.csv');
        await importThroughStep2(backendConfigDpText, 'config_dp.json');
        const firstExport = buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState());
        cleanup();
        resetStore('input_1m.csv');
        await importThroughStep2(JSON.stringify(firstExport), 'exported.json');
        expect(buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState())).toEqual(firstExport);
    });

    it('匯入舊版匯出檔 final_privacy_config_*.json：讀得到 6 個欄位，溢出策略沿用檔內的全域設定（clip）', async () => {
        resetStore('input_test.csv');
        const importedFields = await importThroughStep2(legacyExportText, 'final_privacy_config_1790817893449.json');
        // 依資料集欄位順序排列
        expect(importedFields.map((field) => field.fieldName)).toEqual(['年齡', '地區', '生日', '薪資', '職業', '就醫次數']);
        expect(importedFields.every((field) => field.enabled)).toBe(true);
        expect(strategiesOf(importedFields)).toEqual({ 年齡: 'clip', 薪資: 'clip', 就醫次數: 'clip', 生日: 'clip' });
        const exportedConfig = buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState()) as typeof backendSample;
        expect(exportedConfig.differential_privacy.column_budgets.生日).toMatchObject({ type: 'datetime', time_clipping_bounds: ['1930-01-01', '2026-12-31'], time_out_of_bounds_strategy: 'clamp' });
        expect(exportedConfig.differential_privacy.column_budgets.薪資).toMatchObject({ type: 'continuous', delta_budget: 1e-5, out_of_bounds_strategy: 'clamp' });
    });
});

describe('dpConfigImport', () => {
    it('名稱不含日期關鍵字的日期欄位依 type 判定，匯出仍為 datetime；名稱含「出生」的數值欄位仍為 continuous', () => {
        const parsedFields = parseBackendDpColumnBudgets({
            入院: { type: 'datetime', epsilon_budget: 1, time_clipping_bounds: ['2020-01-01', '2020-12-31'], time_out_of_bounds_strategy: 'wrap', noise_step: 1 },
            出生體重: { type: 'continuous', epsilon_budget: 1, clipping_bounds: [500, 5000], out_of_bounds_strategy: 'fold' }
        }).map((field, index) => ({ id: String(index), ...field }));
        const exportedConfig = buildBackendConfigDocumentFromWorkspace({
            privacyMode: 'differential-privacy', fileName: 'x.csv', kValue: 5, lValue: 2, tValue: 0.5, enableLDiversity: false, enableTCloseness: false,
            maxSuppression: 5, suppressionMethod: 'row_suppression', cellFillMethod: 'star', limitExceededAction: 'stop_and_error', dpFields: parsedFields
        }) as { differential_privacy: { column_budgets: Record<string, Record<string, unknown>> } };
        expect(exportedConfig.differential_privacy.column_budgets.入院).toMatchObject({ type: 'datetime', time_out_of_bounds_strategy: 'wrap', sensitivity: 365 });
        expect(exportedConfig.differential_privacy.column_budgets.出生體重).toMatchObject({ type: 'continuous', out_of_bounds_strategy: 'fold', sensitivity: 4500 });
    });

    it('溢出策略命名：後端 clamp／fold／wrap 與畫面 clip／reflect／wrap 雙向一致，未填寫為截斷', () => {
        for (const backendName of ['clamp', 'fold', 'wrap'] as const) {
            expect(mapOutOfBoundsStrategyToBackend(mapOutOfBoundsStrategyFromBackend(backendName))).toBe(backendName);
        }
        expect(mapOutOfBoundsStrategyFromBackend('reflect')).toBe('reflect');
        expect(mapOutOfBoundsStrategyFromBackend(' Fold ')).toBe('reflect');
        expect(mapOutOfBoundsStrategyFromBackend(undefined)).toBe('clip');
    });
});
