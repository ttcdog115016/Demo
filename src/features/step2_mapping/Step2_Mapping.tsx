import { useEffect } from 'react';
import { Card, Table, Select, Input, Typography, theme, Space } from 'antd';
import { ToolOutlined, SafetyOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import KAnonymityMapping from './KAnonymityMapping';
import DifferentialPrivacyMapping from './DifferentialPrivacyMapping';
import TemplateManager from './TemplateManager';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

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
    // 簡易 Hash 模擬邏輯
    let hashVal = 0;
    for (let i = 0; i < str.length; i++) { 
      hashVal = ((hashVal << 5) - hashVal) + str.charCodeAt(i); 
      hashVal |= 0; 
    }
    const hex = Math.abs(hashVal).toString(16).padStart(8, '0');
    // 可透過 param 決定 hash 類型，預設為模擬 SHA-256 的長度
    if (param === 'md5') str = hex + hex + '...';
    else if (param === 'sha512') str = hex.repeat(4) + '...';
    else str = hex.repeat(2) + '...'; 
  }
  
  return str || '-';
};

export default function Step2_Mapping() {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const { t } = useTranslation();

  const privacyMode = usePrivacyStore(state => state.privacyMode);
  const columns = usePrivacyStore(state => state.columns);
  const previewData = usePrivacyStore(state => state.previewData);
  const dpFields = usePrivacyStore(state => state.dpFields);
  const columnRoles = usePrivacyStore(state => state.columnRoles);
  
  const rawPreprocessingRules = usePrivacyStore(state => state.preprocessingRules);
  const preprocessingRules = rawPreprocessingRules || {};
  const setStepValidation = usePrivacyStore(state => state.setStepValidation);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setPreprocessingRules = (rules: any) => usePrivacyStore.setState({ preprocessingRules: rules } as any);

  const handleRuleChange = (col: string, key: 'action' | 'param', val: string) => {
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

  useEffect(() => {
    const hasPreprocessError = errorCols.length > 0;
    let hasDpError = false;
    let dpErrorMessage = '';

    let hasKError = false;
    let kErrorMessage = '';
    
    if (privacyMode === 'differential-privacy') {
      const enabledFields = dpFields.filter(f => f.enabled);
      
      const hasTextDp = enabledFields.some(f => f.fieldType === 'Text' || f.fieldType === 'Text型');
      const invalidNumeric = enabledFields.some(f => 
        (f.fieldType === 'Numeric' || f.fieldType === 'Numeric型') && 
        (f.lowerBound === undefined || f.upperBound === undefined)
      );

      if (hasTextDp) {
        hasDpError = true;
        dpErrorMessage = t('step2.dp_text_error', '【設定錯誤】純文本型資料無法套用差分隱私，請關閉「文本型」欄位的 DP 開關，並改用上方的資料預先策略。');
      } else if (invalidNumeric) {
        hasDpError = true;
        dpErrorMessage = t('step2.validation_error', '設定尚未完成，請確認所有啟用的「數值型」欄位皆已填寫最小值與最大值。');
      }
    }

    // K-匿名模式驗證
    if (privacyMode === 'k-anonymity') {
      const hasQuasiIdentifier = Object.values(columnRoles || {}).some(role => role === 'Quasi-identifier');
      if (!hasQuasiIdentifier) {
        hasKError = true;
        kErrorMessage = t('step2.k_validation_error', '【設定錯誤】K-匿名模式至少需要設定一個「準識別碼」。');
      }
    }

    if (hasPreprocessError) {
      setStepValidation(false, t('step2.preprocess_validation_error', '資料預先處理有未填寫的參數，請確認紅色框線欄位並輸入完畢。'));
    } else if (hasDpError) {
      setStepValidation(false, dpErrorMessage);
    }
    else if (hasKError) {
      setStepValidation(false, kErrorMessage); // 阻擋沒有準識別碼的 K-匿名設定
    } else {
      setStepValidation(true, null);
    }
    
    return () => setStepValidation(true, null);
  }, [errorCols.length, dpFields, privacyMode, columnRoles , setStepValidation, t]);
  
  const tableData = columns.map(col => ({
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (val: string, record: any) => (
        <Select
          value={val}
          onChange={(v) => handleRuleChange(record.name, 'action', v)}
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (val: string, record: any) => {
        const disabled = ['none', 'remove_digits', 'remove_spaces'].includes(record.action);
        const hasError = errorCols.includes(record.name);
        
        return (
          <Input
            placeholder={record.action === 'hash' ? t('step2.input_hash', '選填 (如: md5, sha512)') :(disabled ? '-' : t('step2.input_regex', '請輸入關鍵字或 Regex'))}
            value={val}
            onChange={(e) => handleRuleChange(record.name, 'param', e.target.value)}
            disabled={disabled}
            status={hasError ? 'error' : undefined}
            style={{ 
              width: '100%', 
              backgroundColor: hasError ? (isDark ? '#2c1618' : '#fff2f0') : undefined
            }}
          />
        );
      }
    },
    {
      title: t('step2.live_preview', '即時預覽 (取首筆資料)'),
      key: 'preview', 
      width: '35%',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (_: any, record: any) => {
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
      
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <TemplateManager />
      </div>

      <Card 
        title={<span style={{ fontWeight: 600 }}><ToolOutlined style={{ marginRight: 8, color: token.colorPrimary }} /> {t('step2.stage1_title', '第一階段：資料預先處理 (選填)')}</span>}
        variant="borderless" 
        style={{ background: token.colorBgContainer, padding: 0 }}
        styles={{ body: { padding: '16px' } }}
      >
        <Table
          dataSource={tableData}
          columns={preColumns}
          pagination={false}
          size="small"
          bordered={false}
          rowKey="key"
          scroll={{ y: 250 }} 
          style={{ background: isDark ? '#141414' : '#fafafa', borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}` }}
        />
      </Card>

      <Card 
        title={<span style={{ fontWeight: 600 }}><SafetyOutlined style={{ marginRight: 8, color: '#52c41a' }} /> {privacyMode === 'k-anonymity' ? t('step2.stage2_title_k', '第二階段：隱私強化技術設定 (K-匿名化)') : t('step2.stage2_title_dp', '第二階段：隱私強化技術設定 (差分隱私)')}</span>}
        variant="borderless" 
        style={{ background: token.colorBgContainer }}
        styles={{ body: { padding: 0 } }} 
      >
        {privacyMode === 'k-anonymity' ? <KAnonymityMapping /> : <DifferentialPrivacyMapping />}
      </Card>

      <style>{`
        .ant-table-thead > tr > th {
          background: ${isDark ? '#262626' : '#f0f2f5'} !important;
        }
      `}</style>
    </div>
  );
}