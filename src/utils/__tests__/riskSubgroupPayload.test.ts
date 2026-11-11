/**
 * ★ 2026-10-29：子群體篩選與後端 engines/risk/subset.py 對齊——
 *   區間邊界同為數值或同為日期字串 YYYY-MM-DD；像數字的類別值同時送數值版本，讓後端讀成整數的代碼欄也比對得到。
 */
import { describe, it, expect } from 'vitest';
import { buildBackendSubgroupPayload, resolveColumnKindForSubgroup } from '../riskSubgroupHelpers';
import type { DPField } from '../../store/useWorkspaceStore';

describe('子群體篩選送後端的格式', () => {
    it('日期與數值欄位皆用區間，文字欄位用類別值清單', () => {
        expect(resolveColumnKindForSubgroup('生日', 'k-anonymity', { 生日: 'Temporal' }, [])).toBe('range');
        expect(resolveColumnKindForSubgroup('年齡', 'k-anonymity', { 年齡: 'Numeric' }, [])).toBe('range');
        expect(resolveColumnKindForSubgroup('地區', 'k-anonymity', { 地區: 'Categorical' }, [])).toBe('categorical');
        const dpDateField = { fieldName: '就診日', fieldType: 'Numeric', isDateTime: true } as unknown as DPField;
        expect(resolveColumnKindForSubgroup('就診日', 'differential-privacy', {}, [dpDateField])).toBe('range');
    });

    it('日期區間送 YYYY-MM-DD 字串，可只給一側；與數值混填時只送日期那側', () => {
        expect(buildBackendSubgroupPayload({
            生日: { kind: 'range', min: '1980-01-01', max: '1989-12-31' },
            就診日: { kind: 'range', min: '', max: '2024-06-30' },
            入院日: { kind: 'range', min: '2024-01-01', max: '30' },
        })).toEqual({
            生日: { min: '1980-01-01', max: '1989-12-31' },
            就診日: { max: '2024-06-30' },
            入院日: { min: '2024-01-01' },
        });
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
