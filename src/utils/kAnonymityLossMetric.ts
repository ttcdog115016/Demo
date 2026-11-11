/**
 * ============================================================================
 * 檔案名稱 (File): kAnonymityLossMetric.ts
 * 模組功能 (Description): K-匿名「失真程度」：通用損失度量（General Loss Metric, LM），前端以處理前後資料計算
 * ============================================================================
 * ★ 2026-10-14 使用者決定：K-匿名資料可用性 ＝ 資料釋出率（保留筆數 ÷ 原始筆數，實務目標 95%）
 *   ＋ LM 失真程度（每個欄位顯示「失真約 X%」，卡片加「整體失真程度」，並一起納入可用性等級）。
 *   後端（期中原始碼）沒有任何資訊損失指標，因此由前端計算。
 * ★ 2026-10-14（同日）使用者決定先拿掉：前端自算、門檻無依據，易讓沒有背景知識的人搞混。
 *   目前沒有畫面使用，等後端提供資訊損失指標或決定依據後再接上（測試：__tests__/kAnonymityLossMetric.test.ts）。
 *
 * LM 公式（每筆紀錄的每個間接識別欄位）：
 *   LM ＝ (H_avg − 1) ÷ (H_max − 1)
 *   H_avg：處理後的值在泛化樹中涵蓋的葉節點（原始值）數；H_max：該欄全部原始值（葉節點）數。
 *   不需逐一解析各種泛化格式（區間、日期粒度、階層、前後綴…），直接以資料推得：
 *   把處理前後同一筆配對，處理後的值 v 涵蓋的原始值數＝「配對到 v 的原始相異值數」。
 *   - 保留原值 → 0；被遮成「*」或值抑制填空 → 1；原始即空值 → 不計。
 *   - 欄位 LM＝該欄所有（釋出的）筆平均；整體 LM＝各間接識別欄位 LM 平均。
 *   - 被刪除的列不計入 LM（已反映在資料釋出率），避免重複扣分。
 *
 * 配對方式：後端 K-匿名只刪列、不重排（期中原始碼 suppression.py：df[~mask]），
 *   - 筆數相同 → 依列序一對一配對；
 *   - 有列被刪除 → 以「未處理欄位」（敏感、非敏感欄位）組成的指紋做順序配對（處理後是原始的子序列）。
 *   配對失敗（找不到可比對欄位、指紋對不上）時回傳 null，不顯示，避免給出錯誤數字。
 */
import Papa from 'papaparse';

export interface KAnonymityColumnLoss {
    column: string;
    /** 0～1 */
    loss: number;
}

export interface KAnonymityLossResult {
    /** 整體失真程度（0～1）：各間接識別欄位平均 */
    overall: number;
    columns: KAnonymityColumnLoss[];
}

const cleanName = (nameText: string): string => String(nameText ?? '').replace(/^[\uFEFF\u200B]+/, '').trim();
const isEmptyCell = (cellValue: unknown): boolean => cellValue === undefined || cellValue === null || String(cellValue).trim() === '';
const SUPPRESSION_MARK = '*';

const parseCsvRows = (csvText: string): string[][] => {
    const parsed = Papa.parse<string[]>(csvText.replace(/^[\uFEFF\u200B]+/, ''), { header: false, skipEmptyLines: true });
    return parsed.data;
};

/**
 * 計算 K-匿名 LM 失真程度。
 * @param input.originalCsvText 送給後端的原始資料
 * @param input.processedCsvText 後端回傳的去識別化結果
 * @param input.qiColumns 間接識別欄位
 * @param input.anchorColumns 未經處理的欄位（敏感、非敏感），有列被刪除時用來配對
 */
