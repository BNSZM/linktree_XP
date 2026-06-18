// Feature: xp-desktop-window-manager, Property 7: 注册任意合法 App_Definition 自动获得标准窗口行为
//
// Property 7: 注册任意合法 App_Definition 自动获得标准窗口行为
// 对任意一组合法的 App_Definition，仅通过 wm.register 注册（无需改动核心窗口
// 管理逻辑），随后 openOrFocus 打开它们后，每个窗口都应「自动」获得一致的标准
// 窗口行为，而无需为该窗口编写任何专门代码：
//   - 拥有 Task_Button（提供 taskbarEl 时打开即创建，显示标题）
//   - 标准窗口外壳（可拖动的标题栏表面、可关闭/最小化/最大化控件）
//   - 可聚焦：窗口内任意位置 pointerdown 使其置顶（z-index 严格最大）且成为
//     唯一活动窗口
//   - 可经 Task_Button / API 最小化与还原
//   - 遵循「打开或聚焦」语义：单实例窗口重复打开聚焦既有实例而非创建副本
//   - 由 App_Definition 数据驱动派生外壳：resizable=false 不挂 resize 把手、
//     maximizable=false 隐藏最大化按钮
//
// Validates: Requirements 18.1, 18.2, 18.3, 18.5
//
// The test drives the REAL WindowManager: it registers a random set of valid,
// previously-unknown App_Definitions into a fresh manager (no app-specific
// code), opens them via openOrFocus, then asserts the standard behaviors above
// hold automatically for every one of them.

import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { createWindowManager } from "./window-manager.js";

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

// Arbitrary: sensible width/height pair where defaultSize >= minSize.
const sizeArb = fc
  .record({
    minW: fc.integer({ min: 120, max: 400 }),
    minH: fc.integer({ min: 120, max: 400 }),
    extraW: fc.integer({ min: 0, max: 400 }),
    extraH: fc.integer({ min: 0, max: 400 }),
  })
  .map(({ minW, minH, extraW, extraH }) => ({
    minSize: { w: minW, h: minH },
    defaultSize: { w: minW + extraW, h: minH + extraH },
  }));

// Arbitrary: the variable fields of a valid App_Definition. The id is assigned
// by index later to guarantee uniqueness across the registered set.
const appSpecArb = fc.record({
  titleKey: fc.string({ minLength: 1, maxLength: 24 }),
  icon: fc.constantFrom("👤", "💬", "📄", "📝", "🖥️", "📁", "⚙️", "🚀", "🎮", ""),
  resizable: fc.boolean(),
  maximizable: fc.boolean(),
  // includes the four known kinds plus a future/unknown kind (Req 18.4)
  kind: fc.constantFrom(
    "main-card",
    "chat",
    "pdf-iframe",
    "decorative",
    "notepad",
    "embed-future"
  ),
  size: sizeArb,
  desktopIcon: fc.boolean(),
  startMenu: fc.constantFrom("left", "right", null),
  mainWindowAction: fc.boolean(),
  mobile: fc.constantFrom("fullscreen", "dialog", "newtab", "unavailable"),
});

// Arbitrary: a non-empty set of valid, unique App_Definitions. Every entry is
// single-instance (matching this design, Req 7.3) with a guaranteed-unique id.
const appRegistryArb = fc
  .array(appSpecArb, { minLength: 1, maxLength: 6 })
  .map((specs) =>
    specs.map((s, i) => ({
      id: `gen-app-${i}`,
      titleKey: s.titleKey,
      icon: s.icon,
      singleInstance: true,
      resizable: s.resizable,
      maximizable: s.maximizable,
      defaultSize: s.size.defaultSize,
      minSize: s.size.minSize,
      content: { kind: s.kind },
      launch: {
        desktopIcon: s.desktopIcon,
        startMenu: s.startMenu,
        mainWindowAction: s.mainWindowAction,
      },
      mobile: { behavior: s.mobile },
    }))
  );

