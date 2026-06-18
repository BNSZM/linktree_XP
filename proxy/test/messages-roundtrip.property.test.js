// Property test for message read/write round-trip (persisted, shared board).
// Task 18.4 — Property 11: 留言读写往返（持久化共享）.
//
// For ANY valid message (optional nickname + text + ownerId), after the create
// flow succeeds, listing the messages again must contain that message with
// consistent fields — text, nickname (or empty → default anonymous), ownerId
// and a timestamp — exactly as stored. Each iteration uses an isolated temp
// MESSAGES_FILE so persisted state never leaks between runs. No mocks, no
// network; exercises the real validate → build → persist → list pipeline.
//
// Feature: xp-desktop-window-manager, Property 11: 留言读写往返（持久化共享）
// Validates: Requirements 20.3, 20.4, 20.12, 20.13
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fc from "fast-check";

import {
  validateMessageInput,
  buildMessage,
  listMessages,
  escapeHtml,
} from "../server.js";
import { readStore, mutateStore } from "../storage.js";

// A single isolated temp store file for one property iteration.
function freshFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msgrt-"));
  return { dir, file: path.join(dir, "messages.json") };
}

// Generator for one valid create payload { nickname?, text, ownerId }.
//   - text: non-empty after trim, well under MAX_MSG_LEN (500 code points).
//   - nickname: sometimes absent, sometimes empty, sometimes a short name
//     (covers the "default anonymous" path where stored nickname is "").
//   - ownerId: non-empty string.
const validPayload = fc.record(
  {
    nickname: fc.oneof(
      fc.constant(undefined), // no nickname → default anonymous
      fc.constant(""), // explicit empty → default anonymous
      fc.string({ maxLength: 20 })
    ),
    text: fc
      .string({ minLength: 1, maxLength: 100 })
      .filter((s) => s.trim().length > 0),
    ownerId: fc.string({ minLength: 1, maxLength: 30 }),
  },
  { requiredKeys: ["text", "ownerId"] }
);

test("property: valid messages round-trip through create → list with consistent fields", async () => {
  await fc.assert(
    fc.asyncProperty(
      // 1..20 messages per iteration keeps the count under the list limit (100)
      // so every created message is guaranteed to appear in a single page.
      fc.array(validPayload, { minLength: 1, maxLength: 20 }),
      async (payloads) => {
        const { dir, file } = freshFile();
        try {
          const created = [];
          for (const payload of payloads) {
            // Create flow: validate → build → persist (atomic, write-locked).
            const v = validateMessageInput(payload);
            assert.ok(v.ok, "generated payload must be valid input");

            const item = buildMessage(v.value);
            await mutateStore((store) => {
              store.items.push(item);
              return item;
            }, file);
            created.push({ payload, item });
          }

          // List back from the persisted store (newest-first, limited page).
          const persisted = readStore(file);
          const { items: listed, total } = listMessages(persisted.items, {
            limit: 100,
          });

          // Persistence: every created message is present in the listing.
          assert.equal(total, created.length);
          assert.equal(listed.length, created.length);

          for (const { payload, item } of created) {
            const found = listed.find((m) => m.id === item.id);
            assert.ok(found, `created message ${item.id} must be listed`);

            // Field consistency with what was stored.
            assert.equal(found.text, item.text);
            assert.equal(found.text, escapeHtml(payload.text));

            // Nickname: HTML-escaped; absent/empty stored as "" (default anon).
            const expectedNick = escapeHtml(payload.nickname || "");
            assert.equal(found.nickname, expectedNick);
            assert.equal(found.nickname, item.nickname);
            if (!payload.nickname) {
              assert.equal(found.nickname, "", "missing nickname stores empty");
            }

            // Ownership (best-effort) preserved as a string.
            assert.equal(found.ownerId, String(payload.ownerId));
            assert.equal(found.ownerId, item.ownerId);

            // Timestamp present as a finite positive epoch-ms number.
            assert.equal(typeof found.createdAt, "number");
            assert.ok(Number.isFinite(found.createdAt));
            assert.ok(found.createdAt > 0);
            assert.equal(found.createdAt, item.createdAt);
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 100 }
  );
});
