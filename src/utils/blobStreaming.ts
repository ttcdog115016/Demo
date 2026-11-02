/**
 * ============================================================================
 * 檔案名稱 (File): blobStreaming.ts
 * 模組功能 (Description): 大檔分段處理（★ 2026-11-02 F12）。
 * ============================================================================
 * WebView2（Chromium／V8）單一字串上限約 5.37 億字元，約 610 MB 以上的 CSV 一旦整檔 `text()`／`TextDecoder.decode()`
 * 就會丟出「Invalid string length」。本模組以 `blob.slice` 逐段讀取（預設 8 MB），全程不產生整檔字串：
 *   - forEachDecodedChunk：逐段解碼成文字（TextDecoder stream 模式，跨段的多位元組字元不會被切壞）
 *   - stripLeadingBom：只讀前幾個 byte 判斷 BOM／零寬空白，回傳去掉後的 Blob 切片
 *   - transcodeToUtf8Blob：非 UTF-8 檔案逐段轉成 UTF-8 Blob
 *   - createCsvRowCounter：可跨段累計的 CSV 資料列計數（與 countCsvDataRowsForStats 同一套規則）
 *   - sha256HexOfBlobStreaming：逐段累加的 SHA-256（crypto-js），不受單一 ArrayBuffer 大小限制
 */
import CryptoJS from 'crypto-js';

/** 每段讀取的位元組數 */
export const DEFAULT_STREAM_CHUNK_BYTES = 8 * 1024 * 1024;

/** 超過此大小的檔案，逐格檢查與實用性（保真度）計算改為抽樣 */
export const LARGE_FILE_SAMPLING_BYTES = 200 * 1024 * 1024;

/** 逐段讀出原始位元組 */
export const forEachBlobByteChunk = async (
    blob: Blob,
    onBytes: (bytes: Uint8Array, startOffset: number) => void | Promise<void>,
    chunkBytes: number = DEFAULT_STREAM_CHUNK_BYTES
): Promise<void> => {
    for (let startOffset = 0; startOffset < blob.size; startOffset += chunkBytes) {
        const bytes = new Uint8Array(await blob.slice(startOffset, startOffset + chunkBytes).arrayBuffer());
        await onBytes(bytes, startOffset);
    }
};

/** 逐段解碼成文字；encoding 預設 UTF-8 */
export const forEachDecodedChunk = async (
    blob: Blob,
    onText: (text: string) => void | Promise<void>,
    options: { chunkBytes?: number; encoding?: string; maxBytes?: number } = {}
): Promise<void> => {
    const decoder = new TextDecoder(options.encoding ?? 'utf-8');
    const source = options.maxBytes !== undefined && blob.size > options.maxBytes ? blob.slice(0, options.maxBytes) : blob;
    await forEachBlobByteChunk(source, async (bytes) => {
        const text = decoder.decode(bytes, { stream: true });
        if (text) await onText(text);
    }, options.chunkBytes);
    const tail = decoder.decode();
    if (tail) await onText(tail);
};

// UTF-8 的 BOM（EF BB BF）與零寬空白（E2 80 8B）；原本以 /^[﻿​]+/ 去除
const LEADING_MARKS: number[][] = [[0xEF, 0xBB, 0xBF], [0xE2, 0x80, 0x8B]];

/** 去掉檔頭的 BOM／零寬空白，只讀前 64 個 byte 判斷，不讀整個檔案 */
export const stripLeadingBom = async (blob: Blob): Promise<Blob> => {
    const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    let offset = 0;
    let matched = true;
    while (matched) {
        matched = false;
        for (const mark of LEADING_MARKS) {
            if (mark.every((byteValue, index) => head[offset + index] === byteValue)) {
                offset += mark.length;
                matched = true;
            }
        }
    }
    return offset > 0 ? blob.slice(offset, blob.size, blob.type) : blob;
};

/** 非 UTF-8（Big5 等）檔案逐段解碼後重新編碼為 UTF-8，回傳 Blob；全程不產生整檔字串 */
export const transcodeToUtf8Blob = async (
    blob: Blob,
    encoding: string,
    chunkBytes: number = DEFAULT_STREAM_CHUNK_BYTES
): Promise<Blob> => {
    const encoder = new TextEncoder();
    const parts: BlobPart[] = [];
    await forEachDecodedChunk(blob, (text) => { parts.push(encoder.encode(text)); }, { chunkBytes, encoding });
    return new Blob(parts, { type: 'text/csv;charset=utf-8' });
};

