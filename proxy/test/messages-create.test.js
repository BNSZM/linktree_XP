// Tests for POST /api/messages create endpoint — Task 18.2.
// Covers the pure helpers (validateMessageInput / escapeHtml / buildMessage)
// and the real HTTP route, using an isolated temp MESSAGES_FILE (no mocks,
// no upstream network). Requirements: 17.5, 20.3, 20.10, 20.11, 20.12.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

// Isolate the store at a temp file and give the write limiter generous head
// room so functional create tests do not trip the per-IP write throttle.
// (Rate limiting itself is verified in messages-create-ratelimit.test.js,
// which runs in its own process via `node --test`.)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcreate-"));
const messagesFile = path.join(tmpDir, "messages.json");
process.env.MESSAGES_FILE = messagesFile;
process.env.WRITE_RATE_MAX = "100";

const {
  server,
  validateMessageInput,
  escapeHtml,
  buildMessage,
  readStore,
} = await import("../server.js");

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

// --- escapeHtml -----------------------------------------------------------

test("escapeHtml: escapes the five HTML metacharacters", () => {
  assert.equal(
    escapeHtml(`<script>alert("x")&'</script>`),
    "&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&lt;/script&gt;"
  );
});

test("escapeHtml: ampersand escaped first (no double-escaping of entities)", () => {
  assert.equal(escapeHtml("a & b < c"), "a &amp; b &lt; c");
});

// --- validateMessageInput -------------------------------------------------

test("validateMessageInput: accepts valid body and normalizes fields", () => {
  const r = validateMessageInput(
    { nickname: "Bob", text: "hello", ownerId: "u1" },
    { maxMsgLen: 500, maxNickLen: 24 }
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { nickname: "Bob", text: "hello", ownerId: "u1" });
});

test("validateMessageInput: missing/blank text -> 400 bad_request", () => {
  for (const text of [undefined, "", "   ", 123, null]) {
    const r = validateMessageInput({ text, ownerId: "u1" });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "bad_request");
    assert.equal(r.body.field, "text");
  }
});

test("validateMessageInput: missing ownerId -> 400 bad_request", () => {
  const r = validateMessageInput({ text: "hi" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "bad_request");
  assert.equal(r.body.field, "ownerId");
});

test("validateMessageInput: text over MAX_MSG_LEN -> 400 too_long", () => {
  const r = validateMessageInput(
    { text: "x".repeat(11), ownerId: "u1" },
    { maxMsgLen: 10, maxNickLen: 24 }
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: "too_long", field: "text", max: 10 });
});

test("validateMessageInput: nickname over MAX_NICK_LEN -> 400 too_long", () => {
  const r = validateMessageInput(
    { nickname: "n".repeat(25), text: "hi", ownerId: "u1" },
    { maxMsgLen: 500, maxNickLen: 24 }
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.body, { error: "too_long", field: "nickname", max: 24 });
});

test("validateMessageInput: length counts Unicode code points (emoji = 1)", () => {
  // 5 emoji = 5 code points, within a maxMsgLen of 5.
  const r = validateMessageInput(
    { text: "😀😀😀😀😀", ownerId: "u1" },
    { maxMsgLen: 5, maxNickLen: 24 }
  );
  assert.equal(r.ok, true);
});

// --- buildMessage ---------------------------------------------------------

test("buildMessage: escapes nickname/text, sets id + createdAt", () => {
  const before = Date.now();
  const item = buildMessage({
    nickname: "<b>",
    text: "<i>hi</i>",
    ownerId: "u1",
  });
  assert.match(item.id, /[0-9a-f-]{36}/);
  assert.equal(item.nickname, "&lt;b&gt;");
  assert.equal(item.text, "&lt;i&gt;hi&lt;/i&gt;");
  assert.equal(item.ownerId, "u1");
  assert.ok(item.createdAt >= before && item.createdAt <= Date.now());
});

test("buildMessage: empty nickname stored as empty string", () => {
  const item = buildMessage({ nickname: "", text: "hi", ownerId: "u1" });
  assert.equal(item.nickname, "");
});

// --- HTTP route -----------------------------------------------------------

function post(pathname, payload, port) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data.length,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, json: JSON.parse(body || "{}") })
        );
      }
    );
    req.on("error", reject);
    req.end(data);
  });
}

test("POST /api/messages: creates, returns 201 item, persists escaped", async (t) => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  t.after(() => new Promise((r) => server.close(r)));

  // Success: 201 with the created item.
  const ok = await post(
    "/api/messages",
    { nickname: "Alice", text: "hello world", ownerId: "owner-1" },
    port
  );
  assert.equal(ok.status, 201);
  assert.match(ok.json.id, /[0-9a-f-]{36}/);
  assert.equal(ok.json.nickname, "Alice");
  assert.equal(ok.json.text, "hello world");
  assert.equal(ok.json.ownerId, "owner-1");
  assert.equal(typeof ok.json.createdAt, "number");

  // Persisted to the store on disk.
  const stored = readStore(messagesFile);
  assert.equal(stored.items.length, 1);
  assert.equal(stored.items[0].id, ok.json.id);

  // XSS payload: stored value is HTML-escaped (Req 17.5).
  const xss = await post(
    "/api/messages",
    { nickname: "<b>", text: `<img src=x onerror=alert(1)>`, ownerId: "o2" },
    port
  );
  assert.equal(xss.status, 201);
  assert.equal(xss.json.text, "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(xss.json.nickname, "&lt;b&gt;");
  assert.ok(!xss.json.text.includes("<"));

  // too_long text -> 400 and NOT persisted (Req 20.10).
  const countBefore = readStore(messagesFile).items.length;
  const tooLong = await post(
    "/api/messages",
    { text: "x".repeat(501), ownerId: "o3" },
    port
  );
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.json.error, "too_long");
  assert.equal(tooLong.json.field, "text");
  assert.equal(readStore(messagesFile).items.length, countBefore);

  // Missing text -> 400 bad_request.
  const bad = await post("/api/messages", { ownerId: "o4" }, port);
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "bad_request");
});
