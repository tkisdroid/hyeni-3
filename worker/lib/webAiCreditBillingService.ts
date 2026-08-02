import type { Env } from "../types";
import { resolveVerifiedFamilyMembership } from "../db/authz";
import {
  acquireAccountMutationLeases,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
} from "./accountMutationScope";
import { notifyPg } from "./realtime";
import { addUtcCalendarYears, pgToIso, pgTs } from "./time";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";
import { resolveIncludedDailyLimit } from "../shared/aiCredits.js";
import {
  WEB_AI_CREDIT_CLAIM_TTL_MS,
  hashWebAiCreditPaymentKey,
  readWebAiCreditTossConfig,
} from "../shared/webAiCreditBilling.js";
import {
  TossWebBillingRequestError,
  confirmTossOneTimePayment,
  findTossOneTimePaymentStateByOrderId,
  type TossPaymentsConfig,
} from "./tossWebBilling";

type FetchLike = typeof fetch;

export interface WebAiCreditOrderRow {
  order_id: string;
  family_id: string;
  parent_id: string;
  child_user_id: string;
  customer_key: string;
  product_code: "ai-credit-30" | "ai-credit-80" | "ai-credit-200";
  credits: 30 | 80 | 200;
  debt_applied: number;
  amount: number;
  currency: "KRW";
  status: "pending" | "processing" | "unknown" | "done" | "refund_processing"
    | "refund_unknown" | "refunded" | "failed" | "expired";
  expires_at: string;
  idempotency_key: string;
  claim_token: string | null;
  claim_expires_at: string | null;
  payment_key_hash: string | null;
  record_scope: "active" | "detached";
  balance_scope: "active" | "detached";
  detach_reason: "account_deleted" | "family_deleted" | "child_unpaired" | null;
  detached_at: string | null;
  granted_credits: number;
  grant_committed_at: string | null;
  refunded_credits: number;
  refund_committed_at: string | null;
  retention_until: string | null;
  refunded_amount: number;
  provider_checked_at: string | null;
  error_code: string | null;
  retry_after: string | null;
  created_at: string;
  completed_at: string | null;
}

export type WebAiCreditBalance = {
  isPremium: boolean;
  dailyIncludedLimit: number;
  dailyIncludedUsed: number;
  dailyIncludedRemaining: number;
  purchasedCredits: number;
  purchasedCreditDebt: number;
};

export type WebAiCreditSettlement =
  | { status: "done"; order: WebAiCreditOrderRow; creditStatus: WebAiCreditBalance }
  | { status: "pending" | "unknown" | "failed" | "busy" | "refunded"; order: WebAiCreditOrderRow; errorCode?: string };

