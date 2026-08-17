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
