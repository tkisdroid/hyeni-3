import type { Env } from "../types";
import { revokeFamilyRealtimeUsers } from "./realtime.ts";

interface SupersedeActiveChildrenInput {
  familyId: string;
  keepUserId: string;
  name: string;
}

export async function supersedeActiveChildren(
  env: Pick<Env, "DB" | "FAMILY_ROOM">,
  input: SupersedeActiveChildrenInput,
): Promise<string[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT user_id FROM family_members
        WHERE family_id = ? AND role = 'child' AND is_active = 1
          AND user_id IS NOT NULL AND user_id <> ? AND name = ?
        ORDER BY user_id ASC`,
    )
    .bind(input.familyId, input.keepUserId, input.name)
    .all<{ user_id: string }>();
  const supersededUserIds = [...new Set(
    (results ?? []).map((row) => String(row.user_id ?? "").trim()).filter(Boolean),
  )];
  if (supersededUserIds.length === 0) return [];

  await env.DB
    .prepare(
      `UPDATE family_members SET is_active = 0
        WHERE family_id = ? AND role = 'child' AND is_active = 1
          AND user_id IS NOT NULL AND user_id <> ? AND name = ?`,
    )
    .bind(input.familyId, input.keepUserId, input.name)
    .run();

  // 권한 정본은 위 UPDATE 즉시 반영되어 이후 audience에서 제외된다. DO 퇴출도
  // 같은 요청 안에서 기다리되 일시적 DO 장애가 페어링 자체를 부분 실패시키진 않는다.
  try {
    await revokeFamilyRealtimeUsers(env, input.familyId, supersededUserIds);
  } catch (error) {
    console.error("[realtime] superseded socket revoke failed");
  }
  return supersededUserIds;
}
