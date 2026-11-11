import { describe, it, expect } from 'vitest';
import { detectCsvBytesEncoding, decodeCsvBytesToText, CSV_ENCODING_DETECTION_SAMPLE_BYTES } from '../csvEncodingDetect';

const buildChineseCsv = (rowCount: number, extra = ''): string =>
    '姓名,身分證,年齡,地區\r\n' +
    Array.from({ length: rowCount }, (_, i) => `王小明${extra},A123456789,${i},臺北市大安區\r\n`).join('');

describe('detectCsvBytesEncoding', () => {
    it('大於 64KB 的 UTF-8 中文檔，不論截斷點落在中文字哪個位元組，都判定為 utf-8（不會退到 windows-1252）', () => {
        const baseBytes = new TextEncoder().encode(buildChineseCsv(3000));
        expect(baseBytes.length).toBeGreaterThan(CSV_ENCODING_DETECTION_SAMPLE_BYTES);
        // 模擬「編輯後檔案前段多/少幾個位元組」：在開頭塞 0~11 個 ASCII，讓截斷點位移
        for (let shift = 0; shift < 12; shift++) {
            const shifted = new Uint8Array(baseBytes.length + shift);
            shifted.fill(0x41, 0, shift);
            shifted.set(baseBytes, shift);
            expect(detectCsvBytesEncoding(shifted)).toBe('utf-8');
        }
    });

    it('小檔案（整份為樣本）仍完整驗證，結尾是中文字也正確', () => {
        expect(detectCsvBytesEncoding(new TextEncoder().encode('地區\r\n臺北'))).toBe('utf-8');
    });

    it('UTF-8 BOM 判定為 utf-8-bom 並去除 BOM', () => {
        const body = new TextEncoder().encode('地區\r\n臺北\r\n');
        const withBom = new Uint8Array([0xEF, 0xBB, 0xBF, ...body]);
        expect(detectCsvBytesEncoding(withBom)).toBe('utf-8-bom');
        expect(decodeCsvBytesToText(withBom, 'utf-8-bom')).toBe('地區\r\n臺北\r\n');
    });

    it('Big5 檔案（大於 64KB）判定為 big5 並正確解碼', () => {
        // 「地區」Big5 = A6 61 B0 CF；以 Big5 雙位元組重複填滿，並在開頭放 1 個 ASCII 讓截斷點落在字中間
        const big5Unit = [0xA6, 0x61, 0xB0, 0xCF, 0x0D, 0x0A];
        const repeat = Math.ceil((CSV_ENCODING_DETECTION_SAMPLE_BYTES + 100) / big5Unit.length);
        const bytes = new Uint8Array(1 + repeat * big5Unit.length);
        bytes[0] = 0x41;
        for (let i = 0; i < repeat; i++) bytes.set(big5Unit, 1 + i * big5Unit.length);
        expect(detectCsvBytesEncoding(bytes)).toBe('big5');
        expect(decodeCsvBytesToText(bytes, 'big5').slice(0, 5)).toBe('A地區\r\n');
    });
});
