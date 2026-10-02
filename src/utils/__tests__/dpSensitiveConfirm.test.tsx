// @vitest-environment jsdom
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App as AntdApp } from 'antd';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// 帶 {{變數}} 代換的翻譯替身
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: unknown, interpolation?: Record<string, unknown>) => {
            const template = typeof fallback === 'string' ? fallback : key;
            return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(interpolation?.[name] ?? ''));
        }
    })
}));
// 各步驟頁面與本測試無關，以空元件替代
vi.mock('../../features/step1_upload/Step1_Upload', () => ({ default: () => null }));
vi.mock('../../features/step2_mapping/Step2_Mapping', () => ({ default: () => null }));
vi.mock('../../features/step3_rules/Step3_Rules', () => ({ default: () => null }));
vi.mock('../../features/step4_result/Step4_Result', () => ({ default: () => null }));

import MainLayout from '../../features/workspace/MainLayout';
import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';

const categoricalField = (id: string, fieldName: string, overrides: Partial<DPField> = {}): DPField => ({
    id, fieldName, fieldType: 'Categorical', enabled: true, mode: 'epsilon', epsilon: 1, delta: 0, allowedCategories: 'auto_extracted', ...overrides
});

const renderAtStep2 = (dpFields: DPField[]) => {
    useWorkspaceStore.setState({
        currentStep: 1, columns: dpFields.map((field) => field.fieldName), privacyMode: 'differential-privacy', dpFields, isStepValid: true, stepErrorMessage: null
    } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    return render(<MemoryRouter><AntdApp><MainLayout /></AntdApp></MemoryRouter>);
};

const clickNext = () => fireEvent.click(screen.getByText(/下一步/));

describe('DP Step2 按「下一步」：未點選敏感欄位時跳出確認視窗', () => {
    afterEach(() => { cleanup(); document.body.innerHTML = ''; });

    it('未點選：列出將輪流評估的類別型欄位；按「返回點選」留在 Step2', async () => {
        renderAtStep2([categoricalField('a', '地區'), categoricalField('b', '職業')]);
        clickNext();
        const dialog = await screen.findByTestId('dp-sensitive-confirm');
        expect(dialog.textContent).toContain('2 個類別型欄位');
        expect(dialog.textContent).toContain('「地區」、「職業」');
        fireEvent.click(screen.getByText('返回點選'));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(useWorkspaceStore.getState().currentStep).toBe(1);
    });

    it('未點選：按「仍要繼續」進入 Step3', async () => {
        renderAtStep2([categoricalField('a', '地區'), categoricalField('b', '職業')]);
        clickNext();
        fireEvent.click(await screen.findByText('仍要繼續（自動輪流評估）'));
        await waitFor(() => expect(useWorkspaceStore.getState().currentStep).toBe(2));
    });

    it('已點選敏感欄位：不跳視窗，直接進入 Step3', async () => {
        renderAtStep2([categoricalField('a', '地區'), categoricalField('b', '疾病', { enabled: false, isRiskSensitive: true })]);
        clickNext();
        await waitFor(() => expect(useWorkspaceStore.getState().currentStep).toBe(2));
        expect(screen.queryByTestId('dp-sensitive-confirm')).toBeNull();
    });
});
