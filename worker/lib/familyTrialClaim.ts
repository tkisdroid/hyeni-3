import { pgTs } from "./time";

export type FamilyTrialClaimResult = "claimed" | "same_claim" | "already_used";

interface FamilyTrialClaimRow {
  checkout_session_id: string;
}

function planFromBasePlanId(basePlanId: string): "month" | "year" {
  if (basePlanId === "monthly-2900") return "month";
  if (basePlanId === "annual-27840") return "year";
  throw new Error("family_trial_base_plan_invalid");
}

function priorFamilySubscriptionUseSql(): string {
  return `EXISTS(
    SELECT 1 FROM family_subscription fs
     WHERE fs.family_id=?
       AND (
         (
           fs.provider='google_play'
           AND COALESCE(fs.purchase_token_hash,'')<>?
           AND (
             fs.trial_ends_at IS NOT NULL
             OR NULLIF(TRIM(COALESCE(fs.latest_order_id,'')),'') IS NOT NULL
             OR NULLIF(TRIM(COALESCE(fs.last_event_id,'')),'') IS NOT NULL
             OR fs.acknowledged_at IS NOT NULL
           )
         )
         OR (
           fs.provider='toss_web'
           AND (
             (
               NULLIF(TRIM(COALESCE(fs.latest_order_id,'')),'') IS NOT NULL
               AND LOWER(TRIM(fs.latest_order_id)) NOT LIKE 'trial:%'
             )
             OR (
               NULLIF(TRIM(COALESCE(fs.last_event_id,'')),'') IS NOT NULL
               AND LOWER(TRIM(fs.last_event_id)) NOT LIKE 'trial:%'
             )
           )
         )
       )
  )`;
}

/** 결제창을 열기 전 가족의 평생 1회 체험 사용 여부를 읽기 전용으로 판정합니다. */
export async function isFamilyTrialEligible(
  db: D1Database,
  familyId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT CASE WHEN
       NOT EXISTS(
         SELECT 1 FROM web_billing_trial_claims WHERE family_id=?
       )
       AND NOT EXISTS(
         SELECT 1 FROM web_billing_charge_attempts
          WHERE family_id=? AND status='done'
       )
       AND NOT EXISTS(
         SELECT 1 FROM google_play_purchase_events
          WHERE family_id=? AND product_type='subscription' AND granted_at IS NOT NULL
       )
       AND NOT EXISTS(
         SELECT 1 FROM family_subscription fs
          WHERE fs.family_id=?
            AND (
              (
                fs.provider='google_play'
                AND (
                  fs.trial_ends_at IS NOT NULL
                  OR NULLIF(TRIM(COALESCE(fs.purchase_token_hash,'')),'') IS NOT NULL
                  OR NULLIF(TRIM(COALESCE(fs.latest_order_id,'')),'') IS NOT NULL
                  OR NULLIF(TRIM(COALESCE(fs.last_event_id,'')),'') IS NOT NULL
                  OR fs.acknowledged_at IS NOT NULL
                )
              )
              OR (
                fs.provider='toss_web'
                AND (
                  NULLIF(TRIM(COALESCE(fs.latest_order_id,'')),'') IS NOT NULL
                  OR NULLIF(TRIM(COALESCE(fs.last_event_id,'')),'') IS NOT NULL
                  OR fs.trial_ends_at IS NOT NULL
                )
              )
            )
       )
     THEN 1 ELSE 0 END AS eligible`,
  ).bind(familyId, familyId, familyId, familyId).first<{ eligible: number }>();
  return Number(row?.eligible ?? 0) === 1;
}

/**
 * Toss·Google Play가 공유하는 가족 단위 평생 1회 체험 claim입니다.
 * purchase token 원문은 받지 않고 서버 해시만 결정적 claim id에 사용합니다.
 */
export async function claimGooglePlayFamilyTrial(
  db: D1Database,
  input: {
    familyId: string;
    parentId: string;
    purchaseTokenHash: string;
    basePlanId: string;
    trialEndsAt: string;
    now: Date;
  },
): Promise<FamilyTrialClaimResult> {
  const trialEnd = new Date(input.trialEndsAt);
  if (!Number.isFinite(trialEnd.getTime())) throw new Error("family_trial_end_invalid");
  const plan = planFromBasePlanId(input.basePlanId);
  const claimId = `google-play:${input.purchaseTokenHash}`;
  const now = pgTs(input.now);
  const trialEndsAt = pgTs(trialEnd);
  const priorSubscriptionUse = priorFamilySubscriptionUseSql();
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO web_billing_trial_claims
       (family_id,parent_id,checkout_session_id,provider,plan,status,claimed_at,trial_ends_at,updated_at)
     SELECT ?,?,?,'google_play',?,'active',?,?,?
      WHERE NOT EXISTS(
        SELECT 1 FROM web_billing_charge_attempts
         WHERE family_id=? AND status='done'
      )
        AND NOT EXISTS(
          SELECT 1 FROM google_play_purchase_events
           WHERE family_id=? AND product_type='subscription'
             AND granted_at IS NOT NULL AND purchase_token_hash<>?
        )
        AND NOT (${priorSubscriptionUse})`,
  ).bind(
    input.familyId,
    input.parentId,
    claimId,
    plan,
    now,
    trialEndsAt,
    now,
    input.familyId,
    input.familyId,
    input.purchaseTokenHash,
    input.familyId,
    input.purchaseTokenHash,
  ).run();
  const row = await db.prepare(
    `SELECT checkout_session_id
       FROM web_billing_trial_claims WHERE family_id=? LIMIT 1`,
  ).bind(input.familyId).first<FamilyTrialClaimRow>();
  if (row?.checkout_session_id === claimId) {
    return Number(inserted.meta?.changes ?? 0) === 1 ? "claimed" : "same_claim";
  }
  if (row) return "already_used";

  const prior = await db.prepare(
    `SELECT CASE WHEN
       EXISTS(
         SELECT 1 FROM web_billing_charge_attempts
          WHERE family_id=? AND status='done'
       )
       OR EXISTS(
         SELECT 1 FROM google_play_purchase_events
          WHERE family_id=? AND product_type='subscription'
            AND granted_at IS NOT NULL AND purchase_token_hash<>?
       )
       OR ${priorSubscriptionUse}
     THEN 1 ELSE 0 END AS used`,
  ).bind(
    input.familyId,
    input.familyId,
    input.purchaseTokenHash,
    input.familyId,
    input.purchaseTokenHash,
  ).first<{ used: number }>();
  if (Number(prior?.used ?? 0) === 1) return "already_used";
  throw new Error("family_trial_claim_unavailable");
}
