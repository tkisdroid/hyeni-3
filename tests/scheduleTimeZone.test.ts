import test from "node:test";
import assert from "node:assert/strict";

import type { CalendarEvent } from "../src/lib/api/endpoints/schedule.ts";
import { eventToView } from "../src/transform/scheduleView.ts";

test("일정 진행 상태는 host가 아니라 명시 time zone의 date_key wall-clock을 따른다", () => {
  const event = {
    id: "event-1",
    title: "자정 일정",
    category: "other",
    emoji: "",
    date_key: "2026-6-9",
    time: "00:00",
    end_time: "01:00",
    location: null,
  } as CalendarEvent;

  const view = eventToView(
    event,
    new Date("2026-07-08T10:30:00.000Z"),
    "en",
    "Pacific/Kiritimati",
  );

  assert.equal(view.tag, "진행 중");
});
