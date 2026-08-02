-- 같은 가족에서 익명 계정을 반복 생성해 user quota를 우회하는 저장 증폭을 막는다.
-- Worker 배포 전에 적용한다. CREATE IF NOT EXISTS라 재실행해도 안전하다.
CREATE TABLE IF NOT EXISTS "storage_upload_family_daily_usage" (
  "family_id" TEXT NOT NULL,
  "day_key" TEXT NOT NULL,
  "object_count" INTEGER DEFAULT 0 NOT NULL CHECK ("object_count" >= 0),
  "byte_count" INTEGER DEFAULT 0 NOT NULL CHECK ("byte_count" >= 0),
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id", "day_key")
);

CREATE INDEX IF NOT EXISTS "idx_storage_upload_family_daily_usage_updated"
  ON "storage_upload_family_daily_usage" ("updated_at");
