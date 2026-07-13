# 출시 차단 조건 마무리 설계

작성일: 2026-07-13  
대상: `hyeni-3` 앱 + `hyeni-1/worker` 백엔드  
상태: 사용자 승인(리뷰 티어 위치 15분 지연, 권장안 2)

## 1. 목표와 범위

출시 직전 남은 차단 조건을 다음 범위로 닫는다.

1. 리뷰 혜택 티어의 위치를 서버에서 실제로 15분 지연한다.
2. 위치 조회 역할을 격리해 아이 세션이 형제 위치를 조회하지 못하게 한다.
3. 부모 무료 티어에서 기존 `store_visit` 리뷰 혜택을 안전하게 받을 수 있게 한다.
4. Google Play 자동 갱신을 앱 foreground에만 의존하지 않도록 RTDN 수신 기반을 구현한다.
5. Billing 상품 미조회 원인을 진단 가능하게 만들고 Qonversion 상태를 정직하게 표시한다.

범위에서 제외한다.

- 30일 이동경로 메뉴와 기타 위치 기능 추가
- 위치 수집 주기 단축 또는 배터리 정책 변경
- Qonversion SDK 도입 또는 결제 정본 전환
- Play Console, Google Cloud, Cloudflare secret의 사용자 권한이 필요한 외부 설정 변경
- 스토어 업로드와 프로덕션 출시

## 2. 위치 티어와 역할 격리

### 2.1 서버 단일 판정

`isLocationVisibleForFamily(): boolean`을 `resolveLocationAccessMode()`로 교체하고 다음 세 상태를 반환한다.

- `locked`: 무료 부모
- `delayed`: 리뷰 혜택 부모
- `realtime`: 유효한 체험 또는 프리미엄 부모

판정 순서는 현재 정본을 유지한다.

1. `family_subscription`의 유효한 `trial/active/grace/cancelled paid-through-expiry`
2. `families.user_tier/subscription_tier` 레거시 프리미엄
3. `family_review_rewards.granted_at`
4. 그 외 무료

판정 DB 오류 시 최신 위치를 fail-open으로 누설하지 않는다. 위치 조회 API는 `503 location_entitlement_unavailable`을 반환한다. SOS·긴급·위험구역·도착 알림 생성은 이 조회 API를 사용하지 않으므로 영향받지 않는다.

### 2.2 `/api/location/children`

역할별 응답은 다음과 같다.

- 부모 `realtime`: 활성 아이의 기존 `child_locations` 최신값
- 부모 `delayed`: 서버 현재 시각보다 15분 이전인 `location_history`에서 활성 아이별 가장 최근 실측점
- 부모 `locked`: 빈 배열
- 아이: 티어와 무관하게 인증 사용자 본인의 위치 한 건만 반환
- 선생님·anonymous: `403`

지연 위치는 `is_estimated IS NULL OR is_estimated=0`인 실측 기록만 사용하고 `recorded_at AS updated_at`, `accuracy_m`을 기존 `ChildLocation` 응답 형태로 반환한다. cutoff 이전 점이 없으면 최신점을 대신 노출하지 않고 빈 배열로 응답한다. 서버 시각을 기준으로 해 클라이언트 시계 조작을 허용하지 않는다.

### 2.3 `/api/location/history`

- 부모 `realtime`만 기존 이력 반환
- 부모 `delayed/locked`는 빈 배열
- 아이·선생님·anonymous는 빈 배열 또는 `403`으로 역할을 차단한다.

오늘 경로 UI는 이미 프리미엄 전용이지만 서버에서도 직접 호출 우회를 차단한다. 위치 인시던트는 부모 전용으로 제한해 아이가 형제 인시던트를 조회하지 못하게 하되, 무료 안전 기능이므로 부모 티어와 무관하게 기존 가족 격리와 활성 아이 필터를 유지한다.

## 3. 리뷰 혜택 획득

Worker의 기존 `POST /api/review-rewards` 계약을 바꾸지 않는다. 서버가 인증 부모의 본인 가족 여부를 검증하고 `parent_id`를 토큰 `sub`로 고정한다.

앱에는 다음만 추가한다.

1. `claimReviewReward(familyId)` endpoint. body에는 `familyId`만 포함한다.
2. 부모·인증 완료·가족 확정·무료 티어에서만 실행 가능한 mutation.
3. 성공 즉시 리뷰 보상 query cache를 `{ rewarded: true }`로 갱신한다.
4. 부모 설정에 `스토어 방문 혜택 받기` 행을 노출한다. 평점·리뷰 작성의 대가처럼 안내하지 않는다.
5. 연속 탭은 mutation pending으로 한 번만 처리한다.
6. 서버 지급 성공 후 혜택 문구를 알리고 Play Store HTTPS listing을 연다.
7. 서버 실패 시 성공 문구와 스토어 이동을 실행하지 않는다.

