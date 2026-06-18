// FastGPT 对话代理 —— 零依赖（Node 18+，用全局 fetch）
// 作用：前端只调本服务 /api/chat，由本服务带着密钥转发到 FastGPT。
// 密钥仅来自环境变量 / .env，绝不出现在前端。
import http from "node:http";
import fs from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  STORE_VERSION,
  getMessagesFile,
  emptyStore,
  readStore,
  writeStore,
  withWriteLock,
  mutateStore,
} from "./storage.js";

// --- 极简 .env 加载（开发用；生产可用 docker env / systemd 注入） ---
try {
  if (fs.existsSync(".env")) {
    for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
} catch (e) {
  console.warn("[warn] .env load failed:", e.message);
}

const PORT = process.env.PORT || 8787;
const BASE = (process.env.FASTGPT_BASE_URL || "").replace(/\/$/, "");
const KEY = process.env.FASTGPT_API_KEY || "";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 64 * 1024);

// 留言列表分页/限量（Req 20.4, 20.15）：默认与最大 limit，避免列表无限增长。
const DEFAULT_MSG_LIMIT = Number(process.env.MSG_DEFAULT_LIMIT) || 50;
const MAX_MSG_LIMIT = Number(process.env.MSG_MAX_LIMIT) || 100;

// 留言服务端最大长度（Req 20.10）：超限返回 400 too_long。
const MAX_MSG_LEN = Number(process.env.MAX_MSG_LEN) || 500;
const MAX_NICK_LEN = Number(process.env.MAX_NICK_LEN) || 24;

// 管理员密钥（Req Admin.1）：设置后启用管理端点，未设置时管理端点返回 503。
const ADMIN_KEY = process.env.ADMIN_KEY || "";

if (!BASE) console.warn("[warn] FASTGPT_BASE_URL 未设置");
if (!KEY) console.warn("[warn] FASTGPT_API_KEY 未设置 —— /api/chat 将返回 500");

// --- 简易按 IP 限流：默认 60 秒内最多 30 次 ---
const hits = new Map();
const READ_RATE_WINDOW_MS = Number(process.env.READ_RATE_WINDOW_MS) || 60_000;
const READ_RATE_MAX = Number(process.env.READ_RATE_MAX) || 30;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < READ_RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > READ_RATE_MAX;
}

// --- 写操作按 IP 限流（Req 20.11）：复用同样模式，阈值更严（60 秒最多 10 次写）。
// 单独的命中表，避免与 /api/chat 的读限流互相影响。 ---
const writeHits = new Map();
const WRITE_RATE_WINDOW_MS = Number(process.env.WRITE_RATE_WINDOW_MS) || 60_000;
const WRITE_RATE_MAX = Number(process.env.WRITE_RATE_MAX) || 10;
function writeRateLimited(ip) {
  const now = Date.now();
  const arr = (writeHits.get(ip) || []).filter(
    (t) => now - t < WRITE_RATE_WINDOW_MS
  );
  arr.push(now);
  writeHits.set(ip, arr);
  return arr.length > WRITE_RATE_MAX;
}

// 定期清理过期 rate-limiter 条目，防止 Map 无限增长（内存泄露）
const RATE_CLEANUP_INTERVAL_MS = 5 * 60_000; // 每 5 分钟清理一次
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    const fresh = arr.filter((t) => now - t < READ_RATE_WINDOW_MS);
    if (fresh.length === 0) hits.delete(ip);
    else hits.set(ip, fresh);
  }
  for (const [ip, arr] of writeHits) {
    const fresh = arr.filter((t) => now - t < WRITE_RATE_WINDOW_MS);
    if (fresh.length === 0) writeHits.delete(ip);
    else writeHits.set(ip, fresh);
  }
}, RATE_CLEANUP_INTERVAL_MS).unref(); // .unref() 避免阻止进程退出

