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
 * qi_generalization_levels 單一欄位的值：單一整數為固定層級；[最小, 最大] 為層級範圍（後端 2_操作說明.md 4-1 節：
 * 系統評估兩端的落單比例並於報告回報，實際輸出為最小層級那份）。
 * ★ 2026-10-01：先前匯入時取陣列最後一個值（上限），config_kanon.json 的職業 [1, 3] 被當成固定層級 3（全體），
 *   後端實際輸出的卻是層級 1（職類）。改為：level＝最小層級（＝實際輸出，前端各處依此預覽與判斷），
 *   rangeUpper＝最大層級（僅在大於 level 時存在），送出時再組回 [最小, 最大]。
 */
export const normalizeImportedQiLevel = (rawLevelValue: unknown): { level?: number; rangeUpper?: number } => {
    if (typeof rawLevelValue === 'number' && Number.isFinite(rawLevelValue)) return { level: rawLevelValue };
    if (!Array.isArray(rawLevelValue)) return {};
    const numericLevels = rawLevelValue.filter((levelItem): levelItem is number => typeof levelItem === 'number' && Number.isFinite(levelItem));
    if (numericLevels.length === 0) return {};
    const minLevel = Math.min(...numericLevels);
    const maxLevel = Math.max(...numericLevels);
    return maxLevel > minLevel ? { level: minLevel, rangeUpper: maxLevel } : { level: minLevel };
};

/** 組出送給後端的 qi_generalization_levels 值：有大於最小層級的上限時為 [最小, 最大]，否則為單一整數 */
export const buildQiLevelValue = (level: number, rangeUpper: unknown): number | [number, number] =>
    typeof rangeUpper === 'number' && Number.isFinite(rangeUpper) && Math.floor(rangeUpper) > level ? [level, Math.floor(rangeUpper)] : level;

/**
 * 匯入設定檔 columns 底下各欄的 cell_fill_value（值抑制時逐欄填值，後端 config_kanon.yaml 註解）。
 * 只收非空字串；數字等其他型別轉成字串。沒有 columns 時回傳空物件。
 */
export const extractImportedCellFillValues = (importedColumnsBlock: unknown): Record<string, string> => {
    if (!importedColumnsBlock || typeof importedColumnsBlock !== 'object') return {};
    const cellFillValuesByColumn: Record<string, string> = {};
    Object.entries(importedColumnsBlock as Record<string, unknown>).forEach(([columnName, columnConfig]) => {
        const rawFillValue = (columnConfig as { cell_fill_value?: unknown } | null)?.cell_fill_value;
        if (rawFillValue === undefined || rawFillValue === null) return;
        const fillValueText = String(rawFillValue).trim();
        if (fillValueText) cellFillValuesByColumn[columnName.replace(/^[\uFEFF\u200B]+/, '').trim()] = fillValueText;
    });
    return cellFillValuesByColumn;
};

/**
 * ★ 2026-10-28：k_anonymity.algorithm（識別欄位雜湊演算法）正規化：認得 sha256／sha3-256／sha3-512，
 *   其餘或未填一律為後端預設 sha3-256。
 */
export const normalizeKAnonymityHashAlgorithm = (rawAlgorithm: unknown): 'sha256' | 'sha3-256' | 'sha3-512' => {
    const normalizedText = String(rawAlgorithm ?? '').trim().toLowerCase().replace(/_/g, '-');
    if (normalizedText === 'sha256' || normalizedText === 'sha-256') return 'sha256';
    if (normalizedText === 'sha3-512') return 'sha3-512';
    return 'sha3-256';
};
