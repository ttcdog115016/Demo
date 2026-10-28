/**
 * 檔案用途: Step2「匯入設定檔」讀到後端 preprocess 區塊時，寫入工作區並顯示提示（K-匿名、差分隱私兩頁共用）。
 * ★ 2026-10-28：支援單一入口 config_preprocess.json、統合版 config_範例_JSON統合版.json（見 utils/preprocessConfigImport.ts）。
 */
import type { MessageInstance } from 'antd/es/message/interface';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { describePreprocessImport, type PreprocessImportForDataset } from '../../utils/preprocessConfigImport';

const IMPORT_WARNING_DURATION_SECONDS = 8;

/**
 * 函數名稱: applyPreprocessImportToWorkspace
 * 函數功能: 以設定檔內容取代工作區的清洗步驟與缺失值處理（區塊未啟用時不變更），並顯示提示。
 *   isPreprocessOnly 為 true（純前處理設定檔）時以「成功」呈現，否則以「資訊」附在欄位設定的匯入結果旁。
 */
export const applyPreprocessImportToWorkspace = (importResult: PreprocessImportForDataset, messageApi: MessageInstance, isPreprocessOnly: boolean): void =>
{
	if (!importResult.disabled)
	{
		useWorkspaceStore.setState({ preprocessingRules: importResult.preprocessingRules, missingValueRules: importResult.missingValueRules });
	}
	const { summary, warnings } = describePreprocessImport(importResult);
	if (importResult.disabled) messageApi.warning(summary);
	else if (isPreprocessOnly) messageApi.success(summary);
	else messageApi.info(summary);
	warnings.forEach((warningText) => messageApi.warning(warningText, IMPORT_WARNING_DURATION_SECONDS));
};
