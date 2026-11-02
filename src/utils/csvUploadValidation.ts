import Papa from 'papaparse';
import { createColumnValueStats, addValueToColumnStats, evaluateNumericConflict, evaluateDateConflict, getDominantShape, isDateShape, type ColumnValueStats, type ValueExample } from './backendValueRules';
import { forEachDecodedChunk, DEFAULT_STREAM_CHUNK_BYTES, LARGE_FILE_SAMPLING_BYTES } from './blobStreaming';

/**
 * ============================================================================
 * 檔案名稱 (File): csvUploadValidation.ts
 * 模組功能 (Description): Step1 上傳 CSV 的「編碼混用／毀損」偵測與「標題列」檢查。
 * ★ 2026-10-05 新增：使用者回報「CSV 欄位前面亂加東西會掛掉（亂碼之類）」，手法未釐清。
 *   以 29 種變形檔案（欄位名稱前加字、標題前多一行、混入其他編碼位元組、UTF-16、保留字欄名…）
 *   實測後確認三類問題：
 *   (1) 檔案以 UTF-8（或 Big5）為主，但混入少量其他編碼的位元組（例如從別的檔案複製貼上），
 *       嚴格解碼全部失敗 → 退到 windows-1252（或把 Big5 誤判成 GBK），整份檔案變亂碼，且照樣
 *       送往後端處理。UTF-16 檔案也同樣變亂碼。
 *   (2) 欄位名稱為 constructor／__proto__／toString 等 JavaScript 物件內建屬性名稱時，
 *       全站以「欄位名稱當物件鍵值」查表會取到內建函式，Step2 直接崩潰（steps.map is not a function）。
 *   (3) 標題列前多了說明文字、或有未成對的引號，第一列不再是欄位名稱，整份資料錯位。
 *   本模組只做判斷、回傳結構化結果，訊息顯示由 Step1_Upload.tsx 負責，方便單元測試。
 * ★ 2026-11-02（F12）：約 650 MB 的 CSV 整份解碼成單一字串會超過 WebView2（V8）字串長度上限
 *   （約 5.37 億字元，「Invalid string length」）。各項檢查改為接受 Blob、逐段解碼（見下方
 *   forEachCsvRecordBatch：每段只在「完整資料列」的邊界切開），原本接受字串的函式保留為同一套實作的包裝。
 *   超過 LARGE_FILE_SAMPLING_BYTES（200 MB）的檔案只抽樣檢查前 200 MB（最後一筆不完整的資料列略過）。
 * ============================================================================
 */

// ============================================================================
// ★ 2026-11-02（F12）：CSV Blob 逐段讀取（以完整資料列為單位）
//   不直接用 Papa.parse(blob)：PapaParse 的 FileStreamer 對每一段位元組各自 readAsText，
//   UTF-8 中文字（3 個位元組）剛好被段落邊界切開時會變成替代字元 (U+FFFD)，造成誤判為編碼毀損。
//   這裡改以 TextDecoder stream 模式逐段解碼（blobStreaming.forEachDecodedChunk），再依 RFC 4180 規則
//   （欄位開頭的 " 開啟引號區段、區段內 "" 為跳脫、換行屬於同一筆）找出資料列邊界，每次交出「完整的
//   若干筆資料列」文字，交給 PapaParse／正規表示式處理，結果與一次處理整份文字相同。
// ============================================================================

/** 單筆資料列（例如未成對引號吞掉後面全部內容）超過此字元數時不再等待邊界，直接交出，避免累積成整檔字串 */
const MAX_PENDING_RECORD_CHARS = 64 * 1024 * 1024;

/** 逐段掃描的共用選項（chunkBytes／samplingBytes 主要供測試以小數值驗證跨段邊界與抽樣） */
export interface CsvBlobScanOptions {
    /** 每段讀取的位元組數（預設 8 MB） */
    chunkBytes?: number;
    /** 檔案超過此大小時只檢查前段（預設 LARGE_FILE_SAMPLING_BYTES = 200 MB） */
    samplingBytes?: number;
    /** CSV 分隔字元（預設逗號；Step1 以 detectCsvDelimiterFromHeadText 取得） */
    delimiter?: string;
}

/** 檔案是否大到只抽樣檢查前段 */
export const isCsvBlobSampled = (blob: Blob, samplingBytes: number = LARGE_FILE_SAMPLING_BYTES): boolean => blob.size > samplingBytes;

interface CsvRecordSplitter {
    /** 餵入下一段文字，回傳到目前為止「完整資料列」的部分（沒有完整資料列時為空字串） */
    push: (text: string) => string;
    /** 取出尚未遇到邊界的剩餘文字 */
    takePending: () => string;
    /** 已完成、且非空白的資料列數（含標題列） */
    getCompletedRecordCount: () => number;
}

