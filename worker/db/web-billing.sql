-- iPhone 홈 화면 PWA용 Toss Payments 자동결제 정본.
-- 운영에는 이 additive migration을 Worker보다 먼저 정확히 한 번 적용한다.

CREATE TABLE IF NOT EXISTS "web_billing_checkout_sessions" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "customer_key" TEXT NOT NULL,
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month', 'year')),
  "amount" INTEGER NOT NULL CHECK (
    ("plan" = 'month' AND "amount" = 4900)
    OR ("plan" = 'year' AND "amount" = 39000)
  ),
  "trial_eligible" INTEGER DEFAULT 0 NOT NULL CHECK ("trial_eligible" IN (0,1)),
  "trial_days" INTEGER DEFAULT 0 NOT NULL CHECK (
    ("trial_eligible"=1 AND "trial_days"=7)
    OR ("trial_eligible"=0 AND "trial_days"=0)
  ),
  "status" TEXT DEFAULT 'pending' NOT NULL
    CHECK ("status" IN ('pending', 'processing', 'completed', 'failed', 'expired')),
  "expires_at" TEXT NOT NULL,
  "claim_token" TEXT,
  "claim_expires_at" TEXT,
  "error_code" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("customer_key"),
  CHECK (
    ("claim_token" IS NULL AND "claim_expires_at" IS NULL)
    OR ("claim_token" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "idx_web_billing_checkout_family_parent"
  ON "web_billing_checkout_sessions" ("family_id", "parent_id", "status", "expires_at");

CREATE INDEX IF NOT EXISTS "idx_web_billing_checkout_claim"
  ON "web_billing_checkout_sessions" ("status", "claim_expires_at");

CREATE TABLE IF NOT EXISTS "web_billing_customers" (
  "family_id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "customer_key" TEXT NOT NULL,
  "billing_key_ciphertext" TEXT,
  "billing_key_iv" TEXT,
  "billing_key_version" TEXT,
  "billing_key_revocation_status" TEXT
    CHECK ("billing_key_revocation_status" IN ('pending','revoked')),
  "billing_key_revocation_attempts" INTEGER DEFAULT 0 NOT NULL
    CHECK ("billing_key_revocation_attempts" >= 0),
  "billing_key_revocation_retry_at" TEXT,
  "billing_key_revocation_error" TEXT,
  "billing_key_revoked_at" TEXT,
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month', 'year')),
  "status" TEXT NOT NULL
    CHECK ("status" IN ('pending_charge', 'trial', 'active', 'cancel_at_period_end', 'past_due', 'expired')),
  "trial_ends_at" TEXT,
  "current_period_end" TEXT,
  "next_charge_at" TEXT,
  "retry_after" TEXT,
  "failure_count" INTEGER DEFAULT 0 NOT NULL CHECK ("failure_count" >= 0),
  "cancelled_at" TEXT,
  "last_order_id" TEXT,
  "last_paid_order_id" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id"),
  UNIQUE ("customer_key"),
  CHECK (
    ("billing_key_ciphertext" IS NULL AND "billing_key_iv" IS NULL AND "billing_key_version" IS NULL)
    OR
    ("billing_key_ciphertext" IS NOT NULL AND "billing_key_iv" IS NOT NULL AND "billing_key_version" = 'v1')
  ),
  CHECK (
    "billing_key_revocation_status"<>'pending'
    OR (
      "billing_key_ciphertext" IS NOT NULL
      AND "billing_key_iv" IS NOT NULL
      AND "billing_key_version"='v1'
    )
  ),
  CHECK (
    ("status"='trial' AND "trial_ends_at" IS NOT NULL AND "next_charge_at"="trial_ends_at")
    OR "status"<>'trial'
  )
);

CREATE INDEX IF NOT EXISTS "idx_web_billing_customers_renewal"
  ON "web_billing_customers" ("status", "next_charge_at", "retry_after");

CREATE INDEX IF NOT EXISTS "idx_web_billing_customers_key_revocation"
  ON "web_billing_customers"
     ("billing_key_revocation_status", "billing_key_revocation_retry_at", "updated_at");

CREATE TABLE IF NOT EXISTS "web_billing_charge_attempts" (
  "order_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "checkout_session_id" TEXT,
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month', 'year')),
  "amount" INTEGER NOT NULL CHECK (
    ("plan" = 'month' AND "amount" = 4900)
    OR ("plan" = 'year' AND "amount" = 39000)
  ),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('initial', 'trial_conversion', 'renewal')),
  "customer_key" TEXT,
  "period_start" TEXT NOT NULL,
  "period_end" TEXT NOT NULL,
  "status" TEXT NOT NULL
    CHECK ("status" IN ('pending', 'processing', 'done', 'failed', 'unknown')),
  "claim_token" TEXT,
  "claim_expires_at" TEXT,
  "payment_key_hash" TEXT,
  "refund_status" TEXT DEFAULT 'none' NOT NULL
    CHECK ("refund_status" IN ('none','partial','full')),
  "refunded_amount" INTEGER DEFAULT 0 NOT NULL
    CHECK ("refunded_amount">=0 AND "refunded_amount"<="amount"),
  "refund_state_hash" TEXT CHECK (
    "refund_state_hash" IS NULL OR (
      length("refund_state_hash")=64 AND "refund_state_hash" NOT GLOB '*[^0-9a-f]*'
    )
  ),
  "provider_checked_at" TEXT,
  "refund_committed_at" TEXT,
  "refund_webhook_checked_at" TEXT,
  "refund_funnel_status" TEXT DEFAULT 'none' NOT NULL
    CHECK ("refund_funnel_status" IN ('none','pending','sent')),
  "error_code" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "completed_at" TEXT,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("order_id"),
  CHECK (
    ("claim_token" IS NULL AND "claim_expires_at" IS NULL)
    OR ("claim_token" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
  ),
  CHECK (
    ("refund_status"='none' AND "refunded_amount"=0
      AND "refund_state_hash" IS NULL AND "refund_committed_at" IS NULL)
    OR ("refund_status"='partial' AND "refunded_amount">0 AND "refunded_amount"<"amount"
      AND "refund_state_hash" IS NOT NULL AND "refund_committed_at" IS NOT NULL)
    OR ("refund_status"='full' AND "refunded_amount"="amount"
      AND "refund_state_hash" IS NOT NULL AND "refund_committed_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_web_billing_charge_initial_session"
  ON "web_billing_charge_attempts" ("checkout_session_id")
  WHERE "kind" = 'initial' AND "checkout_session_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_web_billing_charge_family_created"
  ON "web_billing_charge_attempts" ("family_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_web_billing_charge_claim"
  ON "web_billing_charge_attempts" ("status", "claim_expires_at");

CREATE INDEX IF NOT EXISTS "idx_web_billing_charge_refund_reconcile"
  ON "web_billing_charge_attempts" ("provider_checked_at","completed_at","order_id")
  WHERE "status"='done' AND "refund_status"<>'full';

-- 기존 활성 데이터가 함께 들어 있는 bootstrap 재실행에서도 성공한 현재 기간 주문만 정본으로 결합한다.
UPDATE "web_billing_customers"
   SET "last_paid_order_id"=(
     SELECT a."order_id" FROM "web_billing_charge_attempts" a
      WHERE a."family_id"="web_billing_customers"."family_id"
        AND a."status"='done'
        AND a."period_end"="web_billing_customers"."current_period_end"
      ORDER BY a."completed_at" DESC,a."created_at" DESC,a."order_id" DESC LIMIT 1
   )
 WHERE "last_paid_order_id" IS NULL
   AND "current_period_end" IS NOT NULL;

-- 결제 취소의 최소 금융 감사 정본. user/family/customerKey와 provider 원문 키는 저장하지 않는다.
-- 부분 취소가 여러 번 진행될 수 있으므로 검증된 provider 상태마다 불변 행을 하나 남긴다.
CREATE TABLE IF NOT EXISTS "web_billing_refund_records" (
  "record_id" TEXT NOT NULL CHECK (
    length("record_id")=71
    AND substr("record_id",1,7)='refund:'
    AND substr("record_id",8) NOT GLOB '*[^0-9a-f]*'
  ),
  "provider_reference" TEXT NOT NULL CHECK (length("provider_reference") BETWEEN 6 AND 64),
  "provider" TEXT DEFAULT 'toss_web' NOT NULL CHECK ("provider"='toss_web'),
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month','year')),
  "amount" INTEGER NOT NULL CHECK (
    ("plan"='month' AND "amount"=4900) OR ("plan"='year' AND "amount"=39000)
  ),
  "currency" TEXT DEFAULT 'KRW' NOT NULL CHECK ("currency"='KRW'),
  "charge_kind" TEXT NOT NULL CHECK ("charge_kind" IN ('initial','trial_conversion','renewal')),
  "refund_status" TEXT NOT NULL CHECK ("refund_status" IN ('partial','full')),
  "refunded_amount" INTEGER NOT NULL CHECK ("refunded_amount">0 AND "refunded_amount"<="amount"),
  "balance_amount" INTEGER NOT NULL CHECK ("balance_amount">=0 AND "balance_amount"<"amount"),
  "payment_key_hash" TEXT NOT NULL CHECK (
    length("payment_key_hash")=64 AND "payment_key_hash" NOT GLOB '*[^0-9a-f]*'
  ),
  "refund_state_hash" TEXT NOT NULL CHECK (
    length("refund_state_hash")=64 AND "refund_state_hash" NOT GLOB '*[^0-9a-f]*'
  ),
  "transaction_count" INTEGER NOT NULL CHECK ("transaction_count">0),
  "provider_checked_at" TEXT NOT NULL,
  "retention_until" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("record_id"),
  UNIQUE ("provider_reference","refund_state_hash"),
  CHECK ("refunded_amount"+"balance_amount"="amount"),
  CHECK (
    ("refund_status"='partial' AND "balance_amount">0 AND "refunded_amount"<"amount")
    OR ("refund_status"='full' AND "balance_amount"=0 AND "refunded_amount"="amount")
  )
);

CREATE INDEX IF NOT EXISTS "idx_web_billing_refund_provider_checked"
  ON "web_billing_refund_records" ("provider_reference","provider_checked_at");

CREATE INDEX IF NOT EXISTS "idx_web_billing_refund_retention"
  ON "web_billing_refund_records" ("retention_until","record_id");

-- family_id PK를 영구 보존해 재가입/카드 변경으로 체험을 반복할 수 없게 한다.
CREATE TABLE IF NOT EXISTS "web_billing_trial_claims" (
  "family_id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "checkout_session_id" TEXT NOT NULL,
  "provider" TEXT DEFAULT 'toss_web' NOT NULL CHECK ("provider" IN ('toss_web','google_play')),
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month', 'year')),
  "status" TEXT NOT NULL CHECK ("status" IN ('active', 'converted', 'cancelled', 'expired')),
  "claimed_at" TEXT NOT NULL,
  "trial_ends_at" TEXT NOT NULL,
  "converted_order_id" TEXT,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id"),
  UNIQUE ("checkout_session_id")
);

CREATE INDEX IF NOT EXISTS "idx_web_billing_trial_status_end"
  ON "web_billing_trial_claims" ("status", "trial_ends_at");

-- 가족 단위 결제 공급자 선점 정본. provider token·billing key 원문은 저장하지 않는다.
CREATE TABLE IF NOT EXISTS "billing_provider_reservations" (
  "family_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('google_play','toss_web')),
  "state" TEXT NOT NULL CHECK ("state" IN ('reserved','active','conflict','released')),
  "reservation_ref" TEXT NOT NULL CHECK (length("reservation_ref") BETWEEN 1 AND 200),
  "conflicting_provider" TEXT CHECK ("conflicting_provider" IN ('google_play','toss_web')),
  "conflict_ref" TEXT CHECK ("conflict_ref" IS NULL OR length("conflict_ref") BETWEEN 1 AND 200),
  "conflict_reason" TEXT CHECK ("conflict_reason" IN (
    'preexisting_toss_google_overlap',
    'google_purchase_after_toss_activation',
    'toss_charge_after_google_activation'
  )),
  "resolution_status" TEXT CHECK ("resolution_status" IN ('refund_required','manual_review')),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id"),
  CHECK (
    ("state"='conflict'
      AND "conflicting_provider" IS NOT NULL
      AND "conflicting_provider"<>"provider"
      AND "conflict_ref" IS NOT NULL
      AND "conflict_reason" IS NOT NULL
      AND "resolution_status" IS NOT NULL)
    OR
    ("state"<>'conflict'
      AND "conflicting_provider" IS NULL
      AND "conflict_ref" IS NULL
      AND "conflict_reason" IS NULL
      AND "resolution_status" IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS "idx_billing_provider_state_updated"
  ON "billing_provider_reservations" ("state", "updated_at");

-- 기존 정본 구독을 먼저 활성 공급자로 이관한다.
INSERT OR IGNORE INTO "billing_provider_reservations"
  ("family_id","provider","state","reservation_ref","created_at","updated_at")
SELECT "family_id","provider",'active',
       COALESCE(NULLIF("purchase_token_hash",''),NULLIF("latest_order_id",''),NULLIF("last_event_id",''),"family_id"),
       CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  FROM "family_subscription"
 WHERE "provider" IN ('google_play','toss_web')
   AND (
     (LOWER(TRIM(COALESCE("status",''))) IN ('active','grace','cancelled')
       AND "current_period_end" IS NOT NULL
       AND datetime(substr("current_period_end",1,19))>datetime('now'))
     OR
     (LOWER(TRIM(COALESCE("status",'')))='trial'
       AND "trial_ends_at" IS NOT NULL
       AND datetime(substr("trial_ends_at",1,19))>datetime('now'))
   );

-- 과거 갱신 실패가 last_order_id를 덮은 데이터도 실제 유료 주문을 provider 정본 참조로 복구한다.
UPDATE "billing_provider_reservations"
   SET "reservation_ref"=(
     SELECT c."last_paid_order_id" FROM "web_billing_customers" c
      WHERE c."family_id"="billing_provider_reservations"."family_id"
   ),
       "updated_at"=CURRENT_TIMESTAMP
 WHERE "provider"='toss_web' AND "state"='active'
   AND EXISTS(
     SELECT 1
       FROM "web_billing_customers" c
       JOIN "family_subscription" fs ON fs."family_id"=c."family_id"
      WHERE c."family_id"="billing_provider_reservations"."family_id"
        AND c."last_paid_order_id" IS NOT NULL
        AND fs."provider"='toss_web'
        AND fs."latest_order_id"=c."last_paid_order_id"
   );

-- 구독 정본이 없는 미확정 Toss 최초 결제는 외부 청구 가능성이 있으므로 선점을 유지한다.
INSERT OR IGNORE INTO "billing_provider_reservations"
  ("family_id","provider","state","reservation_ref","created_at","updated_at")
SELECT c."family_id",'toss_web','reserved',
       COALESCE(
         (SELECT NULLIF(a."checkout_session_id",'')
            FROM "web_billing_charge_attempts" a
           WHERE a."family_id"=c."family_id" AND a."kind"='initial'
           ORDER BY a."created_at" DESC LIMIT 1),
         NULLIF(c."last_order_id",''),
         (SELECT NULLIF(a."order_id",'')
            FROM "web_billing_charge_attempts" a
           WHERE a."family_id"=c."family_id" AND a."kind"='initial'
           ORDER BY a."created_at" DESC LIMIT 1),
         c."family_id"
       ),
       CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  FROM "web_billing_customers" c
 WHERE c."status"='pending_charge';

-- 이미 활성 Google과 미확정 Toss가 겹친 기존 행은 자동 덮어쓰기 대신 운영 환불 검토로 격리한다.
UPDATE "billing_provider_reservations"
   SET "state"='conflict',
       "conflicting_provider"='toss_web',
       "conflict_ref"=COALESCE(
         (SELECT a."order_id" FROM "web_billing_charge_attempts" a
           WHERE a."family_id"="billing_provider_reservations"."family_id"
             AND a."kind"='initial' ORDER BY a."created_at" DESC LIMIT 1),
         "billing_provider_reservations"."family_id"
       ),
       "conflict_reason"='preexisting_toss_google_overlap',
       "resolution_status"='manual_review',
       "updated_at"=CURRENT_TIMESTAMP
 WHERE "provider"='google_play' AND "state"='active'
   AND EXISTS(
      SELECT 1 FROM "web_billing_customers" c
       WHERE c."family_id"="billing_provider_reservations"."family_id"
         AND c."status"='pending_charge'
   );

-- 계정·가족 삭제 뒤에도 법정 대사에 필요한 최소 거래 증적만 5년 분리 보관한다.
-- 원시 user/family/customerKey/billingKey는 컬럼 자체를 두지 않는다.
CREATE TABLE IF NOT EXISTS "web_billing_financial_records" (
  "record_id" TEXT NOT NULL CHECK (length("record_id") BETWEEN 8 AND 200),
  "record_type" TEXT NOT NULL CHECK ("record_type" IN ('charge','trial')),
  "provider" TEXT DEFAULT 'toss_web' NOT NULL CHECK ("provider" IN ('toss_web','google_play')),
  "provider_reference" TEXT NOT NULL CHECK (length("provider_reference") BETWEEN 6 AND 128),
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month','year')),
  "amount" INTEGER NOT NULL CHECK ("amount">=0),
  "currency" TEXT DEFAULT 'KRW' NOT NULL CHECK ("currency"='KRW'),
  "charge_kind" TEXT CHECK ("charge_kind" IN ('initial','trial_conversion','renewal')),
  "record_status" TEXT NOT NULL CHECK ("record_status" IN (
    'paid','trial_active','trial_converted','trial_cancelled','trial_expired'
  )),
  "period_start" TEXT NOT NULL,
  "period_end" TEXT NOT NULL,
  "payment_key_hash" TEXT CHECK (
    "payment_key_hash" IS NULL OR (
      length("payment_key_hash")=64 AND "payment_key_hash" NOT GLOB '*[^0-9a-f]*'
    )
  ),
  "detached_at" TEXT NOT NULL,
  "retention_until" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("record_id"),
  UNIQUE ("record_type","provider_reference"),
  CHECK (datetime(substr("period_start",1,19))<datetime(substr("period_end",1,19))),
  CHECK (
    (
      "record_type"='charge'
      AND "record_status"='paid'
      AND "charge_kind" IS NOT NULL
      AND "payment_key_hash" IS NOT NULL
      AND (
        ("plan"='month' AND "amount"=4900)
        OR ("plan"='year' AND "amount"=39000)
      )
    )
    OR (
      "record_type"='trial'
      AND "record_status" IN ('trial_active','trial_converted','trial_cancelled','trial_expired')
      AND "charge_kind" IS NULL
      AND "payment_key_hash" IS NULL
      AND "amount"=0
    )
  )
);

CREATE INDEX IF NOT EXISTS "idx_web_billing_financial_retention"
  ON "web_billing_financial_records" ("retention_until","record_id");
