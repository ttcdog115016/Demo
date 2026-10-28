/**
 * ============================================================================
 * 檔案名稱 (File): Step2_Mapping.tsx
 * 模組功能 (Description): 去識別化工作流第二步：資料預先處理與脫敏技術映射組件 (提供清洗策略對應、即時字串預覽，並依據隱私模式載入 K-Anonymity 或 DP 子組件)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消除單字元變數、明確化參數與常數命名)
 * ============================================================================
 */

import React, { useEffect, useRef, useState } from 'react';
import { Card, Table, Input, InputNumber, Button, Typography, theme, Space, Alert, Tooltip } from 'antd';
import { ToolOutlined, SafetyOutlined, ArrowRightOutlined, LockOutlined, PlusOutlined, MinusCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore, type PreprocessingRule, type MissingValueRule } from '../../store/useWorkspaceStore';
import { applyPreprocessSteps } from '../../utils/preprocessSteps';
import { normalizePreprocessHashAlgorithm, DEFAULT_PREPROCESS_HASH_ALGORITHM } from '../../utils/preprocessConfig';
import { useEnsureDatasetProfile } from '../../utils/datasetProfile';
import { pickPreviewSampleValue, countMissingInPreviewRows } from '../../utils/preprocessPreviewSample';
import { scrollTableRowIntoView } from '../../utils/tableRowScroll';
import { useAuthStore } from '../../store/useAuthStore';

import KAnonymityMapping from './KAnonymityMapping';
import AdaptivePopupSelect, { type DropdownPopupMode } from './AdaptivePopupSelect';
import DifferentialPrivacyMapping from './DifferentialPrivacyMapping';

import { scaleFontSize } from '../../utils/fontScale';
const { Text } = Typography;

/**
 * 魔術數字與預設常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const DEFAULT_PREVIEW_SYMBOL = '-';
const DEFAULT_CLAMP_LOWER_BOUND = 0;
const DEFAULT_CLAMP_UPPER_BOUND = 100;
const DEFAULT_SLICE_COUNT = 1;
const DEFAULT_ANCHOR_KEEP_COUNT = 0;

/**
 * 表格下拉選單展開方式規則 (2026-10-07 調整，元件實作見 AdaptivePopupSelect.tsx)
 * 共通: 選單一律掛載於表格內部捲動區內，只在表格範圍內顯示，不會蓋到表格以外的版面。
 * - 欄位數 ≤ COMPACT_TABLE_MAX_ROW_COUNT (5)：「精簡模式」—— 表格捲動區保留固定最小高度
 *   (PREPROCESS_TABLE_SCROLL_HEIGHT_PX) 作為選單空間；開啟選單時即時量測上下方空間，
 *   往空間大的一側展開，清單高度不超過該空間 (選項過多時於選單內捲動)。
 * - 欄位數 > 5：倒數 DROPDOWN_UPWARD_TAIL_ROW_COUNT (5) 列向上展開，其餘向下展開；
 *   但該列上方不足 DROPDOWN_UPWARD_MIN_ROWS_ABOVE (3) 列時 (例如欄位數為 6、7 時
 *   最上面幾列)，上方空間不夠放選單，仍維持向下展開。
 */
const COMPACT_TABLE_MAX_ROW_COUNT = 5;
const DROPDOWN_UPWARD_TAIL_ROW_COUNT = 5;
const DROPDOWN_UPWARD_MIN_ROWS_ABOVE = 3;
const PREPROCESS_TABLE_SCROLL_HEIGHT_PX = 520; // ★ 2026-10-08 使用者反映表格偏矮（多步驟時要一直捲動），由 250 調高為 520

/**
 * 函數名稱: resolveDropdownPopupModeForRow
 * 函數功能: 依列索引與總列數決定該列下拉選單之展開方式。
 */
const resolveDropdownPopupModeForRow = (rowIndexNumber: number, totalRowCount: number): DropdownPopupMode =>
{
    if (totalRowCount <= COMPACT_TABLE_MAX_ROW_COUNT)
    {
        return 'compact';
    }
    const isTailRowStatus = rowIndexNumber >= totalRowCount - DROPDOWN_UPWARD_TAIL_ROW_COUNT;
    const hasEnoughRowsAboveStatus = rowIndexNumber >= DROPDOWN_UPWARD_MIN_ROWS_ABOVE;
    return isTailRowStatus && hasEnoughRowsAboveStatus ? 'topLeft' : 'bottomLeft';
};

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
    sampleValue: string;             // 預覽樣本數據數值（★ 2026-10-07：改取該欄第一個非空值，不再固定取第一筆）
    missingCount: number;            // 該欄空值筆數（有完整資料統計時為全量，否則為預覽樣本內的筆數）
    isMissingCountFromFullData: boolean; // missingCount 是否為全量資料統計
    dropdownPopupMode: DropdownPopupMode; // 該列下拉選單展開方式 (見 resolveDropdownPopupModeForRow)
}

