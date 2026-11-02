/**
 * ★ 2026-11-02（F12）：Step1 上傳檢查改為逐段讀取 Blob（不產生整檔字串）。
 *   以極小的段落大小（chunkBytes）驗證：跨段邊界（含中文 3 位元組、引號內換行、CRLF）的結果與一次處理整份文字相同；
 *   超過抽樣門檻時只檢查前段，最後一筆不完整的資料列略過。
 */
import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import {
    forEachCsvRecordBatch, readCsvHeadText, detectCsvDelimiterFromHeadText, isCsvBlobSampled,
    findReplacementCharInfo, findReplacementCharInfoInBlob,
    findSpecialCharacterCells, findSpecialCharacterCellsInBlob,
    findTypedColumnOutliers, findTypedColumnOutliersInBlob,
    stripSpecialCharacters, stripSpecialCharactersInBlob,
    cleanCsvHeaderLine, cleanCsvHeaderInBlob,
} from '../csvUploadValidation';
import { detectCsvBytesEncoding, CSV_ENCODING_DETECTION_SAMPLE_BYTES } from '../csvEncodingDetect';
import { transcodeToUtf8Blob } from '../blobStreaming';

const blobOf = (text: string) => new Blob([new TextEncoder().encode(text)]);
const CHUNK_SIZES = [1, 2, 3, 5, 7, 16, 64, 1024];

const rows = Array.from({ length: 30 }, (_, i) => `王小明${i},${20 + i},1990-01-${String((i % 28) + 1).padStart(2, '0')},"臺北市\n大安區, ${i} 號"`);
const sampleCsv = '姓名,年齡,生日,地址\r\n'
    + [...rows.slice(0, 5), '**金品生,@$$88,:{}1938-11-26,"!#中正區"', ...rows.slice(5, 12), '郭彥晴,三十,2005-04-01,"a ""quoted"" $val"', ...rows.slice(12)].join('\r\n')
    + '\r\n';

describe('forEachCsvRecordBatch：每段都是完整資料列', () => {
    it.each(CHUNK_SIZES)('chunkBytes=%i：串起來等於原文，且每段都能獨立被 PapaParse 解析成相同資料列', async (chunkBytes) => {
        const batches: string[] = [];
        await forEachCsvRecordBatch(blobOf(sampleCsv), (text) => batches.push(text), { chunkBytes });
        expect(batches.join('')).toBe(sampleCsv);
        const rowsByBatch = batches.flatMap((text) => Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }).data);
        expect(rowsByBatch).toEqual(Papa.parse<string[]>(sampleCsv, { skipEmptyLines: 'greedy' }).data);
    });
    it('dropIncompleteTail：最後一筆不完整的資料列不交出', async () => {
        const batches: string[] = [];
        await forEachCsvRecordBatch(blobOf('a,b\n1,2\n3,'), (text) => batches.push(text), { chunkBytes: 2, dropIncompleteTail: true });
        expect(batches.join('')).toBe('a,b\n1,2\n');
    });
});

describe('readCsvHeadText：只讀開頭幾筆', () => {
    it('讀到足夠筆數即停止，PapaParse preview 結果與整份文字相同', async () => {
        const headText = await readCsvHeadText(blobOf(sampleCsv), 6, { chunkBytes: 7 });
        expect(headText.length).toBeLessThan(sampleCsv.length);
        const options = { header: true, skipEmptyLines: true, preview: 5 } as const;
        expect(Papa.parse(headText, options).data).toEqual(Papa.parse(sampleCsv, options).data);
    });
    it('小檔案讀完整份', async () => {
        expect(await readCsvHeadText(blobOf('a,b\n1,2'), 1001, { chunkBytes: 3 })).toBe('a,b\n1,2');
    });
    it('未成對引號：讀到上限仍回傳，PapaParse 照樣報引號錯誤', async () => {
        const text = 'a,b\n1,"2\n' + '3,4\n'.repeat(50);
        const headText = await readCsvHeadText(blobOf(text), 1001, { chunkBytes: 8, maxBytes: 32 });
        expect(Papa.parse(headText, { header: true }).errors.some((e) => e.type === 'Quotes')).toBe(true);
    });
    it('detectCsvDelimiterFromHeadText', () => {
        expect(detectCsvDelimiterFromHeadText('a;b;c\n1;2;3\n4;5;6\n')).toBe(';');
        expect(detectCsvDelimiterFromHeadText('a,b\n1,2\n')).toBe(',');
    });
});

