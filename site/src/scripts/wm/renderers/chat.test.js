import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render as chatRender } from "./chat.js";
import { hasRenderer, renderContent } from "./index.js";

// mock site data：为 chat 渲染器提供 SITE.chips 测试数据。
vi.mock("../../../data/site.js", () => ({
  SITE: {
    chips: [
      { zh: "海外大模型怎么接入？", en: "How to access overseas LLMs?" },
      { zh: "FastGPT 能做什么？", en: "What can FastGPT do?" },
    ],
  },
}));

// ════════════════════════════════════════════════════════════
// 任务 14.1：chat 渲染器（窗口化 AI 聊天）示例单元测试（Req 10）。
//
// 通过模拟 SSE 流（mock fetch + ReadableStream，由真实 chatProvider 解析）断言：
//   · SSE token 流式追加到消息流          (Req 10.2)
//   · 空响应 / 错误显示配置好的错误文案     (Req 10.3)
//   · 首次打开显示问候 + 建议气泡           (Req 10.4)
//   · 点击建议气泡将其文本作为消息发送       (Req 10.5)
//   · 渲染器自注册 "chat" 并在窗口正文注入聊天 UI（Req 10.1/18.4）
//   · 引导语（guideMessage）打开时自动发送   (Req 9.2 接线)
// ════════════════════════════════════════════════════════════

// 固定文案表（避免依赖真实 i18n 内容，使断言稳定）。
const STR = {
  "chat.greeting": "GREETING",
  "chat.error": "CONNECTION_ERROR",
};
const S = (k) => STR[k] ?? k;
const getCurrentLang = () => "zh";

// ── SSE mock 工具 ────────────────────────────────────────────

/** 构造一条 OpenAI 风格的增量 token 帧。 */
function tokenFrame(content) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}
const DONE_FRAME = "data: [DONE]\n\n";

/** 用一组帧构造一个 ReadableStream（逐帧 enqueue，模拟分片到达）。 */
function streamFromFrames(frames) {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < frames.length) {
        controller.enqueue(enc.encode(frames[i++]));
      } else {
        controller.close();
      }
    },
  });
}

/** 安装一个返回给定帧 SSE 流的 fetch mock（res.ok=true）。 */
function mockSSE(frames) {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    body: streamFromFrames(frames),
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** 安装一个返回错误（res.ok=false，无 body）的 fetch mock。 */
function mockHttpError(status = 500) {
  const fn = vi.fn(async () => ({ ok: false, status, body: null }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function makeBody() {
  document.body.innerHTML = "";
  const body = document.createElement("div");
  body.className = "xp-win-body";
  document.body.appendChild(body);
  return body;
}

/** 用测试默认值调用 chat 渲染器。 */
function renderChat(body, opts = {}) {
  const ctx = {
    wm: {},
    i18n: { S, getCurrentLang },
    isMobile: () => false,
    opts,
  };
  return chatRender(body, { content: { kind: "chat" } }, ctx);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chat 渲染器 — 首次打开（Req 10.1/10.4）", () => {
  beforeEach(() => {
    mockSSE([]); // 本组不发起发送，但确保 fetch 不命中真实网络
  });

  it("在窗口正文注入消息流 + 建议气泡 + 输入框 + 发送按钮", () => {
    const body = makeBody();
    renderChat(body);

    expect(body.querySelector(".chat-msgs")).toBeTruthy();
    expect(body.querySelector(".chips")).toBeTruthy();
    expect(body.querySelector(".chat-form")).toBeTruthy();
    expect(body.querySelector(".chat-input")).toBeTruthy();
    expect(body.querySelector(".chat-go")).toBeTruthy();
  });

  it("首次打开显示问候消息（Req 10.4）", () => {
    const body = makeBody();
    renderChat(body);

    const bots = body.querySelectorAll(".chat-msgs .msg.bot");
    expect(bots.length).toBe(1);
    expect(bots[0].textContent).toBe("GREETING");
  });

  it("首次打开展示建议气泡，且气泡文本取自配置（Req 10.4）", () => {
    const body = makeBody();
    renderChat(body);

    const chipsEl = body.querySelector(".chips");
    expect(chipsEl.hidden).toBe(false);
    const chips = chipsEl.querySelectorAll(".chip");
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe("海外大模型怎么接入？");
    // 双语绑定供语言切换更新（Req 15.5）
    expect(chips[0].getAttribute("data-i18n-en")).toBe("How to access overseas LLMs?");
  });

  it("输入框占位符带 data-i18n-ph 绑定", () => {
    const body = makeBody();
    renderChat(body);
    const input = body.querySelector(".chat-input");
    expect(input.getAttribute("placeholder")).toBeTruthy();
    expect(input.getAttribute("data-i18n-ph")).toBe("chat.placeholder");
  });
});

describe("chat 渲染器 — SSE 流式追加（Req 10.2）", () => {
  it("提交消息后将流式 token 依次追加到助手气泡", async () => {
    mockSSE([tokenFrame("Hello"), tokenFrame(", "), tokenFrame("world"), DONE_FRAME]);
    const body = makeBody();
    renderChat(body);

    const input = body.querySelector(".chat-input");
    const form = body.querySelector(".chat-form");
    input.value = "hi there";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    // 用户气泡立即出现
    const userMsg = body.querySelector(".chat-msgs .msg.user");
    expect(userMsg.textContent).toBe("hi there");

    // 助手气泡随流追加，最终拼出完整 token 序列
    await vi.waitFor(() => {
      const bots = body.querySelectorAll(".chat-msgs .msg.bot");
      // [0] = 问候, [1] = 助手回复
      expect(bots[1] && bots[1].textContent).toBe("Hello, world");
    });
  });
});

describe("chat 渲染器 — 空响应 / 错误文案（Req 10.3）", () => {
  it("流未产生任何内容时显示配置错误文案", async () => {
    mockSSE([DONE_FRAME]); // 只有 [DONE]，无 token
    const body = makeBody();
    renderChat(body);

    const input = body.querySelector(".chat-input");
    const form = body.querySelector(".chat-form");
    input.value = "anything";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      const bots = body.querySelectorAll(".chat-msgs .msg.bot");
      expect(bots[1] && bots[1].textContent).toBe("CONNECTION_ERROR");
    });
  });

  it("HTTP 错误（非 2xx）时显示配置错误文案", async () => {
    mockHttpError(500);
    const body = makeBody();
    renderChat(body);

    const input = body.querySelector(".chat-input");
    const form = body.querySelector(".chat-form");
    input.value = "anything";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      const bots = body.querySelectorAll(".chat-msgs .msg.bot");
      expect(bots[1] && bots[1].textContent).toBe("CONNECTION_ERROR");
    });
  });
});

