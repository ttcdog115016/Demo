/**
 * ============================================================================
 * 檔案名稱 (File): kAnonymityFidelity.ts
 * 模組功能 (Description): K-匿名「資料實用性」：依《合成資料技術指引 v1.5》保真度三項指標，前端以處理前後資料計算
 * ============================================================================
 * ★ 2026-10-15 使用者決定「以指引為主」：實用性不再只看保留筆數。
 *   指引表十六「三、跨機構與資料開放分析」（提供學術單位屬此類）評測主軸為保真度，
 *   「欄位分布相似度、欄位間相關性保留與整體品質綜合分數三項指標分別達到建議值（各 ≥ 0.75）」。
 *   0.75 來源：單欄分布相似度以 1−TVD 表示，低於 0.75 時分布失真明顯可辨（第貳章二之（六）；屬建議值）。
 *   《帝濶需求書 v2.2》未要求後端提供，故由前端計算。試算見專案文件「評估_2026-10-15_K匿名實用性改依指引保真度_試算」。
 *
 * 計算（仿 SDMetrics 品質報告）：
 *   - 欄位分布相似度＝各欄 1 − TVD（總變異距離）的平均。
 *   - 欄位間相關性保留＝各欄位對「列聯表相似度」（1 − 聯合分布 TVD）的平均。
 *   - 綜合分數＝前兩者平均。三者皆 ≥ 0.75 為達標。
 * K-匿名的泛化值（如 30-39、較大分類、日期粒度）與原值格式不同，不能直接比：
 *   以處理前後逐筆配對，得知每個處理後的值涵蓋哪些原始值，再「平均攤回」這些原始值
 *   （資料使用者只知道區間、不知道區間內分布，故假設均勻）。「*」或被抑制成空白＝攤回該欄全部原始值。
 *   被整筆刪除的列不出現在處理後資料，其影響自然反映在分布差異中。
 * 分組（bin）：數值欄相異值 > 100 時切 20 等寬區間；日期（YYYY-MM-DD 開頭）相異值 > 100 時以年為單位；
 *   其他文字欄相異值 > 100（例如自由文字）不評估，避免列聯表過於稀疏。原始即空值的格子不計。
 * 配對方式同 kAnonymityLossMetric.ts（後端只刪列、不重排）。配對失敗回傳 null（不顯示，避免錯誤數字）。
 * 大資料：處理後超過 sampleLimit 筆時等距抽樣計算（配對與攤回對照表仍用全部資料）。
 */
import Papa from 'papaparse';

/** 指引建議值（各 ≥ 0.75） */
export const FIDELITY_PASS_THRESHOLD = 0.75;
const MAX_DISTINCT_FOR_EXACT = 100;
const NUMERIC_BIN_COUNT = 20;
const DEFAULT_SAMPLE_LIMIT = 100000;
const SUPPRESSION_MARK = '*';

export interface FidelityItemScore {
    /** 欄位名稱；欄位對為「A × B」 */
    label: string;
    score: number;
}

export interface KAnonymityFidelityResult {
    /** 欄位分布相似度（0～1） */
    columnShapes: number;
    /** 欄位間相關性保留（0～1）；只有一個欄位時為 null */
    columnPairTrends: number | null;
    /** 整體品質綜合分數（0～1） */
    overall: number;
    /** 三項皆 ≥ 0.75 */
    isPassed: boolean;
    /** 低於 0.75 的欄位與欄位對（由低到高） */
    belowThresholdItems: FidelityItemScore[];
    evaluatedColumns: string[];
    /** 是否抽樣計算，以及計算筆數 */
    sampled: boolean;
    sampleRows: number;
}

const cleanName = (nameText: string): string => String(nameText ?? '').replace(/^[\uFEFF\u200B]+/, '').trim();
const cellText = (cellValue: unknown): string => (cellValue === undefined || cellValue === null ? '' : String(cellValue).trim());
const parseCsvRows = (csvText: string): string[][] =>
    Papa.parse<string[]>(csvText.replace(/^[\uFEFF\u200B]+/, ''), { header: false, skipEmptyLines: true }).data;

