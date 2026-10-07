/**
 * ============================================================================
 * 檔案名稱 (File): ApiErrorWatcher.tsx
 * 模組功能 (Description): 全域「API 錯誤即時提示」元件。
 *
 * 背景：外部測試人員回報「有嚴重 bug」時，團隊常常只能看到後端 log 的 HTTP 狀態碼
 * (如 400 Bad Request)，看不到當下實際的錯誤代碼／訊息／送出的設定內容，也無法
 * 得知測試人員當下究竟做了什麼操作，導致每次都要花很多時間來回確認。
 *
 * 這個元件掛載一次後即會持續訂閱 apiErrorLogger 的錯誤紀錄事件 (實際攔截邏輯在
 * apiErrorInterceptor.ts)：只要全站任何一支 API 呼叫失敗，就會立即彈出提示，
 * 讓測試人員可以「複製本次錯誤內容」直接貼到聊天室回報，或「下載完整診斷紀錄」
 * 附檔回報，不需要另外開發者工具查看，也不需要事後回想剛剛做了什麼操作。
 *
 * 使用方式：於 App.tsx 的 InnerApp (已被 <AntdApp> 包裹) 內渲染一次即可，不需傳入
 * 任何 props；本身不渲染任何可見畫面內容 (回傳 null)，僅負責訂閱與彈出提示。
 * ============================================================================
 */
import { useEffect } from 'react';
import { App as AntdApp, Button, Space } from 'antd';
import { useTranslation } from 'react-i18next';

import {
    subscribeToApiErrorLogs,
    downloadAllApiErrorLogsAsFile,
    formatApiErrorLogEntryAsReadableText,
    type ApiErrorLogEntry,
} from '../utils/apiErrorLogger';

import { scaleFontSize } from '../utils/fontScale';
// 提示訊息顯示時間過短會來不及點擊按鈕操作，過長則干擾使用者持續操作，取一個折衷值 (秒)
const ERROR_NOTIFICATION_AUTO_CLOSE_SECONDS = 12;

/**
 * 函數名稱: copyTextToClipboardSafely
 * 函數功能: 嘗試複製文字到剪貼簿；部分瀏覽器情境 (非 HTTPS、權限被拒) 下
 *           navigator.clipboard 可能不存在或呼叫失敗，此時安全地回傳 false，
 *           讓呼叫端可以改用其他方式提示使用者，而不是讓整個操作出現例外中斷。
 */
const copyTextToClipboardSafely = async (textContentToCopy: string): Promise<boolean> => {
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(textContentToCopy);
            return true;
        }
    } catch (clipboardWriteErrorObj) {
        console.warn('複製診斷內容至剪貼簿失敗:', clipboardWriteErrorObj);
    }
    return false;
};

export const ApiErrorWatcher = (): null => {
    const { notification: globalNotificationApi, message: globalMessageApi } = AntdApp.useApp();
    const { t: translate } = useTranslation();

    useEffect(() => {
        const unsubscribeFromApiErrorLogsFn = subscribeToApiErrorLogs((newLogEntryObj: ApiErrorLogEntry) => {
            const handleCopyButtonClick = async (): Promise<void> => {
                const didCopySucceed = await copyTextToClipboardSafely(formatApiErrorLogEntryAsReadableText(newLogEntryObj));
                if (didCopySucceed) {
                    globalMessageApi.success(
                        translate('apiErrorWatcher.copy_success', '已複製診斷內容，請貼上回報給開發團隊')
                    );
                } else {
                    globalMessageApi.warning(
                        translate('apiErrorWatcher.copy_failed', '複製失敗，請改用「下載完整紀錄」按鈕匯出檔案回報')
                    );
                }
            };

            const handleDownloadButtonClick = (): void => {
                downloadAllApiErrorLogsAsFile();
                globalMessageApi.success(
                    translate('apiErrorWatcher.download_success', '已下載診斷紀錄檔案，請將檔案傳給開發團隊')
                );
            };

            const errorSummaryLineText = [
                newLogEntryObj.httpStatus ? `HTTP ${newLogEntryObj.httpStatus}` : undefined,
                newLogEntryObj.errorCode,
            ].filter(Boolean).join(' · ');

            globalNotificationApi.error({
                message: translate('apiErrorWatcher.title', 'API 呼叫發生錯誤'),
                description: (
                    <div>
                        <div style={{ marginBottom: 8, wordBreak: 'break-all' }}>
                            {errorSummaryLineText && <div style={{ fontWeight: 'bold' }}>{errorSummaryLineText}</div>}
                            <div>{newLogEntryObj.message || translate('apiErrorWatcher.no_message', '(無詳細訊息)')}</div>
                            <div style={{ fontSize: scaleFontSize(12), color: '#8c8c8c', marginTop: 4 }}>
                                {newLogEntryObj.method} {newLogEntryObj.url}
                            </div>
                        </div>
                        <Space>
                            <Button size="small" onClick={handleCopyButtonClick}>
                                {translate('apiErrorWatcher.copy_button', '複製本次錯誤內容')}
                            </Button>
                            <Button size="small" onClick={handleDownloadButtonClick}>
                                {translate('apiErrorWatcher.download_button', '下載完整診斷紀錄')}
                            </Button>
                        </Space>
                    </div>
                ),
                duration: ERROR_NOTIFICATION_AUTO_CLOSE_SECONDS,
                placement: 'bottomRight',
            });
        });

        return unsubscribeFromApiErrorLogsFn;
    }, [globalNotificationApi, globalMessageApi, translate]);

    return null;
};

export default ApiErrorWatcher;
