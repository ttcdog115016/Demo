/**
 * ============================================================================
 * 檔案名稱 (File): capBaseline.ts
 * 模組功能 (Description): CAP「亂猜基線」與扣除基線後的 CAP 風險（前端計算，供整體風險等級使用）。
 * ============================================================================
 * ★ 2026-10-06 使用者反映：Step4 整體等級幾乎不可能到 L1。
 *   後端 CAP（app/engines/risk/cap.py）＝ Σ（各間接識別等價類中，敏感值眾數的次數）÷ 總列數。
 *   這個數字就算敏感資料跟其他欄位完全無關也不會是 0：
 *     (1) 一律猜最常見值就有「最常見值佔比」的命中率；
 *     (2) 等價類越小，組內眾數越容易「剛好」出現 2 次以上——例如 K=5 的群組，即使疾病完全隨機，CAP 也常有 4～5 成。
 *   實測 input_test.csv（疾病與其他欄位無關）：間接識別分成平均 30 筆一組時 CAP≈29.8%，打亂疾病後仍≈29.9%。
 *   直接拿 CAP 比 5%／20% 門檻，幾乎永遠是 L3。
 *
 *   改法：亂猜基線＝「保留處理後資料的分組不變、只把敏感欄位隨機打亂」後重算的 CAP（取數次平均）。
 *   打亂後敏感值與間接識別欄位已無關聯，此值就是「純屬運氣也猜得中」的部分，同時涵蓋上面 (1)(2)。
 *   扣除基線後的風險＝(CAP − 基線) ÷ (1 − 基線)，與三攻擊的正規化方式一致：0＝跟亂猜一樣，1＝每筆都猜得中。
 *   基線以「送給 /risk/cap 的處理後資料」計算（已裁切欄位、已分級距），子群體條件比照後端 subset.py 先篩再算。
 *   亂數用固定種子，同一份資料每次結果相同。
 */
import Papa from 'papaparse';

/** pandas read_csv 預設視為缺值的字串（後端 CAP 的敏感值缺值不算進分子、但留在分母） */
const PANDAS_DEFAULT_NA_VALUE_SET = new Set([
    '', '#N/A', '#N/A N/A', '#NA', '-1.#IND', '-1.#QNAN', '-NaN', '-nan', '1.#IND', '1.#QNAN',
    '<NA>', 'N/A', 'NA', 'NULL', 'NaN', 'None', 'n/a', 'nan', 'null'
]);

/** 打亂次數（實測 7 萬筆標準差約 0.05 個百分點，3 次已足夠穩定） */
export const CAP_SHUFFLE_REPEAT_COUNT = 3;
const CAP_SHUFFLE_SEED = 20261006;

// ★ 2026-10-29：類別值清單可同時含字串與數值版本（見 riskSubgroupHelpers）；畫面端以字串比對即可。
//   區間邊界為數值，或日期字串 YYYY-MM-DD（後端 subset.py 日期區間）
export type CapSubgroupPayload = Record<string, { min?: number | string; max?: number | string } | (string | number)[]> | undefined;

const isPandasMissingCell = (cellText: string | undefined): boolean =>
    cellText === undefined || PANDAS_DEFAULT_NA_VALUE_SET.has(cellText);

/** 值的比對鍵：缺值自成一類（後端 groupby dropna=False）；數值字串視為同一值（pandas 讀成數值時 "1" 與 "1.0" 相同） */
const toValueKey = (cellText: string | undefined): string => {
    if (isPandasMissingCell(cellText)) return '\u0000NA';
    const trimmedText = (cellText as string).trim();
    const numberValue = trimmedText === '' ? NaN : Number(trimmedText);
    return Number.isFinite(numberValue) ? `n:${numberValue}` : `s:${cellText}`;
};

