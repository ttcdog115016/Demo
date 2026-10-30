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
 *   - dateTimeRanges：可解析為日期時間（YYYY-MM-DD[ HH:mm[:ss]]）的欄位之最早／最晚值，供 DP 日期邊界推薦
 *   - nonNumericDistinctValues：非數值的相異值（最多 MAX_NON_NUMERIC_DISTINCT_SAMPLE 個，供分級距統計）
 */
import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { scanDatasetFileOnCurrentThread, buildDatasetFileKey, cleanDatasetColumnName, type DatasetProfile } from './datasetProfileScanner';
import { findNumericMinMax } from './binGeneration';

// ★ 2026-10-30：逐列累計移到 datasetProfileScanner.ts（可在 Web Worker 執行），此處維持原本的對外介面
export { MAX_TRACKED_DISTINCT_VALUES_PER_COLUMN, MAX_TOP_VALUES_PER_COLUMN, buildDatasetFileKey } from './datasetProfileScanner';
export type { DatasetProfile, DatasetColumnProfile } from './datasetProfileScanner';

/**
 * 相異值佔比（相異值數 ÷ 非空值筆數）。相異值數被截斷時無法得知真實佔比，回傳 1（保守視為極高），
 * 避免把例如 100 萬筆、幾乎每筆不同的 ID 欄位誤判為低唯一值而送去後端分類器。
 */
export const getColumnUniqueValueRatio = (profile: DatasetProfile | null | undefined, columnName: string): number => {
    const columnProfile = profile?.columns[cleanDatasetColumnName(columnName)];
    if (!columnProfile || columnProfile.nonEmptyCount === 0) return 0;
    if (columnProfile.isDistinctCountCapped) return 1;
    return columnProfile.distinctCount / columnProfile.nonEmptyCount;
};

/**
 * 欄位數值的最小／最大值：優先讀統計快照記錄的 numericMin／numericMax（不需重掃），
 * 舊快照沒有這兩個值時才逐筆比較（findNumericMinMax）。沒有任何數值時回傳 null。
 * ★ 2026-10-30：Step2 原本每次進入都對每個數值欄位的數百萬筆重新求最小值。
 */
export const getColumnNumericRange = (
    profile: DatasetProfile | null | undefined, numericValuesMap: Record<string, number[]> | null | undefined, columnName: string
): { min: number; max: number } | null => {
    const columnProfile = profile?.columns[cleanDatasetColumnName(columnName)];
    if (columnProfile && typeof columnProfile.numericMin === 'number' && typeof columnProfile.numericMax === 'number') {
        return { min: columnProfile.numericMin, max: columnProfile.numericMax };
    }
    const numericValuesList = numericValuesMap?.[columnName];
    return numericValuesList && numericValuesList.length > 0 ? findNumericMinMax(numericValuesList) : null;
};

/** 在 Web Worker 掃描（不卡畫面）；瀏覽器不支援或 Worker 啟動失敗時退回主執行緒掃描 */
const scanDatasetFile = (file: File): Promise<DatasetProfile> => {
    if (typeof Worker === 'undefined') return scanDatasetFileOnCurrentThread(file);
    let scanWorker: Worker;
    try {
        scanWorker = new Worker(new URL('./datasetProfile.worker.ts', import.meta.url), { type: 'module' });
    } catch (workerCreateError) {
        console.warn('資料集統計 Worker 無法啟動，改在主執行緒掃描:', workerCreateError);
        return scanDatasetFileOnCurrentThread(file);
    }
    return new Promise<DatasetProfile>((resolve, reject) => {
        scanWorker.onmessage = (event: MessageEvent<{ profile?: DatasetProfile; error?: string }>) => {
            scanWorker.terminate();
            if (event.data.profile) resolve(event.data.profile);
            else reject(new Error(event.data.error || '資料集統計掃描失敗'));
        };
        scanWorker.onerror = (workerError) => {
            scanWorker.terminate();
            console.warn('資料集統計 Worker 執行失敗，改在主執行緒掃描:', workerError.message);
            scanDatasetFileOnCurrentThread(file).then(resolve, reject);
        };
        scanWorker.postMessage({ file });
    });
};

// ★ 2026-10-30：Step4 有前處理時以前處理後的新檔案計算風險統計；該檔案不是目前資料集，不寫入 store，
//   先前因此每次執行都整份重掃。另以模組變數快取最近一份（只保留一份，避免佔用記憶體）。
let otherFileProfileCache: DatasetProfile | null = null;

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
    if (otherFileProfileCache && otherFileProfileCache.fileKey === fileKey) return Promise.resolve(otherFileProfileCache);
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
            } else {
                otherFileProfileCache = profile;
                useWorkspaceStore.setState({ isColumnCategoricalValuesScanning: false });
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
