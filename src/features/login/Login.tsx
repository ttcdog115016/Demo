import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Checkbox, ConfigProvider, theme, App as AntdApp, Alert } from 'antd';
import { Mail, Lock, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// 🌟 1. 改為引入拆分後的新 Stores
import { useAuthStore } from '../../store/useAuthStore';
import { useUIStore } from '../../store/useUIStore';

// 🌟 2. 定義登入表單欄位型別，消滅 any
interface LoginFormValues {
  email?: string;
  password?: string;
  remember?: boolean;
}

// 模擬帳號庫 (Mock Backend - 僅保留 Data Owner)
const DEMO_ACCOUNTS = {
  'owner@test.com': { password: 'password', name: 'Data.Owner.A', role: 'data_owner' as const }
};

export default function Login() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm<LoginFormValues>();
  
  // 🌟 3. 從 UIStore 讀取全域主題，從 AuthStore 讀取登入邏輯
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  const login = useAuthStore((state) => state.login);
  const [isLoading, setIsLoading] = useState(false);

  const { message } = AntdApp.useApp();

  // 判斷當前語言
  const isZh = i18n.language?.toLowerCase().startsWith('zh');

  // 🌟 4. 一般登入邏輯 (正確標註 LoginFormValues 型別，不用 any)
  const handleLogin = async (values: LoginFormValues) => {
    setIsLoading(true);
    
    try {
      // 模擬發送 API 請求到後端的網路延遲 (800ms)
      await new Promise(resolve => setTimeout(resolve, 800));

      // 驗證帳號密碼
      const accountKey = values.email as keyof typeof DEMO_ACCOUNTS;
      const account = DEMO_ACCOUNTS[accountKey];

      if (account && values.password === account.password) {
        // 登入成功：將使用者資訊寫入 AuthStore
        login({ name: account.name, email: values.email || '', role: 'data_owner' });
        
        message.success(t('login.success'));
        
        // 成功後跳轉至首頁
        setTimeout(() => navigate('/', { replace: true }), 500);
      } else {
        message.error(t('login.error'));
      }
    } catch (error) {
      console.error('Login Error:', error);
      message.error(t('login.networkError'));
    } finally {
      setIsLoading(false);
    }
  };

  // ⚡ 快速登入邏輯 (免帳密)
  const handleQuickLogin = () => {
    login({ name: 'Data.Owner.A', email: 'owner@test.com', role: 'data_owner' });
    message.success(t('login.quickSuccess'));
    
    setTimeout(() => {
      navigate('/', { replace: true });
    }, 100);
  };

  // 自動填入表單
  const fillDemoAccount = (email: keyof typeof DEMO_ACCOUNTS) => {
    form.setFieldsValue({ email, password: DEMO_ACCOUNTS[email].password });
  };

  return (
    <ConfigProvider 
      theme={{ 
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: '#3f51b5' }
      }}
    >
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isDarkMode ? '#121214' : '#f1f5f9',
        padding: '16px',
        transition: 'all 0.3s'
      }}>
        <Card
          style={{
            width: '100%',
            maxWidth: 440,
            backgroundColor: isDarkMode ? '#1a1a1e' : '#ffffff',
            border: `1px solid ${isDarkMode ? '#2d2d34' : '#e2e8f0'}`,
            boxShadow: isDarkMode ? '0 12px 40px rgba(0,0,0,0.5)' : '0 12px 32px rgba(0,0,0,0.08)',
            borderRadius: 16,
            transition: 'all 0.3s'
          }}
          styles={{ body: { padding: '40px' } }}
        >
          {/* 標題與 Logo 區塊 */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <h1 style={{ color: isDarkMode ? '#fff' : '#1e293b', fontSize: 24, fontWeight: 'bold', margin: 0, letterSpacing: 1 }}>
                PRIVACY APP
              </h1>
            </div>
            <h2 style={{ color: isDarkMode ? '#e2e8f0' : '#334155', fontSize: 20, fontWeight: 500, margin: '0 0 8px 0' }}>
              {t('login.welcome')}
            </h2>
            <p style={{ color: isDarkMode ? '#94a3b8' : '#64748b', margin: 0, fontSize: 14 }}>
              {t('login.subtitle')}
            </p>
          </div>

          {/* Demo 測試帳號提示區 (點擊可自動填入) */}
          <Alert
            message={<span style={{ fontSize: 13, fontWeight: 'bold' }}>{isZh ? 'Demo 測試帳號 (點擊自動填入)' : 'Demo Account (Click to fill)'}</span>}
            description={
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <div onClick={() => fillDemoAccount('owner@test.com')} style={{ cursor: 'pointer', color: '#10b981' }}>
                  Data Owner: <b>owner@test.com</b> / <b>password</b>
                </div>
              </div>
            }
            type="success"
            showIcon
            style={{ 
              marginBottom: 24, 
              backgroundColor: isDarkMode ? 'rgba(16, 185, 129, 0.1)' : '#d1fae5', 
              borderColor: isDarkMode ? 'rgba(16, 185, 129, 0.3)' : '#a7f3d0' 
            }}
          />

          {/* 表單區塊 */}
          <Form
            form={form}
            layout="vertical"
            onFinish={handleLogin}
            initialValues={{ remember: true }}
            size="large"
          >
            <Form.Item
              label={<span style={{ color: isDarkMode ? '#e2e8f0' : '#334155' }}>{t('login.emailLabel')}</span>}
              name="email"
              rules={[{ required: true, message: t('login.emailRequired') }]}
            >
              <Input 
                prefix={<Mail size={18} color={isDarkMode ? "#94a3b8" : "#64748b"} style={{ marginRight: 8 }}/>} 
                placeholder={t('login.emailPlaceholder')} 
                style={{ 
                  backgroundColor: isDarkMode ? '#0f1015' : '#ffffff', 
                  borderColor: isDarkMode ? '#2d2d34' : '#cbd5e1', 
                  color: isDarkMode ? '#fff' : '#0f172a' 
                }} 
              />
            </Form.Item>

            <Form.Item
              label={<span style={{ color: isDarkMode ? '#e2e8f0' : '#334155' }}>{t('login.passwordLabel')}</span>}
              name="password"
              rules={[{ required: true, message: t('login.passwordRequired') }]}
              style={{ marginBottom: 16 }}
            >
              <Input.Password 
                prefix={<Lock size={18} color={isDarkMode ? "#94a3b8" : "#64748b"} style={{ marginRight: 8 }}/>} 
                placeholder={t('login.passwordPlaceholder')} 
                style={{ 
                  backgroundColor: isDarkMode ? '#0f1015' : '#ffffff', 
                  borderColor: isDarkMode ? '#2d2d34' : '#cbd5e1', 
                  color: isDarkMode ? '#fff' : '#0f172a' 
                }} 
              />
            </Form.Item>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                  {t('login.rememberMe')}
                </Checkbox>
              </Form.Item>
              <span onClick={() => navigate('/forgot-password')} style={{ color: '#3f51b5', fontSize: 14, cursor: 'pointer' }}>
                {t('login.forgotPassword')}
              </span>
            </div>

            {/* 標準登入按鈕 */}
            <Form.Item style={{ marginBottom: 16 }}>
              <Button 
                type="primary" 
                htmlType="submit" 
                block 
                loading={isLoading} 
                icon={!isLoading && <LogIn size={18} />} 
                style={{ height: 44, borderRadius: 8, fontWeight: 'bold' }}
              >
                {t('login.submitBtn')}
              </Button>
            </Form.Item>

            {/* 快速登入按鈕 */}
            <Form.Item style={{ marginBottom: 0 }}>
              <Button 
                type="default" 
                block 
                onClick={handleQuickLogin}  
                style={{ 
                  height: 44, 
                  borderRadius: 8, 
                  borderColor: '#10b981', 
                  color: '#10b981', 
                  background: 'transparent',
                  fontWeight: 'bold'
                }}
              >
                {t('login.quickLoginBtn')}
              </Button>
            </Form.Item>
          </Form>

          {/* 底部提示 */}
          <div style={{ 
            textAlign: 'center', 
            marginTop: 24, 
            paddingTop: 24, 
            borderTop: `1px solid ${isDarkMode ? '#2d2d34' : '#e2e8f0'}`, 
            color: isDarkMode ? '#94a3b8' : '#64748b', 
            fontSize: 14 
          }}>
            {t('login.noAccount')}{' '}
            <span onClick={() => navigate('/request-access')} style={{ color: '#3f51b5', fontWeight: 'bold', cursor: 'pointer' }}>
              {t('login.requestAccess')}
            </span>
          </div>
        </Card>
      </div>
    </ConfigProvider>
  );
}