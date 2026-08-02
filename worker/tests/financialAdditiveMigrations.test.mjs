import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function readOptional(url) {
  try {
    return await readFile(url, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return "";
    throw error;
  }
}

const webBillingRevocationMigration = await readOptional(
  new URL("../db/web-billing-key-revocation.sql", import.meta.url),
);
const googlePlayFamilyTrialClaimMigration = await readOptional(
  new URL("../db/google-play-family-trial-claim.sql", import.meta.url),
);
const webAiFinancialRetentionMigration = await readOptional(
  new URL("../db/web-ai-credit-financial-retention.sql", import.meta.url),
);
const webAiCreditBaseMigration = await readFile(
  new URL("../db/web-ai-credit-billing.sql", import.meta.url),
  "utf8",
);
const canonicalSchema = await readFile(
  new URL("../../cloudflare/schema_d1.sql", import.meta.url),
  "utf8",
);

function columns(db, table) {
  return new Set(
    db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)),
  );
}

function indexes(db) {
  return new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => String(row.name)),
  );
}

test("기존 웹 구독 DB에 billingKey 원격 폐기 상태를 무손실로 추가한다", () => {
  assert.notEqual(webBillingRevocationMigration, "", "web-billing-key-revocation.sql 누락");
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE web_billing_customers (
    family_id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL,
    customer_key TEXT NOT NULL UNIQUE,
    billing_key_ciphertext TEXT,
    billing_key_iv TEXT,
    billing_key_version TEXT,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    trial_ends_at TEXT,
    current_period_end TEXT,
    next_charge_at TEXT,
    retry_after TEXT,
    failure_count INTEGER DEFAULT 0 NOT NULL,
    cancelled_at TEXT,
    last_order_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  db.prepare(
    `INSERT INTO web_billing_customers
       (family_id,parent_id,customer_key,billing_key_ciphertext,billing_key_iv,
        billing_key_version,plan,status,current_period_end,failure_count,created_at,updated_at)
     VALUES ('family-expired','parent-a','customer-a','ciphertext','iv','v1','month',
             'expired','2026-07-31',0,'2026-07-01','2026-08-01')`,
  ).run();

  db.exec(webBillingRevocationMigration);

  const actualColumns = columns(db, "web_billing_customers");
  for (const name of [
    "billing_key_revocation_status",
    "billing_key_revocation_attempts",
    "billing_key_revocation_retry_at",
    "billing_key_revocation_error",
    "billing_key_revoked_at",
  ]) {
    assert.ok(actualColumns.has(name), `${name} 컬럼 누락`);
  }
  assert.ok(indexes(db).has("idx_web_billing_customers_key_revocation"));
  assert.deepEqual({ ...db.prepare(
    `SELECT billing_key_revocation_status,billing_key_revocation_attempts,
            billing_key_revocation_retry_at,billing_key_ciphertext
       FROM web_billing_customers WHERE family_id='family-expired'`,
  ).get() }, {
    billing_key_revocation_status: "pending",
    billing_key_revocation_attempts: 0,
    billing_key_revocation_retry_at: "2026-08-01",
    billing_key_ciphertext: "ciphertext",
  });
  db.close();
});

test("기존 Toss 체험 claim에 provider를 정확히 1회 추가하고 기존 행을 보존한다", () => {
  assert.notEqual(googlePlayFamilyTrialClaimMigration, "", "google-play-family-trial-claim.sql 누락");
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE web_billing_trial_claims (
    family_id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL,
    checkout_session_id TEXT NOT NULL UNIQUE,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    trial_ends_at TEXT NOT NULL,
    converted_order_id TEXT,
    updated_at TEXT NOT NULL
  )`);
  db.prepare(
    `INSERT INTO web_billing_trial_claims
       (family_id,parent_id,checkout_session_id,plan,status,claimed_at,trial_ends_at,updated_at)
     VALUES ('family-a','parent-a','web-session-a','month','expired',
             '2026-07-01','2026-07-08','2026-07-08')`,
  ).run();

  db.exec(googlePlayFamilyTrialClaimMigration);

  assert.equal(columns(db, "web_billing_trial_claims").has("provider"), true);
  assert.equal(
    db.prepare("SELECT provider FROM web_billing_trial_claims WHERE family_id='family-a'").get().provider,
    "toss_web",
  );
  db.prepare(
    `INSERT INTO web_billing_trial_claims
       (family_id,parent_id,checkout_session_id,provider,plan,status,claimed_at,trial_ends_at,updated_at)
     VALUES ('family-b','parent-b','google-play:${"b".repeat(64)}','google_play','year','active',
             '2026-08-01','2026-08-08','2026-08-01')`,
  ).run();
  assert.throws(() => db.prepare(
    `INSERT INTO web_billing_trial_claims
       (family_id,parent_id,checkout_session_id,provider,plan,status,claimed_at,trial_ends_at,updated_at)
     VALUES ('family-c','parent-c','bad-provider','other','month','active',
             '2026-08-01','2026-08-08','2026-08-01')`,
  ).run(), /constraint/i);
  assert.throws(() => db.exec(googlePlayFamilyTrialClaimMigration), /duplicate column/i);
  db.close();
});

test("기존 웹 AI 주문에 금융 스냅샷과 분리 잔액 정본을 무손실로 추가한다", () => {
  assert.notEqual(webAiFinancialRetentionMigration, "", "web-ai-credit-financial-retention.sql 누락");
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE web_ai_credit_orders (
    order_id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    child_user_id TEXT NOT NULL,
    customer_key TEXT NOT NULL UNIQUE,
    product_code TEXT NOT NULL,
    credits INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    claim_token TEXT,
    claim_expires_at TEXT,
    payment_key_hash TEXT,
    debt_applied INTEGER DEFAULT 0 NOT NULL,
    refunded_amount INTEGER DEFAULT 0 NOT NULL,
    provider_checked_at TEXT,
    client_checked_at TEXT,
    webhook_checked_at TEXT,
    error_code TEXT,
    retry_after TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE ai_credit_ledger (
    id TEXT PRIMARY KEY,
    transaction_id TEXT,
    delta INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );`);
  db.prepare(
    `INSERT INTO web_ai_credit_orders
       (order_id,family_id,parent_id,child_user_id,customer_key,product_code,credits,
        amount,currency,status,expires_at,idempotency_key,payment_key_hash,refunded_amount,
        provider_checked_at,created_at,updated_at,completed_at)
     VALUES ('order-done','family-a','parent-a','child-a','customer-done','ai-credit-30',30,
             1000,'KRW','done','2026-08-01','idem-done','hash-done',0,
             '2026-08-01 00:00:00','2026-07-31 00:00:00','2026-08-01 00:00:00',
             '2026-08-01 00:00:00')`,
  ).run();
  db.prepare(
    `INSERT INTO web_ai_credit_orders
       (order_id,family_id,parent_id,child_user_id,customer_key,product_code,credits,
        amount,currency,status,expires_at,idempotency_key,payment_key_hash,refunded_amount,
        provider_checked_at,created_at,updated_at,completed_at)
     VALUES ('order-refunded','family-a','parent-a','child-a','customer-refund','ai-credit-30',30,
             1000,'KRW','refunded','2026-08-01','idem-refund','hash-refund',1000,
             '2026-08-02 00:00:00','2026-07-31 00:00:00','2026-08-02 00:00:00',
             '2026-08-01 00:00:00')`,
  ).run();
  db.prepare(
    `INSERT INTO ai_credit_ledger (id,transaction_id,delta,created_at)
     VALUES ('grant-done','order-done',30,'2026-08-01 00:00:00'),
            ('grant-refund','order-refunded',30,'2026-08-01 00:00:00'),
            ('refund-refund','order-refunded',-30,'2026-08-02 00:00:00')`,
  ).run();

  db.exec(webAiFinancialRetentionMigration);

  const actualColumns = columns(db, "web_ai_credit_orders");
  for (const name of [
    "record_scope",
    "balance_scope",
    "detach_reason",
    "detached_at",
    "granted_credits",
    "grant_committed_at",
    "refunded_credits",
    "refund_committed_at",
    "retention_until",
  ]) {
    assert.ok(actualColumns.has(name), `${name} 컬럼 누락`);
  }
  assert.ok(indexes(db).has("idx_web_ai_credit_detached_reconcile"));
  assert.ok(indexes(db).has("idx_web_ai_credit_detached_balance_retention"));
  assert.deepEqual({ ...db.prepare(
    `SELECT record_scope,balance_scope,granted_credits,refunded_credits,
            grant_committed_at,refund_committed_at,retention_until
       FROM web_ai_credit_orders WHERE order_id='order-refunded'`,
  ).get() }, {
    record_scope: "active",
    balance_scope: "active",
    granted_credits: 30,
    refunded_credits: 30,
    grant_committed_at: "2026-08-01 00:00:00",
    refund_committed_at: "2026-08-02 00:00:00",
    retention_until: "2031-08-02 00:00:00",
  });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM web_ai_credit_detached_balances").get().n,
    0,
  );
  db.close();
});

