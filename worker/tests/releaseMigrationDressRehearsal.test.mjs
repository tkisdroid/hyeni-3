import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function migration(name) {
  return readFileSync(new URL(`../db/${name}`, import.meta.url), "utf8");
}

function columns(sqlite, table) {
  return sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((row) => String(row.name));
}

function object(sqlite, type, name) {
  return sqlite.prepare(
    "SELECT name,sql FROM sqlite_master WHERE type=? AND name=?",
  ).get(type, name);
}

function assertObjects(sqlite, type, names) {
  for (const name of names) {
    assert.ok(object(sqlite, type, name), `${type} ${name}가 있어야 합니다`);
  }
}

function normalizeSql(value) {
  return String(value ?? "")
    .replaceAll('"', "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tableSqlContains(sqlite, table, fragment) {
  const tableObject = object(sqlite, "table", table);
  return Boolean(tableObject && normalizeSql(tableObject.sql).includes(normalizeSql(fragment)));
}

function applyStep(sqlite, appliedSteps, step, files) {
  for (const file of files) sqlite.exec(migration(file));
  appliedSteps.push({ step, files });
}

function hasColumn(sqlite, table, column) {
  return columns(sqlite, table).includes(column);
}

function resolveWebBillingMigrationPlan(sqlite) {
  const customerColumns = columns(sqlite, "web_billing_customers");
  const trialColumns = columns(sqlite, "web_billing_trial_claims");
  const chargeColumns = columns(sqlite, "web_billing_charge_attempts");
  const probes = [customerColumns, trialColumns, chargeColumns];
  if (probes.every((value) => value.length === 0)) {
    return { status: "apply", branch: "base", files: ["web-billing.sql"] };
  }
  if (probes.some((value) => value.length === 0)) {
    return { status: "hold", reason: "incomplete_web_billing_base", files: [] };
  }
  const hasRefundStatus = chargeColumns.includes("refund_status");
  const hasCustomerKey = chargeColumns.includes("customer_key");
  if (hasRefundStatus && !hasCustomerKey) {
    return { status: "hold", reason: "refund_without_customer_key", files: [] };
  }
  const files = [];
  if (!customerColumns.includes("billing_key_revocation_status")) {
    files.push("web-billing-key-revocation.sql");
  }
  if (!trialColumns.includes("provider")) files.push("google-play-family-trial-claim.sql");
  if (!hasRefundStatus) files.push("web-billing-refunds.sql");
  if (!object(sqlite, "table", "web_billing_financial_records")) {
    files.push("web-billing-financial-retention.sql");
  }
  return { status: files.length > 0 ? "apply" : "ready", branch: "additive", files };
}

function resolveWebAiMigrationPlan(sqlite) {
  const orderColumns = columns(sqlite, "web_ai_credit_orders");
  if (orderColumns.length === 0) {
    return { status: "apply", branch: "base", files: ["web-ai-credit-billing.sql"] };
  }
  if (!orderColumns.includes("record_scope")) {
    return {
      status: "apply",
      branch: "additive",
      files: ["web-ai-credit-financial-retention.sql"],
    };
  }
  return { status: "ready", branch: "additive", files: [] };
}

function pendingFiles(sqlite, specs) {
  return specs.filter((spec) => !spec.ready(sqlite)).map((spec) => spec.file);
}

function createOperationalSnapshotFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys=ON;

    CREATE TABLE ai_credit_balances(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL,
      parent_id TEXT,
      is_premium INTEGER NOT NULL DEFAULT 0,
      daily_included_limit INTEGER NOT NULL DEFAULT 5,
      daily_included_used INTEGER NOT NULL DEFAULT 0,
      daily_reset_date TEXT NOT NULL,
      purchased_credits INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE ai_credit_ledger(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL,
      parent_id TEXT,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      message_id TEXT,
      transaction_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE ai_parent_settings(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL
    );

    INSERT INTO ai_parent_settings VALUES
      ('setting-main','family-main','child-main');

    CREATE TABLE child_locations(
      user_id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      updated_at TEXT NOT NULL,
      accuracy_m REAL
    );

    CREATE TABLE location_history(
      id INTEGER NOT NULL PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      recorded_at TEXT NOT NULL,
      is_estimated INTEGER NOT NULL DEFAULT 0,
      accuracy_m REAL
    );

    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

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

    CREATE TABLE google_play_purchase_events(
      purchase_token_hash TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT,
      parent_id TEXT,
      product_type TEXT NOT NULL,
      product_id TEXT NOT NULL,
      base_plan_id TEXT,
      credit_amount INTEGER,
      order_id TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      verification_result TEXT NOT NULL DEFAULT '{}',
      granted_at TEXT,
      acknowledged_at TEXT,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE google_play_rtdn_events(
      message_id TEXT PRIMARY KEY,
      package_name TEXT NOT NULL,
      event_kind TEXT NOT NULL CHECK (event_kind IN ('test','subscription')),
      notification_type INTEGER,
      purchase_token_hash TEXT,
      family_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('processing','retryable','processed','ignored')),
      attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts>=1),
      claim_token TEXT NOT NULL,
      lease_until TEXT,
      event_time_ms INTEGER NOT NULL,
      last_error TEXT,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_google_play_rtdn_events_status_lease
      ON google_play_rtdn_events(status,lease_until);
    CREATE INDEX idx_google_play_rtdn_events_purchase_hash
      ON google_play_rtdn_events(purchase_token_hash);

    CREATE TABLE google_play_billing_owners(
      obfuscated_account_id TEXT NOT NULL,
      obfuscated_profile_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      last_purchase_token_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (obfuscated_account_id,obfuscated_profile_id)
    );
    CREATE INDEX idx_google_play_billing_owners_family_parent
      ON google_play_billing_owners(family_id,parent_id);
    CREATE INDEX idx_google_play_billing_owners_token_hash
      ON google_play_billing_owners(last_purchase_token_hash);

    INSERT INTO ai_credit_balances VALUES
      ('balance-1','family-main','child-main',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:01:00.000+00'),
      ('balance-2','family-main','child-main',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:02:00.000+00'),
      ('balance-3','family-main','child-main',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:03:00.000+00'),
      ('balance-4','family-main','child-main',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:04:00.000+00'),
      ('balance-5','family-main','child-main',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:05:00.000+00'),
      ('balance-6','family-main','child-main',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:06:00.000+00');

    INSERT INTO ai_credit_ledger VALUES
      ('ledger-credit','family-main','child-main',NULL,10,'historical_credit','purchase',NULL,'tx-credit','2026-07-01 00:00:00+00'),
      ('ledger-debit','family-main','child-main',NULL,-10,'historical_debit','chat',NULL,'tx-debit','2026-07-02 00:00:00+00');

    INSERT INTO family_members VALUES
      ('member-main','family-main','child-main','child',1),
      ('member-referee','family-referee','child-referee','child',1);

    INSERT INTO location_history VALUES
      (1,'child-main','family-main',37.1,127.1,'2026-07-31 23:30:00+00',0,12.5),
      (2,'child-main','family-main',37.2,127.2,'2026-08-01 00:00:00+00',1,NULL);

    INSERT INTO family_subscription VALUES
      ('family-main','active','google_play',NULL,'2099-09-01 00:00:00+00',
       '${"a".repeat(64)}','order-current','rtdn-current');

    INSERT INTO google_play_billing_owners
      (obfuscated_account_id,obfuscated_profile_id,family_id,parent_id,last_purchase_token_hash)
    VALUES ('account-hash','profile-hash','family-main','parent-main','${"a".repeat(64)}');
  `);
  return sqlite;
}

test("AI balance 병합은 전체 합이 아니라 최신 reset 날짜 행의 비영 사용량 최댓값을 보존한다", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE ai_credit_balances(
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        child_user_id TEXT NOT NULL,
        parent_id TEXT,
        is_premium INTEGER NOT NULL DEFAULT 0,
        daily_included_limit INTEGER NOT NULL DEFAULT 5,
        daily_included_used INTEGER NOT NULL DEFAULT 0,
        daily_reset_date TEXT NOT NULL,
        purchased_credits INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      INSERT INTO ai_credit_balances VALUES
        ('old-reset','family-contract','child-contract',NULL,0,5,99,'2026-07-31',2,'2026-08-01 04:00:00+00'),
        ('latest-low','family-contract','child-contract','parent-contract',0,5,3,'2026-08-01',11,'2026-08-01 01:00:00+00'),
        ('latest-high','family-contract','child-contract',NULL,1,20,7,'2026-08-01',4,'2026-08-01 02:00:00+00'),
        ('winner-old-reset','family-contract','child-contract',NULL,0,5,1,'2026-07-31',0,'2026-08-01 05:00:00+00');
    `);

    sqlite.exec(migration("ai-credit-balance-uniqueness.sql"));

    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT id,parent_id,is_premium,daily_included_limit,daily_included_used,
               daily_reset_date,purchased_credits
          FROM ai_credit_balances
      `).get() },
      {
        id: "winner-old-reset",
        parent_id: "parent-contract",
        is_premium: 1,
        daily_included_limit: 20,
        daily_included_used: 7,
        daily_reset_date: "2026-08-01",
        purchased_credits: 11,
      },
    );
    assert.notEqual(
      sqlite.prepare("SELECT daily_included_used FROM ai_credit_balances").get()
        .daily_included_used,
      110,
      "서로 다른 reset 날짜의 사용량을 합산하면 안 됩니다",
    );
  } finally {
    sqlite.close();
  }
});

test("AI balance 병합은 D1의 T/Z와 공백/+00 시각 형식을 실제 시간 순으로 비교한다", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE ai_credit_balances(
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        child_user_id TEXT NOT NULL,
        parent_id TEXT,
        is_premium INTEGER NOT NULL DEFAULT 0,
        daily_included_limit INTEGER NOT NULL DEFAULT 5,
        daily_included_used INTEGER NOT NULL DEFAULT 0,
        daily_reset_date TEXT NOT NULL,
        purchased_credits INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      INSERT INTO ai_credit_balances VALUES
        ('actually-old','family-mixed','child-mixed','parent-old',0,5,1,'2026-08-01',1,
         '2026-08-01T00:00:00.000Z'),
        ('actually-new','family-mixed','child-mixed','parent-new',1,20,3,'2026-08-01',3,
         '2026-08-01 23:00:00.000+00');
    `);

    sqlite.exec(migration("ai-credit-balance-uniqueness.sql"));

    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT id,parent_id,updated_at FROM ai_credit_balances
      `).get() },
      {
        id: "actually-new",
        parent_id: "parent-new",
        updated_at: "2026-08-01 23:00:00.000+00",
      },
    );
  } finally {
    sqlite.close();
  }
});

test("2026-08-01 출시 7단계 migration manifest를 운영 스냅샷 형태의 격리 SQLite에서 순서대로 완주한다", () => {
  const sqlite = createOperationalSnapshotFixture();
  const appliedSteps = [];

  try {
    const balancesBefore = { ...sqlite.prepare(`
      SELECT COUNT(*) AS row_count,
             COUNT(DISTINCT family_id || ':' || child_user_id) AS group_count,
             SUM(purchased_credits) AS purchased_sum,
             MAX(purchased_credits) AS purchased_max,
             SUM(daily_included_used) AS daily_used_sum,
             (
               SELECT MAX(latest.daily_included_used)
                 FROM ai_credit_balances latest
                WHERE latest.daily_reset_date=(
                  SELECT MAX(reset_row.daily_reset_date) FROM ai_credit_balances reset_row
                )
             ) AS daily_used_preserved,
             COUNT(DISTINCT daily_reset_date) AS reset_date_count,
             SUM(CASE WHEN parent_id IS NOT NULL THEN 1 ELSE 0 END) AS parent_count
        FROM ai_credit_balances
    `).get() };
    const ledgerBefore = sqlite.prepare(
      "SELECT id,delta,transaction_id,created_at FROM ai_credit_ledger ORDER BY id",
    ).all().map((row) => ({ ...row }));
    assert.deepEqual(balancesBefore, {
      row_count: 6,
      group_count: 1,
      purchased_sum: 0,
      purchased_max: 0,
      daily_used_sum: 0,
      daily_used_preserved: 0,
      reset_date_count: 1,
      parent_count: 0,
    });

    applyStep(sqlite, appliedSteps, 1, [
      "ai-credit-balance-uniqueness.sql",
      "ai-parent-settings-uniqueness.sql",
    ]);

    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,
               daily_included_used,daily_reset_date,purchased_credits
          FROM ai_credit_balances
      `).get() },
      {
        id: "balance-6",
        family_id: "family-main",
        child_user_id: "child-main",
        parent_id: null,
        is_premium: 0,
        daily_included_limit: 5,
        daily_included_used: 0,
        daily_reset_date: "2026-08-01",
        purchased_credits: 0,
      },
    );
    const balanceAfter = { ...sqlite.prepare(`
      SELECT COUNT(*) AS row_count,
             MAX(purchased_credits) AS purchased_credits,
             SUM(daily_included_used) AS daily_included_used
        FROM ai_credit_balances
    `).get() };
    assert.equal(balancesBefore.row_count - balanceAfter.row_count, 5);
    assert.equal(balanceAfter.purchased_credits, balancesBefore.purchased_max);
    assert.equal(balanceAfter.daily_included_used, balancesBefore.daily_used_preserved);
    assert.equal(
      sqlite.prepare(`
        SELECT COUNT(*) AS count FROM (
          SELECT family_id,child_user_id FROM ai_credit_balances
          GROUP BY family_id,child_user_id HAVING COUNT(*)>1
        )
      `).get().count,
      0,
    );
    assert.deepEqual(
      sqlite.prepare("SELECT id,delta,transaction_id,created_at FROM ai_credit_ledger ORDER BY id")
        .all().map((row) => ({ ...row })),
      ledgerBefore,
    );
    assertObjects(sqlite, "index", [
      "idx_ai_credit_balances_family_child_unique",
      "uq_ai_parent_settings_family_child",
    ]);
    assert.equal(object(sqlite, "table", "_ai_credit_balance_merge_20260801"), undefined);
    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO ai_credit_balances
          (id,family_id,child_user_id,daily_reset_date,updated_at)
        VALUES ('duplicate','family-main','child-main','2026-08-01','2026-08-01')
      `).run(),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO ai_parent_settings(id,family_id,child_user_id)
        VALUES ('setting-duplicate','family-main','child-main')
      `).run(),
      /UNIQUE constraint failed/,
    );

    applyStep(sqlite, appliedSteps, 2, [
      "premium-funnel.sql",
      "premium-funnel-ai-friend-limit.sql",
      "premium-funnel-ai-schedule-limit.sql",
      "family-lifecycle-funnel.sql",
      "revenue-cost-ledger.sql",
    ]);
    assertObjects(sqlite, "table", [
      "premium_funnel_events",
      "premium_funnel_rate_limits",
      "family_lifecycle_events",
      "family_lifecycle_daily",
      "revenue_cost_ledger",
      "revenue_cost_coverage",
    ]);
    assertObjects(sqlite, "index", [
      "idx_premium_funnel_received",
      "idx_premium_funnel_event_received",
      "idx_premium_funnel_family_received",
      "idx_premium_funnel_rate_updated",
      "idx_family_lifecycle_first_milestone",
      "idx_family_lifecycle_event_received",
      "idx_family_lifecycle_received",
      "idx_family_lifecycle_family_occurred",
      "idx_family_lifecycle_daily_date",
      "idx_family_lifecycle_daily_updated",
      "idx_revenue_cost_ledger_source_unique",
      "idx_revenue_cost_ledger_provider_date",
      "idx_revenue_cost_ledger_category_date",
      "idx_revenue_cost_coverage_source_unique",
      "idx_revenue_cost_coverage_lookup",
    ]);

    applyStep(sqlite, appliedSteps, 3, [
      "location-confirmation-records.sql",
      "location-history-ingest-quota.sql",
      "location-history-retention.sql",
    ]);
    assertObjects(sqlite, "table", [
      "location_confirmation_records",
      "location_history_ingest_daily_usage",
    ]);
    assertObjects(sqlite, "index", [
      "idx_location_confirmation_recorded",
      "idx_location_confirmation_family_subject_occurred",
      "idx_location_history_ingest_usage_date",
      "idx_location_history_recorded_family",
      "idx_location_history_family_recorded_norm",
    ]);
    assertObjects(sqlite, "trigger", [
      "trg_child_locations_confirmation_insert",
      "trg_child_locations_confirmation_update",
      "trg_location_history_confirmation_insert",
      "trg_location_history_ingest_daily_quota",
    ]);
    assert.equal(
      sqlite.prepare(`
        SELECT row_count FROM location_history_ingest_daily_usage
         WHERE user_id='child-main' AND date_key='2026-08-01'
      `).get().row_count,
      2,
    );

    sqlite.exec(`
      INSERT INTO child_locations VALUES
        ('child-main','family-main',37.3,127.3,'2026-08-01 01:00:00+00',10.0);
      INSERT INTO location_history VALUES
        (3,'child-main','family-main',37.3,127.3,'2026-08-01 01:00:00+00',0,10.0);
      INSERT INTO location_history VALUES
        (4,'child-main','family-main',37.4,127.4,'2026-08-01 02:00:00+00',1,NULL);
      INSERT INTO location_history VALUES
        (5,'child-main','family-main',37.5,127.5,'2026-08-01 03:00:00+00',0,8.5);
      UPDATE child_locations
         SET lat=37.5,lng=127.5,updated_at='2026-08-01 03:00:00+00'
       WHERE user_id='child-main';
    `);
    assert.equal(
      sqlite.prepare(`
        SELECT COUNT(*) AS count FROM location_confirmation_records
         WHERE family_id='family-main' AND subject_user_id='child-main'
           AND occurred_at='2026-08-01 01:00:00+00'
      `).get().count,
      1,
      "current/history의 동일 실측은 reciprocal service_code 한 건으로 남아야 합니다",
    );
    assert.equal(
      sqlite.prepare(`
        SELECT COUNT(*) AS count FROM location_confirmation_records
         WHERE family_id='family-main' AND subject_user_id='child-main'
           AND occurred_at='2026-08-01 02:00:00+00'
      `).get().count,
      0,
      "history_estimated는 확인자료가 아니어야 합니다",
    );
    assert.equal(
      sqlite.prepare(`
        SELECT COUNT(*) AS count FROM location_confirmation_records
         WHERE family_id='family-main' AND subject_user_id='child-main'
           AND occurred_at='2026-08-01 03:00:00+00'
      `).get().count,
      1,
      "history가 먼저 들어와도 reciprocal current가 중복되면 안 됩니다",
    );
    assert.equal(
      sqlite.prepare(`
        SELECT row_count FROM location_history_ingest_daily_usage
         WHERE user_id='child-main' AND date_key='2026-08-01'
      `).get().row_count,
      5,
    );
    sqlite.prepare(`
      UPDATE location_history_ingest_daily_usage SET row_count=7200
       WHERE user_id='child-main' AND date_key='2026-08-01'
    `).run();
    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO location_history VALUES
          (6,'child-main','family-main',37.6,127.6,'2026-08-01 04:00:00+00',0,9.0)
      `).run(),
      /location_history_daily_quota_exceeded/,
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM location_history WHERE id=6")
        .get().count,
      0,
    );

    for (const table of [
      "web_billing_customers",
      "web_billing_trial_claims",
      "web_billing_charge_attempts",
    ]) {
      assert.deepEqual(columns(sqlite, table), [], `${table}가 없으므로 신규 DB 분기여야 합니다`);
    }
    const webBillingPlan = resolveWebBillingMigrationPlan(sqlite);
    assert.deepEqual(webBillingPlan, {
      status: "apply",
      branch: "base",
      files: ["web-billing.sql"],
    });
    applyStep(sqlite, appliedSteps, 4, webBillingPlan.files);
    assertObjects(sqlite, "table", [
      "web_billing_checkout_sessions",
      "web_billing_customers",
      "web_billing_charge_attempts",
      "web_billing_refund_records",
      "web_billing_trial_claims",
      "billing_provider_reservations",
      "web_billing_financial_records",
    ]);
    assertObjects(sqlite, "index", [
      "idx_web_billing_checkout_family_parent",
      "idx_web_billing_checkout_claim",
      "idx_web_billing_customers_renewal",
      "idx_web_billing_customers_key_revocation",
      "idx_web_billing_charge_initial_session",
      "idx_web_billing_charge_family_created",
      "idx_web_billing_charge_claim",
      "idx_web_billing_charge_refund_reconcile",
      "idx_web_billing_refund_provider_checked",
      "idx_web_billing_refund_retention",
      "idx_web_billing_trial_status_end",
      "idx_billing_provider_state_updated",
      "idx_web_billing_financial_retention",
    ]);
    const refundReconcileSql = normalizeSql(
      object(sqlite, "index", "idx_web_billing_charge_refund_reconcile").sql,
    );
    assert.match(
      refundReconcileSql,
      /on web_billing_charge_attempts \(provider_checked_at,completed_at,order_id\) where status='done' and refund_status<>'full'/,
    );
    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT provider,state,reservation_ref FROM billing_provider_reservations
         WHERE family_id='family-main'
      `).get() },
      { provider: "google_play", state: "active", reservation_ref: "a".repeat(64) },
    );
    for (const column of [
      "customer_key",
      "refund_status",
      "refunded_amount",
      "refund_state_hash",
      "provider_checked_at",
      "refund_committed_at",
      "refund_webhook_checked_at",
      "refund_funnel_status",
    ]) {
      assert.ok(columns(sqlite, "web_billing_charge_attempts").includes(column), column);
    }
    for (const column of [
      "last_paid_order_id",
      "billing_key_revocation_status",
      "billing_key_revocation_retry_at",
      "billing_key_revoked_at",
    ]) {
      assert.ok(columns(sqlite, "web_billing_customers").includes(column), column);
    }

    sqlite.prepare(`
      INSERT INTO web_billing_checkout_sessions
        (id,family_id,parent_id,customer_key,plan,amount,expires_at)
      VALUES (?,?,?,?,?,?,?)
    `).run("checkout-month", "family-main", "parent-main", "customer-month", "month", 4900, "2099-01-01");
    sqlite.prepare(`
      INSERT INTO web_billing_checkout_sessions
        (id,family_id,parent_id,customer_key,plan,amount,expires_at)
      VALUES (?,?,?,?,?,?,?)
    `).run("checkout-year", "family-main", "parent-main", "customer-year", "year", 39000, "2099-01-01");
    for (const [id, customerKey, plan, amount] of [
      ["checkout-old-month", "customer-old-month", "month", 2900],
      ["checkout-old-year", "customer-old-year", "year", 27840],
    ]) {
      assert.throws(
        () => sqlite.prepare(`
          INSERT INTO web_billing_checkout_sessions
            (id,family_id,parent_id,customer_key,plan,amount,expires_at)
          VALUES (?,?,?,?,?,?,?)
        `).run(id, "family-main", "parent-main", customerKey, plan, amount, "2099-01-01"),
        /CHECK constraint failed/,
      );
    }
    for (const table of [
      "web_billing_checkout_sessions",
      "web_billing_charge_attempts",
      "web_billing_refund_records",
      "web_billing_financial_records",
    ]) {
      const tableSql = normalizeSql(object(sqlite, "table", table).sql);
      assert.match(tableSql, /4900/);
      assert.match(tableSql, /39000/);
      assert.doesNotMatch(tableSql, /\b2900\b|\b27840\b/);
    }

    assertObjects(sqlite, "index", ["idx_ai_credit_balances_family_child_unique"]);
    assert.deepEqual(columns(sqlite, "web_ai_credit_orders"), []);
    const webAiPlan = resolveWebAiMigrationPlan(sqlite);
    assert.deepEqual(webAiPlan, {
      status: "apply",
      branch: "base",
      files: ["web-ai-credit-billing.sql"],
    });
    applyStep(sqlite, appliedSteps, 5, webAiPlan.files);
    assertObjects(sqlite, "table", [
      "web_ai_credit_orders",
      "web_ai_credit_detached_balances",
      "web_ai_credit_lookup_windows",
    ]);
    assertObjects(sqlite, "index", [
      "idx_web_ai_credit_payment_hash",
      "idx_web_ai_credit_family_parent",
      "idx_web_ai_credit_reconcile",
      "idx_web_ai_credit_detached_reconcile",
      "idx_web_ai_credit_detached_balance_retention",
      "idx_web_ai_credit_lookup_windows_updated",
    ]);
    assert.deepEqual(
      columns(sqlite, "web_ai_credit_orders").filter(
        (name) => name.replaceAll("_", "").toLowerCase() === "paymentkey",
      ),
      [],
      "payment_key/paymentKey 원문 컬럼이 없어야 합니다",
    );

    applyStep(sqlite, appliedSteps, 6, ["referral-rewards-v2.sql"]);
    assertObjects(sqlite, "table", ["referral_codes_v2", "referral_completions_v2"]);
    assertObjects(sqlite, "index", [
      "idx_referral_codes_v2_owner",
      "idx_referral_completions_v2_pending",
      "idx_referral_completions_v2_referrer",
      "idx_referral_completions_v2_ready",
    ]);
    assertObjects(sqlite, "trigger", ["trg_referral_location_evidence_snapshot"]);
    sqlite.exec(`
      INSERT INTO referral_codes_v2
        (id,family_id,owner_parent_id,reward_child_user_id,code)
      VALUES ('referral-code','family-main','parent-main','child-main','HYENI-ABCDEF1234567890');
      INSERT INTO referral_completions_v2
        (id,referral_code_id,referrer_family_id,referrer_parent_id,referrer_child_user_id,
         referee_family_id,referee_parent_id,created_at,updated_at)
      VALUES ('referral-completion','referral-code','family-main','parent-main','child-main',
              'family-referee','parent-referee','2026-08-01 00:00:00+00','2026-08-01 00:00:00+00');

      INSERT INTO location_confirmation_records
        (id,family_id,subject_user_id,action,requester_kind,requester_user_id,
         recipient_kind,recipient_user_id,collection_method,acquisition_path,
         service_code,delivery_method,purpose_code,occurred_at,completed_at,recorded_at)
      VALUES
        ('referral-evidence-first','family-referee','child-referee','collect','subject','child-referee',
         'none',NULL,'android_fused_location','android_native_app','current_location_ingest',
         'https_worker_api','family_location_safety','2026-08-01 01:00:00+00',
         '2026-08-01 01:00:00+00','2026-08-01 01:00:00+00'),
        ('referral-evidence-qualified','family-referee','child-referee','collect','subject','child-referee',
         'none',NULL,'android_fused_location','android_native_app','location_history_ingest',
         'https_worker_api','family_location_safety','2026-08-03 02:00:00+00',
         '2026-08-03 02:00:00+00','2026-08-03 02:00:00+00');
    `);
    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT referee_child_user_id,first_location_at,latest_location_at
          FROM referral_completions_v2 WHERE id='referral-completion'
      `).get() },
      {
        referee_child_user_id: "child-referee",
        first_location_at: "2026-08-01 01:00:00+00",
        latest_location_at: "2026-08-03 02:00:00+00",
      },
    );

    assertObjects(sqlite, "table", ["billing_provider_reservations"]);
    assert.deepEqual(columns(sqlite, "google_play_rtdn_events"), [
      "message_id",
      "package_name",
      "event_kind",
      "notification_type",
      "purchase_token_hash",
      "family_id",
      "status",
      "attempts",
      "claim_token",
      "lease_until",
      "event_time_ms",
      "last_error",
      "received_at",
      "processed_at",
      "updated_at",
    ]);
    assert.deepEqual(columns(sqlite, "google_play_billing_owners"), [
      "obfuscated_account_id",
      "obfuscated_profile_id",
      "family_id",
      "parent_id",
      "last_purchase_token_hash",
      "created_at",
      "updated_at",
    ]);
    assert.deepEqual(columns(sqlite, "google_play_voided_purchase_events"), []);
    assert.ok(!columns(sqlite, "google_play_purchase_events").includes("debt_applied"));
    applyStep(sqlite, appliedSteps, 7, [
      "google-play-rtdn-schema.sql",
      "google-play-credit-debt-disclosure.sql",
    ]);
    assertObjects(sqlite, "table", [
      "google_play_rtdn_events",
      "google_play_billing_owners",
      "google_play_voided_purchase_events",
    ]);
    assertObjects(sqlite, "index", [
      "idx_google_play_rtdn_events_status_lease",
      "idx_google_play_rtdn_events_purchase_hash",
      "idx_google_play_voided_status_lease",
      "idx_google_play_voided_purchase_hash",
      "idx_google_play_billing_owners_family_parent",
      "idx_google_play_billing_owners_token_hash",
    ]);
    assert.ok(columns(sqlite, "google_play_purchase_events").includes("debt_applied"));
    assert.equal(
      sqlite.prepare(`
        SELECT COUNT(*) AS count FROM google_play_billing_owners
         WHERE obfuscated_account_id='account-hash' AND obfuscated_profile_id='profile-hash'
      `).get().count,
      1,
      "기존 owner 행이 RTDN additive migration에서 보존되어야 합니다",
    );
    sqlite.prepare(`
      INSERT INTO google_play_purchase_events
        (purchase_token_hash,family_id,product_type,product_id,credit_amount)
      VALUES ('credit-purchase','family-main','inapp','ai-credit-10',10)
    `).run();
    assert.equal(
      sqlite.prepare(`
        SELECT debt_applied FROM google_play_purchase_events
         WHERE purchase_token_hash='credit-purchase'
      `).get().debt_applied,
      0,
    );
    sqlite.prepare(`
      UPDATE google_play_purchase_events SET debt_applied=10
       WHERE purchase_token_hash='credit-purchase'
    `).run();
    assert.throws(
      () => sqlite.prepare(`
        UPDATE google_play_purchase_events SET debt_applied=11
         WHERE purchase_token_hash='credit-purchase'
      `).run(),
      /CHECK constraint failed/,
    );

    assert.deepEqual(appliedSteps, [
      {
        step: 1,
        files: ["ai-credit-balance-uniqueness.sql", "ai-parent-settings-uniqueness.sql"],
      },
      {
        step: 2,
        files: [
          "premium-funnel.sql",
          "premium-funnel-ai-friend-limit.sql",
          "premium-funnel-ai-schedule-limit.sql",
          "family-lifecycle-funnel.sql",
          "revenue-cost-ledger.sql",
        ],
      },
      {
        step: 3,
        files: [
          "location-confirmation-records.sql",
          "location-history-ingest-quota.sql",
          "location-history-retention.sql",
        ],
      },
      { step: 4, files: ["web-billing.sql"] },
      { step: 5, files: ["web-ai-credit-billing.sql"] },
      { step: 6, files: ["referral-rewards-v2.sql"] },
      {
        step: 7,
        files: ["google-play-rtdn-schema.sql", "google-play-credit-debt-disclosure.sql"],
      },
    ]);
    assert.equal(sqlite.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    sqlite.close();
  }
});

test("기존 웹 결제 DB는 additive 4개만 순서대로 적용하고 불완전 환불 스키마는 HOLD한다", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE family_subscription(
        family_id TEXT PRIMARY KEY,
        status TEXT,
        provider TEXT,
        current_period_end TEXT,
        latest_order_id TEXT
      );
      CREATE TABLE web_billing_checkout_sessions(
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        customer_key TEXT NOT NULL
      );
      CREATE TABLE web_billing_customers(
        family_id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL,
        customer_key TEXT NOT NULL,
        billing_key_ciphertext TEXT,
        billing_key_iv TEXT,
        billing_key_version TEXT,
        plan TEXT NOT NULL,
        status TEXT NOT NULL,
        trial_ends_at TEXT,
        current_period_end TEXT,
        next_charge_at TEXT,
        retry_after TEXT,
        failure_count INTEGER NOT NULL DEFAULT 0,
        cancelled_at TEXT,
        last_order_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
      CREATE TABLE web_billing_trial_claims(
        family_id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL,
        checkout_session_id TEXT NOT NULL UNIQUE,
        plan TEXT NOT NULL,
        status TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        trial_ends_at TEXT NOT NULL,
        converted_order_id TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE billing_provider_reservations(
        family_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        state TEXT NOT NULL,
        reservation_ref TEXT NOT NULL
      );

      INSERT INTO web_billing_checkout_sessions VALUES
        ('checkout-legacy','family-legacy','customer-legacy');
      INSERT INTO web_billing_customers VALUES
        ('family-legacy','parent-legacy','customer-legacy','ciphertext','iv','v1',
         'month','expired',NULL,'2026-09-01 00:00:00+00',NULL,NULL,0,NULL,
         'failed-renewal','2026-07-01 00:00:00+00','2026-08-01 00:00:00+00');
      INSERT INTO web_billing_charge_attempts VALUES
        ('paid-order','family-legacy','checkout-legacy','month',4900,'initial',
         '2026-08-01 00:00:00+00','2026-09-01 00:00:00+00','done',NULL,NULL,
         '${"b".repeat(64)}',NULL,'2026-08-01 00:00:00+00',
         '2026-08-01 00:00:01+00','2026-08-01 00:00:01+00');
      INSERT INTO web_billing_trial_claims VALUES
        ('family-legacy','parent-legacy','checkout-legacy','month','converted',
         '2026-07-25 00:00:00+00','2026-08-01 00:00:00+00','paid-order',
         '2026-08-01 00:00:01+00');
      INSERT INTO family_subscription VALUES
        ('family-legacy','active','toss_web','2026-09-01 00:00:00+00','paid-order');
      INSERT INTO billing_provider_reservations VALUES
        ('family-legacy','toss_web','active','failed-renewal');
    `);

    const plan = resolveWebBillingMigrationPlan(sqlite);
    assert.deepEqual(plan, {
      status: "apply",
      branch: "additive",
      files: [
        "web-billing-key-revocation.sql",
        "google-play-family-trial-claim.sql",
        "web-billing-refunds.sql",
        "web-billing-financial-retention.sql",
      ],
    });
    for (const file of plan.files) sqlite.exec(migration(file));

    assert.deepEqual(resolveWebBillingMigrationPlan(sqlite), {
      status: "ready",
      branch: "additive",
      files: [],
    });
    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT billing_key_revocation_status,billing_key_revocation_attempts,
               last_paid_order_id
          FROM web_billing_customers WHERE family_id='family-legacy'
      `).get() },
      {
        billing_key_revocation_status: "pending",
        billing_key_revocation_attempts: 0,
        last_paid_order_id: "paid-order",
      },
    );
    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT customer_key,refund_status,refunded_amount
          FROM web_billing_charge_attempts WHERE order_id='paid-order'
      `).get() },
      { customer_key: "customer-legacy", refund_status: "none", refunded_amount: 0 },
    );
    assert.equal(
      sqlite.prepare(`
        SELECT provider FROM web_billing_trial_claims WHERE family_id='family-legacy'
      `).get().provider,
      "toss_web",
    );
    assert.equal(
      sqlite.prepare(`
        SELECT reservation_ref FROM billing_provider_reservations WHERE family_id='family-legacy'
      `).get().reservation_ref,
      "paid-order",
    );
    assertObjects(sqlite, "table", ["web_billing_refund_records", "web_billing_financial_records"]);
    assertObjects(sqlite, "index", [
      "idx_web_billing_customers_key_revocation",
      "idx_web_billing_charge_refund_reconcile",
      "idx_web_billing_refund_provider_checked",
      "idx_web_billing_refund_retention",
      "idx_web_billing_financial_retention",
    ]);
  } finally {
    sqlite.close();
  }

  const malformed = new DatabaseSync(":memory:");
  try {
    malformed.exec(`
      CREATE TABLE web_billing_customers(family_id TEXT PRIMARY KEY);
      CREATE TABLE web_billing_trial_claims(family_id TEXT PRIMARY KEY);
      CREATE TABLE web_billing_charge_attempts(
        order_id TEXT PRIMARY KEY,
        refund_status TEXT NOT NULL DEFAULT 'none'
      );
    `);
    const schemaVersionBefore = malformed.prepare("PRAGMA schema_version").get().schema_version;
    assert.deepEqual(resolveWebBillingMigrationPlan(malformed), {
      status: "hold",
      reason: "refund_without_customer_key",
      files: [],
    });
    assert.equal(malformed.prepare("PRAGMA schema_version").get().schema_version, schemaVersionBefore);
    assert.ok(!hasColumn(malformed, "web_billing_charge_attempts", "customer_key"));
  } finally {
    malformed.close();
  }
});

