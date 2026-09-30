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
import { isDateTimeDpField } from './dpFieldHelpers';
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

/**
 * 差分隱私：候選敏感欄位只從已啟用的類別型欄位挑（連續數值當分類目標會讓後端 sklearn 當機），
 * 再排除高唯一值欄位（勾選強制執行則保留）。沒有已啟用欄位或沒有類別型欄位時直接丟錯。
 */
export const selectDifferentialPrivacySensitiveCandidates = (input: {
    dpFields: DpStoreField[] | null | undefined;
    datasetProfile: DatasetProfile;
    forceRunHighCardinality: boolean;
}): { enabledFields: DpStoreField[]; effectiveCandidateColumnNames: string[]; highCardinalityInfo: HighCardinalitySensitiveInfo[] } => {
    const enabledFields = (input.dpFields || []).filter((field) => field.enabled);
    if (enabledFields.length === 0) {
        throw new Error('風險評估要求至少 1 個已啟用的差分隱私欄位，請回到步驟二欄位設定啟用欄位後再重新運算。');
    }
    const categoricalCandidateFieldsList = enabledFields.filter((field) => field.fieldType === 'Categorical');
    if (categoricalCandidateFieldsList.length === 0) {
        throw new Error('風險評估的敏感欄位僅能從已啟用的「類別型」欄位中挑選，目前沒有已啟用的類別型欄位，請回到步驟二欄位設定啟用至少 1 個類別型欄位後再重新運算。');
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
    return { enabledFields, effectiveCandidateColumnNames: effectiveCandidateFieldsList.map((field) => field.fieldName), highCardinalityInfo };
};

/** 差分隱私：高唯一值欄位處理結果的執行紀錄訊息（不含時間前綴） */
export const describeDifferentialPrivacyHighCardinalityHandling = (highCardinalityInfo: HighCardinalitySensitiveInfo[], forceRunHighCardinality: boolean): string[] => {
    if (highCardinalityInfo.length === 0) return [];
    const flaggedColumnsDescriptionText = describeHighCardinalityColumnsText(highCardinalityInfo);
    return [forceRunHighCardinality
        ? `⚠️ 已依設定強制對 ${flaggedColumnsDescriptionText} 執行三攻擊／CAP，此類欄位過去曾造成後端服務當機，如遇執行失敗或無回應請取消勾選「仍要強制執行」。`
        : `⚠️ ${flaggedColumnsDescriptionText} 的值幾乎每筆都不同，已略過該欄位的三攻擊／CAP 風險評估以避免觸發後端服務當機（不影響去識別化結果本身）；如仍要嘗試，請於下方勾選「仍要強制執行」。`];
};

/** 差分隱私：以某個候選欄位為敏感欄位、其餘已啟用欄位為間接識別 */
export const buildDifferentialPrivacyRiskColumnsForCandidate = (
    input: { enabledFields: DpStoreField[]; dpFields: DpStoreField[] | null | undefined; columnTypes: Record<string, unknown> | null | undefined },
    candidateSensitiveFieldName: string
): RiskColumnsMap => {
    const resolveDpRiskColumnType = (fieldName: string): string => {
        const targetField = (input.dpFields || []).find((field) => field.fieldName === fieldName);
        const isNumeric = targetField?.fieldType === 'Numeric';
        const originalColType = String(input.columnTypes?.[fieldName] || '').toLowerCase();
        const isDateTimeType = isDateTimeDpField(fieldName, originalColType);
        if (isNumeric) return isDateTimeType ? 'temporal' : 'numeric';
        if (targetField?.fieldType === 'Categorical') return 'categorical';
        return 'string';
    };
    const columnsMapResult: RiskColumnsMap = {};
    input.enabledFields.forEach((field) => {
        columnsMapResult[field.fieldName] = {
            role: field.fieldName === candidateSensitiveFieldName ? 'sensitive' : 'quasi_identifier',
            type: resolveDpRiskColumnType(field.fieldName)
        };
    });
    return columnsMapResult;
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

/** CAP：cap_before／cap_after 各自取最大值；其餘欄位取 cap_after 最高的那一輪 */
export const mergeWorstCaseCapReport = (worstCaseReport: CapReport | null, thisRoundReport: CapReport): CapReport => {
    const isThisRoundNewWorstCapCase: boolean = !worstCaseReport || thisRoundReport.cap_after > worstCaseReport.cap_after;
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
