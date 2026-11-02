/**
 * ============================================================================
 * 檔案名稱 (File): csvBlobParse.ts
 * 模組功能 (Description): 以串流方式逐段解析 CSV Blob（★ 2026-11-02 F12）。
 * ============================================================================
 * 以 blob.slice 逐段讀取並解碼（utils/blobStreaming.ts），每段只切到「最後一個完整資料列」為止交給 Papa.parse，
 * 不完整的尾巴併入下一段；全程不建立整檔字串，也不依賴 FileReader（Worker、測試環境皆可用）。
 * 引號規則與 Papa 一致：欄位開頭的 " 開啟引號區段，區段內 "" 為跳脫，換行屬於同一列。
 */
import Papa from 'papaparse';
import { DEFAULT_STREAM_CHUNK_BYTES } from './blobStreaming';

/** onRows 回傳 false 即停止讀取（大檔抽樣、只讀標頭） */
type RowsHandler = (rows: string[][]) => void | boolean | Promise<void | boolean>;

/**
 * 找出 text 中最後一個「不在引號內」的換行之後的位置；找不到回傳 0。
 * 引號區段在段尾剛好遇到 "（無法判斷是否為跳脫）時保守地視為仍在引號內，該處之後不切。
 */
const findLastRowBoundary = (text: string): number => {
    let isInsideQuotedField = false;
    let isAtFieldStart = true;
    let lastBoundary = 0;
    for (let charIndex = 0; charIndex < text.length; charIndex++) {
        const charCode = text.charCodeAt(charIndex);
        if (isInsideQuotedField) {
            if (charCode === 0x22) {
                if (charIndex + 1 >= text.length) return lastBoundary;
                if (text.charCodeAt(charIndex + 1) === 0x22) charIndex++;
                else isInsideQuotedField = false;
            }
            continue;
        }
        if (charCode === 0x0A) { lastBoundary = charIndex + 1; isAtFieldStart = true; continue; }
        if (charCode === 0x0D) { isAtFieldStart = true; continue; }
        if (charCode === 0x22 && isAtFieldStart) { isInsideQuotedField = true; continue; }
        isAtFieldStart = charCode === 0x2C;
    }
    return lastBoundary;
};

/** 逐段取得資料列（含標頭列：第一批的第一列即為標頭）；onRows 回傳 false 即停止 */
export const parseCsvBlobInChunks = async (
    blob: Blob,
    onRows: RowsHandler,
    options: { chunkBytes?: number; skipEmptyLines?: boolean } = {}
): Promise<void> => {
    const chunkBytes = options.chunkBytes ?? DEFAULT_STREAM_CHUNK_BYTES;
    const skipEmptyLines = options.skipEmptyLines ?? true;
    const decoder = new TextDecoder('utf-8');
    let carryText = '';
    const emit = async (segmentText: string): Promise<boolean> => {
        if (!segmentText) return true;
        const rows = Papa.parse<string[]>(segmentText, { skipEmptyLines }).data as string[][];
        if (rows.length === 0) return true;
        return (await onRows(rows)) !== false;
    };
    for (let startOffset = 0; startOffset < blob.size; startOffset += chunkBytes) {
        const bytes = new Uint8Array(await blob.slice(startOffset, startOffset + chunkBytes).arrayBuffer());
        const bufferText = carryText + decoder.decode(bytes, { stream: true });
        const boundary = findLastRowBoundary(bufferText);
        carryText = bufferText.slice(boundary);
        if (boundary > 0 && !(await emit(bufferText.slice(0, boundary)))) return;
    }
    await emit(carryText + decoder.decode());
};

/** 只讀標頭列（讀到第一個完整資料列即停止） */
export const readCsvBlobHeader = async (blob: Blob): Promise<string[]> => {
    let headerCells: string[] = [];
    await parseCsvBlobInChunks(blob, (rows) => { headerCells = (rows[0] || []).map((cell) => String(cell)); return false; }, { chunkBytes: 64 * 1024 });
    return headerCells;
};

/** 讀出資料列（含標頭）；maxRows 指定時讀到該列數即停止（大檔抽樣用），不讀完整個檔案 */
export const readCsvBlobRows = async (blob: Blob, maxRows?: number): Promise<string[][]> => {
    const collectedRows: string[][] = [];
    await parseCsvBlobInChunks(blob, (rows) => {
        for (const row of rows) {
            if (maxRows !== undefined && collectedRows.length >= maxRows) return false;
            collectedRows.push(row);
        }
        return maxRows === undefined || collectedRows.length < maxRows;
    });
    return collectedRows;
};
