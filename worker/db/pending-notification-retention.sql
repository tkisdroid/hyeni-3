-- 만료된 delivery queue를 시간순 bounded cleanup할 때 전체 테이블 scan을 피한다.
-- substr는 이관 PG timestamp와 Worker ISO timestamp가 섞인 과거 행을 같은 UTC 초로 비교한다.
CREATE INDEX IF NOT EXISTS idx_pending_notifications_expiry
  ON pending_notifications(replace(substr(expires_at, 1, 19), 'T', ' '), id);
