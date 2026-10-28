// @vitest-environment jsdom
/**
 * Step2「匯入設定檔」讀後端 preprocess 區塊（2026-10-28）：期末交付包的單一入口 config_preprocess.json 與統合版設定檔，
 * K-匿名、差分隱私兩頁都能匯入；純前處理設定檔不可清空欄位設定。
 */
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import unifiedConfigText from './fixtures/backend_config_unified_v2.json?raw';
import preprocessOnlyConfigText from './fixtures/backend_config_preprocess_v2.json?raw';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const stableTranslation = vi.hoisted(() => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key))
}));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));
vi.mock('echarts-for-react', () => ({ default: () => null }));
const messageMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), destroy: vi.fn() }));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    MockApp.useApp = () => ({ message: messageMock, modal: { confirm: vi.fn() }, notification: { error: vi.fn(), warning: vi.fn() } });
    return { ...actual, App: MockApp };
});

import KAnonymityMapping from '../../features/step2_mapping/KAnonymityMapping';
import DifferentialPrivacyMapping from '../../features/step2_mapping/DifferentialPrivacyMapping';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

// 期末交付包 04_系統設定檔/範例資料.csv 的表頭
const SAMPLE_COLUMNS = ['姓名', '身分證號', '地址', '出生日期', '就診時間', '年齡', '職業', '婚姻狀況', '疾病', '醫療費用', '檢驗值_血糖', '就醫次數', '保險別'];

const resetStore = (privacyMode: 'k-anonymity' | 'differential-privacy') => useWorkspaceStore.setState({
    columns: SAMPLE_COLUMNS, previewData: [], dataFile: null, fileName: '範例資料.csv', preprocessingRules: {}, missingValueRules: {},
    privacyMode, kAnonymityFields: [], kAnonymityHierarchies: [], columnRoles: {}, columnTypes: {}, dpFields: []
} as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

const importFile = async (PageComponent: React.ComponentType, jsonText: string, waitFor_: 'success' | 'any' = 'success'): Promise<void> => {
    Object.values(messageMock).forEach((mockFn) => mockFn.mockClear());
    const { container } = render(<PageComponent />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([jsonText], 'config.json', { type: 'application/json' })] } });
    await waitFor(() => expect(waitFor_ === 'success' ? messageMock.success : messageMock.info).toHaveBeenCalled());
    cleanup();
};

const EXPECTED_PREPROCESS_COLUMNS = ['姓名', '身分證號', '地址', '出生日期', '醫療費用', '檢驗值_血糖'];

describe('K-匿名頁匯入後端 preprocess 區塊', () => {
    afterEach(() => cleanup());

    it('統合版：K-匿名參數與資料預先處理一起匯入', async () => {
        resetStore('k-anonymity');
        await importFile(KAnonymityMapping, unifiedConfigText);
        const state = useWorkspaceStore.getState();
        expect(state.kValue).toBe(5);
        expect(state.columnRoles['疾病']).toBe('Sensitive');
        expect(Object.keys(state.preprocessingRules)).toEqual(EXPECTED_PREPROCESS_COLUMNS);
        expect(state.missingValueRules).toEqual({ 職業: { strategy: 'constant', constantValue: '未填' }, 保險別: { strategy: 'drop' } });
        expect(messageMock.info).toHaveBeenCalledWith('已匯入資料預先處理設定（8 個欄位）');
        expect(messageMock.error).not.toHaveBeenCalled();
    });

    it('純前處理設定檔：只更新清洗設定，先前匯入的欄位設定保持不變', async () => {
        resetStore('k-anonymity');
        await importFile(KAnonymityMapping, unifiedConfigText);
        const rolesBefore = { ...useWorkspaceStore.getState().columnRoles };
        useWorkspaceStore.setState({ preprocessingRules: {}, missingValueRules: {} });

        await importFile(KAnonymityMapping, preprocessOnlyConfigText);
        const state = useWorkspaceStore.getState();
        expect(state.columnRoles).toEqual(rolesBefore);
        expect(Object.keys(state.preprocessingRules)).toEqual(EXPECTED_PREPROCESS_COLUMNS);
        expect(messageMock.success).toHaveBeenCalledWith('已匯入資料預先處理設定（8 個欄位）');
        expect(messageMock.error).not.toHaveBeenCalled();
    });

    it('後端 K-匿名設定檔（不含前處理）不會清掉畫面上的清洗設定', async () => {
        resetStore('k-anonymity');
        const keptRules = { 姓名: [{ action: 'trim', params: { mode: 'edges' } }] };
        useWorkspaceStore.setState({ preprocessingRules: keptRules });
        const kOnly = JSON.parse(unifiedConfigText);
        delete kOnly.preprocess;
        await importFile(KAnonymityMapping, JSON.stringify(kOnly));
        expect(useWorkspaceStore.getState().preprocessingRules).toEqual(keptRules);
    });
});

describe('差分隱私頁匯入後端 preprocess 區塊', () => {
    afterEach(() => cleanup());

    it('統合版：DP 欄位預算與資料預先處理一起匯入', async () => {
        resetStore('differential-privacy');
        await importFile(DifferentialPrivacyMapping, unifiedConfigText);
        const state = useWorkspaceStore.getState();
        expect(state.dpFields.map((fieldItem) => fieldItem.fieldName)).toEqual(expect.arrayContaining(['年齡', '醫療費用', '地址', '就診時間']));
        expect(Object.keys(state.preprocessingRules)).toEqual(EXPECTED_PREPROCESS_COLUMNS);
        expect(messageMock.error).not.toHaveBeenCalled();
    });

    it('純前處理設定檔：不再顯示「JSON 格式不符合規範」', async () => {
        resetStore('differential-privacy');
        await importFile(DifferentialPrivacyMapping, preprocessOnlyConfigText);
        expect(messageMock.success).toHaveBeenCalledWith('已匯入資料預先處理設定（8 個欄位）');
        expect(messageMock.error).not.toHaveBeenCalled();
        expect(useWorkspaceStore.getState().missingValueRules['保險別']).toEqual({ strategy: 'drop' });
    });
});
