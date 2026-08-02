const CHILD_WRITABLE_ALERT_TYPES = new Set([
  "sos",
  "place_arrived",
  "place_left",
  "low_battery",
  "child_setting_request",
]);

// 이 알림들은 일정·위치·정확도·시간창을 Worker가 함께 검증한 뒤 내부 저장 경로로만
// 만들어야 한다. 공개 /api/parent-alerts 본문을 신뢰하면 가족 구성원이 임의의
// 도착·미도착·위험장소 기록과 부모 푸시를 위조할 수 있다.
const SERVER_DERIVED_ALERT_TYPES = new Set([
  "arrived",
  "late_arrived",
  "not_arrived",
  "missed_arrival",
  "danger_zone",
  "danger_enter",
  "danger_entry",
  "danger_exit",
]);

export function isServerDerivedParentAlertType(alertType: string): boolean {
  return SERVER_DERIVED_ALERT_TYPES.has(alertType);
}

const PARENT_WRITABLE_ALERT_TYPES = new Set([
  ...CHILD_WRITABLE_ALERT_TYPES,
  "emergency",
  "sos_followup",
  "location_stale",
  "location_recovered",
  "unregistered_stay",
  "unregistered_stay_left",
]);

async function resolveCallerRole(
  db: D1Database,
  callerUserId: string,
  familyId: string,
): Promise<"parent" | "child" | null> {
  const row = await db
    .prepare(
      `SELECT CASE
         WHEN EXISTS (SELECT 1 FROM families WHERE id = ?1 AND parent_id = ?2) THEN 'parent'
         WHEN EXISTS (
           SELECT 1 FROM family_members
            WHERE family_id = ?1 AND user_id = ?2 AND role = 'parent' AND is_active = 1
         ) THEN 'parent'
         WHEN EXISTS (
           SELECT 1 FROM family_members
            WHERE family_id = ?1 AND user_id = ?2 AND role = 'child' AND is_active = 1
         ) THEN 'child'
         ELSE NULL
       END AS role`,
    )
    .bind(familyId, callerUserId)
    .first<{ role: string | null }>();
  return row?.role === "parent" || row?.role === "child" ? row.role : null;
}

export async function canReadParentAlerts(
  db: D1Database,
  callerUserId: string,
  familyId: string,
): Promise<boolean> {
  return (await resolveCallerRole(db, callerUserId, familyId)) === "parent";
}

export interface ParentAlertWriteScopeInput {
  callerUserId: string;
  familyId: string;
  alertType: string;
  requestedChildUserId: string | null;
}

export interface ParentAlertWriteScope {
  callerRole: "parent" | "child";
  childUserId: string | null;
}

export async function resolveParentAlertWriteScope(
  db: D1Database,
  input: ParentAlertWriteScopeInput,
): Promise<ParentAlertWriteScope | null> {
  const { callerUserId, familyId, alertType } = input;
  if (!callerUserId || !familyId || !alertType) return null;
  let callerRole = await resolveCallerRole(db, callerUserId, familyId);
  // 기기 교체로 비활성화된 옛 아이도 사용자가 직접 누른 SOS 한 종류만 보낼 수 있다.
  // 일반 상태·도착 알림은 활성 기기만 허용해 중복/위조를 막는다.
  if (!callerRole && alertType === "sos") {
    const inactiveChild = await db
      .prepare(
        `SELECT 1 AS ok
           FROM family_members fm
           JOIN families f ON f.id = fm.family_id
          WHERE fm.family_id = ? AND fm.user_id = ?
            AND fm.role = 'child' AND fm.is_active = 0
          LIMIT 1`,
      )
      .bind(familyId, callerUserId)
      .first<{ ok: number }>();
    if (inactiveChild) callerRole = "child";
  }
  if (!callerRole) return null;
  if (isServerDerivedParentAlertType(alertType)) return null;

  if (callerRole === "child") {
    if (!CHILD_WRITABLE_ALERT_TYPES.has(alertType)) return null;
    if (input.requestedChildUserId && input.requestedChildUserId !== callerUserId) return null;
    return { callerRole, childUserId: callerUserId };
  }

  if (!PARENT_WRITABLE_ALERT_TYPES.has(alertType)) return null;
  if (!input.requestedChildUserId) return { callerRole, childUserId: null };
  const child = await db
    .prepare(
      `SELECT 1 AS ok FROM family_members
        WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1
        LIMIT 1`,
    )
    .bind(familyId, input.requestedChildUserId)
    .first<{ ok: number }>();
  return child ? { callerRole, childUserId: input.requestedChildUserId } : null;
}
