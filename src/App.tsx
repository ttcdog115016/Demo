import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useSearchParams, Outlet } from 'react-router-dom';
import { 
  ConfigProvider, theme, Layout, Menu, Avatar, Badge, 
  App as AntdApp, Dropdown, Tag, Segmented 
} from 'antd'; 
import { useTranslation } from 'react-i18next';

import zhTW from 'antd/locale/zh_TW';
import enUS from 'antd/locale/en_US';
import type { MenuProps } from 'antd';
import { 
  SafetyCertificateOutlined, 
  FileTextOutlined, 
  SettingOutlined, 
  PieChartOutlined, 
  DownloadOutlined,
  UserOutlined,
  BellOutlined,
  LogoutOutlined,
  UserSwitchOutlined,
  AuditOutlined,
  DashboardOutlined
} from '@ant-design/icons';

import { usePrivacyStore } from './store/usePrivacyStore';
import type { UserRole } from './store/usePrivacyStore';
import Login from './features/login/Login';
import ForgotPassword from './features/login/ForgotPassword';
import RequestAccess from './features/login/RequestAccess';
import ProfileSettings from './features/settings/ProfileSettings';
import SystemPreferences from './features/settings/SystemPreferences';
import AuditLogHub from './features/audit_logs/AuditLogHub';
import AdminDashboard from './features/admin/AdminDashboard';
import MainLayout from './features/workspace/MainLayout';
import { validateProgression } from './features/workspace/validateProgression';
import { useIdleTimeout } from './features/settings/useIdleTimeout';

const { Header, Content, Sider } = Layout;

