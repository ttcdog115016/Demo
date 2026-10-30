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
 *   - 欄位間相關性保留＝各欄位對相似度的平均。依指引第貳章二之（五）「連續欄位間之相關係數差異與類別欄位間之列聯表偏差」
 *     （算法同 SDMetrics）：兩欄皆為數值 → 相關係數相似度 1 − |r原始 − r處理後| ÷ 2（Pearson）；
 *     其他組合 → 列聯表相似度 1 − 聯合分布 TVD。
 *     ★ 2026-10-16：原本所有欄位對都用列聯表，數值×數值改為相關係數，與指引一致。
 *   - 綜合分數＝前兩者平均。三者皆 ≥ 0.75 為達標。
 * K-匿名的泛化值（如 30-39、較大分類、日期粒度）與原值格式不同，不能直接比：
 *   以處理前後逐筆配對，得知每個處理後的值涵蓋哪些原始值，再「平均攤回」這些原始值所屬的分組（每組等權重）
 *   （資料使用者只知道區間、不知道區間內分布，故假設均勻）。「*」或被抑制成空白＝攤回該欄全部原始值。
 *   被整筆刪除的列不出現在處理後資料，其影響自然反映在分布差異中。
 *   相關係數計算時，泛化值以其涵蓋原始值的「區間中點」（最小值與最大值的平均）代表；「*」以全欄中點代表。
 * 分組（bin）：數值欄相異值 > 100 時切 20 等寬區間；日期（YYYY-MM-DD 開頭）相異值 > 100 時以日／月／年中最細且不超過 100 組的單位；
 *   其他文字欄相異值 > 100（例如自由文字）不評估，避免列聯表過於稀疏。原始即空值的格子不計。
 * 配對方式同 kAnonymityLossMetric.ts（後端只刪列、不重排）。配對失敗回傳 null（不顯示，避免錯誤數字）。
 * 大資料：預設全部計算（2026-10-16 起）；僅在呼叫端指定 sampleLimit 時才等距抽樣。
 */
import Papa from 'papaparse';

/** 指引建議值（各 ≥ 0.75） */
export const FIDELITY_PASS_THRESHOLD = 0.75;
const MAX_DISTINCT_FOR_EXACT = 100;
const NUMERIC_BIN_COUNT = 20;
// ★ 2026-10-16 使用者要求：一律全部計算，不抽樣（避免被質疑準確度；實測 100 萬筆全算約 11 秒、抽樣 10 萬筆約 8 秒）。
//   sampleLimit 參數保留（測試或日後需要時可指定）。
const DEFAULT_SAMPLE_LIMIT = Number.POSITIVE_INFINITY;
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

/** 比對用：數字統一格式（1.0 → 1，避免 CSV 輸出時整數被寫成小數造成對不上） */
const normalizeForMatch = (value: string): string => (/^-?\d+(\.\d+)?$/.test(value) ? String(Number(value)) : value);

/** 日期時間拆成數字段（年、月、日、時、分、秒），格式不同（2024/1/5、2024-01-05T08:00）也能比；非日期回傳 null */
const dateTimeParts = (value: string): number[] | null => {
    const match = value.match(/^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?)?)?)?/);
    if (!match) return null;
    return match.slice(1).filter((part) => part !== undefined).map((part) => Number(part));
};

type CompatibilityChecker = { originalIndex: number; processedIndex: number; isCompatible: (originalValue: string, processedValue: string) => boolean };

/**
 * ★ 2026-10-16：依送給後端的 K-匿名設定，判斷「原始值」能否泛化成「處理後的值」（與後端 strategies/generalize.py 同規則）。
 *   用途：有列被刪除時的配對。原本只比對未處理欄位（敏感、非敏感）；若這些欄位全是常數（例如捷運資料的 IDType、
 *   TicketType、OperatorCode），第一筆被刪除的列之後會整串錯位一筆，分數因此失真。加上此檢查後，被刪除的列
 *   通常與下一筆保留列的泛化結果不同，會被正確略過。
 *   - 類別階層：處理後的值須在該原始值的階梯 [原始值, 第1層, 第2層…] 中；不在階層內的原始值後端輸出「*」。
 *   - 日期粒度：處理後的值須為原始值的開頭（2024-01-01 12:06:06 → 2024-01）。
 *   - 數值區間：處理後的值須等於原始值所屬區間的名稱（[下界, 上界)）。
 *   - 最小單位（四捨五入）：處理後與原始值相差不超過半個單位。
 *   - 其他策略（字串遮蔽、時段等）不檢查。「*」與空白一律視為相容。
 */
