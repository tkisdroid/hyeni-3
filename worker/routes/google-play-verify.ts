// POST /api/billing/google-play-verify  ← supabase/functions/google-play-purchase-verify (직역).
// Google Play 구매 토큰 서버검증 후 구독(family_subscription) 또는 AI 크레딧 부여.
//
// 인증: requireAuth → parentId = sub.
// 외부키 graceful: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON 없으면 503 google_play_not_configured.
//   키 있으면 서비스계정 JWT(RS256) → OAuth2 → androidpublisher API.
//
// D1 변환:
//  · google_play_purchase_events PK=purchase_token_hash → select-then-write(received/granted).
//  · family_subscription PK=family_id → select-then-write(구독 부여).
//  · purchase_ai_credits RPC 직역 — ai_credit_ledger(transaction_id) 단일 unique 미이관 →
//    select-then-insert 멱등, ai_credit_balances(family_id,child_user_id) 복합 unique 미이관 →
//    select-then-write. jsonb(verification_result/google_play_raw/raw_event) → JSON.stringify.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { resolveVerifiedFamilyMembership } from "../db/authz";
import { pgNow } from "../lib/time";
import { notifyPg } from "../lib/realtime";
import {
  canApplyGooglePlayFamilySubscriptionWrite,
  getGooglePlayFamilySubscriptionOperation,
  getGoogleAccessToken,
  googleJson,
  refundGooglePlayOrder,
  sanitizeGooglePlayForStorage,
  sha256Hex,
  upsertGooglePlayBillingOwner,
  upsertGooglePlayFamilySubscription,
  verifyGooglePlaySubscription,
} from "../lib/googlePlay";
import {
  assertGooglePlayPurchaseOwner,
  isGooglePlayVerifierConfigured,
} from "../shared/googlePlaySubscription.js";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";
import { resolveIncludedDailyLimit } from "../shared/aiCredits.js";
import {
  readGooglePlayPremiumFunnelSnapshot,
  recordGooglePlayPremiumFunnelTransition,
} from "../lib/googlePlayPremiumFunnel";
import {
  claimBillingProvider,
  GOOGLE_PLAY_PROVIDER_RESERVATION_LEASE_MS,
  releaseBillingProviderReservation,
  resolveBillingProviderConflictAfterRefund,
} from "../lib/billingProviderReservation.ts";
import {
  claimGooglePlayFamilyTrial,
  isFamilyTrialEligible,
} from "../lib/familyTrialClaim";

// 추가 Secret(메인이 types.ts 로 승격).
type BillingEnv = Env & {
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_PLAY_PACKAGE_NAME?: string;
};

const PACKAGE_NAME = "com.hyeni.calendar";
const SUBSCRIPTION_PRODUCT_ID = "hyeni_premium";
const MONTHLY_BASE_PLAN_ID = "monthly-2900";
const ANNUAL_BASE_PLAN_ID = "annual-27840";
const CREDIT_PRODUCTS: Record<string, number> = {
  hyeni_ai_credits_30: 30,
  hyeni_ai_credits_80: 80,
  hyeni_ai_credits_200: 200,
};

type JsonMap = Record<string, unknown>;

const gplay = new Hono<{ Bindings: Env; Variables: Vars }>();
const GOOGLE_PLAY_PREFLIGHT_PREFIX = "google-play-preflight:";