const createCsvRecordSplitter = (delimiter: string = ','): CsvRecordSplitter => {
    const delimiterCode = (delimiter || ',').charCodeAt(0);
    let pendingText = '';
    let scannedLength = 0;
    let isInsideQuotedField = false;
    let isAtFieldStart = true;
    let pendingQuoteInsideField = false; // 引號區段內的 " 剛好在已讀文字結尾：要看下一個字元才知道是跳脫還是結束
    let isCurrentRecordNonEmpty = false;
    let completedRecordCount = 0;

    const push = (text: string): string => {
        pendingText += text;
        const textLength = pendingText.length;
        let lastBoundaryEnd = -1;
        for (let charIndex = scannedLength; charIndex < textLength; charIndex++) {
            const charCode = pendingText.charCodeAt(charIndex);
            if (pendingQuoteInsideField) {
                pendingQuoteInsideField = false;
                if (charCode === 0x22) continue; // "" 跳脫，仍在引號區段內
                isInsideQuotedField = false;     // 單一 " 結束引號區段，這個字元照一般規則處理
            }
            if (isInsideQuotedField) {
                if (charCode === 0x22) {
                    if (charIndex + 1 >= textLength) pendingQuoteInsideField = true;
                    else if (pendingText.charCodeAt(charIndex + 1) === 0x22) charIndex++;
                    else isInsideQuotedField = false;
                }
                continue;
            }
            if (charCode === 0x0A || charCode === 0x0D) {
                // CR 在已讀文字結尾時先不切：下一段開頭可能是同一個換行的 LF
                if (charCode === 0x0A || (charIndex + 1 < textLength && pendingText.charCodeAt(charIndex + 1) !== 0x0A)) {
                    lastBoundaryEnd = charIndex + 1;
                    if (isCurrentRecordNonEmpty) completedRecordCount++;
                    isCurrentRecordNonEmpty = false;
                }
                isAtFieldStart = true;
                continue;
            }
            isCurrentRecordNonEmpty = true;
            if (charCode === 0x22 && isAtFieldStart) {
                isInsideQuotedField = true;
                isAtFieldStart = false;
                continue;
            }
            isAtFieldStart = charCode === delimiterCode;
        }
        scannedLength = textLength;
        if (lastBoundaryEnd < 0) {
            if (textLength <= MAX_PENDING_RECORD_CHARS) return '';
            lastBoundaryEnd = textLength;
        }
        const completeText = pendingText.slice(0, lastBoundaryEnd);
        pendingText = pendingText.slice(lastBoundaryEnd);
        scannedLength = pendingText.length;
        return completeText;
    };

    const takePending = (): string => {
        const restText = pendingText;
        if (restText.trim() !== '') completedRecordCount++;
        pendingText = '';
        scannedLength = 0;
        return restText;
    };

    return { push, takePending, getCompletedRecordCount: () => completedRecordCount };
};

/**
 * 函數名稱: forEachCsvRecordBatch
 * 函數功能: 逐段解碼 UTF-8 CSV Blob，每次以「完整的若干筆資料列」文字呼叫 onBatch（不會把一筆資料切在兩段）。
 *           dropIncompleteTail 為 true（抽樣切片）時，最後一筆可能被切斷的資料列不交出。
 */
export const forEachCsvRecordBatch = async (
    blob: Blob,
    onBatch: (batchText: string) => void,
    options: { chunkBytes?: number; delimiter?: string; dropIncompleteTail?: boolean } = {}
): Promise<void> => {
    const splitter = createCsvRecordSplitter(options.delimiter);
    await forEachDecodedChunk(blob, (text) => {
        const completeText = splitter.push(text);
        if (completeText) onBatch(completeText);
    }, { chunkBytes: options.chunkBytes ?? DEFAULT_STREAM_CHUNK_BYTES });
    const restText = splitter.takePending();
    if (restText && !options.dropIncompleteTail) onBatch(restText);
};

/** 依抽樣門檻取得要檢查的範圍，並以完整資料列為單位逐段處理 */
const forEachScannedBatch = (blob: Blob, onBatch: (batchText: string) => void, options: CsvBlobScanOptions): Promise<void> => {
    const samplingBytes = options.samplingBytes ?? LARGE_FILE_SAMPLING_BYTES;
    const isSampled = isCsvBlobSampled(blob, samplingBytes);
    return forEachCsvRecordBatch(isSampled ? blob.slice(0, samplingBytes) : blob, onBatch, {
        chunkBytes: options.chunkBytes,
        delimiter: options.delimiter,
        dropIncompleteTail: isSampled
    });
};

/** 讀取開頭資料預覽時預設的每段大小與讀取上限 */
const HEAD_READ_CHUNK_BYTES = 1024 * 1024;
const HEAD_READ_MAX_BYTES = 64 * 1024 * 1024;

/**
 * 函數名稱: readCsvHeadText
 * 函數功能: ★ 2026-11-02（F12）：只讀出 CSV 開頭「至少 minRecordCount 筆非空白資料列（含標題列）」的文字，
 *           供標題列檢查與前 1000 筆預覽使用（PapaParse preview 的結果與餵入整份文字相同）。
 *           讀到檔尾則回傳整份；讀了 maxBytes 仍湊不滿（例如未成對引號吞掉後面內容）時，連同未完成的
 *           部分一起回傳，讓 PapaParse 照樣回報引號錯誤。
 */
export const readCsvHeadText = async (
    utf8Blob: Blob,
    minRecordCount: number,
    options: { chunkBytes?: number; maxBytes?: number; delimiter?: string } = {}
): Promise<string> => {
    const chunkBytes = options.chunkBytes ?? HEAD_READ_CHUNK_BYTES;
    const maxBytes = options.maxBytes ?? HEAD_READ_MAX_BYTES;
    const decoder = new TextDecoder('utf-8');
    const splitter = createCsvRecordSplitter(options.delimiter);
    const completeParts: string[] = [];
    for (let startOffset = 0; startOffset < utf8Blob.size; startOffset += chunkBytes) {
        const isLastChunk = startOffset + chunkBytes >= utf8Blob.size;
        const bytes = new Uint8Array(await utf8Blob.slice(startOffset, startOffset + chunkBytes).arrayBuffer());
        const completeText = splitter.push(decoder.decode(bytes, { stream: !isLastChunk }));
        if (completeText) completeParts.push(completeText);
        if (splitter.getCompletedRecordCount() >= minRecordCount) return completeParts.join('');
        if (startOffset + chunkBytes >= maxBytes) break;
    }
    completeParts.push(splitter.takePending());
    return completeParts.join('');
};

/** 自開頭文字推測分隔字元（與 PapaParse 自動判斷相同，看前 10 列）；判斷不出時為逗號 */
export const detectCsvDelimiterFromHeadText = (headTextContent: string): string =>
    Papa.parse<string[]>(headTextContent, { preview: 10, skipEmptyLines: 'greedy' }).meta.delimiter || ',';

/** 未指定分隔字元時，讀開頭幾列判斷（各段一律沿用同一個分隔字元，不讓每段各自猜） */
const resolveCsvDelimiter = async (utf8Blob: Blob, delimiter: string | undefined): Promise<string> =>
    delimiter || detectCsvDelimiterFromHeadText(await readCsvHeadText(utf8Blob, 11));

