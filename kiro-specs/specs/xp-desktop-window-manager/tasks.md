# Implementation Plan: XP 桌面窗口管理器

## Overview

本实现计划将设计文档转化为一系列增量式编码任务。整体遵循设计的阶段划分：先完成**阶段 6 架构重构**（行为保持不变、构建零错误），再实现**窗口管理器核心**，随后是**内容渲染器与各窗口**、**桌面/开始菜单/任务栏接线**、**留言板后端与前端**，以及 **i18n / 移动端降级 / 无障碍** 收尾。

技术栈沿用设计决策：Astro 4 静态输出 + 原生 ES 模块前端、零依赖 `node:http` 代理后端。测试采用 **fast-check**（属性测试，≥100 次迭代）+ **Vitest / node:test**（示例/单元/集成），DOM 逻辑在 happy-dom/jsdom 下运行。示例/单元测试随实现任务一并完成（折叠在对应实现子任务的描述中），属性测试与集成测试保留为独立子任务。

每条属性测试以如下注释标注来源：
`// Feature: xp-desktop-window-manager, Property {n}: {属性标题}`

每个任务都建立在前序任务之上，最终以一个完整的集成 + 构建校验任务收尾，确保没有孤立、未接线的代码。

## Tasks

- [x] 1. 搭建测试基础设施
  - [x] 1.1 配置前端（site）测试运行器与 PBT 库
    - 在 `site` 中以 devDependency 形式加入 vitest、fast-check、happy-dom（或 jsdom）
    - 添加 `test`/`test:run` 脚本（使用 `--run` 单次执行，不用 watch）
    - 配置 vitest 使用 happy-dom 环境，可合成 `PointerEvent`/`KeyboardEvent`
    - _Requirements: 1.5, 16.3_
  - [x] 1.2 配置后端（proxy）测试运行器与 PBT 库
    - 在 `proxy` 中以 devDependency 形式加入 fast-check（搭配 node:test 或 vitest）
    - 添加可指向临时 `MESSAGES_FILE` 的测试脚本（单次执行）
    - _Requirements: 1.5, 20.10_

- [x] 2. 阶段 6：将内联脚本收敛为可复用 ES 模块（保留行为）
  - [x] 2.1 将国际化逻辑完全收敛到 `scripts/i18n.js` 模块
    - 移除 `index.astro` 中重复的内联 i18n 逻辑，改为 import 并初始化 `scripts/i18n.js`
    - 保持 `data-i18n`/`data-i18n-zh`/`data-i18n-en`/`data-i18n-ph` 绑定与 localStorage 持久化的可观察行为不变
    - _Requirements: 1.1, 1.6, 1.7, 15.1, 15.2, 15.3_
  - [x] 2.2 将复制到剪贴板逻辑收敛到 `scripts/copy.js` 模块
    - 移除 `index.astro` 中内联复制逻辑，改用 `initCopy`
    - 保留复制成功的 Toast 反馈行为
    - 并为该行为编写示例单元测试：断言点击联系图标触发复制 + Toast；标签条/装饰控件切换不改变内容
    - _Requirements: 1.1, 1.6_
  - [x] 2.3 将聊天逻辑抽取为窗口化聊天模块（复用 `chat/provider.js`）
    - 新建 `scripts/apps/chat.js`，封装消息流渲染、建议气泡、输入/发送，内部调用 `chatProvider.stream`
    - 从 `index.astro` 移除内联聊天脚本，改为模块入口；保留 SSE 流式追加、问候、空响应错误文案行为
    - _Requirements: 1.1, 1.6, 10.2, 10.3_
  - [x] 2.4 为 i18n 语言切换编写属性测试
    - **Property 10: 语言切换更新所有绑定并可往返**
    - 生成随机的 `data-i18n*` 绑定元素集合，断言切换后文本/占位符等于目标语言字典值，且 zh→en→zh 往返回到初始一致状态（fast-check，≥100 次迭代）
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.5**

- [x] 3. 阶段 6：拆分单一庞大样式表
  - [x] 3.1 将 `global.css` 拆分为职责聚焦的样式表
    - 拆为如 `base.css`、`window.css`、`taskbar.css`、`desktop.css`、`apps/*.css`，由入口统一引入
    - 不改变任何可观察的视觉呈现（XP Luna 一致）
    - _Requirements: 1.2, 16.2_

