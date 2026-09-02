/**
 * ============================================================================
 * 檔案名稱 (File): DifferentialPrivacyMapping.tsx
 * 模組功能 (Description): 差分隱私欄位屬性與邊界對應設定組件 (提供欄位資料型態對映、DP機制開關、裁剪邊界設定、JSON 匯入匯出與智慧推薦功能)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { Card, Table, Select, Button, Input, InputNumber, Switch, Radio, theme, Tabs, Space, Tooltip, Alert, App as AntdApp } from 'antd';
import {
	UploadOutlined, DeleteOutlined, PlusOutlined,
	DatabaseOutlined, CodeOutlined, ThunderboltOutlined, InfoCircleOutlined, CopyOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next'; 

import { useWorkspaceStore, type DPField, type PreprocessingRule } from '../../store/useWorkspaceStore';

/**
 * 預設隱私參數常數宣告
 */
const DEFAULT_EPSILON_BUDGET = 1.0;
const DEFAULT_DELTA_BUDGET = 0.0001;
const DEFAULT_NUMERIC_LOWER_BOUND = 0;
const DEFAULT_NUMERIC_UPPER_BOUND = 100;
const BASE_DEFAULT_K_ANONYMITY_VALUE = 5;
const BASE_DEFAULT_L_DIVERSITY_VALUE = 2;
const BASE_DEFAULT_T_CLOSENESS_VALUE = 0.15;
const BASE_DEFAULT_SUPPRESSION_LIMIT = 10;
const BASE_DEFAULT_SIMULATE_QUERY_COUNT = 1;
const BASE_DEFAULT_BUDGET_LIMIT = 10;

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

			return {
				id: `${columnNameString}-${columnIndex}`,
				fieldName: columnNameString,
				fieldType: calculatedDefaultType,
				enabled: true,
				isSensitive: false,
				epsilon: DEFAULT_EPSILON_BUDGET,
				delta: 1e-5,
				lowerBound: calculatedDefaultType === 'Numeric' ? DEFAULT_NUMERIC_LOWER_BOUND : (calculatedDefaultType === 'Categorical' ? 0 : undefined),
				upperBound: calculatedDefaultType === 'Numeric' ? DEFAULT_NUMERIC_UPPER_BOUND : (calculatedDefaultType === 'Categorical' ? 1 : undefined),
				allowedCategories: calculatedDefaultType === 'Categorical' ? 'auto_extracted' : ''
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

	const { 
		columns: datasetColumnsList,
		dpFields: currentDpFieldsList,
		setDpFields: setDpFieldsAction
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
						else if (Number(fieldItemRecord.lowerBound) >= Number(fieldItemRecord.upperBound)) 
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
		[currentDpFieldsList]
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

		// ★ 規範對照: 依 Open-PETs API 交付文件 4-2 節之設定檔結構——
		//   column_budgets 逐欄指定 type／epsilon／delta／sensitivity，未列入的欄位不加噪、原樣保留；
		//   categorical 採 k-RR 機制，不需 sensitivity。此為後端 /api/v1/dp 實際讀取之設定檔格式，
		//   與上方 differential_privacy_rules (本工具內部編輯狀態格式) 為互補而非互斥。
		const generatedColumnBudgetsMap: Record<string, { type: string; epsilon: number; delta: number; sensitivity?: number }> = {};

		currentDpFieldsList.forEach(
			(fieldItemRecord) => {
				if (!fieldItemRecord.enabled) return;
				if (fieldItemRecord.fieldType !== 'Numeric' && fieldItemRecord.fieldType !== 'Categorical') return;
				if (!fieldItemRecord.fieldName) return;

				const isNumericFieldType = fieldItemRecord.fieldType === 'Numeric';
				const hasValidNumericBounds = fieldItemRecord.lowerBound !== undefined && fieldItemRecord.lowerBound !== null
					&& fieldItemRecord.upperBound !== undefined && fieldItemRecord.upperBound !== null;

				generatedColumnBudgetsMap[fieldItemRecord.fieldName] = {
					type: isNumericFieldType ? 'continuous' : 'categorical',
					epsilon: fieldItemRecord.epsilon || DEFAULT_EPSILON_BUDGET,
					delta: fieldItemRecord.delta || 0,
					...(isNumericFieldType && hasValidNumericBounds
						? { sensitivity: Number(fieldItemRecord.upperBound) - Number(fieldItemRecord.lowerBound) }
						: {})
				};
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
	 * 函數功能: 從 generateExportJSON() 之完整內部狀態結果中，萃取版本／資料集／保護模式等識別性
	 *           中繼資料，並僅保留符合 Open-PETs API 交付文件 config_dp.json 結構之 column_budgets
	 *           欄位，供「即時設定檔預覽」呈現，避免混入 field_attributes／differential_privacy_rules
	 *           等本工具內部專用、後端 /api/v1/dp 並不需要的欄位，造成預覽格式與實際上傳設定檔不一致。
	 */
	const buildSpecCompliantPreviewJSON = (): Record<string, unknown> => {
		const fullExportDataObject = generateExportJSON();

		return {
			version: fullExportDataObject.version,
			dataset: fullExportDataObject.dataset,
			privacy_mode: fullExportDataObject.privacy_mode,
			column_budgets: fullExportDataObject.column_budgets
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

				if (parsedJsonContentData.column_budgets) 
				{
					const columnBudgetsMap = parsedJsonContentData.column_budgets as Record<string, { type?: string, epsilon?: number, delta?: number, sensitivity?: number, allowed_categories?: string }>;
					const extractedNewFieldsArray: DPField[] = [];
					const importedColumnNamesList = Object.keys(columnBudgetsMap);

					importedColumnNamesList.forEach((columnName, index) => {
						const budgetItem = columnBudgetsMap[columnName];
						const rawType = String(budgetItem.type || '').toLowerCase();
						
						let mappedFieldTypeValue: DPField['fieldType'] = 'Unknown';
						if (['continuous', 'numeric', 'datetime'].includes(rawType)) {
							mappedFieldTypeValue = 'Numeric';
						} else if (['categorical'].includes(rawType)) {
							mappedFieldTypeValue = 'Categorical';
						} else if (['string', 'text'].includes(rawType)) {
							mappedFieldTypeValue = 'Text';
						}

						let calcLowerBound: number | undefined = undefined;
						let calcUpperBound: number | undefined = undefined;

						if (mappedFieldTypeValue === 'Numeric') {
							calcLowerBound = 0;
							if (budgetItem.sensitivity !== undefined) {
								calcUpperBound = calcLowerBound + budgetItem.sensitivity;
							} else {
								calcUpperBound = DEFAULT_NUMERIC_UPPER_BOUND;
							}
						} else if (mappedFieldTypeValue === 'Categorical') {
							calcLowerBound = 0;
							calcUpperBound = 1;
						}

						extractedNewFieldsArray.push({
							id: `import_budget_${index}_${Math.random().toString(36).substring(2, 9)}`,
							fieldName: columnName,
							fieldType: mappedFieldTypeValue,
							enabled: mappedFieldTypeValue !== 'Text', 
							mode: (budgetItem.delta && budgetItem.delta > 0) ? 'epsilon-delta' : 'epsilon',
							epsilon: budgetItem.epsilon ?? DEFAULT_EPSILON_BUDGET,
							delta: budgetItem.delta ?? DEFAULT_DELTA_BUDGET,
							lowerBound: calcLowerBound,
							upperBound: calcUpperBound,
							allowedCategories: mappedFieldTypeValue === 'Categorical' ? 'auto_extracted' : ''
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

	const handleApplyRecommendations = (): void => 
	{
		const recommendedUpdatedFieldsArray = currentDpFieldsList.map(
			(fieldItemRecord) => 
			{
				const lowerCaseFieldNameStr = fieldItemRecord.fieldName.toLowerCase();

				let recommendedIsEnabledStatus = fieldItemRecord.enabled;
				let recommendedFieldTypeVal = fieldItemRecord.fieldType;
				let recommendedLowerBoundVal = fieldItemRecord.lowerBound;
				let recommendedUpperBoundVal = fieldItemRecord.upperBound;

				if (/(salary|income|fare|credit|amount|ratio|score|age|mins|count|duration)/.test(lowerCaseFieldNameStr)) 
				{
					recommendedIsEnabledStatus = true; 
					recommendedFieldTypeVal = 'Numeric';

					if (recommendedLowerBoundVal === undefined) recommendedLowerBoundVal = DEFAULT_NUMERIC_LOWER_BOUND;
					if (recommendedUpperBoundVal === undefined) recommendedUpperBoundVal = DEFAULT_NUMERIC_UPPER_BOUND;
				} 
				else if (/(disease|gender|zipcode|station|city|region|type|category)/.test(lowerCaseFieldNameStr)) 
				{
					recommendedIsEnabledStatus = true; 
					recommendedFieldTypeVal = 'Categorical';

					if (recommendedLowerBoundVal === undefined) recommendedLowerBoundVal = 0;
					if (recommendedUpperBoundVal === undefined) recommendedUpperBoundVal = 1;
				} 
				else if (/(id|name|phone|email)/.test(lowerCaseFieldNameStr)) 
				{
					recommendedIsEnabledStatus = false; 
					recommendedFieldTypeVal = 'Text';
				}

				return { 
					...fieldItemRecord, 
					enabled: recommendedIsEnabledStatus, 
					fieldType: recommendedFieldTypeVal !== 'Unknown' ? recommendedFieldTypeVal : fieldItemRecord.fieldType,
					lowerBound: recommendedLowerBoundVal,
					upperBound: recommendedUpperBoundVal,
					allowedCategories: recommendedFieldTypeVal === 'Categorical' ? 'auto_extracted' : fieldItemRecord.allowedCategories
				};
			}
		);
		
		setDpFieldsAction(recommendedUpdatedFieldsArray);
		messageApi.success(translate('message.apply_recommend_dp_success', '已成功套用智慧推薦設定！'));
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
			width: '16%',
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
			width: '14%',
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
												newLower = newLower ?? DEFAULT_NUMERIC_LOWER_BOUND;
												newUpper = newUpper ?? DEFAULT_NUMERIC_UPPER_BOUND;
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
			width: '10%',
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
											return { ...fieldItemRecord, enabled: nextEnabledStatus, isSensitive: nextEnabledStatus ? fieldItemRecord.isSensitive : false };
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
				<Tooltip title={translate('step2.dp_sensitive_col_tooltip', '風險評估時，此欄位將視為「敏感欄位」，其餘已啟用欄位視為「準識別欄位」；僅能指定 1 個已啟用欄位。')}>
					<Space>{translate('step2.dp_sensitive_col', '敏感欄位')}<InfoCircleOutlined style={{ color: token.colorTextDescription }} /></Space>
				</Tooltip>
			),
			key: 'isSensitive',
			width: '10%',
			render: (_: unknown, rowRecordItem: DPField) =>
			{
				const isSelectionDisabled = !rowRecordItem.enabled;

				return (
					<Tooltip title={isSelectionDisabled ? translate('step2.dp_sensitive_requires_enabled', '需先開啟「套用 DP」才能指定為敏感欄位') : ''}>
						<Radio
							checked={!!rowRecordItem.isSensitive}
							disabled={isSelectionDisabled}
							onChange={
								() =>
								{
									setDpFieldsAction(
										currentDpFieldsList.map(fieldItemRecord => ({ ...fieldItemRecord, isSensitive: fieldItemRecord.id === rowRecordItem.id }))
									);
								}
							}
						/>
					</Tooltip>
				);
			},
		},
		{
			title: (
				<Space>
					{translate('step2.dp_param_settings', '邊界與規則設定')}
					<Tooltip title={translate('step2.dp_param_tooltip', '數值型請填寫上下限；類別型系統會自動推演。')}>
						<InfoCircleOutlined style={{ color: token.colorTextDescription }} />
					</Tooltip>
				</Space>
			),
			key: 'bounds',
			width: '55%',
			render: (_: unknown, rowRecordItem: DPField) => 
			{
				if (!rowRecordItem.enabled) 
				{
					return <span style={{ color: token.colorTextDescription }}>-</span>;
				}
				
				if (rowRecordItem.fieldType === 'Numeric') 
				{
					const currentLowerBoundValue = rowRecordItem.lowerBound;
					const currentUpperBoundValue = rowRecordItem.upperBound;
					
					const isLowerBoundMissingStatus = currentLowerBoundValue === undefined || currentLowerBoundValue === null || currentLowerBoundValue === '';
					const isUpperBoundMissingStatus = currentUpperBoundValue === undefined || currentUpperBoundValue === null || currentUpperBoundValue === '';
					const isBoundOrderInvalidStatus = !isLowerBoundMissingStatus && !isUpperBoundMissingStatus && Number(currentLowerBoundValue) >= Number(currentUpperBoundValue);

					const isLowerBoundErrorStatus = isLowerBoundMissingStatus || isBoundOrderInvalidStatus;
					const isUpperBoundErrorStatus = isUpperBoundMissingStatus || isBoundOrderInvalidStatus;

					return (
						<Tooltip title={isBoundOrderInvalidStatus ? "下限值必須嚴格小於上限值！" : undefined} open={isBoundOrderInvalidStatus} color="volcano">
							<Space.Compact style={{ width: '100%' }}>
								<InputNumber
									placeholder={translate('step2.ph_lower_bound', '下限 (Lower Bound)')}
									value={rowRecordItem.lowerBound as number}
									step="any"
									onChange={(inputNumberValue) => updateFieldLocal(rowRecordItem.id, 'lowerBound', inputNumberValue === null ? undefined : inputNumberValue)}
									style={{ width: '50%', background: 'transparent' }}
									status={isLowerBoundErrorStatus ? 'error' : ''}
								/>
								<InputNumber
									placeholder={translate('step2.ph_upper_bound', '上限 (Upper Bound)')}
									value={rowRecordItem.upperBound as number}
									step="any"
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
			width: '5%',
			align: 'center' as const,
			render: (_: unknown, rowRecordItem: DPField) => (
				<Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeField(rowRecordItem.id)} />
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
		<div className="dp-split-layout">
		<div className="dp-split-form-column">
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

			{(() => {
				const enabledDpFieldsListForSensitiveCheck = currentDpFieldsList.filter((fieldItemRecord) => fieldItemRecord.enabled);
				const designatedSensitiveFieldsCount = enabledDpFieldsListForSensitiveCheck.filter((fieldItemRecord) => fieldItemRecord.isSensitive).length;
				if (enabledDpFieldsListForSensitiveCheck.length > 0 && designatedSensitiveFieldsCount !== 1)
				{
					return (
						<Alert
							title={translate('step2.dp_sensitive_missing_title', '尚未指定敏感欄位')}
							description={translate('step2.dp_sensitive_missing_desc', '請在下方欄位清單中，於已啟用之欄位裡指定「恰好 1 個」敏感欄位；其餘已啟用欄位將視為準識別欄位，供第四步風險評估使用。')}
							type="warning" showIcon style={{ marginBottom: '16px', padding: '8px 16px', borderRadius: '8px' }}
						/>
					);
				}
				return null;
			})()}

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
									<Button type="primary" icon={<ThunderboltOutlined />} onClick={handleApplyRecommendations} style={{ background: '#4F46E5', border: 'none', borderRadius: '6px' }}>{translate('step2.btn_apply_recommend', '自動智慧推薦')}</Button>
								</div>
								
								<div style={{ background: isDarkModeActive ? '#1d1d1d' : '#ffffff', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${token.colorBorderSecondary}` }}>
									<Table dataSource={currentDpFieldsList} columns={dpDataTableColumnsConfig} rowKey="id" pagination={false} size="small" bordered={false} className="attribute-table" scroll={{ y: 400 }} />
								</div>
								
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
				.dp-split-layout {
					display: flex;
					align-items: flex-start;
					gap: 24px;
				}
				.dp-split-form-column {
					flex: 2 1 0%;
					min-width: 0;
				}
				.dp-split-preview-column {
					flex: 1 1 0%;
					min-width: 320px;
					position: sticky;
					top: 24px;
				}
				@media (max-width: 1200px) {
					.dp-split-layout {
						flex-direction: column;
					}
					.dp-split-preview-column {
						flex: 1 1 auto;
						width: 100%;
						min-width: 0;
						position: static;
					}
				}
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
		</div>

		<div className="dp-split-preview-column">
			<Card
				variant="borderless"
				title={<span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><CodeOutlined style={{ color: token.colorPrimary }} />{translate('step2.json_preview', '即時設定檔預覽 (JSON Preview)')}</span>}
				extra={<Button size="small" icon={<CopyOutlined />} onClick={handleCopyJsonPreviewToClipboard}>{translate('step2.json_preview_copy', '複製')}</Button>}
				style={{
					background: isDarkModeActive ? '#141414' : '#fafafa',
					border: `1px solid ${token.colorBorderSecondary}`,
					boxShadow: isDarkModeActive ? 'none' : '0 2px 8px rgba(0,0,0,0.04)'
				}}
				styles={{ body: { padding: 0 }, header: { borderBottom: `1px solid ${token.colorBorderSecondary}` } }}
			>
				<div
					style={{
						background: isDarkModeActive ? '#141414' : '#f8fafc',
						borderRadius: '0 0 8px 8px',
						padding: '16px 12px',
						overflow: 'auto',
						maxHeight: 'calc(100vh - 160px)',
						fontSize: '13px',
						fontFamily: 'Consolas, Menlo, Monaco, "Courier New", monospace',
						color: isDarkModeActive ? '#a6accd' : '#333'
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
		</div>
		</div>
	);
}