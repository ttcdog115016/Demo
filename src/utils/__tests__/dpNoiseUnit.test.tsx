// @vitest-environment jsdom
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import backendConfigDpText from './fixtures/backend_config_dp.json?raw';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// 帶 {{變數}} 代換的翻譯替身，讓畫面上的單位文字與正式環境一致
const stableTranslation = vi.hoisted(() => ({
    t: (key: string, fallback?: unknown, interpolation?: Record<string, unknown>) => {
        const template = typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key);
        const values = (typeof fallback === 'string' ? interpolation : (fallback as Record<string, unknown> | undefined)) ?? {};
        return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    }
}));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));
vi.mock('echarts-for-react', () => ({ default: () => null }));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    MockApp.useApp = () => ({ message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } });
    return { ...actual, App: MockApp };
});

import DifferentialPrivacyRules from '../../features/step3_rules/DifferentialPrivacyRules';
import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';
import { parseBackendDpColumnBudgets } from '../dpConfigImport';
import { buildBackendConfigDocumentFromWorkspace, computeDefaultDpSensitivity } from '../pipelineConfig';
import { convertDpSensitivityBetweenNoiseUnits, normalizeDpDatetimeNoiseUnit, detectDpDateTimeBoundsFinestUnit, findDpBoundsFinerThanNoiseUnit } from '../dpFieldHelpers';

type ColumnBudgets = Record<string, Record<string, unknown>>;

const backendSample = JSON.parse(backendConfigDpText);

const loadFields = (columnBudgets: ColumnBudgets): DPField[] =>
    parseBackendDpColumnBudgets(columnBudgets).map((field, index) => ({ id: `f${index}`, ...field }));

const setWorkspace = (dpFields: DPField[]) => useWorkspaceStore.setState({
    columns: dpFields.map((field) => field.fieldName), columnRoles: {}, columnTypes: {}, privacyMode: 'differential-privacy', fileName: 'input_1m.csv',
    dpFields, targetDelta: 1e-5, budgetLimitEpsilon: 20, dpAccumulatedEpsilon: 0, dpAccumulatedDelta: 0
} as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

const exportedBudgets = (): ColumnBudgets =>
    (buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState()) as { differential_privacy: { column_budgets: ColumnBudgets } }).differential_privacy.column_budgets;

const birthdayField = () => useWorkspaceStore.getState().dpFields.find((field) => field.fieldName === '生日')!;

