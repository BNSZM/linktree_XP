// Feature: xp-desktop-window-manager, Property 5: 单实例与打开或聚焦语义
//
// 对任意 openOrFocus 调用序列（随机 appId，并可交错最小化），断言：
//   - 每个单实例 appId 在任意时刻至多存在一个实例（不创建副本）
//   - 对已存在窗口的重复触发不创建副本，而是使其变为可见且聚焦
//     （已最小化者先还原后聚焦）
//
// Validates: Requirements 7.1, 7.2, 7.3
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createWindowManager } from "./window-manager.js";
import { APP_REGISTRY } from "./registry.js";

// Builds a window template element mirroring components/XPWindow.astro so the
// WindowManager can clone it under happy-dom (same shape as window-manager.test.js).
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

// Minimal i18n stub — title resolution is irrelevant to open-or-focus semantics.
const i18nStub = {
  S: (k) => k,
  getCurrentLang: () => "zh",
};

// All registry apps are declared single-instance (Req 7.3), so every id is a
// valid target for the single-instance / open-or-focus invariants.
const APP_IDS = APP_REGISTRY.map((app) => app.id);

// Fresh DOM scaffolding for each property run (isolated WindowManager state).
function setupDom() {
  document.body.innerHTML = "";
  const desktopEl = document.createElement("div");
  document.body.appendChild(desktopEl);
  const taskbarEl = document.createElement("div");
  document.body.appendChild(taskbarEl);
  const templateEl = buildTemplate();
  document.body.appendChild(templateEl);
  return { desktopEl, taskbarEl, templateEl };
}

function makeWM() {
  const { desktopEl, taskbarEl, templateEl } = setupDom();
  return createWindowManager({
    desktopEl,
    taskbarEl,
    templateEl,
    registry: APP_REGISTRY,
    i18n: i18nStub,
  });
}

// A window counts as "visible" when its instance state is visible and its DOM
// is not hidden — mirrors the manager's showInstance() / minimize() effects.
function isVisible(inst) {
  return (
    inst.state === "visible" &&
    inst.el.style.display !== "none" &&
    inst.el.hidden !== true
  );
}

// Counts live instances grouped by appId.
function instanceCountsByApp(wm) {
  const counts = new Map();
  for (const inst of wm.getInstances().values()) {
    counts.set(inst.appId, (counts.get(inst.appId) || 0) + 1);
  }
  return counts;
}

// A command sequence: open(appId) or minimize(appId), random ids, interleaved.
const commandArb = fc.oneof(
  fc.record({ op: fc.constant("open"), appId: fc.constantFrom(...APP_IDS) }),
  fc.record({ op: fc.constant("minimize"), appId: fc.constantFrom(...APP_IDS) })
);
const sequenceArb = fc.array(commandArb, { minLength: 1, maxLength: 40 });

describe("WindowManager open-or-focus semantics (Property 5)", () => {
  it("each single-instance appId has at most one instance; repeat triggers focus (restoring) without duplicating", () => {
    fc.assert(
      fc.property(sequenceArb, (commands) => {
        const wm = makeWM();

        for (const cmd of commands) {
          if (cmd.op === "open") {
            const before = wm.findInstanceByAppId(cmd.appId);
            const inst = wm.openOrFocus(cmd.appId);

            // Repeat trigger on an existing window must NOT create a copy —
            // the same instance is returned (Req 7.1/7.3).
            if (before) {
              expect(inst).toBe(before);
            }

            // After openOrFocus the target window is visible (restored if it
            // had been minimized, Req 7.2) and is the focused/active window
            // (Req 7.1).
            expect(isVisible(inst)).toBe(true);
            expect(wm.getFocusedInstance()).toBe(inst);
            expect(inst.el.classList.contains("is-active")).toBe(true);
          } else {
            // Minimize an existing visible window to exercise the restore path.
            const existing = wm.findInstanceByAppId(cmd.appId);
            if (existing && existing.state === "visible") {
              wm.minimize(existing.instanceId);
              expect(existing.state).toBe("minimized");
            }
          }

          // Invariant after EVERY command: at most one instance per appId
          // (single-instance, Req 7.3).
          for (const count of instanceCountsByApp(wm).values()) {
            expect(count).toBeLessThanOrEqual(1);
          }
        }

        // Total live instances never exceed the number of distinct appIds
        // (no duplicates accumulate over the whole sequence).
        expect(wm.getInstances().size).toBeLessThanOrEqual(APP_IDS.length);
      }),
      { numRuns: 200 }
    );
  });

  it("re-opening a minimized window restores and focuses the same instance (Req 7.2)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...APP_IDS), (appId) => {
        const wm = makeWM();

        const first = wm.openOrFocus(appId);
        wm.minimize(first.instanceId);
        expect(first.state).toBe("minimized");
        expect(isVisible(first)).toBe(false);

        const again = wm.openOrFocus(appId);

        // No duplicate — same instance restored, visible and focused.
        expect(again).toBe(first);
        expect(wm.findInstanceByAppId(appId)).toBe(first);
        expect(isVisible(again)).toBe(true);
        expect(wm.getFocusedInstance()).toBe(again);
        expect(again.el.classList.contains("is-active")).toBe(true);
        expect(wm.getInstances().size).toBe(1);
      }),
      { numRuns: 200 }
    );
  });
});
