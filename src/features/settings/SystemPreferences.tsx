import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Card, Switch, Select, Space, Divider, theme, Typography, 
  Tabs, Table, Tag, Button, Form, InputNumber, Alert, Modal, Input, App as AntdApp, Dropdown 
} from 'antd';
import type { MenuProps } from 'antd';
import { 
  SettingOutlined, 
  MoonOutlined, 
  SunOutlined, 
  GlobalOutlined,
  TeamOutlined, 
  CodeOutlined, 
  SafetyCertificateOutlined, 
  PlusOutlined,
  KeyOutlined,
  MoreOutlined,
  ExclamationCircleFilled
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

// 🌟 1. 改為引入拆分後的新 Stores
import { useAuthStore } from '../../store/useAuthStore';
import { useUIStore } from '../../store/useUIStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

const { Text, Title } = Typography;

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLogin: string;
}

// 安全與環境參數表單的介面
interface EnvSecurityValues {
  sessionTimeout: number;
  maxFailedLogins: number;
  maintenanceMode: boolean;
  enablePasswordExpiry: boolean;
  passwordExpiryDays: number;
}

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

const BasicPreferences = ({ currentUserRole }: { currentUserRole: string }) => {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  
  // 🌟 2. 從 UIStore 取得主題與語言設定
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  const setIsDarkMode = useUIStore((state) => state.setIsDarkMode);
  const language = useUIStore((state) => state.language);
  const setLanguage = useUIStore((state) => state.setLanguage);

  return (
    <div style={{ maxWidth: '600px', margin: currentUserRole === 'admin' ? '0' : '40px auto' }}>
      <Card
        title={
          <Space>
            <SettingOutlined style={{ color: token.colorPrimary }} />
            <span style={{ fontSize: '16px', fontWeight: 600 }}>{t('preferences.title', '系統偏好設定')}</span>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
          <Space size="middle">
            <div style={{ backgroundColor: token.colorFillAlter, padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isDarkMode ? '#fadb14' : '#fa8c16' }}>
              {isDarkMode ? <MoonOutlined style={{ fontSize: '18px' }} /> : <SunOutlined style={{ fontSize: '18px' }} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Text strong style={{ fontSize: '15px' }}>{t('preferences.dark_mode', '深色模式')}</Text>
              <Text type="secondary" style={{ fontSize: '13px' }}>{t('preferences.dark_mode_desc', '切換深色/淺色主題外觀')}</Text>
            </div>
          </Space>
          <Switch checked={isDarkMode} onChange={(checked) => setIsDarkMode(checked)} checkedChildren={<MoonOutlined />} unCheckedChildren={<SunOutlined />} style={{ minWidth: '60px' }} />
        </div>

        <Divider dashed style={{ margin: '16px 0' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
          <Space size="middle">
            <div style={{ backgroundColor: token.colorFillAlter, padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: token.colorPrimary }}>
              <GlobalOutlined style={{ fontSize: '18px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Text strong style={{ fontSize: '15px' }}>{t('preferences.language', '系統語系')}</Text>
              <Text type="secondary" style={{ fontSize: '13px' }}>{t('preferences.language_desc', '選擇您偏好的語言介面')}</Text>
            </div>
          </Space>
          <Select
            value={language}
            onChange={(val) => setLanguage(val)} 
            style={{ width: 140 }}
            options={[
              { value: 'zh_TW', label: '繁體中文' },
              { value: 'en_US', label: 'English' },
            ]}
          />
        </div>
      </Card>
    </div>
  );
};

export default function SystemPreferences() {
  const { t } = useTranslation();
  const { message, modal } = AntdApp.useApp(); 
  
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'users'; 
  
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  
  // 🌟 3. 從 AuthStore 獲取當前登入使用者與角色
  const user = useAuthStore((state) => state.user);
  const currentUserRole = user?.role || 'admin';

  // 🌟 4. 從 WorkspaceStore 獲取環境 security 參數與方法 (使用安全轉型)
  const storeState = useWorkspaceStore((state) => state as unknown as ExtendedWorkspaceSecurity);
  const sessionTimeout = storeState.sessionTimeout || 15;
  const maxFailedLogins = storeState.maxFailedLogins || 5;
  const isMaintenanceMode = storeState.isMaintenanceMode || false;
  const enablePasswordExpiry = storeState.enablePasswordExpiry !== false; 
  const passwordExpiryDays = storeState.passwordExpiryDays || 90;
  
  const updateSecuritySettings = storeState.updateSecuritySettings || ((settings) => {
    useWorkspaceStore.setState(settings as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
  });

  const [envForm] = Form.useForm<EnvSecurityValues>();

  // 初始化表單：將 Store 內的值帶入 envForm
  useEffect(() => {
    envForm.setFieldsValue({
      sessionTimeout: sessionTimeout,
      maxFailedLogins: maxFailedLogins,
      maintenanceMode: isMaintenanceMode === true,
      enablePasswordExpiry: enablePasswordExpiry,
      passwordExpiryDays: passwordExpiryDays
    });
  }, [sessionTimeout, maxFailedLogins, isMaintenanceMode, enablePasswordExpiry, passwordExpiryDays, envForm]);

  // 儲存環境設定：寫入 Store
  const handleSaveEnvSettings = () => {
    envForm.validateFields().then((values: EnvSecurityValues) => {
      updateSecuritySettings({
        sessionTimeout: Number(values.sessionTimeout),
        maxFailedLogins: Number(values.maxFailedLogins),
        isMaintenanceMode: !!values.maintenanceMode,
        enablePasswordExpiry: !!values.enablePasswordExpiry,
        passwordExpiryDays: Number(values.passwordExpiryDays)
      });
      message.success(t('admin.msg_env_saved', '環境與安全設定已成功儲存'));
    });
  };

  const [users, setUsers] = useState<UserRecord[]>([
    { id: 'U001', name: 'Admin.Test', email: 'admin@company.com', role: 'admin', status: 'active', lastLogin: '2026-07-30 09:12:00' },
    { id: 'U002', name: 'Data.Owner.A', email: 'owner_a@company.com', role: 'data_owner', status: 'active', lastLogin: '2026-07-29 15:30:22' },
    { id: 'U003', name: 'Data.Owner.B', email: 'owner_b@company.com', role: 'data_owner', status: 'disabled', lastLogin: '2026-06-15 10:00:00' },
  ]);

  const [isUserModalVisible, setIsUserModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [userForm] = Form.useForm();

  const [isResetPwdModalVisible, setIsResetPwdModalVisible] = useState(false);
  const [resetPwdTarget, setResetPwdTarget] = useState<UserRecord | null>(null);
  const [resetPwdForm] = Form.useForm();

  const handleAddUser = () => {
    setEditingUser(null);
    userForm.resetFields();
    userForm.setFieldsValue({ role: 'data_owner' }); 
    setIsUserModalVisible(true);
  };

  const handleEditUser = (record: UserRecord) => {
    setEditingUser(record);
    userForm.setFieldsValue(record);
    setIsUserModalVisible(true);
  };

  const handleDeleteUser = (id: string) => {
    setUsers(users.filter(u => u.id !== id));
    message.success(t('admin.msg_user_deleted', '使用者已成功刪除'));
  };

  const showDeleteConfirm = (id: string) => {
    modal.confirm({
      title: t('admin.delete_confirm_title', '確認刪除'),
      icon: <ExclamationCircleFilled />,
      content: t('admin.delete_confirm_desc', '您確定要刪除此帳號嗎？此操作無法復原。'),
      okText: t('admin.btn_confirm', '確認'),
      okType: 'danger',
      cancelText: t('admin.btn_cancel', '取消'),
      onOk() {
        handleDeleteUser(id);
      },
    });
  };

  const handleSaveUser = () => {
    userForm.validateFields().then((values) => {
      if (editingUser) {
        setUsers(users.map(u => u.id === editingUser.id ? { ...u, ...values } : u));
        message.success(t('admin.msg_user_updated', '使用者資料已更新'));
      } else {
        const newUser: UserRecord = {
          id: `U00${users.length + 1}`,
          ...values,
          status: 'active',
          lastLogin: '-'
        };
        setUsers([...users, newUser]);
        message.success(t('admin.msg_user_added', '已成功新增使用者'));
      }
      setIsUserModalVisible(false);
    });
  };

  const handleToggleStatus = (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    setUsers(users.map(u => u.id === id ? { ...u, status: newStatus } : u));
    message.success(t('admin.msg_status_updated', '帳號狀態已更新'));
  };

  const handleOpenResetPwd = (record: UserRecord) => {
    setResetPwdTarget(record);
    resetPwdForm.resetFields();
    setIsResetPwdModalVisible(true);
  };

  const handleSaveResetPwd = () => {
    resetPwdForm.validateFields().then(() => {
      message.success(t('admin.msg_pwd_reset_success', `已成功重設 ${resetPwdTarget?.name} 的密碼`));
      setIsResetPwdModalVisible(false);
    });
  };

  const systemLogs = [
    { id: 'L1001', time: '2026-07-30 10:50:12', level: 'INFO', event: 'System booted successfully', ip: '127.0.0.1' },
    { id: 'L1002', time: '2026-07-30 09:12:05', level: 'WARN', event: 'Failed login attempt (Invalid Password)', ip: '192.168.1.105' },
    { id: 'L1003', time: '2026-07-29 23:00:00', level: 'INFO', event: 'Automated DB backup completed', ip: 'System' },
    { id: 'L1004', time: '2026-07-28 14:20:00', level: 'ERROR', event: 'Connection timeout to Auth Server', ip: '10.0.0.5' },
  ];

  const userColumns = [
    { title: t('admin.col_username', '使用者名稱'), dataIndex: 'name', key: 'name', render: (text: string) => <Text strong>{text}</Text> },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { 
      title: t('admin.col_role', '系統角色'), 
      dataIndex: 'role', 
      key: 'role',
      render: (role: string) => (
        <Tag color={role === 'admin' ? 'purple' : 'blue'}>
          {role === 'admin' ? 'Admin' : 'Data Owner'}
        </Tag>
      )
    },
    { 
      title: t('admin.col_status', '帳號狀態'), 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'success' : 'error'}>
          {status.toUpperCase()}
        </Tag>
      )
    },
    { title: t('admin.col_last_login', '最後登入時間'), dataIndex: 'lastLogin', key: 'lastLogin' },
    { 
      title: t('admin.col_action', '操作'), 
      key: 'action',
      width: '100px', 
      render: (_: unknown, record: UserRecord) => {
        const actionBtnColor = isDarkMode ? '#ffffff' : '#000000';
        
        const menuItems: MenuProps['items'] = [
          {
            key: 'reset_pwd',
            label: t('admin.action_reset_pwd', '重設密碼'),
            onClick: () => handleOpenResetPwd(record)
          },
          {
            key: 'toggle_status',
            label: record.status === 'active' ? t('admin.action_disable', '停用') : t('admin.action_enable', '啟用'),
            onClick: () => handleToggleStatus(record.id, record.status)
          },
          { type: 'divider' },
          {
            key: 'delete',
            label: t('admin.action_delete', '刪除'),
            danger: true,
            onClick: () => showDeleteConfirm(record.id)
          }
        ];

        return (
          <Space size="small">
            <Button type="link" size="small" style={{ color: actionBtnColor, padding: '0 4px' }} onClick={() => handleEditUser(record)}>
              {t('admin.action_edit', '編輯')}
            </Button>
            
            <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
              <Button type="text" size="small" style={{ color: actionBtnColor }}>
                <MoreOutlined />
              </Button>
            </Dropdown>
          </Space>
        );
      }
    },
  ];

  const logColumns = [
    { title: t('admin.col_time', '時間'), dataIndex: 'time', key: 'time', width: '180px' },
    { 
      title: t('admin.col_level', '層級'), 
      dataIndex: 'level', 
      key: 'level',
      width: '100px',
      render: (level: string) => {
        const color = level === 'ERROR' ? 'red' : level === 'WARN' ? 'orange' : 'green';
        return <Tag color={color}>{level}</Tag>;
      }
    },
    { title: t('admin.col_event', '系統事件'), dataIndex: 'event', key: 'event' },
    { title: t('admin.col_ip', '來源 IP'), dataIndex: 'ip', key: 'ip', width: '150px' },
  ];

  const tabItems = [];
  
  if (currentUserRole === 'admin') {
    tabItems.push(
      {
        key: 'users',
        label: <span><TeamOutlined /> {t('admin.tab_users', '帳號與權限管理')}</span>,
        children: (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                <Title level={5} style={{ margin: 0 }}>{t('admin.user_list', '系統使用者列表')}</Title>
                <Text type="secondary">{t('admin.user_list_desc', '負責開通 Data Owner 帳號與設定密碼，不包含任何資料授權。')}</Text>
              </div>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAddUser}>
                {t('admin.add_user', '新增使用者')}
              </Button>
            </div>
            <Table columns={userColumns} dataSource={users.filter(u => u.role === 'data_owner')} rowKey="id" pagination={{ pageSize: 5 }} size="middle" />
          </div>
        ),
      },
      {
        key: 'syslogs',
        label: <span><CodeOutlined /> {t('admin.tab_syslogs', '系統維運日誌')}</span>,
        children: (
          <div>
            <Alert 
              message={t('admin.syslog_title', '系統維運日誌 (System Logs)')}
              description={t('admin.syslog_desc', '此處僅記錄伺服器連線、登入失敗、系統錯誤等基礎設施事件。若需調閱資料去識別化的合規操作紀錄，請聯絡 Data Owner 於前台匯出 Audit Log。')}
              type="info" 
              showIcon 
              style={{ marginBottom: '16px' }}
            />
            <Table columns={logColumns} dataSource={systemLogs} rowKey="id" pagination={{ pageSize: 5 }} size="small" />
          </div>
        ),
      },
      {
        key: 'security',
        label: <span><SafetyCertificateOutlined /> {t('admin.tab_security', '安全與環境參數')}</span>,
        children: (
          <div style={{ maxWidth: '600px' }}>
            <Form form={envForm} layout="vertical">
              <Card type="inner" title={t('admin.conn_security', '連線安全設定')} style={{ marginBottom: '16px' }}>
                <Form.Item name="sessionTimeout" label={t('admin.session_timeout', 'Session 閒置強制登出時間 (分鐘)')} extra={t('admin.session_timeout_desc', '設定使用者在無操作狀態下多久後會被系統自動登出。')}>
                  <InputNumber min={1} max={120} style={{ width: '100px' }} />
                </Form.Item>
                <Form.Item name="maxFailedLogins" label={t('admin.max_login_attempts', '密碼錯誤鎖定次數')} extra={t('admin.max_login_desc', '連續登入失敗達此次數後，帳號將被鎖定 15 分鐘。')}>
                  <InputNumber min={1} max={10} style={{ width: '100px' }} />
                </Form.Item>
              </Card>

              {/* 密碼安全政策卡片 */}
              <Card type="inner" title={t('admin.password_policy_title', '密碼安全政策快速控管')} style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
                  <Form.Item name="enablePasswordExpiry" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch style={{ marginTop: '2px' }} />
                  </Form.Item>
                  <div>
                    <Text strong style={{ display: 'block', marginBottom: '4px' }}>
                      {t('admin.enable_expiry', '強制密碼過期輪替')}
                    </Text>
                    <Text type="secondary" style={{ fontSize: '13px' }}>
                      {t('admin.enable_expiry_desc', '開啟後，所有帳號必須在設定的週期內變更密碼。')}
                    </Text>
                  </div>
                </div>
                
                <Form.Item noStyle shouldUpdate={(prevValues: EnvSecurityValues, currentValues: EnvSecurityValues) => prevValues.enablePasswordExpiry !== currentValues.enablePasswordExpiry}>
                  {({ getFieldValue }) => {
                    const isEnabled = getFieldValue('enablePasswordExpiry');
                    return (
                      <div style={{ opacity: isEnabled ? 1 : 0.4, pointerEvents: isEnabled ? 'auto' : 'none', transition: 'all 0.3s' }}>
                        <Form.Item name="passwordExpiryDays" label={t('admin.expiry_days', '密碼有效天數')} extra={t('admin.expiry_days_desc', '建議企業內部安全規範設定為 90 天。')}>
                          <InputNumber min={1} max={365} style={{ width: '120px' }} addonAfter={t('admin.days', '天')} />
                        </Form.Item>
                      </div>
                    );
                  }}
                </Form.Item>
              </Card>
              
              <Card type="inner" title={t('admin.maintenance_mode', '系統維護模式')}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <Form.Item name="maintenanceMode" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch style={{ marginTop: '2px' }} />
                  </Form.Item>
                  <div>
                    <Text strong style={{ display: 'block', marginBottom: '4px' }}>
                      {t('admin.enable_maintenance', '啟用系統維護模式 (Maintenance Mode)')}
                    </Text>
                    <Text type="secondary" style={{ fontSize: '13px' }}>
                      {t('admin.maintenance_desc', '開啟後，所有 Data Owner 將無法登入系統，僅允許 Admin 進行伺服器維護。')}
                    </Text>
                  </div>
                </div>
              </Card>
              
              <div style={{ marginTop: '24px', textAlign: 'center' }}>
                <Button type="primary" size="large" onClick={handleSaveEnvSettings} icon={<SettingOutlined />}>
                  {t('admin.save_env_settings', '儲存環境設定')}
                </Button>
              </div>
            </Form>
          </div>
        ),
      }
    );
  }

  tabItems.push({
    key: 'preferences',
    label: <span><SettingOutlined /> {t('preferences.title', 'System Preferences')}</span>,
    children: <BasicPreferences currentUserRole={currentUserRole} />
  });

  const handleTabChange = (key: string) => {
    setSearchParams({ tab: key });
  };

  if (currentUserRole === 'admin') {
    return (
      <div style={{ padding: '0 24px', maxWidth: '1200px', margin: '0 auto' }}>
        <Card 
          title={<span style={{ fontSize: '18px', fontWeight: 'bold' }}>{t('admin.console_title', '系統偏好與後台管理 (Admin Console)')}</span>} 
          variant="borderless" 
          style={{ minHeight: '600px', borderRadius: '12px', marginTop: '24px' }}
        >
          <Tabs activeKey={activeTab} onChange={handleTabChange} items={tabItems} size="large" />
        </Card>

        <Modal
          title={editingUser ? t('admin.edit_user', '編輯使用者') : t('admin.add_user_title', '新增使用者')}
          open={isUserModalVisible}
          onOk={handleSaveUser}
          onCancel={() => setIsUserModalVisible(false)}
          okText={t('admin.btn_save', '儲存')}
          cancelText={t('admin.btn_cancel', '取消')}
          destroyOnClose
        >
          <Form form={userForm} layout="vertical" style={{ marginTop: '20px' }}>
            <Form.Item 
              name="name" 
              label={t('admin.col_username', '使用者名稱')} 
              rules={[{ required: true, message: t('admin.name_required', '請輸入使用者名稱') }]}
            >
              <Input placeholder="e.g. Data.Owner.C" />
            </Form.Item>
            <Form.Item 
              name="email" 
              label="Email" 
              rules={[
                { required: true, message: t('admin.email_required', '請輸入 Email') },
                { type: 'email', message: t('admin.email_required', '請輸入有效的 Email 格式') }
              ]}
            >
              <Input placeholder="user@company.com" />
            </Form.Item>
            <Form.Item 
              name="role" 
              label={t('admin.col_role', '系統角色')} 
              rules={[{ required: true }]}
            >
              <Select 
                options={[
                  { value: 'data_owner', label: t('admin.role_data_owner', 'Data Owner (資料擁有者)') }
                ]} 
              />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title={
            <Space>
              <KeyOutlined style={{ color: '#faad14' }} />
              {t('admin.reset_pwd_modal_title', '強制重設密碼')} - {resetPwdTarget?.name}
            </Space>
          }
          open={isResetPwdModalVisible}
          onOk={handleSaveResetPwd}
          onCancel={() => setIsResetPwdModalVisible(false)}
          okText={t('admin.btn_confirm', '確認')}
          cancelText={t('admin.btn_cancel', '取消')}
          destroyOnClose
        >
          <Alert 
            message={t('admin.reset_pwd_alert', '您正在執行管理員權限強制重設密碼。儲存後，原密碼將立即失效。')} 
            type="warning" 
            showIcon 
            style={{ marginBottom: '16px' }}
          />
          <Form form={resetPwdForm} layout="vertical" requiredMark="optional">
            <Form.Item
              name="newPassword"
              label={t('profile.new_password', '新密碼')}
              rules={[
                { required: true, message: t('profile.require_new_password', '請輸入新密碼') },
                { min: 12, message: t('profile.password_min_length', '密碼長度至少需要 12 個字元') },
                {
                  pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#\-_+=])[A-Za-z\d@$!%*?&#\-_+=]{12,}$/,
                  message: t('profile.password_complexity', '密碼強度不足：需包含大小寫字母、數字及特殊符號 (如 @$!%*?&#)')
                }
              ]}
              hasFeedback
            >
              <Input.Password placeholder={t('profile.ph_new_password', '至少 12 個字元')} size="large" />
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
          </Form>
        </Modal>

      </div>
    );
  }

  return (
    <div style={{ padding: '0 24px' }}>
      <BasicPreferences currentUserRole={currentUserRole} />
    </div>
  );
}