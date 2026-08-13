/**
 * ============================================================================
 * 檔案名稱 (File): KAnonymityMapping.tsx
 * 模組功能 (Description): K-匿名欄位屬性與泛化層級對應設定組件 (提供欄位資料型態對映、隱私角色標註、遮蔽與泛化策略配置、階層樹映射表編輯、JSON 匯入匯出與即時預覽)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import React, { useState, useEffect, useRef } from 'react';
import { Card, Table, Select, Button, Input, InputNumber, Segmented, theme, Tabs, Space, Popconfirm, Collapse, Tooltip, App as AntdApp } from 'antd';
import { 
	UploadOutlined, DeleteOutlined, PlusOutlined, 
	SaveOutlined, DatabaseOutlined, SisternodeOutlined, 
	CodeOutlined, ThunderboltOutlined, QuestionCircleOutlined
} from '@ant-design/icons';
import CryptoJS from 'crypto-js';
import { useTranslation } from 'react-i18next'; 

import { useWorkspaceStore } from '../../store/useWorkspaceStore';

/**
 * ============================================================================
 * 魔術數字常數化宣告 (Magic Numbers)
 * ============================================================================
 */
const DEFAULT_PREPROCESS_SYMBOL = '-';
const HASH_PREVIEW_TRUNCATE_LENGTH = 16;
const DEFAULT_MASK_KEEP_CHARS = 2;
const DEFAULT_GENERALIZATION_PARAM = 10;
const DEFAULT_MAX_GENERALIZATION_LEVEL = 2;
const MIN_HIERARCHY_COLUMN_COUNT = 2;

// K-Anonymity / JSON 匯出相關之預設常數
const BASE_DEFAULT_K_ANONYMITY_VALUE = 5;
const BASE_DEFAULT_L_DIVERSITY_VALUE = 2;
const BASE_DEFAULT_T_CLOSENESS_VALUE = 0.15;
const BASE_DEFAULT_SUPPRESSION_LIMIT = 10;

/**
 * ============================================================================
 * 核心資料結構介面宣告 (Core Interfaces)
 * ============================================================================
 */

/**
 * 介面名稱: FieldDef
 * 介面功能: 定義單一資料欄位在 K-Anonymity 去識別化過程中的所有配置屬性。
 */
interface FieldDef 
{
	// 基礎屬性
	id: string;            // [系統用] 欄位唯一識別碼，用於 React 列表渲染的 Key 與狀態比對
	name: string;          // [顯示用] 欄位原始名稱 (對應資料集 Header)
	
	// 資料特徵
	type: string;          // 資料型態：決定可用的泛化策略
	                       // - 'string': 一般字串
	                       // - 'numeric': 連續數值型 (可用區間、捨入)
	                       // - 'temporal': 時間型態 (可用降級)
	                       // - 'categorical': 類別型態 (可用階層樹)
	
	// 隱私模型角色
	role: string;          // 隱私角色：決定此欄位在演算法中的定位
	                       // - 'Identifier': 直接識別碼 (如身分證字號)，必須被遮蔽或刪除
	                       // - 'Quasi-identifier': 準識別碼 (如年齡、郵遞區號)，必須進行泛化以滿足 K 值
	                       // - 'Sensitive': 敏感屬性 (如疾病、薪資)，需受 L-Diversity 保護
	                       // - 'Non-sensitive': 非敏感屬性，可直接保留
	
	// 識別碼處理策略 (適用於 Identifier 角色)
	maskStrategy: string;  // 遮蔽策略：
	                       // - 'none': 不處理 (僅非準識別碼可選)
	                       // - 'keep': 保留前綴 (如 0912******)
	                       // - 'full': 全遮蔽 (變成 ***)
	                       // - 'hash': 單向雜湊 (SHA-256)
	                       // - 'drop': 直接移除該欄位
	maskKeepChars: number; // 保留字元數 (當 maskStrategy 為 'keep' 時生效)
	maskChar: string;      // 遮蔽取代字元 (通常為 '*')
	hashType: string;      // 雜湊演算法種類 ('sha256' | 'md5' | 'sha512')
	
	// 準識別碼泛化策略 (適用於 Quasi-identifier 角色)
	genStrategy: string;   // 泛化策略：
	                       // - numeric: 'binning' (分箱), 'rounding' (捨入), 'segment' (區段)
	                       // - temporal: 'downgrade' (降級，如 YYYY-MM-DD 變 YYYY-MM)
	                       // - categorical: 'tree' (階層樹，需對應 HierarchyTable)
	                       // - string: 'prefix' (保留前綴), 'masking' (遮蔽), 'length' (長度隱藏)
	genParam: number;      // 泛化控制參數 (例如 Binning 的箱寬、Rounding 的基數、Prefix 的保留字數)
	genMaxLevel: number;   // 泛化最高抑制層級 (L0 代表保留原值，L1~L4 代表泛化深度)

	[key: string]: unknown; // 索引簽名，允許將其視為泛用 Record 物件處理
}

/**
 * 介面名稱: HierarchyTable
 * 介面功能: 針對「類別型(Categorical)」準識別碼，定義其由子節點到父節點的泛化樹狀結構。
 */
interface HierarchyTable 
{
	id: string;            // 階層表唯一識別碼
	fieldName: string;     // 綁定之目標欄位名稱 (對應 FieldDef 的 name)
	
	// 二維矩陣 mappings:
	// 第一個索引 [0] 是原始值 (Level 0)
	// 第二個索引 [1] 是第一層泛化 (Level 1)
	// 例: [ ["大安區", "新北市", "台灣"], ["信義區", "台北市", "台灣"] ]
	mappings: string[][];  
	
	[key: string]: unknown;
}

