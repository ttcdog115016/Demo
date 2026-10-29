/**
 * ============================================================================
 * 檔案名稱 (File): useAuthStore.ts
 * 模組功能 (Description): 全域使用者身分認證與 Session 狀態管理 (Zustand Auth Store，提供登入、登出與接續登入等全域驗證狀態控制)
 * ★ 2026-10-27：串接後端會員系統（/api/v1/auth、/api/v1/users），移除前端 Demo 帳號資料庫與「切換測試角色」。
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅單字元變數與含義不明之縮寫) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { create } from 'zustand';
import { logSystemEvent } from './useSystemLogStore';
import { getRoleDisplayName } from '../utils/roleLabel';
import { memberLogout, restoreMemberSession, setSessionExpiredListener, clearMemberSession } from '../api/authApi';
import { useAuditStore } from './useAuditStore';
import { useAnnouncementStore } from './useAnnouncementStore';

/** ★ 2026-10-29：處理紀錄與系統公告改存後端，登入（或重新整理接續登入）後載入 */
const loadServerDataForUser = (username: string): void =>
{
	void useAuditStore.getState().loadAuditLogs();
	void useAnnouncementStore.getState().loadAnnouncements(username);
};

// 登出原因：manual 使用者自行登出 | idle 閒置逾時 | expired 登入逾期（後端拒絕換發 token、帳號被停用或刪除）
export type LogoutReason = 'manual' | 'idle' | 'expired';
/**
 * 使用者系統角色型別定義
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
export type UserRole = 'admin' | 'data_owner'; // 'admin': 系統管理員 | 'data_owner': 資料擁有者

/**
 * 使用者個人基本資料介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface User 
{
	name: string;   // 使用者顯示名稱（★ 2026-10-27 串接後端：後端只有帳號，顯示名稱＝帳號）
	email: string;  // 登入帳號（帳號即 Email，10/16 決議）
	role: UserRole; // 使用者系統角色（後端 admin／user ↔ 前端 admin／data_owner）
}

/**
 * 認證狀態與 Actions 介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
interface AuthState 
{
	isAuthenticated: boolean; // 當前使用者是否已成功認證登入
	user: User | null;        // 當前登入之使用者資料物件 (未登入時為 null)

	/**
	 * 函數名稱: login
	 * 函數功能: 寫入使用者資訊並將系統認證狀態 (isAuthenticated) 切換為已登入 (true)。
	 * 
	 * 輸入參數 (Input):
	 *   - userSessionData (User): 包含姓名、Email 及角色之使用者資料物件
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 被 Login.tsx 頁面登入成功事件或快速登入被調用
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素, c) 確保透過正規 Action 修改全域變數
	 */
	login: (userSessionData: User) => void;

	/**
	 * 函數名稱: logout
	 * 函數功能: 清除全域使用者 Session，還原認證狀態為未登入 (false) 與 user 為 null。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 被 Header 導覽列登出按鈕或 useIdleTimeout 閒置逾時被調用
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記, c) 確保透過正規 Action 修改全域變數
	 */
	logout: (logoutReasonType?: LogoutReason) => void;

	isRestoringSession: boolean;          // 重新整理頁面後，正以 sessionStorage 的 refresh token 向後端接續登入
	lastLogoutReason: LogoutReason | null; // 最近一次登出的原因（登入頁據此顯示「登入已逾期」等提示）

	/**
	 * 函數名稱: restoreSession
	 * 函數功能: 頁面載入時以 refresh token 向後端換發 access token，接續先前的登入（★ 2026-10-27 串接後端會員系統）。
	 * 返回值 (Return): Promise<void>
	 * 呼叫關係 (Call Relations): 被 main.tsx 於應用程式掛載前呼叫一次
	 */
	restoreSession: () => Promise<void>;
}

/**
 * 全域使用者身分認證 Store 實例 (useAuthStore)
 * 規範對照: 符合規範 i) 全域變數/狀態詳細註記
 */
export const useAuthStore = create<AuthState>(
	(setStoreStateAction, getStoreStateAction) => 
	(
		{
			// 初始狀態：未登入，使用者物件為空
			isAuthenticated: false,
			user: null,
			isRestoringSession: false,
			lastLogoutReason: null,
			
			// 實作登入 Action：寫入狀態與使用者物件（帳密驗證已由 authApi.memberLogin 向後端完成）
			login: (userSessionData) => 
			{
				setStoreStateAction({ isAuthenticated: true, user: userSessionData, lastLogoutReason: null });
				logSystemEvent('INFO', `使用者登入成功（角色：${getRoleDisplayName(userSessionData.role)}）`, userSessionData.name);
				loadServerDataForUser(userSessionData.email || userSessionData.name);
			},
			
			// 實作登出 Action：清空狀態與使用者物件，並於背景通知後端作廢 refresh token
			logout: (logoutReasonType = 'manual') =>
			{
				const loggedOutUserNameString = getStoreStateAction().user?.name ?? 'System';
				if (logoutReasonType === 'idle') logSystemEvent('WARN', '閒置逾時，系統自動登出', loggedOutUserNameString);
				else if (logoutReasonType === 'expired') logSystemEvent('WARN', '登入已逾期或帳號已停用，系統自動登出', loggedOutUserNameString);
				else logSystemEvent('INFO', '使用者登出', loggedOutUserNameString);
				// 逾期時 token 已被後端拒絕，只需清本機；其餘情況呼叫 POST /auth/logout（失敗也一律清除本機）
				if (logoutReasonType === 'expired') clearMemberSession();
				else void memberLogout();
				setStoreStateAction({ isAuthenticated: false, user: null, lastLogoutReason: logoutReasonType });
				useAuditStore.getState().clearAuditLogs();
				useAnnouncementStore.getState().clearAnnouncements();
			},

			restoreSession: async () =>
			{
				if (getStoreStateAction().isAuthenticated) return;
				setStoreStateAction({ isRestoringSession: true });
				try
				{
					const restoredSession = await restoreMemberSession();
					if (restoredSession)
					{
						setStoreStateAction({
							isAuthenticated: true,
							user: { name: restoredSession.username, email: restoredSession.username, role: restoredSession.role },
						});
						loadServerDataForUser(restoredSession.username);
					}
				}
				finally
				{
					setStoreStateAction({ isRestoringSession: false });
				}
			},
		}
	)
);

// 帶 token 的請求被後端拒絕換發（refresh token 失效、帳號停用或刪除）→ 自動登出並回到登入頁
setSessionExpiredListener(() =>
{
	if (useAuthStore.getState().isAuthenticated) useAuthStore.getState().logout('expired');
});