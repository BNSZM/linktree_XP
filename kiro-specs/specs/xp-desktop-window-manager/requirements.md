# Requirements Document

## Introduction

本功能将现有的静态个人主页改造为一个完全可交互的虚拟 Windows XP 桌面。整体工作划分为三个阶段，并在已完成的桌面外壳（XP Luna 主题、像素 Bliss 壁纸、任务栏、开始菜单）之上展开：

- **阶段 6 — 架构重构**：将当前内联的脚本逻辑抽取为可复用的模块，将单一庞大的样式表拆分为职责聚焦的多个样式表，引入可复用的 XP 窗口组件，并将页面入口精简为轻量的组装层。本阶段必须完整保留所有可观察行为。（当前代码库中对应的文件如 `site/src/scripts/`、`global.css`、`XPWindow.astro`、`index.astro` 仅作为现状示例，并非强制的实现目标。）
- **阶段 7 — 窗口管理器**：一个窗口管理器，提供标题栏拖动、点击聚焦提升 z-index、通过动态任务栏按钮最小化/还原、关闭（同时移除任务栏按钮），以及新窗口的层叠摆放。
- **阶段 8 — 多窗口**：一个在加载时自动打开的主窗口"培文的名片"（采用 XP"系统属性"对话框的视觉风格）、一个 AI 聊天窗口（由当前的模态遮罩层转换为可拖动窗口，同时保留 SSE 流式传输）、三个 PDF 查看器窗口（iframe），以及三个装饰性窗口（我的电脑 / 我的文档 / 控制面板）。开始菜单项与主窗口内的操作必须打开或聚焦到正确的窗口。

本功能的要求刻画的是 WHAT（行为与业务约束），而将技术实现决策完全交给实现者：所采用的框架、构建工具与依赖项均可由实现者自由选择，只要满足本文档所述的可观察行为与安全/数据约束。必须保留的现有能力包括：双语 i18n（zh/en 切换并持久化用户选择）、联系方式复制到剪贴板、SSE 流式聊天、减弱动效的无障碍支持，以及 XP Luna 视觉一致性。移动端策略（视口宽度 ≤ 768px）会优雅地降级桌面体验。文中出现的具体文件名、路径与格式（例如 `content.json`、`site.js`、`strings.js`、`chat/provider.js`、`index.astro`）均为当前代码库的示例性引用，用于说明现状，而非强制要求的模块边界、文件布局或数据格式。

## Glossary

- **Desktop**：始终存在的虚拟 XP 环境层，包含壁纸、任务栏、语言切换和 Toast 区域。无法被关闭。
- **Window_Manager**：负责控制窗口生命周期、堆叠顺序、拖动、聚焦、最小化/还原和关闭行为的客户端子系统。其实现所用的框架与依赖由实现者自行决定。
- **Window**：由 Window_Manager 管理的、采用 XP 风格的可拖动程序窗口。每个 Window 拥有唯一标识符、标题栏、内容区域，以及（当可关闭时）关闭控件。除固定尺寸的 Main_Window 外，所有 Window 均可通过边缘与角落拖拽调整大小。
- **App_Definition**：对某一窗口类型的数据驱动声明，包含其唯一标识符、标题、图标、内容、单实例或多实例行为，以及启动入口（Start_Menu 和/或 Main_Window）。Window_Manager 依据 App_Definition 注册并实例化对应的 Window。
- **Main_Window**："培文的名片"Window——个人名片窗口，采用经典 Windows XP"系统属性"对话框的视觉风格，包含头像、姓名、标语、AI 聊天入口按钮、产品条目、联系方式图标和页脚。
- **Chat_Window**：提供 AI 对话界面的 Window（消息流、建议气泡、输入框、发送按钮），由 SSE 流式聊天支撑。
- **PDF_Window**：通过 iframe 嵌入一个产品 PDF 文档的 Window。共有三个 PDF_Windows：Overseas LLM Relay、FastGPT Commercial 和 Microsoft 365。
- **Decorative_Window**：采用像素风格模拟 UI 的 XP 系统位置 Window。共有三个 Decorative_Windows：我的电脑（纯装饰性）、我的文档（陈列三个 PDF_Windows 的快捷入口）和控制面板（提供语言切换与 Reduced_Motion 偏好等轻量真实设置入口）。每个 Decorative_Window 均为单实例。
- **Notepad_Window**：采用 XP 记事本风格的 Window，作为公共/共享留言板，加载并显示所有访客保存的留言，并允许访客提交、编辑或删除其本人创建的留言。Notepad_Window 为单实例。
- **Visitor_Id**：为每位访客在其浏览器中生成并保存的匿名标识符（访客标识），用于以最简单方式判断留言归属，不涉及复杂的用户登录或身份校验。
- **Desktop_Icon**：显示在 Desktop 壁纸区域的程序启动图标，包含程序名称与图标，被激活时打开或聚焦其对应的 Window。
- **Taskbar**：固定在底部的 XP 栏，包含开始按钮、任务按钮区域、系统托盘和时钟。
- **Task_Button**：位于 Taskbar 任务按钮区域中的按钮，代表一个已打开的 Window，并反映该 Window 的活动/非活动状态。
- **Start_Menu**：由开始按钮打开的面板，包含程序条目（左栏）、系统位置条目（右栏）和装饰性条目。
- **Toast**：浮动的 XP 提示风格状态消息，用于诸如复制确认之类的瞬时反馈。
- **Mobile_Layout**：当视口宽度不超过 768 像素时应用的展示形式。
- **Reduced_Motion**：通过 `prefers-reduced-motion: reduce` 媒体查询表达的用户偏好。
- **Content_Source**：文本与产品数据的唯一数据来源（当前代码库中以 `site/src/config/content.json` 文件形式存在，其具体文件与格式属于实现细节）。
- **Active_Language**：当前选定的界面语言，为中文（`zh`）或英文（`en`）之一，并在用户的浏览器中持久化保存。

