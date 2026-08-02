-- 출시 변경 창에서 운영 D1의 migration 준비 상태만 집계한다.
-- 결과는 단일 행이며 사용자·가족·자녀 식별자나 원본 행을 반환하지 않는다.
WITH
required_objects(type, name) AS (
  VALUES
    ('index', 'idx_ai_credit_balances_family_child_unique'),
    ('index', 'uq_ai_parent_settings_family_child'),
    ('table', 'premium_funnel_events'),
    ('table', 'premium_funnel_rate_limits'),
    ('table', 'family_lifecycle_events'),
    ('table', 'family_lifecycle_daily'),
    ('table', 'revenue_cost_ledger'),
    ('table', 'revenue_cost_coverage'),
    ('table', 'location_confirmation_records'),
    ('table', 'location_history_ingest_daily_usage'),
    ('table', 'web_billing_checkout_sessions'),
    ('table', 'web_billing_customers'),
    ('table', 'web_billing_charge_attempts'),
    ('table', 'web_billing_refund_records'),
    ('table', 'web_billing_trial_claims'),
    ('table', 'billing_provider_reservations'),
    ('table', 'web_billing_financial_records'),
    ('table', 'web_ai_credit_orders'),
    ('table', 'web_ai_credit_detached_balances'),
    ('table', 'web_ai_credit_lookup_windows'),
    ('table', 'referral_codes_v2'),
    ('table', 'referral_completions_v2'),
    ('table', 'google_play_rtdn_events'),
    ('table', 'google_play_billing_owners'),
    ('table', 'google_play_voided_purchase_events')
),
object_inventory AS (
  SELECT
    COUNT(*) AS required_objects,
    SUM(CASE WHEN sqlite_schema.name IS NOT NULL THEN 1 ELSE 0 END) AS present_objects
  FROM required_objects
  LEFT JOIN sqlite_schema
    ON sqlite_schema.type = required_objects.type
   AND sqlite_schema.name = required_objects.name
),
balance_groups AS (
  SELECT
    family_id,
    child_user_id,
    COUNT(*) AS row_count,
    MAX(MAX(0, COALESCE(purchased_credits, 0))) AS preserved_purchased,
    SUM(MAX(0, COALESCE(purchased_credits, 0))) AS unsafe_purchased_sum,
    MAX(substr(daily_reset_date, 1, 10)) AS latest_reset_date,
    COUNT(DISTINCT substr(daily_reset_date, 1, 10)) AS reset_date_variants,
    COUNT(DISTINCT NULLIF(parent_id, '')) AS parent_variants,
    COUNT(DISTINCT CASE WHEN COALESCE(is_premium, 0) <> 0 THEN 1 ELSE 0 END) AS premium_variants,
    COUNT(DISTINCT MAX(0, COALESCE(daily_included_limit, 0))) AS limit_variants
  FROM ai_credit_balances
  GROUP BY family_id, child_user_id
),
duplicate_groups AS (
  SELECT
    family_id,
    child_user_id,
    row_count,
    preserved_purchased,
    unsafe_purchased_sum,
    latest_reset_date,
    reset_date_variants,
    parent_variants,
    premium_variants,
    limit_variants
  FROM balance_groups
  WHERE row_count > 1
),
latest_daily_usage AS (
  SELECT
    duplicate_groups.family_id,
    duplicate_groups.child_user_id,
    MAX(MAX(0, COALESCE(ai_credit_balances.daily_included_used, 0))) AS preserved_daily_used,
    SUM(MAX(0, COALESCE(ai_credit_balances.daily_included_used, 0))) AS unsafe_daily_used_sum
  FROM duplicate_groups
  JOIN ai_credit_balances
    ON ai_credit_balances.family_id = duplicate_groups.family_id
   AND ai_credit_balances.child_user_id = duplicate_groups.child_user_id
   AND substr(ai_credit_balances.daily_reset_date, 1, 10) = duplicate_groups.latest_reset_date
  GROUP BY duplicate_groups.family_id, duplicate_groups.child_user_id
),
duplicate_rollup AS (
  SELECT
    COUNT(*) AS duplicate_groups,
    COALESCE(SUM(duplicate_groups.row_count), 0) AS duplicate_rows,
    COALESCE(SUM(duplicate_groups.row_count - 1), 0) AS rows_removed_by_merge,
    COALESCE(SUM(duplicate_groups.preserved_purchased), 0) AS preserved_purchased_total,
    COALESCE(SUM(duplicate_groups.unsafe_purchased_sum), 0) AS unsafe_sum_total,
    COALESCE(SUM(latest_daily_usage.preserved_daily_used), 0) AS preserved_daily_used_total,
    COALESCE(SUM(latest_daily_usage.unsafe_daily_used_sum), 0) AS unsafe_daily_used_sum,
    COALESCE(MAX(duplicate_groups.reset_date_variants), 0) AS max_reset_date_variants,
    COALESCE(MAX(duplicate_groups.parent_variants), 0) AS max_parent_variants,
    COALESCE(MAX(duplicate_groups.premium_variants), 0) AS max_premium_variants,
    COALESCE(MAX(duplicate_groups.limit_variants), 0) AS max_limit_variants
  FROM duplicate_groups
  LEFT JOIN latest_daily_usage
    ON latest_daily_usage.family_id = duplicate_groups.family_id
   AND latest_daily_usage.child_user_id = duplicate_groups.child_user_id
),
ai_parent_setting_duplicate_groups AS (
  SELECT COUNT(*) AS group_rows
    FROM ai_parent_settings
   GROUP BY family_id, child_user_id
  HAVING COUNT(*) > 1
),
ai_parent_setting_duplicate_rollup AS (
  SELECT
    COUNT(*) AS duplicate_groups,
    COALESCE(SUM(group_rows), 0) AS duplicate_rows,
    COALESCE(SUM(group_rows - 1), 0) AS rows_to_normalize,
    COALESCE(MAX(group_rows), 0) AS max_group_rows
  FROM ai_parent_setting_duplicate_groups
)
SELECT
  CURRENT_TIMESTAMP AS observed_at,
  object_inventory.required_objects AS required_objects,
  object_inventory.present_objects AS present_objects,
  object_inventory.required_objects - object_inventory.present_objects AS missing_objects,
  duplicate_rollup.duplicate_groups AS duplicate_groups,
  duplicate_rollup.duplicate_rows AS duplicate_rows,
  duplicate_rollup.rows_removed_by_merge AS rows_removed_by_merge,
  duplicate_rollup.preserved_purchased_total AS preserved_purchased_total,
  duplicate_rollup.unsafe_sum_total AS unsafe_sum_total,
  duplicate_rollup.preserved_daily_used_total AS preserved_daily_used_total,
  duplicate_rollup.unsafe_daily_used_sum AS unsafe_daily_used_sum,
  duplicate_rollup.max_reset_date_variants AS max_reset_date_variants,
  duplicate_rollup.max_parent_variants AS max_parent_variants,
  duplicate_rollup.max_premium_variants AS max_premium_variants,
  duplicate_rollup.max_limit_variants AS max_limit_variants,
  ai_parent_setting_duplicate_rollup.duplicate_groups AS ai_parent_settings_duplicate_groups,
  ai_parent_setting_duplicate_rollup.duplicate_rows AS ai_parent_settings_duplicate_rows,
  ai_parent_setting_duplicate_rollup.rows_to_normalize AS ai_parent_settings_rows_to_normalize,
  ai_parent_setting_duplicate_rollup.max_group_rows AS ai_parent_settings_max_group_rows,
  CASE WHEN EXISTS (
    SELECT 1
      FROM pragma_index_list('ai_parent_settings') index_entry
     WHERE index_entry.name = 'uq_ai_parent_settings_family_child'
       AND index_entry.[unique] = 1
       AND index_entry.partial = 0
       AND (
         SELECT group_concat(ordered_column.name, ',') FROM (
           SELECT name
             FROM pragma_index_info('uq_ai_parent_settings_family_child')
            ORDER BY seqno
         ) ordered_column
       ) = 'family_id,child_user_id'
  ) THEN 1 ELSE 0 END AS has_exact_ai_parent_settings_unique,
  CASE WHEN EXISTS (
    SELECT 1
      FROM sqlite_schema
     WHERE type = 'table'
       AND name = 'premium_funnel_events'
       AND instr(lower(COALESCE(sql, '')), '''ai_friend_limit''') > 0
  ) THEN 1 ELSE 0 END AS has_ai_friend_limit_source,
  CASE WHEN EXISTS (
    SELECT 1
      FROM sqlite_schema
     WHERE type = 'table'
       AND name = 'premium_funnel_events'
       AND instr(lower(COALESCE(sql, '')), '''ai_schedule_limit''') > 0
  ) THEN 1 ELSE 0 END AS has_ai_schedule_limit_source,
  CASE WHEN EXISTS (
    SELECT 1 FROM pragma_table_info('google_play_purchase_events') WHERE name = 'debt_applied'
  ) THEN 1 ELSE 0 END AS has_debt_applied,
  CASE WHEN EXISTS (
    SELECT 1 FROM pragma_table_info('web_billing_charge_attempts') WHERE name = 'refund_status'
  ) THEN 1 ELSE 0 END AS has_refund_status,
  CASE WHEN EXISTS (
    SELECT 1 FROM pragma_table_info('web_billing_charge_attempts') WHERE name = 'customer_key'
  ) THEN 1 ELSE 0 END AS has_customer_key,
  CASE WHEN EXISTS (
    SELECT 1 FROM pragma_table_info('web_ai_credit_orders') WHERE name = 'record_scope'
  ) THEN 1 ELSE 0 END AS has_web_ai_record_scope
FROM object_inventory
CROSS JOIN duplicate_rollup
CROSS JOIN ai_parent_setting_duplicate_rollup;
