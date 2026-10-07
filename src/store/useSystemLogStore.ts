/**
 * ============================================================================
 * 檔案名稱 (File): useSystemLogStore.ts
 * 模組功能 (Description): 系統維運日誌 (System Logs) 的全域狀態。
 *
 * 背景：Admin「系統維運日誌」分頁原本是寫死的 4 筆假資料。後端目前沒有提供日誌
 * 查詢 API，因此改由前端在實際發生事件的地方寫入（登入成功／失敗、登出、閒置
 * 逾時、角色切換、後端 API 呼叫成功／失敗、帳號管理與安全設定變更等），並以
 * localStorage 持久化（重新整理不會遺失），同一台電腦開多個分頁時也會即時同步。
 *
 * 限制：紀錄只存在「這個瀏覽器」。若要多台電腦共用同一份日誌，需改為由後端提供
 * 寫入／查詢 API，屆時只需替換本檔的儲存層，呼叫端 (logSystemEvent) 不用改。
 * ============================================================================
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
	clearLogs: () => void;
}

export const SYSTEM_LOG_STORAGE_KEY = 'privacy_system_logs_v1';
const MAX_SYSTEM_LOG_ENTRIES_COUNT = 300; // 避免 localStorage 無限增長，僅保留最近 N 筆

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
	persist(
		(setStoreStateAction) => ({
			logs: [],
			addLog: (entry) => setStoreStateAction((currentState) => ({
				logs: [
					{ ...entry, id: generateSystemLogId(), timestamp: Date.now() },
					...currentState.logs,
				].slice(0, MAX_SYSTEM_LOG_ENTRIES_COUNT),
			})),
			clearLogs: () => setStoreStateAction({ logs: [] }),
		}),
		{
			name: SYSTEM_LOG_STORAGE_KEY,
			storage: createJSONStorage(() => localStorage),
		}
	)
);

// 跨分頁同步：其他分頁寫入日誌時（storage 事件），本分頁重新讀取，畫面即時更新。
if (typeof window !== 'undefined')
{
	window.addEventListener('storage', (storageEventObj) =>
	{
		if (storageEventObj.key === SYSTEM_LOG_STORAGE_KEY)
		{
			void useSystemLogStore.persist.rehydrate();
		}
	});
}

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
