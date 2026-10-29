/**
 * 檔案名稱 (File): systemSettingsSync.ts
 * 模組功能 (Description): 系統設定（閒置自動登出時間、全站維護模式）與後端同步。
 *
 * ★ 2026-10-29：這兩項設定原本只在記憶體（useWorkspaceStore），重新整理就回預設、別台電腦也看不到；
 *   改存後端（GET／PUT /api/v1/settings）。讀到的值仍寫進 useWorkspaceStore 的 sessionTimeout／isMaintenanceMode，
 *   App.tsx（閒置計時、維護模式強制登出）與系統設定、管理大廳的讀取端不用改。
 *   維護模式擋登入由後端負責（ERR_MAINTENANCE）；已登入的一般使用者由 App.tsx 每 60 秒重讀設定時踢出。
 */
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { fetchSystemSettings, putSystemSettings, type SystemSettings } from '../api/systemApi';

export const DEFAULT_SESSION_TIMEOUT_MINUTES = 15;

const applySettingsToWorkspace = (settingsObj: SystemSettings): void =>
{
	useWorkspaceStore.setState({
		sessionTimeout: settingsObj.session_timeout_minutes || DEFAULT_SESSION_TIMEOUT_MINUTES,
		isMaintenanceMode: !!settingsObj.maintenance_mode,
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
export const saveSystemSettings = async (changes: { sessionTimeoutMinutes?: number; isMaintenanceMode?: boolean }): Promise<void> =>
{
	const savedSettings = await putSystemSettings({
		...(changes.sessionTimeoutMinutes !== undefined ? { session_timeout_minutes: changes.sessionTimeoutMinutes } : {}),
		...(changes.isMaintenanceMode !== undefined ? { maintenance_mode: changes.isMaintenanceMode } : {}),
	});
	applySettingsToWorkspace(savedSettings);
};
