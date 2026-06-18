// Tests for admin endpoints (DELETE /api/admin/messages/:id, DELETE /api/admin/messages).
// Covers the pure helpers (applyAdminDelete / applyAdminClearAll / verifyAdminKey)
// and the real HTTP routes with ADMIN_KEY authentication.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgadmin-"));
const messagesFile = path.join(tmpDir, "messages.json");
process.env.MESSAGES_FILE = messagesFile;
process.env.WRITE_RATE_MAX = "1000";
process.env.ADMIN_KEY = "test-secret-key";

const {
  server,
  applyAdminDelete,
  applyAdminClearAll,
  verifyAdminKey,
  writeStore,
  readStore,
} = await import("../server.js");

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
      { id: "c", nickname: "", text: "third", ownerId: "owner-3", createdAt: 1002 },
    ],
  };
}

// --- applyAdminDelete (pure) ---

test("applyAdminDelete: removes message by id without ownerId check", () => {
  const store = seed();
  const r = applyAdminDelete(store, "b");
  assert.equal(r.status, 200);
  assert.equal(r.changed, true);
  assert.equal(store.items.length, 2);
  assert.equal(store.items.find((m) => m.id === "b"), undefined);
});

test("applyAdminDelete: non-existent id -> 404", () => {
  const store = seed();
  const r = applyAdminDelete(store, "nonexistent");
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not_found");
  assert.equal(r.changed, false);
  assert.equal(store.items.length, 3);
});

test("applyAdminDelete: can delete any owner's message (no ownership check)", () => {
  const store = seed();
  // Admin deletes owner-1's message without providing ownerId
  const r = applyAdminDelete(store, "a");
  assert.equal(r.status, 200);
  assert.equal(r.changed, true);
  assert.equal(store.items.length, 2);
});

// --- applyAdminClearAll (pure) ---

test("applyAdminClearAll: removes all messages", () => {
  const store = seed();
  const r = applyAdminClearAll(store);
  assert.equal(r.status, 200);
  assert.equal(r.changed, true);
  assert.equal(r.body.deleted, 3);
  assert.equal(store.items.length, 0);
});

test("applyAdminClearAll: empty store -> changed=false, deleted=0", () => {
  const store = { version: 1, items: [] };
  const r = applyAdminClearAll(store);
  assert.equal(r.status, 200);
  assert.equal(r.changed, false);
  assert.equal(r.body.deleted, 0);
});

// --- verifyAdminKey (pure) ---

test("verifyAdminKey: correct key -> ok", () => {
  const r = verifyAdminKey("test-secret-key");
  assert.equal(r.ok, true);
});

test("verifyAdminKey: wrong key -> 401", () => {
  const r = verifyAdminKey("wrong-key");
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "unauthorized");
});

test("verifyAdminKey: missing key -> 401", () => {
  const r = verifyAdminKey("");
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

// --- HTTP routes ---

let port;
const serverInstance = await new Promise((resolve) => {
  const s = server.listen(0, () => {
    port = s.address().port;
    resolve(s);
  });
});

after(() => {
  serverInstance.close();
});

function adminRequest(method, urlPath, key) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "127.0.0.1",
      port,
      path: urlPath,
      method,
      headers: key ? { "x-admin-key": key } : {},
    };
    const req = http.request(opts, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

test("DELETE /api/admin/messages/:id — correct key deletes any message", async () => {
  writeStore(seed(), messagesFile);
  const res = await adminRequest("DELETE", "/api/admin/messages/a", "test-secret-key");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const store = readStore(messagesFile);
  assert.equal(store.items.length, 2);
  assert.equal(store.items.find((m) => m.id === "a"), undefined);
});

test("DELETE /api/admin/messages/:id — wrong key returns 401", async () => {
  writeStore(seed(), messagesFile);
  const res = await adminRequest("DELETE", "/api/admin/messages/a", "bad-key");
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "unauthorized");
  const store = readStore(messagesFile);
  assert.equal(store.items.length, 3); // unchanged
});

test("DELETE /api/admin/messages/:id — no key returns 401", async () => {
  writeStore(seed(), messagesFile);
  const res = await adminRequest("DELETE", "/api/admin/messages/a", null);
  assert.equal(res.status, 401);
});

test("DELETE /api/admin/messages/:id — non-existent returns 404", async () => {
  writeStore(seed(), messagesFile);
  const res = await adminRequest("DELETE", "/api/admin/messages/zzz", "test-secret-key");
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "not_found");
});

test("DELETE /api/admin/messages — correct key clears all", async () => {
  writeStore(seed(), messagesFile);
  const res = await adminRequest("DELETE", "/api/admin/messages", "test-secret-key");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.deleted, 3);
  const store = readStore(messagesFile);
  assert.equal(store.items.length, 0);
});

test("DELETE /api/admin/messages — wrong key returns 401", async () => {
  writeStore(seed(), messagesFile);
  const res = await adminRequest("DELETE", "/api/admin/messages", "bad-key");
  assert.equal(res.status, 401);
  const store = readStore(messagesFile);
  assert.equal(store.items.length, 3); // unchanged
});

test("DELETE /api/admin/messages — empty store returns deleted=0", async () => {
  writeStore({ version: 1, items: [] }, messagesFile);
  const res = await adminRequest("DELETE", "/api/admin/messages", "test-secret-key");
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, 0);
});
