import axios from 'axios';

// ============================================================================
// K-Anonymity (K-匿名化) 相關介面宣告
// ============================================================================

// 1. 定義選填參數的型別 (根據 API 規格書 2-1)
export interface KAnonymityOptions {
  k?: number;
  l?: number;
  t?: number;
  salt_key?: string;
  suppression_limit_percent?: number;
  limit_exceeded_action?: 'stop_and_error' | 'allow_with_warning';
  suppression_method?: 'row_suppression' | 'cell_suppression';
  cell_fill?: 'star' | 'missing';
}

// 2. 根據 API 規格書 2-5 定義完整的品質報告型別
export interface KAnonymityQualityReport {
  is_valid: boolean;
  k_passed: boolean;
  l_passed: boolean;
  t_passed: boolean;
  suppression_rate_percent: number;
  suppression_unit: 'row' | 'cell';
  message: string;
  recommendations: unknown[];
  applied_defaults: unknown[];
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

// 根據 Open-PETs API 交付文件 3-1 節：逐欄的型別、ε、δ 一律於 config 設定檔 (column_budgets) 指定，
// 此處僅為跨批次累計追蹤與全域補值之選填參數，無 epsilon／delta／simulated_query_count 欄位
export interface DifferentialPrivacyOptions {
  accumulated_epsilon?: number;
  accumulated_delta?: number;
  default_delta?: number;
}

// 根據 Open-PETs API 交付文件 3-5 節定義之預算報告 (X-Budget-Report) 型別
export interface DpPerColumnBudgetReport {
  column: string;
  type: 'continuous' | 'categorical' | 'datetime';
  mechanism: 'Laplace' | 'k-RR';
  epsilon: number;
  sensitivity: number | null;
  sensitivity_source: 'user' | null;
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
 * @param configFile - 使用者上傳的欄位設定檔
 * @param options - 選填參數物件
 */
export const runKAnonymity = async (
  dataFile: File,
  configFile: File,
  options: KAnonymityOptions = {}
): Promise<KAnonymityResponse> => {
  try {
    const formData = new FormData();
    formData.append('file', dataFile);
    formData.append('config', configFile);

    if (options.k !== undefined) formData.append('k', options.k.toString());
    if (options.l !== undefined) formData.append('l', options.l.toString());
    if (options.t !== undefined) formData.append('t', options.t.toString());
    if (options.salt_key) formData.append('salt_key', options.salt_key);
    
    if (options.suppression_limit_percent !== undefined) {
      formData.append('suppression_limit_percent', options.suppression_limit_percent.toString());
    }
    if (options.limit_exceeded_action) {
      formData.append('limit_exceeded_action', options.limit_exceeded_action);
    }
    if (options.suppression_method) {
      formData.append('suppression_method', options.suppression_method);
    }
    if (options.cell_fill) {
      formData.append('cell_fill', options.cell_fill);
    }
    
    const response = await axios.post(
      '/api/v1/k-anonymity',
      formData,
      { responseType: 'blob' }
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
 * @param configFile - 使用者上傳的欄位預算設定檔 (column_budgets)
 * @param options - 選填參數物件 (accumulated_epsilon、accumulated_delta、default_delta)
 */
export const runDifferentialPrivacy = async (
  dataFile: File,
  configFile: File,
  options: DifferentialPrivacyOptions = {}
): Promise<DpResponse> => {
  try {
    const formData = new FormData();
    formData.append('file', dataFile);
    formData.append('config', configFile);

    if (options.accumulated_epsilon !== undefined) formData.append('accumulated_epsilon', options.accumulated_epsilon.toString());
    if (options.accumulated_delta !== undefined) formData.append('accumulated_delta', options.accumulated_delta.toString());
    if (options.default_delta !== undefined) formData.append('default_delta', options.default_delta.toString());

    const response = await axios.post(
      '/api/v1/dp',
      formData,
      { responseType: 'blob' }
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
  configFile: File
): Promise<RiskAttackResponse> => {
  try {
    const formData = new FormData();
    formData.append('original', originalFile);
    formData.append('config', configFile);
    // 參數（n_iter／ctrl_ratio／seed／子群體條件…）一律寫在 config 檔內，不另開表單欄位

    const response = await axios.post<AttackReport>(
      '/api/v1/risk/k-anonymity',
      formData
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
  configFile: File
): Promise<RiskAttackResponse> => {
  try {
    const formData = new FormData();
    formData.append('original', originalFile);
    formData.append('config', configFile);

    const response = await axios.post<AttackReport>(
      '/api/v1/risk/dp',
      formData
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
  configFile: File
): Promise<RiskCapResponse> => {
  try {
    const formData = new FormData();
    formData.append('original', originalFile);
    formData.append('processed', processedFile);
    formData.append('config', configFile);

    const response = await axios.post<CapReport>(
      '/api/v1/risk/cap',
      formData
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
  payload: ReportRequestPayload
): Promise<ReportResponse> => {
  try {
    const response = await axios.post('/api/v1/report', payload, {
      responseType: 'blob',
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
