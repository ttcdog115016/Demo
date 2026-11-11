/**
 * K-匿名時間型間接識別欄位「時間粒度」策略的時間單位與層級換算。
 *
 * 後端 config_kanon.json 的語意：generalization_hierarchies.<欄位>.levels 列出可用的時間單位（細到粗），
 * qi_generalization_levels.<欄位> 的數字 N 代表泛化到 levels 的第 N 個單位（1 起算；0 為不泛化）。
 * 同一個數字在不同 levels 清單下代表不同單位，例如 levels=[day, month, year] 時層級 3 是「年」，
 * levels=[minute, hour, day, month, year] 時層級 3 是「日」。
 *
 * ★ 2026-10-28：加回「秒」（後端 v2.0.0 levels 支援 second），層級 1～6 依序為 秒／分／時／日／月／年。
 * ★ 2026-10-01：前端改為固定使用 TEMPORAL_GRANULARITY_UNITS（分／時／日／月／年，已移除「秒」），層級 1～5
 *   依序對應；匯入時依設定檔自己的 levels 把層級換算成時間單位，再對應回前端層級。先前一律當成
 *   [秒, 分, 時, 日, 月, 年] 六級解讀，config_kanon.json 的「生日：層級 3（年）」被誤判成「時」。
 */

/** 前端可選的時間單位（細到粗）；送給後端的 levels 即此清單，層級 = 索引 + 1 */
export const TEMPORAL_GRANULARITY_UNITS = ['second', 'minute', 'hour', 'day', 'month', 'year'] as const;
export type TemporalGranularityUnit = typeof TEMPORAL_GRANULARITY_UNITS[number];

/** 後端可能出現的全部時間單位（細到粗），用來把前端不提供的單位（如 second）對應到最接近的較粗單位 */
const BACKEND_TEMPORAL_UNIT_ORDER = ['second', 'minute', 'hour', 'day', 'month', 'year'] as const;

/** 新設定欄位的預設層級：月 */
export const TEMPORAL_DEFAULT_GRANULARITY_LEVEL = TEMPORAL_GRANULARITY_UNITS.indexOf('month') + 1;

/** 前端層級 → 時間單位；超出範圍或 0 時回傳 null */
export const temporalUnitOfLevel = (level: number | null | undefined): TemporalGranularityUnit | null =>
    typeof level === 'number' && level >= 1 && level <= TEMPORAL_GRANULARITY_UNITS.length
        ? TEMPORAL_GRANULARITY_UNITS[Math.floor(level) - 1]
        : null;

/**
 * 把匯入設定檔的（levels 清單, 層級數字）換算成前端層級。
 * - 層級 0：不泛化，原樣回傳 0
 * - 單位不在前端清單時：對應到最接近、不比它細的前端單位（目前前端清單與後端相同）
 * - levels 清單缺漏或層級超出清單範圍：回傳 null，由呼叫端套用預設值
 */
export const resolveImportedTemporalLevel = (importedLevels: unknown, importedLevel: unknown): number | null => {
    if (importedLevel === 0) return 0;
    if (!Array.isArray(importedLevels) || typeof importedLevel !== 'number' || !Number.isFinite(importedLevel)) return null;
    const importedUnitName = String(importedLevels[Math.floor(importedLevel) - 1] ?? '').trim().toLowerCase();
    const backendUnitIndex = BACKEND_TEMPORAL_UNIT_ORDER.indexOf(importedUnitName as typeof BACKEND_TEMPORAL_UNIT_ORDER[number]);
    if (backendUnitIndex < 0) return null;
    // 前端清單是後端完整清單去掉 second，找第一個不比它細的前端單位
    for (let frontendIndex = 0; frontendIndex < TEMPORAL_GRANULARITY_UNITS.length; frontendIndex++) {
        if (BACKEND_TEMPORAL_UNIT_ORDER.indexOf(TEMPORAL_GRANULARITY_UNITS[frontendIndex]) >= backendUnitIndex) return frontendIndex + 1;
    }
    return null;
};
