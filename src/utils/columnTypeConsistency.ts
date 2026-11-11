/**
 * ============================================================================
 * 檔案名稱 (File): columnTypeConsistency.ts
 * 模組功能 (Description): ★ 2026-10-05 第 2 級檢查（依使用者確認之「依嚴重程度分三級」）：
 *   使用者在 Step2 把欄位設為「數值」或「日期／時間」時，若實際資料中有無法轉換的值，
 *   後端必定回傳 422 ERR_CONFIG_DATA_MISMATCH（例：欄位 '年齡' 宣告為 continuous，但實體資料
 *   包含無法轉換的非數值內容）。這裡在進入 Step3 前就依已掃描的資料集統計 (datasetProfile) 擋下，
 *   並指出欄位、筆數與實際的值，不必等到 Step4 執行才失敗。
 * ============================================================================
 */
import type { DatasetProfile } from './datasetProfile';
import { evaluateNumericConflict, evaluateDateConflict } from './backendValueRules';

export interface DeclaredTypedColumn {
    columnName: string;
    kind: 'numeric' | 'date';
}

export interface DeclaredTypeConflict extends DeclaredTypedColumn {
    /** 無法轉換的筆數；日期型無法精確計算時為 undefined */
    badCount?: number;
    examples: string[];
}

const MAX_CONFLICT_EXAMPLES = 3;
const cleanColumnName = (rawName: string): string => rawName.replace(/^[﻿​]+/, '').trim();

/**
 * 函數名稱: findDeclaredTypeConflicts
 * 函數功能: 依資料集統計，找出「宣告為數值／日期，但資料中有無法轉換值」的欄位。統計尚未完成時回傳空陣列。
 */
export const findDeclaredTypeConflicts = (declaredColumns: DeclaredTypedColumn[], datasetProfile: DatasetProfile | null | undefined): DeclaredTypeConflict[] => {
    if (!datasetProfile) return [];
    const conflicts: DeclaredTypeConflict[] = [];
    declaredColumns.forEach((declaredColumn) => {
        const valueStats = datasetProfile.columns[cleanColumnName(declaredColumn.columnName)]?.valueStats;
        if (!valueStats) return;
        // ★ 規則與後端一致（backendValueRules.ts）：NA／NULL 等缺值字串不算錯；千分位、十六進位不算數字；
        //   日期須同一欄格式一致、日期須存在。
        const conflict = declaredColumn.kind === 'numeric' ? evaluateNumericConflict(valueStats) : evaluateDateConflict(valueStats);
        if (conflict) conflicts.push({ ...declaredColumn, badCount: conflict.badCount, examples: conflict.examples.slice(0, MAX_CONFLICT_EXAMPLES).map((example) => example.value) });
    });
    return conflicts;
};
