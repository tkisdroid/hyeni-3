-- 공개 익명 세션 발급의 IP/device HMAC bucket 제한과 orphan 정리를 위한 additive schema.
-- scope_hash에는 원문 IP/device id가 아니라 서버 secret HMAC-SHA256만 저장한다.
CREATE TABLE IF NOT EXISTS "anonymous_signup_rate_limits" (
  "scope_type" TEXT NOT NULL CHECK ("scope_type" IN ('ip', 'device')),
  "scope_hash" TEXT NOT NULL CHECK (length("scope_hash") = 64),
  "window_key" TEXT NOT NULL,
  "request_count" INTEGER DEFAULT 0 NOT NULL CHECK ("request_count" >= 0),
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("scope_type", "scope_hash", "window_key")
);

CREATE INDEX IF NOT EXISTS "idx_anonymous_signup_rate_limits_updated"
  ON "anonymous_signup_rate_limits" ("updated_at");

CREATE INDEX IF NOT EXISTS "idx_users_anonymous_created"
  ON "users" ("is_anonymous", "created_at");
