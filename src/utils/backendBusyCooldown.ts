/**
 * ============================================================================
 * 檔案名稱 (File): backendBusyCooldown.ts
 * 模組功能 (Description): 收到通道逾時（524／504）後的「後端可能仍在計算」冷卻提醒。
 * ============================================================================
 * ★ 2026-10-22：經 cloudflared 通道連線時，單一請求超過 120 秒會回 524，但後端仍繼續算完；
 *   這段期間再送出會在後端排隊、一起逾時。收到 524／504 後一段時間內再送出，先提醒使用者。
 * ★ 2026-10-29（TTC Wei 要求）：拔除差分隱私執行時間預估（原 utils/dpRuntimeEstimate.ts，依實測換算、
 *   誤差大，容易誤導），冷卻時間改為固定 5 分鐘，提醒文字不再顯示預估剩餘時間。
 */

/** 收到 524／504 後提醒「後端可能仍在計算」的時間（秒） */
export const BACKEND_BUSY_COOLDOWN_SECONDS = 5 * 60;

const BACKEND_BUSY_STORAGE_KEY = 'ppt_backend_busy_until_ms';
const BACKEND_BUSY_REASON_STORAGE_KEY = 'ppt_backend_busy_reason';
let backendBusyUntilMsMemory = 0;

/**
 * 後端可能仍在計算的原因：
 * - 'timeout'：通道逾時（524／504）
 * - 'canceled'：使用者按「取消運算」（★ 2026-10-30：取消只中斷前端連線，已開跑的運算後端仍會算完）
 */
export type BackendBusyReason = 'timeout' | 'canceled';
let backendBusyReasonMemory: BackendBusyReason = 'timeout';

/** 收到通道逾時（524／504）或取消運算時呼叫：後端多半仍在跑這一筆 */
export const markBackendLikelyBusy = (nowMs: number = Date.now(), reason: BackendBusyReason = 'timeout'): number => {
    const untilMs = nowMs + BACKEND_BUSY_COOLDOWN_SECONDS * 1000;
    backendBusyUntilMsMemory = untilMs;
    backendBusyReasonMemory = reason;
    try {
        sessionStorage.setItem(BACKEND_BUSY_STORAGE_KEY, String(untilMs));
        sessionStorage.setItem(BACKEND_BUSY_REASON_STORAGE_KEY, reason);
    } catch { /* 無法使用 sessionStorage 時只記在記憶體 */ }
    return untilMs;
};

/** 最近一次標記的原因（決定提醒文字） */
export const getBackendBusyReason = (): BackendBusyReason => {
    try {
        const storedReason = sessionStorage.getItem(BACKEND_BUSY_REASON_STORAGE_KEY);
        if (storedReason === 'timeout' || storedReason === 'canceled') return storedReason;
    } catch { /* 忽略 */ }
    return backendBusyReasonMemory;
};

/** 是否仍在冷卻提醒期間 */
export const isBackendLikelyBusy = (nowMs: number = Date.now()): boolean => {
    let untilMs = backendBusyUntilMsMemory;
    try {
        const storedValue = Number(sessionStorage.getItem(BACKEND_BUSY_STORAGE_KEY));
        if (Number.isFinite(storedValue) && storedValue > untilMs) untilMs = storedValue;
    } catch { /* 忽略 */ }
    return untilMs > nowMs;
};

/** 清除冷卻提醒（之後成功完成一次請求即代表後端已空出來） */
export const clearBackendBusy = (): void => {
    backendBusyUntilMsMemory = 0;
    try {
        sessionStorage.removeItem(BACKEND_BUSY_STORAGE_KEY);
        sessionStorage.removeItem(BACKEND_BUSY_REASON_STORAGE_KEY);
    } catch { /* 忽略 */ }
};

/** 是否為通道／閘道等待逾時（Cloudflare 524、反向代理 504） */
export const isGatewayTimeoutStatus = (httpStatus: number | undefined): boolean => httpStatus === 524 || httpStatus === 504;
