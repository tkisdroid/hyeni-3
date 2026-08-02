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

const migration = await readOptional(
  new URL("../db/revenue-cost-ledger.sql", import.meta.url),
);
const channelNetRevenueSql = await readOptional(
  new URL("../ops/channel-90d-net-revenue.sql", import.meta.url),
);
const canonicalSchema = await readFile(
  new URL("../../cloudflare/schema_d1.sql", import.meta.url),
  "utf8",
);

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name));
}

function indexes(db) {
  return new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => String(row.name)),
  );
}

function insertCoverage(db, {
  id,
  provider,
  category,
  periodStart,
  periodEnd,
  sourceRefHash,
}) {
  db.prepare(
    `INSERT INTO revenue_cost_coverage
       (coverage_id, provider, category, period_start, period_end, source_ref_hash, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, '2026-08-01T00:00:00Z')`,
  ).run(id, provider, category, periodStart, periodEnd, sourceRefHash);
}

test("실제 비용 ledger migration은 재실행 가능하고 정본 schema와 일치한다", () => {
  assert.notEqual(migration, "", "revenue-cost-ledger.sql migration 누락");

  const migrated = new DatabaseSync(":memory:");
  migrated.exec(migration);
  migrated.exec(migration);

  const canonical = new DatabaseSync(":memory:");
  canonical.exec(canonicalSchema);

  for (const table of ["revenue_cost_ledger", "revenue_cost_coverage"]) {
    assert.deepEqual(
      columns(migrated, table),
      columns(canonical, table),
      `${table} migration과 정본 schema 컬럼 불일치`,
    );
  }

  for (const name of [
    "idx_revenue_cost_ledger_provider_date",
    "idx_revenue_cost_ledger_category_date",
    "idx_revenue_cost_coverage_lookup",
  ]) {
    assert.ok(indexes(migrated).has(name), `${name} migration 누락`);
    assert.ok(indexes(canonical).has(name), `${name} 정본 누락`);
  }

  const ledgerColumns = new Set(columns(migrated, "revenue_cost_ledger"));
  for (const forbidden of [
    "family_id",
    "user_id",
    "order_id",
    "purchase_token",
    "metadata",
    "details",
    "note",
  ]) {
    assert.equal(ledgerColumns.has(forbidden), false, `원시·자유 입력 컬럼 금지: ${forbidden}`);
  }

  migrated.prepare(
    `INSERT INTO revenue_cost_ledger
       (entry_id, provider, category, amount_krw, occurred_on, source_ref_hash, recorded_at)
     VALUES (?, 'google_play', 'provider_fee', 735, '2026-07-31', ?, '2026-08-01T00:00:00Z')`,
  ).run("11111111-1111-4111-8111-111111111111", "a".repeat(64));

  assert.throws(() => migrated.prepare(
    `INSERT INTO revenue_cost_ledger
       (entry_id, provider, category, amount_krw, occurred_on, source_ref_hash, recorded_at)
     VALUES (?, 'apple_store', 'provider_fee', 1, '2026-07-31', ?, '2026-08-01T00:00:00Z')`,
  ).run("22222222-2222-4222-8222-222222222222", "b".repeat(64)), /CHECK constraint failed/);
  assert.throws(() => migrated.prepare(
    `INSERT INTO revenue_cost_ledger
       (entry_id, provider, category, amount_krw, occurred_on, source_ref_hash, recorded_at)
     VALUES (?, 'google_play', 'estimated_tax', 1, '2026-07-31', ?, '2026-08-01T00:00:00Z')`,
  ).run("33333333-3333-4333-8333-333333333333", "c".repeat(64)), /CHECK constraint failed/);
  assert.throws(() => migrated.prepare(
    `INSERT INTO revenue_cost_ledger
       (entry_id, provider, category, amount_krw, occurred_on, source_ref_hash, recorded_at)
     VALUES (?, 'google_play', 'provider_fee', 0, '2026-07-31', ?, '2026-08-01T00:00:00Z')`,
  ).run("44444444-4444-4444-8444-444444444444", "d".repeat(64)), /CHECK constraint failed/);
  assert.throws(() => migrated.prepare(
    `INSERT INTO revenue_cost_ledger
       (entry_id, provider, category, amount_krw, occurred_on, source_ref_hash, recorded_at)
     VALUES (?, 'google_play', 'provider_fee', 1, '2026-07-31', 'raw-order-id', '2026-08-01T00:00:00Z')`,
  ).run("55555555-5555-4555-8555-555555555555"), /CHECK constraint failed/);

  assert.throws(() => insertCoverage(migrated, {
    id: "66666666-6666-4666-8666-666666666666",
    provider: "google_play",
    category: "support_cost",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-01",
    sourceRefHash: "e".repeat(64),
  }), /CHECK constraint failed/);

  canonical.close();
  migrated.close();
});

