/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';

// ★ 2026-10-07：把建置時間寫進程式，登入頁底部會顯示，方便確認瀏覽器載入的是不是最新版
const BUILD_TIME_LABEL = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

export default defineConfig({
  define: {
    __APP_BUILD_TIME__: JSON.stringify(BUILD_TIME_LABEL),
  },
  plugins: [
    react(),
  ],
  test: {
    // e2e/ 是 Playwright 測試（npm run test:e2e），不由 vitest 執行
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  server: {
    host: '0.0.0.0',     // 新增：允許伺服器監聽所有網卡的 IP，讓外部網路可以連入
    allowedHosts: true, // 新增：解除 Vite 對外部網域名稱的阻擋
    proxy: {
      // 開發環境代理：讓瀏覽器對 /api 的請求由 Vite 開發伺服器轉發至本機 Docker 後端，
      // 前端程式碼應改用相對路徑 (如 /api/v1/k-anonymity) 呼叫，避免瀏覽器端跨網域 (CORS) 問題
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  // 加入這個 preview 區塊！
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5173, // 👈 新增這行：強制將預覽伺服器跑在 5173 埠
    // 讓預覽模式也能支援你原本的 API 代理
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    }
  }
});