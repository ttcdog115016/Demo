/**
 * ============================================================================
 * 檔案名稱 (File): backendErrorCatalog.tsx
 * 模組功能 (Description): 後端錯誤碼對照表與白話錯誤卡片（Step4 結果頁使用）。
 * ============================================================================
 * ★ 2026-09-30：由 Step4_Result.tsx 開頭抽出（約 210 行純資料與一個顯示函式），內容不變。
 */
import type { ReactNode } from 'react';
import { explainBackendErrorMessage } from './backendErrorExplain';

import { scaleFontSize } from '../../utils/fontScale';
// 後端統一錯誤回應對照表（依據 app/core/errors.py 之 ERROR_HTTP_STATUS 全表整理，
// 而非只收錄本次交付文件列出的設定檔驗證錯誤——避免只做一半，其餘錯誤碼遇到時
// 又退回無分類的原始文字）。後端一律回傳 { error_code, message, recommendations? }，
// 這裡依錯誤碼標示「類別」與「HTTP 狀態碼」，讓使用者一眼判斷是設定檔問題、
// 請求本身的問題，還是系統本身的問題，而不必自己去讀後端原始訊息猜意思。
export const BACKEND_ERROR_CODE_CATEGORY_MAP: Record<string, { status: number; category: string }> = {
    // 400：請求本身讀不懂，或參數不合法——要修的是這次送出的設定檔／參數
    ERR_BAD_REQUEST: { status: 400, category: '請求格式錯誤' },
    ERR_INVALID_PARAM: { status: 400, category: '參數不合法' },
    ERR_CONFIG_MALFORMED: { status: 400, category: '設定檔語法錯誤，無法解析' },
    ERR_SUBSET_COND_MALFORMED: { status: 400, category: '對象族群限定條件格式錯誤' },
    ERR_SALT_NOT_CONFIGURED: { status: 400, category: '假名化鹽值未設定' },
    ERR_DEID_METHOD_UNKNOWN: { status: 400, category: '去識別化方法不明' },
    // ★ 2026-10-27：最終版後端（v2.0.0）新增的錯誤碼
    ERR_DATASET_UNREADABLE: { status: 400, category: '資料集無法讀取' },
    ERR_PREPROCESS_ACTION_UNKNOWN: { status: 400, category: '資料前處理功能名稱不明' },
    ERR_PREPROCESS_PARAM_INVALID: { status: 400, category: '資料前處理參數不合法' },
    ERR_FORBIDDEN: { status: 403, category: '權限不足' },
    ERR_USER_EXISTS: { status: 409, category: '帳號已存在' },
    ERR_ACCOUNT_LOCKED: { status: 423, category: '帳號暫時鎖定' },
    ERR_AUTH_DISABLED: { status: 503, category: '登入功能未啟用' },
    ERR_PREPROCESS_COLUMN_NOT_FOUND: { status: 422, category: '資料前處理指定的欄位不存在' },
    ERR_PREPROCESS_TYPE_MISMATCH: { status: 422, category: '資料前處理功能與欄位型態不符' },
    // 413：內容過大
    ERR_PAYLOAD_TOO_LARGE: { status: 413, category: '上傳內容超過大小上限' },
    // 415：檔案格式不在支援清單內
    ERR_UNSUPPORTED_FILE_FORMAT: { status: 415, category: '資料檔案格式不支援' },
    ERR_UNSUPPORTED_CONFIG_FORMAT: { status: 415, category: '設定檔格式不支援（須為 .json／.yaml／.yml）' },
    // 401：身分驗證失敗
    ERR_UNAUTHORIZED: { status: 401, category: '身分驗證失敗' },
    // 404／405：路徑或方法不存在
    ERR_NOT_FOUND: { status: 404, category: '請求路徑不存在' },
    ERR_METHOD_NOT_ALLOWED: { status: 405, category: '不支援的請求方法' },
    // 422：設定檔語法正確，但內容與資料對不上或自相矛盾——要修的是設定內容
    ERR_VALIDATION_FAILED: { status: 422, category: '請求欄位驗證失敗' },
    ERR_CONFIG_INVALID: { status: 422, category: '設定檔內容不合法' },
    ERR_CONFIG_BLOCK_REQUIRED: { status: 422, category: '本次呼叫所需之設定區塊未開啟' },
    ERR_CONFIG_BLOCK_NOT_ALLOWED: { status: 422, category: '開啟了本次呼叫用不到之設定區塊' },
    ERR_CONFIG_DATA_MISMATCH: { status: 422, category: '設定檔與實際資料不相符' },
    ERR_DP_INVALID_BUDGET: { status: 422, category: '差分隱私預算設定不合法' },
    ERR_RISK_ROLE_OVERLAP: { status: 422, category: '風險量測欄位角色重疊' },
    ERR_RISK_CONFIG_NO_SENSITIVE: { status: 422, category: '風險量測未宣告敏感欄位' },
    ERR_RISK_CONFIG_MULTI_SENSITIVE: { status: 422, category: '風險量測宣告了多個敏感欄位' },
    ERR_LINK_AB_INCOMPLETE: { status: 422, category: '連結性之 A／B 欄位未成對提供' },
    ERR_LINK_AB_OVERLAP: { status: 422, category: '連結性之 A、B 欄位重疊' },
    ERR_SPLIT_INFEASIBLE: { status: 422, category: '資料切分條件無法滿足' },
    ERR_DEID_CONFIG_MISMATCH: { status: 422, category: '去識別化設定與資料不符' },
    ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED: { status: 422, category: '抑制率超出設定上限' },
    // 500：伺服器自身的問題，調整請求內容無法解決
    ERR_INTERNAL: { status: 500, category: '系統內部錯誤' }
};

