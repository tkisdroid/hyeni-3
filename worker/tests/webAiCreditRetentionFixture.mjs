/**
 * 분리 금융 보관 migration이 정본 bootstrap에 합쳐지기 전 fixture용 호환 적용이다.
 * 운영 삭제 플래너는 이 컬럼들이 없으면 계속 fail-closed한다.
 */
export function applyWebAiCreditRetentionFixture(sqlite) {
  const columns = new Set(
    sqlite.prepare("PRAGMA table_info('web_ai_credit_orders')").all().map((row) => String(row.name)),
  );
  const additions = [
    ["record_scope", "TEXT DEFAULT 'active' NOT NULL CHECK (record_scope IN ('active','detached'))"],
    ["balance_scope", "TEXT DEFAULT 'active' NOT NULL CHECK (balance_scope IN ('active','detached'))"],
    [
      "detach_reason",
      "TEXT CHECK (detach_reason IS NULL OR detach_reason IN ('account_deleted','family_deleted','child_unpaired'))",
    ],
    ["detached_at", "TEXT"],
    ["granted_credits", "INTEGER DEFAULT 0 NOT NULL CHECK (granted_credits>=0)"],
    ["grant_committed_at", "TEXT"],
    ["refunded_credits", "INTEGER DEFAULT 0 NOT NULL CHECK (refunded_credits>=0)"],
    ["refund_committed_at", "TEXT"],
    ["retention_until", "TEXT"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      sqlite.exec(`ALTER TABLE web_ai_credit_orders ADD COLUMN ${name} ${definition}`);
    }
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS web_ai_credit_detached_balances (
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL,
      purchased_credits INTEGER DEFAULT 0 NOT NULL,
      restoration_state TEXT NOT NULL CHECK (restoration_state IN ('blocked','closed')),
      detached_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      retention_until TEXT NOT NULL,
      PRIMARY KEY (family_id,child_user_id)
    );
  `);
}
