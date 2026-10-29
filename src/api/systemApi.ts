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
import type { SystemLogEntry, SystemLogLevel } from '../store/useSystemLogStore';
import type { AnnouncementItem } from '../store/useAnnouncementStore';

// ── 處理紀錄 ──────────────────────────────────────────────────────────────
/** GET /history：目前帳號的處理紀錄（新的在前） */
export const fetchHistory = async (): Promise<AuditLogItem[]> =>
	(await authorizedRequest<{ records: AuditLogItem[] }>({ method: 'GET', url: '/history' })).records ?? [];

/** POST /history：新增一筆處理紀錄（操作者由後端以登入帳號為準） */
export const postHistory = (record: AuditLogItem): Promise<AuditLogItem> =>
	authorizedRequest<AuditLogItem>({ method: 'POST', url: '/history', data: record });

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

/** GET /system-logs（限 Admin）：新的在前 */
export const fetchSystemLogs = async (limit: number = 2000): Promise<SystemLogEntry[]> =>
	(await authorizedRequest<{ logs: SystemLogEntry[] }>({ method: 'GET', url: '/system-logs', params: { limit } })).logs ?? [];

/** DELETE /system-logs（限 Admin） */
export const deleteSystemLogs = (): Promise<unknown> =>
	authorizedRequest({ method: 'DELETE', url: '/system-logs' });

// ── 系統設定 ──────────────────────────────────────────────────────────────
export interface SystemSettings
{
	session_timeout_minutes: number;
	maintenance_mode: boolean;
}

/** GET /settings（免登入） */
export const fetchSystemSettings = (): Promise<SystemSettings> =>
	publicRequest<SystemSettings>({ method: 'GET', url: '/settings' });

/** PUT /settings（限 Admin）：只送要改的欄位 */
export const putSystemSettings = (changes: Partial<SystemSettings>): Promise<SystemSettings> =>
	authorizedRequest<SystemSettings>({ method: 'PUT', url: '/settings', data: changes });

// ── 系統公告 ──────────────────────────────────────────────────────────────
export interface AnnouncementsResponse
{
	announcements: AnnouncementItem[];
	read_ids: string[];
	dismissed_ids: string[];
}

export type AnnouncementFields = Pick<AnnouncementItem, 'title' | 'content' | 'level' | 'audience' | 'icon' | 'expiresAt'>;

export const fetchAnnouncements = (): Promise<AnnouncementsResponse> =>
	authorizedRequest<AnnouncementsResponse>({ method: 'GET', url: '/announcements' });

export const postAnnouncement = (fields: AnnouncementFields): Promise<AnnouncementItem> =>
	authorizedRequest<AnnouncementItem>({ method: 'POST', url: '/announcements', data: fields });

export const patchAnnouncement = (announcementId: string, patch: Partial<AnnouncementFields>, renotify: boolean): Promise<AnnouncementItem> =>
	authorizedRequest<AnnouncementItem>({ method: 'PATCH', url: `/announcements/${encodeURIComponent(announcementId)}`, data: { ...patch, renotify } });

export const endAnnouncement = (announcementId: string): Promise<AnnouncementItem> =>
	authorizedRequest<AnnouncementItem>({ method: 'POST', url: `/announcements/${encodeURIComponent(announcementId)}/end` });

export const deleteAnnouncement = (announcementId: string): Promise<unknown> =>
	authorizedRequest({ method: 'DELETE', url: `/announcements/${encodeURIComponent(announcementId)}` });

export const postAnnouncementsRead = (ids: string[]): Promise<unknown> =>
	authorizedRequest({ method: 'POST', url: '/announcements/read', data: { ids } });

export const postAnnouncementsDismissed = (ids: string[]): Promise<unknown> =>
	authorizedRequest({ method: 'POST', url: '/announcements/dismiss', data: { ids } });
