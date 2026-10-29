/**
 * ★ 2026-10-29：子群體篩選與後端 engines/risk/subset.py 對齊——
 *   區間邊界只送數值（日期欄位不提供區間）；像數字的類別值同時送數值版本，讓後端讀成整數的代碼欄也比對得到。
 */
import { describe, it, expect } from 'vitest';
import { buildBackendSubgroupPayload, resolveColumnKindForSubgroup } from '../riskSubgroupHelpers';

describe('子群體篩選送後端的格式', () => {
    it('日期欄位改用類別值清單，數值欄位維持區間', () => {
        expect(resolveColumnKindForSubgroup('生日', 'k-anonymity', { 生日: 'Temporal' }, [])).toBe('categorical');
        expect(resolveColumnKindForSubgroup('年齡', 'k-anonymity', { 年齡: 'Numeric' }, [])).toBe('range');
    });

    it('區間只送數值；填的不是數字就不送該側，兩側都無效則略過該欄', () => {
        expect(buildBackendSubgroupPayload({
            年齡: { kind: 'range', min: '30', max: 'abc' },
            薪資: { kind: 'range', min: 'x', max: '' },
        })).toEqual({ 年齡: { min: 30 } });
    });

    it('像數字的類別值同時送字串與數值；0 開頭的代碼只送字串', () => {
        expect(buildBackendSubgroupPayload({
            地區代碼: { kind: 'categorical', values: ['1', '007', '大安區'] },
        })).toEqual({ 地區代碼: ['1', 1, '007', '大安區'] });
    });
});
