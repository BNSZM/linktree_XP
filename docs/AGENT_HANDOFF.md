# Agent 交接文档 — XP 个人主页项目

> 生成时间: 2026-06-17
> 用途: 让下一个 AI Agent 快速了解项目全貌、当前进度、下一步任务

---

## 下一个 Agent 请从这里开始

1. **先读本文件**（AGENT_HANDOFF.md）—— 它包含项目全貌和你要做的事
2. **再读 PRD**（`docs/XP桌面系统_产品规格文档.md`）—— 它定义了最终产品形态
3. **你的第一个任务是 Phase 6 架构重构**（本文第三节）—— 6 个子任务，按顺序执行
4. **完成后是 Phase 7 窗口管理器** —— 参照 PRD 中的窗口管理器行为规则
5. **最后是 Phase 8 多窗口实现** —— 5 个功能窗口 + 3 个装饰窗口

所有新脚本模块放在 `site/src/scripts/` 目录下。所有新 CSS 文件放在 `site/src/styles/` 目录下。每完成一个子任务，执行 `cd site && npm run build` 确认零报错。

---

## 一、项目概述

这是一个**虚拟 Windows XP 桌面环境的个人主页**。用户在浏览器中看到的不是普通网页，而是一个可交互的 XP 桌面——有像素风壁纸、任务栏、开始菜单、可拖拽的程序窗口。所有个人内容（简介、AI 对话、产品 PDF、联系方式）都在这个虚拟 XP 系统中呈现。

**项目所有者**: 袁培文 (Perry Yuan)
**项目路径**: `C:\Users\PerryYuan2002\Desktop\Work\linktree_cowork_v1_qoder\`
**技术栈**: Astro 4.x 静态构建 + 零依赖原生 JS + Node 代理转发 FastGPT

---

## 二、当前进度总览

### 已完成的阶段

| 阶段 | 状态 | 说明 |
|------|------|------|
| Phase 1: XP Luna 主题调优 | **已完成** | 仿照真实 XP 系统属性截图精调样式 |
| Phase 2: 像素风 Bliss 壁纸 | **已完成** | canvas 渲染 8px 像素块风格背景，替代 AI 生成图片 |
| Phase 3: 扩展为 XP 桌面 | **已完成** | 任务栏、Start 菜单、系统时钟 |
| Phase 4: 产品规格对齐 | **已完成** | PRD 文档 `docs/XP桌面系统_产品规格文档.md` 已定稿 |
| Phase 5: 项目文件清理 | **已完成** | 删除过时文档/组件，整合文档结构 |
| Phase 6: 架构重构 | **刚启动，未完成** | 只做了文件读取，尚未产出任何代码改动 |

### 未完成的阶段（待执行）

| 阶段 | 状态 | 说明 |
|------|------|------|
| Phase 6: 架构重构 | **待执行** | 模块拆分、CSS 分割、XPWindow 组件、index.astro 重组 |
| Phase 7: 窗口管理器 | **待实现** | window-manager.js + 拖拽/聚焦/最小化/任务栏联动 |
| Phase 8: 多窗口实现 | **待实现** | 5 个功能窗口 + 3 个装饰窗口 |

---

## 三、当前要做的事：Phase 6 架构重构

### 为什么需要重构

当前 `index.astro` 是 ~440 行的单体文件，内含 HTML 模板 + 200+ 行 `<script>` 块（i18n、复制、标签页切换、聊天流式对话全部混在一起）。即将实现的窗口管理器会增加大量新逻辑，继续堆在单体文件里不可维护。

### 重构任务清单（6 个子任务）

#### 任务 1: 抽离 `site/src/scripts/i18n.js` 模块
- **源文件**: `site/src/pages/index.astro` 的 `<script>` 块第 219-284 行
- **提取内容**:
  - `STORAGE_KEY` 常量
  - `HTML_LANG` 映射
  - `current` 状态变量
  - `getLang()` 函数
  - `S()` 快捷查找函数
  - `apply(lang)` 语言应用函数（遍历 `data-i18n` / `data-i18n-zh` / `data-i18n-en` 设置 textContent；`data-i18n-ph` 设置 placeholder 属性——当前用于聊天输入框占位文字）
  - `toast()` 工具函数（L272-279，通用浮动提示，被复制模块依赖）
  - 语言切换按钮 `#lang-toggle` 的事件绑定
  - 主题色属性注入 `--accent` / `--accent-2`
  - 头像文字注入 `.avatar span` / `.chat-avatar`
  - 标签页切换逻辑（第 240-249 行）—— 本质是 UI 交互，暂放 i18n 模块因为代码相邻，Phase 8 如需复用可再拆出
