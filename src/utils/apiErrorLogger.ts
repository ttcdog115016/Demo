/**
 * ============================================================================
 * 檔案名稱 (File): apiErrorLogger.ts
 * 模組功能 (Description): 全站 API 錯誤診斷紀錄的中央儲存與匯出工具。
 *
 * 背景：外部測試人員回報「有時候會出現嚴重錯誤」，但團隊只看得到後端簡易的 HTTP
 * 狀態碼 log（如 400 Bad Request），看不到當下實際的 error_code／message／
 * 送出的設定內容，導致每次都要請測試人員回想「剛剛做了什麼」或另外請他們開發者
 * 工具查看，效率很差。
 *
 * 這個模組提供一個與畫面無關的純資料層：只要呼叫 recordApiError()，就會把這次
 * API 失敗的完整診斷資訊（狀態碼、後端錯誤代碼與訊息、送出的設定內容摘要、
 * 當下資料集欄位與編碼偵測結果等）加入記憶體陣列，同時通知所有訂閱者。實際攔截 API 呼叫的邏輯在
 * apiErrorInterceptor.ts，兩者分開讓儲存/匯出邏輯可以被獨立測試、也方便未來
 * 若要換成送到後端集中收集時，只需更換這一個模組。
 * ============================================================================
 */

// ★ 2026-10-29：移除背景送 Google 表單（會把檔名、欄位名稱、設定內容送到第三方）與 localStorage 保存。
//   API 失敗本來就由 apiErrorInterceptor 寫入後端系統維運日誌，管理員在「系統維運日誌」分頁查看；
//   此處只留本次頁面的記憶體紀錄，供 Step4 除錯面板（?debugErrors=1）使用。

// 診斷紀錄單筆項目介面
export interface ApiErrorLogEntry {
    id: string;                                        // 紀錄唯一識別碼
    timestamp: string;                                 // 發生時間 (ISO 字串)
    method: string;                                     // HTTP 方法 (大寫，如 POST)
    url: string;                                        // 呼叫的 API 路徑
    httpStatus?: number;                                // 後端回應之 HTTP 狀態碼
    errorCode?: string;                                 // 後端 error_code (見 app/api/errors.py)
    message?: string;                                   // 後端回應之 message（或退而求其次的例外訊息）
    recommendations?: string[];                         // 後端回應之建議清單 (若有)
    requestPayloadSummary?: Record<string, unknown>;    // 送出內容摘要 (檔案僅記中繼資料，config 附文字內容)
    datasetContext?: {
        fileName?: string;                              // 當下資料集檔名
        columns?: string[];                             // 當下資料集欄位名稱陣列
        detectedEncoding?: string;                      // 上傳時偵測到的編碼標籤
        wasReencoded?: boolean;                         // 上傳時是否因編碼問題被重新編碼為 UTF-8
    };
    privacyMode?: string | null;                        // 發生當下所選之保護模式
    currentStepIndex?: number;                          // 發生當下所在精靈步驟索引
    userAgent: string;                                  // 瀏覽器 User-Agent 字串
    pageUrl: string;                                    // 發生當下之頁面網址
}

type ApiErrorLogSubscriberFn = (newEntry: ApiErrorLogEntry, allEntriesList: ApiErrorLogEntry[]) => void;

/** 舊版存在 localStorage 的鍵名；main.tsx 啟動時清除 */
export const LEGACY_API_ERROR_LOG_STORAGE_KEY = 'openpets_api_error_logs_v1';
const MAX_STORED_LOG_ENTRIES_COUNT = 50; // 僅保留最近 N 筆

let inMemoryApiErrorLogsList: ApiErrorLogEntry[] = [];
const apiErrorLogSubscribersList: ApiErrorLogSubscriberFn[] = [];


