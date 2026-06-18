// Feature: xp-desktop-window-manager, Property 6: 懒实例化——未触发的窗口不存在
//
// Property 6: 懒实例化——未触发的窗口不存在
// 初始化后对任意尚未被触发过的非 Main 窗口 appId，其窗口实例不存在；仅当首次
// 触发（主窗口操作或开始菜单/桌面图标）后才创建实例。初始化时仅 Main_Window
// 被实例化。
//
// Validates: Requirements 8.1, 8.8, 8.9
//
// The test drives the real WindowManager: after wm.init() on a non-mobile
// viewport it asserts ONLY the Main_Window exists and every not-yet-triggered
// non-Main appId has no instance. Then, for a random ordering of a random
// subset of non-Main appIds, it triggers each via openOrFocus one at a time —
// asserting that an appId comes into existence ONLY after its first trigger,
// while every still-untriggered appId remains uninstantiated.

import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { createWindowManager } from "./window-manager.js";
import { APP_REGISTRY } from "./registry.js";

// Every non-Main registered window type — the lazy-instantiation candidates.
const NON_MAIN_APP_IDS = APP_REGISTRY.map((app) => app.id).filter(
  (id) => id !== "main"
);

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

// Builds a fresh, isolated desktop + template + WindowManager per run.
function makeWM() {
  document.body.innerHTML = "";
  const desktopEl = document.createElement("div");
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
    isMobile: () => false,
  });
}

// Arbitrary: a random ordering of a random non-empty subset of non-Main appIds
// to trigger one at a time. shuffledSubarray gives both a random subset AND a
// random trigger order, exercising lazy instantiation across many sequences.
const triggerSequenceArb = fc.shuffledSubarray(NON_MAIN_APP_IDS, {
  minLength: 0,
  maxLength: NON_MAIN_APP_IDS.length,
});

describe("Property 6: 懒实例化——未触发的窗口不存在", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("after init only Main exists; non-Main windows are created only on first trigger", () => {
    fc.assert(
      fc.property(triggerSequenceArb, (triggerOrder) => {
        const wm = makeWM();
        wm.init(); // non-mobile → auto-opens ONLY Main_Window (Req 8.1)

        // Req 8.1 / 8.8: init instantiates exactly one window — Main_Window —
        // and pre-instantiates nothing else.
        expect(wm.getInstances().size).toBe(1);
        expect(wm.findInstanceByAppId("main")).toBeTruthy();

        // Req 8.8 / 8.9: every non-Main appId has NO instance until triggered.
        for (const id of NON_MAIN_APP_IDS) {
          expect(wm.findInstanceByAppId(id)).toBeUndefined();
        }

        // Trigger the chosen non-Main appIds one at a time, asserting lazy
        // creation: an appId exists ONLY after its own first trigger, while
        // every still-untriggered appId remains uninstantiated.
        const triggered = new Set();
        for (const id of triggerOrder) {
          // Before triggering: this appId must not yet exist (Req 8.9).
          expect(wm.findInstanceByAppId(id)).toBeUndefined();

          const inst = wm.openOrFocus(id); // first trigger → lazy instantiate
          triggered.add(id);

          // After triggering: the instance now exists and is mounted.
          expect(inst).toBeTruthy();
          expect(wm.findInstanceByAppId(id)).toBe(inst);

          // Main plus every already-triggered window exist; nothing extra.
          expect(wm.getInstances().size).toBe(1 + triggered.size);

          // Every non-Main appId that has NOT been triggered still has no
          // instance (Req 8.8/8.9).
          for (const other of NON_MAIN_APP_IDS) {
            if (triggered.has(other)) {
              expect(wm.findInstanceByAppId(other)).toBeTruthy();
            } else {
              expect(wm.findInstanceByAppId(other)).toBeUndefined();
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
