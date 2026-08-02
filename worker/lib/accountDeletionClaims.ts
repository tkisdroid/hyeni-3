const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type AccountDeletionMode = "family" | "self";
export type AccountDeletionMutationState = "clear" | "blocked" | "unavailable";

export interface AccountDeletionClaim {
  jobId: string;
  ownerUserId: string;
  mode: AccountDeletionMode;
  userIds: string[];
  familyIds: string[];
  status: "claimed" | "running" | "completed";
}

export type BeginAccountDeletionClaimResult =
  | { status: "claimed"; claim: AccountDeletionClaim }
  | { status: "conflict" }
  | { status: "unavailable" };

interface JobRow {
  id: string;
  owner_user_id: string;
  mode: AccountDeletionMode;
  status: "claimed" | "running" | "completed";
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function validIds(values: readonly string[]): boolean {
  return values.every((value) => SAFE_ID.test(value));
}

async function readClaim(db: D1Database, job: JobRow): Promise<AccountDeletionClaim> {
  const { results } = await db
    .prepare(
      `SELECT scope_type, scope_id
         FROM account_deletion_scopes
        WHERE job_id=?
        ORDER BY scope_type, scope_id`,
    )
    .bind(job.id)
    .all<{ scope_type: "user" | "family"; scope_id: string }>();
  return {
    jobId: job.id,
    ownerUserId: job.owner_user_id,
    mode: job.mode,
    userIds: uniqueIds(
      (results ?? []).filter((row) => row.scope_type === "user").map((row) => row.scope_id),
    ),
    familyIds: uniqueIds(
      (results ?? []).filter((row) => row.scope_type === "family").map((row) => row.scope_id),
    ),
    status: job.status,
  };
}

export async function beginAccountDeletionClaim(
  db: D1Database,
  input: { ownerUserId: string },
): Promise<BeginAccountDeletionClaimResult> {
  const ownerUserId = String(input.ownerUserId ?? "").trim();
  if (!SAFE_ID.test(ownerUserId)) return { status: "unavailable" };

  try {
    const existing = await db
      .prepare("SELECT id,owner_user_id,mode,status FROM account_deletion_jobs WHERE owner_user_id=? LIMIT 1")
      .bind(ownerUserId)
      .first<JobRow>();
    if (existing) return { status: "claimed", claim: await readClaim(db, existing) };

    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      db.prepare(
        `INSERT INTO account_deletion_jobs
           (id,owner_user_id,mode,status,attempts,last_error,created_at,updated_at)
         SELECT ?,?,
                CASE WHEN EXISTS(SELECT 1 FROM families WHERE parent_id=?)
                     THEN 'family' ELSE 'self' END,
                'claimed',0,NULL,?,?
          WHERE EXISTS(SELECT 1 FROM users WHERE id=? )
            AND NOT EXISTS (
              SELECT 1 FROM family_unpair_cleanup_jobs
               WHERE child_user_id=?
                  OR family_id IN (SELECT id FROM families WHERE parent_id=?)
            )
            AND NOT EXISTS (
              SELECT 1 FROM account_mutation_leases
               WHERE expires_at>?
                 AND (
                   user_id=?
                   OR family_id IN (SELECT id FROM families WHERE parent_id=?)
                   OR family_id IN (
                     SELECT family_id FROM family_members
                      WHERE user_id=? AND is_active=1
                   )
                 )
            )
            AND NOT EXISTS (
              SELECT 1 FROM storage_invalid_upload_cleanup_jobs
               WHERE committed_at IS NULL AND cleaned_at IS NULL
                 AND (user_id=?
                  OR family_id IN (SELECT id FROM families WHERE parent_id=?)
                  OR family_id IN (
                    SELECT family_id FROM family_members
                     WHERE user_id=? AND is_active=1
                  ))
            )
         ON CONFLICT(owner_user_id) DO NOTHING`,
      ).bind(
        jobId,
        ownerUserId,
        ownerUserId,
        now,
        now,
        ownerUserId,
        ownerUserId,
        ownerUserId,
        now,
        ownerUserId,
        ownerUserId,
        ownerUserId,
        ownerUserId,
        ownerUserId,
        ownerUserId,
      ),
      db.prepare(
        `INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at)
         SELECT ?,'user',?,?
          WHERE EXISTS(SELECT 1 FROM account_deletion_jobs WHERE id=?)`,
      ).bind(jobId, ownerUserId, now, jobId),
      db.prepare(
        `INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at)
         SELECT ?,'family',f.id,?
           FROM families f
          WHERE f.parent_id=?
            AND EXISTS(SELECT 1 FROM account_deletion_jobs WHERE id=?)`,
      ).bind(jobId, now, ownerUserId, jobId),
    ];
    const results = await db.batch(statements);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
      const raced = await db
        .prepare("SELECT id,owner_user_id,mode,status FROM account_deletion_jobs WHERE owner_user_id=? LIMIT 1")
        .bind(ownerUserId)
        .first<JobRow>();
      return raced
        ? { status: "claimed", claim: await readClaim(db, raced) }
        : { status: "conflict" };
    }
    if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
      return { status: "unavailable" };
    }
    const created = await db
      .prepare("SELECT id,owner_user_id,mode,status FROM account_deletion_jobs WHERE id=? LIMIT 1")
      .bind(jobId)
      .first<JobRow>();
    return created
      ? { status: "claimed", claim: await readClaim(db, created) }
      : { status: "unavailable" };
  } catch (error) {
    console.error("[account-deletion-claim] begin failed");
    try {
      const existing = await db
        .prepare("SELECT id,owner_user_id,mode,status FROM account_deletion_jobs WHERE owner_user_id=? LIMIT 1")
        .bind(ownerUserId)
        .first<JobRow>();
      if (existing) return { status: "claimed", claim: await readClaim(db, existing) };
    } catch {
      // migration 누락과 D1 장애는 쓰기 경계를 열지 않는다.
    }
    return { status: "unavailable" };
  }
}

