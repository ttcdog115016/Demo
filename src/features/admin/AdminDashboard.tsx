import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Button, Switch, InputNumber, App as AntdApp, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { 
  DesktopOutlined, 
  WarningOutlined, 
  TeamOutlined, 
  RightOutlined,
  SettingOutlined,
  SafetyOutlined
} from '@ant-design/icons';

// 🌟 改為引入拆分後的新 Stores
import { useUIStore } from '../../store/useUIStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

// 擴充 Workspace Store 中的安全設定介面
interface ExtendedWorkspaceSecurity {
  sessionTimeout?: number;
  maxFailedLogins?: number;
  isMaintenanceMode?: boolean;
  enablePasswordExpiry?: boolean;
  passwordExpiryDays?: number;
  updateSecuritySettings?: (settings: {
    sessionTimeout: number;
    maxFailedLogins: number;
    isMaintenanceMode: boolean;
    enablePasswordExpiry: boolean;
    passwordExpiryDays: number;
  }) => void;
}

export default function AdminDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  
  // 🌟 從 UIStore 讀取主題狀態
  const isDarkMode = useUIStore((state) => state.isDarkMode);

  // 🌟 從 WorkspaceStore 讀取安全參數 (使用安全轉型)
  const storeState = useWorkspaceStore((state) => state as unknown as ExtendedWorkspaceSecurity);
  const sessionTimeout = storeState.sessionTimeout || 15;
  const maxFailedLogins = storeState.maxFailedLogins || 5;
  const isMaintenanceMode = storeState.isMaintenanceMode || false;
  const enablePasswordExpiry = storeState.enablePasswordExpiry !== false;
  const passwordExpiryDays = storeState.passwordExpiryDays || 90;

  const updateSecuritySettings = storeState.updateSecuritySettings || ((settings) => {
    useWorkspaceStore.setState(settings as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
  });

  const colors = {
    bgCard: isDarkMode ? '#1e1e2f' : '#ffffff',
    border: isDarkMode ? '#2d2d34' : '#f0f0f0',
    textMain: isDarkMode ? '#ffffff' : '#1f1f1f',
    textMuted: isDarkMode ? '#aaaaaa' : '#8c8c8c',
  };

  // 處理開關切換
  const handleExpiryToggle = (checked: boolean) => {
    updateSecuritySettings({
      sessionTimeout, 
      maxFailedLogins, 
      isMaintenanceMode,
      passwordExpiryDays,
      enablePasswordExpiry: checked
    });
    message.success(t('admin.setting_updated', '安全性設定已成功更新！'));
  };

  // 處理天數變更
  const handleDaysChange = (value: number | null) => {
    if (value) {
      updateSecuritySettings({
        sessionTimeout, 
        maxFailedLogins, 
        isMaintenanceMode, 
        enablePasswordExpiry,
        passwordExpiryDays: value
      });
      message.success(t('admin.setting_updated', '安全性設定已成功更新！'));
    }
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

      {/* 密碼安全政策快速控管區塊 */}
      <Card 
        className="v-card-style" 
        style={{ marginTop: '24px', borderRadius: '12px', background: colors.bgCard, borderColor: colors.border }}
        title={
          <Space>
            <SafetyOutlined style={{ color: '#52c41a' }} />
            <span style={{ color: colors.textMain }}>{t('admin.password_policy_title', '密碼安全政策快速控管')}</span>
          </Space>
        }
      >
        <Row gutter={[24, 24]} align="middle">
          <Col xs={24} md={12}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: colors.textMain, fontWeight: 500, marginBottom: '4px' }}>
                  {t('admin.enable_expiry', '強制密碼過期輪替')}
                </div>
                <div style={{ color: colors.textMuted, fontSize: '12px' }}>
                  {t('admin.enable_expiry_desc', '開啟後，所有帳號必須在設定的週期內變更密碼。')}
                </div>
              </div>
              <Switch 
                checked={enablePasswordExpiry} 
                onChange={handleExpiryToggle} 
              />
            </div>
          </Col>
          
          <Col xs={24} md={12}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: enablePasswordExpiry ? 1 : 0.4, pointerEvents: enablePasswordExpiry ? 'auto' : 'none', transition: 'all 0.3s' }}>
              <div>
                <div style={{ color: colors.textMain, fontWeight: 500, marginBottom: '4px' }}>
                  {t('admin.expiry_days', '密碼有效天數')}
                </div>
                <div style={{ color: colors.textMuted, fontSize: '12px' }}>
                  {t('admin.expiry_days_desc', '建議企業內部安全規範設定為 90 天。')}
                </div>
              </div>
              <Space>
                <InputNumber 
                  min={1} 
                  max={365} 
                  value={passwordExpiryDays} 
                  onChange={handleDaysChange}
                  disabled={!enablePasswordExpiry}
                  style={{ width: '100px' }}
                />
                <span style={{ color: colors.textMuted }}>{t('admin.days', '天')}</span>
              </Space>
            </div>
          </Col>
        </Row>
      </Card>

      {/* 單一入口橫幅 */}
      <Card 
        className="v-card-style" 
        style={{ marginTop: '24px', borderRadius: '12px', background: colors.bgCard, borderColor: colors.border }} 
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h3 style={{ margin: 0, color: colors.textMain, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <SettingOutlined style={{ color: '#1890ff' }} />
              {t('admin.console_entry_title', '系統偏好與後台管理 (Admin Console)')}
            </h3>
            <p style={{ margin: '8px 0 0 0', color: colors.textMuted, fontSize: '14px' }}>
              {t('admin.console_entry_desc', '集中管理使用者帳號、檢視系統維運日誌，並設定連線逾時與維護模式等全域安全參數。')}
            </p>
          </div>
          <Button 
            type="primary" 
            size="large" 
            onClick={() => navigate('/settings/preferences')} 
            style={{ borderRadius: '8px', minWidth: '180px' }}
          >
            {t('admin.btn_enter_console', '進入後台管理中心')} <RightOutlined />
          </Button>
        </div>
      </Card>
    </div>
  );
}