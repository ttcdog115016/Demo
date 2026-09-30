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
	UploadOutlined, DeleteOutlined, PlusOutlined,
	DatabaseOutlined, CodeOutlined, ThunderboltOutlined, InfoCircleOutlined, CopyOutlined,
	EyeOutlined, EyeInvisibleOutlined, QuestionCircleOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

import { useWorkspaceStore, type DPField, type PreprocessingRule } from '../../store/useWorkspaceStore';
import { DP_COLUMN_BUDGETS_REFERENCE } from '../../config/recommendationReferenceConfig';
import { isDateTimeDpField, mapOutOfBoundsStrategyToBackend, mapOutOfBoundsStrategyFromBackend, DEFAULT_DATETIME_LOWER_BOUND_DATE, resolveInputNumberStepByDecimals } from '../../utils/dpFieldHelpers';
import { ensureDatasetProfile, useEnsureDatasetProfile } from '../../utils/datasetProfile';

/**
 * 預設隱私參數常數宣告
 */
const DEFAULT_EPSILON_BUDGET = 1.0;
const DEFAULT_DELTA_BUDGET = 0.0001;
const DEFAULT_NUMERIC_LOWER_BOUND = 0;
const DEFAULT_NUMERIC_UPPER_BOUND = 100;
const DP_RECOMMEND_MINMAX_PARSE_MESSAGE_KEY = 'dp-recommend-minmax-parse';
const BASE_DEFAULT_K_ANONYMITY_VALUE = 5;
const BASE_DEFAULT_L_DIVERSITY_VALUE = 2;
const BASE_DEFAULT_T_CLOSENESS_VALUE = 0.15;
const BASE_DEFAULT_SUPPRESSION_LIMIT = 10;
const BASE_DEFAULT_SIMULATE_QUERY_COUNT = 1;
const BASE_DEFAULT_BUDGET_LIMIT = 20;

