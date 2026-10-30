/**
 * 檔案名稱 (File): processedCsvPreview.ts
 * 模組功能 (Description): Step4「結果預覽對照」讀取去識別化輸出檔的前幾筆。
 *
 * ★ 2026-10-30：先前以 Papa.parse(File, { preview: 10 }) 以為會串流讀取，但 PapaParse 沒有 step／chunk 回呼時
 *   會把 chunkSize 設為 null（papaparse.js ChunkStreamer），整份檔案一次讀成字串。交通部 500 萬筆輸出 610 MB
 *   超過瀏覽器字串長度上限，讀回空字串，預覽 0 筆並報 UndetectableDelimiter。
 *   改用 step 逐列收集，只讀第一個區塊；湊滿筆數即 parser.abort()——只靠 preview 的話，step 模式下 PapaParse
 *   仍會把後面的區塊全部讀完才呼叫 complete。
 */
import Papa from 'papaparse';

export const PROCESSED_PREVIEW_ROW_LIMIT = 10;
export const PROCESSED_PREVIEW_CHUNK_SIZE = 1024 * 1024;

export interface ProcessedCsvPreviewResult
{
    data: Record<string, unknown>[];
    errors: Papa.ParseError[];
}

/** 讀取 CSV Blob 的前 rowLimit 筆（標頭開頭的 BOM／零寬字元去除，與上傳原始檔時的清理方式一致） */
export const parseProcessedCsvPreview = (csvBlob: Blob, rowLimit: number = PROCESSED_PREVIEW_ROW_LIMIT): Promise<ProcessedCsvPreviewResult> =>
    new Promise((resolve, reject) => {
        const previewRowsList: Record<string, unknown>[] = [];
        const previewParseErrorsList: Papa.ParseError[] = [];
        let isSettled = false;
        // 包成 File（不複製內容）才符合 PapaParse 的串流讀檔型別
        Papa.parse<Record<string, unknown>>(new File([csvBlob], 'processed_preview.csv', { type: 'text/csv' }), {
            header: true,
            skipEmptyLines: true,
            preview: rowLimit,
            chunkSize: PROCESSED_PREVIEW_CHUNK_SIZE,
            transformHeader: (rawHeaderName: string) => rawHeaderName.replace(/^[\uFEFF\u200B]+/, ''),
            step: (rowResult, parser) => {
                previewRowsList.push(rowResult.data);
                previewParseErrorsList.push(...rowResult.errors);
                if (previewRowsList.length >= rowLimit) parser.abort();
            },
            complete: () => {
                if (isSettled) return;
                isSettled = true;
                resolve({ data: previewRowsList, errors: previewParseErrorsList });
            },
            error: (error: Error) => {
                if (isSettled) return;
                isSettled = true;
                reject(error);
            }
        });
    });
