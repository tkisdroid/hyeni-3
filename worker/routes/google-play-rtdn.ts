import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { pgTs } from "../lib/time";
import { verifyGoogleOidcJwt, GoogleOidcVerificationError } from "../lib/googleOidc";
import { parseGooglePlayRtdnEnvelope, GooglePlayRtdnPayloadError } from "../lib/googlePlayRtdn";
import type { GooglePlayRtdnEvent } from "../lib/googlePlayRtdn";
import {
  canApplyGooglePlayFamilySubscriptionWrite,
  getGoogleAccessToken,
  getGooglePlayFamilySubscriptionOperation,
  getGooglePlaySubscription,
  googleJson,
  refundGooglePlayOrder,
  prepareGooglePlayBillingOwnerUpsert,
  prepareGooglePlayFamilySubscriptionWrite,
  prepareGooglePlayProviderFinalization,
  prepareGooglePlaySubscriptionConsistencyGuard,
  sanitizeGooglePlayForStorage,
  sha256Hex,
} from "../lib/googlePlay";
import type { VerifiedGooglePlaySubscription } from "../lib/googlePlay";
import { notifyPg } from "../lib/realtime";
import {
  claimGooglePlayRtdnEvent,
  claimGooglePlayVoidedEvent,
  resolveGooglePlayRtdnOwner,
} from "../lib/googlePlayRtdnStore";
import {
  assertGooglePlayPurchaseOwner,
  isGooglePlayVerifierConfigured,
  mapGoogleSubscriptionEntitlement,
  mapGoogleSubscriptionPurchaseMetadata,
} from "../shared/googlePlaySubscription.js";
import {
  readGooglePlayPremiumFunnelSnapshot,
  recordGooglePlayPremiumFunnelTransition,
} from "../lib/googlePlayPremiumFunnel";
import {
  claimBillingProvider,
  releaseBillingProviderReservation,
  resolveBillingProviderConflictAfterRefund,
} from "../lib/billingProviderReservation.ts";
import { claimGooglePlayFamilyTrial } from "../lib/familyTrialClaim";

const PACKAGE_NAME = "com.hyeni.calendar";
const PRODUCT_ID = "hyeni_premium";
const ALLOWED_BASE_PLANS = new Set(["monthly-2900", "annual-27840"]);
type JsonMap = Record<string, unknown>;
type FetchImplementation = typeof fetch;

type RtdnDependencies = {
  verifyOidc: typeof verifyGoogleOidcJwt;
  fetchImpl: FetchImplementation;
  now: () => Date;
};

const defaultDependencies: RtdnDependencies = {
  verifyOidc: verifyGoogleOidcJwt,
  fetchImpl: fetch,
  now: () => new Date(),
};

async function markEvent(
  db: D1Database,
  messageId: string,
  claimToken: string,
  status: "retryable" | "processed" | "ignored",
  now: Date,
  familyId: string | null = null,
  errorCode: string | null = null,
): Promise<void> {
  const nowText = pgTs(now);
  const result = await db.prepare(
    "UPDATE google_play_rtdn_events SET family_id=COALESCE(?,family_id), status=?, lease_until=NULL, last_error=?, processed_at=CASE WHEN ? IN ('processed','ignored') THEN ? ELSE NULL END, updated_at=? WHERE message_id=? AND claim_token=? AND status='processing'",
  ).bind(familyId, status, errorCode, status, nowText, nowText, messageId, claimToken).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error("rtdn_claim_lost");
}

async function markVoidedEvent(
  db: D1Database,
  messageId: string,
  claimToken: string,
  status: "retryable" | "processed" | "ignored",
  now: Date,
  familyId: string | null = null,
  errorCode: string | null = null,
): Promise<void> {
  const nowText = pgTs(now);
  const result = await db.prepare(
    `UPDATE google_play_voided_purchase_events
        SET family_id=COALESCE(?,family_id),status=?,lease_until=NULL,last_error=?,
            processed_at=CASE WHEN ? IN ('processed','ignored') THEN ? ELSE NULL END,
            updated_at=?
      WHERE message_id=? AND claim_token=? AND status='processing'`,
  ).bind(
    familyId,
    status,
    errorCode,
    status,
    nowText,
    nowText,
    messageId,
    claimToken,
  ).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error("rtdn_claim_lost");
}