/** 處理後第 i 筆 → 原始第 j 筆；失敗回傳 null */
const pairProcessedRows = (originalHeader: string[], originalBody: string[][], processedHeader: string[], processedBody: string[][], anchorColumns: string[]): number[] | null => {
    const pairedIndexList: number[] = [];
    if (processedBody.length === originalBody.length) {
        for (let rowIndex = 0; rowIndex < processedBody.length; rowIndex += 1) pairedIndexList.push(rowIndex);
        return pairedIndexList;
    }
    if (processedBody.length > originalBody.length) return null;
    const usableAnchors = anchorColumns.map(cleanName).filter((column) => originalHeader.includes(column) && processedHeader.includes(column));
    if (usableAnchors.length === 0) return null;
    const originalAnchorIndexes = usableAnchors.map((column) => originalHeader.indexOf(column));
    const processedAnchorIndexes = usableAnchors.map((column) => processedHeader.indexOf(column));
    const fingerprint = (row: string[], indexes: number[]): string => indexes.map((columnIndex) => cellText(row[columnIndex])).join('\u0001');
    let originalPointer = 0;
    for (let processedPointer = 0; processedPointer < processedBody.length; processedPointer += 1) {
        const targetFingerprint = fingerprint(processedBody[processedPointer], processedAnchorIndexes);
        while (originalPointer < originalBody.length && fingerprint(originalBody[originalPointer], originalAnchorIndexes) !== targetFingerprint) originalPointer += 1;
        if (originalPointer >= originalBody.length) return null;
        pairedIndexList.push(originalPointer);
        originalPointer += 1;
    }
    return pairedIndexList;
};

/** 依原始值建立「原始值 → 分組編號」；不適合評估時回傳 null */
const buildBinner = (originalValues: string[]): { binOf: Map<string, number>; binCount: number } | null => {
    const distinctValues = Array.from(new Set(originalValues));
    if (distinctValues.length === 0) return null;
    const binOf = new Map<string, number>();
    if (distinctValues.length <= MAX_DISTINCT_FOR_EXACT) {
        distinctValues.forEach((value, index) => binOf.set(value, index));
        return { binOf, binCount: distinctValues.length };
    }
    const numericValues = distinctValues.map((value) => Number(value));
    if (numericValues.every((value) => Number.isFinite(value))) {
        let minValue = Infinity;
        let maxValue = -Infinity;
        for (const value of numericValues) { if (value < minValue) minValue = value; if (value > maxValue) maxValue = value; }
        const binWidth = (maxValue - minValue) / NUMERIC_BIN_COUNT || 1;
        distinctValues.forEach((value, index) => binOf.set(value, Math.min(Math.floor((numericValues[index] - minValue) / binWidth), NUMERIC_BIN_COUNT - 1)));
        return { binOf, binCount: NUMERIC_BIN_COUNT };
    }
    if (distinctValues.every((value) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value))) {
        const yearIndex = new Map<string, number>();
        distinctValues.forEach((value) => {
            const yearText = value.slice(0, 4);
            if (!yearIndex.has(yearText)) yearIndex.set(yearText, yearIndex.size);
            binOf.set(value, yearIndex.get(yearText)!);
        });
        return { binOf, binCount: yearIndex.size };
    }
    return null;
};

/** 兩個機率向量的 1 − TVD */
const similarity = (left: Float64Array, right: Float64Array): number => {
    let distance = 0;
    for (let index = 0; index < left.length; index += 1) distance += Math.abs(left[index] - right[index]);
    return 1 - distance / 2;
};
const normalize = (vector: Float64Array): Float64Array => {
    let total = 0;
    for (let index = 0; index < vector.length; index += 1) total += vector[index];
    if (total > 0) for (let index = 0; index < vector.length; index += 1) vector[index] /= total;
    return vector;
};

interface ColumnModel {
    name: string;
    binCount: number;
    /** 抽樣原始列的分組（-1＝空值） */
    originalBins: Int32Array;
    /** 抽樣處理後列的「攤回」鍵（-1＝不計） */
    processedKeys: Int32Array;
    /** 攤回鍵 → 分組機率分布（稀疏：[分組, 權重]） */
    spreadByKey: Array<Array<[number, number]>>;
}

/**
 * 計算 K-匿名保真度三項指標。
 * @param input.evaluatedColumns 要評估的欄位（通常為直接識別以外、處理後仍存在的欄位）
 * @param input.anchorColumns 未經處理的欄位（敏感、非敏感），有列被刪除時用來配對
 */