function kstDateKey(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function retryAt(now: Date): string {
  return pgTs(new Date(now.getTime() + 15 * 60 * 1000));
}

function detachedReviewRetryAt(now: Date): string {
  return pgTs(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
}

function financialRetentionAt(now: Date): string {
  return pgTs(addUtcCalendarYears(now, 5));
}

function nextRefundCheckAt(now: Date, completedAt: string | null): string {
  const completedMs = completedAt ? Date.parse(completedAt.replace(" ", "T").replace(/\+00$/, "+00:00")) : Number.NaN;
  const ageMs = Number.isFinite(completedMs) ? Math.max(0, now.getTime() - completedMs) : 0;
  const delayMs = ageMs < 7 * 24 * 60 * 60 * 1000
    ? 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;
  return pgTs(new Date(now.getTime() + delayMs));
}

export function configuredWebAiCreditBilling(env: Env): TossPaymentsConfig | null {
  return readWebAiCreditTossConfig(env) as TossPaymentsConfig | null;
}

export async function loadWebAiCreditOrder(
  db: D1Database,
  orderId: string,
): Promise<WebAiCreditOrderRow | null> {
  return db.prepare(
    `SELECT order_id,family_id,parent_id,child_user_id,customer_key,product_code,credits,debt_applied,
             amount,currency,status,expires_at,idempotency_key,claim_token,claim_expires_at,
             payment_key_hash,record_scope,balance_scope,detach_reason,detached_at,
             granted_credits,grant_committed_at,refunded_credits,refund_committed_at,retention_until,
             refunded_amount,provider_checked_at,error_code,retry_after,
             created_at,completed_at
       FROM web_ai_credit_orders WHERE order_id=? LIMIT 1`,
  ).bind(orderId).first<WebAiCreditOrderRow>();
}

async function readBalance(
  db: D1Database,
  familyId: string,
  childUserId: string,
): Promise<WebAiCreditBalance> {
  const row = await db.prepare(
    `SELECT is_premium,daily_included_limit,daily_included_used,purchased_credits
       FROM ai_credit_balances WHERE family_id=? AND child_user_id=? LIMIT 1`,
  ).bind(familyId, childUserId).first<{
    is_premium: number;
    daily_included_limit: number;
    daily_included_used: number;
    purchased_credits: number;
  }>();
  const limit = Math.max(0, Number(row?.daily_included_limit ?? 0));
  const used = Math.max(0, Number(row?.daily_included_used ?? 0));
  const rawPurchasedNumber = Number(row?.purchased_credits ?? 0);
  const rawPurchased = Number.isSafeInteger(rawPurchasedNumber) ? rawPurchasedNumber : 0;
  return {
    isPremium: Number(row?.is_premium ?? 0) === 1,
    dailyIncludedLimit: limit,
    dailyIncludedUsed: used,
    dailyIncludedRemaining: Math.max(0, limit - used),
    purchasedCredits: Math.max(0, rawPurchased),
    purchasedCreditDebt: Math.max(0, -rawPurchased),
  };
}

async function readDetachedBalance(
  db: D1Database,
  familyId: string,
  childUserId: string,
): Promise<WebAiCreditBalance> {
  const row = await db.prepare(
    `SELECT purchased_credits FROM web_ai_credit_detached_balances
      WHERE family_id=? AND child_user_id=? LIMIT 1`,
  ).bind(familyId, childUserId).first<{ purchased_credits: number }>();
  const rawPurchasedNumber = Number(row?.purchased_credits ?? 0);
  const rawPurchased = Number.isSafeInteger(rawPurchasedNumber) ? rawPurchasedNumber : 0;
  return {
    isPremium: false,
    dailyIncludedLimit: 0,
    dailyIncludedUsed: 0,
    dailyIncludedRemaining: 0,
    purchasedCredits: Math.max(0, rawPurchased),
    purchasedCreditDebt: Math.max(0, -rawPurchased),
  };
}

async function hasBlockedDetachedFinancialState(
  db: D1Database,
  familyId: string,
  childUserId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS blocked
       FROM web_ai_credit_detached_balances
      WHERE family_id=? AND child_user_id=?
      LIMIT 1`,
  ).bind(familyId, childUserId).first<{ blocked: number }>();
  return row?.blocked === 1;
}

async function deferReattachedOrderForReview(
  db: D1Database,
  order: WebAiCreditOrderRow,
  now: Date,
): Promise<WebAiCreditOrderRow> {
  const nowPg = pgTs(now);
  await db.prepare(
    `UPDATE web_ai_credit_orders
        SET status='unknown',claim_token=NULL,claim_expires_at=NULL,
            error_code='WEB_AI_CREDIT_REATTACH_REVIEW_REQUIRED',retry_after=?,updated_at=?
      WHERE order_id=? AND record_scope='active'
        AND status IN ('pending','processing','unknown','failed','expired')`,
  ).bind(detachedReviewRetryAt(now), nowPg, order.order_id).run();
  return await loadWebAiCreditOrder(db, order.order_id) ?? order;
}

async function orderResult(
  db: D1Database,
  order: WebAiCreditOrderRow,
): Promise<WebAiCreditSettlement> {
  if (order.status === "done") {
    return {
      status: "done",
      order,
      creditStatus: order.balance_scope === "detached"
        ? await readDetachedBalance(db, order.family_id, order.child_user_id)
        : await readBalance(db, order.family_id, order.child_user_id),
    };
  }
  if (order.status === "refunded") return { status: "refunded", order };
  return {
    status: order.status === "processing" || order.status === "refund_processing"
      ? "busy"
      : order.status === "expired"
        ? "failed"
        : order.status === "refund_unknown"
          ? "unknown"
        : order.status,
    order,
    ...(order.error_code ? { errorCode: order.error_code } : {}),
  };
}

async function claimOrder(
  db: D1Database,
  order: WebAiCreditOrderRow,
  now: Date,
  allowTerminal: boolean,
): Promise<string | null> {
  const token = crypto.randomUUID();
  const nowPg = pgTs(now);
  const terminalClause = allowTerminal ? ",'failed','expired'" : "";
  const result = await db.prepare(
    `UPDATE web_ai_credit_orders
        SET status='processing',claim_token=?,claim_expires_at=?,updated_at=?
      WHERE order_id=? AND family_id=? AND parent_id=? AND child_user_id=?
        AND (
          status IN ('pending','unknown'${terminalClause})
          OR (
            status='processing'
            AND (claim_expires_at IS NULL
              OR datetime(substr(claim_expires_at,1,19))<=datetime(substr(?,1,19)))
          )
        )`,
  ).bind(
    token,
    pgTs(new Date(now.getTime() + WEB_AI_CREDIT_CLAIM_TTL_MS)),
    nowPg,
    order.order_id,
    order.family_id,
    order.parent_id,
    order.child_user_id,
    nowPg,
  ).run();
  return Number(result.meta?.changes ?? 0) === 1 ? token : null;
}

async function releaseClaim(
  db: D1Database,
  orderId: string,
  claimToken: string,
  status: "pending" | "unknown" | "failed",
  errorCode: string | null,
  now: Date,
): Promise<void> {
  await db.prepare(
    `UPDATE web_ai_credit_orders
        SET status=?,claim_token=NULL,claim_expires_at=NULL,error_code=?,retry_after=?,updated_at=?
      WHERE order_id=? AND status='processing' AND claim_token=?`,
  ).bind(
    status,
    errorCode,
    status === "unknown" ? retryAt(now) : null,
    pgTs(now),
    orderId,
    claimToken,
  ).run();
}

async function activeOrderOwnership(db: D1Database, order: WebAiCreditOrderRow): Promise<boolean> {
  const parent = await resolveVerifiedFamilyMembership(db, order.parent_id, order.family_id);
  if (parent?.role !== "parent") return false;
  const child = await db.prepare(
    `SELECT 1 AS ok FROM family_members
      WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1`,
  ).bind(order.family_id, order.child_user_id).first<{ ok: number }>();
  return child?.ok === 1;
}

async function grantVerifiedPayment(
  env: Env,
  order: WebAiCreditOrderRow,
  claimToken: string,
  paymentKey: string,
  now: Date,
): Promise<WebAiCreditSettlement> {
  const paymentKeyHash = await hashWebAiCreditPaymentKey(paymentKey);
  if (!(await activeOrderOwnership(env.DB, order))) {
    await releaseClaim(
      env.DB,
      order.order_id,
      claimToken,
      "unknown",
      "WEB_AI_CREDIT_MEMBERSHIP_CHANGED",
      now,
    );
    const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
    return orderResult(env.DB, latest);
  }

  let isPremium: boolean;
  try {
    isPremium = (await resolveFamilyEntitlement(env.DB, order.family_id)).isPremium;
  } catch {
    await releaseClaim(
      env.DB,
      order.order_id,
      claimToken,
      "unknown",
      "FAMILY_ENTITLEMENT_UNAVAILABLE",
      now,
    );
    const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
    return orderResult(env.DB, latest);
  }

  const nowPg = pgTs(now);
  const today = kstDateKey(now);
  const includedLimit = resolveIncludedDailyLimit({ isPremium });
  const balanceId = `toss-web-balance:${order.family_id}:${order.child_user_id}`;
  const ledgerId = `toss-web-credit:${order.order_id}`;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `SELECT CASE WHEN EXISTS(
           SELECT 1 FROM web_ai_credit_orders o
            WHERE o.order_id=? AND o.family_id=? AND o.parent_id=? AND o.child_user_id=?
              AND o.product_code=? AND o.credits=? AND o.amount=? AND o.currency='KRW'
              AND o.status='processing' AND o.claim_token=?
              AND EXISTS(
                SELECT 1 FROM families f
                 WHERE f.id=o.family_id AND (
                   f.parent_id=o.parent_id OR EXISTS(
                     SELECT 1 FROM family_members pm
                      WHERE pm.family_id=o.family_id AND pm.user_id=o.parent_id
                        AND pm.role='parent' AND pm.is_active=1
                   )
                 )
              )
              AND EXISTS(
                SELECT 1 FROM family_members cm
                 WHERE cm.family_id=o.family_id AND cm.user_id=o.child_user_id
                   AND cm.role='child' AND cm.is_active=1
              )
              AND NOT EXISTS(
                SELECT 1 FROM web_ai_credit_orders used
                 WHERE used.payment_key_hash=? AND used.order_id<>o.order_id
              )
         ) THEN 1 ELSE json_extract('web_ai_credit_order_not_claimable','$') END AS ok`,
      ).bind(
        order.order_id,
        order.family_id,
        order.parent_id,
        order.child_user_id,
        order.product_code,
        order.credits,
        order.amount,
        claimToken,
        paymentKeyHash,
      ),
      env.DB.prepare(
        `INSERT INTO ai_credit_ledger
           (id,family_id,child_user_id,parent_id,delta,reason,source,transaction_id,created_at)
         VALUES (?,?,?,?,?,'purchase','parent_purchase',?,?)`,
      ).bind(
        ledgerId,
        order.family_id,
        order.child_user_id,
        order.parent_id,
        order.credits,
        order.order_id,
        nowPg,
      ),
      env.DB.prepare(
        `INSERT INTO ai_credit_balances
           (id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,
            daily_included_used,daily_reset_date,purchased_credits,updated_at)
         VALUES (?,?,?,?,?,?,0,?,?,?)
         ON CONFLICT(family_id,child_user_id) DO UPDATE SET
           parent_id=excluded.parent_id,
           is_premium=excluded.is_premium,
           daily_included_limit=excluded.daily_included_limit,
           daily_included_used=CASE
             WHEN substr(ai_credit_balances.daily_reset_date,1,10)=excluded.daily_reset_date
             THEN ai_credit_balances.daily_included_used ELSE 0 END,
           daily_reset_date=excluded.daily_reset_date,
           purchased_credits=COALESCE(ai_credit_balances.purchased_credits,0)+excluded.purchased_credits,
           updated_at=excluded.updated_at`,
      ).bind(
        balanceId,
        order.family_id,
        order.child_user_id,
        order.parent_id,
        isPremium ? 1 : 0,
        includedLimit,
        today,
        order.credits,
        nowPg,
      ),
      env.DB.prepare(
        `UPDATE web_ai_credit_orders
            SET status='done',claim_token=NULL,claim_expires_at=NULL,payment_key_hash=?,
                debt_applied=MIN(credits,MAX(0,credits-COALESCE((
                  SELECT purchased_credits FROM ai_credit_balances
                   WHERE family_id=web_ai_credit_orders.family_id
                     AND child_user_id=web_ai_credit_orders.child_user_id
                   LIMIT 1
                ),0))),
                granted_credits=credits,grant_committed_at=COALESCE(grant_committed_at,?),
                refunded_credits=0,refund_committed_at=NULL,
                refunded_amount=0,provider_checked_at=?,error_code=NULL,retry_after=?,
                completed_at=?,retention_until=?,updated_at=?
          WHERE order_id=? AND status='processing' AND claim_token=?`,
      ).bind(
        paymentKeyHash,
        nowPg,
        nowPg,
        nextRefundCheckAt(now, nowPg),
        nowPg,
        financialRetentionAt(now),
        nowPg,
        order.order_id,
        claimToken,
      ),
    ]);
  } catch (error) {
    const latest = await loadWebAiCreditOrder(env.DB, order.order_id);
    if (latest?.status === "done") return orderResult(env.DB, latest);
    await releaseClaim(
      env.DB,
      order.order_id,
      claimToken,
      "unknown",
      "WEB_AI_CREDIT_GRANT_UNAVAILABLE",
      now,
    );
    const afterRelease = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
    return orderResult(env.DB, afterRelease);
  }

  await notifyPg(env, order.family_id, "ai_credit_balances", "UPDATE", {
    family_id: order.family_id,
    child_user_id: order.child_user_id,
  });
  const completed = await loadWebAiCreditOrder(env.DB, order.order_id);
  if (!completed || completed.status !== "done") {
    throw new Error("web_ai_credit_completion_missing");
  }
  return orderResult(env.DB, completed);
}

async function finalizeUncreditedRefund(
  env: Env,
  order: WebAiCreditOrderRow,
  claimToken: string,
  paymentKey: string,
  refundedAmount: number,
  now: Date,
): Promise<WebAiCreditSettlement> {
  const paymentKeyHash = await hashWebAiCreditPaymentKey(paymentKey);
  const nowPg = pgTs(now);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `SELECT CASE WHEN EXISTS(
           SELECT 1 FROM web_ai_credit_orders o
            WHERE o.order_id=? AND o.status='processing' AND o.claim_token=?
              AND o.amount=? AND ?=o.amount
              AND NOT EXISTS(
                SELECT 1 FROM ai_credit_ledger l
                 WHERE l.transaction_id=o.order_id AND l.delta>0
              )
              AND NOT EXISTS(
                SELECT 1 FROM web_ai_credit_orders used
                 WHERE used.payment_key_hash=? AND used.order_id<>o.order_id
              )
         ) THEN 1 ELSE json_extract('web_ai_credit_uncredited_refund_not_claimable','$') END AS ok`,
      ).bind(order.order_id, claimToken, order.amount, refundedAmount, paymentKeyHash),
      env.DB.prepare(
        `UPDATE web_ai_credit_orders
            SET status='refunded',claim_token=NULL,claim_expires_at=NULL,payment_key_hash=?,
                refunded_credits=0,refund_committed_at=COALESCE(refund_committed_at,?),
                refunded_amount=?,provider_checked_at=?,error_code=NULL,retry_after=NULL,
                completed_at=COALESCE(completed_at,?),retention_until=?,updated_at=?
          WHERE order_id=? AND status='processing' AND claim_token=?`,
      ).bind(
        paymentKeyHash,
        nowPg,
        refundedAmount,
        nowPg,
        nowPg,
        financialRetentionAt(now),
        nowPg,
        order.order_id,
        claimToken,
      ),
    ]);
  } catch {
    await releaseClaim(
      env.DB,
      order.order_id,
      claimToken,
      "unknown",
      "WEB_AI_CREDIT_REFUND_STATE_UNAVAILABLE",
      now,
    );
  }
  const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
  return orderResult(env.DB, latest);
}

async function claimRefundCheck(
  db: D1Database,
  order: WebAiCreditOrderRow,
  now: Date,
): Promise<string | null> {
  const token = crypto.randomUUID();
  const nowPg = pgTs(now);
  const result = await db.prepare(
    `UPDATE web_ai_credit_orders
        SET status='refund_processing',claim_token=?,claim_expires_at=?,updated_at=?
      WHERE order_id=? AND payment_key_hash IS NOT NULL
        AND (
          status IN ('done','refund_unknown')
          OR (
            status='refund_processing'
            AND (claim_expires_at IS NULL
              OR datetime(substr(claim_expires_at,1,19))<=datetime(substr(?,1,19)))
          )
        )`,
  ).bind(
    token,
    pgTs(new Date(now.getTime() + WEB_AI_CREDIT_CLAIM_TTL_MS)),
    nowPg,
    order.order_id,
    nowPg,
  ).run();
  return Number(result.meta?.changes ?? 0) === 1 ? token : null;
}

async function releaseRefundClaim(
  db: D1Database,
  order: WebAiCreditOrderRow,
  claimToken: string,
  status: "done" | "refund_unknown",
  errorCode: string | null,
  refundedAmount: number,
  now: Date,
  retryAfter?: string,
): Promise<void> {
  await db.prepare(
    `UPDATE web_ai_credit_orders
        SET status=?,claim_token=NULL,claim_expires_at=NULL,refunded_amount=?,
            provider_checked_at=?,error_code=?,retry_after=?,updated_at=?
      WHERE order_id=? AND status='refund_processing' AND claim_token=?`,
  ).bind(
    status,
    refundedAmount,
    pgTs(now),
    errorCode,
    status === "done"
      ? nextRefundCheckAt(now, order.completed_at)
      : retryAfter ?? retryAt(now),
    pgTs(now),
    order.order_id,
    claimToken,
  ).run();
}

async function applyVerifiedRefund(
  env: Env,
  order: WebAiCreditOrderRow,
  claimToken: string,
  paymentKey: string,
  refundedAmount: number,
  now: Date,
): Promise<WebAiCreditSettlement> {
  const paymentKeyHash = await hashWebAiCreditPaymentKey(paymentKey);
  const nowPg = pgTs(now);
  const ledgerId = `toss-web-credit-refund:${order.order_id}`;
  const balanceId = `toss-web-balance:${order.family_id}:${order.child_user_id}`;
  const today = kstDateKey(now);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `SELECT CASE WHEN EXISTS(
           SELECT 1 FROM web_ai_credit_orders o
            WHERE o.order_id=? AND o.status='refund_processing' AND o.claim_token=?
              AND o.payment_key_hash=? AND o.amount=? AND ?=o.amount
              AND EXISTS(
                SELECT 1 FROM ai_credit_ledger granted
                 WHERE granted.transaction_id=o.order_id AND granted.delta=o.credits
              )
              AND NOT EXISTS(
                SELECT 1 FROM ai_credit_ledger refunded
                 WHERE refunded.id=? OR (
                   refunded.transaction_id=o.order_id AND refunded.delta=-o.credits
                 )
              )
         ) THEN 1 ELSE json_extract('web_ai_credit_refund_not_claimable','$') END AS ok`,
      ).bind(
        order.order_id,
        claimToken,
        paymentKeyHash,
        order.amount,
        refundedAmount,
        ledgerId,
      ),
      env.DB.prepare(
        `INSERT INTO ai_credit_ledger
           (id,family_id,child_user_id,parent_id,delta,reason,source,transaction_id,created_at)
         VALUES (?,?,?,?,?,'refund','parent_purchase_refund',?,?)`,
      ).bind(
        ledgerId,
        order.family_id,
        order.child_user_id,
        order.parent_id,
        -order.credits,
        order.order_id,
        nowPg,
      ),
      // 이미 사용한 크레딧이 있어도 0으로 자르지 않는다. 음수 debt가 다음 충전을 먼저 상계한다.
      env.DB.prepare(
        `INSERT INTO ai_credit_balances
           (id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,
            daily_included_used,daily_reset_date,purchased_credits,updated_at)
         VALUES (?,?,?,?,0,5,0,?,?,?)
         ON CONFLICT(family_id,child_user_id) DO UPDATE SET
           parent_id=excluded.parent_id,
           purchased_credits=COALESCE(ai_credit_balances.purchased_credits,0)+excluded.purchased_credits,
           updated_at=excluded.updated_at`,
      ).bind(
        balanceId,
        order.family_id,
        order.child_user_id,
        order.parent_id,
        today,
        -order.credits,
        nowPg,
      ),
      env.DB.prepare(
        `UPDATE web_ai_credit_orders
            SET status='refunded',claim_token=NULL,claim_expires_at=NULL,refunded_amount=?,
                refunded_credits=credits,refund_committed_at=COALESCE(refund_committed_at,?),
                provider_checked_at=?,error_code=NULL,retry_after=NULL,
                retention_until=?,updated_at=?
          WHERE order_id=? AND status='refund_processing' AND claim_token=?`,
      ).bind(
        refundedAmount,
        nowPg,
        nowPg,
        financialRetentionAt(now),
        nowPg,
        order.order_id,
        claimToken,
      ),
    ]);
  } catch {
    const latest = await loadWebAiCreditOrder(env.DB, order.order_id);
    if (latest?.status !== "refunded") {
      await releaseRefundClaim(
        env.DB,
        order,
        claimToken,
        "refund_unknown",
        "WEB_AI_CREDIT_REFUND_UNAVAILABLE",
        refundedAmount,
        now,
      );
    }
  }
  const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
  if (latest.status === "refunded") {
    await notifyPg(env, order.family_id, "ai_credit_balances", "UPDATE", {
      family_id: order.family_id,
      child_user_id: order.child_user_id,
    });
  }
  return orderResult(env.DB, latest);
}

async function releaseDetachedClaimForReview(
  db: D1Database,
  order: WebAiCreditOrderRow,
  claimToken: string,
  currentStatus: "processing" | "refund_processing",
  errorCode: string,
  refundedAmount: number,
  now: Date,
  retryAfter = retryAt(now),
): Promise<void> {
  const nowPg = pgTs(now);
  await db.prepare(
    `UPDATE web_ai_credit_orders
        SET status='refund_unknown',claim_token=NULL,claim_expires_at=NULL,
            refunded_amount=?,provider_checked_at=?,error_code=?,retry_after=?,updated_at=?
      WHERE order_id=? AND status=? AND claim_token=? AND record_scope='detached'`,
  ).bind(
    refundedAmount,
    nowPg,
    errorCode,
    retryAfter,
    nowPg,
    order.order_id,
    currentStatus,
    claimToken,
  ).run();
}

async function markDetachedPaidForRefund(
  env: Env,
  order: WebAiCreditOrderRow,
  claimToken: string,
  paymentKey: string,
  now: Date,
): Promise<WebAiCreditSettlement> {
  const paymentKeyHash = await hashWebAiCreditPaymentKey(paymentKey);
  const nowPg = pgTs(now);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `SELECT CASE WHEN EXISTS(
           SELECT 1 FROM web_ai_credit_orders isolated
            WHERE isolated.order_id=? AND isolated.record_scope='detached'
              AND isolated.status='processing' AND isolated.claim_token=?
              AND isolated.granted_credits=0
              AND NOT EXISTS(
                SELECT 1 FROM web_ai_credit_orders used
                 WHERE used.payment_key_hash=? AND used.order_id<>isolated.order_id
              )
         ) THEN 1 ELSE json_extract('web_ai_credit_detached_paid_not_claimable','$') END AS ok`,
      ).bind(order.order_id, claimToken, paymentKeyHash),
      env.DB.prepare(
        `UPDATE web_ai_credit_orders
            SET status='refund_unknown',claim_token=NULL,claim_expires_at=NULL,
                payment_key_hash=?,provider_checked_at=?,
                error_code='WEB_AI_CREDIT_DETACHED_PAYMENT_REFUND_REQUIRED',
                retry_after=?,updated_at=?
          WHERE order_id=? AND record_scope='detached'
            AND status='processing' AND claim_token=? AND granted_credits=0`,
      ).bind(
        paymentKeyHash,
        nowPg,
        detachedReviewRetryAt(now),
        nowPg,
        order.order_id,
        claimToken,
      ),
    ]);
  } catch {
    await releaseClaim(
      env.DB,
      order.order_id,
      claimToken,
      "unknown",
      "WEB_AI_CREDIT_DETACHED_PAYMENT_STATE_UNAVAILABLE",
      now,
    );
  }
  const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
  return orderResult(env.DB, latest);
}

async function finalizeDetachedGrantedPayment(
  env: Env,
  order: WebAiCreditOrderRow,
  claimToken: string,
  paymentKey: string,
  now: Date,
): Promise<WebAiCreditSettlement> {
  const paymentKeyHash = await hashWebAiCreditPaymentKey(paymentKey);
  const nowPg = pgTs(now);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `SELECT CASE WHEN EXISTS(
           SELECT 1 FROM web_ai_credit_orders isolated
            WHERE isolated.order_id=? AND isolated.record_scope='detached'
              AND isolated.status='processing' AND isolated.claim_token=?
              AND isolated.granted_credits=isolated.credits
              AND isolated.grant_committed_at IS NOT NULL
              AND NOT EXISTS(
                SELECT 1 FROM web_ai_credit_orders used
                 WHERE used.payment_key_hash=? AND used.order_id<>isolated.order_id
              )
         ) THEN 1 ELSE json_extract('web_ai_credit_detached_grant_not_claimable','$') END AS ok`,
      ).bind(order.order_id, claimToken, paymentKeyHash),
      env.DB.prepare(
        `UPDATE web_ai_credit_orders
            SET status='done',claim_token=NULL,claim_expires_at=NULL,payment_key_hash=?,
                provider_checked_at=?,error_code=NULL,retry_after=?,
                completed_at=COALESCE(completed_at,grant_committed_at,?),
                retention_until=COALESCE(retention_until,?),updated_at=?
          WHERE order_id=? AND record_scope='detached'
            AND status='processing' AND claim_token=?`,
      ).bind(
        paymentKeyHash,
        nowPg,
        nextRefundCheckAt(now, order.completed_at ?? order.grant_committed_at),
        nowPg,
        financialRetentionAt(now),
        nowPg,
        order.order_id,
        claimToken,
      ),
    ]);
  } catch {
    await releaseDetachedClaimForReview(
      env.DB,
      order,
      claimToken,
      "processing",
      "WEB_AI_CREDIT_DETACHED_GRANT_STATE_UNAVAILABLE",
      order.refunded_amount,
      now,
    );
  }
  const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
  return orderResult(env.DB, latest);
}

async function finalizeDetachedUncreditedRefund(
  env: Env,
  order: WebAiCreditOrderRow,
  claimToken: string,
  claimStatus: "processing" | "refund_processing",
  paymentKey: string,
  refundedAmount: number,
  now: Date,
): Promise<WebAiCreditSettlement> {
  const paymentKeyHash = await hashWebAiCreditPaymentKey(paymentKey);
  const nowPg = pgTs(now);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `SELECT CASE WHEN EXISTS(
           SELECT 1 FROM web_ai_credit_orders isolated
            WHERE isolated.order_id=? AND isolated.record_scope='detached'
              AND isolated.status=? AND isolated.claim_token=?
              AND isolated.granted_credits=0 AND isolated.amount=? AND ?=isolated.amount
              AND (isolated.payment_key_hash IS NULL OR isolated.payment_key_hash=?)
              AND NOT EXISTS(
                SELECT 1 FROM web_ai_credit_orders used
                 WHERE used.payment_key_hash=? AND used.order_id<>isolated.order_id
              )
         ) THEN 1 ELSE json_extract('web_ai_credit_detached_uncredited_refund_not_claimable','$') END AS ok`,
      ).bind(
        order.order_id,
        claimStatus,
        claimToken,
        order.amount,
        refundedAmount,
        paymentKeyHash,
        paymentKeyHash,
      ),
      env.DB.prepare(
        `UPDATE web_ai_credit_orders
            SET status='refunded',claim_token=NULL,claim_expires_at=NULL,payment_key_hash=?,
                refunded_credits=0,refund_committed_at=COALESCE(refund_committed_at,?),
                refunded_amount=?,provider_checked_at=?,error_code=NULL,retry_after=NULL,
                completed_at=COALESCE(completed_at,?),retention_until=?,updated_at=?
          WHERE order_id=? AND record_scope='detached' AND status=? AND claim_token=?`,
      ).bind(
        paymentKeyHash,
        nowPg,
        refundedAmount,
        nowPg,
        nowPg,
        financialRetentionAt(now),
        nowPg,
        order.order_id,
        claimStatus,
        claimToken,
      ),
    ]);
  } catch {
    await releaseDetachedClaimForReview(
      env.DB,
      order,
      claimToken,
      claimStatus,
      "WEB_AI_CREDIT_DETACHED_REFUND_STATE_UNAVAILABLE",
      refundedAmount,
      now,
    );
  }
  const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
  return orderResult(env.DB, latest);
}

async function applyVerifiedDetachedRefund(
  env: Env,
  order: WebAiCreditOrderRow,
  claimToken: string,
  claimStatus: "processing" | "refund_processing",
  paymentKey: string,
  refundedAmount: number,
  now: Date,
): Promise<WebAiCreditSettlement> {
  const paymentKeyHash = await hashWebAiCreditPaymentKey(paymentKey);
  const nowPg = pgTs(now);
  const retentionUntil = financialRetentionAt(now);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `SELECT CASE WHEN EXISTS(
           SELECT 1 FROM web_ai_credit_orders isolated
            WHERE isolated.order_id=? AND isolated.record_scope='detached'
              AND isolated.status=? AND isolated.claim_token=?
              AND (isolated.payment_key_hash IS NULL OR isolated.payment_key_hash=?)
              AND isolated.amount=? AND ?=isolated.amount
              AND isolated.granted_credits=isolated.credits
              AND isolated.grant_committed_at IS NOT NULL
              AND (
                (isolated.balance_scope='detached' AND EXISTS(
                  SELECT 1 FROM web_ai_credit_detached_balances balance
                   WHERE balance.family_id=isolated.family_id
                     AND balance.child_user_id=isolated.child_user_id
                ))
                OR (isolated.balance_scope='active' AND EXISTS(
                  SELECT 1 FROM ai_credit_balances balance
                   WHERE balance.family_id=isolated.family_id
                     AND balance.child_user_id=isolated.child_user_id
                ))
              )
         ) THEN 1 ELSE json_extract('web_ai_credit_detached_refund_not_claimable','$') END AS ok`,
      ).bind(
        order.order_id,
        claimStatus,
        claimToken,
        paymentKeyHash,
        order.amount,
        refundedAmount,
      ),
      env.DB.prepare(
        `UPDATE web_ai_credit_detached_balances
            SET purchased_credits=purchased_credits-?,updated_at=?,retention_until=?
          WHERE family_id=? AND child_user_id=?
            AND EXISTS(
              SELECT 1 FROM web_ai_credit_orders isolated
               WHERE isolated.order_id=? AND isolated.record_scope='detached'
                 AND isolated.balance_scope='detached' AND isolated.status=?
                 AND isolated.claim_token=?
            )`,
      ).bind(
        order.credits,
        nowPg,
        retentionUntil,
        order.family_id,
        order.child_user_id,
        order.order_id,
        claimStatus,
        claimToken,
      ),
      env.DB.prepare(
        `UPDATE ai_credit_balances
            SET purchased_credits=COALESCE(purchased_credits,0)-?,updated_at=?
          WHERE family_id=? AND child_user_id=?
            AND EXISTS(
              SELECT 1 FROM web_ai_credit_orders isolated
               WHERE isolated.order_id=? AND isolated.record_scope='detached'
                 AND isolated.balance_scope='active' AND isolated.status=?
                 AND isolated.claim_token=?
            )`,
      ).bind(
        order.credits,
        nowPg,
        order.family_id,
        order.child_user_id,
        order.order_id,
        claimStatus,
        claimToken,
      ),
      env.DB.prepare(
        `UPDATE web_ai_credit_orders
            SET status='refunded',claim_token=NULL,claim_expires_at=NULL,
                payment_key_hash=COALESCE(payment_key_hash,?),
                refunded_amount=?,refunded_credits=credits,
                refund_committed_at=COALESCE(refund_committed_at,?),provider_checked_at=?,
                error_code=NULL,retry_after=NULL,retention_until=?,updated_at=?
          WHERE order_id=? AND record_scope='detached' AND status=? AND claim_token=?`,
      ).bind(
        paymentKeyHash,
        refundedAmount,
        nowPg,
        nowPg,
        retentionUntil,
        nowPg,
        order.order_id,
        claimStatus,
        claimToken,
      ),
    ]);
  } catch {
    const latest = await loadWebAiCreditOrder(env.DB, order.order_id);
    if (latest?.status !== "refunded") {
      await releaseDetachedClaimForReview(
        env.DB,
        order,
        claimToken,
        claimStatus,
        "WEB_AI_CREDIT_DETACHED_REFUND_UNAVAILABLE",
        refundedAmount,
        now,
      );
    }
  }
  const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
  return orderResult(env.DB, latest);
}

async function reconcileRefundWithLease(
  env: Env,
  order: WebAiCreditOrderRow,
  config: TossPaymentsConfig,
  now: Date,
  fetchImpl?: FetchLike,
): Promise<WebAiCreditSettlement> {
  const claimToken = await claimRefundCheck(env.DB, order, now);
  if (!claimToken) {
    const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
    return orderResult(env.DB, latest);
  }
  try {
    const state = await findTossOneTimePaymentStateByOrderId(config, {
      orderId: order.order_id,
      customerKey: order.customer_key,
      amount: order.amount,
    }, fetchImpl);
    if (state?.state === "refunded") {
      return applyVerifiedRefund(
        env,
        order,
        claimToken,
        state.paymentKey,
        state.refundedAmount,
        now,
      );
    }
    if (state?.state === "partial_refund") {
      await releaseRefundClaim(
        env.DB,
        order,
        claimToken,
        "refund_unknown",
        "WEB_AI_CREDIT_PARTIAL_REFUND_REVIEW_REQUIRED",
        state.refundedAmount,
        now,
      );
    } else if (state?.state === "paid") {
      const checkedHash = await hashWebAiCreditPaymentKey(state.paymentKey);
      await releaseRefundClaim(
        env.DB,
        order,
        claimToken,
        checkedHash === order.payment_key_hash ? "done" : "refund_unknown",
        checkedHash === order.payment_key_hash ? null : "WEB_AI_CREDIT_PAYMENT_KEY_MISMATCH",
        0,
        now,
      );
    } else {
      await releaseRefundClaim(
        env.DB,
        order,
        claimToken,
        "refund_unknown",
        "WEB_AI_CREDIT_PROVIDER_STATE_UNAVAILABLE",
        order.refunded_amount,
        now,
      );
    }
  } catch {
    await releaseRefundClaim(
      env.DB,
      order,
      claimToken,
      "refund_unknown",
      "TOSS_AI_CREDIT_LOOKUP_FAILED",
      order.refunded_amount,
      now,
    );
  }
  const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
  return orderResult(env.DB, latest);
}

async function reconcileDetachedRefund(
  env: Env,
  order: WebAiCreditOrderRow,
  config: TossPaymentsConfig,
  now: Date,
  fetchImpl?: FetchLike,
): Promise<WebAiCreditSettlement> {
  const claimToken = await claimRefundCheck(env.DB, order, now);
  if (!claimToken) {
    const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
    return orderResult(env.DB, latest);
  }
  try {
    const state = await findTossOneTimePaymentStateByOrderId(config, {
      orderId: order.order_id,
      customerKey: order.customer_key,
      amount: order.amount,
    }, fetchImpl);
    if (state?.state === "refunded") {
      return order.granted_credits === order.credits && order.grant_committed_at
        ? applyVerifiedDetachedRefund(
          env,
          order,
          claimToken,
          "refund_processing",
          state.paymentKey,
          state.refundedAmount,
          now,
        )
        : finalizeDetachedUncreditedRefund(
          env,
          order,
          claimToken,
          "refund_processing",
          state.paymentKey,
          state.refundedAmount,
          now,
        );
    }
    if (state?.state === "partial_refund") {
      await releaseRefundClaim(
        env.DB,
        order,
        claimToken,
        "refund_unknown",
        "WEB_AI_CREDIT_PARTIAL_REFUND_REVIEW_REQUIRED",
        state.refundedAmount,
        now,
      );
    } else if (state?.state === "paid") {
      const checkedHash = await hashWebAiCreditPaymentKey(state.paymentKey);
      const hashMatches = checkedHash === order.payment_key_hash;
      const uncredited = order.granted_credits === 0;
      await releaseRefundClaim(
        env.DB,
        order,
        claimToken,
        hashMatches && !uncredited ? "done" : "refund_unknown",
        !hashMatches
          ? "WEB_AI_CREDIT_PAYMENT_KEY_MISMATCH"
          : uncredited
            ? "WEB_AI_CREDIT_DETACHED_PAYMENT_REFUND_REQUIRED"
            : null,
        0,
        now,
        uncredited ? detachedReviewRetryAt(now) : undefined,
      );
    } else {
      await releaseRefundClaim(
        env.DB,
        order,
        claimToken,
        "refund_unknown",
        "WEB_AI_CREDIT_PROVIDER_STATE_UNAVAILABLE",
        order.refunded_amount,
        now,
      );
    }
  } catch {
    await releaseRefundClaim(
      env.DB,
      order,
      claimToken,
      "refund_unknown",
      "TOSS_AI_CREDIT_LOOKUP_FAILED",
      order.refunded_amount,
      now,
    );
  }
  const latest = await loadWebAiCreditOrder(env.DB, order.order_id) ?? order;
  return orderResult(env.DB, latest);
}

async function reconcileDetachedOrder(
  env: Env,
  order: WebAiCreditOrderRow,
  config: TossPaymentsConfig,
  now: Date,
  fetchImpl?: FetchLike,
): Promise<WebAiCreditSettlement> {
  const fresh = await loadWebAiCreditOrder(env.DB, order.order_id);
  if (!fresh) {
    return { status: "failed", order, errorCode: "WEB_AI_CREDIT_ORDER_NOT_FOUND" };
  }
  if (fresh.record_scope !== "detached") {
    return { status: "busy", order: fresh, errorCode: "WEB_AI_CREDIT_SCOPE_CHANGED" };
  }
  if (fresh.status === "refunded") return orderResult(env.DB, fresh);
  if (["done", "refund_processing", "refund_unknown"].includes(fresh.status)) {
    return reconcileDetachedRefund(env, fresh, config, now, fetchImpl);
  }

  const claimToken = await claimOrder(env.DB, fresh, now, true);
  if (!claimToken) {
    const latest = await loadWebAiCreditOrder(env.DB, fresh.order_id) ?? fresh;
    return orderResult(env.DB, latest);
  }
  try {
    const payment = await findTossOneTimePaymentStateByOrderId(config, {
      orderId: fresh.order_id,
      customerKey: fresh.customer_key,
      amount: fresh.amount,
    }, fetchImpl);
    if (payment?.state === "paid") {
      return fresh.granted_credits === fresh.credits && fresh.grant_committed_at
        ? finalizeDetachedGrantedPayment(env, fresh, claimToken, payment.paymentKey, now)
        : markDetachedPaidForRefund(env, fresh, claimToken, payment.paymentKey, now);
    }
    if (payment?.state === "refunded") {
      return fresh.granted_credits === fresh.credits && fresh.grant_committed_at
        ? applyVerifiedDetachedRefund(
          env,
          fresh,
          claimToken,
          "processing",
          payment.paymentKey,
          payment.refundedAmount,
          now,
        )
        : finalizeDetachedUncreditedRefund(
          env,
          fresh,
          claimToken,
          "processing",
          payment.paymentKey,
          payment.refundedAmount,
          now,
        );
    }
    if (payment?.state === "partial_refund") {
      await releaseClaim(
        env.DB,
        fresh.order_id,
        claimToken,
        "unknown",
        "WEB_AI_CREDIT_PARTIAL_REFUND_REVIEW_REQUIRED",
        now,
      );
    } else {
      const checkoutExpired = !payment
        && fresh.status === "pending"
        && Date.parse(pgToIso(fresh.expires_at)) <= now.getTime();
      const nextStatus = payment?.state === "failed" || checkoutExpired
        ? "failed"
        : fresh.status === "unknown" || fresh.status === "processing"
          ? "unknown"
          : fresh.status === "failed" || fresh.status === "expired"
            ? "failed"
            : "pending";
      await releaseClaim(
        env.DB,
        fresh.order_id,
        claimToken,
        nextStatus,
        nextStatus === "unknown"
          ? "TOSS_AI_CREDIT_NOT_FOUND"
          : checkoutExpired
            ? "WEB_AI_CREDIT_CHECKOUT_EXPIRED"
            : null,
        now,
      );
    }
  } catch {
    await releaseClaim(
      env.DB,
      fresh.order_id,
      claimToken,
      "unknown",
      "TOSS_AI_CREDIT_LOOKUP_FAILED",
      now,
    );
  }
  const latest = await loadWebAiCreditOrder(env.DB, fresh.order_id) ?? fresh;
  return orderResult(env.DB, latest);
}

async function withOrderMutationLease<T>(
  env: Env,
  order: WebAiCreditOrderRow,
  work: () => Promise<T>,
): Promise<T | null> {
  const scopes = await loadFamilyNotificationMutationScopes(
    env.DB,
    order.family_id,
    [order.parent_id, order.child_user_id],
  );
  if (!scopes) return null;
  const leaseResult = await acquireAccountMutationLeases(env.DB, scopes);
  if (leaseResult.status !== "acquired") return null;
  try {
    return await work();
  } finally {
    await releaseAccountMutationLeases(env.DB, leaseResult.leases);
  }
}

export async function completeWebAiCreditOrder(
  env: Env,
  input: {
    order: WebAiCreditOrderRow;
    paymentKey: string;
    now?: Date;
    fetchImpl?: FetchLike;
  },
): Promise<WebAiCreditSettlement> {
  if (input.order.status === "done" || input.order.status === "refunded") {
    return orderResult(env.DB, input.order);
  }
  const config = configuredWebAiCreditBilling(env);
  if (!config) return { status: "failed", order: input.order, errorCode: "WEB_AI_CREDIT_UNAVAILABLE" };
  const now = input.now ?? new Date();
  const leased = await withOrderMutationLease(env, input.order, async () => {
    const fresh = await loadWebAiCreditOrder(env.DB, input.order.order_id);
    if (!fresh) return { status: "failed", order: input.order, errorCode: "WEB_AI_CREDIT_ORDER_NOT_FOUND" } as WebAiCreditSettlement;
    if (fresh.record_scope !== "active") {
      return { status: "failed", order: fresh, errorCode: "WEB_AI_CREDIT_ORDER_DETACHED" } as WebAiCreditSettlement;
    }
    if (
      fresh.status === "done"
      || fresh.status === "refunded"
      || fresh.status === "refund_processing"
      || fresh.status === "refund_unknown"
    ) return orderResult(env.DB, fresh);
    if (!(await activeOrderOwnership(env.DB, fresh))) {
      return { status: "failed", order: fresh, errorCode: "WEB_AI_CREDIT_FORBIDDEN" } as WebAiCreditSettlement;
    }
    try {
      if (await hasBlockedDetachedFinancialState(env.DB, fresh.family_id, fresh.child_user_id)) {
        return {
          status: "failed",
          order: fresh,
          errorCode: "WEB_AI_CREDIT_REATTACH_REVIEW_REQUIRED",
        } as WebAiCreditSettlement;
      }
    } catch {
      return {
        status: "failed",
        order: fresh,
        errorCode: "WEB_AI_CREDIT_FINANCIAL_STATE_UNAVAILABLE",
      } as WebAiCreditSettlement;
    }
    // 성공 redirect가 checkout TTL 경계에 도착해도 결제사 정본을 확인할 기회를 잃지 않는다.
    const claimToken = await claimOrder(env.DB, fresh, now, true);
    if (!claimToken) {
      const latest = await loadWebAiCreditOrder(env.DB, fresh.order_id) ?? fresh;
      return orderResult(env.DB, latest);
    }

    let paymentState: Awaited<ReturnType<typeof findTossOneTimePaymentStateByOrderId>> = null;
    let confirmError: TossWebBillingRequestError | null = null;
    try {
      const payment = await confirmTossOneTimePayment(config, {
        paymentKey: input.paymentKey,
        customerKey: fresh.customer_key,
        amount: fresh.amount,
        orderId: fresh.order_id,
        idempotencyKey: fresh.idempotency_key,
      }, input.fetchImpl);
      paymentState = { state: "paid", paymentKey: payment.paymentKey };
    } catch (error) {
      confirmError = error instanceof TossWebBillingRequestError
        ? error
        : new TossWebBillingRequestError("TOSS_AI_CREDIT_CONFIRM_FAILED", { outcomeUnknown: true, cause: error });
      try {
        paymentState = await findTossOneTimePaymentStateByOrderId(config, {
          orderId: fresh.order_id,
          customerKey: fresh.customer_key,
          amount: fresh.amount,
        }, input.fetchImpl);
      } catch {
        paymentState = null;
        confirmError = new TossWebBillingRequestError("TOSS_AI_CREDIT_LOOKUP_FAILED", { outcomeUnknown: true });
      }
    }
    if (paymentState?.state === "paid") {
      return grantVerifiedPayment(env, fresh, claimToken, paymentState.paymentKey, now);
    }
    if (paymentState?.state === "refunded") {
      return finalizeUncreditedRefund(
        env,
        fresh,
        claimToken,
        paymentState.paymentKey,
        paymentState.refundedAmount,
        now,
      );
    }
    if (paymentState?.state === "partial_refund") {
      await releaseClaim(
        env.DB,
        fresh.order_id,
        claimToken,
        "unknown",
        "WEB_AI_CREDIT_PARTIAL_REFUND_REVIEW_REQUIRED",
        now,
      );
      const latest = await loadWebAiCreditOrder(env.DB, fresh.order_id) ?? fresh;
      return orderResult(env.DB, latest);
    }

    const unknown = paymentState?.state === "pending" || confirmError?.outcomeUnknown === true;
    await releaseClaim(
      env.DB,
      fresh.order_id,
      claimToken,
      unknown ? "unknown" : "failed",
      confirmError?.code ?? "TOSS_AI_CREDIT_CONFIRM_FAILED",
      now,
    );
    const latest = await loadWebAiCreditOrder(env.DB, fresh.order_id) ?? fresh;
    return orderResult(env.DB, latest);
  });
  return leased ?? { status: "busy", order: input.order, errorCode: "ACCOUNT_MUTATION_UNAVAILABLE" };
}

export async function reconcileWebAiCreditOrder(
  env: Env,
  input: { order: WebAiCreditOrderRow; now?: Date; fetchImpl?: FetchLike },
): Promise<WebAiCreditSettlement> {
  if (input.order.status === "refunded") return orderResult(env.DB, input.order);
  const config = configuredWebAiCreditBilling(env);
  if (!config) return { status: "unknown", order: input.order, errorCode: "WEB_AI_CREDIT_UNAVAILABLE" };
  const now = input.now ?? new Date();
  if (input.order.record_scope === "detached") {
    return reconcileDetachedOrder(env, input.order, config, now, input.fetchImpl);
  }
  const leased = await withOrderMutationLease(env, input.order, async () => {
    const fresh = await loadWebAiCreditOrder(env.DB, input.order.order_id);
    if (!fresh) return { status: "failed", order: input.order, errorCode: "WEB_AI_CREDIT_ORDER_NOT_FOUND" } as WebAiCreditSettlement;
    if (fresh.record_scope !== "active") {
      return { status: "busy", order: fresh, errorCode: "WEB_AI_CREDIT_SCOPE_CHANGED" } as WebAiCreditSettlement;
    }
    if (fresh.status === "refunded") return orderResult(env.DB, fresh);
    if (["done", "refund_processing", "refund_unknown"].includes(fresh.status)) {
      return reconcileRefundWithLease(env, fresh, config, now, input.fetchImpl);
    }
    try {
      if (await hasBlockedDetachedFinancialState(env.DB, fresh.family_id, fresh.child_user_id)) {
        const deferred = await deferReattachedOrderForReview(env.DB, fresh, now);
        return orderResult(env.DB, deferred);
      }
    } catch {
      return {
        status: "busy",
        order: fresh,
        errorCode: "WEB_AI_CREDIT_FINANCIAL_STATE_UNAVAILABLE",
      } as WebAiCreditSettlement;
    }
    const claimToken = await claimOrder(env.DB, fresh, now, true);
    if (!claimToken) {
      const latest = await loadWebAiCreditOrder(env.DB, fresh.order_id) ?? fresh;
      return orderResult(env.DB, latest);
    }
    try {
      const payment = await findTossOneTimePaymentStateByOrderId(config, {
        orderId: fresh.order_id,
        customerKey: fresh.customer_key,
        amount: fresh.amount,
      }, input.fetchImpl);
      if (payment?.state === "paid") {
        return grantVerifiedPayment(env, fresh, claimToken, payment.paymentKey, now);
      }
      if (payment?.state === "refunded") {
        return finalizeUncreditedRefund(
          env,
          fresh,
          claimToken,
          payment.paymentKey,
          payment.refundedAmount,
          now,
        );
      }
      if (payment?.state === "partial_refund") {
        await releaseClaim(
          env.DB,
          fresh.order_id,
          claimToken,
          "unknown",
          "WEB_AI_CREDIT_PARTIAL_REFUND_REVIEW_REQUIRED",
          now,
        );
        const latest = await loadWebAiCreditOrder(env.DB, fresh.order_id) ?? fresh;
        return orderResult(env.DB, latest);
      }
      const checkoutExpired = !payment
        && fresh.status === "pending"
        && Date.parse(pgToIso(fresh.expires_at)) <= now.getTime();
      const nextStatus = payment?.state === "failed" || checkoutExpired
        ? "failed"
        : fresh.status === "unknown" || fresh.status === "processing"
          ? "unknown"
          : fresh.status === "failed" || fresh.status === "expired"
            ? "failed"
            : "pending";
      await releaseClaim(
        env.DB,
        fresh.order_id,
        claimToken,
        nextStatus,
        nextStatus === "unknown"
          ? "TOSS_AI_CREDIT_NOT_FOUND"
          : checkoutExpired
            ? "WEB_AI_CREDIT_CHECKOUT_EXPIRED"
            : null,
        now,
      );
    } catch {
      await releaseClaim(
        env.DB,
        fresh.order_id,
        claimToken,
        "unknown",
        "TOSS_AI_CREDIT_LOOKUP_FAILED",
        now,
      );
    }
    const latest = await loadWebAiCreditOrder(env.DB, fresh.order_id) ?? fresh;
    return orderResult(env.DB, latest);
  });
  return leased ?? { status: "busy", order: input.order, errorCode: "ACCOUNT_MUTATION_UNAVAILABLE" };
}

export async function processWebAiCreditReconciliations(
  env: Env,
  options: {
    now?: Date;
    fetchImpl?: FetchLike;
    limit?: number;
    mode?: "all" | "recovery" | "refund";
  } = {},
): Promise<Record<string, number | boolean>> {
  if (!configuredWebAiCreditBilling(env)) {
    return { configured: false, checked: 0, done: 0, refunded: 0, unknown: 0, dueRemaining: false };
  }
  const now = options.now ?? new Date();
  const nowPg = pgTs(now);
  const doneFallbackCutoffPg = pgTs(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000));
  const limit = Math.max(1, Math.min(5, Math.trunc(options.limit ?? 1)));
  const mode = options.mode ?? "all";
  const statusFilter = mode === "recovery"
    ? "status IN ('unknown','processing')"
    : mode === "refund"
      ? "status IN ('done','refund_processing','refund_unknown')"
      : "status IN ('unknown','processing','done','refund_processing','refund_unknown')";
  const { results } = await env.DB.prepare(
    `SELECT order_id,family_id,parent_id,child_user_id,customer_key,product_code,credits,debt_applied,
             amount,currency,status,expires_at,idempotency_key,claim_token,claim_expires_at,
             payment_key_hash,record_scope,balance_scope,detach_reason,detached_at,
             granted_credits,grant_committed_at,refunded_credits,refund_committed_at,retention_until,
             refunded_amount,provider_checked_at,error_code,retry_after,
             created_at,completed_at
       FROM web_ai_credit_orders
      WHERE ${statusFilter}
        AND (retry_after IS NULL OR datetime(substr(retry_after,1,19))<=datetime(substr(?,1,19)))
         AND (status NOT IN ('processing','refund_processing') OR claim_expires_at IS NULL
           OR datetime(substr(claim_expires_at,1,19))<=datetime(substr(?,1,19)))
         AND (status<>'done' OR (completed_at IS NOT NULL
           AND datetime(substr(completed_at,1,19))>=datetime(substr(?,1,19))))
      ORDER BY COALESCE(retry_after,updated_at) ASC LIMIT ?`,
  ).bind(nowPg, nowPg, doneFallbackCutoffPg, limit).all<WebAiCreditOrderRow>();
  let checked = 0;
  let done = 0;
  let refunded = 0;
  let unknown = 0;
  for (const order of results ?? []) {
    checked += 1;
    const result = await reconcileWebAiCreditOrder(env, { order, now, fetchImpl: options.fetchImpl });
    if (result.status === "done") done += 1;
    else if (result.status === "refunded") refunded += 1;
    else unknown += 1;
  }
  const dueRow = await env.DB.prepare(
    `SELECT CASE WHEN EXISTS(
       SELECT 1 FROM web_ai_credit_orders
        WHERE ${statusFilter}
          AND (retry_after IS NULL OR datetime(substr(retry_after,1,19))<=datetime(substr(?,1,19)))
          AND (status NOT IN ('processing','refund_processing') OR claim_expires_at IS NULL
            OR datetime(substr(claim_expires_at,1,19))<=datetime(substr(?,1,19)))
          AND (status<>'done' OR (completed_at IS NOT NULL
            AND datetime(substr(completed_at,1,19))>=datetime(substr(?,1,19))))
       LIMIT 1
     ) THEN 1 ELSE 0 END AS due`,
  ).bind(nowPg, nowPg, doneFallbackCutoffPg).first<{ due: number }>();
  return {
    configured: true,
    checked,
    done,
    refunded,
    unknown,
    dueRemaining: Number(dueRow?.due ?? 0) === 1,
  };
}

export const WEB_AI_CREDIT_ABANDONED_RETENTION_DAYS = 30;
export const WEB_AI_CREDIT_FINANCIAL_RETENTION_YEARS = 5;

/** 미승인 주문은 30일, 승인·환불 결제 정본은 5년 보관한다. 미확정 금융 상태는 자동 삭제하지 않는다. */
export async function cleanupWebAiCreditOrders(
  db: D1Database,
  now = new Date(),
): Promise<{
  expired: number;
  removed: number;
  detachedBalancesRemoved: number;
  lookupWindowsRemoved: number;
}> {
  const nowPg = pgTs(now);
  const abandonedBefore = pgTs(new Date(
    now.getTime() - WEB_AI_CREDIT_ABANDONED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ));
  const financialBefore = pgTs(addUtcCalendarYears(now, -WEB_AI_CREDIT_FINANCIAL_RETENTION_YEARS));
  const expired = await db.prepare(
    `UPDATE web_ai_credit_orders
        SET status='expired',error_code='WEB_AI_CREDIT_CHECKOUT_EXPIRED',updated_at=?
      WHERE status='pending' AND payment_key_hash IS NULL
        AND datetime(substr(expires_at,1,19))<=datetime(substr(?,1,19))`,
  ).bind(nowPg, nowPg).run();
  const removed = await db.prepare(
    `DELETE FROM web_ai_credit_orders
      WHERE (
        status IN ('failed','expired') AND payment_key_hash IS NULL
        AND datetime(substr(created_at,1,19))<datetime(substr(?,1,19))
      ) OR (
        status IN ('done','refunded')
        AND (
          (retention_until IS NOT NULL
            AND datetime(substr(retention_until,1,19))<datetime(substr(?,1,19)))
          OR (retention_until IS NULL
            AND datetime(substr(COALESCE(completed_at,created_at),1,19))<datetime(substr(?,1,19)))
        )
      )`,
  ).bind(abandonedBefore, nowPg, financialBefore).run();
  const detachedBalancesRemoved = await db.prepare(
    `DELETE FROM web_ai_credit_detached_balances
      WHERE datetime(substr(retention_until,1,19))<datetime(substr(?,1,19))
        AND NOT EXISTS(
          SELECT 1 FROM web_ai_credit_orders retained
           WHERE retained.family_id=web_ai_credit_detached_balances.family_id
             AND retained.child_user_id=web_ai_credit_detached_balances.child_user_id
             AND (
               retained.status NOT IN ('failed','expired','refunded')
               OR retained.retention_until IS NULL
               OR datetime(substr(retained.retention_until,1,19))>=datetime(substr(?,1,19))
             )
        )`,
  ).bind(nowPg, nowPg).run();
  const lookupWindowsRemoved = await db.prepare(
    `DELETE FROM web_ai_credit_lookup_windows
      WHERE datetime(substr(updated_at,1,19))<datetime(substr(?,1,19),'-48 hours')`,
  ).bind(nowPg).run();
  return {
    expired: Number(expired.meta?.changes ?? 0),
    removed: Number(removed.meta?.changes ?? 0),
    detachedBalancesRemoved: Number(detachedBalancesRemoved.meta?.changes ?? 0),
    lookupWindowsRemoved: Number(lookupWindowsRemoved.meta?.changes ?? 0),
  };
}
