// ════════════════════════════════════════════════════════════
// decorative 内容渲染器（任务 16.1 / 16.2 / 16.3，Req 12）。
//
// 三个 Decorative_Windows 共用本渲染器，依 appDef.content.decoType 分支：
//
//   · "mycomputer"   我的电脑（Req 12.1/12.2）
//        纯 CSS/SVG 像素风格模拟界面，除窗口管理外「无任何功能行为」。
//
//   · "mydocuments"  我的文档（Req 12.1/12.3/12.4）
//        陈列三个 PDF_Windows 的快捷入口；激活某入口走
//        ctx.wm.openOrFocus("pdf-overseas"|"pdf-fastgpt"|"pdf-m365")，遵循
//        「打开或聚焦」语义（Req 7）。入口为可键盘聚焦/触发的 <button>。
//
//   · "controlpanel" 控制面板（Req 12.1/12.5）
//        轻量真实设置入口：Active_Language 切换（zh/en）+ Reduced_Motion 偏好
//        开关/提示，经 data-i18n 双语呈现，保持 XP 像素外观。语言切换复用既有
//        i18n 机制（scripts/i18n.js 的 #lang-toggle 全局切换），从而切换
//        Active_Language 并与全局开关一致地持久化到 localStorage。
//
// 渲染器签名：render(bodyEl, appDef, ctx) -> hooks|void，
//   ctx = { wm, i18n, isMobile, opts }。本模块在 import 时自注册到分发框架。
//
// 视觉样式自包含：首次渲染时向 <head> 注入一次 <style>（XP 像素观感），避免依赖
// 额外样式表引入；「减弱动效」开关复用 base.css 中的 html.force-reduced-motion
// 规则（仅作用于动效，不改变 XP Luna 颜色/边框/布局）。
// ════════════════════════════════════════════════════════════

import { registerRenderer } from "./index.js";
import content from "../../../config/content.json";
import { h, ensureStyles as _ensureStyles } from "./_utils.js";

const STYLE_ID = "wm-decorative-styles";
const LANG_TOGGLE_ID = "lang-toggle"; // 既有全局语言切换按钮（scripts/i18n.js 绑定）
const RM_STORAGE_KEY = "force-reduced-motion"; // 「减弱动效」偏好持久化键

// ── 我的文档：PDF 快捷入口 → 对应 PDF_Window 的 App_Definition id（Req 12.4）──
const PDF_ENTRIES = [
  { appId: "pdf-overseas", titleKey: "windows.pdfOverseas", fallback: "Overseas LLM Relay" },
  { appId: "pdf-fastgpt", titleKey: "windows.pdfFastgpt", fallback: "FastGPT Commercial" },
  { appId: "pdf-m365", titleKey: "windows.pdfM365", fallback: "Microsoft 365" },
];

// ── 工具 ──────────────────────────────────────────────────────

/** 取与 bodyEl 关联的 document（便于测试与多文档环境）。 */
function getDoc(bodyEl) {
  return (bodyEl && bodyEl.ownerDocument) || (typeof document !== "undefined" ? document : null);
}

/** 经 ctx.i18n 取某 key 当前语言文案，解析不到时回退 fallback。 */
function S(ctx, key, fallback) {
  if (ctx && ctx.i18n && typeof ctx.i18n.S === "function") {
    try {
      const v = ctx.i18n.S(key);
      if (v != null && v !== "") return v;
    } catch {
      /* 忽略 i18n 解析异常，使用回退 */
    }
  }
  return fallback;
}

