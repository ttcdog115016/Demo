import Papa from 'papaparse';
import { createColumnValueStats, addValueToColumnStats, evaluateNumericConflict, evaluateDateConflict, getDominantShape, isDateShape, type ColumnValueStats, type ValueExample } from './backendValueRules';

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
 * ============================================================================
 */

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
export const findReplacementCharInfo = (decodedTextContent: string): { count: number; firstLineNumber: number } | null => {
    const firstIndex = decodedTextContent.indexOf(REPLACEMENT_CHAR);
    if (firstIndex < 0) return null;
    let count = 0;
    for (let i = firstIndex; i < decodedTextContent.length; i++) if (decodedTextContent[i] === REPLACEMENT_CHAR) count++;
    return { count, firstLineNumber: countLineNumberAt(decodedTextContent, firstIndex) };
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
export const cleanCsvHeaderLine = (csvTextContent: string, rawHeaderFieldsList: string[]): HeaderCleanResult => {
    const changedColumns: HeaderCleanResult['changedColumns'] = [];
    const cleanedHeaderFieldsList = rawHeaderFieldsList.map((rawName, index) => {
        const cleanedName = cleanColumnHeaderName(rawName);
        if (cleanedName !== rawName) changedColumns.push({ columnNumber: index + 1, fromLabel: toVisibleColumnLabel(rawName), to: cleanedName });
        return cleanedName;
    });
    if (changedColumns.length === 0) return { cleanedCsvText: csvTextContent, changedColumns };
    const headerEndIndex = findHeaderLineEndIndex(csvTextContent);
    const originalHeaderLine = csvTextContent.slice(0, headerEndIndex);
    const lineBreak = originalHeaderLine.endsWith('\r\n') ? '\r\n' : originalHeaderLine.endsWith('\r') ? '\r' : originalHeaderLine.endsWith('\n') ? '\n' : '';
    const rebuiltHeaderLine = cleanedHeaderFieldsList.map(quoteCsvCell).join(',') + lineBreak;
    return { cleanedCsvText: rebuiltHeaderLine + csvTextContent.slice(headerEndIndex), changedColumns };
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

/**
 * 函數名稱: findSpecialCharacterCells
 * 函數功能: 掃描整份 CSV 文字，找出含特殊字元的儲存格，回傳數量、前幾筆範例（列號、欄位、內容）與出現的字元。
 *           沒有發現時回傳 null。以正規表示式直接掃描全文（不逐格解析），大檔案也只需一次線性掃描。
 */
export const findSpecialCharacterCells = (csvTextContent: string): SpecialCharacterScanResult | null => {
    SPECIAL_CHARACTER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null = SPECIAL_CHARACTER_PATTERN.exec(csvTextContent);
    if (!match) return null;

    const headerEndIndex = findHeaderLineEndIndex(csvTextContent);
    const headerCells = splitCsvLineWithOffsets(csvTextContent.slice(0, headerEndIndex).replace(/\r?\n$|\r$/, '')).map((cell) => cell.value);

    const examples: SpecialCharacterCell[] = [];
    const foundCharacterSet = new Set<string>();
    const countedCellKeys = new Set<string>();
    let cellCount = 0;
    let lineNumber = 1;
    let scannedUntilIndex = 0;

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
        if (!isExemptCellStatus) foundCharacterSet.add(matchedCharacter);

        if (!isExemptCellStatus && !countedCellKeys.has(cellKey)) {
            countedCellKeys.add(cellKey);
            cellCount++;
            if (examples.length < SPECIAL_CHARACTER_MAX_EXAMPLES) {
                const rawValue = cells[cellIndex]?.value ?? '';
                examples.push({
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
        if (!isExemptCellStatus) for (const ch of cellRemainder) if (BLOCKED_SPECIAL_CHARACTERS.includes(ch)) foundCharacterSet.add(ch);
        SPECIAL_CHARACTER_PATTERN.lastIndex = Math.max(SPECIAL_CHARACTER_PATTERN.lastIndex, cellEndInText);
        match = SPECIAL_CHARACTER_PATTERN.exec(csvTextContent);
    }
    if (cellCount === 0) return null;
    return { cellCount, examples, foundCharacters: [...foundCharacterSet] };
};

/**
 * 函數名稱: stripSpecialCharacters
 * 函數功能: 移除各儲存格中的特殊字元（Email、百分比等例外值不動），回傳新 CSV 文字與變動的儲存格數。
 *           以 PapaParse 解析後重組，CSV 語法（逗號、引號、換行）保持正確。
 */
export const stripSpecialCharacters = (csvTextContent: string): { csvText: string; changedCellCount: number } => {
    const parsedRows = Papa.parse<string[]>(csvTextContent, { skipEmptyLines: 'greedy' }).data;
    let changedCellCount = 0;
    const cleanedRows = parsedRows.map((rowCells) => rowCells.map((cellValue) => {
        if (isSpecialCharacterExemptValue(cellValue)) return cellValue;
        SPECIAL_CHARACTER_PATTERN.lastIndex = 0;
        if (!SPECIAL_CHARACTER_PATTERN.test(cellValue)) return cellValue;
        changedCellCount++;
        // 移除後殘留在開頭／結尾的冒號（例：「:{}1938-11-26」→「:1938-11-26」）一併去除；日期、時間不會以冒號開頭或結尾
        return cellValue.replace(SPECIAL_CHARACTER_PATTERN, '').replace(/^[:：\s]+|[:：\s]+$/g, '');
    }));
    SPECIAL_CHARACTER_PATTERN.lastIndex = 0;
    return { csvText: Papa.unparse(cleanedRows, { newline: '\n' }) + '\n', changedCellCount };
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

/**
 * 函數名稱: findTypedColumnOutliers
 * 函數功能: 逐列掃描整份 CSV（PapaParse step 模式，不保留全部資料列），找出「大多是數字／日期、
 *           但有少數無法轉換」的欄位。轉換規則與後端一致（見 backendValueRules.ts：缺值字串不算錯、
 *           千分位與十六進位不算數字、日期須同一欄格式一致且日期存在）。
 */
export const findTypedColumnOutliers = (csvTextContent: string): TypedColumnOutlier[] => {
    let headerCells: string[] | null = null;
    let rowIndex = 0;
    const statsList: ColumnValueStats[] = [];
    Papa.parse<string[]>(csvTextContent, {
        skipEmptyLines: 'greedy',
        step: (stepResult) => {
            const rowCells = stepResult.data;
            if (!headerCells) {
                headerCells = rowCells.map((cell) => String(cell ?? ''));
                headerCells.forEach(() => statsList.push(createColumnValueStats()));
                return;
            }
            rowIndex++;
            for (let columnIndex = 0; columnIndex < statsList.length; columnIndex++) {
                addValueToColumnStats(statsList[columnIndex], String(rowCells[columnIndex] ?? '').trim(), rowIndex + 1);
            }
        }
    });
    const outliers: TypedColumnOutlier[] = [];
    const header: string[] = headerCells ?? [];
    const toOutlierExamples = (examples: ValueExample[]) => examples.map((example) => ({ lineNumber: example.lineNumber ?? 0, cellValue: example.value }));
    statsList.forEach((stats, columnIndex) => {
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
