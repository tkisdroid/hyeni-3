-- 반복 일정의 명시적 소유 시리즈를 저장한다.
-- 기존 일정은 NULL이며, NULL 행을 제목·시간 휴리스틱으로 묶지 않는다.
-- SQLite(D1)는 ADD COLUMN IF NOT EXISTS를 지원하지 않으므로 운영에서 1회만 실행한다.
--
-- 적용 전 확인:
--   npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(events)"
-- 적용:
--   npx wrangler d1 execute hyeni-calendar --remote --file db/event-series-id.sql

ALTER TABLE events ADD COLUMN series_id TEXT;

CREATE INDEX IF NOT EXISTS idx_events_series_id
  ON events (series_id);
