/**
 * ============================================================================
 * 檔案名稱 (File): ProfileSettings.tsx
 * 模組功能 (Description): 個人資料與安全設定頁面組件 (提供使用者檢視帳號資訊、強密碼變更與即時強度評估)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useState } from 'react';
import { Card, Form, Input, Button, Typography, Space, Divider, Tag, theme, App as AntdApp, Progress } from 'antd';
import { UserOutlined, LockOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../store/useAuthStore';
import { changeOwnPassword, toMemberApiError } from '../../api/authApi';
import { logSystemEvent } from '../../store/useSystemLogStore';
import { getRoleDisplayName } from '../../utils/roleLabel';
import { useUIStore } from '../../store/useUIStore';

import { scaleFontSize } from '../../utils/fontScale';
import { calculatePasswordStrength, toStrengthBarPercent, PASSWORD_STRENGTH_WEAK_MAX, PASSWORD_STRENGTH_MEDIUM_MAX } from '../../utils/passwordStrength';
const { Title, Text } = Typography;

/**
 * 密碼強度評估與長度常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const MIN_PASSWORD_LENGTH_LIMIT = 12;

/**
 * 函數名稱: ProfileSettings
 * 函數功能: 渲染個人資料與安全設定視圖，包含帳號資訊卡片、動態密碼強度計算器與密碼變更表單。
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

	// 從 AuthStore 取得使用者資訊 (符合規範 g, i)
	const currentUserSession = useAuthStore(
		(state) => state.user
	);
	
	// 從 UIStore 讀取全域主題狀態 (符合規範 g, i)
	const isDarkModeActive = useUIStore(
		(state) => state.isDarkMode
	);

	// Form 實例與異步加載狀態宣告 (符合規範 g)
	const [passwordFormInstance] = Form.useForm();

	const [isSubmitting, setIsSubmitting] = useState<boolean>(false); // 表單更新加載中狀態開關

	// 即時監聽新密碼輸入框數值變化 (符合規範 g)
	const newPasswordInputValueString = Form.useWatch('newPassword', passwordFormInstance);

	// 即時計算當前密碼強度得分 (符合規範 g)
	// ★ 2026-10-29：評分移至 utils/passwordStrength.ts（修正連續數字重複扣分到 0 分、強度條整條空白）
	const currentPasswordStrengthResult = calculatePasswordStrength(newPasswordInputValueString);
	const currentPasswordStrengthScore = currentPasswordStrengthResult.score;

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
		if (scoreValue <= PASSWORD_STRENGTH_WEAK_MAX) 
		{
			return '#ff4d4f'; // 紅色 (弱)
		}

		if (scoreValue <= PASSWORD_STRENGTH_MEDIUM_MAX) 
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

		if (scoreValue <= PASSWORD_STRENGTH_WEAK_MAX) 
		{
			return translate('profile.strength_weak', '弱 (Weak)');
		}

		if (scoreValue <= PASSWORD_STRENGTH_MEDIUM_MAX) 
		{
			return translate('profile.strength_medium', '中 (Medium)');
		}

		return translate('profile.strength_strong', '強 (Strong)');
	};

	/**
	 * 函數名稱: handleUpdatePassword
	 * 函數功能: 處理變更密碼表單提交，呼叫後端變更密碼，成功後重置表單。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): Promise<void>
	 */
	const handleUpdatePassword = async (): Promise<void> => 
	{
		// ★ 2026-10-27：改呼叫後端 PATCH /api/v1/auth/password（須帶目前密碼）；後端以 401 表示目前密碼不正確
		const passwordFormValuesObj = passwordFormInstance.getFieldsValue() as { oldPassword?: string; newPassword?: string };
		const operatorNameString = currentUserSession?.name || 'System';
		if ((passwordFormValuesObj.oldPassword || '') === (passwordFormValuesObj.newPassword || ''))
		{
			passwordFormInstance.setFields([{ name: 'newPassword', errors: [translate('profile.same_password', '新密碼不可與目前密碼相同')] }]);
			return;
		}
		setIsSubmitting(true);
		try
		{
			await changeOwnPassword(passwordFormValuesObj.oldPassword || '', passwordFormValuesObj.newPassword || '');
		}
		catch (changeErrorValue)
		{
			const memberErrorObj = toMemberApiError(changeErrorValue);
			if (memberErrorObj.status === 401 && memberErrorObj.errorCode === 'ERR_UNAUTHORIZED')
			{
				passwordFormInstance.setFields([{ name: 'oldPassword', errors: [translate('profile.wrong_current_password', '目前密碼不正確')] }]);
				logSystemEvent('WARN', '變更密碼失敗（目前密碼錯誤）', operatorNameString);
			}
			else
			{
				messageApi.error(memberErrorObj.message);
				logSystemEvent('ERROR', `變更密碼失敗：${memberErrorObj.message}`, operatorNameString);
			}
			return;
		}
		finally
		{
			setIsSubmitting(false);
		}

		logSystemEvent('INFO', '使用者自行變更密碼', operatorNameString);

		messageApi.success(
			translate('profile.password_changed', '密碼已成功變更！請妥善保管新密碼。')
		);

		passwordFormInstance.resetFields();
	};

	return (
		<div style={{ maxWidth: '43em', margin: '40px auto', padding: '0 24px' }}>
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
				{/* 基本資料區塊 */}
				<div style={{ marginBottom: '24px' }}>
					<Title level={5} style={{ marginBottom: '16px', color: token.colorText }}>
						{translate('profile.info_title', '基本資料')}
					</Title>

					<div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
						{/* ★ 2026-10-27：後端只有帳號（帳號即 Email），不另顯示使用者名稱 */}
						<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
							<Text type="secondary" style={{ width: '5.5em' }}>{translate('profile.account', '帳號')}:</Text>
							<Text strong>{currentUserSession?.email}</Text>
						</div>

						<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
							<Text type="secondary" style={{ width: '5.5em' }}>{translate('profile.role', '系統角色')}:</Text>
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
												percent={toStrengthBarPercent(currentPasswordStrengthResult)} 
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

											{/* ★ 2026-10-29：未達「強」時列出原因，讓使用者知道怎麼改 */}
											{currentPasswordStrengthResult.level !== 'strong' && currentPasswordStrengthResult.issues.length > 0 && (
												<div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
													{currentPasswordStrengthResult.issues.map((issueCode) => (
														<Text key={issueCode} style={{ fontSize: scaleFontSize(12), color: getStrengthColor(currentPasswordStrengthScore) }}>
															{'• ' + translate(`profile.strength_issue_${issueCode}`, {
																too_short: '長度未達 12 個字元',
																missing_types: '未同時包含大寫、小寫、數字與符號',
																common_word: '含常見弱密碼字詞（如 password、admin、qwerty）',
																sequential_digits: '含連續數字（如 1234、9876）',
																keyboard_sequence: '含鍵盤連續按鍵（如 qwer、asdf）',
																repeated_chars: '含連續 3 個以上相同字元（如 aaa、111）',
															}[issueCode])}
														</Text>
													))}
												</div>
											)}
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
										pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/, // ★ 2026-10-29：不再限定可用字元（空白、句點等也可當特殊符號），後端只檢查長度 ≥ 12
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