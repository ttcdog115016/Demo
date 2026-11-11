/**
 * ============================================================================
 * 檔案名稱 (File): useSystemLogStore.ts
 * 模組功能 (Description): 系統維運日誌 (System Logs) 的全域狀態。
 *
 * 背景：Admin「系統維運日誌」分頁原本是寫死的 4 筆假資料，改由前端在實際發生事件的地方
 * 寫入（登入成功、登出、閒置逾時、角色切換、後端 API 呼叫成功／失敗、帳號管理與安全設定變更等）。
 *
 * ★ 2026-10-29：改存後端資料庫（POST／GET／DELETE /api/v1/system-logs，見 api/systemApi.ts），
 *   管理大廳的統計因此是全站數字，不再只是這個瀏覽器。
 *   - 寫入：logSystemEvent 先放進畫面，登入中才送後端；未登入時的事件（登入失敗、帳號鎖定）
 *     由後端自己記錄，前端不必代寫。
 *   - 讀取：Admin 開啟日誌分頁或管理大廳時以 loadLogs 自後端載入。
 *   先前存在 localStorage 的舊日誌直接捨棄（main.tsx 啟動時清除舊鍵）。
 * ============================================================================
 */

import { create } from 'zustand';
import { hasAccessToken } from '../api/authApi';
import { deleteSystemLogs, fetchSystemLogs, postSystemLogs } from '../api/systemApi';

export type SystemLogLevel = 'INFO' | 'WARN' | 'ERROR'; // 日誌層級

export interface SystemLogEntry
{
	id: string;          // 紀錄唯一識別碼
	timestamp: number;   // 發生時間 (epoch 毫秒)
	level: SystemLogLevel;
	event: string;       // 事件描述 (白話)
	source: string;      // 來源 (使用者名稱／API 路徑／System)
	username?: string | null;          // ★ 2026-10-29：寫入這筆的登入帳號（後端回傳）
	origin?: 'server' | 'client';      // ★ 2026-10-29：server＝後端自行記錄（可信）、client＝前端回報；本機剛寫入、尚未讀回者為 undefined
}

interface SystemLogState
{
	logs: SystemLogEntry[];                                       // 由新到舊排序
	/** 回傳送後端的 Promise（未登入、未送出時為已完成的 Promise）；呼叫端通常不必等候 */
	addLog: (entry: Omit<SystemLogEntry, 'id' | 'timestamp'>) => Promise<void>;
	/** 自後端載入（限 Admin）；sinceMs 只載入該時間之後的紀錄（管理大廳 24 小時統計用）；失敗時保留畫面上現有的紀錄 */
	loadLogs: (sinceMs?: number) => Promise<boolean>; // ★ 2026-10-29：回傳是否成功（管理大廳顯示「無法取得」）
	/** 清除後端與畫面上的日誌（限 Admin） */
	clearLogs: () => Promise<void>;
	/**
	 * ★ 2026-10-29：即時更新（限 Admin）——只抓畫面上最新一筆之後的紀錄，插到最前面。
	 *   回傳新到的筆數；失敗時回傳 null（畫面保留現有紀錄）。
	 */
	pollNewLogs: () => Promise<number | null>;
	recentlyArrivedIds: string[];   // 最近一次 pollNewLogs 新到的紀錄 id（畫面短暫標色用）
	lastSyncedAt: number | null;    // 最後一次成功自後端同步的時間（epoch 毫秒）
	consecutivePollFailures: number; // ★ 2026-10-29：連續同步失敗次數（畫面顯示「連線中斷」）
}

/** 後端紀錄的 id 是流水號；本機剛寫入、尚未自後端讀回的紀錄 id 不是純數字 */
const isServerLogId = (logId: string): boolean => /^\d+$/.test(logId);

/** 本機寫入的紀錄自後端讀回後以（事件＋來源）辨認是同一筆，避免重複顯示（後端改用伺服器時間，不能比時間） */
const logIdentityKey = (logEntry: SystemLogEntry): string => `${logEntry.event}|${logEntry.source}`;

export const LEGACY_SYSTEM_LOG_STORAGE_KEY = 'privacy_system_logs_v1';
const MAX_SYSTEM_LOG_ENTRIES_COUNT = 5000; // 畫面上保留的筆數上限（與後端 GET /system-logs 上限一致；★ 2026-10-29 原 2000，輪詢後會把 7 天／全部裁掉）

/**
 * 函數名稱: generateSystemLogId
 * 函數功能: 產生紀錄 id。非 HTTPS（內網 IP）環境下沒有 crypto.randomUUID，故提供備援。
 */
