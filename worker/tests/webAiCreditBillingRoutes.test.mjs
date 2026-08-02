import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import "./helpers/tsModuleResolve.mjs";
import { exportJWK, generateKeyPair } from "jose";

const FAMILY_ID = "family-ai-credit";
const PARENT_ID = "parent-ai-credit";
const OTHER_PARENT_ID = "other-parent";
const CHILD_ID = "child-ai-credit";

const { createWebAiCreditBillingRoutes } = await import("../routes/web-ai-credit-billing.ts");
const { cleanupWebAiCreditOrders, processWebAiCreditReconciliations } = await import("../lib/webAiCreditBillingService.ts");
const { signAccessToken } = await import("../lib/jwt.ts");
class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
  }

  exec(sql) { this.sqlite.exec(sql); }

  prepare(sql, bindings = []) {
    const db = this;
    return {
      bind(...next) { return db.prepare(sql, next); },
      async run() {
        const values = bindings.map((value) => value === undefined ? null : value);
        const result = db.sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async first() {
        const values = bindings.map((value) => value === undefined ? null : value);
        return db.sqlite.prepare(sql).get(...values) ?? null;
      },
      async all() {
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

  row(sql, ...values) { return this.sqlite.prepare(sql).get(...values) ?? null; }
  close() { this.sqlite.close(); }
}

function createDb() {
  const db = new SqliteD1();
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE families(
      id TEXT PRIMARY KEY,parent_id TEXT NOT NULL,user_tier TEXT,subscription_tier TEXT,created_at TEXT
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,family_id TEXT NOT NULL,user_id TEXT,role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT,last_selected_at TEXT
    );
    CREATE TABLE family_subscription(
      family_id TEXT PRIMARY KEY,status TEXT NOT NULL,trial_ends_at TEXT,current_period_end TEXT,
      remote_listen_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE subscriptions(id TEXT PRIMARY KEY,family_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE family_review_rewards(family_id TEXT PRIMARY KEY,granted_at TEXT);
    CREATE TABLE account_deletion_scopes(
      job_id TEXT NOT NULL,scope_type TEXT NOT NULL,scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL,PRIMARY KEY(scope_type,scope_id)
    );
    CREATE TABLE account_mutation_leases(
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,family_id TEXT,expires_at TEXT NOT NULL,created_at TEXT NOT NULL
    );
    CREATE TABLE family_unpair_cleanup_jobs(family_id TEXT NOT NULL,child_user_id TEXT NOT NULL);
    CREATE TABLE ai_credit_balances(
      id TEXT PRIMARY KEY,family_id TEXT NOT NULL,child_user_id TEXT NOT NULL,parent_id TEXT,
      is_premium INTEGER DEFAULT 0 NOT NULL,daily_included_limit INTEGER DEFAULT 5 NOT NULL,
      daily_included_used INTEGER DEFAULT 0 NOT NULL,daily_reset_date TEXT NOT NULL,
      purchased_credits INTEGER DEFAULT 0 NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_ai_credit_balances_family_child_unique
      ON ai_credit_balances(family_id,child_user_id);
    CREATE TABLE ai_credit_ledger(
      id TEXT PRIMARY KEY,family_id TEXT NOT NULL,child_user_id TEXT NOT NULL,parent_id TEXT,
      delta INTEGER NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,message_id TEXT,
      transaction_id TEXT,created_at TEXT NOT NULL
    );
    CREATE TABLE app_global_settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(readFileSync(new URL("../db/web-ai-credit-billing.sql", import.meta.url), "utf8"));
  db.sqlite.prepare("INSERT INTO users(id) VALUES (?),(?),(?)").run(
    PARENT_ID,
    OTHER_PARENT_ID,
    CHILD_ID,
  );
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

function bindings(db, overrides = {}) {
  return {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    TOSS_PAYMENTS_CLIENT_KEY: "test_ck_1234567890",
    TOSS_PAYMENTS_SECRET_KEY: "test_sk_1234567890",
    TOSS_AI_CREDIT_30_AMOUNT_KRW: "12345",
    FAMILY_ROOM: {
      idFromName(value) { return value; },
      get() { return { async fetch() { return new Response(null, { status: 204 }); } }; },
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

async function request(routes, env, path, input = {}) {
  const method = input.method ?? "GET";
  const response = await routes.request(`https://local.test${path}`, {
    method,
    headers: {
      ...(input.public ? {} : { Authorization: input.authorization ?? await auth() }),
      ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(input.body ?? {}) }),
  }, env);
  return { response, body: await response.json() };
}

function providerPayment(order, paymentKey = "payment-ai-credit-1") {
  return {
    paymentKey,
    orderId: order.order_id,
    status: "DONE",
    type: "NORMAL",
    currency: "KRW",
    totalAmount: order.amount,
  };
}

async function checkout(routes, env) {
  const result = await request(routes, env, "/web/ai-credits/checkout-session", {
    method: "POST",
    body: {
      familyId: FAMILY_ID,
      childUserId: CHILD_ID,
      productCode: "ai-credit-30",
      amount: 1,
      currency: "USD",
    },
  });
  assert.equal(result.response.status, 200);
  return result.body;
}

test("카탈로그는 활성 부모에게만 환경에서 확정된 팩을 노출하고 미설정 가격은 숨긴다", async () => {
  const db = createDb();
  try {
    const routes = createWebAiCreditBillingRoutes();
    const catalog = await request(routes, bindings(db), `/web/ai-credits/catalog?familyId=${FAMILY_ID}`);
    assert.equal(catalog.response.status, 200);
    assert.deepEqual(catalog.body.packs, [{
      productCode: "ai-credit-30",
      credits: 30,
      amount: 12_345,
      displayPrice: "12,345원",
    }]);

    const forbidden = await request(routes, bindings(db), `/web/ai-credits/catalog?familyId=${FAMILY_ID}`, {
      authorization: await auth(OTHER_PARENT_ID),
    });
    assert.equal(forbidden.response.status, 403);

    const unconfigured = await request(routes, bindings(db, {
      TOSS_AI_CREDIT_30_AMOUNT_KRW: undefined,
    }), `/web/ai-credits/catalog?familyId=${FAMILY_ID}`);
    assert.equal(unconfigured.body.configured, false);
    assert.deepEqual(unconfigured.body.packs, []);
  } finally {
    db.close();
  }
});

test("웹 AI 크레딧 신규 결제 중지는 catalog과 checkout만 503으로 닫고 주문을 만들지 않는다", async () => {
  const db = createDb();
  try {
    setCommerceControls(db, { webAiCreditNewCheckoutsEnabled: false });
    const routes = createWebAiCreditBillingRoutes();
    const env = bindings(db);

    const catalog = await request(routes, env, `/web/ai-credits/catalog?familyId=${FAMILY_ID}`);
    assert.equal(catalog.response.status, 503);
    assert.equal(catalog.body.error, "web_ai_credit_new_checkouts_paused");
    assert.equal(catalog.response.headers.get("Cache-Control"), "no-store");
    assert.equal(catalog.response.headers.get("Retry-After"), "300");

    const checkoutResult = await request(routes, env, "/web/ai-credits/checkout-session", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        productCode: "ai-credit-30",
      },
    });
    assert.equal(checkoutResult.response.status, 503);
    assert.equal(checkoutResult.body.error, "web_ai_credit_new_checkouts_paused");
    assert.equal(checkoutResult.response.headers.get("Cache-Control"), "no-store");
    assert.equal(checkoutResult.response.headers.get("Retry-After"), "300");
    assert.equal(db.row("SELECT COUNT(*) AS n FROM web_ai_credit_orders").n, 0);
  } finally {
    db.close();
  }
});

test("웹 AI 크레딧 신규 결제 중지 뒤에도 이미 만든 주문 complete는 계속된다", async () => {
  const db = createDb();
  try {
    let order;
    const routes = createWebAiCreditBillingRoutes({
      fetchImpl: async () => Response.json(providerPayment(order, "payment-paused-complete")),
    });
    const env = bindings(db);
    const created = await checkout(routes, env);
    order = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId);

    setCommerceControls(db, { webAiCreditNewCheckoutsEnabled: false });
    const completed = await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
        paymentKey: "payment-paused-complete",
        amount: created.amount,
      },
    });
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.status, "done");
    assert.equal(
      db.row("SELECT status FROM web_ai_credit_orders WHERE order_id=?", created.orderId).status,
      "done",
    );
  } finally {
    db.close();
  }
});

test("웹 AI 크레딧 신규 결제 중지 뒤에도 이미 만든 주문 reconcile은 계속된다", async () => {
  const db = createDb();
  try {
    let order;
    const routes = createWebAiCreditBillingRoutes({
      fetchImpl: async () => Response.json(providerPayment(order, "payment-paused-reconcile")),
    });
    const env = bindings(db);
    const created = await checkout(routes, env);
    order = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId);

    setCommerceControls(db, { webAiCreditNewCheckoutsEnabled: false });
    const reconciled = await request(routes, env, "/web/ai-credits/reconcile", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
      },
    });
    assert.equal(reconciled.response.status, 200);
    assert.equal(reconciled.body.status, "done");
    assert.equal(
      db.row("SELECT status FROM web_ai_credit_orders WHERE order_id=?", created.orderId).status,
      "done",
    );
  } finally {
    db.close();
  }
});

