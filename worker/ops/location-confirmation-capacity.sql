-- 위치 확인자료 용량 모니터(SQL read-only).
-- 결과는 집계값만 반환하며 family_id·subject_user_id를 출력하지 않는다.
-- 실제 Workers 플랜은 SQL로 판별할 수 없다. 아래 Free/Paid 두 행 중 운영 플랜 행을
-- Cloudflare Dashboard 구독·D1 Metrics 증거와 대조한다. 플랜 미확인은 출시 HOLD다.
-- 각 플랜 DB 사용률 50%부터 증설 설계, 70%부터 분리 DB 리허설,
-- 85%부터 신규 확대·출시를 보류하고 운영자가 용량 조치를 완료한다.

WITH database_size AS (
  SELECT CAST(page_count AS INTEGER) * CAST(page_size AS INTEGER) AS database_bytes
    FROM pragma_page_count(), pragma_page_size()
), plan_limits(plan_name, maximum_bytes) AS (
  VALUES ('workers_free', 500000000), ('workers_paid', 10000000000)
)
SELECT plan_name,
       database_bytes,
       maximum_bytes,
       ROUND(database_bytes * 100.0 / maximum_bytes, 2) AS d1_limit_percent,
       CASE
         WHEN database_bytes >= maximum_bytes * 0.85 THEN 'critical_85_hold'
         WHEN database_bytes >= maximum_bytes * 0.70 THEN 'action_70_shard_rehearsal'
         WHEN database_bytes >= maximum_bytes * 0.50 THEN 'warning_50_capacity_plan'
         ELSE 'normal_below_50'
       END AS capacity_state
  FROM database_size CROSS JOIN plan_limits
 ORDER BY maximum_bytes;

SELECT COUNT(*) AS total_rows,
       SUM(CASE WHEN action='collect' THEN 1 ELSE 0 END) AS collect_rows,
       SUM(CASE WHEN action='use' THEN 1 ELSE 0 END) AS use_rows,
       SUM(CASE WHEN action='provide' THEN 1 ELSE 0 END) AS provide_rows,
       SUM(CASE WHEN substr(recorded_at,1,19) >= datetime('now','-24 hours') THEN 1 ELSE 0 END)
         AS rows_last_24h,
       MIN(substr(recorded_at,1,19)) AS oldest_recorded_at,
       MAX(substr(recorded_at,1,19)) AS newest_recorded_at
  FROM location_confirmation_records;

-- confirmation 1행은 table + TEXT PK autoindex + 명시 index 2개를 갱신하므로 최소 4 rows_written이다.
-- 6개월 정상상태에서 같은 수의 오래된 행을 지우면 DELETE까지 최소 8배다. 실제 D1 전체 사용량은
-- 다른 테이블·DDL을 포함하므로 Dashboard/GraphQL의 계정 단위 rows_written 값을 반드시 사용한다.
WITH recent AS (
  SELECT COUNT(*) AS confirmation_records_last_24h
    FROM location_confirmation_records
   WHERE substr(recorded_at,1,19) >= datetime('now','-24 hours')
)
SELECT confirmation_records_last_24h,
       confirmation_records_last_24h * 4 AS minimum_insert_rows_written,
       confirmation_records_last_24h * 8 AS steady_state_insert_delete_lower_bound,
       ROUND(confirmation_records_last_24h * 400.0 / 100000.0, 2)
         AS workers_free_insert_budget_percent,
       CASE
         WHEN confirmation_records_last_24h * 4 >= 85000 THEN 'critical_85_hold'
         WHEN confirmation_records_last_24h * 4 >= 70000 THEN 'action_70_paid_required'
         WHEN confirmation_records_last_24h * 4 >= 50000 THEN 'warning_50_paid_plan'
         ELSE 'confirmation_insert_below_50'
       END AS workers_free_write_state
  FROM recent;

WITH subject_days AS (
  SELECT COUNT(*) AS row_count
    FROM location_confirmation_records
   GROUP BY family_id, subject_user_id, substr(occurred_at,1,10)
)
SELECT COUNT(*) AS subject_day_count,
       ROUND(AVG(row_count), 2) AS average_rows_per_subject_day,
       MAX(row_count) AS maximum_rows_per_subject_day
  FROM subject_days;

WITH duplicate_events AS (
  SELECT COUNT(*) AS row_count
    FROM location_confirmation_records
   WHERE action='collect' AND acquisition_path='android_native_app'
   GROUP BY family_id, subject_user_id, occurred_at
  HAVING COUNT(*) > 1
)
SELECT COUNT(*) AS duplicate_event_count,
       COALESCE(SUM(row_count - 1), 0) AS duplicate_excess_rows
  FROM duplicate_events;

-- 이 쿼리는 운영 추세 확인용 근사치다. 실제 삭제 경계는 Worker의 달력 기준 6개월 계산을 따른다.
WITH retention_backlog AS (
  SELECT COUNT(*) AS expired_rows,
         MIN(substr(recorded_at,1,19)) AS oldest_expired_at
    FROM location_confirmation_records
   WHERE substr(recorded_at,1,19) < datetime('now','-6 months')
)
SELECT expired_rows,
       oldest_expired_at,
       15000 AS hourly_delete_capacity,
       CASE
         WHEN expired_rows > 15000 THEN 'backlog_exceeds_hourly_capacity'
         WHEN expired_rows > 0 THEN 'backlog_within_hourly_capacity'
         ELSE 'no_expired_backlog'
       END AS retention_state
  FROM retention_backlog;
