import { minuteOfDayInTimeZone } from "./timeZone.ts";

export interface NotificationQuietHours {
  timeZone?: string;
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  updatedAt: string | null;
}

export interface QuietHoursNotificationIdentity {
  action: string;
  alertType?: string | null;
}

interface NotificationQuietHoursRow {
  user_id: string;
  time_zone?: string;
  quiet_hours_enabled: number;
  quiet_hours_start_minute: number;
  quiet_hours_end_minute: number;
  quiet_hours_updated_at: string | null;
}

export const DEFAULT_NOTIFICATION_QUIET_HOURS: Readonly<NotificationQuietHours> = Object.freeze({
  enabled: false,
  startMinute: 1320,
  endMinute: 420,
  updatedAt: null,
});

const BYPASS_ACTIONS = new Set([
  "sos", "emergency", "force_ring", "force_ring_stop", "force_ring_reminder",
  "remote_listen", "remote_listen_stop", "request_location", "request_device_status",
]);

const BYPASS_ALERT_TYPES = new Set([
  "sos", "emergency", "sos_followup", "not_arrived", "missed_arrival",
  "danger_zone", "danger_enter", "danger_entry", "danger_exit",
]);

const NOTIFICATION_QUIET_HOURS_USER_CHUNK_SIZE = 90;

export function minuteOfDayInSeoul(nowMs: number): number {
  const minute = (Math.floor(nowMs / 60_000) + 9 * 60) % (24 * 60);
  return minute < 0 ? minute + 24 * 60 : minute;
}

export function isQuietHoursActive(setting: NotificationQuietHours, minute: number): boolean {
  if (!setting.enabled || !Number.isInteger(minute) || minute < 0 || minute > 1439) return false;
  const { startMinute, endMinute } = setting;
  if (startMinute === endMinute) return false;
  return startMinute < endMinute
    ? startMinute <= minute && minute < endMinute
    : minute >= startMinute || minute < endMinute;
}

export function isQuietHoursBypass(identity: QuietHoursNotificationIdentity): boolean {
  return BYPASS_ACTIONS.has(identity.action)
    || BYPASS_ALERT_TYPES.has(identity.alertType ?? "");
}

export function isNotificationQuietAtMs(
  setting: NotificationQuietHours,
  identity: QuietHoursNotificationIdentity,
  nowMs: number,
): boolean {
  return !isQuietHoursBypass(identity)
    && isQuietHoursActive(setting, minuteOfDayInTimeZone(nowMs, setting.timeZone ?? "Asia/Seoul"));
}

export async function partitionNotificationRecipients(
  db: D1Database,
  args: {
    userIds: Iterable<string>;
    identity: QuietHoursNotificationIdentity;
    atMs: number;
  },
): Promise<{ allowed: Set<string>; suppressed: Set<string> }> {
  const userIds = [...new Set(args.userIds)];
  const allowed = new Set<string>();
  const suppressed = new Set<string>();

  if (isQuietHoursBypass(args.identity)) {
    return { allowed: new Set(userIds), suppressed };
  }
  if (userIds.length === 0) return { allowed, suppressed };

  const settingsByUserId = new Map<string, NotificationQuietHours>();
  for (let offset = 0; offset < userIds.length; offset += NOTIFICATION_QUIET_HOURS_USER_CHUNK_SIZE) {
    const userIdChunk = userIds.slice(offset, offset + NOTIFICATION_QUIET_HOURS_USER_CHUNK_SIZE);
    const markers = userIdChunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT user_id, quiet_hours_enabled, quiet_hours_start_minute,
                quiet_hours_end_minute, quiet_hours_updated_at,
                COALESCE(time_zone, (SELECT f.time_zone FROM families f WHERE f.id = notification_settings.family_id), 'Asia/Seoul') AS time_zone
           FROM notification_settings
          WHERE user_id IN (${markers})`,
      )
      .bind(...userIdChunk)
      .all<NotificationQuietHoursRow>();
    for (const row of results ?? []) {
      settingsByUserId.set(row.user_id, {
        timeZone: row.time_zone ?? "Asia/Seoul",
        enabled: row.quiet_hours_enabled === 1,
        startMinute: row.quiet_hours_start_minute,
        endMinute: row.quiet_hours_end_minute,
        updatedAt: row.quiet_hours_updated_at,
      });
    }
  }

  for (const userId of userIds) {
    const setting = settingsByUserId.get(userId) ?? DEFAULT_NOTIFICATION_QUIET_HOURS;
    if (isNotificationQuietAtMs(setting, args.identity, args.atMs)) {
      suppressed.add(userId);
    } else {
      allowed.add(userId);
    }
  }
  return { allowed, suppressed };
}