test("브라우저 pending 유실은 kill switch와 무관하게 현재 부모 주문 정본을 복구한 뒤 기존 complete로 완료한다", async () => {
  const db = createDb();
  try {
    let order;
    let providerCalls = 0;
    const routes = createWebAiCreditBillingRoutes({
      fetchImpl: async () => {
        providerCalls += 1;
        return Response.json(providerPayment(order, "payment-storage-loss"));
      },
    });
    const env = bindings(db);
    const created = await checkout(routes, env);
    order = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId);
    setCommerceControls(db, { webAiCreditNewCheckoutsEnabled: false });

    const recovered = await request(routes, env, "/web/ai-credits/checkout-session/resolve", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
        amount: created.amount,
      },
    });
    assert.equal(recovered.response.status, 200);
    assert.deepEqual(recovered.body, {
      familyId: FAMILY_ID,
      childUserId: CHILD_ID,
      orderId: created.orderId,
      customerKey: created.customerKey,
      productCode: "ai-credit-30",
      credits: 30,
      amount: 12_345,
      currency: "KRW",
      expiresAt: created.expiresAt,
    });
    assert.equal(recovered.response.headers.get("Cache-Control"), "no-store");
    assert.equal(providerCalls, 0);

    const completed = await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: recovered.body.orderId,
        paymentKey: "payment-storage-loss",
        amount: recovered.body.amount,
      },
    });
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.status, "done");
    assert.equal(providerCalls, 1);
    assert.equal(db.row("SELECT COUNT(*) AS n FROM ai_credit_ledger").n, 1);
  } finally {
    db.close();
  }
});