// 找不到對應錯誤碼、或後端連 error_code 都沒回傳時（例如反向代理層直接擋下的錯誤），
// 退回依 HTTP 狀態碼顯示的通用說明，維持「至少看得懂是哪一類問題」。
export const GENERIC_HTTP_STATUS_FALLBACK_MESSAGE: Record<number, string> = {
    400: '輸入內容有誤，或設定檔無法解析。',
    401: '身分驗證失敗，請重新登入後再試。',
    413: '上傳內容超過伺服器允許的大小上限。',
    422: '設定內容不符合後端驗證規則。',
    500: '系統內部錯誤，請聯絡系統管理員或稍後再試。'
};

// 上面兩張表（含錯誤代碼、HTTP 狀態碼、後端技術訊息）是寫給工程師排查用的，會寫進
// console 與下方系統紀錄。畫面上實際顯示給使用者的錯誤卡片改用下面這張「白話版」：
// 只講「發生了什麼」與「接下來怎麼做」，不出現錯誤代碼、HTTP 狀態碼或後端原始技術
// 訊息——本工具的使用者多半沒有相關技術背景，看到那些反而更不知所措。
// ★ 修正：使用者反映原本的文案不夠清楚——沒講是「哪個步驟」出的問題，而且不分青紅皂白
// 一律要人「聯絡系統管理員」，即使明明是使用者自己在畫面上填的檔案／參數／欄位設定不對，
// 使用者自己就能修正。已對照後端原始碼逐一確認每個錯誤碼實際的觸發條件與來源
// （app/core/dataset_io.py、app/core/config.py、app/engines/anonymization/、
// app/engines/dp/ 等），依此分成兩類重寫：
//   (1) 確實是使用者在「資料匯入」／「屬性分類」／「隱私設定」畫面上可以自己調整的檔案
//       或參數內容──直接點名是哪一個步驟、要檢查什麼，讓使用者自己就能處理，不必等管理員。
//   (2) 這個系統目前的操作畫面根本沒有對應欄位讓使用者填（例如設定檔本身的格式、風險評估
//       的篩選條件／自訂連結性欄位等目前都是系統內部自動組出來、或畫面尚未開放調整的項目），
//       或屬於伺服器環境設定（如簽章鹽值）──明確告知「這是系統本身的問題，不是您操作有誤」，
//       避免使用者誤以為自己哪裡設定錯了、白白花時間反覆檢查。
export const BACKEND_ERROR_CODE_USER_FRIENDLY_MAP: Record<string, { headline: string; defaultAdvice: string }> = {
    // ★ 修正：ERR_BAD_REQUEST 在後端 (app/core/dataset_io.py) 原本最常見的觸發原因是 CSV
    // 編碼無法辨識，但「資料匯入」步驟 (Step1_Upload.tsx) 已經會在上傳當下自動偵測檔案編碼
    // (utf-8／big5／gbk／shift-jis／windows-1252) 並在瀏覽器端重新編碼為乾淨的 UTF-8 後才送出，
    // 正常情況下不會再讓「編碼問題」傳到後端。因此不寫「請把檔案另存成 UTF-8」這種其實已經
    // 由系統自動處理、對使用者來說無從下手（也不該需要下手）的建議，改成提示這通常代表檔案
    // 本身有更嚴重的問題（例如檔案已損毀、並非正常的資料檔案），讓使用者自行確認檔案基本上
    // 沒有壞掉即可，其餘交給系統管理員排查。
    ERR_BAD_REQUEST: { headline: '讀取上傳的資料檔案時發生問題', defaultAdvice: '系統已會自動偵測並轉換檔案編碼，正常情況不會出現此訊息；請先確認該檔案能用 Excel 或文字編輯器正常開啟（無損毀、非空白檔案），若檔案本身沒有問題，請聯絡系統管理員協助排查。' },
    ERR_INVALID_PARAM: { headline: '隱私設定的數值參數超出允許範圍', defaultAdvice: '請回到「隱私設定」步驟，檢查您輸入的數值（如允許的最大抑制／遮蔽比例）是否在合理範圍內後再試一次。' },
    ERR_CONFIG_MALFORMED: { headline: '系統產生的設定內容格式錯誤', defaultAdvice: '這是系統本身的問題，不是您操作有誤，請聯絡系統管理員協助處理。' },
    // ★ 修正：「對象族群限定條件 (subgroup)」原本前端完全沒有串接，故先前寫「系統本身的問題」；
    // 現已於「隱私設定」步驟新增 RiskSubgroupFilterPanel.tsx 供使用者自行設定，此錯誤碼變成
    // 使用者可自行處理的欄位設定問題，改為指引使用者回去檢查該面板的設定內容。
    ERR_SUBSET_COND_MALFORMED: { headline: '「限定特定族群評估風險」設定格式不正確', defaultAdvice: '請回到「隱私設定」步驟的「限定特定族群評估風險」區塊，確認欄位條件的格式：數值／日期型欄位填寫上限與下限，類別／文字型欄位填寫允許值清單，兩者不可混用；這是設定問題，您可以自行處理。' },
    ERR_SALT_NOT_CONFIGURED: { headline: '系統尚未完成必要的安全設定', defaultAdvice: '這是系統環境設定問題，不是您操作有誤，請聯絡系統管理員完成設定後再試一次。' },
    ERR_DEID_METHOD_UNKNOWN: { headline: '系統無法辨識所選擇的處理方式', defaultAdvice: '這是系統本身的問題，不是您操作有誤，請聯絡系統管理員協助處理。' },
    ERR_PAYLOAD_TOO_LARGE: { headline: '上傳的資料檔案超過大小上限', defaultAdvice: '請回到「資料匯入」步驟，將檔案內容縮小或分批後再重新上傳；這是檔案本身的問題，您可以自行處理。' },
    ERR_UNSUPPORTED_FILE_FORMAT: { headline: '資料檔案格式不支援', defaultAdvice: '請回到「資料匯入」步驟，改用 CSV、JSON、JSONL 或 Excel（.xlsx）格式後再重新上傳；這是檔案本身的問題，您可以自行處理。' },
    ERR_UNSUPPORTED_CONFIG_FORMAT: { headline: '系統產生的設定檔格式不正確', defaultAdvice: '這是系統本身的問題，不是您操作有誤，請聯絡系統管理員協助處理。' },
    ERR_UNAUTHORIZED: { headline: '登入狀態已失效', defaultAdvice: '請重新登入後再試一次。' },
    ERR_NOT_FOUND: { headline: '找不到對應的服務', defaultAdvice: '這是系統本身的問題，不是您操作有誤，請聯絡系統管理員協助處理。' },
    ERR_METHOD_NOT_ALLOWED: { headline: '系統呼叫方式錯誤', defaultAdvice: '這是系統本身的問題，不是您操作有誤，請聯絡系統管理員協助處理。' },
    ERR_VALIDATION_FAILED: { headline: '系統送出的請求缺少必要內容', defaultAdvice: '這是系統本身的問題，不是您操作有誤，請重新整理頁面後再試一次；若持續發生，請聯絡系統管理員。' },
    ERR_CONFIG_INVALID: { headline: '欄位設定內容不符合系統規則', defaultAdvice: '請回到「屬性分類」或「隱私設定」步驟，檢查欄位角色、型態與生成策略是否設定正確後再試一次；若確認無誤仍持續發生，請聯絡系統管理員。' },
    ERR_CONFIG_BLOCK_REQUIRED: { headline: '系統未正確開啟本次所需的設定項目', defaultAdvice: '這是系統本身的問題，不是您操作有誤，請聯絡系統管理員協助處理。' },
    ERR_CONFIG_BLOCK_NOT_ALLOWED: { headline: '系統開啟了本次用不到的設定項目', defaultAdvice: '這是系統本身的問題，不是您操作有誤，請聯絡系統管理員協助處理。' },
    ERR_CONFIG_DATA_MISMATCH: { headline: '欄位設定與您上傳的資料對不起來', defaultAdvice: '請回到「屬性分類」步驟，確認欄位名稱與型態是否與您上傳的資料檔案一致（例如指定為數值或時間型態的欄位，內容是否真的能轉換成該型態）後再試一次；這是設定與資料不一致的問題，您可以自行處理。' },
    ERR_DP_INVALID_BUDGET: { headline: '差分隱私的參數設定不合理', defaultAdvice: '請回到「隱私設定」步驟，檢查各欄位的隱私預算（epsilon）、delta 值或數值上下限是否設定正確後再試一次；這是參數設定問題，您可以自行處理。' },
    ERR_RISK_ROLE_OVERLAP: { headline: '欄位角色重複設定', defaultAdvice: '請回到「屬性分類」步驟，確認每個欄位的角色設定沒有重複後再試一次；這是欄位設定問題，您可以自行處理。' },
    ERR_RISK_CONFIG_NO_SENSITIVE: { headline: '尚未指定要保護的敏感欄位', defaultAdvice: '請回到「屬性分類」步驟，指定一個敏感欄位（Sensitive）後再試一次；這是欄位設定問題，您可以自行處理。' },
    ERR_RISK_CONFIG_MULTI_SENSITIVE: { headline: '敏感欄位設定超過一個', defaultAdvice: '請回到「屬性分類」步驟，確認只有一個欄位被設為敏感欄位（Sensitive）後再試一次；這是欄位設定問題，您可以自行處理。' },
    ERR_LINK_AB_INCOMPLETE: { headline: '連結性比對欄位設定不完整', defaultAdvice: '這是系統本身的問題，不是您操作有誤（目前畫面尚未開放自訂此項目），請聯絡系統管理員協助處理。' },
    ERR_LINK_AB_OVERLAP: { headline: '連結性比對欄位重複設定', defaultAdvice: '這是系統本身的問題，不是您操作有誤（目前畫面尚未開放自訂此項目），請聯絡系統管理員協助處理。' },
    ERR_SPLIT_INFEASIBLE: { headline: '資料筆數不足以進行本次分析', defaultAdvice: '請回到「資料匯入」步驟確認資料筆數是否足夠，或調整相關參數後再試一次；這是資料量的問題，您可以自行處理。' },
    ERR_DEID_CONFIG_MISMATCH: { headline: '去識別化設定與資料不符', defaultAdvice: '請回到「屬性分類」步驟，確認欄位設定與上傳的資料是否一致後再試一次；這是設定與資料不一致的問題，您可以自行處理。' },
    ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED: { headline: '資料遮蔽比例過高，未達到可用標準', defaultAdvice: '請回到「屬性分類」或「隱私設定」步驟，調高相關欄位的泛化層級（Level）後再試一次；這是參數設定問題，您可以自行處理。' },
    ERR_INTERNAL: { headline: '系統發生非預期的錯誤', defaultAdvice: '請稍後再試一次；若持續發生，請聯絡系統管理員。' },
    // ★ 2026-10-27：最終版後端新增（資料前處理 /api/v1/preprocess、會員系統）
    ERR_DATASET_UNREADABLE: { headline: '讀取上傳的資料檔案時發生問題', defaultAdvice: '請先確認該檔案能用 Excel 或文字編輯器正常開啟（無損毀、非空白檔案），若檔案本身沒有問題，請聯絡系統管理員協助排查。' },
    ERR_PREPROCESS_ACTION_UNKNOWN: { headline: '資料預先處理的清洗步驟無法辨識', defaultAdvice: '這是系統本身的問題，不是您操作有誤，請聯絡系統管理員協助處理。' },
    ERR_PREPROCESS_PARAM_INVALID: { headline: '資料預先處理的參數設定不正確', defaultAdvice: '請回到「屬性分類」步驟的「資料預先處理」，檢查清洗步驟的參數（例如鎖定字元須為 1 個字、正則表達式是否正確、上下界截斷的下限不可大於上限）後再試一次；這是設定問題，您可以自行處理。' },
    ERR_PREPROCESS_COLUMN_NOT_FOUND: { headline: '資料預先處理指定的欄位不在資料中', defaultAdvice: '請回到「屬性分類」步驟確認欄位名稱與上傳的資料一致，或重新上傳資料後再試一次。' },
    ERR_PREPROCESS_TYPE_MISMATCH: { headline: '資料預先處理的步驟不適用於這個欄位', defaultAdvice: '請回到「屬性分類」步驟的「資料預先處理」：上下界截斷、內插法與平均值填補只能用在數值欄位（若內容是數字文字，可先加一個「型態轉換」步驟）；轉成整數時若遇到小數會四捨五入。調整後再試一次；這是設定問題，您可以自行處理。' },
    ERR_FORBIDDEN: { headline: '您的帳號沒有執行此操作的權限', defaultAdvice: '請確認登入的帳號角色，或聯絡系統管理員。' },
    ERR_USER_EXISTS: { headline: '帳號已存在', defaultAdvice: '請改用其他帳號名稱。' },
    ERR_ACCOUNT_LOCKED: { headline: '帳號暫時鎖定', defaultAdvice: '登入失敗次數過多，請稍後再試，或請系統管理員重設密碼。' },
    ERR_AUTH_DISABLED: { headline: '登入功能尚未啟用', defaultAdvice: '這是系統環境設定問題，請聯絡系統管理員。' }
};

