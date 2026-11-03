/**
 * Step3 K-匿名精簡白話版（2026-10-07）：保護強度卡、自訂 K、抑制方式、進階區塊收合、右側示意圖下方三個重點數字。
 */
// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// 依 i18next 規則以預設文字內插 {{變數}}
const stableTranslation = vi.hoisted(() => ({
    t: (key: string, fallbackOrOptions?: unknown, maybeOptions?: unknown) => {
        const options = (typeof fallbackOrOptions === 'object' && fallbackOrOptions ? fallbackOrOptions : maybeOptions || {}) as Record<string, unknown>;
        const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : String(options.defaultValue ?? key);
        return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ''));
    }
}));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));
vi.mock('echarts-for-react', () => ({ default: () => null }));

import KAnonymityRules from '../../features/step3_rules/KAnonymityRules';
import { useWorkspaceStore, DEFAULT_KANON_RULE_PARAMS } from '../../store/useWorkspaceStore';

const baseState = {
    columns: ['年齡', '地區', '疾病'],
    columnRoles: { 年齡: 'Quasi-identifier', 地區: 'Quasi-identifier', 疾病: 'Sensitive' },
    previewData: Array.from({ length: 200 }, (_, rowIndex) => ({ 年齡: String(20 + (rowIndex % 50)), 地區: 'A', 疾病: 'X' })),
    datasetProfile: null,
    kValue: 3, lValue: 2, tValue: 0.15,
    enableLDiversity: false, enableTCloseness: false,
    maxSuppression: 5, suppressionMethod: 'row_suppression', limitExceededAction: 'stop_and_error',
    cellFillMethod: 'star', cellFillValuesByColumn: {}, kAnonymityFields: []
};

describe('Step3 K-匿名白話版', () => {
    beforeEach(() => {
        useWorkspaceStore.setState(baseState as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    });
    afterEach(() => cleanup());

    it('K=3 選中「標準」，摘要顯示猜中機會不超過 1/3', () => {
        render(<KAnonymityRules />);
        expect(screen.getByTestId('kanon-preset-standard').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('kanon-plain-level').textContent).toContain('標準');
        expect(screen.getByTestId('kanon-plain-sum-guess').textContent).toContain('33%');
        expect(screen.getByTestId('kanon-plain-sum-suppress').textContent).toContain('10 筆');
        // 未選自訂時不顯示 K 滑桿輸入框
        expect(screen.queryByLabelText('k-anonymity (k)')).toBeNull();
    });

    it('2026-10-22：「加強」標示預設；Store 初始 K=5；嚴格 K=12', () => {
        render(<KAnonymityRules />);
        expect(screen.getByTestId('kanon-preset-enhanced').textContent).toContain('預設');
        expect(screen.getByTestId('kanon-preset-standard').textContent).not.toContain('預設');
        expect(screen.getByTestId('kanon-preset-strict').textContent).toContain('12');
        expect(DEFAULT_KANON_RULE_PARAMS.kValue).toBe(5);
    });

    it('點「嚴格」寫入 K=12；點「自訂」出現 K 輸入框', () => {
        render(<KAnonymityRules />);
        fireEvent.click(screen.getByTestId('kanon-preset-strict'));
        expect(useWorkspaceStore.getState().kValue).toBe(12);
        expect(screen.getByTestId('kanon-plain-sum-guess').textContent).toContain('8%');
        fireEvent.click(screen.getByTestId('kanon-preset-custom'));
        expect(screen.getByLabelText('k-anonymity (k)')).toBeTruthy();
        expect(screen.getByTestId('kanon-plain-level').textContent).toContain('自訂');
    });

    it('K 不是預設值（例如匯入 K=7）時直接以自訂顯示', () => {
        useWorkspaceStore.setState({ kValue: 7 });
        render(<KAnonymityRules />);
        expect(screen.getByTestId('kanon-preset-custom').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByLabelText('k-anonymity (k)')).toBeTruthy();
    });

    it('抑制方式卡片切換寫入 store；最多可處理顯示約幾筆', () => {
        render(<KAnonymityRules />);
        expect(screen.getByTestId('kanon-plain-suppression').textContent).toContain('約 10 筆（共 200 筆）');
        expect(screen.getByTestId('kanon-plain-sum-suppress').textContent).toContain('最多刪除');
        fireEvent.click(screen.getByTestId('kanon-suppress-cell'));
        expect(useWorkspaceStore.getState().suppressionMethod).toBe('cell_suppression');
        expect(screen.getByTestId('cell-fill-values-by-column')).toBeTruthy();
        expect(screen.getByTestId('kanon-plain-sum-suppress').textContent).toContain('最多遮蔽');
    });

    it('進階區塊預設收合，展開後才出現 l／t 開關；已啟用 l 時預設展開', () => {
        const { unmount } = render(<KAnonymityRules />);
        expect(document.querySelectorAll('button[role="switch"]').length).toBe(0);
        fireEvent.click(screen.getByRole('button', { expanded: false }));
        expect(document.querySelectorAll('button[role="switch"]').length).toBe(2);
        unmount();

        useWorkspaceStore.setState({ enableLDiversity: true });
        render(<KAnonymityRules />);
        expect(document.querySelectorAll('button[role="switch"]').length).toBe(2);
        expect(screen.getByTestId('kanon-plain-advanced').textContent).toContain('已啟用');
    });
});
