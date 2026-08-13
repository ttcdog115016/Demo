/**
 * ============================================================================
 * 檔案名稱 (File): useAuthStore.ts
 * 模組功能 (Description): 全域使用者身分認證與 Session 狀態管理 (Zustand Auth Store，提供登入、登出與角色切換等全域驗證狀態控制)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅單字元變數與含義不明之縮寫) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { create } from 'zustand';

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
	name: string;   // 使用者顯示名稱
	email: string;  // 使用者電子郵件帳號
	role: UserRole; // 使用者系統角色
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
	logout: () => void;

	/**
	 * 函數名稱: setUserRole
	 * 函數功能: 動態切換當前已登入使用者之系統權限角色 (如測試切換 Admin/Data Owner)。
	 * 
	 * 輸入參數 (Input):
	 *   - targetUserRoleType (UserRole): 目標切換之角色型別
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 被 Header 權限切換選單或測試控制台調用
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記, c) 確保透過正規 Action 修改全域變數
	 */
	setUserRole: (targetUserRoleType: UserRole) => void;
}

/**
 * 全域使用者身分認證 Store 實例 (useAuthStore)
 * 規範對照: 符合規範 i) 全域變數/狀態詳細註記
 */
export const useAuthStore = create<AuthState>(
	(setStoreStateAction) => 
	(
		{
			// 初始狀態：未登入，使用者物件為空
			isAuthenticated: false,
			user: null,
			
			// 實作登入 Action：寫入狀態與使用者物件
			login: (userSessionData) => setStoreStateAction({ isAuthenticated: true, user: userSessionData }),
			
			// 實作登出 Action：清空狀態與使用者物件
			logout: () => setStoreStateAction({ isAuthenticated: false, user: null }),
			
			// 實作角色切換 Action：防呆處理，確保使用者存在才更新角色屬性
			setUserRole: (targetUserRoleType) => setStoreStateAction(
				(currentStoreStateData) => 
				(
					{ 
						user: currentStoreStateData.user ? { ...currentStoreStateData.user, role: targetUserRoleType } : null 
					}
				)
			),
		}
	)
);