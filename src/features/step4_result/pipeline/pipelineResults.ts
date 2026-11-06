/**
 * Step4 管線完成後的結果計算：風險分數正規化、輸入／刪除／輸出筆數、合規判斷、稽核紀錄內容。
 * 2026-09-30 自 Step4_Result.tsx 抽出，行為不變。
 */
import type { AttackReport, KAnonymityQualityReport, DpQualityReport } from '../../../api/apiService';
import type { AuditLogItem } from '../../../store/useAuditStore';
import { countCsvDataRowsInBlob } from '../../../utils/blobStreaming';
import { isDpBudgetExceeded } from '../../../utils/pipelineConfig';
import { resolveAuditLogComplianceStatus, type ComplianceReportSnapshot } from '../../../utils/complianceReport';

export interface SimulationResult
{
    singling: { risk: number };     // 後端回傳的指認性風險（已扣除控制組與亂猜基準）
    linkability: { risk: number };  // 後端回傳的連結性風險（同上）
    inference: { risk: number };    // 後端回傳的推斷性風險（同上）
    overallRiskPercent: string;
}

export type PipelinePhase = 'uploading' | 'processing' | 'auditing' | 'completed';

export interface DatasetRowStats { input: number; deleted: number; output: number }

/**
 * 函數名稱: evaluateComplianceValidity
 * 函數功能: 依據後端回傳之品質／預算報告，判斷本次去識別化處理是否真正達到合規標準，
 *           而非不論結果一律顯示「已通過」。K-匿名化採後端回傳之 is_valid (涵蓋抑制率與 k/l/t 檢測)；
 *           差分隱私因預算報告本身無 pass/fail 欄位，改以消耗之 ε 是否超出使用者設定之預算上限判斷。
 *
 * 輸入參數 (Input):
 *   - privacyModeTypeStr (string | null | undefined): 當前隱私保護模式
 *   - reportData (KAnonymityQualityReport | DpQualityReport | null): 後端回傳之報告物件
 *   - budgetLimitEpsilonValue (number): 使用者設定之累積隱私預算門檻上限
 * 返回值 (Return): boolean，true 表示達到合規標準
 */
export const evaluateComplianceValidity = (
    privacyModeTypeStr: string | null | undefined,
    reportData: KAnonymityQualityReport | DpQualityReport | null,
    budgetLimitEpsilonValue: number
): boolean => {
    if (!reportData) return true;

    if (privacyModeTypeStr === 'k-anonymity') {
        return (reportData as KAnonymityQualityReport).is_valid;
    }

    if (privacyModeTypeStr === 'differential-privacy') {
        // ★ 2026-10-05：容許浮點誤差，避免總預算平分後加總略超過上限（如 1.0000000000000002）被誤判未達標
        return !isDpBudgetExceeded((reportData as DpQualityReport).consumed_epsilon, budgetLimitEpsilonValue);
    }

    return true;
};

/**
 * 三攻擊風險分數：直接採用後端回傳值。
 * ★ 2026-10-14 修正：後端（app/engines/risk/formula.py 的 risk_score，三攻擊共用）回傳的
 *   singling_out_risk／linkability_risk／inference_risk 已是
 *     max(0, (S_ori − max(S_ctrl, S_base)) / (1 − max(S_ctrl, S_base)))
 *   ＝扣除控制組（ctrl_ratio 切出的 holdout）與亂猜基準後的最終風險，並取多輪平均。
 *   前端原本把它當成原始成功率，又以 1/樣本數 為基準再正規化一次（重複扣除，影響極小但邏輯錯誤），已移除。
 *   （依據：期中交付套件原始碼；v3 只有映像檔，待後端確認未改變。）
 * 沒有三攻擊報告（例如沒有敏感欄位而略過）時三項皆為 0，呼叫端不應把它當成「評估過且無風險」。
 */
export const computeSimulationMetrics = (attackReport: AttackReport | null): SimulationResult => {
    const singlingRiskValue = attackReport?.singling_out_risk ?? 0;
    const linkabilityRiskValue = attackReport?.linkability_risk ?? 0;
    const inferenceRiskValue = attackReport?.inference_risk ?? 0;
    const overallMaxRiskValue = Math.max(singlingRiskValue, linkabilityRiskValue, inferenceRiskValue);
    return {
        singling: { risk: singlingRiskValue },
        linkability: { risk: linkabilityRiskValue },
        inference: { risk: inferenceRiskValue },
        overallRiskPercent: (overallMaxRiskValue * 100).toFixed(1)
    };
};

/**
 * 輸入／刪除／輸出筆數：直接數原始 CSV 與去識別化 CSV 的資料列數（扣除表頭），
 * 不依賴各報表裡可能經過抽樣的統計欄位。讀不到去識別化結果時輸出筆數視同輸入筆數。
 */
export const computeDatasetRowStats = async (
    originalCsvBlob: Blob,
    processedCsvBlob: Blob | null
): Promise<DatasetRowStats> => {
    // ★ 2026-11-02（F12）：逐段計數（不把整份資料讀成字串），規則與 countCsvDataRowsForStats 相同
    const inputRowCountValue = await countCsvDataRowsInBlob(originalCsvBlob);
    let outputRowCountValue = inputRowCountValue;
    if (processedCsvBlob) {
        try {
            outputRowCountValue = await countCsvDataRowsInBlob(processedCsvBlob);
        } catch (rowCountErrorPayload) {
            console.error('計算輸出資料筆數失敗:', rowCountErrorPayload);
        }
    }
    return { input: inputRowCountValue, deleted: Math.max(0, inputRowCountValue - outputRowCountValue), output: outputRowCountValue };
};

