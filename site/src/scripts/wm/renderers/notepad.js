// ════════════════════════════════════════════════════════════
// notepad 内容渲染器 —— XP 记事本风格公共留言板（任务 19.3，Req 20 / Req 17.5）。
//
// 由 WindowManager 在打开 Notepad_Window 时调用，向窗口正文（.xp-win-body）注入：
//   · 留言列表（按 createdAt 倒序，textContent 渲染 → 防 XSS，Req 17.5/20.6）
//   · 每条留言显示：作者（昵称或默认匿名名，Req 20.12）、时间戳（Req 20.13）、正文
//   · 本人留言（ownerId === Visitor_Id）显示「编辑 / 删除」（Req 20.5）
//   · 提交区：可选昵称 + 文本域 + 字数计数（达上限禁用提交，Req 20.14）+ 保存
//   · 空状态文案（Req 20.16）
//   · 错误码 → 友好双语文案（Req 20.8）：too_long / rate_limited / load / save
//
// 数据经 messagesClient（/api/messages REST），归属经 Visitor_Id（localStorage）。
// i18n 文案取自 content.json → notepad.*（经 ctx.i18n.S 解析双语，Req 20.9）。
//
// 渲染器签名（见 ./index.js）：render(bodyEl, appDef, ctx) -> hooks|void。
// 模块加载时经 registerRenderer("notepad", render) 自注册（Req 18.4）。
// ════════════════════════════════════════════════════════════
import { registerRenderer } from "./index.js";
import { messagesClient } from "../../notepad/messages-client.js";
import { getVisitorId } from "../../notepad/visitor-id.js";
import {
  S as i18nS,
} from "../../i18n.js";
import { h, ensureStyles as _ensureStyles, resolveLang } from "./_utils.js";

// 客户端长度上限：与服务端 MAX_MSG_LEN / MAX_NICK_LEN 一致（服务端为权威，Req 20.14）。
const MAX_MSG_LEN = 500;
const MAX_NICK_LEN = 24;
const LIST_LIMIT = 50; // 列表限量（Req 20.15）

const STYLE_ID = "wm-notepad-styles";

/** 取某 i18n key 当前语言文案（优先 ctx.i18n.S，回退到 i18n 模块单例）。 */
function S(ctx, key, fallback) {
  const fn = ctx && ctx.i18n && typeof ctx.i18n.S === "function" ? ctx.i18n.S : i18nS;
  try {
    const v = fn(key);
    if (v != null && v !== "") return v;
  } catch {
    /* 忽略 */
  }
  return fallback != null ? fallback : "";
}

/** 把错误码映射为友好双语文案（Req 20.8）。 */
function errorText(ctx, code) {
  switch (code) {
    case "too_long":
      return S(ctx, "notepad.tooLong", "留言过长（上限 {max} 字）").replace(
        "{max}",
        String(MAX_MSG_LEN)
      );
    case "rate_limited":
      return S(ctx, "notepad.rateLimited", "操作太频繁，请稍后再试");
    case "load_error":
      return S(ctx, "notepad.loadError", "留言加载失败，请稍后重试");
    default:
      return S(ctx, "notepad.saveError", "保存失败，请稍后重试");
  }
}

/** 首次渲染时注入一次记事本样式（XP 记事本观感）。 */
function ensureStyles(doc) {
  _ensureStyles(doc, STYLE_ID, NOTEPAD_CSS);
}

/** 就地双语文本（data-i18n-zh/-en），语言切换由全局 i18n.apply() 更新。 */
function bilingual(doc, ctx, tag, zh, en, attrs = {}) {
  const lang = resolveLang(ctx);
  return h(doc, tag, {
    ...attrs,
    "data-i18n-zh": zh,
    "data-i18n-en": en,
    text: lang === "en" ? en : zh,
  });
}

/**
 * XP 风格虚拟对话框 — 替代浏览器 prompt()/confirm()（Req 26）。
 * 返回 Promise<string|null>：OK → 输入字符串，Cancel → null。
 * 可通过 window.__xpPrompt(opts) 在测试中 mock。
 */
