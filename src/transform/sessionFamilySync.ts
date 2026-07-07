import type { ApiUser } from "@/lib/api/session";

export interface FamilyMineSessionSnapshot {
  familyId: string;
  myRole: "parent" | "child" | null;
}

export function reconcileApiUserWithFamilyMine(
  user: ApiUser | null,
  snapshot: FamilyMineSessionSnapshot,
): ApiUser | null {
  const familyId = snapshot.familyId.trim();
  if (!user || !familyId) return user;

  const role = snapshot.myRole ?? null;
  const nextFamilyId = familyId;
  const nextRole = role ?? user.role ?? user.app_metadata?.role ?? user.user_metadata?.role;
  const currentFamilyId = user.family_id ?? user.app_metadata?.family_id ?? user.user_metadata?.family_id ?? null;
  const currentRole = user.role ?? user.app_metadata?.role ?? user.user_metadata?.role ?? null;

  if (currentFamilyId === nextFamilyId && currentRole === nextRole) return user;

  return {
    ...user,
    family_id: nextFamilyId,
    role: nextRole,
    app_metadata: {
      ...user.app_metadata,
      family_id: nextFamilyId,
      role: nextRole,
    },
    user_metadata: {
      ...user.user_metadata,
      family_id: nextFamilyId,
      role: nextRole,
    },
  };
}
