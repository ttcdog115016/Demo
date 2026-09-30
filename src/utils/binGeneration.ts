/**
 * ============================================================================
 * 檔案名稱 (File): binGeneration.ts
 * 模組功能 (Description): 數值型「自訂區間」的自動產生與相關純運算（不依賴 React 或 Store）。
 * ============================================================================
 * ★ 2026-09-30：由 features/step2_mapping/KAnonymityMapping.tsx 抽出（原檔 2,800 多行），
 *   邏輯不變，另補上原本寫在元件事件處理函式內的三段運算（最小／最大值、「最小單位」起點、
 *   第一格下限延伸至 0），讓這些規則可以獨立寫單元測試（見 utils/__tests__/binGeneration.test.ts）。
 */

/** 自訂區間一列：下限（含）、上限（不含，null＝不限）、顯示標籤 */
export interface CustomBin {
    min: number | null;
    max: number | null;
    label: string;
}

// 「最小單位」模式之安全上限：避免使用者輸入過小的單位寬度 (例如 0.001) 導致產生數千個
// 區間列，拖垮畫面渲染效能，故超過此上限後即停止疊加、最後一格改為「不限」涵蓋剩餘範圍。
export const MAX_AUTO_GENERATED_BIN_COUNT = 200;

/**
 * 函數名稱: roundToTwoDecimalPlaces
 * 函數功能: 將數值四捨五入至小數點後兩位，避免區間邊界因浮點數運算 (如 1/3 等除法) 產生過長的
 *          小數尾巴 (例如 33.333333333)，影響區間標籤與 InputNumber 顯示之可讀性。
 */
export const roundToTwoDecimalPlaces = (rawNumericValue: number): number => Math.round(rawNumericValue * 100) / 100;

/**
 * 函數名稱: generateEvenlyDistributedBins
 * 函數功能: 「系統推薦設定」之「平均分配」模式核心運算——依實際資料最小/最大值，將數值範圍
 *          等寬切分為指定數量之區間，最後一個區間之上限固定為「不限」(null)，確保能涵蓋
 *          資料實際最大值 (區間定義為上限不含，若改用計算出之最大值仍為上限，會使剛好等於
 *          最大值的資料筆數落到範圍外)。
 *
 * 輸入參數 (Input): minValue (實際最小值), maxValue (實際最大值), targetBinCount (期望產生之區間數量)
 * 輸出參數 (Output): 無
 * 返回值 (Return): CustomBin[] —— 依序排列之區間陣列；輸入不合法時回傳空陣列
 */
export const generateEvenlyDistributedBins = (minValue: number, maxValue: number, targetBinCount: number): CustomBin[] => {
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue || !Number.isFinite(targetBinCount) || targetBinCount < 1) {
        return [];
    }

    const singleBinWidthValue = (maxValue - minValue) / targetBinCount;
    const generatedBinsResultArray: CustomBin[] = [];

    for (let binSequenceIndexNumber = 0; binSequenceIndexNumber < targetBinCount; binSequenceIndexNumber++) {
        const isLastBinInSequenceStatus = binSequenceIndexNumber === targetBinCount - 1;
        const binLowerBoundValue = roundToTwoDecimalPlaces(minValue + binSequenceIndexNumber * singleBinWidthValue);
        const binUpperBoundValue = isLastBinInSequenceStatus ? null : roundToTwoDecimalPlaces(minValue + (binSequenceIndexNumber + 1) * singleBinWidthValue);

        generatedBinsResultArray.push({
            min: binLowerBoundValue,
            max: binUpperBoundValue,
            label: binUpperBoundValue !== null ? `${binLowerBoundValue} - ${binUpperBoundValue}` : `${binLowerBoundValue} +`
        });
    }

    return generatedBinsResultArray;
};

/**
 * 函數名稱: generateUnitWidthBins
 * 函數功能: 「系統推薦設定」之「最小單位」模式核心運算——使用者指定一個最小單位寬度 (例如 10)，
 *          自 0 起（資料含負數時自不大於最小值之整數倍起）以該寬度為固定級距依序疊加（0-10、10-20…），
 *          直到涵蓋實際最大值為止；最後一個區間
 *          之上限同樣固定為「不限」(null)，理由與 generateEvenlyDistributedBins 相同。
 *          另設有 MAX_AUTO_GENERATED_BIN_COUNT 安全上限，避免使用者誤填過小的單位寬度
 *          (例如 0.001) 導致無窮或大量迴圈拖垮畫面渲染效能。
 *
 * 輸入參數 (Input): minValue (實際最小值), maxValue (實際最大值), unitWidthValue (單位寬度)
 * 輸出參數 (Output): 無
 * 返回值 (Return): CustomBin[] —— 依序排列之區間陣列；輸入不合法時回傳空陣列
 */
