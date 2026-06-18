// Feature: xp-desktop-window-manager, Property 13: 服务端最大长度强制
//
// Property 13 (design.md): 对任意超过服务端最大长度的留言文本或昵称，
// 创建/编辑一律被拒（400 too_long），且不写入存储。
// Validates: Requirements 20.10, 20.14
//
// 策略：通过真实 HTTP 路由（POST 创建 / PATCH 编辑）行使完整校验+持久化路径，
// 每次迭代使用独立的临时 MESSAGES_FILE 以隔离存储，断言：
//   1) 响应一律 400，且 body.error === "too_long"；
//   2) 存储不被写入（创建：仍为空集合；编辑：原留言保持不变）。
// 写限流阈值在导入前调高，避免高频迭代触发 429 掩盖 400。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import fc from "fast-check";

// 提高写限流上限，确保 ≥100 次迭代不被 429 掩盖（必须在导入 server 之前设置）。
process.env.WRITE_RATE_MAX = "1000000";
// 初始指向一个临时文件；每次迭代会被覆盖为独立的临时文件。
const bootDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxlen-boot-"));
process.env.MESSAGES_FILE = path.join(bootDir, "messages.json");

const { server, readStore, writeStore, buildMessage } = await import(
  "../server.js"
);

// 与服务端默认一致（server.js: MAX_MSG_LEN=500, MAX_NICK_LEN=24）。
const MAX_MSG_LEN = 500;
const MAX_NICK_LEN = 24;

let port;

before(
  () =>
    new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        port = server.address().port;
        resolve();
      });
    })
);

after(() => {
  return new Promise((resolve) => server.close(resolve)).finally(() => {
    try {
      fs.rmSync(bootDir, { recursive: true, force: true });
    } catch {}
  });
});

/** 发起一次 JSON 请求，解析为 { status, json }。 */
function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, json: JSON.parse(buf || "{}") })
        );
      }
    );
    req.on("error", reject);
    req.end(data);
  });
}

/** 每次迭代分配一个独立的临时 MESSAGES_FILE 并切换 env。 */
function useFreshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxlen-"));
  const file = path.join(dir, "messages.json");
  process.env.MESSAGES_FILE = file;
  return { dir, file };
}

// 超长字段生成器：默认 ASCII 可打印字符，码点数 == 长度 > 上限。
// 过滤纯空白串：确保 trim 后仍非空，避免被 validateMessageInput 的"文本为空"校验
// 先于长度校验拦截（那会返回 bad_request 而非 too_long）。
const overLenText = fc.string({
  minLength: MAX_MSG_LEN + 1,
  maxLength: MAX_MSG_LEN + 80,
}).filter((s) => s.trim().length > 0);
const overLenNick = fc.string({
  minLength: MAX_NICK_LEN + 1,
  maxLength: MAX_NICK_LEN + 60,
}).filter((s) => s.trim().length > 0);
const validText = fc.string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);
const ownerIdArb = fc.string({ minLength: 1, maxLength: 16 })
  .filter((s) => s.trim().length > 0);

// 创建场景：text 超长（昵称合法）或 nickname 超长（text 合法）。
const createPayloadArb = fc.oneof(
  // text 超长
  fc.record({
    nickname: fc.string({ maxLength: MAX_NICK_LEN }),
    text: overLenText,
    ownerId: ownerIdArb,
  }),
  // nickname 超长
  fc.record({
    nickname: overLenNick,
    text: validText,
    ownerId: ownerIdArb,
  })
);

// 编辑场景：text 超长（nickname 省略）或 nickname 超长（text 合法）。
const editPayloadArb = fc.oneof(
  fc.record({ text: overLenText, ownerId: ownerIdArb }),
  fc.record({ nickname: overLenNick, text: validText, ownerId: ownerIdArb })
);

test("property: 超长创建一律 400 too_long 且不写入存储", async () => {
  await fc.assert(
    fc.asyncProperty(createPayloadArb, async (payload) => {
      const { dir, file } = useFreshStore();
      try {
        const res = await request("POST", "/api/messages", payload);
        // 一律拒绝：400 too_long。
        assert.equal(res.status, 400, "over-length create must be 400");
        assert.equal(res.json.error, "too_long");
        // 不写入存储：临时文件保持空集合（校验先于任何写入）。
        const store = readStore(file);
        assert.equal(store.items.length, 0, "nothing must be persisted");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }),
    { numRuns: 120 }
  );
});

test("property: 超长编辑一律 400 too_long 且不改动存储", async () => {
  await fc.assert(
    fc.asyncProperty(editPayloadArb, async (payload) => {
      const { dir, file } = useFreshStore();
      try {
        // 先种入一条合法留言，编辑请求需匹配其 ownerId 才会进入长度校验路径。
        const seeded = buildMessage({
          nickname: "seed",
          text: "original-text",
          ownerId: payload.ownerId,
        });
        writeStore({ version: 1, items: [seeded] }, file);
        const before = JSON.stringify(readStore(file));

        const res = await request(
          "PATCH",
          `/api/messages/${encodeURIComponent(seeded.id)}`,
          payload
        );
        assert.equal(res.status, 400, "over-length edit must be 400");
        assert.equal(res.json.error, "too_long");
        // 存储未被改动：与种入时完全一致。
        const after = JSON.stringify(readStore(file));
        assert.equal(after, before, "stored message must be unchanged");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }),
    { numRuns: 120 }
  );
});