const buildCompatibilityCheckers = (kAnonymityConfig: Record<string, unknown> | null | undefined, originalHeader: string[], processedHeader: string[]): CompatibilityChecker[] => {
    if (!kAnonymityConfig || typeof kAnonymityConfig !== 'object') return [];
    const columnsConfig = (kAnonymityConfig.columns ?? {}) as Record<string, { role?: string }>;
    const hierarchies = (kAnonymityConfig.generalization_hierarchies ?? {}) as Record<string, { levels?: unknown; bins?: Array<{ min: number | null; max: number | null; label: string }>; rounding?: number }>;
    const matrices = (kAnonymityConfig.generalization_matrices ?? {}) as Record<string, { mapping?: Record<string, string[]> }>;
    const checkers: CompatibilityChecker[] = [];
    Object.entries(columnsConfig).forEach(([rawColumn, columnConfig]) => {
        if (columnConfig?.role !== 'quasi_identifier') return;
        const column = cleanName(rawColumn);
        const originalIndex = originalHeader.indexOf(column);
        const processedIndex = processedHeader.indexOf(column);
        if (originalIndex < 0 || processedIndex < 0) return;
        const mapping = matrices[rawColumn]?.mapping;
        const hierarchy = hierarchies[rawColumn];
        let isCompatible: ((originalValue: string, processedValue: string) => boolean) | null = null;
        if (mapping) {
            isCompatible = (originalValue, processedValue) => {
                const ladder = mapping[originalValue];
                return ladder ? ladder.map((item) => normalizeForMatch(String(item).trim())).includes(normalizeForMatch(processedValue)) : false;
            };
        } else if (hierarchy && Array.isArray(hierarchy.bins) && hierarchy.bins.length > 0) {
            const bins = hierarchy.bins;
            isCompatible = (originalValue, processedValue) => {
                const numberValue = Number(originalValue);
                if (!Number.isFinite(numberValue)) return false;
                const matchedBin = bins.find((bin) => (bin.min === null || numberValue >= bin.min) && (bin.max === null || numberValue < bin.max));
                return matchedBin ? normalizeForMatch(String(matchedBin.label).trim()) === normalizeForMatch(processedValue) : false;
            };
        } else if (hierarchy && typeof hierarchy.rounding === 'number' && hierarchy.rounding > 0) {
            const unit = hierarchy.rounding;
            isCompatible = (originalValue, processedValue) => {
                const originalNumber = Number(originalValue);
                const processedNumber = Number(processedValue);
                if (!Number.isFinite(originalNumber) || !Number.isFinite(processedNumber)) return true;
                return Math.abs(processedNumber - originalNumber) <= unit / 2 + 1e-9;
            };
        } else if (hierarchy && hierarchy.levels !== undefined) {
            isCompatible = (originalValue, processedValue) => {
                const processedParts = dateTimeParts(processedValue);
                const originalParts = dateTimeParts(originalValue);
                // 處理後不是日期格式（例如只剩時間、時段名稱）或原始值無法解析：不檢查
                if (!processedParts || !originalParts || processedValue.replace(/[\d\-/ :T]/g, '') !== '') return true;
                return processedParts.every((part, index) => originalParts[index] === part);
            };
        }
        if (isCompatible) checkers.push({ originalIndex, processedIndex, isCompatible });
    });
    return checkers;
};

