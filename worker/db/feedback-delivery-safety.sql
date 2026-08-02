-- 기능 제안 durable 접수의 사용자별 시간 창 조회를 bounded하게 유지한다.
-- 기존 user_feedback 행·컬럼은 변경하지 않는 additive index다.
CREATE INDEX IF NOT EXISTS idx_user_feedback_feature_rate
  ON user_feedback (user_id, type, created_at);
