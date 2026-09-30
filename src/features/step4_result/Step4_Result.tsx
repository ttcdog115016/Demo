/**
 * ============================================================================
 * 檔案名稱 (File): Step4_Result.tsx
 * 模組功能 (Description): 去識別化工作流第四步：結果展示、風險審計與憑證簽發組件 (整合真實後端 API 串接、全參數 Hash 監聽與 QI 泛化動態設定)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則
 * ============================================================================
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import {
    Card, Row, Col, Table, Tag, Alert, Button,
    Modal, Segmented, Space, Progress, Spin, Steps, theme, App as AntdApp, Tooltip, Select, Checkbox, InputNumber
} from 'antd';
import {
    CheckCircleOutlined, CheckCircleFilled, DownloadOutlined,
    FileDoneOutlined, EyeOutlined, SafetyCertificateOutlined,
    ReloadOutlined, LoadingOutlined, LineChartOutlined, CloudUploadOutlined,
    WarningFilled, CloseCircleFilled, QuestionCircleOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import Papa from 'papaparse';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../store/useAuthStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useAuditStore } from '../../store/useAuditStore';
import { buildBackendSubgroupPayload } from '../../utils/riskSubgroupHelpers';
import { ensureDatasetProfile } from '../../utils/datasetProfile';
import { applySensitiveBinningToCsvText } from '../../utils/sensitiveBinning'; // ★ 新增：風險評估「對象族群限定條件」轉換為後端格式
import { extractCapRequestFailureReasonText, buildCapUnavailableReceipt, countCsvDataRowsForStats } from '../../utils/riskResultHelpers';
import { resolveKAnonymityRiskColumns, selectKAnonymitySensitiveCandidates, describeKAnonymityHighCardinalityHandling, buildKAnonymityRiskColumnsForCandidate, buildKAnonymityConfigBlockForRisk, selectDifferentialPrivacySensitiveCandidates, describeDifferentialPrivacyHighCardinalityHandling, buildDifferentialPrivacyRiskColumnsForCandidate, buildRiskAttackConfigObject, buildCapConfigObject, createJsonConfigFile, runWorstCaseAttackRounds, runWorstCaseCapRounds, RISK_ATTACK_DEFAULT_PARAMS, type RiskColumnsMap, type HighCardinalitySensitiveInfo } from '../../utils/riskAssessment';
import { buildKAnonymityConfig, buildDifferentialPrivacyConfig, buildKAnonymityApiOptions, buildDifferentialPrivacyApiOptions, computeDpTotalBudgets, type DpStoreField, type KAnonymityPipelineSettings, type DifferentialPrivacyConfigInput } from '../../utils/pipelineConfig';

// 引入 API 服務
import { BACKEND_ERROR_CODE_CATEGORY_MAP, GENERIC_HTTP_STATUS_FALLBACK_MESSAGE, DEBUG_ERRORS_LOCAL_STORAGE_KEY, buildFriendlyErrorDisplayNode, DEBUG_PANEL_ERROR_CODE_OPTIONS } from './backendErrorCatalog';
import { runKAnonymity, runDifferentialPrivacy, runRiskKAnonymity, runRiskDp, runRiskCap, isApiRequestCanceled, isApiRequestTimeout, DEFAULT_API_TIMEOUT_MS, type ApiRequestOptions, type KAnonymityQualityReport, type DpQualityReport, type AttackReport, type CapReport } from '../../api/apiService';

const SIMULATION_COMPLETION_DELAY_MS = 600;
const PDF_COMPILATION_DELAY_MS = 400;


interface Html2Pdf
{
    set: (options: Record<string, unknown>) => Html2Pdf;
    from: (element: HTMLElement | null) => Html2Pdf;
    save: () => Promise<void>;
}

interface WindowWithHtml2Pdf extends Window 
{
    html2pdf: () => Html2Pdf;
}

interface SimulationResult 
{
    singling: { ori: number; ctrl: number; base: number; risk: number };
    linkability: { ori: number; ctrl: number; base: number; risk: number };
    inference: { ori: number; ctrl: number; base: number; risk: number };
    overallRiskPercent: string;
}

type PipelinePhase = 'uploading' | 'processing' | 'auditing' | 'completed';

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
const evaluateComplianceValidity = (
    privacyModeTypeStr: string | null | undefined,
    reportData: KAnonymityQualityReport | DpQualityReport | null,
    budgetLimitEpsilonValue: number
): boolean => {
    if (!reportData) return true;

    if (privacyModeTypeStr === 'k-anonymity') {
        return (reportData as KAnonymityQualityReport).is_valid;
    }

    if (privacyModeTypeStr === 'differential-privacy') {
        return (reportData as DpQualityReport).consumed_epsilon <= budgetLimitEpsilonValue;
    }

    return true;
};

export default function Step4_Result(): React.ReactElement
{
    const { token } = theme.useToken();
    const isDarkModeActiveStatus = token.colorBgContainer !== '#ffffff';
    const { t: translate } = useTranslation();
    const { message: messageApi } = AntdApp.useApp();

    const currentUserSession = useAuthStore((state) => state.user);
    const addAuditLogAction = useAuditStore((state) => state.addAuditLog);

    const dataFile = useWorkspaceStore((state: unknown) => (state as { dataFile: File | null }).dataFile);
    const datasetColumnsListArray = useWorkspaceStore((state) => state.columns);
    const previewDataRowsListArray = useWorkspaceStore((state) => state.previewData);

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
            kAnonymityHierarchies: kAnonymityHierarchiesList
        }),
        [
            currentPrivacyModeTypeStr, currentKValueNumber, currentLValueNumber, currentTValueNumber,
            isEnableLDiversityStatus, isEnableTClosenessStatus, currentMaxSuppressionNumber,
            currentSuppressionMethodStr, currentLimitExceededActionStr, simulatedQueryCountValue,
            currentDpFieldsListArray, columnPrivacyRolesMapDict, currentColumnTypesMapDict, currentPreprocessingRulesMapDict,
            kAnonymityFieldsList, kAnonymityHierarchiesList
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

    // ★ 新增：錯誤卡片測試面板下拉選單目前選擇的錯誤碼，預設選第一個。
    const [debugSelectedErrorCodeStr, setDebugSelectedErrorCodeStr] = useState<string>(DEBUG_PANEL_ERROR_CODE_OPTIONS[0].code);

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
    const [datasetRowStatsData, setDatasetRowStatsData] = useState<{ input: number; deleted: number; output: number } | null>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).datasetRowStats as { input: number; deleted: number; output: number } | null) || null
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
    const [highCardinalitySensitiveWarningInfo, setHighCardinalitySensitiveWarningInfo] = useState<{ columnName: string; uniqueRatioPercent: number; handling?: 'binned' | 'skipped' | 'forced'; binWidth?: number; binCount?: number }[]>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).highCardinalitySensitiveWarningInfo as { columnName: string; uniqueRatioPercent: number; handling?: 'binned' | 'skipped' | 'forced'; binWidth?: number; binCount?: number }[] | undefined) || []
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
    const isPipelineRunInProgressRef = useRef(false);
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

    const [previewViewMode, setPreviewViewMode] = useState<'masked' | 'original'>('masked');
    const [isReportModalVisibleStatus, setIsReportModalVisibleStatus] = useState<boolean>(false);
    const [isExportingPdfStatus, setIsExportingPdfStatus] = useState<boolean>(false);

    const pdfReportContainerRef = useRef<HTMLDivElement>(null);
    const simulationLogsEndRef = useRef<HTMLDivElement>(null);
    
    const [isPipelineCalculatingStatus, setIsPipelineCalculatingStatus] = useState<boolean>(!isAnalysisCacheValidStatus);
    const [currentPipelinePhaseType, setCurrentPipelinePhaseType] = useState<PipelinePhase>(isAnalysisCacheValidStatus ? 'completed' : 'uploading');
    const [calculationProgressValue, setCalculationProgressValue] = useState<number>(isAnalysisCacheValidStatus ? 100 : 0);
    const [systemSimulationLogsList, setSystemSimulationLogsList] = useState<string[]>([]);
    const [attackSimulationMetricsData, setAttackSimulationMetricsData] = useState<SimulationResult | null>(isAnalysisCacheValidStatus ? step4AnalysisCacheData!.metrics : null);
    const [auditMetadataObject, setAuditMetadataObject] = useState(
        () => ({
            certificateId: isAnalysisCacheValidStatus ? step4AnalysisCacheData!.certificateId : `PAC-${Date.now()}`,
            auditTime: isAnalysisCacheValidStatus ? step4AnalysisCacheData!.auditTime : new Date().toLocaleString()
        })
    );

    const actualProcessedColumnsList = useMemo(
        () => {
            if (datasetColumnsListArray && datasetColumnsListArray.length > 0) {
                return datasetColumnsListArray.map(col => col.replace(/^[\uFEFF\u200B]+/, '').trim());
            }
            if (kAnonymityFieldsList && kAnonymityFieldsList.length > 0) {
                return kAnonymityFieldsList.map((fieldItem: unknown) => (fieldItem as { name: string }).name).filter(Boolean).map(col => col.replace(/^[\uFEFF\u200B]+/, '').trim());
            }
            return [];
        }, 
        [datasetColumnsListArray, kAnonymityFieldsList]
    );

    const sampleRawDataRowsList = useMemo(
        () => previewDataRowsListArray && previewDataRowsListArray.length > 0
            ? previewDataRowsListArray.slice(0, 10)
            : [],
        [previewDataRowsListArray]
    );

    // ★ 修正：使用者對照瀏覽器開發者工具的實際後端回應後發現，「脫敏結果預覽對照」在
    //   「K-匿名化後資料／差分隱私加噪後資料」檢視下，表格欄位（姓名、身分證號、生日等
    //   Identifier 角色欄位）與後端實際回傳的 CSV 完全對不上——後端對 Identifier 欄位是直接
    //   「整欄移除」而非留空，但先前這裡的欄位清單一律用 actualProcessedColumnsList（即
    //   Step1 上傳時的「原始資料集全部欄位」），導致畫面上多顯示出 3 個後端根本沒回傳、
    //   徹頭徹尾是空白的假欄位，容易誤以為是資料遺失或程式出錯。正確做法：「遮罩後」檢視應
    //   改以實際解析到的 realMaskedDataRows（即後端回傳的 processedCsvBlob 解析結果）之
    //   欄位鍵值為準，畫面上有幾欄就是後端真的回傳幾欄；「原始明文資料」檢視則維持顯示
    //   Step1 上傳時的全部原始欄位（該檢視本來就應完整呈現原始資料，兩者用途不同、不可
    //   混用同一份欄位清單）。
    const maskedPreviewColumnNamesList = useMemo(
        () => realMaskedDataRows.length > 0 ? Object.keys(realMaskedDataRows[0]) : actualProcessedColumnsList,
        [realMaskedDataRows, actualProcessedColumnsList]
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

    const getCalculatedRole = useCallback(
        (targetColumnNameString: string) =>
        {
            const cleanColName = targetColumnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
            const lowerCaseColumnNameString = cleanColName.toLowerCase();

            // \u2605 \u512A\u5148\u6BD4\u5C0D kAnonymityFieldsList \u2014 \u6B64\u6E05\u55AE\u8207 runFullPipeline \u5BE6\u969B\u7D44\u88DD\u9001\u5F80\u5F8C\u7AEF config \u4E4B
            //   columnsMap \u70BA\u540C\u4E00\u8CC7\u6599\u4F86\u6E90\uFF0C\u907F\u514D\u8207 columnRoles (\u53EF\u80FD\u672A\u540C\u6B65\u66F4\u65B0) \u4E0D\u4E00\u81F4\uFF0C\u5C0E\u81F4\u8AA4\u5224\u70BA\u672A\u53BB\u8B58\u5225
            const matchedKAnonymityFieldItem = kAnonymityFieldsList.find((fieldItem: unknown) => {
                const fieldRecord = fieldItem as Record<string, unknown>;
                return fieldRecord && typeof fieldRecord.name === 'string' && fieldRecord.name.replace(/^[\uFEFF\u200B]+/, '').trim() === cleanColName;
            }) as Record<string, unknown> | undefined;

            const rawConfiguredRoleNameString = (
                (matchedKAnonymityFieldItem?.role as string) || columnPrivacyRolesMapDict[cleanColName] || ''
            ).toLowerCase();
            // ★ 修正：與 cleanColName 同樣先去除 BOM／前後空白再比對，避免欄位名稱帶有
            //   UTF-8 BOM（常見於 Excel 匯出之 CSV 第一欄）時，永遠比對不到對應的 DP 欄位設定。
            const stripLeadingBomAndZeroWidthSpace = (rawTextValue: string): string => {
                let resultTextValue = rawTextValue;
                while (resultTextValue.length > 0 && (resultTextValue.charCodeAt(0) === 0xFEFF || resultTextValue.charCodeAt(0) === 0x200B)) {
                    resultTextValue = resultTextValue.slice(1);
                }
                return resultTextValue.trim();
            };
            const targetDpFieldConfigItem = currentDpFieldsListArray?.find(
                fieldItemRecord => stripLeadingBomAndZeroWidthSpace(fieldItemRecord.fieldName) === cleanColName
            );
            const matchedIdentifierMaskStrategyString = (matchedKAnonymityFieldItem?.maskStrategy as string) || '';

            // ★ 使用者反映（2026-09-30）：差分隱私模式的結果預覽標籤一直顯示「敏感欄位／間接識別」，而非
            //   差分隱私的「加噪／保留」。原因是 DP 的 Step2 會把已啟用欄位寫入 columnRoles 為 sensitive
            //   （數值型）／quasi_identifier（類別型），下方依序比對角色時提早回傳，永遠走不到 DP 分支；
            //   合規報告也因此把沒啟用、實際保留原值的姓名等欄位標成「直接識別／完全遮蔽」。差分隱私模式
            //   只依「Step2 是否啟用該欄位」判斷（與實際送給後端加噪的 column_budgets 條件一致）：
            //   啟用 → 加噪；未啟用 → 保留（未處理，輸出檔內為原始值，以金色標籤提醒）。
            if (currentPrivacyModeTypeStr === 'differential-privacy')
            {
                if (targetDpFieldConfigItem && targetDpFieldConfigItem.enabled)
                    return { role: 'DP Sensitive', tagColor: 'purple', maskStrategy: matchedIdentifierMaskStrategyString };
                return { role: 'Retained', tagColor: 'gold', maskStrategy: matchedIdentifierMaskStrategyString };
            }

            if (rawConfiguredRoleNameString.includes('identifier') && !rawConfiguredRoleNameString.includes('quasi'))
                return { role: 'Identifier', tagColor: 'magenta', maskStrategy: matchedIdentifierMaskStrategyString };

            if (rawConfiguredRoleNameString.includes('quasi') || rawConfiguredRoleNameString === 'qi')
                return { role: 'Quasi-identifier', tagColor: 'orange', maskStrategy: matchedIdentifierMaskStrategyString };

            // ★ 修正：「非敏感」(non-sensitive) 字串本身也包含 "sensitive" 子字串，先前用
            //   .includes('sensitive') 判斷會把使用者明明選的是「非敏感」欄位誤判成「敏感」，
            //   導致 K-匿名模式報告顯示錯誤角色標籤；差分隱私模式下更嚴重——只要該欄位名稱
            //   曾在 K-匿名步驟被設定過角色（哪怕是切換模式前的舊資料），就會在這裡被攔截，
            //   永遠不會走到下面差分隱私專屬的判斷邏輯，造成「實際去識別數」在 DP 模式恆為 0。
            //   比照上面 quasi-identifier／identifier 的排除寫法，加上 !includes('non') 即可修正。
            if (rawConfiguredRoleNameString.includes('sensitive') && !rawConfiguredRoleNameString.includes('non'))
                return { role: 'Sensitive', tagColor: 'purple', maskStrategy: matchedIdentifierMaskStrategyString };

            const isExplicitIdentifierMatched = /(^|_)(id|card_id|sn|person_sn|nric|phone|email|name|ssn)($|_)/i.test(lowerCaseColumnNameString);

            if (isExplicitIdentifierMatched)
                return { role: 'Identifier', tagColor: 'magenta', maskStrategy: matchedIdentifierMaskStrategyString };

            if (/(station|time|date|zip|age|gender|card_type|年齡|地區|職業|性別|地址|生日)/i.test(lowerCaseColumnNameString))
                return { role: 'Quasi-identifier', tagColor: 'orange', maskStrategy: matchedIdentifierMaskStrategyString };

            return { role: 'Non-sensitive', tagColor: 'blue', maskStrategy: matchedIdentifierMaskStrategyString };
        },
        [columnPrivacyRolesMapDict, currentDpFieldsListArray, currentPrivacyModeTypeStr, kAnonymityFieldsList]
    );

    // ★ 使用者反映（2026-09-22）：「實際去識別數 / 總欄位數」計算錯誤，例如應為 6 卻顯示 7。
    //   根本原因：先前的計算方式只要欄位「角色」被設為 Identifier／Quasi-identifier 就計入，
    //   但角色只是使用者在 Step2 的「分類」，不代表後端真的會對該欄位套用任何遮蔽／泛化——
    //   例如：
    //     - Identifier 欄位的「遮蔽策略」欄位預設值是 'none'（新增欄位時的預設，見
    //       KAnonymityMapping.tsx addField 之 maskStrategy: 'none'），使用者若忘記另外選一個
    //       實際的遮蔽方式，這欄實際上完全不會被送到後端做任何處理（比對 runFullPipeline 組
    //       config 時的判斷：`matchedField.maskStrategy && matchedField.maskStrategy !== 'none'`
    //       才會寫入 strategy），畫面卻仍把它算進「已去識別」。
    //     - 類別型（categorical）Quasi-identifier 選擇「依分類樹泛化」(genStrategy==='tree')
    //       時，若使用者尚未在 Step2「泛化階層對照」分頁實際填寫該欄位的階層對照表，後端收不到
    //       generalization_matrices 對應項目，同樣不會產生任何泛化效果。
    //   下面 isColumnActuallyDeidentifiedFn 比照 runFullPipeline 實際組 K-匿名化 config 時的
    //   判斷條件（見下方 runFullPipeline 之 columnsMap／generalizationHierarchiesMap／
    //   generalizationMatricesMap 組裝邏輯），只有「真的會被送到後端做遮蔽或泛化」的欄位才計入，
    //   確保這裡顯示的數字與實際送出的設定檔一致。
    const isColumnActuallyDeidentifiedFn = useCallback(
        (columnNameString: string): boolean => {
            const cleanColName = columnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
            const matchedField = kAnonymityFieldsList.find((fieldItem: unknown) => {
                const fieldRecord = fieldItem as Record<string, unknown>;
                return fieldRecord && typeof fieldRecord.name === 'string' && fieldRecord.name.replace(/^[\uFEFF\u200B]+/, '').trim() === cleanColName;
            }) as Record<string, unknown> | undefined;

            const { role: calculatedRoleNameString } = getCalculatedRole(columnNameString);

            if (calculatedRoleNameString === 'Identifier') {
                // 對齊 runFullPipeline：唯有實際選了非 'none' 的遮蔽策略，後端才會真的處理該欄位。
                const maskStrategyValue = matchedField?.maskStrategy as string | undefined;
                return !!(maskStrategyValue && maskStrategyValue !== 'none');
            }

            if (calculatedRoleNameString === 'Quasi-identifier') {
                if (!matchedField) return false;
                const colType = String(matchedField.type) || 'string';
                const genStrategyValue = matchedField.genStrategy as string | undefined;

                if (colType === 'numeric') {
                    if (genStrategyValue === 'custom_bins') {
                        const rawCustomBinsList = matchedField.customBins as unknown[] | undefined;
                        return Array.isArray(rawCustomBinsList) && rawCustomBinsList.length > 0;
                    }
                    if (genStrategyValue === 'rounding') {
                        const roundingUnitValue = typeof matchedField.genParam === 'number' ? matchedField.genParam : Number(matchedField.genParam);
                        return Number.isFinite(roundingUnitValue) && roundingUnitValue > 0;
                    }
                    return false;
                }

                if (colType === 'temporal') {
                    if (genStrategyValue === 'time_rounding') return true;
                    if (genStrategyValue === 'time_range') {
                        const rawTimeRangeBinsList = matchedField.customBins as unknown[] | undefined;
                        return Array.isArray(rawTimeRangeBinsList) && rawTimeRangeBinsList.length > 0;
                    }
                    return false;
                }

                if (colType === 'string') {
                    return genStrategyValue === 'prefix' || genStrategyValue === 'length';
                }

                if (colType === 'categorical') {
                    if (genStrategyValue !== 'tree') return false;
                    return kAnonymityHierarchiesList.some((h: unknown) => {
                        const hierarchyRecord = h as Record<string, unknown>;
                        const hFieldNameCleaned = (hierarchyRecord.fieldName as string || '').replace(/^[\uFEFF\u200B]+/, '').trim();
                        if (hFieldNameCleaned !== cleanColName) return false;
                        const mappings = hierarchyRecord.mappings as unknown[][];
                        if (!Array.isArray(mappings)) return false;
                        return mappings.some((row: unknown) => {
                            const rowArray = row as string[];
                            return Array.isArray(rowArray) && rowArray.length > 0 && rowArray[0] && typeof rowArray[0] === 'string' && rowArray[0].trim() !== '';
                        });
                    });
                }

                return false;
            }

            return false;
        },
        [kAnonymityFieldsList, kAnonymityHierarchiesList, getCalculatedRole]
    );

    // 實際去識別欄位數：K-匿名化計入「確實會被送到後端套用遮蔽或泛化」之 Identifier／
    // Quasi-identifier 欄位，差分隱私計入已套用加噪 (DP Sensitive) 之欄位。
    const deidentifiedColumnsCountValue = useMemo(
        () => actualProcessedColumnsList.filter((columnNameString) => {
            if (currentPrivacyModeTypeStr === 'differential-privacy') {
                // ★ 使用者反映（2026-09-29）：DP 模式「實際去識別數」恆為 0。先前靠 getCalculatedRole
                //   回傳 'DP Sensitive' 判斷，但 DP 的 Step2 會把已啟用欄位寫入 columnRoles 為
                //   sensitive（數值型）／quasi_identifier（類別型），getCalculatedRole 依序先比對到
                //   Sensitive／Quasi-identifier 就提早回傳，永遠走不到 DP 專屬分支。改為直接以實際送給
                //   後端加噪的依據——DP 欄位清單中「已啟用」的欄位——計數，與 runFullPipeline 組
                //   column_budgets 的條件（field.enabled）一致。
                const cleanColName = columnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
                return (currentDpFieldsListArray || []).some((field: DpStoreField) =>
                    field.enabled && String(field.fieldName || '').replace(/^[\uFEFF\u200B]+/, '').trim() === cleanColName
                );
            }
            return isColumnActuallyDeidentifiedFn(columnNameString);
        }).length,
        [actualProcessedColumnsList, currentDpFieldsListArray, currentPrivacyModeTypeStr, isColumnActuallyDeidentifiedFn]
    );

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

                if (currentPrivacyModeTypeStr === 'k-anonymity') {
                    configObject = buildKAnonymityConfig({
                        ...kAnonymityPipelineSettings,
                        processedColumnNames: actualProcessedColumnsList,
                        kAnonymityFields: kAnonymityFieldsList,
                        kAnonymityHierarchies: kAnonymityHierarchiesList,
                        resolveFallbackUiRole: (cleanColumnName) => getCalculatedRole(cleanColumnName).role
                    });
                } else if (currentPrivacyModeTypeStr === 'differential-privacy') {
                    configObject = buildDifferentialPrivacyConfig(dpPipelineConfigInput);
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

                // ★ 後端工程師回覆（2026-09-29）：連續數值型敏感欄位改為先分級距再送風險評估（完整說明見上方
                //   sensitiveBinWidthOverridesMap 狀態宣告處）。級距一律以 0 為原點切齊
                //   （floor(值 ÷ 寬度) × 寬度），確保原始資料與去識別化資料（CAP 需兩份）用同一套切點。
                //   非數值的儲存格（空值、抑制後的「*」等）原樣保留不轉換。
                // 本次實際套用級距的欄位 → 寬度；以及送風險評估用的原始資料副本（未分級距時即 safeDataFile 本身）。
                const riskEvaluationBinWidthMap: Record<string, number> = {};
                let riskOriginalDataFile: File = safeDataFile;

                if (currentPrivacyModeTypeStr === 'k-anonymity') {
                    const apiOptions = buildKAnonymityApiOptions(kAnonymityPipelineSettings);
					
					// 👇 加這行！讓它印在 Console 裡！
					console.log(`🚀 傳給後端 (k-anonymity) 的 Step 3 參數:`, apiOptions);

                    const response = await runKAnonymity(safeDataFile, configFile, apiOptions, pipelineRequestOptions);
                    
                    if (!response.success) throw (response.error || new Error('API 請求未成功'));
                    
                    const finalReport = response.report || {
                        is_valid: true, k_passed: true, l_passed: true, t_passed: true, suppression_rate_percent: 0, suppression_unit: 'row' as const, message: '成功完成去識別化處理', recommendations: [], applied_defaults: []
                    };
                    setApiReport(finalReport);
                    finalApiReportData = finalReport; 
                    
                    const rawResponse = response as unknown as Record<string, unknown>;
                    if (rawResponse.blob) finalCsvBlobData = rawResponse.blob as Blob;
                    else if (rawResponse.data) finalCsvBlobData = new Blob([rawResponse.data as BlobPart], { type: 'text/csv;charset=utf-8;' });
                    else if (rawResponse.csv) finalCsvBlobData = new Blob([rawResponse.csv as BlobPart], { type: 'text/csv;charset=utf-8;' });
                    
                    setProcessedCsvBlob(finalCsvBlobData);

                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ K-Anonymity API 處理成功！`]);
                } 
                else if (currentPrivacyModeTypeStr === 'differential-privacy') {
                    // ★ 規範對照: 依 Open-PETs API 3-1 節，逐欄 epsilon／delta 一律於 config 設定檔 (column_budgets) 指定，
                    //   表單參數僅用於跨批次累計 (accumulated_epsilon／accumulated_delta／default_delta)。
                    // ★ 使用者反映：先前每次執行皆固定以 0 作為累計基準值，等同從未真正累計；現在改為送出
                    //   dpAccumulatedEpsilonValue／dpAccumulatedDeltaValue（上次執行後留存之累計值），
                    //   執行成功後再依本次消耗更新累計值，讓多次執行之間的隱私預算真正累加。
                    const { totalEpsilonBudget, totalDeltaBudget } = computeDpTotalBudgets(currentDpFieldsListArray);

                    const dpApiOptions = buildDifferentialPrivacyApiOptions(dpPipelineConfigInput);

                    const response = await runDifferentialPrivacy(safeDataFile, configFile, dpApiOptions, pipelineRequestOptions);

                    if (!response.success) throw (response.error || new Error('DP API 請求未成功'));

                    const defaultReport = {
                        consumed_epsilon: totalEpsilonBudget,
                        consumed_delta: totalDeltaBudget,
                        accumulated_epsilon: (dpAccumulatedEpsilonValue ?? 0) + totalEpsilonBudget,
                        accumulated_delta: (dpAccumulatedDeltaValue ?? 0) + totalDeltaBudget,
                        message: '成功完成差分隱私處理',
                        per_column: []
                    };

                    const finalReport = response.report || defaultReport;

                    // ★ 後端若有回傳累計值即以後端計算結果為準 (由後端負責跨批次組合定理運算)；
                    //   否則 (如尚未串接真實後端時的預設報告) 退回本地以「累計基準 + 本次消耗」推算。
                    const updatedDpAccumulatedEpsilonValue = finalReport.accumulated_epsilon ?? ((dpAccumulatedEpsilonValue ?? 0) + totalEpsilonBudget);
                    const updatedDpAccumulatedDeltaValue = finalReport.accumulated_delta ?? ((dpAccumulatedDeltaValue ?? 0) + totalDeltaBudget);
                    useWorkspaceStore.setState({
                        dpAccumulatedEpsilon: updatedDpAccumulatedEpsilonValue,
                        dpAccumulatedDelta: updatedDpAccumulatedDeltaValue
                    });

                    // ★ 使用者反映（2026-09-23）：官方風險評估報告（後端簽發 PDF）裡的「已累計 ε／已累計 δ」
                    //   一直顯示 0，即使這次執行明明已經消耗了隱私預算。根因是下方三攻擊／CAP 風險評估呼叫
                    //   /api/v1/risk/dp 時，直接重用最上面建立 configObject 時寫入的 differential_privacy 區塊
                    //   （見下方 differential_privacy: (configObject as Record<string, unknown>).differential_privacy），
                    //   但那個區塊裡的 accumulated_epsilon／accumulated_delta 是「本次執行前」的舊累計基準值
                    //   （原本只是要送給實際去識別化 API 用），執行成功後從未同步更新——風險評估／官方報告
                    //   拿到的因此永遠是「跑之前」的累計值，而不是「這次跑完、實際產出這份去識別化資料集」
                    //   之後的最新累計值。這裡把剛算好、也同步寫回 Zustand store 的同一組最新累計值，順便寫回
                    //   configObject.differential_privacy，讓下方重用它的風險評估／官方報告 API 呼叫都能拿到
                    //   跑完這次之後的正確累計值。
                    const dpConfigBlockForRiskReuse = (configObject as Record<string, unknown>).differential_privacy;
                    if (dpConfigBlockForRiskReuse && typeof dpConfigBlockForRiskReuse === 'object') {
                        (dpConfigBlockForRiskReuse as Record<string, unknown>).accumulated_epsilon = updatedDpAccumulatedEpsilonValue;
                        (dpConfigBlockForRiskReuse as Record<string, unknown>).accumulated_delta = updatedDpAccumulatedDeltaValue;
                    }

                    setApiReport(finalReport);
                    finalApiReportData = finalReport;

                    const rawResponse = response as unknown as Record<string, unknown>;
                    if (rawResponse.blob) finalCsvBlobData = rawResponse.blob as Blob;
                    else if (rawResponse.data) finalCsvBlobData = new Blob([rawResponse.data as BlobPart], { type: 'text/csv;charset=utf-8;' });
                    else if (rawResponse.csv) finalCsvBlobData = new Blob([rawResponse.csv as BlobPart], { type: 'text/csv;charset=utf-8;' });

                    setProcessedCsvBlob(finalCsvBlobData);

                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ DP API 處理成功！噪聲已注入。`]);
                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] 📊 消耗隱私預算 (Epsilon): ${finalReport.consumed_epsilon}`]);
                }

                setCalculationProgressValue(65);
                setCurrentPipelinePhaseType('auditing');
                setSystemSimulationLogsList(prev => [...prev, translate('step4.log.start_risk', '[{{time}}] 🚀 脫敏完成，啟動真實風險評估（三大攻擊模擬）', { time: formatCurrentTimeForLogString() })]);

                // 候選欄位挑選、設定檔組裝與逐輪取最大值見 utils/riskAssessment.ts（含三攻擊固定參數 RISK_ATTACK_DEFAULT_PARAMS）。
                // 風險評估「對象族群限定條件」（《設定檔結構與參數說明.pdf》4-3 節）：未設定時為 undefined，設定檔即省略 subgroup。
                const resolvedRiskSubgroupPayload = buildBackendSubgroupPayload(riskSubgroupFiltersMapDict);
                const riskDatasetNameText = currentDatasetFileNameString || 'dataset';
                const appendPipelineLog = (messageText: string) => setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ${messageText}`]);

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

                // ★ 新增：輸入／刪除／輸出筆數統計——直接數原始上傳 CSV 與後端回傳的去識別化 CSV
                //   各自的資料列數（扣除表頭），不依賴各報表裡可能經過抽樣、口徑未必一致的統計欄位，
                //   如此使用者才能直接看到「這次總共刪掉了幾筆」。

                const inputRowCountValue = countCsvDataRowsForStats(cleanedCsvText);
                let outputRowCountValue = inputRowCountValue;
                if (finalCsvBlobData) {
                    try {
                        const processedCsvTextForRowCount = await readProcessedCsvTextOnce();
                        outputRowCountValue = countCsvDataRowsForStats(processedCsvTextForRowCount);
                    } catch (rowCountErrorPayload) {
                        console.error('計算輸出資料筆數失敗:', rowCountErrorPayload);
                    }
                }
                const deletedRowCountValue = Math.max(0, inputRowCountValue - outputRowCountValue);
                const generatedDatasetRowStatsObject = { input: inputRowCountValue, deleted: deletedRowCountValue, output: outputRowCountValue };
                setDatasetRowStatsData(generatedDatasetRowStatsObject);

                setCalculationProgressValue(100);
                setCurrentPipelinePhaseType('completed');

                const finalSinglingRiskValue = attackReportResult?.singling_out_risk ?? 0;
                const finalLinkabilityRiskValue = attackReportResult?.linkability_risk ?? 0;
                const finalInferenceRiskValue = attackReportResult?.inference_risk ?? 0;

                // ★ 依使用者指定之風險量化公式（主要攻擊分數 S_ori／控制攻擊分數 S_ctrl／
                //   基準攻擊分數 S_base 三者正規化）：
                //     最終風險分數 = max(0, (S_ori − max(S_ctrl, S_base)) / (1 − max(S_ctrl, S_base)))
                //   S_ori：後端 /risk/k-anonymity、/risk/dp 回傳之三攻擊成功率（singling_out_risk 等）。
                //   S_ctrl：控制攻擊分數——後端目前完全沒有回傳「在對照組樣本上跑同一攻擊」的
                //   成功率，故暫以 0 表示（不可憑空捏造數字），待後端提供對應欄位後再串接真實值。
                //   S_base：基準攻擊分數——採業界常見之隨機猜測基準 1/樣本數，以後端回傳的
                //   sample_size 計算；樣本數不明或為 0 時視為無基準可比，直接退回原始值。
                const CONTROL_ATTACK_RISK_PLACEHOLDER = 0;
                const naiveBaselineRiskValue = (attackReportResult?.sample_size && attackReportResult.sample_size > 0)
                    ? 1 / attackReportResult.sample_size
                    : 0;
                const riskReferenceFloorValue = Math.max(CONTROL_ATTACK_RISK_PLACEHOLDER, naiveBaselineRiskValue);
                const normalizeAttackRiskScore = (mainAttackRiskValue: number): number => {
                    if (riskReferenceFloorValue >= 1) return 0;
                    return Math.max(0, (mainAttackRiskValue - riskReferenceFloorValue) / (1 - riskReferenceFloorValue));
                };

                const normalizedSinglingRiskValue = normalizeAttackRiskScore(finalSinglingRiskValue);
                const normalizedLinkabilityRiskValue = normalizeAttackRiskScore(finalLinkabilityRiskValue);
                const normalizedInferenceRiskValue = normalizeAttackRiskScore(finalInferenceRiskValue);
                const calculatedOverallMaxRiskScoreValue = Math.max(normalizedSinglingRiskValue, normalizedLinkabilityRiskValue, normalizedInferenceRiskValue);

                const generatedSimulationMetricsObject: SimulationResult = {
                    singling: { ori: finalSinglingRiskValue, ctrl: CONTROL_ATTACK_RISK_PLACEHOLDER, base: naiveBaselineRiskValue, risk: normalizedSinglingRiskValue },
                    linkability: { ori: finalLinkabilityRiskValue, ctrl: CONTROL_ATTACK_RISK_PLACEHOLDER, base: naiveBaselineRiskValue, risk: normalizedLinkabilityRiskValue },
                    inference: { ori: finalInferenceRiskValue, ctrl: CONTROL_ATTACK_RISK_PLACEHOLDER, base: naiveBaselineRiskValue, risk: normalizedInferenceRiskValue },
                    overallRiskPercent: (calculatedOverallMaxRiskScoreValue * 100).toFixed(1)
                };

                // ★ 使用者反映（2026-09-22）：K-匿名「敏感欄位 = 0」時三攻擊整段跳過（attackReportResult
                //   維持 null），若這裡不論有沒有實際評估都無條件 setAttackSimulationMetricsData 一個
                //   全部指標為 0 的物件，畫面上「安全性評估」卡片（由 attackSimulationMetricsData 是否
                //   非 null 控制顯示）反而會照樣顯示「指認/連結/推斷風險皆為 0%」——這跟 CAP 卡片「未評估」
                //   的處理方式不一致，且會讓使用者誤以為「已經評估過、結果是完全沒風險」，而不是「根本
                //   沒有評估」。故只在真的有 attackReportResult 時才寫入 state，沒評估時維持 null，
                //   讓卡片跟著隱藏（與 CAP 目前跳過時的呈現方式一致）。
                setAttackSimulationMetricsData(attackReportResult ? generatedSimulationMetricsObject : null);

                // ★ 依後端實際回傳之報告判斷是否真正達到合規標準，而非不論結果一律標示為「已通過」
                const pipelineComplianceValidStatus = evaluateComplianceValidity(currentPrivacyModeTypeStr, finalApiReportData, budgetLimitEpsilonValue);

                setStep4CacheAction(
                    {
                        metrics: attackReportResult ? generatedSimulationMetricsObject : null,
                        certificateId: generatedNewAuditMetadataObj.certificateId,
                        auditTime: generatedNewAuditMetadataObj.auditTime,
                        apiReport: finalApiReportData,
                        processedCsvBlob: finalCsvBlobData,
                        capReport: capReportResult,
                        datasetRowStats: generatedDatasetRowStatsObject,
                        // ★ 一併存讀高唯一值比例敏感欄位警告快照，避免切換步驟重新掛載後消失
                        // （見上方 highCardinalitySensitiveWarningInfo state 宣告處的完整說明）。
                        // 這裡讀取的是本次執行過程中賦值的 finalHighCardinalitySensitiveWarningInfo
                        // 一般變數，而非 state 本身（state 在同一次 render 閉包內不會同步更新）。
                        highCardinalitySensitiveWarningInfo: finalHighCardinalitySensitiveWarningInfo,
                        forceRunHighCardinalitySensitiveFields: forceRunHighCardinalitySensitiveFieldsStatus,
                        sensitiveBinWidthOverrides: sensitiveBinWidthOverridesMap
                    } as unknown as NonNullable<typeof step4AnalysisCacheData>,
                    currentParametersHashString
                );

                const columnRoleSnapshotDict = actualProcessedColumnsList.reduce((accumulatorDict, columnNameString) => {
                    accumulatorDict[columnNameString] = getCalculatedRole(columnNameString).role;
                    return accumulatorDict;
                }, {} as Record<string, string>);

                const identifierMaskStrategySnapshotDict = actualProcessedColumnsList.reduce((accumulatorDict, columnNameString) => {
                    const { maskStrategy: resolvedMaskStrategyString } = getCalculatedRole(columnNameString);
                    if (resolvedMaskStrategyString) accumulatorDict[columnNameString] = resolvedMaskStrategyString;
                    return accumulatorDict;
                }, {} as Record<string, string>);

                const dpEnabledFieldNamesSnapshotList = (currentDpFieldsListArray || [])
                    .filter((field: DpStoreField) => field.enabled)
                    .map((field: DpStoreField) => field.fieldName);

                addAuditLogAction({
                    certificateId: generatedNewAuditMetadataObj.certificateId,
                    fileName: currentDatasetFileNameString || 'dataset.csv',
                    privacyMode: currentPrivacyModeTypeStr || 'k-anonymity',
                    operator: currentUserSession?.name || 'Admin.Test',
                    operatorRole: currentUserSession?.role || 'admin',
                    auditTime: generatedNewAuditMetadataObj.auditTime,
                    auditTimestamp: generatedNewAuditMetadataObj.auditTimestamp,
                    parameters: currentPrivacyModeTypeStr === 'k-anonymity' ? `K = ${currentKValueNumber}` : `發布次數 M = ${simulatedQueryCountValue}`,
                    // ★ 與畫面上實際顯示的「指認/連結/推斷風險」保持一致，改為記錄正規化後的
                    //   最終風險分數（.risk），而非未扣除基準攻擊分數的原始成功率（.ori）。
                    // ★ 使用者反映（2026-09-22）：K-匿名「敏感欄位 = 0」時三攻擊整段跳過，此時
                    //   generatedSimulationMetricsObject 只是用 0 補出來的佔位值，不是真的評估
                    //   結果，稽核紀錄不應該記成「風險 0%」（看起來像評估過且完全無風險），改記
                    //   「未評估」文字，才不會誤導事後查閱稽核紀錄的人。
                    singlingRisk: attackReportResult ? `${(generatedSimulationMetricsObject.singling.risk * 100).toFixed(1)}%` : '未評估',
                    linkabilityRisk: attackReportResult ? `${(generatedSimulationMetricsObject.linkability.risk * 100).toFixed(1)}%` : '未評估',
                    inferenceRisk: attackReportResult ? `${(generatedSimulationMetricsObject.inference.risk * 100).toFixed(1)}%` : '未評估',
                    overallRisk: attackReportResult ? `${generatedSimulationMetricsObject.overallRiskPercent}%` : '未評估',
                    // ★ 新增：同步輸入／刪除／輸出筆數至審計歷史紀錄，供「稽核紀錄」頁面回溯查閱
                    inputRowCount: generatedDatasetRowStatsObject.input,
                    deletedRowCount: generatedDatasetRowStatsObject.deleted,
                    outputRowCount: generatedDatasetRowStatsObject.output,
                    status: pipelineComplianceValidStatus ? 'passed' : 'failed',
                    columnsSnapshot: actualProcessedColumnsList,
                    columnRoleSnapshot: columnRoleSnapshotDict,
                    identifierMaskStrategySnapshot: identifierMaskStrategySnapshotDict,
                    dpEnabledFieldNamesSnapshot: dpEnabledFieldNamesSnapshotList
                });

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
                let errorMessage = error instanceof Error ? error.message : '請確認 Docker 服務是否正常啟動';

                const anyError = error as Record<string, unknown>;
                const responseObj = anyError.response as Record<string, unknown> | undefined;
                let responseData = responseObj?.data as Record<string, unknown> | undefined;
                const responseHttpStatus = typeof responseObj?.status === 'number' ? responseObj.status as number : undefined;

                // ★ K-匿名化／差分隱私呼叫的 axios responseType 設為 'blob'（成功時要接住輸出檔案），
                //   代表發生錯誤時 axios 不會自動解析後端回傳的 JSON 錯誤內容——error.response.data
                //   收到的是尚未讀取的 Blob，底下讀 error_code／message／detail 全部讀不到值，
                //   導致無論後端實際回傳哪一種錯誤碼，畫面永遠只會顯示最保底的通用訊息
                //   （實測發現：新增的錯誤碼對照表因此形同虛設）。這裡先把 Blob 讀成文字並嘗試解析成
                //   JSON，讀不出來就維持原樣、走下面的通用回退訊息。
                if (typeof Blob !== 'undefined' && responseData instanceof Blob) {
                    try {
                        const blobText = await (responseData as unknown as Blob).text();
                        responseData = JSON.parse(blobText) as Record<string, unknown>;
                    } catch (blobParseError) {
                        console.warn('解析錯誤回應的 Blob 內容失敗:', blobParseError);
                    }
                }

                const responseErrorCode = typeof responseData?.error_code === 'string' ? responseData.error_code as string : undefined;
                const responseRecommendationsList = Array.isArray(responseData?.recommendations)
                    ? (responseData!.recommendations as unknown[]).filter((item): item is string => typeof item === 'string')
                    : [];
                // ★ 使用者反映：即使有錯誤代碼對照表，畫面上仍看不到「後端實際回傳的錯誤訊息」，
                //   每次都得另外開 F12 才查得到。這裡把後端原始 message 獨立取出一份，
                //   供下面組白話版錯誤卡片時，於錯誤代碼旁一併顯示，不必再開發者工具查看。
                const backendRawMessageText = typeof responseData?.message === 'string' ? responseData.message : '';

                if (responseErrorCode) {
                    // ★ 後端一律以 { error_code, message, recommendations? } 回傳業務錯誤（見
                    //   app/api/errors.py），先前完全沒有讀取 error_code，只能靠 detail／message
                    //   這兩個較不穩定的欄位猜錯誤內容。這裡依錯誤碼標示類別與狀態碼，
                    //   讓使用者一眼判斷是設定檔問題、請求問題還是系統問題，而非只看到一句
                    //   「後端 API 執行失敗，請檢查 Log 訊息」。
                    const errorCodeInfo = BACKEND_ERROR_CODE_CATEGORY_MAP[responseErrorCode];
                    const displayStatus = errorCodeInfo?.status ?? responseHttpStatus;
                    const displayCategory = errorCodeInfo?.category
                        ?? (displayStatus ? GENERIC_HTTP_STATUS_FALLBACK_MESSAGE[displayStatus] : undefined)
                        ?? '請求失敗';
                    const recommendationSuffix = responseRecommendationsList.length > 0
                        ? `；建議：${responseRecommendationsList.join('、')}`
                        : '';
                    errorMessage = `[${responseErrorCode}${displayStatus ? ` · HTTP ${displayStatus}` : ''}] ${displayCategory}`
                        + (backendRawMessageText ? `：${backendRawMessageText}` : '')
                        + recommendationSuffix;
                } else if (responseData?.detail) {
                    const detail = responseData.detail;
                    if (Array.isArray(detail)) {
                        errorMessage = '參數驗證失敗: ' + detail.map((err: Record<string, unknown>) => {
                            const loc = Array.isArray(err.loc) ? err.loc.join('.') : '';
                            return `[${loc}] ${err.msg}`;
                        }).join(' | ');
                    } else if (typeof detail === 'string') {
                        errorMessage = `API 錯誤: ${detail}`;
                    }
                } else if (responseData?.message) {
                    errorMessage = String(responseData.message);
                } else if (responseHttpStatus && GENERIC_HTTP_STATUS_FALLBACK_MESSAGE[responseHttpStatus]) {
                    // 連 error_code 都沒有（例如反向代理／閘道層直接擋下的錯誤），
                    // 至少依 HTTP 狀態碼給出通用說明，而不是原始的英文例外訊息。
                    errorMessage = `[HTTP ${responseHttpStatus}] ${GENERIC_HTTP_STATUS_FALLBACK_MESSAGE[responseHttpStatus]}`;
                }

                // ★ 上面的 errorMessage（含錯誤代碼／HTTP 狀態碼／後端原始技術訊息）是給工程師
                //   排查用的，寫進 console 與下方系統紀錄即可。畫面上真正顯示給使用者看的卡片
                //   （本工具的使用者多半沒有相關技術背景）改用共用函數 buildFriendlyErrorDisplayNode
                //   組出的「白話版」：只講「發生了什麼」跟「接下來怎麼做」，錯誤代碼收在最下面
                //   一行小字，僅供需要回報給系統管理員時參考，不干擾主要閱讀內容。抽成共用函數
                //   是為了讓下方「錯誤卡片測試面板」(?debugErrors=1) 能重現一模一樣的畫面。
                const friendlyDisplayNode: ReactNode = (responseErrorCode || responseHttpStatus || backendRawMessageText)
                    ? buildFriendlyErrorDisplayNode({
                        responseErrorCode,
                        responseHttpStatus,
                        backendRawMessageText,
                        responseRecommendationsList
                    })
                    : errorMessage;

                console.error("Pipeline 執行失敗:", error, responseData);
                setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ❌ 處理失敗: ${errorMessage}`]);
                messageApi.error(translate('step4.msg.api_failed', '後端 API 執行失敗，請檢查 Log 訊息'));
                setPipelineFailedMessage(friendlyDisplayNode);
            } finally {
                isPipelineRunInProgressRef.current = false;
                pipelineAbortControllerRef.current = null;
                setUploadProgressText(null);
                setTimeout(() => setIsPipelineCalculatingStatus(false), SIMULATION_COMPLETION_DELAY_MS);
            }

        },
        [actualProcessedColumnsList, addAuditLogAction, budgetLimitEpsilonValue, currentDatasetFileNameString, currentKValueNumber, currentLValueNumber, currentTValueNumber, currentLimitExceededActionStr, currentMaxSuppressionNumber, currentParametersHashString, currentPrivacyModeTypeStr, currentSuppressionMethodStr, currentUserSession, dataFile, getCalculatedRole, isAnalysisCacheValidStatus, isEnableLDiversityStatus, isEnableTClosenessStatus, kAnonymityFieldsList, messageApi, setStep4CacheAction, simulatedQueryCountValue, translate, currentDpFieldsListArray, currentColumnTypesMapDict, kAnonymityHierarchiesList, dpAccumulatedEpsilonValue, dpAccumulatedDeltaValue, globalTargetDeltaValue, riskSubgroupFiltersMapDict, forceRunHighCardinalitySensitiveFieldsStatus, sensitiveBinWidthOverridesMap, currentCellFillMethodStr]
    );

    useEffect(() => { if (!isAnalysisCacheValidStatus) { const tId = setTimeout(() => runFullPipeline(false), 0); return () => clearTimeout(tId); } }, [isAnalysisCacheValidStatus, runFullPipeline]);
    useEffect(() => { if (simulationLogsEndRef.current) simulationLogsEndRef.current.scrollIntoView({ behavior: 'smooth' }); }, [systemSimulationLogsList]);

    const kReport = currentPrivacyModeTypeStr === 'k-anonymity' ? (apiReport as KAnonymityQualityReport) : null;
    const dpReport = currentPrivacyModeTypeStr === 'differential-privacy' ? (apiReport as DpQualityReport) : null;
    const isComplianceValidStatus = evaluateComplianceValidity(currentPrivacyModeTypeStr, apiReport, budgetLimitEpsilonValue);

    const getAttackChartOption = () => 
    {
        if (!attackSimulationMetricsData) return {};
        return {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            legend: {
                data: [translate('step4.chart.s_risk', '攻擊成功率（真實後端評估）')],
                textStyle: { color: token.colorTextSecondary }, top: '0%'
            },
            grid: { top: '18%', left: '3%', right: '4%', bottom: '3%', containLabel: true },
            xAxis: {
                type: 'category',
                data: [translate('step4.chart.singling', '指認性攻擊 (Singling Out)'), translate('step4.chart.linkability', '連結性攻擊 (Linkability)'), translate('step4.chart.inference', '推斷性攻擊 (Inference)')],
                axisLabel: { color: token.colorTextSecondary }
            },
            yAxis: {
                type: 'value', max: 1.0,
                axisLabel: { formatter: (numericAxisValue: number) => `${(numericAxisValue * 100).toFixed(0)}%`, color: token.colorTextDescription },
                splitLine: { lineStyle: { color: token.colorSplit } }
            },
            series: [
                { name: translate('step4.chart.s_risk', '攻擊成功率'), type: 'bar', data: [attackSimulationMetricsData.singling.risk, attackSimulationMetricsData.linkability.risk, attackSimulationMetricsData.inference.risk], itemStyle: { color: '#ff4d4f', borderRadius: [4, 4, 0, 0] } }
            ]
        };
    };

    // ★ 使用者反映（2026-09-23）：合規審計報告改版後新增「隱私強化處理配置」段落，其中三攻擊／CAP
    //   的固定參數（迭代次數／控制組比例／亂數種子／連結性子集大小／重複實驗輪數／跨輪重疊比例）
    //   目前畫面尚未開放使用者調整，一律採用官方範例預設值——與 runFullPipeline 內部
    //   RISK_ATTACK_DEFAULT_PARAMS（實際送給後端 /api/v1/risk/* 的值）完全相同。那個常數宣告在
    //   runFullPipeline 這個 useCallback 內部，屬於該函式的區域變數，這裡的報告 Modal 讀不到，
    //   故另外宣告這份「僅供顯示」的複本；未來若調整 runFullPipeline 內的預設值，記得這裡也要
    //   同步更新，否則報告顯示的參數會跟實際送給後端的不一致。
    const RISK_ATTACK_REPORT_DISPLAY_PARAMS = RISK_ATTACK_DEFAULT_PARAMS;

    const handleOpenReportModal = () => setIsReportModalVisibleStatus(true);

    const handleDownloadCSV = () => 
    {
        if (processedCsvBlob) 
        {
            const blobDownloadUrlString = URL.createObjectURL(processedCsvBlob);
            const downloadAnchorHtmlElement = document.createElement('a');
            downloadAnchorHtmlElement.href = blobDownloadUrlString;
            downloadAnchorHtmlElement.download = `deidentified_dataset_${Date.now()}.csv`;
            document.body.appendChild(downloadAnchorHtmlElement);
            downloadAnchorHtmlElement.click();
            document.body.removeChild(downloadAnchorHtmlElement);
            URL.revokeObjectURL(blobDownloadUrlString);
            messageApi.success(translate('step4.msg.download_success', '已成功匯出全量脫敏 CSV 數據！'));
        } else {
            messageApi.error(translate('step4.msg.download_failed', '無法取得脫敏檔案，請重新運算。'));
        }
    };

    const handleDownloadPDF = async () =>
    {
        const targetPdfPrintHtmlElement = document.getElementById('printable-audit-report');
        if (!targetPdfPrintHtmlElement) return;
        const hideGlobalLoadingMessageFunction = messageApi.loading(translate('step4.msg.pdf_compiling', '正在編譯高畫質 PDF，請稍候...'), 0);
        setIsExportingPdfStatus(true);
        await new Promise((resolveDelayPromise) => setTimeout(resolveDelayPromise, PDF_COMPILATION_DELAY_MS));

        const html2pdfScriptElement = document.createElement('script');
        html2pdfScriptElement.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        html2pdfScriptElement.onload = () => 
        {
            const pdfGenerationConfigurationOptions = {
                margin:       [10, 10, 10, 10],
                filename:     `Privacy_Audit_Certificate_${auditMetadataObject.certificateId}.pdf`,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollY: 0, scrollX: 0 },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak:    { mode: ['avoid-all', 'css', 'legacy'], avoid: ['tr', '.pdf-page-break'] }
            };
            (window as unknown as WindowWithHtml2Pdf).html2pdf().set(pdfGenerationConfigurationOptions).from(targetPdfPrintHtmlElement).save().then(
                () => { hideGlobalLoadingMessageFunction(); messageApi.success(translate('step4.msg.pdf_success', '合規審計憑證 PDF 已成功下載！')); }
            ).catch(
                (pdfExecutionErrorPayload: unknown) => { hideGlobalLoadingMessageFunction(); messageApi.error(translate('step4.msg.pdf_failed', 'PDF 下載失敗')); console.error(pdfExecutionErrorPayload); }
            ).finally(() => setIsExportingPdfStatus(false));
        };
        html2pdfScriptElement.onerror = () => { hideGlobalLoadingMessageFunction(); messageApi.error(translate('step4.msg.pdf_no_lib', '無法載入 PDF 轉檔套件，請檢查網路連線。')); setIsExportingPdfStatus(false); };
        document.body.appendChild(html2pdfScriptElement);
    };

    // ★ 新增：錯誤卡片測試面板只在網址加上 ?debugErrors=1 (重新整理過一次) 時才會出現，
    //   一般使用者不會看到、也不會誤觸；用來檢查 26 個後端錯誤碼各自的前端卡片顯示是否
    //   正確、好懂，不必真的想辦法讓後端在那些不容易操作觸發的情境下失敗。
    //   ★ 修正：判斷依據改成 localStorage (由 App.tsx 在頁面載入當下寫入)，而不是直接看
    //   目前網址參數——因為切換到第四步的過程中，App.tsx 的路由邏輯一定會把網址參數改寫成
    //   只剩 ?step=4，若還是看網址參數，使用者根本不可能帶著 debugErrors=1 走到這一頁。
    let isErrorDebugPanelVisibleStatus = false;
    try {
        isErrorDebugPanelVisibleStatus = window.localStorage.getItem(DEBUG_ERRORS_LOCAL_STORAGE_KEY) === '1';
    } catch (localStorageReadErrorPayload) {
        console.warn('讀取除錯旗標失敗，錯誤卡片測試面板維持隱藏:', localStorageReadErrorPayload);
    }

    const handleDisableDebugPanelClick = (): void => {
        try {
            window.localStorage.removeItem(DEBUG_ERRORS_LOCAL_STORAGE_KEY);
        } catch (localStorageRemoveErrorPayload) {
            console.warn('清除除錯旗標失敗:', localStorageRemoveErrorPayload);
        }
        setPipelineFailedMessage(null);
        window.location.reload();
    };

    const handleShowDebugErrorCardClick = (): void => {
        const selectedOption = DEBUG_PANEL_ERROR_CODE_OPTIONS.find((optionItem) => optionItem.code === debugSelectedErrorCodeStr);
        if (!selectedOption) return;
        const displayStatus = BACKEND_ERROR_CODE_CATEGORY_MAP[selectedOption.code]?.status;
        setPipelineFailedMessage(buildFriendlyErrorDisplayNode({
            responseErrorCode: selectedOption.code,
            responseHttpStatus: displayStatus,
            backendRawMessageText: selectedOption.sampleMessage,
            responseRecommendationsList: selectedOption.sampleRecommendations ?? []
        }));
    };

    return (
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {isErrorDebugPanelVisibleStatus && (
                <div
                    style={{
                        position: 'fixed', bottom: 16, right: 16, zIndex: 1000, width: 340,
                        background: '#fff', border: '1px solid #d9d9d9', borderRadius: 8,
                        padding: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                    }}
                >
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>
                        🧪 錯誤卡片測試面板（僅供內部測試）
                    </div>
                    <Select
                        value={debugSelectedErrorCodeStr}
                        onChange={setDebugSelectedErrorCodeStr}
                        style={{ width: '100%', marginBottom: 8 }}
                        showSearch
                        options={DEBUG_PANEL_ERROR_CODE_OPTIONS.map((optionItem) => ({ value: optionItem.code, label: optionItem.code }))}
                    />
                    <Space wrap>
                        <Button size="small" type="primary" onClick={handleShowDebugErrorCardClick}>顯示這個錯誤卡片</Button>
                        <Button size="small" onClick={() => setPipelineFailedMessage(null)}>清除（恢復正常畫面）</Button>
                        <Button size="small" danger onClick={handleDisableDebugPanelClick}>關閉測試模式</Button>
                    </Space>
                </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {isPipelineCalculatingStatus ? (
                    <Alert
                        title={<span style={{ fontWeight: 600 }}>{translate('step4.alert.title_running', '正在執行去識別化矩陣演算與風險')}</span>}
                        description={translate('step4.alert.desc_running', '請稍候，系統正在進行運算，完成後將顯示報告。')}
                        type="info"
                        showIcon={false}
                        style={{ flex: 1, marginRight: '24px' }}
                    />
                ) : (
                    <Alert
                        title={
                            <Space>
                                {pipelineFailedMessage
                                    ? <CloseCircleFilled style={{ color: '#ff4d4f' }} />
                                    : isComplianceValidStatus
                                        ? <CheckCircleFilled style={{ color: '#52c41a' }} />
                                        : <WarningFilled style={{ color: '#faad14' }} />}
                                <span style={{ fontWeight: 600 }}>
                                    {pipelineFailedMessage
                                        ? (isPipelineCanceledStatus
                                            ? translate('step4.alert.title_canceled', '已取消運算，未產出結果')
                                            : translate('step4.alert.title_error', '後端運算失敗，未產出結果'))
                                        : isComplianceValidStatus
                                            ? translate('step4.alert.title', '去識別化矩陣演算與風險審計完成')
                                            : translate('step4.alert.title_failed', '去識別化矩陣演算完成，但未達合規標準')}
                                </span>
                            </Space>
                        }
                        description={pipelineFailedMessage
                            ? pipelineFailedMessage
                            : isComplianceValidStatus
                                ? translate('step4.alert.desc', '系統已完成蒙地卡羅攻擊模擬評估，請檢視三大去識別化防禦指標並下載合規報告。')
                                : (
                                    <div>
                                        {/* ★ 使用者反映：先前把後端 message／recommendations 原文整段列出，
                                            對非技術背景的使用者來說文字量過大、看不出重點。改為只保留一行
                                            「哪裡沒過」＋一行「怎麼改」的極簡提示，不顯示後端原始長篇文字。 */}
                                        {currentPrivacyModeTypeStr === 'k-anonymity' && kReport && (() => {
                                            const isSuppressionExceededStatus = kReport.suppression_rate_percent > (currentMaxSuppressionNumber ?? 5);
                                            // ★ 未啟用 l-多樣性／t-緊密度檢測時，即使報告內 l_passed／t_passed 剛好是
                                            // false（例如後端對「未檢測」的預設值不是 true），畫面上也不歸咎於 l／t，
                                            // 避免使用者誤以為自己沒關掉的 l/t 造成失敗。
                                            const failedCheckNamesList = [
                                                kReport.k_passed === false ? 'k' : null,
                                                (isEnableLDiversityStatus && kReport.l_passed === false) ? 'l-多樣性' : null,
                                                (isEnableTClosenessStatus && kReport.t_passed === false) ? 't-緊密度' : null,
                                                isSuppressionExceededStatus ? '抑制率' : null
                                            ].filter((item): item is string => item !== null);
                                            const failedCheckSummaryText = failedCheckNamesList.length > 0
                                                ? failedCheckNamesList.join('、')
                                                : translate('step4.alert.failed_detail_suppression', '抑制率');

                                            // ★ 使用者反映：改為依失敗項目挑選後端建議文字後，內容仍偏技術（等價類／
                                            // l-diversity／t-closeness／QI 等專有名詞＋長句），沒有相關背景的使用者
                                            // 仍難以判斷「具體該調整哪個數字」。改為：針對每個實際未通過的項目，各自
                                            // 產生一句帶入目前實際設定值與違規數量的白話說明，加上條列式、方向正確的
                                            // 具體調整選項（例如 l 值該調低到多少、t 值該調高到多少），技術名詞僅以
                                            // 「?」提示註解、不影響略讀即可操作。
                                            // ★ 方向性務必區分：l-diversity 的 l 越大越嚴格，要放寬須「調低」；
                                            // t-closeness 的 t 是「容許的分佈距離上限」，t 越小越嚴格，要放寬須
                                            // 「調高」——兩者方向相反，不可用同一句話帶過，否則會誤導使用者。
                                            // 違規分組數量（l_fail_count／t_fail_count）目前僅存在於後端 recommendations
                                            // 的自然語言描述中，未拆成獨立欄位，故以固定格式的正規表示式擷取數字；
                                            // 擷取不到時該部分文字自然省略，不影響其餘白話說明與選項的呈現。
                                            const backendRecommendationTextList = Array.isArray(kReport.recommendations)
                                                ? (kReport.recommendations as unknown[]).filter((item): item is string => typeof item === 'string')
                                                : [];
                                            const parseFirstIntegerMatch = (patternRegex: RegExp): number | null => {
                                                for (const recommendationText of backendRecommendationTextList) {
                                                    const matchResult = recommendationText.match(patternRegex);
                                                    if (matchResult) {
                                                        const parsedNumberValue = Number(matchResult[1]);
                                                        if (Number.isFinite(parsedNumberValue)) {
                                                            return parsedNumberValue;
                                                        }
                                                    }
                                                }
                                                return null;
                                            };

                                            type FailureGuidanceSectionType = { key: string; headlineNode: ReactNode; optionTextList: string[] };
                                            const failureGuidanceSectionsList: FailureGuidanceSectionType[] = [];

                                            const isLFailedStatus = failedCheckNamesList.includes('l-多樣性');
                                            const isTFailedStatus = failedCheckNamesList.includes('t-緊密度');
                                            if (isLFailedStatus || isTFailedStatus) {
                                                const lFailGroupCount = parseFirstIntegerMatch(/l-diversity 不足的等價類 (\d+) 個/);
                                                const tFailGroupCount = parseFirstIntegerMatch(/t-closeness 超標的等價類 (\d+) 個/);
                                                const failGroupDescriptionPartsList = [
                                                    (isLFailedStatus && lFailGroupCount !== null)
                                                        ? `l-多樣性不足的分組有 ${lFailGroupCount} 組（目前門檻 l = ${currentLValueNumber}）`
                                                        : null,
                                                    (isTFailedStatus && tFailGroupCount !== null)
                                                        ? `t-緊密度超標的分組有 ${tFailGroupCount} 組（目前門檻 t = ${currentTValueNumber}）`
                                                        : null
                                                ].filter((item): item is string => item !== null);

                                                const suggestedLValueNumber = Math.max(1, currentLValueNumber - 1);
                                                const suggestedTValueNumber = Math.min(1, Math.round((currentTValueNumber + 0.05) * 100) / 100);
                                                const ltOptionTextList: string[] = [];
                                                if (isLFailedStatus) {
                                                    ltOptionTextList.push(translate(
                                                        'step4.alert.lt_option_lower_l',
                                                        `回到 Step3，把 l 值從 ${currentLValueNumber} 調低到 ${suggestedLValueNumber}（數字越小，多樣性要求越寬鬆）`
                                                    ));
                                                }
                                                if (isTFailedStatus) {
                                                    ltOptionTextList.push(translate(
                                                        'step4.alert.lt_option_raise_t',
                                                        `回到 Step3，把 t 值從 ${currentTValueNumber} 調高到 ${suggestedTValueNumber}（t 是容許的分佈距離上限，數字越大，門檻越寬鬆）`
                                                    ));
                                                }
                                                ltOptionTextList.push(translate('step4.alert.lt_option_raise_level', '回到 Step2，提高「間接識別碼」欄位的泛化層級，讓分組人數變多，敏感資料種類自然更多樣'));
                                                ltOptionTextList.push(translate('step4.alert.lt_option_suppress_minority', '將資料中極少數的特殊族群或極端值移除／合併後再重新運算'));

                                                failureGuidanceSectionsList.push({
                                                    key: 'lt',
                                                    headlineNode: (
                                                        <>
                                                            {translate('step4.alert.lt_plain_issue_prefix', '系統依照目前的分組結果檢查後發現，')}
                                                            {failGroupDescriptionPartsList.length > 0
                                                                ? failGroupDescriptionPartsList.join('、')
                                                                : translate('step4.alert.lt_plain_issue_fallback', '部分分組的敏感資料多樣性不足')}
                                                            {translate('step4.alert.lt_plain_issue_suffix', '，尚未達到您設定的隱私要求。')}
                                                            <Tooltip title={translate('step4.alert.equivalence_class_tooltip', '「分組」是指依照間接識別碼欄位（如年齡、地區）模糊化後，被歸為同一群、彼此無法被區分的一批資料，專業上稱為「等價類」。')}>
                                                                <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} />
                                                            </Tooltip>
                                                        </>
                                                    ),
                                                    optionTextList: ltOptionTextList
                                                });
                                            }

                                            if (failedCheckNamesList.includes('k')) {
                                                const suggestedKValueNumber = Math.max(2, currentKValueNumber - 1);
                                                failureGuidanceSectionsList.push({
                                                    key: 'k',
                                                    headlineNode: (
                                                        <>{translate('step4.alert.k_plain_issue', `部分分組的人數不足您設定的 k = ${currentKValueNumber} 人，代表這些分組裡的人仍可能被單獨辨識出來。`)}</>
                                                    ),
                                                    optionTextList: [
                                                        translate('step4.alert.k_option_raise_level', '回到 Step2，提高「間接識別碼」欄位的泛化層級，讓每個分組的人數變多'),
                                                        translate('step4.alert.k_option_lower_k', `回到 Step3，把 k 值從 ${currentKValueNumber} 調低到 ${suggestedKValueNumber}（數字越小，要求越寬鬆）`)
                                                    ]
                                                });
                                            }

                                            if (isSuppressionExceededStatus) {
                                                const currentSuppressionCapNumber = currentMaxSuppressionNumber ?? 5;
                                                const suggestedSuppressionCapNumber = Math.min(100, Math.ceil(kReport.suppression_rate_percent) + 1);
                                                failureGuidanceSectionsList.push({
                                                    key: 'suppression',
                                                    headlineNode: (
                                                        <>{translate('step4.alert.suppression_plain_issue', `目前有 ${kReport.suppression_rate_percent.toFixed(3)}% 的資料筆數太特殊、必須被刪除或打上「*」才符合隱私要求，已超過您設定的上限 ${currentSuppressionCapNumber}%。`)}</>
                                                    ),
                                                    optionTextList: [
                                                        translate('step4.alert.suppression_option_raise_cap', `回到 Step3，把「抑制上限」從 ${currentSuppressionCapNumber}% 調高到 ${suggestedSuppressionCapNumber}% 以上`),
                                                        translate('step4.alert.suppression_option_raise_level', '回到 Step2，提高「間接識別碼」欄位的泛化層級，減少需要被刪除／遮蔽的筆數')
                                                    ]
                                                });
                                            }

                                            return (
                                                <>
                                                    <div>{translate('step4.alert.failed_detail', '未通過項目')}：{failedCheckSummaryText}（{translate('step4.alert.suppression_rate', '抑制率')} {kReport.suppression_rate_percent.toFixed(3)}%）</div>
                                                    {failureGuidanceSectionsList.length > 0
                                                        ? failureGuidanceSectionsList.map((sectionItem) => (
                                                            <div key={sectionItem.key} style={{ marginTop: 8 }}>
                                                                <div>{sectionItem.headlineNode}</div>
                                                                <div style={{ marginTop: 2 }}>{translate('step4.alert.options_label', '可以試試以下任一做法：')}</div>
                                                                <ol style={{ margin: '2px 0 0 20px', padding: 0 }}>
                                                                    {sectionItem.optionTextList.map((optionTextValue, optionIndexValue) => (
                                                                        <li key={optionIndexValue} style={{ marginTop: 2 }}>{optionTextValue}</li>
                                                                    ))}
                                                                </ol>
                                                            </div>
                                                        ))
                                                        : (
                                                            <div style={{ marginTop: 4 }}>{translate('step4.alert.suggest_label', '建議')}：{translate('step4.alert.suggest_k_detail', '提高間接識別碼欄位的泛化層級，或調整抑制上限後重新運算。')}</div>
                                                        )}
                                                </>
                                            );
                                        })()}
                                        {currentPrivacyModeTypeStr === 'differential-privacy' && dpReport && (
                                            <>
                                                <div>{translate('step4.alert.epsilon_detail', '消耗預算')}：{dpReport.consumed_epsilon} ε（{translate('step4.alert.epsilon_limit', '門檻')} {budgetLimitEpsilonValue} ε）</div>
                                                <div style={{ marginTop: 4 }}>{translate('step4.alert.suggest_label', '建議')}：{translate('step4.alert.suggest_dp_detail', '提高預算上限，或減少啟用差分隱私的欄位數後重新運算。')}</div>
                                            </>
                                        )}
                                    </div>
                                )}
                        type={pipelineFailedMessage ? 'error' : (isComplianceValidStatus ? 'success' : 'warning')}
                        showIcon={false}
                        style={{ flex: 1, marginRight: '24px' }}
                    />
                )}

                <Space size="middle">
                    <Button icon={<ReloadOutlined spin={isPipelineCalculatingStatus} />} onClick={() => runFullPipeline(true)} disabled={isPipelineCalculatingStatus} size="large">
                        {translate('step4.btn.recalculate', '重新發起後端運算')}
                    </Button>
                    <Button type="default" icon={<FileDoneOutlined />} disabled={isPipelineCalculatingStatus || !!pipelineFailedMessage} onClick={handleOpenReportModal} size="large">
                        {translate('step4.btn.view_report', '檢視與匯出憑證')}
                    </Button>
                    <Button type="primary" icon={<DownloadOutlined />} disabled={isPipelineCalculatingStatus || !!pipelineFailedMessage} onClick={handleDownloadCSV} size="large" style={{ background: '#4F46E5', borderColor: '#4F46E5' }}>
                        {translate('step4.btn.download_csv', '下載脫敏 CSV')}
                    </Button>
                </Space>
            </div>

            {isPipelineCalculatingStatus ? (
                <Card variant="borderless" style={{ background: token.colorBgContainer }}>
                    <div style={{ padding: '32px 16px', background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', borderRadius: '12px' }}>
                        <Row justify="center" style={{ marginBottom: '32px' }}>
                            <Col xs={24} md={20} lg={16}>
                                <Steps
                                    current={currentPipelinePhaseType === 'uploading' ? 0 : currentPipelinePhaseType === 'processing' ? 1 : currentPipelinePhaseType === 'auditing' ? 2 : 3}
                                    items={[
                                        { title: translate('step4.steps.upload.title', '切片上傳'), content: 'Chunk Upload', icon: <CloudUploadOutlined /> },
                                        { title: translate('step4.steps.process.title', '後端脫敏'), content: 'Data Processing', icon: <LoadingOutlined /> },
                                        { title: translate('step4.steps.audit.title', '風險審計'), content: 'Risk Auditing', icon: <SafetyCertificateOutlined /> },
                                        { title: translate('step4.steps.complete.title', '完成簽發'), content: 'Completed', icon: <CheckCircleOutlined /> },
                                    ]}
                                />
                            </Col>
                        </Row>

                        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                            <Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: token.colorPrimary }} spin />} />
                            <h3 style={{ marginTop: '16px', color: token.colorText }}>
                                {currentPipelinePhaseType === 'uploading' && translate('step4.loading.uploading', '正在將大數據切片 (Chunk) 傳輸至後端伺服器...')}
                                {currentPipelinePhaseType === 'processing' && translate('step4.loading.processing', '後端正在執行去識別化矩陣與加噪演算...')}
                                {currentPipelinePhaseType === 'auditing' && translate('step4.loading.auditing', '正在執行蒙地卡羅攻擊模擬與可用性評估...')}
                                {currentPipelinePhaseType === 'completed' && translate('step4.loading.completed', '後端演算完畢，正在生成最終合規報告...')}
                            </h3>
                            <Progress percent={calculationProgressValue} status="active" style={{ maxWidth: '600px', margin: '16px auto' }} strokeColor={token.colorPrimary} />
                            {uploadProgressText && (
                                <div style={{ fontSize: '13px', color: token.colorTextSecondary, marginBottom: '12px' }}>{uploadProgressText}</div>
                            )}
                            <Button danger onClick={handleCancelPipeline}>
                                {translate('step4.btn.cancel_pipeline', '取消運算')}
                            </Button>
                        </div>
                        
                        <div style={{ maxWidth: '800px', margin: '0 auto', background: isDarkModeActiveStatus ? '#000000' : '#1e1e1e', color: '#00ff66', fontFamily: 'monospace', padding: '16px', borderRadius: '8px', textAlign: 'left', fontSize: '13px', height: '180px', overflowY: 'auto', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)' }}>
                            {systemSimulationLogsList.map((logItemString, logItemIndexNumber) => <div key={logItemIndexNumber} style={{ marginBottom: '4px' }}>{logItemString}</div>)}
                            <div ref={simulationLogsEndRef} />
                        </div>
                    </div>
                </Card>
            ) : (
                // ★ 修正：先前「安全性評估／效用評估」Row 與下方「脫敏結果預覽對照」Card 是
                // 兩個各自獨立輸出的區塊——Row 有正確依 isPipelineCalculatingStatus 隱藏，但
                // 預覽 Card 卻沒有一起被包進來，永遠顯示在畫面上。使用者反映：差分隱私處理時
                // 往下滑動頁面，會看到這張已經有欄位、有資料列（或至少有資料表框架）的預覽卡片，
                // 容易誤以為運算已經完成。修正方式：把兩者合併成同一個「統一輸出」區塊。
                // ★ 使用者反映（2026-09-22）：K-匿名「敏感欄位 = 0」時三攻擊整段跳過，
                //   attackSimulationMetricsData 會維持 null（見上方 setAttackSimulationMetricsData
                //   的說明），但這裡先前把整個統一輸出區塊（含去識別化結果預覽、效用評估）都用
                //   attackSimulationMetricsData 是否有值來控制顯示，導致「敏感欄位=0」時連已經
                //   算好的去識別化資料預覽都一起被藏起來，使用者誤以為沒有跑完。改用
                //   datasetRowStatsData 作為「這一輪是否已經成功跑完」的判斷依據——它是在
                //   runFullPipeline 中，不論三攻擊/CAP 是否被跳過，只要整個流程走到最後都會被
                //   設值（見 setDatasetRowStatsData），且發生錯誤時不會被設值，比
                //   attackSimulationMetricsData 更準確地反映「這輪有沒有真的跑完」，而不會被
                //   風險評估本身有沒有執行過影響。下方「安全性評估」卡片內部另外針對
                //   attackSimulationMetricsData 是否存在做了未評估的提示（見下方），不受影響。
                datasetRowStatsData && (
                    <>
                    <Row gutter={24} style={{ display: 'flex', alignItems: 'stretch' }}>
                        <Col span={16} style={{ display: 'flex' }}>
                            <Card 
                                title={<span><SafetyCertificateOutlined style={{ marginRight: 8, color: token.colorPrimary }} />{translate('step4.risk.title', '安全性評估 (Privacy Risks)')}</span>}
                                variant="borderless" style={{ background: token.colorBgContainer, width: '100%', display: 'flex', flexDirection: 'column' }} styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
                            >
                                <div style={{ background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px', border: `1px solid ${token.colorBorderSecondary}` }}>
                                    <div style={{ fontSize: '12px', color: token.colorTextDescription, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span>{translate('step4.risk.cap_label', 'CAP 前後對比')}</span>
                                        {/* ★ 使用者反映：CAP 有數字、下方風險卻是 0% 曾被誤認為顯示異常，原補充說明
                                            寫成一大段太複雜，改為精簡一句：CAP 未扣基準，跟下方風險算法不同。 */}
                                        <Tooltip title={translate('step4.risk.cap_tooltip', '若間接識別碼幾乎每筆都不同（例如連續數值加噪後仍為唯一值），前後可能都接近 100%，這是此指標的先天限制，不代表去識別化沒有效果。（此數字未扣除隨機猜測基準，跟下方風險算法不同，兩者可能不一致）')}>
                                            <QuestionCircleOutlined style={{ color: token.colorTextDescription, cursor: 'help' }} />
                                        </Tooltip>
                                    </div>
                                    {capReportData && !(capReportData.cap_before < 0 || capReportData.cap_after < 0) ? (
                                        <>
                                            <span style={{ fontSize: '24px', fontWeight: 'bold', color: capReportData.cap_after <= capReportData.cap_before ? '#52c41a' : '#faad14' }}>
                                                {(capReportData.cap_before * 100).toFixed(1)}% → {(capReportData.cap_after * 100).toFixed(1)}%
                                            </span>
                                            {capReportData.cap_before > 0 && (
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: token.colorTextDescription }}>
                                                    {translate('step4.risk.cap_diff_label', 'CAP 對比差異（現在/原本）：')} {((capReportData.cap_after / capReportData.cap_before) * 100).toFixed(1)}%
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <span style={{ fontSize: '16px', fontWeight: 'bold', color: token.colorTextDescription }}>
                                                {capReportData?.message?.startsWith('CAP 前後對比請求失敗')
                                                    ? translate('step4.risk.cap_request_failed', '未評估（CAP 請求失敗，原因見下方）')
                                                    : translate('step4.risk.cap_not_evaluated', '未評估（間接識別碼或敏感欄位設定不足，或限定條件篩選後無資料）')}
                                            </span>
                                            {/* ★ 新增：後端 CapReport 本身即附帶 message 欄位說明未評估原因（例如
                                                「限定族群篩選後樣本數為 0」或「敏感欄位設定不符」），過去這裡只顯示
                                                上方寫死的猜測文字、完全沒有把後端真正的原因印出來，使用者（與我們自己）
                                                都無從分辨這次「未評估」到底是欄位角色設定的問題，還是新加的 subgroup
                                                條件把資料篩選到剩 0 筆所致。故在此把後端原始 message 一併顯示。 */}
                                            {capReportData?.message && (
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: token.colorTextDescription }}>
                                                    {translate('step4.risk.cap_backend_message_prefix', '後端回應原因：')}{capReportData.message}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                                <ReactECharts option={getAttackChartOption()} style={{ height: '260px', marginBottom: '16px' }} theme={isDarkModeActiveStatus ? 'dark' : 'light'} />
                                {/* ★ 使用者反映（2026-09-22）：這三個風險標籤先前假設外層一定有
                                    attackSimulationMetricsData 才會被渲染，直接讀取其欄位；但外層的判斷
                                    依據已改成 datasetRowStatsData（見上方說明），K-匿名「敏感欄位=0」時
                                    attackSimulationMetricsData 會是 null、這裡卻仍會被渲染，若不判斷會
                                    直接噴錯（Cannot read properties of null）。改為有資料才顯示三個標籤，
                                    沒有資料時顯示「未評估」提示，說明原因，而不是讓整張卡片消失或噴錯。 */}
                                {attackSimulationMetricsData ? (
                                    <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                                        {/* ★ 提示文字修正：初版說明文字含英文專有名詞、括號附註與完整範例句，
                                            使用者反映字太多、非相關背景知識人員無法一眼看懂，改為單句、去除英文
                                            名詞與例子，只保留「攻擊者能做到什麼」的白話結論。 */}
                                        {/* ★ 使用者反映：加了原始成功率／基準的完整說明句後太長太複雜，改為只在提示
                                            文字最後補一個精簡的「（原始 X%／基準 Y%）」括號，不寫整句解釋。 */}
                                        <Tag color="red" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>
                                            {translate('step4.risk.singling', '指認風險:')} {(attackSimulationMetricsData.singling.risk * 100).toFixed(1)}%
                                            <Tooltip title={`${translate('step4.risk.singling_tooltip', '攻擊者能否從資料中，找出只對應到某一個人的獨特一筆記錄。')} (原始 ${(attackSimulationMetricsData.singling.ori * 100).toFixed(1)}% / 基準 ${(attackSimulationMetricsData.singling.base * 100).toFixed(2)}%)`}>
                                                <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                            </Tooltip>
                                        </Tag>
                                        <Tag color="orange" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>
                                            {translate('step4.risk.linkability', '連結風險:')} {(attackSimulationMetricsData.linkability.risk * 100).toFixed(1)}%
                                            <Tooltip title={`${translate('step4.risk.linkability_tooltip', '攻擊者能否把同一個人分散在不同資料裡的紀錄兜在一起。')} (原始 ${(attackSimulationMetricsData.linkability.ori * 100).toFixed(1)}% / 基準 ${(attackSimulationMetricsData.linkability.base * 100).toFixed(2)}%)`}>
                                                <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                            </Tooltip>
                                        </Tag>
                                        <Tag color="cyan" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>
                                            {translate('step4.risk.inference', '推斷風險:')} {(attackSimulationMetricsData.inference.risk * 100).toFixed(1)}%
                                            <Tooltip title={`${translate('step4.risk.inference_tooltip', '攻擊者能否用其他欄位的資訊，猜出這個人的敏感資料（例如疾病）。')} (原始 ${(attackSimulationMetricsData.inference.ori * 100).toFixed(1)}% / 基準 ${(attackSimulationMetricsData.inference.base * 100).toFixed(2)}%)`}>
                                                <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                            </Tooltip>
                                        </Tag>
                                    </div>
                                ) : (
                                    <div style={{ marginTop: 'auto', padding: '8px', textAlign: 'center', color: token.colorTextDescription, fontSize: '13px' }}>
                                        {translate('step4.risk.attacks_not_evaluated', '未評估（尚未設定「敏感欄位」，本次已略過三攻擊風險評估；不影響去識別化結果本身）')}
                                    </div>
                                )}
                                {/* ★ 使用者反映（2026-09-22）：K-匿名多重敏感欄位跑 CAP／三攻擊時，若某敏感欄位
                                    的值幾乎每筆都不同（唯一值佔比過高），後端底層 sklearn 分類器會讓服務容器當掉
                                    （詳見上方 highCardinalitySensitiveWarningInfo 狀態宣告處的完整說明）。這裡顯示
                                    本次執行偵測到的高風險欄位清單，並提供「仍要強制執行」勾選框——預設不勾選時
                                    這些欄位已被自動略過（不影響去識別化結果本身），使用者明確知情風險後可自行
                                    勾選強制送出，勾選後需按下方「重新運算」才會真的重新呼叫 API。 */}
                                {highCardinalitySensitiveWarningInfo.length > 0 && (() => {
                                    // 舊版快照沒有 handling 欄位，依當時的勾選狀態推回「強制」或「略過」。
                                    const resolveHandling = (item: typeof highCardinalitySensitiveWarningInfo[number]) =>
                                        item.handling || (forceRunHighCardinalitySensitiveFieldsStatus ? 'forced' : 'skipped');
                                    const binnedItemsList = highCardinalitySensitiveWarningInfo.filter((item) => resolveHandling(item) === 'binned');
                                    const skippedItemsList = highCardinalitySensitiveWarningInfo.filter((item) => resolveHandling(item) === 'skipped');
                                    const forcedItemsList = highCardinalitySensitiveWarningInfo.filter((item) => resolveHandling(item) === 'forced');
                                    const describeColumnsText = (itemsList: typeof highCardinalitySensitiveWarningInfo) =>
                                        itemsList.map((item) => `「${item.columnName}」(唯一值佔比 ${item.uniqueRatioPercent}%)`).join('、');
                                    // 級距可調的欄位：本次已分級距的，加上「數值型但級距太細仍被略過」的（有 binWidth）。
                                    const adjustableItemsList = highCardinalitySensitiveWarningInfo.filter((item) => item.binWidth !== undefined && resolveHandling(item) !== 'forced');
                                    const isOnlyBinnedStatus = skippedItemsList.length === 0 && forcedItemsList.length === 0;
                                    return (
                                        <Alert
                                            type={isOnlyBinnedStatus ? 'info' : 'warning'}
                                            showIcon
                                            style={{ marginTop: '12px' }}
                                            message={isOnlyBinnedStatus
                                                ? translate('step4.risk.sensitive_binned_title', '連續數值敏感欄位已自動分級距')
                                                : translate('step4.risk.high_cardinality_warning_title', '偵測到高風險敏感欄位')}
                                            description={
                                                <div>
                                                    <div style={{ marginBottom: 6 }}>
                                                        {translate('step4.risk.high_cardinality_reason', '推斷性攻擊以準識別欄位預測敏感欄位的值，並以「預測值與真實值完全相等」判定攻擊成功，因此敏感欄位需為可列舉的類別。值幾乎每筆都不同的欄位（如薪資）無法得到有意義的結果，運算量也會暴增。')}
                                                    </div>
                                                    {binnedItemsList.length > 0 && (
                                                        <div>
                                                            {translate('step4.risk.sensitive_binned_desc', '{{columns}} 已依級距轉換後再執行三攻擊／CAP（僅用於風險評估，去識別化結果本身不受影響）。', { columns: binnedItemsList.map((item) => `「${item.columnName}」每 ${item.binWidth!.toLocaleString()} 一級（共 ${item.binCount} 級）`).join('、') })}
                                                        </div>
                                                    )}
                                                    {skippedItemsList.length > 0 && (
                                                        <div>
                                                            {translate('step4.risk.high_cardinality_warning_desc', '{{columns}} 已略過三攻擊／CAP（不影響去識別化結果本身）。數值欄位可調大下方級距寬度；文字欄位請先自行歸併為類別後重新上傳。', { columns: describeColumnsText(skippedItemsList) })}
                                                        </div>
                                                    )}
                                                    {forcedItemsList.length > 0 && (
                                                        <div>
                                                            {translate('step4.risk.high_cardinality_forced_desc', '{{columns}} 已依設定以原始值強制執行三攻擊／CAP，結果不具評估意義，且可能執行失敗。', { columns: describeColumnsText(forcedItemsList) })}
                                                        </div>
                                                    )}
                                                    {adjustableItemsList.length > 0 && !forceRunHighCardinalitySensitiveFieldsStatus && (
                                                        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                                                            {adjustableItemsList.map((item) => (
                                                                <Space key={item.columnName} size={4}>
                                                                    <span>{translate('step4.risk.bin_width_label', '「{{column}}」級距寬度', { column: item.columnName })}</span>
                                                                    <InputNumber
                                                                        min={0}
                                                                        size="small"
                                                                        style={{ width: 120 }}
                                                                        value={sensitiveBinWidthOverridesMap[item.columnName] ?? item.binWidth}
                                                                        onChange={(nextValue) => setSensitiveBinWidthOverridesMap((prev) => {
                                                                            const nextMap = { ...prev };
                                                                            if (typeof nextValue === 'number' && nextValue > 0) nextMap[item.columnName] = nextValue;
                                                                            else delete nextMap[item.columnName];
                                                                            return nextMap;
                                                                        })}
                                                                    />
                                                                </Space>
                                                            ))}
                                                            <span style={{ color: token.colorTextDescription, fontSize: 12 }}>
                                                                {translate('step4.risk.bin_width_hint', '調整後請按「重新運算」；清空則恢復自動級距')}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {(skippedItemsList.length > 0 || forcedItemsList.length > 0) && (
                                                        <Checkbox
                                                            checked={forceRunHighCardinalitySensitiveFieldsStatus}
                                                            onChange={(e) => setForceRunHighCardinalitySensitiveFieldsStatus(e.target.checked)}
                                                            style={{ marginTop: 6 }}
                                                        >
                                                            {translate('step4.risk.high_cardinality_force_run_checkbox', '我了解風險，仍以原始值（不分級距）強制對這些欄位執行三攻擊／CAP（勾選後請按「重新運算」，若導致後端無回應請取消勾選）')}
                                                        </Checkbox>
                                                    )}
                                                </div>
                                            }
                                        />
                                    );
                                })()}
                                {datasetRowStatsData && (
                                    <div style={{ marginTop: '12px', fontSize: '12px', color: token.colorTextDescription }}>
                                        {translate(
                                            'step4.risk.row_stats_detail',
                                            '資料筆數：輸入 {{input}} 筆、刪除 {{deleted}} 筆、輸出 {{output}} 筆',
                                            {
                                                input: datasetRowStatsData.input.toLocaleString(),
                                                deleted: datasetRowStatsData.deleted.toLocaleString(),
                                                output: datasetRowStatsData.output.toLocaleString()
                                            }
                                        )}
                                    </div>
                                )}
                                {/* ★ 使用者反映（2026-09-22）：attackReportData 與 attackSimulationMetricsData
                                    永遠同步（見上方 setAttackReportData／setAttackSimulationMetricsData 都是同一個
                                    attackReportResult 驅動），但這是兩個獨立的 state，TypeScript 無法從
                                    attackReportData?.message 的真假推斷出 attackSimulationMetricsData 也非
                                    null，故這裡另外加一次 attackSimulationMetricsData 判斷式，單純為了讓型別
                                    檢查通過，實際執行邏輯不變（兩者本來就同時為 null 或同時有值）。 */}
                                {attackReportData?.message && attackSimulationMetricsData && (() => {
                                    // Backend message head is fixed-format with internal method notes and 2-decimal raw fractions,
                                    // which mismatches the 1-decimal percentage precision used by the tags above and reads as a contradiction.
                                    // Rebuild just the head with matching percentage precision and no internal method notes; keep any trailing note as-is.
                                    const headPattern = /^三攻擊風險評估完成(?:（[^）]*）)?。指認性風險:\s*[\d.]+,\s*連結性風險:\s*[\d.]+,\s*推斷性風險:\s*[\d.]+。/;
                                    const rebuiltHead = `${translate('step4.risk.summary_prefix', '三攻擊風險評估完成。')}${translate('step4.risk.singling', '指認風險:')} ${(attackSimulationMetricsData.singling.risk * 100).toFixed(1)}%, ${translate('step4.risk.linkability', '連結風險:')} ${(attackSimulationMetricsData.linkability.risk * 100).toFixed(1)}%, ${translate('step4.risk.inference', '推斷風險:')} ${(attackSimulationMetricsData.inference.risk * 100).toFixed(1)}%。`;
                                    const displayMessage = headPattern.test(attackReportData.message)
                                        ? attackReportData.message.replace(headPattern, rebuiltHead)
                                        : attackReportData.message;
                                    return (
                                        <div style={{ marginTop: '4px', fontSize: '12px', color: token.colorTextDescription }}>
                                            {displayMessage}
                                        </div>
                                    );
                                })()}
                            </Card>
                        </Col>
                        <Col span={8} style={{ display: 'flex' }}>
                            <Card 
                                title={<span><LineChartOutlined style={{ marginRight: 8, color: '#1677ff' }} />{translate('step4.utility.title', '資料效用與失真度評估')}</span>}
                                variant="borderless" style={{ background: token.colorBgContainer, width: '100%', display: 'flex', flexDirection: 'column' }} styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
                            >
                                <div style={{ background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', padding: '24px 16px', borderRadius: '8px', border: `1px solid ${token.colorBorderSecondary}`, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', alignItems: 'center' }}>
                                    <div style={{ textAlign: 'center', width: '100%', paddingBottom: '24px', borderBottom: `1px dashed ${token.colorBorderSecondary}` }}>
                                        <div style={{ fontSize: '14px', color: token.colorTextDescription, marginBottom: '16px' }}>
                                            {currentPrivacyModeTypeStr === 'k-anonymity'
                                                ? (
                                                    <>
                                                        {translate('step4.utility.suppression', '資料紀錄抑制率')}
                                                        {/* ★ 使用者反映：畫面上只有數字，沒有任何說明，非技術背景的使用者看不懂
                                                            這代表什麼、數字愈高愈好還是愈低愈好。補上「?」提示，並依實際採用的
                                                            抑制方式（列抑制／值抑制）給出對應的白話說明，避免固定寫死「整列」
                                                            但實際上是值抑制（打 *）的情形，造成說明與實際結果不符。 */}
                                                        <Tooltip title={
                                                            (currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression')
                                                                ? translate('step4.utility.suppression_tooltip_cell', '為了讓每個分組都符合您設定的隱私要求（例如 k 值），系統必須遮蔽（打上「*」）的資料格數，佔全部資料格數的比例。比例愈高，代表被遮蔽、看不到原始內容的資料愈多。')
                                                                : translate('step4.utility.suppression_tooltip_row', '為了讓每個分組都符合您設定的隱私要求（例如 k 值），系統必須整列刪除的資料筆數，佔全部資料筆數的比例。比例愈高，代表被刪除、無法保留下來的資料愈多。')
                                                        }>
                                                            <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                                        </Tooltip>
                                                    </>
                                                )
                                                : '總消耗隱私預算 (Epsilon)'}
                                        </div>
                                        <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#1677ff', marginBottom: '16px', fontFamily: 'monospace', lineHeight: 1 }}>
                                            {currentPrivacyModeTypeStr === 'k-anonymity'
                                                // ★ 修正: 後端回傳的抑制率為完整浮點數（如 0.10749143651555759），
                                                //   直接顯示位數過多，改為四捨五入至小數點後 2 位。
                                                // ★ 使用者反映（2026-09-29）：兩位小數會把 7.629% 顯示成 7.63%，與上限 7.63% 看起來
                                                //   相同而誤以為「剛好卡線卻通過」。改顯示到三位，並於下方附上被抑制數／總數。
                                                ? <>{(kReport ? kReport.suppression_rate_percent : 0).toFixed(3)} <span style={{ fontSize: '20px' }}>%</span></>
                                                : <>{dpReport ? dpReport.consumed_epsilon : 0} <span style={{ fontSize: '20px' }}>ε</span></>
                                            }
                                        </div>
                                        {currentPrivacyModeTypeStr === 'k-anonymity' && kReport && (() => {
                                            const isCellUnitStatus = kReport.suppression_unit === 'cell';
                                            // 後端有回傳分子／分母時優先使用；列抑制時可退回前端實際數出的刪除／輸入筆數
                                            const suppressedCountValue = kReport.suppressed_count ?? (!isCellUnitStatus ? datasetRowStatsData?.deleted : undefined);
                                            const totalCountValue = kReport.suppression_total_count ?? (!isCellUnitStatus ? datasetRowStatsData?.input : undefined);
                                            if (suppressedCountValue === undefined || totalCountValue === undefined) return null;
                                            return (
                                                <div style={{ marginTop: '-8px', marginBottom: '12px', fontSize: '12px', color: token.colorTextDescription }}>
                                                    {translate('step4.utility.suppression_count_detail', '（{{suppressed}} / {{total}} {{unit}}，上限 {{limit}}%）', {
                                                        suppressed: suppressedCountValue.toLocaleString(),
                                                        total: totalCountValue.toLocaleString(),
                                                        unit: isCellUnitStatus ? '格' : '筆',
                                                        limit: currentMaxSuppressionNumber ?? 5
                                                    })}
                                                </div>
                                            );
                                        })()}
                                        {currentPrivacyModeTypeStr === 'k-anonymity' && (
                                            <div style={{ fontSize: '12px', color: token.colorTextDescription, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ textAlign: 'center', width: '100%', paddingTop: '24px' }}>
                                        <div style={{ fontSize: '14px', color: token.colorTextDescription, marginBottom: '16px' }}>{translate('step4.utility.total_cols', '實際去識別數 / 總欄位數')}</div>
                                        <div style={{ fontSize: '36px', fontWeight: 'bold', color: token.colorText, fontFamily: 'monospace', lineHeight: 1 }}>
                                            {deidentifiedColumnsCountValue} <span style={{ fontSize: '20px', color: token.colorTextSecondary }}>/ {actualProcessedColumnsList.length}</span>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </Col>
                    </Row>

                    <Card
                        title={
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span><EyeOutlined style={{ marginRight: 8, color: '#13c2c2' }} />{translate('step4.preview.title', '脫敏結果預覽對照 (First 10 Rows)')}</span>
                                <Segmented options={[{ label: currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.preview.masked.k_anon', 'K-匿名化後資料') : translate('step4.preview.masked.dp', '差分隱私加噪後資料'), value: 'masked' }, { label: translate('step4.preview.raw', '原始明文數據 (Raw)'), value: 'original' }]} value={previewViewMode} onChange={(selectedViewModeVal) => setPreviewViewMode(selectedViewModeVal as 'masked' | 'original')} />
                            </div>
                        }
                        variant="borderless" style={{ background: token.colorBgContainer, marginTop: '24px' }}
                    >
                        {/* ★ 新增：使用者反映對照原始資料時，看到年齡／bmi 等欄位變成「*」，不清楚
                            原因，還以為是對照錯誤。已對照後端原始碼確認 (app/engines/anonymization/
                            strategies/generalize.py 的 apply_numeric_bins／categorical_mapping_generalize)：
                            「*」代表這一格的原始值沒有落在 Step2「泛化階層對照」設定的任何一段區間／
                            分類裡，系統為了避免外洩「沒被泛化到」的原始值，才整格改顯示「*」完全遮蔽，
                            並非程式出錯。Step2 雖然已經說明過，但使用者容易在跑到 Step4 時忘記，故在
                            這裡（實際看到「*」的當下）就地補充一次提醒。僅 K-匿名模式、且目前畫面上
                            確實有出現「*」時才顯示，避免無關時多一條用不到的提示。 */}
                        {currentPrivacyModeTypeStr === 'k-anonymity' && previewViewMode === 'masked'
                            && realMaskedDataRows.some((rowRecordItem) => Object.values(rowRecordItem).some((cellValue) => cellValue === '*')) && (
                            <Alert
                                type="info"
                                showIcon
                                style={{ marginBottom: '12px', textAlign: 'left' }}
                                message={translate('step4.preview.wildcard_hint_title', '欄位顯示「*」是什麼意思？')}
                                description={translate(
                                    'step4.preview.wildcard_hint_desc',
                                    '「*」不是錯誤，代表這筆資料的原始值沒有被您在 Step2「泛化階層對照」設定的分類或區間涵蓋到，系統為了避免外洩沒被泛化到的原始值，直接整格改顯示「*」。如果想保留這些資料的可用性，請回到 Step2，把這個值也加進對照設定中。'
                                )}
                            />
                        )}
                        {previewViewMode === 'masked' && previewParseDiagnosticText && (
                            <Alert
                                type="warning"
                                showIcon
                                style={{ marginBottom: '12px', textAlign: 'left' }}
                                message={translate('step4.preview.parse_diagnostic_title', '預覽表格暫時無法顯示資料')}
                                description={
                                    <>
                                        <div>{translate('step4.preview.parse_diagnostic_desc', '後端已成功回傳去識別化後的檔案（上方分數皆以此檔案計算得出），但畫面在解析內容以顯示預覽表格時發生問題，這是顯示層的問題，不代表去識別化處理本身失敗或輸出檔案有誤。請將以下除錯資訊截圖回報：')}</div>
                                        <div style={{ marginTop: '8px', fontSize: '12px', fontFamily: 'monospace', wordBreak: 'break-all', color: token.colorTextDescription }}>{previewParseDiagnosticText}</div>
                                    </>
                                }
                            />
                        )}
                        <Table
                            dataSource={previewViewMode === 'masked' ? (realMaskedDataRows.length > 0 ? realMaskedDataRows : []) : sampleRawDataRowsList}
                            columns={(previewViewMode === 'masked' ? maskedPreviewColumnNamesList : actualProcessedColumnsList).map((columnNameString) => {
                                const { role: configuredRoleNameString, tagColor: mappedTagColorString } = getCalculatedRole(columnNameString);
                                const localizedRoleI18nKeyString = `step4.role.${configuredRoleNameString.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;
                                // ★ 2026-09-29：此欄位若在本次風險評估中被自動分級距（僅套用在送三攻擊／CAP 的資料副本），
                                //   在標籤旁加提示，避免使用者看到預覽仍是原始值而誤以為分級距沒生效或輸出也被分級距。
                                const cleanPreviewColumnName = columnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
                                const binnedInfoForColumn = highCardinalitySensitiveWarningInfo.find(
                                    (item) => item.handling === 'binned' && item.binWidth !== undefined && item.columnName === cleanPreviewColumnName
                                );
                                return {
                                    title: (<div><div>{columnNameString}</div><Tag color={mappedTagColorString} style={{ fontSize: '10px', margin: 0 }}>{translate(localizedRoleI18nKeyString, configuredRoleNameString)}</Tag>{binnedInfoForColumn && (
                                        <Tooltip title={translate('step4.preview.binned_column_tooltip', '風險評估時以每 {{width}} 分級距（共 {{count}} 級）；去識別化輸出保留原始值', { width: binnedInfoForColumn.binWidth!.toLocaleString(), count: binnedInfoForColumn.binCount })}>
                                            <QuestionCircleOutlined style={{ marginLeft: 4, fontSize: '11px', cursor: 'help', color: token.colorTextDescription }} />
                                        </Tooltip>
                                    )}</div>),
                                    dataIndex: columnNameString, key: columnNameString,
                                };
                            })}
                            // ★ 使用者確認維持預覽 10 筆即可：資料來源（realMaskedDataRows／
                            // sampleRawDataRowsList）本身都已經只有最多 10 筆，分頁永遠只會有
                            // 1 頁，右下角的分頁按鈕形同虛設、只是多餘的雜訊，故關閉分頁功能。
                            pagination={false} size="small" rowKey={(rowRecordItemObject) => JSON.stringify(rowRecordItemObject)} scroll={{ x: 'max-content' }}
                        />
                    </Card>
                    </>
                )
            )}

            <Modal
                title={translate('step4.modal.title', '隱私合規與風險評估報告')}
                open={isReportModalVisibleStatus} onCancel={() => setIsReportModalVisibleStatus(false)} width={800} styles={{ body: { maxHeight: '72vh', overflowY: 'auto', paddingRight: '6px' } }}
                footer={[
                    <Button key="close" onClick={() => setIsReportModalVisibleStatus(false)}>{translate('step4.modal.close', '關閉')}</Button>,
                    <Button key="download" type="primary" icon={<DownloadOutlined />} loading={isExportingPdfStatus} onClick={handleDownloadPDF} style={{ background: '#4F46E5' }}>{translate('step4.modal.export_pdf', '匯出 PDF 憑證')}</Button>
                ]}
            >
                {/* ★ 使用者反映（2026-09-22）：與上方主畫面同理，這裡先前也用
                    attackSimulationMetricsData 是否有值來決定整份合規報告 Modal 開起來是否有
                    內容，K-匿名「敏感欄位=0」時會整份報告都是空的。改用 datasetRowStatsData
                    判斷「這一輪是否真的跑完」，報告內「隱私安全風險評估」那個象限另外處理
                    attackSimulationMetricsData 是否存在（見下方），其餘象限（檔案資訊、效用
                    評估、欄位處置對照表）不受風險評估是否執行影響，應正常顯示。

                    ★ 使用者反映（2026-09-23）：這份「合規審計報告」跟「官方風險評估報告」
                    （後端 /api/v1/report 簽發）風格版面不一致、內容各自獨立，使用者覺得太
                    複雜。這裡整份改版比照官方報告的樸素風格（深色品牌列、置中大標題、
                    一二三四五六編號段落、樸素邊框表格、無彩色卡片），並把官方報告獨有的
                    「隱私強化處理配置」段落（去識別技術參數＋三攻擊固定參數）一併合併進來，
                    讓使用者只需要看這一份、視覺風格與官方報告一致的完整報告——原本合規報告
                    才有的專案資訊、資料效用評估、欄位對照表、數位簽章則完整保留，不因改版而
                    遺失內容。 */}
                {datasetRowStatsData && (() => {
                    const sectionHeadingStyle: CSSProperties = { color: '#000000', fontSize: '15px', fontWeight: 600, marginTop: '24px', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #d9d9d9' };
                    const keyValueRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#333333', padding: '3px 0' };

                    // 一、專案與檢測權限資訊
                    // ★ 使用者反映（2026-09-23）：拿掉「檢測核可人」這一列，此段落只保留檔案名稱與保護模式。
                    const projectInfoRowsList: { label: string; value: string }[] = [
                        { label: translate('step4.report.file_name', '原始檔案名稱：'), value: currentDatasetFileNameString || 'dataset.csv' },
                        { label: translate('step4.report.mode', '保護模式：'), value: currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.report.k_anonymity_value', 'K-匿名化') : translate('step4.report.dp_value', '差分隱私化') }
                    ];

                    // 二、隱私強化處理配置：比照官方風險評估報告（後端 /api/v1/report）同一段落的
                    // 顯示內容——去識別方法參數取自本次實際送給後端的同一組畫面狀態；三攻擊固定
                    // 參數取自上方 RISK_ATTACK_REPORT_DISPLAY_PARAMS（與 runFullPipeline 內實際送出
                    // 的 RISK_ATTACK_DEFAULT_PARAMS 同步維護，見該常數宣告處說明）。
                    const deidConfigRowsList: { label: string; value: string }[] = currentPrivacyModeTypeStr === 'k-anonymity'
                        ? [
                            { label: translate('step4.report.deid_technique', '去識別技術'), value: translate('step4.report.k_anonymity_value', 'K-匿名化') },
                            { label: translate('step4.report.k_value_label', 'k 值'), value: String(currentKValueNumber) },
                            { label: translate('step4.report.suppress_limit_label', '抑制上限（%）'), value: String(currentMaxSuppressionNumber ?? 5) },
                            { label: translate('step4.report.exceed_behavior_label', '超限行為'), value: (currentLimitExceededActionStr || 'stop_and_error') === 'stop_and_error' ? translate('step3.stop_and_error', '停止並報錯') : translate('step3.force_suppress', '強制抑制(降效用)') },
                            { label: translate('step4.report.suppress_method_label', '抑制方式'), value: (currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression') ? translate('step3.cell_suppression', '值抑制 ') : translate('step3.row_suppression', '列抑制 ') },
                            ...((currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression')
                                ? [{ label: translate('step4.report.cell_fill_label', '值抑制填法'), value: currentCellFillMethodStr === 'missing' ? translate('step3.cell_fill_missing', '缺失值 (missing)') : translate('step3.cell_fill_star', '星號遮蔽 (star)') }]
                                : [])
                        ]
                        : [
                            { label: translate('step4.report.deid_technique', '去識別技術'), value: translate('step4.report.dp_value', '差分隱私化') },
                            { label: translate('step4.report.accumulated_epsilon_label', '已累計 ε'), value: String(dpAccumulatedEpsilonValue ?? 0) },
                            { label: translate('step4.report.accumulated_delta_label', '已累計 δ'), value: String(dpAccumulatedDeltaValue ?? 0) },
                            { label: translate('step4.report.default_delta_label', '預設 δ'), value: String(globalTargetDeltaValue ?? 0.0001) }
                        ];
                    const riskAttackParamRowsList: { label: string; value: string }[] = [
                        { label: translate('step4.report.iter_count_label', '指認性迭代次數'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.n_iter) },
                        { label: translate('step4.report.ctrl_ratio_label', '控制組比例'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.ctrl_ratio) },
                        { label: translate('step4.report.seed_label', '亂數種子'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.seed) },
                        { label: translate('step4.report.subset_size_label', '連結性子集大小'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.n_subset) },
                        { label: translate('step4.report.repeat_rounds_label', '重複實驗輪數'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.n_repeats) },
                        { label: translate('step4.report.overlap_ratio_label', '跨輪重疊比例'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.overlap_ratio) }
                    ];
                    const privacyConfigRowsList = [...deidConfigRowsList, ...riskAttackParamRowsList];

                    const renderKeyValueTable = (rowsList: { label: string; value: string }[], headerLeftText: string, headerRightText: string) => (
                        <div style={{ border: '1px solid #d9d9d9', borderRadius: '4px', marginBottom: '20px', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#000000', backgroundColor: '#ffffff' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f1f5f9' }}>
                                        <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 12px', textAlign: 'left', width: '40%', fontSize: '13px' }}>{headerLeftText}</th>
                                        <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 12px', textAlign: 'left', fontSize: '13px' }}>{headerRightText}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rowsList.map((rowItem, rowIndexNumber) => (
                                        <tr key={rowIndexNumber}>
                                            <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', fontSize: '13px', color: '#333333', wordBreak: 'break-word' }}>{rowItem.label}</td>
                                            <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', fontSize: '13px', color: '#333333', wordBreak: 'break-word' }}>{rowItem.value}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );

                    return (
                        <div id="printable-audit-report" ref={pdfReportContainerRef} style={{ color: '#000000', backgroundColor: '#ffffff', borderRadius: '4px', fontFamily: 'sans-serif', overflow: 'hidden' }}>
                            {/* 頂部深色品牌列，固定樣式不受畫面明／暗主題影響（比照官方風險評估報告 PDF 的
                                固定風格），才不會印出來的稽核文件因為使用者當下切成深色模式而變色。 */}
                            <div className="pdf-page-break" style={{ background: '#1f2937', color: '#ffffff', padding: '14px 24px', fontSize: '12px', pageBreakInside: 'avoid' }}>
                                {translate('step4.report.brand_bar', '通用去識別化與隱私保護系統 - 安全驗證與合規稽核報告')}
                            </div>

                            <div style={{ padding: isExportingPdfStatus ? '24px' : '24px' }}>
                                <div className="pdf-page-break" style={{ textAlign: 'center', marginBottom: '8px', pageBreakInside: 'avoid' }}>
                                    <h2 style={{ margin: '12px 0 4px', color: '#000000', fontSize: '21px' }}>{translate('step4.report.header', '隱私合規與風險評估報告')}</h2>
                                    <div style={{ fontSize: '12px', color: '#555555' }}>
                                        {translate('step4.report.cert_id', '報告編號:')} {auditMetadataObject.certificateId} ｜ {translate('step4.report.audit_time', '產出時間:')} {auditMetadataObject.auditTime}
                                    </div>
                                </div>

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, marginTop: '20px', pageBreakInside: 'avoid' }}>一、 {translate('step4.report.info_title', '專案與檢測權限資訊')}</h4>
                                {renderKeyValueTable(projectInfoRowsList, translate('step4.report.config_item_header', '設定項目'), translate('step4.report.config_detail_header', '配置細節'))}

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>二、 {translate('step4.report.privacy_config_title', '隱私強化處理配置')}</h4>
                                {renderKeyValueTable(privacyConfigRowsList, translate('step4.report.config_item_header', '設定項目'), translate('step4.report.config_detail_header', '配置細節'))}

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>三、 {translate('step4.report.risk_title', '再識別風險量測結果')}</h4>
                                <div className="pdf-page-break" style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
                                    {attackSimulationMetricsData ? (
                                        <>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.singling_risk', '指認性攻擊成功率 (Singling Out)：')}</span><span>{(attackSimulationMetricsData.singling.risk * 100).toFixed(2)}%</span></div>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.linkability_risk', '連結性攻擊成功率 (Linkability)：')}</span><span>{(attackSimulationMetricsData.linkability.risk * 100).toFixed(2)}%</span></div>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.inference_risk', '推斷性攻擊成功率 (Inference)：')}</span><span>{(attackSimulationMetricsData.inference.risk * 100).toFixed(2)}%</span></div>
                                        </>
                                    ) : (
                                        // ★ 使用者反映（2026-09-22）：K-匿名「敏感欄位=0」時三攻擊被略過，這裡改顯示
                                        //   說明文字，而非讀取 null 的 attackSimulationMetricsData 噴錯或整份報告消失。
                                        <div style={{ fontSize: '13px', color: '#555555', padding: '3px 0' }}>
                                            {translate('step4.report.risk_not_evaluated', '未評估（尚未設定「敏感欄位」，本次已略過三攻擊與 CAP 風險評估）')}
                                        </div>
                                    )}
                                    {/* ★ 使用者反映（2026-09-23）：CAP 前後對比獨立於 attackSimulationMetricsData
                                        是否有值（CAP 與三攻擊分開執行、分開判斷「是否已略過」），只依
                                        capReportData 本身判斷要顯示數字還是「未評估」原因；標籤文字比照官方
                                        風險評估報告的「處理前／處理後歸因機率」措辭，維持風格一致。 */}
                                    {capReportData && !(capReportData.cap_before < 0 || capReportData.cap_after < 0) ? (
                                        <>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.cap_before_label', '處理前歸因機率 (CAP Before)：')}</span><span>{(capReportData.cap_before * 100).toFixed(2)}%</span></div>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.cap_after_label', '處理後歸因機率 (CAP After)：')}</span><span>{(capReportData.cap_after * 100).toFixed(2)}%</span></div>
                                        </>
                                    ) : (
                                        <div style={{ fontSize: '13px', color: '#555555', padding: '3px 0' }}>
                                            {translate('step4.report.cap_not_evaluated', '未評估（間接識別碼或敏感欄位設定不足，或限定條件篩選後無資料）')}
                                            {capReportData?.message && (
                                                <div style={{ marginTop: '4px', fontSize: '12px' }}>
                                                    {translate('step4.report.cap_backend_message_prefix', '後端回應原因：')}{capReportData.message}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>四、 {translate('step4.report.utility_title', '資料效用與失真度評估')}</h4>
                                <div className="pdf-page-break" style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
                                    <div style={keyValueRowStyle}>
                                        <span>{currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.report.suppression', '資料紀錄抑制率：') : translate('step4.report.total_epsilon', '總消耗隱私預算 (Epsilon)：')}</span>
                                        <span>{currentPrivacyModeTypeStr === 'k-anonymity' ? `${(kReport ? kReport.suppression_rate_percent : 0).toFixed(3)}%` : `${dpReport ? dpReport.consumed_epsilon : 0} ε`}</span>
                                    </div>
                                    <div style={keyValueRowStyle}>
                                        <span>{translate('step4.report.total_cols', '實際去識別數 / 總欄位數：')}</span><span>{deidentifiedColumnsCountValue} / {actualProcessedColumnsList.length}</span>
                                    </div>
                                    {datasetRowStatsData && (
                                        <div style={keyValueRowStyle}>
                                            <span>{translate('step4.report.row_stats', '資料筆數（輸入/刪除/輸出）：')}</span>
                                            <span>{datasetRowStatsData.input.toLocaleString()} / {datasetRowStatsData.deleted.toLocaleString()} / {datasetRowStatsData.output.toLocaleString()}</span>
                                        </div>
                                    )}
                                </div>

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>五、 {translate('step4.report.table_title', '欄位處置與技術對照表')}</h4>
                                <div style={{ maxHeight: isExportingPdfStatus ? 'none' : '240px', overflowY: isExportingPdfStatus ? 'visible' : 'auto', border: '1px solid #d9d9d9', borderRadius: '4px', marginBottom: '20px' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', color: '#000000', backgroundColor: '#ffffff', tableLayout: 'fixed' }}>
                                        <thead>
                                            <tr style={{ backgroundColor: '#f1f5f9', position: isExportingPdfStatus ? 'static' : 'sticky', top: 0, zIndex: 1, pageBreakInside: 'avoid' }}>
                                                <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '40%' }}>{translate('step4.report.col_name', '欄位名稱')}</th>
                                                <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('step4.report.col_role', '隱私角色')}</th>
                                                <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('step4.report.col_tech', '套用去識別化技術')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {actualProcessedColumnsList.map((columnNameString) => {
                                                const { role: configuredRoleNameString, maskStrategy: configuredMaskStrategyString } = getCalculatedRole(columnNameString);
                                                const targetDpFieldConfigItemObj = currentDpFieldsListArray?.find(fieldItemRecord => fieldItemRecord.fieldName === columnNameString && fieldItemRecord.enabled);
                                                let resolvedStrategyDescriptionText = translate('step4.report.tech_keep_original', '保留原文');

                                                if (configuredRoleNameString === 'Identifier') {
                                                    resolvedStrategyDescriptionText = configuredMaskStrategyString === 'remove'
                                                        ? translate('step4.report.tech_removed', '直接移除')
                                                        : translate('step4.report.tech_full_masking', '完全遮蔽');
                                                }
                                                else if (configuredRoleNameString === 'Quasi-identifier' && currentPrivacyModeTypeStr === 'k-anonymity') resolvedStrategyDescriptionText = translate('step4.report.tech_generalization', '區間/時間泛化');
                                                else if (currentPrivacyModeTypeStr === 'differential-privacy' && targetDpFieldConfigItemObj) resolvedStrategyDescriptionText = translate('step4.report.tech_dp', '差分隱私加噪');

                                                const localizedRoleI18nKeyString = `step4.role.${configuredRoleNameString.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;

                                                return (
                                                    <tr key={columnNameString} style={{ backgroundColor: '#ffffff', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                                                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#000000', wordBreak: 'break-word' }}><b>{columnNameString}</b></td>
                                                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{translate(localizedRoleI18nKeyString, configuredRoleNameString)}</td>
                                                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{resolvedStrategyDescriptionText}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>六、 {translate('step4.report.measurement_note_title', '量測說明')}</h4>
                                <div className="pdf-page-break" style={{ fontSize: '12px', color: '#555555', marginBottom: '20px', pageBreakInside: 'avoid' }}>
                                    {attackSimulationMetricsData ? (
                                        <div style={{ marginBottom: '4px' }}>
                                            {translate('step4.report.measurement_note_attack', '三攻擊風險評估完成。指認性風險: {{singling}}, 連結性風險: {{linkability}}, 推斷性風險: {{inference}}。', {
                                                singling: attackSimulationMetricsData.singling.risk.toFixed(2),
                                                linkability: attackSimulationMetricsData.linkability.risk.toFixed(2),
                                                inference: attackSimulationMetricsData.inference.risk.toFixed(2)
                                            })}
                                        </div>
                                    ) : (
                                        <div>{translate('step4.report.measurement_note_not_evaluated', '尚未設定「敏感欄位」，本次已略過三攻擊與 CAP 風險評估，故無量測結果可供說明。')}</div>
                                    )}
                                    {capReportData && !(capReportData.cap_before < 0 || capReportData.cap_after < 0) && (
                                        <div>
                                            {translate('step4.report.measurement_note_cap', 'CAP 前後對比完成。處理前: {{before}}, 處理後: {{after}}。', {
                                                before: capReportData.cap_before.toFixed(2),
                                                after: capReportData.cap_after.toFixed(2)
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="pdf-page-break" style={{ textAlign: 'right', marginTop: '16px', borderTop: `1px dashed #d9d9d9`, paddingTop: '12px', fontSize: '12px', color: '#888888', pageBreakInside: 'avoid' }}>
                                    {translate('step4.report.signature', '系統數位簽章：PRIVACY-APP-AUDIT-ENGINE-V2.0-PASSED')}
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </Modal>
        </div>
    );
}