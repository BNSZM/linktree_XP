import { describe, it, expect, beforeEach } from "vitest";
import { createWindowManager } from "./window-manager.js";
import { APP_REGISTRY, getAppDefinition } from "./registry.js";

// Builds a window template element mirroring components/XPWindow.astro so the
// WindowManager skeleton can clone it under happy-dom.
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

// Simple i18n stub: returns key-suffix titles so we can assert resolution.
const i18nStub = {
  S: (k) => ({ "windows.mainTitle": "培文的名片", "chat.title": "AI 助手" }[k]),
  getCurrentLang: () => "zh",
};

describe("WindowManager skeleton (task 7.1)", () => {
  let desktopEl;
  let templateEl;

  beforeEach(() => {
    document.body.innerHTML = "";
    desktopEl = document.createElement("div");
    document.body.appendChild(desktopEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  it("registers an App_Definition without creating DOM (lazy)", () => {
    const wm = createWindowManager({ desktopEl, templateEl });
    expect(wm.getInstances().size).toBe(0);

    wm.register(getAppDefinition("main"));
    expect(wm.getAppDefinition("main")).toBeTruthy();
    // registration alone must not instantiate any window
    expect(wm.getInstances().size).toBe(0);
  });

  it("seeds the registry passed to the factory", () => {
    const wm = createWindowManager({ desktopEl, templateEl, registry: APP_REGISTRY });
    expect(wm.getRegistry().size).toBe(APP_REGISTRY.length);
    expect(wm.getAppDefinition("notepad")).toBeTruthy();
  });

  it("rejects registration without an id", () => {
    const wm = createWindowManager({ desktopEl, templateEl });
    expect(() => wm.register({})).toThrow();
  });

  it("clones the template and fills title + icon via i18n", () => {
    const wm = createWindowManager({ desktopEl, templateEl, i18n: i18nStub });
    const inst = wm.instantiate(getAppDefinition("main"));

    expect(inst.el.classList.contains("xp-win")).toBe(true);
    expect(inst.el.querySelector(".xp-win-title").textContent).toBe("培文的名片");
    expect(inst.el.querySelector(".xp-win-title").getAttribute("data-i18n")).toBe(
      "windows.mainTitle"
    );
    expect(inst.el.querySelector(".xp-win-icon").textContent).toBe("👤");
    expect(inst.el.getAttribute("aria-label")).toBe("培文的名片");
  });

  it("falls back to titleKey when i18n cannot resolve", () => {
    const wm = createWindowManager({ desktopEl, templateEl });
    const inst = wm.instantiate(getAppDefinition("deco-mycomputer"));
    expect(inst.el.querySelector(".xp-win-title").textContent).toBe(
      "windows.myComputer"
    );
  });

  it("adds .no-max for non-maximizable windows (Req 22.5)", () => {
    const wm = createWindowManager({ desktopEl, templateEl, i18n: i18nStub });
    const mainInst = wm.instantiate(getAppDefinition("main")); // maximizable: false
    const chatInst = wm.instantiate(getAppDefinition("chat")); // maximizable: true

    expect(mainInst.el.classList.contains("no-max")).toBe(true);
    expect(chatInst.el.classList.contains("no-max")).toBe(false);
  });

  it("strips resize handles for non-resizable windows (Req 19.6)", () => {
    const wm = createWindowManager({ desktopEl, templateEl, i18n: i18nStub });
    const mainInst = wm.instantiate(getAppDefinition("main")); // resizable: false
    const chatInst = wm.instantiate(getAppDefinition("chat")); // resizable: true

    expect(mainInst.el.querySelectorAll(".xp-rz").length).toBe(0);
    expect(chatInst.el.querySelectorAll(".xp-rz").length).toBe(8);
  });

  it("applies defaultSize and records it in the instance rect", () => {
    const wm = createWindowManager({ desktopEl, templateEl, i18n: i18nStub });
    const inst = wm.instantiate(getAppDefinition("chat"));
    expect(inst.el.style.width).toBe("440px");
    expect(inst.el.style.height).toBe("580px");
    expect(inst.rect.width).toBe(440);
    expect(inst.rect.height).toBe(580);
  });

  it("tracks instances and exposes lookup by appId", () => {
    const wm = createWindowManager({ desktopEl, templateEl, i18n: i18nStub });
    const inst = wm.instantiate(getAppDefinition("chat"));
    expect(wm.getInstances().size).toBe(1);
    expect(wm.findInstanceByAppId("chat")).toBe(inst);
    expect(inst.instanceId).toContain("chat#");
  });
});

describe("WindowManager openOrFocus / lazy / init (task 7.2)", () => {
  let desktopEl;
  let templateEl;

  function makeWM(extra = {}) {
    return createWindowManager({
      desktopEl,
      templateEl,
      registry: APP_REGISTRY,
      i18n: i18nStub,
      ...extra,
    });
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    desktopEl = document.createElement("div");
    document.body.appendChild(desktopEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  it("lazily instantiates and mounts a window into desktopEl on first open (Req 8.8/8.9)", () => {
    const wm = makeWM();
    expect(wm.getInstances().size).toBe(0);

    const inst = wm.openOrFocus("chat");
    expect(wm.getInstances().size).toBe(1);
    // mounted into the desktop container
    expect(inst.el.parentNode).toBe(desktopEl);
    expect(desktopEl.querySelectorAll(".xp-win").length).toBe(1);
    expect(inst.state).toBe("visible");
  });

  it("does not create duplicates for single-instance apps — focuses existing (Req 7.1/7.3)", () => {
    const wm = makeWM();
    const first = wm.openOrFocus("chat");
    const firstZ = first.z;
    const again = wm.openOrFocus("chat");

    expect(again).toBe(first); // same instance, no duplicate
    expect(wm.getInstances().size).toBe(1);
    expect(desktopEl.querySelectorAll(".xp-win").length).toBe(1);
    // re-trigger focuses it (z-index raised)
    expect(again.z).toBeGreaterThan(firstZ);
  });

  it("restores and focuses a minimized window instead of duplicating (Req 7.2)", () => {
    const wm = makeWM();
    const inst = wm.openOrFocus("chat");
    // simulate a minimized window (full minimize/restore is task 8.1)
    inst.state = "minimized";
    inst.el.style.display = "none";

    const again = wm.openOrFocus("chat");
    expect(again).toBe(inst);
    expect(again.state).toBe("visible");
    expect(again.el.style.display).toBe("");
    expect(wm.getInstances().size).toBe(1);
  });

  it("focus raises z-index and keeps exactly one active window (Req 3.1-3.4)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad");

    // most recently focused is active and on top
    expect(notepad.el.classList.contains("is-active")).toBe(true);
    expect(chat.el.classList.contains("is-active")).toBe(false);
    expect(notepad.z).toBeGreaterThan(chat.z);
    expect(wm.getFocusedInstance()).toBe(notepad);

    // focusing chat flips active state — still exactly one active
    wm.focus(chat.instanceId);
    expect(chat.el.classList.contains("is-active")).toBe(true);
    expect(notepad.el.classList.contains("is-active")).toBe(false);
    expect(chat.z).toBeGreaterThan(notepad.z);
    const active = [...wm.getInstances().values()].filter((i) =>
      i.el.classList.contains("is-active")
    );
    expect(active.length).toBe(1);
  });

  it("throws on openOrFocus with an unknown appId", () => {
    const wm = makeWM();
    expect(() => wm.openOrFocus("does-not-exist")).toThrow();
  });

  it("init opens ONLY Main_Window on non-mobile (Req 8.1/8.8/8.9)", () => {
    const wm = makeWM({ isMobile: () => false });
    wm.init();

    expect(wm.getInstances().size).toBe(1);
    expect(wm.findInstanceByAppId("main")).toBeTruthy();
    // no other window is pre-instantiated
    expect(wm.findInstanceByAppId("chat")).toBeUndefined();
    expect(wm.findInstanceByAppId("notepad")).toBeUndefined();
    expect(wm.findInstanceByAppId("pdf-overseas")).toBeUndefined();
  });

  it("init auto-opens Main_Window on mobile (全屏名片)", () => {
    const wm = makeWM({ isMobile: () => true });
    wm.init();
    expect(wm.getInstances().size).toBe(1);
  });

  it("init is idempotent (does not open duplicate Main_Window)", () => {
    const wm = makeWM({ isMobile: () => false });
    wm.init();
    wm.init();
    expect(wm.getInstances().size).toBe(1);
  });

  it("non-Main windows remain uninstantiated until first triggered (Req 8.9)", () => {
    const wm = makeWM({ isMobile: () => false });
    wm.init();
    expect(wm.findInstanceByAppId("notepad")).toBeUndefined();
    // first trigger creates the instance
    const np = wm.openOrFocus("notepad");
    expect(np).toBeTruthy();
    expect(wm.findInstanceByAppId("notepad")).toBe(np);
  });
});

describe("WindowManager click-to-focus + z-index stacking (task 7.3)", () => {
  let desktopEl;
  let templateEl;

  function makeWM(extra = {}) {
    return createWindowManager({
      desktopEl,
      templateEl,
      registry: APP_REGISTRY,
      i18n: i18nStub,
      ...extra,
    });
  }

  // Synthesises a capture-phase pointerdown dispatched from a descendant of a
  // window, mirroring a real click landing anywhere inside the window.
  function pointerDownOn(el) {
    const ev = new window.PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev;
  }

  function activeInstances(wm) {
    return [...wm.getInstances().values()].filter((i) =>
      i.el.classList.contains("is-active")
    );
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    desktopEl = document.createElement("div");
    document.body.appendChild(desktopEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  it("pointerdown anywhere in a window focuses it: highest z-index + sole active (Req 3.1-3.4)", () => {
    const wm = makeWM();
    wm.init(); // binds the capture-phase pointerdown delegate on desktopEl

    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad");
    // notepad was opened last → currently focused/active and on top
    expect(notepad.el.classList.contains("is-active")).toBe(true);

    // a pointerdown on the chat body must focus chat
    const chatBody = chat.el.querySelector(".xp-win-body");
    pointerDownOn(chatBody);

    expect(chat.el.classList.contains("is-active")).toBe(true);
    expect(notepad.el.classList.contains("is-active")).toBe(false);
    // chat's z-index is now strictly the highest of all windows
    const maxOtherZ = Math.max(
      ...[...wm.getInstances().values()]
        .filter((i) => i !== chat)
        .map((i) => i.z)
    );
    expect(chat.z).toBeGreaterThan(maxOtherZ);
    // exactly one active window at any time (Req 3.4)
    expect(activeInstances(wm).length).toBe(1);
  });

  it("pointerdown on the titlebar (not just body) also focuses the window", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad");

    pointerDownOn(chat.el.querySelector(".xp-win-titlebar"));
    expect(wm.getFocusedInstance()).toBe(chat);
    expect(chat.z).toBeGreaterThan(notepad.z);
    expect(activeInstances(wm).length).toBe(1);
  });

  it("maintains exactly one active titlebar across an arbitrary click sequence (Req 3.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad");
    const main = wm.openOrFocus("main");

    const order = [chat, notepad, main, chat, main, notepad, chat];
    let prevZ = -Infinity;
    for (const target of order) {
      pointerDownOn(target.el.querySelector(".xp-win-body") || target.el);
      // the clicked window becomes the sole active window
      expect(activeInstances(wm)).toEqual([target]);
      expect(wm.getFocusedInstance()).toBe(target);
      // z-index is monotonically increasing — clicked window is strictly on top
      const others = [...wm.getInstances().values()].filter((i) => i !== target);
      const maxOtherZ = Math.max(...others.map((i) => i.z));
      expect(target.z).toBeGreaterThan(maxOtherZ);
      expect(target.z).toBeGreaterThan(prevZ);
      prevZ = target.z;
    }
  });

  it("ignores pointerdown outside any window (no focus change)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    // pointerdown directly on the desktop background changes nothing
    pointerDownOn(desktopEl);
    expect(wm.getFocusedInstance()).toBe(chat);
    expect(activeInstances(wm).length).toBe(1);
  });
});

describe("WindowManager Task_Button minimize/restore (task 8.1)", () => {
  let desktopEl;
  let taskbarEl;
  let templateEl;

  function makeWM(extra = {}) {
    return createWindowManager({
      desktopEl,
      taskbarEl,
      templateEl,
      registry: APP_REGISTRY,
      i18n: i18nStub,
      ...extra,
    });
  }

  const isActiveBtn = (inst) =>
    inst.taskButtonEl.classList.contains("xp-task-btn--active");

  beforeEach(() => {
    document.body.innerHTML = "";
    desktopEl = document.createElement("div");
    document.body.appendChild(desktopEl);
    taskbarEl = document.createElement("div");
    document.body.appendChild(taskbarEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  it("creates a Task_Button displaying the window title on open (Req 4.1/4.5)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");

    expect(chat.taskButtonEl).toBeTruthy();
    expect(chat.taskButtonEl.parentNode).toBe(taskbarEl);
    // it is a keyboard-focusable/activatable button (Req 16.6)
    expect(chat.taskButtonEl.tagName).toBe("BUTTON");
    // displays the resolved window title
    const label = chat.taskButtonEl.querySelector(".xp-task-label");
    expect(label.textContent).toBe("AI 助手");
    // title syncs with i18n titleKey via data-i18n
    expect(label.getAttribute("data-i18n")).toBe("chat.title");
  });

  it("newly opened window has an active Task_Button (visible AND focused)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    expect(isActiveBtn(chat)).toBe(true);
  });

  it("clicking the Task_Button of a visible+focused window minimizes it and deactivates the button (Req 4.2)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    expect(chat.state).toBe("visible");
    expect(isActiveBtn(chat)).toBe(true);

    chat.taskButtonEl.click();

    expect(chat.state).toBe("minimized");
    expect(chat.el.style.display).toBe("none");
    expect(chat.el.hidden).toBe(true);
    expect(isActiveBtn(chat)).toBe(false);
    expect(chat.el.classList.contains("is-active")).toBe(false);
    expect(wm.getFocusedInstance()).toBeUndefined();
  });

  it("clicking the Task_Button of a hidden window shows + focuses + activates it (Req 4.3)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    chat.taskButtonEl.click(); // minimize
    expect(chat.state).toBe("minimized");

    chat.taskButtonEl.click(); // restore

    expect(chat.state).toBe("visible");
    expect(chat.el.style.display).toBe("");
    expect(chat.el.hidden).toBe(false);
    expect(wm.getFocusedInstance()).toBe(chat);
    expect(isActiveBtn(chat)).toBe(true);
  });

  it("clicking the Task_Button of a visible but unfocused window focuses + activates it (Req 4.4)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad"); // notepad now focused/active
    expect(isActiveBtn(notepad)).toBe(true);
    expect(isActiveBtn(chat)).toBe(false);
    expect(chat.state).toBe("visible");

    chat.taskButtonEl.click(); // visible but not focused → focus it

    expect(chat.state).toBe("visible"); // not minimized
    expect(wm.getFocusedInstance()).toBe(chat);
    expect(isActiveBtn(chat)).toBe(true);
    expect(isActiveBtn(notepad)).toBe(false);
  });

  it("maintains at most one active Task_Button across an arbitrary click sequence (Req 4)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad");
    const main = wm.openOrFocus("main");
    const all = [chat, notepad, main];

    const countActive = () => all.filter(isActiveBtn).length;

    const sequence = [chat, chat, notepad, main, notepad, notepad, chat];
    for (const target of sequence) {
      target.taskButtonEl.click();
      // active Task_Button count is always 0 or 1 — never more (Req 3.4 ↔ Req 4)
      expect(countActive()).toBeLessThanOrEqual(1);
      // a button is active iff its window is visible and focused
      for (const inst of all) {
        const expectActive =
          inst.state === "visible" &&
          wm.getFocusedInstance() === inst;
        expect(isActiveBtn(inst)).toBe(expectActive);
      }
    }
  });

  it("minimize()/restore() API mirror the Task_Button rules", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");

    wm.minimize(chat.instanceId);
    expect(chat.state).toBe("minimized");
    expect(isActiveBtn(chat)).toBe(false);
    expect(wm.getFocusedInstance()).toBeUndefined();

    wm.restore(chat.instanceId);
    expect(chat.state).toBe("visible");
    expect(wm.getFocusedInstance()).toBe(chat);
    expect(isActiveBtn(chat)).toBe(true);
  });

  it("the titlebar minimize control minimizes the window (Req 4.2)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    expect(chat.state).toBe("visible");

    chat.el.querySelector(".xp-win-min").click();

    expect(chat.state).toBe("minimized");
    expect(isActiveBtn(chat)).toBe(false);
  });

  it("openOrFocus on a minimized window restores and re-activates its Task_Button (Req 7.2)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    wm.minimize(chat.instanceId);
    expect(isActiveBtn(chat)).toBe(false);

    const again = wm.openOrFocus("chat");
    expect(again).toBe(chat);
    expect(chat.state).toBe("visible");
    expect(isActiveBtn(chat)).toBe(true);
  });
});

