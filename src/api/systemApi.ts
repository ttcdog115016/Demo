/**
 * ============================================================================
 * 檔案名稱 (File): systemApi.ts
 * 模組功能 (Description): 系統資料 API（★ 2026-10-29 後端新增，見 backend_patches/2026-10-29_system_data.patch）。
 *   處理紀錄、系統維運日誌、系統設定、系統公告改存後端資料庫（/data/system.db），不再只存在使用者的瀏覽器。
 *   帶 token 的請求一律走 authApi.authorizedRequest（401 時自動換發一次）。
 * ============================================================================
 */

import { authorizedRequest, publicRequest } from './authApi';
import type { AuditLogItem } from '../store/useAuditStore';
import type { AuditVerificationResult } from '../utils/auditIntegrity';
import type { SystemLogEntry, SystemLogLevel } from '../store/useSystemLogStore';

// ── 處理紀錄 ──────────────────────────────────────────────────────────────
/** GET /history：目前帳號的處理紀錄（新的在前） */
export const fetchHistory = async (options: { all?: boolean } = {}): Promise<AuditLogItem[]> =>
	(await authorizedRequest<{ records: AuditLogItem[] }>({ method: 'GET', url: '/history', params: options.all ? { all: 1 } : undefined })).records ?? [];

/** POST /history：新增一筆處理紀錄；操作者由後端以登入帳號為準，並回傳含伺服器簽章（integrity）的紀錄 */
export const postHistory = (record: AuditLogItem): Promise<AuditLogItem> =>
	authorizedRequest<AuditLogItem>({ method: 'POST', url: '/history', data: record });

/** GET /history/{id}/verify：後端重算指紋與簽章 */
export const verifyHistoryRecord = (recordId: string): Promise<AuditVerificationResult> =>
	authorizedRequest<AuditVerificationResult>({ method: 'GET', url: `/history/${encodeURIComponent(recordId)}/verify` });

// ── 系統維運日誌 ──────────────────────────────────────────────────────────
export interface SystemLogEntryToSend
{
	level: SystemLogLevel;
	event: string;
	source: string;
	ts: number;
}

/** POST /system-logs：批次寫入 */
export const postSystemLogs = (entries: SystemLogEntryToSend[]): Promise<unknown> =>
	authorizedRequest({ method: 'POST', url: '/system-logs', data: { entries } });

/** GET /system-logs（限 Admin）：新的在前；sinceMs 只取該時間（epoch 毫秒）之後的紀錄 */
export const fetchSystemLogs = async (limit: number = 2000, sinceMs?: number): Promise<SystemLogEntry[]> =>
	(await authorizedRequest<{ logs: SystemLogEntry[] }>({ method: 'GET', url: '/system-logs', params: { limit, ...(sinceMs ? { since: sinceMs } : {}) } })).logs ?? [];

/** DELETE /system-logs（限 Admin） */
export const deleteSystemLogs = (): Promise<unknown> =>
	authorizedRequest({ method: 'DELETE', url: '/system-logs' });

// ── 系統設定 ──────────────────────────────────────────────────────────────
export interface SystemSettings
{
	session_timeout_minutes: number;
}

/** GET /settings（免登入） */
export const fetchSystemSettings = (): Promise<SystemSettings> =>
	publicRequest<SystemSettings>({ method: 'GET', url: '/settings' });

/** PUT /settings（限 Admin）：只送要改的欄位 */
export const putSystemSettings = (changes: Partial<SystemSettings>): Promise<SystemSettings> =>
	authorizedRequest<SystemSettings>({ method: 'PUT', url: '/settings', data: changes });

// ── 介面偏好（★ 2026-10-29：依帳號記住） ──────────────────────────────────
export interface UserPreferences
{
	theme?: 'light' | 'dark' | null;   // null／未設定＝跟隨作業系統
	language?: 'zh_TW' | 'en_US';
	font_size?: 'small' | 'medium' | 'large' | 'extraLarge';
}

/** GET /preferences：目前帳號的介面偏好；沒存過回 {} */
export const fetchUserPreferences = (): Promise<UserPreferences> =>
	authorizedRequest<UserPreferences>({ method: 'GET', url: '/preferences' });

/** PUT /preferences：只送要改的欄位 */
export const saveUserPreferences = (changes: UserPreferences): Promise<UserPreferences> =>
	authorizedRequest<UserPreferences>({ method: 'PUT', url: '/preferences', data: changes });
