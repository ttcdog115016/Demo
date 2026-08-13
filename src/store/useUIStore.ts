/**
 * ============================================================================
 * 檔案名稱 (File): useUIStore.ts
 * 模組功能 (Description): 全域使用者介面 (UI) 與偏好設定狀態管理 (Zustand UI Store，提供深色/淺色主題外觀切換與系統多國語系狀態控制)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術字串、單字元變數與含義不明之縮寫) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { create } from 'zustand';

/**
 * 預設 UI 系統常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之常數字串 (Magic String)
 */
const DARK_MODE_MEDIA_QUERY = '(prefers-color-scheme: dark)';
const DEFAULT_LANGUAGE_CODE = 'zh_TW';

/**
 * 全域 UI 介面偏好狀態與 Actions 介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface UIState 
{
	isDarkMode: boolean; // 當前系統是否處於深色模式 (true: 深色模式 | false: 淺色模式)
	language: string;    // 當前系統顯示語系碼 (如 'zh_TW' | 'en_US')

	/**
	 * 函數名稱: setIsDarkMode
	 * 函數功能: 切換系統全域之深色/淺色主題外觀標記。
	 * 
	 * 輸入參數 (Input):
	 *   - isDarkThemeActiveStatus (boolean): 是否啟用深色模式
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 被 Header 主題切換按鈕或 SystemPreferences 偏好設定元件調用
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素, c) 確保透過正規 Action 修改全域變數
	 */
	setIsDarkMode: (isDarkThemeActiveStatus: boolean) => void;

	/**
	 * 函數名稱: setLanguage
	 * 函數功能: 更新系統全域多國語系 (i18n) 設定代碼。
	 * 
	 * 輸入參數 (Input):
	 *   - languageCodeString (string): 語系代碼字串 (如 'zh_TW'、'en_US')
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 被 Header 語系下拉選單或 SystemPreferences 偏好設定元件調用
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記, c) 確保透過正規 Action 修改全域變數
	 */
	setLanguage: (languageCodeString: string) => void;
}

/**
 * 全域 UI 偏好狀態 Store 實例 (useUIStore)
 * 規範對照: 符合規範 i) 全域變數/狀態詳細註記
 */
export const useUIStore = create<UIState>(
	(setStoreStateAction) => 
	(
		{
			// 初始化深色模式：預設讀取作業系統或瀏覽器外觀偏好 (prefers-color-scheme) (符合規範 g)
			isDarkMode: window.matchMedia(DARK_MODE_MEDIA_QUERY).matches,
			
			// 初始化語系：預設系統顯示語系為繁體中文 (zh_TW) (符合規範 g)
			language: DEFAULT_LANGUAGE_CODE,
			
			// 實作深色模式切換 Action
			setIsDarkMode: (isDarkThemeActiveStatus) => setStoreStateAction({ isDarkMode: isDarkThemeActiveStatus }),
			
			// 實作語系切換 Action
			setLanguage: (languageCodeString) => setStoreStateAction({ language: languageCodeString }),
		}
	)
);