/**
 * ============================================================================
 * 檔案名稱 (File): Step2_Mapping.tsx
 * 模組功能 (Description): 去識別化工作流第二步：資料預先處理與脫敏技術映射組件 (提供清洗策略對應、即時字串預覽，並依據隱私模式載入 K-Anonymity 或 DP 子組件)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消除單字元變數、明確化參數與常數命名)
 * ============================================================================
 */

import React from 'react';
import { Card, Table, Select, Input, InputNumber, Button, Typography, theme, Space, Alert, Tooltip } from 'antd';
import { ToolOutlined, SafetyOutlined, ArrowRightOutlined, LockOutlined, PlusCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import CryptoJS from 'crypto-js';

import { useWorkspaceStore, type PreprocessingRule, type MissingValueRule } from '../../store/useWorkspaceStore';
import { useAuthStore } from '../../store/useAuthStore';

import KAnonymityMapping from './KAnonymityMapping';
import DifferentialPrivacyMapping from './DifferentialPrivacyMapping';

const { Text } = Typography;

/**
 * 魔術數字與預設常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const DEFAULT_PREVIEW_SYMBOL = '-';
const HASH_PREVIEW_LENGTH = 16;
const FULLWIDTH_CHAR_CODE_OFFSET = 0xFEE0;   // 全形字元 (！~～) 與對應半形字元間之 Unicode 編碼差值
const FULLWIDTH_SPACE_CHAR_CODE = 0x3000;    // 全形空白字元碼
const DEFAULT_CLAMP_LOWER_BOUND = 0;
const DEFAULT_CLAMP_UPPER_BOUND = 100;
const DEFAULT_SLICE_COUNT = 1;
const DEFAULT_ANCHOR_KEEP_COUNT = 0;

/**
 * 預處理表格對應紀錄資料結構
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface MappingRecord
{
    key: string;                     // 表格列唯一鍵值 (欄位名稱)
    name: string;                    // 欄位名稱
    steps: PreprocessingRule[];      // 該欄位依序執行之預處理策略清單 (至少 1 筆，由上而下依序套用)
    missingValueRule: MissingValueRule; // 該欄位之缺失值處理規則 (與 steps 互斥並存)
    sampleValue: string;             // 預覽樣本數據數值
}

// 欄位尚未設定任何策略時之預設策略清單 (符合規範 e) 避免使用不易理解之數字/字面量)
const DEFAULT_PREPROCESS_STEP_LIST: PreprocessingRule[] = [{ action: 'none', params: {} }];
const DEFAULT_MISSING_VALUE_RULE: MissingValueRule = { strategy: 'none' };

/**
 * 函數名稱: applyPreprocessStep
 * 函數功能: 依據選定之單一動作與參數集合，對字串執行對應之預處理轉換 (字串去空白、截斷、相對保留與
 *           截斷、型態轉換、文字正規化、上下界截斷、雜湊或正則掃描與替換)。
 *
 * 輸入參數 (Input):
 *   - cellValueStr (string): 待處理之字串數值
 *   - stepItemRecord (PreprocessingRule): 單一預處理步驟 (動作代碼與其參數集合)
 * 返回值 (Return):
 *   - string: 經過該步驟轉換後之字串結果
 * 呼叫關係 (Call Relations): 由 applyPreprocessSteps 依序呼叫，組成完整轉換鏈
 *
 * 規範對照: 符合規範 a), c) 使用清晰明確之變數名稱
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

            if (!anchorCharStr) return cellValueStr; // 未設定錨點字元，視同不執行

            const anchorIndexNum = anchorDirectionStr === 'front' ? cellValueStr.indexOf(anchorCharStr) : cellValueStr.lastIndexOf(anchorCharStr);

            if (anchorIndexNum === -1) return cellValueStr; // 找不到錨點字元，不執行任何動作

            if (keepCountNum === 0) return ''; // 總保留字數為 0，僅保留錨點且不含任何鄰近字元時視同全部截斷

            const extraKeepCountNum = keepCountNum - 1; // 總保留字數含錨點本身，鄰近字元數需扣除錨點的 1 個字

            if (anchorDirectionStr === 'front')
            {
                // 前方：由前往後搜尋首個錨點，僅保留錨點前緊鄰字元 (含錨點本身，總計 N 字)，其餘字元 (含錨點後方) 全數截斷
                const frontPartStr = cellValueStr.slice(Math.max(0, anchorIndexNum - extraKeepCountNum), anchorIndexNum);
                return frontPartStr + anchorCharStr;
            }

            // 後方：從後搜尋首個錨點，僅保留錨點後緊鄰字元 (含錨點本身，總計 N 字)，其餘字元 (含錨點前方) 全數截斷
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

                // 為了 UI 預覽美觀，擷取前 16 碼並加上刪節號
                return calculatedHashResult.substring(0, HASH_PREVIEW_LENGTH) + '...';
            }
            catch (hashingErrorExecution)
            {
                console.error('Hashing execution error:', hashingErrorExecution);
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
                return cellValueStr; // 無效正則表達式，維持原樣
            }
        }

        default:
            return cellValueStr; // 'none' 或未知動作代碼，不執行任何轉換
    }
};

/**
 * 函數名稱: applyPreprocessSteps
 * 函數功能: 依序套用同一欄位之多道預處理策略 (由上而下)，上一步驟之輸出即為下一步驟之輸入，
 *           以支援單一欄位需要組合多種清洗手法的情境 (如先去除前後空白，再擷取特定字元前之文字)。
 *
 * 輸入參數 (Input):
 *   - cellValueData (unknown): 原始資料儲存格數值
 *   - stepsArray (PreprocessingRule[]): 依序執行之預處理策略清單
 * 返回值 (Return):
 *   - string: 依序套用所有策略後之最終字串結果
 * 呼叫關係 (Call Relations): 於即時預覽欄位呈現時被呼叫
 */
const applyPreprocessSteps = (cellValueData: unknown, stepsArray: PreprocessingRule[]): string =>
{
    if (cellValueData == null || cellValueData === '')
    {
        return DEFAULT_PREVIEW_SYMBOL;
    }

    return stepsArray.reduce(
        (accumulatedResultString, stepItemRecord) => applyPreprocessStep(accumulatedResultString, stepItemRecord),
        String(cellValueData)
    );
};

/**
 * 函數名稱: Step2_Mapping
 * 函數功能: 渲染步驟二主頁面，提供第一階段「資料預先處理」表格設定，並依據模式切換第二階段之 K-Anonymity 或 Differential Privacy 映射子組件。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 步驟二 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被主流程 Step 精靈組件載入渲染
 *   - 訂閱用 useAuthStore 判斷 Data Owner 編輯權限，用 useWorkspaceStore 讀寫全域預處理規則
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function Step2_Mapping(): React.ReactElement 
{
    const { token } = theme.useToken();
    
    // 深色主題狀態判定 (符合規範 g)
    const isDarkModeActive = token.colorBgContainer !== '#ffffff';

    const { t: translate } = useTranslation();

    // 從 AuthStore 取得當前使用者角色並判斷規則編輯權限 (符合規範 g, i)
    const currentUserSession = useAuthStore(
        (state) => state.user
    );

    const isUserAllowedToEditRulesStatus = currentUserSession?.role === 'data_owner'; // 僅 Data Owner 擁有規則修改權限

    // 從 WorkspaceStore 讀取數據與預處理規則 (符合規範 g, i)
    const currentPrivacyMode = useWorkspaceStore(
        (state) => state.privacyMode
    );

    const datasetColumnsList = useWorkspaceStore(
        (state) => state.columns
    );

    const previewDataRowsList = useWorkspaceStore(
        (state) => state.previewData
    );

    const preprocessingRulesMap = useWorkspaceStore(
        (state) => state.preprocessingRules
    ) || {};

    const setPreprocessingRulesAction = useWorkspaceStore(
        (state) => state.setPreprocessingRules
    );

    const missingValueRulesMap = useWorkspaceStore(
        (state) => state.missingValueRules
    ) || {};

    const setMissingValueRulesAction = useWorkspaceStore(
        (state) => state.setMissingValueRules
    );

    /**
     * 函數名稱: getFieldPreprocessSteps
     * 函數功能: 取得指定欄位目前之預處理策略清單；若該欄位尚未設定任何策略，則退回僅含一筆「不處理」之預設清單。
     */
    const getFieldPreprocessSteps = (targetColumnNameStr: string): PreprocessingRule[] =>
    {
        const existingStepsArray = preprocessingRulesMap[targetColumnNameStr];
        return existingStepsArray && existingStepsArray.length > 0 ? existingStepsArray : DEFAULT_PREPROCESS_STEP_LIST;
    };

    /**
     * 函數名稱: getFieldMissingValueRule
     * 函數功能: 取得指定欄位目前之缺失值處理規則；若尚未設定，則退回「不處理」。
     */
    const getFieldMissingValueRule = (targetColumnNameStr: string): MissingValueRule =>
        missingValueRulesMap[targetColumnNameStr] || DEFAULT_MISSING_VALUE_RULE;

    /**
     * 預處理動作參數欄位定義 (依動作種類決定所需之控制項類型與預設值)
     * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
     */
    type PreprocessParamFieldDef =
        | { key: string; type: 'select'; label: string; defaultValue: string; options: { value: string; label: string }[]; visibleWhen?: (paramsDict: Record<string, string | number>) => boolean; required?: boolean }
        | { key: string; type: 'number'; label: string; defaultValue: number; min?: number; visibleWhen?: (paramsDict: Record<string, string | number>) => boolean; required?: boolean }
        | { key: string; type: 'text'; label: string; defaultValue: string; maxLength?: number; visibleWhen?: (paramsDict: Record<string, string | number>) => boolean; required?: boolean };

    interface PreprocessActionDef
    {
        value: string;
        label: string;
        paramFields: PreprocessParamFieldDef[];
    }

    // 可用預處理動作清單 (符合規範 e) 避免使用不易理解之數字/字面量)
    const preprocessActionDefList: PreprocessActionDef[] = [
        { value: 'none', label: translate('step2.action_none', '不處理'), paramFields: [] },
        {
            value: 'trim',
            label: translate('step2.action_trim', '字串去空白'),
            paramFields: [
                {
                    key: 'mode', type: 'select', label: translate('step2.param_trim_mode', '去除範圍'), defaultValue: 'edges',
                    options: [
                        { value: 'edges', label: translate('step2.trim_mode_edges', '僅移除前後') },
                        { value: 'all', label: translate('step2.trim_mode_all', '全部移除') }
                    ]
                }
            ]
        },
        {
            value: 'slice',
            label: translate('step2.action_slice', '字串截斷'),
            paramFields: [
                {
                    key: 'direction', type: 'select', label: translate('step2.param_slice_direction', '刪除方向'), defaultValue: 'left',
                    options: [
                        { value: 'left', label: translate('step2.slice_direction_left', '開頭 (左側)') },
                        { value: 'right', label: translate('step2.slice_direction_right', '結尾 (右側)') }
                    ]
                },
                { key: 'count', type: 'number', label: translate('step2.param_slice_count', '刪除字元數'), defaultValue: DEFAULT_SLICE_COUNT, min: 1 }
            ]
        },
        {
            value: 'anchor_truncate',
            label: translate('step2.action_anchor_truncate', '相對保留與截斷'),
            paramFields: [
                { key: 'anchor', type: 'text', label: translate('step2.param_anchor_char', '鎖定字元'), defaultValue: '', maxLength: 1, required: true },
                {
                    key: 'direction', type: 'select', label: translate('step2.param_anchor_direction', '處理方向'), defaultValue: 'front',
                    options: [
                        { value: 'front', label: translate('step2.anchor_direction_front', '前方') },
                        { value: 'back', label: translate('step2.anchor_direction_back', '後方') }
                    ]
                },
                { key: 'keepCount', type: 'number', label: translate('step2.param_keep_count', '總保留字數'), defaultValue: DEFAULT_ANCHOR_KEEP_COUNT, min: 0 }
            ]
        },
        {
            value: 'type_cast',
            label: translate('step2.action_type_cast', '型態轉換'),
            paramFields: [
                {
                    key: 'targetType', type: 'select', label: translate('step2.param_target_type', '目標型態'), defaultValue: 'integer',
                    options: [
                        { value: 'integer', label: translate('step2.type_integer', '整數') },
                        { value: 'float', label: translate('step2.type_float', '浮點數') },
                        { value: 'boolean', label: translate('step2.type_boolean', '布林') }
                    ]
                }
            ]
        },
        {
            value: 'normalize',
            label: translate('step2.action_normalize', '文字正規化'),
            paramFields: [
                {
                    key: 'caseMode', type: 'select', label: translate('step2.param_case_mode', '大小寫'), defaultValue: 'none',
                    options: [
                        { value: 'none', label: translate('step2.case_mode_none', '不轉換') },
                        { value: 'upper', label: translate('step2.case_mode_upper', '全大寫') },
                        { value: 'lower', label: translate('step2.case_mode_lower', '全小寫') }
                    ]
                },
                {
                    key: 'widthMode', type: 'select', label: translate('step2.param_width_mode', '全形/半形'), defaultValue: 'none',
                    options: [
                        { value: 'none', label: translate('step2.width_mode_none', '不轉換') },
                        { value: 'full_to_half', label: translate('step2.width_mode_full_to_half', '全形轉半形') }
                    ]
                }
            ]
        },
        {
            value: 'clamp',
            label: translate('step2.action_clamp', '上下界截斷'),
            paramFields: [
                { key: 'min', type: 'number', label: translate('step2.param_clamp_min', '下限'), defaultValue: DEFAULT_CLAMP_LOWER_BOUND },
                { key: 'max', type: 'number', label: translate('step2.param_clamp_max', '上限'), defaultValue: DEFAULT_CLAMP_UPPER_BOUND }
            ]
        },
        {
            value: 'hash',
            label: translate('step2.action_hash', '雜湊 (Hash)'),
            paramFields: [
                {
                    key: 'algorithm', type: 'select', label: translate('step2.param_hash_algorithm', '演算法'), defaultValue: 'sha256',
                    options: [
                        { value: 'sha256', label: 'SHA-256' },
                        { value: 'md5', label: 'MD5' },
                        { value: 'sha512', label: 'SHA-512' }
                    ]
                },
                {
                    key: 'seedMode', type: 'select', label: translate('step2.param_hash_seed_mode', '隨機種子'), defaultValue: 'none',
                    options: [
                        { value: 'none', label: translate('step2.hash_seed_none', '不使用') },
                        { value: 'fixed', label: translate('step2.hash_seed_fixed', '固定種子') },
                        { value: 'timestamp', label: translate('step2.hash_seed_timestamp', '目前時間戳') }
                    ]
                },
                { key: 'seedValue', type: 'text', label: translate('step2.param_hash_seed_value', '種子值'), defaultValue: '', visibleWhen: (paramsDict) => paramsDict.seedMode === 'fixed', required: true }
            ]
        },
        {
            value: 'regex_replace',
            label: translate('step2.action_regex_replace', '正則掃描與替換'),
            paramFields: [
                { key: 'pattern', type: 'text', label: translate('step2.param_regex_pattern', '正則表達式'), defaultValue: '', required: true },
                { key: 'placeholder', type: 'text', label: translate('step2.param_regex_placeholder', '替換為'), defaultValue: '***' }
            ]
        }
    ];

    // 缺失值處理策略選項清單與策略填充之方法選項清單 (符合規範 e)
    const missingValueStrategyOptionList = [
        { value: 'none', label: translate('step2.missing_none', '不處理') },
        { value: 'drop', label: translate('step2.missing_drop', '丟棄缺失值') },
        { value: 'constant', label: translate('step2.missing_constant', '常數填充') },
        { value: 'fill', label: translate('step2.missing_fill', '策略填充') }
    ];

    const fillMethodOptionList: { value: NonNullable<MissingValueRule['fillMethod']>; label: string }[] = [
        { value: 'forward', label: translate('step2.fill_forward', '前值填充') },
        { value: 'backward', label: translate('step2.fill_backward', '後值填充') },
        { value: 'interpolate', label: translate('step2.fill_interpolate', '內插法') },
        { value: 'mean', label: translate('step2.fill_mean', '平均值') }
    ];

    /**
     * 函數名稱: handleStepActionChange
     * 函數功能: 變更指定欄位、指定步驟之預處理動作，並將該動作之所有參數重設為預設值。
     */
    const handleStepActionChange = (targetColumnNameStr: string, targetStepIndexNumber: number, newActionValueStr: string): void =>
    {
        if (!isUserAllowedToEditRulesStatus) return;

        const matchedActionDef = preprocessActionDefList.find((actionDefItem) => actionDefItem.value === newActionValueStr);
        const defaultParamsDict: Record<string, string | number> = {};
        matchedActionDef?.paramFields.forEach((paramFieldDefItem) => { defaultParamsDict[paramFieldDefItem.key] = paramFieldDefItem.defaultValue; });

        const updatedStepsArray = getFieldPreprocessSteps(targetColumnNameStr).map(
            (stepItemRecord, stepIndexNumber) => stepIndexNumber === targetStepIndexNumber ? { action: newActionValueStr, params: defaultParamsDict } : stepItemRecord
        );

        setPreprocessingRulesAction({ ...preprocessingRulesMap, [targetColumnNameStr]: updatedStepsArray });
    };

    /**
     * 函數名稱: handleStepParamChange
     * 函數功能: 變更指定欄位、指定步驟之單一參數數值，並即時更新至全域 WorkspaceStore。
     */
    const handleStepParamChange = (targetColumnNameStr: string, targetStepIndexNumber: number, paramKeyStr: string, newParamValueData: string | number): void =>
    {
        if (!isUserAllowedToEditRulesStatus) return;

        const updatedStepsArray = getFieldPreprocessSteps(targetColumnNameStr).map(
            (stepItemRecord, stepIndexNumber) => stepIndexNumber === targetStepIndexNumber ? { ...stepItemRecord, params: { ...stepItemRecord.params, [paramKeyStr]: newParamValueData } } : stepItemRecord
        );

        setPreprocessingRulesAction({ ...preprocessingRulesMap, [targetColumnNameStr]: updatedStepsArray });
    };

    /**
     * 函數名稱: handleAddPreprocessStep
     * 函數功能: 為指定欄位新增一道預設之「不處理」策略，附加於現有策略清單末端 (依由上而下順序依序執行)。
     */
    const handleAddPreprocessStep = (targetColumnNameStr: string): void =>
    {
        if (!isUserAllowedToEditRulesStatus)
        {
            return;
        }

        setPreprocessingRulesAction({
            ...preprocessingRulesMap,
            [targetColumnNameStr]: [...getFieldPreprocessSteps(targetColumnNameStr), { action: 'none', params: {} }]
        });
    };

    /**
     * 函數名稱: handleRemovePreprocessStep
     * 函數功能: 移除指定欄位之特定策略步驟；欄位至少須保留一筆策略，故僅剩一筆時不允許移除。
     */
    const handleRemovePreprocessStep = (targetColumnNameStr: string, targetStepIndexNumber: number): void =>
    {
        if (!isUserAllowedToEditRulesStatus)
        {
            return;
        }

        const currentStepsArray = getFieldPreprocessSteps(targetColumnNameStr);

        if (currentStepsArray.length <= 1)
        {
            return;
        }

        setPreprocessingRulesAction({
            ...preprocessingRulesMap,
            [targetColumnNameStr]: currentStepsArray.filter((_, stepIndexNumber) => stepIndexNumber !== targetStepIndexNumber)
        });
    };

    /**
     * 函數名稱: handleMissingValueStrategyChange
     * 函數功能: 變更指定欄位之缺失值處理策略；切換為「常數填充」或「策略填充」時，一併帶入該策略之預設參數。
     */
    const handleMissingValueStrategyChange = (targetColumnNameStr: string, newStrategyValueStr: string): void =>
    {
        if (!isUserAllowedToEditRulesStatus) return;

        const newStrategyTypedValue = newStrategyValueStr as MissingValueRule['strategy'];
        const nextMissingValueRule: MissingValueRule = { strategy: newStrategyTypedValue };

        if (newStrategyTypedValue === 'constant') nextMissingValueRule.constantValue = '';
        if (newStrategyTypedValue === 'fill') nextMissingValueRule.fillMethod = 'mean';

        setMissingValueRulesAction({ ...missingValueRulesMap, [targetColumnNameStr]: nextMissingValueRule });
    };

    /**
     * 函數名稱: handleMissingValueParamChange
     * 函數功能: 變更指定欄位缺失值處理規則之附加參數 (常數值或填充方法)。
     */
    const handleMissingValueParamChange = (targetColumnNameStr: string, paramKeyStr: 'constantValue' | 'fillMethod', newParamValueStr: string): void =>
    {
        if (!isUserAllowedToEditRulesStatus) return;

        setMissingValueRulesAction({
            ...missingValueRulesMap,
            [targetColumnNameStr]: { ...getFieldMissingValueRule(targetColumnNameStr), [paramKeyStr]: newParamValueStr }
        });
    };

    // 轉換 Ant Design Table 呈現用之數據清單 (符合規範 g)
    const mappingTableDataList: MappingRecord[] = datasetColumnsList.map(
        (columnNameString) =>
        (
            {
                key: columnNameString,
                name: columnNameString,
                steps: getFieldPreprocessSteps(columnNameString),
                missingValueRule: getFieldMissingValueRule(columnNameString),
                sampleValue: previewDataRowsList.length > 0 ? String(previewDataRowsList[0][columnNameString] || DEFAULT_PREVIEW_SYMBOL) : DEFAULT_PREVIEW_SYMBOL
            }
        )
    );

    /**
     * 函數名稱: renderPreprocessParamControl
     * 函數功能: 依據參數欄位定義之類型 (select／number／text)，渲染對應之表單控制項。
     */
    const renderPreprocessParamControl = (paramFieldDefItem: PreprocessParamFieldDef, currentParamsDict: Record<string, string | number>, onValueChange: (newValueData: string | number) => void): React.ReactElement =>
    {
        if (paramFieldDefItem.type === 'select')
        {
            return (
                <Select
                    size="small"
                    value={String(currentParamsDict[paramFieldDefItem.key] ?? paramFieldDefItem.defaultValue)}
                    onChange={(selectedValueStr) => onValueChange(selectedValueStr)}
                    disabled={!isUserAllowedToEditRulesStatus}
                    placeholder={paramFieldDefItem.label}
                    style={{ width: '100%' }}
                    options={paramFieldDefItem.options}
                />
            );
        }

        if (paramFieldDefItem.type === 'number')
        {
            return (
                <InputNumber
                    size="small"
                    value={Number(currentParamsDict[paramFieldDefItem.key] ?? paramFieldDefItem.defaultValue)}
                    onChange={(inputNumberValue) => onValueChange(inputNumberValue ?? paramFieldDefItem.defaultValue)}
                    disabled={!isUserAllowedToEditRulesStatus}
                    min={paramFieldDefItem.min}
                    placeholder={paramFieldDefItem.label}
                    style={{ width: '100%' }}
                />
            );
        }

        const currentTextValueStr = String(currentParamsDict[paramFieldDefItem.key] ?? paramFieldDefItem.defaultValue);
        const hasRequiredValueMissingStatus = Boolean(paramFieldDefItem.required) && currentTextValueStr.trim() === '';

        return (
            <Input
                size="small"
                value={currentTextValueStr}
                onChange={(inputChangeEvent) => onValueChange(inputChangeEvent.target.value)}
                disabled={!isUserAllowedToEditRulesStatus}
                maxLength={paramFieldDefItem.maxLength}
                placeholder={paramFieldDefItem.label}
                status={hasRequiredValueMissingStatus ? 'error' : undefined}
                style={{ width: '100%' }}
            />
        );
    };

    // 第一階段預處理表格欄位定義 (符合規範 g, h)
    const preprocessTableColumnsConfig = [
        {
            title: translate('step2.col_name', '欄位名稱'),
            dataIndex: 'name',
            width: '12%',
            render: (fieldNameTextValue: string) => <Text strong>{fieldNameTextValue}</Text>
        },
        {
            title: translate('step2.missing_value_handling', '缺失值處理'),
            dataIndex: 'missingValueRule',
            width: '15%',
            render: (_: unknown, rowRecordItem: MappingRecord) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Select
                        size="small"
                        value={rowRecordItem.missingValueRule.strategy}
                        onChange={(selectedStrategyStr) => handleMissingValueStrategyChange(rowRecordItem.name, selectedStrategyStr)}
                        disabled={!isUserAllowedToEditRulesStatus}
                        style={{ width: '100%' }}
                        options={missingValueStrategyOptionList}
                    />

                    {rowRecordItem.missingValueRule.strategy === 'constant' && (
                        <Input
                            size="small"
                            value={rowRecordItem.missingValueRule.constantValue ?? ''}
                            onChange={(inputChangeEvent) => handleMissingValueParamChange(rowRecordItem.name, 'constantValue', inputChangeEvent.target.value)}
                            disabled={!isUserAllowedToEditRulesStatus}
                            placeholder={translate('step2.missing_constant_placeholder', '填入之預設值')}
                            style={{ width: '100%' }}
                        />
                    )}

                    {rowRecordItem.missingValueRule.strategy === 'fill' && (
                        <Select
                            size="small"
                            value={rowRecordItem.missingValueRule.fillMethod ?? 'mean'}
                            onChange={(selectedFillMethodStr) => handleMissingValueParamChange(rowRecordItem.name, 'fillMethod', selectedFillMethodStr)}
                            disabled={!isUserAllowedToEditRulesStatus}
                            style={{ width: '100%' }}
                            options={fillMethodOptionList}
                        />
                    )}
                </div>
            )
        },
        {
            title: translate('step2.clean_strategy', 'Cleansing Strategy'),
            dataIndex: 'steps',
            width: '22%',
            render: (_: unknown, rowRecordItem: MappingRecord) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rowRecordItem.steps.map(
                        (stepItemRecord, stepIndexNumber) => (
                            <div key={stepIndexNumber} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Select
                                    value={stepItemRecord.action}
                                    onChange={(selectedDropdownAction) => handleStepActionChange(rowRecordItem.name, stepIndexNumber, selectedDropdownAction)}
                                    disabled={!isUserAllowedToEditRulesStatus}
                                    style={{ flex: 1, minWidth: 0 }}
                                    options={preprocessActionDefList.map((actionDefItem) => ({ value: actionDefItem.value, label: actionDefItem.label }))}
                                />

                                {isUserAllowedToEditRulesStatus && stepIndexNumber === rowRecordItem.steps.length - 1 && (
                                    <Tooltip title={translate('step2.add_strategy_step', '新增策略 (依序執行)')}>
                                        <Button type="text" size="small" icon={<PlusCircleOutlined />} onClick={() => handleAddPreprocessStep(rowRecordItem.name)} />
                                    </Tooltip>
                                )}

                                {isUserAllowedToEditRulesStatus && rowRecordItem.steps.length > 1 && (
                                    <Tooltip title={translate('step2.remove_strategy_step', '移除此策略')}>
                                        <Button type="text" size="small" danger icon={<MinusCircleOutlined />} onClick={() => handleRemovePreprocessStep(rowRecordItem.name, stepIndexNumber)} />
                                    </Tooltip>
                                )}
                            </div>
                        )
                    )}
                </div>
            )
        },
        {
            title: translate('step2.param_setting', 'Parameter Setting'),
            dataIndex: 'steps',
            width: '26%',
            render: (_: unknown, rowRecordItem: MappingRecord) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rowRecordItem.steps.map(
                        (stepItemRecord, stepIndexNumber) =>
                        {
                            const matchedActionDef = preprocessActionDefList.find((actionDefItem) => actionDefItem.value === stepItemRecord.action);
                            const visibleParamFieldList = (matchedActionDef?.paramFields ?? []).filter((paramFieldDefItem) => !paramFieldDefItem.visibleWhen || paramFieldDefItem.visibleWhen(stepItemRecord.params));

                            if (visibleParamFieldList.length === 0)
                            {
                                return <div key={stepIndexNumber} style={{ height: 24, display: 'flex', alignItems: 'center', color: token.colorTextDescription }}>{DEFAULT_PREVIEW_SYMBOL}</div>;
                            }

                            return (
                                <Space key={stepIndexNumber} size={4} wrap style={{ width: '100%' }}>
                                    {visibleParamFieldList.map(
                                        (paramFieldDefItem) => (
                                            <div key={paramFieldDefItem.key} style={{ width: 110 }}>
                                                {renderPreprocessParamControl(
                                                    paramFieldDefItem,
                                                    stepItemRecord.params,
                                                    (newValueData) => handleStepParamChange(rowRecordItem.name, stepIndexNumber, paramFieldDefItem.key, newValueData)
                                                )}
                                            </div>
                                        )
                                    )}
                                </Space>
                            );
                        }
                    )}
                </div>
            )
        },
        {
            title: translate('step2.live_preview', '即時預覽 (取首筆資料)'),
            key: 'preview',
            width: '25%',
            render: (_: unknown, rowRecordItem: MappingRecord) =>
            {
                const originalSampleTextValue = rowRecordItem.sampleValue;
                const isSampleValueMissingStatus = originalSampleTextValue === DEFAULT_PREVIEW_SYMBOL;

                if (isSampleValueMissingStatus && rowRecordItem.missingValueRule.strategy !== 'none')
                {
                    const missingStrategyStr = rowRecordItem.missingValueRule.strategy;
                    let missingPreviewTextStr: string;

                    if (missingStrategyStr === 'drop') missingPreviewTextStr = translate('step2.missing_preview_drop', '（整列將被移除）');
                    else if (missingStrategyStr === 'constant') missingPreviewTextStr = rowRecordItem.missingValueRule.constantValue || DEFAULT_PREVIEW_SYMBOL;
                    else missingPreviewTextStr = translate('step2.missing_preview_fill', '（依全數據動態計算，後端處理階段套用）');

                    return (
                        <Space style={{ display: 'flex', flexWrap: 'wrap' }}>
                            <Text type="secondary" delete>{originalSampleTextValue}</Text>
                            <ArrowRightOutlined style={{ color: token.colorWarning, fontSize: 12 }} />
                            <Text style={{ color: token.colorWarning, fontWeight: 600 }}>{missingPreviewTextStr}</Text>
                        </Space>
                    );
                }

                const processedSampleTextValue = applyPreprocessSteps(originalSampleTextValue, rowRecordItem.steps);

                const isContentModifiedStatus = originalSampleTextValue !== processedSampleTextValue;

                return (
                    <Space style={{ display: 'flex', flexWrap: 'wrap' }}>
                        <Text type="secondary" delete={isContentModifiedStatus}>{originalSampleTextValue}</Text>
                        {isContentModifiedStatus && <ArrowRightOutlined style={{ color: token.colorPrimary, fontSize: 12 }} />}
                        {isContentModifiedStatus && <Text style={{ color: token.colorPrimary, fontWeight: 600 }}>{processedSampleTextValue}</Text>}
                    </Space>
                );
            }
        }
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* 唯讀模式警示 Banner */}
            {!isUserAllowedToEditRulesStatus && (
                <Alert type="info" showIcon icon={<LockOutlined />} title="唯讀保護模式 (Read-Only Mode)" description="當前角色無權限修改欄位屬性與預先處理規則。畫面設定已全數鎖定，僅供瀏覽與預覽。" />
            )}

            {/* 第一階段：資料預先處理 */}
            <Card 
                title={<span style={{ fontWeight: 600 }}><ToolOutlined style={{ marginRight: 8, color: token.colorPrimary }} /> {translate('step2.stage1_title', '第一階段：資料預先處理 (選填)')}</span>}
                variant="borderless" 
                style={{ background: token.colorBgContainer, padding: 0 }}
                styles={{ body: { padding: '16px' } }}
            >
                <Table dataSource={mappingTableDataList} columns={preprocessTableColumnsConfig} pagination={false} size="small" bordered={false} rowKey="key" scroll={{ y: 250 }} style={{ background: isDarkModeActive ? '#141414' : '#fafafa', borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}` }} />
            </Card>

            {/* 第二階段：隱私強化技術設定 */}
            <Card 
                title={<span style={{ fontWeight: 600 }}><SafetyOutlined style={{ marginRight: 8, color: '#52c41a' }} /> {currentPrivacyMode === 'k-anonymity' ? translate('step2.stage2_title_k', '第二階段：隱私強化技術設定 (K-匿名化)') : translate('step2.stage2_title_dp', '第二階段：隱私強化技術設定 (差分隱私)')}</span>}
                variant="borderless" 
                style={{ background: token.colorBgContainer }}
                styles={{ body: { padding: 0 } }} 
            >
                {currentPrivacyMode === 'k-anonymity' ? <KAnonymityMapping /> : <DifferentialPrivacyMapping />}
            </Card>

            {/* 表格樣式覆寫 */}
            <style>{`.ant-table-thead > tr > th { background: ${isDarkModeActive ? '#262626' : '#f0f2f5'} !important; }`}</style>
        </div>
    );
}