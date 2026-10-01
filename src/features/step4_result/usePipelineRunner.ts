/**
 * Step4 管線執行 hook：擁有去識別化／風險評估結果與執行進度等 state，負責依序執行
 * ① 去識別化 → ② 風險評估（三攻擊＋CAP）→ ③ 結果統計與稽核紀錄，並在參數改變時自動重新執行。
 * 2026-09-30 自 Step4_Result.tsx 抽出；各 state 的完整修正脈絡見宣告處 ★ 註解。
 */
import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { App as AntdApp } from 'antd';
import Papa from 'papaparse';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/useAuthStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useAuditStore } from '../../store/useAuditStore';
import { ensureDatasetProfile } from '../../utils/datasetProfile';
import type { HighCardinalitySensitiveInfo } from '../../utils/riskAssessment';
import { buildKAnonymityConfig, buildDifferentialPrivacyConfig, wrapBackendConfigDocument, type DpStoreField, type KAnonymityPipelineSettings, type DifferentialPrivacyConfigInput } from '../../utils/pipelineConfig';
import { isApiRequestCanceled, isApiRequestTimeout, DEFAULT_API_TIMEOUT_MS, type ApiRequestOptions, type KAnonymityQualityReport, type DpQualityReport, type AttackReport, type CapReport } from '../../api/apiService';
import { describePipelineError } from './backendErrorCatalog';
import { runDeidentificationPhase } from './pipeline/deidentificationPhase';
import { runRiskAssessmentPhase } from './pipeline/riskAssessmentPhase';
import { computeDatasetRowStats, computeSimulationMetrics, evaluateComplianceValidity, buildPipelineAuditLogEntry, type SimulationResult, type PipelinePhase, type DatasetRowStats } from './pipeline/pipelineResults';

/** 運算完成後延遲關閉「運算中」狀態，讓進度條停在 100% 一下 */
const SIMULATION_COMPLETION_DELAY_MS = 600;

export interface PipelineRunnerInput {
    /** 實際處理的欄位名稱（已去除 BOM） */
    actualProcessedColumnsList: string[];
    /** 畫面判定的欄位角色（與結果頁標籤一致） */
    getCalculatedRole: (columnName: string) => { role: string; maskStrategy?: string };
}

