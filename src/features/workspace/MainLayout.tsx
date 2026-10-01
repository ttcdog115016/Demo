/**
 * ============================================================================
 * 檔案名稱 (File): MainLayout.tsx
 * 模組功能 (Description): 去識別化精靈工作區主版面配置組件 (提供 Steps 導航步驟條、前進/後退步驟驗證門閥控管與動態分頁元件切換)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Steps, Button, Card, Layout, theme, App as AntdApp, Popconfirm, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore } from '../../store/useWorkspaceStore';

import Step1_Upload from '../step1_upload/Step1_Upload';
import Step2_Mapping from '../step2_mapping/Step2_Mapping';
import Step3_Rules from '../step3_rules/Step3_Rules';
import Step4_Result from '../step4_result/Step4_Result';
import { validateProgression } from './validateProgression'; 
import { listDpFieldsWithBoundsFinerThanNoiseUnit, applyDpDatetimeNoiseUnit } from '../../utils/dpFieldHelpers';

/**
 * ============================================================================
 * 預設步驟索引常數宣告 (Magic Numbers Constants)
 * ============================================================================
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 * * 詳細說明:
 * 定義精靈 (Wizard) 各個步驟對應之索引值，避免在程式邏輯中寫死 0, 1, 2, 3，提升可讀性與擴充性。
 */
const STEP_INDEX_UPLOAD = 0;
const STEP_INDEX_MAPPING = 1;
const STEP_INDEX_RULES = 2;
const STEP_INDEX_RESULT = 3;

// ★ QA 回饋：跨步驟驗證失敗的提示訊息 (notification) 顯示秒數，取代 message 預設的 3 秒過短問題
const STEP_VALIDATION_NOTIFICATION_AUTO_CLOSE_SECONDS = 8;

