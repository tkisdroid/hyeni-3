-- 다가족/레거시 빈 가족이 함께 있는 사용자도 현재 가족을 결정적으로 유지한다.
-- 배포 순서: 이 additive migration을 Worker 코드보다 먼저 적용한다.
ALTER TABLE family_members ADD COLUMN last_selected_at TEXT;

-- 기존 기기의 live refresh snapshot을 초기 선택 표시로 승격한다. 여러 가족 snapshot이
-- 남아 있으면 가족별 가장 최근 발급 시각이 저장되고 resolver가 그중 최신을 고른다.
UPDATE family_members
   SET last_selected_at = (
     SELECT MAX(rt.issued_at)
       FROM refresh_tokens rt
      WHERE rt.user_id = family_members.user_id
        AND rt.family_id = family_members.family_id
        AND rt.revoked = 0
        AND rt.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
   )
 WHERE is_active = 1
   AND user_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM refresh_tokens rt
      WHERE rt.user_id = family_members.user_id
        AND rt.family_id = family_members.family_id
        AND rt.revoked = 0
        AND rt.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
   );

CREATE INDEX IF NOT EXISTS idx_family_members_user_current
  ON family_members(user_id, is_active, last_selected_at);
