import { describe, it, expect } from 'vitest';
import { inferDpFieldTypeFromProfile } from '../dpTypeInference';
import type { DatasetProfile, DatasetColumnProfile } from '../datasetProfile';

const col = (overrides: Partial<DatasetColumnProfile>): DatasetColumnProfile => ({
    nonEmptyCount: 100, distinctCount: 10, isDistinctCountCapped: false, topValues: [], numericCount: 0, nonNumericDistinctValues: [], ...overrides
});

const profile: DatasetProfile = {
    fileKey: 'k', rowCount: 100, columnNamesList: [],
    columns: {
        bmi: col({ numericCount: 100, distinctCount: 60 }),
        是否憂鬱症: col({ numericCount: 100, distinctCount: 2 }),
        人種: col({ distinctCount: 5 }),
        教育水平: col({ distinctCount: 4 }),
        姓名: col({ distinctCount: 98 }),
        備註: col({ distinctCount: 30, nonEmptyCount: 40 }),
        入院日: col({ distinctCount: 80 }),
        空欄: col({ nonEmptyCount: 0, distinctCount: 0 }),
        超多值: col({ distinctCount: 200000, isDistinctCountCapped: true })
    },
    numericValues: {},
    dateTimeRanges: { 入院日: { min: '2020-01-01', max: '2024-12-31', count: 100 } }
};

describe('DP 推薦：依實際資料判斷資料型態（比照 K-匿名）', () => {
    it('全部是數字 → 數值型（含 0/1 旗標，與 K-匿名規則相同）', () => {
        expect(inferDpFieldTypeFromProfile(profile, 'bmi')).toEqual({ fieldType: 'Numeric', isDateTime: false });
        expect(inferDpFieldTypeFromProfile(profile, '是否憂鬱症')).toEqual({ fieldType: 'Numeric', isDateTime: false });
    });
    it('全部是日期 → 數值型（日期時間）', () => {
        expect(inferDpFieldTypeFromProfile(profile, '入院日')).toEqual({ fieldType: 'Numeric', isDateTime: true });
    });
    it('相異值少的文字 → 類別型', () => {
        expect(inferDpFieldTypeFromProfile(profile, '人種')?.fieldType).toBe('Categorical');
        expect(inferDpFieldTypeFromProfile(profile, '教育水平')?.fieldType).toBe('Categorical');
    });
    it('相異值多（或佔比高）的文字 → 文字型', () => {
        expect(inferDpFieldTypeFromProfile(profile, '姓名')?.fieldType).toBe('Text');
        expect(inferDpFieldTypeFromProfile(profile, '備註')?.fieldType).toBe('Text');
        expect(inferDpFieldTypeFromProfile(profile, '超多值')?.fieldType).toBe('Text');
    });
    it('整欄皆空、欄位不存在、尚未掃描 → 無法判斷', () => {
        expect(inferDpFieldTypeFromProfile(profile, '空欄')).toBeNull();
        expect(inferDpFieldTypeFromProfile(profile, '不存在')).toBeNull();
        expect(inferDpFieldTypeFromProfile(null, 'bmi')).toBeNull();
    });
    it('欄位名稱帶 BOM 也能對上', () => {
        expect(inferDpFieldTypeFromProfile(profile, '\uFEFFbmi')?.fieldType).toBe('Numeric');
    });
});
