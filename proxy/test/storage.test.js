// Unit + property tests for the JSON file storage layer (proxy/storage.js).
//
// Covers Task 17.1 behaviors:
//   - read missing/corrupt file → empty set fallback (lazy rebuild)
//   - atomic write via temp file + rename, top-level { version, items }
//   - storage path from MESSAGES_FILE
//   - in-memory write-lock serialization of concurrent writes
//
// Each test uses an isolated temp MESSAGES_FILE so iterations don't interfere.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fc from "fast-check";

import {
  STORE_VERSION,
  getMessagesFile,
  emptyStore,
  readStore,
  writeStore,
  withWriteLock,
  mutateStore,
} from "../storage.js";

function freshFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msgstore-"));
  return { dir, file: path.join(dir, "messages.json") };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test("emptyStore has top-level { version, items } shape", () => {
  assert.deepEqual(emptyStore(), { version: STORE_VERSION, items: [] });
});

test("readStore returns empty set when file is missing", () => {
  const { dir, file } = freshFile();
  try {
    // Note: file does not exist yet.
    assert.ok(!fs.existsSync(file));
    assert.deepEqual(readStore(file), { version: STORE_VERSION, items: [] });
    // Lazy: reading must NOT create the file.
    assert.ok(!fs.existsSync(file));
  } finally {
    cleanup(dir);
  }
});

test("readStore returns empty set when file is corrupt JSON", () => {
  const { dir, file } = freshFile();
  try {
    fs.writeFileSync(file, "{ this is not valid json ]]]");
    assert.deepEqual(readStore(file), { version: STORE_VERSION, items: [] });
  } finally {
    cleanup(dir);
  }
});

test("readStore normalizes a structure with non-array items to empty set", () => {
  const { dir, file } = freshFile();
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, items: "nope" }));
    assert.deepEqual(readStore(file), { version: STORE_VERSION, items: [] });
  } finally {
    cleanup(dir);
  }
});

test("writeStore creates parent dir and writes { version, items }", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msgstore-"));
  const file = path.join(dir, "nested", "deep", "messages.json");
  try {
    const store = { version: 1, items: [{ id: "a", text: "hi" }] };
    writeStore(store, file);
    assert.ok(fs.existsSync(file));
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(parsed, store);
  } finally {
    cleanup(dir);
  }
});

test("write then read round-trips the items", () => {
  const { dir, file } = freshFile();
  try {
    const items = [
      { id: "1", text: "first", createdAt: 1 },
      { id: "2", text: "second", createdAt: 2 },
    ];
    writeStore({ version: 1, items }, file);
    assert.deepEqual(readStore(file), { version: STORE_VERSION, items });
  } finally {
    cleanup(dir);
  }
});

test("writeStore leaves no .tmp residue on success", () => {
  const { dir, file } = freshFile();
  try {
    writeStore({ version: 1, items: [{ id: "x" }] }, file);
    const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    cleanup(dir);
  }
});

test("getMessagesFile honors MESSAGES_FILE env, defaults otherwise", () => {
  const prev = process.env.MESSAGES_FILE;
  try {
    process.env.MESSAGES_FILE = path.join("custom", "path", "m.json");
    assert.equal(getMessagesFile(), path.join("custom", "path", "m.json"));
    delete process.env.MESSAGES_FILE;
    assert.equal(getMessagesFile(), path.join(".", "data", "messages.json"));
  } finally {
    if (prev === undefined) delete process.env.MESSAGES_FILE;
    else process.env.MESSAGES_FILE = prev;
  }
});

test("withWriteLock serializes concurrent tasks in FIFO order", async () => {
  const order = [];
  const mk = (label, delay) =>
    withWriteLock(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            order.push(label);
            resolve(label);
          }, delay);
        })
    );

  // Start a slow task first, then a fast one. The lock must keep them ordered.
  const p1 = mk("a", 30);
  const p2 = mk("b", 1);
  const p3 = mk("c", 1);
  const results = await Promise.all([p1, p2, p3]);

  assert.deepEqual(order, ["a", "b", "c"]);
  assert.deepEqual(results, ["a", "b", "c"]);
});

test("withWriteLock: a failing task does not break the queue", async () => {
  const p1 = withWriteLock(() => {
    throw new Error("boom");
  });
  await assert.rejects(p1, /boom/);

  const p2 = await withWriteLock(() => 42);
  assert.equal(p2, 42);
});

test("mutateStore performs atomic read-modify-write under the lock", async () => {
  const { dir, file } = freshFile();
  try {
    // Fire many concurrent appends; with the write lock none should be lost.
    const N = 25;
    const tasks = [];
    for (let i = 0; i < N; i++) {
      tasks.push(
        mutateStore((store) => {
          store.items.push({ id: String(i) });
          return i;
        }, file)
      );
    }
    await Promise.all(tasks);

    const final = readStore(file);
    assert.equal(final.items.length, N, "no concurrent write should be lost");
    const ids = final.items.map((m) => Number(m.id)).sort((a, b) => a - b);
    assert.deepEqual(
      ids,
      Array.from({ length: N }, (_, i) => i)
    );
  } finally {
    cleanup(dir);
  }
});

// Feature: xp-desktop-window-manager, storage round-trip robustness
test("property: arbitrary item arrays round-trip through write/read", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          id: fc.string(),
          nickname: fc.string(),
          text: fc.string(),
          ownerId: fc.string(),
          createdAt: fc.integer({ min: 0 }),
        })
      ),
      (items) => {
        const { dir, file } = freshFile();
        try {
          writeStore({ version: STORE_VERSION, items }, file);
          const out = readStore(file);
          assert.equal(out.version, STORE_VERSION);
          assert.deepEqual(out.items, items);
        } finally {
          cleanup(dir);
        }
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: xp-desktop-window-manager, corrupt/missing input always yields empty set
test("property: missing or corrupt content always reads as empty set", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.constant(null), // missing file
        fc.string() // arbitrary (likely corrupt) bytes
      ),
      (content) => {
        const { dir, file } = freshFile();
        try {
          if (content !== null) fs.writeFileSync(file, content);
          const out = readStore(file);
          // Either it's valid JSON matching the shape, or it falls back to empty.
          // For arbitrary strings that don't parse to { items: [...] }, expect empty.
          let isValidShape = false;
          if (content !== null) {
            try {
              const p = JSON.parse(content);
              isValidShape =
                p && typeof p === "object" && Array.isArray(p.items);
            } catch {
              isValidShape = false;
            }
          }
          if (!isValidShape) {
            assert.deepEqual(out, { version: STORE_VERSION, items: [] });
          }
        } finally {
          cleanup(dir);
        }
      }
    ),
    { numRuns: 100 }
  );
});
