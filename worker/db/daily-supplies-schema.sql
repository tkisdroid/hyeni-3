-- Daily supplies/homework records for child-mode daily planning.
-- Additive and idempotent; apply with:
--   wrangler d1 execute hyeni-calendar --remote --file worker/db/daily-supplies-schema.sql

CREATE TABLE IF NOT EXISTS daily_supplies (
  id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  supplies TEXT DEFAULT '' NOT NULL,
  homework TEXT DEFAULT '' NOT NULL,
  note TEXT DEFAULT '' NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_daily_supplies_family_date
  ON daily_supplies (family_id, date_key);

CREATE INDEX IF NOT EXISTS idx_daily_supplies_family_child_date
  ON daily_supplies (family_id, child_id, date_key);
