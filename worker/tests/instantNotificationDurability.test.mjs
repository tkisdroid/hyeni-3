import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");

test("메모와 아이 안전 알림은 recipient별 pending을 generic delivery claim보다 먼저 보장한다", () => {
  const pendingIndex = source.indexOf("prequeuedGenericPending = await prequeueGenericRecipientPending");
  const claimIndex = source.indexOf("const genericClaim = await claimGenericDelivery");
  const webIndex = source.indexOf("// ── Web Push (VAPID) ──");
  assert.ok(pendingIndex >= 0, "generic recipient pending 선저장이 필요합니다");
  assert.ok(claimIndex > pendingIndex, "pending 뒤에 lease claim을 잡아야 합니다");
  assert.ok(webIndex > claimIndex, "claim 뒤에 외부 push를 보내야 합니다");
});

test("generic delivery claim은 미완료 lease를 재시도하고 성공 뒤에만 완료한다", () => {
  assert.match(source, /async function claimGenericDelivery/);
  assert.match(source, /first_sent_at IS NULL[\s\S]*created_at < \?/);
  assert.match(source, /await markGenericDeliveryComplete/);
  assert.match(source, /await releaseGenericDelivery/);
  assert.doesNotMatch(
    source.slice(source.indexOf("export async function handleInstantNotification")),
    /else if \(await claimIdempotencyKey\(db, idempotencyKey, action, familyId\)\)/,
  );
});

test("메모 recipient pending은 대상별 역할과 다자녀 딥링크를 함께 저장한다", () => {
  assert.match(source, /routeForRecipient\(args\.action, recipientUserId, args\.extraData\)/);
  assert.match(source, /roleForRecipient\(args\.action, recipientUserId, args\.extraData\)/);
  assert.match(source, /\/parent\/memo\?child=/);
});

test("deterministic pending id는 같은 pushId를 쓰는 다른 가족과 충돌하지 않는다", () => {
  assert.match(source, /instant-\$\{args\.familyId\}-\$\{args\.action\}-\$\{args\.pushId\}/);
});

test("공개 dispatcher는 서버 기록에서만 파생돼야 하는 알림 action을 사용자 JWT에 허용하지 않는다", () => {
  assert.match(source, /SERVER_DERIVED_NOTIFICATION_ACTIONS/);
  assert.match(
    source,
    /SERVER_DERIVED_NOTIFICATION_ACTIONS\.has\(String\(body\?\.action[\s\S]{0,180}callerRole !== "service_role"/,
  );
  assert.match(source, /server_derived_notification_only/);
});

test("구 클라이언트 new_memo는 최근 저장된 호출자 memo row로만 서버 재구성한다", () => {
  assert.match(source, /handleVerifiedLegacyMemoNotification/);
  assert.match(source, /SELECT id, content FROM memo_replies/);
  assert.match(source, /AND child_id = \? AND user_id = \?/);
  assert.match(source, /idempotencyKey = `memo:\$\{reply\.id\}`/);
  assert.match(source, /message: memoPushPreview\(reply\.content\)/);
});

test("구 클라이언트 parent_alert는 저장 행 정본과 공통 pushId로만 재구성한다", () => {
  assert.match(source, /handleVerifiedLegacyParentAlertNotification/);
  assert.match(source, /FROM parent_alerts[\s\S]*family_id = \? AND alert_type = \? AND title = \? AND message = \?/);
  assert.match(source, /resolveParentAlertWriteScope/);
  assert.match(source, /insertParentAlertV2\(env, db/);
  assert.match(source, /parentAlertDeliveryKey\(alert\.alert_type, alert\.event_id \|\| alert\.id\)/);
  assert.match(source, /parentAlertTargetRoute\(policy\.route, alert\.id, alert\.child_user_id\)/);
  assert.match(source, /body\?\.action === "parent_alert" && callerRole !== "service_role"/);
  assert.match(source, /membership\.role === "child" && isServerDerivedParentAlertType\(alertType\)/);
});

test("명시 recipient 알림은 수신자별 lease와 성공 상태를 따로 완료한다", () => {
  assert.match(source, /genericRecipientDeliveryKey\(familyId, pushId, recipientUserId\)/);
  assert.match(source, /const genericRecipientClaimLeases = new Map/);
  assert.match(source, /genericFcmSentRecipientIds\.has\(recipientUserId\)/);
  assert.match(source, /genericWebSentRecipientIds\.has\(recipientUserId\)/);
  assert.match(source, /releaseGenericDelivery\(db, recipientKey/);
  assert.match(source, /markGenericDeliveryComplete\([\s\S]{0,180}recipientKey/);
});

test("가족 공통 instant도 활성 사용자별 pending과 delivery 대상으로 먼저 확장한다", () => {
  const expandIndex = source.indexOf("loadActiveFamilyNotificationRecipientIds(db");
  const pendingIndex = source.indexOf("prequeuedGenericPending = await prequeueGenericRecipientPending");
  assert.ok(expandIndex >= 0, "가족 공통 수신자 확장이 필요합니다");
  assert.ok(expandIndex < pendingIndex, "가족 공통 pending 저장 전에 사용자별 수신자를 확정해야 합니다");
  assert.match(source, /recipient_routing_failed/);
  assert.match(source, /let deliveryGenericRecipientIds: Set<string> \| null = hadExplicitGenericRecipients/);
});

test("원격청취 명령은 audit session과 결합하고 60초 서버 고정값만 아이에게 보낸다", () => {
  assert.match(source, /authorizeRemoteListenCommand\(db/);
  assert.match(source, /remote_listen_request_required/);
  assert.match(source, /invalid_remote_listen_duration/);
  assert.match(source, /fcmExtraData\.durationSec = String\(REMOTE_LISTEN_DURATION_SEC\)/);
  assert.doesNotMatch(source, /fcmExtraData\.durationSec = String\(body\.durationSec\)/);
});

test("일반 instant는 active 수신자와 메모 permit을 확정한 뒤 pending 전에 quiet 분할한다", () => {
  const permitIndex = source.indexOf("memoDisplayPermits.set(recipientUserId, permit)");
  const activeRecipientsIndex = source.indexOf("loadActiveFamilyNotificationRecipientIds(db");
  const quietIndex = source.indexOf("quietPartition = await partitionNotificationRecipients", activeRecipientsIndex);
  const pendingIndex = source.indexOf("prequeuedGenericPending = await prequeueGenericRecipientPending", quietIndex);
  assert.ok(permitIndex >= 0 && permitIndex < quietIndex, "메모 permit 검증 뒤 quiet 분할해야 합니다");
  assert.ok(activeRecipientsIndex >= 0 && activeRecipientsIndex < quietIndex, "active 수신자 확정 뒤 quiet 분할해야 합니다");
  assert.ok(quietIndex >= 0 && pendingIndex > quietIndex, "quiet 분할 뒤 pending을 저장해야 합니다");
  const zeroDeliveryBlock = source.slice(quietIndex, pendingIndex);
  assert.match(zeroDeliveryBlock, /webSent:\s*0/);
  assert.match(zeroDeliveryBlock, /fcmSent:\s*0/);
  assert.match(zeroDeliveryBlock, /total:\s*0/);
  assert.match(zeroDeliveryBlock, /suppressedQuietHours/);
});
