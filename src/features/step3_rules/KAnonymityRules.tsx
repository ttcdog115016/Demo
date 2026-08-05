import { useState, useEffect } from 'react';
import { Alert, Card, Slider, Row, Col, Divider, InputNumber, theme, Select, Button, Tag } from 'antd';
import { LockOutlined, PlusOutlined, DeleteOutlined, WarningOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import { useTranslation } from 'react-i18next';

export default function KAnonymityRules() {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const { t } = useTranslation();

  const { 
    kValue, 
    maxSuppression, 
    lValue, 
    tValue, 
    suppressionMethod, 
    limitExceededAction,
    columns = [], 
    columnRoles = {},
    updateStep3Params,
    setStepValidation // 🌟 引入防呆驗證函數
  } = usePrivacyStore();

  // 🌟 核心防呆邏輯：即時監聽參數變化，如果不合規，立即鎖定「下一步」
  useEffect(() => {
    if (kValue === undefined || kValue === null || kValue < 2) {
      setStepValidation(false, t('step3.error_k_too_small', 'K 值必須大於等於 2（K=1 等同於沒有匿名效果）。'));
      return;
    }
    // 🌟 新增：K 與 L 的邏輯衝突驗證 (這在 UI 上是自由的，有可能發生)
    if (kValue < lValue) {
      setStepValidation(false, t('step3.error_k_less_than_l', `參數衝突：要求資料具備 ${lValue} 種多樣性 (L=${lValue})，但群組大小僅有 ${kValue} (K=${kValue})，這是數學上無法達成的。請確保 K ≥ L。`));
      return;
    }
    if (tValue === undefined || tValue === null || tValue <= 0 || tValue > 1) {
      setStepValidation(false, t('step3.error_t_range', 'T-Closeness (t) 必須介於 0 與 1 之間。'));
      return;
    }
    
    // 參數全部通過驗證，解鎖「下一步」
    setStepValidation(true, null);
  }, [kValue, lValue, tValue, maxSuppression, setStepValidation, t]);

  const handleKValueChange = (val: number | null) => updateStep3Params({ kValue: val ?? 2 });
  const handleLValueChange = (val: number | null) => updateStep3Params({ lValue: val ?? 2 });
  const handleTValueChange = (val: number | null) => updateStep3Params({ tValue: val ?? 0.15 });
  const handleMaxSuppressionChange = (val: number | null) => updateStep3Params({ maxSuppression: val ?? 0 });
  const handleSuppressionMethodChange = (val: 'row' | 'cell') => updateStep3Params({ suppressionMethod: val });
  const handleLimitExceededActionChange = (val: string) => updateStep3Params({ limitExceededAction: val });

  const filteredQiColumns = columns.filter(col => {
    const role = (columnRoles[col] || '').toLowerCase();
    return role === 'qi' || role === 'quasi' || role === 'quasi-identifier';
  });

  const qiColumns = filteredQiColumns.length > 0 
    ? filteredQiColumns 
    : columns.filter(col => (columnRoles[col] || '').toLowerCase() !== 'identifier');

  const [kMode, setKMode] = useState<'all' | 'custom'>('all');
  const [qiCombinations, setQiCombinations] = useState<string[][]>([[]]);

  const addCombination = () => setQiCombinations([...qiCombinations, []]);
  const removeCombination = (index: number) => { 
    const newCombos = qiCombinations.filter((_, idx) => idx !== index); 
    setQiCombinations(newCombos.length ? newCombos : [[]]); 
  };
  const updateCombination = (index: number, val: string[]) => { 
    const newCombos = [...qiCombinations]; 
    newCombos[index] = val; 
    setQiCombinations(newCombos); 
  };

  const getKAnonymityChartOption = () => {
    const paretoLineData = Array.from({ length: 40 }, (_, i) => {
      const y = 15 + (i * (80 / 39));
      const x = 100 - Math.pow((y - 15) / 80, 2.5) * 85;
      return [Number(x.toFixed(1)), Number(y.toFixed(1))];
    });

    const pK = (kValue - 2) / 18;        
    const pL = (lValue - 1) / 9;         
    const pT = (1 - tValue) / 0.99;      
    
    const privacyIntensity = Math.min(1, Math.max(0, (pK * 0.5) + (pL * 0.25) + (pT * 0.25)));
    const currentY = 15 + (privacyIntensity * 80);

    const optimalX = 100 - Math.pow((currentY - 15) / 80, 2.5) * 85;

    const suppressionPenalty = maxSuppression >= 12 ? 0 : (12 - maxSuppression) * 1.8;
    const currentX = Math.max(2, optimalX - Math.pow(suppressionPenalty, 1.2));

    const currentPoint = [Number(currentX.toFixed(1)), Number(currentY.toFixed(1))];

    return {
      backgroundColor: 'transparent',
      tooltip: { 
        trigger: 'item', 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (params.name === t('step3.current_setting')) {
            return `<div style="font-weight:bold;margin-bottom:4px;color:#faad14;">${t('step3.chart_eval')}</div>
                    ${t('step3.chart_utility')}${params.data.coord[0]}%<br/>
                    ${t('step3.chart_privacy')}${params.data.coord[1]}%<br/>
                    <span style="font-size: 11px; color: #8c8c8c;">${t('step3.chart_distance')}${(optimalX - currentX).toFixed(1)}%</span>`;
          }
          return params.seriesName === t('step3.chart_pareto_front') 
            ? `${t('step3.chart_pareto_limit')}<br/>${t('step3.chart_util_short')} ${params.data[0]}% | ${t('step3.chart_priv_short')} ${params.data[1]}%` : '';
        } 
      },
      grid: { top: '18%', left: '12%', right: '25%', bottom: '15%', containLabel: true },
      xAxis: { 
        type: 'value', min: 0, max: 100, name: t('step3.chart_x_axis'), nameLocation: 'center', nameGap: 30, 
        nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500 }, 
        axisLabel: { formatter: '{value} %', color: token.colorTextDescription }, 
        splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { lineStyle: { color: token.colorBorder } } 
      },
      yAxis: { 
        type: 'value', min: 0, max: 100, name: t('step3.chart_y_axis'), nameLocation: 'center', nameGap: 40, 
        nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500 }, 
        axisLabel: { formatter: '{value} %', color: token.colorTextDescription }, 
        splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { lineStyle: { color: token.colorBorder } } 
      },
      series: [
        { 
          name: t('step3.chart_pareto_front'), type: 'line', smooth: true, data: paretoLineData, 
          lineStyle: { color: isDark ? '#5c6bc0' : '#3f51b5', width: 2, type: 'dashed' }, showSymbol: false 
        },
        {
          name: t('step3.current_status'), type: 'scatter', data: [],
          markPoint: {
            symbol: 'circle',
            data: [
              { coord: [15, 95], name: t('step3.extreme_privacy'), itemStyle: { color: '#722ed1' }, symbolSize: 8, label: { show: true, position: 'top', formatter: t('step3.extreme_privacy'), color: token.colorTextDescription, fontSize: 11 } }, 
              { coord: [100, 15], name: t('step3.extreme_utility'), itemStyle: { color: '#13c2c2' }, symbolSize: 8, label: { show: true, position: 'right', offset: [6, 0], formatter: t('step3.extreme_utility'), color: token.colorTextDescription, fontSize: 11 } }, 
              { 
                coord: currentPoint, 
                name: t('step3.current_setting'), 
                itemStyle: { color: '#faad14', borderColor: '#fff', borderWidth: 2, shadowBlur: 10, shadowColor: 'rgba(250, 173, 20, 0.5)' }, 
                symbolSize: 16, 
                label: { show: true, position: 'top', formatter: `${t('step3.current_setting')}\nU:${currentPoint[0]}% P:${currentPoint[1]}%`, fontWeight: 'bold', color: '#faad14', backgroundColor: isDark ? '#141414' : '#fff', padding: [4, 6], borderRadius: 4, borderWidth: 1, borderColor: token.colorBorder, lineHeight: 16 } 
              }
            ]
          }
        }
      ]
    };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Alert title={t('step3.k_params_title')} description={t('step3.k_params_desc')} type="info" showIcon />
      <Row gutter={24} align="stretch">
        <Col span={10}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', paddingRight: '4px' }}>
            <Card title={<span style={{ fontWeight: 600 }}><LockOutlined /> {t('step3.privacy_settings')}</span>} variant="borderless" style={{ background: token.colorBgContainer, boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.04)', flex: 1 }}>
              
              <Row gutter={16} align="middle" style={{ marginBottom: '6px' }}>
                <Col span={8}><span style={{ color: token.colorText }}>k-anonymity (k)：</span></Col>
                <Col span={10}><Slider min={2} max={20} value={kValue} onChange={handleKValueChange} /></Col>
                <Col span={6}><InputNumber min={2} max={20} value={kValue} onChange={handleKValueChange} style={{ width: '100%' }} /></Col>
              </Row>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: kMode === 'custom' ? '8px' : '16px' }}>
                <span style={{ color: token.colorTextSecondary, fontSize: '12px', minWidth: '70px' }}>{t('step3.calc_scope')}</span>
                <Select value={kMode} onChange={(val) => setKMode(val as 'all' | 'custom')} size="small" style={{ flex: 1 }} options={[{ value: 'all', label: t('step3.apply_all_qi') }, { value: 'custom', label: t('step3.custom_qi_combo') }]} />
              </div>
              
              {kMode === 'custom' && (
                <div style={{ marginBottom: '16px', padding: '12px', background: isDark ? '#141414' : '#fafafa', borderRadius: '8px', border: `1px solid ${token.colorBorder}` }}>
                  {qiCombinations.map((combo, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <Tag color="cyan" style={{ margin: 'auto 0', height: 'fit-content' }}>{t('step3.combo_idx', { idx: idx + 1 })}</Tag>
                      <Select 
                        mode="multiple" 
                        allowClear 
                        placeholder={t('step3.select_field')} 
                        style={{ flex: 1 }} 
                        value={combo} 
                        onChange={(val) => updateCombination(idx, val)} 
                        options={qiColumns.map(qi => ({ 
                          label: qi, 
                          value: qi, 
                          disabled: qiCombinations.some((c, i) => i !== idx && c.includes(qi)) 
                        }))} 
                      />
                      <Button danger icon={<DeleteOutlined />} disabled={qiCombinations.length === 1} onClick={() => removeCombination(idx)} />
                    </div>
                  ))}
                  <Button type="dashed" block icon={<PlusOutlined />} disabled={qiCombinations.reduce((acc, combo) => acc + combo.length, 0) >= qiColumns.length} onClick={addCombination}>{t('step3.add_threat_combo')}</Button>
                </div>
              )}
              
              <Row gutter={16} align="middle" style={{ marginBottom: '16px' }}>
                <Col span={8}><span style={{ color: token.colorText }}>l-diversity (l)：</span></Col>
                <Col span={10}><Slider min={1} max={10} value={lValue} onChange={handleLValueChange} /></Col>
                <Col span={6}><InputNumber min={1} max={10} value={lValue} onChange={handleLValueChange} style={{ width: '100%' }} /></Col>
              </Row>
              
              <Row gutter={16} align="middle" style={{ marginBottom: '8px' }}>
                <Col span={8}><span style={{ color: token.colorText }}>t-closeness (t)：</span></Col>
                <Col span={10}><Slider min={0.01} max={1.0} step={0.01} value={tValue} onChange={handleTValueChange} /></Col>
                <Col span={6}><InputNumber min={0.01} max={1.0} step={0.01} value={tValue} onChange={handleTValueChange} style={{ width: '100%' }} /></Col>
              </Row>
              
              <Divider dashed style={{ margin: '16px 0' }} />
              <div style={{ padding: '16px', background: isDark ? '#141414' : '#fafafa', borderRadius: '8px', border: `1px solid ${token.colorBorder}` }}>
                <div style={{ fontWeight: 600, marginBottom: '16px', color: token.colorText }}><WarningOutlined style={{ color: token.colorWarning, marginRight: '6px' }} /> {t('step3.suppression_strategy')}</div>
                
                <Row align="middle" style={{ marginBottom: '16px' }}>
                  <Col span={7}><span style={{ color: token.colorTextSecondary, fontSize: '13px' }}>{t('step3.suppress_method')}</span></Col>
                  <Col span={17}><Select value={suppressionMethod} onChange={handleSuppressionMethodChange} size="small" style={{ width: '100%' }} options={[{ value: 'row', label: t('step3.row_suppression') }, { value: 'cell', label: t('step3.cell_suppression') }]} /></Col>
                </Row>
                <Row align="middle" style={{ marginBottom: '4px' }}>
                  <Col span={7}><span style={{ color: token.colorTextSecondary, fontSize: '13px' }}>{t('step3.suppress_limit')}</span></Col>
                  <Col span={11}><Slider min={0} max={50} value={maxSuppression} onChange={handleMaxSuppressionChange} style={{ margin: '0 8px 0 0' }} /></Col>
                  <Col span={6}><InputNumber min={0} max={50} value={maxSuppression} onChange={handleMaxSuppressionChange} style={{ width: '100%' }} size="small" addonAfter="%" /></Col>
                </Row>
                <Row align="middle">
                  <Col span={7}><span style={{ color: token.colorTextSecondary, fontSize: '13px' }}>{t('step3.exceed_behavior')}</span></Col>
                  <Col span={17}>
                    <Select 
                      value={limitExceededAction} 
                      onChange={handleLimitExceededActionChange} 
                      size="small" 
                      style={{ width: '100%' }} 
                      options={[
                        { value: 'stop_and_error', label: t('step3.stop_and_error') }, 
                        { value: 'relax_k', label: t('step3.relax_k') }, 
                        { value: 'force_suppress', label: t('step3.force_suppress') }
                      ]} 
                    />
                  </Col>
                </Row>
              </div>
            </Card>
          </div>
        </Col>
        <Col span={14}>
          <Card title={t('step3.solution_space')} variant="borderless" style={{ background: token.colorBgContainer, boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.04)', height: '100%' }}>
            <ReactECharts option={getKAnonymityChartOption()} style={{ height: '420px', width: '100%' }} theme={isDark ? 'dark' : 'light'} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}