// ---------------------------------------------------------------------------
// 留言板 JSON 文件存储。
//
// 存储 helper 已抽取到独立模块 ./storage.js（便于测试与后续 REST 端点 18.x 复用）。
// 这里重新导出，使既有从 server.js 导入这些符号的消费者仍可工作。
// ---------------------------------------------------------------------------
export {
  STORE_VERSION,
  getMessagesFile,
  emptyStore,
  readStore,
  writeStore,
  withWriteLock,
  mutateStore,
};

// ---------------------------------------------------------------------------
// 留言列表分页/限量逻辑（Req 20.4, 20.15）。
//
// 抽成纯函数便于单元/属性测试，且 GET 路由处理器直接复用。
// ---------------------------------------------------------------------------

/**
 * 解析并钳制 limit：缺失/非法（非数字、≤0）→ 默认；否则向下取整并钳制到 [1, max]。
 */
export function resolveLimit(
  raw,
  { def = DEFAULT_MSG_LIMIT, max = MAX_MSG_LIMIT } = {}
) {
  const safeMax = Math.max(1, Math.floor(max));
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return Math.min(Math.max(1, Math.floor(def)), safeMax);
  }
  return Math.min(Math.floor(n), safeMax);
}

/**
 * 按 createdAt 倒序对留言集合分页/限量。
 *   - total：集合内留言总数（不受 before/limit 影响）。
 *   - before：可选游标，仅保留 createdAt 严格小于该值的留言（“加载更多”）。
 *   - items：倒序后取前 limit 条。
 *   - hasMore：经 before 过滤后是否仍有超过 limit 的留言。
 */
export function listMessages(items, { limit, before } = {}) {
  const all = Array.isArray(items) ? items : [];
  const total = all.length;
  const lim = resolveLimit(limit);

  const sorted = [...all].sort((a, b) => {
    const da = Number(a && a.createdAt) || 0;
    const db = Number(b && b.createdAt) || 0;
    if (db !== da) return db - da; // createdAt 倒序
    // 次序稳定：createdAt 相同时按 id 倒序，保证输出确定。
    return String(b && b.id).localeCompare(String(a && a.id));
  });

  const beforeNum = Number(before);
  const hasBefore =
    before !== undefined && before !== null && before !== "" &&
    Number.isFinite(beforeNum);
  const filtered = hasBefore
    ? sorted.filter((m) => (Number(m && m.createdAt) || 0) < beforeNum)
    : sorted;

  return {
    items: filtered.slice(0, lim),
    total,
    hasMore: filtered.length > lim,
  };
}

// ---------------------------------------------------------------------------
// 留言创建：校验 + HTML 转义 + 构造（Req 17.5, 20.10, 20.11, 20.12）。
//
// 抽成纯函数便于单元/属性测试；POST 路由处理器直接复用。
// ---------------------------------------------------------------------------

/** 按 Unicode 码点计数字符长度（emoji/代理对计 1），用于最大长度判定。 */
function charLen(s) {
  return [...String(s)].length;
}

/**
 * HTML 转义用户生成内容（Req 17.5）：转义 & < > " ' 五个元字符。
 * 入库前调用；前端额外以 textContent 渲染，双重防 XSS。
 * & 必须最先替换，避免把后续插入的实体再次转义。
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 校验创建留言的请求体 { nickname?, text, ownerId }。
 *   - text：必填非空字符串；缺失/空白 → 400 bad_request(field=text)。
 *   - ownerId：必填非空字符串；缺失 → 400 bad_request(field=ownerId)。
 *   - text 长度 > maxMsgLen → 400 too_long(field=text, max)。
 *   - nickname（可选）长度 > maxNickLen → 400 too_long(field=nickname, max)。
 * 长度按转义前的原始输入字符数判定（用户实际输入上限）。
 * 返回 { ok:true, value:{nickname,text,ownerId} } 或 { ok:false, status, body }。
 */
