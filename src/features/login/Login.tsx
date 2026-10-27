/**
 * ============================================================================
 * 檔案名稱 (File): Login.tsx
 * 模組功能 (Description): 使用者登入驗證頁面組件 (帳密登入，經後端會員系統 POST /api/v1/auth/login 驗證)
 * ★ 2026-10-27：串接後端會員系統；移除 Demo 帳號提示、一鍵快速登入與「記住我」（refresh token 存於 sessionStorage，關閉分頁即需重新登入）。
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, ConfigProvider, theme, App as AntdApp } from 'antd';
import { Mail, Lock, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../store/useAuthStore';
import { useUIStore } from '../../store/useUIStore';
import { logSystemEvent } from '../../store/useSystemLogStore';
import { memberLogin, toMemberApiError, isMemberServiceUnavailable, clearMemberSession } from '../../api/authApi';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

import { scaleFontSize } from '../../utils/fontScale';
/**
 * 預設時間常數宣告 (單位: 毫秒)
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const PAGE_NAVIGATION_DELAY_MS = 500;

/**
 * 登入表單欄位數值介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface LoginFormValues 
{
	email?: string;    // 登入帳號（帳號即 Email）
	password?: string; // 使用者密碼
}

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
	const { t: translate } = useTranslation();

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

	// ★ 2026-10-27：因登入逾期（後端拒絕換發 token、帳號被停用或刪除）被登出時，回到登入頁提示一次
	const lastLogoutReasonValue = useAuthStore((state) => state.lastLogoutReason);
	useEffect(() =>
	{
		if (lastLogoutReasonValue === 'expired')
		{
			messageApi.warning(translate('login.session_expired', '登入已逾期或帳號已被停用，請重新登入。'));
			useAuthStore.setState({ lastLogoutReason: null });
		}
	}, [lastLogoutReasonValue, messageApi, translate]);

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
		const usernameInputString = (formValuesObj.email || '').trim();
		
		try 
		{
			// ★ 2026-10-27：改由後端驗證帳密。帳號不存在／密碼錯誤／帳號停用，後端一律回 401 同一句話（避免探測帳號）；
			//   180 秒內失敗 5 次鎖 15 分鐘（423，帶 Retry-After）；後端未設定 JWT 金鑰回 503。不回退到前端帳號。
			const memberSession = await memberLogin(usernameInputString, formValuesObj.password || '');

			// 維護模式期間僅允許 Admin 登入（維護模式目前為前端設定）
			const securitySettingsSnapshot = useWorkspaceStore.getState() as unknown as { isMaintenanceMode?: boolean };
			if (securitySettingsSnapshot.isMaintenanceMode && memberSession.role !== 'admin')
			{
				clearMemberSession();
				logSystemEvent('WARN', '登入被拒（系統維護模式中，僅允許 Admin）', memberSession.username);
				messageApi.warning(translate('admin.maintenance_active_desc', '系統已進入維護模式，僅允許管理員存取。'));
				return;
			}

			executeLoginAction(
				{ name: memberSession.username, email: memberSession.username, role: memberSession.role }
			);

			messageApi.success(
				translate('login.success')
			);

			setTimeout(
				() => navigate('/', { replace: true }), 
				PAGE_NAVIGATION_DELAY_MS
			);
		} 
		catch (loginExecutionError) 
		{
			const memberErrorObj = toMemberApiError(loginExecutionError);
			if (memberErrorObj.status === 423)
			{
				const remainingMinutesValue = Math.max(1, Math.ceil((memberErrorObj.retryAfterSeconds ?? 900) / 60));
				logSystemEvent('WARN', `登入失敗（帳號鎖定中，約 ${remainingMinutesValue} 分鐘後解除）`, usernameInputString);
				messageApi.error(translate('login.error_locked', '登入失敗次數過多，帳號已鎖定，請於 {{minutes}} 分鐘後再試，或請系統管理員重設密碼。', { minutes: remainingMinutesValue }));
			}
			else if (memberErrorObj.status === 503)
			{
				logSystemEvent('ERROR', '登入失敗（後端會員系統未啟用）', usernameInputString || '(未填帳號)');
				messageApi.error(translate('login.error_auth_disabled', '登入功能尚未啟用，請聯繫系統管理員。'));
			}
			else if (isMemberServiceUnavailable(memberErrorObj))
			{
				logSystemEvent('ERROR', `登入失敗（無法連線至後端：${memberErrorObj.message}）`, usernameInputString || '(未填帳號)');
				messageApi.error(translate('login.networkError'));
			}
			else
			{
				logSystemEvent('WARN', '登入失敗（帳號或密碼錯誤）', usernameInputString || '(未填帳號)');
				messageApi.error(translate('login.error'));
			}
		} 
		finally 
		{
			setIsSubmitting(false);
		}
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

					{/* 表單區塊 */}
					<Form
						form={loginFormInstance}
						layout="vertical"
						onFinish={handleLogin}
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

						{/* ★ 2026-10-16：移除「忘記密碼」（同步後端：密碼由管理員重設）；★ 2026-10-27：移除「記住我」 */}
						{/* 標準登入按鈕 */}
						<Form.Item style={{ marginBottom: 0 }}>
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

						{/* ★ 2026-10-27：移除「一鍵快速登入（測試用）」，一律經後端帳密驗證 */}
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
						{/* ★ 2026-10-16：移除「申請使用權限」（同步後端：帳號由管理員建立） */}
						{translate('login.no_account_contact_admin', '尚無帳號？請洽系統管理員建立。')}
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