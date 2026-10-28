/**
 * ============================================================================
 * 檔案名稱 (File): googleFormReporter.ts
 * 模組功能 (Description): 將 API 錯誤診斷紀錄自動、靜默地送到指定的 Google 表單。
 *
 * 背景：先前的做法是在畫面上彈出提示、讓使用者自行複製或下載診斷紀錄回報，但
 * 使用者反映不希望「外部測試人員」在畫面上看到任何這類提示或按鈕，只需要問題
 * 發生時能自動、直接地回傳給內部開發團隊即可。此專案目前沒有可修改的後端，故
 * 改用「表單擁有者開啟 Google 表單的『取得新回覆的電子郵件通知』功能」這個管道：
 * 前端只需要把診斷資料以表單回覆的形式送出，Google 就會自動寄信通知表單擁有者，
 * 全程不需要任何後端、也不會在畫面上留下任何可見的 UI 元件。
 *
 * 技術原理：Google 表單的正式送出端點 (.../formResponse) 不會回傳允許跨網域讀取
 * 的 CORS 標頭，瀏覽器端無法讀取其回應內容；但只要改用 fetch 的 'no-cors' 模式
 * 送出、並將 Content-Type 設為 application/x-www-form-urlencoded (瀏覽器視為
 * 「簡單請求」，不會觸發預檢 OPTIONS 請求而被擋下)，仍可成功把資料送達 Google
 * 表單——這是業界常見「純前端、無後端串接 Google 表單」的標準寫法，被廣泛用於
 * 免後端的意見回饋、輕量表單提交等情境。
 *
 * ★ 表單／欄位對應 (由使用者實際建立表單後提供，若日後重建表單或欄位順序有異動，
 *   需同步更新此處常數，否則資料會送到錯的欄位或表單直接拒收)：
 *   欄位 0「發生時間」        → entry.920023589
 *   欄位 1「狀態摘要」        → entry.798825879
 *   欄位 2「API 路徑」        → entry.938769323
 *   欄位 3「錯誤訊息與建議」  → entry.2036952096
 *   欄位 4「完整診斷內容(JSON)」→ entry.792631281
 * ============================================================================
 */
import type { ApiErrorLogEntry } from './apiErrorLogger';
import { ENABLE_REMOTE_ERROR_REPORT } from '../config/featureFlags';

// ★ 依使用者提供之表單網址與欄位 entry ID 設定，變更表單時需同步更新
const GOOGLE_FORM_RESPONSE_URL =
    'https://docs.google.com/forms/d/e/1FAIpQLSeXvWST08ZUlYNQxHbTpkVMzPrCpJ0NqPJI6hPYQ57pACMbiA/formResponse';

const FORM_ENTRY_ID_OCCURRED_AT = 'entry.920023589';                  // 欄位 0: 發生時間 (★ 新增)
const FORM_ENTRY_ID_STATUS_SUMMARY = 'entry.798825879';               // 欄位 1: 狀態摘要
const FORM_ENTRY_ID_API_PATH = 'entry.938769323';                     // 欄位 2: API 路徑
const FORM_ENTRY_ID_MESSAGE_AND_RECOMMENDATION = 'entry.2036952096';  // 欄位 3: 錯誤訊息與建議
const FORM_ENTRY_ID_FULL_DIAGNOSTIC_JSON = 'entry.792631281';         // 欄位 4: 完整診斷內容 (JSON)

// 台灣時區顯示用格式，讓收到通知信的人不需要自己換算 ISO 字串的時區
const OCCURRED_AT_DISPLAY_TIMEZONE = 'Asia/Taipei';

// Google 表單單一欄位長度沒有正式公開的上限，但實務上內容過長有機率送出失敗或被截斷，
// 保守設定一個上限並在超過時自行截斷，確保核心診斷資訊至少能送達，不會因單一過大欄位
// 導致整份回覆送不出去
const FULL_JSON_FIELD_MAX_LENGTH_CHARS = 9000;

// 同一種錯誤 (以 method + url + errorCode + httpStatus 當特徵) 在這段時間內只送一次通知，
// 避免測試人員短時間內重複觸發同一個錯誤時，狂洗開發團隊的信箱
const DUPLICATE_ERROR_SUPPRESSION_WINDOW_MS = 5 * 60 * 1000; // 5 分鐘

// 記憶體內的節流快取；僅存在於當前分頁的生命週期內，重新整理頁面後會重新開始計算，
// 這是刻意的簡化 (避免跨頁面持久化節流狀態的複雜度)，實務上足以避免短時間內的洗版情境
const recentlyReportedErrorSignatureTimestampsMap = new Map<string, number>();

/**
 * 函數名稱: buildErrorSignatureKey
 * 函數功能: 將一筆錯誤紀錄濃縮成用於節流判斷的特徵字串。
 */
const buildErrorSignatureKey = (logEntryObj: ApiErrorLogEntry): string =>
    `${logEntryObj.method}|${logEntryObj.url}|${logEntryObj.errorCode ?? ''}|${logEntryObj.httpStatus ?? ''}`;

