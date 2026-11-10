// 對運行中的 Docker 容器跑既有 e2e（e2e/workflow.spec.ts）：
//   $env:E2E_BASE_URL='http://127.0.0.1:8090'; $env:E2E_USERNAME='...'; $env:E2E_PASSWORD='...'
//   npx playwright test -c docker/playwright.docker.config.ts
// 測試帳號以 docker exec ... create-user -u <帳號> -p <密碼> -r user 建立。
import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

export default defineConfig({
  ...base,
  testDir: '../e2e',
  use: { ...base.use, baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080' },
  outputDir: '../test-results-docker',
  reporter: [['list'], ['json', { outputFile: '../test-results-docker/results.json' }]],
});
