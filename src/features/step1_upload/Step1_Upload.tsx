/**
 * ============================================================================
 * 檔案名稱 (File): Step1_Upload.tsx
 * 模組功能 (Description): 去識別化工作流第一步：資料集上傳與脫敏保護模式選擇組件 (支援 CSV/Excel 解析與前 1000 筆資料預覽)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { useState } from 'react';
import { Card, Upload, Table, Alert, Button, Space, Typography, Popconfirm, theme, App as AntdApp, Radio, Row, Col, Spin, Tooltip } from 'antd';
import { InboxOutlined, FileExcelOutlined, DeleteOutlined, CheckCircleFilled, SafetyCertificateOutlined, CodeSandboxOutlined, QuestionCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore } from '../../store/useWorkspaceStore';

const { Dragger } = Upload;

const { Text, Title } = Typography;

/**
 * 預設解析常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 * 
 * 詳細說明:
 * - MAX_FILE_SIZE_LIMIT_MB: 允許上傳之單一檔案大小上限 (2048 MB / 2 GB)，防止前端記憶體溢出。
 * - MAX_COLUMN_COUNT: 允許上傳之資料集最大欄位 (column) 數量上限，超過則拒絕解析結果。
 * - PARSE_PREVIEW_ROW_LIMIT: PapaParse 執行時，僅解析前 1000 筆資料供預覽，加速大檔案載入。
 * - UI_CARD_PREVIEW_ROW_LIMIT: 成功載入後，UI 表格上實際僅顯示前 5 筆紀錄。
 * - BYTES_PER_MEGABYTE: 1 MB 對應的 Bytes 數 (1024 * 1024 = 1048576)。
 */
const MAX_FILE_SIZE_LIMIT_MB = 2048;
const MAX_COLUMN_COUNT = 50;
const PARSE_PREVIEW_ROW_LIMIT = 1000;
const UI_CARD_PREVIEW_ROW_LIMIT = 5;
const BYTES_PER_MEGABYTE = 1048576; // 1024 * 1024

/**
 * ============================================================================
 * CSV 檔案編碼偵測與正規化
 * 規範對照: 修正使用者反映之「現在只能讀取 Big5 的 CSV，其他類型都會出現亂碼」問題
 *
 * 根因 (已核對後端 app/core/dataset_io.py::_read_csv 原始碼):
 *   後端讀取 CSV 時，依序嘗試 utf-8 → utf-8-sig → big5 三種編碼，第一個不拋出解碼例外
 *   的就採用。問題在於：只要不是這三種編碼，仍有相當機率「剛好可以被 Big5 解碼器解出
 *   來」(不代表解對，只是沒有觸發解碼例外)，於是被靜默誤判為 Big5、產生亂碼，且不會
 *   出現任何錯誤或警告讓使用者發現問題出在編碼判斷上。例如常見的 GBK (簡體中文)、
 *   Shift-JIS 等雙位元編碼、或 Windows-1252 這種「任何位元組都能解出字元」的單位元組
 *   編碼，都可能落入這個陷阱。
 *
 *   後端是獨立部署的 Docker 服務 (本次無法直接重新建置／部署使其套用修正)，因此改為
 *   在「前端上傳當下」就先偵測檔案真實編碼：若已經是 utf-8／utf-8 BOM，原樣送出 (沿用
 *   原有行為，不影響效能與位元組內容)；若偵測到是其他編碼 (包含 Big5)，則在瀏覽器端先
 *   轉換為乾淨的 UTF-8 位元組取代原始檔案送出，讓後端一定會落在其判斷式的第一順位
 *   (utf-8) 正確解出，不需要後端配合重新部署。
 *   ★ 修正: Big5 先前也被視為「後端原生支援，原樣送出」，但這會讓「前端組 config 用的
 *   欄位名稱」(來自瀏覽器 TextDecoder('big5')) 與「後端實際收到的 CSV 表頭」(來自後端
 *   自己的 big5 codec 再解碼一次) 分別各自解碼同一份原始位元組——兩份 Big5 對照表未必
 *   完全相同 (尤其罕見字)，一旦欄位名稱命中差異字元，即會造成 config 的 column_budgets
 *   引用「後端解出來實際不存在」的欄位名稱，觸發 ERR_CONFIG_DATA_MISMATCH。故改為 Big5
 *   也強制在前端重新編碼為 UTF-8 再送出，讓兩邊保證解碼自同一次結果，不再有分歧風險。
 *
 *   同時，前端自己的資料預覽表格 (Data Preview) 也一併從偵測到的正確編碼解碼文字內容
 *   餵給 PapaParse (而非讓 PapaParse 用預設的 UTF-8 猜測去讀取原始檔案位元組)，確保
 *   「畫面預覽看到的內容」與「實際送給後端處理的內容」兩者一致，不會有一邊正常、
 *   一邊亂碼的狀況。
 *
 *   偵測方式全部採用瀏覽器原生的 TextDecoder API (不需額外安裝任何第三方套件)：
 *   先看檔頭是否有 UTF-8 BOM；沒有的話，依序以「嚴格模式」(fatal: true，遇到不合法
 *   位元組序列就拋出例外) 嘗試各候選編碼，第一個沒有拋出例外的即視為偵測結果。
 *   ★ 已知限制: 雙位元組編碼 (Big5／GBK／Shift-JIS) 彼此的合法位元組範圍有重疊，
 *   極少數情況下可能被誤判為候選清單中排序較前的另一種雙位元組編碼；但這與後端原本
 *   的判斷方式屬同一類限制，且依此專案實際資料情境 (繁體中文為主)，UTF-8／Big5 兩種
 *   最常見的編碼皆能準確偵測，仍是相較「其他編碼一律誤判為 Big5」的明顯改善。
 * ============================================================================
 */
