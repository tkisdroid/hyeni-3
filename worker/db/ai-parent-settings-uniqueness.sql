-- ai_parent_settings는 가족·아이별 한 행만 허용한다.
-- 중복 행을 자동 삭제하지 않으며, 중복이 있으면 index 생성이 실패해 Worker 선행 배포를 차단한다.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_parent_settings_family_child"
  ON "ai_parent_settings" ("family_id", "child_user_id");
