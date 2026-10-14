/**
 * ============================================================================
 * 檔案名稱 (File): AdminDashboard.tsx
 * 模組功能 (Description): 系統管理大廳頁面組件 (提供基礎設施狀態概覽與密碼安全政策快速控管)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) 說明性檔案與原始檔案開頭註記, 變數函數與程序撰寫參考 a)~h)
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Button, Switch, InputNumber, App as AntdApp, Space, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { 
	DesktopOutlined, 
	WarningOutlined, 
	TeamOutlined, 
	RightOutlined,
	SettingOutlined,
	SafetyOutlined,
	ReloadOutlined,
	LoadingOutlined
} from '@ant-design/icons';

import { useUIStore } from '../../store/useUIStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useAuthStore } from '../../store/useAuthStore';
import { logSystemEvent, useSystemLogStore } from '../../store/useSystemLogStore';
import { useAccountStore } from '../../store/useAccountStore';
import {
	computeApiCallStats, computeFailedLoginStats, computeActiveUserStats, probeBackendHealth, type BackendHealthState,
} from '../../utils/adminDashboardStats';

import { scaleFontSize } from '../../utils/fontScale';
/**
 * 預設系統安全常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const DEFAULT_SESSION_TIMEOUT_MINUTES = 15;
const DEFAULT_MAX_FAILED_LOGINS_LIMIT = 5;
const DEFAULT_PASSWORD_EXPIRY_DAYS = 90;
const MIN_PASSWORD_EXPIRY_DAYS = 1;
const MAX_PASSWORD_EXPIRY_DAYS = 365;

/**
 * 擴充 Workspace Store 中的安全設定介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface ExtendedWorkspaceSecurity 
{
	sessionTimeout?: number;         // 連線閒置逾時分鐘數 (取值範圍: 1 ~ 1440，預設: 15)
	maxFailedLogins?: number;        // 最大允許登入失敗嘗試次數 (取值範圍: 1 ~ 10，預設: 5)
	isMaintenanceMode?: boolean;     // 系統維護模式開關 (預設: false)
	enablePasswordExpiry?: boolean;  // 強制密碼過期輪替開關 (預設: true)
	passwordExpiryDays?: number;     // 密碼有效天數 (取值範圍: 1 ~ 365，預設: 90)
	
	updateSecuritySettings?: (settings: {
		sessionTimeout: number;
		maxFailedLogins: number;
		isMaintenanceMode: boolean;
		enablePasswordExpiry: boolean;
		passwordExpiryDays: number;
	}) => void;
}

/**
 * 函數名稱: AdminDashboard
 * 函數功能: 渲染管理員大廳頁面，呈現伺服器運行指標、異常嘗試統計、線上使用者數，並提供密碼安全政策快速開關與參數設定。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 管理員大廳 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 被 AppRouter 主路由組件載入渲染
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
// 後端連線狀態自動重新檢查間隔、統計數字重算間隔
const BACKEND_HEALTH_RECHECK_INTERVAL_MS = 60 * 1000;
const STATS_REFRESH_INTERVAL_MS = 30 * 1000;

const formatClockTime = (timestampMsValue: number): string =>
{
	const dateObj = new Date(timestampMsValue);
	return [dateObj.getHours(), dateObj.getMinutes(), dateObj.getSeconds()].map(numberValue => String(numberValue).padStart(2, '0')).join(':');
};

export default function AdminDashboard(): React.ReactElement 
{
	const { t: translate } = useTranslation();

	// ★ 2026-10-08：三張狀態卡片改用真實資料（原本 99.99%／3 次／2 / 12 皆為寫死）
	const systemLogEntriesList = useSystemLogStore((state) => state.logs);
	const accountRecordsList = useAccountStore((state) => state.accounts);
	const [statsNowMs, setStatsNowMs] = useState<number>(() => Date.now());
	const [backendHealthState, setBackendHealthState] = useState<BackendHealthState>({ status: 'checking' });

	const runBackendHealthCheck = useCallback(async (): Promise<void> =>
	{
		setBackendHealthState({ status: 'checking' });
		setBackendHealthState(await probeBackendHealth());
	}, []);

	useEffect(() =>
	{
		// 自動檢查不先切回「檢查中」，避免每分鐘閃一下；結果回來再更新
		let isUnmounted = false;
		const probeAndStore = (): void => { void probeBackendHealth().then((healthResult) => { if (!isUnmounted) setBackendHealthState(healthResult); }); };
		probeAndStore();
		const healthTimerId = window.setInterval(probeAndStore, BACKEND_HEALTH_RECHECK_INTERVAL_MS);
		const statsTimerId = window.setInterval(() => setStatsNowMs(Date.now()), STATS_REFRESH_INTERVAL_MS);
		return () => { isUnmounted = true; window.clearInterval(healthTimerId); window.clearInterval(statsTimerId); };
	}, []);

	const apiCallStats = useMemo(() => computeApiCallStats(systemLogEntriesList, statsNowMs), [systemLogEntriesList, statsNowMs]);
	const failedLoginStats = useMemo(() => computeFailedLoginStats(systemLogEntriesList, accountRecordsList, statsNowMs), [systemLogEntriesList, accountRecordsList, statsNowMs]);
	const activeUserStats = useMemo(() => computeActiveUserStats(accountRecordsList, statsNowMs), [accountRecordsList, statsNowMs]);

	const navigate = useNavigate();

	const { message: messageApi } = AntdApp.useApp();
	
	// 訂閱全域 UI 主題狀態
	const isDarkModeActive = useUIStore(
		(state) => state.isDarkMode
	);

	// 從 WorkspaceStore 安全讀取全域安全設定參數，防呆處理未定義狀況 (符合撰寫參考 f)
	const workspaceStoreState = useWorkspaceStore(
		(state) => state as unknown as ExtendedWorkspaceSecurity
	);

	const sessionTimeoutValue = workspaceStoreState.sessionTimeout ?? DEFAULT_SESSION_TIMEOUT_MINUTES;

	const maxFailedLoginsValue = workspaceStoreState.maxFailedLogins ?? DEFAULT_MAX_FAILED_LOGINS_LIMIT;

	const isMaintenanceModeActive = workspaceStoreState.isMaintenanceMode ?? false;

	const isPasswordExpiryEnabled = workspaceStoreState.enablePasswordExpiry !== false;

	const passwordExpiryDaysValue = workspaceStoreState.passwordExpiryDays ?? DEFAULT_PASSWORD_EXPIRY_DAYS;

	const executeUpdateSecuritySettings = workspaceStoreState.updateSecuritySettings || (
		(updatedSettingsObj) => 
		{
			useWorkspaceStore.setState(
				updatedSettingsObj as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>
			);
		}
	);

	// 主題配色常數設定物件
	const themeColorsConfig = {
		bgCard: isDarkModeActive ? '#1e1e2f' : '#ffffff',
		border: isDarkModeActive ? '#2d2d34' : '#f0f0f0',
		textMain: isDarkModeActive ? '#ffffff' : '#1f1f1f',
		textMuted: isDarkModeActive ? '#aaaaaa' : '#8c8c8c',
	};

	/**
	 * 函數名稱: handleExpiryToggle
	 * 函數功能: 處理強制密碼過期輪替 Switch 開關之切換事件，向全域狀態寫入新設定。
	 * 
	 * 輸入參數 (Input):
	 *   - isChecked (boolean): 開關當前之勾選狀態 (true/false)
	 * 返回值 (Return): void
	 * 
	 * 規範對照: 符合變數撰寫參考 c) 確保全域變數正確修改
	 */
	const handleExpiryToggle = (isChecked: boolean): void => 
	{
		executeUpdateSecuritySettings({
			sessionTimeout: sessionTimeoutValue, 
			maxFailedLogins: maxFailedLoginsValue, 
			isMaintenanceMode: isMaintenanceModeActive,
			passwordExpiryDays: passwordExpiryDaysValue,
			enablePasswordExpiry: isChecked
		});

		logSystemEvent('INFO', `密碼過期輪替政策：${isChecked ? '啟用' : '停用'}`, useAuthStore.getState().user?.name ?? 'Admin');

		messageApi.success(
			translate('admin.setting_updated', '安全性設定已成功更新！')
		);
	};

	/**
	 * 函數名稱: handleDaysChange
	 * 函數功能: 處理密碼有效天數 InputNumber 變更事件，過濾無效數值後寫入全域狀態。
	 * 
	 * 輸入參數 (Input):
	 *   - inputDaysValue (number | null): 輸入數值 (天數)
	 * 返回值 (Return): void
	 * 
	 * 規範對照: 符合變數撰寫參考 d) 防止向全域變數傳遞不合理值
	 */
	const handleDaysChange = (inputDaysValue: number | null): void => 
	{
		if (inputDaysValue && inputDaysValue >= MIN_PASSWORD_EXPIRY_DAYS && inputDaysValue <= MAX_PASSWORD_EXPIRY_DAYS) 
		{
			executeUpdateSecuritySettings({
				sessionTimeout: sessionTimeoutValue, 
				maxFailedLogins: maxFailedLoginsValue, 
				isMaintenanceMode: isMaintenanceModeActive, 
				enablePasswordExpiry: isPasswordExpiryEnabled,
				passwordExpiryDays: inputDaysValue
			});

			logSystemEvent('INFO', `密碼有效天數上限改為 ${inputDaysValue} 天`, useAuthStore.getState().user?.name ?? 'Admin');

			messageApi.success(
				translate('admin.setting_updated', '安全性設定已成功更新！')
			);
		}
		else if (inputDaysValue !== null)
		{
			// 若發生溢出或不合理數值，提示使用者並拒絕寫入全域變數 (符合規範 d)
			messageApi.error(
				translate('admin.setting_invalid', `天數設定無效，必須介於 ${MIN_PASSWORD_EXPIRY_DAYS} 到 ${MAX_PASSWORD_EXPIRY_DAYS} 天之間。`)
			);
		}
	};

	return (
		<div style={{ padding: '12px' }}>
			<h2 style={{ color: themeColorsConfig.textMain, marginBottom: '8px', fontSize: scaleFontSize(24) }}>
				{translate('admin.dashboard_title', '系統管理大廳')}
			</h2>

			<p style={{ color: themeColorsConfig.textMuted, marginBottom: '24px' }}>
				{translate('admin.dashboard_desc', '您目前以 Admin 身份登入。基於職責分離 (SoD) 原則，此介面不參與前台業務資料操作。以下為系統基礎設施健康狀態與資安概覽。')}
			</p>
			
			<Row gutter={[24, 24]}>
				<Col xs={24} md={8}>
					<Card 
						className="v-card-style" 
						style={
							{ 
								borderRadius: '12px', 
								height: '100%', 
								background: themeColorsConfig.bgCard, 
								borderColor: themeColorsConfig.border 
							}
						}
					>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
							<div style={{ color: themeColorsConfig.textMuted, fontSize: scaleFontSize(14), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<span>{translate('admin.backend_status', '後端連線狀態')}</span>
								<Tooltip title={translate('admin.backend_recheck', '重新檢查')}>
									<Button
										type="text" size="small" shape="circle"
										icon={backendHealthState.status === 'checking' ? <LoadingOutlined /> : <ReloadOutlined />}
										disabled={backendHealthState.status === 'checking'}
										aria-label={translate('admin.backend_recheck', '重新檢查')}
										onClick={() => { void runBackendHealthCheck(); }}
									/>
								</Tooltip>
							</div>

							<div style={{ color: backendHealthState.status === 'down' ? '#ff4d4f' : themeColorsConfig.textMain, fontSize: scaleFontSize(24), display: 'flex', alignItems: 'center', gap: '8px' }}>
								<DesktopOutlined style={{ color: backendHealthState.status === 'ok' ? '#52c41a' : backendHealthState.status === 'down' ? '#ff4d4f' : themeColorsConfig.textMuted }} />
								<span>
									{backendHealthState.status === 'ok' && translate('admin.backend_ok', '連線正常')}
									{backendHealthState.status === 'down' && translate('admin.backend_down', '無法連線')}
									{backendHealthState.status === 'checking' && translate('admin.backend_checking', '檢查中…')}
								</span>
							</div>
						</div>

						<div style={{ marginTop: '12px', color: themeColorsConfig.textMuted, fontSize: scaleFontSize(13), display: 'flex', flexDirection: 'column', gap: '2px' }}>
							{backendHealthState.status === 'ok' && (
								<span>{translate('admin.backend_ok_desc', '回應 {{ms}} ms · 檢查於 {{time}}', { ms: backendHealthState.responseMs, time: formatClockTime(backendHealthState.checkedAt) })}</span>
							)}
							{backendHealthState.status === 'down' && (
								<span>{translate('admin.backend_down_desc', '原因：{{reason}} · 檢查於 {{time}}', { reason: backendHealthState.reason === 'timeout' ? translate('admin.backend_reason_timeout', '逾時') : backendHealthState.reason === 'network' ? translate('admin.backend_reason_network', '網路錯誤') : backendHealthState.reason, time: formatClockTime(backendHealthState.checkedAt) })}</span>
							)}
							<span>
								{translate('admin.api_stats_24h', '24H 後端呼叫：成功 {{ok}} 次、失敗 {{fail}} 次', { ok: apiCallStats.successCount, fail: apiCallStats.failureCount })}
								{apiCallStats.lastFailureAt !== null && translate('admin.api_last_failure', '（最近失敗 {{time}}）', { time: formatClockTime(apiCallStats.lastFailureAt) })}
							</span>
						</div>
					</Card>
				</Col>
				
				<Col xs={24} md={8}>
					<Card 
						className="v-card-style" 
						style={
							{ 
								borderRadius: '12px', 
								height: '100%', 
								background: themeColorsConfig.bgCard, 
								borderColor: themeColorsConfig.border 
							}
						}
					>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
							<div style={{ color: themeColorsConfig.textMuted, fontSize: scaleFontSize(14) }}>
								{translate('admin.failed_logins', '24H 異常登入攔截')}
							</div>

							<div style={{ color: failedLoginStats.count > 0 ? '#faad14' : themeColorsConfig.textMain, fontSize: scaleFontSize(24), display: 'flex', alignItems: 'center', gap: '8px' }}>
								<WarningOutlined style={{ color: failedLoginStats.count > 0 ? '#faad14' : themeColorsConfig.textMuted }} />
								<span>{failedLoginStats.count}</span>
							</div>
						</div>

						<div style={{ marginTop: '12px', color: themeColorsConfig.textMuted, fontSize: scaleFontSize(13), display: 'flex', flexDirection: 'column', gap: '2px' }}>
							<span>
								{failedLoginStats.count === 0
									? translate('admin.failed_logins_none', '過去 24 小時沒有異常登入')
									: translate('admin.failed_logins_accounts', '涉及 {{count}} 個帳號：{{names}}', { count: failedLoginStats.distinctSources.length, names: failedLoginStats.distinctSources.slice(0, 3).join('、') + (failedLoginStats.distinctSources.length > 3 ? '…' : '') })}
							</span>
							{failedLoginStats.lockedAccountCount > 0 && (
								<span style={{ color: '#faad14' }}>{translate('admin.locked_accounts_now', '目前鎖定中：{{count}} 個帳號', { count: failedLoginStats.lockedAccountCount })}</span>
							)}
						</div>
					</Card>
				</Col>

				<Col xs={24} md={8}>
					<Card 
						className="v-card-style" 
						style={
							{ 
								borderRadius: '12px', 
								height: '100%', 
								background: themeColorsConfig.bgCard, 
								borderColor: themeColorsConfig.border 
							}
						}
					>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
							<div style={{ color: themeColorsConfig.textMuted, fontSize: scaleFontSize(14) }}>
								{translate('admin.active_users', '24H 登入使用者')}
							</div>

							<div style={{ color: themeColorsConfig.textMain, fontSize: scaleFontSize(24), display: 'flex', alignItems: 'baseline', gap: '8px' }}>
								<TeamOutlined style={{ color: '#1890ff', alignSelf: 'center' }} />
								<span>{activeUserStats.recentLoginCount}</span>
								<span style={{ fontSize: scaleFontSize(16) }}>/ {activeUserStats.totalAccountCount}</span>
							</div>
						</div>

						<div style={{ marginTop: '12px', color: themeColorsConfig.textMuted, fontSize: scaleFontSize(13), display: 'flex', flexDirection: 'column', gap: '2px' }}>
							<span>
								{activeUserStats.recentLoginCount === 0
									? translate('admin.active_users_none', '過去 24 小時沒有人登入')
									: translate('admin.active_users_recent', '最近登入：{{names}}', { names: activeUserStats.recentLoginNames.slice(0, 3).join('、') + (activeUserStats.recentLoginNames.length > 3 ? '…' : '') })}
							</span>
							{activeUserStats.disabledAccountCount > 0 && (
								<span>{translate('admin.disabled_accounts', '停用帳號：{{count}} 個', { count: activeUserStats.disabledAccountCount })}</span>
							)}
						</div>
					</Card>
				</Col>
			</Row>

			<div style={{ marginTop: '8px', color: themeColorsConfig.textMuted, fontSize: scaleFontSize(12), opacity: 0.8 }}>
				{translate('admin.stats_source_note', '※ 登入與 API 統計來自此瀏覽器的系統維運日誌與帳號資料（Demo 版），尚未集中於後端；後端連線狀態每 60 秒自動檢查一次。')}
			</div>

			{/* 密碼安全政策快速控管區塊 */}
			<Card 
				className="v-card-style" 
				style={
					{ 
						marginTop: '24px', 
						borderRadius: '12px', 
						background: themeColorsConfig.bgCard, 
						borderColor: themeColorsConfig.border 
					}
				}
				title={
					<Space>
						<SafetyOutlined style={{ color: '#52c41a' }} />
						<span style={{ color: themeColorsConfig.textMain }}>
							{translate('admin.password_policy_title', '密碼安全政策快速控管')}
						</span>
					</Space>
				}
			>
				<Row gutter={[24, 24]} align="middle">
					<Col xs={24} md={12}>
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
							<div>
								<div style={{ color: themeColorsConfig.textMain, fontWeight: 500, marginBottom: '4px' }}>
									{translate('admin.enable_expiry', '強制密碼過期輪替')}
								</div>

								<div style={{ color: themeColorsConfig.textMuted, fontSize: scaleFontSize(12) }}>
									{translate('admin.enable_expiry_desc', '開啟後，所有帳號必須在設定的週期內變更密碼。')}
								</div>
							</div>

							<Switch 
								checked={isPasswordExpiryEnabled} 
								onChange={handleExpiryToggle} 
							/>
						</div>
					</Col>
					
					<Col xs={24} md={12}>
						<div 
							style={
								{ 
									display: 'flex', 
									justifyContent: 'space-between', 
									alignItems: 'center', 
									opacity: isPasswordExpiryEnabled ? 1 : 0.4, 
									pointerEvents: isPasswordExpiryEnabled ? 'auto' : 'none', 
									transition: 'all 0.3s' 
								}
							}
						>
							<div>
								<div style={{ color: themeColorsConfig.textMain, fontWeight: 500, marginBottom: '4px' }}>
									{translate('admin.expiry_days', '密碼有效天數')}
								</div>

								<div style={{ color: themeColorsConfig.textMuted, fontSize: scaleFontSize(12) }}>
									{translate('admin.expiry_days_desc', '建議企業內部安全規範設定為 90 天。')}
								</div>
							</div>

							<Space>
								<InputNumber 
									min={MIN_PASSWORD_EXPIRY_DAYS} 
									max={MAX_PASSWORD_EXPIRY_DAYS} 
									value={passwordExpiryDaysValue} 
									onChange={handleDaysChange}
									disabled={!isPasswordExpiryEnabled}
									style={{ width: '7em' }}
								/>

								<span style={{ color: themeColorsConfig.textMuted }}>
									{translate('admin.days', '天')}
								</span>
							</Space>
						</div>
					</Col>
				</Row>
			</Card>

			{/* 單一入口導向橫幅 */}
			<Card 
				className="v-card-style" 
				style={
					{ 
						marginTop: '24px', 
						borderRadius: '12px', 
						background: themeColorsConfig.bgCard, 
						borderColor: themeColorsConfig.border 
					}
				} 
			>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
					<div>
						<h3 style={{ margin: 0, color: themeColorsConfig.textMain, fontSize: scaleFontSize(18), display: 'flex', alignItems: 'center', gap: '8px' }}>
							<SettingOutlined style={{ color: '#1890ff' }} />
							{translate('admin.console_entry_title', '系統設定')}
						</h3>

						<p style={{ margin: '8px 0 0 0', color: themeColorsConfig.textMuted, fontSize: scaleFontSize(14) }}>
							{translate('admin.console_entry_desc', '集中管理使用者帳號、檢視系統維運日誌，並設定連線逾時與維護模式等全域安全參數。')}
						</p>
					</div>

					<Button 
						type="primary" 
						size="large" 
						onClick={() => navigate('/settings/preferences')} 
						style={{ borderRadius: '8px', minWidth: '13em' }}
					>
						{translate('admin.btn_enter_console', '前往系統設定')} <RightOutlined />
					</Button>
				</div>
			</Card>
		</div>
	);
}