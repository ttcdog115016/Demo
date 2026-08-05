import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, ConfigProvider, theme, message } from 'antd';
import { Shield, Mail, User, ArrowLeft, Send } from 'lucide-react';

export default function RequestAccess() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleRequest = (values: any) => {
    setIsLoading(true);
    
    setTimeout(() => {
      setIsLoading(false);
      message.success(`申請已送出！系統管理員將會審核 ${values.name} 的存取權限。`);
      setTimeout(() => navigate('/login'), 2000);
    }, 1500);
  };

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#3f51b5' } }}>
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#121214', padding: '16px'
      }}>
        <Card
          style={{
            width: '100%', maxWidth: 480, backgroundColor: '#1a1a1e',
            border: '1px solid #2d2d34', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', borderRadius: 16
          }}
          styles={{ body: { padding: '40px' } }}
        >
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ 
                width: 48, height: 48, borderRadius: 12, background: 'rgba(63, 81, 181, 0.1)', 
                display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(63, 81, 181, 0.2)' 
              }}>
                <Shield color="#3f51b5" size={24} />
              </div>
            </div>
            <h2 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 500, margin: '0 0 8px 0' }}>申請使用權限</h2>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>請填寫您的資料，管理員審核通過後將發送通知信。</p>
          </div>

          <Form layout="vertical" onFinish={handleRequest} size="large">
            <Form.Item label={<span style={{ color: '#e2e8f0' }}>真實姓名</span>} name="name" rules={[{ required: true, message: '請輸入真實姓名！' }]}>
              <Input prefix={<User size={18} color="#94a3b8" style={{ marginRight: 8 }}/>} placeholder="例如：張小明" style={{ backgroundColor: '#0f1015', borderColor: '#2d2d34', color: '#fff' }} />
            </Form.Item>

            <Form.Item label={<span style={{ color: '#e2e8f0' }}>公司電子郵件</span>} name="email" rules={[{ required: true, type: 'email', message: '請輸入有效的電子郵件！' }]}>
              <Input prefix={<Mail size={18} color="#94a3b8" style={{ marginRight: 8 }}/>} placeholder="name@company.com" style={{ backgroundColor: '#0f1015', borderColor: '#2d2d34', color: '#fff' }} />
            </Form.Item>

            <Form.Item label={<span style={{ color: '#e2e8f0' }}>部門 / 申請原因</span>} name="reason" rules={[{ required: true, message: '請填寫您的部門或申請原因！' }]}>
              <Input.TextArea placeholder="請簡述您所屬部門及為何需要使用隱私強化工具包..." autoSize={{ minRows: 3, maxRows: 5 }} style={{ backgroundColor: '#0f1015', borderColor: '#2d2d34', color: '#fff' }} />
            </Form.Item>

            <Form.Item style={{ marginTop: 8, marginBottom: 16 }}>
              <Button type="primary" htmlType="submit" block loading={isLoading} icon={!isLoading && <Send size={18} />} style={{ height: 44, borderRadius: 8, fontWeight: 'bold' }}>
                送出申請
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