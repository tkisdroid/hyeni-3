import test from "node:test";
import assert from "node:assert/strict";

import {
  dateTimeScopeInTimeZone,
  millisecondsUntilNextDayInTimeZone,
  parseAppDateKey,
  recentDateKeysFor,
} from "../src/transform/dateKey.ts";
import * as dateKey from "../src/transform/dateKey.ts";
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

test("KST date_key 하루 조회 범위는 KST 자정부터 다음 자정까지다", () => {
  const dateKeyDayRangeIso = Reflect.get(dateKey, "dateKeyDayRangeIso") as
    | undefined
    | ((key: string, timeZone: string) => { start: string; end: string } | null);
  assert.equal(typeof dateKeyDayRangeIso, "function");
  if (!dateKeyDayRangeIso) return;

  assert.deepEqual(dateKeyDayRangeIso("2026-6-9", "Asia/Seoul"), {
    start: "2026-07-08T15:00:00.000Z",
    end: "2026-07-09T15:00:00.000Z",
  });
  assert.equal(dateKeyDayRangeIso("invalid", "Asia/Seoul"), null);
});

test("date_key 일정 창은 자정 넘김과 겹침을 명시 time zone에서 계산한다", () => {
  const dateKeyEventWindowMs = Reflect.get(dateKey, "dateKeyEventWindowMs") as
    | undefined
    | ((key: string, start: string | null, end: string | null, timeZone: string) => {
        startMs: number;
        endMs: number;
      } | null);
  const intervalOverlapMs = Reflect.get(dateKey, "intervalOverlapMs") as
    | undefined
    | ((left: { startMs: number; endMs: number }, right: { startMs: number; endMs: number }) => number);
  assert.equal(typeof dateKeyEventWindowMs, "function");
  assert.equal(typeof intervalOverlapMs, "function");
  if (!dateKeyEventWindowMs || !intervalOverlapMs) return;

  const window = dateKeyEventWindowMs("2026-6-9", "23:30", "00:30", "Asia/Seoul");
  assert.deepEqual(window, {
    startMs: Date.parse("2026-07-09T14:30:00.000Z"),
    endMs: Date.parse("2026-07-09T15:30:00.000Z"),
  });
  assert.equal(intervalOverlapMs(
    window!,
    {
      startMs: Date.parse("2026-07-09T15:10:00.000Z"),
      endMs: Date.parse("2026-07-09T15:40:00.000Z"),
    },
  ), 20 * 60_000);
});

test("KST 자정 직전 조회 범위의 마지막 키를 전송에도 그대로 사용하고 빈 범위는 닫는다", () => {
  const latestDateKeyOrNull = Reflect.get(dateKey, "latestDateKeyOrNull") as
    | undefined
    | ((keys: readonly string[]) => string | null);
  assert.equal(typeof latestDateKeyOrNull, "function");
  if (!latestDateKeyOrNull) return;

  const scope = dateTimeScopeInTimeZone(
    new Date("2026-07-08T14:59:59.999Z"),
    "Asia/Seoul",
  );
  const queryKeys = recentDateKeysFor(scope.dateKey, 7);
  assert.equal(scope.dateKey, "2026-6-8");
  assert.equal(latestDateKeyOrNull(queryKeys), scope.dateKey);
  assert.equal(latestDateKeyOrNull([]), null);
  assert.equal(latestDateKeyOrNull(["", "invalid"]), null);
});