/**
 * 函數名稱: shouldSuppressAsDuplicateReport
 * 函數功能: 判斷這筆錯誤是否應該因為「短時間內已回報過相同特徵的錯誤」而略過本次回報。
 */
const shouldSuppressAsDuplicateReport = (logEntryObj: ApiErrorLogEntry): boolean => {
    const signatureKeyString = buildErrorSignatureKey(logEntryObj);
    const nowTimestampMs = Date.now();
    const lastReportedAtTimestampMs = recentlyReportedErrorSignatureTimestampsMap.get(signatureKeyString);

    if (
        lastReportedAtTimestampMs !== undefined &&
        (nowTimestampMs - lastReportedAtTimestampMs) < DUPLICATE_ERROR_SUPPRESSION_WINDOW_MS
    ) {
        return true;
    }

    recentlyReportedErrorSignatureTimestampsMap.set(signatureKeyString, nowTimestampMs);
    return false;
};

/**
 * 函數名稱: reportApiErrorToGoogleForm
 * 函數功能: 將單筆 API 錯誤診斷紀錄背景送出至 Google 表單；全程不影響畫面、不彈出
 *           任何提示，外部測試人員完全無感知。送出失敗 (如離線) 僅於主控台留下警告，
 *           不拋出例外、不影響任何其他錯誤處理流程。
 */
export const reportApiErrorToGoogleForm = (logEntryObj: ApiErrorLogEntry): void => {
    // ★ 2026-10-28：單機版不對外傳送（見 featureFlags.ENABLE_REMOTE_ERROR_REPORT）
    if (!ENABLE_REMOTE_ERROR_REPORT) return;
    if (shouldSuppressAsDuplicateReport(logEntryObj)) return;

    // ★ 新增：發生時間欄位。logEntryObj.timestamp 是 recordApiError 寫入當下產生的 ISO
    //   字串 (UTC)，這裡轉換成台灣時區的可讀格式，收到通知信的人不需要自己換算時區。
    //   轉換失敗 (理論上不會發生，防呆用) 時退回原始 ISO 字串，確保這個欄位一定有值可送。
    let occurredAtDisplayText = logEntryObj.timestamp;
    try {
        occurredAtDisplayText = new Date(logEntryObj.timestamp).toLocaleString('zh-TW', {
            timeZone: OCCURRED_AT_DISPLAY_TIMEZONE,
            hour12: false,
        });
    } catch (timestampFormatErrorObj) {
        console.warn('格式化 API 錯誤發生時間失敗，改用原始 ISO 字串:', timestampFormatErrorObj);
    }

    const statusSummaryText = [
        logEntryObj.httpStatus ? `HTTP ${logEntryObj.httpStatus}` : undefined,
        logEntryObj.errorCode,
    ].filter(Boolean).join(' · ') || '(無狀態碼/錯誤代碼)';

    const messageAndRecommendationText = [
        logEntryObj.message,
        logEntryObj.recommendations && logEntryObj.recommendations.length > 0
            ? `建議：${logEntryObj.recommendations.join('、')}`
            : undefined,
    ].filter(Boolean).join('\n') || '(無訊息)';

    const fullDiagnosticJsonText = JSON.stringify(logEntryObj, null, 2);
    const truncatedFullDiagnosticJsonText = fullDiagnosticJsonText.length > FULL_JSON_FIELD_MAX_LENGTH_CHARS
        ? `${fullDiagnosticJsonText.slice(0, FULL_JSON_FIELD_MAX_LENGTH_CHARS)}\n…(內容過長，已截斷)`
        : fullDiagnosticJsonText;

    const formSubmissionBodyParams = new URLSearchParams();
    formSubmissionBodyParams.set(FORM_ENTRY_ID_OCCURRED_AT, occurredAtDisplayText);
    formSubmissionBodyParams.set(FORM_ENTRY_ID_STATUS_SUMMARY, statusSummaryText);
    formSubmissionBodyParams.set(FORM_ENTRY_ID_API_PATH, `${logEntryObj.method} ${logEntryObj.url}`);
    formSubmissionBodyParams.set(FORM_ENTRY_ID_MESSAGE_AND_RECOMMENDATION, messageAndRecommendationText);
    formSubmissionBodyParams.set(FORM_ENTRY_ID_FULL_DIAGNOSTIC_JSON, truncatedFullDiagnosticJsonText);

    fetch(GOOGLE_FORM_RESPONSE_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formSubmissionBodyParams.toString(),
    }).catch((submissionErrorObj) => {
        // no-cors 模式下即使成功送達也讀不到真正的回應狀態，這裡只處理「連請求都送不出去」
        // 的情況 (如使用者裝置離線)；不影響畫面或任何其他錯誤處理流程。
        console.warn('自動回報 API 錯誤診斷紀錄至 Google 表單失敗:', submissionErrorObj);
    });
};
