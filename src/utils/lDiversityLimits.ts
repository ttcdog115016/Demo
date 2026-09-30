/**
 * ============================================================================
 * 檔案名稱 (File): lDiversityLimits.ts
 * 模組功能 (Description): l-多樣性 l 值上限的計算規則（純函式，供 Step3 K-匿名規則頁使用）。
 * ============================================================================
 * ★ 2026-09-30：由 features/step3_rules/KAnonymityRules.tsx 抽出，邏輯不變，另補單元測試
 *   （utils/__tests__/lDiversityLimits.test.ts）。
 *
 * 規則：l-多樣性要求每個等價類中，敏感欄位至少有 l 種不同的值，因此
 *   l 上限 = min(目前 k 值, 各敏感欄位相異值數中的最小值)
 *   - 多個敏感欄位時取相異值數最少者（後端逐一檢測、須全部通過）
 *   - 相異值數被截斷（極高基數）的欄位遠大於任何合理的 l，不列入比較
 *   - 尚未設定敏感欄位或尚無統計資料時，退回備援上限（fallbackMaxLValue）
 */
import type { DatasetProfile } from './datasetProfile';

export interface SensitiveColumnDistinctInfo {
    columnName: string;
    distinctCount: number;
}

/** 在角色為 'Sensitive' 的欄位中，找出相異值數最少的一欄；沒有可比較的欄位時回傳 null */
export const findSmallestSensitiveColumnDistinct = (
    columnRolesMap: Record<string, string> | null | undefined,
    datasetProfile: DatasetProfile | null | undefined
): SensitiveColumnDistinctInfo | null => {
    if (!columnRolesMap || !datasetProfile) return null;
    let minimumInfo: SensitiveColumnDistinctInfo | null = null;
    Object.keys(columnRolesMap).forEach((columnNameKey) => {
        if (columnRolesMap[columnNameKey] !== 'Sensitive') return;
        const cleanColumnName = columnNameKey.replace(/^[\uFEFF\u200B]+/, '').trim();
        const columnProfile = datasetProfile.columns[cleanColumnName];
        if (!columnProfile || columnProfile.isDistinctCountCapped) return;
        if (!minimumInfo || columnProfile.distinctCount < minimumInfo.distinctCount) {
            minimumInfo = { columnName: cleanColumnName, distinctCount: columnProfile.distinctCount };
        }
    });
    return minimumInfo;
};

/** l 值實際可選上限：不超過敏感欄位相異值數，也不超過目前 k 值（K ≥ L 的數學限制），且至少為 minLValue */
export const computeEffectiveMaxLValue = (
    sensitiveDistinctInfo: SensitiveColumnDistinctInfo | null,
    currentKValue: number | null | undefined,
    minLValue: number,
    fallbackMaxLValue: number
): number => {
    const sensitiveDistinctUpperValue = sensitiveDistinctInfo ? Math.max(minLValue, sensitiveDistinctInfo.distinctCount) : fallbackMaxLValue;
    const kUpperValue = typeof currentKValue === 'number' && currentKValue >= minLValue ? currentKValue : sensitiveDistinctUpperValue;
    return Math.max(minLValue, Math.min(sensitiveDistinctUpperValue, kUpperValue));
};

/** l 是否已超過敏感欄位相異值數（此時 l-多樣性必定無法通過） */
export const isLValueExceedingSensitiveDistinct = (
    currentLValue: number,
    sensitiveDistinctInfo: SensitiveColumnDistinctInfo | null
): boolean => !!sensitiveDistinctInfo && currentLValue > sensitiveDistinctInfo.distinctCount;
