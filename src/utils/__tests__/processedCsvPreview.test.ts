// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseProcessedCsvPreview, PROCESSED_PREVIEW_CHUNK_SIZE } from '../processedCsvPreview';

const HEADER = '﻿ID,IDType,EntryStationName,EntryTime';
const buildCsv = (rowCount: number): string =>
    [HEADER, ...Array.from({ length: rowCount }, (_, rowIndex) => `id${rowIndex},EasyCard,市政府,2026-09-07`)].join('\r\n') + '\r\n';

describe('Step4 結果預覽：只讀檔案開頭（2026-10-30 交通部 610 MB 預覽 0 筆）', () => {
    afterEach(() => vi.restoreAllMocks());

    it('取前 10 筆、去除標頭 BOM，CRLF 換行', async () => {
        const result = await parseProcessedCsvPreview(new Blob([buildCsv(50)], { type: 'text/csv' }));
        expect(result.data).toHaveLength(10);
        expect(result.data[0]).toEqual({ ID: 'id0', IDType: 'EasyCard', EntryStationName: '市政府', EntryTime: '2026-09-07' });
        expect(result.errors).toEqual([]);
    });

    it('大檔只讀第一個區塊，不會把整份檔案讀成字串', async () => {
        const readSizesList: number[] = [];
        const originalReadAsText = FileReader.prototype.readAsText;
        vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader, blob: Blob, encoding?: string) {
            readSizesList.push(blob.size);
            return originalReadAsText.call(this, blob, encoding);
        });
        // 約 3 個區塊大小
        const largeCsvText = buildCsv(Math.ceil((PROCESSED_PREVIEW_CHUNK_SIZE * 3) / 40));
        const result = await parseProcessedCsvPreview(new Blob([largeCsvText], { type: 'text/csv' }));
        expect(result.data).toHaveLength(10);
        expect(readSizesList).toEqual([PROCESSED_PREVIEW_CHUNK_SIZE]);
    });

    it('資料少於 10 筆時回傳全部', async () => {
        const result = await parseProcessedCsvPreview(new Blob([buildCsv(3)], { type: 'text/csv' }));
        expect(result.data.map((row) => row.ID)).toEqual(['id0', 'id1', 'id2']);
    });
});
