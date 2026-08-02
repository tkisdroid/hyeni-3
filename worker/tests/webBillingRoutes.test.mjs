import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import "./helpers/tsModuleResolve.mjs";
import { exportJWK, generateKeyPair } from "jose";

const FAMILY_ID = "family-web";
const PARENT_ID = "parent-web";
const CO_PARENT_ID = "co-parent-web";
const CHILD_ID = "child-web";
const ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");

const { createWebBillingRoutes } = await import("../routes/web-billing.ts");
const { default: entitlementRoutes } = await import("../routes/entitlement.ts");
const {
  cleanupWebBillingFinancialRecords,
  finalizeInitialWebBilling,
  processWebBillingRefundFunnelRetries,
  processWebBillingRefundReconciliations,
  processWebBillingRenewals,
  revokeWebBillingBeforeAccountDeletion,
} = await import("../lib/webBillingService.ts");
const { buildFamilyScopedDeleteStmts } = await import("../lib/accountDeletion.ts");
const { claimBillingProvider } = await import("../lib/billingProviderReservation.ts");
const {
  addWebBillingPeriod,
  createWebBillingOrderId,
  encryptWebBillingSecret,
  hashWebBillingPaymentKey,
} = await import("../shared/webBilling.js");
const { signAccessToken } = await import("../lib/jwt.ts");
class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.beforeRun = null;
    this.queryCount = 0;
  }

  exec(sql) {
    this.sqlite.exec(sql);
  }

  prepare(sql, bindings = []) {
    const db = this;
    return {
      bind(...nextBindings) {
        return db.prepare(sql, nextBindings);
      },
      async run() {
        db.queryCount += 1;
        const values = bindings.map((value) => value === undefined ? null : value);
        if (typeof db.beforeRun === "function") await db.beforeRun(sql, values);
        const result = db.sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async first() {
        db.queryCount += 1;
        const values = bindings.map((value) => value === undefined ? null : value);
        return db.sqlite.prepare(sql).get(...values) ?? null;
      },
      async all() {
        db.queryCount += 1;
        const values = bindings.map((value) => value === undefined ? null : value);
        return { success: true, results: db.sqlite.prepare(sql).all(...values) };
      },
    };
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  row(sql, ...bindings) {
    return this.sqlite.prepare(sql).get(...bindings) ?? null;
  }

  resetQueryCount() {
    this.queryCount = 0;
  }

  close() {
    this.sqlite.close();
  }
}

function createDb() {
  const db = new SqliteD1();
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE families(
      id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, user_tier TEXT,
      subscription_tier TEXT, created_at TEXT
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT, role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT, last_selected_at TEXT
    );
    CREATE TABLE family_subscription(
      family_id TEXT PRIMARY KEY, status TEXT NOT NULL, product_id TEXT NOT NULL,
      qonversion_user_id TEXT NOT NULL, trial_ends_at TEXT, current_period_end TEXT,
      cancelled_at TEXT, last_event_id TEXT, last_event_at TEXT,
      raw_event TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      remote_listen_enabled INTEGER DEFAULT 1, provider TEXT NOT NULL DEFAULT 'google_play',
      base_plan_id TEXT, purchase_token_hash TEXT, latest_order_id TEXT,
      acknowledged_at TEXT, google_play_raw TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE subscriptions(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, status TEXT, expires_at TEXT
    );
    CREATE TABLE family_review_rewards(
      family_id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, reward_type TEXT,
      granted_at TEXT, updated_at TEXT
    );
    CREATE TABLE account_deletion_scopes(
      job_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(scope_type,scope_id)
    );
    CREATE TABLE account_mutation_leases(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE family_unpair_cleanup_jobs(family_id TEXT NOT NULL, child_user_id TEXT NOT NULL);
    CREATE TABLE google_play_purchase_events(
      purchase_token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL,
      child_user_id TEXT, parent_id TEXT,
      product_type TEXT NOT NULL, product_id TEXT NOT NULL, base_plan_id TEXT,
      order_id TEXT,
      status TEXT NOT NULL, verification_result TEXT NOT NULL DEFAULT '{}',
      granted_at TEXT, acknowledged_at TEXT, consumed_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE app_global_settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(readFileSync(new URL("../db/premium-funnel.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../db/web-billing.sql", import.meta.url), "utf8"));
  db.sqlite.prepare("INSERT INTO users(id) VALUES (?),(?),(?)").run(PARENT_ID, CO_PARENT_ID, CHILD_ID);
  db.sqlite.prepare("INSERT INTO families VALUES (?,?,?,?,?)").run(
    FAMILY_ID,
    PARENT_ID,
    "free",
    "free",
    "2026-08-01 00:00:00+00",
  );
  db.sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1,?,NULL)").run(
    "member-parent",
    FAMILY_ID,
    PARENT_ID,
    "parent",
    "2026-08-01 00:00:00+00",
  );
  db.sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1,?,NULL)").run(
    "member-co-parent",
    FAMILY_ID,
    CO_PARENT_ID,
    "parent",
    "2026-08-01 00:00:00+00",
  );
  db.sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1,?,NULL)").run(
    "member-child",
    FAMILY_ID,
    CHILD_ID,
    "child",
    "2026-08-01 00:00:00+00",
  );
  db.sqlite.prepare(
    "INSERT INTO app_global_settings(key,value,updated_by) VALUES (?,?,?)",
  ).run(
    "commerce_runtime_controls_v1",
    JSON.stringify({
      webSubscriptionNewCheckoutsEnabled: true,
      webAiCreditNewCheckoutsEnabled: true,
    }),
    "test-fixture",
  );
  return db;
}

function setCommerceControls(db, overrides = {}) {
  db.sqlite.prepare(
    "UPDATE app_global_settings SET value=?,updated_by=? WHERE key=?",
  ).run(
    JSON.stringify({
      webSubscriptionNewCheckoutsEnabled: true,
      webAiCreditNewCheckoutsEnabled: true,
      ...overrides,
    }),
    "runtime-control-test",
    "commerce_runtime_controls_v1",
  );
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

function env(db, overrides = {}) {
  return {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    TOSS_PAYMENTS_CLIENT_KEY: "test_ck_1234567890",
    TOSS_PAYMENTS_SECRET_KEY: "test_sk_1234567890",
    WEB_BILLING_KEY_ENCRYPTION_SECRET: ENCRYPTION_KEY,
    PREMIUM_FUNNEL_HASH_SECRET: "premium-funnel-test-secret-32-bytes-minimum",
    FAMILY_ROOM: {
      idFromName(value) { return value; },
      get() {
        return { async fetch() { return new Response(null, { status: 204 }); } };
      },
    },
    ...overrides,
  };
}

async function auth(userId = PARENT_ID, role = "parent") {
  const token = await signAccessToken({
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
  }, {
    sub: userId,
    role,
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  return `Bearer ${token}`;
}

async function jsonRequest(routes, bindings, path, input = {}) {
  const method = input.method ?? "GET";
  const response = await routes.request(`https://local.test${path}`, {
    method,
    headers: {
      Authorization: input.authorization ?? await auth(),
      ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(input.body ?? {}) }),
  }, bindings);
  return { response, body: await response.json() };
}

function payment(orderId, _customerKey, amount) {
  return {
    paymentKey: `payment-${orderId}`,
    orderId,
    status: "DONE",
    type: "BILLING",
    currency: "KRW",
    totalAmount: amount,
  };
}

function refundPayment(orderId, amount, refundedAmount, paymentKey = `payment-${orderId}`) {
  const balanceAmount = amount - refundedAmount;
  return {
    paymentKey,
    orderId,
    status: balanceAmount === 0 ? "CANCELED" : "PARTIAL_CANCELED",
    type: "BILLING",
    currency: "KRW",
    totalAmount: amount,
    balanceAmount,
    cancels: [{
      cancelAmount: refundedAmount,
      refundableAmount: balanceAmount,
      transactionKey: `cancel-${orderId}-${refundedAmount}`,
      cancelStatus: "DONE",
      canceledAt: "2026-08-01T12:00:00+09:00",
    }],
  };
}

function refundAwareProvider(requests, states) {
  return async (url, init = {}) => {
    const parsedUrl = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url: parsedUrl, method: init.method, body });
    if (parsedUrl.endsWith("/v1/billing/authorizations/issue")) {
      return Response.json({ customerKey: body.customerKey, billingKey: "billing-key-refund" });
    }
    if (init.method === "DELETE" && parsedUrl.includes("/v1/billing/")) {
      return new Response(null, { status: 200 });
    }
    if (parsedUrl.includes("/v1/payments/orders/")) {
      const orderId = decodeURIComponent(parsedUrl.split("/").at(-1));
      const state = states.get(orderId);
      return state ? Response.json(state) : Response.json({ code: "NOT_FOUND" }, { status: 404 });
    }
    if (parsedUrl.includes("/v1/billing/")) {
      return Response.json(payment(body.orderId, body.customerKey, body.amount));
    }
    throw new Error("unexpected_provider_request");
  };
}

async function activatePaidSubscription(routes, bindings, plan = "month") {
  const checkout = await createCheckout(routes, bindings, plan);
  const completed = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.sessionId,
      customerKey: checkout.customerKey,
      authKey: "auth-key-refund",
    },
  });
  assert.equal(completed.response.status, 200);
  const attempt = bindings.DB.row(
    `SELECT order_id,amount,plan,period_start,period_end,payment_key_hash
       FROM web_billing_charge_attempts WHERE family_id=? AND status='done'
       ORDER BY completed_at DESC LIMIT 1`,
    FAMILY_ID,
  );
  assert.ok(attempt);
  return attempt;
}

function successProvider(requests) {
  return async (url, init = {}) => {
    const parsedUrl = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url: parsedUrl, method: init.method, body, authorization: init.headers?.Authorization });
    if (init.method === "DELETE" && parsedUrl.includes("/v1/billing/")) {
      return new Response(null, { status: 200 });
    }
    if (parsedUrl.endsWith("/v1/billing/authorizations/issue")) {
      return Response.json({ customerKey: body.customerKey, billingKey: "billing-key-123" });
    }
    if (parsedUrl.includes("/v1/billing/")) {
      return Response.json(payment(body.orderId, body.customerKey, body.amount));
    }
    throw new Error("unexpected_provider_request");
  };
}

async function createCheckout(routes, bindings, plan = "month") {
  bindings.DB.sqlite.prepare(
    `INSERT OR IGNORE INTO web_billing_trial_claims
       (family_id,parent_id,checkout_session_id,plan,status,claimed_at,trial_ends_at,updated_at)
     VALUES (?,?,?,'month','expired',?,?,?)`,
  ).run(
    FAMILY_ID,
    PARENT_ID,
    `paid-fixture-${FAMILY_ID}`,
    "2026-01-01 00:00:00+00",
    "2026-01-08 00:00:00+00",
    "2026-01-08 00:00:00+00",
  );
  const result = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan, trialExpected: false },
  });
  assert.equal(result.response.status, 200);
  return result.body;
}

test("catalog은 인증된 현재 부모에게만 정확한 서버 가격을 주고 설정 누락은 503으로 닫는다", async () => {
  const db = createDb();
  const routes = createWebBillingRoutes();
  const configured = env(db);
  const catalog = await jsonRequest(routes, configured, `/web/catalog?familyId=${FAMILY_ID}`);
  assert.equal(catalog.response.status, 200);
  assert.deepEqual(catalog.body, {
    provider: "toss_payments",
    trialEligible: true,
    trialDays: 7,
    plans: {
      month: { amount: 4_900, displayPrice: "월 4,900원" },
      year: { amount: 39_000, displayPrice: "연 39,000원" },
    },
    currency: "KRW",
  });
  assert.equal("clientKey" in catalog.body, false);

  const child = await jsonRequest(routes, configured, `/web/catalog?familyId=${FAMILY_ID}`, {
    authorization: await auth(CHILD_ID, "child"),
  });
  assert.equal(child.response.status, 403);
  const unavailable = await jsonRequest(routes, env(db, { TOSS_PAYMENTS_SECRET_KEY: undefined }), `/web/catalog?familyId=${FAMILY_ID}`);
  assert.equal(unavailable.response.status, 503);
  db.close();
});

test("브라우저 pending 유실 시 현재 부모와 customerKey가 일치하는 checkout session만 복구한다", async () => {
  const db = createDb();
  try {
    const routes = createWebBillingRoutes();
    const bindings = env(db);
    const checkout = await createCheckout(routes, bindings);

    const recovered = await jsonRequest(routes, bindings, "/web/checkout-session/resolve", {
      method: "POST",
      body: { familyId: FAMILY_ID, customerKey: checkout.customerKey },
    });
    assert.equal(recovered.response.status, 200);
    assert.deepEqual(recovered.body, {
      sessionId: checkout.sessionId,
      customerKey: checkout.customerKey,
    });
    assert.equal(recovered.response.headers.get("Cache-Control"), "no-store");

    const wrongCustomer = await jsonRequest(routes, bindings, "/web/checkout-session/resolve", {
      method: "POST",
      body: { familyId: FAMILY_ID, customerKey: "customer_other" },
    });
    assert.equal(wrongCustomer.response.status, 404);
    assert.equal(wrongCustomer.body.error, "web_billing_session_not_found");

    const coParent = await jsonRequest(routes, bindings, "/web/checkout-session/resolve", {
      method: "POST",
      authorization: await auth(CO_PARENT_ID, "parent"),
      body: { familyId: FAMILY_ID, customerKey: checkout.customerKey },
    });
    assert.equal(coParent.response.status, 404);

    const child = await jsonRequest(routes, bindings, "/web/checkout-session/resolve", {
      method: "POST",
      authorization: await auth(CHILD_ID, "child"),
      body: { familyId: FAMILY_ID, customerKey: checkout.customerKey },
    });
    assert.equal(child.response.status, 403);

    db.sqlite.prepare(
      "UPDATE web_billing_checkout_sessions SET status='failed' WHERE id=?",
    ).run(checkout.sessionId);
    const failed = await jsonRequest(routes, bindings, "/web/checkout-session/resolve", {
      method: "POST",
      body: { familyId: FAMILY_ID, customerKey: checkout.customerKey },
    });
    assert.equal(failed.response.status, 404);
  } finally {
    db.close();
  }
});

test("웹 구독 신규 결제 중지는 catalog과 checkout만 503으로 닫고 주문을 만들지 않는다", async () => {
  const db = createDb();
  try {
    setCommerceControls(db, { webSubscriptionNewCheckoutsEnabled: false });
    const routes = createWebBillingRoutes();
    const bindings = env(db);

    const catalog = await jsonRequest(routes, bindings, `/web/catalog?familyId=${FAMILY_ID}`);
    assert.equal(catalog.response.status, 503);
    assert.equal(catalog.body.error, "web_subscription_new_checkouts_paused");
    assert.equal(catalog.response.headers.get("Cache-Control"), "no-store");
    assert.equal(catalog.response.headers.get("Retry-After"), "300");

    const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
      method: "POST",
      body: { familyId: FAMILY_ID, plan: "month", trialExpected: true },
    });
    assert.equal(checkout.response.status, 503);
    assert.equal(checkout.body.error, "web_subscription_new_checkouts_paused");
    assert.equal(checkout.response.headers.get("Cache-Control"), "no-store");
    assert.equal(checkout.response.headers.get("Retry-After"), "300");
    assert.equal(db.row("SELECT COUNT(*) AS n FROM web_billing_checkout_sessions").n, 0);
  } finally {
    db.close();
  }
});

test("웹 구독 신규 결제 중지 뒤에도 이미 만든 checkout 완료와 기존 구독 해지는 계속된다", async () => {
  const db = createDb();
  try {
    const requests = [];
    const routes = createWebBillingRoutes({ fetchImpl: successProvider(requests) });
    const bindings = env(db);
    const checkout = await createCheckout(routes, bindings);

    setCommerceControls(db, { webSubscriptionNewCheckoutsEnabled: false });
    const completed = await jsonRequest(routes, bindings, "/web/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        sessionId: checkout.sessionId,
        customerKey: checkout.customerKey,
        authKey: "auth-key-runtime-control",
      },
    });
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.status, "active");

    const cancelled = await jsonRequest(routes, bindings, "/web/cancel", {
      method: "POST",
      body: { familyId: FAMILY_ID },
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.status, "cancelled");
    assert.equal(
      db.row("SELECT status FROM web_billing_customers WHERE family_id=?", FAMILY_ID).status,
      "cancel_at_period_end",
    );
    assert.ok(requests.some((entry) => entry.method === "DELETE"));
  } finally {
    db.close();
  }
});

test("만료된 Google Play 구독의 검증된 구매 이력도 가족 평생 체험을 다시 열지 않는다", async () => {
  const db = createDb();
  const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
  const bindings = env(db);
  const paidAt = "2026-01-01 00:00:00+00";
  db.sqlite.prepare(
    `INSERT INTO google_play_purchase_events
       (purchase_token_hash,family_id,parent_id,product_type,product_id,base_plan_id,
        order_id,status,verification_result,granted_at,created_at,updated_at)
     VALUES (?,?,?,'subscription','hyeni_premium','monthly-4900',?,'expired','{}',?,?,?)`,
  ).run("expired-google-hash", FAMILY_ID, PARENT_ID, "GPA.expired", paidAt, paidAt, paidAt);

  const catalog = await jsonRequest(routes, bindings, `/web/catalog?familyId=${FAMILY_ID}`);
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.body.trialEligible, false);
  assert.equal(catalog.body.trialDays, 0);
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "month", trialExpected: true },
  });
  assert.equal(checkout.response.status, 409);
  assert.equal(checkout.body.error, "web_billing_trial_state_changed");
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_checkout_sessions").count, 0);
  db.close();
});

test("완료된 Toss 과거 청구 이력도 현재 구독 행이 없어도 가족 평생 체험을 다시 열지 않는다", async () => {
  const db = createDb();
  const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
  const bindings = env(db);
  db.sqlite.prepare(
    `INSERT INTO web_billing_charge_attempts
       (order_id,family_id,checkout_session_id,plan,amount,kind,period_start,period_end,
        status,created_at,completed_at,updated_at)
     VALUES (?,?,NULL,'month',4900,'renewal',?,?,'done',?,?,?)`,
  ).run(
    "HYENI-R-paid-history",
    FAMILY_ID,
    "2026-01-01 00:00:00+00",
    "2026-02-01 00:00:00+00",
    "2026-01-01 00:00:00+00",
    "2026-01-01 00:00:00+00",
    "2026-01-01 00:00:00+00",
  );

  const catalog = await jsonRequest(routes, bindings, `/web/catalog?familyId=${FAMILY_ID}`);
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.body.trialEligible, false);
  db.close();
});