## Requirements

### Requirement 1: 架构重构并保留行为（阶段 6）

**User Story:** 作为维护者，我希望将内联脚本和单一庞大的样式表重组为清晰、模块化、可维护的架构，以便后续的窗口管理器工作易于维护，且不改变当前站点的行为方式。

#### Acceptance Criteria

1. THE Site SHALL 将此前内联的国际化、复制到剪贴板和聊天逻辑组织为清晰、可复用的模块，且具体的模块边界与文件布局由实现者决定。
2. THE Site SHALL 将样式组织为职责聚焦、可维护的结构，且具体的样式表拆分方式由实现者决定。
3. THE Site SHALL 提供一个可复用的 XP 窗口组件，渲染 XP 窗口框架（标题栏、可选图标、标题文本、窗口控制按钮和一个内容插槽）。
4. THE Site SHALL 将页面入口精简为一个组装层，负责引入样式、组合组件并初始化所需逻辑。
5. WHEN 使用项目构建命令构建重构后的站点时，THE Site SHALL 以零错误完成构建。
6. WHERE 重构前存在某项用户交互（语言切换、联系方式复制、标签切换、聊天打开/关闭、聊天流式传输、头像文本注入、主题色注入），THE Site SHALL 在重构后以完全相同的可观察行为重现该交互。
7. THE Site SHALL 在重构期间保持文本数据、产品数据、提供者逻辑与 i18n 字符串的来源职责不变，使其在重构后仍由单一数据来源驱动。

### Requirement 2: 窗口拖动（阶段 7）

**User Story:** 作为访客，我希望通过标题栏拖动窗口，以便像真实的 XP 系统那样整理桌面。

#### Acceptance Criteria

1. WHEN 指针按下动作在某个 Window 标题栏上开始且指针移动时，THE Window_Manager SHALL 移动该 Window，使其位置跟随指针移动。
2. WHEN 拖动后释放指针时，THE Window_Manager SHALL 停止移动该 Window 并将其保留在释放位置。
3. WHILE 某个 Window 正在被拖动，THE Window_Manager SHALL 保持该 Window 为已聚焦且最上层的 Window。
4. IF 指针按下动作在 Window 控制按钮（关闭、最小化、最大化）上开始而非标题栏表面，THEN THE Window_Manager SHALL NOT 启动拖动。
5. WHERE Mobile_Layout 处于激活状态，THE Window_Manager SHALL 禁用标题栏拖动。

### Requirement 3: 点击聚焦与堆叠顺序（阶段 7）

**User Story:** 作为访客，我希望点击窗口能将其置于最前，以便处理相互重叠的窗口。

#### Acceptance Criteria

1. WHEN 指针按下动作发生在某个 Window 的任意位置时，THE Window_Manager SHALL 将该 Window 提升到相对于所有其他 Windows 的最上层堆叠位置。
2. WHEN 某个 Window 成为已聚焦的 Window 时，THE Window_Manager SHALL 为该 Window 应用活动标题栏外观。
3. WHEN 某个 Window 成为已聚焦的 Window 时，THE Window_Manager SHALL 为所有其他 Windows 应用非活动标题栏外观。
4. THE Window_Manager SHALL 在任意时刻最多维持一个已聚焦的 Window。

### Requirement 4: 通过任务栏最小化与还原（阶段 7）

**User Story:** 作为访客，我希望通过任务栏按钮最小化和还原窗口，以便管理屏幕空间。

#### Acceptance Criteria

1. WHEN 某个 Window 被打开时，THE Window_Manager SHALL 在 Taskbar 任务按钮区域创建一个对应的 Task_Button。
2. WHEN 点击已聚焦且可见 Window 的 Task_Button 时，THE Window_Manager SHALL 隐藏该 Window 并将其 Task_Button 设为非活动状态。
3. WHEN 点击已隐藏 Window 的 Task_Button 时，THE Window_Manager SHALL 显示该 Window、聚焦它，并将其 Task_Button 设为活动状态。
4. WHEN 点击可见但未聚焦 Window 的 Task_Button 时，THE Window_Manager SHALL 聚焦该 Window 并将其 Task_Button 设为活动状态。
5. THE Task_Button SHALL 显示其所代表 Window 的标题。

