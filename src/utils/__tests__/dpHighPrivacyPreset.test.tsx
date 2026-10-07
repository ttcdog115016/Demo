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

const stableTranslation = vi.hoisted(() => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key))
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
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

const NAMES = ['年齡', '婚姻', '人種', '教育水平', 'bmi', '是否憂鬱症', '是否貧困', '活動量', '是否糖尿病'];

describe('Step3 差分隱私：9 個欄位套用「高隱私」後可前往下一步', () => {
    afterEach(() => cleanup());

    it('總預算 1 平分 9 欄（加總 1.0000000000000002）不再被判超支，步驟驗證通過', async () => {
        const dpFields = NAMES.map((name, i) => ({
            id: `f${i}`, fieldName: name, fieldType: i === 0 || i === 4 ? 'Numeric' : 'Categorical', enabled: true, mode: 'epsilon',
            epsilon: 1, delta: 0, lowerBound: 0, upperBound: i === 0 ? 100 : 1, minimumUnit: 1, allowedCategories: 'auto_extracted'
        }));
        useWorkspaceStore.setState({
            columns: NAMES, columnRoles: {}, privacyMode: 'differential-privacy',
            dpFields, targetDelta: 1e-4, budgetLimitEpsilon: 20
        } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        const { getByText } = render(<DifferentialPrivacyRules />);

        fireEvent.click(getByText('高隱私 (High Privacy)'));
        await waitFor(() => expect(useWorkspaceStore.getState().budgetLimitEpsilon).toBe(1));
        useWorkspaceStore.getState().dpFields.forEach((field) => expect(field.epsilon).toBeCloseTo(1 / 9, 12));
        await waitFor(() => expect(useWorkspaceStore.getState().isStepValid).toBe(true));
    });
});
