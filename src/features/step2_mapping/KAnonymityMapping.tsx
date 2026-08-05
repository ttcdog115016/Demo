import React, { useState, useEffect, useRef } from 'react';
import { Card, Table, Select, Button, Input, InputNumber, Segmented, theme, Tabs, Space, Popconfirm, Collapse, Tooltip, App as AntdApp } from 'antd';
import { 
  UploadOutlined, DeleteOutlined, PlusOutlined, 
  SaveOutlined, DatabaseOutlined, SisternodeOutlined, 
  CodeOutlined, ThunderboltOutlined, QuestionCircleOutlined
} from '@ant-design/icons';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import { useTranslation } from 'react-i18next'; // 🌟 引入翻譯 hook

interface FieldDef {
  id: string; name: string; type: string; role: string; maskStrategy: string;
  maskKeepChars: number; maskChar: string; hashType: string;      
  genStrategy: string; genParam: number; genMaxLevel: number;  
}

interface HierarchyTable {
  id: string; fieldName: string; mappings: string[][]; 
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
    if (idx !== -1) str = str.substring(0, idx);
  } else if (action === 'keep_until' && param) {
    const idx = str.indexOf(param);
    if (idx !== -1) str = str.substring(0, idx + param.length);
  } else if (action === 'regex_replace' && param) {
    try {
      const reg = new RegExp(param, 'g');
      str = str.replace(reg, '');
    } catch { /* ignore */ }
  }

  return str;
};

let globalCachedFields: FieldDef[] | null = null;
let globalCachedHierarchies: HierarchyTable[] | null = null;
let globalCachedColsKey: string = '';

