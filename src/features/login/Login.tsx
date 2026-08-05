import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Checkbox, ConfigProvider, theme, App as AntdApp } from 'antd';
import { Mail, Lock, LogIn, Zap } from 'lucide-react';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import { useTranslation } from 'react-i18next';

// 🌟 本地雙語字典
const labels = {
  zh: {
    welcome: '歡迎回來',
    subtitle: '請登入您的帳號以繼續使用隱私強化工具包',
    emailLabel: '電子郵件 / 帳號',
    emailRequired: '請輸入電子郵件！',
    emailPlaceholder: '請輸入您的電子郵件',
    passwordLabel: '密碼',
    passwordRequired: '請輸入密碼！',
    passwordPlaceholder: '請輸入您的密碼',
    rememberMe: '保持登入狀態',
    forgotPassword: '忘記密碼？',
    submitBtn: '登入系統',
    quickLoginBtn: '⚡ 一鍵快速登入 (測試用)',
    noAccount: '還沒有帳號？',
    requestAccess: '申請使用權限',
    loginSuccess: '登入成功！正在為您準備工作區...',
    quickSuccess: '⚡ 快速登入成功！',
    loginError: '登入失敗，請檢查您的電子郵件與密碼。',
    networkError: '無法連線至伺服器，請稍後再試。'
  },
  en: {
    welcome: 'Welcome Back',
    subtitle: 'Please log in to continue using Privacy Toolkit',
    emailLabel: 'Email / Username',
    emailRequired: 'Please enter your email!',
    emailPlaceholder: 'Enter your email',
    passwordLabel: 'Password',
    passwordRequired: 'Please enter your password!',
    passwordPlaceholder: 'Enter your password',
    rememberMe: 'Remember me',
    forgotPassword: 'Forgot password?',
    submitBtn: 'Log In',
    quickLoginBtn: '⚡ One-Click Quick Login',
    noAccount: "Don't have an account?",
    requestAccess: 'Request Access',
    loginSuccess: 'Login successful! Preparing workspace...',
    quickSuccess: '⚡ Quick login successful!',
    loginError: 'Login failed. Please check your credentials.',
    networkError: 'Network error. Please try again later.'
  }
};

