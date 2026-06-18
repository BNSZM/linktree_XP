import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "./decorative.js";
import { hasRenderer, renderContent } from "./index.js";

// ════════════════════════════════════════════════════════════
// 任务 16：decorative 渲染器单元测试（Req 12）。
//
// 三种 decoType 共用同一渲染器，按 appDef.content.decoType 分支：
//
//   · 16.1 "mycomputer"   我的电脑（Req 12.1/12.2）
//       纯 CSS/SVG 像素风格模拟界面，除窗口管理外无任何功能行为。
//
//   · 16.2 "mydocuments"  我的文档（Req 12.1/12.3/12.4）
//       陈列三个 PDF 快捷入口 <button>，激活走 ctx.wm.openOrFocus。
//
//   · 16.3 "controlpanel" 控制面板（Req 12.1/12.5）
//       Active_Language 切换（zh/en）+ Reduced_Motion 偏好开关。
//
// 渲染器签名：render(bodyEl, appDef, ctx) -> hooks|void，
//   ctx = { wm, i18n, isMobile, opts }。
// ════════════════════════════════════════════════════════════

// ── App_Definition 工厂 ────────────────────────────────────
function makeAppDef(decoType) {
  return {
    id: `deco-${decoType}`,
    titleKey: `windows.${decoType}`,
    icon: "🖥️",
    singleInstance: true,
    resizable: true,
    maximizable: true,
    defaultSize: { w: 600, h: 440 },
    minSize: { w: 300, h: 200 },
    content: { kind: "decorative", decoType },
    launch: {},
    mobile: {},
  };
}

// ── 最小 i18n mock ──────────────────────────────────────────
const mockI18n = {
  S: (k) => k, // 回退返回 key 本身
  getCurrentLang: () => "zh",
};

/** 构建挂载到 document 的 .xp-win-body。 */
function mountBody() {
  const body = document.createElement("div");
  body.className = "xp-win-body";
  document.body.appendChild(body);
  return body;
}

/** 构建带 spy wm 的渲染上下文。 */
function makeCtx(lang = "zh") {
  const openOrFocus = vi.fn();
  const S = vi.fn((k) => k);
  const ctx = {
    wm: { openOrFocus },
    i18n: { S, getCurrentLang: () => lang },
    isMobile: () => false,
    opts: {},
  };
  return { ctx, openOrFocus, S };
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("lang");
  document.documentElement.className = "";
  // 清理渲染器注入的 <style> 与 localStorage 残留。
  const oldStyle = document.getElementById("wm-decorative-styles");
  if (oldStyle) oldStyle.remove();
  try {
    localStorage.clear();
  } catch {
    /* happy-dom localStorage 不可用时忽略 */
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════
// 16.1  我的电脑 — 纯装饰像素界面（Req 12.1/12.2）
// ════════════════════════════════════════════════════════════
describe("decorative 渲染器 — 我的电脑 mycomputer（任务 16.1, Req 12.1/12.2）", () => {
  it("加载时自注册 kind=\"decorative\"", () => {
    expect(hasRenderer("decorative")).toBe(true);
  });

  it("渲染左侧任务窗格与右侧存储区域", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("mycomputer"), ctx);

    // 整体结构。
    expect(body.querySelector(".deco-mc")).toBeTruthy();
    expect(body.querySelector(".deco-mc-side")).toBeTruthy();
    expect(body.querySelector(".deco-mc-main")).toBeTruthy();

    // 左侧两个面板：系统任务 + 其他位置。
    const panes = body.querySelectorAll(".deco-mc-side .deco-pane");
    expect(panes.length).toBe(2);

    // 右侧三组：共享文件 / 硬盘 / 可移动存储。
    const groups = body.querySelectorAll(".deco-mc-main .deco-mc-group");
    expect(groups.length).toBe(3);

    // 至少 5 个存储项（1 共享 + 2 硬盘 + 2 可移动）。
    const items = body.querySelectorAll(".deco-item");
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("注入 SVG 像素图标，带 pixelated 渲染与 crispEdges", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("mycomputer"), ctx);

    const icons = body.querySelectorAll(".deco-ico svg");
    expect(icons.length).toBeGreaterThanOrEqual(5);
    icons.forEach((svg) => {
      expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
    });
  });

  it("所有内容标记 aria-hidden=\"true\"（纯展示，无交互语义）", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("mycomputer"), ctx);

    expect(body.querySelector(".deco-mc-side").getAttribute("aria-hidden")).toBe("true");
    expect(body.querySelector(".deco-mc-main").getAttribute("aria-hidden")).toBe("true");
  });

  it("不绑定任何 click / keyboard 事件监听器（Req 12.2：无功能行为）", () => {
    const body = mountBody();
    const { ctx, openOrFocus } = makeCtx();
    render(body, makeAppDef("mycomputer"), ctx);

    // 逐一点击所有 HTML 元素（SVG 元素在 happy-dom 中无 .click()）——不应触发 openOrFocus。
    body.querySelectorAll("div, span").forEach((el) => {
      if (typeof el.click === "function") el.click();
    });
    expect(openOrFocus).not.toHaveBeenCalled();
  });

  it("返回 void（无生命周期钩子）", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    const result = render(body, makeAppDef("mycomputer"), ctx);
    expect(result).toBeUndefined();
  });

  it("bodyEl 加上 .wm-deco 类并注入一次性 <style>", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("mycomputer"), ctx);

    expect(body.classList.contains("wm-deco")).toBe(true);
    expect(document.getElementById("wm-decorative-styles")).toBeTruthy();
  });

  it("双语元素带 data-i18n-zh / data-i18n-en 绑定", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("mycomputer"), ctx);

    // 至少存在一个双语绑定元素（如 "系统任务"/"System Tasks"）。
    const bilingual = body.querySelector("[data-i18n-zh]");
    expect(bilingual).toBeTruthy();
    expect(bilingual.getAttribute("data-i18n-en")).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════
