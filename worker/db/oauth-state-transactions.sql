-- OAuth 인가코드 탈취·로그인 CSRF 방지용 서버 상태 트랜잭션.
-- raw state/code는 저장하지 않고 SHA-256 해시만 저장하며 10분 후 만료한다.
CREATE TABLE IF NOT EXISTS oauth_state_transactions (
  state_hash TEXT PRIMARY KEY,
  transaction_secret_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('kakao', 'google', 'naver')),
  client_kind TEXT NOT NULL CHECK (client_kind IN ('native', 'web')),
  redirect_target TEXT NOT NULL,
  flow_mode TEXT NOT NULL CHECK (flow_mode IN ('login', 'link')),
  user_id TEXT,
  authorization_code_hash TEXT,
  callback_received_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (
    (flow_mode = 'link' AND user_id IS NOT NULL)
    OR (flow_mode = 'login' AND user_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_oauth_state_expiry
  ON oauth_state_transactions(expires_at, consumed_at);