/** 日期字串（YYYY-MM-DD 或 YYYY/MM/DD，可帶 HH:mm[:ss]）→ { 當天 UTC 毫秒, 含時間之 UTC 毫秒 }；轉不動或日期不存在回 null */
const parseDateCellOrNull = (cellText: string): { dayMs: number; fullMs: number } | null => {
    const matched = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(cellText);
    if (!matched) return null;
    const [yearValue, monthValue, dayValue] = [Number(matched[1]), Number(matched[2]), Number(matched[3])];
    const dayMs = Date.UTC(yearValue, monthValue - 1, dayValue);
    const checkDate = new Date(dayMs);
    if (checkDate.getUTCFullYear() !== yearValue || checkDate.getUTCMonth() !== monthValue - 1 || checkDate.getUTCDate() !== dayValue) return null;
    const timeMs = ((Number(matched[4] ?? 0) * 60 + Number(matched[5] ?? 0)) * 60 + Number(matched[6] ?? 0)) * 1000;
    return { dayMs, fullMs: dayMs + timeMs };
};

/** 子群體條件（比照後端 subset.py：類別＝isin 字串比對；區間＝轉數值後閉區間，轉不動者落選；
 *  邊界為日期字串時＝轉日期後以「日」比較之閉區間，轉不動者落選） */
const doesRowPassSubgroup = (rowCells: string[], conditionList: { columnIndex: number; condition: NonNullable<CapSubgroupPayload>[string] }[]): boolean => {
    for (const { columnIndex, condition } of conditionList) {
        const cellText = rowCells[columnIndex];
        if (Array.isArray(condition)) {
            if (cellText === undefined || !condition.includes(cellText)) return false;
            continue;
        }
        if (isPandasMissingCell(cellText)) return false;
        if (typeof condition.min === 'string' || typeof condition.max === 'string') {
            const cellDate = parseDateCellOrNull(String(cellText));
            if (!cellDate) return false;
            const minDate = typeof condition.min === 'string' ? parseDateCellOrNull(condition.min) : null;
            const maxDate = typeof condition.max === 'string' ? parseDateCellOrNull(condition.max) : null;
            if (minDate && cellDate.dayMs < minDate.dayMs) return false;
            if (maxDate && cellDate.dayMs > maxDate.dayMs) return false;
            continue;
        }
        const numberValue = Number(String(cellText).trim());
        if (!Number.isFinite(numberValue)) return false;
        if (typeof condition.min === 'number' && numberValue < condition.min) return false;
        if (typeof condition.max === 'number' && numberValue > condition.max) return false;
    }
    return true;
};

