/**
 * 檔案名稱 (File): setupTests.ts
 * 模組功能 (Description): 所有 vitest 測試共用的設定（由 vite.config.ts 的 test.setupFiles 載入）。
 *
 * 1. Testing Library 的 waitFor／findBy 預設只等 1 秒。匯入設定檔、渲染大型表單的元件測試，在 GitHub Actions 這類較慢的機器上會偶發逾時
 *    （同一份程式碼有時過、有時不過）。這裡把預設上限放寬到 10 秒：只影響「失敗時要等多久才放棄」，測試通過時的速度不變。
 *
 * 2. 每個測試結束後卸載已繪製的元件（cleanup）。Testing Library 的「自動清理」只在測試框架有全域 afterEach（vitest 的 globals: true）時才會註冊，
 *    本專案沒有開 globals，所以以前每個測試檔得自己寫 afterEach(cleanup)；漏寫的檔案，最後一個測試繪製的元件在檔案結束後還掛著，
 *    React 排程的工作（Node 的 setImmediate）等 jsdom 環境被拆掉之後才執行，Vitest 就回報
 *    `ReferenceError: window is not defined`（Unhandled Error）：全部測試都通過、整個流程卻以失敗結束，只在較慢的 CI 機器上偶發。
 *    集中在這裡處理，所有測試檔（包含日後新增的）都受益；測試檔自己已經呼叫 cleanup 也沒有影響（重複呼叫是無害的）。
 *
 * 3. 測試結束時，停止 settle／settleUntil 殘留的等待迴圈（見 settle.ts）：逾時的測試不會讓迴圈跑到下一個測試去。
 */
import { afterEach } from 'vitest';
import { configure, cleanup } from '@testing-library/react';
import { stopRunningSettleLoops } from './settle';

configure({ asyncUtilTimeout: 10_000 });

afterEach(() => {
    stopRunningSettleLoops();
    cleanup();
});
