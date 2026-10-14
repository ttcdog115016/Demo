/**
 * ============================================================================
 * 檔案名稱 (File): ForgotPassword.tsx
 * 模組功能 (Description): 忘記密碼頁面組件 (提供使用者輸入電子郵件以發送密碼重設連結)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, ConfigProvider, theme, message as messageApi } from 'antd';
import { Shield, Mail, ArrowLeft, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useUIStore } from '../../store/useUIStore';

import { scaleFontSize } from '../../utils/fontScale';
/**
 * 預設時間常數宣告 (單位: 毫秒)
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const RESET_REQUEST_SIMULATION_DELAY_MS = 1200;
const PAGE_NAVIGATION_DELAY_MS = 1500;

/**
 * 重設密碼表單欄位數值介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface ResetPasswordValues 
{
	email: string; // 使用者註冊之電子郵件地址
}

/**
 * 函數名稱: ForgotPassword
 * 函數功能: 渲染忘記密碼頁面，提供使用者輸入 Email 表單，並於驗證通過後觸發密碼重設信件發送流程。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 忘記密碼 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被 AppRouter 主路由組件載入渲染 (路徑: /forgot-password)
 *   - 訂閱用 useUIStore 讀取深色模式狀態
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function ForgotPassword(): React.ReactElement 
{
	const { t: translate } = useTranslation();

	const navigate = useNavigate();

	// 元件區域狀態宣告 (符合規範 g)
	const [isSubmitting, setIsSubmitting] = useState<boolean>(false); // 表單送出異步加載狀態開關
	
	// 從 UIStore 訂閱全域深色模式主題狀態 (符合規範 g, i)
	const isDarkModeActive = useUIStore(
		(state) => state.isDarkMode
	);

	/**
	 * 函數名稱: handleResetPassword
	 * 函數功能: 處理重設密碼表單完成送出事件，模擬異步 API 觸發重設信件發送，並於成功後引導使用者返回登入頁。
	 * 
	 * 輸入參數 (Input):
	 *   - formValues (ResetPasswordValues): 包含使用者輸入 email 之表單數值物件
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於 Form 元件之 onFinish 事件
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
	const handleResetPassword = (formValues: ResetPasswordValues): void => 
	{
		setIsSubmitting(true);
		
		setTimeout(
			() => 
			{
				setIsSubmitting(false);

				messageApi.success(
					translate('message.reset_email_sent', '密碼重設信件已發送至 {{email}}，請至信箱收取！', { email: formValues.email })
				);

				setTimeout(
					() => navigate('/login'), 
					PAGE_NAVIGATION_DELAY_MS
				);
			}, 
			RESET_REQUEST_SIMULATION_DELAY_MS
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
					{/* 標頭與圖示區塊 */}
					<div style={{ textAlign: 'center', marginBottom: 36 }}>
						<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 16 }}>
							<div 
								style={
									{ 
										width: 48, 
										height: 48, 
										borderRadius: 12, 
										background: isDarkModeActive ? 'rgba(63, 81, 181, 0.1)' : 'rgba(63, 81, 181, 0.08)', 
										display: 'flex', 
										alignItems: 'center', 
										justifyContent: 'center', 
										border: '1px solid rgba(63, 81, 181, 0.2)' 
									}
								}
							>
								<Shield color="#3f51b5" size={24} />
							</div>
						</div>

						<h2 style={{ color: isDarkModeActive ? '#e2e8f0' : '#334155', fontSize: scaleFontSize(20), fontWeight: 500, margin: '0 0 8px 0' }}>
							{translate('forgot_password.title', '忘記密碼？')}
						</h2>

						<p style={{ color: isDarkModeActive ? '#94a3b8' : '#64748b', margin: 0, fontSize: scaleFontSize(14) }}>
							{translate('forgot_password.subtitle', '請輸入您註冊時的電子郵件，我們將發送重設密碼的連結給您。')}
						</p>
					</div>

					{/* 重設密碼表單 */}
					<Form 
						layout="vertical" 
						onFinish={handleResetPassword} 
						size="large"
					>
						<Form.Item
							label={<span style={{ color: isDarkModeActive ? '#e2e8f0' : '#334155' }}>{translate('common.email', '電子郵件')}</span>}
							name="email"
							rules={
								[
									{ 
										required: true, 
										type: 'email', 
										message: translate('validation.invalid_email', '請輸入有效的電子郵件！') 
									}
								]
							}
						>
							<Input 
								prefix={<Mail size={18} color={isDarkModeActive ? "#94a3b8" : "#64748b"} style={{ marginRight: 8 }} />} 
								placeholder={translate('placeholder.email', '請輸入您的電子郵件')} 
								style={
									{ 
										backgroundColor: isDarkModeActive ? '#0f1015' : '#ffffff', 
										borderColor: isDarkModeActive ? '#2d2d34' : '#cbd5e1', 
										color: isDarkModeActive ? '#fff' : '#0f172a' 
									}
								} 
							/>
						</Form.Item>

						{/* 送出按鈕 */}
						<Form.Item style={{ marginTop: 32, marginBottom: 16 }}>
							<Button 
								type="primary" 
								htmlType="submit" 
								block 
								loading={isSubmitting} 
								icon={!isSubmitting && <Send size={18} />} 
								style={{ height: 44, borderRadius: 8, fontWeight: 'bold' }}
							>
								{translate('forgot_password.submit', '發送重設連結')}
							</Button>
						</Form.Item>

						{/* 返回登入按鈕 */}
						<Button 
							type="text" 
							block 
							onClick={() => navigate('/login')} 
							icon={<ArrowLeft size={16} />} 
							style={{ color: isDarkModeActive ? '#94a3b8' : '#64748b', height: 44 }}
						>
							{translate('common.back_to_login', '返回登入')}
						</Button>
					</Form>
				</Card>
			</div>
		</ConfigProvider>
	);
}