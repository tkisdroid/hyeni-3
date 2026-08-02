import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { resolveVerifiedFamilyMembership } from "../db/authz";
import {
  acquireAccountMutationLeases,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
} from "../lib/accountMutationScope";
import { readCommerceRuntimeControls } from "../lib/commerceRuntimeControls.ts";
import { pgToIso, pgTs } from "../lib/time";
import {
  WEB_AI_CREDIT_CHECKOUT_TTL_MS,
  WEB_AI_CREDIT_PACKS,
  createWebAiCreditCustomerKey,
  createWebAiCreditOrderId,
  findWebAiCreditPack,
  formatWebAiCreditKrw,
  readWebAiCreditCatalog,
} from "../shared/webAiCreditBilling.js";
import {
  completeWebAiCreditOrder,
  configuredWebAiCreditBilling,
  loadWebAiCreditOrder,
  reconcileWebAiCreditOrder,
  type WebAiCreditOrderRow,
  type WebAiCreditSettlement,
} from "../lib/webAiCreditBillingService";

type FetchLike = typeof fetch;

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const ORDER_ID = /^[A-Za-z0-9_-]{6,64}$/;
const CUSTOMER_KEY = /^HYENI_AI_[a-f0-9]{32}$/;
const PAYMENT_KEY = /^[\x21-\x7E]{1,200}$/;
const RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLIENT_LOOKUP_COOLDOWN_MS = 60_000;
const WEBHOOK_LOOKUP_COOLDOWN_MS = 15 * 60_000;
const FAMILY_LOOKUP_LIMIT_PER_HOUR = 30;
const WEBHOOK_BODY_MAX_BYTES = 64 * 1024;

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

async function activeParent(db: D1Database, userId: string, familyId: string): Promise<boolean> {
  if (!ID.test(userId) || !ID.test(familyId)) return false;
  return (await resolveVerifiedFamilyMembership(db, userId, familyId))?.role === "parent";
}

async function activeChild(db: D1Database, familyId: string, childUserId: string): Promise<boolean> {
  if (!ID.test(childUserId)) return false;
  const row = await db.prepare(
    `SELECT 1 AS ok FROM family_members
      WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1`,
  ).bind(familyId, childUserId).first<{ ok: number }>();
  return row?.ok === 1;
}

type ProviderLookupGate = "claimed" | "cooldown" | "family_limited";

function utcHourStart(value: Date): string {
  const start = new Date(value);
  start.setUTCMinutes(0, 0, 0);
  return pgTs(start);
}

