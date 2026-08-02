-- 기존 web-billing.sql 적용 DB에 Toss 자동결제 환불 정본을 추가한다.
-- 신규 DB는 최신 web-billing.sql에 같은 컬럼·표가 있으므로 이 파일을 실행하지 않는다.
-- 운영에는 Worker 배포 전에 정확히 한 번 적용한다.

ALTER TABLE "web_billing_charge_attempts"
  ADD COLUMN "refund_status" TEXT DEFAULT 'none' NOT NULL
    CHECK ("refund_status" IN ('none','partial','full'));

ALTER TABLE "web_billing_charge_attempts"
  ADD COLUMN "refunded_amount" INTEGER DEFAULT 0 NOT NULL
    CHECK ("refunded_amount">=0 AND "refunded_amount"<="amount");

ALTER TABLE "web_billing_charge_attempts"
  ADD COLUMN "refund_state_hash" TEXT CHECK (
    "refund_state_hash" IS NULL OR (
      length("refund_state_hash")=64 AND "refund_state_hash" NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE "web_billing_charge_attempts"
  ADD COLUMN "provider_checked_at" TEXT;

ALTER TABLE "web_billing_charge_attempts"
  ADD COLUMN "refund_committed_at" TEXT;

ALTER TABLE "web_billing_charge_attempts"
  ADD COLUMN "refund_webhook_checked_at" TEXT;

ALTER TABLE "web_billing_charge_attempts"
  ADD COLUMN "refund_funnel_status" TEXT DEFAULT 'none' NOT NULL
    CHECK ("refund_funnel_status" IN ('none','pending','sent'));

ALTER TABLE "web_billing_charge_attempts"
  ADD COLUMN "customer_key" TEXT;

UPDATE "web_billing_charge_attempts"
   SET "customer_key"=COALESCE(
     (SELECT s."customer_key" FROM "web_billing_checkout_sessions" s
       WHERE s."id"="web_billing_charge_attempts"."checkout_session_id"
         AND s."family_id"="web_billing_charge_attempts"."family_id"),
     (SELECT c."customer_key" FROM "web_billing_customers" c
       WHERE c."family_id"="web_billing_charge_attempts"."family_id")
   )
 WHERE "customer_key" IS NULL;

ALTER TABLE "web_billing_customers"
  ADD COLUMN "last_paid_order_id" TEXT;

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

-- 기존 갱신 실패가 last_order_id를 덮었더라도 활성 provider는 실제 유료 주문을 가리켜야 한다.
UPDATE "billing_provider_reservations"
   SET "reservation_ref"=(
     SELECT c."last_paid_order_id" FROM "web_billing_customers" c
      WHERE c."family_id"="billing_provider_reservations"."family_id"
   )
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

CREATE INDEX IF NOT EXISTS "idx_web_billing_charge_refund_reconcile"
  ON "web_billing_charge_attempts" ("provider_checked_at","completed_at","order_id")
  WHERE "status"='done' AND "refund_status"<>'full';
