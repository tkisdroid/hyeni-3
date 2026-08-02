import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("일정·미도착 cron은 가족과 모든 대상 자녀 lease 안에서만 쓰고 발송한다", () => {
  const text = source("../routes/push-notify.ts");
  const loopStart = text.indexOf("for (const event of events)");
  const pendingWrite = text.indexOf("const pendingOk = await insertPending", loopStart);
  const release = text.indexOf("await releaseAccountMutationLease", pendingWrite);

  assert.match(text, /acquireAccountMutationLease/);
  assert.match(text, /SELECT parent_id FROM families WHERE id=\?/);
  assert.ok(loopStart >= 0 && pendingWrite > loopStart);
  const acquire = text.indexOf("const cronMutationLease = await acquireCronFamilyMutationLease", loopStart);
  assert.ok(acquire >= loopStart && acquire < pendingWrite);
  const targetChildren = text.indexOf("const eventTargetChildren = selectEventTargetChildren", loopStart);
  const childLeaseAcquire = text.indexOf("acquireAccountMutationLeases", targetChildren);
  assert.ok(targetChildren > acquire && childLeaseAcquire > targetChildren && childLeaseAcquire < pendingWrite);
  assert.match(text.slice(targetChildren, pendingWrite), /loadFamilyNotificationMutationScopes[\s\S]*event\.family_id/);
  assert.match(text.slice(childLeaseAcquire, pendingWrite), /isActiveChildMutationTarget/);
  assert.ok(release > pendingWrite);
  assert.match(text.slice(loopStart, release + 600), /try \{[\s\S]*finally \{[\s\S]*cronChildMutationLeases/);
});

test("선생님 batch cron은 teacher와 모든 대상 가족·자녀 lease를 잡고 해제한다", () => {
  const text = source("../cron/teacher-notification-batch.ts");
  assert.match(text, /JOIN teacher_profiles/);
  assert.match(text, /user_id AS teacher_user_id/);
  assert.match(text, /acquireAccountMutationLease\(db, \{ userId: tc\.teacherUserId \}\)/);
  assert.match(text, /JOIN family_members fm ON fm\.id=tcc\.child_member_id/);
  assert.match(text, /JOIN families f ON f\.id=fm\.family_id/);
  assert.match(text, /fm\.user_id AS child_user_id/);
  assert.match(text, /acquireAccountMutationLease\(db, \{[\s\S]*userId: scope\.ownerUserId,[\s\S]*familyId: scope\.familyId/);
  assert.match(text, /acquireAccountMutationLease\(db, \{[\s\S]*userId: scope\.childUserId,[\s\S]*familyId: scope\.familyId/);
  assert.match(text, /finally \{[\s\S]*releaseAccountMutationLease\(db, teacherMutationLease\.lease\.id\)[\s\S]*teacherTargetMutationLeases/);
});

test("AI proactive cron은 자녀·가족 lease 안에서 candidate를 처리한다", () => {
  const text = source("../routes/ai-proactive.ts");
  const scheduledStart = text.indexOf("export async function runScheduledProactive");
  const processCall = text.indexOf("processCandidate(env, db", scheduledStart);
  assert.match(text.slice(scheduledStart), /acquireAccountMutationLease\(db, \{[\s\S]*userId: candidate\.user_id,[\s\S]*familyId: candidate\.family_id/);
  assert.ok(processCall > scheduledStart);
  assert.ok(text.indexOf("await releaseAccountMutationLease", processCall) > processCall);
  assert.match(text.slice(scheduledStart), /try \{[\s\S]*finally \{/);
});

for (const [label, relativePath, loopMarker, writeMarker] of [
  ["등록장소", "../cron/registered-place-geofence-check.ts", "for (const child of children)", "deliverParentAlert"],
  ["위험장소", "../cron/danger-zone-geofence-check.ts", "for (const child of children)", "persistPlacePresence"],
  ["위치 끊김", "../cron/location-staleness-check.ts", "for (const child of children)", "deliverWake"],
  ["미등록 체류", "../cron/unregistered-stay-check.ts", "for (const child of loaded.children)", "reverseGeocodeAreaLabel"],
]) {
  test(`${label} cron은 자녀·가족 lease를 쓰기·외부 호출보다 먼저 잡고 finally에서 해제한다`, () => {
    const text = source(relativePath);
    const runStart = text.indexOf("export async function run");
    const loopStart = text.indexOf(loopMarker, runStart);
    const scopeLoad = text.indexOf("loadFamilyNotificationMutationScopes", loopStart);
    const acquire = text.indexOf("acquireAccountMutationLeases", scopeLoad);
    const activeRecheck = text.indexOf("isActiveChildMutationTarget", acquire);
    const write = text.indexOf(writeMarker, loopStart);
    const finallyStart = text.indexOf("finally", write);
    const release = text.indexOf("releaseAccountMutationLeases", finallyStart);
    assert.ok(loopStart >= 0 && scopeLoad > loopStart && acquire > scopeLoad && activeRecheck > acquire);
    assert.ok(write > activeRecheck && finallyStart > write && release > finallyStart);
  });
}

test("원격청취 만료는 INSERT 없이 기존 행만 조건부 UPDATE하여 삭제 완료 뒤 고아행을 만들지 않는다", () => {
  const text = source("../lib/remoteListenExpiry.ts");
  assert.doesNotMatch(text, /INSERT INTO remote_listen_sessions/);
  assert.match(text, /UPDATE remote_listen_sessions[\s\S]*WHERE id = \? AND ended_at IS NULL/);
});

test("강제알림 리마인더는 initiator·target·family lease 안에서만 endpoint 조회·발송·갱신한다", () => {
  const text = source("../routes/push-notify.ts");
  const start = text.indexOf("export async function handleForceRingReminder");
  const loop = text.indexOf("for (const event of candidates)", start);
  const acquire = text.indexOf("acquireAccountMutationLeases", loop);
  const endpointRead = text.indexOf("SELECT fcm_token, platform FROM fcm_tokens", loop);
  const release = text.indexOf("releaseAccountMutationLeases", endpointRead);
  assert.ok(start >= 0 && loop > start && acquire > loop && endpointRead > acquire && release > endpointRead);
  assert.match(text.slice(acquire, endpointRead), /initiatorId[\s\S]*familyId[\s\S]*targetUserId/);
  assert.match(text.slice(acquire, endpointRead), /isActiveChildMutationTarget/);
});

test("친구놀이 자동종료는 양쪽 가족의 모든 활성 계정 lease 안에서 위치확인·갱신·fanout한다", () => {
  const text = source("../cron/friend-playdate-auto-end.ts");
  const loop = text.indexOf("for (const session of results");
  const acquire = text.indexOf("acquireAccountMutationLeases", loop);
  const locationRead = text.indexOf("hasRecentChildAtPlace", loop);
  const update = text.indexOf("UPDATE friend_playdate_sessions", loop);
  const fanout = text.indexOf("notifyPg", update);
  const release = text.indexOf("releaseAccountMutationLeases", fanout);
  assert.ok(loop >= 0 && acquire > loop && locationRead > acquire && update > locationRead);
  assert.ok(fanout > update && release > fanout);
});

test("강제알림 delivery timeout은 INSERT·push 없이 기존 행만 조건부 UPDATE한다", () => {
  const text = source("../cron/force-ring-delivery-timeout.ts");
  assert.match(text, /UPDATE force_ring_events/);
  assert.doesNotMatch(text, /INSERT INTO|sendFcm|notifyPg|pending_notifications/);
});
