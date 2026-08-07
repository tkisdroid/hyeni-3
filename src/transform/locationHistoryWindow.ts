import { addDaysToDateKey, dateToDateKey, parseAppDateKey } from "./dateKey.ts";

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

export function getHistoryDayWindow(now: Date, startHour = HISTORY_DAY_START_HOUR): HistoryDayWindow {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, 0, 0, 0);
  if (now.getHours() < startHour) {
    start.setDate(start.getDate() - 1);
  }
  return buildHistoryDayWindow(start, now);
}

function buildHistoryDayWindow(start: Date, now: Date): HistoryDayWindow {
  const queryEnd = new Date(start.getTime() + 24 * 60 * 60 * 1000);
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

/** 선택한 앱 date_key의 오전 8시부터 다음 날 오전 8시까지의 조회 창. */
export function getHistoryDayWindowForKey(
  dateKey: string,
  now: Date,
  startHour = HISTORY_DAY_START_HOUR,
): HistoryDayWindow | null {
  const date = parseAppDateKey(dateKey);
  if (!date || Number.isNaN(now.getTime())) return null;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour, 0, 0, 0);
  if (start.getTime() > now.getTime()) return null;
  return buildHistoryDayWindow(start, now);
}

export function clampHistoryOffsetMinute(value: number, maxOffsetMinutes: number): number {
  if (!Number.isFinite(value)) return maxOffsetMinutes;
  return Math.min(maxOffsetMinutes, Math.max(0, Math.round(value)));
}

export function getHistoryDayKey(now: Date, startHour = HISTORY_DAY_START_HOUR): string {
  return dateToDateKey(getHistoryDayWindow(now, startHour).start);
}

export interface HistoryDayKeyRange {
  minDateKey: string;
  maxDateKey: string;
}

/** 현재 오전 8시 기준 날짜를 포함한 최근 N개의 선택 가능 날짜. */
export function getHistoryDayKeyRange(now: Date, dayCount: number): HistoryDayKeyRange {
  const maxDateKey = getHistoryDayKey(now);
  const normalizedDayCount = Number.isFinite(dayCount) ? Math.max(1, Math.floor(dayCount)) : 1;
  return {
    minDateKey: addDaysToDateKey(maxDateKey, -(normalizedDayCount - 1)),
    maxDateKey,
  };
}

/** 무효·미래·보관 범위 밖 날짜를 서버 조회 전에 허용 범위로 고정한다. */
export function clampHistoryDayKey(requestedDateKey: string, now: Date, dayCount: number): string {
  const range = getHistoryDayKeyRange(now, dayCount);
  const requested = parseAppDateKey(requestedDateKey);
  const min = parseAppDateKey(range.minDateKey);
  const max = parseAppDateKey(range.maxDateKey);
  if (!requested || !min || !max) return range.maxDateKey;
  const requestedMs = requested.getTime();
  if (requestedMs < min.getTime()) return range.minDateKey;
  if (requestedMs > max.getTime()) return range.maxDateKey;
  return dateToDateKey(requested);
}
