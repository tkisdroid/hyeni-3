-- new_memo 전달과 사용자 차단/해제를 같은 무방향 사용자 pair에서 선형화한다.
-- 모든 식별자는 Worker에서 ASCII safe-id 검증 후 user_a_id < user_b_id로 저장한다.
CREATE TABLE IF NOT EXISTS memo_interaction_leases (
  family_id TEXT NOT NULL,
  user_a_id TEXT NOT NULL,
  user_b_id TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (family_id, user_a_id, user_b_id),
  CHECK (user_a_id <> user_b_id),
  CHECK (user_a_id < user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_memo_interaction_leases_expiry
  ON memo_interaction_leases (expires_at);
