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
import { listDpFieldsWithBoundsFinerThanNoiseUnit } from '../dpFieldHelpers';

const birthdayField = (overrides: Partial<DPField> = {}): DPField => ({
    id: 'b', fieldName: '生日', fieldType: 'Numeric', enabled: true, mode: 'epsilon', epsilon: 1, delta: 0, isDateTime: true,
    noiseStep: 7, sensitivity: 365, lowerBound: '1930-01-01', upperBound: '2026-12-31 23:59:59', ...overrides
});

const renderAtStep3 = (dpFields: DPField[]) => {
    useWorkspaceStore.setState({
        currentStep: 2, columns: ['生日'], privacyMode: 'differential-privacy', dpFields, isStepValid: true, stepErrorMessage: null
    } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    return render(<MemoryRouter><AntdApp><MainLayout /></AntdApp></MemoryRouter>);
};

const clickNext = () => fireEvent.click(screen.getByText(/下一步/));
const birthday = () => useWorkspaceStore.getState().dpFields.find((field) => field.fieldName === '生日')!;

describe('Step3 按「下一步」：日期欄位雜訊單位比上下限粗時跳出提醒視窗', () => {
    afterEach(() => { cleanup(); document.body.innerHTML = ''; });

    it('邊界到秒、雜訊單位為天：跳出視窗，列出欄位；按「返回修改」留在 Step3', async () => {
        renderAtStep3([birthdayField()]);
        clickNext();
        const dialog = await screen.findByTestId('dp-noise-unit-confirm');
        expect(dialog.textContent).toContain('「生日」：上下限細到「秒」，雜訊單位為「天」');
        fireEvent.click(screen.getByText('返回修改'));
        // jsdom 沒有轉場動畫結束事件，視窗節點會留在 DOM；以「沒有前往 Step4、設定未變」驗證
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(useWorkspaceStore.getState().currentStep).toBe(2);
        expect(birthday().noiseUnit).toBeUndefined();
    });

    it('按「改為與上下限相同的單位並繼續」：雜訊單位改為秒、敏感度 365 天換算為秒，進入 Step4', async () => {
        renderAtStep3([birthdayField()]);
        clickNext();
        fireEvent.click(await screen.findByText('改為與上下限相同的單位並繼續'));
        await waitFor(() => expect(useWorkspaceStore.getState().currentStep).toBe(3));
        expect(birthday()).toMatchObject({ noiseUnit: 'second', sensitivity: 365 * 86400 });
    });

    it('按「維持目前設定繼續」：設定不變，進入 Step4', async () => {
        renderAtStep3([birthdayField()]);
        clickNext();
        fireEvent.click(await screen.findByText('維持目前設定繼續'));
        await waitFor(() => expect(useWorkspaceStore.getState().currentStep).toBe(3));
        expect(birthday()).toMatchObject({ sensitivity: 365 });
        expect(birthday().noiseUnit).toBeUndefined();
    });

    it('邊界只有日期，或雜訊單位已夠細：不跳視窗，直接進入 Step4', async () => {
        renderAtStep3([birthdayField({ upperBound: '2026-12-31' })]);
        clickNext();
        await waitFor(() => expect(useWorkspaceStore.getState().currentStep).toBe(3));
        expect(screen.queryByTestId('dp-noise-unit-confirm')).toBeNull();

        cleanup();
        renderAtStep3([birthdayField({ noiseUnit: 'second' })]);
        clickNext();
        await waitFor(() => expect(useWorkspaceStore.getState().currentStep).toBe(3));
        expect(screen.queryByTestId('dp-noise-unit-confirm')).toBeNull();
    });

    it('清單只含已啟用的日期欄位', () => {
        expect(listDpFieldsWithBoundsFinerThanNoiseUnit([
            birthdayField(),
            birthdayField({ id: 'c', fieldName: '入院', enabled: false }),
            { id: 'a', fieldName: '年齡', fieldType: 'Numeric', enabled: true, lowerBound: 0, upperBound: 120 }
        ])).toEqual([{ fieldId: 'b', fieldName: '生日', boundsUnit: 'second', noiseUnit: 'day' }]);
    });
});
