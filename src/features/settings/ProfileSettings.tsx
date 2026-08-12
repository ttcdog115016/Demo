import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, Space, Divider, Tag, theme, App as AntdApp, Progress, Alert } from 'antd';
import { UserOutlined, LockOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

// 🌟 1. 改為引入拆分後的新 Stores
import { useAuthStore } from '../../store/useAuthStore';
import { useUIStore } from '../../store/useUIStore';

const { Title, Text } = Typography;

export default function ProfileSettings() {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  
  // 🌟 2. 從 AuthStore 取得使用者資訊與密碼過期控制
  const user = useAuthStore((state) => state.user);
  
  // 擴充型別讀取（若 AuthStore 中未顯式定義變數）
  const isPasswordExpired = (user as unknown as { isPasswordExpired?: boolean })?.isPasswordExpired || false;
  const setPasswordExpired = (expired: boolean) => {
    useAuthStore.setState((state) => ({
      user: state.user ? { ...state.user, isPasswordExpired: expired } as typeof state.user : null
    }));
  };

  // 🌟 3. 從 UIStore 取得全域主題
  const isDarkMode = useUIStore((state) => state.isDarkMode);

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // 監聽新密碼欄位的變化
  const newPasswordValue = Form.useWatch('newPassword', form);

  // 密碼強度計算邏輯 (滿分 100)
  const calculateStrength = (pwd?: string) => {
    if (!pwd) return 0;
    let score = 0;

    // 1. 長度 (Length)
    if (pwd.length >= 8) {
      score += 20 + Math.min(40, (pwd.length - 8) * 5); 
    }

    // 2. 複雜度 (Complexity)
    let complexityCount = 0;
    if (/[a-z]/.test(pwd)) complexityCount++;
    if (/[A-Z]/.test(pwd)) complexityCount++;
    if (/\d/.test(pwd)) complexityCount++;
    if (/[@$!%*?&#\-_+=]/.test(pwd)) complexityCount++;
    
    score += complexityCount * 10; 

    // 3. 易記性 (Memorability)
    if (pwd.length >= 16) {
      score += 15;
    }

    // 4. 扣分防護 (Penalty)
    if (/(p[a@4][s$5]{2}w[o0]rd|admin|qwerty|12345)/i.test(pwd)) {
      score -= 50; 
    }
    if (/(0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)/.test(pwd)) {
      score -= 30;
    }
    if (/(qwer|asdf|zxcv|1q2w|qaz)/i.test(pwd)) {
      score -= 30;
    }
    if (/(.)\1{2,}/.test(pwd)) {
      score -= 20;
    }

    return Math.max(0, Math.min(100, score));
  };
  const strengthScore = calculateStrength(newPasswordValue);

  // 根據分數決定顏色
  const getStrengthColor = (score: number) => {
    if (score <= 40) return '#ff4d4f'; // 紅色 (弱)
    if (score <= 80) return '#faad14'; // 橘色 (中)
    return '#52c41a'; // 綠色 (強)
  };

  // 根據分數決定顯示文字
  const getStrengthLabel = (score: number) => {
    if (!newPasswordValue) return '';
    if (score <= 40) return t('profile.strength_weak', '弱 (Weak)');
    if (score <= 80) return t('profile.strength_medium', '中 (Medium)');
    return t('profile.strength_strong', '強 (Strong)');
  };

  // 模擬發送 API 變更密碼
  const handleUpdatePassword = () => {
    setLoading(true);
    
    setTimeout(() => {
      setLoading(false);
      message.success(t('profile.password_changed', '密碼已成功變更！請妥善保管新密碼。'));
      form.resetFields();

      if (isPasswordExpired) {
        setPasswordExpired(false);
        navigate('/', { replace: true });
      }
    }, 1000);
  };

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '0 24px' }}>
      <Card
        title={
          <Space>
            <UserOutlined style={{ color: token.colorPrimary }} />
            <span style={{ fontSize: '18px', fontWeight: 'bold' }}>
              {t('profile.title', '個人資料與安全設定')}
            </span>
          </Space>
        }
        variant="borderless"
        style={{
          background: token.colorBgContainer,
          boxShadow: isDarkMode ? 'none' : '0 4px 20px rgba(0,0,0,0.05)',
          borderRadius: '12px',
          border: isDarkMode ? `1px solid ${token.colorBorderSecondary}` : 'none'
        }}
      >
        {/* 密碼過期強制提示 Banner */}
        {isPasswordExpired && (
          <Alert
            type="error"
            showIcon
            message={t('profile.password_expired_title', '密碼已過期')}
            description={t('profile.password_expired_banner', '您必須設定一組符合安全規範的新密碼，才能繼續使用 Privacy Toolkit 專案空間。')}
            style={{ marginBottom: '24px', border: '1px solid #ffa39e' }}
          />
        )}

        {/* ================= 基本資料區塊 ================= */}
        <div style={{ marginBottom: '24px' }}>
          <Title level={5} style={{ marginBottom: '16px', color: token.colorText }}>
            {t('profile.info_title', '基本資料')}
          </Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Text type="secondary" style={{ width: '80px' }}>{t('profile.name', '使用者名稱')}:</Text>
              <Text strong>{user?.name}</Text>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Text type="secondary" style={{ width: '80px' }}>{t('profile.email', 'Email')}:</Text>
              <Text>{user?.email}</Text>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Text type="secondary" style={{ width: '80px' }}>{t('profile.role', '系統角色')}:</Text>
              <Tag color={user?.role === 'admin' ? 'purple' : 'blue'} style={{ margin: 0 }}>
                {user?.role === 'admin' ? 'Admin (系統管理員)' : 'Data Owner (資料擁有者)'}
              </Tag>
            </div>
          </div>
        </div>

        <Divider dashed style={{ borderColor: token.colorBorderSecondary }} />

        {/* ================= 變更密碼區塊 ================= */}
        <div>
          <Title level={5} style={{ marginBottom: '16px', color: token.colorText }}>
            <Space>
              <LockOutlined />
              {t('profile.change_password', '變更密碼')}
            </Space>
          </Title>
          
          <Form
            form={form}
            layout="vertical"
            onFinish={handleUpdatePassword}
            requiredMark="optional"
          >
            <Form.Item
              name="oldPassword"
              label={t('profile.old_password', '目前密碼')}
              rules={[{ required: true, message: t('profile.require_old_password', '請輸入目前密碼') }]}
            >
              <Input.Password placeholder={t('profile.ph_old_password', '請輸入原密碼')} size="large" />
            </Form.Item>

            <Form.Item
              name="newPassword"
              label={t('profile.new_password', '新密碼')}
              extra={
                <div style={{ marginTop: 8 }}>
                  {newPasswordValue && (
                    <div style={{ marginBottom: 8 }}>
                      <Progress 
                        percent={strengthScore} 
                        showInfo={false} 
                        strokeColor={getStrengthColor(strengthScore)} 
                        size="small" 
                        style={{ marginBottom: 4 }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: '12px' }}>{t('profile.password_strength', '密碼強度')}</Text>
                        <Text style={{ fontSize: '12px', fontWeight: 'bold', color: getStrengthColor(strengthScore) }}>
                          {getStrengthLabel(strengthScore)}
                        </Text>
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: '12px', color: token.colorTextSecondary, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      {t('profile.password_hint_1', '• 長度與複雜度：目標至少 12 個字元，並交織大小寫、數字及符號。')}
                    </Text>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      {t('profile.password_hint_2', '• 易記性：建議使用對您有意義的「長句助記詞」(如生動的單字組合)。')}
                    </Text>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      {t('profile.password_hint_3', '• 獨特性：請確保此密碼為本系統專屬，勿與其他平台共用。')}
                    </Text>
                  </div>
                </div>
              }
              rules={[
                { required: true, message: t('profile.require_new_password', '請輸入新密碼') },
                { min: 12, message: t('profile.password_min_length', '密碼長度至少需要 12 個字元') }, 
                {
                  pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#\-_+=])[A-Za-z\d@$!%*?&#\-_+=]{12,}$/, 
                  message: t('profile.password_complexity', '密碼強度不足：需包含大小寫字母、數字及特殊符號 (如 @$!%*?&#)')
                },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (value && getFieldValue('oldPassword') === value) {
                      return Promise.reject(new Error(t('profile.password_same_as_old', '新密碼不能與目前密碼相同！')));
                    }
                    return Promise.resolve();
                  },
                }),
              ]}
              hasFeedback
            >
              <Input.Password placeholder={t('profile.ph_new_password', '至少 12 個字元')} size="large" />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label={t('profile.confirm_password', '確認新密碼')}
              dependencies={['newPassword']}
              hasFeedback
              rules={[
                { required: true, message: t('profile.require_confirm_password', '請再次輸入新密碼') },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error(t('profile.password_mismatch', '兩次輸入的密碼不一致！')));
                  },
                }),
              ]}
            >
              <Input.Password placeholder={t('profile.ph_confirm_password', '請再次確認新密碼')} size="large" />
            </Form.Item>

            <Form.Item style={{ marginTop: '32px', marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={loading} icon={<SaveOutlined />} size="large" block>
                {t('profile.btn_save_password', '更新密碼')}
              </Button>
            </Form.Item>
          </Form>
        </div>
      </Card>
    </div>
  );
}