test("기존 웹 AI DB는 unique 확인 뒤 금융 보존 additive만 적용한다", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE ai_credit_balances(
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        child_user_id TEXT NOT NULL,
        parent_id TEXT,
        is_premium INTEGER NOT NULL DEFAULT 0,
        daily_included_limit INTEGER NOT NULL DEFAULT 5,
        daily_included_used INTEGER NOT NULL DEFAULT 0,
        daily_reset_date TEXT NOT NULL,
        purchased_credits INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_ai_credit_balances_family_child_unique
        ON ai_credit_balances(family_id,child_user_id);
      CREATE TABLE ai_credit_ledger(
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        child_user_id TEXT NOT NULL,
        parent_id TEXT,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        source TEXT NOT NULL,
        message_id TEXT,
        transaction_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE web_ai_credit_orders(
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
        debt_applied INTEGER NOT NULL DEFAULT 0,
        refunded_amount INTEGER NOT NULL DEFAULT 0,
        provider_checked_at TEXT,
        client_checked_at TEXT,
        webhook_checked_at TEXT,
        error_code TEXT,
        retry_after TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE UNIQUE INDEX idx_web_ai_credit_payment_hash
        ON web_ai_credit_orders(payment_key_hash) WHERE payment_key_hash IS NOT NULL;
      CREATE INDEX idx_web_ai_credit_family_parent
        ON web_ai_credit_orders(family_id,parent_id,child_user_id,status,created_at);
      CREATE INDEX idx_web_ai_credit_reconcile
        ON web_ai_credit_orders(status,retry_after,claim_expires_at,provider_checked_at);
      CREATE TABLE web_ai_credit_lookup_windows(
        family_id TEXT NOT NULL,
        window_started_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(family_id,window_started_at)
      );
      CREATE INDEX idx_web_ai_credit_lookup_windows_updated
        ON web_ai_credit_lookup_windows(updated_at);

      INSERT INTO web_ai_credit_orders VALUES
        ('ai-order-legacy','family-ai','parent-ai','child-ai','customer-ai',
         'ai-credit-30',30,12000,'KRW','done','2026-08-01 01:00:00+00',
         'idempotency-ai',NULL,NULL,'${"c".repeat(64)}',0,0,
         '2026-08-01 00:10:00+00',NULL,NULL,NULL,NULL,
         '2026-08-01 00:00:00+00','2026-08-01 00:10:00+00','2026-08-01 00:10:00+00');
      INSERT INTO ai_credit_ledger VALUES
        ('ai-ledger-legacy','family-ai','child-ai','parent-ai',30,'purchase',
         'purchase',NULL,'ai-order-legacy','2026-08-01 00:10:00+00');
    `);

    assertObjects(sqlite, "index", ["idx_ai_credit_balances_family_child_unique"]);
    const plan = resolveWebAiMigrationPlan(sqlite);
    assert.deepEqual(plan, {
      status: "apply",
      branch: "additive",
      files: ["web-ai-credit-financial-retention.sql"],
    });
    for (const file of plan.files) sqlite.exec(migration(file));

    assert.deepEqual(resolveWebAiMigrationPlan(sqlite), {
      status: "ready",
      branch: "additive",
      files: [],
    });
    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT record_scope,balance_scope,granted_credits,grant_committed_at,
               refunded_credits,retention_until
          FROM web_ai_credit_orders WHERE order_id='ai-order-legacy'
      `).get() },
      {
        record_scope: "active",
        balance_scope: "active",
        granted_credits: 30,
        grant_committed_at: "2026-08-01 00:10:00+00",
        refunded_credits: 0,
        retention_until: "2031-08-01 00:10:00",
      },
    );
    assertObjects(sqlite, "table", [
      "web_ai_credit_orders",
      "web_ai_credit_detached_balances",
      "web_ai_credit_lookup_windows",
    ]);
    assertObjects(sqlite, "index", [
      "idx_web_ai_credit_payment_hash",
      "idx_web_ai_credit_family_parent",
      "idx_web_ai_credit_reconcile",
      "idx_web_ai_credit_detached_reconcile",
      "idx_web_ai_credit_detached_balance_retention",
      "idx_web_ai_credit_lookup_windows_updated",
    ]);
  } finally {
    sqlite.close();
  }
});