describe("WindowManager close + focus transfer (task 8.2)", () => {
  let desktopEl;
  let taskbarEl;
  let templateEl;

  function makeWM(extra = {}) {
    return createWindowManager({
      desktopEl,
      taskbarEl,
      templateEl,
      registry: APP_REGISTRY,
      i18n: i18nStub,
      ...extra,
    });
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    desktopEl = document.createElement("div");
    document.body.appendChild(desktopEl);
    taskbarEl = document.createElement("div");
    document.body.appendChild(taskbarEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  it("removes the window DOM and its Task_Button on close (Req 5.1/5.2)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    const btn = chat.taskButtonEl;
    expect(desktopEl.querySelectorAll(".xp-win").length).toBe(1);
    expect(taskbarEl.querySelectorAll(".xp-task-btn").length).toBe(1);

    wm.close(chat.instanceId);

    // window DOM gone
    expect(desktopEl.querySelectorAll(".xp-win").length).toBe(0);
    expect(chat.el.parentNode).toBeFalsy();
    // Task_Button gone
    expect(taskbarEl.querySelectorAll(".xp-task-btn").length).toBe(0);
    expect(btn.parentNode).toBeFalsy();
    // instance removed from the map
    expect(wm.getInstances().size).toBe(0);
    expect(wm.findInstanceByAppId("chat")).toBeUndefined();
  });

  it("clears focus when the only window is closed (no visible windows remain)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    expect(wm.getFocusedInstance()).toBe(chat);

    wm.close(chat.instanceId);
    expect(wm.getFocusedInstance()).toBeUndefined();
  });

  it("transfers focus to the highest z-index visible window when a focused window is closed (Req 5.3)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad");
    const main = wm.openOrFocus("main"); // main is focused + on top

    expect(wm.getFocusedInstance()).toBe(main);
    // notepad was focused after chat, so notepad.z > chat.z
    expect(notepad.z).toBeGreaterThan(chat.z);

    wm.close(main.instanceId);

    // focus transfers to the remaining visible window with the highest z-index
    expect(wm.getFocusedInstance()).toBe(notepad);
    expect(notepad.el.classList.contains("is-active")).toBe(true);
    expect(chat.el.classList.contains("is-active")).toBe(false);
    // exactly one active window
    const active = [...wm.getInstances().values()].filter((i) =>
      i.el.classList.contains("is-active")
    );
    expect(active.length).toBe(1);
  });

  it("does NOT transfer focus to minimized windows — only visible ones (Req 5.3)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad");
    const main = wm.openOrFocus("main"); // focused

    // minimize notepad (the next-highest z visible window)
    wm.minimize(notepad.instanceId);
    wm.focus(main.instanceId); // re-focus main after minimize

    wm.close(main.instanceId);

    // notepad is minimized → focus must go to chat (the only visible window)
    expect(wm.getFocusedInstance()).toBe(chat);
    expect(chat.el.classList.contains("is-active")).toBe(true);
  });

  it("does NOT change focus when a non-focused window is closed", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad"); // notepad focused

    wm.close(chat.instanceId); // close the unfocused window

    expect(wm.getFocusedInstance()).toBe(notepad);
    expect(notepad.el.classList.contains("is-active")).toBe(true);
  });

  it("reopening a previously-closed window creates a NEW instance (Req 5.4)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    const firstId = chat.instanceId;
    wm.close(chat.instanceId);
    expect(wm.getInstances().size).toBe(0);

    const reopened = wm.openOrFocus("chat");
    expect(reopened).not.toBe(chat);
    expect(reopened.instanceId).not.toBe(firstId);
    expect(wm.getInstances().size).toBe(1);
    expect(reopened.el.parentNode).toBe(desktopEl);
    expect(reopened.taskButtonEl).toBeTruthy();
    expect(reopened.taskButtonEl.parentNode).toBe(taskbarEl);
  });

  it("the titlebar close control closes the window (Req 5.1)", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    expect(wm.getInstances().size).toBe(1);

    chat.el.querySelector(".xp-win-close").click();

    expect(wm.getInstances().size).toBe(0);
    expect(desktopEl.querySelectorAll(".xp-win").length).toBe(0);
    expect(taskbarEl.querySelectorAll(".xp-task-btn").length).toBe(0);
  });

  it("closing an unknown instanceId is a no-op", () => {
    const wm = makeWM();
    const chat = wm.openOrFocus("chat");
    expect(() => wm.close("nope#999")).not.toThrow();
    expect(wm.getInstances().size).toBe(1);
    expect(wm.getFocusedInstance()).toBe(chat);
  });
});

