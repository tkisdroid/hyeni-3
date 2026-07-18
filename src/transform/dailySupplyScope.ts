import type { FamilyMember } from "@/lib/api/endpoints/family";

/** child_user_id 힌트(member id 또는 user_id) -> 대상 아이 member id 해석. 첫째 폴백 금지. */
export function resolveDailySupplyChildMemberId(
  members: FamilyMember[],
  role: string | null,
  userId: string | null,
  hint: string | null | undefined,
): string | null {
  const children = members.filter((m) => m.role === "child");
  // 아이 세션은 외부 힌트를 신뢰하지 않고 인증 사용자와 연결된 본인 행만 사용한다.
  if (role === "child") {
    if (!userId) return null;
    return children.find((m) => m.user_id === userId)?.id ?? null;
  }
  if (hint) {
    const byMember = children.find((m) => m.id === hint);
    if (byMember) return byMember.id;
    const byUser = children.find((m) => m.user_id === hint);
    if (byUser) return byUser.id;
  }
  return null;
}
