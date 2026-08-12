import { Card, Table, Select, Input, Typography, theme, Space, Alert } from 'antd';
import { ToolOutlined, SafetyOutlined, ArrowRightOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import CryptoJS from 'crypto-js'; // 🌟 引入標準密碼學套件，取代不安全的自製迴圈

import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useAuthStore } from '../../store/useAuthStore';

import KAnonymityMapping from './KAnonymityMapping';
import DifferentialPrivacyMapping from './DifferentialPrivacyMapping';
import TemplateManager from './TemplateManager';

const { Text } = Typography;

interface MappingRecord {
  key: string;
  name: string;
  action: string;
  param: string;
  sampleValue: string;
}

const applyPreprocess = (val: unknown, action: string, param: string) => {
  if (val == null || val === '') return '-';
  let str = String(val);
  if (action === 'none' || !action) return str;
  
  if (action === 'remove_digits') {
    str = str.replace(/\d+/g, '');
  } else if (action === 'remove_spaces') {
    str = str.replace(/\s+/g, '');
  } else if (action === 'keep_before' && param) {
    const idx = str.indexOf(param);
    str = idx !== -1 ? str.substring(0, idx) : '-';
  } else if (action === 'keep_until' && param) {
    const idx = str.indexOf(param);
    str = idx !== -1 ? str.substring(0, idx + param.length) : '-';
  } else if (action === 'regex_replace' && param) {
    try {
      const reg = new RegExp(param, 'g');
      str = str.replace(reg, '');
    } catch{ /* ignore */ }
  } else if (action === 'hash') {
    // 🌟 使用真實的密碼學雜湊演算法
    try {
      let hashResult = '';
      const cleanParam = param?.toLowerCase().trim();
      
      if (cleanParam === 'md5') {
        hashResult = CryptoJS.MD5(str).toString();
      } else if (cleanParam === 'sha512') {
        hashResult = CryptoJS.SHA512(str).toString();
      } else {
        // 預設使用業界標準的 SHA-256
        hashResult = CryptoJS.SHA256(str).toString();
      }
      
      // 為了 UI 預覽美觀，擷取前 16 碼並加上刪節號
      str = hashResult.substring(0, 16) + '...';
    } catch (error) {
      console.error('Hashing error:', error);
      str = 'Hash Error';
    }
  }
  
  return str || '-';
};

