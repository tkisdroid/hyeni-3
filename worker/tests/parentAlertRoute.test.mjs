import test from "node:test";
import assert from "node:assert/strict";
import {
  parentAlertTargetRoute,
} from "../lib/parentAlertRoute.ts";
import { readFileSync } from "node:fs";

test("SOS 알림 route는 정확한 alert와 아이 식별자를 보존한다", () => {
  assert.equal(
    parentAlertTargetRoute("/sos-receive", "alert-1", "child-1"),
    "/sos-receive?alert=alert-1&child=child-1",
  );
});

test("일반 부모 알림 route도 알림함의 정확한 행을 가리킨다", () => {
  assert.equal(
    parentAlertTargetRoute("/notifications", "alert / 2", null),
    "/notifications?alert=alert%20%2F%202",
  );
});

test("부모 알림 pending과 FCM이 같은 anchored route를 사용한다", () => {
  const source = readFileSync(new URL("../routes/parent-alerts.ts", import.meta.url), "utf8");
  assert.match(source, /const targetRoute = parentAlertTargetRoute/);
  assert.match(source, /route: targetRoute/);
  assert.match(source, /alertId/);
});

test("cron 부모 알림도 기록된 alert id를 동일한 anchored route로 전달한다", () => {
  const source = readFileSync(new URL("../cron/_deliver.ts", import.meta.url), "utf8");
  assert.match(source, /parentAlertTargetRoute/);
  assert.match(source, /route: targetRoute/);
  assert.match(source, /alertId/);
});

test("위험 장소 진입은 severity 누락과 무관하게 긴급, 이탈은 비긴급이다", async () => {
  const { resolveParentAlertPushType } = await import("../lib/parentAlertPushPolicy.ts");
  for (const alertType of ["danger_zone", "danger_enter", "danger_entry"]) {
    assert.deepEqual(resolveParentAlertPushType(alertType, "info"), {
      type: "parent_alert",
      urgent: true,
      route: "/notifications",
    });
  }
  assert.deepEqual(resolveParentAlertPushType("danger_exit", "info"), {
    type: "parent_alert",
    urgent: false,
    route: "/notifications",
  });
});

test("부모 알림은 DB 기록 뒤에만 수신자 조회와 push 처리를 시작한다", () => {
  const source = readFileSync(new URL("../routes/parent-alerts.ts", import.meta.url), "utf8");
  const insertIndex = source.indexOf("const alertId = await insertParentAlertV2");
  const recipientIndex = source.indexOf("await loadParentAlertRecipients", insertIndex);
  const deliveryIndex = source.indexOf("await handleInstantNotification", insertIndex);
  assert.ok(insertIndex >= 0, "알림 기록 호출이 있어야 합니다");
  assert.ok(recipientIndex > insertIndex, "수신자 조회는 알림 기록 이후여야 합니다");
  assert.ok(deliveryIndex > recipientIndex, "push 처리는 기록 및 수신자 조회 이후여야 합니다");
});

test("부모 알림은 quiet 허용 부모만 pending과 공통 발송기에 넘긴다", () => {
  const source = readFileSync(new URL("../routes/parent-alerts.ts", import.meta.url), "utf8");
  assert.match(source, /const \{ allowed, suppressed \} = await loadParentAlertRecipients/);
  assert.match(source, /parentIds: allowed/);
  assert.match(source, /quietHoursPartition:[\s\S]*allowed[\s\S]*suppressed/);
});

test("미도착 cron도 저장된 alertId의 알림함 행으로 이동한다", () => {
  const source = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(source, /parentAlertTargetRoute\("\/notifications", alertId, alertChildUserId\)/);
  assert.match(source, /alertData\.alertId = alertId/);
  assert.match(source, /alertData\.route = targetRoute/);
  assert.match(source, /alertId,[\s\S]{0,80}route: targetRoute/);
});
