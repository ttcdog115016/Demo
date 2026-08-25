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