### Requirement 5: 窗口关闭（阶段 7）

**User Story:** 作为访客，我希望关闭窗口，以便清理桌面并在之后重新打开它们。

#### Acceptance Criteria

1. WHEN 点击可关闭 Window 的关闭控件时，THE Window_Manager SHALL 将该 Window 从桌面移除。
2. WHEN 某个 Window 被关闭时，THE Window_Manager SHALL 从 Taskbar 移除该 Window 的 Task_Button。
3. WHEN 已聚焦的 Window 被关闭且至少还有一个其他可见 Window 时，THE Window_Manager SHALL 聚焦剩余可见 Windows 中最上层的那个。
4. WHEN 发出打开此前已被关闭的某个 Window 的请求时，THE Window_Manager SHALL 创建该 Window 的新实例及其 Task_Button。

### Requirement 6: 新窗口摆放（阶段 7）

**User Story:** 作为访客，我希望新打开的窗口以错落的位置出现，以便它们不会完全重叠。

#### Acceptance Criteria

1. WHEN 某个 Window 被打开时，THE Window_Manager SHALL 将该 Window 相对中心向右下方偏移摆放，使其不会完全覆盖此前打开的 Window。
2. WHEN 某个 Window 被打开时，THE Window_Manager SHALL 将该 Window 放置在可见桌面区域内，使其标题栏仍可被指针触及。

### Requirement 7: 打开或聚焦语义（阶段 7 / 阶段 8）

**User Story:** 作为访客，我希望触发一个已打开的窗口时将其前置而非创建副本，以便每个程序只对应一个窗口。

#### Acceptance Criteria

1. IF 发出打开当前已打开且可见的某个 Window 的请求，THEN THE Window_Manager SHALL 聚焦现有 Window 而非创建副本。
2. IF 发出打开当前已打开但已最小化的某个 Window 的请求，THEN THE Window_Manager SHALL 还原并聚焦现有 Window 而非创建副本。
3. WHERE 某个 Window 类型为单实例（Main_Window、Chat_Window、每个 PDF_Window、每个 Decorative_Window、Notepad_Window），THE Window_Manager SHALL 允许该 Window 类型在同一时刻最多存在一个实例。

### Requirement 8: 主窗口"培文的名片"（XP 系统属性风格）（阶段 8）

**User Story:** 作为访客，我希望页面加载时个人主页以经典 Windows XP "系统属性"对话框的视觉风格出现，以便我直接进入主要内容，同时获得拟真的 XP 体验。

#### Acceptance Criteria

1. WHEN 桌面在非移动端视口上完成加载时，THE Window_Manager SHALL 自动打开 Main_Window。
2. THE Main_Window SHALL 呈现头像、姓名、标语、AI 聊天入口按钮、产品条目、联系方式图标和页脚。
3. THE Main_Window SHALL 可关闭，且关闭后 THE Main_Window SHALL 可从 Start_Menu 重新打开。
4. THE Main_Window SHALL 呈现一条蓝色 XP Luna 标题栏，显示窗口标题"培文的名片"，并在右上角包含一个"?"（帮助）控制按钮和一个"×"（关闭）控制按钮。
5. THE "?"（帮助）控制按钮 SHALL 为装饰性控制，且 SHALL NOT 执行任何打开窗口或导航的动作。
6. THE Main_Window SHALL 以经典 Windows XP "系统属性"对话框作为视觉风格参考（而非像素级精确复刻），包含标题栏含 ? 与 × 控件、米色对话框主体、选项卡条、左图形右信息布局，以及底部 OK/Cancel/Apply 装饰按钮，用于承载个人主页的人物/资料内容（头像、姓名、标语、AI 聊天入口、产品条目、联系方式、页脚）。
7. THE Main_Window 的装饰性控件与选项卡（OK/Cancel/Apply 按钮、标签条）SHALL 不改变所显示的内容。
8. WHEN 桌面在非移动端视口上完成加载时，THE Window_Manager SHALL 仅实例化/打开 Main_Window，且 SHALL NOT 预先实例化任何其他 Window（Chat_Window、PDF_Windows、Decorative_Windows 及任何未来的 Window）。
9. WHERE 某个非 Main_Window 的 Window 尚未被首次触发，THE Window_Manager SHALL 不创建该 Window 的实例，且该 Window SHALL 仅在首次被触发时（由 Main_Window 操作或 Start_Menu 触发）才被创建，并遵循打开或聚焦语义。

### Requirement 9: 主窗口操作触发其他窗口（阶段 8）

**User Story:** 作为访客，我希望主窗口内的操作能打开相关的程序窗口，以便我从一处探索内容。

#### Acceptance Criteria

