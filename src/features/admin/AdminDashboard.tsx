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
import { Row, Col, Card, Button, Tooltip, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { 
	DesktopOutlined, 
	WarningOutlined, 
	TeamOutlined, 
	RightOutlined,
	SettingOutlined,
	ReloadOutlined,
	LoadingOutlined
} from '@ant-design/icons';

import { useUIStore } from '../../store/useUIStore';
import { useSystemLogStore } from '../../store/useSystemLogStore';
import { listMemberAccounts, type MemberAccount } from '../../api/authApi';
import { SHOW_SYSTEM_LOG_TAB } from '../../config/featureFlags';
import {
	computeApiCallStats, computeFailedLoginStats, computeActiveUserStats, probeBackendHealth, STATS_WINDOW_MS, type BackendHealthState,
} from '../../utils/adminDashboardStats';

import { scaleFontSize } from '../../utils/fontScale';

/**
 * 函數名稱: AdminDashboard
 * 函數功能: 渲染管理員大廳頁面，呈現後端連線狀態、登入失敗統計、登入使用者數，並導向系統設定。
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
	const loadSystemLogsAction = useSystemLogStore((state) => state.loadLogs);
	// ★ 2026-10-27：帳號數改讀後端帳號清單（GET /api/v1/users）；讀取失敗時維持空清單，不影響其他卡片
	const [accountRecordsList, setAccountRecordsList] = useState<MemberAccount[]>([]);
	// ★ 2026-10-29：帳號清單或日誌讀不到時，卡片的 0 不是事實——顯示提示
	const [statsLoadFailureNames, setStatsLoadFailureNames] = useState<string[]>([]);
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
		// ★ 2026-10-29：統計來源（系統維運日誌）存後端，進入時與每次統計更新時重新載入
		const refreshStatsSources = (): void =>
		{
			void Promise.all([
				loadSystemLogsAction(Date.now() - STATS_WINDOW_MS),
				listMemberAccounts().then((accountsList) => { if (!isUnmounted) setAccountRecordsList(accountsList); return true; }).catch(() => false),
			]).then(([isLogsLoaded, isAccountsLoaded]) =>
			{
				if (isUnmounted) return;
				setStatsLoadFailureNames([
					...(isLogsLoaded ? [] : [translate('admin.stats_source_logs', '系統維運日誌')]),
					...(isAccountsLoaded ? [] : [translate('admin.stats_source_accounts', '帳號清單')]),
				]);
			});
		};
		refreshStatsSources();
		const healthTimerId = window.setInterval(probeAndStore, BACKEND_HEALTH_RECHECK_INTERVAL_MS);
		const statsTimerId = window.setInterval(() => { setStatsNowMs(Date.now()); refreshStatsSources(); }, STATS_REFRESH_INTERVAL_MS);
		return () => { isUnmounted = true; window.clearInterval(healthTimerId); window.clearInterval(statsTimerId); };
	}, [loadSystemLogsAction]);

	const apiCallStats = useMemo(() => computeApiCallStats(systemLogEntriesList, statsNowMs), [systemLogEntriesList, statsNowMs]);
	const failedLoginStats = useMemo(() => computeFailedLoginStats(systemLogEntriesList, accountRecordsList, statsNowMs), [systemLogEntriesList, accountRecordsList, statsNowMs]);
	const activeUserStats = useMemo(() => computeActiveUserStats(systemLogEntriesList, accountRecordsList, statsNowMs), [systemLogEntriesList, accountRecordsList, statsNowMs]);

	const navigate = useNavigate();

	
	// 訂閱全域 UI 主題狀態
	const isDarkModeActive = useUIStore(
		(state) => state.isDarkMode
	);

	// 主題配色常數設定物件
	const themeColorsConfig = {
		bgCard: isDarkModeActive ? '#1e1e2f' : '#ffffff',
		border: isDarkModeActive ? '#2d2d34' : '#f0f0f0',
		textMain: isDarkModeActive ? '#ffffff' : '#1f1f1f',
		textMuted: isDarkModeActive ? '#aaaaaa' : '#8c8c8c',
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

			{statsLoadFailureNames.length > 0 && (
				<Alert
					type="warning" showIcon style={{ marginTop: '8px' }} data-testid="admin-stats-load-failed"
					message={translate('admin.stats_load_failed', '無法取得{{sources}}，上方數字可能不完整；30 秒後會自動重試。', { sources: statsLoadFailureNames.join('、') })}
				/>
			)}
			<div style={{ marginTop: '8px', color: themeColorsConfig.textMuted, fontSize: scaleFontSize(12), opacity: 0.8 }}>
				{/* ★ 2026-10-29：系統維運日誌改存後端，登入與 API 次數為全站統計（不再是本機統計） */}
				{translate('admin.stats_source_note_server', '※ 帳號數、登入與 API 次數皆來自後端（過去 24 小時，含所有電腦）；後端連線狀態每 60 秒自動檢查一次。')}
			</div>

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
							{SHOW_SYSTEM_LOG_TAB
								? translate('admin.console_entry_desc', '集中管理使用者帳號、檢視系統維運日誌，並設定閒置逾時登出時間。')
								: translate('admin.console_entry_desc_desktop', '集中管理使用者帳號，並設定閒置逾時登出時間。')}
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