- [x] 4. 阶段 6：可复用 XP 窗口组件与入口精简
  - [x] 4.1 创建可复用 `components/XPWindow.astro` 模板
    - 输出隐藏的 `<template id="xp-window-template">`，含标题栏（图标 + 标题 + 最小化/最大化/关闭控件）、内容插槽、8 个 resize 把手（n/s/e/w/ne/nw/se/sw）
    - 标题栏与控件含 `role="dialog"`、`aria-label`、可聚焦控制按钮
    - _Requirements: 1.3, 16.6_
  - [x] 4.2 将 `index.astro` 精简为组装层
    - 入口仅负责：引入拆分后的样式、组合组件（Taskbar/PixelBliss/XPWindow 模板）、初始化模块逻辑
    - 保留全部可观察交互（语言切换、复制、标签切换、聊天开关与流式、头像注入、主题色注入）
    - _Requirements: 1.4, 1.6, 1.7_

- [x] 5. 检查点 - 阶段 6 构建零错误且行为保持
  - 运行 `npm run build`，要求零错误完成；确认所有阶段 6 可观察行为与重构前一致。Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 1.5, 1.6_

- [x] 6. 数据驱动的 App_Definition 注册表
  - [x] 6.1 扩展 `content.json` 新增窗口/桌面/留言板/控制面板文案与 i18n 字典
    - 追加 `desktop.icons`、`windows.*`、`notepad.*`、`controlPanel.*` 片段（zh/en 双语）
    - 经现有 `i18n/strings.js` 派生机制使新文案参与双语
    - _Requirements: 15.4, 15.5, 17.3, 18.3_
  - [x] 6.2 从内容源派生 App_Definition 注册表
    - 实现 `scripts/wm/registry.js`（或扩展 `data/site.js`），按设计的注册表表格输出 9 个 `AppDefinition`（main / chat / 三个 pdf / notepad / 三个 decorative）
    - 每项含 id、titleKey、icon、singleInstance、resizable、maximizable、defaultSize、minSize、content、launch、mobile
    - _Requirements: 18.1, 18.3, 18.4, 19.5, 19.6, 22.5_

- [x] 7. 窗口管理器核心：注册、实例化与打开或聚焦
  - [x] 7.1 实现 WindowManager 骨架、实例模型与模板克隆实例化
    - 新建 `scripts/wm/window-manager.js`，实现 `createWindowManager`、`register`、`WindowInstance` 内部模型
    - 通过克隆 `xp-window-template` 创建窗口 DOM，按 App_Definition 填充标题/图标、决定是否显示最大化按钮、是否挂载 resize 把手
    - _Requirements: 18.1, 18.2, 22.5, 19.6_
  - [x] 7.2 实现 openOrFocus、单实例与懒实例化 + init 自动打开主窗口
    - `openOrFocus(appId)`：已可见→聚焦；已最小化→还原并聚焦；不存在→懒实例化
    - `init()`：绑定全局事件；非移动端自动仅实例化并打开 Main_Window，不预实例化其他窗口
    - _Requirements: 7.1, 7.2, 7.3, 8.1, 8.8, 8.9, 18.5_
  - [x] 7.3 实现点击聚焦与 z-index 堆叠
    - 维护单调递增 `zSeq`；任意窗口 `pointerdown`（捕获阶段）提升其 z-index 并加 `.is-active`，其余移除该类，任意时刻至多一个活动窗口
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 7.4 为注册机制编写属性测试
    - **Property 7: 注册任意合法 App_Definition 自动获得标准窗口行为**
    - 生成随机合法 `App_Definition`，注册并打开后断言具备可拖动/可聚焦/有 Task_Button/可关闭/错落摆放/打开或聚焦等标准行为（≥100 次迭代）
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.5**
  - [x] 7.5 为打开或聚焦语义编写属性测试
    - **Property 5: 单实例与打开或聚焦语义**
    - 生成随机 `openOrFocus` 序列，断言每个单实例 appId 至多一个实例，重复触发不创建副本而是可见且聚焦（已最小化先还原）（≥100 次迭代）
    - **Validates: Requirements 7.1, 7.2, 7.3**
  - [x] 7.6 为懒实例化编写属性测试
    - **Property 6: 懒实例化——未触发的窗口不存在**
    - 断言初始化后仅 Main_Window 存在，任意未触发的非 Main 窗口实例不存在，首次触发后才创建（≥100 次迭代）
    - **Validates: Requirements 8.1, 8.8, 8.9**
  - [x] 7.7 为聚焦与堆叠编写属性测试
    - **Property 1: 聚焦使被点窗口置顶且唯一活动**
    - 生成随机窗口集合与聚焦序列，断言被聚焦窗口 z-index 严格最大且任意时刻恰好一个活动标题栏（≥100 次迭代）
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

