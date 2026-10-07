/**
 * ============================================================================
 * 檔案名稱 (File): dpFieldHelpers.ts
 * 模組功能 (Description): 差分隱私 (DP) 欄位共用輔助函式 (日期時間型欄位判斷、
 *           前端策略命名與後端 config_dp.json 命名之雙向轉換)，供 Step2 欄位對應、
 *           Step3 規則設定與 Step4 後端送出邏輯共用，避免各檔案各自實作出現不一致。
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則
 * ============================================================================
 */

// 日期時間型欄位命名關鍵字：與「年齡/薪資」等一般數值型欄位共用 fieldType === 'Numeric'，
// 但邊界應為日期字串而非單純數字，故需另外以欄位名稱／原始資料型態字串判斷是否為日期時間型。
const DATETIME_FIELD_NAME_PATTERN = /(date|time|birthday|birth_date|dob|生日|日期|出生)/i;

/**
 * 函數名稱: isDateTimeDpField
 * 函數功能: 依欄位名稱與（可選的）原始資料集欄位型態字串，判斷該數值型 DP 欄位是否應視為
 *           日期時間型 (config_dp.json 之 type: "datetime")，而非一般連續數值型 (type: "continuous")。
 */
export const isDateTimeDpField = (fieldNameStr: string, originalColumnTypeStr?: string): boolean =>
{
    if (originalColumnTypeStr && /(date|time|日期|時間)/i.test(originalColumnTypeStr)) return true;
    return DATETIME_FIELD_NAME_PATTERN.test(fieldNameStr);
};

/**
 * 依 DP 欄位設定判斷是否為日期時間型：匯入設定檔時已記錄 isDateTime（依 config_dp.json 的 type: "datetime"／
 * "continuous"）就以此為準，否則才退回以欄位名稱／原始型態推斷。
 * ★ 2026-10-01：先前一律依名稱推斷，名稱不含關鍵字的日期欄位（如「入院日」）匯入後會被當成連續數值匯出
 *   （溢出策略寫成 out_of_bounds_strategy、邊界變成 NaN），名稱含「出生」的數值欄位（如「出生體重」）則相反。
 */
export const resolveIsDateTimeDpField = (field: { fieldName: string; isDateTime?: boolean }, originalColumnTypeStr?: string): boolean =>
    typeof field.isDateTime === 'boolean' ? field.isDateTime : isDateTimeDpField(field.fieldName, originalColumnTypeStr);

// config_dp.json 邊界溢出處理策略之後端命名，對應本工具 UI 顯示用之 clip／wrap／reflect。
export type UiOutOfBoundsStrategy = 'clip' | 'wrap' | 'reflect';
export type BackendOutOfBoundsStrategy = 'clamp' | 'wrap' | 'fold';

/**
 * 函數名稱: mapOutOfBoundsStrategyToBackend
 * 函數功能: 將 UI 顯示用之邊界溢出策略 (clip／wrap／reflect) 轉換為後端 config_dp.json
 *           所需之命名 (clamp／wrap／fold)。
 */
export const mapOutOfBoundsStrategyToBackend = (uiStrategyValue: string | undefined): BackendOutOfBoundsStrategy =>
{
    if (uiStrategyValue === 'wrap') return 'wrap';
    if (uiStrategyValue === 'reflect') return 'fold';
    return 'clamp';
};

/**
 * 函數名稱: mapOutOfBoundsStrategyFromBackend
 * 函數功能: 將後端 config_dp.json 之邊界溢出策略命名 (clamp／wrap／fold) 轉換為本工具 UI
 *           顯示用之命名 (clip／wrap／reflect)，供「匯入配置」功能還原每欄設定使用。
 */
export const mapOutOfBoundsStrategyFromBackend = (backendStrategyValue: string | undefined): UiOutOfBoundsStrategy =>
{
    const normalizedStrategyValue = String(backendStrategyValue ?? '').trim().toLowerCase();
    if (normalizedStrategyValue === 'wrap') return 'wrap';
    // ★ 2026-10-01：同時接受本工具 UI 命名（reflect／clip），避免手寫或舊版設定檔的 reflect 被誤讀成截斷
    if (normalizedStrategyValue === 'fold' || normalizedStrategyValue === 'reflect') return 'reflect';
    // clamp／clip／未填寫：截斷（後端未填寫時的預設）
    return 'clip';
};

// 日期時間型欄位邊界之預設下限；上限則於使用處以「今天」動態計算，避免寫死未來日期。
export const DEFAULT_DATETIME_LOWER_BOUND_DATE = '1900-01-01';