const generateSystemLogId = (): string =>
{
	try
	{
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	}
	catch
	{
		// 落入下方備援
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const useSystemLogStore = create<SystemLogState>()(
	(setStoreStateAction, getStoreStateAction) => ({
		logs: [],
		recentlyArrivedIds: [],
		lastSyncedAt: null,
		consecutivePollFailures: 0,
		addLog: (entry) =>
		{
			const newLogEntry: SystemLogEntry = { ...entry, id: generateSystemLogId(), timestamp: Date.now() };
			setStoreStateAction((currentState) => ({
				logs: [newLogEntry, ...currentState.logs].slice(0, MAX_SYSTEM_LOG_ENTRIES_COUNT),
			}));
			// 必須在呼叫當下就送出：登出時 token 隨後即被清除，延後送會變成未登入而被拒
			if (!hasAccessToken()) return Promise.resolve();
			return postSystemLogs([{ level: newLogEntry.level, event: newLogEntry.event, source: newLogEntry.source, ts: newLogEntry.timestamp }])
				.then(() => undefined)
				.catch((saveErrorValue) => console.warn('[系統維運日誌] 寫入後端失敗：', saveErrorValue));
		},
		loadLogs: async (sinceMs) =>
		{
			try
			{
				// 指定時間區間時取到後端上限（5000），避免統計只算到最新 2000 筆
				setStoreStateAction({ logs: await fetchSystemLogs(MAX_SYSTEM_LOG_ENTRIES_COUNT, sinceMs), recentlyArrivedIds: [], lastSyncedAt: Date.now(), consecutivePollFailures: 0 });
				return true;
			}
			catch (loadErrorValue)
			{
				console.warn('[系統維運日誌] 自後端載入失敗：', loadErrorValue);
				setStoreStateAction((currentState) => ({ consecutivePollFailures: currentState.consecutivePollFailures + 1 }));
				return false;
			}
		},
		clearLogs: async () =>
		{
			await deleteSystemLogs();
			setStoreStateAction({ logs: [], recentlyArrivedIds: [] });
		},
		pollNewLogs: async () =>
		{
			const serverLogsList = getStoreStateAction().logs.filter((logEntry) => isServerLogId(logEntry.id));
			// 後端的 since 含等於：以最新一筆的時間為起點，同一毫秒已有的紀錄再以 id 去重
			const newestServerTimestamp = serverLogsList.length > 0 ? Math.max(...serverLogsList.map((logEntry) => logEntry.timestamp)) : undefined;
			try
			{
				const fetchedLogsList = await fetchSystemLogs(MAX_SYSTEM_LOG_ENTRIES_COUNT, newestServerTimestamp);
				const knownIdsSet = new Set(getStoreStateAction().logs.map((logEntry) => logEntry.id));
				const arrivedLogsList = fetchedLogsList.filter((logEntry) => !knownIdsSet.has(logEntry.id));
				const arrivedKeysSet = new Set(arrivedLogsList.map(logIdentityKey));
				setStoreStateAction((currentState) => ({
					logs: [
						...arrivedLogsList,
						// 本機剛寫入的那筆已從後端讀回時，移除本機版本
						...currentState.logs.filter((logEntry) => isServerLogId(logEntry.id) || !arrivedKeysSet.has(logIdentityKey(logEntry))),
					].sort((leftEntry, rightEntry) => rightEntry.timestamp - leftEntry.timestamp).slice(0, MAX_SYSTEM_LOG_ENTRIES_COUNT),
					recentlyArrivedIds: arrivedLogsList.map((logEntry) => logEntry.id),
					lastSyncedAt: Date.now(),
					consecutivePollFailures: 0,
				}));
				return arrivedLogsList.length;
			}
			catch (pollErrorValue)
			{
				console.warn('[系統維運日誌] 即時更新失敗：', pollErrorValue);
				setStoreStateAction((currentState) => ({ consecutivePollFailures: currentState.consecutivePollFailures + 1 }));
				return null;
			}
		},
	})
);

/**
 * 函數名稱: logSystemEvent
 * 函數功能: 寫入一筆系統維運日誌（可在 React 元件外呼叫）。寫入失敗絕不影響主流程。
 *
 * 輸入參數 (Input):
 *   - level (SystemLogLevel): INFO / WARN / ERROR
 *   - event (string): 事件描述
 *   - source (string): 來源，預設 'System'
 */
export const logSystemEvent = (level: SystemLogLevel, event: string, source: string = 'System'): void =>
{
	void logSystemEventAndWait(level, event, source);
};

/**
 * ★ 2026-10-29：同 logSystemEvent，但回傳送後端的 Promise——登出前要先等日誌送達再清除 token
 *   （access token 過期時 authorizedRequest 會用 refresh token 換發，清掉就送不出去）。
 */
export const logSystemEventAndWait = (level: SystemLogLevel, event: string, source: string = 'System'): Promise<void> =>
{
	try
	{
		return useSystemLogStore.getState().addLog({ level, event, source });
	}
	catch (logWriteErrorObj)
	{
		console.warn('寫入系統維運日誌失敗:', logWriteErrorObj);
		return Promise.resolve();
	}
};
