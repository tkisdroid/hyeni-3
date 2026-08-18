-- 아이 하루 대시보드(프리미엄 보호자에게 하루 한 번). 2026-08-19.
--
-- 1회성 보증: PRIMARY KEY (family_id, child_user_id, date_key).
-- 하루에 여러 번 cron 이 돌아도 INSERT 가 실제로 행을 만든 실행만 알림을 보낸다.
-- payload 에는 대화 원문을 넣지 않는다(주제·집계만) — childDailyDigest.js 참고.
CREATE TABLE IF NOT EXISTS "child_daily_digests" (
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "date_key" TEXT NOT NULL,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "alert_id" TEXT,
  "notified_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("family_id", "child_user_id", "date_key")
);

-- 보관 정리(cron)와 부모 조회가 같은 인덱스를 쓴다.
CREATE INDEX IF NOT EXISTS "idx_child_daily_digests_created"
  ON "child_daily_digests" ("created_at");
