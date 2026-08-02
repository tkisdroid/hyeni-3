-- iPhone 홈 화면 PWA Toss 일회성 AI 크레딧 결제 정본.
-- 보고서에 가격이 없으므로 가격은 환경 설정으로만 결정하고 주문 행에 스냅샷한다.
-- paymentKey 원문은 어떤 컬럼에도 저장하지 않는다.

CREATE TABLE IF NOT EXISTS "web_ai_credit_orders" (
  "order_id" TEXT NOT NULL CHECK (length("order_id") BETWEEN 6 AND 64),
  "family_id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "customer_key" TEXT NOT NULL CHECK (length("customer_key") BETWEEN 2 AND 50),
  "product_code" TEXT NOT NULL CHECK ("product_code" IN (
    'ai-credit-30','ai-credit-80','ai-credit-200'
  )),
  "credits" INTEGER NOT NULL CHECK (
    ("product_code"='ai-credit-30' AND "credits"=30)
    OR ("product_code"='ai-credit-80' AND "credits"=80)
    OR ("product_code"='ai-credit-200' AND "credits"=200)
  ),
  "amount" INTEGER NOT NULL CHECK ("amount">0 AND "amount"<=10000000),
  "currency" TEXT DEFAULT 'KRW' NOT NULL CHECK ("currency"='KRW'),
  "status" TEXT DEFAULT 'pending' NOT NULL CHECK ("status" IN (
    'pending','processing','unknown','done','refund_processing','refund_unknown',
    'refunded','failed','expired'
  )),
  "expires_at" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "claim_token" TEXT,
  "claim_expires_at" TEXT,
  "payment_key_hash" TEXT,
  "debt_applied" INTEGER DEFAULT 0 NOT NULL CHECK (
    "debt_applied">=0 AND "debt_applied"<="credits"
  ),
  -- 계정/가족 삭제 뒤에도 결제사 대사에 필요한 최소 금융 정본만 분리 보존한다.
  "record_scope" TEXT DEFAULT 'active' NOT NULL CHECK (
    "record_scope" IN ('active','detached')
  ),
  -- 공동부모만 탈퇴한 주문은 가족의 운영 잔액을 유지하고, 가족/자녀 삭제는 분리 잔액을 쓴다.
  "balance_scope" TEXT DEFAULT 'active' NOT NULL CHECK (
    "balance_scope" IN ('active','detached')
  ),
  "detach_reason" TEXT CHECK (
    "detach_reason" IS NULL OR "detach_reason" IN (
      'account_deleted','family_deleted','child_unpaired'
    )
  ),
  "detached_at" TEXT,
  "granted_credits" INTEGER DEFAULT 0 NOT NULL CHECK (
    "granted_credits">=0 AND "granted_credits"<="credits"
  ),
  "grant_committed_at" TEXT,
  "refunded_credits" INTEGER DEFAULT 0 NOT NULL CHECK (
    "refunded_credits">=0 AND "refunded_credits"<="credits"
  ),
  "refund_committed_at" TEXT,
  "retention_until" TEXT,
  "refunded_amount" INTEGER DEFAULT 0 NOT NULL CHECK (
    "refunded_amount">=0 AND "refunded_amount"<="amount"
  ),
  "provider_checked_at" TEXT,
  "client_checked_at" TEXT,
  "webhook_checked_at" TEXT,
  "error_code" TEXT,
  "retry_after" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "completed_at" TEXT,
  PRIMARY KEY ("order_id"),
  UNIQUE ("customer_key"),
  UNIQUE ("idempotency_key"),
  CHECK (
    ("claim_token" IS NULL AND "claim_expires_at" IS NULL)
    OR ("claim_token" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_web_ai_credit_payment_hash"
  ON "web_ai_credit_orders" ("payment_key_hash")
  WHERE "payment_key_hash" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_web_ai_credit_family_parent"
  ON "web_ai_credit_orders" ("family_id","parent_id","child_user_id","status","created_at");

CREATE INDEX IF NOT EXISTS "idx_web_ai_credit_reconcile"
  ON "web_ai_credit_orders" ("status","retry_after","claim_expires_at","provider_checked_at");

CREATE INDEX IF NOT EXISTS "idx_web_ai_credit_detached_reconcile"
  ON "web_ai_credit_orders" ("record_scope","status","retry_after","claim_expires_at");

-- 운영 가족 데이터와 분리된 signed 구매 잔액이다. 자동 재연결 계약이 없으므로
-- blocked 행은 신규 결제 승인 전에 fail-closed하며 별도 복원 절차 없이는 합치지 않는다.
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

-- 인증 endpoint와 무서명 일반결제 webhook이 결제사 조회 API를 비용 증폭기로
-- 악용하지 못하게 실제 외부 조회 시도만 가족별 UTC 시간창에서 원자 claim한다.
CREATE TABLE IF NOT EXISTS "web_ai_credit_lookup_windows" (
  "family_id" TEXT NOT NULL,
  "window_started_at" TEXT NOT NULL,
  "attempts" INTEGER DEFAULT 0 NOT NULL CHECK ("attempts" BETWEEN 0 AND 30),
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id","window_started_at")
);

CREATE INDEX IF NOT EXISTS "idx_web_ai_credit_lookup_windows_updated"
  ON "web_ai_credit_lookup_windows" ("updated_at");
