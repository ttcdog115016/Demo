import axios, { type AxiosProgressEvent } from 'axios';

/**
 * ★ 2026-10-29：後端回 `attachment; filename="x.csv"; filename*=UTF-8''x.csv`（core/dataset_io.py），
 *   原本以 split('filename=') 取值會連後面的 filename* 一起吃進來；改為優先取 filename*（可含中文），其次 filename。
 */
export const parseContentDispositionFilename = (dispositionText: string): string | null => {
  const encodedMatch = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(dispositionText);
  if (encodedMatch) {
    try { return decodeURIComponent(encodedMatch[1].trim().replace(/^"|"$/g, '')); } catch { /* 解碼失敗改用 filename */ }
  }
  const plainMatch = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(dispositionText);
  return plainMatch ? (plainMatch[2] ?? plainMatch[1]).trim() : null;
};

// ============================================================================
// 共用請求選項：逾時、取消、上傳進度
// ============================================================================
// ★ 2026-09-30：先前所有 API 呼叫都沒有逾時、也不能取消；後端或 cloudflared 通道卡住時，
//   畫面只能一直轉圈，使用者只能重新整理頁面。以下每支 run* 函式都多收一個選填的
//   requestOptions：signal（搭配 AbortController 讓使用者按「取消運算」）、timeoutMs（逾時）、
//   onUploadProgress（顯示已上傳多少 MB）。不傳時行為與原本相同，只多了預設逾時。

/** 單一請求預設逾時：15 分鐘（100 萬筆在本機後端約 20 秒內完成，留足餘裕給較慢的環境與風險評估） */
export const DEFAULT_API_TIMEOUT_MS = 15 * 60 * 1000;

export interface ApiRequestOptions {
  signal?: AbortSignal;
  /** ★ 2026-10-31：這一輪運算的識別碼（X-Client-Run-Id），按「取消運算」時用來通知後端停止 */
  clientRunId?: string;
  timeoutMs?: number;
  onUploadProgress?: (loadedBytes: number, totalBytes: number | undefined) => void;
}

const buildAxiosRequestConfig = (requestOptions?: ApiRequestOptions) => ({
  signal: requestOptions?.signal,
  headers: requestOptions?.clientRunId ? { 'X-Client-Run-Id': requestOptions.clientRunId } : undefined,
  timeout: requestOptions?.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  onUploadProgress: requestOptions?.onUploadProgress
    ? (progressEvent: AxiosProgressEvent) => requestOptions.onUploadProgress!(progressEvent.loaded, progressEvent.total)
    : undefined,
});

/** 是否為使用者按下「取消運算」（AbortController.abort）造成的中斷 */
export const isApiRequestCanceled = (error: unknown): boolean =>
  axios.isCancel(error) || (error as { name?: string } | null)?.name === 'CanceledError';

/** 是否為超過 timeout 仍未完成而中斷
 * ★ 2026-11-02：axios 的「連線被中止（Request aborted）」與「逾時」都用 ECONNABORTED，
 *   只有逾時的訊息含 timeout（timeout of N ms exceeded），以此區分，避免中止被誤報成「15 分鐘逾時」。
 */
export const isApiRequestTimeout = (error: unknown): boolean => {
  const errorRecord = error as { code?: string; message?: string } | null;
  if (errorRecord?.code === 'ETIMEDOUT') return true;
  return errorRecord?.code === 'ECONNABORTED' && /timeout/i.test(errorRecord.message ?? '');
};

/** ★ 2026-11-02：後端未回傳去識別化報告時的錯誤訊息（管線顯示失敗卡片、不寫合規紀錄） */
export const MISSING_QUALITY_REPORT_MESSAGE = '後端未回傳品質報告，無法確認處理結果是否合規。';
export const MISSING_BUDGET_REPORT_MESSAGE = '後端未回傳隱私預算報告，無法確認本次消耗的隱私預算。';

