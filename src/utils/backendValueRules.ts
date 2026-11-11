/**
 * ============================================================================
 * 檔案名稱 (File): backendValueRules.ts
 * 模組功能 (Description): 與後端一致的「儲存格能否轉成數值／日期」判斷規則，以及逐欄統計累加器。
 * ★ 2026-10-05：以使用者本機後端（/api/v1/k-anonymity、/api/v1/dp）實測得到的規則：
 *   - 缺值：空白、NA、N/A、NULL、NaN、None 等（pandas 預設缺值字串）→ 視為缺值，不算錯誤。
 *     「-」「未知」「不詳」不是缺值字串 → 數值欄會失敗。
 *   - 數值：只接受一般十進位寫法（含正負號、小數、科學記號）。「1,234」（千分位）、「0x1A」（十六進位）
 *     → 失敗。（JavaScript 的 Number() 會把 0x1A 當成 26，故不能直接用 Number 判斷。）
 *   - 日期：須為西元年（4 位數）、日期要真實存在（2 月 30 日失敗），且「同一欄格式一致」：
 *     全欄 YYYY-MM-DD、全欄 YYYY/MM/DD、全欄含時間、全欄 ISO（…T10:00:00Z）都可以；
 *     YYYY-MM-DD 混 YYYY/M/D、混「日期＋時間」、混 19900102 → 失敗。月日補不補零可以混用。
 *   上傳檢查（csvUploadValidation.ts）與 Step2 檢查（columnTypeConsistency.ts，經 datasetProfile）共用本規則，
 *   確保兩處判斷與後端一致。
 * ============================================================================
 */

/** pandas read_csv 預設視為缺值的字串（keep_default_na=True） */
export const BACKEND_MISSING_VALUE_TOKENS: ReadonlySet<string> = new Set([
    '', '#N/A', '#N/A N/A', '#NA', '-1.#IND', '-1.#QNAN', '-NaN', '-nan', '1.#IND', '1.#QNAN',
    '<NA>', 'N/A', 'NA', 'NULL', 'NaN', 'None', 'n/a', 'nan', 'null'
]);

export const isBackendMissingValue = (trimmedValue: string): boolean => BACKEND_MISSING_VALUE_TOKENS.has(trimmedValue);

const STRICT_NUMERIC_PATTERN = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
/** 後端可轉成數值的寫法（不含千分位、十六進位） */
export const isStrictNumericValue = (trimmedValue: string): boolean => STRICT_NUMERIC_PATTERN.test(trimmedValue);

/** 數字串一律化為 9，用來比對「格式是否一致」：1990-01-02 與 1990-1-2 → 9-9-9；1990/01/02 → 9/9/9 */
export const toValueShape = (trimmedValue: string): string => trimmedValue.replace(/\d+/g, '9');

const DATE_SHAPE_PATTERN = /^9[-/.]9[-/.]9([ T]9:9(:9(\.9)?)?(Z|[+-]9(:9)?)?)?$/;
export const isDateShape = (valueShape: string): boolean => DATE_SHAPE_PATTERN.test(valueShape);

/** 日期是否真實存在（西元 4 位數年、月 1～12、日不超過當月天數、時分秒範圍） */
export const isValidCalendarDateValue = (trimmedValue: string): boolean => {
    const numbers = trimmedValue.match(/\d+/g);
    if (!numbers || numbers.length < 3 || numbers[0].length !== 4) return false;
    const [year, month, day] = numbers.slice(0, 3).map(Number);
    if (month < 1 || month > 12 || day < 1) return false;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day > daysInMonth) return false;
    if (numbers.length >= 5) {
        const [hour, minute] = [Number(numbers[3]), Number(numbers[4])];
        if (hour > 23 || minute > 59) return false;
        if (numbers.length >= 6 && Number(numbers[5]) > 59) return false;
    }
    return true;
};

const MAX_TRACKED_SHAPES_PER_COLUMN = 20;
const MAX_EXAMPLES_PER_BUCKET = 3;

export interface ValueExample { value: string; lineNumber?: number }

