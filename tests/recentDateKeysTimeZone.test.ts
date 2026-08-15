import test from "node:test";
import assert from "node:assert/strict";

import {
  dateTimeScopeInTimeZone,
  millisecondsUntilNextDayInTimeZone,
  parseAppDateKey,
  recentDateKeysFor,
} from "../src/transform/dateKey.ts";
import { formatCalendarDay } from "../src/i18n/format.ts";

test("Bangkok 22:30 instant는 KST 익일 date_key와 00:30 현재 분을 함께 만든다", () => {
  const scope = dateTimeScopeInTimeZone(
    new Date("2026-07-08T15:30:00.000Z"),
    "Asia/Seoul",
  );

  assert.deepEqual(scope, {
    dateKey: "2026-6-9",
    minutesSinceMidnight: 30,
  });
  assert.match(formatCalendarDay("2026-07-08T15:30:00.000Z", {
    locale: "en",
    timeZone: "Asia/Seoul",
    weekday: "long",
  }), /Thursday, July 9/);
  const calendarDate = parseAppDateKey(scope.dateKey);
  assert.deepEqual(calendarDate && {
    year: calendarDate.getFullYear(),
    month: calendarDate.getMonth() + 1,
    day: calendarDate.getDate(),
  }, { year: 2026, month: 7, day: 9 });
  assert.deepEqual(recentDateKeysFor(scope.dateKey, 3), [
    "2026-6-7",
    "2026-6-8",
    "2026-6-9",
  ]);
});

test("명시 time zone의 다음 자정 timer는 host와 DST 길이에 의존하지 않는다", () => {
  assert.equal(
    millisecondsUntilNextDayInTimeZone(new Date("2026-07-08T15:30:00.000Z"), "Asia/Seoul"),
    23.5 * 60 * 60 * 1_000,
  );
  assert.equal(
    millisecondsUntilNextDayInTimeZone(new Date("2026-03-08T05:30:00.000Z"), "America/New_York"),
    22.5 * 60 * 60 * 1_000,
  );
});
