// @vitest-environment jsdom
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import backendConfigKanonText from './fixtures/backend_config_kanon.json?raw';

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
const messageMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), destroy: vi.fn() }));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    MockApp.useApp = () => ({ message: messageMock, modal: { confirm: vi.fn() }, notification: { error: vi.fn(), warning: vi.fn() } });
    return { ...actual, App: MockApp };
});

import KAnonymityMapping from '../../features/step2_mapping/KAnonymityMapping';
import KAnonymityRules from '../../features/step3_rules/KAnonymityRules';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { buildBackendConfigDocumentFromWorkspace } from '../pipelineConfig';
import { resolveImportedLtSettings } from '../kAnonymityConfigImport';

const COLUMNS = ['姓名', '身分證號', '生日', '年齡', '薪資', '就醫次數', '地區', '職業', '疾病', '婚姻狀況'];

const resetStore = () => useWorkspaceStore.setState({
    columns: COLUMNS, previewData: [], dataFile: null, fileName: 'input_1m.csv', preprocessingRules: {},
    privacyMode: 'k-anonymity', enableLDiversity: false, enableTCloseness: false, lValue: 3, tValue: 0.2,
    kAnonymityFields: [], kAnonymityHierarchies: [], columnRoles: {}, columnTypes: {}
} as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

const importThroughStep2 = async (jsonText: string): Promise<void> => {
    messageMock.success.mockClear();
    const { container } = render(<KAnonymityMapping />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([jsonText], 'config_kanon.json', { type: 'application/json' })] } });
    await waitFor(() => expect(messageMock.success).toHaveBeenCalled());
    cleanup();
};

describe('K-匿名匯入設定檔：有 l／t 時直接開啟 Step3 對應檢測', () => {
    afterEach(() => cleanup());

    it('匯入 config_kanon.json（l=2、t=0.7）後 Step3 兩個開關開啟，送出的設定檔帶 l／t', async () => {
        resetStore();
        await importThroughStep2(backendConfigKanonText);
        expect(useWorkspaceStore.getState()).toMatchObject({ enableLDiversity: true, enableTCloseness: true, lValue: 2, tValue: 0.7, kValue: 5 });

        const { container } = render(<KAnonymityRules />);
        const switchStates = Array.from(container.querySelectorAll('button[role="switch"]')).map((switchElement) => switchElement.getAttribute('aria-checked'));
        expect(switchStates.slice(0, 2)).toEqual(['true', 'true']);

        const exportedConfig = buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState()) as { k_anonymity: Record<string, unknown> };
        expect(exportedConfig.k_anonymity).toMatchObject({ k: 5, l: 2, t: 0.7 });
    });

    it('設定檔沒有 l／t 時關閉對應檢測（與本工具匯出時「未啟用即不寫入」一致）', async () => {
        resetStore();
        useWorkspaceStore.setState({ enableLDiversity: true, enableTCloseness: true });
        const withoutLt = JSON.parse(backendConfigKanonText);
        delete withoutLt.k_anonymity.l;
        delete withoutLt.k_anonymity.t;
        await importThroughStep2(JSON.stringify(withoutLt));
        expect(useWorkspaceStore.getState()).toMatchObject({ enableLDiversity: false, enableTCloseness: false, lValue: 3, tValue: 0.2 });
        const exportedConfig = buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState()) as { k_anonymity: Record<string, unknown> };
        expect(exportedConfig.k_anonymity).not.toHaveProperty('l');
        expect(exportedConfig.k_anonymity).not.toHaveProperty('t');
    });

    it('只有 l：只開 l-多樣性', () => {
        expect(resolveImportedLtSettings({ k: 5, l: 3 }, true)).toEqual({ lValue: 3, enableLDiversity: true, enableTCloseness: false });
    });

    it('本工具舊版匯出格式（l_diversity_value／t_closeness_threshold）只帶入數值、不變更開關', () => {
        expect(resolveImportedLtSettings({ enabled: true, k_anonymity_value: 5, l_diversity_value: 4, t_closeness_threshold: 0.3 }, false))
            .toEqual({ lValue: 4, tValue: 0.3 });
    });
});
