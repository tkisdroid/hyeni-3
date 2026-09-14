import { wallTimeToEpoch } from "../../shared/timeZone.ts";
import {
  addDaysToDateKey,
  dateToDateKey,
  dateToDateKeyInTimeZone,
  parseAppDateKey,
} from "./dateKey.ts";

export const HISTORY_DAY_START_HOUR = 8;

export interface HistoryDayWindow {
  start: Date;
  end: Date;
  queryEnd: Date;
  startMs: number;
  endMs: number;
  queryEndMs: number;
  maxOffsetMinutes: number;
}

/** DST 날짜도 실제 civil-time 경계로 변환한다. */
function zonedDateKeyHour(dateKey: string, hour: number, timeZone: string): Date | null {
  try { return new Date(wallTimeToEpoch(dateKey, hour * 60, timeZone)); }
  catch { return null; }
}

function buildHistoryDayWindow(start: Date, queryEnd: Date, now: Date): HistoryDayWindow {
  const end = new Date(Math.min(now.getTime(), queryEnd.getTime()));
  const startMs = start.getTime();
  const endMs = end.getTime();
  return {
    start,
    end,
    queryEnd,
    startMs,
    endMs,
    queryEndMs: queryEnd.getTime(),
    maxOffsetMinutes: Math.max(0, Math.floor((endMs - startMs) / 60_000)),
  };
}

export function getHistoryDayWindow(
  now: Date,
  timeZone: string,
  startHour = HISTORY_DAY_START_HOUR,
): HistoryDayWindow {
  const zonedTodayKey = dateToDateKeyInTimeZone(now, timeZone);
  const todayStart = zonedDateKeyHour(zonedTodayKey, startHour, timeZone);
  const dateKey = todayStart && now.getTime() >= todayStart.getTime()
    ? zonedTodayKey
    : addDaysToDateKey(zonedTodayKey, -1);
  const start = zonedDateKeyHour(dateKey, startHour, timeZone) as Date;
  const queryEnd = zonedDateKeyHour(addDaysToDateKey(dateKey, 1), startHour, timeZone) as Date;
  return buildHistoryDayWindow(start, queryEnd, now);
}

/** 선택한 앱 date_key의 오전 8시부터 다음 날 오전 8시까지의 조회 창. */
export function getHistoryDayWindowForKey(
  dateKey: string,
  now: Date,
  timeZone: string,
  startHour = HISTORY_DAY_START_HOUR,
): HistoryDayWindow | null {
  if (!parseAppDateKey(dateKey) || Number.isNaN(now.getTime())) return null;
  const start = zonedDateKeyHour(dateKey, startHour, timeZone);
  const queryEnd = zonedDateKeyHour(addDaysToDateKey(dateKey, 1), startHour, timeZone);
  if (!start || !queryEnd) return null;
  if (start.getTime() > now.getTime()) return null;
  return buildHistoryDayWindow(start, queryEnd, now);
}

export function clampHistoryOffsetMinute(value: number, maxOffsetMinutes: number): number {
  if (!Number.isFinite(value)) return maxOffsetMinutes;
  return Math.min(maxOffsetMinutes, Math.max(0, Math.round(value)));
}

export function getHistoryDayKey(
  now: Date,
  timeZone: string,
  startHour = HISTORY_DAY_START_HOUR,
): string {
  return dateToDateKeyInTimeZone(getHistoryDayWindow(now, timeZone, startHour).start, timeZone);
}

export interface HistoryDayKeyRange {
  minDateKey: string;
  maxDateKey: string;
}

/** 현재 오전 8시 기준 날짜를 포함한 최근 N개의 선택 가능 날짜. */
export function getHistoryDayKeyRange(
  now: Date,
  dayCount: number,
  timeZone: string,
): HistoryDayKeyRange {
  const maxDateKey = getHistoryDayKey(now, timeZone);
  const normalizedDayCount = Number.isFinite(dayCount) ? Math.max(1, Math.floor(dayCount)) : 1;
  return {
    minDateKey: addDaysToDateKey(maxDateKey, -(normalizedDayCount - 1)),
    maxDateKey,
  };
}

/** 무효·미래·보관 범위 밖 날짜를 서버 조회 전에 허용 범위로 고정한다. */
export function clampHistoryDayKey(
  requestedDateKey: string,
  now: Date,
  dayCount: number,
  timeZone: string,
): string {
  const range = getHistoryDayKeyRange(now, dayCount, timeZone);
  const requested = parseAppDateKey(requestedDateKey);
  const min = parseAppDateKey(range.minDateKey);
  const max = parseAppDateKey(range.maxDateKey);
  if (!requested || !min || !max) return range.maxDateKey;
  const requestedMs = requested.getTime();
  if (requestedMs < min.getTime()) return range.minDateKey;
  if (requestedMs > max.getTime()) return range.maxDateKey;
  return dateToDateKey(requested);
}
