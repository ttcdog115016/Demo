import { describe, it, expect } from 'vitest';
import { findEncodingCorruption, findReplacementCharInfo, findHeaderProblems, findStructureProblem } from '../csvUploadValidation';
import { detectByteOrderMark, detectCsvBytesEncoding, decodeCsvBytesToText } from '../csvEncodingDetect';

const csvText = '姓名,地區,職業\n' + Array.from({ length: 200 }, (_, i) => `王小明${i},大安區,工程師`).join('\n') + '\n';
const utf8 = (text: string) => new TextEncoder().encode(text);
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; }); return out; };
// 「亂碼」的 Big5 位元組
const big5Junk = new Uint8Array([0xB6, 0xC3, 0xBD, 0x58]);

describe('findEncodingCorruption：主要編碼正確、混入少量其他編碼', () => {
    it('UTF-8 檔案開頭混入 Big5 位元組 → 判定為 UTF-8 毀損並指出列號', () => {
        const info = findEncodingCorruption(concat(big5Junk, utf8(csvText)), false);
        expect(info?.baseEncoding).toBe('utf-8');
        expect(info?.firstInvalidLineNumber).toBe(1);
    });
    it('毀損在第 5 列 → 列號為 5', () => {
        const lines = csvText.split('\n');
        const bytes = concat(utf8(lines.slice(0, 4).join('\n') + '\n'), new Uint8Array([0xFF]), utf8(lines.slice(4).join('\n')));
        expect(findEncodingCorruption(bytes, false)?.firstInvalidLineNumber).toBe(5);
    });
    it('正常 UTF-8 → null', () => {
        expect(findEncodingCorruption(utf8(csvText), false)).toBeNull();
    });
});

describe('detectByteOrderMark', () => {
    it('真正的 UTF-16LE（含 BOM）', () => {
        const body = new Uint8Array(new Uint16Array([...csvText].map((ch) => ch.charCodeAt(0))).buffer);
        const bytes = concat(new Uint8Array([0xFF, 0xFE]), body);
        expect(detectByteOrderMark(bytes)).toBe('utf-16le');
        expect(decodeCsvBytesToText(bytes, detectCsvBytesEncoding(bytes)).startsWith('姓名,地區')).toBe(true);
    });
    it('UTF-8 檔案開頭剛好是 FF FE 垃圾位元組 → 不當成 UTF-16', () => {
        expect(detectByteOrderMark(concat(new Uint8Array([0xFF, 0xFE, 0xFD]), utf8(csvText)))).toBeNull();
    });
});

describe('findReplacementCharInfo', () => {
    it('回傳數量與第一次出現的列號', () => {
        expect(findReplacementCharInfo('a\nb\n�c�')).toEqual({ count: 2, firstLineNumber: 3 });
        expect(findReplacementCharInfo('abc')).toBeNull();
    });
});

describe('findHeaderProblems', () => {
    it('保留字、空白、重複、不可見字元', () => {
        const kinds = findHeaderProblems(['constructor', '', '姓名', '姓名', ' 地區', '​職業']).map((p) => `${p.kind}@${p.columnNumber}`);
        expect(kinds).toEqual(['reserved_name@1', 'empty_name@2', 'duplicate_name@4', 'invisible_or_space@5', 'invisible_or_space@6']);
    });
    it('名稱前加一般文字不算問題', () => {
        expect(findHeaderProblems(['亂碼姓名', '@#地區', 'xx職業'])).toEqual([]);
    });
});

describe('findStructureProblem', () => {
    it('未成對引號', () => {
        expect(findStructureProblem([{ type: 'Quotes', code: 'MissingQuotes', row: 0 }], 3, [{}])?.kind).toBe('unclosed_quote');
    });
    it('過半資料列欄位數不符 → 標題列錯誤', () => {
        const rows = Array.from({ length: 10 }, () => ({ a: '1', __parsed_extra: ['2', '3'] }));
        const errors = rows.map((_, i) => ({ type: 'FieldMismatch', code: 'TooManyFields', row: i }));
        expect(findStructureProblem(errors, 1, rows)).toEqual({ kind: 'header_mismatch', headerFieldCount: 1, typicalRowFieldCount: 3 });
    });
    it('少數列不符 → 不阻擋', () => {
        const rows = Array.from({ length: 10 }, () => ({ a: '1' }));
        expect(findStructureProblem([{ type: 'FieldMismatch', code: 'TooFewFields', row: 3 }], 1, rows)).toBeNull();
    });
});

