import { wallTimeToEpoch } from "../../shared/timeZone.ts";

/**
 * 일정 date_key 처리(hyeni-1 scheduleDateRange.js 정확 이관).
 *
 * ⚠️ 함정: date_key = `${year}-${monthIndex}-${day}` 에서 **monthIndex 는 0-indexed**,
 * 비패딩이다. 즉 "2026-7-5" = getMonth()===7 = **8월** 5일(7월 아님).
 * 직접 문자열 조립 금지 — 반드시 이 모듈 경유.
 */

/** "YYYY-monthIndex0-D"(0-indexed 월) → Date. 무효 시 null. */
export function parseAppDateKey(dateKey: string): Date | null {
  if (typeof dateKey !== "string") return null;
  const parts = dateKey.split("-").map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
  const [year, monthIndex, day] = parts;
  const date = new Date(year, monthIndex, day);
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Date → "YYYY-monthIndex0-D"(0-indexed 월, 비패딩). */
export function dateToDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** (year, month1based, day) → date_key. 컴포넌트의 1-indexed 월을 0-indexed 로 변환. */
export function ymdToDateKey(year: number, month1based: number, day: number): string {
  return `${year}-${month1based - 1}-${day}`;
}

/** date_key → <input type=date> 값 "YYYY-MM-DD"(1-indexed 패딩). */
export function dateKeyToDateInputValue(dateKey: string): string {
  const date = parseAppDateKey(dateKey);
  if (!date) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** <input type=date> 값 "YYYY-MM-DD" → date_key(0-indexed 월). 무효 시 null. */
export function dateInputValueToDateKey(value: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return dateToDateKey(date);
}

/** date_key 에 days 를 더한 새 date_key. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const date = parseAppDateKey(dateKey);
  const offset = Number(days);
  if (!date || !Number.isFinite(offset)) return dateKey;
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
  return dateToDateKey(next);
}

/** 월 이동은 같은 일을 유지하되, 대상 월에 없는 날짜는 그 달의 말일로 맞춘다. */
export function addMonthsToDateKey(dateKey: string, months: number): string {
  const date = parseAppDateKey(dateKey);
  if (!date || !Number.isInteger(months)) return dateKey;
  const first = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return ymdToDateKey(first.getFullYear(), first.getMonth() + 1, Math.min(date.getDate(), lastDay));
}

/** 오늘의 date_key. */
export function todayDateKey(now: Date = new Date()): string {
  return dateToDateKey(now);
}

interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedDateTimeParts(date: Date, timeZone: string): ZonedDateTimeParts | null {
  const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  if (Number.isNaN(date.getTime())) return null;
  const parts = formatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => (
    Number(parts.find((part) => part.type === type)?.value)
  );
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

export interface DateTimeScopeInTimeZone {
  dateKey: string;
  minutesSinceMidnight: number;
}

/** 한 instant의 조회 date_key와 현재 분을 같은 명시 time zone에서 계산한다. */
export function dateTimeScopeInTimeZone(date: Date, timeZone: string): DateTimeScopeInTimeZone {
  const parts = zonedDateTimeParts(date, timeZone);
  if (!parts) return { dateKey: "", minutesSinceMidnight: 0 };
  return {
    dateKey: ymdToDateKey(parts.year, parts.month, parts.day),
    minutesSinceMidnight: parts.hour * 60 + parts.minute,
  };
}

/** instant → 명시한 time zone의 앱 date_key. host time zone을 사용하지 않는다. */
export function dateToDateKeyInTimeZone(date: Date, timeZone: string): string {
  return dateTimeScopeInTimeZone(date, timeZone).dateKey;
}

export function recentDateKeysFor(anchorDateKey: string, days: number): string[] {
  const count = Math.max(1, Math.floor(days));
  return Array.from({ length: count }, (_, index) => (
    addDaysToDateKey(anchorDateKey, index - (count - 1))
  ));
}

/** 조회에 실제 사용한 날짜 범위의 최신 키. 유효한 키가 없으면 전송을 닫는다. */
export function latestDateKeyOrNull(dateKeys: readonly string[]): string | null {
  for (let index = dateKeys.length - 1; index >= 0; index -= 1) {
    const key = dateKeys[index];
    if (parseAppDateKey(key)) return key;
  }
  return null;
}

function dateKeyWallClockInTimeZone(
  dateKey: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null {
  try { return new Date(wallTimeToEpoch(dateKey, hour * 60 + minute, timeZone)); }
  catch { return null; }
}

/** 앱 date_key의 wall-clock 분을 명시 time zone의 instant로 바꾼다. 1440 이상은 다음 날이다. */
export function dateKeyMinuteInTimeZone(
  dateKey: string,
  minute: number,
  timeZone: string,
): Date | null {
  if (!Number.isFinite(minute)) return null;
  const normalizedMinute = Math.floor(minute);
  const dayOffset = Math.floor(normalizedMinute / (24 * 60));
  const minuteOfDay = ((normalizedMinute % (24 * 60)) + (24 * 60)) % (24 * 60);
  return dateKeyWallClockInTimeZone(
    addDaysToDateKey(dateKey, dayOffset),
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
    timeZone,
  );
}

/** date_key 하루의 명시 time zone 자정~익일 자정을 UTC ISO 조회 범위로 바꾼다. */
export function dateKeyDayRangeIso(
  dateKey: string,
  timeZone: string,
): { start: string; end: string } | null {
  if (!parseAppDateKey(dateKey)) return null;
  const start = dateKeyMinuteInTimeZone(dateKey, 0, timeZone);
  const end = dateKeyMinuteInTimeZone(addDaysToDateKey(dateKey, 1), 0, timeZone);
  if (!start || !end) return null;
  return { start: start.toISOString(), end: end.toISOString() };
}

function wallClockMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/** date_key와 시작/종료 벽시각을 명시 time zone의 일정 창으로 바꾼다. */
export function dateKeyEventWindowMs(
  dateKey: string,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  timeZone: string,
): { startMs: number; endMs: number } | null {
  const startMinute = wallClockMinutes(startTime);
  if (startMinute == null) return null;
  const parsedEndMinute = wallClockMinutes(endTime);
  const endMinute = parsedEndMinute == null ? startMinute + 60 : parsedEndMinute;
  const normalizedEndMinute = endMinute <= startMinute ? endMinute + 24 * 60 : endMinute;
  const start = dateKeyMinuteInTimeZone(dateKey, startMinute, timeZone);
  const end = dateKeyMinuteInTimeZone(dateKey, normalizedEndMinute, timeZone);
  if (!start || !end) return null;
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/** 길찾기용 일정 시작 시각. 비어 있거나 잘못된 time은 해당 날짜 자정으로 닫는다. */
export function dateKeyEventStartMs(
  dateKey: string,
  startTime: string | null | undefined,
  timeZone: string,
): number | null {
  const minute = wallClockMinutes(startTime) ?? 0;
  return dateKeyMinuteInTimeZone(dateKey, minute, timeZone)?.getTime() ?? null;
}

/** 두 반열린 시간 구간의 겹침 길이. */
export function intervalOverlapMs(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

/** 명시 time zone에서 다음 달력 날짜가 시작될 때까지 남은 시간. */
export function millisecondsUntilNextDayInTimeZone(now: Date, timeZone: string): number {
  const dateKey = dateToDateKeyInTimeZone(now, timeZone);
  const nextStart = dateKeyMinuteInTimeZone(addDaysToDateKey(dateKey, 1), 0, timeZone);
  if (!nextStart || Number.isNaN(now.getTime())) return 1;
  return Math.max(1, nextStart.getTime() - now.getTime());
}

/** 두 instant 사이의 명시 time zone 달력 날짜 차이. DST 하루 길이와 무관하다. */
export function calendarDayDifferenceInTimeZone(
  earlier: Date,
  later: Date,
  timeZone: string,
): number {
  const earlierDate = parseAppDateKey(dateToDateKeyInTimeZone(earlier, timeZone));
  const laterDate = parseAppDateKey(dateToDateKeyInTimeZone(later, timeZone));
  if (!earlierDate || !laterDate) return 0;
  const earlierDay = Date.UTC(earlierDate.getFullYear(), earlierDate.getMonth(), earlierDate.getDate());
  const laterDay = Date.UTC(laterDate.getFullYear(), laterDate.getMonth(), laterDate.getDate());
  return Math.round((laterDay - earlierDay) / 86_400_000);
}
