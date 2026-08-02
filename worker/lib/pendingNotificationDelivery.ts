import {
  DEFAULT_NOTIFICATION_QUIET_HOURS,
  isNotificationQuietAtMs,
  isQuietHoursBypass,
  type NotificationQuietHours,
  type QuietHoursNotificationIdentity,
} from "./notificationQuietHours.ts";
import { pgToMs } from "./time.ts";

export type PendingRecipientRole = "parent" | "child";

export async function loadActiveFamilyNotificationRecipientIds(
  db: D1Database,
  args: {
    familyId: string;
    senderUserId?: string | null;
  },
): Promise<string[]> {
  if (!args.familyId) return [];
  const { results } = await db
    .prepare(
      `SELECT user_id FROM (
         SELECT parent_id AS user_id
           FROM families
          WHERE id = ?1 AND parent_id IS NOT NULL AND parent_id <> ''
         UNION
         SELECT user_id
           FROM family_members
          WHERE family_id = ?1
            AND role IN ('parent','child')
            AND is_active = 1
            AND user_id IS NOT NULL
            AND user_id <> ''
       )
       WHERE user_id <> ?2
       ORDER BY user_id ASC`,
    )
    .bind(args.familyId, args.senderUserId ?? "")
    .all<{ user_id: string }>();
  return (results ?? []).map((row) => row.user_id).filter(Boolean);
}

export async function resolvePendingNotificationRecipientRole(
  db: D1Database,
  familyId: string,
  userId: string,
): Promise<PendingRecipientRole | null> {
  if (!familyId || !userId) return null;
  const row = await db
    .prepare(
      `SELECT CASE
         WHEN EXISTS (
           SELECT 1 FROM families
            WHERE id = ?1 AND parent_id = ?2
         ) THEN 'parent'
         WHEN EXISTS (
           SELECT 1 FROM family_members
            WHERE family_id = ?1 AND user_id = ?2
              AND role = 'parent' AND is_active = 1
         ) THEN 'parent'
         WHEN EXISTS (
           SELECT 1 FROM family_members
            WHERE family_id = ?1 AND user_id = ?2
              AND role = 'child' AND is_active = 1
         ) THEN 'child'
         ELSE NULL
       END AS role`,
    )
    .bind(familyId, userId)
    .first<{ role: string | null }>();
  return row?.role === "parent" || row?.role === "child" ? row.role : null;
}

export interface PendingNotificationRow {
  id: string;
  title: string;
  body: string;
  data: unknown;
  created_at: string;
}

const PENDING_RETURN_LIMIT = 20;
const PENDING_DRAIN_PAGE_SIZE = 20;
// 호출당 최대 500행만 훑어 장기 backlog가 한 Worker 실행을 독점하지 않게 한다.
const PENDING_DRAIN_MAX_PAGES = 25;

interface PendingQuietHoursRow {
  quiet_hours_enabled: number;
  quiet_hours_start_minute: number;
  quiet_hours_end_minute: number;
  quiet_hours_updated_at: string | null;
}