/** ★ 2026-11-02：解析 X-Quality-Report／X-Budget-Report 標頭；缺少、無法解析或不是物件時回傳 undefined */
const parseBackendReportHeader = <ReportType>(headerValue: unknown, headerName: string): ReportType | undefined => {
  if (!headerValue) return undefined;
  let parsedValue: unknown = headerValue;
  if (typeof headerValue === 'string') {
    try {
      parsedValue = JSON.parse(headerValue);
    } catch (parseError) {
      console.warn(`解析 ${headerName} Header 失敗:`, parseError);
      return undefined;
    }
  }
  return parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue) ? parsedValue as ReportType : undefined;
};

// ============================================================================
// K-Anonymity (K-匿名化) 相關介面宣告
// ============================================================================

// 2. 根據 API 規格書 2-5 定義完整的品質報告型別
export interface KAnonymityQualityReport {
  is_valid: boolean;
  k_passed: boolean;
  l_passed: boolean;
  t_passed: boolean;
  suppression_rate_percent: number;
  suppression_unit: 'row' | 'cell';
  suppressed_count?: number;          // 被抑制的列數（row）或格數（cell）
  suppression_total_count?: number;   // 抑制率分母：總列數（row）或總格數（cell）
  hash_algorithm?: string;            // 本次假名化採用的雜湊演算法（v3 報告新增）
  hash_salted?: boolean;              // 本次雜湊是否加鹽（鹽值由部署環境 .env 的 OPEN_PETS_DEFAULT_SALT 提供）
  message: string;
  recommendations: unknown[];
  applied_defaults: unknown[];        // 設定檔未指定、由系統套用預設值的項目
}

// 3. 定義回傳值的型別 (回傳成功的 Blob 資料，供前端自由處置)
export interface KAnonymityResponse {
  success: boolean;
  report?: KAnonymityQualityReport;
  data?: Blob; // 可選擇性將處理完的 Blob 傳回前端狀態
  filename?: string;
  error?: unknown;
}

// ============================================================================
// Differential Privacy (差分隱私) 相關介面宣告
// ============================================================================

// 根據 Open-PETs API 交付文件 3-5 節定義之預算報告 (X-Budget-Report) 型別
export interface DpPerColumnBudgetReport {
  column: string;
  type: 'continuous' | 'categorical' | 'datetime';
  // ★ 2026-10-01：v3 實際回傳 DiscreteLaplace／DiscreteGaussian／k-RR（先前型別只寫 'Laplace'）
  mechanism: 'DiscreteLaplace' | 'DiscreteGaussian' | 'k-RR' | string;
  epsilon: number;
  delta?: number;                     // 該欄實際採用的 δ（未指定時取自 default_delta）
  // 換算為整數個刻度後的敏感度，非設定檔原始申報值（例如薪資申報 125000、刻度 1000 → 125）
  sensitivity: number | null;
  sensitivity_source: 'user' | 'system' | null; // ★ 2026-10-29 後端亦可能回 'system'（dp/types.py）
  minimum_unit?: number;              // 連續值欄位的刻度
  noise_unit?: string;                // 日期欄位的雜訊單位
  noise_step?: number;                // 日期欄位幾個 noise_unit 算一格
  out_of_bounds_strategy?: string | null; // clamp／fold／wrap，null 表示未設上下限
}

export interface DpQualityReport {
  consumed_epsilon: number;
  consumed_delta: number;
  accumulated_epsilon: number;
  accumulated_delta: number;
  message: string;
  per_column: DpPerColumnBudgetReport[];
}

export interface DpResponse {
  success: boolean;
  report?: DpQualityReport;
  data?: Blob;
  filename?: string;
  error?: unknown;
}

// ============================================================================
// API 呼叫方法實作
// ============================================================================

/**
 * 呼叫 K-匿名化 API (已移除自動觸發下載邏輯)
 * @param dataFile - 使用者上傳的原始資料集檔案
 * @param configFile - 設定檔（所有參數皆寫在 k_anonymity 區塊內）
 * ★ 2026-10-01：依後端 2_操作說明.md v3「API 表單不再提供個別參數欄位」，表單只送 file／config；
 *   先前另送的 k／l／t／salt_key／suppression_*／cell_fill 表單欄位已移除（後端不讀，鹽值僅由部署環境 .env 提供）。
 */
