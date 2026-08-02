import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { assertPrimaryParent, resolveVerifiedFamilyMembership } from "../db/authz";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";
import {
  WEB_BILLING_CHECKOUT_TTL_MS,
  WEB_BILLING_CLAIM_TTL_MS,
  WEB_BILLING_PLANS,
  WEB_BILLING_PROVIDER,
  WEB_BILLING_TRIAL_DAYS,
  addWebBillingPeriod,
  addWebBillingTrialPeriod,
  createWebBillingCustomerKey,
  createWebBillingOrderId,
  decryptWebBillingSecret,
  encryptWebBillingSecret,
  webBillingPlan,
} from "../shared/webBilling.js";
import {
  deleteTossBillingKey,
  issueTossBillingKey,
  TossWebBillingRequestError,
  type TossWebBillingConfig,
} from "../lib/tossWebBilling";
import {
  attemptWebBillingKeyRevocation,
  claimWebBillingRefundWebhookLookup,
  configuredWebBilling,
  finalizeInitialWebBilling,
  finalizeTrialWebBilling,
  insertChargeAttempt,
  isWebBillingTrialEligible,
  loadWebBillingCustomer,
  loadWebBillingRefundAttempt,
  reconcileWebBillingRefund,
  settleWebBillingAttempt,
} from "../lib/webBillingService";
import {
  acquireAccountMutationLeases,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
  type AccountMutationScopeLeaseResult,
} from "../lib/accountMutationScope";
import { notifyPg } from "../lib/realtime";
import { pgToIso, pgTs } from "../lib/time";
import {
  claimBillingProvider,
  releaseBillingProviderReservation,
} from "../lib/billingProviderReservation.ts";
import { readCommerceRuntimeControls } from "../lib/commerceRuntimeControls.ts";

type WebBillingPlan = "month" | "year";
type FetchLike = typeof fetch;

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const CUSTOMER_KEY = /^[A-Za-z0-9_=.@-]{2,50}$/;
// Toss 공식 계약은 authKey 길이만 보장한다. JSON body로 전달하되 공백·제어문자는 거부한다.
const AUTH_KEY = /^[\x21-\x7E]{1,300}$/;
const ORDER_ID = /^[A-Za-z0-9_-]{6,64}$/;
const WEBHOOK_BODY_MAX_BYTES = 64 * 1024;
const WEBHOOK_PROVIDER_TIMEOUT_MS = 8_000;

interface CheckoutSessionRow {
  id: string;
  family_id: string;
  parent_id: string;
  customer_key: string;
  plan: WebBillingPlan;
  amount: number;
  trial_eligible: number;
  trial_days: number;
  status: "pending" | "processing" | "completed" | "failed" | "expired";
  expires_at: string;
  claim_token: string | null;
  claim_expires_at: string | null;
  error_code: string | null;
  created_at: string;
}

interface InitialAttemptPeriod {
  period_start: string;
  period_end: string;
  status: string;
}

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const BODY_TOO_LARGE = Symbol("body_too_large");