test("주문 정본 복구는 타 부모·가족·아이·금액과 실패·분리 주문을 모두 fail-closed한다", async () => {
  const db = createDb();
  try {
    let providerCalls = 0;
    const routes = createWebAiCreditBillingRoutes({
      fetchImpl: async () => {
        providerCalls += 1;
        throw new Error("provider_must_not_be_called");
      },
    });
    const env = bindings(db);
    const created = await checkout(routes, env);
    db.sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1,?,NULL)").run(
      "member-co-parent",
      FAMILY_ID,
      OTHER_PARENT_ID,
      "parent",
      "2026-08-01 00:00:00+00",
    );
    db.sqlite.prepare("INSERT INTO users(id) VALUES (?)").run("child-other");
    db.sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1,?,NULL)").run(
      "member-child-other",
      FAMILY_ID,
      "child-other",
      "child",
      "2026-08-01 00:00:00+00",
    );
    db.sqlite.prepare("INSERT INTO families VALUES (?,?,?,?,?)").run(
      "family-other",
      PARENT_ID,
      "free",
      "free",
      "2026-08-01 00:00:00+00",
    );
    db.sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1,?,NULL)").run(
      "member-parent-other-family",
      "family-other",
      PARENT_ID,
      "parent",
      "2026-08-01 00:00:00+00",
    );

    const baseBody = {
      familyId: FAMILY_ID,
      childUserId: CHILD_ID,
      orderId: created.orderId,
      amount: created.amount,
    };
    const deniedInputs = [
      { body: { ...baseBody, familyId: "family-other" } },
      { body: { ...baseBody, childUserId: "child-other" } },
      { body: { ...baseBody, amount: created.amount + 1 } },
      { body: baseBody, authorization: await auth(OTHER_PARENT_ID) },
    ];
    for (const denied of deniedInputs) {
      const result = await request(routes, env, "/web/ai-credits/checkout-session/resolve", {
        method: "POST",
        ...denied,
      });
      assert.equal(result.response.status, 404);
      assert.equal(result.body.error, "web_ai_credit_order_not_found");
    }

    db.sqlite.prepare("UPDATE web_ai_credit_orders SET status='failed' WHERE order_id=?").run(created.orderId);
    const failed = await request(routes, env, "/web/ai-credits/checkout-session/resolve", {
      method: "POST",
      body: baseBody,
    });
    assert.equal(failed.response.status, 404);

    db.sqlite.prepare(
      `UPDATE web_ai_credit_orders
          SET status='pending',record_scope='detached',balance_scope='detached',
              detach_reason='child_unpaired',detached_at=CURRENT_TIMESTAMP
        WHERE order_id=?`,
    ).run(created.orderId);
    const detached = await request(routes, env, "/web/ai-credits/checkout-session/resolve", {
      method: "POST",
      body: baseBody,
    });
    assert.equal(detached.response.status, 404);
    assert.equal(providerCalls, 0);
  } finally {
    db.close();
  }
});

test("checkout은 클라이언트 가격을 무시하고 서버 KRW 주문을 만든다", async () => {
  const db = createDb();
  try {
    const routes = createWebAiCreditBillingRoutes();
    const result = await checkout(routes, bindings(db));
    assert.equal(result.amount, 12_345);
    assert.equal(result.currency, "KRW");
    assert.equal(result.credits, 30);
    const row = db.row("SELECT amount,currency,credits FROM web_ai_credit_orders WHERE order_id=?", result.orderId);
    assert.deepEqual({ ...row }, { amount: 12_345, currency: "KRW", credits: 30 });
  } finally {
    db.close();
  }
});