// 16.2  我的文档 — PDF 快捷入口（Req 12.1/12.3/12.4）
// ════════════════════════════════════════════════════════════
describe("decorative 渲染器 — 我的文档 mydocuments（任务 16.2, Req 12.1/12.3/12.4）", () => {
  it("渲染三个 PDF 快捷入口按钮（Req 12.3）", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("mydocuments"), ctx);

    const btns = body.querySelectorAll("button.deco-doc");
    expect(btns.length).toBe(3);
  });

  it("三个按钮的 data-app-id 分别为 pdf-overseas / pdf-fastgpt / pdf-m365（Req 12.4）", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("mydocuments"), ctx);

    const btns = [...body.querySelectorAll("button.deco-doc")];
    expect(btns.map((b) => b.getAttribute("data-app-id"))).toEqual([
      "pdf-overseas",
      "pdf-fastgpt",
      "pdf-m365",
    ]);
  });

  it("每个入口为 <button type=\"button\">，可键盘聚焦/触发（Req 16.6）", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("mydocuments"), ctx);

    body.querySelectorAll("button.deco-doc").forEach((btn) => {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.getAttribute("type")).toBe("button");
      expect(btn.getAttribute("role")).toBe("listitem");
    });
  });

  it("点击各按钮 → ctx.wm.openOrFocus(对应 appId)（Req 12.4）", () => {
    const body = mountBody();
    const { ctx, openOrFocus } = makeCtx();
    render(body, makeAppDef("mydocuments"), ctx);

    const expected = ["pdf-overseas", "pdf-fastgpt", "pdf-m365"];
    const btns = [...body.querySelectorAll("button.deco-doc")];

    btns.forEach((btn, i) => {
      openOrFocus.mockClear();
      btn.click();
      expect(openOrFocus).toHaveBeenCalledTimes(1);
      expect(openOrFocus).toHaveBeenCalledWith(expected[i]);
    });
  });

  it("列表容器具有 role=\"list\"", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("mydocuments"), ctx);

    const list = body.querySelector(".deco-docs-list");
    expect(list).toBeTruthy();
    expect(list.getAttribute("role")).toBe("list");
  });

  it("ctx.wm 缺失时点击不抛错", () => {
    const body = mountBody();
    const ctx = { wm: null, i18n: mockI18n, isMobile: () => false, opts: {} };
    render(body, makeAppDef("mydocuments"), ctx);

    const btns = body.querySelectorAll("button.deco-doc");
    btns.forEach((btn) => {
      expect(() => btn.click()).not.toThrow();
    });
  });

  it("ctx.wm.openOrFocus 非函数时点击不抛错", () => {
    const body = mountBody();
    const ctx = { wm: {}, i18n: mockI18n, isMobile: () => false, opts: {} };
    render(body, makeAppDef("mydocuments"), ctx);

    body.querySelectorAll("button.deco-doc").forEach((btn) => {
      expect(() => btn.click()).not.toThrow();
    });
  });

  it("返回 void（无生命周期钩子）", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    const result = render(body, makeAppDef("mydocuments"), ctx);
    expect(result).toBeUndefined();
  });

  it("每个按钮包含 SVG 图标与标题文本", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("mydocuments"), ctx);

    body.querySelectorAll("button.deco-doc").forEach((btn) => {
      expect(btn.querySelector(".deco-ico svg")).toBeTruthy();
      expect(btn.querySelector(".deco-tx")).toBeTruthy();
    });
  });
});

