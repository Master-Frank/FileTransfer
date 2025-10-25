# Build stage
FROM node:18-alpine AS builder

# Install pnpm (use latest version for better compatibility)
RUN npm install -g pnpm@latest

WORKDIR /app

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/webrtc-im/package.json ./packages/webrtc-im/
COPY packages/webrtc/package.json ./packages/webrtc/
COPY packages/websocket/package.json ./packages/websocket/

# Install dependencies (remove frozen-lockfile to allow lockfile updates)
RUN pnpm install

# 复制源代码
COPY . .

# 构建项目
RUN pnpm build:webrtc-im

# 使用 nginx 作为生产环境
FROM nginx:alpine

# 复制构建产物到 nginx 目录 (修复路径问题)
COPY --from=builder /app/packages/webrtc-im/build/static /usr/share/nginx/html

# 创建自定义 nginx 配置文件
RUN cat > /etc/nginx/conf.d/default.conf << 'EOF'
server {
    listen 80;
    server_name localhost;
    
    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files $uri $uri/ /index.html;
    }
    
    # 启用 gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
    
    # 设置缓存策略
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # 添加安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # 错误页面
    error_page 404 /index.html;
}
EOF

# 暴露端口
EXPOSE 80

# 启动 nginx
CMD ["nginx", "-g", "daemon off;"]