// ════════════════════════════════════════════════════════════
// i18n 模块 —— 语言切换 / 文案应用 / 主题色注入 / 头像注入 /
//              标签页视觉切换 / 通用 toast 工具
// 从 index.astro 的 <script> 块抽离（Phase 6 架构重构）
//
// 导出:
//   initI18n()        初始化全部 i18n 逻辑（在页面加载时调用一次）
//   S(key)            按当前语言取文案，供 chat / copy 模块调用
//   toast(msg)        通用浮动提示，供 copy 模块调用
//   getCurrentLang()  获取当前语言（"zh" | "en"），供 chat 模块判断引导语语种
// ════════════════════════════════════════════════════════════
import { strings, LANGS, DEFAULT_LANG } from "../i18n/strings.js";
import { SITE } from "../data/site.js";

const STORAGE_KEY = "site-lang";
const HTML_LANG = { zh: "zh-CN", en: "en" };

let current = DEFAULT_LANG;

const getLang = () => {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(s) ? s : DEFAULT_LANG;
  } catch {
    // 隐私浏览 / 存储禁用 / 配额满时降级为默认语言
    return DEFAULT_LANG;
  }
};

/** 按当前语言取文案（被 chat / copy 模块依赖） */
export const S = (k) => (strings[current] || strings[DEFAULT_LANG])[k];

/** 获取当前语言（被 chat 模块依赖，用于产品引导语语种判断） */
export const getCurrentLang = () => current;

/** 通用浮动提示（被 copy 模块依赖） */
let toastTimer;
export function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1700);
}

/** 应用语言：遍历 data-i18n / data-i18n-zh / data-i18n-en / data-i18n-ph */
function apply(lang) {
  current = lang;
  const dict = strings[lang] || strings[DEFAULT_LANG];
  document.documentElement.lang = HTML_LANG[lang] || lang;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const k = el.getAttribute("data-i18n");
    if (dict[k] != null) el.textContent = dict[k];
  });
  document.querySelectorAll("[data-i18n-zh]").forEach((el) => {
    const v = el.getAttribute(lang === "zh" ? "data-i18n-zh" : "data-i18n-en");
    if (v != null) el.textContent = v;
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    const k = el.getAttribute("data-i18n-ph");
    if (dict[k] != null) el.setAttribute("placeholder", dict[k]);
  });

  if (dict["meta.title"]) document.title = dict["meta.title"];
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 存储不可用时静默忽略，语言切换仅在本次会话生效
  }
}

/** 初始化全部 i18n 相关逻辑 */
export function initI18n() {
  // ── 主题色（保留兼容，Luna 主题使用自有色板） ──
  document.documentElement.style.setProperty("--accent", SITE.theme.accent);
  document.documentElement.style.setProperty("--accent-2", SITE.theme.accent2);

  // ── 头像文字注入 ──
  document.querySelectorAll(".avatar span, .chat-avatar").forEach((el) => {
    el.textContent = SITE.profile.avatar;
  });

  // ── XP 标签页视觉切换（仅切换 active 状态，不影响内容展示） ──
  document.querySelectorAll(".xp-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".xp-tab").forEach((t) => {
        t.classList.remove("xp-tab--active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("xp-tab--active");
      tab.setAttribute("aria-selected", "true");
    });
  });

  // ── 语言切换按钮（桌面端托盘 + 移动端浮动，两个按钮共享切换逻辑） ──
  const btns = [
    document.getElementById("lang-toggle"),
    document.getElementById("lang-toggle-m"),
  ].filter(Boolean);
  apply(getLang());
  btns.forEach((b) => {
    b.addEventListener("click", () => apply(current === "zh" ? "en" : "zh"));
  });
}
