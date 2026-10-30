/**
 * 檔案名稱 (File): DesktopDownloadNotifier.tsx
 * 模組功能 (Description): 單機版 App（pywebview＋WebView2）的下載通知。
 *
 * ★ 2026-10-30：WebView2 內建下載視窗在大檔完成後仍停在「0 B/秒 - 187 MB 的 187 MB」且不會自己關閉。
 *   launcher.py 改為隱藏內建視窗，把下載進度與結果呼叫 window.__openPetsDownload 送過來；這裡以右上角通知顯示，
 *   完成後數秒自動關閉（比照 Chrome），可「開啟資料夾」。瀏覽器版不會收到此事件，不影響。
 */
import { useEffect } from 'react';
import { App as AntdApp, Button, Progress } from 'antd';
import { useTranslation } from 'react-i18next';

export const DOWNLOAD_COMPLETED_AUTO_CLOSE_SECONDS = 4;

export interface DesktopDownloadEvent
{
    id: string;
    fileName: string;
    path: string;
    state: 'progress' | 'completed' | 'interrupted';
    received: number;
    total: number | null;
    reason?: string;
}

interface PywebviewWindow
{
    __openPetsDownload?: (downloadEvent: DesktopDownloadEvent) => void;
    pywebview?: { api?: { reveal_file?: (path: string) => Promise<boolean> } };
}

const formatMegabytes = (byteCount: number): string => `${(byteCount / (1024 * 1024)).toFixed(1)} MB`;

export default function DesktopDownloadNotifier(): null
{
    const { notification: notificationApi } = AntdApp.useApp();
    const { t: translate } = useTranslation();

    useEffect(() =>
    {
        const desktopWindow = window as unknown as PywebviewWindow;
        const revealFile = (path: string): void => { void desktopWindow.pywebview?.api?.reveal_file?.(path); };

        desktopWindow.__openPetsDownload = (downloadEvent: DesktopDownloadEvent) =>
        {
            const notificationKey = `desktop-download-${downloadEvent.id}`;
            if (downloadEvent.state === 'progress')
            {
                const percentValue = downloadEvent.total ? Math.min(100, Math.floor((downloadEvent.received / downloadEvent.total) * 100)) : 0;
                notificationApi.open({
                    key: notificationKey,
                    placement: 'topRight',
                    duration: 0,
                    title: translate('download.in_progress', { name: downloadEvent.fileName, defaultValue: `正在下載 ${downloadEvent.fileName}` }),
                    description: (
                        <>
                            <Progress percent={percentValue} size="small" status="active" />
                            <span>{formatMegabytes(downloadEvent.received)}{downloadEvent.total ? ` / ${formatMegabytes(downloadEvent.total)}` : ''}</span>
                        </>
                    ),
                });
                return;
            }
            if (downloadEvent.state === 'completed')
            {
                notificationApi.success({
                    key: notificationKey,
                    placement: 'topRight',
                    duration: DOWNLOAD_COMPLETED_AUTO_CLOSE_SECONDS,
                    title: translate('download.completed', { name: downloadEvent.fileName, defaultValue: `已下載 ${downloadEvent.fileName}` }),
                    description: translate('download.saved_to', { path: downloadEvent.path, defaultValue: `已儲存至 ${downloadEvent.path}` }),
                    actions: desktopWindow.pywebview?.api?.reveal_file
                        ? <Button size="small" onClick={() => revealFile(downloadEvent.path)}>{translate('download.open_folder', '開啟資料夾')}</Button>
                        : undefined,
                });
                return;
            }
            notificationApi.error({
                key: notificationKey,
                placement: 'topRight',
                duration: 0,
                title: translate('download.interrupted', { name: downloadEvent.fileName, defaultValue: `下載失敗：${downloadEvent.fileName}` }),
                description: translate('download.interrupted_reason', { reason: downloadEvent.reason || '', defaultValue: `原因：${downloadEvent.reason || '未知'}，請再下載一次。` }),
            });
        };

        return () => { delete desktopWindow.__openPetsDownload; };
    }, [notificationApi, translate]);

    return null;
}
