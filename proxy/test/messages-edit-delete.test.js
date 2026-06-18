// Tests for PATCH/DELETE /api/messages/:id (ownership) — Task 18.3.
// Covers the pure helpers (applyEdit / applyDelete) and the real HTTP routes,
// using an isolated temp MESSAGES_FILE (no mocks, no upstream network).
// Requirements: 20.5, 20.6, 20.7, 20.10.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

// Isolate the store and give the write limiter head room so functional tests
// do not trip the per-IP write throttle (throttle is covered elsewhere).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgedit-"));
const messagesFile = path.join(tmpDir, "messages.json");
process.env.MESSAGES_FILE = messagesFile;
process.env.WRITE_RATE_MAX = "1000";

const { server, applyEdit, applyDelete, writeStore, readStore } = await import(
  "../server.js"
);

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

function seed() {
  return {
    version: 1,
    items: [
      { id: "a", nickname: "", text: "hello", ownerId: "owner-1", createdAt: 1000 },
      { id: "b", nickname: "N", text: "world", ownerId: "owner-2", createdAt: 1001 },
    ],
  };
}

// --- applyEdit (pure) -----------------------------------------------------

test("applyEdit: matching ownerId edits text (escaped) and marks changed", () => {
  const store = seed();
  const r = applyEdit(store, "a", { text: "<b>hi</b>", ownerId: "owner-1" });
  assert.equal(r.status, 200);
  assert.equal(r.changed, true);
  assert.equal(r.body.text, "&lt;b&gt;hi&lt;/b&gt;");
  assert.equal(r.body.id, "a");
  assert.equal(r.body.ownerId, "owner-1");
  // createdAt preserved.
  assert.equal(r.body.createdAt, 1000);
  assert.equal(store.items[0].text, "&lt;b&gt;hi&lt;/b&gt;");
});

test("applyEdit: mismatched ownerId -> 403 forbidden, no change", () => {
  const store = seed();
  const r = applyEdit(store, "a", { text: "nope", ownerId: "intruder" });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "forbidden");
  assert.equal(r.changed, false);
  assert.equal(store.items[0].text, "hello");
});

test("applyEdit: unknown id -> 404 not_found, no change", () => {
  const store = seed();
  const r = applyEdit(store, "zzz", { text: "x", ownerId: "owner-1" });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not_found");
  assert.equal(r.changed, false);
});

// --- applyDelete (pure) ---------------------------------------------------

test("applyDelete: matching ownerId removes item and marks changed", () => {
  const store = seed();
  const r = applyDelete(store, "b", { ownerId: "owner-2" });
  assert.equal(r.status, 200);
  assert.equal(r.changed, true);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(store.items.length, 1);
  assert.equal(store.items.find((m) => m.id === "b"), undefined);
});

test("applyDelete: mismatched ownerId -> 403 forbidden, no removal", () => {
  const store = seed();
  const r = applyDelete(store, "b", { ownerId: "owner-1" });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "forbidden");
  assert.equal(r.changed, false);
  assert.equal(store.items.length, 2);
});

test("applyDelete: unknown id -> 404 not_found", () => {
  const store = seed();
  const r = applyDelete(store, "missing", { ownerId: "owner-1" });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not_found");
  assert.equal(r.changed, false);
});

// --- HTTP routes ----------------------------------------------------------

function request(method, pathname, payload, port) {
  return new Promise((resolve, reject) => {
    const data = payload == null ? null : Buffer.from(JSON.stringify(payload));
    const headers = { "Content-Type": "application/json" };
    if (data) headers["Content-Length"] = data.length;
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method, headers },
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

test("PATCH /api/messages/:id: ownership + length + escaping over HTTP", async (t) => {
  writeStore(seed(), messagesFile);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  t.after(() => new Promise((r) => server.close(r)));

  // Match: edits and escapes, persists to disk.
  const ok = await request(
    "PATCH",
    "/api/messages/a",
    { text: "<i>edited</i>", ownerId: "owner-1" },
    port
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.json.text, "&lt;i&gt;edited&lt;/i&gt;");
  assert.equal(readStore(messagesFile).items.find((m) => m.id === "a").text,
    "&lt;i&gt;edited&lt;/i&gt;");

  // Mismatch: 403 forbidden, unchanged.
  const forbidden = await request(
    "PATCH",
    "/api/messages/b",
    { text: "hijack", ownerId: "owner-1" },
    port
  );
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error, "forbidden");
  assert.equal(readStore(messagesFile).items.find((m) => m.id === "b").text, "world");

  // Unknown id: 404 not_found.
  const notFound = await request(
    "PATCH",
    "/api/messages/zzz",
    { text: "x", ownerId: "owner-1" },
    port
  );
  assert.equal(notFound.status, 404);
  assert.equal(notFound.json.error, "not_found");

  // Over max length: 400 too_long, NOT persisted (Req 20.10).
  const tooLong = await request(
    "PATCH",
    "/api/messages/a",
    { text: "x".repeat(501), ownerId: "owner-1" },
    port
  );
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.json.error, "too_long");
  assert.equal(readStore(messagesFile).items.find((m) => m.id === "a").text,
    "&lt;i&gt;edited&lt;/i&gt;");

  // Missing ownerId: 400 bad_request.
  const bad = await request("PATCH", "/api/messages/a", { text: "hi" }, port);
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "bad_request");
  assert.equal(bad.json.field, "ownerId");
});

test("DELETE /api/messages/:id: ownership over HTTP (body + query ownerId)", async (t) => {
  writeStore(seed(), messagesFile);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  t.after(() => new Promise((r) => server.close(r)));

  // Mismatch: 403, item remains.
  const forbidden = await request(
    "DELETE",
    "/api/messages/a",
    { ownerId: "intruder" },
    port
  );
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error, "forbidden");
  assert.equal(readStore(messagesFile).items.length, 2);

  // Unknown id: 404.
  const notFound = await request(
    "DELETE",
    "/api/messages/zzz",
    { ownerId: "owner-1" },
    port
  );
  assert.equal(notFound.status, 404);
  assert.equal(notFound.json.error, "not_found");

  // Missing ownerId: 400 bad_request.
  const bad = await request("DELETE", "/api/messages/a", {}, port);
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "bad_request");
  assert.equal(bad.json.field, "ownerId");

  // Match via body: 200 ok, removed and persisted.
  const okBody = await request(
    "DELETE",
    "/api/messages/a",
    { ownerId: "owner-1" },
    port
  );
  assert.equal(okBody.status, 200);
  assert.deepEqual(okBody.json, { ok: true });
  assert.equal(readStore(messagesFile).items.find((m) => m.id === "a"), undefined);

  // Match via query string ownerId: 200 ok.
  const okQuery = await request(
    "DELETE",
    "/api/messages/b?ownerId=owner-2",
    null,
    port
  );
  assert.equal(okQuery.status, 200);
  assert.deepEqual(okQuery.json, { ok: true });
  assert.equal(readStore(messagesFile).items.length, 0);
});
