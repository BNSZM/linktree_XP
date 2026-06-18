// ════════════════════════════════════════════════════════════
// main-card 渲染器 —— 主窗口「培文的名片」（任务 13.1，Req 8 / Req 9）。
//
// 以经典 Windows XP「系统属性」对话框为视觉参考（非像素级复刻，Req 8.6）：
// 蓝色 Luna 标题栏由窗口框架（XPWindow 模板 + WindowManager）提供；本渲染器
// 在窗口正文（.xp-win-body）内注入米色对话框主体——选项卡条 + 左图右信息布局
// + 底部 OK/Cancel/Apply 装饰按钮，并承载个人主页内容（头像 / 姓名 / 标语 /
// AI 聊天入口 / 产品条目 / 联系方式图标 / 页脚，Req 8.2）。
//
// 操作接线（Req 9）：
//   · AI 聊天入口按钮          → wm.openOrFocus("chat")                      (Req 9.1)
//   · AI 定制方案产品条目      → wm.openOrFocus("chat", { guideMessage })     (Req 9.2)
//                               打开聊天后按「当前语言」自动发送引导语，引导语经
//                               opts 透传给 chat 渲染器（由其在打开时发送）。
//   · 三个 PDF 产品条目        → wm.openOrFocus("pdf-overseas|fastgpt|m365")  (Req 9.3/9.4/9.5)
//   · 联系方式图标             → 复用 scripts/copy.js 的 initCopy 复制到剪贴板 +
//                               Toast，不打开任何窗口                          (Req 9.6)
//
// 装饰性控件（Req 8.5/8.7）：标题栏「?」帮助按钮、选项卡条、OK/Cancel/Apply
// 均为装饰——「?」与按钮无任何动作；选项卡仅切换激活外观，不改变所显示内容。
//
// 数据/文案来自唯一内容源（content.json → data/site.js / i18n/strings.js）。
// 新增文案均带 data-i18n / data-i18n-zh / data-i18n-en 绑定，随语言切换更新
// （Req 8 文本 + Req 15 i18n 保留）。
//
// 渲染器签名（见 renderers/index.js）：render(bodyEl, appDef, ctx) -> hooks|void
//   ctx = { wm, i18n, isMobile, opts }
// ════════════════════════════════════════════════════════════

import { registerRenderer } from "./index.js";
import { SITE, icons } from "../../../data/site.js";
import { strings, t, DEFAULT_LANG } from "../../../i18n/strings.js";
// 复用既有 i18n 单例（语言状态 / toast）与复制逻辑，避免重复实现（Req 9.6）。
import { S as i18nS, toast as i18nToast, getCurrentLang as i18nLang } from "../../i18n.js";
import { initCopy } from "../../copy.js";
import { SVG_SEND_PATHS } from "./_utils.js";

// 产品 PDF 路径 → PDF 窗口 App_Definition id（Req 9.3/9.4/9.5）。
// 顺序与 registry / content.products 一致：海外中转 / FastGPT / Microsoft 365。
const PDF_APP_BY_URL = {
  "/pdf/apihub-overseas-llm-relay.pdf": "pdf-overseas",
  "/pdf/fastgpt-commercial.pdf": "pdf-fastgpt",
  "/pdf/microsoft365-copilot.pdf": "pdf-m365",
};
const PDF_APP_BY_INDEX = ["pdf-overseas", "pdf-fastgpt", "pdf-m365"];

const SVG_SEND =
  SVG_SEND_PATHS;
const SVG_PDF_CUE =
  '<path d="M14 3h7v7"></path><path d="M10 14L21 3"></path><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path>';
const SVG_CHAT_CUE =
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>';

// ── 小工具：元素构建 ──────────────────────────────────────────

/**
 * 创建元素：设置 class / textContent / 属性 / 子节点。
 * @param {Document} doc
 * @param {string} tag
 * @param {{ class?: string, text?: string, attrs?: Object, children?: (Node|null)[] }} [o]
 * @returns {HTMLElement}
 */
