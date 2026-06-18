/**
 * messagesClient —— 留言板前端客户端
 *
 * 封装对服务端代理 `/api/messages` REST 端点的调用：
 *   - list   GET    /api/messages?limit&before  → { items, total, hasMore }
 *   - create POST   /api/messages               → { item }
 *   - edit   PATCH  /api/messages/:id            → { item }
 *   - remove DELETE /api/messages/:id            → { ok: true }
 *
 * 错误约定（Req 20.8 的上游基础）：对任意非 2xx 响应，读取响应体 JSON 的
 * `error` 字段作为错误码（code），以 `Object.assign(new Error(code), { code, status })`
 * 形式抛出，供 Notepad UI 据 code 映射友好双语文案。网络异常或响应体非 JSON 时，
 * 回退为通用 code（分别为 "network_error" / "bad_response"）。
 *
 * _Requirements: 20.3, 20.4, 20.5_
 */

const DEFAULT_BASE = "/api/messages";

/**
 * 构造带 code/status 的错误对象。
 * @param {string} code 错误码
 * @param {number} status HTTP 状态码（网络异常时为 0）
 * @returns {Error & { code: string, status: number }}
 */
function clientError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

/**
 * 解析非 ok 响应体，提取错误码并抛出带 code/status 的错误。
 * @param {Response} res
 * @returns {Promise<never>}
 */
async function throwForResponse(res) {
  let code = "request_failed";
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") code = body.error;
  } catch {
    code = "bad_response";
  }
  throw clientError(code, res.status);
}

/**
 * 安全解析 ok 响应体；解析失败抛出 bad_response。
 * @param {Response} res
 * @returns {Promise<any>}
 */
async function parseJson(res) {
  try {
    return await res.json();
  } catch {
    throw clientError("bad_response", res.status);
  }
}

export const messagesClient = {
  base: DEFAULT_BASE,

  /**
   * 拉取留言列表（按 createdAt 倒序，分页/限量）。
   * @param {{ limit?: number, before?: number }} [opts]
   * @returns {Promise<{ items: object[], total: number, hasMore: boolean }>}
   */
  async list({ limit = 50, before } = {}) {
    const params = new URLSearchParams();
    if (limit != null) params.set("limit", String(limit));
    if (before != null) params.set("before", String(before));
    const qs = params.toString();
    const url = qs ? `${this.base}?${qs}` : this.base;

    let res;
    try {
      res = await fetch(url, { method: "GET" });
    } catch {
      throw clientError("network_error", 0);
    }
    if (!res.ok) return throwForResponse(res);
    return parseJson(res);
  },

  /**
   * 创建一条留言。
   * @param {{ nickname?: string, text: string, ownerId: string }} input
   * @returns {Promise<{ item: object }>}
   */
  async create({ nickname, text, ownerId }) {
    let res;
    try {
      res = await fetch(this.base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, text, ownerId }),
      });
    } catch {
      throw clientError("network_error", 0);
    }
    if (!res.ok) return throwForResponse(res);
    const item = await parseJson(res);
    return { item };
  },

  /**
   * 编辑本人留言（基于 ownerId 的尽力而为归属判定）。
   * @param {string} id
   * @param {{ text: string, ownerId: string }} input
   * @returns {Promise<{ item: object }>}
   */
  async edit(id, { text, ownerId }) {
    let res;
    try {
      res = await fetch(`${this.base}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ownerId }),
      });
    } catch {
      throw clientError("network_error", 0);
    }
    if (!res.ok) return throwForResponse(res);
    const item = await parseJson(res);
    return { item };
  },

  /**
   * 删除本人留言（基于 ownerId 的尽力而为归属判定）。
   * @param {string} id
   * @param {{ ownerId: string }} input
   * @returns {Promise<{ ok: true }>}
   */
  async remove(id, { ownerId }) {
    let res;
    try {
      res = await fetch(`${this.base}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId }),
      });
    } catch {
      throw clientError("network_error", 0);
    }
    if (!res.ok) return throwForResponse(res);
    return parseJson(res);
  },

  /**
   * 管理员删除单条留言（跳过 ownerId 校验，需 adminKey 鉴权）。
   * @param {string} id
   * @param {string} adminKey
   * @returns {Promise<{ ok: true }>}
   */
  async adminDelete(id, adminKey) {
    let res;
    try {
      res = await fetch(`/api/admin/messages/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-admin-key": adminKey },
      });
    } catch {
      throw clientError("network_error", 0);
    }
    if (!res.ok) return throwForResponse(res);
    return parseJson(res);
  },

  /**
   * 管理员清空全部留言（需 adminKey 鉴权）。
   * @param {string} adminKey
   * @returns {Promise<{ ok: true, deleted: number }>}
   */
  async adminClearAll(adminKey) {
    let res;
    try {
      res = await fetch("/api/admin/messages", {
        method: "DELETE",
        headers: { "x-admin-key": adminKey },
      });
    } catch {
      throw clientError("network_error", 0);
    }
    if (!res.ok) return throwForResponse(res);
    return parseJson(res);
  },
};
