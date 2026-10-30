/**
 * ============================================================================
 * 檔案名稱 (File): configExport.ts
 * 模組功能 (Description): 依目前工作區設定下載設定檔（JSON），格式與 Step4 實際送給後端、Step3「下載設定檔」相同，
 *                         可再由 Step2「匯入設定檔」讀回。
 * ============================================================================
 * ★ 2026-10-07 QA 回饋：Step2 有「匯入配置」，但操作完要匯出時找不到匯出功能（只在 Step3 頁首）。
 *   抽出共用下載函式，讓 Step2 的匯入按鈕旁也能直接匯出。
 */
import { buildBackendConfigDocumentFromWorkspace } from './pipelineConfig';
import { triggerBlobDownload } from './blobDownload';
import type { useWorkspaceStore } from '../store/useWorkspaceStore';

type WorkspaceSnapshot = ReturnType<typeof useWorkspaceStore.getState>;

export type ConfigDownloadResult = 'ok' | 'no_mode' | 'failed';

/** 組出設定檔並觸發瀏覽器下載；檔名 final_privacy_config_<時間戳>.json 與 Step3 相同 */
export const downloadWorkspaceConfigJson = (workspaceSnapshot: WorkspaceSnapshot): ConfigDownloadResult => {
    const configDocument = buildBackendConfigDocumentFromWorkspace(workspaceSnapshot);
    if (!configDocument) return 'no_mode';
    try {
        const jsonBlob = new Blob([JSON.stringify(configDocument, null, 2)], { type: 'application/json' });
        triggerBlobDownload(jsonBlob, `final_privacy_config_${Date.now()}.json`);
        return 'ok';
    } catch (downloadError) {
        console.error('Export error:', downloadError);
        return 'failed';
    }
};
