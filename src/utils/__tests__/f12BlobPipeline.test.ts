/**
 * ★ 2026-11-02（F12）：Step4 大檔改以 Blob 逐段處理後，結果須與原本「整份字串」版本一致。
 * 段落大小刻意設得很小，讓資料列、引號區段、中文字元都跨段落邊界。
 */
import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { parseCsvBlobInChunks, readCsvBlobHeader, readCsvBlobRows } from '../csvBlobParse';
import { projectCsvTextToColumns, transformCsvBlobForRiskUpload } from '../riskUploadTrimming';
import { applySensitiveBinningToCsvText } from '../sensitiveBinning';
import { encodeCsvForCapBaseline, encodeCsvBlobForCapBaseline } from '../capBaseline';
import { computeKAnonymityFidelity, computeKAnonymityFidelityFromBlobs } from '../kAnonymityFidelity';

const CSV = [
    '姓名,年齡,地區,備註,疾病',
    '王小明,25,臺北市,"多行\n備註",感冒',
    '李小華,37,新北市,"含""引號""",糖尿病',
    '',
    '陳大文,42,臺中市,,感冒',
    '林美麗,58,高雄市,"逗號,在內",高血壓',
].join('\n') + '\n';

const parseRows = (text: string) => Papa.parse<string[]>(text, { skipEmptyLines: true }).data;

describe('parseCsvBlobInChunks', () => {
    it('任意段落大小都與一次解析相同（引號內換行、"" 跳脫、空白行、中文）', async () => {
        const expected = parseRows(CSV);
        for (const chunkBytes of [1, 2, 5, 13, 64, 4096]) {
            const rows: string[][] = [];
            await parseCsvBlobInChunks(new Blob([CSV]), (batch) => { rows.push(...batch); }, { chunkBytes });
            expect(rows, `chunkBytes=${chunkBytes}`).toEqual(expected);
        }
    });

    it('讀標頭、讀前 N 列即停止', async () => {
        expect(await readCsvBlobHeader(new Blob([CSV]))).toEqual(['姓名', '年齡', '地區', '備註', '疾病']);
        expect((await readCsvBlobRows(new Blob([CSV]), 3)).length).toBe(3);
        expect(await readCsvBlobRows(new Blob([CSV]))).toEqual(parseRows(CSV));
    });
});

describe('transformCsvBlobForRiskUpload', () => {
    it('欄位裁切＋分級距：與原本字串版本的結果相同', async () => {
        const keep = new Set(['年齡', '地區', '疾病']);
        const bins = { 年齡: 10 };
        const expected = parseRows(applySensitiveBinningToCsvText(projectCsvTextToColumns(CSV, keep).csvText, bins));
        const blob = await transformCsvBlobForRiskUpload(new Blob([CSV]), keep, bins, { chunkBytes: 7 });
        expect(parseRows(await blob.text())).toEqual(expected);
    });

    it('不需裁切也不需分級距時回傳原 Blob（不複製）', async () => {
        const source = new Blob([CSV]);
        expect(await transformCsvBlobForRiskUpload(source, null, {})).toBe(source);
    });
});

describe('encodeCsvBlobForCapBaseline', () => {
    it('與字串版本編碼結果相同', async () => {
        expect(await encodeCsvBlobForCapBaseline(new Blob([CSV]), 3)).toEqual(encodeCsvForCapBaseline(CSV));
    });
});

describe('computeKAnonymityFidelityFromBlobs', () => {
    const original = ['年齡,地區,疾病', ...Array.from({ length: 40 }, (_, index) => `${20 + (index % 30)},${['臺北市', '新北市', '臺中市'][index % 3]},${['感冒', '糖尿病'][index % 2]}`)].join('\n') + '\n';
    const processed = original.replace(/臺北市|新北市/g, '北部');
    const baseInput = { evaluatedColumns: ['年齡', '地區', '疾病'], anchorColumns: ['年齡', '疾病'] };

    it('未超過門檻：與字串版本結果相同', async () => {
        const expected = computeKAnonymityFidelity({ ...baseInput, originalCsvText: original, processedCsvText: processed });
        const actual = await computeKAnonymityFidelityFromBlobs({ ...baseInput, originalCsvBlob: new Blob([original]), processedCsvBlob: new Blob([processed]) });
        expect(actual).toEqual(expected);
    });

    it('超過門檻：只讀前段並標示抽樣', async () => {
        const actual = await computeKAnonymityFidelityFromBlobs({
            ...baseInput,
            originalCsvBlob: new Blob([original]),
            processedCsvBlob: new Blob([processed]),
            samplingThresholdBytes: 10,
            sampleRowLimit: 15,
        });
        expect(actual?.sampled).toBe(true);
        expect(actual?.sampleRows).toBeLessThanOrEqual(15);
    });
});
