import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPushExpired, parsePushExpiryMs } from "../src/transform/pushExpiry.ts";

test("push expiresAt은 ISO·epoch milliseconds·epoch seconds를 안전하게 해석한다", () => {
  assert.equal(parsePushExpiryMs("2026-07-14T06:00:00.000Z"), Date.parse("2026-07-14T06:00:00.000Z"));
  assert.equal(parsePushExpiryMs(1_752_470_400_000), 1_752_470_400_000);
  assert.equal(parsePushExpiryMs(1_752_470_400), 1_752_470_400_000);
  assert.equal(parsePushExpiryMs("not-a-date"), null);
  assert.equal(parsePushExpiryMs(null), null);
});

test("표시 시각에 이미 만료된 push만 폐기하고 만료값이 없거나 미래면 유지한다", () => {
  const now = Date.parse("2026-07-14T06:00:00.000Z");
  assert.equal(isPushExpired("2026-07-14T05:59:59.999Z", now), true);
  assert.equal(isPushExpired("2026-07-14T06:00:00.000Z", now), true);
  assert.equal(isPushExpired("2026-07-14T06:00:00.001Z", now), false);
  assert.equal(isPushExpired(undefined, now), false);
  assert.equal(isPushExpired("invalid", now), false);
});

test("Service Worker는 만료 검사 뒤에만 알림 표시와 shown ledger 기록을 수행한다", () => {
  const source = readFileSync(new URL("../src/sw.ts", import.meta.url), "utf8");
  const expiryIndex = source.indexOf("isPushExpired(data.expiresAt");
  const showIndex = source.indexOf("showNotification", expiryIndex);
  const ledgerIndex = source.indexOf("recordShownPushId(pushId", expiryIndex);
  assert.ok(expiryIndex >= 0, "expiresAt 판정이 필요합니다");
  assert.ok(showIndex > expiryIndex, "만료 판정 뒤에만 알림을 표시해야 합니다");
  assert.ok(ledgerIndex > showIndex, "실제 표시 뒤에만 shown ledger를 기록해야 합니다");
});