function pendingNotificationData(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  if (typeof data !== "string" || !data.trim()) return {};
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function pendingNotificationIdentity(data: unknown): QuietHoursNotificationIdentity {
  const parsed = pendingNotificationData(data);
  return {
    action: String(parsed.action ?? parsed.type ?? ""),
    alertType: parsed.alertType != null
      ? String(parsed.alertType)
      : (parsed.alert_type != null ? String(parsed.alert_type) : null),
  };
}

function pendingNotificationUrgentRank(data: unknown): number {
  const urgent = String(pendingNotificationData(data).urgent ?? "").toLowerCase();
  return urgent === "1" || urgent === "true" ? 1 : 0;
}

async function loadRecipientQuietHours(
  db: D1Database,
  userId: string,
): Promise<NotificationQuietHours> {
  const row = await db
    .prepare(
      `SELECT quiet_hours_enabled, quiet_hours_start_minute,
              quiet_hours_end_minute, quiet_hours_updated_at
         FROM notification_settings
        WHERE user_id = ?
        LIMIT 1`,
    )
    .bind(userId)
    .first<PendingQuietHoursRow>();
  if (!row) return { ...DEFAULT_NOTIFICATION_QUIET_HOURS };
  return {
    enabled: row.quiet_hours_enabled === 1,
    startMinute: row.quiet_hours_start_minute,
    endMinute: row.quiet_hours_end_minute,
    updatedAt: row.quiet_hours_updated_at,
  };
}

interface PendingDrainCursor {
  urgentRank: number;
  createdKey: string;
  id: string;
}

async function loadPendingNotificationPage(
  db: D1Database,
  args: {
    familyId: string;
    userId: string;
    role: PendingRecipientRole;
    now: string;
  },
  cursor: PendingDrainCursor | null,
): Promise<PendingNotificationRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, title, body, data, created_at
         FROM (
           SELECT id, title, body, data, created_at,
                  CASE
                    WHEN lower(CAST(json_extract(data,'$.urgent') AS TEXT)) IN ('1','true') THEN 1
                    ELSE 0
                  END AS urgent_rank,
                  substr(created_at,1,19) AS created_key
             FROM pending_notifications
            WHERE family_id = ?1
              AND delivered = 0
              AND (expires_at IS NULL OR substr(expires_at,1,19) > ?2)
              AND COALESCE(json_extract(data,'$.senderUserId'),'') <> ?3
              AND json_extract(data,'$.targetUserId') = ?3
              AND (COALESCE(json_extract(data,'$.targetRole'),'') = ''
                OR lower(json_extract(data,'$.targetRole')) = ?4)
         )
        WHERE ?5 IS NULL
           OR urgent_rank < ?5
           OR (
             urgent_rank = ?5
             AND (
               created_key > ?6
               OR (created_key = ?6 AND id > ?7)
             )
           )
        ORDER BY urgent_rank DESC, created_key ASC, id ASC
        LIMIT ?8`,
    )
    .bind(
      args.familyId,
      args.now,
      args.userId,
      args.role,
      cursor?.urgentRank ?? null,
      cursor?.createdKey ?? "",
      cursor?.id ?? "",
      PENDING_DRAIN_PAGE_SIZE,
    )
    .all<PendingNotificationRow>();
  return results ?? [];
}

async function suppressPendingNotifications(
  db: D1Database,
  args: {
    ids: string[];
    deliveredAt: string;
    targetUserId: string;
  },
): Promise<void> {
  if (args.ids.length === 0) return;
  const markers = args.ids.map(() => "?").join(",");
  await db
    .prepare(
      `UPDATE pending_notifications
          SET delivered = 1,
              delivered_at = ?,
              delivery_status = json_set(COALESCE(delivery_status, '{}'),
                '$.suppressed', 'quiet_hours', '$.targetUserId', ?)
        WHERE id IN (${markers})
          AND delivered = 0`,
    )
    .bind(args.deliveredAt, args.targetUserId, ...args.ids)
    .run();
}

export async function loadPendingNotificationsForRecipient(
  db: D1Database,
  args: {
    familyId: string;
    userId: string;
    requestedRole?: string | null;
    now: string;
  },
): Promise<PendingNotificationRow[]> {
  const role = await resolvePendingNotificationRecipientRole(db, args.familyId, args.userId);
  const requestedRole = args.requestedRole?.trim().toLowerCase() ?? "";
  if (!role || (requestedRole && requestedRole !== role)) return [];

  const allowed: PendingNotificationRow[] = [];
  let cursor: PendingDrainCursor | null = null;
  let quietHours: NotificationQuietHours | null = null;
  let quietHoursAttempted = false;
  let quietHoursFailed = false;
  let quietHoursFailure: unknown;

  for (let pageIndex = 0; pageIndex < PENDING_DRAIN_MAX_PAGES; pageIndex += 1) {
    const candidates = await loadPendingNotificationPage(db, {
      familyId: args.familyId,
      userId: args.userId,
      role,
      now: args.now,
    }, cursor);
    if (candidates.length === 0) break;

    const last = candidates[candidates.length - 1];
    cursor = {
      urgentRank: pendingNotificationUrgentRank(last.data),
      createdKey: last.created_at.slice(0, 19),
      id: last.id,
    };
    const identities = candidates.map((row) => ({
      row,
      identity: pendingNotificationIdentity(row.data),
    }));
    if (
      !quietHoursAttempted
      && identities.some(({ identity }) => !isQuietHoursBypass(identity))
    ) {
      quietHoursAttempted = true;
      try {
        quietHours = await loadRecipientQuietHours(db, args.userId);
      } catch (error) {
        quietHoursFailed = true;
        quietHoursFailure = error;
      }
    }

    const suppressedIds: string[] = [];
    for (const { row, identity } of identities) {
      if (isQuietHoursBypass(identity)) {
        allowed.push(row);
        continue;
      }
      if (quietHoursFailed || !quietHours) continue;

      const createdAtMs = pgToMs(row.created_at);
      if (
        Number.isFinite(createdAtMs)
        && isNotificationQuietAtMs(quietHours, identity, createdAtMs)
      ) {
        suppressedIds.push(row.id);
      } else {
        allowed.push(row);
      }
    }
    await suppressPendingNotifications(db, {
      ids: suppressedIds,
      deliveredAt: args.now,
      targetUserId: args.userId,
    });

    if (allowed.length >= PENDING_RETURN_LIMIT) {
      return allowed.slice(0, PENDING_RETURN_LIMIT);
    }
    if (candidates.length < PENDING_DRAIN_PAGE_SIZE) break;
  }

  if (quietHoursFailed && allowed.length === 0) throw quietHoursFailure;
  return allowed.slice(0, PENDING_RETURN_LIMIT);
}

export async function markPendingNotificationsDeliveredForCaller(
  db: D1Database,
  args: {
    ids: string[];
    callerUserId: string | null;
    familyIds: string[];
    serviceRole: boolean;
    deliveredAt: string;
  },
): Promise<number> {
  const ids = [...new Set(args.ids.filter(Boolean))].slice(0, 100);
  if (ids.length === 0) return 0;

  const idPlaceholders = ids.map(() => "?").join(",");
  let sql = `UPDATE pending_notifications SET delivered = 1, delivered_at = ? WHERE id IN (${idPlaceholders})`;
  const binds: unknown[] = [args.deliveredAt, ...ids];

  if (!args.serviceRole) {
    if (!args.callerUserId) return 0;
    const familyIds = [...new Set(args.familyIds.filter(Boolean))];
    const verified = await Promise.all(familyIds.map(async (familyId) => ({
      familyId,
      role: await resolvePendingNotificationRecipientRole(db, familyId, args.callerUserId!),
    })));
    const parentFamilies = verified.filter((item) => item.role === "parent").map((item) => item.familyId);
    const childFamilies = verified.filter((item) => item.role === "child").map((item) => item.familyId);
    if (parentFamilies.length === 0 && childFamilies.length === 0) return 0;

    sql += ` AND json_extract(data,'$.targetUserId') = ?`;
    binds.push(args.callerUserId);

    const roleClauses: string[] = [];
    if (parentFamilies.length > 0) {
      roleClauses.push(
        `(family_id IN (${parentFamilies.map(() => "?").join(",")})
          AND (COALESCE(json_extract(data,'$.targetRole'),'') = ''
            OR lower(json_extract(data,'$.targetRole')) = 'parent'))`,
      );
      binds.push(...parentFamilies);
    }
    if (childFamilies.length > 0) {
      roleClauses.push(
        `(family_id IN (${childFamilies.map(() => "?").join(",")})
          AND (COALESCE(json_extract(data,'$.targetRole'),'') = ''
            OR lower(json_extract(data,'$.targetRole')) = 'child'))`,
      );
      binds.push(...childFamilies);
    }
    sql += ` AND (${roleClauses.join(" OR ")})`;
  }

  const result = await db.prepare(sql).bind(...binds).run();
  return Number(result.meta?.changes ?? 0);
}