1. WHEN 点击 Main_Window 中的 AI 聊天入口按钮时，THE Window_Manager SHALL 打开或聚焦 Chat_Window。
2. WHEN 点击 Main_Window 中的 AI 定制方案产品条目时，THE Window_Manager SHALL 打开或聚焦 Chat_Window AND THE Chat_Window SHALL 以 Active_Language 自动发送配置好的引导消息。
3. WHEN 在非移动端视口上点击 Main_Window 中的 Overseas LLM Relay 产品条目时，THE Window_Manager SHALL 打开或聚焦 Overseas LLM Relay 的 PDF_Window。
4. WHEN 在非移动端视口上点击 Main_Window 中的 FastGPT Commercial 产品条目时，THE Window_Manager SHALL 打开或聚焦 FastGPT Commercial 的 PDF_Window。
5. WHEN 在非移动端视口上点击 Main_Window 中的 Microsoft 365 产品条目时，THE Window_Manager SHALL 打开或聚焦 Microsoft 365 的 PDF_Window。
6. WHEN 点击 Main_Window 中的联系方式图标时，THE Site SHALL 将联系方式值复制到剪贴板并显示 Toast 确认，且不打开任何 Window。

### Requirement 10: 保留流式传输的 AI 聊天窗口（阶段 8）

**User Story:** 作为访客，我希望 AI 聊天表现为可拖动的窗口，同时保留实时流式响应，以便对话与桌面浑然一体。

#### Acceptance Criteria

1. THE Chat_Window SHALL 呈现一个标题栏、一个消息流区域、建议气泡、一个输入框和一个发送按钮。
2. WHEN 提交聊天消息时，THE Chat_Window SHALL 通过服务端代理的 SSE 接口发送对话，并在流式响应令牌到达时将其追加到消息流。
3. IF 聊天响应流未产生内容或报告错误，THEN THE Chat_Window SHALL 在消息流中显示配置好的错误消息。
4. WHEN 在某会话中首次打开 Chat_Window 时，THE Chat_Window SHALL 显示配置好的问候消息并展示建议气泡。
5. WHEN 点击某个建议气泡时，THE Chat_Window SHALL 将该气泡文本作为聊天消息发送。
6. THE Chat_Window SHALL 在非移动端视口上作为由 Window_Manager 管理的可拖动、可聚焦、可关闭的 Window。

### Requirement 11: PDF 查看器窗口（阶段 8）

**User Story:** 作为访客，我希望产品 PDF 在查看器窗口中打开，以便我在桌面内阅读文档。

#### Acceptance Criteria

1. THE Site SHALL 提供三个 PDF_Windows，分别映射到 `/pdf/apihub-overseas-llm-relay.pdf`、`/pdf/fastgpt-commercial.pdf` 和 `/pdf/microsoft365-copilot.pdf`。
2. WHEN 在非移动端视口上打开某个 PDF_Window 时，THE PDF_Window SHALL 在 iframe 中嵌入其映射的 PDF 文档。
3. THE PDF_Window 标题栏 SHALL 显示其所嵌入 PDF 文档的名称。
4. WHEN 在非移动端视口上从 Start_Menu 触发某个 PDF 条目时，THE Window_Manager SHALL 打开或聚焦映射到该条目的 PDF_Window。

### Requirement 12: 装饰性窗口（阶段 8）

**User Story:** 作为访客，我希望有像我的电脑这样的装饰性系统窗口，以便环境感觉像一个完整的 XP 系统。

#### Acceptance Criteria

1. THE Site SHALL 提供三个 Decorative_Windows：我的电脑、我的文档和控制面板。
2. THE 我的电脑 Decorative_Window SHALL 渲染使用 CSS 或 SVG 绘制的像素风格模拟界面，且 SHALL 不提供 Window 管理之外的任何功能行为；THE 我的文档 与 控制面板 Decorative_Windows SHALL 在保持 XP 像素风格外观的同时承载下述轻量真实功能。
3. THE 我的文档 Decorative_Window SHALL 作为陈列三个 PDF_Windows 的快捷入口。
4. WHEN 访客在非移动端视口上于 我的文档 Decorative_Window 中激活某个 PDF 条目时，THE Window_Manager SHALL 打开或聚焦对应的 PDF_Window（遵循 Requirement 7 的打开或聚焦语义）。
5. THE 控制面板 Decorative_Window SHALL 提供轻量的真实设置入口，至少包含 Active_Language 切换（zh/en）与 Reduced_Motion 相关的偏好开关/提示，并通过现有 i18n 机制以中英文双语呈现。
6. WHEN 点击 Start_Menu 右栏中的某个系统位置条目时，THE Window_Manager SHALL 打开或聚焦对应的 Decorative_Window。
7. THE Decorative_Windows SHALL 与所有其他 Windows 一致地可拖动、可聚焦、可关闭和可调整大小。

### Requirement 13: 开始菜单窗口接线（阶段 8）

**User Story:** 作为访客，我希望开始菜单项能打开其窗口，以便菜单充当启动器。

#### Acceptance Criteria

