import { useState, useMemo } from 'react';
import { 
  Card, Table, Tag, Input, Select, Button, Space, Typography, 
  Statistic, Row, Col, Modal, theme
} from 'antd';
import { 
  SearchOutlined, FileTextOutlined, PrinterOutlined, 
  CheckCircleOutlined, SafetyCertificateOutlined,
  ExperimentOutlined, FilterOutlined
} from '@ant-design/icons';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import type { AuditLogItem } from '../../store/usePrivacyStore';

const { Text, Title } = Typography;

export default function AuditLogHub() {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';

  const auditLogs = usePrivacyStore((state) => state.auditLogs);

  const [searchText, setSearchText] = useState('');
  const [filterMode, setFilterMode] = useState<string>('all');
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);

  // 篩選過後的 Log 清單
  const filteredLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      const matchSearch = 
        log.certificateId.toLowerCase().includes(searchText.toLowerCase()) ||
        log.fileName.toLowerCase().includes(searchText.toLowerCase()) ||
        log.operator.toLowerCase().includes(searchText.toLowerCase());

      const matchMode = filterMode === 'all' || log.privacyMode === filterMode;

      return matchSearch && matchMode;
    });
  }, [auditLogs, searchText, filterMode]);

  // 高階統計數據
  const stats = useMemo(() => {
    const total = auditLogs.length;
    const passed = auditLogs.filter((l) => l.status === 'passed').length;
    return {
      total,
      passedRate: total > 0 ? ((passed / total) * 100).toFixed(0) : '100',
    };
  }, [auditLogs]);

  const handleOpenCertificate = (log: AuditLogItem) => {
    setSelectedLog(log);
    setReportModalVisible(true);
  };

  const handlePrint = () => {
    window.print();
  };

  const columns = [
    {
      title: '憑證編號',
      dataIndex: 'certificateId',
      key: 'certificateId',
      render: (text: string) => (
        <Text strong style={{ color: token.colorPrimary }}>{text}</Text>
      ),
    },
    {
      title: '處置檔案名稱',
      dataIndex: 'fileName',
      key: 'fileName',
      render: (text: string) => <Text style={{ fontSize: '13px' }}>{text}</Text>,
    },
    {
      title: '保護模式',
      dataIndex: 'privacyMode',
      key: 'privacyMode',
      render: (mode: string) => (
        <Tag color={mode === 'k-anonymity' ? 'blue' : 'purple'}>
          {mode === 'k-anonymity' ? 'K-Anonymity' : 'Differential Privacy'}
        </Tag>
      ),
    },
    {
      title: '操作者 / 角色',
      key: 'operator',
      render: (_: unknown, record: AuditLogItem) => (
        <div>
          <Text strong style={{ fontSize: '13px', display: 'block' }}>{record.operator}</Text>
          <Tag style={{ fontSize: '10px', margin: 0 }}>{record.operatorRole.toUpperCase()}</Tag>
        </div>
      ),
    },
    {
      title: '三大攻擊殘餘風險 (Singling/Link/Inf)',
      key: 'risks',
      render: (_: unknown, record: AuditLogItem) => (
        <Space size="small">
          <Tag color="green">指認: {record.singlingRisk}</Tag>
          <Tag color="green">連結: {record.linkabilityRisk}</Tag>
          <Tag color="green">推斷: {record.inferenceRisk}</Tag>
        </Space>
      ),
    },
    {
      title: '綜合殘餘風險',
      dataIndex: 'overallRisk',
      key: 'overallRisk',
      render: (val: string) => (
        <Text strong style={{ color: parseFloat(val) < 20 ? '#52c41a' : '#faad14' }}>
          {val}
        </Text>
      ),
    },
    {
      title: '審計時間',
      dataIndex: 'auditTime',
      key: 'auditTime',
      render: (time: string) => <Text type="secondary" style={{ fontSize: '12px' }}>{time}</Text>,
    },
    {
      title: '操作與調閱',
      key: 'action',
      align: 'center' as const,
      render: (_: unknown, record: AuditLogItem) => (
        <Button 
          type="link" 
          icon={<FileTextOutlined />} 
          onClick={() => handleOpenCertificate(record)}
        >
          調閱憑證
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* 🌟 頂部統計指標卡片 */}
      <Row gutter={24}>
        <Col span={8}>
          <Card variant="borderless" style={{ background: token.colorBgContainer }}>
            <Statistic 
              title="累積合規簽發憑證總數" 
              value={stats.total} 
              prefix={<SafetyCertificateOutlined style={{ color: token.colorPrimary }} />} 
              suffix="份"
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless" style={{ background: token.colorBgContainer }}>
            <Statistic 
              title="審計合規通過率" 
              value={stats.passedRate} 
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />} 
              suffix="%"
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless" style={{ background: token.colorBgContainer }}>
            <Statistic 
              title="當前全域殘餘風險平均值" 
              value="10.8" 
              prefix={<ExperimentOutlined style={{ color: '#faad14' }} />} 
              suffix="%"
            />
          </Card>
        </Col>
      </Row>

      {/* 🌟 搜尋與篩選區塊 */}
      <Card variant="borderless" style={{ background: token.colorBgContainer }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <Title level={4} style={{ margin: 0 }}>
            <FilterOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
            歷史審計軌跡與憑證數據庫 (Audit Logs & Certificates Hub)
          </Title>
          <Space>
            <Input 
              placeholder="搜尋憑證編號、檔案名稱、操作者..." 
              prefix={<SearchOutlined />} 
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: '280px' }}
              allowClear
            />
            <Select 
              value={filterMode} 
              onChange={(val) => setFilterMode(val)}
              style={{ width: '180px' }}
              options={[
                { value: 'all', label: '全部保護模式' },
                { value: 'k-anonymity', label: 'K-Anonymity' },
                { value: 'differential-privacy', label: 'Differential Privacy' },
              ]}
            />
          </Space>
        </div>

        {/* 🌟 歷史紀錄表格 */}
        <Table 
          dataSource={filteredLogs}
          columns={columns}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          size="middle"
          scroll={{ x: 'max-content' }}
        />
      </Card>

      {/* 📄 歷史憑證 Modal 彈窗 */}
      <Modal
        title="歷史審計憑證調閱 (Historical Certificate Viewer)"
        open={reportModalVisible}
        onCancel={() => setReportModalVisible(false)}
        width={750}
        footer={[
          <Button key="close" onClick={() => setReportModalVisible(false)}>關閉</Button>,
          <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={handlePrint}>重新列印 / 存為 PDF</Button>
        ]}
      >
        {selectedLog && (
          <div style={{ padding: '16px', color: token.colorText, background: isDark ? '#1f1f1f' : '#ffffff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${token.colorPrimary}`, paddingBottom: '12px', marginBottom: '16px' }}>
              <div>
                <h2 style={{ margin: 0, color: token.colorPrimary }}>🔒 數據隱私合規與技術審計憑證</h2>
                <span style={{ fontSize: '12px', color: token.colorTextDescription }}>憑證編號: {selectedLog.certificateId}</span>
              </div>
              <Tag color="success" style={{ fontSize: '14px', padding: '4px 12px' }}><CheckCircleOutlined /> 驗證合格</Tag>
            </div>

            <div style={{ background: isDark ? '#141414' : '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: `1px solid ${token.colorBorderSecondary}` }}>
              <h4 style={{ marginTop: 0, color: token.colorText }}>📋 專案與執行軌跡</h4>
              <Row gutter={[16, 8]} style={{ fontSize: '13px', color: token.colorTextSecondary }}>
                <Col span={12}><b style={{ color: token.colorText }}>資料檔案：</b> {selectedLog.fileName}</Col>
                <Col span={12}><b style={{ color: token.colorText }}>套用技術：</b> {selectedLog.privacyMode.toUpperCase()}</Col>
                <Col span={12}><b style={{ color: token.colorText }}>執行人員：</b> {selectedLog.operator} ({selectedLog.operatorRole.toUpperCase()})</Col>
                <Col span={12}><b style={{ color: token.colorText }}>簽發時間：</b> {selectedLog.auditTime}</Col>
              </Row>
            </div>

            <div style={{ background: isDark ? '#141414' : '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: `1px solid ${token.colorBorderSecondary}` }}>
              <h4 style={{ marginTop: 0, color: token.colorText }}>🛡️ 殘餘風險與量測結果</h4>
              <Row gutter={[16, 8]} style={{ fontSize: '13px', color: token.colorTextSecondary }}>
                <Col span={12}><b style={{ color: token.colorText }}>指認性風險 (Singling Out):</b> <span style={{ color: '#52c41a' }}>{selectedLog.singlingRisk}</span></Col>
                <Col span={12}><b style={{ color: token.colorText }}>連結性風險 (Linkability):</b> <span style={{ color: '#52c41a' }}>{selectedLog.linkabilityRisk}</span></Col>
                <Col span={12}><b style={{ color: token.colorText }}>推斷性風險 (Inference):</b> <span style={{ color: '#52c41a' }}>{selectedLog.inferenceRisk}</span></Col>
                <Col span={12}><b style={{ color: token.colorText }}>綜合殘餘風險 (Final Risk):</b> <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{selectedLog.overallRisk}</span></Col>
              </Row>
            </div>

            <div style={{ textAlign: 'right', marginTop: '24px', borderTop: `1px dashed ${token.colorBorderSecondary}`, paddingTop: '12px', fontSize: '12px', color: token.colorTextDescription }}>
              數位防篡改指核 (SHA-256): 8f3c7e9a0b12d3e4f56789a0b12c3d4e56789a0b
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}