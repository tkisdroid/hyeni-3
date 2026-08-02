-- MIGRATION FIRST: 기존 premium_funnel_events가 있으면서 source CHECK에
-- ai_friend_limit가 없을 때만 Worker 배포 전에 정확히 1회 적용한다.
-- SQLite는 CHECK 제약을 ALTER할 수 없으므로 정본 테이블로 복사한 뒤 교체한다.
-- 기존 행은 plain INSERT로 전부 복사하며 한 행이라도 새 정본 제약에 맞지 않으면
-- 원본 테이블을 건드리기 전에 실패한다.

CREATE TABLE "_premium_funnel_events_ai_friend_limit_20260802" (
  "event_id" TEXT NOT NULL,
  "family_key" TEXT NOT NULL
    CHECK (length("family_key") = 64 AND "family_key" NOT GLOB '*[^0-9a-f]*'),
  "event" TEXT NOT NULL CHECK ("event" IN (
    'paywall_impression', 'paywall_continue_free', 'paywall_cta',
    'subscription_view', 'product_query_result', 'checkout_start', 'checkout_result',
    'subscription_cancel_requested', 'entitlement_activated', 'trial_start', 'renewal', 'refund'
  )),
  "source" TEXT CHECK ("source" IN (
    'second_child', 'saved_place', 'danger_zone', 'location_request', 'location_history', 'location_live_interval',
    'remote_ring', 'remote_audio', 'ai_friend_limit', 'ai_daily_summary', 'weekly_report', 'academy_schedule',
    'first_location', 'first_arrival', 'direct'
  )),
  "tier" TEXT CHECK ("tier" IN ('free', 'premium', 'unknown')),
  "provider" TEXT CHECK ("provider" IN ('google_play', 'toss_payments')),
  "plan" TEXT CHECK ("plan" IN ('month', 'year')),
  "result" TEXT CHECK ("result" IN ('success', 'fail', 'cancel')),
  "error_code" TEXT CHECK ("error_code" IN (
    'purchase_canceled', 'purchase_pending', 'product_unavailable',
    'product_offer_unavailable', 'billing_unavailable', 'verification_failed',
    'network_error', 'unknown'
  )),
  "app_version" TEXT CHECK (length("app_version") BETWEEN 1 AND 32),
  "occurred_at" TEXT NOT NULL,
  "received_at" TEXT NOT NULL,
  PRIMARY KEY ("event_id"),
  CHECK (
    ("event" IN ('paywall_impression', 'paywall_continue_free', 'paywall_cta')
      AND "source" IS NOT NULL AND "source" <> 'direct' AND "tier" IS NOT NULL
      AND "provider" IS NULL AND "plan" IS NULL AND "result" IS NULL
      AND "error_code" IS NULL AND "app_version" IS NOT NULL)
    OR
    ("event" = 'subscription_view'
      AND "source" IS NOT NULL AND "tier" IS NULL AND "provider" IS NULL
      AND "plan" IS NULL AND "result" IS NULL AND "error_code" IS NULL
      AND "app_version" IS NOT NULL)
    OR
    ("event" = 'product_query_result'
      AND "source" IS NULL AND "tier" IS NULL AND "provider" IS NOT NULL
      AND "plan" IS NULL AND "result" IN ('success', 'fail')
      AND "error_code" IS NULL AND "app_version" IS NOT NULL)
    OR
    ("event" = 'checkout_start'
      AND "source" IS NULL AND "tier" IS NULL AND "provider" IS NOT NULL
      AND "plan" IS NOT NULL AND "result" IS NULL AND "error_code" IS NULL
      AND "app_version" IS NOT NULL)
    OR
    ("event" = 'checkout_result'
      AND "source" IS NULL AND "tier" IS NULL AND "provider" IS NOT NULL
      AND "plan" IS NULL AND "result" IS NOT NULL AND "app_version" IS NOT NULL
      AND (("result" = 'success' AND "error_code" IS NULL)
        OR ("result" = 'cancel' AND "error_code" = 'purchase_canceled')
        OR ("result" = 'fail' AND "error_code" IS NOT NULL AND "error_code" <> 'purchase_canceled')))
    OR
    ("event" = 'subscription_cancel_requested'
      AND "source" IS NULL AND "tier" IS NULL AND "provider" IS NOT NULL
      AND "plan" IS NULL AND "result" IS NULL AND "error_code" IS NULL
      AND "app_version" IS NOT NULL)
    OR
    ("event" IN ('entitlement_activated', 'trial_start', 'renewal', 'refund')
      AND "source" IS NULL AND "tier" IS NULL AND "provider" IS NOT NULL
      AND "plan" IS NOT NULL AND "result" IS NULL AND "error_code" IS NULL
      AND "app_version" IS NULL)
  )
);

INSERT INTO "_premium_funnel_events_ai_friend_limit_20260802" (
  "event_id", "family_key", "event", "source", "tier", "provider",
  "plan", "result", "error_code", "app_version", "occurred_at", "received_at"
)
SELECT
  "event_id", "family_key", "event", "source", "tier", "provider",
  "plan", "result", "error_code", "app_version", "occurred_at", "received_at"
FROM "premium_funnel_events";

DROP INDEX IF EXISTS "idx_premium_funnel_received";
DROP INDEX IF EXISTS "idx_premium_funnel_event_received";
DROP INDEX IF EXISTS "idx_premium_funnel_family_received";

ALTER TABLE "premium_funnel_events"
  RENAME TO "_premium_funnel_events_before_ai_friend_limit_20260802";
ALTER TABLE "_premium_funnel_events_ai_friend_limit_20260802"
  RENAME TO "premium_funnel_events";

CREATE INDEX "idx_premium_funnel_received"
  ON "premium_funnel_events" ("received_at");

CREATE INDEX "idx_premium_funnel_event_received"
  ON "premium_funnel_events" ("event", "received_at");

CREATE INDEX "idx_premium_funnel_family_received"
  ON "premium_funnel_events" ("family_key", "received_at");

DROP TABLE "_premium_funnel_events_before_ai_friend_limit_20260802";
