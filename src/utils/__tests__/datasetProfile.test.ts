// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ensureDatasetProfile, getColumnUniqueValueRatio, getColumnNumericRange, buildDatasetFileKey } from '../datasetProfile';
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

    it('日期欄位記錄最早／最晚值（午夜只留日期、帶時間者到秒），非日期欄位不列入', async () => {
        const csvFile = buildCsvFile('生日,就診時間,地區\n1974-06-18,2026-01-01 08:30:15,大安區\n1938-11-26,2026-01-02,板橋區\n,2025-12-31 23:00,大安區\n2005-02-01,x,大安區\n');
        useWorkspaceStore.setState({ dataFile: csvFile });
        const profile = await ensureDatasetProfile(csvFile);
        expect(profile.dateTimeRanges).toEqual({
            生日: { min: '1938-11-26', max: '2005-02-01', count: 3 },
            就診時間: { min: '2025-12-31 23:00:00', max: '2026-01-02', count: 3 }
        });
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

    it('記錄數值最小／最大值，getColumnNumericRange 優先讀快照（2026-10-30）', async () => {
        const csvFile = buildCsvFile('年齡,地區\n30,大安區\n-5,板橋區\n88,x\n');
        useWorkspaceStore.setState({ dataFile: csvFile });
        const profile = await ensureDatasetProfile(csvFile);
        expect(profile.columns['年齡']).toMatchObject({ numericMin: -5, numericMax: 88 });
        expect(profile.columns['地區'].numericMin).toBeUndefined();
        expect(getColumnNumericRange(profile, profile.numericValues, '年齡')).toEqual({ min: -5, max: 88 });
        // 舊快照沒有 numericMin／numericMax 時逐筆計算
        expect(getColumnNumericRange(null, { 薪資: [3, 1, 2] }, '薪資')).toEqual({ min: 1, max: 3 });
        expect(getColumnNumericRange(profile, profile.numericValues, '地區')).toBeNull();
    });

    it('非目前資料集的檔案（Step4 前處理後）結果另外快取，不寫入 store、第二次不重掃（2026-10-30）', async () => {
        const currentFile = buildCsvFile('a\n1\n');
        const preprocessedFile = buildCsvFile('a\n1\n2\n', 'preprocessed.csv');
        useWorkspaceStore.setState({ dataFile: currentFile });
        const firstProfile = await ensureDatasetProfile(preprocessedFile);
        expect(firstProfile.rowCount).toBe(2);
        expect(useWorkspaceStore.getState().datasetProfile).toBeNull();
        expect(useWorkspaceStore.getState().isColumnCategoricalValuesScanning).toBe(false);
        expect(await ensureDatasetProfile(preprocessedFile)).toBe(firstProfile);
    });

    it('瀏覽器支援 Worker 時在 Worker 中掃描；Worker 啟動失敗時退回主執行緒，結果相同', async () => {
        const csvFile = buildCsvFile('年齡\n30\n45\n', 'worker.csv');
        useWorkspaceStore.setState({ dataFile: csvFile });
        const createdWorkers: string[] = [];
        vi.stubGlobal('Worker', class { constructor(url: URL) { createdWorkers.push(String(url)); throw new Error('worker not available'); } });
        try {
            const profile = await ensureDatasetProfile(csvFile);
            expect(createdWorkers).toHaveLength(1);
            expect(createdWorkers[0]).toContain('datasetProfile.worker');
            expect(profile.columns['年齡']).toMatchObject({ numericCount: 2, numericMin: 30, numericMax: 45 });
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
