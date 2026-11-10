/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';
// import { vercelToolbar } from '@vercel/toolbar/plugins/vite'; // 引入 Vercel 插件

export default defineConfig({
  plugins: [
    react(),
    // vercelToolbar(),
  ],
  test: {
    // e2e/ 是 Playwright 測試（npm run test:e2e），不由 vitest 執行；
    // doc_site/ 是 Hugo 使用手冊（含佈景主題 hextra 自帶的 Playwright 測試），也不由 vitest 執行。
    // 下面三個元件測試是舊的：mock 的是已移除的 usePrivacyStore、ResizeObserver 用箭頭函式 mock（Vitest 4 不能 new）、
    // 也沒設瀏覽器環境，載入就失敗，過去一直沒有真的在跑（0 個測試）。在 main 補上重寫後的版本之前先排除，
    // 讓 CI 能如實反映其餘測試；重寫後的版本在 feature/backend-v2-integration 分支。
    exclude: [
      ...configDefaults.exclude,
      'e2e/**',
      'doc_site/**',
      'src/utils/__tests__/DifferentialPrivacyMapping.test.tsx',
      'src/utils/__tests__/Step2_Mapping.test.tsx',
      'src/utils/__tests__/TemplateManager.test.tsx',
    ],
  },
  server: {
    proxy: {
      // 開發環境代理：讓瀏覽器對 /api 的請求由 Vite 開發伺服器轉發至本機 Docker 後端，
      // 前端程式碼應改用相對路徑 (如 /api/v1/k-anonymity) 呼叫，避免瀏覽器端跨網域 (CORS) 問題
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});