/** 固定種子亂數（mulberry32） */
const createSeededRandom = (seedValue: number) => {
    let state = seedValue >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/** 後端 CAP 公式：Σ 各組（敏感值非缺值者）眾數次數 ÷ 總列數。groupIds／valueIds 為整數編號，valueId = -1 表示缺值 */
const computeCapFromIds = (groupIds: Int32Array, valueIds: Int32Array, valueCount: number): number => {
    const pairCountMap = new Map<number, number>();
    const bestCountByGroup = new Map<number, number>();
    for (let rowIndex = 0; rowIndex < groupIds.length; rowIndex++) {
        const valueId = valueIds[rowIndex];
        if (valueId < 0) continue;
        const pairKey = groupIds[rowIndex] * valueCount + valueId;
        const nextCount = (pairCountMap.get(pairKey) || 0) + 1;
        pairCountMap.set(pairKey, nextCount);
        if (nextCount > (bestCountByGroup.get(groupIds[rowIndex]) || 0)) bestCountByGroup.set(groupIds[rowIndex], nextCount);
    }
    let bestCountSum = 0;
    bestCountByGroup.forEach((countValue) => { bestCountSum += countValue; });
    return groupIds.length === 0 ? 0 : bestCountSum / groupIds.length;
};

export interface CapBaselineResult {
    /** 亂猜基線：敏感欄位打亂後的 CAP 平均值 */
    baseline: number;
    /** 前端以同一公式重算的 CAP（未打亂），用來核對與後端 cap_after 是否一致 */
    recomputedCap: number;
    /** 參與計算的筆數（子群體篩選後） */
    rowCount: number;
}

/**
 * 處理後資料的欄式編碼：每欄的儲存格換成該欄字典的整數編號（-1＝該列缺此欄）。
 * ★ 2026-10-30：原本每輪 CAP（每個候選敏感欄位一輪）都把整份 CSV 解析成字串陣列（約檔案大小的 5～8 倍記憶體）；
 *   改為只逐列讀一次、存成整數陣列，各輪共用，記憶體約為列數 × 欄數 × 4 bytes 加上各欄相異值。
 */
export interface CapEncodedTable {
    headerCells: string[];
    rowCount: number;
    columnIds: Int32Array[];
    columnDictionaries: string[][];
}

export const encodeCsvForCapBaseline = (csvText: string): CapEncodedTable | null => {
    let headerCells: string[] | null = null;
    let idListsByColumn: number[][] = [];
    let idMapsByColumn: Map<string, number>[] = [];
    let rowCount = 0;
    Papa.parse<string[]>(csvText, {
        skipEmptyLines: true,
        step: (stepResult) => {
            const rowCells = stepResult.data;
            if (!headerCells) {
                headerCells = rowCells.map((headerText) => String(headerText).replace(/^\uFEFF/, ''));
                idListsByColumn = headerCells.map(() => []);
                idMapsByColumn = headerCells.map(() => new Map<string, number>());
                return;
            }
            for (let columnIndex = 0; columnIndex < idListsByColumn.length; columnIndex++) {
                const cellText = rowCells[columnIndex];
                if (cellText === undefined) { idListsByColumn[columnIndex].push(-1); continue; }
                const idMap = idMapsByColumn[columnIndex];
                let cellId = idMap.get(cellText);
                if (cellId === undefined) { cellId = idMap.size; idMap.set(cellText, cellId); }
                idListsByColumn[columnIndex].push(cellId);
            }
            rowCount++;
        }
    });
    if (!headerCells || rowCount === 0) return null;
    return {
        headerCells,
        rowCount,
        columnIds: idListsByColumn.map((idList) => Int32Array.from(idList)),
        columnDictionaries: idMapsByColumn.map((idMap) => Array.from(idMap.keys()))
    };
};

/**
 * 以處理後資料（已編碼）計算 CAP 亂猜基線。找不到欄位、條件欄位不存在或篩選後無資料時回傳 null（等級改為不納入 CAP）。
 */
export const computeCapShuffleBaseline = (table: CapEncodedTable | null, input: {
    quasiIdentifierColumnNames: string[];
    sensitiveColumnName: string;
    subgroupPayload?: CapSubgroupPayload;
    repeatCount?: number;
}): CapBaselineResult | null => {
    if (!table || input.quasiIdentifierColumnNames.length === 0) return null;
    const { headerCells, columnIds, columnDictionaries } = table;
    const cellTextAt = (columnIndex: number, rowIndex: number): string | undefined => {
        const cellId = columnIds[columnIndex][rowIndex];
        return cellId < 0 ? undefined : columnDictionaries[columnIndex][cellId];
    };
    const sensitiveColumnIndex = headerCells.indexOf(input.sensitiveColumnName);
    const qiColumnIndexList = input.quasiIdentifierColumnNames.map((columnName) => headerCells.indexOf(columnName));
    if (sensitiveColumnIndex < 0 || qiColumnIndexList.some((columnIndex) => columnIndex < 0)) return null;
    const conditionList = Object.entries(input.subgroupPayload || {}).map(([columnName, condition]) => ({ columnIndex: headerCells.indexOf(columnName), condition }));
    if (conditionList.some((item) => item.columnIndex < 0)) return null;
    // 子群體判定只需條件欄位：逐列填入這幾欄（其餘留空），沿用 doesRowPassSubgroup
    const conditionRowCells: string[] = new Array(headerCells.length);

    const groupIdMap = new Map<string, number>();
    const valueIdMap = new Map<string, number>();
    const groupIdList: number[] = [];
    const valueIdList: number[] = [];
    for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex++) {
        if (conditionList.length > 0) {
            for (const { columnIndex } of conditionList) conditionRowCells[columnIndex] = cellTextAt(columnIndex, rowIndex) as string;
            if (!doesRowPassSubgroup(conditionRowCells, conditionList)) continue;
        }
        const groupKey = qiColumnIndexList.map((columnIndex) => toValueKey(cellTextAt(columnIndex, rowIndex))).join('\u0001');
        let groupId = groupIdMap.get(groupKey);
        if (groupId === undefined) { groupId = groupIdMap.size; groupIdMap.set(groupKey, groupId); }
        groupIdList.push(groupId);
        const sensitiveCellText = cellTextAt(sensitiveColumnIndex, rowIndex);
        if (isPandasMissingCell(sensitiveCellText)) { valueIdList.push(-1); continue; }
        const valueKey = toValueKey(sensitiveCellText);
        let valueId = valueIdMap.get(valueKey);
        if (valueId === undefined) { valueId = valueIdMap.size; valueIdMap.set(valueKey, valueId); }
        valueIdList.push(valueId);
    }
    if (groupIdList.length === 0) return null;

    const groupIds = Int32Array.from(groupIdList);
    const valueIds = Int32Array.from(valueIdList);
    const valueCount = Math.max(1, valueIdMap.size);
    const recomputedCap = computeCapFromIds(groupIds, valueIds, valueCount);

    const repeatCount = Math.max(1, input.repeatCount ?? CAP_SHUFFLE_REPEAT_COUNT);
    const randomNext = createSeededRandom(CAP_SHUFFLE_SEED);
    const shuffledValueIds = Int32Array.from(valueIds);
    let shuffledCapSum = 0;
    for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex++) {
        for (let i = shuffledValueIds.length - 1; i > 0; i--) {
            const j = Math.floor(randomNext() * (i + 1));
            const swapValue = shuffledValueIds[i];
            shuffledValueIds[i] = shuffledValueIds[j];
            shuffledValueIds[j] = swapValue;
        }
        shuffledCapSum += computeCapFromIds(groupIds, shuffledValueIds, valueCount);
    }
    return { baseline: shuffledCapSum / repeatCount, recomputedCap, rowCount: groupIds.length };
};

