# Global Paddle Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android 신규 결제는 Google Play Billing에만 남기고 PWA 신규 구독·AI 크레딧은 승인된 Paddle 경로로 제공하며, Google Play·Paddle·기존 Toss 사이 중복 결제를 차단하고 공급자 재검증 뒤에만 가족 권한과 크레딧을 확정한다.

**Architecture:** 기존 CHECK 제약 테이블은 삭제·재구축하지 않고 Paddle을 포함하는 v2 정본 테이블을 additive migration으로 만든다. 인증된 parent가 만든 만료성 checkout intent만 Paddle transaction의 불투명 `custom_data`에 연결한다. 브라우저 checkout 결과는 대기 UX일 뿐이며, Worker가 raw webhook 서명 검증→UNIQUE inbox→Paddle API 재조회→시간 순서 보호→provider reservation 확정 순서로 `family_subscription`을 갱신한다. 기존 Toss는 신규 판매를 닫고 기존 계약의 갱신·해지·환불만 유지한다.

**Tech Stack:** React 19, TypeScript strict, Cloudflare Worker/D1/Web Crypto, Paddle Billing API/Paddle.js, Google Play Billing, existing Toss Payments legacy service, TanStack Query, Node test runner

## Global Constraints

- 이 계획은 `2026-08-15-global-i18n-web.md` 전체 gate 통과 뒤 실행하며 신규 결제·해지·환불 문구를 10개 locale billing catalog에 함께 추가한다.
- Paddle 계정·앱 카테고리·제품·live domain이 승인됐다는 외부 증거가 없으면 production checkout을 열지 않는다. sandbox 구현 완료를 live 승인으로 해석하지 않는다.
- Paddle 정책상 무단 데이터 접근·spyware로 오인될 위험을 숨기지 않는다. 자녀 안전 목적, 가족 관계, 아이 화면 지속 표시, 주변소리 1분 상한, 감사 로그를 심사 자료에 그대로 설명한다.
- Google Play 배포 Android 앱에는 Paddle/Toss 구매 CTA, URL, QR, 가격 비교, 브라우저 결제 유도 문구를 넣지 않는다.
- PWA 신규 결제 공급자는 Paddle다. Toss는 cutover 이후 신규 checkout을 만들지 않고 기존 `toss_web` 가족의 갱신·관리·해지·환불만 유지한다.
- Paddle live 승인이 거절되거나 지연돼도 Lemon Squeezy나 다른 공급자로 자동 전환하지 않는다. 대체 공급자는 별도 정책 심사·설계 승인 전까지 범위 밖이다.
- `family_subscription`은 Premium entitlement 정본이다. client checkout callback, 이메일 일치, webhook payload 단독으로 권한을 열지 않는다.
- 가족당 active/reserved 공급자는 `google_play|paddle|toss_web` 중 하나다. 충돌은 자동 덮어쓰기·자동 환불·자동 공급자 이전 없이 `conflict/manual_review`로 격리한다.
- 7일 체험은 가족 평생 한 번이며 세 공급자가 같은 정본을 사용한다. Paddle price/catalog 설정만으로 체험 eligibility를 결정하지 않는다.
- 가격은 Paddle `PricePreview`/checkout이 반환한 formatted 값만 표시한다. 환율 계산, 가격 ID 이름 해석, 임의 반올림, 확정되지 않은 국가 가격을 만들지 않는다.
- API key, webhook secret, client-side token이 아닌 비밀, checkout/portal URL token, 결제수단, raw purchase/order token을 응답·로그·분석·localStorage에 남기지 않는다.
- `Paddle-Signature`는 JSON parse 전에 raw body로 검증하고 timestamp tolerance와 timing-safe 비교를 적용한다.
- AI 크레딧 grant/ledger/balance와 refund reversal은 D1 batch로 확정하고 event/transaction 멱등키를 공유한다. 소비된 크레딧 때문에 잔액을 음수로 만들지 않는다.
- 결제 실패와 분석 실패는 안전 기능 및 기존 유효 entitlement 조회를 실패시키지 않는다. 새 Premium grant만 fail-closed한다.
- production D1 migration·secret 설정·Worker/Pages 배포·실결제·스토어 업로드는 자동 실행하지 않는다.
- 기존 `output/store-ui-candidates-v1/`, `artifacts/`, 사용자 staged/unstaged 변경을 건드리거나 넓은 경로로 stage하지 않는다.
- 신규 `worker/tests/*.test.mjs`가 Worker TypeScript를 import하면 파일 첫 부분에서 `./helpers/tsModuleResolve.mjs`를 직접 import한다. 존재하지 않는 root 공용 loader를 CLI `--import`로 가정하지 않는다.

---

## File Structure

### New files

- `worker/db/paddle-billing-v2.sql` — provider/trial/funnel/financial v2 정본과 Paddle domain tables
- `worker/shared/paddleBilling.ts` — plan/SKU/status/error allowlist와 entitlement mapping 순수 함수
- `worker/lib/paddleConfig.ts` — sandbox/live approval/config health gate
- `worker/lib/paddleApi.ts` — Paddle API timeout, allowlisted request/response parser
- `worker/lib/paddleWebhook.ts` — raw HMAC signature와 event envelope parser
- `worker/lib/paddleBillingService.ts` — intent, inbox, reconciliation, entitlement state machine
- `worker/lib/paddleAiCredit.ts` — 일회성 transaction grant/refund D1 batch
- `worker/routes/paddle-billing.ts` — catalog/intent/status/portal/health 인증 route
- `worker/routes/paddle-webhook.ts` — 공개 raw webhook 수신 route
- `worker/cron/paddle-reconciliation.ts` — inbox 재시도와 active subscription 대사
- `src/lib/paddleBilling.ts` — Paddle.js 단일 초기화, price preview, transaction checkout
- `src/lib/api/endpoints/paddleBilling.ts` — Worker billing API client
- `src/transform/paddleBilling.ts` — runtime response parser와 UI state
- `tests/paddleBilling.test.ts`
- `tests/paddleBillingWiring.test.mjs`
- `tests/androidExternalBillingPolicy.test.mjs`
- `worker/tests/paddleBillingV2Migration.test.mjs`
- `worker/tests/paddleConfig.test.mjs`
- `worker/tests/paddleWebhookSignature.test.mjs`
- `worker/tests/paddleBillingRoutes.test.mjs`
- `worker/tests/paddleBillingReconciliation.test.mjs`
- `worker/tests/paddleAiCredit.test.mjs`
- `worker/ops/paddle-billing-runbook.md`
- `worker/ops/paddle-billing-monitor.sql`

