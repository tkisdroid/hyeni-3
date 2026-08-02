-- 기존 웹 구독 DB에 계정·가족 삭제 뒤 5년 보관할 최소 금융 정본을 추가한다.
-- 원시 user/family/customerKey/billingKey는 컬럼 자체를 두지 않는다.
-- 운영에는 Worker 배포 전에 정확히 한 번 적용한다.

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
