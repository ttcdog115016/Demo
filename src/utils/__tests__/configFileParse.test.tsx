// @vitest-environment jsdom
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import unifiedConfigText from './fixtures/backend_config_unified_v2.json?raw';
import unifiedYamlText from './fixtures/backend_config_unified_v2.yaml?raw';

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
import { buildBackendConfigDocumentFromWorkspace } from '../pipelineConfig';
import { parseConfigFileText, ConfigFileParseError, CONFIG_FILE_ACCEPT, isYamlConfigFileName } from '../configFileParse';

/**
 * ★ 2026-10-29：Step2「匯入設定檔」支援後端統合版 YAML（04_系統設定檔/config_範例_YAML統合版.yaml）。
 */
const SAMPLE_COLUMNS = ['姓名', '身分證號', '地址', '出生日期', '就診時間', '年齡', '職業', '婚姻狀況', '疾病', '醫療費用', '檢驗值_血糖', '就醫次數', '保險別'];

const resetStore = (privacyMode: 'k-anonymity' | 'differential-privacy') => useWorkspaceStore.setState({
    columns: SAMPLE_COLUMNS, previewData: [], dataFile: null, fileName: '範例資料.csv', preprocessingRules: {}, missingValueRules: {},
    privacyMode, kAnonymityFields: [], kAnonymityHierarchies: [], columnRoles: {}, columnTypes: {}, dpFields: [],
    riskColumnOverrides: null, riskLinkability: null, riskAttackParams: null, riskSubgroupFilters: {}
} as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

const importFile = async (PageComponent: React.ComponentType, fileText: string, fileName: string, expectSuccess = true): Promise<void> => {
    Object.values(messageMock).forEach((mockFn) => mockFn.mockClear());
    const { container } = render(<PageComponent />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.getAttribute('accept')).toBe(CONFIG_FILE_ACCEPT);
    fireEvent.change(fileInput, { target: { files: [new File([fileText], fileName)] } });
    await waitFor(() => expect(expectSuccess ? messageMock.success : messageMock.error).toHaveBeenCalled());
    cleanup();
};

/** 匯入後工作區狀態的摘要：送後端的設定檔＋前處理設定 */
const snapshotWorkspace = () => {
    const state = useWorkspaceStore.getState();
    return {
        config: buildBackendConfigDocumentFromWorkspace(state),
        preprocessingRules: state.preprocessingRules,
        missingValueRules: state.missingValueRules,
        riskColumnOverrides: state.riskColumnOverrides,
        riskLinkability: state.riskLinkability,
        riskAttackParams: state.riskAttackParams,
    };
};

describe('parseConfigFileText', () => {
    it('交付包 YAML 統合版與 JSON 統合版解析結果完全相同', () => {
        expect(parseConfigFileText(unifiedYamlText, 'config_範例_YAML統合版.yaml')).toEqual(JSON.parse(unifiedConfigText));
    });

    it('依副檔名判斷：.yaml／.yml（不分大小寫）用 YAML，其餘用 JSON', () => {
        expect(isYamlConfigFileName('a.YML')).toBe(true);
        expect(isYamlConfigFileName('a.yaml')).toBe(true);
        expect(isYamlConfigFileName('a.json')).toBe(false);
        expect(CONFIG_FILE_ACCEPT).toBe('.json,.yaml,.yml');
        expect(() => parseConfigFileText('k: 5', 'a.json')).toThrow(SyntaxError);
        expect(parseConfigFileText('\uFEFF{"k": 5}', 'a.json')).toEqual({ k: 5 });
    });

    it('照字面寫就得到預期的值：1e-5 是數字、未加引號的 18:00 與日期維持字串、yes 不當布林', () => {
        const parsed = parseConfigFileText([
            'differential_privacy:',
            '  default_delta: 1e-5',
            '  column_budgets:',
            '    就診時間: {type: datetime, epsilon_budget: 1, time_clipping_bounds: [2025-06-16, 2025-06-17 23:59:59]}',
            'k_anonymity:',
            '  generalization_hierarchies:',
            '    就診時間: {levels: [hour, day], time_periods: [{min: 18:00, max: 24:00, label: yes}]}',
        ].join('\n'), 'x.yml');
        expect(parsed.differential_privacy.default_delta).toBe(1e-5);
        expect(parsed.differential_privacy.column_budgets.就診時間.time_clipping_bounds).toEqual(['2025-06-16', '2025-06-17 23:59:59']);
        expect(parsed.k_anonymity.generalization_hierarchies.就診時間.time_periods[0]).toEqual({ min: '18:00', max: '24:00', label: 'yes' });
    });

    it('YAML 語法錯誤回報行號；最上層不是「參數: 值」也擋下', () => {
        expect(() => parseConfigFileText('k_anonymity:\n  k: 5\n   l: 2\n', 'bad.yaml')).toThrow(ConfigFileParseError);
        expect(() => parseConfigFileText('k_anonymity:\n  k: 5\n   l: 2\n', 'bad.yaml')).toThrow(/^YAML 格式錯誤（第 2 行）：Nested mappings are not allowed in compact mappings$/);
        expect(() => parseConfigFileText('a: 1\na: 2\n', 'dup.yaml')).toThrow(ConfigFileParseError);
        expect(() => parseConfigFileText('- 1\n- 2\n', 'list.yaml')).toThrow(/最上層/);
        expect(() => parseConfigFileText('', 'empty.yaml')).toThrow(/最上層/);
    });
});

describe('Step2 匯入 YAML 統合版', () => {
    afterEach(() => cleanup());

    it('K-匿名頁：匯入 YAML 與匯入 JSON 的結果相同（含前處理、風險評估區塊）', async () => {
        resetStore('k-anonymity');
        await importFile(KAnonymityMapping, unifiedConfigText, 'config.json');
        const fromJson = snapshotWorkspace();
        resetStore('k-anonymity');
        await importFile(KAnonymityMapping, unifiedYamlText, 'config_範例_YAML統合版.yaml');
        expect(messageMock.error).not.toHaveBeenCalled();
        expect(snapshotWorkspace()).toEqual(fromJson);
        expect(useWorkspaceStore.getState().kValue).toBe(5);
        expect(Object.keys(useWorkspaceStore.getState().preprocessingRules).length).toBeGreaterThan(0);
    });

    it('差分隱私頁：匯入 YAML 與匯入 JSON 的結果相同', async () => {
        resetStore('differential-privacy');
        await importFile(DifferentialPrivacyMapping, unifiedConfigText, 'config.json');
        const fromJson = snapshotWorkspace();
        resetStore('differential-privacy');
        await importFile(DifferentialPrivacyMapping, unifiedYamlText, 'config.yml');
        expect(messageMock.error).not.toHaveBeenCalled();
        expect(snapshotWorkspace()).toEqual(fromJson);
        expect(useWorkspaceStore.getState().dpFields.map((fieldItem) => fieldItem.fieldName)).toEqual(expect.arrayContaining(['年齡', '醫療費用', '地址', '就診時間']));
    });

    it('YAML 語法錯誤：顯示含行號的錯誤訊息，不改動工作區', async () => {
        resetStore('k-anonymity');
        await importFile(KAnonymityMapping, 'k_anonymity:\n  k: 5\n   l: 2\n', 'bad.yaml', false);
        expect(messageMock.error).toHaveBeenCalledWith(expect.stringContaining('YAML 格式錯誤（第 2 行）'), 8);
        expect(messageMock.success).not.toHaveBeenCalled();
        expect(useWorkspaceStore.getState().preprocessingRules).toEqual({});
        expect(useWorkspaceStore.getState().riskLinkability).toBeNull();
    });
});