function readExternalIdentifiers(subscription: JsonMap): { accountId: string; profileId: string } {
  const value = subscription.externalAccountIdentifiers;
  const identifiers = value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
  return {
    accountId: typeof identifiers.obfuscatedExternalAccountId === "string" ? identifiers.obfuscatedExternalAccountId.trim() : "",
    profileId: typeof identifiers.obfuscatedExternalProfileId === "string" ? identifiers.obfuscatedExternalProfileId.trim() : "",
  };
}

async function acknowledgeSubscription(
  packageName: string,
  purchaseToken: string,
  accessToken: string,
  fetchImpl: FetchImplementation,
): Promise<void> {
  await googleJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(PRODUCT_ID)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    accessToken,
    { method: "POST", body: "{}" },
    fetchImpl,
  );
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  return match?.[1] ?? null;
}

function retryStatus(errorCode: string): 502 | 503 {
  return errorCode === "google_play_not_configured"
    || errorCode === "owner_unmapped"
    || errorCode === "rtdn_processing"
    || errorCode === "package_mismatch"
    || errorCode === "recurring_price_mismatch"
    || errorCode === "billing_provider_reconciliation_pending"
    || errorCode === "billing_provider_state_unavailable"
    || errorCode === "billing_provider_refund_failed" ? 503 : 502;
}

