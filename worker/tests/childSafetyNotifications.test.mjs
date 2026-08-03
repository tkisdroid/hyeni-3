import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let childSafety = {};
try {
  childSafety = await import("../lib/childSafetyNotification.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

test("위험 구역 사건만 아이 말투의 별도 알림으로 변환한다", () => {
  assert.equal(typeof childSafety.childSafetyNotificationForAlert, "function");
  assert.deepEqual(childSafety.childSafetyNotificationForAlert("danger_enter"), {
    title: "위험 구역이야",
    message: "안전한 곳으로 이동하고 부모님께 연락해.",
    urgent: true,
    ttlMs: 15 * 60_000,
  });
  assert.deepEqual(childSafety.childSafetyNotificationForAlert("danger_zone"), {
    title: "위험 구역이야",
    message: "안전한 곳으로 이동하고 부모님께 연락해.",
    urgent: true,
    ttlMs: 15 * 60_000,
  });
  assert.deepEqual(childSafety.childSafetyNotificationForAlert("danger_exit"), {
    title: "위험 구역에서 벗어났어",
    message: "지금 위치를 부모님께도 알려드렸어.",
    urgent: false,
    ttlMs: 2 * 60 * 60_000,
  });
  assert.equal(childSafety.childSafetyNotificationForAlert("low_battery"), null);
});

// 아이가 알림 때문에 휴대폰을 더 보게 되므로 일상 이동은 아이에게 보내지 않는다
// (2026-08-03 보호자 결정). 부모 알림은 그대로 간다.
test("도착·출발 같은 일상 이동은 아이에게 알리지 않는다", () => {
  for (const alertType of [
    "arrived",
    "late_arrived",
    "place_arrived",
    "place_left",
    "unregistered_stay_left",
    "unregistered_stay_arrived",
  ]) {
    assert.equal(
      childSafety.childSafetyNotificationForAlert(alertType),
      null,
      `${alertType}는 아이에게 보내지 않아야 합니다`,
    );
  }
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
