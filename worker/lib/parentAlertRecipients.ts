import { partitionNotificationRecipients } from "./notificationQuietHours.ts";

const REGISTERED_PLACE_ALERT_TYPES = new Set(["place_arrived", "place_left"]);
const LOCATION_ALERT_TYPES = new Set([
  "arrived",
  "late_arrived",
  "unregistered_stay_left",
]);

export interface ParentAlertSettingRow {
  registered_place_enabled?: unknown;
  location_enabled?: unknown;
}
function settingEnabled(value: unknown): boolean {
  if (value == null) return true;
  if (value === false || value === 0) return false;
  const text = String(value).trim().toLowerCase();
  return text !== "false" && text !== "0";
}

export function isParentAlertRecipientEnabled(
  alertType: string,
  setting: ParentAlertSettingRow | null | undefined,
): boolean {
  if (REGISTERED_PLACE_ALERT_TYPES.has(alertType)) {
    return settingEnabled(setting?.registered_place_enabled);
  }
  if (LOCATION_ALERT_TYPES.has(alertType)) {
    return settingEnabled(setting?.location_enabled);
  }
  return true;
}

/** 부모별 알림 설정을 적용한 실제 FCM/pending 수신자. 설정 행 없음은 기존 기본 ON. */
export async function loadParentAlertRecipientIds(
  db: D1Database,
  familyId: string,
  alertType: string,
): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `WITH parent_users AS (
         SELECT user_id FROM family_members
          WHERE family_id = ?1 AND role = 'parent' AND is_active = 1 AND user_id IS NOT NULL
         UNION
         SELECT parent_id AS user_id FROM families WHERE id = ?1
       )
       SELECT p.user_id, ns.registered_place_enabled, ns.location_enabled
         FROM parent_users p
         LEFT JOIN notification_settings ns ON ns.user_id = p.user_id`,
    )
    .bind(familyId)
    .all<{ user_id: string; registered_place_enabled: unknown; location_enabled: unknown }>();
  return new Set(
    (results ?? [])
      .filter((row) => row.user_id && isParentAlertRecipientEnabled(alertType, row))
      .map((row) => row.user_id),
  );
}

/** 기존 알림별 설정을 통과한 부모를 조용한 시간 허용·억제 집합으로 분리한다. */
export async function loadParentAlertRecipients(
  db: D1Database,
  familyId: string,
  alertType: string,
  atMs = Date.now(),
): Promise<{ allowed: Set<string>; suppressed: Set<string> }> {
  const eligible = await loadParentAlertRecipientIds(db, familyId, alertType);
  return partitionNotificationRecipients(db, {
    userIds: eligible,
    identity: { action: "parent_alert", alertType },
    atMs,
  });
}
