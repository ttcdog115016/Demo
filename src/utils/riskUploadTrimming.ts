/**
 * 風險評估上傳瘦身（2026-10-06）
 *
 * 三攻擊（/risk/k-anonymity、/risk/dp）與 CAP（/risk/cap）只會用到「間接識別＋敏感」欄位
 * （以及風險評估對象族群 subgroup 用到的欄位），但原本每一輪都上傳完整 CSV，
 * 姓名、身分證、備註等用不到的欄位也一起送出；敏感欄位有 N 個時，同一份資料會被上傳 2N 次以上。
 * 這裡在送出前把 CSV 裁成只剩會用到的欄位，大幅減少經過 cloudflared 通道的傳輸量。
 *
 * 後端規則（2_操作說明.md）：設定檔宣告的欄位必須存在於資料中，否則回報找不到對應欄位。
 * 因此 K-匿名送風險評估的 k_anonymity 區塊也要一併只保留這些欄位（pruneKAnonymityBlockToColumns）。
 * 被拿掉的只有直接識別與非敏感欄位，不影響等價類分組、抑制與 l/t 檢測，風險分數應與裁切前相同。
 *
 * 若日後發現後端結果有差異，把 ENABLE_RISK_UPLOAD_COLUMN_TRIMMING 改為 false 即恢復上傳完整 CSV。
 */
import Papa from 'papaparse';

export const ENABLE_RISK_UPLOAD_COLUMN_TRIMMING = true;

const cleanColumnName = (rawName: string): string => rawName.replace(/^[\uFEFF\u200B]+/, '').trim();

export interface CsvColumnProjectionResult {
    csvText: string;
    keptColumnNames: string[];
    droppedColumnNames: string[];
}

/**
 * 只保留 keepColumnNames 中的欄位（以去除 BOM／前後空白後的欄名比對），欄位順序維持原檔順序。
 * 沒有任何欄位要拿掉、或對得到的保留欄位少於 2 個時，原文照回（不冒險送出空資料或改變筆數）。
 */
export const projectCsvTextToColumns = (csvText: string, keepColumnNames: Iterable<string>): CsvColumnProjectionResult => {
    const keepColumnNameSet = new Set(Array.from(keepColumnNames, cleanColumnName));
    const hasLeadingBomStatus = csvText.charCodeAt(0) === 0xFEFF;
    const csvBodyText = hasLeadingBomStatus ? csvText.slice(1) : csvText;

    // 只解析第一列取得欄名，不需要保留的情況可以免掉整份解析
    const headerRowList = (Papa.parse<string[]>(csvBodyText, { preview: 1 }).data[0] || []) as string[];
    const keptIndexList: number[] = [];
    const keptColumnNames: string[] = [];
    const droppedColumnNames: string[] = [];
    headerRowList.forEach((rawHeaderName, columnIndex) => {
        const cleanHeaderName = cleanColumnName(rawHeaderName);
        if (keepColumnNameSet.has(cleanHeaderName)) { keptIndexList.push(columnIndex); keptColumnNames.push(cleanHeaderName); }
        else droppedColumnNames.push(cleanHeaderName);
    });
    // 只剩 1 欄時，空值的列會變成空白行被後端（pandas）略過、造成筆數改變，因此不裁切
    if (keptIndexList.length < 2 || droppedColumnNames.length === 0) {
        return { csvText, keptColumnNames: headerRowList.map(cleanColumnName), droppedColumnNames: [] };
    }

    const projectedRowsList: string[][] = [];
    Papa.parse<string[]>(csvBodyText, {
        skipEmptyLines: true,
        step: (rowResult) => {
            const rowCellsList = rowResult.data;
            projectedRowsList.push(keptIndexList.map((columnIndex) => rowCellsList[columnIndex] ?? ''));
        }
    });
    // 第一列是標頭，改用清理過的欄名輸出
    if (projectedRowsList.length > 0) projectedRowsList[0] = keptColumnNames.slice();
    return {
        csvText: (hasLeadingBomStatus ? '\uFEFF' : '') + Papa.unparse(projectedRowsList, { newline: '\n' }),
        keptColumnNames,
        droppedColumnNames
    };
};

/** k_anonymity 區塊中以欄名為 key 的設定（columns、泛化階層／矩陣、試算層級）只保留指定欄位，其餘參數原樣沿用 */
const K_ANONYMITY_COLUMN_KEYED_PROPERTY_NAMES = ['columns', 'generalization_hierarchies', 'generalization_matrices', 'qi_generalization_levels'];

export const pruneKAnonymityBlockToColumns = (kAnonBlock: unknown, keepColumnNames: Iterable<string>): unknown => {
    if (!kAnonBlock || typeof kAnonBlock !== 'object') return kAnonBlock;
    const keepColumnNameSet = new Set(Array.from(keepColumnNames, cleanColumnName));
    const prunedBlockRecord: Record<string, unknown> = { ...(kAnonBlock as Record<string, unknown>) };
    K_ANONYMITY_COLUMN_KEYED_PROPERTY_NAMES.forEach((propertyName) => {
        const columnKeyedMap = prunedBlockRecord[propertyName];
        if (!columnKeyedMap || typeof columnKeyedMap !== 'object' || Array.isArray(columnKeyedMap)) return;
        const filteredEntries = Object.entries(columnKeyedMap as Record<string, unknown>)
            .filter(([columnName]) => keepColumnNameSet.has(cleanColumnName(columnName)));
        if (filteredEntries.length > 0) prunedBlockRecord[propertyName] = Object.fromEntries(filteredEntries);
        else if (propertyName !== 'columns') delete prunedBlockRecord[propertyName];
        else prunedBlockRecord[propertyName] = {};
    });
    return prunedBlockRecord;
};

/** 把位元組數換成 MB 文字（執行紀錄用） */
export const formatMegabytesText = (byteCount: number): string => (byteCount / 1024 / 1024).toFixed(1);
