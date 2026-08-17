-- 친구 초대 보상 정책 완화 — 운영 적용은 Worker 배포 **전에** 정확히 1회 수행한다(2026-08-17 TK 지시).
--
-- 바뀌는 것 두 가지뿐이다.
--   1) referral_codes_v2.successful_referrals 의 `BETWEEN 0 AND 3` 상한을 없앤다(초대 가족 수 무제한).
--   2) referral_completions_v2.reward_credits 의 `= 10` 고정을 `> 0` 으로 바꾼다(보상 50회).
--
-- SQLite/D1 은 CHECK 제약을 ALTER 로 못 바꿔 테이블을 새로 만들고 옮긴다.
-- 컬럼·기본값·UNIQUE·나머지 CHECK·인덱스는 그대로 유지하며 기존 행은 전부 보존한다.
-- rejection_reason enum 은 과거 행('success_cap_reached')을 깨지 않도록 값 목록을 유지한다.
-- 트리거는 본문이 referral_completions_v2 를 가리키므로 재작성 전후로 내렸다 다시 세운다.

-- 트리거는 referral_completions_v2 를 본문에서 참조하므로 재작성 동안 내렸다가 같은 트랜잭션에서 다시 세운다
-- (내리지 않으면 DROP 직후 "error in trigger ...: no such table" 로 전체가 롤백된다 — 실제로 겪었다).
DROP TRIGGER IF EXISTS trg_referral_location_evidence_snapshot;

CREATE TABLE IF NOT EXISTS "referral_codes_v2_unlimited" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "owner_parent_id" TEXT NOT NULL,
  "reward_child_user_id" TEXT NOT NULL,
  "code" TEXT NOT NULL COLLATE NOCASE,
  "status" TEXT DEFAULT 'active' NOT NULL CHECK ("status" IN ('active','revoked')),
  "successful_referrals" INTEGER DEFAULT 0 NOT NULL CHECK ("successful_referrals" >= 0),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revoked_at" TEXT,
  PRIMARY KEY ("id"),
  UNIQUE ("family_id"),
  UNIQUE ("code"),
  CHECK (length("code")=22 AND substr("code",1,6)='HYENI-')
);

INSERT INTO "referral_codes_v2_unlimited"
  ("id","family_id","owner_parent_id","reward_child_user_id","code","status",
   "successful_referrals","created_at","updated_at","revoked_at")
SELECT "id","family_id","owner_parent_id","reward_child_user_id","code","status",
       "successful_referrals","created_at","updated_at","revoked_at"
  FROM "referral_codes_v2";

DROP TABLE "referral_codes_v2";

ALTER TABLE "referral_codes_v2_unlimited" RENAME TO "referral_codes_v2";

CREATE INDEX IF NOT EXISTS "idx_referral_codes_v2_owner"
  ON "referral_codes_v2" ("owner_parent_id","status");

CREATE TABLE IF NOT EXISTS "referral_completions_v2_unlimited" (
  "id" TEXT NOT NULL,
  "referral_code_id" TEXT NOT NULL,
  "referrer_family_id" TEXT NOT NULL,
  "referrer_parent_id" TEXT NOT NULL,
  "referrer_child_user_id" TEXT NOT NULL,
  "referee_family_id" TEXT NOT NULL,
  "referee_parent_id" TEXT NOT NULL,
  "referee_child_user_id" TEXT,
  "status" TEXT DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending','qualified','rewarded','rejected')),
  "reward_credits" INTEGER DEFAULT 50 NOT NULL CHECK ("reward_credits" > 0),
  "first_location_at" TEXT,
  "latest_location_at" TEXT,
  "qualified_at" TEXT,
  "rewarded_at" TEXT,
  "rejection_reason" TEXT CHECK (
    "rejection_reason" IS NULL OR "rejection_reason" IN (
      'success_cap_reached','referrer_unavailable','referee_unavailable','reward_child_unavailable'
    )
  ),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("referee_family_id"),
  UNIQUE ("referee_parent_id"),
  UNIQUE ("referrer_family_id","referee_family_id"),
  CHECK ("referrer_family_id"<>"referee_family_id"),
  CHECK ("referrer_parent_id"<>"referee_parent_id")
);

INSERT INTO "referral_completions_v2_unlimited"
  ("id","referral_code_id","referrer_family_id","referrer_parent_id","referrer_child_user_id",
   "referee_family_id","referee_parent_id","referee_child_user_id","status","reward_credits",
   "first_location_at","latest_location_at","qualified_at","rewarded_at","rejection_reason",
   "created_at","updated_at")
SELECT "id","referral_code_id","referrer_family_id","referrer_parent_id","referrer_child_user_id",
       "referee_family_id","referee_parent_id","referee_child_user_id","status","reward_credits",
       "first_location_at","latest_location_at","qualified_at","rewarded_at","rejection_reason",
       "created_at","updated_at"
  FROM "referral_completions_v2";

DROP TABLE "referral_completions_v2";

ALTER TABLE "referral_completions_v2_unlimited" RENAME TO "referral_completions_v2";

CREATE INDEX IF NOT EXISTS "idx_referral_completions_v2_pending"
  ON "referral_completions_v2" ("status",substr("created_at",1,19),"id");

CREATE INDEX IF NOT EXISTS "idx_referral_completions_v2_referrer"
  ON "referral_completions_v2" ("referrer_family_id","status","created_at");

CREATE INDEX IF NOT EXISTS "idx_referral_completions_v2_ready"
  ON "referral_completions_v2" (substr("created_at",1,19),"id")
  WHERE "status" IN ('pending','qualified')
    AND "referee_child_user_id" IS NOT NULL
    AND "first_location_at" IS NOT NULL
    AND "latest_location_at" IS NOT NULL
    AND datetime(substr("latest_location_at",1,19))
      >= datetime(substr("first_location_at",1,19), '+48 hours');

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
