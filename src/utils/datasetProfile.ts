/**
 * ============================================================================
 * 檔案名稱 (File): datasetProfile.ts
 * 模組功能 (Description): 上傳資料集的「欄位統計快照」——整份檔案只完整掃描一次，供各步驟共用。
 * ============================================================================
 *
 * ★ 2026-09-30：原本各頁各自對整份原始檔案呼叫 Papa.parse（不帶 preview、一次產生整份資料的
 *   列物件陣列）：Step2 K-匿名與差分隱私的數值快取各一次、差分隱私「系統推薦設定」一次、Step3
 *   風險族群面板一次、Step4 高唯一值偵測又一次；100 萬筆資料時每次都要在記憶體中同時放 100 萬個
 *   列物件，數次疊加容易讓瀏覽器卡住甚至分頁當掉。
 *   改為這裡統一以 Papa.parse 的 chunk 串流模式掃描一次（每次只處理一個區塊、不保留列物件），
 *   累計各欄位需要的統計值，結果依檔案（名稱＋大小＋修改時間）快取；同一份檔案不論幾頁呼叫
 *   都只會實際掃描一次，並同步寫入 WorkspaceStore 既有的 datasetColumnNumericValuesMap 與
 *   columnCategoricalUniqueValues，讓原本讀這兩個欄位的畫面不必改動。
 *
 * 統計內容（每個欄位）：
 *   - nonEmptyCount：非空值筆數
 *   - distinctCount：相異值數；超過 MAX_TRACKED_DISTINCT_VALUES_PER_COLUMN 後停止追蹤並標記
 *     isDistinctCountCapped（此時真正的相異值數只知道「至少這麼多」，使用端應保守視為很高）
 *   - topValues：出現次數最多的前 MAX_TOP_VALUES_PER_COLUMN 個值（供下拉選單）
 *   - numericCount：可轉為有限數字的筆數；所有數值另存於 numericValues（供邊界檢查、區間建議）
 *   - nonNumericDistinctValues：非數值的相異值（最多 MAX_NON_NUMERIC_DISTINCT_SAMPLE 個，供分級距統計）
 */
import Papa from 'papaparse';
import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

export const MAX_TRACKED_DISTINCT_VALUES_PER_COLUMN = 200000;
export const MAX_TOP_VALUES_PER_COLUMN = 1000;
const MAX_NON_NUMERIC_DISTINCT_SAMPLE = 1000;

export interface DatasetColumnProfile {
    nonEmptyCount: number;
    distinctCount: number;
    isDistinctCountCapped: boolean;
    topValues: string[];
    numericCount: number;
    nonNumericDistinctValues: string[];
}

export interface DatasetProfile {
    fileKey: string;
    rowCount: number;
    columnNamesList: string[];
    columns: Record<string, DatasetColumnProfile>;
    numericValues: Record<string, number[]>;
}

/** 以檔名＋大小＋修改時間辨識「同一份檔案」 */
export const buildDatasetFileKey = (file: File): string => `${file.name}|${file.size}|${file.lastModified}`;

const cleanColumnName = (rawName: string): string => rawName.replace(/^[\uFEFF\u200B]+/, '').trim();

/**
 * 相異值佔比（相異值數 ÷ 非空值筆數）。相異值數被截斷時無法得知真實佔比，回傳 1（保守視為極高），
 * 避免把例如 100 萬筆、幾乎每筆不同的 ID 欄位誤判為低唯一值而送去後端分類器。
 */
export const getColumnUniqueValueRatio = (profile: DatasetProfile | null | undefined, columnName: string): number => {
    const columnProfile = profile?.columns[cleanColumnName(columnName)];
    if (!columnProfile || columnProfile.nonEmptyCount === 0) return 0;
    if (columnProfile.isDistinctCountCapped) return 1;
    return columnProfile.distinctCount / columnProfile.nonEmptyCount;
};

