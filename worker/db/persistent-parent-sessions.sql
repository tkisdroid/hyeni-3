-- 지속 만료 표식을 보존하는 Worker 배포 뒤 1회 적용한다. 이미 만료·철회된 인증은 부활시키지 않는다.
-- 현재 활성 부모 설치의 미만료 토큰만 유지하며, 회전된 과거 토큰은 연장하지 않는다.
UPDATE refresh_tokens
   SET expires_at='9999-12-31T23:59:59.999Z'
 WHERE revoked=0 AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND EXISTS (
     SELECT 1 FROM account_device_sessions ads
      JOIN family_members fm ON fm.user_id=ads.user_id
      JOIN users u ON u.id=ads.user_id
     WHERE ads.user_id=refresh_tokens.user_id
       AND ads.device_id=refresh_tokens.device_id
       AND ads.revoked_at IS NULL
       AND ads.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
       AND fm.role='parent' AND fm.is_active=1 AND u.is_anonymous=0
   );

UPDATE account_device_sessions
   SET expires_at='9999-12-31T23:59:59.999Z'
 WHERE revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND EXISTS (
     SELECT 1 FROM refresh_tokens rt
      WHERE rt.user_id=account_device_sessions.user_id
        AND rt.device_id=account_device_sessions.device_id
        AND rt.revoked=0 AND rt.expires_at='9999-12-31T23:59:59.999Z'
   );