/** 稽核紀錄內容；沒有三攻擊報告時風險欄位記「未評估」，不記成 0% 以免誤導 */
export const buildPipelineAuditLogEntry = (input: {
    certificateId: string;
    auditTime: string;
    auditTimestamp: number;
    fileName: string | null | undefined;
    privacyMode: string | null | undefined;
    operatorName: string | undefined;
    operatorRole: string | undefined;
    kValue: number;
    queryCount: number;
    hasAttackReport: boolean;
    simulationMetrics: SimulationResult;
    datasetRowStats: DatasetRowStats;
    isComplianceValid: boolean;
    columnNames: string[];
    resolveColumnRole: (columnName: string) => { role: string; maskStrategy?: string };
    dpEnabledFieldNames: string[];
    /** K-匿名間接識別欄位實際套用之泛化技術代碼（見 utils/kAnonymityTechLabel.ts）；未提供時不寫快照 */
    resolveQiGeneralizationTech?: (columnName: string) => string;
    /** ★ 2026-10-08：合規報告快照（見 utils/complianceReport.ts），Step4 報告與歷史紀錄調閱共用 */
    reportSnapshot?: ComplianceReportSnapshot;
}): Omit<AuditLogItem, 'id'> => {
    const columnRoleSnapshotDict = input.columnNames.reduce((accumulatorDict, columnNameString) => {
        accumulatorDict[columnNameString] = input.resolveColumnRole(columnNameString).role;
        return accumulatorDict;
    }, {} as Record<string, string>);

    const identifierMaskStrategySnapshotDict = input.columnNames.reduce((accumulatorDict, columnNameString) => {
        const { maskStrategy: resolvedMaskStrategyString } = input.resolveColumnRole(columnNameString);
        if (resolvedMaskStrategyString) accumulatorDict[columnNameString] = resolvedMaskStrategyString;
        return accumulatorDict;
    }, {} as Record<string, string>);

    // ★ 2026-10-05：記錄間接識別欄位實際套用的泛化技術，憑證對照表依此顯示（原本一律寫「區間/時間泛化」）
    const resolveQiGeneralizationTech = input.resolveQiGeneralizationTech;
    const qiGeneralizationTechSnapshotDict = input.privacyMode === 'k-anonymity' && resolveQiGeneralizationTech
        ? input.columnNames.reduce((accumulatorDict, columnNameString) => {
            if (columnRoleSnapshotDict[columnNameString] === 'Quasi-identifier') accumulatorDict[columnNameString] = resolveQiGeneralizationTech(columnNameString);
            return accumulatorDict;
        }, {} as Record<string, string>)
        : undefined;

    const formatRiskText = (riskValue: number): string => input.hasAttackReport ? `${(riskValue * 100).toFixed(1)}%` : '未評估';
    const overallRiskText = input.hasAttackReport ? `${input.simulationMetrics.overallRiskPercent}%` : '未評估';

    return {
        certificateId: input.certificateId,
        fileName: input.fileName || 'dataset.csv',
        privacyMode: input.privacyMode || 'k-anonymity',
        operator: input.operatorName || '', // ★ 2026-10-29：不再填假名稱；存後端時由後端以登入帳號覆寫
        operatorRole: input.operatorRole || 'admin',
        auditTime: input.auditTime,
        auditTimestamp: input.auditTimestamp,
        parameters: input.privacyMode === 'k-anonymity' ? `K = ${input.kValue}` : `發布次數 M = ${input.queryCount}`,
        // 與畫面顯示一致，記錄後端回傳的最終風險分數（已扣除控制組與亂猜基準）
        singlingRisk: formatRiskText(input.simulationMetrics.singling.risk),
        linkabilityRisk: formatRiskText(input.simulationMetrics.linkability.risk),
        inferenceRisk: formatRiskText(input.simulationMetrics.inference.risk),
        overallRisk: overallRiskText,
        inputRowCount: input.datasetRowStats.input,
        deletedRowCount: input.datasetRowStats.deleted,
        outputRowCount: input.datasetRowStats.output,
        // ★ 2026-11-06：納入風險評估——風險不通過＝failed、未評估＝unassessed（見 utils/complianceReport.ts）
        status: resolveAuditLogComplianceStatus({ status: input.isComplianceValid ? 'passed' : 'failed', overallRisk: overallRiskText, reportSnapshot: input.reportSnapshot }),
        columnsSnapshot: input.columnNames,
        columnRoleSnapshot: columnRoleSnapshotDict,
        identifierMaskStrategySnapshot: identifierMaskStrategySnapshotDict,
        dpEnabledFieldNamesSnapshot: input.dpEnabledFieldNames,
        ...(qiGeneralizationTechSnapshotDict ? { qiGeneralizationTechSnapshot: qiGeneralizationTechSnapshotDict } : {}),
        ...(input.reportSnapshot ? { reportSnapshot: input.reportSnapshot } : {})
    };
};
