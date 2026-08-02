-- 채널별 순매출용 실제 비용 ledger.
-- 공급자 원문 식별자·주문/구매 token·가족/사용자 ID·자유 문구는 저장하지 않는다.
-- 금액은 확인된 KRW 양의 정수만 기록하며, 실제 0원은 coverage로만 증명한다.
CREATE TABLE IF NOT EXISTS "revenue_cost_ledger" (
  "entry_id" TEXT NOT NULL CHECK (length("entry_id") = 36),
  "provider" TEXT NOT NULL CHECK ("provider" IN ('google_play', 'toss_payments')),
  "category" TEXT NOT NULL CHECK ("category" IN (
    'provider_fee', 'confirmed_refund', 'ai_variable_cost', 'support_cost'
  )),
  "amount_krw" INTEGER NOT NULL
    CHECK (typeof("amount_krw") = 'integer' AND "amount_krw" > 0),
  "occurred_on" TEXT NOT NULL
    CHECK (length("occurred_on") = 10 AND "occurred_on" GLOB '????-??-??'),
  "source_ref_hash" TEXT NOT NULL
    CHECK (length("source_ref_hash") = 64 AND "source_ref_hash" NOT GLOB '*[^0-9a-f]*'),
  "recorded_at" TEXT NOT NULL,
  PRIMARY KEY ("entry_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_revenue_cost_ledger_source_unique"
  ON "revenue_cost_ledger" ("provider", "category", "source_ref_hash");

CREATE INDEX IF NOT EXISTS "idx_revenue_cost_ledger_provider_date"
  ON "revenue_cost_ledger" ("provider", "occurred_on", "category");

CREATE INDEX IF NOT EXISTS "idx_revenue_cost_ledger_category_date"
  ON "revenue_cost_ledger" ("category", "occurred_on", "provider");

-- coverage는 해당 [period_start, period_end) 전체를 실제 자료로 대사했다는 증빙이다.
-- 비용 행이 0건이어도 coverage가 있어야만 0원으로 계산하며, 빠진 범위는 계산 불가다.
CREATE TABLE IF NOT EXISTS "revenue_cost_coverage" (
  "coverage_id" TEXT NOT NULL CHECK (length("coverage_id") = 36),
  "provider" TEXT NOT NULL CHECK ("provider" IN ('google_play', 'toss_payments')),
  "category" TEXT NOT NULL CHECK ("category" IN (
    'provider_fee', 'confirmed_refund', 'ai_variable_cost', 'support_cost'
  )),
  "period_start" TEXT NOT NULL
    CHECK (length("period_start") = 10 AND "period_start" GLOB '????-??-??'),
  "period_end" TEXT NOT NULL
    CHECK (length("period_end") = 10 AND "period_end" GLOB '????-??-??'),
  "source_ref_hash" TEXT NOT NULL
    CHECK (length("source_ref_hash") = 64 AND "source_ref_hash" NOT GLOB '*[^0-9a-f]*'),
  "confirmed_at" TEXT NOT NULL,
  PRIMARY KEY ("coverage_id"),
  CHECK ("period_start" < "period_end")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_revenue_cost_coverage_source_unique"
  ON "revenue_cost_coverage" (
    "provider", "category", "period_start", "period_end", "source_ref_hash"
  );

CREATE INDEX IF NOT EXISTS "idx_revenue_cost_coverage_lookup"
  ON "revenue_cost_coverage" ("provider", "category", "period_start", "period_end");