// ════════════════════════════════════════════════════════════
// 16.3  控制面板 — 语言切换 + 减弱动效（Req 12.1/12.5）
// ════════════════════════════════════════════════════════════
describe("decorative 渲染器 — 控制面板 controlpanel（任务 16.3, Req 12.1/12.5）", () => {
  /** 在 document.body 内插入一个 #lang-toggle 按钮，模拟既有全局语言切换。 */
  function insertLangToggle(clickSpy) {
    const toggle = document.createElement("button");
    toggle.id = "lang-toggle";
    if (clickSpy) toggle.addEventListener("click", clickSpy);
    document.body.appendChild(toggle);
    return toggle;
  }

  it("渲染语言切换段（中文/English 两个按钮）", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("controlpanel"), ctx);

    const langBtns = body.querySelectorAll("[data-lang]");
    expect(langBtns.length).toBe(2);
    expect(langBtns[0].getAttribute("data-lang")).toBe("zh");
    expect(langBtns[0].textContent).toBe("中文");
    expect(langBtns[1].getAttribute("data-lang")).toBe("en");
    expect(langBtns[1].textContent).toBe("English");
  });

  it("当前语言按钮 aria-pressed=\"true\"，另一语言 \"false\"", () => {
    // 中文激活
    const bodyZh = mountBody();
    const { ctx: ctxZh } = makeCtx("zh");
    render(bodyZh, makeAppDef("controlpanel"), ctxZh);

    expect(bodyZh.querySelector("[data-lang='zh']").getAttribute("aria-pressed")).toBe("true");
    expect(bodyZh.querySelector("[data-lang='en']").getAttribute("aria-pressed")).toBe("false");

    // 英文激活
    document.body.innerHTML = "";
    const bodyEn = mountBody();
    const { ctx: ctxEn } = makeCtx("en");
    render(bodyEn, makeAppDef("controlpanel"), ctxEn);

    expect(bodyEn.querySelector("[data-lang='zh']").getAttribute("aria-pressed")).toBe("false");
    expect(bodyEn.querySelector("[data-lang='en']").getAttribute("aria-pressed")).toBe("true");
  });

  it("点击非激活语言按钮 → 触发全局 #lang-toggle.click()（Req 12.5）", () => {
    const body = mountBody();
    const { ctx } = makeCtx("zh");
    const toggleClickSpy = vi.fn();
    insertLangToggle(toggleClickSpy);

    render(body, makeAppDef("controlpanel"), ctx);

    // 当前中文，点击 English → 应触发 #lang-toggle.click()
    body.querySelector("[data-lang='en']").click();
    expect(toggleClickSpy).toHaveBeenCalledTimes(1);
  });

  it("点击已激活语言按钮 → 不触发 #lang-toggle（无切换需求）", () => {
    const body = mountBody();
    const { ctx } = makeCtx("zh");
    const toggleClickSpy = vi.fn();
    insertLangToggle(toggleClickSpy);

    render(body, makeAppDef("controlpanel"), ctx);

    // 当前中文，再点击中文 → 不应触发
    body.querySelector("[data-lang='zh']").click();
    expect(toggleClickSpy).not.toHaveBeenCalled();
  });

  it("渲染减弱动效开关按钮", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("controlpanel"), ctx);

    const toggle = body.querySelector(".deco-toggle");
    expect(toggle).toBeTruthy();
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("type")).toBe("button");
  });

  it("默认状态下减弱动效关闭（aria-pressed=\"false\"）", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("controlpanel"), ctx);

    const toggle = body.querySelector(".deco-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(document.documentElement.classList.contains("force-reduced-motion")).toBe(false);
  });

  it("点击减弱动效开关 → <html> 加/移 force-reduced-motion 类并持久化（Req 12.5）", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("controlpanel"), ctx);

    const toggle = body.querySelector(".deco-toggle");

    // 开启
    toggle.click();
    expect(document.documentElement.classList.contains("force-reduced-motion")).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("force-reduced-motion")).toBe("1");

    // 关闭
    toggle.click();
    expect(document.documentElement.classList.contains("force-reduced-motion")).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem("force-reduced-motion")).toBe("0");
  });

  it("localStorage 已有 force-reduced-motion=1 时渲染即开启", () => {
    localStorage.setItem("force-reduced-motion", "1");

    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("controlpanel"), ctx);

    expect(document.documentElement.classList.contains("force-reduced-motion")).toBe(true);
    expect(body.querySelector(".deco-toggle").getAttribute("aria-pressed")).toBe("true");
  });

  it("语言切换段与减弱动效段分别在独立 <section> 中", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("controlpanel"), ctx);

    const sections = body.querySelectorAll(".deco-cp-sec");
    expect(sections.length).toBe(2);
  });

  it("返回含 onClose 钩子的对象，调用后断开 MutationObserver", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    const hooks = render(body, makeAppDef("controlpanel"), ctx);

    expect(hooks).toBeTruthy();
    expect(typeof hooks.onClose).toBe("function");

    // onClose 可安全调用（断开 observer），不抛错。
    expect(() => hooks.onClose()).not.toThrow();
    // 重复调用也安全（幂等）。
    expect(() => hooks.onClose()).not.toThrow();
  });

  it("减弱动效提示文案同时绑定中英文（data-i18n-zh/en）", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("controlpanel"), ctx);

    const hint = body.querySelector(".deco-hint");
    expect(hint).toBeTruthy();
    expect(hint.getAttribute("data-i18n-zh")).toBeTruthy();
    expect(hint.getAttribute("data-i18n-en")).toBeTruthy();
  });

  it("语言段 h3 使用 data-i18n 绑定", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    render(body, makeAppDef("controlpanel"), ctx);

    const headings = body.querySelectorAll(".deco-cp-sec h3");
    expect(headings.length).toBe(2);
    expect(headings[0].getAttribute("data-i18n")).toBe("controlPanel.language");
    expect(headings[1].getAttribute("data-i18n")).toBe("controlPanel.reducedMotion");
  });
});

