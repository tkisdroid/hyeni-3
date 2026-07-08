import type { ApiUser } from "@/lib/api/session";

function firstText(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function mergeApiUserWithTokenUser(user: ApiUser | null, tokenUser: ApiUser | null): ApiUser | null {
  if (!user) return tokenUser;
  if (!tokenUser || tokenUser.id !== user.id) return user;

  const tokenFamilyId = firstText(
    tokenUser.family_id,
    tokenUser.app_metadata?.family_id,
    tokenUser.user_metadata?.family_id,
  );
  const tokenRole = firstText(tokenUser.role, tokenUser.app_metadata?.role, tokenUser.user_metadata?.role);
  const nextFamilyId = firstText(user.family_id, user.app_metadata?.family_id, user.user_metadata?.family_id, tokenFamilyId);
  const nextRole = firstText(user.role, user.app_metadata?.role, user.user_metadata?.role, tokenRole);

  if (
    user.family_id === nextFamilyId &&
    user.role === nextRole &&
    user.app_metadata?.family_id === nextFamilyId &&
    user.app_metadata?.role === nextRole &&
    user.user_metadata?.family_id === nextFamilyId &&
    user.user_metadata?.role === nextRole
  ) {
    return user;
  }

  return {
    ...user,
    ...(nextFamilyId ? { family_id: nextFamilyId } : {}),
    ...(nextRole ? { role: nextRole } : {}),
    app_metadata: {
      ...user.app_metadata,
      ...(nextFamilyId ? { family_id: nextFamilyId } : {}),
      ...(nextRole ? { role: nextRole } : {}),
    },
    user_metadata: {
      ...user.user_metadata,
      ...(nextFamilyId ? { family_id: nextFamilyId } : {}),
      ...(nextRole ? { role: nextRole } : {}),
    },
  };
}