export const runKAnonymity = async (
  dataFile: File,
  configFile: File,
  requestOptions?: ApiRequestOptions
): Promise<KAnonymityResponse> => {
  try {
    const formData = new FormData();
    formData.append('file', dataFile);
    formData.append('config', configFile);

    const response = await axios.post(
      '/api/v1/k-anonymity',
      formData,
      { responseType: 'blob', ...buildAxiosRequestConfig(requestOptions) }
    );

    // 讀取 Header 中的報告數據
    const reportString = 
      response.headers['x-quality-report'] || 
      response.headers['X-Quality-Report'];
    
    // ★ 2026-11-02：沒有品質報告（或無法解析）時視為失敗。先前改用前端捏造的 is_valid:true 報告，
    //   畫面會顯示「合規」並寫入合規紀錄，但其實沒有任何依據。
    const qualityReport = parseBackendReportHeader<KAnonymityQualityReport>(reportString, 'x-quality-report');
    if (!qualityReport) {
      return { success: false, error: new Error(MISSING_QUALITY_REPORT_MESSAGE) };
    }

    // 解析檔名
    const disposition = 
      response.headers['content-disposition'] || 
      response.headers['Content-Disposition'];
      
    let filename = 'anonymized_output.csv';
    if (disposition && typeof disposition === 'string' && disposition.includes('filename=')) {
      filename = parseContentDispositionFilename(disposition) ?? filename;
    }

    // 建立 Blob 物件但不自動觸發 DOM 下載行為
    const outputBlob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });

    return {
      success: true,
      report: qualityReport,
      data: outputBlob,
      filename: filename
    };

  } catch (error) {
    console.error('K-匿名化處理失敗:', error);
    return { success: false, error };
  }
};

/**
 * 呼叫差分隱私 (Differential Privacy) API
 * @param dataFile - 使用者上傳的原始資料集檔案
 * @param configFile - 設定檔（column_budgets、accumulated_epsilon／accumulated_delta、default_delta 皆在 differential_privacy 區塊內）
 * ★ 2026-10-01：表單只送 file／config，先前另送的 accumulated_*／default_delta 表單欄位已移除（同上）。
 */
export const runDifferentialPrivacy = async (
  dataFile: File,
  configFile: File,
  requestOptions?: ApiRequestOptions
): Promise<DpResponse> => {
  try {
    const formData = new FormData();
    formData.append('file', dataFile);
    formData.append('config', configFile);

    const response = await axios.post(
      '/api/v1/dp',
      formData,
      { responseType: 'blob', ...buildAxiosRequestConfig(requestOptions) }
    );

    // 讀取 Header 中的預算報告數據 (規範對照: Open-PETs API 3-2 節，DP 回應標頭為 X-Budget-Report，非 X-Quality-Report)
    const reportString =
      response.headers['x-budget-report'] ||
      response.headers['X-Budget-Report'];

    // ★ 2026-11-02：沒有預算報告（或無法解析）時視為失敗，不以前端推算的 ε／δ 代替（同上）
    const qualityReport = parseBackendReportHeader<DpQualityReport>(reportString, 'x-budget-report');
    if (!qualityReport) {
      return { success: false, error: new Error(MISSING_BUDGET_REPORT_MESSAGE) };
    }

    // 解析檔名
    const disposition = 
      response.headers['content-disposition'] || 
      response.headers['Content-Disposition'];
      
    let filename = 'dp_output.csv';
    if (disposition && typeof disposition === 'string' && disposition.includes('filename=')) {
      filename = parseContentDispositionFilename(disposition) ?? filename;
    }

    // 建立 Blob 物件但不自動觸發 DOM 下載行為
    const outputBlob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });

    return {
      success: true,
      report: qualityReport,
      data: outputBlob,
      filename: filename
    };

  } catch (error) {
    console.error('差分隱私處理失敗:', error);
    return { success: false, error };
  }
};
// ============================================================================
// 資料前處理 (Preprocess)
// ============================================================================

export interface PreprocessResponse {
  success: boolean;
  data?: Blob;
  filename?: string;
  error?: unknown;
}

