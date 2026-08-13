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
import { Steps, Button, Card, Layout, theme, App as AntdApp } from 'antd';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore } from '../../store/useWorkspaceStore';

import Step1_Upload from '../step1_upload/Step1_Upload';
import Step2_Mapping from '../step2_mapping/Step2_Mapping';
import Step3_Rules from '../step3_rules/Step3_Rules';
import Step4_Result from '../step4_result/Step4_Result';
import { validateProgression } from './validateProgression'; 

/**
 * ============================================================================
 * 預設步驟索引常數宣告 (Magic Numbers Constants)
 * ============================================================================
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 * 
 * 詳細說明:
 * 定義精靈 (Wizard) 各個步驟對應之索引值，避免在程式邏輯中寫死 0, 1, 2, 3，提升可讀性與擴充性。
 */
const STEP_INDEX_UPLOAD = 0;
const STEP_INDEX_MAPPING = 1;
const STEP_INDEX_RULES = 2;
const STEP_INDEX_RESULT = 3;

/**
 * 函數名稱: MainLayout
 * 函數功能: 渲染步驟導航精靈主版面，包含 Steps 標題進度條、內部對應分頁組件渲染，以及下一步/上一步按鈕之狀態驗證與門閥控管。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 主精靈版面配置 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被 AppRouter 主路由載入渲染 (路徑: /workspace)
 *   - 訂閱與更新 useWorkspaceStore 中的 currentStep, nextStep, prevStep 全域狀態
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
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
	
	const { message: globalMessageApi } = AntdApp.useApp(); 
	
	// 取得當前主題之 Token，並判定是否處於深色模式 (符合規範 g)
	const isDarkModeActiveStatus = theme.useToken().token.colorBgContainer !== '#ffffff';

	/**
	 * 函數名稱: handleStepClick
	 * 函數功能: 點擊 Steps 步驟條目標節點時之跳轉邏輯。若向後跨步，自動觸發 validateProgression 驗證前置條件。
	 * 
	 * 輸入參數 (Input):
	 *   - targetStepIndexValue (number): 使用者欲跳轉之目標步驟索引
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於 Steps 元件之 onChange 事件
	 * 
	 * 規範對照: 符合規範 d) 確保跳轉參數經過嚴格驗證才執行
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
				globalMessageApi.warning(progressionValidationErrorMessageString);

				// 強制覆寫網址列之 query parameter 以對齊真實狀態
				executeNavigationAction(`/workspace?step=${currentStepIndexValue + 1}`, { replace: true });

				return;
			}
		}

		// 若驗證通過或為「向後回退」，直接更新 Store 狀態並跳轉
		useWorkspaceStore.setState({ currentStep: targetStepIndexValue });

		executeNavigationAction(`/workspace?step=${targetStepIndexValue + 1}`);
	};

	/**
	 * 函數名稱: handleNextStep
	 * 函數功能: 點擊「下一步」按鈕時之驗證與前進處理，校驗當前步驟條件，通過後推進至下一步。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於「下一步」Button 之 onClick 事件
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
			globalMessageApi.error(progressionValidationErrorMessageString);

			return; 
		}
		
		// 呼叫全域 Store 之內建 Action 更新 currentStep
		executeNextStepAction();

		// 同步更新網址列
		executeNavigationAction(`/workspace?step=${expectedNextTargetStepIndexValue + 1}`); 
	};

	/**
	 * 函數名稱: handlePreviousStep
	 * 函數功能: 點擊「上一步」按鈕時之導向處理，回退步驟狀態並更新 URL 參數。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於「上一步」Button 之 onClick 事件
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
	 * 函數名稱: renderCurrentStepContent
	 * 函數功能: 依據當前 currentStep 索引，動態切換渲染對應之步驟頁面組件 (Switch Case Routing)。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): 
	 *   - React.ReactElement | null: 對應步驟之頁面 JSX 結構
	 * 呼叫關係 (Call Relations): 於 MainLayout 視圖中央被調用渲染
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