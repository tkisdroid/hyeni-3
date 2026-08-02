# Toss 웹 구독 환불 출시·장애 대응 runbook

이 문서는 혜니캘린더 초기 출시의 Toss 웹 구독 환불 정본을 운영하는 절차다. 출시 가격은 월 4,900원·연 39,000원으로 고정한다. 카드정보, `billingKey`, `paymentKey`, `customerKey`, 주문번호, 사용자·가족 식별자는 명령 출력이나 장애 기록에 복사하지 않는다.

## 출시 불변식

- D1 스키마를 Worker보다 먼저 적용한다. 필수 컬럼·인덱스가 없으면 Worker가 503으로 닫히는 것이 정상이다.
- Toss 웹훅 본문은 힌트일 뿐이다. 알려진 주문만 Toss 주문 조회 API로 재검증한 뒤 환불을 확정한다.
- 전액 환불은 해당 주문이 연 현재 Toss 권리와 자동청구만 닫는다. 과거 주문 환불로 더 최신 권리를 회수하지 않는다.
- 부분 환불은 금융 증적을 남기고 이후 자동청구를 중지하되 이미 결제한 현재 기간은 유지한다.
- Google Play 활성 가족의 Toss 충돌은 `refund_required`로 격리하고, Toss 전액 환불 재검증 뒤 Google 권리를 유지한 채 충돌만 해소한다.
- 분석 funnel 실패는 환불 정본 처리를 막지 않는다.
- 코드 롤백 시 **D1 migration은 되돌리지 않는다**. 이 runbook의 migration은 additive이며, 테이블·컬럼·인덱스나 금융 정본을 삭제하는 역migration을 실행하지 않는다.

## 1. 로컬 출시 게이트

저장소 루트에서 아래 명령이 모두 exit 0이어야 한다.

```bash
cd worker
npx tsc --noEmit
cd ..
node --test worker/tests/*.test.mjs
npm audit --audit-level=high
cd worker
```

## 2. 운영 D1 사전 판정

먼저 현재 운영 스키마를 읽기 전용으로 확인한다.

```bash
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('web_billing_customers','web_billing_trial_claims','web_billing_charge_attempts','web_billing_refund_records','web_billing_financial_records') ORDER BY name" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM pragma_table_info('web_billing_customers') WHERE name IN ('billing_key_revocation_status','last_paid_order_id') ORDER BY name" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM pragma_table_info('web_billing_trial_claims') WHERE name='provider'" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM pragma_table_info('web_billing_charge_attempts') WHERE name IN ('customer_key','provider_checked_at','refund_funnel_status','refund_status') ORDER BY name" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_web_billing_charge_refund_reconcile'" -y
```

`web_billing_charge_attempts`가 없으면 신규 DB 경로만 실행한다. 기존 테이블이 있으면 기존 DB 경로만 실행한다. 두 경로를 섞지 않는다.

### 신규 DB 경로

최신 base migration 하나에 키 폐기, 공유 체험 claim, 환불, 금융 보존 스키마가 모두 포함되어 있다.

```bash
npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing.sql -y
```

### 기존 DB 경로

사전 판정 결과에서 해당 컬럼이 없을 때만 아래 one-time migration을 순서대로 실행한다. 이미 존재하는 컬럼의 migration은 재실행하지 않는다. `web-billing-financial-retention.sql`은 `CREATE TABLE IF NOT EXISTS` 기반이라 마지막에 한 번 실행해도 기존 금융 행을 변경하지 않는다.

```bash
npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing-key-revocation.sql -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/google-play-family-trial-claim.sql -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing-refunds.sql -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing-financial-retention.sql -y
```

기존 DB에서 `refund_status`는 있는데 `customer_key`가 없으면 배포를 중단한다. `web-billing-refunds.sql`을 재실행하면 중복 컬럼 오류가 나므로 실행하지 않는다. 이 조합은 현재 초기 출시 migration 순서로 만들 수 없는 비정상 중간 상태이며, 운영 DB 스키마와 적용 이력을 별도 검토한 뒤 전용 one-time 보강 migration을 코드 리뷰·테스트해야 한다.

## 3. migration readback