gplay.onError((_error, c) => c.json({
  ok: false,
  error: "google_play_processing_failed",
}, 500));

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isGooglePlayPreflightRef(value: string): boolean {
  return /^google-play-preflight:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

gplay.post("/google-play-preflight", requireAuth, async (c) => {
  const env = c.env as BillingEnv;
  if (!isGooglePlayVerifierConfigured(env)) {
    return c.json({ ok: false, error: "google_play_not_configured" }, 503);
  }
  const body = await c.req.json().catch(() => ({})) as JsonMap;
  const familyId = asString(body.familyId);
  const basePlanId = asString(body.basePlanId);
  if (!familyId || ![MONTHLY_BASE_PLAN_ID, ANNUAL_BASE_PLAN_ID].includes(basePlanId)) {
    return c.json({ ok: false, error: "invalid_request" }, 400);
  }
  const parentId = c.get("user").sub;
  const membership = await resolveVerifiedFamilyMembership(c.env.DB, parentId, familyId);
  if (membership?.role !== "parent") return c.json({ ok: false, error: "not_allowed" }, 403);

  let trialEligible: boolean;
  try {
    trialEligible = await isFamilyTrialEligible(c.env.DB, familyId);
  } catch {
    return c.json({ ok: false, error: "family_trial_state_unavailable" }, 503);
  }
  const now = new Date();
  const reservationRef = `${GOOGLE_PLAY_PREFLIGHT_PREFIX}${crypto.randomUUID()}`;
  let claim;
  try {
    claim = await claimBillingProvider(c.env.DB, {
      familyId,
      provider: "google_play",
      reservationRef,
      now,
    });
  } catch {
    return c.json({ ok: false, error: "billing_provider_state_unavailable" }, 503);
  }
  if (claim.status === "deferred") {
    return c.json({ ok: false, error: "billing_provider_reconciliation_pending" }, 409);
  }
  if (claim.status === "blocked") {
    return c.json({ ok: false, error: "other_billing_provider_active" }, 409);
  }
  if (claim.status === "conflict") {
    return c.json({ ok: false, error: "billing_provider_conflict" }, 409);
  }
  if (
    claim.row.state !== "reserved"
    || claim.row.reservation_ref !== reservationRef
  ) {
    return c.json({ ok: false, error: "google_play_subscription_active" }, 409);
  }
  return c.json({
    ok: true,
    reservationRef,
    trialEligible,
    expiresAt: new Date(now.getTime() + GOOGLE_PLAY_PROVIDER_RESERVATION_LEASE_MS).toISOString(),
  });
});

gplay.post("/google-play-trial-eligibility", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({})) as JsonMap;
  const familyId = asString(body.familyId);
  if (!familyId) return c.json({ ok: false, error: "invalid_request" }, 400);
  const parentId = c.get("user").sub;
  const membership = await resolveVerifiedFamilyMembership(c.env.DB, parentId, familyId);
  if (membership?.role !== "parent") return c.json({ ok: false, error: "not_allowed" }, 403);
  try {
    return c.json({
      ok: true,
      trialEligible: await isFamilyTrialEligible(c.env.DB, familyId),
    });
  } catch {
    return c.json({ ok: false, error: "family_trial_state_unavailable" }, 503);
  }
});

gplay.post("/google-play-preflight/release", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({})) as JsonMap;
  const familyId = asString(body.familyId);
  const reservationRef = asString(body.reservationRef);
  if (!familyId || !isGooglePlayPreflightRef(reservationRef)) {
    return c.json({ ok: false, error: "invalid_request" }, 400);
  }
  const parentId = c.get("user").sub;
  const membership = await resolveVerifiedFamilyMembership(c.env.DB, parentId, familyId);
  if (membership?.role !== "parent") return c.json({ ok: false, error: "not_allowed" }, 403);
  try {
    const released = await releaseBillingProviderReservation(c.env.DB, {
      familyId,
      provider: "google_play",
      reservationRef,
      now: new Date(),
    });
    return c.json({ ok: true, released });
  } catch {
    return c.json({ ok: false, error: "billing_provider_state_unavailable" }, 503);
  }
});

async function verifySubscriptionPurchase(args: {
  packageName: string;
  productId: string;
  basePlanId: string;
  offerId: string;
  purchaseToken: string;
  accessToken: string;
  expectedAccountId: string;
  expectedProfileId: string;
  restore: boolean;
}) {
  return verifyGooglePlaySubscription(args);
}

async function acknowledgeSubscription(args: {
  packageName: string;
  productId: string;
  purchaseToken: string;
  accessToken: string;
}): Promise<void> {
  const packageName = encodeURIComponent(args.packageName);
  const productId = encodeURIComponent(args.productId);
  const token = encodeURIComponent(args.purchaseToken);
  await googleJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptions/${productId}/tokens/${token}:acknowledge`,
    args.accessToken,
    { method: "POST", body: "{}" },
  );
}

async function verifyInAppPurchase(args: {
  packageName: string;
  productId: string;
  purchaseToken: string;
  accessToken: string;
  expectedAccountId: string;
  expectedProfileId: string;
}): Promise<JsonMap> {
  const packageName = encodeURIComponent(args.packageName);
  const productId = encodeURIComponent(args.productId);
  const token = encodeURIComponent(args.purchaseToken);
  const purchase = await googleJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${token}`,
    args.accessToken,
  );
  if (Number(purchase.purchaseState) !== 0) throw new Error("purchase_not_completed");
  const consumptionState = Number(purchase.consumptionState);
  if (consumptionState !== 0 && consumptionState !== 1) {
    throw new Error("invalid_consumption_state");
  }
  assertGooglePlayPurchaseOwner(purchase, args.expectedAccountId, args.expectedProfileId);
  return purchase;
}

