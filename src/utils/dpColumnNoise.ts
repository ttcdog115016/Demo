/**
 * ============================================================================
 * 檔案名稱 (File): dpColumnNoise.ts
 * 模組功能 (Description): 差分隱私「每個欄位加了多少雜訊」與「整份資料可用性」的白話判斷
 *                         （Step3 運算前預估、Step4 運算後結果共用同一套規則）
 * ============================================================================
 * ★ 2026-10-12 使用者反映：Step4「加入的雜訊：雜訊少」與實際不符。原本以「各欄 ε 加總」判斷，
 *   但每欄實際加的雜訊取決於「該欄自己的 ε」與「該欄的敏感度／數值範圍」：6 欄合計 17，
 *   平均每欄約 2.8，以預設敏感度（＝上下限寬度）計算，平均偏差約為範圍的 1/ε ≈ 35%。
 *   使用者決定（給沒有相關知識的人員操作）：
 *   - 每欄依「平均偏差 ÷ 上下限範圍」（類別型：被換成其他類別的比例）判斷，門檻 5%／15%。
 *   - 整份資料可用性看「雜訊多的欄位佔多少」（summarizeDpUtility）。
 *   - Step3 預估與 Step4 結果用同一套規則，兩邊說法一致。
 *   ★ 同日使用者再決定：Step3「低保護」卻顯示「預估可用性：低」看起來矛盾，Step3／Step4 都還原為原本以 ε 合計判斷。
 *     本檔目前沒有畫面使用，保留供日後參考（測試：__tests__/dpColumnNoise.test.ts）。
 *
 * 計算方式（以「刻度」為單位；後端報告的 sensitivity 已換算為刻度數）：
 *   - DiscreteLaplace：尺度 b = 敏感度 ÷ ε，平均偏差 ≈ b
 *   - DiscreteGaussian：σ = 敏感度 × √(2 ln(1.25/δ)) ÷ ε，平均偏差 ≈ σ × √(2/π)
 *   - k-RR（類別型）：值被換成其他類別的機率 = (k−1) ÷ (e^ε + k−1)，k 為類別數
 *   以上為標準定義，後端離散實作可能略有差異，數字為概估。
 *   Step3 尚無後端報告，以設定推算：δ > 0 視為 Gaussian、δ = 0 視為 Laplace、類別型視為 k-RR（待後端確認）。
 */
import type { DpPerColumnBudgetReport } from '../api/apiService';
import { DP_DATETIME_NOISE_UNIT_MILLISECONDS, parseDpDateTimeBoundTimestamp, resolveDpDatetimeNoiseUnit, type DpDatetimeNoiseUnit } from './dpFieldHelpers';
import { resolveDpSensitivity, type DpStoreField } from './pipelineConfig';

export type DpNoiseLevel = 1 | 2 | 3; // 1 少、2 中等、3 多

/** 每欄判斷門檻（比例）：< low 雜訊少；low ~ < high 中等；≥ high 雜訊多 */
export const DP_NOISE_RATIO_THRESHOLDS = { low: 0.05, high: 0.15 } as const;

export const DP_NOISE_LEVEL_TEXT: Record<DpNoiseLevel, string> = { 1: '雜訊少', 2: '雜訊中等', 3: '雜訊多' };

const DATETIME_UNIT_TEXT: Record<string, string> = { day: '天', hour: '小時', minute: '分鐘', second: '秒' };

export interface DpColumnNoiseInfo {
    level: DpNoiseLevel;
    levelText: string;
    /** 判斷依據的比例（0~1）：連續／日期為平均偏差佔上下限寬度、類別為被換掉的比例 */
    ratio: number;
    /** 白話細節，例如「平均偏差約 ±12（約範圍的 10%）」 */
    detailText: string;
}

export interface DpColumnNoiseInput {
    report: DpPerColumnBudgetReport;
    lowerBound?: number | string;
    upperBound?: number | string;
    /** 類別型欄位的類別數（取自資料集掃描）；未知時無法計算 */
    categoryCount?: number | null;
}

export const classifyDpNoiseRatio = (ratio: number): DpNoiseLevel =>
    ratio < DP_NOISE_RATIO_THRESHOLDS.low ? 1 : ratio < DP_NOISE_RATIO_THRESHOLDS.high ? 2 : 3;

const formatNumber = (value: number): string => {
    if (value >= 100) return Math.round(value).toLocaleString();
    if (value >= 10) return value.toFixed(1).replace(/\.0$/, '');
    return Number(value.toPrecision(2)).toString();
};

