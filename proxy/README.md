# FastGPT 对话代理（fastgpt-proxy）

隐藏密钥的轻量代理。前端只调本服务的 `/api/chat`，由本服务带着密钥转发到 FastGPT。
**密钥只存在于本服务的 `.env`，绝不进入前端代码。**

零依赖（Node 18+ 全局 fetch），内置基础限流、CORS 和请求体大小限制。

## 接口
- `GET /api/health` → `{ ok, hasKey, base }`，用于探活
- `POST /api/chat`，请求体 `{ "messages": [{ "role":"user","content":"..." }], "chatId": "可选" }`
  - 返回 **SSE 流**（`text/event-stream`），原样透传 FastGPT 的流式响应
  - 默认请求体上限 64KB，可通过 `MAX_BODY_BYTES` 调整

## 运行方式

### 方式一：本地 / WSL 直接跑（测试用）
```bash
cd proxy
cp .env.example .env      # 然后编辑 .env 填入 FASTGPT_API_KEY
node server.js            # 需要 Node 18+
```
探活：
```bash
curl http://localhost:8787/api/health
```
测试对话（看到流式 data: 行即成功）：
```bash
curl -N -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好"}]}'
```

### 方式二：Docker（推荐上线）
```bash
cd proxy
cp .env.example .env      # 填入密钥
docker compose up -d --build
```

## 上线接入（1Panel / nginx 反代）
- 静态主页走 80/443
- 把 `/api/` 这个路径反代到 `http://127.0.0.1:8787`，其余路径走静态站
- 反代时**务必关闭对 `/api/chat` 响应的缓冲**（SSE 需要实时流）：
  - nginx：`proxy_buffering off; proxy_cache off;`
- 上线后把 `.env` 里的 `ALLOW_ORIGIN` 改成你的主页域名，并在 FastGPT **重置一个新 API Key**（旧的已在聊天里明文出现过）。

## 安全要点
- `.env` 已在 `.gitignore`，不要提交、不要暴露。
- 已内置按 IP 限流（60 秒 30 次），可按需调整。
- 已内置请求体大小限制（默认 64KB），避免异常大请求占用内存。
- 生产环境把 `ALLOW_ORIGIN` 收紧到具体域名，避免被其他站点盗用。
