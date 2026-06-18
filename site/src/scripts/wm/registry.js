// ════════════════════════════════════════════════════════════
// App_Definition 注册表 —— 窗口管理器的单一事实来源。
//
// 桌面图标、开始菜单条目、主窗口内操作三套启动入口共用本注册表解析目标窗口
// （Req 18.5），并一致遵循"打开或聚焦"语义（Req 7）。
//
// 文案（标题）与 PDF 路径均派生自 content.json（唯一内容源，Req 17.3）：
//   - titleKey 为 i18n 扁平 key，经 strings.js / data-i18n 机制解析双语（Req 18.3/15.5）
//   - pdfUrl 取自 content.products[].pdf（与 PDF 窗口顺序一致）
//
// 本文件只声明窗口"类型"（App_Definition），运行时实例由 WindowManager 创建。
// 新增窗口类型只需在此追加一项，无需改动核心窗口管理逻辑（Req 18.1/18.2/18.4）。
// ════════════════════════════════════════════════════════════
import content from "../../config/content.json";

/**
 * @typedef {Object} AppContent
 * @property {"main-card"|"chat"|"pdf-iframe"|"decorative"|"notepad"|string} kind 内容类型（可扩展，Req 18.4）
 * @property {string} [pdfUrl] kind="pdf-iframe" 时嵌入的 PDF 路径
 * @property {"mycomputer"|"mydocuments"|"controlpanel"} [decoType] kind="decorative" 时的装饰类型
 * @property {string} [rendererKey] 预留：未来自定义渲染器
 */

/**
 * @typedef {Object} AppLaunch
 * @property {boolean} [desktopIcon] 是否生成桌面图标（Req 21.5）
 * @property {"left"|"right"|null} [startMenu] 开始菜单左/右栏，null 表示不在开始菜单（Req 13）
 * @property {boolean} [mainWindowAction] 是否由主窗口内操作触发（Req 9）
 */

/**
 * @typedef {Object} AppMobile
 * @property {"fullscreen"|"dialog"|"newtab"|"unavailable"} [behavior] 移动端表现（Req 14）
 */

/**
 * @typedef {Object} AppDefinition
 * @property {string} id 唯一标识
 * @property {string} titleKey i18n 扁平 key（解析双语标题，Req 18.3/15.5）
 * @property {string} icon 图标标识（emoji/字符或 SVG key）
 * @property {boolean} singleInstance 单实例（本设计全部窗口均 true，Req 7.3）
 * @property {boolean} resizable 是否可调整尺寸（Main=false，其余=true，Req 19.5/19.6）
 * @property {boolean} maximizable 是否显示最大化按钮（Main=false，Req 22.5）
 * @property {{ w: number, h: number }} defaultSize 初始尺寸
 * @property {{ w: number, h: number }} minSize 最小尺寸（Req 19.4）
 * @property {AppContent} content 内容声明
 * @property {AppLaunch} launch 启动入口声明
 * @property {AppMobile} mobile 移动端行为
 */

// PDF 路径派生自 content.json 的 products（与 PDF 窗口顺序一致：海外中转 / FastGPT / Microsoft 365）。
const productItems = content.products?.items || [];
const pdfUrlAt = (i, fallback) => productItems[i]?.pdf || fallback;

/**
 * App_Definition 注册表：覆盖全部 9 个窗口类型。
 * 顺序：main / chat / 三个 pdf / notepad / 三个 decorative。
 * @type {AppDefinition[]}
 */
