-- 서비스 전역 운영 설정(키-값). 첫 사용처는 아이 AI 친구의 "운영자 지침" 프롬프트다.
-- 가족·아이 단위 설정(ai_parent_settings)과 달리 모든 가족에 함께 적용되므로,
-- 쓰기는 ADMIN_USER_IDS 화이트리스트를 통과한 관리자만 할 수 있다(routes/admin.ts).
-- additive 전용 — 기존 테이블·행을 건드리지 않는다.
CREATE TABLE IF NOT EXISTS app_global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Study는 명시적으로 열기 전까지 어떤 가족에게도 노출하지 않는다.
-- rollout 대상은 raw family ID가 아닌 domain-separated HMAC familyRef만 저장한다.
INSERT OR IGNORE INTO app_global_settings (key, value)
VALUES
  ('study_management_enabled', 'false'),
  ('study_learner_enabled', 'false'),
  ('study_rollout_basis_points', '0'),
  ('study_rollout_canary_refs', '[]');
