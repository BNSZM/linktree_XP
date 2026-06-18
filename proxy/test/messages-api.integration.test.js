// Integration tests for the message-board backend — Task 18.9.
//
// Drives the REAL proxy HTTP server (started on an ephemeral port) end-to-end
// over real HTTP, against an ISOLATED temp MESSAGES_FILE. No mocks, no upstream
// network. Covers:
//   - full GET / POST / PATCH / DELETE flow: status codes, response shapes,
//     and on-disk persistence (Req 20.3, 20.4)
//   - messages survive a process/store "restart" (data lives in the JSON file,
//     re-read from disk independent of in-memory state) (Req 20.3, 20.4)
//   - exceeding the write rate threshold returns 429 (Req 20.11)
//   - /api/chat still returns its configured error response
//     (server_not_configured with no key), proving the SSE passthrough/error
//     handling was not broken by the message-board endpoints
//
// IMPORTANT: env vars are configured BEFORE importing server.js, because the
// proxy reads WRITE_RATE_MAX / FASTGPT_* into module-level constants at import.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

// --- Isolated store + deterministic, low write threshold -------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgapi-"));
const messagesFile = path.join(tmpDir, "messages.json");
process.env.MESSAGES_FILE = messagesFile;

// Deterministic write rate limit. Each test uses a distinct X-Forwarded-For IP
// so its rate-limit bucket is isolated; WRITE_MAX is set high enough that a
// normal CRUD flow (POST + several PATCH/DELETE writes on one IP) never trips,
// while the dedicated 429 test deliberately fires WRITE_MAX + 1 writes.
const WRITE_MAX = 8;
process.env.WRITE_RATE_MAX = String(WRITE_MAX);

// Force /api/chat into its "not configured" branch by clearing credentials.
// The proxy's .env loader only fills vars that are `undefined`, so setting
// them to "" here keeps them empty even if a local .env exists.
process.env.FASTGPT_API_KEY = "";
process.env.FASTGPT_BASE_URL = "";

const { server, readStore } = await import("../server.js");

let port;

before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

// --- Tiny real-HTTP client -------------------------------------------------
function request(method, pathname, { body, ip } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (payload !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    // Distinct client IP per logical test → isolated rate-limit bucket.
    if (ip) headers["X-Forwarded-For"] = ip;

    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method, headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let json;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, raw });
        });
      }
    );
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// --- Full CRUD flow --------------------------------------------------------
test("full GET/POST/PATCH/DELETE flow with correct status codes and shapes", async () => {
  const ip = "10.10.0.1";

  // Initially empty (Req 20.4: open loads previously-saved messages).
  const empty = await request("GET", "/api/messages", { ip });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json, { items: [], total: 0, hasMore: false });

  // POST creates a message (Req 20.3) → 201 with the full item shape.
  const created = await request("POST", "/api/messages", {
    ip,
    body: { nickname: "alice", text: "hello <b>world</b>", ownerId: "owner-1" },
  });
  assert.equal(created.status, 201);
  assert.equal(typeof created.json.id, "string");
  assert.ok(created.json.id.length > 0);
  assert.equal(typeof created.json.createdAt, "number");
  assert.equal(created.json.ownerId, "owner-1");
  // HTML-escaped on the server (Req 17.5).
  assert.equal(created.json.nickname, "alice");
  assert.equal(created.json.text, "hello &lt;b&gt;world&lt;/b&gt;");

  const id = created.json.id;

  // GET now lists the created message (newest-first list shape).
  const afterPost = await request("GET", "/api/messages", { ip });
  assert.equal(afterPost.status, 200);
  assert.equal(afterPost.json.total, 1);
  assert.equal(afterPost.json.items.length, 1);
  assert.equal(afterPost.json.items[0].id, id);

  // PATCH edits the message (correct owner) → 200 with updated item.
  const edited = await request("PATCH", `/api/messages/${id}`, {
    ip,
    body: { text: "edited text", ownerId: "owner-1" },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.id, id);
  assert.equal(edited.json.text, "edited text");

  // PATCH with the WRONG owner → 403 forbidden (best-effort ownership).
  const forbidden = await request("PATCH", `/api/messages/${id}`, {
    ip,
    body: { text: "hijack", ownerId: "someone-else" },
  });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(forbidden.json, { error: "forbidden" });

  // PATCH a non-existent id → 404 not_found.
  const missing = await request("PATCH", "/api/messages/does-not-exist", {
    ip,
    body: { text: "nope", ownerId: "owner-1" },
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { error: "not_found" });

  // DELETE with wrong owner → 403; message must remain.
  const delForbidden = await request("DELETE", `/api/messages/${id}`, {
    ip,
    body: { ownerId: "someone-else" },
  });
  assert.equal(delForbidden.status, 403);

  // DELETE with correct owner → 200 { ok: true }.
  const deleted = await request("DELETE", `/api/messages/${id}`, {
    ip,
    body: { ownerId: "owner-1" },
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.json, { ok: true });

  // GET confirms the store is empty again.
  const afterDelete = await request("GET", "/api/messages", { ip });
  assert.equal(afterDelete.status, 200);
  assert.equal(afterDelete.json.total, 0);
});

// --- Persistence across a process/store "restart" --------------------------
test("posted messages persist to disk and survive a store restart", async () => {
  const ip = "10.10.0.2";

  const created = await request("POST", "/api/messages", {
    ip,
    body: { nickname: "bob", text: "durable note", ownerId: "owner-2" },
  });
  assert.equal(created.status, 201);
  const id = created.json.id;

  // The data lives in the JSON file independent of any in-memory state.
  // Reading it fresh from disk simulates what a restarted process would load.
  const onDisk = readStore(messagesFile);
  const persisted = onDisk.items.find((m) => m.id === id);
  assert.ok(persisted, "message should be written to the store file");
  assert.equal(persisted.text, "durable note");
  assert.equal(persisted.ownerId, "owner-2");

  // And a fresh GET (the route re-reads the file per request) still sees it.
  const reread = await request("GET", "/api/messages", { ip });
  assert.equal(reread.status, 200);
  assert.ok(reread.json.items.some((m) => m.id === id));
});

// --- Write rate limiting (Req 20.11) ---------------------------------------
test("exceeding the write rate threshold returns 429", async () => {
  const ip = "10.10.0.3";

  // First WRITE_MAX writes are accepted...
  for (let i = 0; i < WRITE_MAX; i++) {
    const ok = await request("POST", "/api/messages", {
      ip,
      body: { text: `msg ${i}`, ownerId: "owner-3" },
    });
    assert.equal(ok.status, 201, `write #${i + 1} should be accepted`);
  }

  // ...the next write over the threshold is rate-limited.
  const limited = await request("POST", "/api/messages", {
    ip,
    body: { text: "one too many", ownerId: "owner-3" },
  });
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.json, { error: "rate_limited" });
});

// --- /api/chat error path intact (SSE passthrough not broken) --------------
test("/api/chat returns server_not_configured when no key (error path intact)", async () => {
  const ip = "10.10.0.4";

  const res = await request("POST", "/api/chat", {
    ip,
    body: { messages: [{ role: "user", content: "hi" }] },
  });
  assert.equal(res.status, 500);
  assert.deepEqual(res.json, { error: "server_not_configured" });
});