const CSV_ENCODING_DETECTION_SAMPLE_BYTES = 65536; // 只取檔案開頭 64KB 做編碼偵測樣本，避免大檔案 (最大 2GB) 因偵測而拖慢效能
const MULTIBYTE_TAIL_TRIM_BYTES = 4; // 樣本尾端可能剛好截斷一個多位元組字元，偵測時先去掉最後幾個位元組，避免因切割位置不巧而誤判為不合法編碼

// ★ 修正: 使用者反映 Big5 檔案上傳後，Step4 後端有機率回傳 ERR_CONFIG_DATA_MISMATCH
//   (「預算設定引用了資料中不存在的欄位」)。根因：Big5 原本被列在此名單中，偵測到 Big5 時
//   會把「原始檔案位元組」原封不動送給後端，讓後端自己用 Python 的 big5 codec 再解碼一次；
//   但前端組 column_budgets 的欄位名稱，用的是瀏覽器 TextDecoder('big5') 解碼的結果。瀏覽器
//   的 WHATWG big5 解碼表跟 Python 的 big5 codec 並非同一份對照表，罕見字（廠商造字區等）
//   可能被解成不同 Unicode 字元，一旦欄位名稱剛好命中這類字元，前端組出的欄位名稱就會跟
//   後端自己解出來的實際表頭不一致，觸發「欄位不存在」的設定檔驗證錯誤。
//   移除 'big5' 後，Big5 檔案比照 GBK／Shift-JIS 等其他編碼，一律由前端解碼後重新編碼為
//   UTF-8 再送出，確保「組 config 用的欄位名稱」與「送給後端的檔案內容」保證來自同一次解碼
//   結果，不再依賴前後端兩份 Big5 對照表剛好一致。
//
//   ★ 修正 (2026-09-17，依外部測試人員回報 K-匿名 400 錯誤，核對後端 dataset_io.py::_read_csv
//   原始碼後找出根因): 'utf-8-bom' 先前也被列在此名單中「原樣送出」，但後端讀檔時依序嘗試
//   utf-8 → utf-8-sig → big5，只要「不拋例外」就採用該編碼——而帶 BOM (EF BB BF) 的檔案，
//   用純 utf-8 (非 utf-8-sig) 解碼並不會拋出例外，只是會把 BOM 解成一個看不見的 U+FEFF
//   字元、原封不動地黏在第一個欄位名稱前面 (例如「地區」欄位變成看不見的 U+FEFF 字元 + "地區")。也就是說後端永遠會在第一順位
//   的 utf-8 就成功解出、實際上根本不會走到專門處理 BOM 的 utf-8-sig。這是後端這份原始碼本身
//   的既有瑕疵 (utf-8-sig 這個分支形同永遠打不到的死路)，但這個 Demo 使用的後端 Docker 映像
//   無法在此重新建置部署，故仍從前端補這個洞。
//   實務影響：Windows Excel 另存新檔選「CSV UTF-8」匯出的檔案，幾乎都會自動加上 BOM，是非常
//   常見的真實匯出格式；只要資料集第一欄有被設定角色/策略 (幾乎必然)，後端解出來的欄位名稱
//   就會多一個看不見的 BOM 字元、與前端組出的乾淨欄位名稱對不上，觸發「欄位不存在」验证失败
//   （400 Bad Request）——研判就是外部測試人員回報 K-匿名一直 400 的主因。
//   修法：比照 Big5 的處理方式，'utf-8-bom' 也一律由前端解碼 (已於 decodeCsvBytesToText 中
//   跳過 BOM 位元組) 後重新編碼為「乾淨、不含 BOM」的 UTF-8 位元組再送出，讓後端無論落在
//   utf-8 或 utf-8-sig 哪個分支，解出來的欄位名稱都保證乾淨，不再有這個落差。
const BACKEND_NATIVELY_SUPPORTED_CSV_ENCODINGS = new Set(['utf-8']);

