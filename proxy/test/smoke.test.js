// Smoke test for backend test infrastructure (node:test + fast-check).
// Verifies fast-check runs property tests (>=100 runs) and that the
// temp-file approach for MESSAGES_FILE works on this platform.
//
// Future backend tests will set process.env.MESSAGES_FILE to a fresh temp
// path (via os.tmpdir()) BEFORE importing the proxy handlers, so each test
// gets an isolated JSON store without relying on Unix-only `VAR=... node`
// shell syntax.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fc from "fast-check";

test("fast-check runs a trivial property at least 100 times", () => {
  let runs = 0;
  fc.assert(
    fc.property(fc.integer(), fc.integer(), (a, b) => {
      runs += 1;
      return a + b === b + a;
    }),
    { numRuns: 100 }
  );
  assert.ok(runs >= 100, `expected >=100 runs, got ${runs}`);
});

test("temp MESSAGES_FILE path can be created and removed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msgstore-"));
  const messagesFile = path.join(dir, "messages.json");

  // Simulate how a test would point the store at a temp location.
  fs.writeFileSync(messagesFile, JSON.stringify({ version: 1, items: [] }));
  assert.ok(fs.existsSync(messagesFile));

  const parsed = JSON.parse(fs.readFileSync(messagesFile, "utf8"));
  assert.deepEqual(parsed, { version: 1, items: [] });

  // Cleanup.
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(!fs.existsSync(messagesFile));
});
