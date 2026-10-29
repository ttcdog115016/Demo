/**
 * ============================================================================
 * 檔案名稱 (File): riskSubgroupHelpers.ts
 * 模組功能 (Description): 風險評估「對象族群限定條件 (subgroup)」共用轉換與判斷函式
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則
 *
 * 獨立成純函式檔案 (而非留在 RiskSubgroupFilterPanel.tsx 元件檔內)，原因：
 * 1. React Fast Refresh 規則要求一個檔案只匯出元件，否則無法正確熱更新；本檔案的兩個函式
 *    (resolveColumnKindForSubgroup、buildBackendSubgroupPayload) 同時被 UI 元件與
 *    Step4_Result.tsx 之後端設定檔組裝邏輯共用，故抽離為獨立工具檔。
 * 2. 與 dpFieldHelpers.ts 之慣例一致。
 * ============================================================================
 */

import type { DPField } from '../store/useWorkspaceStore';
import type { RiskSubgroupCondition } from '../store/useWorkspaceStore';
import { resolveIsDateTimeDpField } from './dpFieldHelpers';

/**
 * 函數名稱: resolveColumnKindForSubgroup
 * 函數功能: 判斷欄位在「對象族群限定條件」中應顯示哪一種輸入介面——數值／日期型顯示
 *           上下限範圍輸入，類別／文字型顯示允許值清單輸入。判斷依據依目前隱私模式而定：
 *           K-匿名模式讀取 Step2 設定之 columnTypes；差分隱私模式因 columnTypes 不一定
 *           填寫，改讀 dpFields 各欄位之 fieldType (與 Step4_Result.tsx 之
 *           resolveDpRiskColumnType 判斷邏輯一致，避免兩處判斷分歧)。
 *
 * 輸入參數 (Input):
 *   - columnNameString (string): 欄位名稱
 *   - privacyModeTypeStr ('k-anonymity' | 'differential-privacy' | null): 目前隱私模式
 *   - columnTypesMapDict (Record<string, string>): K-匿名模式之欄位型態表
 *   - dpFieldsListArray (DPField[]): 差分隱私模式之欄位設定陣列
 * 輸出參數 (Output): 無
 * 返回值 (Return): 'range' | 'categorical'
 * 呼叫關係 (Call Relations): 被 RiskSubgroupFilterPanel.tsx 渲染每一列條件時呼叫
 *
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export const resolveColumnKindForSubgroup = (
    columnNameString: string,
    privacyModeTypeStr: 'k-anonymity' | 'differential-privacy' | null,
    columnTypesMapDict: Record<string, string>,
    dpFieldsListArray: DPField[]
): 'range' | 'categorical' => {
    // ★ 2026-10-29：日期欄位不提供區間——後端區間的 min／max 只收數值，日期字串一律回 ERR_SUBSET_COND_MALFORMED，
    //   改以「允許值清單」挑選日期值
    if (privacyModeTypeStr === 'differential-privacy') {
        const matchedDpFieldRecord = dpFieldsListArray.find((dpFieldItem) => dpFieldItem.fieldName === columnNameString);
        if (matchedDpFieldRecord?.fieldType === 'Numeric' && !resolveIsDateTimeDpField(matchedDpFieldRecord)) return 'range';
        // Categorical／Text／Unknown 一律以「允許值清單」介面呈現：交付文件僅明確示範類別型
        // 用陣列列舉，文字型／未知型無範例，保守起見比照類別型處理，讓使用者至少能用。
        return 'categorical';
    }

    const rawColumnTypeStr = (columnTypesMapDict[columnNameString] || '').toLowerCase();
    if (rawColumnTypeStr === 'numeric') return 'range';
    return 'categorical';
};

/**
 * 函數名稱: isColumnTemporalForSubgroup
 * 函數功能: 判斷欄位是否為日期時間型 (用於決定 range 輸入框的 placeholder 提示文字)。
 */
export const isColumnTemporalForSubgroup = (
    columnNameString: string,
    privacyModeTypeStr: 'k-anonymity' | 'differential-privacy' | null,
    columnTypesMapDict: Record<string, string>,
    dpFieldsListArray: DPField[]
): boolean => {
    if (privacyModeTypeStr === 'differential-privacy') {
        const matchedDpFieldRecord = dpFieldsListArray.find((dpFieldItem) => dpFieldItem.fieldName === columnNameString);
        return matchedDpFieldRecord?.fieldType === 'Numeric' && resolveIsDateTimeDpField(matchedDpFieldRecord);
    }
    return (columnTypesMapDict[columnNameString] || '').toLowerCase() === 'temporal';
};

