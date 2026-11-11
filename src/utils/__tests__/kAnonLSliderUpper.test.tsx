/**
 * ★ 2026-10-13：敏感值種類（l）上限改為只受 K 限制；超過敏感欄位相異值數時顯示紅字並擋下一步。
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
const makeProfile = (diseaseDistinct: number) => ({
    fileKey: 'k', rowCount: 200, columnNamesList: ['年齡', '地區', '疾病'], numericValues: {},
    columns: Object.fromEntries([['年齡', 50], ['地區', 1], ['疾病', diseaseDistinct]].map(([name, count]) => [name, {
        nonEmptyCount: 200, distinctCount: count, isDistinctCountCapped: false, topValues: [], numericCount: 0, nonNumericDistinctValues: []
    }]))
});
const makeState = (diseaseDistinct: number) => ({
    columns: ['年齡', '地區', '疾病'],
    columnRoles: { 年齡: 'Quasi-identifier', 地區: 'Quasi-identifier', 疾病: 'Sensitive' },
    previewData: Array.from({ length: 200 }, (_, rowIndex) => ({ 年齡: String(20 + (rowIndex % 50)), 地區: 'A', 疾病: 'X' })),
    datasetProfile: makeProfile(diseaseDistinct),
    kValue: 5, lValue: 1, tValue: 0.7,
    enableLDiversity: true, enableTCloseness: false,
    maxSuppression: 10, suppressionMethod: 'row_suppression', limitExceededAction: 'allow_with_warning',
    cellFillMethod: 'star', cellFillValuesByColumn: {},
    kAnonymityFields: [
        { name: '年齡', role: 'Quasi-identifier', maskStrategy: 'none' },
        { name: '地區', role: 'Quasi-identifier', maskStrategy: 'none' },
        { name: '疾病', role: 'Sensitive', maskStrategy: 'none' },
    ],
}) as unknown as Partial<WorkspaceState>;

describe('l 上限只受 K 限制（2026-10-13）', () => {
    afterEach(() => cleanup());

    it('敏感欄位只有 1 種值、K=5：上限 4（l < K），l 可調到 3（不會被壓回 1），並顯示紅字、擋下一步', () => {
        useWorkspaceStore.setState(makeState(1));
        render(<KAnonymityRules />);
        const input = screen.getByLabelText('l-diversity (l)') as HTMLInputElement;
        expect(input.getAttribute('aria-valuemax')).toBe('4');
        fireEvent.change(input, { target: { value: '3' } });
        fireEvent.blur(input);
        expect(useWorkspaceStore.getState().lValue).toBe(3);
        expect(screen.getByTestId('l-exceeds-sensitive-distinct').textContent).toContain('只有 1 種不同的值');
    });

    it('敏感欄位 5 種值、K=5：l 調到 4 不顯示紅字', () => {
        useWorkspaceStore.setState(makeState(5));
        render(<KAnonymityRules />);
        const input = screen.getByLabelText('l-diversity (l)') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '4' } });
        fireEvent.blur(input);
        expect(useWorkspaceStore.getState().lValue).toBe(4);
        expect(screen.queryByTestId('l-exceeds-sensitive-distinct')).toBeNull();
    });

    it('K=5、l=5（例如匯入設定檔）：顯示 l 必須小於 K 的紅字', () => {
        useWorkspaceStore.setState({ ...makeState(5), lValue: 5 } as Partial<WorkspaceState>);
        render(<KAnonymityRules />);
        expect(screen.getAllByText(/l 必須小於 K（目前 K=5、l=5），請把 l 調到 4 以下/).length).toBeGreaterThan(0);
    });
});
