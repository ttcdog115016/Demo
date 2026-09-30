/**
 * ============================================================================
 * 檔案名稱 (File): sensitiveBinning.ts
 * 模組功能 (Description): 風險評估前「連續數值敏感欄位自動分級距」的純運算。
 * ============================================================================
 * ★ 2026-09-30：由 features/step4_result/Step4_Result.tsx 的 runFullPipeline 內抽出（原本是函式裡的
 *   區域函式，無法單獨測試），邏輯不變；單元測試見 utils/__tests__/sensitiveBinning.test.ts。
 *
 * 背景（後端工程師回覆，2026-09-29）：推斷性攻擊以準識別欄位為特徵、敏感欄位為目標建立分類模型，
 *   敏感欄位需為可列舉類別；薪資等連續數值應先分組為級距再宣告為 sensitive。級距一律以 0 為原點切齊
 *   （floor(值 ÷ 寬度) × 寬度），確保原始資料與去識別化資料（CAP 需兩份）用同一套切點；
 *   非數值的儲存格（空值、抑制後的「*」等）原樣保留不轉換。
 */
import Papa from 'papaparse';
import type { DatasetProfile } from './datasetProfile';

/** 欄位中可轉為數字的比例至少要到這個值，才視為「連續數值欄位」並自動分級距 */
export const NUMERIC_COLUMN_MIN_PARSEABLE_RATIO = 0.95;
/** 自動級距寬度的目標級數（約分成幾級） */
export const TARGET_AUTO_BIN_COUNT = 10;

const cleanColumnName = (rawName: string): string => rawName.replace(/^[\uFEFF\u200B]+/, '').trim();

/** 儲存格轉數字（容許千分位逗號與空白）；無法轉換時回傳 null */
export const parseNumericCellForBinning = (cellValue: unknown): number | null => {
    if (cellValue === undefined || cellValue === null) return null;
    const normalizedText = String(cellValue).replace(/[,，\s]/g, '');
    if (normalizedText === '') return null;
    const parsedNumber = Number(normalizedText);
    return Number.isFinite(parsedNumber) ? parsedNumber : null;
};

/** 依範圍自動取「好讀」的級距寬度（1／2／5 × 10^n），約分成 TARGET_AUTO_BIN_COUNT 級 */
export const computeAutoNiceBinWidth = (minValue: number, maxValue: number): number => {
    const spanValue = maxValue - minValue;
    if (!(spanValue > 0)) return 1;
    const rawWidthValue = spanValue / TARGET_AUTO_BIN_COUNT;
    const magnitudeValue = 10 ** Math.floor(Math.log10(rawWidthValue));
    const normalizedWidthValue = rawWidthValue / magnitudeValue;
    const niceMultiplierValue = normalizedWidthValue <= 1 ? 1 : normalizedWidthValue <= 2 ? 2 : normalizedWidthValue <= 5 ? 5 : 10;
    return niceMultiplierValue * magnitudeValue;
};

const formatBinBoundaryText = (boundaryValue: number): string => String(Number(boundaryValue.toPrecision(12)));

/** 數值 → 級距標籤，例如 52340、寬度 20000 → "40000~60000" */
export const convertNumberToBinLabel = (numberValue: number, binWidthValue: number): string => {
    // +1e-9 避免 0.3 ÷ 0.1 = 2.9999… 之類浮點誤差被切到前一級；以「~」分隔以免與負號混淆。
    const lowerBoundValue = Math.floor(numberValue / binWidthValue + 1e-9) * binWidthValue;
    return `${formatBinBoundaryText(lowerBoundValue)}~${formatBinBoundaryText(lowerBoundValue + binWidthValue)}`;
};

/** 欄位是否「幾乎全為數值」；是的話回傳最小／最大值，否則回傳 null */
export const analyzeNumericColumnRange = (datasetProfile: DatasetProfile, targetColumnName: string): { min: number; max: number } | null => {
    const columnKey = cleanColumnName(targetColumnName);
    const columnProfile = datasetProfile.columns[columnKey];
    if (!columnProfile || columnProfile.nonEmptyCount === 0) return null;
    if (columnProfile.numericCount / columnProfile.nonEmptyCount < NUMERIC_COLUMN_MIN_PARSEABLE_RATIO) return null;
    const columnNumericValuesList = datasetProfile.numericValues[columnKey] || [];
    if (columnNumericValuesList.length === 0) return null;
    // 逐筆比較（大量資料時 Math.min(...陣列) 會因參數過多而 RangeError）
    let minValue = Infinity;
    let maxValue = -Infinity;
    for (const numericValue of columnNumericValuesList) {
        if (numericValue < minValue) minValue = numericValue;
        if (numericValue > maxValue) maxValue = numericValue;
    }
    return { min: minValue, max: maxValue };
};

/** 以指定寬度分級距後，欄位的相異值數與唯一值佔比（非數值儲存格各自算一個值） */
export const computeBinnedColumnStats = (datasetProfile: DatasetProfile, targetColumnName: string, binWidthValue: number): { distinctCount: number; uniqueRatio: number } => {
    const columnKey = cleanColumnName(targetColumnName);
    const columnProfile = datasetProfile.columns[columnKey];
    if (!columnProfile || columnProfile.nonEmptyCount === 0) return { distinctCount: 0, uniqueRatio: 0 };
    const binnedLabelsSet = new Set<string>(columnProfile.nonNumericDistinctValues);
    for (const numericValue of datasetProfile.numericValues[columnKey] || []) {
        binnedLabelsSet.add(convertNumberToBinLabel(numericValue, binWidthValue));
    }
    return { distinctCount: binnedLabelsSet.size, uniqueRatio: binnedLabelsSet.size / columnProfile.nonEmptyCount };
};

/** 把 CSV 文字中指定欄位的數值換成級距標籤（其餘欄位與非數值儲存格原樣保留；開頭 BOM 保留） */
export const applySensitiveBinningToCsvText = (csvText: string, binWidthByColumnMap: Record<string, number>): string => {
    if (Object.keys(binWidthByColumnMap).length === 0) return csvText;
    const hasLeadingBomStatus = csvText.charCodeAt(0) === 0xFEFF;
    const csvBodyText = hasLeadingBomStatus ? csvText.slice(1) : csvText;
    const parsedCsvResult = Papa.parse<Record<string, string>>(csvBodyText, { header: true, skipEmptyLines: true });
    const headerFieldsList = parsedCsvResult.meta.fields || [];
    const binWidthByRawHeaderMap: Record<string, number> = {};
    headerFieldsList.forEach((rawHeaderName) => {
        const cleanHeaderName = cleanColumnName(rawHeaderName);
        if (binWidthByColumnMap[cleanHeaderName]) binWidthByRawHeaderMap[rawHeaderName] = binWidthByColumnMap[cleanHeaderName];
    });
    const convertedRowsList = ((parsedCsvResult.data || []) as Record<string, string>[]).map((rowRecordItem) =>
        headerFieldsList.map((headerName) => {
            const cellValue = rowRecordItem[headerName] ?? '';
            const binWidthValue = binWidthByRawHeaderMap[headerName];
            if (!binWidthValue) return cellValue;
            const parsedValue = parseNumericCellForBinning(cellValue);
            return parsedValue === null ? cellValue : convertNumberToBinLabel(parsedValue, binWidthValue);
        })
    );
    return (hasLeadingBomStatus ? '\uFEFF' : '') + Papa.unparse({ fields: headerFieldsList, data: convertedRowsList });
};