/**
 * 依目前數值的小數位數推算 InputNumber 上下按鈕的步進值（整數 → 1、72.5 → 0.1、0.01 → 0.01）。
 * ★ 修正（2026-09-29）：DP 邊界與加噪刻度原本寫 step="any"，但 Ant Design InputNumber 會把 step
 *   轉成數字（Number('any') = NaN），導致上下按鈕加減後得到 NaN 而完全沒反應，只能手動輸入。
 *   HTML 原生 input 的 "any" 在這裡不適用，改傳實際數字；手動輸入任意小數仍不受步進值限制。
 */
export const resolveInputNumberStepByDecimals = (currentValue: unknown, fallbackStep = 1): number => {
    if (currentValue === undefined || currentValue === null || currentValue === '') return fallbackStep;
    const numericValue = Number(currentValue);
    if (!Number.isFinite(numericValue)) return fallbackStep;
    const valueText = String(numericValue);
    if (/e/i.test(valueText)) return fallbackStep;
    const decimalsCount = valueText.includes('.') ? valueText.split('.')[1].length : 0;
    return decimalsCount === 0 ? 1 : Number((10 ** -Math.min(decimalsCount, 10)).toFixed(Math.min(decimalsCount, 10)));
};

/**
 * 日期時間型欄位的雜訊單位（config_dp.json 之 noise_unit）。依後端《2_操作說明.md》4-2 節，可為 day／hour／minute／second；
 * noise_step 為幾個 noise_unit 算一格，sensitivity 的單位也跟著 noise_unit（範例生日：day、noise_step 7、sensitivity 365 即 365 天）。
 * ★ 2026-10-01：先前前端固定送 day，無法處理到時／分／秒。
 */
export const DP_DATETIME_NOISE_UNITS = ['day', 'hour', 'minute', 'second'] as const;
export type DpDatetimeNoiseUnit = typeof DP_DATETIME_NOISE_UNITS[number];
export const DEFAULT_DP_DATETIME_NOISE_UNIT: DpDatetimeNoiseUnit = 'day';

/** 每個雜訊單位的毫秒數，供邊界寬度換算成敏感度 */
export const DP_DATETIME_NOISE_UNIT_MILLISECONDS: Record<DpDatetimeNoiseUnit, number> = {
    day: 86400000, hour: 3600000, minute: 60000, second: 1000
};

/**
 * 各雜訊單位的加噪步階上限（2026-10-02）：步階不應超過進位到上一級單位前的最大值——秒、分 ≤ 59，時 ≤ 23；
 * 天沒有更大的雜訊單位，不設上限。超過時應改用較大的雜訊單位（例如 90 秒 → 改為分）。
 */
export const DP_DATETIME_NOISE_STEP_MAX: Record<DpDatetimeNoiseUnit, number | undefined> = {
    day: undefined, hour: 23, minute: 59, second: 59
};

/** 此雜訊單位的加噪步階上限（無上限時回傳 undefined） */
export const resolveDpNoiseStepMax = (noiseUnit: DpDatetimeNoiseUnit): number | undefined => DP_DATETIME_NOISE_STEP_MAX[noiseUnit];

/** 把加噪步階夾在 1～該單位上限之間；未設定步階時原樣回傳 undefined */
export const clampDpNoiseStep = (noiseStep: number | undefined, noiseUnit: DpDatetimeNoiseUnit): number | undefined => {
    if (noiseStep === undefined || noiseStep === null || Number.isNaN(Number(noiseStep))) return noiseStep;
    const maxStepValue = resolveDpNoiseStepMax(noiseUnit);
    const flooredStepValue = Math.max(1, Number(noiseStep));
    return maxStepValue === undefined ? flooredStepValue : Math.min(flooredStepValue, maxStepValue);
};

/** 加噪步階是否超出該單位上限 */
export const isDpNoiseStepOutOfRange = (noiseStep: number | undefined, noiseUnit: DpDatetimeNoiseUnit): boolean => {
    if (noiseStep === undefined || noiseStep === null) return false;
    const maxStepValue = resolveDpNoiseStepMax(noiseUnit);
    return Number(noiseStep) < 1 || (maxStepValue !== undefined && Number(noiseStep) > maxStepValue);
};

/** 匯入時正規化 noise_unit（不分大小寫、去空白）；不是後端支援的單位時回傳 undefined，由呼叫端退回預設 day */
export const normalizeDpDatetimeNoiseUnit = (rawNoiseUnit: unknown): DpDatetimeNoiseUnit | undefined => {
    const normalizedUnitText = String(rawNoiseUnit ?? '').trim().toLowerCase();
    return (DP_DATETIME_NOISE_UNITS as readonly string[]).includes(normalizedUnitText) ? normalizedUnitText as DpDatetimeNoiseUnit : undefined;
};

