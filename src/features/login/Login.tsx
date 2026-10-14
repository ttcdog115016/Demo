/**
 * ============================================================================
 * 檔案名稱 (File): Login.tsx
 * 模組功能 (Description): 使用者登入驗證頁面組件 (提供標準帳密登入、Demo 帳號自動填入與快速免密登入)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Checkbox, ConfigProvider, theme, App as AntdApp, Alert } from 'antd';
import { Mail, Lock, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../store/useAuthStore';
import { useUIStore } from '../../store/useUIStore';
import { logSystemEvent } from '../../store/useSystemLogStore';
import { useAccountStore } from '../../store/useAccountStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

import { scaleFontSize } from '../../utils/fontScale';
/**
 * 預設時間常數宣告 (單位: 毫秒)
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const LOGIN_SIMULATION_DELAY_MS = 800;
const PAGE_NAVIGATION_DELAY_MS = 500;
const QUICK_LOGIN_NAVIGATION_DELAY_MS = 100;

/**
 * 登入表單欄位數值介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface LoginFormValues 
{
	email?: string;    // 使用者電子郵件帳號
	password?: string; // 使用者密碼
	remember?: boolean;// 是否記住登入狀態 (開關)
}

/**
 * 模擬後端帳號資料庫常數 (Mock Demo Accounts)
 * 規範對照: 符合規範 g) 物理含義常數宣告時加以註記
 */
// ★ 2026-10-07：登入改為比對帳號資料庫 (useAccountStore)，此處只保留登入頁「點擊自動填入」的提示用帳密
const DEMO_ACCOUNTS = 
{
	'owner@test.com': { password: 'password', label: 'Data Owner' },
	'admin@test.com': { password: 'Admin@123456', label: 'Admin' },
};

// 安全參數預設值（與「系統偏好 → 安全與環境參數」一致）
const DEFAULT_MAX_FAILED_LOGINS_LIMIT = 5;
const DEFAULT_PASSWORD_EXPIRY_DAYS = 90;

