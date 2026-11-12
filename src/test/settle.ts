/**
 * 檔案名稱 (File): settle.ts
 * 模組功能 (Description): 使用假時鐘（只假造 setTimeout／clearTimeout）的 hook 測試共用的等待工具。
 *
 * 為什麼需要：usePipelineRunner 每一輪除了計時器，還會做真實的非同步工作（讀檔去除 BOM、計算資料列統計與檔案指紋、
 * 寫稽核紀錄），完成時間取決於機器速度、不受假時鐘控制。固定讓出若干次的 settle() 在快的機器夠用，
 * 在 CI 這種較慢的機器（只有 2 核）上可能還沒做完就檢查，造成偶發失敗，例如
 * `expected "vi.fn()" to be called 2 times, but got 1 times`。
 * （限 2 核整套測試連跑 5 次，有 3 次在 step4PipelineRunnerGuards 失敗；把 settle 的次數降到 2 即可重現。）
 *
 * 用法原則：「預期會發生的事」一律用 settleUntil 等到發生為止；
 *           只有「預期不再發生任何事」才用 settle() 當固定時間的安靜期。
 *
 * 兩個容易踩到的坑（限 2 核整套測試實測發現，也是這份檔案現在的樣子的原因）：
 * 1. 使用這些工具的測試檔要把單一測試的逾時放寬（describe 的 timeout 選項）。機器忙碌時，每一輪「推進假時鐘＋讓出事件迴圈」
 *    會變得很慢，一個測試可能要幾十秒；全域的 30 秒測試逾時不夠。
 * 2. 逾時的測試函式 JavaScript 無法取消，它的等待迴圈會在背景繼續跑，去推進「下一個測試」的假時鐘並干擾它，
 *    造成後面的測試連鎖失敗。所以迴圈綁定「目前這個測試」：測試結束（setupTests.ts 的 afterEach 呼叫 stopRunningSettleLoops）
 *    後，殘留的迴圈會自己停止。
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';

/** 單一測試的建議逾時（毫秒）：給 describe 的 timeout 選項用，要明顯大於 settleUntil 的預設上限 */
export const SETTLE_TEST_TIMEOUT_MS = 150_000;

// 每個測試結束時加 1；等待迴圈開始時記下目前的值，值變了就代表它所屬的測試已經結束，立刻停止
let currentTestEpoch = 0;
export const stopRunningSettleLoops = (): void => { currentTestEpoch += 1; };

const advanceOnce = async (): Promise<void> => {
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await new Promise((resolve) => setImmediate(resolve));
};

/** 推進假時鐘並讓出事件迴圈固定次數（60 次、每次假時鐘前進 100 毫秒）：當作「預期不再發生任何事」的安靜期 */
export const settle = async (): Promise<void> => {
    const epoch = currentTestEpoch;
    for (let index = 0; index < 60 && epoch === currentTestEpoch; index++) {
        await advanceOnce();
    }
};

/**
 * 持續推進假時鐘並讓出事件迴圈，直到條件成立為止；以真實時間為上限（假時鐘不假造 Date.now），
 * 預設 45 秒，明顯小於 SETTLE_TEST_TIMEOUT_MS，所以條件一直不成立時會先在這裡收尾，
 * 之後的 expect 以清楚的斷言訊息指出哪個條件沒成立，而不是整個測試逾時。
 */
export const settleUntil = async (condition: () => boolean, timeoutMs = 45_000): Promise<void> => {
    const epoch = currentTestEpoch;
    const deadline = Date.now() + timeoutMs;
    while (epoch === currentTestEpoch && !condition() && Date.now() < deadline) {
        await advanceOnce();
    }
};
