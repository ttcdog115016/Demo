// @vitest-environment jsdom
import React from 'react';
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react';
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
vi.mock('echarts-for-react', () => ({ default: () => null }));
const messageMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), destroy: vi.fn() }));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    MockApp.useApp = () => ({ message: messageMock, modal: { confirm: vi.fn() }, notification: { error: vi.fn(), warning: vi.fn() } });
    return { ...actual, App: MockApp };
});

import KAnonymityMapping, { SHOW_LEVEL_RANGE_TRIAL } from '../../features/step2_mapping/KAnonymityMapping';
import KAnonymityRules from '../../features/step3_rules/KAnonymityRules';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { buildBackendConfigDocumentFromWorkspace } from '../pipelineConfig';
import { resolveImportedLtSettings, normalizeImportedQiLevel, buildQiLevelValue, extractImportedCellFillValues } from '../kAnonymityConfigImport';

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

describe('qi_generalization_levels 層級範圍 [最小, 最大]', () => {
    afterEach(() => cleanup());

    it('config_kanon.json 的職業 [1, 3]：實際輸出層級 1（職類）、上限 3 保留，送出設定檔仍為 [1, 3]', async () => {
        resetStore();
        messageMock.success.mockClear();
        const { container } = render(<KAnonymityMapping />);
        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(fileInput, { target: { files: [new File([backendConfigKanonText], 'config_kanon.json', { type: 'application/json' })] } });
        await waitFor(() => expect(messageMock.success).toHaveBeenCalled());
        await waitFor(() => expect(useWorkspaceStore.getState().kAnonymityFields.length).toBeGreaterThan(0));

        const fieldsByName = Object.fromEntries((useWorkspaceStore.getState().kAnonymityFields as { name: string }[]).map((field) => [field.name, field]));
        expect(fieldsByName.職業).toMatchObject({ genMaxLevel: 1, genLevelRangeUpper: 3 });
        expect(fieldsByName.地區).toMatchObject({ genMaxLevel: 2 });
        expect(fieldsByName.地區).not.toHaveProperty('genLevelRangeUpper');
        // 「評估至／試算層級」提示依 SHOW_LEVEL_RANGE_TRIAL 開關顯示（2026-10-02 起隱藏）；
        //   隱藏時確認不會出現，開關改回 true 時改為確認有顯示。
        if (SHOW_LEVEL_RANGE_TRIAL) {
            expect(container.textContent).toContain('依層級 1 處理；另試算層級 3');
        } else {
            expect(container.textContent).not.toContain('另試算層級');
        }

        const exportedConfig = buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState()) as { k_anonymity: Record<string, Record<string, unknown>> };
        expect(exportedConfig.k_anonymity.qi_generalization_levels).toEqual({ 地區: 2, 職業: [1, 3], 生日: 5 });
    });

    it('正規化與組回：陣列取最小為實際層級、最大為上限；上下限相同或無上限時為單一整數', () => {
        expect(normalizeImportedQiLevel([1, 3])).toEqual({ level: 1, rangeUpper: 3 });
        expect(normalizeImportedQiLevel([3, 1])).toEqual({ level: 1, rangeUpper: 3 });
        expect(normalizeImportedQiLevel([2, 2])).toEqual({ level: 2 });
        expect(normalizeImportedQiLevel(2)).toEqual({ level: 2 });
        expect(normalizeImportedQiLevel('x')).toEqual({});
        expect(buildQiLevelValue(1, 3)).toEqual([1, 3]);
        expect(buildQiLevelValue(3, 3)).toBe(3);
        expect(buildQiLevelValue(2, 0)).toBe(2);
        expect(buildQiLevelValue(2, undefined)).toBe(2);
    });
});