describe('Blob 版檢查結果與字串版相同（跨段邊界）', () => {
    it.each(CHUNK_SIZES)('chunkBytes=%i：特殊字元、數值／日期異常值、替代字元', async (chunkBytes) => {
        const blob = blobOf(sampleCsv);
        expect(await findSpecialCharacterCellsInBlob(blob, { chunkBytes })).toEqual(findSpecialCharacterCells(sampleCsv));
        expect(await findTypedColumnOutliersInBlob(blob, { chunkBytes })).toEqual(findTypedColumnOutliers(sampleCsv));
        const corrupted = sampleCsv.replace('王小明7', '王�明7');
        expect(await findReplacementCharInfoInBlob(blobOf(corrupted), { chunkBytes })).toEqual(findReplacementCharInfo(corrupted));
        expect(await findReplacementCharInfoInBlob(blob, { chunkBytes })).toBeNull();
    });
    it('結果符合預期（防止兩邊一起錯）', async () => {
        const special = await findSpecialCharacterCellsInBlob(blobOf(sampleCsv), { chunkBytes: 5 });
        expect(special?.cellCount).toBe(5);
        expect(special?.examples[0]).toEqual({ lineNumber: 12, columnName: '姓名', cellValue: '**金品生' });
        const outliers = await findTypedColumnOutliersInBlob(blobOf(sampleCsv), { chunkBytes: 5 });
        expect(outliers.map((o) => `${o.columnName}:${o.kind}:${o.badCount}`)).toEqual(['年齡:numeric:2', '生日:date:1']);
    });
    it('分號分隔檔案：指定分隔字元後結果與字串版相同', async () => {
        const text = sampleCsv.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/gm, ';');
        expect(await findTypedColumnOutliersInBlob(blobOf(text), { chunkBytes: 3, delimiter: ';' })).toEqual(findTypedColumnOutliers(text));
    });
});

describe('抽樣：超過門檻只檢查前段', () => {
    const header = 'name,age\n';
    const normalRows = Array.from({ length: 20 }, (_, i) => `n${i},${i}\n`).join('');
    const text = header + normalRows + 'bad,$$\n' + 'x,�\n';
    it('門檻以內的內容才檢查；切片切斷的最後一列略過', async () => {
        const samplingBytes = (header + normalRows).length + 4; // 切在「bad,$$」中間
        const blob = blobOf(text);
        expect(isCsvBlobSampled(blob, samplingBytes)).toBe(true);
        expect(await findSpecialCharacterCellsInBlob(blob, { samplingBytes, chunkBytes: 3 })).toBeNull();
        expect(await findReplacementCharInfoInBlob(blob, { samplingBytes, chunkBytes: 3 })).toBeNull();
        expect((await findSpecialCharacterCellsInBlob(blob, { chunkBytes: 3 }))?.cellCount).toBe(1);
        expect(await findReplacementCharInfoInBlob(blob, { chunkBytes: 3 })).toEqual({ count: 1, firstLineNumber: 23 });
    });
    it('抽樣切在中文字中間不會誤報替代字元', async () => {
        const chinese = '姓名\n' + '王小明\n'.repeat(10);
        const blob = blobOf(chinese);
        expect(await findReplacementCharInfoInBlob(blob, { samplingBytes: 4 + 10 * 2 + 1, chunkBytes: 4 })).toBeNull();
    });
    it('未超過門檻不抽樣', () => {
        expect(isCsvBlobSampled(blobOf(text))).toBe(false);
    });
});