// 除了 UTF-8／Big5 之外，常見的中文／Windows 匯出編碼候選清單 (依「較常見、較不易與其他候選混淆」排序)，
// 依序嘗試解碼，第一個不拋出例外的即採用；windows-1252 為單位元組編碼、任何位元組皆可解出字元，
// 故實務上作為「其餘候選皆不合法時」的最終備援
const FALLBACK_LEGACY_ENCODING_CANDIDATES = ['big5', 'gbk', 'shift-jis', 'windows-1252'];

/**
 * 函數名稱: detectCsvBytesEncoding
 * 函數功能: 依 BOM 判斷與「嚴格解碼」(fatal: true) 逐一嘗試候選編碼，偵測位元組陣列的真實文字編碼。
 */
const detectCsvBytesEncoding = (fullBytesArray: Uint8Array): string => {
    if (fullBytesArray.length >= 3 && fullBytesArray[0] === 0xEF && fullBytesArray[1] === 0xBB && fullBytesArray[2] === 0xBF) {
        return 'utf-8-bom';
    }

    const sampleForDetectionArray = fullBytesArray.subarray(0, Math.min(fullBytesArray.length, CSV_ENCODING_DETECTION_SAMPLE_BYTES));
    const safeSampleArray = sampleForDetectionArray.subarray(0, Math.max(0, sampleForDetectionArray.length - MULTIBYTE_TAIL_TRIM_BYTES));

    try {
        new TextDecoder('utf-8', { fatal: true }).decode(safeSampleArray);
        return 'utf-8';
    } catch {
        // 不是合法 UTF-8，繼續往下嘗試常見的中文／Windows 舊式編碼
    }

    for (const candidateEncodingLabel of FALLBACK_LEGACY_ENCODING_CANDIDATES) {
        try {
            new TextDecoder(candidateEncodingLabel, { fatal: true }).decode(safeSampleArray);
            return candidateEncodingLabel;
        } catch {
            // 繼續嘗試下一個候選編碼
        }
    }

    return 'unknown';
};

/**
 * 函數名稱: decodeCsvBytesToText
 * 函數功能: 依偵測到的編碼標籤，將完整檔案位元組解碼為文字字串；偵測不到已知編碼時，
 *           寬鬆以 UTF-8 解碼作為保底 (可能出現少數替代字元 �，但至少不會讓流程整個卡住)。
 */
const decodeCsvBytesToText = (fullBytesArray: Uint8Array, detectedEncodingLabel: string): string => {
    if (detectedEncodingLabel === 'utf-8-bom') {
        return new TextDecoder('utf-8').decode(fullBytesArray.subarray(3));
    }
    if (detectedEncodingLabel === 'unknown') {
        return new TextDecoder('utf-8').decode(fullBytesArray);
    }
    return new TextDecoder(detectedEncodingLabel).decode(fullBytesArray);
};

