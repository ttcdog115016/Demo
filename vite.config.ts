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