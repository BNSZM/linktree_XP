import { describe, it, expect, afterEach } from "vitest";
import { render } from "./pdf-iframe.js";
import { hasRenderer, renderContent } from "./index.js";

// ════════════════════════════════════════════════════════════
// 任务 15.1：pdf-iframe 渲染器（PDF 查看器）示例单元测试（Req 11）。
//
// 三个 PDF 查看器窗口（pdf-overseas / pdf-fastgpt / pdf-m365）共用本渲染器，
// 将映射的 PDF 文档（appDef.content.pdfUrl）嵌入 <iframe>，填满窗口正文。
//
// 断言覆盖：
//   · 渲染器自注册 kind="pdf-iframe"            (Req 18.4)
//   · 三窗口 src 映射正确                        (Req 11.1)
//   · iframe 可访问名称（title）与文档名一致      (Req 11.3)
//   · 经 renderContent 分发正常工作               (Req 11.2)
// ════════════════════════════════════════════════════════════

// 固定文案表（避免依赖真实 content.json / i18n，使断言稳定）。
const STR = {
  "windows.pdfOverseas": "海外大模型中转",
  "windows.pdfFastgpt": "FastGPT 商业版",
  "windows.pdfM365": "Microsoft 365 Business",
};
const S = (k) => STR[k] ?? k;
const getCurrentLang = () => "zh";

// 三个 PDF 窗口的 App_Definition（与 registry.js 声明一致）。
const PDF_APPS = [
  {
    id: "pdf-overseas",
    titleKey: "windows.pdfOverseas",
    content: { kind: "pdf-iframe", pdfUrl: "/pdf/apihub-overseas-llm-relay.pdf" },
  },
  {
    id: "pdf-fastgpt",
    titleKey: "windows.pdfFastgpt",
    content: { kind: "pdf-iframe", pdfUrl: "/pdf/fastgpt-commercial.pdf" },
  },
  {
    id: "pdf-m365",
    titleKey: "windows.pdfM365",
    content: { kind: "pdf-iframe", pdfUrl: "/pdf/microsoft365-copilot.pdf" },
  },
];