const applyPreprocess = (cellValueData: unknown, actionTypeStr: string, actionParameterStr: string): string => 
{
	if (cellValueData == null || cellValueData === '') 
	{
		return DEFAULT_PREPROCESS_SYMBOL;
	}

	let targetPreprocessString = String(cellValueData);

	if (actionTypeStr === 'none' || !actionTypeStr) 
	{
		return targetPreprocessString;
	}

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
			/* ignore regex syntax error */ 
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

// 全域快取快照變數 (符合規範 g)
let globalCachedKAnonymityFields: FieldDef[] | null = null;
let globalCachedKAnonymityHierarchies: HierarchyTable[] | null = null;
let globalCachedColumnsKeyString: string = '';

export default function KAnonymityMapping(): React.ReactElement 
{
	const { token } = theme.useToken();

	const isDarkModeActive = token.colorBgContainer !== '#ffffff';

	const { t: translate } = useTranslation(); 
	
	const { message: messageApi } = AntdApp.useApp();

	// 從 WorkspaceStore 解構出所有相關變數
	const storeColumnsList = useWorkspaceStore((state) => state.columns);
	const storeColumnRolesMap = useWorkspaceStore((state) => state.columnRoles);
	const storeColumnTypesMap = useWorkspaceStore((state) => state.columnTypes);
	const kAnonymityKValue = useWorkspaceStore((state) => state.kValue);
	const maxSuppressionPercentLimit = useWorkspaceStore((state) => state.maxSuppression);
	const datasetPreviewRowsList = useWorkspaceStore((state) => state.previewData); 
	const setStepValidationAction = useWorkspaceStore((state) => state.setStepValidation);
	const preprocessingRulesMap = useWorkspaceStore((state) => state.preprocessingRules);

	const fileInputRef = useRef<HTMLInputElement>(null);

	// 元件內部狀態：儲存當前的欄位配置與階層表配置
	const [kAnonymityFieldsList, setKAnonymityFieldsList] = useState<FieldDef[]>(globalCachedKAnonymityFields || []);
	const [kAnonymityHierarchiesList, setKAnonymityHierarchiesList] = useState<HierarchyTable[]>(globalCachedKAnonymityHierarchies || []);

	/**
	 * ============================================================================
	 * JSON 匯出生成器註釋區塊
	 * ============================================================================
	 * 函數功能: 彙整當前 UI 所設定的 K-Anonymity 參數，轉換為後端/引擎所需的 Master JSON Schema。
	 */
	const generateExportJSON = (): Record<string, unknown> => 
	{
		// 1. 特徵宣告區塊 (field_attributes): 紀錄每個欄位的隱私角色與底層型態
		const generatedFieldAttributesMap: Record<string, { type: string; role: string }> = {};

		// 2. 遮蔽規則區塊 (masking_rules): 用於 Identifier 的處理設定
		const generatedMaskingRulesMap: Record<string, Record<string, string | number>> = {};

		// 3. 泛化規則區塊 (generalization_rules): 用於 Quasi-identifier 的通則設定
		const generatedGeneralizationRulesMap: Record<string, Record<string, string | number>> = {};

		// 4. 數值分箱字典 (numeric_bins): 當泛化為 binning 時，紀錄專屬之箱寬
		const generatedNumericBinsMap: Record<string, { bin_width: number }> = {};

		// 5. 時間降級字典 (temporal_hierarchies): 當泛化為 downgrade 時的層級轉換
		const generatedTemporalHierarchiesMap: Record<string, { levels: string[] }> = {};

		// 6. 類別樹映射字典 (categorical_hierarchies): 將 HierarchyTable 的 UI 格式轉為 Record<String, String[]> 的樹狀對映
		const generatedCategoricalHierarchiesMap: Record<string, { mapping: Record<string, string[]> }> = {}; 
		
		const currentWorkspaceStoreStateData = useWorkspaceStore.getState();
		const currentPreprocessingRulesData = currentWorkspaceStoreStateData.preprocessingRules || {};

		// 遍歷所有欄位以構建上方字典
		kAnonymityFieldsList.forEach(
			(fieldItemRecord) => 
			{
				if (!fieldItemRecord.name) return;

				// 轉換前端角色名為後端識別常數
				const privacyRoleMappingDict: Record<string, string> = { 
					'Identifier': 'identifier', 
					'Quasi-identifier': 'quasi_identifier', 
					'Sensitive': 'sensitive', 
					'Non-sensitive': 'non_sensitive' 
				};

				generatedFieldAttributesMap[fieldItemRecord.name] = { 
					type: fieldItemRecord.type, 
					role: privacyRoleMappingDict[fieldItemRecord.role] || 'non_sensitive' 
				};

				// 若非準識別碼且有設定遮蔽，組裝 Masking Rule
				if (fieldItemRecord.role !== 'Quasi-identifier' && fieldItemRecord.maskStrategy !== 'none') 
				{
					generatedMaskingRulesMap[fieldItemRecord.name] = {
						strategy: fieldItemRecord.maskStrategy === 'keep' ? 'keep_prefix' : fieldItemRecord.maskStrategy,
						...(fieldItemRecord.maskStrategy === 'keep' ? { keep_chars: fieldItemRecord.maskKeepChars, mask_char: fieldItemRecord.maskChar } : {}),
						...(fieldItemRecord.maskStrategy === 'hash' ? { hash_type: fieldItemRecord.hashType } : {})
					};
				}

				// 若為準識別碼，組裝 Generalization Rule
				if (fieldItemRecord.role === 'Quasi-identifier') 
				{
					generatedGeneralizationRulesMap[fieldItemRecord.name] = { 
						strategy: fieldItemRecord.genStrategy, 
						param: fieldItemRecord.genParam, 
						max_level: fieldItemRecord.genMaxLevel 
					};

					if (fieldItemRecord.type === 'numeric' && fieldItemRecord.genStrategy === 'binning') 
					{
						generatedNumericBinsMap[fieldItemRecord.name] = { bin_width: fieldItemRecord.genParam };
					}

					if (fieldItemRecord.type === 'temporal' && fieldItemRecord.genStrategy === 'downgrade') 
					{
						generatedTemporalHierarchiesMap[fieldItemRecord.name] = { levels: ["day", "month", "year"] };
					}
				}
			}
		);

		// 組裝 Categorical Hierarchy 對應表
		kAnonymityHierarchiesList.forEach(
			(hierarchyTableRecord) => 
			{
				if (!hierarchyTableRecord.fieldName) return;

				const mappingDictionaryData: Record<string, string[]> = {};

				hierarchyTableRecord.mappings.forEach(
					(mappingRowArray) => 
					{ 
						if (mappingRowArray[0]) 
						{
							mappingDictionaryData[mappingRowArray[0]] = mappingRowArray.filter(cellValueStr => cellValueStr !== ''); 
						}
					}
				);

				if (Object.keys(mappingDictionaryData).length > 0) 
				{
					generatedCategoricalHierarchiesMap[hierarchyTableRecord.fieldName] = { mapping: mappingDictionaryData };
				}
			}
		);

		// 最終整合之 Master JSON
		return {
			version: new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-'),
			dataset: currentWorkspaceStoreStateData.fileName || "current_dataset",
			privacy_mode: currentWorkspaceStoreStateData.privacyMode || "k-anonymity",
			columns: currentWorkspaceStoreStateData.columns,
			column_roles: currentWorkspaceStoreStateData.columnRoles,
			column_types: currentWorkspaceStoreStateData.columnTypes,
			privacy_targets: {
				k_anonymity: { 
					enabled: currentWorkspaceStoreStateData.privacyMode === 'k-anonymity', 
					k: kAnonymityKValue ?? BASE_DEFAULT_K_ANONYMITY_VALUE, 
					l: currentWorkspaceStoreStateData.lValue ?? BASE_DEFAULT_L_DIVERSITY_VALUE,
					t: currentWorkspaceStoreStateData.tValue ?? BASE_DEFAULT_T_CLOSENESS_VALUE,
					suppression_method: currentWorkspaceStoreStateData.suppressionMethod ?? "row_suppression", 
					suppression_limit_percent: maxSuppressionPercentLimit ?? BASE_DEFAULT_SUPPRESSION_LIMIT, 
					limit_exceeded_action: currentWorkspaceStoreStateData.limitExceededAction ?? "stop_and_error" 
				},
				differential_privacy: { enabled: false }
			},
			field_attributes: generatedFieldAttributesMap,
			preprocessing_rules: Object.keys(currentPreprocessingRulesData).length > 0 ? currentPreprocessingRulesData : undefined,
			categorical_hierarchies: Object.keys(generatedCategoricalHierarchiesMap).length > 0 ? generatedCategoricalHierarchiesMap : undefined,
			numeric_bins: Object.keys(generatedNumericBinsMap).length > 0 ? generatedNumericBinsMap : undefined,
			temporal_hierarchies: Object.keys(generatedTemporalHierarchiesMap).length > 0 ? generatedTemporalHierarchiesMap : undefined,
			masking_rules: Object.keys(generatedMaskingRulesMap).length > 0 ? generatedMaskingRulesMap : undefined,
			generalization_rules: Object.keys(generatedGeneralizationRulesMap).length > 0 ? generatedGeneralizationRulesMap : undefined
		};
	};

	useEffect(
		() => 
		{
			const preprocessingActionsRequiringParamArray = ['keep_before', 'keep_until', 'regex_replace'];

			const hasPreprocessErrorStatus = storeColumnsList.some(
				(columnNameString) => 
				{
					const currentColumnPreprocessingRule = preprocessingRulesMap?.[columnNameString];

					return currentColumnPreprocessingRule && preprocessingActionsRequiringParamArray.includes(currentColumnPreprocessingRule.action) && (!currentColumnPreprocessingRule.param || currentColumnPreprocessingRule.param.trim() === '');
				}
			);

			if (hasPreprocessErrorStatus) 
			{
				setStepValidationAction(false, translate('step2.preprocess_validation_error', '資料預先處理有未填寫的參數，請確認紅色框線欄位並輸入完畢。'));

				return;
			}

			let validationErrorMessageString = null;

			for (const fieldItemRecord of kAnonymityFieldsList) 
			{
				if (fieldItemRecord.role === 'Identifier' && fieldItemRecord.maskStrategy === 'keep' && (!fieldItemRecord.maskKeepChars || fieldItemRecord.maskKeepChars <= 0)) 
				{
					validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 選擇保留部分字元，其保留字元數必須大於 0。`;

					break;
				}
				
				if (fieldItemRecord.role === 'Quasi-identifier') 
				{
					if (fieldItemRecord.genStrategy === 'tree') 
					{
						const targetHierarchyTableRecord = kAnonymityHierarchiesList.find(
							(hierarchyItemRecord) => hierarchyItemRecord.fieldName === fieldItemRecord.name
						);

						const hasValidTreeMappingStatus = targetHierarchyTableRecord && targetHierarchyTableRecord.mappings.length > 0 && targetHierarchyTableRecord.mappings.some(mappingRowArray => mappingRowArray[0] && mappingRowArray[0].trim() !== '');

						if (!hasValidTreeMappingStatus) 
						{
							validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 選擇「階層樹 (Tree)」泛化，請至「泛化階層映射」分頁設定至少一組有效的對應關係。`;

							break;
						}
					} 
					else if (['binning', 'rounding', 'segment', 'prefix', 'masking', 'length'].includes(fieldItemRecord.genStrategy)) 
					{
						if (fieldItemRecord.genParam === undefined || fieldItemRecord.genParam === null || fieldItemRecord.genParam <= 0) 
						{
							validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 的泛化參數設定有誤 (不可小於等於 0)。`;

							break;
						}
					}
				}
			}

			if (validationErrorMessageString) 
			{
				setStepValidationAction(false, validationErrorMessageString);

				return;
			}

			setStepValidationAction(true, null);
		}, 
		[kAnonymityFieldsList, kAnonymityHierarchiesList, storeColumnsList, preprocessingRulesMap, setStepValidationAction, translate]
	);

	useEffect(
		() => 
		{
			const currentColumnNamesKeyString = JSON.stringify(storeColumnsList);

			if (storeColumnsList.length > 0 && globalCachedColumnsKeyString !== currentColumnNamesKeyString) 
			{
				const currentFieldNamesValidationString = JSON.stringify(kAnonymityFieldsList.map(fieldItemRecord => fieldItemRecord.name));

				if (currentFieldNamesValidationString === currentColumnNamesKeyString) 
				{
					globalCachedColumnsKeyString = currentColumnNamesKeyString;

					return;
				}

				const constructedInitialFieldsList = storeColumnsList.map(
					(columnNameString) => 
					{
						const mappedFieldTypeValue = storeColumnTypesMap[columnNameString] === '數值' ? 'numeric' : storeColumnTypesMap[columnNameString] === '時間' ? 'temporal' : storeColumnTypesMap[columnNameString] === '類別' ? 'categorical' : 'string';

						return {
							id: `field_${Math.random().toString(36).substr(2, 9)}`,
							name: columnNameString,
							type: mappedFieldTypeValue,
							role: storeColumnRolesMap[columnNameString] || 'Non-sensitive',
							maskStrategy: 'none',
							maskKeepChars: DEFAULT_MASK_KEEP_CHARS,
							maskChar: '*',
							hashType: 'sha256', 
							genStrategy: mappedFieldTypeValue === 'numeric' ? 'binning' : mappedFieldTypeValue === 'temporal' ? 'downgrade' : mappedFieldTypeValue === 'categorical' ? 'tree' : 'prefix',
							genParam: mappedFieldTypeValue === 'string' ? DEFAULT_MASK_KEEP_CHARS : DEFAULT_GENERALIZATION_PARAM,
							genMaxLevel: DEFAULT_MAX_GENERALIZATION_LEVEL
						};
					}
				);

				let isTimeoutTaskCancelledStatus = false;

				const initialFieldsRenderTimerId = window.setTimeout(
					() => 
					{
						if (!isTimeoutTaskCancelledStatus) 
						{
							setKAnonymityFieldsList(constructedInitialFieldsList);

							globalCachedKAnonymityFields = constructedInitialFieldsList;

							globalCachedColumnsKeyString = currentColumnNamesKeyString;
						}
					}, 
					0
				);

				return () => 
				{
					isTimeoutTaskCancelledStatus = true;

					window.clearTimeout(initialFieldsRenderTimerId);
				};
			}
		}, 
		[storeColumnsList, storeColumnRolesMap, storeColumnTypesMap, kAnonymityFieldsList]
	);

	useEffect(
		() => 
		{
			const updatedRolesDictionaryMap: Record<string, string> = {};

			const updatedTypesDictionaryMap: Record<string, string> = {};

			const updatedColumnNamesListArray: string[] = [];

			kAnonymityFieldsList.forEach(
				(fieldItemRecord) => 
				{
					if (!fieldItemRecord.name) 
					{
						return;
					}

					updatedRolesDictionaryMap[fieldItemRecord.name] = fieldItemRecord.role;

					updatedTypesDictionaryMap[fieldItemRecord.name] = fieldItemRecord.type === 'string' ? '字串' : fieldItemRecord.type === 'numeric' ? '數值' : fieldItemRecord.type === 'temporal' ? '時間' : '類別';

					updatedColumnNamesListArray.push(fieldItemRecord.name);
				}
			);

			const currentWorkspaceStoreStateData = useWorkspaceStore.getState();

			globalCachedKAnonymityFields = kAnonymityFieldsList;
			
			useWorkspaceStore.setState({ 
				columnRoles: updatedRolesDictionaryMap, 
				columnTypes: updatedTypesDictionaryMap, 
				columns: currentWorkspaceStoreStateData.columns.length > 0 ? currentWorkspaceStoreStateData.columns : updatedColumnNamesListArray 
			});
		}, 
		[kAnonymityFieldsList]
	);

	useEffect(
		() => 
		{
			const validTreeStrategyFieldNamesList = kAnonymityFieldsList.filter(
				(fieldItemRecord) => fieldItemRecord.role === 'Quasi-identifier' && fieldItemRecord.genStrategy === 'tree'
			).map(fieldItemRecord => fieldItemRecord.name);

			const hierarchiesSyncTimerId = window.setTimeout(
				() => 
				{
					setKAnonymityHierarchiesList(
						(previousHierarchiesList) => 
						{
							const nextHierarchiesListArray = previousHierarchiesList.filter(hierarchyItemRecord => hierarchyItemRecord.fieldName === '' || validTreeStrategyFieldNamesList.includes(hierarchyItemRecord.fieldName));

							validTreeStrategyFieldNamesList.forEach(
								(treeStrategyFieldNameString) => 
								{ 
									if (treeStrategyFieldNameString && !nextHierarchiesListArray.some(hierarchyItemRecord => hierarchyItemRecord.fieldName === treeStrategyFieldNameString)) 
									{
										nextHierarchiesListArray.push({ id: `h_${Math.random().toString(36).substr(2, 9)}`, fieldName: treeStrategyFieldNameString, mappings: [['', '']] }); 
									}
								}
							);

							const previousFieldNamesJoinedString = previousHierarchiesList.map(hierarchyItemRecord => hierarchyItemRecord.fieldName).sort().join(',');

							const nextFieldNamesJoinedString = nextHierarchiesListArray.map(hierarchyItemRecord => hierarchyItemRecord.fieldName).sort().join(',');

							return previousFieldNamesJoinedString !== nextFieldNamesJoinedString ? nextHierarchiesListArray : previousHierarchiesList;
						}
					);
				}, 
				0
			);

			return () => 
			{ 
				window.clearTimeout(hierarchiesSyncTimerId); 
			};
		}, 
		[kAnonymityFieldsList]
	);

	useEffect(
		() => 
		{ 
			globalCachedKAnonymityHierarchies = kAnonymityHierarchiesList; 
		}, 
		[kAnonymityHierarchiesList]
	);

	// 同步寫入全域 Zustand Store 快取
	useEffect(
		() => 
		{
			const syncDataToZustandStore = () => 
			{
				const liveJsonExportDataObject = generateExportJSON();

				useWorkspaceStore.setState({
					kAnonymityFields: kAnonymityFieldsList as Record<string, unknown>[],
					kAnonymityHierarchies: kAnonymityHierarchiesList as Record<string, unknown>[],
					fieldAttributes: (liveJsonExportDataObject.field_attributes || {}) as Record<string, unknown>,
					maskingRules: (liveJsonExportDataObject.masking_rules || {}) as Record<string, unknown>,
					generalizationRules: (liveJsonExportDataObject.generalization_rules || {}) as Record<string, unknown>,
					categoricalHierarchies: (liveJsonExportDataObject.categorical_hierarchies || {}) as Record<string, unknown>,
					numericBins: (liveJsonExportDataObject.numeric_bins || {}) as Record<string, unknown>,
					temporalHierarchies: (liveJsonExportDataObject.temporal_hierarchies || {}) as Record<string, unknown>
				});
			};
			
			const storeSyncTimerId = setTimeout(syncDataToZustandStore, 0);

			return () => clearTimeout(storeSyncTimerId);
		}, 
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[kAnonymityFieldsList, kAnonymityHierarchiesList]
	);

	const getTransformedPreview = (cellValueData: unknown, fieldItemConfigRecord: FieldDef): string => 
	{
		if (cellValueData == null || cellValueData === '') 
		{
			return DEFAULT_PREPROCESS_SYMBOL;
		}

		const parsedStringValue = String(cellValueData);

		if (fieldItemConfigRecord.role !== 'Quasi-identifier') 
		{
			if (fieldItemConfigRecord.maskStrategy === 'drop') 
			{
				return translate('step2.removed');
			}

			if (fieldItemConfigRecord.role === 'Identifier') 
			{
				if (fieldItemConfigRecord.maskStrategy === 'full') 
				{
					return '***';
				}

				if (fieldItemConfigRecord.maskStrategy === 'keep') 
				{
					const keepCharactersLengthValue = Math.min(fieldItemConfigRecord.maskKeepChars, parsedStringValue.length);

					return parsedStringValue.substring(0, keepCharactersLengthValue) + fieldItemConfigRecord.maskChar.repeat(Math.max(0, parsedStringValue.length - keepCharactersLengthValue));
				}
			}

			return parsedStringValue; 
		}

		if (fieldItemConfigRecord.role === 'Quasi-identifier') 
		{
			if (fieldItemConfigRecord.genMaxLevel === 0) 
			{
				return parsedStringValue; 
			}

			if (fieldItemConfigRecord.type === 'numeric') 
			{
				const parsedNumericValue = parseFloat(parsedStringValue);

				if (!isNaN(parsedNumericValue) && fieldItemConfigRecord.genParam > 0) 
				{
					if (fieldItemConfigRecord.genStrategy === 'rounding') 
					{
						return String(Math.round(parsedNumericValue / fieldItemConfigRecord.genParam) * fieldItemConfigRecord.genParam);
					}

					if (fieldItemConfigRecord.genStrategy === 'segment') 
					{
						const lowerSegmentBoundValue = Math.floor(parsedNumericValue / fieldItemConfigRecord.genParam) * fieldItemConfigRecord.genParam;

						return `${lowerSegmentBoundValue} - ${lowerSegmentBoundValue + fieldItemConfigRecord.genParam - 1}`;
					}

					const generalizationLevelMultipliersArray = [1, 1, 5, 10, 50];

					const binStepSizeValue = fieldItemConfigRecord.genParam * (generalizationLevelMultipliersArray[fieldItemConfigRecord.genMaxLevel] || 1);

					if (fieldItemConfigRecord.genStrategy === 'binning') 
					{
						const lowerBinBoundValue = Math.floor(parsedNumericValue / binStepSizeValue) * binStepSizeValue;

						return `${lowerBinBoundValue} ~ ${lowerBinBoundValue + binStepSizeValue}`;
					}
				}
			}
			else if (fieldItemConfigRecord.type === 'temporal' && fieldItemConfigRecord.genStrategy === 'downgrade') 
			{
				if (fieldItemConfigRecord.genMaxLevel === 1) 
				{
					return parsedStringValue.substring(0, 10);
				}

				if (fieldItemConfigRecord.genMaxLevel === 2) 
				{
					return parsedStringValue.substring(0, 7);
				}

				if (fieldItemConfigRecord.genMaxLevel >= 3) 
				{
					return parsedStringValue.substring(0, 4);
				}
			}
			else if (fieldItemConfigRecord.type === 'categorical' && fieldItemConfigRecord.genStrategy === 'tree') 
			{
				const targetHierarchyTableRecord = kAnonymityHierarchiesList.find(
					(hierarchyItemRecord) => hierarchyItemRecord.fieldName === fieldItemConfigRecord.name
				);

				if (targetHierarchyTableRecord) 
				{
					const matchedHierarchyMappingRow = targetHierarchyTableRecord.mappings.find(mappingRowArray => mappingRowArray[0] === parsedStringValue);

					if (matchedHierarchyMappingRow) 
					{
						return matchedHierarchyMappingRow[Math.min(fieldItemConfigRecord.genMaxLevel, matchedHierarchyMappingRow.length - 1)] || parsedStringValue;
					}
				}

				return `${translate('step2.undefined_mapping')} ${parsedStringValue}`; 
			}
			else if (fieldItemConfigRecord.type === 'string') 
			{
				let keepCharactersLengthValue = parsedStringValue.length;
				
				if (fieldItemConfigRecord.genStrategy === 'prefix') 
				{
					keepCharactersLengthValue = Math.min(fieldItemConfigRecord.genParam, parsedStringValue.length);

					if (fieldItemConfigRecord.genMaxLevel === 2) 
					{
						keepCharactersLengthValue = Math.floor(keepCharactersLengthValue / 2);
					}

					if (fieldItemConfigRecord.genMaxLevel >= 3) 
					{
						keepCharactersLengthValue = 0;
					}
				} 
				else if (fieldItemConfigRecord.genStrategy === 'masking') 
				{
					const totalMaskCountValue = fieldItemConfigRecord.genParam * fieldItemConfigRecord.genMaxLevel;

					keepCharactersLengthValue = Math.max(0, parsedStringValue.length - totalMaskCountValue);
				}
				else if (fieldItemConfigRecord.genStrategy === 'length') 
				{
					keepCharactersLengthValue = Math.max(0, parsedStringValue.length - fieldItemConfigRecord.genMaxLevel);
				}

				const remainingAsteriskCountValue = Math.max(0, parsedStringValue.length - keepCharactersLengthValue);

				return parsedStringValue.substring(0, keepCharactersLengthValue) + '*'.repeat(remainingAsteriskCountValue);
			}
		}

		return parsedStringValue;
	};

	const handleImportJSON = (fileChangeEventObj: React.ChangeEvent<HTMLInputElement>): void => 
	{
		const targetUploadedFileObj = fileChangeEventObj.target.files?.[0];

		if (!targetUploadedFileObj) 
		{
			return;
		}

		const jsonFileReaderInstance = new FileReader();

		jsonFileReaderInstance.onload = (fileReaderEventObj) => 
		{
			try 
			{
				const parsedJsonContentData = JSON.parse(fileReaderEventObj.target?.result as string);
				
				if (parsedJsonContentData.privacy_targets?.k_anonymity?.enabled) 
				{
					useWorkspaceStore.setState({ 
						privacyMode: 'k-anonymity', 
						kValue: parsedJsonContentData.privacy_targets.k_anonymity.k ?? BASE_DEFAULT_K_ANONYMITY_VALUE, 
						maxSuppression: parsedJsonContentData.privacy_targets.k_anonymity.suppression_limit_percent ?? BASE_DEFAULT_SUPPRESSION_LIMIT 
					});
				}

				const importedAttributesMap = parsedJsonContentData.field_attributes || {};
				const importedMaskingRulesMap = parsedJsonContentData.masking_rules || {};
				const importedGeneralizationRulesMap = parsedJsonContentData.generalization_rules || {}; 
				const importedPreprocessingRulesMap = parsedJsonContentData.preprocessing_rules || {}; 
				
				useWorkspaceStore.setState({ preprocessingRules: importedPreprocessingRulesMap });

				const updatedKAnonymityFieldsList = [...kAnonymityFieldsList]; 
				
				Object.keys(importedAttributesMap).forEach(
					(columnNameString) => 
					{
						const currentAttributeConfig = importedAttributesMap[columnNameString];
						const currentMaskingConfig = importedMaskingRulesMap[columnNameString];
						const currentGeneralizationConfig = importedGeneralizationRulesMap[columnNameString];

						const roleMappingDict: Record<string, string> = { 
							'identifier': 'Identifier', 
							'quasi_identifier': 'Quasi-identifier', 
							'sensitive': 'Sensitive', 
							'non_sensitive': 'Non-sensitive' 
						};

						const mappedPrivacyRoleValue = roleMappingDict[currentAttributeConfig.role as string] || 'Non-sensitive';

						const typeMappingDict: Record<string, string> = { 
							'string': 'string', 
							'temporal': 'temporal', 
							'categorical': 'categorical', 
							'numeric': 'numeric' 
						};

						const mappedFieldTypeValue = typeMappingDict[currentAttributeConfig.type as string] || 'string';
						
						let calculatedMaskingStrategyValue = 'none';

						if (currentMaskingConfig?.strategy === 'keep_prefix' || currentMaskingConfig?.strategy === 'keep_suffix' || currentMaskingConfig?.strategy === 'keep') 
						{
							calculatedMaskingStrategyValue = 'keep';
						}
						else if (currentMaskingConfig?.strategy === 'full') 
						{
							calculatedMaskingStrategyValue = 'full';
						}
						else if (currentMaskingConfig?.strategy === 'hash') 
						{
							calculatedMaskingStrategyValue = 'hash';
						}
						else if (currentMaskingConfig?.strategy === 'drop') 
						{
							calculatedMaskingStrategyValue = 'drop'; 
						}

						let calculatedGeneralizationStrategyValue = mappedFieldTypeValue === 'numeric' ? 'binning' : mappedFieldTypeValue === 'temporal' ? 'downgrade' : mappedFieldTypeValue === 'categorical' ? 'tree' : 'prefix';

						let calculatedGeneralizationParamValue = DEFAULT_GENERALIZATION_PARAM;
						let calculatedMaxGeneralizationLevelValue = DEFAULT_MAX_GENERALIZATION_LEVEL; 

						if (currentGeneralizationConfig) 
						{ 
							calculatedGeneralizationStrategyValue = currentGeneralizationConfig.strategy; 
							calculatedGeneralizationParamValue = currentGeneralizationConfig.param; 
							calculatedMaxGeneralizationLevelValue = currentGeneralizationConfig.max_level; 
						}

						const existingFieldIndexPosition = updatedKAnonymityFieldsList.findIndex(fieldItemRecord => fieldItemRecord.name === columnNameString);

						const newFieldObjectItem: FieldDef = {
							id: existingFieldIndexPosition >= 0 ? updatedKAnonymityFieldsList[existingFieldIndexPosition].id : `field_${Math.random().toString(36).substr(2, 9)}`,
							name: columnNameString, 
							type: mappedFieldTypeValue, 
							role: mappedPrivacyRoleValue, 
							maskStrategy: calculatedMaskingStrategyValue, 
							maskKeepChars: currentMaskingConfig?.keep_chars ?? DEFAULT_MASK_KEEP_CHARS,
							maskChar: currentMaskingConfig?.mask_char ?? '*', 
							hashType: currentMaskingConfig?.hash_type || 'sha256', 
							genStrategy: calculatedGeneralizationStrategyValue,
							genParam: calculatedGeneralizationParamValue, 
							genMaxLevel: calculatedMaxGeneralizationLevelValue
						};

						if (existingFieldIndexPosition >= 0) 
						{
							updatedKAnonymityFieldsList[existingFieldIndexPosition] = newFieldObjectItem; 
						}
						else 
						{
							updatedKAnonymityFieldsList.push(newFieldObjectItem);
						}
					}
				);

				const importedCategoricalHierarchiesMap = parsedJsonContentData.categorical_hierarchies || {};

				const updatedHierarchiesListArray = [...kAnonymityHierarchiesList]; 

				Object.keys(importedCategoricalHierarchiesMap).forEach(
					(columnNameString) => 
					{
						const categoricalMappingsArray = Object.values(importedCategoricalHierarchiesMap[columnNameString].mapping || {}) as string[][];

						const existingHierarchyIndexPosition = updatedHierarchiesListArray.findIndex(hierarchyItemRecord => hierarchyItemRecord.fieldName === columnNameString);

						if (existingHierarchyIndexPosition >= 0) 
						{
							updatedHierarchiesListArray[existingHierarchyIndexPosition].mappings = categoricalMappingsArray;
						}
						else 
						{
							updatedHierarchiesListArray.push({ id: `h_${Math.random().toString(36).substr(2, 9)}`, fieldName: columnNameString, mappings: categoricalMappingsArray });
						}
					}
				);

				const futureColumnsKeyStringList = storeColumnsList.length > 0 ? storeColumnsList : updatedKAnonymityFieldsList.map(fieldItemRecord => fieldItemRecord.name);

				globalCachedColumnsKeyString = JSON.stringify(futureColumnsKeyStringList);
				globalCachedKAnonymityFields = updatedKAnonymityFieldsList; 
				globalCachedKAnonymityHierarchies = updatedHierarchiesListArray;

				setKAnonymityFieldsList(updatedKAnonymityFieldsList); 
				setKAnonymityHierarchiesList(updatedHierarchiesListArray);

				messageApi.success(
					translate('message.import_json_success')
				);
			} 
			catch 
			{ 
				messageApi.error(
					translate('message.import_json_error')
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

		jsonFileReaderInstance.readAsText(targetUploadedFileObj);
	};

	const handleApplyRecommendations = (): void => 
	{
		const recommendedUpdatedFieldsList = kAnonymityFieldsList.map(
			(fieldItemRecord) => 
			{
				const lowerCaseFieldNameString = fieldItemRecord.name.toLowerCase();

				let recommendedPrivacyRoleValue: string; 
				let recommendedMaskingStrategyValue: string; 
				let recommendedGeneralizationStrategyValue = fieldItemRecord.genStrategy;

				if (/(id|name|card|nric|phone|email)/.test(lowerCaseFieldNameString)) 
				{ 
					recommendedPrivacyRoleValue = 'Identifier'; 
					recommendedMaskingStrategyValue = 'hash'; 
				}
				else if (/(date|age|zip|gender|station|city|region)/.test(lowerCaseFieldNameString)) 
				{
					recommendedPrivacyRoleValue = 'Quasi-identifier'; 
					recommendedMaskingStrategyValue = 'none';
					recommendedGeneralizationStrategyValue = fieldItemRecord.type === 'numeric' ? 'binning' : fieldItemRecord.type === 'temporal' ? 'downgrade' : fieldItemRecord.type === 'categorical' ? 'tree' : 'prefix';
				} 
				else if (/(disease|salary|income|fare|credit|amount|ratio|score)/.test(lowerCaseFieldNameString)) 
				{ 
					recommendedPrivacyRoleValue = 'Sensitive'; 
					recommendedMaskingStrategyValue = 'none'; 
				}
				else 
				{ 
					recommendedPrivacyRoleValue = 'Non-sensitive'; 
					recommendedMaskingStrategyValue = 'none'; 
				}

				return { ...fieldItemRecord, role: recommendedPrivacyRoleValue, maskStrategy: recommendedMaskingStrategyValue, genStrategy: recommendedGeneralizationStrategyValue };
			}
		);

		setKAnonymityFieldsList(recommendedUpdatedFieldsList);

		messageApi.success(
			translate('message.apply_recommend_success')
		);
	};

	const handleFieldChange = (targetFieldIdStr: string, targetAttributeKeyName: keyof FieldDef, newAttributeValueData: string | number | null): void => 
	{
		const normalizedAttributeValueData = newAttributeValueData === null ? 0 : newAttributeValueData;

		setKAnonymityFieldsList(
			kAnonymityFieldsList.map(
				(fieldItemRecord) => 
				{
					if (fieldItemRecord.id !== targetFieldIdStr) 
					{
						return fieldItemRecord;
					}

					const previousFieldNameString = fieldItemRecord.name; 

					const updatedFieldObjectItem = { ...fieldItemRecord, [targetAttributeKeyName]: normalizedAttributeValueData };

					if (targetAttributeKeyName === 'role' || targetAttributeKeyName === 'type') 
					{
						if (updatedFieldObjectItem.role === 'Quasi-identifier') 
						{
							if (updatedFieldObjectItem.type === 'numeric') 
							{
								updatedFieldObjectItem.genStrategy = 'binning';
							}
							else if (updatedFieldObjectItem.type === 'temporal') 
							{
								updatedFieldObjectItem.genStrategy = 'downgrade';
							}
							else if (updatedFieldObjectItem.type === 'categorical') 
							{
								updatedFieldObjectItem.genStrategy = 'tree';
							}
							else 
							{
								updatedFieldObjectItem.genStrategy = 'prefix';
							}
						} 
						else 
						{ 
							updatedFieldObjectItem.maskStrategy = 'none'; 
						}
					}

					if (updatedFieldObjectItem.type === 'numeric' && ['rounding', 'segment'].includes(updatedFieldObjectItem.genStrategy) && updatedFieldObjectItem.genMaxLevel > 1) 
					{
						updatedFieldObjectItem.genMaxLevel = 1;
					}

					if (targetAttributeKeyName === 'name' && previousFieldNameString !== normalizedAttributeValueData && previousFieldNameString.trim() !== '') 
					{
						const newFieldNameInputString = String(normalizedAttributeValueData);

						setKAnonymityHierarchiesList(
							previousHierarchiesListArray => previousHierarchiesListArray.map(hierarchyItemRecord => hierarchyItemRecord.fieldName === previousFieldNameString ? { ...hierarchyItemRecord, fieldName: newFieldNameInputString } : hierarchyItemRecord)
						);
					}

					return updatedFieldObjectItem;
				}
			)
		);
	};
	
	const addField = (): void => setKAnonymityFieldsList([...kAnonymityFieldsList, { id: `field_${Date.now()}`, name: '', type: 'string', role: 'Quasi-identifier', maskStrategy: 'none', maskKeepChars: DEFAULT_MASK_KEEP_CHARS, maskChar: '*', hashType: 'sha256', genStrategy: 'prefix', genParam: DEFAULT_GENERALIZATION_PARAM, genMaxLevel: DEFAULT_MAX_GENERALIZATION_LEVEL }]);

	const removeField = (targetFieldIdStr: string): void => 
	{
		const fieldObjectToRemove = kAnonymityFieldsList.find(fieldItemRecord => fieldItemRecord.id === targetFieldIdStr);

		setKAnonymityFieldsList(
			kAnonymityFieldsList.filter(fieldItemRecord => fieldItemRecord.id !== targetFieldIdStr)
		);

		if (fieldObjectToRemove && fieldObjectToRemove.name) 
		{
			setKAnonymityHierarchiesList(
				previousHierarchiesListArray => previousHierarchiesListArray.filter(hierarchyItemRecord => hierarchyItemRecord.fieldName !== fieldObjectToRemove.name)
			);
		}
	};

	/**
	 * ============================================================================
	 * Ant Design 欄位對應表 (Table Columns Configuration)
	 * ============================================================================
	 * 說明: 定義 K-Anonymity 的欄位配置表格，支援各屬性的連動選項與 UI 控制元件。
	 */
	const kAnonymityFieldTableColumnsConfig = [
		{
			// 第 1 欄：欄位名稱輸入
			title: translate('step2.col_name'),
			dataIndex: 'name', width: '15%',
			render: (fieldNameTextValue: string, rowRecordItem: FieldDef) => (
				<Tooltip title={fieldNameTextValue} placement="topLeft" mouseEnterDelay={0.3}>
					<Input value={fieldNameTextValue} onChange={(inputChangeEvent) => handleFieldChange(rowRecordItem.id, 'name', inputChangeEvent.target.value)} placeholder="e.g. age" style={{ width: '100%', textOverflow: 'ellipsis' }} />
				</Tooltip>
			),
		},
		{
			// 第 2 欄：資料型態下拉選單
			title: translate('step2.data_type'),
			dataIndex: 'type', width: '11%',
			render: (fieldTypeTextValue: string, rowRecordItem: FieldDef) => (
				<Select value={fieldTypeTextValue} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'type', dropdownSelectedValue)} style={{ width: '100%' }}>
					<Select.Option value="string">{translate('step2.opt_string')}</Select.Option>
					<Select.Option value="numeric">{translate('step2.opt_numeric')}</Select.Option>
					<Select.Option value="temporal">{translate('step2.opt_temporal')}</Select.Option>
					<Select.Option value="categorical">{translate('step2.opt_categorical')}</Select.Option>
				</Select>
			),
		},
		{
			// 第 3 欄：隱私角色下拉選單
			title: translate('step2.privacy_role'),
			dataIndex: 'role', width: '13%',
			render: (privacyRoleTextValue: string, rowRecordItem: FieldDef) => (
				<Select value={privacyRoleTextValue} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'role', dropdownSelectedValue)} style={{ width: '100%' }}>
					<Select.Option value="Identifier">{translate('step2.opt_identifier')}</Select.Option>
					<Select.Option value="Quasi-identifier">{translate('step2.opt_quasi')}</Select.Option>
					<Select.Option value="Sensitive">{translate('step2.opt_sensitive')}</Select.Option>
					<Select.Option value="Non-sensitive">{translate('step2.opt_non_sensitive')}</Select.Option>
				</Select>
			),
		},
		{
			// 第 4 欄：處理策略 (依據隱私角色與資料型態動態顯示對應選項)
			title: translate('step2.process_strategy'),
			dataIndex: 'strategy', width: '15%',
			render: (_: unknown, rowRecordItem: FieldDef) => 
			{
				// 非準識別碼: 顯示遮蔽策略 (maskStrategy)
				if (rowRecordItem.role !== 'Quasi-identifier') 
				{
					const maskStrategyOptionList = [{ value: 'none', label: translate('step2.opt_keep_original') }, { value: 'drop', label: translate('step2.opt_drop') }];

					if (rowRecordItem.role === 'Identifier') 
					{
						maskStrategyOptionList.splice(1, 0, { value: 'keep', label: translate('step2.opt_keep_chars') }, { value: 'full', label: translate('step2.opt_full_mask') });
					}

					return <Select value={rowRecordItem.maskStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'maskStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={maskStrategyOptionList} />;
				}

				// 準識別碼: 顯示泛化策略 (genStrategy)
				if (rowRecordItem.role === 'Quasi-identifier') 
				{
					if (rowRecordItem.type === 'numeric') 
					{
						return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={[{value:'binning', label: translate('step2.opt_binning')}, {value:'rounding', label: translate('step2.opt_rounding')}, {value:'segment', label: translate('step2.opt_segment')}]} />;
					}

					if (rowRecordItem.type === 'temporal') 
					{
						return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={[{value:'downgrade', label: translate('step2.opt_downgrade')}]} />;
					}

					if (rowRecordItem.type === 'categorical') 
					{
						return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={[{value:'tree', label: translate('step2.opt_tree')}]} />;
					}

					return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={[{value:'masking', label: translate('step2.opt_masking')}, {value:'prefix', label: translate('step2.opt_prefix')}, {value:'length', label: translate('step2.opt_length')}]} />;
				}

				return <span style={{ color: token.colorTextDescription }}>{translate('step2.no_process_needed')}</span>;
			},
		},
		{
			// 第 5 欄：細部參數設定 (動態 InputNumber / Input)
			title: translate('step2.param_setting'),
			key: 'details', width: '18%',
			render: (_: unknown, rowRecordItem: FieldDef) => 
			{
				if (rowRecordItem.role === 'Identifier') 
				{
					if (rowRecordItem.maskStrategy === 'keep') 
					{
						return (
							<Space.Compact style={{ width: '100%' }}>
								<InputNumber value={rowRecordItem.maskKeepChars} onChange={(inputNumberValue) => handleFieldChange(rowRecordItem.id, 'maskKeepChars', inputNumberValue)} min={0} style={{ width: '50%' }} />
								<Input value={rowRecordItem.maskChar} onChange={(inputChangeEvent) => handleFieldChange(rowRecordItem.id, 'maskChar', inputChangeEvent.target.value)} style={{ width: '50%', textAlign: 'center' }} />
							</Space.Compact>
						);
					}
				}

				if (rowRecordItem.role === 'Quasi-identifier') 
				{
					if (rowRecordItem.type === 'numeric') 
					{
						return <InputNumber placeholder={rowRecordItem.genStrategy === 'rounding' ? translate('step2.ph_rounding_base') : translate('step2.ph_bin_size')} value={rowRecordItem.genParam} onChange={(inputNumberValue) => handleFieldChange(rowRecordItem.id, 'genParam', inputNumberValue)} style={{ width: '100%' }} />;
					}
					
					if (rowRecordItem.type === 'string' && ['masking', 'prefix', 'length'].includes(rowRecordItem.genStrategy)) 
					{
						const strategyPlaceholderTextString = rowRecordItem.genStrategy === 'prefix' ? translate('step2.ph_keep_chars') : translate('step2.ph_mask_per_level');

						return <InputNumber placeholder={strategyPlaceholderTextString} value={rowRecordItem.genParam} onChange={(inputNumberValue) => handleFieldChange(rowRecordItem.id, 'genParam', inputNumberValue)} style={{ width: '100%' }} />;
					}
				}

				return <span style={{ color: token.colorTextDescription }}>-</span>;
			},
		},
		{
			// 第 6 欄：最高泛化層級 (動態 Segmented 切換器)
			title: translate('step2.max_level'),
			key: 'level', width: '23%', 
			render: (_: unknown, rowRecordItem: FieldDef) => 
			{
				if (rowRecordItem.role === 'Quasi-identifier') 
				{
					let segmentedLevelOptionList: { label: string; value: number }[] = [];

					if (rowRecordItem.type === 'temporal') 
					{
						segmentedLevelOptionList = [{ label: translate('step2.lvl_exact'), value: 0 }, { label: translate('step2.lvl_day'), value: 1 }, { label: translate('step2.lvl_month'), value: 2 }, { label: translate('step2.lvl_year'), value: 3 }];
					}
					else if (rowRecordItem.type === 'categorical') 
					{ 
						const targetHierarchyTableRecord = kAnonymityHierarchiesList.find(
							(hierarchyItemRecord) => hierarchyItemRecord.fieldName === rowRecordItem.name
						);

						const maxLevelCalculatedValue = targetHierarchyTableRecord ? Math.max(...targetHierarchyTableRecord.mappings.map(mappingRowArray => mappingRowArray.length), 2) - 1 : 3;

						segmentedLevelOptionList.push({ label: translate('step2.lvl_original'), value: 0 });

						for (let levelIndexLoopVar = 1; levelIndexLoopVar <= maxLevelCalculatedValue; levelIndexLoopVar++) 
						{
							segmentedLevelOptionList.push({ label: `L${levelIndexLoopVar}`, value: levelIndexLoopVar });
						}
					}
					else if (rowRecordItem.type === 'string') 
					{
						segmentedLevelOptionList = [{ label: translate('step2.lvl_original'), value: 0 }, { label: translate('step2.lvl_mask1'), value: 1 }, { label: translate('step2.lvl_mask_half'), value: 2 }, { label: translate('step2.lvl_mask_all'), value: 3 }];
					}
					else if (rowRecordItem.type === 'numeric') 
					{ 
						if (rowRecordItem.genStrategy === 'rounding' || rowRecordItem.genStrategy === 'segment') 
						{
							segmentedLevelOptionList = [{ label: translate('step2.lvl_original'), value: 0 }, { label: translate('step2.lvl_enable'), value: 1 }];
						}
						else 
						{
							segmentedLevelOptionList = [{ label: translate('step2.lvl_original'), value: 0 }, { label: 'L1', value: 1 }, { label: 'L2', value: 2 }, { label: 'L3', value: 3 }, { label: 'L4', value: 4 }];
						}
					}

					return <div style={{ padding: '0 2px' }}><Segmented size="small" options={segmentedLevelOptionList} value={rowRecordItem.genMaxLevel} onChange={(selectedSegmentedLevelValue) => handleFieldChange(rowRecordItem.id, 'genMaxLevel', selectedSegmentedLevelValue as number)} block /></div>;
				}

				return <span style={{ color: token.colorTextDescription }}>-</span>;
			},
		},
		{ title: translate('step2.action'), key: 'action', width: '5%', align: 'center' as const, render: (_: FieldDef, rowRecordItem: FieldDef) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeField(rowRecordItem.id)} /> },
	];

	const addHierarchyTable = (): void => setKAnonymityHierarchiesList([...kAnonymityHierarchiesList, { id: `h_${Date.now()}`, fieldName: '', mappings: [['', '']] }]);

	const removeHierarchyTable = (targetHierarchyTableIdStr: string): void => setKAnonymityHierarchiesList(kAnonymityHierarchiesList.filter(hierarchyItemRecord => hierarchyItemRecord.id !== targetHierarchyTableIdStr));

	const updateHierarchyField = (targetHierarchyTableIdStr: string, newFieldNameString: string): void => setKAnonymityHierarchiesList(kAnonymityHierarchiesList.map(hierarchyItemRecord => hierarchyItemRecord.id === targetHierarchyTableIdStr ? { ...hierarchyItemRecord, fieldName: newFieldNameString } : hierarchyItemRecord));

	const addMappingRow = (targetHierarchyTableIdStr: string): void => setKAnonymityHierarchiesList(kAnonymityHierarchiesList.map(hierarchyItemRecord => { if (hierarchyItemRecord.id === targetHierarchyTableIdStr) { const columnCountValue = hierarchyItemRecord.mappings.length > 0 ? hierarchyItemRecord.mappings[0].length : 2; return { ...hierarchyItemRecord, mappings: [...hierarchyItemRecord.mappings, Array(columnCountValue).fill('')] }; } return hierarchyItemRecord; }));

	const updateMappingCell = (targetHierarchyTableIdStr: string, targetRowIndexNumber: number, targetColIndexNumber: number, newCellValueString: string): void => setKAnonymityHierarchiesList(kAnonymityHierarchiesList.map(hierarchyItemRecord => { if (hierarchyItemRecord.id === targetHierarchyTableIdStr) { const newMappingsArrayData = [...hierarchyItemRecord.mappings]; const newRowArrayData = [...newMappingsArrayData[targetRowIndexNumber]]; newRowArrayData[targetColIndexNumber] = newCellValueString; if (targetColIndexNumber === newRowArrayData.length - 1 && newCellValueString !== '') newMappingsArrayData.forEach(mappingRowArray => mappingRowArray.push('')); newMappingsArrayData[targetRowIndexNumber] = newRowArrayData; return { ...hierarchyItemRecord, mappings: newMappingsArrayData }; } return hierarchyItemRecord; }));

	const removeMappingRow = (targetHierarchyTableIdStr: string, targetRowIndexNumber: number): void => setKAnonymityHierarchiesList(kAnonymityHierarchiesList.map(hierarchyItemRecord => hierarchyItemRecord.id === targetHierarchyTableIdStr ? { ...hierarchyItemRecord, mappings: hierarchyItemRecord.mappings.filter((_, mappingRowIndex) => mappingRowIndex !== targetRowIndexNumber) } : hierarchyItemRecord));

	const liveJsonPreviewDataObject = generateExportJSON();

	return (
		<Card variant="borderless" style={{ background: 'transparent', padding: 0 }}>
			<Tabs 
				defaultActiveKey="1" 
				tabBarExtraContent={
					<Space style={{ paddingBottom: '8px' }}>
						<input type="file" accept=".json" ref={fileInputRef} onChange={handleImportJSON} onClick={(fileInputEvent) => { (fileInputEvent.target as HTMLInputElement).value = ''; }} style={{ display: 'none' }} />
						<Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>{translate('step2.btn_import')}</Button>
					</Space>
				}
				items={
					[
						{
							key: '1', label: <span style={{ padding: '0 8px' }}><DatabaseOutlined /> {translate('step2.tab_mapping')}</span>,
							children: (
								<div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: '8px', padding: '16px 20px', background: isDarkModeActive ? '#141414' : '#fafafa' }}>
									
									<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
										<div style={{ fontWeight: 600, color: token.colorText }}>{translate('step2.col_settings_list')}</div>

										<Button type="primary" icon={<ThunderboltOutlined />} onClick={handleApplyRecommendations} style={{ background: '#4F46E5', border: 'none', borderRadius: '6px' }}>
											{translate('step2.btn_apply_recommend')}
										</Button>
									</div>
									
									<div style={{ background: isDarkModeActive ? '#1d1d1d' : '#ffffff', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${token.colorBorderSecondary}` }}>
										<Table 
											dataSource={kAnonymityFieldsList} 
											columns={kAnonymityFieldTableColumnsConfig} 
											rowKey="id" 
											pagination={false} 
											size="small" 
											bordered={false} 
											className="attribute-table" 
											scroll={{ y: 400 }} 
											expandable={
												{ 
													expandedRowRender: (rowRecordItem) => 
													{ 
														const currentWorkspaceStoreStateData = useWorkspaceStore.getState();

														const currentPreprocessingRulesMap = currentWorkspaceStoreStateData.preprocessingRules || {};

														const targetColumnPreprocessingRule = currentPreprocessingRulesMap[rowRecordItem.name] || { action: 'none', param: '' };

														const samplePreviewRowsDataArray = datasetPreviewRowsList.slice(0, 3).map(
															(dataRowRecordItem, rowIndexNumber) => 
															{
																const rawStringValueData = String(dataRowRecordItem[rowRecordItem.name] || '-');

																const preprocessedStringValueData = applyPreprocess(rawStringValueData, targetColumnPreprocessingRule.action, targetColumnPreprocessingRule.param);

																const transformedStringValueData = getTransformedPreview(preprocessedStringValueData, rowRecordItem);

																return { key: rowIndexNumber, raw: rawStringValueData, preprocessed: preprocessedStringValueData, transformed: transformedStringValueData };
															}
														); 
														
														const hasPreprocessActionConfigured = targetColumnPreprocessingRule.action && targetColumnPreprocessingRule.action !== 'none';

														const previewTableColumnsConfig = [
															{ title: translate('step2.preview_raw'), dataIndex: 'raw', key: 'raw', width: hasPreprocessActionConfigured ? '33%' : '50%' },
															...(hasPreprocessActionConfigured ? [{ title: translate('step2.preview_preprocessed'), dataIndex: 'preprocessed', key: 'preprocessed', className: 'preprocessed-col', width: '33%' }] : []),
															{ title: translate('step2.preview_transformed'), dataIndex: 'transformed', key: 'transformed', width: hasPreprocessActionConfigured ? '34%' : '50%' }
														];

														return ( 
															<div style={{ padding: '16px 32px', background: isDarkModeActive ? '#141414' : '#f8fafc', borderTop: `1px solid ${token.colorBorderSecondary}`, margin: 0 }}> 
																<div style={{ fontWeight: 600, marginBottom: 12, color: token.colorText }}> {translate('step2.data_preview')} <QuestionCircleOutlined style={{ color: token.colorTextDescription }} /> </div> 
																<Table dataSource={samplePreviewRowsDataArray} pagination={false} size="small" columns={previewTableColumnsConfig} /> 
															</div> 
														); 
													} 
												}
											} 
										/>
									</div>
									
									<Button type="dashed" block icon={<PlusOutlined />} onClick={addField} style={{ marginTop: '16px' }}>{translate('step2.btn_add_field')}</Button>
								</div>
							)
						},
						{
							key: '2', label: <span style={{ padding: '0 8px' }}><SisternodeOutlined /> {translate('step2.tab_hierarchy')}</span>,
							children: (
								<div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
									{kAnonymityHierarchiesList.map(
										(hierarchyTableRecordItem) => 
										{
											const columnCountCalculatedValue = Math.max(...hierarchyTableRecordItem.mappings.map(mappingRowArray => mappingRowArray.length), MIN_HIERARCHY_COLUMN_COUNT);

											return (
												<Card key={hierarchyTableRecordItem.id} size="small" styles={{ header: { background: isDarkModeActive ? '#1f1f1f' : '#f5f5f5', borderBottom: `1px solid ${token.colorBorderSecondary}` } }} style={{ border: `1px solid ${token.colorBorderSecondary}`, boxShadow: 'none' }} title={ <Space> <span style={{ color: token.colorTextSecondary }}>{translate('step2.related_field')}</span> <Select value={hierarchyTableRecordItem.fieldName || undefined} onChange={(dropdownSelectedValue) => updateHierarchyField(hierarchyTableRecordItem.id, dropdownSelectedValue)} placeholder={translate('step2.ph_select_qi')} style={{ width: '250px' }} options={kAnonymityFieldsList.filter(fieldItemRecord => fieldItemRecord.role === 'Quasi-identifier').map(fieldItemRecord => ({ label: fieldItemRecord.name, value: fieldItemRecord.name }))} /> </Space> } extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeHierarchyTable(hierarchyTableRecordItem.id)} />} >
													<div style={{ overflowX: 'auto', paddingBottom: '8px' }}>
														<div style={{ display: 'flex', gap: '8px', marginBottom: '8px', padding: '0 8px' }}>
															<div style={{ flex: 1, minWidth: '150px', color: token.colorTextSecondary, fontSize: '12px' }}>{translate('step2.original_value')}</div>
															{Array.from({ length: columnCountCalculatedValue - 1 }).map((_, levelIndexLoopVar) => ( <div key={levelIndexLoopVar} style={{ flex: 1, minWidth: '150px', color: token.colorTextSecondary, fontSize: '12px' }}>{translate('step2.generalize_level', { level: levelIndexLoopVar + 1 })}</div> ))}
															<div style={{ width: '60px' }}></div>
														</div>

														{hierarchyTableRecordItem.mappings.map(
															(mappingRowArray, rowIndexNumber) => 
															(
																<div key={rowIndexNumber} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
																	{Array.from({ length: columnCountCalculatedValue }).map((_, columnIndexNumber) => ( <Input key={columnIndexNumber} style={{ flex: 1, minWidth: '150px' }} value={mappingRowArray[columnIndexNumber] || ''} onChange={(inputChangeEvent) => updateMappingCell(hierarchyTableRecordItem.id, rowIndexNumber, columnIndexNumber, inputChangeEvent.target.value)} /> ))}
																	<Space style={{ width: '60px', justifyContent: 'center' }}>
																		<Popconfirm title={translate('step2.confirm_delete_row')} onConfirm={() => removeMappingRow(hierarchyTableRecordItem.id, rowIndexNumber)}> <Button type="text" size="small" icon={<DeleteOutlined style={{ color: token.colorTextDescription }} />} /> </Popconfirm>
																		<Button type="primary" size="small" icon={<SaveOutlined />} />
																	</Space>
																</div>
															)
														)}
													</div>

													<Button type="link" icon={<PlusOutlined />} onClick={() => addMappingRow(hierarchyTableRecordItem.id)} style={{ paddingLeft: 0 }}>{translate('step2.btn_add_mapping')}</Button>
												</Card>
											);
										}
									)}

									<Button type="dashed" block size="large" icon={<DatabaseOutlined />} onClick={addHierarchyTable}>{translate('step2.btn_add_hierarchy')}</Button>
								</div>
							)
						}
					]
				}
			/>

			<div style={{ marginTop: '24px' }}>
				<Collapse ghost items={[{ key: '1', label: <span style={{ fontWeight: 600, color: token.colorTextSecondary }}><CodeOutlined style={{ marginRight: '6px' }} /> {translate('step2.json_preview')}</span>, children: ( <pre style={{ background: isDarkModeActive ? '#141414' : '#f0f2f5', padding: '16px', borderRadius: '8px', border: `1px solid ${token.colorBorderSecondary}`, overflowX: 'auto', fontSize: '13px', color: isDarkModeActive ? '#a6accd' : '#333', margin: 0 }}> {JSON.stringify(liveJsonPreviewDataObject, null, 2)} </pre> ) }]} />
			</div>

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
				.preprocessed-col {
					background-color: ${isDarkModeActive ? 'rgba(250, 173, 20, 0.1)' : 'rgba(250, 173, 20, 0.05)'};
				}
			`}</style>
		</Card>
	);
}