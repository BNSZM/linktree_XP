// ════════════════════════════════════════════════════════════
// chat 内容渲染器 —— 窗口化 AI 聊天（任务 14.1，Req 10 / Req 9.2）。
//
// 由 WindowManager 在打开 Chat_Window 时调用，向窗口正文（.xp-win-body）注入：
//   · 消息流区域（.chat-msgs）
//   · 建议气泡（.chips，取自 content.json → SITE.chips，双语）
//   · 输入框 + 发送按钮（.chat-form / .chat-input / .chat-go）
//
// 复用 chat/provider.js 的 chatProvider.stream，保留 SSE 流式追加（Req 10.2）。
// 行为：
//   · 首次打开显示问候 + 建议气泡（Req 10.4）
//   · 点击气泡把气泡文本作为消息发送（Req 10.5）
//   · 空响应 / 错误 → 在消息流显示配置好的错误文案 chat.error（Req 10.3）
//   · ctx.opts.guideMessage（由主窗口「AI 定制方案」条目透传）在打开时按当前
//     语言自动发送（Req 9.2）
//
// i18n：文案经 ctx.i18n.S 取（chat.greeting / chat.error / chat.placeholder），
// 当前语言经 ctx.i18n.getCurrentLang 判断（回退到 scripts/i18n.js 单例）。
// 建议气泡带 data-i18n-zh/-en，语言切换由全局 i18n.apply() 统一更新。
//
// 渲染器签名（见 ./index.js）：render(bodyEl, appDef, ctx) -> hooks|void。
// 模块加载时经 registerRenderer("chat", render) 自注册（Req 18.4）。
// ════════════════════════════════════════════════════════════
import { registerRenderer } from "./index.js";
import { chatProvider } from "../../../chat/provider.js";
import { SITE } from "../../../data/site.js";
import {
  S as i18nS,
} from "../../i18n.js";
import { resolveLang, SVG_SEND_PATHS } from "./_utils.js";

/** 取某 i18n key 当前语言文案（优先 ctx.i18n.S，回退到 i18n 模块单例）。 */
function str(ctx, key) {
  const S = ctx && ctx.i18n && typeof ctx.i18n.S === "function" ? ctx.i18n.S : i18nS;
  try {
    const v = S(key);
    if (v != null && v !== "") return v;
  } catch {
    /* 忽略，回退空串 */
  }
  return "";
}

/**
 * chat 渲染器：注入聊天 UI 并接线流式发送。
 * @param {HTMLElement} bodyEl 窗口内容容器（.xp-win-body）
 * @param {Object} appDef      该窗口的 App_Definition
 * @param {Object} ctx         { wm, i18n, isMobile, opts }
 * @returns {{ onFocus?: () => void }|void}
 */