/** 欄位實際使用的雜訊單位（未設定或無效時為 day） */
export const resolveDpDatetimeNoiseUnit = (field: { noiseUnit?: string }): DpDatetimeNoiseUnit =>
    normalizeDpDatetimeNoiseUnit(field.noiseUnit) ?? DEFAULT_DP_DATETIME_NOISE_UNIT;

/**
 * 切換雜訊單位時換算使用者指定的敏感度，讓它代表的時間長度不變（例如 365 天 → 8760 時）。
 * 結果四捨五入、至少為 1；未指定（undefined）時維持未指定。
 */
export const convertDpSensitivityBetweenNoiseUnits = (
    sensitivityValue: number | undefined, fromUnit: DpDatetimeNoiseUnit, toUnit: DpDatetimeNoiseUnit
): number | undefined => {
    if (sensitivityValue === undefined || !Number.isFinite(sensitivityValue) || sensitivityValue <= 0) return undefined;
    const convertedValue = sensitivityValue * DP_DATETIME_NOISE_UNIT_MILLISECONDS[fromUnit] / DP_DATETIME_NOISE_UNIT_MILLISECONDS[toUnit];
    return Math.max(1, Math.round(convertedValue));
};

/**
 * 日期時間邊界字串轉時間戳（毫秒）。「YYYY-MM-DD」與「YYYY-MM-DD HH:mm[:ss]」一律當 UTC 解讀，
 * 避免 Date.parse 對純日期採 UTC、對帶時間者採本地時區，兩者混用時敏感度差了時區的小時數。無法解析時回傳 NaN。
 */
export const parseDpDateTimeBoundTimestamp = (boundValue: unknown): number => {
    const boundText = String(boundValue ?? '').trim();
    const matched = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2})(?::(\d{2})(?::(\d{2}))?)?)?$/.exec(boundText);
    if (!matched) return Date.parse(boundText);
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = matched;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
};

/**
 * Step2 日期邊界選擇器一律可選到秒（顯示 YYYY-MM-DD HH:mm:ss）。寫入設定檔（time_clipping_bounds）時，
 * 時間為 00:00:00 者只留日期（與後端範例 config_dp.json 的 1930-01-01 寫法一致，匯入再匯出內容不變），否則保留到秒。
 * ★ 2026-10-01：先前依 Step3 雜訊單位決定能否選時間，但 Step2 在 Step3 之前設定、雜訊單位預設為天，實際只能選到天。
 */
export const DP_DATETIME_BOUND_PICKER_DISPLAY_FORMAT = 'YYYY-MM-DD HH:mm:ss';
export const DP_DATETIME_BOUND_PICKER_TIME_FORMAT = 'HH:mm:ss';

/** 選擇器輸出的「YYYY-MM-DD HH:mm:ss」字串轉成寫入設定檔的邊界字串（午夜只留日期） */
export const compactDpDateTimeBoundText = (dateTimeText: string): string => dateTimeText.replace(/[ T]00:00:00$/, '');

/**
 * 上下限字串實際用到的最細時間單位：有非 0 的秒為 second、分為 minute、時為 hour，否則為 day。
 * 用於 Step3 提醒「邊界比雜訊單位細」——此時敏感度與加噪都以較粗的雜訊單位計，邊界的時間部分會被四捨五入。
 */
export const detectDpDateTimeBoundsFinestUnit = (boundValues: unknown[]): DpDatetimeNoiseUnit => {
    let finestUnitIndex = 0;
    boundValues.forEach((boundValue) => {
        const matched = /^\d{4}-\d{2}-\d{2}[ T](\d{2})(?::(\d{2})(?::(\d{2}))?)?$/.exec(String(boundValue ?? '').trim());
        if (!matched) return;
        const [, hourText, minuteText = '00', secondText = '00'] = matched;
        if (Number(secondText) !== 0) finestUnitIndex = Math.max(finestUnitIndex, 3);
        else if (Number(minuteText) !== 0) finestUnitIndex = Math.max(finestUnitIndex, 2);
        else if (Number(hourText) !== 0) finestUnitIndex = Math.max(finestUnitIndex, 1);
    });
    return DP_DATETIME_NOISE_UNITS[finestUnitIndex];
};

