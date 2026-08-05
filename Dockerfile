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
FROM nginx:alpine AS production

# 複製產出的 dist 靜態檔案至 Nginx 目錄
COPY --from=builder /app/dist /usr/share/nginx/html

# 複製自訂的 Nginx 路由設定 (解決 React Router SPA 重新整理 404 問題)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]