/** 混用／毀損判定門檻：無法解碼的字元數佔非 ASCII 字元的比例上限（超過即視為「根本不是這種編碼」） */
export const CORRUPTED_ENCODING_MAX_INVALID_RATIO = 0.01;

/** 混用／毀損判定時檢查的主要編碼（依序）；其餘舊編碼仍由 detectCsvBytesEncoding 的嚴格解碼處理 */
const CORRUPTION_CHECK_ENCODINGS = ['utf-8', 'big5'] as const;

const REPLACEMENT_CHAR = '�';

export interface EncodingCorruptionInfo {
    /** 檔案主要編碼（推測） */
    baseEncoding: string;
    /** 無法辨識的字元數（樣本範圍內） */
    invalidCharCount: number;
    /** 第一個無法辨識字元所在列號（1 起算） */
    firstInvalidLineNumber: number;
}

/**
 * 函數名稱: countLineNumberAt
 * 函數功能: 計算字串中某位置所在的列號（1 起算）。
 */
const countLineNumberAt = (textContent: string, charIndex: number): number => {
    let lineNumber = 1;
    for (let i = 0; i < charIndex; i++) if (textContent.charCodeAt(i) === 10) lineNumber++;
    return lineNumber;
};

/**
 * 函數名稱: findEncodingCorruption
 * 函數功能: 在「嚴格解碼全部失敗」之前先判斷：檔案是否其實是 UTF-8／Big5，只是混入了少量無法解碼
 *           的位元組。是的話回傳毀損資訊（應阻擋上傳並提示使用者），否則回傳 null（交由原本流程判斷）。
 * 判斷方式: 以非嚴格模式解碼，計算替代字元 (U+FFFD) 數量；有替代字元、且佔非 ASCII 字元比例低於
 *           CORRUPTED_ENCODING_MAX_INVALID_RATIO，代表絕大部分內容是這種編碼、只有少數位置壞掉。
 *           真正的其他編碼檔案（如 GBK、Shift-JIS）以 UTF-8／Big5 解碼時錯誤比例遠高於此門檻。
 */
export const findEncodingCorruption = (sampleBytesArray: Uint8Array, isSampleTruncated: boolean): EncodingCorruptionInfo | null => {
    for (const encodingLabel of CORRUPTION_CHECK_ENCODINGS) {
        let decodedText: string;
        try {
            decodedText = new TextDecoder(encodingLabel).decode(sampleBytesArray, { stream: isSampleTruncated });
        } catch {
            continue;
        }
        let invalidCharCount = 0;
        let nonAsciiCharCount = 0;
        let firstInvalidIndex = -1;
        for (let i = 0; i < decodedText.length; i++) {
            const charCode = decodedText.charCodeAt(i);
            if (charCode > 0x7F) nonAsciiCharCount++;
            if (decodedText[i] === REPLACEMENT_CHAR) {
                invalidCharCount++;
                if (firstInvalidIndex < 0) firstInvalidIndex = i;
            }
        }
        if (invalidCharCount > 0 && nonAsciiCharCount > 0 && invalidCharCount / nonAsciiCharCount <= CORRUPTED_ENCODING_MAX_INVALID_RATIO) {
            return {
                baseEncoding: encodingLabel,
                invalidCharCount,
                firstInvalidLineNumber: countLineNumberAt(decodedText, firstInvalidIndex)
            };
        }
    }
    return null;
};

/**
 * 函數名稱: findReplacementCharLine
 * 函數功能: 已解碼的完整文字中若仍有替代字元（例如毀損位置在偵測樣本 64KB 之後），回傳數量與首次出現列號。
 */
interface ReplacementCharScanState { count: number; firstLineNumber: number; lineNumberBase: number }

const countNewlines = (textContent: string, fromIndex: number = 0): number => {
    let newlineCount = 0;
    for (let i = fromIndex; i < textContent.length; i++) if (textContent.charCodeAt(i) === 10) newlineCount++;
    return newlineCount;
};

// ★ 2026-11-02（F12）：可分段累計；找到第一個替代字元前才需要數列號
const scanReplacementChars = (textContent: string, state: ReplacementCharScanState): void => {
    let fromIndex = 0;
    if (state.count === 0) {
        const firstIndex = textContent.indexOf(REPLACEMENT_CHAR);
        if (firstIndex < 0) {
            state.lineNumberBase += countNewlines(textContent);
            return;
        }
        state.firstLineNumber = state.lineNumberBase + countLineNumberAt(textContent, firstIndex) - 1;
        fromIndex = firstIndex;
    }
    for (let i = fromIndex; i < textContent.length; i++) if (textContent[i] === REPLACEMENT_CHAR) state.count++;
};

const toReplacementCharInfo = (state: ReplacementCharScanState): { count: number; firstLineNumber: number } | null =>
    state.count > 0 ? { count: state.count, firstLineNumber: state.firstLineNumber } : null;

export const findReplacementCharInfo = (decodedTextContent: string): { count: number; firstLineNumber: number } | null => {
    const state: ReplacementCharScanState = { count: 0, firstLineNumber: 0, lineNumberBase: 1 };
    scanReplacementChars(decodedTextContent, state);
    return toReplacementCharInfo(state);
};

/** ★ 2026-11-02（F12）：同 findReplacementCharInfo，逐段讀取 UTF-8 Blob（超過 200 MB 只檢查前 200 MB） */
export const findReplacementCharInfoInBlob = async (utf8Blob: Blob, options: CsvBlobScanOptions = {}): Promise<{ count: number; firstLineNumber: number } | null> => {
    const state: ReplacementCharScanState = { count: 0, firstLineNumber: 0, lineNumberBase: 1 };
    await forEachScannedBatch(utf8Blob, (batchText) => scanReplacementChars(batchText, state), options);
    return toReplacementCharInfo(state);
};

/** JavaScript 物件內建屬性名稱：作為欄位名稱時，以欄位名稱為鍵值的查表會取到內建函式／原型 */
export const RESERVED_COLUMN_NAMES: ReadonlySet<string> = new Set([
    ...Object.getOwnPropertyNames(Object.prototype),
    '__proto__', 'prototype'
]);