function showXPPrompt(doc, opts) {
  return new Promise(function (resolve) {
    var overlay = doc.createElement("div");
    overlay.className = "xp-prompt-overlay";

    var dialog = doc.createElement("div");
    dialog.className = "xp-prompt";

    // ── Title bar (draggable) ──
    var titleBar = doc.createElement("div");
    titleBar.className = "xp-prompt-title";
    var titleText = doc.createElement("span");
    titleText.className = "xp-prompt-title-text";
    titleText.textContent = opts.title || "Prompt";
    var closeBtn = doc.createElement("button");
    closeBtn.className = "xp-prompt-close";
    closeBtn.type = "button";
    closeBtn.textContent = "\u00D7";
    titleBar.appendChild(titleText);
    titleBar.appendChild(closeBtn);

    // ── Body ──
    var body = doc.createElement("div");
    body.className = "xp-prompt-body";
    var label = doc.createElement("div");
    label.textContent = opts.label || "";
    var input = doc.createElement("input");
    input.className = "xp-prompt-input";
    input.type = opts.inputType || "text";
    input.value = opts.defaultValue || "";

    var btns = doc.createElement("div");
    btns.className = "xp-prompt-btns";
    var okBtn = doc.createElement("button");
    okBtn.className = "xp-prompt-btn";
    okBtn.type = "button";
    okBtn.textContent = "OK";
    var cancelBtn = doc.createElement("button");
    cancelBtn.className = "xp-prompt-btn";
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    btns.appendChild(okBtn);
    btns.appendChild(cancelBtn);
    body.appendChild(label);
    body.appendChild(input);
    body.appendChild(btns);

    dialog.appendChild(titleBar);
    dialog.appendChild(body);
    overlay.appendChild(dialog);

    function cleanup() {
      doc.removeEventListener("mousemove", onDragMove);
      doc.removeEventListener("mouseup", onDragEnd);
      overlay.remove();
    }
    function doOk() {
      var val = input.value;
      cleanup();
      resolve(val);
    }
    function doCancel() {
      cleanup();
      resolve(null);
    }

    // ── Event wiring ──
    okBtn.addEventListener("click", doOk);
    cancelBtn.addEventListener("click", doCancel);
    closeBtn.addEventListener("click", doCancel);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) doCancel();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); doOk(); }
      if (e.key === "Escape") { e.preventDefault(); doCancel(); }
    });

    // ── Drag by title bar ──
    var dragging = false;
    var dragStartX = 0, dragStartY = 0;
    var dlgStartX = 0, dlgStartY = 0;

    titleBar.addEventListener("mousedown", function (e) {
      if (e.target === closeBtn) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      var rect = dialog.getBoundingClientRect();
      dlgStartX = rect.left;
      dlgStartY = rect.top;
      dialog.style.position = "fixed";
      dialog.style.margin = "0";
      e.preventDefault();
    });
    function onDragMove(e) {
      if (!dragging) return;
      dialog.style.left = (dlgStartX + e.clientX - dragStartX) + "px";
      dialog.style.top = (dlgStartY + e.clientY - dragStartY) + "px";
    }
    function onDragEnd() { dragging = false; }
    doc.addEventListener("mousemove", onDragMove);
    doc.addEventListener("mouseup", onDragEnd);

    // ── Append & focus ──
    doc.body.appendChild(overlay);
    input.focus();
    if (opts.defaultValue) input.select();
  });
}

// 暴露到全局 — 测试 mock 入口（替代浏览器 prompt()）。
if (typeof window !== "undefined") {
  window.__xpPrompt = showXPPrompt;
}

