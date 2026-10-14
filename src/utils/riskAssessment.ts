/**
 * Step4 風險評估（三攻擊／CAP）的候選欄位挑選、設定檔組裝與逐輪取最大值邏輯。
 *
 * 2026-09-30 自 Step4_Result.tsx 的 runFullPipeline 抽出，行為不變；API 呼叫與執行紀錄由呼叫端以
 * callback 傳入，因此可單獨測試。各處 ★ 註解的完整修正脈絡見 git 歷史（commit 900e086 之前的 Step4_Result.tsx）。
 */
import type { AttackReport, CapReport, RiskCapResponse } from '../api/apiService';
import { isApiRequestCanceled } from '../api/apiService';
import type { DatasetProfile } from './datasetProfile';
import { getColumnUniqueValueRatio } from './datasetProfile';
import { analyzeNumericColumnRange, computeBinnedColumnStats, computeAutoNiceBinWidth } from './sensitiveBinning';
import { isDateTimeDpField, resolveIsDateTimeDpField } from './dpFieldHelpers';
import { extractCapRequestFailureReasonText, buildCapUnavailableReceipt } from './riskResultHelpers';
import type { DpStoreField } from './pipelineConfig';

/**
 * 三攻擊官方範例參數（docs/manual_test/config_risk_*.json 及 report_request.json 的 risk_params 預設值），
 * 目前畫面未開放調整。實際送給後端與合規報告「隱私強化處理配置」段落顯示的都是這一份。
 */
export const RISK_ATTACK_DEFAULT_PARAMS = {
    n_iter: 50,
    ctrl_ratio: 0.2,
    seed: 42,
    n_subset: 500,
    n_repeats: 1,
    overlap_ratio: 0.0
};

/** 敏感欄位「非空值中的相異值佔比」超過此門檻即視為高唯一值（採 sklearn 警告訊息本身引用的 50%） */
export const HIGH_CARDINALITY_SENSITIVE_RATIO_THRESHOLD = 0.5;

export type RiskColumnRole = 'quasi_identifier' | 'sensitive';
export type RiskColumnsMap = Record<string, { role: RiskColumnRole; type: string }>;

export interface HighCardinalitySensitiveInfo {
    columnName: string;
    uniqueRatioPercent: number;
    handling?: 'binned' | 'skipped' | 'forced';
    binWidth?: number;
    binCount?: number;
}

export interface RoleResolutionDiagnostic {
    column: string;
    matchedInFieldsList: boolean;
    rawRole: unknown;
    resolvedBackendRole: string;
}

const cleanColumnNameText = (columnName: string): string => columnName.replace(/^[\uFEFF\u200B]+/, '').trim();

const PRIVACY_ROLE_TO_BACKEND_ROLE: Record<string, string> = {
    'Identifier': 'identifier',
    'Quasi-identifier': 'quasi_identifier',
    'Sensitive': 'sensitive',
    'Non-sensitive': 'non_sensitive'
};

/**
 * K-匿名：依 Step2 的 kAnonymityFields（找不到時改用畫面判定的角色）解析每欄角色，
 * 只保留間接識別與敏感欄位作為風險評估 columns；另回傳逐欄比對快照供除錯。
 */
export const resolveKAnonymityRiskColumns = (input: {
    processedColumnNames: string[];
    kAnonymityFields: unknown[];
    resolveFallbackUiRole: (cleanColumnName: string) => string;
}): { riskColumnsMap: RiskColumnsMap; roleResolutionDiagnostics: RoleResolutionDiagnostic[] } => {
    const riskColumnsMap: RiskColumnsMap = {};
    const roleResolutionDiagnostics: RoleResolutionDiagnostic[] = [];

    input.processedColumnNames.forEach((colName) => {
        const cleanName = cleanColumnNameText(colName);
        const matchedField = input.kAnonymityFields.find((item: unknown) => {
            const record = item as Record<string, unknown>;
            return record && typeof record.name === 'string' && cleanColumnNameText(record.name) === cleanName;
        }) as Record<string, unknown> | undefined;

        let backendRole = 'non_sensitive';
        let colType = 'string';

        if (matchedField) {
            backendRole = PRIVACY_ROLE_TO_BACKEND_ROLE[String(matchedField.role)] || 'non_sensitive';
            colType = String(matchedField.type) || 'string';
        } else {
            const uiRole = input.resolveFallbackUiRole(cleanName);
            if (uiRole === 'Identifier') backendRole = 'identifier';
            if (uiRole === 'Quasi-identifier') backendRole = 'quasi_identifier';
            if (uiRole === 'Sensitive') backendRole = 'sensitive';
        }

        roleResolutionDiagnostics.push({
            column: cleanName,
            matchedInFieldsList: Boolean(matchedField),
            rawRole: matchedField ? matchedField.role : '(未於 kAnonymityFieldsList 中找到，改用 getCalculatedRole 推斷)',
            resolvedBackendRole: backendRole
        });

        if (backendRole === 'quasi_identifier' || backendRole === 'sensitive') {
            riskColumnsMap[cleanName] = { role: backendRole as RiskColumnRole, type: colType };
        }
    });

    return { riskColumnsMap, roleResolutionDiagnostics };
};

