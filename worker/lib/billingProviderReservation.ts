import { pgTs } from "./time.ts";

export type BillingProvider = "google_play" | "toss_web";
export type BillingProviderState = "reserved" | "active" | "conflict" | "released";
export type BillingProviderConflictReason =
  | "preexisting_toss_google_overlap"
  | "google_purchase_after_toss_activation"
  | "toss_charge_after_google_activation";

export const GOOGLE_PLAY_PROVIDER_RESERVATION_LEASE_MS = 15 * 60 * 1000;

export interface BillingProviderReservationRow {
  family_id: string;
  provider: BillingProvider;
  state: BillingProviderState;
  reservation_ref: string;
  conflicting_provider: BillingProvider | null;
  conflict_ref: string | null;
  conflict_reason: string | null;
  resolution_status: "refund_required" | "manual_review" | null;
}

export type BillingProviderClaim =
  | { status: "acquired" | "same_provider"; row: BillingProviderReservationRow }
  | { status: "deferred" | "blocked" | "conflict"; row: BillingProviderReservationRow };

function activeSubscriptionSql(alias = "", clockParameter = "?1"): string {
  const prefix = alias ? `${alias}.` : "";
  return `(
    (LOWER(TRIM(COALESCE(${prefix}status,''))) IN ('active','grace','cancelled')
      AND ${prefix}current_period_end IS NOT NULL
      AND datetime(substr(${prefix}current_period_end,1,19))>datetime(substr(${clockParameter},1,19)))
    OR
    (LOWER(TRIM(COALESCE(${prefix}status,'')))='trial'
      AND ${prefix}trial_ends_at IS NOT NULL
      AND datetime(substr(${prefix}trial_ends_at,1,19))>datetime(substr(${clockParameter},1,19)))
  )`;
}

