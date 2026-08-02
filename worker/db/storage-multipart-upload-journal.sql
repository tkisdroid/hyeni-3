-- 기존 storage cleanup journal을 multipart abort/complete 선형화 계약으로 확장한다.
-- 운영 DB에는 Worker 배포 직전에 정확히 한 번 적용한다(재실행 금지).
ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "multipart_upload_id" TEXT;

ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "upload_protocol" TEXT NOT NULL DEFAULT 'multipart'
    CHECK ("upload_protocol" IN ('multipart', 'reservation'));

ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "cleanup_started_at" TEXT;

ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "multipart_aborted_at" TEXT;

ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "reservation_etag" TEXT;

ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "reservation_retired_at" TEXT;

ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "committed_at" TEXT;

ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "cleaned_at" TEXT;

ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "request_id" TEXT;

ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "authorization_kind" TEXT;

ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "authorization_target_id" TEXT;

ALTER TABLE "storage_invalid_upload_cleanup_jobs"
  ADD COLUMN "content_sha256" TEXT;

CREATE UNIQUE INDEX "idx_storage_upload_request_owner"
  ON "storage_invalid_upload_cleanup_jobs" ("user_id", "request_id")
  WHERE "request_id" IS NOT NULL;