/**
 * K-匿名：從使用者標為「敏感」的欄位中挑出實際要跑三攻擊／CAP 的候選。
 * 高唯一值欄位：勾選強制執行 → 原值照送；幾乎全為數值 → 自動（或依使用者覆寫寬度）分級距，
 * 分級距後佔比降到門檻以下才保留；文字型 → 略過。
 */
export const selectKAnonymitySensitiveCandidates = (input: {
    candidateColumnNames: string[];
    datasetProfile: DatasetProfile;
    binWidthOverrides: Record<string, number>;
    forceRunHighCardinality: boolean;
}): { effectiveCandidateColumnNames: string[]; highCardinalityInfo: HighCardinalitySensitiveInfo[]; binWidthMap: Record<string, number> } => {
    const highCardinalityInfo: HighCardinalitySensitiveInfo[] = [];
    const binWidthMap: Record<string, number> = {};

    const effectiveCandidateColumnNames = input.candidateColumnNames.filter((candidateColumnName) => {
        const uniqueRatioValue = getColumnUniqueValueRatio(input.datasetProfile, candidateColumnName);
        if (uniqueRatioValue <= HIGH_CARDINALITY_SENSITIVE_RATIO_THRESHOLD) return true;

        const uniqueRatioPercent = Math.round(uniqueRatioValue * 1000) / 10;
        if (input.forceRunHighCardinality) {
            highCardinalityInfo.push({ columnName: candidateColumnName, uniqueRatioPercent, handling: 'forced' });
            return true;
        }
        const numericRangeInfo = analyzeNumericColumnRange(input.datasetProfile, candidateColumnName);
        if (numericRangeInfo) {
            const overrideBinWidthValue = input.binWidthOverrides[candidateColumnName];
            const binWidthValue = overrideBinWidthValue && overrideBinWidthValue > 0
                ? overrideBinWidthValue
                : computeAutoNiceBinWidth(numericRangeInfo.min, numericRangeInfo.max);
            const binnedStats = computeBinnedColumnStats(input.datasetProfile, candidateColumnName, binWidthValue);
            const isBinningSufficientStatus = binnedStats.uniqueRatio <= HIGH_CARDINALITY_SENSITIVE_RATIO_THRESHOLD;
            highCardinalityInfo.push({
                columnName: candidateColumnName, uniqueRatioPercent,
                handling: isBinningSufficientStatus ? 'binned' : 'skipped',
                binWidth: binWidthValue, binCount: binnedStats.distinctCount
            });
            if (isBinningSufficientStatus) binWidthMap[candidateColumnName] = binWidthValue;
            return isBinningSufficientStatus;
        }
        highCardinalityInfo.push({ columnName: candidateColumnName, uniqueRatioPercent, handling: 'skipped' });
        return false;
    });

    return { effectiveCandidateColumnNames, highCardinalityInfo, binWidthMap };
};

const describeHighCardinalityColumnsText = (itemsList: HighCardinalitySensitiveInfo[]): string => itemsList
    .map((item) => `「${item.columnName}」(唯一值佔比 ${item.uniqueRatioPercent}%)`)
    .join('、');