- **导出接口设计**: `initI18n()` 函数（内部处理全部 i18n + toast 逻辑），`getCurrentLang()` 获取当前语言，`S()` 供 chat/copy 模块调用，`toast()` 供 copy 模块调用
- **注意**: `S()` 函数被 chat 模块依赖（`S("chat.greeting")` / `S("chat.error")`），`toast()` 被 copy 模块依赖，都需要暴露

#### 任务 2: 抽离 `site/src/scripts/chat.js` 模块
- **源文件**: `site/src/pages/index.astro` 的 `<script>` 块第 305-435 行
- **提取内容**:
  - 全部 DOM 引用（`cm`, `cmsgs`, `cform`, `cinput`, `centry`, `cgo`, `cchips`）
  - 状态变量（`history`, `started`, `busy`, `asked`）
  - `bubble(role, text)` 消息气泡创建
  - `openChat()` / `closeChat()` 开关逻辑
  - `[data-close]` 按钮事件绑定（L342-344，关闭按钮 + 背景点击）
  - Escape 键关闭处理（L345-347）
  - `centry` 点击打开对话（L354）
  - chip 点击处理（L349-352）
  - 产品胶囊 action=chat 的自动发送引导语（L357-365）
  - `sendChat(text)` SSE 流式对话（L367-417）
  - 表单提交 + Enter 键（L419-431）+ 输入框自动高度（L432-435）
- **依赖**: 需要从 i18n 模块获取 `S()` 函数；需要导入 `chatProvider`（路径：`import { chatProvider } from "../chat/provider.js"`）
- **导出接口设计**: `initChat({ S: Function })` 初始化函数（chat 错误信息直接显示在聊天气泡中，不需要 toast）

#### 任务 3: 抽离 `site/src/scripts/copy.js` 模块
- **源文件**: `site/src/pages/index.astro` 的 `<script>` 块第 286-303 行
- **提取内容**: 复制功能（事件委托 `#links` 上的 `[data-copy]`）
- **依赖**: 需要从 i18n 模块获取 `S()` 函数和 `toast()` 函数（`toast()` 定义在 i18n 模块中）
- **导出接口设计**: `initCopy({ S, toast })` 初始化函数

#### 任务 4: CSS 分割
- **源文件**: `site/src/styles/global.css`（912 行）
- **拆分为**:

  | 新文件 | 内容 | 大约行数 |
  |--------|------|----------|
  | `styles/global.css` | CSS 变量 `:root` + Reset + body + a + 滚动条 + 无障碍 + 移动端基础响应式 | ~80 行 |
  | `styles/xp-window.css` | `.xp-window` / `.xp-titlebar` / `.xp-tabs` / `.xp-tab` / `.xp-body` / `.xp-group` / `.xp-button-row` / `.xp-btn` + 移动端窗口样式 | ~350 行 |
  | `styles/xp-desktop.css` | `.page` / `.wrap` / `.lang-toggle` / `.toast` + 移动端桌面样式 | ~150 行 |
  | `styles/xp-chat.css` | `.chat-modal` / `.chat-panel` / `.chat-head` / `.chat-msgs` / `.msg` / `.caret` / `.chips` / `.chip` / `.chat-form` / `.chat-input` / `.chat-go` / `.ai-frame` / `.chat-entry` / `.ce-*` + 移动端聊天样式 | ~280 行 |

