-- 사용자별 R2 업로드 저장 증폭을 UTC 일일 개수·바이트로 제한한다.
-- Worker 배포 전에 적용한다. CREATE IF NOT EXISTS라 재실행해도 안전하다.
CREATE TABLE IF NOT EXISTS "storage_upload_daily_usage" (
  "user_id" TEXT NOT NULL,
  "day_key" TEXT NOT NULL,
  "object_count" INTEGER DEFAULT 0 NOT NULL CHECK ("object_count" >= 0),
  "byte_count" INTEGER DEFAULT 0 NOT NULL CHECK ("byte_count" >= 0),
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("user_id", "day_key")
);

CREATE INDEX IF NOT EXISTS "idx_storage_upload_daily_usage_updated"
  ON "storage_upload_daily_usage" ("updated_at");