function el(doc, tag, o = {}) {
  const node = doc.createElement(tag);
  if (o.class) node.className = o.class;
  if (o.text != null) node.textContent = o.text;
  if (o.attrs) {
    for (const [k, v] of Object.entries(o.attrs)) {
      if (v != null) node.setAttribute(k, String(v));
    }
  }
  if (o.children) {
    for (const c of o.children) if (c) node.appendChild(c);
  }
  return node;
}

/**
 * 由可信路径标记构建一个内联 SVG 元素（命名空间正确）。
 * @param {Document} doc
 * @param {string} paths 内部 <path> 标记
 * @param {string} [cls]
 * @returns {SVGElement}
 */
function svg(doc, paths, cls) {
  const wrap = doc.createElement("div");
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    paths +
    "</svg>";
  const node = wrap.firstElementChild;
  if (cls) node.setAttribute("class", cls);
  return node;
}

/** 当前语言（优先复用 ctx.i18n，回退到 i18n 模块单例）。 */
function resolveLang(ctx) {
  const g = ctx && ctx.i18n && ctx.i18n.getCurrentLang;
  const lang = typeof g === "function" ? g() : i18nLang();
  return strings[lang] ? lang : DEFAULT_LANG;
}

/** 按当前语言取扁平 i18n 文案（与 data-i18n 机制一致）。 */
function str(lang, key) {
  return t(lang, key);
}

// ── 渲染器主体 ────────────────────────────────────────────────

/**
 * 渲染主名片正文并接线操作。
 * @param {HTMLElement} bodyEl 窗口内容容器（.xp-win-body）
 * @param {Object} appDef      该窗口的 App_Definition
 * @param {Object} ctx         { wm, i18n, isMobile, opts }
 * @returns {void}
 */
