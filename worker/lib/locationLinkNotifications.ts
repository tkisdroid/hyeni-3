import { pgTs } from "./time";

/** 새 연결 상태가 확인되면 같은 아이의 반대 상태를 표시할 미전달 알림만 만료한다. */
export async function expireSupersededLocationLinkNotifications(
  db: D1Database,
  input: { familyId: string; childUserId: string; nextState: "connected" | "stale"; nowMs: number },
): Promise<void> {
  const alertType = input.nextState === "connected" ? "location_stale" : "location_recovered";
  const now = pgTs(new Date(input.nowMs));
  await db.prepare(
    `UPDATE pending_notifications SET expires_at=?
      WHERE family_id=? AND delivered=0
        AND (expires_at IS NULL OR replace(substr(expires_at,1,19),'T',' ')>substr(?,1,19))
        AND json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.alertId') IN (
          SELECT id FROM parent_alerts WHERE family_id=? AND child_user_id=? AND alert_type=?
        )`,
  ).bind(now, input.familyId, now, input.familyId, input.childUserId, alertType).run();
}