/** 邊界比所選雜訊單位細時回傳邊界的最細單位，否則回傳 null */
export const findDpBoundsFinerThanNoiseUnit = (field: { lowerBound?: unknown; upperBound?: unknown; noiseUnit?: string }): DpDatetimeNoiseUnit | null => {
    const boundsFinestUnit = detectDpDateTimeBoundsFinestUnit([field.lowerBound, field.upperBound]);
    return DP_DATETIME_NOISE_UNITS.indexOf(boundsFinestUnit) > DP_DATETIME_NOISE_UNITS.indexOf(resolveDpDatetimeNoiseUnit(field)) ? boundsFinestUnit : null;
};

/** 時間戳（以 UTC 解讀，見 parseDpDateTimeBoundTimestamp）轉回邊界字串：午夜只留日期，其餘到秒 */
export const formatDpDateTimeBoundFromTimestamp = (timestamp: number): string =>
    compactDpDateTimeBoundText(new Date(timestamp).toISOString().slice(0, 19).replace('T', ' '));

/** 換雜訊單位：一併把已指定的敏感度換算成新單位（代表的時間長度不變），Step3 選單與 Step3→Step4 提醒視窗共用 */
export const applyDpDatetimeNoiseUnit = <FieldType extends { noiseUnit?: string; sensitivity?: number; noiseStep?: number }>(field: FieldType, nextNoiseUnit: DpDatetimeNoiseUnit): FieldType => ({
    ...field,
    noiseUnit: nextNoiseUnit,
    sensitivity: convertDpSensitivityBetweenNoiseUnits(field.sensitivity, resolveDpDatetimeNoiseUnit(field), nextNoiseUnit),
    // ★ 2026-10-02：換成較小的單位時，步階一併夾在新單位上限內（例如 90 分改成時以外的「秒」→ 59）
    noiseStep: clampDpNoiseStep(field.noiseStep, nextNoiseUnit)
});

/**
 * 已啟用的日期時間欄位中，上下限比雜訊單位細的欄位清單（Step3 按「下一步」時跳出提醒用）。
 * 例如邊界 2026-12-31 23:59:59（細到秒）而雜訊單位為天：敏感度與加噪都以天計，邊界的時間部分被四捨五入。
 */
export const listDpFieldsWithBoundsFinerThanNoiseUnit = (
    dpFields: { id?: string; fieldName: string; enabled?: boolean; fieldType?: string; isDateTime?: boolean; lowerBound?: unknown; upperBound?: unknown; noiseUnit?: string }[] | null | undefined
): { fieldId?: string; fieldName: string; boundsUnit: DpDatetimeNoiseUnit; noiseUnit: DpDatetimeNoiseUnit }[] =>
    (dpFields ?? []).flatMap((field) => {
        if (!field.enabled || field.fieldType !== 'Numeric' || !resolveIsDateTimeDpField(field)) return [];
        const boundsUnit = findDpBoundsFinerThanNoiseUnit(field);
        return boundsUnit ? [{ fieldId: field.id, fieldName: field.fieldName, boundsUnit, noiseUnit: resolveDpDatetimeNoiseUnit(field) }] : [];
    });

// ============================================================================
// TODO【待後端確認：DP格點起算點】
//   目前依後端現行規格：數值型從 0、時間型從 1970-01-01 起算格點，邊界向外對齊。
//   已提議後端改為「從資料下限起算」（輸出 = 下限 + k × 刻度）；若後端採用，需移除下限對齊、
//   改為只把上限對齊到「下限 + 整數個刻度」。詳見專案文件「【待後端確認】DP加噪格點起算點.md」。
// ============================================================================
/**
 * 把連續數值型的上下限對齊加噪刻度（minimum_unit）的整數倍：下限向下取、上限向上取。
 * ★ 2026-10-06：後端說明 minimum_unit「加噪前除以刻度化為整數，加噪後再乘回，故輸出為該單位的整數倍」，
 *   但截斷／環繞／鏡像是在乘回之後以 clipping_bounds 處理；邊界不是刻度倍數時（例：刻度 20、下限 15），
 *   鏡像得 2×15−0 = 30、截斷得 15，輸出就不再是刻度倍數。送出前把邊界向外對齊刻度即可避免。
 *   邊界向外放寬，原本在範圍內的資料仍在範圍內；敏感度仍以使用者原始邊界計算（clipping_bounds 只是後處理）。
 *   刻度未設定、≤0、非數字，或邊界非數字時回傳 null（不對齊）。
 */
