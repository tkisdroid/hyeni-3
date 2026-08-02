import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../routes/push-subscriptions.ts", import.meta.url), "utf8");
const notifySource = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");

test("웹 푸시 구독은 호출자의 현재 정본 가족만 허용한다", () => {
  assert.match(source, /resolveCanonicalFamilyMembership/);
  assert.match(source, /canonical\.familyId !== familyId/);
});

test("endpoint 등록은 UNIQUE 기반 원자 helper로 처리하고 다른 사용자에게 재바인딩하지 않는다", () => {
  assert.match(source, /upsertPushSubscriptionOwnership/);
  assert.match(source, /endpoint_owned_by_other_user/);
  assert.doesNotMatch(source, /SELECT id, user_id FROM push_subscriptions WHERE endpoint = \?/);
});

test("웹 푸시 등록과 해제는 동일한 registration_instance_id를 필수로 사용한다", () => {
  assert.match(source, /registration_instance_id/);
  assert.match(source, /registrationInstanceId/);
  assert.match(source, /unregisterOwnedPushSubscription/);
  assert.match(source, /isPushSubscriptionRegistrationCurrent/);
  assert.match(source, /c\.req\.query\("registration_instance_id"\)/);
  assert.match(source, /endpoint,\s*userId:\s*user\.sub,\s*registrationInstanceId/);
});

test("구스키마 endpoint mutation은 503으로 fail-closed한다", () => {
  assert.match(source, /isNotificationEndpointSchemaUnavailable/);
  assert.match(source, /notification_endpoint_schema_unavailable/);
  assert.match(source, /503/);
});

test("웹 푸시 endpoint는 등록과 해제 모두 동일하게 공백을 정규화한다", () => {
  assert.match(source, /String\(b\.endpoint\)\.trim\(\)/);
  assert.match(source, /c\.req\.query\("endpoint"\)\?\.trim\(\) \?\? ""/);
});

test("VAPID 공개키 endpoint는 설정 여부를 정직하게 반환한다", () => {
  assert.match(source, /vapid-public-key/);
  assert.match(source, /configured/);
  assert.match(source, /VAPID_PUBLIC_KEY/);
});

test("웹 푸시 payload도 구독 사용자와 가족 및 탭 경로를 명시한다", () => {
  assert.match(notifySource, /targetUserId:\s*sub\.user_id/);
  assert.match(notifySource, /familyId/);
  assert.match(notifySource, /route/);
});
