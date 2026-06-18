// Feature: xp-desktop-window-manager, Property 1: 聚焦使被点窗口置顶且唯一活动
//
// Property 1: 聚焦使被点窗口置顶且唯一活动
// 对任意一组已打开的窗口与任意聚焦序列，每次聚焦后被聚焦窗口的 z-index 应
// 严格大于其余所有窗口，且任意时刻恰好有一个窗口带活动标题栏外观。
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4
//
// The test drives the real WindowManager: it opens a random subset of the
// registered windows, then applies a random focus sequence — alternating
// between the programmatic wm.focus() API and a synthetic capture-phase
// pointerdown (mirroring a real click landing inside the window). After every
// focus it asserts the two universal invariants below.

import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { createWindowManager } from "./window-manager.js";
import { APP_REGISTRY } from "./registry.js";

// Every registered window type is a valid open target (all single-instance).
const APP_IDS = APP_REGISTRY.map((app) => app.id);

// Builds a window template mirroring components/XPWindow.astro so the
// WindowManager can clone it under happy-dom (matches window-manager.test.js).
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

// Synthesises a capture-phase pointerdown dispatched from inside a window,
// mirroring a real click landing anywhere within it.
function pointerDownOn(el) {
  el.dispatchEvent(
    new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true })
  );
}

// All windows currently wearing the active-titlebar class.
function activeInstances(wm) {
  return [...wm.getInstances().values()].filter((i) =>
    i.el.classList.contains("is-active")
  );
}

// Arbitrary: a non-empty subset of distinct window types to open.
const windowSetArb = fc.subarray(APP_IDS, { minLength: 1 });

// Arbitrary: a focus step — which already-open window to focus (by index,
// taken modulo the open-window count at runtime) and whether to drive it via
// a synthetic pointerdown (true) or the programmatic wm.focus() API (false).
const focusStepArb = fc.record({
  pick: fc.nat({ max: 1000 }),
  viaPointer: fc.boolean(),
});
const focusSequenceArb = fc.array(focusStepArb, { minLength: 1, maxLength: 30 });

describe("Property 1: 聚焦使被点窗口置顶且唯一活动", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("focused window has the strictly-highest z-index and is the sole active titlebar after every focus", () => {
    fc.assert(
      fc.property(windowSetArb, focusSequenceArb, (appIds, sequence) => {
        // Fresh desktop + template per run for full isolation.
        document.body.innerHTML = "";
        const desktopEl = document.createElement("div");
        document.body.appendChild(desktopEl);
        const templateEl = buildTemplate();
        document.body.appendChild(templateEl);

        const wm = createWindowManager({
          desktopEl,
          templateEl,
          registry: APP_REGISTRY,
        });
        wm.init(); // binds the capture-phase pointerdown delegate on desktopEl

        // Open the random window set (each single-instance → one window each).
        const opened = appIds.map((id) => wm.openOrFocus(id));

        // After every focus the two invariants must hold — assert them as a
        // shared helper, including the initial post-open state.
        const assertInvariants = (focused) => {
          const all = [...wm.getInstances().values()];

          // Req 3.4 / 3.2 / 3.3: exactly one window wears the active titlebar,
          // and it is the focused one.
          const active = activeInstances(wm);
          expect(active.length).toBe(1);
          expect(active[0]).toBe(focused);
          expect(wm.getFocusedInstance()).toBe(focused);

          // Req 3.1: focused window's z-index is strictly greater than every
          // other window's z-index.
          const others = all.filter((i) => i !== focused);
          for (const other of others) {
            expect(focused.z).toBeGreaterThan(other.z);
            // the DOM z-index reflects the model value
            expect(Number(focused.el.style.zIndex)).toBeGreaterThan(
              Number(other.el.style.zIndex)
            );
          }
        };

        // Initial state: the last-opened window is focused and on top.
        assertInvariants(opened[opened.length - 1]);

        // Apply the random focus sequence, alternating focus mechanisms.
        for (const step of sequence) {
          const target = opened[step.pick % opened.length];
          if (step.viaPointer) {
            pointerDownOn(target.el.querySelector(".xp-win-body") || target.el);
          } else {
            wm.focus(target.instanceId);
          }
          assertInvariants(target);
        }
      }),
      { numRuns: 100 }
    );
  });
});
