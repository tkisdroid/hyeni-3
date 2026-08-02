// 미도착 위치 신선도 이분 검증 — node --test worker/tests/notArrivedFreshness.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import {
  isEmergencyNotificationType,
  partitionNotArrivedByFreshness,
} from "../lib/notificationRouting.ts";

const EVENT_LOC = { lat: 37.3, lng: 127.1 };
const FAR = { lat: 37.4, lng: 127.2 }; // 이벤트에서 수 km 밖
const NOW = Date.parse("2026-07-10T11:00:00Z");

function loc(userId, point, updatedAt, accuracyM = 15) {
  return { user_id: userId, lat: point.lat, lng: point.lng, updated_at: updatedAt, accuracy_m: accuracyM };
}

test("신선한 위치가 목적지 밖이면 notArrived 로 단정한다", () => {
  const out = partitionNotArrivedByFreshness(
    ["u1"], [loc("u1", FAR, "2026-07-10 10:55:00.000+00")], EVENT_LOC, 50, NOW,
  );
  assert.deepEqual(out.notArrived, ["u1"]);
  assert.deepEqual(out.unknown, []);
});

test("오래된 위치는 unknown 으로 분류한다(동결 좌표 오탐 방지)", () => {
  const out = partitionNotArrivedByFreshness(
    ["u1"], [loc("u1", FAR, "2026-07-10 08:00:00.000+00")], EVENT_LOC, 50, NOW,
  );
  assert.deepEqual(out.notArrived, []);
  assert.deepEqual(out.unknown, ["u1"]);
});

test("20분 지난 좌표는 Android·등록장소 cron과 동일하게 unknown으로 분류한다", () => {
  const out = partitionNotArrivedByFreshness(
    ["u1"], [loc("u1", FAR, "2026-07-10 10:40:00.000+00")], EVENT_LOC, 50, NOW,
  );
  assert.deepEqual(out.notArrived, []);
  assert.deepEqual(out.unknown, ["u1"]);
});

test("오래된 좌표가 목적지 안에 남아 있어도 도착으로 확정하지 않는다", () => {
  const out = partitionNotArrivedByFreshness(
    ["u1"], [loc("u1", EVENT_LOC, "2026-07-10 08:00:00.000+00")], EVENT_LOC, 50, NOW,
  );
  assert.deepEqual(out.notArrived, []);
  assert.deepEqual(out.unknown, ["u1"]);
});

test("위치 기록이 아예 없으면 unknown 으로 분류한다", () => {
  const out = partitionNotArrivedByFreshness(["u1"], [], EVENT_LOC, 50, NOW);
  assert.deepEqual(out.notArrived, []);
  assert.deepEqual(out.unknown, ["u1"]);
});

test("신선한 위치가 목적지 안이면 어느 쪽에도 없다(도착)", () => {
  const out = partitionNotArrivedByFreshness(
    ["u1"], [loc("u1", EVENT_LOC, "2026-07-10 10:59:00.000+00")], EVENT_LOC, 50, NOW,
  );
  assert.deepEqual(out.notArrived, []);
  assert.deepEqual(out.unknown, []);
});

test("혼합: 신선-밖 아이와 stale 아이가 각각 분류된다", () => {
  const out = partitionNotArrivedByFreshness(
    ["u1", "u2"],
    [loc("u1", FAR, "2026-07-10 10:58:00.000+00"), loc("u2", FAR, "2026-07-09 08:00:00.000+00")],
    EVENT_LOC, 50, NOW,
  );
  assert.deepEqual(out.notArrived, ["u1"]);
  assert.deepEqual(out.unknown, ["u2"]);
});

test("신선해도 정확도 150m 초과 좌표는 미도착을 단정하지 않는다", () => {
  const out = partitionNotArrivedByFreshness(
    ["u1"], [loc("u1", FAR, "2026-07-10 10:59:00.000+00", 151)], EVENT_LOC, 50, NOW,
  );
  assert.deepEqual(out.notArrived, []);
  assert.deepEqual(out.unknown, ["u1"]);
});

test("신선해도 정확도 누락 좌표는 미도착을 단정하지 않는다", () => {
  const out = partitionNotArrivedByFreshness(
    ["u1"], [loc("u1", FAR, "2026-07-10 10:59:00.000+00", null)], EVENT_LOC, 50, NOW,
  );
  assert.deepEqual(out.notArrived, []);
  assert.deepEqual(out.unknown, ["u1"]);
});

test("오차 반경이 목적지 반경과 겹치면 미도착을 단정하지 않는다", () => {
  const nearOutside = { lat: 37.30072, lng: 127.1 }; // 약 80m: 정확도 40m이면 50m 반경과 겹침
  const out = partitionNotArrivedByFreshness(
    ["u1"], [loc("u1", nearOutside, "2026-07-10 10:59:00.000+00", 40)], EVENT_LOC, 50, NOW,
  );
  assert.deepEqual(out.notArrived, []);
  assert.deepEqual(out.unknown, ["u1"]);
});

test("warning 미도착의 명시적 urgent=false는 긴급 전체화면으로 승격하지 않는다", () => {
  assert.equal(isEmergencyNotificationType("parent_alert", {
    urgent: "false",
    severity: "warning",
    alertType: "not_arrived",
  }), false);
  assert.equal(isEmergencyNotificationType("parent_alert", {
    urgent: "true",
    severity: "emergency",
    alertType: "not_arrived",
  }), true);
});
