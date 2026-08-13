/**
 * ============================================================================
 * 檔案名稱 (File): DifferentialPrivacyMapping.tsx
 * 模組功能 (Description): 差分隱私欄位屬性與邊界對應設定組件 (提供欄位資料型態對映、DP機制開關、裁剪邊界設定、JSON 匯入匯出與智慧推薦功能)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { Card, Table, Select, Button, Input, InputNumber, Switch, theme, Tabs, Space, Collapse, Tooltip, Alert, App as AntdApp } from 'antd';
import { 
	UploadOutlined, DeleteOutlined, PlusOutlined, 
	DatabaseOutlined, CodeOutlined, ThunderboltOutlined, InfoCircleOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next'; 

import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';

/**
 * 預設隱私參數常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
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

/**
 * 函數名稱: createInitialDPFields
 * 函數功能: 依據傳入之資料集欄位名稱陣列，自動建立帶有唯一 ID、預設隱私預算及智慧猜測資料型態之初始 DPField 欄位設定物件陣列。
 * 
 * 輸入參數 (Input):
 *   - columnNameList (string[]): 原始資料集欄位名稱陣列
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - DPField[]: 初始差分隱私欄位設定陣列
 * 呼叫關係 (Call Relations): 於 DifferentialPrivacyMapping 元件載入防呆檢測時被呼叫
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
const createInitialDPFields = (columnNameList: string[]): DPField[] => 
{
	return columnNameList.map(
		(columnNameString, columnIndex) => 
		{
			// 欄位名稱小寫化以利關鍵字比對 (符合規範 g)
			const lowerCaseColumnName = columnNameString.toLowerCase();
			
			// 預測欄位資料型態 (符合規範 g)
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
				epsilon: DEFAULT_EPSILON_BUDGET,
				delta: 1e-5,
				lowerBound: calculatedDefaultType === 'Numeric' ? DEFAULT_NUMERIC_LOWER_BOUND : undefined,
				upperBound: calculatedDefaultType === 'Numeric' ? DEFAULT_NUMERIC_UPPER_BOUND : undefined,
				allowedCategories: ''
			};
		}
	);
};

/**
 * 函數名稱: DifferentialPrivacyMapping
 * 函數功能: 渲染步驟二差分隱私欄位屬性與邊界設定頁面，提供欄位對應表格、即時驗證、智慧推薦設定、JSON 匯入匯出及結構預覽功能。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 差分隱私欄位對應 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被 Step 2 導覽精靈組件載入渲染
 *   - 訂閱並更新 useWorkspaceStore 中的 dpFields、columns 等全域狀態
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function DifferentialPrivacyMapping(): React.ReactElement 
{
	const { token } = theme.useToken();
	
	// 深色主題狀態判定 (符合規範 g)
	const isDarkModeActive = token.colorBgContainer !== '#ffffff';
	
	const { message: messageApi } = AntdApp.useApp();

	const { t: translate } = useTranslation(); 
	
	// 檔案上傳 Input 節點參照 Ref (符合規範 g)
	const fileInputRef = useRef<HTMLInputElement>(null);

	// 從 WorkspaceStore 解構全域狀態與 Setter (符合規範 g, i)
	const { 
		columns: datasetColumnsList,
		dpFields: currentDpFieldsList,
		setDpFields: setDpFieldsAction
	} = useWorkspaceStore();
	
	/**
	 * 函數名稱: updateFieldLocal
	 * 函數功能: 通用局部欄位屬性更新器，依據指定 ID 寫入更新個別 DPField 之屬性值至全域 Store。
	 * 
	 * 輸入參數 (Input):
	 *   - targetFieldIdStr (string): 欲更新之 DPField 唯一識別碼
	 *   - attributeKeyName (AttributeKey): DPField 介面之屬性鍵值
	 *   - newAttributeValueData (DPField[AttributeKey]): 屬性新數值
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 於表格內各 Input、Select onChange 事件中被呼叫
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
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

	// 進入元件時防呆檢測：若全域 columns 有資料但 dpFields 為空，自動呼叫 setDpFields 建立初始清單
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

	// 即時計算全頁面欄位設定完整性與錯誤計數 (符合規範 g)
	const validationStatusResult = useMemo(
		() => 
		{
			let isAllFieldsValidStatus = true;

			let totalErrorFieldsCount = 0;

			currentDpFieldsList.forEach(
				(fieldItemRecord) => 
				{
					if (!fieldItemRecord.enabled) 
					{
						return; 
					}

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
					else if (fieldItemRecord.fieldType === 'Categorical') 
					{
						if (!fieldItemRecord.allowedCategories || fieldItemRecord.allowedCategories.trim() === '') 
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

	/**
	 * 函數名稱: generateExportJSON
	 * 函數功能: 彙整當前 WorkspaceStore 狀態與 dpFields 清單，組裝為標準格式之隱私配置 JSON 物件。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): 
	 *   - Record<string, unknown>: 標準格式之隱私配置檔 JSON 物件
	 * 呼叫關係 (Call Relations): 於即時設定檔預覽 (JSON Preview) 區塊被調用
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
	const generateExportJSON = (): Record<string, unknown> => 
	{
		const currentWorkspaceStoreState = useWorkspaceStore.getState();

		const generatedFieldAttributesMap: Record<string, { type: string; role: string }> = {};

		const formattedDpRulesArray = currentDpFieldsList.map(
			(fieldItemRecord) => 
			{
				let mappedAttributeType = 'string';

				if (fieldItemRecord.fieldType === 'Numeric') 
				{
					mappedAttributeType = 'numeric';
				}
				else if (fieldItemRecord.fieldType === 'Categorical') 
				{
					mappedAttributeType = 'categorical';
				}
				else if (fieldItemRecord.fieldType === 'Text') 
				{
					mappedAttributeType = 'string';
				}

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
					allowedCategories: fieldItemRecord.allowedCategories || '',
					maxLength: fieldItemRecord.maxLength ? Number(fieldItemRecord.maxLength) : undefined
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
	 * 函數名稱: handleImportJSON
	 * 函數功能: 讀取並解析使用者上傳之 JSON 設定檔，支援陣列格式與標準 Master 結構格式，反寫回全域 Store。
	 * 
	 * 輸入參數 (Input):
	 *   - fileChangeEventObj (React.ChangeEvent<HTMLInputElement>): 檔案選取變更事件物件
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於隱藏式 file Input 之 onChange 事件
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
	const handleImportJSON = (fileChangeEventObj: React.ChangeEvent<HTMLInputElement>): void => 
	{
		const targetUploadedFile = fileChangeEventObj.target.files?.[0];

		if (!targetUploadedFile) 
		{
			return;
		}

		const jsonFileReaderInstance = new FileReader();

		jsonFileReaderInstance.onload = (fileReaderEventObj) => 
		{
			try 
			{
				const parsedJsonContentData = JSON.parse(fileReaderEventObj.target?.result as string);
				
				/**
				 * JSON 解析對應項目結構定義
				 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
				 */
				type DpRuleItem = {
					id?: string;
					fieldName?: string;
					field_name?: string;
					field?: string;
					fieldType?: DPField['fieldType'];
					field_type?: DPField['fieldType'];
					enabled?: boolean;
					mode?: 'epsilon' | 'epsilon-delta';
					epsilon?: number;
					delta?: number;
					lowerBound?: number;
					upperBound?: number;
					allowedCategories?: string;
					maxLength?: number;
					bounds?: { lower?: number; upper?: number };
					allowed_categories?: string[] | string;
					max_length?: number;
				};

				/**
				 * 欄位機制配置結構定義
				 * 規範對照: 符合規範 h) 資料結構宣告註記
				 */
				type FieldMechanismItem = {
					mechanism_type?: string;
					budget_model?: string;
					epsilon_budget?: number;
					delta_budget?: number;
					clipping_bounds?: { min?: number; max?: number };
					out_of_bounds_strategy?: string;
					rounding_step?: number;
				};

				const baseColumnsForMappingArray = parsedJsonContentData.columns && Array.isArray(parsedJsonContentData.columns) && parsedJsonContentData.columns.length > 0 
					? parsedJsonContentData.columns 
					: datasetColumnsList;

				const columnIndexMappingDict = new Map<string, number>();

				baseColumnsForMappingArray.forEach(
					(columnNameStr: string, indexPositionNumber: number) => 
					{
						columnIndexMappingDict.set(columnNameStr, indexPositionNumber);
					}
				);

				// 處理簡單陣列 JSON 匯入格式
				if (Array.isArray(parsedJsonContentData)) 
				{
					const parsedDpRuleArray = (parsedJsonContentData as DpRuleItem[]).map(
						(ruleItemRecord, itemIndexNumber) => 
						(
							{
								id: ruleItemRecord.id || `dp_col_${itemIndexNumber}_${Date.now()}`,
								fieldName: ruleItemRecord.fieldName || ruleItemRecord.field_name || `column_${itemIndexNumber}`,
								fieldType: ruleItemRecord.fieldType || ruleItemRecord.field_type || 'Unknown',
								enabled: typeof ruleItemRecord.enabled === 'boolean' ? ruleItemRecord.enabled : true,
								mode: ruleItemRecord.mode || 'epsilon',
								epsilon: ruleItemRecord.epsilon ?? DEFAULT_EPSILON_BUDGET,
								delta: ruleItemRecord.delta ?? DEFAULT_DELTA_BUDGET,
								lowerBound: ruleItemRecord.lowerBound ?? ruleItemRecord.bounds?.lower,
								upperBound: ruleItemRecord.upperBound ?? ruleItemRecord.bounds?.upper,
								allowedCategories: ruleItemRecord.allowedCategories ?? (Array.isArray(ruleItemRecord.allowed_categories) ? ruleItemRecord.allowed_categories.join(',') : ''),
								maxLength: ruleItemRecord.maxLength ?? ruleItemRecord.max_length
							}
						)
					);

					parsedDpRuleArray.sort(
						(firstRuleItem, secondRuleItem) => 
						{
							const firstIndexValue = columnIndexMappingDict.has(firstRuleItem.fieldName) ? columnIndexMappingDict.get(firstRuleItem.fieldName)! : 999;

							const secondIndexValue = columnIndexMappingDict.has(secondRuleItem.fieldName) ? columnIndexMappingDict.get(secondRuleItem.fieldName)! : 999;

							return firstIndexValue - secondIndexValue;
						}
					);

					setDpFieldsAction(parsedDpRuleArray as DPField[]);

					messageApi.success(
						translate('message.import_array_json_success', '成功匯入欄位設定陣列！')
					);

					return;
				} 

				// 處理標準 Master 完整 JSON 匯入格式
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

							if (currentAttributeItem.type === 'numeric') 
							{
								mappedFieldTypeValue = 'Numeric';
							}
							else if (currentAttributeItem.type === 'categorical') 
							{
								mappedFieldTypeValue = 'Categorical';
							}
							else if (['string', 'temporal'].includes(currentAttributeItem.type)) 
							{
								mappedFieldTypeValue = currentAttributeItem.role === 'identifier' ? 'Text' : 'Categorical';
							}

							const hasRuleSettingData = Boolean(currentMechanismItem || currentRuleObjectItem || currentRuleArrayItem);

							let isFieldEnabledStatus = mappedFieldTypeValue !== 'Text' && currentAttributeItem.role !== 'identifier' && hasRuleSettingData;
							
							const explicitEnabledConfig = currentRuleArrayItem?.enabled ?? currentRuleObjectItem?.enabled;

							if (typeof explicitEnabledConfig === 'boolean') 
							{
								isFieldEnabledStatus = explicitEnabledConfig;
							}

							const calculatedEpsilonValue = currentMechanismItem?.epsilon_budget ?? currentRuleArrayItem?.epsilon ?? currentRuleObjectItem?.epsilon ?? DEFAULT_EPSILON_BUDGET;

							const calculatedDeltaValue = currentMechanismItem?.delta_budget ?? currentRuleArrayItem?.delta ?? currentRuleObjectItem?.delta ?? DEFAULT_DELTA_BUDGET;

							const calculatedModeValue: 'epsilon' | 'epsilon-delta' = (calculatedDeltaValue && calculatedDeltaValue > 0) ? 'epsilon-delta' : 'epsilon';

							const calculatedLowerBoundValue = currentMechanismItem?.clipping_bounds?.min ?? currentRuleArrayItem?.lowerBound ?? currentRuleArrayItem?.bounds?.lower ?? currentRuleObjectItem?.lowerBound ?? currentRuleObjectItem?.bounds?.lower;

							const calculatedUpperBoundValue = currentMechanismItem?.clipping_bounds?.max ?? currentRuleArrayItem?.upperBound ?? currentRuleArrayItem?.bounds?.upper ?? currentRuleObjectItem?.upperBound ?? currentRuleObjectItem?.bounds?.upper;

							let calculatedAllowedCategoriesValue = currentRuleArrayItem?.allowedCategories ?? currentRuleObjectItem?.allowedCategories ?? '';

							if (!calculatedAllowedCategoriesValue && mappedFieldTypeValue === 'Categorical' && parsedJsonContentData.categorical_hierarchies?.[targetFieldNameString]?.mapping) 
							{
								calculatedAllowedCategoriesValue = Object.keys(parsedJsonContentData.categorical_hierarchies[targetFieldNameString].mapping).join(',');
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
						(firstExtractedField, secondExtractedField) => 
						{
							const firstIndexValue = columnIndexMappingDict.has(firstExtractedField.fieldName) ? columnIndexMappingDict.get(firstExtractedField.fieldName)! : 999;

							const secondIndexValue = columnIndexMappingDict.has(secondExtractedField.fieldName) ? columnIndexMappingDict.get(secondExtractedField.fieldName)! : 999;

							return firstIndexValue - secondIndexValue;
						}
					);

					if (parsedJsonContentData.preprocessing_rules) 
					{
						useWorkspaceStore.setState({ 
							preprocessingRules: parsedJsonContentData.preprocessing_rules as Record<string, { action: string; param: string }>
						});
					}

					const globalDeltaConfigValue = parsedJsonContentData.privacy_targets?.differential_privacy?.global_delta ?? parsedJsonContentData.privacy_targets?.differential_privacy?.global_target_delta;

					const globalEpsilonConfigValue = parsedJsonContentData.privacy_targets?.differential_privacy?.global_epsilon ?? parsedJsonContentData.privacy_targets?.differential_privacy?.budget_limit;
					
					if (globalDeltaConfigValue !== undefined) 
					{
						useWorkspaceStore.setState({ targetDelta: globalDeltaConfigValue });
					}

					if (globalEpsilonConfigValue !== undefined) 
					{
						useWorkspaceStore.setState({ budgetLimitEpsilon: globalEpsilonConfigValue });
					}

					setDpFieldsAction(extractedNewFieldsArray);

					messageApi.success(
						translate('message.import_master_json_success', '成功匯入隱私設定檔！')
					);
				} 
				else 
				{
					messageApi.error(
						translate('message.import_json_format_error', 'JSON 格式不符合規範！')
					);
				}
			} 
			catch (jsonParsingErrorExecution) 
			{
				console.error("JSON Import Error:", jsonParsingErrorExecution);

				messageApi.error(
					translate('message.import_json_error', '解析 JSON 檔案失敗！')
				);
			} 
			finally 
			{
				if (fileInputRef.current) 
				{
					fileInputRef.current.value = ''; 
				}
			}
		};

		jsonFileReaderInstance.readAsText(targetUploadedFile);
	};

	/**
	 * 函數名稱: handleApplyRecommendations
	 * 函數功能: 依據欄位名稱關鍵字規則自動為所有欄位推導推薦之型態、開關與預設邊界 (例如: Numeric 預設 0~100)。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於「自動智慧推薦」按鈕之 onClick 事件
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
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

					if (recommendedLowerBoundVal === undefined) 
					{
						recommendedLowerBoundVal = DEFAULT_NUMERIC_LOWER_BOUND;
					}

					if (recommendedUpperBoundVal === undefined) 
					{
						recommendedUpperBoundVal = DEFAULT_NUMERIC_UPPER_BOUND;
					}
				} 
				else if (/(disease|gender|zipcode|station|city|region|type|category)/.test(lowerCaseFieldNameStr)) 
				{
					recommendedIsEnabledStatus = true; 

					recommendedFieldTypeVal = 'Categorical';
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
					upperBound: recommendedUpperBoundVal
				};
			}
		);
		
		setDpFieldsAction(recommendedUpdatedFieldsArray);

		messageApi.success(
			translate('message.apply_recommend_dp_success', '已成功套用智慧推薦設定！')
		);
	};

	/**
	 * 函數名稱: addField
	 * 函數功能: 手動在對應表格末尾新增一筆自訂之 DPField 設定項目。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於「新增自訂欄位」按鈕之 onClick 事件
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
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

	/**
	 * 函數名稱: removeField
	 * 函數功能: 依據指定 ID 刪除對應之 DPField 欄位項目。
	 * 
	 * 輸入參數 (Input):
	 *   - targetFieldIdStr (string): 欲刪除欄位之唯一識別碼
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於表格操作列刪除按鈕之 onClick 事件
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
	const removeField = (targetFieldIdStr: string): void => 
	{
		setDpFieldsAction(
			currentDpFieldsList.filter(fieldItemRecord => fieldItemRecord.id !== targetFieldIdStr)
		);
	};

	// Ant Design Table 欄位定義清單 (符合規範 g, h)
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
									fieldItemRecord => fieldItemRecord.id === rowRecordItem.id ? { ...fieldItemRecord, fieldType: newSelectedTypeStr, enabled: newSelectedTypeStr === 'Text' ? false : fieldItemRecord.enabled } : fieldItemRecord
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
										currentDpFieldsList.map(fieldItemRecord => fieldItemRecord.id === rowRecordItem.id ? { ...fieldItemRecord, enabled: !fieldItemRecord.enabled } : fieldItemRecord)
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
					<Tooltip title={translate('step2.dp_param_tooltip', '數值型請填寫上下限；類別型請填寫允許的類別清單 (以逗號分隔)。')}>
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
						<Tooltip 
							title={isBoundOrderInvalidStatus ? "下限值必須嚴格小於上限值！" : undefined} 
							open={isBoundOrderInvalidStatus}
							color="volcano"
						>
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
							placeholder={translate('step2.ph_allowed_categories', '允許類別，以逗號分隔 (例如: A,B,C)')}
							value={rowRecordItem.allowedCategories}
							onChange={(inputChangeEvent) => updateFieldLocal(rowRecordItem.id, 'allowedCategories', inputChangeEvent.target.value)}
							status={!rowRecordItem.allowedCategories || rowRecordItem.allowedCategories.trim() === '' ? 'error' : ''}
							style={{ width: '100%', background: 'transparent', borderRadius: '6px' }}
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

	// 生成即時 JSON 配置預覽數據 (符合規範 g)
	const liveJsonPreviewDataObject = generateExportJSON();

	return (
		<Card variant="borderless" style={{ background: 'transparent', padding: 0 }}>
			{/* 全頁驗證未通過提示 Banner */}
			{!validationStatusResult.isValid && (
				<Alert
					title={translate('step2.incomplete_setting', '欄位設定尚未完整')}
					description={
						<span style={{ fontSize: '13px' }}>
							{translate('step2.incomplete_desc_prefix', '目前共有')} <strong>{validationStatusResult.errorCount}</strong> {translate('step2.incomplete_desc_suffix', '個欄位設定未完成')} (包含未填欄位或下限大於等於上限)
						</span>
					}
					type="error"
					showIcon
					style={{ marginBottom: '16px', padding: '8px 16px', borderRadius: '8px' }}
				/>
			)}

			{/* 欄位對應主要頁籤區塊 */}
			<Tabs 
				defaultActiveKey="1" 
				tabBarExtraContent={
					<Space style={{ paddingBottom: '8px' }}>
						<input 
							type="file" 
							accept=".json" 
							ref={fileInputRef} 
							onChange={handleImportJSON} 
							onClick={(mouseClickEvent) => { (mouseClickEvent.target as HTMLInputElement).value = ''; }} 
							style={{ display: 'none' }} 
						/>

						<Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>{translate('step2.btn_import', '匯入 JSON 設定檔')}</Button>
					</Space>
				}
				items={
					[
						{
							key: '1', 
							label: <span style={{ padding: '0 8px' }}><DatabaseOutlined /> {translate('step2.tab_dp_mapping', '差分隱私欄位對應')}</span>,
							children: (
								<div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: '8px', padding: '16px 20px', background: isDarkModeActive ? '#141414' : '#fafafa' }}>
									
									<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
										<div style={{ fontWeight: 600, color: token.colorText }}>{translate('step2.col_settings_list', '欄位參數設定清單')}</div>

										<Button type="primary" icon={<ThunderboltOutlined />} onClick={handleApplyRecommendations} style={{ background: '#4F46E5', border: 'none', borderRadius: '6px' }}>
											{translate('step2.btn_apply_recommend', '自動智慧推薦')}
										</Button>
									</div>
									
									<div style={{ background: isDarkModeActive ? '#1d1d1d' : '#ffffff', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${token.colorBorderSecondary}` }}>
										<Table 
											dataSource={currentDpFieldsList} 
											columns={dpDataTableColumnsConfig} 
											rowKey="id" 
											pagination={false} 
											size="small" 
											bordered={false} 
											className="attribute-table" 
											scroll={{ y: 400 }} 
										/>
									</div>
									
									<Button type="dashed" block icon={<PlusOutlined />} onClick={addField} style={{ marginTop: '16px' }}>
										{translate('step2.btn_add_field', '新增自訂欄位')}
									</Button>
								</div>
							)
						}
					]
				}
			/>

			{/* 即時 JSON 配置檔結構預覽卡片 */}
			<div style={{ marginTop: '24px' }}>
				<Collapse 
					ghost 
					items={
						[
							{ 
								key: '1', 
								label: (
									<span style={{ fontWeight: 600, color: token.colorTextSecondary }}>
										<CodeOutlined style={{ marginRight: '6px' }} /> {translate('step2.json_preview', '即時設定檔預覽 (JSON Preview)')}
									</span>
								), 
								children: ( 
									<pre 
										style={
											{ 
												textAlign: 'left',      
												maxHeight: '400px',      
												overflowY: 'auto',      
												background: isDarkModeActive ? '#141414' : '#f0f2f5', 
												padding: '16px', 
												borderRadius: '8px', 
												border: `1px solid ${token.colorBorderSecondary}`, 
												overflowX: 'auto', 
												fontSize: '13px', 
												color: isDarkModeActive ? '#a6accd' : '#333', 
												margin: 0 
											}
										}
									> 
										{JSON.stringify(liveJsonPreviewDataObject, null, 2)} 
									</pre> 
								) 
							}
						]
					} 
				/>
			</div>

			{/* 樣式補強與微調 */}
			<style>{`
				.attribute-table .ant-table-thead > tr > th { 
					background: ${isDarkModeActive ? '#262626' : '#fafafa'} !important; 
					border-bottom: 1px solid ${token.colorBorderSecondary} !important; 
					color: ${token.colorTextSecondary} !important; 
					font-weight: 500; 
					white-space: nowrap; 
					padding: 8px 8px !important; 
				}
				.attribute-table .ant-table-tbody > tr > td { 
					border-bottom: 1px solid ${token.colorBorderSecondary} !important; 
					padding: 8px 8px !important; 
				}
				.attribute-table .ant-table-expanded-row > td {
					padding: 0 !important;
				}
			`}</style>
		</Card>
	);
}