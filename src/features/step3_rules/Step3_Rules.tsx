import { Result, Button, App, Alert } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import { useTranslation } from 'react-i18next';
import KAnonymityRules from './KAnonymityRules';
import DifferentialPrivacyRules from './DifferentialPrivacyRules';

export default function Step3_Rules() {
  const privacyMode = usePrivacyStore((state) => state.privacyMode);
  const prevStep = usePrivacyStore((state) => state.prevStep);
  const isStepValid = usePrivacyStore((state) => state.isStepValid); // 🌟 取得驗證狀態
  const stepErrorMessage = usePrivacyStore((state) => state.stepErrorMessage); // 🌟 取得錯誤訊息

  const { t } = useTranslation(); 
  
  const { message } = App.useApp();

  const handleExportJSON = () => {
    const state = usePrivacyStore.getState();

    const finalPayload = {
      version: new Date().toISOString(),
      dataset: state.fileName || "unknown_dataset",
      privacy_mode: state.privacyMode,
      preprocessing_rules: Object.keys(state.preprocessingRules).length > 0 ? state.preprocessingRules : undefined,
      
      privacy_targets: {
        k_anonymity: state.privacyMode === 'k-anonymity' ? {
          enabled: true,
          k: state.kValue,
          l: state.lValue,
          t: state.tValue,
          suppression_method: state.suppressionMethod,
          suppression_limit_percent: state.maxSuppression,
          limit_exceeded_action: state.limitExceededAction
        } : { enabled: false },
        
        differential_privacy: state.privacyMode === 'differential-privacy' ? {
          enabled: true,
          global_target_delta: state.targetDelta,
          simulate_query_count: state.queryCount,
          budget_limit: state.budgetLimitEpsilon,
          out_of_bounds_strategy: state.outOfBoundsStrategy || 'clip'
        } : { enabled: false }
      },

      differential_privacy_rules: state.privacyMode === 'differential-privacy'
        ? state.dpFields.filter(f => f.enabled)
        : undefined
    };

    try {
      const jsonStr = JSON.stringify(finalPayload, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `final_privacy_config_${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      message.success(t('step3.msg_export_success', 'Successfully exported privacy configuration (JSON)!'));
    } catch (error) {
      console.error("Export error:", error);
      message.error(t('step3.msg_export_failed', 'Export failed, please try again.'));
    }
  };

  if (!privacyMode) {
    return (
      <div style={{ padding: '40px' }}>
        <Result
          status="warning"
          title={t('step3.no_mode_title', 'Privacy Mode Not Set')}
          subTitle={t('step3.no_mode_subtitle', 'Please go back to the previous step and select a privacy mode.')}
          extra={<Button type="primary" onClick={prevStep}>{t('step3.btn_go_back', 'Go Back')}</Button>}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <Button 
          type="primary" 
          icon={<DownloadOutlined />} 
          onClick={handleExportJSON} 
          style={{ background: '#4F46E5', borderColor: '#4F46E5' }}
        >
          {t('step3.btn_export_json', 'Export Final Config (JSON)')}
        </Button>
      </div>

      {/* 🌟 錯誤提示橫幅，當參數不合規時顯示 */}
      {!isStepValid && stepErrorMessage && (
        <Alert 
          message={t('step3.validation_failed', '參數設定不符合規範')} 
          description={stepErrorMessage} 
          type="error" 
          showIcon 
          style={{ borderRadius: '8px' }}
        />
      )}

      {privacyMode === 'k-anonymity' ? <KAnonymityRules /> : <DifferentialPrivacyRules />}
    </div>
  );
}