1. WHEN 点击 Start_Menu 中的"培文的名片"条目时，THE Window_Manager SHALL 打开或聚焦 Main_Window。
2. WHEN 点击 Start_Menu 左栏中的某个 PDF 条目时，THE Window_Manager SHALL 打开或聚焦映射到该条目的 PDF_Window。
3. WHEN 点击 Start_Menu 右栏中的某个系统位置条目时，THE Window_Manager SHALL 打开或聚焦对应的 Decorative_Window。
4. WHEN 点击 Start_Menu 中的记事本/留言板条目时，THE Window_Manager SHALL 打开或聚焦 Notepad_Window。
5. WHEN 点击装饰性的 Start_Menu 条目（Internet Explorer、Outlook Express、Search、Help、Run、Log Off、Shut Down）时，THE Start_Menu SHALL 不执行任何打开窗口的动作。

### Requirement 14: 移动端布局降级（≤768px）

**User Story:** 作为移动端访客，我希望有简化的布局，以便内容在小屏幕上可用。

#### Acceptance Criteria

1. WHILE Mobile_Layout 处于激活状态，THE Desktop SHALL 隐藏 Taskbar、Start_Menu 和壁纸。
2. WHILE Mobile_Layout 处于激活状态，THE Main_Window SHALL 铺满屏幕，不具备拖动能力，且不带圆角等装饰性窗口框架。
3. WHILE Mobile_Layout 处于激活状态，THE Chat_Window SHALL 呈现为覆盖屏幕大部分区域的大型居中对话框，带有标题栏和关闭控件。
4. WHEN 在 Mobile_Layout 处于激活状态时触发某个 PDF 条目，THE Site SHALL 在新的浏览器标签页中打开映射的 PDF 文档，而非使用 iframe Window。
5. WHILE Mobile_Layout 处于激活状态，THE Notepad_Window SHALL 呈现为覆盖屏幕大部分区域的大型居中对话框，带有标题栏和关闭控件（与 Chat_Window 的移动端表现一致），且不具备拖动与尺寸调整能力。
6. WHILE Mobile_Layout 处于激活状态，THE Decorative_Windows SHALL 不可用（其入口随 Taskbar/Start_Menu/桌面图标一同隐藏）。
7. WHILE Mobile_Layout 处于激活状态，THE Desktop SHALL 保持语言切换在右上角可见。
8. WHILE Mobile_Layout 处于激活状态，THE Desktop SHALL 保持 Toast 在底部中央可见。

### Requirement 15: 国际化保留

**User Story:** 作为访客，我希望在中文和英文之间切换并记住我的选择，以便整个桌面以我偏好的语言呈现。

#### Acceptance Criteria

1. WHEN 点击语言切换时，THE Site SHALL 在中文和英文之间切换 Active_Language，并更新所有通过 `data-i18n`、`data-i18n-zh`、`data-i18n-en` 和 `data-i18n-ph` 属性绑定的元素。
2. WHEN Active_Language 改变时，THE Site SHALL 将所选语言持久化到 `localStorage`。
3. WHEN 桌面加载时，THE Site SHALL 应用此前持久化于 `localStorage` 的 Active_Language，并在没有存储有效值时默认为中文。
4. THE Site SHALL 从 Content_Source 获取所有界面文本和产品数据。
5. WHERE 某个 Window 引入新的界面文本，THE Site SHALL 通过现有 i18n 机制以中文和英文两种语言提供该文本。

### Requirement 16: 无障碍与视觉一致性

**User Story:** 作为对动效敏感的访客，我希望减少动画并保持一致的 XP 外观，以便体验舒适且连贯。

#### Acceptance Criteria

1. WHERE 请求了 Reduced_Motion，THE Site SHALL 抑制或最小化非必要的窗口与界面动画。
2. THE Windows、Taskbar、Start_Menu、Toast 和语言切换 SHALL 符合 XP Luna 视觉风格。
3. THE Window_Manager 和所有 Windows SHALL 在功能上表现为本要求所述的可观察行为，其实现所用的框架与库由实现者自行选择。
4. WHEN 某个 Window 处于聚焦状态且访客按下 Esc 键时，THE Window_Manager SHALL 关闭该可关闭的 Window（或在不可关闭时不作处理）。
5. WHILE 某个 Window 处于聚焦状态，THE Site SHALL 允许通过 Tab 键在该 Window 内的可交互元素之间循环移动焦点。
6. THE Desktop_Icon、Start_Menu 条目与窗口控制按钮 SHALL 可通过键盘聚焦并触发（例如 Enter/Space）。

### Requirement 17: 安全与数据约束

**User Story:** 作为维护者，我希望该功能在安全与数据来源方面保持稳健，且仍是一个易于部署的 Web 构建，以便凭证不外泄、内容易于维护、部署保持简单。

#### Acceptance Criteria

1. THE Site SHALL 将 AI/FastGPT 凭证限定在服务端，且 SHALL NOT 在前端打包产物中暴露这些凭证。
2. THE Site SHALL 通过服务端代理路由 AI 聊天请求，且具体的代理路径属于实现细节。
3. THE Site SHALL 以单一数据来源（Content_Source）驱动所有文本与产品数据，其具体文件与格式属于实现细节。
4. THE Site SHALL 保持为可部署的 Web 构建，其托管与部署流程保持简单。
5. THE Site SHALL 在渲染访客留言等用户生成内容时对其进行转义/无害化处理，以防止跨站脚本（XSS）注入，且 THE Site SHALL 将留言内容视为不可信输入。