const formatPercent = (ratio: number): string => {
    const percent = ratio * 100;
    if (percent >= 1000) return '超過 10 倍';
    return percent < 1 ? '不到 1%' : `${Math.round(percent)}%`;
};

const isPresent = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

/** 單一欄位的雜訊多寡；資訊不足（沒有上下限、類別數未知、ε 無效）時回傳 null，不下結論 */
export const describeDpColumnNoise = ({ report, lowerBound, upperBound, categoryCount }: DpColumnNoiseInput): DpColumnNoiseInfo | null => {
    const epsilon = Number(report.epsilon);
    if (!Number.isFinite(epsilon) || epsilon <= 0) return null;

    if (report.type === 'categorical' || report.mechanism === 'k-RR') {
        if (typeof categoryCount !== 'number' || categoryCount < 2) return null;
        const changeRatio = (categoryCount - 1) / (Math.exp(epsilon) + categoryCount - 1);
        const level = classifyDpNoiseRatio(changeRatio);
        return {
            level, levelText: DP_NOISE_LEVEL_TEXT[level], ratio: changeRatio,
            detailText: `約 ${formatPercent(changeRatio)} 的值會被隨機換成其他類別（共 ${categoryCount.toLocaleString()} 類）`
        };
    }

    // 刻度大小與上下限寬度（皆以「刻度」計）
    const isDateTime = report.type === 'datetime';
    const datetimeUnit = (report.noise_unit || 'day') as DpDatetimeNoiseUnit;
    const noiseStep = Number(report.noise_step) > 0 ? Number(report.noise_step) : 1;
    const minimumUnit = Number(report.minimum_unit) > 0 ? Number(report.minimum_unit) : 1;
    let rangeInSteps: number | null = null;
    if (isPresent(lowerBound) && isPresent(upperBound)) {
        if (isDateTime) {
            const lowerMs = parseDpDateTimeBoundTimestamp(lowerBound);
            const upperMs = parseDpDateTimeBoundTimestamp(upperBound);
            const unitMs = DP_DATETIME_NOISE_UNIT_MILLISECONDS[datetimeUnit] ?? DP_DATETIME_NOISE_UNIT_MILLISECONDS.day;
            if (Number.isFinite(lowerMs) && Number.isFinite(upperMs) && upperMs > lowerMs) rangeInSteps = (upperMs - lowerMs) / (unitMs * noiseStep);
        } else {
            const lower = Number(lowerBound);
            const upper = Number(upperBound);
            if (Number.isFinite(lower) && Number.isFinite(upper) && upper > lower) rangeInSteps = (upper - lower) / minimumUnit;
        }
    }
    // 沒有上下限：無法換算成比例，不下結論
    if (rangeInSteps === null) return null;
    const sensitivityInSteps = typeof report.sensitivity === 'number' && report.sensitivity > 0 ? report.sensitivity : rangeInSteps;

    const isGaussian = /gauss/i.test(String(report.mechanism));
    const delta = Number(report.delta);
    const typicalDeviationInSteps = isGaussian && delta > 0 && delta < 1
        ? (sensitivityInSteps * Math.sqrt(2 * Math.log(1.25 / delta)) / epsilon) * Math.sqrt(2 / Math.PI)
        : sensitivityInSteps / epsilon;

    const deviationText = isDateTime
        ? `平均偏差約 ±${formatNumber(typicalDeviationInSteps * noiseStep)} ${DATETIME_UNIT_TEXT[datetimeUnit] ?? datetimeUnit}`
        : `平均偏差約 ±${formatNumber(typicalDeviationInSteps * minimumUnit)}`;
    const ratio = typicalDeviationInSteps / rangeInSteps;
    const level = classifyDpNoiseRatio(ratio);
    return { level, levelText: DP_NOISE_LEVEL_TEXT[level], ratio, detailText: `${deviationText}（約範圍的 ${formatPercent(ratio)}）` };
};

/**
 * Step3 運算前預估：以欄位設定推算後端會用的 ε、δ、機制與敏感度，再套用 describeDpColumnNoise。
 * @param input.field Step2／Step3 的欄位設定（fieldType：Numeric／Categorical）
 * @param input.epsilon 要預估的 ε（目前設定值，或保護強度選項平均分配後的值）
 * @param input.globalDelta 全域 δ（「沿用全域 δ」模式使用）
 * @param input.isDateTime 是否為日期時間欄位
 * @param input.categoryCount 類別型欄位的類別數
 */
