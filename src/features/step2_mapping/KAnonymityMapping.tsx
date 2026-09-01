/**
 * ============================================================================
 * 檔案名稱 (File): KAnonymityMapping.tsx
 * 模組功能 (Description): K-匿名欄位屬性與泛化層級對應設定組件 (提供欄位資料型態對映、隱私角色標註、遮蔽與泛化策略配置、階層樹映射表編輯、JSON 匯入匯出與即時預覽)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import React, { useState, useEffect, useRef } from 'react';
import { Card, Table, Select, Button, Input, InputNumber, Segmented, theme, Tabs, Space, Popconfirm, Tooltip, App as AntdApp } from 'antd';
import {
    UploadOutlined, DeleteOutlined, PlusOutlined,
    SaveOutlined, DatabaseOutlined, SisternodeOutlined,
    CodeOutlined, ThunderboltOutlined, QuestionCircleOutlined, CopyOutlined
} from '@ant-design/icons';
import CryptoJS from 'crypto-js';
import { useTranslation } from 'react-i18next'; 

import { useWorkspaceStore, type PreprocessingRule } from '../../store/useWorkspaceStore';

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

// JSON 匯入時，"strategy" 欄位之同義字正規化對照表 (符合規範 e) 避免使用不易理解之魔術字串)
const MASK_STRATEGY_ALIAS_MAP: Record<string, string> = {
    'none': 'none',
    'keep': 'keep', 'keep_prefix': 'keep',
    'full': 'full', 'full_mask': 'full', 'mask': 'full',
    'remove': 'remove', 'drop': 'remove',
    'hash': 'hash',
};

// 依隱私角色分類之合法遮蔽策略白名單
// 規範對照: 依 Open-PETs API 交付文件 4-1 節之驗證標準——
//   identifier 一律僅接受 remove，填入其他值 (含 hash／none／keep／full) 將被忽略並退回角色預設值
const VALID_MASK_STRATEGIES_BY_ROLE: Record<string, string[]> = {
    'Identifier': ['remove'],
    'Sensitive': ['none', 'remove'],
    'Non-sensitive': ['none', 'remove'],
};

// 依隱私角色分類之預設遮蔽策略 (Open-PETs API：identifier 為 remove，其餘為 none)
const DEFAULT_MASK_STRATEGY_BY_ROLE: Record<string, string> = {
    'Identifier': 'remove',
    'Sensitive': 'none',
    'Non-sensitive': 'none',
};

/**
 * 函數名稱: normalizeMaskStrategyValue
 * 函數功能: 將匯入 JSON 中 "strategy" 欄位之原始字串正規化為系統內部認可之遮蔽策略代碼，
 *           並依據該欄位隱私角色判斷是否為合法策略；若省略、無法辨識或不適用於該角色，
 *           則依 Open-PETs API 之驗證標準退回該角色之預設策略。
 *
 * 輸入參數 (Input):
 *   - rawStrategyValue (string | undefined): JSON 中原始的 strategy 字串 (如 "hash"、"remove"、"keep_prefix")
 *   - privacyRoleValue (string): 該欄位對應之隱私角色 ('Identifier' | 'Sensitive' | 'Non-sensitive' | 'Quasi-identifier')
 * 輸出參數 (Output): 無
 * 返回值 (Return):
 *   - { strategy: string; isRecognized: boolean }: 正規化後之策略代碼，以及是否為可辨識且合法之策略
 */
const normalizeMaskStrategyValue = (rawStrategyValue: string | undefined, privacyRoleValue: string): { strategy: string; isRecognized: boolean } => {
    const allowedStrategyListForRole = VALID_MASK_STRATEGIES_BY_ROLE[privacyRoleValue];
    const defaultStrategyForRole = DEFAULT_MASK_STRATEGY_BY_ROLE[privacyRoleValue] || 'none';

    if (!rawStrategyValue || !allowedStrategyListForRole) {
        return { strategy: defaultStrategyForRole, isRecognized: true };
    }

    const cleanedStrategyKeyString = String(rawStrategyValue).toLowerCase().trim();
    const aliasedStrategyValue = MASK_STRATEGY_ALIAS_MAP[cleanedStrategyKeyString];

    if (aliasedStrategyValue && allowedStrategyListForRole.includes(aliasedStrategyValue)) {
        return { strategy: aliasedStrategyValue, isRecognized: true };
    }

    return { strategy: defaultStrategyForRole, isRecognized: false };
};

/**
 * ============================================================================
 * 核心資料結構介面宣告 (Core Interfaces)
 * ============================================================================
 */

interface CustomBin {
    min: number | null;
    max: number | null;
    label: string;
}

interface FieldDef 
{
    id: string;            
    name: string;          
    type: string;          
    role: string;          
    maskStrategy: string;  
    maskKeepChars: number; 
    maskChar: string;      
    hashType: string;      
    genStrategy: string;   
    genParam: number;      
    genMaxLevel: number;   
    customBins?: CustomBin[]; 

    [key: string]: unknown; 
}

interface HierarchyTable 
{
    id: string;            
    fieldName: string;     
    mappings: string[][];  

    [key: string]: unknown;
}

const FULLWIDTH_CHAR_CODE_OFFSET = 0xFEE0;
const FULLWIDTH_SPACE_CHAR_CODE = 0x3000;

/**
 * 函數名稱: applyPreprocessStep
 * 函數功能: 依據選定之單一動作與參數集合，對字串執行對應之預處理轉換。與 Step2_Mapping.tsx 之同名函數
 *           邏輯一致，供本頁「欄位參數設定清單」展開列之即時預覽使用。
 */
const applyPreprocessStep = (cellValueStr: string, stepItemRecord: PreprocessingRule): string =>
{
    const { action: actionTypeStr, params: actionParamsDict } = stepItemRecord;

    switch (actionTypeStr)
    {
        case 'trim':
        {
            const trimModeStr = String(actionParamsDict.mode || 'edges');
            return trimModeStr === 'all' ? cellValueStr.replace(/\s+/g, '') : cellValueStr.trim();
        }

        case 'slice':
        {
            const sliceDirectionStr = String(actionParamsDict.direction || 'left');
            const sliceCountNum = Math.max(0, Number(actionParamsDict.count) || 0);

            if (sliceCountNum === 0) return cellValueStr;

            return sliceDirectionStr === 'left'
                ? cellValueStr.slice(sliceCountNum)
                : cellValueStr.slice(0, Math.max(0, cellValueStr.length - sliceCountNum));
        }

        case 'anchor_truncate':
        {
            const anchorCharStr = String(actionParamsDict.anchor || '');
            const anchorDirectionStr = String(actionParamsDict.direction || 'front');
            const keepCountNum = Math.max(0, Number(actionParamsDict.keepCount) || 0);

            if (!anchorCharStr) return cellValueStr;

            const anchorIndexNum = anchorDirectionStr === 'front' ? cellValueStr.indexOf(anchorCharStr) : cellValueStr.lastIndexOf(anchorCharStr);

            if (anchorIndexNum === -1) return cellValueStr;

            if (keepCountNum === 0) return '';

            const extraKeepCountNum = keepCountNum - 1; // 總保留字數含錨點本身，鄰近字元數需扣除錨點的 1 個字

            if (anchorDirectionStr === 'front')
            {
                const frontPartStr = cellValueStr.slice(Math.max(0, anchorIndexNum - extraKeepCountNum), anchorIndexNum);
                return frontPartStr + anchorCharStr;
            }

            const backPartStr = cellValueStr.slice(anchorIndexNum + 1, Math.min(cellValueStr.length, anchorIndexNum + 1 + extraKeepCountNum));
            return anchorCharStr + backPartStr;
        }

        case 'type_cast':
        {
            const targetTypeStr = String(actionParamsDict.targetType || 'integer');

            if (targetTypeStr === 'boolean')
            {
                const normalizedValueStr = cellValueStr.trim().toLowerCase();
                return ['true', '1', 'yes', 'y'].includes(normalizedValueStr) ? 'true' : 'false';
            }

            if (targetTypeStr === 'float')
            {
                const cleanedFloatStr = cellValueStr.replace(/[^0-9.-]/g, '');
                const parsedFloatNum = parseFloat(cleanedFloatStr);
                return Number.isNaN(parsedFloatNum) ? '0' : String(parsedFloatNum);
            }

            const cleanedIntStr = cellValueStr.replace(/[^0-9-]/g, '');
            const parsedIntNum = parseInt(cleanedIntStr, 10);
            return Number.isNaN(parsedIntNum) ? '0' : String(parsedIntNum);
        }

        case 'normalize':
        {
            let normalizedResultStr = cellValueStr;

            if (actionParamsDict.widthMode === 'full_to_half')
            {
                normalizedResultStr = normalizedResultStr
                    .replace(/[！-～]/g, (fullWidthCharStr) => String.fromCharCode(fullWidthCharStr.charCodeAt(0) - FULLWIDTH_CHAR_CODE_OFFSET))
                    .replace(new RegExp(String.fromCharCode(FULLWIDTH_SPACE_CHAR_CODE), 'g'), ' ');
            }

            if (actionParamsDict.caseMode === 'upper') normalizedResultStr = normalizedResultStr.toUpperCase();
            else if (actionParamsDict.caseMode === 'lower') normalizedResultStr = normalizedResultStr.toLowerCase();

            return normalizedResultStr;
        }

        case 'clamp':
        {
            const parsedNumericValue = parseFloat(cellValueStr);
            if (Number.isNaN(parsedNumericValue)) return cellValueStr;

            const lowerBoundNum = actionParamsDict.min !== undefined ? Number(actionParamsDict.min) : -Infinity;
            const upperBoundNum = actionParamsDict.max !== undefined ? Number(actionParamsDict.max) : Infinity;

            return String(Math.min(upperBoundNum, Math.max(lowerBoundNum, parsedNumericValue)));
        }

        case 'hash':
        {
            try
            {
                const algorithmStr = String(actionParamsDict.algorithm || 'sha256');
                const seedModeStr = String(actionParamsDict.seedMode || 'none');

                let seedSuffixStr = '';
                if (seedModeStr === 'fixed') seedSuffixStr = String(actionParamsDict.seedValue || '');
                else if (seedModeStr === 'timestamp') seedSuffixStr = String(Date.now());

                const hashInputStr = cellValueStr + seedSuffixStr;

                let calculatedHashResult = '';
                if (algorithmStr === 'md5') calculatedHashResult = CryptoJS.MD5(hashInputStr).toString();
                else if (algorithmStr === 'sha512') calculatedHashResult = CryptoJS.SHA512(hashInputStr).toString();
                else calculatedHashResult = CryptoJS.SHA256(hashInputStr).toString();

                return calculatedHashResult.substring(0, HASH_PREVIEW_TRUNCATE_LENGTH) + '...';
            }
            catch (hashingErrorExecution)
            {
                console.error('Hashing error:', hashingErrorExecution);
                return 'Hash Error';
            }
        }

        case 'regex_replace':
        {
            const regexPatternStr = String(actionParamsDict.pattern || '');
            const placeholderStr = actionParamsDict.placeholder !== undefined ? String(actionParamsDict.placeholder) : '***';

            if (!regexPatternStr) return cellValueStr;

            try
            {
                const regexMatcherInstance = new RegExp(regexPatternStr, 'g');
                return cellValueStr.replace(regexMatcherInstance, placeholderStr);
            }
            catch
            {
                return cellValueStr;
            }
        }

        default:
            return cellValueStr;
    }
};

