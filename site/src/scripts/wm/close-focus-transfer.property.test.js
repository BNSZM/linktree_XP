// Feature: xp-desktop-window-manager, Property 3: 关闭后实例与按钮完整移除且焦点正确转移
//
// Property 3: 关闭后实例与按钮完整移除且焦点正确转移
// 对任意一组已打开的窗口，关闭任意窗口后该窗口的 DOM 与其 Task_Button 均不
// 存在（且实例从实例表移除）；若被关闭者为聚焦窗口且仍存在可见窗口，则焦点
// 转移到剩余「可见」窗口中 z-index 最高者（最小化窗口被排除）。
//
// Validates: Requirements 5.1, 5.2, 5.3
//
// The test drives the real WindowManager: it opens a random subset of the
// registered windows, then applies a random operation sequence that closes
// windows in arbitrary order, interleaving minimize/focus to exercise the
// "minimized windows are excluded from focus transfer" rule. After every close
// it asserts the three universal invariants below.

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

// All windows currently wearing the active-titlebar class.
function activeInstances(wm) {
  return [...wm.getInstances().values()].filter((i) =>
    i.el.classList.contains("is-active")
  );
}

// Arbitrary: a non-empty subset of distinct window types to open.
const windowSetArb = fc.subarray(APP_IDS, { minLength: 1 });

// Arbitrary: an operation step. `kind` is weighted toward "close" (the focus of
// this property) while still interleaving minimize/focus to vary the visible /
// minimized partition and the focused window. `pick` selects the target (by
// index, taken modulo the live-window count at runtime).
const opStepArb = fc.record({
  kind: fc.constantFrom("close", "close", "close", "minimize", "focus"),
  pick: fc.nat({ max: 1000 }),
});
const opSequenceArb = fc.array(opStepArb, { minLength: 1, maxLength: 40 });

describe("Property 3: 关闭后实例与按钮完整移除且焦点正确转移", () => {
  let desktopEl;
  let taskbarEl;
  let templateEl;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("after closing any window its DOM + Task_Button are gone and focus transfers to the highest-z visible window", () => {
    fc.assert(
      fc.property(windowSetArb, opSequenceArb, (appIds, ops) => {
        // Fresh desktop + taskbar + template per run for full isolation.
        document.body.innerHTML = "";
        desktopEl = document.createElement("div");
        document.body.appendChild(desktopEl);
        taskbarEl = document.createElement("div");
        document.body.appendChild(taskbarEl);
        templateEl = buildTemplate();
        document.body.appendChild(templateEl);

        const wm = createWindowManager({
          desktopEl,
          taskbarEl,
          templateEl,
          registry: APP_REGISTRY,
        });
        wm.init(); // binds capture-phase pointerdown; auto-opens Main (non-mobile)

        // Open the random window set (each single-instance → one window each).
        appIds.forEach((id) => wm.openOrFocus(id));

        for (const op of ops) {
          const live = [...wm.getInstances().values()];
          if (live.length === 0) break;

          if (op.kind === "minimize") {
            const visible = live.filter((i) => i.state === "visible");
            if (visible.length === 0) continue;
            wm.minimize(visible[op.pick % visible.length].instanceId);
            continue;
          }

          if (op.kind === "focus") {
            const visible = live.filter((i) => i.state === "visible");
            if (visible.length === 0) continue;
            wm.focus(visible[op.pick % visible.length].instanceId);
            continue;
          }

          // ── close ──────────────────────────────────────────────────────
          const target = live[op.pick % live.length];
          const focusedBefore = wm.getFocusedInstance();
          const wasFocused = focusedBefore === target;

          // Independently compute the expected new focus per Req 5.3: the
          // remaining VISIBLE window with the highest z-index (minimized
          // windows excluded). z-indices are unique (monotonic ++zSeq), so the
          // maximum is unambiguous.
          let expectedFocus;
          if (wasFocused) {
            const remainingVisible = live.filter(
              (i) => i !== target && i.state === "visible"
            );
            if (remainingVisible.length > 0) {
              expectedFocus = remainingVisible.reduce((best, i) =>
                i.z > best.z ? i : best
              );
            }
          }

          // Capture DOM handles before close so we can assert removal.
          const el = target.el;
          const btn = target.taskButtonEl;
          const id = target.instanceId;

          wm.close(id);

          // Req 5.1 / 5.2: window DOM and Task_Button removed; instance gone.
          expect(wm.getInstances().has(id)).toBe(false);
          expect(wm.findInstanceByAppId(target.appId)).toBeUndefined();
          expect(desktopEl.contains(el)).toBe(false);
          expect(document.body.contains(el)).toBe(false);
          if (btn) {
            expect(taskbarEl.contains(btn)).toBe(false);
            expect(document.body.contains(btn)).toBe(false);
          }

          // Req 5.3: focus transfer only when the closed window was focused.
          if (wasFocused) {
            if (expectedFocus) {
              expect(wm.getFocusedInstance()).toBe(expectedFocus);
              // it is visible and strictly the highest-z among remaining visible
              const visibleNow = [...wm.getInstances().values()].filter(
                (i) => i.state === "visible"
              );
              expect(expectedFocus.state).toBe("visible");
              for (const v of visibleNow) {
                if (v !== expectedFocus) {
                  expect(expectedFocus.z).toBeGreaterThan(v.z);
                }
              }
              // exactly one active titlebar, and it is the new focused window
              expect(activeInstances(wm)).toEqual([expectedFocus]);
            } else {
              // no visible windows remain → nothing is focused
              expect(wm.getFocusedInstance()).toBeUndefined();
              expect(activeInstances(wm).length).toBe(0);
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
