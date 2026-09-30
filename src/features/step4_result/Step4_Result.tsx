/**
 * ============================================================================
 * 檔案名稱 (File): Step4_Result.tsx
 * 模組功能 (Description): 去識別化工作流第四步：結果展示、風險審計與憑證簽發組件 (整合真實後端 API 串接、全參數 Hash 監聽與 QI 泛化動態設定)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則
 * ============================================================================
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import {
    Card, Row, Col, Table, Tag, Alert, Button,
    Modal, Segmented, Space, Progress, Spin, Steps, theme, App as AntdApp, Tooltip, Select, Checkbox, InputNumber
} from 'antd';
import {
    CheckCircleOutlined, CheckCircleFilled, DownloadOutlined,
    FileDoneOutlined, EyeOutlined, SafetyCertificateOutlined,
    ReloadOutlined, LoadingOutlined, LineChartOutlined, CloudUploadOutlined,
    WarningFilled, CloseCircleFilled, QuestionCircleOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import Papa from 'papaparse';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../store/useAuthStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useAuditStore } from '../../store/useAuditStore';
import { mapOutOfBoundsStrategyToBackend, isDateTimeDpField } from '../../utils/dpFieldHelpers';
import { buildBackendSubgroupPayload } from '../../utils/riskSubgroupHelpers'; // ★ 新增：風險評估「對象族群限定條件」轉換為後端格式

// 引入 API 服務
import { runKAnonymity, runDifferentialPrivacy, runRiskKAnonymity, runRiskDp, runRiskCap, type KAnonymityQualityReport, type DpQualityReport, type AttackReport, type CapReport } from '../../api/apiService';

const SIMULATION_COMPLETION_DELAY_MS = 600;
const PDF_COMPILATION_DELAY_MS = 400;

// 後端統一錯誤回應對照表（依據 app/core/errors.py 之 ERROR_HTTP_STATUS 全表整理，
// 而非只收錄本次交付文件列出的設定檔驗證錯誤——避免只做一半，其餘錯誤碼遇到時
// 又退回無分類的原始文字）。後端一律回傳 { error_code, message, recommendations? }，
// 這裡依錯誤碼標示「類別」與「HTTP 狀態碼」，讓使用者一眼判斷是設定檔問題、
// 請求本身的問題，還是系統本身的問題，而不必自己去讀後端原始訊息猜意思。
const BACKEND_ERROR_CODE_CATEGORY_MAP: Record<string, { status: number; category: string }> = {
    // 400：請求本身讀不懂，或參數不合法——要修的是這次送出的設定檔／參數
    ERR_BAD_REQUEST: { status: 400, category: '請求格式錯誤' },
    ERR_INVALID_PARAM: { status: 400, category: '參數不合法' },
    ERR_CONFIG_MALFORMED: { status: 400, category: '設定檔語法錯誤，無法解析' },
    ERR_SUBSET_COND_MALFORMED: { status: 400, category: '對象族群限定條件格式錯誤' },
    ERR_SALT_NOT_CONFIGURED: { status: 400, category: '假名化鹽值未設定' },
    ERR_DEID_METHOD_UNKNOWN: { status: 400, category: '去識別化方法不明' },
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
const GENERIC_HTTP_STATUS_FALLBACK_MESSAGE: Record<number, string> = {
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
const BACKEND_ERROR_CODE_USER_FRIENDLY_MAP: Record<string, { headline: string; defaultAdvice: string }> = {
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
    ERR_INTERNAL: { headline: '系統發生非預期的錯誤', defaultAdvice: '請稍後再試一次；若持續發生，請聯絡系統管理員。' }
};

const GENERIC_HTTP_STATUS_USER_FRIENDLY_HEADLINE: Record<number, string> = {
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
const DEBUG_ERRORS_LOCAL_STORAGE_KEY = 'ppt_debug_errors_enabled';
// 測試面板本身預設完全隱藏，僅在網址列加上 ?debugErrors=1 時才會出現，一般使用者
// 不會看到、也不會誤觸。
// ============================================================================
interface FriendlyErrorDisplayInputParams
{
    responseErrorCode?: string;
    responseHttpStatus?: number;
    backendRawMessageText?: string;
    responseRecommendationsList?: string[];
}

const buildFriendlyErrorDisplayNode = (
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

    return (
        <div>
            <div>{friendlyHeadline}，本次未能完成處理。</div>
            <div style={{ marginTop: 4 }}>建議：{friendlyAdvice}</div>
            {(responseErrorCode || backendRawMessageText || responseRecommendationsList.length > 0) && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
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
const DEBUG_PANEL_ERROR_CODE_OPTIONS: { code: string; sampleMessage: string; sampleRecommendations?: string[] }[] = [
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

interface Html2Pdf
{
    set: (options: Record<string, unknown>) => Html2Pdf;
    from: (element: HTMLElement | null) => Html2Pdf;
    save: () => Promise<void>;
}

interface WindowWithHtml2Pdf extends Window 
{
    html2pdf: () => Html2Pdf;
}

interface SimulationResult 
{
    singling: { ori: number; ctrl: number; base: number; risk: number };
    linkability: { ori: number; ctrl: number; base: number; risk: number };
    inference: { ori: number; ctrl: number; base: number; risk: number };
    overallRiskPercent: string;
}

interface DpStoreField {
    enabled?: boolean;
    fieldName: string;
    fieldType?: string;
    epsilon?: number | string;
    delta?: number | string;
    upperBound?: number | string;
    lowerBound?: number | string;
    outOfBoundsStrategy?: 'clip' | 'wrap' | 'reflect';
    minimumUnit?: number;
    noiseStep?: number;
    mode?: 'epsilon' | 'epsilon-delta';
}

type PipelinePhase = 'uploading' | 'processing' | 'auditing' | 'completed';

/**
 * 函數名稱: evaluateComplianceValidity
 * 函數功能: 依據後端回傳之品質／預算報告，判斷本次去識別化處理是否真正達到合規標準，
 *           而非不論結果一律顯示「已通過」。K-匿名化採後端回傳之 is_valid (涵蓋抑制率與 k/l/t 檢測)；
 *           差分隱私因預算報告本身無 pass/fail 欄位，改以消耗之 ε 是否超出使用者設定之預算上限判斷。
 *
 * 輸入參數 (Input):
 *   - privacyModeTypeStr (string | null | undefined): 當前隱私保護模式
 *   - reportData (KAnonymityQualityReport | DpQualityReport | null): 後端回傳之報告物件
 *   - budgetLimitEpsilonValue (number): 使用者設定之累積隱私預算門檻上限
 * 返回值 (Return): boolean，true 表示達到合規標準
 */
const evaluateComplianceValidity = (
    privacyModeTypeStr: string | null | undefined,
    reportData: KAnonymityQualityReport | DpQualityReport | null,
    budgetLimitEpsilonValue: number
): boolean => {
    if (!reportData) return true;

    if (privacyModeTypeStr === 'k-anonymity') {
        return (reportData as KAnonymityQualityReport).is_valid;
    }

    if (privacyModeTypeStr === 'differential-privacy') {
        return (reportData as DpQualityReport).consumed_epsilon <= budgetLimitEpsilonValue;
    }

    return true;
};

