// Feature: xp-desktop-window-manager, Property 8: 最小尺寸约束恒成立
//
// 对任意可调整尺寸窗口与任意调整尺寸拖拽序列（含试图缩到极小的极端负向位移），
// 断言：调整结果的宽与高恒不小于该窗口声明的 minSize（Req 19.4）。
//
// 驱动方式：在 happy-dom 下以合成 PointerEvent 复刻真实交互——对随机把手
// （n/s/e/w/ne/nw/se/sw）pointerdown 启动调整，随后 document 上多次 pointermove
// （随机位移，覆盖将窗口拉到远小于 minSize 的极端尝试），最后 pointerup 结束。
// 每次 pointermove 之后都断言宽高 ≥ minSize；整个序列结束后再次断言，确保约束
// 在任意拖拽序列的每一步都恒成立。
//
// Validates: Requirements 19.1, 19.4, 19.5
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createWindowManager } from "./window-manager.js";
import { APP_REGISTRY, getAppDefinition } from "./registry.js";

// 仅可调整尺寸的窗口参与最小尺寸约束（Main_Window resizable=false，不参与，Req 19.5/19.6）。
const RESIZABLE_APP_IDS = APP_REGISTRY.filter((a) => a.resizable).map((a) => a.id);
const HANDLE_DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

// 调整尺寸的 pointerdown 起始坐标（任意定点；位移相对此点计算）。
const PRESS_X = 1000;
const PRESS_Y = 1000;

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

// 标题解析与尺寸约束无关，使用最小桩。
const i18nStub = { S: (k) => k, getCurrentLang: () => "zh" };

// 每个属性迭代使用全新 DOM 与隔离的 WindowManager 状态。
function makeWM() {
  document.body.innerHTML = "";
  const desktopEl = document.createElement("div");
  document.body.appendChild(desktopEl);
  const taskbarEl = document.createElement("div");
  document.body.appendChild(taskbarEl);
  const templateEl = buildTemplate();
  document.body.appendChild(templateEl);
  const wm = createWindowManager({
    desktopEl,
    taskbarEl,
    templateEl,
    registry: APP_REGISTRY,
    i18n: i18nStub,
  });
  wm.init();
  return wm;
}

// 合成带客户端坐标的 PointerEvent。
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

// 单步调整尺寸拖拽：在指定把手 pointerdown，逐次 pointermove（每次断言 minSize），
// 最后 pointerup 结束。位移相对 pointerdown 点（PRESS_X/Y）。
function applyResizeDrag(inst, dir, moves, min) {
  const h = handle(inst, dir);
  if (!h) return; // 该窗口不含此把手时跳过（理论上 resizable 窗口含全部 8 个）
  pointer("pointerdown", h, PRESS_X, PRESS_Y);
  for (const m of moves) {
    pointer("pointermove", document, PRESS_X + m.dx, PRESS_Y + m.dy);
    // 每一步移动后宽高恒不小于 minSize（Req 19.4）。
    expect(inst.rect.width).toBeGreaterThanOrEqual(min.w);
    expect(inst.rect.height).toBeGreaterThanOrEqual(min.h);
  }
  const last = moves[moves.length - 1] || { dx: 0, dy: 0 };
  pointer("pointerup", document, PRESS_X + last.dx, PRESS_Y + last.dy);
}

describe("WindowManager minimum size constraint (Property 8)", () => {
  it("width and height never drop below minSize across ANY resize drag sequence (Req 19.4)", () => {
    fc.assert(
      fc.property(
        fc.record({
          appId: fc.constantFrom(...RESIZABLE_APP_IDS),
          drags: fc.array(
            fc.record({
              dir: fc.constantFrom(...HANDLE_DIRS),
              // 每次拖拽含 1..6 次移动；位移范围覆盖极端（远超 minSize 的负/正向），
              // 确保包含「试图把窗口缩到极小甚至负尺寸」的尝试。
              moves: fc.array(
                fc.record({
                  dx: fc.integer({ min: -4000, max: 4000 }),
                  dy: fc.integer({ min: -4000, max: 4000 }),
                }),
                { minLength: 1, maxLength: 6 }
              ),
            }),
            { minLength: 1, maxLength: 8 }
          ),
        }),
        ({ appId, drags }) => {
          const wm = makeWM();
          const inst = wm.openOrFocus(appId);
          const min = getAppDefinition(appId).minSize;

          for (const drag of drags) {
            applyResizeDrag(inst, drag.dir, drag.moves, min);
          }

          // 整个拖拽序列结束后，宽高仍恒不小于 minSize（Req 19.4）。
          expect(inst.rect.width).toBeGreaterThanOrEqual(min.w);
          expect(inst.rect.height).toBeGreaterThanOrEqual(min.h);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("dragging far past the minimum on every handle still clamps to minSize (Req 19.1, 19.4)", () => {
    // 针对每个把手单独施加一次「极端缩小」尝试：从压点向使窗口收缩的方向
    // 拉一个巨大位移，断言结果恰好被夹断到 minSize 下界而不会更小。
    fc.assert(
      fc.property(
        fc.record({
          appId: fc.constantFrom(...RESIZABLE_APP_IDS),
          dir: fc.constantFrom(...HANDLE_DIRS),
          magnitude: fc.integer({ min: 2000, max: 8000 }),
        }),
        ({ appId, dir, magnitude }) => {
          const wm = makeWM();
          const inst = wm.openOrFocus(appId);
          const min = getAppDefinition(appId).minSize;

          // 朝收缩方向施加极端位移：east 向左缩（-dx），west 向右缩（+dx），
          // south 向上缩（-dy），north 向下缩（+dy）；角把手组合两者。
          let dx = 0;
          let dy = 0;
          if (dir.includes("e")) dx = -magnitude;
          if (dir.includes("w")) dx = magnitude;
          if (dir.includes("s")) dy = -magnitude;
          if (dir.includes("n")) dy = magnitude;

          applyResizeDrag(inst, dir, [{ dx, dy }], min);

          expect(inst.rect.width).toBeGreaterThanOrEqual(min.w);
          expect(inst.rect.height).toBeGreaterThanOrEqual(min.h);
        }
      ),
      { numRuns: 200 }
    );
  });
});
