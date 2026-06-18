// ════════════════════════════════════════════════════════════
// 移动端"开始"菜单 —— 悬浮按钮 + 弹出功能列表
//
// 按钮固定左下角（XP 开始按钮风格），点击弹出菜单：
//   · AI 助手 → 打开聊天窗口（全屏）
//   · PDF 文档 → window.open 新标签打开
//   · 留言板 → 打开记事本窗口
//   · 其他功能...
//
// 点击菜单外部或再次点击按钮关闭菜单。
// ════════════════════════════════════════════════════════════
import { APP_REGISTRY } from "./wm/registry.js";
import {
  S as i18nS,
} from "./i18n.js";

/** 取某 i18n key 当前语言文案 */
function str(key) {
  try {
    const v = i18nS(key);
    if (v != null && v !== "") return v;
  } catch { /* 忽略 */ }
  return key;
}

/**
 * 初始化移动端开始菜单。
 * @param {Object} wm  WindowManager 实例
 */
export function initMobileStart(wm) {
  const btn = document.getElementById("mobile-start-btn");
  const menu = document.getElementById("mobile-start-menu");
  const itemsContainer = document.getElementById("start-menu-items");
  if (!btn || !menu || !itemsContainer) return;

  let isOpen = false;

  // ── 收集菜单项 ──
  // 排除 main（名片已在首页显示）和 unavailable（装饰窗口）
  const menuApps = APP_REGISTRY.filter(
    (app) => app.id !== "main" && app.mobile.behavior !== "unavailable"
  );

  // ── 渲染菜单项 ──
  menuApps.forEach((app, i) => {
    // 在 AI 助手和其他功能之间加分隔线
    if (i === 1) {
      const sep = document.createElement("div");
      sep.className = "start-menu-sep";
      itemsContainer.appendChild(sep);
    }

    const item = document.createElement("button");
    item.type = "button";
    item.className = "start-menu-item";
    item.dataset.appId = app.id;

    const icon = document.createElement("span");
    icon.className = "start-menu-item-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = app.icon;

    const label = document.createElement("span");
    label.className = "start-menu-item-label";
    label.textContent = str(app.titleKey);

    item.appendChild(icon);
    item.appendChild(label);

    // PDF 加"↗"提示（新标签打开）
    if (app.mobile.behavior === "newtab") {
      const hint = document.createElement("span");
      hint.className = "start-menu-item-hint";
      hint.textContent = "↗";
      item.appendChild(hint);
    }

    itemsContainer.appendChild(item);
  });

  // ── 切换菜单 ──
  function toggleMenu() {
    isOpen = !isOpen;
    menu.hidden = !isOpen;
    btn.classList.toggle("is-open", isOpen);
  }

  function closeMenu() {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    btn.classList.remove("is-open");
  }

  // ── 事件绑定 ──
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // 点击菜单项
  itemsContainer.addEventListener("click", (e) => {
    const item = e.target.closest("[data-app-id]");
    if (!item) return;
    const appId = item.dataset.appId;
    const appDef = wm.getAppDefinition(appId);

    closeMenu();

    if (appDef && appDef.mobile.behavior === "newtab" && appDef.content && appDef.content.pdfUrl) {
      // PDF → 新标签打开
      window.open(appDef.content.pdfUrl, "_blank", "noopener");
    } else {
      // 其他 → 通过 WindowManager 打开
      wm.openOrFocus(appId);
    }
  });

  // 点击菜单外部关闭
  document.addEventListener("click", (e) => {
    if (isOpen && !menu.contains(e.target) && !btn.contains(e.target)) {
      closeMenu();
    }
  });

  // ESC 关闭
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}
