// ════════════════════════════════════════════════════════════
// pdf-iframe 内容渲染器（任务 15.1，Req 11）。
//
// 三个 PDF 查看器窗口（pdf-overseas / pdf-fastgpt / pdf-m365）共用本渲染器：
// 将映射的 PDF 文档（appDef.content.pdfUrl）嵌入 <iframe>，填满窗口正文
// （.xp-win-body）。文档名称由窗口框架的标题栏负责显示（Req 11.3，标题经
// i18n titleKey 解析双语，无需在此重复渲染）；此处仅为 iframe 设置可访问的
// title 属性，使其语义与窗口标题一致。
//
// 移动端不走此渲染器——PDF 条目在移动端以新标签打开（Req 14.4）。
//
// 渲染器接口见 ./index.js：render(bodyEl, appDef, ctx) -> hooks|void。
// 本模块在加载时经 registerRenderer("pdf-iframe", render) 自注册（Req 18.4），
// 无需改动 WindowManager 或分发框架。
// ════════════════════════════════════════════════════════════
import { registerRenderer } from "./index.js";

/**
 * 解析窗口（即 PDF 文档）的可访问名称：
 * 优先经 i18n.S(titleKey)（与标题栏一致，Req 11.3/18.3），解析不到时回退到
 * titleKey 本身，保证 title 属性非空。
 *
 * @param {Object} appDef           该窗口的 App_Definition
 * @param {Object|null} [i18n]      运行时 i18n：{ S, getCurrentLang, onLangChange }
 * @returns {string}
 */
function resolveDocName(appDef, i18n) {
  const key = (appDef && appDef.titleKey) || "";
  if (i18n && typeof i18n.S === "function") {
    const v = i18n.S(key);
    if (v != null && v !== "") return v;
  }
  return key;
}

/**
 * pdf-iframe 渲染器：向窗口正文注入填满容器的 <iframe>，嵌入映射的 PDF（Req 11.2）。
 *
 * @param {HTMLElement} bodyEl   窗口内容容器（.xp-win-body）
 * @param {Object} appDef       该窗口的 App_Definition（含 content.pdfUrl）
 * @param {Object} ctx          运行时协作上下文 { wm, i18n, isMobile, opts }
 * @returns {void}
 */
export function render(bodyEl, appDef, ctx) {
  if (!bodyEl || !appDef) return;

  const content = appDef.content || {};
  const pdfUrl = content.pdfUrl || "";
  const i18n = (ctx && ctx.i18n) || null;
  const docName = resolveDocName(appDef, i18n);

  // 正文容器自身铺满，便于 iframe 通过 flex/100% 填满窗口（Req 11.2）。
  bodyEl.classList.add("xp-pdf-body");

  const doc = bodyEl.ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!doc) return;

  const iframe = doc.createElement("iframe");
  iframe.className = "xp-pdf-frame";
  iframe.src = pdfUrl;
  // 不使用 sandbox：Chrome/Edge 的内置 PDF 查看器在 sandboxed iframe 中被阻止
  // （显示 "This page has been blocked by Chrome"）。
  // PDF 来源为本站静态文件（/pdf/*.pdf），同源可信，无需沙箱隔离。
  // 文档名作为 iframe 的可访问名称，与标题栏显示一致（Req 11.3）。
  iframe.setAttribute("title", docName);
  iframe.setAttribute("loading", "lazy");
  // 填满窗口正文。
  iframe.style.display = "block";
  iframe.style.flex = "1 1 auto";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "0";

  bodyEl.appendChild(iframe);
}

// 加载即自注册（Req 18.4）。
registerRenderer("pdf-iframe", render);

export default render;
