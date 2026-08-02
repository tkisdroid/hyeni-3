-- 메모 저장 성공과 알림 전달 의도를 원자 확정하는 durable outbox.
-- Worker 배포 전에 1회 적용한다. 완료된 행은 소비자가 lease 조건으로 삭제한다.
CREATE TABLE IF NOT EXISTS memo_notification_outbox (
  reply_id TEXT NOT NULL PRIMARY KEY,
  family_id TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memo_notification_outbox_due
  ON memo_notification_outbox (next_attempt_at, lease_expires_at, created_at);

CREATE INDEX IF NOT EXISTS idx_memo_notification_outbox_family
  ON memo_notification_outbox (family_id);

CREATE TRIGGER IF NOT EXISTS trg_memo_notification_outbox_reply_delete
AFTER DELETE ON memo_replies
BEGIN
  DELETE FROM memo_notification_outbox WHERE reply_id = OLD.id;
END;
