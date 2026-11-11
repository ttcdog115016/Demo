// @vitest-environment jsdom
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import backendConfigDpText from './fixtures/backend_config_dp.json?raw';

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
import { parseBackendDpColumnBudgets } from '../dpConfigImport';

describe('Step3 隱私預算中心', () => {
    afterEach(() => cleanup());

    it('匯入後端範例（薪資 ε=5、δ=1e-5，就醫次數沿用全域 δ=1e-4）後顯示實際消耗 ε=17、δ=1.1e-4，與 Step4／後端一致', () => {
        const dpFields = parseBackendDpColumnBudgets(JSON.parse(backendConfigDpText).differential_privacy.column_budgets)
            .map((field, index) => ({ id: `f${index}`, ...field }));
        useWorkspaceStore.setState({
            columns: dpFields.map((field) => field.fieldName), columnRoles: {}, privacyMode: 'differential-privacy',
            dpFields, targetDelta: 1e-4, budgetLimitEpsilon: 20
        } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        const { getByTestId } = render(<DifferentialPrivacyRules />);
        // ★ 2026-10-07 白話版：右側「已用預算 ε」格顯示 17 / 20 與 δ（舊版「等效 ε」會把薪資換算成 4、總和 16）
        const budgetTileText = getByTestId('dp-plain-sum-budget').textContent || '';
        expect(budgetTileText).toContain('17 / 20');
        expect(budgetTileText).not.toContain('16');
        expect(budgetTileText).toContain('δ = 1.1e-4');
    });
});
