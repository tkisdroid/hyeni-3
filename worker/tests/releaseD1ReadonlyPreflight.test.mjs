import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const preflightSql = readFileSync(
  new URL("../ops/release-d1-readonly-preflight.sql", import.meta.url),
  "utf8",
);
const canonicalSchema = readFileSync(
  new URL("../../cloudflare/schema_d1.sql", import.meta.url),
  "utf8",
);

function plain(row) {
  return { ...row };
}

function runPreflight(sqlite) {
  return plain(sqlite.prepare(preflightSql).get());
}

test("정본 스키마의 출시 필수 객체와 컬럼을 read-only 단일 행으로 확인한다", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(canonicalSchema);

  const result = runPreflight(sqlite);
  assert.equal(result.required_objects, 25);
  assert.equal(result.present_objects, 25);
  assert.equal(result.missing_objects, 0);
  assert.equal(result.duplicate_groups, 0);
  assert.equal(result.duplicate_rows, 0);
  assert.equal(result.rows_removed_by_merge, 0);
  assert.equal(result.ai_parent_settings_duplicate_groups, 0);
  assert.equal(result.ai_parent_settings_duplicate_rows, 0);
  assert.equal(result.ai_parent_settings_rows_to_normalize, 0);
  assert.equal(result.ai_parent_settings_max_group_rows, 0);
  assert.equal(result.has_exact_ai_parent_settings_unique, 1);
  assert.equal(result.has_ai_friend_limit_source, 1);
  assert.equal(result.has_ai_schedule_limit_source, 1);
  assert.equal(result.has_debt_applied, 1);
  assert.equal(result.has_refund_status, 1);
  assert.equal(result.has_customer_key, 1);
  assert.equal(result.has_web_ai_record_scope, 1);
  assert.match(String(result.observed_at), /^\d{4}-\d{2}-\d{2} /);
  sqlite.close();
});

test("구형 운영 스키마와 중복 balance 위험을 식별자 없이 집계한다", () => {
  const sqlite = new DatabaseSync(":memory:");
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
    CREATE TABLE google_play_rtdn_events(message_id TEXT PRIMARY KEY);
    CREATE TABLE google_play_billing_owners(
      obfuscated_account_id TEXT NOT NULL,
      obfuscated_profile_id TEXT NOT NULL,
      PRIMARY KEY(obfuscated_account_id, obfuscated_profile_id)
    );
    CREATE TABLE ai_parent_settings(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL
    );
    INSERT INTO ai_credit_balances VALUES
      ('balance-1','family-a','child-a',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:01:00'),
      ('balance-2','family-a','child-a',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:02:00'),
      ('balance-3','family-a','child-a',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:03:00'),
      ('balance-4','family-a','child-a',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:04:00'),
       ('balance-5','family-a','child-a',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:05:00'),
       ('balance-6','family-a','child-a',NULL,0,5,0,'2026-08-01',0,'2026-08-01 00:06:00');
    INSERT INTO ai_parent_settings VALUES
      ('setting-1','family-a','child-a'),
      ('setting-2','family-a','child-a'),
      ('setting-3','family-a','child-a'),
      ('setting-4','family-b','child-b');
  `);

  const result = runPreflight(sqlite);
  assert.deepEqual(result, {
    observed_at: result.observed_at,
    required_objects: 25,
    present_objects: 2,
    missing_objects: 23,
    duplicate_groups: 1,
    duplicate_rows: 6,
    rows_removed_by_merge: 5,
    preserved_purchased_total: 0,
    unsafe_sum_total: 0,
    preserved_daily_used_total: 0,
    unsafe_daily_used_sum: 0,
    max_reset_date_variants: 1,
    max_parent_variants: 0,
    max_premium_variants: 1,
    max_limit_variants: 1,
    ai_parent_settings_duplicate_groups: 1,
    ai_parent_settings_duplicate_rows: 3,
    ai_parent_settings_rows_to_normalize: 2,
    ai_parent_settings_max_group_rows: 3,
    has_exact_ai_parent_settings_unique: 0,
    has_ai_friend_limit_source: 0,
    has_ai_schedule_limit_source: 0,
    has_debt_applied: 0,
    has_refund_status: 0,
    has_customer_key: 0,
    has_web_ai_record_scope: 0,
  });
  sqlite.close();
});

test("이름만 같은 잘못된 AI 설정 index는 exact UNIQUE로 인정하지 않는다", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(canonicalSchema);
  sqlite.exec(`
    DROP INDEX uq_ai_parent_settings_family_child;
    CREATE INDEX uq_ai_parent_settings_family_child ON ai_parent_settings(id);
  `);

  const result = runPreflight(sqlite);
  assert.equal(result.required_objects, 25);
  assert.equal(result.present_objects, 25);
  assert.equal(result.missing_objects, 0);
  assert.equal(result.has_exact_ai_parent_settings_unique, 0);
  sqlite.close();
});

test("preflight SQL은 원본 행·개인 식별자·쓰기 구문을 출력하지 않는다", () => {
  const executable = preflightSql
    .replace(/--[^\r\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|VACUUM|REINDEX|ATTACH|DETACH)\b/i);
  assert.doesNotMatch(executable, /\bSELECT\s+\*/i);
  assert.doesNotMatch(executable, /\b(?:family_id|child_user_id|parent_id|id)\s+AS\s+[a-z_]*\b/i);
  assert.doesNotMatch(executable, /\b(?:purchase_token|payment_key|order_id|user_id|email|phone|lat|lng|address)\b/i);
  assert.match(executable, /CROSS JOIN duplicate_rollup/i);
});
