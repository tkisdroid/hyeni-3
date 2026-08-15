# Global Version Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 글로벌 버전 명세를 기존 한국 실사용 가족·세션·결제·안전 기능을 보존하면서 10개 언어, 국가별 시간대·지도, Android Play/PWA Paddle 결제, 다국어 Store 제출 묶음까지 순서대로 구현한다.

**Architecture:** 하나의 React PWA/Capacitor Android 코드베이스 위에 공용 locale 카탈로그를 두고, Android resource와 Worker 알림·법적 페이지·Store 자료를 생성한다. 사용자 언어는 기기별, 가족 국가·시간대는 가족별, 알림 언어는 endpoint별로 분리한다. 결제는 Google Play·Paddle·기존 Toss가 공급자 직접 검증 후 v2 공급자 선점을 거쳐 `family_subscription` 정본으로 합류한다.

**Tech Stack:** Vite 7, React 19, TypeScript strict, React Intl/FormatJS, Capacitor 8 Android, Java/Android resources, Hono Cloudflare Worker, D1, Mapbox GL/Search/Directions, Kakao Maps, Google Play Billing, Paddle Billing, Node test runner, JUnit, Playwright/CDP

## Global Constraints

- 모든 구현·주석·커밋 메시지는 한국어로 작성한다. 코드 식별자와 안정적인 API error code는 원문을 유지한다.
- 정본 설계는 `docs/superpowers/specs/2026-08-15-global-version-design.md`다. 이 계획과 충돌하면 설계를 우선하고 계획을 먼저 고친다.
- 기존 사용자 변경으로 보이는 staged 삭제와 `output/store-ui-candidates-v1/` 변경을 수정·unstage·커밋하지 않는다. 태스크 커밋은 항상 정확한 경로를 `git commit --only`로 제한한다.
- 구현 시작 시 현재 worktree가 dirty이면 `superpowers:using-git-worktrees`를 사용해 이 계획 commit에서 격리된 worktree를 만들고 그 안에서만 구현한다. 사용자 변경을 clean/reset/stash하거나 새 worktree로 복사하지 않는다.
- 운영 D1 migration, Worker/Pages 배포, Paddle live 전환, Play Console 업로드·게시는 이 계획 실행 권한에 포함하지 않는다. 로컬 D1·sandbox·preview·Play license tester까지만 수행한다.
- refresh token은 읽기·출력·복사·회전하지 않는다. 기존 세션·역할·가족·페어링을 초기화하지 않는다.
- 최종 Android 실기기 검증은 A17 `RFKL40DP73J` 부모와 razr `ZY22H9VTQD` 아이만 `adb install -r`로 수행한다. S25에는 설치·실행·로그·세션 조회를 포함해 접근하지 않는다.
- 위치·SOS·주변소리·force ring·pending ACK·quiet hours·메모 permit·active child/member id·0-index 비패딩 `date_key` 계약을 변경하지 않는다.
- 한국 기존 가족은 `ko`, `KR`, `Asia/Seoul`, Kakao, 기존 Play/Toss 동작이 기준선이다. 신규 글로벌 기능 실패가 기존 entitlement나 안전 기능을 닫아서는 안 된다.
- TDD를 지킨다. 각 태스크는 실패 테스트 확인 → 최소 구현 → 관련 회귀 → 커밋 순서다.
- 모든 여러 줄 `Run` 블록은 각 명령 직후 exit code 0을 확인하고, 한 줄이라도 nonzero이면 다음 명령으로 진행하지 않는다.
- 하위 계획은 논리적으로 분기되지만 `cloudflare/schema_d1.sql`, `worker/index.ts`, `worker/lib/healthReadiness.ts`, locale catalog와 설정 화면을 공유한다. 같은 worktree에서는 Task 2→3→4→5→6 순서로 직렬 실행하고 병렬 편집하지 않는다.

---

## File Structure

- `docs/superpowers/plans/2026-08-15-global-version-program.md` — 전체 의존성, 중간 산출물, 운영 차단선
- `docs/superpowers/plans/2026-08-15-global-i18n-web.md` — 10개 locale 정본, React runtime, UI·PWA 이관
- `docs/superpowers/plans/2026-08-15-global-native-notifications.md` — Android 앱별 언어, native resource, endpoint별 알림 현지화, AI 출력 언어
- `docs/superpowers/plans/2026-08-15-global-timezone-maps-auth.md` — 국가·IANA time zone, quiet hours, Kakao/Mapbox 추상화, 해외 로그인
- `docs/superpowers/plans/2026-08-15-global-paddle-billing.md` — Paddle checkout/webhook/대사와 Play·Toss 공급자 충돌 방지
- `docs/superpowers/plans/2026-08-15-global-content-store-release.md` — 번역 검수, 법적 페이지, Play listing·스크린샷·출시 증거