### Modified files

- `cloudflare/schema_d1.sql`
- `package.json`, `package-lock.json`
- `.env.example`, `worker/.dev.vars.example`, `worker/wrangler.toml`
- `worker/types.ts`, `worker/index.ts`, `worker/lib/healthReadiness.ts`
- `worker/lib/billingProviderReservation.ts`, `worker/lib/familyTrialClaim.ts`
- `worker/lib/googlePlay.ts`, `worker/routes/google-play-verify.ts`, `worker/routes/google-play-rtdn.ts`
- `worker/routes/web-billing.ts`, `worker/lib/webBillingService.ts`
- `worker/routes/subscription-reconcile.ts`, `worker/routes/qonversion-webhook.ts`
- `worker/lib/premiumFunnel.ts`, `worker/lib/googlePlayPremiumFunnel.ts`
- `worker/cron/premium-funnel-retention.ts`
- `worker/ops/family-lifecycle-kpis.sql`, `worker/ops/channel-90d-net-revenue.sql`
- `worker/ops/first-hour-queue-snapshot.sql`, `worker/ops/release-d1-readonly-preflight.sql`, `worker/ops/web-billing-refund-monitor.sql`
- `src/screens/feature/Subscription.tsx`, `src/screens/feature/Subscription.css`
- `src/vite-env.d.ts`, `src/config/env.ts`
- `src/lib/webBilling.ts`, `src/lib/api/endpoints/webBilling.ts`
- `src/lib/premiumFunnel.ts`, `src/transform/webBilling.ts`
- `tests/subscriptionTrustCopy.test.mjs`, `tests/webBillingWiring.test.mjs`
- Google Play/Toss provider reservation·trial·funnel regression files named in the tasks below

### Existing authoritative behavior to preserve

- `worker/shared/subscriptionEntitlement.js`
- `worker/shared/googlePlaySubscription.js`
- `src/transform/subscriptionOffer.ts`
- `tests/subscriptionOfferPolicy.test.mjs`
- `tests/subscriptionCheckoutSafety.test.mjs`
- `worker/tests/googlePlayRtdnRoute.test.mjs`
- `worker/tests/webBillingRoutes.test.mjs`
- `worker/tests/webAiCreditBillingRoutes.test.mjs`
- `tests/subscriptionTrustCopy.test.mjs`

### External approval inputs — implementation must not invent these

- Paddle seller/product/category/live domain approval evidence
- Paddle sandbox/live client token, API key, webhook destination secret
- approved product/price IDs for month/year and each AI credit pack
- country-specific price override table and product tax category
- support/refund business policy and Paddle account owner

### Task 1: Paddle을 포함하는 additive v2 결제 정본

**Files:**
- Create: `worker/db/paddle-billing-v2.sql`
- Create: `worker/tests/paddleBillingV2Migration.test.mjs`
- Modify: `cloudflare/schema_d1.sql`
- Modify: `worker/lib/healthReadiness.ts`
- Modify: `worker/tests/canonicalSchemaBootstrap.test.mjs`
- Modify: `worker/tests/healthReadiness.test.mjs`

- [ ] `worker/tests/paddleBillingV2Migration.test.mjs`에 빈 DB bootstrap, 기존 Google/Toss reservation·trial copy, 적용 전 컬럼/table preflight, 정확히 1회 적용, 적용 후 readiness 반복 검사, source 테이블 보존, Paddle CHECK 수용, unknown provider 거부를 먼저 작성한다. additive `ALTER TABLE` SQL 자체의 재실행은 허용하지 않는다.
- [ ] migration 전후 다음 불변식을 SQL 단언으로 고정한다.

```sql
SELECT COUNT(*) FROM billing_provider_reservations_v2;
-- 기존 billing_provider_reservations의 모든 family_id가 provider/state/ref 그대로 복사됨

SELECT COUNT(*) FROM family_billing_trial_claims_v2;
-- 기존 web_billing_trial_claims의 모든 family_id가 한 번만 복사됨
```

- [ ] 테스트를 실행해 v2 table 부재로 실패하는지 확인한다.

Run: `node --test worker/tests/paddleBillingV2Migration.test.mjs`

Expected: `no such table: billing_provider_reservations_v2`로 실패.

- [ ] `worker/db/paddle-billing-v2.sql`에 다음 정본을 만든다. 기존 constrained table을 rename/drop/rebuild하지 않는다.

```text
billing_provider_reservations_v2  family PK, provider google_play|paddle|toss_web
family_billing_trial_claims_v2    family PK, provider 3종, 7-day claim
premium_funnel_events_v2          기존 최소수집 계약 + provider paddle
revenue_cost_ledger_v2            기존 원장 + provider paddle
revenue_cost_coverage_v2          기존 coverage + provider paddle
paddle_checkout_intents           opaque intent와 family/owner/kind/price/state/expiry
paddle_customers                  family와 Paddle customer의 유일 매핑
paddle_subscriptions              subscription별 최신 canonical snapshot
paddle_transactions               transaction별 intent/status/occurred ordering
paddle_webhook_inbox              event_id PK, allowlisted envelope, retry state
paddle_adjustments                adjustment idempotency와 approved refund 상태
paddle_ai_credit_purchases        transaction별 grant/refund/recoverable 수치
```