describe("WindowManager staggered placement (task 8.3)", () => {
  let desktopEl;
  let taskbarEl;
  let templateEl;

  const DESK_W = 1024;
  const DESK_H = 768;
  const TASKBAR_H = 30; // bottom taskbar height (carved out via CSS .xp-desktop bottom: 30px)
  const REACH = 30; // min reachable margin kept on screen for the titlebar
  const STEP = 24; // staggered step offset between consecutive windows
  // .xp-desktop 已通过 CSS bottom: 30px 预留任务栏高度，clientHeight 即为可用高度
  const WORK_H = DESK_H;

  function makeWM(extra = {}) {
    return createWindowManager({
      desktopEl,
      taskbarEl,
      templateEl,
      registry: APP_REGISTRY,
      i18n: i18nStub,
      ...extra,
    });
  }

  // happy-dom reports clientWidth/Height as 0, so pin deterministic dimensions.
  function withSize(el, w, h) {
    Object.defineProperty(el, "clientWidth", { value: w, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: h, configurable: true });
    return el;
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    desktopEl = withSize(document.createElement("div"), DESK_W, DESK_H);
    document.body.appendChild(desktopEl);
    taskbarEl = document.createElement("div");
    document.body.appendChild(taskbarEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  it("centers the first window within the visible work area (offset 0)", () => {
    const wm = makeWM();
    const main = wm.openOrFocus("main"); // 540x620, fixed size
    expect(main.rect.left).toBe(Math.round((DESK_W - 540) / 2));
    expect(main.rect.top).toBe(Math.round((WORK_H - 620) / 2));
  });

  it("offsets the next window down-right relative to the previous one (Req 6.1)", () => {
    const wm = makeWM();
    // Use close+reopen of the SAME app so the window size is constant and the
    // only thing that changes between placements is the stagger offset.
    const first = wm.openOrFocus("chat");
    const p1 = { ...first.rect };
    wm.close(first.instanceId);

    const second = wm.openOrFocus("chat");
    const p2 = { ...second.rect };

    expect(p2.left).toBe(p1.left + STEP);
    expect(p2.top).toBe(p1.top + STEP);
  });

  it("consecutive windows never share the exact same position (Req 6.1)", () => {
    const wm = makeWM();
    const positions = [];
    for (let i = 0; i < 5; i++) {
      const inst = wm.openOrFocus("chat");
      positions.push({ ...inst.rect });
      wm.close(inst.instanceId); // keep size constant, advance openCount
    }
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const cur = positions[i];
      const identical = prev.left === cur.left && prev.top === cur.top;
      expect(identical).toBe(false);
    }
  });

  it("keeps every window inside the work area with a reachable titlebar (Req 6.2)", () => {
    const wm = makeWM();
    const ids = [
      "chat",
      "notepad",
      "deco-mycomputer",
      "deco-mydocuments",
      "deco-controlpanel",
      "pdf-overseas",
    ];
    for (const id of ids) {
      const inst = wm.openOrFocus(id);
      // top-left stays non-negative (nothing drifts off the top/left edge)
      expect(inst.rect.left).toBeGreaterThanOrEqual(0);
      expect(inst.rect.top).toBeGreaterThanOrEqual(0);
      // at least REACH px of the window (including its titlebar) stays on screen
      expect(inst.rect.left).toBeLessThanOrEqual(DESK_W - REACH);
      expect(inst.rect.top).toBeLessThanOrEqual(WORK_H - REACH);
    }
  });

  it("clamps the stagger so a long run of windows stays within the work area", () => {
    const wm = makeWM();
    // open many windows of the same size via close+reopen; offset cycles and
    // is clamped — none escapes the work area, titlebar always reachable.
    for (let i = 0; i < 12; i++) {
      const inst = wm.openOrFocus("notepad"); // 560x540
      expect(inst.rect.top).toBeLessThanOrEqual(WORK_H - REACH);
      expect(inst.rect.left).toBeLessThanOrEqual(DESK_W - REACH);
      expect(inst.rect.top).toBeGreaterThanOrEqual(0);
      expect(inst.rect.left).toBeGreaterThanOrEqual(0);
      wm.close(inst.instanceId);
    }
  });

  it("staggers even an oversized window without collapsing to one corner", () => {
    const wm = makeWM();
    // register a window larger than the work area on purpose
    wm.register({
      id: "huge",
      titleKey: "windows.mainTitle",
      icon: "🔲",
      singleInstance: true,
      resizable: true,
      maximizable: true,
      defaultSize: { w: DESK_W + 400, h: DESK_H + 400 },
      minSize: { w: 320, h: 240 },
      content: { kind: "decorative", decoType: "mycomputer" },
      launch: {},
      mobile: {},
    });

    const a = wm.openOrFocus("huge");
    const pa = { ...a.rect };
    wm.close(a.instanceId);
    const b = wm.openOrFocus("huge");
    const pb = { ...b.rect };

    // oversized base clamps to 0,0 but the stagger offset still separates them
    expect(pa.left).toBe(0);
    expect(pa.top).toBe(0);
    expect(pb.left).toBe(STEP);
    expect(pb.top).toBe(STEP);
  });

  it("falls back to default dimensions when the desktop size is unknown", () => {
    const bareDesktop = document.createElement("div"); // no clientWidth/Height
    document.body.appendChild(bareDesktop);
    const wm = createWindowManager({
      desktopEl: bareDesktop,
      taskbarEl,
      templateEl,
      registry: APP_REGISTRY,
      i18n: i18nStub,
    });

    const inst = wm.openOrFocus("chat");
    expect(Number.isFinite(inst.rect.left)).toBe(true);
    expect(Number.isFinite(inst.rect.top)).toBe(true);
    expect(inst.rect.left).toBeGreaterThanOrEqual(0);
    expect(inst.rect.top).toBeGreaterThanOrEqual(0);
    // first window still centers using the 1024x768 fallback work area
    expect(inst.rect.left).toBe(Math.round((1024 - 440) / 2));
    // 回退高度 768 即为可用高度（CSS 已预留任务栏空间）
    expect(inst.rect.top).toBe(Math.round((768 - 580) / 2));
  });
});

describe("WindowManager titlebar dragging (task 9.1)", () => {
  let desktopEl;
  let taskbarEl;
  let templateEl;

  function makeWM(extra = {}) {
    return createWindowManager({
      desktopEl,
      taskbarEl,
      templateEl,
      registry: APP_REGISTRY,
      i18n: i18nStub,
      ...extra,
    });
  }

  // Synthesises a pointer event with client coordinates.
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

  beforeEach(() => {
    document.body.innerHTML = "";
    desktopEl = document.createElement("div");
    document.body.appendChild(desktopEl);
    taskbarEl = document.createElement("div");
    document.body.appendChild(taskbarEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  it("titlebar pointerdown → pointermove moves the window following the pointer (Req 2.1)", () => {
    const wm = makeWM();
    wm.init(); // binds capture-phase focus delegate on desktopEl
    const chat = wm.openOrFocus("chat");
    const startLeft = chat.rect.left;
    const startTop = chat.rect.top;
    const titlebar = chat.el.querySelector(".xp-win-titlebar");

    pointer("pointerdown", titlebar, 100, 100);
    pointer("pointermove", document, 150, 130); // +50, +30

    expect(chat.rect.left).toBe(startLeft + 50);
    expect(chat.rect.top).toBe(startTop + 30);
    expect(chat.el.style.left).toBe(`${startLeft + 50}px`);
    expect(chat.el.style.top).toBe(`${startTop + 30}px`);

    // a second move keeps following the pointer (relative to the original press)
    pointer("pointermove", document, 90, 80); // -10, -20 from press
    expect(chat.rect.left).toBe(startLeft - 10);
    expect(chat.rect.top).toBe(startTop - 20);
  });

  it("stops moving on pointerup and leaves the window at the release position (Req 2.2)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const startLeft = chat.rect.left;
    const startTop = chat.rect.top;
    const titlebar = chat.el.querySelector(".xp-win-titlebar");

    pointer("pointerdown", titlebar, 100, 100);
    pointer("pointermove", document, 160, 140); // +60, +40
    pointer("pointerup", document, 160, 140);

    const releasedLeft = chat.rect.left;
    const releasedTop = chat.rect.top;
    expect(releasedLeft).toBe(startLeft + 60);
    expect(releasedTop).toBe(startTop + 40);

    // further moves after release must NOT affect the window (drag ended)
    pointer("pointermove", document, 400, 400);
    expect(chat.rect.left).toBe(releasedLeft);
    expect(chat.rect.top).toBe(releasedTop);
  });

  it("keeps the dragged window focused and on top while dragging (Req 2.3)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad"); // notepad focused/on top initially

    const titlebar = chat.el.querySelector(".xp-win-titlebar");
    pointer("pointerdown", titlebar, 120, 60); // capture-phase delegate focuses chat
    pointer("pointermove", document, 200, 120);

    expect(wm.getFocusedInstance()).toBe(chat);
    expect(chat.el.classList.contains("is-active")).toBe(true);
    expect(notepad.el.classList.contains("is-active")).toBe(false);
    expect(chat.z).toBeGreaterThan(notepad.z);
  });

  it("pointerdown on a control button does NOT start a drag (Req 2.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const startLeft = chat.rect.left;
    const startTop = chat.rect.top;

    // press starts on the maximize control button (inside .xp-win-controls)
    const maxBtn = chat.el.querySelector(".xp-win-max");
    pointer("pointerdown", maxBtn, 100, 100);
    pointer("pointermove", document, 200, 200);

    // no movement — dragging was not initiated from a control button
    expect(chat.rect.left).toBe(startLeft);
    expect(chat.rect.top).toBe(startTop);
  });

  it("disables titlebar dragging on mobile (Req 2.5)", () => {
    const wm = makeWM({ isMobile: () => true });
    const chat = wm.openOrFocus("chat"); // openOrFocus works regardless of viewport
    const startLeft = chat.rect.left;
    const startTop = chat.rect.top;
    const titlebar = chat.el.querySelector(".xp-win-titlebar");

    pointer("pointerdown", titlebar, 100, 100);
    pointer("pointermove", document, 220, 180);

    // mobile layout disables dragging — window stays put
    expect(chat.rect.left).toBe(startLeft);
    expect(chat.rect.top).toBe(startTop);
  });

  it("disables titlebar dragging while the window is maximized (Req 22.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    chat.maximized = true; // simulate maximized state (toggleMaximize is task 9.3)
    const startLeft = chat.rect.left;
    const startTop = chat.rect.top;
    const titlebar = chat.el.querySelector(".xp-win-titlebar");

    pointer("pointerdown", titlebar, 100, 100);
    pointer("pointermove", document, 200, 200);

    expect(chat.rect.left).toBe(startLeft);
    expect(chat.rect.top).toBe(startTop);
  });
});

