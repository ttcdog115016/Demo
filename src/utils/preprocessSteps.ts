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
import { sha3Hex } from './sha3';
import { normalizePreprocessHashAlgorithm, PREPROCESS_BOOLEAN_TRUE_VALUES, PREPROCESS_BOOLEAN_FALSE_VALUES } from './preprocessConfig';
import { getServerHashPreview, SERVER_HASH_PREVIEW_FAILED } from './serverHashPreview';

const DEFAULT_PREVIEW_SYMBOL = '-';
const HASH_PREVIEW_LENGTH = 16;
/**
 * ★ 2026-10-28：「伺服器預設鹽值」的雜湊預覽改顯示說明文字。伺服器鹽值（.env OPEN_PETS_DEFAULT_SALT）不應、也不會傳到瀏覽器，
 *   先前以不加鹽計算的預覽與實際輸出不同，容易誤導；改為只標示處理方式（比照 K-匿名識別欄位雜湊的預覽）。
 */
export const SERVER_SALT_HASH_PREVIEW_TEXT = '（雜湊後的代碼，依伺服器鹽值計算）';
/** ★ 2026-11-04：伺服器鹽值改由後端預覽端點計算（見 serverHashPreview.ts），結果回來前顯示此文字；取不到時才退回上面的說明文字 */
export const SERVER_SALT_HASH_PENDING_TEXT = '（計算中…）';

/**
 * ★ 2026-10-02：「系統隨機鹽值」——本次頁面載入時以密碼學亂數產生一次（32 bytes），之後同一個值在本次操作內
 *   雜湊結果一致（預覽穩定、可在同批資料內比對），重新整理頁面即換新且不保存，無法跨批次比對也無法被反推。
 *   取代原本的「目前時間戳」：時間戳可被猜測、且每格呼叫 Date.now() 都不同，會讓同一值在同批資料內也對不起來。
 */
const generateSessionRandomSalt = (): string => {
    try {
        const randomBytes = new Uint8Array(32);
        globalThis.crypto.getRandomValues(randomBytes);
        return Array.from(randomBytes).map((byteValue) => byteValue.toString(16).padStart(2, '0')).join('');
    } catch {
        return CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex);
    }
};
const SESSION_RANDOM_HASH_SALT = generateSessionRandomSalt();
const FULLWIDTH_CHAR_CODE_OFFSET = 0xFEE0;   // 全形英數字與對應半形字元間之 Unicode 編碼差值
// 後端「全形轉半形」只轉英數字與空白（app/engines/preprocess/actions/strings.py 的 _CONVERTIBLE），標點符號不轉
const FULLWIDTH_ALNUM_PATTERN = /[０-９Ａ-Ｚａ-ｚ]/g;
const FULLWIDTH_SPACE_PATTERN = /\u3000/g;
// 後端「字串去空白」認定的空白字元（strings.py 的 WHITESPACE_CHARS）：空白、Tab、CR、LF、全形空白、零寬字元、BOM
const BACKEND_WHITESPACE_ALTERNATION = '(?:\\u0020|\\u0009|\\u000D|\\u000A|\\u3000|\\u200B|\\u200C|\\u200D|\\uFEFF)';
const BACKEND_WHITESPACE_ALL_PATTERN = new RegExp(BACKEND_WHITESPACE_ALTERNATION, 'g');
const BACKEND_WHITESPACE_EDGES_PATTERN = new RegExp(`^${BACKEND_WHITESPACE_ALTERNATION}+|${BACKEND_WHITESPACE_ALTERNATION}+$`, 'g');

