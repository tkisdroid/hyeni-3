import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = await readFile(new URL("../../cloudflare/schema_d1.sql", import.meta.url), "utf8");
const storageQuotaMigration = await readFile(
  new URL("../db/storage-upload-daily-usage.sql", import.meta.url),
  "utf8",
);
const familyStorageQuotaMigration = await readFile(
  new URL("../db/storage-upload-family-daily-usage.sql", import.meta.url),
  "utf8",
);
const anonymousSignupProtectionMigration = await readFile(
  new URL("../db/anonymous-signup-protection.sql", import.meta.url),
  "utf8",
);
const familyUnpairCleanupMigration = await readFile(
  new URL("../db/family-unpair-cleanup-jobs.sql", import.meta.url),
  "utf8",
);
const accountStorageMutationSafetyMigration = await readFile(
  new URL("../db/account-storage-mutation-safety.sql", import.meta.url),
  "utf8",
);
const storageMultipartJournalMigration = await readFile(
  new URL("../db/storage-multipart-upload-journal.sql", import.meta.url),
  "utf8",
);
const contentSafetyMigration = await readFile(
  new URL("../db/content-safety.sql", import.meta.url),
  "utf8",
);
const oauthStateMigration = await readFile(
  new URL("../db/oauth-state-transactions.sql", import.meta.url),
  "utf8",
);
const oauthExchangeRecoveryMigration = await readFile(
  new URL("../db/oauth-exchange-recovery.sql", import.meta.url),
  "utf8",
);
const remoteListenConsentMigration = await readFile(
  new URL("../db/remote-listen-consent.sql", import.meta.url),
  "utf8",
);
const memoNotificationOutboxMigration = await readFile(
  new URL("../db/memo-notification-outbox.sql", import.meta.url),
  "utf8",
);
const memoInteractionLeasesMigration = await readFile(
  new URL("../db/memo-interaction-leases.sql", import.meta.url),
  "utf8",
);
const webBillingMigration = await readFile(
  new URL("../db/web-billing.sql", import.meta.url),
  "utf8",
);
const authEntryUniquenessMigration = await readFile(
  new URL("../db/auth-entry-uniqueness.sql", import.meta.url),
  "utf8",
);
const appGlobalSettingsMigration = await readFile(
  new URL("../db/app-global-settings.sql", import.meta.url),
  "utf8",
);
const notificationQuietHoursMigrationUrl = new URL(
  "../db/notification-quiet-hours.sql",
  import.meta.url,
);
const studyMarketMigrationUrl = new URL(
  "../db/study-market.sql",
  import.meta.url,
);

function bootstrap() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  return db;
}

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)));
}

function columnNotNull(db, table, column) {
  const row = db.prepare(`PRAGMA table_info(${table})`).all()
    .find((candidate) => String(candidate.name) === column);
  return Number(row?.notnull ?? 0);
}

function tableColumnContract(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => ({
    name: String(row.name),
    type: String(row.type),
    notnull: Number(row.notnull),
    defaultValue: row.dflt_value == null ? null : String(row.dflt_value),
    primaryKeyOrder: Number(row.pk),
  }));
}

function indexes(db) {
  return new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => String(row.name)),
  );
}

test("정본 D1 스키마는 빈 DB에서 한 번에 실행된다", () => {
  const db = bootstrap();
  assert.ok(db.prepare("SELECT 1 FROM family_members LIMIT 1").get() === undefined);
  db.close();
});

