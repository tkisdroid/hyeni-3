import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canonicalParentAlertType,
  parentAlertDedupeKey,
  parentAlertDeliveryKey,
  parentAlertPendingId,
  parentAlertRecipientClaimKey,
  shouldRetryParentRecipientDelivery,
} from "../lib/parentAlertDedupe.ts";

test("부모 알림 멱등키는 같은 event id라도 가족별로 분리된다", () => {
  const first = parentAlertDedupeKey("family-a", "arrived", "event-shared");
  const second = parentAlertDedupeKey("family-b", "arrived", "event-shared");
  assert.notEqual(first, second);
  assert.equal(first, parentAlertDedupeKey("family-a", "arrived", "event-shared"));
});

test("등록장소·일정 도착의 DB·push·pending 멱등키는 같은 occurrence로 합쳐진다", () => {
  const occurrence = "event-1:2026-6-13:r1";
  for (const alertType of ["arrived", "late_arrived", "place_arrived"]) {
    assert.equal(canonicalParentAlertType(alertType), "arrived");
    assert.equal(
      parentAlertDedupeKey("family-a", alertType, occurrence),
      parentAlertDedupeKey("family-a", "arrived", occurrence),
    );
    assert.equal(parentAlertDeliveryKey(alertType, occurrence), `parent-alert:arrived:${occurrence}`);
    assert.equal(
      parentAlertPendingId(parentAlertDeliveryKey(alertType, occurrence), "parent-1"),
      `parent-alert-parent-alert:arrived:${occurrence}-parent-1`,
    );
  }
  assert.notEqual(
    parentAlertRecipientClaimKey(parentAlertDeliveryKey("arrived", occurrence), "parent-1"),
    parentAlertRecipientClaimKey(parentAlertDeliveryKey("arrived", occurrence), "parent-2"),
  );
  assert.equal(shouldRetryParentRecipientDelivery({ hasNativeChannel: true, hasWebChannel: false, delivered: false }), true);
  assert.equal(shouldRetryParentRecipientDelivery({ hasNativeChannel: false, hasWebChannel: true, delivered: false }), true);
  assert.equal(shouldRetryParentRecipientDelivery({ hasNativeChannel: true, hasWebChannel: false, delivered: true }), false);
  assert.equal(shouldRetryParentRecipientDelivery({ hasNativeChannel: false, hasWebChannel: false, delivered: false }), false);
});

test("부모 알림 기존행 조회와 조건부 insert는 family_id를 항상 포함한다", () => {
  const push = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../routes/parent-alerts.ts", import.meta.url), "utf8");

  for (const source of [push, route]) {
    assert.doesNotMatch(
      source,
      /FROM parent_alerts WHERE event_id = \? AND alert_type = \?/,
      "family_id 없는 기존행 조회는 타가족 alert id를 노출하거나 알림을 유실시킨다",
    );
  }
  assert.match(push, /WHERE family_id = \? AND event_id = \?/);
  assert.match(push, /WHEN alert_type IN \('arrived','late_arrived','place_arrived'\) THEN 'arrived'/);
  assert.match(route, /insertParentAlertV2/);
});

test("cron과 자녀 endpoint는 같은 canonical push와 pending id 생성기를 사용한다", () => {
  const deliver = readFileSync(new URL("../cron/_deliver.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../routes/parent-alerts.ts", import.meta.url), "utf8");
  const push = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");

  assert.match(deliver, /parentAlertDeliveryKey/);
  assert.match(route, /parentAlertDeliveryKey/);
  assert.match(route, /handleInstantNotification/);
  assert.match(route, /parentAlertPendingId/);
  assert.match(push, /parentAlertPendingId/);
  assert.match(push, /parentAlertRecipientClaimKey/);
  assert.match(push, /deliveryParentRecipientIds/);
  assert.match(push, /shouldRetryParentRecipientDelivery/);
  assert.match(push, /parent_delivery_retryable/);
  assert.doesNotMatch(push, /instant-parent-\$\{pushId\}/);
});

test("멱등 claim만 남은 중단은 성공으로 오인하지 않고 lease 뒤 회수한다", () => {
  const push = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");

  assert.doesNotMatch(push, /if \(existingClaim\?\.alert_id\) return existingClaim\.alert_id/);
  assert.match(push, /JOIN parent_alerts/);
  assert.match(push, /created_at < \?/);
  assert.match(push, /DELETE FROM parent_alert_idempotency/);
  assert.match(push, /if \(!ownsClaim\) \{/);
});
