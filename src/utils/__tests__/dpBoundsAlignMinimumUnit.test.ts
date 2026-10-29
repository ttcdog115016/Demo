// TODO【待後端確認：DP格點起算點】：後端若改為從下限起算，以下預期值需改寫
import { describe, it, expect } from 'vitest';
import { alignDpBoundsToMinimumUnit } from '../dpFieldHelpers';

// 2026-10-06：Price 刻度 20、鏡像，輸出出現 30、50（非 20 倍數）——上下限未對齊刻度所致
describe('alignDpBoundsToMinimumUnit', () => {
    it('邊界向外對齊刻度倍數', () => {
        expect(alignDpBoundsToMinimumUnit(15, 58, 20)).toEqual({ lower: 0, upper: 60, changed: true });
        expect(alignDpBoundsToMinimumUnit(-15, 45, 20)).toEqual({ lower: -20, upper: 60, changed: true });
    });
    it('已是倍數時不變', () => {
        expect(alignDpBoundsToMinimumUnit(0, 300000, 1000)).toEqual({ lower: 0, upper: 300000, changed: false });
        expect(alignDpBoundsToMinimumUnit(0, 120, 1)).toEqual({ lower: 0, upper: 120, changed: false });
    });
    it('小數刻度不受浮點誤差影響', () => {
        expect(alignDpBoundsToMinimumUnit(0.3, 0.7, 0.1)).toEqual({ lower: 0.3, upper: 0.7, changed: false });
        expect(alignDpBoundsToMinimumUnit(1.25, 3.31, 0.5)).toEqual({ lower: 1, upper: 3.5, changed: true });
    });
    it('刻度或邊界無效時不對齊', () => {
        expect(alignDpBoundsToMinimumUnit(15, 58, undefined)).toBeNull();
        expect(alignDpBoundsToMinimumUnit(15, 58, 0)).toBeNull();
        expect(alignDpBoundsToMinimumUnit('', 58, 20)).toBeNull();
    });
    it('對齊後的邊界做鏡像，輸出仍是刻度倍數', () => {
        const unit = 20;
        const { lower, upper } = alignDpBoundsToMinimumUnit(15, 58, unit)!;
        const reflect = (v: number) => (v < lower ? 2 * lower - v : v > upper ? 2 * upper - v : v);
        for (let k = -5; k <= 8; k++) expect(Math.abs(reflect(k * unit) % unit)).toBe(0); // 負數取餘得 -0
        // 未對齊（下限 15）時會得到 30、50
        const reflectRaw = (v: number) => (v < 15 ? 30 - v : v);
        expect([reflectRaw(0), reflectRaw(-20)]).toEqual([30, 50]);
    });
});

import { alignDpDateTimeBoundsToNoiseGrid } from '../dpFieldHelpers';

// 2026-10-06：EntryTime 步階 7 天、截斷，輸出出現 2024-01-01（下限）而非 7 天格點（1970-01-01 起算，2024-01-04 為格點）
describe('alignDpDateTimeBoundsToNoiseGrid', () => {
    it('7 天步階：邊界向外對齊到 1970-01-01 起算的 7 天格點', () => {
        expect(alignDpDateTimeBoundsToNoiseGrid('2024-01-01 07:00:00', '2024-01-05 19:00:00', 'day', 7))
            .toEqual({ lower: '2023-12-28', upper: '2024-01-11', changed: true });
    });
    it('13 秒步階', () => {
        const aligned = alignDpDateTimeBoundsToNoiseGrid('2024-01-01 00:00:00', '2024-01-05 23:59:59', 'second', 13)!;
        expect(Date.parse(aligned.lower.replace(' ', 'T') + 'Z') / 1000 % 13).toBe(0);
        expect(Date.parse(aligned.upper.replace(' ', 'T') + 'Z') / 1000 % 13).toBe(0);
        expect(aligned.changed).toBe(true);
    });
    it('步階 1 天、邊界為整日時不變', () => {
        expect(alignDpDateTimeBoundsToNoiseGrid('1930-01-01', '2026-12-31', 'day', 1))
            .toEqual({ lower: '1930-01-01', upper: '2026-12-31', changed: false });
    });
    it('無效時不對齊', () => {
        expect(alignDpDateTimeBoundsToNoiseGrid('abc', '2026-12-31', 'day', 7)).toBeNull();
        expect(alignDpDateTimeBoundsToNoiseGrid('2024-01-01', '2026-12-31', 'day', 0)).toBeNull();
    });
});
