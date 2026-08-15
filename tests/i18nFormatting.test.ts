import test from "node:test";
import assert from "node:assert/strict";

import {
  formatCalendarDay,
  formatCalendarMonth,
  formatClockWithSeconds,
  formatDateTime,
  formatNumber,
  formatPastTime,
  formatProviderPrice,
  formatRelativeMinutes,
  formatRelativeTime,
  formatWeekday,
} from "../src/i18n/format.ts";
import {
  formatMemoClock,
  memoDayStamp,
} from "../src/transform/memoView.ts";
import { relativeTime } from "../src/transform/notificationsView.ts";

const INSTANT = "2026-01-01T00:00:00.000Z";

test("지원 locale은 지역별 숫자 구분 기호를 사용한다", () => {
  assert.equal(formatNumber(12_345, "en"), "12,345");
  assert.equal(formatNumber(12_345, "id"), "12.345");
});

test("날짜·시각은 명시한 locale과 time zone에서 Gregorian 연도를 표시한다", () => {
  const tokyo = formatDateTime(INSTANT, {
    locale: "ja",
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const bangkok = formatDateTime(INSTANT, {
    locale: "th",
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  });

  assert.match(tokyo, /2026/);
  assert.match(tokyo, /9:00/);
  assert.match(bangkok, /2026/);
  assert.doesNotMatch(bangkok, /2569/);
});

test("상대시간은 선택한 locale 문법으로 표시한다", () => {
  assert.equal(formatRelativeTime(-3, "minute", "en"), "3 minutes ago");
  assert.equal(formatRelativeTime(-3, "minute", "id"), "3 menit yang lalu");
});

test("분 단위 상대시간은 방향과 locale을 지키고 정확한 60분을 시간으로 정규화한다", () => {
  assert.equal(formatRelativeMinutes(45, "future", "en"), "in 45 minutes");
  assert.equal(formatRelativeMinutes(45, "future", "ko"), "45분 후");
  assert.equal(formatRelativeMinutes(60, "past", "en"), "1 hour ago");
  assert.equal(formatRelativeMinutes(60, "past", "ko"), "1시간 전");
});

test("공급자 가격 문자열은 locale과 무관하게 원문 그대로 보존한다", () => {
  assert.equal(formatProviderPrice("$4.99", "en"), "$4.99");
  assert.equal(formatProviderPrice("  Rp 79.000  ", "id"), "  Rp 79.000  ");
});

test("잘못된 날짜 값은 화면을 깨뜨리지 않고 안전 fallback을 반환한다", () => {
  assert.equal(formatDateTime("not-a-date", {
    locale: "en",
    timeZone: "UTC",
    dateStyle: "medium",
  }), "—");
});

test("잘못된 timeZone 구성 오류는 숨기지 않는다", () => {
  assert.throws(
    () => formatDateTime(INSTANT, {
      locale: "en",
      timeZone: "Invalid/Zone",
      dateStyle: "medium",
    }),
    RangeError,
  );
});

test("날짜 값도 잘못됐더라도 모든 날짜 formatter가 timeZone 구성 오류를 먼저 드러낸다", () => {
  const calls = [
    () => formatDateTime("not-a-date", {
      locale: "en" as const,
      timeZone: "Invalid/Zone",
      dateStyle: "medium" as const,
    }),
    () => formatCalendarDay("not-a-date", {
      locale: "en" as const,
      timeZone: "Invalid/Zone",
      weekday: "long" as const,
    }),
    () => formatCalendarMonth("not-a-date", {
      locale: "en" as const,
      timeZone: "Invalid/Zone",
    }),
    () => formatWeekday("not-a-date", {
      locale: "en" as const,
      timeZone: "Invalid/Zone",
      width: "short" as const,
    }),
    () => formatClockWithSeconds("not-a-date", {
      locale: "en" as const,
      timeZone: "Invalid/Zone",
    }),
  ];

  for (const call of calls) assert.throws(call, RangeError);
});

test("달력 날짜 조립은 선택한 locale의 월·요일 순서를 사용한다", () => {
  const instant = "2026-07-08T03:00:00.000Z";

  const en = formatCalendarDay(instant, { locale: "en", timeZone: "Asia/Seoul", weekday: "long" });
  const ja = formatCalendarDay(instant, { locale: "ja", timeZone: "Asia/Seoul", weekday: "long" });
  assert.match(en, /Wednesday/);
  assert.match(en, /July 8/);
  assert.doesNotMatch(en, /월|요일/);
  assert.match(ja, /7月8日/);
  assert.match(ja, /水曜日/);
});

test("달력의 월·요일 단독 조각도 선택한 locale로 표시한다", () => {
  const instant = "2026-07-08T03:00:00.000Z";

  assert.equal(formatCalendarMonth(instant, {
    locale: "en",
    timeZone: "Asia/Seoul",
  }), "July");
  assert.equal(formatWeekday(instant, {
    locale: "en",
    timeZone: "Asia/Seoul",
    width: "short",
  }), "Wed");
  assert.doesNotMatch(formatWeekday(instant, {
    locale: "ja",
    timeZone: "Asia/Seoul",
    width: "short",
  }), /수요일/);
});

test("지난 시각은 선택한 locale의 상대시간 문법으로 표시한다", () => {
  const now = new Date("2026-07-08T03:05:00.000Z");

  assert.equal(formatPastTime("2026-07-08T03:00:00.000Z", now, "en"), "5 minutes ago");
  assert.doesNotMatch(formatPastTime("2026-07-08T03:00:00.000Z", now, "ja"), /분 전/);
});

test("1분 미만과 미래 timestamp는 방향 없는 현재 표현으로 표시한다", () => {
  const now = new Date("2026-07-08T03:05:00.000Z");
  const enPast = formatPastTime("2026-07-08T03:04:59.000Z", now, "en");
  const enFuture = formatPastTime("2026-07-08T03:06:00.000Z", now, "en");
  const koFuture = formatPastTime("2026-07-08T03:06:00.000Z", now, "ko");

  assert.equal(enPast, "now");
  assert.equal(enFuture, "now");
  assert.equal(koFuture, "지금");
  assert.doesNotMatch(enFuture, /\bin\b|ago/);
  assert.doesNotMatch(koFuture, /후|전/);
});

test("초 정밀도 시각 formatter는 locale과 time zone을 지키며 초를 남긴다", () => {
  assert.match(formatClockWithSeconds("2026-07-08T03:04:07.000Z", {
    locale: "en",
    timeZone: "Asia/Seoul",
  }), /12:04:07 PM/);
});

test("메모 시각과 날짜 그룹은 호스트가 아니라 전달한 time zone을 따른다", () => {
  const value = "2026-01-01T01:00:00.000Z";
  assert.equal(memoDayStamp(value, "Asia/Tokyo"), "2026-01-01");
  assert.equal(memoDayStamp(value, "America/Los_Angeles"), "2025-12-31");
  assert.match(formatMemoClock(value, "en", "America/Los_Angeles"), /5:00 PM/);
});

test("알림의 오래된 시각도 전달한 locale과 time zone으로 표시한다", () => {
  const now = new Date("2026-01-01T03:00:00.000Z");
  assert.match(relativeTime("2026-01-01T01:00:00.000Z", now, "en", "America/Los_Angeles"), /5:00 PM/);
});
