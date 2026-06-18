// ════════════════════════════════════════════════════════════
// chatProvider 单元测试（RC 审计 #9 修复）
//
// 覆盖：
//   · 正常 SSE token 流解析 + onToken 回调
//   · [DONE] 帧终止
//   · 流自然结束（streamDone）
//   · HTTP 非 ok 响应 → onError
//   · 网络异常 → onError（非 AbortError）
//   · AbortError 静默忽略
//   · 非 JSON 数据行被忽略（心跳容错）
//   · 多帧拼接 + 跨 chunk 分割
// ════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chatProvider } from "./provider.js";

// ── SSE 帧构造工具 ──────────────────────────────────────────

/** 构造 OpenAI 风格增量 token 帧 */
function tokenFrame(content) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

/** message 风格（非增量）帧 */
function messageFrame(content) {
  return `data: ${JSON.stringify({ choices: [{ message: { content } }] })}\n\n`;
}

const DONE_FRAME = "data: [DONE]\n\n";

/** 用帧数组构造 ReadableStream */
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

/** 安装 fetch mock */
function mockFetch(responseOrFn) {
  const fn = typeof responseOrFn === "function" ? responseOrFn : async () => responseOrFn;
  vi.stubGlobal("fetch", vi.fn(fn));
}

function makeSSEBody(frames) {
  return { ok: true, body: streamFromFrames(frames), status: 200 };
}

// ── 测试 ────────────────────────────────────────────────────

describe("chatProvider.stream", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("解析 token 帧并通过 onToken 回调传递内容", async () => {
    mockFetch(makeSSEBody([tokenFrame("Hello"), tokenFrame(" world"), DONE_FRAME]));
    const tokens = [];
    const onDone = vi.fn();
    await chatProvider.stream([{ role: "user", content: "hi" }], {
      onToken: (t) => tokens.push(t),
      onDone,
    });
    expect(tokens).toEqual(["Hello", " world"]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("处理 [DONE] 帧并正常终止", async () => {
    mockFetch(makeSSEBody([tokenFrame("only"), DONE_FRAME]));
    const onDone = vi.fn();
    const onError = vi.fn();
    await chatProvider.stream([], { onToken: () => {}, onDone, onError });
    expect(onDone).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("流自然结束时调用 onDone", async () => {
    // 没有 [DONE] 帧，流直接 close
    mockFetch(makeSSEBody([tokenFrame("A"), tokenFrame("B")]));
    const tokens = [];
    const onDone = vi.fn();
    await chatProvider.stream([], { onToken: (t) => tokens.push(t), onDone });
    expect(tokens).toEqual(["A", "B"]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("支持 message.content 格式（非增量）", async () => {
    mockFetch(makeSSEBody([messageFrame("full message"), DONE_FRAME]));
    const tokens = [];
    await chatProvider.stream([], { onToken: (t) => tokens.push(t), onDone: () => {} });
    expect(tokens).toEqual(["full message"]);
  });

  it("HTTP 非 ok 响应调用 onError", async () => {
    mockFetch(async () => ({ ok: false, status: 500, body: null }));
    const onError = vi.fn();
    const onDone = vi.fn();
    await chatProvider.stream([], { onToken: () => {}, onDone, onError });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toContain("500");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("body 为 null 时调用 onError", async () => {
    mockFetch(async () => ({ ok: true, body: null, status: 200 }));
    const onError = vi.fn();
    await chatProvider.stream([], { onToken: () => {}, onError });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("网络异常调用 onError", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const onError = vi.fn();
    await chatProvider.stream([], { onToken: () => {}, onError });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toContain("Failed to fetch");
  });

  it("AbortError 被静默忽略（不调用 onError）", async () => {
    mockFetch(async () => {
      const err = new DOMException("The operation was aborted", "AbortError");
      throw err;
    });
    const onError = vi.fn();
    const onDone = vi.fn();
    await chatProvider.stream([], { onToken: () => {}, onError, onDone });
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("忽略非 JSON 数据行（心跳容错）", async () => {
    const heartbeat = ": heartbeat\n\n";
    mockFetch(makeSSEBody([heartbeat, tokenFrame("ok"), heartbeat, DONE_FRAME]));
    const tokens = [];
    const onError = vi.fn();
    await chatProvider.stream([], { onToken: (t) => tokens.push(t), onError, onDone: () => {} });
    expect(tokens).toEqual(["ok"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("跨 chunk 分割：帧跨越多个 ReadableStream chunk", async () => {
    // 一个 token 帧被拆到两个 chunk 中
    const frame = tokenFrame("split");
    const half = Math.floor(frame.length / 2);
    const chunk1 = frame.slice(0, half);
    const chunk2 = frame.slice(half);
    const enc = new TextEncoder();
    let i = 0;
    const chunks = [chunk1, chunk2, DONE_FRAME];
    const stream = new ReadableStream({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(enc.encode(chunks[i++]));
        } else {
          controller.close();
        }
      },
    });
    mockFetch({ ok: true, body: stream, status: 200 });

    const tokens = [];
    await chatProvider.stream([], { onToken: (t) => tokens.push(t), onDone: () => {} });
    expect(tokens).toEqual(["split"]);
  });

  it("转发 signal 到 fetch", async () => {
    mockFetch(makeSSEBody([DONE_FRAME]));
    const ac = new AbortController();
    await chatProvider.stream([], {
      onToken: () => {},
      onDone: () => {},
      signal: ac.signal,
    });
    // 验证 fetch 被调用时传入了 signal
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const callArgs = globalThis.fetch.mock.calls[0][1];
    expect(callArgs.signal).toBe(ac.signal);
  });

  it("发送正确的请求格式", async () => {
    mockFetch(makeSSEBody([DONE_FRAME]));
    const msgs = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hi" },
    ];
    await chatProvider.stream(msgs, { onToken: () => {}, onDone: () => {} });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ messages: msgs });
  });

  it("onDone 只被调用一次（即使收到多个 [DONE] 帧）", async () => {
    mockFetch(makeSSEBody([tokenFrame("x"), DONE_FRAME]));
    const onDone = vi.fn();
    await chatProvider.stream([], { onToken: () => {}, onDone });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
