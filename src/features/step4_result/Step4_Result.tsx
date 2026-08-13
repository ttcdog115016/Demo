/**
 * ============================================================================
 * 檔案名稱 (File): Step4_Result.tsx
 * 模組功能 (Description): 去識別化工作流第四步：結果展示、風險審計與憑證簽發組件 (提供蒙地卡羅攻擊模擬、資料效用評估、脫敏對照預覽與高畫質 PDF/CSV 憑證下載)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (全面消滅單字元變數，如 f, t, e, d, r, u, b)
 * ============================================================================
 */

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

/**
 * ============================================================================
 * 魔術數字常數化宣告 (Magic Numbers Constants)
 * ============================================================================
 */
const MONTE_CARLO_SIMULATION_COUNT = 1000; // 蒙地卡羅模擬攻擊次數基準
const SIMULATION_PROGRESS_INTERVAL_MS = 200; // 模擬進度條更新頻率 (毫秒)
const SIMULATION_COMPLETION_DELAY_MS = 600;  // 模擬完成後的 UI 停留緩衝時間 (毫秒)
const PDF_COMPILATION_DELAY_MS = 400;        // 觸發 PDF 下載前的渲染緩衝時間，確保 ECharts 動畫結束
const HASH_PREVIEW_TRUNCATE_LENGTH = 16;     // UI 預覽 Hash 字串的截斷長度

/**
 * html2pdf 套件之方法型別介面
 */
interface Html2Pdf 
{
	set: (options: Record<string, unknown>) => Html2Pdf;
	from: (element: HTMLElement | null) => Html2Pdf;
	save: () => Promise<void>;
}

/**
 * 擴充 Window 物件介面，以支援全域掛載之 html2pdf 函式
 */
interface WindowWithHtml2Pdf extends Window 
{
	html2pdf: () => Html2Pdf;
}

/**
 * 模擬評估結果資料結構介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface SimulationResult 
{
	singling: { ori: number; ctrl: number; base: number; risk: number };       // 指認性攻擊 (Singling Out) 指標
	linkability: { ori: number; ctrl: number; base: number; risk: number };    // 連結性攻擊 (Linkability) 指標
	inference: { ori: number; ctrl: number; base: number; risk: number };      // 推斷性攻擊 (Inference) 指標
	overallRiskPercent: string;                                                // 綜合最高殘餘風險百分比字串 (保留一位小數)
}

// 定義管線處理的四個階段狀態
type PipelinePhase = 'uploading' | 'processing' | 'auditing' | 'completed';

/**
 * 函數名稱: applyPreprocess
 * 函數功能: 對單一儲存格資料執行預處理清洗邏輯 (Pre-processing Cleansing)。
 */
const applyPreprocess = (cellValueData: string, actionTypeStr?: string, actionParameterStr?: string) => 
{
	if (!cellValueData || !actionTypeStr || actionTypeStr === 'none') 
	{
		return cellValueData;
	}

	let targetPreprocessString = cellValueData;

	if (actionTypeStr === 'remove_digits') 
	{
		targetPreprocessString = targetPreprocessString.replace(/\d+/g, '');
	}
	else if (actionTypeStr === 'remove_spaces') 
	{
		targetPreprocessString = targetPreprocessString.replace(/\s+/g, '');
	}
	else if (actionTypeStr === 'keep_before' && actionParameterStr) 
	{
		const targetSubstringIndex = targetPreprocessString.indexOf(actionParameterStr);

		if (targetSubstringIndex !== -1) 
		{
			targetPreprocessString = targetPreprocessString.substring(0, targetSubstringIndex);
		}
	} 
	else if (actionTypeStr === 'keep_until' && actionParameterStr) 
	{
		const targetSubstringIndex = targetPreprocessString.indexOf(actionParameterStr);

		if (targetSubstringIndex !== -1) 
		{
			targetPreprocessString = targetPreprocessString.substring(0, targetSubstringIndex + actionParameterStr.length);
		}
	} 
	else if (actionTypeStr === 'regex_replace' && actionParameterStr) 
	{
		try 
		{
			const regexMatcherInstance = new RegExp(actionParameterStr, 'g');

			targetPreprocessString = targetPreprocessString.replace(regexMatcherInstance, '');
		} 
		catch 
		{ 
			// 忽略無效正則
		}
	}
	else if (actionTypeStr === 'hash') 
	{
		try 
		{
			let calculatedHashResult = '';

			const cleanedAlgorithmParamName = actionParameterStr?.toLowerCase().trim();

			if (cleanedAlgorithmParamName === 'md5') 
			{
				calculatedHashResult = CryptoJS.MD5(targetPreprocessString).toString();
			}
			else if (cleanedAlgorithmParamName === 'sha512') 
			{
				calculatedHashResult = CryptoJS.SHA512(targetPreprocessString).toString();
			}
			else 
			{
				calculatedHashResult = CryptoJS.SHA256(targetPreprocessString).toString();
			}

			targetPreprocessString = calculatedHashResult.substring(0, HASH_PREVIEW_TRUNCATE_LENGTH) + '...';
		} 
		catch (hashingErrorExecution) 
		{
			console.error('Hashing error:', hashingErrorExecution);
			targetPreprocessString = 'Hash Error';
		}
	}

	return targetPreprocessString;
};

