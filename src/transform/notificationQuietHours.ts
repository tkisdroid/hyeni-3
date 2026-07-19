export interface NotificationQuietHours {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  updatedAt: string | null;
  configured: boolean;
}

export interface NotificationQuietHoursDraft {
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
    && current.endMinute === submitted.endMinute;
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

function koreanTimeLabel(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  let label: string;

  if (hour === 0) label = "자정";
  else if (hour <= 5) label = `새벽 ${hour}시`;
  else if (hour <= 9) label = `아침 ${hour}시`;
  else if (hour <= 11) label = `오전 ${hour}시`;
  else if (hour === 12) label = "낮 12시";
  else if (hour <= 17) label = `오후 ${hour - 12}시`;
  else if (hour <= 20) label = `저녁 ${hour - 12}시`;
  else label = `밤 ${hour - 12}시`;

  return minute === 0 ? label : `${label} ${minute}분`;
}

export function notificationQuietHoursRange(value: NotificationQuietHoursDraft): string {
  if (!isValidNotificationQuietHours(value)) return "";
  return `${koreanTimeLabel(value.startMinute)}부터 ${koreanTimeLabel(value.endMinute)}까지`;
}