test("승인 성공은 원장·잔액을 원자적으로 한 번만 반영하고 paymentKey 원문을 저장하지 않는다", async () => {
  const db = createDb();
  try {
    let order;
    const providerCalls = [];
    const fetchImpl = async (url, init = {}) => {
      providerCalls.push({ url: String(url), method: init.method, body: String(init.body ?? "") });
      assert.equal(String(url).endsWith("/v1/payments/confirm"), true);
      assert.match(String(init.headers?.["Idempotency-Key"]), /^[0-9a-f-]{36}$/);
      return Response.json(providerPayment(order));
    };
    const routes = createWebAiCreditBillingRoutes({ fetchImpl });
    const env = bindings(db);
    const created = await checkout(routes, env);
    order = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId);
    const input = {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
        paymentKey: "payment-ai-credit-1",
        amount: created.amount,
      },
    };
    const first = await request(routes, env, "/web/ai-credits/complete", input);
    assert.equal(first.response.status, 200);
    assert.equal(first.body.credits, 30);
    const second = await request(routes, env, "/web/ai-credits/complete", input);
    assert.equal(second.response.status, 200);
    assert.equal(providerCalls.length, 1);
    assert.equal(db.row("SELECT COUNT(*) AS n FROM ai_credit_ledger").n, 1);
    assert.equal(db.row("SELECT purchased_credits FROM ai_credit_balances").purchased_credits, 30);
    const stored = db.row("SELECT payment_key_hash FROM web_ai_credit_orders WHERE order_id=?", created.orderId);
    assert.notEqual(stored.payment_key_hash, "payment-ai-credit-1");
    assert.equal(JSON.stringify(db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId)).includes("payment-ai-credit-1"), false);
  } finally {
    db.close();
  }
});

test("환불 부채가 있으면 새 팩에서 상계된 횟수와 실제 사용 가능 증가분을 완료 응답에 고정한다", async () => {
  const db = createDb();
  try {
    db.sqlite.prepare(
      `INSERT INTO ai_credit_balances
         (id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,
          daily_included_used,daily_reset_date,purchased_credits,updated_at)
       VALUES (?,?,?,?,0,5,0,'2026-08-01',-25,'2026-08-01 00:00:00+00')`,
    ).run("balance-debt", FAMILY_ID, CHILD_ID, PARENT_ID);
    let order;
    const routes = createWebAiCreditBillingRoutes({
      fetchImpl: async () => Response.json(providerPayment(order, "payment-debt-offset")),
    });
    const env = bindings(db);
    const created = await checkout(routes, env);
    order = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId);

    const completed = await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
        paymentKey: "payment-debt-offset",
        amount: created.amount,
      },
    });

    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.debtApplied, 25);
    assert.equal(completed.body.availableCreditsAdded, 5);
    assert.equal(completed.body.creditStatus.purchasedCredits, 5);
    assert.equal(completed.body.creditStatus.purchasedCreditDebt, 0);
    assert.deepEqual(
      { ...db.row(
        "SELECT debt_applied FROM web_ai_credit_orders WHERE order_id=?",
        created.orderId,
      ) },
      { debt_applied: 25 },
    );
  } finally {
    db.close();
  }
});

test("승인 응답 유실 뒤 order 조회가 성공하면 같은 요청에서 복구하고 중복 부여하지 않는다", async () => {
  const db = createDb();
  try {
    let order;
    let calls = 0;
    const fetchImpl = async (url) => {
      calls += 1;
      if (String(url).endsWith("/v1/payments/confirm")) throw new Error("timeout");
      return Response.json(providerPayment(order, "payment-after-timeout"));
    };
    const routes = createWebAiCreditBillingRoutes({ fetchImpl });
    const env = bindings(db);
    const created = await checkout(routes, env);
    order = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId);
    const completed = await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
        paymentKey: "payment-after-timeout",
        amount: created.amount,
      },
    });
    assert.equal(completed.response.status, 200);
    assert.equal(calls, 2);
    assert.equal(db.row("SELECT purchased_credits FROM ai_credit_balances").purchased_credits, 30);
  } finally {
    db.close();
  }
});

test("redirect 금액 변조는 결제사 호출 전에 거부하고 unsigned webhook 본문만으로는 부여하지 않는다", async () => {
  const db = createDb();
  try {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(JSON.stringify({ code: "NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    };
    const routes = createWebAiCreditBillingRoutes({ fetchImpl });
    const env = bindings(db);
    const created = await checkout(routes, env);
    const tampered = await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
        paymentKey: "payment-ai-credit-1",
        amount: 1,
      },
    });
    assert.equal(tampered.response.status, 400);
    assert.equal(calls, 0);

    const webhook = await request(routes, env, "/web/ai-credits/webhook", {
      method: "POST",
      public: true,
      body: {
        eventType: "PAYMENT_STATUS_CHANGED",
        data: {
          orderId: created.orderId,
          paymentKey: "forged-payment-key",
          status: "DONE",
          amount: 12_345,
        },
      },
    });
    assert.equal(webhook.response.status, 503);
    assert.equal(calls, 1);
    assert.equal(db.row("SELECT COUNT(*) AS n FROM ai_credit_ledger").n, 0);
  } finally {
    db.close();
  }
});