async function claimFamilyProviderLookup(
  db: D1Database,
  familyId: string,
  now: Date,
): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO web_ai_credit_lookup_windows
       (family_id,window_started_at,attempts,updated_at)
     VALUES (?,?,1,?)
     ON CONFLICT(family_id,window_started_at) DO UPDATE SET
       attempts=web_ai_credit_lookup_windows.attempts+1,
       updated_at=excluded.updated_at
     WHERE web_ai_credit_lookup_windows.attempts<?`,
  ).bind(
    familyId,
    utcHourStart(now),
    pgTs(now),
    FAMILY_LOOKUP_LIMIT_PER_HOUR,
  ).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function claimProviderLookup(
  db: D1Database,
  input: {
    orderId: string;
    familyId: string;
    source: "client" | "webhook";
    now: Date;
  },
): Promise<ProviderLookupGate> {
  const cooldownMs = input.source === "webhook"
    ? WEBHOOK_LOOKUP_COOLDOWN_MS
    : CLIENT_LOOKUP_COOLDOWN_MS;
  const column = input.source === "webhook" ? "webhook_checked_at" : "client_checked_at";
  // column은 위의 고정된 두 값 중 하나만 사용한다. 사용자 입력을 SQL 식별자로 사용하지 않는다.
  const orderClaim = await db.prepare(
    `UPDATE web_ai_credit_orders SET ${column}=?
      WHERE order_id=? AND family_id=? AND status<>'refunded'
        AND (${column} IS NULL
          OR datetime(substr(${column},1,19))<=datetime(substr(?,1,19)))`,
  ).bind(
    pgTs(input.now),
    input.orderId,
    input.familyId,
    pgTs(new Date(input.now.getTime() - cooldownMs)),
  ).run();
  if (Number(orderClaim.meta?.changes ?? 0) !== 1) return "cooldown";
  return await claimFamilyProviderLookup(db, input.familyId, input.now)
    ? "claimed"
    : "family_limited";
}

function completedPayload(result: Extract<WebAiCreditSettlement, { status: "done" }>) {
  return {
    ok: true as const,
    status: "done" as const,
    orderId: result.order.order_id,
    productCode: result.order.product_code,
    credits: result.order.credits,
    debtApplied: result.order.debt_applied,
    availableCreditsAdded: result.order.credits - result.order.debt_applied,
    creditStatus: result.creditStatus,
  };
}

function settlementResponse(c: { json: (value: unknown, status?: number) => Response }, result: WebAiCreditSettlement) {
  if (result.status === "done") return c.json(completedPayload(result));
  if (result.status === "failed") {
    return c.json({ ok: false, status: "failed", error: "web_ai_credit_payment_failed" }, 402);
  }
  if (result.status === "refunded") {
    return c.json({ ok: false, status: "refunded", error: "web_ai_credit_payment_refunded" }, 402);
  }
  return c.json({
    ok: false,
    status: result.status,
    error: "web_ai_credit_reconciliation_pending",
  }, 202);
}

function recoverableWebAiCreditOrder(
  order: WebAiCreditOrderRow,
  input: {
    familyId: string;
    parentId: string;
    childUserId: string;
    orderId: string;
    amount: number;
    now: Date;
  },
) {
  const product = WEB_AI_CREDIT_PACKS.find(
    (pack) => pack.productCode === order.product_code && pack.credits === order.credits,
  );
  const expiresAtMs = Date.parse(pgToIso(order.expires_at));
  if (
    order.family_id !== input.familyId
    || order.parent_id !== input.parentId
    || order.child_user_id !== input.childUserId
    || order.order_id !== input.orderId
    || order.amount !== input.amount
    || !Number.isSafeInteger(order.amount)
    || order.amount <= 0
    || order.amount > 10_000_000
    || order.currency !== "KRW"
    || !CUSTOMER_KEY.test(order.customer_key)
    || !product
    || order.record_scope !== "active"
    || order.balance_scope !== "active"
    || order.detach_reason !== null
    || order.detached_at !== null
    || !["pending", "processing", "unknown", "done"].includes(order.status)
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs + RECOVERY_RETENTION_MS <= input.now.getTime()
  ) return null;
  return {
    familyId: order.family_id,
    childUserId: order.child_user_id,
    orderId: order.order_id,
    customerKey: order.customer_key,
    productCode: product.productCode,
    credits: product.credits,
    amount: order.amount,
    currency: "KRW" as const,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function createWebAiCreditBillingRoutes(
  options: { fetchImpl?: FetchLike; now?: () => Date } = {},
) {
  const routes = new Hono<{ Bindings: Env; Variables: Vars }>();

  routes.get("/web/ai-credits/catalog", requireAuth, async (c) => {
    const familyId = c.req.query("familyId") ?? "";
    const userId = c.get("user").sub;
    if (!(await activeParent(c.env.DB, userId, familyId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const controls = await readCommerceRuntimeControls(c.env.DB);
    if (!controls.webAiCreditNewCheckoutsEnabled) {
      c.header("Cache-Control", "no-store");
      c.header("Retry-After", "300");
      return c.json({ error: "web_ai_credit_new_checkouts_paused" }, 503);
    }
    const configured = configuredWebAiCreditBilling(c.env) !== null;
    const packs = configured ? readWebAiCreditCatalog(c.env) : [];
    return c.json({
      provider: "toss_payments",
      currency: "KRW",
      configured: configured && packs.length > 0,
      packs,
    });
  });

  routes.post("/web/ai-credits/checkout-session", requireAuth, async (c) => {
    const body = await jsonBody(c);
    if (body === BODY_TOO_LARGE) return c.json({ error: "request_too_large" }, 413);
    const familyId = typeof body?.familyId === "string" ? body.familyId.trim() : "";
    const childUserId = typeof body?.childUserId === "string" ? body.childUserId.trim() : "";
    const productCode = typeof body?.productCode === "string" ? body.productCode : "";
    const userId = c.get("user").sub;
    if (!ID.test(familyId) || !ID.test(childUserId)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (!(await activeParent(c.env.DB, userId, familyId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (!(await activeChild(c.env.DB, familyId, childUserId))) {
      return c.json({ error: "child_not_found" }, 400);
    }
    const controls = await readCommerceRuntimeControls(c.env.DB);
    if (!controls.webAiCreditNewCheckoutsEnabled) {
      c.header("Cache-Control", "no-store");
      c.header("Retry-After", "300");
      return c.json({ error: "web_ai_credit_new_checkouts_paused" }, 503);
    }
    const config = configuredWebAiCreditBilling(c.env);
    const pack = findWebAiCreditPack(readWebAiCreditCatalog(c.env), productCode);
    if (!config || !pack) return c.json({ error: "web_ai_credit_pack_unavailable" }, 503);

    const scopes = await loadFamilyNotificationMutationScopes(
      c.env.DB,
      familyId,
      [userId, childUserId],
    );
    if (!scopes) return c.json({ error: "account_mutation_unavailable" }, 503);
    const leaseResult = await acquireAccountMutationLeases(c.env.DB, scopes);
    if (leaseResult.status !== "acquired") {
      return c.json({
        error: leaseResult.status === "blocked" ? "account_mutation_blocked" : "account_mutation_unavailable",
      }, leaseResult.status === "blocked" ? 409 : 503);
    }
    try {
      if (
        !(await activeParent(c.env.DB, userId, familyId))
        || !(await activeChild(c.env.DB, familyId, childUserId))
      ) return c.json({ error: "forbidden" }, 403);
      const now = new Date();
      const nowPg = pgTs(now);
      const reusable = await c.env.DB.prepare(
        `SELECT order_id,family_id,parent_id,child_user_id,customer_key,product_code,credits,debt_applied,
                amount,currency,status,expires_at,idempotency_key,claim_token,claim_expires_at,
                payment_key_hash,refunded_amount,provider_checked_at,error_code,retry_after,
                created_at,completed_at
           FROM web_ai_credit_orders
          WHERE family_id=? AND parent_id=? AND child_user_id=? AND product_code=?
            AND status='pending'
            AND datetime(substr(expires_at,1,19))>datetime(substr(?,1,19))
          ORDER BY created_at DESC LIMIT 1`,
      ).bind(familyId, userId, childUserId, pack.productCode, nowPg).first<WebAiCreditOrderRow>();
      if (reusable) {
        return c.json({
          orderId: reusable.order_id,
          customerKey: reusable.customer_key,
          clientKey: config.clientKey,
          productCode: reusable.product_code,
          credits: reusable.credits,
          amount: reusable.amount,
          currency: reusable.currency,
          displayPrice: formatWebAiCreditKrw(reusable.amount),
          expiresAt: pgToIso(reusable.expires_at),
        });
      }

      const orderId = createWebAiCreditOrderId();
      const customerKey = createWebAiCreditCustomerKey();
      const expiresAt = new Date(now.getTime() + WEB_AI_CREDIT_CHECKOUT_TTL_MS);
      await c.env.DB.prepare(
        `INSERT INTO web_ai_credit_orders
           (order_id,family_id,parent_id,child_user_id,customer_key,product_code,credits,
            amount,currency,status,expires_at,idempotency_key,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)`,
      ).bind(
        orderId,
        familyId,
        userId,
        childUserId,
        customerKey,
        pack.productCode,
        pack.credits,
        pack.amount,
        "KRW",
        pgTs(expiresAt),
        crypto.randomUUID(),
        nowPg,
        nowPg,
      ).run();
      return c.json({
        orderId,
        customerKey,
        clientKey: config.clientKey,
        productCode: pack.productCode,
        credits: pack.credits,
        amount: pack.amount,
        currency: "KRW",
        displayPrice: pack.displayPrice,
        expiresAt: expiresAt.toISOString(),
      });
    } catch {
      return c.json({ error: "web_ai_credit_checkout_unavailable" }, 503);
    } finally {
      await releaseAccountMutationLeases(c.env.DB, leaseResult.leases);
    }
  });

  routes.post("/web/ai-credits/checkout-session/resolve", requireAuth, async (c) => {
    const body = await jsonBody(c);
    if (body === BODY_TOO_LARGE) return c.json({ error: "request_too_large" }, 413);
    const familyId = typeof body?.familyId === "string" ? body.familyId.trim() : "";
    const childUserId = typeof body?.childUserId === "string" ? body.childUserId.trim() : "";
    const orderId = typeof body?.orderId === "string" ? body.orderId : "";
    const amount = body?.amount;
    const userId = c.get("user").sub;
    if (
      !ID.test(familyId)
      || !ID.test(childUserId)
      || !ORDER_ID.test(orderId)
      || !Number.isSafeInteger(amount)
      || Number(amount) <= 0
      || Number(amount) > 10_000_000
    ) return c.json({ error: "invalid_request" }, 400);

    try {
      const [isParent, isChild, order] = await Promise.all([
        activeParent(c.env.DB, userId, familyId),
        activeChild(c.env.DB, familyId, childUserId),
        loadWebAiCreditOrder(c.env.DB, orderId),
      ]);
      const recovered = isParent && isChild && order
        ? recoverableWebAiCreditOrder(order, {
          familyId,
          parentId: userId,
          childUserId,
          orderId,
          amount: Number(amount),
          now: options.now?.() ?? new Date(),
        })
        : null;
      if (!recovered) {
        return c.json({ error: "web_ai_credit_order_not_found" }, 404);
      }
      c.header("Cache-Control", "no-store");
      return c.json(recovered);
    } catch {
      return c.json({ error: "web_ai_credit_order_resolution_unavailable" }, 503);
    }
  });

  routes.post("/web/ai-credits/complete", requireAuth, async (c) => {
    const body = await jsonBody(c);
    if (body === BODY_TOO_LARGE) return c.json({ error: "request_too_large" }, 413);
    const familyId = typeof body?.familyId === "string" ? body.familyId.trim() : "";
    const childUserId = typeof body?.childUserId === "string" ? body.childUserId.trim() : "";
    const orderId = typeof body?.orderId === "string" ? body.orderId : "";
    const paymentKey = typeof body?.paymentKey === "string" ? body.paymentKey : "";
    const amount = body?.amount;
    const userId = c.get("user").sub;
    if (
      !ID.test(familyId)
      || !ID.test(childUserId)
      || !ORDER_ID.test(orderId)
      || !PAYMENT_KEY.test(paymentKey)
      || !Number.isSafeInteger(amount)
      || Number(amount) <= 0
    ) return c.json({ error: "invalid_request" }, 400);
    if (!(await activeParent(c.env.DB, userId, familyId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const order = await loadWebAiCreditOrder(c.env.DB, orderId);
    if (
      !order
      || order.family_id !== familyId
      || order.parent_id !== userId
      || order.child_user_id !== childUserId
    ) return c.json({ error: "web_ai_credit_order_not_found" }, 404);
    if (order.amount !== amount || order.currency !== "KRW") {
      return c.json({ error: "web_ai_credit_amount_mismatch" }, 400);
    }
    if (order.status !== "done" && order.status !== "refunded") {
      const now = options.now?.() ?? new Date();
      let gate: ProviderLookupGate;
      try {
        gate = await claimProviderLookup(c.env.DB, {
          orderId: order.order_id,
          familyId: order.family_id,
          source: "client",
          now,
        });
      } catch {
        return c.json({ error: "web_ai_credit_lookup_guard_unavailable" }, 503);
      }
      if (gate !== "claimed") {
        c.header("Retry-After", gate === "family_limited" ? "3600" : "60");
        return c.json({
          error: gate === "family_limited"
            ? "web_ai_credit_lookup_rate_limited"
            : "web_ai_credit_lookup_retry_later",
        }, 429);
      }
    }
    const now = options.now?.() ?? new Date();
    const result = await completeWebAiCreditOrder(c.env, {
      order,
      paymentKey,
      now,
      fetchImpl: options.fetchImpl,
    });
    return settlementResponse(c, result);
  });

  routes.post("/web/ai-credits/reconcile", requireAuth, async (c) => {
    const body = await jsonBody(c);
    if (body === BODY_TOO_LARGE) return c.json({ error: "request_too_large" }, 413);
    const familyId = typeof body?.familyId === "string" ? body.familyId.trim() : "";
    const childUserId = typeof body?.childUserId === "string" ? body.childUserId.trim() : "";
    const orderId = typeof body?.orderId === "string" ? body.orderId : "";
    const userId = c.get("user").sub;
    if (!ID.test(familyId) || !ID.test(childUserId) || !ORDER_ID.test(orderId)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (!(await activeParent(c.env.DB, userId, familyId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const order = await loadWebAiCreditOrder(c.env.DB, orderId);
    if (
      !order
      || order.family_id !== familyId
      || order.parent_id !== userId
      || order.child_user_id !== childUserId
    ) return c.json({ error: "web_ai_credit_order_not_found" }, 404);
    if (order.status !== "refunded") {
      const now = options.now?.() ?? new Date();
      let gate: ProviderLookupGate;
      try {
        gate = await claimProviderLookup(c.env.DB, {
          orderId: order.order_id,
          familyId: order.family_id,
          source: "client",
          now,
        });
      } catch {
        return c.json({ error: "web_ai_credit_lookup_guard_unavailable" }, 503);
      }
      if (gate !== "claimed") {
        c.header("Retry-After", gate === "family_limited" ? "3600" : "60");
        return c.json({
          error: gate === "family_limited"
            ? "web_ai_credit_lookup_rate_limited"
            : "web_ai_credit_lookup_retry_later",
        }, 429);
      }
    }
    const now = options.now?.() ?? new Date();
    const result = await reconcileWebAiCreditOrder(c.env, {
      order,
      now,
      fetchImpl: options.fetchImpl,
    });
    return settlementResponse(c, result);
  });

  // Toss 일반 웹훅은 서명값을 신뢰하지 않는다. 알려진 난수 orderId만 받아 결제사 API를 다시 조회한다.
  routes.post("/web/ai-credits/webhook", async (c) => {
    const body = await jsonBody(c, WEBHOOK_BODY_MAX_BYTES);
    if (body === BODY_TOO_LARGE) return c.json({ ok: false }, 413);
    const data = bodyRecord(body?.data);
    const orderId = body?.eventType === "PAYMENT_STATUS_CHANGED"
      && typeof data?.orderId === "string"
      ? data.orderId
      : "";
    if (!ORDER_ID.test(orderId)) return c.json({ ok: true, accepted: false });
    const order = await loadWebAiCreditOrder(c.env.DB, orderId);
    if (!order) return c.json({ ok: true, accepted: false });
    if (order.status === "refunded") {
      return c.json({ ok: true, accepted: true, settled: true });
    }
    const now = options.now?.() ?? new Date();
    let gate: ProviderLookupGate;
    try {
      gate = await claimProviderLookup(c.env.DB, {
        orderId: order.order_id,
        familyId: order.family_id,
        source: "webhook",
        now,
      });
    } catch {
      return c.json({ ok: false, accepted: false }, 503);
    }
    if (gate !== "claimed") {
      // 일반결제 webhook에는 검증 가능한 서명이 없다. 냉각 중에는 내부 상태를
      // 승격하지 않고 non-200으로 응답해 Toss 공식 재전송 정책에 맡긴다.
      c.header("Retry-After", gate === "family_limited" ? "3600" : "900");
      return c.json({ ok: false, accepted: true, settled: false, deferred: true }, 429);
    }
    const result = await reconcileWebAiCreditOrder(c.env, {
      order,
      now,
      fetchImpl: options.fetchImpl,
    });
    const settled = result.status === "done" || result.status === "refunded";
    const manualReviewAccepted = result.status === "unknown"
      && result.errorCode === "WEB_AI_CREDIT_PARTIAL_REFUND_REVIEW_REQUIRED";
    if (settled || manualReviewAccepted) {
      return c.json({ ok: true, accepted: true, settled });
    }
    c.header("Retry-After", "900");
    return c.json({ ok: false, accepted: true, settled: false }, 503);
  });

  return routes;
}

export default createWebAiCreditBillingRoutes();
