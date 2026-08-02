-- 계정 삭제와 가족/스토리지 mutation 사이 TOCTOU를 닫는 durable claim과
-- post-upload rollback journal. 반드시 Worker 배포 전에 적용한다.
CREATE TABLE IF NOT EXISTS "account_deletion_jobs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "owner_user_id" TEXT NOT NULL UNIQUE,
  "mode" TEXT NOT NULL CHECK ("mode" IN ('family', 'self')),
  "status" TEXT NOT NULL DEFAULT 'claimed' CHECK ("status" IN ('claimed', 'running', 'completed')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "last_error" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "account_deletion_scopes" (
  "job_id" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL CHECK ("scope_type" IN ('user', 'family')),
  "scope_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("scope_type", "scope_id"),
  UNIQUE ("job_id", "scope_type", "scope_id")
);

CREATE INDEX IF NOT EXISTS "idx_account_deletion_scopes_job"
  ON "account_deletion_scopes" ("job_id", "scope_type", "scope_id");

CREATE TABLE IF NOT EXISTS "account_mutation_leases" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "family_id" TEXT,
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_account_mutation_leases_user_expiry"
  ON "account_mutation_leases" ("user_id", "expires_at");

CREATE INDEX IF NOT EXISTS "idx_account_mutation_leases_family_expiry"
  ON "account_mutation_leases" ("family_id", "expires_at");

CREATE TABLE IF NOT EXISTS "storage_invalid_upload_cleanup_jobs" (
  "object_key" TEXT NOT NULL PRIMARY KEY,
  "upload_nonce" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "user_day_key" TEXT NOT NULL,
  "family_id" TEXT,
  "family_day_key" TEXT,
  "byte_count" INTEGER NOT NULL CHECK ("byte_count" > 0),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "last_error" TEXT,
  "cleanup_after" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    ("family_id" IS NULL AND "family_day_key" IS NULL)
    OR ("family_id" IS NOT NULL AND "family_day_key" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "idx_storage_invalid_upload_cleanup_updated"
  ON "storage_invalid_upload_cleanup_jobs" ("cleanup_after", "updated_at");