export function validateMessageInput(
  payload,
  { maxMsgLen = MAX_MSG_LEN, maxNickLen = MAX_NICK_LEN } = {}
) {
  const p = payload && typeof payload === "object" ? payload : {};
  const text = typeof p.text === "string" ? p.text : "";
  const ownerId = typeof p.ownerId === "string" ? p.ownerId : "";
  const nickname = typeof p.nickname === "string" ? p.nickname : "";

  if (!text.trim()) {
    return { ok: false, status: 400, body: { error: "bad_request", field: "text" } };
  }
  if (!ownerId) {
    return { ok: false, status: 400, body: { error: "bad_request", field: "ownerId" } };
  }
  if (charLen(text) > maxMsgLen) {
    return {
      ok: false,
      status: 400,
      body: { error: "too_long", field: "text", max: maxMsgLen },
    };
  }
  if (charLen(nickname) > maxNickLen) {
    return {
      ok: false,
      status: 400,
      body: { error: "too_long", field: "nickname", max: maxNickLen },
    };
  }
  return { ok: true, value: { nickname, text, ownerId } };
}

/**
 * 由已校验的输入构造一条待入库的留言。
 *   - id：服务端生成（crypto.randomUUID）。
 *   - nickname/text：HTML 转义后存储（空昵称存空串，前端显示默认匿名名）。
 *   - createdAt：epoch 毫秒。
 */
export function buildMessage({ nickname, text, ownerId }) {
  return {
    id: randomUUID(),
    nickname: escapeHtml(nickname || ""),
    text: escapeHtml(text),
    ownerId: String(ownerId),
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// 留言编辑/删除：归属判定（Req 20.5, 20.6, 20.7）。
//
// 抽成纯函数便于单元/属性测试；PATCH/DELETE 路由处理器在写锁内复用。
// 归属判定为“尽力而为”控制（非安全边界）：仅比对请求 ownerId 与存储 ownerId。
//   - 未找到 → { status: 404, body: { error: "not_found" } }
//   - ownerId 不匹配 → { status: 403, body: { error: "forbidden" } }
//   - 匹配 → 就地修改 store.items 并返回 { status: 200, body: <结果>, changed: true }
// 仅当 changed 为 true 时调用方才落盘，避免对拒绝路径产生无谓写入。
// ---------------------------------------------------------------------------

/**
 * 在 store 中按 id 定位留言并校验归属。
 * 返回 { idx, outcome }：outcome 为非 200 的拒绝结果（404/403）或 null（命中且归属匹配）。
 */
function locateOwned(store, id, ownerId) {
  const items = Array.isArray(store && store.items) ? store.items : [];
  const idx = items.findIndex((m) => m && String(m.id) === String(id));
  if (idx === -1) {
    return { idx: -1, outcome: { status: 404, body: { error: "not_found" } } };
  }
  if (String(items[idx].ownerId) !== String(ownerId)) {
    return { idx, outcome: { status: 403, body: { error: "forbidden" } } };
  }
  return { idx, outcome: null };
}

/**
 * 对 store 施加一次编辑（就地修改）。text 入库前 HTML 转义（Req 17.5）。
 * 调用前应已用 validateMessageInput 校验过 text 非空与最大长度（Req 20.10）。
 * 返回 { status, body, changed }；changed 为 true 时调用方需落盘。
 */
export function applyEdit(store, id, { text, ownerId }) {
  const { idx, outcome } = locateOwned(store, id, ownerId);
  if (outcome) return { ...outcome, changed: false };
  const updated = { ...store.items[idx], text: escapeHtml(text) };
  store.items[idx] = updated;
  return { status: 200, body: updated, changed: true };
}

/**
 * 从 store 中删除一条留言（就地修改）。
 * 返回 { status, body, changed }；changed 为 true 时调用方需落盘。
 */
export function applyDelete(store, id, { ownerId }) {
  const { idx, outcome } = locateOwned(store, id, ownerId);
  if (outcome) return { ...outcome, changed: false };
  store.items.splice(idx, 1);
  return { status: 200, body: { ok: true }, changed: true };
}

// ---------------------------------------------------------------------------
// 管理员操作：按 id 删除 / 清空全部（Req Admin.1/Admin.2）。
//
// 跳过 ownerId 归属判定，允许管理员管理所有留言。
// 抽成纯函数便于测试；管理员路由处理器在写锁内复用。
// ---------------------------------------------------------------------------

/**
 * 管理员按 id 删除留言（不校验 ownerId）。
 * 返回 { status, body, changed }。
 */
export function applyAdminDelete(store, id) {
  const items = Array.isArray(store && store.items) ? store.items : [];
  const idx = items.findIndex((m) => m && String(m.id) === String(id));
  if (idx === -1) {
    return { status: 404, body: { error: "not_found" }, changed: false };
  }
  store.items.splice(idx, 1);
  return { status: 200, body: { ok: true }, changed: true };
}

/**
 * 管理员清空全部留言。
 * 返回 { status, body, changed }（仅当原本有留言时 changed 为 true）。
 */
export function applyAdminClearAll(store) {
  const items = Array.isArray(store && store.items) ? store.items : [];
  const count = items.length;
  store.items = [];
  return { status: 200, body: { ok: true, deleted: count }, changed: count > 0 };
}

/**
 * 校验管理员密钥。
 * @param {string} reqKey 请求中携带的密钥
 * @returns {{ ok: boolean, status?: number, body?: object }}
 */
export function verifyAdminKey(reqKey) {
  if (!ADMIN_KEY) {
    return { ok: false, status: 503, body: { error: "admin_not_configured" } };
  }
  if (!reqKey) {
    return { ok: false, status: 401, body: { error: "unauthorized" } };
  }
  // 时序安全比较，防止 timing side-channel 攻击
  const a = Buffer.from(reqKey, "utf-8");
  const b = Buffer.from(ADMIN_KEY, "utf-8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, body: { error: "unauthorized" } };
  }
  return { ok: true };
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-admin-key"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS"
  );
}

/** 解析客户端 IP：优先 X-Forwarded-For 首段，回退 socket 远端地址。 */
function clientIp(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress
  );
}

