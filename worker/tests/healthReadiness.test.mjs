import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cloudflareWorkersShim = new URL("./helpers/cloudflareWorkersShim.mjs", import.meta.url).href;
const resolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: cloudflareWorkersShim, shortCircuit: true };
    }
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
after(() => resolutionHook.deregister());

const canonicalSchema = await readFile(
  new URL("../../cloudflare/schema_d1.sql", import.meta.url),
  "utf8",
);
const premiumFunnelMigration = await readFile(
  new URL("../db/premium-funnel.sql", import.meta.url),
  "utf8",
);
const { isReleaseDatabaseReady, DATABASE_READINESS_STATEMENTS } = await import(
  pathToFileURL(resolve(workerDir, "lib/healthReadiness.ts")).href
);
const workerEntry = (await import(pathToFileURL(resolve(workerDir, "index.ts")).href)).default;

class D1StatementAdapter {
  constructor(sqlite, sql) {
    this.sqlite = sqlite;
    this.sql = sql;
  }

  async first() {
    return this.sqlite.prepare(this.sql).get() ?? null;
  }
}

class D1DatabaseAdapter {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new D1StatementAdapter(this.sqlite, sql);
  }
}

function canonicalDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(canonicalSchema);
  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

async function assertNotReadyAfterSchemaMutation(statement) {
  const { sqlite, db } = canonicalDatabase();
  try {
    sqlite.exec(statement);
    assert.equal(await isReleaseDatabaseReady(db), false, statement);
  } finally {
    sqlite.close();
  }
}

test("정본 스키마와 2026-08-01 출시 migration 객체가 모두 있으면 ready다", async () => {
  const { sqlite, db } = canonicalDatabase();
  assert.equal(await isReleaseDatabaseReady(db), true);
  sqlite.close();
});

test("필수 테이블·인덱스·trigger·최신 컬럼 중 하나라도 누락되면 fail-closed한다", async () => {
  for (const statement of [
    "DROP TABLE premium_funnel_events",
    "DROP INDEX uq_ai_parent_settings_family_child",
    "DROP INDEX idx_web_billing_charge_refund_reconcile",
    "DROP TRIGGER trg_referral_location_evidence_snapshot",
    "ALTER TABLE notification_settings DROP COLUMN quiet_hours_updated_at",
  ]) {
    const { sqlite, db } = canonicalDatabase();
    sqlite.exec(statement);
    assert.equal(await isReleaseDatabaseReady(db), false, statement);
    sqlite.close();
  }
});

