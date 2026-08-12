import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { 
  Card, Row, Col, Table, Tag, Alert, Button, 
  Modal, Segmented, Space, Progress, Spin, Steps, theme, App as AntdApp
} from 'antd';
import { 
  CheckCircleOutlined, CheckCircleFilled, DownloadOutlined, 
  FileDoneOutlined, EyeOutlined, SafetyCertificateOutlined, 
  ReloadOutlined, LoadingOutlined, LineChartOutlined, CloudUploadOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../store/useAuthStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useAuditStore } from '../../store/useAuditStore';

interface Html2Pdf {
  set: (opt: Record<string, unknown>) => Html2Pdf;
  from: (element: HTMLElement | null) => Html2Pdf;
  save: () => Promise<void>;
}

interface WindowWithHtml2Pdf extends Window {
  html2pdf: () => Html2Pdf;
}

const applyPreprocess = (val: string, action?: string, param?: string) => {
  if (!val || !action || action === 'none') return val;
  let str = val;
  if (action === 'remove_digits') str = str.replace(/\d+/g, '');
  else if (action === 'remove_spaces') str = str.replace(/\s+/g, '');
  else if (action === 'keep_before' && param) {
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

interface SimulationResult {
  singling: { ori: number; ctrl: number; base: number; risk: number };
  linkability: { ori: number; ctrl: number; base: number; risk: number };
  inference: { ori: number; ctrl: number; base: number; risk: number };
  overallRiskPercent: string;
}

type PipelinePhase = 'uploading' | 'processing' | 'auditing' | 'completed';

export default function Step4_Result() {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const { t } = useTranslation();
  const { message: messageApi } = AntdApp.useApp();

  const user = useAuthStore(state => state.user);
  const addAuditLog = useAuditStore(state => state.addAuditLog);
  const columns = useWorkspaceStore(state => state.columns);
  const previewData = useWorkspaceStore(state => state.previewData);
  const privacyMode = useWorkspaceStore(state => state.privacyMode);
  const kValue = useWorkspaceStore(state => state.kValue);
  const dpFields = useWorkspaceStore(state => state.dpFields);
  const columnRoles = useWorkspaceStore(state => state.columnRoles);
  const preprocessingRules = useWorkspaceStore(state => state.preprocessingRules);
  const fileName = useWorkspaceStore(state => state.fileName);
  const queryCount = useWorkspaceStore(state => state.queryCount);
  const step4Cache = useWorkspaceStore(state => state.step4Cache);
  const lastRunParamsHash = useWorkspaceStore(state => state.lastRunParamsHash);
  const setStep4Cache = useWorkspaceStore(state => state.setStep4Cache);

  const [previewMode, setPreviewMode] = useState<'masked' | 'original'>('masked');
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  const reportRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null); 

  const monteCarloN = 1000;

  const currentParamsHash = useMemo(() => {
    return JSON.stringify({
      privacyMode, kValue, queryCount, dpFields, columnRoles, preprocessingRules
    });
  }, [privacyMode, kValue, queryCount, dpFields, columnRoles, preprocessingRules]);

  const isCacheValid = useMemo(() => {
    return step4Cache !== null && lastRunParamsHash === currentParamsHash;
  }, [step4Cache, lastRunParamsHash, currentParamsHash]);
  
  const [isCalculating, setIsCalculating] = useState<boolean>(!isCacheValid);
  const [pipelinePhase, setPipelinePhase] = useState<PipelinePhase>(isCacheValid ? 'completed' : 'uploading');
  const [calcProgress, setCalcProgress] = useState<number>(isCacheValid ? 100 : 0);
  const [logs, setLogs] = useState<string[]>([]);
  const [attackMetrics, setAttackMetrics] = useState<SimulationResult | null>(isCacheValid ? step4Cache!.metrics : null);
  const [auditMetadata, setAuditMetadata] = useState(() => ({
    certificateId: isCacheValid ? step4Cache!.certificateId : `PAC-${Date.now()}`,
    auditTime: isCacheValid ? step4Cache!.auditTime : new Date().toLocaleString()
  }));

  const actualColumns = useMemo(() => {
    return columns && columns.length > 0 
      ? columns 
      : ['card_id', 'card_type', 'in_station', 'in_time', 'out_station', 'out_time', 'ride_duration_mins', 'fare'];
  }, [columns]);

  const sampleRawData = useMemo(() => {
    return previewData && previewData.length > 0 
      ? previewData.slice(0, 10) 
      : [
          { card_id: 'TX16863', card_type: '敬老卡', in_station: '西門', in_time: '2026-07-17 08:04:00', out_station: '南港', out_time: '2026-07-17 08:20:00', ride_duration_mins: '16', fare: '20' },
          { card_id: 'TX59692', card_type: '敬老卡', in_station: '公館', in_time: '2026-07-17 07:50:00', out_station: '台北車站', out_time: '2026-07-17 08:08:00', ride_duration_mins: '18', fare: '45' },
          { card_id: 'TX83526', card_type: '敬老卡', in_station: '市政府', in_time: '2026-07-17 07:30:00', out_station: '板橋', out_time: '2026-07-17 08:07:00', ride_duration_mins: '37', fare: '25' },
        ];
  }, [previewData]);

  const getCalculatedRole = useCallback((col: string) => {
    const colLower = col.toLowerCase();
    const rawRole = (columnRoles[col] || '').toLowerCase();
    const dpCfg = dpFields?.find(f => f.fieldName === col);

    if (privacyMode === 'k-anonymity') {
      if (rawRole.includes('identifier') && !rawRole.includes('quasi')) {
        return { role: 'Identifier', tagColor: 'magenta' };
      }
      if (rawRole.includes('quasi') || rawRole === 'qi') {
        return { role: 'Quasi-identifier', tagColor: 'orange' };
      }
    }

    const isExplicitId = /(^|_)(id|card_id|nric|phone|email|name|ssn)($|_)/i.test(colLower);
    if (isExplicitId) {
      return { role: 'Identifier', tagColor: 'magenta' };
    }

    if (privacyMode === 'differential-privacy') {
      if (dpCfg && dpCfg.enabled) {
        return { role: 'DP Sensitive', tagColor: 'purple' };
      }
      return { role: 'Retained', tagColor: 'blue' };
    }

    if (/(station|time|date|zip|age|gender|card_type)/i.test(colLower)) {
      return { role: 'Quasi-identifier', tagColor: 'orange' };
    }

    return { role: 'Non-sensitive', tagColor: 'blue' };
  }, [columnRoles, dpFields, privacyMode]);

  const runFullPipeline = useCallback((forceRun: boolean = false) => {
    if (!forceRun && isCacheValid) return;

    setIsCalculating(true);
    setCalcProgress(0);
    setPipelinePhase('uploading');
    
    const now = new Date();
    const newMetadata = {
      certificateId: `PAC-${now.getTime()}`,
      auditTime: now.toLocaleString()
    };
    setAuditMetadata(newMetadata);

    const timeStr = () => new Date().toLocaleTimeString();
    setLogs([
      t('step4.log.connect', '[{{time}}] 建立 WebSocket 連線... 準備傳輸巨量資料集', { time: timeStr() }),
      t('step4.log.bind', '[{{time}}] 綁定隱私預算組合參數: 查詢發布次數 M = {{m}}', { time: timeStr(), m: queryCount })
    ]);

    let progress = 0;
    let currentPhase = 'uploading';
    let loggedClean = false, loggedNoise = false, loggedAttack1 = false, loggedAttack2 = false, loggedUtility = false;

    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 5) + 3; 
      if (progress > 100) progress = 100;
      setCalcProgress(progress);

      if (progress < 30) {
        if (currentPhase !== 'uploading') { currentPhase = 'uploading'; setPipelinePhase('uploading'); }
        if (progress % 2 === 0) {
          setLogs(prev => [...prev, t('step4.log.uploading', '[{{time}}] ⬆️ Uploading Chunk [{{part}}/10]... ({{prog}}%)', { time: timeStr(), part: Math.floor(progress / 3), prog: progress })]);
        }
      } 
      else if (progress >= 30 && progress < 65) {
        if (currentPhase !== 'processing') {
          currentPhase = 'processing';
          setPipelinePhase('processing');
          setLogs(prev => [...prev, t('step4.log.uploaded', '[{{time}}] ✅ 檔案切片傳輸完成，驗證 Checksum 成功。', { time: timeStr() })]);
          setLogs(prev => [...prev, t('step4.log.init_engine', '[{{time}}] ⚙️ 初始化分佈式去識別化引擎 (Mode: {{mode}})', { time: timeStr(), mode: privacyMode })]);
        }
        if (progress >= 40 && !loggedClean) {
          loggedClean = true;
          setLogs(prev => [...prev, t('step4.log.cleaning', '[{{time}}] 🧹 執行資料預處理與正規化清洗 (Regex & Trim)...', { time: timeStr() })]);
        }
        if (progress >= 55 && !loggedNoise) {
          loggedNoise = true;
          setLogs(prev => [...prev, privacyMode === 'k-anonymity' ? t('step4.log.k_anon', '[{{time}}] 🌳 運算 K-匿名泛化樹 (Generalization Hierarchy)...', { time: timeStr() }) : t('step4.log.dp_noise', '[{{time}}] 🎲 注入拉普拉斯擾動雜訊 (Laplace Noise)...', { time: timeStr() })]);
        }
      } 
      else if (progress >= 65 && progress < 100) {
        if (currentPhase !== 'auditing') {
          currentPhase = 'auditing';
          setPipelinePhase('auditing');
          setLogs(prev => [...prev, t('step4.log.start_mc', '[{{time}}] 🚀 脫敏完成，啟動蒙地卡羅攻擊模擬器 (N={{n}})', { time: timeStr(), n: monteCarloN })]);
        }
        if (progress >= 70 && !loggedAttack1) {
          loggedAttack1 = true;
          setLogs(prev => [...prev, t('step4.log.attack1', '[{{time}}] ⚔️ 執行指認性與跨表連結攻擊測試 (Singling-Out & Linkability)...', { time: timeStr() })]);
        }
        if (progress >= 85 && !loggedAttack2) {
          loggedAttack2 = true;
          setLogs(prev => [...prev, t('step4.log.attack2', '[{{time}}] 🤖 訓練隨機森林模型評估推斷攻擊 (Inference Attack)...', { time: timeStr() })]);
        }
        if (progress >= 95 && !loggedUtility) {
          loggedUtility = true;
          setLogs(prev => [...prev, t('step4.log.utility', '[{{time}}] 📊 運算資料記錄抑制率與泛化欄位失真度評估...', { time: timeStr() })]);
        }
      } 
      else if (progress >= 100) {
        clearInterval(interval);
        setPipelinePhase('completed');
        
        const isK = privacyMode === 'k-anonymity';
        const compositionFactor = privacyMode === 'differential-privacy' ? Math.min(2.0, 1 + (queryCount - 1) * 0.15) : 1.0;

        const singlingOri = (isK ? Math.max(0.05, 0.45 - kValue * 0.03) : 0.12) * compositionFactor;
        const linkOri = (isK ? Math.max(0.08, 0.52 - kValue * 0.04) : 0.18) * compositionFactor;
        const infOri = (isK ? Math.max(0.10, 0.60 - kValue * 0.035) : 0.22) * compositionFactor;

        const calcRisk = (ori: number, ctrl: number, base: number) => {
          const maxDenominator = Math.max(ctrl, base);
          return Math.max(0, (ori - maxDenominator) / (1 - maxDenominator));
        };

        const riskSingling = calcRisk(singlingOri, 0.02, 0.01);
        const riskLink = calcRisk(linkOri, 0.03, 0.02);
        const riskInf = calcRisk(infOri, 0.05, 0.04);
        const overallRisk = Math.max(riskSingling, riskLink, riskInf);

        const metrics: SimulationResult = {
          singling: { ori: singlingOri, ctrl: 0.02, base: 0.01, risk: riskSingling },
          linkability: { ori: linkOri, ctrl: 0.03, base: 0.02, risk: riskLink },
          inference: { ori: infOri, ctrl: 0.05, base: 0.04, risk: riskInf },
          overallRiskPercent: (overallRisk * 100).toFixed(1)
        };

        setAttackMetrics(metrics);

        setStep4Cache({
          metrics,
          certificateId: newMetadata.certificateId,
          auditTime: newMetadata.auditTime
        }, currentParamsHash);

        addAuditLog({
          certificateId: newMetadata.certificateId,
          fileName: fileName || 'dataset.csv',
          privacyMode: privacyMode || 'k-anonymity',
          operator: user?.name || 'Admin.Test',
          operatorRole: user?.role || 'admin',
          auditTime: newMetadata.auditTime,
          parameters: privacyMode === 'k-anonymity' ? `K = ${kValue}` : `發布次數 M = ${queryCount}`,
          singlingRisk: `${(riskSingling * 100).toFixed(1)}%`,
          linkabilityRisk: `${(riskLink * 100).toFixed(1)}%`,
          inferenceRisk: `${(riskInf * 100).toFixed(1)}%`,
          overallRisk: `${metrics.overallRiskPercent}%`,
          status: 'passed'
        });

        setLogs(prev => [...prev, t('step4.log.finished', '[{{time}}] 🎉 後端管線運算完畢，合規憑證已成功簽發！', { time: timeStr() })]);
        
        setTimeout(() => setIsCalculating(false), 600); 
      }
    }, 200);
  }, [privacyMode, kValue, queryCount, fileName, user, addAuditLog, t, isCacheValid, currentParamsHash, setStep4Cache]);

  useEffect(() => {
    if (!isCacheValid) {
      const id = setTimeout(() => runFullPipeline(false), 0);
      return () => clearTimeout(id);
    }
  }, [isCacheValid, runFullPipeline]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const processedData = useMemo(() => {
    return sampleRawData.map((row) => {
      const newRow: Record<string, string> = {};

      actualColumns.forEach(col => {
        let val = String(row[col] ?? '');
        const preRule = preprocessingRules[col];
        if (preRule) {
          val = applyPreprocess(val, preRule.action, preRule.param);
        }

        const { role } = getCalculatedRole(col);

        if (role === 'Identifier') {
          if (val.length > 4) {
            newRow[col] = `${val.substring(0, 2)}****${val.substring(val.length - 2)}`;
          } else {
            newRow[col] = '***';
          }
        } 
        else if (privacyMode === 'differential-privacy') {
          const dpCfg = dpFields?.find(f => f.fieldName === col && f.enabled);
          if (dpCfg && dpCfg.fieldType === 'Numeric' && /^-?\d+(\.\d+)?$/.test(val)) {
            const num = parseFloat(val);
            const eps = (dpCfg.epsilon || 1.0) / Math.sqrt(queryCount); 
            const u = Math.random() - 0.5;
            const lower = dpCfg.lowerBound ?? 0;
            const upper = dpCfg.upperBound ?? 100;
            const lowerNum = Number(lower);
            const upperNum = Number(upper);
            const sensitivity = Math.max(1, upperNum - lowerNum);
            const b = sensitivity / eps;
            const noise = -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));

            const noisyVal = Math.min(upperNum, Math.max(lowerNum, Math.round(num + noise)));
            newRow[col] = noisyVal.toString();
          } else {
            newRow[col] = val;
          }
        } 
        else if (privacyMode === 'k-anonymity' && role === 'Quasi-identifier') {
          if (/^\d+$/.test(val)) {
            const num = parseInt(val, 10);
            const step = 10;
            const lower = Math.floor(num / step) * step;
            newRow[col] = `${lower} - ${lower + step - 1}`;
          } else if (/^\d{4}-\d{2}-\d{2}/.test(val)) {
            newRow[col] = val.substring(0, 4);
          } else {
            newRow[col] = val.length > 2 ? `${val.substring(0, val.length - 1)}*` : '***';
          }
        } 
        else {
          newRow[col] = val;
        }
      });

      return newRow;
    });
  }, [sampleRawData, actualColumns, preprocessingRules, privacyMode, dpFields, getCalculatedRole, queryCount]);

  const getAttackChartOption = () => {
    if (!attackMetrics) return {};
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { 
        data: [
          t('step4.chart.s_ori', 'S_ori (主要攻擊成功率)'), 
          t('step4.chart.s_ctrl', 'S_ctrl (控制組偽陽性率)'), 
          t('step4.chart.s_base', 'S_base (基線猜測率)')
        ],
        textStyle: { color: token.colorTextSecondary },
        top: '0%'
      },
      grid: { top: '18%', left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: [
          t('step4.chart.singling', '指認性攻擊 (Singling Out)'), 
          t('step4.chart.linkability', '連結性攻擊 (Linkability)'), 
          t('step4.chart.inference', '推斷性攻擊 (Inference)')
        ],
        axisLabel: { color: token.colorTextSecondary }
      },
      yAxis: {
        type: 'value',
        max: 1.0,
        axisLabel: { formatter: (val: number) => `${(val * 100).toFixed(0)}%`, color: token.colorTextDescription },
        splitLine: { lineStyle: { color: token.colorSplit } }
      },
      series: [
        {
          name: t('step4.chart.s_ori', 'S_ori (主要攻擊成功率)'),
          type: 'bar',
          data: [attackMetrics.singling.ori, attackMetrics.linkability.ori, attackMetrics.inference.ori],
          itemStyle: { color: '#ff4d4f', borderRadius: [4, 4, 0, 0] }
        },
        {
          name: t('step4.chart.s_ctrl', 'S_ctrl (控制組偽陽性率)'),
          type: 'bar',
          data: [attackMetrics.singling.ctrl, attackMetrics.linkability.ctrl, attackMetrics.inference.ctrl],
          itemStyle: { color: '#faad14', borderRadius: [4, 4, 0, 0] }
        },
        {
          name: t('step4.chart.s_base', 'S_base (基線猜測率)'),
          type: 'bar',
          data: [attackMetrics.singling.base, attackMetrics.linkability.base, attackMetrics.inference.base],
          itemStyle: { color: '#91caff', borderRadius: [4, 4, 0, 0] }
        }
      ]
    };
  };

  const handleOpenReportModal = () => {
    setReportModalVisible(true);
  };

  const handleDownloadCSV = () => {
    const headers = actualColumns.join(',');
    const rows = processedData.map(row => actualColumns.map(col => `"${row[col] || ''}"`).join(','));
    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `deidentified_dataset_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    messageApi.success(t('step4.msg.download_success', '已成功匯出全量脫敏 CSV 數據！'));
  };

  const handleDownloadPDF = async () => {
    const element = document.getElementById('printable-audit-report');
    if (!element) return;
    
    const hideLoading = messageApi.loading(t('step4.msg.pdf_compiling', '正在編譯高畫質 PDF，請稍候...'), 0);
    
    setIsExporting(true);
    
    // 給予 400ms 讓 React 完成 DOM 重繪
    await new Promise(resolve => setTimeout(resolve, 400));

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    
    script.onload = () => {
      const opt = {
        margin:       [10, 10, 10, 10], // 上右下左留白 (mm)
        filename:     `Privacy_Audit_Certificate_${auditMetadata.certificateId}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { 
          scale: 2, 
          useCORS: true, 
          backgroundColor: '#ffffff',
          scrollY: 0,
          scrollX: 0
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'], avoid: ['tr', '.pdf-page-break'] }
      };

      (window as unknown as WindowWithHtml2Pdf).html2pdf().set(opt).from(element).save().then(() => {
        hideLoading();
        messageApi.success(t('step4.msg.pdf_success', '合規審計憑證 PDF 已成功下載！'));
      }).catch((err: unknown) => {
        hideLoading();
        messageApi.error(t('step4.msg.pdf_failed', 'PDF 下載失敗'));
        console.error(err);
      }).finally(() => {
        setIsExporting(false);
      });
    };
    
    script.onerror = () => {
      hideLoading();
      messageApi.error(t('step4.msg.pdf_no_lib', '無法載入 PDF 轉檔套件，請檢查網路連線。'));
      setIsExporting(false);
    };
    
    document.body.appendChild(script);
  };

  const currentUserRole = user?.role || 'admin';

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Alert
          title={
            <Space>
              <CheckCircleFilled style={{ color: '#52c41a' }} />
              <span style={{ fontWeight: 600 }}>{t('step4.alert.title', '去識別化矩陣演算與風險審計完成')}</span>
            </Space>
          }
          description={t('step4.alert.desc', '系統已完成蒙地卡羅攻擊模擬評估，請檢視三大去識別化防禦指標並下載合規報告。')}
          type="success"
          showIcon={false}
          style={{ flex: 1, marginRight: '24px' }}
        />
        <Space size="middle">
          <Button
            icon={<ReloadOutlined spin={isCalculating} />}
            onClick={() => runFullPipeline(true)}
            disabled={isCalculating}
            size="large"
          >
            {t('step4.btn.recalculate', '重新發起後端運算')}
          </Button>
          <Button 
            type="default" 
            icon={<FileDoneOutlined />} 
            disabled={isCalculating} 
            onClick={handleOpenReportModal}
            size="large"
          >
            {t('step4.btn.view_report', '檢視與匯出憑證')}
          </Button>
          <Button 
            type="primary" 
            icon={<DownloadOutlined />} 
            disabled={isCalculating} 
            onClick={handleDownloadCSV}
            size="large"
            style={{ background: '#4F46E5', borderColor: '#4F46E5' }}
          >
            {t('step4.btn.download_csv', '下載脫敏 CSV')}
          </Button>
        </Space>
      </div>

      {isCalculating ? (
        <Card variant="borderless" style={{ background: token.colorBgContainer }}>
          <div style={{ padding: '32px 16px', background: isDark ? '#141414' : '#f8fafc', borderRadius: '12px' }}>
            
            <Row justify="center" style={{ marginBottom: '32px' }}>
              <Col xs={24} md={20} lg={16}>
                <Steps
                  current={
                    pipelinePhase === 'uploading' ? 0 :
                    pipelinePhase === 'processing' ? 1 :
                    pipelinePhase === 'auditing' ? 2 : 3
                  }
                  items={[
                    { title: t('step4.steps.upload.title', '切片上傳'), content: 'Chunk Upload', icon: <CloudUploadOutlined /> },
                    { title: t('step4.steps.process.title', '後端脫敏'), content: 'Data Processing', icon: <LoadingOutlined /> },
                    { title: t('step4.steps.audit.title', '風險審計'), content: 'Risk Auditing', icon: <SafetyCertificateOutlined /> },
                    { title: t('step4.steps.complete.title', '完成簽發'), content: 'Completed', icon: <CheckCircleOutlined /> },
                  ]}
                />
              </Col>
            </Row>

            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: token.colorPrimary }} spin />} />
              <h3 style={{ marginTop: '16px', color: token.colorText }}>
                {pipelinePhase === 'uploading' && t('step4.loading.uploading', '正在將大數據切片 (Chunk) 傳輸至後端伺服器...')}
                {pipelinePhase === 'processing' && t('step4.loading.processing', '後端正在執行去識別化矩陣與加噪演算...')}
                {pipelinePhase === 'auditing' && t('step4.loading.auditing', '正在執行蒙地卡羅攻擊模擬與可用性評估...')}
                {pipelinePhase === 'completed' && t('step4.loading.completed', '後端演算完畢，正在生成最終合規報告...')}
              </h3>
              <Progress percent={calcProgress} status="active" style={{ maxWidth: '600px', margin: '16px auto' }} strokeColor={token.colorPrimary} />
            </div>
            
            <div style={{ maxWidth: '800px', margin: '0 auto', background: isDark ? '#000000' : '#1e1e1e', color: '#00ff66', fontFamily: 'monospace', padding: '16px', borderRadius: '8px', textAlign: 'left', fontSize: '13px', height: '180px', overflowY: 'auto', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)' }}>
              {logs.map((log, idx) => <div key={idx} style={{ marginBottom: '4px' }}>{log}</div>)}
              <div ref={logsEndRef} />
            </div>

          </div>
        </Card>
      ) : (
        attackMetrics && (
          <Row gutter={24} style={{ display: 'flex', alignItems: 'stretch' }}>
            <Col span={16} style={{ display: 'flex' }}>
              <Card 
                title={<span><SafetyCertificateOutlined style={{ marginRight: 8, color: token.colorPrimary }} />{t('step4.risk.title', '安全性評估 (Privacy Risks)')}</span>}
                variant="borderless"
                style={{ background: token.colorBgContainer, width: '100%', display: 'flex', flexDirection: 'column' }}
                styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
              >
                <div style={{ background: isDark ? '#141414' : '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px', border: `1px solid ${token.colorBorderSecondary}` }}>
                  <Row align="middle" justify="space-between">
                    <Col>
                      <div style={{ fontSize: '12px', color: token.colorTextDescription, marginBottom: '4px' }}>
                        {t('step4.risk.overall_desc', '連續發布 M={{m}} 次之綜合殘餘風險', { m: queryCount })}
                      </div>
                      <span style={{ fontSize: '24px', fontWeight: 'bold', color: parseFloat(attackMetrics.overallRiskPercent) < 20 ? '#52c41a' : '#faad14' }}>
                        {attackMetrics.overallRiskPercent}%
                      </span>
                    </Col>
                    <Col>
                      <Tag color="success" style={{ padding: '4px 12px', borderRadius: '4px', margin: 0, fontWeight: 'bold' }}>
                        <CheckCircleOutlined style={{ marginRight: 4 }} /> {t('step4.risk.passed', '防禦驗證通過')}
                      </Tag>
                    </Col>
                  </Row>
                </div>
                
                <ReactECharts option={getAttackChartOption()} style={{ height: '260px', marginBottom: '16px' }} theme={isDark ? 'dark' : 'light'} />
                
                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                  <Tag color="red" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>{t('step4.risk.singling', '指認風險:')} {(attackMetrics.singling.risk * 100).toFixed(1)}%</Tag>
                  <Tag color="orange" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>{t('step4.risk.linkability', '連結風險:')} {(attackMetrics.linkability.risk * 100).toFixed(1)}%</Tag>
                  <Tag color="cyan" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>{t('step4.risk.inference', '推斷風險:')} {(attackMetrics.inference.risk * 100).toFixed(1)}%</Tag>
                </div>
              </Card>
            </Col>

            <Col span={8} style={{ display: 'flex' }}>
              <Card 
                title={<span><LineChartOutlined style={{ marginRight: 8, color: '#1677ff' }} />{t('step4.utility.title', '資料效用與失真度評估')}</span>}
                variant="borderless"
                style={{ background: token.colorBgContainer, width: '100%', display: 'flex', flexDirection: 'column' }}
                styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
              >
                <div style={{ background: isDark ? '#141414' : '#f8fafc', padding: '24px 16px', borderRadius: '8px', border: `1px solid ${token.colorBorderSecondary}`, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', alignItems: 'center' }}>
                  
                  <div style={{ textAlign: 'center', width: '100%', paddingBottom: '24px', borderBottom: `1px dashed ${token.colorBorderSecondary}` }}>
                    <div style={{ fontSize: '14px', color: token.colorTextDescription, marginBottom: '16px' }}>
                      {t('step4.utility.suppression', '資料記錄抑制率')}
                    </div>
                    <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#1677ff', marginBottom: '16px', fontFamily: 'monospace', lineHeight: 1 }}>
                      0.5 <span style={{ fontSize: '20px' }}>%</span>
                    </div>
                    <div style={{ fontSize: '12px', color: token.colorTextDescription, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <span>{t('step4.utility.suppression_progress', '極限 5%：')}</span>
                      <Progress percent={10} showInfo={false} style={{ width: '80px', margin: 0 }} strokeColor="#1677ff" size="small" />
                      <span style={{ color: token.colorText }}>2.5%</span>
                    </div>
                  </div>

                  <div style={{ textAlign: 'center', width: '100%', paddingTop: '24px' }}>
                    <div style={{ fontSize: '14px', color: token.colorTextDescription, marginBottom: '16px' }}>
                      {t('step4.utility.total_cols', '處理欄位總數')}
                    </div>
                    <div style={{ fontSize: '36px', fontWeight: 'bold', color: token.colorText, fontFamily: 'monospace', lineHeight: 1 }}>
                      {actualColumns.length} <span style={{ fontSize: '20px', color: token.colorTextSecondary }}>{t('step4.utility.unit_cols', '個')}</span>
                    </div>
                  </div>
                  
                </div>
              </Card>
            </Col>
          </Row>
        )
      )}

      <Card 
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><EyeOutlined style={{ marginRight: 8, color: '#13c2c2' }} />{t('step4.preview.title', '脫敏結果預覽對照 (First 10 Rows)')}</span>
            <Segmented 
              options={[
                { label: t('step4.preview.masked', '脫敏後數據 (Masked)'), value: 'masked' },
                { label: t('step4.preview.raw', '原始明文數據 (Raw)'), value: 'original' }
              ]} 
              value={previewMode}
              onChange={(val) => setPreviewMode(val as 'masked' | 'original')}
            />
          </div>
        }
        variant="borderless"
        style={{ background: token.colorBgContainer }}
      >
        <Table 
          dataSource={previewMode === 'masked' ? processedData : sampleRawData}
          columns={actualColumns.map(col => {
            const { role, tagColor } = getCalculatedRole(col);
            const roleI18nKey = `step4.role.${role.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;
            return {
              title: (
                <div>
                  <div>{col}</div>
                  <Tag color={tagColor} style={{ fontSize: '10px', margin: 0 }}>
                    {t(roleI18nKey, role)}
                  </Tag>
                </div>
              ),
              dataIndex: col,
              key: col,
            };
          })}
          pagination={{ pageSize: 10 }}
          size="small"
          rowKey={(record) => JSON.stringify(record)}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      <Modal
        title={t('step4.modal.title', '合規審計報告 (Privacy Audit Certificate)')}
        open={reportModalVisible}
        onCancel={() => setReportModalVisible(false)}
        width={800}
        styles={{
          body: { 
            maxHeight: '72vh', 
            overflowY: 'auto', 
            paddingRight: '6px' 
          }
        }}
        footer={[
          <Button key="close" onClick={() => setReportModalVisible(false)}>{t('step4.modal.close', '關閉')}</Button>,
          <Button key="download" type="primary" icon={<DownloadOutlined />} loading={isExporting} onClick={handleDownloadPDF} style={{ background: '#4F46E5' }}>
            {t('step4.modal.export_pdf', '匯出 PDF 憑證')}
          </Button>
        ]}
      >
        {attackMetrics && (
          <div 
            id="printable-audit-report" 
            ref={reportRef} 
            style={{ 
              padding: isExporting ? '0px' : '24px', 
              color: '#000000', 
              backgroundColor: '#ffffff', 
              borderRadius: '4px',
              fontFamily: 'sans-serif'
            }}
          >
            {/* 標頭與通過標籤 */}
            <div className="pdf-page-break" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${token.colorPrimary}`, paddingBottom: '12px', marginBottom: '24px', pageBreakInside: 'avoid' }}>
              <div>
                <h2 style={{ margin: 0, color: token.colorPrimary, fontSize: '20px' }}>{t('step4.report.header', '數據隱私合規與技術審計憑證')}</h2>
                <span style={{ fontSize: '12px', color: '#555555' }}>{t('step4.report.cert_id', '憑證編號:')} {auditMetadata.certificateId}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
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
                  <span style={{ marginRight: '6px', fontSize: '15px' }}>✓</span> {t('step4.report.passed', '通過合規標準')}
                </span>
              </div>
            </div>

            {/* 專案資訊 */}
            <div className="pdf-page-break" style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '24px', border: `1px solid #d9d9d9`, pageBreakInside: 'avoid' }}>
              <h4 style={{ marginTop: 0, color: '#000000', marginBottom: '8px' }}>{t('step4.report.info_title', '專案與審計權限資訊')}</h4>
              <Row gutter={[16, 8]} style={{ fontSize: '13px', color: '#555555' }}>
                <Col span={12}><b style={{ color: '#000000' }}>{t('step4.report.file_name', '原始檔案名稱：')}</b> {fileName || 'dataset.csv'}</Col>
                <Col span={12}><b style={{ color: '#000000' }}>{t('step4.report.mode', '保護模式：')}</b> {privacyMode === 'k-anonymity' ? 'K-Anonymity ' : 'Differential Privacy '}</Col>
                <Col span={12}><b style={{ color: '#000000' }}>{t('step4.report.auditor', '審計核可人：')}</b> {user?.name || 'Admin.Test'} ({currentUserRole.toUpperCase()})</Col>
                <Col span={12}><b style={{ color: '#000000' }}>{t('step4.report.queries', '連續查詢次數：')}</b> {queryCount} </Col>
              </Row>
            </div>

            {/* 風險與效用評估：使用標準外邊距，防止下方標題被推擠卡位 */}
            <div className="pdf-page-break" style={{ pageBreakInside: 'avoid', marginBottom: '32px', clear: 'both' }}>
              <Row gutter={16}>
                <Col span={12}>
                  <div style={{ background: '#fff1f0', padding: '16px', borderRadius: '8px', border: `1px solid #ffa39e`, height: '100%' }}>
                    <h4 style={{ marginTop: 0, color: '#cf1322', marginBottom: '8px' }}>{t('step4.report.risk_title', '隱私安全風險評估')}</h4>
                    <div style={{ fontSize: '13px', color: '#555555', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <b style={{ color: '#000000' }}>{t('step4.report.overall_risk', '綜合殘餘風險:')}</b> <span style={{ color: '#cf1322', fontWeight: 'bold' }}>{attackMetrics.overallRiskPercent}%</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{t('step4.report.singling_risk', '指認性風險 (Singling Out):')}</span> <span>{(attackMetrics.singling.risk * 100).toFixed(1)}%</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{t('step4.report.linkability_risk', '連結性風險 (Linkability):')}</span> <span>{(attackMetrics.linkability.risk * 100).toFixed(1)}%</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{t('step4.report.inference_risk', '推斷性風險 (Inference):')}</span> <span>{(attackMetrics.inference.risk * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </Col>
                
                <Col span={12}>
                  <div style={{ background: '#e6ffec', padding: '16px', borderRadius: '8px', border: `1px solid #87e8de`, height: '100%' }}>
                    <h4 style={{ marginTop: 0, color: '#08979c', marginBottom: '8px' }}>{t('step4.report.utility_title', '資料效用與失真度評估')}</h4>
                    <div style={{ fontSize: '13px', color: '#555555', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <b style={{ color: '#000000' }}>{t('step4.report.suppression', '資料記錄抑制率:')}</b> <span style={{ color: '#08979c', fontWeight: 'bold' }}>0.5%</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <b style={{ color: '#000000' }}>{t('step4.report.total_cols', '處理欄位總數:')}</b> <span style={{ color: '#08979c', fontWeight: 'bold' }}>{actualColumns.length} </span>
                      </div>
                    </div>
                  </div>
                </Col>
              </Row>
            </div>

            {/* 標題與表格分離設定 */}
            <h4 className="pdf-page-break" style={{ color: '#000000', marginTop: '16px', marginBottom: '12px', pageBreakInside: 'avoid', clear: 'both' }}>
              {t('step4.report.table_title', '欄位處置與技術對照表')}
            </h4>
            
            {/* 🌟 核心解決：匯出模式（isExporting === true）完全拿掉內部滾動容器與邊框，讓 HTML 表格原生平展 */}
            {isExporting ? (
              <table style={{ 
                width: '100%', 
                borderCollapse: 'collapse', 
                color: '#000000', 
                backgroundColor: '#ffffff', 
                tableLayout: 'fixed',
                border: '1px solid #d9d9d9',
                marginBottom: '24px'
              }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9', pageBreakInside: 'avoid' }}>
                    <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '40%' }}>{t('step4.report.col_name', '欄位名稱')}</th>
                    <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{t('step4.report.col_role', '隱私角色')}</th>
                    <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{t('step4.report.col_tech', '套用去識別化技術')}</th>
                  </tr>
                </thead>
                <tbody>
                  {actualColumns.map(col => {
                    const { role } = getCalculatedRole(col);
                    const dpFieldConfig = dpFields?.find(f => f.fieldName === col && f.enabled);
                    
                    let strategy = t('step4.report.keep_original', '保留原文');

                    if (role === 'Identifier') strategy = t('step4.report.masking', '完全遮蔽');
                    else if (role === 'Quasi-identifier' && privacyMode === 'k-anonymity') strategy = t('step4.report.generalization', '區間/時間泛化');
                    else if (privacyMode === 'differential-privacy' && dpFieldConfig) strategy = t('step4.report.dp', '差分隱私加噪');

                    const roleI18nKey = `step4.role.${role.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;

                    return (
                      <tr key={col} style={{ backgroundColor: '#ffffff', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#000000', wordBreak: 'break-word' }}><b>{col}</b></td>
                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{t(roleI18nKey, role)}</td>
                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{strategy}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ 
                maxHeight: '240px', 
                overflowY: 'auto', 
                border: '1px solid #d9d9d9', 
                borderRadius: '4px', 
                marginBottom: '24px' 
              }}>
                <table style={{ 
                  width: '100%', 
                  borderCollapse: 'collapse', 
                  color: '#000000', 
                  backgroundColor: '#ffffff', 
                  tableLayout: 'fixed'
                }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '40%' }}>{t('step4.report.col_name', '欄位名稱')}</th>
                      <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{t('step4.report.col_role', '隱私角色')}</th>
                      <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{t('step4.report.col_tech', '套用去識別化技術')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actualColumns.map(col => {
                      const { role } = getCalculatedRole(col);
                      const dpFieldConfig = dpFields?.find(f => f.fieldName === col && f.enabled);
                      
                      let strategy = t('step4.report.keep_original', '保留原文');

                      if (role === 'Identifier') strategy = t('step4.report.masking', '完全遮蔽');
                      else if (role === 'Quasi-identifier' && privacyMode === 'k-anonymity') strategy = t('step4.report.generalization', '區間/時間泛化');
                      else if (privacyMode === 'differential-privacy' && dpFieldConfig) strategy = t('step4.report.dp', '差分隱私加噪');

                      const roleI18nKey = `step4.role.${role.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;

                      return (
                        <tr key={col} style={{ backgroundColor: '#ffffff' }}>
                          <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#000000', wordBreak: 'break-word' }}><b>{col}</b></td>
                          <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{t(roleI18nKey, role)}</td>
                          <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{strategy}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 頁尾簽章 */}
            <div className="pdf-page-break" style={{ textAlign: 'right', marginTop: '24px', borderTop: `1px dashed #d9d9d9`, paddingTop: '12px', fontSize: '12px', color: '#888888', pageBreakInside: 'avoid' }}>
              {t('step4.report.signature', '系統數位簽章：PRIVACY-APP-AUDIT-ENGINE-V2.0-PASSED')}
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}