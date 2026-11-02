/**
 * 檔案名稱 (File): datasetProfileScanner.ts
 * 模組功能 (Description): 資料集欄位統計的逐列累計（純計算，不依賴畫面與 store），主執行緒與 Web Worker 共用。
 *
 * ★ 2026-10-30：自 datasetProfile.ts 抽出。500 萬筆資料逐列累計會讓主執行緒卡住數十秒（首次進入 Step2 整個畫面凍結），
 *   改由 datasetProfile.worker.ts 在背景執行；Worker 不可用（例如測試環境）時退回主執行緒，兩者結果相同。
 *   另順便記錄每欄數值的最小／最大值（numericMin／numericMax），Step2 不必再對數百萬筆數值重掃。
 */
import { parseCsvBlobInChunks } from './csvBlobParse';
import { createColumnValueStats, addValueToColumnStats, type ColumnValueStats } from './backendValueRules';
import { parseDpDateTimeBoundTimestamp, formatDpDateTimeBoundFromTimestamp } from './dpFieldHelpers';

export const MAX_TRACKED_DISTINCT_VALUES_PER_COLUMN = 200000;
export const MAX_TOP_VALUES_PER_COLUMN = 1000;
const MAX_NON_NUMERIC_DISTINCT_SAMPLE = 1000;
// 看起來像日期（YYYY-MM-DD 開頭）才嘗試解析，避免每個文字儲存格都跑完整解析
const DATE_TIME_CELL_PREFIX_PATTERN = /^\d{4}-\d{2}-\d{2}/;

export interface DatasetColumnProfile {
    nonEmptyCount: number;
    distinctCount: number;
    isDistinctCountCapped: boolean;
    topValues: string[];
    numericCount: number;
    /** 數值的最小／最大值（沒有任何數值時不存在）；取代對 numericValues 全部重掃 */
    numericMin?: number;
    numericMax?: number;
    nonNumericDistinctValues: string[];
    /** ★ 2026-10-05：與後端一致規則的數值／日期統計（缺值字串、嚴格數值、格式一致性），供 Step2 型態檢查使用 */
    valueStats?: ColumnValueStats;
}

export interface DatasetProfile {
    fileKey: string;
    rowCount: number;
    columnNamesList: string[];
    columns: Record<string, DatasetColumnProfile>;
    numericValues: Record<string, number[]>;
    /** 日期時間欄位的最早／最晚值（邊界字串格式，午夜只留日期）與可解析筆數；沒有任何可解析值的欄位不列入 */
    dateTimeRanges?: Record<string, { min: string; max: string; count: number }>;
}

/** 以檔名＋大小＋修改時間辨識「同一份檔案」 */
export const buildDatasetFileKey = (file: File): string => `${file.name}|${file.size}|${file.lastModified}`;

export const cleanDatasetColumnName = (rawName: string): string => rawName.replace(/^[\uFEFF\u200B]+/, '').trim();

/** 重複欄名比照 Papa header 模式加上 _1、_2…（與改寫前的結果一致） */
const dedupeHeaderNames = (rawNames: string[]): string[] => {
    const seenCounts = new Map<string, number>();
    return rawNames.map((rawName) => {
        const seen = seenCounts.get(rawName) ?? 0;
        seenCounts.set(rawName, seen + 1);
        return seen === 0 ? rawName : `${rawName}_${seen}`;
    });
};

/**
 * 逐段掃描整份檔案（每次只處理一個區塊、不保留列物件）。
 * ★ 2026-11-02（F12 追加）：原本用 Papa.parse(file, { chunk })，Papa 把每 10 MB 切片各自解碼，
 *   落在切片邊界的中文字會變成亂碼（U+FFFD），統計值因此有誤；改用 csvBlobParse（跨段解碼正確）。
 */