### Requirement 18: 可扩展的窗口/应用体系

**User Story:** 作为维护者，我希望该虚拟 Windows 桌面具备可扩展性，以便未来能够新增窗口/应用/页面，而无需改动核心窗口管理逻辑。

#### Acceptance Criteria

1. THE Window_Manager SHALL 提供统一的方式来通过 App_Definition 注册/定义一个新的窗口类型（其标识符、标题、图标、内容、单实例或多实例行为，以及启动入口——Start_Menu 和/或 Main_Window），且无需修改核心窗口管理逻辑。
2. WHEN 注册一个新的窗口类型时，THE Window_Manager SHALL 自动赋予其与其他窗口一致的窗口行为（拖动、聚焦、通过 Task_Button 最小化/还原、关闭、打开或聚焦语义、错落摆放）。
3. THE Site SHALL 以数据驱动的方式声明新窗口类型的 Start_Menu 和/或启动入口条目，且新窗口 SHALL 通过与现有窗口相同的 i18n 机制参与中英文双语。
4. THE Window_Manager SHALL 支持现有四类（Main_Window、Chat_Window、PDF_Window、Decorative_Window）之外的新窗口内容类型，例如任意嵌入页面或组件。
5. THE 三种启动入口（Desktop_Icon、Start_Menu 条目、Main_Window 内的操作）SHALL 通过同一套 App_Definition 注册表解析目标 Window，并一致地遵循打开或聚焦语义（Requirement 7）。

### Requirement 19: 窗口尺寸调整

**User Story:** 作为访客，我希望除主窗口之外的窗口能像真实的 Windows 系统那样调整大小，以便我灵活安排桌面布局。

#### Acceptance Criteria

1. WHILE 非 Mobile_Layout，WHEN 指针在某个可调整大小 Window 的边缘或角落按下并拖动时，THE Window_Manager SHALL 调整该 Window 的尺寸以跟随指针移动。
2. THE Window_Manager SHALL 允许从 Window 的边缘与角落进行尺寸调整（即真实系统式的边缘拖拽改变宽度与高度）。
3. WHEN 某个 Window 的尺寸改变时，THE Window SHALL 重新排布其内部内容以适应新的尺寸。
4. THE Window_Manager SHALL 为可调整大小的 Window 施加最小尺寸约束，以保证标题栏与控制按钮仍可用。
5. THE Window_Manager SHALL 使所有非 Main_Window 的 Window（Chat_Window、PDF_Windows、Decorative_Windows 及未来的窗口类型）均可调整大小。
6. THE Main_Window SHALL 为固定尺寸（不可调整大小），与真实的"系统属性"对话框一致。
7. WHERE Mobile_Layout 处于激活状态，THE Window_Manager SHALL 禁用边缘尺寸调整。
8. WHILE 某个 Window 正在被调整大小，THE Window_Manager SHALL 保持该 Window 为已聚焦且最上层的 Window。

### Requirement 20: 记事本公共留言板

**User Story:** 作为访客，我希望在一个 XP 记事本风格的窗口中查看并留下公共留言，以便我能看到其他访客的留言并留下自己的想法。

#### Acceptance Criteria

1. THE Site SHALL 提供一个 Notepad_Window（记事本应用），其外观采用 XP 记事本风格，作为公共留言板。
2. THE Notepad_Window SHALL 作为由 Window_Manager 管理的可拖动、可聚焦、可关闭、可调整大小的 Window（遵循 Requirement 19 的尺寸调整规则；它不是固定尺寸的 Main_Window）。
3. WHEN 访客在 Notepad_Window 中提交一条留言时，THE Site SHALL 持久化保存该留言，并使其对其他访客可见（即留言是公共/共享的，跨访客与跨会话保留）。
4. WHEN Notepad_Window 被打开时，THE Notepad_Window SHALL 加载并显示此前由所有访客保存的留言。
5. THE Notepad_Window SHALL 在常规使用下允许访客编辑或删除其本人创建的留言（基于 Visitor_Id 的尽力而为判断）。
6. THE Notepad_Window SHALL 在常规使用下阻止访客修改或删除其他访客创建的留言（基于 Visitor_Id 的尽力而为判断，并非安全边界）。
7. THE Notepad_Window SHALL 采用最简单的归属判断实现（不引入复杂的用户登录/身份校验），即为每位访客在其浏览器中生成并保存一个 Visitor_Id（匿名标识符），仅以该 Visitor_Id 进行尽力而为的留言归属判断。
8. IF 留言的保存或加载失败，THEN THE Notepad_Window SHALL 显示一条友好的错误/状态提示。
9. THE Notepad_Window SHALL 通过与其他窗口相同的 i18n 机制参与中英文双语界面文本。
10. THE Site SHALL 在服务端对每条留言施加最大长度限制。
11. THE Site SHALL 对留言提交施加基础限流（防止刷屏/滥用）。
12. THE Notepad_Window SHALL 允许访客为留言填写一个可选的昵称；WHERE 未提供昵称，THE Notepad_Window SHALL 以一个默认的匿名名称显示该留言作者。
13. THE Notepad_Window SHALL 为每条留言显示一个时间戳。
14. THE Notepad_Window SHALL 对单条留言长度向访客提示并强制一个上限（与服务端的最大长度限制一致）。
15. THE Notepad_Window SHALL 对留言列表进行分页或限制可见条数，以避免无限增长影响性能。
16. WHERE 当前没有任何留言，THE Notepad_Window SHALL 显示一条空状态提示文案。
17. THE Notepad_Window SHALL 满足留言跨访客共享并持久保留的约束，而具体的持久化/存储技术与任何服务端接口属于实现细节，留待设计阶段决定（与 Requirement 17 一致）。

