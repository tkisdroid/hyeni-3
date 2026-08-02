-- Google Play AI 크레딧 환불 사용분 상계 결과를 구매 이벤트에 고정한다.
-- 운영에는 Worker 배포 전에 정확히 한 번 적용한다.
ALTER TABLE "google_play_purchase_events"
  ADD COLUMN "debt_applied" INTEGER DEFAULT 0 NOT NULL
  CHECK ("debt_applied">=0 AND ("credit_amount" IS NULL OR "debt_applied"<="credit_amount"));
