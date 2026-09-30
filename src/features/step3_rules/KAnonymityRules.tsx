/**
 * ============================================================================
 * 檔案名稱 (File): KAnonymityRules.tsx
 * 模組功能 (Description): K-匿名參數設定與帕累托邊界模擬組件 (提供 K/L/T 參數控制、抑制率策略設定與 Pareto Front 隱私效用圖表模擬)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Alert, Card, Slider, Row, Col, Divider, InputNumber, theme, Select, Button, Tag, Space, Tooltip, Switch } from 'antd';
import { LockOutlined, PlusOutlined, DeleteOutlined, WarningOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore } from '../../store/useWorkspaceStore';

/**
 * ============================================================================
 * 預設臨界點常數宣告 (Magic Numbers Constants)
 * ============================================================================
 */
const MIN_K_VALUE = 2;                     // K 值最小限制 (低於 2 等同無匿名效果)
const MAX_K_VALUE = 100;                    // K 值最大限制 (過大會導致資料破壞嚴重)
const MIN_L_VALUE = 1;                     // L 值最小限制
const MAX_L_VALUE = 10;                    // L 值最大限制（僅在尚未設定敏感欄位／尚未載入資料時作為備援上限，見 effectiveMaxLValue）
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

    const currentLimitExceededActionTypeStr = useWorkspaceStore(
        (state) => state.limitExceededAction
    );                                                     // 抑制率超限處置動作

    const datasetColumnsListArray = useWorkspaceStore(
        (state) => state.columns
    ) || [];                                               // 數據欄位名稱清單

    const datasetRowsListArray = useWorkspaceStore(
        (state) => state.previewData
    ) || [];                                               // 數據資料列清單 (用於計算資料源筆數上限)

    const datasetRowCountValue = datasetRowsListArray.length; // 資料源總筆數 (0 代表尚未載入資料)

    // K 值實際可選上限：不得超過資料源筆數，亦不得超過系統設定之 MAX_K_VALUE
    const effectiveMaxKValue = datasetRowCountValue > 0
        ? Math.min(MAX_K_VALUE, datasetRowCountValue)
        : MAX_K_VALUE;

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
    // 直接取 store 原始參考值當相依，避免上方 `|| {}`／`|| []` 每次 render 產生新物件，導致每次都重掃整份資料。
    const rawColumnRolesMapForLUpper = useWorkspaceStore((state) => state.columnRoles);
    const rawDatasetRowsForLUpper = useWorkspaceStore((state) => state.previewData);
    const sensitiveColumnDistinctCountInfo = useMemo((): { columnName: string; distinctCount: number } | null => {
        const columnPrivacyRolesMapDict = rawColumnRolesMapForLUpper || {};
        const datasetRowsListArray = rawDatasetRowsForLUpper || [];
        const sensitiveColumnNamesList = Object.keys(columnPrivacyRolesMapDict).filter(
            (columnNameKey) => columnPrivacyRolesMapDict[columnNameKey] === 'Sensitive'
        );
        if (sensitiveColumnNamesList.length === 0 || datasetRowsListArray.length === 0) return null;
        const cleanColumnName = (rawName: string): string => rawName.replace(/^[\uFEFF\u200B]+/, '').trim();
        let minimumInfo: { columnName: string; distinctCount: number } | null = null;
        sensitiveColumnNamesList.forEach((sensitiveColumnName) => {
            const cleanSensitiveName = cleanColumnName(sensitiveColumnName);
            const matchedRowKey = Object.keys(datasetRowsListArray[0] || {}).find((rowKey) => cleanColumnName(rowKey) === cleanSensitiveName);
            if (!matchedRowKey) return;
            const distinctValuesSet = new Set<string>();
            for (const rowRecord of datasetRowsListArray) {
                const cellValue = (rowRecord as Record<string, unknown>)[matchedRowKey];
                if (cellValue === undefined || cellValue === null || String(cellValue).trim() === '') continue;
                distinctValuesSet.add(String(cellValue).trim());
            }
            if (!minimumInfo || distinctValuesSet.size < minimumInfo.distinctCount) {
                minimumInfo = { columnName: cleanSensitiveName, distinctCount: distinctValuesSet.size };
            }
        });
        return minimumInfo;
    }, [rawColumnRolesMapForLUpper, rawDatasetRowsForLUpper]);
    const sensitiveDistinctUpperLValue = sensitiveColumnDistinctCountInfo
        ? Math.max(MIN_L_VALUE, sensitiveColumnDistinctCountInfo.distinctCount)
        : MAX_L_VALUE;
    // l 值實際可選上限：不得超過敏感欄位相異值數，亦不得超過目前 k 值（K ≥ L 的數學限制）
    const effectiveMaxLValue = Math.max(
        MIN_L_VALUE,
        Math.min(sensitiveDistinctUpperLValue, typeof currentKValue === 'number' && currentKValue >= MIN_L_VALUE ? currentKValue : sensitiveDistinctUpperLValue)
    );
    // 例如匯入的設定檔 l=8，但敏感欄位只有 5 種值：必定無法通過，需提示並擋下一步
    const isLExceedsSensitiveDistinctStatus = isEnableLDiversityStatus && !!sensitiveColumnDistinctCountInfo && currentLValue > sensitiveColumnDistinctCountInfo.distinctCount;

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

            // 3. 驗證 K 必須大於等於 L (L-Diversity 數學限制：多樣性類別數不可能超過群組筆數)
            //    ★ 僅在使用者實際啟用 l-多樣性檢測時才驗證，未啟用時 l 值不會送給後端，不需卡關。
            if (isEnableLDiversityStatus && currentKValue < currentLValue)
            {
                setStepValidationAction(false, translate(
                    'step3.error_k_less_than_l',
                    '參數衝突：要求資料具備 {{l}} 種多樣性 (L={{l}})，但群組大小僅有 {{k}} (K={{k}})，這是數學上無法達成的。請確保 K ≥ L。',
                    { k: currentKValue, l: currentLValue }
                ));

                return;
            }

            // 3-2. 驗證 L 不可超過敏感欄位相異值數（否則每個等價類都不可能湊出 L 種敏感值，必定不通過）
            if (isLExceedsSensitiveDistinctStatus && sensitiveColumnDistinctCountInfo)
            {
                setStepValidationAction(false, translate(
                    'step3.error_l_exceeds_sensitive_distinct',
                    '參數衝突：L={{l}}，但敏感欄位「{{column}}」只有 {{count}} 種不同的值，任何群組都不可能湊出 {{l}} 種，l-多樣性必定無法通過。請將 L 調整為 {{count}} 以下。',
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
        [currentKValue, currentLValue, currentTValue, maxSuppressionPercentageValue, datasetRowCountValue, isEnableLDiversityStatus, isEnableTClosenessStatus, setStepValidationAction, translate, isLExceedsSensitiveDistinctStatus, sensitiveColumnDistinctCountInfo]
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
                formatter: (tooltipParamsObj: TooltipParams) => 
                {
                    if (tooltipParamsObj.name === translate('step3.current_setting')) 
                    {
                        return `<div style="font-weight:bold;margin-bottom:4px;color:#faad14;">${translate('step3.chart_eval')}</div>
                                ${translate('step3.chart_utility')}${tooltipParamsObj.value[0]}%<br/>
                                ${translate('step3.chart_privacy')}${tooltipParamsObj.value[1]}%<br/>
                                <span style="font-size: 11px; color: #8c8c8c;">${translate('step3.chart_distance')}${(optimalXCoordinateValue - penalizedXCoordinateValue).toFixed(1)}%</span>`;
                    }

                    return tooltipParamsObj.seriesName === translate('step3.chart_pareto_front') 
                        ? `${translate('step3.chart_pareto_limit')}<br/>${translate('step3.chart_util_short')} ${tooltipParamsObj.data[0]}% | ${translate('step3.chart_priv_short')} ${tooltipParamsObj.data[1]}%` : '';
                } 
            },
            grid: { top: '15%', left: '8%', right: '15%', bottom: '12%', containLabel: true },
            xAxis: { 
                type: 'value', min: 0, max: 100, name: translate('step3.chart_x_axis'), nameLocation: 'center', nameGap: 30, 
                nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500 }, 
                axisLabel: { formatter: '{value} %', color: token.colorTextDescription }, 
                splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { lineStyle: { color: token.colorBorder } } 
            },
            yAxis: {
                type: 'value', min: 0, max: 100, name: translate('step3.chart_y_axis'), nameLocation: 'center', nameGap: 40, nameRotate: 0,
                nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500 },
                axisLabel: { formatter: '{value} %', color: token.colorTextDescription },
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
                            { coord: [15, 95], name: translate('step3.extreme_privacy'), itemStyle: { color: '#722ed1' }, symbolSize: 8, label: { show: true, position: 'top', formatter: translate('step3.extreme_privacy'), color: token.colorTextDescription, fontSize: 11 } }, 
                            { coord: [100, 15], name: translate('step3.extreme_utility'), itemStyle: { color: '#13c2c2' }, symbolSize: 8, label: { show: true, position: 'right', offset: [6, 0], formatter: translate('step3.extreme_utility'), color: token.colorTextDescription, fontSize: 11 } }
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
    const isKLessThanLStatus = isEnableLDiversityStatus && currentKValue < currentLValue;
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
                { count: sensitiveColumnsCountNumber, defaultValue: `目前已設定 ${sensitiveColumnsCountNumber} 個敏感欄位：l-多樣性／t-緊密度會分別檢測這幾個欄位、須全部達標才算通過；三攻擊與 CAP 風險評估則會逐一評估每個欄位，取風險最高（最保守）的結果，不需要分次執行。` }
            )
            : '';

    const kLessThanLConflictMessageText = translate('step3.error_k_less_than_l', '參數衝突：要求資料具備 {{l}} 種多樣性 (L={{l}})，但群組大小僅有 {{k}} (K={{k}})，這是數學上無法達成的。請確保 K ≥ L。', { k: currentKValue, l: currentLValue });

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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <Alert title={translate('step3.k_params_title')} description={translate('step3.k_params_desc')} type="info" showIcon style={{ textAlign: 'left' }} />
            
            <Row gutter={24} align="stretch">
                
                {/* 左側參數控制區塊 */}
                <Col span={8}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', paddingRight: '4px' }}>
                        <Card title={<span style={{ fontWeight: 600 }}><LockOutlined /> {translate('step3.privacy_settings')}</span>} variant="borderless" style={{ background: token.colorBgContainer, boxShadow: isDarkModeActiveStatus ? 'none' : '0 2px 8px rgba(0,0,0,0.04)', flex: 1 }}>
                            
                            {/* k-anonymity 滑桿 */}
                            <Row gutter={16} align="middle" style={{ marginBottom: isKValueInvalidStatus ? '2px' : '6px' }}>
                                <Col span={8}>
                                    <span style={{ color: isKValueInvalidStatus ? token.colorError : token.colorText }}>k-anonymity (k)：</span>
                                    <Tooltip title={translate('step3.k_value_tooltip')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
                                </Col>
                                <Col span={10}><Slider min={MIN_K_VALUE} max={effectiveMaxKValue} value={currentKValue} onChange={handleKValueChange} /></Col>
                                <Col span={6}><InputNumber min={MIN_K_VALUE} max={effectiveMaxKValue} value={currentKValue} onChange={handleKValueChange} status={isKValueInvalidStatus ? 'error' : undefined} style={{ width: '100%' }} /></Col>
                            </Row>
                            {isKValueInvalidStatus && (
                                <div style={{ marginBottom: '10px', marginTop: '-2px' }}>
                                    <span style={{ color: token.colorError, fontSize: '12px' }}><WarningOutlined style={{ marginRight: 4 }} />{kValueInlineErrorMessageText}</span>
                                </div>
                            )}

                            {/* 運算範圍選擇 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: calculationModeType === 'custom' ? '8px' : '16px' }}>
                                <span style={{ color: token.colorTextSecondary, fontSize: '12px', minWidth: '70px' }}>
                                    {translate('step3.calc_scope')}
                                    <Tooltip title={translate('step3.calc_scope_tooltip')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
                                </span>
                                <Select value={calculationModeType} onChange={(dropdownSelectedModeValue) => setCalculationModeType(dropdownSelectedModeValue as 'all' | 'custom')} size="small" style={{ flex: 1 }} options={[{ value: 'all', label: translate('step3.apply_all_qi') }, { value: 'custom', label: translate('step3.custom_qi_combo') }]} />
                            </div>
                            
                            {/* 自訂威脅組合 */}
                            {calculationModeType === 'custom' && (
                                <div style={{ marginBottom: '16px', padding: '12px', background: isDarkModeActiveStatus ? '#141414' : '#fafafa', borderRadius: '8px', border: `1px solid ${token.colorBorder}` }}>
                                    {quasiIdentifierCombinationsList.map(
                                        (combinationItemArray, combinationRowIndexNumber) => 
                                        (
                                            <div key={combinationRowIndexNumber} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                                <Tag color="cyan" style={{ margin: 'auto 0', height: 'fit-content' }}>{translate('step3.combo_idx', { idx: combinationRowIndexNumber + 1 })}</Tag>

                                                <Select 
                                                    mode="multiple" 
                                                    allowClear 
                                                    placeholder={translate('step3.select_field')} 
                                                    style={{ flex: 1 }} 
                                                    value={combinationItemArray} 
                                                    onChange={(dropdownSelectedValuesArray) => updateCombination(combinationRowIndexNumber, dropdownSelectedValuesArray)} 
                                                    options={
                                                        quasiIdentifierColumnsArray.map(
                                                            (quasiIdentifierColumnNameString: string) => 
                                                            (
                                                                { 
                                                                    label: quasiIdentifierColumnNameString, 
                                                                    value: quasiIdentifierColumnNameString, 
                                                                    disabled: quasiIdentifierCombinationsList.some((comboListItemArray, comboListIndexNumber) => comboListIndexNumber !== combinationRowIndexNumber && comboListItemArray.includes(quasiIdentifierColumnNameString)) 
                                                                }
                                                            )
                                                        )
                                                    } 
                                                />

                                                <Button danger icon={<DeleteOutlined />} disabled={quasiIdentifierCombinationsList.length === 1} onClick={() => removeCombination(combinationRowIndexNumber)} />
                                            </div>
                                        )
                                    )}

                                    <Button type="dashed" block icon={<PlusOutlined />} disabled={quasiIdentifierCombinationsList.reduce((sumAccumulatorValue, combinationItemArray) => sumAccumulatorValue + combinationItemArray.length, 0) >= quasiIdentifierColumnsArray.length} onClick={addCombination}>{translate('step3.add_threat_combo')}</Button>
                                </div>
                            )}
                            
                            {(isMissingSensitiveColumnStatus || isMultiSensitiveColumnStatus) && (
                                // ★ 使用者反映（2026-09-22）：多個敏感欄位不再是「設定錯誤」（見上方說明），
                                //   改用 info 樣式呈現「會怎麼評估」；0 個敏感欄位則仍是值得留意的情況
                                //   （l/t 判定未執行、風險評估被略過），維持 warning 樣式。
                                <Alert
                                    type={isMissingSensitiveColumnStatus ? 'warning' : 'info'}
                                    showIcon
                                    style={{ marginBottom: '12px', textAlign: 'left' }}
                                    message={sensitiveColumnWarningMessageText}
                                />
                            )}

                            {/* l-diversity 滑桿 */}
                            {/* ★ 使用者反映：純 K-匿名模式不一定需要 l-多樣性檢測，加開關讓使用者自行決定是否啟用；
                                關閉時滑桿灰階、Step4 組裝設定檔也不會送出 l 欄位（後端因此不會執行該項檢測）。 */}
                            <Row gutter={16} align="middle" style={{ marginBottom: '8px' }}>
                                <Col span={8}>
                                    <span style={{ color: token.colorText }}>{translate('step3.enable_l_diversity', '啟用 l-多樣性檢測')}：</span>
                                    <Tooltip title={translate('step3.enable_l_diversity_tooltip', '需先在 Step2 將一個欄位標記為「敏感欄位」，才能正確判定 l-多樣性是否通過；未啟用時不會將 l 值送給後端，後端也不會執行此項檢測。')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
                                </Col>
                                <Col span={16}><Switch checked={isEnableLDiversityStatus} onChange={handleEnableLDiversityChange} /></Col>
                            </Row>
                            <Row gutter={16} align="middle" style={{ marginBottom: isKLessThanLStatus ? '2px' : '16px', opacity: isEnableLDiversityStatus ? 1 : 0.45 }}>
                                <Col span={8}>
                                    <span style={{ color: isKLessThanLStatus ? token.colorError : token.colorText }}>l-diversity (l)：</span>
                                    <Tooltip title={translate('step3.l_value_tooltip')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
                                </Col>
                                <Col span={10}><Slider disabled={!isEnableLDiversityStatus} min={MIN_L_VALUE} max={effectiveMaxLValue} value={currentLValue} onChange={handleLValueChange} /></Col>
                                <Col span={6}><InputNumber disabled={!isEnableLDiversityStatus} min={MIN_L_VALUE} max={effectiveMaxLValue} value={currentLValue} onChange={handleLValueChange} status={isKLessThanLStatus || isLExceedsSensitiveDistinctStatus ? 'error' : undefined} style={{ width: '100%' }} /></Col>
                            </Row>
                            {isEnableLDiversityStatus && (
                                <div style={{ marginBottom: '10px', marginTop: '-4px', fontSize: '12px', color: isLExceedsSensitiveDistinctStatus ? token.colorError : token.colorTextDescription }}>
                                    {sensitiveColumnDistinctCountInfo
                                        ? translate('step3.l_max_hint_sensitive', '可設上限 {{max}}（敏感欄位「{{column}}」有 {{count}} 種不同的值，且 L 不可大於 K）', { max: effectiveMaxLValue, column: sensitiveColumnDistinctCountInfo.columnName, count: sensitiveColumnDistinctCountInfo.distinctCount })
                                        : translate('step3.l_max_hint_default', '尚未設定敏感欄位或尚未載入資料，暫以 {{max}} 為上限；設定敏感欄位後會依其實際相異值數調整。', { max: effectiveMaxLValue })}
                                </div>
                            )}
                            {isKLessThanLStatus && (
                                <div style={{ marginBottom: '14px', marginTop: '-2px' }}>
                                    <span style={{ color: token.colorError, fontSize: '12px' }}><WarningOutlined style={{ marginRight: 4 }} />{kLessThanLConflictMessageText}</span>
                                </div>
                            )}

                            <Divider dashed style={{ margin: '8px 0' }} />

                            {/* t-closeness 滑桿 */}
                            {/* ★ 同 l-多樣性：純 K-匿名模式不一定需要 t-緊密度檢測，加開關讓使用者自行決定是否啟用 */}
                            <Row gutter={16} align="middle" style={{ marginBottom: '8px' }}>
                                <Col span={8}>
                                    <span style={{ color: token.colorText }}>{translate('step3.enable_t_closeness', '啟用 t-緊密度檢測')}：</span>
                                    <Tooltip title={translate('step3.enable_t_closeness_tooltip', '需先在 Step2 將一個欄位標記為「敏感欄位」，才能正確判定 t-緊密度是否通過；未啟用時不會將 t 值送給後端，後端也不會執行此項檢測。')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
                                </Col>
                                <Col span={16}><Switch checked={isEnableTClosenessStatus} onChange={handleEnableTClosenessChange} /></Col>
                            </Row>
                            <Row gutter={16} align="middle" style={{ marginBottom: isTValueInvalidStatus ? '2px' : '8px', opacity: isEnableTClosenessStatus ? 1 : 0.45 }}>
                                <Col span={8}>
                                    <span style={{ color: isTValueInvalidStatus ? token.colorError : token.colorText }}>t-closeness (t)：</span>
                                    <Tooltip title={translate('step3.t_value_tooltip')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
                                </Col>
                                <Col span={10}><Slider disabled={!isEnableTClosenessStatus} min={MIN_T_VALUE} max={MAX_T_VALUE} step={MIN_T_VALUE} value={currentTValue} onChange={handleTValueChange} /></Col>
                                <Col span={6}><InputNumber disabled={!isEnableTClosenessStatus} min={MIN_T_VALUE} max={MAX_T_VALUE} step={MIN_T_VALUE} value={currentTValue} onChange={handleTValueChange} status={isTValueInvalidStatus ? 'error' : undefined} style={{ width: '100%' }} /></Col>
                            </Row>
                            {isTValueInvalidStatus && (
                                <div style={{ marginBottom: '6px' }}>
                                    <span style={{ color: token.colorError, fontSize: '12px' }}><WarningOutlined style={{ marginRight: 4 }} />{tValueInlineErrorMessageText}</span>
                                </div>
                            )}

                            <Divider dashed style={{ margin: '16px 0' }} />

                            {/* 抑制率策略 */}
                            <div style={{ padding: '16px', background: isDarkModeActiveStatus ? '#141414' : '#fafafa', borderRadius: '8px', border: `1px solid ${token.colorBorder}` }}>
                                <div style={{ fontWeight: 600, marginBottom: '16px', color: token.colorText }}><WarningOutlined style={{ color: token.colorWarning, marginRight: '6px' }} /> {translate('step3.suppression_strategy')}</div>
                                
                                <Row align="middle" style={{ marginBottom: '16px' }}>
                                    <Col span={7}>
                                        <span style={{ color: token.colorTextSecondary, fontSize: '13px' }}>{translate('step3.suppress_method')}</span>
                                        <Tooltip title={translate('step3.suppress_method_tooltip')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
                                    </Col>
                                    <Col span={17}><Select value={currentSuppressionMethodTypeStr} onChange={handleSuppressionMethodChange} size="small" style={{ width: '100%' }} options={[{ value: 'row_suppression', label: translate('step3.row_suppression') }, { value: 'cell_suppression', label: translate('step3.cell_suppression') }]} /></Col>
                                </Row>

                                {/* ★ 使用者反映（2026-09-23）：後端 cell_fill 參數僅在抑制方式為「值抑制」
                                    (cell_suppression) 時才有作用，先前完全沒有 UI 可選、前端也從未送出，
                                    後端只能默默套用內建預設 (star)。這裡加一個下拉選單，只在選了「值抑制」
                                    時才顯示，避免在「列抑制」模式下讓使用者誤以為這個設定隨時都有效。 */}
                                {(currentSuppressionMethodTypeStr === 'cell' || currentSuppressionMethodTypeStr === 'cell_suppression') && (
                                    <Row align="middle" style={{ marginBottom: '16px' }}>
                                        <Col span={7}>
                                            <span style={{ color: token.colorTextSecondary, fontSize: '13px' }}>{translate('step3.cell_fill_method')}</span>
                                            <Tooltip title={translate('step3.cell_fill_method_tooltip')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
                                        </Col>
                                        <Col span={17}><Select value={currentCellFillMethodTypeStr} onChange={handleCellFillMethodChange} size="small" style={{ width: '100%' }} options={[{ value: 'star', label: translate('step3.cell_fill_star') }, { value: 'missing', label: translate('step3.cell_fill_missing') }]} /></Col>
                                    </Row>
                                )}

                                {/* ★ 核心修正：使用 Space.Compact 替代 addonAfter，消滅 Ant Design 棄用警告 */}
                                <Row align="middle" style={{ marginBottom: '4px' }}>
                                    <Col span={7}>
                                        <span style={{ color: token.colorTextSecondary, fontSize: '13px' }}>{translate('step3.suppress_limit')}</span>
                                        <Tooltip title={translate('step3.suppress_limit_tooltip')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
                                    </Col>
                                    <Col span={11}><Slider min={MIN_SUPPRESSION_PERCENT} max={MAX_SUPPRESSION_PERCENT} value={maxSuppressionPercentageValue} onChange={handleMaxSuppressionChange} style={{ margin: '0 8px 0 0' }} /></Col>
                                    <Col span={6}>
                                        <Space.Compact style={{ width: '100%' }}>
                                            <InputNumber 
                                                min={MIN_SUPPRESSION_PERCENT} 
                                                max={MAX_SUPPRESSION_PERCENT} 
                                                value={maxSuppressionPercentageValue} 
                                                onChange={handleMaxSuppressionChange} 
                                                precision={2}
                                                step={0.01}
                                                style={{ width: '100%' }} 
                                                size="small" 
                                            />
                                            <span className="ant-input-group-addon" style={{ fontSize: '12px', padding: '0 6px', display: 'flex', alignItems: 'center' }}>%</span>
                                        </Space.Compact>
                                    </Col>
                                </Row>

                                <Row align="middle">
                                    <Col span={7}>
                                        <span style={{ color: token.colorTextSecondary, fontSize: '13px' }}>{translate('step3.exceed_behavior')}</span>
                                        <Tooltip title={translate('step3.exceed_behavior_tooltip')}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
                                    </Col>
                                    <Col span={17}>
                                        <Select
                                            value={currentLimitExceededActionTypeStr}
                                            onChange={handleLimitExceededActionChange}
                                            size="small"
                                            style={{ width: '100%' }}
                                            options={
                                                [
                                                    { value: 'stop_and_error', label: translate('step3.stop_and_error') },
                                                    // ★ 修正：「自動放寬 K 值」(relax_k) 選項已移除。已通讀後端
                                                    //   KAnonymityAnonymizer 從建構到 run() 的完整流程，self.k
                                                    //   全程是使用者設定的固定值，後端從未實作過「抑制率超標時
                                                    //   自動降低 K 值」這個能力——不是欄位值打錯，而是後端根本
                                                    //   沒有這個功能可對應，不管前端傳什麼字串都無法讓後端做到。
                                                    //   若之後要提供這個功能，需另外向後端提出功能需求。
                                                    // ★ 修正：此選項原本送出的值是 'force_suppress'，但已核對後端
                                                    //   pipeline.py 原始碼確認 limit_exceeded_action 欄位只接受
                                                    //   'stop_and_error' 或 'allow_with_warning' 兩種值 (由
                                                    //   validate_choice_param 嚴格驗證，其餘值一律 400)。
                                                    //   「強制抑制(降效用)：不管效用損失、持續抑制至符合門檻」這個
                                                    //   說明語意，實際對應到的正是後端 allow_with_warning 的行為
                                                    //   (超過抑制上限時不中止，讓流程照跑完、僅將 is_valid 標示為
                                                    //   false)，只是先前送出的字串值打錯，才會一選就 400。
                                                    //   標籤文字維持不變，僅修正實際送出的值。
                                                    { value: 'allow_with_warning', label: translate('step3.force_suppress') }
                                                ]
                                            }
                                        />
                                    </Col>
                                </Row>
                            </div>
                        </Card>
                    </div>
                </Col>

                {/* 右側帕累托模擬圖表區塊 */}
                <Col span={16}>
                    <Card title={translate('step3.solution_space')} variant="borderless" style={{ background: token.colorBgContainer, boxShadow: isDarkModeActiveStatus ? 'none' : '0 2px 8px rgba(0,0,0,0.04)', height: '100%' }}>
                        <ReactECharts option={getKAnonymityChartOption()} style={{ height: '420px', width: '100%' }} theme={isDarkModeActiveStatus ? 'dark' : 'light'} />
                    </Card>
                </Col>
            </Row>
        </div>
    );
}