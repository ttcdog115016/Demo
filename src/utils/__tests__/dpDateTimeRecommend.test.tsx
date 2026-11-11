// @vitest-environment jsdom
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key)) })
}));
const messageMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), destroy: vi.fn() }));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    MockApp.useApp = () => ({ message: messageMock, modal: { confirm: vi.fn() }, notification: { error: vi.fn(), warning: vi.fn() } });
    return { ...actual, App: MockApp };
});

import DifferentialPrivacyMapping from '../../features/step2_mapping/DifferentialPrivacyMapping';
import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';
import { DEFAULT_DATETIME_LOWER_BOUND_DATE } from '../dpFieldHelpers';

const CSV_TEXT = '姓名,年齡,生日\n宋淑偉,52,1974-06-18\n金品生,88,1938-11-26\n王小明,19,2007-03-05\n';

const setup = (dpFields: DPField[]) => {
    const csvFile = new File([CSV_TEXT], 'input.csv', { type: 'text/csv', lastModified: 2 });
    useWorkspaceStore.setState({
        columns: ['姓名', '年齡', '生日'], previewData: [], dataFile: csvFile, fileName: 'input.csv', datasetProfile: null,
        dpFields, datasetColumnNumericValuesMap: {}, preprocessingRules: {}, columnTypes: {}, privacyMode: 'differential-privacy'
    } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    messageMock.success.mockClear();
    messageMock.warning.mockClear();
    return render(<DifferentialPrivacyMapping />);
};

const fieldOf = (fieldName: string) => useWorkspaceStore.getState().dpFields.find((field) => field.fieldName === fieldName)!;
const pickerValues = (container: HTMLElement) => Array.from(container.querySelectorAll('.ant-picker input')).map((inputElement) => (inputElement as HTMLInputElement).value);

describe('Step2 自動智慧推薦：日期上下限帶入資料的最早／最晚日期', () => {
    afterEach(() => cleanup());

    it('生日邊界由預設的 1930-01-01～今天改為資料範圍 1938-11-26～2007-03-05，年齡照舊取整數範圍', async () => {
        const { container, getByText } = setup([
            { id: 'a', fieldName: '年齡', fieldType: 'Numeric', enabled: true, epsilon: 1, delta: 0, lowerBound: 0, upperBound: 100 },
            { id: 'b', fieldName: '生日', fieldType: 'Numeric', enabled: true, epsilon: 1, delta: 0, isDateTime: true, lowerBound: '1930-01-01', upperBound: '2026-10-01' }
        ]);
        fireEvent.click(getByText('自動智慧推薦'));
        await waitFor(() => expect(fieldOf('生日')).toMatchObject({ lowerBound: '1938-11-26', upperBound: '2007-03-05' }));
        expect(fieldOf('年齡')).toMatchObject({ lowerBound: 19, upperBound: 88 });
        await waitFor(() => expect(pickerValues(container)).toEqual(['1938-11-26 00:00:00', '2007-03-05 00:00:00']));
    });

    it('資料中沒有可解析的日期時，退回預設日期範圍（仍是日期字串，不會變成數字）', async () => {
        const csvFile = new File(['生日\nabc\n'], 'bad.csv', { type: 'text/csv', lastModified: 3 });
        const { getByText } = setup([
            { id: 'b', fieldName: '生日', fieldType: 'Numeric', enabled: true, epsilon: 1, delta: 0, isDateTime: true, lowerBound: '1930-01-01', upperBound: '2026-10-01' }
        ]);
        useWorkspaceStore.setState({ dataFile: csvFile, columns: ['生日'] });
        fireEvent.click(getByText('自動智慧推薦'));
        await waitFor(() => expect(messageMock.success.mock.calls.length + messageMock.warning.mock.calls.length).toBeGreaterThan(0));
        expect(fieldOf('生日').lowerBound).toBe(DEFAULT_DATETIME_LOWER_BOUND_DATE);
        expect(fieldOf('生日').upperBound).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