// 不可見字元：控制字元（含 NUL）、零寬字元、BOM、雙向控制字元
// eslint-disable-next-line no-control-regex
const INVISIBLE_CHAR_PATTERN = /[\u0000-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/;

export type HeaderProblemKind = 'reserved_name' | 'empty_name' | 'duplicate_name' | 'invisible_or_space';

export interface HeaderProblem {
    kind: HeaderProblemKind;
    /** 欄位名稱（顯示用：不可見字元以 \uXXXX 呈現） */
    columnLabel: string;
    /** 第幾欄（1 起算） */
    columnNumber: number;
}

/** 將不可見字元轉為可閱讀的 \uXXXX 形式，前後空白以「␣」標示，供錯誤訊息顯示 */
export const toVisibleColumnLabel = (columnName: string): string =>
    columnName
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
        .replace(/^ +| +$/g, (spaces) => '␣'.repeat(spaces.length));

/**
 * 函數名稱: findHeaderProblems
 * 函數功能: 檢查原始標題列（未經 PapaParse 改名前的欄位名稱）。
 *   - reserved_name：與 JavaScript 物件內建屬性同名 → 會造成系統崩潰，必須阻擋。
 *   - empty_name：欄位名稱空白 → 後端會自動命名為 Unnamed: N，與前端設定對不上，必須阻擋。
 *   - duplicate_name：欄位名稱重複 → 前端 PapaParse 改名為「名稱_1」、後端 pandas 改名為「名稱.1」，
 *     兩邊對不上，必須阻擋。
 *   - invisible_or_space：前後空白或不可見字元 → 畫面上看不出差異，但與系統推薦設定、設定檔欄位名稱
 *     比對不到，僅提示。
 */
export const findHeaderProblems = (rawHeaderFieldsList: string[]): HeaderProblem[] => {
    const problems: HeaderProblem[] = [];
    const seenNamesMap = new Map<string, number>();
    rawHeaderFieldsList.forEach((rawName, index) => {
        const columnNumber = index + 1;
        const name = rawName ?? '';
        const columnLabel = toVisibleColumnLabel(name);
        if (name.trim() === '' || name.replace(new RegExp(INVISIBLE_CHAR_PATTERN.source, 'g'), '').trim() === '') {
            problems.push({ kind: 'empty_name', columnLabel, columnNumber });
            return;
        }
        if (RESERVED_COLUMN_NAMES.has(name.trim())) {
            problems.push({ kind: 'reserved_name', columnLabel, columnNumber });
        }
        if (seenNamesMap.has(name)) {
            problems.push({ kind: 'duplicate_name', columnLabel, columnNumber });
        } else {
            seenNamesMap.set(name, columnNumber);
        }
        if (name !== name.trim() || INVISIBLE_CHAR_PATTERN.test(name)) {
            problems.push({ kind: 'invisible_or_space', columnLabel, columnNumber });
        }
    });
    return problems;
};

/** 會阻擋上傳的標題問題種類 */
export const BLOCKING_HEADER_PROBLEM_KINDS: ReadonlySet<HeaderProblemKind> = new Set(['reserved_name', 'empty_name', 'duplicate_name']);

/** 資料列欄位數與標題列不一致的比例超過此值，判定「第一列可能不是欄位名稱」 */
export const FIELD_MISMATCH_BLOCK_RATIO = 0.5;

export interface StructureProblem {
    kind: 'unclosed_quote' | 'header_mismatch';
    /** 有問題的列號（1 起算，含標題列） */
    lineNumber?: number;
    headerFieldCount?: number;
    typicalRowFieldCount?: number;
}

interface PapaLikeError { type: string; code: string; row?: number }

/**
 * 函數名稱: findStructureProblem
 * 函數功能: 依 PapaParse 解析錯誤判斷檔案結構是否錯亂：
 *   - 未成對的引號（MissingQuotes）：後面整段內容會被吞進同一格。
 *   - 過半資料列的欄位數與標題列不同：通常是標題列前多了一行說明文字或其他內容。
 */
export const findStructureProblem = (
    parseErrorsList: PapaLikeError[],
    headerFieldCount: number,
    dataRowsList: Record<string, unknown>[]
): StructureProblem | null => {
    const quoteError = parseErrorsList.find((errorItem) => errorItem.type === 'Quotes');
    if (quoteError) {
        return { kind: 'unclosed_quote', lineNumber: typeof quoteError.row === 'number' ? quoteError.row + 2 : undefined };
    }
    if (dataRowsList.length === 0) return null;
    const mismatchErrors = parseErrorsList.filter((errorItem) => errorItem.type === 'FieldMismatch');
    if (mismatchErrors.length / dataRowsList.length > FIELD_MISMATCH_BLOCK_RATIO) {
        // 推估資料列「常見」的欄位數：標題欄數 + __parsed_extra 多出來的欄數
        const fieldCountFrequencyMap = new Map<number, number>();
        dataRowsList.forEach((rowRecord) => {
            const extra = Array.isArray(rowRecord.__parsed_extra) ? rowRecord.__parsed_extra.length : 0;
            const filled = Object.keys(rowRecord).filter((key) => key !== '__parsed_extra' && rowRecord[key] !== undefined).length;
            const count = extra > 0 ? headerFieldCount + extra : filled;
            fieldCountFrequencyMap.set(count, (fieldCountFrequencyMap.get(count) || 0) + 1);
        });
        const typicalRowFieldCount = [...fieldCountFrequencyMap.entries()].sort((a, b) => b[1] - a[1])[0][0];
        return { kind: 'header_mismatch', headerFieldCount, typicalRowFieldCount };
    }
    return null;
};

/**
 * 函數名稱: findHeaderLineEndIndex
 * 函數功能: 找出 CSV 標題列結束位置（第一個不在雙引號內的換行之後），回傳標題列之後內容的起點。
 *           （PapaParse preview 模式的 meta.cursor 在部分情況會指到檔尾，不可靠，故自行掃描。）
 */
export const findHeaderLineEndIndex = (csvTextContent: string): number => {
    let isInsideQuotes = false;
    for (let i = 0; i < csvTextContent.length; i++) {
        const ch = csvTextContent[i];
        if (ch === '"') {
            isInsideQuotes = !isInsideQuotes;
        } else if (!isInsideQuotes && (ch === '\n' || ch === '\r')) {
            return ch === '\r' && csvTextContent[i + 1] === '\n' ? i + 2 : i + 1;
        }
    }
    return csvTextContent.length;
};

/** 清理欄位名稱：移除不可見字元（控制字元、零寬字元、BOM、雙向控制）、換行改為空白、去除前後空白 */
export const cleanColumnHeaderName = (rawName: string): string =>
    rawName
        .replace(/[\r\n\t]+/g, ' ')
        // eslint-disable-next-line no-control-regex
        .replace(new RegExp(INVISIBLE_CHAR_PATTERN.source, 'g'), '')
        .trim();

const quoteCsvCell = (cellValue: string): string => (/[",\r\n]/.test(cellValue) ? `"${cellValue.replace(/"/g, '""')}"` : cellValue);

export interface HeaderCleanResult {
    /** 清理後的完整 CSV 文字（沒有需要清理時與原文字相同） */
    cleanedCsvText: string;
    /** 有變動的欄位（原名稱已轉為可閱讀形式） */
    changedColumns: { columnNumber: number; fromLabel: string; to: string }[];
}

/**
 * 函數名稱: cleanCsvHeaderLine
 * 函數功能: ★ 2026-10-05：欄位名稱有前後空白或看不見的字元時，自動清理「標題列」並改寫要送往後端的檔案。
 *   背景：前端組設定檔時會把欄位名稱 trim／去除開頭零寬字元（pipelineConfig.ts），但原始檔案原樣送後端，
 *   後端不清理欄位名稱 → 設定檔「姓名」對不上檔案「␣姓名」，實測必定回傳 422 ERR_CONFIG_DATA_MISMATCH。
 *   只改標題列，資料列內容一律不動。
 * @param rawHeaderFieldsList PapaParse 解析出的原始標題列欄位（未改名）
 */
// ★ 2026-11-02（F12）：字串版與 Blob 版共用：算出清理後的標題列（含原本的換行字元）
const buildCleanedHeaderLine = (headTextContent: string, rawHeaderFieldsList: string[]): { originalHeaderLine: string; rebuiltHeaderLine: string; changedColumns: HeaderCleanResult['changedColumns'] } => {
    const changedColumns: HeaderCleanResult['changedColumns'] = [];
    const cleanedHeaderFieldsList = rawHeaderFieldsList.map((rawName, index) => {
        const cleanedName = cleanColumnHeaderName(rawName);
        if (cleanedName !== rawName) changedColumns.push({ columnNumber: index + 1, fromLabel: toVisibleColumnLabel(rawName), to: cleanedName });
        return cleanedName;
    });
    if (changedColumns.length === 0) return { originalHeaderLine: '', rebuiltHeaderLine: '', changedColumns };
    const originalHeaderLine = headTextContent.slice(0, findHeaderLineEndIndex(headTextContent));
    const lineBreak = originalHeaderLine.endsWith('\r\n') ? '\r\n' : originalHeaderLine.endsWith('\r') ? '\r' : originalHeaderLine.endsWith('\n') ? '\n' : '';
    const rebuiltHeaderLine = cleanedHeaderFieldsList.map(quoteCsvCell).join(',') + lineBreak;
    return { originalHeaderLine, rebuiltHeaderLine, changedColumns };
};

export const cleanCsvHeaderLine = (csvTextContent: string, rawHeaderFieldsList: string[]): HeaderCleanResult => {
    const { originalHeaderLine, rebuiltHeaderLine, changedColumns } = buildCleanedHeaderLine(csvTextContent, rawHeaderFieldsList);
    if (changedColumns.length === 0) return { cleanedCsvText: csvTextContent, changedColumns };
    return { cleanedCsvText: rebuiltHeaderLine + csvTextContent.slice(originalHeaderLine.length), changedColumns };
};

/**
 * 函數名稱: cleanCsvHeaderInBlob
 * 函數功能: ★ 2026-11-02（F12）：同 cleanCsvHeaderLine，但只改寫 Blob 的標題列：
 *           以 headTextContent（readCsvHeadText 讀出的開頭文字）找出原標題列，換算成 UTF-8 位元組長度，
 *           新檔案 = 清理後標題列 + 原 Blob 自標題列之後的切片（不讀取、不複製其餘內容）。
 *           原 Blob 開頭若有 UTF-8 BOM 也一併去除。
 */
export const cleanCsvHeaderInBlob = async (
    utf8Blob: Blob,
    headTextContent: string,
    rawHeaderFieldsList: string[]
): Promise<{ cleanedBlob: Blob; changedColumns: HeaderCleanResult['changedColumns'] }> => {
    const { originalHeaderLine, rebuiltHeaderLine, changedColumns } = buildCleanedHeaderLine(headTextContent, rawHeaderFieldsList);
    if (changedColumns.length === 0) return { cleanedBlob: utf8Blob, changedColumns };
    const leadingBytes = new Uint8Array(await utf8Blob.slice(0, 3).arrayBuffer());
    const bomByteLength = leadingBytes[0] === 0xEF && leadingBytes[1] === 0xBB && leadingBytes[2] === 0xBF ? 3 : 0;
    const headerByteLength = bomByteLength + new TextEncoder().encode(originalHeaderLine).length;
    return { cleanedBlob: new Blob([rebuiltHeaderLine, utf8Blob.slice(headerByteLength)], { type: 'text/csv' }), changedColumns };
};

// ============================================================================
// ★ 2026-10-05：資料內容特殊字元檢查。依使用者確認之「依嚴重程度分三級」：特殊字元屬第 3 級，
//   上傳時列出清單，由使用者選擇「取消上傳／移除特殊字元後上傳／仍要上傳」，不強制取消
//   （以免 Email 等含特殊字元的正常資料集無法使用）。原需求：偵測到特殊字元就擋下、取消上傳。
//   例：「**金品生」「@$$88」「!#中正區」「:{}1938-11-26」「$%感冒」。
//   這類字元在正常的結構化資料中幾乎不會出現，混進來通常是人工誤植或惡意輸入；放行的話數值／日期
//   欄位會轉換失敗、類別值與階層對照比對不到，甚至在 Excel 開啟時被當成公式執行。
//   允許：中英文字、數字、空白，以及日期／電話／地址常用的 - _ . / : ( ) + & ' 、 全形括號等。
//   CSV 本身的語法字元（逗號、雙引號、換行）不檢查。
//   ※ 若日後有欄位需要允許某個字元（例如 Email 的 @），從下方清單移除即可。
// ============================================================================
export const BLOCKED_SPECIAL_CHARACTERS = '*@#$%^!~`|\\{}[]<>;?=＊＠＃＄％＾！～｜＼｛｝［］＜＞；？＝';

const escapeForCharClass = (chars: string): string => chars.replace(/[\\\]^-]/g, '\\$&');
const SPECIAL_CHARACTER_PATTERN = new RegExp(`[${escapeForCharClass(BLOCKED_SPECIAL_CHARACTERS)}]`, 'g');

/** 錯誤訊息中最多列出幾筆範例 */
export const SPECIAL_CHARACTER_MAX_EXAMPLES = 5;
const EXAMPLE_VALUE_MAX_LENGTH = 24;

export interface SpecialCharacterCell {
    /** 列號（1 起算，第 1 列為欄位名稱列；與 Excel／文字編輯器的列號一致） */
    lineNumber: number;
    /** 欄位名稱（第 1 列時為該欄名稱本身） */
    columnName: string;
    /** 儲存格內容（過長時截斷） */
    cellValue: string;
}

export interface SpecialCharacterScanResult {
    /** 含特殊字元的儲存格數 */
    cellCount: number;
    /** 前幾筆範例 */
    examples: SpecialCharacterCell[];
    /** 出現過的特殊字元（去重） */
    foundCharacters: string[];
}

// ★ 2026-10-05：例外——完整的 Email（含 @）與百分比（含 %）是正常資料，不列為特殊字元。
const EMAIL_VALUE_PATTERN = /^\s*[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}\s*$/;
const PERCENT_VALUE_PATTERN = /^\s*[-+]?\d+(\.\d+)?\s*[%％]\s*$/;
export const isSpecialCharacterExemptValue = (cellValue: string): boolean =>
    EMAIL_VALUE_PATTERN.test(cellValue) || PERCENT_VALUE_PATTERN.test(cellValue);

/** 把一列 CSV 文字切成儲存格，並回傳每格在該列中的起訖位置（處理雙引號） */
const splitCsvLineWithOffsets = (lineText: string): { value: string; start: number; end: number }[] => {
    const cells: { value: string; start: number; end: number }[] = [];
    let cellStart = 0;
    let isInsideQuotes = false;
    let currentValue = '';
    for (let i = 0; i <= lineText.length; i++) {
        const ch = lineText[i];
        if (i === lineText.length || (ch === ',' && !isInsideQuotes)) {
            cells.push({ value: currentValue, start: cellStart, end: i });
            cellStart = i + 1;
            currentValue = '';
            continue;
        }
        if (ch === '"') {
            if (isInsideQuotes && lineText[i + 1] === '"') { currentValue += '"'; i++; continue; }
            isInsideQuotes = !isInsideQuotes;
            continue;
        }
        currentValue += ch;
    }
    return cells;
};

// ★ 2026-11-02（F12）：特殊字元掃描改為可分段累計（每段為完整資料列），字串版與 Blob 版共用
interface SpecialCharacterScanState {
    headerCells: string[] | null;
    examples: SpecialCharacterCell[];
    foundCharacterSet: Set<string>;
    /** 上一個計入的儲存格（列號:欄序）；比對依位置遞增，同一格只會連續出現，故不必保留全部儲存格 */
    lastCountedCellKey: string;
    cellCount: number;
    /** 本段第一列的列號 */
    lineNumberBase: number;
}

const createSpecialCharacterScanState = (): SpecialCharacterScanState => ({
    headerCells: null, examples: [], foundCharacterSet: new Set<string>(), lastCountedCellKey: '', cellCount: 0, lineNumberBase: 1
});

const scanSpecialCharactersInText = (csvTextContent: string, state: SpecialCharacterScanState): void => {
    if (!state.headerCells) {
        const headerEndIndex = findHeaderLineEndIndex(csvTextContent);
        state.headerCells = splitCsvLineWithOffsets(csvTextContent.slice(0, headerEndIndex).replace(/\r?\n$|\r$/, '')).map((cell) => cell.value);
    }
    const headerCells = state.headerCells;
    let lineNumber = state.lineNumberBase;
    let scannedUntilIndex = 0;
    SPECIAL_CHARACTER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null = SPECIAL_CHARACTER_PATTERN.exec(csvTextContent);

    while (match) {
        const matchIndex = match.index;
        const matchedCharacter = match[0];
        for (let i = scannedUntilIndex; i < matchIndex; i++) if (csvTextContent.charCodeAt(i) === 10) lineNumber++;
        scannedUntilIndex = matchIndex;

        const lineStartIndex = csvTextContent.lastIndexOf('\n', matchIndex - 1) + 1;
        let lineEndIndex = csvTextContent.indexOf('\n', matchIndex);
        if (lineEndIndex < 0) lineEndIndex = csvTextContent.length;
        const lineText = csvTextContent.slice(lineStartIndex, lineEndIndex).replace(/\r$/, '');
        const offsetInLine = matchIndex - lineStartIndex;
        const cells = splitCsvLineWithOffsets(lineText);
        const cellIndex = Math.max(0, cells.findIndex((cell) => offsetInLine >= cell.start && offsetInLine <= cell.end));
        const cellKey = `${lineNumber}:${cellIndex}`;
        const isExemptCellStatus = isSpecialCharacterExemptValue(cells[cellIndex]?.value ?? '');
        if (!isExemptCellStatus) state.foundCharacterSet.add(matchedCharacter);

        if (!isExemptCellStatus && state.lastCountedCellKey !== cellKey) {
            state.lastCountedCellKey = cellKey;
            state.cellCount++;
            if (state.examples.length < SPECIAL_CHARACTER_MAX_EXAMPLES) {
                const rawValue = cells[cellIndex]?.value ?? '';
                state.examples.push({
                    lineNumber,
                    columnName: headerCells[cellIndex] ?? `第 ${cellIndex + 1} 欄`,
                    cellValue: rawValue.length > EXAMPLE_VALUE_MAX_LENGTH ? `${rawValue.slice(0, EXAMPLE_VALUE_MAX_LENGTH)}…` : rawValue
                });
            }
        }
        // 同一格內其餘特殊字元只記錄字元種類，直接跳到該格結尾以加速
        const cellEndInText = lineStartIndex + (cells[cellIndex]?.end ?? offsetInLine);
        SPECIAL_CHARACTER_PATTERN.lastIndex = Math.max(SPECIAL_CHARACTER_PATTERN.lastIndex, matchIndex + 1);
        const cellRemainder = csvTextContent.slice(matchIndex + 1, cellEndInText);
        if (!isExemptCellStatus) for (const ch of cellRemainder) if (BLOCKED_SPECIAL_CHARACTERS.includes(ch)) state.foundCharacterSet.add(ch);
        SPECIAL_CHARACTER_PATTERN.lastIndex = Math.max(SPECIAL_CHARACTER_PATTERN.lastIndex, cellEndInText);
        match = SPECIAL_CHARACTER_PATTERN.exec(csvTextContent);
    }
    SPECIAL_CHARACTER_PATTERN.lastIndex = 0;
    state.lineNumberBase = lineNumber + countNewlines(csvTextContent, scannedUntilIndex);
};

const toSpecialCharacterScanResult = (state: SpecialCharacterScanState): SpecialCharacterScanResult | null =>
    state.cellCount === 0 ? null : { cellCount: state.cellCount, examples: state.examples, foundCharacters: [...state.foundCharacterSet] };

/**
 * 函數名稱: findSpecialCharacterCells
 * 函數功能: 掃描整份 CSV 文字，找出含特殊字元的儲存格，回傳數量、前幾筆範例（列號、欄位、內容）與出現的字元。
 *           沒有發現時回傳 null。以正規表示式直接掃描全文（不逐格解析），大檔案也只需一次線性掃描。
 */
export const findSpecialCharacterCells = (csvTextContent: string): SpecialCharacterScanResult | null => {
    const state = createSpecialCharacterScanState();
    scanSpecialCharactersInText(csvTextContent, state);
    return toSpecialCharacterScanResult(state);
};

/** ★ 2026-11-02（F12）：同 findSpecialCharacterCells，逐段讀取 UTF-8 Blob（超過 200 MB 只檢查前 200 MB） */
export const findSpecialCharacterCellsInBlob = async (utf8Blob: Blob, options: CsvBlobScanOptions = {}): Promise<SpecialCharacterScanResult | null> => {
    const state = createSpecialCharacterScanState();
    await forEachScannedBatch(utf8Blob, (batchText) => scanSpecialCharactersInText(batchText, state), options);
    return toSpecialCharacterScanResult(state);
};

// 移除單一儲存格中的特殊字元；回傳 null 代表不需變動
const stripSpecialCharactersInCell = (cellValue: string): string | null => {
    if (isSpecialCharacterExemptValue(cellValue)) return null;
    SPECIAL_CHARACTER_PATTERN.lastIndex = 0;
    if (!SPECIAL_CHARACTER_PATTERN.test(cellValue)) return null;
    // 移除後殘留在開頭／結尾的冒號（例：「:{}1938-11-26」→「:1938-11-26」）一併去除；日期、時間不會以冒號開頭或結尾
    const cleanedValue = cellValue.replace(SPECIAL_CHARACTER_PATTERN, '').replace(/^[:：\s]+|[:：\s]+$/g, '');
    SPECIAL_CHARACTER_PATTERN.lastIndex = 0;
    return cleanedValue;
};

// ★ 2026-11-02（F12）：一段完整資料列 → 移除特殊字元後的 CSV 文字（換行一律為 \n，結尾含換行）
const stripSpecialCharactersInBatch = (batchText: string, delimiter: string | undefined): { csvText: string; changedCellCount: number } => {
    const parsedRows = Papa.parse<string[]>(batchText, { skipEmptyLines: 'greedy', ...(delimiter ? { delimiter } : {}) }).data;
    let changedCellCount = 0;
    const cleanedRows = parsedRows.map((rowCells) => rowCells.map((cellValue) => {
        const cleanedValue = stripSpecialCharactersInCell(cellValue);
        if (cleanedValue === null) return cellValue;
        changedCellCount++;
        return cleanedValue;
    }));
    SPECIAL_CHARACTER_PATTERN.lastIndex = 0;
    return { csvText: cleanedRows.length > 0 ? Papa.unparse(cleanedRows, { newline: '\n' }) + '\n' : '', changedCellCount };
};

/**
 * 函數名稱: stripSpecialCharacters
 * 函數功能: 移除各儲存格中的特殊字元（Email、百分比等例外值不動），回傳新 CSV 文字與變動的儲存格數。
 *           以 PapaParse 解析後重組，CSV 語法（逗號、引號、換行）保持正確。
 */
export const stripSpecialCharacters = (csvTextContent: string): { csvText: string; changedCellCount: number } => {
    const { csvText, changedCellCount } = stripSpecialCharactersInBatch(csvTextContent, undefined);
    return { csvText: csvText || '\n', changedCellCount };
};

/**
 * 函數名稱: stripSpecialCharactersInBlob
 * 函數功能: ★ 2026-11-02（F12）：同 stripSpecialCharacters，但逐段處理整個 UTF-8 Blob（不抽樣），
 *           每段解析→清理→Papa.unparse 後放入 Blob 片段，全程不產生整檔字串或整份資料列陣列。
 *           分隔字元以開頭幾列判斷一次（與 PapaParse 自動判斷相同），各段一律沿用，確保一致。
 */
export const stripSpecialCharactersInBlob = async (
    utf8Blob: Blob,
    options: { chunkBytes?: number; delimiter?: string } = {}
): Promise<{ strippedBlob: Blob; changedCellCount: number }> => {
    const encoder = new TextEncoder();
    const outputParts: BlobPart[] = [];
    let changedCellCount = 0;
    const delimiter = await resolveCsvDelimiter(utf8Blob, options.delimiter);
    await forEachCsvRecordBatch(utf8Blob, (batchText) => {
        const batchResult = stripSpecialCharactersInBatch(batchText, delimiter);
        changedCellCount += batchResult.changedCellCount;
        if (batchResult.csvText) outputParts.push(encoder.encode(batchResult.csvText));
    }, { chunkBytes: options.chunkBytes, delimiter });
    if (outputParts.length === 0) outputParts.push('\n');
    return { strippedBlob: new Blob(outputParts, { type: 'text/csv' }), changedCellCount };
};

// ============================================================================
// ★ 2026-10-05：第 2 級「數值／日期欄位中有無法轉換的值」。上傳時欄位型態尚未設定，故以內容推斷：
//   非空值中 ≥ TYPED_COLUMN_DOMINANT_RATIO 是數字（或日期）、但仍有少數不是 → 這些少數很可能是錯誤值
//   （例：年齡欄的「@$$88」「三十」）。上傳時僅列出提醒（例如郵遞區號欄偶有「10491A」，使用者可能本來就
//   打算設為類別型）；真正的阻擋在 Step2 使用者把欄位設為數值／日期時（見 columnTypeConsistency.ts）。
// ============================================================================
export const TYPED_COLUMN_DOMINANT_RATIO = 0.9;
export const TYPED_COLUMN_MIN_NON_EMPTY = 10;

export interface TypedColumnOutlier {
    columnName: string;
    kind: 'numeric' | 'date';
    /** 無法轉換的筆數 */
    badCount: number;
    /** 範例（列號 1 起算，第 1 列為欄位名稱列） */
    examples: { lineNumber: number; cellValue: string }[];
}

// ★ 2026-11-02（F12）：可分段累計（每段為完整資料列），字串版與 Blob 版共用
interface TypedColumnScanState {
    headerCells: string[] | null;
    rowIndex: number;
    statsList: ColumnValueStats[];
    delimiter: string | undefined;
}

const scanTypedColumnsInText = (csvTextContent: string, state: TypedColumnScanState): void => {
    Papa.parse<string[]>(csvTextContent, {
        skipEmptyLines: 'greedy',
        ...(state.delimiter ? { delimiter: state.delimiter } : {}),
        step: (stepResult) => {
            if (!state.delimiter) state.delimiter = stepResult.meta.delimiter;
            const rowCells = stepResult.data;
            if (!state.headerCells) {
                state.headerCells = rowCells.map((cell) => String(cell ?? ''));
                state.headerCells.forEach(() => state.statsList.push(createColumnValueStats()));
                return;
            }
            state.rowIndex++;
            for (let columnIndex = 0; columnIndex < state.statsList.length; columnIndex++) {
                addValueToColumnStats(state.statsList[columnIndex], String(rowCells[columnIndex] ?? '').trim(), state.rowIndex + 1);
            }
        }
    });
};

const toTypedColumnOutliers = (state: TypedColumnScanState): TypedColumnOutlier[] => {
    const outliers: TypedColumnOutlier[] = [];
    const header: string[] = state.headerCells ?? [];
    const toOutlierExamples = (examples: ValueExample[]) => examples.map((example) => ({ lineNumber: example.lineNumber ?? 0, cellValue: example.value }));
    state.statsList.forEach((stats, columnIndex) => {
        if (stats.nonMissingCount < TYPED_COLUMN_MIN_NON_EMPTY) return;
        const columnName = header[columnIndex] ?? `第 ${columnIndex + 1} 欄`;
        if (stats.strictNumericCount / stats.nonMissingCount >= TYPED_COLUMN_DOMINANT_RATIO) {
            const conflict = evaluateNumericConflict(stats);
            if (conflict) outliers.push({ columnName, kind: 'numeric', badCount: conflict.badCount, examples: toOutlierExamples(conflict.examples) });
            return;
        }
        const dominant = getDominantShape(stats);
        if (dominant && isDateShape(dominant.shape) && dominant.count / stats.nonMissingCount >= TYPED_COLUMN_DOMINANT_RATIO) {
            const conflict = evaluateDateConflict(stats);
            if (conflict) outliers.push({ columnName, kind: 'date', badCount: conflict.badCount, examples: toOutlierExamples(conflict.examples) });
        }
    });
    return outliers;
};

/**
 * 函數名稱: findTypedColumnOutliers
 * 函數功能: 逐列掃描整份 CSV（PapaParse step 模式，不保留全部資料列），找出「大多是數字／日期、
 *           但有少數無法轉換」的欄位。轉換規則與後端一致（見 backendValueRules.ts：缺值字串不算錯、
 *           千分位與十六進位不算數字、日期須同一欄格式一致且日期存在）。
 */
export const findTypedColumnOutliers = (csvTextContent: string): TypedColumnOutlier[] => {
    const state: TypedColumnScanState = { headerCells: null, rowIndex: 0, statsList: [], delimiter: undefined };
    scanTypedColumnsInText(csvTextContent, state);
    return toTypedColumnOutliers(state);
};

/** ★ 2026-11-02（F12）：同 findTypedColumnOutliers，逐段讀取 UTF-8 Blob（超過 200 MB 只檢查前 200 MB） */
export const findTypedColumnOutliersInBlob = async (utf8Blob: Blob, options: CsvBlobScanOptions = {}): Promise<TypedColumnOutlier[]> => {
    const delimiter = await resolveCsvDelimiter(utf8Blob, options.delimiter);
    const state: TypedColumnScanState = { headerCells: null, rowIndex: 0, statsList: [], delimiter };
    await forEachScannedBatch(utf8Blob, (batchText) => scanTypedColumnsInText(batchText, state), { ...options, delimiter });
    return toTypedColumnOutliers(state);
};