export const computeKAnonymityFidelity = (input: {
    originalCsvText: string;
    processedCsvText: string;
    evaluatedColumns: string[];
    anchorColumns: string[];
    sampleLimit?: number;
}): KAnonymityFidelityResult | null => {
    const originalRows = parseCsvRows(input.originalCsvText);
    const processedRows = parseCsvRows(input.processedCsvText);
    if (originalRows.length < 2 || processedRows.length < 2) return null;
    const originalHeader = originalRows[0].map(cleanName);
    const processedHeader = processedRows[0].map(cleanName);
    const originalBody = originalRows.slice(1);
    const processedBody = processedRows.slice(1);
    const pairedIndexList = pairProcessedRows(originalHeader, originalBody, processedHeader, processedBody, input.anchorColumns);
    if (!pairedIndexList) return null;

    const sampleLimit = input.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
    const originalStep = Math.max(1, Math.ceil(originalBody.length / sampleLimit));
    const processedStep = Math.max(1, Math.ceil(processedBody.length / sampleLimit));
    const originalSampleIndexes: number[] = [];
    for (let rowIndex = 0; rowIndex < originalBody.length; rowIndex += originalStep) originalSampleIndexes.push(rowIndex);
    const processedSampleIndexes: number[] = [];
    for (let rowIndex = 0; rowIndex < processedBody.length; rowIndex += processedStep) processedSampleIndexes.push(rowIndex);

    const columnModels: ColumnModel[] = [];
    for (const rawColumn of input.evaluatedColumns) {
        const column = cleanName(rawColumn);
        const originalColumnIndex = originalHeader.indexOf(column);
        const processedColumnIndex = processedHeader.indexOf(column);
        if (originalColumnIndex < 0 || processedColumnIndex < 0) continue;
        const allOriginalValues: string[] = [];
        for (const row of originalBody) {
            const value = cellText(row[originalColumnIndex]);
            if (value !== '') allOriginalValues.push(value);
        }
        const binner = buildBinner(allOriginalValues);
        if (!binner) continue;

        // 每個處理後的值涵蓋哪些原始值（以全部配對資料推得）
        const coveredByOutput = new Map<string, Set<string>>();
        for (let processedIndex = 0; processedIndex < processedBody.length; processedIndex += 1) {
            const originalValue = cellText(originalBody[pairedIndexList[processedIndex]][originalColumnIndex]);
            if (originalValue === '') continue;
            let outputValue = cellText(processedBody[processedIndex][processedColumnIndex]);
            if (outputValue === '') outputValue = SUPPRESSION_MARK;
            if (outputValue === SUPPRESSION_MARK) continue;
            let coveredSet = coveredByOutput.get(outputValue);
            if (!coveredSet) { coveredSet = new Set(); coveredByOutput.set(outputValue, coveredSet); }
            coveredSet.add(originalValue);
        }
        const toSpread = (coveredValues: Iterable<string>): Array<[number, number]> => {
            const weightByBin = new Map<number, number>();
            let valueCount = 0;
            for (const value of coveredValues) {
                const bin = binner.binOf.get(value);
                if (bin === undefined) continue;
                weightByBin.set(bin, (weightByBin.get(bin) ?? 0) + 1);
                valueCount += 1;
            }
            return Array.from(weightByBin.entries()).map(([bin, weight]) => [bin, weight / Math.max(valueCount, 1)] as [number, number]);
        };
        const spreadByKey: Array<Array<[number, number]>> = [toSpread(binner.binOf.keys())]; // 鍵 0＝「*」：攤回全部原始值
        const keyOfOutput = new Map<string, number>();
        coveredByOutput.forEach((coveredSet, outputValue) => {
            keyOfOutput.set(outputValue, spreadByKey.length);
            spreadByKey.push(toSpread(coveredSet));
        });

        const originalBins = new Int32Array(originalSampleIndexes.length);
        originalSampleIndexes.forEach((rowIndex, sampleIndex) => {
            const value = cellText(originalBody[rowIndex][originalColumnIndex]);
            originalBins[sampleIndex] = value === '' ? -1 : (binner.binOf.get(value) ?? -1);
        });
        const processedKeys = new Int32Array(processedSampleIndexes.length);
        processedSampleIndexes.forEach((processedIndex, sampleIndex) => {
            const originalValue = cellText(originalBody[pairedIndexList[processedIndex]][originalColumnIndex]);
            if (originalValue === '') { processedKeys[sampleIndex] = -1; return; }
            const outputValue = cellText(processedBody[processedIndex][processedColumnIndex]);
            processedKeys[sampleIndex] = outputValue === '' || outputValue === SUPPRESSION_MARK ? 0 : (keyOfOutput.get(outputValue) ?? 0);
        });
        columnModels.push({ name: column, binCount: binner.binCount, originalBins, processedKeys, spreadByKey });
    }
    if (columnModels.length === 0) return null;

    const itemScores: FidelityItemScore[] = [];
    // ── 欄位分布相似度 ──
    const shapeScores = columnModels.map((model) => {
        const originalDistribution = new Float64Array(model.binCount);
        model.originalBins.forEach((bin) => { if (bin >= 0) originalDistribution[bin] += 1; });
        const keyCounts = new Map<number, number>();
        model.processedKeys.forEach((key) => { if (key >= 0) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1); });
        const processedDistribution = new Float64Array(model.binCount);
        keyCounts.forEach((count, key) => model.spreadByKey[key].forEach(([bin, weight]) => { processedDistribution[bin] += count * weight; }));
        const score = similarity(normalize(originalDistribution), normalize(processedDistribution));
        itemScores.push({ label: model.name, score });
        return score;
    });
    // ── 欄位間相關性保留（列聯表相似度） ──
    const pairScores: number[] = [];
    for (let leftIndex = 0; leftIndex < columnModels.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < columnModels.length; rightIndex += 1) {
            const left = columnModels[leftIndex];
            const right = columnModels[rightIndex];
            const cellCount = left.binCount * right.binCount;
            const originalJoint = new Float64Array(cellCount);
            for (let sampleIndex = 0; sampleIndex < left.originalBins.length; sampleIndex += 1) {
                const leftBin = left.originalBins[sampleIndex];
                const rightBin = right.originalBins[sampleIndex];
                if (leftBin >= 0 && rightBin >= 0) originalJoint[leftBin * right.binCount + rightBin] += 1;
            }
            const comboCounts = new Map<number, number>();
            const keySpan = right.spreadByKey.length;
            for (let sampleIndex = 0; sampleIndex < left.processedKeys.length; sampleIndex += 1) {
                const leftKey = left.processedKeys[sampleIndex];
                const rightKey = right.processedKeys[sampleIndex];
                if (leftKey < 0 || rightKey < 0) continue;
                const comboKey = leftKey * keySpan + rightKey;
                comboCounts.set(comboKey, (comboCounts.get(comboKey) ?? 0) + 1);
            }
            const processedJoint = new Float64Array(cellCount);
            comboCounts.forEach((count, comboKey) => {
                const leftSpread = left.spreadByKey[Math.floor(comboKey / keySpan)];
                const rightSpread = right.spreadByKey[comboKey % keySpan];
                for (const [leftBin, leftWeight] of leftSpread) {
                    for (const [rightBin, rightWeight] of rightSpread) processedJoint[leftBin * right.binCount + rightBin] += count * leftWeight * rightWeight;
                }
            });
            const score = similarity(normalize(originalJoint), normalize(processedJoint));
            itemScores.push({ label: `${left.name} × ${right.name}`, score });
            pairScores.push(score);
        }
    }

    const average = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
    const columnShapes = average(shapeScores);
    const columnPairTrends = pairScores.length > 0 ? average(pairScores) : null;
    const overall = columnPairTrends === null ? columnShapes : (columnShapes + columnPairTrends) / 2;
    const isPassed = columnShapes >= FIDELITY_PASS_THRESHOLD && overall >= FIDELITY_PASS_THRESHOLD
        && (columnPairTrends === null || columnPairTrends >= FIDELITY_PASS_THRESHOLD);
    return {
        columnShapes,
        columnPairTrends,
        overall,
        isPassed,
        belowThresholdItems: itemScores.filter((item) => item.score < FIDELITY_PASS_THRESHOLD).sort((left, right) => left.score - right.score),
        evaluatedColumns: columnModels.map((model) => model.name),
        sampled: originalStep > 1 || processedStep > 1,
        sampleRows: processedSampleIndexes.length
    };
};

/** 畫面顯示用（給一般使用者）：0.9634 → 「96%」；無條件捨去，0.749 顯示 74%，不會顯示 75% 卻未達標 */
export const formatFidelityPercent = (score: number): string => `${Math.floor(score * 100)}%`;

/** 合規報告用（對照指引）：0.9734 → 「0.97」 */
export const formatFidelityScore = (score: number): string => (Math.floor(score * 100) / 100).toFixed(2);
