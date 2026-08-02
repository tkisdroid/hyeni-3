import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const baseMigration = readFileSync(new URL("../db/web-billing.sql", import.meta.url), "utf8");
const refundMigration = readFileSync(new URL("../db/web-billing-refunds.sql", import.meta.url), "utf8");

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name).sort();
}

function tableIndexes(db, table) {
  return db.prepare(`PRAGMA index_list(${table})`).all().map((row) => row.name).sort();
}

function createFamilySubscription(db) {
  db.exec(`
    CREATE TABLE family_subscription(
      family_id TEXT PRIMARY KEY,
      status TEXT,
      provider TEXT,
      trial_ends_at TEXT,
      current_period_end TEXT,
      purchase_token_hash TEXT,
      latest_order_id TEXT,
      last_event_id TEXT
    );
  `);
}

test("웹 구독 환불 additive migration은 신규 base schema와 같은 환불 컬럼·금융 감사표를 만든다", () => {
  const fresh = new DatabaseSync(":memory:");
  createFamilySubscription(fresh);
  fresh.exec(baseMigration);

  const upgraded = new DatabaseSync(":memory:");
  upgraded.exec(`
    CREATE TABLE family_subscription(
      family_id TEXT PRIMARY KEY,
      status TEXT,
      provider TEXT,
      current_period_end TEXT,
      latest_order_id TEXT
    );
    CREATE TABLE billing_provider_reservations(
      family_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      state TEXT NOT NULL,
      reservation_ref TEXT NOT NULL
    );
    CREATE TABLE web_billing_customers(
      family_id TEXT PRIMARY KEY,
      customer_key TEXT,
      current_period_end TEXT
    );
    CREATE TABLE web_billing_checkout_sessions(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      customer_key TEXT NOT NULL
    );
    CREATE TABLE web_billing_charge_attempts(
      order_id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      checkout_session_id TEXT,
      plan TEXT NOT NULL,
      amount INTEGER NOT NULL,
      kind TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT NOT NULL,
      claim_token TEXT,
      claim_expires_at TEXT,
      payment_key_hash TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  upgraded.prepare(
    `INSERT INTO web_billing_customers(family_id,current_period_end) VALUES (?,?)`,
  ).run("family-upgraded", "2026-09-01 00:00:00+00");
  upgraded.prepare(
    `INSERT INTO web_billing_charge_attempts
       (order_id,family_id,checkout_session_id,plan,amount,kind,period_start,period_end,
        status,claim_token,claim_expires_at,payment_key_hash,error_code,created_at,
        completed_at,updated_at)
     VALUES (?,?,NULL,'month',4900,'renewal',?,?,'done',NULL,NULL,?,NULL,?,?,?)`,
  ).run(
    "HYENI-R-upgraded-paid-order",
    "family-upgraded",
    "2026-08-01 00:00:00+00",
    "2026-09-01 00:00:00+00",
    "a".repeat(64),
    "2026-08-01 00:00:00+00",
    "2026-08-01 00:00:01+00",
    "2026-08-01 00:00:01+00",
  );
  upgraded.prepare(
    `INSERT INTO family_subscription(family_id,status,provider,current_period_end,latest_order_id)
     VALUES (?,'active','toss_web',?,?)`,
  ).run("family-upgraded", "2026-09-01 00:00:00+00", "HYENI-R-upgraded-paid-order");
  upgraded.prepare(
    `INSERT INTO billing_provider_reservations(family_id,provider,state,reservation_ref)
     VALUES (?,'toss_web','active','stale-failed-order')`,
  ).run("family-upgraded");
  upgraded.exec(refundMigration);

  for (const column of [
    "refund_status",
    "refunded_amount",
    "refund_state_hash",
    "provider_checked_at",
    "refund_committed_at",
    "refund_webhook_checked_at",
    "refund_funnel_status",
    "customer_key",
  ]) {
    assert.ok(tableColumns(fresh, "web_billing_charge_attempts").includes(column), column);
    assert.ok(tableColumns(upgraded, "web_billing_charge_attempts").includes(column), column);
  }
  assert.ok(tableColumns(fresh, "web_billing_customers").includes("last_paid_order_id"));
  assert.ok(tableColumns(upgraded, "web_billing_customers").includes("last_paid_order_id"));
  assert.deepEqual(
    { ...upgraded.prepare(
      `SELECT c.last_paid_order_id,b.reservation_ref
         FROM web_billing_customers c
         JOIN billing_provider_reservations b ON b.family_id=c.family_id
        WHERE c.family_id=?`,
    ).get("family-upgraded") },
    {
      last_paid_order_id: "HYENI-R-upgraded-paid-order",
      reservation_ref: "HYENI-R-upgraded-paid-order",
    },
  );
  assert.deepEqual(
    tableColumns(upgraded, "web_billing_refund_records"),
    tableColumns(fresh, "web_billing_refund_records"),
  );
  assert.deepEqual(
    tableIndexes(upgraded, "web_billing_refund_records"),
    tableIndexes(fresh, "web_billing_refund_records"),
  );
  assert.ok(tableIndexes(fresh, "web_billing_charge_attempts").includes(
    "idx_web_billing_charge_refund_reconcile",
  ));
  assert.ok(tableIndexes(upgraded, "web_billing_charge_attempts").includes(
    "idx_web_billing_charge_refund_reconcile",
  ));
  assert.throws(() => upgraded.prepare(
    `INSERT INTO web_billing_refund_records
       (record_id,provider_reference,provider,plan,amount,currency,charge_kind,
        refund_status,refunded_amount,balance_amount,payment_key_hash,refund_state_hash,
        transaction_count,provider_checked_at,retention_until,created_at)
     VALUES (?,?,'toss_web','month',4900,'KRW','initial','full',4900,0,?,?,1,?,?,?)`,
  ).run(
    `refund:${"a".repeat(63)}z`,
    "HYENI-I-invalid-refund-record",
    "b".repeat(64),
    "c".repeat(64),
    "2026-08-01",
    "2031-08-01",
    "2026-08-01",
  ), /CHECK constraint failed/);
  upgraded.prepare(
    `INSERT INTO web_billing_refund_records
       (record_id,provider_reference,provider,plan,amount,currency,charge_kind,
        refund_status,refunded_amount,balance_amount,payment_key_hash,refund_state_hash,
        transaction_count,provider_checked_at,retention_until,created_at)
     VALUES (?,?,'toss_web','month',4900,'KRW','initial','full',4900,0,?,?,101,?,?,?)`,
  ).run(
    `refund:${"e".repeat(64)}`,
    "HYENI-I-many-refund-transactions",
    "f".repeat(64),
    "1".repeat(64),
    "2026-08-01",
    "2031-08-01",
    "2026-08-01",
  );

  fresh.close();
  upgraded.close();
});