export const APP_REGISTRY = [
  {
    // 主窗口"培文的名片"——系统属性风格，固定尺寸、无最大化（Req 8/19.6/22.5）。
    id: "main",
    titleKey: "windows.mainTitle",
    icon: "👤",
    singleInstance: true,
    resizable: false,
    maximizable: false,
    defaultSize: { w: 540, h: 620 },
    minSize: { w: 540, h: 620 },
    content: { kind: "main-card" },
    launch: { desktopIcon: true, startMenu: "left", mainWindowAction: false },
    mobile: { behavior: "fullscreen" },
  },
  {
    // AI 聊天窗口——由主窗口 AI 入口触发；移动端为大号居中对话框（Req 10/14.3）。
    id: "chat",
    titleKey: "chat.title",
    icon: "💬",
    singleInstance: true,
    resizable: true,
    maximizable: true,
    defaultSize: { w: 440, h: 580 },
    minSize: { w: 320, h: 380 },
    content: { kind: "chat" },
    launch: { desktopIcon: true, startMenu: null, mainWindowAction: true },
    mobile: { behavior: "dialog" },
  },
  {
    // PDF 查看器：海外大模型中转。标题取自产品条目，移动端新标签打开（Req 11/14.4）。
    id: "pdf-overseas",
    titleKey: "windows.pdfOverseas",
    icon: "📄",
    singleInstance: true,
    resizable: true,
    maximizable: true,
    defaultSize: { w: 820, h: 620 },
    minSize: { w: 480, h: 360 },
    content: { kind: "pdf-iframe", pdfUrl: pdfUrlAt(0, "/pdf/apihub-overseas-llm-relay.pdf") },
    launch: { desktopIcon: true, startMenu: "left", mainWindowAction: true },
    mobile: { behavior: "newtab" },
  },
  {
    // PDF 查看器：FastGPT 商业版。
    id: "pdf-fastgpt",
    titleKey: "windows.pdfFastgpt",
    icon: "📄",
    singleInstance: true,
    resizable: true,
    maximizable: true,
    defaultSize: { w: 820, h: 620 },
    minSize: { w: 480, h: 360 },
    content: { kind: "pdf-iframe", pdfUrl: pdfUrlAt(1, "/pdf/fastgpt-commercial.pdf") },
    launch: { desktopIcon: true, startMenu: "left", mainWindowAction: true },
    mobile: { behavior: "newtab" },
  },
  {
    // PDF 查看器：Microsoft 365。
    id: "pdf-m365",
    titleKey: "windows.pdfM365",
    icon: "📄",
    singleInstance: true,
    resizable: true,
    maximizable: true,
    defaultSize: { w: 820, h: 620 },
    minSize: { w: 480, h: 360 },
    content: { kind: "pdf-iframe", pdfUrl: pdfUrlAt(2, "/pdf/microsoft365-copilot.pdf") },
    launch: { desktopIcon: true, startMenu: "left", mainWindowAction: true },
    mobile: { behavior: "newtab" },
  },
  {
    // 留言板（记事本）——公共留言板，可调整尺寸；移动端为大号居中对话框（Req 20/14.5）。
    id: "notepad",
    titleKey: "windows.notepadTitle",
    icon: "📝",
    singleInstance: true,
    resizable: true,
    maximizable: true,
    defaultSize: { w: 560, h: 540 },
    minSize: { w: 360, h: 320 },
    content: { kind: "notepad" },
    launch: { desktopIcon: true, startMenu: "left", mainWindowAction: false },
    mobile: { behavior: "dialog" },
  },
  {
    // 装饰窗口：我的电脑——纯像素模拟界面，无功能；开始菜单右栏；移动端不可用（Req 12.2/14.6）。
    id: "deco-mycomputer",
    titleKey: "windows.myComputer",
    icon: "🖥️",
    singleInstance: true,
    resizable: true,
    maximizable: true,
    defaultSize: { w: 560, h: 440 },
    minSize: { w: 360, h: 300 },
    content: { kind: "decorative", decoType: "mycomputer" },
    launch: { desktopIcon: false, startMenu: "right", mainWindowAction: false },
    mobile: { behavior: "unavailable" },
  },
  {
    // 装饰窗口：我的文档——三个 PDF 的快捷入口（Req 12.3/12.4）。
    id: "deco-mydocuments",
    titleKey: "windows.myDocuments",
    icon: "📁",
    singleInstance: true,
    resizable: true,
    maximizable: true,
    defaultSize: { w: 520, h: 420 },
    minSize: { w: 360, h: 300 },
    content: { kind: "decorative", decoType: "mydocuments" },
    launch: { desktopIcon: false, startMenu: "right", mainWindowAction: false },
    mobile: { behavior: "unavailable" },
  },
  {
    // 装饰窗口：控制面板——语言切换 + 减弱动效偏好（Req 12.5）。
    id: "deco-controlpanel",
    titleKey: "windows.controlPanel",
    icon: "⚙️",
    singleInstance: true,
    resizable: true,
    maximizable: true,
    defaultSize: { w: 480, h: 420 },
    minSize: { w: 360, h: 300 },
    content: { kind: "decorative", decoType: "controlpanel" },
    launch: { desktopIcon: false, startMenu: "right", mainWindowAction: false },
    mobile: { behavior: "unavailable" },
  },
  {
    // Help and Support——联系方式窗口（Req 27.4），由开始菜单 Help 条目触发。
    id: "help",
    titleKey: "windows.helpTitle",
    icon: "❓",
    singleInstance: true,
    resizable: true,
    maximizable: true,
    defaultSize: { w: 420, h: 380 },
    minSize: { w: 320, h: 280 },
    content: { kind: "decorative", decoType: "help" },
    launch: { desktopIcon: false, startMenu: null, mainWindowAction: false },
    mobile: { behavior: "unavailable" },
  },
];

// id → AppDefinition 索引，便于按 id 快速解析（三套启动入口共用，Req 18.5）。
const REGISTRY_BY_ID = new Map(APP_REGISTRY.map((app) => [app.id, app]));

/**
 * 按 id 取 App_Definition。
 * @param {string} id
 * @returns {AppDefinition | undefined}
 */
export function getAppDefinition(id) {
  return REGISTRY_BY_ID.get(id);
}

/**
 * 桌面图标应用列表 —— 按 content.json 的 desktop.icons 顺序解析（Req 21.1/21.5）。
 * 仅保留 launch.desktopIcon 为真且存在于注册表中的应用。
 * @type {AppDefinition[]}
 */
export const DESKTOP_ICON_APPS = (content.desktop?.icons || [])
  .map((id) => REGISTRY_BY_ID.get(id))
  .filter((app) => app && app.launch?.desktopIcon);

/**
 * 开始菜单应用列表，按左/右栏分组（Req 13）。
 * 左栏：程序条目；右栏：系统位置（装饰窗口）。
 */
export const START_MENU_APPS = {
  left: APP_REGISTRY.filter((app) => app.launch?.startMenu === "left"),
  right: APP_REGISTRY.filter((app) => app.launch?.startMenu === "right"),
};

export default APP_REGISTRY;
