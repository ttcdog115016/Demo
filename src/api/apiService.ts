import axios, { type AxiosProgressEvent } from 'axios';

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
  timeoutMs?: number;
  onUploadProgress?: (loadedBytes: number, totalBytes: number | undefined) => void;
}

const buildAxiosRequestConfig = (requestOptions?: ApiRequestOptions) => ({
  signal: requestOptions?.signal,
  timeout: requestOptions?.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  onUploadProgress: requestOptions?.onUploadProgress
    ? (progressEvent: AxiosProgressEvent) => requestOptions.onUploadProgress!(progressEvent.loaded, progressEvent.total)
    : undefined,
});

/** 是否為使用者按下「取消運算」（AbortController.abort）造成的中斷 */
export const isApiRequestCanceled = (error: unknown): boolean =>
  axios.isCancel(error) || (error as { name?: string } | null)?.name === 'CanceledError';

/** 是否為超過 timeout 仍未完成而中斷 */
export const isApiRequestTimeout = (error: unknown): boolean => {
  const errorCode = (error as { code?: string } | null)?.code;
  return errorCode === 'ECONNABORTED' || errorCode === 'ETIMEDOUT';
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
  sensitivity_source: 'user' | null;
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
    
    let qualityReport: KAnonymityQualityReport | undefined;

    if (reportString) {
      try {
        qualityReport = typeof reportString === 'string' 
          ? JSON.parse(reportString) 
          : (reportString as KAnonymityQualityReport);
      } catch (parseError) {
        console.warn('解析 x-quality-report Header 失敗:', parseError);
      }
    }

    // 解析檔名
    const disposition = 
      response.headers['content-disposition'] || 
      response.headers['Content-Disposition'];
      
    let filename = 'anonymized_output.csv';
    if (disposition && typeof disposition === 'string' && disposition.includes('filename=')) {
      filename = disposition.split('filename=')[1].replace(/"/g, '').trim();
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

    let qualityReport: DpQualityReport | undefined;

    if (reportString) {
      try {
        qualityReport = typeof reportString === 'string'
          ? JSON.parse(reportString)
          : (reportString as DpQualityReport);
      } catch (parseError) {
        console.warn('解析 x-budget-report Header 失敗:', parseError);
      }
    }

    // 解析檔名
    const disposition = 
      response.headers['content-disposition'] || 
      response.headers['Content-Disposition'];
      
    let filename = 'dp_output.csv';
    if (disposition && typeof disposition === 'string' && disposition.includes('filename=')) {
      filename = disposition.split('filename=')[1].replace(/"/g, '').trim();
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
}

// 對應後端 CapReport（CAP 前後對比，/risk/cap 專用）
export interface CapReport {
  cap_before: number;
  cap_after: number;
  n_original: number;
  n_processed: number;
  message: string;
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

// 對應後端 ReportRequest：無狀態端點，把前面風險端點回傳的報告原封帶回來即可，
// attack_report／cap_report 至少要提供一包（兩個都給，PDF 會兩節都產出）。
export interface ReportRequestPayload {
  task_id?: string;
  attack_report?: AttackReport | null;
  cap_report?: CapReport | null;
}

export interface ReportResponse {
  success: boolean;
  data?: Blob;
  filename?: string;
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

/**
 * 彙整風險量測結果、產出 PDF 報告 — POST /api/v1/report
 * 無狀態端點：JSON body（不是 multipart），把前面 runRiskKAnonymity／runRiskDp／
 * runRiskCap 回傳的 report 原封帶回來即可，attack_report／cap_report 至少須提供一包。
 * @param payload - { task_id?, attack_report?, cap_report? }，格式參照
 *                  docs/manual_test/report_request.json
 */
export const runReport = async (
  payload: ReportRequestPayload,
  requestOptions?: ApiRequestOptions
): Promise<ReportResponse> => {
  try {
    const response = await axios.post('/api/v1/report', payload, {
      responseType: 'blob',
      ...buildAxiosRequestConfig(requestOptions),
    });

    const disposition =
      response.headers['content-disposition'] ||
      response.headers['Content-Disposition'];

    let filename = `risk_report_${payload.task_id ?? 'risk-report'}.pdf`;
    if (disposition && typeof disposition === 'string' && disposition.includes('filename=')) {
      filename = disposition.split('filename=')[1].replace(/"/g, '').trim();
    }

    const outputBlob = new Blob([response.data], { type: 'application/pdf' });

    return { success: true, data: outputBlob, filename };
  } catch (error) {
    console.error('風險報告 PDF 產出失敗:', error);
    return { success: false, error };
  }
};

// ============================================================================
// 身分驗證（2026-10-02 新增，串接後端 POST /api/v1/auth/login）
// ============================================================================

/** 後端 AuthManager 的角色（app/governance/auth.py）：admin／analyst／viewer */
export type BackendUserRole = 'admin' | 'analyst' | 'viewer';

export type BackendLoginResult =
  | { success: true; username: string; role: BackendUserRole }
  | { success: false; reason: 'invalid_credentials' | 'unreachable' | 'unknown_role' | 'error'; status?: number; error?: unknown };

/**
 * 登入：POST /api/v1/auth/login（JSON body {username, password}）
 * 成功回 200 {username, role, message}；帳密錯誤 401。後端目前不發 token，其餘端點也未掛權限檢查，
 * 故登入結果只用來決定前端角色與顯示名稱。帳號由部署者於後端以 CLI 建立（見功能說明文件）。
 * 回應狀態 502／503／504 或無回應（Vite／nginx 代理連不到後端）視為「無法連線」。
 */
export const loginWithBackend = async (username: string, password: string): Promise<BackendLoginResult> => {
  try {
    const response = await axios.post<{ username: string; role: string; message?: string }>(
      '/api/v1/auth/login',
      { username, password }
    );
    const roleValue = String(response.data?.role || '').toLowerCase();
    if (roleValue !== 'admin' && roleValue !== 'analyst' && roleValue !== 'viewer') {
      return { success: false, reason: 'unknown_role', status: response.status };
    }
    return { success: true, username: response.data.username || username, role: roleValue };
  } catch (error) {
    const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (statusCode === 401) return { success: false, reason: 'invalid_credentials', status: statusCode };
    if (statusCode === undefined || statusCode === 502 || statusCode === 503 || statusCode === 504) {
      return { success: false, reason: 'unreachable', status: statusCode, error };
    }
    console.error('登入 API 呼叫失敗:', error);
    return { success: false, reason: 'error', status: statusCode, error };
  }
};
