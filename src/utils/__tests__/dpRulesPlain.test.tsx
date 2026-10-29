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

import { fireEvent, screen } from '@testing-library/react';

const setupFields = () => {
    const dpFields = parseBackendDpColumnBudgets(JSON.parse(backendConfigDpText).differential_privacy.column_budgets)
        .map((field, index) => ({ id: `f${index}`, ...field }));
    useWorkspaceStore.setState({
        columns: dpFields.map((field) => field.fieldName), columnRoles: {}, privacyMode: 'differential-privacy',
        dpFields, targetDelta: 1e-4, budgetLimitEpsilon: 20
    } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    return dpFields;
};

describe('Step3 差分隱私精簡白話版（2026-10-07）', () => {
    afterEach(() => cleanup());

    it('設定不等於任何預設時為「自訂」並顯示總預算上限；點「中保護」後平均分配並選中', () => {
        const dpFields = setupFields();
        render(<DifferentialPrivacyRules />);
        expect(screen.getByTestId('dp-preset-custom').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByLabelText('budget-limit-epsilon')).toBeTruthy();

        fireEvent.click(screen.getByTestId('dp-preset-medium'));
        const enabledCount = dpFields.filter((field) => field.enabled).length;
        expect(useWorkspaceStore.getState().budgetLimitEpsilon).toBe(5);
        useWorkspaceStore.getState().dpFields.filter((field) => field.enabled).forEach((field) => expect(field.epsilon).toBeCloseTo(5 / enabledCount, 12));
        expect(screen.getByTestId('dp-preset-medium').getAttribute('aria-checked')).toBe('true');
        expect(screen.queryByLabelText('budget-limit-epsilon')).toBeNull();
        expect(screen.getByTestId('dp-plain-sum-budget').textContent).toContain('5 / 5');
    });

    it('2026-10-22：總預算上限可輸入小數，箭頭一格 0.1（0.1 → 0.2）', () => {
        setupFields();
        useWorkspaceStore.setState({ budgetLimitEpsilon: 0.1 } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        render(<DifferentialPrivacyRules />);
        const budgetInput = screen.getByLabelText('budget-limit-epsilon');
        fireEvent.keyDown(budgetInput, { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 });
        expect(useWorkspaceStore.getState().budgetLimitEpsilon).toBeCloseTo(0.2, 10);
        fireEvent.change(budgetInput, { target: { value: '0.25' } });
        fireEvent.blur(budgetInput);
        expect(useWorkspaceStore.getState().budgetLimitEpsilon).toBeCloseTo(0.25, 10);
    });

    it('每列預設只顯示 ε；按「詳細」才出現模式等設定；全域 δ 收在進階', () => {
        setupFields();
        render(<DifferentialPrivacyRules />);
        expect(screen.queryAllByTestId('dp-field-advanced')).toHaveLength(0);
        fireEvent.click(screen.getByLabelText('薪資 詳細'));
        expect(screen.getAllByTestId('dp-field-advanced')).toHaveLength(1);
        expect(screen.queryByLabelText('global-target-delta')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /進階/ }));
        expect(screen.getByLabelText('global-target-delta')).toBeTruthy();
    });
});

describe('DP Step3 參考來源（2026-10-22，NIST SP 800-226 圖 2）', () => {
    afterEach(() => cleanup());

    it('保護強度、右側摘要、δ 的問號為簡短說明並註明參考來源（2026-10-27 精簡）', async () => {
        setupFields();
        useWorkspaceStore.setState({ datasetProfile: { rowCount: 1000 } } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        render(<DifferentialPrivacyRules />);
        const source = await import('../../features/step3_rules/DifferentialPrivacyRules?raw');
        const text = (source as unknown as { default: string }).default;
        expect(text).toContain('NIST SP 800-226');
        expect(text).toContain('決定要加多少雜訊：雜訊越多越安全，但數字越不準。');
        expect(text).toContain('保護「萬一失效」的機率上限，越小越安全。一般不用調整。');
        expect(screen.getByTestId('dp-plain-sum-level')).toBeTruthy();
    });
});