/** 判定当前 Active_Language（"zh" | "en"）。 */
function currentLang(ctx, doc) {
  if (ctx && ctx.i18n && typeof ctx.i18n.getCurrentLang === "function") {
    try {
      const l = ctx.i18n.getCurrentLang();
      if (l === "zh" || l === "en") return l;
    } catch {
      /* 回退到 DOM / localStorage */
    }
  }
  const htmlLang = (doc && doc.documentElement && doc.documentElement.lang) || "";
  if (htmlLang.toLowerCase().startsWith("en")) return "en";
  if (htmlLang.toLowerCase().startsWith("zh")) return "zh";
  try {
    const s = localStorage.getItem("site-lang");
    if (s === "zh" || s === "en") return s;
  } catch {
    /* localStorage 不可用 */
  }
  return "zh";
}

/** 首次渲染时注入一次装饰窗口的视觉样式（XP 像素观感）。 */
function ensureStyles(doc) {
  _ensureStyles(doc, STYLE_ID, DECO_CSS);
}

/**
 * 绑定一个 i18n 扁平 key 的文本节点（data-i18n）：初始按当前语言写入正确文案，
 * 后续语言切换由全局 i18n.apply() 经 data-i18n 统一更新（元素已在 DOM 中）。
 */
function i18nText(doc, ctx, tag, key, fallback, attrs = {}) {
  return h(doc, tag, { ...attrs, "data-i18n": key, text: S(ctx, key, fallback) });
}

/**
 * 绑定一段就地双语文本（data-i18n-zh / data-i18n-en）：用于 content.json 未单列
 * key 的零散界面文字，复用既有 i18n 机制，语言切换时由全局 apply() 更新。
 */
function bilingualText(doc, ctx, tag, zh, en, attrs = {}) {
  const lang = currentLang(ctx, doc);
  return h(doc, tag, {
    ...attrs,
    "data-i18n-zh": zh,
    "data-i18n-en": en,
    text: lang === "en" ? en : zh,
  });
}

