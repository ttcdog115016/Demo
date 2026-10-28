/**
 * ============================================================================
 * 檔案名稱 (File): DifferentialPrivacyMapping.tsx
 * 模組功能 (Description): 差分隱私欄位屬性與邊界對應設定組件 (提供欄位資料型態對映、DP機制開關、裁剪邊界設定、JSON 匯入匯出與智慧推薦功能)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, Table, Select, Button, Input, InputNumber, Switch, theme, Tabs, Space, Tooltip, Alert, DatePicker, App as AntdApp } from 'antd';
import {
	DeleteOutlined, PlusOutlined,
	DatabaseOutlined, CodeOutlined, ThunderboltOutlined, InfoCircleOutlined, CopyOutlined,
	EyeOutlined, EyeInvisibleOutlined, QuestionCircleOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

import { useWorkspaceStore, type DPField, type PreprocessingRule } from '../../store/useWorkspaceStore';
import ConfigFileButtons from './ConfigFileButtons';
import { DP_COLUMN_BUDGETS_REFERENCE } from '../../config/recommendationReferenceConfig';
import {
	resolveIsDateTimeDpField, mapOutOfBoundsStrategyFromBackend, DEFAULT_DATETIME_LOWER_BOUND_DATE, resolveInputNumberStepByDecimals,
	parseDpDateTimeBoundTimestamp, compactDpDateTimeBoundText, DP_DATETIME_BOUND_PICKER_DISPLAY_FORMAT, DP_DATETIME_BOUND_PICKER_TIME_FORMAT
} from '../../utils/dpFieldHelpers';
import { ensureDatasetProfile, useEnsureDatasetProfile, type DatasetProfile } from '../../utils/datasetProfile';
import { inferDpFieldTypeFromProfile } from '../../utils/dpTypeInference';
import { buildBackendConfigDocumentFromWorkspace } from '../../utils/pipelineConfig';
import { parseBackendDpColumnBudgets, type BackendDpColumnBudget } from '../../utils/dpConfigImport';
import { resolveDpFieldRiskRole, isDpFieldSelectableAsRiskSensitive } from '../../utils/riskAssessment';
import { detectConfigPrivacyMode } from '../../utils/configModeDetect';
import { importPreprocessFromConfig } from '../../utils/preprocessConfigImport';
import { applyPreprocessImportToWorkspace, applyRiskImportToWorkspace } from './preprocessImportMessages';
import { importRiskFromConfig } from '../../utils/riskConfigImport';
import { buildDatasetColumnNameSet, isFieldNameInDataset, findFieldsNotInDataset, findDatasetColumnsNotConfigured, describeFieldsNotInDatasetError, normalizeDatasetColumnName } from '../../utils/datasetFieldConsistency';

import { scaleFontSize } from '../../utils/fontScale';
/**
 * 預設隱私參數常數宣告
 */
const DEFAULT_EPSILON_BUDGET = 1.0;
const DEFAULT_DELTA_BUDGET = 1e-5; // ★ 2026-10-28 與後端預設一致
const DEFAULT_NUMERIC_LOWER_BOUND = 0;
const DEFAULT_NUMERIC_UPPER_BOUND = 100;
const DP_RECOMMEND_MINMAX_PARSE_MESSAGE_KEY = 'dp-recommend-minmax-parse';

// ★ 2026-10-05：使用者要求剛進入 DP Step2 時各欄位不預先選好資料型態（一律「請選擇」），
//   改由使用者手動選擇或按「套用系統推薦設定」（會依欄位名稱＋實際資料判斷）。原本依欄位名稱
//   關鍵字預猜型態，猜中的欄位會帶入預設邊界，與使用者實際需要的設定常不一致。
//   （此函式僅在 Store 尚未建立 dpFields 時使用；Store 的 setFileData 亦採相同規則，見 useWorkspaceStore.ts。）
const createInitialDPFields = (columnNameList: string[]): DPField[] => 
{
	return columnNameList.map(
		(columnNameString, columnIndex) => ({
			id: `${columnNameString}-${columnIndex}`,
			fieldName: columnNameString,
			fieldType: 'Unknown',
			enabled: true,
			epsilon: DEFAULT_EPSILON_BUDGET,
			delta: 1e-5,
			allowedCategories: '',
			outOfBoundsStrategy: 'clip'
		})
	);
};

