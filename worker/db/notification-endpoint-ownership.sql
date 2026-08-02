-- 1회용 운영 migration. 이 저장소에는 schema_migrations 실행기가 없으므로 재실행하지 않는다.
-- 안전한 배포 순서: 이 파일 1회 적용 -> 즉시 최신 Worker 배포 -> 최신 앱 배포.
-- 최신 Worker의 발송 조회는 disabled_at을 필수 사용하므로 이 migration보다 먼저 배포하지 않는다.
-- 기존 endpoint 행은 감사·복구 근거로 남기고, 전송 대상이 아닌 행만 비활성화한다.

ALTER TABLE fcm_tokens ADD COLUMN registration_instance_id TEXT;
ALTER TABLE fcm_tokens ADD COLUMN disabled_at TEXT;
ALTER TABLE fcm_tokens ADD COLUMN disabled_reason TEXT;

ALTER TABLE push_subscriptions ADD COLUMN updated_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN registration_instance_id TEXT;
ALTER TABLE push_subscriptions ADD COLUMN disabled_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN disabled_reason TEXT;

-- 서로 다른 사용자가 같은 FCM token을 가진 과거 행은 정당한 현재 소유자를 증명할 수 없으므로
-- 한 행을 임의 선택하지 않고 그룹 전체를 닫는다.
WITH ambiguous_tokens AS (
  SELECT fcm_token
    FROM fcm_tokens
   GROUP BY fcm_token
  HAVING COUNT(DISTINCT user_id) > 1
)
UPDATE fcm_tokens
   SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       disabled_reason = 'cross_user_ownership'
 WHERE fcm_token IN (SELECT fcm_token FROM ambiguous_tokens);

-- 현재 가족의 활성 부모/아이로 확인되지 않는 소유권은 전송에서 제외한다.
UPDATE fcm_tokens
   SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       disabled_reason = 'invalid_owner'
 WHERE disabled_at IS NULL
   AND (
     trim(fcm_token) = ''
     OR NOT (
       EXISTS (
         SELECT 1 FROM families f
          WHERE f.id = fcm_tokens.family_id
            AND f.parent_id = fcm_tokens.user_id
       )
       OR EXISTS (
         SELECT 1 FROM family_members fm
          WHERE fm.family_id = fcm_tokens.family_id
            AND fm.user_id = fcm_tokens.user_id
            AND fm.role IN ('parent', 'child')
            AND fm.is_active = 1
       )
     )
   );

-- 같은 사용자의 중복은 최신 1행만 활성으로 남긴다.
WITH ranked_tokens AS (
  SELECT
    rowid AS target_rowid,
    ROW_NUMBER() OVER (
      PARTITION BY fcm_token
      ORDER BY
        replace(substr(COALESCE(NULLIF(updated_at, ''), NULLIF(created_at, ''), ''), 1, 23), ' ', 'T') DESC,
        replace(substr(COALESCE(NULLIF(created_at, ''), ''), 1, 23), ' ', 'T') DESC,
        rowid DESC,
        id DESC
    ) AS endpoint_rank
  FROM fcm_tokens
  WHERE disabled_at IS NULL
)
UPDATE fcm_tokens
   SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       disabled_reason = 'duplicate_token'
 WHERE rowid IN (
   SELECT target_rowid FROM ranked_tokens WHERE endpoint_rank > 1
 );

WITH ambiguous_endpoints AS (
  SELECT endpoint
    FROM push_subscriptions
   GROUP BY endpoint
  HAVING COUNT(DISTINCT user_id) > 1
)
UPDATE push_subscriptions
   SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       disabled_reason = 'cross_user_ownership'
 WHERE endpoint IN (SELECT endpoint FROM ambiguous_endpoints);

UPDATE push_subscriptions
   SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       disabled_reason = 'invalid_owner'
 WHERE disabled_at IS NULL
   AND (
     trim(endpoint) = ''
     OR NOT (
       EXISTS (
         SELECT 1 FROM families f
          WHERE f.id = push_subscriptions.family_id
            AND f.parent_id = push_subscriptions.user_id
       )
       OR EXISTS (
         SELECT 1 FROM family_members fm
          WHERE fm.family_id = push_subscriptions.family_id
            AND fm.user_id = push_subscriptions.user_id
            AND fm.role IN ('parent', 'child')
            AND fm.is_active = 1
       )
     )
   );

WITH ranked_endpoints AS (
  SELECT
    rowid AS target_rowid,
    ROW_NUMBER() OVER (
      PARTITION BY endpoint
      ORDER BY
        replace(substr(COALESCE(NULLIF(updated_at, ''), NULLIF(created_at, ''), ''), 1, 23), ' ', 'T') DESC,
        replace(substr(COALESCE(NULLIF(created_at, ''), ''), 1, 23), ' ', 'T') DESC,
        rowid DESC,
        id DESC
    ) AS endpoint_rank
  FROM push_subscriptions
  WHERE disabled_at IS NULL
)
UPDATE push_subscriptions
   SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       disabled_reason = 'duplicate_endpoint'
 WHERE rowid IN (
   SELECT target_rowid FROM ranked_endpoints WHERE endpoint_rank > 1
 );

-- 과거 앱의 정상 단일 소유 행은 알 수 없는 이전 세션이라는 sentinel로 보존한다.
-- 같은 user/family의 최신 앱 등록만 이 값을 실제 session_instance_id로 승격할 수 있다.
UPDATE fcm_tokens
   SET registration_instance_id = 'legacy:' || id
 WHERE trim(COALESCE(registration_instance_id, '')) = '';

UPDATE push_subscriptions
   SET registration_instance_id = 'legacy:' || id
 WHERE trim(COALESCE(registration_instance_id, '')) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_fcm_tokens_token_active_unique
  ON fcm_tokens(fcm_token)
  WHERE disabled_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint_active_unique
  ON push_subscriptions(endpoint)
  WHERE disabled_at IS NULL;