- [x] 8. 窗口管理器交互：最小化/还原、关闭、错落摆放
  - [x] 8.1 实现 Task_Button 最小化/还原
    - 打开即创建显示标题的 Task_Button；点击规则：可见且聚焦→最小化并置非活动；隐藏→显示+聚焦+置活动；可见未聚焦→聚焦+置活动
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 8.2 实现窗口关闭与焦点转移
    - 移除窗口 DOM 与其 Task_Button；若关闭的是聚焦窗口且仍有可见窗口，则聚焦剩余可见窗口中 z-index 最高者；再次打开创建新实例
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 8.3 实现新窗口错落摆放
    - 维护 `openCount`，新窗口位置 = 桌面中心 + 步进偏移，并钳制到可见工作区内确保标题栏可被指针触及
    - _Requirements: 6.1, 6.2_
  - [x] 8.4 为 Task_Button 等价关系编写属性测试
    - **Property 2: Task_Button 活动态等价于"可见且聚焦"**
    - 生成随机点击序列，断言每个 Task_Button 活动 ⇔ 窗口可见且聚焦（≥100 次迭代）
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
  - [x] 8.5 为关闭与焦点转移编写属性测试
    - **Property 3: 关闭后实例与按钮完整移除且焦点正确转移**
    - 断言关闭任意窗口后其 DOM 与 Task_Button 均不存在，焦点转移至剩余可见窗口中 z-index 最高者（≥100 次迭代）
    - **Validates: Requirements 5.1, 5.2, 5.3**
  - [x] 8.6 为错落摆放编写属性测试
    - **Property 4: 新窗口错落且落在可见工作区内**
    - 连续打开 N 个窗口，断言相邻窗口初始位置不完全重合且矩形落在可见工作区内（≥100 次迭代）
    - **Validates: Requirements 6.1, 6.2**

- [x] 9. 窗口管理器几何：拖动、调整尺寸、最大化/还原
  - [x] 9.1 实现标题栏拖动
    - 标题栏表面 `pointerdown`（非控制按钮）启动拖动，`pointermove` 更新 left/top，`pointerup` 结束；拖动中保持聚焦置顶；最大化态与移动端禁用
    - 并为该行为编写示例单元测试：标题栏 pointerdown→move 产生位移；在控制按钮上 pointerdown 不启动拖动；移动端禁用拖动
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 9.2 实现边缘/角落调整尺寸 + 最小尺寸约束
    - 8 个把手按方位改变 width/height（必要时同步改 left/top），施加 minSize，内容弹性自适应；Main_Window 不参与；调整中保持聚焦置顶；最大化态与移动端禁用
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8_
  - [x] 9.3 实现最大化/还原 + 双击标题栏
    - 最大化前保存 `restoreRect`，最大化铺满桌面工作区（视口减任务栏高度）并加 `.is-maximized`，还原回写 restoreRect；双击标题栏等价；最大化态禁用拖动与调整尺寸；Main_Window 无最大化控件；移动端禁用
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6_
  - [x] 9.4 为最小尺寸约束编写属性测试
    - **Property 8: 最小尺寸约束恒成立**
    - 生成随机调整尺寸拖拽序列（含极小尝试），断言结果宽高恒不小于 minSize（≥100 次迭代）
    - **Validates: Requirements 19.1, 19.4, 19.5**
  - [x] 9.5 为最大化/还原编写属性测试
    - **Property 9: 最大化/还原往返且最大化态锁定几何**
    - 断言最大化后还原精确回到原矩形，且最大化态下拖动/调整尺寸不改变矩形（≥100 次迭代）
    - **Validates: Requirements 22.2, 22.3, 22.4**