export const estimateDpColumnNoiseFromSettings = (input: {
    field: DpStoreField;
    epsilon: number;
    globalDelta: number | null | undefined;
    isDateTime: boolean;
    categoryCount?: number | null;
}): DpColumnNoiseInfo | null => {
    const { field, isDateTime } = input;
    const isCategorical = field.fieldType === 'Categorical';
    const delta = field.mode === 'epsilon-delta' ? Number(field.delta || 0) : field.mode === 'default-delta' ? Number(input.globalDelta || 0) : 0;
    if (isCategorical) {
        return describeDpColumnNoise({
            report: { column: field.fieldName, type: 'categorical', mechanism: 'k-RR', epsilon: input.epsilon, sensitivity: null, sensitivity_source: null },
            categoryCount: input.categoryCount
        });
    }
    const sensitivity = resolveDpSensitivity(field, isDateTime); // 數值：原單位；日期：雜訊單位
    const minimumUnit = Number(field.minimumUnit) > 0 ? Number(field.minimumUnit) : 1;
    const noiseStep = Number(field.noiseStep) > 0 ? Number(field.noiseStep) : 1;
    const sensitivityInSteps = sensitivity !== null && sensitivity > 0 ? sensitivity / (isDateTime ? noiseStep : minimumUnit) : null;
    return describeDpColumnNoise({
        report: {
            column: field.fieldName,
            type: isDateTime ? 'datetime' : 'continuous',
            mechanism: delta > 0 ? 'DiscreteGaussian' : 'DiscreteLaplace',
            epsilon: input.epsilon,
            delta,
            sensitivity: sensitivityInSteps,
            sensitivity_source: null,
            minimum_unit: minimumUnit,
            noise_unit: resolveDpDatetimeNoiseUnit(field),
            noise_step: noiseStep
        },
        lowerBound: field.lowerBound,
        upperBound: field.upperBound
    });
};

export interface DpUtilitySummary {
    /** 1 高、2 中、3 低（與 plainResultSummary 的可用性等級同序） */
    level: 1 | 2 | 3;
    /** 雜訊多的欄位名稱 */
    noisyColumns: string[];
    /** 雜訊中等的欄位名稱 */
    mediumColumns: string[];
    /** 雜訊少的欄位數 */
    lowCount: number;
    /** 有判斷結果的欄位數 */
    evaluatedCount: number;
}

/**
 * 整份資料的可用性：看「雜訊多的欄位佔多少」。
 *   - 高：沒有雜訊多的欄位，且超過一半的欄位雜訊少
 *   - 低：一半以上的欄位雜訊多
 *   - 中：其他情況（有雜訊多的欄位但不到一半，或多數欄位雜訊中等）
 *   沒有任何欄位可判斷時回傳 null。
 */
export const summarizeDpUtility = (items: { column: string; info: DpColumnNoiseInfo | null }[]): DpUtilitySummary | null => {
    const evaluatedItems = items.filter((item): item is { column: string; info: DpColumnNoiseInfo } => item.info !== null);
    if (evaluatedItems.length === 0) return null;
    const noisyColumns = evaluatedItems.filter((item) => item.info.level === 3).map((item) => item.column);
    const mediumColumns = evaluatedItems.filter((item) => item.info.level === 2).map((item) => item.column);
    const lowCount = evaluatedItems.filter((item) => item.info.level === 1).length;
    const evaluatedCount = evaluatedItems.length;
    const level: 1 | 2 | 3 = noisyColumns.length * 2 >= evaluatedCount
        ? 3
        : noisyColumns.length === 0 && lowCount * 2 > evaluatedCount ? 1 : 2;
    return { level, noisyColumns, mediumColumns, lowCount, evaluatedCount };
};

/** 給一般使用者的一句話結論（取代 plainResultSummary 的通用可用性說明） */
export const describeDpUtilitySummary = (summary: DpUtilitySummary): string => {
    const noisyText = summary.noisyColumns.join('、');
    if (summary.level === 1) return '各欄位數字只有小幅偏差，適合做統計分析。';
    if (summary.level === 3) return `一半以上的欄位偏差很大（${noisyText}），分析結果可能不準確。`;
    return summary.noisyColumns.length > 0
        ? `「${noisyText}」偏差很大，不建議直接拿來分析；其他欄位尚可使用。`
        : '部分欄位有明顯偏差，分析結果可能略有出入。';
};
