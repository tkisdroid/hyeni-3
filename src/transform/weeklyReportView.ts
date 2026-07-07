import { dateToDateKey, parseAppDateKey } from "./dateKey.ts";
import { filterEventsForChild } from "./eventScope.ts";
import type { CalendarEvent, DailySupply } from "../lib/api/endpoints/schedule.ts";
import type { MemoReply } from "../lib/api/endpoints/memo.ts";
import type { ParentAlert } from "../lib/api/endpoints/notifications.ts";

export interface WeeklyReportInput {
  childMemberId: string | null | undefined;
  childUserId?: string | null;
  weekDateKeys: readonly string[];
  events: readonly CalendarEvent[];
  supplies: readonly DailySupply[];
  memos: readonly MemoReply[];
  alerts: readonly ParentAlert[];
}

export interface WeeklyBusiestDay {
  dateKey: string;
  eventCount: number;
}

export interface WeeklyReportSummary {
  eventCount: number;
  supplyTotal: number;
  supplyDone: number;
  memoCount: number;
  alertCount: number;
  busiestDay: WeeklyBusiestDay | null;
  hasEnoughData: boolean;
}

export function buildRecentWeekDateKeys(now: Date = new Date()): string[] {
  return Array.from({ length: 7 }, (_, index) => {
    const offset = index - 6;
    return dateToDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  });
}

function dateKeySet(keys: readonly string[]): ReadonlySet<string> {
  return new Set(keys.filter((key) => !!parseAppDateKey(key)));
}

function dateKeyFromTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateToDateKey(date);
}

export function summarizeWeeklyReport(input: WeeklyReportInput): WeeklyReportSummary {
  const keys = dateKeySet(input.weekDateKeys);
  if (!input.childMemberId || keys.size === 0) {
    return {
      eventCount: 0,
      supplyTotal: 0,
      supplyDone: 0,
      memoCount: 0,
      alertCount: 0,
      busiestDay: null,
      hasEnoughData: false,
    };
  }

  const childEvents = filterEventsForChild(input.events, input.childMemberId).filter((event) =>
    keys.has(event.date_key),
  );
  const childSupplies = input.supplies.filter(
    (item) => item.child_user_id === input.childMemberId && keys.has(item.date_key),
  );
  const childMemos = input.memos.filter((memo) => memo.child_id === input.childMemberId);
  const childAlerts = input.alerts.filter((alert) => {
    if (input.childUserId && alert.child_user_id && alert.child_user_id !== input.childUserId) return false;
    const key = dateKeyFromTimestamp(alert.created_at);
    return key ? keys.has(key) : false;
  });

  const byDay = new Map<string, number>();
  for (const event of childEvents) byDay.set(event.date_key, (byDay.get(event.date_key) ?? 0) + 1);
  const busiestDay = [...byDay.entries()]
    .sort((a, b) => b[1] - a[1] || input.weekDateKeys.indexOf(a[0]) - input.weekDateKeys.indexOf(b[0]))
    .map(([dateKey, eventCount]) => ({ dateKey, eventCount }))[0] ?? null;

  const supplyDone = childSupplies.filter((item) => item.done).length;
  const eventCount = childEvents.length;
  const memoCount = childMemos.length;
  const alertCount = childAlerts.length;
  return {
    eventCount,
    supplyTotal: childSupplies.length,
    supplyDone,
    memoCount,
    alertCount,
    busiestDay,
    hasEnoughData: eventCount + childSupplies.length + memoCount + alertCount > 0,
  };
}
