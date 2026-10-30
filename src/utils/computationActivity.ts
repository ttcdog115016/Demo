/**
 * ============================================================================
 * 檔案名稱 (File): computationActivity.ts
 * 模組功能 (Description): 記錄目前是否有運算在等後端回應（供閒置登出判斷）。
 * ============================================================================
 * ★ 2026-10-30：大資料運算可能超過閒置逾時（預設 15 分鐘），使用者只是在等結果、沒動滑鼠就被登出，
 *   登出又會中止運算。運算進行中不算閒置。
 */

let activeComputationCount = 0;

/** 運算開始時呼叫；回傳結束時要呼叫的函式（重複呼叫只算一次） */
export const beginComputation = (): (() => void) => {
    activeComputationCount += 1;
    let isEnded = false;
    return () => {
        if (isEnded) return;
        isEnded = true;
        activeComputationCount = Math.max(0, activeComputationCount - 1);
    };
};

export const isComputationRunning = (): boolean => activeComputationCount > 0;