// ── 装饰窗口视觉样式（XP 像素观感，自包含一次性注入）──────────────
const DECO_CSS = `
.wm-deco { display:flex; flex-direction:column; height:100%; min-height:0;
  font-family:"Tahoma","MS Sans Serif",sans-serif; font-size:12px; color:#0a0a0a;
  background:#fff; }

/* ── 我的电脑：左任务窗格（蓝色渐变）+ 右内容区 ── */
.deco-mc { flex:1; display:flex; min-height:0; }
.deco-mc-side { width:38%; max-width:200px; padding:10px;
  background:linear-gradient(180deg,#7aa3e0 0%,#5b86d6 8%,#4a78cf 100%);
  color:#fff; overflow:auto; }
.deco-mc-side .deco-pane { background:rgba(255,255,255,.92); color:#0a3a8c;
  border:1px solid #2f5fb0; border-radius:4px; margin-bottom:10px; overflow:hidden; }
.deco-mc-side .deco-pane-hd { padding:4px 8px; font-weight:bold; color:#0a3a8c;
  background:linear-gradient(180deg,#e8f0ff,#cfe0fb); border-bottom:1px solid #9bb8e8; }
.deco-mc-side .deco-pane-bd { padding:6px 8px; }
.deco-mc-side .deco-link { display:flex; align-items:center; gap:6px; padding:3px 0;
  color:#163a86; }
.deco-mc-main { flex:1; padding:12px; overflow:auto; background:#fff; }
.deco-mc-group { font-weight:bold; color:#1c5fbf; border-bottom:1px solid #c8d4e6;
  margin:4px 0 10px; padding-bottom:3px; }
.deco-mc-grid { display:flex; flex-wrap:wrap; gap:14px 20px; margin-bottom:16px; }
.deco-item { display:flex; align-items:center; gap:8px; width:46%; min-width:150px; }
.deco-item .deco-ico { flex:0 0 auto; image-rendering:pixelated; }
.deco-item .deco-tx { display:flex; flex-direction:column; line-height:1.25; }
.deco-item .deco-tx small { color:#555; }

/* ── 我的文档：PDF 快捷入口列表 ── */
.deco-docs { flex:1; padding:14px; overflow:auto; }
.deco-docs-hd { font-weight:bold; color:#1c5fbf; border-bottom:1px solid #c8d4e6;
  margin:0 0 12px; padding-bottom:4px; }
.deco-docs-list { display:flex; flex-direction:column; gap:8px; }
.deco-doc { display:flex; align-items:center; gap:10px; width:100%; text-align:left;
  padding:8px 10px; background:#fff; border:1px solid #bcbcbc; border-radius:4px;
  cursor:pointer; font:inherit; color:inherit; }
.deco-doc:hover { background:#eaf2ff; border-color:#6f9be0; }
.deco-doc:focus-visible { outline:2px solid #0a64d6; outline-offset:1px; }
.deco-doc .deco-tx { display:flex; flex-direction:column; line-height:1.3; }
.deco-doc .deco-tx small { color:#666; }

/* ── 控制面板：分组设置 ── */
.deco-cp { flex:1; padding:16px; overflow:auto; }
.deco-cp-sec { border:1px solid #c8d4e6; border-radius:4px; margin-bottom:14px;
  background:#fbfdff; }
.deco-cp-sec h3 { margin:0; padding:6px 10px; font-size:12px; color:#0a3a8c;
  background:linear-gradient(180deg,#e8f0ff,#cfe0fb); border-bottom:1px solid #9bb8e8; }
.deco-cp-bd { padding:12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.deco-cp-bd .deco-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; width:100%; }
.deco-seg { display:inline-flex; border:1px solid #6f9be0; border-radius:4px; overflow:hidden; }
.deco-seg button { font:inherit; padding:4px 14px; border:0; cursor:pointer;
  background:#fff; color:#10366f; border-right:1px solid #b9cdf0; }
.deco-seg button:last-child { border-right:0; }
.deco-seg button[aria-pressed="true"] {
  background:linear-gradient(180deg,#4a86e8,#2f6fd6); color:#fff; font-weight:bold; }
.deco-seg button:focus-visible { outline:2px solid #0a64d6; outline-offset:-2px; }
.deco-toggle { font:inherit; padding:4px 14px; cursor:pointer; border:1px solid #6f9be0;
  border-radius:4px; background:#fff; color:#10366f; }
.deco-toggle[aria-pressed="true"] {
  background:linear-gradient(180deg,#4a86e8,#2f6fd6); color:#fff; font-weight:bold; }
.deco-toggle:focus-visible { outline:2px solid #0a64d6; outline-offset:1px; }
.deco-hint { color:#555; font-size:11px; width:100%; }
.deco-cp-bd label { color:#10366f; }
/* ── Help and Support (Req 27.4) ── */
.deco-help { padding:12px 14px; font-family:Tahoma,Verdana,sans-serif; font-size:11px; }
.deco-help-head { margin:0 0 4px; font-size:14px; color:#10366f; font-weight:700; }
.deco-help-desc { margin:0 0 12px; color:#555; line-height:1.5; }
.deco-help-list { display:flex; flex-direction:column; gap:8px; }
.deco-help-row { display:flex; align-items:center; gap:10px; padding:8px 10px;
  border:1px solid #d6d2c2; border-radius:4px; background:#f8f7f2;
  transition:background 0.10s, border-color 0.10s; }
.deco-help-row:hover { background:#e8f0fe; border-color:#0a64d6; }
.deco-help-icon { font-size:20px; width:28px; text-align:center; flex-shrink:0; }
.deco-help-info { display:flex; flex-direction:column; gap:1px; min-width:0; }
.deco-help-label { font-size:10px; color:#888; text-transform:uppercase; letter-spacing:0.3px; }
.deco-help-value { font-size:12px; color:#10366f; font-weight:600; word-break:break-all; }
`;