/**
 * 呼叫資料前處理 API — POST /api/v1/preprocess（★ 2026-10-27 最終版後端新增）
 * 依設定檔 preprocess 區塊的清單，由上往下對指定欄位執行清洗／缺失值處理，沿用輸入格式（CSV）回傳；
 * 無報告標頭。表單欄位與 /k-anonymity 相同：file／config。
 * @param dataFile - 原始資料集
 * @param configFile - 大包設定檔，preprocess 區塊 enabled=true（組裝見 utils/preprocessConfig.ts）
 */
export const runPreprocess = async (
  dataFile: File,
  configFile: File,
  requestOptions?: ApiRequestOptions
): Promise<PreprocessResponse> => {
  try {
    const formData = new FormData();
    formData.append('file', dataFile);
    formData.append('config', configFile);

    const response = await axios.post(
      '/api/v1/preprocess',
      formData,
      { responseType: 'blob', ...buildAxiosRequestConfig(requestOptions) }
    );

    const disposition = response.headers['content-disposition'] || response.headers['Content-Disposition'];
    let filename = 'preprocessed_output.csv';
    if (disposition && typeof disposition === 'string' && disposition.includes('filename=')) {
      filename = parseContentDispositionFilename(disposition) ?? filename;
    }

    return { success: true, data: new Blob([response.data], { type: 'text/csv;charset=utf-8;' }), filename };
  } catch (error) {
    console.error('資料前處理失敗:', error);
    return { success: false, error };
  }
};

// ============================================================================
// 再識別風險評估 (Risk Assessment) 相關介面宣告
//
// 注意：以下四個端點跟上面的 /api/v1/k-anonymity、/api/v1/dp 是完全不同的一組 API，
// 欄位名稱、config 格式都不一樣，不能沿用上面兩個函式的假設：
//   - multipart 欄位名稱是 original／config／processed，不是 file／config
//   - config 一律是「大包」JSON（version/dataset + 對應區塊），不是扁平參數
//   - DP 區塊欄位是 epsilon_budget／delta_budget（v1.2.0），不是 v1.0.1 的 epsilon／delta
//   - K-匿名化在這裡也是大包格式（risk_attacks + k_anonymity 兩區塊），不是扁平格式
// 詳細格式請對照後端 v1.2.0 原始碼自帶的官方範例：
// docs/manual_test/config_risk_k_anonymity.json、config_risk_dp.json、
// config_risk_cap.json、report_request.json
// ============================================================================

// 對應後端 app/engines/risk/types.py 的 ProcessingConfig：三攻擊端點回填「這次用了什麼
// 去識別方法與參數」評出來的，供報告如實揭露，不是呼叫方手打。
export interface ProcessingConfig {
  method: 'k-anon' | 'dp';
  deid_params: Record<string, unknown>;
  risk_params: Record<string, unknown>;
}

// 對應後端 AttackReport（三攻擊風險，/risk/k-anonymity 與 /risk/dp 共用同一個回應形狀）
export interface AttackReport {
  singling_out_risk: number;
  linkability_risk: number;
  inference_risk: number;
  sample_size: number;
  linkability_evaluated: number;
  n_repeats: number;
  overlap_ratio: number;
  processing_config: ProcessingConfig | null;
  message: string;
  elapsed_seconds?: number;           // ★ 2026-10-29 後端回傳的運算秒數
}

// 對應後端 CapReport（CAP 前後對比，/risk/cap 專用）
export interface CapReport {
  cap_before: number;
  cap_after: number;
  n_original: number;
  n_processed: number;
  message: string;
  elapsed_seconds?: number;           // ★ 2026-10-29 後端回傳的運算秒數
  // ★ 2026-10-06 以下為前端自行計算、後端不會回傳（見 utils/capBaseline.ts）：
  /** 亂猜基線：處理後資料中最常見敏感值的佔比（CAP 的下限） */
  cap_baseline_after?: number | null;
  /** 扣除亂猜基線後的 CAP 風險 (cap_after − 基線) ÷ (1 − 基線)，用於整體風險等級 */
  cap_after_excess?: number | null;
  /** 這份 CAP 是以哪個敏感欄位評估的（多輪取最大值時記錄最高的那一輪） */
  cap_sensitive_column?: string;
}