/** K-匿名：高唯一值欄位處理結果的執行紀錄訊息（不含時間前綴） */
export const describeKAnonymityHighCardinalityHandling = (highCardinalityInfo: HighCardinalitySensitiveInfo[]): string[] => {
    const messagesList: string[] = [];
    const forcedItemsList = highCardinalityInfo.filter((item) => item.handling === 'forced');
    const binnedItemsList = highCardinalityInfo.filter((item) => item.handling === 'binned');
    const skippedItemsList = highCardinalityInfo.filter((item) => item.handling === 'skipped');
    if (forcedItemsList.length > 0) {
        messagesList.push(`⚠️ 已依設定以原始值強制對 ${describeHighCardinalityColumnsText(forcedItemsList)} 執行三攻擊／CAP。推斷性攻擊需以可列舉類別為預測目標，此類欄位結果不具評估意義且可能跑不完，如遇執行失敗或無回應請取消勾選「仍要強制執行」。`);
    }
    binnedItemsList.forEach((item) => {
        messagesList.push(`ℹ️ 「${item.columnName}」為連續數值（唯一值佔比 ${item.uniqueRatioPercent}%），已自動以每 ${item.binWidth!.toLocaleString()} 為一級距（共 ${item.binCount} 級）轉換後再執行三攻擊／CAP（僅用於風險評估，不影響去識別化結果本身）。`);
    });
    if (skippedItemsList.length > 0) {
        messagesList.push(`⚠️ ${describeHighCardinalityColumnsText(skippedItemsList)} 的值幾乎每筆都不同，推斷性攻擊無法對其建立有效的分類模型，已略過該欄位的三攻擊／CAP 風險評估（不影響去識別化結果本身）。數值欄位可在下方調大級距寬度；文字欄位請先自行歸併為類別後重新上傳。`);
    }
    return messagesList;
};

/** K-匿名：以某個候選欄位為敏感欄位、其餘為間接識別；已分級距的欄位型別改宣告為類別型 */
export const buildKAnonymityRiskColumnsForCandidate = (
    riskColumnsMap: RiskColumnsMap, binWidthMap: Record<string, number>, candidateSensitiveFieldName: string
): RiskColumnsMap => {
    const columnsMapResult: RiskColumnsMap = {};
    Object.entries(riskColumnsMap).forEach(([colName, colInfo]) => {
        columnsMapResult[colName] = {
            role: colName === candidateSensitiveFieldName ? 'sensitive' : 'quasi_identifier',
            type: binWidthMap[colName] ? 'categorical' : colInfo.type
        };
    });
    return columnsMapResult;
};

/** K-匿名：送風險評估的 k_anonymity 區塊；已分級距欄位的 columns.type 改為 categorical，未分級距時原物件沿用 */
export const buildKAnonymityConfigBlockForRisk = (originalKAnonBlock: unknown, binWidthMap: Record<string, number>): unknown => {
    const kAnonBlockRecord = originalKAnonBlock as Record<string, unknown> | undefined;
    const binnedColumnNamesList = Object.keys(binWidthMap);
    if (!kAnonBlockRecord || binnedColumnNamesList.length === 0) return kAnonBlockRecord;
    const originalColumnsMap = (kAnonBlockRecord.columns || {}) as Record<string, Record<string, unknown>>;
    const overriddenColumnsMap: Record<string, Record<string, unknown>> = { ...originalColumnsMap };
    binnedColumnNamesList.forEach((colName) => {
        if (overriddenColumnsMap[colName]) overriddenColumnsMap[colName] = { ...overriddenColumnsMap[colName], type: 'categorical' };
    });
    return { ...kAnonBlockRecord, columns: overriddenColumnsMap };
};

export type DpRiskRole = 'quasi_identifier' | 'sensitive' | 'none';

/**
 * 差分隱私欄位在 Step4 風險評估中的角色（2026-10-02 新增，Step2「敏感欄位」欄點選）。
 * 點選為敏感欄位者＝sensitive，與是否加噪無關（後端 /risk/dp 只要求欄位存在於資料中，未加噪的欄位
 * 也能當敏感欄位）；其餘沿用原本規則：已啟用 DP＝間接識別、未啟用＝不參與。
 */
