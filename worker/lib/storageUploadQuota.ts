export const STORAGE_UPLOAD_DAILY_OBJECT_LIMIT = 200;
export const STORAGE_UPLOAD_DAILY_BYTE_LIMIT = 256 * 1024 * 1024;

export interface StorageUploadQuotaClaim {
  userId: string;
  dayKey: string;
  byteCount: number;
}

export interface FamilyStorageUploadQuotaClaim {
  familyId: string;
  dayKey: string;
  byteCount: number;
}

export interface StorageUploadQuotaScopeClaims {
  user: StorageUploadQuotaClaim;
  family?: FamilyStorageUploadQuotaClaim;
}

export type StorageUploadQuotaResult =
  | { status: "claimed"; claim: StorageUploadQuotaClaim }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

export type StorageUploadQuotaScopesResult =
  | { status: "claimed"; claims: StorageUploadQuotaScopeClaims }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/**
 * 검증된 실제 body 크기를 사용자별 UTC 일일 사용량에 원자 claim한다.
 * 운영 migration이 누락됐거나 D1이 실패하면 저장을 열지 않고 unavailable로 닫는다.
 */
export async function claimStorageUploadQuota(
  db: D1Database,
  userId: string,
  byteCount: number,
  now = new Date(),
): Promise<StorageUploadQuotaResult> {
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedBytes = Number(byteCount);
  if (
    !normalizedUserId
    || !Number.isSafeInteger(normalizedBytes)
    || normalizedBytes <= 0
    || normalizedBytes > STORAGE_UPLOAD_DAILY_BYTE_LIMIT
  ) {
    return { status: "limited", retryAfterSeconds: secondsUntilNextUtcDay(now) };
  }

  const dayKey = utcDayKey(now);
  try {
    const result = await db
      .prepare(
        `INSERT INTO storage_upload_daily_usage
           (user_id, day_key, object_count, byte_count, updated_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(user_id, day_key) DO UPDATE SET
           object_count = object_count + 1,
           byte_count = byte_count + excluded.byte_count,
           updated_at = excluded.updated_at
         WHERE object_count < ? AND byte_count <= ?`,
      )
      .bind(
        normalizedUserId,
        dayKey,
        normalizedBytes,
        now.toISOString(),
        STORAGE_UPLOAD_DAILY_OBJECT_LIMIT,
        STORAGE_UPLOAD_DAILY_BYTE_LIMIT - normalizedBytes,
      )
      .run();
    if (Number(result.meta?.changes ?? 0) !== 1) {
      return { status: "limited", retryAfterSeconds: secondsUntilNextUtcDay(now) };
    }
    return {
      status: "claimed",
      claim: { userId: normalizedUserId, dayKey, byteCount: normalizedBytes },
    };
  } catch (error) {
    console.error("[storage-quota] claim failed");
    return { status: "unavailable" };
  }
}