test("Study market 정본과 additive migration은 국가·학년·감사 열을 함께 제공한다", async () => {
  const migration = await readFile(studyMarketMigrationUrl, "utf8");
  const migrated = new DatabaseSync(":memory:");
  migrated.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE families(id TEXT PRIMARY KEY);
    CREATE TABLE family_members(id TEXT PRIMARY KEY);
  `);
  migrated.exec(migration);
  for (const [table, expected] of [
    ["users", ["registration_country"]],
    ["families", ["service_country", "service_country_source", "service_country_confirmed_at", "study_market", "service_country_row_version"]],
    ["family_members", ["learning_grade_override", "learning_grade_row_version"]],
  ]) {
    const actual = columns(migrated, table);
    for (const name of expected) assert.ok(actual.has(name), `${table}.${name}`);
  }
  assert.ok(columns(migrated, "study_setting_audit").has("request_id"));
  assert.ok(columns(migrated, "study_setting_audit").has("request_row_version"));
  migrated.close();

  const canonical = bootstrap();
  for (const [table, expected] of [
    ["users", ["registration_country"]],
    ["families", ["service_country", "study_market", "service_country_row_version"]],
    ["family_members", ["learning_grade_override", "learning_grade_row_version"]],
  ]) {
    const actual = columns(canonical, table);
    for (const name of expected) assert.ok(actual.has(name), `${table}.${name}`);
  }
  assert.ok(columns(canonical, "study_setting_audit").has("request_id"));
  assert.ok(columns(canonical, "study_setting_audit").has("request_row_version"));
  canonical.close();
});

test("Study market schema 제약은 source·market·학년의 허용값만 저장한다", async () => {
  const migration = await readFile(studyMarketMigrationUrl, "utf8");
  const migrated = new DatabaseSync(":memory:");
  migrated.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE families(id TEXT PRIMARY KEY);
    CREATE TABLE family_members(id TEXT PRIMARY KEY);
  `);
  migrated.exec(migration);
  migrated.prepare("INSERT INTO users(id,registration_country) VALUES ('user-ok','KR')").run();
  assert.throws(() => migrated.prepare("INSERT INTO users(id,registration_country) VALUES ('user-bad','KOR')").run(), /CHECK constraint failed/);
  migrated.prepare("INSERT INTO families(id,service_country,service_country_source,study_market) VALUES ('family-ok','KR','guardian_confirmed','KR')").run();
  assert.throws(() => migrated.prepare("INSERT INTO families(id,service_country_source) VALUES ('family-source','not-a-source')").run(), /CHECK constraint failed/);
  assert.throws(() => migrated.prepare("INSERT INTO families(id,study_market) VALUES ('family-market','JP')").run(), /CHECK constraint failed/);
  migrated.prepare("INSERT INTO family_members(id,learning_grade_override) VALUES ('member-ok',3)").run();
  assert.throws(() => migrated.prepare("INSERT INTO family_members(id,learning_grade_override) VALUES ('member-grade',2)").run(), /CHECK constraint failed/);
  migrated.close();

  const canonical = bootstrap();
  canonical.prepare("INSERT INTO families(id,parent_id,pair_code,service_country,service_country_source,study_market) VALUES ('canonical-ok','parent','KID-CANONICAL','KR','guardian_confirmed','KR')").run();
  assert.throws(() => canonical.prepare("INSERT INTO families(id,parent_id,pair_code,service_country_source) VALUES ('canonical-source','parent','KID-SOURCE','not-a-source')").run(), /CHECK constraint failed/);
  assert.throws(() => canonical.prepare("INSERT INTO families(id,parent_id,pair_code,study_market) VALUES ('canonical-market','parent','KID-MARKET','JP')").run(), /CHECK constraint failed/);
  canonical.prepare("INSERT INTO family_members(id,family_id,role,learning_grade_override) VALUES ('canonical-member-ok','canonical-ok','child',6)").run();
  assert.throws(() => canonical.prepare("INSERT INTO family_members(id,family_id,role,learning_grade_override) VALUES ('canonical-member-grade','canonical-ok','child',7)").run(), /CHECK constraint failed/);
  canonical.close();
});

