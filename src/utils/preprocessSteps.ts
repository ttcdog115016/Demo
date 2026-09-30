/**
 * ============================================================================
 * 檔案名稱 (File): preprocessSteps.ts
 * 模組功能 (Description): 「資料預先處理」各策略的畫面預覽運算（純函式，不依賴 React 或 Store）。
 * ============================================================================
 * ★ 2026-09-30：原本 Step2_Mapping.tsx 與 KAnonymityMapping.tsx 各有一份幾乎相同的
 *   applyPreprocessStep／applyPreprocessSteps（約 180 行），且已開始不同步（雜湊演算法判斷、
 *   預設值）。抽到這裡共用一份，並補上單元測試（utils/__tests__/preprocessSteps.test.ts）。
 */
import CryptoJS from 'crypto-js';
import type { PreprocessingRule } from '../store/useWorkspaceStore';

const DEFAULT_PREVIEW_SYMBOL = '-';
const HASH_PREVIEW_LENGTH = 16;
const FULLWIDTH_CHAR_CODE_OFFSET = 0xFEE0;   // 全形字元 (！~～) 與對應半形字元間之 Unicode 編碼差值
const FULLWIDTH_SPACE_CHAR_CODE = 0x3000;    // 全形空白字元碼

/**
 * 函數名稱: applyPreprocessStep
 * 函數功能: 依據選定之單一動作與參數集合，對字串執行對應之預處理轉換 (字串去空白、截斷、相對保留與
 *           截斷、型態轉換、文字正規化、上下界截斷、雜湊或正則掃描與替換)。
 *
 * 輸入參數 (Input):
 *   - cellValueStr (string): 待處理之字串數值
 *   - stepItemRecord (PreprocessingRule): 單一預處理步驟 (動作代碼與其參數集合)
 * 返回值 (Return):
 *   - string: 經過該步驟轉換後之字串結果
 * 呼叫關係 (Call Relations): 由 applyPreprocessSteps 依序呼叫，組成完整轉換鏈
 *
 * 規範對照: 符合規範 a), c) 使用清晰明確之變數名稱
 */
