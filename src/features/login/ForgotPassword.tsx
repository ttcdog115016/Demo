import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, ConfigProvider, theme, message } from 'antd';
import { Shield, Mail, ArrowLeft, Send } from 'lucide-react';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleResetPassword = (values: any) => {
    setIsLoading(true);
    
    // 模擬 API 延遲
    setTimeout(() => {
      setIsLoading(false);
      message.success(`密碼重設信件已發送至 ${values.email}，請至信箱收取！`);
      setTimeout(() => navigate('/login'), 1500);
    }, 1200);
  };

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#3f51b5' } }}>
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#121214', padding: '16px'
      }}>
        <Card
          style={{
            width: '100%', maxWidth: 440, backgroundColor: '#1a1a1e',
            border: '1px solid #2d2d34', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', borderRadius: 16
          }}
          styles={{ body: { padding: '40px' } }}
        >
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ 
                width: 48, height: 48, borderRadius: 12, background: 'rgba(63, 81, 181, 0.1)', 
                display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(63, 81, 181, 0.2)' 
              }}>
                <Shield color="#3f51b5" size={24} />
              </div>
            </div>
            <h2 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 500, margin: '0 0 8px 0' }}>忘記密碼？</h2>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>請輸入您註冊時的電子郵件，我們將發送重設密碼的連結給您。</p>
          </div>

          <Form layout="vertical" onFinish={handleResetPassword} size="large">
            <Form.Item
              label={<span style={{ color: '#e2e8f0' }}>電子郵件</span>}
              name="email"
              rules={[{ required: true, type: 'email', message: '請輸入有效的電子郵件！' }]}
            >
              <Input 
                prefix={<Mail size={18} color="#94a3b8" style={{ marginRight: 8 }}/>} 
                placeholder="請輸入您的電子郵件" 
                style={{ backgroundColor: '#0f1015', borderColor: '#2d2d34', color: '#fff' }} 
              />
            </Form.Item>

            <Form.Item style={{ marginTop: 32, marginBottom: 16 }}>
              <Button type="primary" htmlType="submit" block loading={isLoading} icon={!isLoading && <Send size={18} />} style={{ height: 44, borderRadius: 8, fontWeight: 'bold' }}>
                發送重設連結
              </Button>
            </Form.Item>

            <Button type="text" block onClick={() => navigate('/login')} icon={<ArrowLeft size={16} />} style={{ color: '#94a3b8', height: 44 }}>
              返回登入
            </Button>
          </Form>
        </Card>
      </div>
    </ConfigProvider>
  );
}