test("인증 진입 UNIQUE migration은 재실행 가능하고 전화·정규화 ID·OTP 경합을 막는다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY, phone TEXT);
    CREATE TABLE user_profiles(user_id TEXT PRIMARY KEY, phone TEXT, login_id TEXT);
    CREATE TABLE phone_otp(phone TEXT, code_hash TEXT, expires_at TEXT, attempts INTEGER, created_at TEXT);
  `);
  db.exec(authEntryUniquenessMigration);
  db.exec(authEntryUniquenessMigration);

  db.prepare("INSERT INTO users(id,phone) VALUES ('user-1','821011112222')").run();
  assert.throws(
    () => db.prepare("INSERT INTO users(id,phone) VALUES ('user-2','821011112222')").run(),
    /UNIQUE constraint failed/,
  );
  db.prepare("INSERT INTO user_profiles(user_id,phone,login_id) VALUES ('user-1','+821011112222',' MindLady ')").run();
  assert.throws(
    () => db.prepare("INSERT INTO user_profiles(user_id,phone,login_id) VALUES ('user-2','+821033334444','mindlady')").run(),
    /UNIQUE constraint failed/,
  );
  db.prepare("INSERT INTO phone_otp(phone,code_hash) VALUES ('+821055556666','hash-1')").run();
  assert.throws(
    () => db.prepare("INSERT INTO phone_otp(phone,code_hash) VALUES ('+821055556666','hash-2')").run(),
    /UNIQUE constraint failed/,
  );
  db.close();
});

test("정본 D1 좌표 trigger는 실제 fix만 기록하고 같은 fix의 현재·이력 중복을 제거한다", () => {
  const db = bootstrap();
  db.prepare(
    `INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at,accuracy_m)
     VALUES (?,?,?,?,?,?)`,
  ).run("child-1", "family-1", 37.1, 127.1, "2026-08-01 01:00:00.000Z", 5);
  for (const [recordedAt, isEstimated] of [
    ["2026-08-01 01:00:00.000Z", 0],
    ["2026-08-01 01:00:00.001Z", 0],
    ["2026-08-01 01:00:01.000Z", 1],
  ]) {
    db.prepare(
      `INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m)
       VALUES (?,?,?,?,?,?,?)`,
    ).run("child-1", "family-1", 37.1, 127.1, recordedAt, isEstimated, 5);
  }
  assert.deepEqual(
    db.prepare(
      `SELECT service_code,occurred_at FROM location_confirmation_records
        WHERE subject_user_id='child-1' ORDER BY occurred_at`,
    ).all().map((row) => ({ ...row })),
    [
      { service_code: "current_location_ingest", occurred_at: "2026-08-01 01:00:00.000Z" },
      { service_code: "location_history_ingest", occurred_at: "2026-08-01 01:00:00.001Z" },
    ],
  );
  const triggerSql = String(db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_location_history_confirmation_insert'",
  ).get()?.sql ?? "");
  assert.match(triggerSql, /WHEN NEW\."is_estimated"=0/);
  assert.match(triggerSql, /WHERE NOT EXISTS/);
  db.close();
});

test("정본 D1 스키마는 운영 additive migration의 런타임 컬럼을 모두 포함한다", () => {
  const db = bootstrap();
  const expected = {
    events: ["series_id"],
    child_locations: ["accuracy_m"],
    location_history: ["accuracy_m"],
    danger_zones: ["alert_on_entry", "alert_on_exit"],
    family_members: ["is_active", "last_selected_at"],
    teacher_notices: ["attachments"],
    remote_listen_sessions: ["consented_at", "capture_expires_at"],
    fcm_tokens: ["registration_instance_id", "disabled_at", "disabled_reason"],
    push_subscriptions: ["updated_at", "registration_instance_id", "disabled_at", "disabled_reason"],
    refresh_tokens: ["device_id", "rotated_to", "rotated_at"],
    notification_settings: [
      "quiet_hours_enabled",
      "quiet_hours_start_minute",
      "quiet_hours_end_minute",
      "quiet_hours_updated_by",
      "quiet_hours_updated_at",
    ],
    app_global_settings: ["key", "value", "updated_by", "updated_at"],
  };
  for (const [table, names] of Object.entries(expected)) {
    const actual = columns(db, table);
    for (const name of names) assert.ok(actual.has(name), `${table}.${name} 누락`);
  }
  db.close();
});

test("전역 운영 설정 migration은 재실행 가능하고 정본 schema의 컬럼·기본값과 일치한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(appGlobalSettingsMigration);
  db.exec(appGlobalSettingsMigration);
  const canonical = bootstrap();

  assert.deepEqual(
    tableColumnContract(db, "app_global_settings"),
    tableColumnContract(canonical, "app_global_settings"),
  );
  assert.deepEqual(
    [...columns(db, "app_global_settings")].sort(),
    ["key", "updated_at", "updated_by", "value"],
  );
  db.prepare("INSERT INTO app_global_settings (key) VALUES (?)").run("commerce_runtime_controls_v1");
  const row = db.prepare(
    "SELECT value,updated_by,updated_at FROM app_global_settings WHERE key=?",
  ).get("commerce_runtime_controls_v1");
  assert.equal(row.value, "");
  assert.equal(row.updated_by, null);
  assert.ok(String(row.updated_at).length > 0);

  canonical.close();
  db.close();
});

test("알림 조용한 시간 migration은 기존 설정 테이블을 정본 기본값과 제약으로 확장한다", async () => {
  const migration = await readFile(notificationQuietHoursMigrationUrl, "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE notification_settings (user_id TEXT PRIMARY KEY)`);
  db.exec(migration);

  const canonical = bootstrap();
  const quietColumns = [
    "quiet_hours_enabled",
    "quiet_hours_start_minute",
    "quiet_hours_end_minute",
    "quiet_hours_updated_by",
    "quiet_hours_updated_at",
  ];
  for (const name of quietColumns) {
    assert.ok(columns(db, "notification_settings").has(name), `migration ${name} 누락`);
    assert.ok(columns(canonical, "notification_settings").has(name), `정본 ${name} 누락`);
  }

  db.prepare("INSERT INTO notification_settings (user_id) VALUES (?)").run("parent-default");
  assert.deepEqual(
    { ...db.prepare(
      `SELECT quiet_hours_enabled, quiet_hours_start_minute, quiet_hours_end_minute,
              quiet_hours_updated_by, quiet_hours_updated_at
         FROM notification_settings WHERE user_id = ?`,
    ).get("parent-default") },
    {
      quiet_hours_enabled: 0,
      quiet_hours_start_minute: 1320,
      quiet_hours_end_minute: 420,
      quiet_hours_updated_by: null,
      quiet_hours_updated_at: null,
    },
  );
  assert.throws(
    () => db.prepare("UPDATE notification_settings SET quiet_hours_enabled = 2").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare("UPDATE notification_settings SET quiet_hours_start_minute = 1440").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare("UPDATE notification_settings SET quiet_hours_end_minute = -1").run(),
    /CHECK constraint failed/,
  );

  canonical.close();
  db.close();
});

