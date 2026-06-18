// ════════════════════════════════════════════════════════════
// messagesClient 单元测试（RC 审计 #10 修复）
//
// 覆盖：
//   · list: 正常返回 / 带参数分页 / HTTP 错误 / 网络异常
//   · create: 正常创建 / 请求体格式 / HTTP 错误
//   · edit: 正常编辑 / URL 编码
//   · remove: 正常删除 / ownerId 传递
//   · adminDelete: 管理员删除 / adminKey 头
//   · adminClearAll: 管理员清空 / adminKey 头
//   · 错误码提取：JSON body.error → code / 非 JSON → bad_response / 网络 → network_error
// ════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from "vitest";
import { messagesClient } from "./messages-client.js";

// ── Mock 工具 ────────────────────────────────────────────────

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function errorResponse(errorCode, status) {
  return {
    ok: false,
    status,
    json: async () => ({ error: errorCode }),
  };
}

function nonJsonResponse(status) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token");
    },
  };
}

function mockFetch(resOrFn) {
  const fn = typeof resOrFn === "function" ? resOrFn : async () => resOrFn;
  vi.stubGlobal("fetch", vi.fn(fn));
}

// ── 测试 ────────────────────────────────────────────────────

describe("messagesClient.list", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("正常获取留言列表", async () => {
    const data = { items: [{ id: "1", text: "hi" }], total: 1, hasMore: false };
    mockFetch(jsonResponse(data));
    const result = await messagesClient.list();
    expect(result).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/messages?limit=50");
    expect(opts.method).toBe("GET");
  });

  it("支持分页参数 limit + before", async () => {
    mockFetch(jsonResponse({ items: [], total: 0, hasMore: false }));
    await messagesClient.list({ limit: 10, before: 1700000000 });
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("limit=10");
    expect(url).toContain("before=1700000000");
  });

  it("HTTP 错误提取 error code", async () => {
    mockFetch(errorResponse("rate_limited", 429));
    await expect(messagesClient.list()).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
  });

  it("网络异常返回 network_error", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(messagesClient.list()).rejects.toMatchObject({
      code: "network_error",
      status: 0,
    });
  });

  it("非 JSON 响应返回 bad_response", async () => {
    mockFetch(nonJsonResponse(500));
    await expect(messagesClient.list()).rejects.toMatchObject({
      code: "bad_response",
      status: 500,
    });
  });
});

describe("messagesClient.create", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("正常创建留言", async () => {
    const item = { id: "abc", nickname: "Test", text: "Hello" };
    // create 方法在 parseJson 结果外再包 { item }，所以服务端响应体直接是 item 对象
    mockFetch(jsonResponse(item));
    const result = await messagesClient.create({
      nickname: "Test",
      text: "Hello",
      ownerId: "visitor-1",
    });
    expect(result).toEqual({ item });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/messages");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      nickname: "Test",
      text: "Hello",
      ownerId: "visitor-1",
    });
  });

  it("服务端拒绝时抛出带 code 的错误", async () => {
    mockFetch(errorResponse("too_long", 400));
    await expect(
      messagesClient.create({ text: "x".repeat(600), ownerId: "v1" })
    ).rejects.toMatchObject({ code: "too_long", status: 400 });
  });

  it("网络异常返回 network_error", async () => {
    mockFetch(async () => {
      throw new TypeError("offline");
    });
    await expect(
      messagesClient.create({ text: "hi", ownerId: "v1" })
    ).rejects.toMatchObject({ code: "network_error", status: 0 });
  });
});

describe("messagesClient.edit", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("正常编辑留言并正确编码 URL", async () => {
    const item = { id: "msg-1", text: "Updated" };
    // edit 方法在 parseJson 结果外再包 { item }，所以服务端响应体直接是 item 对象
    mockFetch(jsonResponse(item));
    const result = await messagesClient.edit("msg-1", {
      text: "Updated",
      ownerId: "visitor-1",
    });
    expect(result).toEqual({ item });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/messages/msg-1");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({
      text: "Updated",
      ownerId: "visitor-1",
    });
  });

  it("ID 含特殊字符时正确 encodeURIComponent", async () => {
    mockFetch(jsonResponse({ item: {} }));
    await messagesClient.edit("id/with spaces&special", {
      text: "t",
      ownerId: "o",
    });
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain(encodeURIComponent("id/with spaces&special"));
  });

  it("非本人留言返回 unauthorized", async () => {
    mockFetch(errorResponse("unauthorized", 403));
    await expect(
      messagesClient.edit("msg-1", { text: "x", ownerId: "wrong" })
    ).rejects.toMatchObject({ code: "unauthorized", status: 403 });
  });
});

describe("messagesClient.remove", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("正常删除留言", async () => {
    mockFetch(jsonResponse({ ok: true }));
    const result = await messagesClient.remove("msg-1", { ownerId: "visitor-1" });
    expect(result).toEqual({ ok: true });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/messages/msg-1");
    expect(opts.method).toBe("DELETE");
    expect(JSON.parse(opts.body)).toEqual({ ownerId: "visitor-1" });
  });

  it("网络异常返回 network_error", async () => {
    mockFetch(async () => {
      throw new TypeError("connection reset");
    });
    await expect(
      messagesClient.remove("msg-1", { ownerId: "v1" })
    ).rejects.toMatchObject({ code: "network_error", status: 0 });
  });
});

describe("messagesClient.adminDelete", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("管理员删除携带 x-admin-key 头", async () => {
    mockFetch(jsonResponse({ ok: true }));
    const result = await messagesClient.adminDelete("msg-1", "secret-key");
    expect(result).toEqual({ ok: true });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/admin/messages/msg-1");
    expect(opts.method).toBe("DELETE");
    expect(opts.headers["x-admin-key"]).toBe("secret-key");
  });

  it("adminKey 错误返回 unauthorized", async () => {
    mockFetch(errorResponse("unauthorized", 401));
    await expect(messagesClient.adminDelete("msg-1", "wrong")).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
  });
});

describe("messagesClient.adminClearAll", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("管理员清空全部留言", async () => {
    mockFetch(jsonResponse({ ok: true, deleted: 42 }));
    const result = await messagesClient.adminClearAll("admin-key");
    expect(result).toEqual({ ok: true, deleted: 42 });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/admin/messages");
    expect(opts.method).toBe("DELETE");
    expect(opts.headers["x-admin-key"]).toBe("admin-key");
  });

  it("网络异常返回 network_error", async () => {
    mockFetch(async () => {
      throw new TypeError("timeout");
    });
    await expect(messagesClient.adminClearAll("key")).rejects.toMatchObject({
      code: "network_error",
      status: 0,
    });
  });
});

describe("messagesClient 错误码提取", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("从 JSON body.error 提取错误码", async () => {
    mockFetch(errorResponse("payload_too_large", 413));
    try {
      await messagesClient.list();
      expect.unreachable("should throw");
    } catch (e) {
      expect(e.code).toBe("payload_too_large");
      expect(e.status).toBe(413);
      expect(e.message).toBe("payload_too_large");
    }
  });

  it("非 JSON 响应体降级为 bad_response", async () => {
    mockFetch(nonJsonResponse(502));
    try {
      await messagesClient.list();
      expect.unreachable("should throw");
    } catch (e) {
      expect(e.code).toBe("bad_response");
      expect(e.status).toBe(502);
    }
  });

  it("错误对象是 Error 实例且带有 code/status 属性", async () => {
    mockFetch(errorResponse("not_found", 404));
    try {
      await messagesClient.list();
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toHaveProperty("code", "not_found");
      expect(e).toHaveProperty("status", 404);
    }
  });
});
