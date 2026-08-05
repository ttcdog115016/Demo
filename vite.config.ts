/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vercelToolbar } from '@vercel/toolbar/plugins/vite'; // 引入 Vercel 插件

export default defineConfig({
  plugins: [
    react(),
    vercelToolbar(),
  ],
});