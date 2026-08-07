import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
const webBilling = readFileSync(new URL("../src/lib/webBilling.ts", import.meta.url), "utf8");

test("Toss redirect 비밀 query는 초기 same-origin asset Referer로 재전파되지 않는다", () => {
  const referrerMeta = indexHtml.indexOf('<meta name="referrer" content="no-referrer"');
  const firstLink = indexHtml.indexOf("<link ");
  const firstScript = indexHtml.indexOf("<script ");
  assert.ok(referrerMeta >= 0, "초기 HTML에 no-referrer meta가 필요합니다.");
  assert.ok(firstLink < 0 || referrerMeta < firstLink);
  assert.ok(firstScript < 0 || referrerMeta < firstScript);

  assert.match(headers, /^\s{2}Referrer-Policy: no-referrer\s*$/m);
  assert.doesNotMatch(headers, /Referrer-Policy:\s*strict-origin-when-cross-origin/i);
  assert.match(webBilling, /script\.referrerPolicy\s*=\s*["']no-referrer["']/);
});
