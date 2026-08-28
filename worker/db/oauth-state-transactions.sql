-- OAuth 인가코드 탈취·로그인 CSRF 방지용 서버 상태 트랜잭션.
-- raw state/code는 저장하지 않고 SHA-256 해시만 저장하며 10분 후 만료한다.
CREATE TABLE IF NOT EXISTS oauth_state_transactions (
  state_hash TEXT PRIMARY KEY,
  transaction_secret_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('kakao', 'google', 'naver')),
  -- native는 Android/iOS 앱 capability 공통값이며 정확한 복귀 방식은 redirect_target에 저장한다.
  client_kind TEXT NOT NULL CHECK (client_kind IN ('native', 'web')),
  redirect_target TEXT NOT NULL,
  flow_mode TEXT NOT NULL CHECK (flow_mode IN ('login', 'link')),
  user_id TEXT,
  authorization_code_hash TEXT,
  callback_received_at TEXT,
  consumed_at TEXT,
  recovery_id_hash TEXT,
  recovery_binding_hash TEXT,
  recovery_user_id TEXT,
  recovery_account_status TEXT CHECK (
    recovery_account_status IS NULL
    OR recovery_account_status IN ('created', 'existing', 'linked')
  ),
  recovery_access_jti TEXT,
  recovery_refresh_token_hash TEXT,
  recovery_ready_at TEXT,
  recovery_expires_at TEXT,
  recovery_acknowledged_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (
    (flow_mode = 'link' AND user_id IS NOT NULL)
    OR (flow_mode = 'login' AND user_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_oauth_state_expiry
  ON oauth_state_transactions(expires_at, consumed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_recovery_id
  ON oauth_state_transactions(recovery_id_hash)
  WHERE recovery_id_hash IS NOT NULL;