export default function KAnonymityMapping() {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const { t } = useTranslation(); // 🌟 啟用翻譯功能
  
  const { message: messageApi } = AntdApp.useApp();

  const storeColumns = usePrivacyStore((state) => state.columns);
  const storeColumnRoles = usePrivacyStore((state) => state.columnRoles);
  const storeColumnTypes = usePrivacyStore((state) => state.columnTypes);
  const kValue = usePrivacyStore((state) => state.kValue);
  const maxSuppression = usePrivacyStore((state) => state.maxSuppression);
  const previewData = usePrivacyStore((state) => state.previewData); 

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fields, setFields] = useState<FieldDef[]>(globalCachedFields || []);
  const [hierarchies, setHierarchies] = useState<HierarchyTable[]>(globalCachedHierarchies || []);

  const generateExportJSON = () => {
    const fieldAttributes: Record<string, { type: string; role: string }> = {};
    const maskingRules: Record<string, Record<string, string | number>> = {};
    const generalizationRules: Record<string, Record<string, string | number>> = {};
    const numBins: Record<string, { bin_width: number }> = {};
    const tempHier: Record<string, { levels: string[] }> = {};
    const catHierarchies: Record<string, { mapping: Record<string, string[]> }> = {};
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const preprocessingRules = (usePrivacyStore.getState() as any).preprocessingRules || {};

    fields.forEach(f => {
      if (!f.name) return;
      const roleMap: Record<string, string> = { 'Identifier': 'identifier', 'Quasi-identifier': 'quasi_identifier', 'Sensitive': 'sensitive', 'Non-sensitive': 'non_sensitive' };
      fieldAttributes[f.name] = { type: f.type, role: roleMap[f.role] || 'non_sensitive' };

      if (f.role !== 'Quasi-identifier' && f.maskStrategy !== 'none') {
        maskingRules[f.name] = {
          strategy: f.maskStrategy === 'keep' ? 'keep_prefix' : f.maskStrategy,
          ...(f.maskStrategy === 'keep' ? { keep_chars: f.maskKeepChars, mask_char: f.maskChar } : {}),
          ...(f.maskStrategy === 'hash' ? { hash_type: f.hashType } : {})
        };
      }

      if (f.role === 'Quasi-identifier') {
        generalizationRules[f.name] = { strategy: f.genStrategy, param: f.genParam, max_level: f.genMaxLevel };
        if (f.type === 'numeric' && f.genStrategy === 'binning') numBins[f.name] = { bin_width: f.genParam };
        if (f.type === 'temporal' && f.genStrategy === 'downgrade') tempHier[f.name] = { levels: ["day", "month", "year"] };
      }
    });

    hierarchies.forEach(h => {
      if (!h.fieldName) return;
      const mapping: Record<string, string[]> = {};
      h.mappings.forEach(row => { if (row[0]) mapping[row[0]] = row.filter(val => val !== ''); });
      if (Object.keys(mapping).length > 0) catHierarchies[h.fieldName] = { mapping };
    });

    return {
      version: new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-'),
      dataset: "finance_scenario",
      privacy_targets: {
        k_anonymity: { enabled: true, k: kValue, suppression_method: "row_suppression", suppression_limit_percent: maxSuppression, limit_exceeded_action: "stop_and_error" },
        differential_privacy: { enabled: false }
      },
      field_attributes: fieldAttributes,
      preprocessing_rules: Object.keys(preprocessingRules).length > 0 ? preprocessingRules : undefined,
      categorical_hierarchies: Object.keys(catHierarchies).length > 0 ? catHierarchies : undefined,
      numeric_bins: Object.keys(numBins).length > 0 ? numBins : undefined,
      temporal_hierarchies: Object.keys(tempHier).length > 0 ? tempHier : undefined,
      masking_rules: Object.keys(maskingRules).length > 0 ? maskingRules : undefined,
      generalization_rules: Object.keys(generalizationRules).length > 0 ? generalizationRules : undefined
    };
  };

  const handleExportJSON = () => {
    try {
      const liveJson = generateExportJSON();
      const jsonStr = JSON.stringify(liveJson, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `privacy_config_${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      messageApi.success(t('message.export_json_success'));
    } catch (error) {
      console.error("匯出錯誤:", error);
      messageApi.error(t('message.export_json_error'));
    }
  };

  useEffect(() => {
    const colsKey = JSON.stringify(storeColumns);
    if (storeColumns.length > 0 && globalCachedColsKey !== colsKey) {
      const currentFieldNames = JSON.stringify(fields.map(f => f.name));
      if (currentFieldNames === colsKey) {
        globalCachedColsKey = colsKey;
        return;
      }

      const initFields = storeColumns.map(col => {
        const type = storeColumnTypes[col] === '數值' ? 'numeric' : storeColumnTypes[col] === '時間' ? 'temporal' : storeColumnTypes[col] === '類別' ? 'categorical' : 'string';
        return {
          id: `field_${Math.random().toString(36).substr(2, 9)}`,
          name: col,
          type: type,
          role: storeColumnRoles[col] || 'Non-sensitive',
          maskStrategy: 'none',
          maskKeepChars: 2,
          maskChar: '*',
          hashType: 'sha256', 
          genStrategy: type === 'numeric' ? 'binning' : type === 'temporal' ? 'downgrade' : type === 'categorical' ? 'tree' : 'prefix',
          genParam: type === 'string' ? 2 : 10,
          genMaxLevel: 2
        };
      });

      let cancelled = false;
      const timeoutId = window.setTimeout(() => {
        if (!cancelled) {
          setFields(initFields);
          globalCachedFields = initFields;
          globalCachedColsKey = colsKey;
        }
      }, 0);

      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }
  }, [storeColumns, storeColumnRoles, storeColumnTypes, fields]);

  useEffect(() => {
    const newRoles: Record<string, string> = {};
    const newTypes: Record<string, string> = {};
    const cols: string[] = [];

    fields.forEach(f => {
      if (!f.name) return;
      newRoles[f.name] = f.role;
      newTypes[f.name] = f.type === 'string' ? '字串' : f.type === 'numeric' ? '數值' : f.type === 'temporal' ? '時間' : '類別';
      cols.push(f.name);
    });

    const currentStore = usePrivacyStore.getState();
    globalCachedFields = fields;
    
    usePrivacyStore.setState({ columnRoles: newRoles, columnTypes: newTypes, columns: currentStore.columns.length > 0 ? currentStore.columns : cols });

  }, [fields]);

  useEffect(() => {
    const t_id = 0 as unknown as number;
    const validTreeFields = fields.filter(f => f.role === 'Quasi-identifier' && f.genStrategy === 'tree').map(f => f.name);
    setTimeout(() => {
      setHierarchies(prev => {
        const next = prev.filter(h => h.fieldName === '' || validTreeFields.includes(h.fieldName));
        validTreeFields.forEach(name => { if (name && !next.some(h => h.fieldName === name)) next.push({ id: `h_${Math.random().toString(36).substr(2, 9)}`, fieldName: name, mappings: [['', '']] }); });
        const prevNames = prev.map(h => h.fieldName).sort().join(',');
        const nextNames = next.map(h => h.fieldName).sort().join(',');
        return prevNames !== nextNames ? next : prev;
      });
    }, 0);
    return () => { clearTimeout(t_id); };
  }, [fields]);

  useEffect(() => { globalCachedHierarchies = hierarchies; }, [hierarchies]);

  const getTransformedPreview = (val: unknown, field: FieldDef) => {
    if (val == null || val === '') return '-';
    const str = String(val);

    if (field.role !== 'Quasi-identifier') {
      if (field.maskStrategy === 'drop') return t('step2.removed');
      if (field.role === 'Identifier') {
        if (field.maskStrategy === 'full') return '***';
        if (field.maskStrategy === 'keep') {
          const keepLen = Math.min(field.maskKeepChars, str.length);
          return str.substring(0, keepLen) + field.maskChar.repeat(Math.max(0, str.length - keepLen));
        }
      }
      return str; 
    }

    if (field.role === 'Quasi-identifier') {
      if (field.genMaxLevel === 0) return str; 

      if (field.type === 'numeric') {
        const num = parseFloat(str);
        if (!isNaN(num) && field.genParam > 0) {
          if (field.genStrategy === 'rounding') return String(Math.round(num / field.genParam) * field.genParam);
          if (field.genStrategy === 'segment') {
            const lower = Math.floor(num / field.genParam) * field.genParam;
            return `${lower} - ${lower + field.genParam - 1}`;
          }
          const levelMultipliers = [1, 1, 5, 10, 50];
          const step = field.genParam * (levelMultipliers[field.genMaxLevel] || 1);
          if (field.genStrategy === 'binning') {
            const lower = Math.floor(num / step) * step;
            return `${lower} ~ ${lower + step}`;
          }
        }
      }
      else if (field.type === 'temporal' && field.genStrategy === 'downgrade') {
        if (field.genMaxLevel === 1) return str.substring(0, 10);
        if (field.genMaxLevel === 2) return str.substring(0, 7);
        if (field.genMaxLevel >= 3) return str.substring(0, 4);
      }
      else if (field.type === 'categorical' && field.genStrategy === 'tree') {
        const table = hierarchies.find(h => h.fieldName === field.name);
        if (table) {
          const row = table.mappings.find(m => m[0] === str);
          if (row) return row[Math.min(field.genMaxLevel, row.length - 1)] || str;
        }
        return `${t('step2.undefined_mapping')} ${str}`; 
      }
      else if (field.type === 'string') {
        let keepLen = str.length;
        
        if (field.genStrategy === 'prefix') {
          keepLen = Math.min(field.genParam, str.length);
          if (field.genMaxLevel === 2) keepLen = Math.floor(keepLen / 2);
          if (field.genMaxLevel >= 3) keepLen = 0;
        } 
        else if (field.genStrategy === 'masking') {
          const maskCount = field.genParam * field.genMaxLevel;
          keepLen = Math.max(0, str.length - maskCount);
        }
        else if (field.genStrategy === 'length') {
          keepLen = Math.max(0, str.length - field.genMaxLevel);
        }

        const starsCount = Math.max(0, str.length - keepLen);
        return str.substring(0, keepLen) + '*'.repeat(starsCount);
      }
    }
    return str;
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        
        if (json.privacy_targets?.k_anonymity?.enabled) {
          usePrivacyStore.setState({ privacyMode: 'k-anonymity', kValue: json.privacy_targets.k_anonymity.k ?? 5, maxSuppression: json.privacy_targets.k_anonymity.suppression_limit_percent ?? 5 });
        }

        const attributes = json.field_attributes || {};
        const maskingRules = json.masking_rules || {};
        const genRules = json.generalization_rules || {}; 
        const preRules = json.preprocessing_rules || {}; 
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        usePrivacyStore.setState({ preprocessingRules: preRules } as any);

        const newFields = [...fields]; 
        
        Object.keys(attributes).forEach((colName) => {
          const attr = attributes[colName];
          const mask = maskingRules[colName];
          const gen = genRules[colName];
          const roleMap: Record<string, string> = { 'identifier': 'Identifier', 'quasi_identifier': 'Quasi-identifier', 'sensitive': 'Sensitive', 'non_sensitive': 'Non-sensitive' };
          const role = roleMap[attr.role as string] || 'Non-sensitive';
          const typeMap: Record<string, string> = { 'string': 'string', 'temporal': 'temporal', 'categorical': 'categorical', 'numeric': 'numeric' };
          const type = typeMap[attr.type as string] || 'string';
          
          let strat = 'none';
          if (mask?.strategy === 'keep_prefix' || mask?.strategy === 'keep_suffix' || mask?.strategy === 'keep') strat = 'keep';
          else if (mask?.strategy === 'full') strat = 'full';
          else if (mask?.strategy === 'hash') strat = 'hash';
          else if (mask?.strategy === 'drop') strat = 'drop'; 

          let genStrat = type === 'numeric' ? 'binning' : type === 'temporal' ? 'downgrade' : type === 'categorical' ? 'tree' : 'prefix';
          let genParam = 10;
          let genMaxLevel = 2; 
          if (gen) { genStrat = gen.strategy; genParam = gen.param; genMaxLevel = gen.max_level; }

          const existingIdx = newFields.findIndex(f => f.name === colName);
          const fieldObj: FieldDef = {
            id: existingIdx >= 0 ? newFields[existingIdx].id : `field_${Math.random().toString(36).substr(2, 9)}`,
            name: colName, type: type, role: role, maskStrategy: strat, maskKeepChars: mask?.keep_chars ?? 2,
            maskChar: mask?.mask_char ?? '*', hashType: mask?.hash_type || 'sha256', genStrategy: genStrat,
            genParam: genParam, genMaxLevel: genMaxLevel
          };

          if (existingIdx >= 0) newFields[existingIdx] = fieldObj; else newFields.push(fieldObj);
        });

        const catHierarchies = json.categorical_hierarchies || {};
        const newHierarchies = [...hierarchies]; 
        Object.keys(catHierarchies).forEach(colName => {
          const mappingsArray = Object.values(catHierarchies[colName].mapping || {}) as string[][];
          const existingIdx = newHierarchies.findIndex(h => h.fieldName === colName);
          if (existingIdx >= 0) newHierarchies[existingIdx].mappings = mappingsArray;
          else newHierarchies.push({ id: `h_${Math.random().toString(36).substr(2, 9)}`, fieldName: colName, mappings: mappingsArray });
        });

        const futureCols = storeColumns.length > 0 ? storeColumns : newFields.map(f => f.name);
        globalCachedColsKey = JSON.stringify(futureCols);
        globalCachedFields = newFields; globalCachedHierarchies = newHierarchies;

        setFields(newFields); setHierarchies(newHierarchies);
        messageApi.success(t('message.import_json_success'));
      } catch { 
        messageApi.error(t('message.import_json_error')); 
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = ''; 
      }
    };
    reader.readAsText(file);
  };

  const handleApplyRecommendations = () => {
    const updatedFields = fields.map(f => {
      const name = f.name.toLowerCase();
      let role: string; let mask: string; let genStrat = f.genStrategy;
      if (/(id|name|card|nric|phone|email)/.test(name)) { role = 'Identifier'; mask = 'hash'; }
      else if (/(date|age|zip|gender|station|city|region)/.test(name)) {
        role = 'Quasi-identifier'; mask = 'none';
        genStrat = f.type === 'numeric' ? 'binning' : f.type === 'temporal' ? 'downgrade' : f.type === 'categorical' ? 'tree' : 'prefix';
      } 
      else if (/(disease|salary|income|fare|credit|amount|ratio|score)/.test(name)) { role = 'Sensitive'; mask = 'none'; }
      else { role = 'Non-sensitive'; mask = 'none'; }
      return { ...f, role, maskStrategy: mask, genStrategy: genStrat };
    });
    setFields(updatedFields);
    messageApi.success(t('message.apply_recommend_success'));
  };

  const handleFieldChange = (id: string, key: keyof FieldDef, value: string | number | null) => {
    const normalizedValue = value === null ? 0 : value;
    setFields(fields.map(f => {
      if (f.id !== id) return f;
      const oldName = f.name; const updated = { ...f, [key]: normalizedValue };
      if (key === 'role' || key === 'type') {
        if (updated.role === 'Quasi-identifier') {
          if (updated.type === 'numeric') updated.genStrategy = 'binning';
          else if (updated.type === 'temporal') updated.genStrategy = 'downgrade';
          else if (updated.type === 'categorical') updated.genStrategy = 'tree';
          else updated.genStrategy = 'prefix';
        } else { updated.maskStrategy = 'none'; }
      }
      if (updated.type === 'numeric' && ['rounding', 'segment'].includes(updated.genStrategy) && updated.genMaxLevel > 1) {
        updated.genMaxLevel = 1;
      }
      if (key === 'name' && oldName !== normalizedValue && oldName.trim() !== '') {
        const newName = String(normalizedValue);
        setHierarchies(prev => prev.map(h => h.fieldName === oldName ? { ...h, fieldName: newName } : h));
      }
      return updated;
    }));
  };
  
  const addField = () => setFields([...fields, { id: `field_${Date.now()}`, name: '', type: 'string', role: 'Quasi-identifier', maskStrategy: 'none', maskKeepChars: 2, maskChar: '*', hashType: 'sha256', genStrategy: 'prefix', genParam: 10, genMaxLevel: 2 }]);
  const removeField = (id: string) => {
    const fieldToRemove = fields.find(f => f.id === id);
    setFields(fields.filter(f => f.id !== id));
    if (fieldToRemove && fieldToRemove.name) setHierarchies(prev => prev.filter(h => h.fieldName !== fieldToRemove.name));
  };

  const fieldColumns = [
    {
      title: t('step2.col_name'),
      dataIndex: 'name', width: '15%',
      render: (text: string, record: FieldDef) => (
        <Tooltip title={text} placement="topLeft" mouseEnterDelay={0.3}>
          <Input value={text} onChange={(e) => handleFieldChange(record.id, 'name', e.target.value)} placeholder="e.g. age" style={{ width: '100%', textOverflow: 'ellipsis' }} />
        </Tooltip>
      ),
    },
    {
      title: t('step2.data_type'),
      dataIndex: 'type', width: '11%',
      render: (text: string, record: FieldDef) => (
        <Select value={text} onChange={(val) => handleFieldChange(record.id, 'type', val)} style={{ width: '100%' }}>
          <Select.Option value="string">{t('step2.opt_string')}</Select.Option>
          <Select.Option value="numeric">{t('step2.opt_numeric')}</Select.Option>
          <Select.Option value="temporal">{t('step2.opt_temporal')}</Select.Option>
          <Select.Option value="categorical">{t('step2.opt_categorical')}</Select.Option>
        </Select>
      ),
    },
    {
      title: t('step2.privacy_role'),
      dataIndex: 'role', width: '13%',
      render: (text: string, record: FieldDef) => (
        <Select value={text} onChange={(val) => handleFieldChange(record.id, 'role', val)} style={{ width: '100%' }}>
          <Select.Option value="Identifier">{t('step2.opt_identifier')}</Select.Option>
          <Select.Option value="Quasi-identifier">{t('step2.opt_quasi')}</Select.Option>
          <Select.Option value="Sensitive">{t('step2.opt_sensitive')}</Select.Option>
          <Select.Option value="Non-sensitive">{t('step2.opt_non_sensitive')}</Select.Option>
        </Select>
      ),
    },
    {
      title: t('step2.process_strategy'),
      dataIndex: 'strategy', width: '15%',
      render: (_: unknown, record: FieldDef) => {
        if (record.role !== 'Quasi-identifier') {
          const options = [{ value: 'none', label: t('step2.opt_keep_original') }, { value: 'drop', label: t('step2.opt_drop') }];
          if (record.role === 'Identifier') options.splice(1, 0, { value: 'keep', label: t('step2.opt_keep_chars') }, { value: 'full', label: t('step2.opt_full_mask') });
          return <Select value={record.maskStrategy} onChange={(val) => handleFieldChange(record.id, 'maskStrategy', val)} style={{ width: '100%' }} options={options} />;
        }
        if (record.role === 'Quasi-identifier') {
          if (record.type === 'numeric') return <Select value={record.genStrategy} onChange={(val) => handleFieldChange(record.id, 'genStrategy', val)} style={{ width: '100%' }} options={[{value:'binning', label: t('step2.opt_binning')}, {value:'rounding', label: t('step2.opt_rounding')}, {value:'segment', label: t('step2.opt_segment')}]} />;
          if (record.type === 'temporal') return <Select value={record.genStrategy} onChange={(val) => handleFieldChange(record.id, 'genStrategy', val)} style={{ width: '100%' }} options={[{value:'downgrade', label: t('step2.opt_downgrade')}]} />;
          if (record.type === 'categorical') return <Select value={record.genStrategy} onChange={(val) => handleFieldChange(record.id, 'genStrategy', val)} style={{ width: '100%' }} options={[{value:'tree', label: t('step2.opt_tree')}]} />;
          return <Select value={record.genStrategy} onChange={(val) => handleFieldChange(record.id, 'genStrategy', val)} style={{ width: '100%' }} options={[{value:'masking', label: t('step2.opt_masking')}, {value:'prefix', label: t('step2.opt_prefix')}, {value:'length', label: t('step2.opt_length')}]} />;
        }
        return <span style={{ color: token.colorTextDescription }}>{t('step2.no_process_needed')}</span>;
      },
    },
    {
      title: t('step2.param_setting'),
      key: 'details', width: '18%',
      render: (_: unknown, record: FieldDef) => {
        if (record.role === 'Identifier') {
          if (record.maskStrategy === 'keep') return (
            <Space.Compact style={{ width: '100%' }}>
              <InputNumber value={record.maskKeepChars} onChange={(val) => handleFieldChange(record.id, 'maskKeepChars', val)} min={0} style={{ width: '50%' }} />
              <Input value={record.maskChar} onChange={(e) => handleFieldChange(record.id, 'maskChar', e.target.value)} style={{ width: '50%', textAlign: 'center' }} />
            </Space.Compact>
          );
          
        }
        if (record.role === 'Quasi-identifier') {
          if (record.type === 'numeric') return <InputNumber placeholder={record.genStrategy === 'rounding' ? t('step2.ph_rounding_base') : t('step2.ph_bin_size')} value={record.genParam} onChange={(val) => handleFieldChange(record.id, 'genParam', val)} style={{ width: '100%' }} />;
          
          if (record.type === 'string' && ['masking', 'prefix', 'length'].includes(record.genStrategy)) {
            const placeholderTxt = record.genStrategy === 'prefix' ? t('step2.ph_keep_chars') : t('step2.ph_mask_per_level');
            return <InputNumber placeholder={placeholderTxt} value={record.genParam} onChange={(val) => handleFieldChange(record.id, 'genParam', val)} style={{ width: '100%' }} />;
          }
        }
        return <span style={{ color: token.colorTextDescription }}>-</span>;
      },
    },
    {
      title: t('step2.max_level'),
      key: 'level', width: '23%', 
      render: (_: unknown, record: FieldDef) => {
        if (record.role === 'Quasi-identifier') {
          let options: { label: string; value: number }[] = [];
          if (record.type === 'temporal') options = [{ label: t('step2.lvl_exact'), value: 0 }, { label: t('step2.lvl_day'), value: 1 }, { label: t('step2.lvl_month'), value: 2 }, { label: t('step2.lvl_year'), value: 3 }];
          else if (record.type === 'categorical') { 
            const table = hierarchies.find(h => h.fieldName === record.name);
            const max = table ? Math.max(...table.mappings.map(m => m.length), 2) - 1 : 3;
            options.push({ label: t('step2.lvl_original'), value: 0 });
            for (let i = 1; i <= max; i++) options.push({ label: `L${i}`, value: i });
          }
          else if (record.type === 'string') options = [{ label: t('step2.lvl_original'), value: 0 }, { label: t('step2.lvl_mask1'), value: 1 }, { label: t('step2.lvl_mask_half'), value: 2 }, { label: t('step2.lvl_mask_all'), value: 3 }];
          else if (record.type === 'numeric') { 
            if (record.genStrategy === 'rounding' || record.genStrategy === 'segment') options = [{ label: t('step2.lvl_original'), value: 0 }, { label: t('step2.lvl_enable'), value: 1 }];
            else options = [{ label: t('step2.lvl_original'), value: 0 }, { label: 'L1', value: 1 }, { label: 'L2', value: 2 }, { label: 'L3', value: 3 }, { label: 'L4', value: 4 }];
          }
          return <div style={{ padding: '0 2px' }}><Segmented size="small" options={options} value={record.genMaxLevel} onChange={(val) => handleFieldChange(record.id, 'genMaxLevel', val)} block /></div>;
        }
        return <span style={{ color: token.colorTextDescription }}>-</span>;
      },
    },
    { title: t('step2.action'), key: 'action', width: '5%', align: 'center' as const, render: (_: FieldDef, record: FieldDef) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeField(record.id)} /> },
  ];

  const addHierarchyTable = () => setHierarchies([...hierarchies, { id: `h_${Date.now()}`, fieldName: '', mappings: [['', '']] }]);
  const removeHierarchyTable = (id: string) => setHierarchies(hierarchies.filter(h => h.id !== id));
  const updateHierarchyField = (id: string, name: string) => setHierarchies(hierarchies.map(h => h.id === id ? { ...h, fieldName: name } : h));
  const addMappingRow = (tableId: string) => setHierarchies(hierarchies.map(h => { if (h.id === tableId) { const colCount = h.mappings.length > 0 ? h.mappings[0].length : 2; return { ...h, mappings: [...h.mappings, Array(colCount).fill('')] }; } return h; }));
  const updateMappingCell = (tableId: string, rowIndex: number, colIndex: number, value: string) => setHierarchies(hierarchies.map(h => { if (h.id === tableId) { const newMappings = [...h.mappings]; const newRow = [...newMappings[rowIndex]]; newRow[colIndex] = value; if (colIndex === newRow.length - 1 && value !== '') newMappings.forEach(row => row.push('')); newMappings[rowIndex] = newRow; return { ...h, mappings: newMappings }; } return h; }));
  const removeMappingRow = (tableId: string, rowIndex: number) => setHierarchies(hierarchies.map(h => h.id === tableId ? { ...h, mappings: h.mappings.filter((_, idx) => idx !== rowIndex) } : h));

  const liveJsonData = generateExportJSON();

  return (
    <Card variant="borderless" style={{ background: 'transparent', padding: 0 }}>
      <Tabs 
        defaultActiveKey="1" 
        tabBarExtraContent={
          <Space style={{ paddingBottom: '8px' }}>
            <input type="file" accept=".json" ref={fileInputRef} onChange={handleImportJSON} onClick={(e) => { (e.target as HTMLInputElement).value = ''; }} style={{ display: 'none' }} />
            <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>{t('step2.btn_import')}</Button>
            <Button icon={<CodeOutlined />} onClick={handleExportJSON}>{t('step2.btn_export')}</Button>
          </Space>
        }
        items={[
          {
            key: '1', label: <span style={{ padding: '0 8px' }}><DatabaseOutlined /> {t('step2.tab_mapping')}</span>,
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
                    dataSource={fields} 
                    columns={fieldColumns} 
                    rowKey="id" 
                    pagination={false} 
                    size="small" 
                    bordered={false} 
                    className="attribute-table" 
                    scroll={{ y: 400 }} 
                    expandable={{ 
                      expandedRowRender: (record) => { 
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const storeState = usePrivacyStore.getState() as any;
                        const preRules = storeState.preprocessingRules || {};
                        const colRule = preRules[record.name] || { action: 'none', param: '' };

                        const sampleRows = previewData.slice(0, 3).map((d, i) => {
                          const rawStr = String(d[record.name] || '-');
                          const preVal = applyPreprocess(rawStr, colRule.action, colRule.param);
                          const transVal = getTransformedPreview(preVal, record);
                          return { key: i, raw: rawStr, preprocessed: preVal, transformed: transVal };
                        }); 
                        
                        const hasPreprocess = colRule.action && colRule.action !== 'none';
                        const previewCols = [
                          { title: t('step2.preview_raw'), dataIndex: 'raw', key: 'raw', width: hasPreprocess ? '33%' : '50%' },
                          ...(hasPreprocess ? [{ title: t('step2.preview_preprocessed'), dataIndex: 'preprocessed', key: 'preprocessed', className: 'preprocessed-col', width: '33%' }] : []),
                          { title: t('step2.preview_transformed'), dataIndex: 'transformed', key: 'transformed', width: hasPreprocess ? '34%' : '50%' }
                        ];

                        return ( 
                          <div style={{ padding: '16px 32px', background: isDark ? '#141414' : '#f8fafc', borderTop: `1px solid ${token.colorBorderSecondary}`, margin: 0 }}> 
                            <div style={{ fontWeight: 600, marginBottom: 12, color: token.colorText }}> {t('step2.data_preview')} <QuestionCircleOutlined style={{ color: token.colorTextDescription }} /> </div> 
                            <Table dataSource={sampleRows} pagination={false} size="small" columns={previewCols} /> 
                          </div> 
                        ); 
                      } 
                    }} 
                  />
                </div>
                
                <Button type="dashed" block icon={<PlusOutlined />} onClick={addField} style={{ marginTop: '16px' }}>{t('step2.btn_add_field')}</Button>
              </div>
            )
          },
          {
            key: '2', label: <span style={{ padding: '0 8px' }}><SisternodeOutlined /> {t('step2.tab_hierarchy')}</span>,
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {hierarchies.map((table) => {
                  const colCount = Math.max(...table.mappings.map(m => m.length), 2);
                  return (
                    <Card key={table.id} size="small" styles={{ header: { background: isDark ? '#1f1f1f' : '#f5f5f5', borderBottom: `1px solid ${token.colorBorderSecondary}` } }} style={{ border: `1px solid ${token.colorBorderSecondary}`, boxShadow: 'none' }} title={ <Space> <span style={{ color: token.colorTextSecondary }}>{t('step2.related_field')}</span> <Select value={table.fieldName || undefined} onChange={(val) => updateHierarchyField(table.id, val)} placeholder={t('step2.ph_select_qi')} style={{ width: '250px' }} options={fields.filter(f => f.role === 'Quasi-identifier').map(f => ({ label: f.name, value: f.name }))} /> </Space> } extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeHierarchyTable(table.id)} />} >
                      <div style={{ overflowX: 'auto', paddingBottom: '8px' }}>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', padding: '0 8px' }}>
                          <div style={{ flex: 1, minWidth: '150px', color: token.colorTextSecondary, fontSize: '12px' }}>{t('step2.original_value')}</div>
                          {Array.from({ length: colCount - 1 }).map((_, i) => ( <div key={i} style={{ flex: 1, minWidth: '150px', color: token.colorTextSecondary, fontSize: '12px' }}>{t('step2.generalize_level', { level: i + 1 })}</div> ))}
                          <div style={{ width: '60px' }}></div>
                        </div>
                        {table.mappings.map((row, rIdx) => (
                          <div key={rIdx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                            {Array.from({ length: colCount }).map((_, cIdx) => ( <Input key={cIdx} style={{ flex: 1, minWidth: '150px' }} value={row[cIdx] || ''} onChange={(e) => updateMappingCell(table.id, rIdx, cIdx, e.target.value)} /> ))}
                            <Space style={{ width: '60px', justifyContent: 'center' }}>
                              <Popconfirm title={t('step2.confirm_delete_row')} onConfirm={() => removeMappingRow(table.id, rIdx)}> <Button type="text" size="small" icon={<DeleteOutlined style={{ color: token.colorTextDescription }} />} /> </Popconfirm>
                              <Button type="primary" size="small" icon={<SaveOutlined />} />
                            </Space>
                          </div>
                        ))}
                      </div>
                      <Button type="link" icon={<PlusOutlined />} onClick={() => addMappingRow(table.id)} style={{ paddingLeft: 0 }}>{t('step2.btn_add_mapping')}</Button>
                    </Card>
                  )
                })}
                <Button type="dashed" block size="large" icon={<DatabaseOutlined />} onClick={addHierarchyTable}>{t('step2.btn_add_hierarchy')}</Button>
              </div>
            )
          }
        ]}
      />
      <div style={{ marginTop: '24px' }}>
        <Collapse ghost items={[{ key: '1', label: <span style={{ fontWeight: 600, color: token.colorTextSecondary }}><CodeOutlined style={{ marginRight: '6px' }} /> {t('step2.json_preview')}</span>, children: ( <pre style={{ background: isDark ? '#141414' : '#f0f2f5', padding: '16px', borderRadius: '8px', border: `1px solid ${token.colorBorderSecondary}`, overflowX: 'auto', fontSize: '13px', color: isDark ? '#a6accd' : '#333', margin: 0 }}> {JSON.stringify(liveJsonData, null, 2)} </pre> ) }]} />
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
        .preprocessed-col {
          background-color: ${isDark ? 'rgba(250, 173, 20, 0.1)' : 'rgba(250, 173, 20, 0.05)'};
        }
      `}</style>
    </Card>
  );
}