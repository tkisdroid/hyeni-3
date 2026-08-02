-- 비밀번호 로그인 무차별 대입 방지용 시도 기록 (§3 감사 HIGH).
-- auth.ts /login-password 가 loginId 별 실패 횟수를 15분 윈도우로 집계해
-- 8회 초과 시 429. 성공 시 해당 loginId 기록 삭제.
--
-- worker/routes/auth.ts 의 loginRateLimited/recordLoginFailure 는 이 테이블이
-- 없으면 fail-open(정상 로그인 보호 우선)이므로, 이 SQL 미적용 상태로 배포해도
-- 로그인은 정상 동작하되 rate-limit 만 비활성이다. 적용하면 활성화된다.
--
-- 적용(사용자):
--   wrangler d1 execute hyeni-calendar --remote --file worker/db/login-rate-limit.sql
-- 로컬:
--   wrangler d1 execute hyeni-calendar --local --file worker/db/login-rate-limit.sql

CREATE TABLE IF NOT EXISTS login_attempts (
  login_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_id_at
  ON login_attempts (login_id, attempted_at);
