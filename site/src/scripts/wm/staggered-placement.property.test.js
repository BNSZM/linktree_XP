// Feature: xp-desktop-window-manager, Property 4: 新窗口错落且落在可见工作区内
//
// 对任意连续打开的窗口数量 N（随机桌面尺寸 + 随机窗口类型），断言：
//   - 相邻新窗口的初始位置不与前一窗口完全重合（错落摆放，Req 6.1）
//   - 每个窗口的矩形落在可见桌面工作区内（桌面减去底部任务栏），其左上角
//     非负且不超过「工作区减去可触及边距」，从而标题栏始终可被指针触及（Req 6.2）
//
// 连续打开通过「关闭 + 重开同一应用」实现：窗口尺寸保持不变，仅 openCount
// 推进，使每次摆放只有错落偏移在变化——精确刻画错落语义。
//
// Validates: Requirements 6.1, 6.2
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createWindowManager } from "./window-manager.js";
import { APP_REGISTRY, getAppDefinition } from "./registry.js";

// 与 window-manager.js 中错落/工作区常量保持一致（用于推导期望边界）。
const TASKBAR_HEIGHT = 30; // 底部任务栏高度，从工作区中扣除
const TITLEBAR_REACH = 30; // 至少保留可被指针触及的窗口边距（Req 6.2）

const APP_IDS = APP_REGISTRY.map((app) => app.id);

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

// 标题解析与摆放无关，使用最小桩。
const i18nStub = { S: (k) => k, getCurrentLang: () => "zh" };

// happy-dom 将 clientWidth/Height 报告为 0，因此固定确定性桌面尺寸。
function withSize(el, w, h) {
  Object.defineProperty(el, "clientWidth", { value: w, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: h, configurable: true });
  return el;
}

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

// 连续打开同一应用 N 次（关闭后重开），收集每次的初始矩形位置。
function placementsFor(wm, appId, n) {
  const rects = [];
  for (let i = 0; i < n; i++) {
    const inst = wm.openOrFocus(appId);
    rects.push({ ...inst.rect });
    wm.close(inst.instanceId); // 关闭后重开：尺寸不变，仅推进 openCount
  }
  return rects;
}

// 断言单个矩形落在可见工作区内且标题栏可触及（Req 6.2）。
// .xp-desktop 已通过 CSS bottom: 30px 预留了任务栏高度，deskH 即为可用高度。
function expectInsideWorkArea(rect, deskW, deskH) {
  const workH = deskH;
  const maxLeft = Math.max(0, deskW - TITLEBAR_REACH);
  const maxTop = Math.max(0, workH - TITLEBAR_REACH);
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.left).toBeLessThanOrEqual(maxLeft);
  expect(rect.top).toBeLessThanOrEqual(maxTop);
}

describe("WindowManager staggered placement (Property 4)", () => {
  it("consecutive windows are staggered (never identical) and stay inside the visible work area", () => {
    // 桌面尺寸生成为「窗口尺寸 + 余量」，确保窗口可容纳且留有错落空间，
    // 使相邻窗口的偏移不会因钳制而塌缩到同一位置（Req 6.1 的有意义区间）。
    fc.assert(
      fc.property(
        fc.record({
          appId: fc.constantFrom(...APP_IDS),
          extraW: fc.integer({ min: 0, max: 1200 }),
          extraH: fc.integer({ min: 0, max: 1200 }),
          n: fc.integer({ min: 2, max: 15 }),
        }),
        ({ appId, extraW, extraH, n }) => {
          const { w, h } = getAppDefinition(appId).defaultSize;
          // workW = deskW >= w，workH = deskH - 30 >= h —— 窗口完整容纳并留余量。
          const deskW = w + extraW;
          const deskH = h + TASKBAR_HEIGHT + extraH;

          const wm = makeWM(deskW, deskH);
          const rects = placementsFor(wm, appId, n);

          for (let i = 0; i < rects.length; i++) {
            // 每个窗口都落在可见工作区内（Req 6.2）。
            expectInsideWorkArea(rects[i], deskW, deskH);
            // 相邻窗口初始位置不完全重合（Req 6.1）。
            if (i > 0) {
              const prev = rects[i - 1];
              const cur = rects[i];
              const identical = prev.left === cur.left && prev.top === cur.top;
              expect(identical).toBe(false);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("every window stays inside the work area for ANY desktop size, even tiny or oversized (Req 6.2)", () => {
    // 不约束桌面尺寸（含极小、窗口大于桌面等极端情形）：错落偏移经钳制后
    // 每个窗口仍恒落在可见工作区内，标题栏可触及——边界不变式对任意输入成立。
    fc.assert(
      fc.property(
        fc.record({
          appId: fc.constantFrom(...APP_IDS),
          deskW: fc.integer({ min: 1, max: 2560 }),
          deskH: fc.integer({ min: 1, max: 1600 }),
          n: fc.integer({ min: 1, max: 15 }),
        }),
        ({ appId, deskW, deskH, n }) => {
          const wm = makeWM(deskW, deskH);
          const rects = placementsFor(wm, appId, n);
          for (const rect of rects) {
            expectInsideWorkArea(rect, deskW, deskH);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
