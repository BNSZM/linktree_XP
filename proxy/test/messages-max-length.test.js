// Feature: xp-desktop-window-manager, Property 13: 服务端最大长度强制
//
// Property-based test for server-side maximum length enforcement (Task 18.6).
//
// Property 13: For ANY message text or nickname exceeding the server maximum,
// create (POST) and edit (PATCH) are always rejected with 400 {error:"too_long"}
// and nothing is written to storage.
//
// We exercise both the pure validator (validateMessageInput) and the real HTTP
// create/edit flow, using an isolated temp MESSAGES_FILE per iteration so the
// persistence path can be asserted to remain untouched. No mocks, no upstream.
//
// Validates: Requirements 20.10, 20.14
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import fc from "fast-check";

// Server-side limits mirror server.js defaults (overridable via env, so read the
// same way the server does to stay in sync with any environment override).
const MAX_MSG_LEN = Number(process.env.MAX_MSG_LEN) || 500;
const MAX_NICK_LEN = Number(process.env.MAX_NICK_LEN) || 24;

// Raise the write rate-limit cap before importing the server: the POST/PATCH
// handlers check writeRateLimited() ahead of validation, and this property fires
// many write-path requests from the same loopback IP. A high cap keeps the test
// focused on length enforcement (rate limiting is covered elsewhere).
process.env.WRITE_RATE_MAX = "1000000";

// Isolate the store before importing the server so getMessagesFile() (lazy) picks
// up our temp path. Each iteration rewrites MESSAGES_FILE to a fresh file.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "msgmaxlen-"));
process.env.MESSAGES_FILE = path.join(tmpRoot, "initial.json");

const { server, validateMessageInput, readStore, writeStore } = await import(
  "../server.js"
);

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
});

// --- generators -----------------------------------------------------------
// ASCII printable strings: code-point length equals JS length, so the byte/char
// length the server counts matches the generated length exactly.

// A non-blank, within-limit text (so the only violation is the nickname).
const validText = fc
  .string({ minLength: 1, maxLength: MAX_MSG_LEN })
  .map((s) => (s.trim() ? s : "x"));

// A non-empty ownerId (truthy), so validation reaches the length checks.
const validOwnerId = fc.string({ minLength: 1, maxLength: 16 });

// Payloads that violate the server maximum length in exactly one field.
const overLengthPayload = fc.oneof(
  // text too long (nickname within limit)
  fc.record({
    kind: fc.constant("text"),
    text: fc.string({
      minLength: MAX_MSG_LEN + 1,
      maxLength: MAX_MSG_LEN + 64,
    }),
    nickname: fc.string({ maxLength: MAX_NICK_LEN }),
    ownerId: validOwnerId,
  }),
  // nickname too long (text valid non-blank within limit)
  fc.record({
    kind: fc.constant("nickname"),
    text: validText,
    nickname: fc.string({
      minLength: MAX_NICK_LEN + 1,
      maxLength: MAX_NICK_LEN + 48,
    }),
    ownerId: validOwnerId,
  })
);

// --- HTTP helper ----------------------------------------------------------

function request(method, pathname, port, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = bodyObj === undefined ? null : JSON.stringify(bodyObj);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers: { "Content-Type": "application/json" },
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
    if (data) req.write(data);
    req.end();
  });
}

// --- pure validator property ---------------------------------------------

// Feature: xp-desktop-window-manager, Property 13: 服务端最大长度强制
test("property: over-length text/nickname is always rejected by validator (400 too_long)", () => {
  fc.assert(
    fc.property(overLengthPayload, (p) => {
      const r = validateMessageInput(
        { text: p.text, nickname: p.nickname, ownerId: p.ownerId },
        { maxMsgLen: MAX_MSG_LEN, maxNickLen: MAX_NICK_LEN }
      );
      assert.equal(r.ok, false);
      assert.equal(r.status, 400);
      assert.equal(r.body.error, "too_long");
      assert.equal(r.body.field, p.kind);
      assert.equal(r.body.max, p.kind === "text" ? MAX_MSG_LEN : MAX_NICK_LEN);
    }),
    { numRuns: 100 }
  );
});

// --- HTTP create + edit persistence property ------------------------------

// Feature: xp-desktop-window-manager, Property 13: 服务端最大长度强制
test("property: over-length create/edit return 400 and never write to storage", async (t) => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  t.after(() => new Promise((r) => server.close(r)));

  let iter = 0;
  await fc.assert(
    fc.asyncProperty(overLengthPayload, async (p) => {
      // Fresh, isolated store file for this iteration.
      const file = path.join(tmpRoot, `it-${iter++}.json`);
      process.env.MESSAGES_FILE = file;

      // --- CREATE: over-length payload must be rejected, store untouched. ---
      const created = await request("POST", "/api/messages", port, {
        text: p.text,
        nickname: p.nickname,
        ownerId: p.ownerId,
      });
      assert.equal(created.status, 400);
      assert.equal(created.json.error, "too_long");
      // No write to storage: file must not have been created / remains empty.
      assert.equal(
        readStore(file).items.length,
        0,
        "rejected create must not write any item"
      );

      // --- EDIT: seed one valid message, then PATCH it with over-length text. ---
      const seeded = {
        id: "seed-id",
        nickname: "n",
        text: "original",
        ownerId: p.ownerId,
        createdAt: 1000,
      };
      writeStore({ version: 1, items: [seeded] }, file);

      const edited = await request(
        "PATCH",
        `/api/messages/${seeded.id}`,
        port,
        { text: p.kind === "text" ? p.text : "x".repeat(MAX_MSG_LEN + 1), ownerId: p.ownerId }
      );
      assert.equal(edited.status, 400);
      assert.equal(edited.json.error, "too_long");
      // Store must be unchanged by the rejected edit.
      assert.deepEqual(
        readStore(file).items,
        [seeded],
        "rejected edit must not modify storage"
      );
    }),
    { numRuns: 100 }
  );
});
