/**
 * ============================================================================
 * 檔案名稱 (File): App.tsx
 * 模組功能 (Description): 前端應用程式入口主組件 (提供 React Router 路由防護、RBAC 權限導向、Ant Design 全域主題與多國語系 Provider 配置)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useSearchParams, Outlet } from 'react-router-dom';
import { 
	ConfigProvider, theme, Layout, Menu, Avatar, Badge, 
	App as AntdApp, Dropdown, Tag 
} from 'antd'; 
import { useTranslation } from 'react-i18next';

import zhTW from 'antd/locale/zh_TW';
import enUS from 'antd/locale/en_US';
import type { MenuProps } from 'antd';
import { 
	SafetyCertificateOutlined, 
	FileTextOutlined, 
	SettingOutlined, 
	PieChartOutlined, 
	DownloadOutlined,
	UserOutlined,
	BellOutlined,
	LogoutOutlined,
	AuditOutlined,
	DashboardOutlined
} from '@ant-design/icons';

import { useAuthStore, type UserRole } from './store/useAuthStore';
import { useUIStore } from './store/useUIStore';
import { useWorkspaceStore } from './store/useWorkspaceStore';

import Login from './features/login/Login';
import ForgotPassword from './features/login/ForgotPassword';
import RequestAccess from './features/login/RequestAccess';
import ProfileSettings from './features/settings/ProfileSettings';
import SystemPreferences from './features/settings/SystemPreferences';
import AuditLogHub from './features/audit_logs/AuditLogHub';
import AdminDashboard from './features/admin/AdminDashboard';
import MainLayout from './features/workspace/MainLayout';
import { validateProgression } from './features/workspace/validateProgression';
import { useIdleTimeout } from './features/settings/useIdleTimeout';

const { Header, Content, Sider } = Layout;

/**
 * 預設系統常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const DEFAULT_SESSION_TIMEOUT_MINUTES = 1800;
const MIN_STEP_INDEX = 0;
const MAX_STEP_INDEX = 3;

/**
 * 身份驗證路由防護組件屬性介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
interface RequireAuthProps 
{
	children: React.ReactNode; // 子層被保護之 UI 節點
}

/**
 * 函數名稱: RequireAuth
 * 函數功能: 檢查當前使用者是否具備登入 Session，未認證者自動重導向至 /login 登入頁。
 * 
 * 輸入參數 (Input):
 *   - routeProps (RequireAuthProps): 包含子節點之屬性物件
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 通過驗證時渲染子組件，否則回傳 Navigate 重導向
 * 呼叫關係 (Call Relations): 包裹受保護之外層路由 / 節點
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
const RequireAuth = ({ children: childComponentsNode }: RequireAuthProps): React.ReactElement => 
{
	const isUserAuthenticatedStatus = useAuthStore(
		(state) => state.isAuthenticated
	);

	if (!isUserAuthenticatedStatus) 
	{
		return <Navigate to="/login" replace />;
	}

	return <>{childComponentsNode}</>;
};

/**
 * 基於角色的存取控制 (RBAC) 路由防護組件屬性介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
interface RBACGuardProps 
{
	allowedRoles: UserRole[]; // 允許存取之角色清單
	redirectPath: string;     // 無權限時重導向之目標路徑
}

/**
 * 函數名稱: RBACGuard
 * 函數功能: 依據當前使用者角色比對頁面允許角色，權限不足時彈出警告並導回專屬工作區。
 * 
 * 輸入參數 (Input):
 *   - routeProps (RBACGuardProps): 包含 allowedRoles 與 redirectPath 之屬性物件
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 通過驗證時渲染 Outlet，否則回傳 Navigate 重導向
 * 呼叫關係 (Call Relations): 包裹需要限制角色的子路由
 * 
 * 規範對照: 符合規範 b) 函數開頭註記
 */
const RBACGuard = ({ allowedRoles, redirectPath }: RBACGuardProps): React.ReactElement => 
{
	const currentUserSessionData = useAuthStore(
		(state) => state.user
	);

	const { message: globalMessageApi } = AntdApp.useApp();

	const { t: translate } = useTranslation();

	const currentRoleNameString = currentUserSessionData?.role || 'data_owner';

	useEffect(
		() => 
		{
			if (!allowedRoles.includes(currentRoleNameString)) 
			{
				globalMessageApi.error(
					translate('message.role_blocked', '權限不足：您目前的角色無法存取該頁面，已將您導回專屬工作區。')
				);
			}
		}, 
		[currentRoleNameString, allowedRoles, globalMessageApi, translate]
	);

	if (!allowedRoles.includes(currentRoleNameString)) 
	{
		return <Navigate to={redirectPath} replace />;
	}

	return <Outlet />; 
};