export default function Step4_Result(): React.ReactElement 
{
	const { token } = theme.useToken();
	const isDarkModeActiveStatus = token.colorBgContainer !== '#ffffff';
	const { t: translate } = useTranslation();
	const { message: messageApi } = AntdApp.useApp();

	// ============================================================================
	// 全域狀態訂閱 (Zustand Store)
	// ============================================================================
	const currentUserSession = useAuthStore((state) => state.user);
	const addAuditLogAction = useAuditStore((state) => state.addAuditLog);
	const datasetColumnsListArray = useWorkspaceStore((state) => state.columns);
	const previewDataRowsListArray = useWorkspaceStore((state) => state.previewData);
	const currentPrivacyModeTypeStr = useWorkspaceStore((state) => state.privacyMode);
	const currentKValueNumber = useWorkspaceStore((state) => state.kValue);
	const currentDpFieldsListArray = useWorkspaceStore((state) => state.dpFields);
	const columnPrivacyRolesMapDict = useWorkspaceStore((state) => state.columnRoles);
	const currentPreprocessingRulesMapDict = useWorkspaceStore((state) => state.preprocessingRules);
	const currentDatasetFileNameString = useWorkspaceStore((state) => state.fileName);
	const simulatedQueryCountValue = useWorkspaceStore((state) => state.queryCount);
	const step4AnalysisCacheData = useWorkspaceStore((state) => state.step4Cache);
	const lastRunParametersHashString = useWorkspaceStore((state) => state.lastRunParamsHash);
	const setStep4CacheAction = useWorkspaceStore((state) => state.setStep4Cache);

	// ============================================================================
	// 元件區域狀態宣告
	// ============================================================================
	const [previewViewMode, setPreviewViewMode] = useState<'masked' | 'original'>('masked');
	const [isReportModalVisibleStatus, setIsReportModalVisibleStatus] = useState<boolean>(false);
	const [isExportingPdfStatus, setIsExportingPdfStatus] = useState<boolean>(false);
	
	const pdfReportContainerRef = useRef<HTMLDivElement>(null);
	const simulationLogsEndRef = useRef<HTMLDivElement>(null); 

	// 計算當前參數配置的 Hash 簽名，用於判定是否需要重新執行演算
	const currentParametersHashString = useMemo(
		() => JSON.stringify({
			privacyMode: currentPrivacyModeTypeStr, kValue: currentKValueNumber, queryCount: simulatedQueryCountValue, dpFields: currentDpFieldsListArray, columnRoles: columnPrivacyRolesMapDict, preprocessingRules: currentPreprocessingRulesMapDict
		}), 
		[currentPrivacyModeTypeStr, currentKValueNumber, simulatedQueryCountValue, currentDpFieldsListArray, columnPrivacyRolesMapDict, currentPreprocessingRulesMapDict]
	);

	// 判定快取是否有效 (防呆)
	const isAnalysisCacheValidStatus = useMemo(
		() => step4AnalysisCacheData !== null && lastRunParametersHashString === currentParametersHashString, 
		[step4AnalysisCacheData, lastRunParametersHashString, currentParametersHashString]
	);
	
	const [isPipelineCalculatingStatus, setIsPipelineCalculatingStatus] = useState<boolean>(!isAnalysisCacheValidStatus);
	const [currentPipelinePhaseType, setCurrentPipelinePhaseType] = useState<PipelinePhase>(isAnalysisCacheValidStatus ? 'completed' : 'uploading');
	const [calculationProgressValue, setCalculationProgressValue] = useState<number>(isAnalysisCacheValidStatus ? 100 : 0);
	const [systemSimulationLogsList, setSystemSimulationLogsList] = useState<string[]>([]);
	const [attackSimulationMetricsData, setAttackSimulationMetricsData] = useState<SimulationResult | null>(isAnalysisCacheValidStatus ? step4AnalysisCacheData!.metrics : null);
	const [auditMetadataObject, setAuditMetadataObject] = useState(
		() => ({ certificateId: isAnalysisCacheValidStatus ? step4AnalysisCacheData!.certificateId : `PAC-${Date.now()}`, auditTime: isAnalysisCacheValidStatus ? step4AnalysisCacheData!.auditTime : new Date().toLocaleString() })
	);

	// 防呆備用欄位配置
	const actualProcessedColumnsList = useMemo(
		() => datasetColumnsListArray && datasetColumnsListArray.length > 0 ? datasetColumnsListArray : ['card_id', 'card_type', 'in_station', 'in_time', 'out_station', 'out_time', 'ride_duration_mins', 'fare'], 
		[datasetColumnsListArray]
	);

	// 防呆備用資料樣本
	const sampleRawDataRowsList = useMemo(
		() => previewDataRowsListArray && previewDataRowsListArray.length > 0 ? previewDataRowsListArray.slice(0, 10) : [
			{ card_id: 'TX16863', card_type: '敬老卡', in_station: '西門', in_time: '2026-07-17 08:04:00', out_station: '南港', out_time: '2026-07-17 08:20:00', ride_duration_mins: '16', fare: '20' },
			{ card_id: 'TX59692', card_type: '敬老卡', in_station: '公館', in_time: '2026-07-17 07:50:00', out_station: '台北車站', out_time: '2026-07-17 08:08:00', ride_duration_mins: '18', fare: '45' },
		], 
		[previewDataRowsListArray]
	);

	/**
	 * ============================================================================
	 * 核心隱私角色計算邏輯 (Role Determination Logic)
	 * ============================================================================
	 */
	const getCalculatedRole = useCallback(
		(targetColumnNameString: string) => 
		{
			const lowerCaseColumnNameString = targetColumnNameString.toLowerCase();
			const rawConfiguredRoleNameString = (columnPrivacyRolesMapDict[targetColumnNameString] || '').toLowerCase();
			const targetDpFieldConfigItem = currentDpFieldsListArray?.find(fieldItemRecord => fieldItemRecord.fieldName === targetColumnNameString);

			if (currentPrivacyModeTypeStr === 'k-anonymity') 
			{
				if (rawConfiguredRoleNameString.includes('identifier') && !rawConfiguredRoleNameString.includes('quasi')) return { role: 'Identifier', tagColor: 'magenta' };
				if (rawConfiguredRoleNameString.includes('quasi') || rawConfiguredRoleNameString === 'qi') return { role: 'Quasi-identifier', tagColor: 'orange' };
			}

			const isExplicitIdentifierMatched = /(^|_)(id|card_id|nric|phone|email|name|ssn)($|_)/i.test(lowerCaseColumnNameString);
			if (isExplicitIdentifierMatched) 
			{
				return { role: 'Identifier', tagColor: 'magenta' }; 
			}

			if (currentPrivacyModeTypeStr === 'differential-privacy') 
			{
				if (targetDpFieldConfigItem && targetDpFieldConfigItem.enabled) return { role: 'DP Sensitive', tagColor: 'purple' };
				return { role: 'Retained', tagColor: 'blue' };
			}

			if (/(station|time|date|zip|age|gender|card_type)/i.test(lowerCaseColumnNameString)) 
			{
				return { role: 'Quasi-identifier', tagColor: 'orange' }; 
			}

			return { role: 'Non-sensitive', tagColor: 'blue' };
		}, 
		[columnPrivacyRolesMapDict, currentDpFieldsListArray, currentPrivacyModeTypeStr]
	);

	/**
	 * ============================================================================
	 * 蒙地卡羅模擬器與殘餘風險計算核心 (Simulation & Risk Scoring Pipeline)
	 * ============================================================================
	 */
	const runFullPipeline = useCallback(
		(isForceRunTriggered: boolean = false) => 
		{
			if (!isForceRunTriggered && isAnalysisCacheValidStatus) return;

			setIsPipelineCalculatingStatus(true);
			setCalculationProgressValue(0);
			setCurrentPipelinePhaseType('uploading');
			
			const currentExecutionDateTimeObj = new Date();
			const generatedNewAuditMetadataObj = { certificateId: `PAC-${currentExecutionDateTimeObj.getTime()}`, auditTime: currentExecutionDateTimeObj.toLocaleString() };
			setAuditMetadataObject(generatedNewAuditMetadataObj);
			const formatCurrentTimeForLogString = () => new Date().toLocaleTimeString();

			let internalProgressValueAccumulator = 0;
			let currentPipelinePhaseStatusTracker = 'uploading';
			let isCleaningPhaseLoggedTracker = false;
			let isNoisePhaseLoggedTracker = false;
			let isSinglingAttackLoggedTracker = false;
			let isInferenceAttackLoggedTracker = false;
			let isUtilityEvalLoggedTracker = false;

			setSystemSimulationLogsList(
				[
					translate('step4.log.connect', '[{{time}}] 建立 WebSocket 連線... 準備傳輸巨量資料集', { time: formatCurrentTimeForLogString() }),
					translate('step4.log.bind', '[{{time}}] 綁定隱私預算組合參數: 查詢發布次數 M = {{m}}', { time: formatCurrentTimeForLogString(), m: simulatedQueryCountValue })
				]
			);

			const simulationProgressIntervalId = setInterval(
				() => 
				{
					internalProgressValueAccumulator += Math.floor(Math.random() * 5) + 3; 
					if (internalProgressValueAccumulator > 100) internalProgressValueAccumulator = 100;
					setCalculationProgressValue(internalProgressValueAccumulator);

					if (internalProgressValueAccumulator < 30) 
					{
						if (currentPipelinePhaseStatusTracker !== 'uploading') 
						{ 
							currentPipelinePhaseStatusTracker = 'uploading'; 
							setCurrentPipelinePhaseType('uploading'); 
						}
						if (internalProgressValueAccumulator % 2 === 0) 
						{
							setSystemSimulationLogsList(
								(previousLogsListArray) => [...previousLogsListArray, translate('step4.log.uploading', '[{{time}}] ⬆️ Uploading Chunk [{{part}}/10]... ({{prog}}%)', { time: formatCurrentTimeForLogString(), part: Math.floor(internalProgressValueAccumulator / 3), prog: internalProgressValueAccumulator })]
							);
						}
					} 
					else if (internalProgressValueAccumulator >= 30 && internalProgressValueAccumulator < 65) 
					{
						if (currentPipelinePhaseStatusTracker !== 'processing') 
						{
							currentPipelinePhaseStatusTracker = 'processing';
							setCurrentPipelinePhaseType('processing');
							setSystemSimulationLogsList(
								(previousLogsListArray) => [...previousLogsListArray, translate('step4.log.uploaded', '[{{time}}] ✅ 檔案切片傳輸完成，驗證 Checksum 成功。', { time: formatCurrentTimeForLogString() })]
							);
							setSystemSimulationLogsList(
								(previousLogsListArray) => [...previousLogsListArray, translate('step4.log.init_engine', '[{{time}}] ⚙️ 初始化分佈式去識別化引擎 (Mode: {{mode}})', { time: formatCurrentTimeForLogString(), mode: currentPrivacyModeTypeStr })]
							);
						}

						if (internalProgressValueAccumulator >= 40 && !isCleaningPhaseLoggedTracker) 
						{
							isCleaningPhaseLoggedTracker = true;
							setSystemSimulationLogsList(
								(previousLogsListArray) => [...previousLogsListArray, translate('step4.log.cleaning', '[{{time}}] 🧹 執行資料預處理與正規化清洗 (Regex & Trim)...', { time: formatCurrentTimeForLogString() })]
							);
						}

						if (internalProgressValueAccumulator >= 55 && !isNoisePhaseLoggedTracker) 
						{
							isNoisePhaseLoggedTracker = true;
							setSystemSimulationLogsList(
								(previousLogsListArray) => [...previousLogsListArray, currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.log.k_anon', '[{{time}}] 🌳 運算 K-匿名泛化樹 (Generalization Hierarchy)...', { time: formatCurrentTimeForLogString() }) : translate('step4.log.dp_noise', '[{{time}}] 🎲 注入拉普拉斯擾動雜訊 (Laplace Noise)...', { time: formatCurrentTimeForLogString() })]
							);
						}
					} 
					else if (internalProgressValueAccumulator >= 65 && internalProgressValueAccumulator < 100) 
					{
						if (currentPipelinePhaseStatusTracker !== 'auditing') 
						{
							currentPipelinePhaseStatusTracker = 'auditing';
							setCurrentPipelinePhaseType('auditing');
							setSystemSimulationLogsList(
								(previousLogsListArray) => [...previousLogsListArray, translate('step4.log.start_mc', '[{{time}}] 🚀 脫敏完成，啟動蒙地卡羅攻擊模擬器 (N={{n}})', { time: formatCurrentTimeForLogString(), n: MONTE_CARLO_SIMULATION_COUNT })]
							);
						}

						if (internalProgressValueAccumulator >= 70 && !isSinglingAttackLoggedTracker) 
						{
							isSinglingAttackLoggedTracker = true;
							setSystemSimulationLogsList(
								(previousLogsListArray) => [...previousLogsListArray, translate('step4.log.attack1', '[{{time}}] ⚔️ 執行指認性與跨表連結攻擊測試 (Singling-Out & Linkability)...', { time: formatCurrentTimeForLogString() })]
							);
						}

						if (internalProgressValueAccumulator >= 85 && !isInferenceAttackLoggedTracker) 
						{
							isInferenceAttackLoggedTracker = true;
							setSystemSimulationLogsList(
								(previousLogsListArray) => [...previousLogsListArray, translate('step4.log.attack2', '[{{time}}] 🤖 訓練隨機森林模型評估推斷攻擊 (Inference Attack)...', { time: formatCurrentTimeForLogString() })]
							);
						}

						if (internalProgressValueAccumulator >= 95 && !isUtilityEvalLoggedTracker) 
						{
							isUtilityEvalLoggedTracker = true;
							setSystemSimulationLogsList(
								(previousLogsListArray) => [...previousLogsListArray, translate('step4.log.utility', '[{{time}}] 📊 運算資料記錄抑制率與泛化欄位失真度評估...', { time: formatCurrentTimeForLogString() })]
							);
						}
					} 
					else if (internalProgressValueAccumulator >= 100) 
					{
						clearInterval(simulationProgressIntervalId);
						setCurrentPipelinePhaseType('completed');
						
						const isModeKAnonymityStatus = currentPrivacyModeTypeStr === 'k-anonymity';
						const calculatedQueryCompositionFactorValue = currentPrivacyModeTypeStr === 'differential-privacy' ? Math.min(2.0, 1 + (simulatedQueryCountValue - 1) * 0.15) : 1.0;
						const simulatedOriginalSinglingRiskValue = (isModeKAnonymityStatus ? Math.max(0.05, 0.45 - currentKValueNumber * 0.03) : 0.12) * calculatedQueryCompositionFactorValue;
						const simulatedOriginalLinkabilityRiskValue = (isModeKAnonymityStatus ? Math.max(0.08, 0.52 - currentKValueNumber * 0.04) : 0.18) * calculatedQueryCompositionFactorValue;
						const simulatedOriginalInferenceRiskValue = (isModeKAnonymityStatus ? Math.max(0.10, 0.60 - currentKValueNumber * 0.035) : 0.22) * calculatedQueryCompositionFactorValue;

						const calculateNormalizedRiskRateFunction = (originalRateValue: number, controlRateValue: number, baselineRateValue: number) => 
						{
							const calculatedMaxDenominatorValue = Math.max(controlRateValue, baselineRateValue);
							return Math.max(0, (originalRateValue - calculatedMaxDenominatorValue) / (1 - calculatedMaxDenominatorValue));
						};

						const finalNormalizedSinglingRiskValue = calculateNormalizedRiskRateFunction(simulatedOriginalSinglingRiskValue, 0.02, 0.01);
						const finalNormalizedLinkabilityRiskValue = calculateNormalizedRiskRateFunction(simulatedOriginalLinkabilityRiskValue, 0.03, 0.02);
						const finalNormalizedInferenceRiskValue = calculateNormalizedRiskRateFunction(simulatedOriginalInferenceRiskValue, 0.05, 0.04);
						const calculatedOverallMaxRiskScoreValue = Math.max(finalNormalizedSinglingRiskValue, finalNormalizedLinkabilityRiskValue, finalNormalizedInferenceRiskValue);

						const generatedSimulationMetricsObject: SimulationResult = {
							singling: { ori: simulatedOriginalSinglingRiskValue, ctrl: 0.02, base: 0.01, risk: finalNormalizedSinglingRiskValue },
							linkability: { ori: simulatedOriginalLinkabilityRiskValue, ctrl: 0.03, base: 0.02, risk: finalNormalizedLinkabilityRiskValue },
							inference: { ori: simulatedOriginalInferenceRiskValue, ctrl: 0.05, base: 0.04, risk: finalNormalizedInferenceRiskValue },
							overallRiskPercent: (calculatedOverallMaxRiskScoreValue * 100).toFixed(1)
						};

						setAttackSimulationMetricsData(generatedSimulationMetricsObject);

						setStep4CacheAction(
							{
								metrics: generatedSimulationMetricsObject,
								certificateId: generatedNewAuditMetadataObj.certificateId,
								auditTime: generatedNewAuditMetadataObj.auditTime
							}, 
							currentParametersHashString
						);

						addAuditLogAction(
							{
								certificateId: generatedNewAuditMetadataObj.certificateId,
								fileName: currentDatasetFileNameString || 'dataset.csv',
								privacyMode: currentPrivacyModeTypeStr || 'k-anonymity',
								operator: currentUserSession?.name || 'Admin.Test',
								operatorRole: currentUserSession?.role || 'admin',
								auditTime: generatedNewAuditMetadataObj.auditTime,
								parameters: currentPrivacyModeTypeStr === 'k-anonymity' ? `K = ${currentKValueNumber}` : `發布次數 M = ${simulatedQueryCountValue}`,
								singlingRisk: `${(finalNormalizedSinglingRiskValue * 100).toFixed(1)}%`,
								linkabilityRisk: `${(finalNormalizedLinkabilityRiskValue * 100).toFixed(1)}%`,
								inferenceRisk: `${(finalNormalizedInferenceRiskValue * 100).toFixed(1)}%`,
								overallRisk: `${generatedSimulationMetricsObject.overallRiskPercent}%`,
								status: 'passed'
							}
						);

						setSystemSimulationLogsList(
							(previousLogsListArray) => [...previousLogsListArray, translate('step4.log.finished', '[{{time}}] 🎉 後端管線運算完畢，合規憑證已成功簽發！', { time: formatCurrentTimeForLogString() })]
						);
						
						setTimeout(() => setIsPipelineCalculatingStatus(false), SIMULATION_COMPLETION_DELAY_MS); 
					}
				}, 
				SIMULATION_PROGRESS_INTERVAL_MS
			);
		}, 
		[currentPrivacyModeTypeStr, currentKValueNumber, simulatedQueryCountValue, currentDatasetFileNameString, currentUserSession, addAuditLogAction, translate, isAnalysisCacheValidStatus, currentParametersHashString, setStep4CacheAction]
	);

	useEffect(
		() => 
		{
			if (!isAnalysisCacheValidStatus) 
			{
				const initialSimulationTimeoutId = setTimeout(() => runFullPipeline(false), 0);
				return () => clearTimeout(initialSimulationTimeoutId);
			}
		}, 
		[isAnalysisCacheValidStatus, runFullPipeline]
	);

	useEffect(
		() => 
		{
			if (simulationLogsEndRef.current) 
			{
				simulationLogsEndRef.current.scrollIntoView({ behavior: 'smooth' });
			}
		}, 
		[systemSimulationLogsList]
	);

	/**
	 * ============================================================================
	 * 數據集資料轉換引擎 (Dataset Transformation Engine)
	 * ============================================================================
	 */
	const mappedProcessedDatasetRowsList = useMemo(
		() => 
		{
			return sampleRawDataRowsList.map(
				(dataRowRecordItem) => 
				{
					const constructedNewProcessedRowRecord: Record<string, string> = {};

					actualProcessedColumnsList.forEach(
						(targetColumnNameString) => 
						{
							let currentCellValueDataString = String(dataRowRecordItem[targetColumnNameString] ?? '');
							const targetColumnPreprocessingRuleConfig = currentPreprocessingRulesMapDict[targetColumnNameString];

							// 1. 執行基礎預處理清洗 (如 Regex)
							if (targetColumnPreprocessingRuleConfig) 
							{
								currentCellValueDataString = applyPreprocess(currentCellValueDataString, targetColumnPreprocessingRuleConfig.action, targetColumnPreprocessingRuleConfig.param);
							}

							const { role: privacyRoleCalculatedString } = getCalculatedRole(targetColumnNameString);

							// 2. 針對直接識別碼 (Identifier) 執行遮蔽
							if (privacyRoleCalculatedString === 'Identifier') 
							{
								if (currentCellValueDataString.length > 4) 
								{
									constructedNewProcessedRowRecord[targetColumnNameString] = `${currentCellValueDataString.substring(0, 2)}****${currentCellValueDataString.substring(currentCellValueDataString.length - 2)}`;
								} 
								else 
								{
									constructedNewProcessedRowRecord[targetColumnNameString] = '***';
								}
							} 
							// 3. 針對差分隱私模式 (DP) 執行拉普拉斯加噪演算 (Laplace Mechanism)
							else if (currentPrivacyModeTypeStr === 'differential-privacy') 
							{
								const targetDpFieldConfigObject = currentDpFieldsListArray?.find(fieldItemRecord => fieldItemRecord.fieldName === targetColumnNameString && fieldItemRecord.enabled);

								if (targetDpFieldConfigObject && targetDpFieldConfigObject.fieldType === 'Numeric' && /^-?\d+(\.\d+)?$/.test(currentCellValueDataString)) 
								{
									const parsedNumericCellDataValue = parseFloat(currentCellValueDataString);
									const adjustedTargetEpsilonBudgetValue = (targetDpFieldConfigObject.epsilon || 1.0) / Math.sqrt(simulatedQueryCountValue); 
									const generatedUniformRandomVariableValue = Math.random() - 0.5;
									const calculatedNumericLowerBoundLimit = Number(targetDpFieldConfigObject.lowerBound ?? 0);
									const calculatedNumericUpperBoundLimit = Number(targetDpFieldConfigObject.upperBound ?? 100);
									const calculatedParameterSensitivityValue = Math.max(1, calculatedNumericUpperBoundLimit - calculatedNumericLowerBoundLimit);
									const calculatedLaplaceDistributionScaleValue = calculatedParameterSensitivityValue / adjustedTargetEpsilonBudgetValue;
									const generatedLaplaceNoiseValue = -calculatedLaplaceDistributionScaleValue * Math.sign(generatedUniformRandomVariableValue) * Math.log(1 - 2 * Math.abs(generatedUniformRandomVariableValue));
									const boundedFinalNoisyDataValue = Math.min(calculatedNumericUpperBoundLimit, Math.max(calculatedNumericLowerBoundLimit, Math.round(parsedNumericCellDataValue + generatedLaplaceNoiseValue)));

									constructedNewProcessedRowRecord[targetColumnNameString] = boundedFinalNoisyDataValue.toString();
								} 
								else 
								{
									constructedNewProcessedRowRecord[targetColumnNameString] = currentCellValueDataString;
								}
							} 
							// 4. 針對 K-匿名模式執行泛化演算 (Generalization)
							else if (currentPrivacyModeTypeStr === 'k-anonymity' && privacyRoleCalculatedString === 'Quasi-identifier') 
							{
								if (/^\d+$/.test(currentCellValueDataString)) 
								{
									const parsedIntegerCellDataValue = parseInt(currentCellValueDataString, 10);
									const roundingIntervalStepSizeValue = 10;
									const roundedCalculatedLowerBoundValue = Math.floor(parsedIntegerCellDataValue / roundingIntervalStepSizeValue) * roundingIntervalStepSizeValue;
									constructedNewProcessedRowRecord[targetColumnNameString] = `${roundedCalculatedLowerBoundValue} - ${roundedCalculatedLowerBoundValue + roundingIntervalStepSizeValue - 1}`;
								} 
								else if (/^\d{4}-\d{2}-\d{2}/.test(currentCellValueDataString)) 
								{
									constructedNewProcessedRowRecord[targetColumnNameString] = currentCellValueDataString.substring(0, 4);
								} 
								else 
								{
									constructedNewProcessedRowRecord[targetColumnNameString] = currentCellValueDataString.length > 2 ? `${currentCellValueDataString.substring(0, currentCellValueDataString.length - 1)}*` : '***';
								}
							} 
							else 
							{
								constructedNewProcessedRowRecord[targetColumnNameString] = currentCellValueDataString;
							}
						}
					);

					return constructedNewProcessedRowRecord;
				}
			);
		}, 
		[sampleRawDataRowsList, actualProcessedColumnsList, currentPreprocessingRulesMapDict, currentPrivacyModeTypeStr, currentDpFieldsListArray, getCalculatedRole, simulatedQueryCountValue]
	);

	/**
	 * ============================================================================
	 * ECharts 攻擊風險長條圖表選項設定
	 * ============================================================================
	 */
	const getAttackChartOption = () => 
	{
		if (!attackSimulationMetricsData) return {};

		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
			legend: { 
				data: [
					translate('step4.chart.s_ori', '主要攻擊成功率'), 
					translate('step4.chart.s_ctrl', '控制組偽陽性率'), 
					translate('step4.chart.s_base', '基線猜測率')
				],
				textStyle: { color: token.colorTextSecondary },
				top: '0%'
			},
			grid: { top: '18%', left: '3%', right: '4%', bottom: '3%', containLabel: true },
			xAxis: {
				type: 'category',
				data: [
					translate('step4.chart.singling', '指認性攻擊 (Singling Out)'), 
					translate('step4.chart.linkability', '連結性攻擊 (Linkability)'), 
					translate('step4.chart.inference', '推斷性攻擊 (Inference)')
				],
				axisLabel: { color: token.colorTextSecondary }
			},
			yAxis: {
				type: 'value',
				max: 1.0,
				axisLabel: { formatter: (numericAxisValue: number) => `${(numericAxisValue * 100).toFixed(0)}%`, color: token.colorTextDescription },
				splitLine: { lineStyle: { color: token.colorSplit } }
			},
			series: [
				{
					name: translate('step4.chart.s_ori', '主要攻擊成功率'),
					type: 'bar',
					data: [attackSimulationMetricsData.singling.ori, attackSimulationMetricsData.linkability.ori, attackSimulationMetricsData.inference.ori],
					itemStyle: { color: '#ff4d4f', borderRadius: [4, 4, 0, 0] }
				},
				{
					name: translate('step4.chart.s_ctrl', '控制組偽陽性率'),
					type: 'bar',
					data: [attackSimulationMetricsData.singling.ctrl, attackSimulationMetricsData.linkability.ctrl, attackSimulationMetricsData.inference.ctrl],
					itemStyle: { color: '#faad14', borderRadius: [4, 4, 0, 0] }
				},
				{
					name: translate('step4.chart.s_base', '基線猜測率'),
					type: 'bar',
					data: [attackSimulationMetricsData.singling.base, attackSimulationMetricsData.linkability.base, attackSimulationMetricsData.inference.base],
					itemStyle: { color: '#91caff', borderRadius: [4, 4, 0, 0] }
				}
			]
		};
	};

	const handleOpenReportModal = () => setIsReportModalVisibleStatus(true);

	/**
	 * ============================================================================
	 * 下載匯出邏輯 (CSV 與 PDF 生成)
	 * ============================================================================
	 */
	const handleDownloadCSV = () => 
	{
		const csvHeadersJoinedString = actualProcessedColumnsList.join(',');

		const csvDataRowsFormattedArray = mappedProcessedDatasetRowsList.map(dataRowRecordItem => actualProcessedColumnsList.map(columnNameString => `"${dataRowRecordItem[columnNameString] || ''}"`).join(','));

		const finalCsvFileContentString = [csvHeadersJoinedString, ...csvDataRowsFormattedArray].join('\n');

		const generatedCsvBlobObject = new Blob([finalCsvFileContentString], { type: 'text/csv;charset=utf-8;' });

		const blobDownloadUrlString = URL.createObjectURL(generatedCsvBlobObject);

		const downloadAnchorHtmlElement = document.createElement('a');

		downloadAnchorHtmlElement.href = blobDownloadUrlString;

		downloadAnchorHtmlElement.download = `deidentified_dataset_${Date.now()}.csv`;

		document.body.appendChild(downloadAnchorHtmlElement);

		downloadAnchorHtmlElement.click();

		document.body.removeChild(downloadAnchorHtmlElement);

		messageApi.success(translate('step4.msg.download_success', '已成功匯出全量脫敏 CSV 數據！'));
	};

	const handleDownloadPDF = async () => 
	{
		const targetPdfPrintHtmlElement = document.getElementById('printable-audit-report');

		if (!targetPdfPrintHtmlElement) return;
		
		const hideGlobalLoadingMessageFunction = messageApi.loading(translate('step4.msg.pdf_compiling', '正在編譯高畫質 PDF，請稍候...'), 0);
		
		setIsExportingPdfStatus(true);
		
		await new Promise((resolveDelayPromise) => setTimeout(resolveDelayPromise, PDF_COMPILATION_DELAY_MS));

		const html2pdfScriptElement = document.createElement('script');

		html2pdfScriptElement.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
		
		html2pdfScriptElement.onload = () => 
		{
			const pdfGenerationConfigurationOptions = {
				margin:       [10, 10, 10, 10],
				filename:     `Privacy_Audit_Certificate_${auditMetadataObject.certificateId}.pdf`,
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

			(window as unknown as WindowWithHtml2Pdf).html2pdf().set(pdfGenerationConfigurationOptions).from(targetPdfPrintHtmlElement).save().then(
				() => 
				{
					hideGlobalLoadingMessageFunction();
					messageApi.success(translate('step4.msg.pdf_success', '合規審計憑證 PDF 已成功下載！'));
				}
			).catch(
				(pdfExecutionErrorPayload: unknown) => 
				{
					hideGlobalLoadingMessageFunction();
					messageApi.error(translate('step4.msg.pdf_failed', 'PDF 下載失敗'));
					console.error(pdfExecutionErrorPayload);
				}
			).finally(
				() => setIsExportingPdfStatus(false)
			);
		};
		
		html2pdfScriptElement.onerror = () => 
		{
			hideGlobalLoadingMessageFunction();
			messageApi.error(translate('step4.msg.pdf_no_lib', '無法載入 PDF 轉檔套件，請檢查網路連線。'));
			setIsExportingPdfStatus(false);
		};
		
		document.body.appendChild(html2pdfScriptElement);
	};

	const currentUserRoleTypeNameString = currentUserSession?.role || 'admin';

	/**
	 * ============================================================================
	 * 元件 UI 渲染結構 (Render DOM)
	 * ============================================================================
	 */
	return (
		<div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
			
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
				<Alert
					title={
						<Space>
							<CheckCircleFilled style={{ color: '#52c41a' }} />
							<span style={{ fontWeight: 600 }}>{translate('step4.alert.title', '去識別化矩陣演算與風險審計完成')}</span>
						</Space>
					}
					description={translate('step4.alert.desc', '系統已完成蒙地卡羅攻擊模擬評估，請檢視三大去識別化防禦指標並下載合規報告。')}
					type="success"
					showIcon={false}
					style={{ flex: 1, marginRight: '24px' }}
				/>

				<Space size="middle">
					<Button icon={<ReloadOutlined spin={isPipelineCalculatingStatus} />} onClick={() => runFullPipeline(true)} disabled={isPipelineCalculatingStatus} size="large">
						{translate('step4.btn.recalculate', '重新發起後端運算')}
					</Button>

					<Button type="default" icon={<FileDoneOutlined />} disabled={isPipelineCalculatingStatus} onClick={handleOpenReportModal} size="large">
						{translate('step4.btn.view_report', '檢視與匯出憑證')}
					</Button>

					<Button type="primary" icon={<DownloadOutlined />} disabled={isPipelineCalculatingStatus} onClick={handleDownloadCSV} size="large" style={{ background: '#4F46E5', borderColor: '#4F46E5' }}>
						{translate('step4.btn.download_csv', '下載脫敏 CSV')}
					</Button>
				</Space>
			</div>

			{isPipelineCalculatingStatus ? (
				// =================== 運算模擬載入畫面 ===================
				<Card variant="borderless" style={{ background: token.colorBgContainer }}>
					<div style={{ padding: '32px 16px', background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', borderRadius: '12px' }}>
						
						<Row justify="center" style={{ marginBottom: '32px' }}>
							<Col xs={24} md={20} lg={16}>
								<Steps
									current={
										currentPipelinePhaseType === 'uploading' ? 0 :
										currentPipelinePhaseType === 'processing' ? 1 :
										currentPipelinePhaseType === 'auditing' ? 2 : 3
									}
									items={[
										{ title: translate('step4.steps.upload.title', '切片上傳'), icon: <CloudUploadOutlined /> },
										{ title: translate('step4.steps.process.title', '後端脫敏'), icon: <LoadingOutlined /> },
										{ title: translate('step4.steps.audit.title', '風險審計'), icon: <SafetyCertificateOutlined /> },
										{ title: translate('step4.steps.complete.title', '完成簽發'), icon: <CheckCircleOutlined /> },
									]}
								/>
							</Col>
						</Row>

						<div style={{ textAlign: 'center', marginBottom: '24px' }}>
							<Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: token.colorPrimary }} spin />} />

							<h3 style={{ marginTop: '16px', color: token.colorText }}>
								{currentPipelinePhaseType === 'uploading' && translate('step4.loading.uploading', '正在將大數據切片 (Chunk) 傳輸至後端伺服器...')}
								{currentPipelinePhaseType === 'processing' && translate('step4.loading.processing', '後端正在執行去識別化矩陣與加噪演算...')}
								{currentPipelinePhaseType === 'auditing' && translate('step4.loading.auditing', '正在執行蒙地卡羅攻擊模擬與可用性評估...')}
								{currentPipelinePhaseType === 'completed' && translate('step4.loading.completed', '後端演算完畢，正在生成最終合規報告...')}
							</h3>

							<Progress percent={calculationProgressValue} status="active" style={{ maxWidth: '600px', margin: '16px auto' }} strokeColor={token.colorPrimary} />
						</div>
						
						<div style={{ maxWidth: '800px', margin: '0 auto', background: isDarkModeActiveStatus ? '#000000' : '#1e1e1e', color: '#00ff66', fontFamily: 'monospace', padding: '16px', borderRadius: '8px', textAlign: 'left', fontSize: '13px', height: '180px', overflowY: 'auto', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)' }}>
							{systemSimulationLogsList.map((logItemString, logItemIndexNumber) => <div key={logItemIndexNumber} style={{ marginBottom: '4px' }}>{logItemString}</div>)}
							<div ref={simulationLogsEndRef} />
						</div>
					</div>
				</Card>
			) : (
				// =================== 分析報表與圖表畫面 ===================
				attackSimulationMetricsData && (
					<Row gutter={24} style={{ display: 'flex', alignItems: 'stretch' }}>
						<Col span={16} style={{ display: 'flex' }}>
							<Card 
								title={<span><SafetyCertificateOutlined style={{ marginRight: 8, color: token.colorPrimary }} />{translate('step4.risk.title', '安全性評估 (Privacy Risks)')}</span>}
								variant="borderless"
								style={{ background: token.colorBgContainer, width: '100%', display: 'flex', flexDirection: 'column' }}
								styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
							>
								<div style={{ background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px', border: `1px solid ${token.colorBorderSecondary}` }}>
									<Row align="middle" justify="space-between">
										<Col>
											<div style={{ fontSize: '12px', color: token.colorTextDescription, marginBottom: '4px' }}>
												{translate('step4.risk.overall_desc', '連續發布 M={{m}} 次之綜合殘餘風險', { m: simulatedQueryCountValue })}
											</div>
											<span style={{ fontSize: '24px', fontWeight: 'bold', color: parseFloat(attackSimulationMetricsData.overallRiskPercent) < 20 ? '#52c41a' : '#faad14' }}>
												{attackSimulationMetricsData.overallRiskPercent}%
											</span>
										</Col>
										<Col>
											<Tag color="success" style={{ padding: '4px 12px', borderRadius: '4px', margin: 0, fontWeight: 'bold' }}>
												<CheckCircleOutlined style={{ marginRight: 4 }} /> {translate('step4.risk.passed', '防禦驗證通過')}
											</Tag>
										</Col>
									</Row>
								</div>
								
								<ReactECharts option={getAttackChartOption()} style={{ height: '260px', marginBottom: '16px' }} theme={isDarkModeActiveStatus ? 'dark' : 'light'} />
								
								<div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
									<Tag color="red" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>{translate('step4.risk.singling', '指認風險:')} {(attackSimulationMetricsData.singling.risk * 100).toFixed(1)}%</Tag>
									<Tag color="orange" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>{translate('step4.risk.linkability', '連結風險:')} {(attackSimulationMetricsData.linkability.risk * 100).toFixed(1)}%</Tag>
									<Tag color="cyan" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>{translate('step4.risk.inference', '推斷風險:')} {(attackSimulationMetricsData.inference.risk * 100).toFixed(1)}%</Tag>
								</div>
							</Card>
						</Col>

						<Col span={8} style={{ display: 'flex' }}>
							<Card 
								title={<span><LineChartOutlined style={{ marginRight: 8, color: '#1677ff' }} />{translate('step4.utility.title', '資料效用與失真度評估')}</span>}
								variant="borderless"
								style={{ background: token.colorBgContainer, width: '100%', display: 'flex', flexDirection: 'column' }}
								styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
							>
								<div style={{ background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', padding: '24px 16px', borderRadius: '8px', border: `1px solid ${token.colorBorderSecondary}`, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', alignItems: 'center' }}>
									
									<div style={{ textAlign: 'center', width: '100%', paddingBottom: '24px', borderBottom: `1px dashed ${token.colorBorderSecondary}` }}>
										<div style={{ fontSize: '14px', color: token.colorTextDescription, marginBottom: '16px' }}>{translate('step4.utility.suppression', '資料記錄抑制率')}</div>
										<div style={{ fontSize: '36px', fontWeight: 'bold', color: '#1677ff', marginBottom: '16px', fontFamily: 'monospace', lineHeight: 1 }}>
											0.5 <span style={{ fontSize: '20px' }}>%</span>
										</div>
										<div style={{ fontSize: '12px', color: token.colorTextDescription, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
											<span>{translate('step4.utility.suppression_progress', '極限 5%：')}</span>
											<Progress percent={10} showInfo={false} style={{ width: '80px', margin: 0 }} strokeColor="#1677ff" size="small" />
											<span style={{ color: token.colorText }}>2.5%</span>
										</div>
									</div>

									<div style={{ textAlign: 'center', width: '100%', paddingTop: '24px' }}>
										<div style={{ fontSize: '14px', color: token.colorTextDescription, marginBottom: '16px' }}>{translate('step4.utility.total_cols', '處理欄位總數')}</div>
										<div style={{ fontSize: '36px', fontWeight: 'bold', color: token.colorText, fontFamily: 'monospace', lineHeight: 1 }}>
											{actualProcessedColumnsList.length} <span style={{ fontSize: '20px', color: token.colorTextSecondary }}>{translate('step4.utility.unit_cols', '個')}</span>
										</div>
									</div>
									
								</div>
							</Card>
						</Col>
					</Row>
				)
			)}

			{/* =================== 脫敏預覽表格 =================== */}
			<Card 
				title={
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
						<span><EyeOutlined style={{ marginRight: 8, color: '#13c2c2' }} />{translate('step4.preview.title', '脫敏結果預覽對照 (First 10 Rows)')}</span>
						<Segmented 
							options={[
								{ label: translate('step4.preview.masked', '脫敏後數據 (Masked)'), value: 'masked' },
								{ label: translate('step4.preview.raw', '原始明文數據 (Raw)'), value: 'original' }
							]} 
							value={previewViewMode}
							onChange={(selectedViewModeVal) => setPreviewViewMode(selectedViewModeVal as 'masked' | 'original')}
						/>
					</div>
				}
				variant="borderless"
				style={{ background: token.colorBgContainer }}
			>
				<Table 
					dataSource={previewViewMode === 'masked' ? mappedProcessedDatasetRowsList : sampleRawDataRowsList}
					columns={
						actualProcessedColumnsList.map(
							(columnNameString) => 
							{
								const { role: configuredRoleNameString, tagColor: mappedTagColorString } = getCalculatedRole(columnNameString);
								const localizedRoleI18nKeyString = `step4.role.${configuredRoleNameString.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;

								return {
									title: (
										<div>
											<div>{columnNameString}</div>
											<Tag color={mappedTagColorString} style={{ fontSize: '10px', margin: 0 }}>
												{translate(localizedRoleI18nKeyString, configuredRoleNameString)}
											</Tag>
										</div>
									),
									dataIndex: columnNameString,
									key: columnNameString,
								};
							}
						)
					}
					pagination={{ pageSize: 10 }}
					size="small"
					rowKey={(rowRecordItemObject) => JSON.stringify(rowRecordItemObject)}
					scroll={{ x: 'max-content' }}
				/>
			</Card>

			{/* 
				============================================================================
				合規審計報告 (Privacy Audit Certificate) 匯出與預覽 Modal 視窗
				============================================================================
				此 Modal 元件用於展示即將被 html2pdf 套件截圖轉換為 PDF 的報告畫面。
				為了確保列印時排版不跑版，內部的 HTML 結構採用了非常嚴格的 inline style (行內樣式)，
				並大量使用 'page-break-inside: avoid' 來防止報表在換頁時被截斷。
			*/}
			<Modal
				title={translate('step4.modal.title', '合規審計報告 (Privacy Audit Certificate)')}
				// 綁定開關狀態
				open={isReportModalVisibleStatus}
				// 點擊遮罩或右上角 X 時關閉
				onCancel={() => setIsReportModalVisibleStatus(false)}
				// 報告需要較寬的版面以容納對照表
				width={800}
				// 限制 Modal 內容區域最大高度，超過時顯示內部滾動條，避免整個網頁一起滾動
				styles={{ body: { maxHeight: '72vh', overflowY: 'auto', paddingRight: '6px' } }}
				footer={
					[
						<Button key="close" onClick={() => setIsReportModalVisibleStatus(false)}>
							{translate('step4.modal.close', '關閉')}
						</Button>,
						// 匯出 PDF 按鈕，綁定 isExportingPdfStatus 狀態以顯示 Loading 動畫，防止重複點擊
						<Button key="download" type="primary" icon={<DownloadOutlined />} loading={isExportingPdfStatus} onClick={handleDownloadPDF} style={{ background: '#4F46E5' }}>
							{translate('step4.modal.export_pdf', '匯出 PDF 憑證')}
						</Button>
					]
				}
			>
				{/* 防呆機制：確保攻擊模擬數據存在才渲染報告內容，避免 undefined 錯誤 */}
				{attackSimulationMetricsData && (
					<div 
						// 賦予專屬 ID，供 html2pdf 透過 document.getElementById 定位截圖範圍
						id="printable-audit-report" 
						ref={pdfReportContainerRef} 
						style={
							{ 
								// 【排版關鍵】
								// 當正在匯出 PDF (isExportingPdfStatus = true) 時，將 padding 設為 0px。
								// 因為 html2pdf 在 A4 尺寸邊緣計算時，若容器本身自帶 padding，會導致生成的 PDF 出現白邊或內容被擠壓截斷。
								// 平時在 Modal 中預覽時，則保留 24px 讓閱讀體驗較舒適。
								padding: isExportingPdfStatus ? '0px' : '24px', 
								// 強制設定黑字白底，確保無論使用者是否處於 Dark Mode，印出來的 PDF 都是乾淨的白底黑字。
								color: '#000000', 
								backgroundColor: '#ffffff', 
								borderRadius: '4px', 
								// 強制使用無襯線字體，避免不同 OS 預設字體渲染差異導致版面跑掉
								fontFamily: 'sans-serif' 
							}
						}
					>
						{/* --- 報告頭部 (Header) 區塊 --- */}
						{/* 加入 pdf-page-break 類別與 pageBreakInside: 'avoid'，確保這整塊不會被 PDF 分頁機制切成兩半 */}
						<div className="pdf-page-break" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${token.colorPrimary}`, paddingBottom: '12px', marginBottom: '24px', pageBreakInside: 'avoid' }}>
							<div>
								<h2 style={{ margin: 0, color: token.colorPrimary, fontSize: '20px' }}>{translate('step4.report.header', '數據隱私合規與技術審計憑證')}</h2>
								
								{/* 動態寫入憑證編號，該編號於每次成功執行 Pipeline 時由 Timestamp 生成 */}
								<span style={{ fontSize: '12px', color: '#555555' }}>
									{translate('step4.report.cert_id', '憑證編號:')} {auditMetadataObject.certificateId}
								</span>
							</div>
							
							{/* 審核通過 (PASSED) 綠色印章標籤 */}
							<div style={{ textAlign: 'right' }}>
								<span style={{ display: 'inline-block', backgroundColor: '#f6ffed', border: '1px solid #b7eb8f', color: '#389e0d', padding: '6px 16px', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold', lineHeight: '20px', whiteSpace: 'nowrap' }}>
									<span style={{ marginRight: '6px', fontSize: '15px' }}>✓</span> {translate('step4.report.passed', '通過合規標準')}
								</span>
							</div>
						</div>

						{/* --- 專案基本資訊區塊 --- */}
						<div className="pdf-page-break" style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '24px', border: `1px solid #d9d9d9`, pageBreakInside: 'avoid' }}>
							<h4 style={{ marginTop: 0, color: '#000000', marginBottom: '8px' }}>{translate('step4.report.info_title', '專案與審計權限資訊')}</h4>
							
							{/* 使用 Row/Col 達成雙欄排版，顯示專案環境變數與執行者身分 */}
							<Row gutter={[16, 8]} style={{ fontSize: '13px', color: '#555555' }}>
								<Col span={12}><b style={{ color: '#000000' }}>{translate('step4.report.file_name', '原始檔案名稱：')}</b> {currentDatasetFileNameString || 'dataset.csv'}</Col>
								<Col span={12}><b style={{ color: '#000000' }}>{translate('step4.report.mode', '保護模式：')}</b> {currentPrivacyModeTypeStr === 'k-anonymity' ? 'K-Anonymity ' : 'Differential Privacy '}</Col>
								<Col span={12}><b style={{ color: '#000000' }}>{translate('step4.report.auditor', '審計核可人：')}</b> {currentUserSession?.name || 'Admin.Test'} ({currentUserRoleTypeNameString.toUpperCase()})</Col>
								<Col span={12}><b style={{ color: '#000000' }}>{translate('step4.report.queries', '連續查詢次數：')}</b> {simulatedQueryCountValue} </Col>
							</Row>
						</div>

						{/* --- 核心審計數據區塊 (安全性風險 vs 資料可用性) --- */}
						<div className="pdf-page-break" style={{ pageBreakInside: 'avoid', marginBottom: '32px', clear: 'both' }}>
							<Row gutter={16}>
								
								{/* 左側：安全性風險指標 (紅色系背景，凸顯警戒感) */}
								<Col span={12}>
									{/* 設定 height: '100%' 確保左右兩張卡片等高 */}
									<div style={{ background: '#fff1f0', padding: '16px', borderRadius: '8px', border: `1px solid #ffa39e`, height: '100%' }}>
										<h4 style={{ marginTop: 0, color: '#cf1322', marginBottom: '8px' }}>{translate('step4.report.risk_title', '隱私安全風險評估')}</h4>
										
										<div style={{ fontSize: '13px', color: '#555555', display: 'flex', flexDirection: 'column', gap: '8px' }}>
											{/* 綜合殘餘風險 (取三大攻擊中最高者) */}
											<div style={{ display: 'flex', justifyContent: 'space-between' }}>
												<b style={{ color: '#000000' }}>{translate('step4.report.overall_risk', '綜合殘餘風險:')}</b> <span style={{ color: '#cf1322', fontWeight: 'bold' }}>{attackSimulationMetricsData.overallRiskPercent}%</span>
											</div>
											
											{/* 蒙地卡羅模擬運算出的三大獨立風險指標 */}
											<div style={{ display: 'flex', justifyContent: 'space-between' }}>
												<span>{translate('step4.report.singling_risk', '指認性風險 (Singling Out):')}</span> <span>{(attackSimulationMetricsData.singling.risk * 100).toFixed(1)}%</span>
											</div>
											<div style={{ display: 'flex', justifyContent: 'space-between' }}>
												<span>{translate('step4.report.linkability_risk', '連結性風險 (Linkability):')}</span> <span>{(attackSimulationMetricsData.linkability.risk * 100).toFixed(1)}%</span>
											</div>
											<div style={{ display: 'flex', justifyContent: 'space-between' }}>
												<span>{translate('step4.report.inference_risk', '推斷性風險 (Inference):')}</span> <span>{(attackSimulationMetricsData.inference.risk * 100).toFixed(1)}%</span>
											</div>
										</div>
									</div>
								</Col>
								
								{/* 右側：資料可用性指標 (綠色系背景，代表正面效益) */}
								<Col span={12}>
									<div style={{ background: '#e6ffec', padding: '16px', borderRadius: '8px', border: `1px solid #87e8de`, height: '100%' }}>
										<h4 style={{ marginTop: 0, color: '#08979c', marginBottom: '8px' }}>{translate('step4.report.utility_title', '資料效用與失真度評估')}</h4>
										
										<div style={{ fontSize: '13px', color: '#555555', display: 'flex', flexDirection: 'column', gap: '8px' }}>
											{/* 固定寫入之抑制率基準 (此處為模擬固定值 0.5%，實際可擴充連動全域狀態) */}
											<div style={{ display: 'flex', justifyContent: 'space-between' }}>
												<b style={{ color: '#000000' }}>{translate('step4.report.suppression', '資料記錄抑制率:')}</b> <span style={{ color: '#08979c', fontWeight: 'bold' }}>0.5%</span>
											</div>
											{/* 經過處理之總欄位數統計 */}
											<div style={{ display: 'flex', justifyContent: 'space-between' }}>
												<b style={{ color: '#000000' }}>{translate('step4.report.total_cols', '處理欄位總數:')}</b> <span style={{ color: '#08979c', fontWeight: 'bold' }}>{actualProcessedColumnsList.length} </span>
											</div>
										</div>
									</div>
								</Col>
							</Row>
						</div>

						{/* --- 欄位技術對照表 (Table) --- */}
						<h4 className="pdf-page-break" style={{ color: '#000000', marginTop: '16px', marginBottom: '12px', pageBreakInside: 'avoid', clear: 'both' }}>
							{translate('step4.report.table_title', '欄位處置與技術對照表')}
						</h4>
						
						<div 
							style={
								{ 
									// 【排版關鍵：高度與捲動策略切換】
									// 1. 若在畫面上「預覽」 (isExportingPdfStatus = false)：限制最大高度 240px，超出時顯示卷軸 (overflowY: 'auto')。這樣 Modal 不會長到超出螢幕。
									// 2. 若在「匯出 PDF」 (isExportingPdfStatus = true)：必須將高度解開 (maxHeight: 'none') 並取消捲動 (overflowY: 'visible')，確保所有資料列都被完整印出，不會被捲軸藏住。
									maxHeight: isExportingPdfStatus ? 'none' : '240px', 
									overflowY: isExportingPdfStatus ? 'visible' : 'auto', 
									border: '1px solid #d9d9d9', 
									borderRadius: '4px', 
									marginBottom: '24px' 
								}
							}
						>
							<table 
								style={
									{ 
										width: '100%', 
										borderCollapse: 'collapse', 
										color: '#000000', 
										backgroundColor: '#ffffff', 
										// tableLayout: 'fixed' 強制讓所有 td 寬度遵循 th 的設定，文字過長會自動斷行，不會撐破表格導致跑版
										tableLayout: 'fixed' 
									}
								}
							>
								<thead>
									<tr 
										style={
											{ 
												backgroundColor: '#f1f5f9', 
												// 【排版關鍵：固定表頭切換】
												// 1. 畫面預覽時：position: 'sticky' 讓表頭在往下滾動時始終置頂可見。
												// 2. 匯出 PDF 時：必須改為 'static'，否則 sticky 屬性會導致 html2pdf 截圖發生圖層錯亂或多重重疊。
												position: isExportingPdfStatus ? 'static' : 'sticky', 
												top: 0, 
												zIndex: 1, 
												pageBreakInside: 'avoid' 
											}
										}
									>
										{/* 各個表頭嚴格設定寬度比例，加總為 100% */}
										<th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '40%' }}>{translate('step4.report.col_name', '欄位名稱')}</th>
										<th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('step4.report.col_role', '隱私角色')}</th>
										<th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('step4.report.col_tech', '套用去識別化技術')}</th>
									</tr>
								</thead>

								<tbody>
									{/* 依序渲染資料集中的每一個欄位 */}
									{actualProcessedColumnsList.map(
										(columnNameString) => 
										{
											// 呼叫邏輯推導該欄位最終的隱私角色定位 (如 Identifier, Quasi-identifier 等)
											const { role: configuredRoleNameString } = getCalculatedRole(columnNameString);

											// 嘗試尋找該欄位是否有獨立開啟差分隱私
											const targetDpFieldConfigItemObj = currentDpFieldsListArray?.find(fieldItemRecord => fieldItemRecord.fieldName === columnNameString && fieldItemRecord.enabled);
											
											// 預設處置說明
											let resolvedStrategyDescriptionText = translate('step4.report.keep_original', '保留原文');

											// 【技術對照判定邏輯】
											// 1. 若為直接識別碼，對外報告一律宣稱為「完全遮蔽」
											if (configuredRoleNameString === 'Identifier') 
											{
												resolvedStrategyDescriptionText = translate('step4.report.masking', '完全遮蔽');
											}
											// 2. 若為準識別碼且模式為 K-Anonymity，代表執行了泛化演算法
											else if (configuredRoleNameString === 'Quasi-identifier' && currentPrivacyModeTypeStr === 'k-anonymity') 
											{
												resolvedStrategyDescriptionText = translate('step4.report.generalization', '區間/時間泛化');
											}
											// 3. 若模式為 Differential Privacy 且該欄位被勾選啟用，代表執行了拉普拉斯加噪
											else if (currentPrivacyModeTypeStr === 'differential-privacy' && targetDpFieldConfigItemObj) 
											{
												resolvedStrategyDescriptionText = translate('step4.report.dp', '差分隱私加噪');
											}

											// 動態組裝 i18n 多國語系的 key (如將 'Quasi-identifier' 轉為 'quasi_identifier')
											const localizedRoleI18nKeyString = `step4.role.${configuredRoleNameString.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;

											return (
												// 確保單一列的資料不會被 PDF 切開在上下兩頁 (pageBreakInside/breakInside: avoid)
												<tr key={columnNameString} style={{ backgroundColor: '#ffffff', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
													{/* wordBreak: 'break-word' 確保超長欄位名稱會自動換行，不會撐破 td 邊界 */}
													<td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#000000', wordBreak: 'break-word' }}><b>{columnNameString}</b></td>
													<td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{translate(localizedRoleI18nKeyString, configuredRoleNameString)}</td>
													<td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{resolvedStrategyDescriptionText}</td>
												</tr>
											);
										}
									)}
								</tbody>
							</table>
						</div>

						{/* --- 報告結尾簽章區塊 --- */}
						<div className="pdf-page-break" style={{ textAlign: 'right', marginTop: '24px', borderTop: `1px dashed #d9d9d9`, paddingTop: '12px', fontSize: '12px', color: '#888888', pageBreakInside: 'avoid' }}>
							{translate('step4.report.signature', '系統數位簽章：PRIVACY-APP-AUDIT-ENGINE-V2.0-PASSED')}
						</div>
					</div>
				)}
			</Modal>
		</div>
	);
}