// ── SVG 像素图标（authored，安全静态标记）─────────────────────────
function svgDrive(doc, kind) {
  // C: 硬盘 / removable 可移动盘 / folder 文件夹 —— 简洁的 XP 像素风格 SVG。
  const drive =
    `<rect x="2" y="9" width="28" height="16" rx="2" fill="#dfe6ee" stroke="#5a6b80"/>` +
    `<rect x="2" y="9" width="28" height="6" rx="2" fill="#aeb9c7" stroke="#5a6b80"/>` +
    `<circle cx="25" cy="20" r="2.2" fill="#7d8aa0"/>` +
    `<rect x="6" y="18" width="9" height="3" fill="#9aa6b6"/>`;
  const removable =
    `<rect x="3" y="7" width="26" height="18" rx="2" fill="#eef2f7" stroke="#5a6b80"/>` +
    `<rect x="3" y="7" width="26" height="5" rx="2" fill="#7aa6e0" stroke="#3f6dB0"/>` +
    `<rect x="8" y="15" width="16" height="6" fill="#cdd6e2" stroke="#8a97a8"/>`;
  const folder =
    `<path d="M3 9 h9 l3 3 h13 a2 2 0 0 1 2 2 v9 a2 2 0 0 1 -2 2 H3 a2 2 0 0 1 -2 -2 V11 a2 2 0 0 1 2 -2 z" fill="#ffd873" stroke="#ca9a3e"/>` +
    `<path d="M2 13 h28 v11 a2 2 0 0 1 -2 2 H4 a2 2 0 0 1 -2 -2 z" fill="#ffe7a0" stroke="#ca9a3e"/>`;
  const map = { drive, removable, folder };
  const inner = map[kind] || drive;
  return h(doc, "span", {
    class: "deco-ico",
    "aria-hidden": "true",
    html: `<svg width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">${inner}</svg>`,
  });
}

// ── 16.1 我的电脑：纯装饰像素界面（无功能行为，Req 12.2）──────────
function renderMyComputer(bodyEl, ctx, doc) {
  const root = h(doc, "div", { class: "deco-mc" });

  // 左侧任务窗格（纯展示，aria-hidden）。
  const side = h(doc, "div", { class: "deco-mc-side", "aria-hidden": "true" }, [
    h(doc, "div", { class: "deco-pane" }, [
      bilingualText(doc, ctx, "div", "系统任务", "System Tasks", { class: "deco-pane-hd" }),
      h(doc, "div", { class: "deco-pane-bd" }, [
        bilingualText(doc, ctx, "div", "查看系统信息", "View system information", { class: "deco-link" }),
        bilingualText(doc, ctx, "div", "添加或删除程序", "Add or remove programs", { class: "deco-link" }),
        bilingualText(doc, ctx, "div", "更改一项设置", "Change a setting", { class: "deco-link" }),
      ]),
    ]),
    h(doc, "div", { class: "deco-pane" }, [
      bilingualText(doc, ctx, "div", "其他位置", "Other Places", { class: "deco-pane-hd" }),
      h(doc, "div", { class: "deco-pane-bd" }, [
        bilingualText(doc, ctx, "div", "我的文档", "My Documents", { class: "deco-link" }),
        bilingualText(doc, ctx, "div", "共享文档", "Shared Documents", { class: "deco-link" }),
        bilingualText(doc, ctx, "div", "控制面板", "Control Panel", { class: "deco-link" }),
      ]),
    ]),
  ]);

  // 右侧内容区：硬盘 / 可移动存储分组（纯展示）。
  const main = h(doc, "div", { class: "deco-mc-main", "aria-hidden": "true" }, [
    bilingualText(doc, ctx, "div", "存储在这台计算机上的文件", "Files Stored on This Computer", {
      class: "deco-mc-group",
    }),
    h(doc, "div", { class: "deco-mc-grid" }, [
      h(doc, "div", { class: "deco-item" }, [
        svgDrive(doc, "folder"),
        h(doc, "span", { class: "deco-tx" }, [
          bilingualText(doc, ctx, "span", "共享文档", "Shared Documents"),
        ]),
      ]),
    ]),
    bilingualText(doc, ctx, "div", "硬盘", "Hard Disk Drives", { class: "deco-mc-group" }),
    h(doc, "div", { class: "deco-mc-grid" }, [
      h(doc, "div", { class: "deco-item" }, [
        svgDrive(doc, "drive"),
        h(doc, "span", { class: "deco-tx" }, [
          bilingualText(doc, ctx, "span", "本地磁盘 (C:)", "Local Disk (C:)"),
          h(doc, "small", { text: "NTFS · 80 GB" }),
        ]),
      ]),
      h(doc, "div", { class: "deco-item" }, [
        svgDrive(doc, "drive"),
        h(doc, "span", { class: "deco-tx" }, [
          bilingualText(doc, ctx, "span", "本地磁盘 (D:)", "Local Disk (D:)"),
          h(doc, "small", { text: "NTFS · 120 GB" }),
        ]),
      ]),
    ]),
    bilingualText(doc, ctx, "div", "有可移动存储的设备", "Devices with Removable Storage", {
      class: "deco-mc-group",
    }),
    h(doc, "div", { class: "deco-mc-grid" }, [
      h(doc, "div", { class: "deco-item" }, [
        svgDrive(doc, "removable"),
        h(doc, "span", { class: "deco-tx" }, [
          bilingualText(doc, ctx, "span", "3.5 英寸软盘 (A:)", "3½ Floppy (A:)"),
        ]),
      ]),
      h(doc, "div", { class: "deco-item" }, [
        svgDrive(doc, "removable"),
        h(doc, "span", { class: "deco-tx" }, [
          bilingualText(doc, ctx, "span", "CD 驱动器 (E:)", "CD Drive (E:)"),
        ]),
      ]),
    ]),
  ]);

  root.appendChild(side);
  root.appendChild(main);
  bodyEl.appendChild(root);
  // Req 12.2：除窗口管理外无任何功能行为——不返回任何钩子。
}

