/**
 * ============================================================================
 * 檔案名稱 (File): useWorkspaceStore.ts
 * 模組功能 (Description): 全域去識別化工作區狀態數據庫 (Zustand Workspace Store，提供精靈步驟切換、資料集解析、K-Anonymity 與 DP 進階參數管理)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之縮寫) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { create } from 'zustand';
import { isDateTimeDpField, DEFAULT_DATETIME_LOWER_BOUND_DATE } from '../utils/dpFieldHelpers';

/**
 * 預設系統常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const MIN_STEP_INDEX = 0;
const DEFAULT_K_ANONYMITY_VALUE = 3; // ★ 修正：K-匿名 K 值預設由 5 改為 3 (依需求調整)
const DEFAULT_L_DIVERSITY_VALUE = 2;
const DEFAULT_T_CLOSENESS_VALUE = 0.15;
const DEFAULT_MAX_SUPPRESSION_PERCENT = 5;
const DEFAULT_EPSILON_BUDGET = 1.0;
const DEFAULT_DELTA_BUDGET = 1e-5;
const DEFAULT_NUMERIC_LOWER_BOUND = 0;
const DEFAULT_NUMERIC_UPPER_BOUND = 100;
const DEFAULT_SIMULATE_QUERY_COUNT = 1;
const DEFAULT_BUDGET_LIMIT_EPSILON = 20;
const DEFAULT_TARGET_DELTA = 0.0001;

/**
 * 預處理清洗規則介面 (單一序列轉換步驟)
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface PreprocessingRule
{
    action: string;                          // 清洗動作指令 (如 'trim', 'slice', 'hash')
    params: Record<string, string | number>; // 該動作所需之參數集合，鍵值依 action 種類而異
}

/**
 * 缺失值處理規則介面 (與序列轉換步驟互斥，每欄位僅能擇一)
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface MissingValueRule
{
    strategy: 'none' | 'drop' | 'constant' | 'fill';                  // 缺失值處理策略
    constantValue?: string;                                           // strategy = 'constant' 時之填充常數值
    fillMethod?: 'forward' | 'backward' | 'interpolate' | 'mean';     // strategy = 'fill' 時之填充方法
}

/**
 * 差分隱私 (DP) 欄位配置介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface DPField 
{
    id: string;                                           // 欄位唯一識別碼 (如: 'col_0')
    fieldName: string;                                    // 欄位名稱
    enabled?: boolean;                                    // 是否啟用 DP 處理
    fieldType?: 'Numeric' | 'Categorical' | 'Text' | 'Unknown'; // 欄位資料型態
    epsilon?: number;                                     // 個人化 Epsilon 隱私預算 (ε)
    delta?: number;                                       // 個人化 Delta 鬆弛參數 (δ)
    mode?: 'epsilon' | 'epsilon-delta';                   // 差分隱私運作模式
    lowerBound?: number | string;                         // 連續數值型裁剪下限；日期時間型則為 ISO 日期字串 (如 "1930-01-01")
    upperBound?: number | string;                         // 連續數值型裁剪上限；日期時間型則為 ISO 日期字串
    allowedCategories?: string;                           // 類別型允許之類別清單 (以逗號分隔)
    maxLength?: number;                                   // 文字型最大長度限制
    outOfBoundsStrategy?: 'clip' | 'wrap' | 'reflect';    // 個別欄位邊界溢出處理策略 (數值/日期時間型適用，對應 config_dp.json 之 out_of_bounds_strategy／time_out_of_bounds_strategy)
    minimumUnit?: number;                                 // 連續數值型加噪刻度 (對應 config_dp.json 之 minimum_unit)
    noiseStep?: number;                                   // 日期時間型加噪步階 (對應 config_dp.json 之 noise_step)
}

/**
 * ★ 新增：風險評估「對象族群限定條件 (subgroup)」單一欄位條件介面
 * 對應交付文件《設定檔結構與參數說明.pdf》4-3 節：數值／日期型欄位以 min／max 表示閉區間
 * （首尾皆含，可只給一側）；類別／文字型欄位以陣列列舉允許值，符合清單內任一值者入選。
 * 多個欄位並列時，後端取交集（AND）。此條件同時套用於 risk_attacks（三攻擊）與
 * risk_cap（CAP 前後對比，對前後兩份資料各篩選一次）兩個區塊。
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export type RiskSubgroupCondition =
    | { kind: 'range'; min?: string; max?: string }         // 數值／日期型：min、max 皆可留空（僅給單側），但至少要有一側才有意義
    | { kind: 'categorical'; values: string[] };             // 類別／文字型：允許值清單，任一值符合即入選

/**
 * 步驟四模擬與驗證檢測快照介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface Step4Cache 
{
    metrics: {
        singling: { ori: number; ctrl: number; base: number; risk: number };    // 指認性風險明細
        linkability: { ori: number; ctrl: number; base: number; risk: number }; // 連結性風險明細
        inference: { ori: number; ctrl: number; base: number; risk: number };   // 推斷性風險明細
        overallRiskPercent: string;                                             // 綜合風險百分比字串
    };
    certificateId: string;                                                      // 合規驗證憑證編號
    auditTime: string;                                                          // 審計驗證時間字串
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiReport?: any;                                                            // 保存後端回傳之報表數據 (Epsilon/抑制率)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processedCsvBlob?: any;                                                     // ★新增：保存後端回傳之真實完整 CSV Blob
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    capReport?: any;                                                            // ★新增：保存 CAP 前後對比報表快照（現為安全性評估卡片主要顯示內容，需隨快取還原）
    datasetRowStats?: { input: number; deleted: number; output: number };       // ★新增：保存輸入／刪除／輸出筆數快照
    // ★ 使用者反映（2026-09-22）：Step4 每次切換步驟再切回來都會重新掛載（MainLayout 以
    //   currentStepIndexValue 當 key），命中快取時 runFullPipeline 會直接略過整段風險評估
    //   （含高唯一值比例敏感欄位偵測），若這兩項不隨快照還原，畫面上的風險數字雖然正確
    //   （由上面幾個欄位還原），但解釋「為什麼略過／為什麼被強制執行」的警告與勾選狀態
    //   會憑空消失，讓使用者誤以為是完整無保留的評估結果。比照 capReport／datasetRowStats
    //   一併存讀快照。
    highCardinalitySensitiveWarningInfo?: { columnName: string; uniqueRatioPercent: number; handling?: 'binned' | 'skipped' | 'forced'; binWidth?: number; binCount?: number }[]; // ★新增：高唯一值比例敏感欄位警告快照
    forceRunHighCardinalitySensitiveFields?: boolean;                            // ★新增：使用者是否已勾選「仍要強制執行」快照
    sensitiveBinWidthOverrides?: Record<string, number>;                         // ★新增（2026-09-29）：使用者自訂的敏感欄位級距寬度快照
}

/**
 * ★ 新增：Step1 檔案上傳當下的編碼偵測診斷快照介面
 * 目的：外部測試人員回報 API 400／診斷用途——保留「這次上傳的檔案，前端偵測到什麼編碼、
 * 有沒有因此重新編碼」，供全域 API 錯誤紀錄 (apiErrorLogger) 在發生錯誤當下一併記錄，
 * 不需使用者自行開發者工具查看即可回報完整診斷資訊。
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface UploadDiagnosticsSnapshot
{
    fileName: string;              // 觸發此次偵測的檔案原始名稱
    detectedEncoding: string;      // 偵測到的編碼標籤 (如 'utf-8'、'utf-8-bom'、'big5'、'xlsx' 等)
    wasReencoded: boolean;         // 是否因編碼不受後端原生支援而重新編碼為乾淨 UTF-8 後才上傳
    detectedAt: string;            // 偵測時間 (ISO 字串)
}

/**
 * 去識別化工作區全域狀態與 Actions 介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
interface WorkspaceState
{
    // 基礎設定與檔案資料 (符合規範 g)
    dataFile: File | null;                                                   // 儲存原始實體檔案物件 (發送 API 用)
    currentStep: number;                                                     // 當前精靈步驟索引 (0 ~ 3)
    privacyMode: 'k-anonymity' | 'differential-privacy' | null;               // 脫敏保護模式
    columns: string[];                                                       // 數據集欄位名稱陣列
    previewData: Record<string, unknown>[];                                  // 前端預覽數據紀錄陣列
    preprocessingRules: Record<string, PreprocessingRule[]>;                  // 預處理清洗規則表 (每欄位可設定多道依序執行之策略)
    missingValueRules: Record<string, MissingValueRule>;                     // 缺失值處理規則表 (每欄位僅能擇一，與 preprocessingRules 互斥並存)
    fileName?: string;                                                       // 當前載入之檔案名稱
    lastUploadDiagnostics: UploadDiagnosticsSnapshot | null;                 // ★ 新增：最近一次檔案上傳之編碼偵測診斷快照 (供全域 API 錯誤紀錄引用)
    
    // 核心陣列與物件 (符合規範 g)
    columnRoles: Record<string, string>;                                      // 欄位隱私角色映射
    columnTypes: Record<string, string>;                                      // 欄位資料型態映射
    dpFields: DPField[];                                                     // 差分隱私欄位配置陣列
    datasetColumnNumericValuesMap: Record<string, number[]>;                  // 數值型欄位防呆檢查快取：完整解析資料集後，各欄位之實際有效數值陣列 (供跨步驟邊界涵蓋率校驗使用)
    riskSubgroupFilters: Record<string, RiskSubgroupCondition>;              // ★ 新增：風險評估「對象族群限定條件」，未設定 (空物件) 時評估全體，見上方 RiskSubgroupCondition 註記
    // ★ 新增：「限定特定族群評估風險」類別型欄位之完整資料集相異值快取——使用者反映手動輸入
    // 篩選值（如誤打「北區/南區」，但資料集實際存的是「大安區/板橋區」等行政區名稱）會導致
    // 篩選後查無資料，故改為完整解析原始上傳檔案 (不受 Step1 預覽 1000 筆上限)，取得每個欄位
    // 實際出現過的相異值，讓畫面只能從清單勾選、不再開放自由輸入，從根本避免此類打字誤植。
    // 由 RiskSubgroupFilterPanel.tsx 於掛載時觸發掃描並快取於此 (依所選 dataFile 計算一次)。
    columnCategoricalUniqueValues: Record<string, string[]>;
    isColumnCategoricalValuesScanning: boolean;                              // ★ 新增：上述完整資料集掃描是否進行中，供畫面顯示載入狀態

    // 步驟四預覽快照 (符合規範 g)
    step4Cache: Step4Cache | null;                                           // 風險量測快照
    lastRunParamsHash: string | null;                                        // 參數設定校驗 Hash 快照

    // 門閥驗證狀態 (符合規範 g)
    isStepValid: boolean;                                                    // 當前步驟是否合規
    stepErrorMessage: string | null;                                          // 步驟驗證錯誤提示訊息
    
    // K-Anonymity 進階參數 (符合規範 g)
    kValue: number;                                                          // K-匿名 k 數值
    lValue: number;                                                          // L-多樣性 l 數值
    tValue: number;                                                          // T-趨近性 t 數值
    // ★ 使用者反映：純 K-匿名模式下並不需要 l/t 檢測，但先前 l/t 一律隨 lValue/tValue 預設值
    //   送給後端，導致後端一律嘗試做 l/t 檢測；若未指定任何「敏感欄位」，l_passed 就會永遠回傳
    //   false，且與 l 值調整無關，使用者誤以為是 bug。新增這兩個開關，預設關閉，讓使用者可自行
    //   決定是否要啟用 l-多樣性／t-緊密度檢測；關閉時，Step4 組裝設定檔不會送出 l／t 欄位，
    //   依交付文件之後端行為「設定檔未提供 l/t 時不執行該檢測，回傳 true」。
    enableLDiversity: boolean;                                               // 是否啟用 l-多樣性檢測
    enableTCloseness: boolean;                                               // 是否啟用 t-緊密度檢測
    maxSuppression: number;                                                  // 最大允許抑制率 (%)
    suppressionMethod: string;                                               // 抑制處理方式 ('row_suppression' | 'cell_suppression')
    // ★ 使用者反映（2026-09-23）：後端 K-匿名化 API 有一個選填參數 cell_fill（'star'｜'missing'），
    //   決定「值抑制」模式下被隱藏的欄位值要顯示成星號還是缺失值；先前前端完全沒有 UI 讓使用者
    //   選擇，也從未把這個欄位送給後端，導致選了「值抑制」的使用者其實無法控制輸出結果的呈現方式，
    //   後端只能默默套用自己的內建預設 (star)。新增這個欄位，預設值仍為 'star'（與過去後端預設
    //   行為一致，不影響既有使用者），僅在抑制方式為「值抑制」時才會實際送給後端（見 Step4
    //   apiOptions 組裝處）。
    cellFillMethod: 'star' | 'missing';                                      // 值抑制填法 ('star'｜'missing')，僅 cell_suppression 模式下生效
    limitExceededAction: string;                                             // 抑制率超限處置動作

    kAnonymityFields: Record<string, unknown>[];                             // K-匿名欄位明細
    kAnonymityHierarchies: Record<string, unknown>[];                        // K-匿名階層對應表
    fieldAttributes: Record<string, unknown>;                                // JSON 導出用欄位屬性
    maskingRules: Record<string, unknown>;                                   // JSON 導出用遮蔽規則
    generalizationRules: Record<string, unknown>;                            // JSON 導出用泛化規則
    generalizationHierarchies: Record<string, unknown>;                      // JSON 導出用數值/時間自訂區間 (bins)
    categoricalHierarchies: Record<string, unknown>;                         // JSON 導出用類別階層
    numericBins: Record<string, unknown>;                                    // JSON 導出用數值箱寬
    temporalHierarchies: Record<string, unknown>;                            // JSON 導出用時間階層

    // Differential Privacy 進階參數 (符合規範 g)
    queryCount: number;                                                      // 模擬連續發布/查詢次數 M
    targetDelta: number;                                                     // 全域目標 Baseline δ (對應 config_dp.json 之 default_delta)
    budgetLimitEpsilon: number;                                              // 累積隱私預算門檻上限
    outOfBoundsStrategy: string;                                             // 數值邊界溢出處置策略
    // ★ 使用者反映：後端 config_dp.json 之 accumulated_epsilon／accumulated_delta 為「跨批次累計」
    //   之隱私預算追蹤值，先前每次執行皆固定送出 0，等同從未真正累計，形同虛設。此處改為在本地
    //   持久保存目前已累計消耗之 ε／δ，每次執行 DP 前送給後端作為「本次執行前」之累計基準值，
    //   執行成功後再疊加本次消耗，讓多次執行之間的隱私預算真正累加而非每次歸零。
    dpAccumulatedEpsilon: number;                                            // 跨批次累計已消耗 Epsilon (ε)
    dpAccumulatedDelta: number;                                              // 跨批次累計已消耗 Delta (δ)

    // Actions 宣告
    setDataFile: (file: File | null) => void;
    setPrivacyMode: (privacyModeTypeStr: 'k-anonymity' | 'differential-privacy') => void;
    setPreprocessingRules: (preprocessingRulesMapDict: Record<string, PreprocessingRule[]>) => void;
    setMissingValueRules: (missingValueRulesMapDict: Record<string, MissingValueRule>) => void;
    nextStep: () => void;
    prevStep: () => void;
    setStep4Cache: (step4CacheDataObj: Step4Cache, paramsHashString: string) => void;
    setFileData: (datasetColumnsListArray: string[], datasetRowsListArray: Record<string, unknown>[], loadedFileNameStr: string) => void;
    clearFileData: () => void;
    setLastUploadDiagnostics: (diagnosticsSnapshotObj: Omit<UploadDiagnosticsSnapshot, 'detectedAt'>) => void; // ★ 新增
    setStepValidation: (isValidBooleanStatus: boolean, errorMessageString: string | null) => void;
    setDpFields: (dpFieldsListArray: DPField[]) => void;
    setDatasetColumnNumericValuesMap: (numericValuesMapDict: Record<string, number[]>) => void;
    setRiskSubgroupFilters: (riskSubgroupFiltersMapDict: Record<string, RiskSubgroupCondition>) => void; // ★ 新增
    setColumnCategoricalUniqueValues: (columnCategoricalUniqueValuesMapDict: Record<string, string[]>) => void; // ★ 新增
    setIsColumnCategoricalValuesScanning: (isScanningStatus: boolean) => void; // ★ 新增
    resetWorkspace: () => void;
}

const createInitialDPFields = (datasetColumnsListArray: string[]): DPField[] => 
{
    return datasetColumnsListArray.map(
        (columnNameString, columnIndexNumber) => 
        {
            const lowerCaseColumnNameString = columnNameString.toLowerCase();
            let calculatedDefaultTypeStr: 'Numeric' | 'Categorical' | 'Text' | 'Unknown' = 'Unknown';

            // ★ 修正: 原本只比對英文關鍵字，中文命名的欄位（如「年齡」「薪資」）完全比對不到，導致上傳資料後的初始資料型態一律猜測為未知；此處加入常見中文關鍵字以涵蓋中文命名的資料集，與「套用系統推薦設定」按鈕使用相同的關鍵字範圍。
            // ★ 修正: 使用者更正——生日應歸類為「數值」而非「文字」，故將 birthday/生日 等關鍵字
            //   移至下方數值型判斷區間，不再與姓名／電話等身分類欄位放在一起。
            if (/(age|amount|fare|count|price|salary|num|duration|mins|income|credit|ratio|score|birthday|birth_date|dob|年齡|薪資|收入|所得|金額|費用|分數|次數|時長|比率|信用|價格|生日|出生日期)/i.test(lowerCaseColumnNameString)) 
            {
                calculatedDefaultTypeStr = 'Numeric';
            } 
            else if (/(gender|type|category|status|station|disease|zipcode|city|region|job|occupation|marital|marriage|性別|類型|類別|疾病|郵遞區號|地區|城市|縣市|國家|職業|婚姻狀況|婚姻)/i.test(lowerCaseColumnNameString)) 
            {
                calculatedDefaultTypeStr = 'Categorical';
            }
            // ★ 新增: 原本此函式只會猜測「數值」或「類別」，從未猜測過「文字」，導致姓名等
            //   身分類欄位在剛上傳資料時一律顯示「請選擇」(未知)，即使按下「套用系統推薦設定」按鈕後
            //   會正確判斷為文字型也一樣——兩者判斷範圍不一致。此處加入相同的身分類關鍵字，讓初始猜測
            //   與推薦按鈕的判斷結果一致。
            else if (/(id|name|phone|email|姓名|電話|手機|信箱|電子郵件|身分證|統一編號|地址)/i.test(lowerCaseColumnNameString)) 
            {
                calculatedDefaultTypeStr = 'Text';
            }

            const isDateTimeFieldStatus = calculatedDefaultTypeStr === 'Numeric' && isDateTimeDpField(columnNameString);

            return {
                id: `${columnNameString}-${columnIndexNumber}`,
                fieldName: columnNameString,
                fieldType: calculatedDefaultTypeStr,
                // ★ 修正: 使用者反映剛進入 DP 模式 Step2 時，姓名／身分證號等文字型（身分類）欄位的
                //   「套用差分隱私」開關一律顯示「啟用」，但這類欄位本來就不該加雜訊，應預設「停用」。
                //   原本這裡不分資料型態一律寫死 enabled: true，與「套用系統推薦設定」按鈕
                //   (fieldType === 'Text' 時 enabled = false) 及匯入 JSON 設定檔
                //   (DifferentialPrivacyMapping.tsx 的 enabled: mappedFieldTypeValue !== 'Text')
                //   兩處的判斷邏輯都不一致，才會出現「一進畫面就顯示啟用，按推薦設定後才變回停用」的落差。
                enabled: calculatedDefaultTypeStr !== 'Text',
                epsilon: DEFAULT_EPSILON_BUDGET,
                delta: DEFAULT_DELTA_BUDGET,
                // ★ 日期時間型欄位（如生日）之邊界應為日期字串而非單純數字，故與一般數值型欄位分開給預設值。
                lowerBound: isDateTimeFieldStatus ? DEFAULT_DATETIME_LOWER_BOUND_DATE : (calculatedDefaultTypeStr === 'Numeric' ? DEFAULT_NUMERIC_LOWER_BOUND : undefined),
                upperBound: isDateTimeFieldStatus ? new Date().toISOString().slice(0, 10) : (calculatedDefaultTypeStr === 'Numeric' ? DEFAULT_NUMERIC_UPPER_BOUND : undefined),
                allowedCategories: '',
                outOfBoundsStrategy: 'clip',
                minimumUnit: (calculatedDefaultTypeStr === 'Numeric' && !isDateTimeFieldStatus) ? 1 : undefined,
                noiseStep: isDateTimeFieldStatus ? 7 : undefined
            };
        }
    );
};

export const useWorkspaceStore = create<WorkspaceState>(
    (setStoreStateAction) => 
    (
        {
            dataFile: null,                                                  
            currentStep: MIN_STEP_INDEX,
            privacyMode: null,
            columns: [],
            previewData: [],
            preprocessingRules: {},
            missingValueRules: {},
            fileName: undefined,
            lastUploadDiagnostics: null,
            columnRoles: {},
            columnTypes: {},
            dpFields: [],
            datasetColumnNumericValuesMap: {},
            riskSubgroupFilters: {},
            columnCategoricalUniqueValues: {},
            isColumnCategoricalValuesScanning: false,
            step4Cache: null,
            lastRunParamsHash: null,
            isStepValid: true,
            stepErrorMessage: null,
            kValue: DEFAULT_K_ANONYMITY_VALUE,
            lValue: DEFAULT_L_DIVERSITY_VALUE,
            tValue: DEFAULT_T_CLOSENESS_VALUE,
            enableLDiversity: false,
            enableTCloseness: false,
            maxSuppression: DEFAULT_MAX_SUPPRESSION_PERCENT,
            suppressionMethod: 'row_suppression',
            cellFillMethod: 'star',
            limitExceededAction: 'stop_and_error',
            kAnonymityFields: [],
            kAnonymityHierarchies: [],
            fieldAttributes: {},
            maskingRules: {},
            generalizationRules: {},
            generalizationHierarchies: {},
            categoricalHierarchies: {},
            numericBins: {},
            temporalHierarchies: {},
            queryCount: DEFAULT_SIMULATE_QUERY_COUNT,
            targetDelta: DEFAULT_TARGET_DELTA,
            budgetLimitEpsilon: DEFAULT_BUDGET_LIMIT_EPSILON,
            outOfBoundsStrategy: 'clip',
            dpAccumulatedEpsilon: 0,
            dpAccumulatedDelta: 0,

            setDataFile: (file) => setStoreStateAction({ dataFile: file }),          
            setPrivacyMode: (privacyModeTypeStr) => setStoreStateAction({ privacyMode: privacyModeTypeStr }),
            setPreprocessingRules: (preprocessingRulesMapDict) => setStoreStateAction({ preprocessingRules: preprocessingRulesMapDict }),
            setMissingValueRules: (missingValueRulesMapDict) => setStoreStateAction({ missingValueRules: missingValueRulesMapDict }),
            nextStep: () => setStoreStateAction((currentStoreStateData) => ({ currentStep: currentStoreStateData.currentStep + 1 })),
            prevStep: () => setStoreStateAction((currentStoreStateData) => ({ currentStep: currentStoreStateData.currentStep - 1 })),
            setStep4Cache: (step4CacheDataObj, paramsHashString) => setStoreStateAction({ step4Cache: step4CacheDataObj, lastRunParamsHash: paramsHashString }),
            setFileData: (datasetColumnsListArray, datasetRowsListArray, loadedFileNameStr) => setStoreStateAction({ 
                columns: datasetColumnsListArray, 
                previewData: datasetRowsListArray, 
                fileName: loadedFileNameStr,
                dpFields: createInitialDPFields(datasetColumnsListArray) 
            }),
            clearFileData: () => setStoreStateAction({ 
                dataFile: null,                                                      
                columns: [],
                previewData: [],
                fileName: undefined,
                lastUploadDiagnostics: null,
                privacyMode: null,
                preprocessingRules: {},
                missingValueRules: {},
                dpFields: [],
                datasetColumnNumericValuesMap: {},
                riskSubgroupFilters: {}, // ★ 新增：換一份資料集，原欄位名稱可能已不存在，條件一併清空
                columnCategoricalUniqueValues: {}, // ★ 新增：換一份資料集，快取之相異值已不適用，一併清空觸發重新掃描
                isColumnCategoricalValuesScanning: false,
                // ★ 累計隱私預算追蹤與資料集綁定：換一份資料集即視為全新的追蹤起點，歸零重新累計。
                dpAccumulatedEpsilon: 0,
                dpAccumulatedDelta: 0
            }),
            setLastUploadDiagnostics: (diagnosticsSnapshotObj) => setStoreStateAction({
                lastUploadDiagnostics: { ...diagnosticsSnapshotObj, detectedAt: new Date().toISOString() }
            }),
            setStepValidation: (isValidBooleanStatus, errorMessageString) => setStoreStateAction({ isStepValid: isValidBooleanStatus, stepErrorMessage: errorMessageString }),
            setDpFields: (dpFieldsListArray) => setStoreStateAction({ dpFields: dpFieldsListArray }),
            setDatasetColumnNumericValuesMap: (numericValuesMapDict) => setStoreStateAction({ datasetColumnNumericValuesMap: numericValuesMapDict }),
            setRiskSubgroupFilters: (riskSubgroupFiltersMapDict) => setStoreStateAction({ riskSubgroupFilters: riskSubgroupFiltersMapDict }), // ★ 新增
            setColumnCategoricalUniqueValues: (columnCategoricalUniqueValuesMapDict) => setStoreStateAction({ columnCategoricalUniqueValues: columnCategoricalUniqueValuesMapDict }), // ★ 新增
            setIsColumnCategoricalValuesScanning: (isScanningStatus) => setStoreStateAction({ isColumnCategoricalValuesScanning: isScanningStatus }), // ★ 新增
            resetWorkspace: () => setStoreStateAction({
                dataFile: null,                                                  
                currentStep: MIN_STEP_INDEX,
                privacyMode: null,
                columns: [],
                previewData: [],
                preprocessingRules: {},
                missingValueRules: {},
                fileName: undefined,
                lastUploadDiagnostics: null,
                columnRoles: {},
                columnTypes: {},
                dpFields: [],
                datasetColumnNumericValuesMap: {},
                riskSubgroupFilters: {}, // ★ 新增
                columnCategoricalUniqueValues: {}, // ★ 新增
                isColumnCategoricalValuesScanning: false, // ★ 新增
                step4Cache: null,
                lastRunParamsHash: null,
                isStepValid: true,
                stepErrorMessage: null,
                kAnonymityFields: [],
                kAnonymityHierarchies: [],
                fieldAttributes: {},
                maskingRules: {},
                generalizationRules: {},
                generalizationHierarchies: {},
                categoricalHierarchies: {},
                numericBins: {},
                temporalHierarchies: {},
                dpAccumulatedEpsilon: 0,
                dpAccumulatedDelta: 0
            })
        }
    )
);