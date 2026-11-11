/**
 * ============================================================================
 * 檔案名稱 (File): datasetFieldConsistency.ts
 * 模組功能 (Description): Step2「隱私強化技術設定」欄位清單與 Step1 上傳資料欄位之一致性比對。
 *   - 設定中有、資料中沒有的欄位 (findFieldsNotInDataset)：阻擋下一步。
 *     K-匿名：Step4 組設定檔時只取資料實際欄位，這些欄位會被默默丟掉，但 Step2 的敏感欄位數、
 *     QI 判斷仍把它們算進去，導致畫面設定與實際送出不一致。
 *     差分隱私：已啟用的欄位會原樣送出，後端回「欄位 'X' 不存在於提供的資料中」。
 *   - 資料中有、設定中沒有的欄位 (findDatasetColumnsNotConfigured)：僅提醒，不阻擋
 *     (K-匿名視為非敏感欄位原樣保留；差分隱私視為不加噪)。
 *   比對前一律去除 BOM／零寬字元與前後空白，與 Step4 (utils/pipelineConfig.ts) 的比對方式一致。
 * 專案名稱 (Project): Privacy Protection Toolkit
 * ============================================================================
 */

/**
 * 函數名稱: normalizeDatasetColumnName
 * 函數功能: 去除欄位名稱開頭之 BOM／零寬空白與前後空白，作為比對用鍵值。
 */
export const normalizeDatasetColumnName = (rawColumnName: unknown): string =>
    String(rawColumnName ?? '').replace(/^[\uFEFF\u200B]+/, '').trim();

/**
 * 函數名稱: buildDatasetColumnNameSet
 * 函數功能: 將資料欄位清單轉為正規化後之 Set，供快速比對。
 */
export const buildDatasetColumnNameSet = (datasetColumnNamesList: readonly string[] | null | undefined): Set<string> =>
    new Set((datasetColumnNamesList || []).map(normalizeDatasetColumnName).filter((columnName) => columnName !== ''));

/**
 * 函數名稱: isFieldNameInDataset
 * 函數功能: 判斷單一設定欄位名稱是否存在於資料中。資料欄位清單為空 (尚未上傳) 時一律視為存在，不做比對。
 */
export const isFieldNameInDataset = (fieldName: unknown, datasetColumnNameSet: Set<string>): boolean =>
    datasetColumnNameSet.size === 0 || datasetColumnNameSet.has(normalizeDatasetColumnName(fieldName));

/**
 * 函數名稱: findFieldsNotInDataset
 * 函數功能: 列出設定欄位中「名稱非空白、但資料中不存在」的欄位名稱 (去重、保留原順序)。
 */
export const findFieldsNotInDataset = (configuredFieldNamesList: readonly unknown[], datasetColumnNamesList: readonly string[] | null | undefined): string[] =>
{
    const datasetColumnNameSet = buildDatasetColumnNameSet(datasetColumnNamesList);
    if (datasetColumnNameSet.size === 0) return [];
    const missingFieldNamesList: string[] = [];
    configuredFieldNamesList.forEach((rawFieldName) =>
    {
        const normalizedFieldName = normalizeDatasetColumnName(rawFieldName);
        if (normalizedFieldName !== '' && !datasetColumnNameSet.has(normalizedFieldName) && !missingFieldNamesList.includes(normalizedFieldName))
        {
            missingFieldNamesList.push(normalizedFieldName);
        }
    });
    return missingFieldNamesList;
};

/**
 * 函數名稱: countBlankFieldNames
 * 函數功能: 計算名稱為空白 (尚未選擇欄位) 的設定列數。
 */
export const countBlankFieldNames = (configuredFieldNamesList: readonly unknown[]): number =>
    configuredFieldNamesList.filter((rawFieldName) => normalizeDatasetColumnName(rawFieldName) === '').length;

/**
 * 函數名稱: findDatasetColumnsNotConfigured
 * 函數功能: 列出資料中存在、但設定清單尚未涵蓋的欄位 (回傳資料中的原始欄位名稱，依資料欄位順序)。
 */
export const findDatasetColumnsNotConfigured = (configuredFieldNamesList: readonly unknown[], datasetColumnNamesList: readonly string[] | null | undefined): string[] =>
{
    const configuredFieldNameSet = new Set(configuredFieldNamesList.map(normalizeDatasetColumnName));
    return (datasetColumnNamesList || []).filter((columnName) =>
    {
        const normalizedColumnName = normalizeDatasetColumnName(columnName);
        return normalizedColumnName !== '' && !configuredFieldNameSet.has(normalizedColumnName);
    });
};

/**
 * 函數名稱: describeFieldsNotInDatasetError
 * 函數功能: 產生「設定欄位不存在於資料中」之統一錯誤訊息 (Step2 頁面與 validateProgression 共用)。
 */
export const describeFieldsNotInDatasetError = (missingFieldNamesList: readonly string[]): string =>
    `以下欄位不在上傳的資料中：${missingFieldNamesList.map((fieldName) => `「${fieldName}」`).join('、')}。` +
    '可能是匯入的設定檔或手動新增的欄位，請點「移除不存在的欄位」或逐列刪除後再進入下一步。';

/**
 * 函數名稱: describeBlankFieldNamesError
 * 函數功能: 產生「有設定列尚未選擇欄位」之統一錯誤訊息。
 */
export const describeBlankFieldNamesError = (blankFieldCount: number): string =>
    `有 ${blankFieldCount} 列尚未選擇欄位名稱，請選擇欄位或刪除該列後再進入下一步。`;
