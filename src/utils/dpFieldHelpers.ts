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
