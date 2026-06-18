import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerRenderer,
  getRenderer,
  hasRenderer,
  unregisterRenderer,
  clearRenderers,
  renderContent,
} from "./renderers/index.js";
import { createWindowManager } from "./window-manager.js";

// ════════════════════════════════════════════════════════════
// 任务 12.1：内容渲染器分发框架单元测试（Req 18.4）。
//
// 覆盖两层：
//   1) 分发框架本身（registerRenderer / renderContent / 安全回退）
//   2) 与 WindowManager 的集成（打开时按 kind 注入正文、生命周期钩子时点）
// ════════════════════════════════════════════════════════════

// 镜像 components/XPWindow.astro 的窗口模板，供 WindowManager 在 happy-dom 下克隆。
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

// 一个带自定义 kind 的最小 App_Definition 工厂（避免与具体渲染器的 kind 冲突）。
function makeAppDef(id, kind, extra = {}) {
  return {
    id,
    titleKey: id,
    icon: "🧪",
    singleInstance: true,
    resizable: true,
    maximizable: true,
    defaultSize: { w: 400, h: 300 },
    minSize: { w: 200, h: 150 },
    content: { kind },
    launch: {},
    mobile: {},
    ...extra,
  };
}

describe("内容渲染器分发框架 — 注册表 API (任务 12.1)", () => {
  beforeEach(() => {
    clearRenderers();
  });

  it("registerRenderer 拒绝空 kind / 非函数渲染器", () => {
    expect(() => registerRenderer("", () => {})).toThrow();
    expect(() => registerRenderer(123, () => {})).toThrow();
    expect(() => registerRenderer("k", null)).toThrow();
    expect(() => registerRenderer("k", "not-a-fn")).toThrow();
  });

  it("registerRenderer / getRenderer / hasRenderer 往返", () => {
    const fn = () => {};
    expect(hasRenderer("widget")).toBe(false);
    expect(getRenderer("widget")).toBeUndefined();

    registerRenderer("widget", fn);
    expect(hasRenderer("widget")).toBe(true);
    expect(getRenderer("widget")).toBe(fn);
  });

  it("重复注册同一 kind 覆盖既有渲染器", () => {
    const a = () => {};
    const b = () => {};
    registerRenderer("dup", a);
    registerRenderer("dup", b);
    expect(getRenderer("dup")).toBe(b);
  });

  it("unregisterRenderer / clearRenderers 用于隔离", () => {
    registerRenderer("x", () => {});
    registerRenderer("y", () => {});
    expect(unregisterRenderer("x")).toBe(true);
    expect(hasRenderer("x")).toBe(false);
    clearRenderers();
    expect(hasRenderer("y")).toBe(false);
  });
});

