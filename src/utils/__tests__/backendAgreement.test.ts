/**
 * ★ 2026-10-05：前端「能否轉成數值／日期」判斷與後端實測結果的對照表。
 *   每一列都是以使用者本機後端（/api/v1/k-anonymity、/api/v1/dp）實際送出得到的結果：
 *   60 筆正常資料中第 6 筆換成指定值。後端規則改變時，請重新實測並更新此表。
 */
import { describe, it, expect } from 'vitest';
import { createColumnValueStats, addValueToColumnStats, evaluateNumericConflict, evaluateDateConflict } from '../backendValueRules';

const p2 = (n: number) => String(n).padStart(2, '0');
const columnWith = (base: (i: number) => string, override: string | null) => {
    const stats = createColumnValueStats();
    for (let i = 0; i < 60; i++) addValueToColumnStats(stats, (i === 5 && override !== null ? override : base(i)).trim(), i + 2);
    return stats;
};
const age = (i: number) => String(20 + (i % 50));
const dash = (i: number) => `1990-${p2((i % 12) + 1)}-${p2((i % 28) + 1)}`;
const slash = (i: number) => `1990/${p2((i % 12) + 1)}/${p2((i % 28) + 1)}`;
const iso = (i: number) => `${dash(i)}T10:00:00Z`;
const dt = (i: number) => `${dash(i)} 10:00:00`;
const nopad = (i: number) => `1990-${(i % 12) + 1}-${(i % 28) + 1}`;

// [說明, 欄位產生器, 第 6 筆替換值, 後端是否成功]
const NUMERIC_CASES: [string, (i: number) => string, string | null, boolean][] = [
    ['全部數字', age, null, true], ['NA', age, 'NA', true], ['N/A', age, 'N/A', true], ['NULL', age, 'NULL', true], ['空白', age, '', true],
    ['-', age, '-', false], ['未知', age, '未知', false], ['三十', age, '三十', false], ['1,234', age, '1,234', false], ['0x1A', age, '0x1A', false], ['@$$88', age, '@$$88', false]
];
const DATE_CASES: [string, (i: number) => string, string | null, boolean][] = [
    ['全欄 YYYY-MM-DD', dash, null, true], ['全欄 YYYY/MM/DD', slash, null, true], ['全欄 ISO+Z', iso, null, true], ['全欄 日期+時間', dt, null, true],
    ['全欄 不補零', nopad, null, true], ['混 1990-1-2（不補零）', dash, '1990-1-2', true], ['混 空白', dash, '', true], ['混 NULL', dash, 'NULL', true], ['混 NA', dash, 'NA', true],
    ['混 1990/1/2', dash, '1990/1/2', false], ['混 ISO+Z', dash, '1990-01-02T10:00:00Z', false], ['混 19900102', dash, '19900102', false],
    ['混 Jan 2 1990', dash, 'Jan 2 1990', false], ['混 民國79年1月2日', dash, '民國79年1月2日', false], ['混 不詳', dash, '不詳', false],
    ['混 :{}1938-11-26', dash, ':{}1938-11-26', false], ['混 日期+時間', dash, '1990-01-02 10:00:00', false], ['日期+時間 混 純日期', dt, '1990-01-02', false],
    ['混 2 月 30 日', dash, '1990-02-30', false]
];

describe('與後端實測結果一致', () => {
    it.each(NUMERIC_CASES)('數值欄：%s', (_title, base, override, backendOk) => {
        expect(evaluateNumericConflict(columnWith(base, override)) === null).toBe(backendOk);
    });
    it.each(DATE_CASES)('日期欄：%s', (_title, base, override, backendOk) => {
        expect(evaluateDateConflict(columnWith(base, override)) === null).toBe(backendOk);
    });
});
