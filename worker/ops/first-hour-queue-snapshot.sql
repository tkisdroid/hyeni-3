-- 출시 첫 60분 운영 큐 스냅샷(read-only).
-- 반환 컬럼은 고정된 집계 건수와 DB 시각뿐이며 사용자·가족·주문·token·원문 행을 반환하지 않는다.
WITH
clock AS (
  SELECT
    datetime('now') AS now_at,
    datetime('now','-2 minutes') AS urgent_cutoff,
    datetime('now','-1 hour') AS priority_refund_cutoff,
    datetime('now','-24 hours') AS historical_refund_cutoff,
    datetime('now','-48 hours') AS recent_refund_cutoff,
    datetime('now','-90 days') AS ai_credit_refund_cutoff,
    strftime('%Y-%m-%dT%H:%M:%fZ','now') AS captured_at
),
urgent_pending AS (
  SELECT COUNT(*) AS count
    FROM pending_notifications, clock
   WHERE delivered=0
     AND (expires_at IS NULL OR datetime(substr(expires_at,1,19))>clock.now_at)
     AND lower(CAST(json_extract(data,'$.urgent') AS TEXT)) IN ('1','true')
     AND datetime(substr(created_at,1,19))<=clock.urgent_cutoff
),
memo_due AS (
  SELECT COUNT(*) AS count
    FROM memo_notification_outbox, clock
   WHERE datetime(substr(next_attempt_at,1,19))<=clock.now_at
     AND (
       lease_token IS NULL
       OR lease_expires_at IS NULL
       OR datetime(substr(lease_expires_at,1,19))<=clock.now_at
     )
),
rtdn_due AS (
  SELECT
    (SELECT COUNT(*) FROM google_play_rtdn_events WHERE status='retryable')
    +
    (SELECT COUNT(*) FROM google_play_voided_purchase_events WHERE status='retryable')
    AS count
),
web_trial_due AS (
  SELECT COUNT(*) AS count
    FROM web_billing_checkout_sessions s
    JOIN web_billing_customers c
      ON c.family_id=s.family_id
     AND c.parent_id=s.parent_id
     AND c.customer_key=s.customer_key
    CROSS JOIN clock
   WHERE s.trial_eligible=1
     AND s.trial_days=7
     AND c.status='pending_charge'
     AND c.trial_ends_at IS NOT NULL
     AND c.billing_key_ciphertext IS NOT NULL
     AND c.billing_key_iv IS NOT NULL
     AND c.billing_key_version='v1'
     AND (
       s.status IN ('pending','expired')
       OR (
         s.status='processing'
         AND (
           s.claim_expires_at IS NULL
           OR datetime(substr(s.claim_expires_at,1,19))<=clock.now_at
         )
       )
     )
),
web_initial_due AS (
  SELECT COUNT(*) AS count
    FROM web_billing_charge_attempts a
    JOIN web_billing_checkout_sessions s
      ON s.id=a.checkout_session_id
     AND s.family_id=a.family_id
    JOIN web_billing_customers c
      ON c.family_id=a.family_id
     AND c.customer_key=s.customer_key
    CROSS JOIN clock
   WHERE a.kind='initial'
     AND c.status='pending_charge'
     AND s.status IN ('pending','processing')
     AND (
       s.status='pending'
       OR s.claim_expires_at IS NULL
       OR datetime(substr(s.claim_expires_at,1,19))<=clock.now_at
     )
     AND (
       a.status IN ('pending','unknown','done','failed')
       OR (
         a.status='processing'
         AND (
           a.claim_expires_at IS NULL
           OR datetime(substr(a.claim_expires_at,1,19))<=clock.now_at
         )
       )
     )
),
web_renewal_due AS (
  SELECT COUNT(*) AS count
    FROM web_billing_customers c
    JOIN billing_provider_reservations bpr
      ON bpr.family_id=c.family_id
     AND bpr.provider='toss_web'
     AND bpr.state='active'
    CROSS JOIN clock
   WHERE c.status IN ('trial','active','past_due')
     AND c.billing_key_ciphertext IS NOT NULL
     AND c.billing_key_iv IS NOT NULL
     AND c.billing_key_version='v1'
     AND (
       (
         c.status IN ('trial','active')
         AND datetime(substr(c.next_charge_at,1,19))<=clock.now_at
         AND (
           c.retry_after IS NULL
           OR datetime(substr(c.retry_after,1,19))<=clock.now_at
         )
       )
       OR (
         c.status='past_due'
         AND datetime(substr(c.retry_after,1,19))<=clock.now_at
       )
     )
),
web_key_revocation_due AS (
  SELECT COUNT(*) AS count
    FROM web_billing_customers, clock
   WHERE billing_key_revocation_status='pending'
     AND billing_key_ciphertext IS NOT NULL
     AND billing_key_iv IS NOT NULL
     AND billing_key_version='v1'
     AND (
       billing_key_revocation_retry_at IS NULL
       OR datetime(substr(billing_key_revocation_retry_at,1,19))<=clock.now_at
     )
),
web_refund_due AS (
  SELECT COUNT(*) AS count
    FROM web_billing_charge_attempts a
    CROSS JOIN clock
   WHERE a.status='done'
     AND a.refund_status<>'full'
     AND (
       (
         (
           EXISTS(
             SELECT 1
               FROM billing_provider_reservations bpr
              WHERE bpr.family_id=a.family_id
                AND bpr.provider='google_play'
                AND bpr.state='conflict'
                AND bpr.conflicting_provider='toss_web'
                AND bpr.conflict_ref=a.order_id
                AND bpr.resolution_status='refund_required'
           )
           OR EXISTS(
             SELECT 1
               FROM web_billing_customers c
              WHERE c.family_id=a.family_id
                AND (
                  c.last_paid_order_id=a.order_id
                  OR (a.kind='initial' AND c.status='pending_charge')
                  OR (
                    a.kind='renewal'
                    AND c.status IN ('active','past_due')
                    AND c.current_period_end=a.period_start
                    AND COALESCE(c.last_paid_order_id,'')<>a.order_id
                  )
                  OR (
                    a.kind='trial_conversion'
                    AND c.status IN ('trial','past_due')
                    AND c.current_period_end IS NULL
                    AND c.trial_ends_at=a.period_start
                  )
                )
           )
           OR datetime(substr(COALESCE(a.completed_at,a.created_at),1,19))>=clock.recent_refund_cutoff
         )
         AND (
           a.provider_checked_at IS NULL
           OR datetime(substr(a.provider_checked_at,1,19))<=clock.priority_refund_cutoff
         )
       )
       OR a.provider_checked_at IS NULL
       OR datetime(substr(a.provider_checked_at,1,19))<=clock.historical_refund_cutoff
     )
),
web_refund_funnel_due AS (
  SELECT COUNT(*) AS count
    FROM web_billing_charge_attempts
   WHERE status='done'
     AND refund_status='full'
     AND refund_funnel_status='pending'
),
web_ai_recovery_due AS (
  SELECT COUNT(*) AS count
    FROM web_ai_credit_orders, clock
   WHERE status IN ('unknown','processing')
     AND (
       retry_after IS NULL
       OR datetime(substr(retry_after,1,19))<=clock.now_at
     )
     AND (
       status<>'processing'
       OR claim_expires_at IS NULL
       OR datetime(substr(claim_expires_at,1,19))<=clock.now_at
     )
),
web_ai_refund_due AS (
  SELECT COUNT(*) AS count
    FROM web_ai_credit_orders, clock
   WHERE status IN ('done','refund_processing','refund_unknown')
     AND (
       retry_after IS NULL
       OR datetime(substr(retry_after,1,19))<=clock.now_at
     )
     AND (
       status<>'refund_processing'
       OR claim_expires_at IS NULL
       OR datetime(substr(claim_expires_at,1,19))<=clock.now_at
     )
     AND (
       status<>'done'
       OR (
         completed_at IS NOT NULL
         AND datetime(substr(completed_at,1,19))>=clock.ai_credit_refund_cutoff
       )
     )
)
SELECT
  clock.captured_at AS captured_at,
  urgent_pending.count AS urgent_over_2m,
  memo_due.count AS memo_outbox_due,
  rtdn_due.count AS rtdn_retryable,
  web_trial_due.count AS web_billing_trial_activation_due,
  web_initial_due.count AS web_billing_initial_reconciliation_due,
  web_renewal_due.count AS web_billing_renewal_due,
  web_key_revocation_due.count AS web_billing_key_revocation_due,
  web_refund_due.count AS web_billing_refund_reconciliation_due,
  web_refund_funnel_due.count AS web_billing_refund_funnel_pending,
  web_ai_recovery_due.count AS web_ai_credit_recovery_due,
  web_ai_refund_due.count AS web_ai_credit_refund_due
FROM clock
CROSS JOIN urgent_pending
CROSS JOIN memo_due
CROSS JOIN rtdn_due
CROSS JOIN web_trial_due
CROSS JOIN web_initial_due
CROSS JOIN web_renewal_due
CROSS JOIN web_key_revocation_due
CROSS JOIN web_refund_due
CROSS JOIN web_refund_funnel_due
CROSS JOIN web_ai_recovery_due
CROSS JOIN web_ai_refund_due;
