// ════════════════════════════════════════════════════════════
// 渲染器公共工具（h / resolveLang / ensureStyles / SVG 常量）。
//
// 抽取各渲染器（chat / decorative / notepad / main-card）中重复的工具函数，
// 统一 API 并消除 DRY 违反。各渲染器按需导入。
// ════════════════════════════════════════════════════════════

import {
  S as i18nS,
  getCurrentLang as i18nLang,
} from "../../i18n.js";

// ── SVG path 常量（发送按钮图标，可信内容非用户输入）──
export const SVG_SEND_PATHS =
  '<path d="M22 2L11 13"></path><path d="M22 2l-7 20-4-9-9-4 20-7z"></path>';

/**
 * 创建 DOM 元素并设置属性/子节点（统一 h 函数）。
 *
 * 支持的 attrs 特殊键：
 *   · "class" → className
 *   · "text"  → textContent
 *   · "html"  → innerHTML
 *   · 其余    → setAttribute(k, v)
 *
 * @param {Document} doc
 * @param {string} tag
 * @param {Object} [attrs={}]
 * @param {Array<Node|string|null>} [children=[]]
 * @returns {HTMLElement}
 */
export function h(doc, tag, attrs = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? doc.createTextNode(c) : c);
  }
  return node;
}

/**
 * 取当前语言（"zh" | "en"）：优先 ctx.i18n.getCurrentLang，回退到 i18n 模块单例。
 * @param {Object} ctx  运行时上下文
 * @returns {"zh"|"en"}
 */
export function resolveLang(ctx) {
  const g = ctx && ctx.i18n && ctx.i18n.getCurrentLang;
  const lang = typeof g === "function" ? g() : i18nLang();
  return lang === "en" ? "en" : "zh";
}

/**
 * 首次渲染时向 <head> 注入一次性 <style>（按 styleId 去重）。
 * @param {Document} doc
 * @param {string} styleId  唯一 style 元素 id
 * @param {string} cssText  CSS 内容
 */
export function ensureStyles(doc, styleId, cssText) {
  if (!doc || !doc.head || doc.getElementById(styleId)) return;
  const style = doc.createElement("style");
  style.id = styleId;
  style.textContent = cssText;
  doc.head.appendChild(style);
}