// ── 16.2 我的文档：三个 PDF 快捷入口（Req 12.3/12.4）───────────────
function renderMyDocuments(bodyEl, ctx, doc) {
  const wm = ctx && ctx.wm;
  const root = h(doc, "div", { class: "deco-docs" });
  root.appendChild(
    bilingualText(doc, ctx, "div", "我的文档", "My Documents", { class: "deco-docs-hd" })
  );

  const list = h(doc, "div", { class: "deco-docs-list", role: "list" });
  for (const entry of PDF_ENTRIES) {
    // 用 <button> 保证可键盘聚焦并以 Enter/Space 激活（Req 16.6）。
    const title = S(ctx, entry.titleKey, entry.fallback);
    const btn = h(doc, "button", {
      type: "button",
      class: "deco-doc",
      role: "listitem",
      "data-app-id": entry.appId,
    }, [
      svgDrive(doc, "folder"),
      h(doc, "span", { class: "deco-tx" }, [
        h(doc, "span", { "data-i18n": entry.titleKey, text: title }),
        bilingualText(doc, ctx, "small", "PDF 文档", "PDF Document"),
      ]),
    ]);
    // 激活 → 打开或聚焦对应 PDF_Window（Req 12.4，遵循 Req 7 打开或聚焦语义）。
    btn.addEventListener("click", () => {
      if (wm && typeof wm.openOrFocus === "function") wm.openOrFocus(entry.appId);
    });
    list.appendChild(btn);
  }
  root.appendChild(list);
  bodyEl.appendChild(root);
}

