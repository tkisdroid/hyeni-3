import type { FamilyMember } from "@/lib/api/endpoints/family";

/** child_user_id 힌트(member id 또는 user_id) -> 대상 아이 member id 해석. 첫째 폴백 금지. */
export function resolveDailySupplyChildMemberId(
  members: FamilyMember[],
  role: string | null,
  userId: string | null,
  hint: string | null | undefined,
): string | null {
  const children = members.filter((m) => m.role === "child");
  if (hint) {
    const byMember = children.find((m) => m.id === hint);
    if (byMember) return byMember.id;
    const byUser = children.find((m) => m.user_id === hint);
    if (byUser) return byUser.id;
  }
  if (role === "child" && userId) {
    const own = children.find((m) => m.user_id === userId);
    if (own) return own.id;
  }
  return null;
}