test("채널별 90일 순매출은 네 비용 범위가 모두 확인된 경우에만 계산된다", () => {
  assert.notEqual(channelNetRevenueSql, "", "channel-90d-net-revenue.sql 운영 SQL 누락");

  const db = new DatabaseSync(":memory:");
  db.exec(canonicalSchema);

  const params = db.prepare(
    `SELECT date('now', '+9 hours', '-90 days') AS window_start,
            date('now', '+9 hours') AS window_end,
            date('now', '+9 hours', '-1 day') AS activity_date,
            datetime(date('now', '+9 hours', '-1 day'), '-9 hours') AS event_at`,
  ).get();

  const insertLifecycle = db.prepare(
    `INSERT INTO family_lifecycle_daily
       (family_key, activity_date, parent_active, child_signal, first_recorded_at, updated_at)
     VALUES (?, ?, 1, 1, ?, ?)`,
  );
  const insertPaid = db.prepare(
    `INSERT INTO premium_funnel_events
       (event_id, family_key, event, provider, plan, occurred_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const googleFamily = "1".repeat(64);
  const tossFamily = "2".repeat(64);
  insertLifecycle.run(googleFamily, params.activity_date, params.event_at, params.event_at);
  insertLifecycle.run(tossFamily, params.activity_date, params.event_at, params.event_at);
  insertPaid.run(
    "77777777-7777-4777-8777-777777777777",
    googleFamily,
    "entitlement_activated",
    "google_play",
    "month",
    params.event_at,
    params.event_at,
  );
  insertPaid.run(
    "88888888-8888-4888-8888-888888888888",
    tossFamily,
    "renewal",
    "toss_payments",
    "year",
    params.event_at,
    params.event_at,
  );

  const insertCost = db.prepare(
    `INSERT INTO revenue_cost_ledger
       (entry_id, provider, category, amount_krw, occurred_on, source_ref_hash, recorded_at)
     VALUES (?, 'google_play', ?, ?, ?, ?, '2026-08-01T00:00:00Z')`,
  );
  const costRows = [
    ["99999999-9999-4999-8999-999999999991", "provider_fee", 100, "3".repeat(64)],
    ["99999999-9999-4999-8999-999999999992", "confirmed_refund", 200, "4".repeat(64)],
    ["99999999-9999-4999-8999-999999999993", "ai_variable_cost", 300, "5".repeat(64)],
    ["99999999-9999-4999-8999-999999999994", "support_cost", 400, "6".repeat(64)],
  ];
  for (const [id, category, amount, hash] of costRows) {
    insertCost.run(id, category, amount, params.activity_date, hash);
  }

  const categories = [
    "provider_fee",
    "confirmed_refund",
    "ai_variable_cost",
    "support_cost",
  ];
  const googleCoverageHashes = ["7", "8", "9", "a"];
  categories.forEach((category, index) => insertCoverage(db, {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
    provider: "google_play",
    category,
    periodStart: params.window_start,
    periodEnd: params.window_end,
    sourceRefHash: googleCoverageHashes[index].repeat(64),
  }));
  const tossCoverageHashes = ["b", "c", "d"];
  categories.slice(0, 3).forEach((category, index) => insertCoverage(db, {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, "0")}`,
    provider: "toss_payments",
    category,
    periodStart: params.window_start,
    periodEnd: params.window_end,
    sourceRefHash: tossCoverageHashes[index].repeat(64),
  }));

  const first = db.prepare(channelNetRevenueSql).all().map((row) => ({ ...row }));
  assert.deepEqual(first, [
    {
      provider: "google_play",
      window_start: params.window_start,
      window_end_exclusive: params.window_end,
      maf_30d: 2,
      subscription_gross_90d_krw: 4900,
      provider_fee_krw: 100,
      confirmed_refund_krw: 200,
      ai_variable_cost_krw: 300,
      support_cost_krw: 400,
      net_revenue_90d_krw: 3900,
      net_revenue_per_maf_krw: 1950,
      calculation_status: "계산 가능",
      missing_cost_categories: null,
    },
    {
      provider: "toss_payments",
      window_start: params.window_start,
      window_end_exclusive: params.window_end,
      maf_30d: 2,
      subscription_gross_90d_krw: 39000,
      provider_fee_krw: 0,
      confirmed_refund_krw: 0,
      ai_variable_cost_krw: 0,
      support_cost_krw: 0,
      net_revenue_90d_krw: null,
      net_revenue_per_maf_krw: null,
      calculation_status: "계산 불가",
      missing_cost_categories: "support_cost",
    },
  ]);

  insertCoverage(db, {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    provider: "toss_payments",
    category: "support_cost",
    periodStart: params.window_start,
    periodEnd: params.window_end,
    sourceRefHash: "f".repeat(64),
  });
  const tossAfterZeroCostConfirmation = {
    ...db.prepare(channelNetRevenueSql).all()
      .find((row) => row.provider === "toss_payments"),
  };
  assert.equal(tossAfterZeroCostConfirmation.calculation_status, "계산 가능");
  assert.equal(tossAfterZeroCostConfirmation.missing_cost_categories, null);
  assert.equal(tossAfterZeroCostConfirmation.net_revenue_90d_krw, 39000);
  assert.equal(tossAfterZeroCostConfirmation.net_revenue_per_maf_krw, 19500);

  db.exec("DELETE FROM family_lifecycle_daily");
  const zeroMafRows = db.prepare(channelNetRevenueSql).all();
  for (const row of zeroMafRows) {
    assert.equal(row.maf_30d, 0);
    assert.equal(row.net_revenue_per_maf_krw, null);
    assert.equal(row.calculation_status, "계산 불가");
  }

  assert.doesNotMatch(channelNetRevenueSql, /\b(?:0\.15|0\.03|15\s*%|3\s*%)\b/);
  db.close();
});
