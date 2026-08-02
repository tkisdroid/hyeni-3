-- 기존 web-billing.sql을 이미 적용한 DB에 billingKey 원격 폐기 상태를 추가한다.
-- web_billing_customers가 존재하고 아래 컬럼이 아직 없을 때만 정확히 한 번 적용한다.
-- 신규 DB는 최신 web-billing.sql에 같은 컬럼이 포함되므로 이 파일을 실행하지 않는다.

ALTER TABLE "web_billing_customers"
  ADD COLUMN "billing_key_revocation_status" TEXT
    CHECK ("billing_key_revocation_status" IN ('pending','revoked'));

ALTER TABLE "web_billing_customers"
  ADD COLUMN "billing_key_revocation_attempts" INTEGER DEFAULT 0 NOT NULL
    CHECK ("billing_key_revocation_attempts" >= 0);

ALTER TABLE "web_billing_customers"
  ADD COLUMN "billing_key_revocation_retry_at" TEXT;

ALTER TABLE "web_billing_customers"
  ADD COLUMN "billing_key_revocation_error" TEXT;

ALTER TABLE "web_billing_customers"
  ADD COLUMN "billing_key_revoked_at" TEXT;

-- 이미 종료됐지만 암호화 billingKey가 남은 행은 Toss 원격 폐기를 재시도할 수 있게 한다.
UPDATE "web_billing_customers"
   SET "billing_key_revocation_status"='pending',
       "billing_key_revocation_retry_at"=COALESCE("updated_at", CURRENT_TIMESTAMP)
 WHERE "status" IN ('cancel_at_period_end','expired')
   AND "billing_key_ciphertext" IS NOT NULL
   AND "billing_key_iv" IS NOT NULL
   AND "billing_key_version"='v1'
   AND "billing_key_revocation_status" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_web_billing_customers_key_revocation"
  ON "web_billing_customers"
     ("billing_key_revocation_status", "billing_key_revocation_retry_at", "updated_at");
