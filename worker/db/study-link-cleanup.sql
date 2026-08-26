-- Calendar 자녀 연결 종료를 Study에 멱등 전달하는 durable receipt queue.
-- Study 학습 이력은 삭제하지 않고 link/device만 비활성화한다.
CREATE TABLE IF NOT EXISTS "study_link_cleanup_receipts" (
  "request_id" TEXT PRIMARY KEY,
  "source_kind" TEXT NOT NULL CHECK ("source_kind" IN ('child_deactivate','family_unpair','account_delete')),
  "source_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_member_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','processing','completed')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "last_error_code" TEXT,
  "next_attempt_at" TEXT NOT NULL,
  "completed_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  UNIQUE("source_kind", "source_id", "family_id", "child_member_id")
);

CREATE INDEX IF NOT EXISTS "idx_study_link_cleanup_due"
  ON "study_link_cleanup_receipts"("status", "next_attempt_at");