/**
 * 函數名稱: applyPreprocessSteps
 * 函數功能: 依序套用同一欄位之多道預處理策略 (由上而下)，上一步驟之輸出即為下一步驟之輸入。
 */
const applyPreprocessSteps = (cellValueData: unknown, stepsArray: PreprocessingRule[]): string =>
{
    if (cellValueData == null || cellValueData === '')
    {
        return DEFAULT_PREPROCESS_SYMBOL;
    }

    return stepsArray.reduce(
        (accumulatedResultString, stepItemRecord) => applyPreprocessStep(accumulatedResultString, stepItemRecord),
        String(cellValueData)
    );
};

const buildExportJSON = (fieldsList: FieldDef[], hierarchiesList: HierarchyTable[]): Record<string, unknown> => {
    const currentWorkspaceStoreStateData = useWorkspaceStore.getState();
    const currentPreprocessingRulesData = currentWorkspaceStoreStateData.preprocessingRules || {};

    const generatedFieldAttributesMap: Record<string, { type: string; role: string, strategy?: string }> = {};
    const generatedMaskingRulesMap: Record<string, Record<string, string | number>> = {};
    const generatedGeneralizationRulesMap: Record<string, Record<string, string | number>> = {};
    const generatedNumericBinsMap: Record<string, { bin_width: number }> = {};
    const generatedGeneralizationHierarchiesMap: Record<string, { bins: CustomBin[] }> = {};
    const generatedTemporalHierarchiesMap: Record<string, { levels: string[] }> = {};
    const generatedCategoricalHierarchiesMap: Record<string, { mapping: Record<string, string[]> }> = {};
    const generatedQiLevelsMap: Record<string, number> = {};

    fieldsList.forEach((fieldItemRecord) => {
        if (!fieldItemRecord.name) return;

        const privacyRoleMappingDict: Record<string, string> = { 
            'Identifier': 'identifier', 
            'Quasi-identifier': 'quasi_identifier', 
            'Sensitive': 'sensitive', 
            'Non-sensitive': 'non_sensitive' 
        };

        const currentRole = privacyRoleMappingDict[fieldItemRecord.role] || 'non_sensitive';
        let outputStrategy = fieldItemRecord.maskStrategy;
        if (outputStrategy === 'drop') outputStrategy = 'remove';

        generatedFieldAttributesMap[fieldItemRecord.name] = { 
            type: fieldItemRecord.type, 
            role: currentRole,
            ...(outputStrategy && outputStrategy !== 'none' && currentRole !== 'quasi_identifier' ? { strategy: outputStrategy } : {})
        };

        if (fieldItemRecord.role !== 'Quasi-identifier' && fieldItemRecord.maskStrategy !== 'none') {
            generatedMaskingRulesMap[fieldItemRecord.name] = {
                strategy: fieldItemRecord.maskStrategy === 'keep' ? 'keep_prefix' : fieldItemRecord.maskStrategy,
                ...(fieldItemRecord.maskStrategy === 'keep' ? { keep_chars: fieldItemRecord.maskKeepChars, mask_char: fieldItemRecord.maskChar } : {}),
                ...(fieldItemRecord.maskStrategy === 'hash' ? { hash_type: fieldItemRecord.hashType } : {})
            };
        }

        if (fieldItemRecord.role === 'Quasi-identifier') {
            generatedQiLevelsMap[fieldItemRecord.name] = fieldItemRecord.genMaxLevel;
            generatedGeneralizationRulesMap[fieldItemRecord.name] = { 
                strategy: fieldItemRecord.genStrategy, 
                param: fieldItemRecord.genParam, 
                max_level: fieldItemRecord.genMaxLevel 
            };

            if (fieldItemRecord.type === 'numeric') {
                if (fieldItemRecord.genStrategy === 'binning') {
                    generatedNumericBinsMap[fieldItemRecord.name] = { bin_width: fieldItemRecord.genParam };
                } else if (fieldItemRecord.genStrategy === 'custom_bins' && fieldItemRecord.customBins) {
                    generatedGeneralizationHierarchiesMap[fieldItemRecord.name] = { bins: fieldItemRecord.customBins };
                }
            }

            if (fieldItemRecord.type === 'temporal' && fieldItemRecord.genStrategy === 'downgrade') {
                generatedTemporalHierarchiesMap[fieldItemRecord.name] = { levels: ["day", "month", "year"] };
            }
        }
    });

    const generatedGeneralizationMatrices: Record<string, string[][]> = {};
    hierarchiesList.forEach((hierarchyTableRecord) => {
        if (!hierarchyTableRecord.fieldName) return;

        const mappingDictionaryData: Record<string, string[]> = {};
        const matricesArray: string[][] = [];

        hierarchyTableRecord.mappings.forEach((mappingRowArray) => { 
            if (mappingRowArray[0]) {
                const validCells = mappingRowArray.filter(cellValueStr => cellValueStr !== '');
                mappingDictionaryData[mappingRowArray[0]] = validCells; 
                matricesArray.push(validCells);
            }
        });

        if (Object.keys(mappingDictionaryData).length > 0) {
            generatedCategoricalHierarchiesMap[hierarchyTableRecord.fieldName] = { mapping: mappingDictionaryData };
            generatedGeneralizationMatrices[hierarchyTableRecord.fieldName] = matricesArray;
        }
    });

    return {
        version: new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-'),
        dataset: currentWorkspaceStoreStateData.fileName || "current_dataset",
        privacy_mode: currentWorkspaceStoreStateData.privacyMode || "k-anonymity",
        columns: generatedFieldAttributesMap,
        column_roles: currentWorkspaceStoreStateData.columnRoles,
        column_types: currentWorkspaceStoreStateData.columnTypes,
        privacy_targets: {
            k_anonymity: { 
                enabled: currentWorkspaceStoreStateData.privacyMode === 'k-anonymity', 
                k: currentWorkspaceStoreStateData.kValue ?? BASE_DEFAULT_K_ANONYMITY_VALUE, 
                l: currentWorkspaceStoreStateData.lValue ?? BASE_DEFAULT_L_DIVERSITY_VALUE,
                t: currentWorkspaceStoreStateData.tValue ?? BASE_DEFAULT_T_CLOSENESS_VALUE,
                suppression_method: currentWorkspaceStoreStateData.suppressionMethod ?? "row_suppression", 
                suppression_limit_percent: currentWorkspaceStoreStateData.maxSuppression ?? BASE_DEFAULT_SUPPRESSION_LIMIT, 
                limit_exceeded_action: currentWorkspaceStoreStateData.limitExceededAction ?? "stop_and_error" 
            },
            differential_privacy: { enabled: false }
        },
        field_attributes: generatedFieldAttributesMap,
        qi_generalization_levels: Object.keys(generatedQiLevelsMap).length > 0 ? generatedQiLevelsMap : undefined,
        generalization_hierarchies: Object.keys(generatedGeneralizationHierarchiesMap).length > 0 ? generatedGeneralizationHierarchiesMap : undefined,
        generalization_matrices: Object.keys(generatedGeneralizationMatrices).length > 0 ? generatedGeneralizationMatrices : undefined,
        preprocessing_rules: Object.keys(currentPreprocessingRulesData).length > 0 ? currentPreprocessingRulesData : undefined,
        categorical_hierarchies: Object.keys(generatedCategoricalHierarchiesMap).length > 0 ? generatedCategoricalHierarchiesMap : undefined,
        numeric_bins: Object.keys(generatedNumericBinsMap).length > 0 ? generatedNumericBinsMap : undefined,
        temporal_hierarchies: Object.keys(generatedTemporalHierarchiesMap).length > 0 ? generatedTemporalHierarchiesMap : undefined,
        masking_rules: Object.keys(generatedMaskingRulesMap).length > 0 ? generatedMaskingRulesMap : undefined,
        generalization_rules: Object.keys(generatedGeneralizationRulesMap).length > 0 ? generatedGeneralizationRulesMap : undefined
    };
};

