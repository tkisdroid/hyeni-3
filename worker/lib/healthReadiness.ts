type RequiredSchemaObjectType = "table" | "index" | "trigger";

interface RequiredSchemaObject {
  type: RequiredSchemaObjectType;
  name: string;
}

interface RequiredSchemaColumn {
  table: string;
  name: string;
}

interface RequiredSchemaTableContract {
  name: string;
  sqlFragments: readonly string[];
}

interface RequiredSchemaIndexContract {
  name: string;
  table: string;
  unique: boolean;
  partial: boolean;
  columns: readonly string[];
  definition?: string;
}

interface RequiredSchemaTriggerContract {
  name: string;
  table: string;
  sqlFragments: readonly string[];
}

function requiredSchemaColumns(
  table: string,
  names: readonly string[],
): RequiredSchemaColumn[] {
  return names.map((name) => ({ table, name }));
}

// 2026-08-01 통합 출시 manifest의 정본 객체다. 행 수나 사용자 데이터는 조회하지 않고,
// Worker가 실제 사용하는 객체의 존재와 아래 핵심 index·trigger 정의만 확인한다.
const REQUIRED_SCHEMA_OBJECTS: readonly RequiredSchemaObject[] = [
  { type: "table", name: "users" },
  { type: "table", name: "refresh_tokens" },
  { type: "table", name: "families" },
  { type: "table", name: "family_members" },
  { type: "table", name: "events" },
  { type: "table", name: "events_children" },
  { type: "table", name: "child_locations" },
  { type: "table", name: "location_history" },
  { type: "table", name: "parent_alerts" },
  { type: "table", name: "pending_notifications" },
  { type: "table", name: "fcm_tokens" },
  { type: "table", name: "push_sent" },
  { type: "table", name: "push_subscriptions" },
  { type: "table", name: "family_subscription" },
  { type: "table", name: "notification_settings" },
  { type: "table", name: "remote_listen_sessions" },
  { type: "table", name: "ai_credit_balances" },
  { type: "table", name: "ai_credit_ledger" },
  { type: "table", name: "ai_parent_settings" },
  { type: "table", name: "app_global_settings" },
  { type: "table", name: "google_play_purchase_events" },
  { type: "table", name: "premium_funnel_events" },
  { type: "table", name: "premium_funnel_rate_limits" },
  { type: "table", name: "family_lifecycle_events" },
  { type: "table", name: "family_lifecycle_daily" },
  { type: "table", name: "revenue_cost_ledger" },
  { type: "table", name: "revenue_cost_coverage" },
  { type: "table", name: "location_confirmation_records" },
  { type: "table", name: "location_history_ingest_daily_usage" },
  { type: "table", name: "web_billing_checkout_sessions" },
  { type: "table", name: "web_billing_customers" },
  { type: "table", name: "web_billing_charge_attempts" },
  { type: "table", name: "web_billing_refund_records" },
  { type: "table", name: "web_billing_trial_claims" },
  { type: "table", name: "billing_provider_reservations" },
  { type: "table", name: "web_billing_financial_records" },
  { type: "table", name: "web_ai_credit_orders" },
  { type: "table", name: "web_ai_credit_detached_balances" },
  { type: "table", name: "web_ai_credit_lookup_windows" },
  { type: "table", name: "referral_codes_v2" },
  { type: "table", name: "referral_completions_v2" },
  { type: "table", name: "google_play_rtdn_events" },
  { type: "table", name: "google_play_billing_owners" },
  { type: "table", name: "google_play_voided_purchase_events" },
  { type: "index", name: "idx_ai_credit_balances_family_child_unique" },
  { type: "index", name: "uq_ai_parent_settings_family_child" },
  { type: "index", name: "idx_fcm_tokens_token_active_unique" },
  { type: "index", name: "idx_push_sent_event_notif" },
  { type: "index", name: "idx_push_subscriptions_endpoint_active_unique" },
  { type: "index", name: "idx_premium_funnel_received" },
  { type: "index", name: "idx_premium_funnel_event_received" },
  { type: "index", name: "idx_premium_funnel_family_received" },
  { type: "index", name: "idx_premium_funnel_rate_updated" },
  { type: "index", name: "idx_family_lifecycle_first_milestone" },
  { type: "index", name: "idx_family_lifecycle_event_received" },
  { type: "index", name: "idx_family_lifecycle_received" },
  { type: "index", name: "idx_family_lifecycle_family_occurred" },
  { type: "index", name: "idx_family_lifecycle_daily_date" },
  { type: "index", name: "idx_family_lifecycle_daily_updated" },
  { type: "index", name: "idx_revenue_cost_ledger_source_unique" },
  { type: "index", name: "idx_revenue_cost_ledger_provider_date" },
  { type: "index", name: "idx_revenue_cost_ledger_category_date" },
  { type: "index", name: "idx_revenue_cost_coverage_source_unique" },
  { type: "index", name: "idx_revenue_cost_coverage_lookup" },
  { type: "index", name: "idx_location_confirmation_recorded" },
  { type: "index", name: "idx_location_confirmation_family_subject_occurred" },
  { type: "index", name: "idx_location_history_ingest_usage_date" },
  { type: "index", name: "idx_location_history_recorded_family" },
  { type: "index", name: "idx_location_history_family_recorded_norm" },
  { type: "index", name: "idx_web_billing_checkout_family_parent" },
  { type: "index", name: "idx_web_billing_checkout_claim" },
  { type: "index", name: "idx_web_billing_customers_renewal" },
  { type: "index", name: "idx_web_billing_customers_key_revocation" },
  { type: "index", name: "idx_web_billing_charge_initial_session" },
  { type: "index", name: "idx_web_billing_charge_family_created" },
  { type: "index", name: "idx_web_billing_charge_claim" },
  { type: "index", name: "idx_web_billing_charge_refund_reconcile" },
  { type: "index", name: "idx_web_billing_refund_provider_checked" },
  { type: "index", name: "idx_web_billing_refund_retention" },
  { type: "index", name: "idx_web_billing_trial_status_end" },
  { type: "index", name: "idx_billing_provider_state_updated" },
  { type: "index", name: "idx_web_billing_financial_retention" },
  { type: "index", name: "idx_web_ai_credit_payment_hash" },
  { type: "index", name: "idx_web_ai_credit_family_parent" },
  { type: "index", name: "idx_web_ai_credit_reconcile" },
  { type: "index", name: "idx_web_ai_credit_detached_reconcile" },
  { type: "index", name: "idx_web_ai_credit_detached_balance_retention" },
  { type: "index", name: "idx_web_ai_credit_lookup_windows_updated" },
  { type: "index", name: "idx_referral_codes_v2_owner" },
  { type: "index", name: "idx_referral_completions_v2_pending" },
  { type: "index", name: "idx_referral_completions_v2_referrer" },
  { type: "index", name: "idx_referral_completions_v2_ready" },
  { type: "index", name: "idx_google_play_rtdn_events_status_lease" },
  { type: "index", name: "idx_google_play_rtdn_events_purchase_hash" },
  { type: "index", name: "idx_google_play_voided_status_lease" },
  { type: "index", name: "idx_google_play_voided_purchase_hash" },
  { type: "index", name: "idx_google_play_billing_owners_family_parent" },
  { type: "index", name: "idx_google_play_billing_owners_token_hash" },
  { type: "trigger", name: "trg_child_locations_confirmation_insert" },
  { type: "trigger", name: "trg_child_locations_confirmation_update" },
  { type: "trigger", name: "trg_location_history_confirmation_insert" },
  { type: "trigger", name: "trg_location_history_ingest_daily_quota" },
  { type: "trigger", name: "trg_referral_location_evidence_snapshot" },
] as const;

