import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("수동 인증 push dispatch는 caller와 해석된 대상 가족 lease 안에서 실행된다", () => {
  const text = source("../routes/push-notify.ts");
  const routeStart = text.indexOf('push.post("/"');
  const auth = text.indexOf("verifyAccessToken", routeStart);
  const dispatchLease = text.indexOf("acquirePushDispatchMutationLeases", auth);
  const dispatch = text.indexOf("handleInstantNotification", dispatchLease);
  const release = text.indexOf("releaseAccountMutationLeases", dispatch);
  assert.ok(routeStart >= 0 && auth > routeStart && dispatchLease > auth);
  assert.ok(dispatch > dispatchLease && release > dispatch);
  assert.match(text.slice(dispatchLease, release + 200), /try \{[\s\S]*finally \{/);
  assert.match(text, /callerUserId[\s\S]*targetFamilyIds/);
});

test("rest shim RPC와 table mutation은 사용자와 활성 가족 lease 안에서 dispatch된다", () => {
  const text = source("../routes/rest-shim.ts");
  assert.match(text, /async function withCallerMutationLeases/);
  assert.match(text, /userId: cl\.sub/);
  assert.match(text, /cl\.familyIds/);
  for (const call of [
    "dispatchRpc(c, fn, cl)",
    "handleLocationsPost(c, cl)",
    "handleTablePost(c, table, cfg!, cl)",
    "handleTablePatch(c, table, cfg, cl)",
  ]) {
    const callAt = text.indexOf(call);
    assert.ok(callAt >= 0, `${call} 호출을 찾지 못함`);
    const wrapperAt = text.lastIndexOf("withCallerMutationLeases", callAt);
    assert.ok(wrapperAt >= 0 && wrapperAt < callAt, `${call}이 lease wrapper 밖에 있음`);
  }
});

test("rest shim realtime broadcast는 삭제 경합 lease 안에서만 DO fanout한다", () => {
  const text = source("../routes/rest-shim.ts");
  const routeStart = text.indexOf('shim.post("/realtime/v1/api/broadcast"');
  const wrapper = text.indexOf("withCallerMutationLeases", routeStart);
  const fanout = text.indexOf('stub.fetch("https://do.internal/notify"', routeStart);
  assert.ok(routeStart >= 0 && wrapper > routeStart && fanout > wrapper);
});

test("rest shim service-role mutation도 request target scope 없이 무임대 실행되지 않는다", () => {
  const text = source("../routes/rest-shim.ts");
  assert.doesNotMatch(text, /if \(cl\.serviceRole\) return task\(\)/);
  assert.match(text, /MUTATING_RPC_NAMES/);
  assert.match(text, /resolveServiceMutationScopes/);
  assert.match(text, /c\.req\.raw\.clone\(\)/);
  assert.match(text, /account_mutation_scope_required/);
});

test("메모 outbox 즉시 처리는 DB write 전에 잡은 대상 lease를 완료까지 인계한다", () => {
  const text = source("../routes/memos.ts");
  const route = text.indexOf('memos.post("/replies"');
  const acquire = text.indexOf("acquireAccountMutationLeases", route);
  const write = text.indexOf("buildMemoReplyOutboxStatements", route);
  const wait = text.indexOf("waitUntil", write);
  const call = text.indexOf("processMemoNotificationOutboxReply", wait);
  const release = text.indexOf("releaseAccountMutationLeases", call);
  const earlyRelease = text.indexOf("releaseAccountMutationLeases", write);
  assert.ok(route >= 0 && acquire > route && write > acquire && wait > write);
  assert.ok(call > wait && release > call);
  assert.ok(earlyRelease > call, "outbox 즉시 처리 전에 저장 lease를 반납하면 안 됨");
  assert.match(text.slice(call, release + 100), /memoMutationLeases\.leases[\s\S]*finally \{/);
});

for (const [label, relativePath, routeMarker, writeMarker, waitCall] of [
  ["스티커", "../routes/stickers.ts", 'stickers.post("/"', "INSERT INTO stickers", "sendFcmToFamily"],
  ["선생님 공지", "../routes/teacher-notices.ts", 'tn.post("/notices"', "INSERT INTO teacher_notices", "handleTeacherNotice"],
  ["임의장소 도착", "../routes/rest-shim-rpc.ts", 'case "upsert_child_location"', "CURRENT_LOCATION_UPSERT_SQL", "detectArbitraryArrival"],
]) {
  test(`${label} waitUntil은 DB write 전에 잡은 대상 lease를 완료까지 넘겨받아 해제한다`, () => {
    const text = source(relativePath);
    const route = text.indexOf(routeMarker);
    const acquire = text.indexOf("acquireAccountMutationLeases", route);
    const write = text.indexOf(writeMarker, route);
    const wait = text.indexOf("waitUntil", write);
    const call = text.indexOf(waitCall, wait);
    const release = text.indexOf("releaseAccountMutationLeases", call);
    assert.ok(route >= 0 && acquire > route && write > acquire && wait > write);
    assert.ok(call > wait && release > call);
    assert.match(text.slice(wait, release + 100), /try \{[\s\S]*finally \{/);
  });
}
