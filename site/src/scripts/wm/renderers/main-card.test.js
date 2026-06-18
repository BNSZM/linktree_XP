import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "./main-card.js";
import { hasRenderer } from "./index.js";
import { SITE } from "../../../data/site.js";

// ════════════════════════════════════════════════════════════
// 任务 13.1（含并入的 13.2）：main-card 渲染器示例单元测试。
//
// 断言主名片正文的操作接线（Req 9）与装饰控件的「不改内容」约束（Req 8.5/8.7）：
//   · AI 聊天入口按钮          → wm.openOrFocus("chat")                 (Req 9.1)
//   · 三个 PDF 产品条目        → wm.openOrFocus("pdf-overseas|fastgpt|m365") (Req 9.3/9.4/9.5)
//   · AI 定制方案（action:chat）→ wm.openOrFocus("chat", { guideMessage }) 按当前语言 (Req 9.2)
//   · 联系方式图标             → 复制到剪贴板 + Toast，且不打开任何窗口  (Req 9.6)
//   · 「?」/ 选项卡 / OK·Cancel·Apply → 装饰控件，不改变所显示内容       (Req 8.5/8.7)
//
// 渲染器签名：render(bodyEl, appDef, ctx) -> hooks|void；ctx = { wm, i18n, isMobile, opts }。
// 直接调用 render（不经 WindowManager），用 spy wm 聚焦验证操作接线本身。
// ════════════════════════════════════════════════════════════

// 主名片窗口的最小 App_Definition（content.kind = "main-card"）。
const MAIN_APP_DEF = {
  id: "main",
  titleKey: "windows.mainTitle",
  icon: "👤",
  singleInstance: true,
  resizable: false,
  maximizable: false,
  defaultSize: { w: 540, h: 620 },
  minSize: { w: 540, h: 620 },
  content: { kind: "main-card" },
  launch: {},
  mobile: {},
};

// PDF 路径 → PDF 窗口 appId（与渲染器/registry 一致）。
const PDF_APP_BY_URL = {
  "/pdf/apihub-overseas-llm-relay.pdf": "pdf-overseas",
  "/pdf/fastgpt-commercial.pdf": "pdf-fastgpt",
  "/pdf/microsoft365-copilot.pdf": "pdf-m365",
};

/** 构建一个挂载到 document 的 .xp-win-body（initCopy 依赖 #links 在文档内可达）。 */
function mountBody() {
  const body = document.createElement("div");
  body.className = "xp-win-body";
  document.body.appendChild(body);
  return body;
}

/** 构建渲染上下文：注入可控语言与可观测的 S / toast（避免依赖全局单例）。 */
function makeCtx(lang = "zh") {
  const openOrFocus = vi.fn();
  const toast = vi.fn();
  const S = vi.fn((k) => (k === "toast.copied" ? "Copied" : k));
  const ctx = {
    wm: { openOrFocus },
    i18n: { getCurrentLang: () => lang, S, toast },
    isMobile: () => false,
    opts: {},
  };
  return { ctx, openOrFocus, toast, S };
}

/** 微任务/计时器刷新，等待异步复制处理（initCopy 内 await clipboard）。 */
function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

