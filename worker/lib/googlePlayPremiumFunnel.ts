import type { Env } from "../types";
import {
  createServerPremiumFunnelEventId,
  hashPremiumFunnelFamily,
  isPremiumFunnelConfigured,
  recordServerPremiumFunnelEvent,
  type ServerPremiumFunnelRecordResult,
} from "./premiumFunnel";

export interface GooglePlayPremiumFunnelSnapshot {
  status: string;
  provider: string | null;
  basePlanId: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
}

export interface GooglePlayVerifiedFunnelState {
  status: string;
  basePlanId: string;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
}

export type GooglePlayPremiumFunnelEvent = {
  event: "entitlement_activated" | "trial_start" | "renewal" | "refund";
  plan: "month" | "year";
};

export type GooglePlayPremiumFunnelSnapshotResult =
  | { ok: true; snapshot: GooglePlayPremiumFunnelSnapshot | null }
  | { ok: false };

const PURCHASE_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

function planFromBasePlan(basePlanId: string): "month" | "year" | null {
  if (basePlanId === "monthly-2900") return "month";
  if (basePlanId === "annual-27840") return "year";
  return null;
}

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function previousEntitlementIsLive(
  previous: GooglePlayPremiumFunnelSnapshot,
  nowMs: number,
): boolean {
  if (previous.status === "trial") {
    const trialEnd = timestamp(previous.trialEndsAt);
    return trialEnd !== null && trialEnd > nowMs;
  }
  if (["active", "grace", "cancelled"].includes(previous.status)) {
    const periodEnd = timestamp(previous.currentPeriodEnd);
    return periodEnd !== null && periodEnd > nowMs;
  }
  return false;
}

/** Google 재검증 결과와 저장 직전 상태만으로 확정 가능한 전이 한 건을 고른다. */
export function classifyGooglePlayPremiumFunnelTransition(input: {
  previous: GooglePlayPremiumFunnelSnapshot | null;
  verified: GooglePlayVerifiedFunnelState;
  notificationType: number | null;
  now: Date;
}): GooglePlayPremiumFunnelEvent | null {
  const plan = planFromBasePlan(input.verified.basePlanId);
  if (!plan || !Number.isFinite(input.now.getTime())) return null;

  // notificationType=12(revoked)는 단독으로 신뢰하지 않고, Play 재조회 결과가
  // 실제 entitlement 상실(expired)로 확정된 경우에만 환불/회수로 기록한다.
  if (input.notificationType === 12 && input.verified.status === "expired") {
    return { event: "refund", plan };
  }

  if (input.verified.status === "trial") {
    const trialEnd = timestamp(input.verified.trialEndsAt);
    if (trialEnd === null || trialEnd <= input.now.getTime()) return null;
    const sameTrial = input.previous?.provider === "google_play"
      && input.previous.status === "trial"
      && input.previous.trialEndsAt === input.verified.trialEndsAt;
    return sameTrial ? null : { event: "trial_start", plan };
  }

  if (input.verified.status !== "active") return null;
  const nextPeriodEnd = timestamp(input.verified.currentPeriodEnd);
  if (nextPeriodEnd === null || nextPeriodEnd <= input.now.getTime()) return null;
  if (!input.previous) return { event: "entitlement_activated", plan };

  if (input.previous.status === "trial") {
    return { event: "entitlement_activated", plan };
  }
  if (!previousEntitlementIsLive(input.previous, input.now.getTime())) {
    return { event: "entitlement_activated", plan };
  }
  if (input.previous.provider !== "google_play") return null;

  const previousPeriodEnd = timestamp(input.previous.currentPeriodEnd);
  return previousPeriodEnd !== null && nextPeriodEnd > previousPeriodEnd
    ? { event: "renewal", plan }
    : null;
}

/** 분석용 이전 상태 조회. 실패와 실제 미가입을 구분해 추정 이벤트 생성을 막는다. */
export async function readGooglePlayPremiumFunnelSnapshot(
  db: D1Database,
  familyId: string,
): Promise<GooglePlayPremiumFunnelSnapshotResult> {
  try {
    const row = await db.prepare(
      `SELECT status, provider, base_plan_id, current_period_end, trial_ends_at
         FROM family_subscription
        WHERE family_id=?
        LIMIT 1`,
    ).bind(familyId).first<{
      status: string;
      provider: string | null;
      base_plan_id: string | null;
      current_period_end: string | null;
      trial_ends_at: string | null;
    }>();
    return {
      ok: true,
      snapshot: row ? {
        status: row.status,
        provider: row.provider,
        basePlanId: row.base_plan_id,
        currentPeriodEnd: row.current_period_end,
        trialEndsAt: row.trial_ends_at,
      } : null,
    };
  } catch {
    return { ok: false };
  }
}

export type GooglePlayPremiumFunnelRecordResult =
  | { recorded: false; reason: "not_applicable" | "not_configured" | "invalid_hash" }
  | { recorded: true; result: ServerPremiumFunnelRecordResult };

/**
 * Google 결제 정본 write가 성공한 뒤 호출하는 fail-soft 기록기.
 * purchase token/order id 원문은 받지 않고 SHA-256 token hash만 런타임에서 허용한다.
 */
export async function recordGooglePlayPremiumFunnelTransition(
  env: Pick<Env, "DB" | "PREMIUM_FUNNEL_HASH_SECRET">,
  input: {
    familyId: string;
    purchaseTokenHash: string;
    previous: GooglePlayPremiumFunnelSnapshot | null;
    verified: GooglePlayVerifiedFunnelState;
    notificationType: number | null;
    occurredAt: Date;
    now: Date;
  },
): Promise<GooglePlayPremiumFunnelRecordResult> {
  const secret = env.PREMIUM_FUNNEL_HASH_SECRET;
  if (!isPremiumFunnelConfigured(secret)) {
    return { recorded: false, reason: "not_configured" };
  }
  if (!PURCHASE_TOKEN_HASH_PATTERN.test(input.purchaseTokenHash)) {
    return { recorded: false, reason: "invalid_hash" };
  }
  const transition = classifyGooglePlayPremiumFunnelTransition({
    previous: input.previous,
    verified: input.verified,
    notificationType: input.notificationType,
    now: input.now,
  });
  if (!transition) return { recorded: false, reason: "not_applicable" };

  try {
    const familyKey = await hashPremiumFunnelFamily(secret as string, input.familyId);
    const periodBoundary = transition.event === "refund"
      ? "revoked"
      : input.verified.trialEndsAt ?? input.verified.currentPeriodEnd ?? "missing";
    const eventId = await createServerPremiumFunnelEventId(
      secret as string,
      JSON.stringify([
        "google_play",
        familyKey,
        input.purchaseTokenHash,
        transition.event,
        periodBoundary,
      ]),
    );
    const result = await recordServerPremiumFunnelEvent(env, {
      event_id: eventId,
      family_id: input.familyId,
      event: transition.event,
      provider: "google_play",
      plan: transition.plan,
      occurred_at: input.occurredAt.toISOString(),
    }, input.now);
    return { recorded: true, result };
  } catch {
    return {
      recorded: true,
      result: { stored: false, reason: "storage_unavailable" },
    };
  }
}
