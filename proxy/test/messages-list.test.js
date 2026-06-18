// Tests for GET /api/messages list endpoint (pagination/limit) — Task 18.1.
// Covers the pure pagination helpers (resolveLimit / listMessages) and the
// real HTTP route, using an isolated temp MESSAGES_FILE (no mocks, no network
// to upstream). Requirements: 20.4, 20.15.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

// Point the store at an isolated temp file BEFORE importing the server module,
// so each run gets a clean JSON store. Use dynamic import after setting env.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msglist-"));
const messagesFile = path.join(tmpDir, "messages.json");
process.env.MESSAGES_FILE = messagesFile;
// Avoid noisy upstream warnings affecting nothing; not required for GET.

const { server, listMessages, resolveLimit, writeStore } = await import(
  "../server.js"
);

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

function makeMessages(n) {
  // createdAt ascending with index; ids stable.
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    nickname: "",
    text: `t${i}`,
    ownerId: "o",
    createdAt: 1000 + i,
  }));
}

// --- resolveLimit ---------------------------------------------------------

test("resolveLimit: missing/invalid falls back to default", () => {
  assert.equal(resolveLimit(undefined, { def: 50, max: 100 }), 50);
  assert.equal(resolveLimit(null, { def: 50, max: 100 }), 50);
  assert.equal(resolveLimit("abc", { def: 50, max: 100 }), 50);
  assert.equal(resolveLimit("0", { def: 50, max: 100 }), 50);
  assert.equal(resolveLimit("-5", { def: 50, max: 100 }), 50);
});

test("resolveLimit: clamps to max and floors", () => {
  assert.equal(resolveLimit("999", { def: 50, max: 100 }), 100);
  assert.equal(resolveLimit("7.9", { def: 50, max: 100 }), 7);
  assert.equal(resolveLimit("3", { def: 50, max: 100 }), 3);
});

// --- listMessages ---------------------------------------------------------

test("listMessages: returns newest first (createdAt descending)", () => {
  const { items } = listMessages(makeMessages(5), { limit: 10 });
  const created = items.map((m) => m.createdAt);
  assert.deepEqual(created, [1004, 1003, 1002, 1001, 1000]);
});

test("listMessages: total reflects full count; items capped by limit", () => {
  const { items, total, hasMore } = listMessages(makeMessages(5), { limit: 2 });
  assert.equal(total, 5);
  assert.equal(items.length, 2);
  assert.equal(hasMore, true);
  assert.deepEqual(items.map((m) => m.id), ["m4", "m3"]);
});

test("listMessages: hasMore is false when limit covers everything", () => {
  const { hasMore } = listMessages(makeMessages(3), { limit: 10 });
  assert.equal(hasMore, false);
});

test("listMessages: before cursor keeps only older messages", () => {
  // before = 1003 → only createdAt < 1003 (m0..m2), newest first.
  const { items, total, hasMore } = listMessages(makeMessages(5), {
    limit: 10,
    before: 1003,
  });
  assert.equal(total, 5);
  assert.deepEqual(items.map((m) => m.id), ["m2", "m1", "m0"]);
  assert.equal(hasMore, false);
});

test("listMessages: before + limit paginate older messages", () => {
  const { items, hasMore } = listMessages(makeMessages(5), {
    limit: 2,
    before: 1004,
  });
  // candidates older than 1004: m0..m3 (newest first m3,m2,m1,m0), take 2.
  assert.deepEqual(items.map((m) => m.id), ["m3", "m2"]);
  assert.equal(hasMore, true);
});

test("listMessages: empty store yields empty page", () => {
  const r = listMessages([], { limit: 50 });
  assert.deepEqual(r, { items: [], total: 0, hasMore: false });
});

// --- HTTP route -----------------------------------------------------------

function get(pathname, port) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: pathname }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, json: JSON.parse(body || "{}") })
        );
      })
      .on("error", reject);
  });
}

test("GET /api/messages: serves sorted, limited list over HTTP", async (t) => {
  // Seed the store on disk.
  writeStore({ version: 1, items: makeMessages(120) }, messagesFile);

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  t.after(() => new Promise((r) => server.close(r)));

  // Default limit (50) clamps a 120-item store.
  const def = await get("/api/messages", port);
  assert.equal(def.status, 200);
  assert.equal(def.json.total, 120);
  assert.equal(def.json.items.length, 50);
  assert.equal(def.json.hasMore, true);
  assert.equal(def.json.items[0].createdAt, 1119); // newest first

  // Explicit limit over max (100) is clamped to 100.
  const big = await get("/api/messages?limit=999", port);
  assert.equal(big.json.items.length, 100);

  // before cursor returns older messages only.
  const older = await get("/api/messages?limit=3&before=1010", port);
  assert.deepEqual(
    older.json.items.map((m) => m.createdAt),
    [1009, 1008, 1007]
  );
});