- [x] 10. 窗口管理器无障碍与减弱动效
  - [x] 10.1 实现键盘无障碍：Esc 关闭、Tab 焦点陷阱、控件键盘触发
    - 聚焦窗口按 Esc 关闭可关闭窗口；窗口内 Tab 焦点循环（首尾环绕陷阱）；窗口控制按钮可键盘聚焦并以 Enter/Space 触发
    - 并为该行为编写示例单元测试：合成 KeyboardEvent 断言 Esc 关闭聚焦窗口、Tab 在窗口内循环、控制按钮 Enter/Space 激活
    - _Requirements: 16.4, 16.5, 16.6_
  - [x] 10.2 实现 Reduced_Motion 下抑制窗口与界面动画
    - 通过 `prefers-reduced-motion: reduce` 抑制/最小化非必要动画
    - _Requirements: 16.1_

- [x] 11. 检查点 - 窗口管理器核心可用
  - 运行全部已有测试并执行构建，确认窗口生命周期/几何/无障碍均通过。Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 16.3_

- [x] 12. 内容渲染器分发框架
  - [x] 12.1 实现按 content.kind 注入正文的渲染器分发
    - 定义纯函数式渲染器接口 `render(bodyEl, appDef, ctx) -> { onFocus?, onResize?, onClose? }`，由 WindowManager 在实例化时调用对应 kind 渲染器
    - 注册 kind → 渲染器映射，支持未来扩展新 kind
    - _Requirements: 18.4_

- [x] 13. main-card 渲染器（培文的名片）
  - [x] 13.1 实现主名片渲染与操作接线
    - 渲染系统属性风格：蓝色 Luna 标题栏（标题"培文的名片" + 装饰性"?" + "×"）、米色主体、选项卡条、左图右信息布局、底部 OK/Cancel/Apply 装饰按钮；承载头像/姓名/标语/AI 入口/产品条目/联系图标/页脚（复用 content.json）
    - 接线：AI 入口与 PDF 产品条目 `openOrFocus`；`action:'chat'` 产品条目打开聊天并按当前语言自动发送引导语；联系图标复用 `initCopy` 复制 + Toast 不开窗；"?"与选项卡/装饰按钮不改变内容
    - 并为该行为编写示例单元测试：断言 AI 入口/各产品条目触发正确 `openOrFocus`；`action:'chat'` 按语言自动发送；联系图标复制不开窗；装饰控件不改内容
    - _Requirements: 8.2, 8.4, 8.5, 8.6, 8.7, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 14. chat 渲染器（窗口化 AI 聊天，保留 SSE）
  - [x] 14.1 将聊天迁移为窗口正文渲染器
    - 把 `scripts/apps/chat.js` 接入 chat 渲染器：标题栏 + 消息流 + 建议气泡 + 输入框 + 发送按钮；复用 `chatProvider.stream` 保留 SSE 流式追加
    - 首次打开显示问候 + 气泡；点击气泡发送；空响应/错误显示配置错误文案
    - 并为该行为编写示例单元测试：模拟 SSE 流断言 token 追加、空响应错误文案、气泡点击发送、首次问候
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 15. pdf-iframe 渲染器（三个 PDF 查看器窗口）
  - [x] 15.1 实现 PDF 查看器渲染
    - 三个 PDF 窗口分别映射 `/pdf/apihub-overseas-llm-relay.pdf`、`/pdf/fastgpt-commercial.pdf`、`/pdf/microsoft365-copilot.pdf`，正文用 `<iframe>`，标题栏显示文档名
    - 并为该行为编写示例单元测试：断言三窗口 src 映射正确、标题显示文档名
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 16. decorative 渲染器（我的电脑 / 我的文档 / 控制面板）
  - [x] 16.1 实现"我的电脑"装饰窗口
    - 纯 CSS/SVG 像素风格模拟界面，无窗口管理之外的功能
    - 并为该行为编写示例单元测试：断言"我的电脑"无功能行为
    - _Requirements: 12.1, 12.2_
  - [x] 16.2 实现"我的文档"PDF 快捷入口窗口
    - 陈列三个 PDF 的快捷入口，激活走 `openOrFocus` 遵循打开或聚焦语义
    - 并为该行为编写示例单元测试：断言"我的文档"PDF 入口触发 `openOrFocus`
    - _Requirements: 12.1, 12.3, 12.4_
  - [x] 16.3 实现"控制面板"设置窗口
    - 提供 Active_Language 切换（zh/en）与 Reduced_Motion 偏好开关/提示，经 `data-i18n` 双语呈现，保持 XP 像素外观
    - 并为该行为编写示例单元测试：断言控制面板语言切换与减弱动效偏好生效
    - _Requirements: 12.1, 12.5_