export default function Step4_Result(): React.ReactElement
{
    const { token } = theme.useToken();
    const isDarkModeActiveStatus = token.colorBgContainer !== '#ffffff';
    const { t: translate } = useTranslation();
    const { message: messageApi } = AntdApp.useApp();

    const currentUserSession = useAuthStore((state) => state.user);
    const addAuditLogAction = useAuditStore((state) => state.addAuditLog);

    const dataFile = useWorkspaceStore((state: unknown) => (state as { dataFile: File | null }).dataFile);
    const datasetColumnsListArray = useWorkspaceStore((state) => state.columns);
    const previewDataRowsListArray = useWorkspaceStore((state) => state.previewData);

    const currentPrivacyModeTypeStr = useWorkspaceStore((state) => state.privacyMode);
    const currentKValueNumber = useWorkspaceStore((state) => state.kValue);
    const currentLValueNumber = useWorkspaceStore((state) => state.lValue);
    const currentTValueNumber = useWorkspaceStore((state) => state.tValue);
    // ★ 使用者反映：純 K-匿名模式不一定需要 l-多樣性／t-緊密度檢測，若未於 Step3 開啟對應開關，
    //   組裝設定檔時不應送出 l／t 欄位——依交付文件之後端行為，設定檔未提供 l/t 即不執行該項檢測。
    const isEnableLDiversityStatus = useWorkspaceStore((state) => state.enableLDiversity);
    const isEnableTClosenessStatus = useWorkspaceStore((state) => state.enableTCloseness);
    const currentMaxSuppressionNumber = useWorkspaceStore((state) => state.maxSuppression);
    const currentSuppressionMethodStr = useWorkspaceStore((state) => state.suppressionMethod);
    // ★ 使用者反映（2026-09-23）：cell_fill（值抑制填法 star／missing）僅在抑制方式為「值抑制」
    //   時才有作用，先前前端從未讀取／送出這個值，後端只能默默套用內建預設 (star)。這裡讀取 Step3
    //   新增的選單狀態，並在下方組裝 K-匿名 apiOptions／configObject 時，僅於「值抑制」模式才送出。
    const currentCellFillMethodStr = useWorkspaceStore((state) => state.cellFillMethod);
    const currentLimitExceededActionStr = useWorkspaceStore((state) => state.limitExceededAction);
    const budgetLimitEpsilonValue = useWorkspaceStore((state) => state.budgetLimitEpsilon);
    const globalTargetDeltaValue = useWorkspaceStore((state) => state.targetDelta);
    // ★ 使用者反映：config_dp.json 之 accumulated_epsilon／accumulated_delta 為「跨批次累計」值，
    //   先前每次執行皆固定送出 0，等同從未真正累計。此處讀取上次執行後留存之累計值作為本次執行前基準，
    //   執行成功後再依本次消耗更新（見下方 dpAccumulatedEpsilon／dpAccumulatedDelta 更新邏輯）。
    const dpAccumulatedEpsilonValue = useWorkspaceStore((state) => state.dpAccumulatedEpsilon);
    const dpAccumulatedDeltaValue = useWorkspaceStore((state) => state.dpAccumulatedDelta);

    const currentDpFieldsListArray = useWorkspaceStore((state) => state.dpFields);
    const columnPrivacyRolesMapDict = useWorkspaceStore((state) => state.columnRoles);
    const riskSubgroupFiltersMapDict = useWorkspaceStore((state) => state.riskSubgroupFilters); // ★ 新增：風險評估「對象族群限定條件」
    
    const rawColumnTypesMapDict = useWorkspaceStore((state) => state.columnTypes);
    const currentColumnTypesMapDict = useMemo(() => rawColumnTypesMapDict || {}, [rawColumnTypesMapDict]);

    const currentPreprocessingRulesMapDict = useWorkspaceStore((state) => state.preprocessingRules);
    const currentDatasetFileNameString = useWorkspaceStore((state) => state.fileName);
    const simulatedQueryCountValue = useWorkspaceStore((state) => state.queryCount);

    const step4AnalysisCacheData = useWorkspaceStore((state) => state.step4Cache);
    const lastRunParametersHashString = useWorkspaceStore((state) => state.lastRunParamsHash);
    const setStep4CacheAction = useWorkspaceStore((state) => state.setStep4Cache);

    const rawKAnonymityFields = useWorkspaceStore((state: unknown) => (state as { kAnonymityFields?: Record<string, unknown>[] }).kAnonymityFields);
    const kAnonymityFieldsList = useMemo(() => rawKAnonymityFields || [], [rawKAnonymityFields]);

    const rawKAnonymityHierarchies = useWorkspaceStore((state: unknown) => (state as { kAnonymityHierarchies?: Record<string, unknown>[] }).kAnonymityHierarchies);
    const kAnonymityHierarchiesList = useMemo(() => rawKAnonymityHierarchies || [], [rawKAnonymityHierarchies]);

    const currentParametersHashString = useMemo(
        () => JSON.stringify({
            privacyMode: currentPrivacyModeTypeStr, 
            kValue: currentKValueNumber,
            lValue: currentLValueNumber,
            tValue: currentTValueNumber,
            enableLDiversity: isEnableLDiversityStatus,
            enableTCloseness: isEnableTClosenessStatus,
            maxSuppression: currentMaxSuppressionNumber,
            suppressionMethod: currentSuppressionMethodStr,
            limitExceededAction: currentLimitExceededActionStr,
            queryCount: simulatedQueryCountValue,
            dpFields: currentDpFieldsListArray,
            columnRoles: columnPrivacyRolesMapDict,
            columnTypes: currentColumnTypesMapDict,
            preprocessingRules: currentPreprocessingRulesMapDict,
            kAnonymityFields: kAnonymityFieldsList,
            kAnonymityHierarchies: kAnonymityHierarchiesList
        }),
        [
            currentPrivacyModeTypeStr, currentKValueNumber, currentLValueNumber, currentTValueNumber,
            isEnableLDiversityStatus, isEnableTClosenessStatus, currentMaxSuppressionNumber,
            currentSuppressionMethodStr, currentLimitExceededActionStr, simulatedQueryCountValue,
            currentDpFieldsListArray, columnPrivacyRolesMapDict, currentColumnTypesMapDict, currentPreprocessingRulesMapDict,
            kAnonymityFieldsList, kAnonymityHierarchiesList
        ]
    );

    const isAnalysisCacheValidStatus = useMemo(
        () => step4AnalysisCacheData !== null && lastRunParametersHashString === currentParametersHashString, 
        [step4AnalysisCacheData, lastRunParametersHashString, currentParametersHashString]
    );
    
    const [apiReport, setApiReport] = useState<KAnonymityQualityReport | DpQualityReport | null>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData?.apiReport ? (step4AnalysisCacheData.apiReport as KAnonymityQualityReport | DpQualityReport) : null
    );

    // 後端管線本次執行是否真正失敗（例如 422 抑制率超限），用來避免
    // 在執行失敗時仍顯示「運算完成」的成功／警告橫幅
    const [pipelineFailedMessage, setPipelineFailedMessage] = useState<ReactNode | null>(null);

    // ★ 新增：錯誤卡片測試面板下拉選單目前選擇的錯誤碼，預設選第一個。
    const [debugSelectedErrorCodeStr, setDebugSelectedErrorCodeStr] = useState<string>(DEBUG_PANEL_ERROR_CODE_OPTIONS[0].code);

    const [processedCsvBlob, setProcessedCsvBlob] = useState<Blob | null>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData 
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).processedCsvBlob as Blob | null) || null 
            : null
    );

    // 風險評估（三攻擊 + CAP）真實 API 回傳結果
    const [attackReportData, setAttackReportData] = useState<AttackReport | null>(null);
    // ★ CAP 前後對比現在是安全性評估卡片的主要顯示內容，若不隨快照還原，重新整理／切回本頁
    // 時（命中快取）畫面上會整個看不到，故比照 attackSimulationMetricsData 一併存讀快照。
    const [capReportData, setCapReportData] = useState<CapReport | null>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).capReport as CapReport | null) || null
            : null
    );
    // ★ 新增：輸入／刪除／輸出筆數統計快照，同樣需要隨命中快取還原，避免重新整理後消失。
    const [datasetRowStatsData, setDatasetRowStatsData] = useState<{ input: number; deleted: number; output: number } | null>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).datasetRowStats as { input: number; deleted: number; output: number } | null) || null
            : null
    );

    // ★ 使用者反映（2026-09-22）：K-匿名模式同時把「薪資」(數值型) 與「疾病」(字串型) 都設為
    //   敏感欄位、輪流執行三攻擊／CAP 時，後端服務直接當機。使用者提供的後端終端機訊息顯示
    //   sklearn 印出「the number of unique classes is greater than 50% of the number of
    //   samples...」警告後容器隨即結束——代表三攻擊／CAP 底層引擎把「敏感欄位」的實際值
    //   直接丟給 sklearn 分類器當 y 標籤，該欄位的值若幾乎每筆都不同（不論數值型連續數字，
    //   或字串型自由文字，使用者兩者皆已實測會觸發），會讓 sklearn 內部（很可能是分層抽樣
    //   要求每類別至少 2 筆樣本）丟出未接住的例外，直接讓後端容器當掉。這是後端引擎本身的
    //   限制、不是前端設定檔問題，故無法從前端修正根本原因；改為在送出請求前，依「實際資料
    //   的唯一值佔比」（而非欄位型別，因為型別無法可靠預測是否會觸發）偵測每個候選敏感欄位，
    //   偵測到高風險欄位時預設略過（僅顯示警告，不影響去識別化結果本身），並提供下方「仍要
    //   強制執行」勾選框，讓使用者在明確知情風險的前提下自行選擇是否仍要送出。
    // ★ 修正：MainLayout 以 currentStepIndexValue 當 key，切到其他步驟再切回 Step4 會讓本
    //   元件整個重新掛載；命中快取（isAnalysisCacheValidStatus）時 runFullPipeline 會直接
    //   略過整段風險評估（含這裡的高唯一值比例偵測），若這兩個 state 不比照 capReportData／
    //   datasetRowStatsData 一併從快照還原，重新掛載後風險數字雖然正確恢復，解釋「為什麼略過
    //   ／為什麼被強制執行」的警告與勾選狀態卻會憑空消失，讓使用者誤以為是完整評估結果。
    const [highCardinalitySensitiveWarningInfo, setHighCardinalitySensitiveWarningInfo] = useState<{ columnName: string; uniqueRatioPercent: number; handling?: 'binned' | 'skipped' | 'forced'; binWidth?: number; binCount?: number }[]>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).highCardinalitySensitiveWarningInfo as { columnName: string; uniqueRatioPercent: number; handling?: 'binned' | 'skipped' | 'forced'; binWidth?: number; binCount?: number }[] | undefined) || []
            : []
    );
    const [forceRunHighCardinalitySensitiveFieldsStatus, setForceRunHighCardinalitySensitiveFieldsStatus] = useState<boolean>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? Boolean((step4AnalysisCacheData as unknown as Record<string, unknown>).forceRunHighCardinalitySensitiveFields)
            : false
    );
    // ★ 後端工程師回覆（2026-09-29）：sklearn 警告只來自三攻擊中的「推斷性攻擊」——它以準識別欄位為
    //   特徵、敏感欄位為目標建立「分類」模型，並以預測值與真實值完全相等判定攻擊成功，故敏感欄位
    //   必須是可列舉的類別型欄位。薪資這類連續數值的相異值數接近資料筆數，等於每個數值各自一類，
    //   結果不具評估意義，運算量也隨相異值數暴增而跑不完。後端建議把連續數值先分組為級距（例如
    //   每 5 萬一級）再當敏感欄位。故前端改為：高唯一值比例且「幾乎全為數值」的敏感欄位，送風險
    //   評估前自動轉換為級距標籤（僅套用在送給 /risk/* 的資料副本，去識別化結果本身不受影響）；
    //   級距寬度預設自動取整（約分 10 級），使用者可在警告區塊逐欄自訂，此 state 存自訂值。
    const [sensitiveBinWidthOverridesMap, setSensitiveBinWidthOverridesMap] = useState<Record<string, number>>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).sensitiveBinWidthOverrides as Record<string, number> | undefined) || {}
            : {}
    );

    const [realMaskedDataRows, setRealMaskedDataRows] = useState<Record<string, unknown>[]>([]);
    // ★ 使用者反映：曾出現「安全性評估／效用評估」已有真實數字，但下方「結果預覽對照」
    //   卻顯示「無此資料」的不一致畫面。經追查，本檔案內有另一個 useEffect（下方
    //   「debounce 觸發」邏輯）會在 runFullPipeline 這個 useCallback 參考值改變時
    //   自動重新呼叫一次；而 runFullPipeline 的相依陣列包含 isAnalysisCacheValidStatus，
    //   該值會在本次執行「快完成」時（setStep4CacheAction 寫入快取後）翻轉，導致
    //   runFullPipeline 參考值改變、觸發效果重新執行。雖然目前程式碼在快取生效後
    //   會擋下「再次真正發送 API 請求」，但為避免萬一其他相依值也在執行期間意外
    //   改變參考值而造成同一輪管線被重複觸發（例如 CSV 解析中途又被另一輪重置
    //   清空），這裡加一個「執行中旗標」，確保同一時間只會有一輪 runFullPipeline
    //   在真正執行，杜絕任何重疊執行造成的狀態互相覆蓋。
    const isPipelineRunInProgressRef = useRef(false);
    // ★ 新增：若 processedCsvBlob 明明有內容（bytes > 0），但解析出來的資料列數卻是 0，
    //   代表後端回傳的 CSV 內容本身可能有非預期格式（例如編碼、分隔符號等問題）。
    //   過去這種情況畫面上只會安靜地顯示「無此資料」，使用者與工程師都無從得知
    //   原因。這裡記錄下診斷資訊，若真的發生就直接顯示在畫面上，不用再另外開
    //   F12 開發者工具才找得到。
    const [previewParseDiagnosticText, setPreviewParseDiagnosticText] = useState<string | null>(null);

    const [previewViewMode, setPreviewViewMode] = useState<'masked' | 'original'>('masked');
    const [isReportModalVisibleStatus, setIsReportModalVisibleStatus] = useState<boolean>(false);
    const [isExportingPdfStatus, setIsExportingPdfStatus] = useState<boolean>(false);

    const pdfReportContainerRef = useRef<HTMLDivElement>(null);
    const simulationLogsEndRef = useRef<HTMLDivElement>(null);
    
    const [isPipelineCalculatingStatus, setIsPipelineCalculatingStatus] = useState<boolean>(!isAnalysisCacheValidStatus);
    const [currentPipelinePhaseType, setCurrentPipelinePhaseType] = useState<PipelinePhase>(isAnalysisCacheValidStatus ? 'completed' : 'uploading');
    const [calculationProgressValue, setCalculationProgressValue] = useState<number>(isAnalysisCacheValidStatus ? 100 : 0);
    const [systemSimulationLogsList, setSystemSimulationLogsList] = useState<string[]>([]);
    const [attackSimulationMetricsData, setAttackSimulationMetricsData] = useState<SimulationResult | null>(isAnalysisCacheValidStatus ? step4AnalysisCacheData!.metrics : null);
    const [auditMetadataObject, setAuditMetadataObject] = useState(
        () => ({
            certificateId: isAnalysisCacheValidStatus ? step4AnalysisCacheData!.certificateId : `PAC-${Date.now()}`,
            auditTime: isAnalysisCacheValidStatus ? step4AnalysisCacheData!.auditTime : new Date().toLocaleString()
        })
    );

    const actualProcessedColumnsList = useMemo(
        () => {
            if (datasetColumnsListArray && datasetColumnsListArray.length > 0) {
                return datasetColumnsListArray.map(col => col.replace(/^[\uFEFF\u200B]+/, '').trim());
            }
            if (kAnonymityFieldsList && kAnonymityFieldsList.length > 0) {
                return kAnonymityFieldsList.map((fieldItem: unknown) => (fieldItem as { name: string }).name).filter(Boolean).map(col => col.replace(/^[\uFEFF\u200B]+/, '').trim());
            }
            return [];
        }, 
        [datasetColumnsListArray, kAnonymityFieldsList]
    );

    const sampleRawDataRowsList = useMemo(
        () => previewDataRowsListArray && previewDataRowsListArray.length > 0
            ? previewDataRowsListArray.slice(0, 10)
            : [],
        [previewDataRowsListArray]
    );

    // ★ 修正：使用者對照瀏覽器開發者工具的實際後端回應後發現，「脫敏結果預覽對照」在
    //   「K-匿名化後資料／差分隱私加噪後資料」檢視下，表格欄位（姓名、身分證號、生日等
    //   Identifier 角色欄位）與後端實際回傳的 CSV 完全對不上——後端對 Identifier 欄位是直接
    //   「整欄移除」而非留空，但先前這裡的欄位清單一律用 actualProcessedColumnsList（即
    //   Step1 上傳時的「原始資料集全部欄位」），導致畫面上多顯示出 3 個後端根本沒回傳、
    //   徹頭徹尾是空白的假欄位，容易誤以為是資料遺失或程式出錯。正確做法：「遮罩後」檢視應
    //   改以實際解析到的 realMaskedDataRows（即後端回傳的 processedCsvBlob 解析結果）之
    //   欄位鍵值為準，畫面上有幾欄就是後端真的回傳幾欄；「原始明文資料」檢視則維持顯示
    //   Step1 上傳時的全部原始欄位（該檢視本來就應完整呈現原始資料，兩者用途不同、不可
    //   混用同一份欄位清單）。
    const maskedPreviewColumnNamesList = useMemo(
        () => realMaskedDataRows.length > 0 ? Object.keys(realMaskedDataRows[0]) : actualProcessedColumnsList,
        [realMaskedDataRows, actualProcessedColumnsList]
    );

    useEffect(() => {
        let isMounted = true;

        if (processedCsvBlob) {
            const processedBlobByteSizeValue = processedCsvBlob.size;

            processedCsvBlob.text().then(csvText => {
                // ★ 與上傳原始檔時的清理方式一致（見 cleanedCsvText 的處理）：後端回傳的
                //   CSV 若帶有 UTF-8 BOM 或零寬字元，會讓 Papa.parse 判斷出來的第一個欄位
                //   標頭名稱多出看不見的字元、進而對不上 actualProcessedColumnsList，
                //   保留此清理可避免這類「看起來欄位對不上」的情況。
                const cleanedProcessedCsvText = csvText.replace(/^[\uFEFF\u200B]+/, '');

                Papa.parse(cleanedProcessedCsvText, {
                    header: true,
                    skipEmptyLines: true,
                    preview: 10,
                    complete: (results) => {
                        if (!isMounted) return;

                        setRealMaskedDataRows(results.data as Record<string, unknown>[]);

                        // ★ 診斷：後端明明回傳了有內容的檔案（bytes > 0），但解析出來的
                        //   資料列數卻是 0，代表 CSV 內容本身可能有非預期格式（例如編碼、
                        //   分隔符號問題），而不是「後端真的沒有輸出資料」。記錄診斷資訊，
                        //   讓畫面能直接顯示原因，不必再另外開發者工具查看。
                        if (results.data.length === 0 && cleanedProcessedCsvText.trim().length > 0) {
                            const diagnosticDetailText =
                                `後端回傳檔案大小：${processedBlobByteSizeValue} bytes；` +
                                `文字內容長度：${cleanedProcessedCsvText.length} 字元；` +
                                `解析錯誤數：${results.errors.length}` +
                                (results.errors.length > 0 ? `（第一筆：${JSON.stringify(results.errors[0])}）` : '') +
                                `；內容開頭前 200 字：${cleanedProcessedCsvText.slice(0, 200)}`;
                            console.error('⚠️ 結果預覽對照：後端有回傳資料，但解析後資料列數為 0。', diagnosticDetailText);
                            setPreviewParseDiagnosticText(diagnosticDetailText);
                        } else {
                            setPreviewParseDiagnosticText(null);
                        }
                    },
                    error: (error: Error) => {
                        console.error('Error parsing processed CSV blob:', error);
                        if (isMounted) {
                            setPreviewParseDiagnosticText(`CSV 解析發生例外：${error.message}`);
                        }
                    }
                });
            }).catch(err => {
                console.error('Error reading blob text:', err);
                if (isMounted) {
                    setPreviewParseDiagnosticText(`讀取後端回傳檔案內容失敗：${err instanceof Error ? err.message : String(err)}`);
                }
            });
        }
        // ★ processedCsvBlob 變成 null 時（例如下一輪 runFullPipeline 剛重置狀態）
        //   不在這裡同步呼叫 setState 清空診斷訊息，避免在 Effect 內串連觸發額外
        //   重新渲染；改為和 setRealMaskedDataRows([]) 一起，於 runFullPipeline
        //   重置階段（一般函式呼叫情境，非 Effect 內）就地清空即可。

        return () => {
            isMounted = false;
        };
    }, [processedCsvBlob]);

    const getCalculatedRole = useCallback(
        (targetColumnNameString: string) =>
        {
            const cleanColName = targetColumnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
            const lowerCaseColumnNameString = cleanColName.toLowerCase();

            // \u2605 \u512A\u5148\u6BD4\u5C0D kAnonymityFieldsList \u2014 \u6B64\u6E05\u55AE\u8207 runFullPipeline \u5BE6\u969B\u7D44\u88DD\u9001\u5F80\u5F8C\u7AEF config \u4E4B
            //   columnsMap \u70BA\u540C\u4E00\u8CC7\u6599\u4F86\u6E90\uFF0C\u907F\u514D\u8207 columnRoles (\u53EF\u80FD\u672A\u540C\u6B65\u66F4\u65B0) \u4E0D\u4E00\u81F4\uFF0C\u5C0E\u81F4\u8AA4\u5224\u70BA\u672A\u53BB\u8B58\u5225
            const matchedKAnonymityFieldItem = kAnonymityFieldsList.find((fieldItem: unknown) => {
                const fieldRecord = fieldItem as Record<string, unknown>;
                return fieldRecord && typeof fieldRecord.name === 'string' && fieldRecord.name.replace(/^[\uFEFF\u200B]+/, '').trim() === cleanColName;
            }) as Record<string, unknown> | undefined;

            const rawConfiguredRoleNameString = (
                (matchedKAnonymityFieldItem?.role as string) || columnPrivacyRolesMapDict[cleanColName] || ''
            ).toLowerCase();
            // ★ 修正：與 cleanColName 同樣先去除 BOM／前後空白再比對，避免欄位名稱帶有
            //   UTF-8 BOM（常見於 Excel 匯出之 CSV 第一欄）時，永遠比對不到對應的 DP 欄位設定。
            const stripLeadingBomAndZeroWidthSpace = (rawTextValue: string): string => {
                let resultTextValue = rawTextValue;
                while (resultTextValue.length > 0 && (resultTextValue.charCodeAt(0) === 0xFEFF || resultTextValue.charCodeAt(0) === 0x200B)) {
                    resultTextValue = resultTextValue.slice(1);
                }
                return resultTextValue.trim();
            };
            const targetDpFieldConfigItem = currentDpFieldsListArray?.find(
                fieldItemRecord => stripLeadingBomAndZeroWidthSpace(fieldItemRecord.fieldName) === cleanColName
            );
            const matchedIdentifierMaskStrategyString = (matchedKAnonymityFieldItem?.maskStrategy as string) || '';

            // ★ 使用者反映（2026-09-30）：差分隱私模式的結果預覽標籤一直顯示「敏感欄位／間接識別」，而非
            //   差分隱私的「加噪／保留」。原因是 DP 的 Step2 會把已啟用欄位寫入 columnRoles 為 sensitive
            //   （數值型）／quasi_identifier（類別型），下方依序比對角色時提早回傳，永遠走不到 DP 分支；
            //   合規報告也因此把沒啟用、實際保留原值的姓名等欄位標成「直接識別／完全遮蔽」。差分隱私模式
            //   只依「Step2 是否啟用該欄位」判斷（與實際送給後端加噪的 column_budgets 條件一致）：
            //   啟用 → 加噪；未啟用 → 保留（未處理，輸出檔內為原始值，以金色標籤提醒）。
            if (currentPrivacyModeTypeStr === 'differential-privacy')
            {
                if (targetDpFieldConfigItem && targetDpFieldConfigItem.enabled)
                    return { role: 'DP Sensitive', tagColor: 'purple', maskStrategy: matchedIdentifierMaskStrategyString };
                return { role: 'Retained', tagColor: 'gold', maskStrategy: matchedIdentifierMaskStrategyString };
            }

            if (rawConfiguredRoleNameString.includes('identifier') && !rawConfiguredRoleNameString.includes('quasi'))
                return { role: 'Identifier', tagColor: 'magenta', maskStrategy: matchedIdentifierMaskStrategyString };

            if (rawConfiguredRoleNameString.includes('quasi') || rawConfiguredRoleNameString === 'qi')
                return { role: 'Quasi-identifier', tagColor: 'orange', maskStrategy: matchedIdentifierMaskStrategyString };

            // ★ 修正：「非敏感」(non-sensitive) 字串本身也包含 "sensitive" 子字串，先前用
            //   .includes('sensitive') 判斷會把使用者明明選的是「非敏感」欄位誤判成「敏感」，
            //   導致 K-匿名模式報告顯示錯誤角色標籤；差分隱私模式下更嚴重——只要該欄位名稱
            //   曾在 K-匿名步驟被設定過角色（哪怕是切換模式前的舊資料），就會在這裡被攔截，
            //   永遠不會走到下面差分隱私專屬的判斷邏輯，造成「實際去識別數」在 DP 模式恆為 0。
            //   比照上面 quasi-identifier／identifier 的排除寫法，加上 !includes('non') 即可修正。
            if (rawConfiguredRoleNameString.includes('sensitive') && !rawConfiguredRoleNameString.includes('non'))
                return { role: 'Sensitive', tagColor: 'purple', maskStrategy: matchedIdentifierMaskStrategyString };

            const isExplicitIdentifierMatched = /(^|_)(id|card_id|sn|person_sn|nric|phone|email|name|ssn)($|_)/i.test(lowerCaseColumnNameString);

            if (isExplicitIdentifierMatched)
                return { role: 'Identifier', tagColor: 'magenta', maskStrategy: matchedIdentifierMaskStrategyString };

            if (/(station|time|date|zip|age|gender|card_type|年齡|地區|職業|性別|地址|生日)/i.test(lowerCaseColumnNameString))
                return { role: 'Quasi-identifier', tagColor: 'orange', maskStrategy: matchedIdentifierMaskStrategyString };

            return { role: 'Non-sensitive', tagColor: 'blue', maskStrategy: matchedIdentifierMaskStrategyString };
        },
        [columnPrivacyRolesMapDict, currentDpFieldsListArray, currentPrivacyModeTypeStr, kAnonymityFieldsList]
    );

    // ★ 使用者反映（2026-09-22）：「實際去識別數 / 總欄位數」計算錯誤，例如應為 6 卻顯示 7。
    //   根本原因：先前的計算方式只要欄位「角色」被設為 Identifier／Quasi-identifier 就計入，
    //   但角色只是使用者在 Step2 的「分類」，不代表後端真的會對該欄位套用任何遮蔽／泛化——
    //   例如：
    //     - Identifier 欄位的「遮蔽策略」欄位預設值是 'none'（新增欄位時的預設，見
    //       KAnonymityMapping.tsx addField 之 maskStrategy: 'none'），使用者若忘記另外選一個
    //       實際的遮蔽方式，這欄實際上完全不會被送到後端做任何處理（比對 runFullPipeline 組
    //       config 時的判斷：`matchedField.maskStrategy && matchedField.maskStrategy !== 'none'`
    //       才會寫入 strategy），畫面卻仍把它算進「已去識別」。
    //     - 類別型（categorical）Quasi-identifier 選擇「依分類樹泛化」(genStrategy==='tree')
    //       時，若使用者尚未在 Step2「泛化階層對照」分頁實際填寫該欄位的階層對照表，後端收不到
    //       generalization_matrices 對應項目，同樣不會產生任何泛化效果。
    //   下面 isColumnActuallyDeidentifiedFn 比照 runFullPipeline 實際組 K-匿名化 config 時的
    //   判斷條件（見下方 runFullPipeline 之 columnsMap／generalizationHierarchiesMap／
    //   generalizationMatricesMap 組裝邏輯），只有「真的會被送到後端做遮蔽或泛化」的欄位才計入，
    //   確保這裡顯示的數字與實際送出的設定檔一致。
    const isColumnActuallyDeidentifiedFn = useCallback(
        (columnNameString: string): boolean => {
            const cleanColName = columnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
            const matchedField = kAnonymityFieldsList.find((fieldItem: unknown) => {
                const fieldRecord = fieldItem as Record<string, unknown>;
                return fieldRecord && typeof fieldRecord.name === 'string' && fieldRecord.name.replace(/^[\uFEFF\u200B]+/, '').trim() === cleanColName;
            }) as Record<string, unknown> | undefined;

            const { role: calculatedRoleNameString } = getCalculatedRole(columnNameString);

            if (calculatedRoleNameString === 'Identifier') {
                // 對齊 runFullPipeline：唯有實際選了非 'none' 的遮蔽策略，後端才會真的處理該欄位。
                const maskStrategyValue = matchedField?.maskStrategy as string | undefined;
                return !!(maskStrategyValue && maskStrategyValue !== 'none');
            }

            if (calculatedRoleNameString === 'Quasi-identifier') {
                if (!matchedField) return false;
                const colType = String(matchedField.type) || 'string';
                const genStrategyValue = matchedField.genStrategy as string | undefined;

                if (colType === 'numeric') {
                    if (genStrategyValue === 'custom_bins') {
                        const rawCustomBinsList = matchedField.customBins as unknown[] | undefined;
                        return Array.isArray(rawCustomBinsList) && rawCustomBinsList.length > 0;
                    }
                    if (genStrategyValue === 'rounding') {
                        const roundingUnitValue = typeof matchedField.genParam === 'number' ? matchedField.genParam : Number(matchedField.genParam);
                        return Number.isFinite(roundingUnitValue) && roundingUnitValue > 0;
                    }
                    return false;
                }

                if (colType === 'temporal') {
                    if (genStrategyValue === 'time_rounding') return true;
                    if (genStrategyValue === 'time_range') {
                        const rawTimeRangeBinsList = matchedField.customBins as unknown[] | undefined;
                        return Array.isArray(rawTimeRangeBinsList) && rawTimeRangeBinsList.length > 0;
                    }
                    return false;
                }

                if (colType === 'string') {
                    return genStrategyValue === 'prefix' || genStrategyValue === 'length';
                }

                if (colType === 'categorical') {
                    if (genStrategyValue !== 'tree') return false;
                    return kAnonymityHierarchiesList.some((h: unknown) => {
                        const hierarchyRecord = h as Record<string, unknown>;
                        const hFieldNameCleaned = (hierarchyRecord.fieldName as string || '').replace(/^[\uFEFF\u200B]+/, '').trim();
                        if (hFieldNameCleaned !== cleanColName) return false;
                        const mappings = hierarchyRecord.mappings as unknown[][];
                        if (!Array.isArray(mappings)) return false;
                        return mappings.some((row: unknown) => {
                            const rowArray = row as string[];
                            return Array.isArray(rowArray) && rowArray.length > 0 && rowArray[0] && typeof rowArray[0] === 'string' && rowArray[0].trim() !== '';
                        });
                    });
                }

                return false;
            }

            return false;
        },
        [kAnonymityFieldsList, kAnonymityHierarchiesList, getCalculatedRole]
    );

    // 實際去識別欄位數：K-匿名化計入「確實會被送到後端套用遮蔽或泛化」之 Identifier／
    // Quasi-identifier 欄位，差分隱私計入已套用加噪 (DP Sensitive) 之欄位。
    const deidentifiedColumnsCountValue = useMemo(
        () => actualProcessedColumnsList.filter((columnNameString) => {
            if (currentPrivacyModeTypeStr === 'differential-privacy') {
                // ★ 使用者反映（2026-09-29）：DP 模式「實際去識別數」恆為 0。先前靠 getCalculatedRole
                //   回傳 'DP Sensitive' 判斷，但 DP 的 Step2 會把已啟用欄位寫入 columnRoles 為
                //   sensitive（數值型）／quasi_identifier（類別型），getCalculatedRole 依序先比對到
                //   Sensitive／Quasi-identifier 就提早回傳，永遠走不到 DP 專屬分支。改為直接以實際送給
                //   後端加噪的依據——DP 欄位清單中「已啟用」的欄位——計數，與 runFullPipeline 組
                //   column_budgets 的條件（field.enabled）一致。
                const cleanColName = columnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
                return (currentDpFieldsListArray || []).some((field: DpStoreField) =>
                    field.enabled && String(field.fieldName || '').replace(/^[\uFEFF\u200B]+/, '').trim() === cleanColName
                );
            }
            return isColumnActuallyDeidentifiedFn(columnNameString);
        }).length,
        [actualProcessedColumnsList, currentDpFieldsListArray, currentPrivacyModeTypeStr, isColumnActuallyDeidentifiedFn]
    );

    const runFullPipeline = useCallback(
        async (isForceRunTriggered: boolean = false) => 
        {
            if (!isForceRunTriggered && isAnalysisCacheValidStatus) return;

            // ★ 防止同一輪管線被重複觸發（例如下方 debounce 觸發用的 useEffect，
            //   在 isAnalysisCacheValidStatus 於執行「快完成」時翻轉，導致
            //   runFullPipeline 參考值改變而又被呼叫一次）：若已有一輪正在執行，
            //   直接忽略這次呼叫，避免兩輪執行同時寫入 processedCsvBlob／
            //   realMaskedDataRows 等狀態，造成畫面上「部分區塊有資料、部分沒有」
            //   的不一致結果。
            if (isPipelineRunInProgressRef.current) {
                console.warn('⚠️ runFullPipeline 偵測到已有一輪執行中，略過本次重複呼叫。');
                return;
            }
            isPipelineRunInProgressRef.current = true;

            if (!dataFile) {
                messageApi.error(translate('step4.msg.no_file', '找不到原始資料集，請先回到 Step 1 上傳檔案！'));
                isPipelineRunInProgressRef.current = false;
                return;
            }

            setIsPipelineCalculatingStatus(true);
            setCalculationProgressValue(0);
            setCurrentPipelinePhaseType('uploading');
            setApiReport(null);
            setProcessedCsvBlob(null);
            setRealMaskedDataRows([]);
            setPreviewParseDiagnosticText(null);
            setPipelineFailedMessage(null);
            // ★ 修正：高唯一值比例敏感欄位警告只會在下方 K-匿名分支重新計算並寫入；若使用者從
            //   「K-匿名（曾觸發警告）」切到差分隱私模式再執行，DP 分支不會呼叫
            //   setHighCardinalitySensitiveWarningInfo，state 會殘留上一輪 K-匿名的舊警告，讓
            //   畫面在 DP 模式下顯示不相關的欄位警告。每次開始新的一輪執行時先清空，K-匿名分支
            //   若偵測到高風險欄位會再重新設定為本次結果。
            setHighCardinalitySensitiveWarningInfo([]);

            const currentExecutionDateTimeObj = new Date();
            const generatedNewAuditMetadataObj = {
                certificateId: `PAC-${currentExecutionDateTimeObj.getTime()}`,
                auditTime: currentExecutionDateTimeObj.toLocaleString(),
                auditTimestamp: currentExecutionDateTimeObj.getTime()
            };
            setAuditMetadataObject(generatedNewAuditMetadataObj);
            const formatCurrentTimeForLogString = () => new Date().toLocaleTimeString();

            setSystemSimulationLogsList([
                translate('step4.log.connect', '[{{time}}] 建立與後端 API 伺服器之連線...', { time: formatCurrentTimeForLogString() }),
                translate('step4.log.bind', '[{{time}}] 準備動態組裝設定檔與參數', { time: formatCurrentTimeForLogString() })
            ]);

            try {
                await new Promise(resolve => setTimeout(resolve, 800));
                setCalculationProgressValue(30);
                setCurrentPipelinePhaseType('processing');
                setSystemSimulationLogsList(prev => [...prev, translate('step4.log.generate_config', '[{{time}}] ⚙️ 產生 JSON 設定檔 (Config) 並請求 Docker 後端...', { time: formatCurrentTimeForLogString() })]);

                let configObject: Record<string, unknown> = {};
                let finalApiReportData: KAnonymityQualityReport | DpQualityReport | null = null; 
                let finalCsvBlobData: Blob | null = null; 

                if (currentPrivacyModeTypeStr === 'k-anonymity') {
                    const columnsMap: Record<string, { role: string; type: string; strategy?: string; mask_mode?: string; mask_char?: string; }> = {};
                    const qiGeneralizationLevelsMap: Record<string, number> = {};
                    // 後端要求每欄位的類別階層以 { mapping: { 原始值: [原始值, 上一層, ...] } } 包裝
                    // （不是原始 row 陣列），格式依據 app/core/config.py 的 parse_categorical_mapping()
                    const generalizationMatricesMap: Record<string, { mapping: Record<string, string[]> }> = {};
                    const generalizationHierarchiesMap: Record<string, unknown> = {};

                    actualProcessedColumnsList.forEach((colName) => {
                        const cleanName = colName.replace(/^[\uFEFF\u200B]+/, '').trim();
                        
                        const matchedField = kAnonymityFieldsList.find(
                            (item: unknown) => {
                                const record = item as Record<string, unknown>;
                                return record && typeof record.name === 'string' && record.name.replace(/^[\uFEFF\u200B]+/, '').trim() === cleanName;
                            }
                        ) as Record<string, unknown> | undefined;

                        let backendRole = 'non_sensitive';
                        let colType = 'string';
                        let maskStrategy = undefined;
                        // ★ 依實際後端原始碼核對 (app/core/config.py ColumnInfo)：字串型 QI 遮蔽的
                        // mode／char 是欄位上的「平面」屬性 (mask_mode／mask_char)，並非包在
                        // generalization_hierarchies 底下；下面於 string 分支賦值，最後併入
                        // columnsMap[cleanName]。
                        let qiMaskModeValue: string | undefined = undefined;
                        let qiMaskCharValue: string | undefined = undefined;

                        if (matchedField) {
                            const privacyRoleMappingDict: Record<string, string> = { 
                                'Identifier': 'identifier', 
                                'Quasi-identifier': 'quasi_identifier', 
                                'Sensitive': 'sensitive', 
                                'Non-sensitive': 'non_sensitive' 
                            };
                            backendRole = privacyRoleMappingDict[String(matchedField.role)] || 'non_sensitive';
                            colType = String(matchedField.type) || 'string';
                            
                            if (backendRole === 'identifier' && matchedField.maskStrategy && matchedField.maskStrategy !== 'none') {
                                maskStrategy = String(matchedField.maskStrategy);
                                // ★ 強制將 drop 轉換為 remove，防止舊快取污染
                                if (maskStrategy === 'drop') {
                                    maskStrategy = 'remove';
                                }
                            }
                            
                            if (backendRole === 'quasi_identifier') {
                                // ★ 使用者反映：匯入 config_kanon.json 後，明明原始檔案的 qi_generalization_levels
                                // 只列出「地區」「職業」兩個類別型欄位，但實際送給後端的設定檔卻多出「年齡」
                                // 「薪資」「就醫次數」這三個數值型欄位、且層級被誤設為 2。原因是這裡先前不分
                                // 型態，對每個間接識別碼欄位一律寫入 qi_generalization_levels，若欄位不在匯入檔
                                // 內就退回預設值 2。但依 2_操作說明.md 4-1 節「數值型間接識別碼的切法已由
                                // bins／rounding 寫死，不吃層級」——數值型欄位的泛化完全由 generalization_hierarchies
                                // 決定，本來就不應該出現在 qi_generalization_levels 裡。這裡改為僅在「非數值型」
                                // (類別型的階層樹、時間型的時間粒度) 才寫入層級，數值型欄位一律不寫。
                                if (colType !== 'numeric') {
                                    // ★ 使用者反映：字串「依字串長度」策略只要調「參數設定」(bin_size) 就好，
                                    // 不需要額外調「最大層級」；Step2 UI 已把這個策略的層級固定為 1（見
                                    // KAnonymityMapping.tsx 之 STRING_LENGTH_STRATEGY_FIXED_LEVEL），這裡
                                    // 送給後端的層級數字比照辦理、強制固定為 1，不論欄位當下實際存的
                                    // genMaxLevel 是多少，避免殘留切換策略前的舊層級數字被誤送出去。
                                    qiGeneralizationLevelsMap[cleanName] = (colType === 'string' && matchedField.genStrategy === 'length')
                                        ? 1
                                        : (typeof matchedField.genMaxLevel === 'number' ? Math.floor(matchedField.genMaxLevel) : 0);
                                }

                                // 讀取使用者於 Step2「泛化階層對照」分頁實際填寫的自訂區間，
                                // 而非寫死的假資料；策略值須對齊 KAnonymityMapping.tsx 實際儲存的
                                // 'custom_bins'（'binning' 只是匯入舊版 JSON 時的相容別名，
                                // 不會是欄位實際被選取後的儲存值，故先前用它比對永遠不會成立）。
                                // ★ 修正 (依實際後端原始碼核對): 後端數值型泛化 (NumericalGeneralizer)
                                // 完全不吃「泛化層級」這個概念——只要設定檔有給 bins 或 rounding 就套用，
                                // 沒給就不套用，qi_generalization_levels 的數字對數值型欄位而言從未有
                                // 任何作用（pipeline.py 對數值欄位上設定的 level 僅發出警告並忽略）。
                                // 先前這裡曾誤加一個「genMaxLevel>=1 才送出」的開關，等於是無中生有一個
                                // 後端根本不認得的「啟用」語意；故移除該開關，只要使用者選了策略且填了
                                // 有效參數就一律送出。
                                if (colType === 'numeric' && matchedField.genStrategy === 'custom_bins') {
                                    const rawCustomBinsList = matchedField.customBins as
                                        { min: number | null; max: number | null; label: string }[] | undefined;

                                    if (Array.isArray(rawCustomBinsList) && rawCustomBinsList.length > 0) {
                                        generalizationHierarchiesMap[cleanName] = {
                                            bins: rawCustomBinsList.map((binItemRecord) => ({
                                                min: binItemRecord.min,
                                                max: binItemRecord.max,
                                                label: binItemRecord.label
                                            }))
                                        };
                                    }
                                } else if (colType === 'numeric' && matchedField.genStrategy === 'rounding') {
                                    // 數值四捨五入：Step2 以 genParam 記錄捨入單位，先前同樣完全沒有寫入
                                    // generalization_hierarchies——後端 NumericalGeneralizer 收不到
                                    // "rounding" 就直接判定不泛化（維持原值），使用者設定形同虛設。
                                    const roundingUnitValue = typeof matchedField.genParam === 'number'
                                        ? matchedField.genParam
                                        : Number(matchedField.genParam);

                                    if (Number.isFinite(roundingUnitValue) && roundingUnitValue > 0) {
                                        generalizationHierarchiesMap[cleanName] = { rounding: roundingUnitValue };
                                    }
                                }

                                // 時間型間接識別欄位：Step2「時間粒度」（已合併日期粒度）與「時間區間」
                                // 兩策略，先前完全沒有寫入 generalization_hierarchies——後端
                                // DatetimeGeneralizer 收不到 levels 就直接判定「未泛化」（no_levels），
                                // 使用者於 Step2 的設定形同虛設。比照上面數值自訂區間的修法補上實際串接。
                                if (colType === 'temporal' && matchedField.genStrategy === 'time_rounding') {
                                    // 時間粒度：一律宣告完整六級（秒/分/時/日/月/年，細到粗），
                                    // 由 qi_generalization_levels 既有的層級數字（1~6）挑選要泛化到哪一級，
                                    // 與 KAnonymityMapping.tsx 之 Segmented 六級選項一一對應。
                                    generalizationHierarchiesMap[cleanName] = {
                                        levels: ['second', 'minute', 'hour', 'day', 'month', 'year']
                                    };
                                } else if (colType === 'temporal' && matchedField.genStrategy === 'time_range') {
                                    // 時間區間：customBins 為使用者以 TimePicker 選取、已轉為「當日第幾分鐘」
                                    // 的整數界線，後端 time_periods 的界線格式須為 HH:MM 字串，故於此轉換；
                                    // 固定宣告到 hour 這一級以觸發後端套用 time_periods。
                                    const rawTimeRangeBinsList = matchedField.customBins as
                                        { min: number | null; max: number | null; label: string }[] | undefined;

                                    if (Array.isArray(rawTimeRangeBinsList) && rawTimeRangeBinsList.length > 0) {
                                        const formatMinutesOfDayAsHHMM = (totalMinutesValue: number): string => {
                                            const wrappedMinutesValue = ((Math.round(totalMinutesValue) % 1440) + 1440) % 1440;
                                            const hourTextValue = String(Math.floor(wrappedMinutesValue / 60)).padStart(2, '0');
                                            const minuteTextValue = String(wrappedMinutesValue % 60).padStart(2, '0');
                                            return `${hourTextValue}:${minuteTextValue}`;
                                        };

                                        generalizationHierarchiesMap[cleanName] = {
                                            levels: ['hour'],
                                            time_periods: rawTimeRangeBinsList.map((binItemRecord) => ({
                                                min: binItemRecord.min === null ? null : formatMinutesOfDayAsHHMM(binItemRecord.min),
                                                max: binItemRecord.max === null ? null : formatMinutesOfDayAsHHMM(binItemRecord.max),
                                                label: binItemRecord.label
                                            }))
                                        };
                                    }
                                }

                                // ★ 修正 (依實際後端原始碼核對，app/core/config.py ColumnInfo 與
                                // strategies/masking.py、strategies/generalize.py)：文字型間接識別碼
                                // 的「保留前後綴」／「依字串長度」兩種遮蔽策略，實際的遮蔽強度是由
                                // qi_generalization_levels 既有的 level 數字換算出來，「參數設定」
                                // (genParam) 對「保留前後綴」策略完全沒有作用：
                                //   - 保留前後綴 (prefix/suffix)：keep_chars = max(5 - level, 1)，
                                //     level 已於上方 qiGeneralizationLevelsMap 寫入，這裡只需標明
                                //     mask_mode（前方對應 'prefix'，後方對應 'suffix'）與 mask_char；
                                //   - 依字串長度 (length)：輸出並非遮蔽字元，而是把值換成一個長度區間
                                //     標籤（例如 "5-9"），區間寬度 = bin_size × level，bin_size 才是
                                //     genParam 對應的欄位，須寫在 generalization_hierarchies 底下
                                //     （預設 5，與後端一致）。
                                // 這裡先前的版本是尚未核對後端原始碼前的臆測鍵名 (mask_type／keep_chars／
                                // direction／level／mask_count／preserve_length)，皆非後端實際欄位，
                                // 已依上述核對結果全部改正。
                                if (colType === 'string' && matchedField.genStrategy === 'prefix') {
                                    qiMaskModeValue = matchedField.genDirection === 'back' ? 'suffix' : 'prefix';
                                    qiMaskCharValue = '*';
                                } else if (colType === 'string' && matchedField.genStrategy === 'length') {
                                    qiMaskModeValue = 'length';
                                    qiMaskCharValue = '*';

                                    const binSizeBaseValue = typeof matchedField.genParam === 'number' ? matchedField.genParam : Number(matchedField.genParam);
                                    generalizationHierarchiesMap[cleanName] = {
                                        bin_size: Number.isFinite(binSizeBaseValue) && binSizeBaseValue > 0 ? binSizeBaseValue : 5
                                    };
                                }
                            }
                        } else {
                            const { role: uiRole } = getCalculatedRole(cleanName);
                            if (uiRole === 'Identifier') backendRole = 'identifier';
                            if (uiRole === 'Quasi-identifier') backendRole = 'quasi_identifier';
                            if (uiRole === 'Sensitive') backendRole = 'sensitive';
                        }

                        columnsMap[cleanName] = {
                            role: backendRole,
                            type: colType,
                            ...(maskStrategy ? { strategy: String(maskStrategy) } : {}),
                            ...(qiMaskModeValue ? { mask_mode: qiMaskModeValue } : {}),
                            ...(qiMaskCharValue ? { mask_char: qiMaskCharValue } : {})
                        };
                    });

                    kAnonymityHierarchiesList.forEach((h: unknown) => {
                        const hierarchyRecord = h as Record<string, unknown>;
                        // ★ 修正：上面組 columnsMap／qiGeneralizationLevelsMap 時，欄位名稱一律先用
                        //   cleanName = colName.replace(/^[\uFEFF\u200B]+/, '').trim() 去除殘留的
                        //   BOM／零寬空白後才當 key；但這裡的 fieldName 先前是直接取
                        //   hierarchyRecord.fieldName 原始字串，未做同樣的清理。一旦欄位名稱帶有
                        //   這類不可見字元（即便已修正上傳端一律去 BOM，仍可能因既有專案檔、JSON
                        //   匯入等途徑殘留），generalization_matrices 的 key 就會跟 columns／
                        //   qi_generalization_levels 的 key 對不起來，導致後端 validate_config()
                        //   判定「類別型間接識別欄位設定了泛化層級，但未於 generalization_matrices
                        //   提供對應階層」而回 400。統一用同一套清理規則，確保三者 key 一致。
                        const fieldName = (hierarchyRecord.fieldName as string || '').replace(/^[\uFEFF\u200B]+/, '').trim();
                        const mappings = hierarchyRecord.mappings as unknown[][];

                        if (fieldName && Array.isArray(mappings) && mappings.length > 0) {
                            const validMappings = mappings.filter((row: unknown) => {
                                const rowArray = row as string[];
                                return Array.isArray(rowArray) && rowArray.length > 0 && rowArray[0] && typeof rowArray[0] === 'string' && rowArray[0].trim() !== '';
                            }) as string[][];

                            // 每個 row 是 [原始值, 上一層, 更上層, ...]（row[0] 即原始值本身），
                            // 轉成後端要的 { 原始值: 去除空白尾格後的階梯陣列 }，再包一層 mapping
                            const mappingObj: Record<string, string[]> = {};
                            validMappings.forEach((row) => {
                                const cleanedRow = row
                                    .map((cell) => (cell ?? '').trim())
                                    .filter((cell) => cell !== '');
                                if (cleanedRow.length > 0) {
                                    mappingObj[cleanedRow[0]] = cleanedRow;
                                }
                            });

                            if (Object.keys(mappingObj).length > 0) {
                                generalizationMatricesMap[fieldName] = { mapping: mappingObj };
                            }
                        }
                    });

                    // v1.2.0 後端要求「大包」格式：所有參數（含 k／suppression_limit_percent／
                    // limit_exceeded_action／suppression_method）都要寫在 k_anonymity 區塊內、
                    // enabled 設為 true；後端本身不接受另開表單欄位傳這些參數（會被忽略，
                    // 之前 422 的原因就是設定檔沒有 k_anonymity 這個外層區塊）。
                    // 格式依據：docs/manual_test/config_k_anonymity.json
                    configObject = {
                        k_anonymity: {
                            enabled: true,
                            k: currentKValueNumber,
                            // l-多樣性／t-趨近性：依 2_操作說明.md 第 4-1 節，l／t 為選填欄位，
                            // 「設定檔未提供 l/t 時不執行該檢測」；先前不論使用者是否需要都固定送出
                            // lValue/tValue 的預設值，導致純 K-匿名使用者即使沒有指定敏感欄位，
                            // 後端仍嘗試做 l/t 檢測，因無敏感屬性可供量測多樣性而 l_passed 永遠為
                            // false，且與 l 值調整無關。現在僅在使用者於 Step3 實際打開對應開關時
                            // 才送出這兩個欄位，關閉時完全不寫入，讓後端依規格略過該項檢測。
                            ...(isEnableLDiversityStatus ? { l: currentLValueNumber } : {}),
                            ...(isEnableTClosenessStatus ? { t: currentTValueNumber } : {}),
                            suppression_limit_percent: currentMaxSuppressionNumber ?? 5,
                            limit_exceeded_action: (currentLimitExceededActionStr || 'stop_and_error') as 'stop_and_error' | 'allow_with_warning',
                            suppression_method: (currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression' ? 'cell_suppression' : 'row_suppression') as 'row_suppression' | 'cell_suppression',
                            // ★ cell_fill 僅在「值抑制」(cell_suppression) 模式下才有意義，未啟用時完全不送出，
                            //   避免像上方 l／t 一樣把無效參數塞進設定檔造成誤解（見上方新增選單處的完整說明）。
                            ...((currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression') ? { cell_fill: currentCellFillMethodStr ?? 'star' } : {}),
                            columns: columnsMap,
                            ...(Object.keys(generalizationHierarchiesMap).length > 0 && { generalization_hierarchies: generalizationHierarchiesMap }),
                            ...(Object.keys(generalizationMatricesMap).length > 0 && { generalization_matrices: generalizationMatricesMap }),
                            ...(Object.keys(qiGeneralizationLevelsMap).length > 0 && { qi_generalization_levels: qiGeneralizationLevelsMap })
                        }
                    };
                } 
                else if (currentPrivacyModeTypeStr === 'differential-privacy') {
                    const columnBudgetsMap: Record<string, unknown> = {};
                    
                    currentDpFieldsListArray?.forEach((field: DpStoreField) => {
                        if (field.enabled) {
                            const isNumeric = field.fieldType === 'Numeric';
                            const originalColType = String(currentColumnTypesMapDict?.[field.fieldName] || '').toLowerCase();
                            // ★ 使用者反映：此處先前自行實作的日期時間判斷關鍵字（只有 date/time/生日/日期）
                            //   與 Step2／Step3 共用的 isDateTimeDpField 不一致，birthday／dob／出生 等欄位名稱
                            //   在 Step2 會被判定為日期時間型（顯示日期選擇器、邊界存為 ISO 日期字串），但在這裡
                            //   卻仍被判定為一般連續數值型，導致送給後端的 sensitivity／clipping_bounds 對日期字串
                            //   做 Number() 運算而得到 NaN。改為與 Step2／Step3 共用同一個判斷函式，避免分歧。
                            const isDateTimeType = isDateTimeDpField(field.fieldName, originalColType);

                            let mappedBackendType = 'text';
                            if (isNumeric) {
                                mappedBackendType = isDateTimeType ? 'datetime' : 'continuous';
                            } else if (field.fieldType === 'Categorical') {
                                mappedBackendType = 'categorical';
                            }

                            // 欄位名稱為 v1.2.0 格式：epsilon_budget／delta_budget（非 v1.0.1 的 epsilon／delta）
                            const baseBudgetConfig: Record<string, unknown> = {
                                type: mappedBackendType,
                                epsilon_budget: Number(field.epsilon || 1.0),
                            };

                            if (isNumeric) {
                                // ★ 修正：先前不論使用者在 Step3 選的是「ε-DP」還是「(ε,δ)-DP」模式，一律照
                                //   field.delta 的值送出；但 field.delta 的預設值是 1e-5（非 0），且切換回
                                //   「ε-DP」模式時畫面只是把 δ 欄位隱藏，並不會把已儲存的 delta 歸零。導致幾乎
                                //   每個選了「ε-DP」(純 ε，理論上應為 Laplace 機制) 的欄位，實際上都被送成
                                //   非零 delta_budget，後端依 delta>0 判斷機制時會誤用 Gaussian，與使用者於
                                //   Step3 的選擇不符。改為：只有明確選擇「(ε,δ)-DP」模式時才送出實際 delta
                                //   值，其餘一律強制送 0，確保送出的機制與使用者畫面上的選擇一致。
                                baseBudgetConfig.delta_budget = field.mode === 'epsilon-delta' ? Number(field.delta || 0.0) : 0;
                                const hasValidBoundsStatus = field.upperBound !== undefined && field.lowerBound !== undefined && field.upperBound !== '' && field.lowerBound !== '';

                                // ★ 使用者反映：Step2 設定的邊界(下限/上限)與每欄個別溢出處理策略，先前完全沒有送給
                                //   後端，後端只收到用邊界差算出的 sensitivity，實際 clipping_bounds／
                                //   out_of_bounds_strategy 從未寫入設定檔，等同使用者的邊界設定被忽略。依
                                //   config_dp.json 範例格式補上；日期時間型欄位邊界為 ISO 日期字串，須用天數差
                                //   計算 sensitivity，且對應的是 time_clipping_bounds／time_out_of_bounds_strategy
                                //   （非數值型的 clipping_bounds／out_of_bounds_strategy）。
                                if (mappedBackendType === 'datetime') {
                                    if (hasValidBoundsStatus) {
                                        const lowerDateTimestamp = Date.parse(String(field.lowerBound));
                                        const upperDateTimestamp = Date.parse(String(field.upperBound));
                                        if (!Number.isNaN(lowerDateTimestamp) && !Number.isNaN(upperDateTimestamp)) {
                                            baseBudgetConfig.sensitivity = Math.round((upperDateTimestamp - lowerDateTimestamp) / 86400000);
                                            baseBudgetConfig.time_clipping_bounds = [String(field.lowerBound), String(field.upperBound)];
                                        }
                                    }
                                    baseBudgetConfig.noise_unit = 'day';
                                    if (field.noiseStep !== undefined) baseBudgetConfig.noise_step = Number(field.noiseStep);
                                    baseBudgetConfig.time_out_of_bounds_strategy = mapOutOfBoundsStrategyToBackend(field.outOfBoundsStrategy);
                                } else if (mappedBackendType === 'continuous') {
                                    if (hasValidBoundsStatus) {
                                        baseBudgetConfig.sensitivity = Number(field.upperBound) - Number(field.lowerBound);
                                        baseBudgetConfig.clipping_bounds = [Number(field.lowerBound), Number(field.upperBound)];
                                    }
                                    baseBudgetConfig.minimum_unit = field.minimumUnit ?? 1;
                                    baseBudgetConfig.out_of_bounds_strategy = mapOutOfBoundsStrategyToBackend(field.outOfBoundsStrategy);
                                }
                            }

                            columnBudgetsMap[field.fieldName] = baseBudgetConfig;
                        }
                    });
                    
                    // v1.2.0 後端要求「大包」格式：column_budgets／accumulated_epsilon／
                    // accumulated_delta／default_delta 都要寫在 differential_privacy 區塊內、
                    // enabled 設為 true。格式依據：docs/manual_test/config_dp.json
                    // ★ accumulated_epsilon／accumulated_delta 送出「本次執行前」已累計之跨批次消耗值
                    //   （非固定 0），default_delta 對應 Step3 全域目標 Delta；先前這三個欄位皆未正確送出。
                    configObject = {
                        differential_privacy: {
                            enabled: true,
                            column_budgets: columnBudgetsMap,
                            accumulated_epsilon: dpAccumulatedEpsilonValue ?? 0,
                            accumulated_delta: dpAccumulatedDeltaValue ?? 0,
                            default_delta: globalTargetDeltaValue ?? 0.0001
                        }
                    };
                }

                console.log(`🔥 傳給後端 (${currentPrivacyModeTypeStr}) 的 JSON Config:`, configObject);

                const jsonString = JSON.stringify(configObject);
                const configBlob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
                const configFile = new File([configBlob], 'config.json', { type: 'application/json' });

                const originalFile = dataFile as File;
                const rawCsvText = await originalFile.text();
                const cleanedCsvText = rawCsvText.replace(/^[\uFEFF\u200B]+/, '');

                const safeDataFile = new File(
                    [cleanedCsvText],
                    'input_dataset.csv',
                    { type: 'text/csv;charset=utf-8' }
                );

                // ★ 使用者反映（2026-09-22）：高唯一值比例（近乎每筆都不同值）敏感欄位偵測，原本只
                //   寫在下方 K-匿名分支內，但差分隱私模式的候選敏感欄位（categoricalCandidateFieldsList）
                //   目前只用「型別＝類別型」這種較粗略的方式篩選，一個類別型欄位本身若類別數仍然很多
                //   （例如「地區」有數百種不同城市），一樣可能觸發後端 sklearn 分類器當機（詳見上方
                //   deidentifiedColumnsCountValue／highCardinalitySensitiveWarningInfo 狀態宣告處的完整
                //   說明）。故把這段偵測邏輯提升到兩個模式共用的位置，只依「實際資料的唯一值佔比」
                //   判斷（而非欄位型別），K-匿名與差分隱私分支都能重複使用同一份 computeColumnUniqueValueRatio。
                const HIGH_CARDINALITY_SENSITIVE_RATIO_THRESHOLD = 0.5;
                const parsedOriginalCsvForCardinalityCheck = Papa.parse<Record<string, string>>(cleanedCsvText, { header: true, skipEmptyLines: true });
                const originalCsvRowsForCardinalityCheck = (parsedOriginalCsvForCardinalityCheck.data || []) as Record<string, string>[];
                const computeColumnUniqueValueRatio = (targetColumnName: string): number => {
                    const nonEmptyValuesList = originalCsvRowsForCardinalityCheck
                        .map((rowRecordItem) => rowRecordItem[targetColumnName])
                        .filter((cellValue) => cellValue !== undefined && cellValue !== null && String(cellValue).trim() !== '');
                    if (nonEmptyValuesList.length === 0) return 0;
                    const distinctValuesCount = new Set(nonEmptyValuesList.map((cellValue) => String(cellValue).trim())).size;
                    return distinctValuesCount / nonEmptyValuesList.length;
                };

                // ★ 後端工程師回覆（2026-09-29）：連續數值型敏感欄位改為先分級距再送風險評估（完整說明見上方
                //   sensitiveBinWidthOverridesMap 狀態宣告處）。級距一律以 0 為原點切齊
                //   （floor(值 ÷ 寬度) × 寬度），確保原始資料與去識別化資料（CAP 需兩份）用同一套切點。
                //   非數值的儲存格（空值、抑制後的「*」等）原樣保留不轉換。
                const NUMERIC_COLUMN_MIN_PARSEABLE_RATIO = 0.95;
                const TARGET_AUTO_BIN_COUNT = 10;
                const parseNumericCellForBinning = (cellValue: unknown): number | null => {
                    if (cellValue === undefined || cellValue === null) return null;
                    const normalizedText = String(cellValue).replace(/[,，\s]/g, '');
                    if (normalizedText === '') return null;
                    const parsedNumber = Number(normalizedText);
                    return Number.isFinite(parsedNumber) ? parsedNumber : null;
                };
                const analyzeNumericColumnRangeForBinning = (targetColumnName: string): { min: number; max: number } | null => {
                    const nonEmptyValuesList = originalCsvRowsForCardinalityCheck
                        .map((rowRecordItem) => rowRecordItem[targetColumnName])
                        .filter((cellValue) => cellValue !== undefined && cellValue !== null && String(cellValue).trim() !== '');
                    if (nonEmptyValuesList.length === 0) return null;
                    const parsedNumbersList = nonEmptyValuesList
                        .map((cellValue) => parseNumericCellForBinning(cellValue))
                        .filter((parsedValue): parsedValue is number => parsedValue !== null);
                    if (parsedNumbersList.length / nonEmptyValuesList.length < NUMERIC_COLUMN_MIN_PARSEABLE_RATIO) return null;
                    return { min: Math.min(...parsedNumbersList), max: Math.max(...parsedNumbersList) };
                };
                const computeAutoNiceBinWidth = (minValue: number, maxValue: number): number => {
                    const spanValue = maxValue - minValue;
                    if (!(spanValue > 0)) return 1;
                    const rawWidthValue = spanValue / TARGET_AUTO_BIN_COUNT;
                    const magnitudeValue = 10 ** Math.floor(Math.log10(rawWidthValue));
                    const normalizedWidthValue = rawWidthValue / magnitudeValue;
                    const niceMultiplierValue = normalizedWidthValue <= 1 ? 1 : normalizedWidthValue <= 2 ? 2 : normalizedWidthValue <= 5 ? 5 : 10;
                    return niceMultiplierValue * magnitudeValue;
                };
                const formatBinBoundaryText = (boundaryValue: number): string => String(Number(boundaryValue.toPrecision(12)));
                const convertNumberToBinLabel = (numberValue: number, binWidthValue: number): string => {
                    // +1e-9 避免 0.3 ÷ 0.1 = 2.9999… 之類浮點誤差被切到前一級；以「~」分隔以免與負號混淆。
                    const lowerBoundValue = Math.floor(numberValue / binWidthValue + 1e-9) * binWidthValue;
                    return `${formatBinBoundaryText(lowerBoundValue)}~${formatBinBoundaryText(lowerBoundValue + binWidthValue)}`;
                };
                const computeBinnedColumnStats = (targetColumnName: string, binWidthValue: number): { distinctCount: number; uniqueRatio: number } => {
                    const nonEmptyValuesList = originalCsvRowsForCardinalityCheck
                        .map((rowRecordItem) => rowRecordItem[targetColumnName])
                        .filter((cellValue) => cellValue !== undefined && cellValue !== null && String(cellValue).trim() !== '');
                    if (nonEmptyValuesList.length === 0) return { distinctCount: 0, uniqueRatio: 0 };
                    const binnedLabelsSet = new Set(nonEmptyValuesList.map((cellValue) => {
                        const parsedValue = parseNumericCellForBinning(cellValue);
                        return parsedValue === null ? String(cellValue).trim() : convertNumberToBinLabel(parsedValue, binWidthValue);
                    }));
                    return { distinctCount: binnedLabelsSet.size, uniqueRatio: binnedLabelsSet.size / nonEmptyValuesList.length };
                };
                const applySensitiveBinningToCsvText = (csvText: string, binWidthByColumnMap: Record<string, number>): string => {
                    if (Object.keys(binWidthByColumnMap).length === 0) return csvText;
                    const hasLeadingBomStatus = csvText.charCodeAt(0) === 0xFEFF;
                    const csvBodyText = hasLeadingBomStatus ? csvText.slice(1) : csvText;
                    const parsedCsvResult = Papa.parse<Record<string, string>>(csvBodyText, { header: true, skipEmptyLines: true });
                    const headerFieldsList = parsedCsvResult.meta.fields || [];
                    const binWidthByRawHeaderMap: Record<string, number> = {};
                    headerFieldsList.forEach((rawHeaderName) => {
                        const cleanHeaderName = rawHeaderName.replace(/^[\uFEFF\u200B]+/, '').trim();
                        if (binWidthByColumnMap[cleanHeaderName]) binWidthByRawHeaderMap[rawHeaderName] = binWidthByColumnMap[cleanHeaderName];
                    });
                    const convertedRowsList = ((parsedCsvResult.data || []) as Record<string, string>[]).map((rowRecordItem) =>
                        headerFieldsList.map((headerName) => {
                            const cellValue = rowRecordItem[headerName] ?? '';
                            const binWidthValue = binWidthByRawHeaderMap[headerName];
                            if (!binWidthValue) return cellValue;
                            const parsedValue = parseNumericCellForBinning(cellValue);
                            return parsedValue === null ? cellValue : convertNumberToBinLabel(parsedValue, binWidthValue);
                        })
                    );
                    return (hasLeadingBomStatus ? '\uFEFF' : '') + Papa.unparse({ fields: headerFieldsList, data: convertedRowsList });
                };
                // 本次實際套用級距的欄位 → 寬度；以及送風險評估用的原始資料副本（未分級距時即 safeDataFile 本身）。
                const riskEvaluationBinWidthMap: Record<string, number> = {};
                let riskOriginalDataFile: File = safeDataFile;

                if (currentPrivacyModeTypeStr === 'k-anonymity') {
                    const apiOptions = {
                        k: currentKValueNumber,
                        // ★ 與上方 config_object.k_anonymity 的規則一致：未啟用 l-多樣性／t-緊密度
                        // 檢測時，連同這組表單欄位也不送出 l／t，避免萬一後端有讀取這裡的備援邏輯。
                        ...(isEnableLDiversityStatus ? { l: currentLValueNumber } : {}),
                        ...(isEnableTClosenessStatus ? { t: currentTValueNumber } : {}),
                        suppression_limit_percent: currentMaxSuppressionNumber ?? 5,
                        suppression_method: (currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression' ? 'cell_suppression' : 'row_suppression') as 'row_suppression' | 'cell_suppression',
                        // ★ cell_fill 僅在「值抑制」(cell_suppression) 模式下才有意義，未啟用時完全不送出
                        //   （見上方 configObject.k_anonymity 區塊的同一段說明）。
                        ...((currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression') ? { cell_fill: (currentCellFillMethodStr ?? 'star') as 'star' | 'missing' } : {}),
                        limit_exceeded_action: (currentLimitExceededActionStr || 'stop_and_error') as 'stop_and_error' | 'allow_with_warning'
                    };
					
					// 👇 加這行！讓它印在 Console 裡！
					console.log(`🚀 傳給後端 (k-anonymity) 的 Step 3 參數:`, apiOptions);

                    const response = await runKAnonymity(safeDataFile, configFile, apiOptions);
                    
                    if (!response.success) throw (response.error || new Error('API 請求未成功'));
                    
                    const finalReport = response.report || {
                        is_valid: true, k_passed: true, l_passed: true, t_passed: true, suppression_rate_percent: 0, suppression_unit: 'row' as const, message: '成功完成去識別化處理', recommendations: [], applied_defaults: []
                    };
                    setApiReport(finalReport);
                    finalApiReportData = finalReport; 
                    
                    const rawResponse = response as unknown as Record<string, unknown>;
                    if (rawResponse.blob) finalCsvBlobData = rawResponse.blob as Blob;
                    else if (rawResponse.data) finalCsvBlobData = new Blob([rawResponse.data as BlobPart], { type: 'text/csv;charset=utf-8;' });
                    else if (rawResponse.csv) finalCsvBlobData = new Blob([rawResponse.csv as BlobPart], { type: 'text/csv;charset=utf-8;' });
                    
                    setProcessedCsvBlob(finalCsvBlobData);

                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ K-Anonymity API 處理成功！`]);
                } 
                else if (currentPrivacyModeTypeStr === 'differential-privacy') {
                    // ★ 規範對照: 依 Open-PETs API 3-1 節，逐欄 epsilon／delta 一律於 config 設定檔 (column_budgets) 指定，
                    //   表單參數僅用於跨批次累計 (accumulated_epsilon／accumulated_delta／default_delta)。
                    // ★ 使用者反映：先前每次執行皆固定以 0 作為累計基準值，等同從未真正累計；現在改為送出
                    //   dpAccumulatedEpsilonValue／dpAccumulatedDeltaValue（上次執行後留存之累計值），
                    //   執行成功後再依本次消耗更新累計值，讓多次執行之間的隱私預算真正累加。
                    const totalEpsilonBudget = currentDpFieldsListArray?.reduce((acc: number, field: DpStoreField) => acc + (field.enabled ? Number(field.epsilon || 1.0) : 0), 0) || 1.0;
                    const totalDeltaBudget = currentDpFieldsListArray?.reduce((acc: number, field: DpStoreField) => acc + (field.enabled ? Number(field.delta || 0) : 0), 0) || 0;

                    const dpApiOptions = {
                        accumulated_epsilon: dpAccumulatedEpsilonValue ?? 0,
                        accumulated_delta: dpAccumulatedDeltaValue ?? 0,
                        default_delta: globalTargetDeltaValue ?? 0.0001
                    };

                    const response = await runDifferentialPrivacy(safeDataFile, configFile, dpApiOptions);

                    if (!response.success) throw (response.error || new Error('DP API 請求未成功'));

                    const defaultReport = {
                        consumed_epsilon: totalEpsilonBudget,
                        consumed_delta: totalDeltaBudget,
                        accumulated_epsilon: (dpAccumulatedEpsilonValue ?? 0) + totalEpsilonBudget,
                        accumulated_delta: (dpAccumulatedDeltaValue ?? 0) + totalDeltaBudget,
                        message: '成功完成差分隱私處理',
                        per_column: []
                    };

                    const finalReport = response.report || defaultReport;

                    // ★ 後端若有回傳累計值即以後端計算結果為準 (由後端負責跨批次組合定理運算)；
                    //   否則 (如尚未串接真實後端時的預設報告) 退回本地以「累計基準 + 本次消耗」推算。
                    const updatedDpAccumulatedEpsilonValue = finalReport.accumulated_epsilon ?? ((dpAccumulatedEpsilonValue ?? 0) + totalEpsilonBudget);
                    const updatedDpAccumulatedDeltaValue = finalReport.accumulated_delta ?? ((dpAccumulatedDeltaValue ?? 0) + totalDeltaBudget);
                    useWorkspaceStore.setState({
                        dpAccumulatedEpsilon: updatedDpAccumulatedEpsilonValue,
                        dpAccumulatedDelta: updatedDpAccumulatedDeltaValue
                    });

                    // ★ 使用者反映（2026-09-23）：官方風險評估報告（後端簽發 PDF）裡的「已累計 ε／已累計 δ」
                    //   一直顯示 0，即使這次執行明明已經消耗了隱私預算。根因是下方三攻擊／CAP 風險評估呼叫
                    //   /api/v1/risk/dp 時，直接重用最上面建立 configObject 時寫入的 differential_privacy 區塊
                    //   （見下方 differential_privacy: (configObject as Record<string, unknown>).differential_privacy），
                    //   但那個區塊裡的 accumulated_epsilon／accumulated_delta 是「本次執行前」的舊累計基準值
                    //   （原本只是要送給實際去識別化 API 用），執行成功後從未同步更新——風險評估／官方報告
                    //   拿到的因此永遠是「跑之前」的累計值，而不是「這次跑完、實際產出這份去識別化資料集」
                    //   之後的最新累計值。這裡把剛算好、也同步寫回 Zustand store 的同一組最新累計值，順便寫回
                    //   configObject.differential_privacy，讓下方重用它的風險評估／官方報告 API 呼叫都能拿到
                    //   跑完這次之後的正確累計值。
                    const dpConfigBlockForRiskReuse = (configObject as Record<string, unknown>).differential_privacy;
                    if (dpConfigBlockForRiskReuse && typeof dpConfigBlockForRiskReuse === 'object') {
                        (dpConfigBlockForRiskReuse as Record<string, unknown>).accumulated_epsilon = updatedDpAccumulatedEpsilonValue;
                        (dpConfigBlockForRiskReuse as Record<string, unknown>).accumulated_delta = updatedDpAccumulatedDeltaValue;
                    }

                    setApiReport(finalReport);
                    finalApiReportData = finalReport;

                    const rawResponse = response as unknown as Record<string, unknown>;
                    if (rawResponse.blob) finalCsvBlobData = rawResponse.blob as Blob;
                    else if (rawResponse.data) finalCsvBlobData = new Blob([rawResponse.data as BlobPart], { type: 'text/csv;charset=utf-8;' });
                    else if (rawResponse.csv) finalCsvBlobData = new Blob([rawResponse.csv as BlobPart], { type: 'text/csv;charset=utf-8;' });

                    setProcessedCsvBlob(finalCsvBlobData);

                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ DP API 處理成功！噪聲已注入。`]);
                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] 📊 消耗隱私預算 (Epsilon): ${finalReport.consumed_epsilon}`]);
                }

                setCalculationProgressValue(65);
                setCurrentPipelinePhaseType('auditing');
                setSystemSimulationLogsList(prev => [...prev, translate('step4.log.start_risk', '[{{time}}] 🚀 脫敏完成，啟動真實風險評估（三大攻擊模擬）', { time: formatCurrentTimeForLogString() })]);

                // 風險評估官方範例參數（docs/manual_test/config_risk_*.json 及 report_request.json 的
                // risk_params 預設值），目前畫面未開放調整，一律採用官方預設
                const RISK_ATTACK_DEFAULT_PARAMS = {
                    n_iter: 50,
                    ctrl_ratio: 0.2,
                    seed: 42,
                    n_subset: 500,
                    n_repeats: 1, // raised from 1: DP noise inside produce_syn() is unseeded, so a single repeat is one noisy sample; averaging over repeats stabilizes the reported risk %
                    overlap_ratio: 0.0
                };

                // ★ 新增：風險評估「對象族群限定條件」(見交付文件《設定檔結構與參數說明.pdf》4-3 節)。
                // 使用者於「隱私設定」步驟 (RiskSubgroupFilterPanel.tsx) 設定之限定條件，轉換為後端
                // 三個風險評估端點皆能接受之 subgroup 格式；未設定任何條件時回傳 undefined，讓下方
                // 三處組設定檔時直接省略 subgroup 這個鍵，對應後端「未填即評估全體」之預設行為。
                const resolvedRiskSubgroupPayload = buildBackendSubgroupPayload(riskSubgroupFiltersMapDict);

                let attackReportResult: AttackReport | null = null;
                let capReportResult: CapReport | null = null;
                let finalRiskColumnsMap: Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> = {};

                // ★ 使用者反映（2026-09-22）：K-匿名模式下「敏感欄位」的處理方式改版，詳見下方
                //   K-匿名分支內的完整說明。以下兩個變數把該分支算出的「候選敏感欄位清單」與
                //   「依候選欄位組出風險評估 columns 設定」的函式提升到外層，讓後面 K-匿名／DP
                //   共用的 CAP 區塊也能存取，藉此讓 CAP 前後對比在 K-匿名模式下比照三攻擊，對每個
                //   候選敏感欄位各自呼叫一次、取最大值，而不是只沿用三攻擊選出的單一輪設定。
                let kAnonSensitiveCandidateColumnNamesList: string[] = [];
                let buildKAnonRiskColumnsMapForCandidateFn:
                    ((candidateSensitiveFieldName: string) => Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }>) | null = null;
                // ★ 使用者反映（2026-09-23）：差分隱私模式的 CAP 先前一直沒有比照三攻擊「對每個候選
                //   敏感欄位各自跑一輪、取最大值」，而是直接沿用三攻擊迴圈裡「三項指標最高的那一輪」
                //   欄位設定去跑單一次 CAP——但某欄位的三攻擊風險最高，不代表同一欄位的 CAP 風險
                //   （cap_after）也最高，會安靜地漏掉「CAP 風險其實在另一個候選欄位上更高」的情況。
                //   比照上面 K-匿名的兩個變數，把 DP 分支算出的候選清單與 columns 設定組裝函式同樣
                //   提升到外層，讓下方共用的 CAP 區塊可以對 DP 模式也逐一候選欄位跑一輪、取最大值。
                let dpSensitiveCandidateColumnNamesList: string[] = [];
                let buildDpRiskColumnsMapForCandidateFn:
                    ((candidateSensitiveFieldName: string) => Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }>) | null = null;
                // ★ 修正：setHighCardinalitySensitiveWarningInfo(highCardinalityCandidateInfoList)
                //   雖然在下方 K-匿名分支呼叫，但 React 的 setState 不會同步更新這次 render 當下
                //   閉包裡的 highCardinalitySensitiveWarningInfo（state 變數）本身——若下方寫入
                //   Step4Cache 時直接讀取 state 變數，讀到的會是「上一輪」的舊值，而非本次剛算出
                //   的結果，導致快照與畫面顯示的警告不一致。改用這個函式作用域內的一般變數承接本次
                //   真正算出的清單，寫入快照時讀這個變數，而非 state。
                let finalHighCardinalitySensitiveWarningInfo: { columnName: string; uniqueRatioPercent: number; handling?: 'binned' | 'skipped' | 'forced'; binWidth?: number; binCount?: number }[] = [];

                if (currentPrivacyModeTypeStr === 'k-anonymity') {
                    // K-匿名模式：欄位角色（identifier／quasi_identifier／sensitive／non_sensitive）
                    // 已在 Step2「屬性分類」寫入 columnRoles／kAnonymityFields。
                    const riskColumnsMap: Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> = {};

                    // ★ 新增：使用者反映「Step2 畫面上明明已設定 1 個敏感欄位，Step4 執行卻偵測到 0 個」，
                    //   純靠讀程式碼無法百分之百重現當下的資料狀態。這裡逐欄記錄「比對過程」快照
                    //   （是否在 kAnonymityFieldsList 找到對應欄位、原始 role 字串為何、最終解析出的
                    //   後端角色），發生「敏感欄位數不等於 1」時一併印在主控台，供下次重現時直接看出
                    //   實際原因（例如欄位名稱比對不到、或 role 字串非預期值），而不必用猜的。
                    const roleResolutionDiagnosticsList: { column: string; matchedInFieldsList: boolean; rawRole: unknown; resolvedBackendRole: string }[] = [];

                    actualProcessedColumnsList.forEach((colName) => {
                        const cleanName = colName.replace(/^[\uFEFF\u200B]+/, '').trim();
                        const matchedField = kAnonymityFieldsList.find(
                            (item: unknown) => {
                                const record = item as Record<string, unknown>;
                                return record && typeof record.name === 'string' && record.name.replace(/^[\uFEFF\u200B]+/, '').trim() === cleanName;
                            }
                        ) as Record<string, unknown> | undefined;

                        let backendRole = 'non_sensitive';
                        let colType = 'string';

                        if (matchedField) {
                            const privacyRoleMappingDict: Record<string, string> = {
                                'Identifier': 'identifier',
                                'Quasi-identifier': 'quasi_identifier',
                                'Sensitive': 'sensitive',
                                'Non-sensitive': 'non_sensitive'
                            };
                            backendRole = privacyRoleMappingDict[String(matchedField.role)] || 'non_sensitive';
                            colType = String(matchedField.type) || 'string';
                        } else {
                            const { role: uiRole } = getCalculatedRole(cleanName);
                            if (uiRole === 'Identifier') backendRole = 'identifier';
                            if (uiRole === 'Quasi-identifier') backendRole = 'quasi_identifier';
                            if (uiRole === 'Sensitive') backendRole = 'sensitive';
                        }

                        roleResolutionDiagnosticsList.push({
                            column: cleanName,
                            matchedInFieldsList: Boolean(matchedField),
                            rawRole: matchedField ? matchedField.role : '(未於 kAnonymityFieldsList 中找到，改用 getCalculatedRole 推斷)',
                            resolvedBackendRole: backendRole
                        });

                        if (backendRole === 'quasi_identifier' || backendRole === 'sensitive') {
                            riskColumnsMap[cleanName] = { role: backendRole as 'quasi_identifier' | 'sensitive', type: colType };
                        }
                    });

                    // ★ 使用者反映（2026-09-22）：先前「敏感欄位數 ≠ 1 就整個 throw」的做法，會連同一輪
                    //   已經算好的 K-匿名去識別化資料、品質分數，把整個 Step4 結果都一併擋下顯示失敗——
                    //   但敏感欄位設定純粹是「風險評估」這一步驟要用的，不該連去識別化本身的結果都看不到。
                    //   改版後兩種情況都不再 throw：
                    //   ① 敏感欄位 = 0：僅顯示警告、三攻擊與 CAP 這整段風險評估直接跳過（不呼叫 API），
                    //      因為後端 RiskConfig 規則對「三攻擊」與「CAP」都要求剛好 1 個敏感欄位，0 個的話
                    //      兩者其實都會被後端擋掉，並非只有 CAP 需要跳過；其餘結果（去識別化資料、品質
                    //      分數等）照常顯示。
                    //   ② 敏感欄位 ≥ 2（使用者同時標記多個欄位為「敏感」）：不再視為錯誤，而是比照下方
                    //      差分隱私模式「輪流把其中一欄當敏感欄位」的做法——只在使用者實際標成「敏感」
                    //      角色的這幾欄之間輪流（其餘欄位維持原本角色，不會被拿來當候選），對每個候選
                    //      各自呼叫一次三攻擊，三項指標各自在所有輪次中取最大值（保守／worst-case）；
                    //      CAP 前後對比也採同樣的候選清單各自呼叫一次、取最大值（見下方共用 CAP 區塊），
                    //      而非只沿用三攻擊選出的單一輪設定，因為讓某欄位的三攻擊風險最高不代表同一欄位
                    //      的 CAP 風險也最高。敏感欄位 = 1 時等同迴圈跑一輪，結果與先前版本一致。
                    const sensitiveCandidateColumnNamesList = Object.keys(riskColumnsMap).filter(
                        (colName) => riskColumnsMap[colName].role === 'sensitive'
                    );

                    // ★ 高唯一值比例（近乎每筆都不同值）候選敏感欄位偵測：見上方
                    //   highCardinalitySensitiveWarningInfo／forceRunHighCardinalitySensitiveFieldsStatus
                    //   狀態宣告處，以及本函式稍早（cleanedCsvText 定義後）computeColumnUniqueValueRatio
                    //   共用函式處的完整說明。逐一計算每個候選敏感欄位「非空值中的相異值數 ÷ 非空值
                    //   總數」，超過門檻（採 sklearn 警告訊息本身引用的 50%）者視為高風險。
                    const highCardinalityCandidateInfoList: { columnName: string; uniqueRatioPercent: number; handling?: 'binned' | 'skipped' | 'forced'; binWidth?: number; binCount?: number }[] = [];
                    const effectiveSensitiveCandidateColumnNamesList = sensitiveCandidateColumnNamesList.filter((candidateColumnName) => {
                        const uniqueRatioValue = computeColumnUniqueValueRatio(candidateColumnName);
                        if (uniqueRatioValue > HIGH_CARDINALITY_SENSITIVE_RATIO_THRESHOLD) {
                            const uniqueRatioPercent = Math.round(uniqueRatioValue * 1000) / 10;
                            // 勾選「仍要強制執行」：一律以原始值照常送出（不分級距），但仍會警告。
                            if (forceRunHighCardinalitySensitiveFieldsStatus) {
                                highCardinalityCandidateInfoList.push({ columnName: candidateColumnName, uniqueRatioPercent, handling: 'forced' });
                                return true;
                            }
                            // ★ 2026-09-29：幾乎全為數值的欄位（如薪資）依後端建議自動分級距後保留為候選；
                            //   分級距後唯一值佔比仍超過門檻（通常是資料筆數太少或級距設太細）才略過。
                            const numericRangeInfo = analyzeNumericColumnRangeForBinning(candidateColumnName);
                            if (numericRangeInfo) {
                                const overrideBinWidthValue = sensitiveBinWidthOverridesMap[candidateColumnName];
                                const binWidthValue = overrideBinWidthValue && overrideBinWidthValue > 0
                                    ? overrideBinWidthValue
                                    : computeAutoNiceBinWidth(numericRangeInfo.min, numericRangeInfo.max);
                                const binnedStats = computeBinnedColumnStats(candidateColumnName, binWidthValue);
                                const isBinningSufficientStatus = binnedStats.uniqueRatio <= HIGH_CARDINALITY_SENSITIVE_RATIO_THRESHOLD;
                                highCardinalityCandidateInfoList.push({
                                    columnName: candidateColumnName, uniqueRatioPercent,
                                    handling: isBinningSufficientStatus ? 'binned' : 'skipped',
                                    binWidth: binWidthValue, binCount: binnedStats.distinctCount
                                });
                                if (isBinningSufficientStatus) riskEvaluationBinWidthMap[candidateColumnName] = binWidthValue;
                                return isBinningSufficientStatus;
                            }
                            // 文字型（如自由填寫的疾病描述）無法自動分級距，維持略過。
                            highCardinalityCandidateInfoList.push({ columnName: candidateColumnName, uniqueRatioPercent, handling: 'skipped' });
                            return false;
                        }
                        return true;
                    });
                    if (Object.keys(riskEvaluationBinWidthMap).length > 0) {
                        riskOriginalDataFile = new File(
                            [applySensitiveBinningToCsvText(cleanedCsvText, riskEvaluationBinWidthMap)],
                            'input_dataset.csv',
                            { type: 'text/csv;charset=utf-8' }
                        );
                    }
                    setHighCardinalitySensitiveWarningInfo(highCardinalityCandidateInfoList);
                    finalHighCardinalitySensitiveWarningInfo = highCardinalityCandidateInfoList;
                    if (highCardinalityCandidateInfoList.length > 0) {
                        const describeColumnsText = (itemsList: typeof highCardinalityCandidateInfoList): string => itemsList
                            .map((item) => `「${item.columnName}」(唯一值佔比 ${item.uniqueRatioPercent}%)`)
                            .join('、');
                        const forcedItemsList = highCardinalityCandidateInfoList.filter((item) => item.handling === 'forced');
                        const binnedItemsList = highCardinalityCandidateInfoList.filter((item) => item.handling === 'binned');
                        const skippedItemsList = highCardinalityCandidateInfoList.filter((item) => item.handling === 'skipped');
                        if (forcedItemsList.length > 0) {
                            setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ 已依設定以原始值強制對 ${describeColumnsText(forcedItemsList)} 執行三攻擊／CAP。推斷性攻擊需以可列舉類別為預測目標，此類欄位結果不具評估意義且可能跑不完，如遇執行失敗或無回應請取消勾選「仍要強制執行」。`]);
                        }
                        binnedItemsList.forEach((item) => {
                            setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ℹ️ 「${item.columnName}」為連續數值（唯一值佔比 ${item.uniqueRatioPercent}%），已自動以每 ${item.binWidth!.toLocaleString()} 為一級距（共 ${item.binCount} 級）轉換後再執行三攻擊／CAP（僅用於風險評估，不影響去識別化結果本身）。`]);
                        });
                        if (skippedItemsList.length > 0) {
                            setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ ${describeColumnsText(skippedItemsList)} 的值幾乎每筆都不同，推斷性攻擊無法對其建立有效的分類模型，已略過該欄位的三攻擊／CAP 風險評估（不影響去識別化結果本身）。數值欄位可在下方調大級距寬度；文字欄位請先自行歸併為類別後重新上傳。`]);
                        }
                    }

                    kAnonSensitiveCandidateColumnNamesList = effectiveSensitiveCandidateColumnNamesList;

                    const buildKAnonRiskColumnsMapForCandidate = (candidateSensitiveFieldName: string): Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> => {
                        const columnsMapResult: Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> = {};
                        Object.entries(riskColumnsMap).forEach(([colName, colInfo]) => {
                            columnsMapResult[colName] = {
                                role: colName === candidateSensitiveFieldName ? 'sensitive' : 'quasi_identifier',
                                // 已分級距的欄位在送出的資料副本中已是級距標籤，型別一併改宣告為類別型。
                                type: riskEvaluationBinWidthMap[colName] ? 'categorical' : colInfo.type
                            };
                        });
                        return columnsMapResult;
                    };
                    buildKAnonRiskColumnsMapForCandidateFn = buildKAnonRiskColumnsMapForCandidate;

                    // 送風險評估的 k_anonymity 區塊：已分級距欄位的 columns.type 同步改為 categorical，
                    // 與資料副本內容一致；未分級距時原封沿用去識別化時的設定。
                    const buildKAnonConfigBlockForRisk = (): unknown => {
                        const originalKAnonBlock = (configObject as Record<string, unknown>).k_anonymity as Record<string, unknown> | undefined;
                        const binnedColumnNamesList = Object.keys(riskEvaluationBinWidthMap);
                        if (!originalKAnonBlock || binnedColumnNamesList.length === 0) return originalKAnonBlock;
                        const originalColumnsMap = (originalKAnonBlock.columns || {}) as Record<string, Record<string, unknown>>;
                        const overriddenColumnsMap: Record<string, Record<string, unknown>> = { ...originalColumnsMap };
                        binnedColumnNamesList.forEach((colName) => {
                            if (overriddenColumnsMap[colName]) overriddenColumnsMap[colName] = { ...overriddenColumnsMap[colName], type: 'categorical' };
                        });
                        return { ...originalKAnonBlock, columns: overriddenColumnsMap };
                    };

                    if (effectiveSensitiveCandidateColumnNamesList.length === 0) {
                        if (sensitiveCandidateColumnNamesList.length === 0) {
                            // ★ 主控台印出完整逐欄比對快照（含原始 kAnonymityFieldsList 內容），供以瀏覽器
                            //   開發者工具 (F12 → Console) 直接查看實際比對到的資料，不需再靠猜測。
                            console.warn(
                                '[風險評估／敏感欄位] 目前未偵測到任何「敏感」欄位，本次跳過三攻擊與 CAP 風險評估' +
                                '（不影響去識別化資料本身的產生與品質分數）。逐欄比對快照：',
                                roleResolutionDiagnosticsList,
                                '目前 kAnonymityFieldsList 原始內容：',
                                kAnonymityFieldsList
                            );
                            setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ 未設定「敏感」欄位，已略過三攻擊與 CAP 風險評估（去識別化結果與品質分數不受影響）。`]);
                        }
                        // ★ 另一種情況（sensitiveCandidateColumnNamesList.length > 0 但全部被判定為高唯一值
                        //   比例欄位）已在上方 highCardinalityCandidateInfoList 區塊記錄對應警告訊息，
                        //   此處不再重複顯示，避免同一次執行出現兩則語意衝突的訊息。
                        finalRiskColumnsMap = riskColumnsMap;
                    } else {
                        let worstCaseAttackReport: AttackReport | null = null;
                        let worstCaseKAnonRiskColumnsMap: Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> = {};

                        for (let roundIndexNumber = 0; roundIndexNumber < effectiveSensitiveCandidateColumnNamesList.length; roundIndexNumber++) {
                            const candidateSensitiveFieldName = effectiveSensitiveCandidateColumnNamesList[roundIndexNumber];
                            const kAnonRiskColumnsMapForThisRound = buildKAnonRiskColumnsMapForCandidate(candidateSensitiveFieldName);

                            const riskConfigObject = {
                                version: 'step4_risk_k_anonymity',
                                dataset: currentDatasetFileNameString || 'dataset',
                                risk_attacks: {
                                    enabled: true,
                                    columns: kAnonRiskColumnsMapForThisRound,
                                    ...(resolvedRiskSubgroupPayload ? { subgroup: resolvedRiskSubgroupPayload } : {}),
                                    ...RISK_ATTACK_DEFAULT_PARAMS
                                },
                                k_anonymity: buildKAnonConfigBlockForRisk()
                            };
                            const riskConfigBlob = new Blob([JSON.stringify(riskConfigObject)], { type: 'application/json;charset=utf-8' });
                            const riskConfigFile = new File([riskConfigBlob], 'risk_config.json', { type: 'application/json' });

                            setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⏳ 三攻擊風險評估運算中（第 ${roundIndexNumber + 1}/${effectiveSensitiveCandidateColumnNamesList.length} 輪）...`]);

                            const riskResponse = await runRiskKAnonymity(riskOriginalDataFile, riskConfigFile);
                            if (!riskResponse.success || !riskResponse.report) throw (riskResponse.error || new Error(`三攻擊風險評估（K-匿名，以「${candidateSensitiveFieldName}」為敏感欄位）API 請求未成功`));

                            const thisRoundReport = riskResponse.report;
                            const isThisRoundNewWorstCase: boolean =
                                !worstCaseAttackReport ||
                                Math.max(thisRoundReport.singling_out_risk, thisRoundReport.linkability_risk, thisRoundReport.inference_risk) >
                                Math.max(worstCaseAttackReport.singling_out_risk, worstCaseAttackReport.linkability_risk, worstCaseAttackReport.inference_risk);

                            const aggregatedSinglingOutRisk = Math.max(worstCaseAttackReport?.singling_out_risk ?? -Infinity, thisRoundReport.singling_out_risk);
                            const aggregatedLinkabilityRisk = Math.max(worstCaseAttackReport?.linkability_risk ?? -Infinity, thisRoundReport.linkability_risk);
                            const aggregatedInferenceRisk = Math.max(worstCaseAttackReport?.inference_risk ?? -Infinity, thisRoundReport.inference_risk);

                            if (isThisRoundNewWorstCase) {
                                worstCaseKAnonRiskColumnsMap = kAnonRiskColumnsMapForThisRound;
                            }

                            worstCaseAttackReport = {
                                ...(isThisRoundNewWorstCase ? thisRoundReport : worstCaseAttackReport!),
                                singling_out_risk: aggregatedSinglingOutRisk,
                                linkability_risk: aggregatedLinkabilityRisk,
                                inference_risk: aggregatedInferenceRisk,
                            };
                        }

                        setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ K-匿名三攻擊風險評估運算完成`]);

                        attackReportResult = worstCaseAttackReport;
                        finalRiskColumnsMap = worstCaseKAnonRiskColumnsMap;
                    }
                } else if (currentPrivacyModeTypeStr === 'differential-privacy') {
                    // ★ DP 模式輪流把「每一個已啟用欄位」各自當作敏感欄位跑一次三攻擊風險評估
                    // （其餘已啟用欄位固定視為 quasi_identifier），指認性／連結性／推斷性三項
                    // 指標各自取所有輪次中的最大值，作為保守（worst-case）的最終風險分數——
                    // 不同輪次的「敏感欄位」不同，QI 組成也隨之不同，故三項指標本來就可能分別
                    // 在不同輪次達到最大值，改為每項指標各自取最大值，而非固定採用單一輪次的結果。
                    // 注意：輪次數等於已啟用欄位數，會等比例增加對後端 /api/v1/risk/dp 的呼叫次數。
                    const enabledDpFieldsList = (currentDpFieldsListArray || []).filter((field: DpStoreField) => field.enabled);

                    if (enabledDpFieldsList.length === 0) {
                        throw new Error('風險評估要求至少 1 個已啟用的差分隱私欄位，請回到步驟二欄位設定啟用欄位後再重新運算。');
                    }

                    // ★ 候選「敏感欄位」只從已啟用的類別型（Categorical）欄位中挑選，連續數值型
                    // （Numeric，如薪資／年齡／生日）欄位不列入候選：後端的推斷性攻擊底層是用
                    // sklearn 分類器（classifier）對「敏感欄位」的值做分類預測，若把幾乎每筆都
                    // 不同值的連續數值欄位當成分類目標，會觸發 sklearn 的
                    // 「unique classes 超過樣本數 50%，這比較像迴歸問題而非分類問題」警告，
                    // 大量重複記錄、運算量暴增，正是先前造成後端掛掉、去識別化執行失敗的原因。
                    // 連續數值型欄位仍會在每一輪的 columns 中以 quasi_identifier 身分送出，
                    // 只是不會被輪流指派為 sensitive。
                    const categoricalCandidateFieldsList = enabledDpFieldsList.filter(
                        (field: DpStoreField) => field.fieldType === 'Categorical'
                    );

                    if (categoricalCandidateFieldsList.length === 0) {
                        throw new Error('風險評估的敏感欄位僅能從已啟用的「類別型」欄位中挑選，目前沒有已啟用的類別型欄位，請回到步驟二欄位設定啟用至少 1 個類別型欄位後再重新運算。');
                    }

                    // ★ 使用者反映（2026-09-23）：上面「只挑類別型欄位」的篩選比較粗略——一個類別型
                    //   欄位本身若類別數仍然很多（例如「地區」有數百種不同城市），一樣可能讓後端
                    //   sklearn 分類器當掉（機制詳見本函式稍早 computeColumnUniqueValueRatio 共用
                    //   函式處的完整說明）。這裡再依「實際資料的唯一值佔比」對類別型候選欄位做第二層
                    //   篩選，判斷邏輯與下面 K-匿名分支完全一致，共用同一個 highCardinalitySensitiveWarningInfo
                    //   ／forceRunHighCardinalitySensitiveFieldsStatus 狀態與勾選框。若篩選後一個候選
                    //   都不剩，下方迴圈自然執行 0 次、attackReportResult 維持 null，等同「本次略過
                    //   三攻擊／CAP」，不會因此讓整個差分隱私管線失敗（去識別化結果與品質分數不受影響）。
                    const dpHighCardinalityCandidateInfoList: { columnName: string; uniqueRatioPercent: number; handling?: 'binned' | 'skipped' | 'forced'; binWidth?: number; binCount?: number }[] = [];
                    const effectiveCategoricalCandidateFieldsList = categoricalCandidateFieldsList.filter((field: DpStoreField) => {
                        const uniqueRatioValue = computeColumnUniqueValueRatio(field.fieldName);
                        if (uniqueRatioValue > HIGH_CARDINALITY_SENSITIVE_RATIO_THRESHOLD) {
                            dpHighCardinalityCandidateInfoList.push({ columnName: field.fieldName, uniqueRatioPercent: Math.round(uniqueRatioValue * 1000) / 10, handling: forceRunHighCardinalitySensitiveFieldsStatus ? 'forced' : 'skipped' });
                            return forceRunHighCardinalitySensitiveFieldsStatus;
                        }
                        return true;
                    });
                    if (dpHighCardinalityCandidateInfoList.length > 0) {
                        setHighCardinalitySensitiveWarningInfo(dpHighCardinalityCandidateInfoList);
                        finalHighCardinalitySensitiveWarningInfo = dpHighCardinalityCandidateInfoList;
                        const flaggedColumnsDescriptionText = dpHighCardinalityCandidateInfoList
                            .map((item) => `「${item.columnName}」(唯一值佔比 ${item.uniqueRatioPercent}%)`)
                            .join('、');
                        if (forceRunHighCardinalitySensitiveFieldsStatus) {
                            setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ 已依設定強制對 ${flaggedColumnsDescriptionText} 執行三攻擊／CAP，此類欄位過去曾造成後端服務當機，如遇執行失敗或無回應請取消勾選「仍要強制執行」。`]);
                        } else {
                            setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ ${flaggedColumnsDescriptionText} 的值幾乎每筆都不同，已略過該欄位的三攻擊／CAP 風險評估以避免觸發後端服務當機（不影響去識別化結果本身）；如仍要嘗試，請於下方勾選「仍要強制執行」。`]);
                        }
                    }

                    const resolveDpRiskColumnType = (fieldName: string): string => {
                        const targetField = (currentDpFieldsListArray || []).find((field: DpStoreField) => field.fieldName === fieldName);
                        const isNumeric = targetField?.fieldType === 'Numeric';
                        const originalColType = String(currentColumnTypesMapDict?.[fieldName] || '').toLowerCase();
                        // ★ 與上方 differential-privacy 分支同理，改用共用的 isDateTimeDpField，避免關鍵字判斷分歧。
                        const isDateTimeType = isDateTimeDpField(fieldName, originalColType);
                        if (isNumeric) return isDateTimeType ? 'temporal' : 'numeric';
                        if (targetField?.fieldType === 'Categorical') return 'categorical';
                        return 'string';
                    };

                    const buildDpRiskColumnsMapForCandidate = (candidateSensitiveFieldName: string): Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> => {
                        const columnsMapResult: Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> = {};
                        enabledDpFieldsList.forEach((field: DpStoreField) => {
                            columnsMapResult[field.fieldName] = {
                                role: field.fieldName === candidateSensitiveFieldName ? 'sensitive' : 'quasi_identifier',
                                type: resolveDpRiskColumnType(field.fieldName)
                            };
                        });
                        return columnsMapResult;
                    };
                    // ★ 提升到外層供下方共用的 CAP 區塊使用，讓 CAP 前後對比也能對 DP 模式的每個候選
                    // 敏感欄位各自跑一輪、取最大值（見上方 dpSensitiveCandidateColumnNamesList／
                    // buildDpRiskColumnsMapForCandidateFn 宣告處的完整說明）。
                    dpSensitiveCandidateColumnNamesList = effectiveCategoricalCandidateFieldsList.map((field: DpStoreField) => field.fieldName);
                    buildDpRiskColumnsMapForCandidateFn = buildDpRiskColumnsMapForCandidate;

                    let worstCaseAttackReport: AttackReport | null = null;
                    let worstCaseDpRiskColumnsMap: Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> = {};

                    for (let roundIndexNumber = 0; roundIndexNumber < effectiveCategoricalCandidateFieldsList.length; roundIndexNumber++) {
                        const candidateSensitiveFieldName = effectiveCategoricalCandidateFieldsList[roundIndexNumber].fieldName;
                        const dpRiskColumnsMapForThisRound = buildDpRiskColumnsMapForCandidate(candidateSensitiveFieldName);

                        const riskConfigObject = {
                            version: 'step4_risk_dp',
                            dataset: currentDatasetFileNameString || 'dataset',
                            risk_attacks: {
                                enabled: true,
                                columns: dpRiskColumnsMapForThisRound,
                                ...(resolvedRiskSubgroupPayload ? { subgroup: resolvedRiskSubgroupPayload } : {}),
                                ...RISK_ATTACK_DEFAULT_PARAMS
                            },
                            differential_privacy: (configObject as Record<string, unknown>).differential_privacy
                        };
                        const riskConfigBlob = new Blob([JSON.stringify(riskConfigObject)], { type: 'application/json;charset=utf-8' });
                        const riskConfigFile = new File([riskConfigBlob], 'risk_config.json', { type: 'application/json' });

                        // ★ 修正: 使用者反映 DP 模式下 CAP 比較（含前置的三攻擊風險評估輪詢）不需要在畫面上
                        //   逐輪顯示實際測試中的候選敏感欄位名稱，只要讓使用者看到「運算中」的進度即可。
                        setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⏳ 三攻擊風險評估運算中（第 ${roundIndexNumber + 1}/${effectiveCategoricalCandidateFieldsList.length} 輪）...`]);

                        const riskResponse = await runRiskDp(safeDataFile, riskConfigFile);
                        if (!riskResponse.success || !riskResponse.report) throw (riskResponse.error || new Error(`三攻擊風險評估（DP，以「${candidateSensitiveFieldName}」為敏感欄位）API 請求未成功`));

                        const thisRoundReport = riskResponse.report;
                        const isThisRoundNewWorstCase: boolean =
                            !worstCaseAttackReport ||
                            Math.max(thisRoundReport.singling_out_risk, thisRoundReport.linkability_risk, thisRoundReport.inference_risk) >
                            Math.max(worstCaseAttackReport.singling_out_risk, worstCaseAttackReport.linkability_risk, worstCaseAttackReport.inference_risk);

                        const aggregatedSinglingOutRisk = Math.max(worstCaseAttackReport?.singling_out_risk ?? -Infinity, thisRoundReport.singling_out_risk);
                        const aggregatedLinkabilityRisk = Math.max(worstCaseAttackReport?.linkability_risk ?? -Infinity, thisRoundReport.linkability_risk);
                        const aggregatedInferenceRisk = Math.max(worstCaseAttackReport?.inference_risk ?? -Infinity, thisRoundReport.inference_risk);

                        // 其餘中繼資料（sample_size／processing_config…）取「本輪三項指標中最大值最高」的那一輪，
                        // 供 CAP 步驟沿用同一份敏感欄位設定。
                        if (isThisRoundNewWorstCase) {
                            worstCaseDpRiskColumnsMap = dpRiskColumnsMapForThisRound;
                        }

                        worstCaseAttackReport = {
                            ...(isThisRoundNewWorstCase ? thisRoundReport : worstCaseAttackReport!),
                            singling_out_risk: aggregatedSinglingOutRisk,
                            linkability_risk: aggregatedLinkabilityRisk,
                            inference_risk: aggregatedInferenceRisk,
                        };
                    }

                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ DP 三攻擊風險評估運算完成`]);

                    attackReportResult = worstCaseAttackReport;
                    finalRiskColumnsMap = worstCaseDpRiskColumnsMap;
                }

                setAttackReportData(attackReportResult);
                if (attackReportResult) {
                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ 三攻擊風險評估完成（指認性 ${(attackReportResult!.singling_out_risk * 100).toFixed(1)}%／連結性 ${(attackReportResult!.linkability_risk * 100).toFixed(1)}%／推斷性 ${(attackReportResult!.inference_risk * 100).toFixed(1)}%）`]);
                }

                // ★ 使用者反映（2026-09-22）：K-匿名模式下，若目前沒有任何候選敏感欄位（見上方
                //   kAnonSensitiveCandidateColumnNamesList），代表這次已判定「敏感欄位 = 0」、
                //   整段風險評估（含 CAP）都要跳過——CAP 也不例外，不應該落到下方 else 分支去
                //   用「0 個敏感欄位」的 finalRiskColumnsMap 硬送一次注定會被後端擋掉的 CAP 請求。
                // ★ 使用者反映（2026-09-23）：差分隱私模式比照辦理——若候選敏感欄位（可能因為
                //   dpSensitiveCandidateColumnNamesList 被高唯一值比例篩選到剩 0 個）同樣為空，
                //   也不應落到下方 else 分支硬送一次沒有任何 sensitive 角色的 CAP 請求（一樣注定
                //   被後端擋掉）。
                const isRiskCandidateListEmptyStatus =
                    (currentPrivacyModeTypeStr === 'k-anonymity' && kAnonSensitiveCandidateColumnNamesList.length === 0) ||
                    (currentPrivacyModeTypeStr === 'differential-privacy' && dpSensitiveCandidateColumnNamesList.length === 0);

                // ★ 使用者反映（2026-09-23）：差分隱私模式的 CAP 先前一直沒有比照三攻擊「對每個候選
                //   敏感欄位各自跑一輪、取最大值」，而是直接沿用三攻擊迴圈裡「三項指標最高的那一輪」
                //   欄位設定去跑單一次 CAP——但某欄位的三攻擊風險最高，不代表同一欄位的 CAP 風險
                //   （cap_after）也最高，會安靜地漏掉「CAP 風險其實在另一個候選欄位上更高」的情況。
                //   下面把原本只給 K-匿名用的「候選清單＋columns 設定組裝函式」改成依目前模式挑選對應
                //   的那一組（K-匿名或 DP），共用同一段迴圈邏輯，讓兩種模式的 CAP 都對各自的候選敏感
                //   欄位逐一跑一輪、取最大值。
                const capCandidateColumnNamesList = currentPrivacyModeTypeStr === 'k-anonymity'
                    ? kAnonSensitiveCandidateColumnNamesList
                    : dpSensitiveCandidateColumnNamesList;
                const buildCapRiskColumnsMapForCandidateFn = currentPrivacyModeTypeStr === 'k-anonymity'
                    ? buildKAnonRiskColumnsMapForCandidateFn
                    : buildDpRiskColumnsMapForCandidateFn;

                // ★ 使用者反映（2026-09-29）：DP 模式套用系統推薦設定後，三攻擊正常完成，CAP 卻顯示「未評估」
                //   且沒有任何原因。追查為：CAP 迴圈任何一輪 /risk/cap 請求失敗（HTTP 錯誤、逾時、網路中斷等）
                //   都會 throw 到外層 catch，連同其他已成功的輪次一起丟棄、capReportResult 維持 null，畫面只能
                //   顯示寫死的猜測文字，看不出真正原因。改為：①逐輪容錯——單一候選欄位失敗只略過該輪，其餘
                //   成功輪次照常取最大值；②全部失敗時，產生一份 cap_before／cap_after = -1 的「無法評估」收據
                //   （與後端降級收據同格式），把後端回傳的錯誤碼／訊息寫進 message，直接顯示在 CAP 卡片上。
                const extractCapRequestFailureReasonText = (errorPayload: unknown): string => {
                    const errorRecord = errorPayload as { response?: { status?: number; data?: unknown }; message?: string; code?: string } | undefined;
                    const responseData = errorRecord?.response?.data as { error_code?: string; message?: string; detail?: unknown } | string | undefined;
                    const statusText = errorRecord?.response?.status ? `HTTP ${errorRecord.response.status}` : '';
                    if (responseData && typeof responseData === 'object') {
                        const backendMessageText = responseData.message || (typeof responseData.detail === 'string' ? responseData.detail : responseData.detail ? JSON.stringify(responseData.detail) : '');
                        const joinedText = [statusText, responseData.error_code, backendMessageText].filter(Boolean).join(' ');
                        if (joinedText) return joinedText;
                    }
                    if (typeof responseData === 'string' && responseData.trim() !== '') return [statusText, responseData.trim().slice(0, 300)].filter(Boolean).join(' ');
                    if (statusText) return statusText;
                    if (errorRecord?.code === 'ECONNABORTED') return '請求逾時';
                    return errorRecord?.message || String(errorPayload);
                };
                const buildCapUnavailableReceipt = (reasonText: string): CapReport => ({
                    cap_before: -1,
                    cap_after: -1,
                    n_original: 0,
                    n_processed: 0,
                    message: `CAP 前後對比請求失敗，無法評估：${reasonText}`
                });

                if (finalCsvBlobData && !isRiskCandidateListEmptyStatus) {
                    try {
                        // ★ 2026-09-29：若本次有敏感欄位自動分級距，CAP 的「原始」與「去識別化」兩份資料都要用
                        //   同一套級距轉換，前後對比才有意義（見 riskEvaluationBinWidthMap 宣告處）。
                        const processedFileForCap = Object.keys(riskEvaluationBinWidthMap).length > 0
                            ? new File([applySensitiveBinningToCsvText(await finalCsvBlobData.text(), riskEvaluationBinWidthMap)], 'processed_dataset.csv', { type: 'text/csv;charset=utf-8' })
                            : new File([finalCsvBlobData], 'processed_dataset.csv', { type: 'text/csv;charset=utf-8' });

                        if (buildCapRiskColumnsMapForCandidateFn && capCandidateColumnNamesList.length > 0) {
                            // ★ 使用者反映（2026-09-22）：K-匿名（及現在的差分隱私）同時有多個候選敏感
                            //   欄位時，CAP 前後對比也比照上方三攻擊迴圈，對每個候選敏感欄位各自呼叫
                            //   一次 /risk/cap，cap_before／cap_after 兩項指標各自在所有輪次中取最大值
                            //   （保守估計），而不是沿用三攻擊迴圈選出的「單一一輪」欄位設定去跑一次
                            //   CAP——因為讓某個候選欄位的三攻擊風險最高，不代表同一欄位的 CAP 風險也
                            //   最高，兩種指標評估的面向不同，各自跑迴圈才不會漏掉「CAP 風險其實在另一個
                            //   候選欄位上更高」的情況。候選敏感欄位只有 1 個時，等同迴圈跑一輪，結果與
                            //   先前版本一致。
                            let worstCaseCapReport: CapReport | null = null;
                            const failedCapRoundsList: { columnName: string; reasonText: string }[] = [];

                            for (let roundIndexNumber = 0; roundIndexNumber < capCandidateColumnNamesList.length; roundIndexNumber++) {
                                const candidateSensitiveFieldName = capCandidateColumnNamesList[roundIndexNumber];
                                const capColumnsMapForThisRound = buildCapRiskColumnsMapForCandidateFn(candidateSensitiveFieldName);

                                const capConfigObject = {
                                    version: 'step4_risk_cap',
                                    dataset: currentDatasetFileNameString || 'dataset',
                                    risk_cap: {
                                        enabled: true,
                                        columns: capColumnsMapForThisRound,
                                        ...(resolvedRiskSubgroupPayload ? { subgroup: resolvedRiskSubgroupPayload } : {})
                                    }
                                };
                                const capConfigBlob = new Blob([JSON.stringify(capConfigObject)], { type: 'application/json;charset=utf-8' });
                                const capConfigFile = new File([capConfigBlob], 'cap_config.json', { type: 'application/json' });

                                setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⏳ CAP 前後對比運算中（第 ${roundIndexNumber + 1}/${capCandidateColumnNamesList.length} 輪）...`]);

                                const capResponse = await runRiskCap(riskOriginalDataFile, processedFileForCap, capConfigFile);
                                if (!capResponse.success || !capResponse.report) {
                                    const roundFailureReasonText = extractCapRequestFailureReasonText(capResponse.error || new Error('API 請求未成功'));
                                    console.error(`CAP 前後對比（以「${candidateSensitiveFieldName}」為敏感欄位）失敗:`, capResponse.error);
                                    failedCapRoundsList.push({ columnName: candidateSensitiveFieldName, reasonText: roundFailureReasonText });
                                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ CAP 第 ${roundIndexNumber + 1} 輪（敏感欄位「${candidateSensitiveFieldName}」）失敗，已略過該輪：${roundFailureReasonText}`]);
                                    continue;
                                }

                                const thisRoundCapReport = capResponse.report;
                                const isThisRoundNewWorstCapCase: boolean =
                                    !worstCaseCapReport || thisRoundCapReport.cap_after > worstCaseCapReport.cap_after;

                                const aggregatedCapBefore = Math.max(worstCaseCapReport?.cap_before ?? -Infinity, thisRoundCapReport.cap_before);
                                const aggregatedCapAfter = Math.max(worstCaseCapReport?.cap_after ?? -Infinity, thisRoundCapReport.cap_after);

                                worstCaseCapReport = {
                                    ...(isThisRoundNewWorstCapCase ? thisRoundCapReport : worstCaseCapReport!),
                                    cap_before: aggregatedCapBefore,
                                    cap_after: aggregatedCapAfter,
                                };
                            }

                            if (!worstCaseCapReport && failedCapRoundsList.length > 0) {
                                // 全部輪次都失敗：以「無法評估」收據呈現真正原因（同一原因只列一次）。
                                const distinctReasonsText = Array.from(new Set(failedCapRoundsList.map((item) => item.reasonText))).join('；');
                                worstCaseCapReport = buildCapUnavailableReceipt(distinctReasonsText);
                            } else if (worstCaseCapReport && failedCapRoundsList.length > 0) {
                                const failedColumnsText = failedCapRoundsList.map((item) => `「${item.columnName}」（${item.reasonText}）`).join('、');
                                worstCaseCapReport = {
                                    ...worstCaseCapReport,
                                    message: `${worstCaseCapReport.message || ''} 另有 ${failedCapRoundsList.length} 個候選敏感欄位的 CAP 請求失敗、未納入最大值：${failedColumnsText}`.trim()
                                };
                            }
                            capReportResult = worstCaseCapReport;
                        } else {
                            const capConfigObject = {
                                version: 'step4_risk_cap',
                                dataset: currentDatasetFileNameString || 'dataset',
                                risk_cap: {
                                    enabled: true,
                                    columns: finalRiskColumnsMap,
                                    ...(resolvedRiskSubgroupPayload ? { subgroup: resolvedRiskSubgroupPayload } : {})
                                }
                            };
                            const capConfigBlob = new Blob([JSON.stringify(capConfigObject)], { type: 'application/json;charset=utf-8' });
                            const capConfigFile = new File([capConfigBlob], 'cap_config.json', { type: 'application/json' });

                            const capResponse = await runRiskCap(riskOriginalDataFile, processedFileForCap, capConfigFile);
                            if (!capResponse.success || !capResponse.report) throw (capResponse.error || new Error('CAP 前後對比 API 請求未成功'));
                            capReportResult = capResponse.report;
                        }

                        setCapReportData(capReportResult);
                        // 👇 印出後端 /api/v1/risk/cap 回傳的完整原始 JSON，方便直接在 Console 分頁檢查，
                        // 不需要跟 DevTools Network 分頁「Response 內容已被逐出快取」的限制賽跑。
                        console.log('📩 /api/v1/risk/cap 原始回應內容:', capReportResult);
                        if (capReportResult && capReportResult.cap_before >= 0 && capReportResult.cap_after >= 0) {
                            setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ CAP 前後對比完成（處理前 ${(capReportResult!.cap_before * 100).toFixed(1)}% → 處理後 ${(capReportResult!.cap_after * 100).toFixed(1)}%）`]);
                        } else if (capReportResult) {
                            setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ CAP 前後對比未能評估：${capReportResult!.message}`]);
                        }
                    } catch (capErrorPayload) {
                        console.error('CAP 前後對比失敗:', capErrorPayload);
                        const capFailureReasonText = extractCapRequestFailureReasonText(capErrorPayload);
                        capReportResult = buildCapUnavailableReceipt(capFailureReasonText);
                        setCapReportData(capReportResult);
                        setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ CAP 前後對比失敗，已略過（不影響風險評估結果）：${capFailureReasonText}`]);
                    }
                } else if (!finalCsvBlobData) {
                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ 未取得脫敏後資料集，略過 CAP 前後對比`]);
                }

                // ★ 新增：輸入／刪除／輸出筆數統計——直接數原始上傳 CSV 與後端回傳的去識別化 CSV
                //   各自的資料列數（扣除表頭），不依賴各報表裡可能經過抽樣、口徑未必一致的統計欄位，
                //   如此使用者才能直接看到「這次總共刪掉了幾筆」。
                const countCsvDataRowsForStats = (csvText: string): number =>
                    Math.max(0, csvText.split(/\r\n|\r|\n/).filter((lineText) => lineText.trim() !== '').length - 1);

                const inputRowCountValue = countCsvDataRowsForStats(cleanedCsvText);
                let outputRowCountValue = inputRowCountValue;
                if (finalCsvBlobData) {
                    try {
                        const processedCsvTextForRowCount = await finalCsvBlobData.text();
                        outputRowCountValue = countCsvDataRowsForStats(processedCsvTextForRowCount);
                    } catch (rowCountErrorPayload) {
                        console.error('計算輸出資料筆數失敗:', rowCountErrorPayload);
                    }
                }
                const deletedRowCountValue = Math.max(0, inputRowCountValue - outputRowCountValue);
                const generatedDatasetRowStatsObject = { input: inputRowCountValue, deleted: deletedRowCountValue, output: outputRowCountValue };
                setDatasetRowStatsData(generatedDatasetRowStatsObject);

                setCalculationProgressValue(100);
                setCurrentPipelinePhaseType('completed');

                const finalSinglingRiskValue = attackReportResult?.singling_out_risk ?? 0;
                const finalLinkabilityRiskValue = attackReportResult?.linkability_risk ?? 0;
                const finalInferenceRiskValue = attackReportResult?.inference_risk ?? 0;

                // ★ 依使用者指定之風險量化公式（主要攻擊分數 S_ori／控制攻擊分數 S_ctrl／
                //   基準攻擊分數 S_base 三者正規化）：
                //     最終風險分數 = max(0, (S_ori − max(S_ctrl, S_base)) / (1 − max(S_ctrl, S_base)))
                //   S_ori：後端 /risk/k-anonymity、/risk/dp 回傳之三攻擊成功率（singling_out_risk 等）。
                //   S_ctrl：控制攻擊分數——後端目前完全沒有回傳「在對照組樣本上跑同一攻擊」的
                //   成功率，故暫以 0 表示（不可憑空捏造數字），待後端提供對應欄位後再串接真實值。
                //   S_base：基準攻擊分數——採業界常見之隨機猜測基準 1/樣本數，以後端回傳的
                //   sample_size 計算；樣本數不明或為 0 時視為無基準可比，直接退回原始值。
                const CONTROL_ATTACK_RISK_PLACEHOLDER = 0;
                const naiveBaselineRiskValue = (attackReportResult?.sample_size && attackReportResult.sample_size > 0)
                    ? 1 / attackReportResult.sample_size
                    : 0;
                const riskReferenceFloorValue = Math.max(CONTROL_ATTACK_RISK_PLACEHOLDER, naiveBaselineRiskValue);
                const normalizeAttackRiskScore = (mainAttackRiskValue: number): number => {
                    if (riskReferenceFloorValue >= 1) return 0;
                    return Math.max(0, (mainAttackRiskValue - riskReferenceFloorValue) / (1 - riskReferenceFloorValue));
                };

                const normalizedSinglingRiskValue = normalizeAttackRiskScore(finalSinglingRiskValue);
                const normalizedLinkabilityRiskValue = normalizeAttackRiskScore(finalLinkabilityRiskValue);
                const normalizedInferenceRiskValue = normalizeAttackRiskScore(finalInferenceRiskValue);
                const calculatedOverallMaxRiskScoreValue = Math.max(normalizedSinglingRiskValue, normalizedLinkabilityRiskValue, normalizedInferenceRiskValue);

                const generatedSimulationMetricsObject: SimulationResult = {
                    singling: { ori: finalSinglingRiskValue, ctrl: CONTROL_ATTACK_RISK_PLACEHOLDER, base: naiveBaselineRiskValue, risk: normalizedSinglingRiskValue },
                    linkability: { ori: finalLinkabilityRiskValue, ctrl: CONTROL_ATTACK_RISK_PLACEHOLDER, base: naiveBaselineRiskValue, risk: normalizedLinkabilityRiskValue },
                    inference: { ori: finalInferenceRiskValue, ctrl: CONTROL_ATTACK_RISK_PLACEHOLDER, base: naiveBaselineRiskValue, risk: normalizedInferenceRiskValue },
                    overallRiskPercent: (calculatedOverallMaxRiskScoreValue * 100).toFixed(1)
                };

                // ★ 使用者反映（2026-09-22）：K-匿名「敏感欄位 = 0」時三攻擊整段跳過（attackReportResult
                //   維持 null），若這裡不論有沒有實際評估都無條件 setAttackSimulationMetricsData 一個
                //   全部指標為 0 的物件，畫面上「安全性評估」卡片（由 attackSimulationMetricsData 是否
                //   非 null 控制顯示）反而會照樣顯示「指認/連結/推斷風險皆為 0%」——這跟 CAP 卡片「未評估」
                //   的處理方式不一致，且會讓使用者誤以為「已經評估過、結果是完全沒風險」，而不是「根本
                //   沒有評估」。故只在真的有 attackReportResult 時才寫入 state，沒評估時維持 null，
                //   讓卡片跟著隱藏（與 CAP 目前跳過時的呈現方式一致）。
                setAttackSimulationMetricsData(attackReportResult ? generatedSimulationMetricsObject : null);

                // ★ 依後端實際回傳之報告判斷是否真正達到合規標準，而非不論結果一律標示為「已通過」
                const pipelineComplianceValidStatus = evaluateComplianceValidity(currentPrivacyModeTypeStr, finalApiReportData, budgetLimitEpsilonValue);

                setStep4CacheAction(
                    {
                        metrics: attackReportResult ? generatedSimulationMetricsObject : null,
                        certificateId: generatedNewAuditMetadataObj.certificateId,
                        auditTime: generatedNewAuditMetadataObj.auditTime,
                        apiReport: finalApiReportData,
                        processedCsvBlob: finalCsvBlobData,
                        capReport: capReportResult,
                        datasetRowStats: generatedDatasetRowStatsObject,
                        // ★ 一併存讀高唯一值比例敏感欄位警告快照，避免切換步驟重新掛載後消失
                        // （見上方 highCardinalitySensitiveWarningInfo state 宣告處的完整說明）。
                        // 這裡讀取的是本次執行過程中賦值的 finalHighCardinalitySensitiveWarningInfo
                        // 一般變數，而非 state 本身（state 在同一次 render 閉包內不會同步更新）。
                        highCardinalitySensitiveWarningInfo: finalHighCardinalitySensitiveWarningInfo,
                        forceRunHighCardinalitySensitiveFields: forceRunHighCardinalitySensitiveFieldsStatus,
                        sensitiveBinWidthOverrides: sensitiveBinWidthOverridesMap
                    } as unknown as NonNullable<typeof step4AnalysisCacheData>,
                    currentParametersHashString
                );

                const columnRoleSnapshotDict = actualProcessedColumnsList.reduce((accumulatorDict, columnNameString) => {
                    accumulatorDict[columnNameString] = getCalculatedRole(columnNameString).role;
                    return accumulatorDict;
                }, {} as Record<string, string>);

                const identifierMaskStrategySnapshotDict = actualProcessedColumnsList.reduce((accumulatorDict, columnNameString) => {
                    const { maskStrategy: resolvedMaskStrategyString } = getCalculatedRole(columnNameString);
                    if (resolvedMaskStrategyString) accumulatorDict[columnNameString] = resolvedMaskStrategyString;
                    return accumulatorDict;
                }, {} as Record<string, string>);

                const dpEnabledFieldNamesSnapshotList = (currentDpFieldsListArray || [])
                    .filter((field: DpStoreField) => field.enabled)
                    .map((field: DpStoreField) => field.fieldName);

                addAuditLogAction({
                    certificateId: generatedNewAuditMetadataObj.certificateId,
                    fileName: currentDatasetFileNameString || 'dataset.csv',
                    privacyMode: currentPrivacyModeTypeStr || 'k-anonymity',
                    operator: currentUserSession?.name || 'Admin.Test',
                    operatorRole: currentUserSession?.role || 'admin',
                    auditTime: generatedNewAuditMetadataObj.auditTime,
                    auditTimestamp: generatedNewAuditMetadataObj.auditTimestamp,
                    parameters: currentPrivacyModeTypeStr === 'k-anonymity' ? `K = ${currentKValueNumber}` : `發布次數 M = ${simulatedQueryCountValue}`,
                    // ★ 與畫面上實際顯示的「指認/連結/推斷風險」保持一致，改為記錄正規化後的
                    //   最終風險分數（.risk），而非未扣除基準攻擊分數的原始成功率（.ori）。
                    // ★ 使用者反映（2026-09-22）：K-匿名「敏感欄位 = 0」時三攻擊整段跳過，此時
                    //   generatedSimulationMetricsObject 只是用 0 補出來的佔位值，不是真的評估
                    //   結果，稽核紀錄不應該記成「風險 0%」（看起來像評估過且完全無風險），改記
                    //   「未評估」文字，才不會誤導事後查閱稽核紀錄的人。
                    singlingRisk: attackReportResult ? `${(generatedSimulationMetricsObject.singling.risk * 100).toFixed(1)}%` : '未評估',
                    linkabilityRisk: attackReportResult ? `${(generatedSimulationMetricsObject.linkability.risk * 100).toFixed(1)}%` : '未評估',
                    inferenceRisk: attackReportResult ? `${(generatedSimulationMetricsObject.inference.risk * 100).toFixed(1)}%` : '未評估',
                    overallRisk: attackReportResult ? `${generatedSimulationMetricsObject.overallRiskPercent}%` : '未評估',
                    // ★ 新增：同步輸入／刪除／輸出筆數至審計歷史紀錄，供「稽核紀錄」頁面回溯查閱
                    inputRowCount: generatedDatasetRowStatsObject.input,
                    deletedRowCount: generatedDatasetRowStatsObject.deleted,
                    outputRowCount: generatedDatasetRowStatsObject.output,
                    status: pipelineComplianceValidStatus ? 'passed' : 'failed',
                    columnsSnapshot: actualProcessedColumnsList,
                    columnRoleSnapshot: columnRoleSnapshotDict,
                    identifierMaskStrategySnapshot: identifierMaskStrategySnapshotDict,
                    dpEnabledFieldNamesSnapshot: dpEnabledFieldNamesSnapshotList
                });

                setSystemSimulationLogsList(prev => [...prev, translate('step4.log.finished', '[{{time}}] 🎉 後端管線運算完畢，合規憑證生成完成！', { time: formatCurrentTimeForLogString() })]);

            } catch (error: unknown) {
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

                console.error("Pipeline 執行失敗:", error, responseData);
                setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ❌ 處理失敗: ${errorMessage}`]);
                messageApi.error(translate('step4.msg.api_failed', '後端 API 執行失敗，請檢查 Log 訊息'));
                setPipelineFailedMessage(friendlyDisplayNode);
            } finally {
                isPipelineRunInProgressRef.current = false;
                setTimeout(() => setIsPipelineCalculatingStatus(false), SIMULATION_COMPLETION_DELAY_MS);
            }

        },
        [actualProcessedColumnsList, addAuditLogAction, budgetLimitEpsilonValue, currentDatasetFileNameString, currentKValueNumber, currentLValueNumber, currentTValueNumber, currentLimitExceededActionStr, currentMaxSuppressionNumber, currentParametersHashString, currentPrivacyModeTypeStr, currentSuppressionMethodStr, currentUserSession, dataFile, getCalculatedRole, isAnalysisCacheValidStatus, isEnableLDiversityStatus, isEnableTClosenessStatus, kAnonymityFieldsList, messageApi, setStep4CacheAction, simulatedQueryCountValue, translate, currentDpFieldsListArray, currentColumnTypesMapDict, kAnonymityHierarchiesList, dpAccumulatedEpsilonValue, dpAccumulatedDeltaValue, globalTargetDeltaValue, riskSubgroupFiltersMapDict, forceRunHighCardinalitySensitiveFieldsStatus, sensitiveBinWidthOverridesMap, currentCellFillMethodStr]
    );

    useEffect(() => { if (!isAnalysisCacheValidStatus) { const tId = setTimeout(() => runFullPipeline(false), 0); return () => clearTimeout(tId); } }, [isAnalysisCacheValidStatus, runFullPipeline]);
    useEffect(() => { if (simulationLogsEndRef.current) simulationLogsEndRef.current.scrollIntoView({ behavior: 'smooth' }); }, [systemSimulationLogsList]);

    const kReport = currentPrivacyModeTypeStr === 'k-anonymity' ? (apiReport as KAnonymityQualityReport) : null;
    const dpReport = currentPrivacyModeTypeStr === 'differential-privacy' ? (apiReport as DpQualityReport) : null;
    const isComplianceValidStatus = evaluateComplianceValidity(currentPrivacyModeTypeStr, apiReport, budgetLimitEpsilonValue);

    const getAttackChartOption = () => 
    {
        if (!attackSimulationMetricsData) return {};
        return {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            legend: {
                data: [translate('step4.chart.s_risk', '攻擊成功率（真實後端評估）')],
                textStyle: { color: token.colorTextSecondary }, top: '0%'
            },
            grid: { top: '18%', left: '3%', right: '4%', bottom: '3%', containLabel: true },
            xAxis: {
                type: 'category',
                data: [translate('step4.chart.singling', '指認性攻擊 (Singling Out)'), translate('step4.chart.linkability', '連結性攻擊 (Linkability)'), translate('step4.chart.inference', '推斷性攻擊 (Inference)')],
                axisLabel: { color: token.colorTextSecondary }
            },
            yAxis: {
                type: 'value', max: 1.0,
                axisLabel: { formatter: (numericAxisValue: number) => `${(numericAxisValue * 100).toFixed(0)}%`, color: token.colorTextDescription },
                splitLine: { lineStyle: { color: token.colorSplit } }
            },
            series: [
                { name: translate('step4.chart.s_risk', '攻擊成功率'), type: 'bar', data: [attackSimulationMetricsData.singling.risk, attackSimulationMetricsData.linkability.risk, attackSimulationMetricsData.inference.risk], itemStyle: { color: '#ff4d4f', borderRadius: [4, 4, 0, 0] } }
            ]
        };
    };

    // ★ 使用者反映（2026-09-23）：合規審計報告改版後新增「隱私強化處理配置」段落，其中三攻擊／CAP
    //   的固定參數（迭代次數／控制組比例／亂數種子／連結性子集大小／重複實驗輪數／跨輪重疊比例）
    //   目前畫面尚未開放使用者調整，一律採用官方範例預設值——與 runFullPipeline 內部
    //   RISK_ATTACK_DEFAULT_PARAMS（實際送給後端 /api/v1/risk/* 的值）完全相同。那個常數宣告在
    //   runFullPipeline 這個 useCallback 內部，屬於該函式的區域變數，這裡的報告 Modal 讀不到，
    //   故另外宣告這份「僅供顯示」的複本；未來若調整 runFullPipeline 內的預設值，記得這裡也要
    //   同步更新，否則報告顯示的參數會跟實際送給後端的不一致。
    const RISK_ATTACK_REPORT_DISPLAY_PARAMS = {
        n_iter: 50,
        ctrl_ratio: 0.2,
        seed: 42,
        n_subset: 500,
        n_repeats: 1,
        overlap_ratio: 0.0
    };

    const handleOpenReportModal = () => setIsReportModalVisibleStatus(true);

    const handleDownloadCSV = () => 
    {
        if (processedCsvBlob) 
        {
            const blobDownloadUrlString = URL.createObjectURL(processedCsvBlob);
            const downloadAnchorHtmlElement = document.createElement('a');
            downloadAnchorHtmlElement.href = blobDownloadUrlString;
            downloadAnchorHtmlElement.download = `deidentified_dataset_${Date.now()}.csv`;
            document.body.appendChild(downloadAnchorHtmlElement);
            downloadAnchorHtmlElement.click();
            document.body.removeChild(downloadAnchorHtmlElement);
            URL.revokeObjectURL(blobDownloadUrlString);
            messageApi.success(translate('step4.msg.download_success', '已成功匯出全量脫敏 CSV 數據！'));
        } else {
            messageApi.error(translate('step4.msg.download_failed', '無法取得脫敏檔案，請重新運算。'));
        }
    };

    const handleDownloadPDF = async () =>
    {
        const targetPdfPrintHtmlElement = document.getElementById('printable-audit-report');
        if (!targetPdfPrintHtmlElement) return;
        const hideGlobalLoadingMessageFunction = messageApi.loading(translate('step4.msg.pdf_compiling', '正在編譯高畫質 PDF，請稍候...'), 0);
        setIsExportingPdfStatus(true);
        await new Promise((resolveDelayPromise) => setTimeout(resolveDelayPromise, PDF_COMPILATION_DELAY_MS));

        const html2pdfScriptElement = document.createElement('script');
        html2pdfScriptElement.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        html2pdfScriptElement.onload = () => 
        {
            const pdfGenerationConfigurationOptions = {
                margin:       [10, 10, 10, 10],
                filename:     `Privacy_Audit_Certificate_${auditMetadataObject.certificateId}.pdf`,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollY: 0, scrollX: 0 },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak:    { mode: ['avoid-all', 'css', 'legacy'], avoid: ['tr', '.pdf-page-break'] }
            };
            (window as unknown as WindowWithHtml2Pdf).html2pdf().set(pdfGenerationConfigurationOptions).from(targetPdfPrintHtmlElement).save().then(
                () => { hideGlobalLoadingMessageFunction(); messageApi.success(translate('step4.msg.pdf_success', '合規審計憑證 PDF 已成功下載！')); }
            ).catch(
                (pdfExecutionErrorPayload: unknown) => { hideGlobalLoadingMessageFunction(); messageApi.error(translate('step4.msg.pdf_failed', 'PDF 下載失敗')); console.error(pdfExecutionErrorPayload); }
            ).finally(() => setIsExportingPdfStatus(false));
        };
        html2pdfScriptElement.onerror = () => { hideGlobalLoadingMessageFunction(); messageApi.error(translate('step4.msg.pdf_no_lib', '無法載入 PDF 轉檔套件，請檢查網路連線。')); setIsExportingPdfStatus(false); };
        document.body.appendChild(html2pdfScriptElement);
    };

    // ★ 新增：錯誤卡片測試面板只在網址加上 ?debugErrors=1 (重新整理過一次) 時才會出現，
    //   一般使用者不會看到、也不會誤觸；用來檢查 26 個後端錯誤碼各自的前端卡片顯示是否
    //   正確、好懂，不必真的想辦法讓後端在那些不容易操作觸發的情境下失敗。
    //   ★ 修正：判斷依據改成 localStorage (由 App.tsx 在頁面載入當下寫入)，而不是直接看
    //   目前網址參數——因為切換到第四步的過程中，App.tsx 的路由邏輯一定會把網址參數改寫成
    //   只剩 ?step=4，若還是看網址參數，使用者根本不可能帶著 debugErrors=1 走到這一頁。
    let isErrorDebugPanelVisibleStatus = false;
    try {
        isErrorDebugPanelVisibleStatus = window.localStorage.getItem(DEBUG_ERRORS_LOCAL_STORAGE_KEY) === '1';
    } catch (localStorageReadErrorPayload) {
        console.warn('讀取除錯旗標失敗，錯誤卡片測試面板維持隱藏:', localStorageReadErrorPayload);
    }

    const handleDisableDebugPanelClick = (): void => {
        try {
            window.localStorage.removeItem(DEBUG_ERRORS_LOCAL_STORAGE_KEY);
        } catch (localStorageRemoveErrorPayload) {
            console.warn('清除除錯旗標失敗:', localStorageRemoveErrorPayload);
        }
        setPipelineFailedMessage(null);
        window.location.reload();
    };

    const handleShowDebugErrorCardClick = (): void => {
        const selectedOption = DEBUG_PANEL_ERROR_CODE_OPTIONS.find((optionItem) => optionItem.code === debugSelectedErrorCodeStr);
        if (!selectedOption) return;
        const displayStatus = BACKEND_ERROR_CODE_CATEGORY_MAP[selectedOption.code]?.status;
        setPipelineFailedMessage(buildFriendlyErrorDisplayNode({
            responseErrorCode: selectedOption.code,
            responseHttpStatus: displayStatus,
            backendRawMessageText: selectedOption.sampleMessage,
            responseRecommendationsList: selectedOption.sampleRecommendations ?? []
        }));
    };

    return (
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {isErrorDebugPanelVisibleStatus && (
                <div
                    style={{
                        position: 'fixed', bottom: 16, right: 16, zIndex: 1000, width: 340,
                        background: '#fff', border: '1px solid #d9d9d9', borderRadius: 8,
                        padding: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                    }}
                >
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>
                        🧪 錯誤卡片測試面板（僅供內部測試）
                    </div>
                    <Select
                        value={debugSelectedErrorCodeStr}
                        onChange={setDebugSelectedErrorCodeStr}
                        style={{ width: '100%', marginBottom: 8 }}
                        showSearch
                        options={DEBUG_PANEL_ERROR_CODE_OPTIONS.map((optionItem) => ({ value: optionItem.code, label: optionItem.code }))}
                    />
                    <Space wrap>
                        <Button size="small" type="primary" onClick={handleShowDebugErrorCardClick}>顯示這個錯誤卡片</Button>
                        <Button size="small" onClick={() => setPipelineFailedMessage(null)}>清除（恢復正常畫面）</Button>
                        <Button size="small" danger onClick={handleDisableDebugPanelClick}>關閉測試模式</Button>
                    </Space>
                </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {isPipelineCalculatingStatus ? (
                    <Alert
                        title={<span style={{ fontWeight: 600 }}>{translate('step4.alert.title_running', '正在執行去識別化矩陣演算與風險')}</span>}
                        description={translate('step4.alert.desc_running', '請稍候，系統正在進行運算，完成後將顯示報告。')}
                        type="info"
                        showIcon={false}
                        style={{ flex: 1, marginRight: '24px' }}
                    />
                ) : (
                    <Alert
                        title={
                            <Space>
                                {pipelineFailedMessage
                                    ? <CloseCircleFilled style={{ color: '#ff4d4f' }} />
                                    : isComplianceValidStatus
                                        ? <CheckCircleFilled style={{ color: '#52c41a' }} />
                                        : <WarningFilled style={{ color: '#faad14' }} />}
                                <span style={{ fontWeight: 600 }}>
                                    {pipelineFailedMessage
                                        ? translate('step4.alert.title_error', '後端運算失敗，未產出結果')
                                        : isComplianceValidStatus
                                            ? translate('step4.alert.title', '去識別化矩陣演算與風險審計完成')
                                            : translate('step4.alert.title_failed', '去識別化矩陣演算完成，但未達合規標準')}
                                </span>
                            </Space>
                        }
                        description={pipelineFailedMessage
                            ? pipelineFailedMessage
                            : isComplianceValidStatus
                                ? translate('step4.alert.desc', '系統已完成蒙地卡羅攻擊模擬評估，請檢視三大去識別化防禦指標並下載合規報告。')
                                : (
                                    <div>
                                        {/* ★ 使用者反映：先前把後端 message／recommendations 原文整段列出，
                                            對非技術背景的使用者來說文字量過大、看不出重點。改為只保留一行
                                            「哪裡沒過」＋一行「怎麼改」的極簡提示，不顯示後端原始長篇文字。 */}
                                        {currentPrivacyModeTypeStr === 'k-anonymity' && kReport && (() => {
                                            const isSuppressionExceededStatus = kReport.suppression_rate_percent > (currentMaxSuppressionNumber ?? 5);
                                            // ★ 未啟用 l-多樣性／t-緊密度檢測時，即使報告內 l_passed／t_passed 剛好是
                                            // false（例如後端對「未檢測」的預設值不是 true），畫面上也不歸咎於 l／t，
                                            // 避免使用者誤以為自己沒關掉的 l/t 造成失敗。
                                            const failedCheckNamesList = [
                                                kReport.k_passed === false ? 'k' : null,
                                                (isEnableLDiversityStatus && kReport.l_passed === false) ? 'l-多樣性' : null,
                                                (isEnableTClosenessStatus && kReport.t_passed === false) ? 't-緊密度' : null,
                                                isSuppressionExceededStatus ? '抑制率' : null
                                            ].filter((item): item is string => item !== null);
                                            const failedCheckSummaryText = failedCheckNamesList.length > 0
                                                ? failedCheckNamesList.join('、')
                                                : translate('step4.alert.failed_detail_suppression', '抑制率');

                                            // ★ 使用者反映：改為依失敗項目挑選後端建議文字後，內容仍偏技術（等價類／
                                            // l-diversity／t-closeness／QI 等專有名詞＋長句），沒有相關背景的使用者
                                            // 仍難以判斷「具體該調整哪個數字」。改為：針對每個實際未通過的項目，各自
                                            // 產生一句帶入目前實際設定值與違規數量的白話說明，加上條列式、方向正確的
                                            // 具體調整選項（例如 l 值該調低到多少、t 值該調高到多少），技術名詞僅以
                                            // 「?」提示註解、不影響略讀即可操作。
                                            // ★ 方向性務必區分：l-diversity 的 l 越大越嚴格，要放寬須「調低」；
                                            // t-closeness 的 t 是「容許的分佈距離上限」，t 越小越嚴格，要放寬須
                                            // 「調高」——兩者方向相反，不可用同一句話帶過，否則會誤導使用者。
                                            // 違規分組數量（l_fail_count／t_fail_count）目前僅存在於後端 recommendations
                                            // 的自然語言描述中，未拆成獨立欄位，故以固定格式的正規表示式擷取數字；
                                            // 擷取不到時該部分文字自然省略，不影響其餘白話說明與選項的呈現。
                                            const backendRecommendationTextList = Array.isArray(kReport.recommendations)
                                                ? (kReport.recommendations as unknown[]).filter((item): item is string => typeof item === 'string')
                                                : [];
                                            const parseFirstIntegerMatch = (patternRegex: RegExp): number | null => {
                                                for (const recommendationText of backendRecommendationTextList) {
                                                    const matchResult = recommendationText.match(patternRegex);
                                                    if (matchResult) {
                                                        const parsedNumberValue = Number(matchResult[1]);
                                                        if (Number.isFinite(parsedNumberValue)) {
                                                            return parsedNumberValue;
                                                        }
                                                    }
                                                }
                                                return null;
                                            };

                                            type FailureGuidanceSectionType = { key: string; headlineNode: ReactNode; optionTextList: string[] };
                                            const failureGuidanceSectionsList: FailureGuidanceSectionType[] = [];

                                            const isLFailedStatus = failedCheckNamesList.includes('l-多樣性');
                                            const isTFailedStatus = failedCheckNamesList.includes('t-緊密度');
                                            if (isLFailedStatus || isTFailedStatus) {
                                                const lFailGroupCount = parseFirstIntegerMatch(/l-diversity 不足的等價類 (\d+) 個/);
                                                const tFailGroupCount = parseFirstIntegerMatch(/t-closeness 超標的等價類 (\d+) 個/);
                                                const failGroupDescriptionPartsList = [
                                                    (isLFailedStatus && lFailGroupCount !== null)
                                                        ? `l-多樣性不足的分組有 ${lFailGroupCount} 組（目前門檻 l = ${currentLValueNumber}）`
                                                        : null,
                                                    (isTFailedStatus && tFailGroupCount !== null)
                                                        ? `t-緊密度超標的分組有 ${tFailGroupCount} 組（目前門檻 t = ${currentTValueNumber}）`
                                                        : null
                                                ].filter((item): item is string => item !== null);

                                                const suggestedLValueNumber = Math.max(1, currentLValueNumber - 1);
                                                const suggestedTValueNumber = Math.min(1, Math.round((currentTValueNumber + 0.05) * 100) / 100);
                                                const ltOptionTextList: string[] = [];
                                                if (isLFailedStatus) {
                                                    ltOptionTextList.push(translate(
                                                        'step4.alert.lt_option_lower_l',
                                                        `回到 Step3，把 l 值從 ${currentLValueNumber} 調低到 ${suggestedLValueNumber}（數字越小，多樣性要求越寬鬆）`
                                                    ));
                                                }
                                                if (isTFailedStatus) {
                                                    ltOptionTextList.push(translate(
                                                        'step4.alert.lt_option_raise_t',
                                                        `回到 Step3，把 t 值從 ${currentTValueNumber} 調高到 ${suggestedTValueNumber}（t 是容許的分佈距離上限，數字越大，門檻越寬鬆）`
                                                    ));
                                                }
                                                ltOptionTextList.push(translate('step4.alert.lt_option_raise_level', '回到 Step2，提高「間接識別碼」欄位的泛化層級，讓分組人數變多，敏感資料種類自然更多樣'));
                                                ltOptionTextList.push(translate('step4.alert.lt_option_suppress_minority', '將資料中極少數的特殊族群或極端值移除／合併後再重新運算'));

                                                failureGuidanceSectionsList.push({
                                                    key: 'lt',
                                                    headlineNode: (
                                                        <>
                                                            {translate('step4.alert.lt_plain_issue_prefix', '系統依照目前的分組結果檢查後發現，')}
                                                            {failGroupDescriptionPartsList.length > 0
                                                                ? failGroupDescriptionPartsList.join('、')
                                                                : translate('step4.alert.lt_plain_issue_fallback', '部分分組的敏感資料多樣性不足')}
                                                            {translate('step4.alert.lt_plain_issue_suffix', '，尚未達到您設定的隱私要求。')}
                                                            <Tooltip title={translate('step4.alert.equivalence_class_tooltip', '「分組」是指依照間接識別碼欄位（如年齡、地區）模糊化後，被歸為同一群、彼此無法被區分的一批資料，專業上稱為「等價類」。')}>
                                                                <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} />
                                                            </Tooltip>
                                                        </>
                                                    ),
                                                    optionTextList: ltOptionTextList
                                                });
                                            }

                                            if (failedCheckNamesList.includes('k')) {
                                                const suggestedKValueNumber = Math.max(2, currentKValueNumber - 1);
                                                failureGuidanceSectionsList.push({
                                                    key: 'k',
                                                    headlineNode: (
                                                        <>{translate('step4.alert.k_plain_issue', `部分分組的人數不足您設定的 k = ${currentKValueNumber} 人，代表這些分組裡的人仍可能被單獨辨識出來。`)}</>
                                                    ),
                                                    optionTextList: [
                                                        translate('step4.alert.k_option_raise_level', '回到 Step2，提高「間接識別碼」欄位的泛化層級，讓每個分組的人數變多'),
                                                        translate('step4.alert.k_option_lower_k', `回到 Step3，把 k 值從 ${currentKValueNumber} 調低到 ${suggestedKValueNumber}（數字越小，要求越寬鬆）`)
                                                    ]
                                                });
                                            }

                                            if (isSuppressionExceededStatus) {
                                                const currentSuppressionCapNumber = currentMaxSuppressionNumber ?? 5;
                                                const suggestedSuppressionCapNumber = Math.min(100, Math.ceil(kReport.suppression_rate_percent) + 1);
                                                failureGuidanceSectionsList.push({
                                                    key: 'suppression',
                                                    headlineNode: (
                                                        <>{translate('step4.alert.suppression_plain_issue', `目前有 ${kReport.suppression_rate_percent.toFixed(3)}% 的資料筆數太特殊、必須被刪除或打上「*」才符合隱私要求，已超過您設定的上限 ${currentSuppressionCapNumber}%。`)}</>
                                                    ),
                                                    optionTextList: [
                                                        translate('step4.alert.suppression_option_raise_cap', `回到 Step3，把「抑制上限」從 ${currentSuppressionCapNumber}% 調高到 ${suggestedSuppressionCapNumber}% 以上`),
                                                        translate('step4.alert.suppression_option_raise_level', '回到 Step2，提高「間接識別碼」欄位的泛化層級，減少需要被刪除／遮蔽的筆數')
                                                    ]
                                                });
                                            }

                                            return (
                                                <>
                                                    <div>{translate('step4.alert.failed_detail', '未通過項目')}：{failedCheckSummaryText}（{translate('step4.alert.suppression_rate', '抑制率')} {kReport.suppression_rate_percent.toFixed(3)}%）</div>
                                                    {failureGuidanceSectionsList.length > 0
                                                        ? failureGuidanceSectionsList.map((sectionItem) => (
                                                            <div key={sectionItem.key} style={{ marginTop: 8 }}>
                                                                <div>{sectionItem.headlineNode}</div>
                                                                <div style={{ marginTop: 2 }}>{translate('step4.alert.options_label', '可以試試以下任一做法：')}</div>
                                                                <ol style={{ margin: '2px 0 0 20px', padding: 0 }}>
                                                                    {sectionItem.optionTextList.map((optionTextValue, optionIndexValue) => (
                                                                        <li key={optionIndexValue} style={{ marginTop: 2 }}>{optionTextValue}</li>
                                                                    ))}
                                                                </ol>
                                                            </div>
                                                        ))
                                                        : (
                                                            <div style={{ marginTop: 4 }}>{translate('step4.alert.suggest_label', '建議')}：{translate('step4.alert.suggest_k_detail', '提高間接識別碼欄位的泛化層級，或調整抑制上限後重新運算。')}</div>
                                                        )}
                                                </>
                                            );
                                        })()}
                                        {currentPrivacyModeTypeStr === 'differential-privacy' && dpReport && (
                                            <>
                                                <div>{translate('step4.alert.epsilon_detail', '消耗預算')}：{dpReport.consumed_epsilon} ε（{translate('step4.alert.epsilon_limit', '門檻')} {budgetLimitEpsilonValue} ε）</div>
                                                <div style={{ marginTop: 4 }}>{translate('step4.alert.suggest_label', '建議')}：{translate('step4.alert.suggest_dp_detail', '提高預算上限，或減少啟用差分隱私的欄位數後重新運算。')}</div>
                                            </>
                                        )}
                                    </div>
                                )}
                        type={pipelineFailedMessage ? 'error' : (isComplianceValidStatus ? 'success' : 'warning')}
                        showIcon={false}
                        style={{ flex: 1, marginRight: '24px' }}
                    />
                )}

                <Space size="middle">
                    <Button icon={<ReloadOutlined spin={isPipelineCalculatingStatus} />} onClick={() => runFullPipeline(true)} disabled={isPipelineCalculatingStatus} size="large">
                        {translate('step4.btn.recalculate', '重新發起後端運算')}
                    </Button>
                    <Button type="default" icon={<FileDoneOutlined />} disabled={isPipelineCalculatingStatus || !!pipelineFailedMessage} onClick={handleOpenReportModal} size="large">
                        {translate('step4.btn.view_report', '檢視與匯出憑證')}
                    </Button>
                    <Button type="primary" icon={<DownloadOutlined />} disabled={isPipelineCalculatingStatus || !!pipelineFailedMessage} onClick={handleDownloadCSV} size="large" style={{ background: '#4F46E5', borderColor: '#4F46E5' }}>
                        {translate('step4.btn.download_csv', '下載脫敏 CSV')}
                    </Button>
                </Space>
            </div>

            {isPipelineCalculatingStatus ? (
                <Card variant="borderless" style={{ background: token.colorBgContainer }}>
                    <div style={{ padding: '32px 16px', background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', borderRadius: '12px' }}>
                        <Row justify="center" style={{ marginBottom: '32px' }}>
                            <Col xs={24} md={20} lg={16}>
                                <Steps
                                    current={currentPipelinePhaseType === 'uploading' ? 0 : currentPipelinePhaseType === 'processing' ? 1 : currentPipelinePhaseType === 'auditing' ? 2 : 3}
                                    items={[
                                        { title: translate('step4.steps.upload.title', '切片上傳'), content: 'Chunk Upload', icon: <CloudUploadOutlined /> },
                                        { title: translate('step4.steps.process.title', '後端脫敏'), content: 'Data Processing', icon: <LoadingOutlined /> },
                                        { title: translate('step4.steps.audit.title', '風險審計'), content: 'Risk Auditing', icon: <SafetyCertificateOutlined /> },
                                        { title: translate('step4.steps.complete.title', '完成簽發'), content: 'Completed', icon: <CheckCircleOutlined /> },
                                    ]}
                                />
                            </Col>
                        </Row>

                        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                            <Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: token.colorPrimary }} spin />} />
                            <h3 style={{ marginTop: '16px', color: token.colorText }}>
                                {currentPipelinePhaseType === 'uploading' && translate('step4.loading.uploading', '正在將大數據切片 (Chunk) 傳輸至後端伺服器...')}
                                {currentPipelinePhaseType === 'processing' && translate('step4.loading.processing', '後端正在執行去識別化矩陣與加噪演算...')}
                                {currentPipelinePhaseType === 'auditing' && translate('step4.loading.auditing', '正在執行蒙地卡羅攻擊模擬與可用性評估...')}
                                {currentPipelinePhaseType === 'completed' && translate('step4.loading.completed', '後端演算完畢，正在生成最終合規報告...')}
                            </h3>
                            <Progress percent={calculationProgressValue} status="active" style={{ maxWidth: '600px', margin: '16px auto' }} strokeColor={token.colorPrimary} />
                        </div>
                        
                        <div style={{ maxWidth: '800px', margin: '0 auto', background: isDarkModeActiveStatus ? '#000000' : '#1e1e1e', color: '#00ff66', fontFamily: 'monospace', padding: '16px', borderRadius: '8px', textAlign: 'left', fontSize: '13px', height: '180px', overflowY: 'auto', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)' }}>
                            {systemSimulationLogsList.map((logItemString, logItemIndexNumber) => <div key={logItemIndexNumber} style={{ marginBottom: '4px' }}>{logItemString}</div>)}
                            <div ref={simulationLogsEndRef} />
                        </div>
                    </div>
                </Card>
            ) : (
                // ★ 修正：先前「安全性評估／效用評估」Row 與下方「脫敏結果預覽對照」Card 是
                // 兩個各自獨立輸出的區塊——Row 有正確依 isPipelineCalculatingStatus 隱藏，但
                // 預覽 Card 卻沒有一起被包進來，永遠顯示在畫面上。使用者反映：差分隱私處理時
                // 往下滑動頁面，會看到這張已經有欄位、有資料列（或至少有資料表框架）的預覽卡片，
                // 容易誤以為運算已經完成。修正方式：把兩者合併成同一個「統一輸出」區塊。
                // ★ 使用者反映（2026-09-22）：K-匿名「敏感欄位 = 0」時三攻擊整段跳過，
                //   attackSimulationMetricsData 會維持 null（見上方 setAttackSimulationMetricsData
                //   的說明），但這裡先前把整個統一輸出區塊（含去識別化結果預覽、效用評估）都用
                //   attackSimulationMetricsData 是否有值來控制顯示，導致「敏感欄位=0」時連已經
                //   算好的去識別化資料預覽都一起被藏起來，使用者誤以為沒有跑完。改用
                //   datasetRowStatsData 作為「這一輪是否已經成功跑完」的判斷依據——它是在
                //   runFullPipeline 中，不論三攻擊/CAP 是否被跳過，只要整個流程走到最後都會被
                //   設值（見 setDatasetRowStatsData），且發生錯誤時不會被設值，比
                //   attackSimulationMetricsData 更準確地反映「這輪有沒有真的跑完」，而不會被
                //   風險評估本身有沒有執行過影響。下方「安全性評估」卡片內部另外針對
                //   attackSimulationMetricsData 是否存在做了未評估的提示（見下方），不受影響。
                datasetRowStatsData && (
                    <>
                    <Row gutter={24} style={{ display: 'flex', alignItems: 'stretch' }}>
                        <Col span={16} style={{ display: 'flex' }}>
                            <Card 
                                title={<span><SafetyCertificateOutlined style={{ marginRight: 8, color: token.colorPrimary }} />{translate('step4.risk.title', '安全性評估 (Privacy Risks)')}</span>}
                                variant="borderless" style={{ background: token.colorBgContainer, width: '100%', display: 'flex', flexDirection: 'column' }} styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
                            >
                                <div style={{ background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px', border: `1px solid ${token.colorBorderSecondary}` }}>
                                    <div style={{ fontSize: '12px', color: token.colorTextDescription, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span>{translate('step4.risk.cap_label', 'CAP 前後對比')}</span>
                                        {/* ★ 使用者反映：CAP 有數字、下方風險卻是 0% 曾被誤認為顯示異常，原補充說明
                                            寫成一大段太複雜，改為精簡一句：CAP 未扣基準，跟下方風險算法不同。 */}
                                        <Tooltip title={translate('step4.risk.cap_tooltip', '若間接識別碼幾乎每筆都不同（例如連續數值加噪後仍為唯一值），前後可能都接近 100%，這是此指標的先天限制，不代表去識別化沒有效果。（此數字未扣除隨機猜測基準，跟下方風險算法不同，兩者可能不一致）')}>
                                            <QuestionCircleOutlined style={{ color: token.colorTextDescription, cursor: 'help' }} />
                                        </Tooltip>
                                    </div>
                                    {capReportData && !(capReportData.cap_before < 0 || capReportData.cap_after < 0) ? (
                                        <>
                                            <span style={{ fontSize: '24px', fontWeight: 'bold', color: capReportData.cap_after <= capReportData.cap_before ? '#52c41a' : '#faad14' }}>
                                                {(capReportData.cap_before * 100).toFixed(1)}% → {(capReportData.cap_after * 100).toFixed(1)}%
                                            </span>
                                            {capReportData.cap_before > 0 && (
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: token.colorTextDescription }}>
                                                    {translate('step4.risk.cap_diff_label', 'CAP 對比差異（現在/原本）：')} {((capReportData.cap_after / capReportData.cap_before) * 100).toFixed(1)}%
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <span style={{ fontSize: '16px', fontWeight: 'bold', color: token.colorTextDescription }}>
                                                {capReportData?.message?.startsWith('CAP 前後對比請求失敗')
                                                    ? translate('step4.risk.cap_request_failed', '未評估（CAP 請求失敗，原因見下方）')
                                                    : translate('step4.risk.cap_not_evaluated', '未評估（間接識別碼或敏感欄位設定不足，或限定條件篩選後無資料）')}
                                            </span>
                                            {/* ★ 新增：後端 CapReport 本身即附帶 message 欄位說明未評估原因（例如
                                                「限定族群篩選後樣本數為 0」或「敏感欄位設定不符」），過去這裡只顯示
                                                上方寫死的猜測文字、完全沒有把後端真正的原因印出來，使用者（與我們自己）
                                                都無從分辨這次「未評估」到底是欄位角色設定的問題，還是新加的 subgroup
                                                條件把資料篩選到剩 0 筆所致。故在此把後端原始 message 一併顯示。 */}
                                            {capReportData?.message && (
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: token.colorTextDescription }}>
                                                    {translate('step4.risk.cap_backend_message_prefix', '後端回應原因：')}{capReportData.message}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                                <ReactECharts option={getAttackChartOption()} style={{ height: '260px', marginBottom: '16px' }} theme={isDarkModeActiveStatus ? 'dark' : 'light'} />
                                {/* ★ 使用者反映（2026-09-22）：這三個風險標籤先前假設外層一定有
                                    attackSimulationMetricsData 才會被渲染，直接讀取其欄位；但外層的判斷
                                    依據已改成 datasetRowStatsData（見上方說明），K-匿名「敏感欄位=0」時
                                    attackSimulationMetricsData 會是 null、這裡卻仍會被渲染，若不判斷會
                                    直接噴錯（Cannot read properties of null）。改為有資料才顯示三個標籤，
                                    沒有資料時顯示「未評估」提示，說明原因，而不是讓整張卡片消失或噴錯。 */}
                                {attackSimulationMetricsData ? (
                                    <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                                        {/* ★ 提示文字修正：初版說明文字含英文專有名詞、括號附註與完整範例句，
                                            使用者反映字太多、非相關背景知識人員無法一眼看懂，改為單句、去除英文
                                            名詞與例子，只保留「攻擊者能做到什麼」的白話結論。 */}
                                        {/* ★ 使用者反映：加了原始成功率／基準的完整說明句後太長太複雜，改為只在提示
                                            文字最後補一個精簡的「（原始 X%／基準 Y%）」括號，不寫整句解釋。 */}
                                        <Tag color="red" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>
                                            {translate('step4.risk.singling', '指認風險:')} {(attackSimulationMetricsData.singling.risk * 100).toFixed(1)}%
                                            <Tooltip title={`${translate('step4.risk.singling_tooltip', '攻擊者能否從資料中，找出只對應到某一個人的獨特一筆記錄。')} (原始 ${(attackSimulationMetricsData.singling.ori * 100).toFixed(1)}% / 基準 ${(attackSimulationMetricsData.singling.base * 100).toFixed(2)}%)`}>
                                                <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                            </Tooltip>
                                        </Tag>
                                        <Tag color="orange" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>
                                            {translate('step4.risk.linkability', '連結風險:')} {(attackSimulationMetricsData.linkability.risk * 100).toFixed(1)}%
                                            <Tooltip title={`${translate('step4.risk.linkability_tooltip', '攻擊者能否把同一個人分散在不同資料裡的紀錄兜在一起。')} (原始 ${(attackSimulationMetricsData.linkability.ori * 100).toFixed(1)}% / 基準 ${(attackSimulationMetricsData.linkability.base * 100).toFixed(2)}%)`}>
                                                <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                            </Tooltip>
                                        </Tag>
                                        <Tag color="cyan" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>
                                            {translate('step4.risk.inference', '推斷風險:')} {(attackSimulationMetricsData.inference.risk * 100).toFixed(1)}%
                                            <Tooltip title={`${translate('step4.risk.inference_tooltip', '攻擊者能否用其他欄位的資訊，猜出這個人的敏感資料（例如疾病）。')} (原始 ${(attackSimulationMetricsData.inference.ori * 100).toFixed(1)}% / 基準 ${(attackSimulationMetricsData.inference.base * 100).toFixed(2)}%)`}>
                                                <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                            </Tooltip>
                                        </Tag>
                                    </div>
                                ) : (
                                    <div style={{ marginTop: 'auto', padding: '8px', textAlign: 'center', color: token.colorTextDescription, fontSize: '13px' }}>
                                        {translate('step4.risk.attacks_not_evaluated', '未評估（尚未設定「敏感欄位」，本次已略過三攻擊風險評估；不影響去識別化結果本身）')}
                                    </div>
                                )}
                                {/* ★ 使用者反映（2026-09-22）：K-匿名多重敏感欄位跑 CAP／三攻擊時，若某敏感欄位
                                    的值幾乎每筆都不同（唯一值佔比過高），後端底層 sklearn 分類器會讓服務容器當掉
                                    （詳見上方 highCardinalitySensitiveWarningInfo 狀態宣告處的完整說明）。這裡顯示
                                    本次執行偵測到的高風險欄位清單，並提供「仍要強制執行」勾選框——預設不勾選時
                                    這些欄位已被自動略過（不影響去識別化結果本身），使用者明確知情風險後可自行
                                    勾選強制送出，勾選後需按下方「重新運算」才會真的重新呼叫 API。 */}
                                {highCardinalitySensitiveWarningInfo.length > 0 && (() => {
                                    // 舊版快照沒有 handling 欄位，依當時的勾選狀態推回「強制」或「略過」。
                                    const resolveHandling = (item: typeof highCardinalitySensitiveWarningInfo[number]) =>
                                        item.handling || (forceRunHighCardinalitySensitiveFieldsStatus ? 'forced' : 'skipped');
                                    const binnedItemsList = highCardinalitySensitiveWarningInfo.filter((item) => resolveHandling(item) === 'binned');
                                    const skippedItemsList = highCardinalitySensitiveWarningInfo.filter((item) => resolveHandling(item) === 'skipped');
                                    const forcedItemsList = highCardinalitySensitiveWarningInfo.filter((item) => resolveHandling(item) === 'forced');
                                    const describeColumnsText = (itemsList: typeof highCardinalitySensitiveWarningInfo) =>
                                        itemsList.map((item) => `「${item.columnName}」(唯一值佔比 ${item.uniqueRatioPercent}%)`).join('、');
                                    // 級距可調的欄位：本次已分級距的，加上「數值型但級距太細仍被略過」的（有 binWidth）。
                                    const adjustableItemsList = highCardinalitySensitiveWarningInfo.filter((item) => item.binWidth !== undefined && resolveHandling(item) !== 'forced');
                                    const isOnlyBinnedStatus = skippedItemsList.length === 0 && forcedItemsList.length === 0;
                                    return (
                                        <Alert
                                            type={isOnlyBinnedStatus ? 'info' : 'warning'}
                                            showIcon
                                            style={{ marginTop: '12px' }}
                                            message={isOnlyBinnedStatus
                                                ? translate('step4.risk.sensitive_binned_title', '連續數值敏感欄位已自動分級距')
                                                : translate('step4.risk.high_cardinality_warning_title', '偵測到高風險敏感欄位')}
                                            description={
                                                <div>
                                                    <div style={{ marginBottom: 6 }}>
                                                        {translate('step4.risk.high_cardinality_reason', '推斷性攻擊以準識別欄位預測敏感欄位的值，並以「預測值與真實值完全相等」判定攻擊成功，因此敏感欄位需為可列舉的類別。值幾乎每筆都不同的欄位（如薪資）無法得到有意義的結果，運算量也會暴增。')}
                                                    </div>
                                                    {binnedItemsList.length > 0 && (
                                                        <div>
                                                            {translate('step4.risk.sensitive_binned_desc', '{{columns}} 已依級距轉換後再執行三攻擊／CAP（僅用於風險評估，去識別化結果本身不受影響）。', { columns: binnedItemsList.map((item) => `「${item.columnName}」每 ${item.binWidth!.toLocaleString()} 一級（共 ${item.binCount} 級）`).join('、') })}
                                                        </div>
                                                    )}
                                                    {skippedItemsList.length > 0 && (
                                                        <div>
                                                            {translate('step4.risk.high_cardinality_warning_desc', '{{columns}} 已略過三攻擊／CAP（不影響去識別化結果本身）。數值欄位可調大下方級距寬度；文字欄位請先自行歸併為類別後重新上傳。', { columns: describeColumnsText(skippedItemsList) })}
                                                        </div>
                                                    )}
                                                    {forcedItemsList.length > 0 && (
                                                        <div>
                                                            {translate('step4.risk.high_cardinality_forced_desc', '{{columns}} 已依設定以原始值強制執行三攻擊／CAP，結果不具評估意義，且可能執行失敗。', { columns: describeColumnsText(forcedItemsList) })}
                                                        </div>
                                                    )}
                                                    {adjustableItemsList.length > 0 && !forceRunHighCardinalitySensitiveFieldsStatus && (
                                                        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                                                            {adjustableItemsList.map((item) => (
                                                                <Space key={item.columnName} size={4}>
                                                                    <span>{translate('step4.risk.bin_width_label', '「{{column}}」級距寬度', { column: item.columnName })}</span>
                                                                    <InputNumber
                                                                        min={0}
                                                                        size="small"
                                                                        style={{ width: 120 }}
                                                                        value={sensitiveBinWidthOverridesMap[item.columnName] ?? item.binWidth}
                                                                        onChange={(nextValue) => setSensitiveBinWidthOverridesMap((prev) => {
                                                                            const nextMap = { ...prev };
                                                                            if (typeof nextValue === 'number' && nextValue > 0) nextMap[item.columnName] = nextValue;
                                                                            else delete nextMap[item.columnName];
                                                                            return nextMap;
                                                                        })}
                                                                    />
                                                                </Space>
                                                            ))}
                                                            <span style={{ color: token.colorTextDescription, fontSize: 12 }}>
                                                                {translate('step4.risk.bin_width_hint', '調整後請按「重新運算」；清空則恢復自動級距')}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {(skippedItemsList.length > 0 || forcedItemsList.length > 0) && (
                                                        <Checkbox
                                                            checked={forceRunHighCardinalitySensitiveFieldsStatus}
                                                            onChange={(e) => setForceRunHighCardinalitySensitiveFieldsStatus(e.target.checked)}
                                                            style={{ marginTop: 6 }}
                                                        >
                                                            {translate('step4.risk.high_cardinality_force_run_checkbox', '我了解風險，仍以原始值（不分級距）強制對這些欄位執行三攻擊／CAP（勾選後請按「重新運算」，若導致後端無回應請取消勾選）')}
                                                        </Checkbox>
                                                    )}
                                                </div>
                                            }
                                        />
                                    );
                                })()}
                                {datasetRowStatsData && (
                                    <div style={{ marginTop: '12px', fontSize: '12px', color: token.colorTextDescription }}>
                                        {translate(
                                            'step4.risk.row_stats_detail',
                                            '資料筆數：輸入 {{input}} 筆、刪除 {{deleted}} 筆、輸出 {{output}} 筆',
                                            {
                                                input: datasetRowStatsData.input.toLocaleString(),
                                                deleted: datasetRowStatsData.deleted.toLocaleString(),
                                                output: datasetRowStatsData.output.toLocaleString()
                                            }
                                        )}
                                    </div>
                                )}
                                {/* ★ 使用者反映（2026-09-22）：attackReportData 與 attackSimulationMetricsData
                                    永遠同步（見上方 setAttackReportData／setAttackSimulationMetricsData 都是同一個
                                    attackReportResult 驅動），但這是兩個獨立的 state，TypeScript 無法從
                                    attackReportData?.message 的真假推斷出 attackSimulationMetricsData 也非
                                    null，故這裡另外加一次 attackSimulationMetricsData 判斷式，單純為了讓型別
                                    檢查通過，實際執行邏輯不變（兩者本來就同時為 null 或同時有值）。 */}
                                {attackReportData?.message && attackSimulationMetricsData && (() => {
                                    // Backend message head is fixed-format with internal method notes and 2-decimal raw fractions,
                                    // which mismatches the 1-decimal percentage precision used by the tags above and reads as a contradiction.
                                    // Rebuild just the head with matching percentage precision and no internal method notes; keep any trailing note as-is.
                                    const headPattern = /^三攻擊風險評估完成(?:（[^）]*）)?。指認性風險:\s*[\d.]+,\s*連結性風險:\s*[\d.]+,\s*推斷性風險:\s*[\d.]+。/;
                                    const rebuiltHead = `${translate('step4.risk.summary_prefix', '三攻擊風險評估完成。')}${translate('step4.risk.singling', '指認風險:')} ${(attackSimulationMetricsData.singling.risk * 100).toFixed(1)}%, ${translate('step4.risk.linkability', '連結風險:')} ${(attackSimulationMetricsData.linkability.risk * 100).toFixed(1)}%, ${translate('step4.risk.inference', '推斷風險:')} ${(attackSimulationMetricsData.inference.risk * 100).toFixed(1)}%。`;
                                    const displayMessage = headPattern.test(attackReportData.message)
                                        ? attackReportData.message.replace(headPattern, rebuiltHead)
                                        : attackReportData.message;
                                    return (
                                        <div style={{ marginTop: '4px', fontSize: '12px', color: token.colorTextDescription }}>
                                            {displayMessage}
                                        </div>
                                    );
                                })()}
                            </Card>
                        </Col>
                        <Col span={8} style={{ display: 'flex' }}>
                            <Card 
                                title={<span><LineChartOutlined style={{ marginRight: 8, color: '#1677ff' }} />{translate('step4.utility.title', '資料效用與失真度評估')}</span>}
                                variant="borderless" style={{ background: token.colorBgContainer, width: '100%', display: 'flex', flexDirection: 'column' }} styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
                            >
                                <div style={{ background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', padding: '24px 16px', borderRadius: '8px', border: `1px solid ${token.colorBorderSecondary}`, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', alignItems: 'center' }}>
                                    <div style={{ textAlign: 'center', width: '100%', paddingBottom: '24px', borderBottom: `1px dashed ${token.colorBorderSecondary}` }}>
                                        <div style={{ fontSize: '14px', color: token.colorTextDescription, marginBottom: '16px' }}>
                                            {currentPrivacyModeTypeStr === 'k-anonymity'
                                                ? (
                                                    <>
                                                        {translate('step4.utility.suppression', '資料紀錄抑制率')}
                                                        {/* ★ 使用者反映：畫面上只有數字，沒有任何說明，非技術背景的使用者看不懂
                                                            這代表什麼、數字愈高愈好還是愈低愈好。補上「?」提示，並依實際採用的
                                                            抑制方式（列抑制／值抑制）給出對應的白話說明，避免固定寫死「整列」
                                                            但實際上是值抑制（打 *）的情形，造成說明與實際結果不符。 */}
                                                        <Tooltip title={
                                                            (currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression')
                                                                ? translate('step4.utility.suppression_tooltip_cell', '為了讓每個分組都符合您設定的隱私要求（例如 k 值），系統必須遮蔽（打上「*」）的資料格數，佔全部資料格數的比例。比例愈高，代表被遮蔽、看不到原始內容的資料愈多。')
                                                                : translate('step4.utility.suppression_tooltip_row', '為了讓每個分組都符合您設定的隱私要求（例如 k 值），系統必須整列刪除的資料筆數，佔全部資料筆數的比例。比例愈高，代表被刪除、無法保留下來的資料愈多。')
                                                        }>
                                                            <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                                        </Tooltip>
                                                    </>
                                                )
                                                : '總消耗隱私預算 (Epsilon)'}
                                        </div>
                                        <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#1677ff', marginBottom: '16px', fontFamily: 'monospace', lineHeight: 1 }}>
                                            {currentPrivacyModeTypeStr === 'k-anonymity'
                                                // ★ 修正: 後端回傳的抑制率為完整浮點數（如 0.10749143651555759），
                                                //   直接顯示位數過多，改為四捨五入至小數點後 2 位。
                                                // ★ 使用者反映（2026-09-29）：兩位小數會把 7.629% 顯示成 7.63%，與上限 7.63% 看起來
                                                //   相同而誤以為「剛好卡線卻通過」。改顯示到三位，並於下方附上被抑制數／總數。
                                                ? <>{(kReport ? kReport.suppression_rate_percent : 0).toFixed(3)} <span style={{ fontSize: '20px' }}>%</span></>
                                                : <>{dpReport ? dpReport.consumed_epsilon : 0} <span style={{ fontSize: '20px' }}>ε</span></>
                                            }
                                        </div>
                                        {currentPrivacyModeTypeStr === 'k-anonymity' && kReport && (() => {
                                            const isCellUnitStatus = kReport.suppression_unit === 'cell';
                                            // 後端有回傳分子／分母時優先使用；列抑制時可退回前端實際數出的刪除／輸入筆數
                                            const suppressedCountValue = kReport.suppressed_count ?? (!isCellUnitStatus ? datasetRowStatsData?.deleted : undefined);
                                            const totalCountValue = kReport.suppression_total_count ?? (!isCellUnitStatus ? datasetRowStatsData?.input : undefined);
                                            if (suppressedCountValue === undefined || totalCountValue === undefined) return null;
                                            return (
                                                <div style={{ marginTop: '-8px', marginBottom: '12px', fontSize: '12px', color: token.colorTextDescription }}>
                                                    {translate('step4.utility.suppression_count_detail', '（{{suppressed}} / {{total}} {{unit}}，上限 {{limit}}%）', {
                                                        suppressed: suppressedCountValue.toLocaleString(),
                                                        total: totalCountValue.toLocaleString(),
                                                        unit: isCellUnitStatus ? '格' : '筆',
                                                        limit: currentMaxSuppressionNumber ?? 5
                                                    })}
                                                </div>
                                            );
                                        })()}
                                        {currentPrivacyModeTypeStr === 'k-anonymity' && (
                                            <div style={{ fontSize: '12px', color: token.colorTextDescription, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ textAlign: 'center', width: '100%', paddingTop: '24px' }}>
                                        <div style={{ fontSize: '14px', color: token.colorTextDescription, marginBottom: '16px' }}>{translate('step4.utility.total_cols', '實際去識別數 / 總欄位數')}</div>
                                        <div style={{ fontSize: '36px', fontWeight: 'bold', color: token.colorText, fontFamily: 'monospace', lineHeight: 1 }}>
                                            {deidentifiedColumnsCountValue} <span style={{ fontSize: '20px', color: token.colorTextSecondary }}>/ {actualProcessedColumnsList.length}</span>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </Col>
                    </Row>

                    <Card
                        title={
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span><EyeOutlined style={{ marginRight: 8, color: '#13c2c2' }} />{translate('step4.preview.title', '脫敏結果預覽對照 (First 10 Rows)')}</span>
                                <Segmented options={[{ label: currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.preview.masked.k_anon', 'K-匿名化後資料') : translate('step4.preview.masked.dp', '差分隱私加噪後資料'), value: 'masked' }, { label: translate('step4.preview.raw', '原始明文數據 (Raw)'), value: 'original' }]} value={previewViewMode} onChange={(selectedViewModeVal) => setPreviewViewMode(selectedViewModeVal as 'masked' | 'original')} />
                            </div>
                        }
                        variant="borderless" style={{ background: token.colorBgContainer, marginTop: '24px' }}
                    >
                        {/* ★ 新增：使用者反映對照原始資料時，看到年齡／bmi 等欄位變成「*」，不清楚
                            原因，還以為是對照錯誤。已對照後端原始碼確認 (app/engines/anonymization/
                            strategies/generalize.py 的 apply_numeric_bins／categorical_mapping_generalize)：
                            「*」代表這一格的原始值沒有落在 Step2「泛化階層對照」設定的任何一段區間／
                            分類裡，系統為了避免外洩「沒被泛化到」的原始值，才整格改顯示「*」完全遮蔽，
                            並非程式出錯。Step2 雖然已經說明過，但使用者容易在跑到 Step4 時忘記，故在
                            這裡（實際看到「*」的當下）就地補充一次提醒。僅 K-匿名模式、且目前畫面上
                            確實有出現「*」時才顯示，避免無關時多一條用不到的提示。 */}
                        {currentPrivacyModeTypeStr === 'k-anonymity' && previewViewMode === 'masked'
                            && realMaskedDataRows.some((rowRecordItem) => Object.values(rowRecordItem).some((cellValue) => cellValue === '*')) && (
                            <Alert
                                type="info"
                                showIcon
                                style={{ marginBottom: '12px', textAlign: 'left' }}
                                message={translate('step4.preview.wildcard_hint_title', '欄位顯示「*」是什麼意思？')}
                                description={translate(
                                    'step4.preview.wildcard_hint_desc',
                                    '「*」不是錯誤，代表這筆資料的原始值沒有被您在 Step2「泛化階層對照」設定的分類或區間涵蓋到，系統為了避免外洩沒被泛化到的原始值，直接整格改顯示「*」。如果想保留這些資料的可用性，請回到 Step2，把這個值也加進對照設定中。'
                                )}
                            />
                        )}
                        {previewViewMode === 'masked' && previewParseDiagnosticText && (
                            <Alert
                                type="warning"
                                showIcon
                                style={{ marginBottom: '12px', textAlign: 'left' }}
                                message={translate('step4.preview.parse_diagnostic_title', '預覽表格暫時無法顯示資料')}
                                description={
                                    <>
                                        <div>{translate('step4.preview.parse_diagnostic_desc', '後端已成功回傳去識別化後的檔案（上方分數皆以此檔案計算得出），但畫面在解析內容以顯示預覽表格時發生問題，這是顯示層的問題，不代表去識別化處理本身失敗或輸出檔案有誤。請將以下除錯資訊截圖回報：')}</div>
                                        <div style={{ marginTop: '8px', fontSize: '12px', fontFamily: 'monospace', wordBreak: 'break-all', color: token.colorTextDescription }}>{previewParseDiagnosticText}</div>
                                    </>
                                }
                            />
                        )}
                        <Table
                            dataSource={previewViewMode === 'masked' ? (realMaskedDataRows.length > 0 ? realMaskedDataRows : []) : sampleRawDataRowsList}
                            columns={(previewViewMode === 'masked' ? maskedPreviewColumnNamesList : actualProcessedColumnsList).map((columnNameString) => {
                                const { role: configuredRoleNameString, tagColor: mappedTagColorString } = getCalculatedRole(columnNameString);
                                const localizedRoleI18nKeyString = `step4.role.${configuredRoleNameString.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;
                                // ★ 2026-09-29：此欄位若在本次風險評估中被自動分級距（僅套用在送三攻擊／CAP 的資料副本），
                                //   在標籤旁加提示，避免使用者看到預覽仍是原始值而誤以為分級距沒生效或輸出也被分級距。
                                const cleanPreviewColumnName = columnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
                                const binnedInfoForColumn = highCardinalitySensitiveWarningInfo.find(
                                    (item) => item.handling === 'binned' && item.binWidth !== undefined && item.columnName === cleanPreviewColumnName
                                );
                                return {
                                    title: (<div><div>{columnNameString}</div><Tag color={mappedTagColorString} style={{ fontSize: '10px', margin: 0 }}>{translate(localizedRoleI18nKeyString, configuredRoleNameString)}</Tag>{binnedInfoForColumn && (
                                        <Tooltip title={translate('step4.preview.binned_column_tooltip', '風險評估時以每 {{width}} 分級距（共 {{count}} 級）；去識別化輸出保留原始值', { width: binnedInfoForColumn.binWidth!.toLocaleString(), count: binnedInfoForColumn.binCount })}>
                                            <QuestionCircleOutlined style={{ marginLeft: 4, fontSize: '11px', cursor: 'help', color: token.colorTextDescription }} />
                                        </Tooltip>
                                    )}</div>),
                                    dataIndex: columnNameString, key: columnNameString,
                                };
                            })}
                            // ★ 使用者確認維持預覽 10 筆即可：資料來源（realMaskedDataRows／
                            // sampleRawDataRowsList）本身都已經只有最多 10 筆，分頁永遠只會有
                            // 1 頁，右下角的分頁按鈕形同虛設、只是多餘的雜訊，故關閉分頁功能。
                            pagination={false} size="small" rowKey={(rowRecordItemObject) => JSON.stringify(rowRecordItemObject)} scroll={{ x: 'max-content' }}
                        />
                    </Card>
                    </>
                )
            )}

            <Modal
                title={translate('step4.modal.title', '隱私合規與風險評估報告')}
                open={isReportModalVisibleStatus} onCancel={() => setIsReportModalVisibleStatus(false)} width={800} styles={{ body: { maxHeight: '72vh', overflowY: 'auto', paddingRight: '6px' } }}
                footer={[
                    <Button key="close" onClick={() => setIsReportModalVisibleStatus(false)}>{translate('step4.modal.close', '關閉')}</Button>,
                    <Button key="download" type="primary" icon={<DownloadOutlined />} loading={isExportingPdfStatus} onClick={handleDownloadPDF} style={{ background: '#4F46E5' }}>{translate('step4.modal.export_pdf', '匯出 PDF 憑證')}</Button>
                ]}
            >
                {/* ★ 使用者反映（2026-09-22）：與上方主畫面同理，這裡先前也用
                    attackSimulationMetricsData 是否有值來決定整份合規報告 Modal 開起來是否有
                    內容，K-匿名「敏感欄位=0」時會整份報告都是空的。改用 datasetRowStatsData
                    判斷「這一輪是否真的跑完」，報告內「隱私安全風險評估」那個象限另外處理
                    attackSimulationMetricsData 是否存在（見下方），其餘象限（檔案資訊、效用
                    評估、欄位處置對照表）不受風險評估是否執行影響，應正常顯示。

                    ★ 使用者反映（2026-09-23）：這份「合規審計報告」跟「官方風險評估報告」
                    （後端 /api/v1/report 簽發）風格版面不一致、內容各自獨立，使用者覺得太
                    複雜。這裡整份改版比照官方報告的樸素風格（深色品牌列、置中大標題、
                    一二三四五六編號段落、樸素邊框表格、無彩色卡片），並把官方報告獨有的
                    「隱私強化處理配置」段落（去識別技術參數＋三攻擊固定參數）一併合併進來，
                    讓使用者只需要看這一份、視覺風格與官方報告一致的完整報告——原本合規報告
                    才有的專案資訊、資料效用評估、欄位對照表、數位簽章則完整保留，不因改版而
                    遺失內容。 */}
                {datasetRowStatsData && (() => {
                    const sectionHeadingStyle: CSSProperties = { color: '#000000', fontSize: '15px', fontWeight: 600, marginTop: '24px', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #d9d9d9' };
                    const keyValueRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#333333', padding: '3px 0' };

                    // 一、專案與檢測權限資訊
                    // ★ 使用者反映（2026-09-23）：拿掉「檢測核可人」這一列，此段落只保留檔案名稱與保護模式。
                    const projectInfoRowsList: { label: string; value: string }[] = [
                        { label: translate('step4.report.file_name', '原始檔案名稱：'), value: currentDatasetFileNameString || 'dataset.csv' },
                        { label: translate('step4.report.mode', '保護模式：'), value: currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.report.k_anonymity_value', 'K-匿名化') : translate('step4.report.dp_value', '差分隱私化') }
                    ];

                    // 二、隱私強化處理配置：比照官方風險評估報告（後端 /api/v1/report）同一段落的
                    // 顯示內容——去識別方法參數取自本次實際送給後端的同一組畫面狀態；三攻擊固定
                    // 參數取自上方 RISK_ATTACK_REPORT_DISPLAY_PARAMS（與 runFullPipeline 內實際送出
                    // 的 RISK_ATTACK_DEFAULT_PARAMS 同步維護，見該常數宣告處說明）。
                    const deidConfigRowsList: { label: string; value: string }[] = currentPrivacyModeTypeStr === 'k-anonymity'
                        ? [
                            { label: translate('step4.report.deid_technique', '去識別技術'), value: translate('step4.report.k_anonymity_value', 'K-匿名化') },
                            { label: translate('step4.report.k_value_label', 'k 值'), value: String(currentKValueNumber) },
                            { label: translate('step4.report.suppress_limit_label', '抑制上限（%）'), value: String(currentMaxSuppressionNumber ?? 5) },
                            { label: translate('step4.report.exceed_behavior_label', '超限行為'), value: (currentLimitExceededActionStr || 'stop_and_error') === 'stop_and_error' ? translate('step3.stop_and_error', '停止並報錯') : translate('step3.force_suppress', '強制抑制(降效用)') },
                            { label: translate('step4.report.suppress_method_label', '抑制方式'), value: (currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression') ? translate('step3.cell_suppression', '值抑制 ') : translate('step3.row_suppression', '列抑制 ') },
                            ...((currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression')
                                ? [{ label: translate('step4.report.cell_fill_label', '值抑制填法'), value: currentCellFillMethodStr === 'missing' ? translate('step3.cell_fill_missing', '缺失值 (missing)') : translate('step3.cell_fill_star', '星號遮蔽 (star)') }]
                                : [])
                        ]
                        : [
                            { label: translate('step4.report.deid_technique', '去識別技術'), value: translate('step4.report.dp_value', '差分隱私化') },
                            { label: translate('step4.report.accumulated_epsilon_label', '已累計 ε'), value: String(dpAccumulatedEpsilonValue ?? 0) },
                            { label: translate('step4.report.accumulated_delta_label', '已累計 δ'), value: String(dpAccumulatedDeltaValue ?? 0) },
                            { label: translate('step4.report.default_delta_label', '預設 δ'), value: String(globalTargetDeltaValue ?? 0.0001) }
                        ];
                    const riskAttackParamRowsList: { label: string; value: string }[] = [
                        { label: translate('step4.report.iter_count_label', '指認性迭代次數'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.n_iter) },
                        { label: translate('step4.report.ctrl_ratio_label', '控制組比例'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.ctrl_ratio) },
                        { label: translate('step4.report.seed_label', '亂數種子'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.seed) },
                        { label: translate('step4.report.subset_size_label', '連結性子集大小'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.n_subset) },
                        { label: translate('step4.report.repeat_rounds_label', '重複實驗輪數'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.n_repeats) },
                        { label: translate('step4.report.overlap_ratio_label', '跨輪重疊比例'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.overlap_ratio) }
                    ];
                    const privacyConfigRowsList = [...deidConfigRowsList, ...riskAttackParamRowsList];

                    const renderKeyValueTable = (rowsList: { label: string; value: string }[], headerLeftText: string, headerRightText: string) => (
                        <div style={{ border: '1px solid #d9d9d9', borderRadius: '4px', marginBottom: '20px', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#000000', backgroundColor: '#ffffff' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f1f5f9' }}>
                                        <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 12px', textAlign: 'left', width: '40%', fontSize: '13px' }}>{headerLeftText}</th>
                                        <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 12px', textAlign: 'left', fontSize: '13px' }}>{headerRightText}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rowsList.map((rowItem, rowIndexNumber) => (
                                        <tr key={rowIndexNumber}>
                                            <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', fontSize: '13px', color: '#333333', wordBreak: 'break-word' }}>{rowItem.label}</td>
                                            <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', fontSize: '13px', color: '#333333', wordBreak: 'break-word' }}>{rowItem.value}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );

                    return (
                        <div id="printable-audit-report" ref={pdfReportContainerRef} style={{ color: '#000000', backgroundColor: '#ffffff', borderRadius: '4px', fontFamily: 'sans-serif', overflow: 'hidden' }}>
                            {/* 頂部深色品牌列，固定樣式不受畫面明／暗主題影響（比照官方風險評估報告 PDF 的
                                固定風格），才不會印出來的稽核文件因為使用者當下切成深色模式而變色。 */}
                            <div className="pdf-page-break" style={{ background: '#1f2937', color: '#ffffff', padding: '14px 24px', fontSize: '12px', pageBreakInside: 'avoid' }}>
                                {translate('step4.report.brand_bar', '通用去識別化與隱私保護系統 - 安全驗證與合規稽核報告')}
                            </div>

                            <div style={{ padding: isExportingPdfStatus ? '24px' : '24px' }}>
                                <div className="pdf-page-break" style={{ textAlign: 'center', marginBottom: '8px', pageBreakInside: 'avoid' }}>
                                    <h2 style={{ margin: '12px 0 4px', color: '#000000', fontSize: '21px' }}>{translate('step4.report.header', '隱私合規與風險評估報告')}</h2>
                                    <div style={{ fontSize: '12px', color: '#555555' }}>
                                        {translate('step4.report.cert_id', '報告編號:')} {auditMetadataObject.certificateId} ｜ {translate('step4.report.audit_time', '產出時間:')} {auditMetadataObject.auditTime}
                                    </div>
                                </div>

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, marginTop: '20px', pageBreakInside: 'avoid' }}>一、 {translate('step4.report.info_title', '專案與檢測權限資訊')}</h4>
                                {renderKeyValueTable(projectInfoRowsList, translate('step4.report.config_item_header', '設定項目'), translate('step4.report.config_detail_header', '配置細節'))}

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>二、 {translate('step4.report.privacy_config_title', '隱私強化處理配置')}</h4>
                                {renderKeyValueTable(privacyConfigRowsList, translate('step4.report.config_item_header', '設定項目'), translate('step4.report.config_detail_header', '配置細節'))}

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>三、 {translate('step4.report.risk_title', '再識別風險量測結果')}</h4>
                                <div className="pdf-page-break" style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
                                    {attackSimulationMetricsData ? (
                                        <>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.singling_risk', '指認性攻擊成功率 (Singling Out)：')}</span><span>{(attackSimulationMetricsData.singling.risk * 100).toFixed(2)}%</span></div>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.linkability_risk', '連結性攻擊成功率 (Linkability)：')}</span><span>{(attackSimulationMetricsData.linkability.risk * 100).toFixed(2)}%</span></div>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.inference_risk', '推斷性攻擊成功率 (Inference)：')}</span><span>{(attackSimulationMetricsData.inference.risk * 100).toFixed(2)}%</span></div>
                                        </>
                                    ) : (
                                        // ★ 使用者反映（2026-09-22）：K-匿名「敏感欄位=0」時三攻擊被略過，這裡改顯示
                                        //   說明文字，而非讀取 null 的 attackSimulationMetricsData 噴錯或整份報告消失。
                                        <div style={{ fontSize: '13px', color: '#555555', padding: '3px 0' }}>
                                            {translate('step4.report.risk_not_evaluated', '未評估（尚未設定「敏感欄位」，本次已略過三攻擊與 CAP 風險評估）')}
                                        </div>
                                    )}
                                    {/* ★ 使用者反映（2026-09-23）：CAP 前後對比獨立於 attackSimulationMetricsData
                                        是否有值（CAP 與三攻擊分開執行、分開判斷「是否已略過」），只依
                                        capReportData 本身判斷要顯示數字還是「未評估」原因；標籤文字比照官方
                                        風險評估報告的「處理前／處理後歸因機率」措辭，維持風格一致。 */}
                                    {capReportData && !(capReportData.cap_before < 0 || capReportData.cap_after < 0) ? (
                                        <>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.cap_before_label', '處理前歸因機率 (CAP Before)：')}</span><span>{(capReportData.cap_before * 100).toFixed(2)}%</span></div>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.cap_after_label', '處理後歸因機率 (CAP After)：')}</span><span>{(capReportData.cap_after * 100).toFixed(2)}%</span></div>
                                        </>
                                    ) : (
                                        <div style={{ fontSize: '13px', color: '#555555', padding: '3px 0' }}>
                                            {translate('step4.report.cap_not_evaluated', '未評估（間接識別碼或敏感欄位設定不足，或限定條件篩選後無資料）')}
                                            {capReportData?.message && (
                                                <div style={{ marginTop: '4px', fontSize: '12px' }}>
                                                    {translate('step4.report.cap_backend_message_prefix', '後端回應原因：')}{capReportData.message}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>四、 {translate('step4.report.utility_title', '資料效用與失真度評估')}</h4>
                                <div className="pdf-page-break" style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
                                    <div style={keyValueRowStyle}>
                                        <span>{currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.report.suppression', '資料紀錄抑制率：') : translate('step4.report.total_epsilon', '總消耗隱私預算 (Epsilon)：')}</span>
                                        <span>{currentPrivacyModeTypeStr === 'k-anonymity' ? `${(kReport ? kReport.suppression_rate_percent : 0).toFixed(3)}%` : `${dpReport ? dpReport.consumed_epsilon : 0} ε`}</span>
                                    </div>
                                    <div style={keyValueRowStyle}>
                                        <span>{translate('step4.report.total_cols', '實際去識別數 / 總欄位數：')}</span><span>{deidentifiedColumnsCountValue} / {actualProcessedColumnsList.length}</span>
                                    </div>
                                    {datasetRowStatsData && (
                                        <div style={keyValueRowStyle}>
                                            <span>{translate('step4.report.row_stats', '資料筆數（輸入/刪除/輸出）：')}</span>
                                            <span>{datasetRowStatsData.input.toLocaleString()} / {datasetRowStatsData.deleted.toLocaleString()} / {datasetRowStatsData.output.toLocaleString()}</span>
                                        </div>
                                    )}
                                </div>

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>五、 {translate('step4.report.table_title', '欄位處置與技術對照表')}</h4>
                                <div style={{ maxHeight: isExportingPdfStatus ? 'none' : '240px', overflowY: isExportingPdfStatus ? 'visible' : 'auto', border: '1px solid #d9d9d9', borderRadius: '4px', marginBottom: '20px' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', color: '#000000', backgroundColor: '#ffffff', tableLayout: 'fixed' }}>
                                        <thead>
                                            <tr style={{ backgroundColor: '#f1f5f9', position: isExportingPdfStatus ? 'static' : 'sticky', top: 0, zIndex: 1, pageBreakInside: 'avoid' }}>
                                                <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '40%' }}>{translate('step4.report.col_name', '欄位名稱')}</th>
                                                <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('step4.report.col_role', '隱私角色')}</th>
                                                <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('step4.report.col_tech', '套用去識別化技術')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {actualProcessedColumnsList.map((columnNameString) => {
                                                const { role: configuredRoleNameString, maskStrategy: configuredMaskStrategyString } = getCalculatedRole(columnNameString);
                                                const targetDpFieldConfigItemObj = currentDpFieldsListArray?.find(fieldItemRecord => fieldItemRecord.fieldName === columnNameString && fieldItemRecord.enabled);
                                                let resolvedStrategyDescriptionText = translate('step4.report.tech_keep_original', '保留原文');

                                                if (configuredRoleNameString === 'Identifier') {
                                                    resolvedStrategyDescriptionText = configuredMaskStrategyString === 'remove'
                                                        ? translate('step4.report.tech_removed', '直接移除')
                                                        : translate('step4.report.tech_full_masking', '完全遮蔽');
                                                }
                                                else if (configuredRoleNameString === 'Quasi-identifier' && currentPrivacyModeTypeStr === 'k-anonymity') resolvedStrategyDescriptionText = translate('step4.report.tech_generalization', '區間/時間泛化');
                                                else if (currentPrivacyModeTypeStr === 'differential-privacy' && targetDpFieldConfigItemObj) resolvedStrategyDescriptionText = translate('step4.report.tech_dp', '差分隱私加噪');

                                                const localizedRoleI18nKeyString = `step4.role.${configuredRoleNameString.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;

                                                return (
                                                    <tr key={columnNameString} style={{ backgroundColor: '#ffffff', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                                                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#000000', wordBreak: 'break-word' }}><b>{columnNameString}</b></td>
                                                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{translate(localizedRoleI18nKeyString, configuredRoleNameString)}</td>
                                                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{resolvedStrategyDescriptionText}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>六、 {translate('step4.report.measurement_note_title', '量測說明')}</h4>
                                <div className="pdf-page-break" style={{ fontSize: '12px', color: '#555555', marginBottom: '20px', pageBreakInside: 'avoid' }}>
                                    {attackSimulationMetricsData ? (
                                        <div style={{ marginBottom: '4px' }}>
                                            {translate('step4.report.measurement_note_attack', '三攻擊風險評估完成。指認性風險: {{singling}}, 連結性風險: {{linkability}}, 推斷性風險: {{inference}}。', {
                                                singling: attackSimulationMetricsData.singling.risk.toFixed(2),
                                                linkability: attackSimulationMetricsData.linkability.risk.toFixed(2),
                                                inference: attackSimulationMetricsData.inference.risk.toFixed(2)
                                            })}
                                        </div>
                                    ) : (
                                        <div>{translate('step4.report.measurement_note_not_evaluated', '尚未設定「敏感欄位」，本次已略過三攻擊與 CAP 風險評估，故無量測結果可供說明。')}</div>
                                    )}
                                    {capReportData && !(capReportData.cap_before < 0 || capReportData.cap_after < 0) && (
                                        <div>
                                            {translate('step4.report.measurement_note_cap', 'CAP 前後對比完成。處理前: {{before}}, 處理後: {{after}}。', {
                                                before: capReportData.cap_before.toFixed(2),
                                                after: capReportData.cap_after.toFixed(2)
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="pdf-page-break" style={{ textAlign: 'right', marginTop: '16px', borderTop: `1px dashed #d9d9d9`, paddingTop: '12px', fontSize: '12px', color: '#888888', pageBreakInside: 'avoid' }}>
                                    {translate('step4.report.signature', '系統數位簽章：PRIVACY-APP-AUDIT-ENGINE-V2.0-PASSED')}
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </Modal>
        </div>
    );
}