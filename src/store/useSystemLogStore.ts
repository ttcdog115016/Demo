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
}

interface SystemLogState
{
	logs: SystemLogEntry[];                                       // 由新到舊排序
	addLog: (entry: Omit<SystemLogEntry, 'id' | 'timestamp'>) => void;
	/** 自後端載入（限 Admin）；sinceMs 只載入該時間之後的紀錄（管理大廳 24 小時統計用）；失敗時保留畫面上現有的紀錄 */
	loadLogs: (sinceMs?: number) => Promise<void>;
	/** 清除後端與畫面上的日誌（限 Admin） */
	clearLogs: () => Promise<void>;
}

export const LEGACY_SYSTEM_LOG_STORAGE_KEY = 'privacy_system_logs_v1';
const MAX_SYSTEM_LOG_ENTRIES_COUNT = 2000; // 畫面上保留的筆數上限

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
	(setStoreStateAction) => ({
		logs: [],
		addLog: (entry) =>
		{
			const newLogEntry: SystemLogEntry = { ...entry, id: generateSystemLogId(), timestamp: Date.now() };
			setStoreStateAction((currentState) => ({
				logs: [newLogEntry, ...currentState.logs].slice(0, MAX_SYSTEM_LOG_ENTRIES_COUNT),
			}));
			// 必須在呼叫當下就送出：登出時 token 隨後即被清除，延後送會變成未登入而被拒
			if (hasAccessToken())
			{
				postSystemLogs([{ level: newLogEntry.level, event: newLogEntry.event, source: newLogEntry.source, ts: newLogEntry.timestamp }])
					.catch((saveErrorValue) => console.warn('[系統維運日誌] 寫入後端失敗：', saveErrorValue));
			}
		},
		loadLogs: async (sinceMs) =>
		{
			try
			{
				// 指定時間區間時取到後端上限（5000），避免統計只算到最新 2000 筆
				setStoreStateAction({ logs: await fetchSystemLogs(sinceMs ? 5000 : MAX_SYSTEM_LOG_ENTRIES_COUNT, sinceMs) });
			}
			catch (loadErrorValue)
			{
				console.warn('[系統維運日誌] 自後端載入失敗：', loadErrorValue);
			}
		},
		clearLogs: async () =>
		{
			await deleteSystemLogs();
			setStoreStateAction({ logs: [] });
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
	try
	{
		useSystemLogStore.getState().addLog({ level, event, source });
	}
	catch (logWriteErrorObj)
	{
		console.warn('寫入系統維運日誌失敗:', logWriteErrorObj);
	}
};
