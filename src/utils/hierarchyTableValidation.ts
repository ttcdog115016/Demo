/**
 * ============================================================================
 * 檔案名稱 (File): hierarchyTableValidation.ts
 * 模組功能 (Description): K-匿名「泛化階層對照」類別對照表的逐列防呆。
 * ★ 2026-10-06 新增：使用者回報對照表新增一列、原始值空白、只在「泛化 3」填 444444，仍可進入 Step3。
 *   原本只檢查「至少有一列有原始值」。逐列檢查以下會讓結果錯誤的情況：
 *   - missing_original：原始值空白但其他層有填 → 這列永遠比對不到任何資料。
 *   - level_gap：中間某層空白、後面層有填 → 組設定檔時會去掉空白格（pipelineConfig.ts），
 *     後面的值往前遞補，變成錯誤的層級（例：泛化 1 空白、泛化 2 填北部 → 北部變成泛化 1）。
 *   - duplicate_original：同一個原始值出現兩次 → 設定檔以原始值為鍵，後面那列會蓋掉前面那列。
 *   - below_selected_level：這列只填到泛化 N，但欄位選用的泛化層級大於 N → 該層沒有值可套用。
 *   完全空白的列不檢查（視為尚未填寫，送出時本來就會略過）。
 * ============================================================================
 */

export type HierarchyRowProblemKind = 'missing_original' | 'level_gap' | 'duplicate_original' | 'below_selected_level';

export interface HierarchyRowProblem {
    kind: HierarchyRowProblemKind;
    /** 第幾列（1 起算，對應畫面上由上往下第幾列） */
    rowNumber: number;
    /** 有問題的欄位索引（0 = 原始值，1 = 泛化 1 …），供畫面標紅框 */
    columnIndex: number;
    /** 原始值（duplicate_original 時有值） */
    originalValue?: string;
    /** 這列實際填到第幾層（below_selected_level 時有值） */
    filledLevel?: number;
}

/**
 * 函數名稱: findHierarchyTableProblems
 * @param mappings 對照表內容（每列：[原始值, 泛化1, 泛化2, …]）
 * @param selectedLevel 該欄位選用的泛化層級（genMaxLevel）；未知或 0 時不檢查 below_selected_level
 */
export const findHierarchyTableProblems = (mappings: string[][], selectedLevel?: number): HierarchyRowProblem[] => {
    const problems: HierarchyRowProblem[] = [];
    const seenOriginalValues = new Map<string, number>();
    mappings.forEach((rowCells, rowIndex) => {
        const rowNumber = rowIndex + 1;
        const cells = (rowCells || []).map((cell) => String(cell ?? '').trim());
        let lastFilledIndex = -1;
        cells.forEach((cell, cellIndex) => { if (cell !== '') lastFilledIndex = cellIndex; });
        if (lastFilledIndex < 0) return; // 整列空白

        const originalValue = cells[0] ?? '';
        if (originalValue === '') {
            problems.push({ kind: 'missing_original', rowNumber, columnIndex: 0 });
            return;
        }
        if (seenOriginalValues.has(originalValue)) {
            problems.push({ kind: 'duplicate_original', rowNumber, columnIndex: 0, originalValue });
        } else {
            seenOriginalValues.set(originalValue, rowNumber);
        }
        const firstGapIndex = cells.findIndex((cell, cellIndex) => cellIndex > 0 && cellIndex < lastFilledIndex && cell === '');
        if (firstGapIndex > 0) {
            problems.push({ kind: 'level_gap', rowNumber, columnIndex: firstGapIndex });
            return;
        }
        if (selectedLevel && selectedLevel > 0 && lastFilledIndex < selectedLevel) {
            problems.push({ kind: 'below_selected_level', rowNumber, columnIndex: lastFilledIndex + 1, filledLevel: lastFilledIndex });
        }
    });
    return problems;
};

/** 問題說明（一句話，不含欄位名稱前綴） */
export const describeHierarchyRowProblem = (problem: HierarchyRowProblem, selectedLevel?: number): string => {
    switch (problem.kind) {
        case 'missing_original':
            return `第 ${problem.rowNumber} 列沒有填原始值，但後面的層級有填`;
        case 'level_gap':
            return `第 ${problem.rowNumber} 列的「泛化 ${problem.columnIndex}」空白，但後面的層級有填`;
        case 'duplicate_original':
            return `第 ${problem.rowNumber} 列的原始值「${problem.originalValue}」與前面重複`;
        case 'below_selected_level':
            return problem.filledLevel === 0
                ? `第 ${problem.rowNumber} 列只有原始值，沒有填任何泛化層級（目前選用層級 ${selectedLevel}）`
                : `第 ${problem.rowNumber} 列只填到「泛化 ${problem.filledLevel}」，但目前選用的泛化層級是 ${selectedLevel}`;
        default:
            return '';
    }
};
