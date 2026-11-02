/**
 * ★ 2026-11-02（F12 追加）：欄位統計逐段掃描時，中文字落在段落邊界不可變成亂碼（U+FFFD），
 * 任意段落大小的統計結果都須與一次讀完相同。
 */
import { describe, it, expect } from 'vitest';
import { scanDatasetFileOnCurrentThread } from '../datasetProfileScanner';

const CSV = '﻿' + [
    '姓名,地區,年齡,生日,備註,地區',
    '王小明,臺北市大安區,25,1999-03-15,"多行\n備註",北',
    '李小華,新北市板橋區,37,1987-11-02,"含""引號""",北',
    '陳大文,臺中市西屯區,42,1982-06-30,,中',
    '林美麗,高雄市前鎮區,58,1966-01-09,"逗號,在內",南',
].join('\n') + '\n';

const fileOf = (text: string) => new File([text], 'data.csv', { lastModified: 1 });

describe('scanDatasetFileOnCurrentThread（逐段）', () => {
    it('任意段落大小的統計結果都與一次讀完相同，且沒有亂碼', async () => {
        const expected = await scanDatasetFileOnCurrentThread(fileOf(CSV), { chunkBytes: 1 << 20 });
        expect(JSON.stringify(expected)).not.toContain('�');
        for (const chunkBytes of [1, 2, 3, 5, 7, 11]) {
            const actual = await scanDatasetFileOnCurrentThread(fileOf(CSV), { chunkBytes });
            expect(actual, `chunkBytes=${chunkBytes}`).toEqual(expected);
        }
    });

    it('欄位與統計值正確；重複欄名比照 Papa 加 _1', async () => {
        const profile = await scanDatasetFileOnCurrentThread(fileOf(CSV), { chunkBytes: 4 });
        expect(profile.rowCount).toBe(4);
        expect(profile.columnNamesList).toEqual(['姓名', '地區', '年齡', '生日', '備註', '地區_1']);
        expect(profile.columns['地區'].topValues).toContain('臺北市大安區');
        expect(profile.columns['年齡'].numericMin).toBe(25);
        expect(profile.columns['年齡'].numericMax).toBe(58);
        expect(profile.columns['備註'].nonEmptyCount).toBe(3);
        expect(profile.dateTimeRanges?.['生日']).toMatchObject({ min: '1966-01-09', max: '1999-03-15', count: 4 });
    });
});
