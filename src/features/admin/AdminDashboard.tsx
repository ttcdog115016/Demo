import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Button, Space, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { 
  DesktopOutlined, 
  WarningOutlined, 
  TeamOutlined, 
  RightOutlined 
} from '@ant-design/icons';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isDarkMode = theme.useToken().token.colorBgContainer !== '#ffffff';
  
  const colors = {
    bgCard: isDarkMode ? '#1e1e2f' : '#ffffff',
    border: isDarkMode ? '#2d2d34' : '#f0f0f0',
    textMain: isDarkMode ? '#ffffff' : '#1f1f1f',
    textMuted: isDarkMode ? '#aaaaaa' : '#8c8c8c',
  };

  return (
    <div style={{ padding: '12px' }}>
      <h2 style={{ color: colors.textMain, marginBottom: '8px', fontSize: '24px' }}>
        {t('admin.dashboard_title', '系統管理大廳 (Admin Dashboard)')}
      </h2>
      <p style={{ color: colors.textMuted, marginBottom: '24px' }}>
        {t('admin.dashboard_desc', '您目前以 Admin 身份登入。基於職責分離 (SoD) 原則，此介面不參與前台業務資料操作。以下為系統基礎設施健康狀態與資安概覽。')}
      </p>
      
      <Row gutter={[24, 24]}>
        <Col xs={24} md={8}>
          <Card className="v-card-style" style={{ borderRadius: '12px', height: '100%', background: colors.bgCard, borderColor: colors.border }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ color: colors.textMuted, fontSize: '14px' }}>
                {t('admin.uptime', '伺服器運行時間 (Uptime)')}
              </div>
              <div style={{ color: colors.textMain, fontSize: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <DesktopOutlined style={{ color: '#52c41a' }} />
                <span>99.99%</span>
              </div>
            </div>
            <div style={{ marginTop: '12px', color: colors.textMuted, fontSize: '13px' }}>
              {t('admin.uptime_desc', '連續運行 45 天 12 小時')}
            </div>
          </Card>
        </Col>
        
        <Col xs={24} md={8}>
          <Card className="v-card-style" style={{ borderRadius: '12px', height: '100%', background: colors.bgCard, borderColor: colors.border }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ color: colors.textMuted, fontSize: '14px' }}>
                {t('admin.failed_logins', '24H 異常登入嘗試')}
              </div>
              <div style={{ color: '#faad14', fontSize: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <WarningOutlined />
                <span>3</span>
              </div>
            </div>
            <div style={{ marginTop: '12px', color: colors.textMuted, fontSize: '13px' }}>
              {t('admin.failed_logins_desc', '來自 2 個不同的外部 IP')}
            </div>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card className="v-card-style" style={{ borderRadius: '12px', height: '100%', background: colors.bgCard, borderColor: colors.border }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ color: colors.textMuted, fontSize: '14px' }}>
                {t('admin.active_users', '活躍使用者 (Active Users)')}
              </div>
              <div style={{ color: colors.textMain, fontSize: '24px', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <TeamOutlined style={{ color: '#1890ff', alignSelf: 'center' }} />
                <span>2</span>
                <span style={{ fontSize: '16px' }}>/ 12</span>
              </div>
            </div>
            <div style={{ marginTop: '12px', color: colors.textMuted, fontSize: '13px' }}>
              {t('admin.active_users_desc', '目前線上：Admin.Test, Data.Owner.A')}
            </div>
          </Card>
        </Col>
      </Row>

      <Card className="v-card-style" style={{ marginTop: '24px', borderRadius: '12px', background: colors.bgCard, borderColor: colors.border }} title={t('admin.quick_actions', '快速管理動作 (Quick Actions)')}>
        <Space size="middle" wrap>
          <Button type="primary" size="large" onClick={() => navigate('/settings/preferences?tab=users')} style={{ borderRadius: '8px' }}>
            {t('admin.btn_manage_users', '前往帳號與權限管理')} <RightOutlined />
          </Button>
          <Button size="large" onClick={() => navigate('/settings/preferences?tab=syslogs')} style={{ borderRadius: '8px' }}>
            {t('admin.btn_view_logs', '檢視系統維運日誌')} <RightOutlined />
          </Button>
        </Space>
      </Card>
    </div>
  );
}