describe('值抑制逐欄填值 cell_fill_value', () => {
    afterEach(() => cleanup());

    const cellSuppressionConfig = () => {
        const config = JSON.parse(backendConfigKanonText);
        config.k_anonymity.suppression_method = 'cell_suppression';
        config.k_anonymity.cell_fill = 'missing';
        config.k_anonymity.columns.地區.cell_fill_value = '臺灣';
        return config;
    };
    const exportedKanonBlock = () => (buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState()) as { k_anonymity: { columns: Record<string, Record<string, unknown>>; cell_fill?: string } }).k_anonymity;

    it('匯入含 cell_fill_value 的設定檔：讀入逐欄填值，送出設定檔照原樣帶回', async () => {
        resetStore();
        await importThroughStep2(JSON.stringify(cellSuppressionConfig()));
        await waitFor(() => expect(useWorkspaceStore.getState().kAnonymityFields.length).toBeGreaterThan(0));
        expect(useWorkspaceStore.getState()).toMatchObject({ suppressionMethod: 'cell_suppression', cellFillMethod: 'missing', cellFillValuesByColumn: { 地區: '臺灣' } });
        const kanonBlock = exportedKanonBlock();
        expect(kanonBlock.cell_fill).toBe('missing');
        expect(kanonBlock.columns.地區).toMatchObject({ role: 'quasi_identifier', cell_fill_value: '臺灣' });
        expect(kanonBlock.columns.職業).not.toHaveProperty('cell_fill_value');
    });

    it('改成列抑制時不送 cell_fill_value；非間接識別碼欄位也不送', async () => {
        resetStore();
        await importThroughStep2(JSON.stringify(cellSuppressionConfig()));
        await waitFor(() => expect(useWorkspaceStore.getState().kAnonymityFields.length).toBeGreaterThan(0));
        useWorkspaceStore.setState({ cellFillValuesByColumn: { 地區: '臺灣', 疾病: 'x' } });
        expect(exportedKanonBlock().columns.疾病).not.toHaveProperty('cell_fill_value');
        useWorkspaceStore.setState({ suppressionMethod: 'row_suppression' });
        expect(exportedKanonBlock().columns.地區).not.toHaveProperty('cell_fill_value');
    });

    it('Step3 畫面：值抑制時列出間接識別碼欄位，輸入填值後寫入 store、清空即移除', () => {
        useWorkspaceStore.setState({
            columns: ['地區', '職業', '疾病'], columnRoles: { 地區: 'Quasi-identifier', 職業: 'Quasi-identifier', 疾病: 'Sensitive' },
            suppressionMethod: 'cell_suppression', cellFillMethod: 'star', cellFillValuesByColumn: {}, kAnonymityFields: []
        } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        render(<KAnonymityRules />);
        const panelText = screen.getByTestId('cell-fill-values-by-column').textContent;
        expect(panelText).toContain('地區');
        expect(panelText).toContain('職業');
        expect(panelText).not.toContain('疾病');
        fireEvent.change(screen.getByLabelText('地區 cell_fill_value'), { target: { value: '臺灣' } });
        expect(useWorkspaceStore.getState().cellFillValuesByColumn).toEqual({ 地區: '臺灣' });
        fireEvent.change(screen.getByLabelText('地區 cell_fill_value'), { target: { value: '' } });
        expect(useWorkspaceStore.getState().cellFillValuesByColumn).toEqual({});
    });

    it('列抑制時不顯示逐欄填值', () => {
        useWorkspaceStore.setState({ columns: ['地區'], columnRoles: { 地區: 'Quasi-identifier' }, suppressionMethod: 'row_suppression' } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        render(<KAnonymityRules />);
        expect(screen.queryByTestId('cell-fill-values-by-column')).toBeNull();
    });

    it('extractImportedCellFillValues：只收非空值、去除欄名 BOM', () => {
        expect(extractImportedCellFillValues({ '\uFEFF地區': { cell_fill_value: ' 臺灣 ' }, 職業: { cell_fill_value: '' }, 年齡: { cell_fill_value: 0 }, 姓名: {} })).toEqual({ 地區: '臺灣', 年齡: '0' });
        expect(extractImportedCellFillValues(undefined)).toEqual({});
    });
});

describe('匯入設定檔後再「套用系統推薦設定」：Step3 還原為系統預設（2026-10-08）', () => {
    afterEach(() => cleanup());

    it('K、l／t、抑制設定回到預設；Step3 顯示「標準」且進階區塊收合；下載設定檔不含 l／t', async () => {
        resetStore();
        await importThroughStep2(backendConfigKanonText);
        expect(useWorkspaceStore.getState()).toMatchObject({ kValue: 5, enableLDiversity: true, enableTCloseness: true, maxSuppression: 20, limitExceededAction: 'allow_with_warning' });

        render(<KAnonymityMapping />);
        fireEvent.click(screen.getByText('step2.btn_apply_recommend'));
        cleanup();
        expect(useWorkspaceStore.getState()).toMatchObject({
            kValue: 3, lValue: 2, tValue: 0.15, enableLDiversity: false, enableTCloseness: false,
            maxSuppression: 5, suppressionMethod: 'row_suppression', limitExceededAction: 'stop_and_error', cellFillValuesByColumn: {}
        });

        const { getByTestId, container } = render(<KAnonymityRules />);
        expect(getByTestId('kanon-preset-standard').getAttribute('aria-checked')).toBe('true');
        expect(container.querySelector('[data-testid="kanon-plain-advanced"] [role="button"]')?.getAttribute('aria-expanded')).toBe('false');

        const exportedConfig = buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState()) as { k_anonymity: Record<string, unknown> };
        expect(exportedConfig.k_anonymity).toMatchObject({ k: 3, suppression_limit_percent: 5, limit_exceeded_action: 'stop_and_error', suppression_method: 'row_suppression' });
        expect(exportedConfig.k_anonymity).not.toHaveProperty('l');
        expect(exportedConfig.k_anonymity).not.toHaveProperty('t');

        // 層級一律重設為系統預設（不沿用匯入的職業 [1, 3]）：字串前後綴＝4，與直接套用推薦相同
        const fieldsByName = Object.fromEntries((useWorkspaceStore.getState().kAnonymityFields as { name: string }[]).map((field) => [field.name, field]));
        expect(fieldsByName.職業).toMatchObject({ genStrategy: 'prefix', genMaxLevel: 4, genDirection: 'front' });
        expect(fieldsByName.職業).not.toHaveProperty('genLevelRangeUpper');
        expect(exportedConfig.k_anonymity.qi_generalization_levels).toEqual({ 地區: 4, 職業: 4 });
    });
});
