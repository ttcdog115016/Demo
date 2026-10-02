/**
 * ============================================================================
 * 檔案名稱 (File): apiErrorInterceptor.ts
 * 模組功能 (Description): 掛在全域 axios 物件上的錯誤攔截器。
 *
 * 目前 apiService.ts 內的每一支 API（K-匿名化、差分隱私、三攻擊風險評估、報告
 * 產出等）都是直接呼叫全域的 axios.post(...)，並非各自的 axios 實例。這裡利用
 * axios.interceptors.response.use() 在全域層級掛一個「回應攔截器」：只要任何一支
 * 呼叫收到非 2xx 回應，就會先經過這裡解析、補齊診斷資訊、寫入 apiErrorLogger，
 * 再將原始錯誤原封不動往下拋，讓既有的 catch 區塊 (apiService.ts、
 * Step4_Result.tsx 內的白話錯誤訊息組裝邏輯) 完全不受影響、行為維持原樣。
 *
 * 只需在應用程式啟動時 (main.tsx) 呼叫一次 registerGlobalApiErrorInterceptor()，
 * 之後任何地方呼叫 axios.get／axios.post 都會自動經過此攔截器，不需要逐一修改
 * 各支 API 函式。
 * ============================================================================
 */
import axios, { type AxiosError } from 'axios';
import { recordApiError } from '../utils/apiErrorLogger';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

// 後端固定回傳格式 (見 app/api/errors.py)：{ error_code, message, recommendations? }；
// RequestValidationError (422) 則另外包成 { error_code: 'ERR_VALIDATION_FAILED', message }，
// 一樣落在這個形狀內，故不需要另外處理 detail 陣列格式。
interface BackendErrorResponseBody {
    error_code?: string;
    message?: string;
    recommendations?: string[];
    detail?: unknown;
}

/**
 * 函數名稱: resolveResponseBodyAsJson
 * 函數功能: K-匿名化／差分隱私／報告產出等呼叫將 axios 的 responseType 設為
 *           'blob' (成功時要接住輸出檔案二進位內容)，這會導致「錯誤回應」的
 *           JSON 內容也被 axios 包成尚未讀取的 Blob，直接讀 error_code／message
 *           會全部讀不到值。這裡與 Step4_Result.tsx 既有的解法一致：先判斷是否
 *           為 Blob，是的話讀成文字後再嘗試 JSON.parse；不是 Blob (例如三攻擊
 *           風險評估等未設定 responseType 的呼叫，axios 已自動解析成物件) 則直接
 *           使用。
 */
const resolveResponseBodyAsJson = async (responseDataValue: unknown): Promise<BackendErrorResponseBody | undefined> => {
    if (typeof Blob !== 'undefined' && responseDataValue instanceof Blob) {
        try {
            const blobTextContent = await responseDataValue.text();
            return JSON.parse(blobTextContent) as BackendErrorResponseBody;
        } catch (blobParseErrorObj) {
            console.warn('API 錯誤攔截器：解析錯誤回應之 Blob 內容失敗:', blobParseErrorObj);
            return undefined;
        }
    }
    if (responseDataValue && typeof responseDataValue === 'object') {
        return responseDataValue as BackendErrorResponseBody;
    }
    return undefined;
};

/**
 * 函數名稱: summarizeRequestPayloadForLogging
 * 函數功能: 將這次請求實際送出的內容整理成適合記錄診斷用的摘要。檔案類欄位
 *           (file／original／processed) 資料量大且可能含個資，僅記錄檔名／大小／
 *           MIME type，不讀取實際內容；但 config 欄位是我們自己組出來的 JSON
 *           設定檔文字，內容對診斷「欄位名稱是否兜得起來」這類問題極有價值，
 *           故額外讀出文字內容一併記錄 (超過長度上限則截斷，避免單筆紀錄過大)。
 */
const CONFIG_PAYLOAD_PREVIEW_MAX_LENGTH = 8000;

const summarizeRequestPayloadForLogging = async (requestDataValue: unknown): Promise<Record<string, unknown>> => {
    const payloadSummaryDict: Record<string, unknown> = {};

    if (typeof FormData !== 'undefined' && requestDataValue instanceof FormData) {
        for (const [fieldKeyName, fieldValue] of requestDataValue.entries()) {
            const isFileLikeValue = typeof Blob !== 'undefined' && fieldValue instanceof Blob;

            if (isFileLikeValue) {
                const fileLikeValueObj = fieldValue as File;
                const fileFieldSummaryDict: Record<string, unknown> = {
                    __type: 'file',
                    name: fileLikeValueObj.name ?? '(未命名檔案)',
                    size: fileLikeValueObj.size,
                    mimeType: fileLikeValueObj.type,
                };

                if (fieldKeyName === 'config') {
                    try {
                        const configTextContent = await fileLikeValueObj.text();
                        fileFieldSummaryDict.contentPreview = configTextContent.length > CONFIG_PAYLOAD_PREVIEW_MAX_LENGTH
                            ? `${configTextContent.slice(0, CONFIG_PAYLOAD_PREVIEW_MAX_LENGTH)}…(內容過長，已截斷)`
                            : configTextContent;
                    } catch (configReadErrorObj) {
                        console.warn('API 錯誤攔截器：讀取 config 欄位文字內容失敗:', configReadErrorObj);
                    }
                }

                payloadSummaryDict[fieldKeyName] = fileFieldSummaryDict;
            } else {
                payloadSummaryDict[fieldKeyName] = fieldValue;
            }
        }
    } else if (requestDataValue && typeof requestDataValue === 'object') {
        // 非 multipart 的請求 (如 /api/v1/report 為 JSON body)，直接整包記錄
        payloadSummaryDict.jsonBody = requestDataValue;
    }

    return payloadSummaryDict;
};