test("같은 PAYMENT_STATUS_CHANGED를 받은 다른 상품 endpoint는 미소유 주문을 200으로 ACK한다", async () => {
  const db = createDb();
  try {
    let providerCalls = 0;
    const routes = createWebAiCreditBillingRoutes({
      fetchImpl: async () => {
        providerCalls += 1;
        throw new Error("provider_must_not_be_called");
      },
    });
    const response = await request(routes, bindings(db), "/web/ai-credits/webhook", {
      method: "POST",
      public: true,
      body: {
        eventType: "PAYMENT_STATUS_CHANGED",
        data: { orderId: "HYENI-I-subscription-order-123456" },
      },
    });
    assert.equal(response.response.status, 200);
    assert.deepEqual(response.body, { ok: true, accepted: false });
    assert.equal(providerCalls, 0);
  } finally {
    db.close();
  }
});

test("재사용 주문은 환경 가격이 바뀌어도 최초 order.amount 스냅샷을 표시한다", async () => {
  const db = createDb();
  try {
    const routes = createWebAiCreditBillingRoutes();
    const first = await checkout(routes, bindings(db));
    const second = await request(routes, bindings(db, {
      TOSS_AI_CREDIT_30_AMOUNT_KRW: "54321",
    }), "/web/ai-credits/checkout-session", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        productCode: "ai-credit-30",
      },
    });
    assert.equal(second.response.status, 200);
    assert.equal(second.body.orderId, first.orderId);
    assert.equal(second.body.amount, 12_345);
    assert.equal(second.body.displayPrice, "12,345원");
  } finally {
    db.close();
  }
});

test("전액 환불 webhook 재시도·동시성에서도 refund 원장을 한 번만 쓰고 사용분은 debt로 회수한다", async () => {
  const db = createDb();
  try {
    let order;
    let providerState = "paid";
    let lookupCalls = 0;
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/v1/payments/confirm")) {
        return Response.json(providerPayment(order, "payment-refundable"));
      }
      lookupCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json(providerState === "refunded"
        ? {
          ...providerPayment(order, "payment-refundable"),
          status: "CANCELED",
          balanceAmount: 0,
        }
        : providerPayment(order, "payment-refundable"));
    };
    const routes = createWebAiCreditBillingRoutes({ fetchImpl });
    const env = bindings(db);
    const created = await checkout(routes, env);
    order = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId);
    const completed = await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
        paymentKey: "payment-refundable",
        amount: created.amount,
      },
    });
    assert.equal(completed.response.status, 200);
    // 구매분 25회를 이미 사용한 상태를 재현한다. 환불 시 0으로 자르지 않고 -25 debt가 남아야 한다.
    db.sqlite.prepare("UPDATE ai_credit_balances SET purchased_credits=5").run();
    providerState = "refunded";
    const webhookInput = {
      method: "POST",
      public: true,
      body: { eventType: "PAYMENT_STATUS_CHANGED", data: { orderId: created.orderId } },
    };
    const concurrent = await Promise.all([
      request(routes, env, "/web/ai-credits/webhook", webhookInput),
      request(routes, env, "/web/ai-credits/webhook", webhookInput),
    ]);
    assert.ok(concurrent.some((result) => result.response.status === 200));
    const retried = await request(routes, env, "/web/ai-credits/webhook", webhookInput);
    assert.equal(retried.response.status, 200);
    assert.equal(lookupCalls, 1);
    assert.deepEqual(
      db.sqlite.prepare("SELECT delta FROM ai_credit_ledger ORDER BY created_at,id").all().map((row) => row.delta).sort((a, b) => b - a),
      [30, -30],
    );
    assert.equal(db.row("SELECT purchased_credits FROM ai_credit_balances").purchased_credits, -25);
    const refunded = db.row(
      "SELECT status,refunded_amount FROM web_ai_credit_orders WHERE order_id=?",
      created.orderId,
    );
    assert.deepEqual({ ...refunded }, { status: "refunded", refunded_amount: 12_345 });
  } finally {
    db.close();
  }
});

