import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, ConfigProvider, theme, message } from 'antd';
import { Shield, Mail, User, ArrowLeft, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// 🌟 1. 改為引入拆分後的 UIStore 讀取主題狀態
import { useUIStore } from '../../store/useUIStore';

// 🌟 2. 定義表單欄位型別，消滅 any
interface RequestAccessValues {
  name: string;
  email: string;
  reason: string;
}

export default function RequestAccess() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  
  // 🌟 3. 從 UIStore 讀取全域主題
  const isDarkMode = useUIStore((state) => state.isDarkMode);

  // 🌟 4. 權限申請提交邏輯 (標註正確型別)
  const handleRequest = (values: RequestAccessValues) => {
    setIsLoading(true);
    
    setTimeout(() => {
      setIsLoading(false);
      message.success(t('message.request_sent', '申請已送出！系統管理員將會審核 {{name}} 的存取權限。', { name: values.name }));
      setTimeout(() => navigate('/login'), 2000);
    }, 1500);
  };

  return (
    <ConfigProvider theme={{ algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: '#3f51b5' } }}>
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: isDarkMode ? '#121214' : '#f1f5f9', padding: '16px', transition: 'all 0.3s'
      }}>
        <Card
          style={{
            width: '100%', maxWidth: 480, 
            backgroundColor: isDarkMode ? '#1a1a1e' : '#ffffff',
            border: `1px solid ${isDarkMode ? '#2d2d34' : '#e2e8f0'}`, 
            boxShadow: isDarkMode ? '0 12px 40px rgba(0,0,0,0.5)' : '0 12px 32px rgba(0,0,0,0.08)', 
            borderRadius: 16, transition: 'all 0.3s'
          }}
          styles={{ body: { padding: '40px' } }}
        >
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
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
              {t('request_access.title', '申請使用權限')}
            </h2>
            <p style={{ color: isDarkMode ? '#94a3b8' : '#64748b', margin: 0, fontSize: 14 }}>
              {t('request_access.subtitle', '請填寫您的資料，管理員審核通過後將發送通知信。')}
            </p>
          </div>

          <Form layout="vertical" onFinish={handleRequest} size="large">
            <Form.Item 
              label={<span style={{ color: isDarkMode ? '#e2e8f0' : '#334155' }}>{t('common.real_name', '真實姓名')}</span>} 
              name="name" 
              rules={[{ required: true, message: t('validation.real_name_required', '請輸入真實姓名！') }]}
            >
              <Input 
                prefix={<User size={18} color={isDarkMode ? "#94a3b8" : "#64748b"} style={{ marginRight: 8 }}/>} 
                placeholder={t('placeholder.real_name', '例如：張小明')} 
                style={{ 
                  backgroundColor: isDarkMode ? '#0f1015' : '#ffffff', 
                  borderColor: isDarkMode ? '#2d2d34' : '#cbd5e1', 
                  color: isDarkMode ? '#fff' : '#0f172a' 
                }} 
              />
            </Form.Item>

            <Form.Item 
              label={<span style={{ color: isDarkMode ? '#e2e8f0' : '#334155' }}>{t('common.company_email', '公司電子郵件')}</span>} 
              name="email" 
              rules={[{ required: true, type: 'email', message: t('validation.invalid_email', '請輸入有效的電子郵件！') }]}
            >
              <Input 
                prefix={<Mail size={18} color={isDarkMode ? "#94a3b8" : "#64748b"} style={{ marginRight: 8 }}/>} 
                placeholder={t('placeholder.company_email', 'name@company.com')} 
                style={{ 
                  backgroundColor: isDarkMode ? '#0f1015' : '#ffffff', 
                  borderColor: isDarkMode ? '#2d2d34' : '#cbd5e1', 
                  color: isDarkMode ? '#fff' : '#0f172a' 
                }} 
              />
            </Form.Item>

            <Form.Item 
              label={<span style={{ color: isDarkMode ? '#e2e8f0' : '#334155' }}>{t('common.department_reason', '部門 / 申請原因')}</span>} 
              name="reason" 
              rules={[{ required: true, message: t('validation.reason_required', '請填寫您的部門或申請原因！') }]}
            >
              <Input.TextArea 
                placeholder={t('placeholder.reason', '請簡述您所屬部門及為何需要使用隱私強化工具包...')} 
                autoSize={{ minRows: 3, maxRows: 5 }} 
                style={{ 
                  backgroundColor: isDarkMode ? '#0f1015' : '#ffffff', 
                  borderColor: isDarkMode ? '#2d2d34' : '#cbd5e1', 
                  color: isDarkMode ? '#fff' : '#0f172a' 
                }} 
              />
            </Form.Item>

            <Form.Item style={{ marginTop: 8, marginBottom: 16 }}>
              <Button type="primary" htmlType="submit" block loading={isLoading} icon={!isLoading && <Send size={18} />} style={{ height: 44, borderRadius: 8, fontWeight: 'bold' }}>
                {t('request_access.submit', '送出申請')}
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