test("Toss 구독 정본의 과거 유료 주문은 최신 trial 마커와 함께 있어도 평생 체험을 다시 열지 않는다", async () => {
  const db = createDb();
  const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
  const bindings = env(db);
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,current_period_end,last_event_id,
        last_event_at,raw_event,created_at,updated_at,provider,base_plan_id,latest_order_id,google_play_raw)
     VALUES (?,'expired','hyeni_premium_monthly',?,?,?,?, '{}',?,?,
             'toss_web','web-month','trial:newer-session','{}')`,
  ).run(
    FAMILY_ID,
    `toss:${FAMILY_ID}`,
    "2026-02-01 00:00:00+00",
    "HYENI-I-paid-history",
    "2026-02-01 00:00:00+00",
    "2026-01-01 00:00:00+00",
    "2026-02-01 00:00:00+00",
  );

  const catalog = await jsonRequest(routes, bindings, `/web/catalog?familyId=${FAMILY_ID}`);
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.body.trialEligible, false);
  db.close();
});

test("웹 결제 mutation은 Content-Length를 믿지 않고 16KiB 본문 상한과 잘못된 JSON을 각각 413·400으로 닫는다", async () => {
  const db = createDb();
  const routes = createWebBillingRoutes();
  const bindings = env(db);
  const oversized = await routes.request("https://local.test/web/checkout-session", {
    method: "POST",
    headers: {
      Authorization: await auth(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      familyId: FAMILY_ID,
      plan: "month",
      trialExpected: true,
      padding: "x".repeat(17 * 1024),
    }),
  }, bindings);
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: "request_too_large" });

  const malformed = await routes.request("https://local.test/web/cancel", {
    method: "POST",
    headers: {
      Authorization: await auth(),
      "Content-Type": "application/json",
    },
    body: "{",
  }, bindings);
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_request" });
  db.close();
});

test("새 가족은 빌링키만 등록하고 0원으로 정확히 7일 PWA 체험을 한 번 시작한다", async () => {
  const db = createDb();
  const requests = [];
  const routes = createWebBillingRoutes({ fetchImpl: successProvider(requests) });
  const bindings = env(db);
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "month", trialExpected: true },
  });
  assert.equal(checkout.response.status, 200);
  assert.equal(checkout.body.trialEligible, true);
  assert.equal(checkout.body.trialDays, 7);

  const before = Date.now();
  const completed = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "auth-key-trial",
    },
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.status, "trial");
  assert.equal(completed.body.trialDays, 7);
  const trialEndMs = Date.parse(completed.body.trialEndsAt);
  assert.ok(trialEndMs >= before + 7 * 24 * 60 * 60_000);
  assert.ok(trialEndMs <= Date.now() + 7 * 24 * 60 * 60_000 + 1_000);
  assert.equal(completed.body.nextChargeAt, completed.body.trialEndsAt);
  assert.equal(
    requests.filter((request) => request.url.includes("/v1/billing/") && request.method !== "DELETE").length,
    1,
    "빌링키 발급 외에 실제 승인 요청이 있으면 안 됩니다",
  );
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_charge_attempts").count, 0);
  assert.deepEqual({ ...db.row(
    "SELECT status,trial_ends_at,next_charge_at,current_period_end FROM web_billing_customers WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    status: "trial",
    trial_ends_at: db.row("SELECT trial_ends_at FROM family_subscription WHERE family_id=?", FAMILY_ID).trial_ends_at,
    next_charge_at: db.row("SELECT trial_ends_at FROM family_subscription WHERE family_id=?", FAMILY_ID).trial_ends_at,
    current_period_end: null,
  });
  assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "trial");
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_trial_claims WHERE family_id=?", FAMILY_ID).count, 1);

  const duplicate = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "",
    },
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.status, "trial");
  assert.equal(requests.length, 1, "응답 유실 재조회가 빌링키 발급이나 청구를 반복하면 안 됩니다");
  db.close();
});

test("빌링키 등록 후 체험 응답이 유실돼도 hourly 대사가 청구 없이 최초 7일 종료 시각을 복구한다", async () => {
  const db = createDb();
  const requests = [];
  const provider = successProvider(requests);
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "month", trialExpected: true },
  });
  let interrupted = false;
  db.beforeRun = async (sql) => {
    if (!interrupted && sql.includes("INSERT OR IGNORE INTO web_billing_trial_claims")) {
      interrupted = true;
      throw new Error("response_lost_after_billing_key_registration");
    }
  };
  const incomplete = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "auth-key-lost-trial-response",
    },
  });
  assert.equal(incomplete.response.status, 503);
  db.beforeRun = null;
  const storedEnd = db.row(
    "SELECT trial_ends_at FROM web_billing_customers WHERE family_id=?",
    FAMILY_ID,
  ).trial_ends_at;
  const reconciled = await processWebBillingRenewals(bindings, {
    now: new Date(Date.now() + 3 * 60_000),
    fetchImpl: provider,
    mode: "initial",
  });
  assert.equal(reconciled.trialChecked, 1);
  assert.equal(reconciled.trialActivated, 1);
  assert.equal(db.row(
    "SELECT trial_ends_at FROM family_subscription WHERE family_id=?",
    FAMILY_ID,
  ).trial_ends_at, storedEnd);
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_charge_attempts").count, 0);
  assert.equal(requests.length, 1, "대사는 빌링키 발급이나 청구를 반복하면 안 됩니다");
  db.close();
});

test("빌링키 저장 뒤 checkout TTL이 지나도 같은 complete가 키 재발급·청구 없이 체험을 복구한다", async () => {
  const db = createDb();
  const requests = [];
  const provider = successProvider(requests);
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "month", trialExpected: true },
  });
  let interrupted = false;
  db.beforeRun = async (sql) => {
    if (!interrupted && sql.includes("INSERT OR IGNORE INTO web_billing_trial_claims")) {
      interrupted = true;
      throw new Error("trial_finalize_unavailable_after_key_persisted");
    }
  };
  const incomplete = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "auth-key-before-expiry",
    },
  });
  assert.equal(incomplete.response.status, 503);
  db.beforeRun = null;
  const storedTrialEnd = db.row(
    "SELECT trial_ends_at FROM web_billing_customers WHERE family_id=?",
    FAMILY_ID,
  ).trial_ends_at;
  db.sqlite.prepare(
    `UPDATE web_billing_checkout_sessions
        SET status='pending',expires_at='2000-01-01 00:00:00+00',claim_token=NULL,claim_expires_at=NULL
      WHERE id=?`,
  ).run(checkout.body.sessionId);

  const recovered = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "",
    },
  });
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.body.status, "trial");
  assert.equal(Date.parse(recovered.body.trialEndsAt), Date.parse(storedTrialEnd));
  assert.equal(requests.length, 1, "TTL 뒤 복구가 빌링키 발급 또는 결제 승인을 반복하면 안 됩니다");
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_charge_attempts").count, 0);
  assert.deepEqual({ ...db.row(
    "SELECT provider,state,reservation_ref FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    provider: "toss_web",
    state: "active",
    reservation_ref: `trial:${checkout.body.sessionId}`,
  });
  db.close();
});

test("expired로 남은 persisted-key 체험은 새 checkout에 고아화되지 않고 hourly가 원래 세션을 복구한다", async () => {
  const db = createDb();
  const requests = [];
  const provider = successProvider(requests);
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "year", trialExpected: true },
  });
  let interrupted = false;
  db.beforeRun = async (sql) => {
    if (!interrupted && sql.includes("INSERT OR IGNORE INTO web_billing_trial_claims")) {
      interrupted = true;
      throw new Error("trial_finalize_unavailable_after_key_persisted");
    }
  };
  const incomplete = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "auth-key-before-expiry",
    },
  });
  assert.equal(incomplete.response.status, 503);
  db.beforeRun = null;
  db.sqlite.prepare(
    `UPDATE web_billing_checkout_sessions
        SET status='expired',expires_at='2000-01-01 00:00:00+00',claim_token=NULL,claim_expires_at=NULL
      WHERE id=?`,
  ).run(checkout.body.sessionId);

  const newCheckout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "year", trialExpected: true },
  });
  assert.equal(newCheckout.response.status, 409);
  assert.equal(newCheckout.body.error, "web_billing_reconciliation_pending");
  assert.notEqual(
    db.row("SELECT id FROM web_billing_checkout_sessions WHERE id=?", checkout.body.sessionId),
    null,
  );

  const reconciled = await processWebBillingRenewals(bindings, {
    now: new Date(),
    fetchImpl: provider,
    limit: 1,
    mode: "initial",
  });
  assert.equal(reconciled.trialChecked, 1);
  assert.equal(reconciled.trialActivated, 1);
  assert.equal(requests.length, 1, "expired 체험 복구가 빌링키 발급 또는 승인 청구를 반복하면 안 됩니다");
  assert.equal(db.row(
    "SELECT status FROM web_billing_checkout_sessions WHERE id=?",
    checkout.body.sessionId,
  ).status, "completed");
  db.close();
});

test("checkout 뒤 검증된 Google 구독 이력이 생기면 최종 체험 claim은 빌링키 발급 전에 닫힌다", async () => {
  const db = createDb();
  const requests = [];
  const routes = createWebBillingRoutes({ fetchImpl: successProvider(requests) });
  const bindings = env(db);
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "month", trialExpected: true },
  });
  const paidAt = new Date().toISOString();
  db.sqlite.prepare(
    `INSERT INTO google_play_purchase_events
       (purchase_token_hash,family_id,parent_id,product_type,product_id,base_plan_id,
        order_id,status,verification_result,granted_at,created_at,updated_at)
     VALUES (?,?,?,'subscription','hyeni_premium','monthly-4900',?,'expired','{}',?,?,?)`,
  ).run("race-google-hash", FAMILY_ID, PARENT_ID, "GPA.race", paidAt, paidAt, paidAt);

  const completed = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "must-not-be-sent",
    },
  });
  assert.equal(completed.response.status, 409);
  assert.equal(completed.body.error, "web_billing_trial_state_changed");
  assert.equal(requests.length, 0, "평생 체험 재검사 실패 뒤에는 빌링키도 발급하면 안 됩니다");
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_customers").count, 0);
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_trial_claims").count, 0);
  db.close();
});

test("최종 trial claim과 동시에 과거 유료 이력이 생겨도 원자 guard가 권리를 닫고 저장된 키를 폐기한다", async () => {
  const db = createDb();
  const requests = [];
  const routes = createWebBillingRoutes({ fetchImpl: successProvider(requests) });
  const bindings = env(db);
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "month", trialExpected: true },
  });
  let injected = false;
  db.beforeRun = async (sql) => {
    if (injected || !sql.includes("INSERT OR IGNORE INTO web_billing_trial_claims")) return;
    injected = true;
    const paidAt = new Date().toISOString();
    db.sqlite.prepare(
      `INSERT INTO google_play_purchase_events
         (purchase_token_hash,family_id,parent_id,product_type,product_id,base_plan_id,
          order_id,status,verification_result,granted_at,created_at,updated_at)
       VALUES (?,?,?,'subscription','hyeni_premium','monthly-4900',?,'expired','{}',?,?,?)`,
    ).run("atomic-google-hash", FAMILY_ID, PARENT_ID, "GPA.atomic", paidAt, paidAt, paidAt);
  };

  const completed = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "auth-key-atomic-race",
    },
  });
  db.beforeRun = null;
  assert.equal(completed.response.status, 409);
  assert.equal(completed.body.error, "web_billing_trial_state_changed");
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_trial_claims").count, 0);
  assert.deepEqual({ ...db.row(
    `SELECT status,billing_key_ciphertext,billing_key_revocation_status
       FROM web_billing_customers WHERE family_id=?`,
    FAMILY_ID,
  ) }, {
    status: "expired",
    billing_key_ciphertext: null,
    billing_key_revocation_status: "revoked",
  });
  assert.equal(db.row(
    "SELECT status FROM web_billing_checkout_sessions WHERE id=?",
    checkout.body.sessionId,
  ).status, "failed");
  assert.equal(
    requests.filter((request) => request.url.endsWith("/v1/billing/authorizations/issue")).length,
    1,
  );
  assert.equal(requests.filter((request) => request.method === "DELETE").length, 1);
  assert.equal(
    requests.filter((request) => request.url.includes("/v1/billing/")
      && request.method !== "DELETE"
      && !request.url.endsWith("/v1/billing/authorizations/issue")).length,
    0,
    "원자 claim 거부 뒤 0원 체험 경로가 실제 결제를 시도하면 안 됩니다",
  );
  db.close();
});

test("체험 가능 카탈로그가 뒤늦게 변하면 유료 승인으로 자동 강등하지 않는다", async () => {
  const db = createDb();
  const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
  const bindings = env(db);
  db.sqlite.prepare(
    `INSERT INTO web_billing_trial_claims
       (family_id,parent_id,checkout_session_id,plan,status,claimed_at,trial_ends_at,updated_at)
     VALUES (?,?,?,'month','expired',?,?,?)`,
  ).run(
    FAMILY_ID,
    PARENT_ID,
    "old-session",
    "2026-01-01 00:00:00+00",
    "2026-01-08 00:00:00+00",
    "2026-01-08 00:00:00+00",
  );
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "month", trialExpected: true },
  });
  assert.equal(checkout.response.status, 409);
  assert.equal(checkout.body.error, "web_billing_trial_state_changed");
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_checkout_sessions").count, 0);
  db.close();
});

test("체험 checkout 뒤 Google Play가 활성화되면 Toss 빌링키 발급 없이 충돌을 닫는다", async () => {
  const db = createDb();
  const requests = [];
  const routes = createWebBillingRoutes({ fetchImpl: successProvider(requests) });
  const bindings = env(db);
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "month", trialExpected: true },
  });
  assert.equal(checkout.response.status, 200);

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString();
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,current_period_end,raw_event,
        created_at,updated_at,provider,base_plan_id,purchase_token_hash,google_play_raw)
     VALUES (?,'active','hyeni_premium',?,?, '{}',?,?,'google_play','monthly-4900',
             'google-play-race-hash','{}')`,
  ).run(FAMILY_ID, FAMILY_ID, periodEnd, now.toISOString(), now.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'google_play','active','google-play-race-hash',?,?)`,
  ).run(FAMILY_ID, now.toISOString(), now.toISOString());

  const completed = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "auth-key-google-race",
    },
  });
  assert.equal(completed.response.status, 409);
  assert.equal(completed.body.error, "subscription_already_active");
  assert.equal(requests.length, 0, "Google Play 활성화 뒤에는 Toss 빌링키도 발급하면 안 됩니다");
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_trial_claims").count, 0);
  assert.deepEqual({ ...db.row(
    "SELECT provider,status,purchase_token_hash FROM family_subscription WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    provider: "google_play",
    status: "active",
    purchase_token_hash: "google-play-race-hash",
  });
  db.close();
});

test("7일 체험 종료 시각의 첫 청구는 trial_conversion 결정적 주문으로 정확한 선택 주기를 연다", async () => {
  const db = createDb();
  const requests = [];
  const provider = successProvider(requests);
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "month", trialExpected: true },
  });
  const completed = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "auth-key-conversion",
    },
  });
  const trialEndsAt = completed.body.trialEndsAt;
  const conversion = await processWebBillingRenewals(bindings, {
    now: new Date(trialEndsAt),
    fetchImpl: provider,
    mode: "renewal",
  });
  assert.equal(conversion.checked, 1);
  assert.equal(conversion.renewed, 1);
  const attempt = db.row(
    "SELECT order_id,kind,amount,period_start,period_end,status FROM web_billing_charge_attempts",
  );
  assert.equal(attempt.kind, "trial_conversion");
  assert.equal(attempt.amount, 4_900);
  assert.match(attempt.order_id, /^HYENI-T-[a-f0-9]{40}$/);
  assert.equal(attempt.status, "done");
  assert.equal(Date.parse(attempt.period_start), Date.parse(trialEndsAt));
  assert.equal(db.row(
    "SELECT status FROM web_billing_trial_claims WHERE family_id=?",
    FAMILY_ID,
  ).status, "converted");
  assert.equal(db.row(
    "SELECT status FROM family_subscription WHERE family_id=?",
    FAMILY_ID,
  ).status, "active");
  const conversionTruth = db.row(
    `SELECT c.last_paid_order_id,fs.latest_order_id,bpr.reservation_ref
       FROM web_billing_customers c
       JOIN family_subscription fs ON fs.family_id=c.family_id
       JOIN billing_provider_reservations bpr ON bpr.family_id=c.family_id
      WHERE c.family_id=?`,
    FAMILY_ID,
  );
  assert.deepEqual({ ...conversionTruth }, {
    last_paid_order_id: attempt.order_id,
    latest_order_id: attempt.order_id,
    reservation_ref: attempt.order_id,
  });
  assert.equal(
    requests.filter((request) => request.url.includes("/v1/billing/") && request.method !== "DELETE").length,
    2,
    "빌링키 발급 1회와 체험 전환 청구 1회만 허용합니다",
  );
  db.close();
});

test("체험 중 해지하면 체험 종료까지 권리를 유지하고 첫 청구는 0회로 닫는다", async () => {
  const db = createDb();
  const requests = [];
  const routes = createWebBillingRoutes({ fetchImpl: successProvider(requests) });
  const bindings = env(db);
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    body: { familyId: FAMILY_ID, plan: "year", trialExpected: true },
  });
  const completed = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "auth-key-cancel-trial",
    },
  });
  const cancelled = await jsonRequest(routes, bindings, "/web/cancel", {
    method: "POST",
    body: { familyId: FAMILY_ID },
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.currentPeriodEnd, completed.body.trialEndsAt);
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_charge_attempts").count, 0);
  assert.equal(db.row("SELECT status FROM web_billing_trial_claims WHERE family_id=?", FAMILY_ID).status, "cancelled");
  assert.deepEqual({ ...db.row(
    "SELECT status,current_period_end,next_charge_at,billing_key_ciphertext FROM web_billing_customers WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    status: "cancel_at_period_end",
    current_period_end: db.row("SELECT current_period_end FROM family_subscription WHERE family_id=?", FAMILY_ID).current_period_end,
    next_charge_at: null,
    billing_key_ciphertext: null,
  });
  assert.equal(requests.filter((request) => request.method === "DELETE").length, 1);
  db.close();
});

test("계정 삭제는 Toss 빌링키 폐기가 성공하거나 404인 뒤에만 로컬 구독을 닫는다", async () => {
  const db = createDb();
  const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings, "month");
  await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.sessionId,
      customerKey: checkout.customerKey,
      authKey: "account-delete-auth-key",
    },
  });
  const paidAttempt = db.row(
    "SELECT order_id,amount FROM web_billing_charge_attempts WHERE family_id=? AND status='done' LIMIT 1",
    FAMILY_ID,
  );
  const accountDeleteProvider = (deleteStatus) => async (url, init = {}) => {
    if (String(url).includes("/v1/payments/orders/")) {
      return Response.json(payment(paidAttempt.order_id, checkout.customerKey, paidAttempt.amount));
    }
    if (init.method === "DELETE") {
      return deleteStatus === 404
        ? Response.json({ code: "NOT_FOUND" }, { status: 404 })
        : Response.json({ code: "PROVIDER_UNAVAILABLE" }, { status: 500 });
    }
    throw new Error("unexpected_provider_request");
  };

  await assert.rejects(revokeWebBillingBeforeAccountDeletion(bindings, {
    ownerUserId: PARENT_ID,
    familyIds: [FAMILY_ID],
    fetchImpl: accountDeleteProvider(500),
  }));
  assert.notEqual(db.row(
    "SELECT billing_key_ciphertext FROM web_billing_customers WHERE family_id=?",
    FAMILY_ID,
  ).billing_key_ciphertext, null);
  assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "active");

  await revokeWebBillingBeforeAccountDeletion(bindings, {
    ownerUserId: PARENT_ID,
    familyIds: [FAMILY_ID],
    fetchImpl: accountDeleteProvider(404),
  });
  assert.deepEqual({ ...db.row(
    "SELECT status,billing_key_ciphertext,next_charge_at FROM web_billing_customers WHERE family_id=?",
    FAMILY_ID,
  ) }, { status: "expired", billing_key_ciphertext: null, next_charge_at: null });
  assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "expired");

  const accountSource = readFileSync(new URL("../routes/account.ts", import.meta.url), "utf8");
  assert.ok(
    accountSource.indexOf("const claimResult = await beginAccountDeletionClaim")
      < accountSource.indexOf("await revokeWebBillingBeforeAccountDeletion(c.env"),
  );
  assert.ok(
    accountSource.indexOf("await revokeWebBillingBeforeAccountDeletion(c.env")
      < accountSource.indexOf("deleteAccountPhotoObjects(c.env.PHOTOS"),
  );
  db.close();
});

test("checkout→최초 결제는 정확한 응답만 활성화하고 같은 complete 재시도는 외부 결제를 반복하지 않는다", async () => {
  const db = createDb();
  const requests = [];
  const routes = createWebBillingRoutes({ fetchImpl: successProvider(requests) });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings, "month");
  assert.equal(checkout.amount, 4_900);
  assert.equal(checkout.displayPrice, "월 4,900원");
  assert.equal(checkout.clientKey, "test_ck_1234567890");
  assert.ok(Date.parse(checkout.expiresAt) > Date.now());

  const completeInput = {
    familyId: FAMILY_ID,
    sessionId: checkout.sessionId,
    customerKey: checkout.customerKey,
    authKey: "auth-key-with.printable_ASCII",
  };
  const completed = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: completeInput,
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.status, "active");
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.authorization.startsWith("Basic ")));

  const subscription = db.row(
    "SELECT status,provider,base_plan_id,current_period_end,purchase_token_hash FROM family_subscription WHERE family_id=?",
    FAMILY_ID,
  );
  assert.equal(subscription.status, "active");
  assert.equal(subscription.provider, "toss_web");
  assert.equal(subscription.base_plan_id, "web-month");
  assert.equal(subscription.purchase_token_hash, null);
  const paidOrderId = db.row(
    "SELECT order_id FROM web_billing_charge_attempts WHERE kind='initial' AND status='done'",
  ).order_id;
  assert.deepEqual({ ...db.row(
    `SELECT c.last_paid_order_id,fs.latest_order_id,bpr.reservation_ref
       FROM web_billing_customers c
       JOIN family_subscription fs ON fs.family_id=c.family_id
       JOIN billing_provider_reservations bpr ON bpr.family_id=c.family_id
      WHERE c.family_id=?`,
    FAMILY_ID,
  ) }, {
    last_paid_order_id: paidOrderId,
    latest_order_id: paidOrderId,
    reservation_ref: paidOrderId,
  });
  const entitlementResponse = await entitlementRoutes.request(
    `https://local.test/?family_id=${FAMILY_ID}`,
    { headers: { Authorization: await auth() } },
    bindings,
  );
  assert.equal(entitlementResponse.status, 200);
  const entitlementBody = await entitlementResponse.json();
  assert.equal(entitlementBody.subscription.provider, "toss_web");
  const activationEvent = db.row(
    "SELECT event,provider,plan FROM premium_funnel_events WHERE event='entitlement_activated'",
  );
  assert.deepEqual({ ...activationEvent }, {
    event: "entitlement_activated",
    provider: "toss_payments",
    plan: "month",
  });
  const customer = db.row(
    "SELECT billing_key_ciphertext,billing_key_iv,billing_key_version FROM web_billing_customers WHERE family_id=?",
    FAMILY_ID,
  );
  assert.notEqual(customer.billing_key_ciphertext, "billing-key-123");
  assert.equal(customer.billing_key_version, "v1");
  const dump = JSON.stringify(db.sqlite.prepare(
    "SELECT * FROM web_billing_checkout_sessions JOIN web_billing_customers USING(family_id) JOIN web_billing_charge_attempts USING(family_id)",
  ).all());
  assert.equal(dump.includes(completeInput.authKey), false);
  assert.equal(dump.includes("billing-key-123"), false);

  const duplicate = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: completeInput,
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(requests.length, 2);
  db.close();
});

