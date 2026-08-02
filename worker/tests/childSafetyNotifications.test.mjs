import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let childSafety = {};
try {
  childSafety = await import("../lib/childSafetyNotification.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

test("도착과 위험 사건은 아이 말투의 별도 알림으로 변환한다", () => {
  assert.equal(typeof childSafety.childSafetyNotificationForAlert, "function");
  assert.deepEqual(childSafety.childSafetyNotificationForAlert("place_arrived"), {
    title: "도착했어!",
    message: "도착이 확인됐어.",
    urgent: false,
    ttlMs: 2 * 60 * 60_000,
  });
  assert.deepEqual(childSafety.childSafetyNotificationForAlert("place_left"), {
    title: "출발했어!",
    message: "등록한 장소에서 출발한 것이 확인됐어.",
    urgent: false,
    ttlMs: 2 * 60 * 60_000,
  });
  assert.deepEqual(childSafety.childSafetyNotificationForAlert("unregistered_stay_left"), {
    title: "머물던 곳에서 출발했어",
    message: "위치 기록에서 출발한 것이 확인됐어.",
    urgent: false,
    ttlMs: 2 * 60 * 60_000,
  });
  assert.deepEqual(childSafety.childSafetyNotificationForAlert("danger_enter"), {
    title: "위험 구역이야",
    message: "안전한 곳으로 이동하고 부모님께 연락해.",
    urgent: true,
    ttlMs: 15 * 60_000,
  });
  assert.equal(childSafety.childSafetyNotificationForAlert("low_battery"), null);
});

test("child_safety는 명시한 활성 아이 한 명에게만 FCM·pending을 만든다", () => {
  const source = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(source, /action === "child_safety"/);
  assert.match(source, /childSafetyRecipientIds/);
  assert.match(source, /targetRole = "child"/);
  assert.match(source, /action === "child_safety"[\s\S]*targetUserId/);
  assert.match(source, /body\?\.action === "child_safety"/);
});

test("아이 안전 알림도 부모와 독립적으로 quiet 분할하며 억제는 성공 응답이다", () => {
  const source = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  const instant = source.slice(
    source.indexOf("async function handleInstantNotificationCore"),
    source.indexOf("// ── cron notification"),
  );
  assert.match(instant, /partitionNotificationRecipients\([\s\S]*action:\s*"child_safety"/);
  assert.match(instant, /childSafetyRecipientIds\s*=\s*quietPartition\.allowed/);
  assert.match(instant, /suppressedQuietHours/);
  assert.match(instant, /return jsonResponse\(\{[\s\S]*suppressedQuietHours[\s\S]*\}\)/);
});

test("부모 quiet·아이 허용과 부모 허용·아이 quiet는 서로의 수신자 집합을 재사용하지 않는다", () => {
  const source = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(source, /loadParentAlertRecipients/);
  assert.match(source, /childSafetyRecipientIds/);
  assert.doesNotMatch(source, /childSafetyRecipientIds\s*=\s*(?:effective)?ParentRecipientIds/);
});

test("부모 알림 생성 경로와 서버 cron이 아이 안전 알림을 함께 호출한다", () => {
  const parentAlerts = readFileSync(new URL("../routes/parent-alerts.ts", import.meta.url), "utf8");
  const cronDeliver = readFileSync(new URL("../cron/_deliver.ts", import.meta.url), "utf8");
  assert.match(parentAlerts, /sendChildSafetyNotification/);
  assert.match(cronDeliver, /sendChildSafetyNotification/);
});

test("cron 안전 사건은 parent_alert 기록을 먼저 확보한 뒤에만 부모와 아이에게 발송한다", () => {
  const cronDeliver = readFileSync(new URL("../cron/_deliver.ts", import.meta.url), "utf8");
  const insertIndex = cronDeliver.indexOf("alertId = await insertParentAlertV2");
  const parentPushIndex = cronDeliver.indexOf("const res = await handleInstantNotification");
  const childPushIndex = cronDeliver.indexOf("const childPushOk = await sendChildSafetyNotification");
  assert.ok(insertIndex >= 0, "parent_alert 선저장이 필요합니다");
  assert.ok(parentPushIndex > insertIndex, "부모 push는 기록 확보 뒤여야 합니다");
  assert.ok(childPushIndex > insertIndex, "아이 push는 기록 확보 뒤여야 합니다");
  assert.match(cronDeliver, /if \(!alertId\) return \{ pushOk: false, alertId: null,/);
});