/**
 * 函數名稱: Login
 * 函數功能: 渲染登入介面，提供用戶輸入帳密登入、快速測試填入、免密登入與跳轉至權限申請/忘記密碼等導頁功能。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 登入頁面 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被 AppRouter 主路由組件載入渲染 (路徑: /login)
 *   - 訂閱用 useUIStore 讀取主題狀態、useAuthStore 寫入登入 Session
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function Login(): React.ReactElement 
{
	const { t: translate, i18n: i18nInstance } = useTranslation();

	const navigate = useNavigate();

	const [loginFormInstance] = Form.useForm<LoginFormValues>();
	
	const isDarkModeActive = useUIStore(
		(state) => state.isDarkMode
	);

	const executeLoginAction = useAuthStore(
		(state) => state.login
	);

	const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

	const { message: messageApi } = AntdApp.useApp();

	const isChineseLanguageEnabled = i18nInstance.language?.toLowerCase().startsWith('zh');

	/**
	 * 函數名稱: handleLogin
	 * 函數功能: 處理標準登入表單送出事件，模擬網路延遲、比對 Demo 帳戶庫並寫入 AuthStore。
	 * 
	 * 輸入參數 (Input):
	 *   - formValuesObj (LoginFormValues): 包含 email, password, remember 之表單數值物件
	 * 返回值 (Return): Promise<void>
	 */
	const handleLogin = async (formValuesObj: LoginFormValues): Promise<void> => 
	{
		setIsSubmitting(true);
		
		try 
		{
			await new Promise(
				(resolveSimulationDelay) => setTimeout(resolveSimulationDelay, LOGIN_SIMULATION_DELAY_MS)
			);

			const emailInputString = (formValuesObj.email || '').trim();

			// 安全參數（Admin 於「安全與環境參數」設定；未設定時用預設值）
			const securitySettingsSnapshot = useWorkspaceStore.getState() as unknown as { maxFailedLogins?: number; enablePasswordExpiry?: boolean; passwordExpiryDays?: number; isMaintenanceMode?: boolean };
			const maxFailedLoginsValue = securitySettingsSnapshot.maxFailedLogins ?? DEFAULT_MAX_FAILED_LOGINS_LIMIT;
			const passwordExpiryDaysValue = securitySettingsSnapshot.enablePasswordExpiry !== false ? (securitySettingsSnapshot.passwordExpiryDays ?? DEFAULT_PASSWORD_EXPIRY_DAYS) : null;

			const authenticateResult = useAccountStore.getState().authenticate(emailInputString, formValuesObj.password || '', maxFailedLoginsValue, passwordExpiryDaysValue);

			if (!authenticateResult.ok)
			{
				if (authenticateResult.reason === 'disabled')
				{
					logSystemEvent('WARN', '登入失敗（帳號已停用）', emailInputString || '(未填帳號)');
					messageApi.error(translate('login.error_disabled', '此帳號已停用，請聯絡系統管理員。'));
				}
				else if (authenticateResult.reason === 'locked')
				{
					const remainingMinutesValue = Math.max(1, Math.ceil(((authenticateResult.lockedUntil ?? Date.now()) - Date.now()) / 60000));
					logSystemEvent('WARN', `登入失敗（帳號鎖定中，約 ${remainingMinutesValue} 分鐘後解除）`, emailInputString);
					messageApi.error(translate('login.error_locked', '登入失敗次數過多，帳號已鎖定，請於 {{minutes}} 分鐘後再試，或聯絡系統管理員解除。', { minutes: remainingMinutesValue }));
				}
				else
				{
					// 帳號不存在與密碼錯誤顯示相同訊息，避免被用來探測哪些帳號存在
					logSystemEvent('WARN', authenticateResult.reason === 'not_found' ? '登入失敗（帳號不存在）' : `登入失敗（密碼錯誤，剩餘 ${authenticateResult.remainingAttempts} 次）`, emailInputString || '(未填帳號)');
					messageApi.error(
						authenticateResult.reason === 'wrong_password' && authenticateResult.remainingAttempts !== undefined && authenticateResult.remainingAttempts <= 2
							? translate('login.error_remaining', '帳號或密碼錯誤。再錯 {{count}} 次帳號將被鎖定。', { count: authenticateResult.remainingAttempts })
							: translate('login.error')
					);
				}
				return;
			}

			const loggedInAccount = authenticateResult.account;

			// 維護模式期間僅允許 Admin 登入
			if (securitySettingsSnapshot.isMaintenanceMode && loggedInAccount.role !== 'admin')
			{
				logSystemEvent('WARN', '登入被拒（系統維護模式中，僅允許 Admin）', loggedInAccount.name);
				messageApi.warning(translate('admin.maintenance_active_desc', '系統已進入維護模式，僅允許管理員存取。'));
				return;
			}

			executeLoginAction(
				{ name: loggedInAccount.name, email: loggedInAccount.email, role: loggedInAccount.role, mustChangePassword: authenticateResult.mustChangePassword }
			);

			messageApi.success(
				translate('login.success')
			);

			setTimeout(
				() => navigate(authenticateResult.mustChangePassword ? '/settings/profile' : '/', { replace: true }), 
				PAGE_NAVIGATION_DELAY_MS
			);
		} 
		catch (loginExecutionError) 
		{
			console.error('Login Error:', loginExecutionError);

			logSystemEvent('ERROR', `登入程序發生例外：${String(loginExecutionError)}`, formValuesObj.email || '(未填帳號)');

			messageApi.error(
				translate('login.networkError')
			);
		} 
		finally 
		{
			setIsSubmitting(false);
		}
	};

	/**
	 * 函數名稱: handleQuickLogin
	 * 函數功能: 一鍵快速測試登入，以預設 Data Owner 身份寫入 AuthStore 並跳轉首頁。
	 * 
	 * 輸入參數 (Input): 無
	 * 返回值 (Return): void
	 */
	const handleQuickLogin = (): void => 
	{
		// 一鍵快速登入（測試用，繞過密碼）：以帳號資料庫中的 owner@test.com 身分登入
		const quickLoginAccount = useAccountStore.getState().findByEmail('owner@test.com');
		executeLoginAction(
			{ name: quickLoginAccount?.name ?? 'Data.Owner.A', email: 'owner@test.com', role: 'data_owner' }
		);

		messageApi.success(
			translate('login.quickSuccess')
		);
		
		setTimeout(
			() => 
			{
				navigate('/', { replace: true });
			}, 
			QUICK_LOGIN_NAVIGATION_DELAY_MS
		);
	};

	/**
	 * 函數名稱: fillDemoAccount
	 * 函數功能: 點擊 Demo 帳號提示區時，自動將選定之測試帳密填入 Form 表單中。
	 * 
	 * 輸入參數 (Input):
	 *   - targetAccountEmailKey (keyof typeof DEMO_ACCOUNTS): 測試帳戶之 Email 鍵值
	 * 返回值 (Return): void
	 */
	const fillDemoAccount = (targetAccountEmailKey: keyof typeof DEMO_ACCOUNTS): void => 
	{
		loginFormInstance.setFieldsValue(
			{ email: targetAccountEmailKey, password: DEMO_ACCOUNTS[targetAccountEmailKey].password }
		);
	};

	return (
		<ConfigProvider 
			theme={
				{ 
					algorithm: isDarkModeActive ? theme.darkAlgorithm : theme.defaultAlgorithm,
					token: { colorPrimary: '#3f51b5' }
				}
			}
		>
			<div 
				style={
					{
						minHeight: '100vh',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						backgroundColor: isDarkModeActive ? '#121214' : '#f1f5f9',
						padding: '16px',
						transition: 'all 0.3s'
					}
				}
			>
				<Card
					style={
						{
							width: '100%',
							maxWidth: '31.5em',
							backgroundColor: isDarkModeActive ? '#1a1a1e' : '#ffffff',
							border: `1px solid ${isDarkModeActive ? '#2d2d34' : '#e2e8f0'}`,
							boxShadow: isDarkModeActive ? '0 12px 40px rgba(0,0,0,0.5)' : '0 12px 32px rgba(0,0,0,0.08)',
							borderRadius: 16,
							transition: 'all 0.3s'
						}
					}
					styles={{ body: { padding: '40px' } }}
				>
					{/* 標題與 Logo 區塊 */}
					<div style={{ textAlign: 'center', marginBottom: 24 }}>
						<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 16 }}>
							<h1 style={{ color: isDarkModeActive ? '#fff' : '#1e293b', fontSize: scaleFontSize(24), fontWeight: 'bold', margin: 0, letterSpacing: 1 }}>
								PRIVACY APP
							</h1>
						</div>

						<h2 style={{ color: isDarkModeActive ? '#e2e8f0' : '#334155', fontSize: scaleFontSize(20), fontWeight: 500, margin: '0 0 8px 0' }}>
							{translate('login.welcome')}
						</h2>

						<p style={{ color: isDarkModeActive ? '#94a3b8' : '#64748b', margin: 0, fontSize: scaleFontSize(14) }}>
							{translate('login.subtitle')}
						</p>
					</div>

					{/* Demo 測試帳號提示區 (點擊可自動填入) */}
					<Alert
						message={<span style={{ fontSize: scaleFontSize(13), fontWeight: 'bold' }}>{isChineseLanguageEnabled ? 'Demo 測試帳號 (點擊自動填入)' : 'Demo Account (Click to fill)'}</span>}
						description={
							<div style={{ fontSize: scaleFontSize(12), marginTop: 4 }}>
								{(Object.keys(DEMO_ACCOUNTS) as (keyof typeof DEMO_ACCOUNTS)[]).map((demoEmailKey) => (
									<div key={demoEmailKey} onClick={() => fillDemoAccount(demoEmailKey)} style={{ cursor: 'pointer', color: '#10b981' }}>
										{DEMO_ACCOUNTS[demoEmailKey].label}: <b>{demoEmailKey}</b> / <b>{DEMO_ACCOUNTS[demoEmailKey].password}</b>
									</div>
								))}
							</div>
						}
						type="success"
						showIcon
						style={
							{ 
								marginBottom: 24, 
								backgroundColor: isDarkModeActive ? 'rgba(16, 185, 129, 0.1)' : '#d1fae5', 
								borderColor: isDarkModeActive ? 'rgba(16, 185, 129, 0.3)' : '#a7f3d0' 
							}
						}
					/>

					{/* 表單區塊 */}
					<Form
						form={loginFormInstance}
						layout="vertical"
						onFinish={handleLogin}
						initialValues={{ remember: true }}
						size="large"
					>
						<Form.Item
							label={<span style={{ color: isDarkModeActive ? '#e2e8f0' : '#334155' }}>{translate('login.emailLabel')}</span>}
							name="email"
							rules={[{ required: true, message: translate('login.emailRequired') }]}
						>
							<Input 
								prefix={<Mail size={18} color={isDarkModeActive ? "#94a3b8" : "#64748b"} style={{ marginRight: 8 }} />} 
								placeholder={translate('login.emailPlaceholder')} 
								style={
									{ 
										backgroundColor: isDarkModeActive ? '#0f1015' : '#ffffff', 
										borderColor: isDarkModeActive ? '#2d2d34' : '#cbd5e1', 
										color: isDarkModeActive ? '#fff' : '#0f172a' 
									}
								} 
							/>
						</Form.Item>

						<Form.Item
							label={<span style={{ color: isDarkModeActive ? '#e2e8f0' : '#334155' }}>{translate('login.passwordLabel')}</span>}
							name="password"
							rules={[{ required: true, message: translate('login.passwordRequired') }]}
							style={{ marginBottom: 16 }}
						>
							<Input.Password 
								prefix={<Lock size={18} color={isDarkModeActive ? "#94a3b8" : "#64748b"} style={{ marginRight: 8 }} />} 
								placeholder={translate('login.passwordPlaceholder')} 
								style={
									{ 
										backgroundColor: isDarkModeActive ? '#0f1015' : '#ffffff', 
										borderColor: isDarkModeActive ? '#2d2d34' : '#cbd5e1', 
										color: isDarkModeActive ? '#fff' : '#0f172a' 
									}
								} 
							/>
						</Form.Item>

						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
							<Form.Item name="remember" valuePropName="checked" noStyle>
								<Checkbox style={{ color: isDarkModeActive ? '#94a3b8' : '#64748b' }}>
									{translate('login.rememberMe')}
								</Checkbox>
							</Form.Item>

							<span onClick={() => navigate('/forgot-password')} style={{ color: '#3f51b5', fontSize: scaleFontSize(14), cursor: 'pointer' }}>
								{translate('login.forgotPassword')}
							</span>
						</div>

						{/* 標準登入按鈕 */}
						<Form.Item style={{ marginBottom: 16 }}>
							<Button 
								type="primary" 
								htmlType="submit" 
								block 
								loading={isSubmitting} 
								icon={!isSubmitting && <LogIn size={18} />} 
								style={{ height: 44, borderRadius: 8, fontWeight: 'bold' }}
							>
								{translate('login.submitBtn')}
							</Button>
						</Form.Item>

						{/* 快速登入按鈕 */}
						<Form.Item style={{ marginBottom: 0 }}>
							<Button 
								type="default" 
								block 
								onClick={handleQuickLogin}  
								style={
									{ 
										height: 44, 
										borderRadius: 8, 
										borderColor: '#10b981', 
										color: '#10b981', 
										background: 'transparent',
										fontWeight: 'bold'
									}
								}
							>
								{translate('login.quickLoginBtn')}
							</Button>
						</Form.Item>
					</Form>

					{/* 底部提示 */}
					<div 
						style={
							{ 
								textAlign: 'center', 
								marginTop: 24, 
								paddingTop: 24, 
								borderTop: `1px solid ${isDarkModeActive ? '#2d2d34' : '#e2e8f0'}`, 
								color: isDarkModeActive ? '#94a3b8' : '#64748b', 
								fontSize: scaleFontSize(14) 
							}
						}
					>
						{translate('login.noAccount')}{' '}
						<span onClick={() => navigate('/request-access')} style={{ color: '#3f51b5', fontWeight: 'bold', cursor: 'pointer' }}>
							{translate('login.requestAccess')}
						</span>
						{/* ★ 建置時間：確認瀏覽器載入的是否為最新版本 */}
						<div style={{ marginTop: 12, fontSize: scaleFontSize(11), opacity: 0.6 }}>
							{translate('login.build_time', '版本建置時間')}：{__APP_BUILD_TIME__}
						</div>
					</div>
				</Card>
			</div>
		</ConfigProvider>
	);
}