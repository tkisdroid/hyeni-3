-- 아이 연결 해제의 D1/R2 분산 cleanup을 재시도 가능하게 만드는 durable journal.
-- Worker 배포 전에 적용한다. CREATE IF NOT EXISTS라 재실행해도 안전하다.
CREATE TABLE IF NOT EXISTS "family_unpair_cleanup_jobs" (
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "member_ids" TEXT DEFAULT '[]' NOT NULL CHECK (json_valid("member_ids")),
  "exact_photo_keys" TEXT DEFAULT '[]' NOT NULL CHECK (json_valid("exact_photo_keys")),
  "preserve_photo_keys" TEXT DEFAULT '[]' NOT NULL CHECK (json_valid("preserve_photo_keys")),
  "attempts" INTEGER DEFAULT 0 NOT NULL CHECK ("attempts" >= 0),
  "last_error" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id", "child_user_id")
);

CREATE INDEX IF NOT EXISTS "idx_family_unpair_cleanup_jobs_updated"
  ON "family_unpair_cleanup_jobs" ("updated_at");