const REQUIRED_SCHEMA_COLUMNS: readonly RequiredSchemaColumn[] = [
  { table: "events", name: "series_id" },
  { table: "family_members", name: "is_active" },
  { table: "child_locations", name: "accuracy_m" },
  { table: "location_history", name: "accuracy_m" },
  { table: "remote_listen_sessions", name: "consented_at" },
  { table: "remote_listen_sessions", name: "capture_expires_at" },
  { table: "notification_settings", name: "quiet_hours_enabled" },
  { table: "notification_settings", name: "quiet_hours_start_minute" },
  { table: "notification_settings", name: "quiet_hours_end_minute" },
  { table: "notification_settings", name: "quiet_hours_updated_by" },
  { table: "notification_settings", name: "quiet_hours_updated_at" },
  { table: "app_global_settings", name: "key" },
  { table: "app_global_settings", name: "value" },
  { table: "app_global_settings", name: "updated_by" },
  { table: "app_global_settings", name: "updated_at" },
  { table: "fcm_tokens", name: "fcm_token" },
  { table: "fcm_tokens", name: "disabled_at" },
  { table: "push_sent", name: "event_id" },
  { table: "push_sent", name: "notif_key" },
  { table: "push_subscriptions", name: "endpoint" },
  { table: "push_subscriptions", name: "disabled_at" },
  { table: "premium_funnel_events", name: "family_key" },
  { table: "location_confirmation_records", name: "service_code" },
  ...requiredSchemaColumns("ai_credit_balances", [
    "id",
    "family_id",
    "child_user_id",
    "parent_id",
    "is_premium",
    "daily_included_limit",
    "daily_included_used",
    "daily_reset_date",
    "purchased_credits",
    "updated_at",
  ]),
  ...requiredSchemaColumns("ai_credit_ledger", [
    "id",
    "family_id",
    "child_user_id",
    "parent_id",
    "delta",
    "reason",
    "source",
    "message_id",
    "transaction_id",
    "created_at",
  ]),
  ...requiredSchemaColumns("ai_parent_settings", ["family_id", "child_user_id"]),
  ...requiredSchemaColumns("web_billing_checkout_sessions", [
    "id",
    "family_id",
    "parent_id",
    "customer_key",
    "plan",
    "amount",
    "trial_eligible",
    "trial_days",
    "status",
    "expires_at",
    "claim_token",
    "claim_expires_at",
    "error_code",
    "created_at",
    "updated_at",
  ]),
  ...requiredSchemaColumns("web_billing_customers", [
    "family_id",
    "parent_id",
    "customer_key",
    "billing_key_ciphertext",
    "billing_key_iv",
    "billing_key_version",
    "billing_key_revocation_status",
    "billing_key_revocation_attempts",
    "billing_key_revocation_retry_at",
    "billing_key_revocation_error",
    "billing_key_revoked_at",
    "plan",
    "status",
    "trial_ends_at",
    "current_period_end",
    "next_charge_at",
    "retry_after",
    "failure_count",
    "cancelled_at",
    "last_order_id",
    "last_paid_order_id",
    "created_at",
    "updated_at",
  ]),
  ...requiredSchemaColumns("web_billing_charge_attempts", [
    "order_id",
    "family_id",
    "checkout_session_id",
    "plan",
    "amount",
    "kind",
    "customer_key",
    "period_start",
    "period_end",
    "status",
    "claim_token",
    "claim_expires_at",
    "payment_key_hash",
    "error_code",
    "refund_status",
    "refunded_amount",
    "refund_state_hash",
    "provider_checked_at",
    "refund_committed_at",
    "refund_webhook_checked_at",
    "refund_funnel_status",
    "created_at",
    "completed_at",
    "updated_at",
  ]),
  ...requiredSchemaColumns("web_billing_refund_records", [
    "record_id",
    "provider_reference",
    "provider",
    "plan",
    "amount",
    "currency",
    "charge_kind",
    "refund_status",
    "refunded_amount",
    "balance_amount",
    "payment_key_hash",
    "refund_state_hash",
    "transaction_count",
    "provider_checked_at",
    "retention_until",
    "created_at",
  ]),
  ...requiredSchemaColumns("web_billing_trial_claims", [
    "family_id",
    "parent_id",
    "checkout_session_id",
    "provider",
    "plan",
    "status",
    "claimed_at",
    "trial_ends_at",
    "converted_order_id",
    "updated_at",
  ]),
  ...requiredSchemaColumns("billing_provider_reservations", [
    "family_id",
    "provider",
    "state",
    "reservation_ref",
    "conflicting_provider",
    "conflict_ref",
    "conflict_reason",
    "resolution_status",
    "created_at",
    "updated_at",
  ]),
  ...requiredSchemaColumns("web_billing_financial_records", [
    "record_id",
    "record_type",
    "provider",
    "provider_reference",
    "plan",
    "amount",
    "currency",
    "charge_kind",
    "record_status",
    "period_start",
    "period_end",
    "payment_key_hash",
    "detached_at",
    "retention_until",
    "created_at",
  ]),
  ...requiredSchemaColumns("web_ai_credit_orders", [
    "order_id",
    "family_id",
    "parent_id",
    "child_user_id",
    "customer_key",
    "product_code",
    "credits",
    "amount",
    "currency",
    "status",
    "expires_at",
    "idempotency_key",
    "claim_token",
    "claim_expires_at",
    "payment_key_hash",
    "debt_applied",
    "record_scope",
    "balance_scope",
    "detach_reason",
    "detached_at",
    "granted_credits",
    "grant_committed_at",
    "refunded_credits",
    "refund_committed_at",
    "retention_until",
    "refunded_amount",
    "provider_checked_at",
    "client_checked_at",
    "webhook_checked_at",
    "error_code",
    "retry_after",
    "created_at",
    "updated_at",
    "completed_at",
  ]),
  ...requiredSchemaColumns("web_ai_credit_detached_balances", [
    "family_id",
    "child_user_id",
    "purchased_credits",
    "restoration_state",
    "detached_at",
    "updated_at",
    "retention_until",
  ]),
  ...requiredSchemaColumns("web_ai_credit_lookup_windows", [
    "family_id",
    "window_started_at",
    "attempts",
    "updated_at",
  ]),
  { table: "revenue_cost_ledger", name: "provider" },
  { table: "revenue_cost_ledger", name: "category" },
  { table: "revenue_cost_ledger", name: "source_ref_hash" },
  { table: "revenue_cost_coverage", name: "provider" },
  { table: "revenue_cost_coverage", name: "category" },
  { table: "revenue_cost_coverage", name: "period_start" },
  { table: "revenue_cost_coverage", name: "period_end" },
  { table: "revenue_cost_coverage", name: "source_ref_hash" },
  { table: "referral_completions_v2", name: "first_location_at" },
  { table: "google_play_rtdn_events", name: "claim_token" },
  { table: "google_play_purchase_events", name: "debt_applied" },
] as const;

