/**
 * Step4 管線的風險評估階段：挑選候選敏感欄位（含高唯一值偵測與自動分級距）、逐輪執行三攻擊與 CAP 並取最大值。
 * 2026-09-30 自 Step4_Result.tsx 的 runFullPipeline 原封搬出（本體未改寫，只把元件內的變數改為參數），
 * 畫面狀態與執行紀錄透過 callback 回報。純運算部分見 utils/riskAssessment.ts。
 */
import {
    runRiskKAnonymity, runRiskDp, runRiskCap, isApiRequestCanceled,
    type ApiRequestOptions, type AttackReport, type CapReport
} from '../../../api/apiService';
import type { DatasetProfile } from '../../../utils/datasetProfile';
import type { DpStoreField } from '../../../utils/pipelineConfig';
import { buildBackendSubgroupPayload } from '../../../utils/riskSubgroupHelpers';
import { ENABLE_RISK_UPLOAD_COLUMN_TRIMMING, transformCsvBlobForRiskUpload, pruneKAnonymityBlockToColumns, formatMegabytesText } from '../../../utils/riskUploadTrimming';
import { extractCapRequestFailureReasonText, buildCapUnavailableReceipt } from '../../../utils/riskResultHelpers';
import { computeCapShuffleBaseline, encodeCsvBlobForCapBaseline, computeCapExcessRisk, isCapExcessNotApplicable, type CapEncodedTable } from '../../../utils/capBaseline';
import {
    resolveKAnonymityRiskColumns, selectKAnonymitySensitiveCandidates, describeKAnonymityHighCardinalityHandling,
    buildKAnonymityRiskColumnsForCandidate, buildKAnonymityConfigBlockForRisk, selectDifferentialPrivacySensitiveCandidates,
    describeDifferentialPrivacyHighCardinalityHandling, buildDifferentialPrivacyRiskColumnsForCandidate, buildDifferentialPrivacyConfigBlockForRisk, buildRiskAttackConfigObject,
    buildCapConfigObject, createJsonConfigFile, runWorstCaseAttackRounds, runWorstCaseCapRounds, buildOverrideRiskColumnsForCandidate,
    type RiskColumnsMap, type HighCardinalitySensitiveInfo
} from '../../../utils/riskAssessment';
import { resolveRiskColumnOverridesForDataset, resolveLinkabilityForRound, isDefaultRiskAttackParams } from '../../../utils/riskConfigImport';
import type { RiskColumnOverrides, RiskLinkabilityGroups, RiskAttackParams } from '../../../store/useWorkspaceStore';

export interface RiskAssessmentPhaseInput {
    privacyMode: string | null | undefined;
    /** 實際處理的欄位名稱（已去除 BOM） */
    processedColumnNames: string[];
    kAnonymityFields: unknown[];
    /** 畫面判定的欄位角色（欄位不在 kAnonymityFields 時使用） */
    resolveColumnRole: (columnName: string) => { role: string };
    dpFields: DpStoreField[] | null | undefined;
    columnTypes: Record<string, unknown> | null | undefined;
    datasetProfile: DatasetProfile;
    binWidthOverrides: Record<string, number>;
    forceRunHighCardinality: boolean;
    /** 去除 BOM 後的原始資料（★ 2026-11-02 F12：一律以 Blob 逐段處理，不再傳整份文字） */
    safeDataFile: File;
    /** 去識別化時送出的 config（DP 模式的累計值已更新為執行後的值） */
    configObject: Record<string, unknown>;
    datasetFileName: string | null | undefined;
    riskSubgroupFilters: Parameters<typeof buildBackendSubgroupPayload>[0];
    /** ★ 2026-10-28：匯入的風險評估欄位角色（null＝依 K-匿名角色／DP 欄位推導） */
    riskColumnOverrides?: RiskColumnOverrides | null;
    /** ★ 2026-10-28：連結性分組（null＝後端自動導出） */
    riskLinkability?: RiskLinkabilityGroups | null;
    /** ★ 2026-10-28：三攻擊實驗參數（null＝前端預設） */
    riskAttackParams?: RiskAttackParams | null;
    processedCsvBlob: Blob | null;
    requestOptions: ApiRequestOptions;
    appendLog: (messageText: string) => void;
    onHighCardinalityInfo: (highCardinalityInfo: HighCardinalitySensitiveInfo[]) => void;
    onAttackReport: (attackReport: AttackReport | null) => void;
    onCapReport: (capReport: CapReport | null) => void;
}

export interface RiskAssessmentPhaseResult {
    attackReport: AttackReport | null;
    capReport: CapReport | null;
    /** 本次高唯一值欄位處理結果（寫入 Step4 快取快照用；DP 模式沒有高唯一值欄位時為空陣列） */
    highCardinalityInfo: HighCardinalitySensitiveInfo[];
    /** ★ 2026-10-28：本次實際評估的對象（合規報告用）；沒有任何候選敏感欄位時為 null */
    evaluatedRiskTargets: EvaluatedRiskTargets | null;
}

