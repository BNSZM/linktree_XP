import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hasRenderer } from "./index.js";

// ════════════════════════════════════════════════════════════
// 任务 19.3：notepad 渲染器（XP 记事本风格留言板）示例单元测试。
//
// 断言：
//   · 渲染器自注册 kind="notepad"                 (Req 18.4)
//   · 默认匿名名渲染                              (Req 20.12)
//   · 时间戳渲染                                  (Req 20.13)
//   · 空状态文案                                  (Req 20.16)
//   · 错误码 → 友好双语文案映射                    (Req 20.8)
//     too_long / rate_limited / load_error / saveError(默认回退)
//   · 字数达上限禁用提交                           (Req 20.14)
//   · 本人留言显示编辑 / 删除按钮                  (Req 20.5)
// ════════════════════════════════════════════════════════════

// ── 依赖 mock ─────────────────────────────────────────────────
vi.mock("../../notepad/messages-client", () => {
  return {
    messagesClient: {
      list: vi.fn(),
      create: vi.fn(),
      edit: vi.fn(),
      remove: vi.fn(),
      adminDelete: vi.fn(),
      adminClearAll: vi.fn(),
    },
  };
});

vi.mock("../../notepad/visitor-id", () => ({
  getVisitorId: vi.fn(() => "test-visitor-id"),
}));

// 导入被测模块（触发 registerRenderer("notepad", render) 自注册副作用）。
import { render } from "./notepad.js";
import { messagesClient } from "../../notepad/messages-client.js";
import { getVisitorId } from "../../notepad/visitor-id.js";

// 固定文案表（避免依赖真实 content.json，使断言稳定）。
const STR = {
  "notepad.anonymous": "匿名访客",
  "notepad.empty": "还没有留言，来做第一个吧～",
  "notepad.submit": "保存",
  "notepad.nickname": "昵称（可选）",
  "notepad.placeholder": "留下你的想法…",
  "notepad.tooLong": "留言过长（上限 {max} 字）",
  "notepad.rateLimited": "操作太频繁，请稍后再试",
  "notepad.loadError": "留言加载失败，请稍后重试",
  "notepad.saveError": "保存失败，请稍后重试",
};
const S = (k) => STR[k] ?? k;
const getCurrentLang = () => "zh";

// ── 工具函数 ──────────────────────────────────────────────────
function makeBody() {
  document.body.innerHTML = "";
  const body = document.createElement("div");
  body.className = "xp-win-body";
  document.body.appendChild(body);
  return body;}

/** 构造默认 ctx（可局部覆盖）。 */
function makeCtx(overrides = {}) {
  return {
    wm: {},
    i18n: { S, getCurrentLang },
    isMobile: () => false,
    opts: {},
    ...overrides,
  };
}