test("공개 webhook replay는 같은 주문의 결제사 조회를 냉각시간 안에 반복하지 않는다", async () => {
  const db = createDb();
  try {
    let order;
    let lookupCalls = 0;
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/v1/payments/confirm")) {
        return Response.json(providerPayment(order, "payment-webhook-replay"));
      }
      lookupCalls += 1;
      return Response.json(providerPayment(order, "payment-webhook-replay"));
    };
    const routes = createWebAiCreditBillingRoutes({ fetchImpl });
    const env = bindings(db);
    const created = await checkout(routes, env);
    order = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId);
    const completed = await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
        paymentKey: "payment-webhook-replay",
        amount: created.amount,
      },
    });
    assert.equal(completed.response.status, 200);

    const webhookInput = {
      method: "POST",
      public: true,
      body: {
        eventType: "PAYMENT_STATUS_CHANGED",
        data: { orderId: created.orderId, status: "DONE" },
      },
    };
    const first = await request(routes, env, "/web/ai-credits/webhook", webhookInput);
    const replay = await request(routes, env, "/web/ai-credits/webhook", webhookInput);

    assert.equal(first.response.status, 200);
    assert.equal(replay.response.status, 429);
    assert.equal(replay.body.deferred, true);
    assert.equal(lookupCalls, 1);
    assert.ok(db.row(
      "SELECT webhook_checked_at FROM web_ai_credit_orders WHERE order_id=?",
      created.orderId,
    ).webhook_checked_at);
  } finally {
    db.close();
  }
});

test("인증 complete와 reconcile replay도 같은 주문 냉각시간 동안 결제사를 다시 호출하지 않는다", async () => {
  const db = createDb();
  try {
    let providerCalls = 0;
    const routes = createWebAiCreditBillingRoutes({
      fetchImpl: async () => {
        providerCalls += 1;
        return Response.json({ code: "NOT_FOUND", message: "not found" }, { status: 404 });
      },
    });
    const env = bindings(db);
    const created = await checkout(routes, env);
    const input = {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
        paymentKey: "payment-client-replay",
        amount: created.amount,
      },
    };

    await request(routes, env, "/web/ai-credits/complete", input);
    const callsAfterFirst = providerCalls;
    const replay = await request(routes, env, "/web/ai-credits/complete", input);
    const reconcile = await request(routes, env, "/web/ai-credits/reconcile", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
      },
    });

    assert.ok(callsAfterFirst > 0);
    assert.equal(replay.response.status, 429);
    assert.equal(reconcile.response.status, 429);
    assert.equal(providerCalls, callsAfterFirst);
  } finally {
    db.close();
  }
});

test("냉각 중 공개 webhook은 만료 주문을 대사 후보 상태로 되살리지 않는다", async () => {
  const db = createDb();
  try {
    let providerCalls = 0;
    const routes = createWebAiCreditBillingRoutes({
      fetchImpl: async () => {
        providerCalls += 1;
        throw new Error("provider_must_not_be_called");
      },
    });
    const env = bindings(db);
    const created = await checkout(routes, env);
    db.sqlite.prepare(
      `UPDATE web_ai_credit_orders
          SET status='expired',webhook_checked_at=CURRENT_TIMESTAMP
        WHERE order_id=?`,
    ).run(created.orderId);

    const replay = await request(routes, env, "/web/ai-credits/webhook", {
      method: "POST",
      public: true,
      body: {
        eventType: "PAYMENT_STATUS_CHANGED",
        data: { orderId: created.orderId, status: "DONE" },
      },
    });

    assert.equal(replay.response.status, 429);
    assert.equal(providerCalls, 0);
    assert.equal(
      db.row("SELECT status FROM web_ai_credit_orders WHERE order_id=?", created.orderId).status,
      "expired",
    );
  } finally {
    db.close();
  }
});

test("가족별 결제사 조회는 UTC 시간당 30회에서 원자적으로 닫힌다", async () => {
  const db = createDb();
  try {
    let order;
    let lookupCalls = 0;
    const fixedNow = new Date("2026-08-01T04:30:00.000Z");
    const routes = createWebAiCreditBillingRoutes({
      now: () => fixedNow,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/v1/payments/confirm")) {
          return Response.json(providerPayment(order, "payment-family-rate"));
        }
        lookupCalls += 1;
        return Response.json(providerPayment(order, "payment-family-rate"));
      },
    });
    const env = bindings(db);
    const created = await checkout(routes, env);
    order = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId);
    const completed = await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
        paymentKey: "payment-family-rate",
        amount: created.amount,
      },
    });
    assert.equal(completed.response.status, 200);

    let limited = null;
    for (let index = 0; index < 30; index += 1) {
      db.sqlite.prepare(
        "UPDATE web_ai_credit_orders SET client_checked_at='2000-01-01 00:00:00+00' WHERE order_id=?",
      ).run(created.orderId);
      const result = await request(routes, env, "/web/ai-credits/reconcile", {
        method: "POST",
        body: {
          familyId: FAMILY_ID,
          childUserId: CHILD_ID,
          orderId: created.orderId,
        },
      });
      if (result.response.status === 429) {
        limited = result;
        break;
      }
    }

    assert.equal(limited?.body.error, "web_ai_credit_lookup_rate_limited");
    assert.equal(lookupCalls, 29);
    assert.deepEqual(
      { ...db.row(
        "SELECT attempts FROM web_ai_credit_lookup_windows WHERE family_id=?",
        FAMILY_ID,
      ) },
      { attempts: 30 },
    );
  } finally {
    db.close();
  }
});

