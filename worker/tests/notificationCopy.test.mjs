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

// 2026-09-25 브라우저 QA — 영어로 쓰는 부모에게 아이의 설정 변경 요청과 기기 재연결 알림이
// 한국어로만 보였다. 메뉴 허용 목록으로 번역 id 를 고르고, 이름은 가족 정본에서 읽는다.
test("아이 설정 변경 요청은 허용된 메뉴만 번역 문구를 만들고 이름은 정본을 쓴다", async () => {
  const { formatNotificationCopy } = await import("../../shared/notificationCopy.ts");
  const db = database([{ name: "민지" }]);
  const copy = await resolvePublicParentAlertCopy(db, { familyId: "f", childUserId: "c", alertType: "child_setting_request", settingMenu: "sound" });
  assert.deepEqual(copy, { v: 1, id: "settingRequestSound", args: { child: "민지" } });
  assert.deepEqual(formatNotificationCopy(copy, "en"), {
    title: "Settings request",
    body: "민지 would like to change the sound and vibration settings.",
  });
  assert.equal(formatNotificationCopy(copy, "ko"), null, "한국어는 저장된 원문을 그대로 쓴다");
  for (const settingMenu of [null, "", "toString", "admin"]) {
    const empty = database([{ name: "민지" }]);
    assert.equal(await resolvePublicParentAlertCopy(empty, { familyId: "f", childUserId: "c", alertType: "child_setting_request", settingMenu }), null);
    assert.equal(empty.calls.length, 0);
  }
});

test("기기 재연결 알림은 번역 계약을 함께 저장한다", async () => {
  const { readFileSync } = await import("node:fs");
  const { formatNotificationCopy, makeNotificationCopy } = await import("../../shared/notificationCopy.ts");
  const source = readFileSync(new URL("../routes/family.ts", import.meta.url), "utf8");
  const block = source.slice(source.indexOf('alertType: "child_rejoined"'), source.indexOf('alertType: "child_rejoined"') + 600);
  assert.match(block, /notificationCopy: makeNotificationCopy\("childRejoined", \{ child: name \}\)/);
  assert.deepEqual(formatNotificationCopy(makeNotificationCopy("childRejoined", { child: "Minji" }), "en"), {
    title: "Device connection",
    body: "The device for Minji may have reconnected. Please check the family screen.",
  });
});