export const resolveDpFieldRiskRole = (field: Pick<DpStoreField, 'enabled' | 'isRiskSensitive'>): DpRiskRole =>
    field.isRiskSensitive ? 'sensitive' : (field.enabled ? 'quasi_identifier' : 'none');

/**
 * 差分隱私：此欄位能否在 Step2 點選為風險評估敏感欄位（2026-10-02）。
 * 推斷性攻擊以敏感欄位為分類目標、以「預測值與真實值完全相等」判定成功，目標須可列舉：
 * - 類別型：可以。
 * - 連續數值型：可以，Step4 會比照 K-匿名先分級距（例如薪資每 5 萬一級）再以級距當類別評估，
 *   級距寬度可在 Step4 調整（見 selectDifferentialPrivacySensitiveCandidates）。
 * - 日期時間型、文字型（識別碼，幾乎每筆唯一）、尚未選型態：不行。
 */
export const isDpFieldSelectableAsRiskSensitive = (field: Pick<DpStoreField, 'fieldName' | 'fieldType'> & { isDateTime?: boolean }): boolean => {
    if (field.fieldType === 'Categorical') return true;
    if (field.fieldType === 'Numeric') return !resolveIsDateTimeDpField(field);
    return false;
};

/** 差分隱私：不能當敏感欄位時的型態說明文字（錯誤訊息用） */
export const describeDpRiskSensitiveUnsupportedType = (field: Pick<DpStoreField, 'fieldName' | 'fieldType'> & { isDateTime?: boolean }): string => {
    if (field.fieldType === 'Numeric') return '日期時間型';
    if (field.fieldType === 'Text') return '文字型';
    return '尚未選擇型態';
};

/**
 * 差分隱私：決定 Step4 三攻擊／CAP 要用哪些欄位、以哪些欄位為敏感欄位。
 * - Step2 已點選敏感欄位（isRiskSensitive，可複數個，2026-10-02 起；類別型或連續數值型，數值型會先分級距）：後端 RiskConfig 每次只接受恰好 1 個
 *   sensitive，因此 Step4 每輪只以其中 1 個為敏感欄位，點選幾個就跑幾輪，取風險最高者；其餘已啟用 DP 且未被
 *   點選為敏感的欄位為攻擊面（間接識別），其他被點選的敏感欄位在該輪不參與（見 buildDifferentialPrivacyRiskColumnsForCandidate）。
 * - 未指定：沿用舊行為，輪流以每個參與評估且為類別型的欄位為敏感欄位（連續數值當分類目標會讓後端
 *   sklearn 當機），取風險最高者。
 * 兩種情況都會排除高唯一值欄位（勾選強制執行則保留）。回傳的 enabledFields 為「參與評估的欄位」
 * （名稱沿用舊版，未設定角色時即等於已啟用 DP 的欄位）。
 */
