/**
 * 檔案名稱 (File): setupTests.ts
 * 模組功能 (Description): 所有 vitest 測試共用的設定（由 vite.config.ts 的 test.setupFiles 載入）。
 *
 * Testing Library 的 waitFor／findBy 預設只等 1 秒。匯入設定檔、渲染大型表單的元件測試，在 GitHub Actions 這類較慢的機器上會偶發逾時
 * （同一份程式碼有時過、有時不過）。這裡把預設上限放寬到 10 秒：只影響「失敗時要等多久才放棄」，測試通過時的速度不變。
 */
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 10_000 });