test("정본 D1 스키마는 운영 보조 테이블과 전달 무결성 인덱스를 포함한다", () => {
  const db = bootstrap();
  for (const table of [
    "google_play_rtdn_events",
    "google_play_billing_owners",
    "family_review_rewards",
    "user_interaction_blocks",
    "users",
    "auth_identities",
    "refresh_tokens",
    "login_attempts",
    "phone_otp",
    "storage_upload_daily_usage",
    "storage_upload_family_daily_usage",
    "anonymous_signup_rate_limits",
    "family_unpair_cleanup_jobs",
    "account_deletion_jobs",
    "account_deletion_scopes",
    "account_mutation_leases",
    "storage_invalid_upload_cleanup_jobs",
    "memo_notification_outbox",
    "memo_interaction_leases",
    "location_history_ingest_daily_usage",
    "location_confirmation_records",
    "web_billing_checkout_sessions",
    "web_billing_customers",
    "web_billing_charge_attempts",
    "web_billing_trial_claims",
    "web_billing_refund_records",
    "web_ai_credit_orders",
    "web_ai_credit_detached_balances",
    "web_ai_credit_lookup_windows",
    "billing_provider_reservations",
    "google_play_voided_purchase_events",
    "revenue_cost_ledger",
    "revenue_cost_coverage",
    "app_global_settings",
  ]) {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} 누락`);
  }

  const actual = indexes(db);
  for (const name of [
    "idx_events_series_id",
    "idx_push_sent_event_notif",
    "idx_events_date_key",
    "idx_pending_family_delivery_expiry_created",
    "idx_location_history_user_recorded",
    "idx_location_history_recorded_family",
    "idx_location_history_family_recorded_norm",
    "idx_location_history_ingest_usage_date",
    "idx_location_confirmation_recorded",
    "idx_location_confirmation_family_subject_occurred",
    "idx_referral_completions_v2_ready",
    "idx_parent_alerts_family_created",
    "idx_events_family_datekey",
    "idx_child_locations_family",
    "idx_fcm_tokens_user",
    "idx_fcm_tokens_family",
    "idx_family_members_family_role_active",
    "idx_fcm_tokens_token_active_unique",
    "idx_push_subscriptions_endpoint_active_unique",
    "idx_users_phone",
    "idx_users_email",
    "idx_auth_identities_user",
    "idx_refresh_user",
    "idx_login_attempts_id_at",
    "idx_phone_otp_phone",
    "idx_phone_otp_phone_unique",
    "idx_users_phone_unique_nonempty",
    "idx_user_profiles_phone_unique_nonempty",
    "idx_user_profiles_login_id_unique_normalized",
    "idx_family_review_rewards_parent_id",
    "idx_google_play_rtdn_events_status_lease",
    "idx_google_play_rtdn_events_purchase_hash",
    "idx_google_play_billing_owners_family_parent",
    "idx_google_play_billing_owners_token_hash",
    "idx_google_play_voided_status_lease",
    "idx_google_play_voided_purchase_hash",
    "idx_storage_upload_daily_usage_updated",
    "idx_storage_upload_family_daily_usage_updated",
    "idx_anonymous_signup_rate_limits_updated",
    "idx_users_anonymous_created",
    "idx_family_unpair_cleanup_jobs_updated",
    "idx_account_deletion_scopes_job",
    "idx_account_mutation_leases_user_expiry",
    "idx_account_mutation_leases_family_expiry",
    "idx_storage_invalid_upload_cleanup_updated",
    "idx_memo_notification_outbox_due",
    "idx_memo_notification_outbox_family",
    "idx_memo_interaction_leases_expiry",
    "idx_web_billing_checkout_family_parent",
    "idx_web_billing_checkout_claim",
    "idx_web_billing_customers_renewal",
    "idx_web_billing_customers_key_revocation",
    "idx_web_billing_charge_initial_session",
    "idx_web_billing_charge_family_created",
    "idx_web_billing_charge_claim",
    "idx_web_billing_charge_refund_reconcile",
    "idx_web_billing_trial_status_end",
    "idx_web_billing_refund_provider_checked",
    "idx_web_billing_refund_retention",
    "idx_web_ai_credit_payment_hash",
    "idx_web_ai_credit_family_parent",
    "idx_web_ai_credit_reconcile",
    "idx_web_ai_credit_detached_reconcile",
    "idx_web_ai_credit_detached_balance_retention",
    "idx_web_ai_credit_lookup_windows_updated",
    "idx_revenue_cost_ledger_source_unique",
    "idx_revenue_cost_ledger_provider_date",
    "idx_revenue_cost_ledger_category_date",
    "idx_revenue_cost_coverage_source_unique",
    "idx_revenue_cost_coverage_lookup",
  ]) {
    assert.ok(actual.has(name), `${name} 누락`);
  }
  for (const name of [
    "trg_child_locations_confirmation_insert",
    "trg_child_locations_confirmation_update",
    "trg_location_history_confirmation_insert",
    "trg_location_history_ingest_daily_quota",
    "trg_referral_location_evidence_snapshot",
  ]) {
    assert.ok(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name),
      `${name} 누락`,
    );
  }
  db.close();
});

test("스토리지 일일 quota migration은 빈 DB와 재실행 모두 안전하다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(storageQuotaMigration);
  db.exec(storageQuotaMigration);
  assert.deepEqual(
    [...columns(db, "storage_upload_daily_usage")].sort(),
    ["byte_count", "day_key", "object_count", "updated_at", "user_id"],
  );
  assert.ok(indexes(db).has("idx_storage_upload_daily_usage_updated"));
  db.close();
});

test("가족 스토리지 quota migration은 빈 DB와 재실행 모두 안전하다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(familyStorageQuotaMigration);
  db.exec(familyStorageQuotaMigration);
  assert.deepEqual(
    [...columns(db, "storage_upload_family_daily_usage")].sort(),
    ["byte_count", "day_key", "family_id", "object_count", "updated_at"],
  );
  assert.ok(indexes(db).has("idx_storage_upload_family_daily_usage_updated"));
  db.close();
});

test("익명 가입 보호 migration은 기존 users 스키마에 additive로 재실행 가능하다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY,
    is_anonymous INTEGER NOT NULL DEFAULT 0,
    created_at TEXT
  )`);
  db.exec(anonymousSignupProtectionMigration);
  db.exec(anonymousSignupProtectionMigration);
  assert.deepEqual(
    [...columns(db, "anonymous_signup_rate_limits")].sort(),
    ["request_count", "scope_hash", "scope_type", "updated_at", "window_key"],
  );
  assert.ok(indexes(db).has("idx_anonymous_signup_rate_limits_updated"));
  assert.ok(indexes(db).has("idx_users_anonymous_created"));
  db.close();
});