const generateUniqueLogEntryId = (): string =>
    `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * 函數名稱: recordApiError
 * 函數功能: 記錄一筆 API 錯誤診斷紀錄的主要進入點；補上時間戳記／識別碼／瀏覽器
 *           環境資訊後寫入記憶體，並通知所有訂閱者。
 */
export const recordApiError = (
    entryDraftObj: Omit<ApiErrorLogEntry, 'id' | 'timestamp' | 'userAgent' | 'pageUrl'>
): ApiErrorLogEntry => {
    const fullLogEntryObj: ApiErrorLogEntry = {
        ...entryDraftObj,
        id: generateUniqueLogEntryId(),
        timestamp: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '(未知瀏覽器)',
        pageUrl: typeof window !== 'undefined' ? window.location.href : '(未知頁面)',
    };

    inMemoryApiErrorLogsList = [...inMemoryApiErrorLogsList, fullLogEntryObj].slice(-MAX_STORED_LOG_ENTRIES_COUNT);

    apiErrorLogSubscribersList.forEach((subscriberFn) => {
        try {
            subscriberFn(fullLogEntryObj, inMemoryApiErrorLogsList);
        } catch (subscriberExecutionErrorObj) {
            console.warn('API 錯誤診斷紀錄訂閱者執行時發生例外:', subscriberExecutionErrorObj);
        }
    });

    return fullLogEntryObj;
};

/**
 * 函數名稱: subscribeToApiErrorLogs
 * 函數功能: 註冊一個「每次新增診斷紀錄時」要被呼叫的回呼函式 (供 UI 元件彈出提示
 *           使用)，回傳取消訂閱函式供元件卸載時呼叫，避免記憶體洩漏。
 */
export const subscribeToApiErrorLogs = (subscriberFn: ApiErrorLogSubscriberFn): (() => void) => {
    apiErrorLogSubscribersList.push(subscriberFn);
    return () => {
        const subscriberIndexValue = apiErrorLogSubscribersList.indexOf(subscriberFn);
        if (subscriberIndexValue >= 0) {
            apiErrorLogSubscribersList.splice(subscriberIndexValue, 1);
        }
    };
};

/** 取得目前累積的所有診斷紀錄 (複本，避免呼叫方直接修改內部陣列)。 */
export const getAllApiErrorLogs = (): ApiErrorLogEntry[] => [...inMemoryApiErrorLogsList];

/** 清除所有已累積的診斷紀錄。 */
export const clearAllApiErrorLogs = (): void => {
    inMemoryApiErrorLogsList = [];
};

/**
 * 函數名稱: buildApiErrorLogExportFileName
 * 函數功能: 產生匯出檔名 (含時間戳記)，方便測試人員多次匯出時不互相覆蓋。
 */
const buildApiErrorLogExportFileName = (): string => {
    const nowDateObj = new Date();
    const padTwoDigits = (numberValue: number): string => String(numberValue).padStart(2, '0');
    return `api_error_log_${nowDateObj.getFullYear()}${padTwoDigits(nowDateObj.getMonth() + 1)}${padTwoDigits(nowDateObj.getDate())}`
        + `_${padTwoDigits(nowDateObj.getHours())}${padTwoDigits(nowDateObj.getMinutes())}${padTwoDigits(nowDateObj.getSeconds())}.json`;
};

/**
 * 函數名稱: downloadAllApiErrorLogsAsFile
 * 函數功能: 將目前累積的所有診斷紀錄包成 JSON 檔案並觸發瀏覽器下載，供測試人員
 *           一鍵匯出、回報給開發團隊。
 */
export const downloadAllApiErrorLogsAsFile = (): void => {
    const logsToExportList = getAllApiErrorLogs();
    const exportedJsonTextContent = JSON.stringify(
        {
            exportedAt: new Date().toISOString(),
            totalEntries: logsToExportList.length,
            entries: logsToExportList,
        },
        null,
        2
    );

    const exportBlobObj = new Blob([exportedJsonTextContent], { type: 'application/json;charset=utf-8;' });
    const objectUrlString = URL.createObjectURL(exportBlobObj);

    const temporaryAnchorElement = document.createElement('a');
    temporaryAnchorElement.href = objectUrlString;
    temporaryAnchorElement.download = buildApiErrorLogExportFileName();
    document.body.appendChild(temporaryAnchorElement);
    temporaryAnchorElement.click();
    document.body.removeChild(temporaryAnchorElement);
    URL.revokeObjectURL(objectUrlString);
};

/**
 * 函數名稱: formatApiErrorLogEntryAsReadableText
 * 函數功能: 將單筆診斷紀錄格式化為適合直接複製、貼到聊天室回報的純文字摘要
 *           (不需要下載檔案即可快速回報單一次錯誤)。
 */
export const formatApiErrorLogEntryAsReadableText = (logEntryObj: ApiErrorLogEntry): string => {
    const textLinesList: string[] = [];
    textLinesList.push('【API 錯誤診斷紀錄】');
    textLinesList.push(`時間: ${logEntryObj.timestamp}`);
    textLinesList.push(`請求: ${logEntryObj.method} ${logEntryObj.url}`);
    if (logEntryObj.httpStatus !== undefined) textLinesList.push(`HTTP 狀態碼: ${logEntryObj.httpStatus}`);
    if (logEntryObj.errorCode) textLinesList.push(`錯誤代碼: ${logEntryObj.errorCode}`);
    if (logEntryObj.message) textLinesList.push(`後端訊息: ${logEntryObj.message}`);
    if (logEntryObj.recommendations && logEntryObj.recommendations.length > 0) {
        textLinesList.push(`建議: ${logEntryObj.recommendations.join('、')}`);
    }
    if (logEntryObj.privacyMode) textLinesList.push(`當前模式: ${logEntryObj.privacyMode}`);
    if (logEntryObj.datasetContext?.fileName) textLinesList.push(`資料檔名: ${logEntryObj.datasetContext.fileName}`);
    if (logEntryObj.datasetContext?.detectedEncoding) {
        textLinesList.push(
            `偵測編碼: ${logEntryObj.datasetContext.detectedEncoding}` +
                (logEntryObj.datasetContext.wasReencoded ? '（已重新編碼為 UTF-8）' : '')
        );
    }
    if (logEntryObj.datasetContext?.columns && logEntryObj.datasetContext.columns.length > 0) {
        textLinesList.push(`欄位: ${logEntryObj.datasetContext.columns.join('、')}`);
    }
    textLinesList.push(`瀏覽器: ${logEntryObj.userAgent}`);
    return textLinesList.join('\n');
};
