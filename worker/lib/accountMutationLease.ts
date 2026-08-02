const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MUTATION_LEASE_TTL_MS = 60 * 60 * 1000;

export interface AccountMutationLease {
  id: string;
  userId: string;
  familyId: string | null;
  expiresAt: string;
}

export type AccountMutationLeaseResult =
  | { status: "acquired"; lease: AccountMutationLease }
  | { status: "blocked" }
  | { status: "unavailable" };

/**
 * 사용자/가족 mutation과 account deletion claim이 D1의 조건부 INSERT로 한 순서를 갖게 한다.
 * lease가 먼저면 삭제가 재시도되고, deletion scope가 먼저면 새 mutation은 시작하지 않는다.
 */
export async function acquireAccountMutationLease(
  db: D1Database,
  input: { userId: string; familyId?: string | null; now?: Date },
): Promise<AccountMutationLeaseResult> {
  const userId = String(input.userId ?? "").trim();
  const familyId = String(input.familyId ?? "").trim() || null;
  if (!SAFE_ID.test(userId) || (familyId !== null && !SAFE_ID.test(familyId))) {
    return { status: "unavailable" };
  }
  const now = input.now ?? new Date();
  const lease: AccountMutationLease = {
    id: crypto.randomUUID(),
    userId,
    familyId,
    expiresAt: new Date(now.getTime() + MUTATION_LEASE_TTL_MS).toISOString(),
  };
  try {
    const result = await db
      .prepare(
        `INSERT INTO account_mutation_leases(id,user_id,family_id,expires_at,created_at)
         SELECT ?,?,?,?,?
          WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
            AND NOT EXISTS(
              SELECT 1 FROM account_deletion_scopes
               WHERE (scope_type='user' AND scope_id=?)
                  OR (? IS NOT NULL AND scope_type='family' AND scope_id=?)
            )
            AND NOT EXISTS(
              SELECT 1 FROM family_unpair_cleanup_jobs
               WHERE child_user_id=?
                 AND (? IS NULL OR family_id=?)
            )`,
      )
      .bind(
        lease.id,
        lease.userId,
        lease.familyId,
        lease.expiresAt,
        now.toISOString(),
        lease.userId,
        lease.userId,
        lease.familyId,
        lease.familyId,
        lease.userId,
        lease.familyId,
        lease.familyId,
      )
      .run();
    return Number(result.meta?.changes ?? 0) === 1
      ? { status: "acquired", lease }
      : { status: "blocked" };
  } catch (error) {
    console.error("[account-mutation-lease] acquire failed");
    return { status: "unavailable" };
  }
}

export async function releaseAccountMutationLease(
  db: D1Database,
  leaseId: string,
): Promise<void> {
  if (!SAFE_ID.test(leaseId)) return;
  await db.prepare("DELETE FROM account_mutation_leases WHERE id=?").bind(leaseId).run();
}

export async function cleanupExpiredAccountMutationLeases(
  db: D1Database,
  now = new Date(),
): Promise<number> {
  const result = await db
    .prepare("DELETE FROM account_mutation_leases WHERE expires_at<=?")
    .bind(now.toISOString())
    .run();
  return Number(result.meta?.changes ?? 0);
}