아래 결과에는 다섯 테이블, 세 인덱스, 환불 네 컬럼이 모두 있어야 한다. 환불 대사 인덱스 SQL에는 `provider_checked_at`, `completed_at`, `order_id`, `status='done'`, `refund_status<>'full'`이 있어야 한다.

```bash
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('web_billing_customers','web_billing_trial_claims','web_billing_charge_attempts','web_billing_refund_records','web_billing_financial_records') ORDER BY name" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_web_billing_charge_refund_reconcile','idx_web_billing_refund_provider_checked','idx_web_billing_financial_retention') ORDER BY name" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM pragma_table_info('web_billing_charge_attempts') WHERE name IN ('customer_key','provider_checked_at','refund_funnel_status','refund_status') ORDER BY name" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_web_billing_charge_refund_reconcile'" -y
```

하나라도 빠지거나 인덱스 정의가 다르면 Worker를 배포하지 않는다. 이미 적용한 D1 migration은 삭제하거나 되돌리지 않고, 코드와 별도의 additive 보강 migration으로만 수정한다.

## 4. secret·웹훅 확인과 Worker 배포

secret 값은 출력하지 않고 이름만 확인한다. `TOSS_PAYMENTS_CLIENT_KEY`, `TOSS_PAYMENTS_SECRET_KEY`, `WEB_BILLING_KEY_ENCRYPTION_SECRET`, `PREMIUM_FUNNEL_HASH_SECRET`이 있어야 한다. 신규 값을 셸 인자로 넘기지 않는다.

```bash
npx wrangler secret list
npx wrangler deploy
npx wrangler deployments status
```

Toss 개발자센터의 `PAYMENT_STATUS_CHANGED` 웹훅은 아래 두 URL을 함께 구독한다.

- `https://hyeni-calendar-api.tkisdroid.workers.dev/api/billing/web/subscription/webhook`
- `https://hyeni-calendar-api.tkisdroid.workers.dev/api/billing/web/ai-credits/webhook`

배포 직후 부모 PWA의 구독 화면에서 월 4,900원·연 39,000원만 표시되는지 확인한다. 실제 카드 승인·환불을 운영 smoke test로 만들지 않는다. 결제사 test 환경의 독립 주문으로 승인, 부분 환불, 전액 환불, 동일 웹훅 재전송을 검증한다.

## 5. 읽기 전용 모니터링

배포 직후, 첫 환불 cron 뒤, 장애 조치 뒤에 같은 집계를 실행한다.

```bash
npx wrangler d1 execute hyeni-calendar --remote --file=ops/web-billing-refund-monitor.sql -y
```

다음 세 지표는 항상 0이어야 한다.

- `active_toss_entitlement_from_full_refund.violation_count`
- `active_toss_provider_from_full_refund.violation_count`
- `refund_record_missing.violation_count`

`refund_reconciliation_due.due_24h_count`가 증가하거나 `refund_funnel_pending.older_than_1h_count`가 계속 증가하면 cron 실행 로그와 secret 이름을 확인한다. `provider_conflicts`의 `refund_required`는 자동 권리 전환 대상이 아니며 Toss 콘솔에서 환불한 뒤 다음 웹훅 또는 환불 cron 재조회로 해소한다. 원시 주문번호나 결제 키를 모니터링 결과에 추가하지 않는다.

## 6. 코드 롤백

결제·환불 5xx가 지속되거나 위의 0 불변식이 깨지면 새 결제를 앱에서 임시로 노출하지 않은 상태로 Worker 코드만 직전 배포로 되돌린다.

```bash
npx wrangler deployments list
npx wrangler rollback -y -m "웹 구독 환불 코드 롤백; D1 additive schema 유지"
npx wrangler deployments status
npx wrangler d1 execute hyeni-calendar --remote --file=ops/web-billing-refund-monitor.sql -y
```

롤백 후에도 D1 migration은 되돌리지 않는다. `web_billing_refund_records`와 `web_billing_financial_records`를 삭제하지 않고, 환불 컬럼을 제거하지 않으며, 이미 저장된 5년 금융 정본을 수정하지 않는다. 직전 Worker가 추가 컬럼을 사용하지 않더라도 additive schema를 그대로 둔다. 원인을 수정한 새 Worker는 전체 출시 게이트와 migration readback을 다시 통과한 뒤 재배포한다.
