-- 가족 생애주기 퍼널. 원시 family/user/child 식별자와 위치·이름·토큰은 저장하지 않는다.
-- premium_funnel_events와 동일한 PREMIUM_FUNNEL_HASH_SECRET HMAC family_key를 사용한다.
-- 운영 적용은 Worker 배포 전에 1회 수행하고, 두 테이블·인덱스를 readback한다.
CREATE TABLE IF NOT EXISTS "family_lifecycle_events" (
  "event_id" TEXT NOT NULL
    CHECK (length("event_id") = 36),
  "family_key" TEXT NOT NULL
    CHECK (length("family_key") = 64 AND "family_key" NOT GLOB '*[^0-9a-f]*'),
  "event" TEXT NOT NULL
    CHECK ("event" IN ('family_created', 'child_paired', 'first_location', 'first_arrival')),
  "elapsed_ms" INTEGER CHECK ("elapsed_ms" IS NULL OR "elapsed_ms" >= 0),
  "child_count" INTEGER CHECK ("child_count" IS NULL OR "child_count" BETWEEN 1 AND 20),
  "child_platform" TEXT CHECK ("child_platform" IS NULL OR "child_platform" = 'android'),
  "occurred_at" TEXT NOT NULL,
  "received_at" TEXT NOT NULL,
  PRIMARY KEY ("event_id"),
  CHECK (
    ("event" = 'family_created'
      AND "elapsed_ms" = 0 AND "child_count" IS NULL AND "child_platform" IS NULL)
    OR
    ("event" = 'child_paired'
      AND "elapsed_ms" IS NOT NULL AND "child_count" IS NOT NULL AND "child_platform" = 'android')
    OR
    ("event" IN ('first_location', 'first_arrival')
      AND "elapsed_ms" IS NOT NULL AND "child_count" IS NULL AND "child_platform" IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_family_lifecycle_first_milestone"
  ON "family_lifecycle_events" ("family_key", "event")
  WHERE "event" IN ('family_created', 'first_location', 'first_arrival');

CREATE INDEX IF NOT EXISTS "idx_family_lifecycle_event_received"
  ON "family_lifecycle_events" ("event", "received_at");

CREATE INDEX IF NOT EXISTS "idx_family_lifecycle_received"
  ON "family_lifecycle_events" ("received_at", "event_id");

CREATE INDEX IF NOT EXISTS "idx_family_lifecycle_family_occurred"
  ON "family_lifecycle_events" ("family_key", "occurred_at");

CREATE TABLE IF NOT EXISTS "family_lifecycle_daily" (
  "family_key" TEXT NOT NULL
    CHECK (length("family_key") = 64 AND "family_key" NOT GLOB '*[^0-9a-f]*'),
  "activity_date" TEXT NOT NULL
    CHECK (length("activity_date") = 10 AND "activity_date" GLOB '????-??-??'),
  "parent_active" INTEGER DEFAULT 0 NOT NULL CHECK ("parent_active" IN (0, 1)),
  "child_signal" INTEGER DEFAULT 0 NOT NULL CHECK ("child_signal" IN (0, 1)),
  "first_recorded_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("family_key", "activity_date"),
  CHECK ("parent_active" = 1 OR "child_signal" = 1)
);

CREATE INDEX IF NOT EXISTS "idx_family_lifecycle_daily_date"
  ON "family_lifecycle_daily" ("activity_date", "parent_active", "child_signal");

CREATE INDEX IF NOT EXISTS "idx_family_lifecycle_daily_updated"
  ON "family_lifecycle_daily" ("updated_at", "family_key", "activity_date");
