/**
 * ============================================================================
 * 檔案名稱 (File): ProfileSettings.tsx
 * 模組功能 (Description): 個人資料與安全設定頁面組件 (提供使用者檢視帳號資訊、強密碼變更與即時強度評估)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, Space, Divider, Tag, theme, App as AntdApp, Progress, Alert } from 'antd';
import { UserOutlined, LockOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../store/useAuthStore';
import { useAccountStore } from '../../store/useAccountStore';
import { logSystemEvent } from '../../store/useSystemLogStore';
import { getRoleDisplayName } from '../../utils/roleLabel';
import { useUIStore } from '../../store/useUIStore';

import { scaleFontSize } from '../../utils/fontScale';
const { Title, Text } = Typography;

/**
 * 密碼強度評估與長度常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const MIN_PASSWORD_LENGTH_LIMIT = 12;
const BASE_PASSWORD_LENGTH_THRESHOLD = 8;
const HIGH_MEMORABILITY_LENGTH_THRESHOLD = 16;
const WEAK_STRENGTH_SCORE_THRESHOLD = 40;
const MEDIUM_STRENGTH_SCORE_THRESHOLD = 80;
const PASSWORD_UPDATE_SIMULATION_DELAY_MS = 1000;

/**
 * 函數名稱: ProfileSettings
 * 函數功能: 渲染個人資料與安全設定視圖，包含帳號資訊卡片、密碼過期警告 Banner、動態密碼強度計算器與密碼變更表單。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 個人設定頁面 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被 AppRouter 主路由組件載入渲染 (路徑: /profile)
 *   - 訂閱用 useAuthStore 讀取用戶資訊，用 useUIStore 讀取全域主題
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function ProfileSettings(): React.ReactElement 
{
	const { token } = theme.useToken();

	const { t: translate } = useTranslation();

	const { message: messageApi } = AntdApp.useApp();

	const navigate = useNavigate();
	
	// 從 AuthStore 取得使用者資訊與密碼過期控制 (符合規範 g, i)
	const currentUserSession = useAuthStore(
		(state) => state.user
	);
	
	// 擴充型別讀取與切換密碼過期狀態之輔助 Action (符合規範 g)
	const isPasswordExpiredStatus = currentUserSession?.mustChangePassword || false; // 須先變更密碼（新帳號／管理員重設／密碼過期）

	/**
	 * 函數名稱: setPasswordExpired
	 * 函數功能: 更新 AuthStore 中使用者密碼過期之狀態標記。
	 * 
	 * 輸入參數 (Input):
	 *   - isExpired (boolean): 是否設定為過期 (true/false)
	 * 返回值 (Return): void
	 */
	const setPasswordExpired = (isExpired: boolean): void => 
	{
		useAuthStore.setState(
			(currentStoreState) => 
			(
				{
					user: currentStoreState.user ? { ...currentStoreState.user, mustChangePassword: isExpired } : null
				}
			)
		);
	};

	// 從 UIStore 讀取全域主題狀態 (符合規範 g, i)
	const isDarkModeActive = useUIStore(
		(state) => state.isDarkMode
	);

	// Form 實例與異步加載狀態宣告 (符合規範 g)
	const [passwordFormInstance] = Form.useForm();

	const [isSubmitting, setIsSubmitting] = useState<boolean>(false); // 表單更新加載中狀態開關

	// 即時監聽新密碼輸入框數值變化 (符合規範 g)
	const newPasswordInputValueString = Form.useWatch('newPassword', passwordFormInstance);

	/**
	 * 函數名稱: calculateStrength
	 * 函數功能: 依據密碼長度、字元複雜度 (大小寫/數字/符號)、記憶性及扣分懲罰規則，計算即時密碼強度分數。
	 * 
	 * 輸入參數 (Input):
	 *   - passwordString (string | undefined): 當前新密碼輸入框之字串數值
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): 
	 *   - calculatedScore (number): 0 ~ 100 之密碼強度分數
	 */
	const calculateStrength = (passwordString?: string): number => 
	{
		if (!passwordString) 
		{
			return 0;
		}

		let calculatedScore = 0;

		// 1. 長度計分 (Length Score)
		if (passwordString.length >= BASE_PASSWORD_LENGTH_THRESHOLD) 
		{
			calculatedScore += 20 + Math.min(40, (passwordString.length - BASE_PASSWORD_LENGTH_THRESHOLD) * 5); 
		}

		// 2. 複雜度計分 (Complexity Score)
		let characterComplexityCount = 0; // 字元種類計數 (小寫/大寫/數字/符號)

		if (/[a-z]/.test(passwordString)) 
		{
			characterComplexityCount++;
		}

		if (/[A-Z]/.test(passwordString)) 
		{
			characterComplexityCount++;
		}

		if (/\d/.test(passwordString)) 
		{
			characterComplexityCount++;
		}

		if (/[@$!%*?&#\-_+=]/.test(passwordString)) 
		{
			characterComplexityCount++;
		}
		
		calculatedScore += characterComplexityCount * 10; 

		// 3. 易記性獎勵 (Memorability Bonus)
		if (passwordString.length >= HIGH_MEMORABILITY_LENGTH_THRESHOLD) 
		{
			calculatedScore += 15;
		}

		// 4. 常見弱密碼與連續字元扣分防護 (Penalty)
		if (/(p[a@4][s$5]{2}w[o0]rd|admin|qwerty|12345)/i.test(passwordString)) 
		{
			calculatedScore -= 50; 
		}

		if (/(0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)/.test(passwordString)) 
		{
			calculatedScore -= 30;
		}

		if (/(qwer|asdf|zxcv|1q2w|qaz)/i.test(passwordString)) 
		{
			calculatedScore -= 30;
		}

		if (/(.)\1{2,}/.test(passwordString)) 
		{
			calculatedScore -= 20;
		}

		return Math.max(0, Math.min(100, calculatedScore));
	};

	// 即時計算當前密碼強度得分 (符合規範 g)
	const currentPasswordStrengthScore = calculateStrength(newPasswordInputValueString);

	/**
	 * 函數名稱: getStrengthColor
	 * 函數功能: 依據密碼強度分數，映射回傳對應之主題顏色色碼 (紅/黃/綠)。
	 * 
	 * 輸入參數 (Input):
	 *   - scoreValue (number): 密碼強度分數 (0 ~ 100)
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): 
	 *   - string: 十六進制色彩碼 (如 '#ff4d4f')
	 */
	const getStrengthColor = (scoreValue: number): string => 
	{
		if (scoreValue <= WEAK_STRENGTH_SCORE_THRESHOLD) 
		{
			return '#ff4d4f'; // 紅色 (弱)
		}

		if (scoreValue <= MEDIUM_STRENGTH_SCORE_THRESHOLD) 
		{
			return '#faad14'; // 橘色 (中)
		}

		return '#52c41a';     // 綠色 (強)
	};

	/**
	 * 函數名稱: getStrengthLabel
	 * 函數功能: 依據密碼強度分數，映射回傳多國語系之強度說明標籤字串 (弱/中/強)。
	 * 
	 * 輸入參數 (Input):
	 *   - scoreValue (number): 密碼強度分數 (0 ~ 100)
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): 
	 *   - string: 語系化強度標籤文字
	 */
	const getStrengthLabel = (scoreValue: number): string => 
	{
		if (!newPasswordInputValueString) 
		{
			return '';
		}

		if (scoreValue <= WEAK_STRENGTH_SCORE_THRESHOLD) 
		{
			return translate('profile.strength_weak', '弱 (Weak)');
		}

		if (scoreValue <= MEDIUM_STRENGTH_SCORE_THRESHOLD) 
		{
			return translate('profile.strength_medium', '中 (Medium)');
		}

		return translate('profile.strength_strong', '強 (Strong)');
	};

	/**
	 * 函數名稱: handleUpdatePassword
	 * 函數功能: 處理變更密碼表單提交，模擬異步 API 更新流程，成功後重置表單並於密碼過期狀態下引導回首頁。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 */
	const handleUpdatePassword = (): void => 
	{
		// ★ 2026-10-07：改為實際驗證「目前密碼」並寫入帳號資料庫 (useAccountStore)
		const passwordFormValuesObj = passwordFormInstance.getFieldsValue() as { oldPassword?: string; newPassword?: string };
		setIsSubmitting(true);

		setTimeout(
			() => 
			{
				setIsSubmitting(false);

				const changeResult = useAccountStore.getState().changeOwnPassword(
					currentUserSession?.email || '', passwordFormValuesObj.oldPassword || '', passwordFormValuesObj.newPassword || ''
				);

				if (!changeResult.ok)
				{
					if (changeResult.reason === 'wrong_password')
					{
						passwordFormInstance.setFields([{ name: 'oldPassword', errors: [translate('profile.wrong_current_password', '目前密碼不正確')] }]);
					}
					else if (changeResult.reason === 'same_password')
					{
						passwordFormInstance.setFields([{ name: 'newPassword', errors: [translate('profile.same_password', '新密碼不可與目前密碼相同')] }]);
					}
					else
					{
						messageApi.error(translate('profile.account_not_found', '找不到此帳號的資料，請重新登入後再試。'));
					}
					logSystemEvent('WARN', '變更密碼失敗（目前密碼錯誤或新舊密碼相同）', currentUserSession?.name || 'System');
					return;
				}

				logSystemEvent('INFO', '使用者自行變更密碼', currentUserSession?.name || 'System');

				messageApi.success(
					translate('profile.password_changed', '密碼已成功變更！請妥善保管新密碼。')
				);

				passwordFormInstance.resetFields();

				if (isPasswordExpiredStatus) 
				{
					setPasswordExpired(false);

					navigate('/', { replace: true });
				}
			}, 
			PASSWORD_UPDATE_SIMULATION_DELAY_MS
		);
	};

	return (
		<div style={{ maxWidth: '600px', margin: '40px auto', padding: '0 24px' }}>
			<Card
				title={
					<Space>
						<UserOutlined style={{ color: token.colorPrimary }} />
						<span style={{ fontSize: scaleFontSize(18), fontWeight: 'bold' }}>
							{translate('profile.title', '個人資料與安全設定')}
						</span>
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
				{/* 密碼過期強制提示 Banner */}
				{isPasswordExpiredStatus && (
					<Alert
						type="error"
						showIcon
						message={translate('profile.password_expired_title', '密碼已過期')}
						description={translate('profile.password_expired_banner', '您必須設定一組符合安全規範的新密碼，才能繼續使用 Privacy Toolkit 專案空間。')}
						style={{ marginBottom: '24px', border: '1px solid #ffa39e' }}
					/>
				)}

				{/* 基本資料區塊 */}
				<div style={{ marginBottom: '24px' }}>
					<Title level={5} style={{ marginBottom: '16px', color: token.colorText }}>
						{translate('profile.info_title', '基本資料')}
					</Title>

					<div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
						<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
							<Text type="secondary" style={{ width: '80px' }}>{translate('profile.name', '使用者名稱')}:</Text>
							<Text strong>{currentUserSession?.name}</Text>
						</div>

						<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
							<Text type="secondary" style={{ width: '80px' }}>{translate('profile.email', 'Email')}:</Text>
							<Text>{currentUserSession?.email}</Text>
						</div>

						<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
							<Text type="secondary" style={{ width: '80px' }}>{translate('profile.role', '系統角色')}:</Text>
							<Tag color={currentUserSession?.role === 'admin' ? 'purple' : 'blue'} style={{ margin: 0 }}>
								{getRoleDisplayName(currentUserSession?.role)}
							</Tag>
						</div>
					</div>
				</div>

				<Divider dashed style={{ borderColor: token.colorBorderSecondary }} />

				{/* 變更密碼區塊 */}
				<div>
					<Title level={5} style={{ marginBottom: '16px', color: token.colorText }}>
						<Space>
							<LockOutlined />
							{translate('profile.change_password', '變更密碼')}
						</Space>
					</Title>
					
					<Form
						form={passwordFormInstance}
						layout="vertical"
						onFinish={handleUpdatePassword}
						requiredMark="optional"
					>
						{/* 目前密碼 */}
						<Form.Item
							name="oldPassword"
							label={translate('profile.old_password', '目前密碼')}
							rules={[{ required: true, message: translate('profile.require_old_password', '請輸入目前密碼') }]}
						>
							<Input.Password placeholder={translate('profile.ph_old_password', '請輸入原密碼')} size="large" />
						</Form.Item>

						{/* 新密碼及強度提示 */}
						<Form.Item
							name="newPassword"
							label={translate('profile.new_password', '新密碼')}
							extra={
								<div style={{ marginTop: 8 }}>
									{newPasswordInputValueString && (
										<div style={{ marginBottom: 8 }}>
											<Progress 
												percent={currentPasswordStrengthScore} 
												showInfo={false} 
												strokeColor={getStrengthColor(currentPasswordStrengthScore)} 
												size="small" 
												style={{ marginBottom: 4 }}
											/>

											<div style={{ display: 'flex', justifyContent: 'space-between' }}>
												<Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>{translate('profile.password_strength', '密碼強度')}</Text>
												<Text style={{ fontSize: scaleFontSize(12), fontWeight: 'bold', color: getStrengthColor(currentPasswordStrengthScore) }}>
													{getStrengthLabel(currentPasswordStrengthScore)}
												</Text>
											</div>
										</div>
									)}

									<div style={{ fontSize: scaleFontSize(12), color: token.colorTextSecondary, display: 'flex', flexDirection: 'column', gap: '4px' }}>
										<Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>
											{translate('profile.password_hint_1', '• 長度與複雜度：目標至少 12 個字元，並交織大小寫、數字及符號。')}
										</Text>

										<Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>
											{translate('profile.password_hint_2', '• 易記性：建議使用對您有意義的「長句助記詞」(如生動的單字組合)。')}
										</Text>

										<Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>
											{translate('profile.password_hint_3', '• 獨特性：請確保此密碼為本系統專屬，勿與其他平台共用。')}
										</Text>
									</div>
								</div>
							}
							rules={
								[
									{ required: true, message: translate('profile.require_new_password', '請輸入新密碼') },
									{ min: MIN_PASSWORD_LENGTH_LIMIT, message: translate('profile.password_min_length', '密碼長度至少需要 12 個字元') }, 
									{
										pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#\-_+=])[A-Za-z\d@$!%*?&#\-_+=]+$/, 
										message: translate('profile.password_complexity', '密碼強度不足：需包含大小寫字母、數字及特殊符號 (如 @$!%*?&#)')
									},
									({ getFieldValue }) => (
										{
											validator(_, targetInputPasswordValue) 
											{
												if (targetInputPasswordValue && getFieldValue('oldPassword') === targetInputPasswordValue) 
												{
													return Promise.reject(
														new Error(translate('profile.password_same_as_old', '新密碼不能與目前密碼相同！'))
													);
												}

												return Promise.resolve();
											},
										}
									),
								]
							}
							hasFeedback
						>
							<Input.Password placeholder={translate('profile.ph_new_password', '至少 12 個字元')} size="large" />
						</Form.Item>

						{/* 確認新密碼 */}
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
											validator(_, targetConfirmPasswordValue) 
											{
												if (!targetConfirmPasswordValue || getFieldValue('newPassword') === targetConfirmPasswordValue) 
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

						{/* 提交按鈕 */}
						<Form.Item style={{ marginTop: '32px', marginBottom: 0 }}>
							<Button 
								type="primary" 
								htmlType="submit" 
								loading={isSubmitting} 
								icon={<SaveOutlined />} 
								size="large" 
								block
							>
								{translate('profile.btn_save_password', '更新密碼')}
							</Button>
						</Form.Item>
					</Form>
				</div>
			</Card>
		</div>
	);
}