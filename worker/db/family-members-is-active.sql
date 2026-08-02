-- Active-device isolation: mark the currently-paired child device.
-- 1 = current paired active device for this child slot; 0 = superseded/unpaired.
-- Additive + backfills every existing row to 1 (a paired-but-offline device stays
-- active so legit alerts resume on reconnect; only /join supersede or an explicit
-- /unpair flips it to 0).
--
-- SQLite (D1) has no "ADD COLUMN IF NOT EXISTS" — run once. Re-running yields a
-- harmless "duplicate column name: is_active" error.
--
-- Apply (prod):
--   cd worker && npx wrangler d1 execute hyeni-calendar --remote --file db/family-members-is-active.sql
-- Apply (local):
--   cd worker && npx wrangler d1 execute hyeni-calendar --local --file db/family-members-is-active.sql

ALTER TABLE family_members ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- Speeds up the gated parent-facing selects (family_id + role + is_active).
CREATE INDEX IF NOT EXISTS idx_family_members_family_role_active
  ON family_members (family_id, role, is_active);