describe("内容渲染器分发框架 — renderContent 分发 (任务 12.1)", () => {
  beforeEach(() => {
    clearRenderers();
  });

  it("以 bodyEl / appDef / ctx 调用匹配 kind 的渲染器，正文出现注入内容", () => {
    const bodyEl = document.createElement("div");
    bodyEl.className = "xp-win-body";
    const appDef = makeAppDef("a1", "kindA");
    const ctx = { wm: {}, i18n: null, isMobile: () => false, opts: { z: 1 } };

    const spy = vi.fn((body) => {
      const p = body.ownerDocument.createElement("p");
      p.className = "injected";
      p.textContent = "hello";
      body.appendChild(p);
    });
    registerRenderer("kindA", spy);

    renderContent(bodyEl, appDef, ctx);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(bodyEl, appDef, ctx);
    expect(bodyEl.querySelector(".injected")).toBeTruthy();
    expect(bodyEl.querySelector(".injected").textContent).toBe("hello");
  });

  it("规范化返回值：仅保留为函数的 onFocus/onResize/onClose", () => {
    const bodyEl = document.createElement("div");
    const appDef = makeAppDef("a2", "kindB");
    const onFocus = () => {};
    const onClose = () => {};
    registerRenderer("kindB", () => ({
      onFocus,
      onResize: "not-a-fn", // 非函数应被剔除
      onClose,
      extra: 42, // 无关字段不保留
    }));

    const hooks = renderContent(bodyEl, appDef, {});
    expect(hooks.onFocus).toBe(onFocus);
    expect(hooks.onClose).toBe(onClose);
    expect(hooks.onResize).toBeUndefined();
    expect(hooks.extra).toBeUndefined();
  });

  it("渲染器无返回（void）时得到空钩子对象", () => {
    const bodyEl = document.createElement("div");
    registerRenderer("kindC", () => {});
    const hooks = renderContent(bodyEl, makeAppDef("a3", "kindC"), {});
    expect(hooks).toEqual({});
  });

  it("未注册的 kind 是安全 no-op：不抛、正文保持原样、返回空钩子", () => {
    const bodyEl = document.createElement("div");
    bodyEl.innerHTML = "<span>untouched</span>";
    const appDef = makeAppDef("a4", "never-registered");

    let hooks;
    expect(() => {
      hooks = renderContent(bodyEl, appDef, {});
    }).not.toThrow();
    expect(hooks).toEqual({});
    expect(bodyEl.innerHTML).toBe("<span>untouched</span>");
  });

  it("缺少 bodyEl / appDef / content.kind 时返回空钩子、不抛", () => {
    registerRenderer("kindD", () => ({ onFocus: () => {} }));
    expect(renderContent(null, makeAppDef("a5", "kindD"), {})).toEqual({});
    expect(renderContent(document.createElement("div"), null, {})).toEqual({});
    expect(
      renderContent(document.createElement("div"), { id: "x", content: {} }, {})
    ).toEqual({});
  });
});

