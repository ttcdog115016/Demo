/**
 * ★ 2026-10-08：K-匿名 Step3 的 l-多樣性／t-緊密度維持預設關閉（即使 Step2 有敏感欄位），進階區塊旁顯示「不開也能計算」說明。
 */
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
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
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

type WorkspaceState = ReturnType<typeof useWorkspaceStore.getState>;
const makeState = (sensitiveStrategy: string | null) => ({
    columns: ['年齡', '地區', '疾病'],
    columnRoles: { 年齡: 'Quasi-identifier', 地區: 'Quasi-identifier', 疾病: sensitiveStrategy ? 'Sensitive' : 'Non-sensitive' },
    previewData: Array.from({ length: 200 }, (_, rowIndex) => ({ 年齡: String(20 + (rowIndex % 50)), 地區: 'A', 疾病: ['X', 'Y', 'Z'][rowIndex % 3] })),
    datasetProfile: null,
    kValue: 3, lValue: 2, tValue: 0.15,
    enableLDiversity: false, enableTCloseness: false,
    maxSuppression: 5, suppressionMethod: 'row_suppression', limitExceededAction: 'stop_and_error',
    cellFillMethod: 'star', cellFillValuesByColumn: {},
    kAnonymityFields: [
        { name: '年齡', role: 'Quasi-identifier', maskStrategy: 'none' },
        { name: '地區', role: 'Quasi-identifier', maskStrategy: 'none' },
        { name: '疾病', role: sensitiveStrategy ? 'Sensitive' : 'Non-sensitive', maskStrategy: sensitiveStrategy ?? 'none' },
    ],
}) as unknown as Partial<WorkspaceState>;

describe('敏感資料保護（l／t）預設關閉', () => {
    afterEach(() => cleanup());

    it('有敏感欄位、用預設強度：l／t 仍關閉，區塊收合但看得到說明文字', () => {
        useWorkspaceStore.setState(makeState('none'));
        render(<KAnonymityRules />);
        expect(useWorkspaceStore.getState().enableLDiversity).toBe(false);
        expect(useWorkspaceStore.getState().enableTCloseness).toBe(false);
        expect(screen.queryByLabelText('l-diversity (l)')).toBeNull();
        expect(screen.getByTestId('kanon-advanced-optional-note').textContent).toBe('不開也能計算；開啟後保護更強，但可能刪除更多筆。');
    });

    it('點預設強度卡片不會開啟 l', () => {
        useWorkspaceStore.setState(makeState('none'));
        render(<KAnonymityRules />);
        fireEvent.click(screen.getByTestId('kanon-preset-strict'));
        expect(useWorkspaceStore.getState().kValue).toBe(10);
        expect(useWorkspaceStore.getState().enableLDiversity).toBe(false);
    });
});