const scanDatasetFile = (file: File): Promise<DatasetProfile> => new Promise((resolve, reject) => {
    const distinctCounterMapByColumn: Record<string, Map<string, number>> = {};
    const cappedColumnsSet = new Set<string>();
    const nonEmptyCountByColumn: Record<string, number> = {};
    const numericValuesByColumn: Record<string, number[]> = {};
    const nonNumericDistinctByColumn: Record<string, Set<string>> = {};
    let rawToCleanNameMap: Record<string, string> | null = null;
    let columnNamesList: string[] = [];
    let rowCount = 0;

    Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        chunk: (chunkResult) => {
            if (!rawToCleanNameMap) {
                const rawFieldsList = chunkResult.meta.fields || [];
                rawToCleanNameMap = {};
                rawFieldsList.forEach((rawFieldName) => { rawToCleanNameMap![rawFieldName] = cleanColumnName(rawFieldName); });
                columnNamesList = rawFieldsList.map((rawFieldName) => rawToCleanNameMap![rawFieldName]);
                columnNamesList.forEach((columnName) => {
                    distinctCounterMapByColumn[columnName] = new Map();
                    nonEmptyCountByColumn[columnName] = 0;
                    numericValuesByColumn[columnName] = [];
                    nonNumericDistinctByColumn[columnName] = new Set();
                });
            }
            const nameMap = rawToCleanNameMap;
            for (const rowRecord of chunkResult.data) {
                rowCount++;
                for (const rawFieldName in nameMap) {
                    const columnName = nameMap[rawFieldName];
                    const rawCellValue = rowRecord[rawFieldName];
                    if (rawCellValue === undefined || rawCellValue === null) continue;
                    const trimmedCellValue = String(rawCellValue).trim();
                    if (trimmedCellValue === '') continue;
                    nonEmptyCountByColumn[columnName]++;

                    if (!cappedColumnsSet.has(columnName)) {
                        const distinctCounterMap = distinctCounterMapByColumn[columnName];
                        const previousCount = distinctCounterMap.get(trimmedCellValue);
                        if (previousCount !== undefined) distinctCounterMap.set(trimmedCellValue, previousCount + 1);
                        else if (distinctCounterMap.size < MAX_TRACKED_DISTINCT_VALUES_PER_COLUMN) distinctCounterMap.set(trimmedCellValue, 1);
                        else cappedColumnsSet.add(columnName);
                    }

                    const numericValue = Number(trimmedCellValue);
                    if (Number.isFinite(numericValue)) numericValuesByColumn[columnName].push(numericValue);
                    else if (nonNumericDistinctByColumn[columnName].size < MAX_NON_NUMERIC_DISTINCT_SAMPLE) nonNumericDistinctByColumn[columnName].add(trimmedCellValue);
                }
            }
        },
        complete: () => {
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
                    nonNumericDistinctValues: Array.from(nonNumericDistinctByColumn[columnName])
                };
                // 與原本 datasetColumnNumericValuesMap 的規則一致：至少有 1 筆有效數值的欄位才放入
                if (numericValuesByColumn[columnName].length > 0) numericValues[columnName] = numericValuesByColumn[columnName];
            });
            resolve({ fileKey: buildDatasetFileKey(file), rowCount, columnNamesList, columns, numericValues });
        },
        error: (parseError: Error) => reject(parseError)
    });
});

// 同一份檔案同時被多頁要求時共用同一個掃描；只保留最近一份檔案，換檔即釋放舊結果的記憶體
let inFlightScanRecord: { fileKey: string; promise: Promise<DatasetProfile> } | null = null;

/**
 * 取得（必要時才掃描）目前資料集的欄位統計快照，並寫入 WorkspaceStore。
 * Step4 等非 React 流程可直接 await；畫面元件請用下方 useEnsureDatasetProfile。
 */
export const ensureDatasetProfile = (file: File): Promise<DatasetProfile> => {
    const fileKey = buildDatasetFileKey(file);
    const cachedProfile = useWorkspaceStore.getState().datasetProfile;
    if (cachedProfile && cachedProfile.fileKey === fileKey) return Promise.resolve(cachedProfile);
    if (inFlightScanRecord && inFlightScanRecord.fileKey === fileKey) return inFlightScanRecord.promise;

    useWorkspaceStore.setState({ isColumnCategoricalValuesScanning: true });
    const scanPromise = scanDatasetFile(file)
        .then((profile) => {
            // 掃描期間若已換成別的檔案，就不要把舊檔案的結果寫回去
            const currentDataFile = useWorkspaceStore.getState().dataFile;
            if (currentDataFile && buildDatasetFileKey(currentDataFile) === fileKey) {
                const categoricalTopValuesMap: Record<string, string[]> = {};
                profile.columnNamesList.forEach((columnName) => { categoricalTopValuesMap[columnName] = profile.columns[columnName].topValues; });
                useWorkspaceStore.setState({
                    datasetProfile: profile,
                    datasetColumnNumericValuesMap: profile.numericValues,
                    columnCategoricalUniqueValues: categoricalTopValuesMap,
                    isColumnCategoricalValuesScanning: false
                });
            }
            return profile;
        })
        .catch((scanError) => {
            useWorkspaceStore.setState({ isColumnCategoricalValuesScanning: false });
            throw scanError;
        })
        .finally(() => {
            if (inFlightScanRecord && inFlightScanRecord.fileKey === fileKey) inFlightScanRecord = null;
        });
    inFlightScanRecord = { fileKey, promise: scanPromise };
    return scanPromise;
};

/** 畫面元件用：目前資料集有檔案且尚未掃描時自動觸發一次（已掃描過則不重掃）。 */
export const useEnsureDatasetProfile = (): void => {
    const dataFile = useWorkspaceStore((state) => state.dataFile);
    useEffect(() => {
        if (!dataFile) return;
        ensureDatasetProfile(dataFile).catch((scanError) => console.error('資料集欄位統計掃描失敗:', scanError));
    }, [dataFile]);
};
