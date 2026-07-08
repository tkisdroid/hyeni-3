import { dateToDateKey } from "./dateKey.ts";

export const HISTORY_DAY_START_HOUR = 8;

export interface HistoryDayWindow {
  start: Date;
  end: Date;
  startMs: number;
  endMs: number;
  maxOffsetMinutes: number;
}

export function getHistoryDayWindow(now: Date, startHour = HISTORY_DAY_START_HOUR): HistoryDayWindow {
  const end = new Date(now.getTime());
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, 0, 0, 0);
  if (now.getHours() < startHour) {
    start.setDate(start.getDate() - 1);
  }
  const startMs = start.getTime();
  const endMs = end.getTime();
  return {
    start,
    end,
    startMs,
    endMs,
    maxOffsetMinutes: Math.max(0, Math.floor((endMs - startMs) / 60_000)),
  };
}

export function clampHistoryOffsetMinute(value: number, maxOffsetMinutes: number): number {
  if (!Number.isFinite(value)) return maxOffsetMinutes;
  return Math.min(maxOffsetMinutes, Math.max(0, Math.round(value)));
}

export function getHistoryDayKey(now: Date, startHour = HISTORY_DAY_START_HOUR): string {
  return dateToDateKey(getHistoryDayWindow(now, startHour).start);
}