describe("Property 7: 注册任意合法 App_Definition 自动获得标准窗口行为", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("any registered valid App_Definition automatically gains standard window behavior", () => {
    fc.assert(
      fc.property(appRegistryArb, (appDefs) => {
        // Fresh desktop + taskbar + template per run for full isolation.
        document.body.innerHTML = "";
        const desktopEl = document.createElement("div");
        document.body.appendChild(desktopEl);
        const taskbarEl = document.createElement("div");
        document.body.appendChild(taskbarEl);
        const templateEl = buildTemplate();
        document.body.appendChild(templateEl);

        // Start from an EMPTY manager — no app-specific knowledge baked in.
        // isMobile:true keeps init() from auto-opening the (here unregistered)
        // Main_Window while still binding the capture-phase pointerdown delegate.
        const wm = createWindowManager({
          desktopEl,
          taskbarEl,
          templateEl,
          isMobile: () => true,
        });
        wm.init(); // binds the capture-phase pointerdown delegate on desktopEl

        // Register every generated definition purely via the public register
        // API (Req 18.1: register without modifying core logic).
        for (const def of appDefs) wm.register(def);

        // Open each registered window via the single unified entry point
        // (Req 18.5: one registry resolves all launch sources).
        const opened = appDefs.map((def) => wm.openOrFocus(def.id));

        for (let i = 0; i < appDefs.length; i++) {
          const def = appDefs[i];
          const inst = opened[i];

          // ── Instantiated & mounted into the desktop container ──
          expect(inst).toBeTruthy();
          expect(inst.appId).toBe(def.id);
          expect(inst.el.parentNode).toBe(desktopEl);
          expect(inst.state).toBe("visible");

          // ── Standard window chrome derived automatically from the template ──
          // draggable titlebar surface (drag handling wired in later tasks, but
          // the affordance is provided to every registered window)
          expect(inst.el.querySelector(".xp-win-titlebar")).toBeTruthy();
          // closable / minimizable controls present for every window
          expect(inst.el.querySelector(".xp-win-close")).toBeTruthy();
          expect(inst.el.querySelector(".xp-win-min")).toBeTruthy();

          // ── Data-driven chrome (Req 18.2 standard behavior set) ──
          // resizable=false → no resize handles; resizable=true → all 8 (Req 19.6)
          expect(inst.el.querySelectorAll(".xp-rz").length).toBe(
            def.resizable ? 8 : 0
          );
          // maximizable=false → maximize button hidden via .no-max (Req 22.5)
          expect(inst.el.classList.contains("no-max")).toBe(!def.maximizable);

          // ── Task_Button created automatically on open (Req 18.2 ↔ Req 4.1) ──
          expect(inst.taskButtonEl).toBeTruthy();
          expect(inst.taskButtonEl.tagName).toBe("BUTTON");
          expect(inst.taskButtonEl.parentNode).toBe(taskbarEl);
        }

        // ── Focusable: pointerdown anywhere focuses + stacks on top (Req 3) ──
        for (const inst of opened) {
          pointerDownOn(inst.el.querySelector(".xp-win-body") || inst.el);
          // sole active window
          expect(activeInstances(wm)).toEqual([inst]);
          expect(wm.getFocusedInstance()).toBe(inst);
          // strictly highest z-index among all open windows
          const others = [...wm.getInstances().values()].filter((x) => x !== inst);
          for (const other of others) {
            expect(inst.z).toBeGreaterThan(other.z);
          }
        }

        // ── Minimize / restore via Task_Button works for every window (Req 4) ──
        for (const inst of opened) {
          // focus it first so its Task_Button click minimizes (visible+focused)
          wm.focus(inst.instanceId);
          inst.taskButtonEl.click(); // → minimize
          expect(inst.state).toBe("minimized");
          expect(inst.el.hidden).toBe(true);
          expect(
            inst.taskButtonEl.classList.contains("xp-task-btn--active")
          ).toBe(false);

          inst.taskButtonEl.click(); // → restore + focus
          expect(inst.state).toBe("visible");
          expect(inst.el.hidden).toBe(false);
          expect(wm.getFocusedInstance()).toBe(inst);
          expect(
            inst.taskButtonEl.classList.contains("xp-task-btn--active")
          ).toBe(true);
        }

        // ── Open-or-focus semantics: re-open never duplicates (Req 7.1/18.5) ──
        const countBefore = wm.getInstances().size;
        const domBefore = desktopEl.querySelectorAll(".xp-win").length;
        for (let i = 0; i < appDefs.length; i++) {
          const again = wm.openOrFocus(appDefs[i].id);
          expect(again).toBe(opened[i]); // same instance, no copy
          // re-opening focuses the existing window
          expect(wm.getFocusedInstance()).toBe(opened[i]);
        }
        expect(wm.getInstances().size).toBe(countBefore);
        expect(desktopEl.querySelectorAll(".xp-win").length).toBe(domBefore);
      }),
      { numRuns: 100 }
    );
  });
});
