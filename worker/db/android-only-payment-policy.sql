-- 2026-09-01 결제 채널 정책:
-- 신규 구독과 AI 크레딧 구매는 Android Google Play에서만 시작한다.
-- 과거 웹 주문의 완료·대사·해지·환불 경로는 이 설정과 무관하게 유지한다.
INSERT INTO app_global_settings (key, value, updated_by, updated_at)
VALUES (
  'commerce_runtime_controls_v1',
  '{"webSubscriptionNewCheckoutsEnabled":false,"webAiCreditNewCheckoutsEnabled":false}',
  'deployment:android-only-payments-2026-09-01',
  CURRENT_TIMESTAMP
)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;
