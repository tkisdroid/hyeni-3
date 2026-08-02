-- Toss 웹 구독 환불 운영 모니터(SQL read-only).
-- 결과는 집계값과 시각만 반환하며 주문·가족·사용자·결제 키 원문을 반환하지 않는다.

-- 1) 환불 대사 후보. 24시간 이상 미확인 후보가 누적되면 cron·결제사 조회 오류를 확인한다.
WITH candidates AS (
  SELECT provider_checked_at, completed_at, created_at
    FROM web_billing_charge_attempts
   WHERE status='done' AND refund_status<>'full'
)
SELECT 'refund_reconciliation_due' AS metric,
       COUNT(*) AS candidate_count,
       COALESCE(SUM(CASE WHEN provider_checked_at IS NULL THEN 1 ELSE 0 END), 0)
         AS never_checked_count,
       COALESCE(SUM(CASE
         WHEN provider_checked_at IS NULL
           OR datetime(substr(provider_checked_at,1,19))<=datetime('now','-24 hours')
         THEN 1 ELSE 0 END), 0) AS due_24h_count,
       MIN(COALESCE(provider_checked_at,completed_at,created_at)) AS oldest_candidate_at
  FROM candidates;

-- 2) 결제 정본과 분리된 funnel 재시도 대기열. 결제 환불 자체는 이 수치와 무관하게 완료되어야 한다.
SELECT 'refund_funnel_pending' AS metric,
       COUNT(*) AS pending_count,
       COALESCE(SUM(CASE
         WHEN datetime(substr(refund_committed_at,1,19))<=datetime('now','-1 hour')
         THEN 1 ELSE 0 END), 0) AS older_than_1h_count,
       MIN(refund_committed_at) AS oldest_pending_at
  FROM web_billing_charge_attempts
 WHERE status='done' AND refund_status='full' AND refund_funnel_status='pending';

-- 3) 최근 24시간 검증 환불 집계. 원금·환불액은 출시 확정 KRW 금액만 합산한다.
SELECT 'refund_committed_24h' AS metric,
       refund_status AS refund_state,
       COUNT(*) AS refund_count,
       COALESCE(SUM(amount), 0) AS charged_krw,
       COALESCE(SUM(refunded_amount), 0) AS refunded_krw
  FROM web_billing_charge_attempts
 WHERE refund_status IN ('partial','full')
   AND datetime(substr(refund_committed_at,1,19))>=datetime('now','-24 hours')
 GROUP BY refund_status
 ORDER BY refund_status;

-- 4) 공급자 충돌 대기열. refund_required는 결제사 콘솔 환불 뒤 서버 재조회로만 해소한다.
SELECT 'provider_conflicts' AS metric,
       provider,
       conflicting_provider,
       resolution_status,
       COUNT(*) AS conflict_count,
       MIN(updated_at) AS oldest_conflict_at
  FROM billing_provider_reservations
 WHERE state='conflict'
 GROUP BY provider,conflicting_provider,resolution_status
 ORDER BY provider,conflicting_provider,resolution_status;

-- 5) 전액 환불 주문이 현재 Toss 권리를 다시 열고 있으면 출시 차단이다. 정상값은 0이다.
SELECT 'active_toss_entitlement_from_full_refund' AS metric,
       COUNT(*) AS violation_count
  FROM family_subscription fs
  JOIN web_billing_charge_attempts a
    ON a.family_id=fs.family_id AND a.order_id=fs.latest_order_id
 WHERE fs.provider='toss_web' AND a.refund_status='full'
   AND (
     (LOWER(TRIM(COALESCE(fs.status,''))) IN ('active','grace','cancelled')
       AND fs.current_period_end IS NOT NULL
       AND datetime(substr(fs.current_period_end,1,19))>datetime('now'))
     OR
     (LOWER(TRIM(COALESCE(fs.status,'')))='trial'
       AND fs.trial_ends_at IS NOT NULL
       AND datetime(substr(fs.trial_ends_at,1,19))>datetime('now'))
   );

-- 6) 전액 환불된 주문을 Toss 활성 공급자 참조가 가리키면 출시 차단이다. 정상값은 0이다.
SELECT 'active_toss_provider_from_full_refund' AS metric,
       COUNT(*) AS violation_count
  FROM billing_provider_reservations bpr
  JOIN web_billing_charge_attempts a
    ON a.family_id=bpr.family_id AND a.order_id=bpr.reservation_ref
 WHERE bpr.provider='toss_web' AND bpr.state='active' AND a.refund_status='full';

-- 7) 검증 환불 상태마다 불변 금융 감사 행이 있어야 한다. 정상값은 0이다.
SELECT 'refund_record_missing' AS metric,
       COUNT(*) AS violation_count
  FROM web_billing_charge_attempts a
 WHERE a.refund_status IN ('partial','full')
   AND NOT EXISTS (
     SELECT 1
       FROM web_billing_refund_records r
      WHERE r.provider_reference=a.order_id
        AND r.refund_state_hash=a.refund_state_hash
        AND r.refund_status=a.refund_status
        AND r.refunded_amount=a.refunded_amount
   );

-- 8) 초기 출시 가격 계약 위반 행은 DB 제약과 별도로 0건이어야 한다.
SELECT 'invalid_release_price_rows' AS metric,
       COUNT(*) AS violation_count
  FROM web_billing_charge_attempts
 WHERE NOT (
   (plan='month' AND amount=4900)
   OR (plan='year' AND amount=39000)
 );

-- 9) 보존 기한이 지난 최소 환불 정본. 삭제 작업이 정상이라면 지속 누적되지 않는다.
SELECT 'expired_refund_records' AS metric,
       COUNT(*) AS expired_count,
       MIN(retention_until) AS oldest_retention_until
  FROM web_billing_refund_records
 WHERE datetime(substr(retention_until,1,19))<datetime('now');