- [ ] `family_subscription`에는 `provider_customer_ref`, `provider_subscription_ref`, `provider_transaction_ref`, `provider_state_version`을 additive로 추가한다. 기존 `qonversion_user_id`는 삭제하거나 Paddle ID 저장 용도로 재해석하지 않는다.
- [ ] 기존 `family_subscription.qonversion_user_id NOT NULL` 호환 때문에 Paddle insert는 현재 Google/Toss 경로와 같은 canonical `family_id` 값을 이 legacy 필드에 유지한다. Paddle customer/subscription/transaction ID는 새 provider ref 컬럼에만 저장하고 Qonversion reconcile은 `provider='paddle'` 행을 읽거나 갱신하지 않는다.
- [ ] 모든 Paddle table에 raw payload/token/card field를 만들지 않는다. provider refs는 length/prefix check와 UNIQUE를 적용하고 intent ID는 UUID다.
- [ ] 기존 v1→v2 copy는 `INSERT OR IGNORE ... SELECT` 뒤 row-value equivalence 검사 query를 제공한다. copy query 단독 멱등성은 테스트하되 migration 전체는 preflight를 통과한 DB에 정확히 1회만 적용한다. v1 tables는 rollback evidence로 그대로 둔다.
- [ ] canonical schema와 health readiness가 v2 table/index/columns를 필수로 검사하도록 갱신한다.
- [ ] migration/canonical/health 테스트를 통과시킨다.

Run: `node --test worker/tests/paddleBillingV2Migration.test.mjs worker/tests/canonicalSchemaBootstrap.test.mjs worker/tests/healthReadiness.test.mjs`

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('worker/db/paddle-billing-v2.sql','worker/tests/paddleBillingV2Migration.test.mjs','cloudflare/schema_d1.sql','worker/lib/healthReadiness.ts','worker/tests/canonicalSchemaBootstrap.test.mjs','worker/tests/healthReadiness.test.mjs')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "Paddle 결제용 v2 정본 스키마를 추가한다"
```

### Task 2: 세 공급자 선점과 가족 평생 체험 정본 전환

**Files:**
- Modify: `worker/lib/billingProviderReservation.ts`
- Modify: `worker/lib/familyTrialClaim.ts`
- Modify: `worker/lib/googlePlay.ts`
- Modify: `worker/routes/google-play-verify.ts`
- Modify: `worker/routes/google-play-rtdn.ts`
- Modify: `worker/routes/web-billing.ts`
- Modify: `worker/lib/webBillingService.ts`
- Modify: `worker/tests/googlePlayShared.test.mjs`
- Modify: `worker/tests/googlePlayRtdnRoute.test.mjs`
- Modify: `worker/tests/webBillingRoutes.test.mjs`
- Modify: `worker/tests/webBillingPolicy.test.mjs`

- [ ] provider reservation tests를 table-driven 세 공급자로 확장한다. same provider/same intent 멱등, same provider/different live intent defer, 다른 active provider block, 실제 이중 결제 conflict/manual_review를 모두 단언한다.
- [ ] trial tests에 Google→Paddle, Paddle→Google, legacy Toss→Paddle, 동시 Google/Paddle claim 경합을 추가해 가족당 승자 1개만 남는지 확인한다.
- [ ] 기존 코드가 v1 table을 읽는 상태에서 테스트를 실행해 Paddle case와 v2 query 단언이 실패하는지 확인한다.

Run: `node --test worker/tests/googlePlayShared.test.mjs worker/tests/googlePlayRtdnRoute.test.mjs worker/tests/webBillingRoutes.test.mjs worker/tests/webBillingPolicy.test.mjs worker/tests/paddleBillingV2Migration.test.mjs`

Expected: provider allowlist 또는 SQL table 단언 실패.

- [ ] `BillingProvider`를 `"google_play" | "paddle" | "toss_web"`으로 바꾸고 모든 읽기/claim/release/activate를 `billing_provider_reservations_v2` 정본으로 전환한다.
- [ ] conflict reason을 공급자 조합별 문자열 폭발 대신 다음 allowlist로 정규화하고 `conflicting_provider`에 상대를 남긴다.

```ts
type BillingProviderConflictReason =
  | "preexisting_provider_overlap"
  | "cross_provider_purchase_after_activation"
  | "parallel_checkout_race";
```

- [ ] `familyTrialClaim.ts`의 eligibility/claim을 `family_billing_trial_claims_v2`로 전환하고 기존 Google/Toss purchase evidence까지 모두 읽는다. Paddle claim API는 Task 6에서 같은 helper를 호출한다.
- [ ] Google Play와 legacy Toss 경로가 v2 migration 미적용 시 결제를 진행하지 않고 `billing_schema_unavailable`로 fail-closed하도록 readiness guard를 둔다. 기존 entitlement read는 계속 가능해야 한다.
- [ ] Google/Toss 회귀를 통과시키고 v1 table write가 0건인지 정적/DB 단언한다.

Run: `node --test worker/tests/googlePlayShared.test.mjs worker/tests/googlePlayRtdnRoute.test.mjs worker/tests/webBillingRoutes.test.mjs worker/tests/webBillingPolicy.test.mjs && npm run typecheck:worker`

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('worker/lib/billingProviderReservation.ts','worker/lib/familyTrialClaim.ts','worker/lib/googlePlay.ts','worker/routes/google-play-verify.ts','worker/routes/google-play-rtdn.ts','worker/routes/web-billing.ts','worker/lib/webBillingService.ts','worker/tests/googlePlayShared.test.mjs','worker/tests/googlePlayRtdnRoute.test.mjs','worker/tests/webBillingRoutes.test.mjs','worker/tests/webBillingPolicy.test.mjs')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "세 결제 공급자의 선점과 체험을 통합한다"
```

### Task 3: Paddle config·승인 health·API client

**Files:**
- Create: `worker/shared/paddleBilling.ts`
- Create: `worker/lib/paddleConfig.ts`
- Create: `worker/lib/paddleApi.ts`
- Create: `worker/tests/paddleConfig.test.mjs`
- Modify: `worker/types.ts`
- Modify: `.env.example`
- Modify: `worker/.dev.vars.example`
- Modify: `worker/wrangler.toml`

