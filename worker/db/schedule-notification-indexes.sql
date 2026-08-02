-- cron의 논리 알림 claim을 원자화한다. 적용 전 중복 그룹이 0건인지 확인해야 한다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_sent_event_notif
  ON push_sent(event_id, notif_key);

-- 매분 오늘/내일 일정 스캔 및 부모 foreground pending 회수 경로.
CREATE INDEX IF NOT EXISTS idx_events_date_key
  ON events(date_key);

CREATE INDEX IF NOT EXISTS idx_pending_family_delivery_expiry_created
  ON pending_notifications(family_id, delivered, expires_at, created_at);
