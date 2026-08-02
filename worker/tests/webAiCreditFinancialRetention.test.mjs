import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import "./helpers/tsModuleResolve.mjs";
const FAMILY_ID = "family-financial";
const PARENT_ID = "parent-financial";
const CO_PARENT_ID = "co-parent-financial";
const CHILD_ID = "child-financial";
const NOW = new Date("2026-08-01T12:00:00.000Z");

const {
  buildFamilyScopedDeleteStmts,
  buildFamilyUserReferenceDeleteStmts,
  buildUserReferenceDeleteStmts,
} = await import("../lib/accountDeletion.ts");
const {
  completeWebAiCreditOrder,
  loadWebAiCreditOrder,
  processWebAiCreditReconciliations,
  reconcileWebAiCreditOrder,
} = await import("../lib/webAiCreditBillingService.ts");
const { hashWebAiCreditPaymentKey } = await import("../shared/webAiCreditBilling.js");
class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
  }

  exec(sql) { this.sqlite.exec(sql); }

  prepare(sql, bindings = []) {
    const db = this;
    return {
      sql,
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
    CREATE TABLE families(id TEXT PRIMARY KEY,parent_id TEXT NOT NULL);
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,family_id TEXT NOT NULL,user_id TEXT,role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE family_subscription(
      family_id TEXT PRIMARY KEY,status TEXT NOT NULL,trial_ends_at TEXT,current_period_end TEXT,
      remote_listen_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE subscriptions(id TEXT PRIMARY KEY,family_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE family_review_rewards(family_id TEXT PRIMARY KEY,granted_at TEXT);
    CREATE TABLE account_deletion_jobs(id TEXT PRIMARY KEY);
    CREATE TABLE account_deletion_scopes(
      job_id TEXT NOT NULL,scope_type TEXT NOT NULL,scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL,PRIMARY KEY(scope_type,scope_id)
    );
    CREATE TABLE account_mutation_leases(
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,family_id TEXT,expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE family_unpair_cleanup_jobs(
      family_id TEXT NOT NULL,child_user_id TEXT NOT NULL
    );
    CREATE TABLE storage_invalid_upload_cleanup_jobs(
      family_id TEXT NOT NULL,user_id TEXT NOT NULL
    );
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
    CREATE TABLE ordinary_family_data(id TEXT PRIMARY KEY,family_id TEXT NOT NULL);
    CREATE TABLE ordinary_child_data(
      id TEXT PRIMARY KEY,family_id TEXT NOT NULL,child_user_id TEXT NOT NULL,parent_id TEXT
    );
  `);
  db.exec(readFileSync(new URL("../db/web-ai-credit-billing.sql", import.meta.url), "utf8"));
  db.sqlite.prepare("INSERT INTO users(id) VALUES (?),(?),(?)").run(
    PARENT_ID,
    CO_PARENT_ID,
    CHILD_ID,
  );
  db.sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run(FAMILY_ID, PARENT_ID);
  db.sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1)").run(
    "member-parent",
    FAMILY_ID,
    PARENT_ID,
    "parent",
  );
  db.sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1)").run(
    "member-child",
    FAMILY_ID,
    CHILD_ID,
    "child",
  );
  return db;
}

function seedBalance(db, purchasedCredits, parentId = PARENT_ID) {
  db.sqlite.prepare(
    `INSERT INTO ai_credit_balances
       (id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,
        daily_included_used,daily_reset_date,purchased_credits,updated_at)
     VALUES ('balance-financial',?,?,?,0,5,0,'2026-08-01',?,'2026-08-01 00:00:00+00')`,
  ).run(FAMILY_ID, CHILD_ID, parentId, purchasedCredits);
}

function seedGrantedOrder(db, input = {}) {
  const orderId = input.orderId ?? "HYENI-AI-financial-order";
  const parentId = input.parentId ?? PARENT_ID;
  const status = input.status ?? "done";
  const paymentKeyHash = input.paymentKeyHash ?? "financial-payment-hash";
  db.sqlite.prepare(
    `INSERT INTO web_ai_credit_orders
       (order_id,family_id,parent_id,child_user_id,customer_key,product_code,credits,
        amount,currency,status,expires_at,idempotency_key,payment_key_hash,
        created_at,updated_at,completed_at)
     VALUES (?,?,?,?,?,'ai-credit-30',30,12345,'KRW',?,
             '2026-08-01 13:00:00+00',?,?,
             '2026-08-01 00:00:00+00','2026-08-01 00:00:00+00',
             '2026-08-01 00:00:00+00')`,
  ).run(
    orderId,
    FAMILY_ID,
    parentId,
    CHILD_ID,
    `customer-${orderId}`,
    status,
    `idempotency-${orderId}`,
    paymentKeyHash,
  );
  db.sqlite.prepare(
    `INSERT INTO ai_credit_ledger
       (id,family_id,child_user_id,parent_id,delta,reason,source,transaction_id,created_at)
     VALUES (?,?,?,?,30,'purchase','parent_purchase',?,'2026-08-01 00:00:00+00')`,
  ).run(`ledger-${orderId}`, FAMILY_ID, CHILD_ID, parentId, orderId);
  return orderId;
}

function env(db, roomFetchCounter = { count: 0 }) {
  return {
    DB: db,
    TOSS_PAYMENTS_CLIENT_KEY: "test_ck_1234567890",
    TOSS_PAYMENTS_SECRET_KEY: "test_sk_1234567890",
    FAMILY_ROOM: {
      idFromName(value) { return value; },
      get() {
        return {
          async fetch() {
            roomFetchCounter.count += 1;
            return new Response(null, { status: 204 });
          },
        };
      },
    },
  };
}

function providerPayment(order, paymentKey, status, balanceAmount = undefined) {
  return {
    paymentKey,
    orderId: order.order_id,
    status,
    type: "NORMAL",
    currency: "KRW",
    totalAmount: order.amount,
    ...(balanceAmount === undefined ? {} : { balanceAmount }),
  };
}

test("가족 삭제는 주문과 signed 잔액을 분리 금융 정본으로 보존한 뒤 운영 행만 삭제한다", async () => {
  const db = createDb();
  try {
    const orderId = seedGrantedOrder(db);
    seedBalance(db, -7);
    db.sqlite.prepare("INSERT INTO ordinary_family_data VALUES ('ordinary-family',?)").run(FAMILY_ID);

    await db.batch(await buildFamilyScopedDeleteStmts(db, [FAMILY_ID]));

    assert.equal(db.row("SELECT * FROM ordinary_family_data"), null);
    assert.equal(db.row("SELECT * FROM ai_credit_balances"), null);
    assert.equal(db.row("SELECT * FROM ai_credit_ledger"), null);
    assert.deepEqual(
      { ...db.row(
        `SELECT record_scope,balance_scope,detach_reason,granted_credits,
                grant_committed_at,retention_until
           FROM web_ai_credit_orders WHERE order_id=?`,
        orderId,
      ) },
      {
        record_scope: "detached",
        balance_scope: "detached",
        detach_reason: "family_deleted",
        granted_credits: 30,
        grant_committed_at: "2026-08-01 00:00:00+00",
        retention_until: "2031-08-01 00:00:00",
      },
    );
    assert.deepEqual(
      { ...db.row(
        `SELECT purchased_credits,restoration_state
           FROM web_ai_credit_detached_balances
          WHERE family_id=? AND child_user_id=?`,
        FAMILY_ID,
        CHILD_ID,
      ) },
      { purchased_credits: -7, restoration_state: "closed" },
    );
  } finally {
    db.close();
  }
});

test("가족 삭제 시 늦은 웹 AI 환불은 환불 원장·provider 확인 시각부터 5년으로 보존 기한을 연장한다", async () => {
  const db = createDb();
  try {
    const ledgerRefundOrderId = seedGrantedOrder(db, {
      orderId: "HYENI-AI-late-ledger-refund",
      paymentKeyHash: "late-ledger-payment-hash",
    });
    const providerRefundOrderId = seedGrantedOrder(db, {
      orderId: "HYENI-AI-late-provider-refund",
      paymentKeyHash: "late-provider-payment-hash",
    });
    db.sqlite.prepare(
      `UPDATE web_ai_credit_orders
          SET status='refunded',provider_checked_at=?,retention_until=?
        WHERE order_id=?`,
    ).run(
      "2026-08-12 00:00:00+00",
      "2031-08-01 00:00:00",
      ledgerRefundOrderId,
    );
    db.sqlite.prepare(
      `INSERT INTO ai_credit_ledger
         (id,family_id,child_user_id,parent_id,delta,reason,source,transaction_id,created_at)
       VALUES (?,?,?,?, -30,'refund','parent_purchase',?,?)`,
    ).run(
      "ledger-refund-late",
      FAMILY_ID,
      CHILD_ID,
      PARENT_ID,
      ledgerRefundOrderId,
      "2026-08-10 00:00:00+00",
    );
    db.sqlite.prepare(
      `UPDATE web_ai_credit_orders
          SET status='refunded',provider_checked_at=?,retention_until=?
        WHERE order_id=?`,
    ).run(
      "2026-08-15 00:00:00+00",
      "2031-08-01 00:00:00",
      providerRefundOrderId,
    );

    await db.batch(await buildFamilyScopedDeleteStmts(db, [FAMILY_ID]));

    assert.deepEqual({ ...db.row(
      `SELECT refund_committed_at,retention_until
         FROM web_ai_credit_orders WHERE order_id=?`,
      ledgerRefundOrderId,
    ) }, {
      refund_committed_at: "2026-08-10 00:00:00+00",
      retention_until: "2031-08-10 00:00:00",
    });
    assert.deepEqual({ ...db.row(
      `SELECT refund_committed_at,retention_until
         FROM web_ai_credit_orders WHERE order_id=?`,
      providerRefundOrderId,
    ) }, {
      refund_committed_at: "2026-08-15 00:00:00+00",
      retention_until: "2031-08-15 00:00:00",
    });
  } finally {
    db.close();
  }
});

test("자녀 연결 해제는 금융 잔액을 격리하고 재연결 자동 복원을 blocked로 닫는다", async () => {
  const db = createDb();
  try {
    const orderId = seedGrantedOrder(db);
    seedBalance(db, 12);
    db.sqlite.prepare("INSERT INTO ordinary_child_data VALUES ('ordinary-child',?,?,?)").run(
      FAMILY_ID,
      CHILD_ID,
      PARENT_ID,
    );

    await db.batch(await buildFamilyUserReferenceDeleteStmts(db, FAMILY_ID, CHILD_ID));

    assert.equal(db.row("SELECT * FROM ordinary_child_data"), null);
    assert.equal(db.row("SELECT * FROM ai_credit_balances"), null);
    assert.equal(db.row("SELECT * FROM ai_credit_ledger"), null);
    assert.deepEqual(
      { ...db.row(
        "SELECT record_scope,balance_scope,detach_reason,granted_credits FROM web_ai_credit_orders WHERE order_id=?",
        orderId,
      ) },
      {
        record_scope: "detached",
        balance_scope: "detached",
        detach_reason: "child_unpaired",
        granted_credits: 30,
      },
    );
    assert.deepEqual(
      { ...db.row(
        `SELECT purchased_credits,restoration_state
           FROM web_ai_credit_detached_balances
          WHERE family_id=? AND child_user_id=?`,
        FAMILY_ID,
        CHILD_ID,
      ) },
      { purchased_credits: 12, restoration_state: "blocked" },
    );
  } finally {
    db.close();
  }
});

test("공동부모 탈퇴는 가족의 합산 잔액을 지우지 않고 결제 주문만 분리한다", async () => {
  const db = createDb();
  try {
    db.sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1)").run(
      "member-co-parent",
      FAMILY_ID,
      CO_PARENT_ID,
      "parent",
    );
    const orderId = seedGrantedOrder(db, { parentId: CO_PARENT_ID });
    seedBalance(db, 21, CO_PARENT_ID);

    await db.batch(await buildUserReferenceDeleteStmts(db, [CO_PARENT_ID]));

    assert.deepEqual(
      { ...db.row("SELECT purchased_credits,parent_id FROM ai_credit_balances") },
      { purchased_credits: 21, parent_id: PARENT_ID },
    );
    assert.equal(db.row("SELECT * FROM web_ai_credit_detached_balances"), null);
    assert.deepEqual(
      { ...db.row(
        "SELECT record_scope,balance_scope,detach_reason,granted_credits FROM web_ai_credit_orders WHERE order_id=?",
        orderId,
      ) },
      {
        record_scope: "detached",
        balance_scope: "active",
        detach_reason: "account_deleted",
        granted_credits: 30,
      },
    );
  } finally {
    db.close();
  }
});

test("분리된 완료 주문의 전액 환불은 원장 없이 signed 분리 잔액만 정확히 한 번 차감하고 알리지 않는다", async () => {
  const db = createDb();
  try {
    const paymentKey = "payment-detached-refund";
    const paymentKeyHash = await hashWebAiCreditPaymentKey(paymentKey);
    const orderId = seedGrantedOrder(db, { paymentKeyHash });
    seedBalance(db, 5);
    await db.batch(await buildFamilyScopedDeleteStmts(db, [FAMILY_ID]));
    const order = await loadWebAiCreditOrder(db, orderId);
    const roomFetchCounter = { count: 0 };

    const result = await reconcileWebAiCreditOrder(env(db, roomFetchCounter), {
      order,
      now: NOW,
      fetchImpl: async () => Response.json(providerPayment(order, paymentKey, "CANCELED", 0)),
    });

    assert.equal(result.status, "refunded");
    assert.equal(roomFetchCounter.count, 0);
    assert.deepEqual(
      { ...db.row(
        `SELECT status,refunded_credits,refund_committed_at,refunded_amount
           FROM web_ai_credit_orders WHERE order_id=?`,
        orderId,
      ) },
      {
        status: "refunded",
        refunded_credits: 30,
        refund_committed_at: "2026-08-01 12:00:00.000+00",
        refunded_amount: 12345,
      },
    );
    assert.equal(
      db.row("SELECT purchased_credits FROM web_ai_credit_detached_balances").purchased_credits,
      -25,
    );
  } finally {
    db.close();
  }
});

test("공동부모 탈퇴 주문의 후속 환불은 유지 중인 가족 잔액만 차감하고 실시간 알림은 보내지 않는다", async () => {
  const db = createDb();
  try {
    db.sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1)").run(
      "member-co-parent",
      FAMILY_ID,
      CO_PARENT_ID,
      "parent",
    );
    const paymentKey = "payment-co-parent-refund";
    const paymentKeyHash = await hashWebAiCreditPaymentKey(paymentKey);
    const orderId = seedGrantedOrder(db, { parentId: CO_PARENT_ID, paymentKeyHash });
    seedBalance(db, 21, CO_PARENT_ID);
    await db.batch(await buildUserReferenceDeleteStmts(db, [CO_PARENT_ID]));
    const order = await loadWebAiCreditOrder(db, orderId);
    const roomFetchCounter = { count: 0 };

    const result = await reconcileWebAiCreditOrder(env(db, roomFetchCounter), {
      order,
      now: NOW,
      fetchImpl: async () => Response.json(providerPayment(order, paymentKey, "CANCELED", 0)),
    });

    assert.equal(result.status, "refunded");
    assert.equal(roomFetchCounter.count, 0);
    assert.equal(db.row("SELECT purchased_credits FROM ai_credit_balances").purchased_credits, -9);
    assert.equal(db.row("SELECT * FROM web_ai_credit_detached_balances"), null);
  } finally {
    db.close();
  }
});

test("분리된 미부여 주문이 paid이면 done으로 위장하지 않고 환불 필요 상태로 격리한다", async () => {
  const db = createDb();
  try {
    const orderId = "HYENI-AI-detached-uncredited";
    const paymentKey = "payment-detached-uncredited";
    db.sqlite.prepare(
      `INSERT INTO web_ai_credit_orders
         (order_id,family_id,parent_id,child_user_id,customer_key,product_code,credits,
          amount,currency,status,record_scope,balance_scope,detach_reason,detached_at,
          expires_at,idempotency_key,created_at,updated_at)
       VALUES (?,?,?,?,?,'ai-credit-30',30,12345,'KRW','unknown','detached','detached',
               'family_deleted','2026-08-01 00:00:00+00','2026-08-01 01:00:00+00',?,
               '2026-08-01 00:00:00+00','2026-08-01 00:00:00+00')`,
    ).run(
      orderId,
      FAMILY_ID,
      PARENT_ID,
      CHILD_ID,
      "customer-detached-uncredited",
      "idempotency-detached-uncredited",
    );
    const order = await loadWebAiCreditOrder(db, orderId);
    let providerCalls = 0;

    const result = await processWebAiCreditReconciliations(env(db), {
      now: NOW,
      limit: 1,
      fetchImpl: async () => {
        providerCalls += 1;
        return Response.json(providerPayment(order, paymentKey, "DONE"));
      },
    });

    assert.equal(providerCalls, 1);
    assert.equal(result.done, 0);
    assert.equal(result.unknown, 1);
    assert.equal(result.dueRemaining, false);
    const stored = db.row(
      `SELECT status,error_code,payment_key_hash,retry_after,granted_credits
         FROM web_ai_credit_orders WHERE order_id=?`,
      orderId,
    );
    assert.equal(stored.status, "refund_unknown");
    assert.equal(stored.error_code, "WEB_AI_CREDIT_DETACHED_PAYMENT_REFUND_REQUIRED");
    assert.ok(stored.payment_key_hash);
    assert.equal(stored.granted_credits, 0);
    assert.ok(Date.parse(
      stored.retry_after.replace(" ", "T").replace(/\+00$/, "+00:00"),
    ) > NOW.getTime());

    const refunded = await processWebAiCreditReconciliations(env(db), {
      now: new Date("2026-08-09T12:00:00.000Z"),
      limit: 1,
      fetchImpl: async () => Response.json(providerPayment(order, paymentKey, "CANCELED", 0)),
    });
    assert.equal(refunded.refunded, 1);
    assert.deepEqual(
      { ...db.row(
        "SELECT status,refunded_credits,refunded_amount FROM web_ai_credit_orders WHERE order_id=?",
        orderId,
      ) },
      { status: "refunded", refunded_credits: 0, refunded_amount: 12345 },
    );
  } finally {
    db.close();
  }
});

test("분리 잔액이 남은 동일 가족·자녀의 재결제는 자동 복원 계약이 없으므로 provider 호출 전에 닫는다", async () => {
  const db = createDb();
  try {
    db.sqlite.prepare(
      `INSERT INTO web_ai_credit_detached_balances
         (family_id,child_user_id,purchased_credits,restoration_state,detached_at,updated_at,retention_until)
       VALUES (?,?,-9,'blocked','2026-08-01 00:00:00+00','2026-08-01 00:00:00+00',
               '2031-07-31 00:00:00')`,
    ).run(FAMILY_ID, CHILD_ID);
    const orderId = "HYENI-AI-reattach-blocked";
    db.sqlite.prepare(
      `INSERT INTO web_ai_credit_orders
         (order_id,family_id,parent_id,child_user_id,customer_key,product_code,credits,
          amount,currency,status,expires_at,idempotency_key,created_at,updated_at)
       VALUES (?,?,?,?,?,'ai-credit-30',30,12345,'KRW','pending',
               '2026-08-01 13:00:00+00',?,'2026-08-01 00:00:00+00','2026-08-01 00:00:00+00')`,
    ).run(
      orderId,
      FAMILY_ID,
      PARENT_ID,
      CHILD_ID,
      "customer-reattach-blocked",
      "idempotency-reattach-blocked",
    );
    const order = await loadWebAiCreditOrder(db, orderId);
    let providerCalls = 0;

    const result = await completeWebAiCreditOrder(env(db), {
      order,
      paymentKey: "payment-reattach-blocked",
      now: NOW,
      fetchImpl: async () => {
        providerCalls += 1;
        return Response.json(providerPayment(order, "payment-reattach-blocked", "DONE"));
      },
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "WEB_AI_CREDIT_REATTACH_REVIEW_REQUIRED");
    assert.equal(db.row("SELECT status FROM web_ai_credit_orders WHERE order_id=?", orderId).status, "pending");

    db.sqlite.prepare(
      "UPDATE web_ai_credit_orders SET status='unknown',retry_after=NULL WHERE order_id=?",
    ).run(orderId);
    const cronResult = await processWebAiCreditReconciliations(env(db), {
      now: NOW,
      limit: 1,
      fetchImpl: async () => {
        providerCalls += 1;
        return Response.json(providerPayment(order, "payment-reattach-blocked", "DONE"));
      },
    });
    assert.equal(providerCalls, 0);
    assert.equal(cronResult.unknown, 1);
    assert.equal(cronResult.dueRemaining, false);
    assert.deepEqual(
      { ...db.row(
        "SELECT status,error_code FROM web_ai_credit_orders WHERE order_id=?",
        orderId,
      ) },
      {
        status: "unknown",
        error_code: "WEB_AI_CREDIT_REATTACH_REVIEW_REQUIRED",
      },
    );
  } finally {
    db.close();
  }
});
