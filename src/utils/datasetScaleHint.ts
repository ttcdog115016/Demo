/**
 * ============================================================================
 * 檔案名稱 (File): datasetScaleHint.ts
 * 模組功能 (Description): 依「資料筆數」產生 Step3 保護強度旁的資料規模提示（K-匿名／差分隱私）。
 * ============================================================================
 * ★ 2026-10-08 諮詢會（郭博鈞執行長）：參數的安全程度與原始資料筆數有關——健保資料 2,000 萬人與小型單位
 *   數千筆資料套用相同 K 值（例如 5），代表的安全程度並不相同，建議將輸入資料筆數納入考量。
 *
 *   ⚠ 規模分級門檻（DATASET_SCALE_SMALL_MAX_ROWS／DATASET_SCALE_LARGE_MIN_ROWS）為前端「暫定參考值」，
 *   只用來決定顯示哪一段提醒文字，不會阻擋操作、也不會改變送給後端的參數；
 *   正式門檻待研究團隊依文獻與機關需求確認後再調整（見專案文件「待辦_2026-10-05諮詢會_前端工作清單」）。
 */

/** 小型資料上限（未滿此筆數視為小型）— 暫定 */
export const DATASET_SCALE_SMALL_MAX_ROWS = 1000;
/** 大型資料下限（達此筆數視為大型）— 暫定 */
export const DATASET_SCALE_LARGE_MIN_ROWS = 1000000;

export type DatasetScaleLevel = 'unknown' | 'small' | 'medium' | 'large';

/** 依資料筆數分級；0 或非數字代表尚未載入資料 */
export const classifyDatasetScale = (rowCount: number | null | undefined): DatasetScaleLevel =>
{
    const safeRowCount = Number(rowCount);
    if (!Number.isFinite(safeRowCount) || safeRowCount <= 0) return 'unknown';
    if (safeRowCount < DATASET_SCALE_SMALL_MAX_ROWS) return 'small';
    if (safeRowCount >= DATASET_SCALE_LARGE_MIN_ROWS) return 'large';
    return 'medium';
};

export interface KGroupShareInfo
{
    /** 每群最少筆數佔全部資料的百分比（K / N × 100） */
    groupSharePercent: number;
    /** 全部資料最多能分成幾群（floor(N / K)） */
    maxGroupCount: number;
}

/** 計算 K 值相對於資料筆數的比例；資料未載入或 K 不合法時回傳 null */
export const computeKGroupShare = (kValue: number | null | undefined, rowCount: number | null | undefined): KGroupShareInfo | null =>
{
    const safeK = Number(kValue);
    const safeRowCount = Number(rowCount);
    if (!Number.isFinite(safeK) || !Number.isFinite(safeRowCount) || safeK < 1 || safeRowCount <= 0) return null;
    return {
        groupSharePercent: (safeK / safeRowCount) * 100,
        maxGroupCount: Math.floor(safeRowCount / safeK),
    };
};

/**
 * 百分比顯示：≥1% 取一位小數；更小時保留兩位有效數字（例如 0.00025%），避免顯示成 0%。
 */
export const formatSharePercentText = (percentValue: number): string =>
{
    if (!Number.isFinite(percentValue) || percentValue <= 0) return '0%';
    if (percentValue >= 1) return `${Number(percentValue.toFixed(1))}%`;
    return `${Number(percentValue.toPrecision(2))}%`;
};
