// @vitest-environment jsdom
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import backendConfigKanonText from './fixtures/backend_config_kanon.json?raw';
// 本工具先前匯出的檔案：levels 為六級 [second, minute, hour, day, month, year]、生日層級 3（＝時）
import sixLevelExportText from './fixtures/frontend_export_kanon_six_levels.json?raw';

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
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { buildBackendConfigDocumentFromWorkspace } from '../pipelineConfig';
import { TEMPORAL_GRANULARITY_UNITS, resolveImportedTemporalLevel, temporalUnitOfLevel } from '../temporalGranularity';

const COLUMNS = ['姓名', '身分證號', '生日', '年齡', '薪資', '就醫次數', '地區', '職業', '疾病', '婚姻狀況'];

// 依後端語意（層級 N＝levels 第 N 個單位）解讀送出的設定檔
const exportedBirthdayUnit = (): string => {
    const config = buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState()) as {
        k_anonymity: { generalization_hierarchies: Record<string, { levels: string[] }>; qi_generalization_levels: Record<string, number> };
    };
    const levels = config.k_anonymity.generalization_hierarchies.生日.levels;
    expect(levels).toEqual(['minute', 'hour', 'day', 'month', 'year']);
    return levels[config.k_anonymity.qi_generalization_levels.生日 - 1];
};

const importThroughStep2 = async (jsonText: string): Promise<void> => {
    useWorkspaceStore.setState({
        columns: COLUMNS, previewData: [], dataFile: null, fileName: 'input_1m.csv', preprocessingRules: {}, privacyMode: 'k-anonymity',
        kAnonymityFields: [], kAnonymityHierarchies: [], columnRoles: {}, columnTypes: {}
    } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    messageMock.success.mockClear();
    const { container } = render(<KAnonymityMapping />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([jsonText], 'config.json', { type: 'application/json' })] } });
    await waitFor(() => expect(messageMock.success).toHaveBeenCalled());
    // 等元件把欄位設定同步回 store
    await waitFor(() => expect(useWorkspaceStore.getState().kAnonymityFields.length).toBeGreaterThan(0));
};

const birthdayFieldOf = () => (useWorkspaceStore.getState().kAnonymityFields as { name: string; genStrategy: string; genMaxLevel: number }[]).find((field) => field.name === '生日');

describe('時間粒度：依設定檔自己的 levels 判定層級', () => {
    afterEach(() => cleanup());

    it('config_kanon.json（levels=[day, month, year]、層級 3）匯入後為「年」，送出設定檔仍是「年」', async () => {
        await importThroughStep2(backendConfigKanonText);
        expect(birthdayFieldOf()).toMatchObject({ genStrategy: 'time_rounding', genMaxLevel: 5 });
        expect(temporalUnitOfLevel(birthdayFieldOf()!.genMaxLevel)).toBe('year');
        expect(exportedBirthdayUnit()).toBe('year');
    });

    it('先前匯出的六級檔（[second, …, year]、層級 3）匯入後為「時」，送出設定檔仍是「時」', async () => {
        await importThroughStep2(sixLevelExportText);
        expect(birthdayFieldOf()).toMatchObject({ genStrategy: 'time_rounding', genMaxLevel: 2 });
        expect(exportedBirthdayUnit()).toBe('hour');
    });

    it('換算規則：second 對應到最細的「分」、層級 0 維持不泛化、超出清單或缺漏時交給預設值', () => {
        expect(TEMPORAL_GRANULARITY_UNITS).not.toContain('second');
        expect(resolveImportedTemporalLevel(['day', 'month', 'year'], 1)).toBe(3);
        expect(resolveImportedTemporalLevel(['day', 'month', 'year'], 2)).toBe(4);
        expect(resolveImportedTemporalLevel(['second', 'minute', 'hour', 'day', 'month', 'year'], 1)).toBe(1);
        expect(resolveImportedTemporalLevel(['Month', 'YEAR'], 1)).toBe(4);
        expect(resolveImportedTemporalLevel(['day', 'month', 'year'], 0)).toBe(0);
        expect(resolveImportedTemporalLevel(['day', 'month', 'year'], 4)).toBeNull();
        expect(resolveImportedTemporalLevel(undefined, 3)).toBeNull();
        expect(resolveImportedTemporalLevel(['week'], 1)).toBeNull();
    });
});