test("부분 환불은 임의 비례 차감하지 않고 검증 대기 상태로 격리한다", async () => {
  const db = createDb();
  try {
    let order;
    let refunded = false;
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/v1/payments/confirm")) {
        return Response.json(providerPayment(order, "payment-partial"));
      }
      return Response.json(refunded
        ? {
          ...providerPayment(order, "payment-partial"),
          status: "PARTIAL_CANCELED",
          balanceAmount: 10_000,
        }
        : providerPayment(order, "payment-partial"));
    };
    const routes = createWebAiCreditBillingRoutes({ fetchImpl });
    const env = bindings(db);
    const created = await checkout(routes, env);
    order = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId);
    await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: created.orderId,
        paymentKey: "payment-partial",
        amount: created.amount,
      },
    });
    refunded = true;
    const webhook = await request(routes, env, "/web/ai-credits/webhook", {
      method: "POST",
      public: true,
      body: {
        eventType: "PAYMENT_STATUS_CHANGED",
        data: { orderId: created.orderId, status: "PARTIAL_CANCELED" },
      },
    });
    assert.equal(webhook.response.status, 200);
    const state = db.row(
      "SELECT status,refunded_amount,error_code FROM web_ai_credit_orders WHERE order_id=?",
      created.orderId,
    );
    assert.deepEqual({ ...state }, {
      status: "refund_unknown",
      refunded_amount: 2_345,
      error_code: "WEB_AI_CREDIT_PARTIAL_REFUND_REVIEW_REQUIRED",
    });
    assert.equal(db.row("SELECT COUNT(*) AS n FROM ai_credit_ledger").n, 1);
    assert.equal(db.row("SELECT purchased_credits FROM ai_credit_balances").purchased_credits, 30);
  } finally {
    db.close();
  }
});

test("정상 Payment webhook은 4KiB를 넘어도 처리하고 64KiB 초과 본문은 streaming 중단한다", async () => {
  const db = createDb();
  try {
    let order;
    let providerCalls = 0;
    const routes = createWebAiCreditBillingRoutes({
      fetchImpl: async () => {
        providerCalls += 1;
        return Response.json(providerPayment(order, "payment-large-webhook"));
      },
    });
    const env = bindings(db);
    const created = await checkout(routes, env);
    order = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", created.orderId);
    const accepted = await routes.request("https://local.test/web/ai-credits/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "PAYMENT_STATUS_CHANGED",
        createdAt: "2026-08-01T12:00:00+09:00",
        data: { orderId: created.orderId, metadata: { note: "x".repeat(6_000) } },
      }),
    }, env);
    assert.equal(accepted.status, 200);
    assert.equal(providerCalls, 1);

    const rejected = await routes.request("https://local.test/web/ai-credits/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "PAYMENT_STATUS_CHANGED",
        data: { orderId: created.orderId, padding: "x".repeat(65_536) },
      }),
    }, env);
    assert.equal(rejected.status, 413);
  } finally {
    db.close();
  }
});

test("주문 정리는 미승인 주문 30일·금융 정본 5년을 구분하고 미확정 행은 보존한다", async () => {
  const db = createDb();
  try {
    const routes = createWebAiCreditBillingRoutes();
    const env = bindings(db);
    const failed = await checkout(routes, env);
    db.sqlite.prepare(
      "UPDATE web_ai_credit_orders SET status='failed',created_at='2026-06-01 00:00:00+00' WHERE order_id=?",
    ).run(failed.orderId);
    const unknown = await checkout(routes, env);
    db.sqlite.prepare(
      "UPDATE web_ai_credit_orders SET status='unknown',created_at='2026-06-01 00:00:00+00' WHERE order_id=?",
    ).run(unknown.orderId);
    const result = await cleanupWebAiCreditOrders(db, new Date("2026-08-01T12:00:00.000Z"));
    assert.equal(result.removed, 1);
    assert.equal(db.row("SELECT status FROM web_ai_credit_orders WHERE order_id=?", failed.orderId), null);
    assert.equal(db.row("SELECT status FROM web_ai_credit_orders WHERE order_id=?", unknown.orderId).status, "unknown");
  } finally {
    db.close();
  }
});

