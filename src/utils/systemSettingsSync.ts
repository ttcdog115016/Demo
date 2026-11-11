/**
 * 檔案名稱 (File): systemSettingsSync.ts
 * 模組功能 (Description): 系統設定（閒置自動登出時間）與後端同步。
 *
 * ★ 2026-10-29：設定原本只在記憶體（useWorkspaceStore），重新整理就回預設、別台電腦也看不到；
 *   改存後端（GET／PUT /api/v1/settings）。讀到的值仍寫進 useWorkspaceStore 的 sessionTimeout，
 *   App.tsx（閒置計時）與系統設定的讀取端不用改；登入期間 App.tsx 每 60 秒重讀一次。
 *   （同日曾有的全站維護模式已刪除：單機版用不到。）
 */
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { fetchSystemSettings, putSystemSettings, type SystemSettings } from '../api/systemApi';

export const DEFAULT_SESSION_TIMEOUT_MINUTES = 15;

// ★ 2026-10-30：密碼長度下限以後端為準（GET /settings 一併回傳），避免後端調整後前端仍寫死 12
export const DEFAULT_PASSWORD_MIN_LENGTH = 12;
let passwordMinLength = DEFAULT_PASSWORD_MIN_LENGTH;
export const getPasswordMinLength = (): number => passwordMinLength;

const applySettingsToWorkspace = (settingsObj: SystemSettings): void =>
{
	if (settingsObj.password_min_length && settingsObj.password_min_length > 0) passwordMinLength = settingsObj.password_min_length;
	useWorkspaceStore.setState({
		sessionTimeout: settingsObj.session_timeout_minutes || DEFAULT_SESSION_TIMEOUT_MINUTES,
	} as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
};

/** 自後端讀取設定；失敗時維持目前的值 */
export const loadSystemSettings = async (): Promise<void> =>
{
	try
	{
		applySettingsToWorkspace(await fetchSystemSettings());
	}
	catch (loadErrorValue)
	{
		console.warn('[系統設定] 自後端載入失敗：', loadErrorValue);
	}
};

/** 寫入後端（限 Admin），成功後套用後端回傳的值；失敗時拋出，由呼叫端提示 */
export const saveSystemSettings = async (changes: { sessionTimeoutMinutes: number }): Promise<void> =>
{
	const savedSettings = await putSystemSettings({ session_timeout_minutes: changes.sessionTimeoutMinutes });
	applySettingsToWorkspace(savedSettings);
};