function makeBody() {
  document.body.innerHTML = "";
  const body = document.createElement("div");
  body.className = "xp-win-body";
  document.body.appendChild(body);
  return body;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("pdf-iframe 渲染器 — 自注册（Req 18.4）", () => {
  it("加载时自注册 kind=\"pdf-iframe\"", () => {
    expect(hasRenderer("pdf-iframe")).toBe(true);
  });
});

describe("pdf-iframe 渲染器 — 三窗口 src 映射（Req 11.1）", () => {
  it("pdf-overseas 窗口 iframe src 映射为 /pdf/apihub-overseas-llm-relay.pdf", () => {
    const body = makeBody();
    const ctx = { wm: {}, i18n: { S, getCurrentLang }, isMobile: () => false, opts: {} };
    render(body, PDF_APPS[0], ctx);

    const iframe = body.querySelector("iframe.xp-pdf-frame");
    expect(iframe).toBeTruthy();
    expect(iframe.src).toContain("/pdf/apihub-overseas-llm-relay.pdf");
  });

  it("pdf-fastgpt 窗口 iframe src 映射为 /pdf/fastgpt-commercial.pdf", () => {
    const body = makeBody();
    const ctx = { wm: {}, i18n: { S, getCurrentLang }, isMobile: () => false, opts: {} };
    render(body, PDF_APPS[1], ctx);

    const iframe = body.querySelector("iframe.xp-pdf-frame");
    expect(iframe).toBeTruthy();
    expect(iframe.src).toContain("/pdf/fastgpt-commercial.pdf");
  });

  it("pdf-m365 窗口 iframe src 映射为 /pdf/microsoft365-copilot.pdf", () => {
    const body = makeBody();
    const ctx = { wm: {}, i18n: { S, getCurrentLang }, isMobile: () => false, opts: {} };
    render(body, PDF_APPS[2], ctx);

    const iframe = body.querySelector("iframe.xp-pdf-frame");
    expect(iframe).toBeTruthy();
    expect(iframe.src).toContain("/pdf/microsoft365-copilot.pdf");
  });
});

describe("pdf-iframe 渲染器 — 可访问标题（Req 11.3）", () => {
  it("iframe title 属性显示 i18n 解析后的文档名", () => {
    const body = makeBody();
    const ctx = { wm: {}, i18n: { S, getCurrentLang }, isMobile: () => false, opts: {} };
    render(body, PDF_APPS[0], ctx);

    const iframe = body.querySelector("iframe.xp-pdf-frame");
    expect(iframe.getAttribute("title")).toBe("海外大模型中转");
  });

  it("三个窗口 iframe title 分别对应各自的文档名", () => {
    const expectedTitles = ["海外大模型中转", "FastGPT 商业版", "Microsoft 365 Business"];
    for (let i = 0; i < PDF_APPS.length; i++) {
      const body = makeBody();
      const ctx = { wm: {}, i18n: { S, getCurrentLang }, isMobile: () => false, opts: {} };
      render(body, PDF_APPS[i], ctx);

      const iframe = body.querySelector("iframe.xp-pdf-frame");
      expect(iframe.getAttribute("title")).toBe(expectedTitles[i]);
    }
  });

  it("无 i18n 时回退到 titleKey 作为 iframe title", () => {
    const body = makeBody();
    const ctx = { wm: {}, i18n: null, isMobile: () => false, opts: {} };
    render(body, PDF_APPS[0], ctx);

    const iframe = body.querySelector("iframe.xp-pdf-frame");
    expect(iframe.getAttribute("title")).toBe("windows.pdfOverseas");
  });
});

describe("pdf-iframe 渲染器 — renderContent 分发（Req 11.2）", () => {
  it("经 renderContent 分发：向 .xp-win-body 注入填满容器的 iframe", () => {
    const body = makeBody();
    const appDef = PDF_APPS[0];
    const ctx = { wm: {}, i18n: { S, getCurrentLang }, isMobile: () => false, opts: {} };
    const hooks = renderContent(body, appDef, ctx);

    const iframe = body.querySelector("iframe.xp-pdf-frame");
    expect(iframe).toBeTruthy();
    expect(iframe.src).toContain("/pdf/apihub-overseas-llm-relay.pdf");
    expect(iframe.getAttribute("title")).toBe("海外大模型中转");
    // 渲染器无生命周期钩子，返回空对象
    expect(hooks).toEqual({});
  });

  it("正文容器添加 xp-pdf-body 类名以便 iframe 填满（Req 11.2）", () => {
    const body = makeBody();
    const ctx = { wm: {}, i18n: { S, getCurrentLang }, isMobile: () => false, opts: {} };
    render(body, PDF_APPS[0], ctx);

    expect(body.classList.contains("xp-pdf-body")).toBe(true);
  });

  it("iframe 设置 loading=\"lazy\" 以优化加载性能", () => {
    const body = makeBody();
    const ctx = { wm: {}, i18n: { S, getCurrentLang }, isMobile: () => false, opts: {} };
    render(body, PDF_APPS[0], ctx);

    const iframe = body.querySelector("iframe.xp-pdf-frame");
    expect(iframe.getAttribute("loading")).toBe("lazy");
  });
});

describe("pdf-iframe 渲染器 — 安全边界", () => {
  it("bodyEl 为空时不抛出", () => {
    const ctx = { wm: {}, i18n: { S, getCurrentLang }, isMobile: () => false, opts: {} };
    expect(() => render(null, PDF_APPS[0], ctx)).not.toThrow();
  });

  it("appDef 为空时不抛出", () => {
    const body = makeBody();
    const ctx = { wm: {}, i18n: { S, getCurrentLang }, isMobile: () => false, opts: {} };
    expect(() => render(body, null, ctx)).not.toThrow();
  });
});
