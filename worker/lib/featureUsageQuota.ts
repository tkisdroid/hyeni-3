import { pgTs, tsNorm } from "./time";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";

export const LOCATION_MANUAL_USAGE_ACTION = "location_manual_request";
export const FORCE_RING_QUOTA_LEASE_ACTION = "force_ring_quota_lease";

export const FREE_LOCATION_MANUAL_DAILY_LIMIT = 5;
export const FREE_FORCE_RING_DAILY_LIMIT = 1;
export const PREMIUM_FORCE_RING_DAILY_LIMIT = 10;

const USAGE_WINDOW_MS = 24 * 60 * 60_000;
const FORCE_RING_LEASE_MS = 2 * 60_000;
const LOCATION_USAGE_KEY_PREFIX = "feature:request_location:";
const FORCE_RING_USAGE_KEY_PREFIX = "feature:force_ring:";

type CommercialTier = "free" | "premium";

export type FeatureUsageClaim =
  | {
      status: "claimed";
      tier: CommercialTier;
      quota: number;
      used: number;
      claimKey: string;
    }
  | {
      status: "duplicate";
      tier: CommercialTier;
      quota: number;
      used: number;
    }
  | {
      status: "exhausted";
      tier: CommercialTier;
      quota: number;
      used: number;
    }
  | {
      status: "unlimited";
      tier: "premium";
      quota: null;
      used: 0;
    };

export class FeatureUsageUnavailableError extends Error {
  readonly code = "feature_usage_unavailable";
  readonly status = 503;

  constructor(cause: unknown) {
    super("feature_usage_unavailable", { cause });
    this.name = "FeatureUsageUnavailableError";
  }
}

function usageCutoff(now: Date): string {
  return tsNorm(pgTs(new Date(now.getTime() - USAGE_WINDOW_MS)));
}

function forceRingLeaseCutoff(now: Date): string {
  return tsNorm(pgTs(new Date(now.getTime() - FORCE_RING_LEASE_MS)));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedTargetUserId(value: string | null | undefined): string {
  const target = String(value ?? "").trim();
  return target || "*";
}

async function locationManualUsageKey(
  familyId: string,
  targetUserId: string | null | undefined,
  requestId: string,
): Promise<string> {
  const target = normalizedTargetUserId(targetUserId);
  const digest = await sha256Hex(`${familyId}\u0000${target}\u0000${requestId}`);
  return `${LOCATION_USAGE_KEY_PREFIX}${encodeURIComponent(target)}:${digest}`;
}

/**
 * 서버가 만든 수동 위치 요청 사용량 key에서 대상 자녀 id를 복원한다.
 * 임의 문자열이나 형식이 어긋난 행은 null로 닫는다.
 */
export function locationManualUsageTarget(key: unknown): string | null {
  if (typeof key !== "string" || !key.startsWith(LOCATION_USAGE_KEY_PREFIX)) return null;
  const suffix = key.slice(LOCATION_USAGE_KEY_PREFIX.length);
  const separator = suffix.indexOf(":");
  if (separator <= 0) return null;
  const encodedTarget = suffix.slice(0, separator);
  const digest = suffix.slice(separator + 1);
  if (!/^[a-f0-9]{64}$/.test(digest)) return null;
  try {
    const target = decodeURIComponent(encodedTarget).trim();
    return target || null;
  } catch {
    return null;
  }
}

async function countLocationManualUsage(
  db: D1Database,
  familyId: string,
  now: Date,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM push_idempotency
        WHERE family_id = ?1
          AND action = ?2
          AND substr(created_at, 1, 19) > ?3`,
    )
    .bind(familyId, LOCATION_MANUAL_USAGE_ACTION, usageCutoff(now))
    .first<{ n: number }>();
  return Math.max(0, Number(row?.n ?? 0));
}

/**
 * Free/reviewed의 부모 수동 위치 요청을 가족 단위 rolling 24시간 5회로 제한한다.
 * INSERT ... SELECT 한 문장 안에서 현재 사용량을 검사하고 claim하여 동시 요청도
 * 한도를 넘지 않는다. Premium은 사용량 행을 만들지 않는다.
 */
export async function claimLocationManualRequestUsage(
  db: D1Database,
  args: {
    familyId: string;
    targetUserId?: string | null;
    requestId: string;
    now?: Date;
  },
): Promise<FeatureUsageClaim> {
  const familyId = String(args.familyId ?? "").trim();
  const requestId = String(args.requestId ?? "").trim();
  const now = args.now ?? new Date();
  if (!familyId || !requestId) throw new FeatureUsageUnavailableError("invalid_usage_scope");

  const entitlement = await resolveFamilyEntitlement(db, familyId, now);
  if (entitlement.isPremium) {
    return { status: "unlimited", tier: "premium", quota: null, used: 0 };
  }

  const claimKey = await locationManualUsageKey(
    familyId,
    args.targetUserId,
    requestId,
  );
  const nowTimestamp = pgTs(now);

  try {
    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO push_idempotency
           (key, family_id, action, first_sent_at, created_at)
         SELECT ?1, ?2, ?3, ?4, ?4
          WHERE (
            SELECT COUNT(*)
              FROM push_idempotency
             WHERE family_id = ?2
               AND action = ?3
               AND substr(created_at, 1, 19) > ?5
          ) < ?6`,
      )
      .bind(
        claimKey,
        familyId,
        LOCATION_MANUAL_USAGE_ACTION,
        nowTimestamp,
        usageCutoff(now),
        FREE_LOCATION_MANUAL_DAILY_LIMIT,
      )
      .run();

    const used = await countLocationManualUsage(db, familyId, now);
    if (Number(inserted.meta?.changes ?? 0) > 0) {
      return {
        status: "claimed",
        tier: "free",
        quota: FREE_LOCATION_MANUAL_DAILY_LIMIT,
        used: Math.max(0, used - 1),
        claimKey,
      };
    }

    const duplicate = await db
      .prepare(
        `SELECT 1 AS found
           FROM push_idempotency
          WHERE key = ?1 AND family_id = ?2 AND action = ?3
          LIMIT 1`,
      )
      .bind(claimKey, familyId, LOCATION_MANUAL_USAGE_ACTION)
      .first<{ found: number }>();
    return duplicate
      ? {
          status: "duplicate",
          tier: "free",
          quota: FREE_LOCATION_MANUAL_DAILY_LIMIT,
          used,
        }
      : {
          status: "exhausted",
          tier: "free",
          quota: FREE_LOCATION_MANUAL_DAILY_LIMIT,
          used,
        };
  } catch (error) {
    if (error instanceof FeatureUsageUnavailableError) throw error;
    throw new FeatureUsageUnavailableError(error);
  }
}

