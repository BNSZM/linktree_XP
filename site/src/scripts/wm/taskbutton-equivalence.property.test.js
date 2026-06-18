// Feature: xp-desktop-window-manager, Property 2: Task_Button 活动态等价于"可见且聚焦"
//
// 对任意窗口集合与任意 Task_Button 点击序列（并可交错窗口内 pointerdown 聚焦），
// 断言每个窗口的 Task_Button 处于活动态当且仅当该窗口可见且为当前聚焦窗口。
// 点击规则（可见且聚焦→最小化、隐藏→还原并聚焦、可见未聚焦→聚焦）在任意序列下
// 保持该等价关系，且任意时刻至多一个活动 Task_Button。
//
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
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

// Minimal i18n stub — title resolution is irrelevant to the active-state equivalence.
const i18nStub = {
  S: (k) => k,
  getCurrentLang: () => "zh",
};

const ACTIVE_CLASS = "xp-task-btn--active";
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

// A window is "visible" when its instance state is visible and its DOM is not
// hidden — mirrors the manager's showInstance() / minimize() effects.
function isVisible(inst) {
  return (
    inst.state === "visible" &&
    inst.el.style.display !== "none" &&
    inst.el.hidden !== true
  );
}

function isActiveButton(inst) {
  return (
    !!inst.taskButtonEl && inst.taskButtonEl.classList.contains(ACTIVE_CLASS)
  );
}

// Dispatches a capture-phase pointerdown from inside a window, mirroring a real
// click landing anywhere inside the window (drives click-to-focus, Req 3 ↔ Req 4).
function pointerDownOn(el) {
  const ev = new window.PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(ev);
}

// The core invariant: for EVERY live window, its Task_Button is active iff the
// window is visible AND is the currently focused window. Equivalently, at most
// one button is active at any time (Req 4.1–4.5, the Req 3 ↔ Req 4 bridge).
function assertEquivalence(wm) {
  const focused = wm.getFocusedInstance();
  let activeCount = 0;
  for (const inst of wm.getInstances().values()) {
    const expected = isVisible(inst) && focused === inst;
    expect(isActiveButton(inst)).toBe(expected);
    if (isActiveButton(inst)) activeCount += 1;
  }
  // At most one active Task_Button at any time (Req 3.4 ↔ Req 4).
  expect(activeCount).toBeLessThanOrEqual(1);
}

// Each command operates on a slot index into the set of opened windows. Using
// indices keeps every command targeting an actually-open window so we exercise
// the real click rules rather than no-ops.
const commandArb = fc.record({
  // "taskclick" — click the window's Task_Button (the action under test).
  // "pointerdown" — focus the window via a pointerdown anywhere inside it.
  op: fc.constantFrom("taskclick", "pointerdown"),
  slot: fc.nat(),
});
const sequenceArb = fc.array(commandArb, { minLength: 1, maxLength: 40 });

// A non-empty random subset of distinct appIds to open up front.
const openSetArb = fc
  .uniqueArray(fc.constantFrom(...APP_IDS), { minLength: 1, maxLength: APP_IDS.length })
  .map((ids) => ids);

describe("WindowManager Task_Button active-state equivalence (Property 2)", () => {
  it("each Task_Button is active iff its window is visible AND focused, across any click sequence", () => {
    fc.assert(
      fc.property(openSetArb, sequenceArb, (openIds, commands) => {
        const wm = makeWM();
        wm.init(); // binds the capture-phase pointerdown focus delegate on desktopEl

        // Open a random set of windows — each gets a Task_Button (Req 4.1).
        const opened = openIds.map((id) => wm.openOrFocus(id));

        // Every opened window has a Task_Button displaying its title (Req 4.1/4.5).
        for (const inst of opened) {
          expect(inst.taskButtonEl).toBeTruthy();
          expect(inst.taskButtonEl.parentNode).toBe(wm.taskbarEl);
        }

        // Invariant holds immediately after opening (newest is visible+focused).
        assertEquivalence(wm);

        for (const cmd of commands) {
          const target = opened[cmd.slot % opened.length];

          if (cmd.op === "taskclick") {
            // Click the Task_Button — applies the minimize/restore/focus rules
            // (Req 4.2/4.3/4.4).
            target.taskButtonEl.click();
          } else {
            // pointerdown focus only affects visible windows (a hidden window
            // is display:none and cannot receive the event in practice).
            if (isVisible(target)) {
              pointerDownOn(target.el.querySelector(".xp-win-body") || target.el);
            }
          }

          // The equivalence must hold after EVERY action (Req 4).
          assertEquivalence(wm);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("the three click rules each preserve the equivalence (Req 4.2/4.3/4.4)", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...APP_IDS), { minLength: 2, maxLength: 4 }),
        (openIds) => {
          const wm = makeWM();
          wm.init();
          const opened = openIds.map((id) => wm.openOrFocus(id));
          const focused = wm.getFocusedInstance();

          // Rule 4.2: clicking a visible+focused window's button minimizes it
          // and deactivates the button.
          focused.taskButtonEl.click();
          expect(focused.state).toBe("minimized");
          expect(isActiveButton(focused)).toBe(false);
          assertEquivalence(wm);

          // Rule 4.3: clicking a hidden window's button shows + focuses +
          // activates it.
          focused.taskButtonEl.click();
          expect(focused.state).toBe("visible");
          expect(wm.getFocusedInstance()).toBe(focused);
          expect(isActiveButton(focused)).toBe(true);
          assertEquivalence(wm);

          // Rule 4.4: clicking a visible but unfocused window's button focuses
          // and activates it (without minimizing).
          const other = opened.find((i) => i !== focused);
          // Ensure `other` is visible and not currently focused.
          if (other.state !== "visible") wm.restore(other.instanceId);
          wm.focus(focused.instanceId);
          other.taskButtonEl.click();
          expect(other.state).toBe("visible");
          expect(wm.getFocusedInstance()).toBe(other);
          expect(isActiveButton(other)).toBe(true);
          expect(isActiveButton(focused)).toBe(false);
          assertEquivalence(wm);
        }
      ),
      { numRuns: 200 }
    );
  });
});
