/**
 * ============================================================================
 * 檔案名稱 (File): apiErrorInterceptor.ts
 * 模組功能 (Description): 掛在全域 axios 物件上的錯誤攔截器。
 *
 * apiService.ts 內的每一支處理 API（前處理、K-匿名化、差分隱私、風險評估）都直接呼叫全域的 axios，
 * 這裡在全域層級掛請求／回應攔截器（main.tsx 啟動時呼叫一次 registerGlobalApiErrorInterceptor()）：
 *   - ★ 2026-10-29 處理 API 改須登入：請求自動帶 access token，401 時換發一次後重送。
 *   - 記住回應標頭 X-Run-Id（存處理紀錄時引用，見 takeLastProcessingRunId）。
 *   - 呼叫成功／失敗由後端自行寫入系統維運日誌；這裡只回報後端看不到的「無回應／連線中斷」與「使用者取消」。
 *   - 原始錯誤原封不動往下拋，呼叫端的錯誤處理不受影響。
 *   （2026-10-29 移除：錯誤診斷紀錄 apiErrorLogger——只存在記憶體、沒有任何畫面讀取。）
 * ============================================================================
 */
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { logSystemEvent } from '../store/useSystemLogStore';
import { getAccessToken, hasStoredRefreshToken, refreshTokensOnce } from './authApi';

let isGlobalApiErrorInterceptorRegistered = false;

/**
 * ★ 2026-10-29：後端每次成功的處理呼叫會在回應標頭帶 X-Run-Id；存處理紀錄時須引用一筆（證明真的跑過，
 *   見後端 POST /history）。這裡記住最近一次的，usePipelineRunner 存紀錄時取用（取用後清空，避免重複引用）。
 */
let lastProcessingRunId: string | null = null;
export const takeLastProcessingRunId = (): string | null => {
    const runIdValue = lastProcessingRunId;
    lastProcessingRunId = null;
    return runIdValue;
};

// ★ 2026-10-07：系統維運日誌——記錄每次後端 API 呼叫的結果與耗時
type TimedAxiosRequestConfig = InternalAxiosRequestConfig & { systemLogStartedAtMs?: number; authRetried?: boolean };

/** ★ 2026-10-29：處理 API 改須登入——全域 axios 打 /api/ 時帶上 access token（沒有 access token 但有 refresh token 時先換發） */
const attachAccessToken = async (requestConfigObj: TimedAxiosRequestConfig): Promise<TimedAxiosRequestConfig> => {
    if (!(requestConfigObj.url || '').includes('/api/')) return requestConfigObj;
    if (!getAccessToken() && hasStoredRefreshToken()) {
        try { await refreshTokensOnce(); } catch { /* 換發失敗：照常送出，由後端回 401 */ }
    }
    const accessToken = getAccessToken();
    if (accessToken) requestConfigObj.headers.set('Authorization', `Bearer ${accessToken}`);
    return requestConfigObj;
};

const describeApiCallForSystemLog = (requestConfigObj: TimedAxiosRequestConfig | undefined): { label: string; elapsedText: string } => {
    const methodNameString = (requestConfigObj?.method || 'GET').toUpperCase();
    const urlPathString = requestConfigObj?.url || '(未知路徑)';
    const elapsedSecondsValue = requestConfigObj?.systemLogStartedAtMs
        ? (Date.now() - requestConfigObj.systemLogStartedAtMs) / 1000
        : undefined;
    return {
        label: `${methodNameString} ${urlPathString}`,
        elapsedText: elapsedSecondsValue !== undefined ? `，耗時 ${elapsedSecondsValue.toFixed(1)} 秒` : '',
    };
};

/**
 * 函數名稱: registerGlobalApiErrorInterceptor
 * 函數功能: 掛載全域 axios 錯誤攔截器；具備重複呼叫防護 (React StrictMode 下
 *           main.tsx 可能被執行多次)，確保整個應用程式生命週期內只會掛載一次。
 */
export const registerGlobalApiErrorInterceptor = (): void => {
    if (isGlobalApiErrorInterceptorRegistered) return;
    isGlobalApiErrorInterceptorRegistered = true;

    axios.interceptors.request.use(async (requestConfigObj) => {
        (requestConfigObj as TimedAxiosRequestConfig).systemLogStartedAtMs = Date.now();
        return attachAccessToken(requestConfigObj as TimedAxiosRequestConfig);
    });

    // ★ 2026-10-29：API 呼叫成功／失敗改由後端自行記錄（含帳號、耗時；見後端 processing_guard），前端不再回報，
    //   只回報後端看不到的「無回應／連線中斷」與「使用者取消」
    axios.interceptors.response.use(
        (successResponseObj) => {
            const runIdHeaderValue = successResponseObj.headers?.['x-run-id'];
            if (typeof runIdHeaderValue === 'string' && runIdHeaderValue) lastProcessingRunId = runIdHeaderValue;
            return successResponseObj;
        },
        async (errorObj: AxiosError) => {
            // access token 過期：換發一次後重送（規則同 authApi.authorizedRequest）
            const retryConfigObj = errorObj.config as TimedAxiosRequestConfig | undefined;
            if (errorObj.response?.status === 401 && retryConfigObj && !retryConfigObj.authRetried && hasStoredRefreshToken()) {
                retryConfigObj.authRetried = true;
                try {
                    await refreshTokensOnce();
                    const refreshedAccessToken = getAccessToken();
                    if (refreshedAccessToken) retryConfigObj.headers.set('Authorization', `Bearer ${refreshedAccessToken}`);
                    return axios.request(retryConfigObj);
                } catch {
                    // 換發失敗（refresh token 失效）：authApi 已觸發自動登出，照原錯誤往下拋
                }
            }
            // ★ 2026-09-30：使用者按「取消運算」主動中斷的請求不是錯誤，不寫入診斷紀錄、不回報
            if (axios.isCancel(errorObj)) {
                logSystemEvent('INFO', '使用者取消運算，請求已中斷', describeApiCallForSystemLog(errorObj.config as TimedAxiosRequestConfig | undefined).label);
                return Promise.reject(errorObj);
            }
            if (errorObj.response === undefined) {
                const { label, elapsedText } = describeApiCallForSystemLog(errorObj.config as TimedAxiosRequestConfig | undefined);
                logSystemEvent('ERROR', `後端 API 無回應或連線中斷（${errorObj.message}${elapsedText}）`, label);
            }
            // 一律將原始錯誤原封不動往下拋，讓既有的 catch 區塊維持原本行為不受影響——
            // 這個攔截器只負責「側錄」診斷資訊，不介入、不吞噬任何錯誤處理邏輯。
            return Promise.reject(errorObj);
        }
    );
};