export const selectDifferentialPrivacySensitiveCandidates = (input: {
    dpFields: DpStoreField[] | null | undefined;
    datasetProfile: DatasetProfile;
    forceRunHighCardinality: boolean;
    /** Step4 使用者調整的級距寬度（欄位名稱 → 寬度）；未提供時一律自動計算 */
    binWidthOverrides?: Record<string, number>;
}): {
    enabledFields: DpStoreField[]; effectiveCandidateColumnNames: string[]; highCardinalityInfo: HighCardinalitySensitiveInfo[]; designatedSensitiveColumnNames: string[];
    /** 需先分級距才送風險評估的欄位 → 級距寬度（原始資料與去識別化結果都要套用） */
    binWidthMap: Record<string, number>;
    /** 風險評估時改宣告為類別型的敏感欄位（點選為敏感的連續數值型欄位，不論是否分級距） */
    categoricalOverrideColumnNames: string[];
} => {
    const allFieldsList = input.dpFields || [];
    if (!allFieldsList.some((field) => field.enabled)) {
        throw new Error('風險評估要求至少 1 個已啟用的差分隱私欄位，請回到步驟二欄位設定啟用欄位後再重新運算。');
    }
    const enabledFields = allFieldsList.filter((field) => resolveDpFieldRiskRole(field) !== 'none');
    const designatedSensitiveFieldsList = allFieldsList.filter((field) => field.isRiskSensitive);
    if (designatedSensitiveFieldsList.length > 0) {
        const unsupportedSensitiveField = designatedSensitiveFieldsList.find((field) => !isDpFieldSelectableAsRiskSensitive(field));
        if (unsupportedSensitiveField) {
            throw new Error(`敏感欄位「${unsupportedSensitiveField.fieldName}」為${describeDpRiskSensitiveUnsupportedType(unsupportedSensitiveField)}，無法作為推斷性攻擊的預測目標，請回到步驟二改選類別型或連續數值型欄位。`);
        }
        if (!enabledFields.some((field) => resolveDpFieldRiskRole(field) === 'quasi_identifier')) {
            throw new Error('已點選敏感欄位，但沒有其他已啟用差分隱私的欄位可作為間接識別，三攻擊缺少攻擊面，請回到步驟二再啟用至少 1 個欄位。');
        }
    }
    // Step2 有點選敏感欄位：比照 K-匿名的處理——高唯一值的連續數值欄位自動（或依 Step4 使用者調整的寬度）分級距，
    //   分級距後佔比降到門檻以下才保留；高唯一值的類別欄位略過（勾選強制執行則保留）
    if (designatedSensitiveFieldsList.length > 0) {
        const designatedSelection = selectKAnonymitySensitiveCandidates({
            candidateColumnNames: designatedSensitiveFieldsList.map((field) => field.fieldName),
            datasetProfile: input.datasetProfile,
            binWidthOverrides: input.binWidthOverrides || {},
            forceRunHighCardinality: input.forceRunHighCardinality
        });
        return {
            enabledFields,
            effectiveCandidateColumnNames: designatedSelection.effectiveCandidateColumnNames,
            highCardinalityInfo: designatedSelection.highCardinalityInfo,
            designatedSensitiveColumnNames: designatedSensitiveFieldsList.map((field) => field.fieldName),
            binWidthMap: designatedSelection.binWidthMap,
            categoricalOverrideColumnNames: designatedSensitiveFieldsList
                .filter((field) => field.fieldType === 'Numeric' && designatedSelection.effectiveCandidateColumnNames.includes(field.fieldName))
                .map((field) => field.fieldName)
        };
    }
    const categoricalCandidateFieldsList = enabledFields.filter((field) => field.fieldType === 'Categorical');
    if (categoricalCandidateFieldsList.length === 0) {
        throw new Error('風險評估的敏感欄位僅能從已啟用的「類別型」欄位中挑選，目前沒有已啟用的類別型欄位，請回到步驟二欄位設定啟用至少 1 個類別型欄位（或點選敏感欄位）後再重新運算。');
    }
    const highCardinalityInfo: HighCardinalitySensitiveInfo[] = [];
    const effectiveCandidateFieldsList = categoricalCandidateFieldsList.filter((field) => {
        const uniqueRatioValue = getColumnUniqueValueRatio(input.datasetProfile, field.fieldName);
        if (uniqueRatioValue > HIGH_CARDINALITY_SENSITIVE_RATIO_THRESHOLD) {
            highCardinalityInfo.push({ columnName: field.fieldName, uniqueRatioPercent: Math.round(uniqueRatioValue * 1000) / 10, handling: input.forceRunHighCardinality ? 'forced' : 'skipped' });
            return input.forceRunHighCardinality;
        }
        return true;
    });
    return {
        enabledFields,
        effectiveCandidateColumnNames: effectiveCandidateFieldsList.map((field) => field.fieldName),
        highCardinalityInfo,
        designatedSensitiveColumnNames: [],
        binWidthMap: {},
        categoricalOverrideColumnNames: []
    };
};