/** 等待异步 load() 完成（渲染器在 render 末尾无 await 调用 load）。 */
async function waitForList(el) {
  await vi.waitFor(() => {
    expect(el.querySelector(".np-empty") || el.querySelector(".np-msg")).toBeTruthy();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.__xpPrompt;
});

// ── 自注册（Req 18.4）─────────────────────────────────────────
describe("notepad 渲染器 — 自注册（Req 18.4）", () => {
  it("加载时自注册 kind=\"notepad\"", () => {
    expect(hasRenderer("notepad")).toBe(true);
  });
});

// ── 空状态文案（Req 20.16）────────────────────────────────────
describe("notepad 渲染器 — 空状态文案（Req 20.16）", () => {
  beforeEach(() => {
    messagesClient.list.mockResolvedValue({ items: [], total: 0, hasMore: false });
  });

  it("留言列表为空时显示空状态文案", async () => {
    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const empty = listEl.querySelector(".np-empty");
    expect(empty).toBeTruthy();
    expect(empty.textContent).toBe("还没有留言，来做第一个吧～");
  });
});

// ── 默认匿名名 + 时间戳渲染（Req 20.12 / 20.13）───────────────
describe("notepad 渲染器 — 默认匿名名与时间戳（Req 20.12/20.13）", () => {
  beforeEach(() => {
    messagesClient.list.mockResolvedValue({
      items: [
        {
          id: "m1",
          text: "你好世界",
          nickname: "",
          ownerId: "other-user",
          createdAt: 1700000000000,
        },
      ],
      total: 1,
      hasMore: false,
    });
  });

  it("无昵称时显示默认匿名名（Req 20.12）", async () => {
    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const author = listEl.querySelector(".np-msg-author");
    expect(author).toBeTruthy();
    expect(author.textContent).toBe("匿名访客");
  });

  it("渲染时间戳（Req 20.13）", async () => {
    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const time = listEl.querySelector(".np-msg-time");
    expect(time).toBeTruthy();
    // toLocaleString() 输出因运行时环境而异，仅断言非空。
    expect(time.textContent).not.toBe("");
  });

  it("留言正文经 textContent 渲染（防 XSS，Req 17.5/20.6）", async () => {
    messagesClient.list.mockResolvedValue({
      items: [
        {
          id: "m-xss",
          text: '<script>alert("xss")</script>',
          nickname: "test",
          ownerId: "other",
          createdAt: Date.now(),
        },
      ],
      total: 1,
      hasMore: false,
    });

    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const textEl = listEl.querySelector(".np-msg-text");
    expect(textEl).toBeTruthy();
    // textContent 不会解析 HTML 标签
    expect(textEl.textContent).toBe('<script>alert("xss")</script>');
    expect(textEl.querySelector("script")).toBeNull();
  });
});

// ── 错误码 → 友好双语文案（Req 20.8）──────────────────────────
describe("notepad 渲染器 — 错误码映射友好文案（Req 20.8）", () => {
  it("too_long → 留言过长提示", async () => {
    messagesClient.list.mockResolvedValue({ items: [], total: 0, hasMore: false });
    messagesClient.create.mockRejectedValue(
      Object.assign(new Error("too_long"), { code: "too_long", status: 400 })
    );

    const body = makeBody();
    render(body, {}, makeCtx());

    // 等待初始加载完成
    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    // 输入合法文本并提交
    const textInput = body.querySelector(".np-text");
    textInput.value = "测试消息";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));
    body.querySelector(".np-submit").click();

    await vi.waitFor(() => {
      const status = body.querySelector(".np-status");
      expect(status.hidden).toBe(false);
      expect(status.textContent).toContain("留言过长");
    });
  });

  it("rate_limited → 操作太频繁提示", async () => {
    messagesClient.list.mockResolvedValue({ items: [], total: 0, hasMore: false });
    messagesClient.create.mockRejectedValue(
      Object.assign(new Error("rate_limited"), { code: "rate_limited", status: 429 })
    );

    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const textInput = body.querySelector(".np-text");
    textInput.value = "测试消息";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));
    body.querySelector(".np-submit").click();

    await vi.waitFor(() => {
      const status = body.querySelector(".np-status");
      expect(status.hidden).toBe(false);
      expect(status.textContent).toContain("操作太频繁");
    });
  });

  it("load_error → 加载失败提示", async () => {
    messagesClient.list.mockRejectedValue(
      Object.assign(new Error("load_error"), { code: "load_error", status: 500 })
    );

    const body = makeBody();
    render(body, {}, makeCtx());

    await vi.waitFor(() => {
      const status = body.querySelector(".np-status");
      expect(status.hidden).toBe(false);
      expect(status.textContent).toContain("加载失败");
    });
  });

  it("saveError（未知码 → 默认回退为保存失败文案）", async () => {
    messagesClient.list.mockResolvedValue({ items: [], total: 0, hasMore: false });
    messagesClient.create.mockRejectedValue(
      Object.assign(new Error("saveError"), { code: "saveError", status: 500 })
    );

    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const textInput = body.querySelector(".np-text");
    textInput.value = "测试消息";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));
    body.querySelector(".np-submit").click();

    await vi.waitFor(() => {
      const status = body.querySelector(".np-status");
      expect(status.hidden).toBe(false);
      expect(status.textContent).toContain("保存失败");
    });
  });

  it("各错误码映射互不相同", async () => {
    messagesClient.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const tooLongMsg = S("notepad.tooLong").replace("{max}", "500");
    const rateLimitedMsg = S("notepad.rateLimited");
    const loadErrorMsg = S("notepad.loadError");
    const saveErrorMsg = S("notepad.saveError");

    // 四条文案互不相同
    const msgs = [tooLongMsg, rateLimitedMsg, loadErrorMsg, saveErrorMsg];
    const unique = new Set(msgs);
    expect(unique.size).toBe(4);
  });
});