/** 單次計算用（直接給 CSV 文字）；多輪計算請先 encodeCsvForCapBaseline 再重複呼叫 computeCapShuffleBaseline */
export const computeCapShuffleBaselineFromCsvText = (input: {
    csvText: string;
    quasiIdentifierColumnNames: string[];
    sensitiveColumnName: string;
    subgroupPayload?: CapSubgroupPayload;
    repeatCount?: number;
}): CapBaselineResult | null => {
    const { csvText, ...baselineInput } = input;
    return computeCapShuffleBaseline(encodeCsvForCapBaseline(csvText), baselineInput);
};

/**
 * 基線距離 100% 至少要留這麼多空間，扣除基線後的 CAP 才有意義。
 * ★ 2026-10-07 使用者回報 DP 結果「能否猜出敏感資料：每 100 筆約 100 筆」：
 *   DP 加噪後的數值型間接識別欄位幾乎每筆都不同，等價類幾乎全是 1 筆，CAP 與打亂後的基線都 ≈ 99.9x%。
 *   (CAP − 基線) ÷ (1 − 基線) 的分母只剩極少數「剛好同組」的列，數字被放大成雜訊；
 *   加上後端 cap_after 四捨五入到小數 4 位（例如 0.99996 → 1.0），分子分母一比就變成 100%。
 *   後端 cap.py 註解也說明：QI 近乎唯一時前後皆趨近 1.0，屬此指標先天性質。
 *   故 1 − 基線 < 5%（≥ 95% 的資料不必靠間接識別欄位也「猜得中」）時判定此指標不適用，回傳 null，
 *   整體等級改由推斷性攻擊判斷。
 */
export const CAP_MIN_INFORMATIVE_HEADROOM = 0.05;

/** 扣除亂猜基線後的 CAP 風險（0~1）；CAP 未評估（負數）、沒有基線或指標不適用時回傳 null */
export const computeCapExcessRisk = (capValue: number | null | undefined, baselineValue: number | null | undefined): number | null => {
    if (typeof capValue !== 'number' || !Number.isFinite(capValue) || capValue < 0) return null;
    if (typeof baselineValue !== 'number' || !Number.isFinite(baselineValue) || baselineValue < 0) return null;
    if (1 - baselineValue < CAP_MIN_INFORMATIVE_HEADROOM) return null;
    return Math.min(1, Math.max(0, (capValue - baselineValue) / (1 - baselineValue)));
};

/** 有基線、但因間接識別欄位幾乎每筆都不同而不適用 */
export const isCapExcessNotApplicable = (baselineValue: number | null | undefined): boolean =>
    typeof baselineValue === 'number' && Number.isFinite(baselineValue) && 1 - baselineValue < CAP_MIN_INFORMATIVE_HEADROOM;
