import test from "node:test";
import assert from "node:assert/strict";

import { resolveWebPushTtlSeconds } from "../lib/webpush.ts";

test("payload expiresAt은 Web Push TTL로 변환되고 과거 알림은 즉시 만료된다", () => {
  const now = Date.parse("2026-07-14T06:00:00.000Z");
  assert.equal(resolveWebPushTtlSeconds(JSON.stringify({
    data: { expiresAt: "2026-07-14T06:02:30.000Z" },
  }), now), 150);
  assert.equal(resolveWebPushTtlSeconds(JSON.stringify({
    data: { expiresAt: "2026-07-14T05:59:59.000Z" },
  }), now), 0);
});

test("명시 만료가 없는 알림은 28일이 아니라 유형별 보수적 TTL을 쓴다", () => {
  const now = Date.parse("2026-07-14T06:00:00.000Z");
  assert.equal(resolveWebPushTtlSeconds(JSON.stringify({ data: { type: "sos" } }), now), 300);
  assert.equal(resolveWebPushTtlSeconds(JSON.stringify({ data: { type: "request_location" } }), now), 120);
  assert.equal(resolveWebPushTtlSeconds(JSON.stringify({ data: { type: "new_memo" } }), now), 120);
  assert.equal(resolveWebPushTtlSeconds("not-json", now), 86400);
});

test("명시 만료 TTL은 Web Push 최대 보관 기간을 넘지 않는다", () => {
  const now = Date.parse("2026-07-14T06:00:00.000Z");
  assert.equal(resolveWebPushTtlSeconds(JSON.stringify({
    data: { expiresAt: "2026-09-14T06:00:00.000Z" },
  }), now), 2419200);
});