async function jsonBody(
  c: { req: { raw: Request; header: (name: string) => string | undefined } },
  maxBytes = 16 * 1024,
): Promise<Record<string, unknown> | null | typeof BODY_TOO_LARGE> {
  const declaredLength = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return BODY_TOO_LARGE;
  const reader = c.req.raw.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return BODY_TOO_LARGE;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return bodyRecord(JSON.parse(text));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function activeParent(
  db: D1Database,
  userId: string,
  familyId: string,
): Promise<boolean> {
  if (!ID.test(userId) || !ID.test(familyId)) return false;
  const membership = await resolveVerifiedFamilyMembership(db, userId, familyId);
  return membership?.role === "parent";
}

async function acquireFamilyMutationLeases(
  db: D1Database,
  familyId: string,
  callerId: string,
): Promise<AccountMutationScopeLeaseResult | null> {
  const scopes = await loadFamilyNotificationMutationScopes(db, familyId, [callerId]);
  return scopes ? acquireAccountMutationLeases(db, scopes) : null;
}

async function checkoutSession(
  db: D1Database,
  sessionId: string,
): Promise<CheckoutSessionRow | null> {
  return db.prepare(
    `SELECT id,family_id,parent_id,customer_key,plan,amount,trial_eligible,trial_days,status,expires_at,
            claim_token,claim_expires_at,error_code,created_at
       FROM web_billing_checkout_sessions WHERE id=? LIMIT 1`,
  ).bind(sessionId).first<CheckoutSessionRow>();
}

async function recoverableCheckoutSession(
  db: D1Database,
  familyId: string,
  parentId: string,
  customerKey: string,
): Promise<CheckoutSessionRow | null> {
  return db.prepare(
    `SELECT id,family_id,parent_id,customer_key,plan,amount,trial_eligible,trial_days,status,expires_at,
            claim_token,claim_expires_at,error_code,created_at
       FROM web_billing_checkout_sessions
      WHERE family_id=? AND parent_id=? AND customer_key=?
        AND status IN ('pending','processing','completed')
      ORDER BY datetime(substr(created_at,1,19)) DESC, id DESC
      LIMIT 1`,
  ).bind(familyId, parentId, customerKey).first<CheckoutSessionRow>();
}

async function initialAttemptPeriod(
  db: D1Database,
  sessionId: string,
): Promise<InitialAttemptPeriod | null> {
  return db.prepare(
    `SELECT period_start,period_end,status
       FROM web_billing_charge_attempts
      WHERE checkout_session_id=? AND kind='initial' LIMIT 1`,
  ).bind(sessionId).first<InitialAttemptPeriod>();
}

async function claimCheckoutSession(
  db: D1Database,
  session: CheckoutSessionRow,
  now: Date,
): Promise<string | null> {
  const token = crypto.randomUUID();
  const nowPg = pgTs(now);
  const claimExpiresAt = pgTs(new Date(now.getTime() + WEB_BILLING_CLAIM_TTL_MS));
  const result = await db.prepare(
    `UPDATE web_billing_checkout_sessions
        SET status='processing', claim_token=?, claim_expires_at=?, updated_at=?
      WHERE id=? AND family_id=? AND parent_id=? AND customer_key=?
        AND (
          datetime(substr(expires_at,1,19))>datetime(substr(?,1,19))
          OR EXISTS(
            SELECT 1 FROM web_billing_charge_attempts a
             WHERE a.checkout_session_id=web_billing_checkout_sessions.id
               AND a.kind='initial' AND a.status IN ('processing','unknown','done')
          )
          OR (
            trial_eligible=1
            AND EXISTS(
              SELECT 1 FROM web_billing_customers c
               WHERE c.family_id=web_billing_checkout_sessions.family_id
                 AND c.parent_id=web_billing_checkout_sessions.parent_id
                 AND c.customer_key=web_billing_checkout_sessions.customer_key
                 AND c.status='pending_charge' AND c.trial_ends_at IS NOT NULL
                 AND c.billing_key_ciphertext IS NOT NULL
                 AND c.billing_key_iv IS NOT NULL AND c.billing_key_version='v1'
            )
          )
        )
        AND (
          status='pending'
          OR (status='processing' AND datetime(substr(claim_expires_at,1,19))<=datetime(substr(?,1,19)))
          OR (
            status='expired' AND trial_eligible=1
            AND EXISTS(
              SELECT 1 FROM web_billing_customers c
               WHERE c.family_id=web_billing_checkout_sessions.family_id
                 AND c.parent_id=web_billing_checkout_sessions.parent_id
                 AND c.customer_key=web_billing_checkout_sessions.customer_key
                 AND c.status='pending_charge' AND c.trial_ends_at IS NOT NULL
                 AND c.billing_key_ciphertext IS NOT NULL
                 AND c.billing_key_iv IS NOT NULL AND c.billing_key_version='v1'
            )
          )
        )`,
  ).bind(
    token,
    claimExpiresAt,
    nowPg,
    session.id,
    session.family_id,
    session.parent_id,
    session.customer_key,
    nowPg,
    nowPg,
  ).run();
  return Number(result.meta?.changes ?? 0) === 1 ? token : null;
}

async function releaseCheckoutClaim(
  db: D1Database,
  sessionId: string,
  claimToken: string,
  nextStatus: "pending" | "failed",
  errorCode: string | null,
  now: Date,
): Promise<void> {
  await db.prepare(
    `UPDATE web_billing_checkout_sessions
        SET status=?, claim_token=NULL, claim_expires_at=NULL, error_code=?, updated_at=?
      WHERE id=? AND claim_token=? AND status='processing'`,
  ).bind(nextStatus, errorCode, pgTs(now), sessionId, claimToken).run();
}

async function closeIneligiblePersistedTrial(
  env: Env,
  input: {
    sessionId: string;
    sessionClaimToken: string;
    familyId: string;
    parentId: string;
    customerKey: string;
    now: Date;
    config: TossWebBillingConfig | null;
    fetchImpl?: FetchLike;
  },
): Promise<void> {
  const nowPg = pgTs(input.now);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE web_billing_customers
          SET status='expired',next_charge_at=NULL,retry_after=NULL,
              billing_key_revocation_status='pending',
              billing_key_revocation_attempts=0,billing_key_revocation_retry_at=?,
              billing_key_revocation_error=NULL,billing_key_revoked_at=NULL,updated_at=?
        WHERE family_id=? AND parent_id=? AND customer_key=? AND status='pending_charge'
          AND billing_key_ciphertext IS NOT NULL
          AND billing_key_iv IS NOT NULL AND billing_key_version='v1'`,
    ).bind(
      nowPg,
      nowPg,
      input.familyId,
      input.parentId,
      input.customerKey,
    ),
    env.DB.prepare(
      `UPDATE web_billing_checkout_sessions
          SET status='failed',claim_token=NULL,claim_expires_at=NULL,
              error_code='WEB_BILLING_TRIAL_STATE_CHANGED',updated_at=?
        WHERE id=? AND family_id=? AND parent_id=? AND customer_key=?
          AND status='processing' AND claim_token=?`,
    ).bind(
      nowPg,
      input.sessionId,
      input.familyId,
      input.parentId,
      input.customerKey,
      input.sessionClaimToken,
    ),
  ]);
  await attemptWebBillingKeyRevocation(env, {
    familyId: input.familyId,
    now: input.now,
    fetchImpl: input.fetchImpl,
    config: input.config,
    force: true,
  });
}

function completedPayload(plan: WebBillingPlan, currentPeriodEnd: string) {
  return {
    ok: true as const,
    status: "active" as const,
    plan,
    currentPeriodEnd: pgToIso(currentPeriodEnd),
  };
}

function completedTrialPayload(plan: WebBillingPlan, trialEndsAt: string) {
  const end = pgToIso(trialEndsAt);
  return {
    ok: true as const,
    status: "trial" as const,
    plan,
    trialDays: WEB_BILLING_TRIAL_DAYS,
    trialEndsAt: end,
    nextChargeAt: end,
  };
}

function futureWebBillingEnd(value: string | null, now: Date): boolean {
  if (!value) return false;
  const endMs = Date.parse(pgToIso(value));
  return Number.isFinite(endMs) && endMs > now.getTime();
}

function hasCompletedPaidAccess(
  customer: { status: string; current_period_end: string | null },
  now: Date,
): customer is { status: string; current_period_end: string } {
  return ["active", "past_due", "cancel_at_period_end"].includes(customer.status)
    && futureWebBillingEnd(customer.current_period_end, now);
}

export function createWebBillingRoutes(options: { fetchImpl?: FetchLike; now?: () => Date } = {}) {
  const routes = new Hono<{ Bindings: Env; Variables: Vars }>();

  // Toss 일반 결제 웹훅에는 신뢰할 서명이 없다. body에서는 알려진 orderId만 힌트로 받고
  // 저장된 주문과 Toss 조회 Payment가 모두 일치한 경우에만 환불 정본을 변경한다.
  routes.post("/web/subscription/webhook", async (c) => {
    const body = await jsonBody(c, WEBHOOK_BODY_MAX_BYTES);
    if (body === BODY_TOO_LARGE) return c.json({ ok: false }, 413);
    const data = bodyRecord(body?.data);
    const orderId = body?.eventType === "PAYMENT_STATUS_CHANGED"
      && typeof data?.orderId === "string"
      ? data.orderId
      : "";
    if (!ORDER_ID.test(orderId)) return c.json({ ok: true, accepted: false });

    try {
      let attempt = await loadWebBillingRefundAttempt(c.env.DB, orderId);
      if (!attempt) return c.json({ ok: true, accepted: false });
      const now = options.now?.() ?? new Date();
      const scopes = await loadFamilyNotificationMutationScopes(c.env.DB, attempt.family_id);
      if (!scopes) return c.json({ ok: false, accepted: true, settled: false }, 503);
      const leaseResult = await acquireAccountMutationLeases(c.env.DB, scopes);
      if (leaseResult.status !== "acquired") {
        c.header("Retry-After", "60");
        return c.json({ ok: false, accepted: true, settled: false }, 503);
      }
      try {
        if (attempt.refund_status !== "full") {
          const claimed = await claimWebBillingRefundWebhookLookup(c.env.DB, orderId, now);
          if (!claimed) {
            attempt = await loadWebBillingRefundAttempt(c.env.DB, orderId);
            if (attempt?.refund_status !== "full") {
              c.header("Retry-After", "60");
              return c.json({ ok: false, accepted: true, settled: false, deferred: true }, 429);
            }
          }
        }
        const result = await reconcileWebBillingRefund(c.env, {
          orderId,
          now,
          fetchImpl: options.fetchImpl,
          lookupTimeoutMs: WEBHOOK_PROVIDER_TIMEOUT_MS,
        });
        return c.json({
          ok: true,
          accepted: true,
          settled: true,
          status: result.status,
        });
      } finally {
        await releaseAccountMutationLeases(c.env.DB, leaseResult.leases);
      }
    } catch {
      // provider code/message와 내부 SQL 오류는 공개 webhook 응답에 포함하지 않는다.
      return c.json({ ok: false, accepted: true, settled: false }, 503);
    }
  });

  routes.get("/web/catalog", requireAuth, async (c) => {
    const familyId = c.req.query("familyId") ?? "";
    const userId = c.get("user").sub;
    if (!(await activeParent(c.env.DB, userId, familyId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const controls = await readCommerceRuntimeControls(c.env.DB);
    if (!controls.webSubscriptionNewCheckoutsEnabled) {
      c.header("Cache-Control", "no-store");
      c.header("Retry-After", "300");
      return c.json({ error: "web_subscription_new_checkouts_paused" }, 503);
    }
    if (!configuredWebBilling(c.env)) {
      return c.json({ error: "web_billing_unavailable" }, 503);
    }
    try {
      const entitlement = await resolveFamilyEntitlement(c.env.DB, familyId);
      const trialEligible = !entitlement.isPremium
        && await isWebBillingTrialEligible(c.env.DB, familyId);
      return c.json({
        provider: "toss_payments",
        trialEligible,
        trialDays: trialEligible ? WEB_BILLING_TRIAL_DAYS : 0,
        plans: {
          month: {
            amount: WEB_BILLING_PLANS.month.amount,
            displayPrice: WEB_BILLING_PLANS.month.displayPrice,
          },
          year: {
            amount: WEB_BILLING_PLANS.year.amount,
            displayPrice: WEB_BILLING_PLANS.year.displayPrice,
          },
        },
        currency: "KRW",
      });
    } catch {
      return c.json({ error: "web_billing_state_unavailable" }, 503);
    }
  });

  routes.post("/web/checkout-session", requireAuth, async (c) => {
    const body = await jsonBody(c);
    if (body === BODY_TOO_LARGE) return c.json({ error: "request_too_large" }, 413);
    const familyId = typeof body?.familyId === "string" ? body.familyId.trim() : "";
    const plan = webBillingPlan(body?.plan) as WebBillingPlan | null;
    const trialExpected = typeof body?.trialExpected === "boolean" ? body.trialExpected : null;
    const userId = c.get("user").sub;
    if (!plan || !ID.test(familyId) || trialExpected === null) {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (!(await activeParent(c.env.DB, userId, familyId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const controls = await readCommerceRuntimeControls(c.env.DB);
    if (!controls.webSubscriptionNewCheckoutsEnabled) {
      c.header("Cache-Control", "no-store");
      c.header("Retry-After", "300");
      return c.json({ error: "web_subscription_new_checkouts_paused" }, 503);
    }
    const config = configuredWebBilling(c.env);
    if (!config) return c.json({ error: "web_billing_unavailable" }, 503);

    const leaseResult = await acquireFamilyMutationLeases(c.env.DB, familyId, userId);
    if (!leaseResult || leaseResult.status !== "acquired") {
      return c.json({
        error: leaseResult?.status === "blocked"
          ? "account_mutation_blocked"
          : "account_mutation_unavailable",
      }, leaseResult?.status === "blocked" ? 409 : 503);
    }
    try {
      if (!(await activeParent(c.env.DB, userId, familyId))) {
        return c.json({ error: "forbidden" }, 403);
      }
      const entitlement = await resolveFamilyEntitlement(c.env.DB, familyId);
      if (entitlement.isPremium) {
        return c.json({ error: "subscription_already_active" }, 409);
      }
      const trialEligible = await isWebBillingTrialEligible(c.env.DB, familyId);
      if (trialEligible !== trialExpected) {
        return c.json({ error: "web_billing_trial_state_changed" }, 409);
      }
      const pendingTrialCustomer = await loadWebBillingCustomer(c.env.DB, familyId);
      if (
        pendingTrialCustomer?.billing_key_ciphertext
        && pendingTrialCustomer.billing_key_iv
        && pendingTrialCustomer.billing_key_version === "v1"
        && (
          pendingTrialCustomer.billing_key_revocation_status === "pending"
          || (
            trialEligible
            && pendingTrialCustomer.status === "pending_charge"
            && Boolean(pendingTrialCustomer.trial_ends_at)
          )
        )
      ) {
        // 저장된 체험은 기존 complete/cron으로 복구하고, 폐기 대기 키는 원격
        // 삭제가 끝날 때까지 보존한다. 새 세션이 덮어쓰면 복구 수단이 사라진다.
        return c.json({ error: "web_billing_reconciliation_pending" }, 409);
      }
      const now = new Date();
      const nowPg = pgTs(now);
      await c.env.DB.prepare(
        `UPDATE web_billing_checkout_sessions
            SET status='expired', claim_token=NULL, claim_expires_at=NULL, updated_at=?
          WHERE family_id=? AND parent_id=? AND status IN ('pending','processing')
            AND datetime(substr(expires_at,1,19))<=datetime(substr(?,1,19))`,
      ).bind(nowPg, familyId, userId, nowPg).run();

      // 외부 청구 시도와 연결되지 않은 종료 session은 결제 증적이 아니므로 즉시 정리한다.
      // 같은 부모가 checkout 화면을 반복해서 열어도 UUID 행이 무제한 쌓이지 않게 한다.
      await c.env.DB.prepare(
        `DELETE FROM web_billing_checkout_sessions
          WHERE family_id=? AND parent_id=? AND status IN ('failed','expired')
            AND NOT EXISTS(
              SELECT 1 FROM web_billing_charge_attempts a
               WHERE a.checkout_session_id=web_billing_checkout_sessions.id
            )`,
      ).bind(familyId, userId).run();

      const reusable = await c.env.DB.prepare(
        `SELECT id,family_id,parent_id,customer_key,plan,amount,trial_eligible,trial_days,status,expires_at,
                claim_token,claim_expires_at,error_code,created_at
           FROM web_billing_checkout_sessions
          WHERE family_id=? AND parent_id=? AND plan=? AND trial_eligible=?
            AND status IN ('pending','processing')
            AND datetime(substr(expires_at,1,19))>datetime(substr(?,1,19))
          ORDER BY datetime(substr(created_at,1,19)) DESC, id DESC
          LIMIT 1`,
      ).bind(familyId, userId, plan, trialEligible ? 1 : 0, nowPg).first<CheckoutSessionRow>();
      if (reusable) {
        const selected = WEB_BILLING_PLANS[reusable.plan];
        return c.json({
          sessionId: reusable.id,
          customerKey: reusable.customer_key,
          clientKey: config.clientKey,
          plan: reusable.plan,
          amount: reusable.amount,
          displayPrice: selected.displayPrice,
          trialEligible: reusable.trial_eligible === 1,
          trialDays: reusable.trial_days,
          expiresAt: pgToIso(reusable.expires_at),
        });
      }

      const sessionId = crypto.randomUUID();
      const customerKey = createWebBillingCustomerKey();
      const expiresAt = new Date(now.getTime() + WEB_BILLING_CHECKOUT_TTL_MS);
      const selected = WEB_BILLING_PLANS[plan];
      await c.env.DB.prepare(
        `INSERT INTO web_billing_checkout_sessions
           (id,family_id,parent_id,customer_key,plan,amount,trial_eligible,trial_days,
            status,expires_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?, 'pending',?,?,?)`,
      ).bind(
        sessionId,
        familyId,
        userId,
        customerKey,
        plan,
        selected.amount,
        trialEligible ? 1 : 0,
        trialEligible ? WEB_BILLING_TRIAL_DAYS : 0,
        pgTs(expiresAt),
        nowPg,
        nowPg,
      ).run();
      return c.json({
        sessionId,
        customerKey,
        clientKey: config.clientKey,
        plan,
        amount: selected.amount,
        displayPrice: selected.displayPrice,
        trialEligible,
        trialDays: trialEligible ? WEB_BILLING_TRIAL_DAYS : 0,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      const entitlementError = error as Error & { code?: string };
      return c.json({
        error: entitlementError.code === "family_entitlement_unavailable"
          ? "family_entitlement_unavailable"
          : "web_billing_checkout_unavailable",
      }, 503);
    } finally {
      await releaseAccountMutationLeases(c.env.DB, leaseResult.leases);
    }
  });

  routes.post("/web/checkout-session/resolve", requireAuth, async (c) => {
    const body = await jsonBody(c);
    if (body === BODY_TOO_LARGE) return c.json({ error: "request_too_large" }, 413);
    const familyId = typeof body?.familyId === "string" ? body.familyId.trim() : "";
    const customerKey = typeof body?.customerKey === "string" ? body.customerKey : "";
    const userId = c.get("user").sub;
    if (!ID.test(familyId) || !CUSTOMER_KEY.test(customerKey)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (!(await activeParent(c.env.DB, userId, familyId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    try {
      const session = await recoverableCheckoutSession(c.env.DB, familyId, userId, customerKey);
      if (!session) return c.json({ error: "web_billing_session_not_found" }, 404);
      c.header("Cache-Control", "no-store");
      return c.json({ sessionId: session.id, customerKey: session.customer_key });
    } catch {
      return c.json({ error: "web_billing_session_resolution_unavailable" }, 503);
    }
  });

  routes.post("/web/complete", requireAuth, async (c) => {
    const body = await jsonBody(c);
    if (body === BODY_TOO_LARGE) return c.json({ error: "request_too_large" }, 413);
    const familyId = typeof body?.familyId === "string" ? body.familyId.trim() : "";
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    // provider가 session에 결합한 customerKey 원문과 정확히 비교한다.
    // trim으로 공백을 숨겨 허용문자 검증을 우회시키지 않는다.
    const customerKey = typeof body?.customerKey === "string" ? body.customerKey : "";
    const authKey = typeof body?.authKey === "string" ? body.authKey : "";
    const hasAuthKey = AUTH_KEY.test(authKey);
    const userId = c.get("user").sub;
    if (
      !ID.test(familyId)
      || !SESSION_ID.test(sessionId)
      || !CUSTOMER_KEY.test(customerKey)
      || (authKey !== "" && !hasAuthKey)
    ) return c.json({ error: "invalid_request" }, 400);
    if (!(await activeParent(c.env.DB, userId, familyId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const config = configuredWebBilling(c.env);
    if (!config) return c.json({ error: "web_billing_unavailable" }, 503);

    const leaseResult = await acquireFamilyMutationLeases(c.env.DB, familyId, userId);
    if (!leaseResult || leaseResult.status !== "acquired") {
      return c.json({
        error: leaseResult?.status === "blocked"
          ? "account_mutation_blocked"
          : "account_mutation_unavailable",
      }, leaseResult?.status === "blocked" ? 409 : 503);
    }
    let checkoutClaimToken: string | null = null;
    try {
      if (!(await activeParent(c.env.DB, userId, familyId))) {
        return c.json({ error: "forbidden" }, 403);
      }
      let session = await checkoutSession(c.env.DB, sessionId);
      if (
        !session
        || session.family_id !== familyId
        || session.parent_id !== userId
        || session.customer_key !== customerKey
      ) return c.json({ error: "web_billing_session_not_found" }, 404);
      const customer = await loadWebBillingCustomer(c.env.DB, familyId);
      const recoverablePersistedTrial = session.trial_eligible === 1
        && customer?.parent_id === userId
        && customer.customer_key === customerKey
        && customer.status === "pending_charge"
        && Boolean(customer.trial_ends_at)
        && Boolean(customer.billing_key_ciphertext)
        && Boolean(customer.billing_key_iv)
        && customer.billing_key_version === "v1";
      if (session.status === "completed") {
        if (!customer || customer.customer_key !== customerKey) {
          return c.json({ error: "web_billing_state_unavailable" }, 503);
        }
        const completedNow = options.now?.() ?? new Date();
        if (
          customer.status === "trial"
          && customer.trial_ends_at
          && futureWebBillingEnd(customer.trial_ends_at, completedNow)
        ) {
          return c.json(completedTrialPayload(session.plan, customer.trial_ends_at));
        }
        if (!hasCompletedPaidAccess(customer, completedNow)) {
          return c.json({ error: "web_billing_session_expired" }, 410);
        }
        return c.json(completedPayload(session.plan, customer.current_period_end));
      }
      if (session.status === "failed" || (session.status === "expired" && !recoverablePersistedTrial)) {
        return c.json({ error: "web_billing_session_expired" }, 410);
      }
      const unresolvedOtherOrder = await c.env.DB.prepare(
        `SELECT 1 AS pending
           FROM web_billing_charge_attempts
          WHERE family_id=?
            AND status IN ('pending','processing','unknown')
            AND (checkout_session_id IS NULL OR checkout_session_id<>?)
          LIMIT 1`,
      ).bind(familyId, session.id).first<{ pending: number }>();
      if (unresolvedOtherOrder) {
        return c.json({ error: "web_billing_reconciliation_pending" }, 409);
      }

      const now = new Date();
      checkoutClaimToken = await claimCheckoutSession(c.env.DB, session, now);
      if (!checkoutClaimToken) {
        session = await checkoutSession(c.env.DB, sessionId) ?? session;
        if (session.status === "completed") {
          const completedCustomer = await loadWebBillingCustomer(c.env.DB, familyId);
          if (
            completedCustomer?.status === "trial"
            && completedCustomer.trial_ends_at
            && futureWebBillingEnd(completedCustomer.trial_ends_at, now)
          ) {
            return c.json(completedTrialPayload(session.plan, completedCustomer.trial_ends_at));
          }
          if (completedCustomer && hasCompletedPaidAccess(completedCustomer, now)) {
            return c.json(completedPayload(session.plan, completedCustomer.current_period_end));
          }
          return c.json({ error: "web_billing_session_expired" }, 410);
        }
        const expiresMs = Date.parse(pgToIso(session.expires_at));
        if (
          Number.isFinite(expiresMs)
          && expiresMs <= now.getTime()
          && !recoverablePersistedTrial
          && !(await initialAttemptPeriod(c.env.DB, sessionId))
        ) {
          await c.env.DB.prepare(
            `UPDATE web_billing_checkout_sessions SET status='expired', updated_at=? WHERE id=? AND status='pending'`,
          ).bind(pgTs(now), sessionId).run();
          return c.json({ error: "web_billing_session_expired" }, 410);
        }
        return c.json({ error: "web_billing_processing" }, 409);
      }

      const entitlement = await resolveFamilyEntitlement(c.env.DB, familyId);
      if (entitlement.isPremium) {
        if (recoverablePersistedTrial) {
          await closeIneligiblePersistedTrial(c.env, {
            sessionId,
            sessionClaimToken: checkoutClaimToken,
            familyId,
            parentId: userId,
            customerKey,
            now,
            config,
            fetchImpl: options.fetchImpl,
          });
        } else {
          await releaseCheckoutClaim(
            c.env.DB,
            sessionId,
            checkoutClaimToken,
            "failed",
            "SUBSCRIPTION_ALREADY_ACTIVE",
            now,
          );
        }
        checkoutClaimToken = null;
        return c.json({ error: "subscription_already_active" }, 409);
      }
      if (session.trial_eligible === 1 && !(await isWebBillingTrialEligible(c.env.DB, familyId))) {
        if (recoverablePersistedTrial) {
          await closeIneligiblePersistedTrial(c.env, {
            sessionId,
            sessionClaimToken: checkoutClaimToken,
            familyId,
            parentId: userId,
            customerKey,
            now,
            config,
            fetchImpl: options.fetchImpl,
          });
        } else {
          await releaseCheckoutClaim(
            c.env.DB,
            sessionId,
            checkoutClaimToken,
            "failed",
            "WEB_BILLING_TRIAL_STATE_CHANGED",
            now,
          );
        }
        checkoutClaimToken = null;
        return c.json({ error: "web_billing_trial_state_changed" }, 409);
      }

      let billingKey: string;
      let allowCharge = true;
      let currentCustomer = await loadWebBillingCustomer(c.env.DB, familyId);
      if (
        currentCustomer?.customer_key === customerKey
        && currentCustomer.billing_key_ciphertext
        && currentCustomer.billing_key_iv
        && currentCustomer.billing_key_version === "v1"
      ) {
        const providerClaim = await claimBillingProvider(c.env.DB, {
          familyId,
          provider: "toss_web",
          reservationRef: session.id,
          now,
        });
        if (providerClaim.status === "deferred") {
          await releaseCheckoutClaim(
            c.env.DB,
            sessionId,
            checkoutClaimToken,
            "pending",
            "BILLING_PROVIDER_RECONCILIATION_PENDING",
            now,
          );
          checkoutClaimToken = null;
          return c.json({ error: "billing_provider_reconciliation_pending" }, 409);
        }
        allowCharge = providerClaim.status === "acquired" || providerClaim.status === "same_provider";
        billingKey = await decryptWebBillingSecret(config.encryptionSecret, {
          version: currentCustomer.billing_key_version,
          iv: currentCustomer.billing_key_iv,
          ciphertext: currentCustomer.billing_key_ciphertext,
        }, familyId, customerKey);
      } else {
        if (!hasAuthKey) {
          await releaseCheckoutClaim(
            c.env.DB,
            sessionId,
            checkoutClaimToken,
            "pending",
            "AUTHORIZATION_REQUIRED",
            now,
          );
          checkoutClaimToken = null;
          return c.json({ error: "web_billing_authorization_required" }, 409);
        }
        const providerClaim = await claimBillingProvider(c.env.DB, {
          familyId,
          provider: "toss_web",
          reservationRef: session.id,
          now,
        });
        if (providerClaim.status === "deferred") {
          await releaseCheckoutClaim(
            c.env.DB,
            sessionId,
            checkoutClaimToken,
            "pending",
            "BILLING_PROVIDER_RECONCILIATION_PENDING",
            now,
          );
          checkoutClaimToken = null;
          return c.json({ error: "billing_provider_reconciliation_pending" }, 409);
        }
        if (providerClaim.status === "blocked" || providerClaim.status === "conflict") {
          await releaseCheckoutClaim(
            c.env.DB,
            sessionId,
            checkoutClaimToken,
            "failed",
            "BILLING_PROVIDER_CONFLICT",
            now,
          );
          checkoutClaimToken = null;
          return c.json({ error: "subscription_already_active" }, 409);
        }
        let issued: { billingKey: string };
        try {
          issued = await issueTossBillingKey(config, { authKey, customerKey }, options.fetchImpl);
        } catch (error) {
          const code = error instanceof TossWebBillingRequestError
            ? error.code
            : "TOSS_AUTHORIZATION_FAILED";
          await releaseCheckoutClaim(c.env.DB, sessionId, checkoutClaimToken, "failed", code, now);
          await releaseBillingProviderReservation(c.env.DB, {
            familyId,
            provider: "toss_web",
            reservationRef: session.id,
            now,
          });
          checkoutClaimToken = null;
          return c.json({ error: "web_billing_authorization_failed" }, 400);
        }
        try {
          const encrypted = await encryptWebBillingSecret(
            config.encryptionSecret,
            issued.billingKey,
            familyId,
            customerKey,
          );
          const pendingTrialEnd = session.trial_eligible === 1
            ? pgTs(addWebBillingTrialPeriod(now))
            : null;
          const customerWrite = await c.env.DB.prepare(
            `INSERT INTO web_billing_customers
               (family_id,parent_id,customer_key,billing_key_ciphertext,billing_key_iv,
                billing_key_version,plan,status,trial_ends_at,failure_count,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,'pending_charge',?,0,?,?)
             ON CONFLICT(family_id) DO UPDATE SET
               parent_id=excluded.parent_id,
               customer_key=excluded.customer_key,
               billing_key_ciphertext=excluded.billing_key_ciphertext,
               billing_key_iv=excluded.billing_key_iv,
               billing_key_version=excluded.billing_key_version,
               plan=excluded.plan,
               status='pending_charge',
               trial_ends_at=excluded.trial_ends_at,
               current_period_end=NULL,
               next_charge_at=NULL,
               retry_after=NULL,
               failure_count=0,
               cancelled_at=NULL,
               last_order_id=NULL,
               updated_at=excluded.updated_at
             WHERE web_billing_customers.status='expired'
                OR (
                  web_billing_customers.status='pending_charge'
                  AND web_billing_customers.customer_key=excluded.customer_key
                  AND web_billing_customers.billing_key_ciphertext IS NULL
                  AND web_billing_customers.billing_key_iv IS NULL
                  AND web_billing_customers.billing_key_version IS NULL
                )`,
          ).bind(
            familyId,
            userId,
            customerKey,
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.version,
            session.plan,
            pendingTrialEnd,
            pgTs(now),
            pgTs(now),
          ).run();
          if (Number(customerWrite.meta?.changes ?? 0) !== 1) {
            throw new Error("web_billing_customer_reserved_by_other_checkout");
          }
        } catch (error) {
          try {
            await deleteTossBillingKey(config, issued.billingKey, options.fetchImpl);
          } catch {
            // 저장되지 않은 빌링키는 어떤 로컬 갱신 경로에서도 사용할 수 없다.
          }
          await releaseBillingProviderReservation(c.env.DB, {
            familyId,
            provider: "toss_web",
            reservationRef: session.id,
            now,
          });
          throw error;
        }
        billingKey = issued.billingKey;
        currentCustomer = await loadWebBillingCustomer(c.env.DB, familyId);
      }
      if (
        !currentCustomer
        || currentCustomer.customer_key !== customerKey
        || !currentCustomer.billing_key_ciphertext
        || !currentCustomer.billing_key_iv
        || currentCustomer.billing_key_version !== "v1"
      ) {
        throw new Error("web_billing_customer_persistence_failed");
      }

      if (session.trial_eligible === 1) {
        const trial = await finalizeTrialWebBilling(c.env, {
          sessionId,
          sessionClaimToken: checkoutClaimToken,
          familyId,
          parentId: userId,
          customerKey,
          plan: session.plan,
          now,
        });
        if (trial.status === "ineligible") {
          await closeIneligiblePersistedTrial(c.env, {
            sessionId,
            sessionClaimToken: checkoutClaimToken,
            familyId,
            parentId: userId,
            customerKey,
            now,
            config,
            fetchImpl: options.fetchImpl,
          });
          checkoutClaimToken = null;
          return c.json({ error: "web_billing_trial_state_changed" }, 409);
        }
        checkoutClaimToken = null;
        if (trial.status === "conflict") {
          await c.env.DB.batch([
            c.env.DB.prepare(
              `UPDATE web_billing_customers
                  SET status='expired', billing_key_ciphertext=NULL, billing_key_iv=NULL,
                      billing_key_version=NULL, next_charge_at=NULL, retry_after=NULL, updated_at=?
                WHERE family_id=? AND customer_key=? AND status='pending_charge'`,
            ).bind(pgTs(now), familyId, customerKey),
            c.env.DB.prepare(
              `UPDATE web_billing_checkout_sessions
                  SET status='failed', claim_token=NULL, claim_expires_at=NULL,
                      error_code='BILLING_PROVIDER_CONFLICT', updated_at=?
                WHERE id=? AND family_id=? AND customer_key=?`,
            ).bind(pgTs(now), sessionId, familyId, customerKey),
          ]);
          try {
            await deleteTossBillingKey(config, billingKey, options.fetchImpl);
          } catch {
            // 로컬 자동청구 키는 먼저 닫혔다.
          }
          return c.json({ error: "subscription_already_active" }, 409);
        }
        return c.json(completedTrialPayload(session.plan, pgTs(trial.trialEndsAt)));
      }

      const orderId = await createWebBillingOrderId("initial", session.id);
      const existingPeriod = await initialAttemptPeriod(c.env.DB, session.id);
      const periodStart = existingPeriod
        ? new Date(pgToIso(existingPeriod.period_start))
        : now;
      const periodEnd = existingPeriod
        ? new Date(pgToIso(existingPeriod.period_end))
        : addWebBillingPeriod(periodStart, session.plan);
      if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime())) {
        throw new Error("web_billing_period_invalid");
      }
      await insertChargeAttempt(c.env.DB, {
        orderId,
        familyId,
        checkoutSessionId: session.id,
        customerKey,
        plan: session.plan,
        kind: "initial",
        periodStart,
        periodEnd,
        now,
      });
      const outcome = await settleWebBillingAttempt(c.env.DB, config, {
        orderId,
        familyId,
        customerKey,
        billingKey,
        now,
        fetchImpl: options.fetchImpl,
        allowCharge,
      });
      if (outcome.status === "done") {
        if (outcome.paymentKeyHash === "already_recorded") {
          let providerSettlement;
          try {
            providerSettlement = await reconcileWebBillingRefund(c.env, {
              orderId,
              now,
              fetchImpl: options.fetchImpl,
            });
          } catch {
            await releaseCheckoutClaim(
              c.env.DB,
              sessionId,
              checkoutClaimToken,
              "pending",
              "WEB_BILLING_PROVIDER_RECHECK_FAILED",
              now,
            );
            checkoutClaimToken = null;
            return c.json({ error: "web_billing_reconciliation_pending" }, 409);
          }
          if (providerSettlement.status !== "paid") {
            checkoutClaimToken = null;
            return c.json(
              {
                error: providerSettlement.status === "refunded"
                  ? "web_billing_payment_refunded"
                  : "web_billing_partial_refund_review",
              },
              providerSettlement.status === "refunded" ? 410 : 409,
            );
          }
        }
        const finalized = await finalizeInitialWebBilling(c.env, {
          sessionId,
          sessionClaimToken: checkoutClaimToken,
          familyId,
          customerKey,
          plan: session.plan,
          orderId,
          periodEnd,
          now,
        });
        checkoutClaimToken = null;
        if (finalized === "conflict") {
          try {
            await deleteTossBillingKey(config, billingKey, options.fetchImpl);
          } catch {
            // 이미 청구된 주문은 order id로 환불 운영하며 로컬 자동청구 키는 닫혀 있다.
          }
          return c.json({ error: "billing_provider_conflict_refund_required" }, 409);
        }
        return c.json(completedPayload(session.plan, pgTs(periodEnd)));
      }
      if (outcome.status === "failed") {
        await c.env.DB.batch([
          c.env.DB.prepare(
            `UPDATE web_billing_customers
                SET status='expired', billing_key_ciphertext=NULL, billing_key_iv=NULL,
                    billing_key_version=NULL, next_charge_at=NULL, retry_after=NULL, updated_at=?
              WHERE family_id=? AND customer_key=? AND status='pending_charge'`,
          ).bind(pgTs(now), familyId, customerKey),
          c.env.DB.prepare(
            `UPDATE web_billing_checkout_sessions
                SET status='failed', claim_token=NULL, claim_expires_at=NULL,
                    error_code=?, updated_at=?
              WHERE id=? AND claim_token=?`,
            ).bind(outcome.errorCode, pgTs(now), sessionId, checkoutClaimToken),
        ]);
        checkoutClaimToken = null;
        try {
          await deleteTossBillingKey(config, billingKey, options.fetchImpl);
        } catch {
          // 로컬 키는 이미 제거됐다. 결제사 폐기 실패가 같은 키의 재사용을 열면 안 된다.
        }
        await releaseBillingProviderReservation(c.env.DB, {
          familyId,
          provider: "toss_web",
          reservationRef: session.id,
          now,
        });
        return c.json({ error: "web_billing_charge_failed" }, 402);
      }
      if (outcome.status === "unknown") {
        await releaseCheckoutClaim(
          c.env.DB,
          sessionId,
          checkoutClaimToken,
          "pending",
          outcome.errorCode,
          now,
        );
        checkoutClaimToken = null;
        return c.json({ error: "web_billing_reconciliation_pending" }, 409);
      }
      await releaseCheckoutClaim(
        c.env.DB,
        sessionId,
        checkoutClaimToken,
        "pending",
        "WEB_BILLING_ATTEMPT_BUSY",
        now,
      );
      checkoutClaimToken = null;
      return c.json({ error: "web_billing_processing" }, 409);
    } catch {
      if (checkoutClaimToken) {
        await releaseCheckoutClaim(
          c.env.DB,
          sessionId,
          checkoutClaimToken,
          "pending",
          "WEB_BILLING_INTERNAL",
          new Date(),
        );
        checkoutClaimToken = null;
      }
      return c.json({ error: "web_billing_completion_unavailable" }, 503);
    } finally {
      await releaseAccountMutationLeases(c.env.DB, leaseResult.leases);
    }
  });

  routes.post("/web/cancel", requireAuth, async (c) => {
    const body = await jsonBody(c);
    if (body === BODY_TOO_LARGE) return c.json({ error: "request_too_large" }, 413);
    const familyId = typeof body?.familyId === "string" ? body.familyId.trim() : "";
    const userId = c.get("user").sub;
    if (!ID.test(familyId)) return c.json({ error: "invalid_request" }, 400);
    if (!(await activeParent(c.env.DB, userId, familyId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    // 결제사 설정이 일시 누락돼도 로컬 자동청구 중단은 항상 가능해야 한다.
    const config = configuredWebBilling(c.env);
    const leaseResult = await acquireFamilyMutationLeases(c.env.DB, familyId, userId);
    if (!leaseResult || leaseResult.status !== "acquired") {
      return c.json({
        error: leaseResult?.status === "blocked"
          ? "account_mutation_blocked"
          : "account_mutation_unavailable",
      }, leaseResult?.status === "blocked" ? 409 : 503);
    }
    try {
      if (!(await activeParent(c.env.DB, userId, familyId))) {
        return c.json({ error: "forbidden" }, 403);
      }
      const customer = await loadWebBillingCustomer(c.env.DB, familyId);
      const customerAccessEnd = customer?.status === "trial"
        ? customer.trial_ends_at
        : customer?.current_period_end;
      if (!customer || !customerAccessEnd || !["trial", "active", "cancel_at_period_end", "past_due"].includes(customer.status)) {
        return c.json({ error: "web_subscription_not_active" }, 404);
      }
      if (
        customer.parent_id !== userId
        && !(await assertPrimaryParent(c.env.DB, userId, familyId))
      ) {
        return c.json({ error: "web_billing_owner_required" }, 403);
      }
      const familySubscription = await c.env.DB.prepare(
        `SELECT provider,status,current_period_end FROM family_subscription WHERE family_id=? LIMIT 1`,
      ).bind(familyId).first<{ provider: string; status: string; current_period_end: string | null }>();
      if (familySubscription?.provider !== WEB_BILLING_PROVIDER) {
        return c.json({ error: "web_subscription_not_active" }, 404);
      }

      const now = new Date();
      const endMs = Date.parse(pgToIso(customerAccessEnd));
      if (!Number.isFinite(endMs) || endMs <= now.getTime()) {
        return c.json({ error: "web_subscription_not_active" }, 404);
      }
      const nowPg = pgTs(now);
      let transitioned = false;
      if (customer.status !== "cancel_at_period_end") {
        const stopped = await c.env.DB.prepare(
          `UPDATE web_billing_customers
              SET status='cancel_at_period_end',
                  current_period_end=COALESCE(current_period_end,trial_ends_at),
                  next_charge_at=NULL, retry_after=NULL,
                  billing_key_revocation_status=CASE
                    WHEN billing_key_ciphertext IS NOT NULL
                     AND billing_key_iv IS NOT NULL AND billing_key_version='v1'
                    THEN 'pending' ELSE billing_key_revocation_status END,
                  billing_key_revocation_attempts=CASE
                    WHEN billing_key_ciphertext IS NOT NULL
                     AND billing_key_iv IS NOT NULL AND billing_key_version='v1'
                    THEN 0 ELSE billing_key_revocation_attempts END,
                  billing_key_revocation_retry_at=CASE
                    WHEN billing_key_ciphertext IS NOT NULL
                     AND billing_key_iv IS NOT NULL AND billing_key_version='v1'
                    THEN ? ELSE billing_key_revocation_retry_at END,
                  billing_key_revocation_error=NULL,billing_key_revoked_at=NULL,
                  cancelled_at=?, updated_at=?
            WHERE family_id=? AND customer_key=? AND status IN ('trial','active','past_due')
              AND NOT EXISTS(
                SELECT 1 FROM web_billing_charge_attempts a
                 WHERE a.family_id=web_billing_customers.family_id
                   AND (
                     a.status IN ('pending','processing','unknown')
                     OR (
                       a.status='done' AND a.kind='renewal'
                       AND datetime(substr(a.period_end,1,19))
                           > datetime(substr(web_billing_customers.current_period_end,1,19))
                     )
                   )
              )`,
        ).bind(nowPg, nowPg, nowPg, familyId, customer.customer_key).run();
        transitioned = Number(stopped.meta?.changes ?? 0) === 1;
        if (!transitioned) {
          const latest = await loadWebBillingCustomer(c.env.DB, familyId);
          if (latest?.status !== "cancel_at_period_end") {
            return c.json({ error: "web_billing_reconciliation_pending" }, 409);
          }
        }
      }

      const cancelledCustomer = await loadWebBillingCustomer(c.env.DB, familyId);
      if (!cancelledCustomer?.current_period_end || cancelledCustomer.status !== "cancel_at_period_end") {
        return c.json({ error: "web_billing_cancellation_unavailable" }, 503);
      }
      if (customer.status === "trial") {
        await c.env.DB.prepare(
          `UPDATE web_billing_trial_claims
              SET status='cancelled', updated_at=?
            WHERE family_id=? AND checkout_session_id IN (
              SELECT id FROM web_billing_checkout_sessions
               WHERE family_id=? AND customer_key=? AND trial_eligible=1
            ) AND status IN ('active','cancelled')`,
        ).bind(nowPg, familyId, familyId, customer.customer_key).run();
      }
      const subscriptionUpdate = await c.env.DB.prepare(
        `UPDATE family_subscription
            SET status='cancelled', current_period_end=?, cancelled_at=?, updated_at=?,
                last_event_id=?, last_event_at=?, raw_event=?
          WHERE family_id=? AND provider=?`,
      ).bind(
        cancelledCustomer.current_period_end,
        cancelledCustomer.cancelled_at ?? nowPg,
        nowPg,
        `cancel:${familyId}:${now.getTime()}`,
        nowPg,
        JSON.stringify({ provider: WEB_BILLING_PROVIDER, kind: "cancel", plan: cancelledCustomer.plan }),
        familyId,
        WEB_BILLING_PROVIDER,
      ).run();
      if (transitioned && Number(subscriptionUpdate.meta?.changes ?? 0) === 1) {
        await notifyPg(c.env, familyId, "family_subscription", "UPDATE", {
          family_id: familyId,
          status: "cancelled",
          provider: WEB_BILLING_PROVIDER,
          current_period_end: cancelledCustomer.current_period_end,
        });
      }
      await attemptWebBillingKeyRevocation(c.env, {
        familyId,
        now,
        fetchImpl: options.fetchImpl,
        config,
        force: true,
      });
      return c.json({
        ok: true,
        status: "cancelled",
        currentPeriodEnd: pgToIso(cancelledCustomer.current_period_end),
      });
    } catch {
      return c.json({ error: "web_billing_cancellation_unavailable" }, 503);
    } finally {
      await releaseAccountMutationLeases(c.env.DB, leaseResult.leases);
    }
  });

  return routes;
}

export default createWebBillingRoutes();
