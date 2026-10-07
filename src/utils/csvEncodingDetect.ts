/**
 * CSV 編碼偵測與解碼 (由 Step1_Upload.tsx 抽出，方便單元測試)。
 * 背景與修正歷史詳見 Step1_Upload.tsx 檔頭註解。
 */
export const CSV_ENCODING_DETECTION_SAMPLE_BYTES = 65536; // 只取檔案開頭 64KB 做編碼偵測樣本，避免大檔案 (最大 2GB) 因偵測而拖慢效能
// ★ 修正 (2026-10-05，使用者回報同一份 CSV 編輯後再上傳變亂碼，提示「偵測到 WINDOWS-1252」):
//   原本固定砍掉樣本尾端 4 個位元組來避開「被截斷的多位元組字元」，但中文 UTF-8 每字 3 位元組，
//   固定砍 4 個反而經常把前一個中文字切成一半 (實測 64KB 截斷點附近約 1/3 機率)，嚴格解碼失敗後
//   依序退到 windows-1252 (任何位元組都能解出) 而整份亂碼。檔案編輯後大小改變，截斷點位移，
//   因此「原檔正常、改過就亂碼」。改用 TextDecoder 的 stream 模式：尾端不完整的字元會被視為
//   「尚未讀完」而非錯誤；檔案不超過樣本大小時則整份完整驗證。


// 除了 UTF-8／Big5 之外，常見的中文／Windows 匯出編碼候選清單 (依「較常見、較不易與其他候選混淆」排序)，
// 依序嘗試解碼，第一個不拋出例外的即採用；windows-1252 為單位元組編碼、任何位元組皆可解出字元，
// 故實務上作為「其餘候選皆不合法時」的最終備援
export const FALLBACK_LEGACY_ENCODING_CANDIDATES = ['big5', 'gbk', 'shift-jis', 'windows-1252'];

/**
 * 函數名稱: detectByteOrderMark
 * 函數功能: 判斷檔案開頭的 BOM。★ 2026-10-05：支援 UTF-16（Excel「Unicode 文字」存檔即為 UTF-16 LE + BOM；
 *           先前會落到 windows-1252 而整份亂碼）。但 UTF-8 檔案開頭被混入 FF FE 之類的位元組時也長得像
 *           UTF-16 BOM，故另外確認：真正的 UTF-16 CSV 一定有半形逗號／換行，其高位位元組為 0x00，
 *           若 BOM 之後的前 4KB 幾乎沒有 0x00 就不視為 UTF-16（交由後續流程判定為編碼毀損）。
 */
const UTF16_PLAUSIBILITY_SAMPLE_BYTES = 4096;
const UTF16_MIN_ZERO_HIGH_BYTE_RATIO = 0.1;

const isPlausibleUtf16 = (fullBytesArray: Uint8Array, isLittleEndian: boolean): boolean => {
    const sampleEnd = Math.min(fullBytesArray.length, 2 + UTF16_PLAUSIBILITY_SAMPLE_BYTES);
    let codeUnitCount = 0;
    let zeroHighByteCount = 0;
    for (let i = 2; i + 1 < sampleEnd; i += 2) {
        codeUnitCount++;
        const highByte = isLittleEndian ? fullBytesArray[i + 1] : fullBytesArray[i];
        if (highByte === 0x00) zeroHighByteCount++;
    }
    return codeUnitCount > 0 && zeroHighByteCount / codeUnitCount >= UTF16_MIN_ZERO_HIGH_BYTE_RATIO;
};

export const detectByteOrderMark = (fullBytesArray: Uint8Array): 'utf-8-bom' | 'utf-16le' | 'utf-16be' | null => {
    if (fullBytesArray.length >= 3 && fullBytesArray[0] === 0xEF && fullBytesArray[1] === 0xBB && fullBytesArray[2] === 0xBF) {
        return 'utf-8-bom';
    }
    if (fullBytesArray.length >= 2 && fullBytesArray[0] === 0xFF && fullBytesArray[1] === 0xFE && isPlausibleUtf16(fullBytesArray, true)) {
        return 'utf-16le';
    }
    if (fullBytesArray.length >= 2 && fullBytesArray[0] === 0xFE && fullBytesArray[1] === 0xFF && isPlausibleUtf16(fullBytesArray, false)) {
        return 'utf-16be';
    }
    return null;
};

/**
 * 函數名稱: detectCsvBytesEncoding
 * 函數功能: 依 BOM 判斷與「嚴格解碼」(fatal: true) 逐一嘗試候選編碼，偵測位元組陣列的真實文字編碼。
 */
export const detectCsvBytesEncoding = (fullBytesArray: Uint8Array): string => {
    const byteOrderMarkEncodingLabel = detectByteOrderMark(fullBytesArray);
    if (byteOrderMarkEncodingLabel) {
        return byteOrderMarkEncodingLabel;
    }

    const sampleForDetectionArray = fullBytesArray.subarray(0, Math.min(fullBytesArray.length, CSV_ENCODING_DETECTION_SAMPLE_BYTES));
    // 樣本是被截斷的 (檔案大於樣本大小) 時才用 stream 模式，允許尾端出現不完整字元
    const isSampleTruncated = sampleForDetectionArray.length < fullBytesArray.length;
    const isStrictlyDecodable = (encodingLabel: string): boolean => {
        try {
            new TextDecoder(encodingLabel, { fatal: true }).decode(sampleForDetectionArray, { stream: isSampleTruncated });
            return true;
        } catch {
            return false;
        }
    };

    if (isStrictlyDecodable('utf-8')) {
        return 'utf-8';
    }

    for (const candidateEncodingLabel of FALLBACK_LEGACY_ENCODING_CANDIDATES) {
        if (isStrictlyDecodable(candidateEncodingLabel)) {
            return candidateEncodingLabel;
        }
    }

    return 'unknown';
};

/**
 * 函數名稱: decodeCsvBytesToText
 * 函數功能: 依偵測到的編碼標籤，將完整檔案位元組解碼為文字字串；偵測不到已知編碼時，
 *           寬鬆以 UTF-8 解碼作為保底 (可能出現少數替代字元 �，但至少不會讓流程整個卡住)。
 */
export const decodeCsvBytesToText = (fullBytesArray: Uint8Array, detectedEncodingLabel: string): string => {
    if (detectedEncodingLabel === 'utf-8-bom') {
        return new TextDecoder('utf-8').decode(fullBytesArray.subarray(3));
    }
    if (detectedEncodingLabel === 'utf-16le' || detectedEncodingLabel === 'utf-16be') {
        return new TextDecoder(detectedEncodingLabel).decode(fullBytesArray.subarray(2));
    }
    if (detectedEncodingLabel === 'unknown') {
        return new TextDecoder('utf-8').decode(fullBytesArray);
    }
    return new TextDecoder(detectedEncodingLabel).decode(fullBytesArray);
};
