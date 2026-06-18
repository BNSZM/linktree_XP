import { defineConfig } from 'astro/config';

// 纯静态输出，构建产物在 dist/，可直接被 nginx / 1Panel / Docker 托管
// 开发/预览时把 /api 转发到本地 Node 代理（默认 :8787），这样前端调 /api/chat 即可
const PROXY = process.env.CHAT_PROXY || 'http://localhost:8787';

export default defineConfig({
  output: 'static',
  // 关闭开发模式下页面底部的 Astro 开发者工具栏（那个带齿轮的浮动条）
  devToolbar: { enabled: false },
  build: {
    assets: '_assets',
  },
  server: {
    proxy: {
      '/api': { target: PROXY, changeOrigin: true },
    },
  },
  vite: {
    server: {
      proxy: {
        '/api': { target: PROXY, changeOrigin: true },
      },
    },
    preview: {
      proxy: {
        '/api': { target: PROXY, changeOrigin: true },
      },
    },
  },
});
