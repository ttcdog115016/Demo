// @vitest-environment jsdom
import React from 'react';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

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
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

// birth_date 為日期字串（e2e mock_privacy_data.csv 的實際內容）、dob 為純數字 yyyymmdd、age 為年齡
const COLUMNS = ['birth_date', 'dob', 'age'];
const PREVIEW_ROWS = [
    { birth_date: '1998-05-12', dob: '19980512', age: '28' },
    { birth_date: '1991-11-23', dob: '19911123', age: '35' },
    { birth_date: '1984-03-08', dob: '19840308', age: '42' },
];

describe('K-匿名「套用系統推薦設定」：生日類欄位依實際資料判斷型態（2026-11-03）', () => {
    afterEach(() => cleanup());

    it('日期字串的 birth_date → 時間型；全為數字的 dob → 維持數值型；age → 數值型', async () => {
        useWorkspaceStore.setState({
            columns: COLUMNS, previewData: PREVIEW_ROWS, dataFile: null, fileName: 'mock.csv', preprocessingRules: {},
            privacyMode: 'k-anonymity', kAnonymityFields: [], kAnonymityHierarchies: [], columnRoles: {}, columnTypes: {}
        } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

        render(<KAnonymityMapping />);
        // 欄位清單於 queueMicrotask 中依 columns 建立，需等建好再按推薦
        await waitFor(() => expect(useWorkspaceStore.getState().kAnonymityFields).toHaveLength(COLUMNS.length));
        fireEvent.click(screen.getByText('step2.btn_apply_recommend'));

        const fieldsByName = Object.fromEntries((useWorkspaceStore.getState().kAnonymityFields as { name: string; type: string; role: string }[]).map((field) => [field.name, field]));
        expect(fieldsByName.birth_date).toMatchObject({ type: 'temporal', role: 'Quasi-identifier' });
        expect(fieldsByName.dob).toMatchObject({ type: 'numeric', role: 'Quasi-identifier' });
        expect(fieldsByName.age).toMatchObject({ type: 'numeric', role: 'Quasi-identifier' });
    });
});