- [ ] config 테스트에 secret 누락, sandbox ready, production configured-but-unapproved, approved domain mismatch, live approved, price allowlist parse 실패를 먼저 작성한다.
- [ ] API client 테스트에 8초 abort, non-2xx 축소 error, malformed JSON, prefix/type/status/price allowlist, secret·raw body log 금지를 추가한다.
- [ ] 테스트를 실행해 모듈 부재로 실패하는지 확인한다.

Run: `node --test worker/tests/paddleConfig.test.mjs`

Expected: 신규 config/API module import 실패.

- [ ] 다음 env 계약을 `worker/types.ts`와 example 파일에 값 없이 문서화한다.

```ts
PADDLE_ENVIRONMENT?: "sandbox" | "production";
PADDLE_API_KEY?: string;
PADDLE_WEBHOOK_SECRET?: string;
PADDLE_LIVE_APPROVED?: string;
PADDLE_APPROVED_DOMAIN?: string;
PADDLE_PRICE_CATALOG_JSON?: string;
```

루트 `.env.example`에는 값이 비어 있는 `VITE_PADDLE_CLIENT_TOKEN=`과 `VITE_PADDLE_ENVIRONMENT=sandbox`만 추가한다. `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, price catalog는 어떤 `VITE_` 변수로도 만들지 않는다.

- [ ] `resolvePaddleHealth`는 `{configured, sandbox, liveApproved, schemaReady, accepting}`만 반환한다. secret 존재 여부를 개별 키 이름·길이·prefix와 함께 노출하지 않는다.
- [ ] `accepting`은 sandbox의 완전한 test config이거나 production의 완전한 config+`liveApproved===true`+요청 origin 정확 일치일 때만 true다.
- [ ] `PADDLE_PRICE_CATALOG_JSON` parser는 국가별 `subscription.month|year`의 `trialPriceId|standardPriceId`와 명시된 AI pack SKU별 price ID만 허용한다. Worker가 Paddle price entity를 재조회해 trial price의 `trial_period`가 정확히 7일인지 확인하며, country override 미확정 시 해당 국가 항목을 반환하지 않는다.
- [ ] `paddleApi.ts`는 `https://api.paddle.com`과 sandbox base를 config로 선택하고 `Authorization: Bearer`를 오직 server fetch에만 붙인다. 응답은 각 entity의 필요한 필드만 strict parse한다.
- [ ] 테스트와 Worker typecheck를 통과시킨다.

Run: `node --test worker/tests/paddleConfig.test.mjs && npm run typecheck:worker`

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('worker/shared/paddleBilling.ts','worker/lib/paddleConfig.ts','worker/lib/paddleApi.ts','worker/tests/paddleConfig.test.mjs','worker/types.ts','.env.example','worker/.dev.vars.example','worker/wrangler.toml')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "Paddle 승인과 설정을 fail-closed로 판정한다"
```

### Task 4: raw webhook 검증과 멱등 inbox

**Files:**
- Create: `worker/lib/paddleWebhook.ts`
- Create: `worker/routes/paddle-webhook.ts`
- Create: `worker/tests/paddleWebhookSignature.test.mjs`
- Modify: `worker/index.ts`

- [ ] signature 테스트에 exact raw bytes, whitespace 변조, 잘못된 secret, header 누락, 여러 `h1`, 미래/과거 timestamp, malformed JSON, unknown event를 먼저 작성한다.
- [ ] route 테스트에 유효 event 200+한 inbox row, 중복 event 200+한 row 유지, 서명은 유효하지만 미지원인 event는 최소 envelope만 `ignored`로 기록하고 200, DB insert 실패 503, 응답 body에 detail/secret 없음, 공개 route가 auth refresh를 시도하지 않음을 추가한다.
- [ ] 테스트를 실행해 verifier/route 부재로 실패하는지 확인한다.

Run: `node --test worker/tests/paddleWebhookSignature.test.mjs`

Expected: 신규 module import 실패.

- [ ] Web Crypto HMAC-SHA256 verifier를 구현한다. `c.req.raw.text()`를 한 번 읽고 JSON parse 전에 다음 signed payload를 검증한다.

```ts
const signedPayload = `${timestamp}:${rawBody}`;
// Paddle-Signature의 모든 h1 후보를 decode하고 crypto.subtle.verify(HMAC)로 검증
```

- [ ] signature timestamp 허용 오차는 Paddle 공식 SDK 기본과 같은 5초로 시작하고 injectable clock으로 테스트한다. 운영 clock skew가 확인되면 임의 확대하지 말고 문서화된 보안 검토를 거친다.
- [ ] verified JSON에서 `event_id`, bounded `event_type`, `occurred_at`, entity type/id만 parse해 `paddle_webhook_inbox`에 `INSERT OR IGNORE`한다. 처리 대상 event type은 allowlist로 분기하고 미지원 type은 `ignored` 상태로 관측 가능하게 남긴다. raw body와 전체 `data`를 저장하지 않는다.
- [ ] insert commit 뒤 5초 이내 200을 반환하고 `executionCtx.waitUntil`로 처리 시도를 시작한다. 처리 실패는 inbox `retry` 상태로 남기며 public response에는 내부 오류를 넣지 않는다.
- [ ] `/api/billing/paddle/webhook`을 auth middleware 밖의 명시 route로 연결하고 request size limit을 적용한다.
- [ ] 테스트와 typecheck를 통과시킨다.

Run: `node --test worker/tests/paddleWebhookSignature.test.mjs && npm run typecheck:worker`

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('worker/lib/paddleWebhook.ts','worker/routes/paddle-webhook.ts','worker/tests/paddleWebhookSignature.test.mjs','worker/index.ts')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "Paddle webhook 서명과 멱등 수신함을 구현한다"
```

### Task 5: parent checkout intent와 가격 preview 계약

**Files:**
- Create: `worker/lib/paddleBillingService.ts`
- Create: `worker/routes/paddle-billing.ts`
- Create: `worker/tests/paddleBillingRoutes.test.mjs`
- Modify: `worker/index.ts`

