# 출시 차단 조건 마무리 구현 계획

> 승인 설계: `docs/plans/2026-07-13-release-blockers-design.md`

## Task 1. 위치 티어 모드와 15분 지연 테스트

**파일**

- 수정: `C:/Users/TK/Desktop/hyeni-1/worker/db/authz.ts`
- 수정: `C:/Users/TK/Desktop/hyeni-1/worker/routes/location.ts`
- 신규/수정: `C:/Users/TK/Desktop/hyeni-1/worker/tests/locationTierAccess.test.mjs`

**절차**

1. free/reviewed/premium, entitlement DB 오류, parent/child/teacher 역할 케이스를 먼저 테스트한다.
2. `resolveLocationAccessMode()`를 구현한다.
3. reviewed `/children`이 `now-15분` 이전의 아이별 최신 실측점만 반환하게 한다.
4. reviewed/free `/history`를 빈 배열로, child는 본인 위치만 반환하게 한다.
5. `/incidents`는 부모 전용으로 제한해 형제 인시던트 누설을 막는다.
6. 기존 위치 정확도·이력 테스트와 함께 실행한다.

## Task 2. 리뷰 혜택 획득 테스트와 클라이언트 배선

**파일**

- 수정: `src/lib/api/endpoints/reviewReward.ts`
- 수정: `src/queries/keys.ts`
- 수정: `src/queries/useReviewReward.ts`
- 신규: `src/lib/native/review.ts`
- 수정: `src/screens/parent/ParentSettings.tsx`
- 필요 시 수정: `src/screens/parent/ParentSettings.css`
- 신규/수정: `tests/reviewRewardClaim.test.ts`
- 수정: `tests/reviewRewardScope.test.ts`

**절차**

1. parent/free/auth/family scope와 POST body 테스트를 먼저 추가한다.
2. query key를 단일 출처로 옮기고 claim mutation을 구현한다.
3. 성공 cache 갱신, 실패 스토어 미이동, 연속 탭 1회 테스트를 추가한다.
4. 부모 설정의 기존 메뉴 행 패턴으로 CTA를 배선한다.
5. reviewed/premium/unknown/child/teacher 미노출을 검증한다.

## Task 3. Google Play 공통 검증 함수 추출

**파일**

- 신규: `C:/Users/TK/Desktop/hyeni-1/worker/lib/googlePlay.ts`
- 수정: `C:/Users/TK/Desktop/hyeni-1/worker/routes/google-play-verify.ts`
- 수정: `C:/Users/TK/Desktop/hyeni-1/worker/shared/googlePlaySubscription.js`
- 신규/수정: `C:/Users/TK/Desktop/hyeni-1/worker/tests/googlePlayShared.test.mjs`

**절차**

1. 기존 service-account JWT, OAuth, `subscriptionsv2.get`, SHA-256 동작 특성을 고정하는 테스트를 추가한다.
2. route 내부 함수를 공통 모듈로 최소 추출한다.
3. 기존 구매 검증 테스트가 동일하게 통과하는지 확인한다.

## Task 4. RTDN OIDC 인증과 payload 검증

**파일**

- 신규: `C:/Users/TK/Desktop/hyeni-1/worker/lib/googleOidc.ts`
- 신규: `C:/Users/TK/Desktop/hyeni-1/worker/lib/googlePlayRtdn.ts`
- 수정: `C:/Users/TK/Desktop/hyeni-1/worker/types.ts`
- 신규: `C:/Users/TK/Desktop/hyeni-1/worker/tests/googlePlayRtdnAuth.test.mjs`

**절차**

1. 설정 누락, JWT alg/kid/signature/iss/aud/exp/iat/email/email_verified 오류 테스트를 먼저 추가한다.
2. Google OIDC JWKS를 WebCrypto로 검증하고 `kid` 미발견 시 1회 갱신한다.
3. Pub/Sub envelope·base64 RTDN·package/test/subscription payload를 순수 함수로 검증한다.
4. tokeninfo 의존과 access/purchase token 로그가 없는지 확인한다.

## Task 5. RTDN 스키마·멱등·라우트

