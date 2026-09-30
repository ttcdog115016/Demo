// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureDatasetProfile, getColumnUniqueValueRatio, buildDatasetFileKey } from '../datasetProfile';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

const buildCsvFile = (csvText: string, fileName = 'sample.csv'): File =>
    new File([csvText], fileName, { type: 'text/csv', lastModified: 1 });

describe('datasetProfile 欄位統計快照', () => {
    beforeEach(() => {
        useWorkspaceStore.setState({ dataFile: null, datasetProfile: null, datasetColumnNumericValuesMap: {}, columnCategoricalUniqueValues: {} });
    });

    it('統計筆數、相異值、常見值與數值，並寫入 store', async () => {
        const csvFile = buildCsvFile('﻿年齡,地區,薪資\n30,大安區,50000\n30,板橋區,\n45,大安區,abc\n');
        useWorkspaceStore.setState({ dataFile: csvFile });

        const profile = await ensureDatasetProfile(csvFile);

        expect(profile.rowCount).toBe(3);
        expect(profile.columnNamesList).toEqual(['年齡', '地區', '薪資']); // 開頭 BOM 已去除
        expect(profile.columns['年齡']).toMatchObject({ nonEmptyCount: 3, distinctCount: 2, numericCount: 3 });
        expect(profile.columns['地區'].topValues[0]).toBe('大安區'); // 出現 2 次，排第一
        expect(profile.columns['薪資']).toMatchObject({ nonEmptyCount: 2, numericCount: 1, nonNumericDistinctValues: ['abc'] });
        expect(profile.numericValues['年齡']).toEqual([30, 30, 45]);
        expect(profile.numericValues['地區']).toBeUndefined();

        const storeState = useWorkspaceStore.getState();
        expect(storeState.datasetProfile?.fileKey).toBe(buildDatasetFileKey(csvFile));
        expect(storeState.datasetColumnNumericValuesMap['薪資']).toEqual([50000]);
        expect(storeState.columnCategoricalUniqueValues['地區']).toEqual(['大安區', '板橋區']);
    });

    it('同一份檔案重複呼叫只掃描一次（回傳同一份結果）', async () => {
        const csvFile = buildCsvFile('a\n1\n2\n');
        useWorkspaceStore.setState({ dataFile: csvFile });
        const [firstProfile, secondProfile] = await Promise.all([ensureDatasetProfile(csvFile), ensureDatasetProfile(csvFile)]);
        expect(secondProfile).toBe(firstProfile);
        expect(await ensureDatasetProfile(csvFile)).toBe(firstProfile);
    });

    it('相異值佔比：一般情況為相異值數 ÷ 非空筆數，被截斷時保守回傳 1', async () => {
        const csvFile = buildCsvFile('id,flag\n1,Y\n2,Y\n3,N\n4,Y\n');
        useWorkspaceStore.setState({ dataFile: csvFile });
        const profile = await ensureDatasetProfile(csvFile);
        expect(getColumnUniqueValueRatio(profile, 'id')).toBe(1);
        expect(getColumnUniqueValueRatio(profile, 'flag')).toBe(0.5);

        const cappedProfile = { ...profile, columns: { ...profile.columns, flag: { ...profile.columns.flag, isDistinctCountCapped: true } } };
        expect(getColumnUniqueValueRatio(cappedProfile, 'flag')).toBe(1);
        expect(getColumnUniqueValueRatio(profile, '不存在的欄位')).toBe(0);
    });
});