export const GENERIC_HTTP_STATUS_USER_FRIENDLY_HEADLINE: Record<number, string> = {
    400: '系統無法處理這次的請求',
    401: '登入狀態已失效',
    413: '上傳內容超過系統允許的大小上限',
    422: '送出的設定內容不符合規定',
    500: '系統發生非預期的錯誤'
};

// ============================================================================
// ★ 新增：錯誤卡片「測試面板」共用邏輯與範例資料。
// 背景：26 個後端錯誤碼裡，只有少數幾個 (抑制率超標、檔案格式不支援、上傳過大等)
// 能直接在畫面上操作真實觸發；其餘大部分 (風險評估、大包設定檔相關) 目前的表單
// 根本選不到會觸發它們的選項，需要另一種方式才能檢查這些錯誤碼的前端卡片顯示是否
// 正確、好懂。做法：把「組錯誤卡片內容」的邏輯抽成共用函數 buildFriendlyErrorDisplayNode，
// 讓下方測試面板與上面真實 API 呼叫失敗時走同一份渲染邏輯——測試面板看到的畫面
// 保證跟正式環境真的觸發時一模一樣，不是另外做一份「看起來像」的假畫面。
// ★ 修正：這個鍵值必須跟 App.tsx 裡寫入 localStorage 用的鍵值完全一致 (兩邊各自宣告一份
// 字串常數，刻意不 import 共用，是為了避免 Step4_Result.tsx ← App.tsx 兩份檔案互相
// import 造成循環依賴)。App.tsx 會在使用者於網址列加上 ?debugErrors=1 並重新整理頁面時，
// 把這個旗標寫進 localStorage，不受之後路由把網址參數改寫成 ?step=N 影響。
export const DEBUG_ERRORS_LOCAL_STORAGE_KEY = 'ppt_debug_errors_enabled';
// 測試面板本身預設完全隱藏，僅在網址列加上 ?debugErrors=1 時才會出現，一般使用者
// 不會看到、也不會誤觸。
// ============================================================================
export interface FriendlyErrorDisplayInputParams
{
    responseErrorCode?: string;
    responseHttpStatus?: number;
    backendRawMessageText?: string;
    responseRecommendationsList?: string[];
}

