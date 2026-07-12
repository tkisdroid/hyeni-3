import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(
  new URL("../android/app/src/main/java/com/hyeni/calendar/LocationService.java", import.meta.url),
  "utf8",
);
const fcm = readFileSync(
  new URL("../android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java", import.meta.url),
  "utf8",
);

test("도착·미도착 시간창은 시작 후 경과분(now-event)으로 계산한다", () => {
  assert.equal(/int minutesFromStart = nowTotalMin - evTotalMin;/.test(service), true);
  assert.equal(/int diffToStart = evTotalMin - nowTotalMin;/.test(service), false);
  assert.equal(/minutesFromStart >= 0 && minutesFromStart <= 5/.test(service), true);
  assert.equal(/minutesFromStart >= 15 && minutesFromStart <= 18/.test(service), true);
});

test("일정 도착 판정은 좌표의 신선도와 정확도를 확인한 뒤에만 수행한다", () => {
  assert.equal(/EventArrivalPolicy\.classify/.test(service), true);
  assert.equal(/lastUploadedAccuracyM/.test(service), true);
  assert.equal(/lastUploadedAtMs/.test(service), true);
  assert.equal(/ArrivalDecision\.UNKNOWN/.test(service), true);
});

test("아이 로컬 일정 알림은 서버가 계산한 사용자별 시간을 사용한다", () => {
  assert.equal(/event_reminder_minutes/.test(service), true);
  assert.equal(/event_reminders_enabled/.test(service), true);
  assert.equal(/int\[\] minsBefore = \{15, 5, 0\}/.test(service), false);
});

test("warning 미도착의 urgent=false는 네이티브 전체화면 승격을 명시적으로 막는다", () => {
  assert.equal(/NotificationUrgencyPolicy\.isEmergency/.test(fcm), true);
  assert.equal(/NotificationUrgencyPolicy\.isEmergency/.test(service), true);
});

test("아이 일정·장소 도착 알림은 서버 단일 endpoint가 저장과 부모 푸시를 함께 책임진다", () => {
  const parentAlertEndpointCalls = service.match(/\/api\/parent-alerts/g) ?? [];
  assert.equal(parentAlertEndpointCalls.length >= 2, true);
  assert.equal(/\/rest\/v1\/rpc\/insert_parent_alert_v2/.test(service), false);
  assert.equal(/\/functions\/v1\/push-notify/.test(service), false);
});

test("일정 수정 후 같은 날 재알림·도착은 서버 occurrence revision key로 새로 구분한다", () => {
  assert.equal(/event_occurrence_id/.test(service), true);
  assert.equal(/event_revision_key/.test(service), true);
  assert.equal(/source_event_id/.test(service), true);
  assert.equal(/reminderKey = eventId \+ "-" \+ key \+ "-" \+ dateKey \+ "-" \+ eventRevisionKey/.test(service), true);
});
