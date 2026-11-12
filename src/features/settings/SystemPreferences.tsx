/**
 * ============================================================================
 * 檔案名稱 (File): SystemPreferences.tsx
 * 模組功能 (Description): 系統偏好與後台管理控制台組件 (提供深色模式/語系設定、帳號與權限管理、維運日誌檢視與連線安全參數配置)
 * ★ 2026-10-27：帳號與權限管理改接後端會員系統（GET/POST /users、PATCH /users/{帳號}/role、/active、
 *   POST /users/{帳號}/reset-password、DELETE /users/{帳號}），帳號即 Email；密碼過期輪替已移除（後端無密碼變更時間）。
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
	Card, Switch, Select, Segmented, Space, Divider, theme, Typography, Tooltip, Badge,
	Tabs, Table, Tag, Button, Form, InputNumber, Alert, Modal, Input, App as AntdApp, Dropdown
} from 'antd';
import type { MenuProps } from 'antd';
import {
	SettingOutlined,
	MoonOutlined,
	SunOutlined,
	GlobalOutlined,
	FontSizeOutlined,
	TeamOutlined,
	CodeOutlined,
	SafetyCertificateOutlined,
	ApiOutlined,
	PlusOutlined,
	KeyOutlined,
	EditOutlined,
	DeleteOutlined,
	StopOutlined,
	CheckCircleOutlined,
	ExclamationCircleFilled,
	ReloadOutlined,
	PauseCircleOutlined,
	PlayCircleOutlined,
	CloseOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../store/useAuthStore';
import { getRoleDisplayName } from '../../utils/roleLabel';
import { SHOW_SYSTEM_LOG_TAB, RUNTIME_MODE } from '../../config/featureFlags';
import ModeInfoPanel from './ModeInfoPanel';
import { saveSystemSettings, loadSystemSettings, DEFAULT_SESSION_TIMEOUT_MINUTES, getPasswordMinLength } from '../../utils/systemSettingsSync';
import { useSystemLogStore, logSystemEvent, type SystemLogLevel, type SystemLogEntry } from '../../store/useSystemLogStore';
import SystemLogCharts, { type SystemLogChartSelection } from './SystemLogCharts';
import { filterLogsByRange, resolveRangeStartMs, type SystemLogRangeKey } from '../../utils/systemLogStats';
import {
	listMemberAccounts, createMemberAccount, changeMemberRole, resetMemberPassword, setMemberActive, deleteMemberAccount,
	toMemberApiError, isMemberAccountLocked, LOGIN_MAX_ATTEMPTS, LOGIN_ATTEMPT_WINDOW_SECONDS, LOGIN_LOCKOUT_SECONDS,
	type MemberAccount, type FrontendRole,
} from '../../api/authApi';
import { useUIStore, type FontSizeLevel } from '../../store/useUIStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

import { scaleFontSize } from '../../utils/fontScale';
const { Text, Title } = Typography;

/**
 * 預設系統安全常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const MIN_SESSION_TIMEOUT_MINUTES = 1;
const MAX_SESSION_TIMEOUT_MINUTES = 1440; // 與後端 PUT /settings 上限一致（24 小時）
const SYSTEM_LOG_POLL_INTERVAL_MS = 5 * 1000; // 系統維運日誌即時更新間隔

/**
 * 系統使用者紀錄資料結構
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
// ★ 2026-10-27：帳號改由後端會員系統提供（GET /api/v1/users）
type UserRecord = MemberAccount;
type AccountRole = FrontendRole;

/**
 * 安全與環境參數表單數值介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface EnvSecurityValues 
{
	sessionTimeout: number;        // Session 閒置強制登出時間 (分鐘)
}

/**
 * 基礎偏好設定子組件屬性介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
interface BasicPreferencesProps 
{
	currentUserRole: string; // 當前使用者角色
}

/**
 * 函數名稱: BasicPreferences
 * 函數功能: 渲染通用偏好設定卡片，提供深色/淺色主題切換開關與系統顯示語系選擇下拉選單。
 * 
 * 輸入參數 (Input):
 *   - props (BasicPreferencesProps): 包含當前使用者角色之屬性物件
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 基礎偏好設定卡片 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 於 SystemPreferences 主組件內渲染
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
const BasicPreferences = ({ currentUserRole }: BasicPreferencesProps): React.ReactElement => 
{
	// ★ 2026-10-29：偏好存後端；存不進去時提示（畫面已照常切換）
	const { message: preferenceMessageApi } = AntdApp.useApp();
	const notifyIfPreferenceNotSaved = (isSaved: boolean): void =>
	{
		if (!isSaved) preferenceMessageApi.warning(translate('preferences.save_failed', '偏好未能儲存到伺服器，重新登入後可能會恢復原設定'));
	};
	const { token } = theme.useToken();

	const { t: translate } = useTranslation();
	
	// 從 UIStore 訂閱主題與語言設定 (符合規範 g, i)
	const isDarkModeActive = useUIStore(
		(state) => state.isDarkMode
	);

	const setIsDarkModeAction = useUIStore(
		(state) => state.setIsDarkMode
	);

	const currentLanguageCode = useUIStore(
		(state) => state.language
	);

	const setLanguageAction = useUIStore(
		(state) => state.setLanguage
	);

	const currentFontSizeLevel = useUIStore(
		(state) => state.fontSizeLevel
	);

	const setFontSizeLevelAction = useUIStore(
		(state) => state.setFontSizeLevel
	);

	return (
		// ★ 2026-10-08：寬度改用 em（跟著字體大小等比例放大），字體調大時版面不會擠在一起
		<div style={{ maxWidth: '44em', margin: currentUserRole === 'admin' ? '0' : '40px auto' }}>
			<Card
				title={
					<Space>
						<SettingOutlined style={{ color: token.colorPrimary }} />
						<span style={{ fontSize: scaleFontSize(16), fontWeight: 600 }}>{translate('preferences.title', '介面偏好')}</span>
					</Space>
				}
				extra={<Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>{translate('preferences.saved_per_account', '依帳號記住，換電腦登入也一樣')}</Text>}
				variant="borderless"
				style={
					{
						background: token.colorBgContainer,
						boxShadow: isDarkModeActive ? 'none' : '0 4px 20px rgba(0,0,0,0.05)',
						borderRadius: '12px',
						border: isDarkModeActive ? `1px solid ${token.colorBorderSecondary}` : 'none'
					}
				}
			>
				{/* 深色模式切換行 */}
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
					<Space size="middle">
						<div style={{ backgroundColor: token.colorFillAlter, padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isDarkModeActive ? '#fadb14' : '#fa8c16' }}>
							{isDarkModeActive ? <MoonOutlined style={{ fontSize: scaleFontSize(18) }} /> : <SunOutlined style={{ fontSize: scaleFontSize(18) }} />}
						</div>

						<div style={{ display: 'flex', flexDirection: 'column' }}>
							<Text strong style={{ fontSize: scaleFontSize(15) }}>{translate('preferences.dark_mode', '深色模式')}</Text>
							<Text type="secondary" style={{ fontSize: scaleFontSize(13) }}>{translate('preferences.dark_mode_desc', '切換深色/淺色主題外觀')}</Text>
						</div>
					</Space>

					<Switch checked={isDarkModeActive} onChange={(isChecked) => void setIsDarkModeAction(isChecked).then(notifyIfPreferenceNotSaved)} checkedChildren={<MoonOutlined />} unCheckedChildren={<SunOutlined />} style={{ minWidth: '4.5em' }} />
				</div>

				<Divider dashed style={{ margin: '16px 0' }} />

				{/* 系統語系選擇行 */}
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
					<Space size="middle">
						<div style={{ backgroundColor: token.colorFillAlter, padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: token.colorPrimary }}>
							<GlobalOutlined style={{ fontSize: scaleFontSize(18) }} />
						</div>

						<div style={{ display: 'flex', flexDirection: 'column' }}>
							<Text strong style={{ fontSize: scaleFontSize(15) }}>{translate('preferences.language', '系統語系')}</Text>
							<Text type="secondary" style={{ fontSize: scaleFontSize(13) }}>{translate('preferences.language_desc', '選擇您偏好的語言介面')}</Text>
						</div>
					</Space>

					<Select
						value={currentLanguageCode}
						onChange={(selectedLanguageVal) => void setLanguageAction(selectedLanguageVal).then(notifyIfPreferenceNotSaved)}
						style={{ minWidth: '9em' }}
						popupMatchSelectWidth={false}
						options={
							[
								{ value: 'zh_TW', label: '繁體中文' },
								{ value: 'en_US', label: 'English' },
							]
						}
					/>
				</div>

				<Divider dashed style={{ margin: '16px 0' }} />

				{/* 字體大小調整行 */}
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
					<Space size="middle">
						<div style={{ backgroundColor: token.colorFillAlter, padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: token.colorPrimary }}>
							<FontSizeOutlined style={{ fontSize: scaleFontSize(18) }} />
						</div>

						<div style={{ display: 'flex', flexDirection: 'column' }}>
							<Text strong style={{ fontSize: scaleFontSize(15) }}>{translate('preferences.font_size', '字體大小')}</Text>
							<Text type="secondary" style={{ fontSize: scaleFontSize(13) }}>{translate('preferences.font_size_desc', '調整系統介面文字顯示大小')}</Text>
						</div>
					</Space>

					<Segmented
						value={currentFontSizeLevel}
						onChange={(selectedFontSizeLevelVal) => void setFontSizeLevelAction(selectedFontSizeLevelVal as FontSizeLevel).then(notifyIfPreferenceNotSaved)}
						options={
							[
								{ value: 'small', label: translate('preferences.font_size_small', '小') },
								{ value: 'medium', label: translate('preferences.font_size_medium', '中') },
								{ value: 'large', label: translate('preferences.font_size_large', '大') },
								{ value: 'extraLarge', label: translate('preferences.font_size_extra_large', '特大') },
							]
						}
					/>
				</div>
			</Card>
		</div>
	);
};

