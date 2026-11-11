/**
 * ============================================================================
 * 檔案名稱 (File): Step3_Rules.tsx
 * 模組功能 (Description): 去識別化工作流第三步：隱私參數與驗證規則設定組件 (依據選定模式載入 K-Anonymity 或 DP 規則組件，並提供導出完整 JSON 隱私配置檔功能)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅單字元變數 f, t, e, state)
 * ============================================================================
 */

import React from 'react';
import { Result, Button, App as AntdApp, Alert, theme } from 'antd';
import { DownloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { scaleFontSize } from '../../utils/fontScale';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { buildBackendConfigDocumentFromWorkspace } from '../../utils/pipelineConfig';
import { triggerBlobDownload } from '../../utils/blobDownload';

import KAnonymityRules from './KAnonymityRules';
import DifferentialPrivacyRules from './DifferentialPrivacyRules';
import RiskSubgroupFilterPanel from './RiskSubgroupFilterPanel';
import RiskAssessmentSettingsPanel from './RiskAssessmentSettingsPanel';

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

	const { token } = theme.useToken();
	const isDarkModeActiveStatus = token.colorBgContainer !== '#ffffff';  // 與 KAnonymityRules 相同的深色判定
	const exportAccentColor = isDarkModeActiveStatus ? '#9fa8ff' : '#4F46E5';
	
	const { message: messageApi } = AntdApp.useApp();

	/**
	 * 函數名稱: handleExportJSON
	 * 函數功能: 依工作區 Steps 1 ~ 3 之設定，組出與 Step4 實際送給後端相同格式的 config.json（K-匿名或差分隱私）並觸發下載。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於頁面上方「下載設定檔」區塊按鈕之 onClick 事件
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
	const handleExportJSON = (): void => 
	{
		// ★ 2026-10-01：先前匯出的是前端自訂格式（privacy_targets／differential_privacy_rules 陣列、
		//   column_roles 等內部狀態），與後端 config.json（docs/manual_test/config_kanon.json／config_dp.json）
		//   格式不同，無法直接交給後端，且漏掉 minimum_unit、逐欄溢出策略、noise_step 等設定。改為與 Step4
		//   實際送出的設定檔使用同一套組裝邏輯（utils/pipelineConfig.ts），匯出的檔案即後端可直接讀取的格式，
		//   也可再由 Step2「匯入配置」讀回。
		const finalExportPayloadObject = buildBackendConfigDocumentFromWorkspace(useWorkspaceStore.getState());
		if (!finalExportPayloadObject)
		{
			messageApi.error(translate('step3.msg_export_no_mode', '尚未選擇隱私保護模式，無法匯出設定檔'));
			return;
		}

		try 
		{
			const formattedJsonStringData = JSON.stringify(finalExportPayloadObject, null, 2);

			const jsonBlobDataObject = new Blob([formattedJsonStringData], { type: "application/json" });

			triggerBlobDownload(jsonBlobDataObject, `final_privacy_config_${Date.now()}.json`);
			
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
			
			{/* ★ 2026-10-07 QA 回饋「輸出設定檔不明顯」：原本是右上角一顆小按鈕，改為整列醒目的下載區塊
			    （圖示＋標題＋一句用途＋大按鈕），放在頁面最上方。 */}
			<div
				data-testid="step3-export-banner"
				style={{
					display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
					padding: '14px 18px', borderRadius: 12,
					border: `1px solid ${exportAccentColor}`,
					background: isDarkModeActiveStatus ? 'rgba(79, 70, 229, 0.16)' : '#EEF2FF'
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
					<FileTextOutlined style={{ fontSize: scaleFontSize(30), color: exportAccentColor, flexShrink: 0 }} />
					<div style={{ minWidth: 0 }}>
						<div style={{ fontSize: scaleFontSize(16), fontWeight: 700, color: token.colorText }}>{translate('step3.export_banner_title', '設定檔（JSON）')}</div>
						<div style={{ fontSize: scaleFontSize(13), color: token.colorTextSecondary }}>{translate('step3.export_banner_desc', '保存本次設定，下次可在 Step2 匯入重複使用。')}</div>
					</div>
				</div>
				<Button
					type="primary"
					size="large"
					icon={<DownloadOutlined />}
					onClick={handleExportJSON}
					style={{ background: '#4F46E5', borderColor: '#4F46E5', height: 44, paddingInline: 24, fontWeight: 600 }}
				>
					{translate('step3.btn_download_config', '下載設定檔')}
				</Button>
			</div>

			{/* 錯誤提示橫幅：當參數不合規時自動顯示 */}
			{!isCurrentStepValidStatus && currentStepErrorMessageText && (
				<Alert 
					message={translate('step3.validation_failed', '參數設定不符規範')} 
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

			{/* ★ 2026-10-28：風險評估進階設定（匯入的欄位角色、連結性分組、三攻擊實驗參數） */}
			<RiskAssessmentSettingsPanel />
		</div>
	);
}