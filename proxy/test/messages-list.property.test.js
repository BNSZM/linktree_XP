// Feature: xp-desktop-window-manager, Property 15: 列表分页/限量
// Property-based test for list pagination/limit (Req 20.15).
//
// Validates: Requirements 20.15
//
// For any arbitrary-size message collection and any arbitrary limit value,
// the number of returned items must never exceed the effective (clamped)
// limit produced by resolveLimit. resolveLimit clamps limit into [1, max]
// (default when missing/invalid), so listMessages must respect that bound
// regardless of how large the input collection is or what `before` cursor
// (if any) is supplied.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

const { listMessages, resolveLimit } = await import("../server.js");

// Generator for a single message with the fields the pagination logic reads.
const messageArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  nickname: fc.string({ maxLength: 8 }),
  text: fc.string({ maxLength: 16 }),
  ownerId: fc.string({ minLength: 1, maxLength: 8 }),
  createdAt: fc.integer({ min: 0, max: 10_000 }),
});

// Arbitrary collection size, from empty up to clearly above the max limit so
// the clamp is regularly exercised.
const collectionArb = fc.array(messageArb, { minLength: 0, maxLength: 400 });

// Arbitrary "limit" input covering the whole spectrum the route may receive:
// valid numbers, out-of-range, zero/negative, floats, and invalid strings.
const limitArb = fc.oneof(
  fc.integer({ min: -50, max: 500 }),
  fc.double({ min: -10, max: 500, noNaN: true }),
  fc.constantFrom(undefined, null, "", "abc", "10", "999", "0", "-5", "7.9")
);

// Optional `before` cursor: sometimes absent, sometimes a timestamp.
const beforeArb = fc.oneof(
  fc.constant(undefined),
  fc.integer({ min: -100, max: 11_000 })
);

test("Property 15: returned items never exceed the effective (clamped) limit", () => {
  fc.assert(
    fc.property(collectionArb, limitArb, beforeArb, (items, limit, before) => {
      const effectiveLimit = resolveLimit(limit);
      const { items: page } = listMessages(items, { limit, before });
      assert.ok(
        page.length <= effectiveLimit,
        `page.length=${page.length} exceeded effective limit=${effectiveLimit} (raw limit=${String(limit)})`
      );
      // Sanity: page is also bounded by the collection size.
      assert.ok(page.length <= items.length);
    }),
    { numRuns: 200 }
  );
});