/**
 * 函數名稱: RoleBasedRedirect
 * 函數功能: 依據使用者登入角色執行根路徑 / 自動重導向 (Admin 進入 /admin，Data Owner 進入 /workspace)。
 * 
 * 輸入參數 (Input): 無
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: Navigate 重導向元件
 * 呼叫關係 (Call Relations): 於 index 路由 '/' 載入
 * 
 * 規範對照: 符合規範 b) 函數開頭註記
 */
const RoleBasedRedirect = (): React.ReactElement => 
{
	const currentUserSessionData = useAuthStore(
		(state) => state.user
	);

	return currentUserSessionData?.role === 'admin' 
		? <Navigate to="/admin" replace /> 
		: <Navigate to="/workspace?step=1" replace />; 
};

/**
 * 內部主應用程式 Layout 包裹組件屬性介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
interface InnerAppProps 
{
	isDarkMode: boolean; // 是否為深色模式
}

/**
 * 函數名稱: InnerApp
 * 函數功能: 渲染應用程式整體 Shell 版面，包含側邊欄導覽選單、頂部 Header、通知中心、全域角色切換、閒置逾時監聽與密碼過期強制提示。
 * 
 * 輸入參數 (Input):
 *   - props (InnerAppProps): 包含深色模式狀態之屬性物件
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 應用程式 Shell UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 於 App 組件內受認證保護後載入
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
function InnerApp({ isDarkMode }: InnerAppProps): React.ReactElement 
{
	const { t: translate } = useTranslation(); 

	const executeNavigationAction = useNavigate();

	const currentLocationData = useLocation();

	const { message: globalMessageApi, modal: globalModalApi } = AntdApp.useApp();

	// 從專屬 Stores 訂閱狀態與 Action (符合規範 g, i)
	const currentUserSessionData = useAuthStore(
		(state) => state.user
	);

	const executeSetUserRoleAction = useAuthStore(
		(state) => state.setUserRole
	);

	const executeLogoutAction = useAuthStore(
		(state) => state.logout
	);
	
	// 由 useWorkspaceStore 讀取系統安全與維護模式參數
	const sessionTimeoutMinutesValue = useWorkspaceStore(
		(state) => (state as unknown as Record<string, unknown>).sessionTimeout as number
	) || DEFAULT_SESSION_TIMEOUT_MINUTES;

	const isMaintenanceModeActiveStatus = useWorkspaceStore(
		(state) => (state as unknown as Record<string, unknown>).isMaintenanceMode as boolean
	) || false;

	const isPasswordExpiredActiveStatus = useWorkspaceStore(
		(state) => (state as unknown as Record<string, unknown>).isPasswordExpired as boolean
	) || false;

	const currentWorkspaceStepIndexValue = useWorkspaceStore(
		(state) => state.currentStep
	);

	const currentPrivacyModeTypeStr = useWorkspaceStore(
		(state) => state.privacyMode
	);

	const executeClearFileDataAction = useWorkspaceStore(
		(state) => state.clearFileData
	);

	// 啟用連線閒置自動登出 Custom Hook
	useIdleTimeout(sessionTimeoutMinutesValue);

	const [searchParamsObject] = useSearchParams();

	const stepQueryParameterString = searchParamsObject.get('step');

	// 密碼過期 Modal 防止重複彈出快照 Ref (符合規範 g)
	const hasShownPasswordExpireModalRef = useRef<boolean>(false);

	const currentUserRoleNameString = currentUserSessionData?.role || 'data_owner';

	// 密碼過期強制變更檢測邏輯 (符合規範 g)
	useEffect(
		() => 
		{
			if (isPasswordExpiredActiveStatus && currentLocationData.pathname !== '/settings/profile') 
			{
				if (!hasShownPasswordExpireModalRef.current) 
				{
					hasShownPasswordExpireModalRef.current = true;
					
					globalModalApi.warning({
						title: translate('profile.password_expired_title', '密碼已過期強制變更'),
						content: translate('profile.password_expired_desc', '基於系統安全性政策，您的密碼已過期（或為首次登入）。在變更密碼前，您無法進行其他操作。'),
						okText: translate('modal.confirm', '立即變更'),
						keyboard: false,
						onOk: () => 
						{
							executeNavigationAction('/settings/profile', { replace: true });

							hasShownPasswordExpireModalRef.current = false;
						}
					});
				}
			}
		}, 
		[isPasswordExpiredActiveStatus, currentLocationData.pathname, executeNavigationAction, globalModalApi, translate]
	);

	// 系統維護模式處置邏輯 (符合規範 g)
	useEffect(
		() => 
		{
			if (isMaintenanceModeActiveStatus && currentUserRoleNameString === 'data_owner') 
			{
				globalModalApi.warning({
					title: translate('admin.maintenance_active_title', '系統維護中'),
					content: translate('admin.maintenance_active_desc', '系統已進入維護模式，僅允許管理員存取。您即將被強制登出。'),
					okText: translate('modal.confirm', '確認'),
					onOk: () => 
					{
						executeLogoutAction();

						executeNavigationAction('/login');
					}
				});
			}
		}, 
		[isMaintenanceModeActiveStatus, currentUserRoleNameString, executeLogoutAction, globalModalApi, executeNavigationAction, translate]
	);

	// URL 步驟參數 ?step= 同步與門閥驗證防呆 (符合規範 g)
	useEffect(
		() => 
		{
			if (currentLocationData.pathname === '/workspace') 
			{
				if (stepQueryParameterString !== null) 
				{
					const parsedUrlTargetStepIndexValue = Number(stepQueryParameterString) - 1; 

					const currentWorkspaceStoreStateSnapshot = useWorkspaceStore.getState();

					const storeCurrentStepIndexValue = currentWorkspaceStoreStateSnapshot.currentStep;

					if (parsedUrlTargetStepIndexValue >= MIN_STEP_INDEX && parsedUrlTargetStepIndexValue <= MAX_STEP_INDEX && parsedUrlTargetStepIndexValue !== storeCurrentStepIndexValue) 
					{
						if (parsedUrlTargetStepIndexValue > storeCurrentStepIndexValue) 
						{
							const validationErrorMessageString = validateProgression(parsedUrlTargetStepIndexValue, storeCurrentStepIndexValue, currentWorkspaceStoreStateSnapshot, translate);

							if (validationErrorMessageString) 
							{
								globalMessageApi.error(validationErrorMessageString); 

								executeNavigationAction(`/workspace?step=${storeCurrentStepIndexValue + 1}`, { replace: true }); 

								return;
							}
						}

						useWorkspaceStore.setState({ currentStep: parsedUrlTargetStepIndexValue });
					} 
					else if (parsedUrlTargetStepIndexValue < MIN_STEP_INDEX || parsedUrlTargetStepIndexValue > MAX_STEP_INDEX) 
					{
						executeNavigationAction(`/workspace?step=${storeCurrentStepIndexValue + 1}`, { replace: true });
					}
				} 
				else 
				{
					executeNavigationAction(`/workspace?step=${useWorkspaceStore.getState().currentStep + 1}`, { replace: true });
				}
			}
		}, 
		[stepQueryParameterString, currentLocationData.pathname, executeNavigationAction, globalMessageApi, translate]
	);

	// 側邊欄展開/收合狀態 (符合規範 g)
	const [isSidebarCollapsedStatus, setIsSidebarCollapsedStatus] = useState<boolean>(false);

	const [readNotificationIdsListArray, setReadNotificationIdsListArray] = useState<string[]>([]);
	
	// 模擬通知選單資料 (符合規範 g)
	const rawNotificationsListArray = [
		{ id: '1', key: 'notification.update' },
		{ id: '2', key: 'notification.approval' },
		{ id: '3', key: 'notification.import_done' },
	];

	// 計算未讀通知數量 (符合規範 g)
	const unreadNotificationCountValue = rawNotificationsListArray.filter(
		notificationItemRecord => !readNotificationIdsListArray.includes(notificationItemRecord.id)
	).length;

	/**
	 * 函數名稱: handleLogoutConfirm
	 * 函數功能: 彈出登出確認 Modal 視窗，使用者確認後清除 Session 並還原工作區狀態。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於 Header 登出圖示之 onClick 事件
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
	const handleLogoutConfirm = (): void => 
	{
		globalModalApi.confirm({
			title: translate('modal.logout_title', '確認登出'),
			content: translate('modal.logout_content', '您確定要登出系統嗎？'),
			okText: translate('modal.confirm_logout', '確認登出'),
			okType: 'danger',
			cancelText: translate('modal.cancel', '取消'),
			onOk: () => 
			{
				executeLogoutAction();

				if (executeClearFileDataAction) 
				{
					executeClearFileDataAction();
				}

				useWorkspaceStore.setState({ currentStep: MIN_STEP_INDEX, privacyMode: null });

				globalMessageApi.success(
					translate('message.logout_success', '已成功登出')
				);
			}
		});
	};

	// 通知下拉選單項目構成 (符合規範 g, h)
	const notificationDropdownMenuItemsList: MenuProps['items'] = rawNotificationsListArray.length > 0 
		? rawNotificationsListArray.map(
			(notificationItemRecord) => 
			{
				const isNotificationReadStatus = readNotificationIdsListArray.includes(notificationItemRecord.id);

				return {
					key: notificationItemRecord.id,
					label: (
						<div style={{ fontWeight: isNotificationReadStatus ? 'normal' : 'bold', color: isNotificationReadStatus ? '#8c8c8c' : 'inherit', display: 'flex', alignItems: 'center', gap: '8px' }}>
							{!isNotificationReadStatus && <span style={{ color: '#f5222d', fontSize: '12px' }}>●</span>}
							{translate(notificationItemRecord.key)}
						</div>
					),
				};
			}
		)
		: [{ key: 'empty', label: translate('notification.empty', '目前沒有新通知'), disabled: true }];

	if (unreadNotificationCountValue > 0) 
	{
		notificationDropdownMenuItemsList.push({ type: 'divider' });

		notificationDropdownMenuItemsList.push({ key: 'read_all', label: translate('notification.mark_all_read', '標示為已讀'), style: { textAlign: 'center', color: '#3f51b5', fontWeight: 'bold' } });
	}

	// 通知下拉選單點擊處理 (符合規範 g)
	const notificationDropdownMenuConfiguration: MenuProps = {
		items: notificationDropdownMenuItemsList,
		onClick: (menuClickEventObj) => 
		{
			if (menuClickEventObj.key === 'read_all') 
			{
				setReadNotificationIdsListArray(
					rawNotificationsListArray.map(notificationItemRecord => notificationItemRecord.id)
				);

				globalMessageApi.success(
					translate('message.all_read', '已將所有通知標示為已讀')
				);
			} 
			else if (menuClickEventObj.key !== 'empty') 
			{
				if (!readNotificationIdsListArray.includes(menuClickEventObj.key)) 
				{
					setReadNotificationIdsListArray([...readNotificationIdsListArray, menuClickEventObj.key]);

					globalMessageApi.info(
						translate('message.viewed_notification', '已查看通知')
					);
				}
			}
		}
	};

	// 使用者選單與全域角色切換處理 (符合規範 g)
	const userDropdownMenuConfiguration: MenuProps = {
		selectedKeys: [`role_${currentUserRoleNameString}`],
		items: [
			{ key: 'role_data_owner', label: translate('role.data_owner', ' Data Owner (資料擁有者)') },
			{ type: 'divider' },
			{ key: 'profile', label: translate('menu.profile_settings', '個人設定'), icon: <UserOutlined /> },
			{ key: 'preferences', label: translate('menu.system_preferences', '系統偏好'), icon: <SettingOutlined /> },
		],
		onClick: (menuClickEventObj) => 
		{
			if (isPasswordExpiredActiveStatus && menuClickEventObj.key !== 'profile') 
			{
				globalMessageApi.warning(
					translate('profile.must_change_password', '請先完成密碼變更，才能使用系統功能！')
				);

				return;
			}

			if (menuClickEventObj.key.startsWith('role_')) 
			{
				const parsedTargetRoleNameString = menuClickEventObj.key.replace('role_', '') as UserRole;

				if (parsedTargetRoleNameString === 'data_owner' && isMaintenanceModeActiveStatus) 
				{
					globalMessageApi.error(
						translate('admin.maintenance_block_switch', '系統維護模式已開啟，無法切換為 Data Owner。')
					);

					return;
				}

				executeSetUserRoleAction(parsedTargetRoleNameString);

				executeNavigationAction(parsedTargetRoleNameString === 'admin' ? '/admin' : '/workspace?step=1');

				globalMessageApi.info(
					translate('message.role_switched', '已將全域角色切換為：{{role}}', { role: parsedTargetRoleNameString.toUpperCase() })
				);
			} 
			else if (menuClickEventObj.key === 'profile') 
			{
				executeNavigationAction('/settings/profile');
			} 
			else if (menuClickEventObj.key === 'preferences') 
			{
				executeNavigationAction('/settings/preferences');
			}
		}
	};

	/**
	 * 函數名稱: handleSidebarStepChange
	 * 函數功能: 點擊側邊欄選單切換去識別化步驟，執行前置驗證並導向。
	 * 
	 * 輸入參數 (Input):
	 *   - targetSidebarStepIndexValue (number): 目標步驟索引
	 * 返回值 (Return): void
	 */
	const handleSidebarStepChange = (targetSidebarStepIndexValue: number): void => 
	{
		if (isPasswordExpiredActiveStatus) 
		{
			globalMessageApi.warning(
				translate('profile.must_change_password', '請先完成密碼變更，才能使用系統功能！')
			);

			return;
		}

		if (currentLocationData.pathname === '/workspace' && targetSidebarStepIndexValue === currentWorkspaceStepIndexValue) 
		{
			return;
		}

		const currentWorkspaceStoreStateSnapshot = useWorkspaceStore.getState();

		if (targetSidebarStepIndexValue > currentWorkspaceStepIndexValue) 
		{
			const progressionValidationErrorMessageString = validateProgression(targetSidebarStepIndexValue, currentWorkspaceStepIndexValue, currentWorkspaceStoreStateSnapshot, translate);

			if (progressionValidationErrorMessageString) 
			{
				globalMessageApi.warning(progressionValidationErrorMessageString);

				executeNavigationAction(`/workspace?step=${currentWorkspaceStepIndexValue + 1}`, { replace: true });

				return;
			}
		}

		useWorkspaceStore.setState({ currentStep: targetSidebarStepIndexValue });

		executeNavigationAction(`/workspace?step=${targetSidebarStepIndexValue + 1}`);
	};

	// 全域主題動態色彩設定 (符合規範 g)
	const themeDynamicColorsConfiguration = {
		bgLayout: isDarkMode ? '#121214' : '#f0f2f5',
		bgComponent: isDarkMode ? '#1a1a1e' : '#ffffff',
		bgCard: isDarkMode ? '#1e1e2f' : '#ffffff',
		border: isDarkMode ? '#2d2d34' : '#f0f0f0',
		textMain: isDarkMode ? '#ffffff' : '#1f1f1f',
		textMuted: isDarkMode ? '#aaaaaa' : '#8c8c8c',
	};

	// 依據角色定義側邊欄選單清單 (符合規範 g, h)
	const siderMenuConfigurationItemsList: MenuProps['items'] = currentUserRoleNameString === 'data_owner' 
		? [
				{ key: '0', icon: <FileTextOutlined />, label: translate('menu.data_import', '資料匯入'), onClick: () => handleSidebarStepChange(0) },
				{ key: '1', icon: <SettingOutlined />, label: translate('menu.attribute_mapping', '屬性分類'), onClick: () => handleSidebarStepChange(1) },
				{ key: '2', icon: <PieChartOutlined />, label: translate('menu.privacy_settings', '隱私設定'), onClick: () => handleSidebarStepChange(2) },
				{ key: '3', icon: <DownloadOutlined />, label: translate('menu.preview_export', '預覽匯出'), onClick: () => handleSidebarStepChange(3) },
				{ type: 'divider' },
				{ key: 'audit', icon: <AuditOutlined />, label: translate('menu.audit_log', '歷史審計憑證 (Audit Log)'), onClick: () => {
					if (isPasswordExpiredActiveStatus) 
					{
						globalMessageApi.warning(
							translate('profile.must_change_password', '請先完成密碼變更，才能使用系統功能！')
						);

						return;
					}

					executeNavigationAction('/audit');
				}}
			]
		: [
				{ key: 'admin_dashboard', icon: <DashboardOutlined />, label: translate('menu.admin_dashboard', '系統管理大廳'), onClick: () => {
					if (isPasswordExpiredActiveStatus) 
					{
						globalMessageApi.warning(
							translate('profile.must_change_password', '請先完成密碼變更，才能使用系統功能！')
						);

						return;
					}

					executeNavigationAction('/admin');
				}}
			];

	// 計算側邊欄當前選中項 (符合規範 g)
	const calculatedActiveSidebarSelectedKeysList = (() => 
	{
		if (currentLocationData.pathname === '/admin') 
		{
			return ['admin_dashboard'];
		}

		if (currentLocationData.pathname === '/audit') 
		{
			return ['audit'];
		}

		if (currentLocationData.pathname === '/workspace') 
		{
			return [String(currentWorkspaceStepIndexValue)];
		}

		return [];
	})();

	return (
		<>
			<style>{`
				@keyframes slideLeftFadeIn {
					0% { opacity: 0; transform: translateX(40px); }
					100% { opacity: 1; transform: translateX(0); }
				}
				.step-content-animator {
					animation: slideLeftFadeIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
				}
				.v-card-style {
					background: ${themeDynamicColorsConfiguration.bgCard} !important;
					border: ${isDarkMode ? 'none' : `1px solid ${themeDynamicColorsConfiguration.border}`} !important;
					box-shadow: ${isDarkMode ? '0 4px 20px 0 rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.06)'} !important;
				}
				.ant-menu-dark {
					background: transparent !important;
				}
			`}</style>

			<Layout style={{ minHeight: '100vh', background: themeDynamicColorsConfiguration.bgLayout, transition: 'background 0.3s' }}>
				{/* 側邊欄 */}
				<Sider 
					collapsible 
					collapsed={isSidebarCollapsedStatus} 
					onCollapse={(collapsedStatusValue) => setIsSidebarCollapsedStatus(collapsedStatusValue)}
					theme={isDarkMode ? "dark" : "light"}
					style={{ background: themeDynamicColorsConfiguration.bgComponent, borderRight: `1px solid ${themeDynamicColorsConfiguration.border}`, transition: 'background 0.3s' }}
				>
					{/* Logo 標頭區 */}
					<div 
						style={
							{ 
								height: 64, 
								display: 'flex', 
								alignItems: 'center', 
								justifyContent: isSidebarCollapsedStatus ? 'center' : 'flex-start', 
								padding: '0 24px', 
								gap: '12px', 
								marginBottom: '16px',
								cursor: 'pointer',
								transition: 'opacity 0.2s'
							}
						}
						onClick={
							() => 
							{
								if (isPasswordExpiredActiveStatus) 
								{
									globalMessageApi.warning(
										translate('profile.must_change_password', '請先完成密碼變更，才能使用系統功能！')
									);

									return;
								}

								if (currentUserRoleNameString === 'admin') 
								{
									if (currentLocationData.pathname !== '/admin') 
									{
										executeNavigationAction('/admin');
									}

									return;
								}

								if (currentLocationData.pathname === '/workspace' && currentWorkspaceStepIndexValue === MIN_STEP_INDEX) 
								{
									return; 
								}

								if (currentLocationData.pathname === '/workspace' && currentWorkspaceStepIndexValue > MIN_STEP_INDEX) 
								{
									globalModalApi.confirm({
										title: translate('modal.warning_title', '系統提示'),
										content: translate('modal.reset_warning', '切換模式將會遺失當前未儲存的設定進度，確定要返回選擇模式嗎？'),
										okText: translate('modal.confirm', '確定'),
										cancelText: translate('modal.cancel', '取消'),
										onOk: () => 
										{
											useWorkspaceStore.setState({ currentStep: MIN_STEP_INDEX });

											executeNavigationAction('/workspace?step=1');
										}
									});
								} 
								else 
								{
									useWorkspaceStore.setState({ currentStep: MIN_STEP_INDEX });

									executeNavigationAction('/workspace?step=1');
								}
							}
						}
						onMouseEnter={(mouseEnterEventObj) => mouseEnterEventObj.currentTarget.style.opacity = '0.7'}
						onMouseLeave={(mouseLeaveEventObj) => mouseLeaveEventObj.currentTarget.style.opacity = '1'}
						title={currentUserRoleNameString === 'admin' ? translate('menu.admin_dashboard', '系統管理大廳') : translate('header.back_to_select_mode', '回到選擇模式')}
					>
						<SafetyCertificateOutlined style={{ fontSize: '24px', color: '#3f51b5' }} />
						{!isSidebarCollapsedStatus && <span style={{ fontWeight: 'bold', fontSize: '16px', letterSpacing: '1px', color: themeDynamicColorsConfiguration.textMain }}>PRIVACY APP V1.0</span>}
					</div>
					
					<Menu 
						theme={isDarkMode ? "dark" : "light"} 
						selectedKeys={calculatedActiveSidebarSelectedKeysList} 
						mode="inline" 
						style={{ background: 'transparent' }}
						items={siderMenuConfigurationItemsList}
					/>
				</Sider>

				{/* 頂部 Header 與主要內容區 */}
				<Layout style={{ background: 'transparent' }}>
					<Header style={{ background: themeDynamicColorsConfiguration.bgComponent, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${themeDynamicColorsConfiguration.border}`, transition: 'background 0.3s' }}>
						
						{/* 麵包屑導航 */}
						<div style={{ color: themeDynamicColorsConfiguration.textMuted, fontSize: '14px', display: 'flex', alignItems: 'center' }}>
							{translate('header.project_space', '專案空間')} / 
							
							<span 
								style={
									{ 
										color: themeDynamicColorsConfiguration.textMain, 
										fontWeight: 'bold',
										cursor: (currentLocationData.pathname === '/workspace' && currentWorkspaceStepIndexValue === MIN_STEP_INDEX) ? 'default' : 'pointer',
										marginLeft: '4px',
										transition: 'color 0.2s'
									}
								}
								onClick={
									() => 
									{
										if (isPasswordExpiredActiveStatus) 
										{
											globalMessageApi.warning(
												translate('profile.must_change_password', '請先完成密碼變更，才能使用系統功能！')
											);

											return;
										}

										if (currentLocationData.pathname === '/workspace' && currentWorkspaceStepIndexValue === MIN_STEP_INDEX) 
										{
											return; 
										}

										if (currentLocationData.pathname === '/workspace' && currentWorkspaceStepIndexValue > MIN_STEP_INDEX) 
										{
											globalModalApi.confirm({
												title: translate('modal.warning_title', '系統提示'),
												content: translate('modal.reset_warning', '切換模式將會遺失當前未儲存的設定進度，確定要返回選擇模式嗎？'),
												okText: translate('modal.confirm', '確定'),
												cancelText: translate('modal.cancel', '取消'),
												onOk: () => 
												{
													useWorkspaceStore.setState({ currentStep: MIN_STEP_INDEX });

													executeNavigationAction('/workspace?step=1');
												}
											});
										} 
										else 
										{
											useWorkspaceStore.setState({ currentStep: MIN_STEP_INDEX });

											executeNavigationAction('/workspace?step=1');
										}
									}
								}
								onMouseEnter={
									(mouseEnterEventObj) => 
									{
										if (currentLocationData.pathname !== '/workspace' || currentWorkspaceStepIndexValue > MIN_STEP_INDEX) 
										{
											mouseEnterEventObj.currentTarget.style.color = '#3f51b5';
										}
									}
								}
								onMouseLeave={
									(mouseLeaveEventObj) => 
									{
										mouseLeaveEventObj.currentTarget.style.color = themeDynamicColorsConfiguration.textMain;
									}
								}
								title={translate('header.back_to_select_mode', '回到選擇模式')}
							>
								{translate('header.privacy_toolkit', '隱私強化工具包')}
							</span>

							{currentUserRoleNameString === 'data_owner' && currentLocationData.pathname === '/audit' && (
								<span style={{ color: '#3f51b5', fontWeight: 'bold' }}>
									&nbsp;/ {translate('header.audit_log', '歷史審計紀錄與憑證管理')}
								</span>
							)}

							{currentUserRoleNameString === 'data_owner' && currentLocationData.pathname === '/workspace' && (
								<>
									<span style={{ margin: '0 4px' }}>/</span>
									<span style={{ color: '#3f51b5', fontWeight: 'bold' }}>
										{currentWorkspaceStepIndexValue > MIN_STEP_INDEX 
											? (currentPrivacyModeTypeStr === 'k-anonymity' ? translate('header.k_anonymity', 'K-匿名化') : translate('header.differential_privacy', '差分隱私')) 
											: translate('header.select_mode', '選擇模式')}
									</span>
								</>
							)}
						</div>
						
						{/* Header 右側通知與使用者資訊區 */}
						<div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
							<Dropdown menu={notificationDropdownMenuConfiguration} placement="bottomRight" trigger={['click']}>
								<Badge count={unreadNotificationCountValue} dot={unreadNotificationCountValue > 0} offset={[-2, 2]}>
									<BellOutlined style={{ fontSize: '18px', color: themeDynamicColorsConfiguration.textMuted, cursor: 'pointer' }} />
								</Badge>
							</Dropdown>
							
							<Dropdown menu={userDropdownMenuConfiguration} placement="bottomRight" trigger={['click']}>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '4px 8px', borderRadius: '8px' }} className="user-profile-hover">
									<Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: '#3f51b5' }} />
									<span style={{ color: themeDynamicColorsConfiguration.textMain, fontSize: '14px', fontWeight: 500 }}>{currentUserSessionData?.name || 'Admin.Test'}</span>
									<Tag color="purple" style={{ margin: 0, borderRadius: '10px', fontSize: '11px' }}>
										{currentUserRoleNameString.toUpperCase()}
									</Tag>
								</div>
							</Dropdown>

							<LogoutOutlined 
								style={{ fontSize: '18px', color: '#f5222d', cursor: 'pointer' }} 
								title={translate('header.logout', '登出')} 
								onClick={handleLogoutConfirm}
							/>
						</div>
					</Header>

					{/* 視圖主要 Content 區 */}
					<Content style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
						<div style={{ width: '100%', margin: '0 auto', flex: 1 }}>
							<Outlet />
						</div>
					</Content>
				</Layout>
			</Layout>
		</>
	);
}

/**
 * 函數名稱: App
 * 函數功能: 應用程式最外層入口組件，配置全域 ConfigProvider (主題、語系與彈窗 Provider) 並載入頁面路由配置。
 * 
 * 輸入參數 (Input): 無
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 入口根 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 於 index.tsx 渲染入口被調用
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function App(): React.ReactElement 
{
	// 從 UIStore 訂閱主題與語系狀態 (符合規範 g, i)
	const isDarkModeActiveStatus = useUIStore(
		(state) => state.isDarkMode
	);

	const executeSetIsDarkModeAction = useUIStore(
		(state) => state.setIsDarkMode
	);

	const currentLanguageCodeString = useUIStore(
		(state) => state.language
	);
	
	const { i18n: i18nInstanceObj } = useTranslation();

	// 語系變更切換 i18n
	useEffect(
		() => 
		{
			i18nInstanceObj.changeLanguage(currentLanguageCodeString);
		}, 
		[currentLanguageCodeString, i18nInstanceObj]
	);

	// 作業系統偏好主題監聽 (符合規範 g)
	useEffect(
		() => 
		{
			const systemThemeMediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');

			const handleSystemThemeChangeEvent = (mediaQueryListEventObj: MediaQueryListEvent) => executeSetIsDarkModeAction(mediaQueryListEventObj.matches);

			systemThemeMediaQueryList.addEventListener('change', handleSystemThemeChangeEvent);

			return () => systemThemeMediaQueryList.removeEventListener('change', handleSystemThemeChangeEvent);
		}, 
		[executeSetIsDarkModeAction]
	);

	/**
	 * 函數名稱: getAntdLocale
	 * 函數功能: 依據 UIStore 當前語系傳回 Ant Design 之語系套件包 (zhTW / enUS)。
	 * 
	 * 輸入參數 (Input): 無
	 * 返回值 (Return): 
	 *   - Locale: Ant Design 語系物件
	 */
	const getAntdLocale = () => 
	{
		switch (currentLanguageCodeString) 
		{
			case 'en_US': 
				return enUS;

			case 'zh_TW':
			default: 
				return zhTW;
		}
	};

	return (
		<ConfigProvider 
			locale={getAntdLocale()} 
			theme={
				{ 
					algorithm: isDarkModeActiveStatus ? theme.darkAlgorithm : theme.defaultAlgorithm,
					token: {
						colorPrimary: '#3f51b5',
						borderRadius: 12,        
						boxShadow: isDarkModeActiveStatus 
							? '0px 3px 5px -1px rgba(0,0,0,0.2), 0px 6px 10px 0px rgba(0,0,0,0.14), 0px 1px 18px 0px rgba(0,0,0,0.12)'
							: '0px 2px 4px -1px rgba(0,0,0,0.06), 0px 4px 6px -1px rgba(0,0,0,0.1)'
					}
				}
			}
		>
			<AntdApp style={{ background: 'transparent', width: '100%' }}>
				<BrowserRouter>
					<Routes>
						{/* 免登入認證公開路由 */}
						<Route path="/login" element={<Login />} />
						<Route path="/forgot-password" element={<ForgotPassword />} />
						<Route path="/request-access" element={<RequestAccess />} />

						{/* 受登入認證保護之受控路由 */}
						<Route path="/" element={<RequireAuth><InnerApp isDarkMode={isDarkModeActiveStatus} /></RequireAuth>}>
							
							<Route index element={<RoleBasedRedirect />} />
							
							{/* Data Owner 專屬權限路由 */}
							<Route element={<RBACGuard allowedRoles={['data_owner']} redirectPath="/admin" />}>
								<Route path="workspace" element={<MainLayout />} />
								<Route path="audit" element={<AuditLogHub />} />
							</Route>

							{/* Admin 專屬權限路由 */}
							<Route element={<RBACGuard allowedRoles={['admin']} redirectPath="/workspace?step=1" />}>
								<Route path="admin" element={<AdminDashboard />} />
							</Route>

							{/* 通用全員設定路由 */}
							<Route path="settings/profile" element={<ProfileSettings />} />
							<Route path="settings/preferences" element={<SystemPreferences />} />
							
							<Route path="*" element={<Navigate to="/" replace />} />
						</Route>

					</Routes>
				</BrowserRouter>
			</AntdApp>
		</ConfigProvider>
	);
}