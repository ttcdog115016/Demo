# ---------------------------------------------------
# Stage 1: Build Front-end Application
# ---------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# 複製 package 檔案並安裝依賴
COPY package*.json ./
RUN npm ci

# 複製原始碼並打包
COPY . .
RUN npm run build

# ---------------------------------------------------
# Stage 2: Production Web Server with Nginx
# ---------------------------------------------------
# ★ 2026-11-03：源碼掃描指出 nginx:alpine 以 root 執行，改用非 root 版本（以 nginx 使用者執行，僅能監聽 1024 以上之埠，故改為 8080）
FROM nginxinc/nginx-unprivileged:alpine AS production

# 複製產出的 dist 靜態檔案至 Nginx 目錄
COPY --from=builder /app/dist /usr/share/nginx/html

# 複製自訂的 Nginx 路由設定 (解決 React Router SPA 重新整理 404 問題)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]