/**
 * ============================================================================
 * 檔案名稱 (File): Step3_Rules.tsx
 * 模組功能 (Description): 去識別化工作流第三步：隱私參數與驗證規則設定組件 (依據選定模式載入 K-Anonymity 或 DP 規則組件，並提供導出完整 JSON 隱私配置檔功能)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅單字元變數 f, t, e, state)
 * ============================================================================
 */

import React from 'react';
import { Result, Button, App as AntdApp, Alert } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';

import KAnonymityRules from './KAnonymityRules';
import DifferentialPrivacyRules from './DifferentialPrivacyRules';
import RiskSubgroupFilterPanel from './RiskSubgroupFilterPanel';

/**
 * 函數名稱: Step3_Rules
 * 函數功能: 渲染步驟三頁面，依據全域隱私模式載入對應之 KAnonymityRules 或 DifferentialPrivacyRules 子組件，並提供導出全專案 JSON 隱私設定檔之按鈕與參數不合規警告 Banner。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 步驟三 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被主流程 Step 精靈組件載入渲染
 *   - 訂閱與讀取 useWorkspaceStore 中的 privacyMode, isStepValid, stepErrorMessage 等全域狀態
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function Step3_Rules(): React.ReactElement 
{
	// 從 WorkspaceStore 讀取全域狀態與 Action (符合規範 g, i)
	const currentPrivacyModeStatus = useWorkspaceStore(
		(state) => state.privacyMode
	);                                         // 當前工作區保護模式

	const executePreviousStepAction = useWorkspaceStore(
		(state) => state.prevStep
	);                                           // 返回上一步驟 Action

	const isCurrentStepValidStatus = useWorkspaceStore(
		(state) => state.isStepValid
	);                                         // 步驟三參數驗證結果標記 (true/false)

	const currentStepErrorMessageText = useWorkspaceStore(
		(state) => state.stepErrorMessage
	);                             // 參數不合規警告訊息

	const { t: translate } = useTranslation(); 
	
	const { message: messageApi } = AntdApp.useApp();

	/**
	 * 函數名稱: handleExportJSON
	 * 函數功能: 彙整工作區 Steps 1 ~ 3 之完整參數（包含欄位角色、預處理清洗規則、K/L/T 參數與 DP 欄位設定），組裝為最終合規隱私 JSON 檔案並觸發下載。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於「Export Final Config (JSON)」按鈕之 onClick 事件
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
	const handleExportJSON = (): void => 
	{
		// 取得 WorkspaceStore 當前狀態快照 (符合規範 g)
		const currentWorkspaceStoreState = useWorkspaceStore.getState();

		// 格式化差分隱私欄位清單 (包含啟用與停用項目，防範型別轉型丟失) (符合規範 g)
		const formattedDpRulesArray = currentWorkspaceStoreState.privacyMode === 'differential-privacy'
			? (currentWorkspaceStoreState.dpFields || []).map(
				(dpFieldItemRecord: DPField) => 
				(
					{
						id: dpFieldItemRecord.id,
						fieldName: dpFieldItemRecord.fieldName,
						fieldType: dpFieldItemRecord.fieldType || 'Categorical',
						enabled: Boolean(dpFieldItemRecord.enabled), 
						epsilon: dpFieldItemRecord.epsilon,
						delta: dpFieldItemRecord.delta,
						mode: dpFieldItemRecord.mode,
						equivalentEpsilon: (dpFieldItemRecord as DPField & { equivalentEpsilon?: number }).equivalentEpsilon ?? dpFieldItemRecord.epsilon,
						sensitivity: (dpFieldItemRecord as DPField & { sensitivity?: number }).sensitivity ?? 1.0,
						lowerBound: dpFieldItemRecord.lowerBound,
						upperBound: dpFieldItemRecord.upperBound,
						allowedCategories: dpFieldItemRecord.allowedCategories,
						maxLength: dpFieldItemRecord.maxLength
					}
				)
			)
			: undefined;

		// 彙整 Steps 1 ~ 3 全載荷 payload 物件 (符合規範 g)
		const finalExportPayloadObject = {
			version: new Date().toISOString(),
			dataset: currentWorkspaceStoreState.fileName || "unknown_dataset",
			privacy_mode: currentWorkspaceStoreState.privacyMode,
			
			// Step 1 & Step 2 的欄位基底結構
			columns: currentWorkspaceStoreState.columns,
			column_roles: currentWorkspaceStoreState.columnRoles,
			column_types: currentWorkspaceStoreState.columnTypes,
			preprocessing_rules: currentWorkspaceStoreState.preprocessingRules && Object.keys(currentWorkspaceStoreState.preprocessingRules).length > 0 ? currentWorkspaceStoreState.preprocessingRules : undefined,
			
			// Step 2 K-Anonymity 規則結構
			field_attributes: currentWorkspaceStoreState.fieldAttributes,
			masking_rules: currentWorkspaceStoreState.maskingRules,
			generalization_rules: currentWorkspaceStoreState.generalizationRules,
			generalization_hierarchies: currentWorkspaceStoreState.generalizationHierarchies,
			categorical_hierarchies: currentWorkspaceStoreState.categoricalHierarchies,
			numeric_bins: currentWorkspaceStoreState.numericBins,
			temporal_hierarchies: currentWorkspaceStoreState.temporalHierarchies,
			
			// Step 3 隱私目標與參數
			privacy_targets: {
				k_anonymity: currentWorkspaceStoreState.privacyMode === 'k-anonymity' ? {
					enabled: true,
					k_anonymity_value: currentWorkspaceStoreState.kValue,           // 修正: 明確標示為 K-匿名群組大小數值
					l_diversity_value: currentWorkspaceStoreState.lValue,           // 修正: 明確標示為 L-多樣性種類數值
					t_closeness_threshold: currentWorkspaceStoreState.tValue,       // 修正: 明確標示為 T-趨近性機率門檻
					suppression_method: currentWorkspaceStoreState.suppressionMethod,
					cell_fill: currentWorkspaceStoreState.cellFillMethod,
					suppression_limit_percent: currentWorkspaceStoreState.maxSuppression,
					limit_exceeded_action: currentWorkspaceStoreState.limitExceededAction
				} : { enabled: false },
				
				differential_privacy: currentWorkspaceStoreState.privacyMode === 'differential-privacy' ? {
					enabled: true,
					global_target_delta: currentWorkspaceStoreState.targetDelta,
					simulate_query_count: currentWorkspaceStoreState.queryCount,
					budget_limit: currentWorkspaceStoreState.budgetLimitEpsilon,
					out_of_bounds_strategy: currentWorkspaceStoreState.outOfBoundsStrategy || 'clip'
				} : { enabled: false }
			},

			// 輸出完整的差分隱私規則清單
			differential_privacy_rules: formattedDpRulesArray
		};

		try 
		{
			const formattedJsonStringData = JSON.stringify(finalExportPayloadObject, null, 2);

			const jsonBlobDataObject = new Blob([formattedJsonStringData], { type: "application/json" });

			const temporaryDownloadUrlString = URL.createObjectURL(jsonBlobDataObject);

			const hiddenDownloadLinkElement = document.createElement('a');

			hiddenDownloadLinkElement.href = temporaryDownloadUrlString;

			hiddenDownloadLinkElement.download = `final_privacy_config_${Date.now()}.json`;

			document.body.appendChild(hiddenDownloadLinkElement);

			hiddenDownloadLinkElement.click();

			document.body.removeChild(hiddenDownloadLinkElement);

			URL.revokeObjectURL(temporaryDownloadUrlString);
			
			messageApi.success(
				translate('step3.msg_export_success', 'Successfully exported privacy configuration (JSON)!')
			);
		} 
		catch (jsonExportErrorExecution) 
		{
			console.error("Export error:", jsonExportErrorExecution);

			messageApi.error(
				translate('step3.msg_export_failed', 'Export failed, please try again.')
			);
		}
	};

	// 未選擇保護模式時之 Warning 畫面 (符合規範 g)
	if (!currentPrivacyModeStatus) 
	{
		return (
			<div style={{ padding: '40px' }}>
				<Result
					status="warning"
					title={translate('step3.no_mode_title', 'Privacy Mode Not Set')}
					subTitle={translate('step3.no_mode_subtitle', 'Please go back to the previous step and select a privacy mode.')}
					extra={<Button type="primary" onClick={executePreviousStepAction}>{translate('step3.btn_go_back', 'Go Back')}</Button>}
				/>
			</div>
		);
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
			
			{/* 頂部全局操作區塊：匯出 JSON 配置檔 */}
			<div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
				<Button 
					type="primary" 
					icon={<DownloadOutlined />} 
					onClick={handleExportJSON} 
					style={{ background: '#4F46E5', borderColor: '#4F46E5' }}
				>
					{translate('step3.btn_export_json', 'Export Final Config (JSON)')}
				</Button>
			</div>

			{/* 錯誤提示橫幅：當參數不合規時自動顯示 */}
			{!isCurrentStepValidStatus && currentStepErrorMessageText && (
				<Alert 
					message={translate('step3.validation_failed', '參數設定不符合規範')} 
					description={currentStepErrorMessageText} 
					type="error" 
					showIcon 
					style={{ borderRadius: '8px' }}
				/>
			)}

			{/* 依據模式載入條對應規則控制面板 */}
			{currentPrivacyModeStatus === 'k-anonymity' ? <KAnonymityRules /> : <DifferentialPrivacyRules />}

			{/* ★ 新增：風險評估「對象族群限定條件」設定面板，與 K-匿名／差分隱私模式無關，故共用渲染一份 */}
			<RiskSubgroupFilterPanel />
		</div>
	);
}