const MANAGED_CHILD_EVIDENCE_SQL = `
  EXISTS(
    SELECT 1 FROM family_members fm
     WHERE fm.user_id=?1
       AND NOT EXISTS (
         SELECT 1 FROM families owned
          WHERE owned.id=fm.family_id AND owned.parent_id=?2
       )
  )
  OR EXISTS(SELECT 1 FROM families WHERE parent_id=?1)
  OR EXISTS(SELECT 1 FROM teacher_profiles WHERE user_id=?1)
  OR EXISTS(SELECT 1 FROM auth_identities WHERE user_id=?1)
  OR EXISTS(
    SELECT 1 FROM user_profiles
     WHERE user_id=?1 AND (COALESCE(login_id,'')<>'' OR COALESCE(phone,'')<>'')
  )
  OR EXISTS(
    SELECT 1 FROM users
     WHERE id=?1 AND (
       COALESCE(email,'')<>'' OR COALESCE(phone,'')<>'' OR COALESCE(encrypted_password,'')<>''
     )
  )
  OR EXISTS(
    SELECT 1 FROM refresh_tokens
     WHERE user_id=?1 AND (
       family_id IS NULL OR family_id=''
       OR NOT EXISTS (
         SELECT 1 FROM families owned
          WHERE owned.id=refresh_tokens.family_id AND owned.parent_id=?2
       )
     )
  )`;

