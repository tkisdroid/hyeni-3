import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as notificationRouting from "../lib/notificationRouting.ts";
import {
  applyEventNotifOverride,
  buildNotifSettingsMap,
  DEFAULT_CRON_NOTIF_SETTING,
} from "../lib/notificationRouting.ts";

test("사용자가 사전 알림 시간을 모두 해제한 설정은 기본 15·5분으로 되살아나지 않는다", () => {
  const map = buildNotifSettingsMap([{
    user_id: "u1",
    parent_enabled: true,
    child_enabled: true,
    minutes_before: [],
  }]);
  assert.deepEqual(map.get("u1")?.minutesBefore, []);
});

test("이벤트의 명시적 빈 override는 해당 일정의 사전 알림을 끈다", () => {
  const effective = applyEventNotifOverride(DEFAULT_CRON_NOTIF_SETTING, { minutesBefore: [] });
  assert.deepEqual(effective.minutesBefore, []);
});

test("네이티브 오늘 일정 응답에는 사용자별 알림 시간과 활성 여부가 포함된다", () => {
  const src = readFileSync(new URL("../routes/rest-shim-rpc.ts", import.meta.url), "utf8");
  assert.match(src, /event_reminder_minutes/);
  assert.match(src, /event_reminders_enabled/);
  assert.match(src, /notif_override/);
});

test("반복 일정 저장은 서버에서 검증 후 D1 원자 배치로 처리한다", () => {
  const src = [
    readFileSync(new URL("../routes/events.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../lib/eventBatch.ts", import.meta.url), "utf8"),
  ].join("\n");
  assert.match(src, /events\.post\("\/batch"/);
  assert.match(src, /validateEventBatch/);
  assert.match(src, /await c\.env\.DB\.batch\(/);
  assert.match(src, /family_members[\s\S]*role = 'child'[\s\S]*is_active = 1/);
});

test("미도착 cron은 정확도를 조회하고 부모별 pending 폴백을 먼저 보장한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(src, /SELECT user_id, lat, lng, updated_at, accuracy_m FROM child_locations/);
  assert.match(src, /for \(const parentUserId of parentRecipients\)[\s\S]*targetUserId: parentUserId/);
  assert.match(src, /releaseGenericDelivery\([\s\S]{0,80}notArrivedLeaseKey/);
});

test("부모 알림 연쇄는 warning 미도착을 SOS 타입으로 강제하지 않는다", () => {
  const src = readFileSync(new URL("../routes/parent-alerts.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /String\(b\.message[\s\S]*"sos"/);
  assert.match(src, /resolveParentAlertPushType/);
});

test("cron 시간창은 조기 발송 없이 정각 우선·최대 2분 지연 복구만 허용한다", () => {
  const isDue = notificationRouting.isCronReminderDue;
  assert.equal(typeof isDue, "function");
  assert.equal(isDue?.(599, 600), false);
  assert.equal(isDue?.(600, 600), true);
  assert.equal(isDue?.(602, 600), true);
  assert.equal(isDue?.(603, 600), false);
});

test("일정 알림 수신자·설정 조회 실패 시 잘못된 가족 전체 발송을 하지 않는다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /falling back to fire-all/);
  assert.doesNotMatch(src, /legacyFcm/);
  assert.match(src, /membersError\) continue/);
});

test("하루 이벤트가 많아도 events_children 조회는 D1 변수 제한 단위로 청크 처리한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(src, /chunkSqlVariables\(ids, EVENT_CHILD_QUERY_CHUNK\)/);
});

test("parent_alert FCM은 형제 아이에게 누수되지 않고 부모만 수신한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(src, /action === "sos" \|\| action === "emergency" \|\| action === "kkuk" \|\| action === "parent_alert"/);
});

test("emergency도 가족 전체가 아니라 부모 수신자로만 제한한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(src, /action === "sos" \|\| action === "emergency" \|\| action === "kkuk" \|\| action === "parent_alert"/);
});

test("일정 pending은 시작 뒤 만료되고 편집·삭제 시 취소된다", () => {
  const pushSrc = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  const eventSrc = readFileSync(new URL("../routes/events.ts", import.meta.url), "utf8");
  assert.match(pushSrc, /reminderPendingExpiresAt/);
  assert.match(eventSrc, /DELETE FROM pending_notifications[\s\S]*\$\.eventId/);
  assert.match(eventSrc, /DELETE FROM push_sent WHERE event_id/);
});