test("신규 웹 AI 결제 base migration은 정본 schema와 금융 컬럼·인덱스가 일치한다", () => {
  const migrated = new DatabaseSync(":memory:");
  migrated.exec(webAiCreditBaseMigration);
  migrated.exec(webAiCreditBaseMigration);
  const canonical = new DatabaseSync(":memory:");
  canonical.exec(canonicalSchema);

  for (const table of [
    "web_ai_credit_orders",
    "web_ai_credit_detached_balances",
    "web_ai_credit_lookup_windows",
  ]) {
    assert.deepEqual(
      [...columns(migrated, table)].sort(),
      [...columns(canonical, table)].sort(),
      `${table} base migration과 정본 schema 컬럼 불일치`,
    );
  }
  for (const name of [
    "idx_web_ai_credit_payment_hash",
    "idx_web_ai_credit_family_parent",
    "idx_web_ai_credit_reconcile",
    "idx_web_ai_credit_detached_reconcile",
    "idx_web_ai_credit_detached_balance_retention",
    "idx_web_ai_credit_lookup_windows_updated",
  ]) {
    assert.ok(indexes(migrated).has(name), `${name} base migration 누락`);
    assert.ok(indexes(canonical).has(name), `${name} 정본 schema 누락`);
  }
  canonical.close();
  migrated.close();
});