export interface RiskAttackResponse {
  success: boolean;
  report?: AttackReport;
  error?: unknown;
}

export interface RiskCapResponse {
  success: boolean;
  report?: CapReport;
  error?: unknown;
}

/**
 * 三攻擊風險評估（K-匿名 Mode1）— POST /api/v1/risk/k-anonymity
 * 只上傳原始資料，引擎自己切 80/20、對 80% 以 K-匿名產 syn、20% 為真 holdout 跑三攻擊。
 * @param originalFile - 原始資料集（未去識別）；後端欄位名稱固定為 original
 * @param configFile - 大包設定檔，須同時開啟 risk_attacks 與 k_anonymity 兩區塊（其餘兩塊不
 *                     得開啟），格式參照 docs/manual_test/config_risk_k_anonymity.json
 */
export const runRiskKAnonymity = async (
  originalFile: File,
  configFile: File,
  requestOptions?: ApiRequestOptions
): Promise<RiskAttackResponse> => {
  try {
    const formData = new FormData();
    formData.append('original', originalFile);
    formData.append('config', configFile);
    // 參數（n_iter／ctrl_ratio／seed／子群體條件…）一律寫在 config 檔內，不另開表單欄位

    const response = await axios.post<AttackReport>(
      '/api/v1/risk/k-anonymity',
      formData,
      buildAxiosRequestConfig(requestOptions)
    );

    return { success: true, report: response.data };
  } catch (error) {
    console.error('三攻擊風險評估（K-匿名）失敗:', error);
    return { success: false, error };
  }
};

/**
 * 三攻擊風險評估（DP Mode1）— POST /api/v1/risk/dp
 * 與 K-匿名端點差別僅在去識別方法：改開 differential_privacy 區塊，DP 無鹽值需求。
 * @param originalFile - 原始資料集（未去識別）；後端欄位名稱固定為 original
 * @param configFile - 大包設定檔，須同時開啟 risk_attacks 與 differential_privacy 兩區塊，
 *                     欄位為 epsilon_budget／delta_budget（v1.2.0 格式，非 v1.0.1 的
 *                     epsilon／delta），格式參照 docs/manual_test/config_risk_dp.json
 */
export const runRiskDp = async (
  originalFile: File,
  configFile: File,
  requestOptions?: ApiRequestOptions
): Promise<RiskAttackResponse> => {
  try {
    const formData = new FormData();
    formData.append('original', originalFile);
    formData.append('config', configFile);

    const response = await axios.post<AttackReport>(
      '/api/v1/risk/dp',
      formData,
      buildAxiosRequestConfig(requestOptions)
    );

    return { success: true, report: response.data };
  } catch (error) {
    console.error('三攻擊風險評估（DP）失敗:', error);
    return { success: false, error };
  }
};

/**
 * CAP 前後對比 — POST /api/v1/risk/cap
 * 需同時上傳原始與「已經去識別完成」的成品兩份資料，引擎本身不做去識別，只各自算一次
 * 正確歸因機率並對比。
 * @param originalFile - 原始資料集（未去識別）；後端欄位名稱固定為 original
 * @param processedFile - 去識別後資料集（呼叫方自備的成品）；後端欄位名稱固定為 processed
 * @param configFile - 大包設定檔，只需開啟 risk_cap 區塊（其餘三塊不得開啟），格式參照
 *                     docs/manual_test/config_risk_cap.json
 */
export const runRiskCap = async (
  originalFile: File,
  processedFile: File,
  configFile: File,
  requestOptions?: ApiRequestOptions
): Promise<RiskCapResponse> => {
  try {
    const formData = new FormData();
    formData.append('original', originalFile);
    formData.append('processed', processedFile);
    formData.append('config', configFile);

    const response = await axios.post<CapReport>(
      '/api/v1/risk/cap',
      formData,
      buildAxiosRequestConfig(requestOptions)
    );

    return { success: true, report: response.data };
  } catch (error) {
    console.error('CAP 前後對比失敗:', error);
    return { success: false, error };
  }
};

