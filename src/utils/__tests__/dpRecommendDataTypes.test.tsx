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


// 模擬使用者截圖中的資料集：名稱命中關鍵字的（年齡、婚姻）照原規則，其餘依實際資料判斷
const rows: string[] = ['年齡,婚姻,人種,教育水平,bmi,是否憂鬱症,活動量,姓名'];
const races = ['White', 'Black', 'Asian'];
const edus = ['Graduate', 'College', 'HighSchool', 'None'];
const acts = ['Low', 'Medium', 'High'];
for (let i = 0; i < 40; i++) {
    rows.push([20 + i, i % 2 ? 'Married' : 'Single', races[i % 3], edus[i % 4], (18 + i * 0.5).toFixed(1), i % 2, acts[i % 3], `Person${i}`].join(','));
}
const CSV_TEXT = rows.join('\n') + '\n';
const COLUMNS = rows[0].split(',');

const unknownField = (name: string, i: number): DPField => ({ id: `f${i}`, fieldName: name, fieldType: 'Unknown', enabled: true, epsilon: 1, delta: 1e-5, allowedCategories: '', outOfBoundsStrategy: 'clip' });

describe('DP Step2 套用系統推薦設定：名稱判斷不出的欄位改讀實際資料（比照 K-匿名）', () => {
    afterEach(() => cleanup());

    it('bmi／是否憂鬱症 → 數值型（邊界取實際範圍）；人種／教育水平／活動量 → 類別型；姓名 → 文字型；不再出現「無法自動判斷」', async () => {
        const csvFile = new File([CSV_TEXT], 'input.csv', { type: 'text/csv', lastModified: 5 });
        useWorkspaceStore.setState({
            columns: COLUMNS, previewData: [], dataFile: csvFile, fileName: 'input.csv', datasetProfile: null,
            dpFields: COLUMNS.map(unknownField), datasetColumnNumericValuesMap: {}, preprocessingRules: {}, columnTypes: {}, privacyMode: 'differential-privacy'
        } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        messageMock.success.mockClear();
        messageMock.warning.mockClear();
        const { getByText } = render(<DifferentialPrivacyMapping />);

        fireEvent.click(getByText('自動智慧推薦'));
        await waitFor(() => expect(messageMock.success).toHaveBeenCalled());
        expect(messageMock.warning).not.toHaveBeenCalled();

        const typeOf = (name: string) => useWorkspaceStore.getState().dpFields.find((f) => f.fieldName === name)!;
        expect(typeOf('年齡').fieldType).toBe('Numeric');
        expect(typeOf('婚姻').fieldType).toBe('Categorical');
        expect(typeOf('bmi')).toMatchObject({ fieldType: 'Numeric', lowerBound: 18, upperBound: 38, enabled: true });
        expect(typeOf('是否憂鬱症')).toMatchObject({ fieldType: 'Numeric', lowerBound: 0, upperBound: 1 });
        expect(typeOf('人種')).toMatchObject({ fieldType: 'Categorical', allowedCategories: 'auto_extracted' });
        expect(typeOf('教育水平').fieldType).toBe('Categorical');
        expect(typeOf('活動量').fieldType).toBe('Categorical');
        expect(typeOf('姓名')).toMatchObject({ fieldType: 'Text', enabled: false });
    });
});
