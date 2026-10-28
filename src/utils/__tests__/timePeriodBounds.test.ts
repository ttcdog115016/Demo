/**
 * ★ 2026-10-28：time_periods 上界 24:00（統合版設定檔匯入後後端回 ERR_CONFIG_INVALID：第 4 段 min=64800、max=0）。
 */
import { describe, it, expect } from 'vitest';
import { buildBackendTimePeriod, isEndOfDayUpperBound, isMinuteInTimePeriod, formatMinutesOfDayAsHHMM } from '../timePeriodBounds';

describe('time_periods 界線換算', () => {
    it('上界 1440（匯入的 24:00）送 "24:00"，不再變成 "00:00"', () => {
        expect(buildBackendTimePeriod({ min: 1080, max: 1440, label: '晚間' })).toEqual({ min: '18:00', max: '24:00', label: '晚間' });
    });

    it('TimePicker 把結束時間選成 00:00、下界在其後：視為當天結束', () => {
        expect(buildBackendTimePeriod({ min: 1080, max: 0, label: '晚間' }).max).toBe('24:00');
        expect(isEndOfDayUpperBound(1080, 0)).toBe(true);
        expect(isEndOfDayUpperBound(0, 0)).toBe(false);
        expect(isEndOfDayUpperBound(null, 0)).toBe(false);
    });

    it('一般時段照舊', () => {
        expect(buildBackendTimePeriod({ min: 0, max: 360, label: '凌晨' })).toEqual({ min: '00:00', max: '06:00', label: '凌晨' });
        expect(buildBackendTimePeriod({ min: null, max: null, label: '全部' })).toEqual({ min: null, max: null, label: '全部' });
        expect(formatMinutesOfDayAsHHMM(1439)).toBe('23:59');
    });

    it('畫面預覽：23:30 落在 18:00～24:00（不論存成 1440 或 0）', () => {
        expect(isMinuteInTimePeriod(1410, { min: 1080, max: 1440 })).toBe(true);
        expect(isMinuteInTimePeriod(1410, { min: 1080, max: 0 })).toBe(true);
        expect(isMinuteInTimePeriod(1000, { min: 1080, max: 0 })).toBe(false);
    });
});