// 欄位尚未設定任何策略時之預設策略清單 (符合規範 e) 避免使用不易理解之數字/字面量)
const DEFAULT_PREPROCESS_STEP_LIST: PreprocessingRule[] = [{ action: 'none', params: {} }];
const DEFAULT_MISSING_VALUE_RULE: MissingValueRule = { strategy: 'none' };



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

    // ★ 2026-10-07 QA 回饋：預覽只看第一筆，若前幾筆沒有缺值就看不到缺值處理的效果。
    //   改讀完整資料的欄位統計（utils/datasetProfile.ts）取得各欄空值筆數，預覽另列一行「空值 → 處理結果」。
    useEnsureDatasetProfile();
    const datasetProfileSnapshot = useWorkspaceStore((state) => state.datasetProfile);

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
        // ★ 2026-10-05：欄位名稱為 constructor／toString 等時，直接取 map[名稱] 會拿到物件內建函式而崩潰；
        //   改為只讀取自身屬性並確認是陣列。
        const existingStepsArray = Object.prototype.hasOwnProperty.call(preprocessingRulesMap, targetColumnNameStr) ? preprocessingRulesMap[targetColumnNameStr] : undefined;
        return Array.isArray(existingStepsArray) && existingStepsArray.length > 0 ? existingStepsArray : DEFAULT_PREPROCESS_STEP_LIST;
    };

    /**
     * 函數名稱: getFieldMissingValueRule
     * 函數功能: 取得指定欄位目前之缺失值處理規則；若尚未設定，則退回「不處理」。
     */
    const getFieldMissingValueRule = (targetColumnNameStr: string): MissingValueRule =>
        (Object.prototype.hasOwnProperty.call(missingValueRulesMap, targetColumnNameStr) ? missingValueRulesMap[targetColumnNameStr] : undefined) || DEFAULT_MISSING_VALUE_RULE;

    /**
     * 預處理動作參數欄位定義 (依動作種類決定所需之控制項類型與預設值)
     * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
     */
    type PreprocessParamFieldDef =
        | { key: string; type: 'select'; label: string; defaultValue: string; options: { value: string; label: string }[]; visibleWhen?: (paramsDict: Record<string, string | number>) => boolean; required?: boolean; optionHintMap?: Record<string, string> }
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
                { key: 'keepCount', type: 'number', label: translate('step2.param_keep_count', '保留字數（含鎖定字元）'), defaultValue: DEFAULT_ANCHOR_KEEP_COUNT, min: 0 }
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
                    key: 'algorithm', type: 'select', label: translate('step2.param_hash_algorithm', '演算法'), defaultValue: DEFAULT_PREPROCESS_HASH_ALGORITHM,
                    // ★ 2026-10-27：改用後端 /api/v1/preprocess 支援的三種演算法（舊選項 SHA-512 後端不支援，讀入時改為 SHA3-512）；
                    //   後端整份清單共用一個演算法，任一欄改了演算法，其他欄的雜湊步驟一併改（見 handleStepParamChange）
                    options: [
                        { value: 'sha256', label: 'SHA-256' },
                        { value: 'sha3-256', label: 'SHA3-256' },
                        { value: 'sha3-512', label: 'SHA3-512' }
                    ]
                },
                {
                    key: 'seedMode', type: 'select', label: translate('step2.param_hash_seed_mode', '鹽值 (Salt)'), defaultValue: 'none',
                    options: [
                        { value: 'none', label: translate('step2.hash_seed_none', '伺服器預設鹽值（建議）') },
                        { value: 'fixed', label: translate('step2.hash_seed_fixed', '自訂鹽值') },
                        // ★ 2026-10-02：「目前時間戳」改為「系統隨機鹽值」（時間戳可被猜測），舊設定的 'timestamp' 仍可讀取並視同隨機鹽值
                        { value: 'random', label: translate('step2.hash_seed_random', '執行時間鹽值（每次執行不同）') }
                    ],
                    optionHintMap: {
                        none: translate('step2.hint_hash_seed_none', '效果：使用伺服器設定的預設鹽值（部署時自動產生並固定）。同一台伺服器上同一個值永遠得到相同結果，可跨批次比對，外部也無法查表反推。鹽值只存在伺服器上，預覽不顯示雜湊值，只標示處理方式。'),
                        fixed: translate('step2.hint_hash_seed_fixed', '效果：以您輸入的鹽值一起計算雜湊，同一個鹽值下，相同的值會得到相同結果。適用情境：需要「跨批次比對」又要「防止被查表反推」時使用；鹽值建議至少 16 個字元並妥善保管，一旦外流就會失去保護效果。'),
                        random: translate('step2.hint_hash_seed_random', '效果：以本次執行的時間（精確到微秒）當鹽值，同一次執行內相同的值結果相同，下次執行即不同、不會保存。適用情境：只需遮蔽本批資料、不需要跨批次比對時使用。注意：鹽值是執行時間，知道大約執行時間的人可縮小猜測範圍，防查表能力不如「伺服器預設鹽值」。')
                    }
                },
                { key: 'seedValue', type: 'text', label: translate('step2.param_hash_seed_value', '鹽值'), defaultValue: '', visibleWhen: (paramsDict) => paramsDict.seedMode === 'fixed', required: true }
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

    // 各下拉選項對應之「效果／適用情境」白話說明 (符合規範 e，供選項旁 ? 圖示懸浮顯示使用)
    const missingValueStrategyHintMap: Record<string, string> = {
        none: translate('step2.hint_missing_none', '效果：保留缺失值不做任何調整，欄位仍會顯示空值。適用情境：資料完整度已足夠、或缺失值本身具有分析意義時使用。'),
        drop: translate('step2.hint_missing_drop', '效果：只要該欄位缺失，整筆資料（該列）就會被移除。適用情境：缺失比例低、且不希望用推估值影響分析結果時使用；缺失比例高時請謹慎使用，避免流失過多資料。'),
        constant: translate('step2.hint_missing_constant', '效果：將缺失值統一替換為您指定的固定值（例如「未知」或 0）。適用情境：想明確標記缺失、且該欄位有合理預設值時使用。'),
        fill: translate('step2.hint_missing_fill', '效果：依您選擇的統計方法（前值／後值／內插／平均值）自動計算並填入缺失值。適用情境：想保留資料筆數、且欄位為連續數值或具時間序列關聯時使用。')
    };

    const fillMethodHintMap: Record<string, string> = {
        forward: translate('step2.hint_fill_forward', '效果：用同一欄位「前一筆」資料的數值填補缺失。適用情境：資料具時間先後順序、且數值變化不大時（如感測器讀數）使用。'),
        backward: translate('step2.hint_fill_backward', '效果：用「後一筆」資料的數值回填缺失值。適用情境：時間序列資料、且後續數值可代表當下狀態時使用。'),
        interpolate: translate('step2.hint_fill_interpolate', '效果：依前後兩筆數值，以線性方式推算出中間的缺失值。適用情境：數值呈連續變化趨勢（如溫度、股價）時使用。'),
        mean: translate('step2.hint_fill_mean', '效果：以該欄位所有已知數值的平均值填補缺失。適用情境：數值分布集中、沒有明顯極端值，且與時間順序無關時使用；若有極端值（例如少數特別高的薪資），平均值會被拉高或拉低，填入的數值會失真，請改用其他方式。')
    };

    const preprocessActionHintMap: Record<string, string> = {
        none: translate('step2.hint_action_none', '效果：欄位資料維持原樣，不做任何清洗。適用情境：欄位內容已符合分析需求時使用。'),
        trim: translate('step2.hint_action_trim', '效果：移除文字前後（或全部）多餘的空白字元。適用情境：欄位常因人工輸入或匯入夾帶多餘空白，導致比對或分組失準時使用。'),
        slice: translate('step2.hint_action_slice', '效果：從欄位開頭或結尾刪除指定數量的字元。適用情境：欄位含固定格式的前綴或後綴（如流水號開頭）需要去除時使用。'),
        anchor_truncate: translate('step2.hint_action_anchor_truncate', '效果：以指定字元為基準，向前或向後只保留固定字數，其餘截斷。適用情境：需以特定符號（如「-」）為分界，僅保留其中一段固定長度資料時使用（例如身分證字號部分遮蔽）。'),
        type_cast: translate('step2.hint_action_type_cast', '效果：將欄位資料轉換為指定的資料型態（整數、浮點數或布林值）。適用情境：欄位型態與實際用途不符（如數字被存成文字）時使用。'),
        normalize: translate('step2.hint_action_normalize', '效果：統一文字的大小寫及全形／半形格式。適用情境：同一欄位存在格式不一致（如英數字全形與半形混用）需要統一比對基準時使用。'),
        clamp: translate('step2.hint_action_clamp', '效果：將數值限制在指定的上下限範圍內，超出範圍者會被調整為邊界值。適用情境：欄位存在明顯異常值（如年齡出現負數或超過合理上限）需要修正時使用。'),
        hash: translate('step2.hint_action_hash', '效果：以指定演算法將原始值轉換為不可逆的雜湊字串，無法還原回原始內容。適用情境：需完全隱藏原始值、但仍需保留可比對的唯一性（如識別碼）時使用。'),
        regex_replace: translate('step2.hint_action_regex_replace', '效果：以正則表達式比對特定樣式的文字並替換為指定內容。適用情境：需遮蔽或移除特定格式的敏感字串（如電話號碼、Email）時使用。')
    };

    /**
     * 函數名稱: renderSelectOptionWithHint
     * 函數功能: 於下拉選單各選項右側附加 ? 圖示，滑鼠移過去即懸浮顯示該選項之白話說明 (效果／適用情境)，
     *           點擊圖示本身不觸發選項選取 (stopPropagation)。
     */
    const renderSelectOptionWithHint = (optionLabelNode: React.ReactNode, hintTextString?: string): React.ReactNode => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span>{optionLabelNode}</span>
            {hintTextString && (
                <Tooltip title={hintTextString} placement="right">
                    <QuestionCircleOutlined
                        style={{ color: token.colorTextDescription, flexShrink: 0 }}
                        onClick={(mouseClickEvent) => mouseClickEvent.stopPropagation()}
                    />
                </Tooltip>
            )}
        </div>
    );

    /**
     * ★ 2026-10-08 諮詢會（張瑞益教授）：表格捲到最底端的欄位時，選了清洗動作／缺失值策略或按「新增步驟」後，
     *   新長出的參數欄位落在表格捲動區下方看不到，要再自己往下捲。改為設定變更後，等畫面更新完成再把該列
     *   捲進可視範圍（已看得到時不會移動）。用遞增序號觸發，連續操作同一列也會每次都捲。
     */
    const pendingScrollRowKeyRef = useRef<string | null>(null);
    const [scrollRowRequestSeq, setScrollRowRequestSeq] = useState<number>(0);
    const requestScrollRowIntoView = (targetColumnNameStr: string): void =>
    {
        pendingScrollRowKeyRef.current = targetColumnNameStr;
        setScrollRowRequestSeq((previousSeqNumber) => previousSeqNumber + 1);
    };

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
        // ★ 2026-10-27：後端整份清單共用一個雜湊演算法，新加的雜湊步驟沿用其他欄位已選的演算法
        if (newActionValueStr === 'hash')
        {
            const existingHashStep = Object.values(preprocessingRulesMap).flat().find((stepItemRecord) => stepItemRecord?.action === 'hash');
            if (existingHashStep) defaultParamsDict.algorithm = normalizePreprocessHashAlgorithm(existingHashStep.params?.algorithm);
        }

        const updatedStepsArray = getFieldPreprocessSteps(targetColumnNameStr).map(
            (stepItemRecord, stepIndexNumber) =>
            {
                if (stepIndexNumber === targetStepIndexNumber) return { action: newActionValueStr, params: defaultParamsDict };

                // ★ 新增: 「雜湊」為不可逆之最終處理，若本次變更後之步驟為雜湊，其後方所有既存步驟一律
                //   強制重設為「不處理」，避免留下「畫面鎖定顯示不處理、但實際儲存值仍為舊策略」的
                //   不一致狀態 (對應下方下拉選單鎖定邏輯與新增按鈕停用邏輯)。
                if (newActionValueStr === 'hash' && stepIndexNumber > targetStepIndexNumber) return { action: 'none', params: {} };

                return stepItemRecord;
            }
        );

        setPreprocessingRulesAction({ ...preprocessingRulesMap, [targetColumnNameStr]: updatedStepsArray });
        requestScrollRowIntoView(targetColumnNameStr); // 新動作可能帶出參數欄位
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

        // ★ 2026-10-27：雜湊演算法為後端 preprocess 區塊的共用參數（不能逐欄不同），改一欄即同步所有欄位的雜湊步驟
        const isHashAlgorithmChangeStatus = paramKeyStr === 'algorithm' && getFieldPreprocessSteps(targetColumnNameStr)[targetStepIndexNumber]?.action === 'hash';
        if (isHashAlgorithmChangeStatus)
        {
            const syncedRulesMap: Record<string, PreprocessingRule[]> = {};
            Object.entries(preprocessingRulesMap).forEach(([columnNameStr, stepsArray]) =>
            {
                syncedRulesMap[columnNameStr] = Array.isArray(stepsArray)
                    ? stepsArray.map((stepItemRecord) => stepItemRecord.action === 'hash' ? { ...stepItemRecord, params: { ...stepItemRecord.params, algorithm: newParamValueData } } : stepItemRecord)
                    : stepsArray;
            });
            setPreprocessingRulesAction({ ...syncedRulesMap, [targetColumnNameStr]: updatedStepsArray });
            return;
        }

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

        const currentStepsForColumnArray = getFieldPreprocessSteps(targetColumnNameStr);

        // ★ 新增: 「雜湊」為不可逆之最終處理，欄位之策略鏈中若已包含「雜湊」步驟 (不論位於哪一步)，
        //   不允許再新增後續步驟 (對應 UI 端新增按鈕之停用與提示)。
        if (currentStepsForColumnArray.some((stepItemRecord) => stepItemRecord.action === 'hash'))
        {
            return;
        }

        setPreprocessingRulesAction({
            ...preprocessingRulesMap,
            [targetColumnNameStr]: [...currentStepsForColumnArray, { action: 'none', params: {} }]
        });
        requestScrollRowIntoView(targetColumnNameStr); // 新步驟加在該列最下方
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
        requestScrollRowIntoView(targetColumnNameStr); // 常數／策略填充會帶出下方輸入欄位
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

    // 精簡模式 (欄位數 ≤ 5)：表格內容不足捲動高度時，替表格捲動區保留固定最小高度，
    // 讓下拉選單有空間在表格範圍內展開，不會蓋到表格以外的版面。
    const preprocessTableWrapperRef = useRef<HTMLDivElement>(null);
    const isCompactPreprocessTableStatus = datasetColumnsList.length <= COMPACT_TABLE_MAX_ROW_COUNT;
    useEffect(() =>
    {
        const tableScrollAreaElement = preprocessTableWrapperRef.current?.querySelector('.ant-table-body') as HTMLElement | null;
        if (tableScrollAreaElement)
        {
            tableScrollAreaElement.style.minHeight = isCompactPreprocessTableStatus ? `${PREPROCESS_TABLE_SCROLL_HEIGHT_PX}px` : '';
        }
    }, [isCompactPreprocessTableStatus, datasetColumnsList.length]);

    // ★ 2026-10-08：設定變更後把該列捲進可視範圍（見 requestScrollRowIntoView 說明）。
    //   等下一個畫格再捲，確保新長出的參數欄位已排版完成、列高已更新。
    useEffect(() =>
    {
        const targetRowKeyStr = pendingScrollRowKeyRef.current;
        if (!targetRowKeyStr) return;
        const animationFrameId = requestAnimationFrame(() =>
        {
            scrollTableRowIntoView(preprocessTableWrapperRef.current, targetRowKeyStr);
            pendingScrollRowKeyRef.current = null;
        });
        return () => cancelAnimationFrame(animationFrameId);
    }, [scrollRowRequestSeq]);

    // 轉換 Ant Design Table 呈現用之數據清單 (符合規範 g)
    const mappingTableDataList: MappingRecord[] = datasetColumnsList.map(
        (columnNameString, columnIndexNumber) =>
        (
            {
                key: columnNameString,
                dropdownPopupMode: resolveDropdownPopupModeForRow(columnIndexNumber, datasetColumnsList.length),
                name: columnNameString,
                steps: getFieldPreprocessSteps(columnNameString),
                missingValueRule: getFieldMissingValueRule(columnNameString),
                sampleValue: pickPreviewSampleValue(previewDataRowsList, columnNameString) ?? DEFAULT_PREVIEW_SYMBOL,
                missingCount: datasetProfileSnapshot?.columns?.[columnNameString]
                    ? Math.max(0, datasetProfileSnapshot.rowCount - datasetProfileSnapshot.columns[columnNameString].nonEmptyCount)
                    : countMissingInPreviewRows(previewDataRowsList, columnNameString),
                isMissingCountFromFullData: Boolean(datasetProfileSnapshot?.columns?.[columnNameString])
            }
        )
    );

    /**
     * 函數名稱: renderPreprocessParamControl
     * 函數功能: 依據參數欄位定義之類型 (select／number／text)，渲染對應之表單控制項。
     */
    const renderPreprocessParamControl = (paramFieldDefItem: PreprocessParamFieldDef, currentParamsDict: Record<string, string | number>, onValueChange: (newValueData: string | number) => void, dropdownPopupModeValue: DropdownPopupMode = 'bottomLeft'): React.ReactElement =>
    {
        if (paramFieldDefItem.type === 'select')
        {
            return (
                <AdaptivePopupSelect
                    size="small"
                    value={paramFieldDefItem.key === 'algorithm'
                        ? normalizePreprocessHashAlgorithm(currentParamsDict.algorithm ?? paramFieldDefItem.defaultValue) // 舊設定 SHA256／SHA512 轉為後端支援的名稱
                        : String(currentParamsDict[paramFieldDefItem.key] ?? paramFieldDefItem.defaultValue)}
                    onChange={(selectedValueStr) => onValueChange(selectedValueStr)}
                    disabled={!isUserAllowedToEditRulesStatus}
                    placeholder={paramFieldDefItem.label}
                    style={{ width: '100%' }}
                    options={paramFieldDefItem.options}
                    optionRender={
                        paramFieldDefItem.optionHintMap
                            ? (optionItem) => renderSelectOptionWithHint(optionItem.label, paramFieldDefItem.optionHintMap?.[String(optionItem.data.value)])
                            : undefined
                    }
                    popupMode={dropdownPopupModeValue}
                />
            );
        }

        if (paramFieldDefItem.type === 'number')
        {
            return (
                <InputNumber
                    size="small"
                    value={currentParamsDict[paramFieldDefItem.key] === '' ? null : Number(currentParamsDict[paramFieldDefItem.key] ?? paramFieldDefItem.defaultValue)} // 空字串＝不限制（例如上下界只設一側），顯示空白而非預設值
                    onChange={(inputNumberValue) => onValueChange(inputNumberValue ?? paramFieldDefItem.defaultValue)}
                    disabled={!isUserAllowedToEditRulesStatus}
                    min={paramFieldDefItem.min}
                    placeholder={paramFieldDefItem.label}
                    style={{ width: '100%' }}
                />
            );
        }

        const currentTextValueStr = String(currentParamsDict[paramFieldDefItem.key] ?? paramFieldDefItem.defaultValue);
        // ★ 2026-10-28：鎖定字元可以是空白（期末測資以空白切開日期與時間），只有完全沒填才標紅
        const hasRequiredValueMissingStatus = Boolean(paramFieldDefItem.required) && (paramFieldDefItem.key === 'anchor' ? currentTextValueStr === '' : currentTextValueStr.trim() === '');

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

    /**
     * 函數名稱: getVisibleParamFieldListForStep
     * 函數功能: 依據單一策略步驟目前選擇的動作與參數，計算該步驟實際需顯示之參數欄位清單
     *           (套用 visibleWhen 過濾)。「策略」欄與「參數設定」欄的高度對齊計算皆須以同一份
     *           清單為準，故抽成共用函數，避免兩處各自實作、日後修改其中一處卻忘記同步另一處。
     */
    const getVisibleParamFieldListForStep = (stepItemRecord: PreprocessingRule): PreprocessParamFieldDef[] =>
    {
        const matchedActionDef = preprocessActionDefList.find((actionDefItem) => actionDefItem.value === stepItemRecord.action);
        return (matchedActionDef?.paramFields ?? []).filter((paramFieldDefItem) => !paramFieldDefItem.visibleWhen || paramFieldDefItem.visibleWhen(stepItemRecord.params));
    };

    /**
     * 「策略」欄與「參數設定」欄之列高對齊常數與計算函數
     * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
     *
     * ★ 修正：先前「參數設定」欄使用 <Space wrap> 讓多個參數欄位依容器實際寬度自動換行，
     *   換行後的行數並非固定值，而「策略」欄每一步驟卻固定僅佔一行高度；當某一步驟的參數
     *   因換行而變成兩行以上時，「參數設定」欄從該步驟起的後續內容就會比「策略」欄多出額外
     *   高度，導致兩欄位「同一個步驟」的方塊不再對齊在同一條水平線上。
     *   修正做法：參數欄位一律「垂直堆疊」顯示 (不再依寬度自動換行)，使每個步驟所需之行數
     *   固定等於「該步驟可見參數欄位數」，屬可預先精確計算之數值；並將此計算結果同步套用為
     *   「策略」欄與「參數設定」欄「同一步驟」列高之下限，兩欄從此才會逐步對齊。
     */
    const PARAM_CONTROL_SINGLE_LINE_HEIGHT_PX = 24; // Ant Design size="small" 控制項預設高度
    const PARAM_FIELD_VERTICAL_GAP_PX = 4;          // 同一步驟內，垂直堆疊之參數欄位間距
    const computeStepRowMinHeightPx = (visibleParamFieldCount: number): number =>
    {
        const effectiveLineCount = Math.max(1, visibleParamFieldCount);
        return effectiveLineCount * PARAM_CONTROL_SINGLE_LINE_HEIGHT_PX + (effectiveLineCount - 1) * PARAM_FIELD_VERTICAL_GAP_PX;
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
                    <AdaptivePopupSelect
                        size="small"
                        value={rowRecordItem.missingValueRule.strategy}
                        onChange={(selectedStrategyStr) => handleMissingValueStrategyChange(rowRecordItem.name, selectedStrategyStr)}
                        disabled={!isUserAllowedToEditRulesStatus}
                        style={{ width: '100%' }}
                        options={missingValueStrategyOptionList}
                        optionRender={(optionItem) => renderSelectOptionWithHint(optionItem.label, missingValueStrategyHintMap[String(optionItem.data.value)])}
                        popupMode={rowRecordItem.dropdownPopupMode}
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
                        <AdaptivePopupSelect
                            size="small"
                            value={rowRecordItem.missingValueRule.fillMethod ?? 'mean'}
                            onChange={(selectedFillMethodStr) => handleMissingValueParamChange(rowRecordItem.name, 'fillMethod', selectedFillMethodStr)}
                            disabled={!isUserAllowedToEditRulesStatus}
                            style={{ width: '100%' }}
                            options={fillMethodOptionList}
                            optionRender={(optionItem) => renderSelectOptionWithHint(optionItem.label, fillMethodHintMap[String(optionItem.data.value)])}
                            popupMode={rowRecordItem.dropdownPopupMode}
                        />
                    )}
                </div>
            )
        },
        {
            // ★ 2026-10-07 QA 回饋：使用者不知道同一欄位可以設定多個處理步驟（原本只有最後一步旁的小 + 圖示）。
            //   改為每個步驟前加上順序編號，並在步驟清單下方放一顆有文字的「新增步驟」按鈕。
            title: (
                <span>
                    {translate('step2.clean_strategy_multi', '清洗步驟（可多個）')}
                    <Tooltip title={translate('step2.clean_strategy_multi_tip', '同一欄位可依序加入多個處理步驟，由上而下執行。例如：先「去除空白」，再「截斷」。')}>
                        <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} />
                    </Tooltip>
                </span>
            ),
            dataIndex: 'steps',
            width: '22%',
            render: (_: unknown, rowRecordItem: MappingRecord) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rowRecordItem.steps.map(
                        (stepItemRecord, stepIndexNumber) =>
                        {
                            // ★ 新增: 「雜湊」為不可逆之最終處理，若此步驟前方已存在雜湊步驟，此步驟鎖定為僅能
                            //   選擇「不處理」且無法變更；欄位策略鏈中只要含有雜湊步驟 (不論位置)，即不允許
                            //   再新增後續步驟。
                            const isStepLockedByPriorHashStatus = rowRecordItem.steps.slice(0, stepIndexNumber).some((priorStepItemRecord) => priorStepItemRecord.action === 'hash');
                            // ★ 修正：與「參數設定」欄採用同一份可見參數欄位清單計算列高下限，確保同一步驟
                            //   在兩欄位中對齊於同一條水平線 (詳見 computeStepRowMinHeightPx 說明)。
                            const stepRowMinHeightPx = computeStepRowMinHeightPx(getVisibleParamFieldListForStep(stepItemRecord).length);

                            return (
                                <div key={stepIndexNumber} style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: stepRowMinHeightPx }}>
                                    <span data-testid="preprocess-step-number" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', flexShrink: 0, fontSize: scaleFontSize(11), fontWeight: 600, color: token.colorTextSecondary, background: token.colorFillSecondary }}>{stepIndexNumber + 1}</span>
                                    <Tooltip title={isStepLockedByPriorHashStatus ? translate('step2.strategy_locked_by_hash', '此步驟前方已套用「雜湊」，雜湊為不可逆之最終處理，其後不可再串接其他策略。') : ''}>
                                        <AdaptivePopupSelect
                                            value={stepItemRecord.action}
                                            onChange={(selectedDropdownAction) => handleStepActionChange(rowRecordItem.name, stepIndexNumber, selectedDropdownAction)}
                                            disabled={!isUserAllowedToEditRulesStatus || isStepLockedByPriorHashStatus}
                                            style={{ flex: 1, minWidth: 0 }}
                                            options={
                                                (isStepLockedByPriorHashStatus ? preprocessActionDefList.filter((actionDefItem) => actionDefItem.value === 'none') : preprocessActionDefList)
                                                    .map((actionDefItem) => ({ value: actionDefItem.value, label: actionDefItem.label }))
                                            }
                                            optionRender={(optionItem) => renderSelectOptionWithHint(optionItem.label, preprocessActionHintMap[String(optionItem.data.value)])}
                                            popupMode={rowRecordItem.dropdownPopupMode}
                                        />
                                    </Tooltip>

                                    {isUserAllowedToEditRulesStatus && rowRecordItem.steps.length > 1 && (
                                        <Tooltip title={translate('step2.remove_strategy_step', '移除此策略')}>
                                            <Button type="text" size="small" danger icon={<MinusCircleOutlined />} onClick={() => handleRemovePreprocessStep(rowRecordItem.name, stepIndexNumber)} />
                                        </Tooltip>
                                    )}
                                </div>
                            );
                        }
                    )}
                    {isUserAllowedToEditRulesStatus && (() => {
                        const hasHashStepInChainStatus = rowRecordItem.steps.some((stepItemRecordForCheck) => stepItemRecordForCheck.action === 'hash');
                        return (
                            <Tooltip title={hasHashStepInChainStatus ? translate('step2.add_strategy_step_disabled_hash', '「雜湊」為不可逆之最終處理，其後不可再新增策略。') : ''}>
                                <Button
                                    type="dashed"
                                    size="small"
                                    icon={<PlusOutlined />}
                                    data-testid={`preprocess-add-step-${rowRecordItem.name}`}
                                    onClick={() => handleAddPreprocessStep(rowRecordItem.name)}
                                    disabled={hasHashStepInChainStatus}
                                    style={{ alignSelf: 'flex-start', marginLeft: 22 }}
                                >
                                    {translate('step2.add_strategy_step_btn', '新增步驟')}
                                </Button>
                            </Tooltip>
                        );
                    })()}
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
                            const visibleParamFieldList = getVisibleParamFieldListForStep(stepItemRecord);
                            // ★ 修正：與「策略」欄採用同一份可見參數欄位清單計算列高下限，確保同一步驟在兩欄位
                            //   中對齊於同一條水平線 (詳見 computeStepRowMinHeightPx 說明)。
                            const stepRowMinHeightPx = computeStepRowMinHeightPx(visibleParamFieldList.length);

                            if (visibleParamFieldList.length === 0)
                            {
                                return <div key={stepIndexNumber} style={{ minHeight: stepRowMinHeightPx, display: 'flex', alignItems: 'center', color: token.colorTextDescription }}>{DEFAULT_PREVIEW_SYMBOL}</div>;
                            }

                            return (
                                // ★ 修正：原本使用 <Space wrap> 依容器實際寬度自動換行，換行後行數不固定，
                                //   會導致此欄與「策略」欄的列高計算失準而跑版；改為一律垂直堆疊各參數欄位，
                                //   使所需行數 (=可見參數欄位數) 成為可預先精確計算之固定值。
                                <div key={stepIndexNumber} style={{ display: 'flex', flexDirection: 'column', gap: PARAM_FIELD_VERTICAL_GAP_PX, minHeight: stepRowMinHeightPx, justifyContent: 'center' }}>
                                    {visibleParamFieldList.map(
                                        (paramFieldDefItem) => (
                                            <div key={paramFieldDefItem.key} style={{ width: '100%', maxWidth: '14.5em' }}>
                                                {renderPreprocessParamControl(
                                                    paramFieldDefItem,
                                                    stepItemRecord.params,
                                                    (newValueData) => handleStepParamChange(rowRecordItem.name, stepIndexNumber, paramFieldDefItem.key, newValueData),
                                                    rowRecordItem.dropdownPopupMode
                                                )}
                                            </div>
                                        )
                                    )}
                                </div>
                            );
                        }
                    )}
                </div>
            )
        },
        {
            // ★ 2026-10-07 QA 回饋：原本只取第一筆資料預覽，前幾筆沒有缺值時看不到缺值處理效果。
            //   改為兩行：① 範例值（該欄第一個非空值）經清洗步驟後的結果；② 空值經「缺失值處理」後的結果與空值筆數。
            title: (
                <span>
                    {translate('step2.live_preview_v2', '即時預覽')}
                    <Tooltip title={translate('step2.live_preview_v2_tip', '第一行：範例值經清洗步驟後的結果。第二行：空值經缺失值處理後的結果，並標出整份資料的空值筆數。')}>
                        <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} />
                    </Tooltip>
                </span>
            ),
            key: 'preview',
            width: '25%',
            render: (_: unknown, rowRecordItem: MappingRecord) =>
            {
                const originalSampleTextValue = rowRecordItem.sampleValue;
                const processedSampleTextValue = originalSampleTextValue === DEFAULT_PREVIEW_SYMBOL ? originalSampleTextValue : applyPreprocessSteps(originalSampleTextValue, rowRecordItem.steps);
                const isContentModifiedStatus = originalSampleTextValue !== processedSampleTextValue;

                const missingStrategyStr = rowRecordItem.missingValueRule.strategy;
                const fillMethodLabel = fillMethodOptionList.find((optionItem) => optionItem.value === (rowRecordItem.missingValueRule.fillMethod ?? 'mean'))?.label ?? '';
                const missingResultText = missingStrategyStr === 'drop'
                    ? translate('step2.missing_preview_drop_v2', '整列移除')
                    : missingStrategyStr === 'constant'
                        ? (rowRecordItem.missingValueRule.constantValue || DEFAULT_PREVIEW_SYMBOL)
                        : missingStrategyStr === 'fill'
                            ? translate('step2.missing_preview_fill_v2', '依{{method}}填入', { method: fillMethodLabel })
                            : translate('step2.missing_preview_keep', '保留空值');
                const missingCountText = rowRecordItem.missingCount > 0
                    ? translate(rowRecordItem.isMissingCountFromFullData ? 'step2.missing_count_full' : 'step2.missing_count_sample', rowRecordItem.isMissingCountFromFullData ? '共 {{n}} 筆' : '預覽中 {{n}} 筆', { n: rowRecordItem.missingCount.toLocaleString() })
                    : translate('step2.missing_count_none', '此欄無空值');
                const isMissingHandledStatus = missingStrategyStr !== 'none';

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <Space size={6} style={{ display: 'flex', flexWrap: 'wrap' }} data-testid={`preprocess-preview-sample-${rowRecordItem.name}`}>
                            {/* ★ 2026-10-08：有值的範例放大、空值那行縮小，主從分明 */}
                            <Text type="secondary" delete={isContentModifiedStatus} style={{ fontSize: scaleFontSize(16) }}>{originalSampleTextValue}</Text>
                            {isContentModifiedStatus && <ArrowRightOutlined style={{ color: token.colorPrimary, fontSize: scaleFontSize(14) }} />}
                            {isContentModifiedStatus && <Text style={{ color: token.colorPrimary, fontWeight: 600, fontSize: scaleFontSize(16) }}>{processedSampleTextValue}</Text>}
                        </Space>
                        <Space size={4} style={{ display: 'flex', flexWrap: 'wrap' }} data-testid={`preprocess-preview-missing-${rowRecordItem.name}`}>
                            <span style={{ padding: '0 4px', borderRadius: 4, fontSize: scaleFontSize(11), lineHeight: 1.5, border: `1px dashed ${token.colorBorder}`, color: token.colorTextSecondary }}>{translate('step2.missing_preview_label', '空值')}</span>
                            <ArrowRightOutlined style={{ color: isMissingHandledStatus ? token.colorWarning : token.colorTextDescription, fontSize: scaleFontSize(10) }} />
                            <Text style={{ color: isMissingHandledStatus ? token.colorWarning : token.colorTextSecondary, fontWeight: isMissingHandledStatus ? 600 : 400, fontSize: scaleFontSize(12) }}>{missingResultText}</Text>
                            <Text type="secondary" style={{ fontSize: scaleFontSize(11) }}>（{missingCountText}）</Text>
                        </Space>
                    </div>
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
                {/* ★ 2026-10-27：最終版後端已提供 /api/v1/preprocess，Step4 會先依此處設定清洗資料，再進行去識別化與風險評估
                    （組裝見 utils/preprocessConfig.ts；預覽規則與後端相同，見 utils/preprocessSteps.ts）。 */}
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    title={translate('step2.preprocess_backend_pending_title', '清洗設定會在 Step4 先交由後端處理')}
                    description={translate('step2.preprocess_backend_pending_desc', '執行時會先依這裡的清洗步驟與缺失值處理整理資料（後端資料前處理），再以整理後的資料進行去識別化與風險評估；右側預覽為依相同規則計算的範例。')}
                />
                <div ref={preprocessTableWrapperRef}>
                <Table dataSource={mappingTableDataList} columns={preprocessTableColumnsConfig} pagination={false} size="small" bordered={false} rowKey="key" scroll={{ y: PREPROCESS_TABLE_SCROLL_HEIGHT_PX }} style={{ background: isDarkModeActive ? '#141414' : '#fafafa', borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}` }} />
                </div>
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