export const computeKAnonymityLossMetric = (input: {
    originalCsvText: string;
    processedCsvText: string;
    qiColumns: string[];
    anchorColumns: string[];
}): KAnonymityLossResult | null => {
    const originalRows = parseCsvRows(input.originalCsvText);
    const processedRows = parseCsvRows(input.processedCsvText);
    if (originalRows.length < 2 || processedRows.length < 1) return null;
    const originalHeader = originalRows[0].map(cleanName);
    const processedHeader = processedRows[0].map(cleanName);
    const originalBody = originalRows.slice(1);
    const processedBody = processedRows.slice(1);

    const qiColumns = input.qiColumns.map(cleanName)
        .filter((column) => originalHeader.includes(column) && processedHeader.includes(column));
    if (qiColumns.length === 0) return null;

    // ── 配對：processedIndex → originalIndex ──
    const pairedOriginalIndexList: number[] = [];
    if (processedBody.length === originalBody.length) {
        for (let rowIndex = 0; rowIndex < processedBody.length; rowIndex += 1) pairedOriginalIndexList.push(rowIndex);
    } else {
        if (processedBody.length > originalBody.length) return null;
        const anchorColumns = input.anchorColumns.map(cleanName)
            .filter((column) => originalHeader.includes(column) && processedHeader.includes(column));
        if (anchorColumns.length === 0) return null;
        const originalAnchorIndexes = anchorColumns.map((column) => originalHeader.indexOf(column));
        const processedAnchorIndexes = anchorColumns.map((column) => processedHeader.indexOf(column));
        const fingerprint = (row: string[], indexes: number[]): string => indexes.map((columnIndex) => String(row[columnIndex] ?? '').trim()).join('\u0001');
        let originalPointer = 0;
        for (let processedPointer = 0; processedPointer < processedBody.length; processedPointer += 1) {
            const targetFingerprint = fingerprint(processedBody[processedPointer], processedAnchorIndexes);
            while (originalPointer < originalBody.length && fingerprint(originalBody[originalPointer], originalAnchorIndexes) !== targetFingerprint) originalPointer += 1;
            if (originalPointer >= originalBody.length) return null; // 對不上：不給數字
            pairedOriginalIndexList.push(originalPointer);
            originalPointer += 1;
        }
    }

    const columnLossList: KAnonymityColumnLoss[] = [];
    for (const column of qiColumns) {
        const originalColumnIndex = originalHeader.indexOf(column);
        const processedColumnIndex = processedHeader.indexOf(column);

        // H_max：全部原始資料中此欄的相異值數（葉節點數）
        const leafValueSet = new Set<string>();
        for (const row of originalBody) {
            const cellValue = row[originalColumnIndex];
            if (!isEmptyCell(cellValue)) leafValueSet.add(String(cellValue).trim());
        }
        const leafCount = leafValueSet.size;

        // H_avg：處理後的值 v 涵蓋的原始相異值數
        const coveredLeavesByOutputValue = new Map<string, Set<string>>();
        for (let processedIndex = 0; processedIndex < processedBody.length; processedIndex += 1) {
            const originalValue = originalBody[pairedOriginalIndexList[processedIndex]][originalColumnIndex];
            const outputValue = processedBody[processedIndex][processedColumnIndex];
            if (isEmptyCell(originalValue) || isEmptyCell(outputValue)) continue;
            const outputKey = String(outputValue).trim();
            if (outputKey === SUPPRESSION_MARK) continue;
            let coveredSet = coveredLeavesByOutputValue.get(outputKey);
            if (!coveredSet) { coveredSet = new Set(); coveredLeavesByOutputValue.set(outputKey, coveredSet); }
            coveredSet.add(String(originalValue).trim());
        }

        let lossSum = 0;
        let countedRows = 0;
        for (let processedIndex = 0; processedIndex < processedBody.length; processedIndex += 1) {
            const originalValue = originalBody[pairedOriginalIndexList[processedIndex]][originalColumnIndex];
            if (isEmptyCell(originalValue)) continue; // 原始即空值：不計
            const outputValue = processedBody[processedIndex][processedColumnIndex];
            countedRows += 1;
            const outputKey = isEmptyCell(outputValue) ? '' : String(outputValue).trim();
            if (outputKey === '' || outputKey === SUPPRESSION_MARK) { lossSum += 1; continue; } // 被遮蔽
            if (leafCount <= 1) continue;
            const coveredCount = coveredLeavesByOutputValue.get(outputKey)?.size ?? 1;
            lossSum += (coveredCount - 1) / (leafCount - 1);
        }
        columnLossList.push({ column, loss: countedRows > 0 ? lossSum / countedRows : 0 });
    }

    const overall = columnLossList.reduce((sum, item) => sum + item.loss, 0) / columnLossList.length;
    return { overall, columns: columnLossList };
};

/** 顯示用：0.123 → 「12%」，小於 1% 顯示「不到 1%」 */
export const formatLossPercent = (lossRatio: number): string => {
    const percentValue = lossRatio * 100;
    if (percentValue > 0 && percentValue < 1) return '不到 1%';
    return `${Math.round(percentValue)}%`;
};
