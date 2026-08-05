import React, { useEffect, useRef, useMemo } from 'react';
import { Card, Table, Select, Button, Input, InputNumber, Switch, theme, Tabs, Space, Collapse, Tooltip, Alert, App as AntdApp } from 'antd';
import { 
  UploadOutlined, DeleteOutlined, PlusOutlined, 
  DatabaseOutlined, CodeOutlined, ThunderboltOutlined, InfoCircleOutlined
} from '@ant-design/icons';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import { useTranslation } from 'react-i18next'; 

type DPField = {
  id: string;
  fieldName: string;
  fieldType: 'Unknown' | 'Numeric' | 'Categorical' | 'Text';
  enabled: boolean;
  mode: 'epsilon' | 'epsilon-delta';
  epsilon: number;
  delta: number;
  lowerBound?: number;
  upperBound?: number;
  allowedCategories?: string;
  maxLength?: number;
};

export default function DifferentialPrivacyMapping() {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  
  const { message: messageApi } = AntdApp.useApp();
  const { t } = useTranslation(); 
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { 
    columns,
    previewData,
    dpFields, 
    setFileData
  } = usePrivacyStore();

  // 🌟 保留本地的更新函數，以確保 UI 絕對不會被卡死
  const updateFieldLocal = <T extends keyof DPField>(id: string, key: T, val: DPField[T]) => {
    usePrivacyStore.setState((state) => ({
      dpFields: state.dpFields.map(f => f.id === id ? { ...f, [key]: val } : f)
    }));
  };

  useEffect(() => {
    if (columns && columns.length > 0 && (!dpFields || dpFields.length === 0)) {
      setFileData(columns, previewData, '');
    }
  }, [columns, dpFields, previewData, setFileData]);

  const validationStatus = useMemo(() => {
    let isValid = true;
    let errorCount = 0;

    dpFields.forEach(field => {
      if (!field.enabled) return; 

      let fieldHasError = false;

      if (!field.fieldName || field.fieldName.trim() === '') {
        fieldHasError = true;
      } else if (field.fieldType === 'Unknown') {
        fieldHasError = true;
      } else if (field.fieldType === 'Numeric') {
        if (field.lowerBound === undefined || field.upperBound === undefined || field.lowerBound === null || field.upperBound === null) {
          fieldHasError = true;
        } else if (Number(field.lowerBound) >= Number(field.upperBound)) {
          fieldHasError = true; 
        }
      } else if (field.fieldType === 'Categorical') {
        if (!field.allowedCategories || field.allowedCategories.trim() === '') {
          fieldHasError = true;
        }
      } else if (field.fieldType === 'Text') {
        if (!field.maxLength || Number(field.maxLength) <= 0) {
          fieldHasError = true;
        }
      }

      if (fieldHasError) {
        isValid = false;
        errorCount++;
      }
    });

    return { isValid, errorCount };
  }, [dpFields]);

  const generateExportJSON = () => {
    const fieldAttributes: Record<string, { type: string; role: string }> = {};
    const dpRules: Record<string, object> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const preprocessingRules = (usePrivacyStore.getState() as any).preprocessingRules || {};

    dpFields.forEach(f => {
      if (!f.fieldName) return;

      let attrType = 'string';
      if (f.fieldType === 'Numeric') attrType = 'numeric';
      else if (f.fieldType === 'Categorical') attrType = 'categorical';
      else if (f.fieldType === 'Text') attrType = 'string';

      fieldAttributes[f.fieldName] = {
        type: attrType,
        role: f.enabled ? (attrType === 'numeric' ? 'sensitive' : 'quasi_identifier') : 'identifier'
      };

      if (f.enabled) {
        type DPRule = {
          enabled: boolean;
          mode: string;
          epsilon: number;
          delta: number;
          bounds?: { lower: number | null | undefined; upper: number | null | undefined };
          allowed_categories?: string[];
          max_length?: number | null | undefined;
        };

        const rule: DPRule = {
          enabled: true,
          mode: f.mode || 'epsilon',
          epsilon: f.epsilon || 1.0,
          delta: f.delta || 0,
        };

        if (f.fieldType === 'Numeric') {
          rule.bounds = { lower: f.lowerBound ? Number(f.lowerBound) : null, upper: f.upperBound ? Number(f.upperBound) : null };
        } else if (f.fieldType === 'Categorical') {
          rule.allowed_categories = f.allowedCategories 
            ? f.allowedCategories.split(',').map((s: string) => s.trim()).filter(Boolean) 
            : [];
        } else if (f.fieldType === 'Text') {
          rule.max_length = f.maxLength ? Number(f.maxLength) : null;
        }
        dpRules[f.fieldName] = rule;
      }
    });

    return {
      version: new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-'),
      dataset: "current_dataset",
      privacy_targets: {
        k_anonymity: { enabled: true, k: 5, suppression_method: "row_suppression", suppression_limit_percent: 5, limit_exceeded_action: "stop_and_error" },
        differential_privacy: { enabled: true, global_target_delta: 0.0001 }
      },
      field_attributes: fieldAttributes,
      preprocessing_rules: Object.keys(preprocessingRules).length > 0 ? preprocessingRules : undefined,
      differential_privacy_rules: Object.keys(dpRules).length > 0 ? dpRules : undefined
    };
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        
        if (Array.isArray(json)) {
          usePrivacyStore.setState({ dpFields: json });
          messageApi.success(t('message.import_array_json_success'));
        } 
        else if (json.field_attributes) {
          const newFields: typeof dpFields = [];
          
          // 🌟 修正：最堅固的 JSON 規則萃取器，強制相容不同版本的 Schema
          interface DPRule {
            epsilon?: number;
            delta?: number;
            bounds?: { lower: number; upper: number };
            mode?: 'epsilon' | 'epsilon-delta';
            // optional fields that may exist in different schema versions
            allowed_categories?: string[];
            max_length?: number | null | undefined;
          }
          let dpRules: Record<string, DPRule> = {};
          
          // 1. 如果有舊版的 rules，先倒進來
          if (json.differential_privacy_rules && Object.keys(json.differential_privacy_rules).length > 0) {
            dpRules = { ...json.differential_privacy_rules };
          }
          
          // 2. 如果有新版的 mechanisms，無條件抓取並覆蓋
          if (json.privacy_targets?.differential_privacy?.field_mechanisms) {
            const mechanisms = json.privacy_targets.differential_privacy.field_mechanisms;
            Object.keys(mechanisms).forEach(key => {
              const mech = mechanisms[key];
              dpRules[key] = {
                epsilon: mech.epsilon_budget,
                delta: mech.delta_budget,
                bounds: mech.clipping_bounds ? { lower: mech.clipping_bounds.min, upper: mech.clipping_bounds.max } : undefined,
                mode: (mech.delta_budget && mech.delta_budget > 0) ? 'epsilon-delta' : 'epsilon'
              };
            });
          }

          const preRules = json.preprocessing_rules || {};
          
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          usePrivacyStore.setState({ preprocessingRules: preRules } as any);

          Object.keys(json.field_attributes).forEach((fieldName) => {
            const attr = json.field_attributes[fieldName];
            const dp = dpRules[fieldName] || {};
            const hasRule = Object.keys(dp).length > 0; // 🌟 如果在 JSON 有找到這個欄位的規則，就是 true
            
            let mappedType: DPField['fieldType'] = 'Unknown';
            if (attr.type === 'numeric') mappedType = 'Numeric';
            else if (attr.type === 'categorical') mappedType = 'Categorical';
            else if (['string', 'temporal'].includes(attr.type)) mappedType = 'Text';
            
            let allowedCat = Array.isArray(dp.allowed_categories) 
              ? dp.allowed_categories.join(',') 
              : dp.allowed_categories || '';

            if (!allowedCat && mappedType === 'Categorical' && json.categorical_hierarchies?.[fieldName]?.mapping) {
              allowedCat = Object.keys(json.categorical_hierarchies[fieldName].mapping).join(',');
            }

            newFields.push({
              id: `import_${Math.random().toString(36).substr(2, 9)}`,
              fieldName: fieldName,
              fieldType: mappedType,
              // 🌟 核心修正：只要是 Text 就強制關閉；若是其他型態，則依據 JSON 內「是否有設定規則」來決定是否啟用
              enabled: mappedType === 'Text' ? false : hasRule, 
              mode: dp.mode || (dp.delta && dp.delta > 0 ? 'epsilon-delta' : 'epsilon'),
              epsilon: dp.epsilon ?? 1.0,
              delta: dp.delta ?? 0.0001,
              lowerBound: dp.bounds?.lower,
              upperBound: dp.bounds?.upper,
              allowedCategories: allowedCat,
              maxLength: dp.max_length || undefined
            });
          });

          usePrivacyStore.setState({ dpFields: newFields });
          messageApi.success(t('message.import_master_json_success'));
        } 
        else {
          messageApi.error(t('message.import_json_format_error'));
        }
      } catch {
        messageApi.error(t('message.import_json_error'));
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = ''; 
      }
    };
    reader.readAsText(file);
  };

  const handleApplyRecommendations = () => {
    const updatedFields = dpFields.map(f => {
      const name = f.fieldName.toLowerCase();
      let enabled = f.enabled;
      let type = f.fieldType;

      if (/(salary|income|fare|credit|amount|ratio|score|age)/.test(name)) {
        enabled = true; type = 'Numeric';
      } else if (/(disease|gender|zipcode|station|city|region)/.test(name)) {
        enabled = true; type = 'Categorical';
      } else if (/(id|name|phone|email)/.test(name)) {
        enabled = false; type = 'Text';
      }
      return { ...f, enabled, fieldType: type !== 'Unknown' ? type : f.fieldType };
    });
    
    usePrivacyStore.setState({ dpFields: updatedFields });
    messageApi.success(t('message.apply_recommend_dp_success'));
  };

  const addField = () => {
    const newField: DPField = {
      id: `custom_${Date.now()}`,
      fieldName: '',
      fieldType: 'Unknown',
      enabled: true,
      mode: 'epsilon',
      epsilon: 1.0,
      delta: 0.0001
    };
    usePrivacyStore.setState({ dpFields: [...dpFields, newField] });
  };

  const removeField = (id: string) => {
    usePrivacyStore.setState({ dpFields: dpFields.filter(f => f.id !== id) });
  };

  const fieldColumns = [
    {
      title: t('step2.col_name'),
      dataIndex: 'fieldName',
      key: 'fieldName',
      width: '16%',
      render: (text: string, record: DPField) => (
        <Tooltip title={text} placement="topLeft" mouseEnterDelay={0.3}>
          <Input 
            value={text} 
            onChange={(e) => updateFieldLocal(record.id, 'fieldName', e.target.value)}
            placeholder={t('step2.ph_eg_salary')}
            status={record.enabled && (!text || !text.trim()) ? 'error' : ''}
            style={{ width: '100%', background: 'transparent', borderRadius: '6px', textOverflow: 'ellipsis' }}
          />
        </Tooltip>
      ),
    },
    {
      title: t('step2.data_type'),
      dataIndex: 'fieldType',
      key: 'fieldType',
      width: '14%',
      render: (type: string, record: DPField) => (
        <Select
          style={{ width: '100%' }}
          value={type === 'Unknown' ? null : type}
          placeholder={t('step2.ph_select')}
          onChange={(val) => {
            const newType = val as 'Numeric' | 'Categorical' | 'Text';
            usePrivacyStore.setState(state => ({
              dpFields: state.dpFields.map(f => 
                f.id === record.id ? { ...f, fieldType: newType, enabled: newType === 'Text' ? false : f.enabled } : f
              )
            }));
          }}
          disabled={!record.enabled && type !== 'Text'}
          status={record.enabled && type === 'Unknown' ? 'error' : ''}
          options={[
            { value: 'Numeric', label: t('step2.opt_dp_numeric') },
            { value: 'Categorical', label: t('step2.opt_dp_categorical') },
            { value: 'Text', label: t('step2.opt_dp_text') },
          ]}
        />
      ),
    },
    {
      title: t('step2.apply_dp'),
      key: 'enabled',
      width: '10%',
      render: (_: unknown, record: DPField) => {
        const isText = record.fieldType === 'Text';
        return (
          <Space>
            <Switch 
              checked={record.enabled} 
              onChange={() => {
                usePrivacyStore.setState(state => ({
                  dpFields: state.dpFields.map(f => f.id === record.id ? { ...f, enabled: !f.enabled } : f)
                }));
              }}
              disabled={isText}
              checkedChildren={t('step2.enable')} 
              unCheckedChildren={t('step2.disable')}
            />
            {isText && (
              <Tooltip title={t('step2.text_dp_disabled_tooltip', '文本型資料無法套用差分隱私，請改用上方的「資料預先清洗」策略。')}>
                <InfoCircleOutlined style={{ color: '#faad14' }} />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: (
        <Space>
          {t('step2.dp_param_settings')}
          <Tooltip title={t('step2.dp_param_tooltip')}>
            <InfoCircleOutlined style={{ color: token.colorTextDescription }} />
          </Tooltip>
        </Space>
      ),
      key: 'bounds',
      width: '55%',
      render: (_: unknown, record: DPField) => {
        if (!record.enabled) return <span style={{ color: token.colorTextDescription }}>-</span>;
        
        if (record.fieldType === 'Numeric') {
          const lower = record.lowerBound;
          const upper = record.upperBound;
          
          const isLowerMissing = lower === undefined || lower === null;
          const isUpperMissing = upper === undefined || upper === null;
          const isOrderInvalid = !isLowerMissing && !isUpperMissing && Number(lower) >= Number(upper);

          const isLowerError = isLowerMissing || isOrderInvalid;
          const isUpperError = isUpperMissing || isOrderInvalid;

          return (
            <Tooltip 
              title={isOrderInvalid ? "下限值必須嚴格小於上限值！" : undefined} 
              open={isOrderInvalid}
              color="volcano"
            >
              <Space.Compact style={{ width: '100%' }}>
                <InputNumber
                  placeholder={t('step2.ph_lower_bound')}
                  value={record.lowerBound}
                  step="any"
                  onChange={(val) => updateFieldLocal(record.id, 'lowerBound', val === null ? undefined : val)}
                  style={{ width: '50%', background: 'transparent' }}
                  status={isLowerError ? 'error' : ''}
                />
                <InputNumber
                  placeholder={t('step2.ph_upper_bound')}
                  value={record.upperBound}
                  step="any"
                  onChange={(val) => updateFieldLocal(record.id, 'upperBound', val === null ? undefined : val)}
                  style={{ width: '50%', background: 'transparent' }}
                  status={isUpperError ? 'error' : ''}
                />
              </Space.Compact>
            </Tooltip>
          );
        }
        
        if (record.fieldType === 'Categorical') {
          return (
            <Input
              placeholder={t('step2.ph_allowed_categories')}
              value={record.allowedCategories}
              onChange={(e) => updateFieldLocal(record.id, 'allowedCategories', e.target.value)}
              status={!record.allowedCategories || record.allowedCategories.trim() === '' ? 'error' : ''}
              style={{ width: '100%', background: 'transparent', borderRadius: '6px' }}
            />
          );
        }

        if (record.fieldType === 'Text') {
          return (
            <InputNumber
              placeholder={t('step2.ph_max_length')}
              value={record.maxLength}
              onChange={(val) => updateFieldLocal(record.id, 'maxLength', val === null ? undefined : val)}
              status={!record.maxLength || record.maxLength <= 0 ? 'error' : ''}
              style={{ width: '100%', background: 'transparent', borderRadius: '6px' }}
              min={1}
            />
          );
        }

        return <span style={{ color: token.colorError }}>{t('step2.select_type_first')}</span>;
      },
    },
    {
      title: t('step2.action'),
      key: 'action',
      width: '5%',
      align: 'center' as const,
      render: (_: unknown, record: DPField) => (
        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeField(record.id)} />
      ),
    }
  ];

  const liveJsonData = generateExportJSON();

  return (
    <Card variant="borderless" style={{ background: 'transparent', padding: 0 }}>
      {!validationStatus.isValid && (
        <Alert
          title={t('step2.incomplete_setting')}
          description={
            <span style={{ fontSize: '13px' }}>
              {t('step2.incomplete_desc_prefix')} <strong>{validationStatus.errorCount}</strong> {t('step2.incomplete_desc_suffix')} (包含未填欄位或下限大於等於上限)
            </span>
          }
          type="error"
          showIcon
          style={{ marginBottom: '16px', padding: '8px 16px', borderRadius: '8px' }}
        />
      )}

      <Tabs 
        defaultActiveKey="1" 
        tabBarExtraContent={
          <Space style={{ paddingBottom: '8px' }}>
            <input 
              type="file" 
              accept=".json" 
              ref={fileInputRef} 
              onChange={handleImportJSON} 
              onClick={(e) => { (e.target as HTMLInputElement).value = ''; }} 
              style={{ display: 'none' }} 
            />
            <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>{t('step2.btn_import')}</Button>
          </Space>
        }
        items={[
          {
            key: '1', 
            label: <span style={{ padding: '0 8px' }}><DatabaseOutlined /> {t('step2.tab_dp_mapping')}</span>,
            children: (
              <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: '8px', padding: '16px 20px', background: isDark ? '#141414' : '#fafafa' }}>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ fontWeight: 600, color: token.colorText }}>{t('step2.col_settings_list')}</div>
                  <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleApplyRecommendations} style={{ background: '#4F46E5', border: 'none', borderRadius: '6px' }}>
                    {t('step2.btn_apply_recommend')}
                  </Button>
                </div>
                
                <div style={{ background: isDark ? '#1d1d1d' : '#ffffff', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${token.colorBorderSecondary}` }}>
                  <Table 
                    dataSource={dpFields as unknown as DPField[]} 
                    columns={fieldColumns} 
                    rowKey="id" 
                    pagination={false} 
                    size="small" 
                    bordered={false} 
                    className="attribute-table" 
                    scroll={{ y: 400 }} 
                  />
                </div>
                
                <Button type="dashed" block icon={<PlusOutlined />} onClick={addField} style={{ marginTop: '16px' }}>
                  {t('step2.btn_add_field')}
                </Button>
              </div>
            )
          }
        ]}
      />

      <div style={{ marginTop: '24px' }}>
        <Collapse 
          ghost 
          items={[
            { 
              key: '1', 
              label: (
                <span style={{ fontWeight: 600, color: token.colorTextSecondary }}>
                  <CodeOutlined style={{ marginRight: '6px' }} /> {t('step2.json_preview')}
                </span>
              ), 
              children: ( 
                <pre style={{ 
                  textAlign: 'left',       
                  maxHeight: '400px',      
                  overflowY: 'auto',       
                  background: isDark ? '#141414' : '#f0f2f5', 
                  padding: '16px', 
                  borderRadius: '8px', 
                  border: `1px solid ${token.colorBorderSecondary}`, 
                  overflowX: 'auto', 
                  fontSize: '13px', 
                  color: isDark ? '#a6accd' : '#333', 
                  margin: 0 
                }}> 
                  {JSON.stringify(liveJsonData, null, 2)} 
                </pre> 
              ) 
            }
          ]} 
        />
      </div>

      <style>{`
        .attribute-table .ant-table-thead > tr > th { 
          background: ${isDark ? '#262626' : '#fafafa'} !important; 
          border-bottom: 1px solid ${token.colorBorderSecondary} !important; 
          color: ${token.colorTextSecondary} !important; 
          font-weight: 500; 
          white-space: nowrap; 
          padding: 8px 8px !important; 
        }
        .attribute-table .ant-table-tbody > tr > td { 
          border-bottom: 1px solid ${token.colorBorderSecondary} !important; 
          padding: 8px 8px !important; 
        }
        .attribute-table .ant-table-expanded-row > td {
          padding: 0 !important;
        }
      `}</style>
    </Card>
  );
}