// ── 16.3 控制面板：语言切换 + 减弱动效（Req 12.5）──────────────────
function renderControlPanel(bodyEl, ctx, doc) {
  const root = h(doc, "div", { class: "deco-cp" });

  // ── 语言切换段（zh/en），复用既有全局 i18n 机制 ──
  const langSeg = h(doc, "div", { class: "deco-seg", role: "group" });
  const zhBtn = h(doc, "button", { type: "button", "data-lang": "zh", text: "中文" });
  const enBtn = h(doc, "button", { type: "button", "data-lang": "en", text: "English" });
  langSeg.appendChild(zhBtn);
  langSeg.appendChild(enBtn);

  const reflectLang = () => {
    const lang = currentLang(ctx, doc);
    zhBtn.setAttribute("aria-pressed", lang === "zh" ? "true" : "false");
    enBtn.setAttribute("aria-pressed", lang === "en" ? "true" : "false");
  };
  reflectLang();

  // 切换到目标语言：复用全局 #lang-toggle（apply() 切换 Active_Language 并持久化）。
  // 仅两种语言，一次 click 即从当前翻转到另一语言。
  const setLang = (target) => {
    if (currentLang(ctx, doc) === target) return;
    const toggle = doc && doc.getElementById(LANG_TOGGLE_ID);
    if (toggle && typeof toggle.click === "function") toggle.click();
  };
  zhBtn.addEventListener("click", () => setLang("zh"));
  enBtn.addEventListener("click", () => setLang("en"));

  const langSec = h(doc, "section", { class: "deco-cp-sec" }, [
    i18nText(doc, ctx, "h3", "controlPanel.language", "语言"),
    h(doc, "div", { class: "deco-cp-bd" }, [langSeg]),
  ]);

  // ── 减弱动效偏好开关 + 提示 ──
  const applyRM = (on) => {
    if (doc && doc.documentElement) {
      doc.documentElement.classList.toggle("force-reduced-motion", on);
    }
    try {
      localStorage.setItem(RM_STORAGE_KEY, on ? "1" : "0");
    } catch {
      /* localStorage 不可用时仅在内存生效 */
    }
  };

  // 渲染时应用此前持久化的偏好（轻量真实设置）。
  let rmOn = false;
  try {
    rmOn = localStorage.getItem(RM_STORAGE_KEY) === "1";
  } catch {
    rmOn = false;
  }
  if (rmOn) applyRM(true);

  const rmToggle = h(doc, "button", {
    type: "button",
    class: "deco-toggle",
    "aria-pressed": rmOn ? "true" : "false",
  });
  const rmOnLabel = bilingualText(doc, ctx, "span", "已开启", "On");
  const rmOffLabel = bilingualText(doc, ctx, "span", "已关闭", "Off");
  rmToggle.appendChild(rmOn ? rmOnLabel : rmOffLabel);

  const reflectRM = () => {
    const on = !!(doc && doc.documentElement && doc.documentElement.classList.contains("force-reduced-motion"));
    rmToggle.setAttribute("aria-pressed", on ? "true" : "false");
    rmToggle.innerHTML = "";
    rmToggle.appendChild(on ? rmOnLabel : rmOffLabel);
  };
  rmToggle.addEventListener("click", () => {
    const next = !(doc.documentElement && doc.documentElement.classList.contains("force-reduced-motion"));
    applyRM(next);
    reflectRM();
  });

  const rmSec = h(doc, "section", { class: "deco-cp-sec" }, [
    i18nText(doc, ctx, "h3", "controlPanel.reducedMotion", "减弱动效"),
    h(doc, "div", { class: "deco-cp-bd" }, [
      h(doc, "div", { class: "deco-row" }, [rmToggle]),
      bilingualText(
        doc,
        ctx,
        "p",
        "开启后将抑制窗口与界面的非必要动画。本站同样会自动遵循系统的「减弱动效」设置。",
        "When on, non-essential window and UI animations are suppressed. This site also follows your system's reduced-motion setting automatically.",
        { class: "deco-hint" }
      ),
    ]),
  ]);

  root.appendChild(langSec);
  root.appendChild(rmSec);
  bodyEl.appendChild(root);

  // 监听 <html> 的 lang/class 变化（如全局语言切换、外部偏好变更），实时同步高亮态。
  let observer = null;
  if (doc && doc.documentElement && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => {
      reflectLang();
      reflectRM();
    });
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["lang", "class"] });
  }

  // onClose：断开观察器，避免窗口关闭后泄漏。
  return {
    onClose() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },
  };
}