- **注意**: 推荐在 `index.astro` frontmatter 中直接 import 四个 CSS 文件（Astro 标准做法），替代原来的单个 `global.css` import：
  ```astro
  ---
  import "../styles/global.css";
  import "../styles/xp-window.css";
  import "../styles/xp-desktop.css";
  import "../styles/xp-chat.css";
  ---
  ```

#### 任务 5: 创建 `components/XPWindow.astro` 可复用窗口组件
- **Props 设计**:
  - `title: string` — 标题栏文字
  - `icon?: string` — 标题图标（HTML 实体或 SVG）
  - `id?: string` — 窗口 DOM id（供窗口管理器使用）
  - `closable?: boolean` — 默认 true
  - `class?: string` — 额外 CSS 类名
  - `slot` — 窗口内容区（Astro 默认 slot）
- **HTML 结构**: 与当前 index.astro 第 40-177 行的 `.xp-window` 结构一致，但可复用
- **样式放置**: 窗口样式放在全局 `xp-window.css` 中（任务 4 创建），不使用 scoped style，因为 Phase 7/8 的多个窗口实例共享同一套样式
- **注意**: 这个组件是为 Phase 7/8 的多窗口做准备。当前主窗口可以直接改用此组件。

#### 任务 6: 重组 `index.astro` 为纯装配器
- **目标**: index.astro 只剩：
  1. frontmatter（imports + 服务端数据处理）
  2. HTML 模板（引用 XPWindow 组件包裹内容）
  3. `<script>` 块只 import 并调用各模块的 `init()` 函数
- **预期行数**: 从 ~440 行降至 ~200 行（HTML 模板为主）

### 执行顺序建议
1. 先创建 `site/src/scripts/` 目录
2. 抽离 `site/src/scripts/i18n.js`（最独立，其他模块依赖它的 `S()` 和 `toast()` 函数）
3. 抽离 `site/src/scripts/chat.js`（依赖 i18n 的 `S()`）
4. 抽离 `site/src/scripts/copy.js`（依赖 i18n 的 `S()` 和 `toast()`）
5. CSS 拆分（四个文件到 `site/src/styles/` + index.astro frontmatter 中更新 import）
6. 创建 `site/src/components/XPWindow.astro` 组件
7. 重组 `index.astro`（import 新模块和新 CSS）
8. **构建验证**: `cd site && npm run build` 确保零报错 + 浏览器验证所有交互正常

### Phase 6 完成后的预期文件结构

```
site/src/
├── scripts/                          ← 新增目录
│   ├── i18n.js                       ← initI18n(), S(), toast(), getCurrentLang()
│   ├── chat.js                       ← initChat({ S })
│   └── copy.js                       ← initCopy({ S, toast })
├── styles/
│   ├── global.css                    ← CSS 变量 + Reset + 滚动条 + 无障碍（~80行）
│   ├── xp-window.css                 ← 窗口框架 + 标签页 + 组框 + 按钮（~350行）
│   ├── xp-desktop.css                ← 桌面布局 + 语言切换 + Toast（~150行）
│   └── xp-chat.css                   ← 聊天对话框全部样式（~280行）
├── components/
│   ├── PixelBliss.astro              ← 不变
│   ├── XPTaskbar.astro               ← 不变（Phase 7 再改）
│   └── XPWindow.astro                ← 新增，可复用窗口组件
├── pages/
│   └── index.astro                   ← 纯装配器（~200行）
│                                       frontmatter: import CSS + 组件 + 数据
│                                       HTML: XPWindow 包裹内容 + chat-modal + toast
│                                       <script>: import 三个模块, 调用 init()
├── config/content.json               ← 不变
├── data/site.js                      ← 不变
├── i18n/strings.js                   ← 不变
└── chat/provider.js                  ← 不变
```

### index.astro 重构后的 `<script>` 块示例

