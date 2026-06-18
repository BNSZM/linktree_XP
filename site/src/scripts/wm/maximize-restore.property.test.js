// Feature: xp-desktop-window-manager, Property 9: 最大化/还原往返且最大化态锁定几何
//
// 对任意可最大化窗口（随机桌面尺寸 + 随机的拖动/调整尺寸先行操作，得到随机的
// 「最大化前矩形」），断言：
//   - 往返不变：toggleMaximize 最大化后再 toggleMaximize 还原，窗口精确回到
//     最大化前的矩形（left/top/width/height 完全一致，Req 22.2/22.3）。
//   - 最大化态锁定几何：处于最大化态时，对标题栏施加任意拖动、对把手施加任意
//     调整尺寸，窗口矩形均不发生改变（Req 22.4）。
//
// 随机的「最大化前矩形」通过对窗口先施加一次随机标题栏拖动与一次随机角把手
// 调整尺寸获得——精确复刻真实用户在最大化之前已移动/缩放窗口的情形。
//
// Validates: Requirements 22.2, 22.3, 22.4
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createWindowManager } from "./window-manager.js";
import { APP_REGISTRY } from "./registry.js";

// 仅可最大化窗口参与（Main_Window maximizable=false 不可最大化，Req 22.5 排除）。
const MAXIMIZABLE_IDS = APP_REGISTRY.filter((a) => a.maximizable).map((a) => a.id);

// 构建与 components/XPWindow.astro 一致的窗口模板，供 happy-dom 下克隆。
function buildTemplate() {
  const template = document.createElement("template");
  template.id = "xp-window-template";
  template.innerHTML = `
    <div class="xp-win" role="dialog" aria-modal="false" aria-label="" tabindex="-1">
      <div class="xp-win-titlebar">
        <span class="xp-win-icon" aria-hidden="true"></span>
        <span class="xp-win-title"></span>
        <div class="xp-win-controls">
          <button type="button" class="xp-win-btn xp-win-btn--min xp-win-min"></button>
          <button type="button" class="xp-win-btn xp-win-btn--max xp-win-max"></button>
          <button type="button" class="xp-win-btn xp-win-btn--close xp-win-close"></button>
        </div>
      </div>
      <div class="xp-win-body"></div>
      <span class="xp-rz xp-rz-n"></span>
      <span class="xp-rz xp-rz-s"></span>
      <span class="xp-rz xp-rz-e"></span>
      <span class="xp-rz xp-rz-w"></span>
      <span class="xp-rz xp-rz-ne"></span>
      <span class="xp-rz xp-rz-nw"></span>
      <span class="xp-rz xp-rz-se"></span>
      <span class="xp-rz xp-rz-sw"></span>
    </div>`;
  return template;
}

// 标题解析与几何无关，使用最小桩。
const i18nStub = { S: (k) => k, getCurrentLang: () => "zh" };

// happy-dom 将 clientWidth/Height 报告为 0，因此固定确定性桌面尺寸。
function withSize(el, w, h) {
  Object.defineProperty(el, "clientWidth", { value: w, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: h, configurable: true });
  return el;
}

// 合成带客户端坐标的指针事件（与 window-manager.test.js 中的拖动/调整尺寸一致）。
function pointer(type, target, clientX, clientY) {
  const ev = new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    pointerId: 1,
  });
  target.dispatchEvent(ev);
  return ev;
}

const handle = (inst, dir) => inst.el.querySelector(`.xp-rz-${dir}`);
const titlebarOf = (inst) => inst.el.querySelector(".xp-win-titlebar");

// 每个属性迭代使用全新 DOM 与隔离的 WindowManager 状态。
function makeWM(deskW, deskH) {
  document.body.innerHTML = "";
  const desktopEl = withSize(document.createElement("div"), deskW, deskH);
  document.body.appendChild(desktopEl);
  const taskbarEl = document.createElement("div");
  document.body.appendChild(taskbarEl);
  const templateEl = buildTemplate();
  document.body.appendChild(templateEl);
  return createWindowManager({
    desktopEl,
    taskbarEl,
    templateEl,
    registry: APP_REGISTRY,
    i18n: i18nStub,
  });
}

// 先施加一次随机标题栏拖动 + 一次随机 se 角调整尺寸，得到随机的「最大化前矩形」。
function applyRandomMove(inst, dragDx, dragDy, resizeDx, resizeDy) {
  // 标题栏拖动（Req 2）：从 (200,200) 按下，移动 (dragDx,dragDy) 后释放。
  pointer("pointerdown", titlebarOf(inst), 200, 200);
  pointer("pointermove", document, 200 + dragDx, 200 + dragDy);
  pointer("pointerup", document, 200 + dragDx, 200 + dragDy);
  // se 角调整尺寸（Req 19）：从 (400,400) 按下，移动 (resizeDx,resizeDy) 后释放。
  pointer("pointerdown", handle(inst, "se"), 400, 400);
  pointer("pointermove", document, 400 + resizeDx, 400 + resizeDy);
  pointer("pointerup", document, 400 + resizeDx, 400 + resizeDy);
}

