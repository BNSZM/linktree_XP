// Write rate-limiting for POST /api/messages — Task 18.2 (Req 20.11).
// Runs in its own process (node --test isolates files) so the small write
// threshold here does not affect other test files' create budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgrl-"));
const messagesFile = path.join(tmpDir, "messages.json");
process.env.MESSAGES_FILE = messagesFile;
// Allow only 2 writes per window; the 3rd should be throttled.
process.env.WRITE_RATE_MAX = "2";
process.env.WRITE_RATE_WINDOW_MS = "60000";

const { server } = await import("../server.js");

function post(payload, port) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data.length,
        },
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
    req.end(data);
  });
}

test("POST /api/messages: writes over threshold return 429 rate_limited", async (t) => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  t.after(() => new Promise((r) => server.close(r)));

  const body = { text: "hi", ownerId: "u1" };

  const first = await post(body, port);
  assert.equal(first.status, 201);

  const second = await post(body, port);
  assert.equal(second.status, 201);

  // 3rd write within the window exceeds WRITE_RATE_MAX=2.
  const third = await post(body, port);
  assert.equal(third.status, 429);
  assert.equal(third.json.error, "rate_limited");
});