// 이름만 같은 잘못된 객체가 IF NOT EXISTS migration과 health를 동시에 우회하지 못하게
// 결제·AI balance·위치 확인자료의 핵심 구조를 sqlite catalog에서 함께 검증한다.
const REQUIRED_SCHEMA_TABLE_CONTRACTS: readonly RequiredSchemaTableContract[] = [
  {
    name: "premium_funnel_events",
    sqlFragments: ["'ai_friend_limit'", "'ai_schedule_limit'"],
  },
];

const REQUIRED_SCHEMA_INDEX_CONTRACTS: readonly RequiredSchemaIndexContract[] = [
  {
    name: "idx_ai_credit_balances_family_child_unique",
    table: "ai_credit_balances",
    unique: true,
    partial: false,
    columns: ["family_id", "child_user_id"],
  },
  {
    name: "uq_ai_parent_settings_family_child",
    table: "ai_parent_settings",
    unique: true,
    partial: false,
    columns: ["family_id", "child_user_id"],
  },
  {
    name: "idx_fcm_tokens_token_active_unique",
    table: "fcm_tokens",
    unique: true,
    partial: true,
    columns: ["fcm_token"],
    definition: `CREATE UNIQUE INDEX idx_fcm_tokens_token_active_unique
      ON fcm_tokens(fcm_token) WHERE disabled_at IS NULL`,
  },
  {
    name: "idx_push_sent_event_notif",
    table: "push_sent",
    unique: true,
    partial: false,
    columns: ["event_id", "notif_key"],
    definition: `CREATE UNIQUE INDEX idx_push_sent_event_notif
      ON push_sent(event_id,notif_key)`,
  },
  {
    name: "idx_push_subscriptions_endpoint_active_unique",
    table: "push_subscriptions",
    unique: true,
    partial: true,
    columns: ["endpoint"],
    definition: `CREATE UNIQUE INDEX idx_push_subscriptions_endpoint_active_unique
      ON push_subscriptions(endpoint) WHERE disabled_at IS NULL`,
  },
  {
    name: "idx_family_lifecycle_first_milestone",
    table: "family_lifecycle_events",
    unique: true,
    partial: true,
    columns: ["family_key", "event"],
    definition: `CREATE UNIQUE INDEX idx_family_lifecycle_first_milestone
      ON family_lifecycle_events(family_key,event)
      WHERE event IN ('family_created','first_location','first_arrival')`,
  },
  {
    name: "idx_web_billing_charge_initial_session",
    table: "web_billing_charge_attempts",
    unique: true,
    partial: true,
    columns: ["checkout_session_id"],
    definition: `CREATE UNIQUE INDEX idx_web_billing_charge_initial_session
      ON web_billing_charge_attempts(checkout_session_id)
      WHERE kind='initial' AND checkout_session_id IS NOT NULL`,
  },
  {
    name: "idx_web_ai_credit_payment_hash",
    table: "web_ai_credit_orders",
    unique: true,
    partial: true,
    columns: ["payment_key_hash"],
    definition: `CREATE UNIQUE INDEX idx_web_ai_credit_payment_hash
      ON web_ai_credit_orders(payment_key_hash)
      WHERE payment_key_hash IS NOT NULL`,
  },
  {
    name: "idx_revenue_cost_ledger_source_unique",
    table: "revenue_cost_ledger",
    unique: true,
    partial: false,
    columns: ["provider", "category", "source_ref_hash"],
    definition: `CREATE UNIQUE INDEX idx_revenue_cost_ledger_source_unique
      ON revenue_cost_ledger(provider,category,source_ref_hash)`,
  },
  {
    name: "idx_revenue_cost_coverage_source_unique",
    table: "revenue_cost_coverage",
    unique: true,
    partial: false,
    columns: ["provider", "category", "period_start", "period_end", "source_ref_hash"],
    definition: `CREATE UNIQUE INDEX idx_revenue_cost_coverage_source_unique
      ON revenue_cost_coverage(provider,category,period_start,period_end,source_ref_hash)`,
  },
  {
    name: "idx_web_billing_charge_refund_reconcile",
    table: "web_billing_charge_attempts",
    unique: false,
    partial: true,
    columns: ["provider_checked_at", "completed_at", "order_id"],
    definition: `CREATE INDEX idx_web_billing_charge_refund_reconcile
      ON web_billing_charge_attempts(provider_checked_at,completed_at,order_id)
      WHERE status='done' AND refund_status<>'full'`,
  },
  {
    name: "idx_referral_completions_v2_ready",
    table: "referral_completions_v2",
    unique: false,
    partial: true,
    // pragma_index_info는 expression 컬럼 이름을 null로 반환하므로 exact SQL로 함께 고정한다.
    columns: ["id"],
    definition: `CREATE INDEX idx_referral_completions_v2_ready
      ON referral_completions_v2(substr(created_at,1,19),id)
      WHERE status IN ('pending','qualified')
        AND referee_child_user_id IS NOT NULL
        AND first_location_at IS NOT NULL
        AND latest_location_at IS NOT NULL
        AND datetime(substr(latest_location_at,1,19))
          >=datetime(substr(first_location_at,1,19),'+48 hours')`,
  },
] as const;