// ── 字数达上限禁用提交（Req 20.14）────────────────────────────
describe("notepad 渲染器 — 字数上限禁用提交（Req 20.14）", () => {
  beforeEach(() => {
    messagesClient.list.mockResolvedValue({ items: [], total: 0, hasMore: false });
  });

  it("字数超过上限（>500）时提交按钮禁用", async () => {
    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const textInput = body.querySelector(".np-text");
    const submitBtn = body.querySelector(".np-submit");
    const counter = body.querySelector(".np-counter");

    // 输入 501 字（超过 MAX_MSG_LEN=500）
    textInput.value = "a".repeat(501);
    textInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(submitBtn.disabled).toBe(true);
    expect(counter.classList.contains("np-counter--over")).toBe(true);
    expect(counter.textContent).toBe("501 / 500");
  });

  it("字数恰好等于上限（500）时提交按钮不禁用", async () => {
    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const textInput = body.querySelector(".np-text");
    const submitBtn = body.querySelector(".np-submit");

    textInput.value = "a".repeat(500);
    textInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(submitBtn.disabled).toBe(false);
  });

  it("空文本时提交按钮禁用", async () => {
    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const textInput = body.querySelector(".np-text");
    const submitBtn = body.querySelector(".np-submit");

    textInput.value = "";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(submitBtn.disabled).toBe(true);
  });

  it("字数计数器显示 \"len / 500\" 格式", async () => {
    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const counter = body.querySelector(".np-counter");
    expect(counter.textContent).toBe("0 / 500");

    const textInput = body.querySelector(".np-text");
    textInput.value = "hello";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(counter.textContent).toBe("5 / 500");
  });
});

// ── 本人留言编辑 / 删除按钮（Req 20.5）────────────────────────
describe("notepad 渲染器 — 本人留言编辑/删除（Req 20.5）", () => {
  it("ownerId 匹配 visitorId 时显示编辑和删除按钮", async () => {
    messagesClient.list.mockResolvedValue({
      items: [
        {
          id: "m-own",
          text: "我自己的留言",
          nickname: "我",
          ownerId: "test-visitor-id",
          createdAt: Date.now(),
        },
      ],
      total: 1,
      hasMore: false,
    });

    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const actions = listEl.querySelector(".np-msg-actions");
    expect(actions).toBeTruthy();

    const buttons = actions.querySelectorAll(".np-act");
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe("编辑");
    expect(buttons[1].textContent).toBe("删除");
  });

  it("ownerId 不匹配时不显示编辑 / 删除按钮", async () => {
    messagesClient.list.mockResolvedValue({
      items: [
        {
          id: "m-other",
          text: "别人的留言",
          nickname: "路人",
          ownerId: "someone-else",
          createdAt: Date.now(),
        },
      ],
      total: 1,
      hasMore: false,
    });

    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const actions = listEl.querySelector(".np-msg-actions");
    expect(actions).toBeNull();
  });

  it("编辑按钮带双语 data-i18n-zh/en 属性", async () => {
    messagesClient.list.mockResolvedValue({
      items: [
        {
          id: "m-bi",
          text: "双语测试",
          nickname: "test",
          ownerId: "test-visitor-id",
          createdAt: Date.now(),
        },
      ],
      total: 1,
      hasMore: false,
    });

    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const editBtn = listEl.querySelectorAll(".np-act")[0];
    expect(editBtn.getAttribute("data-i18n-zh")).toBe("编辑");
    expect(editBtn.getAttribute("data-i18n-en")).toBe("Edit");

    const delBtn = listEl.querySelectorAll(".np-act")[1];
    expect(delBtn.getAttribute("data-i18n-zh")).toBe("删除");
    expect(delBtn.getAttribute("data-i18n-en")).toBe("Delete");
  });
});