test("같은 요금제 checkout은 재사용하고 만료된 미청구 session을 정리해 UUID 행을 제한한다", async () => {
  const db = createDb();
  const routes = createWebBillingRoutes();
  const bindings = env(db);

  const firstMonth = await createCheckout(routes, bindings, "month");
  const sameMonth = await createCheckout(routes, bindings, "month");
  assert.equal(sameMonth.sessionId, firstMonth.sessionId);
  assert.equal(sameMonth.customerKey, firstMonth.customerKey);
  assert.equal(
    db.row("SELECT COUNT(*) AS count FROM web_billing_checkout_sessions").count,
    1,
  );

  const year = await createCheckout(routes, bindings, "year");
  assert.notEqual(year.sessionId, firstMonth.sessionId);
  assert.equal(
    db.row("SELECT COUNT(*) AS count FROM web_billing_checkout_sessions").count,
    2,
  );

  db.sqlite.prepare(
    `UPDATE web_billing_checkout_sessions
        SET status='expired', expires_at='2026-01-01 00:00:00+00'
      WHERE id=?`,
  ).run(firstMonth.sessionId);
  const replacementMonth = await createCheckout(routes, bindings, "month");
  assert.notEqual(replacementMonth.sessionId, firstMonth.sessionId);
  assert.equal(
    db.row("SELECT 1 AS ok FROM web_billing_checkout_sessions WHERE id=?", firstMonth.sessionId),
    null,
    "외부 청구 시도가 없는 만료 session은 다음 checkout에서 제거해야 합니다",
  );
  assert.equal(
    db.row("SELECT COUNT(*) AS count FROM web_billing_checkout_sessions").count,
    2,
    "월·연 각각 하나의 살아 있는 session만 남아야 합니다",
  );
  db.close();
});

test("서로 다른 checkout 동시 완료는 한 빌링키만 선점해 최초 결제를 한 번만 청구한다", async () => {
  const db = createDb();
  let issueCount = 0;
  let chargeCount = 0;
  let orphanDeleteCount = 0;
  let releaseIssue;
  const issueGate = new Promise((resolve) => { releaseIssue = resolve; });
  let markFirstIssued;
  const firstIssued = new Promise((resolve) => { markFirstIssued = resolve; });
  const provider = async (url, init = {}) => {
    const parsedUrl = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (parsedUrl.endsWith("/v1/billing/authorizations/issue")) {
      issueCount += 1;
      markFirstIssued();
      await issueGate;
      return Response.json({
        customerKey: body.customerKey,
        billingKey: `billing-key-${body.customerKey}`,
      });
    }
    if (init.method === "DELETE" && parsedUrl.includes("/v1/billing/")) {
      orphanDeleteCount += 1;
      return new Response(null, { status: 200 });
    }
    if (parsedUrl.includes("/v1/billing/")) {
      chargeCount += 1;
      return Response.json(payment(body.orderId, body.customerKey, body.amount));
    }
    throw new Error("unexpected_provider_request");
  };
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const firstCheckout = await createCheckout(routes, bindings, "month");
  const secondCheckout = await createCheckout(routes, bindings, "year");
  const firstPromise = jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: firstCheckout.sessionId,
      customerKey: firstCheckout.customerKey,
      authKey: "auth-key-first",
    },
  });
  const secondPromise = jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: secondCheckout.sessionId,
      customerKey: secondCheckout.customerKey,
      authKey: "auth-key-second",
    },
  });
  await firstIssued;
  releaseIssue();
  const results = await Promise.all([firstPromise, secondPromise]);

  assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 409]);
  assert.equal(issueCount, 1, "가족 공급자 선점 뒤에는 두 번째 빌링키도 발급하면 안 됩니다");
  assert.equal(chargeCount, 1);
  assert.equal(orphanDeleteCount, 0);
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_charge_attempts").count, 1);
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_checkout_sessions WHERE status='completed'").count, 1);
  assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "active");
  db.close();
});

test("최초 청구 확정 실패는 로컬 키를 닫은 뒤 Toss 빌링키도 폐기한다", async () => {
  const db = createDb();
  let deleteCount = 0;
  const provider = async (url, init = {}) => {
    const parsedUrl = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (parsedUrl.endsWith("/v1/billing/authorizations/issue")) {
      return Response.json({ customerKey: body.customerKey, billingKey: "billing-key-declined" });
    }
    if (parsedUrl.includes("/v1/payments/orders/")) {
      return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    }
    if (init.method === "DELETE" && parsedUrl.includes("/v1/billing/")) {
      deleteCount += 1;
      return new Response(null, { status: 200 });
    }
    if (parsedUrl.includes("/v1/billing/")) {
      return Response.json({ code: "REJECT_CARD_COMPANY" }, { status: 400 });
    }
    throw new Error("unexpected_provider_request");
  };
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings);
  const failed = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.sessionId,
      customerKey: checkout.customerKey,
      authKey: "auth-key",
    },
  });
  assert.equal(failed.response.status, 402);
  assert.equal(failed.body.error, "web_billing_charge_failed");
  assert.equal(deleteCount, 1);
  assert.deepEqual({ ...db.row(
    "SELECT status,billing_key_ciphertext,next_charge_at FROM web_billing_customers WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    status: "expired",
    billing_key_ciphertext: null,
    next_charge_at: null,
  });
  assert.equal(db.row(
    "SELECT status FROM web_billing_checkout_sessions WHERE id=?",
    checkout.sessionId,
  ).status, "failed");
  db.close();
});

test("complete는 신규 승인에 authKey를 요구하고 저장된 빌링키 reconcile만 빈 authKey를 허용한다", async () => {
  const db = createDb();
  const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings);
  const base = {
    familyId: FAMILY_ID,
    sessionId: checkout.sessionId,
    customerKey: checkout.customerKey,
  };
  const missingBeforeAuthorization = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: { ...base, authKey: "" },
  });
  assert.equal(missingBeforeAuthorization.response.status, 409);
  assert.equal(missingBeforeAuthorization.body.error, "web_billing_authorization_required");
  const accepted = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: { ...base, authKey: "A".repeat(300) },
  });
  assert.equal(accepted.response.status, 200);

  for (const authKey of ["A".repeat(301), "auth key", "auth\nkey"]) {
    const rejected = await jsonRequest(routes, bindings, "/web/complete", {
      method: "POST",
      body: { ...base, authKey },
    });
    assert.equal(rejected.response.status, 400, `authKey=${JSON.stringify(authKey)}`);
  }
  for (const customerKey of ["A", "A".repeat(51), "customer$key", ` ${checkout.customerKey} `]) {
    const rejected = await jsonRequest(routes, bindings, "/web/complete", {
      method: "POST",
      body: { ...base, customerKey, authKey: "valid-auth-key" },
    });
    assert.equal(rejected.response.status, 400, `customerKey=${customerKey}`);
  }
  db.close();
});

test("결제 응답 유실은 order 조회 전까지 프리미엄을 열지 않고 같은 주문을 reconcile한다", async () => {
  const db = createDb();
  let paid = false;
  let chargeCount = 0;
  const provider = async (url, init = {}) => {
    const parsedUrl = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (parsedUrl.endsWith("/v1/billing/authorizations/issue")) {
      return Response.json({ customerKey: body.customerKey, billingKey: "billing-key-unknown" });
    }
    if (parsedUrl.includes("/v1/payments/orders/")) {
      if (!paid) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
      const attempt = db.row("SELECT order_id,amount FROM web_billing_charge_attempts LIMIT 1");
      const checkout = db.row("SELECT customer_key FROM web_billing_checkout_sessions LIMIT 1");
      return Response.json(payment(attempt.order_id, checkout.customer_key, attempt.amount));
    }
    if (parsedUrl.includes("/v1/billing/")) {
      chargeCount += 1;
      throw new Error("transport_timeout_after_send");
    }
    throw new Error("unexpected_provider_request");
  };
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings);
  const input = {
    familyId: FAMILY_ID,
    sessionId: checkout.sessionId,
    customerKey: checkout.customerKey,
    authKey: "auth-key",
  };
  const pending = await jsonRequest(routes, bindings, "/web/complete", { method: "POST", body: input });
  assert.equal(pending.response.status, 409);
  assert.equal(pending.body.error, "web_billing_reconciliation_pending");
  assert.equal(db.row("SELECT 1 AS ok FROM family_subscription WHERE family_id=?", FAMILY_ID), null);
  assert.equal(db.row("SELECT status FROM web_billing_charge_attempts").status, "unknown");

  paid = true;
  const reconciled = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: { ...input, authKey: "" },
  });
  assert.equal(reconciled.response.status, 200);
  assert.equal(reconciled.body.status, "active");
  assert.equal(chargeCount, 1, "unknown 재시도는 먼저 동일 order를 조회해야 합니다");
  db.close();
});

