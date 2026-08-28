-- 인증 테이블 — GoTrue(auth.users/auth.identities) 대체.
-- 기존 uuid와 bcrypt 해시를 보존해 데이터 FK 정합성과 비밀번호 로그인을 유지.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,              -- 기존 auth.users.id (uuid) 보존
  phone TEXT,                       -- 인증형 전화번호 (GoTrue 저장 형식)
  email TEXT,
  encrypted_password TEXT,          -- GoTrue bcrypt 해시 그대로
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  raw_user_meta_data TEXT,          -- login_id/name/gender/birthdate JSON
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,           -- phone/kakao/google/naver
  provider_id TEXT NOT NULL,        -- 제공자 측 식별자
  identity_data TEXT,
  created_at TEXT,
  PRIMARY KEY (provider, provider_id)
);
CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);

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

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token TEXT PRIMARY KEY,           -- 불투명 랜덤 토큰
  user_id TEXT NOT NULL,
  family_id TEXT,
  device_id TEXT,
  issued_at TEXT,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  rotated_to TEXT,
  rotated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

-- 같은 계정으로 여러 설치가 동시에 가족/아이 정보를 열람하지 못하게 하는 활성 설치 잠금.
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