export const usePipelineRunner = ({ actualProcessedColumnsList, getCalculatedRole }: PipelineRunnerInput) =>
{
    const { t: translate } = useTranslation();
    const { message: messageApi } = AntdApp.useApp();

    const currentUserSession = useAuthStore((state) => state.user);
    const addAuditLogAction = useAuditStore((state) => state.addAuditLog);

    const dataFile = useWorkspaceStore((state: unknown) => (state as { dataFile: File | null }).dataFile);

    const currentPrivacyModeTypeStr = useWorkspaceStore((state) => state.privacyMode);
    const currentKValueNumber = useWorkspaceStore((state) => state.kValue);
    const currentLValueNumber = useWorkspaceStore((state) => state.lValue);
    const currentTValueNumber = useWorkspaceStore((state) => state.tValue);
    // ★ 使用者反映：純 K-匿名模式不一定需要 l-多樣性／t-緊密度檢測，若未於 Step3 開啟對應開關，
    //   組裝設定檔時不應送出 l／t 欄位——依交付文件之後端行為，設定檔未提供 l/t 即不執行該項檢測。
    const isEnableLDiversityStatus = useWorkspaceStore((state) => state.enableLDiversity);
    const isEnableTClosenessStatus = useWorkspaceStore((state) => state.enableTCloseness);
    const currentMaxSuppressionNumber = useWorkspaceStore((state) => state.maxSuppression);
    const currentSuppressionMethodStr = useWorkspaceStore((state) => state.suppressionMethod);
    // ★ 使用者反映（2026-09-23）：cell_fill（值抑制填法 star／missing）僅在抑制方式為「值抑制」
    //   時才有作用，先前前端從未讀取／送出這個值，後端只能默默套用內建預設 (star)。這裡讀取 Step3
    //   新增的選單狀態，並在下方組裝 K-匿名 apiOptions／configObject 時，僅於「值抑制」模式才送出。
    const currentCellFillMethodStr = useWorkspaceStore((state) => state.cellFillMethod);
    const cellFillValuesByColumnMap = useWorkspaceStore((state) => state.cellFillValuesByColumn);
    const currentLimitExceededActionStr = useWorkspaceStore((state) => state.limitExceededAction);
    const budgetLimitEpsilonValue = useWorkspaceStore((state) => state.budgetLimitEpsilon);
    const globalTargetDeltaValue = useWorkspaceStore((state) => state.targetDelta);
    // ★ 使用者反映：config_dp.json 之 accumulated_epsilon／accumulated_delta 為「跨批次累計」值，
    //   先前每次執行皆固定送出 0，等同從未真正累計。此處讀取上次執行後留存之累計值作為本次執行前基準，
    //   執行成功後再依本次消耗更新（見下方 dpAccumulatedEpsilon／dpAccumulatedDelta 更新邏輯）。
    const dpAccumulatedEpsilonValue = useWorkspaceStore((state) => state.dpAccumulatedEpsilon);
    const dpAccumulatedDeltaValue = useWorkspaceStore((state) => state.dpAccumulatedDelta);

    const currentDpFieldsListArray = useWorkspaceStore((state) => state.dpFields);
    const columnPrivacyRolesMapDict = useWorkspaceStore((state) => state.columnRoles);
    const riskSubgroupFiltersMapDict = useWorkspaceStore((state) => state.riskSubgroupFilters); // ★ 新增：風險評估「對象族群限定條件」
    
    const rawColumnTypesMapDict = useWorkspaceStore((state) => state.columnTypes);
    const currentColumnTypesMapDict = useMemo(() => rawColumnTypesMapDict || {}, [rawColumnTypesMapDict]);

    const currentPreprocessingRulesMapDict = useWorkspaceStore((state) => state.preprocessingRules);
    const currentDatasetFileNameString = useWorkspaceStore((state) => state.fileName);
    const simulatedQueryCountValue = useWorkspaceStore((state) => state.queryCount);

    const step4AnalysisCacheData = useWorkspaceStore((state) => state.step4Cache);
    const lastRunParametersHashString = useWorkspaceStore((state) => state.lastRunParamsHash);
    const setStep4CacheAction = useWorkspaceStore((state) => state.setStep4Cache);

    const rawKAnonymityFields = useWorkspaceStore((state: unknown) => (state as { kAnonymityFields?: Record<string, unknown>[] }).kAnonymityFields);
    const kAnonymityFieldsList = useMemo(() => rawKAnonymityFields || [], [rawKAnonymityFields]);

    const rawKAnonymityHierarchies = useWorkspaceStore((state: unknown) => (state as { kAnonymityHierarchies?: Record<string, unknown>[] }).kAnonymityHierarchies);
    const kAnonymityHierarchiesList = useMemo(() => rawKAnonymityHierarchies || [], [rawKAnonymityHierarchies]);


    const currentParametersHashString = useMemo(
        () => JSON.stringify({
            privacyMode: currentPrivacyModeTypeStr, 
            kValue: currentKValueNumber,
            lValue: currentLValueNumber,
            tValue: currentTValueNumber,
            enableLDiversity: isEnableLDiversityStatus,
            enableTCloseness: isEnableTClosenessStatus,
            maxSuppression: currentMaxSuppressionNumber,
            suppressionMethod: currentSuppressionMethodStr,
            limitExceededAction: currentLimitExceededActionStr,
            queryCount: simulatedQueryCountValue,
            dpFields: currentDpFieldsListArray,
            columnRoles: columnPrivacyRolesMapDict,
            columnTypes: currentColumnTypesMapDict,
            preprocessingRules: currentPreprocessingRulesMapDict,
            kAnonymityFields: kAnonymityFieldsList,
            kAnonymityHierarchies: kAnonymityHierarchiesList,
            // ★ 2026-10-01（第 16 項）：以下四項都會送給後端、影響結果，先前卻沒有納入雜湊——快取有效時改了
            //   不會重新運算、畫面繼續顯示舊結果；快取無效時則只靠 runFullPipeline 參考值改變間接觸發。
            //   自動執行改為只看這個雜湊後，必須一併納入。（DP 累計 ε／δ 是執行結果，刻意不納入。）
            cellFillMethod: currentCellFillMethodStr,
            cellFillValuesByColumn: cellFillValuesByColumnMap,
            riskSubgroupFilters: riskSubgroupFiltersMapDict,
            targetDelta: globalTargetDeltaValue,
            // 換上傳檔案時 step4Cache 不會被清空，欄位設定又相同時會誤用上一份資料的結果
            datasetFileKey: dataFile ? `${dataFile.name}|${dataFile.size}|${dataFile.lastModified}` : null
        }),
        [
            currentPrivacyModeTypeStr, currentKValueNumber, currentLValueNumber, currentTValueNumber,
            isEnableLDiversityStatus, isEnableTClosenessStatus, currentMaxSuppressionNumber,
            currentSuppressionMethodStr, currentLimitExceededActionStr, simulatedQueryCountValue,
            currentDpFieldsListArray, columnPrivacyRolesMapDict, currentColumnTypesMapDict, currentPreprocessingRulesMapDict,
            kAnonymityFieldsList, kAnonymityHierarchiesList,
            currentCellFillMethodStr, cellFillValuesByColumnMap, riskSubgroupFiltersMapDict, globalTargetDeltaValue, dataFile
        ]
    );

    const isAnalysisCacheValidStatus = useMemo(
        () => step4AnalysisCacheData !== null && lastRunParametersHashString === currentParametersHashString, 
        [step4AnalysisCacheData, lastRunParametersHashString, currentParametersHashString]
    );

    const [apiReport, setApiReport] = useState<KAnonymityQualityReport | DpQualityReport | null>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData?.apiReport ? (step4AnalysisCacheData.apiReport as KAnonymityQualityReport | DpQualityReport) : null
    );

    // 後端管線本次執行是否真正失敗（例如 422 抑制率超限），用來避免
    // 在執行失敗時仍顯示「運算完成」的成功／警告橫幅
    const [pipelineFailedMessage, setPipelineFailedMessage] = useState<ReactNode | null>(null);

    const [processedCsvBlob, setProcessedCsvBlob] = useState<Blob | null>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData 
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).processedCsvBlob as Blob | null) || null 
            : null
    );

    // 風險評估（三攻擊 + CAP）真實 API 回傳結果
    const [attackReportData, setAttackReportData] = useState<AttackReport | null>(null);
    // ★ CAP 前後對比現在是安全性評估卡片的主要顯示內容，若不隨快照還原，重新整理／切回本頁
    // 時（命中快取）畫面上會整個看不到，故比照 attackSimulationMetricsData 一併存讀快照。
    const [capReportData, setCapReportData] = useState<CapReport | null>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).capReport as CapReport | null) || null
            : null
    );
    // ★ 新增：輸入／刪除／輸出筆數統計快照，同樣需要隨命中快取還原，避免重新整理後消失。
    const [datasetRowStatsData, setDatasetRowStatsData] = useState<DatasetRowStats | null>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).datasetRowStats as DatasetRowStats | null) || null
            : null
    );

    // ★ 使用者反映（2026-09-22）：K-匿名模式同時把「薪資」(數值型) 與「疾病」(字串型) 都設為
    //   敏感欄位、輪流執行三攻擊／CAP 時，後端服務直接當機。使用者提供的後端終端機訊息顯示
    //   sklearn 印出「the number of unique classes is greater than 50% of the number of
    //   samples...」警告後容器隨即結束——代表三攻擊／CAP 底層引擎把「敏感欄位」的實際值
    //   直接丟給 sklearn 分類器當 y 標籤，該欄位的值若幾乎每筆都不同（不論數值型連續數字，
    //   或字串型自由文字，使用者兩者皆已實測會觸發），會讓 sklearn 內部（很可能是分層抽樣
    //   要求每類別至少 2 筆樣本）丟出未接住的例外，直接讓後端容器當掉。這是後端引擎本身的
    //   限制、不是前端設定檔問題，故無法從前端修正根本原因；改為在送出請求前，依「實際資料
    //   的唯一值佔比」（而非欄位型別，因為型別無法可靠預測是否會觸發）偵測每個候選敏感欄位，
    //   偵測到高風險欄位時預設略過（僅顯示警告，不影響去識別化結果本身），並提供下方「仍要
    //   強制執行」勾選框，讓使用者在明確知情風險的前提下自行選擇是否仍要送出。
    // ★ 修正：MainLayout 以 currentStepIndexValue 當 key，切到其他步驟再切回 Step4 會讓本
    //   元件整個重新掛載；命中快取（isAnalysisCacheValidStatus）時 runFullPipeline 會直接
    //   略過整段風險評估（含這裡的高唯一值比例偵測），若這兩個 state 不比照 capReportData／
    //   datasetRowStatsData 一併從快照還原，重新掛載後風險數字雖然正確恢復，解釋「為什麼略過
    //   ／為什麼被強制執行」的警告與勾選狀態卻會憑空消失，讓使用者誤以為是完整評估結果。
    const [highCardinalitySensitiveWarningInfo, setHighCardinalitySensitiveWarningInfo] = useState<HighCardinalitySensitiveInfo[]>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).highCardinalitySensitiveWarningInfo as HighCardinalitySensitiveInfo[] | undefined) || []
            : []
    );
    const [forceRunHighCardinalitySensitiveFieldsStatus, setForceRunHighCardinalitySensitiveFieldsStatus] = useState<boolean>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? Boolean((step4AnalysisCacheData as unknown as Record<string, unknown>).forceRunHighCardinalitySensitiveFields)
            : false
    );
    // ★ 後端工程師回覆（2026-09-29）：sklearn 警告只來自三攻擊中的「推斷性攻擊」——它以準識別欄位為
    //   特徵、敏感欄位為目標建立「分類」模型，並以預測值與真實值完全相等判定攻擊成功，故敏感欄位
    //   必須是可列舉的類別型欄位。薪資這類連續數值的相異值數接近資料筆數，等於每個數值各自一類，
    //   結果不具評估意義，運算量也隨相異值數暴增而跑不完。後端建議把連續數值先分組為級距（例如
    //   每 5 萬一級）再當敏感欄位。故前端改為：高唯一值比例且「幾乎全為數值」的敏感欄位，送風險
    //   評估前自動轉換為級距標籤（僅套用在送給 /risk/* 的資料副本，去識別化結果本身不受影響）；
    //   級距寬度預設自動取整（約分 10 級），使用者可在警告區塊逐欄自訂，此 state 存自訂值。
    const [sensitiveBinWidthOverridesMap, setSensitiveBinWidthOverridesMap] = useState<Record<string, number>>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).sensitiveBinWidthOverrides as Record<string, number> | undefined) || {}
            : {}
    );

    const [realMaskedDataRows, setRealMaskedDataRows] = useState<Record<string, unknown>[]>([]);
    // ★ 使用者反映：曾出現「安全性評估／效用評估」已有真實數字，但下方「結果預覽對照」
    //   卻顯示「無此資料」的不一致畫面。經追查，本檔案內有另一個 useEffect（下方
    //   「debounce 觸發」邏輯）會在 runFullPipeline 這個 useCallback 參考值改變時
    //   自動重新呼叫一次；而 runFullPipeline 的相依陣列包含 isAnalysisCacheValidStatus，
    //   該值會在本次執行「快完成」時（setStep4CacheAction 寫入快取後）翻轉，導致
    //   runFullPipeline 參考值改變、觸發效果重新執行。雖然目前程式碼在快取生效後
    //   會擋下「再次真正發送 API 請求」，但為避免萬一其他相依值也在執行期間意外
    //   改變參考值而造成同一輪管線被重複觸發（例如 CSV 解析中途又被另一輪重置
    //   清空），這裡加一個「執行中旗標」，確保同一時間只會有一輪 runFullPipeline
    //   在真正執行，杜絕任何重疊執行造成的狀態互相覆蓋。
    //   （2026-10-01 起自動執行改為只看參數雜湊、不再跟著 runFullPipeline 參考值觸發，見檔案末段自動執行
    //   effect；此旗標仍保留，防止手動「重新運算」與自動執行重疊。）
    const isPipelineRunInProgressRef = useRef(false);
    // ★ 2026-10-01（第 16 項）：最近一次「真正開始執行」時的參數雜湊，以及每輪結束時遞增的計數，
    //   供下方自動執行 effect 判斷「這組參數是否已經跑過」與「執行中被擋下的參數變更要不要補跑」。
    const lastAttemptedParamsHashRef = useRef<string | null>(null);
    const [pipelineRunGeneration, setPipelineRunGeneration] = useState(0);
    // ★ 2026-09-30：API 請求可取消、可看上傳進度。每一輪 runFullPipeline 建立一個 AbortController，
    //   畫面上的「取消運算」按鈕呼叫 abort()，這一輪之後所有進行中的請求都會立即中斷。
    const pipelineAbortControllerRef = useRef<AbortController | null>(null);
    const [uploadProgressText, setUploadProgressText] = useState<string | null>(null);
    const [isPipelineCanceledStatus, setIsPipelineCanceledStatus] = useState<boolean>(false);
    const handleCancelPipeline = useCallback(() => {
        pipelineAbortControllerRef.current?.abort();
    }, []);
    // ★ 新增：若 processedCsvBlob 明明有內容（bytes > 0），但解析出來的資料列數卻是 0，
    //   代表後端回傳的 CSV 內容本身可能有非預期格式（例如編碼、分隔符號等問題）。
    //   過去這種情況畫面上只會安靜地顯示「無此資料」，使用者與工程師都無從得知
    //   原因。這裡記錄下診斷資訊，若真的發生就直接顯示在畫面上，不用再另外開
    //   F12 開發者工具才找得到。
    const [previewParseDiagnosticText, setPreviewParseDiagnosticText] = useState<string | null>(null);


    
    const [isPipelineCalculatingStatus, setIsPipelineCalculatingStatus] = useState<boolean>(!isAnalysisCacheValidStatus);
    const [currentPipelinePhaseType, setCurrentPipelinePhaseType] = useState<PipelinePhase>(isAnalysisCacheValidStatus ? 'completed' : 'uploading');
    const [calculationProgressValue, setCalculationProgressValue] = useState<number>(isAnalysisCacheValidStatus ? 100 : 0);
    const [systemSimulationLogsList, setSystemSimulationLogsList] = useState<string[]>([]);
    const [attackSimulationMetricsData, setAttackSimulationMetricsData] = useState<SimulationResult | null>(isAnalysisCacheValidStatus ? step4AnalysisCacheData!.metrics : null);
    const [auditMetadataObject, setAuditMetadataObject] = useState(        () => ({
            certificateId: isAnalysisCacheValidStatus ? step4AnalysisCacheData!.certificateId : `PAC-${Date.now()}`,
            auditTime: isAnalysisCacheValidStatus ? step4AnalysisCacheData!.auditTime : new Date().toLocaleString()
        })
    );

    useEffect(() => {
        let isMounted = true;

        if (processedCsvBlob) {
            const processedBlobByteSizeValue = processedCsvBlob.size;

            // ★ 2026-09-30：預覽只需要前 10 筆，改為直接以串流方式解析 Blob（preview: 10 讀到就停），
            //   不再先把整份去識別化結果（100 萬筆時近 100 MB）整個讀成字串。欄位名稱開頭的
            //   UTF-8 BOM／零寬字元以 transformHeader 去除，與上傳原始檔時的清理方式一致，
            //   避免第一個欄位標頭對不上 actualProcessedColumnsList。
            // 包成 File（不複製內容）才符合 PapaParse 的串流讀檔型別
            Papa.parse<Record<string, unknown>>(new File([processedCsvBlob], 'processed_preview.csv', { type: 'text/csv' }), {
                header: true,
                skipEmptyLines: true,
                preview: 10,
                transformHeader: (rawHeaderName: string) => rawHeaderName.replace(/^[\uFEFF\u200B]+/, ''),
                complete: (results) => {
                    if (!isMounted) return;

                    setRealMaskedDataRows(results.data as Record<string, unknown>[]);

                    // ★ 診斷：後端明明回傳了有內容的檔案（bytes > 0），但解析出來的資料列數卻是 0，
                    //   代表 CSV 內容本身可能有非預期格式（例如編碼、分隔符號問題），而不是「後端真的
                    //   沒有輸出資料」。只在這種情況才讀取檔案開頭一小段內容供診斷顯示。
                    if (results.data.length === 0 && processedBlobByteSizeValue > 0) {
                        processedCsvBlob.slice(0, 4096).text().then((headSnippetText) => {
                            if (!isMounted) return;
                            const cleanedHeadSnippetText = headSnippetText.replace(/^[\uFEFF\u200B]+/, '');
                            if (cleanedHeadSnippetText.trim().length === 0) { setPreviewParseDiagnosticText(null); return; }
                            const diagnosticDetailText =
                                `後端回傳檔案大小：${processedBlobByteSizeValue} bytes；` +
                                `解析錯誤數：${results.errors.length}` +
                                (results.errors.length > 0 ? `（第一筆：${JSON.stringify(results.errors[0])}）` : '') +
                                `；內容開頭前 200 字：${cleanedHeadSnippetText.slice(0, 200)}`;
                            console.error('⚠️ 結果預覽對照：後端有回傳資料，但解析後資料列數為 0。', diagnosticDetailText);
                            setPreviewParseDiagnosticText(diagnosticDetailText);
                        }).catch(() => undefined);
                    } else {
                        setPreviewParseDiagnosticText(null);
                    }
                },
                error: (error: Error) => {
                    console.error('Error parsing processed CSV blob:', error);
                    if (isMounted) {
                        setPreviewParseDiagnosticText(`CSV 解析發生例外：${error.message}`);
                    }
                }
            });
        }
        // ★ processedCsvBlob 變成 null 時（例如下一輪 runFullPipeline 剛重置狀態）
        //   不在這裡同步呼叫 setState 清空診斷訊息，避免在 Effect 內串連觸發額外
        //   重新渲染；改為和 setRealMaskedDataRows([]) 一起，於 runFullPipeline
        //   重置階段（一般函式呼叫情境，非 Effect 內）就地清空即可。

        return () => {
            isMounted = false;
        };
    }, [processedCsvBlob]);

    const runFullPipeline = useCallback(
        async (isForceRunTriggered: boolean = false) => 
        {
            if (!isForceRunTriggered && isAnalysisCacheValidStatus) return;

            // ★ 防止同一輪管線被重複觸發（例如下方 debounce 觸發用的 useEffect，
            //   在 isAnalysisCacheValidStatus 於執行「快完成」時翻轉，導致
            //   runFullPipeline 參考值改變而又被呼叫一次）：若已有一輪正在執行，
            //   直接忽略這次呼叫，避免兩輪執行同時寫入 processedCsvBlob／
            //   realMaskedDataRows 等狀態，造成畫面上「部分區塊有資料、部分沒有」
            //   的不一致結果。
            if (isPipelineRunInProgressRef.current) {
                console.warn('⚠️ runFullPipeline 偵測到已有一輪執行中，略過本次重複呼叫。');
                return;
            }
            isPipelineRunInProgressRef.current = true;
            lastAttemptedParamsHashRef.current = currentParametersHashString;

            if (!dataFile) {
                messageApi.error(translate('step4.msg.no_file', '找不到原始資料集，請先回到 Step 1 上傳檔案！'));
                isPipelineRunInProgressRef.current = false;
                return;
            }

            setIsPipelineCalculatingStatus(true);
            setCalculationProgressValue(0);
            setCurrentPipelinePhaseType('uploading');

            const pipelineAbortController = new AbortController();
            pipelineAbortControllerRef.current = pipelineAbortController;
            setUploadProgressText(null);
            setIsPipelineCanceledStatus(false);
            // 上傳進度每變化 1% 才更新一次畫面，避免大檔案上傳時觸發大量重新渲染
            let lastReportedUploadPercentNumber = -1;
            const pipelineRequestOptions: ApiRequestOptions = {
                signal: pipelineAbortController.signal,
                onUploadProgress: (loadedBytes, totalBytes) => {
                    const toMegabytesText = (byteCount: number) => (byteCount / 1024 / 1024).toFixed(1);
                    if (!totalBytes) { setUploadProgressText(`已上傳 ${toMegabytesText(loadedBytes)} MB`); return; }
                    const uploadPercentNumber = Math.floor((loadedBytes / totalBytes) * 100);
                    if (uploadPercentNumber === lastReportedUploadPercentNumber) return;
                    lastReportedUploadPercentNumber = uploadPercentNumber;
                    setUploadProgressText(uploadPercentNumber >= 100
                        ? `已上傳 ${toMegabytesText(totalBytes)} MB，等待後端回應…`
                        : `上傳中 ${toMegabytesText(loadedBytes)} / ${toMegabytesText(totalBytes)} MB（${uploadPercentNumber}%）`);
                }
            };
            setApiReport(null);
            setProcessedCsvBlob(null);
            setRealMaskedDataRows([]);
            setPreviewParseDiagnosticText(null);
            setPipelineFailedMessage(null);
            // ★ 修正：高唯一值比例敏感欄位警告只會在下方 K-匿名分支重新計算並寫入；若使用者從
            //   「K-匿名（曾觸發警告）」切到差分隱私模式再執行，DP 分支不會呼叫
            //   setHighCardinalitySensitiveWarningInfo，state 會殘留上一輪 K-匿名的舊警告，讓
            //   畫面在 DP 模式下顯示不相關的欄位警告。每次開始新的一輪執行時先清空，K-匿名分支
            //   若偵測到高風險欄位會再重新設定為本次結果。
            setHighCardinalitySensitiveWarningInfo([]);

            const currentExecutionDateTimeObj = new Date();
            const generatedNewAuditMetadataObj = {
                certificateId: `PAC-${currentExecutionDateTimeObj.getTime()}`,
                auditTime: currentExecutionDateTimeObj.toLocaleString(),
                auditTimestamp: currentExecutionDateTimeObj.getTime()
            };
            setAuditMetadataObject(generatedNewAuditMetadataObj);
            const formatCurrentTimeForLogString = () => new Date().toLocaleTimeString();

            setSystemSimulationLogsList([
                translate('step4.log.connect', '[{{time}}] 建立與後端 API 伺服器之連線...', { time: formatCurrentTimeForLogString() }),
                translate('step4.log.bind', '[{{time}}] 準備動態組裝設定檔與參數', { time: formatCurrentTimeForLogString() })
            ]);

            try {
                await new Promise(resolve => setTimeout(resolve, 800));
                setCalculationProgressValue(30);
                setCurrentPipelinePhaseType('processing');
                setSystemSimulationLogsList(prev => [...prev, translate('step4.log.generate_config', '[{{time}}] ⚙️ 產生 JSON 設定檔 (Config) 並請求 Docker 後端...', { time: formatCurrentTimeForLogString() })]);

                let configObject: Record<string, unknown> = {};
                // K-匿名與差分隱私的設定檔／表單參數組裝邏輯見 utils/pipelineConfig.ts
                const kAnonymityPipelineSettings: KAnonymityPipelineSettings = {
                    kValue: currentKValueNumber,
                    lValue: currentLValueNumber,
                    tValue: currentTValueNumber,
                    enableLDiversity: isEnableLDiversityStatus,
                    enableTCloseness: isEnableTClosenessStatus,
                    maxSuppression: currentMaxSuppressionNumber,
                    suppressionMethod: currentSuppressionMethodStr,
                    cellFillMethod: currentCellFillMethodStr,
                    cellFillValuesByColumn: cellFillValuesByColumnMap,
                    limitExceededAction: currentLimitExceededActionStr
                };
                const dpPipelineConfigInput: DifferentialPrivacyConfigInput = {
                    dpFields: currentDpFieldsListArray,
                    columnTypes: currentColumnTypesMapDict,
                    accumulatedEpsilon: dpAccumulatedEpsilonValue,
                    accumulatedDelta: dpAccumulatedDeltaValue,
                    targetDelta: globalTargetDeltaValue
                };
                let finalApiReportData: KAnonymityQualityReport | DpQualityReport | null = null; 
                let finalCsvBlobData: Blob | null = null; 

                // 外層補上 version／dataset／input_format，與後端範例 config_*.json 完全同格式（2026-10-01）
                if (currentPrivacyModeTypeStr === 'k-anonymity') {
                    configObject = wrapBackendConfigDocument(currentDatasetFileNameString, buildKAnonymityConfig({
                        ...kAnonymityPipelineSettings,
                        processedColumnNames: actualProcessedColumnsList,
                        kAnonymityFields: kAnonymityFieldsList,
                        kAnonymityHierarchies: kAnonymityHierarchiesList,
                        resolveFallbackUiRole: (cleanColumnName) => getCalculatedRole(cleanColumnName).role
                    }));
                } else if (currentPrivacyModeTypeStr === 'differential-privacy') {
                    configObject = wrapBackendConfigDocument(currentDatasetFileNameString, buildDifferentialPrivacyConfig(dpPipelineConfigInput));
                }

                console.log(`🔥 傳給後端 (${currentPrivacyModeTypeStr}) 的 JSON Config:`, configObject);

                const jsonString = JSON.stringify(configObject);
                const configBlob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
                const configFile = new File([configBlob], 'config.json', { type: 'application/json' });

                const originalFile = dataFile as File;
                const rawCsvText = await originalFile.text();
                const cleanedCsvText = rawCsvText.replace(/^[\uFEFF\u200B]+/, '');

                const safeDataFile = new File(
                    [cleanedCsvText],
                    'input_dataset.csv',
                    { type: 'text/csv;charset=utf-8' }
                );
                // 去識別化結果（可達上百 MB）的文字內容只讀一次，CAP 分級距與輸出筆數統計共用
                let processedCsvTextPromise: Promise<string> | null = null;
                const readProcessedCsvTextOnce = (): Promise<string> => {
                    if (!processedCsvTextPromise) processedCsvTextPromise = finalCsvBlobData ? finalCsvBlobData.text() : Promise.resolve('');
                    return processedCsvTextPromise;
                };

                // ★ 2026-09-30：不再把整份原始 CSV 另外 Papa.parse 成列物件陣列（100 萬筆時非常吃記憶體），
                //   改用 utils/datasetProfile.ts 整份資料集只掃描一次的欄位統計快照（Step2／Step3 通常已掃描過，
                //   這裡直接取用）。相異值數被截斷的極高基數欄位，佔比一律視為 1（保守判定為高唯一值）。
                const datasetProfileForRisk = await ensureDatasetProfile(originalFile);

                const appendPipelineLog = (messageText: string) => setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ${messageText}`]);

                // ① 去識別化（K-匿名或差分隱私），見 pipeline/deidentificationPhase.ts
                const deidentificationResult = await runDeidentificationPhase({
                    privacyMode: currentPrivacyModeTypeStr,
                    safeDataFile,
                    configFile,
                    configObject,
                    dpConfigInput: dpPipelineConfigInput,
                    requestOptions: pipelineRequestOptions
                });
                if (deidentificationResult) {
                    // 差分隱私：跨批次累計 ε／δ 寫回 store，下次執行以此為基準
                    if (deidentificationResult.updatedDpAccumulated) {
                        useWorkspaceStore.setState({
                            dpAccumulatedEpsilon: deidentificationResult.updatedDpAccumulated.epsilon,
                            dpAccumulatedDelta: deidentificationResult.updatedDpAccumulated.delta
                        });
                    }
                    setApiReport(deidentificationResult.report);
                    finalApiReportData = deidentificationResult.report;
                    finalCsvBlobData = deidentificationResult.csvBlob;
                    setProcessedCsvBlob(finalCsvBlobData);
                    deidentificationResult.logMessages.forEach(appendPipelineLog);
                }

                setCalculationProgressValue(65);
                setCurrentPipelinePhaseType('auditing');
                setSystemSimulationLogsList(prev => [...prev, translate('step4.log.start_risk', '[{{time}}] 🚀 脫敏完成，啟動真實風險評估（三大攻擊模擬）', { time: formatCurrentTimeForLogString() })]);

                // ② 風險評估（三攻擊＋CAP），見 pipeline/riskAssessmentPhase.ts
                const riskAssessmentResult = await runRiskAssessmentPhase({
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
                });
                const attackReportResult = riskAssessmentResult.attackReport;

                // ③ 結果：筆數統計、風險分數、合規判斷，寫入快取快照與稽核紀錄（見 pipeline/pipelineResults.ts）
                const generatedDatasetRowStatsObject = await computeDatasetRowStats(cleanedCsvText, finalCsvBlobData ? readProcessedCsvTextOnce : null);
                setDatasetRowStatsData(generatedDatasetRowStatsObject);

                setCalculationProgressValue(100);
                setCurrentPipelinePhaseType('completed');

                const generatedSimulationMetricsObject = computeSimulationMetrics(attackReportResult);
                // 沒有三攻擊報告（例如沒有敏感欄位而略過）時維持 null，讓「安全性評估」卡片隱藏，
                // 與 CAP 略過時的呈現一致，不顯示成「已評估、風險 0%」。
                setAttackSimulationMetricsData(attackReportResult ? generatedSimulationMetricsObject : null);

                // 依後端實際回傳之報告判斷是否真正達到合規標準，而非一律標示為「已通過」
                const pipelineComplianceValidStatus = evaluateComplianceValidity(currentPrivacyModeTypeStr, finalApiReportData, budgetLimitEpsilonValue);

                setStep4CacheAction(
                    {
                        metrics: attackReportResult ? generatedSimulationMetricsObject : null,
                        certificateId: generatedNewAuditMetadataObj.certificateId,
                        auditTime: generatedNewAuditMetadataObj.auditTime,
                        apiReport: finalApiReportData,
                        processedCsvBlob: finalCsvBlobData,
                        capReport: riskAssessmentResult.capReport,
                        datasetRowStats: generatedDatasetRowStatsObject,
                        // ★ 一併存讀高唯一值比例敏感欄位警告快照，避免切換步驟重新掛載後消失
                        // （見上方 highCardinalitySensitiveWarningInfo state 宣告處的完整說明）。
                        // 這裡讀取的是本次執行過程中賦值的 finalHighCardinalitySensitiveWarningInfo
                        // 一般變數，而非 state 本身（state 在同一次 render 閉包內不會同步更新）。
                        highCardinalitySensitiveWarningInfo: riskAssessmentResult.highCardinalityInfo,
                        forceRunHighCardinalitySensitiveFields: forceRunHighCardinalitySensitiveFieldsStatus,
                        sensitiveBinWidthOverrides: sensitiveBinWidthOverridesMap
                    } as unknown as NonNullable<typeof step4AnalysisCacheData>,
                    currentParametersHashString
                );

                addAuditLogAction(buildPipelineAuditLogEntry({
                    certificateId: generatedNewAuditMetadataObj.certificateId,
                    auditTime: generatedNewAuditMetadataObj.auditTime,
                    auditTimestamp: generatedNewAuditMetadataObj.auditTimestamp,
                    fileName: currentDatasetFileNameString,
                    privacyMode: currentPrivacyModeTypeStr,
                    operatorName: currentUserSession?.name,
                    operatorRole: currentUserSession?.role,
                    kValue: currentKValueNumber,
                    queryCount: simulatedQueryCountValue,
                    hasAttackReport: Boolean(attackReportResult),
                    simulationMetrics: generatedSimulationMetricsObject,
                    datasetRowStats: generatedDatasetRowStatsObject,
                    isComplianceValid: pipelineComplianceValidStatus,
                    columnNames: actualProcessedColumnsList,
                    resolveColumnRole: getCalculatedRole,
                    dpEnabledFieldNames: (currentDpFieldsListArray || []).filter((field: DpStoreField) => field.enabled).map((field: DpStoreField) => field.fieldName)
                }));

                setSystemSimulationLogsList(prev => [...prev, translate('step4.log.finished', '[{{time}}] 🎉 後端管線運算完畢，合規憑證生成完成！', { time: formatCurrentTimeForLogString() })]);

            } catch (error: unknown) {
                // ★ 2026-09-30：使用者按「取消運算」→ 不是錯誤，不組錯誤卡片、不寫稽核紀錄
                if (isApiRequestCanceled(error)) {
                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⏹ 已取消運算`]);
                    messageApi.info(translate('step4.msg.canceled', '已取消運算'));
                    setIsPipelineCanceledStatus(true);
                    setPipelineFailedMessage(translate('step4.msg.canceled_detail', '已取消運算。可調整設定後按「重新運算」再執行一次。'));
                    return;
                }
                // 逾時：請求超過 DEFAULT_API_TIMEOUT_MS 仍未完成
                if (isApiRequestTimeout(error)) {
                    const timeoutMinutesNumber = Math.round(DEFAULT_API_TIMEOUT_MS / 60000);
                    const timeoutMessageText = translate('step4.msg.timeout_detail', '後端超過 {{minutes}} 分鐘沒有回應，已停止等待。可能是資料量太大、後端服務異常，或透過 cloudflared 等通道連線時被中斷；建議改用 localhost 開啟或縮小資料量後重新運算。', { minutes: timeoutMinutesNumber });
                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⏱ 請求逾時（${timeoutMinutesNumber} 分鐘）`]);
                    messageApi.error(translate('step4.msg.timeout', '後端回應逾時'));
                    setPipelineFailedMessage(timeoutMessageText);
                    return;
                }
                const { errorMessage, displayNode: friendlyDisplayNode, responseData } = await describePipelineError(error);

                console.error("Pipeline 執行失敗:", error, responseData);
                setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ❌ 處理失敗: ${errorMessage}`]);
                messageApi.error(translate('step4.msg.api_failed', '後端 API 執行失敗，請檢查 Log 訊息'));
                setPipelineFailedMessage(friendlyDisplayNode);
            } finally {
                isPipelineRunInProgressRef.current = false;
                pipelineAbortControllerRef.current = null;
                setUploadProgressText(null);
                setPipelineRunGeneration((generationValue) => generationValue + 1);
                setTimeout(() => setIsPipelineCalculatingStatus(false), SIMULATION_COMPLETION_DELAY_MS);
            }

        },
        [actualProcessedColumnsList, addAuditLogAction, budgetLimitEpsilonValue, currentCellFillMethodStr, cellFillValuesByColumnMap, currentColumnTypesMapDict, currentDatasetFileNameString, currentDpFieldsListArray, currentKValueNumber, currentLValueNumber, currentLimitExceededActionStr, currentMaxSuppressionNumber, currentParametersHashString, currentPrivacyModeTypeStr, currentSuppressionMethodStr, currentTValueNumber, currentUserSession, dataFile, dpAccumulatedDeltaValue, dpAccumulatedEpsilonValue, forceRunHighCardinalitySensitiveFieldsStatus, getCalculatedRole, globalTargetDeltaValue, isAnalysisCacheValidStatus, isEnableLDiversityStatus, isEnableTClosenessStatus, kAnonymityFieldsList, kAnonymityHierarchiesList, messageApi, riskSubgroupFiltersMapDict, sensitiveBinWidthOverridesMap, setStep4CacheAction, simulatedQueryCountValue, translate]
    );

    // ★ 2026-10-01（第 16 項）：自動執行只在「使用者可調整的參數」（currentParametersHashString）改變、且這組
    //   參數還沒開始執行過時觸發。先前 effect 依賴 runFullPipeline 的參考值，而執行途中寫回 store 的 DP 累計
    //   ε／δ 也會讓參考值改變：若這輪在去識別化之後失敗（例如沒有可用的類別型敏感欄位、三攻擊請求失敗），
    //   快取仍無效，就會自動再跑一輪、再呼叫一次 DP API、再消耗一次隱私預算；後端未回傳 accumulated_delta
    //   時累計值每輪都不同，形成無止盡的重跑（離開本頁後仍在背景持續）。現在失敗後不自動重跑，改由使用者
    //   調整參數或按「重新運算」。一輪執行中參數又被改變時，該次呼叫會被執行中旗標擋下，等這輪結束
    //   （pipelineRunGeneration 遞增）後再檢查一次，以新參數補跑。
    const runFullPipelineRef = useRef(runFullPipeline);
    useEffect(() => { runFullPipelineRef.current = runFullPipeline; }, [runFullPipeline]);
    useEffect(() => {
        if (isAnalysisCacheValidStatus || lastAttemptedParamsHashRef.current === currentParametersHashString) return;
        const tId = setTimeout(() => runFullPipelineRef.current(false), 0);
        return () => clearTimeout(tId);
    }, [isAnalysisCacheValidStatus, currentParametersHashString, pipelineRunGeneration]);

    return {
        apiReport,
        processedCsvBlob,
        realMaskedDataRows,
        previewParseDiagnosticText,
        attackReportData,
        capReportData,
        datasetRowStatsData,
        attackSimulationMetricsData,
        auditMetadataObject,
        highCardinalitySensitiveWarningInfo,
        forceRunHighCardinalitySensitiveFieldsStatus,
        setForceRunHighCardinalitySensitiveFieldsStatus,
        sensitiveBinWidthOverridesMap,
        setSensitiveBinWidthOverridesMap,
        pipelineFailedMessage,
        setPipelineFailedMessage,
        isPipelineCalculatingStatus,
        currentPipelinePhaseType,
        calculationProgressValue,
        systemSimulationLogsList,
        uploadProgressText,
        isPipelineCanceledStatus,
        runFullPipeline,
        handleCancelPipeline
    };
};