/**
 * Help and Support 渲染器（Req 27.4）——展示站点所有者的联系方式列表。
 * 数据派生自 content.json 的 contacts.items。
 */
function renderHelp(bodyEl, ctx, doc) {
  var contactItems = (content.contacts && content.contacts.items) || [];
  var root = h(doc, "div", { class: "deco-help" });

  // 标题区
  root.appendChild(
    h(doc, "section", { class: "deco-cp-sec" }, [
      i18nText(doc, ctx, "h3", "help.title", "联系方式", { class: "deco-help-head" }),
      i18nText(
        doc, ctx, "p",
        "help.desc",
        "如需技术支持，请通过以下方式联系我：",
        { class: "deco-help-desc" }
      ),
    ])
  );

  // 联系方式列表
  var list = h(doc, "div", { class: "deco-help-list" });
  var iconMap = { phone: "☎", wechat: "💬", mail: "✉", megaphone: "📢" };

  contactItems.forEach(function (item) {
    var lang = currentLang(ctx, doc);
    var label = item.label && (item.label[lang] || item.label.zh) || "";
    var sub = item.sub && (item.sub[lang] || item.sub.zh) || item.value || "";
    var icon = iconMap[item.icon] || "📋";

    var row = h(doc, "div", { class: "deco-help-row" }, [
      h(doc, "span", { class: "deco-help-icon", text: icon }),
      h(doc, "div", { class: "deco-help-info" }, [
        h(doc, "span", { class: "deco-help-label", text: label }),
        h(doc, "span", { class: "deco-help-value", text: sub }),
      ]),
    ]);

    // 点击复制到剪贴板
    if (item.value) {
      row.style.cursor = "pointer";
      row.setAttribute("title", lang === "en" ? "Click to copy" : "点击复制");
      row.addEventListener("click", function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(item.value).then(function () {
            var toastEl = doc.getElementById("toast");
            if (toastEl) {
              toastEl.textContent = (lang === "en" ? "Copied: " : "已复制: ") + item.value;
              toastEl.classList.add("show");
              setTimeout(function () { toastEl.classList.remove("show"); }, 1700);
            }
          });
        }
      });
    }

    list.appendChild(row);
  });

  root.appendChild(list);
  bodyEl.appendChild(root);
}

/**
 * decorative 渲染器入口：按 decoType 分支渲染装饰窗口正文。
 * @param {HTMLElement} bodyEl  窗口内容容器（.xp-win-body）
 * @param {Object} appDef       该窗口的 App_Definition（含 content.decoType）
 * @param {Object} ctx          运行时上下文 { wm, i18n, isMobile, opts }
 * @returns {{ onClose?: () => void }|void}
 */
export function render(bodyEl, appDef, ctx) {
  if (!bodyEl) return;
  const doc = getDoc(bodyEl);
  if (!doc) return;
  ensureStyles(doc);

  bodyEl.classList.add("wm-deco");
  bodyEl.innerHTML = "";

  const decoType = appDef && appDef.content && appDef.content.decoType;
  switch (decoType) {
    case "mycomputer":
      return renderMyComputer(bodyEl, ctx, doc);
    case "mydocuments":
      return renderMyDocuments(bodyEl, ctx, doc);
    case "controlpanel":
      return renderControlPanel(bodyEl, ctx, doc);
    case "help":
      return renderHelp(bodyEl, ctx, doc);
    default:
      // 未知 decoType：安全回退，不抛（保持窗口生命周期稳定）。
      return;
  }
}

// 自注册到内容渲染器分发框架（import 时生效，无需改动 WindowManager）。
registerRenderer("decorative", render);

export default render;