/**
 * 函數名稱: Step1_Upload
 * 函數功能: 渲染步驟一介面，提供拖頁上傳 CSV/Excel 檔案、預覽資料欄位與前幾筆資料內容，並供用戶選擇 K-Anonymity 或 Differential Privacy 脫敏保護模式。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 步驟一 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被主流程 Step 精靈組件載入渲染
 *   - 訂閱與更新 useWorkspaceStore 中的 columns, previewData, privacyMode 等全域狀態
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function Step1_Upload(): React.ReactElement 
{
    // 取得 Ant Design 當前主題 Token
    const { token } = theme.useToken();
    
    // 主題深色模式狀態標記 (判斷背景色是否非純白) (符合規範 g)
    const isDarkModeActive = token.colorBgContainer !== '#ffffff';

    // 字級縮放比例：本組件內文字/圖示尺寸原以 AntD 預設基準字級 (14px) 設計，
    // 此處依當前全域字體大小設定等比例縮放，避免與其他採用 token.fontSize 之元件 (如下方預覽表格) 呈現不一致的文字大小
    const fontSizeScaleFactor = token.fontSize / 14;

    const { message: messageApi } = AntdApp.useApp();

    const { t: translate } = useTranslation();
    
    // ============================================================================
    // 全域狀態訂閱區塊 (來自 useWorkspaceStore)
    // 規範對照: 符合變數撰寫參考 b) 確認全域變數之含義、c) 確認全域變數與程序之關係
    // ============================================================================
    
    // 欄位名稱陣列 (如 ['ID', 'Name', 'Age'])
    const datasetColumnsList = useWorkspaceStore(
        (state) => state.columns
    );

    // 解析後之前端預覽用資料列集合
    const datasetPreviewRowsList = useWorkspaceStore(
        (state) => state.previewData
    );

    // 使用者上傳之檔案原始名稱
    const uploadedFileName = useWorkspaceStore(
        (state) => state.fileName
    );

    // 寫入解析後資料至 Store 之 Action 函式
    const setFileDataAction = useWorkspaceStore(
        (state) => state.setFileData
    );

    // 寫入原始實體檔案至 Store 之 Action 函式
    const setDataFileAction = useWorkspaceStore(
        (state) => state.setDataFile
    );

    // 清除 Store 中檔案快取資料之 Action 函式
    const clearFileDataAction = useWorkspaceStore(
        (state) => state.clearFileData
    );

    // ★ 新增：寫入本次上傳編碼偵測診斷快照至 Store 之 Action 函式 (供全域 API 錯誤紀錄引用，
    //   讓外部測試人員回報 API 錯誤時，能自動附上「這份資料集當初偵測到什麼編碼」的資訊)
    const setLastUploadDiagnosticsAction = useWorkspaceStore(
        (state) => state.setLastUploadDiagnostics
    );
    
    // 當前所選之去識別化保護模式 ('k-anonymity' | 'differential-privacy')
    const currentPrivacyMode = useWorkspaceStore(
        (state) => state.privacyMode
    );

    // 設定保護模式之 Action 函式
    const setPrivacyModeAction = useWorkspaceStore(
        (state) => state.setPrivacyMode
    );

    // 觸發進入下一步 (Step 2) 之 Action 函式
    const executeNextStepAction = useWorkspaceStore(
        (state) => state.nextStep
    );
    
    // 元件區域狀態宣告 (符合規範 g)
    const [isFileUploading, setIsFileUploading] = useState<boolean>(false); // 上傳/解析中之載入狀態開關

    // 判斷當前是否已有載入完成之資料集 (依據欄位陣列是否存在且長度大於 0) (符合規範 g)
    const isDatasetLoadedStatus = datasetColumnsList && datasetColumnsList.length > 0;

    /**
     * 函數名稱: runPapaParseOnCsvText
     * 函數功能: 對「已經正確解碼好的文字內容」執行 PapaParse 解析 (抽出與原本 Papa.parse 呼叫共用的
     *           complete／error 處理邏輯，供 CSV 編碼偵測完成後呼叫)。
     */
    const runPapaParseOnCsvText = (csvTextContent: string, originalFileNameString: string): void =>
    {
        Papa.parse(
            csvTextContent,
            {
                header: true,         // 將第一行視為欄位名稱
                skipEmptyLines: true, // 略過空白行
                preview: PARSE_PREVIEW_ROW_LIMIT, // 僅解析前 N 筆，確保效能
                complete: (parseResultsObj) =>
                {
                    // 解析成功之處理邏輯
                    const parsedColumnsListArray = parseResultsObj.meta.fields || [];
                    const rawDataRowsArray = parseResultsObj.data as Record<string, unknown>[];

                    // 防呆處理：驗證解析出之欄位數量是否超出 MAX_COLUMN_COUNT 上限
                    if (parsedColumnsListArray.length > MAX_COLUMN_COUNT)
                    {
                        setIsFileUploading(false);

                        messageApi.error(
                            translate('step1.error_too_many_columns', { count: parsedColumnsListArray.length, limit: MAX_COLUMN_COUNT, defaultValue: `資料欄位數量 (${parsedColumnsListArray.length}) 超過上限 ${MAX_COLUMN_COUNT} 個！` })
                        );
                        return;
                    }

                    // 將解析結果與檔案名稱寫入全域 WorkspaceStore
                    setFileDataAction(parsedColumnsListArray, rawDataRowsArray, originalFileNameString);

                    // 若尚未選擇任何保護模式，則預設設定為 'k-anonymity'
                    if (!currentPrivacyMode)
                    {
                        setPrivacyModeAction('k-anonymity');
                    }

                    // 關閉解析載入動畫
                    setIsFileUploading(false);

                    // 提示使用者解析成功
                    messageApi.success(
                        translate('step1.parse_success', { file: originalFileNameString })
                    );
                },
                error: (parseErrorObj: Error) =>
                {
                    // 解析失敗之處理邏輯 (符合規範 g: 處理錯誤回傳)
                    setIsFileUploading(false);

                    messageApi.error(
                        translate('step1.parse_error', { error: parseErrorObj.message })
                    );
                }
            }
        );
    };

    /**
     * 函數名稱: handleFileUpload
     * 函數功能: 驗證上傳檔案大小限制 (最大 2GB)。CSV 檔案會先偵測實際文字編碼 (見上方
     *           detectCsvBytesEncoding／decodeCsvBytesToText)：偵測到純 utf-8 (不含 BOM) 則
     *           原樣送出；偵測到其他編碼 (含 utf-8-bom、Big5、GBK、Shift-JIS 等) 則在瀏覽器端
     *           先解碼、去除 BOM 後重新編碼為乾淨 UTF-8 位元組再送出 (詳見
     *           BACKEND_NATIVELY_SUPPORTED_CSV_ENCODINGS 上方 2026-09-17 註解)，避免後端誤判
     *           編碼或因 BOM 殘留造成欄位名稱不一致。Excel (.xlsx／.xls) 為二進位格式，
     *           以 SheetJS (xlsx 套件) 解析第一個工作表並轉換為 CSV 文字後，比照 CSV 路徑處理，
     *           確保畫面預覽與實際送給後端的內容一致。
     *           解析完成後再驗證欄位數量是否超出 MAX_COLUMN_COUNT 上限。
     */
    const handleFileUpload = (targetFileObj: File): boolean =>
    {
        // 防呆處理：驗證檔案大小是否超出 MAX_FILE_SIZE_LIMIT_MB 限制
        const isFileSizeValid = targetFileObj.size / BYTES_PER_MEGABYTE < MAX_FILE_SIZE_LIMIT_MB;

        if (!isFileSizeValid)
        {
            messageApi.error(
                translate('step1.error_file_too_large', '檔案大小不能超過 2GB！')
            );
            return false;
        }

        // 啟動解析載入動畫
        setIsFileUploading(true);

        const isCsvFileByExtension = /\.csv$/i.test(targetFileObj.name);

        if (!isCsvFileByExtension)
        {
            // ★ 修正: 使用者反映上傳 .xlsx 後預覽出現亂碼 (畫面看到 "PK"、"docProps/app.xml" 等
            //   字樣，正是 .xlsx 內部 ZIP 壓縮結構的原始位元組洩漏出來)。根因：.xlsx／.xls 是
            //   二進位格式 (Office Open XML／舊版 BIFF)，並非純文字，但先前直接把原始二進位檔案
            //   丟給 Papa.parse (一個 CSV/純文字解析器) 處理，等同把亂碼位元組硬解成文字。且先前
            //   `dataFile` 直接存原始 Excel 二進位檔，Step4 送出時卻用 `.text()` 當 CSV 文字讀取，
            //   即使畫面預覽修好了，送給後端的內容仍會是亂碼。
            //   改為用 SheetJS (xlsx 套件) 在瀏覽器端真正解析 Excel 工作表，取第一個工作表轉換為
            //   CSV 文字後，比照既有 CSV 路徑處理：`runPapaParseOnCsvText` 供畫面預覽與欄位清單，
            //   並包成 .csv 的 File 物件取代原始 Excel 二進位存入 dataFile，確保後續送給後端的
            //   內容與畫面預覽一致，且沿用既有 CSV 上傳流程 (Step4_Result.tsx 以 `.text()` 讀取)。
            targetFileObj.arrayBuffer()
                .then((fullArrayBufferData) =>
                {
                    // ★ 2026-09-30：xlsx 套件由 npm 上已停止更新的 0.18.5（有已知的原型污染、ReDoS 漏洞）改為
                    //   SheetJS 官方 CDN 發佈版。另外只解析「值」：不讀公式、HTML、樣式等內容，縮小解析範圍，
                    //   也避免把公式字串帶進 CSV。
                    const parsedWorkbook = XLSX.read(fullArrayBufferData, {
                        type: 'array',
                        cellFormula: false,
                        cellHTML: false,
                        cellStyles: false,
                        bookVBA: false
                    });
                    const firstSheetNameString = parsedWorkbook.SheetNames[0];

                    if (!firstSheetNameString)
                    {
                        setIsFileUploading(false);
                        messageApi.error(
                            translate('step1.error_excel_no_sheet', 'Excel 檔案中找不到任何工作表！')
                        );
                        return;
                    }

                    const convertedCsvTextContent = XLSX.utils.sheet_to_csv(parsedWorkbook.Sheets[firstSheetNameString]);
                    const convertedCsvFileNameString = targetFileObj.name.replace(/\.(xlsx|xls)$/i, '.csv');

                    // 送給後端與後續流程 (Step4_Result.tsx 以 `.text()` 讀取) 一律採轉換後的 CSV 內容，
                    // 不再保留原始 Excel 二進位，確保「畫面預覽」與「實際送給後端的內容」兩者一致。
                    setDataFileAction(
                        new File([new TextEncoder().encode(convertedCsvTextContent)], convertedCsvFileNameString, { type: 'text/csv' })
                    );

                    // ★ 新增：記錄本次上傳診斷快照，供發生 API 錯誤時一併附上回報
                    setLastUploadDiagnosticsAction({
                        fileName: targetFileObj.name,
                        detectedEncoding: 'xlsx',
                        wasReencoded: true
                    });

                    runPapaParseOnCsvText(convertedCsvTextContent, targetFileObj.name);
                })
                .catch((excelParseErrorObj: Error) =>
                {
                    setIsFileUploading(false);
                    messageApi.error(
                        translate('step1.error_excel_parse_failed', { error: excelParseErrorObj.message, defaultValue: `Excel 檔案解析失敗：${excelParseErrorObj.message}` })
                    );
                });

            return false;
        }

        // ★ 修正: 使用者反映「現在只能讀取 Big5 的 CSV，其他類型都會出現亂碼」，根因與修正
        // 說明詳見上方 detectCsvBytesEncoding／decodeCsvBytesToText 之函數註解。
        targetFileObj.arrayBuffer()
            .then((fullArrayBufferData) =>
            {
                const fullBytesArray = new Uint8Array(fullArrayBufferData);
                const detectedEncodingLabel = detectCsvBytesEncoding(fullBytesArray);
                const decodedCsvTextContent = decodeCsvBytesToText(fullBytesArray, detectedEncodingLabel);

                const isEncodingAlreadyBackendCompatible = BACKEND_NATIVELY_SUPPORTED_CSV_ENCODINGS.has(detectedEncodingLabel);

                // 後端已支援的編碼：原始檔案原樣送出，不做任何轉換 (維持原本位元組內容與行為)。
                // 其餘編碼：以偵測到的編碼解碼出的正確文字，重新編碼為 UTF-8 位元組，包成新的
                // File 物件取代原始檔案送出，確保後端一定落在其判斷式的第一順位 (utf-8) 正確解出。
                const fileObjectToUpload = isEncodingAlreadyBackendCompatible
                    ? targetFileObj
                    : new File([new TextEncoder().encode(decodedCsvTextContent)], targetFileObj.name, { type: 'text/csv' });

                setDataFileAction(fileObjectToUpload);

                // ★ 新增：記錄本次上傳診斷快照，供發生 API 錯誤時一併附上回報
                setLastUploadDiagnosticsAction({
                    fileName: targetFileObj.name,
                    detectedEncoding: detectedEncodingLabel,
                    wasReencoded: !isEncodingAlreadyBackendCompatible
                });

                if (!isEncodingAlreadyBackendCompatible)
                {
                    messageApi.info(
                        translate('step1.encoding_auto_converted', { encoding: detectedEncodingLabel.toUpperCase(), defaultValue: `偵測到檔案編碼為 ${detectedEncodingLabel.toUpperCase()}，已自動轉換為 UTF-8 後上傳` })
                    );
                }

                // 資料預覽表格一併採用偵測到的正確編碼解碼出的文字內容，確保「畫面預覽」與
                // 「實際送給後端處理的內容」兩者一致，不會有一邊正常、一邊亂碼的狀況。
                runPapaParseOnCsvText(decodedCsvTextContent, targetFileObj.name);
            })
            .catch((encodingDetectErrorObj: Error) =>
            {
                setIsFileUploading(false);
                messageApi.error(
                    translate('step1.error_encoding_detect_failed', { error: encodingDetectErrorObj.message, defaultValue: `檔案編碼偵測失敗：${encodingDetectErrorObj.message}` })
                );
            });

        // 回傳 false 阻斷 Antd 預設上傳機制
        return false;
    };

    /**
     * 函數名稱: handleClear
     * 函數功能: 清除目前已載入之資料集與全域 Store 中的檔案快取，還原至初始拖頁上傳狀態。
     */
    const handleClear = (): void => 
    {
        // 呼叫 Action 清空 WorkspaceStore 中之檔案相關資料
        clearFileDataAction();

        messageApi.success(
            translate('step1.clear_success')
        );
    };

    // 依據全域 Store 中儲存之欄位名稱陣列，動態產生 Ant Design Table 所需之 columns 配置
    const dataTableColumnsConfig = datasetColumnsList.map(
        (columnNameString) => 
        (
            {
                title: columnNameString,
                dataIndex: columnNameString,
                key: columnNameString,
                ellipsis: true, // 若內容過長以刪節號顯示
            }
        )
    );

    // 從全域 Store 截取前 UI_CARD_PREVIEW_ROW_LIMIT (5) 筆資料，供前端表格預覽展示
    const displayPreviewRowsList = datasetPreviewRowsList.slice(0, UI_CARD_PREVIEW_ROW_LIMIT);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* 依據 isDatasetLoadedStatus 條件渲染：未載入時顯示上傳區塊，已載入時顯示資料預覽與模式選擇 */}
            {!isDatasetLoadedStatus ? (
                <>
                    <Card variant="borderless" style={{ background: token.colorBgContainer, borderRadius: 12 }}>
                        {/* 將原本的 message 改為 title 以修正 AntD Warning */}
                        <Alert 
                            title={translate('step1.upload_title')} 
                            description={translate('step1.upload_desc')} 
                            type="info" 
                            showIcon 
                            style={{ marginBottom: 24 }}
                        />

                        <Spin spinning={isFileUploading} description="解析檔案中...">
                            {/* Ant Design Dragger 拖曳上傳區塊 */}
                            <Dragger 
                                name="file" 
                                multiple={false} 
                                accept=".csv, .xlsx, .xls"
                                beforeUpload={handleFileUpload}
                                showUploadList={false} // 不顯示預設之上傳列表 (因採自訂解析與預覽流程)
                                disabled={isFileUploading}
                                style={{ padding: '40px 0', background: isDarkModeActive ? '#141414' : '#fafafa' }}
                            >
                                <p className="ant-upload-drag-icon">
                                    <InboxOutlined style={{ color: token.colorPrimary, fontSize: 48 * fontSizeScaleFactor }} />
                                </p>

                                <Title level={4} style={{ marginTop: 16 }}>
                                    {translate('step1.drag_text')}
                                </Title>

                                <Text type="secondary">
                                    {translate('step1.drag_hint')}
                                </Text>
                                <br />
                                <Text type="secondary">
                                    {translate('step1.upload_limit_hint')}
                                </Text>
                            </Dragger>
                        </Spin>
                    </Card>
                </>
            ) : (
                <>
                    {/* 資料集已就緒提示 Banner (將原本的 message 改為 title 以修正 AntD Warning) */}
                    <Alert 
                        title={
                            <Space>
                                <CheckCircleFilled style={{ color: '#52c41a' }} />
                                <span style={{ fontWeight: 600 }}>{translate('step1.dataset_ready')}</span>
                            </Space>
                        }
                        description={translate('step1.dataset_desc')}
                        type="success"
                        style={{ border: `1px solid #b7eb8f` }}
                    />

                    {/* 預覽資料表格卡片 */}
                    <Card 
                        title={
                            <Space>
                                <FileExcelOutlined style={{ color: '#52c41a', fontSize: 18 * fontSizeScaleFactor }} />
                                <span>{translate('step1.current_file')} <Text strong>{uploadedFileName || 'dataset.csv'}</Text></span>
                            </Space>
                        } 
                        extra={
                            <Popconfirm 
                                title={translate('step1.clear_confirm')} 
                                onConfirm={handleClear} 
                                okText={translate('step1.btn_clear')} 
                                cancelText={translate('step1.btn_cancel')}
                            >
                                <Button danger icon={<DeleteOutlined />}>{translate('step1.reupload')}</Button>
                            </Popconfirm>
                        }
                        variant="borderless" 
                        style={{ background: token.colorBgContainer }}
                        styles={{ body: { padding: 0 } }}
                    >
                        <div style={{ padding: '16px 24px', background: isDarkModeActive ? '#1d1d1d' : '#f8fafc', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                            <Text strong style={{ fontSize: token.fontSize, color: token.colorTextSecondary }}>
                                {translate('step1.preview_title', { count: displayPreviewRowsList.length })}
                            </Text>
                        </div>

                        <Table 
                            dataSource={displayPreviewRowsList} 
                            columns={dataTableColumnsConfig} 
                            pagination={false} 
                            rowKey={(dataRowRecordItem) => JSON.stringify(dataRowRecordItem)}
                            size="small"
                            scroll={{ x: 'max-content' }}
                            style={{ background: isDarkModeActive ? '#141414' : '#fff' }}
                        />
                    </Card>

                    {/* 脫敏保護模式選擇卡片 */}
                    <Card variant="borderless" style={{ background: token.colorBgContainer }}>
                        <div style={{ fontWeight: 600, fontSize: 16 * fontSizeScaleFactor, marginBottom: '16px', color: token.colorText }}>
                            {translate('step1.select_mode')}
                        </div>

                        <Radio.Group 
                            onChange={(radioChangeEventObj) => setPrivacyModeAction(radioChangeEventObj.target.value)} 
                            value={currentPrivacyMode} 
                            style={{ width: '100%' }}
                        >
                            {/* ★ 修正：加入 display: 'flex' 與 alignItems: 'stretch' 確保左右等高 */}
                            <Row gutter={16} style={{ display: 'flex', alignItems: 'stretch' }}>
                                {/* K-Anonymity 選項 */}
                                <Col span={12} style={{ display: 'flex' }}>
                                    <Radio.Button 
                                        value="k-anonymity" 
                                        className="privacy-mode-btn"
                                        style={{ flex: 1 }} // 讓按鈕填滿整個 Col 的高度
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                            <SafetyCertificateOutlined style={{ fontSize: 24 * fontSizeScaleFactor, color: currentPrivacyMode === 'k-anonymity' ? token.colorPrimary : token.colorTextSecondary }} />
                                            <span style={{ fontSize: 16 * fontSizeScaleFactor, fontWeight: 'bold' }}>{translate('step1.k_anon_title')}</span>
                                            <Tooltip title={translate('step1.k_anon_hint')} placement="top">
                                                <QuestionCircleOutlined
                                                    style={{ fontSize: 14 * fontSizeScaleFactor, color: token.colorTextDescription }}
                                                    onClick={(mouseClickEvent) => mouseClickEvent.stopPropagation()}
                                                />
                                            </Tooltip>
                                        </div>

                                        <div style={{ fontSize: 13 * fontSizeScaleFactor, color: token.colorTextDescription, whiteSpace: 'normal', lineHeight: 1.5, textAlign: 'left' }}>
                                            {translate('step1.k_anon_desc')}
                                        </div>
                                    </Radio.Button>
                                </Col>

                                {/* Differential Privacy 選項 */}
                                <Col span={12} style={{ display: 'flex' }}>
                                    <Radio.Button 
                                        value="differential-privacy" 
                                        className="privacy-mode-btn"
                                        style={{ flex: 1 }} // 讓按鈕填滿整個 Col 的高度
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                            <CodeSandboxOutlined style={{ fontSize: 24 * fontSizeScaleFactor, color: currentPrivacyMode === 'differential-privacy' ? token.colorPrimary : token.colorTextSecondary }} />
                                            <span style={{ fontSize: 16 * fontSizeScaleFactor, fontWeight: 'bold' }}>{translate('step1.dp_title')}</span>
                                            <Tooltip title={translate('step1.dp_hint')} placement="top">
                                                <QuestionCircleOutlined
                                                    style={{ fontSize: 14 * fontSizeScaleFactor, color: token.colorTextDescription }}
                                                    onClick={(mouseClickEvent) => mouseClickEvent.stopPropagation()}
                                                />
                                            </Tooltip>
                                        </div>

                                        <div style={{ fontSize: 13 * fontSizeScaleFactor, color: token.colorTextDescription, whiteSpace: 'normal', lineHeight: 1.5, textAlign: 'left' }}>
                                            {translate('step1.dp_desc')}
                                        </div>
                                    </Radio.Button>
                                </Col>
                            </Row>
                        </Radio.Group>

                        {/* 混合運用提示: 說明 K-匿名化與差分隱私並非互斥、可依需求結合運用 (規範對照: 修改建議四-4) */}
                        <div
                            style={{
                                marginTop: 16,
                                padding: '10px 12px',
                                background: token.colorFillTertiary,
                                borderRadius: 6,
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 8
                            }}
                        >
                            <InfoCircleOutlined style={{ marginTop: 2, color: token.colorPrimary, fontSize: 14 * fontSizeScaleFactor }} />
                            <span style={{ fontSize: 12.5 * fontSizeScaleFactor, color: token.colorTextSecondary, lineHeight: 1.5 }}>
                                {translate('step1.combined_usage_hint')}
                            </span>
                        </div>
                    </Card>
                    
                    {/* 前往下一步 (Step 2) 按鈕 */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                        <Button 
                            type="primary" 
                            size="large" 
                            onClick={executeNextStepAction}
                            disabled={!currentPrivacyMode}
                        >
                            {translate('step1.next_mapping')}
                        </Button>
                    </div>
                </>
            )}

            {/* 元件專屬樣式覆寫 */}
            <style>{`
                .ant-table-thead > tr > th {
                    background: ${isDarkModeActive ? '#262626' : '#fafafa'} !important;
                    color: ${token.colorTextSecondary} !important;
                }
                .privacy-mode-btn {
                    /* ★ 修正：將 height 改為 100% 確保填滿容器高度 */
                    height: 100% !important;
                    width: 100% !important;
                    padding: 20px !important;
                    border-radius: 12px !important;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    transition: all 0.3s ease;
                }
                .ant-radio-button-wrapper-checked.privacy-mode-btn {
                    border-color: ${token.colorPrimary} !important;
                    background: ${isDarkModeActive ? 'rgba(63, 81, 181, 0.15)' : 'rgba(63, 81, 181, 0.05)'} !important;
                }
                .ant-radio-button-wrapper-checked.privacy-mode-btn::before {
                    background-color: transparent !important;
                }
            `}</style>
        </div>
    );
}