export const generateUnitWidthBins = (minValue: number, maxValue: number, unitWidthValue: number): CustomBin[] => {
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue || !Number.isFinite(unitWidthValue) || unitWidthValue <= 0) {
        return [];
    }

    const generatedBinsResultArray: CustomBin[] = [];
    // ★ 使用者反映（2026-09-29）：「最小單位」改為以輸入值當固定級距、從 0 起算對齊整數倍
    //   （寬度 10 → 0-10、10-20、20-30…），而非從實際最小值起算（先前會變成 18-28、28-38…）。
    //   資料含負數時，起點取「不大於最小值的最大整數倍」（例如 -15、寬度 10 → -20），仍對齊級距。
    //   未含資料的前段級距（例如年齡 0-10）保留，讓日後出現較小數值時仍有區間可歸。
    let currentBinLowerBoundValue = minValue > 0 ? 0 : Math.floor(minValue / unitWidthValue) * unitWidthValue;

    while (currentBinLowerBoundValue < maxValue && generatedBinsResultArray.length < MAX_AUTO_GENERATED_BIN_COUNT) {
        const nextBinBoundaryValue = roundToTwoDecimalPlaces(currentBinLowerBoundValue + unitWidthValue);
        const isLastBinInSequenceStatus = nextBinBoundaryValue >= maxValue || generatedBinsResultArray.length === MAX_AUTO_GENERATED_BIN_COUNT - 1;
        const binLowerBoundValue = roundToTwoDecimalPlaces(currentBinLowerBoundValue);
        const binUpperBoundValue = isLastBinInSequenceStatus ? null : roundToTwoDecimalPlaces(nextBinBoundaryValue);

        generatedBinsResultArray.push({
            min: binLowerBoundValue,
            max: binUpperBoundValue,
            label: binUpperBoundValue !== null ? `${binLowerBoundValue} - ${binUpperBoundValue}` : `${binLowerBoundValue} +`
        });

        currentBinLowerBoundValue = nextBinBoundaryValue;
    }

    return generatedBinsResultArray;
};

/**
 * 函數名稱: calculateNiceRoundingUnit
 * 函數功能: 依實際資料最小/最大值，自動計算一個「好讀」的四捨五入捨入單位 (genParam)——採用類似
 *          圖表座標軸刻度常用的「nice number」演算法：先以「大約切成 targetBucketCount 段」估算出
 *          粗略單位寬度，再將該寬度捨入到最接近的 1 / 2 / 5 × 10^n，確保算出來的捨入單位是使用者
 *          容易理解的整數倍數 (例如 5、10、20、50、100)，而非 37、82 這類不好讀的數字。
 *
 * 輸入參數 (Input): minValue (實際最小值), maxValue (實際最大值), targetBucketCount (估算目標段數)
 * 輸出參數 (Output): 無
 * 返回值 (Return): number | undefined —— 計算出之建議捨入單位；輸入不合法 (無範圍) 時回傳 undefined
 */
export const calculateNiceRoundingUnit = (minValue: number, maxValue: number, targetBucketCount: number): number | undefined => {
    const valueRangeSpanValue = maxValue - minValue;

    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || valueRangeSpanValue <= 0 || !Number.isFinite(targetBucketCount) || targetBucketCount < 1) {
        return undefined;
    }

    const roughBucketWidthValue = valueRangeSpanValue / targetBucketCount;
    const magnitudeOfTenValue = Math.pow(10, Math.floor(Math.log10(roughBucketWidthValue)));
    const normalizedWidthValue = roughBucketWidthValue / magnitudeOfTenValue; // 落在 [1, 10) 區間

    let niceNormalizedWidthValue: number;
    if (normalizedWidthValue < 1.5) niceNormalizedWidthValue = 1;
    else if (normalizedWidthValue < 3) niceNormalizedWidthValue = 2;
    else if (normalizedWidthValue < 7) niceNormalizedWidthValue = 5;
    else niceNormalizedWidthValue = 10;

    return roundToTwoDecimalPlaces(niceNormalizedWidthValue * magnitudeOfTenValue);
};

/**
 * 逐筆比較求最小／最大值（大量資料時 Math.min(...陣列) 會因參數過多而 RangeError）。
 * 空陣列或沒有有限數值時回傳 null。
 */
export const findNumericMinMax = (numericValuesList: readonly number[]): { min: number; max: number } | null => {
    let minValue = Infinity;
    let maxValue = -Infinity;
    for (const numericValue of numericValuesList) {
        if (!Number.isFinite(numericValue)) continue;
        if (numericValue < minValue) minValue = numericValue;
        if (numericValue > maxValue) maxValue = numericValue;
    }
    return Number.isFinite(minValue) ? { min: minValue, max: maxValue } : null;
};

/**
 * 「最小單位」模式的第一格起點：資料最小值 > 0 時一律自 0 起算（寬度 10 → 0-10、10-20…）；
 * 含負數或 0 時取「不大於最小值的最大整數倍」（例如 -15、寬度 10 → -20），仍對齊級距。
 */
export const computeUnitModeStartValue = (minValue: number, unitWidthValue: number): number =>
    minValue > 0 ? 0 : Math.floor(minValue / unitWidthValue) * unitWidthValue;

/**
 * ★ 使用者反映（2026-09-29）：自動產生的區間若從「實際資料最小值」起算（例如年齡 18），0 ～ 最小值
 *   之間沒有區間涵蓋，日後出現更小的數值會落在所有區間之外而泛化失敗。直接把第一格的下限往下延伸
 *   到 0（例如 18～32.2 → 0～32.2），區間數量維持不變。資料本身最小值 ≤ 0、或第一格下限已 ≤ 0 時不延伸。
 *   回傳新陣列，不修改傳入的陣列。
 */
export const extendFirstBinLowerBoundToZero = (binsList: CustomBin[], realMinValue: number): CustomBin[] => {
    if (binsList.length === 0 || !(realMinValue > 0)) return binsList;
    const firstBinRecord = binsList[0];
    if (typeof firstBinRecord.min !== 'number' || firstBinRecord.min <= 0) return binsList;
    return [
        { min: 0, max: firstBinRecord.max, label: firstBinRecord.max !== null ? `0 - ${firstBinRecord.max}` : '0 +' },
        ...binsList.slice(1)
    ];
};
