import test from "node:test";
import assert from "node:assert/strict";
import { resolvePublicParentAlertCopy } from "../lib/notificationCopy.ts";

function database(rows) {
  const calls = [];
  return { calls, prepare(sql) { return { bind(...args) { calls.push({ sql, args }); return { async first() { return rows.shift() ?? null; } }; } }; } };
}
test("공개 등록장소 번역은 활성 아이와 같은 가족의 정본 장소명만 사용한다", async () => {
  const db = database([{ name: "아이 정본" }, { name: "학교 정본" }]);
  assert.deepEqual(await resolvePublicParentAlertCopy(db, { familyId: "f", childUserId: "c", alertType: "place_arrived", placeKey: "registered:saved_place:p" }), { v: 1, id: "arrived", args: { child: "아이 정본", place: "학교 정본" } });
  assert.deepEqual(db.calls.map(c => c.args), [["f", "c"], ["f", "p"]]);
  assert.match(db.calls[0].sql, /role='child' AND is_active=1/);
});
test("다른 가족·미상 장소와 장애는 표시 계약을 만들지 않는다", async () => {
  for (const rows of [[], [{ name: "아이" }]]) {
    assert.equal(await resolvePublicParentAlertCopy(database(rows), { familyId: "f", childUserId: "c", alertType: "place_left", placeKey: "registered:academy:foreign" }), null);
  }
  assert.equal(await resolvePublicParentAlertCopy({ prepare() { throw Error("offline"); } }, { familyId: "f", childUserId: "c", alertType: "sos" }), null);
});
test("일정 제목도 가족 범위에서 조회하고 임의 경고 종류는 수용하지 않는다", async () => {
  const db = database([{ name: "아이" }, { title: "Piano" }]);
  const copy = await resolvePublicParentAlertCopy(db, { familyId: "f", childUserId: "c", alertType: "late_arrived", sourceEventId: "event" });
  assert.equal(copy.id, "scheduleLate");
  assert.equal(copy.args.event, "Piano");
  assert.deepEqual(db.calls[1].args, ["f", "event"]);
  const empty = database([]);
  assert.equal(await resolvePublicParentAlertCopy(empty, { familyId: "f", childUserId: "c", alertType: "arbitrary" }), null);
  assert.equal(empty.calls.length, 0);
});
