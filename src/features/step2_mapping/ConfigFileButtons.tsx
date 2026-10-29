/**
 * ============================================================================
 * 檔案名稱 (File): ConfigFileButtons.tsx
 * 模組功能 (Description): Step2 欄位設定頁右上角「匯入設定檔／匯出設定檔」按鈕組（K-匿名、差分隱私共用）。
 * ============================================================================
 * ★ 2026-10-07 QA 回饋：只有「匯入配置」一顆按鈕，設定完成後找不到匯出。改為兩顆按鈕並排（Space.Compact），
 *   匯出與 Step3「下載設定檔」相同內容（utils/configExport.ts）。匯入仍由各頁自己的 handleImportJSON 處理。
 * ★ 2026-10-29：匯入可選 .json／.yaml／.yml（YAML 解析見 utils/configFileParse.ts）；匯出維持 JSON。
 */
import React, { useRef } from 'react';
import { Button, Space, Tooltip, App as AntdApp } from 'antd';
import { UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { downloadWorkspaceConfigJson } from '../../utils/configExport';
import { CONFIG_FILE_ACCEPT } from '../../utils/configFileParse';

interface ConfigFileButtonsProps
{
    onImportFileChange: (fileChangeEvent: React.ChangeEvent<HTMLInputElement>) => void; // 選好檔案後的匯入處理
    fileInputRef?: React.RefObject<HTMLInputElement | null>;                          // 呼叫端既有的 file input ref（匯入後清空用）
}

export default function ConfigFileButtons({ onImportFileChange, fileInputRef }: ConfigFileButtonsProps): React.ReactElement
{
    const { t: translate } = useTranslation();
    const { message: messageApi } = AntdApp.useApp();
    const fallbackFileInputRef = useRef<HTMLInputElement>(null);
    const effectiveFileInputRef = fileInputRef ?? fallbackFileInputRef;

    const handleExportClick = (): void =>
    {
        const downloadResult = downloadWorkspaceConfigJson(useWorkspaceStore.getState());
        if (downloadResult === 'ok') messageApi.success(translate('step3.msg_export_success', '已下載設定檔'));
        else if (downloadResult === 'no_mode') messageApi.error(translate('step3.msg_export_no_mode', '尚未選擇隱私保護模式，無法匯出設定檔'));
        else messageApi.error(translate('step3.msg_export_failed', '匯出失敗，請再試一次'));
    };

    return (
        <Space.Compact data-testid="step2-config-file-buttons">
            <input type="file" accept={CONFIG_FILE_ACCEPT} data-testid="step2-import-config-input" ref={effectiveFileInputRef} onChange={onImportFileChange} onClick={(clickEvent) => { (clickEvent.target as HTMLInputElement).value = ''; }} style={{ display: 'none' }} />
            <Tooltip title={translate('step2.btn_import_tip_v2', '讀入先前下載的設定檔，套用到目前欄位（支援 JSON 與 YAML 統合版設定檔）')}>
                <Button icon={<UploadOutlined />} onClick={() => effectiveFileInputRef.current?.click()}>{translate('step2.btn_import_v2', '匯入設定檔')}</Button>
            </Tooltip>
            <Tooltip title={translate('step2.btn_export_tip', '下載目前的設定，下次可直接匯入')}>
                <Button icon={<DownloadOutlined />} onClick={handleExportClick} data-testid="step2-export-config">{translate('step2.btn_export_v2', '匯出設定檔')}</Button>
            </Tooltip>
        </Space.Compact>
    );
}