test("charge attempt가 다른 처리자에게 선점됐으면 checkout claim을 즉시 pending으로 해제한다", async () => {
  const db = createDb();
  const routes = createWebBillingRoutes({
    fetchImpl: async () => { throw new Error("provider_must_not_run"); },
  });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings);
  const encrypted = await encryptWebBillingSecret(
    ENCRYPTION_KEY,
    "billing-key-busy",
    FAMILY_ID,
    checkout.customerKey,
  );
  const now = new Date();
  const periodEnd = addWebBillingPeriod(now, "month");
  const orderId = await createWebBillingOrderId("initial", checkout.sessionId);
  db.sqlite.prepare(
    `INSERT INTO web_billing_customers
       (family_id,parent_id,customer_key,billing_key_ciphertext,billing_key_iv,
        billing_key_version,plan,status,failure_count,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'month','pending_charge',0,?,?)`,
  ).run(
    FAMILY_ID,
    PARENT_ID,
    checkout.customerKey,
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.version,
    now.toISOString(),
    now.toISOString(),
  );
  db.sqlite.prepare(
    `INSERT INTO web_billing_charge_attempts
       (order_id,family_id,checkout_session_id,plan,amount,kind,period_start,period_end,
        status,claim_token,claim_expires_at,created_at,updated_at)
     VALUES (?,?,?,'month',4900,'initial',?,?,'processing','other-claim',?,?,?)`,
  ).run(
    orderId,
    FAMILY_ID,
    checkout.sessionId,
    now.toISOString(),
    periodEnd.toISOString(),
    new Date(now.getTime() + 60_000).toISOString(),
    now.toISOString(),
    now.toISOString(),
  );
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'toss_web','reserved',?,?,?)`,
  ).run(FAMILY_ID, checkout.sessionId, now.toISOString(), now.toISOString());

  const response = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.sessionId,
      customerKey: checkout.customerKey,
      authKey: "",
    },
  });

  assert.equal(response.response.status, 409);
  assert.equal(response.body.error, "web_billing_processing");
  assert.deepEqual({ ...db.row(
    "SELECT status,claim_token,claim_expires_at,error_code FROM web_billing_checkout_sessions WHERE id=?",
    checkout.sessionId,
  ) }, {
    status: "pending",
    claim_token: null,
    claim_expires_at: null,
    error_code: "WEB_BILLING_ATTEMPT_BUSY",
  });
  db.close();
});

test("stale 최초 결제 finalize는 최신 Toss provider ref를 과거 order로 되돌리지 않는다", async () => {
  const db = createDb();
  const now = new Date("2026-08-01T00:00:00.000Z");
  const currentEnd = "2026-09-01 00:00:00.000+00";
  const staleEnd = new Date("2026-08-15T00:00:00.000Z");
  const currentOrderId = "web-current-order";
  const staleOrderId = "web-stale-order";
  const staleSessionId = "web-stale-session";
  const staleClaimToken = "web-stale-claim";
  const customerKey = "web-stale-customer";

  db.sqlite.prepare(
    `INSERT INTO web_billing_customers
       (family_id,parent_id,customer_key,plan,status,current_period_end,next_charge_at,
        failure_count,last_order_id,created_at,updated_at)
     VALUES (?,?,?,'month','active',?,?,0,?,?,?)`,
  ).run(
    FAMILY_ID,
    PARENT_ID,
    customerKey,
    currentEnd,
    currentEnd,
    currentOrderId,
    now.toISOString(),
    now.toISOString(),
  );
  db.sqlite.prepare(
    `INSERT INTO web_billing_checkout_sessions
       (id,family_id,parent_id,customer_key,plan,amount,status,expires_at,
        claim_token,claim_expires_at,created_at,updated_at)
     VALUES (?,?,?,?,'month',4900,'processing',?,?,?,?,?)`,
  ).run(
    staleSessionId,
    FAMILY_ID,
    PARENT_ID,
    customerKey,
    "2026-08-02T00:00:00.000Z",
    staleClaimToken,
    "2026-08-01T00:10:00.000Z",
    now.toISOString(),
    now.toISOString(),
  );
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        purchase_token_hash,latest_order_id,current_period_end,trial_ends_at,
        cancelled_at,acknowledged_at,google_play_raw,raw_event,last_event_id,
        last_event_at,created_at,updated_at)
     VALUES (?,'active','hyeni_premium',?,'toss_web','month',NULL,?,?,NULL,NULL,?,
             '{}','{}',?, ?,?,?)`,
  ).run(
    FAMILY_ID,
    FAMILY_ID,
    currentOrderId,
    currentEnd,
    now.toISOString(),
    currentOrderId,
    now.toISOString(),
    now.toISOString(),
    now.toISOString(),
  );
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'toss_web','active',?,?,?)`,
  ).run(FAMILY_ID, currentOrderId, now.toISOString(), now.toISOString());

  await assert.rejects(
    finalizeInitialWebBilling(env(db), {
      sessionId: staleSessionId,
      sessionClaimToken: staleClaimToken,
      familyId: FAMILY_ID,
      customerKey,
      plan: "month",
      orderId: staleOrderId,
      periodEnd: staleEnd,
      now,
    }),
    /web_billing_initial_finalize_guard_failed/,
  );
  assert.equal(db.row(
    "SELECT reservation_ref FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ).reservation_ref, currentOrderId);
  db.close();
});

test("Google 활성화 뒤 늦게 확인된 Toss 결제는 provider와 기간을 덮지 않고 환불 필요 충돌로 격리한다", async () => {
  const db = createDb();
  const now = new Date("2026-08-01T10:00:00.000Z");
  const googleEnd = "2026-09-15 00:00:00+00";
  const checkoutId = "web_legacy_pending_1234567890";
  const customerKey = "customer-legacy-pending";
  const encrypted = await encryptWebBillingSecret(
    ENCRYPTION_KEY,
    "billing-key-late-toss",
    FAMILY_ID,
    customerKey,
  );
  const orderId = await createWebBillingOrderId("initial", checkoutId);
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,current_period_end,raw_event,
        created_at,updated_at,provider,base_plan_id,purchase_token_hash,google_play_raw)
     VALUES (?,'active','hyeni_premium',?,?, '{}',?,?,'google_play','monthly-2900','safe-hash','{}')`,
  ).run(FAMILY_ID, FAMILY_ID, googleEnd, now.toISOString(), now.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'google_play','active','safe-hash',?,?)`,
  ).run(FAMILY_ID, now.toISOString(), now.toISOString());
  db.sqlite.prepare(
    `INSERT INTO web_billing_checkout_sessions
       (id,family_id,parent_id,customer_key,plan,amount,status,expires_at,created_at,updated_at)
     VALUES (?,?,?,?,'month',4900,'pending',?,?,?)`,
  ).run(checkoutId, FAMILY_ID, PARENT_ID, customerKey, new Date(now.getTime() + 60_000).toISOString(), now.toISOString(), now.toISOString());
  db.sqlite.prepare(
    `INSERT INTO web_billing_customers
       (family_id,parent_id,customer_key,billing_key_ciphertext,billing_key_iv,
        billing_key_version,plan,status,failure_count,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'month','pending_charge',0,?,?)`,
  ).run(FAMILY_ID, PARENT_ID, customerKey, encrypted.ciphertext, encrypted.iv, encrypted.version, now.toISOString(), now.toISOString());
  db.sqlite.prepare(
    `INSERT INTO web_billing_charge_attempts
       (order_id,family_id,checkout_session_id,plan,amount,kind,period_start,period_end,
        status,error_code,created_at,updated_at)
     VALUES (?,?,?,'month',4900,'initial',?,?,'unknown','TIMEOUT',?,?)`,
  ).run(orderId, FAMILY_ID, checkoutId, now.toISOString(), addWebBillingPeriod(now, "month").toISOString(), now.toISOString(), now.toISOString());

  let chargeCount = 0;
  let deleteCount = 0;
  const provider = async (url, init = {}) => {
    const parsedUrl = String(url);
    if (parsedUrl.includes("/v1/payments/orders/")) {
      return Response.json(payment(orderId, customerKey, 4_900));
    }
    if (init.method === "DELETE" && parsedUrl.includes("/v1/billing/")) {
      deleteCount += 1;
      return new Response(null, { status: 200 });
    }
    if (parsedUrl.includes("/v1/billing/")) chargeCount += 1;
    throw new Error("unexpected_provider_request");
  };
  const result = await processWebBillingRenewals(env(db), {
    now: new Date(now.getTime() + 60_000),
    fetchImpl: provider,
  });

  assert.equal(result.initialActivated, 0);
  assert.equal(result.initialFailed, 1);
  assert.equal(chargeCount, 0, "unknown 주문은 조회 결과가 있으면 다시 청구하면 안 됩니다");
  assert.equal(deleteCount, 1);
  assert.deepEqual({ ...db.row(
    "SELECT provider,status,current_period_end,purchase_token_hash FROM family_subscription WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    provider: "google_play",
    status: "active",
    current_period_end: googleEnd,
    purchase_token_hash: "safe-hash",
  });
  assert.deepEqual({ ...db.row(
    `SELECT provider,state,conflicting_provider,conflict_reason,resolution_status,
            conflict_ref FROM billing_provider_reservations WHERE family_id=?`,
    FAMILY_ID,
  ) }, {
    provider: "google_play",
    state: "conflict",
    conflicting_provider: "toss_web",
    conflict_reason: "toss_charge_after_google_activation",
    resolution_status: "refund_required",
    conflict_ref: orderId,
  });
  assert.equal(db.row("SELECT status FROM web_billing_customers WHERE family_id=?", FAMILY_ID).status, "expired");
  assert.equal(db.row("SELECT status FROM web_billing_checkout_sessions WHERE id=?", checkoutId).status, "failed");
  db.close();
});

test("결제 기간이 실제로 끝난 active 선점은 원자적으로 released 된 뒤 새 provider가 선점할 수 있다", async () => {
  const db = createDb();
  const expiredAt = "2026-07-31 00:00:00+00";
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,current_period_end,raw_event,
        created_at,updated_at,provider,base_plan_id,google_play_raw)
     VALUES (?,'cancelled','hyeni_premium_monthly',?,?, '{}',?,?,'toss_web','web-month','{}')`,
  ).run(FAMILY_ID, `toss:${FAMILY_ID}`, expiredAt, expiredAt, expiredAt);
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'toss_web','active','old-toss-order',?,?)`,
  ).run(FAMILY_ID, expiredAt, expiredAt);

  const claim = await claimBillingProvider(db, {
    familyId: FAMILY_ID,
    provider: "google_play",
    reservationRef: "safe-google-hash",
    now: new Date("2026-08-01T00:00:00.000Z"),
  });

  assert.equal(claim.status, "acquired");
  assert.deepEqual({ ...db.row(
    "SELECT provider,state,reservation_ref FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    provider: "google_play",
    state: "reserved",
    reservation_ref: "safe-google-hash",
  });
  db.close();
});

test("최초 결제 응답 유실 뒤 브라우저가 닫혀도 hourly 대사가 같은 주문만 확인해 권리를 활성화한다", async () => {
  const db = createDb();
  let paid = false;
  let chargeCount = 0;
  const provider = async (url, init = {}) => {
    const parsedUrl = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (parsedUrl.endsWith("/v1/billing/authorizations/issue")) {
      return Response.json({ customerKey: body.customerKey, billingKey: "billing-key-background-reconcile" });
    }
    if (parsedUrl.includes("/v1/payments/orders/")) {
      if (!paid) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
      const attempt = db.row("SELECT order_id,amount FROM web_billing_charge_attempts LIMIT 1");
      const checkout = db.row("SELECT customer_key FROM web_billing_checkout_sessions LIMIT 1");
      return Response.json(payment(attempt.order_id, checkout.customer_key, attempt.amount));
    }
    if (parsedUrl.includes("/v1/billing/")) {
      chargeCount += 1;
      throw new Error("transport_timeout_after_send");
    }
    throw new Error("unexpected_provider_request");
  };
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings);
  const pending = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.sessionId,
      customerKey: checkout.customerKey,
      authKey: "auth-key",
    },
  });
  assert.equal(pending.response.status, 409);
  assert.equal(pending.body.error, "web_billing_reconciliation_pending");
  assert.equal(chargeCount, 1);

  paid = true;
  db.resetQueryCount();
  const reconciliation = await processWebBillingRenewals(bindings, {
    now: new Date(Date.now() + 60_000),
    fetchImpl: provider,
    limit: 1,
    mode: "initial",
  });
  assert.equal(reconciliation.initialChecked, 1);
  assert.equal(reconciliation.initialActivated, 1);
  assert.equal(reconciliation.initialUnknown, 0);
  assert.equal(chargeCount, 1, "hourly 대사는 unknown 주문을 먼저 조회하고 다시 청구하면 안 됩니다");
  assert.ok(db.queryCount <= 45, `initial hourly D1 query가 ${db.queryCount}회입니다`);
  assert.equal(db.row(
    "SELECT status FROM web_billing_checkout_sessions WHERE id=?",
    checkout.sessionId,
  ).status, "completed");
  assert.equal(db.row(
    "SELECT status FROM web_billing_customers WHERE family_id=?",
    FAMILY_ID,
  ).status, "active");
  assert.equal(db.row(
    "SELECT status FROM family_subscription WHERE family_id=?",
    FAMILY_ID,
  ).status, "active");
  const recoveredAttempt = db.row(
    "SELECT order_id FROM web_billing_charge_attempts WHERE kind='initial' AND status='done'",
  );
  assert.deepEqual({ ...db.row(
    `SELECT c.last_paid_order_id,fs.latest_order_id,bpr.reservation_ref
       FROM web_billing_customers c
       JOIN family_subscription fs ON fs.family_id=c.family_id
       JOIN billing_provider_reservations bpr ON bpr.family_id=c.family_id
      WHERE c.family_id=?`,
    FAMILY_ID,
  ) }, {
    last_paid_order_id: recoveredAttempt.order_id,
    latest_order_id: recoveredAttempt.order_id,
    reservation_ref: recoveredAttempt.order_id,
  });
  assert.equal(db.row(
    "SELECT COUNT(*) AS count FROM premium_funnel_events WHERE event='entitlement_activated'",
  ).count, 1);
  db.close();
});

test("응답 유실 뒤 DUPLICATED_ORDER_ID와 조회 404가 겹쳐도 실패 확정이나 권리 개방을 하지 않는다", async () => {
  const db = createDb();
  let chargeCount = 0;
  const provider = async (url, init = {}) => {
    const parsedUrl = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (parsedUrl.endsWith("/v1/billing/authorizations/issue")) {
      return Response.json({ customerKey: body.customerKey, billingKey: "billing-key-duplicate" });
    }
    if (parsedUrl.includes("/v1/payments/orders/")) {
      return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    }
    if (parsedUrl.includes("/v1/billing/")) {
      chargeCount += 1;
      if (chargeCount === 1) throw new Error("transport_timeout_after_send");
      return Response.json({ code: "DUPLICATED_ORDER_ID" }, { status: 400 });
    }
    throw new Error("unexpected_provider_request");
  };
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings);
  const input = {
    familyId: FAMILY_ID,
    sessionId: checkout.sessionId,
    customerKey: checkout.customerKey,
    authKey: "auth-key",
  };
  const first = await jsonRequest(routes, bindings, "/web/complete", { method: "POST", body: input });
  assert.equal(first.response.status, 409);
  const second = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: { ...input, authKey: "" },
  });
  assert.equal(second.response.status, 409);
  assert.equal(second.body.error, "web_billing_reconciliation_pending");
  assert.equal(db.row("SELECT status FROM web_billing_charge_attempts").status, "unknown");
  assert.equal(db.row("SELECT 1 AS ok FROM family_subscription WHERE family_id=?", FAMILY_ID), null);
  assert.notEqual(
    db.row("SELECT billing_key_ciphertext FROM web_billing_customers WHERE family_id=?", FAMILY_ID).billing_key_ciphertext,
    null,
  );
  db.close();
});

test("한 가족의 미확정 주문은 먼저 만들어 둔 다른 checkout session의 새 결제를 차단한다", async () => {
  const db = createDb();
  let issueCount = 0;
  let chargeCount = 0;
  const provider = async (url, init = {}) => {
    const parsedUrl = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (parsedUrl.endsWith("/v1/billing/authorizations/issue")) {
      issueCount += 1;
      return Response.json({ customerKey: body.customerKey, billingKey: `billing-key-${issueCount}` });
    }
    if (parsedUrl.includes("/v1/payments/orders/")) {
      return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    }
    if (parsedUrl.includes("/v1/billing/")) {
      chargeCount += 1;
      if (chargeCount === 1) throw new Error("transport_timeout_after_send");
      return Response.json(payment(body.orderId, body.customerKey, body.amount));
    }
    throw new Error("unexpected_provider_request");
  };
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const firstCheckout = await createCheckout(routes, bindings, "month");
  const secondCheckout = await createCheckout(routes, bindings, "year");
  const first = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: firstCheckout.sessionId,
      customerKey: firstCheckout.customerKey,
      authKey: "auth-key-first",
    },
  });
  assert.equal(first.response.status, 409);
  const second = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: secondCheckout.sessionId,
      customerKey: secondCheckout.customerKey,
      authKey: "auth-key-second",
    },
  });
  assert.equal(second.response.status, 409);
  assert.equal(second.body.error, "web_billing_reconciliation_pending");
  assert.equal(issueCount, 1);
  assert.equal(chargeCount, 1);
  assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_charge_attempts").count, 1);
  assert.equal(db.row("SELECT 1 AS ok FROM family_subscription WHERE family_id=?", FAMILY_ID), null);
  db.close();
});

test("해지 예약은 기간말 권리를 유지하되 billingKey와 다음 청구를 즉시 제거하고 재호출도 멱등이다", async () => {
  const db = createDb();
  const requests = [];
  const routes = createWebBillingRoutes({ fetchImpl: successProvider(requests) });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings, "year");
  await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.sessionId,
      customerKey: checkout.customerKey,
      authKey: "auth-key",
    },
  });
  const cancelled = await jsonRequest(routes, bindings, "/web/cancel", {
    method: "POST",
    body: { familyId: FAMILY_ID },
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.status, "cancelled");
  assert.ok(Date.parse(cancelled.body.currentPeriodEnd) > Date.now());
  const customer = db.row(
    `SELECT status,billing_key_ciphertext,billing_key_iv,billing_key_version,next_charge_at
       FROM web_billing_customers WHERE family_id=?`,
    FAMILY_ID,
  );
  assert.deepEqual({ ...customer }, {
    status: "cancel_at_period_end",
    billing_key_ciphertext: null,
    billing_key_iv: null,
    billing_key_version: null,
    next_charge_at: null,
  });
  assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "cancelled");
  const duplicate = await jsonRequest(routes, bindings, "/web/cancel", {
    method: "POST",
    body: { familyId: FAMILY_ID },
  });
  assert.equal(duplicate.response.status, 200);
  const deletions = requests.filter((request) => request.method === "DELETE");
  assert.equal(deletions.length, 1, "Toss 빌링키 삭제는 최초 해지 전이에만 한 번 요청해야 합니다");
  assert.ok(deletions[0].authorization.startsWith("Basic "));
  db.close();
});

test("해지 시 Toss 키 폐기 500은 암호화 키를 재시도 상태로 보존하고 account delete와 hourly가 fail-closed로 복구한다", async () => {
  const db = createDb();
  let deletionSucceeds = false;
  let deletionCount = 0;
  const provider = async (url, init = {}) => {
    const parsedUrl = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (parsedUrl.endsWith("/v1/billing/authorizations/issue")) {
      return Response.json({ customerKey: body.customerKey, billingKey: "billing-key-revocation-retry" });
    }
    if (init.method === "DELETE" && parsedUrl.includes("/v1/billing/")) {
      deletionCount += 1;
      return deletionSucceeds
        ? new Response(null, { status: 200 })
        : Response.json({ code: "PROVIDER_UNAVAILABLE" }, { status: 500 });
    }
    if (parsedUrl.includes("/v1/payments/orders/")) {
      const orderId = decodeURIComponent(parsedUrl.split("/").at(-1));
      return Response.json(payment(orderId, checkout.customerKey, 4_900));
    }
    if (parsedUrl.includes("/v1/billing/")) {
      return Response.json(payment(body.orderId, body.customerKey, body.amount));
    }
    throw new Error("unexpected_provider_request");
  };
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings, "month");
  const activated = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.sessionId,
      customerKey: checkout.customerKey,
      authKey: "auth-key-revocation-retry",
    },
  });
  assert.equal(activated.response.status, 200);

  const cancelled = await jsonRequest(routes, bindings, "/web/cancel", {
    method: "POST",
    body: { familyId: FAMILY_ID },
  });
  assert.equal(cancelled.response.status, 200);
  assert.deepEqual({ ...db.row(
    `SELECT status,next_charge_at,billing_key_revocation_status,
            billing_key_revocation_attempts,billing_key_ciphertext
       FROM web_billing_customers WHERE family_id=?`,
    FAMILY_ID,
  ) }, {
    status: "cancel_at_period_end",
    next_charge_at: null,
    billing_key_revocation_status: "pending",
    billing_key_revocation_attempts: 1,
    billing_key_ciphertext: db.row(
      "SELECT billing_key_ciphertext AS value FROM web_billing_customers WHERE family_id=?",
      FAMILY_ID,
    ).value,
  });
  assert.notEqual(db.row(
    "SELECT billing_key_ciphertext AS value FROM web_billing_customers WHERE family_id=?",
    FAMILY_ID,
  ).value, null);

  await assert.rejects(revokeWebBillingBeforeAccountDeletion(bindings, {
    ownerUserId: PARENT_ID,
    familyIds: [FAMILY_ID],
    fetchImpl: provider,
  }));
  assert.notEqual(db.row(
    "SELECT billing_key_ciphertext AS value FROM web_billing_customers WHERE family_id=?",
    FAMILY_ID,
  ).value, null, "원격 폐기 실패 중 계정 삭제가 로컬 키를 없애면 안 됩니다");

  deletionSucceeds = true;
  db.sqlite.prepare(
    `UPDATE web_billing_customers
        SET billing_key_revocation_retry_at='2000-01-01 00:00:00+00'
      WHERE family_id=?`,
  ).run(FAMILY_ID);
  const retry = await processWebBillingRenewals(bindings, {
    now: new Date(),
    fetchImpl: provider,
    limit: 1,
    mode: "initial",
  });
  assert.equal(retry.revocationChecked, 1);
  assert.equal(retry.revocationCompleted, 1);
  assert.deepEqual({ ...db.row(
    `SELECT billing_key_ciphertext,billing_key_iv,billing_key_version,
            billing_key_revocation_status,billing_key_revocation_error
       FROM web_billing_customers WHERE family_id=?`,
    FAMILY_ID,
  ) }, {
    billing_key_ciphertext: null,
    billing_key_iv: null,
    billing_key_version: null,
    billing_key_revocation_status: "revoked",
    billing_key_revocation_error: null,
  });
  const duplicate = await jsonRequest(routes, bindings, "/web/cancel", {
    method: "POST",
    body: { familyId: FAMILY_ID },
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(deletionCount, 3, "실패 2회 뒤 hourly 성공 1회 외에 키 폐기를 반복하면 안 됩니다");
  db.close();
});

test("구매자도 주보호자도 아닌 공동 부모는 가족 웹 구독을 해지할 수 없다", async () => {
  const db = createDb();
  const requests = [];
  const routes = createWebBillingRoutes({ fetchImpl: successProvider(requests) });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings, "month");
  const completed = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.sessionId,
      customerKey: checkout.customerKey,
      authKey: "auth-key",
    },
  });
  assert.equal(completed.response.status, 200);

  const cancellation = await jsonRequest(routes, bindings, "/web/cancel", {
    method: "POST",
    authorization: await auth(CO_PARENT_ID),
    body: { familyId: FAMILY_ID },
  });
  assert.equal(cancellation.response.status, 403);
  assert.equal(cancellation.body.error, "web_billing_owner_required");
  assert.equal(
    db.row("SELECT status FROM web_billing_customers WHERE family_id=?", FAMILY_ID).status,
    "active",
  );
  assert.equal(
    db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status,
    "active",
  );
  assert.equal(
    requests.filter((request) => request.method === "DELETE").length,
    0,
  );
  db.close();
});

test("공동 부모가 직접 구매한 웹 구독은 구매자 본인이 해지할 수 있다", async () => {
  const db = createDb();
  const requests = [];
  const routes = createWebBillingRoutes({ fetchImpl: successProvider(requests) });
  const bindings = env(db);
  const authorization = await auth(CO_PARENT_ID);
  db.sqlite.prepare(
    `INSERT INTO web_billing_trial_claims
       (family_id,parent_id,checkout_session_id,plan,status,claimed_at,trial_ends_at,updated_at)
     VALUES (?,?,?,'month','expired',?,?,?)`,
  ).run(
    FAMILY_ID,
    PARENT_ID,
    "paid-fixture-co-parent",
    "2026-01-01 00:00:00+00",
    "2026-01-08 00:00:00+00",
    "2026-01-08 00:00:00+00",
  );
  const checkout = await jsonRequest(routes, bindings, "/web/checkout-session", {
    method: "POST",
    authorization,
    body: { familyId: FAMILY_ID, plan: "month", trialExpected: false },
  });
  assert.equal(checkout.response.status, 200);
  const completed = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    authorization,
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.body.sessionId,
      customerKey: checkout.body.customerKey,
      authKey: "auth-key",
    },
  });
  assert.equal(completed.response.status, 200);
  assert.equal(
    db.row("SELECT parent_id FROM web_billing_customers WHERE family_id=?", FAMILY_ID).parent_id,
    CO_PARENT_ID,
  );

  const cancellation = await jsonRequest(routes, bindings, "/web/cancel", {
    method: "POST",
    authorization,
    body: { familyId: FAMILY_ID },
  });
  assert.equal(cancellation.response.status, 200);
  assert.equal(cancellation.body.status, "cancelled");
  assert.equal(
    db.row("SELECT status FROM web_billing_customers WHERE family_id=?", FAMILY_ID).status,
    "cancel_at_period_end",
  );
  db.close();
});

test("갱신이 키를 읽은 뒤 attempt를 선점하기 전에 해지가 이기면 실제 청구와 권리 재활성화를 하지 않는다", async () => {
  const db = createDb();
  let chargeCount = 0;
  const provider = async (url, init = {}) => {
    const parsedUrl = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (parsedUrl.endsWith("/v1/billing/authorizations/issue")) {
      return Response.json({ customerKey: body.customerKey, billingKey: "billing-key-cancel-race" });
    }
    if (init.method === "DELETE" && parsedUrl.includes("/v1/billing/")) {
      return new Response(null, { status: 200 });
    }
    if (parsedUrl.includes("/v1/billing/")) {
      chargeCount += 1;
      return Response.json(payment(body.orderId, body.customerKey, body.amount));
    }
    throw new Error("unexpected_provider_request");
  };
  const routes = createWebBillingRoutes({ fetchImpl: provider });
  const bindings = env(db);
  const checkout = await createCheckout(routes, bindings, "month");
  const initial = await jsonRequest(routes, bindings, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.sessionId,
      customerKey: checkout.customerKey,
      authKey: "auth-key",
    },
  });
  assert.equal(initial.response.status, 200);
  chargeCount = 0;
  const raceNow = new Date();
  db.sqlite.prepare(
    "UPDATE web_billing_customers SET next_charge_at=? WHERE family_id=?",
  ).run(new Date(raceNow.getTime() - 60_000).toISOString(), FAMILY_ID);

  let releaseRenewalInsert;
  let markRenewalInsertReached;
  const insertGate = new Promise((resolve) => { releaseRenewalInsert = resolve; });
  const insertReached = new Promise((resolve) => { markRenewalInsertReached = resolve; });
  let intercepted = false;
  db.beforeRun = async (sql, values) => {
    if (
      !intercepted
      && sql.includes("INSERT OR IGNORE INTO web_billing_charge_attempts")
      && values[5] === "renewal"
    ) {
      intercepted = true;
      markRenewalInsertReached();
      await insertGate;
    }
  };

  const renewalPromise = processWebBillingRenewals(bindings, {
    now: raceNow,
    fetchImpl: provider,
  });
  await insertReached;
  const cancelled = await jsonRequest(routes, bindings, "/web/cancel", {
    method: "POST",
    body: { familyId: FAMILY_ID },
  });
  assert.equal(cancelled.response.status, 200);
  releaseRenewalInsert();
  const renewal = await renewalPromise;
  db.beforeRun = null;

  assert.equal(renewal.renewed, 0);
  assert.equal(chargeCount, 0, "해지가 먼저 선형화된 뒤에는 갱신 승인 API를 호출하면 안 됩니다");
  assert.equal(db.row(
    "SELECT COUNT(*) AS count FROM web_billing_charge_attempts WHERE kind='renewal'",
  ).count, 0);
  assert.equal(db.row("SELECT status FROM web_billing_customers WHERE family_id=?", FAMILY_ID).status, "cancel_at_period_end");
  assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "cancelled");
  db.close();
});

test("Toss 설정이 일시 누락돼도 해지는 다음 청구를 멈추고 암호화 키는 재시도 상태로 보존한다", async () => {
  const db = createDb();
  const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
  const configured = env(db);
  const checkout = await createCheckout(routes, configured, "month");
  await jsonRequest(routes, configured, "/web/complete", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      sessionId: checkout.sessionId,
      customerKey: checkout.customerKey,
      authKey: "auth-key",
    },
  });
  const unavailableProvider = env(db, {
    TOSS_PAYMENTS_CLIENT_KEY: undefined,
    TOSS_PAYMENTS_SECRET_KEY: undefined,
    WEB_BILLING_KEY_ENCRYPTION_SECRET: undefined,
  });
  const cancelled = await jsonRequest(routes, unavailableProvider, "/web/cancel", {
    method: "POST",
    body: { familyId: FAMILY_ID },
  });
  assert.equal(cancelled.response.status, 200);
  const customer = db.row(
    `SELECT status,billing_key_ciphertext,next_charge_at,billing_key_revocation_status,
            billing_key_revocation_error
       FROM web_billing_customers WHERE family_id=?`,
    FAMILY_ID,
  );
  assert.deepEqual({
    status: customer.status,
    next_charge_at: customer.next_charge_at,
    billing_key_revocation_status: customer.billing_key_revocation_status,
    billing_key_revocation_error: customer.billing_key_revocation_error,
  }, {
    status: "cancel_at_period_end",
    next_charge_at: null,
    billing_key_revocation_status: "pending",
    billing_key_revocation_error: "WEB_BILLING_CONFIG_UNAVAILABLE",
  });
  assert.notEqual(customer.billing_key_ciphertext, null);
  db.close();
});

test("LIMIT 1 renewal은 앞선 provider conflict를 후보 전에 제외해 뒤의 정상 Toss 가족을 기아시키지 않는다", async () => {
  const db = createDb();
  const bindings = env(db);
  const validFamilyId = "family-web-valid-renewal";
  const validParentId = "parent-web-valid-renewal";
  const blockedCustomerKey = "HYENI_blockedcustomer123456789";
  const validCustomerKey = "HYENI_validcustomer12345678901";
  db.sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(validParentId);
  db.sqlite.prepare("INSERT INTO families VALUES (?,?,?,?,?)").run(
    validFamilyId,
    validParentId,
    "premium",
    "premium",
    "2026-01-01 00:00:00+00",
  );
  db.sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1,?,NULL)").run(
    "member-valid-renewal",
    validFamilyId,
    validParentId,
    "parent",
    "2026-01-01 00:00:00+00",
  );
  const blockedEncrypted = await encryptWebBillingSecret(
    ENCRYPTION_KEY,
    "billing-key-blocked-renewal",
    FAMILY_ID,
    blockedCustomerKey,
  );
  const validEncrypted = await encryptWebBillingSecret(
    ENCRYPTION_KEY,
    "billing-key-valid-renewal",
    validFamilyId,
    validCustomerKey,
  );
  const insertCustomer = db.sqlite.prepare(
    `INSERT INTO web_billing_customers
       (family_id,parent_id,customer_key,billing_key_ciphertext,billing_key_iv,billing_key_version,
        plan,status,current_period_end,next_charge_at,failure_count,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'month','active',?,?,0,?,?)`,
  );
  insertCustomer.run(
    FAMILY_ID,
    PARENT_ID,
    blockedCustomerKey,
    blockedEncrypted.ciphertext,
    blockedEncrypted.iv,
    blockedEncrypted.version,
    "2026-07-30 00:00:00+00",
    "2026-07-30 00:00:00+00",
    "2026-01-01 00:00:00+00",
    "2026-01-01 00:00:00+00",
  );
  insertCustomer.run(
    validFamilyId,
    validParentId,
    validCustomerKey,
    validEncrypted.ciphertext,
    validEncrypted.iv,
    validEncrypted.version,
    "2026-07-31 00:00:00+00",
    "2026-07-31 00:00:00+00",
    "2026-01-01 00:00:01+00",
    "2026-01-01 00:00:01+00",
  );
  const insertSubscription = db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,current_period_end,raw_event,
        created_at,updated_at,provider,base_plan_id,google_play_raw)
     VALUES (?,'active','hyeni_premium_monthly',?,?, '{}',?,?,'toss_web','web-month','{}')`,
  );
  insertSubscription.run(
    FAMILY_ID,
    `toss:${FAMILY_ID}`,
    "2026-07-30 00:00:00+00",
    "2026-01-01 00:00:00+00",
    "2026-01-01 00:00:00+00",
  );
  insertSubscription.run(
    validFamilyId,
    `toss:${validFamilyId}`,
    "2026-07-31 00:00:00+00",
    "2026-01-01 00:00:01+00",
    "2026-01-01 00:00:01+00",
  );
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,conflicting_provider,conflict_ref,
        conflict_reason,resolution_status,created_at,updated_at)
     VALUES (?,'toss_web','conflict','blocked-toss','google_play','blocked-google',
             'google_purchase_after_toss_activation','manual_review',?,?)`,
  ).run(FAMILY_ID, "2026-01-01 00:00:00+00", "2026-01-01 00:00:00+00");
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'toss_web','active','valid-toss',?,?)`,
  ).run(validFamilyId, "2026-01-01 00:00:01+00", "2026-01-01 00:00:01+00");

  const chargedFamilies = [];
  const provider = async (url, init = {}) => {
    const parsedUrl = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (parsedUrl.includes("/v1/billing/")) {
      chargedFamilies.push(body.customerKey);
      return Response.json(payment(body.orderId, body.customerKey, body.amount));
    }
    throw new Error("unexpected_provider_request");
  };
  db.resetQueryCount();
  const result = await processWebBillingRenewals(bindings, {
    now: new Date("2026-08-01T00:00:00.000Z"),
    fetchImpl: provider,
    limit: 1,
    mode: "renewal",
  });
  assert.equal(result.checked, 1);
  assert.equal(result.renewed, 1);
  assert.deepEqual(chargedFamilies, [validCustomerKey]);
  assert.equal(
    db.row("SELECT current_period_end FROM web_billing_customers WHERE family_id=?", FAMILY_ID).current_period_end,
    "2026-07-30 00:00:00+00",
  );
  assert.ok(Date.parse(
    db.row("SELECT current_period_end FROM web_billing_customers WHERE family_id=?", validFamilyId).current_period_end,
  ) > Date.parse("2026-07-31T00:00:00.000Z"));
  assert.ok(db.queryCount <= 45, `provider prefilter renewal D1 query가 ${db.queryCount}회입니다`);
  db.close();
});

