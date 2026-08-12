import { useMemo, useEffect } from 'react';
import { 
  Alert, Card, Slider, Row, Col, Statistic, Divider, 
  InputNumber, theme, Select, Space, Progress, Typography, Table, Tag
} from 'antd';
import { 
  LineChartOutlined, CalculatorOutlined, 
  DashboardOutlined, GlobalOutlined, ControlOutlined, LockOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';

const { Text } = Typography;

export type ConvertedField = DPField & {
  equivalentEpsilon: number;
};

export default function DifferentialPrivacyRules() {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const { t } = useTranslation();
  
  // 🌟 移除所有的 `|| []` 和 `|| {}`，依靠 Store 內建的初始值，徹底解決 useEffect 依賴警告！
  const dpFields = useWorkspaceStore(state => state.dpFields);
  const columns = useWorkspaceStore(state => state.columns);
  const columnRoles = useWorkspaceStore(state => state.columnRoles);
  const targetDelta = useWorkspaceStore(state => state.targetDelta);
  const queryCount = useWorkspaceStore(state => state.queryCount);
  const budgetLimitEpsilon = useWorkspaceStore(state => state.budgetLimitEpsilon);
  const outOfBoundsStrategy = useWorkspaceStore(state => state.outOfBoundsStrategy);
  const setStepValidation = useWorkspaceStore(state => state.setStepValidation);

  const updateFieldDP = <T extends keyof DPField>(id: string, key: T, val: DPField[T]) => {
    useWorkspaceStore.setState((state) => ({
      dpFields: state.dpFields.map(f => f.id === id ? { ...f, [key]: val } : f)
    }));
  };

  useEffect(() => {
    if ((!dpFields || dpFields.length === 0) && columns.length > 0) {
      const initialFields: DPField[] = columns
        .filter(col => (columnRoles[col] || '').toLowerCase() !== 'identifier')
        .map((col, idx) => ({
          id: `dp-col-${idx}-${col}`,
          fieldName: col,
          fieldType: columnRoles[col] || 'Quasi-Identifier',
          enabled: true,
          epsilon: 1.0,
          delta: 1e-5,
          mode: 'epsilon'
        }));

      useWorkspaceStore.setState({ dpFields: initialFields });
    }
  }, [columns, columnRoles, dpFields]);

  const activeFields = useMemo(() => dpFields.filter(f => f.enabled), [dpFields]);

  const convertedFields = useMemo(() => {
    return activeFields.map(field => {
      const eps = field.epsilon ?? 1.0;
      const dlt = field.delta ?? 1e-5;
      
      let eqEps = eps;
      if (field.mode === 'epsilon-delta' && dlt > 0 && targetDelta > 0 && dlt !== targetDelta) {
        const ratio = Math.log(1 / targetDelta) / Math.log(1 / dlt);
        eqEps = eps * ratio;
      }
      return { ...field, equivalentEpsilon: parseFloat(eqEps.toFixed(4)) } as ConvertedField;
    });
  }, [activeFields, targetDelta]);

  const totalEquivalentEpsilon = useMemo(() => {
    const sum = convertedFields.reduce((acc, curr) => acc + curr.equivalentEpsilon, 0);
    return parseFloat(sum.toFixed(4));
  }, [convertedFields]);

  const accumulatedEpsilon = parseFloat((totalEquivalentEpsilon * queryCount).toFixed(3));
  const safeLimit = budgetLimitEpsilon || 10;
  const budgetUsagePercent = Math.min((accumulatedEpsilon / safeLimit) * 100, 100);
  const isBudgetDanger = budgetUsagePercent >= 90;
  const isBudgetWarning = budgetUsagePercent >= 75 && !isBudgetDanger;

  useEffect(() => {
    if (targetDelta === undefined || targetDelta === null || targetDelta <= 0 || targetDelta >= 1) {
      setStepValidation(false, t('step3_dp.error_delta_invalid', '目標 Delta (δ) 必須介於 0 與 1 之間。'));
      return;
    }
    
    const hasInvalidEpsilon = activeFields.some(f => (f.epsilon ?? 1.0) <= 0);
    if (hasInvalidEpsilon) {
      setStepValidation(false, t('step3_dp.error_epsilon_zero', '欄位中，Epsilon (ε) 必須大於 0。'));
      return;
    }

    if (accumulatedEpsilon > safeLimit) {
      setStepValidation(false, t('step3_dp.error_budget_exceeded', '消耗的總隱私預算已超過設定上限，請調降各欄位的 ε 或是減少模擬查詢次數。'));
      return;
    }

    setStepValidation(true, null);
  }, [targetDelta, activeFields, accumulatedEpsilon, safeLimit, setStepValidation, t]);

  const getDPOption = () => {
    const originalDistribution = [5, 18, 45, 85, 100, 85, 45, 18, 5];
    const displayEpsilon = totalEquivalentEpsilon === 0 ? 0.1 : totalEquivalentEpsilon;
    const noiseFactor = Math.max(0, (10 - Math.min(10, displayEpsilon)) / 9.9); 
    
    const noisyDistribution = originalDistribution.map((val) => 
      Math.max(10, val * (1 - noiseFactor * 0.45) + (100 - val) * noiseFactor * 0.55)
    );

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: token.colorBorder, type: 'dashed' } } },
      legend: { data: [t('step3_dp.chart_original', 'Original Distribution'), t('step3_dp.chart_noisy', 'Noisy Distribution')], textStyle: { color: token.colorTextSecondary }, top: '0%', icon: 'circle' },
      grid: { top: '15%', left: '5%', right: '5%', bottom: '12%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: ['20K', '30K', '40K', '50K', '60K', '70K', '80K', '90K', '100K'], name: t('step3_dp.chart_x_axis', 'Value Range'), nameLocation: 'center', nameGap: 30, nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500 }, axisLabel: { color: token.colorTextDescription }, axisLine: { lineStyle: { color: token.colorBorder } } },
      yAxis: { type: 'value', name: t('step3_dp.chart_y_axis', 'Density/Frequency'), nameLocation: 'end', nameTextStyle: { color: token.colorTextSecondary }, axisLabel: { show: false }, splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { show: false } },
      series: [
        { name: t('step3_dp.chart_original', 'Original Distribution'), type: 'line', smooth: true, color: isDark ? '#434343' : '#d9d9d9', data: originalDistribution, areaStyle: { opacity: 0.05 }, lineStyle: { width: 1.5, type: 'dashed' }, showSymbol: false }, 
        { name: t('step3_dp.chart_noisy', 'Noisy Distribution'), type: 'line', smooth: true, color: token.colorPrimary, data: noisyDistribution, areaStyle: { opacity: isDark ? 0.2 : 0.25 }, lineStyle: { width: 3.5 }, showSymbol: false, itemStyle: { shadowBlur: 12, shadowColor: token.colorPrimary } }
      ]
    };
  };

  const conversionColumns = [
    { title: t('step3_dp.col_field', 'Field Name'), dataIndex: 'fieldName', key: 'fieldName', render: (text: string) => <Text strong style={{fontSize: 13}}>{text}</Text> },
    { 
      title: t('step3_dp.col_original', 'Original Setting'), 
      key: 'original', 
      render: (_: unknown, record: ConvertedField) => (
        <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
          ε: {record.epsilon ?? 1.0} {record.mode === 'epsilon-delta' && ` | δ: ${record.delta ?? 1e-5}`}
        </div>
      )
    },
    { 
      title: t('step3_dp.col_equivalent', 'Equivalent ε'), 
      dataIndex: 'equivalentEpsilon', 
      key: 'equivalentEpsilon', 
      align: 'right' as const,
      render: (val: number) => <Text strong style={{ color: '#722ed1', fontSize: 14 }}>{val}</Text> 
    }
  ];

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>

      <Alert 
        title={t('step3_dp.title', 'Set Differential Privacy Parameters')} 
        description={t('step3_dp.description', 'Supports per-field ε-DP and (ε,δ)-DP settings. The system converts budgets uniformly based on your Global Target Delta and tracks total budget consumption across multiple queries.')} 
        type="info" 
        showIcon 
      />

      <Card 
        title={<span><GlobalOutlined style={{ marginRight: 8, color: token.colorPrimary }} />{t('step3_dp.global_settings_title', '1. Global Privacy Target Settings')}</span>} 
        variant="borderless" 
        style={{ background: token.colorBgContainer, boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.04)' }}
      >
        <Row gutter={48}>
          <Col span={12}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>{t('step3_dp.global_delta', 'Global Target Delta (Baseline δ)')}</Text>
                <InputNumber 
                  min={1e-10} max={0.9999999999} step={0.0001} 
                  value={targetDelta} 
                  onChange={(val) => useWorkspaceStore.setState({ targetDelta: val ?? 1e-5 })} 
                  style={{ width: '150px' }} 
                  stringMode
                />
              </div>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {t('step3_dp.global_delta_desc', 'Defines the overall dataset error tolerance ceiling. Used as a baseline for conversion when fields are set to epsilon-delta mode.')}
              </Text>
            </div>
          </Col>
          <Col span={12}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>{t('step3_dp.simulate_query', 'Simulated Continuous Queries / Publishes')}</Text>
                <Space>
                  <Text strong style={{ color: token.colorWarning }}>{t('step3_dp.query_times', { count: queryCount, defaultValue: `${queryCount} Times` })}</Text>
                  <InputNumber 
                    min={1} max={10000} 
                    value={queryCount} 
                    onChange={(val) => useWorkspaceStore.setState({ queryCount: val ?? 1 })} 
                    size="small" style={{ width: '100px' }} 
                  />
                </Space>
              </div>
              <Slider 
                min={1} max={1000} 
                value={queryCount} 
                onChange={(val) => useWorkspaceStore.setState({ queryCount: val })} 
                style={{ margin: 0 }}
              />
            </div>
          </Col>
        </Row>
        
        <Divider dashed style={{ margin: '20px 0' }} />
        <Row gutter={48}>
          <Col span={12}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>{t('step3_dp.budget_limit_label', 'Total Budget Limit (ε Limit)')}</Text>
                <InputNumber 
                  step={0.5} 
                  value={budgetLimitEpsilon} 
                  onChange={(val) => useWorkspaceStore.setState({ budgetLimitEpsilon: val === null ? undefined : val })} 
                  onBlur={(e) => {
                    const currentVal = parseFloat(e.target.value);
                    if (isNaN(currentVal)) {
                      useWorkspaceStore.setState({ budgetLimitEpsilon: 10 });
                    } 
                    else if (currentVal < 0.1) {
                      useWorkspaceStore.setState({ budgetLimitEpsilon: 0.1 });
                    } 
                    else if (currentVal > 100) {
                      useWorkspaceStore.setState({ budgetLimitEpsilon: 100 });
                    }
                  }}
                  style={{ width: '150px' }} 
                />
              </div>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {t('step3_dp.budget_limit_desc', 'Set maximum allowable cumulative epsilon budget before system flags budget risk.')}
              </Text>
            </div>
          </Col>
          <Col span={12}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>{t('step3_dp.out_of_bounds_strategy', 'Out-of-Bounds Strategy')}</Text>
                <Select 
                  value={outOfBoundsStrategy ?? 'clip'} 
                  onChange={(val) => useWorkspaceStore.setState({ outOfBoundsStrategy: val })} 
                  style={{ width: '220px' }}
                  options={[
                    { value: 'clip', label: t('step3_dp.strategy_clip', '1. Clamp / Clip to Bounds') },
                    { value: 'wrap', label: t('step3_dp.strategy_wrap', '2. Wrap-around (Modulo)') },
                    { value: 'reflect', label: t('step3_dp.strategy_reflect', '3. Reflect / Bounce Back') },
                  ]}
                />
              </div>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {t('step3_dp.out_of_bounds_desc', 'When noisy numerical data exceeds lower/upper bounds, applies post-processing to keep values realistic.')}
              </Text>
            </div>
          </Col>
        </Row>
      </Card>

      <Card 
        title={<span><ControlOutlined style={{ marginRight: 8, color: '#13c2c2' }} />{t('step3_dp.field_tuning_title', '2. Individual Field Fine-Tuning')}</span>} 
        variant="borderless" 
        style={{ background: token.colorBgContainer, boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.04)' }}
        styles={{ body: { padding: '16px' } }}
      >
        <div style={{ 
          maxHeight: '320px', 
          overflowY: 'auto', 
          paddingRight: '12px',
          display: 'flex', 
          flexDirection: 'column', 
          gap: '8px' 
        }}>
          {activeFields.length === 0 ? (
            <Text type="secondary" style={{ textAlign: 'center', padding: '24px 0', display: 'block' }}>
              未包含需執行差分隱私處理的欄位。
            </Text>
          ) : (
            activeFields.map((field) => (
              <div 
                key={field.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: isDark ? '#1f1f1f' : '#f8fafc',
                  border: `1px solid ${token.colorPrimaryBorder}`,
                  borderRadius: '8px',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ flex: '0 0 25%', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <Text strong style={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {field.fieldName}
                    </Text>
                    <Text type="secondary" style={{ fontSize: '12px' }}>{field.fieldType || 'QI'}</Text>
                  </div>
                </div>

                <div style={{ flex: 1, display: 'flex', gap: '24px', alignItems: 'center' }}>
                  <Select 
                    size="middle" 
                    value={field.mode || 'epsilon'} 
                    onChange={(val) => updateFieldDP(field.id, 'mode', val)}
                    options={[{ value: 'epsilon', label: 'ε-DP' }, { value: 'epsilon-delta', label: '(ε, δ)-DP' }]}
                    style={{ width: '110px' }}
                  />

                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Text type="secondary" style={{ width: '20px', textAlign: 'right' }}>ε</Text>
                      <Slider 
                        min={0.01} max={10} step={0.01} 
                        value={field.epsilon ?? 1.0} 
                        onChange={(val) => updateFieldDP(field.id, 'epsilon', val)} 
                        style={{ flex: 1, margin: 0 }}
                      />
                      <InputNumber 
                        min={0.001} max={100} step={0.01} 
                        value={field.epsilon ?? 1.0} 
                        onChange={(val) => updateFieldDP(field.id, 'epsilon', val || 0.01)} 
                        size="small" style={{ width: '100px' }} 
                      />
                    </div>

                    {field.mode === 'epsilon-delta' && (
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Text type="secondary" style={{ width: '20px', textAlign: 'right' }}>δ</Text>
                        <Slider 
                          min={1e-8} max={0.1} step={0.0001} 
                          value={field.delta ?? 1e-5} 
                          onChange={(val) => updateFieldDP(field.id, 'delta', val)} 
                          style={{ flex: 1, margin: 0 }} 
                          tooltip={{ formatter: (val) => val?.toFixed(6) }}
                        />
                        <InputNumber 
                          min={1e-10} max={0.99} step={0.0001} 
                          value={field.delta ?? 1e-5} 
                          onChange={(val) => updateFieldDP(field.id, 'delta', val || 1e-5)} 
                          size="small" style={{ width: '100px' }} 
                          stringMode
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Row gutter={24} style={{ alignItems: 'stretch' }}>
        
        <Col span={8}>
          <Card 
            title={<span><DashboardOutlined style={{ marginRight: 8, color: '#faad14' }} />{t('step3_dp.card2_title', '3. Privacy Budget Center')}</span>} 
            variant="borderless" 
            style={{ 
              height: '100%', 
              background: isDark ? '#141414' : '#fafafa',
              border: `1px solid ${isDark ? '#303030' : '#e8e8e8'}`,
              boxShadow: isDark ? 'inset 0 2px 10px rgba(0,0,0,0.5)' : 'none'
            }}
          >
            <div style={{ textAlign: 'center', padding: '24px 0 16px 0' }}>
              <Progress 
                type="dashboard" 
                percent={budgetUsagePercent} 
                format={() => `${accumulatedEpsilon}`}
                strokeColor={isBudgetDanger ? { '0%': '#ff4d4f', '100%': '#cf1322' } : isBudgetWarning ? { '0%': '#faad14', '100%': '#d48806' } : { '0%': '#13c2c2', '100%': '#52c41a' }}
                strokeWidth={10} 
                size={220} 
                style={{ filter: isDark ? 'drop-shadow(0 0 8px rgba(0,0,0,0.5))' : 'none' }}
              />
              <div style={{ marginTop: 24 }}>
                <Text type="secondary" style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>
                  {t('step3_dp.accumulated_cost', { limit: safeLimit, defaultValue: `Accumulated Cost / Limit (${safeLimit})` })}
                </Text>
                <Tag 
                  color={isBudgetDanger ? 'error' : isBudgetWarning ? 'warning' : 'success'} 
                  style={{ fontSize: 16, padding: '4px 16px', borderRadius: 4, fontWeight: 'bold' }}
                >
                  {isBudgetDanger ? t('step3_dp.budget_danger', 'Over Budget Risk') : isBudgetWarning ? t('step3_dp.budget_warning', 'Budget Running Low') : t('step3_dp.budget_safe', 'Sufficient Budget')}
                </Tag>
              </div>
            </div>

            <Divider style={{ margin: '24px 0', borderColor: isDark ? '#303030' : '#e8e8e8' }} />
            
            <Table 
              dataSource={convertedFields}
              columns={conversionColumns}
              rowKey="id"
              pagination={false}
              size="small"
              bordered={false}
              scroll={{ y: 160 }}
              style={{ background: 'transparent' }}
              footer={() => (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 15, padding: '8px 4px 0 4px' }}>
                  <Text strong>{t('step3_dp.single_equivalent', 'Single Query Equivalent')}</Text>
                  <Text strong style={{ color: '#722ed1', fontSize: 18 }}>ε = {totalEquivalentEpsilon}</Text>
                </div>
              )}
            />
          </Card>
        </Col>

        <Col span={16}>
          <Card 
            title={<span><LineChartOutlined style={{ marginRight: 8, color: '#722ed1' }} />{t('step3_dp.card3_title', '4. Global Noise Simulation')}</span>} 
            variant="borderless" 
            style={{ 
              height: '100%', 
              background: isDark ? '#141414' : '#fafafa',
              border: `1px solid ${isDark ? '#303030' : '#e8e8e8'}`,
              boxShadow: isDark ? 'inset 0 2px 10px rgba(0,0,0,0.5)' : 'none'
            }}
          >
            <div style={{ display: 'flex', gap: '48px', marginBottom: '8px', padding: '0 16px' }}>
              <Statistic 
                title={<Text type="secondary" style={{ fontSize: 14 }}>{t('step3_dp.unified_eps', 'Total Equivalent Epsilon')}</Text>} 
                value={totalEquivalentEpsilon} 
                prefix={<CalculatorOutlined style={{ fontSize: 24, marginRight: 8, color: token.colorPrimary }}/>} 
                formatter={(val) => <span style={{ fontSize: 42, fontWeight: 'bold', color: token.colorPrimary }}>{val}</span>}
              />
              <Statistic 
                title={<Text type="secondary" style={{ fontSize: 14 }}>{t('step3_dp.protection_level', 'Current Protection Level')}</Text>} 
                value={totalEquivalentEpsilon <= 2.0 ? t('step3_dp.level_high', 'High Security') : totalEquivalentEpsilon <= 8.0 ? t('step3_dp.level_medium', 'Medium Security') : t('step3_dp.level_low', 'Low Security')} 
                prefix={<LockOutlined style={{ fontSize: 28, marginRight: 8, color: totalEquivalentEpsilon <= 2.0 ? '#722ed1' : totalEquivalentEpsilon <= 8.0 ? '#13c2c2' : '#fa8c16' }}/>} 
                formatter={(val) => <span style={{ fontSize: 42, fontWeight: 'bold', color: totalEquivalentEpsilon <= 2.0 ? '#722ed1' : totalEquivalentEpsilon <= 8.0 ? '#13c2c2' : '#fa8c16' }}>{val}</span>}
              />
            </div>

            <Divider style={{ margin: '16px 0', borderColor: isDark ? '#303030' : '#e8e8e8' }} />

            <ReactECharts option={getDPOption()} style={{ height: '420px', width: '100%' }} theme={isDark ? 'dark' : 'light'} />
          </Card>
        </Col>

      </Row>
    </div>
  );
}