- [ ] route 테스트에 active parent만 허용, child/teacher/co-parent owner rule, canonical family resolution, unsupported country, price/plan/SKU allowlist, 10분 expiry, request UUID 멱등성, provider block/conflict를 먼저 작성한다.
- [ ] Paddle transaction create request가 raw family/user ID 대신 opaque intent ID만 `custom_data`에 넣고 approved checkout URL만 사용하는지 fetch mock으로 단언한다.
- [ ] catalog/preview 응답이 price ID와 Paddle formatted totals만 전달하고 환율/하드코딩 가격을 포함하지 않는지 단언한다.
- [ ] 테스트를 실행해 route/service 부재로 실패하는지 확인한다.

Run: `node --test worker/tests/paddleBillingRoutes.test.mjs`

Expected: 신규 route 또는 DB table 부재로 실패.

- [ ] `POST /api/billing/paddle/intents`는 `Idempotency-Key` UUID, `kind`, `plan|sku`, `locale`만 받는다. body의 family/user/country/price ID는 받지 않는다.
- [ ] Worker가 active parent→canonical family→config approval→schema→provider reservation→trial eligibility→price allowlist 순서로 검증하고 10분 만료 intent를 만든다.
- [ ] recurring transaction에는 trial eligible이고 Paddle API가 allowlisted `trialPriceId`의 `trial_period=7 DAY`를 확인한 경우에만 그 price를 선택한다. 동적으로 trial을 조작하거나 7일이 아닌 offer를 체험으로 표시하지 않는다. trial claim은 transaction 완료 전 provisional로 소비하지 않되 reservation으로 동시 checkout을 막는다.
- [ ] Paddle API로 automatically-collected transaction을 만들고 returned transaction ID를 intent와 결합한다. client에는 `{intentId, transactionId, expiresAt, environment}`만 반환한다.
- [ ] `GET /catalog`은 Paddle pricing preview를 server-side 호출하거나 approved price IDs를 Paddle.js PricePreview용으로 반환한다. 최종 UI는 Paddle의 `formatted_totals`/`formattedUnitTotals`만 사용한다.
- [ ] `GET /intents/:id`는 owner parent에게 `pending|confirmed|failed|expired`와 안정적인 error code만 반환한다.
- [ ] tests/typecheck를 통과시킨다.

Run: `node --test worker/tests/paddleBillingRoutes.test.mjs worker/tests/webBillingRoutes.test.mjs worker/tests/googlePlayRtdnRoute.test.mjs && npm run typecheck:worker`

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('worker/lib/paddleBillingService.ts','worker/routes/paddle-billing.ts','worker/tests/paddleBillingRoutes.test.mjs','worker/index.ts')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "Paddle checkout intent와 가격 계약을 추가한다"
```

### Task 6: API 재조회 기반 entitlement와 역순 이벤트 보호

**Files:**
- Modify: `worker/shared/paddleBilling.ts`
- Modify: `worker/lib/paddleBillingService.ts`
- Create: `worker/tests/paddleBillingReconciliation.test.mjs`
- Modify: `worker/routes/subscription-reconcile.ts`
- Modify: `worker/routes/qonversion-webhook.ts`
- Modify: `worker/lib/premiumFunnel.ts`
- Modify: `worker/lib/googlePlayPremiumFunnel.ts`
- Modify: `worker/routes/google-play-verify.ts`
- Modify: `worker/routes/google-play-rtdn.ts`
- Modify: `worker/cron/premium-funnel-retention.ts`
- Modify: `worker/ops/family-lifecycle-kpis.sql`
- Modify: `worker/ops/channel-90d-net-revenue.sql`
- Modify: `worker/ops/first-hour-queue-snapshot.sql`
- Modify: `worker/ops/release-d1-readonly-preflight.sql`
- Modify: `worker/ops/web-billing-refund-monitor.sql`
- Modify: `worker/tests/premiumFunnelPersistence.test.mjs`
- Modify: `worker/tests/familyLifecycleFunnel.test.mjs`
- Modify: `worker/tests/revenueCostLedger.test.mjs`
- Modify: `worker/tests/firstHourQueueTrend.test.mjs`
- Modify: `worker/tests/releaseD1ReadonlyPreflight.test.mjs`

- [ ] entitlement mapping tests에 다음 경계를 먼저 작성한다.

| Paddle 상태 | 시간 조건 | 앱 결과 |
|---|---|---|
| `trialing` | future trial end | `trial` |
| `trialing` | null/past | grant 없음 |
| `active` | future current period end | `active` |
| `past_due` | provider retry + future entitlement end | `grace` |
| cancel scheduled | future period end | `cancelled`이지만 Premium 유지 |
| canceled/expired | 종료 시각 도달 | Premium 종료 |
| full approved refund | 현재 period 전액 | Premium 종료 |
| API/DB parse 실패 | 무관 | 새 grant 없음 |

- [ ] reconciliation 테스트에 duplicate event, newer→older event, webhook entity와 API entity 불일치, intent/customer/subscription ownership mismatch, provider conflict, API timeout retry를 추가한다.
- [ ] 결제 확정 funnel 테스트에 HMAC deterministic UUID, `trial_start|entitlement_activated|renewal|refund`만 server-side 기록, raw family/payment reference 비저장을 추가한다. retention과 KPI/순매출/첫 1시간/preflight 운영 SQL이 v2만 읽고 v1/v2를 이중 집계하지 않는지도 먼저 단언한다.
- [ ] 테스트를 실행해 Paddle mapping/processor 부재로 실패하는지 확인한다.

Run: `node --test worker/tests/paddleBillingReconciliation.test.mjs worker/tests/familyEntitlementResolver.test.mjs worker/tests/googlePlayRtdnRoute.test.mjs`

Expected: 신규 reconciliation 단언 실패.

- [ ] inbox processor는 event type만 분기 신호로 쓰고 transaction/subscription/adjustment를 Paddle API에서 다시 조회한다. webhook `data.status`만으로 entitlement를 쓰지 않는다.
- [ ] opaque intent→family/owner mapping, Paddle transaction custom_data intent, customer/subscription mapping, provider reservation을 모두 일치시킨 뒤에만 `family_subscription`을 batch 갱신한다.
- [ ] `occurred_at`과 provider entity `updated_at`을 `provider_state_version`과 비교해 오래된 event가 최신 상태를 되돌리지 못하게 한다. 같은 버전은 event ID로 멱등 처리한다.
- [ ] 최초 확정 때 가족 평생 trial claim을 같은 처리 흐름에서 claim한다. 이미 다른 공급자가 claim했으면 entitlement를 덮지 않고 conflict/manual_review로 보낸다.
- [ ] `family_subscription.provider='paddle'`을 Qonversion reconcile이 건드리지 않도록 canonical provider set을 세 공급자로 확장한다.
- [ ] Paddle funnel은 `premium_funnel_events_v2`에만 쓰고 기존 minimum collection 계약을 그대로 적용한다. Google/Toss writer도 v2로 전환해 분석 정본이 분열되지 않게 한다.
- [ ] 180일 retention과 운영 KPI·순매출·첫 1시간·release preflight·refund monitor SQL을 v2 정본으로 함께 전환한다. migration copy 뒤 v1은 rollback evidence로 읽기 전용 보존하며 합계에 UNION하거나 새 행을 쓰지 않는다.
- [ ] reconciliation/entitlement/funnel 회귀와 typecheck를 통과시킨다.

Run: `node --test worker/tests/paddleBillingReconciliation.test.mjs worker/tests/familyEntitlementResolver.test.mjs worker/tests/googlePlayRtdnRoute.test.mjs worker/tests/webBillingRoutes.test.mjs worker/tests/premiumFunnelPersistence.test.mjs worker/tests/googlePlayPremiumFunnel.test.mjs worker/tests/familyLifecycleFunnel.test.mjs worker/tests/revenueCostLedger.test.mjs worker/tests/firstHourQueueTrend.test.mjs worker/tests/releaseD1ReadonlyPreflight.test.mjs && npm run typecheck:worker`

Expected: 전체 통과.

- [ ] 이 태스크에서 실제 수정한 파일만 명시해 커밋하고 v1 funnel write가 남지 않았는지 `rg` 결과를 검토한다.

### Task 7: PWA Paddle.js와 Android 외부 결제 차단

**Files:**
- Create: `src/lib/paddleBilling.ts`
- Create: `src/lib/api/endpoints/paddleBilling.ts`
- Create: `src/transform/paddleBilling.ts`
- Create: `tests/paddleBilling.test.ts`
- Create: `tests/paddleBillingWiring.test.mjs`
- Create: `tests/androidExternalBillingPolicy.test.mjs`
- Modify: `src/screens/feature/Subscription.tsx`
- Modify: `src/screens/feature/Subscription.css`
- Modify: `src/lib/webBilling.ts`
- Modify: `src/lib/api/endpoints/webBilling.ts`
- Modify: `src/lib/premiumFunnel.ts`
- Modify: `src/transform/webBilling.ts`
- Modify: `tests/subscriptionTrustCopy.test.mjs`
- Modify: `tests/webBillingWiring.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `src/vite-env.d.ts`
- Modify: `src/config/env.ts`

