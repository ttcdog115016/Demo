import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // 🌟 指定 Playwright 只執行 e2e 資料夾內的檔案
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});