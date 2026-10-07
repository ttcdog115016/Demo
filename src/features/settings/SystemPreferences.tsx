/**
 * ============================================================================
 * 檔案名稱 (File): SystemPreferences.tsx
 * 模組功能 (Description): 系統偏好與後台管理控制台組件 (提供深色模式/語系設定、帳號與權限管理、維運日誌檢視與連線安全參數配置)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
	Card, Switch, Select, Segmented, Space, Divider, theme, Typography,
	Tabs, Table, Tag, Button, Form, InputNumber, Alert, Modal, Input, App as AntdApp, Dropdown, Checkbox
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
	PlusOutlined,
	KeyOutlined,
	EditOutlined,
	DeleteOutlined,
	NotificationOutlined,
	UnlockOutlined,
	StopOutlined,
	CheckCircleOutlined,
	ExclamationCircleFilled
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../store/useAuthStore';
import { useSystemLogStore, logSystemEvent, type SystemLogLevel, type SystemLogEntry } from '../../store/useSystemLogStore';
import { useAccountStore, isAccountLocked, type AccountRecord, type AccountRole } from '../../store/useAccountStore';
import { useAnnouncementStore, type AnnouncementItem, type AnnouncementLevel, type AnnouncementAudience } from '../../store/useAnnouncementStore';
import { AnnouncementListItem } from '../../components/AnnouncementListItem';
import { ANNOUNCEMENT_ICON_OPTIONS } from '../../utils/announcementDisplay';
import { useUIStore, type FontSizeLevel } from '../../store/useUIStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

import { scaleFontSize } from '../../utils/fontScale';
const { Text, Title } = Typography;

/**
 * 預設系統安全常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const DEFAULT_SESSION_TIMEOUT_MINUTES = 15;
const DEFAULT_MAX_FAILED_LOGINS_LIMIT = 5;
const DEFAULT_PASSWORD_EXPIRY_DAYS = 90;
const MIN_SESSION_TIMEOUT_MINUTES = 1;
const MAX_SESSION_TIMEOUT_MINUTES = 120;
const MIN_FAILED_LOGINS_LIMIT = 1;
const MAX_FAILED_LOGINS_LIMIT = 10;
const MIN_PASSWORD_EXPIRY_DAYS = 1;
const MAX_PASSWORD_EXPIRY_DAYS = 365;

/**
 * 系統使用者紀錄資料結構
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
// ★ 2026-10-07：帳號改由帳號資料庫 (useAccountStore) 提供，不再是畫面內的假資料
type UserRecord = AccountRecord;

/**
 * 安全與環境參數表單數值介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface EnvSecurityValues 
{
	sessionTimeout: number;        // Session 閒置強制登出時間 (分鐘)
	maxFailedLogins: number;       // 密碼錯誤鎖定次數
	maintenanceMode: boolean;      // 系統維護模式啟用開關
	enablePasswordExpiry: boolean; // 強制密碼過期輪替開關
	passwordExpiryDays: number;    // 密碼有效天數
}

/**
 * 擴充 Workspace Store 中的安全設定介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface ExtendedWorkspaceSecurity 
{
	sessionTimeout?: number;         // 連線閒置逾時分鐘數
	maxFailedLogins?: number;        // 最大失敗登入次數
	isMaintenanceMode?: boolean;     // 維護模式開關
	enablePasswordExpiry?: boolean;  // 密碼輪替開關
	passwordExpiryDays?: number;     // 密碼有效天數
	updateSecuritySettings?: (settingsObj: {
		sessionTimeout: number;
		maxFailedLogins: number;
		isMaintenanceMode: boolean;
		enablePasswordExpiry: boolean;
		passwordExpiryDays: number;
	}) => void;
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
		<div style={{ maxWidth: '600px', margin: currentUserRole === 'admin' ? '0' : '40px auto' }}>
			<Card
				title={
					<Space>
						<SettingOutlined style={{ color: token.colorPrimary }} />
						<span style={{ fontSize: scaleFontSize(16), fontWeight: 600 }}>{translate('preferences.title', '系統偏好設定')}</span>
					</Space>
				}
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

					<Switch checked={isDarkModeActive} onChange={(isChecked) => setIsDarkModeAction(isChecked)} checkedChildren={<MoonOutlined />} unCheckedChildren={<SunOutlined />} style={{ minWidth: '60px' }} />
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
						onChange={(selectedLanguageVal) => setLanguageAction(selectedLanguageVal)}
						style={{ width: 140 }}
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
						onChange={(selectedFontSizeLevelVal) => setFontSizeLevelAction(selectedFontSizeLevelVal as FontSizeLevel)}
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

	const currentUserRoleName = currentUserSession?.role || 'admin';
	const operatorNameString = currentUserSession?.name || 'Admin';

	// ★ 2026-10-07：系統維運日誌改為動態資料（見 useSystemLogStore.ts）
	const systemLogEntriesList = useSystemLogStore((state) => state.logs);
	const clearSystemLogsAction = useSystemLogStore((state) => state.clearLogs);
	const [systemLogLevelFilter, setSystemLogLevelFilter] = useState<'ALL' | SystemLogLevel>('ALL');
	const filteredSystemLogEntriesList = systemLogLevelFilter === 'ALL'
		? systemLogEntriesList
		: systemLogEntriesList.filter(logEntryItem => logEntryItem.level === systemLogLevelFilter);

	// 安全參數狀態與 Action 讀取 (符合規範 g, i)
	const workspaceStoreState = useWorkspaceStore(
		(state) => state as unknown as ExtendedWorkspaceSecurity
	);

	const sessionTimeoutMinutes = workspaceStoreState.sessionTimeout ?? DEFAULT_SESSION_TIMEOUT_MINUTES;

	const maxFailedLoginsCount = workspaceStoreState.maxFailedLogins ?? DEFAULT_MAX_FAILED_LOGINS_LIMIT;

	const isMaintenanceModeActive = workspaceStoreState.isMaintenanceMode ?? false;

	const isPasswordExpiryEnabled = workspaceStoreState.enablePasswordExpiry !== false; 

	const passwordExpiryDaysCount = workspaceStoreState.passwordExpiryDays ?? DEFAULT_PASSWORD_EXPIRY_DAYS;
	
	const updateSecuritySettingsAction = workspaceStoreState.updateSecuritySettings || (
		(updatedSettingsObj) => 
		{
			useWorkspaceStore.setState(
				updatedSettingsObj as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>
			);
		}
	);

	// 表單實例宣告 (符合規範 g)
	const [envSecurityFormInstance] = Form.useForm<EnvSecurityValues>();

	// 當 Store 中的安全參數更新時，同步回填置 envSecurityFormInstance 表單欄位
	useEffect(
		() => 
		{
			envSecurityFormInstance.setFieldsValue({
				sessionTimeout: sessionTimeoutMinutes,
				maxFailedLogins: maxFailedLoginsCount,
				maintenanceMode: isMaintenanceModeActive === true,
				enablePasswordExpiry: isPasswordExpiryEnabled,
				passwordExpiryDays: passwordExpiryDaysCount
			});
		}, 
		[sessionTimeoutMinutes, maxFailedLoginsCount, isMaintenanceModeActive, isPasswordExpiryEnabled, passwordExpiryDaysCount, envSecurityFormInstance]
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
				const nextMaintenanceModeStatus = !!formValuesObj.maintenanceMode;
				if (nextMaintenanceModeStatus !== isMaintenanceModeActive)
				{
					logSystemEvent('WARN', nextMaintenanceModeStatus ? '啟用系統維護模式（Data Owner 將無法使用系統）' : '關閉系統維護模式', operatorNameString);
				}
				logSystemEvent('INFO', `更新安全與環境參數：閒置登出 ${formValuesObj.sessionTimeout} 分鐘、登入失敗上限 ${formValuesObj.maxFailedLogins} 次、密碼過期${formValuesObj.enablePasswordExpiry ? ` ${formValuesObj.passwordExpiryDays} 天` : '停用'}`, operatorNameString);

				updateSecuritySettingsAction({
					sessionTimeout: Number(formValuesObj.sessionTimeout),
					maxFailedLogins: Number(formValuesObj.maxFailedLogins),
					isMaintenanceMode: !!formValuesObj.maintenanceMode,
					enablePasswordExpiry: !!formValuesObj.enablePasswordExpiry,
					passwordExpiryDays: Number(formValuesObj.passwordExpiryDays)
				});

				messageApi.success(
					translate('admin.msg_env_saved', '環境與安全設定已成功儲存')
				);
			}
		);
	};

	// 使用者清單模擬狀態 (符合規範 g)
	const userRecordList = useAccountStore((state) => state.accounts);
	const accountStoreActions = useAccountStore.getState();
	const currentOperatorEmailString = currentUserSession?.email || '';
	// 每 30 秒重算一次，讓「鎖定中」狀態到期後自動恢復顯示
	const [nowTimestampMs, setNowTimestampMs] = useState<number>(() => Date.now());
	useEffect(() => {
		const refreshTimerId = window.setInterval(() => setNowTimestampMs(Date.now()), 30000);
		return () => window.clearInterval(refreshTimerId);
	}, []);

	// Modal 與編輯狀態宣告 (符合規範 g)
	const [isUserModalVisible, setIsUserModalVisible] = useState<boolean>(false);

	const [editingUserRecordObj, setEditingUserRecordObj] = useState<UserRecord | null>(null);

	const [userFormInstance] = Form.useForm();

	const [isResetPwdModalVisible, setIsResetPwdModalVisible] = useState<boolean>(false);

	const [resetPwdTargetUserObj, setResetPwdTargetUserObj] = useState<UserRecord | null>(null);

	const [resetPwdFormInstance] = Form.useForm();

	// ★ 2026-10-07：系統公告（右上角鈴鐺／Data Owner 首頁重要橫幅的資料來源）
	const [announcementFormInstance] = Form.useForm<{ icon: string; title: string; content: string; level: AnnouncementLevel; audience: AnnouncementAudience; shouldRenotify?: boolean }>();
	const [editingAnnouncementItem, setEditingAnnouncementItem] = useState<AnnouncementItem | null>(null); // 非 null 時表單為「修改」模式
	const updateAnnouncementAction = useAnnouncementStore((state) => state.updateAnnouncement);
	const announcementFormDefaultValues = { icon: ANNOUNCEMENT_ICON_OPTIONS[0].value, level: 'normal' as AnnouncementLevel, audience: 'all' as AnnouncementAudience, shouldRenotify: true };
	const announcementsList = useAnnouncementStore((state) => state.announcements);
	const publishAnnouncementAction = useAnnouncementStore((state) => state.publishAnnouncement);
	const removeAnnouncementAction = useAnnouncementStore((state) => state.removeAnnouncement);

	const announcementAudienceLabelDict: Record<AnnouncementAudience, string> = {
		all: translate('admin.announce_audience_all', '所有使用者'),
		data_owner: 'Data Owner',
		admin: 'Admin',
	};

	/**
	 * 函數名稱: handlePublishAnnouncement
	 * 函數功能: 驗證並發布系統公告，寫入系統維運日誌後清空表單。
	 */
	const handlePublishAnnouncement = (): void =>
	{
		announcementFormInstance.validateFields().then((formValuesObj) =>
		{
			if (editingAnnouncementItem)
			{
				updateAnnouncementAction(editingAnnouncementItem.id, {
					icon: formValuesObj.icon,
					title: formValuesObj.title.trim(),
					content: (formValuesObj.content || '').trim(),
					level: formValuesObj.level,
					audience: formValuesObj.audience,
				}, formValuesObj.shouldRenotify !== false);
				logSystemEvent('INFO', `修改系統公告：「${formValuesObj.title.trim()}」${formValuesObj.shouldRenotify !== false ? '（重新通知使用者）' : ''}`, operatorNameString);
				messageApi.success(translate('admin.announce_updated', '公告已更新'));
				handleCancelEditAnnouncement();
				return;
			}

			publishAnnouncementAction({
				icon: formValuesObj.icon,
				title: formValuesObj.title.trim(),
				content: (formValuesObj.content || '').trim(),
				level: formValuesObj.level,
				audience: formValuesObj.audience,
				createdBy: operatorNameString,
			});
			logSystemEvent('INFO', `發布系統公告：「${formValuesObj.title.trim()}」（${formValuesObj.level === 'important' ? '重要' : '一般'}，對象：${announcementAudienceLabelDict[formValuesObj.audience]}）`, operatorNameString);
			messageApi.success(translate('admin.announce_published', '公告已發布'));
			announcementFormInstance.resetFields();
		});
	};

	/**
	 * 函數名稱: handleStartEditAnnouncement / handleCancelEditAnnouncement
	 * 函數功能: 將選定公告載入上方表單進入「修改」模式；取消則清空表單回到「發布」模式。
	 */
	const handleStartEditAnnouncement = (targetAnnouncementItem: AnnouncementItem): void =>
	{
		setEditingAnnouncementItem(targetAnnouncementItem);
		announcementFormInstance.setFieldsValue({
			icon: targetAnnouncementItem.icon || (targetAnnouncementItem.level === 'important' ? '⚠️' : '📢'),
			title: targetAnnouncementItem.title,
			content: targetAnnouncementItem.content,
			level: targetAnnouncementItem.level,
			audience: targetAnnouncementItem.audience,
			shouldRenotify: true,
		});
	};

	const handleCancelEditAnnouncement = (): void =>
	{
		setEditingAnnouncementItem(null);
		announcementFormInstance.resetFields();
	};

	/**
	 * 函數名稱: showRemoveAnnouncementConfirm
	 * 函數功能: 二次確認後撤下公告。
	 */
	const showRemoveAnnouncementConfirm = (targetAnnouncementItem: AnnouncementItem): void =>
	{
		modalApi.confirm({
			title: translate('admin.announce_remove_title', '撤下公告'),
			icon: <ExclamationCircleFilled />,
			content: translate('admin.announce_remove_desc', '撤下後，所有使用者的通知與首頁橫幅都不會再顯示此公告。'),
			okText: translate('admin.btn_confirm', '確認'),
			okType: 'danger',
			cancelText: translate('admin.btn_cancel', '取消'),
			onOk()
			{
				removeAnnouncementAction(targetAnnouncementItem.id);
				logSystemEvent('INFO', `撤下系統公告：「${targetAnnouncementItem.title}」`, operatorNameString);
			},
		});
	};

	const announcementTableColumnsConfig = [
		{
			title: translate('admin.announce_column', '公告'), key: 'announcement',
			render: (_: unknown, announcementItem: AnnouncementItem) => <AnnouncementListItem item={announcementItem} />
		},
		{
			title: translate('admin.announce_level', '重要程度'), dataIndex: 'level', key: 'level', width: '100px', align: 'center' as const,
			render: (levelValue: AnnouncementLevel) => levelValue === 'important'
				? <Tag color="orange" style={{ margin: 0 }}>{translate('admin.announce_level_important', '重要')}</Tag>
				: <Tag style={{ margin: 0 }}>{translate('admin.announce_level_normal', '一般')}</Tag>
		},
		{ title: translate('admin.announce_audience', '對象'), dataIndex: 'audience', key: 'audience', width: '120px', render: (audienceValue: AnnouncementAudience) => announcementAudienceLabelDict[audienceValue] },
		{ title: translate('admin.announce_by', '發布者'), dataIndex: 'createdBy', key: 'createdBy', width: '130px' },
		{
			title: translate('admin.col_action', '操作'), key: 'action', width: '100px', align: 'center' as const,
			render: (_: unknown, announcementItem: AnnouncementItem) => (
				<Space size={0}>
					<Button type="text" icon={<EditOutlined />} title={translate('admin.announce_edit', '修改公告')} aria-label={translate('admin.announce_edit', '修改公告')} onClick={() => handleStartEditAnnouncement(announcementItem)} />
					<Button type="text" danger icon={<DeleteOutlined />} title={translate('admin.announce_remove_title', '撤下公告')} aria-label={translate('admin.announce_remove_title', '撤下公告')} onClick={() => showRemoveAnnouncementConfirm(announcementItem)} />
				</Space>
			)
		},
	];

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
	 * 函數功能: 開啟編輯使用者 Modal 彈窗，並回填選定使用者之紀錄資料。
	 * 
	 * 輸入參數 (Input):
	 *   - targetUserRecordObj (UserRecord): 被選取欲編輯之使用者紀錄物件
	 * 返回值 (Return): void
	 */
	const handleEditUser = (targetUserRecordObj: UserRecord): void => 
	{
		setEditingUserRecordObj(targetUserRecordObj);

		userFormInstance.setFieldsValue({ name: targetUserRecordObj.name, email: targetUserRecordObj.email, role: targetUserRecordObj.role });

		setIsUserModalVisible(true);
	};

	/**
	 * 函數名稱: handleDeleteUser
	 * 函數功能: 依據 ID 刪除使用者清單中對應之帳號紀錄。
	 * 
	 * 輸入參數 (Input):
	 *   - targetUserIdStr (string): 使用者 ID
	 * 返回值 (Return): void
	 */
	const handleDeleteUser = (targetUserIdStr: string): void => 
	{
		const deletedUserRecordObj = userRecordList.find(userRecordItem => userRecordItem.id === targetUserIdStr);
		if (deletedUserRecordObj && deletedUserRecordObj.email === currentOperatorEmailString)
		{
			messageApi.error(translate('admin.msg_cannot_delete_self', '不能刪除自己目前登入的帳號'));
			return;
		}
		logSystemEvent('WARN', `刪除帳號：${deletedUserRecordObj?.name ?? targetUserIdStr}`, operatorNameString);

		accountStoreActions.deleteAccount(targetUserIdStr);

		messageApi.success(
			translate('admin.msg_user_deleted', '使用者已成功刪除')
		);
	};

	/**
	 * 函數名稱: showDeleteConfirm
	 * 函數功能: 彈出二次確認 Modal，防止管理員誤觸刪除使用者帳號。
	 * 
	 * 輸入參數 (Input):
	 *   - targetUserIdStr (string): 欲刪除之使用者 ID
	 * 返回值 (Return): void
	 */
	const showDeleteConfirm = (targetUserIdStr: string): void => 
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
				handleDeleteUser(targetUserIdStr);
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
			(userFormValuesObj: { name: string; email: string; role: AccountRole; initialPassword?: string }) => 
			{
				if (editingUserRecordObj) 
				{
					const updateResult = accountStoreActions.updateAccount(editingUserRecordObj.id, { name: userFormValuesObj.name, email: userFormValuesObj.email, role: userFormValuesObj.role });
					if (!updateResult.ok)
					{
						userFormInstance.setFields([{ name: 'email', errors: [translate('admin.email_duplicate', '此 Email 已被其他帳號使用')] }]);
						return;
					}

					logSystemEvent('INFO', `編輯帳號資料：${editingUserRecordObj.name}`, operatorNameString);

					messageApi.success(
						translate('admin.msg_user_updated', '使用者資料已更新')
					);
				} 
				else 
				{
					const addResult = accountStoreActions.addAccount({
						name: userFormValuesObj.name,
						email: userFormValuesObj.email,
						role: userFormValuesObj.role,
						password: userFormValuesObj.initialPassword || '',
					});
					if (!addResult.ok)
					{
						userFormInstance.setFields([{ name: 'email', errors: [translate('admin.email_duplicate', '此 Email 已被其他帳號使用')] }]);
						return;
					}

					logSystemEvent('INFO', `新增帳號：${userFormValuesObj.name}（${userFormValuesObj.email}）`, operatorNameString);

					messageApi.success(
						translate('admin.msg_user_added_with_pwd', '已新增使用者。請將初始密碼交給對方，對方首次登入時須變更密碼。')
					);
				}

				setIsUserModalVisible(false);
			}
		);
	};

	/**
	 * 函數名稱: handleToggleStatus
	 * 函數功能: 切換選定使用者之帳號啟用/停用狀態。
	 * 
	 * 輸入參數 (Input):
	 *   - targetUserIdStr (string): 使用者 ID
	 *   - currentStatusValue (string): 當前狀態 ('active' | 'disabled')
	 * 返回值 (Return): void
	 */
	const handleToggleStatus = (targetUserIdStr: string, currentStatusValue: string): void => 
	{
		const newStatusResultString = currentStatusValue === 'active' ? 'disabled' : 'active';
		const toggledUserRecordObj = userRecordList.find(userRecordItem => userRecordItem.id === targetUserIdStr);
		if (newStatusResultString === 'disabled' && toggledUserRecordObj?.email === currentOperatorEmailString)
		{
			messageApi.error(translate('admin.msg_cannot_disable_self', '不能停用自己目前登入的帳號'));
			return;
		}
		logSystemEvent(newStatusResultString === 'disabled' ? 'WARN' : 'INFO', `${newStatusResultString === 'disabled' ? '停用' : '啟用'}帳號：${toggledUserRecordObj?.name ?? targetUserIdStr}`, operatorNameString);

		accountStoreActions.setAccountStatus(targetUserIdStr, newStatusResultString);

		messageApi.success(
			translate('admin.msg_status_updated', '帳號狀態已更新')
		);
	};

	/**
	 * 函數名稱: handleUnlockUser
	 * 函數功能: 提前解除因登入失敗過多而鎖定的帳號。
	 */
	const handleUnlockUser = (targetUserRecordObj: UserRecord): void =>
	{
		accountStoreActions.unlockAccount(targetUserRecordObj.id);
		logSystemEvent('INFO', `解除帳號鎖定：${targetUserRecordObj.name}`, operatorNameString);
		messageApi.success(translate('admin.msg_unlocked', '已解除鎖定'));
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
			() => 
			{
				if (!resetPwdTargetUserObj) return;
				accountStoreActions.resetPassword(resetPwdTargetUserObj.id, String(resetPwdFormInstance.getFieldValue('newPassword') || ''));
				logSystemEvent('WARN', `管理員重設密碼：${resetPwdTargetUserObj.name}（下次登入須變更密碼）`, operatorNameString);

				messageApi.success(
					translate('admin.msg_pwd_reset_success', `已成功重設 ${resetPwdTargetUserObj?.name} 的密碼`)
				);

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
			content: translate('admin.syslog_clear_desc', '確定要清除此瀏覽器中的所有系統維運日誌嗎？此操作無法復原。'),
			okText: translate('admin.btn_confirm', '確認'),
			okType: 'danger',
			cancelText: translate('admin.btn_cancel', '取消'),
			onOk()
			{
				clearSystemLogsAction();
				logSystemEvent('WARN', '系統維運日誌已被清除', operatorNameString);
			},
		});
	};

	// 使用者表格欄位定義 (符合規範 g, h)
	const userTableColumnsConfig = [
		{ title: translate('admin.col_username', '使用者名稱'), dataIndex: 'name', key: 'name', render: (userNameTextString: string) => <Text strong>{userNameTextString}</Text> },
		{ title: 'Email', dataIndex: 'email', key: 'email' },
		{ 
			title: translate('admin.col_role', '系統角色'), 
			dataIndex: 'role', 
			key: 'role',
			render: (roleNameString: string) => (
				<Tag color={roleNameString === 'admin' ? 'purple' : 'blue'}>
					{roleNameString === 'admin' ? 'Admin' : 'Data Owner'}
				</Tag>
			)
		},
		{ 
			title: translate('admin.col_status', '帳號狀態'), 
			dataIndex: 'status', 
			key: 'status',
			render: (statusNameString: string, userRecordItem: UserRecord) => (
				<Space size={4} wrap>
					{isAccountLocked(userRecordItem, nowTimestampMs)
						? <Tag color="warning" style={{ margin: 0 }}>{translate('admin.status_locked', 'LOCKED')}</Tag>
						: <Tag color={statusNameString === 'active' ? 'success' : 'error'} style={{ margin: 0 }}>{statusNameString.toUpperCase()}</Tag>}
					{userRecordItem.mustChangePassword && (
						<Tag color="processing" style={{ margin: 0 }}>{translate('admin.status_must_change_pwd', '待變更密碼')}</Tag>
					)}
				</Space>
			)
		},
		{
			title: translate('admin.col_last_login', '最後登入時間'), dataIndex: 'lastLoginAt', key: 'lastLoginAt',
			render: (lastLoginAtMsValue: number | null) => lastLoginAtMsValue ? formatSystemLogTimestamp(lastLoginAtMsValue) : <Text type="secondary">{translate('admin.never_logged_in', '尚未登入')}</Text>
		},
		{ 
			title: translate('admin.col_action', '操作'), 
			key: 'action',
			width: '100px', 
			align: 'center' as const,
			render: (_: unknown, userRecordItem: UserRecord) => 
			{
				// ★ 調整：原本「編輯權限」連結與右側「⋮」選單分開，現整合為單一「管理」下拉選單
				const isUserActiveStatus = userRecordItem.status === 'active';
				const menuDropdownItemsConfig: MenuProps['items'] = [
					{
						key: 'edit',
						icon: <EditOutlined />,
						label: translate('admin.action_edit_profile', '編輯帳號資料'),
						onClick: () => handleEditUser(userRecordItem)
					},
					{
						key: 'reset_pwd',
						icon: <KeyOutlined />,
						label: translate('admin.action_reset_pwd', '重設密碼'),
						onClick: () => handleOpenResetPwd(userRecordItem)
					},
					...(isAccountLocked(userRecordItem, nowTimestampMs) ? [{
						key: 'unlock',
						icon: <UnlockOutlined />,
						label: translate('admin.action_unlock', '解除鎖定'),
						onClick: () => handleUnlockUser(userRecordItem)
					}] : []),
					{
						key: 'toggle_status',
						icon: isUserActiveStatus ? <StopOutlined /> : <CheckCircleOutlined />,
						label: isUserActiveStatus ? translate('admin.action_disable', '停用帳號') : translate('admin.action_enable', '啟用帳號'),
						onClick: () => handleToggleStatus(userRecordItem.id, userRecordItem.status)
					},
					{ type: 'divider' },
					{
						key: 'delete',
						icon: <DeleteOutlined />,
						label: translate('admin.action_delete', '刪除帳號'),
						danger: true,
						onClick: () => showDeleteConfirm(userRecordItem.id)
					}
				];

				return (
					<Dropdown menu={{ items: menuDropdownItemsConfig }} trigger={['click']} placement="bottomRight" rootClassName="user-manage-dropdown">
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
		{ title: translate('admin.col_time', '時間'), dataIndex: 'timestamp', key: 'timestamp', width: '180px', render: (timestampMsValue: number) => formatSystemLogTimestamp(timestampMsValue) },
		{ 
			title: translate('admin.col_level', '層級'), 
			dataIndex: 'level', 
			key: 'level',
			width: '100px',
			render: (levelNameString: string) => 
			{
				const levelTagColor = levelNameString === 'ERROR' ? 'red' : levelNameString === 'WARN' ? 'orange' : 'green';

				return <Tag color={levelTagColor}>{levelNameString}</Tag>;
			}
		},
		{ title: translate('admin.col_event', '系統事件'), dataIndex: 'event', key: 'event' },
		{ title: translate('admin.col_source', '來源'), dataIndex: 'source', key: 'source', width: '260px', ellipsis: true },
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
								<Text type="secondary">{translate('admin.user_list_desc', '負責開通 Data Owner 帳號與設定密碼，不包含任何資料授權。')}</Text>
							</div>

							<Button type="primary" icon={<PlusOutlined />} onClick={handleAddUser}>
								{translate('admin.add_user', '新增使用者')}
							</Button>
						</div>

						<Table columns={userTableColumnsConfig} dataSource={userRecordList.filter(userRecordItem => userRecordItem.role === 'data_owner')} rowKey="id" pagination={{ pageSize: 5 }} size="middle" />
					</div>
				),
			},
			{
				key: 'syslogs',
				label: <span><CodeOutlined /> {translate('admin.tab_syslogs', '系統維運日誌')}</span>,
				children: (
					<div>
						<Alert 
							message={translate('admin.syslog_title', '系統維運日誌 (System Logs)')}
							description={translate('admin.syslog_desc', '此處僅記錄伺服器連線、登入失敗、系統錯誤等基礎設施事件。若需調閱資料去識別化的合規操作紀錄，請聯絡 Data Owner 於前台匯出 Audit Log。')}
							type="info" 
							showIcon 
							style={{ marginBottom: '16px' }}
						/>

						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
							<Segmented
								value={systemLogLevelFilter}
								onChange={(selectedLevelValue) => setSystemLogLevelFilter(selectedLevelValue as 'ALL' | SystemLogLevel)}
								options={[
									{ value: 'ALL', label: `${translate('admin.syslog_filter_all', '全部')} (${systemLogEntriesList.length})` },
									{ value: 'INFO', label: `INFO (${systemLogEntriesList.filter(logEntryItem => logEntryItem.level === 'INFO').length})` },
									{ value: 'WARN', label: `WARN (${systemLogEntriesList.filter(logEntryItem => logEntryItem.level === 'WARN').length})` },
									{ value: 'ERROR', label: `ERROR (${systemLogEntriesList.filter(logEntryItem => logEntryItem.level === 'ERROR').length})` },
								]}
							/>
							<Button danger icon={<DeleteOutlined />} onClick={showClearSystemLogsConfirm} disabled={systemLogEntriesList.length === 0}>
								{translate('admin.syslog_clear', '清除日誌')}
							</Button>
						</div>

						<Table<SystemLogEntry> columns={logTableColumnsConfig} dataSource={filteredSystemLogEntriesList} rowKey="id" pagination={{ pageSize: 10 }} size="small" />
					</div>
				),
			},
			{
				key: 'announcements',
				label: <span><NotificationOutlined /> {translate('admin.tab_announcements', '系統公告')}</span>,
				children: (
					<div>
						<Alert
							message={translate('admin.announce_hint_desc', '公告會出現在對象使用者右上角的鈴鐺通知中；標為「重要」的公告，另外以可關閉的橫幅顯示在 Data Owner 首頁（適合維護時段預告、會影響結果判讀的改版說明）。目前公告保存在此瀏覽器中（Demo 版）。')}
							type="info"
							showIcon
							style={{ marginBottom: '16px' }}
						/>

						<Card
							type="inner"
							style={{ marginBottom: '16px', ...(editingAnnouncementItem ? { borderColor: '#3f51b5' } : {}) }}
							title={editingAnnouncementItem
								? <span><EditOutlined /> {translate('admin.announce_editing', '修改公告')}：{editingAnnouncementItem.title}</span>
								: <span><NotificationOutlined /> {translate('admin.announce_hint_title', '發布系統公告')}</span>}
						>
							<Form form={announcementFormInstance} layout="vertical" initialValues={announcementFormDefaultValues}>
								<Form.Item name="icon" label={translate('admin.announce_icon', '圖示')}>
									<Segmented options={ANNOUNCEMENT_ICON_OPTIONS.map(iconOption => ({
										value: iconOption.value,
										label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 4px' }}><span style={{ fontSize: '18px' }}>{iconOption.value}</span>{translate(iconOption.labelKey, iconOption.fallback)}</span>,
									}))} />
								</Form.Item>
								<Form.Item name="title" label={translate('admin.announce_title', '標題')} rules={[{ required: true, whitespace: true, message: translate('admin.announce_title_required', '請輸入公告標題') }]}>
									<Input maxLength={60} showCount placeholder={translate('admin.announce_title_placeholder', '例：10/10（五）18:00–20:00 系統維護')} />
								</Form.Item>
								<Form.Item name="content" label={translate('admin.announce_content', '內容')}>
									<Input.TextArea rows={3} maxLength={500} showCount placeholder={translate('admin.announce_content_placeholder', '說明影響範圍、需要使用者配合的事項等')} />
								</Form.Item>
								<Space size="large" wrap align="end">
									<Form.Item name="level" label={translate('admin.announce_level', '重要程度')} style={{ marginBottom: 0 }}>
										<Segmented options={[
											{ value: 'normal', label: translate('admin.announce_level_normal', '一般') },
											{ value: 'important', label: translate('admin.announce_level_important', '重要') },
										]} />
									</Form.Item>
									<Form.Item name="audience" label={translate('admin.announce_audience', '對象')} style={{ marginBottom: 0 }}>
										<Select style={{ width: '160px' }} options={(Object.keys(announcementAudienceLabelDict) as AnnouncementAudience[]).map(audienceKey => ({ value: audienceKey, label: announcementAudienceLabelDict[audienceKey] }))} />
									</Form.Item>
									{editingAnnouncementItem && (
										<Form.Item name="shouldRenotify" valuePropName="checked" style={{ marginBottom: 0 }}>
											<Checkbox>{translate('admin.announce_renotify', '重新通知使用者（改回未讀；首頁橫幅重新顯示）')}</Checkbox>
										</Form.Item>
									)}
									<Space>
										{editingAnnouncementItem && (
											<Button onClick={handleCancelEditAnnouncement}>{translate('admin.btn_cancel', '取消')}</Button>
										)}
										<Button type="primary" icon={editingAnnouncementItem ? <EditOutlined /> : <NotificationOutlined />} onClick={handlePublishAnnouncement}>
											{editingAnnouncementItem ? translate('admin.announce_save_edit', '儲存修改') : translate('admin.announce_publish', '發布公告')}
										</Button>
									</Space>
								</Space>
							</Form>
						</Card>

						<Table<AnnouncementItem> columns={announcementTableColumnsConfig} dataSource={announcementsList} rowKey="id" pagination={{ pageSize: 5 }} size="small" />
					</div>
				),
			},
			{
				key: 'security',
				label: <span><SafetyCertificateOutlined /> {translate('admin.tab_security', '安全與環境參數')}</span>,
				children: (
					<div style={{ maxWidth: '600px' }}>
						<Form form={envSecurityFormInstance} layout="vertical">
							<Card type="inner" title={translate('admin.conn_security', '連線安全設定')} style={{ marginBottom: '16px' }}>
								<Form.Item name="sessionTimeout" label={translate('admin.session_timeout', 'Session 閒置強制登出時間 (分鐘)')} extra={translate('admin.session_timeout_desc', '設定使用者在無操作狀態下多久後會被系統自動登出。')}>
									<InputNumber min={MIN_SESSION_TIMEOUT_MINUTES} max={MAX_SESSION_TIMEOUT_MINUTES} style={{ width: '100px' }} />
								</Form.Item>

								<Form.Item name="maxFailedLogins" label={translate('admin.max_login_attempts', '密碼錯誤鎖定次數')} extra={translate('admin.max_login_desc', '連續登入失敗達此次數後，帳號將被鎖定 15 分鐘。')}>
									<InputNumber min={MIN_FAILED_LOGINS_LIMIT} max={MAX_FAILED_LOGINS_LIMIT} style={{ width: '100px' }} />
								</Form.Item>
							</Card>

							<Card type="inner" title={translate('admin.password_policy_title', '密碼安全政策快速控管')} style={{ marginBottom: '16px' }}>
								<div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
									<Form.Item name="enablePasswordExpiry" valuePropName="checked" style={{ marginBottom: 0 }}>
										<Switch style={{ marginTop: '2px' }} />
									</Form.Item>

									<div>
										<Text strong style={{ display: 'block', marginBottom: '4px' }}>
											{translate('admin.enable_expiry', '強制密碼過期輪替')}
										</Text>

										<Text type="secondary" style={{ fontSize: scaleFontSize(13) }}>
											{translate('admin.enable_expiry_desc', '開啟後，所有帳號必須在設定的週期內變更密碼。')}
										</Text>
									</div>
								</div>
								
								<Form.Item noStyle shouldUpdate={(previousFormValuesObj: EnvSecurityValues, currentFormValuesObj: EnvSecurityValues) => previousFormValuesObj.enablePasswordExpiry !== currentFormValuesObj.enablePasswordExpiry}>
									{
										({ getFieldValue }) => 
										{
											const isPasswordExpiryEnabledStatus = getFieldValue('enablePasswordExpiry');

											return (
												<div style={{ opacity: isPasswordExpiryEnabledStatus ? 1 : 0.4, pointerEvents: isPasswordExpiryEnabledStatus ? 'auto' : 'none', transition: 'all 0.3s' }}>
													<Form.Item name="passwordExpiryDays" label={translate('admin.expiry_days', '密碼有效天數')} extra={translate('admin.expiry_days_desc', '建議企業內部安全規範設定為 90 天。')}>
														<InputNumber min={MIN_PASSWORD_EXPIRY_DAYS} max={MAX_PASSWORD_EXPIRY_DAYS} style={{ width: '120px' }} addonAfter={translate('admin.days', '天')} />
													</Form.Item>
												</div>
											);
										}
									}
								</Form.Item>
							</Card>
							
							<Card type="inner" title={translate('admin.maintenance_mode', '系統維護模式')}>
								<div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
									<Form.Item name="maintenanceMode" valuePropName="checked" style={{ marginBottom: 0 }}>
										<Switch style={{ marginTop: '2px' }} />
									</Form.Item>

									<div>
										<Text strong style={{ display: 'block', marginBottom: '4px' }}>
											{translate('admin.enable_maintenance', '啟用系統維護模式 (Maintenance Mode)')}
										</Text>

										<Text type="secondary" style={{ fontSize: scaleFontSize(13) }}>
											{translate('admin.maintenance_desc', '開啟後，所有 Data Owner 將無法登入系統，僅允許 Admin 進行伺服器維護。')}
										</Text>
									</div>
								</div>
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

	tabListItemsArray.push({
		key: 'preferences',
		label: <span><SettingOutlined /> {translate('preferences.title', 'System Preferences')}</span>,
		children: <BasicPreferences currentUserRole={currentUserRoleName} />
	});

	const handleTabChange = (targetTabKeyIdentifier: string): void => 
	{
		setSearchParamsAction({ tab: targetTabKeyIdentifier });
	};

	if (currentUserRoleName === 'admin') 
	{
		return (
			<div style={{ padding: '0 24px', maxWidth: '1200px', margin: '0 auto' }}>
				<Card 
					title={<span style={{ fontSize: scaleFontSize(18), fontWeight: 'bold' }}>{translate('admin.console_title', '系統偏好與後台管理 (Admin Console)')}</span>} 
					variant="borderless" 
					style={{ minHeight: '600px', borderRadius: '12px', marginTop: '24px' }}
				>
					<Tabs activeKey={activeTabIdentifier} onChange={handleTabChange} items={tabListItemsArray} size="large" />
				</Card>

				<Modal
					title={editingUserRecordObj ? translate('admin.edit_user', '編輯使用者') : translate('admin.add_user_title', '新增使用者')}
					open={isUserModalVisible}
					onOk={handleSaveUser}
					onCancel={() => setIsUserModalVisible(false)}
					okText={translate('admin.btn_save', '儲存')}
					cancelText={translate('admin.btn_cancel', '取消')}
					destroyOnClose
				>
					<Form form={userFormInstance} layout="vertical" style={{ marginTop: '20px' }}>
						<Form.Item 
							name="name" 
							label={translate('admin.col_username', '使用者名稱')} 
							rules={[{ required: true, message: translate('admin.name_required', '請輸入使用者名稱') }]}
						>
							<Input placeholder="e.g. Data.Owner.C" />
						</Form.Item>

						<Form.Item 
							name="email" 
							label="Email" 
							rules={
								[
									{ required: true, message: translate('admin.email_required', '請輸入 Email') },
									{ type: 'email', message: translate('admin.email_required', '請輸入有效的 Email 格式') }
								]
							}
						>
							<Input placeholder="user@company.com" />
						</Form.Item>

						{!editingUserRecordObj && (
							<Form.Item
								name="initialPassword"
								label={translate('admin.initial_password', '初始密碼')}
								extra={translate('admin.initial_password_desc', '請將此密碼交給使用者；對方首次登入後系統會要求變更密碼。')}
								rules={[
									{ required: true, message: translate('profile.require_new_password', '請輸入新密碼') },
									{ min: 12, message: translate('profile.password_min_length', '密碼長度至少需要 12 個字元') },
									{
										pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#\-_+=])[A-Za-z\d@$!%*?&#\-_+=]+$/,
										message: translate('profile.password_complexity', '密碼強度不足：需包含大小寫字母、數字及特殊符號 (如 @$!%*?&#)')
									}
								]}
							>
								<Input.Password placeholder={translate('profile.ph_new_password', '至少 12 個字元')} autoComplete="new-password" />
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
										{ value: 'data_owner', label: translate('admin.role_data_owner', 'Data Owner (資料擁有者)') }
									]
								} 
							/>
						</Form.Item>
					</Form>
				</Modal>

				<Modal
					title={
						<Space>
							<KeyOutlined style={{ color: '#faad14' }} />
							{translate('admin.reset_pwd_modal_title', '強制重設密碼')} - {resetPwdTargetUserObj?.name}
						</Space>
					}
					open={isResetPwdModalVisible}
					onOk={handleSaveResetPwd}
					onCancel={() => setIsResetPwdModalVisible(false)}
					okText={translate('admin.btn_confirm', '確認')}
					cancelText={translate('admin.btn_cancel', '取消')}
					destroyOnClose
				>
					<Alert 
						message={translate('admin.reset_pwd_alert', '您正在執行管理員權限強制重設密碼。儲存後，原密碼將立即失效。')} 
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
									{ min: 12, message: translate('profile.password_min_length', '密碼長度至少需要 12 個字元') },
									{
										pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#\-_+=])[A-Za-z\d@$!%*?&#\-_+=]+$/,
										message: translate('profile.password_complexity', '密碼強度不足：需包含大小寫字母、數字及特殊符號 (如 @$!%*?&#)')
									}
								]
							}
							hasFeedback
						>
							<Input.Password placeholder={translate('profile.ph_new_password', '至少 12 個字元')} size="large" />
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