function prepareSeedFromEntitlement(
  db: D1Database,
  familyId: string,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT OR IGNORE INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     SELECT family_id,provider,'active',
            COALESCE(NULLIF(purchase_token_hash,''),NULLIF(latest_order_id,''),NULLIF(last_event_id,''),family_id),
            ?,?
       FROM family_subscription
      WHERE family_id=?
        AND provider IN ('google_play','toss_web')
        AND ${activeSubscriptionSql()}`,
  ).bind(now, now, familyId);
}

function prepareReleaseStaleActive(
  db: D1Database,
  familyId: string,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `UPDATE billing_provider_reservations
        SET state='released', conflicting_provider=NULL, conflict_ref=NULL,
            conflict_reason=NULL, resolution_status=NULL, updated_at=?
      WHERE family_id=? AND state='active'
        AND NOT EXISTS(
          SELECT 1 FROM family_subscription fs
           WHERE fs.family_id=billing_provider_reservations.family_id
             AND fs.provider=billing_provider_reservations.provider
             AND ${activeSubscriptionSql("fs")}
        )
        AND NOT (
          provider='toss_web'
          AND EXISTS(
            SELECT 1 FROM web_billing_customers wbc
             WHERE wbc.family_id=billing_provider_reservations.family_id
               AND wbc.status IN ('trial','active','past_due')
               AND wbc.billing_key_ciphertext IS NOT NULL
               AND wbc.billing_key_iv IS NOT NULL
               AND wbc.billing_key_version='v1'
          )
        )`,
  ).bind(now, familyId);
}

function prepareReleaseStaleGoogleReservation(
  db: D1Database,
  familyId: string,
  cutoff: string,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `UPDATE billing_provider_reservations
        SET state='released', conflicting_provider=NULL, conflict_ref=NULL,
            conflict_reason=NULL, resolution_status=NULL, updated_at=?
      WHERE family_id=? AND provider='google_play' AND state='reserved'
        AND datetime(substr(updated_at,1,19))<=datetime(substr(?,1,19))
        AND (
          reservation_ref LIKE 'google-play-preflight:%'
          OR EXISTS(
            SELECT 1 FROM google_play_purchase_events gppe
             WHERE gppe.purchase_token_hash=billing_provider_reservations.reservation_ref
               AND gppe.family_id=billing_provider_reservations.family_id
               AND gppe.product_type='subscription' AND gppe.status='received'
          )
        )
        AND NOT EXISTS(
          SELECT 1 FROM family_subscription fs
           WHERE fs.family_id=billing_provider_reservations.family_id
             AND ${activeSubscriptionSql("fs")}
        )`,
  ).bind(now, familyId, cutoff);
}

export async function readBillingProviderReservation(
  db: D1Database,
  familyId: string,
  now = new Date(),
): Promise<BillingProviderReservationRow | null> {
  const nowText = pgTs(now);
  const googleReservationCutoff = pgTs(new Date(
    now.getTime() - GOOGLE_PLAY_PROVIDER_RESERVATION_LEASE_MS,
  ));
  await db.batch([
    prepareSeedFromEntitlement(db, familyId, nowText),
    prepareReleaseStaleActive(db, familyId, nowText),
    prepareReleaseStaleGoogleReservation(db, familyId, googleReservationCutoff, nowText),
  ]);
  return db.prepare(
    `SELECT family_id,provider,state,reservation_ref,conflicting_provider,conflict_ref,
            conflict_reason,resolution_status
       FROM billing_provider_reservations WHERE family_id=? LIMIT 1`,
  ).bind(familyId).first<BillingProviderReservationRow>();
}

export async function claimBillingProvider(
  db: D1Database,
  input: {
    familyId: string;
    provider: BillingProvider;
    reservationRef: string;
    expectedReservationRef?: string;
    now: Date;
  },
): Promise<BillingProviderClaim> {
  const now = pgTs(input.now);
  const googleReservationCutoff = pgTs(new Date(
    input.now.getTime() - GOOGLE_PLAY_PROVIDER_RESERVATION_LEASE_MS,
  ));
  const batch = await db.batch([
    prepareSeedFromEntitlement(db, input.familyId, now),
    prepareReleaseStaleActive(db, input.familyId, now),
    prepareReleaseStaleGoogleReservation(
      db,
      input.familyId,
      googleReservationCutoff,
      now,
    ),
    db.prepare(
      `UPDATE billing_provider_reservations
          SET reservation_ref=?,updated_at=?
        WHERE family_id=? AND provider=? AND state='reserved'
          AND (
            (?<>'' AND reservation_ref=?)
            OR (
              ?='google_play'
              AND reservation_ref LIKE 'google-play-preflight:%'
              AND ? NOT LIKE 'google-play-preflight:%'
            )
          )`,
    ).bind(
      input.reservationRef,
      now,
      input.familyId,
      input.provider,
      input.expectedReservationRef ?? "",
      input.expectedReservationRef ?? "",
      input.provider,
      input.reservationRef,
    ),
    db.prepare(
      `INSERT INTO billing_provider_reservations
         (family_id,provider,state,reservation_ref,created_at,updated_at)
       VALUES (?,?,'reserved',?,?,?)
       ON CONFLICT(family_id) DO UPDATE SET
         provider=CASE
           WHEN billing_provider_reservations.state='released' THEN excluded.provider
           ELSE billing_provider_reservations.provider
         END,
         state=CASE
           WHEN billing_provider_reservations.state='released' THEN 'reserved'
           ELSE billing_provider_reservations.state
         END,
         reservation_ref=CASE
           WHEN billing_provider_reservations.state='released'
             OR (billing_provider_reservations.provider=excluded.provider
               AND billing_provider_reservations.state='reserved'
               AND billing_provider_reservations.reservation_ref=excluded.reservation_ref)
             THEN excluded.reservation_ref
           ELSE billing_provider_reservations.reservation_ref
         END,
         conflicting_provider=CASE
           WHEN billing_provider_reservations.state='released' THEN NULL
           ELSE billing_provider_reservations.conflicting_provider
         END,
         conflict_ref=CASE
           WHEN billing_provider_reservations.state='released' THEN NULL
           ELSE billing_provider_reservations.conflict_ref
         END,
         conflict_reason=CASE
           WHEN billing_provider_reservations.state='released' THEN NULL
           ELSE billing_provider_reservations.conflict_reason
         END,
         resolution_status=CASE
           WHEN billing_provider_reservations.state='released' THEN NULL
           ELSE billing_provider_reservations.resolution_status
         END,
         updated_at=CASE
           WHEN billing_provider_reservations.state='released'
             OR (billing_provider_reservations.provider=excluded.provider
               AND billing_provider_reservations.state='reserved'
               AND billing_provider_reservations.reservation_ref=excluded.reservation_ref)
             THEN excluded.updated_at
           ELSE billing_provider_reservations.updated_at
         END`,
    ).bind(
      input.familyId,
      input.provider,
      input.reservationRef,
      now,
      now,
    ),
  ]);
  const row = await db.prepare(
    `SELECT family_id,provider,state,reservation_ref,conflicting_provider,conflict_ref,
            conflict_reason,resolution_status
       FROM billing_provider_reservations WHERE family_id=? LIMIT 1`,
  ).bind(input.familyId).first<BillingProviderReservationRow>();
  if (!row || Number(batch[4]?.meta?.changes ?? 0) !== 1) {
    throw new Error("billing_provider_reservation_unavailable");
  }
  if (row.state === "conflict") return { status: "conflict", row };
  if (row.provider === input.provider) {
    if (row.state === "reserved" && row.reservation_ref !== input.reservationRef) {
      return { status: "deferred", row };
    }
    return { status: row.reservation_ref === input.reservationRef ? "acquired" : "same_provider", row };
  }
  return { status: row.state === "reserved" ? "deferred" : "blocked", row };
}

export async function releaseBillingProviderReservation(
  db: D1Database,
  input: {
    familyId: string;
    provider: BillingProvider;
    reservationRef: string;
    now: Date;
  },
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE billing_provider_reservations
        SET state='released', conflicting_provider=NULL, conflict_ref=NULL,
            conflict_reason=NULL, resolution_status=NULL, updated_at=?
      WHERE family_id=? AND provider=? AND state='reserved' AND reservation_ref=?`,
  ).bind(pgTs(input.now), input.familyId, input.provider, input.reservationRef).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export function prepareBillingProviderFinalization(
  db: D1Database,
  input: {
    familyId: string;
    provider: BillingProvider;
    reservationRef: string;
    expectedReservationRef: string;
    canonicalOrderId: string;
    active: boolean;
    now: string;
  },
): D1PreparedStatement {
  const canonicalEntitlementGuard = input.active
    ? activeSubscriptionSql("fs", "?3")
    : `NOT ${activeSubscriptionSql("fs", "?3")}`;
  return db.prepare(
    `UPDATE billing_provider_reservations
        SET state=?, reservation_ref=?, conflicting_provider=NULL, conflict_ref=NULL,
             conflict_reason=NULL, resolution_status=NULL, updated_at=?
      WHERE family_id=? AND provider=? AND state IN ('reserved','active')
        AND (
          (state='reserved' AND reservation_ref=?)
          OR (state='active' AND reservation_ref IN (?,?))
        )
        AND EXISTS(
          SELECT 1 FROM family_subscription fs
           WHERE fs.family_id=billing_provider_reservations.family_id
             AND fs.provider=? AND fs.latest_order_id=?
             AND ${canonicalEntitlementGuard}
        )`,
  ).bind(
    input.active ? "active" : "released",
    input.reservationRef,
    input.now,
    input.familyId,
    input.provider,
    input.expectedReservationRef,
    input.expectedReservationRef,
    input.reservationRef,
    input.provider,
    input.canonicalOrderId,
  );
}