export interface EvaluatedRiskTargets {
    /** imported＝依匯入的風險評估設定；derived＝依去識別化設定推導 */
    source: 'imported' | 'derived';
    quasiIdentifiers: string[];
    /** 逐一輪流評估的敏感欄位 */
    sensitive: string[];
    /** 實際送出的連結性分組（未送＝後端自動分組） */
    linkability: RiskLinkabilityGroups | null;
}

export const runRiskAssessmentPhase = async (input: RiskAssessmentPhaseInput): Promise<RiskAssessmentPhaseResult> => {
    const {
        privacyMode: currentPrivacyModeTypeStr,
        processedColumnNames: actualProcessedColumnsList,
        kAnonymityFields: kAnonymityFieldsList,
        resolveColumnRole: getCalculatedRole,
        dpFields: currentDpFieldsListArray,
        columnTypes: currentColumnTypesMapDict,
        datasetProfile: datasetProfileForRisk,
        binWidthOverrides: sensitiveBinWidthOverridesMap,
        forceRunHighCardinality: forceRunHighCardinalitySensitiveFieldsStatus,
        safeDataFile,
        configObject,
        datasetFileName: currentDatasetFileNameString,
        riskSubgroupFilters: riskSubgroupFiltersMapDict,
        riskColumnOverrides,
        riskLinkability,
        riskAttackParams,
        processedCsvBlob: finalCsvBlobData,
        requestOptions: pipelineRequestOptions,
        appendLog: appendPipelineLog,
        onHighCardinalityInfo: setHighCardinalitySensitiveWarningInfo,
        onAttackReport: setAttackReportData,
        onCapReport: setCapReportData
    } = input;

    // ★ 後端工程師回覆（2026-09-29）：連續數值型敏感欄位改為先分級距再送風險評估（完整說明見上方
    //   sensitiveBinWidthOverridesMap 狀態宣告處）。級距一律以 0 為原點切齊
    //   （floor(值 ÷ 寬度) × 寬度），確保原始資料與去識別化資料（CAP 需兩份）用同一套切點。
    //   非數值的儲存格（空值、抑制後的「*」等）原樣保留不轉換。
    // 本次實際套用級距的欄位 → 寬度；以及送風險評估用的原始資料副本（未分級距時即 safeDataFile 本身）。
    const riskEvaluationBinWidthMap: Record<string, number> = {};
    let riskOriginalDataFile: File = safeDataFile;

    // 候選欄位挑選、設定檔組裝與逐輪取最大值見 utils/riskAssessment.ts（含三攻擊固定參數 RISK_ATTACK_DEFAULT_PARAMS）。
    // 風險評估「對象族群限定條件」（《設定檔結構與參數說明.pdf》4-3 節）：未設定時為 undefined，設定檔即省略 subgroup。
    const resolvedRiskSubgroupPayload = buildBackendSubgroupPayload(riskSubgroupFiltersMapDict);
    const riskDatasetNameText = currentDatasetFileNameString || 'dataset';

    // ★ 2026-10-28：匯入的風險評估設定（統合版 risk_attacks）。欄位角色只保留實際處理的欄位，缺間接識別或敏感欄位時退回原本推導。
    // K-匿名：處理方式為「刪除／清空」的欄位不在處理後資料中（或已無值），不能當風險評估欄位
    const kAnonymityRemovedColumnNames = new Set(currentPrivacyModeTypeStr === 'k-anonymity'
        ? (kAnonymityFieldsList as { name?: unknown; maskStrategy?: unknown }[])
            .filter((fieldItem) => ['remove', 'clear'].includes(String(fieldItem?.maskStrategy || '')))
            .map((fieldItem) => String(fieldItem.name || '').replace(/^[\uFEFF\u200B]+/, '').trim())
        : []);
    const resolvedRiskColumnOverrides = resolveRiskColumnOverridesForDataset(
        riskColumnOverrides,
        actualProcessedColumnsList.filter((columnName) => !kAnonymityRemovedColumnNames.has(columnName.replace(/^[\uFEFF\u200B]+/, '').trim()))
    );
    if (resolvedRiskColumnOverrides) {
        const describeRole = (role: string) => Object.keys(resolvedRiskColumnOverrides).filter((name) => resolvedRiskColumnOverrides[name].role === role).map((name) => `「${name}」`).join('、');
        appendPipelineLog(`ℹ️ 風險評估欄位依匯入設定：間接識別 ${describeRole('quasi_identifier')}；敏感 ${describeRole('sensitive')}`);
    } else if (riskColumnOverrides) {
        appendPipelineLog('⚠️ 匯入的風險評估欄位在本次資料中缺少間接識別或敏感欄位，改依原本設定推導');
    }
    if (riskAttackParams && !isDefaultRiskAttackParams(riskAttackParams)) {
        appendPipelineLog(`ℹ️ 三攻擊實驗參數：n_iter ${riskAttackParams.n_iter}、ctrl_ratio ${riskAttackParams.ctrl_ratio}、seed ${riskAttackParams.seed}、n_subset ${riskAttackParams.n_subset}、n_repeats ${riskAttackParams.n_repeats}、overlap_ratio ${riskAttackParams.overlap_ratio}`);
    }
    // 連結性分組：本輪 A、B 都是間接識別才送出；不符時只記一次紀錄
    let hasLoggedLinkabilityFallback = false;
    const resolveRoundLinkability = (columnsForThisRound: RiskColumnsMap): RiskLinkabilityGroups | null => {
        const roundLinkability = resolveLinkabilityForRound(riskLinkability, columnsForThisRound);
        if (riskLinkability && !roundLinkability && !hasLoggedLinkabilityFallback) {
            hasLoggedLinkabilityFallback = true;
            appendPipelineLog('⚠️ 匯入的連結性分組含非間接識別欄位，已改由後端自動分組');
        }
        return roundLinkability;
    };

    // ★ 2026-10-06 上傳瘦身：三攻擊與 CAP 只上傳會用到的欄位（見 utils/riskUploadTrimming.ts）。
    //   null＝不裁切（功能關閉或尚未決定欄位）。
    let riskUploadKeepColumnNames: Set<string> | null = null;
    // 送風險評估的資料：先裁切欄位、再套用敏感欄位級距（原始資料與去識別化資料用同一套規則）
    // ★ 2026-11-02（F12）：Blob 進、Blob 出，逐段裁切與分級距（大檔不產生整檔字串）
    const buildRiskUploadBlob = (sourceBlob: Blob): Promise<Blob> =>
        transformCsvBlobForRiskUpload(sourceBlob, riskUploadKeepColumnNames, riskEvaluationBinWidthMap);
    const isRiskUploadTransformNeeded = (): boolean =>
        riskUploadKeepColumnNames !== null || Object.keys(riskEvaluationBinWidthMap).length > 0;
    const resolveRiskUploadKeepColumnNames = (requiredColumnNames: Iterable<string>): Set<string> | null => {
        if (!ENABLE_RISK_UPLOAD_COLUMN_TRIMMING) return null;
        const keepColumnNameSet = new Set(requiredColumnNames);
        Object.keys(resolvedRiskSubgroupPayload || {}).forEach((columnName) => keepColumnNameSet.add(columnName));
        return keepColumnNameSet.size > 0 ? keepColumnNameSet : null;
    };
    const prepareRiskOriginalDataFile = async () => {
        if (!isRiskUploadTransformNeeded()) return;
        const riskUploadBlob = await buildRiskUploadBlob(safeDataFile);
        riskOriginalDataFile = new File([riskUploadBlob], 'input_dataset.csv', { type: 'text/csv;charset=utf-8' });
        if (riskUploadKeepColumnNames && riskOriginalDataFile.size < safeDataFile.size) {
            appendPipelineLog(`📦 風險評估只上傳用到的 ${riskUploadKeepColumnNames.size} 個欄位，每次上傳 ${formatMegabytesText(safeDataFile.size)} MB → ${formatMegabytesText(riskOriginalDataFile.size)} MB`);
        }
    };

    // 只有 1 輪時不顯示輪次，避免看起來像在比較多組
    const logAttackRoundStart = (roundIndex: number, roundCount: number) => appendPipelineLog(roundCount > 1
        ? `⏳ 三攻擊風險評估運算中（第 ${roundIndex + 1}/${roundCount} 輪）...`
        : '⏳ 三攻擊風險評估運算中…');

    let attackReportResult: AttackReport | null = null;
    let capReportResult: CapReport | null = null;
    let finalRiskColumnsMap: RiskColumnsMap = {};
    // 三攻擊與 CAP 都對同一組候選敏感欄位逐一跑一輪、各自取最大值（某欄位三攻擊風險最高，不代表 CAP 也最高）
    let capCandidateColumnNamesList: string[] = [];
    let buildCapRiskColumnsMapForCandidateFn: ((candidateSensitiveFieldName: string) => RiskColumnsMap) | null = null;
    // setState 不會同步更新本次閉包內的 state 變數，寫入 Step4Cache 快照時改讀這個區域變數
    let finalHighCardinalitySensitiveWarningInfo: HighCardinalitySensitiveInfo[] = [];

    if (currentPrivacyModeTypeStr === 'k-anonymity') {
        const { riskColumnsMap: kAnonymityDerivedRiskColumnsMap, roleResolutionDiagnostics } = resolveKAnonymityRiskColumns({
            processedColumnNames: actualProcessedColumnsList,
            kAnonymityFields: kAnonymityFieldsList,
            resolveFallbackUiRole: (cleanColumnName) => getCalculatedRole(cleanColumnName).role
        });
        // ★ 2026-10-28：有匯入的風險評估欄位角色時以它為準
        const riskColumnsMap: RiskColumnsMap = resolvedRiskColumnOverrides ?? kAnonymityDerivedRiskColumnsMap;
        // 敏感欄位 = 0：只警告並略過三攻擊與 CAP；≥ 2：在這幾欄之間輪流當敏感欄位、取最大值
        const sensitiveCandidateColumnNamesList = Object.keys(riskColumnsMap).filter(
            (colName) => riskColumnsMap[colName].role === 'sensitive'
        );
        const kAnonCandidateSelection = selectKAnonymitySensitiveCandidates({
            candidateColumnNames: sensitiveCandidateColumnNamesList,
            datasetProfile: datasetProfileForRisk,
            binWidthOverrides: sensitiveBinWidthOverridesMap,
            forceRunHighCardinality: forceRunHighCardinalitySensitiveFieldsStatus
        });
        Object.assign(riskEvaluationBinWidthMap, kAnonCandidateSelection.binWidthMap);
        // 只需要間接識別＋敏感欄位（riskColumnsMap 本來就只收這兩種）；沒有候選欄位時不會送出請求，不必裁切
        if (kAnonCandidateSelection.effectiveCandidateColumnNames.length > 0) {
            // 使用匯入的欄位角色時，K-匿名原本的間接識別也要保留（後端依 k_anonymity 區塊重做去識別化，裁掉會改變結果）
            riskUploadKeepColumnNames = resolveRiskUploadKeepColumnNames([...Object.keys(riskColumnsMap), ...Object.keys(kAnonymityDerivedRiskColumnsMap)]);
        }
        await prepareRiskOriginalDataFile();
        setHighCardinalitySensitiveWarningInfo(kAnonCandidateSelection.highCardinalityInfo);
        finalHighCardinalitySensitiveWarningInfo = kAnonCandidateSelection.highCardinalityInfo;
        describeKAnonymityHighCardinalityHandling(kAnonCandidateSelection.highCardinalityInfo).forEach(appendPipelineLog);

        const effectiveSensitiveCandidateColumnNamesList = kAnonCandidateSelection.effectiveCandidateColumnNames;
        const buildKAnonRiskColumnsMapForCandidate = (candidateSensitiveFieldName: string) => resolvedRiskColumnOverrides
            ? buildOverrideRiskColumnsForCandidate(resolvedRiskColumnOverrides, riskEvaluationBinWidthMap, candidateSensitiveFieldName)
            : buildKAnonymityRiskColumnsForCandidate(riskColumnsMap, riskEvaluationBinWidthMap, candidateSensitiveFieldName);
        capCandidateColumnNamesList = effectiveSensitiveCandidateColumnNamesList;
        buildCapRiskColumnsMapForCandidateFn = buildKAnonRiskColumnsMapForCandidate;

        if (effectiveSensitiveCandidateColumnNamesList.length === 0) {
            if (sensitiveCandidateColumnNamesList.length === 0) {
                // 主控台印出逐欄比對快照，F12 → Console 可直接看出為何沒有敏感欄位
                console.warn(
                    '[風險評估／敏感欄位] 目前未偵測到任何「敏感」欄位，本次跳過三攻擊與 CAP 風險評估' +
                    '（不影響去識別化資料本身的產生與品質分數）。逐欄比對快照：',
                    roleResolutionDiagnostics,
                    '目前 kAnonymityFieldsList 原始內容：',
                    kAnonymityFieldsList
                );
                appendPipelineLog('⚠️ 未設定「敏感」欄位，已略過三攻擊與 CAP 風險評估（去識別化結果與品質分數不受影響）。');
            }
            // 全部候選都被判定為高唯一值時，上方已記錄對應訊息，這裡不再重複
            finalRiskColumnsMap = riskColumnsMap;
        } else {
            const kAnonConfigBlockWithBinning = buildKAnonymityConfigBlockForRisk((configObject as Record<string, unknown>).k_anonymity, riskEvaluationBinWidthMap);
            // 資料只剩部分欄位時，設定檔也只能宣告這些欄位（後端找不到宣告的欄位會報錯）
            const kAnonConfigBlockForRisk = riskUploadKeepColumnNames
                ? pruneKAnonymityBlockToColumns(kAnonConfigBlockWithBinning, riskUploadKeepColumnNames)
                : kAnonConfigBlockWithBinning;
            const kAnonAttackRoundsResult = await runWorstCaseAttackRounds({
                candidateColumnNames: effectiveSensitiveCandidateColumnNamesList,
                buildColumnsForCandidate: buildKAnonRiskColumnsMapForCandidate,
                onRoundStart: logAttackRoundStart,
                runRound: async (columnsForThisRound, candidateSensitiveFieldName) => {
                    const riskConfigFile = createJsonConfigFile(buildRiskAttackConfigObject({
                        version: 'step4_risk_k_anonymity', dataset: riskDatasetNameText, columns: columnsForThisRound,
                        subgroup: resolvedRiskSubgroupPayload, privacyBlock: { k_anonymity: kAnonConfigBlockForRisk },
                        attackParams: riskAttackParams, linkability: resolveRoundLinkability(columnsForThisRound)
                    }), 'risk_config.json');
                    const riskResponse = await runRiskKAnonymity(riskOriginalDataFile, riskConfigFile, pipelineRequestOptions);
                    if (!riskResponse.success || !riskResponse.report) throw (riskResponse.error || new Error(`三攻擊風險評估（K-匿名，以「${candidateSensitiveFieldName}」為敏感欄位）API 請求未成功`));
                    return riskResponse.report;
                }
            });
            appendPipelineLog('✅ K-匿名三攻擊風險評估運算完成');
            attackReportResult = kAnonAttackRoundsResult.worstCaseReport;
            finalRiskColumnsMap = kAnonAttackRoundsResult.worstCaseColumns;
        }
    } else if (currentPrivacyModeTypeStr === 'differential-privacy') {
        let dpEffectiveCandidateColumnNames: string[];
        let dpConfigBlockForRisk: unknown;
        let buildDpRiskColumnsMapForCandidate: (candidateSensitiveFieldName: string) => RiskColumnsMap;
        if (resolvedRiskColumnOverrides) {
            // ★ 2026-10-28：使用匯入的風險評估欄位角色：敏感欄位依 risk_attacks（不必是加噪欄位），高唯一值處理比照 K-匿名
            const overrideOnlyColumns = resolvedRiskColumnOverrides;
            const overrideSelection = selectKAnonymitySensitiveCandidates({
                candidateColumnNames: Object.keys(overrideOnlyColumns).filter((name) => overrideOnlyColumns[name].role === 'sensitive'),
                datasetProfile: datasetProfileForRisk,
                binWidthOverrides: sensitiveBinWidthOverridesMap,
                forceRunHighCardinality: forceRunHighCardinalitySensitiveFieldsStatus
            });
            Object.assign(riskEvaluationBinWidthMap, overrideSelection.binWidthMap);
            // 分級距的敏感欄位若也有加噪預算，改以類別型評估（與 Step2 點選敏感欄位的處理相同）
            dpConfigBlockForRisk = buildDifferentialPrivacyConfigBlockForRisk(
                (configObject as Record<string, unknown>).differential_privacy, Object.keys(overrideSelection.binWidthMap)
            );
            if (overrideSelection.highCardinalityInfo.length > 0) {
                setHighCardinalitySensitiveWarningInfo(overrideSelection.highCardinalityInfo);
                finalHighCardinalitySensitiveWarningInfo = overrideSelection.highCardinalityInfo;
                describeKAnonymityHighCardinalityHandling(overrideSelection.highCardinalityInfo).forEach(appendPipelineLog);
            }
            buildDpRiskColumnsMapForCandidate = (candidateSensitiveFieldName: string) =>
                buildOverrideRiskColumnsForCandidate(overrideOnlyColumns, riskEvaluationBinWidthMap, candidateSensitiveFieldName);
            dpEffectiveCandidateColumnNames = overrideSelection.effectiveCandidateColumnNames;
        } else {
            // 輪流把每個候選類別型欄位當敏感欄位（其餘已啟用欄位為間接識別），輪次數 = 候選欄位數
            const dpCandidateSelection = selectDifferentialPrivacySensitiveCandidates({
                dpFields: currentDpFieldsListArray,
                datasetProfile: datasetProfileForRisk,
                forceRunHighCardinality: forceRunHighCardinalitySensitiveFieldsStatus,
                binWidthOverrides: sensitiveBinWidthOverridesMap
            });
            // 點選為敏感的連續數值欄位（如薪資）先分級距：原始資料在這裡轉換，去識別化結果在下方 CAP 段落以同一套級距轉換
            Object.assign(riskEvaluationBinWidthMap, dpCandidateSelection.binWidthMap);
            dpConfigBlockForRisk = buildDifferentialPrivacyConfigBlockForRisk(
                (configObject as Record<string, unknown>).differential_privacy, dpCandidateSelection.categoricalOverrideColumnNames
            );
            if (dpCandidateSelection.skippedReason) appendPipelineLog(`⚠️ ${dpCandidateSelection.skippedReason}`);
            else appendPipelineLog(dpCandidateSelection.designatedSensitiveColumnNames.length > 0
                ? `ℹ️ 依步驟二點選的 ${dpCandidateSelection.designatedSensitiveColumnNames.length} 個敏感欄位（${dpCandidateSelection.designatedSensitiveColumnNames.map((name) => `「${name}」`).join('、')}），每輪只以其中 1 個為敏感欄位執行三攻擊／CAP（共 ${dpCandidateSelection.effectiveCandidateColumnNames.length} 輪），取風險最高的結果`
                : `ℹ️ 步驟二未指定敏感欄位，改為輪流以 ${dpCandidateSelection.effectiveCandidateColumnNames.length} 個類別型欄位為敏感欄位評估，取風險最高的結果`);
            if (dpCandidateSelection.highCardinalityInfo.length > 0) {
                setHighCardinalitySensitiveWarningInfo(dpCandidateSelection.highCardinalityInfo);
                finalHighCardinalitySensitiveWarningInfo = dpCandidateSelection.highCardinalityInfo;
                describeDifferentialPrivacyHighCardinalityHandling(dpCandidateSelection.highCardinalityInfo, forceRunHighCardinalitySensitiveFieldsStatus).forEach(appendPipelineLog);
            }

            buildDpRiskColumnsMapForCandidate = (candidateSensitiveFieldName: string) => buildDifferentialPrivacyRiskColumnsForCandidate(
                { enabledFields: dpCandidateSelection.enabledFields, dpFields: currentDpFieldsListArray, columnTypes: currentColumnTypesMapDict, categoricalOverrideColumnNames: dpCandidateSelection.categoricalOverrideColumnNames },
                candidateSensitiveFieldName
            );
            dpEffectiveCandidateColumnNames = dpCandidateSelection.effectiveCandidateColumnNames;
        }
        capCandidateColumnNamesList = dpEffectiveCandidateColumnNames;
        buildCapRiskColumnsMapForCandidateFn = buildDpRiskColumnsMapForCandidate;

        // 需要的欄位＝各輪 columns 的聯集＋設定檔 column_budgets 宣告的欄位（後端要求宣告的欄位存在於資料中）
        if (dpEffectiveCandidateColumnNames.length > 0) {
            const dpRequiredColumnNameSet = new Set<string>();
            dpEffectiveCandidateColumnNames.forEach((candidateSensitiveFieldName) =>
                Object.keys(buildDpRiskColumnsMapForCandidate(candidateSensitiveFieldName)).forEach((columnName) => dpRequiredColumnNameSet.add(columnName)));
            const dpColumnBudgetsMap = ((dpConfigBlockForRisk as Record<string, unknown> | undefined)?.column_budgets || {}) as Record<string, unknown>;
            Object.keys(dpColumnBudgetsMap).forEach((columnName) => dpRequiredColumnNameSet.add(columnName));
            riskUploadKeepColumnNames = resolveRiskUploadKeepColumnNames(dpRequiredColumnNameSet);
        }
        await prepareRiskOriginalDataFile();

        // 候選被篩到 0 個時迴圈不執行、attackReportResult 維持 null，等同略過三攻擊／CAP
        const dpAttackRoundsResult = await runWorstCaseAttackRounds({
            candidateColumnNames: dpEffectiveCandidateColumnNames,
            buildColumnsForCandidate: buildDpRiskColumnsMapForCandidate,
            onRoundStart: logAttackRoundStart,
            runRound: async (columnsForThisRound, candidateSensitiveFieldName) => {
                const riskConfigFile = createJsonConfigFile(buildRiskAttackConfigObject({
                    version: 'step4_risk_dp', dataset: riskDatasetNameText, columns: columnsForThisRound,
                    subgroup: resolvedRiskSubgroupPayload, privacyBlock: { differential_privacy: dpConfigBlockForRisk },
                    attackParams: riskAttackParams, linkability: resolveRoundLinkability(columnsForThisRound)
                }), 'risk_config.json');
                const riskResponse = await runRiskDp(riskOriginalDataFile, riskConfigFile, pipelineRequestOptions);
                if (!riskResponse.success || !riskResponse.report) throw (riskResponse.error || new Error(`三攻擊風險評估（DP，以「${candidateSensitiveFieldName}」為敏感欄位）API 請求未成功`));
                return riskResponse.report;
            }
        });
        appendPipelineLog('✅ DP 三攻擊風險評估運算完成');
        attackReportResult = dpAttackRoundsResult.worstCaseReport;
        finalRiskColumnsMap = dpAttackRoundsResult.worstCaseColumns;
    }

    setAttackReportData(attackReportResult);
    if (attackReportResult) {
        appendPipelineLog(`✅ 三攻擊風險評估完成（指認性 ${(attackReportResult.singling_out_risk * 100).toFixed(1)}%／連結性 ${(attackReportResult.linkability_risk * 100).toFixed(1)}%／推斷性 ${(attackReportResult.inference_risk * 100).toFixed(1)}%）`);
    }

    // 沒有任何候選敏感欄位時整段 CAP 跳過，不送一次注定被後端擋掉的請求
    const isRiskCandidateListEmptyStatus =
        (currentPrivacyModeTypeStr === 'k-anonymity' || currentPrivacyModeTypeStr === 'differential-privacy') &&
        capCandidateColumnNamesList.length === 0;

    if (finalCsvBlobData && !isRiskCandidateListEmptyStatus) {
        try {
            // 有敏感欄位自動分級距時，CAP 的原始與去識別化兩份資料都要用同一套級距轉換
            // 有敏感欄位自動分級距或欄位裁切時，去識別化資料也套用與原始資料相同的轉換
            // ★ 2026-10-06：另保留送出的處理後資料文字，供前端計算 CAP 亂猜基線（見 utils/capBaseline.ts）
            // ★ 2026-11-02（F12）：處理後資料同樣以 Blob 逐段轉換，不讀成整份文字
            const processedCapBlob = isRiskUploadTransformNeeded() ? await buildRiskUploadBlob(finalCsvBlobData) : finalCsvBlobData;
            const processedFileForCap = new File([processedCapBlob], 'processed_dataset.csv', { type: 'text/csv;charset=utf-8' });
            // ★ 2026-10-30：處理後資料只編碼一次、各輪共用；編碼後即放掉整份文字（見 utils/capBaseline.ts）
            const encodedCapTable: CapEncodedTable | null = await encodeCsvBlobForCapBaseline(processedCapBlob);
            const getEncodedCapTable = (): CapEncodedTable | null => encodedCapTable;
            const attachCapBaseline = (capReport: CapReport, capColumnsMap: RiskColumnsMap, sensitiveColumnName: string | undefined): CapReport => {
                if (!sensitiveColumnName || capReport.cap_after < 0) return capReport;
                const baselineResult = computeCapShuffleBaseline(getEncodedCapTable(), {
                    quasiIdentifierColumnNames: Object.entries(capColumnsMap).filter(([, columnSpec]) => columnSpec.role === 'quasi_identifier').map(([columnName]) => columnName),
                    sensitiveColumnName,
                    subgroupPayload: resolvedRiskSubgroupPayload
                });
                if (baselineResult && Math.abs(baselineResult.recomputedCap - capReport.cap_after) > 0.005) {
                    // 前端重算與後端不一致（例如 CSV 解析差異）時只記在主控台，不影響畫面
                    console.warn(`CAP 亂猜基線：前端重算 CAP ${baselineResult.recomputedCap.toFixed(4)} 與後端 cap_after ${capReport.cap_after} 不一致`);
                }
                const baselineValue = baselineResult ? baselineResult.baseline : null;
                return {
                    ...capReport,
                    cap_sensitive_column: sensitiveColumnName,
                    cap_baseline_after: baselineValue,
                    // 用前端重算的完整精度 CAP（與後端同一公式），避免後端四捨五入到小數 4 位造成偏差
                    cap_after_excess: computeCapExcessRisk(baselineResult ? baselineResult.recomputedCap : capReport.cap_after, baselineValue)
                };
            };
            // 後端只評設定檔中的第一個敏感欄位（cap_mode.py：sensitive_cols[0]）
            const resolveFirstSensitiveColumnName = (capColumnsMap: RiskColumnsMap): string | undefined =>
                Object.entries(capColumnsMap).find(([, columnSpec]) => columnSpec.role === 'sensitive')?.[0];
            const runCapRequest = (capColumnsMap: RiskColumnsMap) => runRiskCap(
                riskOriginalDataFile, processedFileForCap,
                createJsonConfigFile(buildCapConfigObject({ dataset: riskDatasetNameText, columns: capColumnsMap, subgroup: resolvedRiskSubgroupPayload }), 'cap_config.json'),
                pipelineRequestOptions
            );

            if (buildCapRiskColumnsMapForCandidateFn && capCandidateColumnNamesList.length > 0) {
                // 逐輪容錯：單一候選欄位失敗只略過該輪；全部失敗時產生「無法評估」收據並顯示真正原因
                capReportResult = await runWorstCaseCapRounds({
                    candidateColumnNames: capCandidateColumnNamesList,
                    buildColumnsForCandidate: buildCapRiskColumnsMapForCandidateFn,
                    // 只有 1 輪時不顯示輪次，避免看起來像在比較多組
                    onRoundStart: (roundIndex, roundCount) => appendPipelineLog(roundCount > 1
                        ? `⏳ CAP 前後對比運算中（第 ${roundIndex + 1}/${roundCount} 輪）...`
                        : '⏳ CAP 前後對比運算中…'),
                    runRound: async (capColumnsMap, candidateSensitiveFieldName) => {
                        const capResponse = await runCapRequest(capColumnsMap);
                        return capResponse.success && capResponse.report
                            ? { ...capResponse, report: attachCapBaseline(capResponse.report, capColumnsMap, resolveFirstSensitiveColumnName(capColumnsMap) || candidateSensitiveFieldName) }
                            : capResponse;
                    },
                    onRoundFailed: (roundIndex, candidateSensitiveFieldName, reasonText, errorPayload) => {
                        console.error(`CAP 前後對比（以「${candidateSensitiveFieldName}」為敏感欄位）失敗:`, errorPayload);
                        appendPipelineLog(`⚠️ CAP 第 ${roundIndex + 1} 輪（敏感欄位「${candidateSensitiveFieldName}」）失敗，已略過該輪：${reasonText}`);
                    }
                });
            } else {
                const capResponse = await runCapRequest(finalRiskColumnsMap);
                if (!capResponse.success || !capResponse.report) throw (capResponse.error || new Error('CAP 前後對比 API 請求未成功'));
                capReportResult = attachCapBaseline(capResponse.report, finalRiskColumnsMap, resolveFirstSensitiveColumnName(finalRiskColumnsMap));
            }

            setCapReportData(capReportResult);
            // 印出 /api/v1/risk/cap 的完整回應，不必跟 DevTools Network 分頁的快取逐出賽跑
            console.log('📩 /api/v1/risk/cap 原始回應內容:', capReportResult);
            if (capReportResult && capReportResult.cap_before >= 0 && capReportResult.cap_after >= 0) {
                appendPipelineLog(`✅ CAP 前後對比完成（處理前 ${(capReportResult.cap_before * 100).toFixed(1)}% → 處理後 ${(capReportResult.cap_after * 100).toFixed(1)}%）`);
                if (isCapExcessNotApplicable(capReportResult.cap_baseline_after)) {
                    appendPipelineLog(`ℹ️ 敏感欄位「${capReportResult.cap_sensitive_column}」：間接識別欄位幾乎每筆都不同（亂猜基線 ${((capReportResult.cap_baseline_after as number) * 100).toFixed(1)}%），CAP 無法判斷，「能否猜出敏感資料」改以推斷性攻擊為準`);
                } else if (typeof capReportResult.cap_baseline_after === 'number' && typeof capReportResult.cap_after_excess === 'number') {
                    appendPipelineLog(`ℹ️ 敏感欄位「${capReportResult.cap_sensitive_column}」亂猜基線（打亂敏感欄位後的 CAP）${(capReportResult.cap_baseline_after * 100).toFixed(1)}%，扣除後的猜中風險 ${(capReportResult.cap_after_excess * 100).toFixed(1)}%`);
                }
            } else if (capReportResult) {
                appendPipelineLog(`⚠️ CAP 前後對比未能評估：${capReportResult.message}`);
            }
        } catch (capErrorPayload) {
            if (isApiRequestCanceled(capErrorPayload)) throw capErrorPayload;
            console.error('CAP 前後對比失敗:', capErrorPayload);
            const capFailureReasonText = extractCapRequestFailureReasonText(capErrorPayload);
            capReportResult = buildCapUnavailableReceipt(capFailureReasonText);
            setCapReportData(capReportResult);
            appendPipelineLog(`⚠️ CAP 前後對比失敗，已略過（不影響風險評估結果）：${capFailureReasonText}`);
        }
    } else {
        // ★ 2026-11-02：略過 CAP 時清掉畫面上的 CAP 結果，避免留著上一輪的舊數字
        setCapReportData(null);
        if (!finalCsvBlobData) appendPipelineLog('⚠️ 未取得脫敏後資料集，略過 CAP 前後對比');
    }

    // ★ 2026-10-28：合規報告記錄本次實際評估的欄位（間接識別取各輪聯集）
    let evaluatedRiskTargets: EvaluatedRiskTargets | null = null;
    if (buildCapRiskColumnsMapForCandidateFn && capCandidateColumnNamesList.length > 0) {
        const quasiIdentifierNameSet = new Set<string>();
        let sentLinkability: RiskLinkabilityGroups | null = null;
        capCandidateColumnNamesList.forEach((candidateName) => {
            const roundColumns = buildCapRiskColumnsMapForCandidateFn!(candidateName);
            Object.entries(roundColumns).forEach(([columnName, spec]) => { if (spec.role === 'quasi_identifier') quasiIdentifierNameSet.add(columnName); });
            sentLinkability = sentLinkability ?? resolveLinkabilityForRound(riskLinkability, roundColumns);
        });
        evaluatedRiskTargets = {
            source: resolvedRiskColumnOverrides ? 'imported' : 'derived',
            quasiIdentifiers: Array.from(quasiIdentifierNameSet),
            sensitive: [...capCandidateColumnNamesList],
            linkability: sentLinkability
        };
    }

    return { attackReport: attackReportResult, capReport: capReportResult, highCardinalityInfo: finalHighCardinalitySensitiveWarningInfo, evaluatedRiskTargets };
};
