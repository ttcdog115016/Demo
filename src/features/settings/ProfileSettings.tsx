import { useState } from 'react';
import { Card, Form, Input, Button, Typography, Space, Divider, Tag, theme, App as AntdApp } from 'antd';
import { UserOutlined, LockOutlined, SaveOutlined } from '@ant-design/icons';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

export default function ProfileSettings() {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  
  const user = usePrivacyStore((state) => state.user);
  const isDarkMode = usePrivacyStore((state) => state.isDarkMode);

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // 模擬發送 API 變更密碼
  const handleUpdatePassword = () => {
    setLoading(true);
    
    // 模擬網路延遲
    setTimeout(() => {
      setLoading(false);
      message.success(t('profile.password_changed', '密碼已成功變更！請妥善保管新密碼。'));
      form.resetFields(); // 清空密碼欄位
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
              rules={[
                { required: true, message: t('profile.require_new_password', '請輸入新密碼') },
                { min: 8, message: t('profile.password_min_length', '密碼長度至少需要 8 個字元') }
              ]}
              hasFeedback
            >
              <Input.Password placeholder={t('profile.ph_new_password', '至少 8 個字元')} size="large" />
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