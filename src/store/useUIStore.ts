/**
 * ============================================================================
 * 檔案名稱 (File): useUIStore.ts
 * 模組功能 (Description): 全域使用者介面 (UI) 與偏好設定狀態管理 (Zustand UI Store，提供深色/淺色主題外觀切換與系統多國語系狀態控制)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術字串、單字元變數與含義不明之縮寫) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { create } from 'zustand';
import { hasAccessToken } from '../api/authApi';
import { saveUserPreferences, type UserPreferences } from '../api/systemApi';

/**
 * 預設 UI 系統常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之常數字串 (Magic String)
 */
const DARK_MODE_MEDIA_QUERY = '(prefers-color-scheme: dark)';
const DEFAULT_LANGUAGE_CODE = 'zh_TW';
const DEFAULT_FONT_SIZE_LEVEL: FontSizeLevel = 'medium';

/**
 * 字級調整選項型別
 * 規範對照: 符合規範 e) 避免使用不易理解之常數字串 (Magic String)
 */
export type FontSizeLevel = 'small' | 'medium' | 'large' | 'extraLarge';

/**
 * 全域 UI 介面偏好狀態與 Actions 介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface UIState 
{
	isDarkMode: boolean;       // 當前系統是否處於深色模式 (true: 深色模式 | false: 淺色模式)
	language: string;         // 當前系統顯示語系碼 (如 'zh_TW' | 'en_US')
	fontSizeLevel: FontSizeLevel; // 當前系統全域字體大小級距 ('small' | 'medium' | 'large')
	hasExplicitTheme: boolean; // ★ 2026-10-29：使用者手動選過主題（true 時作業系統深淺色切換不再覆蓋）

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
	setIsDarkMode: (isDarkThemeActiveStatus: boolean) => Promise<boolean>;

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
	setLanguage: (languageCodeString: string) => Promise<boolean>;

	/**
	 * 函數名稱: setFontSizeLevel
	 * 函數功能: 更新系統全域字體大小級距設定。
	 *
	 * 輸入參數 (Input):
	 *   - fontSizeLevelValue (FontSizeLevel): 字體大小級距 ('small' | 'medium' | 'large')
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 被 SystemPreferences 偏好設定元件調用，並透過 App 根組件同步套用至 CSS 變數
	 *
	 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素, c) 確保透過正規 Action 修改全域變數
	 */
	setFontSizeLevel: (fontSizeLevelValue: FontSizeLevel) => Promise<boolean>;

	/** 作業系統深淺色改變時呼叫：只在使用者沒有手動選過主題時套用，不寫後端 */
	followSystemTheme: (isSystemDarkStatus: boolean) => void;
	/** 登入（或重新整理接續登入）後套用後端存的偏好 */
	applyUserPreferences: (preferences: UserPreferences) => void;
	/** 登出時回到預設（作業系統主題、繁體中文、中字級），下一位登入者不受影響 */
	resetToDefaults: () => void;
}

/**
 * ★ 2026-10-29：介面偏好依帳號存後端（PUT /api/v1/preferences），換電腦登入也一樣。
 *   使用者在系統設定切換時：畫面立即套用，登入中才寫後端；回傳是否已存（失敗時由畫面提示）。
 */
const persistPreference = async (changes: UserPreferences): Promise<boolean> =>
{
	if (!hasAccessToken()) return true;
	try
	{
		await saveUserPreferences(changes);
		return true;
	}
	catch (saveErrorValue)
	{
		console.warn('[介面偏好] 儲存失敗：', saveErrorValue);
		return false;
	}
};

// 測試環境或舊瀏覽器沒有 matchMedia 時視為淺色
const resolveSystemDarkMode = (): boolean =>
	typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_MODE_MEDIA_QUERY).matches;

/**
 * 全域 UI 偏好狀態 Store 實例 (useUIStore)
 * 規範對照: 符合規範 i) 全域變數/狀態詳細註記
 */
export const useUIStore = create<UIState>(
	(setStoreStateAction) => 
	(
		{
			// 初始化深色模式：預設讀取作業系統或瀏覽器外觀偏好 (prefers-color-scheme) (符合規範 g)
			isDarkMode: resolveSystemDarkMode(),
			hasExplicitTheme: false,
			
			// 初始化語系：預設系統顯示語系為繁體中文 (zh_TW) (符合規範 g)
			language: DEFAULT_LANGUAGE_CODE,

			// 初始化字體大小級距：預設為中 (medium) (符合規範 g)
			fontSizeLevel: DEFAULT_FONT_SIZE_LEVEL,

			// 實作深色模式切換 Action（使用者手動選擇：記住並寫後端）
			setIsDarkMode: (isDarkThemeActiveStatus) =>
			{
				setStoreStateAction({ isDarkMode: isDarkThemeActiveStatus, hasExplicitTheme: true });
				return persistPreference({ theme: isDarkThemeActiveStatus ? 'dark' : 'light' });
			},

			// 實作語系切換 Action
			setLanguage: (languageCodeString) =>
			{
				setStoreStateAction({ language: languageCodeString });
				return persistPreference({ language: languageCodeString === 'en_US' ? 'en_US' : 'zh_TW' });
			},

			// 實作字體大小切換 Action
			setFontSizeLevel: (fontSizeLevelValue) =>
			{
				setStoreStateAction({ fontSizeLevel: fontSizeLevelValue });
				return persistPreference({ font_size: fontSizeLevelValue });
			},

			followSystemTheme: (isSystemDarkStatus) => setStoreStateAction((currentState) =>
				(currentState.hasExplicitTheme ? {} : { isDarkMode: isSystemDarkStatus })),

			applyUserPreferences: (preferences) => setStoreStateAction({
				isDarkMode: preferences.theme ? preferences.theme === 'dark' : resolveSystemDarkMode(),
				hasExplicitTheme: !!preferences.theme,
				language: preferences.language ?? DEFAULT_LANGUAGE_CODE,
				fontSizeLevel: preferences.font_size ?? DEFAULT_FONT_SIZE_LEVEL,
			}),

			resetToDefaults: () => setStoreStateAction({
				isDarkMode: resolveSystemDarkMode(),
				hasExplicitTheme: false,
				language: DEFAULT_LANGUAGE_CODE,
				fontSizeLevel: DEFAULT_FONT_SIZE_LEVEL,
			}),
		}
	)
);