export const buildFriendlyErrorDisplayNode = (
    {
        responseErrorCode,
        responseHttpStatus,
        backendRawMessageText = '',
        responseRecommendationsList = []
    }: FriendlyErrorDisplayInputParams
): ReactNode =>
{
    const friendlyInfo = responseErrorCode ? BACKEND_ERROR_CODE_USER_FRIENDLY_MAP[responseErrorCode] : undefined;
    const friendlyHeadline = friendlyInfo?.headline
        ?? (responseHttpStatus ? GENERIC_HTTP_STATUS_USER_FRIENDLY_HEADLINE[responseHttpStatus] : undefined)
        ?? '處理過程發生問題';
    const friendlyAdvice = friendlyInfo?.defaultAdvice ?? '請稍後再試一次；若持續發生，請聯絡系統管理員協助處理。';

    // ★ 2026-10-05：能從後端訊息辨識出「哪個欄位、哪裡不對」時，改用「問題／建議」兩行精簡呈現
    //   （比照後端「錯誤訊息與建議」寫法），錯誤代碼仍保留在最下方小字供回報。辨識不出來才用下方通用說明。
    const explainedError = explainBackendErrorMessage(backendRawMessageText);
    if (explainedError)
    {
        return (
            <div>
                <div><strong>問題：</strong>{explainedError.problem}</div>
                <div style={{ marginTop: 4 }}><strong>建議：</strong>{explainedError.advice}</div>
                {responseRecommendationsList.length > 0 && (
                    <div style={{ marginTop: 4 }}><strong>補充：</strong>{responseRecommendationsList.join('；')}</div>
                )}
                {responseErrorCode && (
                    <div style={{ marginTop: 8, fontSize: scaleFontSize(12), color: '#999' }}>錯誤代碼：{responseErrorCode}</div>
                )}
            </div>
        );
    }

    return (
        <div>
            <div>{friendlyHeadline}，本次未能完成處理。</div>
            <div style={{ marginTop: 4 }}>建議：{friendlyAdvice}</div>
            {(responseErrorCode || backendRawMessageText || responseRecommendationsList.length > 0) && (
                <div style={{ marginTop: 8, fontSize: scaleFontSize(12), color: '#999' }}>
                    {responseErrorCode && (
                        <div>錯誤代碼：{responseErrorCode}（如需協助，請提供此代碼給系統管理員）</div>
                    )}
                    {backendRawMessageText && (
                        <div style={{ marginTop: responseErrorCode ? 2 : 0 }}>錯誤訊息：{backendRawMessageText}</div>
                    )}
                    {responseRecommendationsList.length > 0 && (
                        <div style={{ marginTop: (responseErrorCode || backendRawMessageText) ? 2 : 0 }}>補充建議：{responseRecommendationsList.join('；')}</div>
                    )}
                </div>
            )}
        </div>
    );
};

