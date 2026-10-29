import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Typography, Button, Table, Tag, Space, Badge, Progress } from 'antd';
import {
    PlusOutlined,
    ArrowRightOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    ClockCircleOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useAuditStore, selectAuditLogsForUser, type AuditLogItem } from '../../store/useAuditStore';
import { useAuthStore } from '../../store/useAuthStore';
import { getRoleDisplayName } from '../../utils/roleLabel';
import { probeBackendHealth, type BackendHealthState } from '../../utils/adminDashboardStats';

import { scaleFontSize } from '../../utils/fontScale';
const { Title, Text, Paragraph } = Typography;

// 儀表板「最近處理紀錄」表格最多顯示之筆數
const RECENT_LOGS_DISPLAY_LIMIT = 5;

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { t: translate } = useTranslation();
  // ★ 2026-10-07：改讀登入中的使用者，不再寫死；角色以「Data Owner」顯示而非 DATA_OWNER
  const currentUserSession = useAuthStore((state) => state.user);
  const userInfo = { name: currentUserSession?.name ?? '', role: getRoleDisplayName(currentUserSession?.role ?? 'data_owner') };
  // ★ 2026-10-29：「系統運作正常」原本寫死綠燈，改依後端連線檢查（同系統管理大廳，GET /api/v1/settings）
  const [backendHealthState, setBackendHealthState] = useState<BackendHealthState>({ status: 'checking' });
  useEffect(() => {
    let isUnmounted = false;
    const probeAndStore = (): void => { void probeBackendHealth().then((healthResult) => { if (!isUnmounted) setBackendHealthState(healthResult); }); };
    probeAndStore();
    const healthTimerId = window.setInterval(probeAndStore, 60 * 1000); // 與系統管理大廳相同，每 60 秒重查
    return () => { isUnmounted = true; window.clearInterval(healthTimerId); };
  }, []);
  const backendBadgeProps = backendHealthState.status === 'ok'
    ? { status: 'processing' as const, color: '#52c41a', text: translate('dashboard.system_normal', '系統運作正常') }
    : backendHealthState.status === 'down'
      ? { status: 'error' as const, color: '#ff4d4f', text: translate('dashboard.system_down', '無法連線至後端，請稍後再試或聯絡管理員') }
      : { status: 'default' as const, color: undefined, text: translate('dashboard.system_checking', '檢查後端連線中…') };
  // ★ 2026-10-29：歡迎詞只顯示使用者名稱（帳號為 Email 時取 @ 前面那段，例如 owner@test.com → owner）
  const welcomeNameString = userInfo.name.includes('@') ? userInfo.name.split('@')[0] : userInfo.name;

  // ★ 2026-10-07：Admin 發布之「重要」公告，以可關閉橫幅顯示於首頁（一般公告只在右上角鈴鐺）

  // 讀取全域歷史審計紀錄 (真實紀錄，非假資料)，最新紀錄已由 addAuditLog 插入於陣列最前端
  // ★ 2026-10-29：紀錄存後端（登入後載入），只統計目前帳號的紀錄
  const allAuditLogsList = useAuditStore((state) => state.auditLogs);
  const auditLogsList = useMemo(() => selectAuditLogsForUser(allAuditLogsList, currentUserSession?.name), [allAuditLogsList, currentUserSession?.name]);

  const recentLogs = useMemo(
    () => auditLogsList.slice(0, RECENT_LOGS_DISPLAY_LIMIT),
    [auditLogsList]
  );

  // 計算本月處理任務數統計 (依 auditTime 是否落在當前年月判斷)
  const monthlyTaskStatistics = useMemo(() => {
    const currentDateObj = new Date();
    const currentYearValue = currentDateObj.getFullYear();
    const currentMonthValue = currentDateObj.getMonth();

    // ★ 使用 auditTimestamp (Unix 時間戳記) 而非重新解析 auditTime 顯示字串——
    //   auditTime 是依當地語系格式化之字串 (如 "2026/8/21 上午11:24:10")，
    //   new Date() 無法可靠地重新解析該格式，會導致篩選結果永遠為空
    const thisMonthLogsList = auditLogsList.filter((logItemRecord) => {
      const parsedAuditTimeDate = new Date(logItemRecord.auditTimestamp);
      return !isNaN(parsedAuditTimeDate.getTime())
        && parsedAuditTimeDate.getFullYear() === currentYearValue
        && parsedAuditTimeDate.getMonth() === currentMonthValue;
    });

    const totalCountValue = thisMonthLogsList.length;
    const successCountValue = thisMonthLogsList.filter((logItemRecord) => logItemRecord.status === 'passed').length;
    const failedCountValue = totalCountValue - successCountValue;
    const successPercentValue = totalCountValue > 0 ? Math.round((successCountValue / totalCountValue) * 100) : 0;

    return { totalCountValue, successCountValue, failedCountValue, successPercentValue };
  }, [auditLogsList]);

  // Ant Design 表格欄位設定
  const columns = [
    {
        title: translate('dashboard.col_task_name', '任務名稱'),
        dataIndex: 'fileName',
        key: 'fileName',
        render: (text: string) => <Text strong>{text}</Text>
    },
    {
        title: translate('dashboard.col_process_time', '處理時間'),
        dataIndex: 'auditTime',
        key: 'auditTime',
        render: (text: string) => <Space><ClockCircleOutlined style={{ color: '#8c8c8c' }} /><Text type="secondary">{text}</Text></Space>
    },
    {
        title: translate('dashboard.col_status', '狀態'),
        dataIndex: 'status',
        key: 'status',
        render: (status: AuditLogItem['status']) => {
            const isSuccess = status === 'passed';
            return (
                <Tag
                    color={isSuccess ? 'success' : 'error'}
                    icon={isSuccess ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                >
                    {isSuccess ? translate('dashboard.status_completed', '完成') : translate('dashboard.status_failed', '失敗')}
                </Tag>
            );
        }
    }
  ];

  return (
    <div style={{ padding: '24px', maxWidth: '85.5em', margin: '0 auto' }}>
      <Space direction="vertical" size="large" style={{ display: 'flex', width: '100%' }}>
        
        {/* --- 1. 歡迎與狀態區塊 --- */}
        <div>
          <Title level={2} style={{ margin: 0 }}>{translate('dashboard.welcome_back', '歡迎回來 {{name}}', { name: welcomeNameString })}</Title>
          <Space size="middle" style={{ marginTop: '12px' }}>
            <Badge status={backendBadgeProps.status} color={backendBadgeProps.color} text={<Text type="secondary">{backendBadgeProps.text}</Text>} />
            <Text type="secondary" style={{ opacity: 0.5 }}>|</Text>
            <Text type="secondary">
                {translate('dashboard.role_label', '權限身份：')}<Text strong style={{ color: '#1677ff' }}>{userInfo.role}</Text>
            </Text>
          </Space>
        </div>

        {/* --- 2. 核心操作區塊 --- */}
        <Row gutter={[24, 24]}>
          {/* 左側主操作卡片 */}
          <Col xs={24} lg={16}>
            <Card 
                style={{ height: '100%', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }} 
                styles={{ body: { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '32px' } }}
            >
              <Title level={3} style={{ marginTop: 0 }}>{translate('dashboard.new_task_title', '建立新的去識別化任務')}</Title>
              <Paragraph type="secondary" style={{ fontSize: scaleFontSize(16), marginBottom: '24px', lineHeight: '1.8' }}>
                {translate('dashboard.new_task_desc', '系統將引導您進行屬性分類與隱私設定。資料只會上傳到本系統的後端處理，不會傳送給任何第三方。')}
              </Paragraph>
              <div>
                  <Button
                    type="primary"
                    size="large"
                    icon={<PlusOutlined />}
                    onClick={() => navigate('/workspace?step=1')}
                    style={{ borderRadius: '8px', padding: '0 24px', height: '48px', fontSize: scaleFontSize(16) }}
                  >
                    {translate('dashboard.new_task_btn', '新增去識別化任務')}
                  </Button>
              </div>
            </Card>
          </Col>

          {/* 右側快速數據統計卡片 */}
          <Col xs={24} lg={8}>
            <Card
                title={translate('dashboard.monthly_task_count', '本月處理任務數')}
                style={{ height: '100%', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
                styles={{ body: { padding: '24px' } }}
            >
              <Title level={1} style={{ marginTop: 0, marginBottom: '24px', color: '#1677ff' }}>
                  {monthlyTaskStatistics.totalCountValue} <Text type="secondary" style={{ fontSize: scaleFontSize(16), fontWeight: 'normal' }}>{translate('dashboard.unit_count', '件')}</Text>
              </Title>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <Text type="secondary">{translate('dashboard.success_label', '成功')}</Text>
                <Text type="success" strong>{monthlyTaskStatistics.successCountValue} {translate('dashboard.unit_count', '件')}</Text>
              </div>
              <Progress percent={monthlyTaskStatistics.successPercentValue} showInfo={false} strokeColor="#52c41a" trailColor="rgba(0,0,0,0.04)" />

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
                <Text type="secondary">{translate('dashboard.failed_label', '失敗')}</Text>
                <Text type="danger" strong>{monthlyTaskStatistics.failedCountValue} {translate('dashboard.unit_count', '件')}</Text>
              </div>
            </Card>
          </Col>
        </Row>

        {/* --- 3. 最近活動表格 --- */}
        <Card
          title={translate('dashboard.recent_records', '最近處理紀錄')}
          style={{ borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
          extra={
            <Button type="link" onClick={() => navigate('/audit')} style={{ padding: 0 }}>
                {translate('dashboard.view_full_records', '查看完整紀錄')} <ArrowRightOutlined />
            </Button>
          }
        >
          <Table
            columns={columns}
            dataSource={recentLogs}
            rowKey="id"
            pagination={false}
            size="middle"
          />
        </Card>

      </Space>
    </div>
  );
};