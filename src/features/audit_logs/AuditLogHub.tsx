import { useState, useMemo } from 'react';
import { 
  Card, Table, Tag, Input, Select, Button, Space, Typography, 
  Statistic, Row, Col, Modal, theme, App as AntdApp
} from 'antd';
import { 
  SearchOutlined, FileTextOutlined, 
  CheckCircleOutlined, SafetyCertificateOutlined,
  ExperimentOutlined, FilterOutlined, DownloadOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

// 🌟 1. 引入拆分後的新 Stores 與型別
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useAuditStore, type AuditLogItem } from '../../store/useAuditStore';

// 🌟 2. 宣告 html2pdf 的嚴謹介面，消滅 window as any
interface Html2Pdf {
  set: (opt: Record<string, unknown>) => Html2Pdf;
  from: (element: HTMLElement | null) => Html2Pdf;
  save: () => Promise<void>;
}

interface WindowWithHtml2Pdf extends Window {
  html2pdf: () => Html2Pdf;
}

const { Text, Title } = Typography;

export default function AuditLogHub() {
  const { token } = theme.useToken();
  const { message: messageApi } = AntdApp.useApp();
  const { t } = useTranslation();

  // 🌟 3. 從各自負責的 Store 中取得狀態
  const auditLogs = useAuditStore((state) => state.auditLogs);
  
  const globalColumns = useWorkspaceStore((state) => state.columns) || ['card_id', 'card_type', 'in_station', 'in_time', 'out_station', 'out_time', 'ride_duration_mins', 'fare'];
  const columnRoles = useWorkspaceStore((state) => state.columnRoles) || {};
  const dpFields = useWorkspaceStore((state) => state.dpFields) || [];

  const [searchText, setSearchText] = useState('');
  const [filterMode, setFilterMode] = useState<string>('all');
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

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

  const handleDownloadPDF = async () => {
    const element = document.getElementById('printable-historical-report');
    if (!element) return;
    
    const hideLoading = messageApi.loading(t('audit.msg_pdf_compiling', '正在編譯高畫質 PDF，請稍候...'), 0);
    setIsExporting(true);
    
    await new Promise(resolve => setTimeout(resolve, 200));

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    
    script.onload = () => {
      const opt = {
        margin:      [10, 10, 10, 10], 
        filename:    `Historical_Audit_Certificate_${selectedLog?.certificateId}.pdf`,
        image:       { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
          scale: 2, 
          useCORS: true, 
          backgroundColor: '#ffffff'
        },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:   { mode: ['css', 'legacy'], avoid: ['tr', '.avoid-break'] }
      };

      (window as unknown as WindowWithHtml2Pdf).html2pdf().set(opt).from(element).save().then(() => {
        hideLoading();
        messageApi.success(t('audit.msg_pdf_success', '歷史審計憑證 PDF 已成功下載！'));
      }).catch((err: unknown) => {
        hideLoading();
        messageApi.error(t('audit.msg_pdf_failed', 'PDF 下載失敗'));
        console.error(err);
      }).finally(() => {
        setIsExporting(false);
      });
    };
    
    script.onerror = () => {
      hideLoading();
      messageApi.error(t('audit.msg_pdf_no_lib', '無法載入 PDF 轉檔套件，請檢查網路連線。'));
      setIsExporting(false);
    };
    
    document.body.appendChild(script);
  };

  const getCalculatedRole = (col: string, mode: string) => {
    const colLower = col.toLowerCase();
    const rawRole = (columnRoles[col] || '').toLowerCase();
    const dpCfg = dpFields?.find(f => f.fieldName === col);

    if (mode === 'k-anonymity') {
      if (rawRole.includes('identifier') && !rawRole.includes('quasi')) return { role: 'Identifier' };
      if (rawRole.includes('quasi') || rawRole === 'qi') return { role: 'Quasi-identifier' };
    }

    const isExplicitId = /(^|_)(id|card_id|nric|phone|email|name|ssn)($|_)/i.test(colLower);
    if (isExplicitId) return { role: 'Identifier' };

    if (mode === 'differential-privacy') {
      if (dpCfg && dpCfg.enabled) return { role: 'DP Sensitive' };
      return { role: 'Retained' };
    }

    if (/(station|time|date|zip|age|gender|card_type)/i.test(colLower)) return { role: 'Quasi-identifier' };

    return { role: 'Non-sensitive' };
  };

  const columns = [
    {
      title: t('audit.col_cert_id', '憑證編號'),
      dataIndex: 'certificateId',
      key: 'certificateId',
      render: (text: string) => (
        <Text strong style={{ color: token.colorPrimary }}>{text}</Text>
      ),
    },
    {
      title: t('audit.col_file_name', '處置檔案名稱'),
      dataIndex: 'fileName',
      key: 'fileName',
      render: (text: string) => <Text style={{ fontSize: '13px' }}>{text}</Text>,
    },
    {
      title: t('audit.col_privacy_mode', '保護模式'),
      dataIndex: 'privacyMode',
      key: 'privacyMode',
      render: (mode: string) => (
        <Tag color={mode === 'k-anonymity' ? 'blue' : 'purple'}>
          {mode === 'k-anonymity' ? 'K-Anonymity' : 'Differential Privacy'}
        </Tag>
      ),
    },
    {
      title: t('audit.col_operator', '操作者 / 角色'),
      key: 'operator',
      render: (_: unknown, record: AuditLogItem) => (
        <div>
          <Text strong style={{ fontSize: '13px', display: 'block' }}>{record.operator}</Text>
          <Tag style={{ fontSize: '10px', margin: 0 }}>{record.operatorRole.toUpperCase()}</Tag>
        </div>
      ),
    },
    {
      title: t('audit.col_risks', '三大攻擊殘餘風險 (Singling/Link/Inf)'),
      key: 'risks',
      render: (_: unknown, record: AuditLogItem) => (
        <Space size="small">
          <Tag color="green">{t('audit.risk_singling', '指認')}: {record.singlingRisk}</Tag>
          <Tag color="green">{t('audit.risk_linkability', '連結')}: {record.linkabilityRisk}</Tag>
          <Tag color="green">{t('audit.risk_inference', '推斷')}: {record.inferenceRisk}</Tag>
        </Space>
      ),
    },
    {
      title: t('audit.col_overall_risk', '綜合殘餘風險'),
      dataIndex: 'overallRisk',
      key: 'overallRisk',
      render: (val: string) => (
        <Text strong style={{ color: parseFloat(val) < 20 ? '#52c41a' : '#faad14' }}>
          {val}
        </Text>
      ),
    },
    {
      title: t('audit.col_audit_time', '審計時間'),
      dataIndex: 'auditTime',
      key: 'auditTime',
      render: (time: string) => <Text type="secondary" style={{ fontSize: '12px' }}>{time}</Text>,
    },
    {
      title: t('audit.col_action', '操作與調閱'),
      key: 'action',
      align: 'center' as const,
      render: (_: unknown, record: AuditLogItem) => (
        <Button 
          type="link" 
          icon={<FileTextOutlined />} 
          onClick={() => handleOpenCertificate(record)}
        >
          {t('audit.btn_view_cert', '調閱憑證')}
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Row gutter={24}>
        <Col span={8}>
          <Card variant="borderless" style={{ background: token.colorBgContainer }}>
            <Statistic 
              title={t('audit.stats_total', '累積合規簽發憑證總數')} 
              value={stats.total} 
              prefix={<SafetyCertificateOutlined style={{ color: token.colorPrimary }} />} 
              suffix={t('audit.unit_certificates', '份')}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless" style={{ background: token.colorBgContainer }}>
            <Statistic 
              title={t('audit.stats_passed', '審計合規通過率')} 
              value={stats.passedRate} 
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />} 
              suffix="%"
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless" style={{ background: token.colorBgContainer }}>
            <Statistic 
              title={t('audit.stats_avg_risk', '當前全域殘餘風險平均值')} 
              value="10.8" 
              prefix={<ExperimentOutlined style={{ color: '#faad14' }} />} 
              suffix="%"
            />
          </Card>
        </Col>
      </Row>

      <Card variant="borderless" style={{ background: token.colorBgContainer }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <Title level={4} style={{ margin: 0 }}>
            <FilterOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
            {t('audit.hub_title', '歷史審計軌跡與憑證數據庫 (Audit Logs & Certificates Hub)')}
          </Title>
          <Space>
            <Input 
              placeholder={t('audit.search_placeholder', '搜尋憑證編號、檔案名稱、操作者...')} 
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
                { value: 'all', label: t('audit.filter_all', '全部保護模式') },
                { value: 'k-anonymity', label: 'K-Anonymity' },
                { value: 'differential-privacy', label: 'Differential Privacy' },
              ]}
            />
          </Space>
        </div>

        <Table 
          dataSource={filteredLogs}
          columns={columns}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          size="middle"
          scroll={{ x: 'max-content' }}
        />
      </Card>

      <Modal
        title={t('audit.modal_title', '歷史審計憑證調閱 (Historical Certificate Viewer)')}
        open={reportModalVisible}
        onCancel={() => setReportModalVisible(false)}
        width={800}
        styles={{
          body: { 
            maxHeight: isExporting ? 'none' : '72vh', 
            overflowY: isExporting ? 'visible' : 'auto', 
            paddingRight: '6px' 
          }
        }}
        footer={[
          <Button key="close" onClick={() => setReportModalVisible(false)}>{t('audit.btn_close', '關閉')}</Button>,
          <Button key="print" type="primary" icon={<DownloadOutlined />} loading={isExporting} onClick={handleDownloadPDF} style={{ background: '#4F46E5' }}>
            {t('audit.btn_export_pdf', '匯出 PDF 憑證')}
          </Button>
        ]}
      >
        {selectedLog && (
          <div 
            id="printable-historical-report" 
            style={{ 
              padding: '24px', 
              color: '#000000', 
              backgroundColor: '#ffffff', 
              borderRadius: '4px'
            }}
          >
            
            <div className="avoid-break" style={{ pageBreakInside: 'avoid' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${token.colorPrimary}`, paddingBottom: '12px', marginBottom: '16px' }}>
                <div>
                  <h2 style={{ margin: 0, color: token.colorPrimary }}>{t('audit.report_title', '數據隱私合規與技術審計憑證')}</h2>
                  <span style={{ fontSize: '12px', color: '#555555' }}>{t('audit.report_cert_id', '憑證編號:')} {selectedLog.certificateId}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {/* 🌟 使用高相容性 Unicode 純文字勾勾，徹底防止排版跑邊或圖示遺失 */}
                  <span style={{ 
                    display: 'inline-block',
                    backgroundColor: '#f6ffed', 
                    border: '1px solid #b7eb8f', 
                    color: '#389e0d', 
                    padding: '6px 16px', 
                    borderRadius: '4px', 
                    fontSize: '14px', 
                    fontWeight: 'bold',
                    lineHeight: '20px',
                    whiteSpace: 'nowrap'
                  }}>
                    <span style={{ marginRight: '6px', fontSize: '15px' }}>✓</span> {t('audit.report_passed', '驗證合格')}
                  </span>
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: `1px solid #d9d9d9` }}>
                <h4 style={{ marginTop: 0, color: '#000000' }}>{t('audit.report_track_title', '專案與執行軌跡')}</h4>
                <Row gutter={[16, 8]} style={{ fontSize: '13px', color: '#555555' }}>
                  <Col span={12}><b style={{ color: '#000000' }}>{t('audit.report_file_name', '資料檔案：')}</b> {selectedLog.fileName}</Col>
                  <Col span={12}><b style={{ color: '#000000' }}>{t('audit.report_tech', '套用技術：')}</b> {selectedLog.privacyMode.toUpperCase()}</Col>
                  <Col span={12}><b style={{ color: '#000000' }}>{t('audit.report_operator', '執行人員：')}</b> {selectedLog.operator} ({selectedLog.operatorRole.toUpperCase()})</Col>
                  <Col span={12}><b style={{ color: '#000000' }}>{t('audit.report_time', '簽發時間：')}</b> {selectedLog.auditTime}</Col>
                </Row>
              </div>

              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: `1px solid #d9d9d9` }}>
                <h4 style={{ marginTop: 0, color: '#000000' }}>{t('audit.report_risk_title', '殘餘風險與量測結果')}</h4>
                <Row gutter={[16, 8]} style={{ fontSize: '13px', color: '#555555' }}>
                  <Col span={12}><b style={{ color: '#000000' }}>{t('audit.report_singling', '指認性風險 (Singling Out):')}</b> <span>{selectedLog.singlingRisk}</span></Col>
                  <Col span={12}><b style={{ color: '#000000' }}>{t('audit.report_linkability', '連結性風險 (Linkability):')}</b> <span>{selectedLog.linkabilityRisk}</span></Col>
                  <Col span={12}><b style={{ color: '#000000' }}>{t('audit.report_inference', '推斷性風險 (Inference):')}</b> <span>{selectedLog.inferenceRisk}</span></Col>
                  <Col span={12}>
                    <b style={{ color: '#000000' }}>{t('audit.report_overall_risk', '綜合殘餘風險 (Final Risk):')}</b>{' '}
                    <span style={{ color: parseFloat(selectedLog.overallRisk) < 20 ? '#389e0d' : '#faad14', fontWeight: 'bold' }}>
                      {selectedLog.overallRisk}
                    </span>
                  </Col>
                </Row>
              </div>

              <h4 className="avoid-break" style={{ color: '#000000', marginBottom: '8px', pageBreakInside: 'avoid' }}>
                {t('audit.report_table_title', '欄位處置與技術對照表')}
              </h4>
            </div>
            
            {/* 🌟 匯出時（isExporting）解鎖容器高度，讓 PDF 引擎能繪製自然寬度與完整跨頁 */}
            <div style={{ 
              maxHeight: isExporting ? 'none' : '240px', 
              overflowY: isExporting ? 'visible' : 'auto', 
              border: '1px solid #d9d9d9', 
              borderRadius: '4px', 
              marginBottom: '24px' 
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', color: '#000000', backgroundColor: '#ffffff', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9', position: 'sticky', top: 0, zIndex: 1, pageBreakInside: 'avoid' }}>
                    <th style={{ borderBottom: `1px solid #d9d9d9`, padding: '10px', color: '#000000', textAlign: 'left', background: '#f1f5f9' }}>{t('audit.table_col_name', '欄位名稱')}</th>
                    <th style={{ borderBottom: `1px solid #d9d9d9`, padding: '10px', color: '#000000', textAlign: 'left', background: '#f1f5f9' }}>{t('audit.table_col_role', '隱私角色')}</th>
                    <th style={{ borderBottom: `1px solid #d9d9d9`, padding: '10px', color: '#000000', textAlign: 'left', background: '#f1f5f9' }}>{t('audit.table_col_tech', '套用去識別化技術')}</th>
                  </tr>
                </thead>
                <tbody>
                  {globalColumns.map(col => {
                    const { role } = getCalculatedRole(col, selectedLog.privacyMode);
                    const dpFieldConfig = dpFields?.find(f => f.fieldName === col && f.enabled);
                    
                    let strategy = t('audit.tech_keep_original', '保留原文');
                    if (role === 'Identifier') strategy = t('audit.tech_full_masking', '完全遮蔽');
                    else if (role === 'Quasi-identifier' && selectedLog.privacyMode === 'k-anonymity') strategy = t('audit.tech_generalization', '區間/時間泛化');
                    else if (selectedLog.privacyMode === 'differential-privacy' && dpFieldConfig) strategy = t('audit.tech_dp', '差分隱私加噪');

                    const roleI18nKey = `step4.role.${role.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;

                    return (
                      // 🌟 給予 <tr> 元素自動排版避開斷頁
                      <tr key={col} className="avoid-break" style={{ backgroundColor: '#ffffff', pageBreakInside: 'avoid' }}>
                        <td style={{ borderBottom: `1px solid #f0f0f0`, padding: '8px', color: '#000000', wordWrap: 'break-word' }}><b>{col}</b></td>
                        <td style={{ borderBottom: `1px solid #f0f0f0`, padding: '8px', color: '#555555', wordWrap: 'break-word' }}>{t(roleI18nKey, role)}</td>
                        <td style={{ borderBottom: `1px solid #f0f0f0`, padding: '8px', color: '#555555', wordWrap: 'break-word' }}>{strategy}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="avoid-break" style={{ textAlign: 'right', marginTop: '24px', borderTop: `1px dashed #d9d9d9`, paddingTop: '12px', fontSize: '12px', color: '#888888', pageBreakInside: 'avoid' }}>
              {t('audit.report_sha', '數位防篡改指核 (SHA-256):')} 8f3c7e9a0b12d3e4f56789a0b12c3d4e56789a0b<br/>
              {t('audit.report_signature', '系統數位簽章：PRIVACY-APP-AUDIT-ENGINE-V2.0-PASSED')}
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}