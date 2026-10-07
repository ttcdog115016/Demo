/**
 * ============================================================================
 * 檔案名稱 (File): useAnnouncementStore.ts
 * 模組功能 (Description): 系統公告／通知（右上角鈴鐺、Data Owner 首頁重要公告橫幅）。
 *
 * 背景：右上角鈴鐺原本是寫死的 3 則假通知。改為由 Admin 在「系統偏好 → 系統公告」
 * 發布，依對象（全部／Data Owner／Admin）顯示於鈴鐺；「重要」公告另外以可關閉的
 * 橫幅顯示在 Data Owner 首頁。已讀／已關閉狀態依使用者分開記錄。
 *
 * 儲存：localStorage 持久化，同一台電腦多分頁即時同步（storage 事件）。後端目前沒有
 * 公告 API，因此公告只存在「這個瀏覽器」；日後後端開放時只需替換本檔儲存層。
 * ============================================================================
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AnnouncementLevel = 'normal' | 'important';           // 一般 | 重要（首頁橫幅）
export type AnnouncementAudience = 'all' | 'data_owner' | 'admin'; // 顯示對象

export interface AnnouncementItem
{
	id: string;                       // 公告唯一識別碼
	title: string;                    // 標題
	content: string;                  // 內容
	level: AnnouncementLevel;
	audience: AnnouncementAudience;
	createdAt: number;                // 發布時間 (epoch 毫秒)
	createdBy: string;                // 發布者名稱
	icon?: string;                    // 左側圖示 (emoji)；舊資料可能沒有，顯示時依 level 給預設
	updatedAt?: number;               // 最後修改時間 (epoch 毫秒)；未修改過為 undefined
}

interface AnnouncementState
{
	announcements: AnnouncementItem[];                     // 由新到舊
	readIdsByUser: Record<string, string[]>;               // 使用者 → 已讀公告 id
	dismissedBannerIdsByUser: Record<string, string[]>;    // 使用者 → 已關閉之首頁橫幅 id
	publishAnnouncement: (item: Omit<AnnouncementItem, 'id' | 'createdAt'>) => void;
	removeAnnouncement: (announcementId: string) => void;
	updateAnnouncement: (announcementId: string, patch: Partial<Pick<AnnouncementItem, 'title' | 'content' | 'level' | 'audience' | 'icon'>>, shouldRenotify: boolean) => void;
	markAsRead: (userKey: string, announcementIds: string[]) => void;
	dismissBanner: (userKey: string, announcementId: string) => void;
}

export const ANNOUNCEMENT_STORAGE_KEY = 'privacy_announcements_v1';
const MAX_ANNOUNCEMENT_COUNT = 50;

const generateAnnouncementId = (): string =>
{
	try
	{
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	}
	catch
	{
		// 非 HTTPS 環境沒有 randomUUID，落入下方備援
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const appendUniqueIds = (existingIds: string[] | undefined, newIds: string[]): string[] =>
	Array.from(new Set([...(existingIds ?? []), ...newIds]));

export const useAnnouncementStore = create<AnnouncementState>()(
	persist(
		(setStoreStateAction) => ({
			announcements: [],
			readIdsByUser: {},
			dismissedBannerIdsByUser: {},
			publishAnnouncement: (item) => setStoreStateAction((currentState) => ({
				announcements: [
					{ ...item, id: generateAnnouncementId(), createdAt: Date.now() },
					...currentState.announcements,
				].slice(0, MAX_ANNOUNCEMENT_COUNT),
			})),
			removeAnnouncement: (announcementId) => setStoreStateAction((currentState) => ({
				announcements: currentState.announcements.filter(item => item.id !== announcementId),
			})),
			// 修改公告；shouldRenotify=true 時清除所有人的已讀／橫幅已關閉狀態，讓修改後內容重新提醒
			updateAnnouncement: (announcementId, patch, shouldRenotify) => setStoreStateAction((currentState) =>
			{
				const removeIdFromEachUser = (idsByUserDict: Record<string, string[]>): Record<string, string[]> =>
					Object.fromEntries(Object.entries(idsByUserDict).map(([userKey, idsList]) => [userKey, idsList.filter(idValue => idValue !== announcementId)]));
				return {
					announcements: currentState.announcements.map(item => item.id === announcementId ? { ...item, ...patch, updatedAt: Date.now() } : item),
					...(shouldRenotify ? {
						readIdsByUser: removeIdFromEachUser(currentState.readIdsByUser),
						dismissedBannerIdsByUser: removeIdFromEachUser(currentState.dismissedBannerIdsByUser),
					} : {}),
				};
			}),
			markAsRead: (userKey, announcementIds) => setStoreStateAction((currentState) => ({
				readIdsByUser: { ...currentState.readIdsByUser, [userKey]: appendUniqueIds(currentState.readIdsByUser[userKey], announcementIds) },
			})),
			dismissBanner: (userKey, announcementId) => setStoreStateAction((currentState) => ({
				dismissedBannerIdsByUser: { ...currentState.dismissedBannerIdsByUser, [userKey]: appendUniqueIds(currentState.dismissedBannerIdsByUser[userKey], [announcementId]) },
			})),
		}),
		{
			name: ANNOUNCEMENT_STORAGE_KEY,
			storage: createJSONStorage(() => localStorage),
		}
	)
);

if (typeof window !== 'undefined')
{
	window.addEventListener('storage', (storageEventObj) =>
	{
		if (storageEventObj.key === ANNOUNCEMENT_STORAGE_KEY)
		{
			void useAnnouncementStore.persist.rehydrate();
		}
	});
}

/**
 * 函數名稱: isAnnouncementVisibleToRole
 * 函數功能: 判斷公告是否應對該角色顯示。
 */
export const isAnnouncementVisibleToRole = (item: AnnouncementItem, role: string | undefined): boolean =>
	item.audience === 'all' || item.audience === role;

/**
 * 函數名稱: getAnnouncementUserKey
 * 函數功能: 已讀狀態以使用者區分；優先用 email，其次名稱。
 */
export const getAnnouncementUserKey = (user: { email?: string; name?: string } | null | undefined): string =>
	user?.email || user?.name || 'anonymous';