const createInitialDPFields = (columnNameList: string[]): DPField[] => 
{
	return columnNameList.map(
		(columnNameString, columnIndex) => 
		{
			const lowerCaseColumnName = columnNameString.toLowerCase();
			let calculatedDefaultType: 'Numeric' | 'Categorical' | 'Text' | 'Unknown' = 'Unknown';

			if (/(age|amount|fare|count|price|salary|num|duration|mins)/i.test(lowerCaseColumnName)) 
			{
				calculatedDefaultType = 'Numeric';
			} 
			else if (/(gender|type|category|status|station)/i.test(lowerCaseColumnName)) 
			{
				calculatedDefaultType = 'Categorical';
			}

			const isDateTimeFieldStatus = calculatedDefaultType === 'Numeric' && isDateTimeDpField(columnNameString);

			return {
				id: `${columnNameString}-${columnIndex}`,
				fieldName: columnNameString,
				fieldType: calculatedDefaultType,
				enabled: true,
				epsilon: DEFAULT_EPSILON_BUDGET,
				delta: 1e-5,
				// ★ 日期時間型欄位（如生日）之邊界應為日期字串而非單純數字，故與一般數值型欄位分開給預設值。
				lowerBound: isDateTimeFieldStatus ? DEFAULT_DATETIME_LOWER_BOUND_DATE : (calculatedDefaultType === 'Numeric' ? DEFAULT_NUMERIC_LOWER_BOUND : (calculatedDefaultType === 'Categorical' ? 0 : undefined)),
				upperBound: isDateTimeFieldStatus ? new Date().toISOString().slice(0, 10) : (calculatedDefaultType === 'Numeric' ? DEFAULT_NUMERIC_UPPER_BOUND : (calculatedDefaultType === 'Categorical' ? 1 : undefined)),
				allowedCategories: calculatedDefaultType === 'Categorical' ? 'auto_extracted' : '',
				outOfBoundsStrategy: 'clip',
				minimumUnit: (calculatedDefaultType === 'Numeric' && !isDateTimeFieldStatus) ? 1 : undefined,
				noiseStep: isDateTimeFieldStatus ? 7 : undefined
			};
		}
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
						else if (isDateTimeDpField(fieldItemRecord.fieldName))
						{
							const lowerDateTimestamp = Date.parse(String(fieldItemRecord.lowerBound));
							const upperDateTimestamp = Date.parse(String(fieldItemRecord.upperBound));
							if (Number.isNaN(lowerDateTimestamp) || Number.isNaN(upperDateTimestamp) || lowerDateTimestamp >= upperDateTimestamp)
							{
								currentFieldHasErrorStatus = true;
							}
						}
						else if (Number(fieldItemRecord.lowerBound) >= Number(fieldItemRecord.upperBound))
						{
							currentFieldHasErrorStatus = true;
						}
						// ★ 新增: 邊界範圍未涵蓋實際資料最大/最小值 (例如年齡設 0~1，但實際資料為 20~80)，
						//   視為與「下限須小於上限」同等級之硬性錯誤，阻擋進入下一步，避免加噪後產生無意義的異常數值。
						else if (boundRangeCoverageInfoMap[fieldItemRecord.id])
						{
							currentFieldHasErrorStatus = true;
						}
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
		[currentDpFieldsList, boundRangeCoverageInfoMap]
	);

	const generateExportJSON = (): Record<string, unknown> => 
	{
		const currentWorkspaceStoreState = useWorkspaceStore.getState();
		const generatedFieldAttributesMap: Record<string, { type: string; role: string }> = {};

		const formattedDpRulesArray = currentDpFieldsList.map(
			(fieldItemRecord) => 
			{
				let mappedAttributeType = 'string';
				if (fieldItemRecord.fieldType === 'Numeric') mappedAttributeType = 'numeric';
				else if (fieldItemRecord.fieldType === 'Categorical') mappedAttributeType = 'categorical';
				else if (fieldItemRecord.fieldType === 'Text') mappedAttributeType = 'string';

				generatedFieldAttributesMap[fieldItemRecord.fieldName] = {
					type: mappedAttributeType,
					role: fieldItemRecord.enabled ? (mappedAttributeType === 'numeric' ? 'sensitive' : 'quasi_identifier') : 'identifier'
				};

				return {
					id: fieldItemRecord.id,
					fieldName: fieldItemRecord.fieldName,
					fieldType: fieldItemRecord.fieldType,
					enabled: Boolean(fieldItemRecord.enabled),
					mode: fieldItemRecord.mode || 'epsilon',
					epsilon: fieldItemRecord.epsilon || DEFAULT_EPSILON_BUDGET,
					delta: fieldItemRecord.delta || DEFAULT_DELTA_BUDGET,
					lowerBound: fieldItemRecord.lowerBound !== undefined ? Number(fieldItemRecord.lowerBound) : undefined,
					upperBound: fieldItemRecord.upperBound !== undefined ? Number(fieldItemRecord.upperBound) : undefined,
					allowedCategories: fieldItemRecord.fieldType === 'Categorical' ? '' : (fieldItemRecord.allowedCategories || ''),
					maxLength: fieldItemRecord.maxLength ? Number(fieldItemRecord.maxLength) : undefined
				};
			}
		);

		// ★ 規範對照: 依 Open-PETs API 交付文件 4-2 節之設定檔結構（docs/manual_test/config_dp.json）——
		//   column_budgets 逐欄指定 type／epsilon_budget／delta_budget／sensitivity／clipping_bounds／
		//   out_of_bounds_strategy／minimum_unit（日期時間型則對應 time_clipping_bounds／
		//   time_out_of_bounds_strategy／noise_step），未列入的欄位不加噪、原樣保留；categorical 採
		//   k-RR 機制，不需 sensitivity。此為後端 /api/v1/dp 實際讀取之設定檔格式，須與 Step4 實際送出
		//   之 column_budgets (Step4_Result.tsx) 保持一致，避免「即時設定檔預覽」與實際送出內容不符。
		const generatedColumnBudgetsMap: Record<string, Record<string, unknown>> = {};

		currentDpFieldsList.forEach(
			(fieldItemRecord) => {
				if (!fieldItemRecord.enabled) return;
				if (fieldItemRecord.fieldType !== 'Numeric' && fieldItemRecord.fieldType !== 'Categorical') return;
				if (!fieldItemRecord.fieldName) return;

				const isNumericFieldType = fieldItemRecord.fieldType === 'Numeric';
				const isDateTimeFieldType = isNumericFieldType && isDateTimeDpField(fieldItemRecord.fieldName);
				const hasValidNumericBounds = fieldItemRecord.lowerBound !== undefined && fieldItemRecord.lowerBound !== null
					&& fieldItemRecord.upperBound !== undefined && fieldItemRecord.upperBound !== null;

				const columnBudgetItem: Record<string, unknown> = {
					type: isNumericFieldType ? (isDateTimeFieldType ? 'datetime' : 'continuous') : 'categorical',
					epsilon_budget: fieldItemRecord.epsilon || DEFAULT_EPSILON_BUDGET,
					delta_budget: fieldItemRecord.delta || 0,
				};

				if (isDateTimeFieldType && hasValidNumericBounds) {
					columnBudgetItem.sensitivity = Math.round((Date.parse(String(fieldItemRecord.upperBound)) - Date.parse(String(fieldItemRecord.lowerBound))) / 86400000);
					columnBudgetItem.noise_unit = 'day';
					if (fieldItemRecord.noiseStep !== undefined) columnBudgetItem.noise_step = fieldItemRecord.noiseStep;
					columnBudgetItem.time_clipping_bounds = [fieldItemRecord.lowerBound, fieldItemRecord.upperBound];
					columnBudgetItem.time_out_of_bounds_strategy = mapOutOfBoundsStrategyToBackend(fieldItemRecord.outOfBoundsStrategy);
				} else if (isNumericFieldType && hasValidNumericBounds) {
					columnBudgetItem.sensitivity = Number(fieldItemRecord.upperBound) - Number(fieldItemRecord.lowerBound);
					columnBudgetItem.minimum_unit = fieldItemRecord.minimumUnit ?? 1;
					columnBudgetItem.clipping_bounds = [Number(fieldItemRecord.lowerBound), Number(fieldItemRecord.upperBound)];
					columnBudgetItem.out_of_bounds_strategy = mapOutOfBoundsStrategyToBackend(fieldItemRecord.outOfBoundsStrategy);
				}

				generatedColumnBudgetsMap[fieldItemRecord.fieldName] = columnBudgetItem;
			}
		);

		return {
			version: new Date().toISOString(),
			dataset: currentWorkspaceStoreState.fileName || "current_dataset",
			privacy_mode: currentWorkspaceStoreState.privacyMode || "differential-privacy",
			columns: currentWorkspaceStoreState.columns,
			column_roles: currentWorkspaceStoreState.columnRoles,
			column_types: currentWorkspaceStoreState.columnTypes,
			preprocessing_rules: currentWorkspaceStoreState.preprocessingRules && Object.keys(currentWorkspaceStoreState.preprocessingRules).length > 0 ? currentWorkspaceStoreState.preprocessingRules : undefined,
			field_attributes: generatedFieldAttributesMap,
			column_budgets: generatedColumnBudgetsMap,
			privacy_targets: {
				k_anonymity: { 
					enabled: currentWorkspaceStoreState.privacyMode === 'k-anonymity', 
					k: currentWorkspaceStoreState.kValue ?? BASE_DEFAULT_K_ANONYMITY_VALUE, 
					l: currentWorkspaceStoreState.lValue ?? BASE_DEFAULT_L_DIVERSITY_VALUE,
					t: currentWorkspaceStoreState.tValue ?? BASE_DEFAULT_T_CLOSENESS_VALUE,
					suppression_method: currentWorkspaceStoreState.suppressionMethod ?? "row_suppression",
					cell_fill: currentWorkspaceStoreState.cellFillMethod ?? "star",
					suppression_limit_percent: currentWorkspaceStoreState.maxSuppression ?? BASE_DEFAULT_SUPPRESSION_LIMIT,
					limit_exceeded_action: currentWorkspaceStoreState.limitExceededAction ?? "stop_and_error"
				},
				differential_privacy: { 
					enabled: currentWorkspaceStoreState.privacyMode === 'differential-privacy', 
					global_target_delta: currentWorkspaceStoreState.targetDelta ?? DEFAULT_DELTA_BUDGET,
					simulate_query_count: currentWorkspaceStoreState.queryCount ?? BASE_DEFAULT_SIMULATE_QUERY_COUNT,
					budget_limit: currentWorkspaceStoreState.budgetLimitEpsilon ?? BASE_DEFAULT_BUDGET_LIMIT,
					out_of_bounds_strategy: currentWorkspaceStoreState.outOfBoundsStrategy ?? 'clip'
				}
			},
			differential_privacy_rules: formattedDpRulesArray
		};
	};

	/**
	 * 函數名稱: buildSpecCompliantPreviewJSON
	 * 函數功能: 從 generateExportJSON() 之完整內部狀態結果中，萃取版本／資料集等識別性中繼資料，
	 *           並依 Open-PETs API 交付文件 config_dp.json 結構，將 column_budgets 與
	 *           accumulated_epsilon／accumulated_delta／default_delta 一併包在 differential_privacy
	 *           區塊底下呈現，供「即時設定檔預覽」使用，避免混入 field_attributes／
	 *           differential_privacy_rules 等本工具內部專用、後端 /api/v1/dp 並不需要的欄位，
	 *           造成預覽格式與實際上傳設定檔（Step4_Result.tsx 送出之 config.json）不一致。
	 *           ★ 使用者反映：預覽先前看不到 accumulated_epsilon／accumulated_delta／default_delta，
	 *           且 accumulated_epsilon／accumulated_delta 應為「跨批次累計」而非每次固定為 0，此處
	 *           改為讀取 Step4 每次執行後更新之 dpAccumulatedEpsilon／dpAccumulatedDelta 累計值。
	 */
	const buildSpecCompliantPreviewJSON = (): Record<string, unknown> => {
		const fullExportDataObject = generateExportJSON();
		const currentWorkspaceStoreState = useWorkspaceStore.getState();

		return {
			version: fullExportDataObject.version,
			dataset: fullExportDataObject.dataset,
			differential_privacy: {
				enabled: true,
				accumulated_epsilon: currentWorkspaceStoreState.dpAccumulatedEpsilon ?? 0,
				accumulated_delta: currentWorkspaceStoreState.dpAccumulatedDelta ?? 0,
				default_delta: currentWorkspaceStoreState.targetDelta ?? DEFAULT_DELTA_BUDGET,
				column_budgets: fullExportDataObject.column_budgets
			}
		};
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
				
				type DpRuleItem = {
					id?: string; fieldName?: string; field_name?: string; field?: string;
					fieldType?: DPField['fieldType']; field_type?: DPField['fieldType'];
					enabled?: boolean; mode?: 'epsilon' | 'epsilon-delta';
					epsilon?: number; delta?: number; lowerBound?: number; upperBound?: number;
					allowedCategories?: string; maxLength?: number; bounds?: { lower?: number; upper?: number };
					allowed_categories?: string[] | string; max_length?: number;
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
					const columnBudgetsMap = rawColumnBudgetsSource as Record<string, {
						type?: string, epsilon?: number, delta?: number, epsilon_budget?: number, delta_budget?: number,
						sensitivity?: number, allowed_categories?: string, clipping_bounds?: [number, number],
						minimum_unit?: number, out_of_bounds_strategy?: string,
						time_clipping_bounds?: [string, string], time_out_of_bounds_strategy?: string, noise_step?: number
					}>;
					const extractedNewFieldsArray: DPField[] = [];
					const importedColumnNamesList = Object.keys(columnBudgetsMap);

					importedColumnNamesList.forEach((columnName, index) => {
						const budgetItem = columnBudgetsMap[columnName];
						const rawType = String(budgetItem.type || '').toLowerCase();
						// v1.2.0 欄位名稱為 epsilon_budget／delta_budget；仍相容本工具早期匯出格式的 epsilon／delta。
						const resolvedEpsilonValue = budgetItem.epsilon_budget ?? budgetItem.epsilon;
						const resolvedDeltaValue = budgetItem.delta_budget ?? budgetItem.delta;
						const isImportedDateTimeType = rawType === 'datetime';

						let mappedFieldTypeValue: DPField['fieldType'] = 'Unknown';
						if (['continuous', 'numeric', 'datetime'].includes(rawType)) {
							mappedFieldTypeValue = 'Numeric';
						} else if (['categorical'].includes(rawType)) {
							mappedFieldTypeValue = 'Categorical';
						} else if (['string', 'text'].includes(rawType)) {
							mappedFieldTypeValue = 'Text';
						}

						let calcLowerBound: number | string | undefined = undefined;
						let calcUpperBound: number | string | undefined = undefined;
						let calcMinimumUnit: number | undefined = undefined;
						let calcNoiseStep: number | undefined = undefined;
						let calcOutOfBoundsStrategy: DPField['outOfBoundsStrategy'] = undefined;

						if (mappedFieldTypeValue === 'Numeric' && isImportedDateTimeType) {
							// ★ config_dp.json v1.2.0 日期時間型欄位之邊界存放於 time_clipping_bounds（ISO 日期字串陣列），
							//   與連續值欄位的 clipping_bounds（數值陣列）分屬不同欄位名稱，須分開解析。
							if (Array.isArray(budgetItem.time_clipping_bounds) && budgetItem.time_clipping_bounds.length === 2) {
								calcLowerBound = budgetItem.time_clipping_bounds[0];
								calcUpperBound = budgetItem.time_clipping_bounds[1];
							} else {
								calcLowerBound = DEFAULT_DATETIME_LOWER_BOUND_DATE;
								calcUpperBound = new Date().toISOString().slice(0, 10);
							}
							calcNoiseStep = budgetItem.noise_step;
							calcOutOfBoundsStrategy = mapOutOfBoundsStrategyFromBackend(budgetItem.time_out_of_bounds_strategy);
						} else if (mappedFieldTypeValue === 'Numeric') {
							// ★ config_dp.json v1.2.0 每欄實際上限/下限存放於 clipping_bounds: [下限, 上限]；
							//   優先直接讀取，避免誤用 sensitivity 推算出與設定檔不符的邊界。
							if (Array.isArray(budgetItem.clipping_bounds) && budgetItem.clipping_bounds.length === 2) {
								calcLowerBound = budgetItem.clipping_bounds[0];
								calcUpperBound = budgetItem.clipping_bounds[1];
							} else {
								calcLowerBound = 0;
								if (budgetItem.sensitivity !== undefined) {
									calcUpperBound = calcLowerBound + budgetItem.sensitivity;
								} else {
									calcUpperBound = DEFAULT_NUMERIC_UPPER_BOUND;
								}
							}
							calcMinimumUnit = budgetItem.minimum_unit ?? 1;
							calcOutOfBoundsStrategy = mapOutOfBoundsStrategyFromBackend(budgetItem.out_of_bounds_strategy);
						} else if (mappedFieldTypeValue === 'Categorical') {
							calcLowerBound = 0;
							calcUpperBound = 1;
						}

						extractedNewFieldsArray.push({
							id: `import_budget_${index}_${Math.random().toString(36).substring(2, 9)}`,
							fieldName: columnName,
							fieldType: mappedFieldTypeValue,
							enabled: mappedFieldTypeValue !== 'Text',
							mode: (resolvedDeltaValue && resolvedDeltaValue > 0) ? 'epsilon-delta' : 'epsilon',
							epsilon: resolvedEpsilonValue ?? DEFAULT_EPSILON_BUDGET,
							delta: resolvedDeltaValue ?? DEFAULT_DELTA_BUDGET,
							lowerBound: calcLowerBound,
							upperBound: calcUpperBound,
							allowedCategories: mappedFieldTypeValue === 'Categorical' ? 'auto_extracted' : '',
							minimumUnit: calcMinimumUnit,
							noiseStep: calcNoiseStep,
							outOfBoundsStrategy: calcOutOfBoundsStrategy
						});
					});

					// ★ 核心修正：匯入 JSON 時，絕對不可以去覆蓋 datasetColumnsList，以免毀掉 Step 1 的預覽表格表頭！
					// 只有在系統目前完全沒有 columns (沒上傳過 CSV) 的情況下，才允許使用 JSON 裡的欄位當作預設值。
					useWorkspaceStore.setState({
						columns: (datasetColumnsList && datasetColumnsList.length > 0) ? datasetColumnsList : importedColumnNamesList,
						privacyMode: 'differential-privacy'
					});

					setDpFieldsAction(extractedNewFieldsArray);
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
					setDpFieldsAction(parsedDpRuleArray as DPField[]);
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

					Object.keys(parsedFieldAttributesMap).forEach(
						(targetFieldNameString, fieldIndexNumber) => 
						{
							const currentAttributeItem = parsedFieldAttributesMap[targetFieldNameString]; 
							const currentMechanismItem = parsedMechanismMap[targetFieldNameString]; 
							const currentRuleObjectItem = dpRulesObjectFormatMap[targetFieldNameString];

							const currentRuleArrayItem = dpRulesArrayFormatList.find(
								(ruleItem) => (ruleItem.fieldName || ruleItem.field_name || ruleItem.field) === targetFieldNameString
							);

							let mappedFieldTypeValue: DPField['fieldType'] = 'Unknown';
							if (currentAttributeItem.type === 'numeric') mappedFieldTypeValue = 'Numeric';
							else if (currentAttributeItem.type === 'categorical') mappedFieldTypeValue = 'Categorical';
							else if (['string', 'temporal'].includes(currentAttributeItem.type)) mappedFieldTypeValue = currentAttributeItem.role === 'identifier' ? 'Text' : 'Categorical';

							const hasRuleSettingData = Boolean(currentMechanismItem || currentRuleObjectItem || currentRuleArrayItem);
							let isFieldEnabledStatus = mappedFieldTypeValue !== 'Text' && currentAttributeItem.role !== 'identifier' && hasRuleSettingData;
							
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
								maxLength: currentRuleArrayItem?.maxLength ?? currentRuleObjectItem?.maxLength
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

					if (parsedJsonContentData.preprocessing_rules)
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

					setDpFieldsAction(extractedNewFieldsArray);
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
	const computeRecommendedFieldSettings = (fieldItemRecord: DPField): { updatedField: DPField; isUnmatched: boolean } =>
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

			if (isDateTimeDpField(fieldItemRecord.fieldName))
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
		else if (recommendedFieldTypeVal === 'Unknown' || recommendedFieldTypeVal === undefined)
		{
			// ★ 新增: 完全比對不到任何關鍵字的欄位記錄下來，供後面決定提示訊息使用。
			isFieldUnmatchedStatus = true;
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
				noiseStep: recommendedNoiseStepVal
			},
			isUnmatched: isFieldUnmatchedStatus
		};
	};

	// ★ 新增：只把「已快取的實際資料範圍」(datasetColumnNumericValuesMap，見上方 useEffect)
	//   套用到單一數值型欄位，跟「切換資料型態」下拉選單時已採用的做法一致（見下方欄位表格
	//   fieldType 欄 onChange），不需要重新解析整份檔案，也不會動到其他欄位。日期時間型欄位
	//   因邊界是日期字串、不會出現在這份數值快取裡，下方判斷會自然跳過、維持原本算出的日期邊界。
	const applyRealDataBoundsToSingleNumericField = (fieldItemRecord: DPField): DPField =>
	{
		if (fieldItemRecord.fieldType !== 'Numeric') return fieldItemRecord;

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

		const { updatedField, isUnmatched } = computeRecommendedFieldSettings(targetFieldItemRecord);
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

		// ★ 修正: 記錄仍無法自動判斷類型的欄位（例如欄位名稱不在下方關鍵字範圍內），以便提示使用者手動設定，而不是像修正前那樣、畫面毫無變化卻仍顯示「已套用」。
		const unmatchedFieldNameList: string[] = [];

		const recommendedUpdatedFieldsArray = currentDpFieldsList.map(
			(fieldItemRecord) =>
			{
				const { updatedField, isUnmatched } = computeRecommendedFieldSettings(fieldItemRecord);
				if (isUnmatched) unmatchedFieldNameList.push(fieldItemRecord.fieldName);
				return updatedField;
			}
		);

		// ★ DP 模式不再有「敏感欄位」概念（先前假設 DP 風險評估也要求指定敏感欄位，經確認
		//   為錯誤設定，已移除），故套用推薦設定時直接沿用比對後的欄位陣列，不另作標記。
		const finalDpFieldsArray = recommendedUpdatedFieldsArray;

		// ★ 修正: 原本不論實際上是否有欄位被變更，都固定顯示「已為所有欄位套用...」的成功訊息；若欄位名稱比對不到任何關鍵字（例如非常見命名用詞），畫面其實毫無變化卻仍顯示成功訊息，會讓使用者誤以為按鈕沒作用。改為依實際比對結果顯示對應訊息。
		const finalizeAndApplyRecommendedFields = (fieldsArrayToApply: DPField[]): void => 
		{
			setDpFieldsAction(fieldsArrayToApply);

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

		// ★ 新增: 使用者要求「數值型欄位的邊界／敏感度」預設值一律改為讀取實際資料集的最大／最小值，
		//   取代先前依關鍵字或參考設定檔 sensitivity 推算、或固定 0~100 之預設值。使用者已確認：
		//   (1) 不分是否已被參考設定檔比對到，所有數值型欄位皆比照辦理；(2) 為求準確，重新以 Papa.parse
		//   完整解析整份原始檔案 (不套用 Step1 上傳時的 1000 筆預覽上限 `preview` 參數)，逐欄計算實際最小/
		//   最大值；解析為非同步過程，故先以載入提示訊息告知使用者，待解析完成後才寫入 Store 並顯示結果訊息。
		const rawUploadedDataFileObj = useWorkspaceStore.getState().dataFile;
		const numericFieldNamesNeedingRealBoundsList = finalDpFieldsArray.filter((fieldItemRecord) => fieldItemRecord.fieldType === 'Numeric').map((fieldItemRecord) => fieldItemRecord.fieldName);

		if (!rawUploadedDataFileObj || numericFieldNamesNeedingRealBoundsList.length === 0) 
		{
			// 無原始檔案可供重新解析 (理論上不應發生)，或無任何數值型欄位需要計算邊界，則直接套用既有邊界值。
			finalizeAndApplyRecommendedFields(finalDpFieldsArray);
			return;
		}

		messageApi.loading({ content: '正在讀取資料集，計算數值型欄位的實際邊界範圍...', key: DP_RECOMMEND_MINMAX_PARSE_MESSAGE_KEY, duration: 0 });

		// ★ 2026-09-30：改用 utils/datasetProfile.ts 的共用掃描結果（已掃描過就直接取用，不再重新完整解析整份檔案）。
		ensureDatasetProfile(rawUploadedDataFileObj)
			.then((datasetProfileResult) =>
			{
				messageApi.destroy(DP_RECOMMEND_MINMAX_PARSE_MESSAGE_KEY);

				const fieldsWithDataDrivenBoundsArray = finalDpFieldsArray.map(
					(fieldItemRecord) =>
					{
						if (fieldItemRecord.fieldType !== 'Numeric' || !numericFieldNamesNeedingRealBoundsList.includes(fieldItemRecord.fieldName)) return fieldItemRecord;

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

				finalizeAndApplyRecommendedFields(fieldsWithDataDrivenBoundsArray);
			})
			.catch(() =>
			{
				messageApi.destroy(DP_RECOMMEND_MINMAX_PARSE_MESSAGE_KEY);
				messageApi.warning('讀取資料集計算數值範圍失敗，已套用預設邊界值，請手動確認。');
				finalizeAndApplyRecommendedFields(finalDpFieldsArray);
			});
	};

	const addField = (): void => 
	{
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

	const removeField = (targetFieldIdStr: string): void => 
	{
		setDpFieldsAction(currentDpFieldsList.filter(fieldItemRecord => fieldItemRecord.id !== targetFieldIdStr));
	};

	const dpDataTableColumnsConfig = [
		{
			title: translate('step2.col_name', '欄位名稱'),
			dataIndex: 'fieldName',
			key: 'fieldName',
			width: 140,
			render: (fieldNameTextValue: string, rowRecordItem: DPField) => (
				<Tooltip title={fieldNameTextValue} placement="topLeft" mouseEnterDelay={0.3}>
					<Input 
						value={fieldNameTextValue} 
						onChange={(inputChangeEvent) => updateFieldLocal(rowRecordItem.id, 'fieldName', inputChangeEvent.target.value)}
						placeholder={translate('step2.ph_eg_salary', '例：salary')}
						status={rowRecordItem.enabled && (!fieldNameTextValue || !fieldNameTextValue.trim()) ? 'error' : ''}
						style={{ width: '100%', background: 'transparent', borderRadius: '6px', textOverflow: 'ellipsis' }}
					/>
				</Tooltip>
			),
		},
		{
			title: translate('step2.data_type', '資料型態'),
			dataIndex: 'fieldType',
			key: 'fieldType',
			width: 200,
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
												if (realColumnValuesArray && realColumnValuesArray.length > 0) {
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
			width: 110,
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
			title: (
				<Space>
					{translate('step2.dp_param_settings', '邊界與規則設定')}
					<Tooltip title={translate('step2.dp_param_tooltip', '數值型欄位請填寫可能出現的最小值與最大值，例如年齡 0～120。範圍越大，系統判定的「敏感度」越高、需加入的雜訊也越多，資料會更模糊但保護力更強；範圍設太窄則可能讓超出範圍的真實值被裁剪。日期時間型欄位（如生日）請改選日期。加噪刻度與邊界溢出處理方式請至 Step3 差分隱私規則頁面設定。類別型欄位由系統自動判斷類別數量，不需手動設定。')}>
						<QuestionCircleOutlined style={{ color: token.colorTextDescription, cursor: 'help' }} />
					</Tooltip>
				</Space>
			),
			key: 'bounds',
			width: 260,
			render: (_: unknown, rowRecordItem: DPField) => 
			{
				if (!rowRecordItem.enabled) 
				{
					return <span style={{ color: token.colorTextDescription }}>-</span>;
				}
				
				if (rowRecordItem.fieldType === 'Numeric')
				{
					const isDateTimeFieldStatus = isDateTimeDpField(rowRecordItem.fieldName);
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

						return (
							<Tooltip title={isDateBoundOrderInvalidStatus ? '下限日期必須早於上限日期！' : undefined} open={isDateBoundOrderInvalidStatus} color="volcano">
								<Space.Compact style={{ width: '100%' }}>
									<DatePicker
										placeholder={translate('step2.ph_lower_bound_date', '下限日期')}
										value={lowerDateValue}
										onChange={(pickedDateValue) => updateFieldLocal(rowRecordItem.id, 'lowerBound', pickedDateValue ? pickedDateValue.format('YYYY-MM-DD') : undefined)}
										style={{ width: '50%' }}
										status={!lowerDateValue || isDateBoundOrderInvalidStatus ? 'error' : ''}
									/>
									<DatePicker
										placeholder={translate('step2.ph_upper_bound_date', '上限日期')}
										value={upperDateValue}
										onChange={(pickedDateValue) => updateFieldLocal(rowRecordItem.id, 'upperBound', pickedDateValue ? pickedDateValue.format('YYYY-MM-DD') : undefined)}
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

					const isLowerBoundErrorStatus = isLowerBoundMissingStatus || isBoundOrderInvalidStatus || isBoundRangeCoverageInvalidStatus;
					const isUpperBoundErrorStatus = isUpperBoundMissingStatus || isBoundOrderInvalidStatus || isBoundRangeCoverageInvalidStatus;

					const boundRangeTooltipTitleText = isBoundOrderInvalidStatus
						? "下限值必須嚴格小於上限值！"
						: isBoundRangeCoverageInvalidStatus
							? `此邊界範圍未涵蓋實際資料範圍：有 ${boundRangeCoverageIssueInfo.outOfRangeCount} 筆／共 ${boundRangeCoverageIssueInfo.totalValidValueCount} 筆 (${boundRangeCoverageIssueInfo.percentText}) 資料超出此範圍，加噪後可能產生無意義的異常數值，請擴大邊界範圍或確認資料。`
							: undefined;

					return (
						<Tooltip title={boundRangeTooltipTitleText} open={isBoundOrderInvalidStatus || isBoundRangeCoverageInvalidStatus} color="volcano">
							<Space.Compact style={{ width: '100%' }}>
								<InputNumber
									placeholder={translate('step2.ph_lower_bound', '下限 (Lower Bound)')}
									value={rowRecordItem.lowerBound as number}
									step={resolveInputNumberStepByDecimals(rowRecordItem.lowerBound)}
									onChange={(inputNumberValue) => updateFieldLocal(rowRecordItem.id, 'lowerBound', inputNumberValue === null ? undefined : inputNumberValue)}
									style={{ width: '50%', background: 'transparent' }}
									status={isLowerBoundErrorStatus ? 'error' : ''}
								/>
								<InputNumber
									placeholder={translate('step2.ph_upper_bound', '上限 (Upper Bound)')}
									value={rowRecordItem.upperBound as number}
									step={resolveInputNumberStepByDecimals(rowRecordItem.upperBound)}
									onChange={(inputNumberValue) => updateFieldLocal(rowRecordItem.id, 'upperBound', inputNumberValue === null ? undefined : inputNumberValue)}
									style={{ width: '50%', background: 'transparent' }}
									status={isUpperBoundErrorStatus ? 'error' : ''}
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
			width: 96,
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
			{!validationStatusResult.isValid && (
				<Alert
					title={translate('step2.incomplete_setting', '欄位設定尚未完整')}
					description={
						<span style={{ fontSize: '13px' }}>
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
						<input type="file" accept=".json" ref={fileInputRef} onChange={handleImportJSON} onClick={(mouseClickEvent) => { (mouseClickEvent.target as HTMLInputElement).value = ''; }} style={{ display: 'none' }} />
						<Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>{translate('step2.btn_import', '匯入 JSON 設定檔')}</Button>
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
								
								<div style={{ background: isDarkModeActive ? '#1d1d1d' : '#ffffff', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${token.colorBorderSecondary}` }}>
									<Table dataSource={currentDpFieldsList} columns={dpDataTableColumnsConfig} rowKey="id" pagination={false} size="small" bordered={false} className="attribute-table" scroll={{ x: 900, y: 400 }} />
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
												fontSize: '13px',
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

								<Button type="dashed" block icon={<PlusOutlined />} onClick={addField} style={{ marginTop: '16px' }}>{translate('step2.btn_add_field', '新增自訂欄位')}</Button>
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