실행 의존성은 다음과 같다.

```text
글로벌 i18n 기반
  ├─→ Android·Worker 알림 현지화 ─┐
  ├─→ 국가·시간대·지도·로그인 ───┼─→ 콘텐츠·법적·Store 묶음 ─→ 최종 검증
  └─→ Paddle 글로벌 결제 ─────────┘
```

위 도식은 의존성 표현이며 병렬 실행 허가가 아니다. 구현 commit은 아래 Task 번호 순서로 직렬화한다.

### Task 1: 기준선과 작업 보호 상태 고정

**Files:**
- Verify only: `AGENTS.md`
- Verify only: `CLAUDE.md`
- Verify only: `docs/superpowers/specs/2026-08-15-global-version-design.md`
- Verify only: `package.json`
- Create during execution: `artifacts/global-release/{40자리-git-sha}/baseline.json` (gitignored 검증 산출물)

- [ ] **Step 1: 사용자 변경 보호 목록을 기록한다**

Run:

```powershell
git status --short
git diff --cached --name-status
git diff --name-status
```

Expected: 계획 작성 전부터 존재하던 staged 삭제와 `output/store-ui-candidates-v1/` 수정이 보인다. 이 목록을 이후 커밋 범위와 분리한다.

- [ ] **Step 2: 앱·Worker·Android 기준선을 검증한다**

현재 worktree가 dirty이면 먼저 `superpowers:using-git-worktrees` 절차로 격리된 clean worktree를 만들고, 아래 검증과 이후 구현은 그 worktree에서 실행한다. 원래 worktree의 staged/unstaged 상태는 직전 snapshot과 byte-for-byte 같아야 한다.

Run:

```powershell
npm run typecheck
npm test
npm run build
npm run typecheck:worker
npm run test:worker
Push-Location android
.\gradlew.bat test lint assembleDebug
Pop-Location
```

Expected: 모두 exit 0. 기존 실패가 있으면 글로벌 구현을 시작하지 않고 실패 명령·테스트명·현재 commit을 별도 기록한다.

- [ ] **Step 3: 기준선 결과를 gitignored artifact에 저장한다**

`baseline.json`에는 다음 비민감 필드만 기록한다.

```json
{
  "appCommit": "40자리 Git SHA",
  "appTests": "passed",
  "workerTests": "passed",
  "androidTests": "passed",
  "productionBuild": "passed",
  "capturedAt": "UTC ISO timestamp"
}
```

토큰, 계정, 가족 ID, 기기 세션과 D1 행은 기록하지 않는다.

### Task 2: 공용 locale 기반과 React/PWA 이관

**Plan:** `docs/superpowers/plans/2026-08-15-global-i18n-web.md`

- [ ] **Step 1: 하위 계획 Task 1~4를 실행해 locale 정본과 runtime을 만든다**

Gate:

```powershell
node --test tests/localeNormalization.test.ts tests/i18nCatalogContract.test.mjs tests/localeRuntime.test.ts
npm run typecheck
```

Expected: 10개 locale, 영어→한국어 폴백, 기기별 저장, Provider의 Auth 바깥 배치가 통과한다.

- [ ] **Step 2: 하위 계획 Task 5~9를 실행해 모든 React route와 PWA metadata를 이관한다**

Gate:

```powershell
node scripts/i18n/validate-catalogs.mjs
node scripts/i18n/scan-user-facing-literals.mjs
node scripts/i18n/scan-client-error-surfaces.mjs
npm test
npm run build
```

Expected: 허용 목록 밖 사용자 노출 한국어·고정 `ko-KR`가 없고, 10개 언어 카탈로그 parity와 route bundle/PWA precache 검사가 통과한다.

### Task 3: Android와 Worker 알림을 endpoint 언어로 현지화

**Plan:** `docs/superpowers/plans/2026-08-15-global-native-notifications.md`

- [ ] **Step 1: Android locale resource·bridge 태스크를 완료한다**

Gate:

