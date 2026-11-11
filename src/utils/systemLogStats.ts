/**
 * 檔案名稱 (File): systemLogStats.ts
 * 模組功能 (Description): 系統維運日誌圖表的統計（純函式，方便測試）。
 * ★ 2026-10-29 新增：系統設定 →「系統維運日誌」分頁的事件趨勢圖與 API 呼叫圖（見 features/settings/SystemLogCharts.tsx）。
 */
import type { SystemLogEntry, SystemLogLevel } from '../store/useSystemLogStore';

export type SystemLogRangeKey = '1h' | '24h' | '7d' | 'all';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 各期間的長度（all＝不限）與趨勢圖分桶大小 */
export const SYSTEM_LOG_RANGE_CONFIG: Record<SystemLogRangeKey, { spanMs: number | null; bucketMs: number }> = {
	'1h': { spanMs: HOUR_MS, bucketMs: 5 * MINUTE_MS },
	'24h': { spanMs: DAY_MS, bucketMs: HOUR_MS },
	'7d': { spanMs: 7 * DAY_MS, bucketMs: DAY_MS },
	all: { spanMs: null, bucketMs: DAY_MS },
};

/** 「全部」最多畫幾天（避免很久以前的零星紀錄把圖拉得很長） */
const MAX_ALL_RANGE_DAYS = 90;

/** 期間起點（epoch 毫秒）；all 回傳 undefined */
export const resolveRangeStartMs = (rangeKey: SystemLogRangeKey, nowMs: number = Date.now()): number | undefined =>
{
	const spanMs = SYSTEM_LOG_RANGE_CONFIG[rangeKey].spanMs;
	return spanMs === null ? undefined : nowMs - spanMs;
};

export const filterLogsByRange = (logs: SystemLogEntry[], rangeKey: SystemLogRangeKey, nowMs: number = Date.now()): SystemLogEntry[] =>
{
	const rangeStartMs = resolveRangeStartMs(rangeKey, nowMs);
	return rangeStartMs === undefined ? logs : logs.filter((logEntry) => logEntry.timestamp >= rangeStartMs);
};

export interface LevelTrend
{
	bucketStartsMs: number[];                        // 每桶起點（由舊到新）
	bucketMs: number;
	counts: Record<SystemLogLevel, number[]>;        // 與 bucketStartsMs 同長度
}

/** 依期間分桶統計各層級事件數；分桶對齊本地時間（每 5 分／整點／午夜） */
export const buildLevelTrend = (logs: SystemLogEntry[], rangeKey: SystemLogRangeKey, nowMs: number = Date.now()): LevelTrend =>
{
	const { bucketMs } = SYSTEM_LOG_RANGE_CONFIG[rangeKey];
	const alignToBucket = (timestampMs: number): number =>
	{
		const dateObj = new Date(timestampMs);
		if (bucketMs >= DAY_MS) { dateObj.setHours(0, 0, 0, 0); return dateObj.getTime(); }
		if (bucketMs >= HOUR_MS) { dateObj.setMinutes(0, 0, 0); return dateObj.getTime(); }
		dateObj.setSeconds(0, 0);
		dateObj.setMinutes(dateObj.getMinutes() - (dateObj.getMinutes() % (bucketMs / MINUTE_MS)));
		return dateObj.getTime();
	};

	const rangeLogs = filterLogsByRange(logs, rangeKey, nowMs);
	let firstBucketMs = alignToBucket(resolveRangeStartMs(rangeKey, nowMs) ?? (rangeLogs.length > 0 ? Math.min(...rangeLogs.map((logEntry) => logEntry.timestamp)) : nowMs));
	if (rangeKey === 'all') firstBucketMs = Math.max(firstBucketMs, alignToBucket(nowMs - MAX_ALL_RANGE_DAYS * DAY_MS));
	const lastBucketMs = alignToBucket(nowMs);

	const bucketStartsMs: number[] = [];
	// 以「下一個對齊點」前進，日光節約等非整數小時的日子也不會錯位
	for (let bucketStart = firstBucketMs; bucketStart <= lastBucketMs; bucketStart = alignToBucket(bucketStart + bucketMs + (bucketMs >= DAY_MS ? 2 * HOUR_MS : 0)))
	{
		bucketStartsMs.push(bucketStart);
		if (bucketStartsMs.length > 400) break; // 防呆
	}

	const bucketIndexByStart = new Map(bucketStartsMs.map((bucketStart, bucketIndex) => [bucketStart, bucketIndex]));
	const counts: Record<SystemLogLevel, number[]> = {
		INFO: bucketStartsMs.map(() => 0),
		WARN: bucketStartsMs.map(() => 0),
		ERROR: bucketStartsMs.map(() => 0),
	};
	rangeLogs.forEach((logEntry) =>
	{
		const bucketIndex = bucketIndexByStart.get(alignToBucket(logEntry.timestamp));
		if (bucketIndex !== undefined && counts[logEntry.level]) counts[logEntry.level][bucketIndex] += 1;
	});
	return { bucketStartsMs, bucketMs, counts };
};