test("hourly renewal은 결정적 주문으로 갱신하고 1·6·24시간 3회 재시도 후 만료한다", async () => {
  const db = createDb();
  const bindings = env(db);
  const start = new Date("2026-08-01T00:00:00.000Z");
  const encrypted = await encryptWebBillingSecret(
    ENCRYPTION_KEY,
    "billing-key-renewal",
    FAMILY_ID,
    "HYENI_renewalcustomer1234567890",
  );
  db.sqlite.prepare(
    `INSERT INTO web_billing_customers
       (family_id,parent_id,customer_key,billing_key_ciphertext,billing_key_iv,billing_key_version,
        plan,status,current_period_end,next_charge_at,failure_count,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'month','active',?,?,0,?,?)`,
  ).run(
    FAMILY_ID,
    PARENT_ID,
    "HYENI_renewalcustomer1234567890",
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.version,
    "2026-08-01 00:00:00+00",
    "2026-08-01 00:00:00+00",
    "2026-07-01 00:00:00+00",
    "2026-07-01 00:00:00+00",
  );
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,current_period_end,raw_event,
        created_at,updated_at,provider,base_plan_id,google_play_raw)
     VALUES (?,'active','hyeni_premium_monthly',?,?, '{}',?,?, 'toss_web','web-month','{}')`,
  ).run(FAMILY_ID, `toss:${FAMILY_ID}`, "2026-08-01 00:00:00+00", "2026-07-01 00:00:00+00", "2026-07-01 00:00:00+00");
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'toss_web','active','renewal-fixture',?,?)`,
  ).run(FAMILY_ID, "2026-07-01 00:00:00+00", "2026-07-01 00:00:00+00");

  let renewalPaid = false;
  let renewalChargeCount = 0;
  const timeoutThenLookupProvider = async (url, init = {}) => {
    const parsedUrl = String(url);
    if (parsedUrl.includes("/v1/payments/orders/")) {
      if (!renewalPaid) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
      const attempt = db.row(
        "SELECT order_id,amount FROM web_billing_charge_attempts WHERE kind='renewal' LIMIT 1",
      );
      return Response.json(payment(
        attempt.order_id,
        "HYENI_renewalcustomer1234567890",
        attempt.amount,
      ));
    }
    if (parsedUrl.includes("/v1/billing/")) {
      renewalChargeCount += 1;
      throw new Error("transport_timeout_after_send");
    }
    throw new Error(`unexpected_provider_request:${init.method ?? "GET"}`);
  };
  db.resetQueryCount();
  const pendingRenewal = await processWebBillingRenewals(bindings, {
    now: start,
    fetchImpl: timeoutThenLookupProvider,
    limit: 1,
    mode: "renewal",
  });
  assert.equal(pendingRenewal.unknown, 1);
  assert.equal(pendingRenewal.renewed, 0);
  assert.ok(db.queryCount <= 45, `renewal hourly D1 query가 ${db.queryCount}회입니다`);
  const tooEarly = await processWebBillingRenewals(bindings, {
    now: new Date("2026-08-01T00:01:00.000Z"),
    fetchImpl: timeoutThenLookupProvider,
  });
  assert.equal(tooEarly.checked, 0);
  assert.equal(renewalChargeCount, 1, "retry_after 전에는 provider를 다시 호출하면 안 됩니다");
  renewalPaid = true;
  const success = await processWebBillingRenewals(bindings, {
    now: new Date("2026-08-01T00:15:01.000Z"),
    fetchImpl: timeoutThenLookupProvider,
  });
  assert.equal(success.renewed, 1);
  assert.equal(renewalChargeCount, 1, "unknown renewal은 같은 order 조회 후 중복 청구하지 않아야 합니다");
  const firstOrder = db.row("SELECT order_id,status FROM web_billing_charge_attempts WHERE kind='renewal'");
  assert.equal(firstOrder.status, "done");
  assert.equal(db.row("SELECT status FROM web_billing_customers WHERE family_id=?", FAMILY_ID).status, "active");
  assert.equal(
    db.row("SELECT current_period_end FROM web_billing_customers WHERE family_id=?", FAMILY_ID).current_period_end,
    "2026-09-01 00:00:00.000+00",
    "reconcile 지연이 결제 기간을 임의로 늘리면 안 됩니다",
  );
  assert.equal(db.row(
    "SELECT COUNT(*) AS count FROM premium_funnel_events WHERE event='renewal' AND provider='toss_payments'",
  ).count, 1);
  assert.deepEqual({ ...db.row(
    `SELECT c.last_paid_order_id,fs.latest_order_id,bpr.reservation_ref
       FROM web_billing_customers c
       JOIN family_subscription fs ON fs.family_id=c.family_id
       JOIN billing_provider_reservations bpr ON bpr.family_id=c.family_id
      WHERE c.family_id=?`,
    FAMILY_ID,
  ) }, {
    last_paid_order_id: firstOrder.order_id,
    latest_order_id: firstOrder.order_id,
    reservation_ref: firstOrder.order_id,
  });

  // 다음 갱신을 3번 확정 실패시켜 retry 후 영구 만료되는지 확인한다.
  db.sqlite.prepare(
    `UPDATE web_billing_customers
        SET current_period_end='2026-09-01 00:00:00+00', next_charge_at='2026-09-01 00:00:00+00',
            retry_after=NULL, failure_count=0, status='active'
      WHERE family_id=?`,
  ).run(FAMILY_ID);
  db.sqlite.prepare(
    `UPDATE family_subscription SET current_period_end='2026-09-01 00:00:00+00',status='active'
      WHERE family_id=?`,
  ).run(FAMILY_ID);
  let expiredKeyDeletionCount = 0;
  let expiredKeyDeletionSucceeds = false;
  const declineProvider = async (url, init = {}) => {
    if (String(url).includes("/v1/payments/orders/")) {
      return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    }
    if (init.method === "DELETE" && String(url).includes("/v1/billing/")) {
      expiredKeyDeletionCount += 1;
      return expiredKeyDeletionSucceeds
        ? new Response(null, { status: 200 })
        : Response.json({ code: "PROVIDER_UNAVAILABLE" }, { status: 500 });
    }
    return Response.json({ code: "REJECT_CARD_COMPANY" }, { status: 400 });
  };
  const failureTimes = [
    new Date("2026-09-01T00:00:00.000Z"),
    new Date("2026-09-01T01:00:01.000Z"),
    new Date("2026-09-01T07:00:02.000Z"),
    new Date("2026-09-02T07:00:03.000Z"),
  ];
  for (const [index, now] of failureTimes.entries()) {
    const failure = await processWebBillingRenewals(bindings, { now, fetchImpl: declineProvider });
    assert.equal(failure.failed, 1, `${index + 1}차 확정 실패가 누락되면 안 됩니다`);
  }
  const expired = db.row(
    `SELECT status,failure_count,billing_key_ciphertext,next_charge_at,retry_after,
            billing_key_revocation_status,billing_key_revocation_attempts
       FROM web_billing_customers WHERE family_id=?`,
    FAMILY_ID,
  );
  assert.equal(expired.status, "expired");
  assert.equal(expired.failure_count, 4);
  assert.notEqual(expired.billing_key_ciphertext, null, "원격 키 폐기 실패 중 복구 가능한 암호문을 지우면 안 됩니다");
  assert.equal(expired.next_charge_at, null);
  assert.equal(expired.retry_after, null);
  assert.equal(expired.billing_key_revocation_status, "pending");
  assert.equal(expired.billing_key_revocation_attempts, 1);
  assert.equal(expiredKeyDeletionCount, 1, "영구 만료 전이에서 Toss 빌링키 폐기를 한 번 시도해야 합니다");
  assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "expired");
  assert.deepEqual({ ...db.row(
    `SELECT c.last_paid_order_id,fs.latest_order_id,bpr.reservation_ref
       FROM web_billing_customers c
       JOIN family_subscription fs ON fs.family_id=c.family_id
       JOIN billing_provider_reservations bpr ON bpr.family_id=c.family_id
      WHERE c.family_id=?`,
    FAMILY_ID,
  ) }, {
    last_paid_order_id: firstOrder.order_id,
    latest_order_id: firstOrder.order_id,
    reservation_ref: firstOrder.order_id,
  }, "후속 실패 주문이 마지막 성공 주문 정본을 덮으면 안 됩니다");

  const checkoutWhileRevocationPending = await jsonRequest(
    createWebBillingRoutes({ fetchImpl: declineProvider }),
    bindings,
    "/web/checkout-session",
    {
      method: "POST",
      body: { familyId: FAMILY_ID, plan: "month", trialExpected: false },
    },
  );
  assert.equal(checkoutWhileRevocationPending.response.status, 409);
  assert.equal(checkoutWhileRevocationPending.body.error, "web_billing_reconciliation_pending");
  assert.equal(
    db.row("SELECT COUNT(*) AS count FROM web_billing_checkout_sessions WHERE status='pending'").count,
    0,
    "원격 폐기 대기 키를 새 checkout이 덮어쓸 세션을 만들면 안 됩니다",
  );

  expiredKeyDeletionSucceeds = true;
  db.sqlite.prepare(
    `UPDATE web_billing_customers
        SET billing_key_revocation_retry_at='2000-01-01 00:00:00+00'
      WHERE family_id=?`,
  ).run(FAMILY_ID);
  const revocationRetry = await processWebBillingRenewals(bindings, {
    now: new Date("2026-09-02T07:15:04.000Z"),
    fetchImpl: declineProvider,
    mode: "renewal",
  });
  assert.equal(revocationRetry.revocationCompleted, 1);
  assert.deepEqual({ ...db.row(
    `SELECT billing_key_ciphertext,billing_key_revocation_status
       FROM web_billing_customers WHERE family_id=?`,
    FAMILY_ID,
  ) }, {
    billing_key_ciphertext: null,
    billing_key_revocation_status: "revoked",
  });
  assert.equal(expiredKeyDeletionCount, 2, "재시도 성공 뒤에는 원격 키 폐기를 반복하면 안 됩니다");
  assert.equal(
    db.row("SELECT state FROM billing_provider_reservations WHERE family_id=?", FAMILY_ID).state,
    "released",
    "만료 고객의 원격 키 폐기가 끝나면 고아 Toss provider 선점도 해제해야 합니다",
  );
  db.close();
});

