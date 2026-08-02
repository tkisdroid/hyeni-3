-- 가족 생애주기·결제 퍼널 운영 집계(SQL read-only).
-- family_key는 family_lifecycle_*와 premium_funnel_events가 공유하는 HMAC 가명키다.
-- 기준일을 바꾸려면 params.as_of_date의 date('now')만 YYYY-MM-DD 문자열로 교체한다.

-- 1) 활성화 퍼널과 첫 가치 도달 시간. child_paired는 가족별 첫 연결만 센다.
WITH first_milestones AS (
  SELECT family_key, event, MIN(occurred_at) AS first_at, MIN(elapsed_ms) AS elapsed_ms
    FROM family_lifecycle_events
   GROUP BY family_key, event
)
SELECT event,
       COUNT(*) AS families,
       ROUND(AVG(elapsed_ms) / 1000.0, 1) AS avg_seconds_from_family_created
  FROM first_milestones
 GROUP BY event
 ORDER BY CASE event
   WHEN 'family_created' THEN 1 WHEN 'child_paired' THEN 2
   WHEN 'first_location' THEN 3 WHEN 'first_arrival' THEN 4 ELSE 9 END;

-- 2) D7·D30 유지: 아직 7/30일이 지나지 않은 cohort는 각 분모에서 제외한다.
WITH params AS (SELECT date('now') AS as_of_date), created AS (
  SELECT family_key, date(MIN(occurred_at), '+9 hours') AS cohort_date
    FROM family_lifecycle_events
   WHERE event = 'family_created'
   GROUP BY family_key
), retention AS (
  SELECT c.family_key, c.cohort_date,
         MAX(CASE WHEN d.activity_date = date(c.cohort_date, '+7 days')
                   AND d.parent_active = 1 AND d.child_signal = 1 THEN 1 ELSE 0 END) AS d7_retained,
         MAX(CASE WHEN d.activity_date = date(c.cohort_date, '+30 days')
                   AND d.parent_active = 1 AND d.child_signal = 1 THEN 1 ELSE 0 END) AS d30_retained
    FROM created c
    LEFT JOIN family_lifecycle_daily d ON d.family_key = c.family_key
   GROUP BY c.family_key, c.cohort_date
)
SELECT cohort_date,
       COUNT(*) AS created_families,
       SUM(CASE WHEN cohort_date <= date(as_of_date, '-7 days') THEN 1 ELSE 0 END) AS d7_eligible_families,
       SUM(CASE WHEN cohort_date <= date(as_of_date, '-7 days') THEN d7_retained ELSE 0 END) AS d7_families,
       ROUND(100.0
         * SUM(CASE WHEN cohort_date <= date(as_of_date, '-7 days') THEN d7_retained ELSE 0 END)
         / NULLIF(SUM(CASE WHEN cohort_date <= date(as_of_date, '-7 days') THEN 1 ELSE 0 END), 0), 2) AS d7_rate_pct,
       SUM(CASE WHEN cohort_date <= date(as_of_date, '-30 days') THEN 1 ELSE 0 END) AS d30_eligible_families,
       SUM(CASE WHEN cohort_date <= date(as_of_date, '-30 days') THEN d30_retained ELSE 0 END) AS d30_families,
       ROUND(100.0
         * SUM(CASE WHEN cohort_date <= date(as_of_date, '-30 days') THEN d30_retained ELSE 0 END)
         / NULLIF(SUM(CASE WHEN cohort_date <= date(as_of_date, '-30 days') THEN 1 ELSE 0 END), 0), 2) AS d30_rate_pct
  FROM retention, params
 GROUP BY cohort_date
 ORDER BY cohort_date DESC;

-- 3) 기준일 MAF: 최근 30일에 부모 활동과 페어링된 자녀 기기 신호가 각각 한 번 이상인 distinct family.
WITH params AS (SELECT date('now') AS as_of_date), maf_families AS (
  SELECT d.family_key
    FROM family_lifecycle_daily d, params p
   WHERE d.activity_date BETWEEN date(p.as_of_date, '-29 days') AND p.as_of_date
   GROUP BY d.family_key
  HAVING MAX(d.parent_active) = 1 AND MAX(d.child_signal) = 1
)
SELECT COUNT(*) AS maf_30d FROM maf_families;

-- 4) 같은 HMAC 가족키로 첫 가치→paywall→checkout→검증 결제를 연결한다.
WITH lifecycle AS (
  SELECT family_key,
         MIN(CASE WHEN event = 'first_location' THEN occurred_at END) AS first_location_at,
         MIN(CASE WHEN event = 'first_arrival' THEN occurred_at END) AS first_arrival_at
    FROM family_lifecycle_events
   GROUP BY family_key
), paid AS (
  SELECT family_key,
         MIN(CASE WHEN event = 'paywall_impression' THEN occurred_at END) AS first_paywall_at,
         MIN(CASE WHEN event = 'checkout_start' THEN occurred_at END) AS first_checkout_at,
         MIN(CASE WHEN event = 'trial_start' THEN occurred_at END) AS first_trial_at,
         MIN(CASE WHEN event = 'entitlement_activated' THEN occurred_at END) AS first_paid_at,
         SUM(CASE WHEN event = 'renewal' THEN 1 ELSE 0 END) AS renewal_count,
         SUM(CASE WHEN event = 'refund' THEN 1 ELSE 0 END) AS refund_count
    FROM premium_funnel_events
   GROUP BY family_key
)
SELECT COUNT(*) AS lifecycle_families,
       SUM(CASE WHEN first_location_at IS NOT NULL THEN 1 ELSE 0 END) AS first_location_families,
       SUM(CASE WHEN first_arrival_at IS NOT NULL THEN 1 ELSE 0 END) AS first_arrival_families,
       SUM(CASE WHEN first_paywall_at IS NOT NULL THEN 1 ELSE 0 END) AS paywall_families,
       SUM(CASE WHEN first_checkout_at IS NOT NULL THEN 1 ELSE 0 END) AS checkout_families,
       SUM(CASE WHEN first_trial_at IS NOT NULL THEN 1 ELSE 0 END) AS trial_families,
       SUM(CASE WHEN first_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS paid_families,
       SUM(renewal_count) AS renewals,
       SUM(refund_count) AS refunds
  FROM lifecycle LEFT JOIN paid USING (family_key);

-- 5) 채널별 최근 90일 실제 순매출 / MAF 정본은 별도 단일 결과 쿼리다.
-- ops/channel-90d-net-revenue.sql을 실행한다. 실제 비용 4종의 전체 기간 coverage가
-- 하나라도 빠지면 검증 구독 gross를 보유해도 해당 채널 순매출은 계산 불가다.