- [x] 17. 留言板后端：存储层与可写卷
  - [x] 17.1 在代理中实现 JSON 文件存储（原子写 + 写锁）
    - 扩展 `proxy/server.js`：`messages.json` 读取（缺失/损坏回退空集并惰性重建），写入用临时文件 + `fs.renameSync` 原子替换，写操作经内存队列串行化写锁
    - 存储路径取自 `MESSAGES_FILE`（默认 `./data/messages.json`），顶层结构 `{ version, items }`
    - _Requirements: 17.4, 20.3, 20.4, 20.17_
  - [x] 17.2 为代理配置可写持久化卷
    - 更新 `docker-compose.yml` 为代理挂载可写卷以持久化 `messages.json`，并设置 `MESSAGES_FILE` 环境变量；保持其余部署模型不变
    - _Requirements: 17.4, 20.3, 20.4_

- [x] 18. 留言板后端：REST 端点
  - [x] 18.1 实现 GET /api/messages 列表（分页/限量）
    - 按 createdAt 倒序返回，支持 `limit`/`before`，默认与最大 limit 钳制，返回 `{ items, total, hasMore }`
    - _Requirements: 20.4, 20.15_
  - [x] 18.2 实现 POST /api/messages（创建 + 校验 + 转义 + 写限流）
    - 体 `{ nickname?, text, ownerId }`；复用 MAX_BODY_BYTES；服务端强制 MAX_MSG_LEN/MAX_NICK_LEN（超限 400 too_long）；HTML 转义 nickname/text 后入库；对写操作复用按 IP 限流（超频 429）；成功 201 返回 item
    - _Requirements: 17.5, 20.3, 20.10, 20.11, 20.12_
  - [x] 18.3 实现 PATCH / DELETE /api/messages/:id（归属判定）
    - 比对请求 `ownerId` 与存储 `ownerId`：匹配则编辑/删除并原子落盘；不匹配 403 forbidden；未找到 404 not_found；编辑同样强制最大长度与转义
    - _Requirements: 20.5, 20.6, 20.7, 20.10_
  - [x] 18.4 为留言读写往返编写属性测试
    - **Property 11: 留言读写往返（持久化共享）**
    - 生成随机合法留言，创建后再列出应包含且字段一致（含默认匿名、时间戳）（≥100 次迭代，使用独立临时 MESSAGES_FILE 隔离）
    - **Validates: Requirements 20.3, 20.4, 20.12, 20.13**
  - [x] 18.5 为归属判定编写属性测试
    - **Property 12: 留言归属判定（尽力而为）**
    - 生成随机 ownerId 组合，断言仅匹配时编辑/删除成功，不匹配一律 403（≥100 次迭代）
    - **Validates: Requirements 20.5, 20.6, 20.7**
  - [x] 18.6 为服务端最大长度强制编写属性测试
    - **Property 13: 服务端最大长度强制**
    - 生成超长文本/昵称，断言创建/编辑一律 400 且不写入存储（≥100 次迭代）
    - **Validates: Requirements 20.10, 20.14**
  - [x] 18.7 为 XSS 转义编写属性测试
    - **Property 14: 用户生成内容转义防 XSS**
    - 生成含 HTML 元字符的文本/昵称，断言存储为已转义内容，且经 textContent 渲染后 DOM 不新增元素节点（≥100 次迭代）
    - **Validates: Requirements 17.5, 20.6**
  - [x] 18.8 为列表限量编写属性测试
    - **Property 15: 列表分页/限量**
    - 生成任意规模留言集合与任意 limit，断言返回 items 条数不超过 limit（≥100 次迭代）
    - **Validates: Requirements 20.15**
  - [x] 18.9 为留言板后端编写集成测试
    - 启动扩展后的代理（指向临时 messages.json），用真实 HTTP 走完整 GET/POST/PATCH/DELETE，验证状态码/响应形状/持久化；进程重启后仍可读到留言；连续写超阈值返回 429；确认 /api/chat SSE 透传与错误响应未被破坏
    - _Requirements: 20.3, 20.4, 20.11_