/** 單一種配對方式；失敗回傳 null */
const pairProcessedRowsOnce = (originalHeader: string[], originalBody: string[][], processedHeader: string[], processedBody: string[][], anchorColumns: string[], checkers: CompatibilityChecker[]): number[] | null => {
    const pairedIndexList: number[] = [];
    if (processedBody.length === originalBody.length) {
        for (let rowIndex = 0; rowIndex < processedBody.length; rowIndex += 1) pairedIndexList.push(rowIndex);
        return pairedIndexList;
    }
    if (processedBody.length > originalBody.length) return null;
    const usableAnchors = anchorColumns.map(cleanName).filter((column) => originalHeader.includes(column) && processedHeader.includes(column));
    if (usableAnchors.length === 0 && checkers.length === 0) return null;
    const originalAnchorIndexes = usableAnchors.map((column) => originalHeader.indexOf(column));
    const processedAnchorIndexes = usableAnchors.map((column) => processedHeader.indexOf(column));
    const fingerprint = (row: string[], indexes: number[]): string => indexes.map((columnIndex) => normalizeForMatch(cellText(row[columnIndex]))).join('\u0001');
    const isRowCompatible = (originalRow: string[], processedRow: string[]): boolean => checkers.every((checker) => {
        const processedValue = cellText(processedRow[checker.processedIndex]);
        if (processedValue === '' || processedValue === SUPPRESSION_MARK) return true;
        return checker.isCompatible(cellText(originalRow[checker.originalIndex]), processedValue);
    });
    let originalPointer = 0;
    for (let processedPointer = 0; processedPointer < processedBody.length; processedPointer += 1) {
        const processedRow = processedBody[processedPointer];
        const targetFingerprint = fingerprint(processedRow, processedAnchorIndexes);
        while (originalPointer < originalBody.length
            && (fingerprint(originalBody[originalPointer], originalAnchorIndexes) !== targetFingerprint || !isRowCompatible(originalBody[originalPointer], processedRow))) originalPointer += 1;
        if (originalPointer >= originalBody.length) return null;
        pairedIndexList.push(originalPointer);
        originalPointer += 1;
    }
    return pairedIndexList;
};

/**
 * 處理後第 i 筆 → 原始第 j 筆；失敗回傳 null。
 * ★ 2026-10-16：依序嘗試「未處理欄位＋泛化檢查」→「只用泛化檢查」→「只用未處理欄位」，
 *   避免單一條件（例如格式不同、未處理欄位被改寫）就整個算不出來。
 */