test("가족 삭제는 웹 구독 최소 금융 증적만 5년 분리 보존하고 원시 식별자·billingKey를 남기지 않는다", async () => {
  const db = createDb();
  try {
    const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
    const bindings = env(db);
    const checkout = await createCheckout(routes, bindings, "month");
    const completed = await jsonRequest(routes, bindings, "/web/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        sessionId: checkout.sessionId,
        customerKey: checkout.customerKey,
        authKey: "financial-retention-auth-key",
      },
    });
    assert.equal(completed.response.status, 200);
    const deleteAt = new Date("2026-08-02T00:00:00.000Z");
    await revokeWebBillingBeforeAccountDeletion(bindings, {
      ownerUserId: PARENT_ID,
      familyIds: [FAMILY_ID],
      now: deleteAt,
      fetchImpl: async (url, init = {}) => {
        if (String(url).includes("/v1/payments/orders/")) {
          const paid = db.row(
            "SELECT order_id,amount FROM web_billing_charge_attempts WHERE status='done' LIMIT 1",
          );
          return Response.json(payment(paid.order_id, checkout.customerKey, paid.amount));
        }
        if (init.method === "DELETE") return Response.json({ code: "NOT_FOUND" }, { status: 404 });
        throw new Error("unexpected_provider_request");
      },
    });

    const records = db.sqlite.prepare(
      `SELECT record_type,provider_reference,plan,amount,currency,charge_kind,
              record_status,period_start,period_end,payment_key_hash,
              detached_at,retention_until
         FROM web_billing_financial_records ORDER BY record_type`,
    ).all();
    assert.equal(records.length, 2);
    const charge = records.find((row) => row.record_type === "charge");
    const trial = records.find((row) => row.record_type === "trial");
    assert.deepEqual({
      plan: charge.plan,
      amount: charge.amount,
      currency: charge.currency,
      chargeKind: charge.charge_kind,
      status: charge.record_status,
      detachedAt: charge.detached_at,
      retentionUntil: charge.retention_until,
    }, {
      plan: "month",
      amount: 4_900,
      currency: "KRW",
      chargeKind: "initial",
      status: "paid",
      detachedAt: "2026-08-02 00:00:00.000+00",
      retentionUntil: "2031-08-02 00:00:00.000+00",
    });
    assert.match(charge.provider_reference, /^HYENI-I-[0-9a-f]{40}$/);
    assert.match(charge.payment_key_hash, /^[0-9a-f]{64}$/);
    assert.equal(trial.record_status, "trial_expired");
    assert.equal(trial.amount, 0);
    assert.equal(trial.payment_key_hash, null);

    const financialColumns = new Set(
      db.sqlite.prepare("PRAGMA table_info(web_billing_financial_records)")
        .all()
        .map((row) => String(row.name)),
    );
    for (const forbidden of [
      "family_id",
      "user_id",
      "parent_id",
      "customer_key",
      "billing_key",
      "billing_key_ciphertext",
    ]) {
      assert.equal(financialColumns.has(forbidden), false, `${forbidden}를 분리 정본에 두면 안 됩니다`);
    }

    await revokeWebBillingBeforeAccountDeletion(bindings, {
      ownerUserId: PARENT_ID,
      familyIds: [FAMILY_ID],
      now: new Date("2026-08-03T00:00:00.000Z"),
    });
    assert.equal(
      db.row("SELECT COUNT(*) AS count FROM web_billing_financial_records").count,
      2,
      "계정 삭제 재시도가 금융 증적을 중복 생성하면 안 됩니다",
    );
    assert.equal(
      db.row(
        "SELECT MIN(retention_until) AS value FROM web_billing_financial_records",
      ).value,
      "2031-08-02 00:00:00.000+00",
      "재시도로 5년 보존 기한을 계속 늘리면 안 됩니다",
    );

    await db.batch(await buildFamilyScopedDeleteStmts(db, [FAMILY_ID]));
    for (const table of [
      "web_billing_checkout_sessions",
      "web_billing_customers",
      "web_billing_charge_attempts",
      "web_billing_trial_claims",
      "billing_provider_reservations",
    ]) {
      assert.equal(db.row(`SELECT COUNT(*) AS count FROM ${table}`).count, 0, `${table} 운영 행이 남았습니다`);
    }
    assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_financial_records").count, 2);

    db.sqlite.prepare(
      `INSERT INTO web_billing_refund_records
         (record_id,provider_reference,provider,plan,amount,currency,charge_kind,
          refund_status,refunded_amount,balance_amount,payment_key_hash,refund_state_hash,
          transaction_count,provider_checked_at,retention_until,created_at)
       VALUES (?,?,'toss_web','month',4900,'KRW','initial','full',4900,0,?,?,1,?,?,?)`,
    ).run(
      `refund:${"c".repeat(64)}`,
      "HYENI-I-retention-refund",
      "d".repeat(64),
      "c".repeat(64),
      "2026-08-01 00:00:00.000+00",
      "2031-08-01 00:00:00.000+00",
      "2026-08-01 00:00:00.000+00",
    );

    assert.equal(
      await cleanupWebBillingFinancialRecords(
        db,
        new Date("2031-08-01T00:00:00.000Z"),
      ),
      0,
      "정확한 보존 만료 시각에는 먼저 지우면 안 됩니다",
    );
    assert.equal(
      await cleanupWebBillingFinancialRecords(
        db,
        new Date("2031-08-01T00:00:01.000Z"),
      ),
      1,
    );
    assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_refund_records").count, 0);
    assert.equal(
      await cleanupWebBillingFinancialRecords(
        db,
        new Date("2031-08-02T00:00:00.000Z"),
      ),
      0,
      "삭제 시각 기준 달력 5년의 정확한 경계에서는 금융 증적을 보존해야 합니다",
    );
    assert.equal(
      await cleanupWebBillingFinancialRecords(
        db,
        new Date("2031-08-02T00:00:01.000Z"),
      ),
      2,
    );
  } finally {
    db.close();
  }
});

test("Google Play 가족 체험 claim은 계정 삭제 금융 증적에서 Toss 결제로 오분류하지 않는다", async () => {
  const db = createDb();
  try {
    const tokenHash = "a".repeat(64);
    db.sqlite.prepare(
      `INSERT INTO web_billing_trial_claims
         (family_id,parent_id,checkout_session_id,provider,plan,status,claimed_at,trial_ends_at,updated_at)
       VALUES (?,?,?,'google_play','month','active',?,?,?)`,
    ).run(
      FAMILY_ID,
      PARENT_ID,
      `google-play:${tokenHash}`,
      "2026-08-01 00:00:00+00",
      "2026-08-08 00:00:00+00",
      "2026-08-01 00:00:00+00",
    );

    await revokeWebBillingBeforeAccountDeletion(env(db), {
      ownerUserId: PARENT_ID,
      familyIds: [FAMILY_ID],
      now: new Date("2026-08-02T00:00:00.000Z"),
    });

    assert.deepEqual({ ...db.row(
      `SELECT provider,provider_reference,record_status
         FROM web_billing_financial_records WHERE record_type='trial'`,
    ) }, {
      provider: "google_play",
      provider_reference: `google-play:${tokenHash}`,
      record_status: "trial_cancelled",
    });
  } finally {
    db.close();
  }
});

test("가족 삭제는 검증된 Google Play 유료 구독 최소 증적만 5년 분리 보존한다", async () => {
  const db = createDb();
  try {
    const paidTokenHash = "b".repeat(64);
    const trialTokenHash = "c".repeat(64);
    const paidOrderId = "GPA.1234-5678-9012-34567";
    const paidVerification = JSON.stringify({
      startTime: "2026-08-01T00:00:00.000Z",
      lineItems: [{
        productId: "hyeni_premium",
        expiryTime: "2027-08-01T00:00:00.000Z",
        offerDetails: { basePlanId: "annual-27840" },
        offerPhase: {},
      }],
    });
    const trialVerification = JSON.stringify({
      startTime: "2026-08-01T00:00:00.000Z",
      lineItems: [{
        productId: "hyeni_premium",
        expiryTime: "2026-08-08T00:00:00.000Z",
        offerDetails: { basePlanId: "monthly-2900", offerId: "trial-7d" },
        offerPhase: { freeTrial: {} },
      }],
    });
    db.sqlite.prepare(
      `INSERT INTO google_play_purchase_events
         (purchase_token_hash,family_id,parent_id,product_type,product_id,base_plan_id,
          order_id,status,verification_result,granted_at,acknowledged_at,created_at,updated_at)
       VALUES
         (?,?,?,'subscription','hyeni_premium','annual-27840',?,'active',?,?,?,?,?),
         (?,?,?,'subscription','hyeni_premium','monthly-2900','GPA.trial-order',
          'expired',?,?,?,?,?)`,
    ).run(
      paidTokenHash,
      FAMILY_ID,
      PARENT_ID,
      paidOrderId,
      paidVerification,
      "2026-08-01 00:00:01+00",
      "2026-08-01 00:00:02+00",
      "2026-08-01 00:00:00+00",
      "2026-08-01 00:00:02+00",
      trialTokenHash,
      FAMILY_ID,
      PARENT_ID,
      trialVerification,
      "2026-08-01 00:00:01+00",
      "2026-08-01 00:00:02+00",
      "2026-08-01 00:00:00+00",
      "2026-08-01 00:00:02+00",
    );

    await revokeWebBillingBeforeAccountDeletion(env(db), {
      ownerUserId: PARENT_ID,
      familyIds: [FAMILY_ID],
      now: new Date("2026-08-02T00:00:00.000Z"),
    });

    assert.deepEqual({ ...db.row(
      `SELECT record_type,provider,provider_reference,plan,amount,currency,charge_kind,
              record_status,period_start,period_end,payment_key_hash,detached_at,retention_until
         FROM web_billing_financial_records`,
    ) }, {
      record_type: "charge",
      provider: "google_play",
      provider_reference: paidOrderId,
      plan: "year",
      amount: 39_000,
      currency: "KRW",
      charge_kind: "initial",
      record_status: "paid",
      period_start: "2026-08-01T00:00:00.000Z",
      period_end: "2027-08-01T00:00:00.000Z",
      payment_key_hash: paidTokenHash,
      detached_at: "2026-08-02 00:00:00.000+00",
      retention_until: "2031-08-02 00:00:00.000+00",
    });
    assert.equal(
      db.row("SELECT COUNT(*) AS count FROM web_billing_financial_records").count,
      1,
      "무료체험 종료 행을 유료 금융 거래로 보존하면 안 됩니다",
    );

    await db.batch(await buildFamilyScopedDeleteStmts(db, [FAMILY_ID]));
    assert.equal(db.row("SELECT COUNT(*) AS count FROM google_play_purchase_events").count, 0);
    assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_financial_records").count, 1);
  } finally {
    db.close();
  }
});

test("계정 삭제는 pending·미결제 unknown 주문을 새 청구 없이 닫고 확정 주문만 보존한다", async () => {
  const db = createDb();
  try {
    const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
    const bindings = env(db);
    const checkout = await createCheckout(routes, bindings, "year");
    const completed = await jsonRequest(routes, bindings, "/web/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        sessionId: checkout.sessionId,
        customerKey: checkout.customerKey,
        authKey: "no-charge-delete-auth-key",
      },
    });
    assert.equal(completed.response.status, 200);
    db.sqlite.prepare(
      `INSERT INTO web_billing_charge_attempts
         (order_id,family_id,checkout_session_id,plan,amount,kind,period_start,period_end,
          status,created_at,updated_at)
       VALUES
         ('HYENI-R-delete-pending',?,NULL,'year',39000,'renewal',?,?, 'pending',?,?),
         ('HYENI-R-delete-unknown',?,NULL,'year',39000,'renewal',?,?, 'unknown',?,?)`,
    ).run(
      FAMILY_ID,
      "2027-08-01 00:00:00+00",
      "2028-08-01 00:00:00+00",
      "2026-08-02 00:00:00+00",
      "2026-08-02 00:00:00+00",
      FAMILY_ID,
      "2028-08-01 00:00:00+00",
      "2029-08-01 00:00:00+00",
      "2026-08-02 00:00:00+00",
      "2026-08-02 00:00:00+00",
    );
    const requests = [];
    const paidOrder = db.row(
      "SELECT order_id,amount FROM web_billing_charge_attempts WHERE status='done' LIMIT 1",
    );
    await revokeWebBillingBeforeAccountDeletion(bindings, {
      ownerUserId: PARENT_ID,
      familyIds: [FAMILY_ID],
      now: new Date("2026-08-02T01:00:00.000Z"),
      fetchImpl: async (url, init = {}) => {
        requests.push({ url: String(url), method: init.method ?? "GET" });
        if (init.method === "DELETE") return new Response(null, { status: 200 });
        if (String(url).includes("/v1/payments/orders/")) {
          const orderId = decodeURIComponent(String(url).split("/").at(-1));
          return orderId === paidOrder.order_id
            ? Response.json(payment(orderId, checkout.customerKey, paidOrder.amount))
            : Response.json({ code: "NOT_FOUND" }, { status: 404 });
        }
        throw new Error("unexpected_provider_request");
      },
    });

    assert.deepEqual(
      db.sqlite.prepare(
        `SELECT order_id,status,error_code FROM web_billing_charge_attempts
          WHERE order_id IN ('HYENI-R-delete-pending','HYENI-R-delete-unknown')
          ORDER BY order_id`,
      ).all().map((row) => ({ ...row })),
      [
        {
          order_id: "HYENI-R-delete-pending",
          status: "failed",
          error_code: "ACCOUNT_DELETION_NO_CHARGE",
        },
        {
          order_id: "HYENI-R-delete-unknown",
          status: "failed",
          error_code: "BILLING_PROVIDER_CONFLICT_NO_CHARGE",
        },
      ],
    );
    assert.equal(requests.filter((request) => request.method === "GET").length, 2);
    assert.equal(requests.filter((request) => request.method === "DELETE").length, 1);
    assert.equal(requests.some((request) => request.method === "POST"), false);
    assert.equal(
      db.row("SELECT COUNT(*) AS count FROM web_billing_financial_records WHERE record_type='charge'").count,
      1,
      "실제 완료된 최초 결제 외 미결제 시도를 금융 거래처럼 보존하면 안 됩니다",
    );
  } finally {
    db.close();
  }
});

test("계정 삭제 중 unknown 주문 조회가 실패하면 키·운영 증적을 유지하고 삭제를 fail-closed한다", async () => {
  const db = createDb();
  try {
    const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
    const bindings = env(db);
    const checkout = await createCheckout(routes, bindings, "month");
    const completed = await jsonRequest(routes, bindings, "/web/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        sessionId: checkout.sessionId,
        customerKey: checkout.customerKey,
        authKey: "unknown-delete-auth-key",
      },
    });
    assert.equal(completed.response.status, 200);
    db.sqlite.prepare(
      `INSERT INTO web_billing_charge_attempts
         (order_id,family_id,checkout_session_id,plan,amount,kind,period_start,period_end,
          status,created_at,updated_at)
       VALUES ('HYENI-R-delete-provider-down',?,NULL,'month',4900,'renewal',?,?,
               'unknown',?,?)`,
    ).run(
      FAMILY_ID,
      "2026-09-01 00:00:00+00",
      "2026-10-01 00:00:00+00",
      "2026-08-02 00:00:00+00",
      "2026-08-02 00:00:00+00",
    );
    await assert.rejects(
      revokeWebBillingBeforeAccountDeletion(bindings, {
        ownerUserId: PARENT_ID,
        familyIds: [FAMILY_ID],
        now: new Date("2026-08-02T02:00:00.000Z"),
        fetchImpl: async () => Response.json({ code: "PROVIDER_UNAVAILABLE" }, { status: 503 }),
      }),
      /web_billing_account_deletion_reconciliation_pending/,
    );
    assert.equal(
      db.row(
        "SELECT status FROM web_billing_charge_attempts WHERE order_id='HYENI-R-delete-provider-down'",
      ).status,
      "unknown",
    );
    assert.notEqual(
      db.row("SELECT billing_key_ciphertext AS value FROM web_billing_customers WHERE family_id=?", FAMILY_ID).value,
      null,
    );
    assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "active");
    assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_financial_records").count, 0);
  } finally {
    db.close();
  }
});

test("Toss 전액 환불 webhook은 재조회 정본으로 현재 last_order 권리·자동청구·provider를 한 번에 닫고 재전송에 멱등이다", async () => {
  const db = createDb();
  try {
    const requests = [];
    const states = new Map();
    const now = new Date("2026-08-01T06:00:00.000Z");
    const routes = createWebBillingRoutes({
      fetchImpl: refundAwareProvider(requests, states),
      now: () => now,
    });
    const bindings = env(db);
    const attempt = await activatePaidSubscription(routes, bindings, "month");
    states.set(attempt.order_id, refundPayment(attempt.order_id, attempt.amount, attempt.amount));

    const webhookBody = {
      eventType: "PAYMENT_STATUS_CHANGED",
      data: {
        orderId: attempt.order_id,
        paymentKey: "payload-payment-key-must-not-be-trusted",
        status: "DONE",
        totalAmount: 1,
      },
    };
    const first = await jsonRequest(routes, bindings, "/web/subscription/webhook", {
      method: "POST",
      authorization: "",
      body: webhookBody,
    });
    assert.equal(first.response.status, 200);
    assert.equal(first.body.status, "refunded");

    const customer = db.row(
      `SELECT status,current_period_end,next_charge_at,retry_after,last_order_id,
              billing_key_ciphertext,billing_key_revocation_status
         FROM web_billing_customers WHERE family_id=?`,
      FAMILY_ID,
    );
    assert.equal(customer.status, "expired");
    assert.equal(customer.next_charge_at, null);
    assert.equal(customer.retry_after, null);
    assert.equal(customer.last_order_id, attempt.order_id);
    assert.notEqual(customer.billing_key_ciphertext, null, "원격 키 폐기 재시도를 위해 암호문은 보존해야 합니다");
    assert.equal(customer.billing_key_revocation_status, "pending");
    assert.deepEqual({ ...db.row(
      `SELECT status,provider,latest_order_id,current_period_end
         FROM family_subscription WHERE family_id=?`,
      FAMILY_ID,
    ) }, {
      status: "expired",
      provider: "toss_web",
      latest_order_id: attempt.order_id,
      current_period_end: attempt.period_start,
    });
    assert.equal(
      db.row("SELECT state FROM billing_provider_reservations WHERE family_id=?", FAMILY_ID).state,
      "released",
    );
    const operational = db.row(
      `SELECT refund_status,refunded_amount,refund_state_hash,refund_committed_at
         FROM web_billing_charge_attempts WHERE order_id=?`,
      attempt.order_id,
    );
    assert.equal(operational.refund_status, "full");
    assert.equal(operational.refunded_amount, 4_900);
    assert.match(operational.refund_state_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(operational.refund_committed_at, null);
    assert.equal(db.row(
      "SELECT COUNT(*) AS count FROM web_billing_refund_records WHERE provider_reference=?",
      attempt.order_id,
    ).count, 1);
    assert.equal(db.row(
      "SELECT COUNT(*) AS count FROM premium_funnel_events WHERE event='refund'",
    ).count, 1);

    // 첫 응답이 네트워크에서 유실됐다고 가정한 Toss 재전송이다.
    const duplicate = await jsonRequest(routes, bindings, "/web/subscription/webhook", {
      method: "POST",
      authorization: "",
      body: webhookBody,
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.body.status, "refunded");
    assert.equal(db.row(
      "SELECT COUNT(*) AS count FROM web_billing_refund_records WHERE provider_reference=?",
      attempt.order_id,
    ).count, 1);
    assert.equal(db.row(
      "SELECT COUNT(*) AS count FROM premium_funnel_events WHERE event='refund'",
    ).count, 1);
    assert.equal(
      requests.filter((request) => request.url.includes("/v1/payments/orders/")).length,
      1,
      "이미 확정한 전액 환불 재전송은 결제사를 다시 조회하지 않아야 합니다",
    );

    const completedAfterRefund = await jsonRequest(routes, bindings, "/web/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        sessionId: db.row(
          "SELECT checkout_session_id FROM web_billing_charge_attempts WHERE order_id=?",
          attempt.order_id,
        ).checkout_session_id,
        customerKey: db.row(
          "SELECT customer_key FROM web_billing_customers WHERE family_id=?",
          FAMILY_ID,
        ).customer_key,
      },
    });
    assert.equal(completedAfterRefund.response.status, 410);
    assert.notEqual(completedAfterRefund.body.status, "active");
  } finally {
    db.close();
  }
});

