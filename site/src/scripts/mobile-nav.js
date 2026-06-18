// ════════════════════════════════════════════════════════════
// 移动端 Tab 导航 —— 底部 Tab 栏切换视图
//
// 三个 Tab：名片 | AI助手 | 更多
//   · 名片 → 显示主窗口（全屏）
//   · AI助手 → 显示聊天窗口（全屏）
//   · 更多 → 显示功能列表面板（PDF 新标签打开、留言板等）
//
// 桌面端不加载（MobileNav.astro 仅输出在 ≤768px 可见的 HTML）。
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
 * 初始化移动端 Tab 导航。
 * @param {Object} wm  WindowManager 实例
 */
export function initMobileNav(wm) {
  const tabbar = document.getElementById("mobile-tabbar");
  if (!tabbar) return;

  const tabs = tabbar.querySelectorAll("[data-tab]");
  let activeTab = "main";

  // ── "更多"面板 ──
  // 从注册表收集可在移动端展示的功能项：
  //   PDF → 新标签打开；notepad → 窗口内打开
  const moreApps = APP_REGISTRY.filter(
    (app) => app.id !== "main" && app.id !== "chat" && app.mobile.behavior !== "unavailable"
  );

  const morePanel = document.createElement("div");
  morePanel.className = "mobile-more-panel";
  morePanel.id = "mobile-more-panel";
  morePanel.hidden = true;

  moreApps.forEach((app) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "mobile-more-item";
    item.dataset.moreAppId = app.id;
    item.innerHTML =
      '<span class="mobile-more-icon" aria-hidden="true">' + app.icon + "</span>" +
      '<span class="mobile-more-label">' + str(app.titleKey) + "</span>" +
      (app.mobile.behavior === "newtab" ? '<span class="mobile-more-hint">↗</span>' : "");
    morePanel.appendChild(item);
  });

  // 点击"更多"面板中的项目
  morePanel.addEventListener("click", (e) => {
    const item = e.target.closest("[data-more-app-id]");
    if (!item) return;
    const appId = item.dataset.moreAppId;
    const appDef = wm.getAppDefinition(appId);

    if (appDef && appDef.mobile.behavior === "newtab" && appDef.content && appDef.content.pdfUrl) {
      window.open(appDef.content.pdfUrl, "_blank", "noopener");
    } else {
      wm.openOrFocus(appId);
    }
  });

  document.body.appendChild(morePanel);

  // ── 切换视图 ──
  function switchTab(tabId) {
    activeTab = tabId;

    // 更新 Tab 栏高亮
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tabId));

    // 隐藏所有窗口
    wm.getInstances().forEach((inst) => {
      if (inst.el) inst.el.style.display = "none";
    });

    // 隐藏"更多"面板
    morePanel.hidden = true;

    if (tabId === "more") {
      morePanel.hidden = false;
      return;
    }

    // 显示对应窗口
    let inst = wm.findInstanceByAppId(tabId);
    if (!inst) {
      inst = wm.openOrFocus(tabId);
    }
    if (inst && inst.el) {
      inst.el.style.display = "";
    }
  }

  // ── 绑定 Tab 点击 ──
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // ── 初始显示名片 ──
  switchTab("main");
}