const NOTEPAD_CSS = `
.wm-notepad { display:flex; flex-direction:column; height:100%; min-height:0;
  background:#fff; font-family:"Lucida Console","Consolas",Tahoma,monospace;
  font-size:12px; color:#0a0a0a; }
.np-list { flex:1; min-height:0; overflow:auto; padding:8px 10px;
  background:#fff; border-bottom:1px solid #ACA899; }
.np-status { padding:8px 10px; color:#555; font-style:italic; }
.np-status.np-status--error { color:#9b1c1c; }
.np-empty { padding:18px 10px; color:#777; text-align:center; font-style:italic; }
.np-msg { padding:7px 0; border-bottom:1px dotted #d6d2c2; }
.np-msg:last-child { border-bottom:0; }
.np-msg-head { display:flex; align-items:baseline; gap:8px; margin-bottom:2px; }
.np-msg-author { font-weight:bold; color:#10366f; }
.np-msg-time { color:#888; font-size:10px; }
.np-msg-actions { margin-left:auto; display:flex; gap:4px; }
.np-act { font:inherit; font-size:10px; padding:1px 8px; cursor:pointer;
  border:1px solid #ACA899; border-radius:3px;
  background:linear-gradient(180deg,#F5F3EA,#D6D2C2); color:#10366f; }
.np-act:hover { background:linear-gradient(180deg,#FEFCF5,#E8E5D5); }
.np-act:focus-visible { outline:2px solid #0a64d6; outline-offset:1px; }
.np-msg-text { white-space:pre-wrap; word-break:break-word; line-height:1.5; }
.np-edit { display:flex; flex-direction:column; gap:4px; margin-top:4px; }
.np-edit textarea { font:inherit; resize:vertical; min-height:48px; padding:4px 6px;
  border:1px solid #ACA899; border-radius:2px; }
.np-edit-row { display:flex; gap:6px; }
.np-form { flex:none; padding:8px 10px; display:flex; flex-direction:column; gap:6px;
  background:var(--luna-bg,#ECE9D8); }
.np-form-row { display:flex; gap:6px; align-items:center; }
.np-nick { flex:0 0 40%; font:inherit; padding:4px 6px; border:1px solid #ACA899;
  border-radius:2px; }
.np-text { width:100%; font:inherit; resize:vertical; min-height:54px; padding:5px 7px;
  border:1px solid #ACA899; border-radius:2px; }
.np-form-foot { display:flex; align-items:center; gap:10px; }
.np-counter { color:#666; font-size:10px; }
.np-counter.np-counter--over { color:#9b1c1c; font-weight:bold; }
.np-submit { margin-left:auto; font:inherit; padding:4px 16px; cursor:pointer;
  border:1px solid #ACA899; border-radius:3px;
  background:linear-gradient(180deg,#F5F3EA,#D6D2C2); color:#10366f; font-weight:bold; }
.np-submit:hover:not(:disabled) { background:linear-gradient(180deg,#FEFCF5,#E8E5D5); }
.np-submit:disabled { opacity:.5; cursor:default; }
.np-submit:focus-visible { outline:2px solid #0a64d6; outline-offset:1px; }
.np-act--danger { color:#9b1c1c; border-color:#cc5540; }
.np-act--danger:hover { background:linear-gradient(180deg,#fde8e0,#f5c4b0); }
.np-admin-row { display:flex; align-items:center; gap:8px; padding-top:4px;
  border-top:1px dotted #d6d2c2; }
.np-admin-trigger { font:inherit; font-size:10px; padding:2px 10px; cursor:pointer;
  border:1px solid #ACA899; border-radius:3px;
  background:linear-gradient(180deg,#F5F3EA,#D6D2C2); color:#666; }
.np-admin-trigger:hover { background:linear-gradient(180deg,#FEFCF5,#E8E5D5); color:#10366f; }
.np-admin-trigger--active { background:linear-gradient(180deg,#e0f0ff,#b8d8f8);
  color:#10366f; border-color:#0a64d6; font-weight:bold; }
.np-admin-clear { font:inherit; font-size:10px; padding:2px 10px; cursor:pointer;
  border:1px solid #cc5540; border-radius:3px;
  background:linear-gradient(180deg,#fde8e0,#f5c4b0); color:#9b1c1c; }
.np-admin-clear:hover { background:linear-gradient(180deg,#ffeee6,#f5d4c0); }
/* ── XP Virtual Prompt Dialog (Req 26) ── */
.xp-prompt-overlay { position:fixed; inset:0; z-index:10000;
  background:rgba(0,0,0,0.15); display:grid; place-items:center;
  font-family:Tahoma,Verdana,sans-serif; font-size:11px; }
.xp-prompt { min-width:280px; max-width:360px;
  background:var(--luna-bg,#ECE9D8); border:2px solid #0054E3;
  border-radius:8px 8px 0 0; box-shadow:4px 4px 12px rgba(0,0,0,0.35);
  overflow:hidden; }
.xp-prompt-title { display:flex; align-items:center; gap:6px; padding:4px 6px;
  background:linear-gradient(180deg,#0997FF 0%,#0050CC 45%,#0048C0 100%);
  color:#fff; font-size:11px; font-weight:700; cursor:move; user-select:none; }
.xp-prompt-title-text { flex:1; text-shadow:1px 1px 1px rgba(0,0,0,0.40); }
.xp-prompt-close { width:20px; height:18px; border:1px solid rgba(255,255,255,0.30);
  border-radius:2px; background:linear-gradient(180deg,#E4855E,#C83C14);
  color:#fff; font-size:10px; line-height:1; cursor:pointer;
  display:grid; place-items:center; padding:0; }
.xp-prompt-close:hover { filter:brightness(1.15); }
.xp-prompt-body { padding:16px 18px; display:flex; flex-direction:column; gap:10px; }
.xp-prompt-input { font-family:inherit; font-size:11px; padding:3px 6px;
  border:1px solid #7F9DB9; border-radius:1px; background:#fff; }
.xp-prompt-input:focus { outline:none; border-color:#0a64d6;
  box-shadow:0 0 0 1px #0a64d6; }
.xp-prompt-btns { display:flex; justify-content:flex-end; gap:6px; }
.xp-prompt-btn { font-family:inherit; font-size:11px; padding:3px 16px; min-width:72px;
  border:1px solid #ACA899; border-radius:3px;
  background:linear-gradient(180deg,#F5F3EA,#D6D2C2); color:#000; cursor:pointer;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.55); }
.xp-prompt-btn:hover { background:linear-gradient(180deg,#FEFCF5,#E8E5D5);
  border-color:#0a64d6; }
.xp-prompt-btn:active { background:linear-gradient(180deg,#D6D2C2,#E2DFD1);
  box-shadow:inset 0 2px 3px rgba(0,0,0,0.10); }
.xp-prompt-btn:focus-visible { outline:2px solid #0a64d6; outline-offset:1px; }
`;

