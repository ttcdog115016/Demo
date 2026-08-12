import { useNavigate } from 'react-router-dom';
import { Steps, Button, Card, Layout, theme, App as AntdApp } from 'antd';
import { useTranslation } from 'react-i18next';

// 🌟 1. 改為引入拆分後的 Workspace Store
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

import Step1_Upload from '../step1_upload/Step1_Upload';
import Step2_Mapping from '../step2_mapping/Step2_Mapping';
import Step3_Rules from '../step3_rules/Step3_Rules';
import Step4_Result from '../step4_result/Step4_Result';
import { validateProgression } from './validateProgression'; 

export default function MainLayout() {
  const { t } = useTranslation(); 
  const navigate = useNavigate(); 
  
  // 🌟 2. 從 WorkspaceStore 取得狀態與行為
  const currentStep = useWorkspaceStore((state) => state.currentStep);
  const nextStep = useWorkspaceStore((state) => state.nextStep);
  const prevStep = useWorkspaceStore((state) => state.prevStep);
  
  const { message: appMessage } = AntdApp.useApp(); 
  const isDarkMode = theme.useToken().token.colorBgContainer !== '#ffffff';

  const handleStepClick = (targetStep: number) => {
    if (targetStep === currentStep) return;

    // 🌟 3. 取得當前 WorkspaceStore 的快照進行驗證
    const storeState = useWorkspaceStore.getState();
    if (targetStep > currentStep) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errorMsg = validateProgression(targetStep, currentStep, storeState as any, t);
      if (errorMsg) {
        appMessage.warning(errorMsg);
        navigate(`/workspace?step=${currentStep + 1}`, { replace: true });
        return;
      }
    }

    useWorkspaceStore.setState({ currentStep: targetStep });
    navigate(`/workspace?step=${targetStep + 1}`);
  };

  const handleNext = () => {
    const storeState = useWorkspaceStore.getState();
    const targetStep = currentStep + 1;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorMsg = validateProgression(targetStep, currentStep, storeState as any, t);
    if (errorMsg) {
      appMessage.error(errorMsg);
      return; 
    }
    
    nextStep();
    navigate(`/workspace?step=${targetStep + 1}`); 
  };

  const handlePrev = () => {
    prevStep();
    const newStep = useWorkspaceStore.getState().currentStep;
    navigate(`/workspace?step=${newStep + 1}`); 
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: return <Step1_Upload />;
      case 1: return <Step2_Mapping />;
      case 2: return <Step3_Rules />;
      case 3: return <Step4_Result />;
      default: return null;
    }
  };

  return (
    <Layout style={{ background: 'transparent' }}>
      <Card className="v-card-style" style={{ marginBottom: '24px', borderRadius: '12px' }}>
        <Steps 
          current={currentStep} 
          onChange={handleStepClick} 
          items={[
            { title: t('menu.data_import', '資料匯入') },
            { title: t('menu.attribute_mapping', '屬性分類') },
            { title: t('menu.privacy_settings', '隱私設定') },
            { title: t('menu.preview_export', '預覽匯出') }
          ]} 
        />
      </Card>

      <div key={currentStep} className="step-content-animator" style={{ minHeight: '400px' }}>
        {renderStepContent()}
      </div>

      <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
        {currentStep > 0 && (
          <Button size="large" onClick={handlePrev} style={{ borderRadius: 8 }}>
            {t('button.prev', '上一步')}
          </Button>
        )}
        {currentStep > 0 && currentStep < 3 && (
          <Button type="primary" size="large" onClick={handleNext} style={{ borderRadius: 8, boxShadow: isDarkMode ? '0 4px 14px 0 rgba(63, 81, 181, 0.4)' : 'none' }}>
            {t('button.next', '下一步')} ➔
          </Button>
        )}
      </div>
    </Layout>
  );
}