import type { SupportedLocale } from "../i18n/locale.ts";
import { formatDateTime } from "../i18n/format.ts";

export interface NotificationQuietHours {
  timeZone?: string;
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  updatedAt: string | null;
  configured: boolean;
}

export interface NotificationQuietHoursDraft {
  timeZone?: string;
  enabled: boolean;
  startMinute: number;
  endMinute: number;
}

export interface NotificationQuietHoursTargetDraft extends NotificationQuietHoursDraft {
  targetUserId: string;
}

export const DEFAULT_NOTIFICATION_QUIET_HOURS: NotificationQuietHours = {
  enabled: false,
  startMinute: 1320,
  endMinute: 420,
  updatedAt: null,
  configured: false,
};

function isMinuteOfDay(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 1439;
}

export function minuteOfDayToTimeInput(value: number): string {
  if (!isMinuteOfDay(value)) return "";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function timeInputToMinuteOfDay(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function isValidNotificationQuietHours(value: NotificationQuietHoursDraft): boolean {
  return typeof value.enabled === "boolean"
    && isMinuteOfDay(value.startMinute)
    && isMinuteOfDay(value.endMinute)
    && value.startMinute !== value.endMinute;
}

export function isSameNotificationQuietHoursTargetDraft(
  current: NotificationQuietHoursTargetDraft,
  submitted: NotificationQuietHoursTargetDraft,
): boolean {
  return current.targetUserId === submitted.targetUserId
    && current.enabled === submitted.enabled
    && current.startMinute === submitted.startMinute
    && current.endMinute === submitted.endMinute
    && current.timeZone === submitted.timeZone;
}

export interface NotificationQuietHoursSourceResolution {
  draft: NotificationQuietHoursTargetDraft;
  source: NotificationQuietHoursTargetDraft;
  hydrated: boolean;
}

export function resolveNotificationQuietHoursSourceUpdate(
  current: NotificationQuietHoursTargetDraft,
  previousSource: NotificationQuietHoursTargetDraft | null,
  nextSource: NotificationQuietHoursTargetDraft,
): NotificationQuietHoursSourceResolution {
  const targetChanged = previousSource === null
    || current.targetUserId !== nextSource.targetUserId
    || previousSource.targetUserId !== nextSource.targetUserId;
  const hydrated = targetChanged
    || (previousSource !== null
      && isSameNotificationQuietHoursTargetDraft(current, previousSource));

  return {
    draft: hydrated ? nextSource : current,
    source: nextSource,
    hydrated,
  };
}

function timeLabel(value: number, locale: SupportedLocale): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  // quiet hours 값은 특정 날짜의 instant가 아니라 wall-clock 분이므로 UTC 합성 시각으로 표시한다.
  return formatDateTime(Date.UTC(2026, 0, 1, hour, minute), {
    locale,
    timeZone: "UTC",
    timeStyle: "short",
  });
}

export function notificationQuietHoursRange(
  value: NotificationQuietHoursDraft,
  locale: SupportedLocale,
): string {
  if (!isValidNotificationQuietHours(value)) return "";
  return `${timeLabel(value.startMinute, locale)}부터 ${timeLabel(value.endMinute, locale)}까지`;
}