**Note:** 由于 Visitor_Id 是保存在客户端的匿名标识符，留言归属可被访客通过清除本地存储或自行构造请求等方式绕过，因此第 5–7 条所述的归属控制仅为常规使用下的尽力而为行为，并非安全边界；真正的强校验需要服务端身份认证，超出当前"最简单实现"的范围。

### Requirement 21: 桌面图标

**User Story:** 作为访客，我希望在桌面壁纸上看到一组程序图标，以便像真实的 Windows 桌面那样直接启动程序。

#### Acceptance Criteria

1. THE Desktop SHALL 在桌面（壁纸区域）显示一组程序图标，至少包含：培文的名片（Main_Window）、三个 PDF_Windows（Overseas LLM Relay、FastGPT Commercial、Microsoft 365）、AI 对话（Chat_Window）以及 Notepad_Window（记事本留言板）。
2. WHEN 访客激活（点击或双击）某个桌面图标时，THE Window_Manager SHALL 打开或聚焦该图标对应的 Window（遵循 Requirement 7 的打开或聚焦语义）。
3. THE Desktop_Icon SHALL 显示其对应程序的名称与图标，并通过现有 i18n 机制提供中英文名称。
4. WHERE Mobile_Layout 处于激活状态，THE Desktop SHALL 隐藏桌面图标（与隐藏 Taskbar、Start_Menu、壁纸 的移动端降级一致）。
5. THE Desktop SHALL 以数据驱动方式声明桌面图标集合（与 Requirement 18 的 App_Definition 可扩展机制一致），以便未来新增窗口也能声明其桌面图标。

### Requirement 22: 窗口最大化与还原

**User Story:** 作为访客，我希望将可调整大小的窗口最大化以填充桌面工作区，并随后还原到原始位置与尺寸，以便像真实的 XP 系统那样专注于单个窗口或恢复原有布局。

#### Acceptance Criteria

1. WHERE 非 Mobile_Layout，THE 可调整大小的 Window SHALL 在标题栏提供最大化/还原控制按钮。
2. WHEN 点击某个可调整大小 Window 的最大化控制按钮 OR 双击其标题栏时，THE Window_Manager SHALL 将该 Window 最大化以填充可见桌面工作区（位于 Taskbar 之上、不遮挡 Taskbar）。
3. WHEN 对一个已最大化的 Window 点击还原控制按钮 OR 双击其标题栏时，THE Window_Manager SHALL 将该 Window 还原到其最大化之前的位置与尺寸。
4. WHILE 某个 Window 处于最大化状态，THE Window_Manager SHALL 禁用对该 Window 的标题栏拖动与边缘尺寸调整。
5. THE Main_Window SHALL NOT 提供最大化控制（与固定尺寸、真实"系统属性"对话框一致）。
6. WHERE Mobile_Layout 处于激活状态，THE Window_Manager SHALL 禁用最大化控制。

### Requirement 23: 像素草原壁纸增强

**User Story:** 作为访客，我希望桌面壁纸呈现出类似 Windows XP Bliss 照片的弧线草原效果（带有多层起伏山丘），而非一条平直的水平线，以获得更生动、更逼真的视觉体验。

#### Acceptance Criteria

1. THE PixelBliss 组件 SHALL 渲染多层弧线山丘（至少 4 层不同深度的起伏山丘），形成类似 XP Bliss 照片的纵深草原效果，而非平直水平线。
2. THE 草原 SHALL 在 Canvas 上一体渲染（使用 ImageData 或等效方式），保持像素风格（8px 块大小），风格与天空/云层统一。
3. THE 草原 SHALL 包含近景较深/饱和的绿色与远景较浅/偏蓝的绿色渐变，模拟大气透视。
4. THE 草原山丘轮廓 SHALL 使用多频正弦叠加产生有机的起伏曲线（非单一线条）。
5. THE 壁纸 SHALL 保留现有的天空渐变与云层渲染，仅替换草地部分。
6. WHERE Mobile_Layout 处于激活状态，THE PixelBliss SHALL 保持隐藏（与现有行为一致）。

### Requirement 24: 像素骑车人

**User Story:** 作为访客，我希望在草原壁纸上看到一个小巧的像素风格骑自行车人物，为画面增添生活气息和趣味性。