test("가족 연결 해제 cleanup job migration은 빈 DB와 재실행 모두 안전하다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(familyUnpairCleanupMigration);
  db.exec(familyUnpairCleanupMigration);
  assert.deepEqual(
    [...columns(db, "family_unpair_cleanup_jobs")].sort(),
    [
      "attempts",
      "child_user_id",
      "created_at",
      "exact_photo_keys",
      "family_id",
      "last_error",
      "member_ids",
      "preserve_photo_keys",
      "updated_at",
    ],
  );
  assert.ok(indexes(db).has("idx_family_unpair_cleanup_jobs_updated"));
  db.close();
});

test("계정 삭제·mutation lease base는 재실행 가능하고 스토리지 journal 확장은 정확히 한 번 이어진다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(accountStorageMutationSafetyMigration);
  db.exec(accountStorageMutationSafetyMigration);
  db.exec(storageMultipartJournalMigration);
  assert.deepEqual(
    [...columns(db, "account_deletion_jobs")].sort(),
    [
      "attempts",
      "created_at",
      "id",
      "last_error",
      "mode",
      "owner_user_id",
      "status",
      "updated_at",
    ],
  );
  assert.deepEqual(
    [...columns(db, "account_deletion_scopes")].sort(),
    ["created_at", "job_id", "scope_id", "scope_type"],
  );
  assert.deepEqual(
    [...columns(db, "account_mutation_leases")].sort(),
    ["created_at", "expires_at", "family_id", "id", "user_id"],
  );
  assert.deepEqual(
    [...columns(db, "storage_invalid_upload_cleanup_jobs")].sort(),
    [
      "attempts",
      "authorization_kind",
      "authorization_target_id",
      "byte_count",
      "cleaned_at",
      "cleanup_after",
      "cleanup_started_at",
      "committed_at",
      "content_sha256",
      "created_at",
      "family_day_key",
      "family_id",
      "last_error",
      "multipart_aborted_at",
      "multipart_upload_id",
      "object_key",
      "request_id",
      "reservation_etag",
      "reservation_retired_at",
      "updated_at",
      "upload_nonce",
      "upload_protocol",
      "user_day_key",
      "user_id",
    ],
  );
  assert.ok(indexes(db).has("idx_account_deletion_scopes_job"));
  assert.ok(indexes(db).has("idx_account_mutation_leases_user_expiry"));
  assert.ok(indexes(db).has("idx_account_mutation_leases_family_expiry"));
  assert.ok(indexes(db).has("idx_storage_invalid_upload_cleanup_updated"));

  const schemaDb = bootstrap();
  for (const table of [
    "account_deletion_jobs",
    "account_deletion_scopes",
    "account_mutation_leases",
    "storage_invalid_upload_cleanup_jobs",
  ]) {
    assert.deepEqual(
      [...columns(db, table)].sort(),
      [...columns(schemaDb, table)].sort(),
      `${table} migration과 정본 schema 컬럼 불일치`,
    );
  }
  for (const [table, key] of [
    ["account_deletion_jobs", "id"],
    ["account_mutation_leases", "id"],
    ["storage_invalid_upload_cleanup_jobs", "object_key"],
  ]) {
    assert.equal(columnNotNull(db, table, key), 1, `${table}.${key} migration NOT NULL 누락`);
    assert.equal(columnNotNull(schemaDb, table, key), 1, `${table}.${key} 정본 NOT NULL 누락`);
  }
  schemaDb.close();
  db.close();
});

