/**
 * Step3 下載設定檔區塊（2026-10-07 QA 回饋：原右上角小按鈕不明顯）
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App as AntdApp } from 'antd';

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

import Step3_Rules from '../../features/step3_rules/Step3_Rules';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

describe('Step3 下載設定檔區塊', () => {
    it('頁面上方顯示醒目區塊與「下載設定檔」按鈕，點擊後產生 JSON 下載', () => {
        useWorkspaceStore.setState({ privacyMode: 'k-anonymity', columns: ['年齡'], columnRoles: { 年齡: 'Quasi-identifier' }, previewData: [] } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        const createObjectURL = vi.fn(() => 'blob:x');
        const revokeObjectURL = vi.fn();
        Object.assign(URL, { createObjectURL, revokeObjectURL });
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        render(<AntdApp><Step3_Rules /></AntdApp>);
        const banner = screen.getByTestId('step3-export-banner');
        expect(banner.textContent).toContain('設定檔（JSON）');
        fireEvent.click(screen.getByRole('button', { name: /下載設定檔/ }));
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(clickSpy).toHaveBeenCalledTimes(1);
    });
});