// 測試面板下拉選單用：每個錯誤碼配一句「模擬後端可能回傳的原始訊息」，盡量取自後端
// 原始碼實際的訊息樣板 (見 app/core/errors.py 各拋出點整理)，讓測試時看到的畫面貼近
// 真實情境。
// ★ 修正：原本這裡列出後端 errors.py 註冊的全部 26 個錯誤碼，其中 4 個
// （ERR_DEID_METHOD_UNKNOWN、ERR_RISK_ROLE_OVERLAP、ERR_SPLIT_INFEASIBLE、
// ERR_DEID_CONFIG_MISMATCH）經過對照後端全部原始碼確認，目前完全沒有任何地方會
// 實際拋出，純粹是登記保留給未來功能用的錯誤碼——放在「測試面板」裡讓人誤以為這是
// 現在就會發生的情境，容易造成混淆。移除這 4 個，只保留後端目前實際會拋出的 22 個，
// 依照現有後端提供的錯誤碼為準；未來後端真的接上這些預留錯誤碼時，再回頭補上即可。
export const DEBUG_PANEL_ERROR_CODE_OPTIONS: { code: string; sampleMessage: string; sampleRecommendations?: string[] }[] = [
    { code: 'ERR_BAD_REQUEST', sampleMessage: '資料集讀取失敗：不支援的編碼格式。' },
    { code: 'ERR_INVALID_PARAM', sampleMessage: "不合法的 limit_exceeded_action: 'relax_k'。必須是 ['stop_and_error', 'allow_with_warning'] 之一。" },
    { code: 'ERR_CONFIG_MALFORMED', sampleMessage: '設定檔 YAML 語法錯誤，無法解析：mapping values are not allowed here' },
    { code: 'ERR_SUBSET_COND_MALFORMED', sampleMessage: 'subgroup 必須是「欄位: 條件」的物件（如 {"年齡": {"min": 30, "max": 40}}），收到：[]' },
    { code: 'ERR_SALT_NOT_CONFIGURED', sampleMessage: "欄位 ['身分證號'] 需以 HMAC 假名化，請提供 salt_key（自行指定或由部署方於 .env 設定後由呼叫端傳入）。" },
    { code: 'ERR_PAYLOAD_TOO_LARGE', sampleMessage: '上傳內容 512.0 MB 超過伺服器允許的上限 200 MB。請改以較小的資料集分批處理，或請部署方調整 OPEN_PETS_MAX_UPLOAD_MB 設定。' },
    { code: 'ERR_UNSUPPORTED_FILE_FORMAT', sampleMessage: '不支援的檔案格式：「.txt」。請使用 CSV、JSON、JSONL 或 Excel（.xlsx）。若檔案沒有副檔名，請改以輸入格式參數明確指定。' },
    { code: 'ERR_UNSUPPORTED_CONFIG_FORMAT', sampleMessage: '不支援的設定檔格式，請使用 .json、.yaml 或 .yml。' },
    { code: 'ERR_UNAUTHORIZED', sampleMessage: 'Not authenticated' },
    { code: 'ERR_NOT_FOUND', sampleMessage: 'Not Found' },
    { code: 'ERR_METHOD_NOT_ALLOWED', sampleMessage: 'Method Not Allowed' },
    { code: 'ERR_VALIDATION_FAILED', sampleMessage: '請求欄位不合法。body→file：field required' },
    { code: 'ERR_CONFIG_INVALID', sampleMessage: '設定檔內容不合法。columns→年齡→generalization_level：Input should be a valid integer' },
    { code: 'ERR_CONFIG_BLOCK_REQUIRED', sampleMessage: 'K-匿名化需要 k_anonymity 區塊，但設定檔沒有這個區塊。請補上區塊內容並把 enabled 設為 true。' },
    { code: 'ERR_CONFIG_BLOCK_NOT_ALLOWED', sampleMessage: 'K-匿名化不會用到 differential_privacy 區塊，請把它的 enabled 設為 false 或整塊移除：一份設定檔只描述一次處理。' },
    { code: 'ERR_CONFIG_DATA_MISMATCH', sampleMessage: "設定檔宣告的欄位 '地區' 不存在於提供的資料中，請檢查欄位名稱。" },
    { code: 'ERR_DP_INVALID_BUDGET', sampleMessage: "欄位 '年齡' 的 epsilon_budget 必須 > 0（收到 0）。" },
    { code: 'ERR_RISK_CONFIG_NO_SENSITIVE', sampleMessage: '風險評估需要恰好一個 sensitive 欄位作為推斷性／CAP 的目標，但設定檔未宣告任何 sensitive。請指派一個 sensitive 欄位。' },
    { code: 'ERR_RISK_CONFIG_MULTI_SENSITIVE', sampleMessage: "風險評估一次只評估一個 sensitive 欄位，但收到 2 個（['疾病', '薪資']）。請分批，每次只保留一個 sensitive。" },
    { code: 'ERR_LINK_AB_INCOMPLETE', sampleMessage: '自訂連結性 A／B 欄位須成對提供，且各至少一欄。' },
    { code: 'ERR_LINK_AB_OVERLAP', sampleMessage: "連結性 A、B 欄位不可重疊（['地區']）；垂直切割要求一欄只能在一邊。" },
    {
        code: 'ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED',
        sampleMessage: '去識別化失敗：計算之總列抑制率 62.35% 已超過設定的最高上限 50.00%。',
        sampleRecommendations: [
            '建議提高間接識別碼欄位的泛化層級 (Level)。例如將缺失或為 0 的『數值型』欄位層級提高至 1，以啟用前置區間化 (Binning) 聚合，這預期能將抑制比例大幅降低至安全上限內。'
        ]
    },
    { code: 'ERR_INTERNAL', sampleMessage: 'Internal Server Error' }
];