let isGlobalApiErrorInterceptorRegistered = false;

/**
 * 函數名稱: registerGlobalApiErrorInterceptor
 * 函數功能: 掛載全域 axios 錯誤攔截器；具備重複呼叫防護 (React StrictMode 下
 *           main.tsx 可能被執行多次)，確保整個應用程式生命週期內只會掛載一次。
 */
export const registerGlobalApiErrorInterceptor = (): void => {
    if (isGlobalApiErrorInterceptorRegistered) return;
    isGlobalApiErrorInterceptorRegistered = true;

    axios.interceptors.response.use(
        (successResponseObj) => successResponseObj,
        async (errorObj: AxiosError) => {
            // ★ 2026-09-30：使用者按「取消運算」主動中斷的請求不是錯誤，不寫入診斷紀錄、不回報
            if (axios.isCancel(errorObj)) return Promise.reject(errorObj);
            // ★ 2026-10-02：登入請求帶有帳密，一律不寫入診斷紀錄、不回報 Google 表單（帳密錯誤的 401 也屬正常流程）
            if (String(errorObj.config?.url || '').includes('/auth/')) return Promise.reject(errorObj);
            try {
                const requestConfigObj = errorObj.config;
                const responseObj = errorObj.response;

                const [parsedResponseBodyObj, requestPayloadSummaryDict] = await Promise.all([
                    resolveResponseBodyAsJson(responseObj?.data),
                    summarizeRequestPayloadForLogging(requestConfigObj?.data),
                ]);

                const recommendationsListArray = Array.isArray(parsedResponseBodyObj?.recommendations)
                    ? parsedResponseBodyObj!.recommendations!.filter((itemValue): itemValue is string => typeof itemValue === 'string')
                    : undefined;

                let resolvedBackendMessageString = parsedResponseBodyObj?.message;
                if (!resolvedBackendMessageString && parsedResponseBodyObj?.detail) {
                    resolvedBackendMessageString = typeof parsedResponseBodyObj.detail === 'string'
                        ? parsedResponseBodyObj.detail
                        : JSON.stringify(parsedResponseBodyObj.detail);
                }

                // 直接讀取 Zustand store 的當下快照 (非 React 元件內，不能使用 hook)，
                // 取得發生錯誤當下的資料集／模式／編碼偵測等上下文資訊。
                const currentWorkspaceStateSnapshot = useWorkspaceStore.getState();

                recordApiError({
                    method: (requestConfigObj?.method || 'unknown').toUpperCase(),
                    url: requestConfigObj?.url || '(未知路徑)',
                    httpStatus: responseObj?.status,
                    errorCode: parsedResponseBodyObj?.error_code,
                    message: resolvedBackendMessageString || errorObj.message,
                    recommendations: recommendationsListArray,
                    requestPayloadSummary: requestPayloadSummaryDict,
                    datasetContext: {
                        fileName: currentWorkspaceStateSnapshot.fileName,
                        columns: currentWorkspaceStateSnapshot.columns,
                        detectedEncoding: currentWorkspaceStateSnapshot.lastUploadDiagnostics?.detectedEncoding,
                        wasReencoded: currentWorkspaceStateSnapshot.lastUploadDiagnostics?.wasReencoded,
                    },
                    privacyMode: currentWorkspaceStateSnapshot.privacyMode,
                    currentStepIndex: currentWorkspaceStateSnapshot.currentStep,
                });
            } catch (loggingProcessErrorObj) {
                // 診斷紀錄本身若發生例外，絕不能影響原本畫面的錯誤處理流程，僅留下主控台警告。
                console.warn('全域 API 錯誤診斷攔截器執行失敗:', loggingProcessErrorObj);
            }

            // 一律將原始錯誤原封不動往下拋，讓既有的 catch 區塊維持原本行為不受影響——
            // 這個攔截器只負責「側錄」診斷資訊，不介入、不吞噬任何錯誤處理邏輯。
            return Promise.reject(errorObj);
        }
    );
};