const REQUIRED_SCHEMA_TRIGGER_CONTRACTS: readonly RequiredSchemaTriggerContract[] = [
  {
    name: "trg_child_locations_confirmation_insert",
    table: "child_locations",
    sqlFragments: [
      "AFTER INSERT ON child_locations",
      "INSERT INTO location_confirmation_records",
      "'current_location_ingest','https_worker_api','family_location_safety'",
      "existing.service_code='location_history_ingest'",
      "existing.occurred_at=NEW.updated_at",
    ],
  },
  {
    name: "trg_child_locations_confirmation_update",
    table: "child_locations",
    sqlFragments: [
      "AFTER UPDATE OF lat,lng,updated_at ON child_locations",
      "WHEN NEW.updated_at IS NOT OLD.updated_at OR NEW.lat IS NOT OLD.lat OR NEW.lng IS NOT OLD.lng",
      "INSERT INTO location_confirmation_records",
      "'current_location_ingest','https_worker_api','family_location_safety'",
      "existing.service_code='location_history_ingest'",
    ],
  },
  {
    name: "trg_location_history_confirmation_insert",
    table: "location_history",
    sqlFragments: [
      "AFTER INSERT ON location_history",
      "WHEN NEW.is_estimated=0",
      "INSERT INTO location_confirmation_records",
      "'location_history_ingest','https_worker_api','family_location_safety'",
      "existing.service_code='current_location_ingest'",
      "existing.occurred_at=NEW.recorded_at",
    ],
  },
  {
    name: "trg_location_history_ingest_daily_quota",
    table: "location_history",
    sqlFragments: [
      "BEFORE INSERT ON location_history",
      "INSERT INTO location_history_ingest_daily_usage",
      "row_count=location_history_ingest_daily_usage.row_count+1",
      "WHERE location_history_ingest_daily_usage.row_count<7200",
      "RAISE(ABORT,'location_history_daily_quota_exceeded')",
    ],
  },
  {
    name: "trg_referral_location_evidence_snapshot",
    table: "location_confirmation_records",
    sqlFragments: [
      "AFTER INSERT ON location_confirmation_records",
      "WHEN NEW.action='collect'",
      "NEW.service_code IN ('current_location_ingest','location_history_ingest')",
      "UPDATE referral_completions_v2",
      "member.role='child'",
      "member.is_active=1",
      "+48 hours",
    ],
  },
] as const;

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeSchemaSqlFragment(value: string): string {
  return value.toLowerCase().replace(/if\s+not\s+exists/g, "").replace(/["\s]/g, "");
}

function normalizedSchemaSqlExpression(column: string): string {
  return `replace(lower(replace(replace(replace(replace(replace(${column},char(34),''),char(9),''),char(10),''),char(13),''),' ','')),'ifnotexists','')`;
}

const objectPredicates = (["table", "index", "trigger"] as const).map((type) => {
  const names = REQUIRED_SCHEMA_OBJECTS
    .filter((object) => object.type === type)
    .map((object) => sqlLiteral(object.name));
  return `(type=${sqlLiteral(type)} AND name IN (${names.join(",")}))`;
});

const columnChecks = REQUIRED_SCHEMA_COLUMNS.map(
  ({ table, name }) =>
    `EXISTS(SELECT 1 FROM pragma_table_info(${sqlLiteral(table)}) WHERE name=${sqlLiteral(name)})`,
);

const criticalSchemaNames = [
  ...REQUIRED_SCHEMA_TABLE_CONTRACTS.map(({ name }) => name),
  ...REQUIRED_SCHEMA_INDEX_CONTRACTS.map(({ name }) => name),
  ...REQUIRED_SCHEMA_TRIGGER_CONTRACTS.map(({ name }) => name),
];

const tableContractChecks = REQUIRED_SCHEMA_TABLE_CONTRACTS.map((contract) => {
  const sqlFragmentChecks = contract.sqlFragments.map(
    (fragment) =>
      `instr(schema_object.normalized_sql,${sqlLiteral(normalizeSchemaSqlFragment(fragment))})>0`,
  );
  return `EXISTS(
    SELECT 1
      FROM normalized_schema schema_object
     WHERE schema_object.type='table'
       AND schema_object.name=${sqlLiteral(contract.name)}
       AND schema_object.tbl_name=${sqlLiteral(contract.name)}
       AND ${sqlFragmentChecks.join("\n       AND ")}
  )`;
});

const indexContractChecks = REQUIRED_SCHEMA_INDEX_CONTRACTS.map((contract) => {
  const orderedColumns = `(SELECT group_concat(ordered_column.name, ',') FROM (
    SELECT name FROM pragma_index_info(${sqlLiteral(contract.name)}) ORDER BY seqno
  ) ordered_column)`;
  const definitionCheck = contract.definition
    ? `AND schema_object.normalized_sql=${sqlLiteral(normalizeSchemaSqlFragment(contract.definition))}`
    : "";
  return `EXISTS(
    SELECT 1
      FROM pragma_index_list(${sqlLiteral(contract.table)}) index_entry
      JOIN normalized_schema schema_object
        ON schema_object.type='index' AND schema_object.name=index_entry.name
     WHERE index_entry.name=${sqlLiteral(contract.name)}
       AND index_entry.[unique]=${contract.unique ? 1 : 0}
       AND index_entry.partial=${contract.partial ? 1 : 0}
       AND schema_object.tbl_name=${sqlLiteral(contract.table)}
       AND ${orderedColumns}=${sqlLiteral(contract.columns.join(","))}
       ${definitionCheck}
  )`;
});

const triggerContractChecks = REQUIRED_SCHEMA_TRIGGER_CONTRACTS.map((contract) => {
  const sqlFragmentChecks = contract.sqlFragments.map(
    (fragment) =>
      `instr(schema_object.normalized_sql,${sqlLiteral(normalizeSchemaSqlFragment(fragment))})>0`,
  );
  return `EXISTS(
    SELECT 1
      FROM normalized_schema schema_object
     WHERE schema_object.type='trigger'
       AND schema_object.name=${sqlLiteral(contract.name)}
       AND schema_object.tbl_name=${sqlLiteral(contract.table)}
       AND ${sqlFragmentChecks.join("\n       AND ")}
  )`;
});

const DATABASE_READINESS_SQL = `
WITH normalized_schema AS (
  SELECT type,name,tbl_name,${normalizedSchemaSqlExpression("sql")} AS normalized_sql
    FROM sqlite_master
   WHERE name IN (${criticalSchemaNames.map(sqlLiteral).join(",")})
)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM sqlite_master WHERE ${objectPredicates.join(" OR ")})=${REQUIRED_SCHEMA_OBJECTS.length}
  AND ${columnChecks.join(" AND ")}
  AND ${tableContractChecks.join(" AND ")}
  AND ${indexContractChecks.join(" AND ")}
  AND ${triggerContractChecks.join(" AND ")}
THEN 1 ELSE 0 END AS ready`;

export async function isReleaseDatabaseReady(db: D1Database): Promise<boolean> {
  const row = await db.prepare(DATABASE_READINESS_SQL).first<{ ready: number }>();
  return Number(row?.ready ?? 0) === 1;
}
