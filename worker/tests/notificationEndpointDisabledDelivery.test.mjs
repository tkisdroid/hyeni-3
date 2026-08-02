import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const notify = source("../routes/push-notify.ts");
const proactive = source("../routes/ai-proactive.ts");
const status = source("../lib/pushSubscriptionStatus.ts");
const table = source("../routes/rest-shim-table.ts");
const family = source("../routes/family.ts");

test("모든 실제 FCM/WebPush 발송 조회는 비활성 endpoint를 제외한다", () => {
  const lines = notify.split(/\r?\n/);
  const fcmQueries = lines.filter((line) => line.includes("FROM fcm_tokens"));
  const webQueries = lines.filter((line) => line.includes("FROM push_subscriptions"));

  assert.ok(fcmQueries.length >= 6, "FCM 발송 조회 계약이 예상보다 줄었습니다");
  assert.ok(webQueries.length >= 3, "WebPush 발송 조회 계약이 예상보다 줄었습니다");
  for (const query of [...fcmQueries, ...webQueries]) {
    assert.match(query, /disabled_at IS NULL/, `비활성 endpoint 필터 누락: ${query}`);
  }
});

test("채널 보유 여부와 상태 조회도 활성 endpoint만 인정한다", () => {
  assert.match(proactive, /FROM fcm_tokens WHERE family_id=\? AND user_id=\? AND disabled_at IS NULL/);
  assert.match(proactive, /FROM push_subscriptions WHERE family_id=\? AND user_id=\? AND disabled_at IS NULL/);
  assert.match(status, /AND disabled_at IS NULL/);
  assert.match(table, /table === "fcm_tokens"[\s\S]*disabled_at IS NULL/);
});

test("전송 실패·가족 해제 정리는 endpoint 이력을 지우지 않고 사유와 함께 비활성화한다", () => {
  assert.doesNotMatch(notify, /DELETE FROM (?:fcm_tokens|push_subscriptions)/);
  assert.match(notify, /disabled_reason = 'invalid_fcm_token'/);
  assert.match(notify, /disabled_reason = 'invalid_web_push_subscription'/);

  assert.doesNotMatch(family, /DELETE FROM (?:fcm_tokens|push_subscriptions)/);
  assert.match(family, /disabled_reason='family_member_removed'/);
});