/**
 * 函數名稱: buildSpecCompliantPreviewJSON
 * 函數功能: 從 buildExportJSON() 之完整內部狀態結果中，萃取版本／資料集／保護模式等識別性中繼資料，
 *           並僅保留符合 Open-PETs API 交付文件 config_kanon.json 結構之欄位 (columns／
 *           generalization_hierarchies／generalization_matrices／qi_generalization_levels)，
 *           供「即時設定檔預覽」呈現，避免混入 column_roles／masking_rules 等本工具內部專用、
 *           後端並不需要的欄位，造成預覽格式與實際上傳設定檔不一致。
 */
const buildSpecCompliantPreviewJSON = (fieldsList: FieldDef[], hierarchiesList: HierarchyTable[]): Record<string, unknown> => {
    const fullExportDataObject = buildExportJSON(fieldsList, hierarchiesList);

    return {
        version: fullExportDataObject.version,
        dataset: fullExportDataObject.dataset,
        privacy_mode: fullExportDataObject.privacy_mode,
        columns: fullExportDataObject.columns,
        ...(fullExportDataObject.generalization_hierarchies ? { generalization_hierarchies: fullExportDataObject.generalization_hierarchies } : {}),
        ...(fullExportDataObject.generalization_matrices ? { generalization_matrices: fullExportDataObject.generalization_matrices } : {}),
        ...(fullExportDataObject.qi_generalization_levels ? { qi_generalization_levels: fullExportDataObject.qi_generalization_levels } : {}),
    };
};

let globalCachedKAnonymityFields: FieldDef[] | null = null;
let globalCachedKAnonymityHierarchies: HierarchyTable[] | null = null;
let globalCachedColumnsKeyString: string = '';