/** 單一欄位的統計（可序列化，存進 datasetProfile） */
export interface ColumnValueStats {
    /** 非缺值筆數 */
    nonMissingCount: number;
    /** 後端可轉成數值的筆數 */
    strictNumericCount: number;
    /** 無法轉成數值的範例 */
    nonNumericExamples: ValueExample[];
    /** 各格式（toValueShape）的筆數與範例；日期格式另記「日期不存在」（例：2 月 30 日）的筆數與範例 */
    shapes: Record<string, { count: number; examples: ValueExample[]; invalidDateCount: number; invalidDateExamples: ValueExample[] }>;
    /** 格式種類超過上限後不再追蹤新格式（一般文字欄位才會發生） */
    isShapesCapped: boolean;
    /** 未追蹤格式的筆數 */
    untrackedShapeCount: number;
}

export const createColumnValueStats = (): ColumnValueStats => ({
    nonMissingCount: 0, strictNumericCount: 0, nonNumericExamples: [], shapes: {}, isShapesCapped: false,
    untrackedShapeCount: 0
});

const pushExample = (list: ValueExample[], example: ValueExample): void => {
    if (list.length < MAX_EXAMPLES_PER_BUCKET && !list.some((item) => item.value === example.value)) list.push(example);
};

/** 累加一個儲存格（傳入已 trim 的值） */
export const addValueToColumnStats = (stats: ColumnValueStats, trimmedValue: string, lineNumber?: number): void => {
    if (isBackendMissingValue(trimmedValue)) return;
    stats.nonMissingCount++;
    const example: ValueExample = lineNumber === undefined ? { value: trimmedValue } : { value: trimmedValue, lineNumber };
    if (isStrictNumericValue(trimmedValue)) stats.strictNumericCount++;
    else pushExample(stats.nonNumericExamples, example);

    const valueShape = toValueShape(trimmedValue);
    let bucket = stats.shapes[valueShape];
    if (!bucket) {
        if (Object.keys(stats.shapes).length >= MAX_TRACKED_SHAPES_PER_COLUMN) {
            stats.isShapesCapped = true;
            stats.untrackedShapeCount++;
            return;
        }
        bucket = stats.shapes[valueShape] = { count: 0, examples: [], invalidDateCount: 0, invalidDateExamples: [] };
    }
    bucket.count++;
    pushExample(bucket.examples, example);
    if (isDateShape(valueShape) && !isValidCalendarDateValue(trimmedValue)) {
        bucket.invalidDateCount++;
        pushExample(bucket.invalidDateExamples, example);
    }
};

export interface ValueConflict { badCount: number; examples: ValueExample[] }

/** 若此欄位要當數值處理：無法轉換的筆數與範例；沒有問題時回傳 null */
export const evaluateNumericConflict = (stats: ColumnValueStats): ValueConflict | null => {
    const badCount = stats.nonMissingCount - stats.strictNumericCount;
    return badCount > 0 ? { badCount, examples: stats.nonNumericExamples } : null;
};

/** 出現最多的格式 */
export const getDominantShape = (stats: ColumnValueStats): { shape: string; count: number } | null => {
    let best: { shape: string; count: number } | null = null;
    for (const [shape, bucket] of Object.entries(stats.shapes)) if (!best || bucket.count > best.count) best = { shape, count: bucket.count };
    return best;
};

/**
 * 若此欄位要當日期處理：與主要日期格式不一致、或日期不存在的筆數與範例；沒有問題時回傳 null。
 * 主要格式不是日期格式（整欄幾乎都不是日期）時，所有非缺值都算無法轉換。
 */
export const evaluateDateConflict = (stats: ColumnValueStats): ValueConflict | null => {
    if (stats.nonMissingCount === 0) return null;
    const dominant = getDominantShape(stats);
    const dominantDateShape = dominant && isDateShape(dominant.shape) ? dominant.shape : null;
    const examples: ValueExample[] = [];
    let badCount = stats.untrackedShapeCount;
    for (const [shape, bucket] of Object.entries(stats.shapes)) {
        if (shape === dominantDateShape) {
            // 主要格式內「日期不存在」的值（例：1990-02-30）
            badCount += bucket.invalidDateCount;
            examples.unshift(...bucket.invalidDateExamples);
            continue;
        }
        badCount += bucket.count;
        examples.push(...bucket.examples);
    }
    return badCount > 0 ? { badCount, examples: examples.slice(0, MAX_EXAMPLES_PER_BUCKET) } : null;
};