// ════════════════════════════════════════════════════════════
// 分发框架集成 + 安全回退
// ════════════════════════════════════════════════════════════
describe("decorative 渲染器 — renderContent 分发集成", () => {
  it("经 renderContent 分发 mycomputer：注入正文、返回空钩子", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    const appDef = makeAppDef("mycomputer");
    const hooks = renderContent(body, appDef, ctx);

    expect(body.querySelector(".deco-mc")).toBeTruthy();
    expect(hooks).toEqual({});
  });

  it("经 renderContent 分发 mydocuments：注入按钮、返回空钩子", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    const appDef = makeAppDef("mydocuments");
    const hooks = renderContent(body, appDef, ctx);

    expect(body.querySelectorAll("button.deco-doc").length).toBe(3);
    expect(hooks).toEqual({});
  });

  it("经 renderContent 分发 controlpanel：注入设置 UI、返回 onClose 钩子", () => {
    const body = mountBody();
    const { ctx } = makeCtx();
    const appDef = makeAppDef("controlpanel");
    const hooks = renderContent(body, appDef, ctx);

    expect(body.querySelector(".deco-cp")).toBeTruthy();
    expect(typeof hooks.onClose).toBe("function");
    expect(() => hooks.onClose()).not.toThrow();
  });
});

describe("decorative 渲染器 — 未知 decoType 安全回退", () => {
  it("未知 decoType 不抛错、bodyEl 清空后无额外内容、返回 void", () => {
    const body = mountBody();
    body.innerHTML = "<span>placeholder</span>";
    const { ctx } = makeCtx();
    const appDef = makeAppDef("unknown-type");

    let result;
    expect(() => {
      result = render(body, appDef, ctx);
    }).not.toThrow();

    expect(result).toBeUndefined();
    // render() 入口先清空 bodyEl，未知分支不注入任何内容。
    expect(body.innerHTML).toBe("");
    expect(body.classList.contains("wm-deco")).toBe(true);
  });
});