export const alignDpBoundsToMinimumUnit = (
    lowerBound: unknown, upperBound: unknown, minimumUnit: unknown
): { lower: number; upper: number; changed: boolean } | null => {
    const unitValue = Number(minimumUnit);
    const lowerValue = Number(lowerBound);
    const upperValue = Number(upperBound);
    if (minimumUnit === undefined || minimumUnit === null || minimumUnit === '' || !Number.isFinite(unitValue) || unitValue <= 0) return null;
    if (lowerBound === undefined || lowerBound === null || lowerBound === '' || upperBound === undefined || upperBound === null || upperBound === '') return null;
    if (!Number.isFinite(lowerValue) || !Number.isFinite(upperValue)) return null;
    // 浮點容差：避免 0.3 / 0.1 = 2.9999999999999996 被向下取成 2
    const toleranceValue = 1e-9;
    const decimalsCount = (() => {
        const unitText = String(unitValue);
        if (/e/i.test(unitText)) return 10;
        return unitText.includes('.') ? Math.min(unitText.split('.')[1].length, 10) : 0;
    })();
    const roundToUnitDecimals = (value: number): number => Number(value.toFixed(decimalsCount));
    const alignedLower = roundToUnitDecimals(Math.floor(lowerValue / unitValue + toleranceValue) * unitValue);
    const alignedUpper = roundToUnitDecimals(Math.ceil(upperValue / unitValue - toleranceValue) * unitValue);
    // -0 統一為 0，避免 JSON 出現 -0 或畫面顯示 -0
    const normalizeZero = (value: number): number => (Object.is(value, -0) ? 0 : value);
    const lower = normalizeZero(alignedLower);
    const upper = normalizeZero(alignedUpper);
    return { lower, upper, changed: Math.abs(lower - lowerValue) > toleranceValue || Math.abs(upper - upperValue) > toleranceValue };
};

// ============================================================================
// TODO【待後端確認：DP格點起算點】
//   目前依後端現行規格：數值型從 0、時間型從 1970-01-01 起算格點，邊界向外對齊。
//   已提議後端改為「從資料下限起算」（輸出 = 下限 + k × 刻度）；若後端採用，需移除下限對齊、
//   改為只把上限對齊到「下限 + 整數個刻度」。詳見專案文件「【待後端確認】DP加噪格點起算點.md」。
// ============================================================================
/**
 * 日期時間型的上下限對齊加噪格點（noise_step × noise_unit）：下限向下取、上限向上取，回傳寫入設定檔用的邊界字串。
 * ★ 2026-10-06：實測後端輸出的日期皆為「1970-01-01 起算」的 noise_step 個 noise_unit 的整數倍
 *   （例：步階 7 天 → 2024-01-04、01-11、01-18、01-25 皆為星期四；步階 13 秒 → 距 1970-01-01 00:00:00 的秒數皆可被 13 整除），
 *   即與數值型 minimum_unit 相同：先化為格點再加噪。但截斷／環繞／鏡像以 time_clipping_bounds 處理，
 *   邊界不在格點上時（例：下限 2024-01-01）被截斷的值會落在 2024-01-01，不再是 7 天格點。比照數值型，送出前向外對齊。
 *   時間一律以 UTC 解讀（與 parseDpDateTimeBoundTimestamp 一致，後端格點亦以無時區的 1970-01-01 起算）。
 *   邊界無法解析、步階 ≤ 0 時回傳 null（不對齊）。
 */
export const alignDpDateTimeBoundsToNoiseGrid = (
    lowerBound: unknown, upperBound: unknown, noiseUnit: DpDatetimeNoiseUnit, noiseStep: unknown
): { lower: string; upper: string; changed: boolean } | null => {
    const lowerTimestamp = parseDpDateTimeBoundTimestamp(lowerBound);
    const upperTimestamp = parseDpDateTimeBoundTimestamp(upperBound);
    if (Number.isNaN(lowerTimestamp) || Number.isNaN(upperTimestamp)) return null;
    const stepCount = noiseStep === undefined || noiseStep === null || noiseStep === '' ? 1 : Number(noiseStep);
    if (!Number.isFinite(stepCount) || stepCount <= 0) return null;
    const gridMilliseconds = DP_DATETIME_NOISE_UNIT_MILLISECONDS[noiseUnit] * stepCount;
    const alignedLowerTimestamp = Math.floor(lowerTimestamp / gridMilliseconds) * gridMilliseconds;
    const alignedUpperTimestamp = Math.ceil(upperTimestamp / gridMilliseconds) * gridMilliseconds;
    return {
        lower: formatDpDateTimeBoundFromTimestamp(alignedLowerTimestamp),
        upper: formatDpDateTimeBoundFromTimestamp(alignedUpperTimestamp),
        changed: alignedLowerTimestamp !== lowerTimestamp || alignedUpperTimestamp !== upperTimestamp
    };
};