describe("WindowManager edge/corner resizing + minSize (task 9.2)", () => {
  let desktopEl;
  let taskbarEl;
  let templateEl;

  function makeWM(extra = {}) {
    return createWindowManager({
      desktopEl,
      taskbarEl,
      templateEl,
      registry: APP_REGISTRY,
      i18n: i18nStub,
      ...extra,
    });
  }

  // Synthesises a pointer event with client coordinates.
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

  beforeEach(() => {
    document.body.innerHTML = "";
    desktopEl = document.createElement("div");
    document.body.appendChild(desktopEl);
    taskbarEl = document.createElement("div");
    document.body.appendChild(taskbarEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  // chat: defaultSize 440x580, minSize 320x380, resizable
  it("east handle grows the width without moving the window (Req 19.1)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { left, top, width, height } = chat.rect;

    pointer("pointerdown", handle(chat, "e"), 200, 200);
    pointer("pointermove", document, 250, 200); // +50 x

    expect(chat.rect.width).toBe(width + 50);
    expect(chat.rect.height).toBe(height); // unchanged
    expect(chat.rect.left).toBe(left); // east edge — left anchored
    expect(chat.rect.top).toBe(top);
    expect(chat.el.style.width).toBe(`${width + 50}px`);
  });

  it("south handle grows the height without moving the window (Req 19.1)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { left, top, width, height } = chat.rect;

    pointer("pointerdown", handle(chat, "s"), 200, 200);
    pointer("pointermove", document, 200, 260); // +60 y

    expect(chat.rect.height).toBe(height + 60);
    expect(chat.rect.width).toBe(width);
    expect(chat.rect.left).toBe(left);
    expect(chat.rect.top).toBe(top);
    expect(chat.el.style.height).toBe(`${height + 60}px`);
  });

  it("west handle resizes from the left edge, adjusting left and keeping the right edge fixed (Req 19.2)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { left, width } = chat.rect;
    const right = left + width;

    pointer("pointerdown", handle(chat, "w"), 200, 200);
    pointer("pointermove", document, 230, 200); // drag left edge right by 30

    expect(chat.rect.width).toBe(width - 30);
    expect(chat.rect.left).toBe(left + 30);
    expect(chat.rect.left + chat.rect.width).toBe(right); // right edge fixed
  });

  it("north handle resizes from the top edge, adjusting top and keeping the bottom edge fixed (Req 19.2)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { top, height } = chat.rect;
    const bottom = top + height;

    pointer("pointerdown", handle(chat, "n"), 200, 200);
    pointer("pointermove", document, 200, 240); // drag top edge down by 40

    expect(chat.rect.height).toBe(height - 40);
    expect(chat.rect.top).toBe(top + 40);
    expect(chat.rect.top + chat.rect.height).toBe(bottom); // bottom edge fixed
  });

  it("a corner handle (se) resizes width and height together (Req 19.1)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { width, height } = chat.rect;

    pointer("pointerdown", handle(chat, "se"), 200, 200);
    pointer("pointermove", document, 270, 250); // +70 x, +50 y

    expect(chat.rect.width).toBe(width + 70);
    expect(chat.rect.height).toBe(height + 50);
  });

  it("enforces minSize when shrinking via the east/south handles (Req 19.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat"); // min 320x380

    pointer("pointerdown", handle(chat, "se"), 400, 400);
    pointer("pointermove", document, 0, 0); // drag far past the minimum

    expect(chat.rect.width).toBe(320);
    expect(chat.rect.height).toBe(380);
  });

  it("enforces minSize on the west handle and anchors the fixed right edge at the clamp (Req 19.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat"); // width 440, min width 320
    const { left, width } = chat.rect;
    const right = left + width;

    // drag the left edge rightwards far enough to hit the minimum width
    pointer("pointerdown", handle(chat, "w"), 200, 200);
    pointer("pointermove", document, 600, 200);

    expect(chat.rect.width).toBe(320); // clamped to min
    expect(chat.rect.left).toBe(right - 320); // right edge stays fixed
    expect(chat.rect.left + chat.rect.width).toBe(right);
  });

  it("stops resizing on pointerup and ignores subsequent moves (Req 19.1)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { width } = chat.rect;

    pointer("pointerdown", handle(chat, "e"), 200, 200);
    pointer("pointermove", document, 240, 200); // +40
    pointer("pointerup", document, 240, 200);
    const releasedWidth = chat.rect.width;
    expect(releasedWidth).toBe(width + 40);

    pointer("pointermove", document, 600, 200); // after release — ignored
    expect(chat.rect.width).toBe(releasedWidth);
  });

  it("keeps the resized window focused and on top while resizing (Req 19.8)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad"); // notepad focused/on top initially

    pointer("pointerdown", handle(chat, "se"), 200, 200); // capture-phase focuses chat
    pointer("pointermove", document, 260, 260);

    expect(wm.getFocusedInstance()).toBe(chat);
    expect(chat.el.classList.contains("is-active")).toBe(true);
    expect(notepad.el.classList.contains("is-active")).toBe(false);
    expect(chat.z).toBeGreaterThan(notepad.z);
  });

  it("disables resizing on mobile (Req 19.7)", () => {
    const wm = makeWM({ isMobile: () => true });
    const chat = wm.openOrFocus("chat");
    const { width, height } = chat.rect;

    pointer("pointerdown", handle(chat, "se"), 200, 200);
    pointer("pointermove", document, 300, 300);

    expect(chat.rect.width).toBe(width);
    expect(chat.rect.height).toBe(height);
  });

  it("disables resizing while the window is maximized (Req 22.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    chat.maximized = true; // simulate maximized state (toggleMaximize is task 9.3)
    const { width, height } = chat.rect;

    pointer("pointerdown", handle(chat, "se"), 200, 200);
    pointer("pointermove", document, 300, 300);

    expect(chat.rect.width).toBe(width);
    expect(chat.rect.height).toBe(height);
  });

  it("the non-resizable Main_Window has no resize handles to wire (Req 19.6)", () => {
    const wm = makeWM();
    const main = wm.openOrFocus("main"); // resizable: false
    expect(main.el.querySelectorAll(".xp-rz").length).toBe(0);
  });
});

