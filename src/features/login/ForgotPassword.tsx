import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, ConfigProvider, theme, message } from 'antd';
import { Shield, Mail, ArrowLeft, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// 🌟 1. 改為引入拆分後的 UIStore 讀取主題狀態
import { useUIStore } from '../../store/useUIStore';

// 🌟 2. 定義表單數值介面，消滅 any
interface ResetPasswordValues {
  email: string;
}

export default function ForgotPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  
  // 🌟 3. 從 UIStore 讀取全域主題
  const isDarkMode = useUIStore((state) => state.isDarkMode);

  // 🌟 4. 重設密碼邏輯 (正確標註 ResetPasswordValues 型別)
  const handleResetPassword = (values: ResetPasswordValues) => {
    setIsLoading(true);
    
    setTimeout(() => {
      setIsLoading(false);
      message.success(t('message.reset_email_sent', '密碼重設信件已發送至 {{email}}，請至信箱收取！', { email: values.email }));
      setTimeout(() => navigate('/login'), 1500);
    }, 1200);
  };

  return (
    <ConfigProvider theme={{ algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: '#3f51b5' } }}>
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: isDarkMode ? '#121214' : '#f1f5f9', padding: '16px', transition: 'all 0.3s'
      }}>
        <Card
          style={{
            width: '100%', maxWidth: 440, 
            backgroundColor: isDarkMode ? '#1a1a1e' : '#ffffff',
            border: `1px solid ${isDarkMode ? '#2d2d34' : '#e2e8f0'}`, 
            boxShadow: isDarkMode ? '0 12px 40px rgba(0,0,0,0.5)' : '0 12px 32px rgba(0,0,0,0.08)', 
            borderRadius: 16, transition: 'all 0.3s'
          }}
          styles={{ body: { padding: '40px' } }}
        >
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ 
                width: 48, height: 48, borderRadius: 12, 
                background: isDarkMode ? 'rgba(63, 81, 181, 0.1)' : 'rgba(63, 81, 181, 0.08)', 
                display: 'flex', alignItems: 'center', justifyContent: 'center', 
                border: '1px solid rgba(63, 81, 181, 0.2)' 
              }}>
                <Shield color="#3f51b5" size={24} />
              </div>
            </div>
            <h2 style={{ color: isDarkMode ? '#e2e8f0' : '#334155', fontSize: 20, fontWeight: 500, margin: '0 0 8px 0' }}>
              {t('forgot_password.title', '忘記密碼？')}
            </h2>
            <p style={{ color: isDarkMode ? '#94a3b8' : '#64748b', margin: 0, fontSize: 14 }}>
              {t('forgot_password.subtitle', '請輸入您註冊時的電子郵件，我們將發送重設密碼的連結給您。')}
            </p>
          </div>

          <Form layout="vertical" onFinish={handleResetPassword} size="large">
            <Form.Item
              label={<span style={{ color: isDarkMode ? '#e2e8f0' : '#334155' }}>{t('common.email', '電子郵件')}</span>}
              name="email"
              rules={[{ required: true, type: 'email', message: t('validation.invalid_email', '請輸入有效的電子郵件！') }]}
            >
              <Input 
                prefix={<Mail size={18} color={isDarkMode ? "#94a3b8" : "#64748b"} style={{ marginRight: 8 }}/>} 
                placeholder={t('placeholder.email', '請輸入您的電子郵件')} 
                style={{ 
                  backgroundColor: isDarkMode ? '#0f1015' : '#ffffff', 
                  borderColor: isDarkMode ? '#2d2d34' : '#cbd5e1', 
                  color: isDarkMode ? '#fff' : '#0f172a' 
                }} 
              />
            </Form.Item>

            <Form.Item style={{ marginTop: 32, marginBottom: 16 }}>
              <Button type="primary" htmlType="submit" block loading={isLoading} icon={!isLoading && <Send size={18} />} style={{ height: 44, borderRadius: 8, fontWeight: 'bold' }}>
                {t('forgot_password.submit', '發送重設連結')}
              </Button>
            </Form.Item>

            <Button type="text" block onClick={() => navigate('/login')} icon={<ArrowLeft size={16} />} style={{ color: isDarkMode ? '#94a3b8' : '#64748b', height: 44 }}>
              {t('common.back_to_login', '返回登入')}
            </Button>
          </Form>
        </Card>
      </div>
    </ConfigProvider>
  );
}