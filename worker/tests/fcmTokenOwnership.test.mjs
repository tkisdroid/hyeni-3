import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rpc = readFileSync(new URL("../routes/rest-shim-rpc.ts", import.meta.url), "utf8");
const table = readFileSync(new URL("../routes/rest-shim-table.ts", import.meta.url), "utf8");

function rpcCase(name, nextName) {
  const start = rpc.indexOf(`case "${name}"`);
  const end = rpc.indexOf(`case "${nextName}"`, start);
  assert.ok(start >= 0 && end > start, `${name} RPC 구간을 찾을 수 없습니다`);
  return rpc.slice(start, end);
}

test("일반 사용자는 같은 가족의 다른 사용자 명의로 FCM 토큰을 등록할 수 없다", () => {
  const source = rpcCase("upsert_fcm_token", "unregister_fcm_token");

  assert.match(source, /if \(!caller\.serviceRole && caller\.sub !== userId\) \{/);
  assert.match(source, /resolveCanonicalFamilyMembership\(db, caller\.sub!, caller\.familyId\)/);
  assert.match(source, /canonicalFamily\?\.familyId !== familyId/);
  assert.doesNotMatch(source, /caller\.sub !== userId && !\(await assertFamilyAccess/);
});

test("generic fcm_tokens POST도 본인 사용자와 현재 정본 가족만 허용한다", () => {
  assert.match(table, /if \(table === "fcm_tokens" && !caller\.serviceRole\) \{/);
  assert.match(table, /String\(r\.user_id \?\? ""\) !== caller\.sub/);
  assert.match(table, /resolveCanonicalFamilyMembership\(c\.env\.DB, caller\.sub!, caller\.familyId\)/);
  assert.match(table, /canonicalFamily\?\.familyId !== String\(r\.family_id \?\? ""\)/);
  assert.match(table, /upsertFcmTokenOwnership/);
  assert.doesNotMatch(table, /DELETE FROM fcm_tokens WHERE fcm_token = \? AND user_id != \?/);
});

test("RPC FCM 등록은 공통 원자 upsert만 사용하고 사후 타 사용자 삭제에 의존하지 않는다", () => {
  const source = rpcCase("upsert_fcm_token", "unregister_fcm_token");

  assert.match(source, /upsertFcmTokenOwnership/);
  assert.match(source, /p_registration_instance_id/);
  assert.match(source, /registrationInstanceId/);
  assert.match(source, /const owned = registrationInstanceId/);
  assert.match(source, /refreshLegacyFcmTokenOwnership/);
  assert.match(source, /endpoint_owned_by_other_user/);
  assert.doesNotMatch(source, /SELECT id FROM fcm_tokens/);
  assert.doesNotMatch(source, /DELETE FROM fcm_tokens WHERE fcm_token = \? AND user_id != \?/);
});

test("generic fcm_tokens 조회는 가족 전체 토큰이 아니라 호출자 본인 행으로 제한한다", () => {
  assert.match(
    table,
    /if \(table === "fcm_tokens"\) \{[\s\S]*disabled_at IS NULL[\s\S]*!caller\.serviceRole[\s\S]*"user_id = \?"[\s\S]*caller\.sub/,
  );
  assert.match(table, /disabled_at IS NULL/);
});

test("generic fcm_tokens PATCH로 가족 내 다른 사용자 토큰을 변경할 수 없다", () => {
  assert.match(
    table,
    /if \(table === "fcm_tokens" && !caller\.serviceRole\) return c\.json\(\{ error: "forbidden" \}, 403\)/,
  );
});

test("FCM 토큰 해제는 일반 호출자의 exact 활성 행만 비파괴 비활성화한다", () => {
  const source = rpcCase("unregister_fcm_token", "record_child_shutdown");

  assert.match(source, /const userId = caller\.serviceRole[\s\S]*caller\.sub/);
  assert.match(source, /if \(!caller\.serviceRole && userId !== caller\.sub\)/);
  assert.match(source, /unregisterOwnedFcmToken/);
  assert.match(source, /p_registration_instance_id/);
  assert.match(source, /registrationInstanceId/);
  assert.match(source, /now:\s*pgNow\(\)/);
  assert.doesNotMatch(source, /DELETE FROM fcm_tokens WHERE fcm_token = \?(?! AND user_id)/);
});

test("generic fcm_tokens 등록은 최신 세션 helper와 구버전 제한 갱신을 분리한다", () => {
  assert.match(table, /clientWriteAllow:[^\n]*registration_instance_id/);
  assert.match(table, /String\(r\.registration_instance_id \?\? ""\)\.trim\(\)/);
  assert.match(table, /registrationInstanceId/);
  assert.match(table, /refreshLegacyFcmTokenOwnership/);
  assert.match(table, /endpoint_owned_by_other_user/);
  assert.doesNotMatch(table, /registration_instance_id_required/);
});

test("구스키마에서는 RPC와 table shim이 endpoint mutation을 503으로 닫는다", () => {
  assert.match(rpc, /isNotificationEndpointSchemaUnavailable/);
  assert.match(rpc, /notification_endpoint_schema_unavailable/);
  assert.match(rpc, /503/);
  assert.match(table, /isNotificationEndpointSchemaUnavailable/);
  assert.match(table, /notification_endpoint_schema_unavailable/);
  assert.match(table, /503/);
});