/**
 * 读取请求体，复用 MAX_BODY_BYTES 体积上限（Req 20.3）。
 * 超限时立即解析为 { tooLarge: true }（停止累积 body）；否则 { tooLarge: false, body }。
 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    let bytes = 0;
    let aborted = false;
    req.on("data", (c) => {
      if (aborted) return;
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        aborted = true;
        resolve({ tooLarge: true });
        // 不调用 req.destroy()：让路由处理器正常发送 413 响应后再关闭连接。
        return;
      }
      body += c;
    });
    req.on("end", () => {
      if (!aborted) resolve({ tooLarge: false, body });
    });
    req.on("error", () => {
      if (!aborted) resolve({ tooLarge: false, body });
    });
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  const url = new URL(req.url || "/", "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, hasKey: !!KEY, base: !!BASE }));
  }

  // 留言列表：只读，按 createdAt 倒序 + 分页/限量（Req 20.4, 20.15）。
  if (req.method === "GET" && url.pathname === "/api/messages") {
    try {
      const store = readStore();
      const result = listMessages(store.items, {
        limit: url.searchParams.get("limit"),
        before: url.searchParams.get("before"),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "storage_failed" }));
    }
  }

  // 留言创建：写操作，校验 + 转义 + 写限流（Req 17.5, 20.3, 20.10, 20.11, 20.12）。
  if (req.method === "POST" && url.pathname === "/api/messages") {
    // 写限流（Req 20.11）：超频 429，先于体解析，尽早拒绝。
    if (writeRateLimited(clientIp(req))) {
      res.writeHead(429, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "rate_limited" }));
    }

    const { tooLarge, body } = await readJsonBody(req);
    if (tooLarge) {
      res.writeHead(413, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "payload_too_large" }));
    }

    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "bad_json" }));
    }

    // 服务端强制最大长度（Req 20.10）：超限 400 too_long，不写入存储。
    const v = validateMessageInput(payload, {
      maxMsgLen: MAX_MSG_LEN,
      maxNickLen: MAX_NICK_LEN,
    });
    if (!v.ok) {
      res.writeHead(v.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(v.body));
    }

    // HTML 转义 nickname/text 后入库（Req 17.5），原子写 + 写锁串行化。
    try {
      const item = buildMessage(v.value);
      await mutateStore((store) => {
        store.items.push(item);
        return item;
      });
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(item));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "storage_failed" }));
    }
  }

  // 留言编辑：PATCH /api/messages/:id（归属判定，Req 20.5–20.7, 20.10, 20.11）。
  // 比对请求 ownerId 与存储 ownerId：匹配则编辑并原子落盘；不匹配 403；未找到 404。
  // 编辑同样强制最大长度与 HTML 转义（复用 validateMessageInput / escapeHtml）。
  const editMatch =
    req.method === "PATCH" && url.pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (editMatch) {
    const id = decodeURIComponent(editMatch[1]);

    // 写限流（Req 20.11）：复用 POST 的写限流，先于体解析尽早拒绝。
    if (writeRateLimited(clientIp(req))) {
      res.writeHead(429, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "rate_limited" }));
    }

    const { tooLarge, body } = await readJsonBody(req);
    if (tooLarge) {
      res.writeHead(413, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "payload_too_large" }));
    }

    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "bad_json" }));
    }

    // 校验 text 非空 + ownerId 必填 + 最大长度（Req 20.10）。编辑不改昵称。
    const v = validateMessageInput(payload, {
      maxMsgLen: MAX_MSG_LEN,
      maxNickLen: MAX_NICK_LEN,
    });
    if (!v.ok) {
      res.writeHead(v.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(v.body));
    }

    // 写锁内做“读 → 归属判定 → （命中才）原子落盘”，避免拒绝路径无谓写入。
    try {
      const file = getMessagesFile();
      const result = await withWriteLock(() => {
        const store = readStore(file);
        const outcome = applyEdit(store, id, {
          text: v.value.text,
          ownerId: v.value.ownerId,
        });
        if (outcome.changed) writeStore(store, file);
        return outcome;
      });
      res.writeHead(result.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result.body));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "storage_failed" }));
    }
  }

  // 留言删除：DELETE /api/messages/:id（归属判定，Req 20.5–20.7, 20.11）。
  // ownerId 取自查询串或请求体；匹配则删除并原子落盘；不匹配 403；未找到 404。
  const delMatch =
    req.method === "DELETE" && url.pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (delMatch) {
    const id = decodeURIComponent(delMatch[1]);

    // 写限流（Req 20.11）。
    if (writeRateLimited(clientIp(req))) {
      res.writeHead(429, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "rate_limited" }));
    }

    // ownerId 优先取查询串；缺失时回退解析请求体。
    let ownerId = url.searchParams.get("ownerId") || "";
    if (!ownerId) {
      const { tooLarge, body } = await readJsonBody(req);
      if (tooLarge) {
        res.writeHead(413, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "payload_too_large" }));
      }
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "bad_json" }));
      }
      ownerId =
        payload && typeof payload.ownerId === "string" ? payload.ownerId : "";
    }
    if (!ownerId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "bad_request", field: "ownerId" }));
    }

    try {
      const file = getMessagesFile();
      const result = await withWriteLock(() => {
        const store = readStore(file);
        const outcome = applyDelete(store, id, { ownerId });
        if (outcome.changed) writeStore(store, file);
        return outcome;
      });
      res.writeHead(result.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result.body));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "storage_failed" }));
    }
  }

  // ---------------------------------------------------------------------------
  // 管理员端点（Req Admin.1/Admin.2）：
  //   DELETE /api/admin/messages/:id  → 管理员删除单条留言
  //   DELETE /api/admin/messages      → 管理员清空全部留言
  // 鉴权：x-admin-key 请求头必须与服务端 ADMIN_KEY 环境变量一致。
  // ---------------------------------------------------------------------------

  // 管理员删除单条留言：DELETE /api/admin/messages/:id
  const adminDelMatch =
    req.method === "DELETE" && url.pathname.match(/^\/api\/admin\/messages\/([^/]+)$/);
  if (adminDelMatch) {
    const id = decodeURIComponent(adminDelMatch[1]);
    const auth = verifyAdminKey(req.headers["x-admin-key"]);
    if (!auth.ok) {
      res.writeHead(auth.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(auth.body));
    }

    if (writeRateLimited(clientIp(req))) {
      res.writeHead(429, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "rate_limited" }));
    }

    try {
      const file = getMessagesFile();
      const result = await withWriteLock(() => {
        const store = readStore(file);
        const outcome = applyAdminDelete(store, id);
        if (outcome.changed) writeStore(store, file);
        return outcome;
      });
      res.writeHead(result.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result.body));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "storage_failed" }));
    }
  }

  // 管理员清空全部留言：DELETE /api/admin/messages
  if (req.method === "DELETE" && url.pathname === "/api/admin/messages") {
    const auth = verifyAdminKey(req.headers["x-admin-key"]);
    if (!auth.ok) {
      res.writeHead(auth.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(auth.body));
    }

    if (writeRateLimited(clientIp(req))) {
      res.writeHead(429, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "rate_limited" }));
    }

    try {
      const file = getMessagesFile();
      const result = await withWriteLock(() => {
        const store = readStore(file);
        const outcome = applyAdminClearAll(store);
        if (outcome.changed) writeStore(store, file);
        return outcome;
      });
      res.writeHead(result.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result.body));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "storage_failed" }));
    }
  }

  if (req.method !== "POST" || url.pathname !== "/api/chat") {
    res.writeHead(404);
    return res.end("Not Found");
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "rate_limited" }));
  }

  if (!KEY || !BASE) {
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "server_not_configured" }));
  }

  const { tooLarge, body } = await readJsonBody(req);
  if (tooLarge) {
    res.writeHead(413, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "payload_too_large" }));
  }

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "bad_json" }));
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "no_messages" }));
  }

  const upstreamBody = JSON.stringify({
    stream: true,
    detail: false,
    chatId: payload.chatId || undefined,
    messages,
  });

  try {
    // 上游请求超时保护（默认 120 秒，可通过 env 配置）
    const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 120_000;
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

    const upstream = await fetch(BASE + "/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + KEY,
        "Content-Type": "application/json",
      },
      body: upstreamBody,
      signal: ac.signal,
    });
    clearTimeout(timeoutId);

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => "");
      res.writeHead(upstream.status || 502, {
        "Content-Type": "application/json",
      });
      return res.end(
        JSON.stringify({ error: "upstream", status: upstream.status, detail: txt.slice(0, 500) })
      );
    }

    // 把上游 SSE 原样透传给前端
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const reader = upstream.body.getReader();
    const dec = new TextDecoder();

    // 客户端断连时主动取消上游读取，释放连接资源
    let clientClosed = false;
    req.on("close", () => {
      clientClosed = true;
      reader.cancel().catch(() => {});
    });

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (clientClosed) break;
      res.write(dec.decode(value, { stream: true }));
    }
    if (!clientClosed) res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "proxy_failed", detail: String(e).slice(0, 300) }));
    }
  }
});

// 仅当作为主入口直接运行时才监听端口；被测试/其他模块 import 时不自动启动，
// 以便复用上面的存储 helper 与 HTTP handler（design.md 测试策略）。
export { server };

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  server.listen(PORT, () =>
    console.log(`[fastgpt-proxy] listening on :${PORT} -> ${BASE || "(BASE unset)"}`)
  );
}