test("기존 스토리지 journal은 multipart 선형화 컬럼을 한 번에 추가한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE storage_invalid_upload_cleanup_jobs (
    object_key TEXT PRIMARY KEY,
    upload_nonce TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_day_key TEXT NOT NULL,
    family_id TEXT,
    family_day_key TEXT,
    byte_count INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    cleanup_after TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  db.exec(storageMultipartJournalMigration);
  const actual = columns(db, "storage_invalid_upload_cleanup_jobs");
  assert.ok(actual.has("multipart_upload_id"));
  assert.ok(actual.has("cleanup_started_at"));
  assert.ok(actual.has("multipart_aborted_at"));
  assert.ok(actual.has("upload_protocol"));
  assert.ok(actual.has("reservation_etag"));
  assert.ok(actual.has("reservation_retired_at"));
  assert.ok(actual.has("committed_at"));
  assert.ok(actual.has("cleaned_at"));
  assert.ok(actual.has("request_id"));
  assert.ok(actual.has("authorization_kind"));
  assert.ok(actual.has("authorization_target_id"));
  assert.ok(actual.has("content_sha256"));
  db.close();
});

test("콘텐츠 차단 migration은 재실행 가능하고 정본 schema와 일치한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(contentSafetyMigration);
  db.exec(contentSafetyMigration);
  const schemaDb = bootstrap();
  assert.deepEqual(
    [...columns(db, "user_interaction_blocks")].sort(),
    [...columns(schemaDb, "user_interaction_blocks")].sort(),
  );
  assert.ok(indexes(db).has("idx_user_interaction_blocks_blocked"));
  schemaDb.close();
  db.close();
});

test("OAuth state migration은 재실행 가능하고 정본 schema와 일치한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(oauthStateMigration);
  db.exec(oauthStateMigration);
  const schemaDb = bootstrap();
  assert.deepEqual(
    [...columns(db, "oauth_state_transactions")].sort(),
    [...columns(schemaDb, "oauth_state_transactions")].sort(),
  );
  assert.ok(indexes(db).has("idx_oauth_state_expiry"));
  assert.ok(indexes(db).has("idx_oauth_recovery_id"));
  schemaDb.close();
  db.close();
});

