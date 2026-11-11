/**
 * 差分隱私 Step2「套用系統推薦設定」：依資料集實際內容推斷欄位資料型態。
 *
 * ★ 2026-10-05：原本 DP 推薦只看欄位名稱（參考設定檔＋關鍵字），名稱沒命中的欄位（如 bmi、人種、
 *   教育水平、是否憂鬱症）一律跳出「無法自動判斷，請手動設定」。K-匿名推薦則會再讀實際資料判斷
 *   （全部非空值都是數字 → 數值型）。這裡比照 K-匿名，名稱判斷不出來的欄位改讀 datasetProfile
 *   （整份檔案掃描一次的欄位統計，見 utils/datasetProfile.ts）：
 *   1. 所有非空值都是數字 → 連續數值型（與 K-匿名相同規則）
 *   2. 所有非空值都是日期（YYYY-MM-DD 開頭）→ 連續數值型（日期時間）
 *   3. 相異值少（≤ DP_CATEGORICAL_MAX_DISTINCT 且佔非空筆數比例 ≤ DP_CATEGORICAL_MAX_UNIQUE_RATIO）→ 類別型
 *   4. 其餘（相異值多，像姓名、自由文字）→ 文字型（預設不套用差分隱私）
 *   整欄皆空、或資料集尚未掃描 → 回傳 null，維持「無法自動判斷」。
 */
import type { DatasetProfile } from './datasetProfile';

/** 類別型最多相異值數；超過視為文字型 */
export const DP_CATEGORICAL_MAX_DISTINCT = 50;
/** 類別型相異值數佔非空筆數比例上限；避免小資料集裡每筆都不同的欄位（如姓名）被當成類別 */
export const DP_CATEGORICAL_MAX_UNIQUE_RATIO = 0.5;

export interface InferredDpFieldType {
    fieldType: 'Numeric' | 'Categorical' | 'Text';
    isDateTime: boolean;
}

export const inferDpFieldTypeFromProfile = (
    profile: DatasetProfile | null | undefined,
    rawColumnName: string
): InferredDpFieldType | null => {
    if (!profile) return null;
    const columnName = rawColumnName.replace(/^[\uFEFF\u200B]+/, '').trim();
    const columnProfile = profile.columns[columnName];
    if (!columnProfile || columnProfile.nonEmptyCount === 0) return null;

    if (columnProfile.numericCount === columnProfile.nonEmptyCount) return { fieldType: 'Numeric', isDateTime: false };

    const dateTimeRange = profile.dateTimeRanges?.[columnName];
    if (dateTimeRange && dateTimeRange.count === columnProfile.nonEmptyCount) return { fieldType: 'Numeric', isDateTime: true };

    const isLowCardinality = !columnProfile.isDistinctCountCapped
        && columnProfile.distinctCount <= DP_CATEGORICAL_MAX_DISTINCT
        && columnProfile.distinctCount / columnProfile.nonEmptyCount <= DP_CATEGORICAL_MAX_UNIQUE_RATIO;
    if (isLowCardinality) return { fieldType: 'Categorical', isDateTime: false };

    return { fieldType: 'Text', isDateTime: false };
};
