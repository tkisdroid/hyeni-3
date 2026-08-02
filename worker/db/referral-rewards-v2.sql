-- 친구 초대 보상 v2 — 운영 적용은 Worker 배포 전에 정확히 1회 수행한다.
-- 이 migration은 기존 referral_codes/referral_completions/point_wallets를 변경하지 않는다.
-- 추천 보상은 Free/Premium entitlement가 아닌 추가 AI 대화 크레딧 10회이며,
-- 위치 좌표·주소·전화번호·이름은 추천 테이블에 저장하지 않는다.

CREATE TABLE IF NOT EXISTS referral_codes_v2 (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  owner_parent_id TEXT NOT NULL,
  reward_child_user_id TEXT NOT NULL,
  code TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','revoked')),
  successful_referrals INTEGER NOT NULL DEFAULT 0
    CHECK (successful_referrals BETWEEN 0 AND 3),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  UNIQUE (family_id),
  UNIQUE (code),
  CHECK (length(code) = 22 AND substr(code,1,6) = 'HYENI-')
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_v2_owner
  ON referral_codes_v2(owner_parent_id, status);

CREATE TABLE IF NOT EXISTS referral_completions_v2 (
  id TEXT PRIMARY KEY,
  referral_code_id TEXT NOT NULL,
  referrer_family_id TEXT NOT NULL,
  referrer_parent_id TEXT NOT NULL,
  referrer_child_user_id TEXT NOT NULL,
  referee_family_id TEXT NOT NULL,
  referee_parent_id TEXT NOT NULL,
  referee_child_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','qualified','rewarded','rejected')),
  reward_credits INTEGER NOT NULL DEFAULT 10
    CHECK (reward_credits = 10),
  first_location_at TEXT,
  latest_location_at TEXT,
  qualified_at TEXT,
  rewarded_at TEXT,
  rejection_reason TEXT
    CHECK (rejection_reason IS NULL OR rejection_reason IN (
      'success_cap_reached','referrer_unavailable','referee_unavailable','reward_child_unavailable'
    )),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (referee_family_id),
  UNIQUE (referee_parent_id),
  UNIQUE (referrer_family_id, referee_family_id),
  CHECK (referrer_family_id <> referee_family_id),
  CHECK (referrer_parent_id <> referee_parent_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_completions_v2_pending
  ON referral_completions_v2(status, substr(created_at,1,19), id);

CREATE INDEX IF NOT EXISTS idx_referral_completions_v2_referrer
  ON referral_completions_v2(referrer_family_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_referral_completions_v2_ready
  ON referral_completions_v2(substr(created_at,1,19), id)
  WHERE status IN ('pending','qualified')
    AND referee_child_user_id IS NOT NULL
    AND first_location_at IS NOT NULL
    AND latest_location_at IS NOT NULL
    AND datetime(substr(latest_location_at,1,19))
      >= datetime(substr(first_location_at,1,19), '+48 hours');

-- 원본 확인자료를 cron에서 다시 훑지 않도록 첫 실측과 48시간 충족 경계만 요약한다.
-- 정상적인 중간 fix는 UPDATE하지 않고, 늦게 들어온 더 이른 fix는 최초 경계를 보정한다.
CREATE TRIGGER IF NOT EXISTS trg_referral_location_evidence_snapshot
AFTER INSERT ON location_confirmation_records
WHEN NEW.action='collect'
 AND NEW.collection_method='android_fused_location'
 AND NEW.acquisition_path='android_native_app'
 AND NEW.service_code IN ('current_location_ingest','location_history_ingest')
 AND NEW.purpose_code='family_location_safety'
BEGIN
  UPDATE referral_completions_v2
     SET referee_child_user_id=COALESCE(referee_child_user_id,NEW.subject_user_id),
         first_location_at=CASE
           WHEN first_location_at IS NULL
             OR substr(NEW.occurred_at,1,19)<substr(first_location_at,1,19)
           THEN NEW.occurred_at
           ELSE first_location_at
         END,
         latest_location_at=CASE
           WHEN first_location_at IS NULL OR latest_location_at IS NULL
           THEN NEW.occurred_at
           WHEN substr(NEW.occurred_at,1,19)<substr(first_location_at,1,19)
           THEN latest_location_at
           WHEN datetime(substr(NEW.occurred_at,1,19))
                >=datetime(substr(first_location_at,1,19),'+48 hours')
             AND substr(NEW.occurred_at,1,19)>substr(latest_location_at,1,19)
           THEN NEW.occurred_at
           ELSE latest_location_at
         END,
         updated_at=CURRENT_TIMESTAMP
   WHERE referee_family_id=NEW.family_id
     AND status IN ('pending','qualified')
     AND substr(NEW.occurred_at,1,19)>=substr(created_at,1,19)
     AND (referee_child_user_id IS NULL OR referee_child_user_id=NEW.subject_user_id)
     AND EXISTS (
       SELECT 1 FROM family_members member
        WHERE member.family_id=NEW.family_id
          AND member.user_id=NEW.subject_user_id
          AND member.role='child'
          AND member.is_active=1
     )
     AND NOT (
       referee_child_user_id IS NOT NULL
       AND first_location_at IS NOT NULL
       AND latest_location_at IS NOT NULL
       AND datetime(substr(latest_location_at,1,19))
           >=datetime(substr(first_location_at,1,19),'+48 hours')
     )
     AND (
       first_location_at IS NULL
       OR latest_location_at IS NULL
       OR substr(NEW.occurred_at,1,19)<substr(first_location_at,1,19)
       OR datetime(substr(NEW.occurred_at,1,19))
          >=datetime(substr(first_location_at,1,19),'+48 hours')
     );
END;
