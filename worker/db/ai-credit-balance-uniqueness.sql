-- MIGRATION FIRST: 이 파일을 Worker 배포 전에 운영 D1에 정확히 1회 적용한다.
-- 기존 select-then-insert 레이스가 만든 (family_id, child_user_id) 중복을 먼저 병합한 뒤
-- UNIQUE index를 만든다. 운영 적용 전 아래 진단 쿼리 결과를 별도로 보관한다.
--
-- SELECT COUNT(*) AS duplicate_groups,
--        COALESCE(SUM(group_rows),0) AS duplicate_rows,
--        COALESCE(SUM(group_rows-1),0) AS rows_to_merge
--   FROM (
--     SELECT COUNT(*) AS group_rows
--       FROM ai_credit_balances
--      GROUP BY family_id, child_user_id
--     HAVING COUNT(*) > 1
--   );
--
-- 병합 규칙:
--   * 정본 id = julianday(updated_at) 실제 시각, 원문 updated_at, id 순으로 가장 최신인 행
--   * 일일 사용량 = 가장 최신 reset 날짜 행들 중 최댓값(한도 우회 방지)
--   * 구매 잔액 = signed 최댓값(복제 잔액을 합산하지 않고, 환불 부채 음수와 이후 정상 구매를 모두 보존)
--   * 프리미엄/한도 = 최댓값(다음 요청에서 정본 entitlement가 다시 동기화)
--   * parent_id = 가장 최근의 null이 아닌 값

DROP TABLE IF EXISTS _ai_credit_balance_merge_20260801;

CREATE TABLE _ai_credit_balance_merge_20260801 (
  winner_id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  child_user_id TEXT NOT NULL,
  parent_id TEXT,
  is_premium INTEGER NOT NULL,
  daily_included_limit INTEGER NOT NULL,
  daily_included_used INTEGER NOT NULL,
  daily_reset_date TEXT NOT NULL,
  purchased_credits INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

WITH source AS (
  SELECT
    ai_credit_balances.*,
    julianday(
      CASE
        WHEN length(updated_at) > 10 AND substr(updated_at, -3, 1) IN ('+', '-')
          THEN updated_at || ':00'
        WHEN length(updated_at) > 10
          AND substr(updated_at, -5, 1) IN ('+', '-')
          AND substr(updated_at, -3, 1) <> ':'
          THEN substr(updated_at, 1, length(updated_at) - 2) || ':' || substr(updated_at, -2)
        ELSE updated_at
      END
    ) AS updated_at_julian
  FROM ai_credit_balances
), normalized AS (
  SELECT
    id,
    family_id,
    child_user_id,
    parent_id,
    CASE WHEN COALESCE(is_premium, 0) <> 0 THEN 1 ELSE 0 END AS is_premium,
    MAX(0, COALESCE(daily_included_limit, 0)) AS daily_included_limit,
    MAX(0, COALESCE(daily_included_used, 0)) AS daily_included_used,
    substr(daily_reset_date, 1, 10) AS reset_date,
    COALESCE(purchased_credits, 0) AS purchased_credits,
    updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY family_id, child_user_id
      ORDER BY updated_at_julian DESC, updated_at DESC, id DESC
    ) AS winner_rank,
    ROW_NUMBER() OVER (
      PARTITION BY family_id, child_user_id
      ORDER BY CASE WHEN parent_id IS NULL OR parent_id = '' THEN 1 ELSE 0 END,
               updated_at_julian DESC,
               updated_at DESC,
               id DESC
    ) AS parent_rank
  FROM source
), grouped AS (
  SELECT
    family_id,
    child_user_id,
    MAX(CASE WHEN winner_rank = 1 THEN id END) AS winner_id,
    MAX(CASE WHEN parent_rank = 1 THEN NULLIF(parent_id, '') END) AS parent_id,
    MAX(is_premium) AS is_premium,
    MAX(daily_included_limit) AS daily_included_limit,
    MAX(reset_date) AS daily_reset_date,
    MAX(purchased_credits) AS purchased_credits,
    MAX(CASE WHEN winner_rank = 1 THEN updated_at END) AS updated_at
  FROM normalized
  GROUP BY family_id, child_user_id
), merged AS (
  SELECT
    grouped.*,
    MAX(normalized.daily_included_used) AS daily_included_used
  FROM grouped
  JOIN normalized
    ON normalized.family_id = grouped.family_id
   AND normalized.child_user_id = grouped.child_user_id
   AND normalized.reset_date = grouped.daily_reset_date
  GROUP BY grouped.family_id, grouped.child_user_id
)
INSERT INTO _ai_credit_balance_merge_20260801 (
  winner_id,
  family_id,
  child_user_id,
  parent_id,
  is_premium,
  daily_included_limit,
  daily_included_used,
  daily_reset_date,
  purchased_credits,
  updated_at
)
SELECT
  winner_id,
  family_id,
  child_user_id,
  parent_id,
  is_premium,
  daily_included_limit,
  daily_included_used,
  daily_reset_date,
  purchased_credits,
  updated_at
FROM merged;

UPDATE ai_credit_balances
   SET parent_id = (
         SELECT parent_id FROM _ai_credit_balance_merge_20260801 merged
          WHERE merged.winner_id = ai_credit_balances.id
       ),
       is_premium = (
         SELECT is_premium FROM _ai_credit_balance_merge_20260801 merged
          WHERE merged.winner_id = ai_credit_balances.id
       ),
       daily_included_limit = (
         SELECT daily_included_limit FROM _ai_credit_balance_merge_20260801 merged
          WHERE merged.winner_id = ai_credit_balances.id
       ),
       daily_included_used = (
         SELECT daily_included_used FROM _ai_credit_balance_merge_20260801 merged
          WHERE merged.winner_id = ai_credit_balances.id
       ),
       daily_reset_date = (
         SELECT daily_reset_date FROM _ai_credit_balance_merge_20260801 merged
          WHERE merged.winner_id = ai_credit_balances.id
       ),
       purchased_credits = (
         SELECT purchased_credits FROM _ai_credit_balance_merge_20260801 merged
          WHERE merged.winner_id = ai_credit_balances.id
       ),
       updated_at = (
         SELECT updated_at FROM _ai_credit_balance_merge_20260801 merged
          WHERE merged.winner_id = ai_credit_balances.id
       )
 WHERE id IN (SELECT winner_id FROM _ai_credit_balance_merge_20260801);

DELETE FROM ai_credit_balances
 WHERE EXISTS (
   SELECT 1
     FROM _ai_credit_balance_merge_20260801 merged
    WHERE merged.family_id = ai_credit_balances.family_id
      AND merged.child_user_id = ai_credit_balances.child_user_id
      AND merged.winner_id <> ai_credit_balances.id
 );

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_credit_balances_family_child_unique
  ON ai_credit_balances(family_id, child_user_id);

DROP TABLE _ai_credit_balance_merge_20260801;