describe("chat 渲染器 — 点击建议气泡发送（Req 10.5）", () => {
  it("点击气泡将其文本作为用户消息发送，并收起气泡", async () => {
    mockSSE([tokenFrame("answer"), DONE_FRAME]);
    const body = makeBody();
    renderChat(body);

    const chipsEl = body.querySelector(".chips");
    const firstChip = chipsEl.querySelector(".chip");
    const chipText = firstChip.textContent;
    firstChip.click();

    // 气泡文本作为用户消息发送
    const userMsg = body.querySelector(".chat-msgs .msg.user");
    expect(userMsg.textContent).toBe(chipText);
    // 提问后气泡收起
    expect(chipsEl.hidden).toBe(true);

    await vi.waitFor(() => {
      const bots = body.querySelectorAll(".chat-msgs .msg.bot");
      expect(bots[1] && bots[1].textContent).toBe("answer");
    });
  });
});

describe("chat 渲染器 — 注册与窗口正文注入 / 引导语（Req 10.1/9.2/18.4）", () => {
  it("加载时自注册 kind=\"chat\"", () => {
    expect(hasRenderer("chat")).toBe(true);
  });

  it("经 renderContent 分发：向 .xp-win-body 注入聊天 UI 并返回 onClose 钩子", () => {
    mockSSE([]);
    const body = makeBody();
    const appDef = { id: "chat", titleKey: "chat.title", content: { kind: "chat" } };
    const ctx = {
      wm: {},
      i18n: { S, getCurrentLang },
      isMobile: () => false,
      opts: {},
    };
    const hooks = renderContent(body, appDef, ctx);

    expect(body.querySelector(".chat-win .chat-msgs")).toBeTruthy();
    expect(body.querySelector(".chat-form")).toBeTruthy();
    expect(typeof hooks.onClose).toBe("function");
    expect(() => hooks.onClose()).not.toThrow();
  });

  it("opts.guideMessage 在打开时自动发送（Req 9.2 接线）", async () => {
    mockSSE([tokenFrame("guided reply"), DONE_FRAME]);
    const body = makeBody();
    const appDef = { id: "chat", titleKey: "chat.title", content: { kind: "chat" } };
    const ctx = {
      wm: {},
      i18n: { S, getCurrentLang },
      isMobile: () => false,
      opts: { guideMessage: "随便聊聊，交个朋友", lang: "zh" },
    };
    chatRender(body, appDef, ctx);

    // 引导语作为用户消息自动发送
    await vi.waitFor(() => {
      const userMsg = body.querySelector(".chat-msgs .msg.user");
      expect(userMsg && userMsg.textContent).toBe("随便聊聊，交个朋友");
    });
    await vi.waitFor(() => {
      const bots = body.querySelectorAll(".chat-msgs .msg.bot");
      expect(bots[1] && bots[1].textContent).toBe("guided reply");
    });
  });
});

describe("chat 渲染器 — 空白文本防护", () => {
  it("空白文本不发送，不产生多余消息", async () => {
    const fetchFn = mockSSE([tokenFrame("x"), DONE_FRAME]);
    const body = makeBody();
    renderChat(body);

    const input = body.querySelector(".chat-input");
    const form = body.querySelector(".chat-form");
    input.value = "   "; // 空白文本
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    // 只有问候气泡，空白消息被忽略
    expect(body.querySelectorAll(".chat-msgs .msg").length).toBe(1); // 仅问候
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
