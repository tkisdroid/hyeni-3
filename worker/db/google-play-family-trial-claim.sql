-- Google Play와 Toss가 가족 단위 평생 1회 체험 claim을 공유한다.
-- 기존 Toss 행은 DEFAULT로 toss_web을 유지한다. 이 migration은 정확히 1회만 적용한다.
ALTER TABLE "web_billing_trial_claims"
  ADD COLUMN "provider" TEXT DEFAULT 'toss_web' NOT NULL
  CHECK ("provider" IN ('toss_web','google_play'));