describe('DP 日期欄位的雜訊單位（noise_unit：day／hour／minute／second）', () => {
    afterEach(() => cleanup());

    it('後端範例（day）匯入後為「天」，匯出仍送 day', () => {
        setWorkspace(loadFields(backendSample.differential_privacy.column_budgets));
        expect(birthdayField().noiseUnit).toBe('day');
        expect(exportedBudgets().生日).toMatchObject({ noise_unit: 'day', noise_step: 7, sensitivity: 365 });
    });

    it('設定檔為 hour 時匯入後保留 hour，再匯出內容不變（先前會被改回 day）', () => {
        const hourlyBudgets = JSON.parse(backendConfigDpText).differential_privacy.column_budgets;
        hourlyBudgets.生日 = { ...hourlyBudgets.生日, noise_unit: 'hour', noise_step: 6, sensitivity: 8760 };
        setWorkspace(loadFields(hourlyBudgets));
        expect(birthdayField()).toMatchObject({ noiseUnit: 'hour', noiseStep: 6, sensitivity: 8760 });
        expect(exportedBudgets().生日).toEqual(hourlyBudgets.生日);
    });

    it('未指定敏感度時，以邊界寬度依雜訊單位換算（2026-01-01～2026-01-02：1 天＝24 時＝1440 分＝86400 秒）', () => {
        const bounds = { lowerBound: '2026-01-01', upperBound: '2026-01-02' };
        expect(computeDefaultDpSensitivity(bounds, true)).toBe(1);
        expect(computeDefaultDpSensitivity({ ...bounds, noiseUnit: 'hour' }, true)).toBe(24);
        expect(computeDefaultDpSensitivity({ ...bounds, noiseUnit: 'minute' }, true)).toBe(1440);
        expect(computeDefaultDpSensitivity({ ...bounds, noiseUnit: 'second' }, true)).toBe(86400);

        const minuteBudgets: ColumnBudgets = { 就診時間: { type: 'datetime', epsilon_budget: 1, delta_budget: 0, noise_unit: 'minute', noise_step: 15, time_clipping_bounds: ['2026-01-01', '2026-01-02'] } };
        setWorkspace(loadFields(minuteBudgets));
        expect(exportedBudgets().就診時間).toMatchObject({ noise_unit: 'minute', noise_step: 15, sensitivity: 1440 });
    });

    it('後端不支援的單位（month）或大小寫不同時：正規化，無效者退回 day', () => {
        expect(normalizeDpDatetimeNoiseUnit(' Hour ')).toBe('hour');
        expect(normalizeDpDatetimeNoiseUnit('month')).toBeUndefined();
        expect(loadFields({ d: { type: 'datetime', epsilon_budget: 1, noise_unit: 'month' } })[0].noiseUnit).toBe('day');
        expect(loadFields({ d: { type: 'datetime', epsilon_budget: 1 } })[0].noiseUnit).toBe('day');
        expect(loadFields({ n: { type: 'continuous', epsilon_budget: 1 } })[0].noiseUnit).toBeUndefined();
    });

    it('切換單位時換算已指定的敏感度，代表的時間長度不變', () => {
        expect(convertDpSensitivityBetweenNoiseUnits(365, 'day', 'hour')).toBe(8760);
        expect(convertDpSensitivityBetweenNoiseUnits(8760, 'hour', 'day')).toBe(365);
        expect(convertDpSensitivityBetweenNoiseUnits(30, 'second', 'minute')).toBe(1);
        expect(convertDpSensitivityBetweenNoiseUnits(undefined, 'day', 'hour')).toBeUndefined();
    });

    it('Step3 畫面：日期欄位有雜訊單位選單，改成「時」後敏感度 365 天 → 8760 時，送出 noise_unit hour', async () => {
        setWorkspace(loadFields(backendSample.differential_privacy.column_budgets));
        const { getByTestId, getByText } = render(<DifferentialPrivacyRules />);
        const noiseUnitSelect = getByTestId('dp-noise-unit-select');
        expect(noiseUnitSelect.textContent).toContain('天');
        expect(getByText('加噪步階 (天)')).toBeTruthy();

        fireEvent.mouseDown(noiseUnitSelect.querySelector('.ant-select-selector') ?? noiseUnitSelect);
        const hourOption = await waitFor(() => {
            const optionElement = Array.from(document.querySelectorAll('.ant-select-item-option')).find((element) => element.textContent === '時');
            expect(optionElement).toBeTruthy();
            return optionElement as HTMLElement;
        });
        fireEvent.click(hourOption);

        await waitFor(() => expect(birthdayField()).toMatchObject({ noiseUnit: 'hour', sensitivity: 8760, noiseStep: 7 }));
        expect(getByText('加噪步階 (時)')).toBeTruthy();
        expect(exportedBudgets().生日).toMatchObject({ noise_unit: 'hour', noise_step: 7, sensitivity: 8760 });
    });

    it('邊界實際用到的最細單位：午夜／只填日期為天，其餘依非 0 的時、分、秒判定', () => {
        expect(detectDpDateTimeBoundsFinestUnit(['1930-01-01', '2026-12-31'])).toBe('day');
        expect(detectDpDateTimeBoundsFinestUnit(['1930-01-01 00:00:00', '2026-12-31 23:00:00'])).toBe('hour');
        expect(detectDpDateTimeBoundsFinestUnit(['1930-01-01', '2026-12-31 23:30:00'])).toBe('minute');
        expect(detectDpDateTimeBoundsFinestUnit(['2026-01-01 08:30:15', '2026-12-31'])).toBe('second');
        expect(findDpBoundsFinerThanNoiseUnit({ lowerBound: '2026-01-01 08:30:15', upperBound: '2026-12-31' })).toBe('second');
        expect(findDpBoundsFinerThanNoiseUnit({ lowerBound: '2026-01-01 08:30:15', upperBound: '2026-12-31', noiseUnit: 'second' })).toBeNull();
        expect(findDpBoundsFinerThanNoiseUnit({ lowerBound: '2026-01-01 08:00:00', upperBound: '2026-12-31', noiseUnit: 'minute' })).toBeNull();
    });

    it('Step3 畫面：邊界細到秒而雜訊單位為天時顯示提醒，按「改為「秒」」後提醒消失、送出 noise_unit second', async () => {
        const dpFields = loadFields(backendSample.differential_privacy.column_budgets)
            .map((field) => field.fieldName === '生日' ? { ...field, lowerBound: '1930-01-01', upperBound: '2026-12-31 23:59:59', sensitivity: undefined } : field);
        setWorkspace(dpFields);
        const { queryByTestId, getByText } = render(<DifferentialPrivacyRules />);
        const warningElement = queryByTestId('dp-noise-unit-coarser-warning');
        expect(warningElement?.textContent).toContain('Step2 的上下限細到「秒」，但雜訊單位是「天」');
        fireEvent.click(getByText('改為「秒」'));
        await waitFor(() => expect(queryByTestId('dp-noise-unit-coarser-warning')).toBeNull());
        expect(birthdayField().noiseUnit).toBe('second');
        expect(exportedBudgets().生日).toMatchObject({ noise_unit: 'second', time_clipping_bounds: ['1930-01-01', '2026-12-31 23:59:59'] });
    });

    it('Step3 畫面：邊界只有日期（後端範例）時不顯示提醒', () => {
        setWorkspace(loadFields(backendSample.differential_privacy.column_budgets));
        const { queryByTestId } = render(<DifferentialPrivacyRules />);
        expect(queryByTestId('dp-noise-unit-coarser-warning')).toBeNull();
    });
});
