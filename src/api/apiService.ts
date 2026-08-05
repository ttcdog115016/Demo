import axios from 'axios';

// 建立 Axios 實體，統一設定 API 根目錄與 Header
const apiClient = axios.create({
  baseURL: 'http://localhost:8080/api/v1', // ⚠️ 未來 IT 給您真實網址，只要改這裡就好！
  headers: {
    'Content-Type': 'application/json',
  },
});

export const PrivacyApi = {
  /**
   * 1. 上傳資料集 (對應 OpenAPI: POST /dataset/upload)
   * 在 Step 1 讓使用者上傳 CSV 檔案，取得 dataset_id
   */
  uploadDataset: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    // Axios 傳送 FormData 時，建議明確指定 headers
    const response = await apiClient.post('/dataset/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    
    return response.data; // 預期回傳 { status: "success", dataset_id: "...", columns: [...] }
  },

  /**
   * 2. 評估隱私風險 (對應 OpenAPI: POST /privacy/evaluate)
   * 在 Step 4 進入前，將整理好的 JSON 參數整包送給後端運算
   * 
   * @param payload 這裡請直接帶入您前端 generateExportJSON() 產生出來的那包 JSON 格式
   */
  evaluatePrivacy: async (payload: Record<string, any>) => {
    console.log('🚀 準備發送給後端的評估資料：', payload);
    const response = await apiClient.post('/privacy/evaluate', payload);
    
    return response.data; // 預期回傳儀表板需要的 audit_metrics 與 preview_data 等資訊
  },

  /**
   * 3. 下載安全資料集 (對應 OpenAPI: POST /privacy/export)
   * 拿著 Evaluate 算完回傳的 job_id，向後端索取 CSV 檔案下載
   */
  exportDataset: async (jobId: string, filename: string = 'safe_dataset.csv') => {
    console.log(`📥 準備下載資料集，Job ID: ${jobId}`);
    
    const response = await apiClient.post(
      '/privacy/export',
      { job_id: jobId },
      { 
        responseType: 'blob' // 🌟 非常重要：告訴 Axios 這是一個二進制檔案流，不要當成純文字解析
      } 
    );

    // 瀏覽器端處理二進制檔案流下載的標準寫法
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    
    // 清理 DOM 與記憶體
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },
};