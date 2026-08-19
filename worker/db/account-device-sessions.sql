-- 계정당 활성 설치 1대만 허용한다.
-- device_id는 앱 설치별 비밀이 아닌 안정 식별자이며, 인증 토큰과 함께 서버에서 대조한다.
CREATE TABLE IF NOT EXISTS account_device_sessions (
  user_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  device_label TEXT,
  device_platform TEXT CHECK (device_platform IS NULL OR device_platform IN ('android','ios','web')),
  claimed_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_account_device_sessions_expiry
  ON account_device_sessions(expires_at, revoked_at);