**파일**

- 신규: `C:/Users/TK/Desktop/hyeni-1/worker/db/google-play-rtdn-schema.sql`
- 신규: `C:/Users/TK/Desktop/hyeni-1/worker/routes/google-play-rtdn.ts`
- 수정: `C:/Users/TK/Desktop/hyeni-1/worker/routes/google-play-verify.ts`
- 수정: `C:/Users/TK/Desktop/hyeni-1/worker/index.ts`
- 수정: `C:/Users/TK/Desktop/hyeni-1/worker/types.ts`
- 신규: `C:/Users/TK/Desktop/hyeni-1/worker/tests/googlePlayRtdnRoute.test.mjs`

**절차**

1. 중복 messageId, 처리 lease, retryable Google 오류, 미매핑 owner, linked token, owner 불일치 테스트를 먼저 추가한다.
2. additive schema와 owner mapping 저장을 구현한다.
3. Play 재조회 성공 전에는 message를 완료 처리하지 않는다.
4. 현재/linked token/obfuscated ID 순서의 owner lookup을 구현한다.
5. 상태 매핑 후 `family_subscription`과 realtime notify를 기존 계약대로 갱신한다.
6. 설정 누락 503과 Google 5xx 재시도를 검증한다.

## Task 6. Billing 상품 미조회 진단

**파일**

- 수정: `android/app/src/main/java/com/hyeni/calendar/GooglePlayBillingPlugin.java`
- 수정: `src/lib/native/billing.ts`
- 수정: `tests/subscriptionOfferPolicy.test.mjs` 또는 신규 진단 테스트
- 필요 시 수정: Android unit test

**절차**

1. Billing 9 `UnfetchedProduct` 상태를 잃는 현재 동작을 재현하는 테스트를 추가한다.
2. 상품·구독 조회 결과에 민감정보 없는 `unfetchedProducts` 배열을 포함한다.
3. 기존 `products/offers/purchases` 응답을 깨지 않게 optional 필드로 추가한다.

## Task 7. Qonversion 상태 정직화

**파일**

- 수정: `C:/Users/TK/Desktop/hyeni-1/worker/routes/qonversion-webhook.ts`
- 수정: `C:/Users/TK/Desktop/hyeni-1/worker/tests/subscriptionEntitlementSecurity.test.mjs`
- 수정: `.env.example` 또는 운영 문서

**절차**

1. secret 누락 GET health가 `configured:false`여야 한다는 실패 테스트를 추가한다.
2. 실제 secret 존재 여부를 반영하고 unsigned/HMAC 임의 승인은 계속 금지한다.
3. Qonversion이 활성 결제 정본이 아님을 문서화한다.

## Task 8. 문서 동기화

**파일**

- 수정: `AGENTS.md`
- 수정: `CLAUDE.md`
- 수정: `C:/Users/TK/Desktop/hyeni-1/worker/README.md`
- 수정: `docs/store/play-release-checklist.md`

**절차**

1. 15분 지연·역할 격리·RTDN fail-closed·Google 직접 결제 정본을 양쪽 문서에 동일하게 반영한다.
2. 외부 콘솔 작업과 미검증 상태를 분리한다.

## Task 9. 전체 검증·배포·설치

1. 앱 관련 테스트 → 전체 테스트 → `npm run typecheck` → `npm run build`.
2. Worker 관련 테스트 → 전체 테스트 → `npx tsc --noEmit`.
3. D1 migration을 로컬 적용·쿼리 검증 후 비파괴 원격 적용 및 `pragma_table_info` 확인.
4. Worker 배포 후 health, 위치 티어, Qonversion health, RTDN 미설정 503 스모크.
5. 앱 변경 커밋·푸시, Worker 변경 커밋·푸시.
6. Pages 배포.
7. `npx cap sync android`, Gradle debug 빌드, A17 `install -r`.
8. CDP에서 부모 role/family 정본, 콘솔 오류 0, 주요 화면 렌더를 확인한다.
9. razr 미연결과 Play Console 외부 설정 미완료를 최종 보고에서 별도 명시한다.
