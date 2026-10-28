/**
 * ============================================================================
 * 檔案名稱 (File): KAnonymityMapping.tsx
 * 模組功能 (Description): K-匿名欄位屬性與泛化層級對應設定組件 (提供欄位資料型態對映、隱私角色標註、遮蔽與泛化策略配置、階層樹映射表編輯、JSON 匯入匯出與即時預覽)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, Table, Select, Button, Input, InputNumber, Segmented, theme, Tabs, Space, Popconfirm, Tooltip, TimePicker, App as AntdApp, Alert } from 'antd';
import {
    DeleteOutlined, PlusOutlined, MinusOutlined,
    SaveOutlined, DatabaseOutlined, SisternodeOutlined,
    CodeOutlined, ThunderboltOutlined, QuestionCircleOutlined, CopyOutlined,
    EyeOutlined, EyeInvisibleOutlined, CheckCircleOutlined, WarningOutlined, InfoCircleOutlined,
    RightOutlined, VerticalAlignTopOutlined, VerticalAlignBottomOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore, DEFAULT_KANON_RULE_PARAMS, type PreprocessingRule } from '../../store/useWorkspaceStore';
import ConfigFileButtons from './ConfigFileButtons';
import { useEnsureDatasetProfile } from '../../utils/datasetProfile';
import { findHierarchyTableProblems, describeHierarchyRowProblem } from '../../utils/hierarchyTableValidation';
import { applyPreprocessSteps } from '../../utils/preprocessSteps';
import { buildBackendConfigDocumentFromWorkspace } from '../../utils/pipelineConfig';
import { resolveImportedLtSettings, normalizeImportedQiLevel, buildQiLevelValue, extractImportedCellFillValues } from '../../utils/kAnonymityConfigImport';
import { TEMPORAL_GRANULARITY_UNITS, TEMPORAL_DEFAULT_GRANULARITY_LEVEL, temporalUnitOfLevel, resolveImportedTemporalLevel } from '../../utils/temporalGranularity';
import { type CustomBin, MAX_AUTO_GENERATED_BIN_COUNT, generateEvenlyDistributedBins, generateUnitWidthBins, calculateNiceRoundingUnit, findNumericMinMax, computeUnitModeStartValue, extendFirstBinLowerBoundToZero } from '../../utils/binGeneration';
import { KANON_COLUMNS_REFERENCE } from '../../config/recommendationReferenceConfig';
import { detectConfigPrivacyMode } from '../../utils/configModeDetect';
import { importPreprocessFromConfig } from '../../utils/preprocessConfigImport';
import { applyPreprocessImportToWorkspace, applyRiskImportToWorkspace } from './preprocessImportMessages';
import { importRiskFromConfig } from '../../utils/riskConfigImport';
import { buildDatasetColumnNameSet, isFieldNameInDataset, findFieldsNotInDataset, findDatasetColumnsNotConfigured, countBlankFieldNames, describeFieldsNotInDatasetError, describeBlankFieldNamesError, normalizeDatasetColumnName } from '../../utils/datasetFieldConsistency';

import { scaleFontSize } from '../../utils/fontScale';
// ★ 2026-10-02：使用者要求「後端處理報告明細」及其相關功能一律不顯示。「最大層級」的「評估至／試算層級」
//   （qi_generalization_levels 的上限，只用於後端報告的試算建議、不影響實際輸出）一併隱藏；
//   匯入設定檔帶入的上限仍會保留並照原樣送出。日後恢復時改回 true（並同時開啟 Step4_Result.tsx 的
//   SHOW_BACKEND_REPORT_DETAILS）。
// （匯出供單元測試依此開關判斷畫面是否應顯示試算提示，不影響元件行為）
export const SHOW_LEVEL_RANGE_TRIAL = false;

/**
 * ============================================================================
 * 魔術數字常數化宣告 (Magic Numbers)
 * ============================================================================
 */
const DEFAULT_PREPROCESS_SYMBOL = '-';
const DEFAULT_MASK_KEEP_CHARS = 2;
const DEFAULT_GENERALIZATION_PARAM = 10;
const DEFAULT_MAX_GENERALIZATION_LEVEL = 2;
const MIN_HIERARCHY_COLUMN_COUNT = 2;
// ★ 2026-10-05：類別階層對照表最多泛化層級數（不含原始值欄）
const MAX_HIERARCHY_LEVEL_COUNT = 10;
// ★ 新增：使用者反映「數值區間化」缺少初步自動填入，故提供「系統推薦設定」——依實際資料
// 最小/最大值，選擇「平均分配」(指定區間數量，等寬切分) 或「最小單位」(指定單位寬度，
// 自動疊加至涵蓋最大值) 兩種模式，自動產生 customBins 陣列供使用者後續手動微調。
const DEFAULT_AUTO_BIN_COUNT = 5;
const DEFAULT_AUTO_BIN_UNIT_WIDTH = 10;
const MIN_AUTO_BIN_COUNT = 2;
const MAX_AUTO_BIN_COUNT = 50;
// ★ 新增：使用者反映「套用系統推薦設定」一鍵按鈕會將數值型間接識別碼欄位固定設為「四捨五入 /
// 最小單位設定」(rounding) 策略，此策略之捨入單位 (genParam) 先前完全不會自動帶入、需使用者自行
// 猜測填寫。與使用者確認：保留 rounding 為預設策略，但改為依實際資料範圍自動計算一個合理的捨入
// 單位——目標是把範圍大致切成此常數指定的段數，僅供 calculateNiceRoundingUnit 內部估算用。
const ROUNDING_UNIT_RECOMMENDATION_TARGET_BUCKET_COUNT = DEFAULT_AUTO_BIN_COUNT;
// ★ 使用者反映: 字串「依字串長度」策略只要調「參數設定」(bin_size) 就好，不需要額外再調
// 「最大層級」；後端公式為 bin_size × level，故這裡把 level 固定為 1，讓參數設定單獨等於
// 實際輸出的級距寬度。此常數同時供 UI（隱藏該策略之最大層級欄位）與預覽/匯出計算共用。
const STRING_LENGTH_STRATEGY_FIXED_LEVEL = 1;
// ★ 使用者反映：「字串前後綴」策略（保留前/後 N 字，其餘遮蔽）套用在職業、地區這類
// 中文短詞（常見長度僅 2~4 字）上時，整欄看起來永遠被完全遮蔽（***），前方／後方
// 完全看不出差異。根因：後端保留字數＝max(5-最大層級,1)，通用預設「最大層級=2」換算
// 出來的保留字數是 3；而後端遮蔽邏輯規定「原字串長度 ≤ 保留字數」時直接整格全遮蔽
// （見 app/engines/anonymization/strategies/masking.py apply_masking），中文短詞幾乎
// 都會落入這個全遮蔽情況，導致方向選擇形同虛設（不是方向沒有送到後端——已核對
// Step4_Result.tsx 實際送出的 config，mask_mode 確實依 genDirection 正確給出
// prefix／suffix；純粹是「保留字數比欄位內容還長」這個組合必然導致全遮蔽）。
// 改為切換到「字串前後綴」策略時，預設把「最大層級」設高一點（4，保留字數＝1），
// 讓 2 字以上的中文詞至少能留下 1 個字，使用者才看得出前方／後方的差異；使用者仍可
// 自行再調整這個數字。
const STRING_PREFIX_STRATEGY_DEFAULT_LEVEL = 4;

// K-Anonymity / JSON 匯出相關之預設常數
// ★ 修正：與 useWorkspaceStore.ts 之 DEFAULT_K_ANONYMITY_VALUE 同步由 5 改為 3，避免這裡
// 單獨殘留舊的預設值 5——雖然目前 kValue 於 Store 一律有初始值、正常流程不會走到這個
// ?? 後備值，但匯入「未包含 k 欄位」的舊版設定檔時仍會用到，故一併同步，避免不一致。
const BASE_DEFAULT_K_ANONYMITY_VALUE = 3;
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

// 依資料型態分類之預設間接識別碼泛化策略 (字串型無對應項時，一律退回 'prefix' 保留前後綴策略)
const DEFAULT_GEN_STRATEGY_BY_TYPE: Record<string, string> = {
    numeric: 'rounding',
    temporal: 'time_rounding',
    categorical: 'tree',
};

// 時間型間接識別欄位「時間粒度」策略之泛化層級：層級 1~5 依序對應 分/時/日/月/年（2026-10-01 移除「秒」），
// 預設為「月」。匯入時依設定檔自己的 levels 清單換算，見 utils/temporalGranularity.ts。

/**
 * 函數名稱: resolveDefaultGenStrategyForType
 * 函數功能: 依欄位資料型態，回傳該型態於切換為間接識別碼角色時應套用之預設泛化策略代碼。
 */
const resolveDefaultGenStrategyForType = (fieldTypeValue: string): string => DEFAULT_GEN_STRATEGY_BY_TYPE[fieldTypeValue] || 'prefix';

/**
 * 函數名稱: formatMinutesOfDayAsHHMM
 * 函數功能: 將 TimePicker 內部使用的「當日第幾分鐘」整數，轉換為後端 time_periods 界線格式所需的
 *           "HH:MM" 字串（JSON 匯出、即時送出後端共用同一套轉換，避免兩處各自實作出現落差）。
 */
const formatMinutesOfDayAsHHMM = (totalMinutesValue: number): string => {
    const wrappedMinutesValue = ((Math.round(totalMinutesValue) % 1440) + 1440) % 1440;
    const hourTextValue = String(Math.floor(wrappedMinutesValue / 60)).padStart(2, '0');
    const minuteTextValue = String(wrappedMinutesValue % 60).padStart(2, '0');
    return `${hourTextValue}:${minuteTextValue}`;
};

/**
 * 函數名稱: parseHHMMToMinutesOfDay
 * 函數功能: formatMinutesOfDayAsHHMM 的反向轉換——將後端 time_periods 界線之 "HH:MM"（或 "HH:MM:SS"）
 *           字串解析回「當日第幾分鐘」整數，供 JSON 匯入時還原 TimePicker 可用的內部數值。
 *           解析不出來（格式不合預期）時退回 0，不中斷整體匯入流程。
 */
