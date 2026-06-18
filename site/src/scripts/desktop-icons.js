// ════════════════════════════════════════════════════════════
// desktop-icons 模块 —— 桌面图标交互（双击打开 / 单击选中 / 键盘触发）
// 供 index.astro 的 <script> 块调用（Req 21.1/21.3/16.6）
//
// 导出: initDesktopIcons(wm)
//   wm: 窗口管理器实例（window.__wm），需具备 openOrFocus(appId) 方法
// ════════════════════════════════════════════════════════════

import { nextWallpaper, preloadWallpapers } from "./wallpaper.js";

/**
 * 初始化桌面图标交互。
 *
 * - 单击：切换选中态（`.desktop-icon--selected`）
 * - 双击：调用 `wm.openOrFocus(appId)` 打开/聚焦窗口
 * - 键盘 Enter/Space：等同双击（Req 16.6）
 * - 壁纸图标：单击即切换到下一张壁纸
 * - 桌面框选：按住左键拖动时显示虚线选框，松开后选中框内图标
 *
 * @param {{ openOrFocus: (appId: string) => void }} wm 窗口管理器实例
 */
export function initDesktopIcons(wm) {
  const icons = document.querySelectorAll(".desktop-icon");
  if (!icons.length) return;

  // 预加载所有壁纸图片
  preloadWallpapers();

  icons.forEach((icon) => {
    const appId = icon.dataset.appId;
    const action = icon.dataset.action;

    // ── 壁纸切换图标：单击选中，双击切换壁纸（与其他图标行为一致）──
    if (action === "next-wallpaper") {
      icon.addEventListener("click", () => {
        icons.forEach((ic) => ic.classList.remove("desktop-icon--selected"));
        icon.classList.add("desktop-icon--selected");
      });
      icon.addEventListener("dblclick", () => {
        nextWallpaper();
      });
      icon.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          nextWallpaper();
        }
      });
      return;
    }

    if (!appId) return;

    // 单击 —— 切换选中（清除其余图标的选中态，与 XP 一致）
    icon.addEventListener("click", () => {
      icons.forEach((ic) => ic.classList.remove("desktop-icon--selected"));
      icon.classList.add("desktop-icon--selected");
    });

    // 双击 —— 打开或聚焦窗口（Req 21.3）
    icon.addEventListener("dblclick", () => {
      wm.openOrFocus(appId);
    });

    // 键盘 —— Enter / Space 触发打开（Req 16.6）
    icon.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        wm.openOrFocus(appId);
      }
    });
  });

  // ── 桌面框选（marquee selection）──────────────────────
  initMarqueeSelection(icons);
}

/**
 * 桌面框选：按住左键在桌面空白区域拖动时显示虚线选框，
 * 松开后选中框内的桌面图标。
 * @param {NodeList} icons 桌面图标元素列表
 */
function initMarqueeSelection(icons) {
  const desktop = document.getElementById("xp-desktop");
  if (!desktop) return;

  let marquee = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;

  desktop.addEventListener("mousedown", (e) => {
    // 仅在左键 + 点击空白区域（非图标、非窗口）时启动框选
    if (e.button !== 0) return;
    if (e.target.closest(".desktop-icon") || e.target.closest(".xp-win")) return;

    // 清除已选中的图标
    icons.forEach((ic) => ic.classList.remove("desktop-icon--selected"));

    const rect = desktop.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    dragging = true;

    // 创建选框元素
    marquee = document.createElement("div");
    marquee.className = "desktop-marquee";
    marquee.style.cssText = `
      position: absolute;
      border: 1px dashed rgba(11, 97, 255, 0.75);
      background: rgba(11, 97, 255, 0.08);
      pointer-events: none;
      z-index: 5;
      left: ${startX}px;
      top: ${startY}px;
      width: 0;
      height: 0;
    `;
    desktop.appendChild(marquee);
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging || !marquee) return;

    const rect = desktop.getBoundingClientRect();
    const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);

    marquee.style.left = `${x}px`;
    marquee.style.top = `${y}px`;
    marquee.style.width = `${w}px`;
    marquee.style.height = `${h}px`;
  });

  document.addEventListener("mouseup", (e) => {
    if (!dragging || !marquee) return;
    dragging = false;

    // 计算选框矩形
    const mRect = marquee.getBoundingClientRect();
    marquee.remove();
    marquee = null;

    // 选框面积太小时视为单击空白区域，不做选中
    if (mRect.width < 5 && mRect.height < 5) return;

    // 选中与选框相交的图标
    icons.forEach((icon) => {
      const iRect = icon.getBoundingClientRect();
      if (
        iRect.left < mRect.right &&
        iRect.right > mRect.left &&
        iRect.top < mRect.bottom &&
        iRect.bottom > mRect.top
      ) {
        icon.classList.add("desktop-icon--selected");
      }
    });
  });
}
