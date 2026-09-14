import { resolveCanonicalFamilyMembership } from "../db/authz.ts";
import {
  DEFAULT_NOTIFICATION_QUIET_HOURS,
  type NotificationQuietHours,
} from "./notificationQuietHours.ts";

export type ExpectedSettingsUserValidation = "ok" | "required" | "mismatch";

export function validateExpectedSettingsUser(
  expectedUserId: unknown,
  authenticatedUserId: string,
): ExpectedSettingsUserValidation {
  const expected = typeof expectedUserId === "string" ? expectedUserId.trim() : "";
  if (!expected) return "required";
  return expected === authenticatedUserId ? "ok" : "mismatch";
}

export interface ChildNotificationStatus {
  user_id: string;
  child_enabled: boolean;
  configured: boolean;
}

export async function loadChildNotificationStatus(
  db: D1Database,
  args: {
    callerUserId: string;
    familyId: string;
    childUserId: string;
  },
): Promise<ChildNotificationStatus | null> {
  if (!args.callerUserId || !args.familyId || !args.childUserId) return null;
  const row = await db
    .prepare(
      `SELECT child.user_id AS child_user_id,
              settings.user_id AS settings_user_id,
              settings.child_enabled AS child_enabled
         FROM family_members child
         LEFT JOIN notification_settings settings ON settings.user_id = child.user_id
        WHERE child.family_id = ?1
          AND child.user_id = ?2
          AND child.role = 'child'
          AND child.is_active = 1
          AND (
            EXISTS (
              SELECT 1 FROM families
               WHERE id = ?1 AND parent_id = ?3
            )
            OR EXISTS (
              SELECT 1 FROM family_members parent
               WHERE parent.family_id = ?1
                 AND parent.user_id = ?3
                 AND parent.role = 'parent'
                 AND parent.is_active = 1
            )
          )
        LIMIT 1`,
    )
    .bind(args.familyId, args.childUserId, args.callerUserId)
    .first<{
      child_user_id: string;
      settings_user_id: string | null;
      child_enabled: unknown;
    }>();
  if (!row?.child_user_id) return null;
  const configured = !!row.settings_user_id;
  const childEnabled = configured
    ? !(row.child_enabled === 0 || row.child_enabled === "0" || row.child_enabled === false)
    : true;
  return {
    user_id: row.child_user_id,
    child_enabled: childEnabled,
    configured,
  };
}

export interface FamilyQuietHoursRecipient {
  target_user_id: string;
  role: "parent" | "child";
  enabled: boolean;
  start_minute: number;
  end_minute: number;
  updated_at: string | null;
  configured: boolean;
  time_zone?: string;
}

interface FamilyQuietHoursRecipientRow {
  time_zone?: string;
  target_user_id: string;
  role: string;
  quiet_hours_enabled: unknown;
  quiet_hours_start_minute: unknown;
  quiet_hours_end_minute: unknown;
  quiet_hours_updated_at: string | null;
}

function quietHoursFromRow(row: FamilyQuietHoursRecipientRow): NotificationQuietHours {
  return {
    enabled: row.quiet_hours_enabled === 1
      || row.quiet_hours_enabled === true
      || row.quiet_hours_enabled === "1",
    startMinute: row.quiet_hours_start_minute == null
      ? DEFAULT_NOTIFICATION_QUIET_HOURS.startMinute
      : Number(row.quiet_hours_start_minute),
    endMinute: row.quiet_hours_end_minute == null
      ? DEFAULT_NOTIFICATION_QUIET_HOURS.endMinute
      : Number(row.quiet_hours_end_minute),
    updatedAt: row.quiet_hours_updated_at ?? null,
  };
}

export async function loadFamilyQuietHoursRecipients(
  db: D1Database,
  args: { callerUserId: string; familyId: string },
): Promise<FamilyQuietHoursRecipient[] | null> {
  if (!args.callerUserId || !args.familyId) return null;
  const canonical = await resolveCanonicalFamilyMembership(
    db,
    args.callerUserId,
    args.familyId,
  );
  if (!canonical || canonical.familyId !== args.familyId || canonical.role !== "parent") {
    return null;
  }

  const { results } = await db
    .prepare(
      `SELECT recipient.target_user_id,
              recipient.role,
              settings.quiet_hours_enabled,
              settings.quiet_hours_start_minute,
              settings.quiet_hours_end_minute,
              settings.quiet_hours_updated_at,
              COALESCE(settings.time_zone, (SELECT time_zone FROM families WHERE id=?2)) AS time_zone
         FROM (
           SELECT ?1 AS target_user_id, 'parent' AS role, 0 AS sort_order, '' AS sort_key
           UNION ALL
           SELECT child.user_id AS target_user_id, 'child' AS role, 1 AS sort_order, child.id AS sort_key
             FROM family_members child
            WHERE child.family_id = ?2
              AND child.role = 'child'
              AND child.is_active = 1
              AND child.user_id IS NOT NULL
         ) recipient
         LEFT JOIN notification_settings settings
           ON settings.user_id = recipient.target_user_id
        ORDER BY recipient.sort_order, recipient.sort_key, recipient.target_user_id`,
    )
    .bind(args.callerUserId, args.familyId)
    .all<FamilyQuietHoursRecipientRow>();

  return (results ?? []).map((row) => {
    const quietHours = quietHoursFromRow(row);
    return {
      target_user_id: row.target_user_id,
      role: row.role === "child" ? "child" : "parent",
      enabled: quietHours.enabled,
      start_minute: quietHours.startMinute,
      end_minute: quietHours.endMinute,
      updated_at: quietHours.updatedAt,
      configured: row.quiet_hours_updated_at != null,
      time_zone: row.time_zone ?? "Asia/Seoul",
    };
  });
}

export async function validateQuietHoursTarget(
  db: D1Database,
  args: { callerUserId: string; familyId: string; targetUserId: string },
): Promise<"self_parent" | "active_child" | null> {
  if (!args.callerUserId || !args.familyId || !args.targetUserId) return null;
  const canonical = await resolveCanonicalFamilyMembership(
    db,
    args.callerUserId,
    args.familyId,
  );
  if (!canonical || canonical.familyId !== args.familyId || canonical.role !== "parent") {
    return null;
  }
  if (args.targetUserId === args.callerUserId) return "self_parent";

  const child = await db
    .prepare(
      `SELECT 1 AS ok
         FROM family_members
        WHERE family_id = ?
          AND user_id = ?
          AND role = 'child'
          AND is_active = 1
        LIMIT 1`,
    )
    .bind(args.familyId, args.targetUserId)
    .first<{ ok: number }>();
  return child?.ok ? "active_child" : null;
}