/**
 * notepad 渲染器：注入留言板 UI 并接线加载 / 提交 / 编辑 / 删除。
 * @param {HTMLElement} bodyEl 窗口内容容器（.xp-win-body）
 * @param {Object} appDef      该窗口的 App_Definition
 * @param {Object} ctx         { wm, i18n, isMobile, opts }
 * @returns {void}
 */
export function render(bodyEl, appDef, ctx) {
  if (!bodyEl) return;
  const doc =
    bodyEl.ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!doc) return;
  ensureStyles(doc);

  bodyEl.textContent = "";
  bodyEl.classList.add("wm-notepad");

  let visitorId = "";
  try {
    visitorId = getVisitorId();
  } catch {
    visitorId = "";
  }

  // ── 管理员模式状态 ──
  let adminMode = false;
  let adminKey = "";

  // ── 列表区 + 状态条 ──
  const listEl = h(doc, "div", { class: "np-list", role: "log", "aria-live": "polite" });
  const statusEl = h(doc, "div", { class: "np-status", hidden: "" });

  // ── 提交区 ──
  const nickInput = h(doc, "input", {
    class: "np-nick",
    type: "text",
    maxlength: String(MAX_NICK_LEN),
    "data-i18n-ph": "notepad.nickname",
    placeholder: S(ctx, "notepad.nickname", "昵称（可选）"),
  });
  const textInput = h(doc, "textarea", {
    class: "np-text",
    rows: "2",
    "data-i18n-ph": "notepad.placeholder",
    placeholder: S(ctx, "notepad.placeholder", "留下你的想法…"),
  });
  const counter = h(doc, "span", { class: "np-counter", text: `0 / ${MAX_MSG_LEN}` });
  const submitBtn = h(doc, "button", {
    type: "button",
    class: "np-submit",
    "data-i18n": "notepad.submit",
    text: S(ctx, "notepad.submit", "保存"),
  });
  submitBtn.disabled = true;

  const form = h(doc, "div", { class: "np-form" }, [
    h(doc, "div", { class: "np-form-row" }, [nickInput]),
    h(doc, "div", { class: "np-form-row" }, [textInput]),
    h(doc, "div", { class: "np-form-foot" }, [counter, submitBtn]),
  ]);

  // ── 管理员面板：触发按钮 + 清空全部按钮 ──
  const adminTrigger = h(doc, "button", {
    type: "button",
    class: "np-admin-trigger",
    text: S(ctx, "notepad.admin", "管理"),
  });
  const clearAllBtn = h(doc, "button", {
    type: "button",
    class: "np-admin-clear",
    text: S(ctx, "notepad.clearAll", "清空全部留言"),
    hidden: "",
  });
  const adminRow = h(doc, "div", { class: "np-admin-row" }, [adminTrigger, clearAllBtn]);
  form.appendChild(adminRow);

  bodyEl.appendChild(listEl);
  bodyEl.appendChild(statusEl);
  bodyEl.appendChild(form);

  // ── 状态/错误提示 ──
  function showStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.hidden = !msg;
    statusEl.classList.toggle("np-status--error", !!isError);
  }
  function clearStatus() {
    showStatus("", false);
  }

  // ── 字数计数 + 达上限禁用提交（Req 20.14）──
  function refreshCounter() {
    const len = textInput.value.length;
    counter.textContent = `${len} / ${MAX_MSG_LEN}`;
    const over = len > MAX_MSG_LEN;
    counter.classList.toggle("np-counter--over", over);
    submitBtn.disabled = busy || over || len === 0;
  }

  let busy = false;

  // ── 时间戳格式化（Req 20.13）──
  function fmtTime(ts) {
    const n = Number(ts) || 0;
    if (!n) return "";
    try {
      return new Date(n).toLocaleString();
    } catch {
      return "";
    }
  }

  // ── 渲染单条留言（textContent → 防 XSS，Req 17.5/20.6）──
  function renderMessage(m) {
    const anon = S(ctx, "notepad.anonymous", "匿名访客");
    const author = m.nickname && String(m.nickname).trim() ? String(m.nickname) : anon;

    const head = h(doc, "div", { class: "np-msg-head" }, [
      h(doc, "span", { class: "np-msg-author", text: author }),
      h(doc, "span", { class: "np-msg-time", text: fmtTime(m.createdAt) }),
    ]);

    const textEl = h(doc, "div", { class: "np-msg-text", text: String(m.text == null ? "" : m.text) });
    const wrap = h(doc, "div", { class: "np-msg", "data-id": m.id }, [head, textEl]);

    // 本人留言（ownerId 匹配）或管理员模式 → 编辑 / 删除（Req 20.5）。
    const isOwner = visitorId && m.ownerId === visitorId;
    if (isOwner || adminMode) {
      const editBtn = isOwner
        ? bilingual(doc, ctx, "button", "编辑", "Edit", {
            type: "button",
            class: "np-act",
          })
        : null;
      const delBtn = bilingual(doc, ctx, "button", "删除", "Delete", {
        type: "button",
        class: "np-act np-act--danger",
      });
      const children = editBtn ? [editBtn, delBtn] : [delBtn];
      const actions = h(doc, "div", { class: "np-msg-actions" }, children);
      head.appendChild(actions);

      if (editBtn) editBtn.addEventListener("click", () => beginEdit(wrap, m, textEl));
      delBtn.addEventListener("click", () => {
        if (adminMode) {
          doAdminDelete(m);
        } else {
          doDelete(m);
        }
      });
    }
    return wrap;
  }

  // ── 内联编辑（Req 20.5）──
  function beginEdit(wrap, m, textEl) {
    if (wrap.querySelector(".np-edit")) return; // 已在编辑
    const ta = h(doc, "textarea", { maxlength: String(MAX_MSG_LEN) });
    ta.value = String(m.text == null ? "" : m.text);
    const save = bilingual(doc, ctx, "button", "保存", "Save", {
      type: "button",
      class: "np-act",
    });
    const cancel = bilingual(doc, ctx, "button", "取消", "Cancel", {
      type: "button",
      class: "np-act",
    });
    const box = h(doc, "div", { class: "np-edit" }, [
      ta,
      h(doc, "div", { class: "np-edit-row" }, [save, cancel]),
    ]);
    textEl.hidden = true;
    wrap.appendChild(box);
    try {
      ta.focus();
    } catch {
      /* 忽略 */
    }

    cancel.addEventListener("click", () => {
      box.remove();
      textEl.hidden = false;
    });
    save.addEventListener("click", async () => {
      const next = ta.value;
      if (!next.trim()) return;
      if (next.length > MAX_MSG_LEN) {
        showStatus(errorText(ctx, "too_long"), true);
        return;
      }
      save.disabled = true;
      cancel.disabled = true;
      try {
        await messagesClient.edit(m.id, { text: next, ownerId: visitorId });
        clearStatus();
        await load();
      } catch (err) {
        showStatus(errorText(ctx, err && err.code), true);
        save.disabled = false;
        cancel.disabled = false;
      }
    });
  }

  // ── 删除本人留言（Req 20.5）──
  async function doDelete(m) {
    try {
      await messagesClient.remove(m.id, { ownerId: visitorId });
      clearStatus();
      await load();
    } catch (err) {
      showStatus(errorText(ctx, err && err.code), true);
    }
  }

  // ── 管理员删除单条留言 ──
  async function doAdminDelete(m) {
    if (!adminKey) return;
    try {
      await messagesClient.adminDelete(m.id, adminKey);
      clearStatus();
      await load();
    } catch (err) {
      showStatus(
        S(ctx, "notepad.adminError", "管理员操作失败：{error}").replace(
          "{error}",
          (err && err.code) || "unknown"
        ),
        true
      );
    }
  }

  // ── 管理员清空全部留言（确认对话框使用 XP 虚拟对话框，Req 26）──
  async function doClearAll() {
    if (!adminKey) return;
    var confirmMsg = S(ctx, "notepad.clearConfirm", "确定清空全部留言？此操作不可恢复。");
    var confirmResult;
    if (typeof window !== "undefined" && typeof window.__xpPrompt === "function") {
      confirmResult = await window.__xpPrompt(doc, {
        title: S(ctx, "notepad.clearAllTitle", "确认清空"),
        label: confirmMsg,
        inputType: "hidden",
      });
    } else {
      confirmResult = confirm(confirmMsg) ? "" : null;
    }
    if (confirmResult === null) return;
    try {
      const res = await messagesClient.adminClearAll(adminKey);
      clearStatus();
      showStatus(
        S(ctx, "notepad.cleared", "已清空 {count} 条留言").replace(
          "{count}",
          String(res.deleted || 0)
        ),
        false
      );
      await load();
    } catch (err) {
      showStatus(
        S(ctx, "notepad.adminError", "管理员操作失败：{error}").replace(
          "{error}",
          (err && err.code) || "unknown"
        ),
        true
      );
    }
  }

  // ── 管理员触发：点击「管理」按钮弹出 XP 风格密钥输入框（Req 26）──
  async function promptAdminKey() {
    var key;
    if (typeof window !== "undefined" && typeof window.__xpPrompt === "function") {
      key = await window.__xpPrompt(doc, {
        title: S(ctx, "notepad.adminDialogTitle", "管理员认证"),
        label: S(ctx, "notepad.adminKeyPrompt", "请输入管理员密钥："),
        inputType: "password",
      });
    } else {
      key = prompt(S(ctx, "notepad.adminKeyPrompt", "请输入管理员密钥："));
    }
    if (key == null || key === "") return;
    adminKey = key;
    adminMode = true;
    adminTrigger.textContent = S(ctx, "notepad.adminActive", "管理 ✓");
    adminTrigger.classList.add("np-admin-trigger--active");
    clearAllBtn.hidden = false;
    load(); // 重新渲染列表以显示所有留言的删除按钮
  }

  function exitAdminMode() {
    adminMode = false;
    adminKey = "";
    adminTrigger.textContent = S(ctx, "notepad.admin", "管理");
    adminTrigger.classList.remove("np-admin-trigger--active");
    clearAllBtn.hidden = true;
    load();
  }

  adminTrigger.addEventListener("click", function () {
    if (adminMode) {
      exitAdminMode();
    } else {
      promptAdminKey().catch(function () {});
    }
  });
  clearAllBtn.addEventListener("click", function () {
    doClearAll().catch(function () {});
  });

  // ── 加载列表（Req 20.4），空状态（Req 20.16），失败提示（Req 20.8）──
  async function load() {
    try {
      const res = await messagesClient.list({ limit: LIST_LIMIT });
      const items = (res && res.items) || [];
      listEl.textContent = "";
      if (items.length === 0) {
        listEl.appendChild(
          h(doc, "div", {
            class: "np-empty",
            "data-i18n": "notepad.empty",
            text: S(ctx, "notepad.empty", "还没有留言，来做第一个吧～"),
          })
        );
        return;
      }
      for (const m of items) listEl.appendChild(renderMessage(m));
    } catch (err) {
      showStatus(errorText(ctx, "load_error"), true);
    }
  }

  // ── 提交新留言（Req 20.3/20.12）──
  async function submit() {
    const text = textInput.value;
    if (!text.trim() || busy) return;
    if (text.length > MAX_MSG_LEN) {
      showStatus(errorText(ctx, "too_long"), true);
      return;
    }
    busy = true;
    refreshCounter();
    try {
      await messagesClient.create({
        nickname: nickInput.value || "",
        text,
        ownerId: visitorId,
      });
      textInput.value = "";
      clearStatus();
      await load();
    } catch (err) {
      showStatus(errorText(ctx, err && err.code), true);
    } finally {
      busy = false;
      refreshCounter();
    }
  }

  textInput.addEventListener("input", refreshCounter);
  submitBtn.addEventListener("click", submit);
  refreshCounter();

  // 打开即加载此前所有访客的留言（Req 20.4）。
  load();
}

// 加载即自注册（Req 18.4）。
registerRenderer("notepad", render);

export default render;