async function countForceRingUsage(
  db: D1Database,
  familyId: string,
  now: Date,
): Promise<number> {
  const cut24 = usageCutoff(now);
  const cut10 = tsNorm(pgTs(new Date(now.getTime() - 10 * 60_000)));
  const leaseCutoff = forceRingLeaseCutoff(now);
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*)
            FROM force_ring_events
           WHERE family_id = ?1
             AND substr(triggered_at, 1, 19) > ?2
             AND (
               delivered_at IS NOT NULL
               OR (
                 delivered_at IS NULL
                 AND stop_reason IS NULL
                 AND substr(triggered_at, 1, 19) > ?3
               )
             ))
         +
         (SELECT COUNT(*)
            FROM push_idempotency
           WHERE family_id = ?1
             AND action = ?4
             AND first_sent_at IS NULL
             AND substr(created_at, 1, 19) > ?5) AS n`,
    )
    .bind(
      familyId,
      cut24,
      cut10,
      FORCE_RING_QUOTA_LEASE_ACTION,
      leaseCutoff,
    )
    .first<{ n: number }>();
  return Math.max(0, Number(row?.n ?? 0));
}

export async function readForceRingQuota(
  db: D1Database,
  familyId: string,
  now = new Date(),
): Promise<{ allowed: boolean; quota: number; used: number; tier: CommercialTier }> {
  const entitlement = await resolveFamilyEntitlement(db, familyId, now);
  const tier: CommercialTier = entitlement.isPremium ? "premium" : "free";
  const limit = entitlement.isPremium
    ? PREMIUM_FORCE_RING_DAILY_LIMIT
    : FREE_FORCE_RING_DAILY_LIMIT;
  try {
    const used = await countForceRingUsage(db, familyId, now);
    return { allowed: used < limit, quota: limit, used, tier };
  } catch (error) {
    if (error instanceof FeatureUsageUnavailableError) throw error;
    throw new FeatureUsageUnavailableError(error);
  }
}

/**
 * force_ring_events INSERT 전 짧은 provisional lease를 원자 claim한다.
 * 성공 INSERT 뒤 lease를 지우면 정본 이벤트가 rolling 24시간 사용량을 이어받는다.
 */
export async function claimForceRingQuotaLease(
  db: D1Database,
  args: { familyId: string; requestId: string; now?: Date },
): Promise<Exclude<FeatureUsageClaim, { status: "unlimited" }>> {
  const familyId = String(args.familyId ?? "").trim();
  const requestId = String(args.requestId ?? "").trim();
  const now = args.now ?? new Date();
  if (!familyId || !requestId) throw new FeatureUsageUnavailableError("invalid_usage_scope");

  const entitlement = await resolveFamilyEntitlement(db, familyId, now);
  const tier: CommercialTier = entitlement.isPremium ? "premium" : "free";
  const limit = entitlement.isPremium
    ? PREMIUM_FORCE_RING_DAILY_LIMIT
    : FREE_FORCE_RING_DAILY_LIMIT;
  // 가족별 단일 provisional key가 quota claim과 one-active insert 사이의 경쟁도
  // 직렬화한다. 요청 id는 유효성 검증에만 쓰며 실제 멱등 결과는 force_ring_events의
  // client_request_hash가 담당한다.
  const digest = await sha256Hex(`${familyId}\u0000force_ring_family_lease`);
  const claimKey = `${FORCE_RING_USAGE_KEY_PREFIX}${digest}`;
  const nowTimestamp = pgTs(now);
  const cut24 = usageCutoff(now);
  const cut10 = tsNorm(pgTs(new Date(now.getTime() - 10 * 60_000)));
  const leaseCutoff = forceRingLeaseCutoff(now);

  try {
    // 같은 요청의 Worker가 비정상 종료한 경우에만 2분 뒤 exact lease를 회수한다.
    await db
      .prepare(
        `DELETE FROM push_idempotency
          WHERE key = ?1
            AND family_id = ?2
            AND action = ?3
            AND first_sent_at IS NULL
            AND substr(created_at, 1, 19) <= ?4`,
      )
      .bind(claimKey, familyId, FORCE_RING_QUOTA_LEASE_ACTION, leaseCutoff)
      .run();

    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO push_idempotency
           (key, family_id, action, first_sent_at, created_at)
         SELECT ?1, ?2, ?3, NULL, ?4
          WHERE (
            (SELECT COUNT(*)
               FROM force_ring_events
              WHERE family_id = ?2
                AND substr(triggered_at, 1, 19) > ?5
                AND (
                  delivered_at IS NOT NULL
                  OR (
                    delivered_at IS NULL
                    AND stop_reason IS NULL
                    AND substr(triggered_at, 1, 19) > ?6
                  )
                ))
            +
            (SELECT COUNT(*)
               FROM push_idempotency
              WHERE family_id = ?2
                AND action = ?3
                AND first_sent_at IS NULL
                AND substr(created_at, 1, 19) > ?7)
          ) < ?8`,
      )
      .bind(
        claimKey,
        familyId,
        FORCE_RING_QUOTA_LEASE_ACTION,
        nowTimestamp,
        cut24,
        cut10,
        leaseCutoff,
        limit,
      )
      .run();

    const used = await countForceRingUsage(db, familyId, now);
    if (Number(inserted.meta?.changes ?? 0) > 0) {
      return {
        status: "claimed",
        tier,
        quota: limit,
        used: Math.max(0, used - 1),
        claimKey,
      };
    }

    const duplicate = await db
      .prepare(
        `SELECT 1 AS found
           FROM push_idempotency
          WHERE key = ?1 AND family_id = ?2 AND action = ?3
          LIMIT 1`,
      )
      .bind(claimKey, familyId, FORCE_RING_QUOTA_LEASE_ACTION)
      .first<{ found: number }>();
    return duplicate
      ? { status: "duplicate", tier, quota: limit, used }
      : { status: "exhausted", tier, quota: limit, used };
  } catch (error) {
    if (error instanceof FeatureUsageUnavailableError) throw error;
    throw new FeatureUsageUnavailableError(error);
  }
}

export async function releaseFeatureUsageClaim(
  db: D1Database,
  claimKey: string,
): Promise<boolean> {
  if (!claimKey) return false;
  try {
    const result = await db
      .prepare(
        `DELETE FROM push_idempotency
          WHERE key = ?1
            AND action IN (?2, ?3)`,
      )
      .bind(claimKey, LOCATION_MANUAL_USAGE_ACTION, FORCE_RING_QUOTA_LEASE_ACTION)
      .run();
    return Number(result.meta?.changes ?? 0) > 0;
  } catch (error) {
    throw new FeatureUsageUnavailableError(error);
  }
}
