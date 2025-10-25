const express = require('express');
const path = require('path');
const app = express();

// 设置端口，优先使用环境变量
const PORT = process.env.PORT || 3000;

// 静态文件目录
const staticPath = path.join(__dirname, 'packages/webrtc-im/build/static');

// 启用gzip压缩
app.use(require('compression')());

// 设置安全头
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// 静态文件服务
app.use(express.static(staticPath, {
  maxAge: '1y', // 缓存静态资源1年
  etag: true,
  lastModified: true
}));

// SPA路由支持 - 所有路由都返回index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📁 Serving static files from: ${staticPath}`);
  console.log(`🌐 Access your app at: http://localhost:${PORT}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, shutting down gracefully');
  process.exit(0);
});