```powershell
node scripts/i18n/generate-android-locales.mjs --check
Push-Location android
.\gradlew.bat test lint assembleDebug
Pop-Location
```

Expected: 10개 언어 resource, `localeConfig`, 앱별 언어 bridge, Java 사용자 문구 scanner가 통과한다.

- [ ] **Step 2: endpoint locale migration과 구조화 알림 태스크를 완료한다**

Gate:

```powershell
node --test worker/tests/notificationEndpointLocale.test.mjs worker/tests/notificationMessageCatalog.test.mjs worker/tests/localizedNotificationDelivery.test.mjs
npm run typecheck:worker
npm run test:worker
```

Expected: 같은 사용자에게 연결된 서로 다른 locale endpoint가 각 언어로 알림을 받고, 구버전 title/body와 ACK·target·quiet-hours 계약이 유지된다.

### Task 4: 국가·시간대·지도·해외 로그인을 활성화

**Plan:** `docs/superpowers/plans/2026-08-15-global-timezone-maps-auth.md`

- [ ] **Step 1: 기존 가족 backfill과 신규 가족 지역 설정을 로컬 D1에서 검증한다**

Gate:

```powershell
node --test tests/regionPolicy.test.ts tests/timeZonePolicy.test.ts worker/tests/globalFamilyContextMigration.test.mjs worker/tests/familyRegionRoutes.test.mjs worker/tests/notificationTimeZone.test.mjs
npm run typecheck:worker
```

Expected: 기존 행은 `KR/Asia/Seoul`, 신규 행만 명시 국가/IANA time zone을 사용하며 KST 기준선 결과가 변하지 않는다.

- [ ] **Step 2: Kakao 회귀 뒤 Mapbox 해외 fixture를 검증한다**

Gate:

```powershell
node --test tests/mapProvider.test.ts tests/mapConsumerWiring.test.mjs worker/tests/mapboxRoutes.test.mjs
npm run build
```

Expected: KR은 Kakao, JP/TW/HK/SG/VN/TH/ID/MY/PH는 Mapbox가 선택되고 provider 장애와 위치 없음이 분리된다.

- [ ] **Step 3: 로그인 가용성 매트릭스를 검증한다**

Gate:

```powershell
node --test tests/globalAuthAvailability.test.ts tests/onboardingAuthAdoption.test.ts tests/onboardingSessionGuard.test.mjs worker/tests/oauthRouteSecurity.test.mjs
npm run typecheck
```

Expected: Google은 글로벌 기본, +82 OTP·Kakao·Naver는 KR에서만 보조로 보이며 아이 페어링 동선은 동일하다.

### Task 5: Paddle sandbox 결제와 단일 entitlement를 완성

**Plan:** `docs/superpowers/plans/2026-08-15-global-paddle-billing.md`

- [ ] **Step 1: v2 공급자·체험·Paddle schema와 pure 보안 모듈을 완료한다**

Gate:

```powershell
node --test worker/tests/paddleBillingV2Migration.test.mjs worker/tests/paddleWebhookSignature.test.mjs worker/tests/googlePlayShared.test.mjs worker/tests/webBillingRoutes.test.mjs
npm run typecheck:worker
```

Expected: 기존 테이블을 drop/rebuild하지 않고 Paddle을 포함한 v2 정본이 기존 Play/Toss 행을 보존한다.

- [ ] **Step 2: checkout/webhook/portal/refund/AI credit sandbox 경로를 완료한다**

Gate:

```powershell
node --test worker/tests/paddleBillingRoutes.test.mjs worker/tests/paddleBillingReconciliation.test.mjs worker/tests/paddleAiCredit.test.mjs worker/tests/familyEntitlementResolver.test.mjs
node --test tests/paddleBilling.test.ts tests/paddleBillingWiring.test.mjs tests/androidExternalBillingPolicy.test.mjs
npm run typecheck
npm run typecheck:worker
```

Expected: checkout UI 완료만으로 권한이 열리지 않고, 서명 webhook+API 재조회 뒤에만 entitlement/credit이 갱신된다. Android Play 화면에는 외부 결제 CTA가 없다.

- [ ] **Step 3: sandbox와 Play/Toss 충돌 시나리오를 실행한다**

Expected: Play active 가족의 Paddle 시작, Toss active 가족의 Paddle 시작, Paddle reserved 중 Play 구매를 모두 차단 또는 `manual_review` conflict로 격리하며 자동 덮어쓰지 않는다.