- [x] 19. 留言板前端：客户端与 notepad 窗口
  - [x] 19.1 实现 Visitor_Id 工具
    - `scripts/notepad/visitor-id.js`：localStorage 持久化 `crypto.randomUUID()`，首次访问惰性生成
    - _Requirements: 20.7_
  - [x] 19.2 实现 messagesClient
    - `scripts/notepad/messages-client.js`：list/create/edit/remove 调 `/api/messages`，错误以带 code/status 的对象抛出
    - _Requirements: 20.3, 20.4, 20.5_
  - [x] 19.3 实现 notepad 渲染器（留言板 UI）
    - XP 记事本风格：列表（textContent 渲染、时间戳、默认匿名名）、可选昵称、提交、本人留言编辑/删除、空状态文案、字数提示与上限禁用提交、错误码→友好双语文案
    - 并为该行为编写示例单元测试：断言默认匿名名、时间戳渲染、空状态文案、各错误码（too_long/rate_limited/saveError/loadError）映射友好文案、字数达上限禁用提交
    - _Requirements: 20.1, 20.2, 20.8, 20.9, 20.12, 20.13, 20.14, 20.16_

- [x] 20. 桌面图标
  - [x] 20.1 实现数据驱动的 DesktopIcons
    - `components/DesktopIcons.astro` + `scripts/desktop-icons.js`：从注册表中 `launch.desktopIcon` 的应用渲染（含 main/三个 pdf/chat/notepad），点击/双击 `openOrFocus`，名称经 data-i18n 双语，可键盘聚焦并 Enter/Space 触发
    - _Requirements: 21.1, 21.2, 21.3, 21.5, 16.6_

- [x] 21. 开始菜单接线
  - [x] 21.1 将开始菜单条目改为数据驱动并接线
    - 将 `XPTaskbar.astro` 中静态菜单项替换为数据驱动列表：真实条目（培文的名片、三个 PDF、记事本、三个系统位置）`openOrFocus`；装饰条目（IE、Outlook、Search、Help、Run、Log Off、Shut Down）无动作；条目可键盘聚焦触发
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 16.6_

- [x] 22. 任务栏动态 Task_Button
  - [x] 22.1 将任务区改为由窗口管理器动态增删
    - 移除 `XPTaskbar.astro` 中写死的 Task_Button，使 `#xpTasks` 由 WindowManager 在 open/close 时动态创建/移除
    - _Requirements: 4.1, 5.2_

- [x] 23. 移动端布局降级（≤768px）
  - [x] 23.1 实现移动端降级行为
    - `isMobile()` 判定下：隐藏 Taskbar/Start_Menu/壁纸/桌面图标；Main 全屏不可拖动无圆角；Chat/Notepad 大号居中对话框（不可拖动/调整尺寸）；PDF 入口改 `window.open(_blank)`；装饰窗口不可用；语言切换右上角与 Toast 底部中央保持可见
    - 并为该行为编写示例自动化测试：mock matchMedia/视口宽度 ≤768px，断言隐藏项、Main 全屏、Chat/Notepad 对话框、PDF 新标签、装饰不可用、图标隐藏、语言切换与 Toast 可见
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 21.4_

- [x] 24. 桌面初始化接线（消除孤立代码）
  - [x] 24.1 在入口装配并初始化全部子系统
    - 在精简后的 `index.astro` 入口装配注册表、WindowManager、内容渲染器、DesktopIcons、StartMenu、动态任务栏，调用 `wm.init()`；统一三套启动入口（桌面图标/开始菜单/主窗口操作）经同一注册表解析目标窗口并遵循打开或聚焦语义
    - _Requirements: 18.5, 21.5, 8.1_

- [-] 25. 最终集成与构建校验
  - [x] 25.1 全量构建与测试校验
    - 运行 `npm run build` 零错误完成；运行前端与后端全部属性/单元/集成测试通过；确认 /api/chat SSE 回归正常、留言板端到端可用、全部窗口经三套入口可打开或聚焦
    - _Requirements: 1.5, 1.6, 16.3, 17.1, 17.2_
  - [ ] 25.2 响应式手动核查（≤768px）
    - 依据设计测试策略，在 ≤768px 视口人工核查任务栏/开始菜单/壁纸/图标隐藏、Main 全屏、Chat/Notepad 大对话框、PDF 新标签、装饰不可用、语言切换与 Toast 可见、XP Luna 视觉一致
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 16.2_
  - [ ] 25.3 无障碍手动核查
    - 人工核查可聚焦元素的清晰焦点轮廓与关键控件对比度；说明完整 WCAG 合规需借助辅助技术手动测试与无障碍专家评审，自动化仅覆盖部分
    - _Requirements: 16.4, 16.5, 16.6_