describe("main-card 渲染器 — 操作接线 (任务 13.1, Req 9)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // 复制依赖 navigator.clipboard.writeText —— 提供可观测的 mock，确保不真正访问系统剪贴板。
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AI 聊天入口按钮 → openOrFocus('chat')（Req 9.1）", () => {
    const body = mountBody();
    const { ctx, openOrFocus } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    const entry = body.querySelector(".chat-entry");
    expect(entry).toBeTruthy();
    entry.click();

    expect(openOrFocus).toHaveBeenCalledTimes(1);
    expect(openOrFocus).toHaveBeenCalledWith("chat");
  });

  it("各 PDF 产品条目 → 触发对应 PDF 窗口的 openOrFocus（Req 9.3/9.4/9.5）", () => {
    const body = mountBody();
    const { ctx, openOrFocus } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    // 遍历真实内容中的 PDF 产品，按其在 SITE.products 中的索引点击对应胶囊。
    const pdfProducts = SITE.products
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.pdf);

    expect(pdfProducts.length).toBe(3); // 海外中转 / FastGPT / Microsoft 365

    pdfProducts.forEach(({ p, i }) => {
      openOrFocus.mockClear();
      const pill = body.querySelector(`.pill[data-pill="${i}"]`);
      expect(pill).toBeTruthy();
      pill.click();
      const expectedAppId = PDF_APP_BY_URL[p.pdf];
      expect(openOrFocus).toHaveBeenCalledTimes(1);
      expect(openOrFocus).toHaveBeenCalledWith(expectedAppId);
    });
  });

  it("action:'chat' 产品条目 → openOrFocus('chat', { guideMessage }) 按中文自动发送（Req 9.2）", () => {
    const body = mountBody();
    const { ctx, openOrFocus } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    const idx = SITE.products.findIndex((p) => p.action === "chat");
    expect(idx).toBeGreaterThanOrEqual(0);
    const product = SITE.products[idx];

    const pill = body.querySelector(`.pill[data-pill="${idx}"]`);
    pill.click();

    expect(openOrFocus).toHaveBeenCalledTimes(1);
    const [appId, opts] = openOrFocus.mock.calls[0];
    expect(appId).toBe("chat");
    expect(opts.guideMessage).toBe(product.chatMessage.zh);
    expect(opts.lang).toBe("zh");
  });

  it("action:'chat' 产品条目 → 按英文自动发送对应语种引导语（Req 9.2）", () => {
    const body = mountBody();
    const { ctx, openOrFocus } = makeCtx("en");
    render(body, MAIN_APP_DEF, ctx);

    const idx = SITE.products.findIndex((p) => p.action === "chat");
    const product = SITE.products[idx];

    const pill = body.querySelector(`.pill[data-pill="${idx}"]`);
    pill.click();

    expect(openOrFocus).toHaveBeenCalledTimes(1);
    const [appId, opts] = openOrFocus.mock.calls[0];
    expect(appId).toBe("chat");
    expect(opts.guideMessage).toBe(product.chatMessage.en);
    expect(opts.lang).toBe("en");
  });

  it("联系方式图标 → 复制到剪贴板 + Toast，且不打开任何窗口（Req 9.6）", async () => {
    const body = mountBody();
    const { ctx, openOrFocus, toast } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    // 取第一个 type=copy 的联系图标。
    const copyContact = SITE.contacts.find((c) => c.type === "copy");
    expect(copyContact).toBeTruthy();
    const icon = body.querySelector(`#links .sbtn[data-copy="${copyContact.value}"]`);
    expect(icon).toBeTruthy();

    icon.click();

    // 不打开任何窗口（Req 9.6）。
    expect(openOrFocus).not.toHaveBeenCalled();

    await flush();

    // 复制到剪贴板 + Toast 反馈。
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(copyContact.value);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toContain(copyContact.value);
  });
});

describe("main-card 渲染器 — 装饰控件不改内容 (任务 13.1, Req 8.5/8.7)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 捕获「所显示内容」的稳定签名：身份/产品/联系/页脚文本。 */
  function contentSignature(body) {
    const pills = [...body.querySelectorAll(".pill .pill-title")].map((e) => e.textContent);
    return JSON.stringify({
      name: body.querySelector(".name")?.textContent,
      tagline: body.querySelector(".tagline")?.textContent,
      pills,
      pillCount: body.querySelectorAll(".pill").length,
      contacts: body.querySelectorAll("#links .sbtn").length,
      foot: body.querySelector(".foot")?.textContent,
    });
  }

  it("内容直接铺满：无装饰性标签栏和底部按钮", () => {
    const body = mountBody();
    const { ctx } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    // 无选项卡条
    expect(body.querySelectorAll(".xp-tabs").length).toBe(0);
    // 无底部按钮行
    expect(body.querySelectorAll(".xp-button-row").length).toBe(0);
    // 无帮助按钮
    expect(body.querySelector(".mc-help")).toBeFalsy();
    // 有正文容器
    expect(body.querySelector(".xp-body")).toBeTruthy();
  });
});