/**
 * 函數名稱: applyPreprocessStep
 * 函數功能: 依據選定之單一動作與參數集合，對字串執行對應之預處理轉換 (字串去空白、截斷、相對保留與
 *           截斷、型態轉換、文字正規化、上下界截斷、雜湊或正則掃描與替換)。
 *
 * ★ 2026-10-27：資料預先處理改由後端 /api/v1/preprocess 實際執行（見 utils/preprocessConfig.ts），
 *   此處的畫面預覽一併改為與後端相同的規則（app/engines/preprocess/actions/*.py），預覽才不會與結果不符。
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
            return trimModeStr === 'all' ? cellValueStr.replace(BACKEND_WHITESPACE_ALL_PATTERN, '') : cellValueStr.replace(BACKEND_WHITESPACE_EDGES_PATTERN, '');
        }

        case 'slice':
        {
            // 後端：從指定的一側「刪掉」count 個字元；長度不足時整格變成空字串
            const sliceDirectionStr = String(actionParamsDict.direction || 'left');
            const sliceCountNum = Math.max(0, Number(actionParamsDict.count) || 0);
            const characterList = Array.from(cellValueStr); // 以字元計（中文一字算一個）

            if (sliceCountNum === 0) return cellValueStr;
            if (sliceCountNum >= characterList.length) return '';

            return sliceDirectionStr === 'left'
                ? characterList.slice(sliceCountNum).join('')
                : characterList.slice(0, characterList.length - sliceCountNum).join('');
        }

        case 'anchor_truncate':
        {
            // 後端：以錨點為基準，只裁「選定方向那一側」，保留含錨點在內的 keep 個字元；錨點另一側完全不動。
            //   前方（before）取第一個錨點：保留錨點與其前 keep−1 字，再接上錨點後的全部內容
            //   後方（after）取最後一個錨點：保留錨點前的全部內容，再接上錨點與其後 keep−1 字
            //   keep 為 0 時錨點本身也刪去；找不到錨點時整格不動
            const anchorCharStr = String(actionParamsDict.anchor || '');
            const anchorDirectionStr = String(actionParamsDict.direction || 'front');
            const keepCountNum = Math.max(0, Number(actionParamsDict.keepCount) || 0);

            if (!anchorCharStr) return cellValueStr;

            if (anchorDirectionStr === 'front')
            {
                const anchorIndexNum = cellValueStr.indexOf(anchorCharStr);
                if (anchorIndexNum === -1) return cellValueStr;
                const beforeAndAnchorStr = cellValueStr.slice(0, anchorIndexNum + 1);
                const keptStr = keepCountNum > 0 ? Array.from(beforeAndAnchorStr).slice(-keepCountNum).join('') : '';
                return keptStr + cellValueStr.slice(anchorIndexNum + 1);
            }

            const anchorIndexNum = cellValueStr.lastIndexOf(anchorCharStr);
            if (anchorIndexNum === -1) return cellValueStr;
            return cellValueStr.slice(0, anchorIndexNum) + Array.from(cellValueStr.slice(anchorIndexNum)).slice(0, keepCountNum).join('');
        }

        case 'type_cast':
        {
            const targetTypeStr = String(actionParamsDict.targetType || 'integer');

            if (targetTypeStr === 'boolean')
            {
                // 後端：依對照表轉成 True／False（比對忽略大小寫），表外的值原樣不動
                const normalizedValueStr = cellValueStr.toLowerCase();
                if ((PREPROCESS_BOOLEAN_TRUE_VALUES as readonly string[]).includes(normalizedValueStr)) return 'True';
                if ((PREPROCESS_BOOLEAN_FALSE_VALUES as readonly string[]).includes(normalizedValueStr)) return 'False';
                return cellValueStr;
            }

            // 後端：只取出數字、小數點與負號（"25歲" → 25、"NT$3,000" → 3000），取不出數字的原樣不動
            const digitsOnlyStr = Array.from(cellValueStr).filter((characterStr) => '0123456789.-'.includes(characterStr)).join('');
            const parsedNumber = digitsOnlyStr === '' ? NaN : Number(digitsOnlyStr);
            if (!Number.isFinite(parsedNumber)) return cellValueStr;

            if (targetTypeStr === 'float')
            {
                return Number.isInteger(parsedNumber) ? `${parsedNumber}.0` : String(parsedNumber); // Python float 輸出整數值帶 .0
            }

            // 整數：四捨五入（後端 rounding=round，ROUND_HALF_UP：-2.5 → -3）。
            // ★ 修正（沿用）：先以浮點數解析再四捨五入，避免「27.8」被當成「278」。
            const roundedIntNum = Math.sign(parsedNumber) * Math.round(Math.abs(parsedNumber));
            return String(Object.is(roundedIntNum, -0) ? 0 : roundedIntNum);
        }

        case 'normalize':
        {
            let normalizedResultStr = cellValueStr;

            if (actionParamsDict.caseMode === 'upper') normalizedResultStr = normalizedResultStr.toUpperCase();
            else if (actionParamsDict.caseMode === 'lower') normalizedResultStr = normalizedResultStr.toLowerCase();

            if (actionParamsDict.widthMode === 'full_to_half')
            {
                normalizedResultStr = normalizedResultStr
                    .replace(FULLWIDTH_ALNUM_PATTERN, (fullWidthCharStr) => String.fromCharCode(fullWidthCharStr.charCodeAt(0) - FULLWIDTH_CHAR_CODE_OFFSET))
                    .replace(FULLWIDTH_SPACE_PATTERN, ' ');
            }

            return normalizedResultStr;
        }

        case 'clamp':
        {
            const parsedNumericValue = Number(cellValueStr);
            if (cellValueStr.trim() === '' || !Number.isFinite(parsedNumericValue)) return cellValueStr;

            const lowerBoundNum = actionParamsDict.min !== undefined && actionParamsDict.min !== '' ? Number(actionParamsDict.min) : -Infinity;
            const upperBoundNum = actionParamsDict.max !== undefined && actionParamsDict.max !== '' ? Number(actionParamsDict.max) : Infinity;

            if (parsedNumericValue < lowerBoundNum) return String(lowerBoundNum);
            if (parsedNumericValue > upperBoundNum) return String(upperBoundNum);
            return cellValueStr;
        }

        case 'hash':
        {
            try
            {
                // 後端 hash_mask：有鹽值走 HMAC（鹽值為金鑰），沒有就直接雜湊；演算法 sha256／sha3-256／sha3-512
                const algorithmStr = normalizePreprocessHashAlgorithm(actionParamsDict.algorithm);
                const seedModeStr = String(actionParamsDict.seedMode || 'none');

                let saltKeyStr = '';
                if (seedModeStr === 'fixed') saltKeyStr = String(actionParamsDict.seedValue || '');
                else if (seedModeStr === 'random' || seedModeStr === 'timestamp') saltKeyStr = SESSION_RANDOM_HASH_SALT;
                // 'none'（使用伺服器預設鹽值）：前端拿不到伺服器鹽值，由後端預覽端點以同一把鹽計算（★ 2026-11-04）
                else
                {
                    const serverHashEntry = getServerHashPreview(cellValueStr, algorithmStr);
                    if (serverHashEntry === undefined) return SERVER_SALT_HASH_PENDING_TEXT;
                    if (serverHashEntry === SERVER_HASH_PREVIEW_FAILED) return SERVER_SALT_HASH_PREVIEW_TEXT;
                    return serverHashEntry.substring(0, HASH_PREVIEW_LENGTH) + '...';
                }

                let calculatedHashResult = '';
                if (algorithmStr === 'sha3-256') calculatedHashResult = sha3Hex(cellValueStr, 256, saltKeyStr || null);
                else if (algorithmStr === 'sha3-512') calculatedHashResult = sha3Hex(cellValueStr, 512, saltKeyStr || null);
                else calculatedHashResult = (saltKeyStr ? CryptoJS.HmacSHA256(cellValueStr, saltKeyStr) : CryptoJS.SHA256(cellValueStr)).toString();

                // 為了 UI 預覽美觀，擷取前 16 碼並加上刪節號（實際輸出為完整十六進位字串）
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
                // 替換文字一律當純文字（不解讀 $1 等群組參照），與後端送出的 replacement 一致
                return cellValueStr.replace(regexMatcherInstance, () => placeholderStr);
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