import { cleanCsvHeaderLine, findHeaderLineEndIndex } from '../csvUploadValidation';
import Papa from 'papaparse';

describe('cleanCsvHeaderLine：自動清理標題列', () => {
    const rawHeader = (text: string) => (Papa.parse<string[]>(text, { preview: 1 }).data[0] as string[]);
    it('前後空白、零寬字元、NUL、引號內換行 → 清理標題列，資料列不動', () => {
        const text = ' 姓名,​年齡,"地\n區",\u0000疾病 \r\n 王小明 ,20,大安區,感冒\r\n';
        const { cleanedCsvText, changedColumns } = cleanCsvHeaderLine(text, rawHeader(text));
        expect(cleanedCsvText).toBe('姓名,年齡,地 區,疾病\r\n 王小明 ,20,大安區,感冒\r\n');
        expect(changedColumns.map((c) => c.columnNumber)).toEqual([1, 2, 3, 4]);
        expect(changedColumns[0].fromLabel).toBe('␣姓名');
    });
    it('沒有需要清理 → 原文字不變', () => {
        const text = '姓名,年齡\n王,1\n';
        expect(cleanCsvHeaderLine(text, rawHeader(text))).toEqual({ cleanedCsvText: text, changedColumns: [] });
    });
    it('含逗號的欄名保留引號', () => {
        const text = '" a,b ",c\n1,2\n';
        expect(cleanCsvHeaderLine(text, rawHeader(text)).cleanedCsvText).toBe('"a,b",c\n1,2\n');
    });
    it('findHeaderLineEndIndex 忽略引號內換行', () => {
        expect(findHeaderLineEndIndex('"a\nb",c\n1,2')).toBe(8);
        expect(findHeaderLineEndIndex('a,b')).toBe(3);
    });
});

import { findSpecialCharacterCells } from '../csvUploadValidation';

describe('findSpecialCharacterCells：資料內容特殊字元', () => {
    const text = '姓名,身分證號,年齡,地區,生日,疾病\n'
        + '**金品生,S328109140,@$$88,!#中正區,:{}1938-11-26,$%感冒\n'
        + '郭彥晴,U399332011,21,大安區,2005-04-01,心臟病\n'
        + '連雅然,$$A329968611,44,中正區,1982-06-05,高血壓\r\n';
    it('列出列號、欄位、內容，同一格多個字元只算一格', () => {
        const r = findSpecialCharacterCells(text)!;
        expect(r.cellCount).toBe(6);
        expect(r.examples.slice(0, 3)).toEqual([
            { lineNumber: 2, columnName: '姓名', cellValue: '**金品生' },
            { lineNumber: 2, columnName: '年齡', cellValue: '@$$88' },
            { lineNumber: 2, columnName: '地區', cellValue: '!#中正區' }
        ]);
        expect(r.examples).toHaveLength(5);
        expect(r.foundCharacters).toEqual(expect.arrayContaining(['*', '@', '$', '!', '#', '{', '}', '%']));
    });
    it('第 4 列（CRLF 結尾）也正確定位', () => {
        const r = findSpecialCharacterCells('a,b\n1,2\n3,4\r\n5,$6\r\n')!;
        expect(r.examples[0]).toEqual({ lineNumber: 4, columnName: 'b', cellValue: '$6' });
    });
    it('欄位名稱列也檢查', () => {
        expect(findSpecialCharacterCells('@#姓名,年齡\n王,1\n')!.examples[0]).toEqual({ lineNumber: 1, columnName: '@#姓名', cellValue: '@#姓名' });
    });
    it('正常資料（日期、電話、地址、引號內逗號）不擋', () => {
        expect(findSpecialCharacterCells('姓名,電話,地址,生日,備註\n王,+886-2-1234(5678),"臺北市大安區, 1 號",1990/01/02 10:30,A&B_c.d\'e\n')).toBeNull();
    });
    it('全形特殊字元也擋', () => {
        expect(findSpecialCharacterCells('a\n＊王\n')?.cellCount).toBe(1);
    });
});

