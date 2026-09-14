import test from "node:test";
import assert from "node:assert/strict";

import {
  buildScheduledArrivalAlert,
  findNearbyScheduleAtPlace,
  findScheduleArrivalOverlap,
  hasScheduleArrivalOverlap,
  scheduleWindowDateKeys,
} from "../lib/scheduleArrivalOverlap.ts";

test("일정 도착 확정은 시작 15분 전부터 60분 뒤까지만 허용한다", () => {
  const atMs = Date.parse("2026-07-13T01:00:00.000Z");
  const place = { lat: 37.33, lng: 127.116 };
  const event = { eventId: "e1", startAtMs: atMs + 14 * 60_000, lat: 37.3306, lng: 127.116 };
  assert.equal(hasScheduleArrivalOverlap(place, atMs, [event]), true);
  assert.equal(hasScheduleArrivalOverlap(place, atMs, [{ ...event, startAtMs: atMs + 16 * 60_000 }]), false);
  assert.equal(hasScheduleArrivalOverlap(place, atMs, [{ ...event, startAtMs: atMs - 60 * 60_000 }]), true);
  assert.equal(hasScheduleArrivalOverlap(place, atMs, [{ ...event, startAtMs: atMs - 61 * 60_000 }]), false);
  assert.equal(hasScheduleArrivalOverlap(place, atMs, [{ ...event, lat: 37.34 }]), false);
});

test("등록장소와 겹친 일정은 일반 장소 알림을 버리지 않고 즉시 일정 도착 알림으로 승격한다", () => {
  const atMs = Date.parse("2026-07-13T01:00:00.000Z");
  const candidate = {
    eventId: "e1",
    occurrenceId: "e1:2026-6-13:r1",
    title: "피아노",
    startAtMs: atMs + 10 * 60_000,
    lat: 37.33,
    lng: 127.116,
  };
  assert.equal(findScheduleArrivalOverlap({ lat: 37.33, lng: 127.116 }, atMs, [candidate]), candidate);
  assert.deepEqual(buildScheduledArrivalAlert("혜니", candidate), {
    alertType: "arrived",
    severity: "info",
    title: "✅ 피아노 도착",
    message: "혜니님이 피아노 장소에 도착했어요.",
    metadata: { notificationCopy: { v: 1, id: "scheduleArrived", args: { child: "혜니", event: "피아노" } } },
  });
});

test("같은 장소 일정이 여러 개면 DB 순서가 아니라 가장 가까운 시작 시각을 고른다", () => {
  const atMs = Date.parse("2026-07-13T01:00:00.000Z");
  const farther = { eventId: "z", startAtMs: atMs - 50 * 60_000, lat: 37.33, lng: 127.116 };
  const nearest = { eventId: "b", startAtMs: atMs + 5 * 60_000, lat: 37.33, lng: 127.116 };
  const tiedButStable = { eventId: "a", startAtMs: atMs - 5 * 60_000, lat: 37.33, lng: 127.116 };

  assert.equal(
    findScheduleArrivalOverlap({ lat: 37.33, lng: 127.116 }, atMs, [farther, nearest]),
    nearest,
  );
  assert.equal(
    findScheduleArrivalOverlap({ lat: 37.33, lng: 127.116 }, atMs, [nearest, tiedButStable]),
    tiedButStable,
  );
});

test("너무 이른 도착은 일정 도착으로 단정하지 않되 같은 occurrence 연계는 보존한다", () => {
  const atMs = Date.parse("2026-07-13T01:00:00.000Z");
  const early = { eventId: "e1", startAtMs: atMs + 57 * 60_000, lat: 37.33, lng: 127.116 };

  assert.equal(findScheduleArrivalOverlap({ lat: 37.33, lng: 127.116 }, atMs, [early]), null);
  assert.equal(findNearbyScheduleAtPlace({ lat: 37.33, lng: 127.116 }, atMs, [early]), early);
});

test("자정 부근에는 전날·오늘·다음날 date_key를 안전하게 포함한다", () => {
  const atMs = Date.parse("2026-07-12T15:30:00.000Z"); // KST 7/13 00:30
  assert.deepEqual(scheduleWindowDateKeys(atMs).sort(), ["2026-6-12", "2026-6-13"]);
});
