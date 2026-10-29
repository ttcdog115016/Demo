// @vitest-environment jsdom
/**
 * ★ 2026-10-21：「開啟檔案」原生視窗開著時不接受拖曳上傳（網頁無法關閉原生視窗，改為擋下並提示）。
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
const messageMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), destroy: vi.fn() }));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    MockApp.useApp = () => ({ message: messageMock, modal: { confirm: vi.fn() }, notification: { error: vi.fn(), warning: vi.fn() } });
    return { ...actual, App: MockApp };
});

import Step1_Upload from '../../features/step1_upload/Step1_Upload';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

const dropFile = (target: Element) => {
    const file = new File(['a,b\n1,2\n'], 'test.csv', { type: 'text/csv' });
    fireEvent.drop(target, { dataTransfer: { files: [file], items: [], types: ['Files'] } });
};

describe('Step1 上傳：選檔視窗開著時不接受拖曳', () => {
    afterEach(() => { cleanup(); vi.restoreAllMocks(); messageMock.warning.mockClear(); });

    it('點上傳區（開出選檔視窗）後、頁面沒有焦點時拖曳 → 擋下並提示；頁面重新取得焦點後即可拖曳', () => {
        useWorkspaceStore.setState({ dataFile: null, columns: [], previewData: [] } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        render(<Step1_Upload />);
        const guard = screen.getByTestId('step1-upload-drop-guard');
        const dropZone = guard.querySelector('.ant-upload') as Element;
        // 原生選檔視窗開啟時不觸發真正的 input.click
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
        fireEvent.click(dropZone);

        const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        dropFile(dropZone);
        expect(messageMock.warning).toHaveBeenCalledTimes(1);

        // 視窗關閉 → window focus → 清除標記
        hasFocusSpy.mockReturnValue(true);
        fireEvent.focus(window);
        messageMock.warning.mockClear();
        dropFile(dropZone);
        expect(messageMock.warning).not.toHaveBeenCalled();
    });

    it('沒點過上傳區時直接拖曳不受影響', () => {
        render(<Step1_Upload />);
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        dropFile(screen.getByTestId('step1-upload-drop-guard').querySelector('.ant-upload') as Element);
        expect(messageMock.warning).not.toHaveBeenCalled();
    });
});
