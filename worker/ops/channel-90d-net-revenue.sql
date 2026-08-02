-- 채널별 최근 90개 완료 KST 일자의 실제 순매출 / 최근 30개 완료 KST 일자의 MAF.
-- 매출은 서버가 검증한 구독 activation/renewal과 출시 확정가(월 4,900원·연 39,000원)만 센다.
-- 비용은 revenue_cost_ledger의 실제 금액만 차감한다. 비율이나 추정 원가는 사용하지 않는다.
-- provider×비용 4종의 90일 coverage가 빠지거나 MAF가 0이면 상태는 계산 불가다.
-- MAF는 획득 채널을 추정하지 않고 전체 가족 정본을 각 채널의 공통 분모로 사용한다.
WITH
params AS (
  SELECT date('now', '+9 hours', '-90 days') AS window_start,
         date('now', '+9 hours') AS window_end,
         date('now', '+9 hours', '-30 days') AS maf_start
),
channels(provider, sort_order) AS (
  VALUES ('google_play', 1), ('toss_payments', 2)
),
required_categories(category, sort_order) AS (
  VALUES
    ('provider_fee', 1),
    ('confirmed_refund', 2),
    ('ai_variable_cost', 3),
    ('support_cost', 4)
),
maf_families AS (
  SELECT d.family_key
    FROM family_lifecycle_daily d, params p
   WHERE d.activity_date >= p.maf_start
     AND d.activity_date < p.window_end
   GROUP BY d.family_key
  HAVING MAX(d.parent_active) = 1 AND MAX(d.child_signal) = 1
),
maf AS (
  SELECT COUNT(*) AS maf_30d FROM maf_families
),
gross AS (
  SELECT e.provider,
         SUM(CASE e.plan
           WHEN 'month' THEN 4900
           WHEN 'year' THEN 39000
           ELSE 0
         END) AS subscription_gross_90d_krw
    FROM premium_funnel_events e, params p
   WHERE e.event IN ('entitlement_activated', 'renewal')
     AND datetime(e.received_at) >= datetime(p.window_start, '-9 hours')
     AND datetime(e.received_at) < datetime(p.window_end, '-9 hours')
   GROUP BY e.provider
),
costs AS (
  SELECT l.provider,
         SUM(CASE WHEN l.category = 'provider_fee' THEN l.amount_krw ELSE 0 END)
           AS provider_fee_krw,
         SUM(CASE WHEN l.category = 'confirmed_refund' THEN l.amount_krw ELSE 0 END)
           AS confirmed_refund_krw,
         SUM(CASE WHEN l.category = 'ai_variable_cost' THEN l.amount_krw ELSE 0 END)
           AS ai_variable_cost_krw,
         SUM(CASE WHEN l.category = 'support_cost' THEN l.amount_krw ELSE 0 END)
           AS support_cost_krw
    FROM revenue_cost_ledger l, params p
   WHERE l.occurred_on >= p.window_start
     AND l.occurred_on < p.window_end
   GROUP BY l.provider
),
coverage AS (
  SELECT ch.provider,
         rc.category,
         rc.sort_order,
         CASE WHEN EXISTS (
           SELECT 1
             FROM revenue_cost_coverage c, params p
            WHERE c.provider = ch.provider
              AND c.category = rc.category
              AND c.period_start <= p.window_start
              AND c.period_end >= p.window_end
         ) THEN 1 ELSE 0 END AS covered
    FROM channels ch CROSS JOIN required_categories rc
),
coverage_summary AS (
  SELECT provider,
         SUM(covered) AS covered_categories,
         NULLIF(RTRIM(
           CASE WHEN MAX(CASE WHEN category = 'provider_fee' AND covered = 0 THEN 1 ELSE 0 END) = 1
             THEN 'provider_fee,' ELSE '' END
           || CASE WHEN MAX(CASE WHEN category = 'confirmed_refund' AND covered = 0 THEN 1 ELSE 0 END) = 1
             THEN 'confirmed_refund,' ELSE '' END
           || CASE WHEN MAX(CASE WHEN category = 'ai_variable_cost' AND covered = 0 THEN 1 ELSE 0 END) = 1
             THEN 'ai_variable_cost,' ELSE '' END
           || CASE WHEN MAX(CASE WHEN category = 'support_cost' AND covered = 0 THEN 1 ELSE 0 END) = 1
             THEN 'support_cost' ELSE '' END,
           ','),
           ''
         ) AS missing_cost_categories
    FROM coverage
   GROUP BY provider
),
channel_values AS (
  SELECT ch.provider,
         ch.sort_order,
         p.window_start,
         p.window_end,
         m.maf_30d,
         COALESCE(g.subscription_gross_90d_krw, 0) AS subscription_gross_90d_krw,
         COALESCE(c.provider_fee_krw, 0) AS provider_fee_krw,
         COALESCE(c.confirmed_refund_krw, 0) AS confirmed_refund_krw,
         COALESCE(c.ai_variable_cost_krw, 0) AS ai_variable_cost_krw,
         COALESCE(c.support_cost_krw, 0) AS support_cost_krw,
         cs.covered_categories,
         cs.missing_cost_categories
    FROM channels ch
    CROSS JOIN params p
    CROSS JOIN maf m
    LEFT JOIN gross g ON g.provider = ch.provider
    LEFT JOIN costs c ON c.provider = ch.provider
    JOIN coverage_summary cs ON cs.provider = ch.provider
)
SELECT provider,
       window_start,
       window_end AS window_end_exclusive,
       maf_30d,
       subscription_gross_90d_krw,
       provider_fee_krw,
       confirmed_refund_krw,
       ai_variable_cost_krw,
       support_cost_krw,
       CASE WHEN covered_categories = 4 THEN
         subscription_gross_90d_krw
           - provider_fee_krw
           - confirmed_refund_krw
           - ai_variable_cost_krw
           - support_cost_krw
         ELSE NULL END AS net_revenue_90d_krw,
       CASE WHEN covered_categories = 4 AND maf_30d > 0 THEN ROUND(
         1.0 * (
           subscription_gross_90d_krw
             - provider_fee_krw
             - confirmed_refund_krw
             - ai_variable_cost_krw
             - support_cost_krw
         ) / maf_30d,
         2
       ) ELSE NULL END AS net_revenue_per_maf_krw,
       CASE WHEN covered_categories = 4 AND maf_30d > 0
         THEN '계산 가능' ELSE '계산 불가' END
         AS calculation_status,
       missing_cost_categories
  FROM channel_values
 ORDER BY sort_order;
