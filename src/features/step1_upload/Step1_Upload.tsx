import { useState } from 'react';
import { Card, Upload, Table, Alert, Button, Space, Typography, Popconfirm, theme, App as AntdApp, Radio, Row, Col, Spin } from 'antd';
import { InboxOutlined, FileExcelOutlined, DeleteOutlined, CheckCircleFilled, SafetyCertificateOutlined, CodeSandboxOutlined } from '@ant-design/icons';
import Papa from 'papaparse';
import { useTranslation } from 'react-i18next';

// 🌟 1. 改為引入拆分後的 Workspace Store
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

const { Dragger } = Upload;
const { Text, Title } = Typography;

export default function Step1_Upload() {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  
  const { message: messageApi } = AntdApp.useApp();
  const { t } = useTranslation();
  
  // 🌟 2. 從 Workspace Store 取得對應狀態與操作
  const columns = useWorkspaceStore((state) => state.columns);
  const previewData = useWorkspaceStore((state) => state.previewData);
  const fileName = useWorkspaceStore((state) => state.fileName);
  // 注意：確保你的 useWorkspaceStore 中已經補上了 setFileData 與 clearFileData
  const setFileData = useWorkspaceStore((state) => state.setFileData);
  const clearFileData = useWorkspaceStore((state) => state.clearFileData);
  
  const privacyMode = useWorkspaceStore((state) => state.privacyMode);
  const setPrivacyMode = useWorkspaceStore((state) => state.setPrivacyMode);
  const nextStep = useWorkspaceStore((state) => state.nextStep);
  
  const [isUploading, setIsUploading] = useState(false);

  const hasData = columns && columns.length > 0;

  const handleFileUpload = (file: File) => {
    const MAX_FILE_SIZE_MB = 500;
    const isLt50M = file.size / 1024 / 1024 < MAX_FILE_SIZE_MB;

    if (!isLt50M) {
      messageApi.error(t('step1.error_file_too_large', '檔案大小不能超過 500MB！'));
      return false;
    }

    setIsUploading(true);
    
    // 🌟 3. 效能優化：啟用 Web Worker 並限制讀取筆數
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      worker: true,       // 移至背景執行緒解析，徹底解決 UI 凍結問題
      preview: 1000,      // 前端僅需預覽設定，限制讀取前 1000 筆防止記憶體溢出
      complete: (results) => {
        const parsedColumns = results.meta.fields || [];
        const rawData = results.data as Record<string, unknown>[];

        // 因為已經使用了 preview，rawData 保證在安全數量內，無須再次 slice
        setFileData(parsedColumns, rawData, file.name);
        
        if (!privacyMode) setPrivacyMode('k-anonymity');
        
        setIsUploading(false);
        messageApi.success(t('step1.parse_success', { file: file.name }));
      },
      error: (error) => {
        setIsUploading(false);
        messageApi.error(t('step1.parse_error', { error: error.message }));
      }
    });

    return false;
  };

  const handleClear = () => {
    clearFileData();
    messageApi.success(t('step1.clear_success'));
  };

  const tableColumns = columns.map(col => ({
    title: col,
    dataIndex: col,
    key: col,
    ellipsis: true,
  }));

  const displayPreviewData = previewData.slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {!hasData ? (
        <Card variant="borderless" style={{ background: token.colorBgContainer, borderRadius: 12 }}>
          <Alert 
            title={t('step1.upload_title')} 
            description={t('step1.upload_desc')} 
            type="info" 
            showIcon 
            style={{ marginBottom: 24 }}
          />
          <Spin spinning={isUploading} description="解析檔案中...">
            <Dragger 
              name="file" 
              multiple={false} 
              accept=".csv, .xlsx, .xls"
              beforeUpload={handleFileUpload}
              showUploadList={false}
              disabled={isUploading}
              style={{ padding: '40px 0', background: isDark ? '#141414' : '#fafafa' }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined style={{ color: token.colorPrimary, fontSize: 48 }} />
              </p>
              <Title level={4} style={{ marginTop: 16 }}>
                {t('step1.drag_text')}
              </Title>
              <Text type="secondary">
                {t('step1.drag_hint')}
              </Text>
            </Dragger>
          </Spin>
        </Card>
      ) : (
        <>
          <Alert 
            title={
              <Space>
                <CheckCircleFilled style={{ color: '#52c41a' }} />
                <span style={{ fontWeight: 600 }}>{t('step1.dataset_ready')}</span>
              </Space>
            }
            description={t('step1.dataset_desc')}
            type="success"
            style={{ border: `1px solid #b7eb8f` }}
          />

          <Card 
            title={
              <Space>
                <FileExcelOutlined style={{ color: '#52c41a', fontSize: 18 }} />
                <span>{t('step1.current_file')} <Text strong>{fileName || 'dataset.csv'}</Text></span>
              </Space>
            } 
            extra={
              <Popconfirm 
                title={t('step1.clear_confirm')} 
                onConfirm={handleClear} 
                okText={t('step1.btn_clear')} 
                cancelText={t('step1.btn_cancel')}
              >
                <Button danger icon={<DeleteOutlined />}>{t('step1.reupload')}</Button>
              </Popconfirm>
            }
            variant="borderless" 
            style={{ background: token.colorBgContainer }}
            styles={{ body: { padding: 0 } }}
          >
            <div style={{ padding: '16px 24px', background: isDark ? '#1d1d1d' : '#f8fafc', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
              <Text strong style={{ fontSize: 14, color: token.colorTextSecondary }}>
                {t('step1.preview_title', { count: displayPreviewData.length })}
              </Text>
            </div>
            <Table 
              dataSource={displayPreviewData} 
              columns={tableColumns} 
              pagination={false} 
              rowKey={(record) => JSON.stringify(record)}
              size="small"
              scroll={{ x: 'max-content' }}
              style={{ background: isDark ? '#141414' : '#fff' }}
            />
          </Card>

          <Card variant="borderless" style={{ background: token.colorBgContainer }}>
            <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '16px', color: token.colorText }}>
              {t('step1.select_mode')}
            </div>
            <Radio.Group 
              onChange={(e) => setPrivacyMode(e.target.value)} 
              value={privacyMode} 
              style={{ width: '100%' }}
            >
              <Row gutter={16}>
                <Col span={12}>
                  <Radio.Button 
                    value="k-anonymity" 
                    className="privacy-mode-btn"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      <SafetyCertificateOutlined style={{ fontSize: 24, color: privacyMode === 'k-anonymity' ? token.colorPrimary : token.colorTextSecondary }} />
                      <span style={{ fontSize: 16, fontWeight: 'bold' }}>{t('step1.k_anon_title')}</span>
                    </div>
                    <div style={{ fontSize: 13, color: token.colorTextDescription, whiteSpace: 'normal', lineHeight: 1.5, textAlign: 'left' }}>
                      {t('step1.k_anon_desc')}
                    </div>
                  </Radio.Button>
                </Col>
                <Col span={12}>
                  <Radio.Button 
                    value="differential-privacy" 
                    className="privacy-mode-btn"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      <CodeSandboxOutlined style={{ fontSize: 24, color: privacyMode === 'differential-privacy' ? token.colorPrimary : token.colorTextSecondary }} />
                      <span style={{ fontSize: 16, fontWeight: 'bold' }}>{t('step1.dp_title')}</span>
                    </div>
                    <div style={{ fontSize: 13, color: token.colorTextDescription, whiteSpace: 'normal', lineHeight: 1.5, textAlign: 'left' }}>
                      {t('step1.dp_desc')}
                    </div>
                  </Radio.Button>
                </Col>
              </Row>
            </Radio.Group>
          </Card>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <Button 
              type="primary" 
              size="large" 
              onClick={nextStep}
              disabled={!privacyMode}
            >
              {t('step1.next_mapping')}
            </Button>
          </div>
        </>
      )}

      <style>{`
        .ant-table-thead > tr > th {
          background: ${isDark ? '#262626' : '#fafafa'} !important;
          color: ${token.colorTextSecondary} !important;
        }
        .privacy-mode-btn {
          height: auto !important;
          width: 100% !important;
          padding: 20px !important;
          border-radius: 12px !important;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          transition: all 0.3s ease;
        }
        .ant-radio-button-wrapper-checked.privacy-mode-btn {
          border-color: ${token.colorPrimary} !important;
          background: ${isDark ? 'rgba(63, 81, 181, 0.15)' : 'rgba(63, 81, 181, 0.05)'} !important;
        }
        .ant-radio-button-wrapper-checked.privacy-mode-btn::before {
          background-color: transparent !important;
        }
      `}</style>
    </div>
  );
}