/** R2 저장이 확정되지 않은 claim만 되돌린다. 실패하면 보수적으로 quota를 소비한다. */
export async function releaseStorageUploadQuota(
  db: D1Database,
  claim: StorageUploadQuotaClaim,
  now = new Date(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE storage_upload_daily_usage
          SET object_count = MAX(object_count - 1, 0),
              byte_count = MAX(byte_count - ?, 0),
              updated_at = ?
        WHERE user_id = ? AND day_key = ?`,
    )
    .bind(claim.byteCount, now.toISOString(), claim.userId, claim.dayKey)
    .run();
}

async function claimFamilyStorageUploadQuota(
  db: D1Database,
  familyId: string,
  byteCount: number,
  now: Date,
): Promise<
  | { status: "claimed"; claim: FamilyStorageUploadQuotaClaim }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" }
> {
  const normalizedFamilyId = String(familyId ?? "").trim();
  if (!normalizedFamilyId) return { status: "unavailable" };

  const dayKey = utcDayKey(now);
  try {
    const result = await db
      .prepare(
        `INSERT INTO storage_upload_family_daily_usage
           (family_id, day_key, object_count, byte_count, updated_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(family_id, day_key) DO UPDATE SET
           object_count = object_count + 1,
           byte_count = byte_count + excluded.byte_count,
           updated_at = excluded.updated_at
         WHERE object_count < ? AND byte_count <= ?`,
      )
      .bind(
        normalizedFamilyId,
        dayKey,
        byteCount,
        now.toISOString(),
        STORAGE_UPLOAD_DAILY_OBJECT_LIMIT,
        STORAGE_UPLOAD_DAILY_BYTE_LIMIT - byteCount,
      )
      .run();
    if (Number(result.meta?.changes ?? 0) !== 1) {
      return { status: "limited", retryAfterSeconds: secondsUntilNextUtcDay(now) };
    }
    return {
      status: "claimed",
      claim: { familyId: normalizedFamilyId, dayKey, byteCount },
    };
  } catch (error) {
    console.error("[storage-quota] family claim failed");
    return { status: "unavailable" };
  }
}

async function releaseFamilyStorageUploadQuota(
  db: D1Database,
  claim: FamilyStorageUploadQuotaClaim,
  now: Date,
): Promise<void> {
  await db
    .prepare(
      `UPDATE storage_upload_family_daily_usage
          SET object_count = MAX(object_count - 1, 0),
              byte_count = MAX(byte_count - ?, 0),
              updated_at = ?
        WHERE family_id = ? AND day_key = ?`,
    )
    .bind(claim.byteCount, now.toISOString(), claim.familyId, claim.dayKey)
    .run();
}

/**
 * 가족 사진은 사용자와 가족 quota를 모두 claim한다. 가족 claim 실패 시 선행 사용자
 * claim을 되돌려 정상 사용자의 quota를 소모하지 않되, rollback 실패는 보수적으로 소비한다.
 * 가족이 없는 선생님 첨부는 사용자 quota만 적용한다.
 */
export async function claimStorageUploadQuotaScopes(
  db: D1Database,
  input: {
    userId: string;
    familyId: string | null;
    byteCount: number;
    now?: Date;
  },
): Promise<StorageUploadQuotaScopesResult> {
  const now = input.now ?? new Date();
  const userResult = await claimStorageUploadQuota(db, input.userId, input.byteCount, now);
  if (userResult.status !== "claimed") return userResult;

  const normalizedFamilyId = String(input.familyId ?? "").trim();
  if (!normalizedFamilyId) {
    return { status: "claimed", claims: { user: userResult.claim } };
  }

  const familyResult = await claimFamilyStorageUploadQuota(
    db,
    normalizedFamilyId,
    input.byteCount,
    now,
  );
  if (familyResult.status !== "claimed") {
    try {
      await releaseStorageUploadQuota(db, userResult.claim, now);
    } catch (error) {
      console.error("[storage-quota] user rollback after family claim failed");
    }
    return familyResult;
  }

  return {
    status: "claimed",
    claims: { user: userResult.claim, family: familyResult.claim },
  };
}

/** R2 저장이 확정되지 않은 모든 scope claim을 각각 되돌린다. */
export async function releaseStorageUploadQuotaScopes(
  db: D1Database,
  claims: StorageUploadQuotaScopeClaims,
  now = new Date(),
): Promise<void> {
  let firstError: unknown;
  if (claims.family) {
    try {
      await releaseFamilyStorageUploadQuota(db, claims.family, now);
    } catch (error) {
      firstError = error;
    }
  }
  try {
    await releaseStorageUploadQuota(db, claims.user, now);
  } catch (error) {
    firstError ??= error;
  }
  if (firstError) throw firstError;
}

/** 오래된 일일 원장은 best-effort로 정리하며, 실패가 업로드나 다른 cron을 막지 않는다. */
export async function cleanupStorageUploadDailyUsage(
  db: D1Database,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let removed = 0;
  try {
    const result = await db
      .prepare("DELETE FROM storage_upload_daily_usage WHERE day_key < ?")
      .bind(cutoff)
      .run();
    removed += Number(result.meta?.changes ?? 0);
  } catch (error) {
    console.error("[storage-quota] user cleanup failed");
  }
  try {
    const result = await db
      .prepare("DELETE FROM storage_upload_family_daily_usage WHERE day_key < ?")
      .bind(cutoff)
      .run();
    removed += Number(result.meta?.changes ?? 0);
  } catch (error) {
    console.error("[storage-quota] family cleanup failed");
  }
  return removed;
}