test("fallback 대사는 완료 후 90일 이내 주문만 조회해 5년 금융 보관 행이 backlog를 만들지 않는다", async () => {
  const db = createDb();
  try {
    let providerOrder;
    let providerPaymentKey = "payment-fallback-old";
    let providerCalls = 0;
    const fetchImpl = async () => {
      providerCalls += 1;
      return Response.json(providerPayment(providerOrder, providerPaymentKey));
    };
    const routes = createWebAiCreditBillingRoutes({ fetchImpl });
    const env = bindings(db);

    const oldCreated = await checkout(routes, env);
    providerOrder = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", oldCreated.orderId);
    const oldDone = await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: oldCreated.orderId,
        paymentKey: "payment-fallback-old",
        amount: oldCreated.amount,
      },
    });
    assert.equal(oldDone.response.status, 200);

    const recentCreated = await checkout(routes, env);
    providerOrder = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", recentCreated.orderId);
    providerPaymentKey = "payment-fallback-recent";
    const recentDone = await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: recentCreated.orderId,
        paymentKey: "payment-fallback-recent",
        amount: recentCreated.amount,
      },
    });
    assert.equal(recentDone.response.status, 200);

    db.sqlite.prepare(
      `UPDATE web_ai_credit_orders
          SET completed_at='2026-04-01 00:00:00+00',retry_after='2026-07-01 00:00:00+00',
              provider_checked_at='old-marker'
        WHERE order_id=?`,
    ).run(oldCreated.orderId);
    db.sqlite.prepare(
      `UPDATE web_ai_credit_orders
          SET completed_at='2026-07-31 00:00:00+00',retry_after='2026-07-31 01:00:00+00',
              provider_checked_at='recent-marker'
        WHERE order_id=?`,
    ).run(recentCreated.orderId);
    providerOrder = db.row("SELECT * FROM web_ai_credit_orders WHERE order_id=?", recentCreated.orderId);
    providerCalls = 0;

    const result = await processWebAiCreditReconciliations(env, {
      now: new Date("2026-08-01T12:00:00.000Z"),
      fetchImpl,
      limit: 1,
    });
    assert.equal(result.checked, 1);
    assert.equal(result.dueRemaining, false);
    assert.equal(providerCalls, 1);
    assert.equal(
      db.row("SELECT provider_checked_at FROM web_ai_credit_orders WHERE order_id=?", oldCreated.orderId).provider_checked_at,
      "old-marker",
    );
    assert.notEqual(
      db.row("SELECT provider_checked_at FROM web_ai_credit_orders WHERE order_id=?", recentCreated.orderId).provider_checked_at,
      "recent-marker",
    );
  } finally {
    db.close();
  }
});

test("환불 대사 슬롯은 오래된 unknown 주문에 막히지 않고 완료 주문의 환불을 bounded batch로 확인한다", async () => {
  const db = createDb();
  try {
    let providerOrder;
    let refundLookup = false;
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/v1/payments/confirm")) {
        return Response.json(providerPayment(providerOrder, "payment-fair-refund"));
      }
      if (refundLookup && String(url).includes(providerOrder.order_id)) {
        return Response.json({
          ...providerPayment(providerOrder, "payment-fair-refund"),
          status: "CANCELED",
          balanceAmount: 0,
        });
      }
      return new Response(null, { status: 404 });
    };
    const routes = createWebAiCreditBillingRoutes({ fetchImpl });
    const env = bindings(db);

    const completedCheckout = await checkout(routes, env);
    providerOrder = db.row(
      "SELECT * FROM web_ai_credit_orders WHERE order_id=?",
      completedCheckout.orderId,
    );
    const completed = await request(routes, env, "/web/ai-credits/complete", {
      method: "POST",
      body: {
        familyId: FAMILY_ID,
        childUserId: CHILD_ID,
        orderId: completedCheckout.orderId,
        paymentKey: "payment-fair-refund",
        amount: completedCheckout.amount,
      },
    });
    assert.equal(completed.response.status, 200);

    const abandonedCheckout = await checkout(routes, env);
    db.sqlite.prepare(
      `UPDATE web_ai_credit_orders
          SET status='unknown',retry_after='2026-07-31 00:00:00+00',
              updated_at='2026-07-31 00:00:00+00'
        WHERE order_id=?`,
    ).run(abandonedCheckout.orderId);
    db.sqlite.prepare(
      `UPDATE web_ai_credit_orders
          SET retry_after='2026-08-01 10:00:00+00',
              completed_at='2026-08-01 09:00:00+00',updated_at='2026-08-01 10:00:00+00'
        WHERE order_id=?`,
    ).run(completedCheckout.orderId);
    providerOrder = db.row(
      "SELECT * FROM web_ai_credit_orders WHERE order_id=?",
      completedCheckout.orderId,
    );
    refundLookup = true;

    const result = await processWebAiCreditReconciliations(env, {
      now: new Date("2026-08-01T12:00:00.000Z"),
      fetchImpl,
      limit: 1,
      mode: "refund",
    });

    assert.equal(result.checked, 1);
    assert.equal(result.refunded, 1);
    assert.equal(
      db.row("SELECT status FROM web_ai_credit_orders WHERE order_id=?", completedCheckout.orderId).status,
      "refunded",
    );
    assert.equal(
      db.row("SELECT status FROM web_ai_credit_orders WHERE order_id=?", abandonedCheckout.orderId).status,
      "unknown",
    );
  } finally {
    db.close();
  }
});
