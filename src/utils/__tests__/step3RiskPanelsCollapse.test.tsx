// @vitest-environment jsdom
/**
 * Step3「限定特定族群評估風險」「風險評估進階設定」（2026-11-05）：預設收合、點標題才展開，標題前不再有圖示；
 * 載入時已有設定就先展開，避免設定被藏起來。
 */
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const stableTranslation = vi.hoisted(() => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        const template = typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key);
        return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? ''));
    },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));

import RiskSubgroupFilterPanel from '../../features/step3_rules/RiskSubgroupFilterPanel';
import RiskAssessmentSettingsPanel from '../../features/step3_rules/RiskAssessmentSettingsPanel';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

const resetStore = () => useWorkspaceStore.setState({
    columns: ['年齡', '地區', '疾病'], previewData: [], dataFile: null, privacyMode: 'k-anonymity', columnTypes: {}, dpFields: [],
    riskColumnOverrides: null, riskLinkability: null, riskAttackParams: null, riskSubgroupFilters: {},
} as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

describe('Step3 風險評估設定面板：點選才展開', () => {
    beforeEach(() => resetStore());
    afterEach(() => cleanup());

    it('限定特定族群：沒有條件時預設收合，標題前沒有圖示，點標題展開與收合', () => {
        render(<RiskSubgroupFilterPanel />);
        const toggle = screen.getByTestId('risk-subgroup-header-toggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.querySelector('.anticon:not(.anticon-question-circle)')).toBeNull(); // 只剩問號說明，沒有標題圖示
        expect(screen.queryByText('新增限定條件')).toBeNull();
        expect(screen.getByText('不設定就是評估全部資料。')).toBeTruthy(); // 收合時也看得到的說明

        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('新增限定條件')).toBeTruthy();
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText('新增限定條件')).toBeNull();
    });

    it('限定特定族群：載入時已有條件就先展開並顯示條件數', () => {
        useWorkspaceStore.setState({ riskSubgroupFilters: { 地區: { kind: 'categorical', values: ['大安區'] } } } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        render(<RiskSubgroupFilterPanel />);
        expect(screen.getByTestId('risk-subgroup-header-toggle').getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('已設定 1 個條件')).toBeTruthy();
    });

    it('限定特定族群：新增限定條件按鈕不會觸發收合', () => {
        render(<RiskSubgroupFilterPanel />);
        fireEvent.click(screen.getByTestId('risk-subgroup-header-toggle'));
        fireEvent.click(screen.getByText('新增限定條件'));
        expect(screen.getByTestId('risk-subgroup-header-toggle').getAttribute('aria-expanded')).toBe('true');
        expect(Object.keys(useWorkspaceStore.getState().riskSubgroupFilters)).toHaveLength(1);
    });

    it('風險評估進階設定：預設收合，標題前沒有圖示；鍵盤 Enter／空白鍵可切換', () => {
        render(<RiskAssessmentSettingsPanel />);
        const toggle = screen.getByTestId('risk-settings-header-toggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.querySelector('.anticon-experiment')).toBeNull();
        expect(screen.getByText('預設')).toBeTruthy();
        expect(screen.queryByTestId('risk-param-n_iter')).toBeNull();

        fireEvent.keyDown(toggle, { key: 'Enter' });
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('risk-param-n_iter')).toBeTruthy();
        fireEvent.keyDown(toggle, { key: ' ' });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('風險評估進階設定：點問號說明不會切換展開狀態', () => {
        render(<RiskAssessmentSettingsPanel />);
        const toggle = screen.getByTestId('risk-settings-header-toggle');
        fireEvent.click(toggle.querySelector('.anticon-question-circle') as Element);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('風險評估進階設定：已調整過實驗參數時預設展開並標示已調整', () => {
        useWorkspaceStore.setState({ riskAttackParams: { n_iter: 100, ctrl_ratio: 0.2, seed: 42, n_subset: 500, n_repeats: 1, overlap_ratio: 0 } } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        render(<RiskAssessmentSettingsPanel />);
        expect(screen.getByTestId('risk-settings-header-toggle').getAttribute('aria-expanded')).toBe('true');
        expect(screen.getAllByText('已調整').length).toBeGreaterThan(0);
        expect(screen.getByTestId('risk-param-n_iter')).toBeTruthy();
    });
});
