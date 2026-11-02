/**
 * ★ 2026-11-02（F12）：大檔分段處理（utils/blobStreaming.ts）。用極小的段落大小，驗證跨段邊界的結果與一次讀完相同。
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
    forEachDecodedChunk, stripLeadingBom, transcodeToUtf8Blob, createCsvRowCounter, countCsvDataRowsInBlob, sha256HexOfBlobStreaming,
} from '../blobStreaming';
import { countCsvDataRowsForStats } from '../riskResultHelpers';

const blobOf = (text: string) => new Blob([new TextEncoder().encode(text)]);

const decodeAll = async (blob: Blob, chunkBytes: number): Promise<string> => {
    const parts: string[] = [];
    await forEachDecodedChunk(blob, (text) => { parts.push(text); }, { chunkBytes });
    return parts.join('');
};

describe('forEachDecodedChunk', () => {
    it('中文（UTF-8 三個位元組）被段落邊界切開時仍正確解碼', async () => {
        const text = '姓名,地區\n王小明,臺北市大安區\n李小華,新北市\n';
        for (const chunkBytes of [1, 2, 3, 5, 7]) {
            expect(await decodeAll(blobOf(text), chunkBytes)).toBe(text);
        }
    });

    it('maxBytes：只讀前段（抽樣檢查用）', async () => {
        const parts: string[] = [];
        await forEachDecodedChunk(blobOf('abcdef'), (t) => { parts.push(t); }, { chunkBytes: 2, maxBytes: 4 });
        expect(parts.join('')).toBe('abcd');
    });
});

describe('stripLeadingBom', () => {
    it('去掉 BOM 與零寬空白，其餘內容不變；沒有時回傳原物件', async () => {
        const withBom = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF, 0xE2, 0x80, 0x8B]), 'a,b\n1,2\n']);
        expect(await (await stripLeadingBom(withBom)).text()).toBe('a,b\n1,2\n');
        const plain = blobOf('a,b\n');
        expect(await stripLeadingBom(plain)).toBe(plain);
    });
});

describe('transcodeToUtf8Blob', () => {
    it('Big5 逐段轉成 UTF-8，與一次轉換結果相同', async () => {
        // 「中文」的 Big5 編碼：A4 A4 A4 E5
        const big5 = new Blob([new Uint8Array([0xA4, 0xA4, 0xA4, 0xE5, 0x0A])]);
        const utf8 = await transcodeToUtf8Blob(big5, 'big5', 1);
        expect(await utf8.text()).toBe('中文\n');
    });
});

describe('createCsvRowCounter', () => {
    const samples = [
        'a,b\n1,2\n3,4\n',
        'a,b\r\n1,2\r\n3,4',
        '﻿"x",y\n"多行\r\n內容",1\n"含""引號""",2\n\n  \n5,6\n',
        'a\n"未結束的引號\n1\n',
        '',
        'only-header\n',
    ];

    it('任意段落大小（含 1 字元）結果都與一次計算相同', () => {
        for (const sample of samples) {
            const expected = countCsvDataRowsForStats(sample);
            for (const size of [1, 2, 3, 4]) {
                const counter = createCsvRowCounter();
                for (let index = 0; index < sample.length; index += size) counter.push(sample.slice(index, index + size));
                expect(counter.finish(), JSON.stringify({ sample, size })).toBe(expected);
            }
        }
    });

    it('引號內換行與 "" 跳脫：計為同一筆資料', async () => {
        expect(await countCsvDataRowsInBlob(blobOf('h\n"a\nb",1\n"c""\n",2\n'), 1)).toBe(2);
    });
});

describe('sha256HexOfBlobStreaming', () => {
    it('分段累加的結果與一次計算相同', async () => {
        const bytes = new TextEncoder().encode('姓名,地區\n王小明,臺北市\n'.repeat(50));
        const expected = createHash('sha256').update(bytes).digest('hex');
        for (const chunkBytes of [1, 7, 64, 100000]) {
            expect(await sha256HexOfBlobStreaming(new Blob([bytes]), chunkBytes)).toBe(expected);
        }
    });
});
