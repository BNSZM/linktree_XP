// Property test for server-side maximum length enforcement — Task 18.6.
//
// Feature: xp-desktop-window-manager, Property 13: 服务端最大长度强制
//
// Property 13: For any over-length text or nickname (beyond the server max),
// create (POST /api/messages) and edit (PATCH /api/messages/:id) MUST always
// be rejected with HTTP 400 (error: "too_long") and MUST NOT write to storage.
//
// Validates: Requirements 20.10, 20.14
//
// Strategy (no mocks, no upstream network):
//   - Drive the real HTTP server with an isolated temp MESSAGES_FILE per
//     iteration so storage effects are observable and isolated.
//   - Raise the write rate limit via env so ≥100 iterations don't trip 429
//     before reaching the length check (we are testing 400, not 429).
//   - create: assert 400 too_long AND the store file is never written.
//   - edit: pre-seed a store with one owned message, attempt an over-length
//     edit, assert 400 too_long AND the stored message is left unchanged.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import fc from "fast-check";

// Server defaults (server.js): MAX_MSG_LEN=500, MAX_NICK_LEN=24. We leave those
// env vars unset so the defaults apply. Raise the write rate limit so a long
// property run never hits the 60s/10-write throttle before the length check.
const MAX_MSG_LEN = 500;
const MAX_NICK_LEN = 24;
process.env.WRITE_RATE_MAX = "1000000";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "msgmaxlen-"));
// Provide an initial MESSAGES_FILE before import; it is overridden per
// iteration. getMessagesFile() reads the env lazily on each request.
process.env.MESSAGES_FILE = path.join(tmpRoot, "initial.json");

const { server } = await import("../server.js");

let port;
await new Promise((r) => server.listen(0, "127.0.0.1", r));
port = server.address().port;

after(() => {
  try {
    server.close();
  } catch {}
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
});

/** Minimal JSON request helper over the running server. */
function request(method, pathname, bodyObj) {
  const data = bodyObj === undefined ? null : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            json: body ? JSON.parse(body) : {},
          })
        );
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

let iter = 0;
/** Allocate a unique, not-yet-created store path and point the env at it. */
function freshStorePath() {
  const file = path.join(tmpRoot, `store-${iter++}.json`);
  process.env.MESSAGES_FILE = file;
  return file;
}

// Build an over-length string of exactly `len` code points using either ASCII
// or a multi-byte emoji (each emoji counts as 1 code point via charLen).
function overLengthString(len, useEmoji) {
  const unit = useEmoji ? "😀" : "x";
  return unit.repeat(len);
}

// --- create (POST) --------------------------------------------------------

// Feature: xp-desktop-window-manager, Property 13: 服务端最大长度强制
test("property: over-length create is always 400 too_long and writes nothing", async () => {
  await fc.assert(
    fc.asyncProperty(
      // which field is over the limit
      fc.constantFrom("text", "nickname"),
      // how far past the max (1..50 extra code points)
      fc.integer({ min: 1, max: 50 }),
      fc.boolean(), // ascii vs emoji
      fc.string({ minLength: 1, maxLength: 16 }), // ownerId (non-empty)
      async (field, extra, useEmoji, ownerId) => {
        const file = freshStorePath();

        let payload;
        if (field === "text") {
          payload = {
            ownerId,
            text: overLengthString(MAX_MSG_LEN + extra, useEmoji),
          };
        } else {
          // nickname over-limit, but text must be valid (non-empty, within max).
          payload = {
            ownerId,
            text: "hello",
            nickname: overLengthString(MAX_NICK_LEN + extra, useEmoji),
          };
        }

        const res = await request("POST", "/api/messages", payload);

        assert.equal(res.status, 400, "over-length create must be rejected 400");
        assert.equal(res.json.error, "too_long");
        assert.equal(res.json.field, field);
        // Nothing written: the rejection path never touches storage, so the
        // isolated store file must not have been created.
        assert.ok(
          !fs.existsSync(file),
          "rejected create must not write to storage"
        );
      }
    ),
    { numRuns: 100 }
  );
});

// --- edit (PATCH) ---------------------------------------------------------

// Feature: xp-desktop-window-manager, Property 13: 服务端最大长度强制
test("property: over-length edit is always 400 too_long and leaves storage unchanged", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 50 }), // extra length past max
      fc.boolean(), // ascii vs emoji
      fc.string({ minLength: 1, maxLength: 16 }), // ownerId (non-empty)
      async (extra, useEmoji, ownerId) => {
        const file = freshStorePath();

        // Pre-seed an owned message so we can prove the edit leaves it intact.
        const seeded = {
          version: 1,
          items: [
            {
              id: "seed-id",
              nickname: "",
              text: "original",
              ownerId,
              createdAt: 1000,
            },
          ],
        };
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(seeded), "utf8");
        const before = fs.readFileSync(file, "utf8");

        const res = await request("PATCH", "/api/messages/seed-id", {
          ownerId,
          text: overLengthString(MAX_MSG_LEN + extra, useEmoji),
        });

        assert.equal(res.status, 400, "over-length edit must be rejected 400");
        assert.equal(res.json.error, "too_long");
        assert.equal(res.json.field, "text");
        // Storage must be byte-for-byte unchanged on the rejection path.
        const afterContent = fs.readFileSync(file, "utf8");
        assert.equal(
          afterContent,
          before,
          "rejected edit must not modify storage"
        );
      }
    ),
    { numRuns: 100 }
  );
});