- [ ] 26. 像素草原壁纸增强（Req 23）
  - [ ] 26.1 重写 PixelBliss 草地渲染为多层弧线山丘
    - 在 `site/src/components/PixelBliss.astro` 中重写草地区域渲染：使用 ImageData 逐像素操作；实现 5 层不同深度的正弦叠加山丘（远景浅黄绿 → 近景深绿）；添加暖色阳光高光 + 冷色山谷阴影 + 草叶质感像素细节；保留现有天空和云层不变
    - 并为该行为编写测试：验证 ImageData 输出非全平（不同列的地平线高度不同）、草地像素颜色在合理绿色范围内
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6_

- [ ] 27. 像素骑车人（Req 24）
  - [ ] 27.1 在 PixelBliss Canvas 上绘制像素骑车人
    - 在 `site/src/components/PixelBliss.astro` 草地渲染后、地平线雾霭前绘制像素自行车 + 骑手剪影；约 6×8 像素块；位于中景（距地平线约 30%，水平约 60% 处）；使用深绿/深灰色剪影色
    - 并编写测试：验证骑车人像素位置在预期范围内、像素颜色非全透明
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5_

- [ ] 28. 语言切换按钮重定位到系统托盘（Req 25）
  - [ ] 28.1 将语言按钮移入 XPTaskbar 系统托盘区
    - 修改 `XPTaskbar.astro`：在 `.xp-tray` 容器内时钟左侧新增语言按钮容器；修改 `index.astro`：移除独立的 `<button id="lang-toggle">`；修改 `desktop.css`：`.lang-toggle` 改为托盘内嵌样式（去掉 position:fixed、缩小尺寸）；确保移动端仍有语言切换入口（浮动按钮或其他方式）
    - 并编写测试：验证语言按钮在 `.xp-tray` 内存在、点击后切换语言、移动端语言按钮可见
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5_

- [ ] 29. 管理员密钥 XP 对话框（Req 26）
  - [ ] 29.1 实现记事本内模态管理员密钥输入对话框
    - 在 `site/src/scripts/wm/renderers/notepad.js` 中：替换 `prompt()` 调用为模态覆盖层对话框；对话框 UI 模仿 XP "运行"对话框（钥匙图标 🔑 + 标题"管理员验证" + 密码输入框 + 确定/取消按钮）；确定时验证密钥并进入管理模式；取消/Esc 关闭对话框；支持中英文双语
    - 并编写测试：验证点击管理按钮弹出对话框 DOM、输入密钥后进入管理模式、取消关闭对话框、Esc 关闭对话框
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5_

- [ ] 30. 开始菜单功能项（Req 27）
  - [ ] 30.1 实现轻量 XP 对话框组件（xp-dialog）
    - 在 `site/src/components/XPTaskbar.astro` 的 JS 中实现共享的轻量对话框组件：配置驱动的模态覆盖层（标题、图标、输入框类型、按钮文案、回调函数），供 Search/Run/LogOff/ShutDown 复用
    - _Requirements: 27.3, 27.5, 27.6, 27.7_
  - [ ] 30.2 实现 Internet Explorer / Outlook Express 点击行为
    - 为 XPTaskbar 中的 IE 条目添加 click handler → `window.open` 新标签页；为 Outlook 条目添加 click handler → `mailto:` 链接（收件人从 content.json 的 contacts 提取）
    - 并编写测试：验证点击触发正确的 `window.open` / `window.location.href`
    - _Requirements: 27.1, 27.2_
  - [ ] 30.3 实现 Search / Run 对话框
    - Search：弹出 xp-dialog（搜索输入框），确认后 `window.open('https://google.com/search?q=' + keyword, '_blank')`；Run：弹出 xp-dialog（URL 输入框），确认后 `window.open(url, '_blank')`
    - 并编写测试：验证对话框渲染、输入后打开正确 URL
    - _Requirements: 27.3, 27.5_
  - [ ] 30.4 实现 Help and Support / Log Off / Shut Down
    - Help：在 registry.js 新增 `help` App_Definition（kind=`decorative`，decoType=`help`），新增 help 渲染器（展示 content.json 的联系方式列表），点击 Help 条目调用 `window.__wm.openOrFocus('help')`；Log Off：弹出确认对话框，确认后关闭所有窗口（或显示彩蛋）；Shut Down：弹出确认对话框，确认后全屏黑色覆盖 + "现在可以安全关闭" 文案，点击/按键恢复
    - 并编写测试：验证 Help 打开新窗口（非 main）、LogOff 弹出确认、ShutDown 弹出确认 + 覆盖层出现/消失
    - _Requirements: 27.4, 27.6, 27.7_
  - [ ] 30.5 开始菜单功能项 i18n + 移动端隐藏
    - 为所有新增的开始菜单功能项添加 `data-i18n-zh/en` 双语文案；确保移动端（≤768px）隐藏所有新增功能项
    - _Requirements: 27.8, 27.9_