/** 差分隱私：高唯一值欄位處理結果的執行紀錄訊息（不含時間前綴） */
export const describeDifferentialPrivacyHighCardinalityHandling = (highCardinalityInfo: HighCardinalitySensitiveInfo[], forceRunHighCardinality: boolean): string[] => {
    if (highCardinalityInfo.length === 0) return [];
    // 有分級距紀錄（Step2 點選了連續數值型敏感欄位）時，訊息格式與 K-匿名一致
    if (highCardinalityInfo.some((item) => item.binWidth !== undefined)) return describeKAnonymityHighCardinalityHandling(highCardinalityInfo);
    const flaggedColumnsDescriptionText = describeHighCardinalityColumnsText(highCardinalityInfo);
    return [forceRunHighCardinality
        ? `⚠️ 已依設定強制對 ${flaggedColumnsDescriptionText} 執行三攻擊／CAP，此類欄位過去曾造成後端服務當機，如遇執行失敗或無回應請取消勾選「仍要強制執行」。`
        : `⚠️ ${flaggedColumnsDescriptionText} 的值幾乎每筆都不同，已略過該欄位的三攻擊／CAP 風險評估以避免觸發後端服務當機（不影響去識別化結果本身）；如仍要嘗試，請於下方勾選「仍要強制執行」。`];
};

/**
 * 差分隱私：以某個候選欄位為敏感欄位、其餘參與評估的欄位為間接識別。
 * Step2 點選了多個敏感欄位時，本輪以外的其他敏感欄位不放進 columns（攻擊者不應已知其他敏感屬性，
 * 也避免後端一次收到多個 sensitive）。
 * categoricalOverrideColumnNames：點選為敏感的連續數值欄位（已分級距或本身相異值少），型別改宣告為類別型。
 */
export const buildDifferentialPrivacyRiskColumnsForCandidate = (
    input: { enabledFields: DpStoreField[]; dpFields: DpStoreField[] | null | undefined; columnTypes: Record<string, unknown> | null | undefined; categoricalOverrideColumnNames?: string[] },
    candidateSensitiveFieldName: string
): RiskColumnsMap => {
    const resolveDpRiskColumnType = (fieldName: string): string => {
        const targetField = (input.dpFields || []).find((field) => field.fieldName === fieldName);
        const isNumeric = targetField?.fieldType === 'Numeric';
        const originalColType = String(input.columnTypes?.[fieldName] || '').toLowerCase();
        const isDateTimeType = targetField ? resolveIsDateTimeDpField(targetField, originalColType) : isDateTimeDpField(fieldName, originalColType);
        if (isNumeric) return isDateTimeType ? 'temporal' : 'numeric';
        if (targetField?.fieldType === 'Categorical') return 'categorical';
        return 'string';
    };
    const columnsMapResult: RiskColumnsMap = {};
    input.enabledFields.forEach((field) => {
        if (field.isRiskSensitive && field.fieldName !== candidateSensitiveFieldName) return;
        columnsMapResult[field.fieldName] = {
            role: field.fieldName === candidateSensitiveFieldName ? 'sensitive' : 'quasi_identifier',
            type: (input.categoricalOverrideColumnNames || []).includes(field.fieldName) ? 'categorical' : resolveDpRiskColumnType(field.fieldName)
        };
    });
    return columnsMapResult;
};

/**
 * 差分隱私：送 /risk/dp 的 differential_privacy 區塊。點選為敏感的連續數值欄位在風險評估時改以類別型評估
 * （原始資料已分級距），對應的 column_budgets 項目改為類別型（只保留 epsilon_budget，與一般類別型欄位格式相同），
 * 避免後端對級距值再加連續型雜訊、讓推斷性攻擊的「完全相等」判定失去意義。原物件不修改。
 */
export const buildDifferentialPrivacyConfigBlockForRisk = (originalDpBlock: unknown, categoricalOverrideColumnNames: string[]): unknown => {
    const dpBlockRecord = originalDpBlock as Record<string, unknown> | undefined;
    if (!dpBlockRecord || categoricalOverrideColumnNames.length === 0) return dpBlockRecord;
    const originalBudgetsMap = (dpBlockRecord.column_budgets || {}) as Record<string, Record<string, unknown>>;
    const overriddenBudgetsMap: Record<string, Record<string, unknown>> = { ...originalBudgetsMap };
    categoricalOverrideColumnNames.forEach((colName) => {
        const budgetItem = overriddenBudgetsMap[colName];
        if (budgetItem) overriddenBudgetsMap[colName] = { type: 'categorical', epsilon_budget: budgetItem.epsilon_budget };
    });
    return { ...dpBlockRecord, column_budgets: overriddenBudgetsMap };
};

