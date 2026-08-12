import React, { useEffect, useRef, useMemo } from 'react';
import { Card, Table, Select, Button, Input, InputNumber, Switch, theme, Tabs, Space, Collapse, Tooltip, Alert, App as AntdApp } from 'antd';
import { 
  UploadOutlined, DeleteOutlined, PlusOutlined, 
  DatabaseOutlined, CodeOutlined, ThunderboltOutlined, InfoCircleOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next'; 

// 🌟 明確加上 type 匯入，解決 ts(1484) 錯誤
import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';

export default function DifferentialPrivacyMapping() {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  
  const { message: messageApi } = AntdApp.useApp();
  const { t } = useTranslation(); 
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { 
    columns,
    previewData,
    setFileData,
    dpFields 
  } = useWorkspaceStore();
  
  const updateFieldLocal = <T extends keyof DPField>(id: string, key: T, val: DPField[T]) => {
    useWorkspaceStore.setState((state) => ({
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
    const storeState = useWorkspaceStore.getState();
    const fieldAttributes: Record<string, { type: string; role: string }> = {};

    const formattedDpRules = dpFields.map(f => {
      let attrType = 'string';
      if (f.fieldType === 'Numeric') attrType = 'numeric';
      else if (f.fieldType === 'Categorical') attrType = 'categorical';
      else if (f.fieldType === 'Text') attrType = 'string';

      fieldAttributes[f.fieldName] = {
        type: attrType,
        role: f.enabled ? (attrType === 'numeric' ? 'sensitive' : 'quasi_identifier') : 'identifier'
      };

      return {
        id: f.id,
        fieldName: f.fieldName,
        fieldType: f.fieldType,
        enabled: Boolean(f.enabled),
        mode: f.mode || 'epsilon',
        epsilon: f.epsilon || 1.0,
        delta: f.delta || 0.0001,
        lowerBound: f.lowerBound !== undefined ? Number(f.lowerBound) : undefined,
        upperBound: f.upperBound !== undefined ? Number(f.upperBound) : undefined,
        allowedCategories: f.allowedCategories || '',
        maxLength: f.maxLength ? Number(f.maxLength) : undefined
      };
    });

    return {
      version: new Date().toISOString(),
      dataset: storeState.fileName || "current_dataset",
      privacy_mode: storeState.privacyMode || "differential-privacy",
      columns: storeState.columns,
      column_roles: storeState.columnRoles,
      column_types: storeState.columnTypes,
      preprocessing_rules: storeState.preprocessingRules && Object.keys(storeState.preprocessingRules).length > 0 ? storeState.preprocessingRules : undefined,
      field_attributes: fieldAttributes,
      privacy_targets: {
        k_anonymity: { 
          enabled: storeState.privacyMode === 'k-anonymity', 
          k: storeState.kValue ?? 5, 
          l: storeState.lValue ?? 2,
          t: storeState.tValue ?? 0.15,
          suppression_method: storeState.suppressionMethod ?? "row_suppression", 
          suppression_limit_percent: storeState.maxSuppression ?? 10, 
          limit_exceeded_action: storeState.limitExceededAction ?? "stop_and_error" 
        },
        differential_privacy: { 
          enabled: storeState.privacyMode === 'differential-privacy', 
          global_target_delta: storeState.targetDelta ?? 0.0001,
          simulate_query_count: storeState.queryCount ?? 1,
          budget_limit: storeState.budgetLimitEpsilon ?? 10,
          out_of_bounds_strategy: storeState.outOfBoundsStrategy ?? 'clip'
        }
      },
      differential_privacy_rules: formattedDpRules
    };
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        
        type DpRuleItem = {
          id?: string;
          fieldName?: string;
          field_name?: string;
          field?: string;
          fieldType?: DPField['fieldType'];
          field_type?: DPField['fieldType'];
          enabled?: boolean;
          mode?: 'epsilon' | 'epsilon-delta';
          epsilon?: number;
          delta?: number;
          lowerBound?: number;
          upperBound?: number;
          allowedCategories?: string;
          maxLength?: number;
          bounds?: { lower?: number; upper?: number };
          allowed_categories?: string[] | string;
          max_length?: number;
        };

        type FieldMechanismItem = {
          mechanism_type?: string;
          budget_model?: string;
          epsilon_budget?: number;
          delta_budget?: number;
          clipping_bounds?: { min?: number; max?: number };
          out_of_bounds_strategy?: string;
          rounding_step?: number;
        };

        const baseColumns = json.columns && Array.isArray(json.columns) && json.columns.length > 0 
          ? json.columns 
          : columns;

        const columnIndexMap = new Map<string, number>();
        baseColumns.forEach((colName: string, index: number) => {
          columnIndexMap.set(colName, index);
        });

        if (Array.isArray(json)) {
          const parsed = (json as DpRuleItem[]).map((item, idx) => ({
            id: item.id || `dp_col_${idx}_${Date.now()}`,
            fieldName: item.fieldName || item.field_name || `column_${idx}`,
            fieldType: item.fieldType || item.field_type || 'Unknown',
            enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
            mode: item.mode || 'epsilon',
            epsilon: item.epsilon ?? 1.0,
            delta: item.delta ?? 0.0001,
            lowerBound: item.lowerBound ?? item.bounds?.lower,
            upperBound: item.upperBound ?? item.bounds?.upper,
            allowedCategories: item.allowedCategories ?? (Array.isArray(item.allowed_categories) ? item.allowed_categories.join(',') : ''),
            maxLength: item.maxLength ?? item.max_length
          }));

          parsed.sort((a, b) => {
            const idxA = columnIndexMap.has(a.fieldName) ? columnIndexMap.get(a.fieldName)! : 999;
            const idxB = columnIndexMap.has(b.fieldName) ? columnIndexMap.get(b.fieldName)! : 999;
            return idxA - idxB;
          });

          useWorkspaceStore.setState({ dpFields: parsed as DPField[] });
          messageApi.success(t('message.import_array_json_success', '成功匯入欄位設定陣列！'));
          return;
        } 

        if (json.field_attributes || json.privacy_targets?.differential_privacy?.field_mechanisms || json.differential_privacy_rules) {
          const newFields: DPField[] = [];
          
          const fieldAttrs = (json.field_attributes || {}) as Record<string, { type: string; role: string }>;
          const mechanisms = (json.privacy_targets?.differential_privacy?.field_mechanisms || {}) as Record<string, FieldMechanismItem>;
          
          const dpRulesRaw = json.differential_privacy_rules;
          const dpRulesList = Array.isArray(dpRulesRaw) ? (dpRulesRaw as DpRuleItem[]) : [];
          const dpRulesObj = dpRulesRaw && !Array.isArray(dpRulesRaw) ? (dpRulesRaw as Record<string, DpRuleItem>) : {};

          Object.keys(fieldAttrs).forEach((fieldName, idx) => {
            const attr = fieldAttrs[fieldName]; 
            const mech = mechanisms[fieldName]; 
            const ruleObj = dpRulesObj[fieldName];
            const ruleItem = dpRulesList.find(item => (item.fieldName || item.field_name || item.field) === fieldName);

            let mappedType: DPField['fieldType'] = 'Unknown';
            if (attr.type === 'numeric') mappedType = 'Numeric';
            else if (attr.type === 'categorical') mappedType = 'Categorical';
            else if (['string', 'temporal'].includes(attr.type)) {
              mappedType = attr.role === 'identifier' ? 'Text' : 'Categorical';
            }

            const hasRuleSetting = Boolean(mech || ruleObj || ruleItem);
            let isEnabled = mappedType !== 'Text' && attr.role !== 'identifier' && hasRuleSetting;
            
            const explicitEnabled = ruleItem?.enabled ?? ruleObj?.enabled;
            if (typeof explicitEnabled === 'boolean') {
              isEnabled = explicitEnabled;
            }

            const eps = mech?.epsilon_budget ?? ruleItem?.epsilon ?? ruleObj?.epsilon ?? 1.0;
            const dlt = mech?.delta_budget ?? ruleItem?.delta ?? ruleObj?.delta ?? 0.0001;
            const modeVal: 'epsilon' | 'epsilon-delta' = (dlt && dlt > 0) ? 'epsilon-delta' : 'epsilon';

            const lower = mech?.clipping_bounds?.min ?? ruleItem?.lowerBound ?? ruleItem?.bounds?.lower ?? ruleObj?.lowerBound ?? ruleObj?.bounds?.lower;
            const upper = mech?.clipping_bounds?.max ?? ruleItem?.upperBound ?? ruleItem?.bounds?.upper ?? ruleObj?.upperBound ?? ruleObj?.bounds?.upper;

            let allowedCat = ruleItem?.allowedCategories ?? ruleObj?.allowedCategories ?? '';
            if (!allowedCat && mappedType === 'Categorical' && json.categorical_hierarchies?.[fieldName]?.mapping) {
              allowedCat = Object.keys(json.categorical_hierarchies[fieldName].mapping).join(',');
            }

            newFields.push({
              id: ruleItem?.id || `import_${idx}_${Math.random().toString(36).substring(2, 9)}`,
              fieldName: fieldName,
              fieldType: mappedType,
              enabled: isEnabled,
              mode: modeVal,
              epsilon: eps,
              delta: dlt,
              lowerBound: lower,
              upperBound: upper,
              allowedCategories: allowedCat,
              maxLength: ruleItem?.maxLength ?? ruleObj?.maxLength
            });
          });

          newFields.sort((a, b) => {
            const idxA = columnIndexMap.has(a.fieldName) ? columnIndexMap.get(a.fieldName)! : 999;
            const idxB = columnIndexMap.has(b.fieldName) ? columnIndexMap.get(b.fieldName)! : 999;
            return idxA - idxB;
          });

          // 🌟 拔除最後一個萬惡的 any！改用嚴謹的型別斷言
          if (json.preprocessing_rules) {
            useWorkspaceStore.setState({ 
              preprocessingRules: json.preprocessing_rules as Record<string, { action: string; param: string }>
            });
          }

          const globalDelta = json.privacy_targets?.differential_privacy?.global_delta ?? json.privacy_targets?.differential_privacy?.global_target_delta;
          const globalEps = json.privacy_targets?.differential_privacy?.global_epsilon ?? json.privacy_targets?.differential_privacy?.budget_limit;
          
          if (globalDelta !== undefined) useWorkspaceStore.setState({ targetDelta: globalDelta });
          if (globalEps !== undefined) useWorkspaceStore.setState({ budgetLimitEpsilon: globalEps });

          useWorkspaceStore.setState({ dpFields: newFields });
          messageApi.success(t('message.import_master_json_success', '成功匯入隱私設定檔！'));
        } else {
          messageApi.error(t('message.import_json_format_error', 'JSON 格式不符合規範！'));
        }
      } catch (error) {
        console.error("JSON Import Error:", error);
        messageApi.error(t('message.import_json_error', '解析 JSON 檔案失敗！'));
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
    
    useWorkspaceStore.setState({ dpFields: updatedFields });
    messageApi.success(t('message.apply_recommend_dp_success', '已成功套用智慧推薦設定！'));
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
    useWorkspaceStore.setState({ dpFields: [...dpFields, newField] });
  };

  const removeField = (id: string) => {
    useWorkspaceStore.setState({ dpFields: dpFields.filter(f => f.id !== id) });
  };

  const fieldColumns = [
    {
      title: t('step2.col_name', '欄位名稱'),
      dataIndex: 'fieldName',
      key: 'fieldName',
      width: '16%',
      render: (text: string, record: DPField) => (
        <Tooltip title={text} placement="topLeft" mouseEnterDelay={0.3}>
          <Input 
            value={text} 
            onChange={(e) => updateFieldLocal(record.id, 'fieldName', e.target.value)}
            placeholder={t('step2.ph_eg_salary', '例：salary')}
            status={record.enabled && (!text || !text.trim()) ? 'error' : ''}
            style={{ width: '100%', background: 'transparent', borderRadius: '6px', textOverflow: 'ellipsis' }}
          />
        </Tooltip>
      ),
    },
    {
      title: t('step2.data_type', '資料型態'),
      dataIndex: 'fieldType',
      key: 'fieldType',
      width: '14%',
      render: (type: string, record: DPField) => (
        <Select
          style={{ width: '100%' }}
          value={type === 'Unknown' ? null : type}
          placeholder={t('step2.ph_select', '請選擇')}
          onChange={(val) => {
            const newType = val as 'Numeric' | 'Categorical' | 'Text';
            useWorkspaceStore.setState(state => ({
              dpFields: state.dpFields.map(f => 
                f.id === record.id ? { ...f, fieldType: newType, enabled: newType === 'Text' ? false : f.enabled } : f
              )
            }));
          }}
          disabled={!record.enabled && type !== 'Text'}
          status={record.enabled && type === 'Unknown' ? 'error' : ''}
          options={[
            { value: 'Numeric', label: t('step2.opt_dp_numeric', '連續數值型 (Numeric)') },
            { value: 'Categorical', label: t('step2.opt_dp_categorical', '類別型 (Categorical)') },
            { value: 'Text', label: t('step2.opt_dp_text', '文字/識別碼 (Text)') },
          ]}
        />
      ),
    },
    {
      title: t('step2.apply_dp', '套用 DP'),
      key: 'enabled',
      width: '10%',
      // 🌟 使用 unknown，完全符合 ESLint 規範
      render: (_: unknown, record: DPField) => {
        const isText = record.fieldType === 'Text';
        return (
          <Space>
            <Switch 
              checked={record.enabled} 
              onChange={() => {
                useWorkspaceStore.setState(state => ({
                  dpFields: state.dpFields.map(f => f.id === record.id ? { ...f, enabled: !f.enabled } : f)
                }));
              }}
              disabled={isText}
              checkedChildren={t('step2.enable', '開啟')} 
              unCheckedChildren={t('step2.disable', '關閉')}
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
          {t('step2.dp_param_settings', '邊界與規則設定')}
          <Tooltip title={t('step2.dp_param_tooltip', '數值型請填寫上下限；類別型請填寫允許的類別清單 (以逗號分隔)。')}>
            <InfoCircleOutlined style={{ color: token.colorTextDescription }} />
          </Tooltip>
        </Space>
      ),
      key: 'bounds',
      width: '55%',
      // 🌟 使用 unknown，完全符合 ESLint 規範
      render: (_: unknown, record: DPField) => {
        if (!record.enabled) return <span style={{ color: token.colorTextDescription }}>-</span>;
        
        if (record.fieldType === 'Numeric') {
          const lower = record.lowerBound;
          const upper = record.upperBound;
          
          const isLowerMissing = lower === undefined || lower === null || lower === '';
          const isUpperMissing = upper === undefined || upper === null || upper === '';
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
                  placeholder={t('step2.ph_lower_bound', '下限 (Lower Bound)')}
                  value={record.lowerBound as number}
                  step="any"
                  onChange={(val) => updateFieldLocal(record.id, 'lowerBound', val === null ? undefined : val)}
                  style={{ width: '50%', background: 'transparent' }}
                  status={isLowerError ? 'error' : ''}
                />
                <InputNumber
                  placeholder={t('step2.ph_upper_bound', '上限 (Upper Bound)')}
                  value={record.upperBound as number}
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
              placeholder={t('step2.ph_allowed_categories', '允許類別，以逗號分隔 (例如: A,B,C)')}
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
              placeholder={t('step2.ph_max_length', '最大長度限制')}
              value={record.maxLength}
              onChange={(val) => updateFieldLocal(record.id, 'maxLength', val === null ? undefined : val)}
              status={!record.maxLength || record.maxLength <= 0 ? 'error' : ''}
              style={{ width: '100%', background: 'transparent', borderRadius: '6px' }}
              min={1}
            />
          );
        }

        return <span style={{ color: token.colorError }}>{t('step2.select_type_first', '請先選擇資料型態')}</span>;
      },
    },
    {
      title: t('step2.action', '操作'),
      key: 'action',
      width: '5%',
      align: 'center' as const,
      // 🌟 使用 unknown，完全符合 ESLint 規範
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
          title={t('step2.incomplete_setting', '欄位設定尚未完整')}
          description={
            <span style={{ fontSize: '13px' }}>
              {t('step2.incomplete_desc_prefix', '目前共有')} <strong>{validationStatus.errorCount}</strong> {t('step2.incomplete_desc_suffix', '個欄位設定未完成')} (包含未填欄位或下限大於等於上限)
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
            <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>{t('step2.btn_import', '匯入 JSON 設定檔')}</Button>
          </Space>
        }
        items={[
          {
            key: '1', 
            label: <span style={{ padding: '0 8px' }}><DatabaseOutlined /> {t('step2.tab_dp_mapping', '差分隱私欄位對應')}</span>,
            children: (
              <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: '8px', padding: '16px 20px', background: isDark ? '#141414' : '#fafafa' }}>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ fontWeight: 600, color: token.colorText }}>{t('step2.col_settings_list', '欄位參數設定清單')}</div>
                  <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleApplyRecommendations} style={{ background: '#4F46E5', border: 'none', borderRadius: '6px' }}>
                    {t('step2.btn_apply_recommend', '自動智慧推薦')}
                  </Button>
                </div>
                
                <div style={{ background: isDark ? '#1d1d1d' : '#ffffff', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${token.colorBorderSecondary}` }}>
                  <Table 
                    dataSource={dpFields} 
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
                  {t('step2.btn_add_field', '新增自訂欄位')}
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
                  <CodeOutlined style={{ marginRight: '6px' }} /> {t('step2.json_preview', '即時設定檔預覽 (JSON Preview)')}
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