- [ ] UI state 테스트에 native Play only, PWA Paddle new sale, legacy Toss manage-only, Play-subscribed PWA block, Paddle-subscribed Android manage-on-web informational state를 먼저 작성한다.
- [ ] 정적 Android policy 테스트에 Capacitor/native branch에서 `paddle`, checkout URL, Toss 신규 checkout CTA가 렌더/import되지 않음을 추가한다.
- [ ] checkout lifecycle 테스트에 user tap 내 overlay open, complete→`confirming`, cancel→local cancel only, callback이 entitlement cache를 직접 grant하지 않음, intent polling만 수행을 추가한다.
- [ ] 테스트를 실행해 신규 client 모듈 부재와 기존 Toss 신규 CTA로 실패하는지 확인한다.

Run: `node --test tests/paddleBilling.test.ts tests/paddleBillingWiring.test.mjs tests/androidExternalBillingPolicy.test.mjs tests/subscriptionTrustCopy.test.mjs tests/webBillingWiring.test.mjs`

Expected: Paddle module 부재 또는 channel matrix 단언 실패.

- [ ] 공식 wrapper를 exact lockfile version으로 설치한다.

Run: `npm install --save-exact @paddle/paddle-js`

Expected: `package.json`과 `package-lock.json`에 exact version 기록.

- [ ] `paddleBilling.ts`는 subscription route에서만 dynamic import하고 `initializePaddle`을 페이지 생명주기당 한 번만 호출한다. `src/config/env.ts`를 통해 public `VITE_PADDLE_CLIENT_TOKEN`과 allowlisted `VITE_PADDLE_ENVIRONMENT=sandbox|production`만 읽고 API key/webhook secret을 참조할 수 없게 정적 테스트한다.
- [ ] Paddle `PricePreview({items})` 결과 parser가 `formattedTotals`만 화면 model로 내보내게 한다. preview 실패 시 가격을 추정하지 않고 결제 버튼을 닫는다.
- [ ] PWA 결제 버튼은 Worker intent의 transaction ID로 overlay checkout을 연다. `checkout.completed`는 성공 toast 대신 “결제를 확인하고 있어요”와 intent status polling을 시작한다.
- [ ] 기존 Toss family에는 신규 plan 선택 대신 기존 관리/해지/환불 화면만 남긴다. 신규 Toss checkout API는 server cutover flag 뒤 410을 반환하도록 Task 10 rollout에서 전환한다.
- [ ] 공동 부모에게 상태는 보이되 Paddle portal은 stored owner parent만 열 수 있다는 문구/disabled state를 둔다.
- [ ] UI tests/typecheck/build를 통과시킨다.

Run: `node --test tests/paddleBilling.test.ts tests/paddleBillingWiring.test.mjs tests/androidExternalBillingPolicy.test.mjs tests/subscriptionTrustCopy.test.mjs tests/webBillingWiring.test.mjs && npm run typecheck && npm run build`

