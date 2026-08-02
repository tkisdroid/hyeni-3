-- 가족 메모 상호작용 차단. 가족 연결·위치·SOS·안전 알림과 분리한다.
CREATE TABLE IF NOT EXISTS user_interaction_blocks (
  family_id TEXT NOT NULL,
  blocker_user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (family_id, blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_interaction_blocks_blocked
  ON user_interaction_blocks (family_id, blocked_user_id, blocker_user_id);