// ── 管理员模式渲染（Admin Mode）────────────────────────────────
describe("notepad 渲染器 — 管理员模式", () => {
  beforeEach(() => {
    messagesClient.list.mockResolvedValue({
      items: [
        {
          id: "m-own",
          text: "我自己的留言",
          nickname: "我",
          ownerId: "test-visitor-id",
          createdAt: 1700000000000,
        },
        {
          id: "m-other",
          text: "别人的留言",
          nickname: "路人",
          ownerId: "someone-else",
          createdAt: 1700000001000,
        },
      ],
      total: 2,
      hasMore: false,
    });
    messagesClient.adminDelete.mockResolvedValue({ ok: true });
    messagesClient.adminClearAll.mockResolvedValue({ ok: true, deleted: 2 });
    // mock virtual prompt (Req 26 — replaces browser prompt())
    globalThis.__xpPrompt = vi.fn(() => Promise.resolve("test-admin-key"));
  });

  it("非管理员模式：别人的留言不显示删除按钮", async () => {
    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    const msgs = listEl.querySelectorAll(".np-msg");
    expect(msgs.length).toBe(2);

    // 第一条是自己的（ownerId = test-visitor-id），有 actions
    const ownActions = msgs[0].querySelector(".np-msg-actions");
    expect(ownActions).toBeTruthy();

    // 第二条是别人的，没有 actions
    const otherActions = msgs[1].querySelector(".np-msg-actions");
    expect(otherActions).toBeNull();
  });

  it("进入管理员模式后：所有留言都显示删除按钮", async () => {
    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    // 点击「管理」按钮进入管理员模式
    const adminTrigger = body.querySelector(".np-admin-trigger");
    expect(adminTrigger).toBeTruthy();
    adminTrigger.click();

    // 等待重新渲染
    await vi.waitFor(() => {
      const msgs = listEl.querySelectorAll(".np-msg");
      expect(msgs.length).toBe(2);
      // 所有留言都应有删除按钮
      const allActions = listEl.querySelectorAll(".np-msg-actions");
      expect(allActions.length).toBe(2);
    });

    // 别人的留言也应该有删除按钮（没有编辑按钮）
    const msgs = listEl.querySelectorAll(".np-msg");
    const otherActions = msgs[1].querySelector(".np-msg-actions");
    expect(otherActions).toBeTruthy();
    const otherBtns = otherActions.querySelectorAll(".np-act");
    expect(otherBtns.length).toBe(1); // 只有删除，没有编辑
    expect(otherBtns[0].textContent).toBe("删除");
  });

  it("管理员模式：点击删除按钮调用 adminDelete API", async () => {
    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    // 进入管理员模式
    const adminTrigger = body.querySelector(".np-admin-trigger");
    adminTrigger.click();

    // 等待重新渲染
    await vi.waitFor(() => {
      const allActions = listEl.querySelectorAll(".np-msg-actions");
      expect(allActions.length).toBe(2);
    });

    // 点击别人留言的删除按钮
    const msgs = listEl.querySelectorAll(".np-msg");
    const otherDelBtn = msgs[1].querySelector(".np-act--danger");
    expect(otherDelBtn).toBeTruthy();
    otherDelBtn.click();

    // 验证调用了 adminDelete（而不是普通 remove）
    await vi.waitFor(() => {
      expect(messagesClient.adminDelete).toHaveBeenCalledWith(
        "m-other",
        "test-admin-key"
      );
    });
  });

  it("管理员模式：「清空全部留言」按钮可见", async () => {
    const body = makeBody();
    render(body, {}, makeCtx());

    const listEl = body.querySelector(".np-list");
    await waitForList(listEl);

    // 初始状态：清空按钮隐藏
    const clearBtn = body.querySelector(".np-admin-clear");
    expect(clearBtn.hidden).toBe(true);

    // 进入管理员模式
    body.querySelector(".np-admin-trigger").click();

    await vi.waitFor(() => {
      expect(clearBtn.hidden).toBe(false);
    });
  });
});
