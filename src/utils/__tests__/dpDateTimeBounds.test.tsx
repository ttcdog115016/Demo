// @vitest-environment jsdom
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import dayjs from 'dayjs';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key)) })
}));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    MockApp.useApp = () => ({ message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), destroy: vi.fn() }, modal: { confirm: vi.fn() }, notification: { error: vi.fn(), warning: vi.fn() } });
    return { ...actual, App: MockApp };
});

import DifferentialPrivacyMapping from '../../features/step2_mapping/DifferentialPrivacyMapping';
import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';
import { buildBackendConfigDocumentFromWorkspace, computeDefaultDpSensitivity } from '../pipelineConfig';
import { compactDpDateTimeBoundText, parseDpDateTimeBoundTimestamp } from '../dpFieldHelpers';

const birthdayField = (overrides: Partial<DPField>): DPField => ({
    id: 'b', fieldName: '生日', fieldType: 'Numeric', enabled: true, mode: 'epsilon', epsilon: 1, delta: 0,
    isDateTime: true, noiseStep: 1, lowerBound: '1930-01-01', upperBound: '2026-12-31', ...overrides
});

const renderStep2 = (field: DPField) => {
    useWorkspaceStore.setState({
        columns: ['生日'], previewData: [], dataFile: null, dpFields: [field], datasetColumnNumericValuesMap: {}, preprocessingRules: {}, columnTypes: {},
        privacyMode: 'differential-privacy', fileName: 'x.csv', targetDelta: 1e-5, dpAccumulatedEpsilon: 0, dpAccumulatedDelta: 0
    } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    const { container } = render(<DifferentialPrivacyMapping />);
    return Array.from(container.querySelectorAll('.ant-picker input')).map((inputElement) => (inputElement as HTMLInputElement).value);
};

describe('Step2 DP 日期邊界可選到秒', () => {
    afterEach(() => cleanup());

    it('不論 Step3 雜訊單位為何，邊界都顯示到秒（雜訊單位預設為天時也一樣）', () => {
        expect(renderStep2(birthdayField({}))).toEqual(['1930-01-01 00:00:00', '2026-12-31 00:00:00']);
        cleanup();
        expect(renderStep2(birthdayField({ noiseUnit: 'second', lowerBound: '2026-01-01 08:30:15', upperBound: '2026-01-01 09:00:00' }))).toEqual(['2026-01-01 08:30:15', '2026-01-01 09:00:00']);
    });

    it('選擇器有時間面板，可選時／分／秒', () => {
        renderStep2(birthdayField({}));
        const lowerPickerInput = document.querySelector('.ant-picker input') as HTMLInputElement;
        fireEvent.mouseDown(lowerPickerInput);
        fireEvent.click(lowerPickerInput);
        const timeColumns = document.querySelectorAll('.ant-picker-time-panel-column');
        expect(timeColumns.length).toBe(3);
    });

    it('寫入的字串：午夜只留日期（與後端範例寫法一致），其餘保留到秒', () => {
        const toBoundText = (text: string) => compactDpDateTimeBoundText(dayjs(text).format('YYYY-MM-DD HH:mm:ss'));
        expect(toBoundText('2026-12-31 00:00:00')).toBe('2026-12-31');
        expect(toBoundText('2026-12-31 23:45:12')).toBe('2026-12-31 23:45:12');
        expect(toBoundText('2026-12-31 00:00:01')).toBe('2026-12-31 00:00:01');
    });

    it('純日期與帶時間的邊界混用時，敏感度不受時區影響（2026-01-01 ～ 2026-01-01 06:00:00 為 6 時）', () => {
        expect(parseDpDateTimeBoundTimestamp('2026-01-01 06:00:00') - parseDpDateTimeBoundTimestamp('2026-01-01')).toBe(6 * 3600000);
        expect(parseDpDateTimeBoundTimestamp('2026-01-01T06:00')).toBe(Date.UTC(2026, 0, 1, 6));
        expect(Number.isNaN(parseDpDateTimeBoundTimestamp('x'))).toBe(true);
        expect(computeDefaultDpSensitivity({ lowerBound: '2026-01-01', upperBound: '2026-01-01 06:00:00', noiseUnit: 'hour' }, true)).toBe(6);
    });

    it('送出的設定檔：time_clipping_bounds 帶時間，敏感度以時計', () => {
        renderStep2(birthdayField({ noiseUnit: 'hour', lowerBound: '2026-01-01', upperBound: '2026-01-02 12:00:00' }));
        const config = buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState()) as { differential_privacy: { column_budgets: Record<string, Record<string, unknown>> } };
        expect(config.differential_privacy.column_budgets.生日).toMatchObject({
            noise_unit: 'hour', sensitivity: 36, time_clipping_bounds: ['2026-01-01', '2026-01-02 12:00:00']
        });
    });
});