// ==========================================
// 🛡️ 路由防護元件 (Route Guards)
// ==========================================
const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = usePrivacyStore((state) => state.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const RBACGuard = ({ allowedRoles, redirectPath }: { allowedRoles: UserRole[], redirectPath: string }) => {
  const user = usePrivacyStore((state) => state.user);
  const { message } = AntdApp.useApp();
  const { t } = useTranslation();
  const currentRole = user?.role || 'data_owner';

  useEffect(() => {
    if (!allowedRoles.includes(currentRole)) {
      message.error(t('message.role_blocked', '權限不足：您目前的角色無法存取該頁面，已將您導回專屬工作區。'));
    }
  }, [currentRole, allowedRoles, message, t]);

  if (!allowedRoles.includes(currentRole)) {
    return <Navigate to={redirectPath} replace />;
  }
  return <Outlet />; 
};

const RoleBasedRedirect = () => {
  const user = usePrivacyStore((state) => state.user);
  return user?.role === 'admin' 
    ? <Navigate to="/admin" replace /> 
    : <Navigate to="/workspace?step=1" replace />; 
};

// ==========================================
// 🖥️ 主版面配置 (App Shell)
// ==========================================
function InnerApp({ isDarkMode }: { isDarkMode: boolean }) {
  const { t } = useTranslation(); 
  const navigate = useNavigate();
  const location = useLocation();
  const { message: appMessage, modal } = AntdApp.useApp();

  const sessionTimeout = usePrivacyStore((state) => state.sessionTimeout);
  useIdleTimeout(sessionTimeout);

  const [searchParams] = useSearchParams();
  const stepParam = searchParams.get('step');

  const currentStep = usePrivacyStore((state) => state.currentStep);
  const user = usePrivacyStore((state) => state.user);
  const setUserRole = usePrivacyStore((state) => state.setUserRole);
  const logout = usePrivacyStore((state) => state.logout);
  const isMaintenanceMode = usePrivacyStore((state) => state.isMaintenanceMode);

  const currentUserRole = user?.role || 'admin';

  useEffect(() => {
    if (isMaintenanceMode && currentUserRole === 'data_owner') {
      modal.warning({
        title: t('admin.maintenance_active_title', '系統維護中'),
        content: t('admin.maintenance_active_desc', '系統已進入維護模式，僅允許管理員存取。您即將被強制登出。'),
        okText: t('modal.confirm', '確認'),
        onOk: () => {
          logout();
          navigate('/login');
        }
      });
    }
  }, [isMaintenanceMode, currentUserRole, logout, modal, navigate, t]);

  useEffect(() => {
    if (location.pathname === '/workspace') {
      if (stepParam !== null) {
        const urlStep = Number(stepParam) - 1; 
        const storeState = usePrivacyStore.getState();
        const currentStoreStep = storeState.currentStep;

        if (urlStep >= 0 && urlStep <= 3 && urlStep !== currentStoreStep) {
          if (urlStep > currentStoreStep) {
            const errorMsg = validateProgression(urlStep, currentStoreStep, storeState, t);
            if (errorMsg) {
              appMessage.error(errorMsg); 
              navigate(`/workspace?step=${currentStoreStep + 1}`, { replace: true }); 
              return;
            }
          }

          usePrivacyStore.setState({ currentStep: urlStep });
        } else if (urlStep < 0 || urlStep > 3) {
            navigate(`/workspace?step=${currentStoreStep + 1}`, { replace: true });
        }
      } else {
        navigate(`/workspace?step=${usePrivacyStore.getState().currentStep + 1}`, { replace: true });
      }
    }
  }, [stepParam, location.pathname, navigate, appMessage, t]);

  const [collapsed, setCollapsed] = useState(false);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const rawNotifications = [
    { id: '1', key: 'notification.update' },
    { id: '2', key: 'notification.approval' },
    { id: '3', key: 'notification.import_done' },
  ];

  const unreadCount = rawNotifications.filter(n => !readNotifications.includes(n.id)).length;

  const handleLogoutConfirm = () => {
    modal.confirm({
      title: t('modal.logout_title', '確認登出'),
      content: t('modal.logout_content', '您確定要登出系統嗎？'),
      okText: t('modal.confirm_logout', '確認登出'),
      okType: 'danger',
      cancelText: t('modal.cancel', '取消'),
      onOk: () => {
        logout();
        appMessage.success(t('message.logout_success', '已成功登出'));
      }
    });
  };

  const notificationItems: MenuProps['items'] = rawNotifications.length > 0 
    ? rawNotifications.map(n => {
        const isRead = readNotifications.includes(n.id);
        return {
          key: n.id,
          label: (
            <div style={{ fontWeight: isRead ? 'normal' : 'bold', color: isRead ? '#8c8c8c' : 'inherit', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {!isRead && <span style={{ color: '#f5222d', fontSize: '12px' }}>●</span>}
              {t(n.key)}
            </div>
          ),
        };
      })
    : [{ key: 'empty', label: t('notification.empty', '目前沒有新通知'), disabled: true }];

  if (unreadCount > 0) {
    notificationItems.push({ type: 'divider' });
    notificationItems.push({ key: 'read_all', label: t('notification.mark_all_read', '標示為已讀'), style: { textAlign: 'center', color: '#3f51b5', fontWeight: 'bold' } });
  }

  const notificationMenu: MenuProps = {
    items: notificationItems,
    onClick: (e) => {
      if (e.key === 'read_all') {
        setReadNotifications(rawNotifications.map(n => n.id));
        appMessage.success(t('message.all_read', '已將所有通知標示為已讀'));
      } else if (e.key !== 'empty') {
        if (!readNotifications.includes(e.key)) {
          setReadNotifications([...readNotifications, e.key]);
          appMessage.info(t('message.viewed_notification', '已查看通知'));
        }
      }
    }
  };

  const userMenu: MenuProps = {
    selectedKeys: [`role_${currentUserRole}`],
    items: [
      { key: 'role_header', label: <span style={{ fontWeight: 600, color: '#8c8c8c' }}><UserSwitchOutlined /> {t('menu.role_switch_demo', '切換測試角色 (RBAC Demo)')}</span>, disabled: true },
      { key: 'role_admin', label: t('role.admin', ' Admin (系統管理員)') },
      { key: 'role_data_owner', label: t('role.data_owner', ' Data Owner (資料擁有者)') },
      { type: 'divider' },
      { key: 'profile', label: t('menu.profile_settings', '個人設定'), icon: <UserOutlined /> },
      { key: 'preferences', label: t('menu.system_preferences', '系統偏好'), icon: <SettingOutlined /> },
    ],
    onClick: (e) => {
      if (e.key.startsWith('role_')) {
        const role = e.key.replace('role_', '') as UserRole;
        if (role === 'data_owner' && isMaintenanceMode) {
          appMessage.error(t('admin.maintenance_block_switch', '系統維護模式已開啟，無法切換為 Data Owner。'));
          return;
        }
        setUserRole(role);
        navigate(role === 'admin' ? '/admin' : '/workspace?step=1');
        appMessage.info(t('message.role_switched', '已將全域角色切換為：{{role}}', { role: role.toUpperCase() }));
      } else if (e.key === 'profile') {
        navigate('/settings/profile');
      } else if (e.key === 'preferences') {
        navigate('/settings/preferences');
      }
    }
  };

  const handleSidebarStepChange = (targetStep: number) => {
    if (targetStep === currentStep) return;

    const storeState = usePrivacyStore.getState();
    if (targetStep > currentStep) {
      const errorMsg = validateProgression(targetStep, currentStep, storeState, t);
      if (errorMsg) {
        appMessage.warning(errorMsg);
        navigate(`/workspace?step=${currentStep + 1}`, { replace: true });
        return;
      }
    }

    usePrivacyStore.setState({ currentStep: targetStep });
    navigate(`/workspace?step=${targetStep + 1}`);
  };

  const colors = {
    bgLayout: isDarkMode ? '#121214' : '#f0f2f5',
    bgComponent: isDarkMode ? '#1a1a1e' : '#ffffff',
    bgCard: isDarkMode ? '#1e1e2f' : '#ffffff',
    border: isDarkMode ? '#2d2d34' : '#f0f0f0',
    textMain: isDarkMode ? '#ffffff' : '#1f1f1f',
    textMuted: isDarkMode ? '#aaaaaa' : '#8c8c8c',
  };

  const siderMenuItems: MenuProps['items'] = currentUserRole === 'data_owner' 
    ? [
        { key: '0', icon: <FileTextOutlined />, label: t('menu.data_import', '資料匯入'), onClick: () => handleSidebarStepChange(0) },
        { key: '1', icon: <SettingOutlined />, label: t('menu.attribute_mapping', '屬性分類'), onClick: () => handleSidebarStepChange(1) },
        { key: '2', icon: <PieChartOutlined />, label: t('menu.privacy_settings', '隱私設定'), onClick: () => handleSidebarStepChange(2) },
        { key: '3', icon: <DownloadOutlined />, label: t('menu.preview_export', '預覽匯出'), onClick: () => handleSidebarStepChange(3) },
        { type: 'divider' },
        { key: 'audit', icon: <AuditOutlined />, label: t('menu.audit_log', '歷史審計憑證 (Audit Log)'), onClick: () => navigate('/audit') }
      ]
    : [
        { key: 'admin_dashboard', icon: <DashboardOutlined />, label: t('menu.admin_dashboard', '系統管理大廳'), onClick: () => navigate('/admin') }
      ];

  const selectedKeys = (() => {
    if (location.pathname === '/admin') return ['admin_dashboard'];
    if (location.pathname === '/audit') return ['audit'];
    if (location.pathname === '/workspace') return [String(currentStep)];
    return [];
  })();

  const privacyMode = usePrivacyStore((state) => state.privacyMode);

  return (
    <>
      <style>{`
        @keyframes slideLeftFadeIn {
          0% { opacity: 0; transform: translateX(40px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        .step-content-animator {
          animation: slideLeftFadeIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .v-card-style {
          background: ${colors.bgCard} !important;
          border: ${isDarkMode ? 'none' : `1px solid ${colors.border}`} !important;
          box-shadow: ${isDarkMode ? '0 4px 20px 0 rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.06)'} !important;
        }
        .ant-menu-dark {
          background: transparent !important;
        }
      `}</style>

      <Layout style={{ minHeight: '100vh', background: colors.bgLayout, transition: 'background 0.3s' }}>
        <Sider 
          collapsible 
          collapsed={collapsed} 
          onCollapse={(value) => setCollapsed(value)}
          theme={isDarkMode ? "dark" : "light"}
          style={{ background: colors.bgComponent, borderRight: `1px solid ${colors.border}`, transition: 'background 0.3s' }}
        >
          <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', padding: '0 24px', gap: '12px', marginBottom: '16px' }}>
            <SafetyCertificateOutlined style={{ fontSize: '24px', color: '#3f51b5' }} />
            {!collapsed && <span style={{ fontWeight: 'bold', fontSize: '16px', letterSpacing: '1px', color: colors.textMain }}>PRIVACY APP</span>}
          </div>
          
          <Menu 
            theme={isDarkMode ? "dark" : "light"} 
            selectedKeys={selectedKeys} 
            mode="inline" 
            style={{ background: 'transparent' }}
            items={siderMenuItems}
          />
        </Sider>

        <Layout style={{ background: 'transparent' }}>
          <Header style={{ background: colors.bgComponent, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${colors.border}`, transition: 'background 0.3s' }}>
            
            <div style={{ color: colors.textMuted, fontSize: '14px' }}>
              {t('header.project_space', '專案空間')} / <span style={{ color: colors.textMain, fontWeight: 'bold' }}>{t('header.privacy_toolkit', '隱私強化工具包')}</span>
              {currentUserRole === 'data_owner' && location.pathname === '/audit' && <span style={{ color: '#3f51b5', fontWeight: 'bold' }}> / {t('header.audit_log', '歷史審計紀錄與憑證管理')}</span>}
              {currentUserRole === 'data_owner' && location.pathname === '/workspace' && (
                <> / <span style={{ color: '#3f51b5', fontWeight: 'bold' }}>{currentStep > 0 ? (privacyMode === 'k-anonymity' ? t('header.k_anonymity', 'K-匿名化') : t('header.differential_privacy', '差分隱私')) : t('header.select_mode', '選擇模式')}</span></>
              )}
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <Dropdown menu={notificationMenu} placement="bottomRight" trigger={['click']}>
                <Badge count={unreadCount} dot={unreadCount > 0} offset={[-2, 2]}>
                  <BellOutlined style={{ fontSize: '18px', color: colors.textMuted, cursor: 'pointer' }} />
                </Badge>
              </Dropdown>
              
              <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '4px 8px', borderRadius: '8px' }} className="user-profile-hover">
                  <Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: '#3f51b5' }} />
                  <span style={{ color: colors.textMain, fontSize: '14px', fontWeight: 500 }}>{user?.name || 'Admin.Test'}</span>
                  <Tag color="purple" style={{ margin: 0, borderRadius: '10px', fontSize: '11px' }}>
                    {currentUserRole.toUpperCase()}
                  </Tag>
                </div>
              </Dropdown>

              <LogoutOutlined 
                style={{ fontSize: '18px', color: '#f5222d', cursor: 'pointer' }} 
                title={t('header.logout', '登出')} 
                onClick={handleLogoutConfirm}
              />
            </div>
          </Header>

          <Content style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ width: '100%', margin: '0 auto', flex: 1 }}>
              
              {currentUserRole === 'data_owner' && (location.pathname === '/workspace' || location.pathname === '/audit') && (
                <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'flex-start' }}>
                  <Segmented 
                    options={[
                      { label: t('view.wizard', '數據去識別化嚮導 (Wizard)'), value: '/workspace' },
                      { label: t('view.audit', '歷史審計與憑證管理 (Audit Log Hub)'), value: '/audit' }
                    ]}
                    value={location.pathname}
                    onChange={(val) => navigate(val as string)}
                    size="large"
                  />
                </div>
              )}
              
              <Outlet />

            </div>
          </Content>
        </Layout>
      </Layout>
    </>
  );
}

// ==========================================
// 🚀 最外層入口：Router 與全域配置
// ==========================================
export default function App() {
  const isDarkMode = usePrivacyStore((state) => state.isDarkMode);
  const setIsDarkMode = usePrivacyStore((state) => state.setIsDarkMode);
  const language = usePrivacyStore((state) => state.language);
  
  const { i18n } = useTranslation();

  useEffect(() => {
    i18n.changeLanguage(language);
  }, [language, i18n]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
    mediaQuery.addEventListener('change', handleThemeChange);
    return () => mediaQuery.removeEventListener('change', handleThemeChange);
  }, [setIsDarkMode]);

  const getAntdLocale = () => {
    switch (language) {
      case 'en_US': return enUS;
      case 'zh_TW':
      default: return zhTW;
    }
  };

  return (
    <ConfigProvider 
      locale={getAntdLocale()} 
      theme={{ 
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#3f51b5',
          borderRadius: 12,        
          boxShadow: isDarkMode 
            ? '0px 3px 5px -1px rgba(0,0,0,0.2), 0px 6px 10px 0px rgba(0,0,0,0.14), 0px 1px 18px 0px rgba(0,0,0,0.12)'
            : '0px 2px 4px -1px rgba(0,0,0,0.06), 0px 4px 6px -1px rgba(0,0,0,0.1)'
        }
      }}
    >
      <AntdApp style={{ background: 'transparent', width: '100%' }}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/request-access" element={<RequestAccess />} />

            <Route path="/" element={<RequireAuth><InnerApp isDarkMode={isDarkMode} /></RequireAuth>}>
              
              <Route index element={<RoleBasedRedirect />} />
              
              <Route element={<RBACGuard allowedRoles={['data_owner']} redirectPath="/admin" />}>
                <Route path="workspace" element={<MainLayout />} />
                <Route path="audit" element={<AuditLogHub />} />
              </Route>

              <Route element={<RBACGuard allowedRoles={['admin']} redirectPath="/workspace?step=1" />}>
                <Route path="admin" element={<AdminDashboard />} />
              </Route>

              <Route path="settings/profile" element={<ProfileSettings />} />
              <Route path="settings/preferences" element={<SystemPreferences />} />
              
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>

          </Routes>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  );
}