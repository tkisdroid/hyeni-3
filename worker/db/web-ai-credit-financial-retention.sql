-- 기존 web-ai-credit-billing.sql을 이미 적용한 DB에 삭제 후 금융 정본을 추가한다.
-- web_ai_credit_orders가 존재하고 아래 컬럼이 아직 없을 때만 정확히 한 번 적용한다.
-- 신규 DB는 최신 web-ai-credit-billing.sql에 같은 컬럼이 포함되므로 이 파일을 실행하지 않는다.

ALTER TABLE "web_ai_credit_orders"
  ADD COLUMN "record_scope" TEXT DEFAULT 'active' NOT NULL
    CHECK ("record_scope" IN ('active','detached'));

ALTER TABLE "web_ai_credit_orders"
  ADD COLUMN "balance_scope" TEXT DEFAULT 'active' NOT NULL
    CHECK ("balance_scope" IN ('active','detached'));

ALTER TABLE "web_ai_credit_orders"
  ADD COLUMN "detach_reason" TEXT CHECK (
    "detach_reason" IS NULL OR "detach_reason" IN (
      'account_deleted','family_deleted','child_unpaired'
    )
  );

ALTER TABLE "web_ai_credit_orders"
  ADD COLUMN "detached_at" TEXT;

ALTER TABLE "web_ai_credit_orders"
  ADD COLUMN "granted_credits" INTEGER DEFAULT 0 NOT NULL
    CHECK ("granted_credits">=0 AND "granted_credits"<="credits");

ALTER TABLE "web_ai_credit_orders"
  ADD COLUMN "grant_committed_at" TEXT;

ALTER TABLE "web_ai_credit_orders"
  ADD COLUMN "refunded_credits" INTEGER DEFAULT 0 NOT NULL
    CHECK ("refunded_credits">=0 AND "refunded_credits"<="credits");

ALTER TABLE "web_ai_credit_orders"
  ADD COLUMN "refund_committed_at" TEXT;

ALTER TABLE "web_ai_credit_orders"
  ADD COLUMN "retention_until" TEXT;

-- 기존 주문은 상태명이 아니라 원장 delta를 근거로 지급·회수 스냅샷을 복원한다.
UPDATE "web_ai_credit_orders"
   SET "granted_credits"=CASE WHEN EXISTS(
         SELECT 1 FROM "ai_credit_ledger" granted
          WHERE granted."transaction_id"="web_ai_credit_orders"."order_id"
            AND granted."delta"="web_ai_credit_orders"."credits"
       ) THEN "credits" ELSE 0 END,
       "grant_committed_at"=COALESCE("grant_committed_at",(
         SELECT MIN(granted."created_at") FROM "ai_credit_ledger" granted
          WHERE granted."transaction_id"="web_ai_credit_orders"."order_id"
            AND granted."delta"="web_ai_credit_orders"."credits"
       )),
       "refunded_credits"=CASE WHEN EXISTS(
         SELECT 1 FROM "ai_credit_ledger" refunded
          WHERE refunded."transaction_id"="web_ai_credit_orders"."order_id"
            AND refunded."delta"=-"web_ai_credit_orders"."credits"
       ) THEN "credits" ELSE 0 END,
       "refund_committed_at"=COALESCE("refund_committed_at",(
         SELECT MIN(refunded."created_at") FROM "ai_credit_ledger" refunded
          WHERE refunded."transaction_id"="web_ai_credit_orders"."order_id"
            AND refunded."delta"=-"web_ai_credit_orders"."credits"
       ),CASE WHEN "status"='refunded' THEN "provider_checked_at" END),
       "retention_until"=CASE
         WHEN "status"='refunded' THEN datetime(substr(COALESCE((
           SELECT MIN(refunded."created_at") FROM "ai_credit_ledger" refunded
            WHERE refunded."transaction_id"="web_ai_credit_orders"."order_id"
              AND refunded."delta"=-"web_ai_credit_orders"."credits"
         ),"provider_checked_at","completed_at","created_at"),1,19),'+5 years')
         WHEN "status"='done' THEN
           datetime(substr(COALESCE("completed_at","created_at"),1,19),'+5 years')
         ELSE NULL END;

CREATE INDEX IF NOT EXISTS "idx_web_ai_credit_detached_reconcile"
  ON "web_ai_credit_orders" ("record_scope","status","retry_after","claim_expires_at");

CREATE TABLE IF NOT EXISTS "web_ai_credit_detached_balances" (
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "purchased_credits" INTEGER DEFAULT 0 NOT NULL,
  "restoration_state" TEXT NOT NULL CHECK (
    "restoration_state" IN ('blocked','closed')
  ),
  "detached_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "retention_until" TEXT NOT NULL,
  PRIMARY KEY ("family_id","child_user_id")
);

CREATE INDEX IF NOT EXISTS "idx_web_ai_credit_detached_balance_retention"
  ON "web_ai_credit_detached_balances" ("retention_until");