test("OAuth exchange recovery migration은 기존 transaction 테이블을 additive 확장한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE oauth_state_transactions (
    state_hash TEXT PRIMARY KEY,
    transaction_secret_hash TEXT NOT NULL,
    provider TEXT NOT NULL,
    client_kind TEXT NOT NULL,
    redirect_target TEXT NOT NULL,
    flow_mode TEXT NOT NULL,
    user_id TEXT,
    authorization_code_hash TEXT,
    callback_received_at TEXT,
    consumed_at TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`);
  db.exec(oauthExchangeRecoveryMigration);
  const schemaDb = bootstrap();
  assert.deepEqual(
    [...columns(db, "oauth_state_transactions")].sort(),
    [...columns(schemaDb, "oauth_state_transactions")].sort(),
  );
  assert.ok(indexes(db).has("idx_oauth_recovery_id"));
  schemaDb.close();
  db.close();
});

test("원격청취 동의 migration은 구 스키마를 정본 컬럼·인덱스로 확장한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE remote_listen_sessions (
    id TEXT PRIMARY KEY,
    child_user_id TEXT NOT NULL,
    ended_at TEXT
  )`);
  db.exec(remoteListenConsentMigration);
  const schemaDb = bootstrap();
  for (const name of ["consented_at", "capture_expires_at"]) {
    assert.ok(columns(db, "remote_listen_sessions").has(name), `${name} 누락`);
    assert.ok(columns(schemaDb, "remote_listen_sessions").has(name), `정본 ${name} 누락`);
  }
  assert.ok(indexes(db).has("idx_remote_listen_capture_window"));
  assert.ok(indexes(schemaDb).has("idx_remote_listen_capture_window"));
  schemaDb.close();
  db.close();
});

test("메모 알림 outbox migration은 재실행 가능하고 정본 schema·삭제 trigger와 일치한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE memo_replies (id TEXT PRIMARY KEY)`);
  db.exec(memoNotificationOutboxMigration);
  db.exec(memoNotificationOutboxMigration);
  const schemaDb = bootstrap();
  assert.deepEqual(
    [...columns(db, "memo_notification_outbox")].sort(),
    [...columns(schemaDb, "memo_notification_outbox")].sort(),
  );
  assert.equal(
    columnNotNull(db, "memo_notification_outbox", "reply_id"),
    columnNotNull(schemaDb, "memo_notification_outbox", "reply_id"),
  );
  assert.equal(columnNotNull(db, "memo_notification_outbox", "reply_id"), 1);
  for (const name of ["idx_memo_notification_outbox_due", "idx_memo_notification_outbox_family"]) {
    assert.ok(indexes(db).has(name), `${name} migration 누락`);
    assert.ok(indexes(schemaDb).has(name), `${name} 정본 누락`);
  }
  const trigger = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='trigger' AND name=?",
  ).get("trg_memo_notification_outbox_reply_delete");
  assert.ok(trigger, "메모 삭제 outbox 정리 trigger 누락");
  db.close();
  schemaDb.close();
});

test("메모 전달·차단 pair lease migration은 재실행 가능하고 정본 schema와 일치한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(memoInteractionLeasesMigration);
  db.exec(memoInteractionLeasesMigration);
  const schemaDb = bootstrap();
  assert.deepEqual(
    [...columns(db, "memo_interaction_leases")].sort(),
    [...columns(schemaDb, "memo_interaction_leases")].sort(),
  );
  for (const column of [
    "family_id",
    "user_a_id",
    "user_b_id",
    "lease_token",
    "expires_at",
    "created_at",
    "updated_at",
  ]) {
    assert.equal(columnNotNull(db, "memo_interaction_leases", column), 1, `${column} migration NOT NULL 누락`);
    assert.equal(columnNotNull(schemaDb, "memo_interaction_leases", column), 1, `${column} 정본 NOT NULL 누락`);
  }
  assert.ok(indexes(db).has("idx_memo_interaction_leases_expiry"));
  assert.ok(indexes(schemaDb).has("idx_memo_interaction_leases_expiry"));
  assert.throws(() => db.prepare(
    `INSERT INTO memo_interaction_leases
       (family_id,user_a_id,user_b_id,lease_token,expires_at,created_at,updated_at)
     VALUES ('family-a','parent-a','child-a','token','2099-01-01','2026-01-01','2026-01-01')`,
  ).run(), /CHECK constraint failed/);
  schemaDb.close();
  db.close();
});

