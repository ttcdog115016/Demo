/**
 * 檔案名稱 (File): timePeriodBounds.ts
 * 模組功能 (Description): K-匿名時間型「時間區間」泛化（後端 time_periods）的界線換算：畫面以「當日第幾分鐘」儲存，送後端為 "HH:MM"。
 *
 * ★ 2026-10-28：匯入統合版設定檔後執行 K-匿名，後端回 ERR_CONFIG_INVALID「就診時間（time_periods）第 4 段 min 必須小於 max，
 *   收到 min=64800、max=0」。根因：設定檔最後一段為 18:00～24:00，匯入時 24:00 存成 1440 分鐘，送出時卻以 % 1440 換算成 "00:00"，
 *   變成 18:00～00:00。另外 TimePicker 選不到 24:00，使用者把結束時間選成 00:00 想表示「到午夜」時也會遇到同樣的錯誤。
 *   改為：上界為 1440，或上界為 00:00 且下界大於 00:00 時，視為當天結束，送 "24:00"（後端接受，統合版範例即如此寫）。
 */

export const MINUTES_PER_DAY = 1440;

/** 上界是否代表「當天結束（24:00）」：1440，或 0 但下界在 00:00 之後（例如 18:00～00:00） */
export const isEndOfDayUpperBound = (lowerBoundMinutes: number | null, upperBoundMinutes: number | null): boolean => {
    if (upperBoundMinutes === null) return false;
    const roundedUpper = Math.round(upperBoundMinutes);
    if (roundedUpper >= MINUTES_PER_DAY) return true;
    return roundedUpper === 0 && lowerBoundMinutes !== null && Math.round(lowerBoundMinutes) > 0;
};

/** 當日分鐘數 → "HH:MM"（超出 0～1439 者繞回當天） */
export const formatMinutesOfDayAsHHMM = (totalMinutesValue: number): string => {
    const wrappedMinutesValue = ((Math.round(totalMinutesValue) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const hourTextValue = String(Math.floor(wrappedMinutesValue / 60)).padStart(2, '0');
    const minuteTextValue = String(wrappedMinutesValue % 60).padStart(2, '0');
    return `${hourTextValue}:${minuteTextValue}`;
};

/** 一段時間區間 → 後端 time_periods 項目；上界為當天結束時寫 "24:00" */
export const buildBackendTimePeriod = (bin: { min: number | null; max: number | null; label: string }): { min: string | null; max: string | null; label: string } => ({
    min: bin.min === null ? null : formatMinutesOfDayAsHHMM(bin.min),
    max: bin.max === null ? null : (isEndOfDayUpperBound(bin.min, bin.max) ? '24:00' : formatMinutesOfDayAsHHMM(bin.max)),
    label: bin.label
});

/** 畫面預覽：某時刻（當日分鐘數）是否落在區間內（含下界、不含上界；上界為當天結束時視為 1440） */
export const isMinuteInTimePeriod = (minuteOfDay: number, bin: { min: number | null; max: number | null }): boolean => {
    const effectiveUpper = bin.max === null ? null : (isEndOfDayUpperBound(bin.min, bin.max) ? MINUTES_PER_DAY : bin.max);
    return (bin.min === null || minuteOfDay >= bin.min) && (effectiveUpper === null || minuteOfDay < effectiveUpper);
};