export function createGooglePlayRtdnRoutes(overrides: Partial<RtdnDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const routes = new Hono<{ Bindings: Env; Variables: Vars }>();

  routes.onError((error, c) => {
    if (error instanceof Error && error.message === "rtdn_claim_lost") {
      return c.json({ ok: false, error: "rtdn_claim_lost" }, 503);
    }
    return c.json({ ok: false, error: "rtdn_processing_failed" }, 500);
  });

  routes.post("/google-play-rtdn", async (c) => {
    const audience = c.env.GOOGLE_PLAY_RTDN_AUDIENCE?.trim() ?? "";
    const serviceAccountEmail = c.env.GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL?.trim() ?? "";
    if (!audience || !serviceAccountEmail) {
      return c.json({ ok: false, error: "rtdn_not_configured" }, 503);
    }
    const token = bearerToken(c.req.header("authorization"));
    if (!token) return c.json({ ok: false, error: "rtdn_invalid_token" }, 401);
    try {
      await dependencies.verifyOidc(token, {
        audience,
        serviceAccountEmail,
        fetchImpl: dependencies.fetchImpl,
        now: dependencies.now(),
      });
    } catch (error) {
      if (error instanceof GoogleOidcVerificationError && error.code === "rtdn_oidc_unavailable") {
        return c.json({ ok: false, error: error.code }, 503);
      }
      return c.json({ ok: false, error: "rtdn_invalid_token" }, 401);
    }

    let event: GooglePlayRtdnEvent;
    try {
      event = parseGooglePlayRtdnEnvelope(await c.req.json());
    } catch (error) {
      if (error instanceof GooglePlayRtdnPayloadError) return c.json({ ok: false, error: error.code }, 400);
      return c.json({ ok: false, error: "invalid_rtdn_payload" }, 400);
    }

    const now = dependencies.now();
    const tokenHash = event.kind === "test" ? null : await sha256Hex(event.purchaseToken);
    const claim = event.kind === "voided"
      ? await claimGooglePlayVoidedEvent(c.env.DB, event, tokenHash!, now)
      : await claimGooglePlayRtdnEvent(c.env.DB, event, tokenHash, now);
    if (claim.state === "complete") return c.body(null, 204);
    if (claim.state === "busy") return c.json({ ok: false, error: "rtdn_processing" }, 503);
    const claimToken = claim.claimToken;
    if (event.kind === "test") {
      await markEvent(c.env.DB, event.messageId, claimToken, "ignored", now);
      return c.body(null, 204);
    }
    if (!tokenHash) {
      await markEvent(c.env.DB, event.messageId, claimToken, "ignored", now, null, "missing_token_hash");
      return c.body(null, 204);
    }

    if (event.kind === "voided") {
      // Google RTDN productType=2는 일회성 상품이다. 구독 void는 기존 subscriptionsv2
      // 재검증 경로가 처리하므로 AI 크레딧 원장에는 적용하지 않는다.
      if (event.productType !== 2) {
        await markVoidedEvent(
          c.env.DB,
          event.messageId,
          claimToken,
          "ignored",
          now,
          null,
          "unsupported_voided_product_type",
        );
        return c.body(null, 204);
      }
      const purchase = await c.env.DB.prepare(
        `SELECT family_id,child_user_id,parent_id,product_type,credit_amount,status
           FROM google_play_purchase_events
          WHERE purchase_token_hash=? LIMIT 1`,
      ).bind(tokenHash).first<{
        family_id: string;
        child_user_id: string | null;
        parent_id: string | null;
        product_type: string;
        credit_amount: number | null;
        status: string;
      }>();
      if (!purchase) {
        await markVoidedEvent(
          c.env.DB,
          event.messageId,
          claimToken,
          "retryable",
          now,
          null,
          "voided_purchase_unmapped",
        );
        return c.json({ ok: false, error: "voided_purchase_unmapped" }, 503);
      }
      const familyId = String(purchase.family_id ?? "").trim();
      const childUserId = String(purchase.child_user_id ?? "").trim();
      const parentId = String(purchase.parent_id ?? "").trim();
      const creditAmount = Number(purchase.credit_amount ?? 0);
      if (
        purchase.product_type !== "inapp"
        || !familyId
        || !childUserId
        || !parentId
        || !Number.isSafeInteger(creditAmount)
        || creditAmount <= 0
      ) {
        await markVoidedEvent(
          c.env.DB,
          event.messageId,
          claimToken,
          "ignored",
          now,
          familyId || null,
          "voided_purchase_not_credit",
        );
        return c.body(null, 204);
      }
      if (purchase.status === "refunded") {
        await markVoidedEvent(
          c.env.DB,
          event.messageId,
          claimToken,
          "processed",
          now,
          familyId,
          "already_refunded",
        );
        return c.body(null, 204);
      }
      const nowText = pgTs(now);
      if (purchase.status === "received") {
        try {
          await c.env.DB.batch([
            c.env.DB.prepare(
              `UPDATE google_play_purchase_events
                  SET status='refunded',verification_result=?,updated_at=?
                WHERE purchase_token_hash=? AND status='received'`,
            ).bind(
              JSON.stringify({
                source: "google_play_voided_rtdn",
                productType: event.productType,
                refundType: event.refundType,
              }),
              nowText,
              tokenHash,
            ),
            c.env.DB.prepare(
              `UPDATE google_play_voided_purchase_events
                  SET family_id=?,status='processed',lease_until=NULL,last_error=NULL,
                      processed_at=?,updated_at=?
                WHERE message_id=? AND claim_token=? AND status='processing'
                  AND EXISTS(
                    SELECT 1 FROM google_play_purchase_events
                     WHERE purchase_token_hash=? AND status='refunded'
                  )`,
            ).bind(
              familyId,
              nowText,
              nowText,
              event.messageId,
              claimToken,
              tokenHash,
            ),
            c.env.DB.prepare(
              `SELECT CASE WHEN
                 EXISTS(SELECT 1 FROM google_play_purchase_events
                         WHERE purchase_token_hash=?1 AND status='refunded')
                 AND EXISTS(SELECT 1 FROM google_play_voided_purchase_events
                            WHERE message_id=?2 AND claim_token=?3 AND status='processed')
               THEN 1 ELSE json_extract('google_play_voided_received_consistency_failed','$') END AS ok`,
            ).bind(tokenHash, event.messageId, claimToken),
          ]);
        } catch {
          await markVoidedEvent(
            c.env.DB,
            event.messageId,
            claimToken,
            "retryable",
            now,
            familyId,
            "voided_credit_reversal_failed",
          );
          return c.json({ ok: false, error: "voided_credit_reversal_failed" }, 503);
        }
        return c.body(null, 204);
      }
      if (!new Set(["granted", "credit_granted_pending_consume"]).has(purchase.status)) {
        await markVoidedEvent(
          c.env.DB,
          event.messageId,
          claimToken,
          "ignored",
          now,
          familyId,
          "voided_purchase_state_unsupported",
        );
        return c.body(null, 204);
      }

      const refundLedgerId = `google-play-refund:${tokenHash}`;
      const refundTransactionId = `refund:${tokenHash}`;
      try {
        await c.env.DB.batch([
          c.env.DB.prepare(
            `UPDATE ai_credit_balances
                SET purchased_credits=COALESCE(purchased_credits,0)-?,updated_at=?
              WHERE family_id=? AND child_user_id=?
                AND EXISTS(
                  SELECT 1 FROM google_play_purchase_events gppe
                   WHERE gppe.purchase_token_hash=? AND gppe.family_id=?
                     AND gppe.child_user_id=?
                     AND gppe.status IN ('granted','credit_granted_pending_consume')
                )`,
          ).bind(
            creditAmount,
            nowText,
            familyId,
            childUserId,
            tokenHash,
            familyId,
            childUserId,
          ),
          c.env.DB.prepare(
            `INSERT INTO ai_credit_ledger
               (id,family_id,child_user_id,parent_id,delta,reason,source,
                transaction_id,created_at)
             SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1`,
          ).bind(
            refundLedgerId,
            familyId,
            childUserId,
            parentId,
            -creditAmount,
            "refund",
            "google_play_refund",
            refundTransactionId,
            nowText,
          ),
          c.env.DB.prepare(
            `UPDATE google_play_purchase_events
                SET status='refunded',verification_result=?,updated_at=?
              WHERE purchase_token_hash=?
                AND status IN ('granted','credit_granted_pending_consume')
                AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE id=?)`,
          ).bind(
            JSON.stringify({
              source: "google_play_voided_rtdn",
              productType: event.productType,
              refundType: event.refundType,
            }),
            nowText,
            tokenHash,
            refundLedgerId,
          ),
          c.env.DB.prepare(
            `UPDATE google_play_voided_purchase_events
                SET family_id=?,status='processed',lease_until=NULL,last_error=NULL,
                    processed_at=?,updated_at=?
              WHERE message_id=? AND claim_token=? AND status='processing'
                AND EXISTS(
                  SELECT 1 FROM google_play_purchase_events
                   WHERE purchase_token_hash=? AND status='refunded'
                )`,
          ).bind(
            familyId,
            nowText,
            nowText,
            event.messageId,
            claimToken,
            tokenHash,
          ),
          c.env.DB.prepare(
            `SELECT CASE WHEN
               EXISTS(SELECT 1 FROM google_play_purchase_events
                       WHERE purchase_token_hash=?1 AND status='refunded')
               AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE id=?2)
               AND EXISTS(SELECT 1 FROM google_play_voided_purchase_events
                          WHERE message_id=?3 AND claim_token=?4 AND status='processed')
             THEN 1 ELSE json_extract('google_play_voided_consistency_failed','$') END AS ok`,
          ).bind(tokenHash, refundLedgerId, event.messageId, claimToken),
        ]);
      } catch {
        await markVoidedEvent(
          c.env.DB,
          event.messageId,
          claimToken,
          "retryable",
          now,
          familyId,
          "voided_credit_reversal_failed",
        );
        return c.json({ ok: false, error: "voided_credit_reversal_failed" }, 503);
      }
      await notifyPg(c.env, familyId, "ai_credit_balances", "UPDATE", {
        family_id: familyId,
        child_user_id: childUserId,
      }, null);
      return c.body(null, 204);
    }

    let failureCode = "google_processing_failed";
    try {
      if (!isGooglePlayVerifierConfigured(c.env)) {
        failureCode = "google_play_not_configured";
        throw new Error(failureCode);
      }
      const packageName = c.env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || PACKAGE_NAME;
      if (packageName !== PACKAGE_NAME) {
        failureCode = "package_mismatch";
        throw new Error(failureCode);
      }
      const accessToken = await getGoogleAccessToken(c.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ?? "", dependencies.fetchImpl);
      const subscription = await getGooglePlaySubscription({
        packageName,
        purchaseToken: event.purchaseToken,
        accessToken,
        fetchImpl: dependencies.fetchImpl,
      });
      let metadata: ReturnType<typeof mapGoogleSubscriptionPurchaseMetadata>;
      try {
        metadata = mapGoogleSubscriptionPurchaseMetadata(subscription, PRODUCT_ID);
      } catch {
        await markEvent(c.env.DB, event.messageId, claimToken, "ignored", now, null, "product_mismatch");
        return c.body(null, 204);
      }
      const identifiers = readExternalIdentifiers(subscription);
      const linkedHash = metadata.linkedPurchaseToken ? await sha256Hex(metadata.linkedPurchaseToken) : null;
      const owner = await resolveGooglePlayRtdnOwner(c.env.DB, {
        purchaseTokenHash: tokenHash,
        linkedPurchaseTokenHash: linkedHash,
        obfuscatedAccountId: identifiers.accountId,
        obfuscatedProfileId: identifiers.profileId,
      });
      if (!owner) {
        failureCode = "owner_unmapped";
        throw new Error(failureCode);
      }
      const expectedAccountId = await sha256Hex(`hyeni-family:${owner.family_id}`);
      const expectedProfileId = await sha256Hex(`hyeni-user:${owner.parent_id}`);
      try {
        assertGooglePlayPurchaseOwner(subscription, expectedAccountId, expectedProfileId);
      } catch {
        await markEvent(c.env.DB, event.messageId, claimToken, "ignored", now, owner.family_id, "purchase_owner_mismatch");
        return c.body(null, 204);
      }
      const entitlement = mapGoogleSubscriptionEntitlement(
        subscription,
        PRODUCT_ID,
        "",
        metadata.offerId,
        now,
        expectedAccountId,
        expectedProfileId,
        true,
      );
      if (!ALLOWED_BASE_PLANS.has(entitlement.basePlanId)) {
        await markEvent(c.env.DB, event.messageId, claimToken, "ignored", now, owner.family_id, "base_plan_mismatch");
        return c.body(null, 204);
      }
      const storedSubscription = sanitizeGooglePlayForStorage(subscription) as JsonMap;
      const verified: VerifiedGooglePlaySubscription = {
        subscription: storedSubscription,
        ...metadata,
        ...entitlement,
      };
      const eventAt = new Date(Number(event.eventTimeMillis)).toISOString();
      const canApplySubscription = await canApplyGooglePlayFamilySubscriptionWrite(
        c.env.DB,
        {
          familyId: owner.family_id,
          purchaseTokenHash: tokenHash,
          linkedPurchaseTokenHash: linkedHash,
          eventAt,
        },
        now,
      );
      if (!canApplySubscription) {
        await markEvent(
          c.env.DB,
          event.messageId,
          claimToken,
          "processed",
          now,
          owner.family_id,
          "subscription_update_superseded",
        );
        return c.body(null, 204);
      }
      let providerClaim;
      try {
        providerClaim = await claimBillingProvider(c.env.DB, {
          familyId: owner.family_id,
          provider: "google_play",
          reservationRef: tokenHash,
          now,
        });
      } catch {
        failureCode = "billing_provider_state_unavailable";
        throw new Error(failureCode);
      }
      if (providerClaim.status === "deferred") {
        failureCode = "billing_provider_reconciliation_pending";
        throw new Error(failureCode);
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
          await resolveBillingProviderConflictAfterRefund(c.env.DB, {
            familyId: owner.family_id,
            incumbentProvider: "toss_web",
            conflictingProvider: "google_play",
            conflictRef,
            now,
          });
          await markEvent(
            c.env.DB,
            event.messageId,
            claimToken,
            "processed",
            now,
            owner.family_id,
            "other_provider_active",
          );
          return c.body(null, 204);
        }
        const orderId = verified.orderId;
        if (!orderId) {
          failureCode = "billing_provider_refund_failed";
          throw new Error(failureCode);
        }
        try {
          await refundGooglePlayOrder({
            packageName,
            orderId,
            accessToken,
            fetchImpl: dependencies.fetchImpl,
          });
          const resolved = await resolveBillingProviderConflictAfterRefund(c.env.DB, {
            familyId: owner.family_id,
            incumbentProvider: "toss_web",
            conflictingProvider: "google_play",
            conflictRef,
            now,
          });
          if (!resolved) throw new Error("billing_provider_refund_resolution_failed");
          await c.env.DB.prepare(
            `UPDATE google_play_purchase_events
                SET status='conflict_refunded',order_id=?,verification_result=?,updated_at=?
              WHERE purchase_token_hash=? AND family_id=?`,
          ).bind(
            orderId,
            JSON.stringify({ source: "google_play_rtdn", outcome: "conflict_refunded" }),
            pgTs(now),
            tokenHash,
            owner.family_id,
          ).run();
        } catch {
          failureCode = "billing_provider_refund_failed";
          throw new Error(failureCode);
        }
        await markEvent(
          c.env.DB,
          event.messageId,
          claimToken,
          "processed",
          now,
          owner.family_id,
          "billing_provider_conflict_refunded",
        );
        return c.body(null, 204);
      }
      if (providerClaim.status === "blocked") {
        await markEvent(
          c.env.DB,
          event.messageId,
          claimToken,
          "processed",
          now,
          owner.family_id,
          "billing_provider_conflict",
        );
        return c.body(null, 204);
      }
      if (providerClaim.status === "conflict") {
        await markEvent(
          c.env.DB,
          event.messageId,
          claimToken,
          "processed",
          now,
          owner.family_id,
          "billing_provider_conflict",
        );
        return c.body(null, 204);
      }
      if (verified.status === "trial") {
        let trialClaim;
        try {
          trialClaim = await claimGooglePlayFamilyTrial(c.env.DB, {
            familyId: owner.family_id,
            parentId: owner.parent_id,
            purchaseTokenHash: tokenHash,
            basePlanId: verified.basePlanId,
            trialEndsAt: verified.trialEndsAt ?? "",
            now,
          });
        } catch {
          failureCode = "family_trial_state_unavailable";
          throw new Error(failureCode);
        }
        if (trialClaim === "already_used") {
          const orderId = verified.orderId;
          if (!orderId) {
            failureCode = "billing_provider_refund_failed";
            throw new Error(failureCode);
          }
          try {
            await refundGooglePlayOrder({
              packageName,
              orderId,
              accessToken,
              fetchImpl: dependencies.fetchImpl,
            });
            await releaseBillingProviderReservation(c.env.DB, {
              familyId: owner.family_id,
              provider: "google_play",
              reservationRef: tokenHash,
              now,
            });
            await c.env.DB.prepare(
              `UPDATE google_play_purchase_events
                  SET status='trial_rejected_refunded',order_id=?,updated_at=?
                WHERE purchase_token_hash=? AND family_id=?`,
            ).bind(orderId, pgTs(now), tokenHash, owner.family_id).run();
          } catch {
            failureCode = "billing_provider_refund_failed";
            throw new Error(failureCode);
          }
          await markEvent(
            c.env.DB,
            event.messageId,
            claimToken,
            "processed",
            now,
            owner.family_id,
            "family_trial_already_used",
          );
          return c.body(null, 204);
        }
      }
      if (["active", "trial", "grace"].includes(verified.status)
        && verified.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
        await acknowledgeSubscription(packageName, event.purchaseToken, accessToken, dependencies.fetchImpl);
      }

      const funnelSnapshot = c.env.PREMIUM_FUNNEL_HASH_SECRET
        ? await readGooglePlayPremiumFunnelSnapshot(c.env.DB, owner.family_id)
        : { ok: false as const };
      const operation = await getGooglePlayFamilySubscriptionOperation(c.env.DB, owner.family_id);
      const nowText = pgTs(now);
      const familySubscriptionWrite = prepareGooglePlayFamilySubscriptionWrite(c.env.DB, {
        familyId: owner.family_id,
        productId: PRODUCT_ID,
        purchaseTokenHash: tokenHash,
        linkedPurchaseTokenHash: linkedHash,
        source: "google_play_rtdn",
        eventId: event.messageId,
        eventAt,
        verified,
      }, { operation, now: () => nowText });
      const purchaseEventWrite = c.env.DB.prepare(
        `INSERT INTO google_play_purchase_events
           (purchase_token_hash,family_id,child_user_id,parent_id,product_type,product_id,
            base_plan_id,credit_amount,order_id,status,verification_result,granted_at,
            acknowledged_at,created_at,updated_at)
         SELECT ?,?,NULL,?,'subscription',?,?,NULL,?,?,?,?,?,?,?
          WHERE EXISTS(
            SELECT 1 FROM family_subscription fs
             WHERE fs.family_id=? AND fs.provider='google_play'
               AND fs.purchase_token_hash=? AND fs.last_event_id=?
          )
         ON CONFLICT(purchase_token_hash) DO UPDATE SET
           family_id=excluded.family_id,
           parent_id=excluded.parent_id,
           product_type='subscription',
           product_id=excluded.product_id,
           base_plan_id=excluded.base_plan_id,
           order_id=excluded.order_id,
           status=excluded.status,
           verification_result=excluded.verification_result,
           granted_at=excluded.granted_at,
           acknowledged_at=excluded.acknowledged_at,
           updated_at=excluded.updated_at`,
      ).bind(
        tokenHash,
        owner.family_id,
        owner.parent_id,
        PRODUCT_ID,
        verified.basePlanId,
        verified.orderId || null,
        verified.status,
        JSON.stringify(storedSubscription),
        nowText,
        nowText,
        nowText,
        nowText,
        owner.family_id,
        tokenHash,
        event.messageId,
      );
      const ownerWrite = prepareGooglePlayBillingOwnerUpsert(c.env.DB, {
        obfuscatedAccountId: expectedAccountId,
        obfuscatedProfileId: expectedProfileId,
        familyId: owner.family_id,
        parentId: owner.parent_id,
        purchaseTokenHash: tokenHash,
        subscriptionEventId: event.messageId,
        now: nowText,
      });
      const claimGuard = c.env.DB.prepare(
        `SELECT CASE WHEN
           EXISTS(
             SELECT 1 FROM google_play_rtdn_events
              WHERE message_id=?1 AND claim_token=?2 AND status='processing'
           )
           AND EXISTS(
             SELECT 1 FROM users WHERE id=?3
           )
           AND EXISTS(
             SELECT 1 FROM families WHERE id=?4 AND parent_id=?3
           )
           AND NOT EXISTS(
             SELECT 1 FROM account_deletion_scopes
              WHERE (scope_type='user' AND scope_id=?3)
                 OR (scope_type='family' AND scope_id=?4)
           )
         THEN 1 ELSE json_extract('rtdn_claim_or_account_scope_lost', '$') END AS ok`,
      ).bind(event.messageId, claimToken, owner.parent_id, owner.family_id);
      const providerWrite = prepareGooglePlayProviderFinalization(c.env.DB, {
        familyId: owner.family_id,
        purchaseTokenHash: tokenHash,
        eventId: event.messageId,
        active: verified.status !== "expired",
        now: nowText,
      });
      const subscriptionConsistencyGuard = prepareGooglePlaySubscriptionConsistencyGuard(
        c.env.DB,
        {
          familyId: owner.family_id,
          purchaseTokenHash: tokenHash,
          eventId: event.messageId,
          active: verified.status !== "expired",
        },
      );
      const auxiliaryWriteGuard = c.env.DB.prepare(
        `SELECT CASE WHEN
           EXISTS(
             SELECT 1 FROM google_play_purchase_events
              WHERE purchase_token_hash=?1 AND family_id=?2
           )
           AND EXISTS(
             SELECT 1 FROM google_play_billing_owners
              WHERE obfuscated_account_id=?3 AND obfuscated_profile_id=?4
                AND family_id=?2 AND parent_id=?5 AND last_purchase_token_hash=?1
           )
         THEN 1 ELSE json_extract('google_play_auxiliary_write_guard_failed','$') END AS ok`,
      ).bind(tokenHash, owner.family_id, expectedAccountId, expectedProfileId, owner.parent_id);
      const writes = await c.env.DB.batch([
        claimGuard,
        familySubscriptionWrite,
        purchaseEventWrite,
        ownerWrite,
        providerWrite,
        subscriptionConsistencyGuard,
        auxiliaryWriteGuard,
      ]);
      if (
        Number(writes[1]?.meta?.changes ?? 0) !== 1
        || Number(writes[2]?.meta?.changes ?? 0) !== 1
        || Number(writes[3]?.meta?.changes ?? 0) !== 1
        || Number(writes[4]?.meta?.changes ?? 0) !== 1
      ) {
        failureCode = "billing_provider_state_unavailable";
        throw new Error(failureCode);
      }
      await notifyPg(c.env, owner.family_id, "family_subscription", operation,
        { family_id: owner.family_id, status: verified.status }, null, { strict: true });
      await markEvent(c.env.DB, event.messageId, claimToken, "processed", now, owner.family_id);
      if (funnelSnapshot.ok) {
        await recordGooglePlayPremiumFunnelTransition(c.env, {
          familyId: owner.family_id,
          purchaseTokenHash: tokenHash,
          previous: funnelSnapshot.snapshot,
          verified,
          notificationType: event.notificationType,
          occurredAt: new Date(Number(event.eventTimeMillis)),
          now,
        });
      }
      return c.body(null, 204);
    } catch (error) {
      if (failureCode === "google_processing_failed") {
        const message = error instanceof Error ? error.message : "";
        failureCode = message === "recurring_price_mismatch"
          ? message
          : message.startsWith("google_")
            ? message.split(":", 1)[0]
            : "google_processing_failed";
      }
      await markEvent(c.env.DB, event.messageId, claimToken, "retryable", now, null, failureCode);
      return c.json({ ok: false, error: failureCode }, retryStatus(failureCode));
    }
  });
  return routes;
}

export default createGooglePlayRtdnRoutes();
