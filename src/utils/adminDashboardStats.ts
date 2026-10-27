/**
 * 檔案名稱 (File): adminDashboardStats.ts
 * 模組功能 (Description): Admin「系統管理大廳」三張狀態卡片的統計計算（純函式，方便測試）。
 * 資料來源：系統維運日誌 (useSystemLogStore，存在瀏覽器 localStorage，代表「這個瀏覽器」上的紀錄)
 * 與後端帳號清單 (★ 2026-10-27 改為 GET /api/v1/users)。
 */
import type { SystemLogEntry } from '../store/useSystemLogStore';
import type { MemberAccount } from '../api/authApi';

/** 統計只用到的帳號欄位（後端帳號清單 MemberAccount 即符合） */
type AccountForStats = Pick<MemberAccount, 'isActive' | 'lockedUntil'>;

export const STATS_WINDOW_MS = 24 * 60 * 60 * 1000; // 統計區間：過去 24 小時

/** 後端 API 呼叫統計（依系統維運日誌中 source 為「METHOD /api/...」的紀錄） */
export interface ApiCallStats
{
	successCount: number;
	failureCount: number;
	lastFailureAt: number | null;
}

/** 登入失敗統計 */
export interface FailedLoginStats
{
	count: number;              // 過去 24 小時登入失敗次數（含鎖定、停用、帳號不存在）
	distinctSources: string[];  // 涉及的帳號（登入時輸入的帳號），依最近發生排序
	lockedAccountCount: number; // 目前仍在鎖定中的帳號數（★ 2026-10-27 後端帳號清單不含鎖定資訊，目前恆為 0）
}

/** 登入使用者統計 */
export interface ActiveUserStats
{
	recentLoginCount: number;   // 過去 24 小時內登入過的帳號數
	totalAccountCount: number;  // 全部帳號數
	disabledAccountCount: number;
	recentLoginNames: string[]; // 最近登入的使用者名稱（由新到舊）
}

const API_SOURCE_PATTERN = /^[A-Z]+ \/api\//;

export const computeApiCallStats = (logs: SystemLogEntry[], nowMs: number = Date.now()): ApiCallStats =>
{
	const recentApiLogs = logs.filter(logEntry => nowMs - logEntry.timestamp <= STATS_WINDOW_MS && API_SOURCE_PATTERN.test(logEntry.source));
	const failureLogs = recentApiLogs.filter(logEntry => logEntry.level !== 'INFO');
	return {
		successCount: recentApiLogs.filter(logEntry => logEntry.level === 'INFO' && logEntry.event.startsWith('後端 API 呼叫成功')).length,
		failureCount: failureLogs.length,
		lastFailureAt: failureLogs.length > 0 ? Math.max(...failureLogs.map(logEntry => logEntry.timestamp)) : null,
	};
};

export const computeFailedLoginStats = (logs: SystemLogEntry[], accounts: AccountForStats[], nowMs: number = Date.now()): FailedLoginStats =>
{
	const failedLoginLogs = logs
		.filter(logEntry => nowMs - logEntry.timestamp <= STATS_WINDOW_MS && logEntry.event.startsWith('登入失敗'))
		.sort((leftEntry, rightEntry) => rightEntry.timestamp - leftEntry.timestamp);
	return {
		count: failedLoginLogs.length,
		distinctSources: Array.from(new Set(failedLoginLogs.map(logEntry => logEntry.source))),
		lockedAccountCount: accounts.filter(account => account.lockedUntil !== null && account.lockedUntil > nowMs).length,
	};
};

// ★ 2026-10-16：移除帳號「最後登入時間」（同步後端，後端無此欄位）→ 最近登入改由本瀏覽器維運日誌的「使用者登入成功」紀錄統計
export const computeActiveUserStats = (logs: SystemLogEntry[], accounts: AccountForStats[], nowMs: number = Date.now()): ActiveUserStats =>
{
	const recentLoginNames = Array.from(new Set(logs
		.filter(logEntry => nowMs - logEntry.timestamp <= STATS_WINDOW_MS && logEntry.event.startsWith('使用者登入成功'))
		.sort((leftEntry, rightEntry) => rightEntry.timestamp - leftEntry.timestamp)
		.map(logEntry => logEntry.source)));
	return {
		recentLoginCount: recentLoginNames.length,
		totalAccountCount: accounts.length,
		disabledAccountCount: accounts.filter(account => !account.isActive).length,
		recentLoginNames,
	};
};

/** 後端連線檢查結果 */
export type BackendHealthState =
	| { status: 'checking' }
	| { status: 'ok'; responseMs: number; checkedAt: number }
	| { status: 'down'; reason: string; checkedAt: number };

export const BACKEND_HEALTH_PROBE_URL = '/api/v1/health';
const BACKEND_HEALTH_TIMEOUT_MS = 5000;

/**
 * 函數名稱: probeBackendHealth
 * 函數功能: 以 fetch（不經 axios，避免寫入 API 錯誤診斷紀錄）向後端發一個輕量請求。
 *           後端目前沒有健康檢查 API，所以只要後端（FastAPI）「有回應」就視為連線正常——
 *           即使是 404，FastAPI 也會回 JSON。代理（Vite／nginx）找不到後端時回的是非 JSON 的
 *           500／502／503／504，連同逾時、網路錯誤都視為無法連線。
 */
export const probeBackendHealth = async (): Promise<BackendHealthState> =>
{
	const startedAtMs = performance.now();
	const abortController = new AbortController();
	const timeoutId = window.setTimeout(() => abortController.abort(), BACKEND_HEALTH_TIMEOUT_MS);
	try
	{
		const response = await fetch(BACKEND_HEALTH_PROBE_URL, { method: 'GET', cache: 'no-store', signal: abortController.signal });
		const responseMs = Math.round(performance.now() - startedAtMs);
		const isBackendJsonResponse = (response.headers.get('content-type') || '').includes('application/json');
		if (!isBackendJsonResponse || [502, 503, 504].includes(response.status))
		{
			return { status: 'down', reason: `HTTP ${response.status}`, checkedAt: Date.now() };
		}
		return { status: 'ok', responseMs, checkedAt: Date.now() };
	}
	catch (probeErrorObj)
	{
		const isTimeout = probeErrorObj instanceof DOMException && probeErrorObj.name === 'AbortError';
		return { status: 'down', reason: isTimeout ? 'timeout' : 'network', checkedAt: Date.now() };
	}
	finally
	{
		window.clearTimeout(timeoutId);
	}
};
