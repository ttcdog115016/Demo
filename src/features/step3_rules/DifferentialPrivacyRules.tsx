import { useMemo, useEffect } from 'react';
import { 
  Alert, Card, Slider, Row, Col, Statistic, Divider, 
  InputNumber, theme, Switch, Select, Space, Progress, Typography, Table, Tag
} from 'antd';
import { 
  LockOutlined, LineChartOutlined, CalculatorOutlined, 
  DashboardOutlined, GlobalOutlined, ControlOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

export default function DifferentialPrivacyRules() {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const { t } = useTranslation();
  
  const { 
    dpFields, 
    targetDelta, 
    queryCount, 
    budgetLimitEpsilon,
    outOfBoundsStrategy,
    toggleFieldEnable,
    updateFieldDP,
    updateStep3Params,
    setStepValidation // 🌟 引入防呆驗證函數
  } = usePrivacyStore();

  const activeFields = useMemo(() => dpFields?.filter(f => f.enabled) || [], [dpFields]);

  const convertedFields = useMemo(() => {
    return activeFields.map(field => {
      let eqEps = field.epsilon;
      if (field.mode === 'epsilon-delta' && field.delta > 0 && targetDelta > 0 && field.delta !== targetDelta) {
        const ratio = Math.log(1 / targetDelta) / Math.log(1 / field.delta);
        eqEps = field.epsilon * ratio;
      }
      return { ...field, equivalentEpsilon: parseFloat(eqEps.toFixed(4)) };
    });
  }, [activeFields, targetDelta]);

  const totalEquivalentEpsilon = useMemo(() => {
    const sum = convertedFields.reduce((acc, curr) => acc + curr.equivalentEpsilon, 0);
    return parseFloat(sum.toFixed(4));
  }, [convertedFields]);

  const accumulatedEpsilon = parseFloat((totalEquivalentEpsilon * queryCount).toFixed(3));
  const budgetUsagePercent = Math.min((accumulatedEpsilon / budgetLimitEpsilon) * 100, 100);
  const isBudgetDanger = budgetUsagePercent >= 90;
  const isBudgetWarning = budgetUsagePercent >= 75 && !isBudgetDanger;

  // 🌟 核心防呆邏輯：DP 參數即時驗證
  useEffect(() => {
    if (targetDelta === undefined || targetDelta === null || targetDelta < 0 || targetDelta >= 1) {
      setStepValidation(false, t('step3_dp.error_delta_invalid', '目標 Delta (δ) 必須介於 0 與 1 之間。'));
      return;
    }
    
    const hasInvalidEpsilon = activeFields.some(f => f.epsilon <= 0);
    if (hasInvalidEpsilon) {
      setStepValidation(false, t('step3_dp.error_epsilon_zero', '啟用的欄位中，Epsilon (ε) 必須大於 0。'));
      return;
    }

    if (budgetUsagePercent > 100) {
      setStepValidation(false, t('step3_dp.error_budget_exceeded', '消耗的總隱私預算已超過設定上限，請調降各欄位的 ε 或是減少模擬查詢次數。'));
      return;
    }

    setStepValidation(true, null);
  }, [targetDelta, activeFields, budgetUsagePercent, setStepValidation, t]);

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
      grid: { top: '15%', left: '8%', right: '8%', bottom: '12%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: ['20K', '30K', '40K', '50K', '60K', '70K', '80K', '90K', '100K'], name: t('step3_dp.chart_x_axis', 'Value Range'), nameLocation: 'center', nameGap: 30, nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500 }, axisLabel: { color: token.colorTextDescription }, axisLine: { lineStyle: { color: token.colorBorder } } },
      yAxis: { type: 'value', name: t('step3_dp.chart_y_axis', 'Density/Frequency'), nameLocation: 'end', nameTextStyle: { color: token.colorTextSecondary }, axisLabel: { show: false }, splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { show: false } },
      series: [
        { name: t('step3_dp.chart_original', 'Original Distribution'), type: 'line', smooth: true, color: isDark ? '#434343' : '#d9d9d9', data: originalDistribution, areaStyle: { opacity: 0.05 }, lineStyle: { width: 1.5, type: 'dashed' }, showSymbol: false }, 
        { name: t('step3_dp.chart_noisy', 'Noisy Distribution'), type: 'line', smooth: true, color: token.colorPrimary, data: noisyDistribution, areaStyle: { opacity: isDark ? 0.15 : 0.2 }, lineStyle: { width: 3.5 }, showSymbol: false, itemStyle: { shadowBlur: 8, shadowColor: token.colorPrimary } }
      ]
    };
  };

  type ConvertedField = {
    id: string;
    fieldName: string;
    epsilon: number;
    delta: number;
    mode: 'epsilon' | 'epsilon-delta';
    equivalentEpsilon: number;
  };

  const conversionColumns = [
    { title: t('step3_dp.col_field', 'Field Name'), dataIndex: 'fieldName', key: 'fieldName', render: (text: string) => <Text strong style={{fontSize: 12}}>{text}</Text> },
    { 
      title: t('step3_dp.col_original', 'Original Setting'), 
      key: 'original', 
      render: (_: unknown, record: ConvertedField) => (
        <div style={{ fontSize: 11, color: token.colorTextSecondary }}>
          <div>ε: {record.epsilon}</div>
          {record.mode === 'epsilon-delta' && <div>δ: {record.delta}</div>}
        </div>
      )
    },
    { 
      title: t('step3_dp.col_equivalent', 'Equivalent ε'), 
      dataIndex: 'equivalentEpsilon', 
      key: 'equivalentEpsilon', 
      render: (val: number) => <Tag color="purple" style={{ margin: 0 }}>{val}</Tag> 
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
                  min={0.00001} max={0.1} step={0.0001} 
                  value={targetDelta} 
                  onChange={(val) => updateStep3Params({ targetDelta: val ?? 0.0001 })} 
                  style={{ width: '120px' }} 
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
                    min={1} max={20} 
                    value={queryCount} 
                    onChange={(val) => updateStep3Params({ queryCount: val ?? 1 })} 
                    size="small" style={{ width: '60px' }} 
                  />
                </Space>
              </div>
              <Slider 
                min={1} max={20} 
                value={queryCount} 
                onChange={(val) => updateStep3Params({ queryCount: val })} 
                style={{ margin: 0 }}
              />
            </div>
          </Col>
        </Row>
        
        <Divider dashed style={{ margin: '20px 0' }} />
        <Row gutter={48}>
          <Col span={24}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <Text strong>{t('step3_dp.out_of_bounds_strategy', 'Out-of-Bounds Strategy')}</Text>
              <Select 
                value={outOfBoundsStrategy ?? 'clip'} 
                onChange={(val) => updateStep3Params({ outOfBoundsStrategy: val })} 
                style={{ width: '320px' }}
                options={[
                  { value: 'clip', label: t('step3_dp.strategy_clip', '1. Clamp / Clip to Bounds') },
                  { value: 'wrap', label: t('step3_dp.strategy_wrap', '2. Wrap-around (Modulo)') },
                  { value: 'reflect', label: t('step3_dp.strategy_reflect', '3. Reflect / Bounce Back') },
                ]}
              />
            </div>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t('step3_dp.out_of_bounds_desc', 'When noisy numerical data exceeds the lower/upper bounds set in Stage 2, the system applies this post-processing strategy to keep values realistic.')}
            </Text>
          </Col>
        </Row>
      </Card>

      <Card 
        title={<span><ControlOutlined style={{ marginRight: 8, color: '#13c2c2' }} />{t('step3_dp.field_tuning_title', '2. Individual Field Fine-Tuning')}</span>} 
        variant="borderless" 
        style={{ background: token.colorBgContainer, boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.04)' }}
      >
        <Row gutter={[24, 24]}>
          {dpFields?.map((field) => (
            <Col span={8} key={field.id}>
              <Card 
                type="inner" 
                title={<Space><Switch checked={field.enabled} onChange={() => toggleFieldEnable(field.id)} size="small" />{field.fieldName}</Space>}
                extra={<Text type="secondary" style={{ fontSize: 12 }}>{field.fieldType}</Text>}
                style={{ 
                  borderColor: field.enabled ? token.colorPrimaryBorder : token.colorBorderSecondary, 
                  opacity: field.enabled ? 1 : 0.45,
                  background: field.enabled ? (isDark ? '#141414' : '#fafafa') : 'transparent',
                  transition: 'all 0.3s',
                  height: '100%'
                }}
              >
                {field.enabled ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <Select 
                      size="small" 
                      value={field.mode} 
                      onChange={(val) => updateFieldDP(field.id, 'mode', val)}
                      options={[{ value: 'epsilon', label: t('step3_dp.eps_dp', 'Pure ε-DP') }, { value: 'epsilon-delta', label: t('step3_dp.eps_delta_dp', '(ε, δ)-DP') }]}
                    />
                    
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginBottom: '4px' }}>
                        <Text type="secondary">{t('step3_dp.epsilon', 'Epsilon (ε)')}</Text>
                        <InputNumber 
                          min={0.01} max={2.0} step={0.01} 
                          value={field.epsilon} 
                          onChange={(val) => updateFieldDP(field.id, 'epsilon', val || 0.01)} 
                          size="small" style={{ width: '80px' }} 
                        />
                      </div>
                      <Slider 
                        min={0.01} max={2.0} step={0.01} 
                        value={field.epsilon} 
                        onChange={(val) => updateFieldDP(field.id, 'epsilon', val)} 
                        style={{ margin: '4px 0 12px 0' }}
                      />
                    </div>

                    {field.mode === 'epsilon-delta' && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginBottom: '4px' }}>
                          <Text type="secondary">{t('step3_dp.delta', 'Delta (δ)')}</Text>
                          <InputNumber 
                            min={0.0001} max={0.01} step={0.0001} 
                            value={field.delta} 
                            onChange={(val) => updateFieldDP(field.id, 'delta', val || 0.0001)} 
                            size="small" style={{ width: '80px' }} 
                          />
                        </div>
                        <Slider 
                          min={0.0001} max={0.01} step={0.0001} 
                          value={field.delta} 
                          onChange={(val) => updateFieldDP(field.id, 'delta', val)} 
                          style={{ margin: '4px 0 8px 0' }} 
                          tooltip={{ formatter: (val) => val?.toFixed(4) }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '60px' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{t('step3_dp.field_disabled', 'Field Disabled')}</Text>
                  </div>
                )}
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Row gutter={24} style={{ alignItems: 'stretch' }}>
        
        <Col span={8}>
          <Card 
            title={<span><DashboardOutlined style={{ marginRight: 8, color: token.colorWarning }} />{t('step3_dp.card2_title', '3. Privacy Budget Usage')}</span>} 
            variant="borderless" 
            style={{ height: '100%', background: token.colorBgContainer, boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.04)' }}
          >
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <Progress 
                type="dashboard" 
                percent={budgetUsagePercent} 
                format={() => `${accumulatedEpsilon}`}
                strokeColor={isBudgetDanger ? token.colorError : isBudgetWarning ? token.colorWarning : token.colorSuccess}
                size={160}
              />
              <div style={{ marginTop: 16 }}>
                <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>{t('step3_dp.accumulated_cost', { limit: budgetLimitEpsilon, defaultValue: `Accumulated Cost (Limit: ${budgetLimitEpsilon})` })}</Text>
                <Text strong style={{ fontSize: 16, color: isBudgetDanger ? token.colorError : isBudgetWarning ? token.colorWarning : token.colorSuccess }}>
                  {isBudgetDanger ? t('step3_dp.budget_danger', 'Over Budget Risk') : isBudgetWarning ? t('step3_dp.budget_warning', 'Budget Running Low') : t('step3_dp.budget_safe', 'Sufficient Budget')}
                </Text>
              </div>
            </div>

            <Divider dashed style={{ margin: '16px 0' }} />
            
            <Table 
              dataSource={convertedFields}
              columns={conversionColumns}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ y: 150 }}
              footer={() => (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <Text>{t('step3_dp.single_equivalent', 'Single Query Equivalent')}</Text>
                  <Text strong style={{ color: token.colorPrimary }}>ε = {totalEquivalentEpsilon}</Text>
                </div>
              )}
            />
          </Card>
        </Col>

        <Col span={16}>
          <Card 
            title={<span><LineChartOutlined style={{ marginRight: 8, color: '#722ed1' }} />{t('step3_dp.card3_title', 'Utility & Protection Assessment')}</span>} 
            variant="borderless" 
            style={{ height: '100%', background: token.colorBgContainer, boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.04)' }}
          >
            <div style={{ display: 'flex', gap: '32px', marginBottom: '16px' }}>
              <Statistic title={t('step3_dp.unified_eps', 'Total Equivalent Epsilon')} value={totalEquivalentEpsilon} prefix={<CalculatorOutlined />} styles={{ content: { color: token.colorPrimary } }} />
              <Statistic title={t('step3_dp.protection_level', 'Current Protection Level')} value={totalEquivalentEpsilon <= 2.0 ? t('step3_dp.level_high', 'High') : totalEquivalentEpsilon <= 8.0 ? t('step3_dp.level_medium', 'Medium') : t('step3_dp.level_low', 'Low')} prefix={<LockOutlined />} styles={{ content:{ color: totalEquivalentEpsilon <= 2.0 ? '#722ed1' : totalEquivalentEpsilon <= 8.0 ? '#13c2c2' : '#fa8c16' } }} />
            </div>
            <ReactECharts option={getDPOption()} style={{ height: '400px', width: '100%' }} theme={isDark ? 'dark' : 'light'} />
          </Card>
        </Col>

      </Row>
    </div>
  );
}