export default function DifferentialPrivacyMapping(): React.ReactElement 
{
	const { token } = theme.useToken();
	const isDarkModeActive = token.colorBgContainer !== '#ffffff';
	const { message: messageApi } = AntdApp.useApp();
	const { t: translate } = useTranslation(); 
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [isJsonPreviewVisibleStatus, setIsJsonPreviewVisibleStatus] = useState<boolean>(false);

	const { 
		columns: datasetColumnsList,
		dpFields: currentDpFieldsList,
		setDpFields: setDpFieldsAction,
		dataFile: uploadedDataFileObj,
		// ★ 新增: 「每個欄位之實際數值資料陣列」快取，改存放於全域 Store (而非元件內部 state)，
		//   使 validateProgression.ts 的跨步驟導航門閥亦能讀取到此快取，據以實際阻擋「下一步」
		//   (詳見下方 datasetColumnNumericValuesMap 之 useEffect 與 boundRangeCoverageInfoMap)。
		datasetColumnNumericValuesMap,
		setDatasetColumnNumericValuesMap: setDatasetColumnNumericValuesMapAction
	} = useWorkspaceStore();
	
	const updateFieldLocal = <AttributeKey extends keyof DPField>(targetFieldIdStr: string, attributeKeyName: AttributeKey, newAttributeValueData: DPField[AttributeKey]): void => 
	{
		useWorkspaceStore.setState(
			(currentStoreState) => 
			(
				{
					dpFields: currentStoreState.dpFields.map(
						(fieldItemRecord) => fieldItemRecord.id === targetFieldIdStr ? { ...fieldItemRecord, [attributeKeyName]: newAttributeValueData } : fieldItemRecord
					)
				}
			)
		);
	};

	useEffect(
		() => 
		{
			if (datasetColumnsList && datasetColumnsList.length > 0 && (!currentDpFieldsList || currentDpFieldsList.length === 0)) 
			{
				const initialDPFieldsArray = createInitialDPFields(datasetColumnsList);
				setDpFieldsAction(initialDPFieldsArray);
			}
		}, 
		[datasetColumnsList, currentDpFieldsList, setDpFieldsAction]
	);

	// ★ 新增: 依「資料型態為數值型的邊界防呆檢查」需求，需要各欄位完整資料 (不受 Step1 上傳時 1000 筆
	//   預覽上限限制) 的實際有效數值陣列，供下方 boundRangeCoverageInfoMap 計算邊界涵蓋率。
	// ★ 2026-09-30：改由 utils/datasetProfile.ts 統一掃描一次並寫入 datasetColumnNumericValuesMap，
	//   不再於本元件另外完整 Papa.parse 一次（同一份檔案在各頁共用同一份結果）。
	useEnsureDatasetProfile();
	useEffect(
		() =>
		{
			if (!uploadedDataFileObj) setDatasetColumnNumericValuesMapAction({});
		},
		[uploadedDataFileObj, setDatasetColumnNumericValuesMapAction]
	);

	// ★ 新增: 「數值型欄位邊界防呆」——比對使用者設定的邊界 (lowerBound/upperBound) 是否涵蓋實際資料的
	//   最大/最小值；若有資料落在邊界範圍之外，記錄超出筆數/總筆數/百分比，供下方驗證與表格提示使用。
	//   已由「下限須嚴格小於上限」檢查涵蓋之欄位 (lowerBound >= upperBound) 不重複判斷，避免混淆。
	const boundRangeCoverageInfoMap = useMemo(
		(): Record<string, { outOfRangeCount: number; totalValidValueCount: number; percentText: string }> => 
		{
			const infoMap: Record<string, { outOfRangeCount: number; totalValidValueCount: number; percentText: string }> = {};

			currentDpFieldsList.forEach(
				(fieldItemRecord) => 
				{
					if (!fieldItemRecord.enabled || fieldItemRecord.fieldType !== 'Numeric') return;
					if (fieldItemRecord.lowerBound === undefined || fieldItemRecord.lowerBound === null || fieldItemRecord.upperBound === undefined || fieldItemRecord.upperBound === null) return;

					const lowerBoundNumValue = Number(fieldItemRecord.lowerBound);
					const upperBoundNumValue = Number(fieldItemRecord.upperBound);
					if (lowerBoundNumValue >= upperBoundNumValue) return;

					const columnRealValuesArray = datasetColumnNumericValuesMap[fieldItemRecord.fieldName];
					if (!columnRealValuesArray || columnRealValuesArray.length === 0) return;

					const outOfRangeValuesCount = columnRealValuesArray.filter((numericValue) => numericValue < lowerBoundNumValue || numericValue > upperBoundNumValue).length;
					if (outOfRangeValuesCount === 0) return;

					const outOfRangePercentNumValue = (outOfRangeValuesCount / columnRealValuesArray.length) * 100;
					infoMap[fieldItemRecord.id] = {
						outOfRangeCount: outOfRangeValuesCount,
						totalValidValueCount: columnRealValuesArray.length,
						percentText: `${outOfRangePercentNumValue.toFixed(1)}%`
					};
				}
			);

			return infoMap;
		}, 
		[currentDpFieldsList, datasetColumnNumericValuesMap]
	);

	const validationStatusResult = useMemo(
		() => 
		{
			let isAllFieldsValidStatus = true;
			let totalErrorFieldsCount = 0;

			currentDpFieldsList.forEach(
				(fieldItemRecord) => 
				{
					if (!fieldItemRecord.enabled) return; 

					let currentFieldHasErrorStatus = false;

					if (!fieldItemRecord.fieldName || fieldItemRecord.fieldName.trim() === '') 
					{
						currentFieldHasErrorStatus = true;
					} 
					else if (fieldItemRecord.fieldType === 'Unknown') 
					{
						currentFieldHasErrorStatus = true;
					} 
					else if (fieldItemRecord.fieldType === 'Numeric')
					{
						if (fieldItemRecord.lowerBound === undefined || fieldItemRecord.upperBound === undefined || fieldItemRecord.lowerBound === null || fieldItemRecord.upperBound === null)
						{
							currentFieldHasErrorStatus = true;
						}
						// ★ 日期時間型欄位（如生日）之邊界為日期字串，Number() 轉換會得到 NaN，NaN 比較一律為 false，
						//   若沿用下方數值比較會讓「下限必須早於上限」的檢查失效；改以日期解析後之時間戳比較。
						else if (resolveIsDateTimeDpField(fieldItemRecord))
						{
							const lowerDateTimestamp = parseDpDateTimeBoundTimestamp(fieldItemRecord.lowerBound);
							const upperDateTimestamp = parseDpDateTimeBoundTimestamp(fieldItemRecord.upperBound);
							if (Number.isNaN(lowerDateTimestamp) || Number.isNaN(upperDateTimestamp) || lowerDateTimestamp >= upperDateTimestamp)
							{
								currentFieldHasErrorStatus = true;
							}
						}
						else if (Number(fieldItemRecord.lowerBound) >= Number(fieldItemRecord.upperBound))
						{
							currentFieldHasErrorStatus = true;
						}
						// ★ 2026-10-19 使用者要求：邊界範圍未涵蓋全部實際資料 (有值落在邊界外) 改為「警告」不計入錯誤、
						//   不阻擋——使用者可能本來就只要特定區間。提示見頁面上方 boundRangeCoverageWarningList。
					}
					else if (fieldItemRecord.fieldType === 'Text') 
					{
						if (!fieldItemRecord.maxLength || Number(fieldItemRecord.maxLength) <= 0) 
						{
							currentFieldHasErrorStatus = true;
						}
					}

					if (currentFieldHasErrorStatus) 
					{
						isAllFieldsValidStatus = false;
						totalErrorFieldsCount++;
					}
				}
			);

			return { isValid: isAllFieldsValidStatus, errorCount: totalErrorFieldsCount };
		}, 
		[currentDpFieldsList]
	);

	// ★ 2026-10-19：邊界未涵蓋全部資料的欄位清單 (僅提醒，不阻擋)，供頁面上方黃色提示使用
	const boundRangeCoverageWarningList = useMemo(
		() => currentDpFieldsList
			.filter((fieldItemRecord) => !!boundRangeCoverageInfoMap[fieldItemRecord.id])
			.map((fieldItemRecord) => ({ fieldName: fieldItemRecord.fieldName, ...boundRangeCoverageInfoMap[fieldItemRecord.id] })),
		[currentDpFieldsList, boundRangeCoverageInfoMap]
	);

	/**
	 * 函數名稱: buildSpecCompliantPreviewJSON
	 * 函數功能: （2026-10-01 起改為直接呼叫 buildBackendConfigDocumentFromWorkspace，以下為原始說明）萃取版本／資料集等識別性中繼資料，
	 *           並依 Open-PETs API 交付文件 config_dp.json 結構，將 column_budgets 與
	 *           accumulated_epsilon／accumulated_delta／default_delta 一併包在 differential_privacy
	 *           區塊底下呈現，供「即時設定檔預覽」使用，避免混入 field_attributes／
	 *           differential_privacy_rules 等本工具內部專用、後端 /api/v1/dp 並不需要的欄位，
	 *           造成預覽格式與實際上傳設定檔（Step4_Result.tsx 送出之 config.json）不一致。
	 *           ★ 使用者反映：預覽先前看不到 accumulated_epsilon／accumulated_delta／default_delta，
	 *           且 accumulated_epsilon／accumulated_delta 應為「跨批次累計」而非每次固定為 0，此處
	 *           改為讀取 Step4 每次執行後更新之 dpAccumulatedEpsilon／dpAccumulatedDelta 累計值。
	 */
	const buildSpecCompliantPreviewJSON = (): Record<string, unknown> =>
		// ★ 2026-10-01：先前預覽另外寫了一套 column_budgets 組裝邏輯，與 Step4 實際送出的內容有多處不同
		//   （類別型也送 delta_budget、ε-DP 模式未把 δ 歸零、文字型欄位被排除、缺 input_format 等）。
		//   改為與實際送出、Step3 匯出共用 utils/pipelineConfig.ts，三者保證一致。
		buildBackendConfigDocumentFromWorkspace({ ...useWorkspaceStore.getState(), privacyMode: 'differential-privacy' }) ?? {};

	// ★ 2026-10-07：欄位清單與上傳資料之一致性 (見 utils/datasetFieldConsistency.ts)
	const datasetColumnNameSet = useMemo(() => buildDatasetColumnNameSet(datasetColumnsList), [datasetColumnsList]);
	const fieldsNotInDatasetNamesList = useMemo(
		() => findFieldsNotInDataset(currentDpFieldsList.map((fieldItemRecord) => fieldItemRecord.fieldName), datasetColumnsList),
		[currentDpFieldsList, datasetColumnsList]
	);
	const datasetColumnsNotConfiguredList = useMemo(
		() => findDatasetColumnsNotConfigured(currentDpFieldsList.map((fieldItemRecord) => fieldItemRecord.fieldName), datasetColumnsList),
		[currentDpFieldsList, datasetColumnsList]
	);

	/**
	 * 函數名稱: applyImportedDpFieldsFilteredByDataset
	 * 函數功能: 匯入設定檔時只保留資料中存在的欄位寫入 Store；略過的欄位以警告訊息告知 (2026-10-07)。
	 *           尚未上傳資料時不過濾。
	 */
	const applyImportedDpFieldsFilteredByDataset = (importedDpFieldsList: DPField[]): void =>
	{
		const keptDpFieldsList = importedDpFieldsList.filter((fieldItemRecord) => isFieldNameInDataset(fieldItemRecord.fieldName, datasetColumnNameSet));
		const skippedFieldNamesList = importedDpFieldsList
			.filter((fieldItemRecord) => !isFieldNameInDataset(fieldItemRecord.fieldName, datasetColumnNameSet))
			.map((fieldItemRecord) => fieldItemRecord.fieldName);
		setDpFieldsAction(keptDpFieldsList);
		if (skippedFieldNamesList.length > 0)
		{
			messageApi.warning(translate('message.import_json_skipped_not_in_dataset', {
				count: skippedFieldNamesList.length,
				names: skippedFieldNamesList.join('、'),
				defaultValue: `已略過 ${skippedFieldNamesList.length} 個資料中沒有的欄位：${skippedFieldNamesList.join('、')}`
			}), 6);
		}
	};

	const handleImportJSON = (fileChangeEventObj: React.ChangeEvent<HTMLInputElement>): void =>
	{
		const targetUploadedFile = fileChangeEventObj.target.files?.[0];
		if (!targetUploadedFile) return;

		const jsonFileReaderInstance = new FileReader();

		jsonFileReaderInstance.onload = (fileReaderEventObj) => 
		{
			try 
			{
				const rawJsonString = (fileReaderEventObj.target?.result as string) || '';
				const cleanedJsonString = rawJsonString.replace(/^[\uFEFF\u200B]+/, '').trim();
				const parsedJsonContentData = JSON.parse(cleanedJsonString);

				// ★ 2026-10-02：K-匿名設定檔不可匯入差分隱私頁面（舊版 K-匿名匯出檔含 field_attributes，先前會被當成主 JSON 匯入）
				if (detectConfigPrivacyMode(parsedJsonContentData) === 'k-anonymity')
				{
					messageApi.error(translate('message.import_json_mode_mismatch_kanon', '此設定檔為「K-匿名化」模式，無法匯入差分隱私欄位設定。請改用差分隱私設定檔，或回到 Step1 切換為 K-匿名化模式後再匯入。'));
					return;
				}

				// ★ 2026-10-28：後端格式的 preprocess 區塊（單一入口 config_preprocess.json、統合版設定檔）。
				//   純前處理設定檔只更新清洗設定，不再落到最後的「JSON 格式不符合規範」。
				const preprocessImportResult = importPreprocessFromConfig(parsedJsonContentData, datasetColumnsList);
				const hasDifferentialPrivacyContent = Array.isArray(parsedJsonContentData) || Boolean(
					parsedJsonContentData.differential_privacy?.column_budgets || parsedJsonContentData.column_budgets ||
					parsedJsonContentData.field_attributes || parsedJsonContentData.privacy_targets?.differential_privacy?.field_mechanisms ||
					parsedJsonContentData.differential_privacy_rules
				);
				// ★ 2026-10-28：統合版／單一入口風險評估設定檔的 risk_attacks／risk_cap 區塊
				const riskImportResult = importRiskFromConfig(parsedJsonContentData, datasetColumnsList);
				if (preprocessImportResult) applyPreprocessImportToWorkspace(preprocessImportResult, messageApi, !hasDifferentialPrivacyContent);
				if (riskImportResult) applyRiskImportToWorkspace(riskImportResult, messageApi);
				// 只有前處理／風險評估區塊的設定檔：到此為止，不可往下走（會讀不到欄位而清空欄位設定，或報格式錯誤）
				if (!hasDifferentialPrivacyContent && (preprocessImportResult || riskImportResult)) return;
				
				type DpRuleItem = {
					id?: string; fieldName?: string; field_name?: string; field?: string;
					fieldType?: DPField['fieldType']; field_type?: DPField['fieldType'];
					enabled?: boolean; mode?: 'epsilon' | 'epsilon-delta';
					epsilon?: number; delta?: number; lowerBound?: number | string; upperBound?: number | string;
					allowedCategories?: string; maxLength?: number; bounds?: { lower?: number; upper?: number };
					allowed_categories?: string[] | string; max_length?: number;
					minimumUnit?: number; noiseStep?: number; outOfBoundsStrategy?: string;
				};

				type FieldMechanismItem = {
					mechanism_type?: string; budget_model?: string; epsilon_budget?: number;
					delta_budget?: number; clipping_bounds?: { min?: number; max?: number };
					out_of_bounds_strategy?: string; rounding_step?: number;
				};

				const baseColumnsForMappingArray = parsedJsonContentData.columns && Array.isArray(parsedJsonContentData.columns) && parsedJsonContentData.columns.length > 0 
					? parsedJsonContentData.columns : datasetColumnsList;

				const columnIndexMappingDict = new Map<string, number>();
				baseColumnsForMappingArray.forEach((columnNameStr: string, indexPositionNumber: number) => {
					columnIndexMappingDict.set(columnNameStr, indexPositionNumber);
				});

				// ★ 相容 Open-PETs API v1.2.0「大包」格式：交付包 config_dp.json 把 column_budgets
				//   包在 differential_privacy 區塊底下（而非頂層），且每欄用的是 epsilon_budget／
				//   delta_budget（非本工具早期匯出格式的 epsilon／delta）。先前只認頂層 column_budgets
				//   且只讀 epsilon／delta，導致交付包設定檔完全匯不進來（連 column_budgets 都找不到），
				//   即使把路徑對上，各欄預算也會因為欄位名稱對不上而全部退回預設值。
				const importedDifferentialPrivacyBlock = parsedJsonContentData.differential_privacy;
				const rawColumnBudgetsSource = importedDifferentialPrivacyBlock?.column_budgets || parsedJsonContentData.column_budgets;

				if (rawColumnBudgetsSource)
				{
					const columnBudgetsMap = rawColumnBudgetsSource as Record<string, BackendDpColumnBudget>;
					const extractedNewFieldsArray: DPField[] = [];
					const importedColumnNamesList = Object.keys(columnBudgetsMap);

					// 逐欄解析見 utils/dpConfigImport.ts（含溢出策略、加噪刻度、敏感度、日期時間型標記）
					parseBackendDpColumnBudgets(columnBudgetsMap).forEach((parsedFieldItem, index) => {
						extractedNewFieldsArray.push({ id: `import_budget_${index}_${Math.random().toString(36).substring(2, 9)}`, ...parsedFieldItem });
					});

					// ★ 核心修正：匯入 JSON 時，絕對不可以去覆蓋 datasetColumnsList，以免毀掉 Step 1 的預覽表格表頭！
					// 只有在系統目前完全沒有 columns (沒上傳過 CSV) 的情況下，才允許使用 JSON 裡的欄位當作預設值。
					useWorkspaceStore.setState({
						columns: (datasetColumnsList && datasetColumnsList.length > 0) ? datasetColumnsList : importedColumnNamesList,
						privacyMode: 'differential-privacy'
					});

					applyImportedDpFieldsFilteredByDataset(extractedNewFieldsArray);
					messageApi.success(translate('message.import_budget_json_success', '成功匯入差分隱私 (DP) 預算設定檔！'));
					return;
				}

				if (Array.isArray(parsedJsonContentData)) 
				{
					const parsedDpRuleArray = (parsedJsonContentData as DpRuleItem[]).map(
						(ruleItemRecord, itemIndexNumber) => {
							const fieldType = ruleItemRecord.fieldType || ruleItemRecord.field_type || 'Unknown';
							return {
								id: ruleItemRecord.id || `dp_col_${itemIndexNumber}_${Date.now()}`,
								fieldName: ruleItemRecord.fieldName || ruleItemRecord.field_name || `column_${itemIndexNumber}`,
								fieldType: fieldType,
								enabled: typeof ruleItemRecord.enabled === 'boolean' ? ruleItemRecord.enabled : true,
								mode: ruleItemRecord.mode || 'epsilon',
								epsilon: ruleItemRecord.epsilon ?? DEFAULT_EPSILON_BUDGET,
								delta: ruleItemRecord.delta ?? DEFAULT_DELTA_BUDGET,
								lowerBound: ruleItemRecord.lowerBound ?? ruleItemRecord.bounds?.lower ?? (fieldType === 'Categorical' ? 0 : undefined),
								upperBound: ruleItemRecord.upperBound ?? ruleItemRecord.bounds?.upper ?? (fieldType === 'Categorical' ? 1 : undefined),
								allowedCategories: fieldType === 'Categorical' ? 'auto_extracted' : (ruleItemRecord.allowedCategories ?? (Array.isArray(ruleItemRecord.allowed_categories) ? ruleItemRecord.allowed_categories.join(',') : '')),
								maxLength: ruleItemRecord.maxLength ?? ruleItemRecord.max_length
							};
						}
					);

					parsedDpRuleArray.sort(
						(firstRuleItem, secondRuleItem) => {
							const firstIndexValue = columnIndexMappingDict.has(firstRuleItem.fieldName) ? columnIndexMappingDict.get(firstRuleItem.fieldName)! : 999;
							const secondIndexValue = columnIndexMappingDict.has(secondRuleItem.fieldName) ? columnIndexMappingDict.get(secondRuleItem.fieldName)! : 999;
							return firstIndexValue - secondIndexValue;
						}
					);

					// 陣列格式沒有 columns 屬性，這裡不需額外處理
					applyImportedDpFieldsFilteredByDataset(parsedDpRuleArray as DPField[]);
					messageApi.success(translate('message.import_array_json_success', '成功匯入欄位設定陣列！'));
					return;
				} 

				if (parsedJsonContentData.field_attributes || parsedJsonContentData.privacy_targets?.differential_privacy?.field_mechanisms || parsedJsonContentData.differential_privacy_rules) 
				{
					const extractedNewFieldsArray: DPField[] = [];
					const parsedFieldAttributesMap = (parsedJsonContentData.field_attributes || {}) as Record<string, { type: string; role: string }>;
					const parsedMechanismMap = (parsedJsonContentData.privacy_targets?.differential_privacy?.field_mechanisms || {}) as Record<string, FieldMechanismItem>;
					const rawDpRulesData = parsedJsonContentData.differential_privacy_rules;
					const dpRulesArrayFormatList = Array.isArray(rawDpRulesData) ? (rawDpRulesData as DpRuleItem[]) : [];
					const dpRulesObjectFormatMap = rawDpRulesData && !Array.isArray(rawDpRulesData) ? (rawDpRulesData as Record<string, DpRuleItem>) : {};

					// ★ 2026-10-01：本工具舊版匯出檔（final_privacy_config_*.json）在差分隱私模式下 field_attributes 為空物件，
					//   欄位只列在 differential_privacy_rules 陣列裡；先前只走訪 field_attributes，一個欄位都讀不到，
					//   畫面只剩初始化的預設值（類型未知、ε=1、無邊界），檔內的 ε／δ／邊界全部遺失。
					//   改為兩者聯集，並讀取各欄的溢出策略／加噪刻度／步階（沒有時套用 privacy_targets 的全域溢出策略）。
					const legacyGlobalOutOfBoundsStrategy = parsedJsonContentData.privacy_targets?.differential_privacy?.out_of_bounds_strategy as string | undefined;
					const legacyFieldNamesList = Array.from(new Set([
						...Object.keys(parsedFieldAttributesMap),
						...dpRulesArrayFormatList.map((ruleItem) => ruleItem.fieldName || ruleItem.field_name || ruleItem.field).filter((fieldNameValue): fieldNameValue is string => Boolean(fieldNameValue)),
						...Object.keys(dpRulesObjectFormatMap)
					]));
					legacyFieldNamesList.forEach(
						(targetFieldNameString, fieldIndexNumber) => 
						{
							const currentAttributeItem = parsedFieldAttributesMap[targetFieldNameString] as { type: string; role: string } | undefined; 
							const currentMechanismItem = parsedMechanismMap[targetFieldNameString]; 
							const currentRuleObjectItem = dpRulesObjectFormatMap[targetFieldNameString];

							const currentRuleArrayItem = dpRulesArrayFormatList.find(
								(ruleItem) => (ruleItem.fieldName || ruleItem.field_name || ruleItem.field) === targetFieldNameString
							);

							let mappedFieldTypeValue: DPField['fieldType'] = 'Unknown';
							if (currentAttributeItem) {
								if (currentAttributeItem.type === 'numeric') mappedFieldTypeValue = 'Numeric';
								else if (currentAttributeItem.type === 'categorical') mappedFieldTypeValue = 'Categorical';
								else if (['string', 'temporal'].includes(currentAttributeItem.type)) mappedFieldTypeValue = currentAttributeItem.role === 'identifier' ? 'Text' : 'Categorical';
							} else {
								mappedFieldTypeValue = currentRuleArrayItem?.fieldType || currentRuleArrayItem?.field_type || currentRuleObjectItem?.fieldType || 'Unknown';
							}

							const hasRuleSettingData = Boolean(currentMechanismItem || currentRuleObjectItem || currentRuleArrayItem);
							let isFieldEnabledStatus = mappedFieldTypeValue !== 'Text' && currentAttributeItem?.role !== 'identifier' && hasRuleSettingData;
							
							const explicitEnabledConfig = currentRuleArrayItem?.enabled ?? currentRuleObjectItem?.enabled;
							if (typeof explicitEnabledConfig === 'boolean') isFieldEnabledStatus = explicitEnabledConfig;

							const calculatedEpsilonValue = currentMechanismItem?.epsilon_budget ?? currentRuleArrayItem?.epsilon ?? currentRuleObjectItem?.epsilon ?? DEFAULT_EPSILON_BUDGET;
							const calculatedDeltaValue = currentMechanismItem?.delta_budget ?? currentRuleArrayItem?.delta ?? currentRuleObjectItem?.delta ?? DEFAULT_DELTA_BUDGET;
							const calculatedModeValue: 'epsilon' | 'epsilon-delta' = (calculatedDeltaValue && calculatedDeltaValue > 0) ? 'epsilon-delta' : 'epsilon';
							
							let calculatedLowerBoundValue = currentMechanismItem?.clipping_bounds?.min ?? currentRuleArrayItem?.lowerBound ?? currentRuleArrayItem?.bounds?.lower ?? currentRuleObjectItem?.lowerBound ?? currentRuleObjectItem?.bounds?.lower;
							let calculatedUpperBoundValue = currentMechanismItem?.clipping_bounds?.max ?? currentRuleArrayItem?.upperBound ?? currentRuleArrayItem?.bounds?.upper ?? currentRuleObjectItem?.upperBound ?? currentRuleObjectItem?.bounds?.upper;

							if (mappedFieldTypeValue === 'Categorical') {
								if (calculatedLowerBoundValue === undefined) calculatedLowerBoundValue = 0;
								if (calculatedUpperBoundValue === undefined) calculatedUpperBoundValue = 1;
							}

							let calculatedAllowedCategoriesValue = 'auto_extracted';
							if (mappedFieldTypeValue !== 'Categorical') {
								calculatedAllowedCategoriesValue = currentRuleArrayItem?.allowedCategories ?? currentRuleObjectItem?.allowedCategories ?? '';
							}

							extractedNewFieldsArray.push({
								id: currentRuleArrayItem?.id || `import_${fieldIndexNumber}_${Math.random().toString(36).substring(2, 9)}`,
								fieldName: targetFieldNameString,
								fieldType: mappedFieldTypeValue,
								enabled: isFieldEnabledStatus,
								mode: calculatedModeValue,
								epsilon: calculatedEpsilonValue,
								delta: calculatedDeltaValue,
								lowerBound: calculatedLowerBoundValue,
								upperBound: calculatedUpperBoundValue,
								allowedCategories: calculatedAllowedCategoriesValue,
								maxLength: currentRuleArrayItem?.maxLength ?? currentRuleObjectItem?.maxLength,
								...(mappedFieldTypeValue === 'Numeric' ? {
									minimumUnit: currentRuleArrayItem?.minimumUnit ?? currentRuleObjectItem?.minimumUnit,
									noiseStep: currentRuleArrayItem?.noiseStep ?? currentRuleObjectItem?.noiseStep,
									outOfBoundsStrategy: mapOutOfBoundsStrategyFromBackend(
										currentRuleArrayItem?.outOfBoundsStrategy ?? currentRuleObjectItem?.outOfBoundsStrategy ?? currentMechanismItem?.out_of_bounds_strategy ?? legacyGlobalOutOfBoundsStrategy
									)
								} : {})
							});
						}
					);

					extractedNewFieldsArray.sort(
						(firstExtractedField, secondExtractedField) => {
							const firstIndexValue = columnIndexMappingDict.has(firstExtractedField.fieldName) ? columnIndexMappingDict.get(firstExtractedField.fieldName)! : 999;
							const secondIndexValue = columnIndexMappingDict.has(secondExtractedField.fieldName) ? columnIndexMappingDict.get(secondExtractedField.fieldName)! : 999;
							return firstIndexValue - secondIndexValue;
						}
					);

					// 舊版匯出格式的 preprocessing_rules；已讀到後端 preprocess 區塊時以後者為準
					if (!preprocessImportResult && parsedJsonContentData.preprocessing_rules)
					{
						// ★ 相容匯入舊版單一策略物件格式 ({action, param})，統一正規化為新版多策略陣列格式 ({action, params})
						const rawImportedPreprocessingRulesMap = parsedJsonContentData.preprocessing_rules as Record<string, unknown>;
						const normalizedImportedPreprocessingRulesMap: Record<string, PreprocessingRule[]> = {};

						Object.keys(rawImportedPreprocessingRulesMap).forEach((columnNameKeyStr) => {
							const rawRuleValue = rawImportedPreprocessingRulesMap[columnNameKeyStr];
							const rawRuleArray = Array.isArray(rawRuleValue) ? rawRuleValue : [rawRuleValue];

							normalizedImportedPreprocessingRulesMap[columnNameKeyStr] = rawRuleArray.map((rawStepItemData) => {
								const rawStepObj = rawStepItemData as { action?: string; param?: string; params?: Record<string, string | number> };
								return {
									action: rawStepObj.action || 'none',
									params: rawStepObj.params ?? (rawStepObj.param !== undefined ? { legacyParam: rawStepObj.param } : {})
								};
							});
						});

						useWorkspaceStore.setState({
							preprocessingRules: normalizedImportedPreprocessingRulesMap
						});
					}

					const globalDeltaConfigValue = parsedJsonContentData.privacy_targets?.differential_privacy?.global_delta ?? parsedJsonContentData.privacy_targets?.differential_privacy?.global_target_delta;
					const globalEpsilonConfigValue = parsedJsonContentData.privacy_targets?.differential_privacy?.global_epsilon ?? parsedJsonContentData.privacy_targets?.differential_privacy?.budget_limit;
					
					if (globalDeltaConfigValue !== undefined) useWorkspaceStore.setState({ targetDelta: globalDeltaConfigValue });
					if (globalEpsilonConfigValue !== undefined) useWorkspaceStore.setState({ budgetLimitEpsilon: globalEpsilonConfigValue });

					applyImportedDpFieldsFilteredByDataset(extractedNewFieldsArray);
					messageApi.success(translate('message.import_master_json_success', '成功匯入隱私設定檔！'));
				} 
				else 
				{
					messageApi.error(translate('message.import_json_format_error', 'JSON 格式不符合規範！'));
				}
			} 
			catch (jsonParsingErrorExecution) 
			{
				console.error("JSON Import Error:", jsonParsingErrorExecution);
				messageApi.error(translate('message.import_json_error', '解析 JSON 檔案失敗！'));
			} 
			finally 
			{
				if (fileInputRef.current) fileInputRef.current.value = ''; 
			}
		};

		jsonFileReaderInstance.readAsText(targetUploadedFile);
	};

	// ★ 使用者反映：「自動智慧推薦」按鈕是整份重新推薦，會連帶把其他已經設定好的欄位一併
	//   改掉，但使用者常常只是想針對「這一個」欄位（例如重複欄名之一、或邊界防呆警示的那一
	//   欄）重新套用建議設定，不想波及其他已調整過的欄位。原本這段逐欄判斷邏輯是寫在
	//   handleApplyRecommendations 的 .map() 內、無法單獨對一個欄位呼叫，故抽出成獨立函式，
	//   供下方 handleApplyRecommendations（套用到全部欄位）與新增的
	//   handleApplyRecommendationToSingleField（只套用到單一欄位）共用同一份判斷邏輯，
	//   避免兩處各自維護一份、日後改一邊忘了改另一邊。
	const computeRecommendedFieldSettings = (fieldItemRecord: DPField, datasetProfileData?: DatasetProfile | null): { updatedField: DPField; isUnmatched: boolean } =>
	{
		const lowerCaseFieldNameStr = fieldItemRecord.fieldName.toLowerCase();

		let recommendedIsEnabledStatus = fieldItemRecord.enabled;
		let recommendedFieldTypeVal = fieldItemRecord.fieldType;
		let recommendedLowerBoundVal = fieldItemRecord.lowerBound;
		let recommendedUpperBoundVal = fieldItemRecord.upperBound;
		let recommendedEpsilonVal = fieldItemRecord.epsilon;
		let recommendedDeltaVal = fieldItemRecord.delta;
		const recommendedOutOfBoundsStrategyVal = fieldItemRecord.outOfBoundsStrategy ?? 'clip';
		let recommendedMinimumUnitVal = fieldItemRecord.minimumUnit;
		let recommendedNoiseStepVal = fieldItemRecord.noiseStep;
		let isFieldUnmatchedStatus = false;
		let recommendedIsDateTimeVal = fieldItemRecord.isDateTime;

		// ★ 新增: 欄位名稱若與「套用系統推薦設定」參考設定檔 (config_dp.json) 之欄位名稱完全相符，
		//   優先套用該參考設定所指定之資料型態／Epsilon／Delta／敏感度等參數（使用者已確認採「精確欄位
		//   名稱優先，其餘用關鍵字判斷」之套用方式），不再套用下方關鍵字判斷。
		const matchedDpReferenceItem = DP_COLUMN_BUDGETS_REFERENCE[fieldItemRecord.fieldName.trim()];

		if (matchedDpReferenceItem)
		{
			// ★ 沿用「匯入配置」JSON 解析既有慣例：continuous／numeric／datetime 一律歸類為數值型，
			//   並以 sensitivity 推算裁剪上限 (下限固定為 0)；categorical 歸類為類別型；其餘歸類為文字型。
			const normalizedReferenceTypeStr = String(matchedDpReferenceItem.type || '').toLowerCase();
			const isReferenceDateTimeType = normalizedReferenceTypeStr === 'datetime';

			if (['continuous', 'numeric', 'datetime'].includes(normalizedReferenceTypeStr))
			{
				recommendedFieldTypeVal = 'Numeric';

				// ★ 日期時間型欄位（如生日）之邊界應為日期字串，不可沿用「0 + sensitivity」的數值推算方式，
				//   否則會產生 1970-01-01 起算的無意義日期。
				if (isReferenceDateTimeType)
				{
					recommendedLowerBoundVal = DEFAULT_DATETIME_LOWER_BOUND_DATE;
					recommendedUpperBoundVal = new Date().toISOString().slice(0, 10);
					recommendedNoiseStepVal = 7;
					recommendedMinimumUnitVal = undefined;
				}
				else
				{
					recommendedLowerBoundVal = 0;
					recommendedUpperBoundVal = matchedDpReferenceItem.sensitivity !== undefined ? recommendedLowerBoundVal + matchedDpReferenceItem.sensitivity : DEFAULT_NUMERIC_UPPER_BOUND;
					recommendedMinimumUnitVal = 1;
					recommendedNoiseStepVal = undefined;
				}
			}
			else if (normalizedReferenceTypeStr === 'categorical')
			{
				recommendedFieldTypeVal = 'Categorical';
				recommendedLowerBoundVal = 0;
				recommendedUpperBoundVal = 1;
			}
			else
			{
				recommendedFieldTypeVal = 'Text';
			}

			recommendedIsEnabledStatus = recommendedFieldTypeVal !== 'Text';
			recommendedEpsilonVal = matchedDpReferenceItem.epsilon;
			recommendedDeltaVal = matchedDpReferenceItem.delta ?? recommendedDeltaVal;
		}
		// ★ 修正: 原本只比對英文關鍵字，中文命名的欄位（如「薪資」「年齡」）完全比對不到，導致這些欄位點擊後仍維持未設定；此處加入常見中文關鍵字以涵蓋中文命名的資料集。
		// ★ 修正: 使用者更正——生日應歸類為數值型，故將 birthday/生日 等關鍵字移至此數值判斷區間，
		//   不再與姓名／電話等身分類欄位放在一起。
		else if (/(salary|income|fare|credit|amount|ratio|score|age|mins|count|duration|birthday|birth_date|dob|薪資|收入|所得|金額|費用|分數|年齡|次數|時長|比率|信用|價格|生日|出生日期)/.test(lowerCaseFieldNameStr))
		{
			recommendedIsEnabledStatus = true;
			recommendedFieldTypeVal = 'Numeric';

			if (resolveIsDateTimeDpField(fieldItemRecord))
			{
				if (recommendedLowerBoundVal === undefined) recommendedLowerBoundVal = DEFAULT_DATETIME_LOWER_BOUND_DATE;
				if (recommendedUpperBoundVal === undefined) recommendedUpperBoundVal = new Date().toISOString().slice(0, 10);
				if (recommendedNoiseStepVal === undefined) recommendedNoiseStepVal = 7;
				recommendedMinimumUnitVal = undefined;
			}
			else
			{
				if (recommendedLowerBoundVal === undefined) recommendedLowerBoundVal = DEFAULT_NUMERIC_LOWER_BOUND;
				if (recommendedUpperBoundVal === undefined) recommendedUpperBoundVal = DEFAULT_NUMERIC_UPPER_BOUND;
				if (recommendedMinimumUnitVal === undefined) recommendedMinimumUnitVal = 1;
				recommendedNoiseStepVal = undefined;
			}
		}
		else if (/(disease|gender|zipcode|station|city|region|type|category|job|occupation|marital|marriage|疾病|性別|郵遞區號|地區|城市|縣市|國家|類型|類別|職業|婚姻狀況|婚姻)/.test(lowerCaseFieldNameStr))
		{
			recommendedIsEnabledStatus = true;
			recommendedFieldTypeVal = 'Categorical';

			if (recommendedLowerBoundVal === undefined) recommendedLowerBoundVal = 0;
			if (recommendedUpperBoundVal === undefined) recommendedUpperBoundVal = 1;
		}
		else if (/(id|name|phone|email|姓名|電話|手機|信箱|電子郵件|身分證|統一編號|地址)/.test(lowerCaseFieldNameStr))
		{
			recommendedIsEnabledStatus = false;
			recommendedFieldTypeVal = 'Text';
		}
		else
		{
			// ★ 2026-10-05：欄位名稱判斷不出來時，比照 K-匿名改讀實際資料判斷型態（見 utils/dpTypeInference.ts）。
			//   原本只要名稱沒命中就跳「無法自動判斷，請手動設定」，像 bmi、人種、教育水平都要手動選。
			const inferredFieldTypeResult = inferDpFieldTypeFromProfile(datasetProfileData, fieldItemRecord.fieldName);
			if (inferredFieldTypeResult)
			{
				recommendedFieldTypeVal = inferredFieldTypeResult.fieldType;
				recommendedIsDateTimeVal = inferredFieldTypeResult.isDateTime;
				recommendedIsEnabledStatus = inferredFieldTypeResult.fieldType !== 'Text';
				if (inferredFieldTypeResult.fieldType === 'Numeric' && inferredFieldTypeResult.isDateTime)
				{
					recommendedLowerBoundVal = DEFAULT_DATETIME_LOWER_BOUND_DATE;
					recommendedUpperBoundVal = new Date().toISOString().slice(0, 10);
					recommendedNoiseStepVal = 7;
					recommendedMinimumUnitVal = undefined;
				}
				else if (inferredFieldTypeResult.fieldType === 'Numeric')
				{
					// 實際最小／最大值由 handleApplyRecommendations／applyRealDataBoundsToSingleNumericField 接著帶入
					recommendedLowerBoundVal = DEFAULT_NUMERIC_LOWER_BOUND;
					recommendedUpperBoundVal = DEFAULT_NUMERIC_UPPER_BOUND;
					recommendedMinimumUnitVal = recommendedMinimumUnitVal ?? 1;
					recommendedNoiseStepVal = undefined;
				}
				else if (inferredFieldTypeResult.fieldType === 'Categorical')
				{
					recommendedLowerBoundVal = 0;
					recommendedUpperBoundVal = 1;
				}
			}
			else if (recommendedFieldTypeVal === 'Unknown' || recommendedFieldTypeVal === undefined)
			{
				// 資料集尚未掃描或整欄皆空，仍無法判斷：記錄下來，供後面決定提示訊息使用。
				isFieldUnmatchedStatus = true;
			}
		}

		return {
			updatedField: {
				...fieldItemRecord,
				enabled: recommendedIsEnabledStatus,
				fieldType: recommendedFieldTypeVal !== 'Unknown' ? recommendedFieldTypeVal : fieldItemRecord.fieldType,
				epsilon: recommendedEpsilonVal,
				delta: recommendedDeltaVal,
				lowerBound: recommendedLowerBoundVal,
				upperBound: recommendedUpperBoundVal,
				allowedCategories: recommendedFieldTypeVal === 'Categorical' ? 'auto_extracted' : fieldItemRecord.allowedCategories,
				outOfBoundsStrategy: recommendedOutOfBoundsStrategyVal,
				minimumUnit: recommendedMinimumUnitVal,
				noiseStep: recommendedNoiseStepVal,
				...(recommendedIsDateTimeVal !== undefined ? { isDateTime: recommendedIsDateTimeVal } : {})
			},
			isUnmatched: isFieldUnmatchedStatus
		};
	};

	// ★ 2026-10-01：日期時間型欄位改用資料集掃描到的最早／最晚日期當推薦邊界（datasetProfile.dateTimeRanges）。
	//   先前日期欄位不在數值快取裡、推薦時直接跳過，邊界一直停在預設的 1930-01-01～今天，看起來按了沒反應。
	//   資料中找不到可解析的日期時才維持原本的邊界。
	const applyRealDateTimeBounds = (fieldItemRecord: DPField, dateTimeRangesMap: Record<string, { min: string; max: string }> | undefined): DPField =>
	{
		const dateTimeRange = dateTimeRangesMap?.[fieldItemRecord.fieldName.replace(/^[\uFEFF\u200B]+/, '').trim()];
		if (!dateTimeRange || dateTimeRange.min === dateTimeRange.max) return fieldItemRecord;
		return { ...fieldItemRecord, lowerBound: dateTimeRange.min, upperBound: dateTimeRange.max };
	};

	// ★ 新增：只把「已快取的實際資料範圍」(datasetColumnNumericValuesMap，見上方 useEffect)
	//   套用到單一數值型欄位，跟「切換資料型態」下拉選單時已採用的做法一致（見下方欄位表格
	//   fieldType 欄 onChange），不需要重新解析整份檔案，也不會動到其他欄位。日期時間型欄位
	//   改用 datasetProfile.dateTimeRanges 的最早／最晚日期（見 applyRealDateTimeBounds）。
	const applyRealDataBoundsToSingleNumericField = (fieldItemRecord: DPField): DPField =>
	{
		if (fieldItemRecord.fieldType !== 'Numeric') return fieldItemRecord;
		if (resolveIsDateTimeDpField(fieldItemRecord)) return applyRealDateTimeBounds(fieldItemRecord, useWorkspaceStore.getState().datasetProfile?.dateTimeRanges);

		const realColumnValuesArray = datasetColumnNumericValuesMap[fieldItemRecord.fieldName];
		if (!realColumnValuesArray || realColumnValuesArray.length === 0) return fieldItemRecord;

		let computedRealMinValue = realColumnValuesArray[0];
		let computedRealMaxValue = realColumnValuesArray[0];
		for (let valueIndexNumber = 1; valueIndexNumber < realColumnValuesArray.length; valueIndexNumber++)
		{
			const currentRealValue = realColumnValuesArray[valueIndexNumber];
			if (currentRealValue < computedRealMinValue) computedRealMinValue = currentRealValue;
			if (currentRealValue > computedRealMaxValue) computedRealMaxValue = currentRealValue;
		}

		return { ...fieldItemRecord, lowerBound: Math.floor(computedRealMinValue), upperBound: Math.ceil(computedRealMaxValue) };
	};

	// ★ 新增：只針對「這一個」欄位重新套用推薦設定（型態／Epsilon／Delta／邊界），完全不
	//   會動到其他欄位目前的設定，解決使用者反映「只想修好其中一欄，卻得整份重推、把其他
	//   已經調好的欄位也一起改掉」的問題。
	const handleApplyRecommendationToSingleField = (targetFieldIdStr: string): void =>
	{
		const targetFieldItemRecord = currentDpFieldsList.find(fieldItemRecord => fieldItemRecord.id === targetFieldIdStr);
		if (!targetFieldItemRecord) return;

		const { updatedField, isUnmatched } = computeRecommendedFieldSettings(targetFieldItemRecord, useWorkspaceStore.getState().datasetProfile);
		const finalUpdatedFieldRecord = applyRealDataBoundsToSingleNumericField(updatedField);

		setDpFieldsAction(
			currentDpFieldsList.map(fieldItemRecord => fieldItemRecord.id === targetFieldIdStr ? finalUpdatedFieldRecord : fieldItemRecord)
		);

		if (isUnmatched)
		{
			messageApi.warning(`系統無法自動判斷「${targetFieldItemRecord.fieldName || '此欄位'}」的資料類型，請手動設定。`);
		}
		else
		{
			messageApi.success(`已為「${targetFieldItemRecord.fieldName || '此欄位'}」套用建議設定，其他欄位設定不受影響。`);
		}
	};

	const handleApplyRecommendations = (): void =>
	{
		// ★ 修正: 欄位設定清單為空（例如使用者已刪除所有欄位）時沒有任何可套用推薦設定的對象，
		//   若仍照原本邏輯繼續往下跑，map() 對空陣列自然毫無變化，但最終仍會顯示籠統的「已成功套用」
		//   訊息，讓使用者誤以為套用了什麼設定；因此提前判斷並改為提示使用者先新增欄位。
		if (currentDpFieldsList.length === 0)
		{
			messageApi.warning('目前沒有任何欄位可套用推薦設定，請先新增欄位。');
			return;
		}

		// ★ 2026-10-05：先取得整份資料集的欄位統計（已掃描過就直接取用），名稱判斷不出型態的欄位改讀實際資料判斷，
		//   數值型欄位的邊界也一併取實際最小／最大值。原本只有「有數值型欄位」時才讀資料，且只用來算邊界。
		const runRecommendationWithProfile = (datasetProfileResult: DatasetProfile | null): void =>
		{
			// ★ 修正: 記錄仍無法自動判斷類型的欄位（例如整欄皆空），以便提示使用者手動設定，而不是畫面毫無變化卻仍顯示「已套用」。
			const unmatchedFieldNameList: string[] = [];

			const recommendedUpdatedFieldsArray = currentDpFieldsList.map(
				(fieldItemRecord) =>
				{
					const { updatedField, isUnmatched } = computeRecommendedFieldSettings(fieldItemRecord, datasetProfileResult);
					if (isUnmatched) unmatchedFieldNameList.push(fieldItemRecord.fieldName);
					return updatedField;
				}
			);

			// ★ 新增: 使用者要求「數值型欄位的邊界／敏感度」預設值一律改為讀取實際資料集的最大／最小值，
			//   取代先前依關鍵字或參考設定檔 sensitivity 推算、或固定 0~100 之預設值（所有數值型欄位皆比照辦理）。
			const fieldsWithDataDrivenBoundsArray = recommendedUpdatedFieldsArray.map(
				(fieldItemRecord) =>
				{
					if (fieldItemRecord.fieldType !== 'Numeric' || !datasetProfileResult) return fieldItemRecord;
					if (resolveIsDateTimeDpField(fieldItemRecord)) return applyRealDateTimeBounds(fieldItemRecord, datasetProfileResult.dateTimeRanges);

					const columnNumericValuesArray = datasetProfileResult.numericValues[fieldItemRecord.fieldName.replace(/^[\uFEFF\u200B]+/, '').trim()] || [];
					// ★ 若整欄找不到任何有效數值 (例如欄位實際為空或格式異常)，則保留原本 (關鍵字/參考設定檔) 算出之邊界，避免寫入無意義的 ±Infinity。
					if (columnNumericValuesArray.length === 0) return fieldItemRecord;

					// 逐筆比較求最小／最大值（大量資料時 Math.min(...陣列) 會因參數過多而 RangeError）
					let computedMinValue = Number.POSITIVE_INFINITY;
					let computedMaxValue = Number.NEGATIVE_INFINITY;
					for (const numericValue of columnNumericValuesArray)
					{
						if (numericValue < computedMinValue) computedMinValue = numericValue;
						if (numericValue > computedMaxValue) computedMaxValue = numericValue;
					}

					return { ...fieldItemRecord, lowerBound: Math.floor(computedMinValue), upperBound: Math.ceil(computedMaxValue) };
				}
			);

			setDpFieldsAction(fieldsWithDataDrivenBoundsArray);

			// ★ 修正: 依實際比對結果顯示對應訊息，避免畫面毫無變化卻仍顯示成功訊息。
			if (unmatchedFieldNameList.length === 0)
			{
				messageApi.success(translate('message.apply_recommend_dp_success', '已成功套用智慧推薦設定！'));
			}
			else if (unmatchedFieldNameList.length === recommendedUpdatedFieldsArray.length)
			{
				messageApi.warning('系統無法自動判斷任何欄位的資料類型，請手動選擇各欄位的「資料型態」。');
			}
			else
			{
				messageApi.warning(`已為部分欄位套用推薦設定，以下欄位無法自動判斷，請手動設定：${unmatchedFieldNameList.join('、')}`);
			}
		};

		const rawUploadedDataFileObj = useWorkspaceStore.getState().dataFile;
		if (!rawUploadedDataFileObj)
		{
			// 無原始檔案可供讀取（例如只匯入設定檔、未上傳資料），只能依欄位名稱判斷。
			runRecommendationWithProfile(null);
			return;
		}

		messageApi.loading({ content: '正在讀取資料集，判斷各欄位資料型態與數值範圍...', key: DP_RECOMMEND_MINMAX_PARSE_MESSAGE_KEY, duration: 0 });

		// ★ 2026-09-30：改用 utils/datasetProfile.ts 的共用掃描結果（已掃描過就直接取用，不再重新完整解析整份檔案）。
		ensureDatasetProfile(rawUploadedDataFileObj)
			.then((datasetProfileResult) =>
			{
				messageApi.destroy(DP_RECOMMEND_MINMAX_PARSE_MESSAGE_KEY);
				runRecommendationWithProfile(datasetProfileResult);
			})
			.catch(() =>
			{
				messageApi.destroy(DP_RECOMMEND_MINMAX_PARSE_MESSAGE_KEY);
				messageApi.warning('讀取資料集失敗，只能依欄位名稱判斷型態並套用預設邊界值，請手動確認。');
				runRecommendationWithProfile(null);
			});
	};

	// ★ 2026-10-07：「新增自訂欄位」只能加回資料中尚未設定的欄位 (預設帶入第一個缺漏欄位，可再用下拉切換)；
	//   全部欄位都已設定時按鈕停用。尚未上傳資料時維持原本新增空白列的行為。
	const addField = (): void => 
	{
		if (datasetColumnsList.length > 0)
		{
			const nextColumnNameString = datasetColumnsNotConfiguredList[0];
			if (!nextColumnNameString) return;
			const [initialDpFieldObj] = createInitialDPFields([nextColumnNameString]);
			setDpFieldsAction([...currentDpFieldsList, { ...initialDpFieldObj, id: `custom_${Date.now()}` }]);
			return;
		}

		const manuallyAddedNewFieldObj: DPField = {
			id: `custom_${Date.now()}`,
			fieldName: '',
			fieldType: 'Unknown',
			enabled: true,
			mode: 'epsilon',
			epsilon: DEFAULT_EPSILON_BUDGET,
			delta: DEFAULT_DELTA_BUDGET
		};

		setDpFieldsAction([...currentDpFieldsList, manuallyAddedNewFieldObj]);
	};

	// 一鍵移除資料中不存在的欄位
	const removeFieldsNotInDataset = (): void =>
	{
		const removedFieldCount = fieldsNotInDatasetNamesList.length;
		setDpFieldsAction(currentDpFieldsList.filter((fieldItemRecord) => isFieldNameInDataset(fieldItemRecord.fieldName, datasetColumnNameSet) || normalizeDatasetColumnName(fieldItemRecord.fieldName) === ''));
		messageApi.success(translate('step2.removed_fields_not_in_dataset', { count: removedFieldCount, defaultValue: `已移除 ${removedFieldCount} 個資料中不存在的欄位` }));
	};

	// 一鍵補上資料中有、但設定清單尚未涵蓋的欄位：以「未啟用 DP」加入 (與補上前的實際行為相同——不加噪)，由使用者自行決定是否啟用
	const addDatasetColumnsNotConfigured = (): void =>
	{
		if (datasetColumnsNotConfiguredList.length === 0) return;
		const timestampNumber = Date.now();
		setDpFieldsAction([
			...currentDpFieldsList,
			...createInitialDPFields(datasetColumnsNotConfiguredList).map((fieldItemRecord, fieldIndexNumber) => ({ ...fieldItemRecord, id: `custom_${timestampNumber}_${fieldIndexNumber}`, enabled: false }))
		]);
	};

	/**
	 * 函數名稱: handleRiskSensitiveToggle
	 * 函數功能: 點選／取消單一欄位為風險評估敏感欄位；可複數點選（2026-10-02），Step4 每輪只以其中 1 個評估。
	 */
	const handleRiskSensitiveToggle = (targetFieldIdStr: string, isCheckedStatus: boolean): void =>
	{
		setDpFieldsAction(
			currentDpFieldsList.map((fieldItemRecord) =>
			{
				if (fieldItemRecord.id === targetFieldIdStr) return { ...fieldItemRecord, isRiskSensitive: isCheckedStatus };
				return fieldItemRecord;
			})
		);
	};

	// ★ 2026-10-02：防呆——不能當敏感欄位的欄位（文字型／日期時間型／未選型態）若殘留敏感欄位點選
	//   （例如舊工作區狀態、匯入設定檔或套用推薦設定後型態改變），開關已被停用無法手動取消，在此自動清除
	useEffect(() =>
	{
		if (!currentDpFieldsList.some((fieldItemRecord) => fieldItemRecord.isRiskSensitive && !isDpFieldSelectableAsRiskSensitive(fieldItemRecord))) return;
		setDpFieldsAction(
			currentDpFieldsList.map((fieldItemRecord) =>
				fieldItemRecord.isRiskSensitive && !isDpFieldSelectableAsRiskSensitive(fieldItemRecord)
					? { ...fieldItemRecord, isRiskSensitive: false }
					: fieldItemRecord
			)
		);
	}, [currentDpFieldsList, setDpFieldsAction]);

	// 敏感欄位點選狀態即時摘要（表格上方提示列使用）
	const designatedRiskSensitiveFieldsList = currentDpFieldsList.filter((fieldItemRecord) => fieldItemRecord.isRiskSensitive);
	const designatedRiskSensitiveNamesText = designatedRiskSensitiveFieldsList
		.map((fieldItemRecord) => `「${fieldItemRecord.fieldName}」${fieldItemRecord.enabled ? '（已加噪）' : '（未加噪，以原值評估）'}`)
		.join('、');
	const riskQuasiIdentifierFieldsCount = currentDpFieldsList.filter((fieldItemRecord) => resolveDpFieldRiskRole(fieldItemRecord) === 'quasi_identifier').length;
	const autoRiskSensitiveCandidatesCount = currentDpFieldsList.filter((fieldItemRecord) => resolveDpFieldRiskRole(fieldItemRecord) !== 'none' && fieldItemRecord.fieldType === 'Categorical').length;

	const removeField = (targetFieldIdStr: string): void => 
	{
		setDpFieldsAction(currentDpFieldsList.filter(fieldItemRecord => fieldItemRecord.id !== targetFieldIdStr));
	};

	const dpDataTableColumnsConfig = [
		{
			title: translate('step2.col_name', '欄位名稱'),
			dataIndex: 'fieldName',
			key: 'fieldName',
			width: '10em',
			render: (fieldNameTextValue: string, rowRecordItem: DPField) => (
				<Tooltip title={!isFieldNameInDataset(fieldNameTextValue, datasetColumnNameSet) ? translate('step2.field_not_in_dataset_tooltip', '上傳的資料中沒有這個欄位，執行時不會被處理。請刪除此列或改選資料中的欄位。') : fieldNameTextValue} placement="topLeft" mouseEnterDelay={0.3}>
					{datasetColumnsList.length > 0 ? (
						// ★ 2026-10-07：欄位名稱改為只能從上傳資料的欄位中選擇 (排除其他列已設定者)；
						//   資料中不存在的舊名稱 (例如匯入的設定) 仍顯示並標紅。
						<Select
							value={fieldNameTextValue || undefined}
							onChange={(selectedColumnNameStr: string) => updateFieldLocal(rowRecordItem.id, 'fieldName', selectedColumnNameStr)}
							placeholder={translate('step2.select_field_name_placeholder', '選擇欄位')}
							status={!fieldNameTextValue || !isFieldNameInDataset(fieldNameTextValue, datasetColumnNameSet) ? 'error' : ''}
							style={{ width: '100%' }}
							popupMatchSelectWidth={false}
							options={[
								...(fieldNameTextValue && !isFieldNameInDataset(fieldNameTextValue, datasetColumnNameSet)
									? [{ value: fieldNameTextValue, label: `${fieldNameTextValue}${translate('step2.field_not_in_dataset_suffix', '（資料中無此欄位）')}`, disabled: true }]
									: []),
								...datasetColumnsList
									.filter((columnNameString) => normalizeDatasetColumnName(columnNameString) === normalizeDatasetColumnName(fieldNameTextValue) || !currentDpFieldsList.some((otherFieldItemRecord) => otherFieldItemRecord.id !== rowRecordItem.id && normalizeDatasetColumnName(otherFieldItemRecord.fieldName) === normalizeDatasetColumnName(columnNameString)))
									.map((columnNameString) => ({ value: columnNameString, label: columnNameString }))
							]}
						/>
					) : (
						<Input 
							value={fieldNameTextValue} 
							onChange={(inputChangeEvent) => updateFieldLocal(rowRecordItem.id, 'fieldName', inputChangeEvent.target.value)}
							placeholder={translate('step2.ph_eg_salary', '例：salary')}
							status={rowRecordItem.enabled && (!fieldNameTextValue || !fieldNameTextValue.trim()) ? 'error' : ''}
							style={{ width: '100%', background: 'transparent', borderRadius: '6px', textOverflow: 'ellipsis' }}
						/>
					)}
				</Tooltip>
			),
		},
		{
			title: translate('step2.data_type', '資料型態'),
			dataIndex: 'fieldType',
			key: 'fieldType',
			width: '14.5em',
			render: (fieldTypeTextValue: string, rowRecordItem: DPField) => (
				<Select
					style={{ width: '100%' }}
					value={fieldTypeTextValue === 'Unknown' ? null : fieldTypeTextValue}
					placeholder={translate('step2.ph_select', '請選擇')}
					onChange={
						(dropdownSelectedValue) => 
						{
							const newSelectedTypeStr = dropdownSelectedValue as 'Numeric' | 'Categorical' | 'Text';

							setDpFieldsAction(
								currentDpFieldsList.map(
									fieldItemRecord => {
										if (fieldItemRecord.id === rowRecordItem.id) {
											let newLower = fieldItemRecord.lowerBound;
											let newUpper = fieldItemRecord.upperBound;
											let newAllowed = fieldItemRecord.allowedCategories;
											
											if (newSelectedTypeStr === 'Categorical') {
												newLower = newLower ?? 0;
												newUpper = newUpper ?? 1;
												newAllowed = 'auto_extracted';
											} else if (newSelectedTypeStr === 'Numeric') {
												// ★ 使用者反映：手動把單一欄位型態切成「數值」時，邊界只會帶入寫死的
												//   預設值 (DEFAULT_NUMERIC_LOWER_BOUND ~ UPPER_BOUND)，還得再按上方
												//   「套用系統推薦設定」才會抓到實際資料範圍，但那顆按鈕是「整份重新
												//   推薦」，會連帶把其他已經設定好的欄位一併改掉，使用者不希望這個
												//   副作用波及其他欄位。這裡改為直接讀取本頁載入資料集時就已經逐欄
												//   掃描好的 datasetColumnNumericValuesMap（見上方 useEffect，與下方
												//   boundRangeCoverageInfoMap 邊界防呆共用同一份快取），只計算「這一個」
												//   欄位的實際最小/最大值並帶入，不觸碰其他欄位、也不需要再按任何按鈕。
												//   刻意不用 Math.min(...array) 展開陣列，避免欄位實際數值筆數很多
												//   （百萬筆等級）時因引數過多而堆疊溢位，改用逐筆比較，與本檔案其他
												//   處理大量資料的寫法一致。掃描不到有效數值時 (例如欄位選錯、整欄皆
												//   空白) 才退回原本寫死的預設值。
												const realColumnValuesArray = datasetColumnNumericValuesMap[fieldItemRecord.fieldName];
												// ★ 2026-10-01：日期時間型欄位邊界為日期字串：帶入資料的最早／最晚日期，沒有時用預設日期範圍（不可帶數字 0～100）
												if (resolveIsDateTimeDpField(fieldItemRecord)) {
													const dateTimeBoundsField = applyRealDateTimeBounds(fieldItemRecord, useWorkspaceStore.getState().datasetProfile?.dateTimeRanges);
													const hasDateStringBoundsStatus = typeof dateTimeBoundsField.lowerBound === 'string' && typeof dateTimeBoundsField.upperBound === 'string';
													newLower = hasDateStringBoundsStatus ? dateTimeBoundsField.lowerBound : DEFAULT_DATETIME_LOWER_BOUND_DATE;
													newUpper = hasDateStringBoundsStatus ? dateTimeBoundsField.upperBound : new Date().toISOString().slice(0, 10);
												} else if (realColumnValuesArray && realColumnValuesArray.length > 0) {
													let computedRealMinValue = realColumnValuesArray[0];
													let computedRealMaxValue = realColumnValuesArray[0];
													for (let valueIndexNumber = 1; valueIndexNumber < realColumnValuesArray.length; valueIndexNumber++) {
														const currentRealValue = realColumnValuesArray[valueIndexNumber];
														if (currentRealValue < computedRealMinValue) computedRealMinValue = currentRealValue;
														if (currentRealValue > computedRealMaxValue) computedRealMaxValue = currentRealValue;
													}
													newLower = Math.floor(computedRealMinValue);
													newUpper = Math.ceil(computedRealMaxValue);
												} else {
													newLower = newLower ?? DEFAULT_NUMERIC_LOWER_BOUND;
													newUpper = newUpper ?? DEFAULT_NUMERIC_UPPER_BOUND;
												}
											}

											return { 
												...fieldItemRecord, 
												fieldType: newSelectedTypeStr, 
												enabled: newSelectedTypeStr === 'Text' ? false : fieldItemRecord.enabled,
												// ★ 2026-10-02：改成文字型時自動取消敏感欄位點選（數值型可保留，Step4 會先分級距；
												//   日期時間型由下方防呆 useEffect 清除）
												isRiskSensitive: newSelectedTypeStr === 'Text' ? false : fieldItemRecord.isRiskSensitive,
												lowerBound: newLower,
												upperBound: newUpper,
												allowedCategories: newAllowed
											};
										}
										return fieldItemRecord;
									}
								)
							);
						}
					}
					disabled={!rowRecordItem.enabled && fieldTypeTextValue !== 'Text'}
					status={rowRecordItem.enabled && fieldTypeTextValue === 'Unknown' ? 'error' : ''}
					options={
						[
							{ value: 'Numeric', label: translate('step2.opt_dp_numeric', '連續數值型 (Numeric)') },
							{ value: 'Categorical', label: translate('step2.opt_dp_categorical', '類別型 (Categorical)') },
							{ value: 'Text', label: translate('step2.opt_dp_text', '文字/識別碼 (Text)') },
						]
					}
				/>
			),
		},
		{
			title: translate('step2.apply_dp', '套用 DP'),
			key: 'enabled',
			width: '8em',
			render: (_: unknown, rowRecordItem: DPField) => 
			{
				const isCurrentFieldTextFieldType = rowRecordItem.fieldType === 'Text';

				return (
					<Space>
						<Switch 
							checked={rowRecordItem.enabled} 
							onChange={
								() => 
								{
									setDpFieldsAction(
										currentDpFieldsList.map(fieldItemRecord => {
											if (fieldItemRecord.id !== rowRecordItem.id) return fieldItemRecord;
											const nextEnabledStatus = !fieldItemRecord.enabled;
											return { ...fieldItemRecord, enabled: nextEnabledStatus };
										})
									);
								}
							}
							disabled={isCurrentFieldTextFieldType}
							checkedChildren={translate('step2.enable', '開啟')} 
							unCheckedChildren={translate('step2.disable', '關閉')}
						/>

						{isCurrentFieldTextFieldType && (
							<Tooltip title={translate('step2.text_dp_disabled_tooltip', '文本型資料無法套用差分隱私，請改用上方的「資料預先清洗」策略。')}>
								<InfoCircleOutlined style={{ color: '#faad14' }} />
							</Tooltip>
						)}
					</Space>
				);
			},
		},
		{
			// ★ 2026-10-02 新增：點選 Step4 三攻擊／CAP 的敏感欄位（是／否），與「套用 DP」分開——後端 /risk/dp
			//   只要求欄位存在於資料中，未加噪的欄位（例如疾病）也能當敏感欄位。可複數點選，但後端 RiskConfig
			//   規定每次恰好 1 個 sensitive，故 Step4 每輪只以其中 1 個評估、點選幾個跑幾輪；其餘已啟用 DP 的欄位為間接識別。
			title: (
				<Space>
					{translate('step2.dp_risk_sensitive_col', '敏感欄位')}
					<Tooltip title={translate('step2.dp_risk_sensitive_col_tooltip', '請選擇最不希望被別人推測出來的欄位（例如疾病），Step4 會以它為目標評估風險。可以複選，系統會逐一評估並採用風險最高的結果；若都不選，系統會自動輪流評估所有已啟用的類別型欄位（耗時較長）。')}>
						<QuestionCircleOutlined style={{ color: token.colorTextDescription, cursor: 'help' }} />
					</Tooltip>
				</Space>
			),
			key: 'isRiskSensitive',
			width: '8em',
			render: (_: unknown, rowRecordItem: DPField) =>
			{
				// ★ 2026-10-02：類別型、連續數值型（Step4 先分級距）可點選；文字型、日期時間型、尚未選型態停用
				const isSensitiveSelectableStatus = isDpFieldSelectableAsRiskSensitive(rowRecordItem);
				const sensitiveSwitchElement = (
					<Switch
						checked={Boolean(rowRecordItem.isRiskSensitive)}
						onChange={(isCheckedStatus) => handleRiskSensitiveToggle(rowRecordItem.id, isCheckedStatus)}
						disabled={!isSensitiveSelectableStatus}
						checkedChildren={translate('step2.yes', '是')}
						unCheckedChildren={translate('step2.no', '否')}
					/>
				);
				return isSensitiveSelectableStatus
					? sensitiveSwitchElement
					: <Tooltip title={translate('step2.dp_risk_role_sensitive_non_categorical_tooltip', '推斷性攻擊須以可列舉的值為預測目標，文字型與日期時間型欄位不能設為敏感欄位；請改用類別型或連續數值型欄位（數值型會在 Step4 先分級距）。')}><span>{sensitiveSwitchElement}</span></Tooltip>;
			},
		},
		{
			title: (
				<Space>
					{translate('step2.dp_param_settings', '邊界與規則設定')}
					<Tooltip title={translate('step2.dp_param_tooltip', '必填。數值型欄位請填寫可能出現的最小值與最大值，例如年齡 0～120。範圍越大，加入的雜訊越多，保護力越強，但資料也越模糊；範圍太窄，超出範圍的真實值會被調整到範圍內，造成失真。日期時間型欄位（如生日）請選擇起訖日期（只填日期即為當天 00:00:00）。類別型欄位由系統自動判斷，不需設定。')}>
						<QuestionCircleOutlined style={{ color: token.colorTextDescription, cursor: 'help' }} />
					</Tooltip>
				</Space>
			),
			key: 'bounds',
			// 日期時間型邊界顯示到秒（YYYY-MM-DD HH:mm:ss），兩個選擇器並排需約 360px
			width: '25.5em',
			render: (_: unknown, rowRecordItem: DPField) => 
			{
				if (!rowRecordItem.enabled) 
				{
					return <span style={{ color: token.colorTextDescription }}>-</span>;
				}
				
				if (rowRecordItem.fieldType === 'Numeric')
				{
					const isDateTimeFieldStatus = resolveIsDateTimeDpField(rowRecordItem);
					const currentLowerBoundValue = rowRecordItem.lowerBound;
					const currentUpperBoundValue = rowRecordItem.upperBound;

					// ★ 使用者反映：加噪刻度 (minimum_unit／noise_step) 與邊界溢出處理策略 (out_of_bounds_strategy)
					//   屬於「隱私規則參數」而非「欄位邊界對應」，已移至 Step3 差分隱私規則頁面與 ε/δ 一併設定，
					//   此處僅保留欄位型態對應與邊界 (lowerBound／upperBound) 設定。
					// ★ 日期時間型欄位（如生日）：邊界為實際日期，後端 config_dp.json 對應 time_clipping_bounds
					//   （ISO 日期字串），故改用 DatePicker 而非數值輸入框，避免使用者誤輸入無意義的數字邊界。
					if (isDateTimeFieldStatus)
					{
						const lowerDateValue = typeof currentLowerBoundValue === 'string' && currentLowerBoundValue ? dayjs(currentLowerBoundValue) : undefined;
						const upperDateValue = typeof currentUpperBoundValue === 'string' && currentUpperBoundValue ? dayjs(currentUpperBoundValue) : undefined;
						const isDateBoundOrderInvalidStatus = !!lowerDateValue && !!upperDateValue && !lowerDateValue.isBefore(upperDateValue);
						// ★ 2026-10-01：邊界一律可選到秒（先前只能選日期）；午夜只存日期，其餘存到秒，見 compactDpDateTimeBoundText
						const toBoundText = (pickedDateValue: dayjs.Dayjs | null): string | undefined =>
							pickedDateValue ? compactDpDateTimeBoundText(pickedDateValue.format('YYYY-MM-DD HH:mm:ss')) : undefined;

						return (
							<Tooltip title={isDateBoundOrderInvalidStatus ? '下限日期必須早於上限日期！' : undefined} color="volcano">
								<Space.Compact style={{ width: '100%' }}>
									<DatePicker
										placeholder={translate('step2.ph_lower_bound_date', '下限日期')}
										value={lowerDateValue}
										format={DP_DATETIME_BOUND_PICKER_DISPLAY_FORMAT}
										showTime={{ format: DP_DATETIME_BOUND_PICKER_TIME_FORMAT, defaultOpenValue: dayjs('00:00:00', 'HH:mm:ss') }}
										onChange={(pickedDateValue) => updateFieldLocal(rowRecordItem.id, 'lowerBound', toBoundText(pickedDateValue))}
										style={{ width: '50%' }}
										status={!lowerDateValue || isDateBoundOrderInvalidStatus ? 'error' : ''}
									/>
									<DatePicker
										placeholder={translate('step2.ph_upper_bound_date', '上限日期')}
										value={upperDateValue}
										format={DP_DATETIME_BOUND_PICKER_DISPLAY_FORMAT}
										showTime={{ format: DP_DATETIME_BOUND_PICKER_TIME_FORMAT, defaultOpenValue: dayjs('00:00:00', 'HH:mm:ss') }}
										onChange={(pickedDateValue) => updateFieldLocal(rowRecordItem.id, 'upperBound', toBoundText(pickedDateValue))}
										style={{ width: '50%' }}
										status={!upperDateValue || isDateBoundOrderInvalidStatus ? 'error' : ''}
									/>
								</Space.Compact>
							</Tooltip>
						);
					}

					const isLowerBoundMissingStatus = currentLowerBoundValue === undefined || currentLowerBoundValue === null || currentLowerBoundValue === '';
					const isUpperBoundMissingStatus = currentUpperBoundValue === undefined || currentUpperBoundValue === null || currentUpperBoundValue === '';
					const isBoundOrderInvalidStatus = !isLowerBoundMissingStatus && !isUpperBoundMissingStatus && Number(currentLowerBoundValue) >= Number(currentUpperBoundValue);

					// ★ 新增: 邊界範圍防呆——比對是否有實際資料值落在使用者設定的邊界之外。
					const boundRangeCoverageIssueInfo = boundRangeCoverageInfoMap[rowRecordItem.id];
					const isBoundRangeCoverageInvalidStatus = !isBoundOrderInvalidStatus && !!boundRangeCoverageIssueInfo;

					// ★ 2026-10-19：邊界未涵蓋全部資料改為警告 (黃框)，缺值／下限不小於上限仍為錯誤 (紅框)
					const resolveBoundInputStatus = (isMissingStatus: boolean): '' | 'error' | 'warning' =>
						isMissingStatus || isBoundOrderInvalidStatus ? 'error' : isBoundRangeCoverageInvalidStatus ? 'warning' : '';

					const boundRangeTooltipTitleText = isBoundOrderInvalidStatus
						? "下限值必須嚴格小於上限值！"
						: isBoundRangeCoverageInvalidStatus
							? `有 ${boundRangeCoverageIssueInfo.outOfRangeCount} 筆／共 ${boundRangeCoverageIssueInfo.totalValidValueCount} 筆 (${boundRangeCoverageIssueInfo.percentText}) 資料在此邊界之外，加噪前會依「數值超出範圍處理方式」處理（預設截斷至邊界）。若只需要這個區間可忽略此提醒。`
							: undefined;

					// ★ 2026-10-19：拿掉 Tooltip 強制常駐 (open)。常駐提示框不會跟著表格內部捲動被裁切，列捲出可視範圍後
					//   仍浮在表格上方蓋住其他版面 (跑版)；改為滑鼠移上才顯示，摘要改由頁面上方提示列呈現。
					return (
						<Tooltip title={boundRangeTooltipTitleText} color={isBoundOrderInvalidStatus ? 'volcano' : 'gold'}>
							<Space.Compact style={{ width: '100%' }}>
								<InputNumber
									placeholder={translate('step2.ph_lower_bound', '下限 (Lower Bound)')}
									value={rowRecordItem.lowerBound as number}
									step={resolveInputNumberStepByDecimals(rowRecordItem.lowerBound)}
									onChange={(inputNumberValue) => updateFieldLocal(rowRecordItem.id, 'lowerBound', inputNumberValue === null ? undefined : inputNumberValue)}
									style={{ width: '50%', background: 'transparent' }}
									status={resolveBoundInputStatus(isLowerBoundMissingStatus)}
								/>
								<InputNumber
									placeholder={translate('step2.ph_upper_bound', '上限 (Upper Bound)')}
									value={rowRecordItem.upperBound as number}
									step={resolveInputNumberStepByDecimals(rowRecordItem.upperBound)}
									onChange={(inputNumberValue) => updateFieldLocal(rowRecordItem.id, 'upperBound', inputNumberValue === null ? undefined : inputNumberValue)}
									style={{ width: '50%', background: 'transparent' }}
									status={resolveBoundInputStatus(isUpperBoundMissingStatus)}
								/>
							</Space.Compact>
						</Tooltip>
					);
				}
				
				if (rowRecordItem.fieldType === 'Categorical') 
				{
					return (
						<Input
							disabled
							placeholder={translate('step2.ph_categorical_auto', '無需手動設定 (由系統自動萃取資料集類別)')}
							value=""
							style={{ width: '100%', background: isDarkModeActive ? '#1f1f1f' : '#f5f5f5', borderRadius: '6px', color: token.colorTextDescription }}
						/>
					);
				}

				if (rowRecordItem.fieldType === 'Text') 
				{
					return (
						<InputNumber
							placeholder={translate('step2.ph_max_length', '最大長度限制')}
							value={rowRecordItem.maxLength}
							onChange={(inputNumberValue) => updateFieldLocal(rowRecordItem.id, 'maxLength', inputNumberValue === null ? undefined : inputNumberValue)}
							status={!rowRecordItem.maxLength || rowRecordItem.maxLength <= 0 ? 'error' : ''}
							style={{ width: '100%', background: 'transparent', borderRadius: '6px' }}
							min={1}
						/>
					);
				}

				return <span style={{ color: token.colorError }}>{translate('step2.select_type_first', '請先選擇資料型態')}</span>;
			},
		},
		{
			title: translate('step2.action', '操作'),
			key: 'action',
			width: '7em',
			align: 'center' as const,
			render: (_: unknown, rowRecordItem: DPField) => (
				<Space size={4}>
					<Tooltip title={translate('step2.btn_apply_recommend_single', '只套用系統建議設定到此欄位，不影響其他欄位')}>
						<Button
							type="text"
							icon={<ThunderboltOutlined style={{ color: '#4F46E5' }} />}
							onClick={() => handleApplyRecommendationToSingleField(rowRecordItem.id)}
						/>
					</Tooltip>
					<Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeField(rowRecordItem.id)} />
				</Space>
			),
		}
	];

	const liveJsonPreviewDataObject = buildSpecCompliantPreviewJSON();
	const liveJsonPreviewFormattedString = JSON.stringify(liveJsonPreviewDataObject, null, 2);
	const liveJsonPreviewLineArray = liveJsonPreviewFormattedString.split('\n');

	/**
	 * 函數名稱: handleCopyJsonPreviewToClipboard
	 * 函數功能: 將右側即時 JSON 預覽面板之完整內容複製至剪貼簿，並顯示成功／失敗提示訊息。
	 */
	const handleCopyJsonPreviewToClipboard = async (): Promise<void> =>
	{
		try
		{
			await navigator.clipboard.writeText(liveJsonPreviewFormattedString);
			messageApi.success(translate('step2.json_preview_copy_success', '已複製 JSON 預覽內容至剪貼簿'));
		}
		catch (clipboardCopyErrorExecution)
		{
			console.error('複製 JSON 預覽失敗:', clipboardCopyErrorExecution);
			messageApi.error(translate('step2.json_preview_copy_failed', '複製失敗，請手動選取複製'));
		}
	};

	return (
		<Card variant="borderless" style={{ background: 'transparent', padding: 0 }}>
			{fieldsNotInDatasetNamesList.length > 0 && (
				<Alert
					type="error"
					showIcon
					style={{ marginBottom: '16px', padding: '8px 16px', borderRadius: '8px' }}
					title={describeFieldsNotInDatasetError(fieldsNotInDatasetNamesList)}
					action={<Button size="small" danger onClick={removeFieldsNotInDataset}>{translate('step2.btn_remove_fields_not_in_dataset', '移除不存在的欄位')}</Button>}
				/>
			)}
			{datasetColumnsNotConfiguredList.length > 0 && (
				<Alert
					type="warning"
					showIcon
					style={{ marginBottom: '16px', padding: '8px 16px', borderRadius: '8px' }}
					title={translate('step2.dataset_columns_not_configured_warning_dp', {
						names: datasetColumnsNotConfiguredList.map((columnNameString) => `「${columnNameString}」`).join('、'),
						defaultValue: `資料中的 ${datasetColumnsNotConfiguredList.map((columnNameString) => `「${columnNameString}」`).join('、')} 尚未設定，執行時不會加噪、原樣輸出。`
					})}
					action={<Button size="small" onClick={addDatasetColumnsNotConfigured}>{translate('step2.btn_add_columns_not_configured', '補上缺漏欄位')}</Button>}
				/>
			)}
			{boundRangeCoverageWarningList.length > 0 && (
				<Alert
					type="warning"
					showIcon
					style={{ marginBottom: '16px', padding: '8px 16px', borderRadius: '8px' }}
					title={translate('step2.bound_coverage_warning_title', '部分欄位的邊界未涵蓋全部資料')}
					description={
						<span style={{ fontSize: scaleFontSize(13) }}>
							{boundRangeCoverageWarningList
								.map((warningItem) => `「${warningItem.fieldName}」有 ${warningItem.outOfRangeCount} 筆（${warningItem.percentText}）在邊界外`)
								.join('、')}
							{translate('step2.bound_coverage_warning_suffix', '。加噪前會依「數值超出範圍處理方式」處理（預設截斷至邊界）；若只需要特定區間可忽略，否則請擴大邊界。')}
						</span>
					}
				/>
			)}
			{!validationStatusResult.isValid && (
				<Alert
					title={translate('step2.incomplete_setting', '欄位設定尚未完整')}
					description={
						<span style={{ fontSize: scaleFontSize(13) }}>
							{translate('step2.incomplete_desc_prefix', '目前共有')} <strong>{validationStatusResult.errorCount}</strong> {translate('step2.incomplete_desc_suffix', '個欄位設定未完成')} 
						</span>
					}
					type="error" showIcon style={{ marginBottom: '16px', padding: '8px 16px', borderRadius: '8px' }}
				/>
			)}

			<Tabs
				defaultActiveKey="1" 
				tabBarExtraContent={
					<Space style={{ paddingBottom: '8px' }}>
						{/* ★ 2026-10-07 QA 回饋：匯入旁加上匯出（見 ConfigFileButtons.tsx） */}
						<ConfigFileButtons onImportFileChange={handleImportJSON} fileInputRef={fileInputRef} />
					</Space>
				}
				items={[
					{
						key: '1', label: <span style={{ padding: '0 8px' }}><DatabaseOutlined /> {translate('step2.tab_dp_mapping', '差分隱私欄位對應')}</span>,
						children: (
							<div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: '8px', padding: '16px 20px', background: isDarkModeActive ? '#141414' : '#fafafa' }}>
								<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
									<div style={{ fontWeight: 600, color: token.colorText }}>{translate('step2.col_settings_list', '欄位參數設定清單')}</div>
									<Space size={8}>
										{isJsonPreviewVisibleStatus ? (
											<Button size="small" icon={<EyeInvisibleOutlined />} onClick={() => setIsJsonPreviewVisibleStatus(false)}>{translate('step2.json_preview_hide', '隱藏預覽')}</Button>
										) : (
											<Button size="small" icon={<EyeOutlined />} onClick={() => setIsJsonPreviewVisibleStatus(true)}>{translate('step2.json_preview_show', '顯示預覽')}</Button>
										)}
										<Button type="primary" icon={<ThunderboltOutlined />} onClick={handleApplyRecommendations} style={{ background: '#4F46E5', border: 'none', borderRadius: '6px' }}>{translate('step2.btn_apply_recommend', '自動智慧推薦')}</Button>
									</Space>
								</div>
								
								{designatedRiskSensitiveFieldsList.length > 0 ? (
									riskQuasiIdentifierFieldsCount === 0 ? (
										<Alert type="error" showIcon style={{ marginBottom: '12px', textAlign: 'left' }} message={translate('step2.dp_risk_sensitive_no_qi', { names: designatedRiskSensitiveNamesText, defaultValue: `已點選 ${designatedRiskSensitiveNamesText} 為敏感欄位，但沒有其他已啟用差分隱私的欄位可作為間接識別，三攻擊缺少攻擊面。請再啟用至少 1 個未點選為敏感的欄位才能進入下一步。` })} />
									) : (
										<Alert type="success" showIcon style={{ marginBottom: '12px', textAlign: 'left' }} message={translate('step2.dp_risk_sensitive_designated', { names: designatedRiskSensitiveNamesText, sensitiveCount: designatedRiskSensitiveFieldsList.length, count: riskQuasiIdentifierFieldsCount, defaultValue: `風險評估敏感欄位：${designatedRiskSensitiveNamesText}，其餘 ${riskQuasiIdentifierFieldsCount} 個已啟用差分隱私的欄位為間接識別。Step4 每輪只以 1 個敏感欄位執行三攻擊與 CAP，共 ${designatedRiskSensitiveFieldsList.length} 輪，取風險最高的結果。` })} />
									)
								) : (
									// ★ 2026-10-02：使用者反映藍色資訊提示不夠明顯，改為黃色警告並放大輪數；按「下一步」時另跳確認視窗（見 MainLayout）
									<Alert
										type="warning"
										showIcon
										style={{ marginBottom: '12px', textAlign: 'left' }}
										message={<strong>{translate('step2.dp_risk_sensitive_auto_title', '尚未點選敏感欄位')}</strong>}
										description={
											<span>
												{translate('step2.dp_risk_sensitive_auto_prefix', 'Step4 將輪流以')}
												<strong style={{ fontSize: scaleFontSize(16), margin: '0 4px' }}>{autoRiskSensitiveCandidatesCount}</strong>
												{translate('step2.dp_risk_sensitive_auto_suffix', '個類別型欄位為敏感欄位，各執行一輪三攻擊與 CAP，取風險最高的結果。')}
												<strong>{translate('step2.dp_risk_sensitive_auto_time', { count: autoRiskSensitiveCandidatesCount, defaultValue: `執行時間約為點選 1 個敏感欄位時的 ${autoRiskSensitiveCandidatesCount} 倍。` })}</strong>
												{translate('step2.dp_risk_sensitive_auto_hint', '建議在表格「敏感欄位」欄點選真正需要保護的欄位（例如疾病），結果較有意義，且點選幾個就只執行幾輪。')}
											</span>
										}
									/>
								)}

								<div style={{ background: isDarkModeActive ? '#1d1d1d' : '#ffffff', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${token.colorBorderSecondary}` }}>
									<Table dataSource={currentDpFieldsList} columns={dpDataTableColumnsConfig} rowKey="id" pagination={false} size="small" bordered={false} className="attribute-table" scroll={{ x: 'max-content', y: 400 }} />
								</div>

								{isJsonPreviewVisibleStatus && (
									<Card
										size="small"
										style={{ marginTop: '16px', background: isDarkModeActive ? '#141414' : '#fafafa', border: `1px solid ${token.colorBorderSecondary}` }}
										styles={{ body: { padding: 0 }, header: { borderBottom: `1px solid ${token.colorBorderSecondary}` } }}
										title={<span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><CodeOutlined style={{ color: token.colorPrimary }} />{translate('step2.json_preview', '即時設定檔預覽 (JSON Preview)')}</span>}
										extra={<Button size="small" icon={<CopyOutlined />} onClick={handleCopyJsonPreviewToClipboard}>{translate('step2.json_preview_copy', '複製')}</Button>}
									>
										<div
											style={{
												background: isDarkModeActive ? '#141414' : '#f8fafc',
												borderRadius: '0 0 8px 8px',
												padding: '16px 12px',
												overflow: 'auto',
												maxHeight: '360px',
												fontSize: scaleFontSize(13),
												fontFamily: 'Consolas, Menlo, Monaco, "Courier New", monospace',
												color: isDarkModeActive ? '#a6accd' : '#333',
												// ★ 修正：使用者反映 JSON 預覽程式碼呈置中對齊。根因為全域 index.css 之
												// #root { text-align: center; } (Vite 範本殘留設定)，此處內容未明確指定
												// text-align，故被向下繼承套用置中，導致每一行較短的 JSON 內容 (span
												// 為 flex 項目、寬度撐滿整行) 在該寬度內置中顯示，而非緊靠左側。
												// 明確指定 'left' 覆寫繼承值，程式碼預覽風格本就應一律靠左對齊。
												textAlign: 'left'
											}}
										>
											{liveJsonPreviewLineArray.map(
												(jsonPreviewLineTextString, jsonPreviewLineIndexNumber) => (
													<div className="dp-json-preview-line" key={jsonPreviewLineIndexNumber}>
														<span className="dp-json-preview-line-number">{jsonPreviewLineIndexNumber + 1}</span>
														<span className="dp-json-preview-line-content">{jsonPreviewLineTextString}</span>
													</div>
												)
											)}
										</div>
									</Card>
								)}

								<Tooltip title={datasetColumnsList.length > 0 && datasetColumnsNotConfiguredList.length === 0 ? translate('step2.add_field_all_configured', '資料中的欄位都已設定；新增欄位只能加回資料中尚未設定的欄位。') : ''}>
									<Button type="dashed" block icon={<PlusOutlined />} onClick={addField} disabled={datasetColumnsList.length > 0 && datasetColumnsNotConfiguredList.length === 0} style={{ marginTop: '16px' }}>{translate('step2.btn_add_field', '新增自訂欄位')}</Button>
								</Tooltip>
							</div>
						)
					}
				]}
			/>

			<style>{`
				.attribute-table .ant-table-thead > tr > th { background: ${isDarkModeActive ? '#262626' : '#fafafa'} !important; border-bottom: 1px solid ${token.colorBorderSecondary} !important; color: ${token.colorTextSecondary} !important; font-weight: 500; white-space: nowrap; padding: 8px 8px !important; }
				.attribute-table .ant-table-tbody > tr > td { border-bottom: 1px solid ${token.colorBorderSecondary} !important; padding: 8px 8px !important; }
				.attribute-table .ant-table-expanded-row > td { padding: 0 !important; }
				.dp-json-preview-line {
					display: flex;
				}
				.dp-json-preview-line-number {
					flex: 0 0 auto;
					width: 36px;
					text-align: right;
					padding-right: 12px;
					user-select: none;
					color: ${isDarkModeActive ? '#5c6370' : '#a0aec0'};
				}
				.dp-json-preview-line-content {
					flex: 1 1 auto;
					white-space: pre;
				}
			`}</style>
		</Card>
	);
}