```html
<script>
  import { initI18n, S, toast } from "../scripts/i18n.js";
  import { initChat } from "../scripts/chat.js";
  import { initCopy } from "../scripts/copy.js";

  initI18n();
  initCopy({ S, toast });
  initChat({ S });
</script>
```

---

## 各阶段之间的衔接关系

```
Phase 6（架构重构）产出:
  ├── scripts/i18n.js     ──→ Phase 7 的窗口管理器也依赖 i18n（窗口标题等文案）
  ├── scripts/chat.js     ──→ Phase 8 的 AI 聊天窗口直接复用此模块
  ├── scripts/copy.js     ──→ Phase 8 不变
  ├── XPWindow.astro      ──→ Phase 7/8 的所有窗口都用这个组件
  ├── 拆分后的 CSS         ──→ Phase 7 在此基础上新增 window-manager.css
  └── 重组后的 index.astro ──→ Phase 7 在此基础上新增窗口管理器 import

Phase 7（窗口管理器）需要新增:
  ├── scripts/window-manager.js  ──→ z-index/拖拽/聚焦/最小化/还原/关闭
  ├── styles/window-manager.css  ──→ 窗口定位/拖拽状态/最小化动画
  └── 改造 XPTaskbar.astro       ──→ 任务按钮从硬编码变为动态（由窗口管理器驱动）

Phase 8（多窗口实现）:
  ├── 主窗口: 用 XPWindow 组件包裹现有 index.astro 中的内容
  ├── AI 聊天窗口: 从 chat-modal overlay 改为 XPWindow 可拖拽窗口
  ├── PDF 窗口 ×3: XPWindow + iframe
  └── 装饰窗口 ×3: XPWindow + 像素风纯 CSS 内容
```

注意：Phase 6 重构时，**不需要**做任何窗口管理器相关的事。保持当前行为不变（主窗口居中显示、聊天是 modal 弹层、任务栏按钮是硬编码的）。窗口管理器是 Phase 7 的事。

---

## 四、产品规格文档（PRD）摘要

完整 PRD 在 `docs/XP桌面系统_产品规格文档.md`。以下是要点：

### 窗口清单（Phase 7/8 实现）

1. **个人主页窗口 (System Properties)** — 页面加载自动打开，含头像/姓名/AI入口/产品/联系方式
2. **AI 聊天窗口** — 从主窗口按钮触发，SSE 流式对话
3. **PDF 查看器 ×3** — iframe 嵌入三个 PDF，从主窗口或 Start 菜单触发
4. **装饰窗口 ×3** — My Computer / My Documents / Control Panel，像素风模拟界面，纯装饰

### 窗口管理器行为规则（Phase 7 实现）

- 拖拽：按住标题栏拖动
- 聚焦：点击窗口 → 提升到最顶层 z-index
- 最小化：点击任务栏已激活按钮 → 窗口隐藏
- 还原：点击任务栏非激活按钮 → 窗口显示并聚焦
- 关闭：点击 ✕ → 窗口销毁 + 任务栏按钮移除
- 新窗口位置：居中偏右下错开

### 移动端策略（≤768px）

- 任务栏 / Start 菜单 / 壁纸：隐藏
- 主窗口：全屏铺满，无窗口装饰
- AI 聊天：大型对话框覆盖约 92% 屏幕（height: 92vh）
- PDF：直接新标签页打开（不用 iframe）

---

## 五、文件结构与技术细节

### 完整文件清单（当前）