### Task 6: 번역·법적·Store 제출 묶음을 생성

**Plan:** `docs/superpowers/plans/2026-08-15-global-content-store-release.md`

- [ ] **Step 1: 10개 locale 콘텐츠와 검수 상태를 생성한다**

Gate:

```powershell
node scripts/i18n/validate-catalogs.mjs --require-complete
node scripts/content/validate-review-status.mjs --minimum=draft
```

Expected: 모든 메시지는 존재한다. 원어민/법률 검수가 필요한 A/B 콘텐츠는 실제 승인이 없으면 `approved`로 위조하지 않는다.

- [ ] **Step 2: 법적 페이지와 Play 제출 JSON·문서를 생성한다**

Gate:

```powershell
node --test worker/tests/legalLocaleRoutes.test.mjs tests/globalLegalDisclosure.test.mjs tests/globalStorePack.test.mjs tests/globalStorePolicyPack.test.mjs
node scripts/store/validate-global-store-pack.mjs --mode preview
```

Expected: locale별 글자 제한·필수 필드가 통과하고, 미제공 사업자/법률 정보는 명시적인 차단 상태로 남는다.

- [ ] **Step 3: 실사용 데이터 없는 10개 locale screenshot 후보를 생성한다**

Run:

```powershell
npm run build
node scripts/store/create-global-store-assets.mjs
node scripts/store/scan-global-store-pii.mjs
node --test tests/globalStoreAssets.test.mjs tests/globalStorePii.test.mjs
```

Expected: `output/store-global-v1/`에만 생성되고 기존 `output/store-ui-candidates-v1/`는 byte-for-byte 변경되지 않는다. manifest에는 commit·locale·viewport·fixture·생성 시각이 있다.

### Task 7: 통합 회귀와 출시 차단선 판정

**Files:**
- Modify: `docs/store/play-release-checklist.md`
- Modify: `docs/store/global-release-checklist.md`
- Modify: `docs/store/global-reviewer-guide.md`
- Create when gates pass: `artifacts/global-release/{40자리-git-sha}/verification.json` (gitignored)

- [ ] **Step 1: 전체 로컬 회귀를 실행한다**

Run:

```powershell
npm run typecheck
npm test
npm run build
npm run typecheck:worker
npm run test:worker
Push-Location android
.\gradlew.bat test lint assembleDebug
Pop-Location
```

Expected: 모두 exit 0. 테스트 수는 실행 결과에서만 기록하고 계획의 과거 수치를 복사하지 않는다.

- [ ] **Step 2: 10개 locale 브라우저 행렬을 실행한다**

Run:

```powershell
node scripts/global-browser-qa.mjs --locales=ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil --viewports=320x800,390x844,448x998,844x390,1280x800 --font-scale=1,2
```

Expected: 핵심 route의 콘솔 오류·가로 overflow·잘린 CTA·빈 accessible name이 0건이다.

- [ ] **Step 3: 외부 승인 차단선을 판정한다**

다음 중 하나라도 충족되지 않으면 `HOLD`를 기록한다.

- Paddle seller/category/domain live 승인과 price allowlist
- Mapbox public/server token의 제한 설정과 비용 예산
- A/B 번역 원어민 검수, A 등급 법률 검수
- 사업자 법정 이름·주소·전화번호·지원 이메일과 일본 특정상거래법 검증
- Play Console 국가·상품·listing 운영자 확인
- 최신 clean commit 기반 사용자 직접 서명 AAB

- [ ] **Step 4: 승인 뒤에만 A17/razr 최종 검증을 수행한다**

Run only when both devices are connected and the user authorizes final device verification:

```powershell
adb -s RFKL40DP73J install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s ZY22H9VTQD install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Verify without logout, role switch, re-pairing, SOS, force ring, remote listen, or refresh-token access:

- A17 부모: locale 전환, 부모 홈, 위치, 알림 설정, 구독 공급자 상태
- razr 아이: 독립 locale, 아이 홈, 메시지, native 알림 resource, 위치 서비스 유지
- 두 기기: 같은 가족에서 서로 다른 언어 유지, 세션/페어링/활성 아이 유지

- [ ] **Step 5: 실제 게시 없이 최종 handoff를 만든다**

Expected: `GO`는 코드·sandbox·번역·법률·Store·서명·실기기 증거가 모두 있을 때만 사용한다. Play upload와 Paddle live switch는 운영자가 별도로 수행한다.
