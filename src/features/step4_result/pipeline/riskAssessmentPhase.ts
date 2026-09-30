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
import { applySensitiveBinningToCsvText } from '../../../utils/sensitiveBinning';
import { extractCapRequestFailureReasonText, buildCapUnavailableReceipt } from '../../../utils/riskResultHelpers';
import {
    resolveKAnonymityRiskColumns, selectKAnonymitySensitiveCandidates, describeKAnonymityHighCardinalityHandling,
    buildKAnonymityRiskColumnsForCandidate, buildKAnonymityConfigBlockForRisk, selectDifferentialPrivacySensitiveCandidates,
    describeDifferentialPrivacyHighCardinalityHandling, buildDifferentialPrivacyRiskColumnsForCandidate, buildRiskAttackConfigObject,
    buildCapConfigObject, createJsonConfigFile, runWorstCaseAttackRounds, runWorstCaseCapRounds,
    type RiskColumnsMap, type HighCardinalitySensitiveInfo
} from '../../../utils/riskAssessment';

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
    /** 去除 BOM 後的原始 CSV 文字，與 safeDataFile 內容相同 */
    cleanedCsvText: string;
    safeDataFile: File;
    /** 去識別化時送出的 config（DP 模式的累計值已更新為執行後的值） */
    configObject: Record<string, unknown>;
    datasetFileName: string | null | undefined;
    riskSubgroupFilters: Parameters<typeof buildBackendSubgroupPayload>[0];
    processedCsvBlob: Blob | null;
    /** 讀取去識別化結果文字（只讀一次，與筆數統計共用） */
    readProcessedCsvText: () => Promise<string>;
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
        cleanedCsvText,
        safeDataFile,
        configObject,
        datasetFileName: currentDatasetFileNameString,
        riskSubgroupFilters: riskSubgroupFiltersMapDict,
        processedCsvBlob: finalCsvBlobData,
        readProcessedCsvText: readProcessedCsvTextOnce,
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

    let attackReportResult: AttackReport | null = null;
    let capReportResult: CapReport | null = null;
    let finalRiskColumnsMap: RiskColumnsMap = {};
    // 三攻擊與 CAP 都對同一組候選敏感欄位逐一跑一輪、各自取最大值（某欄位三攻擊風險最高，不代表 CAP 也最高）
    let capCandidateColumnNamesList: string[] = [];
    let buildCapRiskColumnsMapForCandidateFn: ((candidateSensitiveFieldName: string) => RiskColumnsMap) | null = null;
    // setState 不會同步更新本次閉包內的 state 變數，寫入 Step4Cache 快照時改讀這個區域變數
    let finalHighCardinalitySensitiveWarningInfo: HighCardinalitySensitiveInfo[] = [];

    if (currentPrivacyModeTypeStr === 'k-anonymity') {
        const { riskColumnsMap, roleResolutionDiagnostics } = resolveKAnonymityRiskColumns({
            processedColumnNames: actualProcessedColumnsList,
            kAnonymityFields: kAnonymityFieldsList,
            resolveFallbackUiRole: (cleanColumnName) => getCalculatedRole(cleanColumnName).role
        });
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
        if (Object.keys(riskEvaluationBinWidthMap).length > 0) {
            riskOriginalDataFile = new File(
                [applySensitiveBinningToCsvText(cleanedCsvText, riskEvaluationBinWidthMap)],
                'input_dataset.csv',
                { type: 'text/csv;charset=utf-8' }
            );
        }
        setHighCardinalitySensitiveWarningInfo(kAnonCandidateSelection.highCardinalityInfo);
        finalHighCardinalitySensitiveWarningInfo = kAnonCandidateSelection.highCardinalityInfo;
        describeKAnonymityHighCardinalityHandling(kAnonCandidateSelection.highCardinalityInfo).forEach(appendPipelineLog);

        const effectiveSensitiveCandidateColumnNamesList = kAnonCandidateSelection.effectiveCandidateColumnNames;
        const buildKAnonRiskColumnsMapForCandidate = (candidateSensitiveFieldName: string) =>
            buildKAnonymityRiskColumnsForCandidate(riskColumnsMap, riskEvaluationBinWidthMap, candidateSensitiveFieldName);
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
            const kAnonConfigBlockForRisk = buildKAnonymityConfigBlockForRisk((configObject as Record<string, unknown>).k_anonymity, riskEvaluationBinWidthMap);
            const kAnonAttackRoundsResult = await runWorstCaseAttackRounds({
                candidateColumnNames: effectiveSensitiveCandidateColumnNamesList,
                buildColumnsForCandidate: buildKAnonRiskColumnsMapForCandidate,
                onRoundStart: (roundIndex, roundCount) => appendPipelineLog(`⏳ 三攻擊風險評估運算中（第 ${roundIndex + 1}/${roundCount} 輪）...`),
                runRound: async (columnsForThisRound, candidateSensitiveFieldName) => {
                    const riskConfigFile = createJsonConfigFile(buildRiskAttackConfigObject({
                        version: 'step4_risk_k_anonymity', dataset: riskDatasetNameText, columns: columnsForThisRound,
                        subgroup: resolvedRiskSubgroupPayload, privacyBlock: { k_anonymity: kAnonConfigBlockForRisk }
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
        // 輪流把每個候選類別型欄位當敏感欄位（其餘已啟用欄位為間接識別），輪次數 = 候選欄位數
        const dpCandidateSelection = selectDifferentialPrivacySensitiveCandidates({
            dpFields: currentDpFieldsListArray,
            datasetProfile: datasetProfileForRisk,
            forceRunHighCardinality: forceRunHighCardinalitySensitiveFieldsStatus
        });
        if (dpCandidateSelection.highCardinalityInfo.length > 0) {
            setHighCardinalitySensitiveWarningInfo(dpCandidateSelection.highCardinalityInfo);
            finalHighCardinalitySensitiveWarningInfo = dpCandidateSelection.highCardinalityInfo;
            describeDifferentialPrivacyHighCardinalityHandling(dpCandidateSelection.highCardinalityInfo, forceRunHighCardinalitySensitiveFieldsStatus).forEach(appendPipelineLog);
        }

        const buildDpRiskColumnsMapForCandidate = (candidateSensitiveFieldName: string) => buildDifferentialPrivacyRiskColumnsForCandidate(
            { enabledFields: dpCandidateSelection.enabledFields, dpFields: currentDpFieldsListArray, columnTypes: currentColumnTypesMapDict },
            candidateSensitiveFieldName
        );
        capCandidateColumnNamesList = dpCandidateSelection.effectiveCandidateColumnNames;
        buildCapRiskColumnsMapForCandidateFn = buildDpRiskColumnsMapForCandidate;

        // 候選被篩到 0 個時迴圈不執行、attackReportResult 維持 null，等同略過三攻擊／CAP
        const dpAttackRoundsResult = await runWorstCaseAttackRounds({
            candidateColumnNames: dpCandidateSelection.effectiveCandidateColumnNames,
            buildColumnsForCandidate: buildDpRiskColumnsMapForCandidate,
            onRoundStart: (roundIndex, roundCount) => appendPipelineLog(`⏳ 三攻擊風險評估運算中（第 ${roundIndex + 1}/${roundCount} 輪）...`),
            runRound: async (columnsForThisRound, candidateSensitiveFieldName) => {
                const riskConfigFile = createJsonConfigFile(buildRiskAttackConfigObject({
                    version: 'step4_risk_dp', dataset: riskDatasetNameText, columns: columnsForThisRound,
                    subgroup: resolvedRiskSubgroupPayload, privacyBlock: { differential_privacy: (configObject as Record<string, unknown>).differential_privacy }
                }), 'risk_config.json');
                const riskResponse = await runRiskDp(safeDataFile, riskConfigFile, pipelineRequestOptions);
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
            const processedFileForCap = Object.keys(riskEvaluationBinWidthMap).length > 0
                ? new File([applySensitiveBinningToCsvText(await readProcessedCsvTextOnce(), riskEvaluationBinWidthMap)], 'processed_dataset.csv', { type: 'text/csv;charset=utf-8' })
                : new File([finalCsvBlobData], 'processed_dataset.csv', { type: 'text/csv;charset=utf-8' });
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
                    onRoundStart: (roundIndex, roundCount) => appendPipelineLog(`⏳ CAP 前後對比運算中（第 ${roundIndex + 1}/${roundCount} 輪）...`),
                    runRound: (capColumnsMap) => runCapRequest(capColumnsMap),
                    onRoundFailed: (roundIndex, candidateSensitiveFieldName, reasonText, errorPayload) => {
                        console.error(`CAP 前後對比（以「${candidateSensitiveFieldName}」為敏感欄位）失敗:`, errorPayload);
                        appendPipelineLog(`⚠️ CAP 第 ${roundIndex + 1} 輪（敏感欄位「${candidateSensitiveFieldName}」）失敗，已略過該輪：${reasonText}`);
                    }
                });
            } else {
                const capResponse = await runCapRequest(finalRiskColumnsMap);
                if (!capResponse.success || !capResponse.report) throw (capResponse.error || new Error('CAP 前後對比 API 請求未成功'));
                capReportResult = capResponse.report;
            }

            setCapReportData(capReportResult);
            // 印出 /api/v1/risk/cap 的完整回應，不必跟 DevTools Network 分頁的快取逐出賽跑
            console.log('📩 /api/v1/risk/cap 原始回應內容:', capReportResult);
            if (capReportResult && capReportResult.cap_before >= 0 && capReportResult.cap_after >= 0) {
                appendPipelineLog(`✅ CAP 前後對比完成（處理前 ${(capReportResult.cap_before * 100).toFixed(1)}% → 處理後 ${(capReportResult.cap_after * 100).toFixed(1)}%）`);
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
    } else if (!finalCsvBlobData) {
        appendPipelineLog('⚠️ 未取得脫敏後資料集，略過 CAP 前後對比');
    }

    return { attackReport: attackReportResult, capReport: capReportResult, highCardinalityInfo: finalHighCardinalitySensitiveWarningInfo };
};