describe("WindowManager edge/corner resizing + minSize (task 9.2)", () => {
  let desktopEl;
  let taskbarEl;
  let templateEl;

  function makeWM(extra = {}) {
    return createWindowManager({
      desktopEl,
      taskbarEl,
      templateEl,
      registry: APP_REGISTRY,
      i18n: i18nStub,
      ...extra,
    });
  }

  // Synthesises a pointer event with client coordinates.
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

  beforeEach(() => {
    document.body.innerHTML = "";
    desktopEl = document.createElement("div");
    document.body.appendChild(desktopEl);
    taskbarEl = document.createElement("div");
    document.body.appendChild(taskbarEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  it("east handle changes width following the pointer, leaving left/top fixed (Req 19.1/19.2)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat"); // 440x580
    const { left, top, width, height } = { ...chat.rect };

    pointer("pointerdown", handle(chat, "e"), 100, 100);
    pointer("pointermove", document, 160, 100); // +60 horizontally

    expect(chat.rect.width).toBe(width + 60);
    expect(chat.rect.height).toBe(height); // unchanged
    expect(chat.rect.left).toBe(left); // left edge fixed
    expect(chat.rect.top).toBe(top);
    expect(chat.el.style.width).toBe(`${width + 60}px`);
  });

  it("south handle changes height only (Req 19.1/19.2)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { left, top, width, height } = { ...chat.rect };

    pointer("pointerdown", handle(chat, "s"), 100, 200);
    pointer("pointermove", document, 100, 245); // +45 vertically

    expect(chat.rect.height).toBe(height + 45);
    expect(chat.rect.width).toBe(width);
    expect(chat.rect.left).toBe(left);
    expect(chat.rect.top).toBe(top);
  });

  it("west handle moves left/width while keeping the right edge fixed (Req 19.2)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { left, width } = { ...chat.rect };
    const right = left + width;

    pointer("pointerdown", handle(chat, "w"), 100, 100);
    pointer("pointermove", document, 70, 100); // -30 → drag left edge leftwards

    expect(chat.rect.left).toBe(left - 30);
    expect(chat.rect.width).toBe(width + 30);
    expect(chat.rect.left + chat.rect.width).toBe(right); // right edge anchored
  });

  it("north handle moves top/height while keeping the bottom edge fixed (Req 19.2)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { top, height } = { ...chat.rect };
    const bottom = top + height;

    pointer("pointerdown", handle(chat, "n"), 100, 100);
    pointer("pointermove", document, 100, 75); // -25 → drag top edge upwards

    expect(chat.rect.top).toBe(top - 25);
    expect(chat.rect.height).toBe(height + 25);
    expect(chat.rect.top + chat.rect.height).toBe(bottom); // bottom edge anchored
  });

  it("se corner changes both width and height (Req 19.1/19.2)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { left, top, width, height } = { ...chat.rect };

    pointer("pointerdown", handle(chat, "se"), 100, 100);
    pointer("pointermove", document, 150, 140); // +50 / +40

    expect(chat.rect.width).toBe(width + 50);
    expect(chat.rect.height).toBe(height + 40);
    expect(chat.rect.left).toBe(left);
    expect(chat.rect.top).toBe(top);
  });

  it("enforces the minimum size when shrinking to extremes (Req 19.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat"); // minSize 320x380
    const min = getAppDefinition("chat").minSize;

    // drag the se corner far up-left, attempting to collapse the window
    pointer("pointerdown", handle(chat, "se"), 500, 500);
    pointer("pointermove", document, -2000, -2000);

    expect(chat.rect.width).toBe(min.w);
    expect(chat.rect.height).toBe(min.h);
    // a follow-up tiny move never breaches the floor either
    pointer("pointermove", document, -10, -10);
    expect(chat.rect.width).toBeGreaterThanOrEqual(min.w);
    expect(chat.rect.height).toBeGreaterThanOrEqual(min.h);
  });

  it("clamps to minSize from the west edge while keeping the right edge anchored (Req 19.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { left, width } = { ...chat.rect };
    const right = left + width;
    const min = getAppDefinition("chat").minSize;

    // drag the west edge far to the right → width would go below minSize
    pointer("pointerdown", handle(chat, "w"), 100, 100);
    pointer("pointermove", document, 5000, 100);

    expect(chat.rect.width).toBe(min.w);
    expect(chat.rect.left).toBe(right - min.w); // right edge still anchored
  });

  it("stops resizing on pointerup and ignores subsequent moves (Req 19.1)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const { width } = { ...chat.rect };

    pointer("pointerdown", handle(chat, "e"), 100, 100);
    pointer("pointermove", document, 150, 100); // +50
    pointer("pointerup", document, 150, 100);
    const released = chat.rect.width;
    expect(released).toBe(width + 50);

    pointer("pointermove", document, 900, 100); // after release → ignored
    expect(chat.rect.width).toBe(released);
  });

  it("keeps the resized window focused and on top while resizing (Req 19.8)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad"); // notepad focused/on top initially

    pointer("pointerdown", handle(chat, "se"), 100, 100); // capture delegate focuses chat
    pointer("pointermove", document, 160, 160);

    expect(wm.getFocusedInstance()).toBe(chat);
    expect(chat.el.classList.contains("is-active")).toBe(true);
    expect(notepad.el.classList.contains("is-active")).toBe(false);
    expect(chat.z).toBeGreaterThan(notepad.z);
  });

  it("Main_Window has no resize handles and cannot be resized (Req 19.5/19.6)", () => {
    const wm = makeWM();
    const main = wm.openOrFocus("main"); // resizable: false
    expect(main.el.querySelectorAll(".xp-rz").length).toBe(0);
  });

  it("disables resizing on mobile (Req 19.7)", () => {
    const wm = makeWM({ isMobile: () => true });
    const chat = wm.openOrFocus("chat");
    const { width, height } = { ...chat.rect };

    pointer("pointerdown", handle(chat, "se"), 100, 100);
    pointer("pointermove", document, 220, 220);

    expect(chat.rect.width).toBe(width);
    expect(chat.rect.height).toBe(height);
  });

  it("disables resizing while the window is maximized (Req 22.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    chat.maximized = true; // simulate maximized state (toggleMaximize is task 9.3)
    const { width, height } = { ...chat.rect };

    pointer("pointerdown", handle(chat, "se"), 100, 100);
    pointer("pointermove", document, 220, 220);

    expect(chat.rect.width).toBe(width);
    expect(chat.rect.height).toBe(height);
  });
});