혜택은 기존 계약 그대로 일정 3개·저장 장소 3개이며, 실시간 위치·이동경로·주변소리·다자녀 등 프리미엄 기능은 열지 않는다. 기존 자동 리뷰 팝업과 전역 localStorage 규칙은 이관하지 않는다.

## 4. Google Play RTDN

### 4.1 정본과 인증

Google Play 직접 검증 경로를 결제 정본으로 유지한다. Qonversion은 사용하지 않는 보조 경로로 둔다.

`POST /api/billing/google-play-rtdn`은 Pub/Sub 인증 push만 허용한다.

- Google OIDC JWT 서명 검증
- `iss`, `aud`, `exp`, `email_verified`, 허용 service-account email 검증
- base64 Pub/Sub envelope와 RTDN payload 구조 검증
- package name `com.hyeni.calendar` 검증

RTDN의 notification type만으로 상태를 바꾸지 않는다. purchase token으로 `purchases.subscriptionsv2.get`을 다시 호출하고 기존 구독 상태 매핑·상품/base plan 검증을 재사용한다.

### 4.2 소유자 매핑과 멱등

추가 D1 테이블은 파괴적 변경 없이 `CREATE TABLE/INDEX IF NOT EXISTS`로 만든다.

- RTDN `messageId` 멱등 기록
- obfuscated account/profile ID와 가족·부모 매핑
- purchase token hash와 linked purchase token hash 매핑

최초 앱 검증 성공 시 owner mapping을 저장한다. RTDN은 다음 순서로 가족을 찾는다.

1. 현재 purchase token hash
2. `linkedPurchaseToken` hash
3. Play가 검증해 반환한 obfuscated account/profile ID

소유자·package·product·base plan 불일치 시 entitlement를 변경하지 않는다. Google OAuth/API의 일시 실패는 비-2xx로 반환해 Pub/Sub 재시도를 보존한다. 중복 messageId는 이미 성공 처리된 경우에만 멱등 성공한다.

### 4.3 운영 미설정 상태

필수 secret 또는 OIDC 설정이 없으면 route는 `503`으로 fail-closed한다. 운영 권한이 준비되기 전 배포해도 기존 결제/위치/알림 동작을 바꾸지 않는다.

실제 활성화에는 사용자가 다음을 완료해야 한다.

- Android Publisher API 활성화
- 서비스 계정 Play Console 권한 부여
- Worker 서비스 계정 secret 등록
- Pub/Sub topic·인증 push subscription 생성
- Play Console RTDN 연결과 테스트 메시지 발송
- A17 계정 license tester 등록 또는 내부 테스트 트랙 설치

## 5. Billing 진단과 Qonversion

Android Billing Library 9의 `UnfetchedProduct` 상태를 JS 결과에 포함해 `PRODUCT_NOT_FOUND`, `NO_ELIGIBLE_OFFER` 등을 구분한다. 사용자 화면에는 민감한 원문을 노출하지 않고 개발 로그/진단 결과만 구조화한다.

Qonversion SDK와 런타임 사용이 없으므로 직접 Google 경로를 유지한다. webhook health는 secret이 없을 때 `configured:false`를 반환하도록 바로잡는다. 현재 공식 인증 계약과 다른 HMAC 경로를 활성 결제 경로처럼 안내하지 않는다.

## 6. 오류 처리와 안전 불변식

- access/refresh token 원문을 로그나 테스트 출력에 남기지 않는다.
- RTDN과 결제 검증은 secret이 없을 때 임의 승인하지 않는다.
- 위치 cutoff 이전 기록이 없으면 최신 위치를 대신 반환하지 않는다.
- 리뷰 지급 실패를 로컬 플래그로 우회하지 않는다.
- SOS·긴급·위험구역·도착 알림은 티어와 무관하게 유지한다.
- 위치 수집 주기와 Android foreground service는 변경하지 않는다.
- 프로덕션 D1 변경은 추가형 migration만 사용하고 기존 행을 삭제·수정하지 않는다.

## 7. 검증 전략

테스트를 먼저 실패시키고 최소 구현으로 통과시킨다.

1. Worker 위치 모드·15분 cutoff·역할 격리 단위/라우트 테스트
2. 앱 리뷰 claim scope·POST body·cache·중복 탭·실패 동작 테스트
3. RTDN OIDC/payload/messageId/owner mapping/Play 상태별 테스트
4. Billing unfetched 상태와 Qonversion health 회귀 테스트
5. 앱 전체 typecheck/build/tests
6. Worker 전체 typecheck/tests
7. additive D1 migration 로컬 검증 후 원격 스키마 존재 확인
8. Worker와 Pages 배포
9. Android sync/assemble/install A17
10. A17 CDP로 부모 세션·리뷰 CTA·기존 홈/위치 화면 오류 없음 확인

razr는 연결 해제 상태이므로 최종 아이 실기기 E2E는 미검증으로 분리한다. 세션·페어링·위치 업로드 토큰을 외부에서 조작하지 않는다.