test("전역 commerce control 테이블과 key/value/감사 컬럼이 하나라도 없으면 fail-closed한다", async () => {
  for (const statement of [
    "DROP TABLE app_global_settings",
    `DROP TABLE app_global_settings;
     CREATE TABLE app_global_settings (
       value TEXT NOT NULL DEFAULT '', updated_by TEXT,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    `DROP TABLE app_global_settings;
     CREATE TABLE app_global_settings (
       key TEXT PRIMARY KEY, updated_by TEXT,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    `DROP TABLE app_global_settings;
     CREATE TABLE app_global_settings (
       key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '',
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    `DROP TABLE app_global_settings;
     CREATE TABLE app_global_settings (
       key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_by TEXT
     )`,
  ]) {
    await assertNotReadyAfterSchemaMutation(statement);
  }
});

test("결제·환불·AI 크레딧 런타임 필수 컬럼이 하나라도 없으면 fail-closed한다", async () => {
  for (const statement of [
    "ALTER TABLE ai_credit_balances DROP COLUMN parent_id",
    "ALTER TABLE ai_credit_ledger DROP COLUMN message_id",
    "ALTER TABLE web_billing_checkout_sessions DROP COLUMN error_code",
    "ALTER TABLE web_billing_customers DROP COLUMN billing_key_revocation_attempts",
    "ALTER TABLE web_billing_charge_attempts DROP COLUMN refund_webhook_checked_at",
    "ALTER TABLE web_billing_refund_records DROP COLUMN transaction_count",
    "ALTER TABLE web_billing_trial_claims DROP COLUMN provider",
    "ALTER TABLE billing_provider_reservations DROP COLUMN reservation_ref",
    "ALTER TABLE web_billing_financial_records DROP COLUMN detached_at",
    "ALTER TABLE web_ai_credit_orders DROP COLUMN grant_committed_at",
    "ALTER TABLE web_ai_credit_detached_balances DROP COLUMN updated_at",
    "ALTER TABLE web_ai_credit_lookup_windows DROP COLUMN attempts",
  ]) {
    await assertNotReadyAfterSchemaMutation(statement);
  }
});

test("AI balance unique index는 같은 이름이어도 UNIQUE·대상 table·컬럼 순서가 정확해야 ready다", async () => {
  for (const replacement of [
    "CREATE INDEX idx_ai_credit_balances_family_child_unique ON ai_credit_balances(family_id, child_user_id)",
    "CREATE UNIQUE INDEX idx_ai_credit_balances_family_child_unique ON ai_credit_balances(child_user_id, family_id)",
    "CREATE UNIQUE INDEX idx_ai_credit_balances_family_child_unique ON users(id)",
  ]) {
    await assertNotReadyAfterSchemaMutation(`
      DROP INDEX idx_ai_credit_balances_family_child_unique;
      ${replacement};
    `);
  }
});

test("AI 부모 설정 index도 UNIQUE·대상 table·컬럼 순서가 정확해야 ready다", async () => {
  for (const replacement of [
    "CREATE INDEX uq_ai_parent_settings_family_child ON ai_parent_settings(family_id, child_user_id)",
    "CREATE UNIQUE INDEX uq_ai_parent_settings_family_child ON ai_parent_settings(child_user_id, family_id)",
    "CREATE UNIQUE INDEX uq_ai_parent_settings_family_child ON users(id)",
  ]) {
    await assertNotReadyAfterSchemaMutation(`
      DROP INDEX uq_ai_parent_settings_family_child;
      ${replacement};
    `);
  }
});

test("premium funnel table이 있어도 ai_friend_limit source CHECK가 없으면 ready가 아니다", async () => {
  const legacyMigration = premiumFunnelMigration.replace(
    "'remote_ring', 'remote_audio', 'ai_friend_limit', 'ai_schedule_limit', 'ai_daily_summary'",
    "'remote_ring', 'remote_audio', 'ai_schedule_limit', 'ai_daily_summary'",
  );
  assert.notEqual(legacyMigration, premiumFunnelMigration);

  const { sqlite, db } = canonicalDatabase();
  try {
    sqlite.exec("DROP TABLE premium_funnel_events");
    sqlite.exec(legacyMigration);
    assert.equal(await isReleaseDatabaseReady(db), false);
  } finally {
    sqlite.close();
  }
});

test("premium funnel table이 있어도 ai_schedule_limit source CHECK가 없으면 ready가 아니다", async () => {
  const legacyMigration = premiumFunnelMigration.replace(
    "'remote_ring', 'remote_audio', 'ai_friend_limit', 'ai_schedule_limit', 'ai_daily_summary'",
    "'remote_ring', 'remote_audio', 'ai_friend_limit', 'ai_daily_summary'",
  );
  assert.notEqual(legacyMigration, premiumFunnelMigration);

  const { sqlite, db } = canonicalDatabase();
  try {
    sqlite.exec("DROP TABLE premium_funnel_events");
    sqlite.exec(legacyMigration);
    assert.equal(await isReleaseDatabaseReady(db), false);
  } finally {
    sqlite.close();
  }
});

test("결제·알림·비용·가족 전환 unique index는 같은 이름의 non-UNIQUE index로 대체해도 fail-closed한다", async () => {
  for (const [name, replacement] of [
    [
      "idx_fcm_tokens_token_active_unique",
      "CREATE INDEX idx_fcm_tokens_token_active_unique ON fcm_tokens(fcm_token) WHERE disabled_at IS NULL",
    ],
    [
      "idx_push_subscriptions_endpoint_active_unique",
      "CREATE INDEX idx_push_subscriptions_endpoint_active_unique ON push_subscriptions(endpoint) WHERE disabled_at IS NULL",
    ],
    [
      "idx_push_sent_event_notif",
      "CREATE INDEX idx_push_sent_event_notif ON push_sent(event_id, notif_key)",
    ],
    [
      "idx_web_billing_charge_initial_session",
      "CREATE INDEX idx_web_billing_charge_initial_session ON web_billing_charge_attempts(checkout_session_id) WHERE kind='initial' AND checkout_session_id IS NOT NULL",
    ],
    [
      "idx_web_ai_credit_payment_hash",
      "CREATE INDEX idx_web_ai_credit_payment_hash ON web_ai_credit_orders(payment_key_hash) WHERE payment_key_hash IS NOT NULL",
    ],
    [
      "idx_revenue_cost_ledger_source_unique",
      "CREATE INDEX idx_revenue_cost_ledger_source_unique ON revenue_cost_ledger(provider, category, source_ref_hash)",
    ],
    [
      "idx_revenue_cost_coverage_source_unique",
      "CREATE INDEX idx_revenue_cost_coverage_source_unique ON revenue_cost_coverage(provider, category, period_start, period_end, source_ref_hash)",
    ],
    [
      "idx_family_lifecycle_first_milestone",
      "CREATE INDEX idx_family_lifecycle_first_milestone ON family_lifecycle_events(family_key, event) WHERE event IN ('family_created','first_location','first_arrival')",
    ],
  ]) {
    await assertNotReadyAfterSchemaMutation(`
      DROP INDEX ${name};
      ${replacement};
    `);
  }
});

test("결제·알림·가족 전환 partial unique index는 정본 predicate가 달라지면 fail-closed한다", async () => {
  for (const [name, replacement] of [
    [
      "idx_fcm_tokens_token_active_unique",
      "CREATE UNIQUE INDEX idx_fcm_tokens_token_active_unique ON fcm_tokens(fcm_token) WHERE disabled_at IS NOT NULL",
    ],
    [
      "idx_push_subscriptions_endpoint_active_unique",
      "CREATE UNIQUE INDEX idx_push_subscriptions_endpoint_active_unique ON push_subscriptions(endpoint) WHERE disabled_at IS NOT NULL",
    ],
    [
      "idx_web_billing_charge_initial_session",
      "CREATE UNIQUE INDEX idx_web_billing_charge_initial_session ON web_billing_charge_attempts(checkout_session_id) WHERE kind='renewal' AND checkout_session_id IS NOT NULL",
    ],
    [
      "idx_web_ai_credit_payment_hash",
      "CREATE UNIQUE INDEX idx_web_ai_credit_payment_hash ON web_ai_credit_orders(payment_key_hash) WHERE payment_key_hash IS NULL",
    ],
    [
      "idx_family_lifecycle_first_milestone",
      "CREATE UNIQUE INDEX idx_family_lifecycle_first_milestone ON family_lifecycle_events(family_key, event) WHERE event='family_created'",
    ],
  ]) {
    await assertNotReadyAfterSchemaMutation(`
      DROP INDEX ${name};
      ${replacement};
    `);
  }
});

test("추천 보상 준비 partial expression index는 동명 index의 predicate 누락·변조를 fail-closed한다", async () => {
  for (const replacement of [
    `CREATE INDEX idx_referral_completions_v2_ready
       ON referral_completions_v2(substr(created_at,1,19), id)`,
    `CREATE INDEX idx_referral_completions_v2_ready
       ON referral_completions_v2(substr(created_at,1,19), id)
       WHERE status='pending' AND referee_child_user_id IS NOT NULL`,
  ]) {
    await assertNotReadyAfterSchemaMutation(`
      DROP INDEX idx_referral_completions_v2_ready;
      ${replacement};
    `);
  }
});

test("알림 dedupe·비용 unique index는 컬럼 순서가 달라지면 fail-closed한다", async () => {
  for (const [name, replacement] of [
    [
      "idx_push_sent_event_notif",
      "CREATE UNIQUE INDEX idx_push_sent_event_notif ON push_sent(notif_key, event_id)",
    ],
    [
      "idx_revenue_cost_ledger_source_unique",
      "CREATE UNIQUE INDEX idx_revenue_cost_ledger_source_unique ON revenue_cost_ledger(category, provider, source_ref_hash)",
    ],
    [
      "idx_revenue_cost_coverage_source_unique",
      "CREATE UNIQUE INDEX idx_revenue_cost_coverage_source_unique ON revenue_cost_coverage(provider, category, period_end, period_start, source_ref_hash)",
    ],
  ]) {
    await assertNotReadyAfterSchemaMutation(`
      DROP INDEX ${name};
      ${replacement};
    `);
  }
});

test("환불 reconcile partial index는 컬럼 순서와 predicate가 정본과 다르면 fail-closed한다", async () => {
  for (const replacement of [
    `CREATE INDEX idx_web_billing_charge_refund_reconcile
       ON web_billing_charge_attempts(provider_checked_at, completed_at, order_id)`,
    `CREATE INDEX idx_web_billing_charge_refund_reconcile
       ON web_billing_charge_attempts(provider_checked_at, completed_at, order_id)
       WHERE status='done'`,
    `CREATE INDEX idx_web_billing_charge_refund_reconcile
       ON web_billing_charge_attempts(completed_at, provider_checked_at, order_id)
       WHERE status='done' AND refund_status<>'full'`,
    `CREATE INDEX idx_web_billing_charge_refund_reconcile
       ON web_billing_charge_attempts(provider_checked_at, completed_at, order_id)
       WHERE status='done' AND refund_status<>'full' AND 0`,
  ]) {
    await assertNotReadyAfterSchemaMutation(`
      DROP INDEX idx_web_billing_charge_refund_reconcile;
      ${replacement};
    `);
  }
});

test("핵심 trigger는 같은 이름과 대상 table만 남은 inert body를 fail-closed한다", async () => {
  for (const [name, table] of [
    ["trg_child_locations_confirmation_insert", "child_locations"],
    ["trg_child_locations_confirmation_update", "child_locations"],
    ["trg_location_history_confirmation_insert", "location_history"],
    ["trg_location_history_ingest_daily_quota", "location_history"],
    ["trg_referral_location_evidence_snapshot", "location_confirmation_records"],
  ]) {
    await assertNotReadyAfterSchemaMutation(`
      DROP TRIGGER ${name};
      CREATE TRIGGER ${name} AFTER INSERT ON ${table} BEGIN SELECT 1; END;
    `);
  }
});

test("공개 health는 행 수 없이 ready만 반환하고 응답을 캐시하지 않는다", async () => {
  const { sqlite, db } = canonicalDatabase();
  const response = await workerEntry.fetch(
    new Request("https://worker.test/api/health"),
    { DB: db },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, status: "ready" });
  sqlite.close();
});

test("스키마 누락과 DB 조회 장애는 민감 정보 없이 서로 다른 고정 503 응답이다", async () => {
  const { sqlite, db } = canonicalDatabase();
  sqlite.exec("DROP TABLE revenue_cost_coverage");
  const schemaResponse = await workerEntry.fetch(
    new Request("https://worker.test/api/health"),
    { DB: db },
  );
  assert.equal(schemaResponse.status, 503);
  assert.deepEqual(await schemaResponse.json(), {
    ok: false,
    error: "health_check_failed",
    reason: "schema_not_ready",
  });
  sqlite.close();

  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const databaseResponse = await workerEntry.fetch(
      new Request("https://worker.test/api/health"),
      {
        DB: {
          prepare() {
            throw new Error("민감한 내부 DB 오류 원문");
          },
        },
      },
    );
    assert.equal(databaseResponse.status, 503);
    const body = await databaseResponse.json();
    assert.deepEqual(body, {
      ok: false,
      error: "health_check_failed",
      reason: "database_unavailable",
    });
    assert.doesNotMatch(JSON.stringify(body), /민감한 내부 DB 오류 원문/);
    assert.deepEqual(logged, [["[health] D1 readiness query failed"]]);
  } finally {
    console.error = originalConsoleError;
  }
});

// D1은 SQLITE_MAX_EXPR_DEPTH를 100으로 낮춰 놓았다. 계약을 한 문장에 AND로 모두 이으면
// "Expression tree is too large (maximum depth 100)"로 실패해 /api/health가 항상 503이 된다
// (2026-08-03 실사고 — 로컬 SQLite는 기본 1000이라 통과해서 배포 전까지 드러나지 않았다).
test("스키마 준비 검사는 D1 표현식 깊이 한계 안에서 여러 문장으로 나눠 실행한다", () => {
  assert.ok(Array.isArray(DATABASE_READINESS_STATEMENTS));
  assert.ok(DATABASE_READINESS_STATEMENTS.length > 1, "한 문장에 모두 넣으면 D1이 거부한다");
  for (const statement of DATABASE_READINESS_STATEMENTS) {
    const andDepth = (statement.match(/\bAND\b/g) ?? []).length;
    assert.ok(
      andDepth < 90,
      `문장 하나의 AND가 ${andDepth}개다 — D1 depth 100 한계에 닿는다`,
    );
  }
});
