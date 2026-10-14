/**
 * ============================================================================
 * 檔案名稱 (File): RequestAccess.tsx
 * 模組功能 (Description): 使用者權限申請頁面組件 (提供新使用者填寫姓名、公司信箱與申請原因以提交權限審核)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, ConfigProvider, theme, message as messageApi } from 'antd';
import { Shield, Mail, User, ArrowLeft, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useUIStore } from '../../store/useUIStore';

import { scaleFontSize } from '../../utils/fontScale';
/**
 * 預設時間常數宣告 (單位: 毫秒)
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const REQUEST_SUBMIT_SIMULATION_DELAY_MS = 1500;
const PAGE_NAVIGATION_DELAY_MS = 2000;

/**
 * 權限申請表單欄位數值介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface RequestAccessValues 
{
	name: string;   // 申請人真實姓名
	email: string;  // 申請人公司電子郵件
	reason: string; // 申請部門與使用原因說明
}

/**
 * 函數名稱: RequestAccess
 * 函數功能: 渲染使用權限申請介面，提供用戶輸入真實姓名、公司 Email 與部門申請原因，並於提交後引導返回登入頁。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 權限申請頁面 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被 AppRouter 主路由組件載入渲染 (路徑: /request-access)
 *   - 訂閱用 useUIStore 讀取全域深色模式主題狀態
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function RequestAccess(): React.ReactElement 
{
	const { t: translate } = useTranslation();

	const navigate = useNavigate();

	// 元件區域狀態宣告 (符合規範 g)
	const [isSubmitting, setIsSubmitting] = useState<boolean>(false); // 申請提交異步加載狀態開關
	
	// 從 UIStore 訂閱全域深色模式主題狀態 (符合規範 g, i)
	const isDarkModeActive = useUIStore(
		(state) => state.isDarkMode
	);

	/**
	 * 函數名稱: handleRequest
	 * 函數功能: 處理權限申請表單完成送出事件，模擬異步提交審核請求，並於成功後自動引導跳轉至登入頁。
	 * 
	 * 輸入參數 (Input):
	 *   - formValuesObj (RequestAccessValues): 包含 name, email, reason 之表單數值物件
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於 Form 元件之 onFinish 事件
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
	const handleRequest = (formValuesObj: RequestAccessValues): void => 
	{
		setIsSubmitting(true);
		
		setTimeout(
			() => 
			{
				setIsSubmitting(false);

				messageApi.success(
					translate('message.request_sent', '申請已送出！系統管理員將會審核 {{name}} 的存取權限。', { name: formValuesObj.name })
				);

				setTimeout(
					() => navigate('/login'), 
					PAGE_NAVIGATION_DELAY_MS
				);
			}, 
			REQUEST_SUBMIT_SIMULATION_DELAY_MS
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
							maxWidth: '34.5em', 
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
					<div style={{ textAlign: 'center', marginBottom: 24 }}>
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
							{translate('request_access.title', '申請使用權限')}
						</h2>

						<p style={{ color: isDarkModeActive ? '#94a3b8' : '#64748b', margin: 0, fontSize: scaleFontSize(14) }}>
							{translate('request_access.subtitle', '請填寫您的資料，管理員審核通過後將發送通知信。')}
						</p>
					</div>

					{/* 權限申請表單 */}
					<Form 
						layout="vertical" 
						onFinish={handleRequest} 
						size="large"
					>
						<Form.Item 
							label={<span style={{ color: isDarkModeActive ? '#e2e8f0' : '#334155' }}>{translate('common.real_name', '真實姓名')}</span>} 
							name="name" 
							rules={
								[
									{ 
										required: true, 
										message: translate('validation.real_name_required', '請輸入真實姓名！') 
									}
								]
							}
						>
							<Input 
								prefix={<User size={18} color={isDarkModeActive ? "#94a3b8" : "#64748b"} style={{ marginRight: 8 }} />} 
								placeholder={translate('placeholder.real_name', '例如：張小明')} 
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
							label={<span style={{ color: isDarkModeActive ? '#e2e8f0' : '#334155' }}>{translate('common.company_email', '公司電子郵件')}</span>} 
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
								placeholder={translate('placeholder.company_email', 'name@company.com')} 
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
							label={<span style={{ color: isDarkModeActive ? '#e2e8f0' : '#334155' }}>{translate('common.department_reason', '部門 / 申請原因')}</span>} 
							name="reason" 
							rules={
								[
									{ 
										required: true, 
										message: translate('validation.reason_required', '請填寫您的部門或申請原因！') 
									}
								]
							}
						>
							<Input.TextArea 
								placeholder={translate('placeholder.reason', '請簡述您所屬部門及為何需要使用隱私強化工具包...')} 
								autoSize={{ minRows: 3, maxRows: 5 }} 
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
						<Form.Item style={{ marginTop: 8, marginBottom: 16 }}>
							<Button 
								type="primary" 
								htmlType="submit" 
								block 
								loading={isSubmitting} 
								icon={!isSubmitting && <Send size={18} />} 
								style={{ height: 44, borderRadius: 8, fontWeight: 'bold' }}
							>
								{translate('request_access.submit', '送出申請')}
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