/**
 * 函數名稱: buildBackendSubgroupPayload
 * 函數功能: 將 WorkspaceStore 內部之 riskSubgroupFilters (含 UI 專用之 kind 標記) 轉換為
 *           後端 subgroup 欄位所需之精確 JSON 結構——數值／日期型欄位僅在有填 min 或 max
 *           任一側時才輸出 {min?, max?}；類別型欄位僅在至少有一個允許值時才輸出陣列；
 *           兩者皆空的欄位一律略過，不輸出空物件或空陣列 (避免送出「有設但等於沒設」的
 *           雜訊鍵值，也避免誤觸 ERR_CONFIG_INVALID 之「不認識或型別不符欄位」)。整體若無
 *           任何有效欄位條件，回傳 undefined，讓呼叫端可以直接略過 subgroup 這個鍵，
 *           對應後端「未填即評估全體」的預設行為。
 *
 * 輸入參數 (Input):
 *   - riskSubgroupFiltersMapDict (Record<string, RiskSubgroupCondition>): Store 內部條件表
 * 輸出參數 (Output): 無
 * 返回值 (Return): Record<string, { min?: number; max?: number } | (string | number)[]> | undefined
 * 呼叫關係 (Call Relations): 被 Step4_Result.tsx 組三個風險評估設定檔時呼叫
 *
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export const buildBackendSubgroupPayload = (
    riskSubgroupFiltersMapDict: Record<string, RiskSubgroupCondition>
): Record<string, { min?: number; max?: number } | (string | number)[]> | undefined => {
    const resultPayloadDict: Record<string, { min?: number; max?: number } | (string | number)[]> = {};

    Object.entries(riskSubgroupFiltersMapDict).forEach(([columnNameString, conditionRecord]) => {
        if (conditionRecord.kind === 'range') {
            const trimmedMinStr = (conditionRecord.min ?? '').trim();
            const trimmedMaxStr = (conditionRecord.max ?? '').trim();
            if (!trimmedMinStr && !trimmedMaxStr) return; // 兩側皆空，等同沒設定，略過

            // ★ 2026-10-29：後端區間邊界只收數值（字串一律 400），填的不是數字就不送該側
            const parseNumberOrUndefined = (rawValueStr: string): number | undefined => {
                const parsedNumberValue = Number(rawValueStr);
                return (rawValueStr !== '' && Number.isFinite(parsedNumberValue)) ? parsedNumberValue : undefined;
            };

            const rangeConditionObj: { min?: number; max?: number } = {};
            const parsedMinValue = parseNumberOrUndefined(trimmedMinStr);
            const parsedMaxValue = parseNumberOrUndefined(trimmedMaxStr);
            if (parsedMinValue !== undefined) rangeConditionObj.min = parsedMinValue;
            if (parsedMaxValue !== undefined) rangeConditionObj.max = parsedMaxValue;
            if (parsedMinValue === undefined && parsedMaxValue === undefined) return;
            resultPayloadDict[columnNameString] = rangeConditionObj;
        } else {
            const nonEmptyValuesListArray = (conditionRecord.values || []).map((v) => v.trim()).filter((v) => v.length > 0);
            if (nonEmptyValuesListArray.length === 0) return; // 空清單，等同沒設定，略過
            // ★ 2026-10-29：後端讀 CSV 時純數字欄（如代碼 1、2、3）會轉成數值，用字串比對不到；
            //   像數字的值（不含 0 開頭，後端會保留 0 開頭的代碼為文字）同時送數值版本，兩種欄位型態都比對得到
            const valuesWithNumericTwinsList: (string | number)[] = [];
            nonEmptyValuesListArray.forEach((valueStr) => {
                valuesWithNumericTwinsList.push(valueStr);
                const numericTwinValue = Number(valueStr);
                if (Number.isFinite(numericTwinValue) && String(numericTwinValue) === valueStr) valuesWithNumericTwinsList.push(numericTwinValue);
            });
            resultPayloadDict[columnNameString] = valuesWithNumericTwinsList;
        }
    });

    return Object.keys(resultPayloadDict).length > 0 ? resultPayloadDict : undefined;
};

// ★ 移除記錄：原本這裡有一個 extractPreviewCategoricalValuesForSubgroup 函式，僅從 Step1
// 預覽的前 1000 筆資料中取樣建議值 (供輸入框的「建議清單」使用，仍保留自由輸入)。使用者實測後
// 反映應完全禁止手動輸入、且清單需來自「完整資料集」而非僅預覽樣本，故已改為由
// RiskSubgroupFilterPanel.tsx 內的 useEffect 直接完整解析原始上傳檔案 (dataFile)、寫入
// WorkspaceStore.columnCategoricalUniqueValues 快取，此函式已無呼叫端，故移除，避免死碼。