const pairProcessedRows = (originalHeader: string[], originalBody: string[][], processedHeader: string[], processedBody: string[][], anchorColumns: string[], checkers: CompatibilityChecker[] = []): number[] | null => {
    const attempts: Array<[string[], CompatibilityChecker[]]> = [[anchorColumns, checkers]];
    if (checkers.length > 0) attempts.push([[], checkers], [anchorColumns, []]);
    for (const [attemptAnchors, attemptCheckers] of attempts) {
        const paired = pairProcessedRowsOnce(originalHeader, originalBody, processedHeader, processedBody, attemptAnchors, attemptCheckers);
        if (paired) return paired;
    }
    return null;
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
    const datePattern = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
    if (distinctValues.every((value) => datePattern.test(value))) {
        // ★ 2026-10-16：原本一律以「年」分組，資料都在同一年時（例如捷運 2024 年 1～3 月）日期欄永遠 100% 相似，
        //   看不出泛化到月的影響。改為自動挑最細且不超過 100 組的單位：日 → 月 → 年。
        const keyBuilders: Array<(match: RegExpMatchArray) => string> = [
            (match) => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`,
            (match) => `${match[1]}-${match[2].padStart(2, '0')}`,
            (match) => match[1],
        ];
        for (const buildKey of keyBuilders) {
            const unitKeys = distinctValues.map((value) => buildKey(value.match(datePattern)!));
            const unitIndex = new Map<string, number>();
            unitKeys.forEach((unitKey) => { if (!unitIndex.has(unitKey)) unitIndex.set(unitKey, unitIndex.size); });
            if (unitIndex.size <= MAX_DISTINCT_FOR_EXACT || buildKey === keyBuilders[keyBuilders.length - 1]) {
                distinctValues.forEach((value, index) => binOf.set(value, unitIndex.get(unitKeys[index])!));
                return { binOf, binCount: unitIndex.size };
            }
        }
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
    /** 數值欄（呼叫端指定且原值皆為數字）才有：抽樣原始列數值、攤回鍵 → 區間中點 */
    originalNumbers: Float64Array | null;
    midpointByKey: Float64Array | null;
}

/** Pearson 相關係數；樣本不足或變異為 0 時回傳 0 */
const pearson = (xs: Float64Array, ys: Float64Array): number => {
    let count = 0; let sumX = 0; let sumY = 0;
    for (let index = 0; index < xs.length; index += 1) {
        if (Number.isNaN(xs[index]) || Number.isNaN(ys[index])) continue;
        count += 1; sumX += xs[index]; sumY += ys[index];
    }
    if (count < 2) return 0;
    const meanX = sumX / count; const meanY = sumY / count;
    let covariance = 0; let varianceX = 0; let varianceY = 0;
    for (let index = 0; index < xs.length; index += 1) {
        if (Number.isNaN(xs[index]) || Number.isNaN(ys[index])) continue;
        const deltaX = xs[index] - meanX; const deltaY = ys[index] - meanY;
        covariance += deltaX * deltaY; varianceX += deltaX * deltaX; varianceY += deltaY * deltaY;
    }
    if (varianceX <= 0 || varianceY <= 0) return 0;
    return covariance / Math.sqrt(varianceX * varianceY);
};

/**
 * 計算 K-匿名保真度三項指標。
 * @param input.evaluatedColumns 要評估的欄位（通常為直接識別以外、處理後仍存在的欄位）
 * @param input.anchorColumns 未經處理的欄位（敏感、非敏感），有列被刪除時用來配對
 */
export interface KAnonymityFidelityInput {
    originalCsvText: string;
    processedCsvText: string;
    evaluatedColumns: string[];
    anchorColumns: string[];
    /** 數值型欄位（Step2 資料型態「數值」）；兩欄皆為數值的欄位對改用相關係數相似度 */
    numericColumns?: string[];
    /** 送給後端的 K-匿名設定（config.k_anonymity），有列被刪除時用來輔助配對 */
    kAnonymityConfig?: Record<string, unknown> | null;
    sampleLimit?: number;
}

export const computeKAnonymityFidelity = (input: KAnonymityFidelityInput): KAnonymityFidelityResult | null => {
    const numericColumnSet = new Set((input.numericColumns ?? []).map(cleanName));
    const originalRows = parseCsvRows(input.originalCsvText);
    const processedRows = parseCsvRows(input.processedCsvText);
    if (originalRows.length < 2 || processedRows.length < 2) return null;
    const originalHeader = originalRows[0].map(cleanName);
    const processedHeader = processedRows[0].map(cleanName);
    const originalBody = originalRows.slice(1);
    const processedBody = processedRows.slice(1);
    const pairedIndexList = pairProcessedRows(originalHeader, originalBody, processedHeader, processedBody, input.anchorColumns,
        buildCompatibilityCheckers(input.kAnonymityConfig, originalHeader, processedHeader));
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
        // ★ 2026-10-16：平均攤到「涵蓋的分組」，而非涵蓋的原始值。原始值多半各不相同（例如精確到秒的時間）時，
        //   依原始值個數攤回等於照原始分布還原，泛化幾乎不會扣分；改為每個涵蓋的分組等權重，才符合「只知道區間、不知道區間內分布」。
        const toSpread = (coveredValues: Iterable<string>): Array<[number, number]> => {
            const coveredBins = new Set<number>();
            for (const value of coveredValues) {
                const bin = binner.binOf.get(value);
                if (bin !== undefined) coveredBins.add(bin);
            }
            return Array.from(coveredBins).map((bin) => [bin, 1 / coveredBins.size] as [number, number]);
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
        // 數值欄：原值與區間中點
        let originalNumbers: Float64Array | null = null;
        let midpointByKey: Float64Array | null = null;
        if (numericColumnSet.has(column) && allOriginalValues.every((value) => Number.isFinite(Number(value)))) {
            const midpointOf = (values: Iterable<string>): number => {
                let lowest = Infinity; let highest = -Infinity;
                for (const value of values) { const numberValue = Number(value); if (numberValue < lowest) lowest = numberValue; if (numberValue > highest) highest = numberValue; }
                return Number.isFinite(lowest) ? (lowest + highest) / 2 : NaN;
            };
            midpointByKey = new Float64Array(spreadByKey.length);
            midpointByKey[0] = midpointOf(binner.binOf.keys());
            coveredByOutput.forEach((coveredSet, outputValue) => { midpointByKey![keyOfOutput.get(outputValue)!] = midpointOf(coveredSet); });
            originalNumbers = new Float64Array(originalSampleIndexes.length);
            originalSampleIndexes.forEach((rowIndex, sampleIndex) => {
                const value = cellText(originalBody[rowIndex][originalColumnIndex]);
                originalNumbers![sampleIndex] = value === '' ? NaN : Number(value);
            });
        }
        columnModels.push({ name: column, binCount: binner.binCount, originalBins, processedKeys, spreadByKey, originalNumbers, midpointByKey });
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
            if (left.originalNumbers && right.originalNumbers && left.midpointByKey && right.midpointByKey) {
                // 數值 × 數值：相關係數相似度
                const toProcessedNumbers = (model: ColumnModel): Float64Array => {
                    const values = new Float64Array(model.processedKeys.length);
                    model.processedKeys.forEach((key, sampleIndex) => { values[sampleIndex] = key < 0 ? NaN : model.midpointByKey![key]; });
                    return values;
                };
                const originalCorrelation = pearson(left.originalNumbers, right.originalNumbers);
                const processedCorrelation = pearson(toProcessedNumbers(left), toProcessedNumbers(right));
                const score = 1 - Math.abs(originalCorrelation - processedCorrelation) / 2;
                itemScores.push({ label: `${left.name} × ${right.name}`, score });
                pairScores.push(score);
                continue;
            }
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

/**
 * 在 Web Worker 計算（★ 2026-10-30：處理前後兩份 CSV 全部解析成字串陣列，約佔檔案大小的 10～20 倍記憶體；
 * 改在 Worker 算完即結束 Worker，整塊記憶體一次釋放，也不卡畫面）。結果與 computeKAnonymityFidelity 相同（仍全部計算、不抽樣）。
 * 瀏覽器不支援或 Worker 啟動失敗時退回主執行緒計算。
 */
export const computeKAnonymityFidelityInWorker = (input: KAnonymityFidelityInput): Promise<KAnonymityFidelityResult | null> => {
    if (typeof Worker === 'undefined') return Promise.resolve(computeKAnonymityFidelity(input));
    let fidelityWorker: Worker;
    try {
        fidelityWorker = new Worker(new URL('./kAnonymityFidelity.worker.ts', import.meta.url), { type: 'module' });
    } catch (workerCreateError) {
        console.warn('資料實用性 Worker 無法啟動，改在主執行緒計算:', workerCreateError);
        return Promise.resolve(computeKAnonymityFidelity(input));
    }
    return new Promise<KAnonymityFidelityResult | null>((resolve, reject) => {
        fidelityWorker.onmessage = (event: MessageEvent<{ result?: KAnonymityFidelityResult | null; error?: string }>) => {
            fidelityWorker.terminate();
            if (event.data.error) reject(new Error(event.data.error));
            else resolve(event.data.result ?? null);
        };
        fidelityWorker.onerror = (workerError) => {
            fidelityWorker.terminate();
            console.warn('資料實用性 Worker 執行失敗，改在主執行緒計算:', workerError.message);
            try { resolve(computeKAnonymityFidelity(input)); } catch (computeError) { reject(computeError); }
        };
        fidelityWorker.postMessage({ input });
    });
};
