/**
 * Step4 管線的去識別化階段：呼叫 K-匿名或差分隱私 API，取回品質報告與去識別化 CSV。
 * 2026-09-30 自 Step4_Result.tsx 的 runFullPipeline 抽出，行為不變；畫面狀態與 store 由呼叫端更新。
 */
import { runKAnonymity, runDifferentialPrivacy, MISSING_QUALITY_REPORT_MESSAGE, MISSING_BUDGET_REPORT_MESSAGE, type ApiRequestOptions, type KAnonymityQualityReport, type DpQualityReport } from '../../../api/apiService';
import { computeDpTotalBudgets, type DifferentialPrivacyConfigInput } from '../../../utils/pipelineConfig';

export interface DeidentificationPhaseResult {
    report: KAnonymityQualityReport | DpQualityReport;
    csvBlob: Blob | null;
    /** 差分隱私執行後的最新跨批次累計值（K-匿名為 null），呼叫端寫回 store */
    updatedDpAccumulated: { epsilon: number; delta: number } | null;
    /** 執行紀錄訊息（不含時間前綴） */
    logMessages: string[];
}

/** 後端回傳可能是 blob／data／csv 其中一種，統一轉成 Blob */
export const extractProcessedCsvBlob = (response: unknown): Blob | null => {
    const rawResponse = response as Record<string, unknown>;
    if (rawResponse.blob) return rawResponse.blob as Blob;
    if (rawResponse.data) return new Blob([rawResponse.data as BlobPart], { type: 'text/csv;charset=utf-8;' });
    if (rawResponse.csv) return new Blob([rawResponse.csv as BlobPart], { type: 'text/csv;charset=utf-8;' });
    return null;
};

/**
 * 執行去識別化。隱私模式不是 K-匿名或差分隱私時回傳 null（不呼叫 API）。
 * 差分隱私：成功後把最新累計 ε／δ 寫回 configObject.differential_privacy，
 * 讓後續風險評估／官方報告拿到的是「這次跑完之後」的累計值，而不是執行前的基準值。
 */
export const runDeidentificationPhase = async (input: {
    privacyMode: string | null | undefined;
    safeDataFile: File;
    configFile: File;
    configObject: Record<string, unknown>;
    dpConfigInput: DifferentialPrivacyConfigInput;
    requestOptions: ApiRequestOptions;
}): Promise<DeidentificationPhaseResult | null> => {
    if (input.privacyMode === 'k-anonymity') {
        // 所有參數都在 configFile 的 k_anonymity 區塊內（後端 v3 不收表單參數）
        const response = await runKAnonymity(input.safeDataFile, input.configFile, input.requestOptions);
        if (!response.success) throw (response.error || new Error('API 請求未成功'));

        // ★ 2026-11-02：後端沒回品質報告時視為失敗（先前捏造 is_valid:true 的預設報告，畫面會顯示合規並寫入合規紀錄）
        if (!response.report) throw new Error(MISSING_QUALITY_REPORT_MESSAGE);
        const finalReport = response.report;
        return {
            report: finalReport,
            csvBlob: extractProcessedCsvBlob(response),
            updatedDpAccumulated: null,
            logMessages: ['✅ K-Anonymity API 處理成功！']
        };
    }

    if (input.privacyMode === 'differential-privacy') {
        // 逐欄 ε／δ 與跨批次累計基準皆在 configFile 的 differential_privacy 區塊內（後端 v3 不收表單參數）
        const { totalEpsilonBudget, totalDeltaBudget } = computeDpTotalBudgets(input.dpConfigInput.dpFields, input.dpConfigInput.targetDelta);

        const response = await runDifferentialPrivacy(input.safeDataFile, input.configFile, input.requestOptions);
        if (!response.success) throw (response.error || new Error('DP API 請求未成功'));

        // ★ 2026-11-02：後端沒回預算報告時視為失敗，不再以前端推算的 ε／δ 捏造報告（也不改寫累計值）
        if (!response.report) throw new Error(MISSING_BUDGET_REPORT_MESSAGE);
        const finalReport = response.report;
        const accumulatedEpsilonBase = input.dpConfigInput.accumulatedEpsilon ?? 0;
        const accumulatedDeltaBase = input.dpConfigInput.accumulatedDelta ?? 0;

        // 後端有回傳累計值即以後端為準（由後端負責組合定理運算），否則（報告缺累計欄位）以「累計基準 + 本次消耗」推算
        const updatedDpAccumulated = {
            epsilon: finalReport.accumulated_epsilon ?? (accumulatedEpsilonBase + totalEpsilonBudget),
            delta: finalReport.accumulated_delta ?? (accumulatedDeltaBase + totalDeltaBudget)
        };
        const dpConfigBlockForRiskReuse = input.configObject.differential_privacy;
        if (dpConfigBlockForRiskReuse && typeof dpConfigBlockForRiskReuse === 'object') {
            (dpConfigBlockForRiskReuse as Record<string, unknown>).accumulated_epsilon = updatedDpAccumulated.epsilon;
            (dpConfigBlockForRiskReuse as Record<string, unknown>).accumulated_delta = updatedDpAccumulated.delta;
        }

        return {
            report: finalReport,
            csvBlob: extractProcessedCsvBlob(response),
            updatedDpAccumulated,
            logMessages: ['✅ DP API 處理成功！噪聲已注入。', `📊 消耗隱私預算 (Epsilon): ${finalReport.consumed_epsilon}`]
        };
    }

    return null;
};