/** 三攻擊設定檔；privacyBlock 為 { k_anonymity } 或 { differential_privacy } */
export const buildRiskAttackConfigObject = (input: {
    version: string; dataset: string; columns: RiskColumnsMap; subgroup: unknown; privacyBlock: Record<string, unknown>;
}): Record<string, unknown> => ({
    version: input.version,
    dataset: input.dataset,
    risk_attacks: {
        enabled: true,
        columns: input.columns,
        ...(input.subgroup ? { subgroup: input.subgroup } : {}),
        ...RISK_ATTACK_DEFAULT_PARAMS
    },
    ...input.privacyBlock
});

/** CAP 前後對比設定檔 */
export const buildCapConfigObject = (input: { dataset: string; columns: RiskColumnsMap; subgroup: unknown }): Record<string, unknown> => ({
    version: 'step4_risk_cap',
    dataset: input.dataset,
    risk_cap: {
        enabled: true,
        columns: input.columns,
        ...(input.subgroup ? { subgroup: input.subgroup } : {})
    }
});

/** 把設定物件包成上傳用的 JSON 檔 */
export const createJsonConfigFile = (configObject: unknown, fileName: string): File => {
    const configBlob = new Blob([JSON.stringify(configObject)], { type: 'application/json;charset=utf-8' });
    return new File([configBlob], fileName, { type: 'application/json' });
};

/**
 * 三攻擊：三項指標各自取所有輪次最大值；其餘中繼資料與欄位設定取「三項中最大值最高」的那一輪。
 */
export const mergeWorstCaseAttackReport = (
    worstCaseReport: AttackReport | null, thisRoundReport: AttackReport
): { mergedReport: AttackReport; isThisRoundNewWorstCase: boolean } => {
    const isThisRoundNewWorstCase: boolean =
        !worstCaseReport ||
        Math.max(thisRoundReport.singling_out_risk, thisRoundReport.linkability_risk, thisRoundReport.inference_risk) >
        Math.max(worstCaseReport.singling_out_risk, worstCaseReport.linkability_risk, worstCaseReport.inference_risk);
    return {
        isThisRoundNewWorstCase,
        mergedReport: {
            ...(isThisRoundNewWorstCase ? thisRoundReport : worstCaseReport!),
            singling_out_risk: Math.max(worstCaseReport?.singling_out_risk ?? -Infinity, thisRoundReport.singling_out_risk),
            linkability_risk: Math.max(worstCaseReport?.linkability_risk ?? -Infinity, thisRoundReport.linkability_risk),
            inference_risk: Math.max(worstCaseReport?.inference_risk ?? -Infinity, thisRoundReport.inference_risk)
        }
    };
};

/**
 * CAP：cap_before／cap_after 各自取最大值；其餘欄位取「最危險」的那一輪。
 * ★ 2026-10-06：有前端算的扣除基線值（cap_after_excess）時以它比較——各敏感欄位的亂猜基線不同，
 *   cap_after 最高的欄位不一定是超出亂猜最多的；基線與扣除值一律跟著最危險那一輪走。
 */
// 已算過基線（含「不適用」）的報告以扣除值比較，不適用者視為最低，避免原始 CAP ≈ 100% 搶走最危險的位置
const resolveCapSeverity = (report: CapReport): number =>
    typeof report.cap_after_excess === 'number'
        ? report.cap_after_excess
        : report.cap_baseline_after !== undefined ? -1 : report.cap_after;
export const mergeWorstCaseCapReport = (worstCaseReport: CapReport | null, thisRoundReport: CapReport): CapReport => {
    const isThisRoundNewWorstCapCase: boolean = !worstCaseReport || resolveCapSeverity(thisRoundReport) > resolveCapSeverity(worstCaseReport);
    return {
        ...(isThisRoundNewWorstCapCase ? thisRoundReport : worstCaseReport!),
        cap_before: Math.max(worstCaseReport?.cap_before ?? -Infinity, thisRoundReport.cap_before),
        cap_after: Math.max(worstCaseReport?.cap_after ?? -Infinity, thisRoundReport.cap_after)
    };
};