Expected: 전체 통과, initial route bundle budget 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('src/lib/paddleBilling.ts','src/lib/api/endpoints/paddleBilling.ts','src/transform/paddleBilling.ts','tests/paddleBilling.test.ts','tests/paddleBillingWiring.test.mjs','tests/androidExternalBillingPolicy.test.mjs','src/screens/feature/Subscription.tsx','src/screens/feature/Subscription.css','src/lib/webBilling.ts','src/lib/api/endpoints/webBilling.ts','src/lib/premiumFunnel.ts','src/transform/webBilling.ts','tests/subscriptionTrustCopy.test.mjs','tests/webBillingWiring.test.mjs','package.json','package-lock.json','.env.example','src/vite-env.d.ts','src/config/env.ts')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "PWA Paddle 결제와 Android Play 전용 경계를 연결한다"
```

### Task 8: Customer Portal·취소·refund adjustment

**Files:**
- Modify: `worker/routes/paddle-billing.ts`
- Modify: `worker/lib/paddleBillingService.ts`
- Modify: `worker/tests/paddleBillingRoutes.test.mjs`
- Modify: `worker/tests/paddleBillingReconciliation.test.mjs`
- Modify: `src/lib/api/endpoints/paddleBilling.ts`
- Modify: `src/screens/feature/Subscription.tsx`
- Modify: `tests/paddleBilling.test.ts`

- [ ] tests에 checkout owner parent만 portal/refund 가능, 공동 부모/child 거부, 매 요청 새 portal session, URL DB/cache/log 비저장, top-level user-tap open을 먼저 작성한다.
- [ ] cancellation 테스트에 period-end scheduled change, webhook 전 즉시 권한 종료 금지, reactivation/updated event를 추가한다.
- [ ] adjustment 테스트에 `pending_approval`은 환불 완료 아님, approved full/partial 구분, rejected 무변경, duplicate adjustment 멱등을 추가한다.
- [ ] 테스트를 실행해 route 부재로 실패하는지 확인한다.

Run: `node --test tests/paddleBilling.test.ts worker/tests/paddleBillingRoutes.test.mjs worker/tests/paddleBillingReconciliation.test.mjs`

Expected: portal/refund route 단언 실패.

- [ ] `POST /portal-session`은 current session의 parent와 stored billing owner를 비교한 뒤 Paddle `POST /customers/{customer_id}/portal-sessions`를 호출한다. response URL은 브라우저로 한 번 전달하고 저장·캐시하지 않는다.
- [ ] 취소는 portal을 기본으로 제공하고 서버 API 취소가 필요하면 Paddle subscription의 period-end scheduled change만 생성한다. 즉시 취소 옵션을 일반 UI에 노출하지 않는다.
- [ ] refund 요청은 명시적 transaction/amount ownership 검증 뒤 adjustment를 생성하고 DB에 `pending_approval`을 기록한다. approved webhook/API 재조회 전에는 환불 완료 문구나 entitlement revoke를 하지 않는다.
- [ ] full approved current-period refund만 subscription entitlement 종료 조건에 반영하고 partial refund는 재무 원장만 갱신한다.
- [ ] portal/cancel/refund tests를 통과시킨다.

Run: `node --test tests/paddleBilling.test.ts worker/tests/paddleBillingRoutes.test.mjs worker/tests/paddleBillingReconciliation.test.mjs && npm run typecheck && npm run typecheck:worker`

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

### Task 9: Paddle AI 크레딧 원자 grant와 환불 회수

**Files:**
- Create: `worker/lib/paddleAiCredit.ts`
- Create: `worker/tests/paddleAiCredit.test.mjs`
- Modify: `worker/lib/paddleBillingService.ts`
- Modify: `worker/routes/paddle-billing.ts`
- Modify: `src/lib/api/endpoints/paddleBilling.ts`
- Modify: `src/screens/feature/AiCredit.tsx`
- Modify: `src/screens/feature/AiCredit.css`
- Modify: `worker/lib/accountDeletion.ts`

- [ ] tests에 active parent/정확한 child user target, one-time allowed SKU, transaction.completed API refetch, duplicate event/transaction, balance/ledger/claim batch 원자성을 먼저 작성한다.
- [ ] refund tests에 미소비분 전액 회수, 일부 소비 시 balance 0 floor, unrecoverable count 기록, 동일 adjustment 중복 회수 금지, 안전 기능/일일 포함분 불변을 추가한다.
- [ ] D1 batch 중 각 statement failure에서 grant/claim/ledger가 일부만 남지 않는지 failure injection으로 단언한다.
- [ ] 테스트를 실행해 helper 부재로 실패하는지 확인한다.

Run: `node --test worker/tests/paddleAiCredit.test.mjs worker/tests/webAiCreditBillingRoutes.test.mjs`

Expected: 신규 helper/table 단언 실패.

- [ ] checkout intent에 child auth `user_id`를 server-side 매핑하고 member id와 혼동하지 않는다. body의 credits 수량은 무시하고 approved SKU 정본에서 grant 수량을 읽는다.
- [ ] transaction ref를 결정적 ledger ID에 넣고 `paddle_ai_credit_purchases` claim, `ai_credit_balances` upsert, positive `ai_credit_ledger` insert를 한 `DB.batch`로 실행한다.
- [ ] approved refund는 원구매 positive ledger와 현재 purchased balance를 읽어 recoverable/unrecoverable을 계산하고 negative ledger+balance+purchase refund state를 한 batch로 확정한다.
- [ ] account deletion/financial retention이 새 purchase table과 ledger 연결을 보존하거나 anonymize하도록 기존 정책에 맞춘다.
- [ ] Paddle/기존 Play/Toss AI credit 회귀와 typecheck를 통과시킨다.

Run: `node --test worker/tests/paddleAiCredit.test.mjs worker/tests/webAiCreditBillingRoutes.test.mjs worker/tests/googlePlayRtdnRoute.test.mjs worker/tests/accountDeletionCompleteness.test.mjs worker/tests/oauthAccountDeletionSafety.test.mjs && npm run typecheck:worker`

Expected: 전체 통과.

- [ ] 이 태스크에서 실제 수정한 파일만 명시해 커밋한다.

### Task 10: 재대사 cron·운영 runbook·sandbox 출시 gate

**Files:**
- Create: `worker/cron/paddle-reconciliation.ts`
- Create: `worker/ops/paddle-billing-runbook.md`
- Create: `worker/ops/paddle-billing-monitor.sql`
- Modify: `worker/index.ts`
- Modify: `worker/README.md`
- Modify: `worker/tests/paddleBillingReconciliation.test.mjs`
- Modify: `worker/tests/webBillingRoutes.test.mjs`

- [ ] cron tests에 retry backoff, inbox lease, stale processing recovery, max attempt/manual review, active Paddle subscription 주기 대사, 한 family 오류 격리를 먼저 작성한다.
- [ ] app foreground/status route가 마지막 대사 6시간 초과 시 비동기 재조회하되 응답을 무기한 막지 않고 기존 entitlement를 임의 연장하지 않는 사례를 추가한다.
- [ ] 기존 Toss 신규 checkout cutover 테스트에 `PADDLE_LIVE_APPROVED=false → Toss 신규도 열지 않음`, `true+rollout flag → Paddle only`, legacy Toss management unchanged를 추가한다.
- [ ] 테스트를 실행해 cron/cutover 정책 부재로 실패하는지 확인한다.

Run: `node --test worker/tests/paddleBillingReconciliation.test.mjs worker/tests/webBillingRoutes.test.mjs`

Expected: cron lease 또는 cutover 단언 실패.

- [ ] scheduled handler에서 pending/retry inbox와 active Paddle subscriptions를 bounded batch로 처리한다. cursor/attempt/next_retry_at을 저장하고 429 `Retry-After`를 존중한다.
- [ ] `worker/ops/paddle-billing-monitor.sql`은 secret/raw IDs를 출력하지 않고 상태별 개수, oldest retry age, conflict/manual review count, reconciliation lag만 집계한다.
- [ ] runbook에 실제 Paddle 수수료·승인 환불·AI 변동원가를 해시된 source ref로 `revenue_cost_ledger_v2`에 적재하고 `[period_start,period_end)` coverage를 `revenue_cost_coverage_v2`에 기록하는 운영 절차를 넣는다. 추정 비율이나 webhook 원문으로 비용을 만들지 않는다.
- [ ] runbook에 다음 순서를 정확히 기록한다: 외부 승인 증거 → sandbox catalog/domain/webhook → local D1 v2 dry-run → v1/v2 row 검증 → Worker schema readiness → sandbox E2E → operator secret 입력 → production migration 승인 → Worker 배포 → PWA rollout → Toss 신규 판매 종료.
- [ ] rollback은 checkout `accepting:false`로 신규 판매만 닫고 기존 entitlement/Play/Toss 관리/Paddle webhook 수신·대사는 유지하도록 한다. v2 table을 drop하거나 기존 Paddle entitlement를 Toss로 바꾸지 않는다.
- [ ] 공식 Paddle simulator/sandbox로 month/year trial/no-trial, renewal, cancel, past_due, full/partial adjustment, duplicate/out-of-order webhook, AI pack을 검증하고 event/transaction ID는 해시/마스킹된 evidence에만 기록한다.
- [ ] 이 구현 시점의 Paddle 공식 AUP, webhook signature, pricing preview, customer portal 문서를 runbook에 날짜와 함께 링크하고 live approval 증거가 비어 있으면 release gate를 실패시킨다.
- [ ] 전체 검증을 실행한다.

Run: `npm run typecheck && npm run test && npm run build && npm run typecheck:worker && npm run test:worker`

Expected: 모두 exit 0.

- [ ] Android 단위/assemble/lint에서 외부 결제 CTA가 없고 Play Billing 회귀가 통과하는지 확인한다.

Run:

```powershell
Push-Location android
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
$gradleExit = $LASTEXITCODE
Pop-Location
if ($gradleExit -ne 0) { exit $gradleExit }
```

Expected: 모두 `BUILD SUCCESSFUL`.

- [ ] production migration/secret/deploy/live charge/store upload 없이 sandbox readiness 결과만 커밋한다. 사용자 기존 staged/unstaged 파일은 commit에 포함하지 않는다.

### Completion Gate

- [ ] Paddle live approval·domain·product·price 증거가 없으면 production `accepting`은 반드시 false다.
- [ ] Play Android에 외부 결제 CTA/URL이 없고 PWA 신규 결제는 승인된 Paddle만 사용한다.
- [ ] 세 공급자의 reservation/trial v2 정본이 migration된 모든 legacy row를 보존하고 가족당 하나만 허용한다.
- [ ] browser checkout callback만으로 entitlement나 AI credit이 변하지 않는다.
- [ ] webhook raw signature·timestamp·replay 검증과 Paddle API 재조회가 모두 통과해야 권한을 갱신한다.
- [ ] duplicate/out-of-order/missing webhook, cancel, past_due, full/partial refund가 sandbox tests에서 정확히 수렴한다.
- [ ] 기존 Toss 가족의 갱신·해지·환불 및 Google Play 신규/복원 경로가 유지된다.
- [ ] client/log/analytics에 API key, webhook secret, portal token, payment method, raw transaction payload가 없다.
- [ ] production D1/secret/deploy/live 결제/store에는 변화가 없다.

## Implementation References

- Paddle webhook signature: `https://developer.paddle.com/webhooks/about/signature-verification`
- Paddle webhook delivery: `https://developer.paddle.com/webhooks/about/respond-to-webhooks`
- Paddle PricePreview: `https://developer.paddle.com/api-reference/pricing-preview/preview-prices`
- Paddle.js wrapper: `https://developer.paddle.com/sdks/libraries/paddle-js-wrapper`
- Paddle Customer Portal session: `https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session`
- Paddle adjustments: `https://developer.paddle.com/build/transactions/create-transaction-adjustments`
- Paddle AUP guidance: `https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle`
