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

import { useAuthStore, type UserRole } from '../../store/useAuthStore';
import { loginWithBackend, type BackendUserRole } from '../../api/apiService';
import { useUIStore } from '../../store/useUIStore';

/**
 * 預設時間常數宣告 (單位: 毫秒)
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
// ★ 2026-10-02：登入改為串接後端 /api/v1/auth/login，不再模擬延遲
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
const DEMO_ACCOUNTS = 
{
	'owner@test.com': { password: 'password', name: 'Data.Owner.A', role: 'data_owner' as const }
};

/**
 * ★ 2026-10-02：Demo 帳號提示與「一鍵快速登入」會繞過後端驗證，正式環境一律隱藏；
 *   僅在 .env 設定 VITE_ENABLE_DEMO_LOGIN=true 時顯示（開發／展示用）。
 */
const IS_DEMO_LOGIN_ENABLED = import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true';

/**
 * 後端角色 → 前端角色：admin→系統管理員；analyst（可讀取與處理）→資料擁有者；
 * viewer（唯讀）目前前端沒有唯讀檢視，回傳 null 由登入頁擋下並提示。
 */
const mapBackendRoleToUserRole = (backendRole: BackendUserRole): UserRole | null =>
{
	if (backendRole === 'admin') return 'admin';
	if (backendRole === 'analyst') return 'data_owner';
	return null;
};

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
	 * 函數功能: 處理標準登入表單送出事件：呼叫後端 /api/v1/auth/login 驗證帳密，成功後依角色寫入 AuthStore。
	 *           啟用 Demo 模式（VITE_ENABLE_DEMO_LOGIN=true）時，Demo 帳號仍可在前端直接登入。
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
			const usernameText = String(formValuesObj.email || '').trim();
			const passwordText = String(formValuesObj.password || '');

			const finishLogin = (displayName: string, accountText: string, userRole: UserRole): void =>
			{
				executeLoginAction({ name: displayName, email: accountText, role: userRole });
				messageApi.success(translate('login.success'));
				setTimeout(() => navigate('/', { replace: true }), PAGE_NAVIGATION_DELAY_MS);
			};

			// Demo 模式：Demo 帳號在前端直接通過（不經後端）
			const demoAccountConfig = IS_DEMO_LOGIN_ENABLED ? DEMO_ACCOUNTS[usernameText as keyof typeof DEMO_ACCOUNTS] : undefined;
			if (demoAccountConfig && passwordText === demoAccountConfig.password)
			{
				finishLogin(demoAccountConfig.name, usernameText, demoAccountConfig.role);
				return;
			}

			const backendLoginResult = await loginWithBackend(usernameText, passwordText);
			if (backendLoginResult.success)
			{
				const mappedUserRole = mapBackendRoleToUserRole(backendLoginResult.role);
				if (!mappedUserRole)
				{
					messageApi.error(translate('login.viewerNotSupported', '此帳號為唯讀角色（viewer），目前系統尚未提供唯讀檢視，請聯絡系統管理員調整為 analyst 或 admin。'));
					return;
				}
				finishLogin(backendLoginResult.username, backendLoginResult.username, mappedUserRole);
				return;
			}

			if (backendLoginResult.reason === 'invalid_credentials') messageApi.error(translate('login.error'));
			else if (backendLoginResult.reason === 'unreachable') messageApi.error(translate('login.networkError'));
			else if (backendLoginResult.reason === 'unknown_role') messageApi.error(translate('login.unknownRole', '後端回傳了無法辨識的角色，請聯絡系統管理員。'));
			else messageApi.error(translate('login.serverError', '登入服務發生錯誤，請稍後再試或聯絡系統管理員。'));
		} 
		catch (loginExecutionError) 
		{
			console.error('Login Error:', loginExecutionError);

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
		executeLoginAction(
			{ name: 'Data.Owner.A', email: 'owner@test.com', role: 'data_owner' }
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
							maxWidth: 440,
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
							<h1 style={{ color: isDarkModeActive ? '#fff' : '#1e293b', fontSize: 24, fontWeight: 'bold', margin: 0, letterSpacing: 1 }}>
								PRIVACY APP
							</h1>
						</div>

						<h2 style={{ color: isDarkModeActive ? '#e2e8f0' : '#334155', fontSize: 20, fontWeight: 500, margin: '0 0 8px 0' }}>
							{translate('login.welcome')}
						</h2>

						<p style={{ color: isDarkModeActive ? '#94a3b8' : '#64748b', margin: 0, fontSize: 14 }}>
							{translate('login.subtitle')}
						</p>
					</div>

					{/* Demo 測試帳號提示區 (點擊可自動填入)；★ 2026-10-02：僅 Demo 模式顯示 */}
					{IS_DEMO_LOGIN_ENABLED && (
					<Alert
						message={<span style={{ fontSize: 13, fontWeight: 'bold' }}>{isChineseLanguageEnabled ? 'Demo 測試帳號 (點擊自動填入)' : 'Demo Account (Click to fill)'}</span>}
						description={
							<div style={{ fontSize: 12, marginTop: 4 }}>
								<div onClick={() => fillDemoAccount('owner@test.com')} style={{ cursor: 'pointer', color: '#10b981' }}>
									Data Owner: <b>owner@test.com</b> / <b>password</b>
								</div>
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
					)}

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

							<span onClick={() => navigate('/forgot-password')} style={{ color: '#3f51b5', fontSize: 14, cursor: 'pointer' }}>
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

						{/* 快速登入按鈕；★ 2026-10-02：會繞過後端驗證，僅 Demo 模式顯示 */}
						{IS_DEMO_LOGIN_ENABLED && (
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
						)}
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
								fontSize: 14 
							}
						}
					>
						{translate('login.noAccount')}{' '}
						<span onClick={() => navigate('/request-access')} style={{ color: '#3f51b5', fontWeight: 'bold', cursor: 'pointer' }}>
							{translate('login.requestAccess')}
						</span>
					</div>
				</Card>
			</div>
		</ConfigProvider>
	);
}