describe("WindowManager maximize/restore + double-click titlebar (task 9.3)", () => {
  let desktopEl;
  let taskbarEl;
  let templateEl;

  const DESK_W = 1024;
  const DESK_H = 768;
  const TASKBAR_H = 30; // bottom taskbar height (carved out via CSS .xp-desktop bottom: 30px)
  // .xp-desktop 已通过 CSS bottom: 30px 预留任务栏高度，clientHeight 即为可用高度
  const WORK_H = DESK_H;

  function makeWM(extra = {}) {
    return createWindowManager({
      desktopEl,
      taskbarEl,
      templateEl,
      registry: APP_REGISTRY,
      i18n: i18nStub,
      ...extra,
    });
  }

  // happy-dom reports clientWidth/Height as 0, so pin deterministic dimensions.
  function withSize(el, w, h) {
    Object.defineProperty(el, "clientWidth", { value: w, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: h, configurable: true });
    return el;
  }

  // Synthesises a pointer event with client coordinates.
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

  // Synthesises a double-click on an element.
  function dblclick(target) {
    const ev = new window.MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(ev);
    return ev;
  }

  const handle = (inst, dir) => inst.el.querySelector(`.xp-rz-${dir}`);

  beforeEach(() => {
    document.body.innerHTML = "";
    desktopEl = withSize(document.createElement("div"), DESK_W, DESK_H);
    document.body.appendChild(desktopEl);
    taskbarEl = document.createElement("div");
    document.body.appendChild(taskbarEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  it("maximize fills the desktop work area (viewport minus taskbar) at 0,0 and saves restoreRect (Req 22.2)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const orig = { ...chat.rect };

    wm.toggleMaximize(chat.instanceId);

    // saved the pre-maximize rect verbatim
    expect(chat.restoreRect).toEqual(orig);
    // maximized flag + class applied
    expect(chat.maximized).toBe(true);
    expect(chat.el.classList.contains("is-maximized")).toBe(true);
    // fills the work area at the top-left corner
    expect(chat.rect.left).toBe(0);
    expect(chat.rect.top).toBe(0);
    expect(chat.rect.width).toBe(DESK_W);
    expect(chat.rect.height).toBe(WORK_H);
    // inline styles match the rect
    expect(chat.el.style.left).toBe("0px");
    expect(chat.el.style.top).toBe("0px");
    expect(chat.el.style.width).toBe(`${DESK_W}px`);
    expect(chat.el.style.height).toBe(`${WORK_H}px`);
  });

  it("restore returns the window to its exact pre-maximize rect (Req 22.3)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const orig = { ...chat.rect };

    wm.toggleMaximize(chat.instanceId); // maximize
    wm.toggleMaximize(chat.instanceId); // restore

    expect(chat.maximized).toBe(false);
    expect(chat.el.classList.contains("is-maximized")).toBe(false);
    expect(chat.rect).toEqual(orig);
    expect(chat.el.style.left).toBe(`${orig.left}px`);
    expect(chat.el.style.top).toBe(`${orig.top}px`);
    expect(chat.el.style.width).toBe(`${orig.width}px`);
    expect(chat.el.style.height).toBe(`${orig.height}px`);
  });

  it("restores correctly even after the window was dragged/resized before maximizing (Req 22.3)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");

    // move + resize the window first so the restore rect is non-default
    pointer("pointerdown", chat.el.querySelector(".xp-win-titlebar"), 100, 100);
    pointer("pointermove", document, 180, 150); // drag +80,+50
    pointer("pointerup", document, 180, 150);
    pointer("pointerdown", handle(chat, "se"), 200, 200);
    pointer("pointermove", document, 260, 240); // grow +60,+40
    pointer("pointerup", document, 260, 240);
    const moved = { ...chat.rect };

    wm.toggleMaximize(chat.instanceId); // maximize
    expect(chat.rect.left).toBe(0);
    wm.toggleMaximize(chat.instanceId); // restore

    expect(chat.rect).toEqual(moved);
  });

  it("double-clicking the titlebar toggles maximize then restore (Req 22.2/22.3)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const orig = { ...chat.rect };
    const titlebar = chat.el.querySelector(".xp-win-titlebar");

    dblclick(titlebar); // maximize
    expect(chat.maximized).toBe(true);
    expect(chat.rect.width).toBe(DESK_W);
    expect(chat.rect.height).toBe(WORK_H);

    dblclick(titlebar); // restore
    expect(chat.maximized).toBe(false);
    expect(chat.rect).toEqual(orig);
  });

  it("the maximize control button toggles maximize then restore (Req 22.2/22.3)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const orig = { ...chat.rect };
    const maxBtn = chat.el.querySelector(".xp-win-max");

    maxBtn.click(); // maximize
    expect(chat.maximized).toBe(true);
    expect(chat.rect.width).toBe(DESK_W);

    maxBtn.click(); // restore
    expect(chat.maximized).toBe(false);
    expect(chat.rect).toEqual(orig);
  });

  it("double-click on a control button does NOT toggle maximize (Req 22.2)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");

    dblclick(chat.el.querySelector(".xp-win-min"));
    expect(chat.maximized).toBe(false);
  });

  it("disables titlebar dragging while maximized via toggleMaximize (Req 22.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    wm.toggleMaximize(chat.instanceId);
    const maxRect = { ...chat.rect };

    pointer("pointerdown", chat.el.querySelector(".xp-win-titlebar"), 100, 100);
    pointer("pointermove", document, 220, 180);

    // geometry stays locked while maximized
    expect(chat.rect).toEqual(maxRect);
  });

  it("disables edge/corner resizing while maximized via toggleMaximize (Req 22.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    wm.toggleMaximize(chat.instanceId);
    const maxRect = { ...chat.rect };

    pointer("pointerdown", handle(chat, "se"), 200, 200);
    pointer("pointermove", document, 320, 300);

    expect(chat.rect).toEqual(maxRect);
  });

  it("Main_Window cannot be maximized — no-op via button, dblclick, or API (Req 22.5)", () => {
    const wm = makeWM();
    const main = wm.openOrFocus("main"); // maximizable: false
    const orig = { ...main.rect };

    // window carries the .no-max class (button hidden)
    expect(main.el.classList.contains("no-max")).toBe(true);

    // API call is a no-op
    wm.toggleMaximize(main.instanceId);
    expect(main.maximized).toBe(false);
    expect(main.el.classList.contains("is-maximized")).toBe(false);
    expect(main.rect).toEqual(orig);

    // double-click on the titlebar is a no-op too
    dblclick(main.el.querySelector(".xp-win-titlebar"));
    expect(main.maximized).toBe(false);
    expect(main.rect).toEqual(orig);
  });

  it("disables maximize on mobile (Req 22.6)", () => {
    const wm = makeWM({ isMobile: () => true });
    const chat = wm.openOrFocus("chat");
    const orig = { ...chat.rect };

    // API call is a no-op on mobile
    wm.toggleMaximize(chat.instanceId);
    expect(chat.maximized).toBe(false);
    expect(chat.rect).toEqual(orig);

    // double-click on the titlebar is also a no-op on mobile
    dblclick(chat.el.querySelector(".xp-win-titlebar"));
    expect(chat.maximized).toBe(false);
    expect(chat.rect).toEqual(orig);
  });

  it("toggleMaximize on an unknown instanceId is a no-op", () => {
    const wm = makeWM();
    expect(() => wm.toggleMaximize("nope#999")).not.toThrow();
  });
});

