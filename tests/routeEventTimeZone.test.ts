import test from "node:test";
import assert from "node:assert/strict";

import type { CalendarEvent } from "../src/lib/api/endpoints/schedule.ts";
import * as routeScope from "../src/transform/routeDestinationScope.ts";

function event(id: string, dateKey: string, time: string): CalendarEvent {
  return {
    id,
    family_id: "family-1",
    date_key: dateKey,
    title: id,
    time,
    end_time: null,
    category: "other",
    emoji: null,
    location: { address: `${id} 주소` },
  };
}

test("홈에서 고른 일정은 장소가 없어도 뒤 일정으로 바꾸지 않는다", () => {
  const pickRouteEvent = Reflect.get(routeScope, "pickRouteEvent") as
    | undefined
    | ((events: CalendarEvent[], requestedEventId: string | null, nowMs: number, timeZone: string) => CalendarEvent | null);
  assert.equal(typeof pickRouteEvent, "function");
  if (!pickRouteEvent) return;

  const selectedWithoutPlace = {
    ...event("selected", "2026-6-8", "15:00"),
    location: null,
  };
  const laterWithPlace = event("later", "2026-6-8", "16:00");
  const rows = [laterWithPlace, selectedWithoutPlace];
  const nowMs = Date.parse("2026-07-08T05:00:00.000Z");

  assert.equal(pickRouteEvent(rows, "selected", nowMs, "Asia/Seoul")?.id, "selected");
  assert.equal(
    pickRouteEvent(rows, "missing", nowMs, "Asia/Seoul"),
    null,
    "명시한 일정이 없으면 다른 목적지로 추측하면 안 된다",
  );
  assert.equal(
    pickRouteEvent(rows, null, nowMs, "Asia/Seoul")?.id,
    "later",
    "명시 일정이 없는 일반 길찾기는 장소가 있는 다음 일정을 유지한다",
  );
});

test("다음 일정은 date_key 벽시각을 명시한 가족 시간대로 정렬한다", () => {
  const pickNextEventWithPlace = Reflect.get(routeScope, "pickNextEventWithPlace") as
    | undefined
    | ((events: CalendarEvent[], nowMs: number, timeZone: string) => CalendarEvent | null);
  assert.equal(typeof pickNextEventWithPlace, "function");
  if (!pickNextEventWithPlace) return;

  const beforeMidnight = event("before-midnight", "2026-6-8", "23:30");
  const afterMidnight = event("after-midnight", "2026-6-9", "00:15");

  assert.equal(
    pickNextEventWithPlace(
      [afterMidnight, beforeMidnight],
      Date.parse("2026-07-08T14:00:00.000Z"),
      "Asia/Seoul",
    )?.id,
    "before-midnight",
  );
  assert.equal(
    pickNextEventWithPlace(
      [afterMidnight, beforeMidnight],
      Date.parse("2026-07-08T18:00:00.000Z"),
      "Asia/Seoul",
    ),
    null,
  );
});
