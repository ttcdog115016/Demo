/** K-匿名設定檔（config_kanon.json）匯入輔助函式，供 Step2 KAnonymityMapping「匯入配置」使用。 */

/**
 * 匯入設定檔的 l／t：值寫入 lValue／tValue，並依設定檔決定 Step3 的「l-多樣性」「t-緊密度」開關。
 * ★ 2026-10-01：先前只寫入數值、不打開開關，匯入含 l／t 的 config_kanon.json 後 Step3 兩個開關仍關閉，
 *   送給後端時也不會帶 l／t（與設定檔不符）。
 *   - 後端格式（頂層 k_anonymity）：有 l／t 就開啟、沒有就關閉——本工具匯出時未啟用即不寫入，
 *     「沒有」即代表不檢測，匯出再匯入結果一致。
 *   - 本工具舊版匯出格式（privacy_targets.k_anonymity 的 l_diversity_value／t_closeness_threshold）：
 *     不論是否啟用都會寫入數值，無法判斷原本是否開啟，只帶入數值、不變更開關。
 */
export const resolveImportedLtSettings = (
    importedKAnonymityBlock: Record<string, unknown>, isBackendFormat: boolean
): { lValue?: number; tValue?: number; enableLDiversity?: boolean; enableTCloseness?: boolean } => {
    const importedLValue = importedKAnonymityBlock.l ?? importedKAnonymityBlock.l_diversity_value;
    const importedTValue = importedKAnonymityBlock.t ?? importedKAnonymityBlock.t_closeness_threshold;
    const isValidNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    return {
        ...(isValidNumber(importedLValue) ? { lValue: importedLValue } : {}),
        ...(isValidNumber(importedTValue) ? { tValue: importedTValue } : {}),
        ...(isBackendFormat ? { enableLDiversity: isValidNumber(importedLValue), enableTCloseness: isValidNumber(importedTValue) } : {})
    };
};

/**
 * qi_generalization_levels 單一欄位的值轉為固定層級。設定檔若寫成陣列（如 config_kanon.json 的職業 [1, 3]），
 * 依後端 2_操作說明.md 4-1 節實際輸出為最小層級，故取最小值；本工具不支援層級範圍，送出時一律為單一整數。
 * ★ 2026-10-01：先前取陣列最後一個值（上限），職業 [1, 3] 被當成層級 3（全體），與後端實際輸出的層級 1（職類）不符。
 */
export const normalizeImportedQiLevel = (rawLevelValue: unknown): number | undefined => {
    if (typeof rawLevelValue === 'number' && Number.isFinite(rawLevelValue)) return rawLevelValue;
    if (!Array.isArray(rawLevelValue)) return undefined;
    const numericLevels = rawLevelValue.filter((levelItem): levelItem is number => typeof levelItem === 'number' && Number.isFinite(levelItem));
    return numericLevels.length > 0 ? Math.min(...numericLevels) : undefined;
};