export async function markBillingProviderConflict(
  db: D1Database,
  input: {
    familyId: string;
    incumbentProvider: BillingProvider;
    conflictingProvider: BillingProvider;
    conflictRef: string;
    reason: BillingProviderConflictReason;
    now: Date;
  },
): Promise<boolean> {
  if (input.incumbentProvider === input.conflictingProvider) return false;
  const now = pgTs(input.now);
  const batch = await db.batch([
    prepareSeedFromEntitlement(db, input.familyId, now),
    db.prepare(
      `UPDATE billing_provider_reservations
          SET state='conflict', conflicting_provider=?, conflict_ref=?,
              conflict_reason=?, resolution_status='refund_required', updated_at=?
        WHERE family_id=? AND provider=?
          AND (
            state IN ('reserved','active')
            OR (
              state='conflict' AND conflicting_provider=? AND conflict_ref=?
                AND conflict_reason=? AND resolution_status='refund_required'
            )
          )`,
    ).bind(
      input.conflictingProvider,
      input.conflictRef,
      input.reason,
      now,
      input.familyId,
      input.incumbentProvider,
      input.conflictingProvider,
      input.conflictRef,
      input.reason,
    ),
  ]);
  return Number(batch[1]?.meta?.changes ?? 0) === 1;
}

/** 충돌 결제가 외부에서 환불·회수된 뒤 기존 공급자의 active 정본을 복구합니다. */
export async function resolveBillingProviderConflictAfterRefund(
  db: D1Database,
  input: {
    familyId: string;
    incumbentProvider: BillingProvider;
    conflictingProvider: BillingProvider;
    conflictRef: string;
    now: Date;
  },
): Promise<boolean> {
  if (input.incumbentProvider === input.conflictingProvider) return false;
  const result = await db.prepare(
    `UPDATE billing_provider_reservations
        SET state='active',conflicting_provider=NULL,conflict_ref=NULL,
            conflict_reason=NULL,resolution_status=NULL,updated_at=?
      WHERE family_id=? AND provider=?
        AND (
          state='active'
          OR (
            state='conflict' AND conflicting_provider=? AND conflict_ref=?
              AND resolution_status='refund_required'
          )
        )
        AND EXISTS(
          SELECT 1 FROM family_subscription fs
           WHERE fs.family_id=billing_provider_reservations.family_id
             AND fs.provider=billing_provider_reservations.provider
             AND ${activeSubscriptionSql("fs")}
        )`,
  ).bind(
    pgTs(input.now),
    input.familyId,
    input.incumbentProvider,
    input.conflictingProvider,
    input.conflictRef,
  ).run();
  return Number(result.meta?.changes ?? 0) === 1;
}
