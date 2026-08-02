import {
  acquireAccountMutationLease,
  releaseAccountMutationLease,
  type AccountMutationLease,
  type AccountMutationLeaseResult,
} from "./accountMutationLease";

export interface AccountMutationScope {
  userId: string;
  familyId?: string | null;
}

/** 가족 알림이 닿을 수 있는 주보호자·활성 공동부모와 명시 대상 사용자를 고정한다. */
export async function loadFamilyNotificationMutationScopes(
  db: D1Database,
  familyId: string,
  targetUserIds: Iterable<string> = [],
): Promise<AccountMutationScope[] | null> {
  const family = await db
    .prepare("SELECT parent_id FROM families WHERE id=? LIMIT 1")
    .bind(familyId)
    .first<{ parent_id: string }>();
  if (!family?.parent_id) return null;
  const scopes: AccountMutationScope[] = [{ userId: family.parent_id, familyId }];
  const { results } = await db
    .prepare(
      `SELECT user_id FROM family_members
        WHERE family_id=? AND role='parent' AND is_active=1 AND user_id IS NOT NULL`,
    )
    .bind(familyId)
    .all<{ user_id: string }>();
  for (const row of results ?? []) {
    if (row.user_id) scopes.push({ userId: String(row.user_id), familyId });
  }
  for (const userId of targetUserIds) {
    if (userId) scopes.push({ userId: String(userId), familyId });
  }
  return scopes;
}

export type AccountMutationScopeLeaseResult =
  | { status: "acquired"; leases: AccountMutationLease[] }
  | { status: "blocked" | "unavailable"; leases: [] };

/** lease 획득 뒤 다시 읽어, 이미 완료된 unpair의 캐시 대상 쓰기를 차단한다. */
export async function isActiveChildMutationTarget(
  db: D1Database,
  familyId: string,
  childUserId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM family_members
        WHERE family_id=? AND user_id=? AND role='child' AND is_active=1
        LIMIT 1`,
    )
    .bind(familyId, childUserId)
    .first<{ ok: number }>();
  return Boolean(row?.ok);
}

export async function isActiveChildMemberMutationTarget(
  db: D1Database,
  familyId: string,
  childMemberId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM family_members
        WHERE family_id=? AND id=? AND role='child' AND is_active=1
        LIMIT 1`,
    )
    .bind(familyId, childMemberId)
    .first<{ ok: number }>();
  return Boolean(row?.ok);
}

/** 여러 사용자/가족 범위를 전부 잡거나, 이미 잡은 lease를 원복하고 실패한다. */
export async function acquireAccountMutationLeases(
  db: D1Database,
  scopes: AccountMutationScope[],
): Promise<AccountMutationScopeLeaseResult> {
  const unique = new Map<string, AccountMutationScope>();
  for (const scope of scopes) {
    const userId = String(scope.userId ?? "").trim();
    const familyId = String(scope.familyId ?? "").trim() || null;
    unique.set(`${userId}\u0000${familyId ?? ""}`, { userId, familyId });
  }

  const leases: AccountMutationLease[] = [];
  for (const scope of unique.values()) {
    const result: AccountMutationLeaseResult = await acquireAccountMutationLease(db, scope);
    if (result.status === "acquired") {
      leases.push(result.lease);
      continue;
    }
    await releaseAccountMutationLeases(db, leases);
    return { status: result.status, leases: [] };
  }
  return { status: "acquired", leases };
}

export async function releaseAccountMutationLeases(
  db: D1Database,
  leases: AccountMutationLease[],
): Promise<void> {
  for (const lease of [...leases].reverse()) {
    try {
      await releaseAccountMutationLease(db, lease.id);
    } catch (error) {
      console.error("[account-mutation-scope] lease release failed");
    }
  }
}