export default function KAnonymityMapping(): React.ReactElement 
{
    const { token } = theme.useToken();
    const isDarkModeActive = token.colorBgContainer !== '#ffffff';
    const { t: translate } = useTranslation(); 
    const { message: messageApi } = AntdApp.useApp();

    const storeColumnsList = useWorkspaceStore((state) => state.columns);
    const storeColumnRolesMap = useWorkspaceStore((state) => state.columnRoles);
    const storeColumnTypesMap = useWorkspaceStore((state) => state.columnTypes);
    const datasetPreviewRowsList = useWorkspaceStore((state) => state.previewData); 
    const setStepValidationAction = useWorkspaceStore((state) => state.setStepValidation);
    const preprocessingRulesMap = useWorkspaceStore((state) => state.preprocessingRules);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const [kAnonymityFieldsList, setKAnonymityFieldsList] = useState<FieldDef[]>(globalCachedKAnonymityFields || []);
    const [kAnonymityHierarchiesList, setKAnonymityHierarchiesList] = useState<HierarchyTable[]>(globalCachedKAnonymityHierarchies || []);

    // 1. 表單防呆驗證
    useEffect(() => {
        // ★ 依 Step2_Mapping.tsx 之預處理動作定義，各動作所需之必填參數鍵值 (符合規範 e)
        const isPreprocessStepMissingRequiredParam = (stepItemRecord: PreprocessingRule): boolean => {
            if (stepItemRecord.action === 'anchor_truncate') {
                return !String(stepItemRecord.params.anchor || '').trim();
            }
            if (stepItemRecord.action === 'regex_replace') {
                return !String(stepItemRecord.params.pattern || '').trim();
            }
            if (stepItemRecord.action === 'hash' && stepItemRecord.params.seedMode === 'fixed') {
                return !String(stepItemRecord.params.seedValue || '').trim();
            }
            return false;
        };

        const hasPreprocessErrorStatus = storeColumnsList.some((columnNameString) => {
            const currentColumnPreprocessingSteps = preprocessingRulesMap?.[columnNameString];
            return currentColumnPreprocessingSteps?.some(isPreprocessStepMissingRequiredParam) ?? false;
        });

        if (hasPreprocessErrorStatus) {
            setStepValidationAction(false, translate('step2.preprocess_validation_error', '資料預先處理有未填寫的參數，請確認紅色框線欄位並輸入完畢。'));
            return;
        }

        let validationErrorMessageString = null;

        for (const fieldItemRecord of kAnonymityFieldsList) {
            if (fieldItemRecord.role === 'Identifier' && fieldItemRecord.maskStrategy === 'keep' && (!fieldItemRecord.maskKeepChars || fieldItemRecord.maskKeepChars <= 0)) {
                validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 選擇保留部分字元，其保留字元數必須大於 0。`;
                break;
            }

            if (fieldItemRecord.role === 'Quasi-identifier') {
                if (fieldItemRecord.genStrategy === 'tree') {
                    const targetHierarchyTableRecord = kAnonymityHierarchiesList.find(
                        (hierarchyItemRecord) => hierarchyItemRecord.fieldName === fieldItemRecord.name
                    );

                    const hasValidTreeMappingStatus = targetHierarchyTableRecord && targetHierarchyTableRecord.mappings.length > 0 && targetHierarchyTableRecord.mappings.some(mappingRowArray => mappingRowArray[0] && mappingRowArray[0].trim() !== '');

                    if (!hasValidTreeMappingStatus) {
                        validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 選擇「階層樹 (Tree)」泛化，請至「泛化階層映射」分頁設定至少一組有效的對應關係。`;
                        break;
                    }
                } else if (['binning', 'rounding', 'segment', 'prefix', 'masking', 'length'].includes(fieldItemRecord.genStrategy)) {
                    if (fieldItemRecord.genParam === undefined || fieldItemRecord.genParam === null || fieldItemRecord.genParam <= 0) {
                        validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 的泛化參數設定有誤 (不可小於等於 0)。`;
                        break;
                    }
                }
            }
        }

        if (validationErrorMessageString) {
            setStepValidationAction(false, validationErrorMessageString);
            return;
        }

        setStepValidationAction(true, null);
    }, [kAnonymityFieldsList, kAnonymityHierarchiesList, storeColumnsList, preprocessingRulesMap, setStepValidationAction, translate]);

    // 2. 初始化 storeColumnsList
    useEffect(() => {
        const currentColumnNamesKeyString = JSON.stringify(storeColumnsList);

        if (storeColumnsList.length > 0 && globalCachedColumnsKeyString !== currentColumnNamesKeyString) {
            const constructedInitialFieldsList = storeColumnsList.map((columnNameString) => {
                const typeValueStr = storeColumnTypesMap[columnNameString];
                let mappedFieldTypeValue = 'string';
                
                if (typeValueStr === '數值' || typeValueStr === 'numeric') mappedFieldTypeValue = 'numeric';
                else if (typeValueStr === '時間' || typeValueStr === 'temporal') mappedFieldTypeValue = 'temporal';
                else if (typeValueStr === '類別' || typeValueStr === 'categorical') mappedFieldTypeValue = 'categorical';

                const initialRoleValue = storeColumnRolesMap[columnNameString] || 'Non-sensitive';

                return {
                    id: `field_${Math.random().toString(36).substr(2, 9)}`,
                    name: columnNameString,
                    type: mappedFieldTypeValue,
                    role: initialRoleValue,
                    // 規範對照: 依 Open-PETs API 驗證標準，identifier 之預設策略為 hash，其餘角色為 none
                    maskStrategy: DEFAULT_MASK_STRATEGY_BY_ROLE[initialRoleValue] || 'none',
                    maskKeepChars: DEFAULT_MASK_KEEP_CHARS,
                    maskChar: '*',
                    hashType: 'sha256', 
                    genStrategy: mappedFieldTypeValue === 'numeric' ? 'binning' : mappedFieldTypeValue === 'temporal' ? 'downgrade' : mappedFieldTypeValue === 'categorical' ? 'tree' : 'prefix',
                    genParam: mappedFieldTypeValue === 'string' ? DEFAULT_MASK_KEEP_CHARS : DEFAULT_GENERALIZATION_PARAM,
                    genMaxLevel: DEFAULT_MAX_GENERALIZATION_LEVEL
                };
            });

            globalCachedColumnsKeyString = currentColumnNamesKeyString;
            globalCachedKAnonymityFields = constructedInitialFieldsList;

            queueMicrotask(() => {
                setKAnonymityFieldsList(constructedInitialFieldsList);
            });
        }
    }, [storeColumnsList, storeColumnRolesMap, storeColumnTypesMap]);

    // 3. 多對一同步合流至 Zustand
    useEffect(() => {
        if (kAnonymityFieldsList.length === 0) return;

        globalCachedKAnonymityFields = kAnonymityFieldsList;
        globalCachedKAnonymityHierarchies = kAnonymityHierarchiesList;

        const updatedRolesDictionaryMap: Record<string, string> = {};
        const updatedTypesDictionaryMap: Record<string, string> = {};
        const updatedColumnNamesListArray: string[] = [];

        kAnonymityFieldsList.forEach((fieldItemRecord) => {
            if (!fieldItemRecord.name) return;
            updatedRolesDictionaryMap[fieldItemRecord.name] = fieldItemRecord.role;
            updatedTypesDictionaryMap[fieldItemRecord.name] = fieldItemRecord.type === 'string' ? '字串' : fieldItemRecord.type === 'numeric' ? '數值' : fieldItemRecord.type === 'temporal' ? '時間' : '類別';
            updatedColumnNamesListArray.push(fieldItemRecord.name);
        });

        const liveJsonExportDataObject = buildExportJSON(kAnonymityFieldsList, kAnonymityHierarchiesList);
        const currentStore = useWorkspaceStore.getState();
        const nextFieldAttrs = (liveJsonExportDataObject.field_attributes || {}) as Record<string, unknown>;

        const isRolesDifferent = JSON.stringify(currentStore.columnRoles) !== JSON.stringify(updatedRolesDictionaryMap);
        const isTypesDifferent = JSON.stringify(currentStore.columnTypes) !== JSON.stringify(updatedTypesDictionaryMap);
        const isAttrsDifferent = JSON.stringify(currentStore.fieldAttributes) !== JSON.stringify(nextFieldAttrs);

        if (isRolesDifferent || isTypesDifferent || isAttrsDifferent) {
            useWorkspaceStore.setState({
                columnRoles: updatedRolesDictionaryMap,
                columnTypes: updatedTypesDictionaryMap,
                columns: currentStore.columns.length > 0 ? currentStore.columns : updatedColumnNamesListArray,
                kAnonymityFields: kAnonymityFieldsList as Record<string, unknown>[],
                kAnonymityHierarchies: kAnonymityHierarchiesList as Record<string, unknown>[],
                fieldAttributes: nextFieldAttrs,
                maskingRules: (liveJsonExportDataObject.masking_rules || {}) as Record<string, unknown>,
                generalizationRules: (liveJsonExportDataObject.generalization_rules || {}) as Record<string, unknown>,
                categoricalHierarchies: (liveJsonExportDataObject.categorical_hierarchies || {}) as Record<string, unknown>,
                numericBins: (liveJsonExportDataObject.numeric_bins || {}) as Record<string, unknown>,
                temporalHierarchies: (liveJsonExportDataObject.temporal_hierarchies || {}) as Record<string, unknown>
            });
        }
    }, [kAnonymityFieldsList, kAnonymityHierarchiesList]);

    // 4. 同步 Tree Strategy
    useEffect(() => {
        const validTreeStrategyFieldNamesList = kAnonymityFieldsList.filter(
            (fieldItemRecord) => fieldItemRecord.role === 'Quasi-identifier' && fieldItemRecord.genStrategy === 'tree'
        ).map(fieldItemRecord => fieldItemRecord.name);

        const hierarchiesSyncTimerId = window.setTimeout(() => {
            setKAnonymityHierarchiesList((previousHierarchiesList) => {
                const nextHierarchiesListArray = previousHierarchiesList.filter(hierarchyItemRecord => hierarchyItemRecord.fieldName === '' || validTreeStrategyFieldNamesList.includes(hierarchyItemRecord.fieldName));

                validTreeStrategyFieldNamesList.forEach((treeStrategyFieldNameString) => { 
                    if (treeStrategyFieldNameString && !nextHierarchiesListArray.some(hierarchyItemRecord => hierarchyItemRecord.fieldName === treeStrategyFieldNameString)) {
                        nextHierarchiesListArray.push({ id: `h_${Math.random().toString(36).substr(2, 9)}`, fieldName: treeStrategyFieldNameString, mappings: [['', '']] }); 
                    }
                });

                const previousFieldNamesJoinedString = previousHierarchiesList.map(hierarchyItemRecord => hierarchyItemRecord.fieldName).sort().join(',');
                const nextFieldNamesJoinedString = nextHierarchiesListArray.map(hierarchyItemRecord => hierarchyItemRecord.fieldName).sort().join(',');

                return previousFieldNamesJoinedString !== nextFieldNamesJoinedString ? nextHierarchiesListArray : previousHierarchiesList;
            });
        }, 0);

        return () => { 
            window.clearTimeout(hierarchiesSyncTimerId); 
        };
    }, [kAnonymityFieldsList]);

    const getTransformedPreview = (cellValueData: unknown, fieldItemConfigRecord: FieldDef): string => {
        if (cellValueData == null || cellValueData === '') return DEFAULT_PREPROCESS_SYMBOL;
        const parsedStringValue = String(cellValueData);

        if (fieldItemConfigRecord.role !== 'Quasi-identifier') {
            if (fieldItemConfigRecord.maskStrategy === 'drop') return translate('step2.removed');
            if (fieldItemConfigRecord.role === 'Identifier') {
                if (fieldItemConfigRecord.maskStrategy === 'full') return '***';
                if (fieldItemConfigRecord.maskStrategy === 'keep') {
                    const keepCharactersLengthValue = Math.min(fieldItemConfigRecord.maskKeepChars, parsedStringValue.length);
                    return parsedStringValue.substring(0, keepCharactersLengthValue) + fieldItemConfigRecord.maskChar.repeat(Math.max(0, parsedStringValue.length - keepCharactersLengthValue));
                }
            }
            return parsedStringValue; 
        }

        if (fieldItemConfigRecord.role === 'Quasi-identifier') {
            if (fieldItemConfigRecord.genMaxLevel === 0) return parsedStringValue; 

            if (fieldItemConfigRecord.type === 'numeric') {
                const parsedNumericValue = parseFloat(parsedStringValue);
                if (!isNaN(parsedNumericValue) && fieldItemConfigRecord.genParam > 0) {
                    if (fieldItemConfigRecord.genStrategy === 'rounding') return String(Math.round(parsedNumericValue / fieldItemConfigRecord.genParam) * fieldItemConfigRecord.genParam);
                    if (fieldItemConfigRecord.genStrategy === 'segment') {
                        const lowerSegmentBoundValue = Math.floor(parsedNumericValue / fieldItemConfigRecord.genParam) * fieldItemConfigRecord.genParam;
                        return `${lowerSegmentBoundValue} - ${lowerSegmentBoundValue + fieldItemConfigRecord.genParam - 1}`;
                    }
                    const generalizationLevelMultipliersArray = [1, 1, 5, 10, 50];
                    const binStepSizeValue = fieldItemConfigRecord.genParam * (generalizationLevelMultipliersArray[fieldItemConfigRecord.genMaxLevel] || 1);
                    if (fieldItemConfigRecord.genStrategy === 'binning') {
                        const lowerBinBoundValue = Math.floor(parsedNumericValue / binStepSizeValue) * binStepSizeValue;
                        return `${lowerBinBoundValue} ~ ${lowerBinBoundValue + binStepSizeValue}`;
                    }
                }
            } else if (fieldItemConfigRecord.type === 'temporal' && fieldItemConfigRecord.genStrategy === 'downgrade') {
                if (fieldItemConfigRecord.genMaxLevel === 1) return parsedStringValue.substring(0, 10);
                if (fieldItemConfigRecord.genMaxLevel === 2) return parsedStringValue.substring(0, 7);
                if (fieldItemConfigRecord.genMaxLevel >= 3) return parsedStringValue.substring(0, 4);
            } else if (fieldItemConfigRecord.type === 'categorical' && fieldItemConfigRecord.genStrategy === 'tree') {
                const targetHierarchyTableRecord = kAnonymityHierarchiesList.find((hierarchyItemRecord) => hierarchyItemRecord.fieldName === fieldItemConfigRecord.name);
                if (targetHierarchyTableRecord) {
                    const matchedHierarchyMappingRow = targetHierarchyTableRecord.mappings.find(mappingRowArray => mappingRowArray[0] === parsedStringValue);
                    if (matchedHierarchyMappingRow) {
                        return matchedHierarchyMappingRow[Math.min(fieldItemConfigRecord.genMaxLevel, matchedHierarchyMappingRow.length - 1)] || parsedStringValue;
                    }
                }
                return `${translate('step2.undefined_mapping')} ${parsedStringValue}`; 
            } else if (fieldItemConfigRecord.type === 'string') {
                let keepCharactersLengthValue = parsedStringValue.length;
                if (fieldItemConfigRecord.genStrategy === 'prefix') {
                    keepCharactersLengthValue = Math.min(fieldItemConfigRecord.genParam, parsedStringValue.length);
                    if (fieldItemConfigRecord.genMaxLevel === 2) keepCharactersLengthValue = Math.floor(keepCharactersLengthValue / 2);
                    if (fieldItemConfigRecord.genMaxLevel >= 3) keepCharactersLengthValue = 0;
                } else if (fieldItemConfigRecord.genStrategy === 'masking') {
                    const totalMaskCountValue = fieldItemConfigRecord.genParam * fieldItemConfigRecord.genMaxLevel;
                    keepCharactersLengthValue = Math.max(0, parsedStringValue.length - totalMaskCountValue);
                } else if (fieldItemConfigRecord.genStrategy === 'length') {
                    keepCharactersLengthValue = Math.max(0, parsedStringValue.length - fieldItemConfigRecord.genMaxLevel);
                }
                const remainingAsteriskCountValue = Math.max(0, parsedStringValue.length - keepCharactersLengthValue);
                return parsedStringValue.substring(0, keepCharactersLengthValue) + '*'.repeat(remainingAsteriskCountValue);
            }
        }

        return parsedStringValue;
    };

    const handleImportJSON = (fileChangeEventObj: React.ChangeEvent<HTMLInputElement>): void => {
        const targetUploadedFileObj = fileChangeEventObj.target.files?.[0];
        if (!targetUploadedFileObj) return;

        const jsonFileReaderInstance = new FileReader();

        jsonFileReaderInstance.onload = (fileReaderEventObj) => {
            try {
                const rawJsonString = (fileReaderEventObj.target?.result as string) || '';
                const cleanedJsonString = rawJsonString.replace(/^\uFEFF/, '').trim();
                const parsedJsonContentData = JSON.parse(cleanedJsonString);

                if (parsedJsonContentData.privacy_targets?.k_anonymity?.enabled) {
                    useWorkspaceStore.setState({ 
                        privacyMode: 'k-anonymity', 
                        kValue: parsedJsonContentData.privacy_targets.k_anonymity.k ?? BASE_DEFAULT_K_ANONYMITY_VALUE, 
                        maxSuppression: parsedJsonContentData.privacy_targets.k_anonymity.suppression_limit_percent ?? BASE_DEFAULT_SUPPRESSION_LIMIT 
                    });
                }

                const rawAttributesMap = parsedJsonContentData.field_attributes || parsedJsonContentData.columns || {};
                const importedMaskingRulesMap = parsedJsonContentData.masking_rules || {};
                const importedGeneralizationRulesMap = parsedJsonContentData.generalization_rules || {};
                const importedGeneralizationHierarchiesMap: Record<string, { bins?: CustomBin[] }> = parsedJsonContentData.generalization_hierarchies || {};
                const importedPreprocessingRulesMap: Record<string, unknown> = parsedJsonContentData.preprocessing_rules || {};

                const importedAttributesMap: Record<string, { role?: string; type?: string; strategy?: string }> = {};
                if (Array.isArray(rawAttributesMap)) {
                    rawAttributesMap.forEach((colName: string) => {
                        const cleanName = String(colName).replace(/^\uFEFF/, '').trim();
                        importedAttributesMap[cleanName] = { role: 'non_sensitive', type: 'string' };
                    });
                } else {
                    Object.keys(rawAttributesMap).forEach((colName: string) => {
                        const cleanName = colName.replace(/^\uFEFF/, '').trim();
                        importedAttributesMap[cleanName] = rawAttributesMap[colName];
                    });
                }

                // ★ 相容匯入舊版單一策略物件格式 ({action, param})，統一正規化為新版多策略陣列格式 ({action, params})
                const normalizedImportedPreprocessingRulesMap: Record<string, PreprocessingRule[]> = {};
                Object.keys(importedPreprocessingRulesMap).forEach((columnNameKeyStr) => {
                    const rawRuleValue = importedPreprocessingRulesMap[columnNameKeyStr];
                    const rawRuleArray = Array.isArray(rawRuleValue) ? rawRuleValue : [rawRuleValue];

                    normalizedImportedPreprocessingRulesMap[columnNameKeyStr] = rawRuleArray.map((rawStepItemData) => {
                        const rawStepObj = rawStepItemData as { action?: string; param?: string; params?: Record<string, string | number> };
                        return {
                            action: rawStepObj.action || 'none',
                            params: rawStepObj.params ?? (rawStepObj.param !== undefined ? { legacyParam: rawStepObj.param } : {})
                        };
                    });
                });

                useWorkspaceStore.setState({ preprocessingRules: normalizedImportedPreprocessingRulesMap });

                const updatedKAnonymityFieldsList: FieldDef[] = [];
                const updatedColumnRolesMap: Record<string, string> = {};
                const updatedColumnTypesMap: Record<string, string> = {};
                const importedColumnNamesList: string[] = Object.keys(importedAttributesMap);
                const unrecognizedStrategyColumnNamesList: string[] = [];

                importedColumnNamesList.forEach((columnNameString) => {
                    const currentAttributeConfig = importedAttributesMap[columnNameString] || {};
                    const currentMaskingConfig = importedMaskingRulesMap[columnNameString];
                    const currentGeneralizationConfig = importedGeneralizationRulesMap[columnNameString];

                    const rawRole = String(currentAttributeConfig.role || '').toLowerCase();
                    let mappedPrivacyRoleValue = 'Non-sensitive';
                    if (rawRole === 'identifier') mappedPrivacyRoleValue = 'Identifier';
                    else if (rawRole === 'quasi_identifier' || rawRole === 'qi') mappedPrivacyRoleValue = 'Quasi-identifier';
                    else if (rawRole === 'sensitive') mappedPrivacyRoleValue = 'Sensitive';

                    const rawType = String(currentAttributeConfig.type || '').toLowerCase();
                    let mappedFieldTypeValue = 'string';
                    if (['numeric', '數值'].includes(rawType)) mappedFieldTypeValue = 'numeric';
                    else if (['temporal', '時間'].includes(rawType)) mappedFieldTypeValue = 'temporal';
                    else if (['categorical', '類別'].includes(rawType)) mappedFieldTypeValue = 'categorical';

                    updatedColumnRolesMap[columnNameString] = mappedPrivacyRoleValue;
                    updatedColumnTypesMap[columnNameString] = mappedFieldTypeValue;

                    // ★ 匯入判斷：正規化並驗證 "strategy" 欄位是否為該隱私角色可用之合法遮蔽策略
                    const rawStrategySourceValue = currentMaskingConfig?.strategy || currentAttributeConfig.strategy;
                    const { strategy: calculatedMaskingStrategyValue, isRecognized: isStrategyRecognized } = normalizeMaskStrategyValue(rawStrategySourceValue, mappedPrivacyRoleValue);

                    if (rawStrategySourceValue && !isStrategyRecognized) {
                        unrecognizedStrategyColumnNamesList.push(columnNameString);
                    }

                    let calculatedGeneralizationStrategyValue = mappedFieldTypeValue === 'numeric' ? 'binning' : mappedFieldTypeValue === 'temporal' ? 'downgrade' : mappedFieldTypeValue === 'categorical' ? 'tree' : 'prefix';
                    let calculatedGeneralizationParamValue = DEFAULT_GENERALIZATION_PARAM;
                    let calculatedMaxGeneralizationLevelValue = DEFAULT_MAX_GENERALIZATION_LEVEL; 

                    if (currentGeneralizationConfig) {
                        calculatedGeneralizationStrategyValue = currentGeneralizationConfig.strategy || calculatedGeneralizationStrategyValue;
                        calculatedGeneralizationParamValue = currentGeneralizationConfig.param ?? DEFAULT_GENERALIZATION_PARAM;
                        calculatedMaxGeneralizationLevelValue = currentGeneralizationConfig.max_level ?? DEFAULT_MAX_GENERALIZATION_LEVEL;
                    }

                    // ★ 匯入判斷：數值型準識別符若於 "generalization_hierarchies" 定義了自訂區間 (bins)，
                    //   一律採用該定義的自訂區間泛化策略，而非通用的區間化 (binning) 預設值
                    let calculatedCustomBinsValue: CustomBin[] | undefined;
                    if (mappedFieldTypeValue === 'numeric') {
                        const importedNumericBinsConfig = importedGeneralizationHierarchiesMap[columnNameString];
                        if (Array.isArray(importedNumericBinsConfig?.bins) && importedNumericBinsConfig.bins.length > 0) {
                            calculatedGeneralizationStrategyValue = 'custom_bins';
                            calculatedCustomBinsValue = importedNumericBinsConfig.bins;
                            calculatedMaxGeneralizationLevelValue = 1;
                        }
                    }

                    updatedKAnonymityFieldsList.push({
                        id: `field_${Math.random().toString(36).substr(2, 9)}`,
                        name: columnNameString,
                        type: mappedFieldTypeValue,
                        role: mappedPrivacyRoleValue,
                        maskStrategy: calculatedMaskingStrategyValue,
                        maskKeepChars: currentMaskingConfig?.keep_chars ?? DEFAULT_MASK_KEEP_CHARS,
                        maskChar: currentMaskingConfig?.mask_char ?? '*',
                        hashType: currentMaskingConfig?.hash_type || 'sha256',
                        genStrategy: calculatedGeneralizationStrategyValue,
                        genParam: calculatedGeneralizationParamValue,
                        genMaxLevel: calculatedMaxGeneralizationLevelValue,
                        ...(calculatedCustomBinsValue ? { customBins: calculatedCustomBinsValue } : {})
                    });
                });

                const importedCategoricalHierarchiesMap = parsedJsonContentData.categorical_hierarchies || {};
                const importedGeneralizationMatrices = parsedJsonContentData.generalization_matrices || {};
                const updatedHierarchiesListArray: HierarchyTable[] = []; 

                Object.keys(importedGeneralizationMatrices).forEach((columnNameString) => {
                    const cleanColName = columnNameString.replace(/^\uFEFF/, '').trim();
                    const matrixData = importedGeneralizationMatrices[columnNameString];
                    if (Array.isArray(matrixData)) {
                        updatedHierarchiesListArray.push({
                            id: `h_${Math.random().toString(36).substr(2, 9)}`,
                            fieldName: cleanColName,
                            mappings: matrixData
                        });
                    }
                });

                Object.keys(importedCategoricalHierarchiesMap).forEach((columnNameString) => {
                    const cleanColName = columnNameString.replace(/^\uFEFF/, '').trim();
                    if (!updatedHierarchiesListArray.some(h => h.fieldName === cleanColName)) {
                        const categoricalMappingsArray = Object.values(importedCategoricalHierarchiesMap[columnNameString].mapping || {}) as string[][];
                        updatedHierarchiesListArray.push({
                            id: `h_${Math.random().toString(36).substr(2, 9)}`,
                            fieldName: cleanColName,
                            mappings: categoricalMappingsArray
                        });
                    }
                });

                // ★ 修正 Race Condition：欄位快取鍵值必須與實際寫入 Store 的 columns 陣列完全一致，
                //   否則初始化用 useEffect (見下方 "2. 初始化 storeColumnsList") 會判斷快取不吻合，
                //   進而以預設值 (maskStrategy: 'none') 覆蓋掉此處剛匯入的 strategy 設定。
                const effectiveColumnNamesListForStore = (storeColumnsList && storeColumnsList.length > 0) ? storeColumnsList : importedColumnNamesList;

                useWorkspaceStore.setState({
                    columns: effectiveColumnNamesListForStore,
                    columnRoles: updatedColumnRolesMap,
                    columnTypes: updatedColumnTypesMap,
                    categoricalHierarchies: importedCategoricalHierarchiesMap,
                    numericBins: parsedJsonContentData.generalization_hierarchies || parsedJsonContentData.numeric_bins || {}
                });

                globalCachedColumnsKeyString = JSON.stringify(effectiveColumnNamesListForStore);
                globalCachedKAnonymityFields = updatedKAnonymityFieldsList; 
                globalCachedKAnonymityHierarchies = updatedHierarchiesListArray;

                setKAnonymityFieldsList(updatedKAnonymityFieldsList);
                setKAnonymityHierarchiesList(updatedHierarchiesListArray);

                messageApi.success(translate('message.import_json_success', '成功匯入 JSON 設定並更新欄位對應！'));

                if (unrecognizedStrategyColumnNamesList.length > 0) {
                    messageApi.warning(
                        translate(
                            'message.import_json_strategy_invalid',
                            `以下欄位之 "strategy" 設定無法辨識或不適用於其隱私角色，已重設為預設策略：{{columns}}`,
                            { columns: unrecognizedStrategyColumnNamesList.join('、') }
                        )
                    );
                }
            } catch (jsonParseExecutionError) { 
                console.error("JSON 解析失敗:", jsonParseExecutionError);
                messageApi.error(translate('message.import_json_error', '匯入 JSON 格式錯誤，請檢查檔案內容')); 
            } finally {
                if (fileInputRef.current) fileInputRef.current.value = ''; 
            }
        };

        jsonFileReaderInstance.readAsText(targetUploadedFileObj);
    };

    const handleApplyRecommendations = (): void => {
        const recommendedUpdatedFieldsList = kAnonymityFieldsList.map((fieldItemRecord) => {
            const lowerCaseFieldNameString = fieldItemRecord.name.toLowerCase();
            let recommendedPrivacyRoleValue: string; 
            let recommendedMaskingStrategyValue: string; 
            let recommendedGeneralizationStrategyValue = fieldItemRecord.genStrategy;

            if (/(id|name|card|nric|phone|email)/.test(lowerCaseFieldNameString)) {
                recommendedPrivacyRoleValue = 'Identifier';
                recommendedMaskingStrategyValue = 'remove';
            } else if (/(date|age|zip|gender|station|city|region)/.test(lowerCaseFieldNameString)) {
                recommendedPrivacyRoleValue = 'Quasi-identifier'; 
                recommendedMaskingStrategyValue = 'none';
                recommendedGeneralizationStrategyValue = fieldItemRecord.type === 'numeric' ? 'binning' : fieldItemRecord.type === 'temporal' ? 'downgrade' : fieldItemRecord.type === 'categorical' ? 'tree' : 'prefix';
            } else if (/(disease|salary|income|fare|credit|amount|ratio|score)/.test(lowerCaseFieldNameString)) { 
                recommendedPrivacyRoleValue = 'Sensitive'; 
                recommendedMaskingStrategyValue = 'none'; 
            } else { 
                recommendedPrivacyRoleValue = 'Non-sensitive'; 
                recommendedMaskingStrategyValue = 'none'; 
            }

            return { ...fieldItemRecord, role: recommendedPrivacyRoleValue, maskStrategy: recommendedMaskingStrategyValue, genStrategy: recommendedGeneralizationStrategyValue };
        });

        setKAnonymityFieldsList(recommendedUpdatedFieldsList);
        messageApi.success(translate('message.apply_recommend_success'));
    };

    const handleFieldChange = (targetFieldIdStr: string, targetAttributeKeyName: keyof FieldDef, newAttributeValueData: string | number | null): void => {
        const normalizedAttributeValueData = newAttributeValueData === null ? 0 : newAttributeValueData;

        setKAnonymityFieldsList(
            kAnonymityFieldsList.map((fieldItemRecord) => {
                if (fieldItemRecord.id !== targetFieldIdStr) return fieldItemRecord;
                const previousFieldNameString = fieldItemRecord.name; 
                const updatedFieldObjectItem = { ...fieldItemRecord, [targetAttributeKeyName]: normalizedAttributeValueData };

                if (targetAttributeKeyName === 'role' || targetAttributeKeyName === 'type') {
                    if (updatedFieldObjectItem.role === 'Quasi-identifier') {
                        if (updatedFieldObjectItem.type === 'numeric') updatedFieldObjectItem.genStrategy = 'binning';
                        else if (updatedFieldObjectItem.type === 'temporal') updatedFieldObjectItem.genStrategy = 'downgrade';
                        else if (updatedFieldObjectItem.type === 'categorical') updatedFieldObjectItem.genStrategy = 'tree';
                        else updatedFieldObjectItem.genStrategy = 'prefix';
                    } else {
                        // ★ 規範對照: identifier 之合法策略僅有 remove (見 VALID_MASK_STRATEGIES_BY_ROLE)，
                        //   切換角色時一律套用該角色預設策略，避免 identifier 卡在 UI 未提供之 'none' 選項
                        updatedFieldObjectItem.maskStrategy = DEFAULT_MASK_STRATEGY_BY_ROLE[updatedFieldObjectItem.role] || 'none';
                    }
                }

                if (updatedFieldObjectItem.type === 'numeric' && ['rounding', 'segment'].includes(updatedFieldObjectItem.genStrategy) && updatedFieldObjectItem.genMaxLevel > 1) {
                    updatedFieldObjectItem.genMaxLevel = 1;
                }

                // ★ 首次切換為「自訂區間」策略時，若尚無區間定義，初始化一列空白區間供使用者於「泛化階層對照」分頁編輯
                if (targetAttributeKeyName === 'genStrategy' && normalizedAttributeValueData === 'custom_bins') {
                    if (!updatedFieldObjectItem.customBins || updatedFieldObjectItem.customBins.length === 0) {
                        updatedFieldObjectItem.customBins = [{ min: null, max: null, label: '' }];
                    }
                    updatedFieldObjectItem.genMaxLevel = 1;
                }

                if (targetAttributeKeyName === 'name' && previousFieldNameString !== normalizedAttributeValueData && previousFieldNameString.trim() !== '') {
                    const newFieldNameInputString = String(normalizedAttributeValueData);
                    setKAnonymityHierarchiesList(previousHierarchiesListArray => previousHierarchiesListArray.map(hierarchyItemRecord => hierarchyItemRecord.fieldName === previousFieldNameString ? { ...hierarchyItemRecord, fieldName: newFieldNameInputString } : hierarchyItemRecord));
                }

                return updatedFieldObjectItem;
            })
        );
    };

    const addField = (): void => setKAnonymityFieldsList([...kAnonymityFieldsList, { id: `field_${Date.now()}`, name: '', type: 'string', role: 'Quasi-identifier', maskStrategy: 'none', maskKeepChars: DEFAULT_MASK_KEEP_CHARS, maskChar: '*', hashType: 'sha256', genStrategy: 'prefix', genParam: DEFAULT_GENERALIZATION_PARAM, genMaxLevel: DEFAULT_MAX_GENERALIZATION_LEVEL }]);

    const removeField = (targetFieldIdStr: string): void => {
        const fieldObjectToRemove = kAnonymityFieldsList.find(fieldItemRecord => fieldItemRecord.id === targetFieldIdStr);
        setKAnonymityFieldsList(kAnonymityFieldsList.filter(fieldItemRecord => fieldItemRecord.id !== targetFieldIdStr));
        if (fieldObjectToRemove && fieldObjectToRemove.name) {
            setKAnonymityHierarchiesList(previousHierarchiesListArray => previousHierarchiesListArray.filter(hierarchyItemRecord => hierarchyItemRecord.fieldName !== fieldObjectToRemove.name));
        }
    };

    // 數值型自訂區間 (customBins) 編輯操作：新增／更新／刪除單一區間列
    const addCustomBinRow = (targetFieldIdStr: string): void => {
        setKAnonymityFieldsList(kAnonymityFieldsList.map(
            (fieldItemRecord) => fieldItemRecord.id === targetFieldIdStr
                ? { ...fieldItemRecord, customBins: [...(fieldItemRecord.customBins || []), { min: null, max: null, label: '' }] }
                : fieldItemRecord
        ));
    };

    const updateCustomBinField = (targetFieldIdStr: string, targetBinIndexNumber: number, targetBinKeyName: keyof CustomBin, newBinValueData: number | string | null): void => {
        setKAnonymityFieldsList(kAnonymityFieldsList.map(
            (fieldItemRecord) => {
                if (fieldItemRecord.id !== targetFieldIdStr || !fieldItemRecord.customBins) return fieldItemRecord;
                const updatedCustomBinsArray = fieldItemRecord.customBins.map(
                    (binItemRecord, binIndexNumber) => binIndexNumber === targetBinIndexNumber ? { ...binItemRecord, [targetBinKeyName]: newBinValueData } : binItemRecord
                );
                return { ...fieldItemRecord, customBins: updatedCustomBinsArray };
            }
        ));
    };

    const removeCustomBinRow = (targetFieldIdStr: string, targetBinIndexNumber: number): void => {
        setKAnonymityFieldsList(kAnonymityFieldsList.map(
            (fieldItemRecord) => fieldItemRecord.id === targetFieldIdStr && fieldItemRecord.customBins
                ? { ...fieldItemRecord, customBins: fieldItemRecord.customBins.filter((_, binIndexNumber) => binIndexNumber !== targetBinIndexNumber) }
                : fieldItemRecord
        ));
    };

    const kAnonymityFieldTableColumnsConfig = [
        {
            title: translate('step2.col_name'),
            dataIndex: 'name', width: '15%',
            render: (fieldNameTextValue: string, rowRecordItem: FieldDef) => (
                <Tooltip title={fieldNameTextValue} placement="topLeft" mouseEnterDelay={0.3}>
                    <Input value={fieldNameTextValue} onChange={(inputChangeEvent) => handleFieldChange(rowRecordItem.id, 'name', inputChangeEvent.target.value)} placeholder="e.g. age" style={{ width: '100%', textOverflow: 'ellipsis' }} />
                </Tooltip>
            ),
        },
        {
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
            title: translate('step2.process_strategy'),
            dataIndex: 'strategy', width: '15%',
            render: (_: unknown, rowRecordItem: FieldDef) => {
                if (rowRecordItem.role !== 'Quasi-identifier') {
                    // ★ 規範對照: 依 Open-PETs API 驗證標準，identifier 僅提供 remove 供使用者選擇 (hash 已自 UI 移除)，
                    //   其餘角色維持 none／remove，避免產生匯出後會被後端忽略之無效組合設定
                    const maskStrategyOptionList = rowRecordItem.role === 'Identifier'
                        ? [{ value: 'remove', label: translate('step2.opt_drop') }]
                        : [{ value: 'none', label: translate('step2.opt_keep_original') }, { value: 'remove', label: translate('step2.opt_drop') }];

                    return <Select value={rowRecordItem.maskStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'maskStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={maskStrategyOptionList} />;
                }

                if (rowRecordItem.role === 'Quasi-identifier') {
                    if (rowRecordItem.type === 'numeric') {
                        // ★ 自訂區間 (custom_bins) 為一般可選策略，選取後可至「泛化階層對照」分頁編輯 min／max／label 區間定義
                        const numericGenStrategyOptionList = [
                            { value: 'binning', label: translate('step2.opt_binning') },
                            { value: 'rounding', label: translate('step2.opt_rounding') },
                            { value: 'segment', label: translate('step2.opt_segment') },
                            { value: 'custom_bins', label: translate('step2.opt_custom_bins_editable', '自訂區間') },
                        ];
                        return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={numericGenStrategyOptionList} />;
                    }
                    if (rowRecordItem.type === 'temporal') {
                        return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={[{value:'downgrade', label: translate('step2.opt_downgrade')}]} />;
                    }
                    if (rowRecordItem.type === 'categorical') {
                        return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={[{value:'tree', label: translate('step2.opt_tree')}]} />;
                    }
                    return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={[{value:'masking', label: translate('step2.opt_masking')}, {value:'prefix', label: translate('step2.opt_prefix')}, {value:'length', label: translate('step2.opt_length')}]} />;
                }

                return <span style={{ color: token.colorTextDescription }}>{translate('step2.no_process_needed')}</span>;
            },
        },
        {
            title: translate('step2.param_setting'),
            key: 'details', width: '18%',
            render: (_: unknown, rowRecordItem: FieldDef) => {
                if (rowRecordItem.role === 'Identifier') {
                    if (rowRecordItem.maskStrategy === 'keep') {
                        return (
                            <Space.Compact style={{ width: '100%' }}>
                                <InputNumber value={rowRecordItem.maskKeepChars} onChange={(inputNumberValue) => handleFieldChange(rowRecordItem.id, 'maskKeepChars', inputNumberValue)} min={0} style={{ width: '50%' }} />
                                <Input value={rowRecordItem.maskChar} onChange={(inputChangeEvent) => handleFieldChange(rowRecordItem.id, 'maskChar', inputChangeEvent.target.value)} style={{ width: '50%', textAlign: 'center' }} />
                            </Space.Compact>
                        );
                    }
                }

                if (rowRecordItem.role === 'Quasi-identifier') {
                    if (rowRecordItem.type === 'numeric') {
                        if (rowRecordItem.genStrategy === 'custom_bins') {
                            return <span style={{ color: token.colorTextDescription }}>{translate('step2.custom_bins_count', { count: rowRecordItem.customBins?.length ?? 0 })}</span>;
                        }
                        return <InputNumber placeholder={rowRecordItem.genStrategy === 'rounding' ? translate('step2.ph_rounding_base') : translate('step2.ph_bin_size')} value={rowRecordItem.genParam} onChange={(inputNumberValue) => handleFieldChange(rowRecordItem.id, 'genParam', inputNumberValue)} style={{ width: '100%' }} />;
                    }
                    if (rowRecordItem.type === 'string' && ['masking', 'prefix', 'length'].includes(rowRecordItem.genStrategy)) {
                        const strategyPlaceholderTextString = rowRecordItem.genStrategy === 'prefix' ? translate('step2.ph_keep_chars') : translate('step2.ph_mask_per_level');
                        return <InputNumber placeholder={strategyPlaceholderTextString} value={rowRecordItem.genParam} onChange={(inputNumberValue) => handleFieldChange(rowRecordItem.id, 'genParam', inputNumberValue)} style={{ width: '100%' }} />;
                    }
                }

                return <span style={{ color: token.colorTextDescription }}>-</span>;
            },
        },
        {
            title: translate('step2.max_level'),
            key: 'level', width: '23%', 
            render: (_: unknown, rowRecordItem: FieldDef) => {
                if (rowRecordItem.role === 'Quasi-identifier') {
                    let segmentedLevelOptionList: { label: string; value: number }[] = [];

                    if (rowRecordItem.type === 'temporal') {
                        segmentedLevelOptionList = [{ label: translate('step2.lvl_exact'), value: 0 }, { label: translate('step2.lvl_day'), value: 1 }, { label: translate('step2.lvl_month'), value: 2 }, { label: translate('step2.lvl_year'), value: 3 }];
                    } else if (rowRecordItem.type === 'categorical') { 
                        const targetHierarchyTableRecord = kAnonymityHierarchiesList.find((hierarchyItemRecord) => hierarchyItemRecord.fieldName === rowRecordItem.name);
                        const maxLevelCalculatedValue = targetHierarchyTableRecord ? Math.max(...targetHierarchyTableRecord.mappings.map(mappingRowArray => mappingRowArray.length), 2) - 1 : 3;

                        segmentedLevelOptionList.push({ label: translate('step2.lvl_original'), value: 0 });
                        for (let levelIndexLoopVar = 1; levelIndexLoopVar <= maxLevelCalculatedValue; levelIndexLoopVar++) {
                            segmentedLevelOptionList.push({ label: `L${levelIndexLoopVar}`, value: levelIndexLoopVar });
                        }
                    } else if (rowRecordItem.type === 'string') {
                        segmentedLevelOptionList = [{ label: translate('step2.lvl_original'), value: 0 }, { label: translate('step2.lvl_mask1'), value: 1 }, { label: translate('step2.lvl_mask_half'), value: 2 }, { label: translate('step2.lvl_mask_all'), value: 3 }];
                    } else if (rowRecordItem.type === 'numeric') {
                        if (rowRecordItem.genStrategy === 'rounding' || rowRecordItem.genStrategy === 'segment' || rowRecordItem.genStrategy === 'custom_bins') {
                            segmentedLevelOptionList = [{ label: translate('step2.lvl_original'), value: 0 }, { label: translate('step2.lvl_enable'), value: 1 }];
                        } else {
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

    const liveJsonPreviewDataObject = buildSpecCompliantPreviewJSON(kAnonymityFieldsList, kAnonymityHierarchiesList);
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
        <div className="kanon-split-layout">
        <div className="kanon-split-form-column">
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
                                                        const targetColumnPreprocessingSteps = currentPreprocessingRulesMap[rowRecordItem.name] || [{ action: 'none', param: '' }];

                                                        const samplePreviewRowsDataArray = datasetPreviewRowsList.slice(0, 3).map(
                                                            (dataRowRecordItem, rowIndexNumber) =>
                                                            {
                                                                const rawStringValueData = String(dataRowRecordItem[rowRecordItem.name] || '-');
                                                                const preprocessedStringValueData = applyPreprocessSteps(rawStringValueData, targetColumnPreprocessingSteps);
                                                                const transformedStringValueData = getTransformedPreview(preprocessedStringValueData, rowRecordItem);
                                                                return { key: rowIndexNumber, raw: rawStringValueData, preprocessed: preprocessedStringValueData, transformed: transformedStringValueData };
                                                            }
                                                        );

                                                        const hasPreprocessActionConfigured = targetColumnPreprocessingSteps.some((stepItemRecord) => stepItemRecord.action && stepItemRecord.action !== 'none');
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
                                    {kAnonymityFieldsList.filter(fieldItemRecord => fieldItemRecord.type === 'numeric' && fieldItemRecord.genStrategy === 'custom_bins').map(
                                        (numericBinsFieldItemRecord) => (
                                            <Card
                                                key={numericBinsFieldItemRecord.id}
                                                size="small"
                                                styles={{ header: { background: isDarkModeActive ? '#1f1f1f' : '#f5f5f5', borderBottom: `1px solid ${token.colorBorderSecondary}` } }}
                                                style={{ border: `1px solid ${token.colorBorderSecondary}`, boxShadow: 'none' }}
                                                title={
                                                    <Space>
                                                        <span style={{ color: token.colorTextSecondary }}>{translate('step2.related_field')}</span>
                                                        <span style={{ fontWeight: 600 }}>{numericBinsFieldItemRecord.name}</span>
                                                        <span style={{ fontSize: '12px', color: token.colorPrimary, border: `1px solid ${token.colorPrimaryBorder}`, borderRadius: '4px', padding: '0 6px' }}>{translate('step2.opt_custom_bins_editable', '自訂區間')}</span>
                                                    </Space>
                                                }
                                            >
                                                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', padding: '0 8px' }}>
                                                    <div style={{ width: '140px', color: token.colorTextSecondary, fontSize: '12px' }}>{translate('step2.bin_min', '下限 (含)')}</div>
                                                    <div style={{ width: '140px', color: token.colorTextSecondary, fontSize: '12px' }}>{translate('step2.bin_max', '上限 (不含)')}</div>
                                                    <div style={{ flex: 1, color: token.colorTextSecondary, fontSize: '12px' }}>{translate('step2.bin_label', '顯示標籤')}</div>
                                                    <div style={{ width: '60px' }}></div>
                                                </div>

                                                {(numericBinsFieldItemRecord.customBins || []).map(
                                                    (binItemRecord, binIndexNumber) => (
                                                        <div key={binIndexNumber} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                                            <InputNumber
                                                                style={{ width: '140px' }}
                                                                placeholder={translate('step2.bin_unbounded', '不限')}
                                                                value={binItemRecord.min ?? undefined}
                                                                onChange={(inputNumberValue) => updateCustomBinField(numericBinsFieldItemRecord.id, binIndexNumber, 'min', inputNumberValue)}
                                                            />
                                                            <InputNumber
                                                                style={{ width: '140px' }}
                                                                placeholder={translate('step2.bin_unbounded', '不限')}
                                                                value={binItemRecord.max ?? undefined}
                                                                onChange={(inputNumberValue) => updateCustomBinField(numericBinsFieldItemRecord.id, binIndexNumber, 'max', inputNumberValue)}
                                                            />
                                                            <Input
                                                                style={{ flex: 1 }}
                                                                placeholder={translate('step2.bin_label_placeholder', '例：30歲以下')}
                                                                value={binItemRecord.label}
                                                                onChange={(inputChangeEvent) => updateCustomBinField(numericBinsFieldItemRecord.id, binIndexNumber, 'label', inputChangeEvent.target.value)}
                                                            />
                                                            <Space style={{ width: '60px', justifyContent: 'center' }}>
                                                                <Popconfirm title={translate('step2.confirm_delete_row')} onConfirm={() => removeCustomBinRow(numericBinsFieldItemRecord.id, binIndexNumber)}>
                                                                    <Button type="text" size="small" icon={<DeleteOutlined style={{ color: token.colorTextDescription }} />} />
                                                                </Popconfirm>
                                                            </Space>
                                                        </div>
                                                    )
                                                )}

                                                <Button type="link" icon={<PlusOutlined />} onClick={() => addCustomBinRow(numericBinsFieldItemRecord.id)} style={{ paddingLeft: 0 }}>{translate('step2.btn_add_bin', '新增區間')}</Button>
                                            </Card>
                                        )
                                    )}

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
                .kanon-split-layout {
                    display: flex;
                    align-items: flex-start;
                    gap: 24px;
                }
                .kanon-split-form-column {
                    flex: 2 1 0%;
                    min-width: 0;
                }
                .kanon-split-preview-column {
                    flex: 1 1 0%;
                    min-width: 320px;
                    position: sticky;
                    top: 24px;
                }
                @media (max-width: 1200px) {
                    .kanon-split-layout {
                        flex-direction: column;
                    }
                    .kanon-split-preview-column {
                        flex: 1 1 auto;
                        width: 100%;
                        min-width: 0;
                        position: static;
                    }
                }
                .kanon-json-preview-line {
                    display: flex;
                }
                .kanon-json-preview-line-number {
                    flex: 0 0 auto;
                    width: 36px;
                    text-align: right;
                    padding-right: 12px;
                    user-select: none;
                    color: ${isDarkModeActive ? '#5c6370' : '#a0aec0'};
                }
                .kanon-json-preview-line-content {
                    flex: 1 1 auto;
                    white-space: pre;
                }
            `}</style>
        </Card>
        </div>

        <div className="kanon-split-preview-column">
            <Card
                variant="borderless"
                title={<span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><CodeOutlined style={{ color: token.colorPrimary }} />{translate('step2.json_preview')}</span>}
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
                            <div className="kanon-json-preview-line" key={jsonPreviewLineIndexNumber}>
                                <span className="kanon-json-preview-line-number">{jsonPreviewLineIndexNumber + 1}</span>
                                <span className="kanon-json-preview-line-content">{jsonPreviewLineTextString}</span>
                            </div>
                        )
                    )}
                </div>
            </Card>
        </div>
        </div>
    );
}