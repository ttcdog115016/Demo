import { Result, Button, App, Alert } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

// 🌟 1. 替換為重構後的新 Store 與明確型別匯入
import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';

import KAnonymityRules from './KAnonymityRules';
import DifferentialPrivacyRules from './DifferentialPrivacyRules';

export default function Step3_Rules() {
  // 🌟 2. 改從 WorkspaceStore 取出狀態
  const privacyMode = useWorkspaceStore((state) => state.privacyMode);
  const prevStep = useWorkspaceStore((state) => state.prevStep);
  const isStepValid = useWorkspaceStore((state) => state.isStepValid); 
  const stepErrorMessage = useWorkspaceStore((state) => state.stepErrorMessage); 

  const { t } = useTranslation(); 
  
  const { message } = App.useApp();

  const handleExportJSON = () => {
    // 🌟 3. 改從 WorkspaceStore 取得快照
    const state = useWorkspaceStore.getState();

    // 🌟 修復核心：匯出「所有欄位」的 DP 設定（包含 enabled 為 true 與 false），
    // 並使用型別交叉 (Intersection Types) 安全地讀取可能的擴充屬性，徹底消滅 any！
    const formattedDpRules = state.privacyMode === 'differential-privacy'
      ? (state.dpFields || []).map((f: DPField) => ({
          id: f.id,
          fieldName: f.fieldName,
          fieldType: f.fieldType || 'Categorical',
          enabled: Boolean(f.enabled), 
          epsilon: f.epsilon,
          delta: f.delta,
          mode: f.mode,
          equivalentEpsilon: (f as DPField & { equivalentEpsilon?: number }).equivalentEpsilon ?? f.epsilon,
          sensitivity: (f as DPField & { sensitivity?: number }).sensitivity ?? 1.0,
          lowerBound: f.lowerBound,
          upperBound: f.upperBound,
          allowedCategories: f.allowedCategories,
          maxLength: f.maxLength
        }))
      : undefined;

    const finalPayload = {
      version: new Date().toISOString(),
      dataset: state.fileName || "unknown_dataset",
      privacy_mode: state.privacyMode,
      
      // 寫入 Step 1 & Step 2 的欄位基底結構
      columns: state.columns,
      column_roles: state.columnRoles,
      column_types: state.columnTypes,
      preprocessing_rules: state.preprocessingRules && Object.keys(state.preprocessingRules).length > 0 ? state.preprocessingRules : undefined,
      
      // Step 2 K-Anonymity 規則結構
      field_attributes: state.fieldAttributes,
      masking_rules: state.maskingRules,
      generalization_rules: state.generalizationRules,
      categorical_hierarchies: state.categoricalHierarchies,
      numeric_bins: state.numericBins,
      temporal_hierarchies: state.temporalHierarchies,
      
      // Step 3 隱私目標
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

      // 輸出完整的差分隱私規則清單
      differential_privacy_rules: formattedDpRules
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

      {/* 錯誤提示橫幅，當參數不合規時顯示 */}
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