export const applyPreprocessStep = (cellValueStr: string, stepItemRecord: PreprocessingRule): string =>
{
    const { action: actionTypeStr, params: actionParamsDict } = stepItemRecord;

    switch (actionTypeStr)
    {
        case 'trim':
        {
            const trimModeStr = String(actionParamsDict.mode || 'edges');
            return trimModeStr === 'all' ? cellValueStr.replace(/\s+/g, '') : cellValueStr.trim();
        }

        case 'slice':
        {
            const sliceDirectionStr = String(actionParamsDict.direction || 'left');
            const sliceCountNum = Math.max(0, Number(actionParamsDict.count) || 0);

            if (sliceCountNum === 0) return cellValueStr;

            return sliceDirectionStr === 'left'
                ? cellValueStr.slice(sliceCountNum)
                : cellValueStr.slice(0, Math.max(0, cellValueStr.length - sliceCountNum));
        }

        case 'anchor_truncate':
        {
            const anchorCharStr = String(actionParamsDict.anchor || '');
            const anchorDirectionStr = String(actionParamsDict.direction || 'front');
            const keepCountNum = Math.max(0, Number(actionParamsDict.keepCount) || 0);

            if (!anchorCharStr) return cellValueStr; // 未設定錨點字元，視同不執行

            const anchorIndexNum = anchorDirectionStr === 'front' ? cellValueStr.indexOf(anchorCharStr) : cellValueStr.lastIndexOf(anchorCharStr);

            if (anchorIndexNum === -1) return cellValueStr; // 找不到錨點字元，不執行任何動作

            if (keepCountNum === 0) return ''; // 總保留字數為 0，僅保留錨點且不含任何鄰近字元時視同全部截斷

            const extraKeepCountNum = keepCountNum - 1; // 總保留字數含錨點本身，鄰近字元數需扣除錨點的 1 個字

            if (anchorDirectionStr === 'front')
            {
                // 前方：由前往後搜尋首個錨點，僅保留錨點前緊鄰字元 (含錨點本身，總計 N 字)，其餘字元 (含錨點後方) 全數截斷
                const frontPartStr = cellValueStr.slice(Math.max(0, anchorIndexNum - extraKeepCountNum), anchorIndexNum);
                return frontPartStr + anchorCharStr;
            }

            // 後方：從後搜尋首個錨點，僅保留錨點後緊鄰字元 (含錨點本身，總計 N 字)，其餘字元 (含錨點前方) 全數截斷
            const backPartStr = cellValueStr.slice(anchorIndexNum + 1, Math.min(cellValueStr.length, anchorIndexNum + 1 + extraKeepCountNum));
            return anchorCharStr + backPartStr;
        }

        case 'type_cast':
        {
            const targetTypeStr = String(actionParamsDict.targetType || 'integer');

            if (targetTypeStr === 'boolean')
            {
                const normalizedValueStr = cellValueStr.trim().toLowerCase();
                return ['true', '1', 'yes', 'y'].includes(normalizedValueStr) ? 'true' : 'false';
            }

            if (targetTypeStr === 'float')
            {
                const cleanedFloatStr = cellValueStr.replace(/[^0-9.-]/g, '');
                const parsedFloatNum = parseFloat(cleanedFloatStr);
                return Number.isNaN(parsedFloatNum) ? '0' : String(parsedFloatNum);
            }

            // ★ 修正: 原本以正則表達式移除所有非數字字元 (含小數點) 再轉整數，會將「27.8」誤判為
            //   字串「278」再轉換，而非先解析為浮點數、四捨五入後才取整數，導致轉換結果嚴重失真
            //   (例如 27.8 → 278，而非合理的 28)。改為先以浮點數解析，再四捨五入取最接近之整數。
            const cleanedFloatForIntStr = cellValueStr.replace(/[^0-9.-]/g, '');
            const parsedFloatForIntNum = parseFloat(cleanedFloatForIntStr);
            const roundedIntNum = Math.round(parsedFloatForIntNum);
            return Number.isNaN(roundedIntNum) ? '0' : String(roundedIntNum);
        }

        case 'normalize':
        {
            let normalizedResultStr = cellValueStr;

            if (actionParamsDict.widthMode === 'full_to_half')
            {
                normalizedResultStr = normalizedResultStr
                    .replace(/[！-～]/g, (fullWidthCharStr) => String.fromCharCode(fullWidthCharStr.charCodeAt(0) - FULLWIDTH_CHAR_CODE_OFFSET))
                    .replace(new RegExp(String.fromCharCode(FULLWIDTH_SPACE_CHAR_CODE), 'g'), ' ');
            }

            if (actionParamsDict.caseMode === 'upper') normalizedResultStr = normalizedResultStr.toUpperCase();
            else if (actionParamsDict.caseMode === 'lower') normalizedResultStr = normalizedResultStr.toLowerCase();

            return normalizedResultStr;
        }

        case 'clamp':
        {
            const parsedNumericValue = parseFloat(cellValueStr);
            if (Number.isNaN(parsedNumericValue)) return cellValueStr;

            const lowerBoundNum = actionParamsDict.min !== undefined ? Number(actionParamsDict.min) : -Infinity;
            const upperBoundNum = actionParamsDict.max !== undefined ? Number(actionParamsDict.max) : Infinity;

            return String(Math.min(upperBoundNum, Math.max(lowerBoundNum, parsedNumericValue)));
        }

        case 'hash':
        {
            try
            {
                const algorithmStr = String(actionParamsDict.algorithm || 'SHA3-256');
                const seedModeStr = String(actionParamsDict.seedMode || 'none');

                let seedSuffixStr = '';
                if (seedModeStr === 'fixed') seedSuffixStr = String(actionParamsDict.seedValue || '');
                else if (seedModeStr === 'timestamp') seedSuffixStr = String(Date.now());

                const hashInputStr = cellValueStr + seedSuffixStr;

                // ★ 2026-09-30：Step2 與 K-匿名頁原本各有一份此函式且雜湊判斷不同步——畫面選項實際存的值是
                //   'SHA256'／'SHA512'，Step2 卻只比對 'SHA3-512'，導致選 512 時 Step2 預覽仍用 256。統一為：
                //   'SHA512'／'SHA3-512' → 512，'md5' → MD5，其餘 → 256。僅影響畫面預覽，不影響送給後端的設定。
                let calculatedHashResult = '';
                if (algorithmStr === 'md5') calculatedHashResult = CryptoJS.MD5(hashInputStr).toString();
                else if (algorithmStr === 'SHA512' || algorithmStr === 'SHA3-512') calculatedHashResult = CryptoJS.SHA512(hashInputStr).toString();
                else calculatedHashResult = CryptoJS.SHA256(hashInputStr).toString();

                // 為了 UI 預覽美觀，擷取前 16 碼並加上刪節號
                return calculatedHashResult.substring(0, HASH_PREVIEW_LENGTH) + '...';
            }
            catch (hashingErrorExecution)
            {
                console.error('Hashing execution error:', hashingErrorExecution);
                return 'Hash Error';
            }
        }

        case 'regex_replace':
        {
            const regexPatternStr = String(actionParamsDict.pattern || '');
            const placeholderStr = actionParamsDict.placeholder !== undefined ? String(actionParamsDict.placeholder) : '***';

            if (!regexPatternStr) return cellValueStr;

            try
            {
                const regexMatcherInstance = new RegExp(regexPatternStr, 'g');
                return cellValueStr.replace(regexMatcherInstance, placeholderStr);
            }
            catch
            {
                return cellValueStr; // 無效正則表達式，維持原樣
            }
        }

        default:
            return cellValueStr; // 'none' 或未知動作代碼，不執行任何轉換
    }
};

/**
 * 函數名稱: applyPreprocessSteps
 * 函數功能: 依序套用同一欄位之多道預處理策略 (由上而下)，上一步驟之輸出即為下一步驟之輸入，
 *           以支援單一欄位需要組合多種清洗手法的情境 (如先去除前後空白，再擷取特定字元前之文字)。
 *
 * 輸入參數 (Input):
 *   - cellValueData (unknown): 原始資料儲存格數值
 *   - stepsArray (PreprocessingRule[]): 依序執行之預處理策略清單
 * 返回值 (Return):
 *   - string: 依序套用所有策略後之最終字串結果
 * 呼叫關係 (Call Relations): 於即時預覽欄位呈現時被呼叫
 */
export const applyPreprocessSteps = (cellValueData: unknown, stepsArray: PreprocessingRule[]): string =>
{
    if (cellValueData == null || cellValueData === '')
    {
        return DEFAULT_PREVIEW_SYMBOL;
    }

    // ★ 修正: 「雜湊」為不可逆之最終處理，一旦套用即視為處理鏈終點；即使因匯入設定檔等途徑，
    //   使雜湊步驟之後仍存在其他步驟，此處亦不再繼續套用，避免對雜湊後之字串做無意義的二次轉換
    //   (對應下方 UI 已限制使用者無法於雜湊之後再新增/變更步驟，此處為運算層面的防禦性保護)。
    let accumulatedResultString = String(cellValueData);

    for (const stepItemRecord of stepsArray)
    {
        accumulatedResultString = applyPreprocessStep(accumulatedResultString, stepItemRecord);
        if (stepItemRecord.action === 'hash') break;
    }

    return accumulatedResultString;
};
