// ════════════════════════════════════════════════════════════
// 内容渲染器分发框架（任务 12.1，Req 18.4）。
//
// WindowManager「不内嵌任何具体应用知识」：窗口正文（.xp-win-body）由按
// content.kind 分发的「内容渲染器」注入。本模块提供渲染器的注册表与分发逻辑，
// 使新的内容类型（kind）可在「不修改窗口管理核心逻辑」的前提下扩展（Req 18.4）。
//
// 渲染器接口（纯函数式）：
//
//   render(bodyEl, appDef, ctx) -> { onFocus?, onResize?, onClose? } | void
//
//   - bodyEl  : 该窗口的内容容器（.xp-win-body），渲染器向其注入正文 DOM
//   - appDef  : 该窗口的 App_Definition（含 content 参数，如 pdfUrl/decoType）
//   - ctx     : 运行时协作上下文 { wm, i18n, isMobile, opts }
//       · wm        WindowManager 实例（用于 openOrFocus 接线等）
//       · i18n      复用 scripts/i18n.js：{ S, getCurrentLang, onLangChange }
//       · isMobile  () => boolean，视口 ≤768px 判定
//       · opts      openOrFocus 透传的调用参数（如引导语等）
//
//   返回值为可选的「生命周期钩子」对象，WindowManager 在对应时点调用：
//       · onFocus()   该窗口成为聚焦窗口时
//       · onResize()  该窗口尺寸改变时（边缘调整 / 最大化-还原）
//       · onClose()   该窗口关闭前（用于清理订阅/计时器等）
//   渲染器无需任何钩子时可不返回（void）。
//
// 安全约定：当某 kind 没有对应渲染器时，分发「不抛出」，正文保持原样并返回空
// 钩子集合（Req 18.4 的可扩展性不应因未注册而破坏窗口生命周期）。具体的
// main-card / chat / pdf-iframe / decorative / notepad 渲染器由各自任务实现并
// 在加载时经 registerRenderer 注册，无需改动本框架或 WindowManager。
// ════════════════════════════════════════════════════════════

/**
 * @typedef {Object} RendererHooks
 * @property {() => void} [onFocus]  窗口成为聚焦窗口时调用
 * @property {() => void} [onResize] 窗口尺寸改变时调用（调整尺寸 / 最大化-还原）
 * @property {() => void} [onClose]  窗口关闭前调用（清理）
 */

/**
 * @typedef {Object} RenderContext
 * @property {Object} wm                       WindowManager 实例
 * @property {Object|null} i18n                { S, getCurrentLang, onLangChange }
 * @property {() => boolean} isMobile          视口 ≤768px 判定
 * @property {Object} opts                     openOrFocus 透传参数
 */

/**
 * 内容渲染器函数签名。
 * @callback ContentRenderer
 * @param {HTMLElement} bodyEl      窗口内容容器（.xp-win-body）
 * @param {Object} appDef          该窗口的 App_Definition
 * @param {RenderContext} ctx      运行时协作上下文
 * @returns {RendererHooks|void}
 */

/**
 * kind → 渲染器映射（模块级单例注册表）。
 * @type {Map<string, ContentRenderer>}
 */
const rendererRegistry = new Map();

/**
 * 注册一个内容渲染器（Req 18.4：新增 kind 无需改动核心逻辑）。
 * 重复 kind 覆盖既有渲染器（便于按需替换/扩展）。
 *
 * @param {string} kind        内容类型标识（对应 App_Definition.content.kind）
 * @param {ContentRenderer} fn 渲染器函数
 * @returns {void}
 */
export function registerRenderer(kind, fn) {
  if (typeof kind !== "string" || kind === "") {
    throw new Error("registerRenderer: kind must be a non-empty string");
  }
  if (typeof fn !== "function") {
    throw new Error(`registerRenderer: renderer for "${kind}" must be a function`);
  }
  rendererRegistry.set(kind, fn);
}

/**
 * 取某 kind 的已注册渲染器（未注册返回 undefined，不抛出）。
 * @param {string} kind
 * @returns {ContentRenderer | undefined}
 */
export function getRenderer(kind) {
  return rendererRegistry.get(kind);
}

/**
 * 是否已为某 kind 注册渲染器。
 * @param {string} kind
 * @returns {boolean}
 */
export function hasRenderer(kind) {
  return rendererRegistry.has(kind);
}

/**
 * 注销某 kind 的渲染器（主要用于测试隔离）。
 * @param {string} kind
 * @returns {boolean} 是否存在并被移除
 */
export function unregisterRenderer(kind) {
  return rendererRegistry.delete(kind);
}

/**
 * 清空全部已注册渲染器（主要用于测试隔离）。
 * @returns {void}
 */
export function clearRenderers() {
  rendererRegistry.clear();
}

/**
 * 将渲染器返回值规范化为「钩子对象」：仅保留为函数的 onFocus/onResize/onClose，
 * 缺省以空集合返回。保证 WindowManager 调用钩子时形状稳定且不抛。
 * @param {RendererHooks|void} hooks
 * @returns {RendererHooks}
 */
function normalizeHooks(hooks) {
  /** @type {RendererHooks} */
  const out = {};
  if (hooks && typeof hooks === "object") {
    if (typeof hooks.onFocus === "function") out.onFocus = hooks.onFocus;
    if (typeof hooks.onResize === "function") out.onResize = hooks.onResize;
    if (typeof hooks.onClose === "function") out.onClose = hooks.onClose;
  }
  return out;
}

/**
 * 分发并执行内容渲染：依据 App_Definition.content.kind 查找渲染器并调用，
 * 返回规范化的生命周期钩子供 WindowManager 在对应时点调用。
 *
 * 安全约定（Req 18.4）：
 *   - 无 bodyEl / 无 appDef → 返回空钩子，不抛
 *   - kind 未注册渲染器 → 正文保持原样，返回空钩子，不抛（可扩展但未注册时
 *     不破坏窗口生命周期）
 *
 * @param {HTMLElement} bodyEl    窗口内容容器（.xp-win-body）
 * @param {Object} appDef        该窗口的 App_Definition
 * @param {RenderContext} ctx    运行时协作上下文 { wm, i18n, isMobile, opts }
 * @returns {RendererHooks}      规范化钩子（始终为对象）
 */
export function renderContent(bodyEl, appDef, ctx) {
  if (!bodyEl || !appDef) return {};
  const kind = appDef.content && appDef.content.kind;
  if (!kind) return {};

  const renderer = rendererRegistry.get(kind);
  if (typeof renderer !== "function") {
    // 未注册渲染器：安全回退——正文保持原样，不抛（Req 18.4）。
    return {};
  }

  const hooks = renderer(bodyEl, appDef, ctx);
  return normalizeHooks(hooks);
}

export default {
  registerRenderer,
  getRenderer,
  hasRenderer,
  unregisterRenderer,
  clearRenderers,
  renderContent,
};
