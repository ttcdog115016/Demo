// @vitest-environment jsdom
/**
 * ★ 2026-10-07 QA 回饋：Step2 匯入旁加上「匯出設定檔」，內容與 Step3 下載相同。
 */
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key)) }),
}));
const messageMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    MockApp.useApp = () => ({ message: messageMock });
    return { ...actual, App: MockApp };
});

import ConfigFileButtons from '../../features/step2_mapping/ConfigFileButtons';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { pickPreviewSampleValue, countMissingInPreviewRows } from '../preprocessPreviewSample';

describe('Step2 匯入／匯出設定檔按鈕', () => {
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it('匯入與匯出並排；按匯出會下載 JSON', () => {
        useWorkspaceStore.setState({ privacyMode: 'k-anonymity', columns: ['年齡'], kAnonymityFields: [] } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        const createObjectURL = vi.fn(() => 'blob:x');
        Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        render(<ConfigFileButtons onImportFileChange={vi.fn()} />);
        expect(screen.getByText('匯入設定檔')).toBeTruthy();
        fireEvent.click(screen.getByTestId('step2-export-config'));
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(messageMock.success).toHaveBeenCalled();
    });

    it('未選模式時不下載並提示', () => {
        useWorkspaceStore.setState({ privacyMode: null } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        messageMock.error.mockClear();
        render(<ConfigFileButtons onImportFileChange={vi.fn()} />);
        fireEvent.click(screen.getByTestId('step2-export-config'));
        expect(messageMock.error).toHaveBeenCalled();
    });

    it('預覽樣本：取第一個非空值、計算空值筆數', () => {
        const rows = [{ a: ' ' }, { a: null }, { a: 'x' }, {}];
        expect(pickPreviewSampleValue(rows, 'a')).toBe('x');
        expect(countMissingInPreviewRows(rows, 'a')).toBe(3);
        expect(pickPreviewSampleValue([{ a: '' }], 'a')).toBeUndefined();
    });
});
