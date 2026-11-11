// @vitest-environment jsdom
import { render, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});

const stableTranslation = vi.hoisted(() => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key))
}));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));
const notificationMock = vi.hoisted(() => ({ open: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    return { ...actual, App: { useApp: () => ({ notification: notificationMock }) } };
});

import DesktopDownloadNotifier, { DOWNLOAD_COMPLETED_AUTO_CLOSE_SECONDS, type DesktopDownloadEvent } from '../../features/workspace/DesktopDownloadNotifier';

type DesktopWindow = Window & { __openPetsDownload?: (downloadEvent: DesktopDownloadEvent) => void; pywebview?: unknown };

const baseEvent: DesktopDownloadEvent = { id: 'd1', fileName: 'deidentified_dataset_1.csv', path: 'C:\\Users\\me\\Downloads\\deidentified_dataset_1.csv', state: 'progress', received: 50 * 1024 * 1024, total: 200 * 1024 * 1024 };

describe('單機版下載通知（2026-10-30 取代 WebView2 內建下載視窗）', () => {
    afterEach(() => { cleanup(); vi.clearAllMocks(); delete (window as DesktopWindow).pywebview; });

    it('掛載後註冊 window.__openPetsDownload，卸載後移除', () => {
        const { unmount } = render(<DesktopDownloadNotifier />);
        expect(typeof (window as DesktopWindow).__openPetsDownload).toBe('function');
        unmount();
        expect((window as DesktopWindow).__openPetsDownload).toBeUndefined();
    });

    it('進行中 → 完成：同一個 key 更新，完成後數秒自動關閉並可開啟資料夾', () => {
        const revealFile = vi.fn().mockResolvedValue(true);
        (window as DesktopWindow).pywebview = { api: { reveal_file: revealFile } };
        render(<DesktopDownloadNotifier />);
        act(() => (window as DesktopWindow).__openPetsDownload!(baseEvent));
        expect(notificationMock.open).toHaveBeenCalledWith(expect.objectContaining({ key: 'desktop-download-d1', duration: 0 }));

        act(() => (window as DesktopWindow).__openPetsDownload!({ ...baseEvent, state: 'completed', received: baseEvent.total! }));
        const completedOptions = notificationMock.success.mock.calls[0][0];
        expect(completedOptions).toMatchObject({ key: 'desktop-download-d1', duration: DOWNLOAD_COMPLETED_AUTO_CLOSE_SECONDS });
        expect(String(completedOptions.description)).toContain(baseEvent.path);

        const { getByText } = render(<>{completedOptions.actions}</>);
        getByText('開啟資料夾').click();
        expect(revealFile).toHaveBeenCalledWith(baseEvent.path);
    });

    it('中斷時顯示錯誤，不自動關閉；瀏覽器版（沒有 pywebview）完成通知不顯示開啟資料夾', () => {
        render(<DesktopDownloadNotifier />);
        act(() => (window as DesktopWindow).__openPetsDownload!({ ...baseEvent, state: 'interrupted', reason: 'FileNoSpace' }));
        expect(notificationMock.error).toHaveBeenCalledWith(expect.objectContaining({ key: 'desktop-download-d1', duration: 0 }));
        expect(String(notificationMock.error.mock.calls[0][0].description)).toContain('FileNoSpace');

        act(() => (window as DesktopWindow).__openPetsDownload!({ ...baseEvent, id: 'd2', state: 'completed' }));
        expect(notificationMock.success.mock.calls[0][0].actions).toBeUndefined();
    });
});
