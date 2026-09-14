import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { definitions } from "../shared/notificationDefinitions.ts";
import { normalizeNotificationCopy, makeNotificationCopy, formatNotificationCopy } from "../shared/notificationCopy.ts";
const { pendingPresentation, presentWebPendingNotification } = await import("../src/lib/native/parentPendingNotifications.ts");
const { localizeParentAlert } = await import("../src/transform/notificationsView.ts");

const catalog = JSON.parse(readFileSync(new URL("../locales/notification-messages.json", import.meta.url), "utf8"));
test("도착·위험·SOS 상세 번역도 query 원본과 대상 아이·읽음 상태를 변경하지 않는다", () => {
  const alert = { id: "a", title: "원제목", message: "원문", read: false, child_user_id: "c", alert_type: "danger_zone", metadata: { notificationCopy: makeNotificationCopy("dangerEnter", { child: "Min", place: "Park" }) } };
  const translated = localizeParentAlert(alert, "en");
  assert.match(translated.message, /Min is near Park/);
  assert.equal(translated.child_user_id, "c");
  assert.equal(translated.read, false);
  assert.equal(alert.message, "원문");
  assert.equal(localizeParentAlert(alert, "ko"), alert);
});
for (const locale of Object.keys(catalog.locales)) {
  test(`알림 계약의 모든 종류는 ${locale}에서 원문 보존 또는 매개변수 번역된다`, () => {
    for (const id of Object.keys(definitions)) {
      const copy = makeNotificationCopy(id, { child: "민서", place: "Central Park", from: "Home", event: "Piano", minutes: 15, hours: 24 });
      const result = formatNotificationCopy(JSON.stringify(copy), locale);
      if (locale === "ko") { assert.equal(result, null); continue; }
      assert.ok(result.title && result.body, id);
      assert.doesNotMatch(result.body, /\{(?:child|place|from|event|minutes|hours)\}/);
      if (definitions[id].slice(1).includes("child")) assert.ok(result.body.includes("민서"), id);
    }
  });
}

test("잘못된 표시 계약은 안전 알림 원문으로 폴백하고 제어 필드는 수용하지 않는다", () => {
  for (const input of [null, [], "{", "x".repeat(2201), { v: 2, id: "sos" }, { v: 1, id: "__proto__" }, { v: 1, id: "stale", args: { minutes: -1 } }, { v: 1, id: "stale", args: { minutes: "15" } }]) {
    assert.equal(normalizeNotificationCopy(input), null);
  }
  const copy = normalizeNotificationCopy({ v: 1, id: "arrived", args: { child: " \u202e민서\n ", place: "P".repeat(201), urgent: true }, route: "/admin", expiresAt: "2100-01-01", urgent: true });
  assert.deepEqual(Object.keys(copy).sort(), ["args", "id", "v"]);
  assert.equal(copy.args.child, "민서");
  assert.equal(copy.args.place.length, 200);
  assert.equal(copy.args.urgent, undefined);
});

test("이름은 재해석하지 않으며 미지원 언어는 영어로 표시한다", () => {
  const copy = makeNotificationCopy("arrived", { child: "$& {place}", place: "東京" });
  assert.equal(formatNotificationCopy(copy, "en").body, "$& {place} arrived at 東京.");
  assert.deepEqual(formatNotificationCopy(copy, "fr"), formatNotificationCopy(copy, "en"));
});

test("사건 시각은 수신 시각이 아닌 가족 시간대와 DST를 반영한다", () => {
  const copy = { ...makeNotificationCopy("leftNear", { child: "M", place: "P" }), timeZone: "America/New_York", occurredAt: "2026-03-08T07:01:00.000Z", delayed: true };
  const rendered = formatNotificationCopy(copy, "en").body;
  assert.match(rendered, /3:01/);
  assert.match(rendered, /EDT/);
  assert.match(rendered, /earlier event/);
  const invalid = normalizeNotificationCopy({ ...copy, timeZone: "Bad/Zone" });
  assert.equal(invalid.occurredAt, undefined);
});

test("pending 토스트 번역은 stableId·라우트·긴급도·실제 표시 ACK를 보존한다", () => {
  const notificationCopy = JSON.stringify(makeNotificationCopy("arrived", { child: "Min", place: "Park" }));
  const input = pendingPresentation({ id: "row", title: "원제목", body: "원문", data: { pushId: "same-id", notificationCopy, route: "/notifications?child=c", urgent: true } });
  assert.equal(input.stableId, "same-id");
  assert.equal(input.route, "/notifications?child=c");
  let text = "";
  assert.deepEqual(presentWebPendingNotification(input, (message, emoji) => { text = message; assert.equal(emoji, "🚨"); return true; }, "en"), { displayed: true, acknowledged: true });
  assert.equal(text, "Location update — Min arrived at Park.");
  assert.deepEqual(presentWebPendingNotification(input, () => false, "en"), { displayed: false, acknowledged: false });
});

test("생성된 Android와 웹 카탈로그 및 종류 정의는 한 정본과 동일하다", () => {
  const android = JSON.parse(readFileSync(new URL("../android/app/src/main/assets/notification-messages.json", import.meta.url), "utf8"));
  assert.deepEqual(android, { definitions, locales: catalog.locales });
});
