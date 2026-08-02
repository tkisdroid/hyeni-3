-- 스토어 리뷰 보상 티어 — family_review_rewards.
-- 원본: supabase/migrations/20260524010000_review_tier_rewards.sql (PG, RLS parent-scoped).
-- D1 이관 스냅샷(cloudflare/schema_d1.sql)에 미포함된 테이블이라 별도 적재가 필요하다.
-- 타입 매핑: uuid→TEXT, timestamptz→TEXT(pg COPY 형식, lib/time.ts pgNow). RLS 는
--   Worker authz(routes/review-rewards.ts assertParentOfFamily)로 대체한다.
--
-- ⚠ 적재(로컬 .wrangler/state + 원격 D1 둘 다 필요):
--   wrangler d1 execute hyeni-calendar --local  --file=worker/db/review-rewards-schema.sql
--   wrangler d1 execute hyeni-calendar --remote --file=worker/db/review-rewards-schema.sql
-- 미적재(테이블 부재) 시에도 라우트는 500 대신 graceful(rewarded=false)로 동작한다.
CREATE TABLE IF NOT EXISTS family_review_rewards (
  family_id   TEXT PRIMARY KEY,                       -- families.id
  parent_id   TEXT NOT NULL,                          -- 부모 auth user id
  reward_type TEXT NOT NULL DEFAULT 'store_visit',
  granted_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_review_rewards_parent_id
  ON family_review_rewards(parent_id);
