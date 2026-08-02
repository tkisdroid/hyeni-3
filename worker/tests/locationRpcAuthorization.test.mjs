import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rpc = readFileSync(new URL("../routes/rest-shim-rpc.ts", import.meta.url), "utf8");

function rpcCase(name, nextName) {
  const start = rpc.indexOf(`case "${name}"`);
  const end = rpc.indexOf(`case "${nextName}"`, start);
  assert.ok(start >= 0 && end > start, `${name} RPC 구간을 찾을 수 없습니다`);
  return rpc.slice(start, end);
}

test("일반 current 위치 업로드는 caller 본인과 활성 child family membership을 모두 강제한다", () => {
  const source = rpcCase("upsert_child_location", "record_location_history_rows");

  assert.match(source, /if \(!caller\.serviceRole\) \{/);
  assert.match(source, /caller\.sub !== userId/);
  assert.match(
    source,
    /family_id=\? AND user_id=\? AND role='child' AND is_active=1/,
  );
  assert.match(source, /\.bind\(familyId, caller\.sub\)/);
});

test("일반 위치 이력 batch는 caller 외 user와 활성 child membership 불일치 family를 전부 거부한다", () => {
  const source = rpcCase("record_location_history_rows", "get_pending_notifications_for_device");

  assert.match(source, /!caller\.serviceRole && norm\.some\(\(n\) => n\.userId !== caller\.sub\)/);
  assert.match(source, /!caller\.serviceRole && norm\.some\(\(n\) => !memberOk\.has\(`/);
  assert.match(source, /return c\.json\(\{ error: "forbidden" \}, 403\)/);
  assert.match(
    source,
    /WHERE user_id IN \(\$\{ph\}\) AND role = 'child' AND is_active = 1/,
  );
});

test("service_role 위치 업로드는 self 제한을 우회하되 활성 child membership 검증은 유지한다", () => {
  const current = rpcCase("upsert_child_location", "record_location_history_rows");
  const history = rpcCase("record_location_history_rows", "get_pending_notifications_for_device");

  assert.match(current, /if \(!caller\.serviceRole\) \{[\s\S]*caller\.sub !== userId/);
  assert.doesNotMatch(current, /if \(caller\.serviceRole\)[\s\S]*return c\.json\(\{ error: "forbidden"/);
  assert.match(history, /if \(!caller\.serviceRole && norm\.some/);
  assert.match(history, /const authed = norm\.filter\(\(n\) => memberOk\.has/);
});