export function render(bodyEl, appDef, ctx) {
  if (!bodyEl) return;
  const doc =
    bodyEl.ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!doc) return;

  bodyEl.textContent = "";
  bodyEl.classList.add("chat-win-body");

  // ── 聊天窗口包装器（.chat-win）──
  const wrap = doc.createElement("div");
  wrap.className = "chat-win";

  // ── 消息流 ──
  const msgs = doc.createElement("div");
  msgs.className = "chat-msgs";

  // ── 建议气泡（取自 content.json → SITE.chips，双语）──
  const chips = doc.createElement("div");
  chips.className = "chips";
  const lang0 = resolveLang(ctx);
  (SITE.chips || []).forEach((c) => {
    const chip = doc.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    if (c.zh != null) chip.setAttribute("data-i18n-zh", c.zh);
    if (c.en != null) chip.setAttribute("data-i18n-en", c.en);
    chip.textContent = (lang0 === "en" ? c.en : c.zh) || c.zh || "";
    chips.appendChild(chip);
  });

  // ── 输入表单 ──
  const form = doc.createElement("form");
  form.className = "chat-form";

  const input = doc.createElement("textarea");
  input.className = "chat-input";
  input.rows = 1;
  input.setAttribute("data-i18n-ph", "chat.placeholder");
  input.setAttribute("placeholder", str(ctx, "chat.placeholder"));

  const go = doc.createElement("button");
  go.type = "submit";
  go.className = "chat-go";
  go.setAttribute("aria-label", "Send");
  const goSvgWrap = doc.createElement("div");
  goSvgWrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    SVG_SEND_PATHS +
    "</svg>";
  go.appendChild(goSvgWrap.firstElementChild);

  form.appendChild(input);
  form.appendChild(go);

  wrap.appendChild(msgs);
  wrap.appendChild(chips);
  wrap.appendChild(form);
  bodyEl.appendChild(wrap);

  // ── 会话状态 ──
  const history = [];
  let started = false;
  let busy = false;
  let asked = false;

  function bubble(role, text = "") {
    const el = doc.createElement("div");
    el.className = "msg " + (role === "user" ? "user" : "bot");
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  // 首次打开：问候 + 建议气泡（Req 10.4）。
  if (!started) {
    bubble("bot", str(ctx, "chat.greeting"));
    started = true;
  }

  // ── SSE 中止控制器（onClose 时 abort 在途请求）──
  let abortController = null;

  async function sendChat(text) {
    if (busy || !text || !text.trim()) return;
    asked = true;
    chips.hidden = true;
    busy = true;
    go.disabled = true;
    input.disabled = true;

    bubble("user", text);
    history.push({ role: "user", content: text });

    const botEl = bubble("bot", "");
    const textNode = doc.createTextNode("");
    const caret = doc.createElement("span");
    caret.className = "caret";
    botEl.append(textNode, caret);
    let acc = "";

    abortController = typeof AbortController !== "undefined" ? new AbortController() : null;

    const finish = () => {
      caret.remove();
      busy = false;
      go.disabled = false;
      input.disabled = false;
      abortController = null;
      try {
        input.focus();
      } catch {
        /* 测试环境无焦点能力时忽略 */
      }
    };

    try {
      await chatProvider.stream(history, {
        onToken: (tok) => {
          acc += tok;
          textNode.textContent = acc;
          msgs.scrollTop = msgs.scrollHeight;
        },
        onDone: () => {
          // 空响应 → 显示配置好的错误文案（Req 10.3）。
          if (!acc) {
            textNode.textContent = str(ctx, "chat.error");
          } else {
            history.push({ role: "assistant", content: acc });
          }
          finish();
        },
        onError: () => {
          // 流报错 → 显示配置好的错误文案（Req 10.3）。
          textNode.textContent = str(ctx, "chat.error");
          finish();
        },
        signal: abortController ? abortController.signal : undefined,
      });
    } catch {
      textNode.textContent = str(ctx, "chat.error");
      finish();
    }
  }

  // 点击气泡 → 把气泡文本作为消息发送（Req 10.5）。
  chips.addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (c) sendChat(c.textContent);
  });

  // 提交（发送按钮 / 回车）。
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = "";
    input.style.height = "auto";
    sendChat(v);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  // ── 引导语自动发送（Req 9.2）──
  // 主窗口「AI 定制方案」条目经 openOrFocus("chat", { guideMessage, lang }) 透传，
  // 在打开时按当前语言自动发送。引导语已在主卡片按点击时语言解析，故此处直接发送。
  const guide = ctx && ctx.opts && ctx.opts.guideMessage;
  if (guide && String(guide).trim()) {
    // 微任务延后，确保问候气泡已在 DOM 中、顺序自然。
    setTimeout(() => sendChat(String(guide)), 0);
  }

  return {
    onFocus() {
      // 聚焦时把输入框聚焦，便于直接输入（不影响流式状态）。
      if (!busy) {
        try {
          input.focus();
        } catch {
          /* 忽略 */
        }
      }
    },
    onClose() {
      // 窗口关闭前中止在途的 SSE 请求，避免悬挂连接。
      if (abortController) {
        try { abortController.abort(); } catch { /* 忽略 */ }
        abortController = null;
      }
    },
  };
}

// 加载即自注册（Req 18.4）。
registerRenderer("chat", render);

export default render;