export default function Login() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  
  // 🌟 讀取全局的主題模式 state
  const isDarkMode = usePrivacyStore((state) => state.isDarkMode);
  const login = usePrivacyStore((state) => state.login);
  const [isLoading, setIsLoading] = useState(false);

  const { message } = AntdApp.useApp();

  // 判斷當前語言
  const isZh = i18n.language?.toLowerCase().startsWith('zh');
  const text = isZh ? labels.zh : labels.en;

  // 一般登入邏輯 (串接真實 API)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleLogin = async (values: any) => {
    setIsLoading(true);
    
    try {
      // 模擬發送 API 請求到後端驗證端點 (請替換為您真實的 API 路徑)
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          remember: values.remember
        }),
      });

      // 解析後端回傳的 JSON 資料 (防呆處理，避免後端未回傳 JSON 導致錯誤)
      const data = await response.json().catch(() => ({}));

      // 判斷 HTTP 狀態碼是否為成功
      if (response.ok) {
        // 登入成功：將後端回傳的使用者資訊寫入 Store
        const userName = data?.user?.name || values.email?.split('@')[0] || 'User';
        login({ name: userName, email: values.email });
        
        message.success(text.loginSuccess);
        
        // 成功後跳轉至首頁，並使用 replace 避免按上一頁退回登入頁
        setTimeout(() => navigate('/', { replace: true }), 500);
      } else {
        // 登入失敗：顯示後端自訂錯誤，或顯示預設錯誤訊息
        message.error(data?.message || text.loginError);
      }
    } catch (error) {
      // 處理網路錯誤 (例如伺服器無回應、CORS 錯誤等)
      console.error('Login Error:', error);
      message.error(text.networkError);
    } finally {
      // 無論成功或失敗，關閉 Loading 狀態
      setIsLoading(false);
    }
  };

  // ⚡ 快速登入邏輯 (免帳密)
  const handleQuickLogin = () => {
    login({ name: 'Admin.Test', email: 'admin@test.com' });
    message.success(text.quickSuccess);
    // 🌟 加上極短延遲，確保 Store 狀態同步後再跳轉
    setTimeout(() => {
      navigate('/', { replace: true });
    }, 100);
  };

  return (
    <ConfigProvider 
      theme={{ 
        // 🌟 動態跟隨系統主主題：淺色模式用 defaultAlgorithm，深色用 darkAlgorithm
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: '#3f51b5' }
      }}
    >
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // 🌟 動態背景色彩
        backgroundColor: isDarkMode ? '#121214' : '#f1f5f9',
        padding: '16px',
        transition: 'all 0.3s'
      }}>
        <Card
          style={{
            width: '100%',
            maxWidth: 440,
            // 🌟 動態卡片背景與邊框
            backgroundColor: isDarkMode ? '#1a1a1e' : '#ffffff',
            border: `1px solid ${isDarkMode ? '#2d2d34' : '#e2e8f0'}`,
            boxShadow: isDarkMode ? '0 12px 40px rgba(0,0,0,0.5)' : '0 12px 32px rgba(0,0,0,0.08)',
            borderRadius: 16,
            transition: 'all 0.3s'
          }}
          styles={{ body: { padding: '40px' } }}
        >
          {/* 標題與 Logo 區塊 */}
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 16 }}>

              {/* 🌟 Logo 區塊：可自行替換為公司 Logo 或 App Icon * /}
              {/* <div style={{ 
                width: 48, height: 48, 
                borderRadius: 12, 
                background: isDarkMode ? 'rgba(63, 81, 181, 0.1)' : 'rgba(63, 81, 181, 0.08)', 
                display: 'flex', alignItems: 'center', justifyContent: 'center', 
                border: '1px solid rgba(63, 81, 181, 0.2)' 
              }}>
                <Shield color="#3f51b5" size={24} />
              </div> */}
              <h1 style={{ color: isDarkMode ? '#fff' : '#1e293b', fontSize: 24, fontWeight: 'bold', margin: 0, letterSpacing: 1 }}>
                PRIVACY APP
              </h1>
            </div>
            <h2 style={{ color: isDarkMode ? '#e2e8f0' : '#334155', fontSize: 20, fontWeight: 500, margin: '0 0 8px 0' }}>
              {text.welcome}
            </h2>
            <p style={{ color: isDarkMode ? '#94a3b8' : '#64748b', margin: 0, fontSize: 14 }}>
              {text.subtitle}
            </p>
          </div>

          {/* 表單區塊 */}
          <Form
            layout="vertical"
            onFinish={handleLogin}
            initialValues={{ remember: true }}
            size="large"
          >
            <Form.Item
              label={<span style={{ color: isDarkMode ? '#e2e8f0' : '#334155' }}>{text.emailLabel}</span>}
              name="email"
              rules={[{ required: true, message: text.emailRequired }]}
            >
              <Input 
                prefix={<Mail size={18} color={isDarkMode ? "#94a3b8" : "#64748b"} style={{ marginRight: 8 }}/>} 
                placeholder={text.emailPlaceholder} 
                style={{ 
                  backgroundColor: isDarkMode ? '#0f1015' : '#ffffff', 
                  borderColor: isDarkMode ? '#2d2d34' : '#cbd5e1', 
                  color: isDarkMode ? '#fff' : '#0f172a' 
                }} 
              />
            </Form.Item>

            <Form.Item
              label={<span style={{ color: isDarkMode ? '#e2e8f0' : '#334155' }}>{text.passwordLabel}</span>}
              name="password"
              rules={[{ required: true, message: text.passwordRequired }]}
              style={{ marginBottom: 16 }}
            >
              <Input.Password 
                prefix={<Lock size={18} color={isDarkMode ? "#94a3b8" : "#64748b"} style={{ marginRight: 8 }}/>} 
                placeholder={text.passwordPlaceholder} 
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
                  {text.rememberMe}
                </Checkbox>
              </Form.Item>
              <span onClick={() => navigate('/forgot-password')} style={{ color: '#3f51b5', fontSize: 14, cursor: 'pointer' }}>
                {text.forgotPassword}
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
                {text.submitBtn}
              </Button>
            </Form.Item>

            {/* 快速登入按鈕 */}
            <Form.Item style={{ marginBottom: 0 }}>
              <Button 
                type="default" 
                block 
                onClick={handleQuickLogin} 
                icon={<Zap size={18} />} 
                style={{ 
                  height: 44, 
                  borderRadius: 8, 
                  borderColor: '#3f51b5', 
                  color: '#3f51b5', 
                  background: 'transparent',
                  fontWeight: 'bold'
                }}
              >
                {text.quickLoginBtn}
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
            {text.noAccount}{' '}
            <span onClick={() => navigate('/request-access')} style={{ color: '#3f51b5', fontWeight: 'bold', cursor: 'pointer' }}>
              {text.requestAccess}
            </span>
          </div>
        </Card>
      </div>
    </ConfigProvider>
  );
}