test("사전 일정 pending은 각 알림 목표시각의 짧은 복구창 뒤 만료된다", () => {
  const pushSrc = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(pushSrc, /function reminderPendingExpiresAt\([\s\S]*minsBefore/);
  assert.match(pushSrc, /startAtMs - minsBefore \* 60_000 \+ 3 \* 60_000/);
  assert.match(pushSrc, /reminderPendingExpiresAt\(event, window\.minsBefore\)/);
});

test("일정 도착·미도착 반경은 네이티브와 동일한 80m다", () => {
  assert.equal(notificationRouting.ARRIVAL_RADIUS_M, 80);
});

test("웹·FCM이 모두 실패하면 native 여부와 무관하게 claim을 풀어 grace tick 재시도를 허용한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(src, /let webSentForRecipient = 0/);
  assert.match(
    src,
    /if \(webSentForRecipient === 0[\s\S]{0,120}&& fcmSent === 0\)/,
  );
  assert.doesNotMatch(src, /if \(!nativeRecipientIds\.has\(recipientUserId\)[\s\S]{0,180}webSentForRecipient === 0/);
  assert.match(src, /await releaseGenericDelivery\([\s\S]{0,80}scheduleLeaseKey/);
});

test("일정 알림은 Worker 중단에도 유실되지 않도록 pending을 claim보다 먼저 보장한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  const loopStart = src.indexOf("for (const recipientUserId of group.recipients)");
  const recipientLoop = src.slice(
    loopStart,
    src.indexOf("await deletePushSubsByIds(db, expiredIds)", loopStart),
  );
  const pendingIndex = recipientLoop.indexOf("const pendingOk = await insertPending");
  const claimIndex = recipientLoop.indexOf("const scheduleClaim = await claimGenericDelivery");
  assert.ok(pendingIndex >= 0 && claimIndex > pendingIndex, "pending 보장 뒤 claim이어야 합니다");
});

test("일정과 미도착은 전송 전 영구 push_sent가 아니라 만료 가능한 lease를 잡고 성공 뒤 완료한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  const scheduleStart = src.indexOf("for (const recipientUserId of group.recipients)");
  const scheduleEnd = src.indexOf("await deletePushSubsByIds(db, expiredIds)", scheduleStart);
  const scheduleLoop = src.slice(scheduleStart, scheduleEnd);
  assert.match(scheduleLoop, /claimGenericDelivery\([\s\S]{0,80}scheduleLeaseKey/);
  assert.match(scheduleLoop, /recordPushSentComplete/);
  assert.match(scheduleLoop, /markGenericDeliveryComplete/);
  assert.doesNotMatch(scheduleLoop, /claimPushSent/);

  const notArrivedStart = src.indexOf("const notArrivedClaimKey");
  const notArrivedBlock = src.slice(notArrivedStart, src.indexOf("return jsonResponse({", notArrivedStart));
  assert.match(notArrivedBlock, /claimGenericDelivery\([\s\S]{0,80}notArrivedLeaseKey/);
  assert.match(notArrivedBlock, /markGenericDeliveryComplete/);
  assert.doesNotMatch(notArrivedBlock, /claimPushSent/);
});

test("일정 알림 수신자에는 family_members 행이 없는 주보호자도 포함한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /SELECT user_id, role FROM family_members[\s\S]{0,300}UNION[\s\S]{0,160}SELECT parent_id AS user_id, 'parent' AS role FROM families/,
  );
});

test("일정 Web Push payload는 pending과 동일한 expiresAt을 전달한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(src, /const reminderExpiresAt = reminderPendingExpiresAt\(event, window\.minsBefore\)/);
  assert.match(src, /expiresAt: reminderExpiresAt/);
});

test("일정 pending은 대상 역할과 탭 경로를 FCM과 동일하게 보존한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /data:\s*\{\s*\.\.\.groupPayload\.data,\s*targetUserId:\s*recipientUserId\s*\}/,
  );
});

test("한 사용자의 Android와 웹 구독은 서로 대체하지 않고 모든 등록 기기로 발송한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /nativeRecipientIds\.has\(sub\.user_id\)\) continue/);
  assert.doesNotMatch(src, /webConfigured && subs\.length && !nativeRecipientIds\.has\(recipientUserId\)/);
});

test("일정 부모·아이 수신자는 occurrence 전달 단위보다 먼저 각각 quiet 분할한다", () => {
  const src = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  const groupsIndex = src.indexOf("const sendGroups = [");
  const pendingIndex = src.indexOf("const schedulePendingId", groupsIndex);
  assert.ok(groupsIndex >= 0 && pendingIndex > groupsIndex, "일정 전달 블록을 찾을 수 없습니다");
  const routingBlock = src.slice(groupsIndex, pendingIndex);
  assert.equal(
    (routingBlock.match(/partitionNotificationRecipients\s*\(/g) ?? []).length,
    2,
    "부모와 아이 수신자를 독립적으로 quiet 분할해야 합니다",
  );
  assert.match(routingBlock, /identity:\s*\{ action: "schedule_reminder" \}/);
  assert.match(routingBlock, /const deliveryGroups = sendGroups\.filter/);
  assert.match(src, /alertType:\s*"not_arrived"/);
});
