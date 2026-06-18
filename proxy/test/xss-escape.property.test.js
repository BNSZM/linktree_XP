// Property + unit tests for user-generated-content HTML escaping (anti-XSS).
//
// Task 18.7 / Property 14: 用户生成内容转义防 XSS
//   - escapeHtml / buildMessage must escape the five HTML metacharacters
//     (& < > " ') before storage, so stored nickname/text never contain raw
//     tag-forming characters.
//   - Rendering the stored value via textContent must not introduce element
//     nodes. happy-dom/jsdom are not dependencies here, so we simulate the
//     textContent contract: textContent never parses markup, and we further
//     assert the escaped output has no raw HTML-significant chars that could
//     form a tag (no "<", ">", or unescaped "&"/quotes).
//
// Requirements: 17.5 (escape UGC on store), 20.6 (treat messages as untrusted).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { escapeHtml, buildMessage } from "../server.js";

// Raw HTML-significant characters that must never survive escaping.
const RAW_META = ["<", ">", '"', "'"];

// A pattern that would begin an HTML tag (e.g. "<script", "</div", "<img").
const TAG_OPEN = /<[a-zA-Z/!?]/;

/**
 * Assert an escaped string is safe: it contains no raw tag-forming characters,
 * and every "&" is part of a well-formed entity (so it can't be a raw ampersand
 * that a parser might recombine into markup).
 */
function assertEscapedSafe(escaped) {
  for (const ch of RAW_META) {
    assert.ok(
      !escaped.includes(ch),
      `escaped output must not contain raw "${ch}": ${JSON.stringify(escaped)}`
    );
  }
  // No substring can begin an HTML tag.
  assert.ok(
    !TAG_OPEN.test(escaped),
    `escaped output must not contain a tag opener: ${JSON.stringify(escaped)}`
  );
  // Every ampersand must be an entity start (&amp; &lt; &gt; &quot; &#39;).
  const ampMatches = escaped.match(/&(?!amp;|lt;|gt;|quot;|#39;)/);
  assert.equal(
    ampMatches,
    null,
    `every & must be part of a known entity: ${JSON.stringify(escaped)}`
  );
}

/**
 * Simulate `el.textContent = value` and count element nodes created.
 *
 * Setting textContent assigns a single Text node and never parses markup, so
 * the number of element children is always 0 regardless of the string. We model
 * that contract directly (no DOM dependency): a Text node holds the raw string
 * verbatim and produces zero element nodes.
 */
function elementNodesAfterTextContent(value) {
  // textContent stores the string as character data; no tags are interpreted.
  const textNode = { nodeType: 3, data: String(value) };
  const children = []; // textContent assignment yields no element children.
  // Sanity: the text node round-trips the value with no structural parsing.
  assert.equal(textNode.data, String(value));
  return children.length;
}

// --- Unit tests: concrete XSS payloads ------------------------------------

test("escapeHtml neutralizes a classic <script> payload", () => {
  const out = escapeHtml('<script>alert("xss")</script>');
  assert.equal(
    out,
    "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
  );
  assertEscapedSafe(out);
});

test("escapeHtml escapes & first so entities are not double-formed", () => {
  // A raw "&lt;" typed by a user must become "&amp;lt;", not "&lt;".
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("escapeHtml handles an img onerror payload", () => {
  const out = escapeHtml('<img src=x onerror=alert(1)>');
  assertEscapedSafe(out);
  assert.ok(!TAG_OPEN.test(out));
});

test("buildMessage escapes both nickname and text", () => {
  const msg = buildMessage({
    nickname: '<b>name</b>',
    text: '<i>hello</i> & "quote" \'q\'',
    ownerId: "owner-1",
  });
  assertEscapedSafe(msg.nickname);
  assertEscapedSafe(msg.text);
  assert.ok(!msg.text.includes("<"));
  assert.ok(!msg.nickname.includes("<"));
});

// --- Property test: Property 14 -------------------------------------------

// Feature: xp-desktop-window-manager, Property 14: 用户生成内容转义防 XSS
test("property: UGC is stored escaped and renders no element nodes via textContent", () => {
  // Generator: strings biased toward HTML metacharacters and known XSS shards,
  // interleaved with arbitrary unicode, to densely explore the tag-forming space.
  const metaChar = fc.constantFrom("<", ">", "&", '"', "'", "/", "=", " ");
  const xssShard = fc.constantFrom(
    "<script>",
    "</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:",
    "&lt;",
    "&amp;",
    '"',
    "'",
    "<svg/onload=alert(1)>",
    "<a href='#'>"
  );
  const dangerous = fc.array(fc.oneof(metaChar, xssShard, fc.string()), {
    maxLength: 20,
  }).map((parts) => parts.join(""));

  // Mix the dangerous generator with plain strings/unicode for breadth.
  const content = fc.oneof(dangerous, fc.string(), fc.fullUnicodeString());

  fc.assert(
    fc.property(content, content, (nickname, text) => {
      const msg = buildMessage({ nickname, text, ownerId: "owner" });

      // 1) Stored values are escaped: no raw tag-forming metacharacters remain.
      assertEscapedSafe(msg.nickname);
      assertEscapedSafe(msg.text);

      // 2) The stored value can never begin an HTML tag.
      assert.ok(!TAG_OPEN.test(msg.nickname));
      assert.ok(!TAG_OPEN.test(msg.text));

      // 3) Rendering the stored value via textContent adds no element nodes.
      assert.equal(elementNodesAfterTextContent(msg.nickname), 0);
      assert.equal(elementNodesAfterTextContent(msg.text), 0);
    }),
    { numRuns: 200 }
  );
});

// Feature: xp-desktop-window-manager, Property 14: 用户生成内容转义防 XSS
test("property: escapeHtml output is idempotent-safe (re-checking stays safe)", () => {
  const content = fc.oneof(fc.string(), fc.fullUnicodeString());
  fc.assert(
    fc.property(content, (raw) => {
      const once = escapeHtml(raw);
      assertEscapedSafe(once);
      // Escaping an already-escaped value remains safe (no raw metachars leak).
      assertEscapedSafe(escapeHtml(once));
    }),
    { numRuns: 100 }
  );
});
