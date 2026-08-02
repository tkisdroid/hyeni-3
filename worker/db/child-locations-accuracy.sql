-- 현재 위치 정확도(미터)를 부모 조회 응답까지 보존한다.
-- 기존 행은 NULL이며, 새 Android 빌드가 p_accuracy를 보낼 때부터 채워진다.
-- SQLite(D1)는 ADD COLUMN IF NOT EXISTS를 지원하지 않으므로 운영에서 1회만 실행한다.
--
-- 적용 전 확인:
--   wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(child_locations)"
-- 적용:
--   cd worker && npx wrangler d1 execute hyeni-calendar --remote --file db/child-locations-accuracy.sql

ALTER TABLE child_locations ADD COLUMN accuracy_m REAL;