/**
 * 函數名稱: SystemPreferences
 * 函數功能: 渲染後台管理控制台與系統偏好頁面，提供 Admin 角色管理用戶帳號、檢視維運日誌、調整安全參數，或給普通用戶調整介面偏好。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 後台管理主頁面 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 被 AppRouter 主路由組件載入渲染
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function SystemPreferences(): React.ReactElement 
{
	const { t: translate } = useTranslation();

	const { message: messageApi, modal: modalApi } = AntdApp.useApp(); 
	
	// URL 查詢參數與動態頁籤切換狀態 (符合規範 g)
	const [searchParamsObj, setSearchParamsAction] = useSearchParams();

	const activeTabIdentifier = searchParamsObj.get('tab') || 'users';
	
	// 主題與使用者狀態訂閱 (符合規範 g, i)
	const currentUserSession = useAuthStore(
		(state) => state.user
	);

	// ★ 2026-10-29：未登入時不再預設為 admin（本頁由路由守門，正常情況必有登入者）
	const currentUserRoleName = currentUserSession?.role ?? 'data_owner';
	const operatorNameString = currentUserSession?.name ?? '';

	// ★ 2026-10-07：系統維運日誌改為動態資料（見 useSystemLogStore.ts）
	const systemLogEntriesList = useSystemLogStore((state) => state.logs);
	const clearSystemLogsAction = useSystemLogStore((state) => state.clearLogs);
	const loadSystemLogsAction = useSystemLogStore((state) => state.loadLogs);
	const pollNewSystemLogsAction = useSystemLogStore((state) => state.pollNewLogs);
	const recentlyArrivedLogIdsList = useSystemLogStore((state) => state.recentlyArrivedIds);
	const systemLogsLastSyncedAt = useSystemLogStore((state) => state.lastSyncedAt);
	// 連續 2 次（約 10 秒）同步失敗即顯示連線中斷
	const isSystemLogSyncBroken = useSystemLogStore((state) => state.consecutivePollFailures) >= 2;
	const isSystemLogTabActive = activeTabIdentifier === 'syslogs' && currentUserRoleName === 'admin';
	const isSystemLogDarkMode = useUIStore((state) => state.isDarkMode);

	// ★ 2026-10-29：日誌即時更新與圖表——期間篩選、每 5 秒抓新紀錄（分頁隱藏或暫停時不抓）、關鍵字、點圖篩選
	const [systemLogRangeKey, setSystemLogRangeKey] = useState<SystemLogRangeKey>('24h');
	const [isSystemLogLiveUpdateOn, setIsSystemLogLiveUpdateOn] = useState<boolean>(true);
	const [systemLogKeyword, setSystemLogKeyword] = useState<string>('');
	const [systemLogChartSelection, setSystemLogChartSelection] = useState<SystemLogChartSelection | null>(null);
	const [systemLogNowMs, setSystemLogNowMs] = useState<number>(() => Date.now());
	const [isSystemLogReloading, setIsSystemLogReloading] = useState<boolean>(false);

	const reloadSystemLogs = useCallback(async (): Promise<void> =>
	{
		setIsSystemLogReloading(true);
		await loadSystemLogsAction(resolveRangeStartMs(systemLogRangeKey));
		setSystemLogNowMs(Date.now());
		setIsSystemLogReloading(false);
	}, [loadSystemLogsAction, systemLogRangeKey]);

	useEffect(() =>
	{
		if (isSystemLogTabActive) void reloadSystemLogs();
	}, [isSystemLogTabActive, reloadSystemLogs]);

	useEffect(() =>
	{
		if (!isSystemLogTabActive || !isSystemLogLiveUpdateOn) return undefined;
		const pollTimerId = window.setInterval(() =>
		{
			if (document.visibilityState !== 'visible') return;
			void pollNewSystemLogsAction().then(() => setSystemLogNowMs(Date.now()));
		}, SYSTEM_LOG_POLL_INTERVAL_MS);
		return () => window.clearInterval(pollTimerId);
	}, [isSystemLogTabActive, isSystemLogLiveUpdateOn, pollNewSystemLogsAction]);

	const [systemLogLevelFilter, setSystemLogLevelFilter] = useState<'ALL' | SystemLogLevel>('ALL');
	const normalizedSystemLogKeyword = systemLogKeyword.trim().toLowerCase();
	// 期間＋關鍵字＋點圖選取（不含層級）：層級按鈕上的數字以此計算
	const rangedSystemLogEntriesList = filterLogsByRange(systemLogEntriesList, systemLogRangeKey, systemLogNowMs).filter((logEntryItem) =>
		(!normalizedSystemLogKeyword || logEntryItem.event.toLowerCase().includes(normalizedSystemLogKeyword) || logEntryItem.source.toLowerCase().includes(normalizedSystemLogKeyword))
		&& (!systemLogChartSelection?.timeRange || (logEntryItem.timestamp >= systemLogChartSelection.timeRange.startMs && logEntryItem.timestamp < systemLogChartSelection.timeRange.endMs))
		&& (!systemLogChartSelection?.source || logEntryItem.source === systemLogChartSelection.source));
	const effectiveSystemLogLevelFilter = systemLogChartSelection?.level ?? systemLogLevelFilter;
	const filteredSystemLogEntriesList = effectiveSystemLogLevelFilter === 'ALL'
		? rangedSystemLogEntriesList
		: rangedSystemLogEntriesList.filter(logEntryItem => logEntryItem.level === effectiveSystemLogLevelFilter);
	const recentlyArrivedLogIdsSet = new Set(recentlyArrivedLogIdsList);

	// 閒置登出時間（★ 2026-10-29 存後端，由 utils/systemSettingsSync 寫入 WorkspaceStore）
	const sessionTimeoutMinutes = useWorkspaceStore((state) => (state as unknown as { sessionTimeout?: number }).sessionTimeout) ?? DEFAULT_SESSION_TIMEOUT_MINUTES;

	// 表單實例宣告 (符合規範 g)
	const [envSecurityFormInstance] = Form.useForm<EnvSecurityValues>();

	// 當 Store 中的安全參數更新時，同步回填置 envSecurityFormInstance 表單欄位
	useEffect(
		() => 
		{
			envSecurityFormInstance.setFieldsValue({ sessionTimeout: sessionTimeoutMinutes });
		}, 
		[sessionTimeoutMinutes, envSecurityFormInstance]
	);

	/**
	 * 函數名稱: handleSaveEnvSettings
	 * 函數功能: 觸發環境與安全參數表單驗證，並將通過驗證之數值寫入 WorkspaceStore。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於「儲存環境設定」按鈕之 onClick 事件
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
	const handleSaveEnvSettings = (): void => 
	{
		envSecurityFormInstance.validateFields().then(
			(formValuesObj: EnvSecurityValues) => 
			{
				// ★ 2026-10-29：閒置登出時間存後端（所有人共用、重新整理後仍保留）
				saveSystemSettings({ sessionTimeoutMinutes: Number(formValuesObj.sessionTimeout) })
					.then(() =>
					{
						logSystemEvent('INFO', `更新安全與環境參數：閒置登出 ${formValuesObj.sessionTimeout} 分鐘`, operatorNameString);
						messageApi.success(
							translate('admin.msg_env_saved', '環境與安全設定已成功儲存')
						);
					})
					.catch((saveErrorValue) =>
					{
						console.warn('[系統設定] 儲存失敗：', saveErrorValue);
						void loadSystemSettings();
						messageApi.error(toMemberApiError(saveErrorValue).status === 422
							? translate('admin.msg_env_save_invalid', '數值不合法：閒置登出時間須為 1～1440 的整數分鐘')
							: translate('admin.msg_env_save_failed', '儲存失敗，請確認後端連線後再試一次'));
					});
			}
		);
	};

	// ★ 2026-10-27：帳號清單改由後端提供
	const [userRecordList, setUserRecordList] = useState<UserRecord[]>([]);
	const [isUserListLoading, setIsUserListLoading] = useState<boolean>(currentUserRoleName === 'admin');
	const [userListErrorText, setUserListErrorText] = useState<string | null>(null);
	const [isUserActionSubmitting, setIsUserActionSubmitting] = useState<boolean>(false);
	const currentOperatorUsernameString = currentUserSession?.email || '';
	const isSelfAccount = (userRecordItem: UserRecord): boolean => userRecordItem.username === currentOperatorUsernameString;

	/** 重新向後端讀取帳號清單 */
	const reloadUserList = useCallback(async (): Promise<void> =>
	{
		setIsUserListLoading(true);
		try
		{
			setUserRecordList(await listMemberAccounts());
			setUserListErrorText(null);
		}
		catch (listErrorValue)
		{
			setUserListErrorText(toMemberApiError(listErrorValue).message);
		}
		finally
		{
			setIsUserListLoading(false);
		}
	}, []);

	// 進入頁面時讀取一次（setState 只在非同步回應後執行，避免於 effect 內同步更新狀態）
	useEffect(() =>
	{
		if (currentUserRoleName !== 'admin') return undefined;
		let isUnmounted = false;
		listMemberAccounts()
			.then((accountsList) => { if (!isUnmounted) { setUserRecordList(accountsList); setUserListErrorText(null); } })
			.catch((listErrorValue) => { if (!isUnmounted) setUserListErrorText(toMemberApiError(listErrorValue).message); })
			.finally(() => { if (!isUnmounted) setIsUserListLoading(false); });
		return () => { isUnmounted = true; };
	}, [currentUserRoleName]);

	/** 共用：呼叫後端帳號管理 API，成功後重讀清單；失敗顯示後端訊息（409 帳號重複交由表單顯示）並回傳錯誤物件 */
	const runUserAction = async (actionFn: () => Promise<void>, successMessageText: string): Promise<ReturnType<typeof toMemberApiError> | null> =>
	{
		setIsUserActionSubmitting(true);
		try
		{
			await actionFn();
			messageApi.success(successMessageText);
			await reloadUserList();
			return null;
		}
		catch (actionErrorValue)
		{
			const memberErrorObj = toMemberApiError(actionErrorValue);
			if (memberErrorObj.status !== 409) messageApi.error(memberErrorObj.message);
			return memberErrorObj;
		}
		finally
		{
			setIsUserActionSubmitting(false);
		}
	};

	// Modal 與編輯狀態宣告 (符合規範 g)
	const [isUserModalVisible, setIsUserModalVisible] = useState<boolean>(false);

	const [editingUserRecordObj, setEditingUserRecordObj] = useState<UserRecord | null>(null);

	const [userFormInstance] = Form.useForm();

	const [isResetPwdModalVisible, setIsResetPwdModalVisible] = useState<boolean>(false);

	const [resetPwdTargetUserObj, setResetPwdTargetUserObj] = useState<UserRecord | null>(null);

	const [resetPwdFormInstance] = Form.useForm();

	/**
	 * 函數名稱: handleAddUser
	 * 函數功能: 開啟新增使用者 Modal 彈窗，並重置表單欄位為預設值。
	 * 
	 * 輸入參數 (Input): 無
	 * 返回值 (Return): void
	 */
	const handleAddUser = (): void => 
	{
		setEditingUserRecordObj(null);

		userFormInstance.resetFields();

		userFormInstance.setFieldsValue({ role: 'data_owner' }); 

		setIsUserModalVisible(true);
	};

	/**
	 * 函數名稱: handleEditUser
	 * 函數功能: 開啟「變更角色」Modal（後端只有帳號與角色，帳號名稱不可修改）。
	 * 
	 * 輸入參數 (Input):
	 *   - targetUserRecordObj (UserRecord): 被選取之帳號
	 * 返回值 (Return): void
	 */
	const handleEditUser = (targetUserRecordObj: UserRecord): void => 
	{
		setEditingUserRecordObj(targetUserRecordObj);

		userFormInstance.setFieldsValue({ email: targetUserRecordObj.username, role: targetUserRecordObj.role });

		setIsUserModalVisible(true);
	};

	/**
	 * 函數名稱: handleDeleteUser
	 * 函數功能: 呼叫後端刪除帳號（DELETE /users/{帳號}）。不得刪除自己（後端亦會擋）。
	 * 
	 * 輸入參數 (Input):
	 *   - targetUserRecordObj (UserRecord): 欲刪除之帳號
	 * 返回值 (Return): Promise<void>
	 */
	const handleDeleteUser = async (targetUserRecordObj: UserRecord): Promise<void> => 
	{
		if (isSelfAccount(targetUserRecordObj))
		{
			messageApi.error(translate('admin.msg_cannot_delete_self', '不能刪除自己目前登入的帳號'));
			return;
		}
		const actionError = await runUserAction(() => deleteMemberAccount(targetUserRecordObj.username), translate('admin.msg_user_deleted', '使用者已成功刪除'));
		if (!actionError) logSystemEvent('WARN', `刪除帳號：${targetUserRecordObj.username}`, operatorNameString);
	};

	/**
	 * 函數名稱: showDeleteConfirm
	 * 函數功能: 彈出二次確認 Modal，防止管理員誤觸刪除使用者帳號。
	 * 
	 * 輸入參數 (Input):
	 *   - targetUserRecordObj (UserRecord): 欲刪除之帳號
	 * 返回值 (Return): void
	 */
	const showDeleteConfirm = (targetUserRecordObj: UserRecord): void => 
	{
		modalApi.confirm({
			title: translate('admin.delete_confirm_title', '確認刪除'),
			icon: <ExclamationCircleFilled />,
			content: translate('admin.delete_confirm_desc', '您確定要刪除此帳號嗎？此操作無法復原。'),
			okText: translate('admin.btn_confirm', '確認'),
			okType: 'danger',
			cancelText: translate('admin.btn_cancel', '取消'),
			onOk() 
			{
				return handleDeleteUser(targetUserRecordObj);
			},
		});
	};

	/**
	 * 函數名稱: handleSaveUser
	 * 函數功能: 處理新增或編輯使用者 Modal 之驗證與儲存流程。
	 * 
	 * 輸入參數 (Input): 無
	 * 返回值 (Return): void
	 */
	const handleSaveUser = (): void => 
	{
		userFormInstance.validateFields().then(
			async (userFormValuesObj: { email: string; role: AccountRole; initialPassword?: string; operatorPassword?: string }) =>
			{
				if (editingUserRecordObj) 
				{
					if (editingUserRecordObj.role === userFormValuesObj.role)
					{
						setIsUserModalVisible(false);
						return;
					}
					if (isSelfAccount(editingUserRecordObj))
					{
						userFormInstance.setFields([{ name: 'role', errors: [translate('admin.msg_cannot_change_own_role', '不能變更自己目前登入帳號的角色')] }]);
						return;
					}
					const actionError = await runUserAction(
						() => changeMemberRole(editingUserRecordObj.username, userFormValuesObj.role, userFormValuesObj.operatorPassword),
						translate('admin.msg_role_updated', '角色已變更')
					);
					// ★ 2026-11-02（B4）：降級管理員時密碼確認失敗，標在密碼欄位上
					if (actionError?.status === 403 && editingUserRecordObj.role === 'admin')
					{
						userFormInstance.setFields([{ name: 'operatorPassword', errors: [translate('admin.operator_password_wrong', '密碼不正確')] }]);
						return;
					}
					if (actionError) return;
					logSystemEvent('INFO', `變更帳號角色：${editingUserRecordObj.username} → ${getRoleDisplayName(userFormValuesObj.role)}`, operatorNameString);
				} 
				else 
				{
					const newUsernameString = userFormValuesObj.email.trim();
					const actionError = await runUserAction(
						() => createMemberAccount(newUsernameString, userFormValuesObj.initialPassword || '', userFormValuesObj.role),
						translate('admin.msg_user_added_with_pwd', '已新增使用者，請將初始密碼交給對方，並提醒登入後自行變更密碼。')
					);
					if (actionError?.status === 409)
					{
						userFormInstance.setFields([{ name: 'email', errors: [translate('admin.account_duplicate', '此帳號已存在')] }]);
						return;
					}
					if (actionError) return;
					logSystemEvent('INFO', `新增帳號：${newUsernameString}（${getRoleDisplayName(userFormValuesObj.role)}）`, operatorNameString);
				}

				setIsUserModalVisible(false);
			}
		);
	};

	/**
	 * 函數名稱: handleToggleStatus
	 * 函數功能: 呼叫後端切換帳號啟用／停用（PATCH /users/{帳號}/active）。停用後該帳號既有的登入一併失效。
	 * 
	 * 輸入參數 (Input):
	 *   - targetUserRecordObj (UserRecord): 目標帳號
	 * 返回值 (Return): Promise<void>
	 */
	const handleToggleStatus = async (targetUserRecordObj: UserRecord): Promise<void> => 
	{
		const nextIsActiveStatus = !targetUserRecordObj.isActive;
		if (!nextIsActiveStatus && isSelfAccount(targetUserRecordObj))
		{
			messageApi.error(translate('admin.msg_cannot_disable_self', '不能停用自己目前登入的帳號'));
			return;
		}
		const actionError = await runUserAction(
			() => setMemberActive(targetUserRecordObj.username, nextIsActiveStatus),
			translate('admin.msg_status_updated', '帳號狀態已更新')
		);
		if (!actionError) logSystemEvent(nextIsActiveStatus ? 'INFO' : 'WARN', `${nextIsActiveStatus ? '啟用' : '停用'}帳號：${targetUserRecordObj.username}`, operatorNameString);
	};

	/**
	 * 函數名稱: handleOpenResetPwd
	 * 函數功能: 開啟強制重設密碼 Modal，並設定目標使用者。
	 * 
	 * 輸入參數 (Input):
	 *   - targetUserRecordObj (UserRecord): 目標使用者紀錄物件
	 * 返回值 (Return): void
	 */
	const handleOpenResetPwd = (targetUserRecordObj: UserRecord): void => 
	{
		setResetPwdTargetUserObj(targetUserRecordObj);

		resetPwdFormInstance.resetFields();

		setIsResetPwdModalVisible(true);
	};

	/**
	 * 函數名稱: handleSaveResetPwd
	 * 函數功能: 執行管理員強制重設使用者密碼表單驗證與儲存。
	 * 
	 * 輸入參數 (Input): 無
	 * 返回值 (Return): void
	 */
	const handleSaveResetPwd = (): void => 
	{
		resetPwdFormInstance.validateFields().then(
			async () => 
			{
				if (!resetPwdTargetUserObj) return;
				// 同步後端：不能重設任何 Admin（含自己）的密碼；Admin 變更自己的密碼請至個人設定
				if (resetPwdTargetUserObj.role === 'admin')
				{
					messageApi.error(translate('admin.msg_cannot_reset_admin_pwd', '不能重設 Admin 帳號的密碼；Admin 請至「個人設定」自行變更。'));
					return;
				}
				const actionError = await runUserAction(
					() => resetMemberPassword(resetPwdTargetUserObj.username, String(resetPwdFormInstance.getFieldValue('newPassword') || '')),
					translate('admin.msg_pwd_reset_success_name', '已重設 {{name}} 的密碼', { name: resetPwdTargetUserObj.username })
				);
				if (actionError) return;
				logSystemEvent('WARN', `管理員重設密碼：${resetPwdTargetUserObj.username}（已解除鎖定、該帳號需重新登入）`, operatorNameString);

				setIsResetPwdModalVisible(false);
			}
		);
	};

	/**
	 * 函數名稱: formatSystemLogTimestamp
	 * 函數功能: 將 epoch 毫秒轉成本地時間 YYYY-MM-DD HH:mm:ss。
	 */
	const formatSystemLogTimestamp = (timestampMsValue: number): string =>
	{
		const dateObj = new Date(timestampMsValue);
		const padTwoDigits = (numberValue: number): string => String(numberValue).padStart(2, '0');
		return `${dateObj.getFullYear()}-${padTwoDigits(dateObj.getMonth() + 1)}-${padTwoDigits(dateObj.getDate())} ${padTwoDigits(dateObj.getHours())}:${padTwoDigits(dateObj.getMinutes())}:${padTwoDigits(dateObj.getSeconds())}`;
	};

	/**
	 * 函數名稱: showClearSystemLogsConfirm
	 * 函數功能: 二次確認後清除所有系統維運日誌，並留下一筆「已清除」紀錄。
	 */
	const showClearSystemLogsConfirm = (): void =>
	{
		modalApi.confirm({
			title: translate('admin.syslog_clear_title', '清除系統維運日誌'),
			icon: <ExclamationCircleFilled />,
			content: translate('admin.syslog_clear_desc', '確定要清除所有系統維運日誌嗎？此操作無法復原。'),
			okText: translate('admin.btn_confirm', '確認'),
			okType: 'danger',
			cancelText: translate('admin.btn_cancel', '取消'),
			async onOk()
			{
				try
				{
					await clearSystemLogsAction();
					logSystemEvent('WARN', '系統維運日誌已被清除', operatorNameString);
				}
				catch (clearErrorValue)
				{
					console.warn('[系統維運日誌] 清除失敗：', clearErrorValue);
					messageApi.error(translate('admin.syslog_clear_failed', '清除失敗，請確認後端連線後再試一次'));
				}
			},
		});
	};

	// 使用者表格欄位定義 (符合規範 g, h)
	const userTableColumnsConfig = [
		{ title: translate('admin.col_account', '帳號（Email）'), dataIndex: 'username', key: 'username', render: (usernameTextString: string, userRecordItem: UserRecord) => (
			<Space size={6}>
				<Text strong>{usernameTextString}</Text>
				{isSelfAccount(userRecordItem) && <Tag style={{ margin: 0 }}>{translate('admin.tag_self', '目前登入')}</Tag>}
			</Space>
		) },
		{ 
			title: translate('admin.col_role', '系統角色'), 
			dataIndex: 'role', 
			key: 'role',
			render: (roleNameString: string) => (
				<Tag color={roleNameString === 'admin' ? 'purple' : 'blue'}>
					{getRoleDisplayName(roleNameString)}
				</Tag>
			)
		},
		{ 
			title: translate('admin.col_status', '帳號狀態'), 
			dataIndex: 'isActive', 
			key: 'isActive',
			render: (isActiveStatus: boolean, userRecordItem: UserRecord) => (
				<Space size={4} wrap>
					<Tag color={isActiveStatus ? 'success' : 'error'} style={{ margin: 0 }}>
						{isActiveStatus ? translate('admin.status_active', '啟用') : translate('admin.status_disabled', '停用')}
					</Tag>
					{/* ★ 2026-10-29：後端 GET /users 回傳鎖定到期時間；鎖定中可用「重設密碼」提前解除 */}
					{isMemberAccountLocked(userRecordItem) && (
						<Tooltip title={translate('admin.locked_until_tip', '連續登入失敗被鎖定，{{time}} 解除；重設密碼可提前解除', { time: formatSystemLogTimestamp(userRecordItem.lockedUntil ?? 0) })}>
							<Tag color="warning" style={{ margin: 0 }}>{translate('admin.status_locked', '鎖定中')}</Tag>
						</Tooltip>
					)}
				</Space>
			)
		},
		// ★ 2026-10-27：後端帳號清單只有建立時間（無最後登入、密碼變更時間）
		{
			title: translate('admin.col_created_at', '建立時間'), dataIndex: 'createdAt', key: 'createdAt',
			render: (createdAtMsValue: number | null) => createdAtMsValue ? formatSystemLogTimestamp(createdAtMsValue) : '-'
		},
		{ 
			title: translate('admin.col_action', '操作'), 
			key: 'action',
			width: '6.5em', 
			align: 'center' as const,
			render: (_: unknown, userRecordItem: UserRecord) => 
			{
				// 後端規則：不得變更自己的角色、停用或刪除自己；不得重設任何 Admin 的密碼
				const isSelfStatus = isSelfAccount(userRecordItem);
				const menuDropdownItemsConfig: MenuProps['items'] = [
					{
						key: 'edit',
						icon: <EditOutlined />,
						label: translate('admin.action_change_role', '變更角色'),
						disabled: isSelfStatus,
						onClick: () => handleEditUser(userRecordItem)
					},
					...(userRecordItem.role !== 'admin' ? [{
						key: 'reset_pwd',
						icon: <KeyOutlined />,
						label: translate('admin.action_reset_pwd_unlock', '重設密碼（並解除鎖定）'),
						onClick: () => handleOpenResetPwd(userRecordItem)
					}] : []),
					{
						key: 'toggle_status',
						icon: userRecordItem.isActive ? <StopOutlined /> : <CheckCircleOutlined />,
						label: userRecordItem.isActive ? translate('admin.action_disable', '停用帳號') : translate('admin.action_enable', '啟用帳號'),
						disabled: isSelfStatus,
						onClick: () => { void handleToggleStatus(userRecordItem); }
					},
					{ type: 'divider' },
					{
						key: 'delete',
						icon: <DeleteOutlined />,
						label: translate('admin.action_delete', '刪除帳號'),
						danger: true,
						disabled: isSelfStatus,
						onClick: () => showDeleteConfirm(userRecordItem)
					}
				];

				return (
					<Dropdown menu={{ items: menuDropdownItemsConfig }} trigger={['click']} placement="bottomRight" rootClassName="user-manage-dropdown" disabled={isUserActionSubmitting}>
						<Button
							type="text"
							shape="circle"
							icon={<SettingOutlined style={{ fontSize: '16px' }} />}
							title={translate('admin.action_manage', '管理')}
							aria-label={translate('admin.action_manage', '管理')}
						/>
					</Dropdown>
				);
			}
		},
	];

	// 系統日誌表格欄位定義 (符合規範 g, h)
	const logTableColumnsConfig = [
		{ title: translate('admin.col_time', '時間'), dataIndex: 'timestamp', key: 'timestamp', width: '11em', render: (timestampMsValue: number) => formatSystemLogTimestamp(timestampMsValue) },
		{ 
			title: translate('admin.col_level', '層級'), 
			dataIndex: 'level', 
			key: 'level',
			width: '6.5em',
			render: (levelNameString: string) => 
			{
				const levelTagColor = levelNameString === 'ERROR' ? 'red' : levelNameString === 'WARN' ? 'orange' : 'green';

				return <Tag color={levelTagColor}>{levelNameString}</Tag>;
			}
		},
		{ title: translate('admin.col_event', '系統事件'), dataIndex: 'event', key: 'event' },
		{ title: translate('admin.col_source', '來源'), dataIndex: 'source', key: 'source', width: '16em', ellipsis: true },
		// ★ 2026-10-29：哪個帳號寫入的；前端回報的事件標「前端」（後端自行記錄的才計入管理大廳統計）
		{
			title: translate('admin.col_log_account', '帳號'), dataIndex: 'username', key: 'username', width: '14em', ellipsis: true,
			render: (usernameValue: string | null | undefined, logEntryItem: SystemLogEntry) => (
				<Space size={4}>
					<span>{usernameValue || '-'}</span>
					{logEntryItem.origin === 'client' && (
						<Tooltip title={translate('admin.log_origin_client_tip', '由瀏覽器回報的事件（例如閒置登出、設定變更）；登入與 API 呼叫由後端自行記錄')}>
							<Tag style={{ margin: 0 }}>{translate('admin.log_origin_client', '前端')}</Tag>
						</Tooltip>
					)}
				</Space>
			)
		},
	];

	const tabListItemsArray = [];
	
	if (currentUserRoleName === 'admin') 
	{
		tabListItemsArray.push(
			{
				key: 'users',
				label: <span><TeamOutlined /> {translate('admin.tab_users', '帳號與權限管理')}</span>,
				children: (
					<div>
						<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
							<div>
								<Title level={5} style={{ margin: 0 }}>{translate('admin.user_list', '系統使用者列表')}</Title>
								<Text type="secondary">{translate('admin.user_list_desc_backend', '負責開通 User／Admin 帳號、設定角色與密碼，不包含任何資料授權。帳號資料保存在後端伺服器。')}</Text>
							</div>

							<Space>
								<Button icon={<ReloadOutlined />} onClick={() => { void reloadUserList(); }} loading={isUserListLoading}>
									{translate('admin.reload', '重新整理')}
								</Button>
								<Button type="primary" icon={<PlusOutlined />} onClick={handleAddUser}>
									{translate('admin.add_user', '新增使用者')}
								</Button>
							</Space>
						</div>

						{userListErrorText && (
							<Alert type="error" showIcon style={{ marginBottom: 16 }} message={translate('admin.user_list_load_failed', '無法取得帳號清單')} description={userListErrorText} />
						)}

						<Table columns={userTableColumnsConfig} dataSource={userRecordList} rowKey="username" loading={isUserListLoading} pagination={{ pageSize: 10 }} size="middle" />
					</div>
				),
			},
			{
				key: 'syslogs',
				label: <span><CodeOutlined /> {translate('admin.tab_syslogs', '系統維運日誌')}</span>,
				children: (
					<div>
						<Alert 
							message={translate('admin.syslog_title', '系統維運日誌')}
							description={translate('admin.syslog_desc', '記錄登入成功／失敗、帳號鎖定、登出、每次處理 API 呼叫（含帳號與耗時），以及閒置登出、帳號管理與安全設定變更等事件。標「前端」的是由瀏覽器回報的事件；登入與 API 統計只採後端自行記錄的事件。各次處理的設定與結果請至「處理紀錄」查看（管理員可看所有使用者的紀錄）。')}
							type="info" 
							showIcon 
							style={{ marginBottom: '16px' }}
						/>

						{/* ★ 2026-10-29：新到的紀錄淡黃底 3 秒後淡出 */}
						<style>{`@keyframes syslog-row-arrived { from { background: rgba(250, 219, 20, 0.35); } to { background: transparent; } } .syslog-row-arrived > td { animation: syslog-row-arrived 3s ease-out; }`}</style>

						{/* 第一列：期間、即時更新、重新整理、清除 */}
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
							<Space wrap>
								<Segmented
									value={systemLogRangeKey}
									onChange={(selectedRangeValue) => { setSystemLogRangeKey(selectedRangeValue as SystemLogRangeKey); setSystemLogChartSelection(null); }}
									options={[
										{ value: '1h', label: translate('admin.syslog_range_1h', '1 小時') },
										{ value: '24h', label: translate('admin.syslog_range_24h', '24 小時') },
										{ value: '7d', label: translate('admin.syslog_range_7d', '7 天') },
										{ value: 'all', label: translate('admin.syslog_range_all', '全部') },
									]}
								/>
								<Button
									icon={isSystemLogLiveUpdateOn ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
									onClick={() => setIsSystemLogLiveUpdateOn(!isSystemLogLiveUpdateOn)}
									type={isSystemLogLiveUpdateOn ? 'default' : 'dashed'}
								>
									{isSystemLogLiveUpdateOn ? translate('admin.syslog_live_pause', '暫停即時更新') : translate('admin.syslog_live_resume', '開啟即時更新')}
								</Button>
								<Text type="secondary" style={{ fontSize: scaleFontSize(12) }} data-testid="syslog-live-status">
									{isSystemLogSyncBroken
										? <Badge status="error" text={translate('admin.syslog_live_broken', '連線中斷，無法取得最新紀錄（會自動重試）')} />
										: isSystemLogLiveUpdateOn
											? <Badge status="processing" text={translate('admin.syslog_live_on', '即時更新中（每 5 秒）')} />
											: <Badge status="default" text={translate('admin.syslog_live_off', '已暫停')} />}
									{systemLogsLastSyncedAt !== null && <span style={{ marginLeft: 8 }}>{translate('admin.syslog_last_synced', '最後更新 {{time}}', { time: formatSystemLogTimestamp(systemLogsLastSyncedAt) })}</span>}
								</Text>
							</Space>
							<Space wrap>
								<Button icon={<ReloadOutlined />} loading={isSystemLogReloading} onClick={() => void reloadSystemLogs()}>
									{translate('admin.syslog_reload', '重新整理')}
								</Button>
								<Button danger icon={<DeleteOutlined />} onClick={showClearSystemLogsConfirm} disabled={systemLogEntriesList.length === 0}>
									{translate('admin.syslog_clear', '清除日誌')}
								</Button>
							</Space>
						</div>

						<SystemLogCharts
							logs={systemLogEntriesList}
							rangeKey={systemLogRangeKey}
							nowMs={systemLogNowMs}
							isDarkMode={isSystemLogDarkMode}
							onSelect={(chartSelection) => setSystemLogChartSelection(chartSelection)}
						/>

						{/* 第二列：層級、關鍵字、點圖選取 */}
						<div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
							<Segmented
								value={effectiveSystemLogLevelFilter}
								onChange={(selectedLevelValue) => { setSystemLogLevelFilter(selectedLevelValue as 'ALL' | SystemLogLevel); if (systemLogChartSelection?.level) setSystemLogChartSelection({ ...systemLogChartSelection, level: undefined }); }}
								options={[
									{ value: 'ALL', label: `${translate('admin.syslog_filter_all', '全部')} (${rangedSystemLogEntriesList.length})` },
									{ value: 'INFO', label: `INFO (${rangedSystemLogEntriesList.filter(logEntryItem => logEntryItem.level === 'INFO').length})` },
									{ value: 'WARN', label: `WARN (${rangedSystemLogEntriesList.filter(logEntryItem => logEntryItem.level === 'WARN').length})` },
									{ value: 'ERROR', label: `ERROR (${rangedSystemLogEntriesList.filter(logEntryItem => logEntryItem.level === 'ERROR').length})` },
								]}
							/>
							<Input.Search
								allowClear
								style={{ width: '16em' }}
								placeholder={translate('admin.syslog_search_placeholder', '搜尋事件或來源')}
								value={systemLogKeyword}
								onChange={(inputEvent) => setSystemLogKeyword(inputEvent.target.value)}
							/>
							{systemLogChartSelection && (systemLogChartSelection.timeRange || systemLogChartSelection.source || systemLogChartSelection.level) && (
								<Tag closable closeIcon={<CloseOutlined />} color="blue" onClose={() => setSystemLogChartSelection(null)} style={{ margin: 0 }} data-testid="syslog-chart-selection">
									{[
										systemLogChartSelection.timeRange ? translate('admin.syslog_selection_time', '時段 {{label}}', { label: systemLogChartSelection.timeRange.label }) : null,
										systemLogChartSelection.level ?? null,
										systemLogChartSelection.source ? translate('admin.syslog_selection_api', 'API：{{source}}', { source: systemLogChartSelection.source.replace(' /api/v1', ' ') }) : null,
									].filter(Boolean).join('・')}
								</Tag>
							)}
						</div>

						<Table<SystemLogEntry>
							columns={logTableColumnsConfig}
							dataSource={filteredSystemLogEntriesList}
							rowKey="id"
							pagination={{ pageSize: 10 }}
							size="small"
							rowClassName={(logEntryItem) => (recentlyArrivedLogIdsSet.has(logEntryItem.id) ? 'syslog-row-arrived' : '')}
						/>
						{systemLogEntriesList.length >= 5000 && (
							<Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>
								{translate('admin.syslog_limit_note', '只載入最新 5000 筆；更早的紀錄請縮短期間查看。')}
							</Text>
						)}
					</div>
				),
			},
			{
				key: 'security',
				label: <span><SafetyCertificateOutlined /> {translate('admin.tab_security', '安全與環境參數')}</span>,
				children: (
					<div style={{ maxWidth: '44em' }}>
						<Form form={envSecurityFormInstance} layout="vertical">
							<Card type="inner" title={translate('admin.conn_security', '連線安全設定')} style={{ marginBottom: '16px' }}>
								<Form.Item name="sessionTimeout" label={translate('admin.session_timeout', 'Session 閒置強制登出時間 (分鐘)')} extra={translate('admin.session_timeout_desc', '設定使用者在無操作狀態下多久後會被系統自動登出。')}>
									<InputNumber min={MIN_SESSION_TIMEOUT_MINUTES} max={MAX_SESSION_TIMEOUT_MINUTES} precision={0} style={{ width: '7em' }} />
								</Form.Item>

								{/* ★ 2026-10-16：登入失敗鎖定改為固定規則（同步後端會員系統），不提供設定 */}
								<Alert
									type="info"
									showIcon
									message={translate('admin.fixed_lockout_title', '登入失敗鎖定（固定規則）')}
									description={translate('admin.fixed_lockout_desc', '同一帳號自第一次失敗起 {{window}} 秒內累計失敗 {{count}} 次，即鎖定 {{minutes}} 分鐘；鎖定期間密碼正確也無法登入。管理員重設該帳號密碼可提前解除。', { window: LOGIN_ATTEMPT_WINDOW_SECONDS, count: LOGIN_MAX_ATTEMPTS, minutes: LOGIN_LOCKOUT_SECONDS / 60 })}
								/>
							</Card>

							<div style={{ marginTop: '24px', textAlign: 'center' }}>
								<Button type="primary" size="large" onClick={handleSaveEnvSettings} icon={<SettingOutlined />}>
									{translate('admin.save_env_settings', '儲存環境設定')}
								</Button>
							</div>
						</Form>
					</div>
				),
			}
		);
	}

	// ★ 2026-11-12：管理員的唯讀「系統模式」分頁——顯示目前是本地／內網／線上，並說明如何在主機上切換（見 ModeInfoPanel.tsx）
	if (currentUserRoleName === 'admin')
	{
		tabListItemsArray.push({
			key: 'mode',
			label: <span><ApiOutlined /> {translate('admin.tab_mode', '系統模式')}</span>,
			children: <ModeInfoPanel mode={RUNTIME_MODE} />,
		});
	}

	// ★ 2026-10-29：單機版隱藏「系統維運日誌」分頁（見 config/featureFlags.ts）；系統公告同日移除
	for (let tabIndex = tabListItemsArray.length - 1; tabIndex >= 0; tabIndex--)
	{
		const tabKeyString = tabListItemsArray[tabIndex].key;
		if (tabKeyString === 'syslogs' && !SHOW_SYSTEM_LOG_TAB) tabListItemsArray.splice(tabIndex, 1);
	}

	tabListItemsArray.push({
		key: 'preferences',
		label: <span><SettingOutlined /> {translate('preferences.title', '介面偏好')}</span>,
		children: <BasicPreferences currentUserRole={currentUserRoleName} />
	});

	const handleTabChange = (targetTabKeyIdentifier: string): void => 
	{
		setSearchParamsAction({ tab: targetTabKeyIdentifier });
	};

	if (currentUserRoleName === 'admin') 
	{
		return (
			<div style={{ padding: '0 24px', maxWidth: '86em', margin: '0 auto' }}>
				<Card 
					title={<span style={{ fontSize: scaleFontSize(18), fontWeight: 'bold' }}>{translate('admin.console_title', '系統設定')}</span>} 
					variant="borderless" 
					style={{ minHeight: '600px', borderRadius: '12px', marginTop: '24px' }}
				>
					{/* 分頁標籤放不下時自動換行（不收進「…」選單），字體調大時才不會被截斷 */}
					<Tabs className="wrap-tabs" activeKey={tabListItemsArray.some((tabItem) => tabItem.key === activeTabIdentifier) ? activeTabIdentifier : tabListItemsArray[0]?.key} onChange={handleTabChange} items={tabListItemsArray} size="large" />
				</Card>

				<Modal
					title={editingUserRecordObj ? translate('admin.change_role_title', '變更角色') : translate('admin.add_user_title', '新增使用者')}
					open={isUserModalVisible}
					onOk={handleSaveUser}
					onCancel={() => setIsUserModalVisible(false)}
					okText={translate('admin.btn_save', '儲存')}
					cancelText={translate('admin.btn_cancel', '取消')}
					confirmLoading={isUserActionSubmitting}
					destroyOnClose
				>
					<Form form={userFormInstance} layout="vertical" style={{ marginTop: '20px' }}>
						{/* ★ 2026-10-27：後端只有帳號，帳號即 Email（10/16 決議）；建立後不可修改 */}
						<Form.Item 
							name="email" 
							label={translate('admin.col_account', '帳號（Email）')} 
							rules={
								[
									{ required: true, message: translate('admin.email_required', '請輸入 Email') },
									{ type: 'email', message: translate('admin.email_invalid', '請輸入有效的 Email 格式') }
								]
							}
						>
							<Input placeholder="user@company.com" disabled={!!editingUserRecordObj} />
						</Form.Item>

						{!editingUserRecordObj && (
							<Form.Item
								name="initialPassword"
								label={translate('admin.initial_password', '初始密碼')}
								extra={translate('admin.initial_password_desc', '請將此密碼交給使用者，並提醒對方登入後至「個人設定」自行變更。')}
								rules={[
									{ required: true, message: translate('profile.require_new_password', '請輸入新密碼') },
									{ min: getPasswordMinLength(), message: translate('profile.password_min_length', '密碼長度至少需要 {{min}} 個字元', { min: getPasswordMinLength() }) },
									{
										pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/, // ★ 2026-10-29：不再限定可用字元（空白、句點等也可當特殊符號）；★ 2026-10-30：後端同一規則
										message: translate('profile.password_complexity', '密碼強度不足：需包含大小寫字母、數字及特殊符號 (如 @$!%*?&#)')
									}
								]}
							>
								<Input.Password placeholder={translate('profile.ph_new_password', '至少 {{min}} 個字元', { min: getPasswordMinLength() })} autoComplete="new-password" />
							</Form.Item>
						)}

						<Form.Item 
							name="role" 
							label={translate('admin.col_role', '系統角色')} 
							rules={[{ required: true }]}
						>
							<Select 
								options={
									[
										{ value: 'data_owner', label: translate('admin.role_data_owner', 'User') },
										{ value: 'admin', label: translate('admin.role_admin', 'Admin') }
									]
								} 
							/>
						</Form.Item>

						{/* ★ 2026-11-02（B4）：把管理員降級時，後端要求再次輸入「自己的」密碼確認（防止降級→重設密碼→升回以接管對方帳號） */}
						{editingUserRecordObj?.role === 'admin' && (
							<Form.Item noStyle shouldUpdate={(prevValues, nextValues) => prevValues.role !== nextValues.role}>
								{({ getFieldValue }) => getFieldValue('role') !== 'admin' && (
									<Form.Item
										name="operatorPassword"
										label={translate('admin.operator_password', '您的密碼（降級管理員須確認）')}
										extra={translate('admin.operator_password_desc', '被降級的帳號 24 小時內不可被重設密碼。')}
										rules={[{ required: true, message: translate('admin.operator_password_required', '請輸入您自己的密碼') }]}
									>
										<Input.Password autoComplete="current-password" />
									</Form.Item>
								)}
							</Form.Item>
						)}
					</Form>
				</Modal>

				<Modal
					title={
						<Space>
							<KeyOutlined style={{ color: '#faad14' }} />
							{translate('admin.reset_pwd_modal_title', '強制重設密碼')} - {resetPwdTargetUserObj?.username}
						</Space>
					}
					open={isResetPwdModalVisible}
					onOk={handleSaveResetPwd}
					onCancel={() => setIsResetPwdModalVisible(false)}
					confirmLoading={isUserActionSubmitting}
					okText={translate('admin.btn_confirm', '確認')}
					cancelText={translate('admin.btn_cancel', '取消')}
					destroyOnClose
				>
					<Alert 
						message={translate('admin.reset_pwd_alert_backend', '您正在執行管理員權限強制重設密碼。儲存後，原密碼將立即失效、帳號鎖定一併解除，該帳號目前的登入也會失效，需以新密碼重新登入。')} 
						type="warning" 
						showIcon 
						style={{ marginBottom: '16px' }}
					/>

					<Form form={resetPwdFormInstance} layout="vertical" requiredMark="optional">
						<Form.Item
							name="newPassword"
							label={translate('profile.new_password', '新密碼')}
							rules={
								[
									{ required: true, message: translate('profile.require_new_password', '請輸入新密碼') },
									{ min: getPasswordMinLength(), message: translate('profile.password_min_length', '密碼長度至少需要 {{min}} 個字元', { min: getPasswordMinLength() }) },
									{
										pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/, // ★ 2026-10-29：不再限定可用字元（空白、句點等也可當特殊符號）；★ 2026-10-30：後端同一規則
										message: translate('profile.password_complexity', '密碼強度不足：需包含大小寫字母、數字及特殊符號 (如 @$!%*?&#)')
									}
								]
							}
							hasFeedback
						>
							<Input.Password placeholder={translate('profile.ph_new_password', '至少 {{min}} 個字元', { min: getPasswordMinLength() })} size="large" />
						</Form.Item>

						<Form.Item
							name="confirmPassword"
							label={translate('profile.confirm_password', '確認新密碼')}
							dependencies={['newPassword']}
							hasFeedback
							rules={
								[
									{ required: true, message: translate('profile.require_confirm_password', '請再次輸入新密碼') },
									({ getFieldValue }) => (
										{
											validator(_, inputTargetValueString) 
											{
												if (!inputTargetValueString || getFieldValue('newPassword') === inputTargetValueString) 
												{
													return Promise.resolve();
												}

												return Promise.reject(
													new Error(translate('profile.password_mismatch', '兩次輸入的密碼不一致！'))
												);
											},
										}
									),
								]
							}
						>
							<Input.Password placeholder={translate('profile.ph_confirm_password', '請再次確認新密碼')} size="large" />
						</Form.Item>
					</Form>
				</Modal>

			</div>
		);
	}

	return (
		<div style={{ padding: '0 24px' }}>
			<BasicPreferences currentUserRole={currentUserRoleName} />
		</div>
	);
}