import { stripSpecialCharacters, findTypedColumnOutliers, isSpecialCharacterExemptValue } from '../csvUploadValidation';
import { findDeclaredTypeConflicts } from '../columnTypeConsistency';
import { createColumnValueStats, addValueToColumnStats } from '../backendValueRules';

describe('第 3 級：特殊字元例外與移除', () => {
    it('完整 Email、百分比不算特殊字元', () => {
        expect(isSpecialCharacterExemptValue('wang.xm@ttc.org.tw')).toBe(true);
        expect(isSpecialCharacterExemptValue('12.5%')).toBe(true);
        expect(isSpecialCharacterExemptValue('@$$88')).toBe(false);
        expect(findSpecialCharacterCells('姓名,Email,比例\n王,wang@ttc.org.tw,12%\n')).toBeNull();
    });
    it('移除特殊字元：只刪清單字元，Email 不動，引號內逗號保留', () => {
        const { csvText, changedCellCount } = stripSpecialCharacters('姓名,Email,地址\n**金品生,a@b.com,"臺北市, #3"\n');
        expect(csvText).toBe('姓名,Email,地址\n金品生,a@b.com,"臺北市, 3"\n');
        expect(changedCellCount).toBe(2);
    });
    it('移除後殘留的開頭冒號一併去除，時間中的冒號保留', () => {
        expect(stripSpecialCharacters('生日,時間\n:{}1938-11-26,10:30\n').csvText).toBe('生日,時間\n1938-11-26,10:30\n');
    });
});

describe('第 2 級：數值／日期欄位異常值', () => {
    const rows = Array.from({ length: 20 }, (_, i) => `王${i},${20 + i},1990-01-${String(i + 1).padStart(2, '0')},10491`);
    it('大多是數字／日期的欄位，列出無法轉換的值與列號', () => {
        const text = '姓名,年齡,生日,郵遞區號\n' + [...rows.slice(0, 5), '金,@$$88,:{}1938-11-26,10491A', ...rows.slice(5)].join('\n') + '\n';
        const outliers = findTypedColumnOutliers(text);
        expect(outliers.map((o) => `${o.columnName}:${o.kind}:${o.badCount}`)).toEqual(['年齡:numeric:1', '生日:date:1', '郵遞區號:numeric:1']);
        expect(outliers[0].examples[0]).toEqual({ lineNumber: 7, cellValue: '@$$88' });
    });
    it('文字欄位、全部正常 → 無異常', () => {
        expect(findTypedColumnOutliers('姓名,年齡\n' + rows.map((r) => r.split(',').slice(0, 2).join(',')).join('\n'))).toEqual([]);
    });
    it('Step2 宣告為數值／日期時依資料集統計擋下', () => {
        const ageStats = createColumnValueStats(); ['20', '三十', '30', 'NA'].forEach((v) => addValueToColumnStats(ageStats, v));
        const birthStats = createColumnValueStats(); ['1990-01-02', '1990-01-03', '不詳'].forEach((v) => addValueToColumnStats(birthStats, v));
        const col = (valueStats: ReturnType<typeof createColumnValueStats>) => ({ nonEmptyCount: 0, distinctCount: 0, isDistinctCountCapped: false, topValues: [], numericCount: 0, nonNumericDistinctValues: [], valueStats });
        const profile = { fileKey: 'k', rowCount: 4, columnNamesList: ['年齡', '生日'], numericValues: {}, columns: { 年齡: col(ageStats), 生日: col(birthStats) } };
        expect(findDeclaredTypeConflicts([{ columnName: '年齡', kind: 'numeric' }, { columnName: '生日', kind: 'date' }], profile)).toEqual([
            { columnName: '年齡', kind: 'numeric', badCount: 1, examples: ['三十'] },
            { columnName: '生日', kind: 'date', badCount: 1, examples: ['不詳'] }
        ]);
        expect(findDeclaredTypeConflicts([{ columnName: '年齡', kind: 'numeric' }], null)).toEqual([]);
    });
});