/**
 * 把管線執行失敗的錯誤轉成兩種訊息：errorMessage（含錯誤代碼／HTTP 狀態碼／後端原始訊息，給 console 與系統紀錄）、
 * displayNode（給畫面上錯誤卡片的白話版）。去識別化 API 以 responseType 'blob' 呼叫，失敗時 response.data 是
 * 尚未讀取的 Blob，這裡會先讀成文字並嘗試解析成 JSON。2026-09-30 自 Step4_Result.tsx 的 catch 區塊抽出，行為不變。
 */
export const describePipelineError = async (error: unknown): Promise<{ errorMessage: string; displayNode: ReactNode; responseData: Record<string, unknown> | undefined }> => {
    let errorMessage = error instanceof Error ? error.message : '請確認 Docker 服務是否正常啟動';

    const anyError = error as Record<string, unknown>;
    const responseObj = anyError.response as Record<string, unknown> | undefined;
    let responseData = responseObj?.data as Record<string, unknown> | undefined;
    const responseHttpStatus = typeof responseObj?.status === 'number' ? responseObj.status as number : undefined;

    // ★ K-匿名化／差分隱私呼叫的 axios responseType 設為 'blob'（成功時要接住輸出檔案），
    //   代表發生錯誤時 axios 不會自動解析後端回傳的 JSON 錯誤內容——error.response.data
    //   收到的是尚未讀取的 Blob，底下讀 error_code／message／detail 全部讀不到值，
    //   導致無論後端實際回傳哪一種錯誤碼，畫面永遠只會顯示最保底的通用訊息
    //   （實測發現：新增的錯誤碼對照表因此形同虛設）。這裡先把 Blob 讀成文字並嘗試解析成
    //   JSON，讀不出來就維持原樣、走下面的通用回退訊息。
    if (typeof Blob !== 'undefined' && responseData instanceof Blob) {
        try {
            const blobText = await (responseData as unknown as Blob).text();
            responseData = JSON.parse(blobText) as Record<string, unknown>;
        } catch (blobParseError) {
            console.warn('解析錯誤回應的 Blob 內容失敗:', blobParseError);
        }
    }

    const responseErrorCode = typeof responseData?.error_code === 'string' ? responseData.error_code as string : undefined;
    const responseRecommendationsList = Array.isArray(responseData?.recommendations)
        ? (responseData!.recommendations as unknown[]).filter((item): item is string => typeof item === 'string')
        : [];
    // ★ 使用者反映：即使有錯誤代碼對照表，畫面上仍看不到「後端實際回傳的錯誤訊息」，
    //   每次都得另外開 F12 才查得到。這裡把後端原始 message 獨立取出一份，
    //   供下面組白話版錯誤卡片時，於錯誤代碼旁一併顯示，不必再開發者工具查看。
    const backendRawMessageText = typeof responseData?.message === 'string' ? responseData.message : '';

    if (responseErrorCode) {
        // ★ 後端一律以 { error_code, message, recommendations? } 回傳業務錯誤（見
        //   app/api/errors.py），先前完全沒有讀取 error_code，只能靠 detail／message
        //   這兩個較不穩定的欄位猜錯誤內容。這裡依錯誤碼標示類別與狀態碼，
        //   讓使用者一眼判斷是設定檔問題、請求問題還是系統問題，而非只看到一句
        //   「後端 API 執行失敗，請檢查 Log 訊息」。
        const errorCodeInfo = BACKEND_ERROR_CODE_CATEGORY_MAP[responseErrorCode];
        const displayStatus = errorCodeInfo?.status ?? responseHttpStatus;
        const displayCategory = errorCodeInfo?.category
            ?? (displayStatus ? GENERIC_HTTP_STATUS_FALLBACK_MESSAGE[displayStatus] : undefined)
            ?? '請求失敗';
        const recommendationSuffix = responseRecommendationsList.length > 0
            ? `；建議：${responseRecommendationsList.join('、')}`
            : '';
        errorMessage = `[${responseErrorCode}${displayStatus ? ` · HTTP ${displayStatus}` : ''}] ${displayCategory}`
            + (backendRawMessageText ? `：${backendRawMessageText}` : '')
            + recommendationSuffix;
    } else if (responseData?.detail) {
        const detail = responseData.detail;
        if (Array.isArray(detail)) {
            errorMessage = '參數驗證失敗: ' + detail.map((err: Record<string, unknown>) => {
                const loc = Array.isArray(err.loc) ? err.loc.join('.') : '';
                return `[${loc}] ${err.msg}`;
            }).join(' | ');
        } else if (typeof detail === 'string') {
            errorMessage = `API 錯誤: ${detail}`;
        }
    } else if (responseData?.message) {
        errorMessage = String(responseData.message);
    } else if (responseHttpStatus && GENERIC_HTTP_STATUS_FALLBACK_MESSAGE[responseHttpStatus]) {
        // 連 error_code 都沒有（例如反向代理／閘道層直接擋下的錯誤），
        // 至少依 HTTP 狀態碼給出通用說明，而不是原始的英文例外訊息。
        errorMessage = `[HTTP ${responseHttpStatus}] ${GENERIC_HTTP_STATUS_FALLBACK_MESSAGE[responseHttpStatus]}`;
    }

    // ★ 上面的 errorMessage（含錯誤代碼／HTTP 狀態碼／後端原始技術訊息）是給工程師
    //   排查用的，寫進 console 與下方系統紀錄即可。畫面上真正顯示給使用者看的卡片
    //   （本工具的使用者多半沒有相關技術背景）改用共用函數 buildFriendlyErrorDisplayNode
    //   組出的「白話版」：只講「發生了什麼」跟「接下來怎麼做」，錯誤代碼收在最下面
    //   一行小字，僅供需要回報給系統管理員時參考，不干擾主要閱讀內容。抽成共用函數
    //   是為了讓下方「錯誤卡片測試面板」(?debugErrors=1) 能重現一模一樣的畫面。
    const friendlyDisplayNode: ReactNode = (responseErrorCode || responseHttpStatus || backendRawMessageText)
        ? buildFriendlyErrorDisplayNode({
            responseErrorCode,
            responseHttpStatus,
            backendRawMessageText,
            responseRecommendationsList
        })
        : errorMessage;

    return { errorMessage, displayNode: friendlyDisplayNode, responseData };
};