async function consumeInAppPurchase(args: {
  packageName: string;
  productId: string;
  purchaseToken: string;
  accessToken: string;
}): Promise<void> {
  const packageName = encodeURIComponent(args.packageName);
  const productId = encodeURIComponent(args.productId);
  const token = encodeURIComponent(args.purchaseToken);
  await googleJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${token}:consume`,
    args.accessToken,
    { method: "POST", body: "{}" },
  );
}

function normalizeCreditStatus(row: JsonMap | null) {
  if (!row) return null;
  const dailyLimit = Number(row.daily_included_limit || 0);
  const dailyUsed = Number(row.daily_included_used || 0);
  const rawPurchasedNumber = Number(row.purchased_credits || 0);
  const rawPurchased = Number.isSafeInteger(rawPurchasedNumber) ? rawPurchasedNumber : 0;
  return {
    isPremium: !!row.is_premium,
    dailyIncludedLimit: dailyLimit,
    dailyIncludedUsed: dailyUsed,
    dailyIncludedRemaining: Math.max(0, dailyLimit - dailyUsed),
    purchasedCredits: Math.max(0, rawPurchased),
    purchasedCreditDebt: Math.max(0, -rawPurchased),
  };
}

// KST 오늘 날짜(YYYY-MM-DD). purchase_ai_credits 의 (now AT TIME ZONE 'Asia/Seoul')::date 직역.
function kstDateKey(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Play purchase event(PK=purchase token hash)를 원자 claim한 뒤 잔액·원장·상태를 한 batch로 확정한다.
async function purchaseAiCredits(
  env: Env,
  db: D1Database,
  args: {
    familyId: string;
    childUserId: string;
    parentId: string;
    amount: number;
    transactionId: string;
    verificationJson: string;
  },
): Promise<JsonMap> {
  const { familyId, childUserId, parentId, amount, transactionId, verificationJson } = args;
  const today = kstDateKey();
  const subIsPremium = (await resolveFamilyEntitlement(db, familyId)).isPremium;
  const includedDailyLimit = (resolveIncludedDailyLimit as (options: { isPremium: boolean }) => number)({
    isPremium: subIsPremium,
  });
  const deterministicBalanceId = `google-play-balance:${familyId}:${childUserId}`;
  const deterministicLedgerId = `google-play-credit:${transactionId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await db
      .prepare("SELECT id FROM ai_credit_balances WHERE family_id=? AND child_user_id=? LIMIT 1")
      .bind(familyId, childUserId)
      .first<{ id: string }>();
    const now = pgNow();
    const statements = [
      db.prepare(
        `SELECT CASE WHEN EXISTS(
           SELECT 1 FROM google_play_purchase_events
            WHERE purchase_token_hash=? AND family_id=? AND child_user_id=? AND parent_id=? AND status='received'
         ) THEN 1 ELSE json_extract('credit_event_not_claimable', '$') END AS ok`,
      ).bind(transactionId, familyId, childUserId, parentId),
    ];

    if (existing) {
      statements.push(db.prepare(
        `UPDATE ai_credit_balances
            SET parent_id=?,
                is_premium=?,
                daily_included_limit=?,
                daily_included_used=CASE WHEN substr(daily_reset_date,1,10)=? THEN daily_included_used ELSE 0 END,
                daily_reset_date=CASE WHEN substr(daily_reset_date,1,10)=? THEN substr(daily_reset_date,1,10) ELSE ? END,
                purchased_credits=COALESCE(purchased_credits,0)+?,
                updated_at=?
          WHERE id=? AND family_id=? AND child_user_id=?`,
      ).bind(parentId, subIsPremium ? 1 : 0, includedDailyLimit, today, today, today, amount, now, existing.id, familyId, childUserId));
    } else {
      statements.push(db.prepare(
        "INSERT INTO ai_credit_balances (id, family_id, child_user_id, parent_id, is_premium, daily_included_limit, daily_included_used, daily_reset_date, purchased_credits, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).bind(deterministicBalanceId, familyId, childUserId, parentId, subIsPremium ? 1 : 0, includedDailyLimit, 0, today, amount, now));
    }

    statements.push(
      db.prepare(
        "INSERT INTO ai_credit_ledger (id, family_id, child_user_id, parent_id, delta, reason, source, transaction_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ).bind(deterministicLedgerId, familyId, childUserId, parentId, amount, "purchase", "parent_purchase", transactionId, now),
      db.prepare(
        `UPDATE google_play_purchase_events
            SET status='credit_granted_pending_consume',verification_result=?,
                debt_applied=MIN(?,MAX(0,?-COALESCE((
                  SELECT purchased_credits FROM ai_credit_balances
                   WHERE family_id=? AND child_user_id=? LIMIT 1
                ),0))),
                granted_at=?,updated_at=?
          WHERE purchase_token_hash=? AND status='received'`,
      ).bind(
        verificationJson,
        amount,
        amount,
        familyId,
        childUserId,
        now,
        now,
        transactionId,
      ),
    );

    try {
      await db.batch(statements);
      break;
    } catch (error) {
      const event = await db
        .prepare("SELECT status FROM google_play_purchase_events WHERE purchase_token_hash=? LIMIT 1")
        .bind(transactionId)
        .first<{ status: string }>();
      if (event?.status === "credit_granted_pending_consume" || event?.status === "granted") break;
      if (attempt === 0 && !existing) continue;
      throw error;
    }
  }

  // 부모 화면(AI 크레딧 잔액) 실시간 반영 — 실결제 부여 즉시 동기화.
  await notifyPg(env, familyId, "ai_credit_balances", "UPDATE", {
    family_id: familyId, child_user_id: childUserId,
  });

  return (await db
    .prepare(
      `SELECT b.is_premium,b.daily_included_limit,b.daily_included_used,b.purchased_credits,
              COALESCE((SELECT e.debt_applied FROM google_play_purchase_events e
                         WHERE e.purchase_token_hash=? LIMIT 1),0) AS debt_applied
         FROM ai_credit_balances b
        WHERE b.family_id=? AND b.child_user_id=? LIMIT 1`,
    )
    .bind(transactionId, familyId, childUserId)
    .first<JsonMap>()) ?? {};
}

gplay.post("/google-play-verify", requireAuth, async (c) => {
  const db = c.env.DB;
  const env = c.env as BillingEnv;
  const parentId = c.get("user").sub;

  const serviceAccountJson = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "";
  const configPackageName = env.GOOGLE_PLAY_PACKAGE_NAME || PACKAGE_NAME;
  if (!isGooglePlayVerifierConfigured(env)) {
    return c.json({ ok: false, error: "google_play_not_configured" }, 503);
  }

  const body = await c.req.json().catch(() => ({})) as JsonMap;
  const familyId = asString(body.familyId);
  const childUserId = asString(body.childUserId);
  const productType = asString(body.productType);
  const productId = asString(body.productId);
  const basePlanId = asString(body.basePlanId);
  const offerTokenProvided = Object.prototype.hasOwnProperty.call(body, "offerToken");
  const offerToken = asString(body.offerToken);
  const offerId = asString(body.offerId);
  const purchaseToken = asString(body.purchaseToken);
  const providerReservationRef = asString(body.providerReservationRef);
  const packageName = asString(body.packageName) || configPackageName;
  const restore = body.restore === true;

  if (!familyId || !purchaseToken || packageName !== configPackageName) {
    return c.json({ ok: false, error: "invalid_request" }, 400);
  }
  if (productType === "subscription") {
    if (productId !== SUBSCRIPTION_PRODUCT_ID || (!restore && ![MONTHLY_BASE_PLAN_ID, ANNUAL_BASE_PLAN_ID].includes(basePlanId))) {
      return c.json({ ok: false, error: "invalid_subscription_product" }, 400);
    }
    // subscriptionsv2 응답은 offerToken을 되돌려주지 않는다. 신규 앱이 전달한 경우에는
    // 비어 있지 않은지만 확인하고, entitlement는 Google 정본 offerId/basePlanId로 검증한다.
    // 필드가 없던 기존 앱의 복원·검증 경로는 호환을 유지하며 token 값은 저장하거나 로그하지 않는다.
    if (!restore && offerTokenProvided && !offerToken) {
      return c.json({ ok: false, error: "invalid_subscription_offer" }, 400);
    }
    if (providerReservationRef && !isGooglePlayPreflightRef(providerReservationRef)) {
      return c.json({ ok: false, error: "invalid_provider_reservation" }, 400);
    }
  } else if (productType === "inapp") {
    if (!CREDIT_PRODUCTS[productId] || !childUserId) return c.json({ ok: false, error: "invalid_credit_product" }, 400);
  } else {
    return c.json({ ok: false, error: "invalid_product_type" }, 400);
  }

  // parent membership.
  const parentMembership = await resolveVerifiedFamilyMembership(db, parentId, familyId);
  if (parentMembership?.role !== "parent") return c.json({ ok: false, error: "not_allowed" }, 403);

  if (productType === "inapp") {
    const childMember = await db
      .prepare(
        "SELECT id FROM family_members WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1",
      )
      .bind(familyId, childUserId)
      .first<{ id: string }>();
    if (!childMember) return c.json({ ok: false, error: "child_not_found" }, 400);
  }

  const tokenHash = await sha256Hex(purchaseToken);
  const expectedAccountId = await sha256Hex(`hyeni-family:${familyId}`);
  const expectedProfileId = await sha256Hex(`hyeni-user:${parentId}`);

  // 토큰은 최초 가족·부모·상품에 귀속된다. 다른 가족이 탈취한 토큰으로 먼저/다시 claim하지 못한다.
  const existingEvent = await db
    .prepare("SELECT purchase_token_hash, family_id, child_user_id, parent_id, product_type, product_id, status, granted_at, verification_result FROM google_play_purchase_events WHERE purchase_token_hash=? LIMIT 1")
    .bind(tokenHash)
    .first<{
      purchase_token_hash: string;
      family_id: string;
      child_user_id: string | null;
      parent_id: string | null;
      product_type: string;
      product_id: string;
      status: string;
      granted_at: string | null;
      verification_result: string;
    }>();
  const existingOwnershipMatches = !existingEvent || !(
    existingEvent.family_id !== familyId
    || String(existingEvent.parent_id ?? "") !== parentId
    || String(existingEvent.child_user_id ?? "") !== childUserId
    || existingEvent.product_type !== productType
    || existingEvent.product_id !== productId
  );
  if (existingEvent?.granted_at && !existingOwnershipMatches) {
    return c.json({ ok: false, error: "purchase_token_claimed_by_other_family" }, 409);
  }
  if (
    existingOwnershipMatches
    && productType === "subscription"
    && existingEvent?.status === "stale_refunded"
  ) {
    return c.json({
      ok: false,
      error: "stale_purchase_refunded",
      message: "기존 Google Play 구독이 유지되며 중복 결제는 자동 환불됐어요.",
    }, 409);
  }
  const resumeCreditConsume = existingOwnershipMatches
    && productType === "inapp"
    && existingEvent?.status === "credit_granted_pending_consume";
  if (existingEvent?.granted_at && !resumeCreditConsume && !restore) {
    return c.json({
      ok: true,
      duplicate: true,
      status: existingEvent.status,
    });
  }

  let googleAccessToken: string;
  try {
    googleAccessToken = await getGoogleAccessToken(serviceAccountJson);
  } catch {
    return c.json({ ok: false, error: "google_oauth_failed" }, 502);
  }

  // Google ownership 검증에 성공한 뒤에만 received owner를 기록한다. 검증 전 선점으로
  // 원 구매자의 토큰을 막는 first-claim poisoning을 허용하지 않는다.
  const receivedVerification = JSON.stringify({ source: "google_play_purchase_verify" });
  const markPurchaseReceived = async (resolvedBasePlanId = basePlanId) => {
    if (existingEvent) {
      await db
        .prepare("UPDATE google_play_purchase_events SET family_id=?, child_user_id=?, parent_id=?, product_type=?, product_id=?, base_plan_id=?, credit_amount=?, order_id=?, status='received', granted_at=NULL, consumed_at=NULL, verification_result=?, updated_at=? WHERE purchase_token_hash=? AND granted_at IS NULL")
        .bind(familyId, childUserId || null, parentId, productType, productId, resolvedBasePlanId || null, productType === "inapp" ? CREDIT_PRODUCTS[productId] : null, null, receivedVerification, pgNow(), tokenHash)
        .run();
      return;
    }
    await db
      .prepare("INSERT INTO google_play_purchase_events (purchase_token_hash, family_id, child_user_id, parent_id, product_type, product_id, base_plan_id, credit_amount, order_id, status, verification_result, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,'received',?,?,?)")
      .bind(tokenHash, familyId, childUserId || null, parentId, productType, productId, resolvedBasePlanId || null, productType === "inapp" ? CREDIT_PRODUCTS[productId] : null, null, receivedVerification, pgNow(), pgNow())
      .run();
  };

  if (productType === "subscription") {
    let verified;
    try {
      verified = await verifySubscriptionPurchase({
        packageName,
        productId,
        basePlanId,
        offerId,
        purchaseToken,
        accessToken: googleAccessToken,
        expectedAccountId,
        expectedProfileId,
        restore,
      });
    } catch {
      return c.json({ ok: false, error: "verification_failed" }, 502);
    }
    if (![MONTHLY_BASE_PLAN_ID, ANNUAL_BASE_PLAN_ID].includes(verified.basePlanId)) {
      return c.json({ ok: false, error: "invalid_subscription_product" }, 400);
    }
    const verificationNow = new Date();
    const verificationEventAt = verificationNow.toISOString();
    const linkedPurchaseTokenHash = verified.linkedPurchaseToken
      ? await sha256Hex(verified.linkedPurchaseToken)
      : null;
    const canApplySubscription = await canApplyGooglePlayFamilySubscriptionWrite(db, {
      familyId,
      purchaseTokenHash: tokenHash,
      linkedPurchaseTokenHash,
      eventAt: verificationEventAt,
    }, verificationNow);
    if (!canApplySubscription) {
      // 현재 활성 Google 토큰과 연결되지 않은 별도 구매는 entitlement를 덮어쓰지 않는다.
      // 다만 Play가 유료 상태로 검증한 신규 주문을 단순 409로 끝내면 실제 결제만 남으므로,
      // owner mapping을 먼저 보존한 뒤 해당 주문만 revoke 환불한다.
      if (verified.status !== "expired") {
        await markPurchaseReceived(verified.basePlanId);
        const orderId = verified.orderId;
        if (!orderId) {
          await db.prepare(
            "UPDATE google_play_purchase_events SET status='stale_refund_pending',updated_at=? WHERE purchase_token_hash=?",
          ).bind(pgNow(), tokenHash).run();
          return c.json({ ok: false, error: "billing_provider_refund_failed" }, 503);
        }
        try {
          await db.prepare(
            "UPDATE google_play_purchase_events SET status='stale_refund_pending',order_id=?,updated_at=? WHERE purchase_token_hash=?",
          ).bind(orderId, pgNow(), tokenHash).run();
          await refundGooglePlayOrder({
            packageName,
            orderId,
            accessToken: googleAccessToken,
          });
          await db.prepare(
            "UPDATE google_play_purchase_events SET status='stale_refunded',order_id=?,verification_result=?,updated_at=? WHERE purchase_token_hash=?",
          ).bind(
            orderId,
            JSON.stringify({ source: "google_play_purchase_verify", outcome: "stale_refunded" }),
            pgNow(),
            tokenHash,
          ).run();
        } catch {
          return c.json({ ok: false, error: "billing_provider_refund_failed" }, 503);
        }
        return c.json({
          ok: false,
          error: "stale_purchase_refunded",
          message: "기존 Google Play 구독이 유지되며 중복 결제는 자동 환불됐어요.",
        }, 409);
      }
      return c.json({ ok: false, error: "stale_purchase_token" }, 409);
    }
    // Play 소유권 검증 직후 비권리성 received mapping을 먼저 남긴다. provider 예약 뒤
    // Worker가 중단돼도 RTDN owner 조회와 stale reservation 회수가 가능해야 한다.
    if (!restore || !existingEvent?.granted_at) {
      await markPurchaseReceived(verified.basePlanId);
    }
    let providerClaim;
    try {
      providerClaim = await claimBillingProvider(db, {
        familyId,
        provider: "google_play",
        reservationRef: tokenHash,
        expectedReservationRef: providerReservationRef || undefined,
        now: verificationNow,
      });
    } catch {
      return c.json({ ok: false, error: "billing_provider_state_unavailable" }, 503);
    }
    if (providerClaim.status === "deferred") {
      return c.json({ ok: false, error: "billing_provider_reconciliation_pending" }, 409);
    }
    if (
      (providerClaim.status === "blocked" && providerClaim.row.provider === "toss_web")
      || (
        providerClaim.status === "conflict"
        && providerClaim.row.provider === "toss_web"
        && providerClaim.row.conflicting_provider === "google_play"
      )
    ) {
      const conflictRef = providerClaim.status === "conflict"
        ? providerClaim.row.conflict_ref || verified.orderId || tokenHash
        : verified.orderId || tokenHash;
      if (verified.status === "expired") {
        await resolveBillingProviderConflictAfterRefund(db, {
          familyId,
          incumbentProvider: "toss_web",
          conflictingProvider: "google_play",
          conflictRef,
          now: verificationNow,
        });
        return c.json({
          ok: true,
          productType,
          status: verified.status,
          entitlement: null,
        });
      }
      const orderId = verified.orderId;
      if (!orderId) {
        await db.prepare(
          "UPDATE google_play_purchase_events SET status='conflict_refund_pending',updated_at=? WHERE purchase_token_hash=?",
        ).bind(pgNow(), tokenHash).run();
        return c.json({ ok: false, error: "billing_provider_refund_failed" }, 503);
      }
      try {
        await db.prepare(
          "UPDATE google_play_purchase_events SET status='conflict_refund_pending',order_id=?,updated_at=? WHERE purchase_token_hash=?",
        ).bind(orderId, pgNow(), tokenHash).run();
        await refundGooglePlayOrder({
          packageName,
          orderId,
          accessToken: googleAccessToken,
        });
        const resolved = await resolveBillingProviderConflictAfterRefund(db, {
          familyId,
          incumbentProvider: providerClaim.row.provider,
          conflictingProvider: "google_play",
          conflictRef,
          now: verificationNow,
        });
        if (!resolved) throw new Error("billing_provider_refund_resolution_failed");
        await db.prepare(
          "UPDATE google_play_purchase_events SET status='conflict_refunded',order_id=?,verification_result=?,updated_at=? WHERE purchase_token_hash=?",
        ).bind(
          orderId,
          JSON.stringify({ source: "google_play_purchase_verify", outcome: "conflict_refunded" }),
          pgNow(),
          tokenHash,
        ).run();
      } catch {
        return c.json({ ok: false, error: "billing_provider_refund_failed" }, 503);
      }
      return c.json({
        ok: false,
        error: "billing_provider_conflict_refunded",
        message: "기존 웹 구독이 유지되며 중복 Google Play 결제는 자동 환불됐어요.",
      }, 409);
    }
    if (providerClaim.status === "blocked") {
      return c.json({ ok: false, error: "billing_provider_conflict" }, 409);
    }
    if (providerClaim.status === "conflict") {
      return c.json({ ok: false, error: "billing_provider_conflict" }, 409);
    }
    if (verified.status === "trial") {
      let trialClaim;
      try {
        trialClaim = await claimGooglePlayFamilyTrial(db, {
          familyId,
          parentId,
          purchaseTokenHash: tokenHash,
          basePlanId: verified.basePlanId,
          trialEndsAt: verified.trialEndsAt ?? "",
          now: verificationNow,
        });
      } catch {
        return c.json({ ok: false, error: "family_trial_state_unavailable" }, 503);
      }
      if (trialClaim === "already_used") {
        const orderId = verified.orderId;
        if (!orderId) return c.json({ ok: false, error: "billing_provider_refund_failed" }, 503);
        try {
          await refundGooglePlayOrder({ packageName, orderId, accessToken: googleAccessToken });
          await releaseBillingProviderReservation(db, {
            familyId,
            provider: "google_play",
            reservationRef: tokenHash,
            now: verificationNow,
          });
          await db.prepare(
            "UPDATE google_play_purchase_events SET status='trial_rejected_refunded',order_id=?,updated_at=? WHERE purchase_token_hash=?",
          ).bind(orderId, pgNow(), tokenHash).run();
        } catch {
          return c.json({ ok: false, error: "billing_provider_refund_failed" }, 503);
        }
        return c.json({ ok: false, error: "family_trial_already_used" }, 409);
      }
    }
    const funnelSnapshot = c.env.PREMIUM_FUNNEL_HASH_SECRET
      ? await readGooglePlayPremiumFunnelSnapshot(db, familyId)
      : { ok: false as const };
    const funnelNow = new Date();
    // 원본 보존: acknowledge 실패는 throw(→ onError 500). entitlement 부여 전 단계라
    // 재시도가 re-verify→re-acknowledge 로 완결되며, 미승인 구매의 Play 자동환불을 막는다.
    const acknowledged = verified.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
    if (!acknowledged && ["active", "trial", "grace"].includes(verified.status)) {
      await acknowledgeSubscription({ packageName, productId, purchaseToken, accessToken: googleAccessToken });
    }

    const storedVerified = {
      ...verified,
      subscription: sanitizeGooglePlayForStorage(verified.subscription) as JsonMap,
    };
    const googleRawJson = JSON.stringify(storedVerified.subscription);
    const subscriptionOperation = await getGooglePlayFamilySubscriptionOperation(db, familyId);
    try {
      await upsertGooglePlayFamilySubscription(db, {
        familyId,
        productId: SUBSCRIPTION_PRODUCT_ID,
        purchaseTokenHash: tokenHash,
        linkedPurchaseTokenHash,
        source: "google_play_purchase_verify",
        eventAt: verificationEventAt,
        verified: storedVerified,
      }, {
        operation: subscriptionOperation,
        now: pgNow,
      });
    } catch {
      return c.json({ ok: false, error: "subscription_grant_failed" }, 500);
    }

    // 구독·provider 정본이 원자 확정된 토큰만 RTDN owner의 최신 토큰으로 승격한다.
    // stale token이나 entitlement write 실패가 owner를 먼저 되돌리면 안 된다.
    try {
      await upsertGooglePlayBillingOwner(db, {
        obfuscatedAccountId: expectedAccountId,
        obfuscatedProfileId: expectedProfileId,
        familyId,
        parentId,
        purchaseTokenHash: tokenHash,
        subscriptionEventId: tokenHash,
        now: pgNow(),
      });
    } catch {
      return c.json({ ok: false, error: "billing_owner_update_failed" }, 500);
    }

    await notifyPg(env, familyId, "family_subscription", subscriptionOperation,
      { family_id: familyId, status: verified.status }, null);

    await db
      .prepare("UPDATE google_play_purchase_events SET status=?, order_id=?, verification_result=?, granted_at=?, acknowledged_at=?, updated_at=? WHERE purchase_token_hash=?")
      .bind(verified.status, verified.orderId || null, googleRawJson, pgNow(), pgNow(), pgNow(), tokenHash)
      .run();

    if (funnelSnapshot.ok) {
      await recordGooglePlayPremiumFunnelTransition(c.env, {
        familyId,
        purchaseTokenHash: tokenHash,
        previous: funnelSnapshot.snapshot,
        verified: storedVerified,
        notificationType: null,
        occurredAt: funnelNow,
        now: funnelNow,
      });
    }

    return c.json({
      ok: true,
      productType,
      status: verified.status,
      entitlement: {
        status: verified.status,
        productId,
        basePlanId: verified.basePlanId,
        currentPeriodEnd: verified.currentPeriodEnd,
        trialEndsAt: verified.trialEndsAt,
      },
    });
  }

  // ── inapp(크레딧) ──
  let verifiedProduct: JsonMap;
  try {
    verifiedProduct = await verifyInAppPurchase({
      packageName,
      productId,
      purchaseToken,
      accessToken: googleAccessToken,
      expectedAccountId,
      expectedProfileId,
    });
  } catch {
    return c.json({ ok: false, error: "verification_failed" }, 502);
  }
  const storedVerifiedProduct = sanitizeGooglePlayForStorage(verifiedProduct) as JsonMap;
  const alreadyConsumedByGoogle = Number(verifiedProduct.consumptionState) === 1;
  if (alreadyConsumedByGoogle && !resumeCreditConsume) {
    return c.json({ ok: false, error: "purchase_already_consumed" }, 409);
  }
  if (!resumeCreditConsume) await markPurchaseReceived();
  const creditAmount = CREDIT_PRODUCTS[productId];

  let balanceRow: JsonMap;
  try {
    balanceRow = resumeCreditConsume
      ? (await db
        .prepare(
          `SELECT b.is_premium,b.daily_included_limit,b.daily_included_used,b.purchased_credits,
                  COALESCE((SELECT e.debt_applied FROM google_play_purchase_events e
                             WHERE e.purchase_token_hash=? LIMIT 1),0) AS debt_applied
             FROM ai_credit_balances b
            WHERE b.family_id=? AND b.child_user_id=? LIMIT 1`,
        )
        .bind(tokenHash, familyId, childUserId)
        .first<JsonMap>()) ?? {}
      : await purchaseAiCredits(env, db, {
        familyId,
        childUserId,
        parentId,
        amount: creditAmount,
        transactionId: tokenHash,
        verificationJson: JSON.stringify(storedVerifiedProduct),
      });
  } catch (e) {
    if ((e as { code?: string }).code === "family_entitlement_unavailable") {
      return c.json({ ok: false, error: "family_entitlement_unavailable" }, 503);
    }
    return c.json({ ok: false, error: "credit_grant_failed" }, 500);
  }

  // consume 뒤 최종 D1 update가 실패한 경우 Google은 consumptionState=1을 반환한다.
  // 로컬 pending event와 소유권이 정확히 일치할 때만 외부 consume을 반복하지 않고 복구한다.
  if (!alreadyConsumedByGoogle) {
    await consumeInAppPurchase({ packageName, productId, purchaseToken, accessToken: googleAccessToken });
  }

  await db
    .prepare("UPDATE google_play_purchase_events SET status='granted', order_id=?, verification_result=?, granted_at=COALESCE(granted_at,?), consumed_at=?, updated_at=? WHERE purchase_token_hash=? AND status='credit_granted_pending_consume'")
    .bind(asString(verifiedProduct.orderId) || null, JSON.stringify(storedVerifiedProduct), pgNow(), pgNow(), pgNow(), tokenHash)
    .run();

  const debtAppliedNumber = Number(balanceRow.debt_applied ?? 0);
  const debtApplied = Number.isSafeInteger(debtAppliedNumber)
    ? Math.min(creditAmount, Math.max(0, debtAppliedNumber))
    : 0;
  return c.json({
    ok: true,
    productType,
    productId,
    creditAmount,
    debtApplied,
    availableCreditsAdded: creditAmount - debtApplied,
    creditStatus: normalizeCreditStatus(balanceRow),
  });
});

export default gplay;
