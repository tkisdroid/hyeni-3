import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let recipients = {};
try {
  recipients = await import("../lib/playdateNotificationRecipients.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

test("친구놀이 알림은 공동부모별 playdate 설정을 독립 적용한다", () => {
  assert.equal(typeof recipients.collectPlaydateNotificationParentIds, "function");
  assert.deepEqual(recipients.collectPlaydateNotificationParentIds([
    { user_id: "parent-default", playdate_enabled: null },
    { user_id: "parent-on", playdate_enabled: 1 },
    { user_id: "parent-off", playdate_enabled: 0 },
    { user_id: "", playdate_enabled: 1 },
  ]), ["parent-default", "parent-on"]);
});

test("친구놀이 시작·종료는 가족별 active 부모를 FCM 조회 전에 quiet 분할한다", () => {
  const source = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  for (const [handler, action] of [
    ["async function handlePlaydateStarted", "playdate_started"],
    ["async function handlePlaydateEnded", "playdate_ended"],
  ]) {
    const start = source.indexOf(handler);
    const tokenLookup = source.indexOf("fetchFcmTokensForUsers", start);
    assert.ok(start >= 0 && tokenLookup > start, `${action} 전달 블록을 찾을 수 없습니다`);
    const routingBlock = source.slice(start, tokenLookup);
    assert.equal(
      (routingBlock.match(/partitionNotificationRecipients\s*\(/g) ?? []).length,
      2,
      `${action}은 양쪽 가족을 독립적으로 quiet 분할해야 합니다`,
    );
    assert.match(routingBlock, new RegExp(`identity: \\{ action: "${action}" \\}`));
    assert.match(routingBlock, /suppressedQuietHours/);
  }
});