describe("main-card 渲染器 — 渲染结构 (任务 13.1, Req 8)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("渲染后 bodyEl 获得 mc-body 类（米色对话框主体标记）", () => {
    const body = mountBody();
    const { ctx } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    expect(body.classList.contains("mc-body")).toBe(true);
  });

  it("无装饰性选项卡条和帮助按钮", () => {
    const body = mountBody();
    const { ctx } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    // 选项卡条已移除
    expect(body.querySelectorAll(".xp-tab").length).toBe(0);
    // 帮助按钮已移除
    expect(body.querySelector(".mc-help")).toBeFalsy();
    // 正文直接包含身份、产品、联系方式组框
    expect(body.querySelector(".xp-body")).toBeTruthy();
  });

  it("左图右信息布局：头像 + 姓名 / 标语（Req 8.6）", () => {
    const body = mountBody();
    const { ctx } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    // 左图（头像）
    expect(body.querySelector(".mc-id-left .avatar")).toBeTruthy();
    // 右信息
    expect(body.querySelector(".mc-id-right .name")).toBeTruthy();
    expect(body.querySelector(".mc-id-right .tagline")).toBeTruthy();
    // AI 聊天入口已分离到独立组框（不再在 .mc-id-right 内）
    expect(body.querySelector(".chat-entry")).toBeTruthy();
  });

  it("姓名 / 标语 / 页脚带 data-i18n 绑定，随语言切换更新（Req 8 / Req 15）", () => {
    const body = mountBody();
    const { ctx } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    expect(body.querySelector(".name").getAttribute("data-i18n")).toBe("profile.name");
    expect(body.querySelector(".tagline").getAttribute("data-i18n")).toBe("profile.tagline");
    expect(body.querySelector(".foot").getAttribute("data-i18n")).toBe("foot.note");
  });

  it("产品条目数与 SITE.products 一致，含 data-i18n-zh / data-i18n-en 双语绑定", () => {
    const body = mountBody();
    const { ctx } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    const pills = body.querySelectorAll(".pill");
    expect(pills.length).toBe(SITE.products.length);

    // 产品标题双语绑定
    const titles = body.querySelectorAll(".pill-title");
    expect(titles.length).toBe(SITE.products.length);
    SITE.products.forEach((p, i) => {
      expect(titles[i].getAttribute("data-i18n-zh")).toBe(p.title.zh);
      expect(titles[i].getAttribute("data-i18n-en")).toBe(p.title.en);
    });
  });

  it("联系方式图标数与 SITE.contacts 一致，type=copy 带 data-copy 属性（Req 9.6）", () => {
    const body = mountBody();
    const { ctx } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    const icons = body.querySelectorAll("#links .sbtn");
    expect(icons.length).toBe(SITE.contacts.length);

    // type=copy 的图标带 data-copy
    const copyContacts = SITE.contacts.filter((c) => c.type === "copy");
    expect(copyContacts.length).toBeGreaterThan(0);
    copyContacts.forEach((c) => {
      const el = body.querySelector(`#links .sbtn[data-copy="${c.value}"]`);
      expect(el).toBeTruthy();
    });
  });

  it("无底部 OK / Cancel / Apply 按钮行", () => {
    const body = mountBody();
    const { ctx } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);

    expect(body.querySelectorAll(".xp-button-row").length).toBe(0);
    expect(body.querySelectorAll(".xp-btn").length).toBe(0);
  });

  it("重渲染安全：调用两次 render 不产生重复内容", () => {
    const body = mountBody();
    const { ctx } = makeCtx("zh");
    render(body, MAIN_APP_DEF, ctx);
    render(body, MAIN_APP_DEF, ctx); // 重渲染

    // 正文不重复：各关键元素仅出现一次
    expect(body.querySelectorAll(".identity").length).toBe(1);
    expect(body.querySelectorAll(".foot").length).toBe(1);
    expect(body.querySelectorAll(".pill").length).toBe(SITE.products.length);
  });

  it("bodyEl 为 null 时不抛", () => {
    const { ctx } = makeCtx("zh");
    expect(() => render(null, MAIN_APP_DEF, ctx)).not.toThrow();
  });
});

describe("main-card 渲染器 — 自注册 (任务 13.1, Req 18.4)", () => {
  it("模块加载时自注册 kind=\"main-card\"", () => {
    expect(hasRenderer("main-card")).toBe(true);
  });
});