export function render(bodyEl, appDef, ctx) {
  if (!bodyEl) return;
  const doc = bodyEl.ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!doc) return;
  const wm = ctx && ctx.wm;
  const lang = resolveLang(ctx);

  // 清空正文（重渲染安全）。
  bodyEl.textContent = "";

  // 标记正文为系统属性风格容器，便于样式钩挂。
  bodyEl.classList.add("mc-body");

  // ── 对话框主体（无装饰性标签栏，内容直接铺满）──────────────────
  const body = el(doc, "div", { class: "xp-body" });

  // ─ 身份组框：左图（头像）右信息（姓名/标语）布局（Req 8.6）─
  const idGroup = el(doc, "fieldset", { class: "xp-group" });
  idGroup.appendChild(
    el(doc, "legend", {
      class: "xp-group-legend",
      text: str(lang, "ui.aboutLabel"),
      attrs: { "data-i18n": "ui.aboutLabel" },
    })
  );

  // 头像（左）：使用真实照片。
  const avatarImg = el(doc, "img", {
    attrs: { src: "/images/avatar.jpg", alt: "avatar" },
  });
  const avatar = el(doc, "div", {
    class: "avatar",
    attrs: { role: "img", "aria-label": "avatar" },
    children: [avatarImg],
  });
  const idLeft = el(doc, "div", { class: "mc-id-left", children: [avatar] });

  // 信息（右）：姓名 / 标语 / AI 聊天入口。
  const name = el(doc, "h1", {
    class: "name",
    text: str(lang, "profile.name"),
    attrs: { "data-i18n": "profile.name" },
  });
  const tagline = el(doc, "p", {
    class: "tagline",
    text: str(lang, "profile.tagline"),
    attrs: { "data-i18n": "profile.tagline" },
  });

  const idRight = el(doc, "div", { class: "mc-id-right", children: [name, tagline] });
  const identity = el(doc, "section", {
    class: "identity mc-identity",
    attrs: { "aria-label": "profile" },
    children: [idLeft, idRight],
  });
  idGroup.appendChild(identity);
  body.appendChild(idGroup);

  // ─ AI 聊天入口组框：独立区域，位于身份与产品之间 ─
  const chatGroup = el(doc, "fieldset", { class: "xp-group" });
  chatGroup.appendChild(
    el(doc, "legend", {
      class: "xp-group-legend",
      text: str(lang, "ui.chatSection"),
      attrs: { "data-i18n": "ui.chatSection" },
    })
  );

  // AI 聊天入口按钮 → openOrFocus("chat")（Req 9.1）。
  const ceEyebrow = el(doc, "span", {
    class: "ce-eyebrow",
    children: [
      el(doc, "i", { class: "dot" }),
      el(doc, "span", {
        text: str(lang, "chat.eyebrow"),
        attrs: { "data-i18n": "chat.eyebrow" },
      }),
    ],
  });
  const ceSep = el(doc, "span", { class: "ce-sep", text: "·" });
  const ceText = el(doc, "span", {
    class: "ce-text",
    text: str(lang, "chat.entry"),
    attrs: { "data-i18n": "chat.entry" },
  });
  const ceMid = el(doc, "span", { class: "ce-mid", children: [ceEyebrow, ceSep, ceText] });
  const ceCue = el(doc, "span", {
    class: "ce-cue",
    attrs: { "aria-hidden": "true" },
    children: [svg(doc, SVG_CHAT_CUE)],
  });
  const chatEntry = el(doc, "button", {
    class: "chat-entry",
    attrs: { type: "button", "aria-label": "Chat with AI assistant" },
    children: [ceMid, ceCue],
  });
  chatEntry.addEventListener("click", () => {
    if (wm && typeof wm.openOrFocus === "function") wm.openOrFocus("chat");
  });
  const aiFrame = el(doc, "div", { class: "ai-frame", children: [chatEntry] });
  chatGroup.appendChild(aiFrame);
  body.appendChild(chatGroup);

  // ─ 产品组框：产品条目（接线 PDF / chat，Req 9.2–9.5）─
  const prodGroup = el(doc, "fieldset", { class: "xp-group" });
  prodGroup.appendChild(
    el(doc, "legend", {
      class: "xp-group-legend",
      text: str(lang, "products.title"),
      attrs: { "data-i18n": "products.title" },
    })
  );
  const pills = el(doc, "div", { class: "pills", attrs: { id: "pills" } });

  let pdfSeen = 0;
  (SITE.products || []).forEach((p, i) => {
    const titleEl = el(doc, "span", {
      class: "pill-title",
      text: (p.title && p.title[lang]) || (p.title && p.title.zh) || "",
      attrs: { "data-i18n-zh": p.title?.zh, "data-i18n-en": p.title?.en },
    });
    const subEl = el(doc, "span", {
      class: "pill-sub",
      text: (p.sub && p.sub[lang]) || (p.sub && p.sub.zh) || "",
      attrs: { "data-i18n-zh": p.sub?.zh, "data-i18n-en": p.sub?.en },
    });
    const txt = el(doc, "span", { class: "pill-tx", children: [titleEl, subEl] });

    const pill = el(doc, "button", {
      class: "pill" + (p.open ? " pill-open" : ""),
      attrs: { type: "button", "data-pill": String(i) },
      children: [txt],
    });

    if (p.pdf) {
      // PDF 产品条目 → 打开/聚焦对应 PDF 窗口（Req 9.3/9.4/9.5）。
      const appId = PDF_APP_BY_URL[p.pdf] || PDF_APP_BY_INDEX[pdfSeen] || null;
      pdfSeen += 1;
      pill.appendChild(
        el(doc, "span", {
          class: "pill-cue",
          attrs: { "aria-hidden": "true" },
          children: [svg(doc, SVG_PDF_CUE)],
        })
      );
      pill.addEventListener("click", () => {
        if (appId && wm && typeof wm.openOrFocus === "function") wm.openOrFocus(appId);
      });
    } else if (p.action === "chat") {
      // AI 定制方案条目 → 打开/聚焦聊天，并按当前语言自动发送引导语（Req 9.2）。
      pill.appendChild(
        el(doc, "span", {
          class: "pill-cue",
          attrs: { "aria-hidden": "true" },
          children: [svg(doc, SVG_CHAT_CUE)],
        })
      );
      // 引导语双语绑定（便于语言切换后再次点击取到正确语种）。
      if (p.chatMessage) {
        pill.setAttribute("data-chat-msg-zh", p.chatMessage.zh || "");
        pill.setAttribute("data-chat-msg-en", p.chatMessage.en || "");
      }
      pill.addEventListener("click", () => {
        // 取「点击时」的当前语言，确保引导语语种与界面一致（Req 9.2）。
        const curLang = resolveLang(ctx);
        const guideMessage =
          (p.chatMessage && (p.chatMessage[curLang] || p.chatMessage.zh)) || "";
        if (wm && typeof wm.openOrFocus === "function") {
          // 引导语经 opts 透传给 chat 渲染器，由其在打开后按当前语言发送。
          wm.openOrFocus("chat", { guideMessage, lang: curLang });
        }
      });
    }
    // 其余无 pdf / 无 action 的条目：纯展示，不接线。

    pills.appendChild(pill);
  });
  prodGroup.appendChild(pills);
  body.appendChild(prodGroup);

  // ─ 联系方式组框：图标复制到剪贴板 + Toast，不开窗（Req 9.6）─
  const contactGroup = el(doc, "fieldset", { class: "xp-group" });
  contactGroup.appendChild(
    el(doc, "legend", {
      class: "xp-group-legend",
      text: str(lang, "copy.hint"),
      attrs: { "data-i18n": "copy.hint" },
    })
  );
  // 容器 id="links" 供 initCopy 经事件委托绑定复制（复用既有逻辑）。
  const contactRow = el(doc, "div", { class: "contact-row", attrs: { id: "links" } });
  (SITE.contacts || []).forEach((it) => {
    const href =
      it.type === "mailto"
        ? `mailto:${it.value}`
        : it.type === "tel"
          ? `tel:${it.value}`
          : "#";
    const a = el(doc, "a", {
      class: "sbtn",
      attrs: {
        href,
        "data-type": it.type,
        "aria-label": (it.label && it.label[lang]) || "",
        title: (it.sub && it.sub[lang]) || "",
        ...(it.type === "copy" ? { "data-copy": it.value } : {}),
      },
      children: [svg(doc, icons[it.icon] || "")],
    });
    contactRow.appendChild(a);
  });
  const contactSection = el(doc, "nav", {
    class: "contact-section",
    attrs: { "aria-label": "contacts" },
    children: [contactRow],
  });
  contactGroup.appendChild(contactSection);
  body.appendChild(contactGroup);

  // ─ 页脚 ─
  body.appendChild(
    el(doc, "p", {
      class: "foot",
      text: str(lang, "foot.note"),
      attrs: { "data-i18n": "foot.note" },
    })
  );

  bodyEl.appendChild(body);

  // ── 联系方式复制接线（复用 scripts/copy.js，Req 9.6）────────────
  // initCopy 经 #links 事件委托完成复制 + Toast，不打开任何窗口。
  // 复用 i18n 模块单例的 S / toast（与全站一致的当前语言与提示样式）。
  const S = (ctx && ctx.i18n && typeof ctx.i18n.S === "function") ? ctx.i18n.S : i18nS;
  const toast =
    (ctx && ctx.i18n && typeof ctx.i18n.toast === "function") ? ctx.i18n.toast : i18nToast;
  try {
    initCopy({ S, toast });
  } catch {
    /* 复制接线失败不应破坏窗口渲染 */
  }

  // 本渲染器无需生命周期钩子（内容静态、语言切换由全局 i18n 接管）。
}

// 自注册：模块加载即将本渲染器登记到 kind="main-card"（Req 18.4）。
registerRenderer("main-card", render);

export default render;
