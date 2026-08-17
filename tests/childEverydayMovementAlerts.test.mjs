/**
 * 아이에게는 일상 이동 알림을 보내지 않는다(2026-08-03 보호자 결정).
 *
 * 도착·출발 알림이 하루에도 여러 번 울리자 아이가 오히려 휴대폰을 더 자주 보게 됐다.
 * 위험 구역과 긴급 상황만 아이에게 남기고, 일상 움직임은 부모에게만 보낸다.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [childSafetySource, settingsScreen, koNotificationsSource] = await Promise.all([
  read("worker/lib/childSafetyNotification.ts"),
  read("src/screens/feature/NotificationSettings.tsx"),
  read("locales/ko/notifications.json"),
]);
const koNotifications = JSON.parse(koNotificationsSource);

test("아이 알림 문구 목록에 도착·출발 유형이 없다", () => {
  for (const alertType of [
    "arrived",
    "late_arrived",
    "place_arrived",
    "place_left",
    "unregistered_stay_left",
  ]) {
    assert.doesNotMatch(
      childSafetySource,
      new RegExp(`"${alertType}"`),
      `${alertType}는 아이 알림 대상에서 빠져야 합니다`,
    );
  }
  assert.doesNotMatch(childSafetySource, /도착했어|출발했어|머물던 곳에서/);
});

test("위험 구역은 아이에게 그대로 알린다", () => {
  assert.match(childSafetySource, /"danger_zone"/);
  assert.match(childSafetySource, /"danger_enter"/);
  assert.match(childSafetySource, /"danger_entry"/);
  assert.match(childSafetySource, /위험 구역이야/);
  assert.match(childSafetySource, /urgent: true/);
});

test("아이 설정 화면은 아이에게 오지 않는 위치 토글을 보여주지 않는다", () => {
  const safetyGroup = settingsScreen.slice(
    settingsScreen.indexOf('notifications.settings.group.locationSafety'),
    settingsScreen.indexOf('{role === "parent" && ('),
  );
  assert.ok(safetyGroup.length > 0, "위치·안전 그룹을 찾지 못했습니다");
  assert.match(safetyGroup, /role === "child" \?/);
  // 토글 목록은 아이가 아닌 분기에서만 렌더한다.
  const childBranch = safetyGroup.slice(
    safetyGroup.indexOf('role === "child" ?'),
    safetyGroup.indexOf(") : ("),
  );
  assert.doesNotMatch(childBranch, /SAFETY_TOGGLES/);
  assert.match(childBranch, /notifications\.settings\.childSafety\.parentOnly/);
  assert.equal(
    koNotifications["notifications.settings.childSafety.parentOnly"],
    "도착·출발 같은 일상 소식은 부모님께만 가고 너한테는 안 와.",
  );
});