#### Acceptance Criteria

1. THE PixelBliss 组件 SHALL 在草原区域（山丘轮廓上方）绘制一个像素风格的骑自行车人物。
2. THE 骑车人 SHALL 尽可能小（约占画面高度的 3–5%），以保持画面比例协调（人小、草原大）。
3. THE 骑车人 SHALL 位于草原中景位置（距地平线约 20–40% 处），与山丘弧线自然融合。
4. THE 骑车人 SHALL 与草原使用同一 Canvas 一体渲染，保持像素风格统一。
5. THE 骑车人 SHALL 使用简洁的像素轮廓（约 4–8 像素宽的 Canvas 像素块），可辨识为自行车 + 骑手剪影。

### Requirement 25: 语言切换按钮重定位

**User Story:** 作为访客，我希望语言切换按钮位于任务栏系统托盘区（时钟旁），以便在不遮挡窗口控件的前提下仍然容易发现和使用。

#### Acceptance Criteria

1. THE 语言切换按钮 SHALL 从当前的 fixed 右上角位置移动到 Taskbar 的系统托盘区域（时钟左侧）。
2. THE 语言切换按钮 SHALL 保持 XP Luna 按钮风格（与其他系统托盘元素视觉一致）。
3. THE 语言切换按钮 SHALL 不再遮挡任何窗口的最大化/最小化/关闭控件。
4. WHERE Mobile_Layout 处于激活状态，THE 语言切换按钮 SHALL 保持可见且可用（与现有移动端行为一致）。
5. THE 语言切换按钮 SHALL 保留现有的中英文切换功能和 i18n 文案（`EN` / `中`）。

### Requirement 26: 管理员密钥输入 XP 对话框

**User Story:** 作为留言板管理员，我希望输入管理员密钥时使用一个 XP 风格的虚拟对话框（而非浏览器原生 prompt），以获得与整个虚拟桌面一致的交互体验。

#### Acceptance Criteria

1. WHEN 管理员点击记事本「管理」按钮时，THE Site SHALL 打开一个 XP 风格的模态对话框（而非浏览器 `prompt()`），包含：图标、标题（"管理员验证"）、密钥输入框（密码类型）、确定按钮和取消按钮。
2. THE 管理员对话框 SHALL 作为 WindowManager 管理的独立小窗口（或模态覆盖层），采用与 XP "运行"对话框类似的视觉风格。
3. WHEN 管理员点击确定时，THE Site SHALL 验证密钥并进入管理员模式（与现有行为一致）。
4. WHEN 管理员点击取消 OR 按 Esc 键时，THE Site SHALL 关闭对话框且不进入管理员模式。
5. THE 管理员对话框 SHALL 支持中英文双语（与现有 i18n 机制一致）。

### Requirement 27: 开始菜单功能项

**User Story:** 作为访客，我希望开始菜单中的装饰性条目（Internet Explorer、Outlook Express、Search、Help and Support、Run、Log Off、Shut Down）具有实际功能或有趣的交互效果，而不仅仅是静态展示。

#### Acceptance Criteria

1. WHEN 访客点击 **Internet Explorer** 时，THE Site SHALL 在浏览器新标签页中打开一个默认网址（如用户的个人网站或空白页）。
2. WHEN 访客点击 **Outlook Express** 时，THE Site SHALL 通过 `mailto:` 协议启动用户系统的默认邮件客户端，并预填收件人地址（取自 content.json 的联系方式邮箱）。
3. WHEN 访客点击 **Search** 时，THE Site SHALL 弹出一个 XP 风格的搜索对话框（小窗口 + 输入框），输入关键词后在浏览器新标签页中以 Google 搜索打开。
4. WHEN 访客点击 **Help and Support** 时，THE Site SHALL 打开一个新的 XP 风格窗口（非 Main_Window），窗口内展示系统技术支持信息——即站点所有者的联系方式（电话、微信、邮箱、公众号），因为站点所有者本人就是该系统的技术支持人员。
5. WHEN 访客点击 **Run...** 时，THE Site SHALL 弹出一个 XP 风格的「运行」对话框（小窗口 + 输入框 + 浏览按钮），输入 URL 后在浏览器新标签页中打开该网址。
6. WHEN 访客点击 **Log Off** 时，THE Site SHALL 弹出一个 XP 风格的确认对话框（"确定要注销吗？"），带 Log Off / Cancel 按钮。点击 Log Off 后执行彩蛋效果（如重置桌面状态或显示欢迎屏幕）。
7. WHEN 访客点击 **Shut Down** 时，THE Site SHALL 弹出一个 XP 风格的关机确认对话框。确认后播放像素风格的关机动画（黑屏渐入 + "现在可以安全关闭"文案），点击任意位置或按键恢复桌面。
8. THE 所有开始菜单功能项 SHALL 支持中英文双语。
9. WHERE Mobile_Layout 处于激活状态，THE Site SHALL 隐藏这些开始菜单功能项（与隐藏 Taskbar/Start_Menu 一致）。