const isTrimWhitespaceCode = (charCode: number): boolean =>
    charCode === 0x20 || (charCode >= 0x09 && charCode <= 0x0D) || charCode === 0xA0 || charCode === 0x1680 ||
    (charCode >= 0x2000 && charCode <= 0x200A) || charCode === 0x2028 || charCode === 0x2029 || charCode === 0x202F ||
    charCode === 0x205F || charCode === 0x3000 || charCode === 0xFEFF;

export interface CsvRowCounter {
    /** 餵入下一段文字 */
    push: (text: string) => void;
    /** 全部餵完後取得資料列數（扣除表頭與空白行） */
    finish: () => number;
}

/**
 * 可跨段累計的 CSV 資料列計數（扣除表頭與空白行）。
 * 規則（RFC 4180）：欄位開頭的 " 開啟引號區段，區段內 "" 為跳脫的引號、換行屬於同一筆資料；
 * 未加引號的欄位中間出現的 " 視為一般字元；檔案開頭的 BOM 不算內容。
 * 段落邊界上的「引號後是否還有引號」「CR 後是否接 LF」以暫存狀態延到下一段判斷。
 */
export const createCsvRowCounter = (): CsvRowCounter => {
    let nonBlankLineCount = 0;
    let isCurrentLineNonBlank = false;
    let isInsideQuotedField = false;
    let isAtFieldStart = true;
    let isFirstChar = true;
    let pendingQuoteInsideField = false; // 引號區段內的 " 剛好在段尾：要看下一個字元才知道是跳脫還是結束
    let pendingCarriageReturn = false;   // CR 剛好在段尾：下一段開頭的 LF 屬於同一個換行

    const push = (text: string): void => {
        for (let charIndex = 0; charIndex < text.length; charIndex++) {
            const charCode = text.charCodeAt(charIndex);
            if (pendingCarriageReturn) {
                pendingCarriageReturn = false;
                if (charCode === 0x0A) continue;
            }
            if (pendingQuoteInsideField) {
                pendingQuoteInsideField = false;
                if (charCode === 0x22) continue; // "" 跳脫，仍在引號區段內
                isInsideQuotedField = false;     // 單一 " 結束引號區段，這個字元照一般規則處理
            }
            if (isInsideQuotedField) {
                if (charCode === 0x22) {
                    if (charIndex + 1 >= text.length) pendingQuoteInsideField = true;
                    else if (text.charCodeAt(charIndex + 1) === 0x22) charIndex++;
                    else isInsideQuotedField = false;
                }
                continue;
            }
            if (isFirstChar) {
                isFirstChar = false;
                if (charCode === 0xFEFF) continue;
            }
            if (charCode === 0x0A || charCode === 0x0D) {
                if (isCurrentLineNonBlank) nonBlankLineCount++;
                isCurrentLineNonBlank = false;
                isAtFieldStart = true;
                if (charCode === 0x0D) {
                    if (charIndex + 1 >= text.length) pendingCarriageReturn = true;
                    else if (text.charCodeAt(charIndex + 1) === 0x0A) charIndex++;
                }
                continue;
            }
            if (!isCurrentLineNonBlank && !isTrimWhitespaceCode(charCode)) isCurrentLineNonBlank = true;
            if (charCode === 0x22 && isAtFieldStart) isInsideQuotedField = true;
            isAtFieldStart = charCode === 0x2C;
        }
        if (text.length > 0) isFirstChar = false;
    };

    const finish = (): number => {
        if (isCurrentLineNonBlank) nonBlankLineCount++;
        return Math.max(0, nonBlankLineCount - 1);
    };

    return { push, finish };
};

/** Blob 的 CSV 資料列數（逐段計算） */
export const countCsvDataRowsInBlob = async (blob: Blob, chunkBytes?: number): Promise<number> => {
    const counter = createCsvRowCounter();
    await forEachDecodedChunk(blob, (text) => counter.push(text), { chunkBytes });
    return counter.finish();
};

/** 逐段累加的 SHA-256（hex）：大檔不必整份讀成單一 ArrayBuffer */
export const sha256HexOfBlobStreaming = async (blob: Blob, chunkBytes: number = DEFAULT_STREAM_CHUNK_BYTES): Promise<string> => {
    const hasher = CryptoJS.algo.SHA256.create();
    await forEachBlobByteChunk(blob, (bytes) => {
        hasher.update(CryptoJS.lib.WordArray.create(bytes as unknown as number[]));
    }, chunkBytes);
    return hasher.finalize().toString(CryptoJS.enc.Hex);
};