```
linktree_cowork_v1_qoder/
├── .gitignore                       # node_modules/ dist/ .astro/ .env *.log
├── README.md                        # 项目概述 + 快速开始 + 目录结构
├── start.bat                        # Windows 一键启动 proxy + site
│
├── docs/
│   ├── XP桌面系统_产品规格文档.md    # PRD（窗口定义/交互规则/移动端策略）
│   ├── 部署文档_WSL本地测试.md       # WSL 从零搭建到端到端测试
│   └── AGENT_HANDOFF.md             # ← 本文件
│
├── proxy/                           # 对话代理（Node，零依赖）
│   ├── server.js                    # /api/chat SSE 转发 FastGPT
│   ├── .env                         # 本地配置（FASTGPT_API_KEY）— 不入库
│   ├── .env.example                 # 配置模板
│   ├── .gitignore                   # .env
│   ├── package.json                 # { "start": "node server.js" }
│   ├── Dockerfile                   # Node 20-alpine 容器
│   ├── docker-compose.yml           # 一键 docker compose up
│   └── README.md                    # 代理说明
│
└── site/                            # 前端（Astro 静态构建）
    ├── astro.config.mjs             # output:static, /api 代理到 :8787
    ├── package.json                 # astro ^4.16.0, 仅一个依赖
    ├── package-lock.json
    ├── .gitignore
    ├── public/pdf/
    │   ├── apihub-overseas-llm-relay.pdf
    │   ├── fastgpt-commercial.pdf
    │   └── microsoft365-copilot.pdf
    └── src/
        ├── env.d.ts                 # Astro 类型声明
        ├── config/
        │   └── content.json         # ★ 唯一内容编辑处（文案/产品/联系方式）
        ├── data/
        │   └── site.js              # 从 content.json 派生 SITE 对象 + icons
        ├── i18n/
        │   └── strings.js           # 双语文案字典，buildStrings() + t()
        ├── chat/
        │   └── provider.js          # SSE 流式 /api/chat provider
        ├── components/
        │   ├── PixelBliss.astro     # canvas 像素风 Bliss 壁纸
        │   └── XPTaskbar.astro      # XP 任务栏 + Start 菜单（含 scoped style）
        ├── pages/
        │   └── index.astro          # ★ 主页面（当前是单体，待重构）
        └── styles/
            └── global.css           # Luna 主题全量样式（912行，待拆分）
```

### 关键架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 框架 | Astro 4.x, `output: 'static'` | 纯静态，构建产物可直接 nginx/Docker 托管 |
| 窗口管理器 | 原生 JS，零依赖 | 用户明确要求不引入 React/Vue/第三方 UI 库 |
| 数据源 | `content.json` 单源 | 所有文案/产品/联系方式集中管理 |
| i18n | `data-i18n` 属性 + localStorage | 中英双语，SSR 首屏渲染 + CSR 切换 |
| AI 对话 | `/api/chat` → Node 代理 → FastGPT | 密钥只在 proxy/.env，前端不碰 |
| CSS | 全局 CSS（非 Tailwind/CSS Modules） | 匹配 XP 主题的全局样式系统 |
| ESM | Astro `<script>` 中 `import` | Astro 自动处理 ESM 打包 |

### 技术约束（硬规则）

1. **不引入新依赖** — 窗口管理器纯 JS，不装新 npm 包
2. **content.json 是唯一内容源** — 所有文案改动只改这一个文件
3. **密钥不进前端** — FastGPT API Key 只在 proxy/.env
4. **Astro 静态输出** — `output: 'static'`，所有交互逻辑是客户端 JS
5. **XP 视觉一致性** — 所有新 UI 元素必须符合 Luna 主题风格

### 当前 `index.astro` 的 `<script>` 块内部依赖图

```
strings.js ←── i18n 逻辑 (L219-284)
    │                  ├── toast() (L272-279) ── 通用工具，被复制模块依赖
    │                  ├── 标签切换 (L240-249)
    │                  └── 语言切换按钮绑定
    │
    ├── 复制逻辑 (L286-303) ←── 依赖 S() + toast()
    │
    └── 聊天逻辑 (L305-435) ←── 依赖 S()
          ├── openChat/closeChat
          ├── [data-close] 事件 + Escape 键关闭
          ├── centry 点击打开
          ├── bubble()
          ├── sendChat() ──→ chatProvider.stream()
          ├── chip 点击
          └── 产品胶囊 action=chat

site.js ←── 主题色注入 (L230-231)
         └── 头像文字注入 (L233-235)

chat/provider.js ←── sendChat() 内的 chatProvider.stream()
```

