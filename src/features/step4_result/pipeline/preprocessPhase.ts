/**
 * Step4 管線的資料預先處理階段（★ 2026-10-27 最終版後端新增 /api/v1/preprocess）。
 * Step2 有設定清洗步驟或缺失值處理時，於去識別化之前先呼叫一次；之後的去識別化、風險評估、
 * 實用性計算都以清洗後的資料進行。沒有任何設定時回傳 null（不呼叫 API）。
 */
import { runPreprocess, type ApiRequestOptions } from '../../../api/apiService';
import { wrapBackendConfigDocument } from '../../../utils/pipelineConfig';
import { buildPreprocessBlock } from '../../../utils/preprocessConfig';
import type { PreprocessingRule, MissingValueRule } from '../../../store/useWorkspaceStore';

export interface PreprocessPhaseResult {
    /** 清洗後的 CSV 文字（已去除 BOM） */
    csvText: string;
    /** 清洗後的資料檔（送給後續去識別化／風險評估） */
    dataFile: File;
    /** 送給後端的設定檔內容（供除錯與稽核） */
    configObject: Record<string, unknown>;
    /** 處理了幾個欄位、幾個動作 */
    columnCount: number;
    actionCount: number;
}

export const runPreprocessPhase = async (input: {
    columnNames: string[];
    preprocessingRules: Record<string, PreprocessingRule[]> | null | undefined;
    missingValueRules: Record<string, MissingValueRule> | null | undefined;
    datasetFileName: string | null | undefined;
    safeDataFile: File;
    requestOptions: ApiRequestOptions;
}): Promise<PreprocessPhaseResult | null> => {
    const preprocessBlock = buildPreprocessBlock(input.columnNames, input.preprocessingRules, input.missingValueRules);
    if (!preprocessBlock) return null;

    const configObject = wrapBackendConfigDocument(input.datasetFileName, { preprocess: preprocessBlock });
    const configFile = new File([JSON.stringify(configObject)], 'config_preprocess.json', { type: 'application/json' });
    console.log('🔥 傳給後端 (preprocess) 的 JSON Config:', configObject);

    const response = await runPreprocess(input.safeDataFile, configFile, input.requestOptions);
    if (!response.success || !response.data) throw (response.error || new Error('資料前處理 API 請求未成功'));

    const csvText = (await response.data.text()).replace(/^[\uFEFF\u200B]+/, '');
    return {
        csvText,
        dataFile: new File([csvText], 'input_dataset.csv', { type: 'text/csv;charset=utf-8' }),
        configObject,
        columnCount: preprocessBlock.columns.length,
        actionCount: preprocessBlock.columns.reduce((totalCount, columnEntry) => totalCount + columnEntry.actions.length, 0),
    };
};
