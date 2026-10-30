/**
 * ============================================================================
 * 檔案名稱 (File): KAnonymityRules.tsx
 * 模組功能 (Description): K-匿名參數設定（2026-10-07 起為精簡白話版：左側保護強度卡、湊不滿人數的資料處理、進階敏感資料檢測；右側原 Pareto 示意圖＋三個重點數字）
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Alert, Slider, Row, Col, InputNumber, Input, theme, Select, Button, Tag, Space, Tooltip, Switch, Radio } from 'antd';
import { PlusOutlined, DeleteOutlined, WarningOutlined, QuestionCircleOutlined, CheckCircleFilled, DownOutlined, UpOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useEnsureDatasetProfile } from '../../utils/datasetProfile';
import { findSmallestSensitiveColumnDistinct, computeLSliderMaxValue, isLValueExceedingSensitiveDistinct, isLNotLessThanK } from '../../utils/lDiversityLimits';
import DatasetScaleHint from '../../components/DatasetScaleHint';

import { scaleFontSize, scaleChartFontSize } from '../../utils/fontScale';
/**
 * ============================================================================
 * 預設臨界點常數宣告 (Magic Numbers Constants)
 * ============================================================================
 */
const MIN_K_VALUE = 2;                     // K 值最小限制 (低於 2 等同無匿名效果)
// ★ 2026-10-19：拿掉 K ≤ 100 的硬上限，比照後端（validation.py::_sanity_check 只檢查 k ≤ 資料筆數）。
//   原本 100 只限制滑桿／輸入框，Step2 匯入設定檔可帶入 K > 100 且下一步不擋，前後不一致；
//   且敏感欄位極度偏斜時（如銀髮安居資料長照 97% 為 0），要通過 l=2 需要 K 數百。
//   100 改為「滑桿範圍」與「K 很大提醒」門檻，輸入框可輸入到資料筆數。
const K_SLIDER_MAX_VALUE = 100;             // 滑桿上限（更大的 K 請用輸入框）
const K_LARGE_WARNING_THRESHOLD = 100;      // K 超過此值顯示黃色提醒（不阻擋）
const MIN_L_VALUE = 1;                     // L 值最小限制
const MAX_L_VALUE = 10;                    // L 值最大限制（僅在尚無 K 值時作為備援上限，見 effectiveMaxLValue）
const MIN_T_VALUE = 0.01;                  // T 值最小限制
const MAX_T_VALUE = 1.0;                   // T 值最大限制
const DEFAULT_T_VALUE = 0.15;              // 系統預設 T 趨近性基準值
// ★ 修正：MAX_SUPPRESSION_PERCENT 原本設為 50 (理由是「超過 50% 資料失去意義」)，屬於
//   前端自行加上的產品限制，並非後端真正的限制。已核對後端 validation.py::validate_percent_param
//   原始碼，suppression_limit_percent 實際接受範圍是 0~100 (含頭尾)，超出才會 400。
//   為了讓畫面上的可調範圍與後端實際能接受的範圍一致 (避免使用者誤以為 50 是系統上限)，
//   改為與後端同步，上限提高為 100。
const MIN_SUPPRESSION_PERCENT = 0;         // 最小抑制率百分比 (與後端 validate_percent_param 下限一致)
const MAX_SUPPRESSION_PERCENT = 100;       // 最大允許抑制率百分比 (與後端 validate_percent_param 上限一致)
const SUPPRESSION_PENALTY_THRESHOLD = 12;  // 計算 Pareto 懲罰之抑制率門檻 (%)
// ★ 2026-10-04 暫時隱藏「計算範圍（指定準識別欄位組合）」：
//   1. 後端引擎有實作此能力（run_k_anonymity 的 k_qi_subset 參數，對應規格 2.1(4)「整體 k 或
//      依指定準識別欄位組合計算」），但 API 未開放：期中原始碼（2026-08-26）的 deid_router.py
//      呼叫時未傳入 k_qi_subset，設定檔 schema 也沒有此欄位；v2（09-09）操作說明、openapi.json
//      與 v3（09-14）範例設定檔皆未提及。
//   2. 前端的欄位組合只存在本元件的 useState，從未送進設定檔，使用者怎麼選都不影響結果。
//   3. 前端允許設定多組組合，但後端 k_qi_subset 一次只接受一組欄位。
//   恢復方式：待後端在 API／設定檔開放 k_qi_subset 後，把下列常數改回 true，並將組合改為
//   「單一一組」、寫入 k_anonymity 設定區塊送出（注意：子集只會放寬分組條件、降低抑制量）。
const SHOW_QI_COMBINATION_SCOPE = false;
/**
 * ★ 2026-10-07 白話版：保護強度預設選項。
 * ★ 2026-10-22 依〈林政委個資去識別化談參〉表 3（K = 1 ÷ 再識別風險閾值）：
 *   標準 K=3＝英國 NHS 弱匿名（0.33）；加強 K=5＝NHS 強匿名（0.2）；嚴格 K=12＝歐盟 EMA、加拿大 IPCO 低風險（0.09）。
 *   預設改為「加強」（K=5，與 useWorkspaceStore 預設值一致）：我國 111 憲判 13 採絕對主義，較歐英日嚴格。
 */
const K_PRESET_OPTIONS: ReadonlyArray<{ key: 'standard' | 'enhanced' | 'strict'; kValue: number; titleText: string; isDefault?: boolean }> = [
    { key: 'standard', kValue: 3, titleText: '標準' },
    { key: 'enhanced', kValue: 5, titleText: '加強', isDefault: true },
    { key: 'strict', kValue: 12, titleText: '嚴格' },
];

/** 白話版選項卡（保護強度、抑制方式共用） */
interface PlainChoiceCardProps
{
    cardKey: string;                 // React key
    testId: string;                  // data-testid
    isSelected: boolean;             // 是否為目前選項
    isDisabled: boolean;             // 是否停用
    disabledReasonText?: string;     // 停用原因（Tooltip）
    onSelect: () => void;            // 點選事件
    titleText: string;               // 標題
    badgeText?: string;              // 標題旁小標籤（例如「預設」）
    children: React.ReactNode;       // 說明內容
}