test("승인 직후 전액 환불된 주문은 늦은 최초 finalize가 권리를 다시 열지 못한다", async () => {
  const db = createDb();
  try {
    const now = new Date("2026-08-01T06:30:00.000Z");
    const sessionId = "web_refunded_before_finalize_123456";
    const claimToken = "refund-before-finalize-claim-token";
    const customerKey = "customer-refunded-before-finalize";
    const orderId = "HYENI-I-refunded-before-finalize";
    const periodEnd = new Date("2026-09-01T06:30:00.000Z");
    db.sqlite.prepare(
      `INSERT INTO web_billing_customers
         (family_id,parent_id,customer_key,plan,status,current_period_end,next_charge_at,
          failure_count,last_order_id,last_paid_order_id,created_at,updated_at)
       VALUES (?,?,?,'month','pending_charge',NULL,NULL,0,?,?,?,?)`,
    ).run(FAMILY_ID, PARENT_ID, customerKey, orderId, orderId, now.toISOString(), now.toISOString());
    db.sqlite.prepare(
      `INSERT INTO web_billing_checkout_sessions
         (id,family_id,parent_id,customer_key,plan,amount,status,expires_at,
          claim_token,claim_expires_at,created_at,updated_at)
       VALUES (?,?,?,?,'month',4900,'processing',?,?,?,?,?)`,
    ).run(
      sessionId,
      FAMILY_ID,
      PARENT_ID,
      customerKey,
      "2026-08-01T07:00:00.000Z",
      claimToken,
      "2026-08-01T06:45:00.000Z",
      now.toISOString(),
      now.toISOString(),
    );
    db.sqlite.prepare(
      `INSERT INTO web_billing_charge_attempts
         (order_id,family_id,checkout_session_id,plan,amount,kind,period_start,period_end,
          status,payment_key_hash,refund_status,refunded_amount,refund_state_hash,
          provider_checked_at,refund_committed_at,created_at,completed_at,updated_at)
       VALUES (?,?,?,'month',4900,'initial',?,?,'done',?,'full',4900,?,?,?,?,?,?)`,
    ).run(
      orderId,
      FAMILY_ID,
      sessionId,
      "2026-08-01 06:30:00.000+00",
      "2026-09-01 06:30:00.000+00",
      "a".repeat(64),
      "b".repeat(64),
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    );
    db.sqlite.prepare(
      `INSERT INTO billing_provider_reservations
         (family_id,provider,state,reservation_ref,created_at,updated_at)
       VALUES (?,'toss_web','reserved',?,?,?)`,
    ).run(FAMILY_ID, sessionId, now.toISOString(), now.toISOString());

    await assert.rejects(
      finalizeInitialWebBilling(env(db), {
        sessionId,
        sessionClaimToken: claimToken,
        familyId: FAMILY_ID,
        customerKey,
        plan: "month",
        orderId,
        periodEnd,
        now,
      }),
      /web_billing_initial_finalize_guard_failed/,
    );
    assert.equal(db.row(
      "SELECT status FROM web_billing_customers WHERE family_id=?",
      FAMILY_ID,
    ).status, "pending_charge");
    assert.equal(db.row(
      "SELECT COUNT(*) AS count FROM family_subscription WHERE family_id=?",
      FAMILY_ID,
    ).count, 0);
  } finally {
    db.close();
  }
});

test("부분 환불은 현재 기간 권리를 유지하되 추가 자동청구를 멈추고 provider 선점은 기간말까지 유지한다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    const now = new Date("2026-08-01T07:00:00.000Z");
    const routes = createWebBillingRoutes({
      fetchImpl: refundAwareProvider([], states),
      now: () => now,
    });
    const bindings = env(db);
    const attempt = await activatePaidSubscription(routes, bindings, "year");
    states.set(attempt.order_id, refundPayment(attempt.order_id, attempt.amount, 9_000));

    const response = await jsonRequest(routes, bindings, "/web/subscription/webhook", {
      method: "POST",
      authorization: "",
      body: { eventType: "PAYMENT_STATUS_CHANGED", data: { orderId: attempt.order_id } },
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.body.status, "partial_refund");
    assert.deepEqual({ ...db.row(
      "SELECT refund_status,refunded_amount FROM web_billing_charge_attempts WHERE order_id=?",
      attempt.order_id,
    ) }, { refund_status: "partial", refunded_amount: 9_000 });
    assert.deepEqual({ ...db.row(
      `SELECT refund_status,refunded_amount,balance_amount
         FROM web_billing_refund_records WHERE provider_reference=?`,
      attempt.order_id,
    ) }, { refund_status: "partial", refunded_amount: 9_000, balance_amount: 30_000 });
    const customer = db.row(
      `SELECT status,current_period_end,next_charge_at,billing_key_revocation_status
         FROM web_billing_customers WHERE family_id=?`,
      FAMILY_ID,
    );
    assert.equal(customer.status, "cancel_at_period_end");
    assert.notEqual(customer.current_period_end, null);
    assert.equal(customer.next_charge_at, null);
    assert.equal(customer.billing_key_revocation_status, "pending");
    assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "cancelled");
    assert.equal(db.row("SELECT state FROM billing_provider_reservations WHERE family_id=?", FAMILY_ID).state, "active");
    assert.equal(db.row("SELECT COUNT(*) AS count FROM premium_funnel_events WHERE event='refund'").count, 0);
  } finally {
    db.close();
  }
});

test("과거 주문의 전액 환불은 기록하되 더 최신 last_order 구독을 회수하지 않는다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    const routes = createWebBillingRoutes({ fetchImpl: refundAwareProvider([], states) });
    const bindings = env(db);
    const current = await activatePaidSubscription(routes, bindings, "month");
    const historicalOrderId = "HYENI-I-historical-refund-order-000000000001";
    const historicalPaymentKey = "payment-historical-refund";
    const historicalHash = await hashWebBillingPaymentKey(historicalPaymentKey);
    db.sqlite.prepare(
      `INSERT INTO web_billing_charge_attempts
         (order_id,family_id,plan,amount,kind,period_start,period_end,status,
          payment_key_hash,created_at,completed_at,updated_at)
       VALUES (?,?,'month',4900,'initial','2026-06-01 00:00:00+00',
               '2026-07-01 00:00:00+00','done',?,'2026-06-01 00:00:00+00',
               '2026-06-01 00:00:01+00','2026-06-01 00:00:01+00')`,
    ).run(historicalOrderId, FAMILY_ID, historicalHash);
    states.set(historicalOrderId, refundPayment(
      historicalOrderId,
      4_900,
      4_900,
      historicalPaymentKey,
    ));

    const response = await jsonRequest(routes, bindings, "/web/subscription/webhook", {
      method: "POST",
      authorization: "",
      body: { eventType: "PAYMENT_STATUS_CHANGED", data: { orderId: historicalOrderId } },
    });
    assert.equal(response.response.status, 200);
    assert.equal(db.row(
      "SELECT refund_status FROM web_billing_charge_attempts WHERE order_id=?",
      historicalOrderId,
    ).refund_status, "full");
    assert.equal(db.row("SELECT last_order_id FROM web_billing_customers WHERE family_id=?", FAMILY_ID).last_order_id, current.order_id);
    assert.equal(db.row("SELECT status FROM web_billing_customers WHERE family_id=?", FAMILY_ID).status, "active");
    assert.equal(db.row("SELECT latest_order_id FROM family_subscription WHERE family_id=?", FAMILY_ID).latest_order_id, current.order_id);
    assert.equal(db.row("SELECT state FROM billing_provider_reservations WHERE family_id=?", FAMILY_ID).state, "active");
  } finally {
    db.close();
  }
});

test("결제키 불일치·provider 실패·과대 본문은 환불 상태를 바꾸지 않고 공개 응답에 원문 오류를 노출하지 않는다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    let providerFailure = false;
    let providerOversized = false;
    let lookupCount = 0;
    const baseProvider = refundAwareProvider([], states);
    const provider = async (url, init) => {
      if (String(url).includes("/v1/payments/orders/")) {
        lookupCount += 1;
        if (providerFailure) {
          return Response.json({ code: "SECRET_PROVIDER_DIAGNOSTIC", message: "raw secret" }, { status: 500 });
        }
        if (providerOversized) {
          const orderId = decodeURIComponent(String(url).split("/").at(-1));
          return new Response(JSON.stringify({
            ...payment(orderId, "ignored", 4_900),
            padding: "x".repeat(520 * 1024),
          }), { headers: { "Content-Type": "application/json" } });
        }
      }
      return baseProvider(url, init);
    };
    const routes = createWebBillingRoutes({ fetchImpl: provider });
    const bindings = env(db);
    const attempt = await activatePaidSubscription(routes, bindings, "month");
    states.set(attempt.order_id, refundPayment(
      attempt.order_id,
      attempt.amount,
      attempt.amount,
      "wrong-payment-key",
    ));

    const mismatch = await jsonRequest(routes, bindings, "/web/subscription/webhook", {
      method: "POST",
      authorization: "",
      body: { eventType: "PAYMENT_STATUS_CHANGED", data: { orderId: attempt.order_id } },
    });
    assert.equal(mismatch.response.status, 503);
    assert.deepEqual(mismatch.body, { ok: false, accepted: true, settled: false });
    assert.equal(db.row(
      "SELECT refund_status FROM web_billing_charge_attempts WHERE order_id=?",
      attempt.order_id,
    ).refund_status, "none");

    db.sqlite.prepare(
      "UPDATE web_billing_charge_attempts SET refund_webhook_checked_at=NULL WHERE order_id=?",
    ).run(attempt.order_id);
    providerFailure = true;
    const failed = await jsonRequest(routes, bindings, "/web/subscription/webhook", {
      method: "POST",
      authorization: "",
      body: { eventType: "PAYMENT_STATUS_CHANGED", data: { orderId: attempt.order_id } },
    });
    assert.equal(failed.response.status, 503);
    assert.equal(JSON.stringify(failed.body).includes("SECRET_PROVIDER_DIAGNOSTIC"), false);
    assert.equal(JSON.stringify(failed.body).includes("raw secret"), false);

    db.sqlite.prepare(
      "UPDATE web_billing_charge_attempts SET refund_webhook_checked_at=NULL WHERE order_id=?",
    ).run(attempt.order_id);
    providerFailure = false;
    providerOversized = true;
    const oversizedProvider = await jsonRequest(routes, bindings, "/web/subscription/webhook", {
      method: "POST",
      authorization: "",
      body: { eventType: "PAYMENT_STATUS_CHANGED", data: { orderId: attempt.order_id } },
    });
    assert.equal(oversizedProvider.response.status, 503);
    assert.equal(db.row(
      "SELECT refund_status FROM web_billing_charge_attempts WHERE order_id=?",
      attempt.order_id,
    ).refund_status, "none");
    providerOversized = false;

    const beforeOversize = lookupCount;
    const oversized = await routes.request("https://local.test/web/subscription/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "PAYMENT_STATUS_CHANGED",
        data: { orderId: attempt.order_id },
        padding: "x".repeat(70 * 1024),
      }),
    }, bindings);
    assert.equal(oversized.status, 413);
    assert.equal(lookupCount, beforeOversize);

    const invalid = await jsonRequest(routes, bindings, "/web/subscription/webhook", {
      method: "POST",
      authorization: "",
      body: {
        eventType: "PAYMENT_STATUS_CHANGED",
        data: { orderId: "A".repeat(65) },
      },
    });
    assert.equal(invalid.response.status, 200);
    assert.equal(invalid.body.accepted, false);
    assert.equal(lookupCount, beforeOversize);
  } finally {
    db.close();
  }
});

test("환불 최종 batch의 중간 DB 실패는 감사·권리·customer·provider를 모두 원복한다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    const routes = createWebBillingRoutes({ fetchImpl: refundAwareProvider([], states) });
    const bindings = env(db);
    const attempt = await activatePaidSubscription(routes, bindings, "month");
    states.set(attempt.order_id, refundPayment(attempt.order_id, attempt.amount, attempt.amount));
    let injected = false;
    db.beforeRun = async (sql) => {
      if (!injected && sql.includes("UPDATE family_subscription") && sql.includes("latest_order_id")) {
        injected = true;
        throw new Error("injected_refund_batch_failure");
      }
    };

    const response = await jsonRequest(routes, bindings, "/web/subscription/webhook", {
      method: "POST",
      authorization: "",
      body: { eventType: "PAYMENT_STATUS_CHANGED", data: { orderId: attempt.order_id } },
    });
    db.beforeRun = null;
    assert.equal(response.response.status, 503);
    assert.equal(injected, true);
    assert.deepEqual({ ...db.row(
      "SELECT refund_status,refunded_amount FROM web_billing_charge_attempts WHERE order_id=?",
      attempt.order_id,
    ) }, { refund_status: "none", refunded_amount: 0 });
    assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_refund_records").count, 0);
    assert.equal(db.row("SELECT status FROM web_billing_customers WHERE family_id=?", FAMILY_ID).status, "active");
    assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "active");
    assert.equal(db.row("SELECT state FROM billing_provider_reservations WHERE family_id=?", FAMILY_ID).state, "active");
    assert.equal(db.row("SELECT COUNT(*) AS count FROM premium_funnel_events WHERE event='refund'").count, 0);
  } finally {
    db.close();
  }
});

test("웹훅이 누락돼도 hourly 환불 대사가 현재 last_order를 Toss 재조회해 전액 환불을 확정한다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    const provider = refundAwareProvider([], states);
    const routes = createWebBillingRoutes({ fetchImpl: provider });
    const bindings = env(db);
    const attempt = await activatePaidSubscription(routes, bindings, "month");
    states.set(attempt.order_id, refundPayment(attempt.order_id, attempt.amount, attempt.amount));
    db.sqlite.prepare(
      "UPDATE web_billing_charge_attempts SET provider_checked_at=NULL WHERE order_id=?",
    ).run(attempt.order_id);
    db.resetQueryCount();

    const result = await processWebBillingRefundReconciliations(bindings, {
      limit: 1,
      now: new Date("2026-08-02T00:00:00.000Z"),
      fetchImpl: provider,
    });
    assert.equal(result.checked, 1);
    assert.equal(result.refunded, 1);
    assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "expired");
    assert.equal(db.row("SELECT state FROM billing_provider_reservations WHERE family_id=?", FAMILY_ID).state, "released");
    assert.ok(db.queryCount <= 50, `refund reconciliation D1 query가 ${db.queryCount}회입니다`);
  } finally {
    db.close();
  }
});

test("실패한 환불 funnel 재시도는 결제사 환불 대사를 굶기지 않고 별도 작업에서 복구한다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    const provider = refundAwareProvider([], states);
    const routes = createWebBillingRoutes({ fetchImpl: provider });
    const bindings = env(db, { PREMIUM_FUNNEL_HASH_SECRET: undefined });
    const current = await activatePaidSubscription(routes, bindings, "month");
    const historicalOrderId = "HYENI-I-pending-refund-funnel-000000001";
    db.sqlite.prepare(
      `INSERT INTO web_billing_charge_attempts
         (order_id,family_id,plan,amount,kind,period_start,period_end,status,
          payment_key_hash,refund_status,refunded_amount,refund_state_hash,
          refund_committed_at,refund_funnel_status,created_at,completed_at,updated_at)
       VALUES (?,?,'month',4900,'initial','2026-06-01 00:00:00+00',
               '2026-07-01 00:00:00+00','done',?,'full',4900,?,
               '2026-07-01 00:00:00+00','pending','2026-06-01 00:00:00+00',
               '2026-06-01 00:00:01+00','2026-07-01 00:00:00+00')`,
    ).run(historicalOrderId, FAMILY_ID, "a".repeat(64), "b".repeat(64));
    states.set(current.order_id, refundPayment(current.order_id, current.amount, current.amount));
    db.sqlite.prepare(
      "UPDATE web_billing_charge_attempts SET provider_checked_at=NULL WHERE order_id=?",
    ).run(current.order_id);

    const refundResult = await processWebBillingRefundReconciliations(bindings, {
      limit: 1,
      now: new Date("2026-08-02T00:00:00.000Z"),
      fetchImpl: provider,
    });
    assert.equal(refundResult.refunded, 1);
    assert.equal(db.row(
      "SELECT refund_funnel_status FROM web_billing_charge_attempts WHERE order_id=?",
      historicalOrderId,
    ).refund_funnel_status, "pending");

    const funnelUnavailable = await processWebBillingRefundFunnelRetries(bindings, {
      now: new Date("2026-08-02T00:01:00.000Z"),
    });
    assert.equal(funnelUnavailable.configured, false);
    bindings.PREMIUM_FUNNEL_HASH_SECRET = "premium-funnel-test-secret-32-bytes-minimum";
    const funnelRecovered = await processWebBillingRefundFunnelRetries(bindings, {
      now: new Date("2026-08-02T00:02:00.000Z"),
    });
    assert.deepEqual(funnelRecovered, { configured: true, checked: 1, sent: 1 });
  } finally {
    db.close();
  }
});

test("자연 만료된 마지막 주문의 늦은 전액 환불은 기간을 되감지 않고 증적과 provider 해제만 확정한다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    const now = new Date("2026-10-01T00:00:00.000Z");
    const provider = refundAwareProvider([], states);
    const routes = createWebBillingRoutes({ fetchImpl: provider, now: () => now });
    const bindings = env(db);
    const attempt = await activatePaidSubscription(routes, bindings, "month");
    db.sqlite.prepare(
      `UPDATE web_billing_customers
          SET status='expired',current_period_end=?,next_charge_at=NULL,retry_after=NULL,
              billing_key_ciphertext=NULL,billing_key_iv=NULL,billing_key_version=NULL
        WHERE family_id=?`,
    ).run(attempt.period_end, FAMILY_ID);
    db.sqlite.prepare(
      `UPDATE family_subscription
          SET status='expired',current_period_end=?,cancelled_at='2026-10-01 00:00:00+00'
        WHERE family_id=?`,
    ).run(attempt.period_end, FAMILY_ID);
    states.set(attempt.order_id, refundPayment(attempt.order_id, attempt.amount, attempt.amount));

    const response = await jsonRequest(routes, bindings, "/web/subscription/webhook", {
      method: "POST",
      authorization: "",
      body: { eventType: "PAYMENT_STATUS_CHANGED", data: { orderId: attempt.order_id } },
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.body.status, "refunded");
    assert.deepEqual({ ...db.row(
      "SELECT status,current_period_end FROM family_subscription WHERE family_id=?",
      FAMILY_ID,
    ) }, { status: "expired", current_period_end: attempt.period_end });
    assert.equal(db.row(
      "SELECT COUNT(*) AS count FROM web_billing_refund_records WHERE provider_reference=?",
      attempt.order_id,
    ).count, 1);
    assert.equal(db.row(
      "SELECT state FROM billing_provider_reservations WHERE family_id=?",
      FAMILY_ID,
    ).state, "released");
    assert.equal(db.row(
      "SELECT COUNT(*) AS count FROM premium_funnel_events WHERE event='refund'",
    ).count, 1);
  } finally {
    db.close();
  }
});