const parseHHMMToMinutesOfDay = (hhmmString: string): number => {
    const matchResult = hhmmString.trim().match(/^(\d{1,2}):([0-5]\d)/);
    if (!matchResult) return 0;
    return parseInt(matchResult[1], 10) * 60 + parseInt(matchResult[2], 10);
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


// 泛化階層設定之聯集型別：數值型自訂區間 (bins)、時間型粒度階梯 (levels，可選搭配 time_periods 時段對照表)。
// 三者依欄位型態擇一使用，共用同一個 Record 型別是為了讓 generalization_hierarchies／temporal_hierarchies
// 兩處輸出（JSON 匯出與 Step3 即時預覽）沿用同一份物件、不必各自維護一份型別。
interface GenHierarchySpec {
    bins?: CustomBin[];
    levels?: string[];
    time_periods?: { min: string | null; max: string | null; label: string }[];
    rounding?: number;
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
    genDirection?: 'front' | 'back'; // 字串「前後綴」泛化策略之保留方向 (僅 type==='string' 且 genStrategy==='prefix' 時適用)
    customBins?: CustomBin[];
    genLevelRangeUpper?: number; // 層級範圍上限（類別型階層樹、時間粒度適用）；大於 genMaxLevel 時送出 [genMaxLevel, 上限]，genMaxLevel 為實際輸出層級

    [key: string]: unknown; 
}

interface HierarchyTable 
{
    id: string;            
    fieldName: string;     
    mappings: string[][];  

    [key: string]: unknown;
}






const buildExportJSON = (fieldsList: FieldDef[], hierarchiesList: HierarchyTable[]): Record<string, unknown> => {
    const currentWorkspaceStoreStateData = useWorkspaceStore.getState();
    const currentPreprocessingRulesData = currentWorkspaceStoreStateData.preprocessingRules || {};

    const generatedFieldAttributesMap: Record<string, { type: string; role: string, strategy?: string }> = {};
    const generatedMaskingRulesMap: Record<string, Record<string, string | number>> = {};
    const generatedGeneralizationRulesMap: Record<string, Record<string, string | number>> = {};
    const generatedGeneralizationHierarchiesMap: Record<string, GenHierarchySpec> = {};
    const generatedTemporalHierarchiesMap: Record<string, GenHierarchySpec> = {};
    const generatedCategoricalHierarchiesMap: Record<string, { mapping: Record<string, string[]> }> = {};
    const generatedQiLevelsMap: Record<string, number | [number, number]> = {};

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
            // ★ 與 Step4_Result.tsx 送給後端之大包設定檔同步修正：依 2_操作說明.md 4-1 節，
            //   數值型間接識別碼的切法已由 bins／rounding 寫死，不吃層級，故 qi_generalization_levels
            //   不應包含數值型欄位，否則此處匯出的 JSON 會與實際送給後端的設定檔內容兜不起來。
            if (fieldItemRecord.type !== 'numeric') {
                generatedQiLevelsMap[fieldItemRecord.name] = buildQiLevelValue(fieldItemRecord.genMaxLevel, fieldItemRecord.genLevelRangeUpper);
            }

            // ★ 字串型「保留前後綴」策略依 genDirection 輸出 keep_prefix／keep_suffix，與 masking_rules 之策略命名慣例保持一致
            let outputGenStrategy = fieldItemRecord.genStrategy;
            if (fieldItemRecord.type === 'string' && fieldItemRecord.genStrategy === 'prefix') {
                outputGenStrategy = fieldItemRecord.genDirection === 'back' ? 'keep_suffix' : 'keep_prefix';
            }

            generatedGeneralizationRulesMap[fieldItemRecord.name] = {
                strategy: outputGenStrategy,
                param: fieldItemRecord.genParam,
                max_level: fieldItemRecord.genMaxLevel
            };

            // ★ 與 Step4_Result.tsx 送給後端之大包設定檔同步修正：數值型「泛化層級」在 Step2
            //   只是「原始 (0)／啟用 (1)」的開關，先前不論選哪個都照樣送出 bins／rounding，
            //   等於這顆開關沒有作用；這裡補上判斷，選「原始」時視為不套用該欄位的數值泛化。
            const isNumericGeneralizationEnabledStatus = typeof fieldItemRecord.genMaxLevel === 'number'
                ? fieldItemRecord.genMaxLevel >= 1
                : true;

            if (fieldItemRecord.type === 'numeric' && fieldItemRecord.genStrategy === 'custom_bins' && fieldItemRecord.customBins && isNumericGeneralizationEnabledStatus) {
                generatedGeneralizationHierarchiesMap[fieldItemRecord.name] = { bins: fieldItemRecord.customBins };
            } else if (fieldItemRecord.type === 'numeric' && fieldItemRecord.genStrategy === 'rounding' && isNumericGeneralizationEnabledStatus) {
                // ★ 數值四捨五入：先前此函數完全沒有處理 'rounding' 策略，導致年齡／薪資／
                //   就醫次數等採 rounding 的欄位完全不會出現在 generalization_hierarchies 裡，
                //   與 Step4_Result.tsx 實際送給後端的內容、以及 config_kanon.json 範例格式都對不起來。
                const roundingUnitValue = typeof fieldItemRecord.genParam === 'number'
                    ? fieldItemRecord.genParam
                    : Number(fieldItemRecord.genParam);
                if (Number.isFinite(roundingUnitValue) && roundingUnitValue > 0) {
                    generatedGeneralizationHierarchiesMap[fieldItemRecord.name] = { rounding: roundingUnitValue };
                }
            }

            if (fieldItemRecord.type === 'temporal') {
                // ★ 時間粒度／時間區間合併後之正確輸出：與 Step4_Result.tsx 送給後端的大包設定檔採同一套邏輯
                //   （levels 六級陣列／time_periods 時段對照表），避免匯出檔與實際送出後端的請求內容不一致。
                //   同一份物件同時寫入 generalization_hierarchies（匯出／匯入共用之正式來源）與
                //   temporal_hierarchies（Step3 即時預覽用，維持既有欄位相容）。
                let temporalHierarchySpecValue: GenHierarchySpec | undefined;
                if (fieldItemRecord.genStrategy === 'time_rounding') {
                    temporalHierarchySpecValue = { levels: [...TEMPORAL_GRANULARITY_UNITS] };
                } else if (fieldItemRecord.genStrategy === 'time_range' && fieldItemRecord.customBins) {
                    temporalHierarchySpecValue = {
                        levels: ['hour'],
                        time_periods: fieldItemRecord.customBins.map((binItemRecord) => ({
                            min: binItemRecord.min === null ? null : formatMinutesOfDayAsHHMM(binItemRecord.min),
                            max: binItemRecord.max === null ? null : formatMinutesOfDayAsHHMM(binItemRecord.max),
                            label: binItemRecord.label
                        }))
                    };
                }
                if (temporalHierarchySpecValue) {
                    generatedGeneralizationHierarchiesMap[fieldItemRecord.name] = temporalHierarchySpecValue;
                    generatedTemporalHierarchiesMap[fieldItemRecord.name] = temporalHierarchySpecValue;
                }
            }
        }
    });

    // ★ 與 Step4_Result.tsx 送給後端之大包設定檔同步修正：後端實際要求的 generalization_matrices
    //   格式為 { 欄位名稱: { mapping: { 原始值: [原始值, 上一層, ...] } } }（一個物件，value 才是
    //   階梯陣列），先前這裡輸出的是攤平的 string[][] 裸陣列，與 config_kanon.json 範例格式不符，
    //   即時預覽因此顯示錯誤形狀。
    const generatedGeneralizationMatrices: Record<string, { mapping: Record<string, string[]> }> = {};
    hierarchiesList.forEach((hierarchyTableRecord) => {
        if (!hierarchyTableRecord.fieldName) return;

        const mappingDictionaryData: Record<string, string[]> = {};

        hierarchyTableRecord.mappings.forEach((mappingRowArray) => {
            if (mappingRowArray[0]) {
                const validCells = mappingRowArray.filter(cellValueStr => cellValueStr !== '');
                mappingDictionaryData[mappingRowArray[0]] = validCells;
            }
        });

        if (Object.keys(mappingDictionaryData).length > 0) {
            generatedCategoricalHierarchiesMap[hierarchyTableRecord.fieldName] = { mapping: mappingDictionaryData };
            generatedGeneralizationMatrices[hierarchyTableRecord.fieldName] = { mapping: mappingDictionaryData };
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
                cell_fill: currentWorkspaceStoreStateData.cellFillMethod ?? "star",
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
        temporal_hierarchies: Object.keys(generatedTemporalHierarchiesMap).length > 0 ? generatedTemporalHierarchiesMap : undefined,
        masking_rules: Object.keys(generatedMaskingRulesMap).length > 0 ? generatedMaskingRulesMap : undefined,
        generalization_rules: Object.keys(generatedGeneralizationRulesMap).length > 0 ? generatedGeneralizationRulesMap : undefined
    };
};

/**
 * 函數名稱: buildSpecCompliantPreviewJSON
 * 函數功能: 從 buildExportJSON() 之完整內部狀態結果中，萃取欄位設定與泛化規則，並包成與
 *           Step4_Result.tsx 實際送給後端的 v1.2.0「大包」格式一致的 k_anonymity 區塊
 *           (enabled／k／l／t／suppression_method／suppression_limit_percent／
 *           limit_exceeded_action／columns／generalization_hierarchies／
 *           generalization_matrices／qi_generalization_levels)，供「即時設定檔預覽」呈現。
 *           ★ 先前這裡輸出的是攤平格式（version／dataset／columns 等直接放在最外層），
 *           沒有包在 k_anonymity 區塊內，也沒有 k／suppression_method 等參數，與
 *           config_kanon.json 範例、以及實際送出後端的請求內容都不一致，使用者對照時
 *           會覺得「怎麼顯示成這樣」。l／t 僅在使用者於 Step3 實際啟用對應開關時才寫入，
 *           與 Step4_Result.tsx 送出邏輯保持一致。
 */
const buildSpecCompliantPreviewJSON = (fieldsList: FieldDef[], hierarchiesList: HierarchyTable[]): Record<string, unknown> =>
    // ★ 2026-10-01：改為與 Step4 實際送出、Step3 匯出共用 utils/pipelineConfig.ts 的組裝邏輯（含 version／
    //   dataset／input_format），三者保證一致；預覽反映的是畫面上正在編輯、尚未寫入 store 的欄位與階層。
    buildBackendConfigDocumentFromWorkspace({
        ...useWorkspaceStore.getState(),
        privacyMode: 'k-anonymity',
        kAnonymityFields: fieldsList,
        kAnonymityHierarchies: hierarchiesList
    }) ?? {};

// ★ 2026-10-05：輸入長度上限（使用者要求，避免輸入過長造成畫面錯誤）。
//   泛化階層對照之原始值／各層分類名稱、數值與時間自訂區間之顯示標籤：15 字
//   （實際資料集類別值最長約 3～5 字，15 字已足夠）；欄位名稱：50 字。
const HIERARCHY_CELL_MAX_LENGTH = 15;
// ★ 2026-10-13：泛化階層對照每張卡片的表格最大高度（以 em 為單位，隨字體大小縮放），超過即在卡片內捲動，表頭固定。
const HIERARCHY_SCROLL_BOX_MAX_HEIGHT = '26em';
const CUSTOM_BIN_LABEL_MAX_LENGTH = 15;
const FIELD_NAME_MAX_LENGTH = 50;

/**
 * 函數名稱: buildInitialKAnonymityFieldForColumn
 * 函數功能: 依資料欄位名稱與 Store 中既有之型態／角色，建立該欄位之預設 K-匿名設定列。
 *           (初始化欄位清單、「新增定義欄位」、「補上缺漏欄位」三處共用。)
 */
const buildInitialKAnonymityFieldForColumn = (columnNameString: string, storeColumnTypesMap: Record<string, string>, storeColumnRolesMap: Record<string, string>): FieldDef => {
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
        hashType: 'SHA256', 
        genStrategy: resolveDefaultGenStrategyForType(mappedFieldTypeValue),
        genParam: mappedFieldTypeValue === 'string' ? DEFAULT_MASK_KEEP_CHARS : DEFAULT_GENERALIZATION_PARAM,
        genMaxLevel: DEFAULT_MAX_GENERALIZATION_LEVEL,
        genDirection: 'front' as const
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
    // ★ 新增：「數值區間化系統推薦設定」需要欄位之實際最小/最大值，而 previewData 僅為 Step1
    // 上傳時擷取之預覽樣本 (筆數有上限)，不足以代表全量資料範圍。改讀取原始檔案物件 dataFile，
    // 於下方 useEffect 中重新完整解析；解析結果直接寫入 WorkspaceStore 既有之
    // datasetColumnNumericValuesMap 全域快取欄位 (與 DifferentialPrivacyMapping.tsx 共用同一份，
    // 避免兩處各自維護一份重複的快取，也不需要另建本地 useState 儲存)。
    const datasetColumnNumericValuesMap = useWorkspaceStore((state) => state.datasetColumnNumericValuesMap);
    // ★ 2026-09-29：各欄位實際資料最小值（逐一比較求得，避免資料量大時 Math.min(...陣列) 參數過多
    //   觸發 RangeError）。供下方「第一個區間已向下延伸至 0」註解判斷用。
    const datasetColumnRealMinValueMap = useMemo(() => {
        const minValueByColumnMap: Record<string, number> = {};
        Object.entries(datasetColumnNumericValuesMap || {}).forEach(([columnNameKey, numericValuesArray]) => {
            if (!Array.isArray(numericValuesArray) || numericValuesArray.length === 0) return;
            let currentMinValue = Infinity;
            for (const numericValue of numericValuesArray) {
                if (typeof numericValue === 'number' && numericValue < currentMinValue) currentMinValue = numericValue;
            }
            if (Number.isFinite(currentMinValue)) minValueByColumnMap[columnNameKey] = currentMinValue;
        });
        return minValueByColumnMap;
    }, [datasetColumnNumericValuesMap]);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const [kAnonymityFieldsList, setKAnonymityFieldsList] = useState<FieldDef[]>(globalCachedKAnonymityFields || []);
    const [kAnonymityHierarchiesList, setKAnonymityHierarchiesList] = useState<HierarchyTable[]>(globalCachedKAnonymityHierarchies || []);
    const [isJsonPreviewVisibleStatus, setIsJsonPreviewVisibleStatus] = useState<boolean>(false);
    // ★ 新增：每個欄位各自的「系統推薦設定」UI 狀態 (模式/區間數量/單位寬度)。
    const [binAutoFillSettingsMap, setBinAutoFillSettingsMap] = useState<Record<string, { mode: 'even' | 'unit'; binCount: number; unitWidth: number }>>({});

    // ★ 2026-10-13：「泛化階層對照」分頁每張卡片可收合，列數多時表格內部捲動。
    // 鍵值：自訂區間卡片 `bins:<欄位 id>`；階層樹對照表 `tree:<對照表 id>`。預設全部展開。
    const [collapsedHierarchyCardKeyMap, setCollapsedHierarchyCardKeyMap] = useState<Record<string, boolean>>({});
    const isHierarchyCardCollapsed = (cardKeyStr: string): boolean => !!collapsedHierarchyCardKeyMap[cardKeyStr];
    const toggleHierarchyCardCollapsed = (cardKeyStr: string): void =>
        setCollapsedHierarchyCardKeyMap((previousMap) => ({ ...previousMap, [cardKeyStr]: !previousMap[cardKeyStr] }));
    const collapseAllHierarchyCards = (): void => {
        const nextMap: Record<string, boolean> = {};
        kAnonymityFieldsList.forEach((fieldItemRecord) => { nextMap[`bins:${fieldItemRecord.id}`] = true; });
        kAnonymityHierarchiesList.forEach((hierarchyItemRecord) => { nextMap[`tree:${hierarchyItemRecord.id}`] = true; });
        setCollapsedHierarchyCardKeyMap(nextMap);
    };
    const expandAllHierarchyCards = (): void => setCollapsedHierarchyCardKeyMap({});
    // 新增一列後捲到捲動區底部，讓使用者看得到剛新增的列（等 React 重新渲染後再捲）
    const scrollHierarchyBoxToBottom = (cardKeyStr: string): void => {
        window.setTimeout(() => {
            const scrollBoxElement = document.querySelector<HTMLElement>(`[data-hierarchy-scroll="${cardKeyStr}"]`);
            if (scrollBoxElement) scrollBoxElement.scrollTop = scrollBoxElement.scrollHeight;
        }, 0);
    };
    const renderHierarchyCardToggle = (cardKeyStr: string): React.ReactNode => {
        const isCollapsedStatus = isHierarchyCardCollapsed(cardKeyStr);
        return (
            <Tooltip title={isCollapsedStatus ? translate('step2.hierarchy_card_expand', '展開') : translate('step2.hierarchy_card_collapse', '收起')}>
                <Button
                    type="text"
                    size="small"
                    aria-expanded={!isCollapsedStatus}
                    onClick={() => toggleHierarchyCardCollapsed(cardKeyStr)}
                    icon={<RightOutlined style={{ transition: 'transform 0.2s', transform: isCollapsedStatus ? 'none' : 'rotate(90deg)' }} />}
                />
            </Tooltip>
        );
    };

    // ★ 需要各欄位完整資料的實際數值陣列（datasetColumnNumericValuesMap），避免依賴筆數有上限的
    //   previewData 導致「系統推薦設定」算出來的區間範圍失真。
    // ★ 2026-09-30：改由 utils/datasetProfile.ts 統一掃描一次並寫入快取，不再於本元件另外完整
    //   Papa.parse 一次（同一份檔案在 Step2～Step4 各頁共用同一份結果）。
    useEnsureDatasetProfile();

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

        // ★ 新增：使用者反映「Step2 畫面上明明已設定 1 個敏感欄位，但 Step4 執行卻偵測到 0 個」。
        //   追查後發現根因：「欄位名稱」是可自由編輯的文字輸入框（含「+ 新增欄位」按鈕新增的欄位），
        //   系統從未檢查過名稱是否重複。若兩個欄位剛好同名（例如原本自動帶入的欄位還在，使用者又
        //   誤用「+ 新增欄位」多加了一個同名列並把新那列設成「敏感資料」），Step2 這裡以
        //   Array.filter() 統計「敏感欄位數量」時能正確算到 2 筆同名中設成敏感的那一筆；但 Step4
        //   實際組裝送給後端的設定檔是逐一比對「資料集實際欄位」再用 Array.find() 依名稱取「第一筆」
        //   相符的欄位設定——若排在前面的剛好是另一筆同名但角色不同（例如仍是預設的「非敏感」）的
        //   欄位，就會被誤用，導致畫面上看起來設定正確、實際送出的角色卻對不上。從根本上禁止同一份
        //   欄位清單出現重複名稱，可徹底避免這整類「畫面與實際送出不一致」的問題（不只影響敏感欄位，
        //   角色、型態、遮蔽策略等所有依名稱比對的設定都可能受影響）。
        const nonEmptyFieldNamesList = kAnonymityFieldsList
            .map((fieldItemRecord) => (fieldItemRecord.name || '').trim())
            .filter((nameTextValue) => nameTextValue !== '');
        const duplicatedFieldNameSet = new Set<string>();
        const seenFieldNameSet = new Set<string>();
        for (const nameTextValue of nonEmptyFieldNamesList) {
            if (seenFieldNameSet.has(nameTextValue)) {
                duplicatedFieldNameSet.add(nameTextValue);
            }
            seenFieldNameSet.add(nameTextValue);
        }
        if (duplicatedFieldNameSet.size > 0) {
            const duplicatedFieldNamesListText = Array.from(duplicatedFieldNameSet).join('、');
            setStepValidationAction(
                false,
                translate(
                    'step2.duplicate_field_name_error',
                    `欄位名稱重複：[${duplicatedFieldNamesListText}] 出現超過一次。系統會依名稱比對各欄位的設定，重複名稱會導致角色／型態等設定被誤判，請刪除多餘的重複列或修改其中一個名稱。`
                )
            );
            return;
        }

        // ★ 2026-10-07：欄位清單須與上傳資料一致。資料中不存在的欄位 (匯入設定檔或手動新增) 在 Step4
        //   組設定檔時會被直接丟掉，但這裡的敏感欄位數、QI 判斷仍會把它算進去，造成畫面設定與實際
        //   送出不一致；尚未選擇欄位名稱的空白列同理。兩者皆阻擋下一步。規則見 utils/datasetFieldConsistency.ts。
        const configuredFieldNamesList = kAnonymityFieldsList.map((fieldItemRecord) => fieldItemRecord.name);
        const blankFieldNameCount = storeColumnsList.length > 0 ? countBlankFieldNames(configuredFieldNamesList) : 0;
        if (blankFieldNameCount > 0) {
            setStepValidationAction(false, translate('step2.blank_field_name_error', describeBlankFieldNamesError(blankFieldNameCount)));
            return;
        }
        const fieldsNotInDatasetNamesList = findFieldsNotInDataset(configuredFieldNamesList, storeColumnsList);
        if (fieldsNotInDatasetNamesList.length > 0) {
            setStepValidationAction(false, describeFieldsNotInDatasetError(fieldsNotInDatasetNamesList));
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

                    // ★ 2026-10-06：逐列防呆（原始值空白、中間層空白、原始值重複、未填到選用層級），
                    //   規則見 utils/hierarchyTableValidation.ts。畫面上對應格子會標紅框。
                    const hierarchyRowProblemsList = findHierarchyTableProblems(targetHierarchyTableRecord!.mappings, fieldItemRecord.genMaxLevel);
                    if (hierarchyRowProblemsList.length > 0) {
                        const otherProblemsText = hierarchyRowProblemsList.length > 1 ? `（另有 ${hierarchyRowProblemsList.length - 1} 處問題，已用紅框標示）` : '';
                        validationErrorMessageString = `「泛化階層對照」分頁的「${fieldItemRecord.name}」對照表：${describeHierarchyRowProblem(hierarchyRowProblemsList[0], fieldItemRecord.genMaxLevel)}${otherProblemsText}。請修正後再進入下一步。`;
                        break;
                    }
                } else if (fieldItemRecord.genStrategy === 'custom_bins' || fieldItemRecord.genStrategy === 'time_range') {
                    // ★ 新增：使用者反映「泛化階層對照」分頁的自訂區間表格，「顯示標籤」留空時
                    //   仍可點擊下一步，直到 Step4 送出後端才會被 app/core/config.py 的
                    //   parse_numeric_bins() 擋下（缺少 label 或 label 為空白字串）。已對照該函式
                    //   原始碼確認其完整驗證規則：至少一段、每段皆須有非空白 label、只有第一段可以
                    //   不填下限、只有最後一段可以不填上限、同段下限須小於上限、各段須由小到大排列
                    //   且不重疊。這裡逐一比照補上等價的前端防呆，不只擋掉本次回報的「標籤留空」，
                    //   也一併擋掉會落入同一類「Step2 能過、Step4 才報錯」的其他缺漏（例如中間段
                    //   忘記填下限/上限、下限大於上限、兩段順序顛倒），讓使用者在這個畫面就能看到
                    //   明確指出是哪一個欄位、第幾段、什麼原因的錯誤訊息。
                    const currentBinsListArray = fieldItemRecord.customBins || [];

                    if (currentBinsListArray.length === 0) {
                        validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 尚未設定任何區間，請至「泛化階層對照」分頁新增至少一段並填寫顯示標籤。`;
                        break;
                    }

                    const lastBinIndexNumber = currentBinsListArray.length - 1;
                    let previousBinMaxBoundValue: number | null = null;

                    for (let binIndexNumber = 0; binIndexNumber <= lastBinIndexNumber; binIndexNumber++) {
                        const binItemRecord = currentBinsListArray[binIndexNumber];
                        const binOrdinalNumber = binIndexNumber + 1;

                        if (!binItemRecord.label || !binItemRecord.label.trim()) {
                            validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 的自訂區間第 ${binOrdinalNumber} 段尚未填寫「顯示標籤」，請至「泛化階層對照」分頁完成設定。`;
                            break;
                        }
                        if (binItemRecord.min === null && binIndexNumber !== 0) {
                            validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 的自訂區間第 ${binOrdinalNumber} 段缺少下限，只有第一段可以不填下限。`;
                            break;
                        }
                        if (binItemRecord.max === null && binIndexNumber !== lastBinIndexNumber) {
                            validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 的自訂區間第 ${binOrdinalNumber} 段缺少上限，只有最後一段可以不填上限。`;
                            break;
                        }
                        if (binItemRecord.min !== null && binItemRecord.max !== null && binItemRecord.min >= binItemRecord.max) {
                            validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 的自訂區間第 ${binOrdinalNumber} 段的下限必須小於上限。`;
                            break;
                        }
                        if (previousBinMaxBoundValue !== null && binItemRecord.min !== null && binItemRecord.min < previousBinMaxBoundValue) {
                            validationErrorMessageString = `欄位 [${fieldItemRecord.name}] 的自訂區間第 ${binOrdinalNumber} 段與前一段重疊或未依序排列，請由小到大設定。`;
                            break;
                        }
                        if (binItemRecord.max !== null) previousBinMaxBoundValue = binItemRecord.max;
                    }

                    if (validationErrorMessageString) break;
                } else if (['rounding', 'prefix', 'length', 'time_rounding'].includes(fieldItemRecord.genStrategy)) {
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

        // ★ 使用者反映（2026-09-22）：先前這裡「敏感欄位設定 0 個或 2 個以上就擋住下一步」的規則，
        //   是對照舊版後端規則（RiskConfig 要求恰好宣告 1 個 sensitive）預先擋在 Step2。但 Step4
        //   執行端（Step4_Result.tsx runFullPipeline）已改版：0 個時會顯示警告但不阻擋、直接略過
        //   三攻擊與 CAP（其餘去識別化結果與品質分數照常產生）；2 個以上時會比照差分隱私模式，
        //   對每個標記為「敏感」的欄位各自輪流評估一次三攻擊與 CAP、取最保守（風險最高）的結果，
        //   不再需要「只能留一個、其餘分次執行」。故這裡不再因為敏感欄位數量而擋下「下一步」，
        //   兩種情況都能直接往下走；下方欄位設定清單上方仍保留即時的資訊提示（見下方
        //   liveSensitiveFieldsCountNumber 那段），讓使用者知道 0 個時風險評估會被略過、
        //   2 個以上時會逐一評估取最保守結果，但不會因此卡住流程。
        // ★ 2026-10-02 使用者要求：K-匿名模式 Step2 必須至少設定 1 個敏感欄位才能進入 Step3
        //   （上段「0 個不擋」的規則就此改為「0 個要擋」；2 個以上仍不擋）。
        //   角色為「敏感欄位」但處理方式選「移除」者不算數：後端去識別化會把該欄自輸出刪除
        //   （pipeline.py 角色清單只取仍存在於 df_out 的欄位），l/t 檢測與三攻擊／CAP 都拿不到它。
        const sensitiveFieldsList = kAnonymityFieldsList.filter((fieldItemRecord) => fieldItemRecord.role === 'Sensitive' && isFieldNameInDataset(fieldItemRecord.name, buildDatasetColumnNameSet(storeColumnsList)));
        const keptSensitiveFieldsCountNumber = sensitiveFieldsList.filter((fieldItemRecord) => fieldItemRecord.maskStrategy !== 'remove').length;
        if (sensitiveFieldsList.length === 0) {
            setStepValidationAction(false, translate('step2.error_require_sensitive', '請至少將一個欄位的角色設為「敏感欄位」（例如疾病、收入區間）才能進入下一步。'));
            return;
        }
        if (keptSensitiveFieldsCountNumber === 0) {
            setStepValidationAction(false, translate('step2.error_sensitive_all_removed', '已設定的敏感欄位處理方式皆為「移除」，去識別化後輸出資料中將沒有任何敏感欄位，l-多樣性／t-緊密度檢測與風險評估都無法執行。請至少保留一個敏感欄位（處理方式選「不處理」）。'));
            return;
        }
        setStepValidationAction(true, null);
    }, [kAnonymityFieldsList, kAnonymityHierarchiesList, storeColumnsList, preprocessingRulesMap, setStepValidationAction, translate]);

    // 2. 初始化 storeColumnsList
    useEffect(() => {
        const currentColumnNamesKeyString = JSON.stringify(storeColumnsList);

        if (storeColumnsList.length > 0 && globalCachedColumnsKeyString !== currentColumnNamesKeyString) {
            const constructedInitialFieldsList = storeColumnsList.map((columnNameString) => buildInitialKAnonymityFieldForColumn(columnNameString, storeColumnTypesMap, storeColumnRolesMap));

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

        // ★ 修正：此 Effect 僅在 kAnonymityFieldsList／kAnonymityHierarchiesList 實際變動時才會觸發 (見下方
        //   dependency array)，故無須再另行比對 columnRoles／columnTypes／fieldAttributes 是否變動才決定是否
        //   同步。先前依此比對結果決定是否寫入 Store 的作法，會導致「只調整泛化參數 (genStrategy／genParam／
        //   genMaxLevel／customBins) 或編輯階層樹對照表，但未變更角色與型態」時，因三項比對皆判定為無差異
        //   而整批略過寫入，使 Step3／匯出設定檔讀到的 generalizationRules／categoricalHierarchies／
        //   numericBins／temporalHierarchies 停留在舊值，造成「Step3 沒有抓到最新的 Step2 設定」。
        useWorkspaceStore.setState({
            columnRoles: updatedRolesDictionaryMap,
            columnTypes: updatedTypesDictionaryMap,
            columns: currentStore.columns.length > 0 ? currentStore.columns : updatedColumnNamesListArray,
            kAnonymityFields: kAnonymityFieldsList as Record<string, unknown>[],
            kAnonymityHierarchies: kAnonymityHierarchiesList as Record<string, unknown>[],
            fieldAttributes: nextFieldAttrs,
            maskingRules: (liveJsonExportDataObject.masking_rules || {}) as Record<string, unknown>,
            generalizationRules: (liveJsonExportDataObject.generalization_rules || {}) as Record<string, unknown>,
            generalizationHierarchies: (liveJsonExportDataObject.generalization_hierarchies || {}) as Record<string, unknown>,
            categoricalHierarchies: (liveJsonExportDataObject.categorical_hierarchies || {}) as Record<string, unknown>,
            numericBins: (liveJsonExportDataObject.numeric_bins || {}) as Record<string, unknown>,
            temporalHierarchies: (liveJsonExportDataObject.temporal_hierarchies || {}) as Record<string, unknown>
        });
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
                if (!isNaN(parsedNumericValue)) {
                    if (fieldItemConfigRecord.genStrategy === 'rounding' && fieldItemConfigRecord.genParam > 0) {
                        return String(Math.round(parsedNumericValue / fieldItemConfigRecord.genParam) * fieldItemConfigRecord.genParam);
                    }
                    if (fieldItemConfigRecord.genStrategy === 'custom_bins' && fieldItemConfigRecord.customBins) {
                        const matchedBinItemRecord = fieldItemConfigRecord.customBins.find(
                            (binItemRecord) => (binItemRecord.min === null || parsedNumericValue >= binItemRecord.min) && (binItemRecord.max === null || parsedNumericValue < binItemRecord.max)
                        );
                        if (matchedBinItemRecord) return matchedBinItemRecord.label || parsedStringValue;
                    }
                }
            } else if (fieldItemConfigRecord.type === 'temporal') {
                if (fieldItemConfigRecord.genStrategy === 'time_rounding') {
                    // 時間粒度（分/時/日/月/年）；假設欄位格式為 "YYYY-MM-DD HH:MM:SS"（或其可辨識前綴），僅作即時預覽用途。
                    const previewPrefixLengthByUnit: Record<string, number> = { minute: 16, hour: 13, day: 10, month: 7, year: 4 };
                    const previewUnitName = temporalUnitOfLevel(fieldItemConfigRecord.genMaxLevel);
                    if (previewUnitName) return parsedStringValue.substring(0, previewPrefixLengthByUnit[previewUnitName]);
                } else if (fieldItemConfigRecord.genStrategy === 'time_range' && fieldItemConfigRecord.customBins) {
                    const timeOfDayMatchResultArray = parsedStringValue.match(/(\d{1,2}):(\d{2})/);
                    if (timeOfDayMatchResultArray) {
                        const totalMinutesOfDayValue = parseInt(timeOfDayMatchResultArray[1], 10) * 60 + parseInt(timeOfDayMatchResultArray[2], 10);
                        const matchedTimeRangeItemRecord = fieldItemConfigRecord.customBins.find(
                            (binItemRecord) => (binItemRecord.min === null || totalMinutesOfDayValue >= binItemRecord.min) && (binItemRecord.max === null || totalMinutesOfDayValue < binItemRecord.max)
                        );
                        if (matchedTimeRangeItemRecord) return matchedTimeRangeItemRecord.label || parsedStringValue;
                    }
                }
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
                const stringValueLengthNumber = parsedStringValue.length;

                // ★ 修正 (依實際後端原始碼核對): 後端 StringGeneralizer 對「保留前後綴」(mask_mode
                //   prefix/suffix) 的實際保留字元數，是由「最大層級」(genMaxLevel) 用公式
                //   max(5 - level, 1) 換算出來的，並非由「參數設定」(genParam) 決定——genParam
                //   在這個策略下對後端結果完全沒有影響。前端此處先前誤用 genParam 當保留字元數基準，
                //   現改為與後端演算法一致，避免預覽結果與後端實際輸出不一致。
                if (fieldItemConfigRecord.genStrategy === 'prefix') {
                    const keepCharactersLengthValue = Math.min(Math.max(5 - fieldItemConfigRecord.genMaxLevel, 1), stringValueLengthNumber);
                    const maskedCharCountValue = Math.max(0, stringValueLengthNumber - keepCharactersLengthValue);
                    return fieldItemConfigRecord.genDirection === 'back'
                        ? '*'.repeat(maskedCharCountValue) + parsedStringValue.substring(stringValueLengthNumber - keepCharactersLengthValue)
                        : parsedStringValue.substring(0, keepCharactersLengthValue) + '*'.repeat(maskedCharCountValue);
                }

                if (fieldItemConfigRecord.genStrategy === 'length') {
                    // ★ 修正 (依實際後端原始碼核對): 「依字串長度」策略後端做的並不是「遮蔽 N 個字元」，
                    //   而是把值完全隱藏、只回報「長度落在哪個級距」的標籤（例如 "5-9"），級距寬度
                    //   公式為 bin_size × level。後端公式雖然吃兩個數字，但「最大層級」對這個策略
                    //   而言只是單純的倍數，兩個欄位一起顯示反而讓使用者誤以為兩者都要調——
                    //   ★ 使用者反映: 「字串長度應該只要設定參數而已」，故 UI 端統一把 level 固定為 1
                    //   （見下方「最大層級」欄位 render，該策略已不再顯示、不可調整），讓「參數設定」
                    //   單獨等於實際輸出的級距寬度，使用者只需要調這一個數字即可。
                    const binSizeBaseValue = Number(fieldItemConfigRecord.genParam) > 0 ? Number(fieldItemConfigRecord.genParam) : 5;
                    const lengthGradeWidthValue = Math.max(binSizeBaseValue * STRING_LENGTH_STRATEGY_FIXED_LEVEL, 1);
                    const lengthGradeLowerBoundValue = Math.floor(stringValueLengthNumber / lengthGradeWidthValue) * lengthGradeWidthValue;
                    return `${lengthGradeLowerBoundValue}-${lengthGradeLowerBoundValue + lengthGradeWidthValue - 1}`;
                }
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

                // ★ 2026-10-02：差分隱私設定檔不可匯入 K-匿名頁面（先前會退回讀取 field_attributes 而「成功匯入」）
                if (detectConfigPrivacyMode(parsedJsonContentData) === 'differential-privacy') {
                    messageApi.error(translate('message.import_json_mode_mismatch_dp', '此設定檔為「差分隱私」模式，無法匯入 K-匿名化欄位設定。請改用 K-匿名化設定檔，或回到 Step1 切換為差分隱私模式後再匯入。'));
                    return;
                }

                // ★ 相容 Open-PETs API v1.2.0「大包」格式：交付包 config_kanon.json 把 k、l、t、
                //   suppression_method、columns、generalization_hierarchies／matrices、
                //   qi_generalization_levels 全部包在同一個 k_anonymity 區塊底下，而不是舊版匯出格式
                //   使用的 privacy_targets.k_anonymity 或頂層 field_attributes／generalization_hierarchies。
                //   先前只認得舊版路徑，實際匯入交付包設定檔時 rawAttributesMap 永遠是空物件，
                //   於是「成功匯入」訊息照樣跳出，但一個欄位都沒真的匯進來。兩種路徑都要支援，
                //   才不會讓既有「匯出 JSON」產生的舊檔案匯入失效。
                const importedKAnonymityBlock = parsedJsonContentData.k_anonymity || parsedJsonContentData.privacy_targets?.k_anonymity;

                // ★ 2026-10-28：後端格式的 preprocess 區塊（單一入口 config_preprocess.json、統合版設定檔）。
                //   純前處理設定檔只更新清洗設定就結束，不可往下走——先前會讀不到任何欄位而把欄位設定整個清空。
                const preprocessImportResult = importPreprocessFromConfig(parsedJsonContentData, storeColumnsList);
                const hasKAnonymityContent = Boolean(
                    importedKAnonymityBlock || parsedJsonContentData.field_attributes || parsedJsonContentData.columns ||
                    parsedJsonContentData.masking_rules || parsedJsonContentData.generalization_rules ||
                    parsedJsonContentData.generalization_hierarchies || parsedJsonContentData.generalization_matrices ||
                    parsedJsonContentData.qi_generalization_levels || parsedJsonContentData.categorical_hierarchies
                );
                // ★ 2026-10-28：統合版／單一入口風險評估設定檔的 risk_attacks／risk_cap 區塊
                const riskImportResult = importRiskFromConfig(parsedJsonContentData, storeColumnsList);
                if (preprocessImportResult) applyPreprocessImportToWorkspace(preprocessImportResult, messageApi, !hasKAnonymityContent);
                if (riskImportResult) applyRiskImportToWorkspace(riskImportResult, messageApi);
                // 只有前處理／風險評估區塊的設定檔：到此為止，不可往下走（會讀不到欄位而清空欄位設定，或報格式錯誤）
                if (!hasKAnonymityContent && (preprocessImportResult || riskImportResult)) return;

                if (importedKAnonymityBlock?.enabled) {
                    useWorkspaceStore.setState({
                        privacyMode: 'k-anonymity',
                        kValue: importedKAnonymityBlock.k ?? BASE_DEFAULT_K_ANONYMITY_VALUE,
                        maxSuppression: importedKAnonymityBlock.suppression_limit_percent ?? BASE_DEFAULT_SUPPRESSION_LIMIT,
                        ...resolveImportedLtSettings(importedKAnonymityBlock, Boolean(parsedJsonContentData.k_anonymity)),
                        ...(importedKAnonymityBlock.suppression_method ? { suppressionMethod: importedKAnonymityBlock.suppression_method } : {}),
                        ...(importedKAnonymityBlock.cell_fill ? { cellFillMethod: importedKAnonymityBlock.cell_fill } : {}),
                        // 後端格式：columns 底下的逐欄 cell_fill_value（沒有即清空，與本工具匯出「未填不寫入」一致）
                        ...(parsedJsonContentData.k_anonymity ? { cellFillValuesByColumn: extractImportedCellFillValues(importedKAnonymityBlock.columns) } : {}),
                        ...(importedKAnonymityBlock.limit_exceeded_action ? { limitExceededAction: importedKAnonymityBlock.limit_exceeded_action } : {}),
                    });
                }

                const rawAttributesMap = importedKAnonymityBlock?.columns || parsedJsonContentData.field_attributes || parsedJsonContentData.columns || {};
                const importedMaskingRulesMap = parsedJsonContentData.masking_rules || {};
                const importedGeneralizationRulesMap = parsedJsonContentData.generalization_rules || {};
                const importedGeneralizationHierarchiesMap: Record<string, GenHierarchySpec> = importedKAnonymityBlock?.generalization_hierarchies || parsedJsonContentData.generalization_hierarchies || {};
                const importedPreprocessingRulesMap: Record<string, unknown> = parsedJsonContentData.preprocessing_rules || {};
                // ★ 泛化層級（qi_generalization_levels）：後端／匯出格式的以此為準識別欄位實際選用之
                //   泛化層級來源；先前匯入從未讀取此欄位，導致匯入後一律退回預設層級，即使原始設定檔
                //   有明確指定（如生日的 qi_generalization_levels=6）也會被忽略。
                // ★ 修正: 使用者反映匯入後「最大層級」對不上設定檔。根因：交付包 config_kanon.json 的
                //   qi_generalization_levels 每個欄位的值除了單一數字外，也可能是 [下限, 上限] 的範圍陣列
                //   （例如「職業」為 [1, 3]，代表允許搜尋層級 1～3、上限為 3），但先前把這個欄位直接當成
                //   Record<string, number> 使用，遇到陣列值時，畫面上的「最大層級」InputNumber／Segmented
                //   收到的 value 會是整個陣列而非數字，導致顯示不出正確的最大層級（甚至顯示空白/錯亂）。
                // ★ 2026-10-01 更正：依後端 2_操作說明.md 4-1 節，[最小, 最大] 的實際輸出是「最小層級」，
                //   上限只用於評估並回報。改為最小層級寫入 genMaxLevel（實際輸出），上限另存 genLevelRangeUpper，
                //   送出時組回陣列（見 utils/kAnonymityConfigImport.normalizeImportedQiLevel）。
                const rawImportedQiGeneralizationLevelsMap: Record<string, number | number[]> = importedKAnonymityBlock?.qi_generalization_levels || parsedJsonContentData.qi_generalization_levels || {};
                const importedQiGeneralizationLevelsMap: Record<string, number> = {};
                const importedQiLevelRangeUpperMap: Record<string, number> = {};
                Object.keys(rawImportedQiGeneralizationLevelsMap).forEach((columnNameKeyStr) => {
                    const { level: normalizedLevelValue, rangeUpper: normalizedRangeUpperValue } = normalizeImportedQiLevel(rawImportedQiGeneralizationLevelsMap[columnNameKeyStr]);
                    if (normalizedLevelValue !== undefined) importedQiGeneralizationLevelsMap[columnNameKeyStr] = normalizedLevelValue;
                    if (normalizedRangeUpperValue !== undefined) importedQiLevelRangeUpperMap[columnNameKeyStr] = normalizedRangeUpperValue;
                });
                // ★ 修正: 類別型（自訂階層樹）欄位是否已匯入真正的階層對照表，需要在下方欄位迴圈中
                //   判斷「最大層級」保底值，因此提前到迴圈之前宣告（原本宣告在迴圈結束之後，欄位
                //   迴圈內完全讀不到，才會漏掉類別型欄位的最大層級保底邏輯）。
                const importedCategoricalHierarchiesMap = parsedJsonContentData.categorical_hierarchies || {};
                const importedGeneralizationMatrices = importedKAnonymityBlock?.generalization_matrices || parsedJsonContentData.generalization_matrices || {};

                // ★ 修正: 類別型（自訂階層樹）欄位匯入後「最大層級」應收斂到「這份設定檔實際定義到第幾層」，
                //   而不是隨便給個 1 (L1) 就好——例如使用者的階層對照表已經把「原始→L1→L2→L3」四欄都填好，
                //   代表原本的設定就是要泛化到 L3，若只給 1 會把泛化強度整個降級。這段原本寫在欄位迴圈
                //   「之後」才建立 updatedHierarchiesListArray，欄位迴圈當下完全讀不到匯入的階層深度，
                //   因此提前到欄位迴圈之前先建好階層對照表與「欄位名稱→實際最大層級」查詢表，供下方
                //   欄位迴圈使用。判斷邏輯與畫面上「最大層級」欄位的 Segmented 選項算法一致：
                //   最大層級 = 該欄位階層對照表中最長一列的欄位數 - 1（第 1 欄是原始值，其餘每欄各代表一層）。
                const updatedHierarchiesListArray: HierarchyTable[] = [];

                Object.keys(importedGeneralizationMatrices).forEach((columnNameString) => {
                    const cleanColName = columnNameString.replace(/^\uFEFF/, '').trim();
                    const matrixData = importedGeneralizationMatrices[columnNameString];

                    // ★ 交付包／後端實際格式為 { mapping: { 原始值: [原始值, 上一層, ...] } }（一個物件，
                    //   value 才是 rows 陣列），先前只認得「本身就是 rows 陣列」的舊版匯出格式，
                    //   導致交付包 config_kanon.json 的地區／職業階層一律被跳過、完全沒有匯入。
                    let mappingRowsArray: string[][] | undefined;
                    if (Array.isArray(matrixData)) {
                        mappingRowsArray = matrixData;
                    } else if (matrixData && typeof matrixData === 'object' && matrixData.mapping) {
                        mappingRowsArray = Object.values(matrixData.mapping) as string[][];
                    }

                    if (mappingRowsArray && mappingRowsArray.length > 0) {
                        updatedHierarchiesListArray.push({
                            id: `h_${Math.random().toString(36).substr(2, 9)}`,
                            fieldName: cleanColName,
                            mappings: mappingRowsArray
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

                const hierarchyMaxLevelByFieldNameMap: Record<string, number> = {};
                updatedHierarchiesListArray.forEach((hierarchyItemRecord) => {
                    hierarchyMaxLevelByFieldNameMap[hierarchyItemRecord.fieldName] =
                        Math.max(...hierarchyItemRecord.mappings.map((mappingRowArray) => mappingRowArray.length), 2) - 1;
                });

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

                // 舊版匯出格式的 preprocessing_rules；已讀到後端 preprocess 區塊時以後者為準。
                // ★ 2026-10-28：設定檔完全沒有前處理設定時不再清空畫面上的清洗設定（後端 K-匿名設定檔本來就不含前處理）。
                if (!preprocessImportResult && parsedJsonContentData.preprocessing_rules) {
                    useWorkspaceStore.setState({ preprocessingRules: normalizedImportedPreprocessingRulesMap });
                }

                const updatedKAnonymityFieldsList: FieldDef[] = [];
                const updatedColumnRolesMap: Record<string, string> = {};
                const updatedColumnTypesMap: Record<string, string> = {};
                // ★ 2026-10-07：已上傳資料時，只匯入資料中存在的欄位；其餘略過並於匯入後提示。
                const allImportedColumnNamesList: string[] = Object.keys(importedAttributesMap);
                const importDatasetColumnNameSet = buildDatasetColumnNameSet(storeColumnsList);
                const importedColumnNamesList: string[] = allImportedColumnNamesList.filter((columnNameString) => isFieldNameInDataset(columnNameString, importDatasetColumnNameSet));
                const skippedImportedColumnNamesList: string[] = allImportedColumnNamesList.filter((columnNameString) => !isFieldNameInDataset(columnNameString, importDatasetColumnNameSet));
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

                    let calculatedGeneralizationStrategyValue = resolveDefaultGenStrategyForType(mappedFieldTypeValue);
                    let calculatedGeneralizationParamValue = DEFAULT_GENERALIZATION_PARAM;
                    let calculatedMaxGeneralizationLevelValue = importedQiGeneralizationLevelsMap[columnNameString] ?? DEFAULT_MAX_GENERALIZATION_LEVEL;
                    let calculatedGenDirectionValue: 'front' | 'back' = 'front';
                    // 層級範圍上限：類別型沿用設定檔數字，時間粒度於下方依 levels 換算，其他型態不支援範圍
                    let calculatedLevelRangeUpperValue: number | undefined = mappedFieldTypeValue === 'categorical' ? importedQiLevelRangeUpperMap[columnNameString] : undefined;

                    if (currentGeneralizationConfig) {
                        // ★ 匯入判斷：泛化策略名稱正規化，相容匯出格式 (keep_prefix／keep_suffix) 與舊版/淘汰策略名稱 (masking／binning／segment)
                        const rawGeneralizationStrategyValue = currentGeneralizationConfig.strategy || calculatedGeneralizationStrategyValue;
                        if (rawGeneralizationStrategyValue === 'keep_suffix') {
                            calculatedGeneralizationStrategyValue = 'prefix';
                            calculatedGenDirectionValue = 'back';
                        } else if (['keep_prefix', 'prefix', 'masking'].includes(rawGeneralizationStrategyValue)) {
                            calculatedGeneralizationStrategyValue = 'prefix';
                        } else if (['binning', 'segment'].includes(rawGeneralizationStrategyValue)) {
                            calculatedGeneralizationStrategyValue = 'rounding';
                        } else {
                            calculatedGeneralizationStrategyValue = rawGeneralizationStrategyValue;
                        }
                        calculatedGeneralizationParamValue = currentGeneralizationConfig.param ?? DEFAULT_GENERALIZATION_PARAM;
                        calculatedMaxGeneralizationLevelValue = currentGeneralizationConfig.max_level ?? importedQiGeneralizationLevelsMap[columnNameString] ?? DEFAULT_MAX_GENERALIZATION_LEVEL;
                    }

                    // ★ 匯入判斷：數值型或時間型間接識別碼若於 "generalization_hierarchies" 定義了自訂區間 (bins)，
                    //   一律採用該定義的自訂區間／自訂時段泛化策略，而非通用的預設值
                    let calculatedCustomBinsValue: CustomBin[] | undefined;
                    if (mappedFieldTypeValue === 'numeric') {
                        const importedNumericHierarchyConfig = importedGeneralizationHierarchiesMap[columnNameString];
                        if (Array.isArray(importedNumericHierarchyConfig?.bins) && importedNumericHierarchyConfig.bins.length > 0) {
                            calculatedGeneralizationStrategyValue = 'custom_bins';
                            calculatedCustomBinsValue = importedNumericHierarchyConfig.bins;
                            calculatedMaxGeneralizationLevelValue = 1;
                        } else if (typeof importedNumericHierarchyConfig?.rounding === 'number') {
                            // ★ 交付包格式為 { rounding: <捨入單位> }（例如年齡 rounding:5），先前只認得
                            //   bins，rounding 這個實際捨入單位從未被讀出來，匯入後一律退回預設值 10，
                            //   而非設定檔裡真正的 5／20000／1。
                            // ★ 使用者反映：匯入後「泛化層級」被誤設為 2（數值型 UI 只有「原始(0)／啟用(1)」
                            //   兩個選項，2 不對應任何選項，也因此被誤送進 qi_generalization_levels）。
                            //   原因是上面的 bins 分支有補上 calculatedMaxGeneralizationLevelValue = 1，
                            //   但這個 rounding 分支漏補，停留在匯入時的通用預設值 2。這裡補齊，與 bins 分支一致。
                            calculatedGeneralizationStrategyValue = 'rounding';
                            calculatedGeneralizationParamValue = importedNumericHierarchyConfig.rounding;
                            calculatedMaxGeneralizationLevelValue = 1;
                        }
                    } else if (mappedFieldTypeValue === 'temporal') {
                        // ★ 時間型泛化匯入：優先判斷 time_periods（時間區間，界線為 HH:MM 字串，換回
                        //   TimePicker 內部使用的當日分鐘數），其次才是 levels（時間粒度，實際選用層級
                        //   來自 qi_generalization_levels，levels 陣列本身只宣告「泛化到哪些粒度可選」）。
                        const importedTemporalHierarchyConfig = importedGeneralizationHierarchiesMap[columnNameString];
                        if (Array.isArray(importedTemporalHierarchyConfig?.time_periods) && importedTemporalHierarchyConfig.time_periods.length > 0) {
                            calculatedGeneralizationStrategyValue = 'time_range';
                            calculatedCustomBinsValue = importedTemporalHierarchyConfig.time_periods.map((segmentItemRecord) => ({
                                min: segmentItemRecord.min === null ? null : parseHHMMToMinutesOfDay(segmentItemRecord.min),
                                max: segmentItemRecord.max === null ? null : parseHHMMToMinutesOfDay(segmentItemRecord.max),
                                label: segmentItemRecord.label
                            }));
                            calculatedMaxGeneralizationLevelValue = 1;
                        } else if (Array.isArray(importedTemporalHierarchyConfig?.levels) && importedTemporalHierarchyConfig.levels.length > 0) {
                            calculatedGeneralizationStrategyValue = 'time_rounding';
                            // ★ 2026-10-01：層級要依「設定檔自己的 levels 清單」換算成時間單位，再對應回前端層級。
                            //   例如 config_kanon.json 的 levels=[day, month, year]、層級 3 是「年」；先前直接沿用數字 3，
                            //   在前端的單位清單裡變成「時」。
                            calculatedMaxGeneralizationLevelValue = resolveImportedTemporalLevel(importedTemporalHierarchyConfig.levels, importedQiGeneralizationLevelsMap[columnNameString]) ?? TEMPORAL_DEFAULT_GRANULARITY_LEVEL;
                            // 層級範圍上限同樣依設定檔的 levels 換算
                            const convertedTemporalRangeUpperValue = resolveImportedTemporalLevel(importedTemporalHierarchyConfig.levels, importedQiLevelRangeUpperMap[columnNameString]);
                            if (convertedTemporalRangeUpperValue !== null) calculatedLevelRangeUpperValue = convertedTemporalRangeUpperValue;
                        }
                    } else if (mappedFieldTypeValue === 'categorical') {
                        // ★ 修正 (第三版，依使用者提供之真實交付包 config_kanon.json 核對): 使用者回報匯入
                        //   「地區」「職業」皆為 qi_generalization_levels: 0 的設定檔後，畫面卻顯示「3」而非
                        //   設定檔原本的「0」。根因是本分支先前把「該欄位層級為 0」一律當成「舊版誤存的無效值」
                        //   處理、進而收斂成對照表實際深度——但依實際後端邏輯，類別型欄位 level 0 是完全合法的
                        //   數值（代表「保留原始值、不泛化」，後端不會報錯，只是不生效），交付包本身就可能真的
                        //   要設成 0（例如階層樹先建好備用，但這次執行先不套用）。原本的判斷式只看數值是否
                        //   小於 1，無法分辨「設定檔明確寫 0」與「設定檔根本沒有這個欄位」兩種情況，才會誤將
                        //   使用者明確指定的 0 覆寫掉。
                        //   ★ 修正: 改為只在「這個欄位根本不存在於 qi_generalization_levels」（即真正缺漏，
                        //   例如匯入一份完全沒有指定層級的舊版設定檔）時，才以對照表實際深度作為保底；只要
                        //   設定檔明確指定了層級（即使是 0），一律原樣採用，不再覆寫。
                        const importedHierarchyMaxLevelForThisColumn = hierarchyMaxLevelByFieldNameMap[columnNameString];
                        const isQiLevelExplicitlySpecifiedInImportedConfig = Object.prototype.hasOwnProperty.call(importedQiGeneralizationLevelsMap, columnNameString);
                        if (
                            !isQiLevelExplicitlySpecifiedInImportedConfig &&
                            typeof importedHierarchyMaxLevelForThisColumn === 'number' &&
                            importedHierarchyMaxLevelForThisColumn >= 1 &&
                            (!calculatedMaxGeneralizationLevelValue || calculatedMaxGeneralizationLevelValue < 1)
                        ) {
                            calculatedMaxGeneralizationLevelValue = importedHierarchyMaxLevelForThisColumn;
                        }
                    } else if (mappedFieldTypeValue === 'string' && calculatedGeneralizationStrategyValue === 'length') {
                        // ★ 使用者反映: 字串「依字串長度」策略只要調「參數設定」(bin_size) 就好，UI 已把
                        // 這個策略的層級固定為 1（不再顯示「最大層級」欄位，見下方 render 與
                        // STRING_LENGTH_STRATEGY_FIXED_LEVEL 常數）。匯入設定檔時，即使原始檔案的
                        // qi_generalization_levels 對這個欄位寫了別的數字，這裡也統一收斂為 1，
                        // 與 UI 顯示、預覽計算、Step4 實際送出後端的數字保持一致。
                        calculatedMaxGeneralizationLevelValue = STRING_LENGTH_STRATEGY_FIXED_LEVEL;
                    }

                    // ★ 數值型的「泛化層級」UI 只有「原始 (0)／啟用 (1)」兩個選項（見下方表格 render
                    // 邏輯），並非類別型／時間型那種多階層級數字。若匯入檔完全沒有 bins／rounding 定義，
                    // 前面的通用預設值 (DEFAULT_MAX_GENERALIZATION_LEVEL = 2) 對數值型欄位是無效值，
                    // 會讓畫面上的切換鈕呈現「兩個都沒選取」的錯亂狀態。這裡收斂到 0～1 範圍作為保底。
                    if (mappedFieldTypeValue === 'numeric') {
                        calculatedMaxGeneralizationLevelValue = Math.min(calculatedMaxGeneralizationLevelValue, 1);
                    }

                    updatedKAnonymityFieldsList.push({
                        id: `field_${Math.random().toString(36).substr(2, 9)}`,
                        name: columnNameString,
                        type: mappedFieldTypeValue,
                        role: mappedPrivacyRoleValue,
                        maskStrategy: calculatedMaskingStrategyValue,
                        maskKeepChars: currentMaskingConfig?.keep_chars ?? DEFAULT_MASK_KEEP_CHARS,
                        maskChar: currentMaskingConfig?.mask_char ?? '*',
                        hashType: currentMaskingConfig?.hash_type || 'SHA256',
                        genStrategy: calculatedGeneralizationStrategyValue,
                        genParam: calculatedGeneralizationParamValue,
                        genMaxLevel: calculatedMaxGeneralizationLevelValue,
                        genDirection: calculatedGenDirectionValue,
                        ...(calculatedCustomBinsValue ? { customBins: calculatedCustomBinsValue } : {}),
                        ...(calculatedLevelRangeUpperValue !== undefined && calculatedLevelRangeUpperValue > calculatedMaxGeneralizationLevelValue
                            ? { genLevelRangeUpper: calculatedLevelRangeUpperValue } : {})
                    });
                });

                // ★ updatedHierarchiesListArray（含 importedGeneralizationMatrices／
                //   importedCategoricalHierarchiesMap 的階層對照解析）已提前到欄位迴圈之前建立
                //   （供上方「最大層級」保底邏輯計算實際階層深度使用），此處直接沿用，不再重複建立。

                // ★ 修正 Race Condition：欄位快取鍵值必須與實際寫入 Store 的 columns 陣列完全一致，
                //   否則初始化用 useEffect (見下方 "2. 初始化 storeColumnsList") 會判斷快取不吻合，
                //   進而以預設值 (maskStrategy: 'none') 覆蓋掉此處剛匯入的 strategy 設定。
                const effectiveColumnNamesListForStore = (storeColumnsList && storeColumnsList.length > 0) ? storeColumnsList : importedColumnNamesList;

                useWorkspaceStore.setState({
                    columns: effectiveColumnNamesListForStore,
                    columnRoles: updatedColumnRolesMap,
                    columnTypes: updatedColumnTypesMap,
                    categoricalHierarchies: importedCategoricalHierarchiesMap,
                    numericBins: importedKAnonymityBlock?.generalization_hierarchies || parsedJsonContentData.generalization_hierarchies || parsedJsonContentData.numeric_bins || {}
                });

                globalCachedColumnsKeyString = JSON.stringify(effectiveColumnNamesListForStore);
                globalCachedKAnonymityFields = updatedKAnonymityFieldsList; 
                globalCachedKAnonymityHierarchies = updatedHierarchiesListArray;

                setKAnonymityFieldsList(updatedKAnonymityFieldsList);
                setKAnonymityHierarchiesList(updatedHierarchiesListArray);

                messageApi.success(translate('message.import_json_success', '成功匯入 JSON 設定並更新欄位對應！'));

                if (skippedImportedColumnNamesList.length > 0) {
                    messageApi.warning(translate('message.import_json_skipped_not_in_dataset', {
                        count: skippedImportedColumnNamesList.length,
                        names: skippedImportedColumnNamesList.join('、'),
                        defaultValue: `已略過 ${skippedImportedColumnNamesList.length} 個資料中沒有的欄位：${skippedImportedColumnNamesList.join('、')}`
                    }), 6);
                }

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

    /**
     * 函數名稱: isColumnActuallyNumericFromRealData
     * 函數功能: 「套用系統推薦設定」時，補上依「實際資料內容」判斷資料型態的能力。原本的
     *           判斷完全只看「欄位名稱」是否命中已知關鍵字或參考設定檔 (KANON_COLUMNS_REFERENCE)，
     *           像 bmi 這種沒被任何關鍵字涵蓋到的欄位名稱，即使實際內容全部是數字，也只會維持
     *           欄位原本（通常是預設值「字串」）的型態，導致使用者反映「bmi 應該是數值，系統仍
     *           選字串」。這裡改為檢查 Step1 上傳時已經取樣好的預覽資料 (datasetPreviewRowsList)，
     *           只要這個欄位「所有」非空值都能解析成有效數字，就視為數值型欄位；只要出現任何一筆
     *           解析不出來的值，或整欄取樣皆為空，則不判定為數值型（交由既有關鍵字判斷或維持原值）。
     *
     * 輸入參數 (Input):
     *   - columnNameString (string): 欲判斷的欄位名稱
     * 輸出參數 (Output): 無
     * 返回值 (Return): boolean，true 代表依實際取樣資料判斷為數值型欄位
     * 呼叫關係 (Call Relations): 被 handleApplyRecommendations 呼叫，僅用於關鍵字/參考設定檔皆
     *   未明確判斷出資料型態的欄位，不覆蓋既有關鍵字分支已經深思熟慮過的分類 (例如郵遞區號雖為
     *   數字組成，仍刻意歸類為字串型)。
     *
     * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
     */
    const isColumnActuallyNumericFromRealData = (columnNameString: string): boolean => {
        if (!datasetPreviewRowsList || datasetPreviewRowsList.length === 0) return false;

        let validNonEmptyValueFoundCount = 0;

        for (const previewRowRecordItem of datasetPreviewRowsList) {
            const rawCellValueData = (previewRowRecordItem as Record<string, unknown>)[columnNameString];
            if (rawCellValueData === undefined || rawCellValueData === null) continue;

            const trimmedCellValueStr = String(rawCellValueData).trim();
            if (trimmedCellValueStr === '') continue;

            if (!Number.isFinite(Number(trimmedCellValueStr))) return false;
            validNonEmptyValueFoundCount++;
        }

        return validNonEmptyValueFoundCount > 0;
    };

    const handleApplyRecommendations = (): void => {
        // ★ 修正: 欄位設定清單為空（例如使用者已刪除所有欄位）時沒有任何可套用推薦設定的對象，
        //   若仍照原本邏輯繼續往下跑，map() 對空陣列自然毫無變化，但最終仍會顯示籠統的「已套用」
        //   訊息，讓使用者誤以為套用了什麼設定；因此提前判斷並改為提示使用者先新增欄位。
        if (kAnonymityFieldsList.length === 0) {
            messageApi.warning('目前沒有任何欄位可套用推薦設定，請先新增欄位。');
            return;
        }

        const recommendedUpdatedFieldsList = kAnonymityFieldsList.map((fieldItemRecord) => {
            const lowerCaseFieldNameString = fieldItemRecord.name.toLowerCase();
            let recommendedPrivacyRoleValue: string; 
            let recommendedMaskingStrategyValue: string; 
            let recommendedFieldTypeValue = fieldItemRecord.type;
            let recommendedGeneralizationStrategyValue = fieldItemRecord.genStrategy;
            // ★ 新增: 標記下方各分支「是否已明確依欄位名稱判斷出資料型態」——參考設定檔精確比對、
            //   年齡／生日、日期、郵遞區號／性別等城市類欄位這幾支都是刻意想清楚才下的分類判斷
            //   （例如郵遞區號雖是數字組成，仍刻意歸為字串型），不應被下方「讀實際資料」的判斷覆蓋；
            //   但識別碼關鍵字、疾病／薪資等敏感欄位關鍵字、以及完全沒命中任何關鍵字這三支，從來沒有
            //   真的判斷過資料型態，只是維持欄位原本（通常是預設值「字串」）的型態，才是「bmi 這類
            //   數值欄位仍被誤判為字串」的實際成因，這三支才需要交給下方的實際資料判斷補上。
            let hasExplicitlyClassifiedTypeStatus = false;

            // ★ 新增: 欄位名稱若與「套用系統推薦設定」參考設定檔 (config_kanon.json) 之欄位名稱完全相符，
            //   優先套用該參考設定所指定之隱私角色／資料型態／處理策略（使用者已確認採「精確欄位名稱優先，
            //   其餘用關鍵字判斷」之套用方式，且薪資／婚姻狀況／生日等欄位之分類一律依此參考設定為準，
            //   即使與下方關鍵字判斷結果不同亦然），不再套用下方關鍵字判斷。
            const matchedKanonReferenceItem = KANON_COLUMNS_REFERENCE[fieldItemRecord.name.trim()];

            if (matchedKanonReferenceItem) {
                const rawReferenceRoleStr = String(matchedKanonReferenceItem.role || '').toLowerCase();
                if (rawReferenceRoleStr === 'identifier') recommendedPrivacyRoleValue = 'Identifier';
                else if (rawReferenceRoleStr === 'quasi_identifier' || rawReferenceRoleStr === 'qi') recommendedPrivacyRoleValue = 'Quasi-identifier';
                else if (rawReferenceRoleStr === 'sensitive') recommendedPrivacyRoleValue = 'Sensitive';
                else recommendedPrivacyRoleValue = 'Non-sensitive';

                // ★ 修正: 原本參考設定檔標示為 'categorical'／'類別' 之欄位 (如地區、職業、婚姻狀況)
                //   會歸類為「類別型」，套用系統推薦設定時需搭配自訂階層樹 (tree) 策略；使用者確認
                //   「套用系統推薦設定」不應再自動推薦類別型 (需額外匯入階層樹才能生效)，一律改歸類
                //   為「字串型」，套用永遠可直接生效的「保留前後綴」(prefix) 策略。使用者仍可於畫面上
                //   手動改回類別型並自行匯入階層樹。
                const rawReferenceTypeStr = String(matchedKanonReferenceItem.type || '').toLowerCase();
                if (['numeric', '數值'].includes(rawReferenceTypeStr)) recommendedFieldTypeValue = 'numeric';
                else if (['temporal', '時間'].includes(rawReferenceTypeStr)) recommendedFieldTypeValue = 'temporal';
                else recommendedFieldTypeValue = 'string';

                recommendedMaskingStrategyValue = normalizeMaskStrategyValue(matchedKanonReferenceItem.strategy, recommendedPrivacyRoleValue).strategy;

                recommendedGeneralizationStrategyValue = resolveDefaultGenStrategyForType(recommendedFieldTypeValue);
                hasExplicitlyClassifiedTypeStatus = true;
            } else if (/(id|name|card|nric|phone|email|姓名|電話|手機|信箱|電子郵件|身分證|統一編號|地址)/.test(lowerCaseFieldNameString)) {
                recommendedPrivacyRoleValue = 'Identifier';
                recommendedMaskingStrategyValue = 'remove';
            } else if (/(age|birthday|birth_date|dob|年齡|生日|出生日期)/.test(lowerCaseFieldNameString)) {
                // ★ 修正: 年齡等數值型間接識別欄位，原本只判斷隱私角色、不會一併判斷資料型態，導致
                //   欄位一直維持預設的「字串」型態，套用不合適的字串前後綴遮蔽而非數值泛化（四捨五入）。
                //   使用者更正：生日應歸類為數值型（與年齡同一分類），而非直接識別／字串。
                recommendedPrivacyRoleValue = 'Quasi-identifier'; 
                recommendedMaskingStrategyValue = 'none';
                recommendedFieldTypeValue = 'numeric';
                recommendedGeneralizationStrategyValue = resolveDefaultGenStrategyForType('numeric');
                hasExplicitlyClassifiedTypeStatus = true;
            } else if (/(date|日期)/.test(lowerCaseFieldNameString)) {
                // ★ 修正: 日期等時間型間接識別欄位，同樣需一併判斷為「時間」資料型態（生日已改分類至上方直接識別）。
                recommendedPrivacyRoleValue = 'Quasi-identifier';
                recommendedMaskingStrategyValue = 'none';
                recommendedFieldTypeValue = 'temporal';
                recommendedGeneralizationStrategyValue = resolveDefaultGenStrategyForType('temporal');
                hasExplicitlyClassifiedTypeStatus = true;
            } else if (/(zip|gender|station|city|region|job|occupation|marital|marriage|郵遞區號|性別|地區|城市|縣市|國家|職業|婚姻狀況|婚姻)/.test(lowerCaseFieldNameString)) {
                // ★ 修正: 城市／性別等欄位原本歸類為「類別型」，套用系統推薦設定時需搭配自訂階層樹
                //   (tree) 策略才能生效；使用者確認「套用系統推薦設定」不應再自動推薦類別型，一律
                //   改歸類為「字串型」，套用永遠可直接生效的「保留前後綴」(prefix) 策略。使用者仍
                //   可於畫面上手動改回類別型並自行匯入階層樹。
                recommendedPrivacyRoleValue = 'Quasi-identifier';
                recommendedMaskingStrategyValue = 'none';
                recommendedFieldTypeValue = 'string';
                recommendedGeneralizationStrategyValue = resolveDefaultGenStrategyForType('string');
                hasExplicitlyClassifiedTypeStatus = true;
            } else if (/(disease|salary|income|fare|credit|amount|ratio|score|疾病|薪資|收入|所得|信用|金額|比率|分數)/.test(lowerCaseFieldNameString)) {
                recommendedPrivacyRoleValue = 'Sensitive'; 
                recommendedMaskingStrategyValue = 'none'; 
            } else {
                recommendedPrivacyRoleValue = 'Non-sensitive';
                recommendedMaskingStrategyValue = 'none';
            }

            // ★ 新增: 使用者反映「bmi」等欄位明明是數值，套用系統推薦設定後卻仍被歸類為字串——
            //   原因是上面的判斷完全依賴「欄位名稱」比對，bmi 這類名稱沒有被任何關鍵字或參考設定檔
            //   涵蓋到，就會落到「識別碼關鍵字」「疾病/薪資等敏感欄位關鍵字」或「什麼都沒中」這三支
            //   當中的其中一支，而這三支從來沒有真的判斷過資料型態，只是維持欄位原本（通常是預設值
            //   「字串」）的型態。這裡在關鍵字都判斷不出資料型態時 (hasExplicitlyClassifiedTypeStatus
            //   為 false)，額外檢查 Step1 上傳時取樣的實際資料：只要這個欄位所有非空值都能解析成
            //   有效數字，就直接判定為「數值型」。刻意只補這三支、不去動已經明確判斷過型態的分支
            //   （參考設定檔／年齡生日／日期／郵遞區號城市等），避免覆蓋掉那些刻意的分類決定
            //   （例如郵遞區號雖是數字組成，仍應維持字串型）。
            if (!hasExplicitlyClassifiedTypeStatus && isColumnActuallyNumericFromRealData(fieldItemRecord.name)) {
                recommendedFieldTypeValue = 'numeric';
            }

            // ★ 新增: 使用者明確指定「套用系統推薦設定」時，隱私角色為間接識別碼的欄位，
            // 依資料型態應固定套用之預設處理策略：字串→字串前後綴 (prefix)、數值→最小單位設定
            // (rounding)、時間→時間粒度 (time_rounding)。上方各分支（參考設定精確比對／關鍵字
            // 判斷）雖已各自呼叫 resolveDefaultGenStrategyForType 算出相同結果，但這裡統一在
            // return 前再次強制套用一次，確保不論欄位是經由哪個分支判斷、或欄位維持原本已是
            // 間接識別碼但未落入任何分支（因而 recommendedGeneralizationStrategyValue 仍是
            // fieldItemRecord 原始策略）等情況，都能保證這三種型態的策略如實一致，不會遺漏。
            // ★ 新增：數值型間接識別碼固定套用 rounding 策略時，一併依實際資料範圍
            // (datasetColumnNumericValuesMap 快取) 自動計算一個合理的捨入單位 (genParam)，取代先前
            // 完全不會自動帶入、只能靠使用者自行猜測填寫的作法；查無實際數值資料 (例如尚未上傳檔案)
            // 時保持 undefined，維持該欄位原有的 genParam 不變，不強制覆蓋。
            let recommendedGenParamValue: number | undefined;

            if (recommendedPrivacyRoleValue === 'Quasi-identifier') {
                if (recommendedFieldTypeValue === 'string') {
                    recommendedGeneralizationStrategyValue = 'prefix';
                } else if (recommendedFieldTypeValue === 'numeric') {
                    recommendedGeneralizationStrategyValue = 'rounding';

                    const columnRealNumericValuesArray = datasetColumnNumericValuesMap[fieldItemRecord.name];
                    if (columnRealNumericValuesArray && columnRealNumericValuesArray.length > 0) {
                        recommendedGenParamValue = calculateNiceRoundingUnit(
                            Math.min(...columnRealNumericValuesArray),
                            Math.max(...columnRealNumericValuesArray),
                            ROUNDING_UNIT_RECOMMENDATION_TARGET_BUCKET_COUNT
                        );
                    }
                } else if (recommendedFieldTypeValue === 'temporal') {
                    recommendedGeneralizationStrategyValue = 'time_rounding';
                }
            }

            // ★ 2026-10-08 使用者要求：推薦設定一律把層級重設為系統預設值，不再沿用欄位原本的層級。
            //   先前會保留欄位原有層級（例如匯入設定檔帶入的職業 [1, 3]），導致「先匯入再套用推薦」與
            //   「直接套用推薦」結果不同（職業層級 1 vs 2）。預設值與畫面上手動切換角色／策略時相同：
            //   字串前後綴 4（保留 1 字）、依字串長度 1、時間粒度「月」、數值與區間類 1、階層樹 1；
            //   非間接識別碼欄位層級不會送出，統一回到通用預設 2。方向回到「前方」，匯入帶入的層級範圍上限一併清除。
            const resolveRecommendedDefaultGenMaxLevel = (): number => {
                if (recommendedPrivacyRoleValue !== 'Quasi-identifier') return DEFAULT_MAX_GENERALIZATION_LEVEL;
                switch (recommendedGeneralizationStrategyValue) {
                    case 'prefix': return STRING_PREFIX_STRATEGY_DEFAULT_LEVEL;
                    case 'length': return STRING_LENGTH_STRATEGY_FIXED_LEVEL;
                    case 'time_rounding': return TEMPORAL_DEFAULT_GRANULARITY_LEVEL;
                    case 'rounding': case 'custom_bins': case 'time_range': case 'tree': return 1;
                    default: return DEFAULT_MAX_GENERALIZATION_LEVEL;
                }
            };
            const { genLevelRangeUpper: _discardedImportedLevelRangeUpper, ...fieldWithoutLevelRangeUpper } = fieldItemRecord;
            void _discardedImportedLevelRangeUpper;

            return {
                ...fieldWithoutLevelRangeUpper,
                role: recommendedPrivacyRoleValue,
                maskStrategy: recommendedMaskingStrategyValue,
                type: recommendedFieldTypeValue,
                genStrategy: recommendedGeneralizationStrategyValue,
                genMaxLevel: resolveRecommendedDefaultGenMaxLevel(),
                genDirection: 'front' as const,
                ...(recommendedGenParamValue !== undefined ? { genParam: recommendedGenParamValue } : {})
            };
        });

        setKAnonymityFieldsList(recommendedUpdatedFieldsList);
        // ★ 2026-10-08 使用者反映：先匯入設定檔（帶入 K、l／t、抑制設定）再套用推薦設定，Step3 仍停在匯入的值、
        //   「進階：敏感資料保護」也還開著。推薦設定應整組回到系統預設：Step3 一併還原為「標準（K=3）」、l／t 關閉、抑制預設值。
        useWorkspaceStore.setState({ ...DEFAULT_KANON_RULE_PARAMS, cellFillValuesByColumn: {} });
        messageApi.success(translate('message.apply_recommend_success_with_step3', '已為所有欄位套用推薦設定；Step3 保護強度也已還原為「標準（預設）」。'));
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
                        updatedFieldObjectItem.genStrategy = resolveDefaultGenStrategyForType(updatedFieldObjectItem.type);
                        if (updatedFieldObjectItem.type === 'string') {
                            updatedFieldObjectItem.genDirection = 'front';
                            // ★ 見上方 STRING_PREFIX_STRATEGY_DEFAULT_LEVEL 註解：通用預設層級（2）
                            // 換算出的保留字數（3）對中文短詞（職業、地區等常見 2~4 字）幾乎必然
                            // 觸發後端「整格全遮蔽」，方向選擇形同虛設，改用較高的預設層級。
                            if (updatedFieldObjectItem.genStrategy === 'prefix') {
                                updatedFieldObjectItem.genMaxLevel = STRING_PREFIX_STRATEGY_DEFAULT_LEVEL;
                            }
                        }
                        if (updatedFieldObjectItem.type === 'temporal' && updatedFieldObjectItem.genStrategy === 'time_rounding') {
                            updatedFieldObjectItem.genMaxLevel = TEMPORAL_DEFAULT_GRANULARITY_LEVEL;
                        }
                    } else {
                        // ★ 規範對照: identifier 之合法策略僅有 remove (見 VALID_MASK_STRATEGIES_BY_ROLE)，
                        //   切換角色時一律套用該角色預設策略，避免 identifier 卡在 UI 未提供之 'none' 選項
                        updatedFieldObjectItem.maskStrategy = DEFAULT_MASK_STRATEGY_BY_ROLE[updatedFieldObjectItem.role] || 'none';
                    }
                }

                if (updatedFieldObjectItem.type === 'numeric' && updatedFieldObjectItem.genStrategy === 'rounding') {
                    if (updatedFieldObjectItem.genMaxLevel > 1) updatedFieldObjectItem.genMaxLevel = 1;
                }

                // ★ 首次切換為「自訂區間」(數值) 或「時間區間」(時間) 策略時，若尚無區間定義，初始化一列空白區間供使用者於「泛化階層對照」分頁編輯
                if (targetAttributeKeyName === 'genStrategy' && (normalizedAttributeValueData === 'custom_bins' || normalizedAttributeValueData === 'time_range')) {
                    if (!updatedFieldObjectItem.customBins || updatedFieldObjectItem.customBins.length === 0) {
                        updatedFieldObjectItem.customBins = [{ min: null, max: null, label: '' }];
                    }
                    updatedFieldObjectItem.genMaxLevel = 1;
                }

                // ★ 使用者反映: 字串「依字串長度」策略只要調「參數設定」(bin_size) 就好，不需要
                // 額外再調「最大層級」；切換到這個策略時，統一把層級固定為 1（見上方
                // STRING_LENGTH_STRATEGY_FIXED_LEVEL 常數與「最大層級」欄位 render，該策略已不再
                // 顯示、不可調整此欄位），避免殘留切換前的層級數字造成預覽與實際輸出不一致。
                if (targetAttributeKeyName === 'genStrategy' && normalizedAttributeValueData === 'length') {
                    updatedFieldObjectItem.genMaxLevel = STRING_LENGTH_STRATEGY_FIXED_LEVEL;
                }

                // ★ 使用者反映「字串前後綴」策略套用在中文短詞上整個被遮蔽：由「依字串長度」
                // 或其他策略手動切回「字串前後綴」時，同樣給一個較不容易全遮蔽的預設層級
                // （見上方 STRING_PREFIX_STRATEGY_DEFAULT_LEVEL 常數註解）。
                if (targetAttributeKeyName === 'genStrategy' && normalizedAttributeValueData === 'prefix') {
                    updatedFieldObjectItem.genMaxLevel = STRING_PREFIX_STRATEGY_DEFAULT_LEVEL;
                }

                if (targetAttributeKeyName === 'name' && previousFieldNameString !== normalizedAttributeValueData && previousFieldNameString.trim() !== '') {
                    const newFieldNameInputString = String(normalizedAttributeValueData);
                    setKAnonymityHierarchiesList(previousHierarchiesListArray => previousHierarchiesListArray.map(hierarchyItemRecord => hierarchyItemRecord.fieldName === previousFieldNameString ? { ...hierarchyItemRecord, fieldName: newFieldNameInputString } : hierarchyItemRecord));
                }

                return updatedFieldObjectItem;
            })
        );
    };

    // ★ 2026-10-07：欄位清單與上傳資料之一致性 (見 utils/datasetFieldConsistency.ts)
    const datasetColumnNameSet = useMemo(() => buildDatasetColumnNameSet(storeColumnsList), [storeColumnsList]);
    const fieldsNotInDatasetNamesList = useMemo(
        () => findFieldsNotInDataset(kAnonymityFieldsList.map((fieldItemRecord) => fieldItemRecord.name), storeColumnsList),
        [kAnonymityFieldsList, storeColumnsList]
    );
    const datasetColumnsNotConfiguredList = useMemo(
        () => findDatasetColumnsNotConfigured(kAnonymityFieldsList.map((fieldItemRecord) => fieldItemRecord.name), storeColumnsList),
        [kAnonymityFieldsList, storeColumnsList]
    );

    // ★ 2026-10-07：「新增定義欄位」只能加回資料中尚未設定的欄位 (預設帶入第一個缺漏欄位，可再用下拉切換)；
    //   全部欄位都已設定時按鈕停用。尚未上傳資料 (理論上不會進到 Step2) 時維持原本新增空白列的行為。
    const addField = (): void => {
        if (storeColumnsList.length > 0) {
            const nextColumnNameString = datasetColumnsNotConfiguredList[0];
            if (!nextColumnNameString) return;
            setKAnonymityFieldsList([...kAnonymityFieldsList, buildInitialKAnonymityFieldForColumn(nextColumnNameString, storeColumnTypesMap, storeColumnRolesMap)]);
            return;
        }
    setKAnonymityFieldsList([...kAnonymityFieldsList, { id: `field_${Date.now()}`, name: '', type: 'string', role: 'Quasi-identifier', maskStrategy: 'none', maskKeepChars: DEFAULT_MASK_KEEP_CHARS, maskChar: '*', hashType: 'SHA256', genStrategy: 'prefix', genParam: DEFAULT_GENERALIZATION_PARAM, genMaxLevel: STRING_PREFIX_STRATEGY_DEFAULT_LEVEL, genDirection: 'front' }]);
    };

    // 一鍵移除資料中不存在的欄位 (連同其階層對照表)
    const removeFieldsNotInDataset = (): void => {
        const removedFieldNameSet = new Set(fieldsNotInDatasetNamesList);
        setKAnonymityFieldsList(kAnonymityFieldsList.filter((fieldItemRecord) => isFieldNameInDataset(fieldItemRecord.name, datasetColumnNameSet) || normalizeDatasetColumnName(fieldItemRecord.name) === ''));
        setKAnonymityHierarchiesList((previousHierarchiesListArray) => previousHierarchiesListArray.filter((hierarchyItemRecord) => !removedFieldNameSet.has(normalizeDatasetColumnName(hierarchyItemRecord.fieldName))));
        messageApi.success(translate('step2.removed_fields_not_in_dataset', { count: removedFieldNameSet.size, defaultValue: `已移除 ${removedFieldNameSet.size} 個資料中不存在的欄位` }));
    };

    // 一鍵補上資料中有、但設定清單尚未涵蓋的欄位 (以預設設定加入)
    const addDatasetColumnsNotConfigured = (): void => {
        if (datasetColumnsNotConfiguredList.length === 0) return;
        setKAnonymityFieldsList([
            ...kAnonymityFieldsList,
            ...datasetColumnsNotConfiguredList.map((columnNameString) => buildInitialKAnonymityFieldForColumn(columnNameString, storeColumnTypesMap, storeColumnRolesMap))
        ]);
    };


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

    // 讀取（或給定預設值）單一欄位目前的「系統推薦設定」UI 狀態 (符合規範 g)
    const getBinAutoFillSettingsForField = (targetFieldIdStr: string): { mode: 'even' | 'unit'; binCount: number; unitWidth: number } =>
        binAutoFillSettingsMap[targetFieldIdStr] || { mode: 'even', binCount: DEFAULT_AUTO_BIN_COUNT, unitWidth: DEFAULT_AUTO_BIN_UNIT_WIDTH };

    const updateBinAutoFillSettingForField = (targetFieldIdStr: string, updatedPartialSettings: Partial<{ mode: 'even' | 'unit'; binCount: number; unitWidth: number }>): void => {
        setBinAutoFillSettingsMap(previousSettingsMap => ({
            ...previousSettingsMap,
            [targetFieldIdStr]: { ...getBinAutoFillSettingsForField(targetFieldIdStr), ...updatedPartialSettings }
        }));
    };

    /**
     * 函數名稱: handleGenerateRecommendedBins
     * 函數功能: 「系統推薦設定」按鈕之執行邏輯——依該欄位目前選擇之模式 (平均分配／最小單位)，
     *          使用 datasetColumnNumericValuesMap 快取之實際數值計算最小/最大值，呼叫對應之
     *          純運算函數產生區間陣列，並整批取代該欄位原有之 customBins。
     *
     * 輸入參數 (Input): targetFieldIdStr (欄位 id), targetFieldNameStr (欄位名稱，用於查找實際數值快取)
     * 輸出參數 (Output): 無
     * 返回值 (Return): void
     * 呼叫關係 (Call Relations): 綁定於「系統推薦設定」區塊之「自動產生區間」按鈕 Popconfirm 確認事件
     */
    const handleGenerateRecommendedBins = (targetFieldIdStr: string, targetFieldNameStr: string): void => {
        const columnRealNumericValuesArray = datasetColumnNumericValuesMap[targetFieldNameStr];

        if (!columnRealNumericValuesArray || columnRealNumericValuesArray.length === 0) {
            messageApi.warning(
                translate('step2.bin_autofill_no_data', '找不到此欄位的實際數值資料，請確認資料檔案已上傳且此欄位含有效數值。')
            );
            return;
        }

        // 逐一比較求最小／最大值（見 utils/binGeneration.ts findNumericMinMax）
        const { min: realMinValue, max: realMaxValue } = findNumericMinMax(columnRealNumericValuesArray) ?? { min: 0, max: 0 };

        if (realMaxValue <= realMinValue) {
            messageApi.warning(
                translate('step2.bin_autofill_no_range', '此欄位實際數值皆相同，無法自動產生區間，請手動新增。')
            );
            return;
        }

        const currentFieldAutoFillSettings = getBinAutoFillSettingsForField(targetFieldIdStr);

        // 「最小單位」自 0 起算後，若級距過細會在碰到實際資料前就用完區間數上限，先行提醒。
        if (currentFieldAutoFillSettings.mode !== 'even' && currentFieldAutoFillSettings.unitWidth > 0) {
            const unitModeStartValue = computeUnitModeStartValue(realMinValue, currentFieldAutoFillSettings.unitWidth);
            const requiredBinCountValue = Math.ceil((realMaxValue - unitModeStartValue) / currentFieldAutoFillSettings.unitWidth);
            if (requiredBinCountValue > MAX_AUTO_GENERATED_BIN_COUNT) {
                messageApi.warning(
                    translate('step2.bin_autofill_unit_too_small', '最小單位寬度 {{width}} 過小：自 {{start}} 起算至最大值 {{max}} 需要 {{count}} 個區間，超過上限 {{limit}}，請調大寬度。', {
                        width: currentFieldAutoFillSettings.unitWidth, start: unitModeStartValue, max: realMaxValue, count: requiredBinCountValue, limit: MAX_AUTO_GENERATED_BIN_COUNT
                    })
                );
                return;
            }
        }

        // 「平均分配」產生後第一格下限延伸至 0（說明見 utils/binGeneration.ts extendFirstBinLowerBoundToZero）；
        // 「最小單位」本來就自 0 起算，延伸對它不會有作用。
        const generatedBinsResultArray = extendFirstBinLowerBoundToZero(
            currentFieldAutoFillSettings.mode === 'even'
                ? generateEvenlyDistributedBins(realMinValue, realMaxValue, currentFieldAutoFillSettings.binCount)
                : generateUnitWidthBins(realMinValue, realMaxValue, currentFieldAutoFillSettings.unitWidth),
            realMinValue
        );

        if (generatedBinsResultArray.length === 0) {
            messageApi.warning(
                translate('step2.bin_autofill_failed', '無法自動產生區間，請檢查上方設定的數值是否正確。')
            );
            return;
        }

        setKAnonymityFieldsList(kAnonymityFieldsList.map(
            (fieldItemRecord) => fieldItemRecord.id === targetFieldIdStr
                ? { ...fieldItemRecord, customBins: generatedBinsResultArray }
                : fieldItemRecord
        ));

        messageApi.success(
            translate('step2.bin_autofill_success', '已依實際資料範圍（{{min}} ~ {{max}}）自動產生 {{count}} 個區間，可再手動微調。', {
                min: realMinValue, max: realMaxValue, count: generatedBinsResultArray.length
            })
        );
    };

    // ★ 新增：供「欄位名稱」欄位即時標示紅框用——統計目前清單中，每個（去除頭尾空白後之）
    //   名稱各出現幾次，出現 2 次以上者即為重複，需在使用者輸入當下就給予視覺提示，
    //   不必等到點擊「下一步」才看到錯誤訊息。
    const duplicateFieldNameCountMap = kAnonymityFieldsList.reduce<Record<string, number>>((countMapAccumulator, fieldItemRecord) => {
        const trimmedNameTextValue = (fieldItemRecord.name || '').trim();
        if (trimmedNameTextValue !== '') {
            countMapAccumulator[trimmedNameTextValue] = (countMapAccumulator[trimmedNameTextValue] || 0) + 1;
        }
        return countMapAccumulator;
    }, {});

    const kAnonymityFieldTableColumnsConfig = [
        {
            title: translate('step2.col_name'),
            dataIndex: 'name', width: '9.5em',
            render: (fieldNameTextValue: string, rowRecordItem: FieldDef) => {
                const isDuplicatedFieldNameStatus = (duplicateFieldNameCountMap[fieldNameTextValue.trim()] || 0) >= 2;
                return (
                    <Tooltip title={isDuplicatedFieldNameStatus ? translate('step2.duplicate_field_name_tooltip', '名稱重複：系統依名稱比對設定，重複的名稱會導致角色／型態等設定被誤判，請修改其中一個名稱或刪除多餘的列。') : !isFieldNameInDataset(fieldNameTextValue, datasetColumnNameSet) ? translate('step2.field_not_in_dataset_tooltip', '上傳的資料中沒有這個欄位，執行時不會被處理。請刪除此列或改選資料中的欄位。') : fieldNameTextValue} placement="topLeft" mouseEnterDelay={0.3}>
                        {storeColumnsList.length > 0 ? (
                            // ★ 2026-10-07：欄位名稱改為只能從上傳資料的欄位中選擇 (排除其他列已設定者)，
                            //   不能再自由輸入資料中不存在的名稱。資料中不存在的舊名稱 (例如匯入的設定) 仍顯示並標紅。
                            <Select
                                value={fieldNameTextValue || undefined}
                                onChange={(selectedColumnNameStr: string) => handleFieldChange(rowRecordItem.id, 'name', selectedColumnNameStr)}
                                placeholder={translate('step2.select_field_name_placeholder', '選擇欄位')}
                                status={isDuplicatedFieldNameStatus || !isFieldNameInDataset(fieldNameTextValue, datasetColumnNameSet) ? 'error' : undefined}
                                style={{ width: '100%' }}
                                popupMatchSelectWidth={false}
                                options={[
                                    ...(fieldNameTextValue && !isFieldNameInDataset(fieldNameTextValue, datasetColumnNameSet)
                                        ? [{ value: fieldNameTextValue, label: `${fieldNameTextValue}${translate('step2.field_not_in_dataset_suffix', '（資料中無此欄位）')}`, disabled: true }]
                                        : []),
                                    ...storeColumnsList
                                        .filter((columnNameString) => normalizeDatasetColumnName(columnNameString) === normalizeDatasetColumnName(fieldNameTextValue) || !kAnonymityFieldsList.some((otherFieldItemRecord) => otherFieldItemRecord.id !== rowRecordItem.id && normalizeDatasetColumnName(otherFieldItemRecord.name) === normalizeDatasetColumnName(columnNameString)))
                                        .map((columnNameString) => ({ value: columnNameString, label: columnNameString }))
                                ]}
                            />
                        ) : (
                            <Input
                                value={fieldNameTextValue}
                                maxLength={FIELD_NAME_MAX_LENGTH}
                                onChange={(inputChangeEvent) => handleFieldChange(rowRecordItem.id, 'name', inputChangeEvent.target.value.slice(0, FIELD_NAME_MAX_LENGTH))}
                                placeholder="e.g. age"
                                status={isDuplicatedFieldNameStatus ? 'error' : undefined}
                                style={{ width: '100%', textOverflow: 'ellipsis' }}
                            />
                        )}
                    </Tooltip>
                );
            },
        },
        {
            title: translate('step2.data_type'),
            dataIndex: 'type', width: '9.5em',
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
            dataIndex: 'role', width: '13.5em',
            render: (privacyRoleTextValue: string, rowRecordItem: FieldDef) => (
                <Select value={privacyRoleTextValue} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'role', dropdownSelectedValue)} style={{ width: '100%' }}>
                    <Select.Option value="Identifier"><span>{translate('step2.opt_identifier')}<Tooltip title={translate('step2.opt_identifier_tooltip', '本身就能直接指出特定個人，例如姓名、身分證字號，會從輸出資料中整欄刪除。')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help', fontSize: scaleFontSize(12) }} /></Tooltip></span></Select.Option>
                    <Select.Option value="Quasi-identifier"><span>{translate('step2.opt_quasi')}<Tooltip title={translate('step2.opt_quasi_tooltip', '單獨看不會洩漏身分，但與其他欄位組合後可能被用來重新識別出個人，例如年齡、地區，需要泛化或模糊化。')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help', fontSize: scaleFontSize(12) }} /></Tooltip></span></Select.Option>
                    <Select.Option value="Sensitive"><span>{translate('step2.opt_sensitive')}<Tooltip title={translate('step2.opt_sensitive_tooltip', '最需要保護的內容（例如疾病），本身不做處理、完整保留，作為風險評估的保護對象。')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help', fontSize: scaleFontSize(12) }} /></Tooltip></span></Select.Option>
                    <Select.Option value="Non-sensitive"><span>{translate('step2.opt_non_sensitive')}<Tooltip title={translate('step2.opt_non_sensitive_tooltip', '不屬於敏感資料、重新識別風險較低的一般欄位，通常可以保留不做特別處理。')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help', fontSize: scaleFontSize(12) }} /></Tooltip></span></Select.Option>
                </Select>
            ),
        },
        {
            title: (
                <span>
                    {translate('step2.process_strategy')}
                    <Tooltip title={translate('step2.process_strategy_tooltip', '決定這個欄位要保留原樣、遮蔽，還是用哪種方式模糊化。')}>
                        <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} />
                    </Tooltip>
                </span>
            ),
            dataIndex: 'strategy', width: '14em',
            render: (_: unknown, rowRecordItem: FieldDef) => {
                // 主新增: 下方各策略下拉選項旁邊都加一個小小的「？」說明圖示，讓使用者不需要點選就能大致知道每個選項的當下效果。
                const strategyOptionLabel = (labelNode: React.ReactNode, tooltipText: string) => (
                    <span>
                        {labelNode}
                        <Tooltip title={tooltipText}>
                            <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help', fontSize: scaleFontSize(12) }} />
                        </Tooltip>
                    </span>
                );

                if (rowRecordItem.role !== 'Quasi-identifier') {
                    // ★ 規範對照: 依 Open-PETs API 驗證標準，identifier 僅提供 remove 供使用者選擇 (hash 已自 UI 移除)，
                    //   其餘角色維持 none／remove，避免產生匯出後會被後端忽略之無效組合設定
                    const maskStrategyOptionList = rowRecordItem.role === 'Identifier'
                        ? [{ value: 'remove', label: strategyOptionLabel(translate('step2.opt_drop'), translate('step2.opt_drop_tooltip', '把這個欄位完全刪除，不會出現在輸出資料中。')) }]
                        : [
                            { value: 'none', label: strategyOptionLabel(translate('step2.opt_keep_original'), translate('step2.opt_keep_original_tooltip', '不做任何處理，維持原始內容。')) },
                            { value: 'remove', label: strategyOptionLabel(translate('step2.opt_drop'), translate('step2.opt_drop_tooltip', '把這個欄位完全刪除，不會出現在輸出資料中。')) },
                        ];

                    return <Select value={rowRecordItem.maskStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'maskStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={maskStrategyOptionList} />;
                }

                if (rowRecordItem.role === 'Quasi-identifier') {
                    if (rowRecordItem.type === 'numeric') {
                        // ★ 自訂區間 (custom_bins) 為一般可選策略，選取後可至「泛化階層對照」分頁編輯 min／max／label 區間定義
                        const numericGenStrategyOptionList = [
                            { value: 'custom_bins', label: strategyOptionLabel(translate('step2.opt_custom_bins_editable', '自訂數值區間'), translate('step2.opt_custom_bins_editable_tooltip', '自行設定數值分組區間，可到「泛化階層對照」分頁編輯。')) },
                            { value: 'rounding', label: strategyOptionLabel(translate('step2.opt_rounding'), translate('step2.opt_rounding_tooltip', '把數值捨入到指定的倍數，讓相近的數字變成同一個值。')) },
                        ];
                        return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={numericGenStrategyOptionList} />;
                    }
                    if (rowRecordItem.type === 'temporal') {
                        // ★ 原「日期粒度」(downgrade) 與「時間粒度」(time_rounding) 合併為單一
                        //   「時間粒度」策略，泛化層級改對應秒/分/時/日/月/年六級（見下方「泛化層級」欄）。
                        const temporalGenStrategyOptionList = [
                            { value: 'time_rounding', label: strategyOptionLabel(translate('step2.opt_time_rounding', '時間粒度'), translate('step2.opt_time_rounding_tooltip', '把時間只留到指定精細度（例如只留到月），抹除更細的時間差異。')) },
                            { value: 'time_range', label: strategyOptionLabel(translate('step2.opt_time_range', '時間區間'), translate('step2.opt_time_range_tooltip', '自訂時間分組區間，可到「泛化階層對照」分頁編輯。')) },
                        ];
                        return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={temporalGenStrategyOptionList} />;
                    }
                    if (rowRecordItem.type === 'categorical') {
                        return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={[{value:'tree', label: strategyOptionLabel(translate('step2.opt_tree'), translate('step2.opt_tree_tooltip', '依「泛化階層對照」設定的分類樹，把細分類逐步合併成大分類。'))}]} />;
                    }
                    return <Select value={rowRecordItem.genStrategy} onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genStrategy', dropdownSelectedValue)} style={{ width: '100%' }} options={[{value:'prefix', label: strategyOptionLabel(translate('step2.opt_prefix'), translate('step2.opt_prefix_tooltip', '只保留字串前面或後面幾個字元，其餘遮蔽。'))}, {value:'length', label: strategyOptionLabel(translate('step2.opt_length'), translate('step2.opt_length_tooltip', '依字串長度決定要遮蔽的字元數量。'))}]} />;
                }

                return <span style={{ color: token.colorTextDescription }}>{translate('step2.no_process_needed')}</span>;
            },
        },
        {
            title: (
                <span>
                    {translate('step2.param_setting')}
                    <Tooltip title={translate('step2.kanon_param_setting_tooltip', '配合左側策略填入細節數值，例如捨入基準或遮蔽長度。')}>
                        <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} />
                    </Tooltip>
                </span>
            ),
            key: 'details', width: '15.5em',
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
                        // ★ 2026-10-15 使用者要求：參數設定禁止負數（捨入單位須大於 0）。
                        //   輸入 0 或負數時不接受（保留原值）；既有不合法的值以紅框標示。
                        return (
                            <InputNumber
                                placeholder={translate('step2.ph_rounding_base')}
                                value={rowRecordItem.genParam}
                                min={0}
                                status={typeof rowRecordItem.genParam === 'number' && rowRecordItem.genParam <= 0 ? 'error' : undefined}
                                onChange={(inputNumberValue) => {
                                    if (typeof inputNumberValue === 'number' && inputNumberValue <= 0) return;
                                    handleFieldChange(rowRecordItem.id, 'genParam', inputNumberValue);
                                }}
                                style={{ width: '100%' }}
                            />
                        );
                    }
                    if (rowRecordItem.type === 'temporal') {
                        if (rowRecordItem.genStrategy === 'time_range') {
                            return <span style={{ color: token.colorTextDescription }}>{translate('step2.custom_bins_count', { count: rowRecordItem.customBins?.length ?? 0 })}</span>;
                        }
                        // time_rounding（時間粒度）已合併日期粒度，改由右方「泛化層級」的六級 Segmented
                        // 直接指定要泛化到秒/分/時/日/月/年哪一級，此欄不再需要額外參數。
                    }
                    if (rowRecordItem.type === 'string') {
                        if (rowRecordItem.genStrategy === 'prefix') {
                            // ★ 修正 (依實際後端原始碼核對): 「保留前後綴」策略實際保留的字數是
                            // 由右側「最大層級」換算出來 (keep_chars = max(5-層級, 1))，這裡的
                            // 「參數設定」數字對後端結果完全沒有作用；先前同時顯示方向選單與一個
                            // 看似有效、實則不生效的數字輸入，容易讓人誤以為兩者都會影響結果。
                            // 故僅保留「前方／後方」方向選擇（決定送給後端是 prefix 還是 suffix），
                            // 說明文字改以「？」提示圖示 (hover 才顯示)，取代原本常駐兩行文字，
                            // 避免撐高列高、與其他欄位對不齊；排版比照本表其餘欄位標題旁的「？」用法。
                            return (
                                <Space size={6} style={{ width: '100%' }}>
                                    <Select
                                        value={rowRecordItem.genDirection || 'front'}
                                        onChange={(dropdownSelectedValue) => handleFieldChange(rowRecordItem.id, 'genDirection', dropdownSelectedValue)}
                                        style={{ minWidth: '6.5em' }}
                                        options={[
                                            { value: 'front', label: translate('step2.anchor_direction_front', '前方') },
                                            { value: 'back', label: translate('step2.anchor_direction_back', '後方') },
                                        ]}
                                    />
                                    <Tooltip title={translate('step2.string_prefix_level_note', '保留字數請至右側「保留字數」欄位設定，此處參數設定不影響結果')}>
                                        <QuestionCircleOutlined style={{ color: token.colorTextDescription, cursor: 'help', fontSize: scaleFontSize(14) }} />
                                    </Tooltip>
                                </Space>
                            );
                        }
                        if (rowRecordItem.genStrategy === 'length') {
                            // ★ 「依字串長度」策略：genParam 對應後端的 bin_size（長度級距寬度），
                            // 實際輸出的長度區間寬度 = bin_size × 最大層級，兩個欄位都會影響結果，
                            // 故此策略維持顯示參數輸入（僅更新 placeholder 文字與說明，見上方 i18n）。
                            // ★ 2026-10-15：長度級距須為正整數，禁止負數與 0
                            return (
                                <InputNumber
                                    placeholder={translate('step2.ph_mask_per_level')}
                                    value={rowRecordItem.genParam}
                                    min={1}
                                    precision={0}
                                    status={typeof rowRecordItem.genParam === 'number' && rowRecordItem.genParam <= 0 ? 'error' : undefined}
                                    onChange={(inputNumberValue) => {
                                        if (typeof inputNumberValue === 'number' && inputNumberValue <= 0) return;
                                        handleFieldChange(rowRecordItem.id, 'genParam', inputNumberValue);
                                    }}
                                    style={{ width: '100%' }}
                                />
                            );
                        }
                    }
                }

                return <span style={{ color: token.colorTextDescription }}>-</span>;
            },
        },
        {
            title: (
                <span>
                    {/* ★ 2026-10-02：依後端規格 qi_generalization_levels 為「實際採用的層級」（0＝不泛化），不是「最多泛化到第幾層」，
                        欄位名稱由「最大層級」改為「泛化層級」並改寫說明（內部變數 genMaxLevel 名稱沿用，不影響送出格式） */}
                    {translate('step2.max_level', '泛化層級')}
                    <Tooltip title={translate('step2.max_level_tooltip', '實際採用的泛化層級，0 表示不泛化（保留原值）。層級越高，相同組合的資料越多、需要被刪除或遮蔽的筆數越少，但資料會變得越粗略；兩者需要取捨。')}>
                        <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} />
                    </Tooltip>
                </span>
            ),
            key: 'level', width: '17em',
            render: (_: unknown, rowRecordItem: FieldDef) => {
                if (rowRecordItem.role === 'Quasi-identifier') {
                    let segmentedLevelOptionList: { label: string; value: number }[] = [];

                    if (rowRecordItem.type === 'temporal') {
                        // ★ 時間粒度不提供「精確」(不泛化) 與「秒」，最細到「分」。2026-10-01 起「秒」自送給後端的
                        //   levels 清單中移除，層級改為 1～5 依序對應 分/時/日/月/年（見 utils/temporalGranularity.ts）。
                        segmentedLevelOptionList = rowRecordItem.genStrategy === 'time_rounding'
                            ? [
                                { label: translate('step2.lvl_minute', '分'), value: 1 },
                                { label: translate('step2.lvl_hour', '時'), value: 2 },
                                { label: translate('step2.lvl_day'), value: 3 },
                                { label: translate('step2.lvl_month'), value: 4 },
                                { label: translate('step2.lvl_year'), value: 5 },
                            ]
                            : [{ label: translate('step2.lvl_original'), value: 0 }, { label: translate('step2.lvl_enable'), value: 1 }];
                    } else if (rowRecordItem.type === 'categorical') {
                        // ★ 修正: 使用者反映不需要「原始／L1／L2…」按鈕式選擇，直接改成數字輸入。
                        //   ★ 修正 (依使用者提供之真實交付包核對): min 原本設為 1，但依實際後端邏輯，
                        //   類別型欄位的層級 0 是合法數值（代表「保留原始值、不泛化」，不會報錯），
                        //   交付包本身也確實會出現 qi_generalization_levels 為 0 的合法設定；若這裡限制
                        //   min=1，AntD InputNumber 會把匯入的 0 直接顯示／強制收斂成 1，導致畫面與
                        //   設定檔實際內容不符。故下限改為 0，讓匯入的 0 能如實呈現與編輯；使用者手動
                        //   新增欄位或首次切換為間接識別碼時，仍由其他預設邏輯給予 1 起跳，不受此處影響。
                        //   上限依實際匯入的階層對照表深度決定，避免使用者輸入超出對照表範圍的層級。
                        const targetHierarchyTableRecord = kAnonymityHierarchiesList.find((hierarchyItemRecord) => hierarchyItemRecord.fieldName === rowRecordItem.name);
                        const maxLevelCalculatedValue = targetHierarchyTableRecord ? Math.max(...targetHierarchyTableRecord.mappings.map(mappingRowArray => mappingRowArray.length), 2) - 1 : 3;

                        // ★ 2026-10-01：可另設層級範圍上限（qi_generalization_levels 的 [最小, 最大]）。後端實際輸出最小層級
                        //   （即左側數字），上限只用於評估兩端的落單比例並寫入報告；留空即為固定層級。
                        const isCategoricalLevelRangeActiveStatus = typeof rowRecordItem.genLevelRangeUpper === 'number' && rowRecordItem.genLevelRangeUpper > rowRecordItem.genMaxLevel;
                        const maxLevelInputElement = (
                            <InputNumber
                                size="small"
                                min={0}
                                max={maxLevelCalculatedValue}
                                value={rowRecordItem.genMaxLevel}
                                onChange={(inputNumberValue) => handleFieldChange(rowRecordItem.id, 'genMaxLevel', inputNumberValue ?? 1)}
                                style={{ width: SHOW_LEVEL_RANGE_TRIAL ? '50%' : '100%' }}
                            />
                        );
                        if (!SHOW_LEVEL_RANGE_TRIAL) return maxLevelInputElement;
                        return (
                            <div>
                                <Space.Compact size="small" style={{ width: 'calc(100% - 18px)' }}>
                                    {maxLevelInputElement}
                                    <InputNumber
                                        size="small"
                                        min={0}
                                        max={maxLevelCalculatedValue}
                                        placeholder={translate('step2.level_range_upper_ph', '評估至')}
                                        value={isCategoricalLevelRangeActiveStatus ? rowRecordItem.genLevelRangeUpper : null}
                                        onChange={(inputNumberValue) => handleFieldChange(rowRecordItem.id, 'genLevelRangeUpper', inputNumberValue ?? 0)}
                                        style={{ width: '50%' }}
                                    />
                                </Space.Compact>
                                <Tooltip title={translate('step2.level_range_tooltip', '選填。資料仍會依照目前選的層級處理；這裡可以再選一個更高的層級做「試算」，系統會估算改用那個層級時，有多少比例的資料因為太特殊、需要被刪除或遮蔽，結果列在結果頁下方「後端處理報告明細」的調整建議中，幫你判斷要不要把層級再調高。不填就不試算。')}>
                                    <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help', fontSize: scaleFontSize(12) }} />
                                </Tooltip>
                                {isCategoricalLevelRangeActiveStatus && (
                                    <div style={{ fontSize: scaleFontSize(11), color: token.colorTextDescription, marginTop: 2 }}>
                                        {translate('step2.level_range_hint', { min: rowRecordItem.genMaxLevel, max: rowRecordItem.genLevelRangeUpper, defaultValue: `依層級 ${rowRecordItem.genMaxLevel} 處理；另試算層級 ${rowRecordItem.genLevelRangeUpper}` })}
                                    </div>
                                )}
                            </div>
                        );
                    } else if (rowRecordItem.type === 'string') {
                        // ★ 修正 (依實際後端原始碼核對): 「保留前後綴」策略的實際保留字數是由這個
                        //   「最大層級」數字換算出來（見上方預覽公式），故維持數字輸入，預設（下限）為 1。
                        // ★ 修正 (使用者反映): 「依字串長度」策略後端公式為 bin_size × level，但使用者
                        //   反映這裡只要調左側「參數設定」(bin_size) 一個數字就好，不需要額外再調層級；
                        //   故此策略不再顯示「最大層級」欄位（level 固定為 1，見上方常數與預覽公式），
                        //   避免讓使用者誤以為兩個數字都需要設定。
                        if (rowRecordItem.genStrategy === 'length') {
                            return <span style={{ color: token.colorTextDescription }}>-</span>;
                        }
                        // ★ 使用者反映（2026-09-22）：這一格原本顯示的是後端概念上的「最大層級」，
                        // 要再套一次公式（保留字數 = max(5-層級,1)）才能反推實際保留幾個字，容易讓人
                        // 誤以為「字串前後綴」這個功能本身的定義有問題（例如誤解成後端不支援指定
                        // 從第幾字開始去識別化）。核對後端原始碼確認：「保留前 N 字」在數學上等同於
                        // 「從第 N+1 字開始去識別化」，兩者是同一件事、只是描述方向不同；後方模式則因
                        // 每筆資料字數不一，只有「從後面數來保留幾字」才有一致意義，無法用固定的
                        // 「第幾字」表達。故這裡改為讓使用者直接輸入「保留字數」，並依方向顯示對應的
                        // 白話說明（前方會換算並顯示「從第幾字開始去識別化」）；送給後端的仍是同一個
                        // genMaxLevel 欄位（level = 5 - 保留字數），後端 API／行為完全不變，只是把這格
                        // 輸入的「呈現方式」換成不需要心算公式的數字。
                        const currentKeepCharsCountValue = Math.max(5 - (rowRecordItem.genMaxLevel ?? STRING_PREFIX_STRATEGY_DEFAULT_LEVEL), 1);
                        const handleKeepCharsInputChange = (nextKeepCharsInputValue: number | null): void => {
                            const clampedKeepCharsValue = Math.min(Math.max(nextKeepCharsInputValue ?? 1, 1), 4);
                            handleFieldChange(rowRecordItem.id, 'genMaxLevel', Math.max(5 - clampedKeepCharsValue, 1));
                        };
                        return (
                            <div>
                                <Space size={6} align="center">
                                    <span style={{ fontSize: scaleFontSize(12), color: token.colorTextDescription, whiteSpace: 'nowrap' }}>
                                        {translate('step2.keep_chars_label', '保留字數')}
                                    </span>
                                    <InputNumber
                                        size="small"
                                        min={1}
                                        max={4}
                                        value={currentKeepCharsCountValue}
                                        onChange={handleKeepCharsInputChange}
                                        style={{ width: '5.5em' }}
                                    />
                                </Space>
                                <div style={{ fontSize: scaleFontSize(11), color: currentKeepCharsCountValue >= 3 ? '#faad14' : token.colorTextDescription, marginTop: 2 }}>
                                    {/* ★ 使用者反映：原本這句只寫「即從第 N+1 字開始去識別化」，讀起來像是「不管
                                        資料多短，前 N 字一定會維持原樣」的保證，容易讓人誤會——但後端規則是
                                        「原始字數 ≤ 保留字數」時一律整格全遮蔽（≤ 是含等於，不是只有「不夠 N 字」
                                        才會這樣，剛好等於 N 字也一樣全遮蔽），跟這句話字面上的意思互相矛盾。因此
                                        把這個但書直接寫進這句常駐文字裡（不再只放在 hover 才看得到的「？」提示裡），
                                        避免使用者沒特別去 hover 就誤以為前 N 字必定保留。 */}
                                    {rowRecordItem.genDirection === 'back'
                                        ? translate('step2.keep_chars_hint_back', { count: currentKeepCharsCountValue, defaultValue: `保留最後 ${currentKeepCharsCountValue} 字，其餘遮蔽（但字數 ≤ ${currentKeepCharsCountValue} 字的資料仍會整格遮蔽，不會保留）` })
                                        : translate('step2.keep_chars_hint_front', { count: currentKeepCharsCountValue, startPos: currentKeepCharsCountValue + 1, defaultValue: `保留前 ${currentKeepCharsCountValue} 字，即從第 ${currentKeepCharsCountValue + 1} 字開始去識別化（但字數 ≤ ${currentKeepCharsCountValue} 字的資料仍會整格遮蔽，不會保留）` })}
                                    {currentKeepCharsCountValue >= 3 && (
                                        <Tooltip title={translate('step2.prefix_keep_chars_warning', '保留字數偏高，若欄位內容多為 2~4 字的短詞（例如中文職業、地區名稱），很容易剛好落入「字數 ≤ 保留字數」的全遮蔽情況，前方／後方看起來沒有差異。建議調低保留字數（例如 1）。')}>
                                            <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                        </Tooltip>
                                    )}
                                </div>
                            </div>
                        );
                    } else if (rowRecordItem.type === 'numeric') {
                        // ★ 修正 (依實際後端原始碼核對): 後端數值型泛化 (bins／rounding) 完全不吃
                        //   「泛化層級」這個概念——只要設定檔有給 bins 或 rounding 就套用，沒給就不套用，
                        //   layer 這顆「原始／啟用」開關對後端而言從未真正代表任何意義。改為直接顯示
                        //   「-」，不再提供按鈕，避免造成「這裡可以關閉泛化」的錯誤印象。
                        return <span style={{ color: token.colorTextDescription }}>-</span>;
                    }

                    // ★ 2026-10-01：時間粒度同樣可設層級範圍上限（qi_generalization_levels 的 [最小, 最大]），實際輸出為上方所選單位
                    const isTemporalLevelRangeSupportedStatus = SHOW_LEVEL_RANGE_TRIAL && rowRecordItem.type === 'temporal' && rowRecordItem.genStrategy === 'time_rounding';
                    const temporalRangeUpperOptionList = segmentedLevelOptionList.filter((levelOptionItem) => levelOptionItem.value > rowRecordItem.genMaxLevel);
                    const isTemporalLevelRangeActiveStatus = isTemporalLevelRangeSupportedStatus
                        && typeof rowRecordItem.genLevelRangeUpper === 'number' && rowRecordItem.genLevelRangeUpper > rowRecordItem.genMaxLevel;
                    return (
                        <div style={{ padding: '0 2px' }}>
                            <Segmented size="small" options={segmentedLevelOptionList} value={rowRecordItem.genMaxLevel} onChange={(selectedSegmentedLevelValue) => handleFieldChange(rowRecordItem.id, 'genMaxLevel', selectedSegmentedLevelValue as number)} block />
                            {isTemporalLevelRangeSupportedStatus && temporalRangeUpperOptionList.length > 0 && (
                                <Space size={6} align="center" style={{ marginTop: 4 }}>
                                    <span style={{ fontSize: scaleFontSize(11), color: token.colorTextDescription, whiteSpace: 'nowrap' }}>
                                        {translate('step2.level_range_upper_label', '評估至')}
                                        <Tooltip title={translate('step2.level_range_tooltip', '選填。資料仍會依照目前選的層級處理；這裡可以再選一個更高的層級做「試算」，系統會估算改用那個層級時，有多少比例的資料因為太特殊、需要被刪除或遮蔽，結果列在結果頁下方「後端處理報告明細」的調整建議中，幫你判斷要不要把層級再調高。不填就不試算。')}>
                                            <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                        </Tooltip>
                                    </span>
                                    <Select
                                        size="small"
                                        allowClear
                                        placeholder={translate('step2.level_range_none', '不設範圍')}
                                        value={isTemporalLevelRangeActiveStatus ? rowRecordItem.genLevelRangeUpper : undefined}
                                        onChange={(selectedUpperLevelValue) => handleFieldChange(rowRecordItem.id, 'genLevelRangeUpper', selectedUpperLevelValue ?? 0)}
                                        options={temporalRangeUpperOptionList}
                                        style={{ width: '7em' }}
                                    />
                                </Space>
                            )}
                        </div>
                    );
                }

                return <span style={{ color: token.colorTextDescription }}>-</span>;
            },
        },
        { title: translate('step2.action'), key: 'action', width: '5em', align: 'center' as const, render: (_: FieldDef, rowRecordItem: FieldDef) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeField(rowRecordItem.id)} /> },
    ];

    const addHierarchyTable = (): void => setKAnonymityHierarchiesList([...kAnonymityHierarchiesList, { id: `h_${Date.now()}`, fieldName: '', mappings: [['', '']] }]);
    const removeHierarchyTable = (targetHierarchyTableIdStr: string): void => setKAnonymityHierarchiesList(kAnonymityHierarchiesList.filter(hierarchyItemRecord => hierarchyItemRecord.id !== targetHierarchyTableIdStr));
    const updateHierarchyField = (targetHierarchyTableIdStr: string, newFieldNameString: string): void => setKAnonymityHierarchiesList(kAnonymityHierarchiesList.map(hierarchyItemRecord => hierarchyItemRecord.id === targetHierarchyTableIdStr ? { ...hierarchyItemRecord, fieldName: newFieldNameString } : hierarchyItemRecord));
    const addMappingRow = (targetHierarchyTableIdStr: string): void => setKAnonymityHierarchiesList(kAnonymityHierarchiesList.map(hierarchyItemRecord => { if (hierarchyItemRecord.id === targetHierarchyTableIdStr) { const columnCountValue = Math.max(...hierarchyItemRecord.mappings.map(mappingRowArray => mappingRowArray.length), MIN_HIERARCHY_COLUMN_COUNT); return { ...hierarchyItemRecord, mappings: [...hierarchyItemRecord.mappings, Array(columnCountValue).fill('')] }; } return hierarchyItemRecord; }));
    // ★ 2026-10-05 修正（使用者回報「泛化階層對照輸入值過長後整頁空白」）：
    //   (1) 原寫法以閉包中的 kAnonymityHierarchiesList 計算新狀態，連續快速輸入時會以舊狀態覆蓋新狀態；
    //       改用函式型更新 (prev => next)，每次都以最新狀態為基礎。
    //   (2) 原寫法在最後一欄輸入時以 mappingRowArray.push('') 直接「改寫」既有列陣列（同一份陣列也被
    //       模組快取 globalCachedKAnonymityHierarchies 與 Zustand store 引用），屬於直接突變 React 狀態；
    //       改為產生新陣列。
    //   (3) 單格輸入長度上限 HIERARCHY_CELL_MAX_LENGTH，超過即截斷（輸入框同時設 maxLength）。
    //   (4) 使用者回報 Bug：原設計在「最後一欄」輸入時會自動替所有列再加一欄，於是在右下角輸入值
    //       就一直冒出新的泛化層級（泛化 5、6、7…）。改為輸入時不自動加欄，層級數改由表格下方
    //       「新增泛化層級／移除最後一層」按鈕明確控制（見 addHierarchyLevelColumn／removeLastHierarchyLevelColumn）。
    const updateMappingCell = (targetHierarchyTableIdStr: string, targetRowIndexNumber: number, targetColIndexNumber: number, newCellValueString: string): void => {
        const safeCellValueString = (newCellValueString ?? '').slice(0, HIERARCHY_CELL_MAX_LENGTH);
        setKAnonymityHierarchiesList(previousHierarchiesListArray => previousHierarchiesListArray.map(hierarchyItemRecord => {
            if (hierarchyItemRecord.id !== targetHierarchyTableIdStr) return hierarchyItemRecord;
            if (!hierarchyItemRecord.mappings[targetRowIndexNumber]) return hierarchyItemRecord;
            const newMappingsArrayData = hierarchyItemRecord.mappings.map((mappingRowArray, rowIndexNumber) => {
                if (rowIndexNumber !== targetRowIndexNumber) return mappingRowArray;
                const copiedRowArray = [...mappingRowArray];
                // 列長度不足（例如欄數由其他列決定）時補空字串，避免產生稀疏陣列
                while (copiedRowArray.length <= targetColIndexNumber) copiedRowArray.push('');
                copiedRowArray[targetColIndexNumber] = safeCellValueString;
                return copiedRowArray;
            });
            return { ...hierarchyItemRecord, mappings: newMappingsArrayData };
        }));
    };

    // 取得某張對照表目前的欄數（原始值 + 各泛化層級），至少 MIN_HIERARCHY_COLUMN_COUNT
    const getHierarchyColumnCount = (hierarchyItemRecord: HierarchyTable): number =>
        Math.max(...hierarchyItemRecord.mappings.map(mappingRowArray => mappingRowArray.length), MIN_HIERARCHY_COLUMN_COUNT);

    // ★ 2026-10-05：明確新增一個泛化層級（所有列補齊到相同欄數後再加一欄），上限 MAX_HIERARCHY_LEVEL_COUNT 層
    const addHierarchyLevelColumn = (targetHierarchyTableIdStr: string): void => setKAnonymityHierarchiesList(previousHierarchiesListArray => previousHierarchiesListArray.map(hierarchyItemRecord => {
        if (hierarchyItemRecord.id !== targetHierarchyTableIdStr) return hierarchyItemRecord;
        const currentColumnCount = getHierarchyColumnCount(hierarchyItemRecord);
        if (currentColumnCount - 1 >= MAX_HIERARCHY_LEVEL_COUNT) return hierarchyItemRecord;
        const nextColumnCount = currentColumnCount + 1;
        return { ...hierarchyItemRecord, mappings: hierarchyItemRecord.mappings.map(mappingRowArray => [...mappingRowArray, ...Array(Math.max(nextColumnCount - mappingRowArray.length, 0)).fill('')]) };
    }));

    // ★ 2026-10-05：移除最後一個泛化層級（至少保留 1 層）
    const removeLastHierarchyLevelColumn = (targetHierarchyTableIdStr: string): void => setKAnonymityHierarchiesList(previousHierarchiesListArray => previousHierarchiesListArray.map(hierarchyItemRecord => {
        if (hierarchyItemRecord.id !== targetHierarchyTableIdStr) return hierarchyItemRecord;
        const currentColumnCount = getHierarchyColumnCount(hierarchyItemRecord);
        if (currentColumnCount <= MIN_HIERARCHY_COLUMN_COUNT) return hierarchyItemRecord;
        const nextColumnCount = currentColumnCount - 1;
        return { ...hierarchyItemRecord, mappings: hierarchyItemRecord.mappings.map(mappingRowArray => mappingRowArray.slice(0, nextColumnCount)) };
    }));

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
        <Card variant="borderless" style={{ background: 'transparent', padding: 0 }}>
            <Tabs
                defaultActiveKey="1"
                tabBarExtraContent={
                    <Space style={{ paddingBottom: '8px' }}>
                        {/* ★ 2026-10-07 QA 回饋：匯入旁加上匯出（見 ConfigFileButtons.tsx） */}
                        <ConfigFileButtons onImportFileChange={handleImportJSON} fileInputRef={fileInputRef} />
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

                                        <Space size={8}>
                                            {isJsonPreviewVisibleStatus ? (
                                                <Button size="small" icon={<EyeInvisibleOutlined />} onClick={() => setIsJsonPreviewVisibleStatus(false)}>{translate('step2.json_preview_hide', '隱藏預覽')}</Button>
                                            ) : (
                                                <Button size="small" icon={<EyeOutlined />} onClick={() => setIsJsonPreviewVisibleStatus(true)}>{translate('step2.json_preview_show', '顯示預覽')}</Button>
                                            )}
                                            <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleApplyRecommendations} style={{ background: '#4F46E5', border: 'none', borderRadius: '6px' }}>
                                                {translate('step2.btn_apply_recommend')}
                                            </Button>
                                        </Space>
                                    </div>

                                    {fieldsNotInDatasetNamesList.length > 0 && (
                                        <Alert
                                            type="error"
                                            showIcon
                                            style={{ marginBottom: '12px' }}
                                            title={describeFieldsNotInDatasetError(fieldsNotInDatasetNamesList)}
                                            action={<Button size="small" danger onClick={removeFieldsNotInDataset}>{translate('step2.btn_remove_fields_not_in_dataset', '移除不存在的欄位')}</Button>}
                                        />
                                    )}
                                    {datasetColumnsNotConfiguredList.length > 0 && (
                                        <Alert
                                            type="warning"
                                            showIcon
                                            style={{ marginBottom: '12px' }}
                                            title={translate('step2.dataset_columns_not_configured_warning', {
                                                names: datasetColumnsNotConfiguredList.map((columnNameString) => `「${columnNameString}」`).join('、'),
                                                defaultValue: `資料中的 ${datasetColumnsNotConfiguredList.map((columnNameString) => `「${columnNameString}」`).join('、')} 尚未設定，執行時會當作「非敏感欄位」原樣保留。`
                                            })}
                                            action={<Button size="small" onClick={addDatasetColumnsNotConfigured}>{translate('step2.btn_add_columns_not_configured', '補上缺漏欄位')}</Button>}
                                        />
                                    )}

                                    {
                                        // ★ 使用者反映（2026-09-22）：Step4 執行端已改版——0 個敏感欄位時會顯示警告
                                        //   但不阻擋、直接略過三攻擊與 CAP；2 個以上時會比照差分隱私模式，對每個
                                        //   標記為「敏感」的欄位各自輪流評估、取風險最高（最保守）的結果，不再是
                                        //   單純的「合法／不合法」二分。這裡的即時提示同步改為三種狀態，文字內容
                                        //   跟著 Step4 實際會發生的事情走，不再說「須恰好設定 1 個」（已不成立）。
                                        (() => {
                                            // ★ 2026-10-07：只計算資料中實際存在的欄位 (不存在的欄位執行時會被丟掉)
                                            const liveSensitiveFieldsCountNumber = kAnonymityFieldsList.filter(
                                                (fieldItemRecord) => fieldItemRecord.role === 'Sensitive' && isFieldNameInDataset(fieldItemRecord.name, datasetColumnNameSet)
                                            ).length;

                                            let bannerIconElement = <CheckCircleOutlined />;
                                            let bannerMessageText = translate('step2.sensitive_count_ok', { count: liveSensitiveFieldsCountNumber, defaultValue: `目前敏感欄位數量：${liveSensitiveFieldsCountNumber}（風險評估將針對此欄位進行）` });
                                            let bannerTooltipText = translate('step2.sensitive_count_tooltip_ok', '敏感欄位是最需要保護、不希望被別人看出來的內容（例如疾病、薪資）。目前已設定 1 個，執行時會以它進行風險評估。');
                                            let bannerAccentColor = '#52c41a';
                                            let bannerBackgroundColor = isDarkModeActive ? 'rgba(82, 196, 26, 0.12)' : '#f6ffed';

                                            if (liveSensitiveFieldsCountNumber === 0) {
                                                // ★ 2026-10-02：0 個敏感欄位改為阻擋下一步（見上方驗證 Effect），提示改為錯誤樣式
                                                bannerIconElement = <WarningOutlined />;
                                                bannerMessageText = translate('step2.sensitive_count_zero_block', '目前敏感欄位數量：0（須至少設定 1 個敏感欄位才能進入下一步）');
                                                bannerTooltipText = translate('step2.sensitive_count_tooltip_zero_block', '敏感欄位是最需要保護、不希望被別人看出來的內容（例如疾病、薪資），l-多樣性、t-緊密度與風險評估都需要用到它。請在下方表格將其中一欄的「角色」設為「敏感欄位」，再進入下一步。');
                                                bannerAccentColor = '#ff4d4f';
                                                bannerBackgroundColor = isDarkModeActive ? 'rgba(255, 77, 79, 0.12)' : '#fff2f0';
                                            } else if (liveSensitiveFieldsCountNumber >= 2) {
                                                bannerIconElement = <InfoCircleOutlined />;
                                                bannerMessageText = translate('step2.sensitive_count_multi', { count: liveSensitiveFieldsCountNumber, defaultValue: `目前敏感欄位數量：${liveSensitiveFieldsCountNumber}（將逐一評估每個敏感欄位，取風險最高的保守結果；欄位越多，執行時間越長）` });
                                                bannerTooltipText = translate('step2.sensitive_count_tooltip_multi', '敏感欄位是最需要保護、不希望被別人看出來的內容（例如疾病、薪資）。設定多個時，系統會逐一評估並採用風險最高的結果，不需要分次執行；設定 N 個，評估時間約為 N 倍。');
                                                bannerAccentColor = '#1677ff';
                                                bannerBackgroundColor = isDarkModeActive ? 'rgba(22, 119, 255, 0.12)' : '#e6f4ff';
                                            }

                                            return (
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8,
                                                        marginBottom: '12px',
                                                        padding: '6px 12px',
                                                        borderRadius: '6px',
                                                        fontSize: scaleFontSize(13),
                                                        background: bannerBackgroundColor,
                                                        border: `1px solid ${bannerAccentColor}`,
                                                        color: bannerAccentColor
                                                    }}
                                                >
                                                    {bannerIconElement}
                                                    <span>{bannerMessageText}</span>
                                                    <Tooltip title={bannerTooltipText}>
                                                        <QuestionCircleOutlined style={{ cursor: 'help' }} />
                                                    </Tooltip>
                                                </div>
                                            );
                                        })()
                                    }

                                    <div style={{ background: isDarkModeActive ? '#1d1d1d' : '#ffffff', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${token.colorBorderSecondary}` }}>
                                        <Table 
                                            dataSource={kAnonymityFieldsList} 
                                            columns={kAnonymityFieldTableColumnsConfig} 
                                            rowKey="id" 
                                            pagination={false} 
                                            size="small" 
                                            bordered={false} 
                                            className="attribute-table" 
                                            scroll={{ x: 'max-content', y: 400 }}
                                            expandable={
                                                { 
                                                    columnTitle: translate('step2.preview_column_title', '預覽'),
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
                                                                <div style={{ fontWeight: 600, marginBottom: 12, color: token.colorText }}> {translate('step2.data_preview')} </div> 
                                                                <Table dataSource={samplePreviewRowsDataArray} pagination={false} size="small" columns={previewTableColumnsConfig} /> 
                                                            </div> 
                                                        ); 
                                                    } 
                                                }
                                            } 
                                        />
                                    </div>

                                    {isJsonPreviewVisibleStatus && (
                                        <Card
                                            size="small"
                                            style={{ marginTop: '16px', background: isDarkModeActive ? '#141414' : '#fafafa', border: `1px solid ${token.colorBorderSecondary}` }}
                                            styles={{ body: { padding: 0 }, header: { borderBottom: `1px solid ${token.colorBorderSecondary}` } }}
                                            title={<span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><CodeOutlined style={{ color: token.colorPrimary }} />{translate('step2.json_preview')}</span>}
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
                                                        <div className="kanon-json-preview-line" key={jsonPreviewLineIndexNumber}>
                                                            <span className="kanon-json-preview-line-number">{jsonPreviewLineIndexNumber + 1}</span>
                                                            <span className="kanon-json-preview-line-content">{jsonPreviewLineTextString}</span>
                                                        </div>
                                                    )
                                                )}
                                            </div>
                                        </Card>
                                    )}

                                    <Tooltip title={storeColumnsList.length > 0 && datasetColumnsNotConfiguredList.length === 0 ? translate('step2.add_field_all_configured', '資料中的欄位都已設定；新增欄位只能加回資料中尚未設定的欄位。') : ''}>
                                        <Button type="dashed" block icon={<PlusOutlined />} onClick={addField} disabled={storeColumnsList.length > 0 && datasetColumnsNotConfiguredList.length === 0} style={{ marginTop: '16px' }}>{translate('step2.btn_add_field')}</Button>
                                    </Tooltip>
                                </div>
                            )
                        },
                        {
                            key: '2', label: (
                                <span style={{ padding: '0 8px' }}>
                                    <SisternodeOutlined /> {translate('step2.tab_hierarchy')}
                                    <Tooltip title={translate('step2.tab_hierarchy_tooltip', '未在範圍設定內的資料，將以 * 取代。')}>
                                        <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help', fontSize: scaleFontSize(12) }} />
                                    </Tooltip>
                                </span>
                            ),
                            children: (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                    {(kAnonymityHierarchiesList.length > 0 || kAnonymityFieldsList.some(fieldItemRecord => fieldItemRecord.role === 'Quasi-identifier' && ((fieldItemRecord.type === 'numeric' && fieldItemRecord.genStrategy === 'custom_bins') || (fieldItemRecord.type === 'temporal' && fieldItemRecord.genStrategy === 'time_range')))) && (
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '-12px' }}>
                                            <Space size={4}>
                                                <Button size="small" icon={<VerticalAlignTopOutlined />} onClick={collapseAllHierarchyCards}>{translate('step2.hierarchy_collapse_all', '全部收起')}</Button>
                                                <Button size="small" icon={<VerticalAlignBottomOutlined />} onClick={expandAllHierarchyCards}>{translate('step2.hierarchy_expand_all', '全部展開')}</Button>
                                            </Space>
                                        </div>
                                    )}
                                    {kAnonymityFieldsList.filter(fieldItemRecord =>
                                        // ★ 修正：使用者反映「薪資」「就醫次數」等隱私角色不是「間接識別碼」(例如敏感／非敏感)
                                        // 的欄位，也出現在「泛化階層對照」分頁——根因是這些欄位的 genStrategy 欄位值殘留自
                                        // 先前曾被判斷為間接識別碼、套用過 custom_bins 策略時的狀態（例如手動改過角色，或
                                        // 套用系統推薦設定時「薪資」命中敏感關鍵字、角色改判為 Sensitive，但因此分支不會
                                        // 經過下方「間接識別碼固定套用預設策略」那段邏輯，genStrategy 便維持原值未被清除)；
                                        // 泛化階層對照本就只該套用在「間接識別碼」欄位，故此處一併檢查隱私角色，非間接識別碼
                                        // 者即使 genStrategy 殘留為 custom_bins／time_range 也不應顯示。
                                        // ★ 修正：使用者確認「最小單位設定 (rounding)」策略一律不應顯示在此分頁——該策略只靠
                                        // 單一 genParam 運作，不需要（也不該提供）逐列區間表或分組預覽，只有「自訂數值區間」
                                        // (custom_bins) 才需要在此編輯區間列表。
                                        fieldItemRecord.role === 'Quasi-identifier' && (
                                            (fieldItemRecord.type === 'numeric' && fieldItemRecord.genStrategy === 'custom_bins') ||
                                            (fieldItemRecord.type === 'temporal' && fieldItemRecord.genStrategy === 'time_range')
                                        )
                                    ).map(
                                        (customBinsFieldItemRecord) => {
                                            const isTemporalRangeFieldStatus = customBinsFieldItemRecord.type === 'temporal';
                                            const binsCardKeyStr = `bins:${customBinsFieldItemRecord.id}`;
                                            const isBinsCardCollapsedStatus = isHierarchyCardCollapsed(binsCardKeyStr);

                                            return (
                                            <Card
                                                key={customBinsFieldItemRecord.id}
                                                size="small"
                                                styles={{ header: { background: isDarkModeActive ? '#1f1f1f' : '#f5f5f5', borderBottom: isBinsCardCollapsedStatus ? 'none' : `1px solid ${token.colorBorderSecondary}` }, body: isBinsCardCollapsedStatus ? { display: 'none' } : undefined }}
                                                style={{ border: `1px solid ${token.colorBorderSecondary}`, boxShadow: 'none' }}
                                                title={
                                                    <Space>
                                                        {renderHierarchyCardToggle(binsCardKeyStr)}
                                                        <span style={{ color: token.colorTextSecondary }}>{translate('step2.related_field')}</span>
                                                        <span style={{ fontWeight: 600 }}>{customBinsFieldItemRecord.name}</span>
                                                        <span style={{ fontSize: scaleFontSize(12), color: token.colorPrimary, border: `1px solid ${token.colorPrimaryBorder}`, borderRadius: '4px', padding: '0 6px' }}>
                                                            {isTemporalRangeFieldStatus ? translate('step2.opt_time_range', '時間區間') : translate('step2.opt_custom_bins_editable', '自訂數值區間')}
                                                        </span>
                                                        {isBinsCardCollapsedStatus && (
                                                            <span style={{ fontSize: scaleFontSize(12), color: token.colorTextDescription, fontWeight: 'normal' }}>
                                                                {translate('step2.hierarchy_card_row_count', { count: (customBinsFieldItemRecord.customBins || []).length, defaultValue: '共 {{count}} 列' })}
                                                            </span>
                                                        )}
                                                    </Space>
                                                }
                                            >
                                                {/* ★ 新增：「系統推薦設定」——依實際資料最小/最大值，自動產生初步區間，
                                                    供使用者後續手動微調，避免每個區間都要從零手動輸入。僅適用於數值型
                                                    欄位 (時間型「時段」語意不同，暫不提供此自動填入)。 */}
                                                {!isTemporalRangeFieldStatus && (
                                                    <div
                                                        style={{
                                                            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px',
                                                            marginBottom: '12px', padding: '10px 12px',
                                                            background: isDarkModeActive ? '#111b26' : '#f0f5ff',
                                                            border: `1px dashed ${token.colorPrimaryBorder}`, borderRadius: '6px'
                                                        }}
                                                    >
                                                        <Space size={4} style={{ color: token.colorPrimary, fontWeight: 600, fontSize: scaleFontSize(13), whiteSpace: 'nowrap' }}>
                                                            <ThunderboltOutlined />
                                                            {translate('step2.bin_autofill_title', '系統推薦設定')}
                                                            <Tooltip title={translate('step2.bin_autofill_tooltip', '依此欄位實際資料的最小／最大值，自動計算區間邊界作為初步設定，產生後仍可手動調整每一列。')}>
                                                                <QuestionCircleOutlined style={{ color: token.colorTextDescription, cursor: 'help', fontSize: scaleFontSize(12) }} />
                                                            </Tooltip>
                                                        </Space>

                                                        <Segmented
                                                            size="small"
                                                            value={getBinAutoFillSettingsForField(customBinsFieldItemRecord.id).mode}
                                                            onChange={(selectedModeValue) => updateBinAutoFillSettingForField(customBinsFieldItemRecord.id, { mode: selectedModeValue as 'even' | 'unit' })}
                                                            options={[
                                                                { label: translate('step2.bin_autofill_mode_even', '平均分配'), value: 'even' },
                                                                { label: translate('step2.bin_autofill_mode_unit', '最小單位'), value: 'unit' }
                                                            ]}
                                                        />

                                                        {getBinAutoFillSettingsForField(customBinsFieldItemRecord.id).mode === 'even' ? (
                                                            <Space size={4}>
                                                                <span style={{ fontSize: scaleFontSize(12), color: token.colorTextSecondary, whiteSpace: 'nowrap' }}>{translate('step2.bin_autofill_count_label', '區間數量')}</span>
                                                                <InputNumber
                                                                    size="small"
                                                                    min={MIN_AUTO_BIN_COUNT}
                                                                    max={MAX_AUTO_BIN_COUNT}
                                                                    style={{ width: '5.5em' }}
                                                                    value={getBinAutoFillSettingsForField(customBinsFieldItemRecord.id).binCount}
                                                                    onChange={(inputNumberValue) => updateBinAutoFillSettingForField(customBinsFieldItemRecord.id, { binCount: Number(inputNumberValue) || DEFAULT_AUTO_BIN_COUNT })}
                                                                />
                                                            </Space>
                                                        ) : (
                                                            <Space size={4}>
                                                                <span style={{ fontSize: scaleFontSize(12), color: token.colorTextSecondary, whiteSpace: 'nowrap' }}>{translate('step2.bin_autofill_unit_label', '最小單位寬度')}</span>
                                                                <InputNumber
                                                                    size="small"
                                                                    min={0.01}
                                                                    step={1}
                                                                    style={{ width: '6.5em' }}
                                                                    value={getBinAutoFillSettingsForField(customBinsFieldItemRecord.id).unitWidth}
                                                                    onChange={(inputNumberValue) => updateBinAutoFillSettingForField(customBinsFieldItemRecord.id, { unitWidth: Number(inputNumberValue) || DEFAULT_AUTO_BIN_UNIT_WIDTH })}
                                                                />
                                                            </Space>
                                                        )}

                                                        <Popconfirm
                                                            title={translate('step2.bin_autofill_confirm_title', '自動產生區間')}
                                                            description={translate('step2.bin_autofill_confirm_desc', '此操作將依上方設定值，取代此欄位目前所有的區間列表，確定要繼續嗎？')}
                                                            onConfirm={() => handleGenerateRecommendedBins(customBinsFieldItemRecord.id, customBinsFieldItemRecord.name)}
                                                            okText={translate('modal.confirm', '確定')}
                                                            cancelText={translate('modal.cancel', '取消')}
                                                        >
                                                            <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />}>
                                                                {translate('step2.bin_autofill_generate_btn', '自動產生區間')}
                                                            </Button>
                                                        </Popconfirm>
                                                    </div>
                                                )}

                                                <div data-hierarchy-scroll={binsCardKeyStr} style={{ maxHeight: HIERARCHY_SCROLL_BOX_MAX_HEIGHT, overflowY: 'auto', overflowX: 'auto', marginBottom: '4px' }}>
                                                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', padding: '0 8px', position: 'sticky', top: 0, zIndex: 2, background: token.colorBgContainer }}>
                                                    <div style={{ width: '10em', color: token.colorTextSecondary, fontSize: scaleFontSize(12) }}>{isTemporalRangeFieldStatus ? translate('step2.time_range_start', '起始時間 (含)') : translate('step2.bin_min', '下限 (含)')}</div>
                                                    <div style={{ width: '10em', color: token.colorTextSecondary, fontSize: scaleFontSize(12) }}>{isTemporalRangeFieldStatus ? translate('step2.time_range_end', '結束時間 (不含)') : translate('step2.bin_max', '上限 (不含)')}</div>
                                                    <div style={{ flex: 1, color: token.colorTextSecondary, fontSize: scaleFontSize(12) }}>{translate('step2.bin_label', '顯示標籤')}</div>
                                                    <div style={{ width: '4.5em' }}></div>
                                                </div>

                                                {(customBinsFieldItemRecord.customBins || []).map(
                                                    (binItemRecord, binIndexNumber) => (
                                                        <div key={binIndexNumber} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                                            {isTemporalRangeFieldStatus ? (
                                                                <>
                                                                    <TimePicker
                                                                        style={{ width: '10em' }}
                                                                        format="HH:mm"
                                                                        placeholder={translate('step2.bin_unbounded', '不限')}
                                                                        value={binItemRecord.min != null ? dayjs().startOf('day').add(binItemRecord.min, 'minute') : null}
                                                                        onChange={(timePickerValue) => updateCustomBinField(customBinsFieldItemRecord.id, binIndexNumber, 'min', timePickerValue ? timePickerValue.hour() * 60 + timePickerValue.minute() : null)}
                                                                    />
                                                                    <TimePicker
                                                                        style={{ width: '10em' }}
                                                                        format="HH:mm"
                                                                        placeholder={translate('step2.bin_unbounded', '不限')}
                                                                        value={binItemRecord.max != null ? dayjs().startOf('day').add(binItemRecord.max, 'minute') : null}
                                                                        onChange={(timePickerValue) => updateCustomBinField(customBinsFieldItemRecord.id, binIndexNumber, 'max', timePickerValue ? timePickerValue.hour() * 60 + timePickerValue.minute() : null)}
                                                                    />
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <InputNumber
                                                                        style={{ width: '10em' }}
                                                                        placeholder={translate('step2.bin_unbounded', '不限')}
                                                                        value={binItemRecord.min ?? undefined}
                                                                        onChange={(inputNumberValue) => updateCustomBinField(customBinsFieldItemRecord.id, binIndexNumber, 'min', inputNumberValue)}
                                                                    />
                                                                    <InputNumber
                                                                        style={{ width: '10em' }}
                                                                        placeholder={translate('step2.bin_unbounded', '不限')}
                                                                        value={binItemRecord.max ?? undefined}
                                                                        onChange={(inputNumberValue) => updateCustomBinField(customBinsFieldItemRecord.id, binIndexNumber, 'max', inputNumberValue)}
                                                                    />
                                                                </>
                                                            )}
                                                            {/* ★ 2026-09-29：第一格下限為 0、但實際資料最小值大於 0（且落在這格內）時，
                                                                代表這格已由「自動產生區間」向下延伸至 0，在旁邊加註說明。依資料即時判斷，
                                                                使用者手動改掉下限後註解會自動消失。 */}
                                                            {(() => {
                                                                if (isTemporalRangeFieldStatus || binIndexNumber !== 0 || binItemRecord.min !== 0) return null;
                                                                const columnRealMinValue = datasetColumnRealMinValueMap[customBinsFieldItemRecord.name];
                                                                if (columnRealMinValue === undefined || columnRealMinValue <= 0) return null;
                                                                if (binItemRecord.max !== null && binItemRecord.max !== undefined && binItemRecord.max <= columnRealMinValue) return null;
                                                                return (
                                                                    <Tooltip title={translate('step2.bin_extended_to_zero_tooltip', '實際資料最小值為 {{min}}，為避免日後出現更小的數值落在所有區間之外，此區間下限已自動向下延伸至 0（0 ～ {{min}} 併入本區間，不另增加區間數）。', { min: columnRealMinValue })}>
                                                                        <span style={{ alignSelf: 'center', whiteSpace: 'nowrap', fontSize: scaleFontSize(12), color: token.colorWarningText, cursor: 'help' }}>
                                                                            {translate('step2.bin_extended_to_zero_note', '※ 含 0～{{min}}', { min: columnRealMinValue })}
                                                                        </span>
                                                                    </Tooltip>
                                                                );
                                                            })()}
                                                            {/* ★ 新增：使用者反映「顯示標籤」留空時，畫面上完全看不出來、還是能點下一步，
                                                                直到 Step4 送出後端才會出現錯誤訊息。除了上方跨頁的必填檢查外，這裡額外用
                                                                紅框即時標示出還沒填的那一格，不用等到點下一步才知道是哪一格有問題。 */}
                                                            <Tooltip title={!binItemRecord.label?.trim() ? translate('step2.bin_label_required_hint', '此欄必填，未填寫此區間將無法產生去識別化結果') : ''}>
                                                                <Input
                                                                    style={{ flex: 1 }}
                                                                    status={!binItemRecord.label?.trim() ? 'error' : undefined}
                                                                    placeholder={isTemporalRangeFieldStatus ? translate('step2.time_range_label_placeholder', '例：凌晨') : translate('step2.bin_label_placeholder', '例：30歲以下')}
                                                                    value={binItemRecord.label}
                                                                    maxLength={CUSTOM_BIN_LABEL_MAX_LENGTH}
                                                                    onChange={(inputChangeEvent) => updateCustomBinField(customBinsFieldItemRecord.id, binIndexNumber, 'label', inputChangeEvent.target.value.slice(0, CUSTOM_BIN_LABEL_MAX_LENGTH))}
                                                                />
                                                            </Tooltip>
                                                            <Space style={{ width: '4.5em', justifyContent: 'center' }}>
                                                                <Popconfirm title={translate('step2.confirm_delete_row')} onConfirm={() => removeCustomBinRow(customBinsFieldItemRecord.id, binIndexNumber)}>
                                                                    <Button type="text" size="small" icon={<DeleteOutlined style={{ color: token.colorTextDescription }} />} />
                                                                </Popconfirm>
                                                            </Space>
                                                        </div>
                                                    )
                                                )}

                                                </div>

                                                <Button type="link" icon={<PlusOutlined />} onClick={() => { addCustomBinRow(customBinsFieldItemRecord.id); scrollHierarchyBoxToBottom(binsCardKeyStr); }} style={{ paddingLeft: 0 }}>{isTemporalRangeFieldStatus ? translate('step2.btn_add_time_range', '新增時段') : translate('step2.btn_add_bin', '新增區間')}</Button>
                                            </Card>
                                            );
                                        }
                                    )}

                                    {/* ★ 新增：使用者反映「自訂階層樹」畫面只看得到欄位與輸入框，看不出階層關係該
                                        怎麼建立、每一欄填寫的意義，故補上一段常駐說明，搭配下方每欄標題的 Tooltip
                                        與輸入框 placeholder 範例，一併說明。 */}
                                    {kAnonymityFieldsList.some(fieldItemRecord => fieldItemRecord.type === 'categorical' && fieldItemRecord.genStrategy === 'tree') && (
                                        <Alert
                                            type="info"
                                            showIcon
                                            style={{ marginBottom: '16px' }}
                                            message={translate('step2.hierarchy_tree_guide_title', '自訂階層樹怎麼填？')}
                                            description={
                                                <div style={{ fontSize: scaleFontSize(12.5), lineHeight: 1.8 }}>
                                                    <div>{translate('step2.hierarchy_tree_guide_p1', '每一列代表資料集中「一個實際存在的原始值」由細到粗的泛化路徑。「原始值」欄請填寫與資料集內容完全一致的值（含全形/半形、大小寫、空格），系統依此逐字比對；「泛化第 1 層」「泛化第 2 層」……則依序填入這個值在該層要被取代成的較粗類別，層級越高應填越粗略的分類。')}</div>
                                                    <div style={{ marginTop: 6 }}>
                                                        {translate('step2.hierarchy_tree_guide_p2_prefix', '例如「地區」欄位：')}
                                                        <code style={{ background: isDarkModeActive ? '#262626' : '#f0f0f0', padding: '1px 6px', borderRadius: 4 }}>{translate('step2.hierarchy_tree_guide_example_row1', '大安區 → 臺北市 → 北部')}</code>
                                                        {'、'}
                                                        <code style={{ background: isDarkModeActive ? '#262626' : '#f0f0f0', padding: '1px 6px', borderRadius: 4 }}>{translate('step2.hierarchy_tree_guide_example_row2', '信義區 → 臺北市 → 北部')}</code>
                                                        {translate('step2.hierarchy_tree_guide_p2_suffix', '，即為兩列各自獨立的對應關係。')}
                                                    </div>
                                                    <div style={{ marginTop: 6 }}>{translate('step2.hierarchy_tree_guide_p3', '請針對您要涵蓋的每一個原始值各自建立一列；沒有被任何一列涵蓋到的原始值，執行去識別化時會直接以「*」取代（等同完全遮蔽、不會保留原值），請確認清單已涵蓋所有需要保留實用性的值。')}</div>
                                                    <div style={{ marginTop: 6 }}>{translate('step2.hierarchy_tree_guide_p4', '實際會套用到第幾層，由上方欄位列表中該欄位的「泛化層級 (Level)」設定決定；層級 0 代表不泛化（顯示原始值）。')}</div>
                                                </div>
                                            }
                                        />
                                    )}

                                    {kAnonymityHierarchiesList.filter(hierarchyTableRecordItem => {
                                        // ★ 修正：使用者反映「年齡」等處理策略為「最小單位設定 (rounding)」的欄位，
                                        // 仍可透過這張「自訂階層樹」對照表的「關聯欄位」下拉選單被選取、顯示在
                                        // 「泛化階層對照」分頁——與使用者確認之規則一致：rounding 策略無論如何都不應
                                        // 出現在此分頁。這張表原本只依「隱私角色＝間接識別碼」篩選下拉選項，未排除
                                        // rounding 策略，故已指派給 rounding 欄位的既有列也會照樣顯示。這裡在渲染前
                                        // 先行過濾：關聯欄位若已解析為 rounding 策略之數值型欄位，則不顯示該筆對照表
                                        // (資料本身不刪除，欄位若之後改回其他策略即可重新顯示，避免使用者已填寫的
                                        // 對照內容無故遺失)。尚未選擇關聯欄位、或關聯欄位已被刪除/改名而找不到者，
                                        // 維持顯示，讓使用者可以繼續設定或修正。
                                        if (!hierarchyTableRecordItem.fieldName) return true;
                                        const associatedFieldRecordForHierarchy = kAnonymityFieldsList.find(fieldItemRecord => fieldItemRecord.name === hierarchyTableRecordItem.fieldName);
                                        if (!associatedFieldRecordForHierarchy) return true;
                                        return !(associatedFieldRecordForHierarchy.type === 'numeric' && associatedFieldRecordForHierarchy.genStrategy === 'rounding');
                                    }).map(
                                        (hierarchyTableRecordItem) =>
                                        {
                                            const columnCountCalculatedValue = Math.max(...hierarchyTableRecordItem.mappings.map(mappingRowArray => mappingRowArray.length), MIN_HIERARCHY_COLUMN_COUNT);
                                            // ★ 2026-10-06：逐列防呆結果（標紅框＋表格下方列出問題）
                                            const associatedTreeFieldRecord = kAnonymityFieldsList.find((fieldItemRecord) => fieldItemRecord.name === hierarchyTableRecordItem.fieldName && fieldItemRecord.genStrategy === 'tree');
                                            const selectedTreeLevelValue = associatedTreeFieldRecord ? associatedTreeFieldRecord.genMaxLevel : undefined;
                                            const hierarchyTableProblemsList = findHierarchyTableProblems(hierarchyTableRecordItem.mappings, selectedTreeLevelValue);
                                            const problemCellKeySet = new Set(hierarchyTableProblemsList.map((problemItem) => `${problemItem.rowNumber - 1}:${problemItem.columnIndex}`));
                                            const treeCardKeyStr = `tree:${hierarchyTableRecordItem.id}`;
                                            const isTreeCardCollapsedStatus = isHierarchyCardCollapsed(treeCardKeyStr);

                                            return (
                                                <Card key={hierarchyTableRecordItem.id} size="small" styles={{ header: { background: isDarkModeActive ? '#1f1f1f' : '#f5f5f5', borderBottom: isTreeCardCollapsedStatus ? 'none' : `1px solid ${token.colorBorderSecondary}` }, body: isTreeCardCollapsedStatus ? { display: 'none' } : undefined }} style={{ border: `1px solid ${token.colorBorderSecondary}`, boxShadow: 'none' }} title={ <Space> {renderHierarchyCardToggle(treeCardKeyStr)} <span style={{ color: token.colorTextSecondary }}>{translate('step2.related_field')}</span> <Select value={hierarchyTableRecordItem.fieldName || undefined} onChange={(dropdownSelectedValue) => updateHierarchyField(hierarchyTableRecordItem.id, dropdownSelectedValue)} placeholder={translate('step2.ph_select_qi')} style={{ width: '18em' }} options={kAnonymityFieldsList.filter(fieldItemRecord => fieldItemRecord.role === 'Quasi-identifier' && !(fieldItemRecord.type === 'numeric' && fieldItemRecord.genStrategy === 'rounding')).map(fieldItemRecord => ({ label: fieldItemRecord.name, value: fieldItemRecord.name }))} /> {isTreeCardCollapsedStatus && ( <span style={{ fontSize: scaleFontSize(12), color: token.colorTextDescription, fontWeight: 'normal' }}>{translate('step2.hierarchy_card_row_count', { count: hierarchyTableRecordItem.mappings.length, defaultValue: '共 {{count}} 列' })}</span> )} {isTreeCardCollapsedStatus && hierarchyTableProblemsList.length > 0 && ( <span style={{ fontSize: scaleFontSize(12), color: token.colorError, fontWeight: 'normal' }}><WarningOutlined /> {translate('step2.hierarchy_card_problem_count', { count: hierarchyTableProblemsList.length, defaultValue: '{{count}} 處需修正' })}</span> )} </Space> } extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeHierarchyTable(hierarchyTableRecordItem.id)} />} >
                                                    <div data-hierarchy-scroll={treeCardKeyStr} style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: HIERARCHY_SCROLL_BOX_MAX_HEIGHT, paddingBottom: '8px', marginBottom: '4px' }}>
                                                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', padding: '0 8px', position: 'sticky', top: 0, zIndex: 2, background: token.colorBgContainer }}>
                                                            <div style={{ flex: 1, minWidth: '10.5em', color: token.colorTextSecondary, fontSize: scaleFontSize(12) }}>
                                                                {translate('step2.original_value')}
                                                                <Tooltip title={translate('step2.original_value_tooltip', '請填入資料集中實際出現的原始值，須完全一致（含全形/半形、大小寫、空格）；不一致將視為未涵蓋此值，執行時會被取代成「*」。')}>
                                                                    <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help', fontSize: scaleFontSize(12) }} />
                                                                </Tooltip>
                                                            </div>
                                                            {Array.from({ length: columnCountCalculatedValue - 1 }).map((_, levelIndexLoopVar) => (
                                                                <div key={levelIndexLoopVar} style={{ flex: 1, minWidth: '10.5em', color: token.colorTextSecondary, fontSize: scaleFontSize(12) }}>
                                                                    {translate('step2.generalize_level', { level: levelIndexLoopVar + 1 })}
                                                                    <Tooltip title={translate('step2.generalize_level_tooltip', '欄位的「泛化層級」設定達到此層時，這個原始值會被取代成這裡填寫的較粗分類；建議層級越高，填寫越粗略的分類。')}>
                                                                        <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help', fontSize: scaleFontSize(12) }} />
                                                                    </Tooltip>
                                                                </div>
                                                            ))}
                                                            <div style={{ width: '4.5em' }}></div>
                                                        </div>

                                                        {hierarchyTableRecordItem.mappings.map(
                                                            (mappingRowArray, rowIndexNumber) =>
                                                            (
                                                                <div key={rowIndexNumber} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                                                    {Array.from({ length: columnCountCalculatedValue }).map((_, columnIndexNumber) => (
                                                                        <Input
                                                                            key={columnIndexNumber}
                                                                            style={{ flex: 1, minWidth: '10.5em' }}
                                                                            placeholder={columnIndexNumber === 0
                                                                                ? translate('step2.hierarchy_cell_placeholder_original', '原始值，如：大安區')
                                                                                : translate('step2.hierarchy_cell_placeholder_level', '較粗分類，如：臺北市')}
                                                                            value={mappingRowArray[columnIndexNumber] || ''}
                                                                            status={problemCellKeySet.has(`${rowIndexNumber}:${columnIndexNumber}`) ? 'error' : undefined}
                                                                            maxLength={HIERARCHY_CELL_MAX_LENGTH}
                                                                            onChange={(inputChangeEvent) => updateMappingCell(hierarchyTableRecordItem.id, rowIndexNumber, columnIndexNumber, inputChangeEvent.target.value)}
                                                                        />
                                                                    ))}
                                                                    <Space style={{ width: '4.5em', justifyContent: 'center' }}>
                                                                        <Popconfirm title={translate('step2.confirm_delete_row')} onConfirm={() => removeMappingRow(hierarchyTableRecordItem.id, rowIndexNumber)}> <Button type="text" size="small" icon={<DeleteOutlined style={{ color: token.colorTextDescription }} />} /> </Popconfirm>
                                                                        <Button type="primary" size="small" icon={<SaveOutlined />} />
                                                                    </Space>
                                                                </div>
                                                            )
                                                        )}
                                                    </div>

                                                    {hierarchyTableProblemsList.length > 0 && (
                                                        <div style={{ color: token.colorError, fontSize: scaleFontSize(12), margin: '0 0 4px' }}>
                                                            {hierarchyTableProblemsList.slice(0, 5).map((problemItem) => (
                                                                <div key={`${problemItem.kind}-${problemItem.rowNumber}`}>• {describeHierarchyRowProblem(problemItem, selectedTreeLevelValue)}</div>
                                                            ))}
                                                            {hierarchyTableProblemsList.length > 5 && <div>• …另有 {hierarchyTableProblemsList.length - 5} 處</div>}
                                                        </div>
                                                    )}
                                                    <Space size={4} wrap>
                                                        <Button type="link" icon={<PlusOutlined />} onClick={() => { addMappingRow(hierarchyTableRecordItem.id); scrollHierarchyBoxToBottom(treeCardKeyStr); }} style={{ paddingLeft: 0 }}>{translate('step2.btn_add_mapping')}</Button>
                                                        <Button type="link" icon={<PlusOutlined />} disabled={columnCountCalculatedValue - 1 >= MAX_HIERARCHY_LEVEL_COUNT} onClick={() => addHierarchyLevelColumn(hierarchyTableRecordItem.id)}>{translate('step2.btn_add_hierarchy_level', '新增泛化層級')}</Button>
                                                        {(() => {
                                                            const lastLevelHasValueStatus = hierarchyTableRecordItem.mappings.some(mappingRowArray => (mappingRowArray[columnCountCalculatedValue - 1] || '').trim() !== '');
                                                            const removeLevelButton = (
                                                                <Button type="link" danger icon={<MinusOutlined />} disabled={columnCountCalculatedValue <= MIN_HIERARCHY_COLUMN_COUNT} onClick={lastLevelHasValueStatus ? undefined : () => removeLastHierarchyLevelColumn(hierarchyTableRecordItem.id)}>
                                                                    {translate('step2.btn_remove_hierarchy_level', '移除最後一層')}
                                                                </Button>
                                                            );
                                                            return lastLevelHasValueStatus && columnCountCalculatedValue > MIN_HIERARCHY_COLUMN_COUNT
                                                                ? <Popconfirm title={translate('step2.confirm_remove_hierarchy_level', '最後一層已有填寫內容，確定要移除？')} onConfirm={() => removeLastHierarchyLevelColumn(hierarchyTableRecordItem.id)}>{removeLevelButton}</Popconfirm>
                                                                : removeLevelButton;
                                                        })()}
                                                    </Space>
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
    );
}