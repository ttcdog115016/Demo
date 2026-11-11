/**
 * ★ 2026-10-29：系統維運日誌圖表統計（事件趨勢分桶、API 成功／失敗與耗時）。
 */
import { describe, it, expect } from 'vitest';
import type { SystemLogEntry } from '../../store/useSystemLogStore';
import { buildApiEndpointStats, buildLevelTrend, filterLogsByRange } from '../systemLogStats';

const NOW_MS = new Date(2026, 9, 29, 14, 30, 0).getTime();
const MINUTE_MS = 60 * 1000;
const makeLog = (minutesAgo: number, level: SystemLogEntry['level'], event = 'e', source = 'System'): SystemLogEntry =>
	({ id: `${minutesAgo}-${level}-${event}`, timestamp: NOW_MS - minutesAgo * MINUTE_MS, level, event, source });

describe('事件趨勢分桶', () => {
	it('24 小時：每小時一桶、依層級計數，超出期間的紀錄不計', () => {
		const logs = [makeLog(5, 'INFO'), makeLog(10, 'WARN'), makeLog(70, 'ERROR'), makeLog(25 * 60, 'INFO')];
		const trend = buildLevelTrend(logs, '24h', NOW_MS);
		expect(trend.bucketStartsMs.length).toBeGreaterThanOrEqual(24);
		const lastIndex = trend.bucketStartsMs.length - 1;
		expect(trend.counts.INFO[lastIndex]).toBe(1);
		expect(trend.counts.WARN[lastIndex]).toBe(1);
		expect(trend.counts.ERROR[lastIndex - 1]).toBe(1);
		const totalCount = ['INFO', 'WARN', 'ERROR'].reduce((sum, level) => sum + trend.counts[level as 'INFO'].reduce((a, b) => a + b, 0), 0);
		expect(totalCount).toBe(3);
	});

	it('1 小時：每 5 分鐘一桶；7 天：每天一桶', () => {
		expect(buildLevelTrend([], '1h', NOW_MS).bucketMs).toBe(5 * MINUTE_MS);
		const weekTrend = buildLevelTrend([makeLog(3 * 24 * 60, 'INFO')], '7d', NOW_MS);
		expect(weekTrend.bucketStartsMs.length).toBe(8);
		expect(weekTrend.counts.INFO.reduce((a, b) => a + b, 0)).toBe(1);
	});

	it('期間篩選', () => {
		expect(filterLogsByRange([makeLog(30, 'INFO'), makeLog(90, 'INFO')], '1h', NOW_MS)).toHaveLength(1);
		expect(filterLogsByRange([makeLog(30, 'INFO'), makeLog(90, 'INFO')], 'all', NOW_MS)).toHaveLength(2);
	});
});

describe('API 呼叫統計', () => {
	it('依路徑統計成功／失敗與耗時；取消運算不計；依次數排序', () => {
		const stats = buildApiEndpointStats([
			makeLog(1, 'INFO', '後端 API 呼叫成功（HTTP 200，耗時 10.0 秒）', 'POST /api/v1/risk/cap'),
			makeLog(2, 'INFO', '後端 API 呼叫成功（HTTP 200，耗時 20.0 秒）', 'POST /api/v1/risk/cap'),
			makeLog(3, 'ERROR', '後端 API 呼叫失敗（HTTP 500，耗時 5.0 秒）', 'POST /api/v1/risk/cap'),
			makeLog(4, 'INFO', '使用者取消運算，請求已中斷', 'POST /api/v1/risk/cap'),
			makeLog(5, 'WARN', '後端 API 呼叫失敗（HTTP 400）', 'POST /api/v1/dp'),
			makeLog(6, 'INFO', '使用者登入成功', 'owner@test.com'),
		]);
		expect(stats).toEqual([
			{ endpoint: 'POST /risk/cap', source: 'POST /api/v1/risk/cap', successCount: 2, failureCount: 1, averageSeconds: 35 / 3, maxSeconds: 20 },
			{ endpoint: 'POST /dp', source: 'POST /api/v1/dp', successCount: 0, failureCount: 1, averageSeconds: null, maxSeconds: null },
		]);
	});
});