describe('stripSpecialCharactersInBlob', () => {
    it.each(CHUNK_SIZES)('chunkBytes=%i：結果與字串版相同', async (chunkBytes) => {
        const expected = stripSpecialCharacters(sampleCsv);
        const { strippedBlob, changedCellCount } = await stripSpecialCharactersInBlob(blobOf(sampleCsv), { chunkBytes });
        expect(changedCellCount).toBe(expected.changedCellCount);
        expect(await strippedBlob.text()).toBe(expected.csvText);
    });
    it('分號分隔：沿用第一段判斷的分隔字元', async () => {
        const text = 'a;b\n**x;1\ny;$2\n';
        const { strippedBlob, changedCellCount } = await stripSpecialCharactersInBlob(blobOf(text), { chunkBytes: 2 });
        expect(changedCellCount).toBe(2);
        expect(await strippedBlob.text()).toBe(stripSpecialCharacters(text).csvText);
    });
});

describe('cleanCsvHeaderInBlob：只改寫標題列', () => {
    const rawHeader = (text: string) => (Papa.parse<string[]>(text, { preview: 1 }).data[0] as string[]);
    it('多位元組標題、引號內換行、CRLF：與字串版相同，其餘內容以切片接上', async () => {
        const text = ' 姓名,​年齡,"地\n區",\u0000疾病 \r\n 王小明 ,20,大安區,感冒\r\n';
        const headText = await readCsvHeadText(blobOf(text), 1, { chunkBytes: 4 });
        const { cleanedBlob, changedColumns } = await cleanCsvHeaderInBlob(blobOf(text), headText, rawHeader(headText));
        const expected = cleanCsvHeaderLine(text, rawHeader(text));
        expect(await cleanedBlob.text()).toBe(expected.cleanedCsvText);
        expect(changedColumns).toEqual(expected.changedColumns);
    });
    it('原 Blob 開頭有 BOM 時一併去除', async () => {
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), new TextEncoder().encode(' 姓名,年齡\n王,1\n')]);
        const headText = await readCsvHeadText(blob, 1);
        const { cleanedBlob } = await cleanCsvHeaderInBlob(blob, headText, rawHeader(headText));
        expect(await cleanedBlob.text()).toBe('姓名,年齡\n王,1\n');
    });
    it('沒有需要清理 → 回傳同一個 Blob', async () => {
        const blob = blobOf('姓名,年齡\n王,1\n');
        const { cleanedBlob, changedColumns } = await cleanCsvHeaderInBlob(blob, '姓名,年齡\n', ['姓名', '年齡']);
        expect(cleanedBlob).toBe(blob);
        expect(changedColumns).toEqual([]);
    });
});

describe('非 UTF-8：只以檔頭樣本偵測編碼，再逐段轉成 UTF-8', () => {
    it('Big5 大檔：樣本偵測（告知完整大小）＋ transcodeToUtf8Blob', async () => {
        const big5Unit = [0xA6, 0x61, 0xB0, 0xCF, 0x0D, 0x0A]; // 「地區」CRLF
        const repeat = Math.ceil((CSV_ENCODING_DETECTION_SAMPLE_BYTES + 100) / big5Unit.length);
        const bytes = new Uint8Array(1 + repeat * big5Unit.length);
        bytes[0] = 0x41;
        for (let i = 0; i < repeat; i++) bytes.set(big5Unit, 1 + i * big5Unit.length);
        const file = new Blob([bytes]);
        const sample = new Uint8Array(await file.slice(0, CSV_ENCODING_DETECTION_SAMPLE_BYTES).arrayBuffer());
        expect(detectCsvBytesEncoding(sample, file.size)).toBe('big5');
        const utf8Blob = await transcodeToUtf8Blob(file, 'big5', 7);
        const headText = await readCsvHeadText(utf8Blob, 2, { chunkBytes: 5 });
        expect(headText).toBe('A地區\r\n地區\r\n');
        expect(await findReplacementCharInfoInBlob(utf8Blob, { chunkBytes: 1000 })).toBeNull();
    });
});
