import {
  addDaysToDateKey,
  dateKeyToDateInputValue,
  dateInputValueToDateKey,
  dateToDateKeyInTimeZone,
  parseAppDateKey,
} from "./dateKey.ts";
import { filterEventsForChild } from "./eventScope.ts";
import type { CalendarEvent, DailySupply } from "../lib/api/endpoints/schedule.ts";
import type { MemoReply } from "../lib/api/endpoints/memo.ts";
import type { ParentAlert } from "../lib/api/endpoints/notifications.ts";
import type { SupportedLocale } from "../i18n/locale.ts";
import { formatNumber } from "../i18n/format.ts";

export interface WeeklyReportInput {
  childMemberId: string | null | undefined;
  childUserId?: string | null;
  weekDateKeys: readonly string[];
  events: readonly CalendarEvent[];
  supplies: readonly DailySupply[];
  memos: readonly MemoReply[];
  alerts: readonly ParentAlert[];
  timeZone: string;
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

interface WeeklyReportChildRef {
  id: string;
  user_id?: string | null;
}

/** 결제 전에 고른 아이가 현재 가족에 그대로 있을 때만 선택을 복원한다. */
export function resolveWeeklyReportReturnChildId(
  draft: unknown,
  children: readonly WeeklyReportChildRef[],
): string | null {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  const value = draft as Record<string, unknown>;
  if (typeof value.childMemberId !== "string" || typeof value.childUserId !== "string") return null;
  const matched = children.find(
    (child) => child.id === value.childMemberId && child.user_id === value.childUserId,
  );
  return matched?.id ?? null;
}

export function weeklyReportTeaser(
  summary: WeeklyReportSummary,
  childName: string,
  locale: SupportedLocale,
): string {
  const name = childName.trim() || "우리 아이";
  if (!summary.hasEnoughData) return `${name}의 이번 주 기록이 아직 없어요.`;
  if (summary.alertCount > 0) {
    return `${name}의 이번 주에는 일정 ${formatNumber(summary.eventCount, locale)}개와 안전 알림 ${formatNumber(summary.alertCount, locale)}건이 기록됐어요.`;
  }
  if (summary.supplyTotal > 0) {
    return `${name}의 이번 주에는 일정 ${formatNumber(summary.eventCount, locale)}개가 있었고 준비물 ${formatNumber(summary.supplyDone, locale)}/${formatNumber(summary.supplyTotal, locale)}개를 챙겼어요.`;
  }
  if (summary.eventCount > 0) return `${name}의 이번 주에는 일정 ${formatNumber(summary.eventCount, locale)}개가 있었어요.`;
  return `${name}의 이번 주에는 가족 메시지 ${formatNumber(summary.memoCount, locale)}개가 오갔어요.`;
}

function dateStampInTimeZone(value: Date, timeZone: string): string {
  return dateKeyToDateInputValue(dateToDateKeyInTimeZone(value, timeZone));
}

export function buildRecentWeekDateKeys(now: Date, timeZone: string): string[] {
  const todayKey = dateInputValueToDateKey(dateStampInTimeZone(now, timeZone));
  if (!todayKey) return [];
  return Array.from({ length: 7 }, (_, index) => addDaysToDateKey(todayKey, index - 6));
}

function dateKeySet(keys: readonly string[]): ReadonlySet<string> {
  return new Set(keys.filter((key) => !!parseAppDateKey(key)));
}

function dateKeyFromTimestamp(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateInputValueToDateKey(dateStampInTimeZone(date, timeZone));
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
    const key = dateKeyFromTimestamp(alert.created_at, input.timeZone);
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