/**
 * 函數名稱: MainLayout
 * 函數功能: 渲染步驟導航精靈主版面，包含 Steps 標題進度條、內部對應分頁組件渲染，以及下一步/上一步按鈕之狀態驗證與門閥控管。
 * * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 * - React.ReactElement: 主精靈版面配置 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 * - 被 AppRouter 主路由載入渲染 (路徑: /workspace)
 * - 訂閱與更新 useWorkspaceStore 中的 currentStep, nextStep, prevStep 全域狀態
 * * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function MainLayout(): React.ReactElement 
{
    const { t: translate } = useTranslation(); 

    // 取得 React Router 之 navigate 函式以操控網址列 (符合規範 g)
    const executeNavigationAction = useNavigate(); 
    
    // ============================================================================
    // 全域狀態訂閱區塊 (來自 useWorkspaceStore)
    // ============================================================================
    const currentStepIndexValue = useWorkspaceStore(
        (state) => state.currentStep
    ); // 當前步驟索引 (0 ~ 3)

    const executeNextStepAction = useWorkspaceStore(
        (state) => state.nextStep
    );       // 前進下一步驟 Action

    const executePrevStepAction = useWorkspaceStore(
        (state) => state.prevStep
    );       // 後退上一步驟 Action
    
    // ★新增：取得重置工作區 Action
    const resetWorkspaceAction = useWorkspaceStore(
        (state) => state.resetWorkspace
    );

    // ★ QA 回饋：跨步驟驗證失敗的提示訊息內容較長（例如敏感欄位數量、自訂區間設定等說明），
    //   若使用 message（頂部小提示條）預設僅顯示 3 秒且無法手動關閉，使用者常常來不及看完
    //   就自動消失。改用 notification（右下角通知卡片）：本身內建可手動關閉的 X 按鈕，
    //   並將顯示時間拉長，兩者一併解決「顯示時間太短」與「無法手動關閉」兩項回饋。
    const { notification: globalNotificationApi, modal: globalModalApi } = AntdApp.useApp();

    /**
     * 函數名稱: confirmDpNoiseUnitBeforeLeavingRules
     * 函數功能: DP 模式由 Step3 前往 Step4 時，若有日期欄位的上下限比雜訊單位細（例如邊界到秒、雜訊單位為天），
     *           跳出小視窗提醒；使用者可改為建議單位後繼續、維持目前設定繼續，或返回修改。沒有這種欄位時直接繼續。
     * ★ 2026-10-01：先前只在 Step3 欄位下方顯示黃色提示，使用者反映不夠明顯。
     */
    const confirmDpNoiseUnitBeforeLeavingRules = (proceedAction: () => void): void =>
    {
        const workspaceStateSnapshot = useWorkspaceStore.getState();
        const mismatchedFieldsList = workspaceStateSnapshot.privacyMode === 'differential-privacy'
            ? listDpFieldsWithBoundsFinerThanNoiseUnit(workspaceStateSnapshot.dpFields)
            : [];
        if (mismatchedFieldsList.length === 0)
        {
            proceedAction();
            return;
        }

        const unitLabelMap: Record<string, string> = {
            day: translate('step3_dp.noise_unit_day', '天'), hour: translate('step3_dp.noise_unit_hour', '時'),
            minute: translate('step3_dp.noise_unit_minute', '分'), second: translate('step3_dp.noise_unit_second', '秒')
        };
        const applySuggestedUnitsAndProceed = (): void =>
        {
            useWorkspaceStore.setState((currentStoreState) => ({
                dpFields: currentStoreState.dpFields.map((fieldItemRecord) => {
                    const mismatchedItem = mismatchedFieldsList.find((item) => item.fieldId === fieldItemRecord.id);
                    return mismatchedItem ? applyDpDatetimeNoiseUnit(fieldItemRecord, mismatchedItem.boundsUnit) : fieldItemRecord;
                })
            }));
            proceedAction();
        };

        const noiseUnitConfirmDialog = globalModalApi.confirm({
            title: translate('workspace.dp_noise_unit_confirm_title', '日期欄位的雜訊單位比上下限粗'),
            width: 520,
            closable: true,
            content: (
                <div data-testid="dp-noise-unit-confirm">
                    <p style={{ marginBottom: 8 }}>
                        {translate('workspace.dp_noise_unit_confirm_desc', '下列欄位在 Step2 設定的上下限比 Step3 選的雜訊單位細，敏感度與加噪會以雜訊單位計，邊界的時間部分會被四捨五入：')}
                    </p>
                    <ul style={{ paddingLeft: 20, margin: 0 }}>
                        {mismatchedFieldsList.map((item) => (
                            <li key={item.fieldId ?? item.fieldName}>
                                {translate('workspace.dp_noise_unit_confirm_item', '「{{field}}」：上下限細到「{{boundsUnit}}」，雜訊單位為「{{noiseUnit}}」', {
                                    field: item.fieldName, boundsUnit: unitLabelMap[item.boundsUnit], noiseUnit: unitLabelMap[item.noiseUnit]
                                })}
                            </li>
                        ))}
                    </ul>
                </div>
            ),
            footer: (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                    <Button onClick={() => noiseUnitConfirmDialog.destroy()}>
                        {translate('workspace.dp_noise_unit_confirm_back', '返回修改')}
                    </Button>
                    <Button onClick={() => { noiseUnitConfirmDialog.destroy(); proceedAction(); }}>
                        {translate('workspace.dp_noise_unit_confirm_keep', '維持目前設定繼續')}
                    </Button>
                    <Button type="primary" onClick={() => { noiseUnitConfirmDialog.destroy(); applySuggestedUnitsAndProceed(); }}>
                        {translate('workspace.dp_noise_unit_confirm_apply', '改為與上下限相同的單位並繼續')}
                    </Button>
                </div>
            )
        });
    };

    // 取得當前主題之 Token，並判定是否處於深色模式 (符合規範 g)
    const isDarkModeActiveStatus = theme.useToken().token.colorBgContainer !== '#ffffff';

    /**
     * 函數名稱: handleStepClick
     * 函數功能: 點擊 Steps 步驟條目標節點時之跳轉邏輯。若向後跨步，自動觸發 validateProgression 驗證前置條件。
     */
    const handleStepClick = (targetStepIndexValue: number): void => 
    {
        // 若點擊目標為當前步驟，則提早返回不作處理
        if (targetStepIndexValue === currentStepIndexValue) 
        {
            return;
        }

        // 取得當前 WorkspaceStore 之快照進行強型別驗證 (符合規範 g)
        const currentWorkspaceStoreStateSnapshot = useWorkspaceStore.getState();

        // 防呆機制：若使用者欲「向前跨步」，必須檢查是否滿足過渡門檻
        if (targetStepIndexValue > currentStepIndexValue) 
        {
            const progressionValidationErrorMessageString = validateProgression(targetStepIndexValue, currentStepIndexValue, currentWorkspaceStoreStateSnapshot, translate);

            // 若驗證不通過，彈出警告並重導向回合法之最高步驟
            if (progressionValidationErrorMessageString)
            {
                globalNotificationApi.warning({
                    message: translate('workspace.step_jump_blocked_title', '無法跳至該步驟'),
                    description: progressionValidationErrorMessageString,
                    duration: STEP_VALIDATION_NOTIFICATION_AUTO_CLOSE_SECONDS,
                    placement: 'bottomRight',
                });

                // 強制覆寫網址列之 query parameter 以對齊真實狀態
                executeNavigationAction(`/workspace?step=${currentStepIndexValue + 1}`, { replace: true });

                return;
            }
        }

        // 若驗證通過或為「向後回退」，直接更新 Store 狀態並跳轉
        const jumpToTargetStep = (): void =>
        {
            useWorkspaceStore.setState({ currentStep: targetStepIndexValue });
            executeNavigationAction(`/workspace?step=${targetStepIndexValue + 1}`);
        };

        // DP：由 Step3 往後時檢查日期欄位雜訊單位（見 confirmDpNoiseUnitBeforeLeavingRules）
        if (currentStepIndexValue === STEP_INDEX_RULES && targetStepIndexValue > currentStepIndexValue)
        {
            confirmDpNoiseUnitBeforeLeavingRules(jumpToTargetStep);
            return;
        }

        jumpToTargetStep();
    };

    /**
     * 函數名稱: handleNextStep
     * 函數功能: 點擊「下一步」按鈕時之驗證與前進處理，校驗當前步驟條件，通過後推進至下一步。
     */
    const handleNextStep = (): void => 
    {
        const currentWorkspaceStoreStateSnapshot = useWorkspaceStore.getState();

        const expectedNextTargetStepIndexValue = currentStepIndexValue + 1;
        
        // 校驗是否允許進入目標步驟 (符合規範 g)
        const progressionValidationErrorMessageString = validateProgression(expectedNextTargetStepIndexValue, currentStepIndexValue, currentWorkspaceStoreStateSnapshot, translate);

        // 遇到阻擋條件時彈出錯誤，中斷前進流程
        if (progressionValidationErrorMessageString)
        {
            globalNotificationApi.error({
                message: translate('workspace.step_next_blocked_title', '無法前往下一步'),
                description: progressionValidationErrorMessageString,
                duration: STEP_VALIDATION_NOTIFICATION_AUTO_CLOSE_SECONDS,
                placement: 'bottomRight',
            });

            return;
        }
        
        const goToNextStep = (): void =>
        {
            // 呼叫全域 Store 之內建 Action 更新 currentStep
            executeNextStepAction();

            // 同步更新網址列
            executeNavigationAction(`/workspace?step=${expectedNextTargetStepIndexValue + 1}`);
        };

        // DP：由 Step3 前往 Step4 時檢查日期欄位雜訊單位（見 confirmDpNoiseUnitBeforeLeavingRules）
        if (currentStepIndexValue === STEP_INDEX_RULES)
        {
            confirmDpNoiseUnitBeforeLeavingRules(goToNextStep);
            return;
        }

        goToNextStep(); 
    };

    /**
     * 函數名稱: handlePreviousStep
     * 函數功能: 點擊「上一步」按鈕時之導向處理，回退步驟狀態並更新 URL 參數。
     */
    const handlePreviousStep = (): void => 
    {
        // 呼叫全域 Store 之內建 Action 回退 currentStep
        executePrevStepAction();

        const updatedCurrentStepIndexValue = useWorkspaceStore.getState().currentStep;

        // 同步更新網址列
        executeNavigationAction(`/workspace?step=${updatedCurrentStepIndexValue + 1}`); 
    };

    /**
     * 函數名稱: handleResetWorkspace
     * 函數功能: 觸發全域 Store 重置，並導向回第一步 (資料尚未上傳之初始狀態)。
     */
    const handleResetWorkspace = (): void => 
    {
        resetWorkspaceAction();
        executeNavigationAction(`/workspace?step=1`, { replace: true });
    };

    /**
     * 函數名稱: renderCurrentStepContent
     * 函數功能: 依據當前 currentStep 索引，動態切換渲染對應之步驟頁面組件 (Switch Case Routing)。
     */
    const renderCurrentStepContent = (): React.ReactElement | null => 
    {
        switch (currentStepIndexValue) 
        {
            case STEP_INDEX_UPLOAD: 
                return <Step1_Upload />;

            case STEP_INDEX_MAPPING: 
                return <Step2_Mapping />;

            case STEP_INDEX_RULES: 
                return <Step3_Rules />;

            case STEP_INDEX_RESULT: 
                return <Step4_Result />;

            default: 
                // 防呆：若遇到預期外索引，回傳 null 以防崩潰
                return null;
        }
    };

    return (
        <Layout style={{ background: 'transparent' }}>
            
            {/* ============================================================================ */}
            {/* 頂部 Steps 步驟導航條卡片 */}
            {/* ============================================================================ */}
            <Card className="v-card-style" style={{ marginBottom: '24px', borderRadius: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    
                    {/* 左側：精靈進度條 */}
                    <div style={{ flex: 1, paddingRight: '24px' }}>
                        <Steps 
                            current={currentStepIndexValue} 
                            onChange={handleStepClick} 
                            items={
                                [
                                    { title: translate('menu.data_import', '資料匯入') },
                                    { title: translate('menu.attribute_mapping', '屬性分類') },
                                    { title: translate('menu.privacy_settings', '隱私設定') },
                                    { title: translate('menu.preview_export', '預覽匯出') }
                                ]
                            } 
                        />
                    </div>
                    
                    {/* 右側：一鍵重新開始按鈕 (只要不在第一步就顯示) */}
                    {currentStepIndexValue > STEP_INDEX_UPLOAD && (
                        <Popconfirm 
                            title={translate('layout.confirm_reset', '確定要放棄當前進度並重新開始嗎？')} 
                            onConfirm={handleResetWorkspace}
                            okText={translate('button.confirm', '確定')}
                            cancelText={translate('button.cancel', '取消')}
                        >
                            <Tooltip title={translate('layout.reset_workspace', '清空所有資料與設定，回到初始狀態')}>
                                <Button danger type="dashed" icon={<ReloadOutlined />}>
                                    {translate('button.restart', '重新開始')}
                                </Button>
                            </Tooltip>
                        </Popconfirm>
                    )}

                </div>
            </Card>

            {/* ============================================================================ */}
            {/* 中央動態分頁內容掛載區塊 */}
            {/* ============================================================================ */}
            {/* 使用 currentStepIndexValue 作為 key，促使 React 觸發重新掛載並套用 CSS 動畫 */}
            <div key={currentStepIndexValue} className="step-content-animator" style={{ minHeight: '400px' }}>
                {renderCurrentStepContent()}
            </div>

            {/* ============================================================================ */}
            {/* 底部流程控制導航按鈕區塊 (Next / Prev) */}
            {/* ============================================================================ */}
            <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
                
                {/* 只要不在第一步，就渲染「上一步」按鈕 */}
                {currentStepIndexValue > STEP_INDEX_UPLOAD && (
                    <Button size="large" onClick={handlePreviousStep} style={{ borderRadius: 8 }}>
                        {translate('button.prev', '上一步')}
                    </Button>
                )}

                {/* 只要不在第一步 (因 Step 1 已有自帶的觸發進入機制) 且未到最後一步，就渲染「下一步」按鈕 */}
                {currentStepIndexValue > STEP_INDEX_UPLOAD && currentStepIndexValue < STEP_INDEX_RESULT && (
                    <Button 
                        type="primary" 
                        size="large" 
                        onClick={handleNextStep} 
                        style={
                            { 
                                borderRadius: 8, 
                                boxShadow: isDarkModeActiveStatus ? '0 4px 14px 0 rgba(63, 81, 181, 0.4)' : 'none' 
                            }
                        }
                    >
                        {translate('button.next', '下一步')} ➔
                    </Button>
                )}
                
            </div>
        </Layout>
    );
}