describe("WindowManager keyboard accessibility (task 10.1)", () => {
  let desktopEl;
  let taskbarEl;
  let templateEl;

  function makeWM(extra = {}) {
    return createWindowManager({
      desktopEl,
      taskbarEl,
      templateEl,
      registry: APP_REGISTRY,
      i18n: i18nStub,
      ...extra,
    });
  }

  // Synthesises a KeyboardEvent dispatched from a given element (bubbles to the
  // window element, mirroring a real key press while focus is inside a window).
  function keydown(target, key, opts = {}) {
    const ev = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...opts,
    });
    target.dispatchEvent(ev);
    return ev;
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    desktopEl = document.createElement("div");
    document.body.appendChild(desktopEl);
    taskbarEl = document.createElement("div");
    document.body.appendChild(taskbarEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  // ── Esc closes the focused closable window (Req 16.4) ──

  it("Esc closes the focused window and removes its Task_Button (Req 16.4)", () => {
    const wm = makeWM();
    // open chat in isolation (no auto-opened Main_Window) so the counts are exact
    const chat = wm.openOrFocus("chat");
    expect(wm.getInstances().size).toBe(1);

    const ev = keydown(chat.el, "Escape");

    expect(wm.findInstanceByAppId("chat")).toBeUndefined();
    expect(desktopEl.querySelectorAll(".xp-win").length).toBe(0);
    expect(taskbarEl.querySelectorAll(".xp-task-btn").length).toBe(0);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Esc dispatched from a descendant of the focused window still closes it (Req 16.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");

    keydown(chat.el.querySelector(".xp-win-body"), "Escape");

    expect(wm.findInstanceByAppId("chat")).toBeUndefined();
  });

  it("Esc on a NON-focused window does nothing — only the focused window closes (Req 16.4)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const notepad = wm.openOrFocus("notepad"); // notepad is now the focused window
    expect(wm.getFocusedInstance()).toBe(notepad);

    // pressing Esc "on" the unfocused chat window must not close anything
    keydown(chat.el, "Escape");
    expect(wm.findInstanceByAppId("chat")).toBe(chat);
    expect(wm.findInstanceByAppId("notepad")).toBe(notepad);

    // pressing Esc on the focused window closes it and transfers focus
    keydown(notepad.el, "Escape");
    expect(wm.findInstanceByAppId("notepad")).toBeUndefined();
    expect(wm.getFocusedInstance()).toBe(chat);
  });

  // ── Tab focus trap with wrap-around (Req 16.5) ──

  it("Tab from the last focusable element wraps to the first within the window (Req 16.5)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const focusables = chat.el.querySelectorAll(".xp-win-controls .xp-win-btn");
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);

    const ev = keydown(last, "Tab");
    expect(document.activeElement).toBe(first); // wrapped around
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Shift+Tab from the first focusable element wraps to the last (Req 16.5)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const focusables = chat.el.querySelectorAll(".xp-win-controls .xp-win-btn");
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    const ev = keydown(first, "Tab", { shiftKey: true });

    expect(document.activeElement).toBe(last); // wrapped backwards
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Tab advances to the next focusable element in the middle of the window (Req 16.5)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const focusables = chat.el.querySelectorAll(".xp-win-controls .xp-win-btn");

    focusables[0].focus();
    keydown(focusables[0], "Tab");
    expect(document.activeElement).toBe(focusables[1]);

    keydown(focusables[1], "Tab");
    expect(document.activeElement).toBe(focusables[2]);
  });

  it("keeps focus trapped inside the window across a full Tab cycle (Req 16.5)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const focusables = [
      ...chat.el.querySelectorAll(".xp-win-controls .xp-win-btn"),
    ];

    focusables[0].focus();
    // Tab through every focusable + one extra to confirm it wraps, never escaping
    for (let i = 0; i < focusables.length + 1; i++) {
      const current = document.activeElement;
      keydown(current, "Tab");
      expect(chat.el.contains(document.activeElement)).toBe(true);
    }
    // after length+1 presses we are back to the second element (wrapped once)
    expect(document.activeElement).toBe(focusables[1]);
  });

  // ── Control buttons keyboard-activatable via Enter/Space (Req 16.6) ──

  it("control buttons are keyboard-focusable native buttons (Req 16.6)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const buttons = chat.el.querySelectorAll(".xp-win-controls .xp-win-btn");
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      expect(btn.tagName).toBe("BUTTON");
      btn.focus();
      expect(document.activeElement).toBe(btn);
    });
  });

  it("Enter on the close control closes the window (Req 16.6)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const closeBtn = chat.el.querySelector(".xp-win-close");

    const ev = keydown(closeBtn, "Enter");

    expect(wm.findInstanceByAppId("chat")).toBeUndefined();
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Space on the minimize control minimizes the window (Req 16.6)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const minBtn = chat.el.querySelector(".xp-win-min");

    const ev = keydown(minBtn, " ");

    expect(chat.state).toBe("minimized");
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Enter on the maximize control toggles maximize once (no double-toggle) (Req 16.6)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const maxBtn = chat.el.querySelector(".xp-win-max");

    keydown(maxBtn, "Enter");
    expect(chat.maximized).toBe(true); // a single activation, not toggled back
  });

  it("Space on the maximize control toggles maximize once (Req 16.6)", () => {
    const wm = makeWM();
    wm.init();
    const chat = wm.openOrFocus("chat");
    const maxBtn = chat.el.querySelector(".xp-win-max");

    keydown(maxBtn, " ");
    expect(chat.maximized).toBe(true);
  });
});