---

## 六、开发环境

### 启动方式

```bash
# 终端 A：启动后端代理
cd proxy
cp .env.example .env   # 填入 FASTGPT_API_KEY
node server.js          # :8787

# 终端 B：启动前端
cd site
npm install
npm run dev             # :4321
```

或 Windows 下双击 `start.bat` 同时拉起两个服务。

### 构建验证

```bash
cd site
npm run build    # 输出 dist/
npm run preview  # 预览构建产物
```

**每次重构后必须执行 `npm run build` 确认零报错。**

### 调用链

```
浏览器(静态前端) ──/api/chat──► Astro Dev(:4321) ──转发──► Node 代理(:8787) ──Bearer Key──► FastGPT
```

---

## 七、用户偏好与沟通注意事项

1. **语言**: 用户使用中文沟通，回复用中文
2. **工作流**: PRD（产品规格）→ 架构重构 → 功能实现。用户重视需求对齐，不喜欢做了再改
3. **视觉标准高**: 用户会提供真实 XP 截图做对比，像素级对齐
4. **不要 AI 生成图片**: 壁纸用 canvas 程序化渲染，不用 AI 生图
5. **文件清理意识**: 用户会要求整理项目，删除多余文件
6. **技术决策信任 Agent**: 用户会询问技术建议，同意后放权执行

---

## 八、关键文件内容速查

### content.json 结构

```json
{
  "theme":    { "accent", "accent2" },
  "profile":  { "avatar": "PW", "name": {zh,en}, "tagline": {zh,en} },
  "meta":     { "title": {zh,en}, "desc": {zh,en} },
  "ui":       { "langNext", "langLabel", "toastCopied", "productsTitle", "footNote", "copyHint" },
  "chat":     { "eyebrow", "entry", "title", "placeholder", "greeting", "error", "close" },
  "contacts": { "items": [{ type, icon, value, label, sub }] },
  "products": { "items": [{ title, sub, pdf?, action?, chatMessage?, open? }] },
  "chips":    { "items": [{ zh, en }] }
}
```

### strings.js 导出

```js
export const DEFAULT_LANG = "zh";
export const LANGS = ["zh", "en"];
export const strings = buildStrings();  // { zh: {...}, en: {...} }
export function t(lang, key) { ... }    // 服务端取文案
```

### site.js 导出

```js
export const SITE = { theme, profile, contacts, products, chips };
// 注意：SITE.profile 只有 { avatar: "PW" }，不含 name/tagline
// name/tagline 走 strings.js 的 buildStrings() → data-i18n 属性
export const icons = { phone, wechat, mail, megaphone };  // SVG path
```

### chat/provider.js 导出

```js
export const chatProvider = {
  endpoint: "/api/chat",
  async stream(messages, { onToken, onDone, onError, signal }) { ... }
};
```

---

## 九、已知的注意事项 / 坑

1. **Astro `<script>` 的 ESM import**: Astro 会自动打包 `<script>` 中的 `import`，所以模块拆分后直接 import 即可，不需要额外配置
2. **scoped style vs global CSS**: `PixelBliss.astro` 和 `XPTaskbar.astro` 使用 `<style>` 标签（Astro 自动 scope），而 `global.css` 是全局的。新组件可以选 scoped 或 global
3. **content.json 的 `_说明` 字段**: JSON 里有些 key 以 `_说明` 命名，是给人看的注释，代码中应忽略
4. **移动端 CSS**: `@media (max-width: 768px)` 规则分散在 global.css 各处和各组件的 scoped style 中。CSS 拆分时要注意归到正确的新文件里
5. **XPTaskbar.astro 的 Start 菜单**: 当前 Start 菜单的菜单项都是静态 HTML + 纯装饰（点击无事件）。Phase 7/8 需要给菜单项添加打开窗口的逻辑