/**
 * ECharts 繪圖工具提示 (Tooltip) 參數型別介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface TooltipParams 
{
    name: string;        // 數據點名稱 (如 "Current Setting")
    seriesName?: string; // 系列圖表名稱
    value: number[];     // 數據座標數值對 [X(Utility), Y(Privacy)]
    data: number[];      // 圖表原始數據陣列
}

/**
 * 函數名稱: KAnonymityRules
 * 函數功能: 渲染步驟三 K-匿名規則設定介面，提供 K-Anonymity (k)、L-Diversity (l)、T-Closeness (t) 參數調整滑桿、間接識別碼威脅組合選單、抑制率策略設定，以及帕累托前沿 (Pareto Front) 隱私/效用平衡模擬圖表。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: K-匿名規則設定 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被 Step 3 導覽精靈組件載入渲染
 *   - 訂閱與更新 useWorkspaceStore 中的 kValue, lValue, tValue, maxSuppression 等全域狀態
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function KAnonymityRules(): React.ReactElement 
{
    // 取得 Ant Design 當前主題 Token，用於決定元件配色
    const { token } = theme.useToken();
    
    // 深色主題狀態判定 (判斷背景色是否非純白) (符合規範 g)
    const isDarkModeActiveStatus = token.colorBgContainer !== '#ffffff';

    const { t: translate } = useTranslation();

    /**
     * ============================================================================
     * 全域狀態訂閱區塊 (來自 useWorkspaceStore)
     * ============================================================================
     */
    const currentKValue = useWorkspaceStore(
        (state) => state.kValue
    );                                                     // K-匿名群組大小 k

    const maxSuppressionPercentageValue = useWorkspaceStore(
        (state) => state.maxSuppression
    );                                                     // 最大允許抑制率 (%)

    const currentLValue = useWorkspaceStore(
        (state) => state.lValue
    );                                                     // L-多樣性 l

    const currentTValue = useWorkspaceStore(
        (state) => state.tValue
    );                                                     // T-趨近性 t

    // ★ 使用者反映：純 K-匿名模式不一定需要 l-多樣性／t-緊密度檢測，但先前 l/t 一律隨預設值送給
    //   後端，導致後端一律嘗試檢測；若未指定敏感欄位，l_passed／t_passed 就會永遠回傳 false，
    //   且與 l/t 值本身無關。新增這兩個開關，讓使用者可自行決定是否要啟用該項檢測；關閉時
    //   Step4 組裝設定檔不會送出 l／t 欄位。
    const isEnableLDiversityStatus = useWorkspaceStore(
        (state) => state.enableLDiversity
    );                                                     // 是否啟用 l-多樣性檢測

    const isEnableTClosenessStatus = useWorkspaceStore(
        (state) => state.enableTCloseness
    );                                                     // 是否啟用 t-緊密度檢測

    const currentSuppressionMethodTypeStr = useWorkspaceStore(
        (state) => state.suppressionMethod
    );                                                     // 抑制方式 ('row' | 'cell')

    // ★ 使用者反映（2026-09-23）：後端 cell_fill 參數（值抑制時，被隱藏的欄位值要顯示成星號還是
    //   缺失值）先前完全沒有 UI 可選，前端也從未送出，後端只能默默套用內建預設 (star)。新增這個
    //   選單，僅在抑制方式為「值抑制」(cell_suppression) 時才會顯示／生效。
    const currentCellFillMethodTypeStr = useWorkspaceStore(
        (state) => state.cellFillMethod
    );                                                     // 值抑制填法 ('star' | 'missing')，僅 cell_suppression 模式下生效

    // ★ 2026-10-01：值抑制時可逐欄指定填入值（後端 columns.<欄>.cell_fill_value），未填的欄位沿用上面的填法
    const cellFillValuesByColumnMap = useWorkspaceStore(
        (state) => state.cellFillValuesByColumn
    );

    const currentLimitExceededActionTypeStr = useWorkspaceStore(
        (state) => state.limitExceededAction
    );                                                     // 抑制率超限處置動作

    const datasetColumnsListArray = useWorkspaceStore(
        (state) => state.columns
    ) || [];                                               // 數據欄位名稱清單

    const datasetRowsListArray = useWorkspaceStore(
        (state) => state.previewData
    ) || [];                                               // 數據資料列清單 (用於計算資料源筆數上限)

    // ★ 2026-09-30：previewData 只是 Step1 擷取的前 1000 筆預覽，不是整份資料；資料源總筆數改讀
    //   utils/datasetProfile.ts 完整掃描一次的結果，掃描完成前暫以預覽筆數代替。
    useEnsureDatasetProfile();
    const datasetProfileSnapshot = useWorkspaceStore((state) => state.datasetProfile);
    const datasetRowCountValue = datasetProfileSnapshot ? datasetProfileSnapshot.rowCount : datasetRowsListArray.length; // 資料源總筆數 (0 代表尚未載入資料)

    // K 值實際可選上限：與後端一致，只限制不得超過資料源筆數（尚未載入資料時不限制）
    const effectiveMaxKValue = datasetRowCountValue > 0
        ? datasetRowCountValue
        : Number.MAX_SAFE_INTEGER;
    // 滑桿只涵蓋常用範圍（2～100，且不超過資料筆數）；K 大於此值時滑桿停在最右側，數值以輸入框為準
    const kSliderMaxValue = Math.min(K_SLIDER_MAX_VALUE, effectiveMaxKValue);

    const columnPrivacyRolesMapDict = useWorkspaceStore(
        (state) => state.columnRoles
    ) || {};                                               // 欄位隱私角色對應

    const setStepValidationAction = useWorkspaceStore(
        (state) => state.setStepValidation
    );                                                     // 步驟驗證設定 Action

    // ★ 使用者反映（2026-09-29）：l 值上限原本固定為 10，但 l-多樣性要求每個等價類中敏感欄位至少
    //   有 l 種不同的值，因此 l 的真正上限是「敏感欄位本身的相異值數」——例如疾病只有 5 種，l 設
    //   6～10 必定無法通過。改為比照 k（上限 = min(100, 資料筆數)）依實際資料動態決定：
    //   l 上限 = min(目前 k 值, 各敏感欄位相異值數中的最小值)；多個敏感欄位時取最小者（後端會逐一
    //   檢測、須全部通過）。尚未設定敏感欄位或尚未載入資料時，退回原本的備援上限 MAX_L_VALUE。
    // ★ 2026-09-30：相異值數改讀完整資料集的欄位統計快照（見 datasetProfileSnapshot），不再只看
    //   前 1000 筆預覽；相異值數被截斷（極高基數）時代表遠大於任何合理的 l，視同不限制。
    const rawColumnRolesMapForLUpper = useWorkspaceStore((state) => state.columnRoles);
    // Step2 欄位明細（含各欄處理方式），供「敏感欄位處理方式與 l/t 檢測矛盾」即時提示使用
    const kAnonymityFieldsSnapshotList = useWorkspaceStore((state) => state.kAnonymityFields);
    // 計算規則見 utils/lDiversityLimits.ts（已抽出並有單元測試）
    const sensitiveColumnDistinctCountInfo = useMemo(
        () => findSmallestSensitiveColumnDistinct(rawColumnRolesMapForLUpper, datasetProfileSnapshot),
        [rawColumnRolesMapForLUpper, datasetProfileSnapshot]
    );
    // ★ 2026-10-13：上限改為只受 K 限制。原本 = min(K, 敏感欄位相異值數)，敏感欄位只有 1 種值時
    //   滑桿被鎖成 1、使用者無法調整也看不出原因；現在可自由調到 K，超過相異值數時直接顯示紅字並擋下一步。
    const effectiveMaxLValue = computeLSliderMaxValue(currentKValue, MIN_L_VALUE, MAX_L_VALUE);
    // 例如匯入的設定檔 l=8，但敏感欄位只有 5 種值：必定無法通過，需提示並擋下一步
    const isLExceedsSensitiveDistinctStatus = isEnableLDiversityStatus && isLValueExceedingSensitiveDistinct(currentLValue, sensitiveColumnDistinctCountInfo);
    // ★ 2026-10-30：Step2 敏感欄位改為選填；l／t 需要輸出中保留的敏感欄位（處理方式為「移除」者後端會刪掉該欄）
    const hasKeptSensitiveFieldStatus = useMemo(() => {
        const fieldsList = (kAnonymityFieldsSnapshotList || []) as Array<Record<string, unknown>>;
        return fieldsList.length > 0
            ? fieldsList.some((fieldRecord) => fieldRecord.role === 'Sensitive' && fieldRecord.maskStrategy !== 'remove')
            : Object.values(rawColumnRolesMapForLUpper || {}).some((roleName) => roleName === 'Sensitive');
    }, [kAnonymityFieldsSnapshotList, rawColumnRolesMapForLUpper]);

    /**
     * ============================================================================
     * 全頁即時防呆與邏輯校驗機制 (Effect Hook)
     * ============================================================================
     * 函數功能: 當 K, L, T 或抑制率變化時，驗證這些參數在數學與實務上是否衝突。
     * 規範對照: 符合規範 d) 嚴格校驗變數資料，防止不合理值發生
     */
    useEffect(
        () => 
        {
            // 1. 驗證 K 值是否過小
            if (currentKValue === undefined || currentKValue === null || currentKValue < MIN_K_VALUE) 
            {
                setStepValidationAction(false, translate('step3.error_k_too_small', 'K 值必須大於等於 2（K=1 等同於沒有匿名效果）。'));

                return;
            }

            // 2. 驗證 K 值是否超過資料源總筆數 (K-匿名群組大小不可能超過資料集本身的資料筆數)
            if (datasetRowCountValue > 0 && currentKValue > datasetRowCountValue)
            {
                setStepValidationAction(false, translate(
                    'step3.error_k_exceeds_dataset',
                    '參數錯誤：K 值 ({{k}}) 不可大於資料源總筆數 ({{rows}})。',
                    { k: currentKValue, rows: datasetRowCountValue }
                ));

                return;
            }

            // 2-2. 啟用 l／t 卻沒有保留的敏感欄位：後端會判定「未執行」（不算通過），擋下一步（2026-10-30）
            if ((isEnableLDiversityStatus || isEnableTClosenessStatus) && !hasKeptSensitiveFieldStatus)
            {
                setStepValidationAction(false, translate(
                    'step3.error_lt_without_sensitive',
                    '已啟用 l-多樣性／t-緊密度，但沒有保留的敏感欄位（未設定，或處理方式皆為「移除」），檢測無法執行。請關閉 l／t，或回 Step2 將至少一個欄位設為「敏感欄位」。'
                ));

                return;
            }

            // 3. 驗證 l 必須小於 K
            //    ★ 2026-10-13：依使用者規格由 K ≥ L 改為 l < K（K=5 時 l 只能 1～4）。
            //    ★ 僅在使用者實際啟用 l-多樣性檢測時才驗證，未啟用時 l 值不會送給後端，不需卡關。
            if (isEnableLDiversityStatus && isLNotLessThanK(currentLValue, currentKValue))
            {
                setStepValidationAction(false, translate(
                    'step3.error_l_not_less_than_k',
                    '參數衝突：l 必須小於 K（目前 K={{k}}、l={{l}}），請把 l 調到 {{max}} 以下。',
                    { k: currentKValue, l: currentLValue, max: Math.max(MIN_L_VALUE, currentKValue - 1) }
                ));

                return;
            }

            // 3-2. 驗證 L 不可超過敏感欄位相異值數（否則每個等價類都不可能湊出 L 種敏感值，必定不通過）
            if (isLExceedsSensitiveDistinctStatus && sensitiveColumnDistinctCountInfo)
            {
                setStepValidationAction(false, translate(
                    'step3.error_l_exceeds_sensitive_distinct',
                    '敏感欄位「{{column}}」只有 {{count}} 種不同的值，任何群組都湊不出 {{l}} 種，l 設為 {{l}} 一定無法通過。請把 l 調到 {{count}} 以下，或回 Step2 確認敏感欄位是否選對。',
                    { l: currentLValue, column: sensitiveColumnDistinctCountInfo.columnName, count: sensitiveColumnDistinctCountInfo.distinctCount }
                ));

                return;
            }

            // 4. 驗證 T 值是否落在 0~1 的機率範圍內
            //    ★ 僅在使用者實際啟用 t-緊密度檢測時才驗證，未啟用時 t 值不會送給後端，不需卡關。
            if (isEnableTClosenessStatus && (currentTValue === undefined || currentTValue === null || currentTValue <= 0 || currentTValue > 1))
            {
                setStepValidationAction(false, translate('step3.error_t_range', 'T-Closeness (t) 必須介於 0 與 1 之間。'));

                return;
            }

            // 驗證通過，解鎖進入下一步的權限
            setStepValidationAction(true, null);
        },
        [currentKValue, currentLValue, currentTValue, maxSuppressionPercentageValue, datasetRowCountValue, isEnableLDiversityStatus, isEnableTClosenessStatus, setStepValidationAction, translate, isLExceedsSensitiveDistinctStatus, sensitiveColumnDistinctCountInfo, hasKeptSensitiveFieldStatus]
    );

    /**
     * 函數名稱: handleKValueChange
     * 函數功能: 處理 K-匿名 k 數值變更事件，寫入全域 WorkspaceStore。
     */
    const handleKValueChange = (inputKNumberValue: number | null): void =>
    {
        const clampedKNumberValue = Math.min(inputKNumberValue ?? MIN_K_VALUE, effectiveMaxKValue);

        useWorkspaceStore.setState({ kValue: clampedKNumberValue });
    };

    /**
     * 函數名稱: handleLValueChange
     * 函數功能: 處理 L-多樣性 l 數值變更事件，寫入全域 WorkspaceStore。
     */
    const handleLValueChange = (inputLNumberValue: number | null): void => 
    {
        const clampedLNumberValue = Math.min(inputLNumberValue ?? MIN_L_VALUE, effectiveMaxLValue);

        useWorkspaceStore.setState({ lValue: clampedLNumberValue });
    };

    /**
     * 函數名稱: handleTValueChange
     * 函數功能: 處理 T-趨近性 t 數值變更事件，寫入全域 WorkspaceStore。
     */
    const handleTValueChange = (inputTNumberValue: number | null): void =>
    {
        useWorkspaceStore.setState({ tValue: inputTNumberValue ?? DEFAULT_T_VALUE });
    };

    /**
     * 函數名稱: handleEnableLDiversityChange
     * 函數功能: 處理「啟用 l-多樣性檢測」開關切換事件，寫入全域 WorkspaceStore。
     */
    const handleEnableLDiversityChange = (isCheckedStatus: boolean): void =>
    {
        useWorkspaceStore.setState({ enableLDiversity: isCheckedStatus });
    };

    /**
     * 函數名稱: handleEnableTClosenessChange
     * 函數功能: 處理「啟用 t-緊密度檢測」開關切換事件，寫入全域 WorkspaceStore。
     */
    const handleEnableTClosenessChange = (isCheckedStatus: boolean): void =>
    {
        useWorkspaceStore.setState({ enableTCloseness: isCheckedStatus });
    };

    /**
     * 函數名稱: handleMaxSuppressionChange
     * 函數功能: 處理最大允許抑制率限制數值變更事件，寫入全域 WorkspaceStore。
     */
    const handleMaxSuppressionChange = (inputSuppressionPercentageValue: number | null): void => 
    {
        // ★ 使用者反映（2026-09-29）：輸入框未限制小數位數，曾出現 7.62999999999 這類浮點尾數，
        //   與結果頁四捨五入到兩位的抑制率並列時容易誤判。統一四捨五入到小數兩位再存入。
        const rawSuppressionValue = inputSuppressionPercentageValue ?? MIN_SUPPRESSION_PERCENT;
        useWorkspaceStore.setState({ maxSuppression: Math.round(rawSuppressionValue * 100) / 100 });
    };

    /**
     * 函數名稱: handleSuppressionMethodChange
     * 函數功能: 處理抑制層級方式 (Row/Cell) 下拉選單切換事件，寫入全域 WorkspaceStore。
     */
    const handleSuppressionMethodChange = (selectedMethodTypeString: string): void =>
    {
        useWorkspaceStore.setState({ suppressionMethod: selectedMethodTypeString });
    };

    /**
     * 函數名稱: handleCellFillMethodChange
     * 函數功能: 處理「值抑制填法」(star／missing) 下拉選單切換事件，寫入全域 WorkspaceStore。
     *           僅在抑制方式為「值抑制」(cell_suppression) 時才會實際送給後端、影響輸出結果。
     */
    const handleCellFillMethodChange = (selectedFillMethodTypeString: string): void =>
    {
        useWorkspaceStore.setState({ cellFillMethod: selectedFillMethodTypeString as 'star' | 'missing' });
    };

    /**
     * 函數名稱: handleCellFillValueChange
     * 函數功能: 更新單一準識別符欄位的值抑制填入值；清空即移除該欄設定（沿用整體填法）。
     */
    const handleCellFillValueChange = (columnNameString: string, fillValueText: string): void =>
    {
        useWorkspaceStore.setState((currentStoreState) => {
            const nextCellFillValuesMap = { ...(currentStoreState.cellFillValuesByColumn || {}) };
            if (fillValueText === '') delete nextCellFillValuesMap[columnNameString];
            else nextCellFillValuesMap[columnNameString] = fillValueText;
            return { cellFillValuesByColumn: nextCellFillValuesMap };
        });
    };

    /**
     * 函數名稱: handleLimitExceededActionChange
     * 函數功能: 處理抑制率超限時應變處置動作選單變更事件，寫入全域 WorkspaceStore。
     */
    const handleLimitExceededActionChange = (selectedActionTypeString: string): void => 
    {
        useWorkspaceStore.setState({ limitExceededAction: selectedActionTypeString });
    };

    const filteredQuasiIdentifierColumnsList = datasetColumnsListArray.filter(
        (columnNameString: string) => 
        {
            const roleNameLowerCaseString = (columnPrivacyRolesMapDict[columnNameString] || '').toLowerCase();

            return roleNameLowerCaseString === 'qi' || roleNameLowerCaseString === 'quasi' || roleNameLowerCaseString === 'quasi-identifier';
        }
    );

    // 預設間接識別碼欄位備用清單 (若沒有明確標示的，則排除 Identifier 後全數納入)
    const quasiIdentifierColumnsArray = filteredQuasiIdentifierColumnsList.length > 0 
        ? filteredQuasiIdentifierColumnsList 
        : datasetColumnsListArray.filter((columnNameString: string) => (columnPrivacyRolesMapDict[columnNameString] || '').toLowerCase() !== 'identifier');

    // 自訂威脅組合模式開關與組合數據狀態 (符合規範 g)
    const [calculationModeType, setCalculationModeType] = useState<'all' | 'custom'>('all');

    // 記錄使用者配置的多個威脅子集陣列 (例如: [["Age", "Gender"], ["Zipcode", "Age"]])
    const [quasiIdentifierCombinationsList, setQuasiIdentifierCombinationsList] = useState<string[][]>([[]]);

    /**
     * 函數名稱: addCombination
     * 函數功能: 新增一組空白之間接識別碼威脅組合選單列。
     */
    const addCombination = (): void => 
    {
        setQuasiIdentifierCombinationsList([...quasiIdentifierCombinationsList, []]);
    };

    /**
     * 函數名稱: removeCombination
     * 函數功能: 依據索引刪除指定之間接識別碼威脅組合選單列。
     */
    const removeCombination = (targetRowIndexNumber: number): void => 
    { 
        const updatedCombinationsListArray = quasiIdentifierCombinationsList.filter(
            (_, currentCombinationIndex) => currentCombinationIndex !== targetRowIndexNumber
        ); 

        setQuasiIdentifierCombinationsList(updatedCombinationsListArray.length ? updatedCombinationsListArray : [[]]); 
    };

    /**
     * 函數名稱: updateCombination
     * 函數功能: 更新特定索引威脅組合所勾選之間接識別碼欄位陣列。
     */
    const updateCombination = (targetRowIndexNumber: number, selectedColumnsValuesArray: string[]): void => 
    { 
        const updatedCombinationsListArray = [...quasiIdentifierCombinationsList]; 

        updatedCombinationsListArray[targetRowIndexNumber] = selectedColumnsValuesArray; 

        setQuasiIdentifierCombinationsList(updatedCombinationsListArray); 
    };

    /**
     * ============================================================================
     * 帕累托邊界 (Pareto Front) 圖表模擬器與座標演算區塊
     * ============================================================================
     * 函數名稱: getKAnonymityChartOption
     * 函數功能: 依據當前 K/L/T 參數與抑制率門檻，繪製 Pareto Front 隱私 vs 數據可用性權衡模擬曲線圖表。
     * 
     * 計算邏輯:
     * 1. 使用 Math.pow 繪製出由左上至右下彎曲的「最優可能邊界曲線」(Pareto Frontier)。
     * 2. 依據 K, L, T 值計算加權後的「隱私保護強度」(Y軸: Privacy Level)。
     * 3. 依據最大抑制率 (maxSuppression) 計算對「資料效用」的懲罰扣分 (X軸: Utility)。
     * 4. 點離 Pareto 前沿越近代表演算法設定越優秀；越往左下角代表「效用跟隱私雙輸」。
     * 
     * 規範對照: 符合規範 b) 函數開頭註記
     */
    const getKAnonymityChartOption = (): Record<string, unknown> => 
    {
        // 1. 繪製 Pareto Front 模擬邊界曲線陣列數據 (計算 40 個點畫出平滑曲線)
        const paretoLineDataCoordinatesArray = Array.from(
            { length: 40 }, 
            (_, dataPointIndexNumber) => 
            {
                const calculatedYCoordinateValue = 15 + (dataPointIndexNumber * (80 / 39));

                const calculatedXCoordinateValue = 100 - Math.pow((calculatedYCoordinateValue - 15) / 80, 2.5) * 85;

                return [Number(calculatedXCoordinateValue.toFixed(1)), Number(calculatedYCoordinateValue.toFixed(1))];
            }
        );

        // 2. 計算各參數之隱私保護強度權重 (Y軸，數值越大代表隱私保護程度越高)
        const weightScoreForKValue = (currentKValue - MIN_K_VALUE) / 18;        

        // ★ l 上限改為動態（見 effectiveMaxLValue），分母隨之改為實際可選範圍，原本固定 9 = 10 - 1
        const weightScoreForLValue = Math.min(1, Math.max(0, (currentLValue - MIN_L_VALUE) / Math.max(1, effectiveMaxLValue - MIN_L_VALUE)));

        const weightScoreForTValue = (1 - currentTValue) / 0.99;      
        
        // 三個參數合併計分，權重配比 (K佔50%, L佔25%, T佔25%)
        const combinedPrivacyIntensityScoreValue = Math.min(1, Math.max(0, (weightScoreForKValue * 0.5) + (weightScoreForLValue * 0.25) + (weightScoreForTValue * 0.25)));

        // 換算為 15~95% 之間的圖表 Y 軸座標
        const optimalYCoordinateValue = 15 + (combinedPrivacyIntensityScoreValue * 80);

        // 根據 Y 值，在最優邊界線上對應的最高理想 X 軸可用性分數
        const optimalXCoordinateValue = 100 - Math.pow((optimalYCoordinateValue - 15) / 80, 2.5) * 85;

        // 3. 抑制率扣分懲罰強度計算 (若容忍高抑制率，代表實質被刪除的資料變多，因此必須對 X 軸的可用性扣分)
        const suppressionPenaltyScoreValue = maxSuppressionPercentageValue >= SUPPRESSION_PENALTY_THRESHOLD ? 0 : (SUPPRESSION_PENALTY_THRESHOLD - maxSuppressionPercentageValue) * 1.8;

        // 最終當前的資料效用座標點 (X軸)
        const penalizedXCoordinateValue = Math.max(2, optimalXCoordinateValue - Math.pow(suppressionPenaltyScoreValue, 1.2));

        // 組合成為畫面上的橘色標記點
        const currentDataPointCoordinatesArray = [Number(penalizedXCoordinateValue.toFixed(1)), Number(optimalYCoordinateValue.toFixed(1))];

        return {
            backgroundColor: 'transparent',
            tooltip: { 
                trigger: 'item', 
                textStyle: { fontSize: scaleChartFontSize(14, token.fontSize) },
                formatter: (tooltipParamsObj: TooltipParams) => 
                {
                    if (tooltipParamsObj.name === translate('step3.current_setting')) 
                    {
                        return `<div style="font-weight:bold;margin-bottom:4px;color:#faad14;">${translate('step3.chart_eval')}</div>
                                ${translate('step3.chart_utility')}${tooltipParamsObj.value[0]}%<br/>
                                ${translate('step3.chart_privacy')}${tooltipParamsObj.value[1]}%<br/>
                                <span style="font-size: calc(11px * var(--font-scale, 1)); color: #8c8c8c;">${translate('step3.chart_distance')}${(optimalXCoordinateValue - penalizedXCoordinateValue).toFixed(1)}%</span>`;
                    }

                    return tooltipParamsObj.seriesName === translate('step3.chart_pareto_front') 
                        ? `${translate('step3.chart_pareto_limit')}<br/>${translate('step3.chart_util_short')} ${tooltipParamsObj.data[0]}% | ${translate('step3.chart_priv_short')} ${tooltipParamsObj.data[1]}%` : '';
                } 
            },
            grid: { top: '15%', left: 130, right: '15%', bottom: '12%', containLabel: true },
            xAxis: { 
                type: 'value', min: 0, max: 100, name: translate('step3.chart_x_axis'), nameLocation: 'center', nameGap: 30, 
                nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500, fontSize: scaleChartFontSize(12, token.fontSize) }, 
                axisLabel: { formatter: '{value} %', color: token.colorTextDescription, fontSize: scaleChartFontSize(12, token.fontSize) }, 
                splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { lineStyle: { color: token.colorBorder } } 
            },
            yAxis: {
                type: 'value', min: 0, max: 100, name: translate('step3.chart_y_axis'), nameLocation: 'center', nameGap: 40, nameRotate: 0,
                nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500, fontSize: scaleChartFontSize(12, token.fontSize) },
                axisLabel: { formatter: '{value} %', color: token.colorTextDescription, fontSize: scaleChartFontSize(12, token.fontSize) },
                splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { lineStyle: { color: token.colorBorder } }
            },
            series: [
                { 
                    name: translate('step3.chart_pareto_front'), 
                    type: 'line', 
                    smooth: true, 
                    data: paretoLineDataCoordinatesArray, 
                    lineStyle: { color: isDarkModeActiveStatus ? '#5c6bc0' : '#3f51b5', width: 3 }, 
                    showSymbol: false,
                    areaStyle: {
                        color: {
                            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [
                                { offset: 0, color: isDarkModeActiveStatus ? 'rgba(92, 107, 192, 0.4)' : 'rgba(63, 81, 181, 0.4)' },
                                { offset: 1, color: isDarkModeActiveStatus ? 'rgba(92, 107, 192, 0.05)' : 'rgba(63, 81, 181, 0.05)' }
                            ]
                        }
                    }
                },
                {
                    name: 'Extremes',
                    type: 'scatter', 
                    data: [],
                    markPoint: {
                        symbol: 'circle',
                        data: [
                            { coord: [15, 95], name: translate('step3.extreme_privacy'), itemStyle: { color: '#722ed1' }, symbolSize: 8, label: { show: true, position: 'top', formatter: translate('step3.extreme_privacy'), color: token.colorTextDescription, fontSize: scaleChartFontSize(11, token.fontSize) } }, 
                            { coord: [100, 15], name: translate('step3.extreme_utility'), itemStyle: { color: '#13c2c2' }, symbolSize: 8, label: { show: true, position: 'right', offset: [6, 0], formatter: translate('step3.extreme_utility'), color: token.colorTextDescription, fontSize: scaleChartFontSize(11, token.fontSize) } }
                        ]
                    }
                },
                {
                    name: translate('step3.current_status'),
                    type: 'effectScatter',
                    coordinateSystem: 'cartesian2d',
                    data: [
                        { 
                            value: currentDataPointCoordinatesArray, 
                            name: translate('step3.current_setting'),
                            itemStyle: { color: '#faad14', ShadowBlur: 10, ShadowColor: 'rgba(250, 173, 20, 0.8)' }, 
                            symbolSize: 18, 
                            label: { 
                                show: true, position: 'top', 
                                formatter: `${translate('step3.current_setting')}\nU:${currentDataPointCoordinatesArray[0]}% P:${currentDataPointCoordinatesArray[1]}%`, 
                                fontWeight: 'bold', color: '#faad14', 
                                backgroundColor: isDarkModeActiveStatus ? '#141414' : '#fff', 
                                padding: [4, 6], borderRadius: 4, borderWidth: 1, borderColor: token.colorBorder, lineHeight: 16 
                            } 
                        }
                    ],
                    rippleEffect: { brushType: 'stroke', scale: 3 }
                }
            ]
        };
    };

    /**
     * ============================================================================
     * 欄位級即時防呆狀態判定 (供輸入框紅框標示與行內錯誤訊息使用)
     * ============================================================================
     * 規範對照: 與上方全頁驗證 Effect (setStepValidationAction) 採相同判斷邏輯，
     *           差異在於此處針對每個參數獨立判定，讓使用者能在左側對應欄位直接看到
     *           是哪個參數不合規，而非僅依賴頁面上方單一整體錯誤橫幅。
     */
    const isKValueBelowMinStatus = currentKValue === undefined || currentKValue === null || currentKValue < MIN_K_VALUE;
    const isKValueExceedsDatasetStatus = datasetRowCountValue > 0 && currentKValue > datasetRowCountValue;
    // ★ 未啟用 l-多樣性／t-緊密度檢測時，這兩個參數不會送給後端，畫面上也不應顯示紅框／錯誤提示
    const isKLessThanLStatus = isEnableLDiversityStatus && isLNotLessThanK(currentLValue, currentKValue); // ★ 2026-10-13：l 必須小於 K
    const isKValueInvalidStatus = isKValueBelowMinStatus || isKValueExceedsDatasetStatus || isKLessThanLStatus;
    const isTValueInvalidStatus = isEnableTClosenessStatus && (currentTValue === undefined || currentTValue === null || currentTValue <= 0 || currentTValue > 1);

    // ★ 使用者反映（2026-09-22）：這裡先前的說明文字把兩件不同的後端規則混在一起講，且已經
    //   過時，一併對照後端原始碼重新確認、修正：
    //   ① l-多樣性／t-緊密度：核對 app/engines/anonymization/pipeline.py 第 448~483 行，
    //      這是 K-匿名主流程（K-anon 品質報告）自己的檢測邏輯，用 `for s_col in valid_lt_cols`
    //      逐一走訪「所有」標記為敏感的欄位分別檢測，全部通過才算整體通過——後端這裡本來就
    //      支援 0 個（會標記為「未執行（無敏感欄位）」、不算通過，但不會出錯）或多個敏感欄位
    //      （逐一檢測），並沒有「恰好 1 個」的限制，先前寫成跟風險評估一樣的「恰好 1 個」是誤植。
    //   ② 風險評估（推斷性攻擊、CAP）：這才是真的有欄位數限制的部分，但 Step4_Result.tsx 已
    //      改版——0 個時顯示警告但不阻擋、直接略過三攻擊與 CAP；2 個以上時比照差分隱私模式，
    //      對每個敏感欄位各自輪流評估、取風險最高（最保守）的結果，不再需要「只能留一個、
    //      其餘分次執行」。
    //   故下方訊息不再宣稱「只能設一個」，0 個時維持提醒（l/t 會判定未執行、風險評估會被略過），
    //   2 個以上時改為說明「會怎麼評估」而非「這樣不行」。
    const sensitiveColumnsCountNumber = Object.values(columnPrivacyRolesMapDict).filter(
        (roleNameString) => roleNameString === 'Sensitive'
    ).length;
    const isMissingSensitiveColumnStatus = sensitiveColumnsCountNumber === 0;
    const isMultiSensitiveColumnStatus = sensitiveColumnsCountNumber >= 2;
    const sensitiveColumnWarningMessageText = isMissingSensitiveColumnStatus
        ? translate(
            'step3.missing_sensitive_column_warning',
            '尚未指定敏感欄位：l-多樣性／t-緊密度檢測會判定為「未執行」（不算通過），三攻擊與 CAP 風險評估也會被略過（不影響去識別化本身的資料與品質分數）。若需要這些檢測結果，請先回到 Step2 將至少一個欄位（例如疾病、收入區間等）的角色設為「敏感欄位」。'
        )
        : isMultiSensitiveColumnStatus
            ? translate(
                'step3.multi_sensitive_column_warning',
                { count: sensitiveColumnsCountNumber, defaultValue: `目前已設定 ${sensitiveColumnsCountNumber} 個敏感欄位：l-多樣性／t-緊密度會分別檢測這幾個欄位、須全部達標才算通過；三攻擊與 CAP 風險評估則會逐一評估每個欄位，取風險最高（最保守）的結果，不需要分次執行；每個欄位都要完整跑一輪，執行時間約為 1 個敏感欄位時的 ${sensitiveColumnsCountNumber} 倍。` }
            )
            : '';

    // ★ 2026-10-02：敏感欄位的處理方式與 l/t 檢測互相矛盾時即時提示（僅提示、不阻擋）。
    //   對照後端 app/engines/anonymization/pipeline.py：
    //   ① 處理方式為「移除」：該欄自輸出刪除，後端只對仍存在的敏感欄位做 l/t，等於這些欄位沒被檢測。
    //   ② 處理方式為遮蔽／雜湊（mask、hash；畫面已不提供，但可能經由匯入設定檔帶入）：檢測對象已非
    //      原始敏感值，後端不執行該欄檢測並直接判定 l/t「未通過」。
    const isAnyLtCheckEnabledStatus = isEnableLDiversityStatus || isEnableTClosenessStatus;
    const sensitiveFieldStrategyRecordsList = ((kAnonymityFieldsSnapshotList || []) as Array<Record<string, unknown>>)
        .filter((fieldRecord) => fieldRecord.role === 'Sensitive')
        .map((fieldRecord) => ({ name: String(fieldRecord.name || ''), strategy: String(fieldRecord.maskStrategy || 'none') }));
    const removedSensitiveColumnNamesList = isAnyLtCheckEnabledStatus
        ? sensitiveFieldStrategyRecordsList.filter((item) => item.strategy === 'remove').map((item) => item.name)
        : [];
    const maskedSensitiveColumnNamesList = isAnyLtCheckEnabledStatus
        ? sensitiveFieldStrategyRecordsList.filter((item) => item.strategy !== 'none' && item.strategy !== 'remove').map((item) => item.name)
        : [];
    const formatColumnNamesText = (namesList: string[]): string => namesList.map((name) => `「${name}」`).join('、');
    const removedSensitiveLtConflictMessageText = removedSensitiveColumnNamesList.length > 0
        ? translate('step3.sensitive_removed_lt_conflict', {
            columns: formatColumnNamesText(removedSensitiveColumnNamesList),
            defaultValue: `敏感欄位 ${formatColumnNamesText(removedSensitiveColumnNamesList)} 在 Step2 的處理方式為「移除」，去識別化後不會出現在輸出資料中，l-多樣性／t-緊密度不會檢測這些欄位（只檢測其餘保留的敏感欄位）。若要納入檢測，請回到 Step2 將處理方式改為「不處理」。`
        })
        : '';
    const maskedSensitiveLtConflictMessageText = maskedSensitiveColumnNamesList.length > 0
        ? translate('step3.sensitive_masked_lt_conflict', {
            columns: formatColumnNamesText(maskedSensitiveColumnNamesList),
            defaultValue: `敏感欄位 ${formatColumnNamesText(maskedSensitiveColumnNamesList)} 已設定遮蔽或雜湊，檢測對象已不是原始敏感值，後端會直接判定 l-多樣性／t-緊密度「未通過」。請回到 Step2 將處理方式改為「不處理」，或關閉 l／t 檢測。`
        })
        : '';

    const kLessThanLConflictMessageText = translate('step3.error_l_not_less_than_k', '參數衝突：l 必須小於 K（目前 K={{k}}、l={{l}}），請把 l 調到 {{max}} 以下。', { k: currentKValue, l: currentLValue, max: Math.max(MIN_L_VALUE, currentKValue - 1) });

    const kValueInlineErrorMessageText = isKValueBelowMinStatus
        ? translate('step3.error_k_too_small', 'K 值必須大於等於 2（K=1 等同於沒有匿名效果）。')
        : isKValueExceedsDatasetStatus
            ? translate('step3.error_k_exceeds_dataset', '參數錯誤：K 值 ({{k}}) 不可大於資料源總筆數 ({{rows}})。', { k: currentKValue, rows: datasetRowCountValue })
            : isKLessThanLStatus
                ? kLessThanLConflictMessageText
                : '';

    const tValueInlineErrorMessageText = isTValueInvalidStatus
        ? translate('step3.error_t_range', 'T-Closeness (t) 必須介於 0 與 1 之間。')
        : '';

    // ★ 2026-10-07 白話版：「自訂」保護強度與「進階」區塊的展開狀態（無提前 return，hooks 順序固定）
    const [isCustomKModeStatus, setIsCustomKModeStatus] = useState<boolean>(
        () => !K_PRESET_OPTIONS.some((presetOption) => presetOption.kValue === currentKValue)
    );
    // 已啟用 l／t，或敏感欄位處理方式與檢測衝突時，進階區塊預設展開，避免設定被藏起來
    const [isAdvancedOpenStatus, setIsAdvancedOpenStatus] = useState<boolean>(
        () => isEnableLDiversityStatus || isEnableTClosenessStatus || Boolean(removedSensitiveLtConflictMessageText) || Boolean(maskedSensitiveLtConflictMessageText)
    );

    /**
     * ============================================================================
     * ★ 2026-10-07 白話版版面（比照 Step4 白話版）
     * ============================================================================
     * 使用者反映：原本左側一排 k／l／t 滑桿＋抑制策略，沒有背景知識的使用者看不懂、無法快速上手。
     * 改為左側三區（① 保護強度卡 標準 K=3／加強 K=5／嚴格 K=10／自訂；② 湊不滿人數的資料：整筆刪除／只遮蔽欄位、
     * 上限、超過時；③ 進階 l／t，預設收合，已啟用或有衝突時自動展開），右側保留原 Pareto 示意圖並在下方列三個重點數字。
     * 使用者再要求：保留示意圖、文字越少越好——說明一律收進問號 Tooltip，畫面只留標題與短標籤。
     */
    const helpIcon = (tooltipContent: React.ReactNode): React.ReactNode => (
        <Tooltip title={tooltipContent}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
    );

    // 深色主題下主色 #3f51b5 當文字對比不足，改用較亮的靛藍
    const accentTextColor = isDarkModeActiveStatus ? '#9fa8ff' : token.colorPrimary;

    const sectionCardStyle: React.CSSProperties = {
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        padding: '18px 20px',
        boxShadow: isDarkModeActiveStatus ? 'none' : '0 2px 8px rgba(0,0,0,0.04)'
    };

    const renderSectionHeader = (stepNumberText: string, titleText: string, descriptionText?: React.ReactNode, tooltipText?: React.ReactNode): React.ReactNode => (
        <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: scaleFontSize(16), fontWeight: 700, color: token.colorText }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: token.colorPrimary, color: '#fff', fontSize: scaleFontSize(14), flexShrink: 0 }}>{stepNumberText}</span>
                {titleText}
                {tooltipText ? helpIcon(tooltipText) : null}
            </div>
            {descriptionText && <div style={{ marginTop: 6, fontSize: scaleFontSize(13), color: token.colorTextSecondary, lineHeight: 1.7 }}>{descriptionText}</div>}
        </div>
    );

    const renderChoiceCard = (choiceCardProps: PlainChoiceCardProps): React.ReactNode => {
        const { cardKey, isSelected, isDisabled, onSelect, titleText, badgeText, children, testId, disabledReasonText } = choiceCardProps;
        const cardElement = (
            <div
                key={cardKey}
                role="radio"
                aria-checked={isSelected}
                aria-disabled={isDisabled}
                tabIndex={isDisabled ? -1 : 0}
                data-testid={testId}
                onClick={() => { if (!isDisabled) onSelect(); }}
                onKeyDown={(keyboardEvent) => {
                    if (!isDisabled && (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ')) { keyboardEvent.preventDefault(); onSelect(); }
                }}
                style={{
                    flex: '1 1 0', minWidth: '7em', cursor: isDisabled ? 'not-allowed' : 'pointer', opacity: isDisabled ? 0.45 : 1,
                    padding: '12px 14px', borderRadius: 10, textAlign: 'left',
                    border: `2px solid ${isSelected ? accentTextColor : token.colorBorder}`,
                    background: isSelected ? token.colorPrimaryBg : token.colorBgContainer,
                    transition: 'border-color .15s, background .15s'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: scaleFontSize(16), fontWeight: 700, color: isSelected ? accentTextColor : token.colorText }}>
                    {isSelected
                        ? <CheckCircleFilled />
                        : <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${token.colorBorder}`, display: 'inline-block', flexShrink: 0 }} />}
                    {titleText}
                    {badgeText && <Tag color="blue" style={{ marginInlineStart: 2, marginInlineEnd: 0 }}>{badgeText}</Tag>}
                </div>
                <div style={{ marginTop: 6, fontSize: scaleFontSize(13), color: token.colorTextSecondary, lineHeight: 1.6 }}>{children}</div>
            </div>
        );
        return isDisabled && disabledReasonText ? <Tooltip key={cardKey} title={disabledReasonText}>{cardElement}</Tooltip> : cardElement;
    };

    // ── ① 保護強度 ──
    const matchedKPresetOption = K_PRESET_OPTIONS.find((presetOption) => presetOption.kValue === currentKValue);
    const isCustomKSelectedStatus = isCustomKModeStatus || !matchedKPresetOption;

    const handleSelectKPreset = (presetKValue: number): void => {
        setIsCustomKModeStatus(false);
        handleKValueChange(presetKValue);
    };
    const safeKForTextValue = Math.max(1, currentKValue || 1);
    const guessChancePercentText = `${Math.round(100 / safeKForTextValue)}%`;

    // ── ② 無法歸群的資料 ──
    const isCellSuppressionStatus = currentSuppressionMethodTypeStr === 'cell' || currentSuppressionMethodTypeStr === 'cell_suppression';
    const approxSuppressibleRowCountValue = datasetRowCountValue > 0 ? Math.floor(datasetRowCountValue * (maxSuppressionPercentageValue || 0) / 100) : 0;
    const suppressionLimitPlainText = datasetRowCountValue > 0
        ? translate('step3.plain_suppress_limit_rows', '約 {{n}} 筆（共 {{total}} 筆）', { n: approxSuppressibleRowCountValue.toLocaleString(), total: datasetRowCountValue.toLocaleString() })
        : '';

    // ── 右側：示意圖下方的三個重點數字 ──
    const protectionLevelLabelText = isCustomKSelectedStatus || !matchedKPresetOption
        ? translate('step3.plain_level_custom_k', '自訂 K={{k}}', { k: currentKValue })
        : translate(`step3.plain_level_${matchedKPresetOption.key}`, matchedKPresetOption.titleText);
    const protectionLevelColor = isKValueInvalidStatus
        ? token.colorError
        : currentKValue >= 5 ? token.colorSuccess : currentKValue >= 3 ? accentTextColor : token.colorWarning;

    const summaryStatsList: Array<{ key: string; label: string; value: React.ReactNode; color?: string; tooltip?: string }> = [
        { key: 'level', label: translate('step3.plain_sum_level', '保護強度'), value: protectionLevelLabelText, color: protectionLevelColor },
        {
            key: 'guess',
            label: translate('step3.plain_sum_guess_short', '被認出機率'),
            value: translate('step3.plain_sum_guess_value', '≤ {{pct}}', { pct: guessChancePercentText }),
            tooltip: translate('step3.plain_sum_guess_tip', '每群至少 {{k}} 筆資料在可識別欄位上完全相同，猜中是其中哪一筆的機會最多 1/{{k}}。', { k: currentKValue })
        },
        {
            key: 'suppress',
            label: isCellSuppressionStatus ? translate('step3.plain_sum_cell_short', '最多遮蔽') : translate('step3.plain_sum_row_short', '最多刪除'),
            value: datasetRowCountValue > 0
                ? translate('step3.plain_sum_rows_value', '{{n}} 筆', { n: approxSuppressibleRowCountValue.toLocaleString() })
                : `${maxSuppressionPercentageValue}%`
        }
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Alert
                type="info"
                showIcon
                style={{ textAlign: 'left' }}
                title={translate('step3.plain_intro_short', '選一個保護強度即可進入下一步，其餘已帶入建議值。')}
            />
            {/* ★ 2026-10-21 使用者要求：Step3 加但書（參數只是建議值） */}
            <Alert
                type="warning"
                showIcon
                data-testid="kanon-step3-disclaimer"
                style={{ textAlign: 'left' }}
                title={translate('step3.disclaimer_kanon', '保護強度與各項數值為系統建議值，僅供參考。是否足夠，請依資料用途、提供對象及相關法規（如個人資料保護法）自行判斷；本工具無法保證處理後的資料完全無法被識別。')}
            />

            <Row gutter={[20, 16]} align="stretch">
                {/* 左側：設定 */}
                <Col xs={24} xl={11}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                        {/* ① 保護強度 */}
                        <div style={sectionCardStyle} data-testid="kanon-plain-protection">
                            {renderSectionHeader('1', translate('step3.plain_sec1_title', '保護強度'), undefined, (
                                <div style={{ lineHeight: 1.7 }}>
                                    <div>{translate('step3.plain_sec1_src_intro', '三個選項參考國外去識別化指引的再識別風險上限（K = 1 ÷ 風險上限）：')}</div>
                                    <div>{translate('step3.plain_sec1_src_standard', '・標準 K=3：英國 NHS 健康與社福資料「弱匿名」，風險 ≤ 33%')}</div>
                                    <div>{translate('step3.plain_sec1_src_enhanced', '・加強 K=5：英國 NHS「強匿名」，風險 ≤ 20%')}</div>
                                    <div>{translate('step3.plain_sec1_src_strict', '・嚴格 K=12：歐盟藥物管理局 EMA、加拿大安大略省 IPCO 低風險個資，風險 ≤ 9%')}</div>
                                    <div style={{ marginTop: 4 }}>{translate('step3.plain_sec1_src_note', '各國標準不同，我國尚無統一數值，請依資料敏感程度與提供對象選擇。')}</div>
                                </div>
                            ))}
                            <div role="radiogroup" aria-label={translate('step3.plain_sec1_title', '保護強度')} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                {K_PRESET_OPTIONS.map((presetOption) => renderChoiceCard({
                                    cardKey: presetOption.key,
                                    testId: `kanon-preset-${presetOption.key}`,
                                    isSelected: !isCustomKSelectedStatus && currentKValue === presetOption.kValue,
                                    isDisabled: datasetRowCountValue > 0 && presetOption.kValue > effectiveMaxKValue,
                                    disabledReasonText: translate('step3.plain_preset_disabled', '資料只有 {{rows}} 筆', { rows: datasetRowCountValue }),
                                    onSelect: () => handleSelectKPreset(presetOption.kValue),
                                    titleText: translate(`step3.plain_level_${presetOption.key}`, presetOption.titleText),
                                    badgeText: presetOption.isDefault ? translate('step3.plain_badge_default', '預設') : undefined,
                                    children: translate('step3.plain_preset_k', '每群 ≥ {{k}} 筆資料', { k: presetOption.kValue })
                                }))}
                                {renderChoiceCard({
                                    cardKey: 'custom',
                                    testId: 'kanon-preset-custom',
                                    isSelected: isCustomKSelectedStatus,
                                    isDisabled: false,
                                    onSelect: () => setIsCustomKModeStatus(true),
                                    titleText: translate('step3.plain_level_custom', '自訂'),
                                    children: translate('step3.plain_preset_custom_desc', '自行設定 K')
                                })}
                            </div>

                            {isCustomKSelectedStatus && (
                                <Row gutter={12} align="middle" style={{ marginTop: 14 }}>
                                    <Col flex="none">
                                        <span style={{ color: isKValueInvalidStatus ? token.colorError : token.colorText }}>K</span>
                                        {helpIcon(translate('step3.k_value_tooltip'))}
                                    </Col>
                                    <Col flex="auto"><Slider min={MIN_K_VALUE} max={kSliderMaxValue} value={Math.min(currentKValue ?? MIN_K_VALUE, kSliderMaxValue)} onChange={handleKValueChange} /></Col>
                                    <Col flex="7em"><InputNumber aria-label="k-anonymity (k)" min={MIN_K_VALUE} max={effectiveMaxKValue} value={currentKValue} onChange={handleKValueChange} status={isKValueInvalidStatus ? 'error' : undefined} style={{ width: '100%' }} /></Col>
                                </Row>
                            )}
                            {!isKValueInvalidStatus && Number(currentKValue) > K_LARGE_WARNING_THRESHOLD && (
                                <div data-testid="kanon-k-large-warning" style={{ marginTop: 8, color: token.colorWarning, fontSize: scaleFontSize(13) }}>
                                    <WarningOutlined style={{ marginRight: 4 }} />
                                    {translate('step3.k_large_warning', 'K = {{k}} 很大：筆數不滿 {{k}} 的分組都會被刪除或遮蔽，處理後的資料可能少很多，請到 Step4 確認刪除比例。', { k: currentKValue })}
                                </div>
                            )}
                            {isKValueInvalidStatus && (
                                <div style={{ marginTop: 8, color: token.colorError, fontSize: scaleFontSize(13) }}>
                                    <WarningOutlined style={{ marginRight: 4 }} />{kValueInlineErrorMessageText}
                                </div>
                            )}
                            {/* ★ 2026-10-08 諮詢會：資料筆數納入考量（完整掃描完成後才顯示，避免以預覽筆數誤判規模） */}
                            <DatasetScaleHint mode="k-anonymity" rowCount={datasetProfileSnapshot ? datasetRowCountValue : 0} kValue={currentKValue} />
                        </div>

                        {/* ② 湊不滿 K 筆的資料 */}
                        <div style={sectionCardStyle} data-testid="kanon-plain-suppression">
                            {renderSectionHeader('2', translate('step3.plain_sec2_title', '湊不滿 K 筆的資料'), undefined, translate('step3.suppress_method_tooltip'))}

                            <div role="radiogroup" aria-label={translate('step3.suppress_method')} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                {renderChoiceCard({
                                    cardKey: 'row',
                                    testId: 'kanon-suppress-row',
                                    isSelected: !isCellSuppressionStatus,
                                    isDisabled: false,
                                    onSelect: () => handleSuppressionMethodChange('row_suppression'),
                                    titleText: translate('step3.plain_row_title', '整筆刪除'),
                                    badgeText: translate('step3.plain_badge_default', '預設'),
                                    children: translate('step3.plain_row_desc', '整筆資料移除')
                                })}
                                {renderChoiceCard({
                                    cardKey: 'cell',
                                    testId: 'kanon-suppress-cell',
                                    isSelected: isCellSuppressionStatus,
                                    isDisabled: false,
                                    onSelect: () => handleSuppressionMethodChange('cell_suppression'),
                                    titleText: translate('step3.plain_cell_title', '只遮蔽欄位'),
                                    children: translate('step3.plain_cell_desc', '保留資料，只隱藏部分欄位')
                                })}
                            </div>

                            {isCellSuppressionStatus && (
                                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}` }}>
                                    <Row align="middle" gutter={12} style={{ marginBottom: filteredQuasiIdentifierColumnsList.length > 0 ? 10 : 0 }}>
                                        <Col flex="8em">
                                            <span style={{ color: token.colorTextSecondary, fontSize: scaleFontSize(13) }}>{translate('step3.plain_cell_fill_label', '預設填入')}</span>
                                            {helpIcon(translate('step3.cell_fill_method_tooltip'))}
                                        </Col>
                                        <Col flex="auto">
                                            <Select value={currentCellFillMethodTypeStr} onChange={handleCellFillMethodChange} size="small" style={{ width: '100%', maxWidth: '16em' }}
                                                options={[{ value: 'star', label: translate('step3.plain_cell_fill_star', '星號 *') }, { value: 'missing', label: translate('step3.plain_cell_fill_missing', '缺失值（空值）') }]} />
                                        </Col>
                                    </Row>
                                    {filteredQuasiIdentifierColumnsList.length > 0 && (
                                        <Row align="top" gutter={12} data-testid="cell-fill-values-by-column">
                                            <Col flex="8em">
                                                <span style={{ color: token.colorTextSecondary, fontSize: scaleFontSize(13) }}>{translate('step3.plain_cell_fill_by_column', '自訂文字')}</span>
                                                {helpIcon(translate('step3.plain_cell_fill_by_column_tip', '可替個別欄位指定填入的文字，例如地區填「臺灣」、職業填「其他」；留空的欄位沿用「預設填入」。'))}
                                            </Col>
                                            <Col flex="auto">
                                                <Space orientation="vertical" size={6} style={{ width: '100%', maxWidth: '23em' }}>
                                                    {filteredQuasiIdentifierColumnsList.map((columnNameString: string) => (
                                                        <Space.Compact key={columnNameString} size="small" style={{ width: '100%' }}>
                                                            <span style={{ width: '40%', display: 'inline-flex', alignItems: 'center', padding: '0 8px', fontSize: scaleFontSize(12), color: token.colorText, border: `1px solid ${token.colorBorder}`, borderRight: 'none', borderRadius: '4px 0 0 4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={columnNameString}>{columnNameString}</span>
                                                            <Input
                                                                size="small"
                                                                allowClear
                                                                aria-label={`${columnNameString} cell_fill_value`}
                                                                value={cellFillValuesByColumnMap?.[columnNameString] ?? ''}
                                                                placeholder={currentCellFillMethodTypeStr === 'missing' ? translate('step3.cell_fill_value_ph_missing', '未填：空值') : translate('step3.cell_fill_value_ph_star', '未填：*')}
                                                                onChange={(inputChangeEvent) => handleCellFillValueChange(columnNameString, inputChangeEvent.target.value)}
                                                                style={{ width: '60%' }}
                                                            />
                                                        </Space.Compact>
                                                    ))}
                                                </Space>
                                            </Col>
                                        </Row>
                                    )}
                                </div>
                            )}

                            <Row gutter={12} align="middle" style={{ marginTop: 14 }}>
                                <Col flex="none">
                                    <span style={{ color: token.colorText }}>{translate('step3.plain_limit_label', '上限')}</span>
                                    {helpIcon(translate('step3.suppress_limit_tooltip'))}
                                </Col>
                                <Col flex="auto"><Slider min={MIN_SUPPRESSION_PERCENT} max={MAX_SUPPRESSION_PERCENT} value={maxSuppressionPercentageValue} onChange={handleMaxSuppressionChange} /></Col>
                                <Col flex="7.5em">
                                    <Space.Compact style={{ width: '100%' }}>
                                        <InputNumber aria-label={translate('step3.suppress_limit')} min={MIN_SUPPRESSION_PERCENT} max={MAX_SUPPRESSION_PERCENT} value={maxSuppressionPercentageValue} onChange={handleMaxSuppressionChange} precision={2} step={0.01} style={{ width: '100%' }} />
                                        <span className="ant-input-group-addon" style={{ fontSize: scaleFontSize(12), padding: '0 8px', display: 'flex', alignItems: 'center' }}>%</span>
                                    </Space.Compact>
                                </Col>
                            </Row>
                            {suppressionLimitPlainText && (
                                <div style={{ fontSize: scaleFontSize(12), color: token.colorTextDescription }}>{suppressionLimitPlainText}</div>
                            )}

                            <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
                                <Col flex="none">
                                    <span style={{ color: token.colorText }}>{translate('step3.plain_exceed_label', '超過上限')}</span>
                                    {helpIcon(translate('step3.exceed_behavior_tooltip'))}
                                </Col>
                                <Col flex="auto">
                                    {/* 後端 limit_exceeded_action 只接受 stop_and_error／allow_with_warning（relax_k 後端未實作、已移除） */}
                                    <Radio.Group
                                        value={currentLimitExceededActionTypeStr}
                                        onChange={(radioChangeEvent) => handleLimitExceededActionChange(radioChangeEvent.target.value)}
                                        options={[
                                            { value: 'stop_and_error', label: translate('step3.plain_exceed_stop', '停止') },
                                            { value: 'allow_with_warning', label: translate('step3.plain_exceed_allow', '仍產出（標示未達標）') }
                                        ]}
                                    />
                                </Col>
                            </Row>
                        </div>

                        {/* ③ 進階：敏感資料 */}
                        <div style={sectionCardStyle} data-testid="kanon-plain-advanced">
                            <div
                                role="button"
                                tabIndex={0}
                                aria-expanded={isAdvancedOpenStatus}
                                onClick={() => setIsAdvancedOpenStatus(!isAdvancedOpenStatus)}
                                onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') { keyboardEvent.preventDefault(); setIsAdvancedOpenStatus(!isAdvancedOpenStatus); } }}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                            >
                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: token.colorFillSecondary, color: token.colorText, fontSize: scaleFontSize(13), flexShrink: 0 }}>3</span>
                                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: scaleFontSize(16), fontWeight: 700, color: token.colorText }}>
                                    {translate('step3.plain_sec3_title', '進階：敏感資料保護')}
                                    {helpIcon(translate('step3.plain_sec3_tip', '檢查每一群的敏感資料（例如病名）是否夠多樣，避免整群都一樣而被猜出。一般情況可不設定。'))}
                                    {isAnyLtCheckEnabledStatus && <Tag color="green">{translate('step3.plain_enabled', '已啟用')}</Tag>}
                                    {(removedSensitiveLtConflictMessageText || maskedSensitiveLtConflictMessageText) && <Tag color="orange">{translate('step3.plain_needs_check', '需確認')}</Tag>}
                                </span>
                                <span style={{ color: token.colorTextSecondary }}>{isAdvancedOpenStatus ? <UpOutlined /> : <DownOutlined />}</span>
                            </div>
                            {/* ★ 2026-10-08 使用者要求：l／t 預設關閉；說明不開也能計算，開啟的取捨（收合時也看得到） */}
                            <div data-testid="kanon-advanced-optional-note" style={{ marginTop: 6, marginLeft: 34, fontSize: scaleFontSize(13), color: token.colorTextSecondary }}>
                                {translate('step3.plain_sec3_optional_note', '不開也能計算；開啟後保護更強，但可能刪除更多筆。')}
                            </div>

                            {isAdvancedOpenStatus && (
                                <div style={{ marginTop: 14 }}>
                                    {(isMissingSensitiveColumnStatus || isMultiSensitiveColumnStatus) && (
                                        <Alert type={isMissingSensitiveColumnStatus ? 'warning' : 'info'} showIcon style={{ marginBottom: 10, textAlign: 'left' }}
                                            title={isMissingSensitiveColumnStatus ? translate('step3.plain_no_sensitive', '尚未在 Step2 指定敏感欄位') : translate('step3.plain_multi_sensitive', '共 {{n}} 個敏感欄位，會逐一檢查', { n: sensitiveColumnsCountNumber })}
                                            action={helpIcon(sensitiveColumnWarningMessageText)} />
                                    )}
                                    {removedSensitiveLtConflictMessageText && (
                                        <Alert type="warning" showIcon style={{ marginBottom: 10, textAlign: 'left' }} title={removedSensitiveLtConflictMessageText} />
                                    )}
                                    {maskedSensitiveLtConflictMessageText && (
                                        <Alert type="error" showIcon style={{ marginBottom: 10, textAlign: 'left' }} title={maskedSensitiveLtConflictMessageText} />
                                    )}

                                    {/* l-多樣性 */}
                                    <div style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}`, marginBottom: 10 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                            <span style={{ color: token.colorText }}>
                                                {translate('step3.plain_l_title', '敏感值種類（l）')}
                                                {helpIcon(translate('step3.l_value_tooltip'))}
                                            </span>
                                            <Switch aria-label={translate('step3.enable_l_diversity', '啟用 l-多樣性檢測')} checked={isEnableLDiversityStatus} onChange={handleEnableLDiversityChange} />
                                        </div>
                                        {isEnableLDiversityStatus && (
                                            <>
                                                <Row gutter={12} align="middle" style={{ marginTop: 8 }}>
                                                    <Col flex="auto"><Slider min={MIN_L_VALUE} max={effectiveMaxLValue} value={currentLValue} onChange={handleLValueChange} /></Col>
                                                    <Col flex="7em"><InputNumber aria-label="l-diversity (l)" min={MIN_L_VALUE} max={effectiveMaxLValue} value={currentLValue} onChange={handleLValueChange} status={isKLessThanLStatus || isLExceedsSensitiveDistinctStatus ? 'error' : undefined} style={{ width: '100%' }} /></Col>
                                                </Row>
                                                <div style={{ fontSize: scaleFontSize(12), color: isLExceedsSensitiveDistinctStatus ? token.colorError : token.colorTextDescription }}>
                                                    {translate('step3.plain_l_max', '上限 {{max}}', { max: effectiveMaxLValue })}
                                                    {helpIcon(sensitiveColumnDistinctCountInfo
                                                        ? translate('step3.l_max_hint_sensitive_v2', '上限 {{max}}（l 必須小於 K）。敏感欄位「{{column}}」有 {{count}} 種不同的值，l 超過 {{count}} 一定無法通過。', { max: effectiveMaxLValue, column: sensitiveColumnDistinctCountInfo.columnName, count: sensitiveColumnDistinctCountInfo.distinctCount })
                                                        : translate('step3.l_max_hint_default_v2', '上限 {{max}}（l 必須小於 K）。尚未設定敏感欄位或尚未載入資料，無法檢查敏感欄位有幾種值。', { max: effectiveMaxLValue }))}
                                                </div>
                                                {isLExceedsSensitiveDistinctStatus && sensitiveColumnDistinctCountInfo && (
                                                    <div data-testid="l-exceeds-sensitive-distinct" style={{ marginTop: 4, color: token.colorError, fontSize: scaleFontSize(12) }}><WarningOutlined style={{ marginRight: 4 }} />{translate('step3.error_l_exceeds_sensitive_distinct', '敏感欄位「{{column}}」只有 {{count}} 種不同的值，任何群組都湊不出 {{l}} 種，l 設為 {{l}} 一定無法通過。請把 l 調到 {{count}} 以下，或回 Step2 確認敏感欄位是否選對。', { l: currentLValue, column: sensitiveColumnDistinctCountInfo.columnName, count: sensitiveColumnDistinctCountInfo.distinctCount })}</div>
                                                )}
                                                {isKLessThanLStatus && (
                                                    <div style={{ marginTop: 4, color: token.colorError, fontSize: scaleFontSize(12) }}><WarningOutlined style={{ marginRight: 4 }} />{kLessThanLConflictMessageText}</div>
                                                )}
                                            </>
                                        )}
                                    </div>

                                    {/* t-緊密度 */}
                                    <div style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}` }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                            <span style={{ color: token.colorText }}>
                                                {translate('step3.plain_t_title', '分布差距（t）')}
                                                {helpIcon(translate('step3.t_value_tooltip'))}
                                            </span>
                                            <Switch aria-label={translate('step3.enable_t_closeness', '啟用 t-緊密度檢測')} checked={isEnableTClosenessStatus} onChange={handleEnableTClosenessChange} />
                                        </div>
                                        {isEnableTClosenessStatus && (
                                            <>
                                                <Row gutter={12} align="middle" style={{ marginTop: 8 }}>
                                                    <Col flex="auto"><Slider min={MIN_T_VALUE} max={MAX_T_VALUE} step={MIN_T_VALUE} value={currentTValue} onChange={handleTValueChange} /></Col>
                                                    <Col flex="7em"><InputNumber aria-label="t-closeness (t)" min={MIN_T_VALUE} max={MAX_T_VALUE} step={MIN_T_VALUE} value={currentTValue} onChange={handleTValueChange} status={isTValueInvalidStatus ? 'error' : undefined} style={{ width: '100%' }} /></Col>
                                                </Row>
                                                {isTValueInvalidStatus && (
                                                    <div style={{ color: token.colorError, fontSize: scaleFontSize(12) }}><WarningOutlined style={{ marginRight: 4 }} />{tValueInlineErrorMessageText}</div>
                                                )}
                                            </>
                                        )}
                                    </div>

                                    {/* 計算範圍（暫時隱藏，見檔案上方 SHOW_QI_COMBINATION_SCOPE 說明） */}
                                    {SHOW_QI_COMBINATION_SCOPE && (
                                        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            <span style={{ color: token.colorTextSecondary, fontSize: scaleFontSize(12) }}>{translate('step3.calc_scope')}{helpIcon(translate('step3.calc_scope_tooltip'))}</span>
                                            <Select value={calculationModeType} onChange={(dropdownSelectedModeValue) => setCalculationModeType(dropdownSelectedModeValue as 'all' | 'custom')} size="small" options={[{ value: 'all', label: translate('step3.apply_all_qi') }, { value: 'custom', label: translate('step3.custom_qi_combo') }]} />
                                            {calculationModeType === 'custom' && quasiIdentifierCombinationsList.map((combinationItemArray, combinationRowIndexNumber) => (
                                                <div key={combinationRowIndexNumber} style={{ display: 'flex', gap: 8 }}>
                                                    <Select mode="multiple" allowClear placeholder={translate('step3.select_field')} style={{ flex: 1 }} value={combinationItemArray}
                                                        onChange={(dropdownSelectedValuesArray) => updateCombination(combinationRowIndexNumber, dropdownSelectedValuesArray)}
                                                        options={quasiIdentifierColumnsArray.map((columnName: string) => ({ label: columnName, value: columnName }))} />
                                                    <Button danger icon={<DeleteOutlined />} disabled={quasiIdentifierCombinationsList.length === 1} onClick={() => removeCombination(combinationRowIndexNumber)} />
                                                </div>
                                            ))}
                                            {calculationModeType === 'custom' && <Button type="dashed" icon={<PlusOutlined />} onClick={addCombination}>{translate('step3.add_threat_combo')}</Button>}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </Col>

                {/* 右側：原 Step3 隱私與效用空間示意圖＋三個重點數字 */}
                <Col xs={24} xl={13}>
                    <div style={{ ...sectionCardStyle, boxSizing: 'border-box', height: '100%', display: 'flex', flexDirection: 'column' }} data-testid="kanon-plain-summary">
                        <div style={{ fontSize: scaleFontSize(16), fontWeight: 700, color: token.colorText }}>
                            {translate('step3.solution_space')}
                            {helpIcon(translate('step3.plain_chart_tip', '示意圖：越往上越安全、越往右資料越完整，兩者無法兼得。橘點為目前設定，僅供參考，實際結果以下一步運算為準。'))}
                        </div>
                        <ReactECharts option={getKAnonymityChartOption()} style={{ height: '380px', width: '100%' }} theme={isDarkModeActiveStatus ? 'dark' : 'light'} />
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {summaryStatsList.map((statItem) => (
                                <div key={statItem.key} data-testid={`kanon-plain-sum-${statItem.key}`} style={{ flex: '1 1 0', minWidth: '8em', padding: '10px 12px', borderRadius: 8, background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}` }}>
                                    <div style={{ fontSize: scaleFontSize(12), color: token.colorTextSecondary }}>
                                        {statItem.label}
                                        {statItem.tooltip ? helpIcon(statItem.tooltip) : null}
                                    </div>
                                    <div data-testid={statItem.key === 'level' ? 'kanon-plain-level' : undefined} style={{ fontSize: scaleFontSize(20), fontWeight: 700, color: statItem.color || token.colorText, lineHeight: 1.3 }}>{statItem.value}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </Col>
            </Row>
        </div>
    );
}
