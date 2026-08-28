-- 이미 운영 중인 OAuth transaction 테이블에 네이티브 응답 유실 복구용
-- 비민감 식별자만 추가한다. raw recovery ID/device ID/token은 저장하지 않는다.
ALTER TABLE oauth_state_transactions ADD COLUMN recovery_id_hash TEXT;
ALTER TABLE oauth_state_transactions ADD COLUMN recovery_binding_hash TEXT;
ALTER TABLE oauth_state_transactions ADD COLUMN recovery_user_id TEXT;
ALTER TABLE oauth_state_transactions ADD COLUMN recovery_account_status TEXT;
ALTER TABLE oauth_state_transactions ADD COLUMN recovery_access_jti TEXT;
ALTER TABLE oauth_state_transactions ADD COLUMN recovery_refresh_token_hash TEXT;
ALTER TABLE oauth_state_transactions ADD COLUMN recovery_ready_at TEXT;
ALTER TABLE oauth_state_transactions ADD COLUMN recovery_expires_at TEXT;
ALTER TABLE oauth_state_transactions ADD COLUMN recovery_acknowledged_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_recovery_id
  ON oauth_state_transactions(recovery_id_hash)
  WHERE recovery_id_hash IS NOT NULL;
