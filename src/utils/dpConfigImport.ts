/**
 * 匯入後端 config_dp.json（v1.2.0）之 differential_privacy.column_budgets，轉換為 Step2／Step3 使用的 DP 欄位設定。
 * 2026-10-01 自 DifferentialPrivacyMapping.tsx 的「匯入配置」抽出，並補上：
 *   - isDateTime：依 type（datetime／continuous）記錄，匯出時不再依欄位名稱猜測
 *   - sensitivity：保留設定檔指定的敏感度
 *   - noiseUnit：讀入日期欄位的 noise_unit（day／hour／minute／second），先前未讀、再匯出時一律變回 day
 * 與 utils/pipelineConfig.ts 的匯出邏輯互為反向，往返測試見 __tests__/backendConfigFormat.test.ts。
 */
import type { DPField } from '../store/useWorkspaceStore';
import { mapOutOfBoundsStrategyFromBackend, normalizeDpDatetimeNoiseUnit, clampDpNoiseStep, DEFAULT_DATETIME_LOWER_BOUND_DATE } from './dpFieldHelpers';

/** 與 DifferentialPrivacyMapping.tsx 相同的預設值 */
export const DP_IMPORT_DEFAULT_EPSILON_BUDGET = 1.0;
export const DP_IMPORT_DEFAULT_DELTA_BUDGET = 0.0001;
export const DP_IMPORT_DEFAULT_NUMERIC_UPPER_BOUND = 100;

export interface BackendDpColumnBudget {
    type?: string;
    epsilon?: number; delta?: number; epsilon_budget?: number; delta_budget?: number;
    sensitivity?: number; allowed_categories?: string;
    clipping_bounds?: [number, number]; minimum_unit?: number; out_of_bounds_strategy?: string;
    time_clipping_bounds?: [string, string]; time_out_of_bounds_strategy?: string; noise_step?: number; noise_unit?: string;
}

/**
 * 逐欄轉換。沒有 delta_budget（或為 0）即純 ε（ε-DP 模式，δ 欄位填預設值，切換到 (ε,δ)-DP 時才會用到）；
 * 沒有溢出策略即截斷。todayIsoDate 為日期欄位缺邊界時的預設上限。
 */
export const parseBackendDpColumnBudgets = (
    columnBudgetsMap: Record<string, BackendDpColumnBudget>,
    todayIsoDate: string = new Date().toISOString().slice(0, 10)
): Omit<DPField, 'id'>[] => Object.keys(columnBudgetsMap).map((columnName) => {
    const budgetItem = columnBudgetsMap[columnName] || {};
    const rawType = String(budgetItem.type || '').toLowerCase();
    // v1.2.0 欄位名稱為 epsilon_budget／delta_budget；仍相容本工具早期匯出格式的 epsilon／delta。
    const resolvedEpsilonValue = budgetItem.epsilon_budget ?? budgetItem.epsilon;
    const resolvedDeltaValue = budgetItem.delta_budget ?? budgetItem.delta;
    const isImportedDateTimeType = rawType === 'datetime';

    let mappedFieldTypeValue: DPField['fieldType'] = 'Unknown';
    if (['continuous', 'numeric', 'datetime'].includes(rawType)) mappedFieldTypeValue = 'Numeric';
    else if (rawType === 'categorical') mappedFieldTypeValue = 'Categorical';
    else if (['string', 'text'].includes(rawType)) mappedFieldTypeValue = 'Text';

    let calcLowerBound: number | string | undefined = undefined;
    let calcUpperBound: number | string | undefined = undefined;
    let calcMinimumUnit: number | undefined = undefined;
    let calcNoiseStep: number | undefined = undefined;
    let calcNoiseUnit: DPField['noiseUnit'] = undefined;
    let calcOutOfBoundsStrategy: DPField['outOfBoundsStrategy'] = undefined;

    if (mappedFieldTypeValue === 'Numeric' && isImportedDateTimeType) {
        // 日期時間型邊界在 time_clipping_bounds（ISO 日期字串），與連續值的 clipping_bounds 分屬不同欄位
        if (Array.isArray(budgetItem.time_clipping_bounds) && budgetItem.time_clipping_bounds.length === 2) {
            calcLowerBound = budgetItem.time_clipping_bounds[0];
            calcUpperBound = budgetItem.time_clipping_bounds[1];
        } else {
            calcLowerBound = DEFAULT_DATETIME_LOWER_BOUND_DATE;
            calcUpperBound = todayIsoDate;
        }
        // 後端不支援的單位（例如 month）退回 day
        calcNoiseUnit = normalizeDpDatetimeNoiseUnit(budgetItem.noise_unit) ?? 'day';
        // ★ 2026-10-02：步階超過該單位上限（例如 noise_unit second、noise_step 64）時夾回上限
        calcNoiseStep = clampDpNoiseStep(budgetItem.noise_step, calcNoiseUnit);
        calcOutOfBoundsStrategy = mapOutOfBoundsStrategyFromBackend(budgetItem.time_out_of_bounds_strategy);
    } else if (mappedFieldTypeValue === 'Numeric') {
        // 邊界優先直接讀 clipping_bounds，避免誤用 sensitivity 推算出與設定檔不符的邊界
        if (Array.isArray(budgetItem.clipping_bounds) && budgetItem.clipping_bounds.length === 2) {
            calcLowerBound = budgetItem.clipping_bounds[0];
            calcUpperBound = budgetItem.clipping_bounds[1];
        } else {
            calcLowerBound = 0;
            calcUpperBound = budgetItem.sensitivity !== undefined ? calcLowerBound + budgetItem.sensitivity : DP_IMPORT_DEFAULT_NUMERIC_UPPER_BOUND;
        }
        calcMinimumUnit = budgetItem.minimum_unit ?? 1;
        calcOutOfBoundsStrategy = mapOutOfBoundsStrategyFromBackend(budgetItem.out_of_bounds_strategy);
    } else if (mappedFieldTypeValue === 'Categorical') {
        calcLowerBound = 0;
        calcUpperBound = 1;
    }

    return {
        fieldName: columnName,
        fieldType: mappedFieldTypeValue,
        enabled: mappedFieldTypeValue !== 'Text',
        // 沒有 delta_budget 的連續數值／日期欄位：沿用全域 δ（不送 delta_budget，由 default_delta 補足）；0＝純 ε
        mode: (resolvedDeltaValue && resolvedDeltaValue > 0)
            ? 'epsilon-delta'
            : (resolvedDeltaValue === undefined && mappedFieldTypeValue === 'Numeric' ? 'default-delta' : 'epsilon'),
        epsilon: resolvedEpsilonValue ?? DP_IMPORT_DEFAULT_EPSILON_BUDGET,
        delta: resolvedDeltaValue ?? DP_IMPORT_DEFAULT_DELTA_BUDGET,
        lowerBound: calcLowerBound,
        upperBound: calcUpperBound,
        allowedCategories: mappedFieldTypeValue === 'Categorical' ? 'auto_extracted' : '',
        minimumUnit: calcMinimumUnit,
        noiseStep: calcNoiseStep,
        noiseUnit: calcNoiseUnit,
        outOfBoundsStrategy: calcOutOfBoundsStrategy,
        isDateTime: mappedFieldTypeValue === 'Numeric' ? isImportedDateTimeType : undefined,
        sensitivity: mappedFieldTypeValue === 'Numeric' && typeof budgetItem.sensitivity === 'number' && budgetItem.sensitivity > 0 ? budgetItem.sensitivity : undefined
    };
});