/** 對每個候選敏感欄位各跑一輪三攻擊並取最大值；任一輪失敗由 runRound 丟錯中止 */
export const runWorstCaseAttackRounds = async (input: {
    candidateColumnNames: string[];
    buildColumnsForCandidate: (candidateSensitiveFieldName: string) => RiskColumnsMap;
    runRound: (columns: RiskColumnsMap, candidateSensitiveFieldName: string) => Promise<AttackReport>;
    onRoundStart?: (roundIndex: number, roundCount: number) => void;
}): Promise<{ worstCaseReport: AttackReport | null; worstCaseColumns: RiskColumnsMap }> => {
    let worstCaseReport: AttackReport | null = null;
    let worstCaseColumns: RiskColumnsMap = {};
    for (let roundIndex = 0; roundIndex < input.candidateColumnNames.length; roundIndex++) {
        const candidateSensitiveFieldName = input.candidateColumnNames[roundIndex];
        const columnsForThisRound = input.buildColumnsForCandidate(candidateSensitiveFieldName);
        input.onRoundStart?.(roundIndex, input.candidateColumnNames.length);
        const thisRoundReport = await input.runRound(columnsForThisRound, candidateSensitiveFieldName);
        const { mergedReport, isThisRoundNewWorstCase } = mergeWorstCaseAttackReport(worstCaseReport, thisRoundReport);
        if (isThisRoundNewWorstCase) worstCaseColumns = columnsForThisRound;
        worstCaseReport = mergedReport;
    }
    return { worstCaseReport, worstCaseColumns };
};

/**
 * 對每個候選敏感欄位各跑一輪 CAP 並取最大值。逐輪容錯：單輪失敗只略過該輪（使用者取消則整個中止）；
 * 全部失敗時回傳 cap = -1 的「無法評估」收據，部分失敗時把失敗欄位與原因附在 message 後。
 */
export const runWorstCaseCapRounds = async (input: {
    candidateColumnNames: string[];
    buildColumnsForCandidate: (candidateSensitiveFieldName: string) => RiskColumnsMap;
    runRound: (columns: RiskColumnsMap, candidateSensitiveFieldName: string) => Promise<RiskCapResponse>;
    onRoundStart?: (roundIndex: number, roundCount: number) => void;
    onRoundFailed?: (roundIndex: number, candidateSensitiveFieldName: string, reasonText: string, errorPayload: unknown) => void;
}): Promise<CapReport | null> => {
    let worstCaseCapReport: CapReport | null = null;
    const failedCapRoundsList: { columnName: string; reasonText: string }[] = [];

    for (let roundIndex = 0; roundIndex < input.candidateColumnNames.length; roundIndex++) {
        const candidateSensitiveFieldName = input.candidateColumnNames[roundIndex];
        const columnsForThisRound = input.buildColumnsForCandidate(candidateSensitiveFieldName);
        input.onRoundStart?.(roundIndex, input.candidateColumnNames.length);
        const capResponse = await input.runRound(columnsForThisRound, candidateSensitiveFieldName);
        if (!capResponse.success || !capResponse.report) {
            if (isApiRequestCanceled(capResponse.error)) throw capResponse.error;
            const roundFailureReasonText = extractCapRequestFailureReasonText(capResponse.error || new Error('API 請求未成功'));
            failedCapRoundsList.push({ columnName: candidateSensitiveFieldName, reasonText: roundFailureReasonText });
            input.onRoundFailed?.(roundIndex, candidateSensitiveFieldName, roundFailureReasonText, capResponse.error);
            continue;
        }
        worstCaseCapReport = mergeWorstCaseCapReport(worstCaseCapReport, capResponse.report);
    }

    if (!worstCaseCapReport && failedCapRoundsList.length > 0) {
        const distinctReasonsText = Array.from(new Set(failedCapRoundsList.map((item) => item.reasonText))).join('；');
        return buildCapUnavailableReceipt(distinctReasonsText);
    }
    if (worstCaseCapReport && failedCapRoundsList.length > 0) {
        const failedColumnsText = failedCapRoundsList.map((item) => `「${item.columnName}」（${item.reasonText}）`).join('、');
        return {
            ...worstCaseCapReport,
            message: `${worstCaseCapReport.message || ''} 另有 ${failedCapRoundsList.length} 個候選敏感欄位的 CAP 請求失敗、未納入最大值：${failedColumnsText}`.trim()
        };
    }
    return worstCaseCapReport;
};
