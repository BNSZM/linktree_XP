// Property test for message ownership judgment — Task 18.5.
//
// Feature: xp-desktop-window-manager, Property 12: 留言归属判定（尽力而为）
//
// Exercises the pure applyEdit/applyDelete helpers exported from server.js.
// Generates random ownerId combinations and asserts that an edit/delete
// succeeds ONLY when the request ownerId matches the stored ownerId; any
// mismatch always yields 403 forbidden and leaves the store unchanged.
// Ownership is a best-effort control (not a security boundary), so this
// covers the "regular use" behavior described in Requirements 20.5–20.7.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { applyEdit, applyDelete, escapeHtml } from "../server.js";

// Build a fresh store of messages with unique ids (`m0`, `m1`, ...) and
// arbitrary ownerIds. A deep clone is used per operation because applyEdit /
// applyDelete mutate the store in place.
const storeArb = fc
  .array(
    fc.record({
      ownerId: fc.string(),
      text: fc.string(),
      nickname: fc.string(),
    }),
    { minLength: 1, maxLength: 6 }
  )
  .map((rows) => ({
    version: 1,
    items: rows.map((r, i) => ({
      id: `m${i}`,
      nickname: r.nickname,
      text: r.text,
      ownerId: r.ownerId,
      createdAt: 1000 + i,
    })),
  }));

function clone(store) {
  return JSON.parse(JSON.stringify(store));
}

// Feature: xp-desktop-window-manager, Property 12: 留言归属判定（尽力而为）
// **Validates: Requirements 20.5, 20.6, 20.7**
test("property: edit succeeds only when ownerId matches, else 403", () => {
  fc.assert(
    fc.property(
      storeArb,
      fc.nat(),
      // useMatching biases toward exercising the matching branch; the actual
      // expectation is always derived from real string equality below.
      fc.boolean(),
      fc.string(),
      fc.string({ minLength: 1 }),
      (store, idxSeed, useMatching, otherOwnerId, newText) => {
        const idx = idxSeed % store.items.length;
        const target = store.items[idx];
        const storedOwnerId = target.ownerId;
        const requestOwnerId = useMatching ? storedOwnerId : otherOwnerId;
        const matches = requestOwnerId === storedOwnerId;

        const working = clone(store);
        const before = clone(store);
        const result = applyEdit(working, target.id, {
          text: newText,
          ownerId: requestOwnerId,
        });

        if (matches) {
          // Matching owner → edit applied and persisted (changed:true).
          assert.equal(result.status, 200);
          assert.equal(result.changed, true);
          assert.equal(result.body.id, target.id);
          assert.equal(result.body.text, escapeHtml(newText));
          // Owner/id/createdAt are preserved; only text changes.
          assert.equal(result.body.ownerId, storedOwnerId);
          assert.equal(working.items[idx].text, escapeHtml(newText));
          assert.equal(working.items.length, before.items.length);
        } else {
          // Mismatched owner → always 403 forbidden, store untouched.
          assert.equal(result.status, 403);
          assert.equal(result.body.error, "forbidden");
          assert.equal(result.changed, false);
          assert.deepEqual(working, before);
        }
      }
    ),
    { numRuns: 200 }
  );
});

// Feature: xp-desktop-window-manager, Property 12: 留言归属判定（尽力而为）
// **Validates: Requirements 20.5, 20.6, 20.7**
test("property: delete succeeds only when ownerId matches, else 403", () => {
  fc.assert(
    fc.property(
      storeArb,
      fc.nat(),
      fc.boolean(),
      fc.string(),
      (store, idxSeed, useMatching, otherOwnerId) => {
        const idx = idxSeed % store.items.length;
        const target = store.items[idx];
        const storedOwnerId = target.ownerId;
        const requestOwnerId = useMatching ? storedOwnerId : otherOwnerId;
        const matches = requestOwnerId === storedOwnerId;

        const working = clone(store);
        const before = clone(store);
        const result = applyDelete(working, target.id, {
          ownerId: requestOwnerId,
        });

        if (matches) {
          // Matching owner → message removed and persisted (changed:true).
          assert.equal(result.status, 200);
          assert.equal(result.changed, true);
          assert.deepEqual(result.body, { ok: true });
          assert.equal(working.items.length, before.items.length - 1);
          assert.ok(!working.items.some((m) => m.id === target.id));
        } else {
          // Mismatched owner → always 403 forbidden, store untouched.
          assert.equal(result.status, 403);
          assert.equal(result.body.error, "forbidden");
          assert.equal(result.changed, false);
          assert.deepEqual(working, before);
        }
      }
    ),
    { numRuns: 200 }
  );
});

// Feature: xp-desktop-window-manager, Property 12: 留言归属判定（尽力而为）
// A request targeting a non-existent id never matches → 404 not_found, no write.
test("property: editing/deleting a missing id yields 404 and no change", () => {
  fc.assert(
    fc.property(storeArb, fc.string(), fc.string(), (store, ownerId, text) => {
      // `zzz-*` ids are never produced by storeArb (which uses `m{i}`).
      const missingId = "zzz-missing";
      const working = clone(store);
      const before = clone(store);

      const edit = applyEdit(working, missingId, { text, ownerId });
      assert.equal(edit.status, 404);
      assert.equal(edit.body.error, "not_found");
      assert.equal(edit.changed, false);
      assert.deepEqual(working, before);

      const del = applyDelete(working, missingId, { ownerId });
      assert.equal(del.status, 404);
      assert.equal(del.body.error, "not_found");
      assert.equal(del.changed, false);
      assert.deepEqual(working, before);
    }),
    { numRuns: 100 }
  );
});