export default function Step2_Mapping() {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const { t } = useTranslation();

  const user = useAuthStore(state => state.user);
  const canEditRules = user?.role === 'data_owner'; 

  const privacyMode = useWorkspaceStore(state => state.privacyMode);
  const columns = useWorkspaceStore(state => state.columns);
  const previewData = useWorkspaceStore(state => state.previewData);
  const preprocessingRules = useWorkspaceStore(state => state.preprocessingRules) || {};
  const setPreprocessingRules = useWorkspaceStore(state => state.setPreprocessingRules);

  const handleRuleChange = (col: string, key: 'action' | 'param', val: string) => {
    if (!canEditRules) return;
    setPreprocessingRules({
      ...preprocessingRules,
      [col]: {
        ...(preprocessingRules[col] || { action: 'none', param: '' }),
        [key]: val
      }
    });
  };

  const actionsRequiringParam = ['keep_before', 'keep_until', 'regex_replace'];
  const errorCols = columns.filter(col => {
    const rule = preprocessingRules[col];
    return rule && actionsRequiringParam.includes(rule.action) && (!rule.param || rule.param.trim() === '');
  });

  const tableData: MappingRecord[] = columns.map(col => ({
    key: col,
    name: col,
    action: preprocessingRules[col]?.action || 'none',
    param: preprocessingRules[col]?.param || '',
    sampleValue: previewData.length > 0 ? String(previewData[0][col] || '-') : '-'
  }));

  const preColumns = [
    {
      title: t('step2.col_name', '欄位名稱'),
      dataIndex: 'name', 
      width: '20%',
      render: (text: string) => <Text strong>{text}</Text>
    },
    {
      title: t('step2.clean_strategy', 'Cleansing Strategy'),
      dataIndex: 'action', 
      width: '25%',
      render: (val: string, record: MappingRecord) => (
        <Select
          value={val}
          onChange={(v) => handleRuleChange(record.name, 'action', v)}
          disabled={!canEditRules}
          style={{ width: '100%' }}
          options={[
            { value: 'none', label: t('step2.no_action', '不處理') },
            { value: 'remove_digits', label: t('step2.remove_digits', '移除數字') },
            { value: 'remove_spaces', label: t('step2.remove_spaces', '移除空白') },
            { value: 'keep_before', label: t('step2.keep_before', '保留特定字元前文字') },
            { value: 'keep_until', label: t('step2.keep_until', '保留至特定字元(含)') },
            { value: 'regex_replace', label: t('step2.regex_replace', '正則表達式汱除') },
            { value: 'hash', label: t('step2.hash', '雜湊 (Hash)') }
          ]}
        />
      )
    },
    {
      title: t('step2.param_setting', 'Parameter Setting'),
      dataIndex: 'param', 
      width: '20%',
      render: (val: string, record: MappingRecord) => {
        const disabled = !canEditRules || ['none', 'remove_digits', 'remove_spaces'].includes(record.action);
        const hasError = errorCols.includes(record.name);
        
        return (
          <Input
            placeholder={record.action === 'hash' ? t('step2.input_hash', '選填 (如: md5, sha512)') :(disabled ? '-' : t('step2.input_regex', '請輸入關鍵字或 Regex'))}
            value={val}
            onChange={(e) => handleRuleChange(record.name, 'param', e.target.value)}
            disabled={disabled}
            status={hasError ? 'error' : undefined}
            style={{ width: '100%', backgroundColor: hasError ? (isDark ? '#2c1618' : '#fff2f0') : undefined }}
          />
        );
      }
    },
    {
      title: t('step2.live_preview', '即時預覽 (取首筆資料)'),
      key: 'preview', 
      width: '35%',
      render: (_: unknown, record: MappingRecord) => {
        const original = record.sampleValue;
        const processed = applyPreprocess(original, record.action, record.param);
        const isChanged = original !== processed;
        return (
          <Space style={{ display: 'flex', flexWrap: 'wrap' }}>
            <Text type="secondary" delete={isChanged}>{original}</Text>
            {isChanged && <ArrowRightOutlined style={{ color: token.colorPrimary, fontSize: 12 }} />}
            {isChanged && <Text style={{ color: token.colorPrimary, fontWeight: 600 }}>{processed}</Text>}
          </Space>
        );
      }
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {!canEditRules && (
        <Alert type="info" showIcon icon={<LockOutlined />} message="唯讀保護模式 (Read-Only Mode)" description="當前角色無權限修改欄位屬性與預先處理規則。畫面設定已全數鎖定，僅供瀏覽與預覽。" />
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <TemplateManager />
      </div>

      <Card 
        title={<span style={{ fontWeight: 600 }}><ToolOutlined style={{ marginRight: 8, color: token.colorPrimary }} /> {t('step2.stage1_title', '第一階段：資料預先處理 (選填)')}</span>}
        variant="borderless" 
        style={{ background: token.colorBgContainer, padding: 0 }}
        styles={{ body: { padding: '16px' } }}
      >
        <Table dataSource={tableData} columns={preColumns} pagination={false} size="small" bordered={false} rowKey="key" scroll={{ y: 250 }} style={{ background: isDark ? '#141414' : '#fafafa', borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}` }} />
      </Card>

      <Card 
        title={<span style={{ fontWeight: 600 }}><SafetyOutlined style={{ marginRight: 8, color: '#52c41a' }} /> {privacyMode === 'k-anonymity' ? t('step2.stage2_title_k', '第二階段：隱私強化技術設定 (K-匿名化)') : t('step2.stage2_title_dp', '第二階段：隱私強化技術設定 (差分隱私)')}</span>}
        variant="borderless" 
        style={{ background: token.colorBgContainer }}
        styles={{ body: { padding: 0 } }} 
      >
        {privacyMode === 'k-anonymity' ? <KAnonymityMapping /> : <DifferentialPrivacyMapping />}
      </Card>

      <style>{`.ant-table-thead > tr > th { background: ${isDark ? '#262626' : '#f0f2f5'} !important; }`}</style>
    </div>
  );
}