test("다중 파일 단계는 파일별 부분 적용 상태를 readback해 새 SQLite 연결에서 누락분만 재개한다", () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "hyeni-release-migration-"));
  const databasePath = join(tempDirectory, "dress-rehearsal.sqlite");
  let sqlite = new DatabaseSync(databasePath);
  const appliedFiles = [];
  const restart = () => {
    sqlite.close();
    sqlite = null;
    sqlite = new DatabaseSync(databasePath);
  };
  const execute = (file) => {
    sqlite.exec(migration(file));
    appliedFiles.push(file);
  };

  const step2 = [
    {
      file: "premium-funnel.sql",
      ready: (db) => Boolean(
        object(db, "table", "premium_funnel_events")
        && object(db, "table", "premium_funnel_rate_limits")
        && object(db, "index", "idx_premium_funnel_rate_updated"),
      ),
    },
    {
      file: "premium-funnel-ai-friend-limit.sql",
      ready: (db) => tableSqlContains(db, "premium_funnel_events", "'ai_friend_limit'"),
    },
    {
      file: "premium-funnel-ai-schedule-limit.sql",
      ready: (db) => tableSqlContains(db, "premium_funnel_events", "'ai_schedule_limit'"),
    },
    {
      file: "family-lifecycle-funnel.sql",
      ready: (db) => Boolean(
        object(db, "table", "family_lifecycle_events")
        && object(db, "table", "family_lifecycle_daily")
        && object(db, "index", "idx_family_lifecycle_daily_updated"),
      ),
    },
    {
      file: "revenue-cost-ledger.sql",
      ready: (db) => Boolean(
        object(db, "table", "revenue_cost_ledger")
        && object(db, "table", "revenue_cost_coverage")
        && object(db, "index", "idx_revenue_cost_coverage_lookup"),
      ),
    },
  ];
  const step3 = [
    {
      file: "location-confirmation-records.sql",
      ready: (db) => Boolean(
        object(db, "table", "location_confirmation_records")
        && object(db, "trigger", "trg_child_locations_confirmation_insert")
        && object(db, "trigger", "trg_child_locations_confirmation_update")
        && object(db, "trigger", "trg_location_history_confirmation_insert"),
      ),
    },
    {
      file: "location-history-ingest-quota.sql",
      ready: (db) => Boolean(
        object(db, "table", "location_history_ingest_daily_usage")
        && object(db, "trigger", "trg_location_history_ingest_daily_quota"),
      ),
    },
    {
      file: "location-history-retention.sql",
      ready: (db) => Boolean(
        object(db, "index", "idx_location_history_recorded_family")
        && object(db, "index", "idx_location_history_family_recorded_norm"),
      ),
    },
  ];
  const step7 = [
    {
      file: "google-play-rtdn-schema.sql",
      ready: (db) => Boolean(
        object(db, "table", "google_play_rtdn_events")
        && object(db, "table", "google_play_billing_owners")
        && object(db, "table", "google_play_voided_purchase_events")
        && object(db, "index", "idx_google_play_voided_purchase_hash"),
      ),
    },
    {
      file: "google-play-credit-debt-disclosure.sql",
      ready: (db) => hasColumn(db, "google_play_purchase_events", "debt_applied"),
    },
  ];

  try {
    execute(step2[0].file);
    restart();
    assert.deepEqual(pendingFiles(sqlite, step2), [
      "family-lifecycle-funnel.sql",
      "revenue-cost-ledger.sql",
    ]);
    for (const file of pendingFiles(sqlite, step2)) execute(file);
    assert.deepEqual(pendingFiles(sqlite, step2), []);

    sqlite.exec(`
      CREATE TABLE child_locations(
        user_id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        updated_at TEXT NOT NULL,
        accuracy_m REAL
      );
      CREATE TABLE location_history(
        id INTEGER NOT NULL PRIMARY KEY,
        user_id TEXT NOT NULL,
        family_id TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        recorded_at TEXT NOT NULL,
        is_estimated INTEGER NOT NULL DEFAULT 0,
        accuracy_m REAL
      );
    `);
    execute(step3[0].file);
    restart();
    assert.deepEqual(pendingFiles(sqlite, step3), [
      "location-history-ingest-quota.sql",
      "location-history-retention.sql",
    ]);
    for (const file of pendingFiles(sqlite, step3)) execute(file);
    assert.deepEqual(pendingFiles(sqlite, step3), []);

    sqlite.exec(`
      CREATE TABLE billing_provider_reservations(
        family_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        state TEXT NOT NULL,
        reservation_ref TEXT NOT NULL
      );
      CREATE TABLE google_play_purchase_events(
        purchase_token_hash TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        credit_amount INTEGER
      );
    `);
    execute(step7[0].file);
    restart();
    assert.deepEqual(pendingFiles(sqlite, step7), ["google-play-credit-debt-disclosure.sql"]);
    for (const file of pendingFiles(sqlite, step7)) execute(file);
    assert.deepEqual(pendingFiles(sqlite, step7), []);

    assert.deepEqual(appliedFiles, [
      "premium-funnel.sql",
      "family-lifecycle-funnel.sql",
      "revenue-cost-ledger.sql",
      "location-confirmation-records.sql",
      "location-history-ingest-quota.sql",
      "location-history-retention.sql",
      "google-play-rtdn-schema.sql",
      "google-play-credit-debt-disclosure.sql",
    ]);
    assert.equal(sqlite.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally {
    if (sqlite) sqlite.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
