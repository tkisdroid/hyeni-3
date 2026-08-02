export interface MemoThreadScope {
  familyId: string;
  childMemberId: string;
  childUserId: string;
  childName: string;
  callerRole: "parent" | "child";
}

// 메모는 family_members.id 기준 아이별 1:1 스레드다. 요청 body의 role/user는
// 신뢰하지 않고 현재 활성 membership과 주보호자 소유권에서만 호출자 범위를 계산한다.
export async function resolveMemoThreadScope(
  db: D1Database,
  callerUserId: string,
  familyId: string,
  childMemberId: string,
): Promise<MemoThreadScope | null> {
  if (!callerUserId || !familyId || !childMemberId) return null;

  const row = await db
    .prepare(
      `SELECT child.id AS child_member_id,
              child.user_id AS child_user_id,
              child.name AS child_name,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM families
                   WHERE id = ?1 AND parent_id = ?3
                ) THEN 'parent'
                WHEN EXISTS (
                  SELECT 1 FROM family_members caller_parent
                   WHERE caller_parent.family_id = ?1
                     AND caller_parent.user_id = ?3
                     AND caller_parent.role = 'parent'
                     AND caller_parent.is_active = 1
                ) THEN 'parent'
                WHEN child.user_id = ?3 THEN 'child'
                ELSE NULL
              END AS caller_role
         FROM family_members child
        WHERE child.family_id = ?1
          AND child.id = ?2
          AND child.role = 'child'
          AND child.is_active = 1
          AND child.user_id IS NOT NULL
          AND child.user_id <> ''
        LIMIT 1`,
    )
    .bind(familyId, childMemberId, callerUserId)
    .first<{
      child_member_id: string;
      child_user_id: string;
      child_name: string | null;
      caller_role: string | null;
    }>();

  if (!row || (row.caller_role !== "parent" && row.caller_role !== "child")) return null;
  return {
    familyId,
    childMemberId: row.child_member_id,
    childUserId: row.child_user_id,
    childName: String(row.child_name ?? "아이"),
    callerRole: row.caller_role,
  };
}
