-- 아이가 요청 화면에서 직접 동의한 서버 시각을 정본으로 저장한다.
-- 이 migration을 적용한 뒤 consent endpoint/오디오 중계 Worker를 배포한다.
ALTER TABLE remote_listen_sessions ADD COLUMN consented_at TEXT;
ALTER TABLE remote_listen_sessions ADD COLUMN capture_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_remote_listen_capture_window
  ON remote_listen_sessions(child_user_id, id, capture_expires_at)
  WHERE ended_at IS NULL AND consented_at IS NOT NULL;