test("더 최신 갱신이 있는 과거 주문도 FIFO cron이 환불 증적만 남기고 현재 권리는 유지한다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    const provider = refundAwareProvider([], states);
    const routes = createWebBillingRoutes({ fetchImpl: provider });
    const bindings = env(db);
    const current = await activatePaidSubscription(routes, bindings, "month");
    const historicalOrderId = "HYENI-R-historical-cron-refund-00000001";
    const historicalPaymentKey = "payment-historical-cron-refund";
    db.sqlite.prepare(
      `INSERT INTO web_billing_charge_attempts
         (order_id,family_id,customer_key,plan,amount,kind,period_start,period_end,status,
          payment_key_hash,created_at,completed_at,updated_at)
       VALUES (?,?,?,'month',4900,'renewal','2026-05-01 00:00:00+00',
               '2026-06-01 00:00:00+00','done',?,'2026-05-01 00:00:00+00',
               '2026-05-01 00:00:01+00','2026-05-01 00:00:01+00')`,
    ).run(
      historicalOrderId,
      FAMILY_ID,
      db.row("SELECT customer_key FROM web_billing_customers WHERE family_id=?", FAMILY_ID).customer_key,
      await hashWebBillingPaymentKey(historicalPaymentKey),
    );
    states.set(historicalOrderId, refundPayment(
      historicalOrderId,
      4_900,
      4_900,
      historicalPaymentKey,
    ));
    const result = await processWebBillingRefundReconciliations(bindings, {
      limit: 1,
      now: new Date("2026-08-03T00:00:00.000Z"),
      fetchImpl: provider,
    });
    assert.equal(result.refunded, 1);
    assert.equal(db.row(
      "SELECT refund_status FROM web_billing_charge_attempts WHERE order_id=?",
      historicalOrderId,
    ).refund_status, "full");
    assert.deepEqual({ ...db.row(
      "SELECT status,latest_order_id FROM family_subscription WHERE family_id=?",
      FAMILY_ID,
    ) }, { status: "active", latest_order_id: current.order_id });
  } finally {
    db.close();
  }
});

test("Google 활성 중 refund_required Toss 전액 환불은 cron이 Google 권리를 보존하고 conflict만 해제한다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    const provider = refundAwareProvider([], states);
    const routes = createWebBillingRoutes({ fetchImpl: provider });
    const bindings = env(db);
    const attempt = await activatePaidSubscription(routes, bindings, "month");
    db.sqlite.prepare(
      `UPDATE family_subscription
          SET provider='google_play',status='active',latest_order_id='GPA.refund-conflict',
              current_period_end='2027-08-01 00:00:00+00'
        WHERE family_id=?`,
    ).run(FAMILY_ID);
    db.sqlite.prepare(
      `UPDATE billing_provider_reservations
          SET provider='google_play',state='conflict',reservation_ref='GPA.refund-conflict',
              conflicting_provider='toss_web',conflict_ref=?,
              conflict_reason='toss_charge_after_google_activation',resolution_status='refund_required'
        WHERE family_id=?`,
    ).run(attempt.order_id, FAMILY_ID);
    states.set(attempt.order_id, refundPayment(attempt.order_id, attempt.amount, attempt.amount));

    const result = await processWebBillingRefundReconciliations(bindings, {
      limit: 1,
      now: new Date("2026-08-02T00:00:00.000Z"),
      fetchImpl: provider,
    });
    assert.equal(result.refunded, 1);
    assert.deepEqual({ ...db.row(
      `SELECT provider,state,conflicting_provider,conflict_ref,resolution_status
         FROM billing_provider_reservations WHERE family_id=?`,
      FAMILY_ID,
    ) }, {
      provider: "google_play",
      state: "active",
      conflicting_provider: null,
      conflict_ref: null,
      resolution_status: null,
    });
    assert.deepEqual({ ...db.row(
      "SELECT provider,status,latest_order_id FROM family_subscription WHERE family_id=?",
      FAMILY_ID,
    ) }, { provider: "google_play", status: "active", latest_order_id: "GPA.refund-conflict" });
  } finally {
    db.close();
  }
});

test("Google 활성 중 Toss 부분 환불은 금융 증적을 남기되 refund_required conflict를 유지한다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    const provider = refundAwareProvider([], states);
    const routes = createWebBillingRoutes({ fetchImpl: provider });
    const bindings = env(db);
    const attempt = await activatePaidSubscription(routes, bindings, "year");
    db.sqlite.prepare(
      `UPDATE family_subscription
          SET provider='google_play',status='active',latest_order_id='GPA.partial-conflict',
              current_period_end='2027-08-01 00:00:00+00'
        WHERE family_id=?`,
    ).run(FAMILY_ID);
    db.sqlite.prepare(
      `UPDATE billing_provider_reservations
          SET provider='google_play',state='conflict',reservation_ref='GPA.partial-conflict',
              conflicting_provider='toss_web',conflict_ref=?,
              conflict_reason='toss_charge_after_google_activation',resolution_status='refund_required'
        WHERE family_id=?`,
    ).run(attempt.order_id, FAMILY_ID);
    states.set(attempt.order_id, refundPayment(attempt.order_id, attempt.amount, 9_000));

    const result = await processWebBillingRefundReconciliations(bindings, {
      limit: 1,
      now: new Date("2026-08-02T00:00:00.000Z"),
      fetchImpl: provider,
    });
    assert.equal(result.partial, 1);
    assert.deepEqual({ ...db.row(
      `SELECT provider,state,conflicting_provider,conflict_ref,resolution_status
         FROM billing_provider_reservations WHERE family_id=?`,
      FAMILY_ID,
    ) }, {
      provider: "google_play",
      state: "conflict",
      conflicting_provider: "toss_web",
      conflict_ref: attempt.order_id,
      resolution_status: "refund_required",
    });
    assert.equal(db.row(
      "SELECT refund_status FROM web_billing_charge_attempts WHERE order_id=?",
      attempt.order_id,
    ).refund_status, "partial");
  } finally {
    db.close();
  }
});

test("로컬 done 뒤 finalize 전에 Toss가 환불하면 최초 복구는 premium을 다시 열지 않는다", async () => {
  const db = createDb();
  try {
    const now = new Date("2026-08-01T08:00:00.000Z");
    const sessionId = "web_done_refunded_recovery_123456";
    const customerKey = "customer-done-refunded-recovery";
    const orderId = "HYENI-I-done-refunded-recovery";
    const paymentKey = `payment-${orderId}`;
    const paymentHash = await hashWebBillingPaymentKey(paymentKey);
    db.sqlite.prepare(
      `INSERT INTO web_billing_customers
         (family_id,parent_id,customer_key,plan,status,failure_count,created_at,updated_at)
       VALUES (?,?,?,'month','pending_charge',0,?,?)`,
    ).run(FAMILY_ID, PARENT_ID, customerKey, now.toISOString(), now.toISOString());
    db.sqlite.prepare(
      `INSERT INTO web_billing_checkout_sessions
         (id,family_id,parent_id,customer_key,plan,amount,status,expires_at,created_at,updated_at)
       VALUES (?,?,?,?,'month',4900,'pending','2026-08-01T09:00:00.000Z',?,?)`,
    ).run(sessionId, FAMILY_ID, PARENT_ID, customerKey, now.toISOString(), now.toISOString());
    db.sqlite.prepare(
      `INSERT INTO web_billing_charge_attempts
         (order_id,family_id,checkout_session_id,plan,amount,kind,period_start,period_end,
          status,payment_key_hash,created_at,completed_at,updated_at)
       VALUES (?,?,?,'month',4900,'initial','2026-08-01 08:00:00+00',
               '2026-09-01 08:00:00+00','done',?,?,?,?)`,
    ).run(orderId, FAMILY_ID, sessionId, paymentHash, now.toISOString(), now.toISOString(), now.toISOString());
    db.sqlite.prepare(
      `INSERT INTO billing_provider_reservations
         (family_id,provider,state,reservation_ref,created_at,updated_at)
       VALUES (?,'toss_web','reserved',?,?,?)`,
    ).run(FAMILY_ID, sessionId, now.toISOString(), now.toISOString());
    const states = new Map([[orderId, refundPayment(orderId, 4_900, 4_900, paymentKey)]]);
    const provider = refundAwareProvider([], states);
    const result = await processWebBillingRenewals(env(db), {
      mode: "initial",
      limit: 1,
      now: new Date("2026-08-01T08:01:00.000Z"),
      fetchImpl: provider,
    });
    assert.equal(result.initialActivated, 0);
    assert.equal(db.row(
      "SELECT status FROM web_billing_customers WHERE family_id=?",
      FAMILY_ID,
    ).status, "expired");
    assert.equal(db.row(
      "SELECT COUNT(*) AS count FROM family_subscription WHERE family_id=?",
      FAMILY_ID,
    ).count, 0);
    assert.equal(db.row(
      "SELECT refund_status FROM web_billing_charge_attempts WHERE order_id=?",
      orderId,
    ).refund_status, "full");
  } finally {
    db.close();
  }
});

test("로컬 done 뒤 finalize 전에 갱신 환불이 확인되면 새 기간을 열지 않고 종료된 이전 권리와 재청구를 닫는다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    const requests = [];
    const chargeAt = new Date("2026-08-01T09:00:00.000Z");
    const provider = refundAwareProvider(requests, states);
    const routes = createWebBillingRoutes({ fetchImpl: provider, now: () => chargeAt });
    const bindings = env(db);
    const initial = await activatePaidSubscription(routes, bindings, "month");
    const customer = db.row(
      `SELECT customer_key,current_period_end,failure_count,last_paid_order_id
         FROM web_billing_customers WHERE family_id=?`,
      FAMILY_ID,
    );
    const renewalStart = new Date(
      String(customer.current_period_end).replace(" ", "T").replace(/\+00$/, "+00:00"),
    );
    const renewalEnd = addWebBillingPeriod(renewalStart, "month");
    const orderId = await createWebBillingOrderId(
      "renewal",
      `${FAMILY_ID}:${customer.current_period_end}:${customer.failure_count}`,
    );
    const paymentKey = `payment-${orderId}`;
    const paymentHash = await hashWebBillingPaymentKey(paymentKey);
    db.sqlite.prepare(
      `INSERT INTO web_billing_charge_attempts
         (order_id,family_id,customer_key,plan,amount,kind,period_start,period_end,
          status,payment_key_hash,created_at,completed_at,updated_at)
       VALUES (?,?,?,'month',4900,'renewal',?,?,'done',?,?,?,?)`,
    ).run(
      orderId,
      FAMILY_ID,
      customer.customer_key,
      customer.current_period_end,
      renewalEnd.toISOString().replace("T", " ").replace("Z", "+00"),
      paymentHash,
      renewalStart.toISOString(),
      renewalStart.toISOString(),
      renewalStart.toISOString(),
    );
    states.set(orderId, refundPayment(orderId, 4_900, 4_900, paymentKey));

    const result = await processWebBillingRenewals(bindings, {
      mode: "renewal",
      limit: 1,
      now: renewalStart,
      fetchImpl: provider,
    });
    assert.equal(result.renewed, 0);
    assert.equal(db.row(
      "SELECT refund_status FROM web_billing_charge_attempts WHERE order_id=?",
      orderId,
    ).refund_status, "full");
    assert.deepEqual({ ...db.row(
      "SELECT status,next_charge_at,last_paid_order_id FROM web_billing_customers WHERE family_id=?",
      FAMILY_ID,
    ) }, {
      status: "expired",
      next_charge_at: null,
      last_paid_order_id: initial.order_id,
    });
    assert.deepEqual({ ...db.row(
      "SELECT status,latest_order_id,current_period_end FROM family_subscription WHERE family_id=?",
      FAMILY_ID,
    ) }, {
      status: "expired",
      latest_order_id: initial.order_id,
      current_period_end: customer.current_period_end,
    });
    assert.equal(db.row(
      "SELECT state FROM billing_provider_reservations WHERE family_id=?",
      FAMILY_ID,
    ).state, "released");
  } finally {
    db.close();
  }
});

test("계정 삭제 직전 누락된 Toss 환불은 운영 주문 삭제 전에 provider 재조회로 금융 증적을 남긴다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    const provider = refundAwareProvider([], states);
    const routes = createWebBillingRoutes({ fetchImpl: provider });
    const bindings = env(db);
    const attempt = await activatePaidSubscription(routes, bindings, "month");
    states.set(attempt.order_id, refundPayment(attempt.order_id, attempt.amount, attempt.amount));
    await revokeWebBillingBeforeAccountDeletion(bindings, {
      ownerUserId: PARENT_ID,
      familyIds: [FAMILY_ID],
      now: new Date("2026-08-02T06:00:00.000Z"),
      fetchImpl: provider,
    });
    assert.equal(db.row(
      "SELECT refund_status FROM web_billing_charge_attempts WHERE order_id=?",
      attempt.order_id,
    ).refund_status, "full");
    assert.equal(db.row(
      "SELECT COUNT(*) AS count FROM web_billing_refund_records WHERE provider_reference=?",
      attempt.order_id,
    ).count, 1);
  } finally {
    db.close();
  }
});

test("계정 삭제 claim이 먼저면 Toss 환불 webhook은 provider 조회 없이 503으로 재시도시킨다", async () => {
  const db = createDb();
  try {
    const states = new Map();
    let providerLookups = 0;
    const baseProvider = refundAwareProvider([], states);
    const provider = async (url, init) => {
      if (String(url).includes("/v1/payments/orders/")) providerLookups += 1;
      return baseProvider(url, init);
    };
    const routes = createWebBillingRoutes({ fetchImpl: provider });
    const bindings = env(db);
    const attempt = await activatePaidSubscription(routes, bindings, "month");
    states.set(attempt.order_id, refundPayment(attempt.order_id, attempt.amount, attempt.amount));
    db.sqlite.prepare(
      `INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at)
       VALUES ('delete-job-webhook','family',?,'2026-08-02T00:00:00.000Z')`,
    ).run(FAMILY_ID);
    const before = providerLookups;
    const response = await jsonRequest(routes, bindings, "/web/subscription/webhook", {
      method: "POST",
      authorization: "",
      body: { eventType: "PAYMENT_STATUS_CHANGED", data: { orderId: attempt.order_id } },
    });
    assert.equal(response.response.status, 503);
    assert.equal(providerLookups, before);
    assert.equal(db.row(
      "SELECT refund_status FROM web_billing_charge_attempts WHERE order_id=?",
      attempt.order_id,
    ).refund_status, "none");
  } finally {
    db.close();
  }
});

test("웹 구독 금융 보존 migration이 빠지면 계정 삭제는 provider 호출과 데이터 삭제 전에 닫힌다", async () => {
  const db = createDb();
  try {
    const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
    const bindings = env(db);
    const checkout = await createCheckout(routes, bindings, "month");
    const completed = await jsonRequest(routes, bindings, "/web/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        sessionId: checkout.sessionId,
        customerKey: checkout.customerKey,
        authKey: "missing-retention-schema-auth-key",
      },
    });
    assert.equal(completed.response.status, 200);
    db.exec("DROP TABLE web_billing_financial_records");
    let providerCalls = 0;
    await assert.rejects(
      revokeWebBillingBeforeAccountDeletion(bindings, {
        ownerUserId: PARENT_ID,
        familyIds: [FAMILY_ID],
        now: new Date("2026-08-02T03:00:00.000Z"),
        fetchImpl: async () => {
          providerCalls += 1;
          return new Response(null, { status: 200 });
        },
      }),
      /web_billing_financial_retention_schema_unavailable/,
    );
    assert.equal(providerCalls, 0);
    assert.notEqual(
      db.row("SELECT billing_key_ciphertext AS value FROM web_billing_customers WHERE family_id=?", FAMILY_ID).value,
      null,
    );
    assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "active");
  } finally {
    db.close();
  }
});

test("계정 삭제 대사에서 Google 활성 중 Toss 결제가 확인되면 환불 필요 conflict를 영구 기록한다", async () => {
  const db = createDb();
  try {
    const routes = createWebBillingRoutes({ fetchImpl: successProvider([]) });
    const bindings = env(db);
    const checkout = await createCheckout(routes, bindings, "month");
    const completed = await jsonRequest(routes, bindings, "/web/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        sessionId: checkout.sessionId,
        customerKey: checkout.customerKey,
        authKey: "delete-conflict-auth-key",
      },
    });
    assert.equal(completed.response.status, 200);
    db.sqlite.prepare(
      `UPDATE family_subscription
          SET provider='google_play',purchase_token_hash='google-active-hash',
              latest_order_id='GPA.active',last_event_id='google-active-event'
        WHERE family_id=?`,
    ).run(FAMILY_ID);
    db.sqlite.prepare(
      `UPDATE billing_provider_reservations
          SET provider='google_play',state='active',reservation_ref='google-active',
              conflicting_provider=NULL,conflict_ref=NULL,conflict_reason=NULL,
              resolution_status=NULL
        WHERE family_id=?`,
    ).run(FAMILY_ID);
    const orderId = "HYENI-R-delete-google-conflict";
    db.sqlite.prepare(
      `INSERT INTO web_billing_charge_attempts
         (order_id,family_id,checkout_session_id,plan,amount,kind,period_start,period_end,
          status,created_at,updated_at)
       VALUES (?, ?,NULL,'month',4900,'renewal',?,?, 'unknown',?,?)`,
    ).run(
      orderId,
      FAMILY_ID,
      "2026-09-01 00:00:00+00",
      "2026-10-01 00:00:00+00",
      "2026-08-02 00:00:00+00",
      "2026-08-02 00:00:00+00",
    );
    let providerCalls = 0;
    const provider = async (url, init = {}) => {
      providerCalls += 1;
      if ((init.method ?? "GET") === "GET" && String(url).includes("/v1/payments/orders/")) {
        return Response.json(payment(orderId, checkout.customerKey, 4_900));
      }
      throw new Error("unexpected_provider_request");
    };
    await assert.rejects(
      revokeWebBillingBeforeAccountDeletion(bindings, {
        ownerUserId: PARENT_ID,
        familyIds: [FAMILY_ID],
        now: new Date("2026-08-02T04:00:00.000Z"),
        fetchImpl: provider,
      }),
      /web_billing_account_deletion_provider_conflict_unresolved/,
    );
    assert.deepEqual({ ...db.row(
      `SELECT provider,state,conflicting_provider,conflict_ref,conflict_reason,resolution_status
         FROM billing_provider_reservations WHERE family_id=?`,
      FAMILY_ID,
    ) }, {
      provider: "google_play",
      state: "conflict",
      conflicting_provider: "toss_web",
      conflict_ref: orderId,
      conflict_reason: "toss_charge_after_google_activation",
      resolution_status: "refund_required",
    });
    await assert.rejects(
      revokeWebBillingBeforeAccountDeletion(bindings, {
        ownerUserId: PARENT_ID,
        familyIds: [FAMILY_ID],
        now: new Date("2026-08-02T04:01:00.000Z"),
        fetchImpl: provider,
      }),
      /web_billing_account_deletion_provider_conflict_unresolved/,
    );
    assert.equal(providerCalls, 1, "retry가 conflict 주문을 다시 조회하거나 billingKey를 폐기하면 안 됩니다");
    assert.notEqual(
      db.row("SELECT billing_key_ciphertext AS value FROM web_billing_customers WHERE family_id=?", FAMILY_ID).value,
      null,
    );
    assert.equal(db.row("SELECT COUNT(*) AS count FROM web_billing_financial_records").count, 0);
  } finally {
    db.close();
  }
});
