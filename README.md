# 个人主页 — Windows XP 桌面版

一个在浏览器中运行的虚拟 Windows XP 桌面环境。所有个人内容（简介、AI 对话、产品文档、联系方式）都以 XP 程序窗口的形式呈现，支持窗口拖拽、任务栏切换、开始菜单。中英双语。

## 目录结构

```
linktree_cowork_v1_qoder/
├── site/                        前端工程（Astro 静态构建）
│   └── src/
│       ├── pages/index.astro           主页面（HTML 模板 + i18n/聊天/复制等脚本）
│       ├── components/
│       │   ├── PixelBliss.astro         像素风 Bliss 壁纸（canvas 渲染）
│       │   └── XPTaskbar.astro          XP 任务栏（Start / 时钟 / 系统托盘）
│       ├── chat/provider.js            对话 provider（调 /api/chat，可替换后端）
│       ├── config/content.json         唯一内容编辑处：文案/产品/联系方式
│       ├── data/site.js                站点配置（从 content.json 派生）
│       ├── i18n/strings.js             中英双语文案字典
│       └── styles/global.css           Luna 主题样式 + 窗口管理器样式
├── proxy/                       对话代理（Node，零依赖）
│   ├── server.js                 /api/chat 流式转发 FastGPT
│   ├── .env.example              配置模板
│   └── Dockerfile / docker-compose.yml
├── docs/                        项目文档
│   ├── XP桌面系统_产品规格文档.md  当前产品规格（窗口定义/交互规则）
│   ├── 部署文档_WSL本地测试.md     WSL 本地部署步骤
│   └── AGENT_HANDOFF.md          AI Agent 交接文档（项目进度/下一步任务）
├── start.bat                    一键启动 proxy + site
└── README.md                    本文件
```

## 快速开始

```
cd proxy && cp .env.example .env   # 填入 FASTGPT_API_KEY
node server.js                     # 后端代理 :8787
```

```
cd site && npm install && npm run dev   # 前端 :4321
```

或 Windows 下双击 `start.bat` 同时拉起两个服务。打开 `http://localhost:4321`。

## 内容维护

所有展示内容集中在 `site/src/config/content.json`：文案（中英）、头像、联系方式、产品条目、推荐问题。改完 `npm run build` 即可。

## 架构

```
浏览器(静态前端) ──/api/chat──► Node 代理(藏密钥) ──Bearer Key──► FastGPT
```

密钥只存于 `proxy/.env`，绝不进前端。

## 安全注意

- 上线前在 FastGPT 重置一个新 API Key（旧的如果曾在对话中暴露过）
- 上线后把代理 `.env` 的 `ALLOW_ORIGIN` 收紧到你的域名
- 建议代理加按 IP 限流 + 全局日额度熔断（在 `.env` 配置）
- 整站可套 Cloudflare 免费 WAF + 限流
