/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// import { vercelToolbar } from '@vercel/toolbar/plugins/vite'; // 引入 Vercel 插件

export default defineConfig({
  plugins: [
    react(),
    // vercelToolbar(),
  ],
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