export const scanDatasetFileOnCurrentThread = (file: File, options: { chunkBytes?: number } = {}): Promise<DatasetProfile> => new Promise((resolve, reject) => {
    const distinctCounterMapByColumn: Record<string, Map<string, number>> = {};
    const cappedColumnsSet = new Set<string>();
    const nonEmptyCountByColumn: Record<string, number> = {};
    const numericValuesByColumn: Record<string, number[]> = {};
    const numericMinByColumn: Record<string, number> = {};
    const numericMaxByColumn: Record<string, number> = {};
    const nonNumericDistinctByColumn: Record<string, Set<string>> = {};
    const dateTimeExtremaByColumn: Record<string, { minTimestamp: number; maxTimestamp: number; count: number }> = {};
    const valueStatsByColumn: Record<string, ColumnValueStats> = {};
    let isHeaderRead = false;
    let columnNamesList: string[] = [];
    let rowCount = 0;

    parseCsvBlobInChunks(file, (rowsChunk) => {
            let firstDataRowIndex = 0;
            if (!isHeaderRead) {
                isHeaderRead = true;
                firstDataRowIndex = 1;
                columnNamesList = dedupeHeaderNames(rowsChunk[0] || []).map(cleanDatasetColumnName);
                columnNamesList.forEach((columnName) => {
                    distinctCounterMapByColumn[columnName] = new Map();
                    nonEmptyCountByColumn[columnName] = 0;
                    numericValuesByColumn[columnName] = [];
                    nonNumericDistinctByColumn[columnName] = new Set();
                    valueStatsByColumn[columnName] = createColumnValueStats();
                });
            }
            for (let rowIndex = firstDataRowIndex; rowIndex < rowsChunk.length; rowIndex++) {
                const rowCells = rowsChunk[rowIndex];
                rowCount++;
                for (let fieldIndex = 0; fieldIndex < columnNamesList.length; fieldIndex++) {
                    const columnName = columnNamesList[fieldIndex];
                    const rawCellValue = rowCells[fieldIndex];
                    if (rawCellValue === undefined || rawCellValue === null) continue;
                    const trimmedCellValue = String(rawCellValue).trim();
                    if (trimmedCellValue === '') continue;
                    nonEmptyCountByColumn[columnName]++;
                    // 列號：第 1 列為欄位名稱（略過空白列時可能與實際列號略有差異）
                    addValueToColumnStats(valueStatsByColumn[columnName], trimmedCellValue, rowCount + 1);

                    if (!cappedColumnsSet.has(columnName)) {
                        const distinctCounterMap = distinctCounterMapByColumn[columnName];
                        const previousCount = distinctCounterMap.get(trimmedCellValue);
                        if (previousCount !== undefined) distinctCounterMap.set(trimmedCellValue, previousCount + 1);
                        else if (distinctCounterMap.size < MAX_TRACKED_DISTINCT_VALUES_PER_COLUMN) distinctCounterMap.set(trimmedCellValue, 1);
                        else cappedColumnsSet.add(columnName);
                    }

                    const numericValue = Number(trimmedCellValue);
                    if (Number.isFinite(numericValue)) {
                        numericValuesByColumn[columnName].push(numericValue);
                        if (!(numericValue >= numericMinByColumn[columnName])) numericMinByColumn[columnName] = numericValue;
                        if (!(numericValue <= numericMaxByColumn[columnName])) numericMaxByColumn[columnName] = numericValue;
                        continue;
                    }
                    if (nonNumericDistinctByColumn[columnName].size < MAX_NON_NUMERIC_DISTINCT_SAMPLE) nonNumericDistinctByColumn[columnName].add(trimmedCellValue);
                    // ★ 2026-10-01：日期欄位（如生日 1974-06-18）不是數值、不會進 numericValues，先前 DP「自動智慧推薦」
                    //   因此拿不到實際範圍，日期邊界維持預設值、看起來沒有反應。另記最早／最晚值供推薦使用。
                    if (DATE_TIME_CELL_PREFIX_PATTERN.test(trimmedCellValue)) {
                        const cellTimestamp = parseDpDateTimeBoundTimestamp(trimmedCellValue);
                        if (Number.isFinite(cellTimestamp)) {
                            const extrema = dateTimeExtremaByColumn[columnName];
                            if (!extrema) dateTimeExtremaByColumn[columnName] = { minTimestamp: cellTimestamp, maxTimestamp: cellTimestamp, count: 1 };
                            else {
                                if (cellTimestamp < extrema.minTimestamp) extrema.minTimestamp = cellTimestamp;
                                if (cellTimestamp > extrema.maxTimestamp) extrema.maxTimestamp = cellTimestamp;
                                extrema.count++;
                            }
                        }
                    }
                }
            }
    }, { chunkBytes: options.chunkBytes }).then(() => {
            const columns: Record<string, DatasetColumnProfile> = {};
            const numericValues: Record<string, number[]> = {};
            columnNamesList.forEach((columnName) => {
                const distinctCounterMap = distinctCounterMapByColumn[columnName];
                columns[columnName] = {
                    nonEmptyCount: nonEmptyCountByColumn[columnName],
                    distinctCount: distinctCounterMap.size,
                    isDistinctCountCapped: cappedColumnsSet.has(columnName),
                    topValues: Array.from(distinctCounterMap.entries())
                        .sort((entryA, entryB) => entryB[1] - entryA[1])
                        .slice(0, MAX_TOP_VALUES_PER_COLUMN)
                        .map(([cellValue]) => cellValue),
                    numericCount: numericValuesByColumn[columnName].length,
                    ...(numericValuesByColumn[columnName].length > 0 ? { numericMin: numericMinByColumn[columnName], numericMax: numericMaxByColumn[columnName] } : {}),
                    nonNumericDistinctValues: Array.from(nonNumericDistinctByColumn[columnName]),
                    valueStats: valueStatsByColumn[columnName]
                };
                // 與原本 datasetColumnNumericValuesMap 的規則一致：至少有 1 筆有效數值的欄位才放入
                if (numericValuesByColumn[columnName].length > 0) numericValues[columnName] = numericValuesByColumn[columnName];
            });
            const dateTimeRanges: Record<string, { min: string; max: string; count: number }> = {};
            Object.entries(dateTimeExtremaByColumn).forEach(([columnName, extrema]) => {
                dateTimeRanges[columnName] = {
                    min: formatDpDateTimeBoundFromTimestamp(extrema.minTimestamp),
                    max: formatDpDateTimeBoundFromTimestamp(extrema.maxTimestamp),
                    count: extrema.count
                };
            });
            resolve({ fileKey: buildDatasetFileKey(file), rowCount, columnNamesList, columns, numericValues, dateTimeRanges });
    }, reject);
});