describe("内容渲染器与 WindowManager 集成 (任务 12.1)", () => {
  let desktopEl;
  let taskbarEl;
  let templateEl;

  function makeWM(appDefs, extra = {}) {
    return createWindowManager({
      desktopEl,
      taskbarEl,
      templateEl,
      registry: appDefs,
      isMobile: () => false,
      i18n: { S: (k) => k, getCurrentLang: () => "zh" },
      ...extra,
    });
  }

  beforeEach(() => {
    clearRenderers();
    document.body.innerHTML = "";
    desktopEl = document.createElement("div");
    document.body.appendChild(desktopEl);
    taskbarEl = document.createElement("div");
    document.body.appendChild(taskbarEl);
    templateEl = buildTemplate();
    document.body.appendChild(templateEl);
  });

  it("打开窗口时按 content.kind 调用渲染器，向 .xp-win-body 注入正文", () => {
    const spy = vi.fn((body) => {
      const div = body.ownerDocument.createElement("div");
      div.className = "rendered-content";
      div.textContent = "body!";
      body.appendChild(div);
    });
    registerRenderer("test-kind", spy);

    const wm = makeWM([makeAppDef("test-app", "test-kind")]);
    const inst = wm.openOrFocus("test-app", { guideMessage: "hi" });

    expect(spy).toHaveBeenCalledTimes(1);
    const [bodyArg, appArg, ctxArg] = spy.mock.calls[0];
    // 渲染器收到该窗口的 .xp-win-body
    expect(bodyArg).toBe(inst.el.querySelector(".xp-win-body"));
    expect(appArg.id).toBe("test-app");
    // ctx 含有用的协作对象
    expect(typeof ctxArg.wm.openOrFocus).toBe("function");
    expect(typeof ctxArg.isMobile).toBe("function");
    expect(ctxArg.i18n).toBeTruthy();
    expect(ctxArg.opts).toEqual({ guideMessage: "hi" });
    // 注入内容出现在窗口正文内
    expect(inst.el.querySelector(".xp-win-body .rendered-content")).toBeTruthy();
    expect(inst.el.querySelector(".rendered-content").textContent).toBe("body!");
  });

  it("渲染器返回的钩子存到 instance.hooks，并在聚焦时调用 onFocus", () => {
    const onFocus = vi.fn();
    registerRenderer("hook-kind", () => ({ onFocus }));

    const wm = makeWM([
      makeAppDef("a", "hook-kind"),
      makeAppDef("b", "hook-kind"),
    ]);

    const a = wm.openOrFocus("a"); // 打开即聚焦 → onFocus 一次
    expect(a.hooks.onFocus).toBe(onFocus);
    expect(onFocus).toHaveBeenCalledTimes(1);

    wm.openOrFocus("b"); // 打开 b（b 的渲染器是同一个 onFocus 引用）
    expect(onFocus).toHaveBeenCalledTimes(2);

    // 重新聚焦 a → 再次触发 onFocus
    wm.focus(a.instanceId);
    expect(onFocus).toHaveBeenCalledTimes(3);
  });

  it("调整尺寸结束时调用 onResize", () => {
    const onResize = vi.fn();
    registerRenderer("resize-kind", () => ({ onResize }));

    const wm = makeWM([makeAppDef("r", "resize-kind")]);
    const inst = wm.openOrFocus("r");
    expect(onResize).not.toHaveBeenCalled();

    // 经一个 resize 把手发起调整并在文档级 pointerup 结束。
    const handle = inst.el.querySelector(".xp-rz-se");
    handle.dispatchEvent(
      new window.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
        button: 0,
      })
    );
    document.dispatchEvent(
      new window.PointerEvent("pointermove", {
        bubbles: true,
        clientX: 40,
        clientY: 40,
      })
    );
    document.dispatchEvent(
      new window.PointerEvent("pointerup", { bubbles: true })
    );

    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("最大化/还原改变几何时调用 onResize", () => {
    const onResize = vi.fn();
    registerRenderer("max-kind", () => ({ onResize }));

    const wm = makeWM([makeAppDef("m", "max-kind")]);
    const inst = wm.openOrFocus("m");

    wm.toggleMaximize(inst.instanceId); // 最大化
    wm.toggleMaximize(inst.instanceId); // 还原
    expect(onResize).toHaveBeenCalledTimes(2);
  });

  it("关闭窗口时调用 onClose（先于移除 DOM）", () => {
    const onClose = vi.fn();
    registerRenderer("close-kind", () => ({ onClose }));

    const wm = makeWM([makeAppDef("c", "close-kind")]);
    const inst = wm.openOrFocus("c");
    expect(onClose).not.toHaveBeenCalled();

    wm.close(inst.instanceId);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(wm.getInstances().size).toBe(0);
  });

  it("未注册 kind 的窗口正常打开：正文为空、不抛、生命周期不受影响", () => {
    const wm = makeWM([makeAppDef("noop", "no-renderer-kind")]);

    let inst;
    expect(() => {
      inst = wm.openOrFocus("noop");
    }).not.toThrow();

    const body = inst.el.querySelector(".xp-win-body");
    expect(body).toBeTruthy();
    expect(body.children.length).toBe(0); // 正文留空
    expect(inst.hooks).toEqual({}); // 无钩子
    // 关闭/最大化等生命周期对无渲染器窗口仍安全
    expect(() => wm.toggleMaximize(inst.instanceId)).not.toThrow();
    expect(() => wm.close(inst.instanceId)).not.toThrow();
    expect(wm.getInstances().size).toBe(0);
  });

  it("渲染器钩子抛出不破坏窗口生命周期", () => {
    registerRenderer("throwing-kind", () => ({
      onClose() {
        throw new Error("boom");
      },
    }));
    const wm = makeWM([makeAppDef("t", "throwing-kind")]);
    const inst = wm.openOrFocus("t");

    expect(() => wm.close(inst.instanceId)).not.toThrow();
    expect(wm.getInstances().size).toBe(0);
  });
});
