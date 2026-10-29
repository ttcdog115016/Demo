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
import { logSystemEventAndWait } from './useSystemLogStore';
import { getLoginGeneration, memberLogout, restoreMemberSession, setSessionExpiredListener, clearMemberSession } from '../api/authApi';
import { useAuditStore } from './useAuditStore';
import { useSystemLogStore } from './useSystemLogStore';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useUIStore } from './useUIStore';
import { fetchUserPreferences } from '../api/systemApi';

/**
 * ★ 2026-10-29：不論怎麼登出（手動、閒置逾時、登入逾期），都釋放這次登入在瀏覽器裡的資料——
 *   原本只有手動登出會清工作區，閒置逾時被登出後再登入，Step1 仍看得到先前上傳的檔案。
 *   工作區整個還原成初始狀態（下一位登入者可能是別人，K 值、DP 預算等設定也還原）；
 *   只保留後端同步來的閒置登出時間（見 utils/systemSettingsSync.ts），否則登入頁的閒置計時會退回預設。
 */
const releaseSessionData = (): void =>
{
	const sessionTimeoutValue = (useWorkspaceStore.getState() as unknown as { sessionTimeout?: number }).sessionTimeout;
	useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
	if (sessionTimeoutValue !== undefined) useWorkspaceStore.setState({ sessionTimeout: sessionTimeoutValue } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
	useAuditStore.getState().clearAuditLogs();
	useSystemLogStore.setState({ logs: [], recentlyArrivedIds: [], lastSyncedAt: null, consecutivePollFailures: 0 });
	useUIStore.getState().resetToDefaults();
};

/** ★ 2026-10-29：處理紀錄、介面偏好存後端，登入（或重新整理接續登入）後載入 */
const loadServerDataForUser = (): void =>
{
	void useAuditStore.getState().loadAuditLogs();
	// ★ 2026-10-29：介面偏好依帳號存後端，登入後套用；讀不到時維持目前畫面
	void fetchUserPreferences()
		.then((preferences) => useUIStore.getState().applyUserPreferences(preferences))
		.catch((loadErrorValue) => console.warn('[介面偏好] 載入失敗：', loadErrorValue));
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
				// ★ 2026-10-29：登入成功、登出改由後端記錄（前端回報可被假造），這裡不再寫日誌
				loadServerDataForUser();
			},
			
			// 實作登出 Action：清空狀態與使用者物件，並於背景通知後端作廢 refresh token
			logout: (logoutReasonType = 'manual') =>
			{
				const loggedOutUserNameString = getStoreStateAction().user?.name ?? 'System';
				// 逾期時 token 已被後端拒絕，只需清本機（也送不出日誌）；閒置逾時先等日誌送達（必要時換發 token）
				//   再呼叫 POST /auth/logout（失敗也一律清除本機；後端記「使用者登出」）
				if (logoutReasonType === 'expired') clearMemberSession();
				else if (logoutReasonType === 'idle')
				{
					const loginGenerationValue = getLoginGeneration();
					void logSystemEventAndWait('WARN', '閒置逾時，系統自動登出', loggedOutUserNameString).finally(() => { void memberLogout(loginGenerationValue); });
				}
				else void memberLogout();
				setStoreStateAction({ isAuthenticated: false, user: null, lastLogoutReason: logoutReasonType });
				releaseSessionData();
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
						loadServerDataForUser();
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