- [ ] 31. 增量集成与构建校验
  - [ ] 31.1 全量构建与测试校验（增量）
    - 运行 `npm run build` 零错误；运行前端与后端全部测试通过；确认新增功能（草原增强、骑车人、语言按钮、管理弹窗、开始菜单）均正常工作且不影响现有窗口管理器和留言板功能
    - _Requirements: 1.5, 1.6, 23.1, 24.1, 25.1, 26.1, 27.1_

## Notes

- 示例/单元测试不再作为独立子任务，而是折叠进对应实现子任务的描述中（"…并为该行为编写示例单元测试"），随实现一并完成。
- 属性测试保留为独立（可选，标记 `*`）子任务；集成测试（任务 18.9）与手动核查（任务 25.2、25.3）同样保留为独立任务。可选子任务可为更快的 MVP 跳过，核心实现任务不可跳过。
- 属性测试使用 fast-check，每条至少 100 次迭代，并以 `// Feature: xp-desktop-window-manager, Property {n}: {标题}` 注释标注来源；窗口管理器属性测试在 happy-dom/jsdom 下以合成事件驱动，后端属性测试对处理函数 + 临时 MESSAGES_FILE 运行并逐次隔离。
- 每个任务都引用具体需求子条款以保证可追溯；阶段 6 任务强约束"行为保持 + 构建零错误"。
- 检查点（任务 5、11）用于增量验证；最终任务 25 完成端到端集成与构建校验，确保无孤立、未接线的代码。
- 安全约束贯穿后端任务：服务端最大长度、写限流、HTML 转义 + 前端 textContent 渲染双重防 XSS；ownerId 归属为尽力而为控制，非安全边界。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "17.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "18.1"] },
    { "id": 3, "tasks": ["2.3", "3.1", "18.2"] },
    { "id": 4, "tasks": ["4.1", "18.3", "19.1"] },
    { "id": 5, "tasks": ["4.2", "17.2", "19.2", "18.4", "18.5", "18.6", "18.7", "18.8", "18.9"] },
    { "id": 6, "tasks": ["6.1"] },
    { "id": 7, "tasks": ["6.2"] },
    { "id": 8, "tasks": ["7.1"] },
    { "id": 9, "tasks": ["7.2"] },
    { "id": 10, "tasks": ["7.3"] },
    { "id": 11, "tasks": ["8.1", "7.4", "7.5", "7.6", "7.7"] },
    { "id": 12, "tasks": ["8.2"] },
    { "id": 13, "tasks": ["8.3", "8.4", "8.5"] },
    { "id": 14, "tasks": ["9.1", "8.6"] },
    { "id": 15, "tasks": ["9.2"] },
    { "id": 16, "tasks": ["9.3", "9.4"] },
    { "id": 17, "tasks": ["10.1", "9.5"] },
    { "id": 18, "tasks": ["10.2"] },
    { "id": 19, "tasks": ["12.1"] },
    { "id": 20, "tasks": ["13.1", "14.1", "15.1", "16.1", "16.2", "16.3", "19.3"] },
    { "id": 21, "tasks": ["20.1", "21.1"] },
    { "id": 22, "tasks": ["22.1", "23.1"] },
    { "id": 23, "tasks": ["24.1"] },
    { "id": 24, "tasks": ["25.1"] },
    { "id": 25, "tasks": ["25.2", "25.3"] },
    { "id": 26, "tasks": ["26.1"] },
    { "id": 27, "tasks": ["27.1"] },
    { "id": 28, "tasks": ["28.1"] },
    { "id": 29, "tasks": ["29.1"] },
    { "id": 30, "tasks": ["30.1"] },
    { "id": 31, "tasks": ["30.2", "30.3"] },
    { "id": 32, "tasks": ["30.4", "30.5"] },
    { "id": 33, "tasks": ["31.1"] }
  ]
}
```