describe("WindowManager maximize/restore roundtrip + maximized geometry lock (Property 9)", () => {
  it("restore returns the window to EXACTLY its pre-maximize rect for any prior move/resize (Req 22.2/22.3)", () => {
    fc.assert(
      fc.property(
        fc.record({
          appId: fc.constantFrom(...MAXIMIZABLE_IDS),
          deskW: fc.integer({ min: 400, max: 2560 }),
          deskH: fc.integer({ min: 400, max: 1600 }),
          dragDx: fc.integer({ min: -150, max: 400 }),
          dragDy: fc.integer({ min: -100, max: 300 }),
          resizeDx: fc.integer({ min: -600, max: 600 }),
          resizeDy: fc.integer({ min: -600, max: 600 }),
        }),
        ({ appId, deskW, deskH, dragDx, dragDy, resizeDx, resizeDy }) => {
          const wm = makeWM(deskW, deskH);
          const inst = wm.openOrFocus(appId);

          // 随机移动/缩放，得到一个随机的最大化前矩形。
          applyRandomMove(inst, dragDx, dragDy, resizeDx, resizeDy);
          const preRect = { ...inst.rect };

          wm.toggleMaximize(inst.instanceId); // 最大化
          // 最大化态铺满工作区、保存 restoreRect 为最大化前矩形（Req 22.2）。
          expect(inst.maximized).toBe(true);
          expect(inst.restoreRect).toEqual(preRect);

          wm.toggleMaximize(inst.instanceId); // 还原
          // 精确回到最大化前矩形（Req 22.3）。
          expect(inst.maximized).toBe(false);
          expect(inst.rect).toEqual(preRect);
          // 内联样式同步回写。
          expect(inst.el.style.left).toBe(`${preRect.left}px`);
          expect(inst.el.style.top).toBe(`${preRect.top}px`);
          expect(inst.el.style.width).toBe(`${preRect.width}px`);
          expect(inst.el.style.height).toBe(`${preRect.height}px`);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("locks geometry while maximized: arbitrary drags and resizes never change the rect (Req 22.4)", () => {
    fc.assert(
      fc.property(
        fc.record({
          appId: fc.constantFrom(...MAXIMIZABLE_IDS),
          deskW: fc.integer({ min: 400, max: 2560 }),
          deskH: fc.integer({ min: 400, max: 1600 }),
          // 先随机移动/缩放，使最大化前矩形随机（不影响最大化态的锁定断言）。
          dragDx: fc.integer({ min: -150, max: 400 }),
          dragDy: fc.integer({ min: -100, max: 300 }),
          resizeDx: fc.integer({ min: -600, max: 600 }),
          resizeDy: fc.integer({ min: -600, max: 600 }),
          // 最大化态下尝试施加的拖动/调整尺寸位移。
          lockDragDx: fc.integer({ min: -500, max: 500 }),
          lockDragDy: fc.integer({ min: -500, max: 500 }),
          lockResizeDx: fc.integer({ min: -500, max: 500 }),
          lockResizeDy: fc.integer({ min: -500, max: 500 }),
        }),
        (p) => {
          const wm = makeWM(p.deskW, p.deskH);
          const inst = wm.openOrFocus(p.appId);
          applyRandomMove(inst, p.dragDx, p.dragDy, p.resizeDx, p.resizeDy);

          wm.toggleMaximize(inst.instanceId); // 最大化
          const maxRect = { ...inst.rect };

          // 最大化态下尝试拖动标题栏——矩形不应改变（Req 22.4）。
          pointer("pointerdown", titlebarOf(inst), 200, 200);
          pointer("pointermove", document, 200 + p.lockDragDx, 200 + p.lockDragDy);
          pointer("pointerup", document, 200 + p.lockDragDx, 200 + p.lockDragDy);
          expect(inst.rect).toEqual(maxRect);

          // 最大化态下尝试调整尺寸——矩形不应改变（Req 22.4）。
          pointer("pointerdown", handle(inst, "se"), 400, 400);
          pointer("pointermove", document, 400 + p.lockResizeDx, 400 + p.lockResizeDy);
          pointer("pointerup", document, 400 + p.lockResizeDx, 400 + p.lockResizeDy);
          expect(inst.rect).toEqual(maxRect);
        }
      ),
      { numRuns: 200 }
    );
  });
});