export async function hasIndependentManagedChildEvidence(
  db: D1Database,
  ownerUserId: string,
  childUserId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT CASE WHEN ${MANAGED_CHILD_EVIDENCE_SQL} THEN 1 ELSE 0 END AS has_evidence`)
    .bind(childUserId, ownerUserId)
    .first<{ has_evidence: number }>();
  return !row || Number(row.has_evidence) !== 0;
}

export async function claimManagedChildForAccountDeletion(
  db: D1Database,
  input: { jobId: string; ownerUserId: string; childUserId: string },
): Promise<boolean> {
  const { jobId, ownerUserId, childUserId } = input;
  if (![jobId, ownerUserId, childUserId].every((value) => SAFE_ID.test(value))) return false;
  const existing = await db
    .prepare(
      `SELECT job_id FROM account_deletion_scopes
        WHERE scope_type='user' AND scope_id=? LIMIT 1`,
    )
    .bind(childUserId)
    .first<{ job_id: string }>();
  if (existing) return existing.job_id === jobId;

  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at)
       SELECT ?3,'user',?1,?4
        WHERE EXISTS(
          SELECT 1 FROM account_deletion_jobs
           WHERE id=?3 AND owner_user_id=?2 AND mode='family'
        )
          AND NOT (${MANAGED_CHILD_EVIDENCE_SQL})
          AND NOT EXISTS(
            SELECT 1 FROM family_unpair_cleanup_jobs WHERE child_user_id=?1
          )
          AND NOT EXISTS(
            SELECT 1 FROM account_mutation_leases lease
             WHERE lease.expires_at>?4
               AND (
                 lease.user_id=?1
                 OR lease.family_id IN (
                   SELECT scope_id FROM account_deletion_scopes
                    WHERE job_id=?3 AND scope_type='family'
                 )
               )
          )
          AND NOT EXISTS(
            SELECT 1 FROM account_deletion_scopes
             WHERE scope_type='user' AND scope_id=?1
          )
          AND NOT EXISTS(
            SELECT 1 FROM storage_invalid_upload_cleanup_jobs
             WHERE committed_at IS NULL AND cleaned_at IS NULL
               AND (user_id=?1
                OR family_id IN (
                  SELECT scope_id FROM account_deletion_scopes
                   WHERE job_id=?3 AND scope_type='family'
                ))
          )`,
    )
    .bind(childUserId, ownerUserId, jobId, now)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function releaseManagedChildAccountDeletionClaim(
  db: D1Database,
  jobId: string,
  childUserId: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM account_deletion_scopes
        WHERE job_id=? AND scope_type='user' AND scope_id=?`,
    )
    .bind(jobId, childUserId)
    .run();
}

export async function accountDeletionMutationState(
  db: D1Database,
  input: { userIds?: readonly string[]; familyIds?: readonly string[] },
): Promise<AccountDeletionMutationState> {
  const userIds = uniqueIds([...(input.userIds ?? [])]);
  const familyIds = uniqueIds([...(input.familyIds ?? [])]);
  if (!validIds(userIds) || !validIds(familyIds)) return "unavailable";
  if (userIds.length === 0 && familyIds.length === 0) return "clear";
  const predicates: string[] = [];
  const bindings: string[] = [];
  if (userIds.length > 0) {
    predicates.push(`(scope_type='user' AND scope_id IN (${userIds.map(() => "?").join(",")}))`);
    bindings.push(...userIds);
  }
  if (familyIds.length > 0) {
    predicates.push(`(scope_type='family' AND scope_id IN (${familyIds.map(() => "?").join(",")}))`);
    bindings.push(...familyIds);
  }
  try {
    const row = await db
      .prepare(`SELECT 1 AS blocked FROM account_deletion_scopes WHERE ${predicates.join(" OR ")} LIMIT 1`)
      .bind(...bindings)
      .first<{ blocked: number }>();
    return row ? "blocked" : "clear";
  } catch (error) {
    console.error("[account-deletion-claim] mutation check failed");
    return "unavailable";
  }
}

export async function markAccountDeletionFailure(
  db: D1Database,
  jobId: string,
  errorCode: string,
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE account_deletion_jobs
            SET status='claimed', attempts=attempts+1, last_error=?, updated_at=?
          WHERE id=? AND status<>'completed'`,
      )
      .bind(errorCode, new Date().toISOString(), jobId)
      .run();
  } catch {
    // claim은 그대로 남아 mutation을 fail-closed한다.
  }
}

export function completeAccountDeletionClaimStmts(
  db: D1Database,
  jobId: string,
): D1PreparedStatement[] {
  return [
    db.prepare(
      `UPDATE account_deletion_jobs
          SET status='completed',last_error=NULL,updated_at=?
        WHERE id=?`,
    ).bind(new Date().toISOString(), jobId),
  ];
}

/** access JWT(1h)와 비정상 종료 lease보다 충분히 긴 24시간 뒤 완료 tombstone을 회수한다. */
export async function cleanupCompletedAccountDeletionClaims(
  db: D1Database,
  now = new Date(),
): Promise<{ scopes: number; jobs: number }> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const results = await db.batch([
    db.prepare(
      `DELETE FROM account_deletion_scopes
        WHERE job_id IN (
          SELECT id FROM account_deletion_jobs
           WHERE status='completed' AND updated_at<=?
        )`,
    ).bind(cutoff),
    db.prepare(
      `DELETE FROM account_deletion_jobs
        WHERE status='completed' AND updated_at<=?`,
    ).bind(cutoff),
  ]);
  return {
    scopes: Number(results[0]?.meta?.changes ?? 0),
    jobs: Number(results[1]?.meta?.changes ?? 0),
  };
}
