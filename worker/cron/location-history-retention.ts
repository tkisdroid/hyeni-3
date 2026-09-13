import type { Env } from "../types";
import {
  premiumFamilyEntitlementSql,
  resolveFamilyEntitlement,
} from "../shared/subscriptionEntitlement.js";

export const PREMIUM_LOCATION_HISTORY_RETENTION_DAYS = 30;
export const LOCATION_HISTORY_RETENTION_DELETE_BATCH = 5_000;

// Free D1 호출당 50 queries 기준: 후보 조회 1 + 가족별 엔타이틀먼트 4·삭제 1 + 고아 삭제 1.
const D1_FREE_QUERY_LIMIT = 50;
const LOCATION_HISTORY_RETENTION_FIXED_QUERY_COUNT = 2;
const LOCATION_HISTORY_RETENTION_QUERY_COUNT_PER_FAMILY = 5;
export const LOCATION_HISTORY_RETENTION_FAMILY_BATCH = Math.floor(
  (D1_FREE_QUERY_LIMIT - LOCATION_HISTORY_RETENTION_FIXED_QUERY_COUNT)
    / LOCATION_HISTORY_RETENTION_QUERY_COUNT_PER_FAMILY,
);

const KST_OFFSET_MS = 9 * 60 * 60_000;
const HISTORY_DAY_START_HOUR = 8;

type RetentionTier = "free" | "premium";
type EntitlementResult = { isPremium: boolean };
type EntitlementResolver = (
  db: D1Database,
  familyId: string,
  now: Date,
) => Promise<EntitlementResult>;

export interface LocationHistoryRetentionResult {
  removedRows: number;
  processedFamilies: number;
  skippedFamilies: number;
  removedOrphanRows: number;
}

function normalizedTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

export function locationHistoryRetentionCutoff(tier: RetentionTier, now = new Date()): Date {
  if (tier === "premium") {
    return new Date(
      now.getTime() - PREMIUM_LOCATION_HISTORY_RETENTION_DAYS * 24 * 60 * 60_000,
    );
  }

  const nowMs = now.getTime();
  const kst = new Date(nowMs + KST_OFFSET_MS);
  let startMs = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
    HISTORY_DAY_START_HOUR,
  ) - KST_OFFSET_MS;
  if (nowMs < startMs) startMs -= 24 * 60 * 60_000;
  return new Date(startMs);
}

export async function resolveFamilyEntitlementForRetention(
  db: D1Database,
  familyId: string,
  now: Date,
): Promise<EntitlementResult> {
  return await resolveFamilyEntitlement(db, familyId, now);
}

async function deleteFamilyHistoryBefore(
  db: D1Database,
  familyId: string,
  cutoff: Date,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM location_history
        WHERE id IN (
          SELECT id
            FROM location_history INDEXED BY idx_location_history_family_recorded_norm
           WHERE family_id = ?1
             AND substr(recorded_at, 1, 19) < ?2
           ORDER BY substr(recorded_at, 1, 19) ASC, id ASC
           LIMIT ?3
        )`,
    )
    .bind(
      familyId,
      normalizedTimestamp(cutoff),
      LOCATION_HISTORY_RETENTION_DELETE_BATCH,
    )
    .run();
  return Number(result.meta?.changes ?? 0);
}

async function deleteOrphanHistoryBefore(
  db: D1Database,
  cutoff: Date,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM location_history
        WHERE id IN (
          SELECT lh.id
            FROM location_history AS lh INDEXED BY idx_location_history_recorded_family
           WHERE substr(lh.recorded_at, 1, 19) < ?1
             AND NOT EXISTS (SELECT 1 FROM families f WHERE f.id = lh.family_id)
           ORDER BY substr(lh.recorded_at, 1, 19) ASC, lh.id ASC
           LIMIT ?2
        )`,
    )
    .bind(normalizedTimestamp(cutoff), LOCATION_HISTORY_RETENTION_DELETE_BATCH)
    .run();
  return Number(result.meta?.changes ?? 0);
}

export async function cleanupLocationHistoryRetention(
  db: D1Database,
  now = new Date(),
  resolveEntitlement: EntitlementResolver = resolveFamilyEntitlementForRetention,
): Promise<LocationHistoryRetentionResult> {
  const freeCutoff = locationHistoryRetentionCutoff("free", now);
  const premiumCutoff = locationHistoryRetentionCutoff("premium", now);
  const { results } = await db
    .prepare(
      `SELECT f.id AS family_id,
              MIN(substr(lh.recorded_at, 1, 19)) AS oldest_expired_at
         FROM families f
         JOIN location_history AS lh INDEXED BY idx_location_history_family_recorded_norm
           ON lh.family_id = f.id
        WHERE substr(lh.recorded_at, 1, 19) < CASE
          WHEN ${premiumFamilyEntitlementSql("f", "datetime(?4)")} THEN ?1
          ELSE ?2
        END
        GROUP BY f.id
        ORDER BY oldest_expired_at ASC, f.id ASC
        LIMIT ?3`,
    )
    .bind(
      normalizedTimestamp(premiumCutoff),
      normalizedTimestamp(freeCutoff),
      LOCATION_HISTORY_RETENTION_FAMILY_BATCH,
      normalizedTimestamp(now),
    )
    .all<{ family_id: string }>();

  let removedRows = 0;
  let processedFamilies = 0;
  let skippedFamilies = 0;
  for (const row of results ?? []) {
    const familyId = String(row.family_id ?? "");
    if (!familyId) continue;
    try {
      const entitlement = await resolveEntitlement(db, familyId, now);
      const cutoff = locationHistoryRetentionCutoff(
        entitlement.isPremium ? "premium" : "free",
        now,
      );
      removedRows += await deleteFamilyHistoryBefore(db, familyId, cutoff);
      processedFamilies += 1;
    } catch (error) {
      skippedFamilies += 1;
      console.warn("[location-history-retention] entitlement unavailable");
    }
  }

  // 가족 정본이 사라진 고아 원본은 유료 여부를 판정할 수 없으므로 가장 긴 상품 보존기간인
  // 30일까지만 보수적으로 유지한다. 계정 삭제 경로의 즉시 삭제 계약은 별도로 그대로 적용된다.
  const removedOrphanRows = await deleteOrphanHistoryBefore(
    db,
    locationHistoryRetentionCutoff("premium", now),
  );
  removedRows += removedOrphanRows;

  return { removedRows, processedFamilies, skippedFamilies, removedOrphanRows };
}

export async function run(env: Env): Promise<LocationHistoryRetentionResult> {
  return await cleanupLocationHistoryRetention(env.DB);
}