/** 趨勢圖 X 軸標籤：依分桶大小顯示 MM/DD 或 HH:mm */
export const formatBucketLabel = (bucketStartMs: number, bucketMs: number): string =>
{
	const dateObj = new Date(bucketStartMs);
	const padTwo = (numberValue: number): string => String(numberValue).padStart(2, '0');
	if (bucketMs >= DAY_MS) return `${padTwo(dateObj.getMonth() + 1)}/${padTwo(dateObj.getDate())}`;
	return `${padTwo(dateObj.getHours())}:${padTwo(dateObj.getMinutes())}`;
};

export interface ApiEndpointStats
{
	endpoint: string;            // 例：POST /risk/cap
	source: string;              // 日誌原始來源，例：POST /api/v1/risk/cap（點圖篩表格用）
	successCount: number;
	failureCount: number;
	averageSeconds: number | null;
	maxSeconds: number | null;
}

const API_SOURCE_PATTERN = /^[A-Z]+ \/api\//;
const ELAPSED_SECONDS_PATTERN = /耗時 ([\d.]+) 秒/;

/** 依 API 路徑統計成功／失敗次數與耗時（耗時取自 apiErrorInterceptor 寫入的「耗時 N 秒」）；依呼叫次數由多到少 */
export const buildApiEndpointStats = (logs: SystemLogEntry[]): ApiEndpointStats[] =>
{
	const statsBySource = new Map<string, { successCount: number; failureCount: number; elapsedList: number[] }>();
	logs.forEach((logEntry) =>
	{
		if (!API_SOURCE_PATTERN.test(logEntry.source)) return;
		const isSuccess = logEntry.level === 'INFO' && logEntry.event.startsWith('後端 API 呼叫成功');
		const isFailure = logEntry.level !== 'INFO';
		if (!isSuccess && !isFailure) return; // 使用者取消運算等，不算成功也不算失敗
		const sourceStats = statsBySource.get(logEntry.source) ?? { successCount: 0, failureCount: 0, elapsedList: [] };
		if (isSuccess) sourceStats.successCount += 1; else sourceStats.failureCount += 1;
		const elapsedMatch = ELAPSED_SECONDS_PATTERN.exec(logEntry.event);
		if (elapsedMatch) sourceStats.elapsedList.push(Number(elapsedMatch[1]));
		statsBySource.set(logEntry.source, sourceStats);
	});
	return Array.from(statsBySource.entries())
		.map(([source, sourceStats]) => ({
			endpoint: source.replace(' /api/v1', ' '),
			source,
			successCount: sourceStats.successCount,
			failureCount: sourceStats.failureCount,
			averageSeconds: sourceStats.elapsedList.length > 0 ? sourceStats.elapsedList.reduce((sum, value) => sum + value, 0) / sourceStats.elapsedList.length : null,
			maxSeconds: sourceStats.elapsedList.length > 0 ? Math.max(...sourceStats.elapsedList) : null,
		}))
		.sort((left, right) => (right.successCount + right.failureCount) - (left.successCount + left.failureCount));
};