test("웹 자동결제 migration은 재실행 가능하고 정본 schema·가격 제약과 일치한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE family_subscription (
    family_id TEXT PRIMARY KEY, status TEXT NOT NULL, trial_ends_at TEXT,
    current_period_end TEXT, provider TEXT NOT NULL, purchase_token_hash TEXT,
    latest_order_id TEXT, last_event_id TEXT
  )`);
  db.exec(webBillingMigration);
  db.exec(webBillingMigration);
  const schemaDb = bootstrap();
  for (const table of [
    "web_billing_checkout_sessions",
    "web_billing_customers",
    "web_billing_charge_attempts",
    "web_billing_trial_claims",
    "web_billing_refund_records",
    "web_billing_financial_records",
    "billing_provider_reservations",
  ]) {
    assert.deepEqual(
      [...columns(db, table)].sort(),
      [...columns(schemaDb, table)].sort(),
      `${table} migration과 정본 schema 컬럼 불일치`,
    );
  }
  for (const name of [
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
    "idx_billing_provider_state_updated",
  ]) {
    assert.ok(indexes(db).has(name), `${name} migration 누락`);
    assert.ok(indexes(schemaDb).has(name), `${name} 정본 누락`);
  }
  assert.throws(() => db.prepare(
    `INSERT INTO web_billing_checkout_sessions
       (id,family_id,parent_id,customer_key,plan,amount,status,expires_at,created_at,updated_at)
     VALUES ('bad-price','family-a','parent-a','HYENI_bad','month',39000,'pending',
             '2026-08-01 00:15:00+00','2026-08-01 00:00:00+00','2026-08-01 00:00:00+00')`,
  ).run(), /CHECK constraint failed/);
  assert.throws(() => db.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES ('family-conflict','google_play','conflict','safe-ref','2026-08-01','2026-08-01')`,
  ).run(), /CHECK constraint failed/);
  db.prepare(
    `INSERT INTO web_billing_trial_claims
       (family_id,parent_id,checkout_session_id,provider,plan,status,claimed_at,trial_ends_at,updated_at)
     VALUES ('family-google-trial','parent-a',?,'google_play','month','active',
             '2026-08-01','2026-08-08','2026-08-01')`,
  ).run(`google-play:${"a".repeat(64)}`);
  assert.throws(() => db.prepare(
    `INSERT INTO web_billing_trial_claims
       (family_id,parent_id,checkout_session_id,provider,plan,status,claimed_at,trial_ends_at,updated_at)
     VALUES ('family-bad-trial','parent-a','bad-provider','other','month','active',
             '2026-08-01','2026-08-08','2026-08-01')`,
  ).run(), /CHECK constraint failed/);
  db.prepare(
    `INSERT INTO web_billing_financial_records
       (record_id,record_type,provider,provider_reference,plan,amount,record_status,
        period_start,period_end,detached_at,retention_until,created_at)
     VALUES ('trial:google-canonical','trial','google_play',?,'month',0,'trial_active',
             '2026-08-01','2026-08-08','2026-08-09','2031-08-08','2026-08-01')`,
  ).run(`google-play:${"b".repeat(64)}`);
  schemaDb.close();
  db.close();
});

test("웹 자동결제 migration은 기존 Google 활성과 미확정 Toss 주문을 자동 덮어쓰기 없이 manual_review로 격리한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE family_subscription (
    family_id TEXT PRIMARY KEY, status TEXT NOT NULL, trial_ends_at TEXT,
    current_period_end TEXT, provider TEXT NOT NULL, purchase_token_hash TEXT,
    latest_order_id TEXT, last_event_id TEXT
  )`);
  db.prepare(
    `INSERT INTO family_subscription
       (family_id,status,current_period_end,provider,purchase_token_hash)
     VALUES ('family-overlap','active','2099-01-01 00:00:00+00','google_play','safe-google-hash')`,
  ).run();
  db.exec(webBillingMigration);
  db.prepare(
    `INSERT INTO web_billing_customers
       (family_id,parent_id,customer_key,plan,status,failure_count,created_at,updated_at)
     VALUES ('family-overlap','parent-overlap','customer-overlap','month','pending_charge',0,
             '2026-08-01','2026-08-01')`,
  ).run();
  db.prepare(
    `INSERT INTO web_billing_charge_attempts
       (order_id,family_id,checkout_session_id,plan,amount,kind,period_start,period_end,
        status,created_at,updated_at)
     VALUES ('toss-order-overlap','family-overlap',NULL,'month',4900,'initial',
             '2026-08-01','2026-09-01','unknown','2026-08-01','2026-08-01')`,
  ).run();
  db.exec(webBillingMigration);

  assert.deepEqual({ ...db.prepare(
    `SELECT provider,state,conflicting_provider,conflict_ref,conflict_reason,resolution_status
       FROM billing_provider_reservations WHERE family_id='family-overlap'`,
  ).get() }, {
    provider: "google_play",
    state: "conflict",
    conflicting_provider: "toss_web",
    conflict_ref: "toss-order-overlap",
    conflict_reason: "preexisting_toss_google_overlap",
    resolution_status: "manual_review",
  });
  db.close();
});
