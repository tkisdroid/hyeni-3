# 글로벌 locale 마감과 Google 지도 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 구축된 10개 locale 번역 체계를 유지한 채 잔여 품질 검증을 끝내고, 지도 관련 기능만 한국은 Kakao·승인된 중국 외 국가는 Google Maps로 전환하되 기존 GPS 수집·가족 위치 공유·SOS·지오펜스 동작을 보존한다.

**Architecture:** 지도와 무관한 화면은 현재 locale catalog와 formatter를 그대로 사용한다. 지도 렌더링·장소 검색·역지오코딩·도보 경로·외부 지도 링크만 `FamilyMap`과 인증된 `/api/maps/*` 경계로 모으고, 서버 정본 가족 국가로 `KR=kakao`, 저장 가능 ISO 비한국 국가=`google`, `ZZ`·비표준 코드=`unsupported`를 선택한다. 가족 현지 시간·DST 보정은 지도 교체와 섞지 않고 기존 글로벌 시간대 계획의 별도 출시 선행 gate로 유지한다.

**Tech Stack:** Vite 7 · React 19 · TypeScript strict · React Intl · Cloudflare Worker/D1 · Google Maps JavaScript API · Places API (New) · Geocoding API v4 · Routes API v2 · `@capacitor/google-maps@8.0.1` · Capacitor 8 Android

**Spec:** `docs/superpowers/specs/2026-08-26-global-google-maps-location-design.md`

> **2026-09-01 정책 개정:** TK의 최신 해외 오픈 지시에 따라 과거 `CN 미지원`·점진적 allowlist 문구를
> 대체한다. 공식 Google Maps 핵심 커버리지에 포함된 앱 저장 가능 ISO 249개국 중 `KR`만 Kakao로 유지하고
> 나머지 248개국은 Google로 연다. `ZZ`·형식 오류·비표준 코드는 미지원이며, 시간대/DST·Routes OAuth·실기기
> E2E의 해외 전체 출시 HOLD는 유지한다.

## Global Constraints

- 이 작업은 **비지도 기능 재개발이 아니다**. 비지도 화면은 번역·locale formatter·레이아웃 검증만 수행하고 기존 API·권한·구독·quiet hours·retention·quota·안전 동선을 바꾸지 않는다.
- 2026-08-26 기준 `npm run i18n:verify`는 10개 catalog, PWA manifest, Android locale, 사용자 노출 literal 잔여 0건으로 통과했다. 기존 locale runtime을 다시 만들거나 번역 파일을 일괄 재생성하지 않는다.
- 지도 변경 범위는 지도 렌더링, 장소 검색, 역지오코딩, 도보 경로, 외부 지도 링크와 이를 안전하게 선택하기 위한 가족 국가·자격·quota 경계다.
- 위치 GPS 수집, 위치 저장, FGS, SOS, 긴급 알림, 20m 장소 중복 정규화, dwell/leave timer, 10분 presence dedupe는 공급자와 독립된 기존 정본을 유지한다.
- 정책은 `KR → Kakao`, 저장 가능 ISO 비한국 국가 → `Google`, `ZZ/누락/비표준 코드 → country_unresolved`다. Google 실패를 Kakao·ORS·OSRM으로 우회하지 않는다.
- Google 자격이 아직 없으므로 Task 1~10은 키 미설정 fail-closed 상태로 완료한다. 자격 생성·결제 연결·secret 변경·운영 D1 migration·Pages/Worker/Play 배포는 이 계획 작성이나 자격 없는 구현 단계에서 수행하지 않는다.
- Google 로그인 OAuth, FCM, Google Play 결제 service account를 지도 service account나 지도 API key로 재사용하지 않는다.
- 기존 가족은 country migration 후에도 정확히 `KR`이다. IP·GPS·locale로 기존 가족 국가를 추정해 덮어쓰지 않는다.
- 가족 현지 시간·DST는 `docs/superpowers/plans/2026-08-15-global-timezone-maps-auth.md`의 **비지도 시간대 단계**를 별도 계획으로 정리·승인받은 뒤 실행한다. 그 gate가 끝나기 전 non-KR 국가를 출시하지 않으며, 이 문서에서는 `notification_settings`, quiet hours, 위치 이력 시간 경계, retention, quota, 일정/도착 시간 판정을 수정하지 않는다.
- 기존 `saved_places.id`, `academies.id`, `public_places.id`, `public_place_id`, `kakao_place_id`, `events.location`, 메모 `[[loc:...]]`를 파괴적으로 변경하거나 일괄 rewrite하지 않는다.
- Google 검색어·주소·응답·polyline·Place Details·Place ID는 D1 `edge_cache`, 앱 업무 테이블, 브라우저 저장소, 분석 이벤트, 운영 로그에 장기 보존하지 않는다. Place ID는 5분 autocomplete session과 1회 Details 선택 과정에서만 메모리/서명 handle로 사용한다.
- 현재 Mapbox 계획은 실행하지 않는다. `docs/superpowers/plans/2026-08-15-global-timezone-maps-auth.md`에서는 시간대 선행 계약만 참고하고 지도 단계는 이 문서가 대체한다.
- 실사용 A17 `RFKL40DP73J`, razr `ZY22H9VTQD`, S25 `R5CY521CFNZ`의 계정·역할·세션·페어링·가족 국가는 변경하지 않는다. 실API 국가 검증은 별도 테스트 가족과 fixture로 한다.
- 앱 테스트는 프로세스 exit code뿐 아니라 마지막 `ℹ fail 0`을 확인한다. 새 `tests/**` TypeScript 테스트는 첫 줄에 `tests/helpers/appModuleResolve.mjs`, 새 Worker 테스트는 첫 줄에 `worker/tests/helpers/tsModuleResolve.mjs`를 import한다.
- 각 Task는 해당 Task의 **Files**에 명시된 실제 변경 파일만 검토해 `git commit --only`의 개별 인자로 나열한다. 사용자의 미추적 `README.md`와 `artifacts/**`는 stage하지 않는다.

## 범위와 완료 상태

| 축 | 이번 계획의 실제 작업 | 하지 않는 일 |
|---|---|---|
| 비지도 locale | 새 지도 오류·경고 문구 10개 언어 추가, 기존 화면 번역 품질·overflow·접근성 QA | 기능 로직 재작성, 기존 번역 체계 재구축 |
| 지도 | Kakao 직접 결합을 공통 계약으로 감싸고 non-KR에 Google web/native 지도·검색·주소·도보 경로 제공 | 중국 지도 공급자, 턴바이턴 내비게이션 |
| 위치·안전 | 지도 장애와 분리됐는지 회귀 테스트로 고정 | GPS 수집·SOS·지오펜스·quiet hours·retention·quota 알고리즘 변경 |
| 출시 | 자격 없는 자동 검증과 자격 후 별도 국가 matrix | 자격 없이 글로벌 국가 활성화 |

## 계획된 파일 구조

```text
shared/
  mapPolicy.ts                         # 앱·Worker 단일 국가/공급자 표와 출시 allowlist
src/maps/
  contracts.ts                         # 공급자 중립 scene/controller/error 계약
  FamilyMap.tsx                        # 화면이 사용하는 유일한 지도 진입점
  mapErrors.ts
  persistence.ts                       # 임시 공급자 콘텐츠와 사용자 확정 핀의 타입 경계
  nativeSurface.ts
  providers/kakao/KakaoMapAdapter.tsx
  providers/google/GoogleWebMapAdapter.ts
  providers/google/GoogleNativeMapAdapter.ts
  providers/unsupported/UnsupportedMapAdapter.tsx
src/lib/api/endpoints/maps.ts           # /api/maps/* 클라이언트
src/queries/useMaps.ts
src/transform/familyCountryDisplay.ts   # locale별 가족 국가명 formatter
worker/lib/maps/
  types.ts
  service.ts
  google.ts
  kakao.ts
  googleOAuth.ts
  autocompleteSession.ts
  quota.ts
  labelResolver.ts
worker/routes/maps.ts
worker/db/
  global-family-country.sql
  maps-request-control.sql
docs/operations/google-maps-release-readiness.md
```

## 실행 구간

- **구간 A — 자격 없이 완료:** Task 1~10. 자동 테스트, 로컬 D1 복제본, 키 누락 오류 상태까지 완료한다.
- **구간 B — 사용자 자격 후 실행:** Task 11. 실제 Google 프로젝트·제한·법적 검토·테스트 가족 검증 뒤 통과 국가만 연다.
- Task 11과 별도 가족 시간대/DST gate가 끝나기 전에는 “글로벌 출시 가능”으로 판정하지 않는다.

---

### Task 1: 단일 지도 정책과 정적 범위 가드 추가

**Files:**
- Create: `shared/mapPolicy.ts`
- Create: `tests/mapPolicy.test.ts`
- Create: `worker/tests/mapPolicyParity.test.mjs`
- Create: `tests/mapStaticBoundary.test.mjs`
- Modify: `tsconfig.app.json`

**Interfaces:**
- Consumes: ISO 3166-1 alpha-2 가족 국가와 운영 Google allowlist
- Produces: `MapProvider`, `MapPolicy`, `resolveMapPolicy(countryCode, googleCountries)`

- [ ] **Step 1: 정책 matrix와 직접 의존 경계의 실패 테스트를 작성한다**

  `tests/mapPolicy.test.ts`는 `KR`, `CN`, `ZZ`, enabled `JP`, disabled `US`, 잘못된 값을 검증한다. `worker/tests/mapPolicyParity.test.mjs`는 Worker가 같은 `shared/mapPolicy.ts`를 import하는지 고정한다. `tests/mapStaticBoundary.test.mjs`는 다음을 실패시킨다.

  ```text
  src/screens/** 또는 src/components/**의 KakaoMap/loadKakaoMaps/google.maps 직접 import
  src/**의 /api/kakao/* 호출
  worker/routes/**의 body.countryCode 기반 공급자 선택
  Mapbox source/package/secret의 신규 추가
  ```

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test tests/mapPolicy.test.ts tests/mapStaticBoundary.test.mjs worker/tests/mapPolicyParity.test.mjs`

  Expected: `shared/mapPolicy.ts` 부재와 현재 Kakao 직접 의존 때문에 FAIL.

- [ ] **Step 3: 최소 정책 함수를 구현한다**

  ```ts
  export type MapPolicy =
    | { provider: "kakao"; countryCode: "KR" }
    | { provider: "google"; countryCode: string }
    | {
        provider: "unsupported";
        reason: "country_unresolved" | "china_unsupported" | "country_not_enabled";
      };

  export const GOOGLE_MAP_RELEASE_COUNTRIES: readonly string[] = [];

  export function resolveMapPolicy(
    countryCode: unknown,
    googleCountries?: ReadonlySet<string>,
  ): MapPolicy;
  ```

  입력을 trim/uppercase한 정확한 2글자 코드만 허용하고, `KR`/`CN`/미확정 판정을 allowlist보다 먼저 한다. 기본 allowlist는 처음에 빈 배열이라 자격 없이 non-KR이 열리지 않는다. 테스트만 명시 Set을 주입하며, 실제 앱과 Worker는 같은 exported 배열을 사용한다. 정적 테스트에는 현재 직접 결합 파일만 exact path로 적은 `LEGACY_ALLOWED_DIRECT_IMPORTS`를 두되 신규 경로는 허용하지 않고 Task 6에서 빈 배열로 만든다. `tsconfig.app.json`은 import된 `shared/*.ts`를 strict 검사할 수 있게 하되 앱 별칭이나 출력 경로를 바꾸지 않는다.

- [ ] **Step 4: 정책 GREEN을 확인한다**

  Run: `node --test tests/mapPolicy.test.ts worker/tests/mapPolicyParity.test.mjs`

  Expected: 모든 matrix PASS. 정적 경계 테스트는 이후 이관이 끝날 때까지 현재 위반 목록을 exact baseline으로만 허용하고 신규 위반은 즉시 FAIL시킨다.

- [ ] **Step 5: 첫 커밋을 만든다**

  Commit: `test: 글로벌 지도 공급자 경계를 고정한다`

### Task 2: 지도 선택용 가족 국가를 서버 정본으로 추가

**Files:**
- Create: `worker/db/global-family-country.sql`
- Create: `worker/lib/region.ts`
- Create: `worker/tests/globalFamilyCountryMigration.test.mjs`
- Create: `worker/tests/familyRegionRoutes.test.mjs`
- Create: `tests/familyRegionContract.test.ts`
- Create: `src/transform/familyCountryDisplay.ts`
- Create: `tests/familyCountryDisplay.test.ts`
- Modify: `cloudflare/schema_d1.sql`
- Modify: `worker/routes/family.ts`
- Modify: `worker/db/authz.ts`
- Modify: `worker/lib/healthReadiness.ts`
- Modify: `src/lib/api/endpoints/family.ts`
- Modify: `src/queries/useFamily.ts`
- Modify: `src/screens/onboarding/Onboarding.tsx`
- Modify: `src/screens/parent/ParentSettings.tsx`

**Interfaces:**
- Consumes: 신규 가족에서 사용자가 확인한 `countryCode`; 기존 `resolveCanonicalFamilyMembership`·`assertPrimaryParent`
- Produces: `FamilyInfo.countryCode`, `FamilyInfo.mapPolicy`, `/api/family/mine`, `PATCH /api/family/region`

- [ ] **Step 1: additive migration과 route 실패 테스트를 작성한다**

  기존 schema 복제본에 migration을 한 번 적용해 기존 가족이 정확히 `KR`이 되는지, 두 번째 실행은 preflight가 이미 적용됨을 감지해 SQL 실행 전에 중단하는지, column/readiness가 빠지면 실패하는지 검증한다. route 테스트는 신규 family에 country가 없거나 형식이 틀리면 400, 보조 보호자·타 가족은 403, 기존 family의 `/setup` 재호출은 국가를 덮어쓰지 않음을 먼저 고정한다. UI 테스트는 10개 앱 locale에서 `Intl.DisplayNames({ type: "region" })`를 사용하고 미지원 runtime은 ISO code로만 fallback하며 한국어 국가명을 하드코딩하지 않는지 검증한다.

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test worker/tests/globalFamilyCountryMigration.test.mjs worker/tests/familyRegionRoutes.test.mjs tests/familyRegionContract.test.ts tests/familyCountryDisplay.test.ts`

  Expected: 신규 column/helper/응답 필드 부재로 FAIL.

- [ ] **Step 3: schema와 validation을 구현한다**

  ```sql
  ALTER TABLE families ADD COLUMN country_code TEXT NOT NULL DEFAULT 'KR';
  ```

  운영 SQL은 SQLite의 중복 column 제약 때문에 실행 전 preflight가 필요한 **정확히 1회 migration**으로 작성한다. canonical schema와 route validator는 `country_code`를 trim/uppercase한 정확한 2글자 ISO 코드로 제한한다.

- [ ] **Step 4: family API와 최소 UI를 연결한다**

  ```ts
  export interface FamilyRegion {
    countryCode: string;
  }

  export interface SetupFamilyInput extends FamilyRegion {
    parentName: string;
    familyName?: string;
    plannedChildCount?: number;
    children?: Array<{ name: string; birthdate?: string; color_hex?: string; photo_url?: string }>;
    parentPhone?: string;
    parentGender?: string;
    referralCode?: string;
  }

  export function updateFamilyRegion(input: FamilyRegion): Promise<FamilyInfo>;

  export function formatFamilyCountryName(countryCode: string, locale: string): string;
  ```

  신규 가족 생성 직전에 edge country를 **제안값**으로 보여주고 사용자가 확인한 값만 전송한다. locale 선택을 국가로 대신 쓰지 않는다. 설정에서는 주 보호자만 변경할 수 있고 변경 시 기존 UTC/date_key/좌표를 rewrite하지 않는다. Worker가 같은 shared allowlist로 계산한 `mapPolicy`를 `/mine`에 포함해 client와 server 활성 상태를 맞춘다.

- [ ] **Step 5: GREEN과 기존 가족 불변을 확인한다**

  Run: `node --test worker/tests/globalFamilyCountryMigration.test.mjs worker/tests/familyRegionRoutes.test.mjs tests/familyRegionContract.test.ts tests/familyCountryDisplay.test.ts`

  Run: `npm run typecheck && npm run typecheck:worker`

- [ ] **Step 6: schema/API 커밋을 만든다**

  Commit: `feat: 지도 선택용 가족 국가 정본을 추가한다`

### Task 3: 지도 요청 session·비용 quota 경계 추가

**Files:**
- Create: `worker/db/maps-request-control.sql`
- Create: `worker/lib/maps/autocompleteSession.ts`
- Create: `worker/lib/maps/quota.ts`
- Create: `worker/lib/maps/requestControlCleanup.ts`
- Create: `worker/tests/mapsAutocompleteSession.test.mjs`
- Create: `worker/tests/mapsQuota.test.mjs`
- Create: `worker/tests/mapsRequestControlCleanup.test.mjs`
- Modify: `cloudflare/schema_d1.sql`
- Modify: `worker/lib/healthReadiness.ts`
- Modify: `worker/lib/accountDeletion.ts`
- Modify: `worker/types.ts`
- Modify: `worker/.dev.vars.example`
- Modify: `worker/index.ts`

**Interfaces:**
- Consumes: authenticated user/family/provider와 `MAPS_SESSION_HMAC_SECRET`
- Produces: 5분 HMAC autocomplete handle, 결정적 provider UUID, 원자적 user/family quota claim

- [ ] **Step 1: session binding·동시 consume·quota RED를 작성한다**

  user/family/provider mismatch, 5분 만료, HMAC 변조, 두 isolate에서 같은 provider UUID, Details 동시 2회 중 정확히 1회 성공, D1 오류 503, 한도 초과 429를 검증한다. raw handle/token/query/좌표가 D1·로그에 없는지도 검사한다.

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test worker/tests/mapsAutocompleteSession.test.mjs worker/tests/mapsQuota.test.mjs`

- [ ] **Step 3: session handle과 D1 digest 저장을 구현한다**

  ```sql
  CREATE TABLE map_autocomplete_sessions (
    handle_digest TEXT PRIMARY KEY,
    expires_at_ms INTEGER NOT NULL,
    consumed_at_ms INTEGER,
    created_at_ms INTEGER NOT NULL,
    CHECK (expires_at_ms > created_at_ms)
  );

  CREATE TABLE map_request_quota (
    family_scope_digest TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN (
      'autocomplete', 'details', 'reverse_object', 'reverse_raw', 'directions'
    )),
    bucket_start_ms INTEGER NOT NULL,
    family_count INTEGER NOT NULL CHECK (family_count >= 0),
    user_counts_json TEXT NOT NULL CHECK (json_valid(user_counts_json)),
    expires_at_ms INTEGER NOT NULL,
    PRIMARY KEY (family_scope_digest, action, bucket_start_ms)
  );

  CREATE INDEX map_autocomplete_sessions_expiry_idx
    ON map_autocomplete_sessions(expires_at_ms);
  CREATE INDEX map_request_quota_expiry_idx
    ON map_request_quota(expires_at_ms);
  ```

  ```ts
  export function createAutocompleteSession(input: {
    db: D1Database; userId: string; familyId: string;
    provider: "kakao" | "google"; nowMs: number;
  }): Promise<{ handle: string; expiresAt: string }>;

  export function consumeAutocompleteHandleAtomically(input: {
    db: D1Database; handle: string; userId: string; familyId: string; providerPlaceId: string;
  }): Promise<"consumed" | "invalid" | "expired" | "reused">;

  export type MapQuotaAction =
    | "autocomplete"
    | "details"
    | "reverse_object"
    | "reverse_raw"
    | "directions";

  export function claimMapQuota(input: {
    db: D1Database;
    secret: string;
    userId: string;
    familyId: string;
    action: MapQuotaAction;
    nowMs: number;
  }): Promise<{ allowed: true; userRemaining: number; familyRemaining: number }
    | { allowed: false; retryAfterSeconds: number }>;
  ```

  handle의 보이는 payload에는 version·nonce·expiry만 넣고 signature 계산에 현재 user/family/provider를 포함한다. 따라서 다른 세션에서 handle을 재사용할 수 없고 base64 decode로 내부 ID가 드러나지 않는다. `createAutocompleteSession()`은 handle 생성과 digest INSERT가 모두 성공한 뒤에만 응답한다. D1에는 별도 HMAC digest, expiry, consumed timestamp만 저장한다. provider token은 nonce와 별도 domain-separated HMAC에서 version/variant bit까지 맞춘 RFC 4122 UUID v4 형태로 파생하고 평문 저장하지 않는다.

- [ ] **Step 4: 초기 비용 한도를 코드 상수와 테스트로 고정한다**

  UTC 고정 1시간 bucket을 사용한다. family ID는 domain-separated HMAC digest로 row key를 만들고, user ID도 별도 HMAC digest로 `user_counts_json` key를 만든다. `INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING` 단일 statement가 family total과 해당 user count를 함께 증가시켜 동시 요청에서 두 한도를 원자적으로 지킨다. read-then-write와 두 row `batch()` 구현은 금지한다.

  | action | user/hour | family/hour |
  |---|---:|---:|
  | autocomplete query | 120 | 360 |
  | Place Details select | 30 | 90 |
  | object-ref reverse | 120 | 360 |
  | raw `picker_pin|memo_share` reverse | 30 | 90 |
  | directions | 30 | 90 |

  upstream이 요청을 받았을 가능성이 있으면 quota를 반환하지 않는다. provider fetch 전 validation 실패만 claim 전에 끝낸다. 수치는 운영 비용 관측 뒤 코드 리뷰와 테스트를 거쳐 조정하며 클라이언트가 전달하지 않는다.

- [ ] **Step 5: 만료·계정 삭제 cleanup을 구현한다**

  hourly scheduled handler는 autocomplete session을 만료 10분 뒤, quota bucket을 종료 2시간 뒤 삭제한다. 실패는 지도 제품 요청과 다른 cron을 중단시키지 않고 구조화 오류 코드만 남긴다. 계정 삭제는 계산한 current user digest의 count를 `family_count`에서 빼고 `user_counts_json` key를 제거하며, 가족 삭제는 family digest row를 삭제한다.

- [ ] **Step 6: GREEN과 삭제 정리를 확인한다**

  Run: `node --test worker/tests/mapsAutocompleteSession.test.mjs worker/tests/mapsQuota.test.mjs worker/tests/mapsRequestControlCleanup.test.mjs worker/tests/accountDeletionCompleteness.test.mjs`

- [ ] **Step 7: 요청 제어 커밋을 만든다**

  Commit: `feat: 지도 검색 세션과 비용 한도를 보호한다`

### Task 4: 인증된 공통 Worker 지도 API와 Kakao adapter 구축

**Files:**
- Create: `worker/lib/maps/types.ts`
- Create: `worker/lib/maps/service.ts`
- Create: `worker/lib/maps/kakao.ts`
- Create: `worker/lib/maps/familyContext.ts`
- Create: `worker/routes/maps.ts`
- Create: `worker/tests/mapsRoutes.test.mjs`
- Modify: `worker/routes/kakao.ts`
- Modify: `worker/index.ts`
- Modify: `worker/types.ts`
- Modify: `worker/tests/kakaoRouteCache.test.mjs`
- Modify: `worker/routes/rest-shim.ts`
- Modify: `worker/shared/kakaoReverseGeocode.js`

**Interfaces:**
- Consumes: access JWT, canonical family membership/country, map policy, object reference 또는 허용된 raw pin
- Produces: `POST /api/maps/search`, `POST /api/maps/reverse`, `POST /api/maps/directions`

- [ ] **Step 1: authz·policy·입력 union RED를 작성한다**

  무인증 401, 교사 403, 타 가족/아이/object ref 403/404, body country 위조 무시, `ZZ`·비표준 코드 no-fetch, secret/quota DB 없음 503을 provider fetch보다 먼저 검증한다. 모든 응답은 `Cache-Control: private, no-store`다.

- [ ] **Step 2: 검색 request/response 계약을 고정한다**

  ```ts
  export interface LatLngPoint { lat: number; lng: number }

  export type MapBiasRef =
    | { kind: "child_location"; childUserId: string; recordedAt?: string }
    | { kind: "saved_place"; savedPlaceId: string }
    | { kind: "academy"; academyId: string }
    | { kind: "event"; eventId: string };

  export type MapSearchRequest =
    | { action: "start" }
    | { action: "query"; sessionHandle: string; query: string; locale: string; bias?: MapBiasRef }
    | { action: "select"; sessionHandle: string; providerPlaceId: string };

  export interface MapSearchCandidate {
    provider: "kakao" | "google";
    providerPlaceId: string;
    primaryText: string;
    secondaryText: string | null;
  }

  export type MapSearchResponse =
    | { action: "start"; provider: "kakao" | "google"; sessionHandle: string; expiresAt: string }
    | { action: "query"; provider: "kakao" | "google"; candidates: MapSearchCandidate[] }
    | { action: "select"; provider: "kakao" | "google"; point: LatLngPoint;
        primaryText: string; secondaryText: string | null };
  ```

  query는 trim 후 2~100 Unicode code point, payload 8KiB 이하, client debounce 300ms를 계약으로 둔다. `select`만 좌표를 ephemeral response로 반환하며 장기 저장을 뜻하지 않는다.

- [ ] **Step 3: reverse/directions union RED를 작성한다**

  ```ts
  export type ReverseSource =
    | { kind: "child_location"; childUserId: string; recordedAt?: string }
    | { kind: "saved_place"; savedPlaceId: string }
    | { kind: "academy"; academyId: string }
    | { kind: "event"; eventId: string }
    | { kind: "picker_pin" | "memo_share"; lat: number; lng: number };

  export type MapRoutePointRef =
    | { kind: "child_location"; childUserId: string; recordedAt?: string }
    | { kind: "saved_place"; savedPlaceId: string }
    | { kind: "academy"; academyId: string }
    | { kind: "event"; eventId: string };

  export interface MapDirectionsRequest {
    origin: MapRoutePointRef;
    destination: MapRoutePointRef;
  }

  export interface MapReverseResponse {
    policyProvider: "kakao" | "google";
    label: string | null;
    measuredAt: string | null;
  }

  export type WalkingRouteResponse =
    | { policyProvider: "kakao" | "google"; routeSource: "kakao" | "ors" | "osrm" | "google";
        distanceMeters: number; durationSeconds: number | null; points: LatLngPoint[];
        quality: "provider_route"; warnings: Array<"walking_data_incomplete"> }
    | { policyProvider: "kakao" | "google"; routeSource: "none";
        distanceMeters: null; durationSeconds: null; points: [];
        quality: "unavailable"; warnings: Array<"walking_data_incomplete"> };
  ```

  raw 좌표는 reverse의 `picker_pin|memo_share`만, 최대 소수점 7자리다. directions는 object ref 두 개만 받고 Worker가 좌표를 다시 읽는다. `child_location.recordedAt`은 정확히 같은 행을 읽고, 최신 아이 위치를 경로 origin으로 쓸 때 5분을 넘으면 409 `map_location_stale`다.

- [ ] **Step 4: RED를 확인한다**

  Run: `node --test worker/tests/mapsRoutes.test.mjs worker/tests/kakaoRouteCache.test.mjs`

- [ ] **Step 5: family context와 공통 service를 구현한다**

  `loadFamilyMapContext()`는 `resolveCanonicalFamilyMembership`과 `assertFamilyAccess` 뒤 D1 family row를 읽고 body의 country를 보지 않는다. `MapService`는 policy가 허용한 adapter만 호출한다.

  ```ts
  export interface MapService {
    search(input: AuthorizedMapSearch): Promise<MapSearchResponse>;
    reverse(input: AuthorizedMapReverse): Promise<MapReverseResponse>;
    directions(input: AuthorizedMapDirections): Promise<WalkingRouteResponse>;
  }
  ```

- [ ] **Step 6: 기존 Kakao 동작을 adapter로 옮긴다**

  KR 검색/역지오코딩과 `Kakao → ORS → OSRM` 도보 fallback을 `worker/lib/maps/kakao.ts`로 이동한다. 실제 `routeSource`를 유지하고 세 공급자가 모두 실패하면 502 합성 성공이 아니라 `routeSource:none`을 반환한다. `/api/kakao/*`는 구버전 클라이언트용 legacy shim으로만 남기고 신규 client 계약에는 노출하지 않는다. `worker/shared/kakaoReverseGeocode.js`는 이 Task에서는 새 Kakao adapter를 부르는 legacy re-export로만 남겨 다음 소비처 이관 전 Worker가 끊기지 않게 한다.

- [ ] **Step 7: GREEN과 KR 회귀를 확인한다**

  Run: `node --test worker/tests/mapsRoutes.test.mjs worker/tests/kakaoRouteCache.test.mjs worker/tests/registeredPlaceGeofence.test.mjs`

  Run: `npm run typecheck:worker`

- [ ] **Step 8: 공통 Worker 경계 커밋을 만든다**

  Commit: `refactor: Kakao 지도 서비스를 공통 API로 감싼다`

### Task 5: Google Places·Geocoding·Routes Worker adapter 구현

**Files:**
- Create: `shared/googleRegion.ts`
- Create: `worker/lib/maps/googleOAuth.ts`
- Create: `worker/lib/maps/google.ts`
- Create: `worker/tests/googleMapsOAuth.test.mjs`
- Create: `worker/tests/googleMapsAdapter.test.mjs`
- Create: `tests/googleRegion.test.ts`
- Modify: `worker/lib/maps/service.ts`
- Modify: `worker/types.ts`
- Modify: `worker/.dev.vars.example`
- Modify: `worker/routes/maps.ts`
- Modify: `worker/tests/mapsRoutes.test.mjs`

**Interfaces:**
- Consumes: 별도 `GOOGLE_MAPS_SERVICE_ACCOUNT_JSON`, 최소 OAuth scope, `MAPS_SESSION_HMAC_SECRET`
- Produces: Google autocomplete/details, reverse geocode, WALK route의 축소 응답

- [ ] **Step 1: OAuth·field mask·no-cache RED를 작성한다**

  잘못된 service-account JSON, JWT 서명/만료, OAuth 401/403/429/5xx, timeout을 내부 오류 코드로 축소한다. Google fetch에 `edgeCache.cacheGet/cachePut`가 0회인지, raw URL/query/좌표/Place ID가 로그에 없는지 spy로 확인한다.

- [ ] **Step 2: provider request 계약 RED를 작성한다**

  - Autocomplete: `POST https://places.googleapis.com/v1/places:autocomplete`
  - Details: `GET https://places.googleapis.com/v1/places/{placeId}`
  - Reverse: `GET https://geocode.googleapis.com/v4/geocode/location/{lat},{lng}`
  - Route: `POST https://routes.googleapis.com/directions/v2:computeRoutes`, `travelMode=WALK`

  field mask는 다음 exact 값만 허용하고 wildcard `*`와 top-level 전체 선택을 실패시킨다.

  ```text
  autocomplete: suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat
  details:      id,displayName,formattedAddress,location
  reverse:      results.formattedAddress
  routes:       routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline
  ```

  Places query는 `includeQueryPredictions=false`로 place prediction만 받고 derived UUID v4를 request body `sessionToken`에 넣는다. Details는 같은 Cloud project 자격과 같은 token을 `sessionToken` query parameter로 전달한 한 번의 GET이어야 한다. OAuth scope는 Autocomplete=`https://www.googleapis.com/auth/maps-platform.places.autocomplete`, Details=`https://www.googleapis.com/auth/maps-platform.places.details`, Reverse=`https://www.googleapis.com/auth/maps-platform.geocode.location`로 고정하고 `cloud-platform` 대체를 테스트에서 거부한다. Routes 표준 v2의 production OAuth가 이 격리 service account에서 공식 지원되는지 Task 11에서 먼저 확인하며, route 전용 최소 권한이 확인되지 않으면 Routes만 HOLD하고 broad scope나 unrestricted API key로 우회하지 않는다.

- [ ] **Step 3: Google method별 region 변환 RED를 작성한다**

  `shared/googleRegion.ts`는 Maps JavaScript의 Unicode region, Places·Geocoding v4의 CLDR region, Routes의 ccTLD region을 별도 함수로 제공한다. `KR/JP/US/GB` fixture에서 web `GB`, Places/Geocoding `gb`, Routes `uk`를 고정하고 한 함수를 모든 endpoint에 재사용하지 않는다.

- [ ] **Step 4: RED를 확인한다**

  Run: `node --test worker/tests/googleMapsOAuth.test.mjs worker/tests/googleMapsAdapter.test.mjs worker/tests/mapsRoutes.test.mjs tests/googleRegion.test.ts`

- [ ] **Step 5: 지도 전용 OAuth token provider를 구현한다**

  ```ts
  export interface GoogleMapsTokenProvider {
    getAccessToken(scopes: readonly string[], signal: AbortSignal): Promise<string>;
  }
  ```

  access token은 만료 5분 전까지만 isolate memory에 캐시하고 정렬한 exact scope set을 cache key로 사용한다. scopes는 endpoint별 narrow scope를 합성하고 로그인/FCM/Play 자격을 참조하는 코드 경로가 있으면 테스트를 실패시킨다.

- [ ] **Step 6: 최소 응답 adapter를 구현한다**

  provider 응답을 공통 DTO로 즉시 축소하고 원문을 반환·저장하지 않는다. Google search 선택 좌표와 Place ID는 `Cache-Control: private, no-store` 응답의 ephemeral 값이며 장소/일정/memo 저장 API로 전달되지 않는다. Google route 실패는 Kakao fallback 없이 `routeSource:none`; 참고 직선은 client가 좌표 메모리에서만 그리며 거리/시간은 null이다.

- [ ] **Step 7: 키 미설정 fail-closed와 GREEN을 확인한다**

  Run: `node --test worker/tests/googleMapsOAuth.test.mjs worker/tests/googleMapsAdapter.test.mjs worker/tests/mapsRoutes.test.mjs tests/googleRegion.test.ts`

  Expected: fake fetch fixture는 PASS, 실제 secret 없음은 외부 요청 0회와 `map_provider_unavailable` 503.

- [ ] **Step 8: Google Worker adapter 커밋을 만든다**

  Commit: `feat: Google 지도 서버 API를 안전하게 연결한다`

### Task 6: 공급자 중립 `FamilyMap`과 Kakao 화면 parity 구축

**Files:**
- Create: `src/maps/contracts.ts`
- Create: `src/maps/mapErrors.ts`
- Create: `src/maps/FamilyMap.tsx`
- Create: `src/maps/FamilyMap.css`
- Create: `src/maps/providers/kakao/KakaoMapAdapter.tsx`
- Create: `src/maps/providers/kakao/loadKakaoMaps.ts`
- Create: `src/maps/providers/unsupported/UnsupportedMapAdapter.tsx`
- Create: `tests/mapAdapterContract.test.ts`
- Create: `tests/mapErrorContract.test.ts`
- Create: `tests/familyMapLazyPolicy.test.mjs`
- Create: `tests/familyMapAccessibility.test.mjs`
- Delete after move: `src/components/KakaoMap.tsx`
- Delete after move: `src/lib/kakaoMap.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/screens/parent/ParentHome.tsx`
- Modify: `src/styles/components.css`
- Modify: `index.html`
- Modify: `tests/mapPerf.test.ts`
- Modify: `tests/kakaoMapDomSafety.test.mjs`
- Modify: `tests/kakaoMapRetry.test.ts`
- Modify: `tests/aiFriendDisplayI18n.test.mjs`
- Modify: `tests/i18nFeatureScreens.test.mjs`
- Modify: `tests/i18nChildScreens.test.mjs`
- Modify: `tests/i18nParentScreens.test.mjs`
- Modify: `tests/progressIndicatorContract.test.mjs`
- Modify: `tests/copyConsistencyContract.test.mjs`
- Modify: `tests/memoPhotoTokenSafety.test.mjs`

**Interfaces:**
- Consumes: `FamilyInfo.countryCode`, 공통 `MapScene`, locale, host element
- Produces: provider-neutral mount/update/destroy controller와 항상 존재하는 DOM 접근성 목록

- [ ] **Step 1: adapter lifecycle·error·lazy-load RED를 작성한다**

  ```ts
  export interface MapScene {
    child?: MapChild | null;
    zones: MapZone[];
    places: MapPlace[];
    route: LatLngPoint[];
    stays: MapStay[];
    destination?: MapPlace | null;
    picked?: LatLngPoint | null;
    center?: LatLngPoint | null;
    centerLevel?: number | null;
    recenterKey: number;
    viewportPadding: MapViewportPadding;
    interactive: boolean;
    onPick?: (point: LatLngPoint) => void;
  }

  export interface MapAdapterContext {
    locale: string;
    regionCode: string;
    surface: "web" | "android";
  }

  export type MapErrorCode =
    | "map_country_unresolved"
    | "map_country_unsupported"
    | "map_provider_unavailable"
    | "map_google_play_services_unavailable"
    | "map_location_stale"
    | "map_quota_exceeded"
    | "map_network_unavailable"
    | "map_search_failed"
    | "map_reverse_failed"
    | "map_directions_failed";

  export interface MapAdapter {
    mount(host: HTMLElement, scene: MapScene, context: MapAdapterContext): Promise<MapController>;
  }
  export interface MapController {
    update(scene: MapScene, generation: number, signal: AbortSignal): Promise<void>;
    setInteractive(enabled: boolean): Promise<void>;
    destroy(): Promise<void>;
  }
  ```

  `destroy()` 중복 호출, 늦은 mount/update abort, provider 전환 generation, typed `MapErrorCode`를 고정한다. `pending/ZZ/비표준 코드`에서는 dynamic import·script·preconnect·Worker map call이 모두 0회여야 한다.

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test tests/mapAdapterContract.test.ts tests/mapErrorContract.test.ts tests/familyMapLazyPolicy.test.mjs tests/familyMapAccessibility.test.mjs`

- [ ] **Step 3: 기존 지도 scene을 공급자 중립 타입으로 이동한다**

  현 `KakaoMap.tsx`의 child/place/zone/stay/route/center/recenter/bounds/viewportPadding 계약을 `src/maps/contracts.ts`로 이동한다. 화면별 CSS host class와 `mapCenter.ts`, `mapViewportPadding.ts` 의미는 바꾸지 않는다. 이 작은 이동 뒤 adapter contract 테스트를 다시 실행한다.

- [ ] **Step 4: Kakao loader와 renderer를 adapter 디렉터리로 물리 이동한다**

  `src/lib/kakaoMap.ts`와 `src/components/KakaoMap.tsx` 구현을 새 두 파일로 이동하고 기존 파일은 삭제한다. 호환 wrapper나 re-export는 남기지 않는다. `src/styles/components.css`의 `.km-*` 지도 블록도 `FamilyMap.css`/Kakao adapter 범위로 이동하되 Kakao 출처 링크 hit area와 가시성은 보존한다. Kakao adapter는 기존 marker/circle/polyline/picker/retry/DOM text 안전성 동작을 그대로 유지한다.

- [ ] **Step 5: Kakao parity GREEN을 확인한다**

  Run: `node --test tests/mapAdapterContract.test.ts tests/mapPerf.test.ts tests/kakaoMapDomSafety.test.mjs tests/kakaoMapRetry.test.ts tests/aiFriendDisplayI18n.test.mjs tests/i18nFeatureScreens.test.mjs tests/i18nChildScreens.test.mjs tests/i18nParentScreens.test.mjs tests/progressIndicatorContract.test.mjs tests/copyConsistencyContract.test.mjs tests/memoPhotoTokenSafety.test.mjs`

- [ ] **Step 6: `FamilyMap` policy shell과 unsupported UI를 구현한다**

  `FamilyMap`만 policy를 기다리고 dynamic import한다. `UnsupportedMapAdapter`는 좌표·측정 시각·정확도와 설정 action을 제공하되 외부 SDK를 부르지 않는다.

- [ ] **Step 7: 전역 Kakao 선로딩을 제거한다**

  `index.html` Kakao preconnect, `AppShell`의 `warmKakaoMaps`, 부모 홈 prewarm을 제거한다. 한국 가족이 실제 지도 route를 열었을 때만 Kakao script를 삽입한다.

- [ ] **Step 8: 접근성 DOM parity를 구현한다**

  marker 정보와 같은 위치 목록, 현재 위치/재중앙, 선택, picker 좌표 직접 입력을 DOM button/form으로 제공한다. 지도 canvas가 보이지 않거나 native surface여도 모든 핵심 액션을 키보드와 screen reader로 수행할 수 있어야 한다.

- [ ] **Step 9: GREEN과 정적 경계 0건을 확인한다**

  Task 1의 `LEGACY_ALLOWED_DIRECT_IMPORTS`를 빈 배열로 줄이고, adapter 디렉터리 밖의 `KakaoMap`/`loadKakaoMaps`/Google SDK import가 모두 0건인지 확인한다.

  Run: `node --test tests/mapAdapterContract.test.ts tests/mapErrorContract.test.ts tests/familyMapLazyPolicy.test.mjs tests/familyMapAccessibility.test.mjs tests/mapStaticBoundary.test.mjs tests/mapPerf.test.ts tests/kakaoMapDomSafety.test.mjs tests/kakaoMapRetry.test.ts tests/aiFriendDisplayI18n.test.mjs tests/i18nFeatureScreens.test.mjs tests/i18nChildScreens.test.mjs tests/i18nParentScreens.test.mjs tests/progressIndicatorContract.test.mjs tests/copyConsistencyContract.test.mjs tests/memoPhotoTokenSafety.test.mjs`

- [ ] **Step 10: FamilyMap/Kakao 커밋을 만든다**

  Commit: `refactor: 기존 Kakao 지도를 FamilyMap으로 감싼다`

### Task 7: PWA Google Maps adapter와 공통 클라이언트 API 연결

**Files:**
- Create: `src/lib/googleMaps.ts`
- Create: `src/maps/providers/google/GoogleWebMapAdapter.ts`
- Create: `src/maps/MapAttribution.tsx`
- Create: `src/lib/api/endpoints/maps.ts`
- Create: `src/queries/useMaps.ts`
- Create: `src/transform/externalMapUrl.ts`
- Create: `src/maps/persistence.ts`
- Create: `tests/googleWebLoader.test.ts`
- Create: `tests/mapEndpoints.test.ts`
- Create: `tests/mapExternalUrl.test.ts`
- Create: `tests/mapAttribution.test.mjs`
- Create: `tests/mapEphemeralContent.test.mjs`
- Create: `tests/fixtures/mapEphemeralContent.fixture.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/config/env.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `.env.example`
- Modify: `src/maps/FamilyMap.tsx`
- Modify: `src/queries/keys.ts`

**Interfaces:**
- Consumes: 공개 `VITE_GOOGLE_MAPS_WEB_KEY`, canonical family policy, `/api/maps/*`
- Produces: lazy-loaded Google web map controller, map search/reverse/directions hooks, provider별 외부 URL

- [ ] **Step 1: 웹 loader·키 격리·API DTO RED를 작성한다**

  `pending/unsupported/Kakao`에서 Google loader 0회, 키 누락은 `map_provider_unavailable`, 같은 key/locale/region의 동시 load는 한 Promise, 실패 후 명시 재시도만 새 load, 다른 key/locale/region tuple 충돌은 fail-closed를 검증한다. 이미 로드된 문서에서 앱 locale이나 가족 국가가 바뀌면 두 번째 Google script를 삽입하지 않고 locale별 “새 설정 적용을 위해 다시 열기” action을 제공한다. Worker service-account/Android key 이름이 client bundle env에 들어가면 실패시킨다.

- [ ] **Step 2: 지도 밖 Google content attribution RED를 작성한다**

  검색 후보, 선택 상세, 역지오코드 주소, route 결과를 Google 지도 canvas 밖에 표시하면 같은 visual container에 exact `Google Maps` text attribution을 렌더해야 한다. `translate="no"`, 12~16sp, 한 줄, normal weight, 4.5:1 대비, provider가 Google이 아닐 때 미노출을 검사한다. 지도 canvas 안에서는 SDK가 그린 attribution을 추가·복제·가림 처리하지 않는다.

- [ ] **Step 3: 임시 공급자 콘텐츠의 저장 차단 RED를 작성한다**

  `tests/mapEphemeralContent.test.mjs`는 TypeScript compiler API로 `tests/fixtures/mapEphemeralContent.fixture.ts`를 strict compile한다. fixture는 검색 후보/선택 결과를 `buildPersistedMapLocation()`에 직접 넘긴 줄에 `@ts-expect-error`를 두고, `confirmPinFromMapGesture()`로 만든 좌표와 사용자가 입력한 non-empty 별칭만 compile/runtime validation을 통과하는지 검증한다.

- [ ] **Step 4: RED를 확인한다**

  Run: `node --test tests/googleWebLoader.test.ts tests/mapEndpoints.test.ts tests/mapExternalUrl.test.ts tests/mapAttribution.test.mjs tests/mapEphemeralContent.test.mjs`

- [ ] **Step 5: exact web loader를 설치한다**

  Run: `npm install --save-exact @googlemaps/js-api-loader@2.1.1`

  Expected: `package.json`과 lockfile에 정확히 `2.1.1`; 초기 route chunk에는 포함되지 않음.

- [ ] **Step 6: Google web adapter를 구현한다**

  Maps JavaScript API의 `importLibrary("maps")`·`importLibrary("marker")`를 policy 확정 뒤에만 호출하고 UI locale과 family country를 각각 language/region으로 전달한다. marker/circle/polyline/click/bounds/recenter/update/destroy는 Task 6 contract와 parity를 맞춘다. Google attribution을 직접 재작성·번역·가리지 않는다.

- [ ] **Step 7: 공통 API와 query key를 구현한다**

  ```ts
  export const mapsApi = {
    startSearch(): Promise<MapSearchSession>;
    search(input: MapSearchQuery): Promise<EphemeralMapSearchCandidate[]>;
    select(input: MapSearchSelection): Promise<MapSelectedPlace>;
    reverse(input: ReverseSource): Promise<MapReverseResult>;
    directions(input: MapDirectionsRequest): Promise<WalkingRouteResponse>;
  };
  ```

  query key에는 family ID, policy provider, object ref와 recordedAt을 포함한다. raw 좌표 검색 결과나 Google 주소를 localStorage/IndexedDB/persisted TanStack cache에 넣지 않는다.

- [ ] **Step 8: ephemeral 검색 타입과 attribution을 구현한다**

  ```ts
  declare const ephemeralProviderContent: unique symbol;
  declare const userConfirmedPin: unique symbol;

  export interface MapSearchSession {
    provider: "kakao" | "google";
    sessionHandle: string;
    expiresAt: string;
  }

  export interface MapSearchQuery {
    sessionHandle: string;
    query: string;
    locale: string;
    bias?: MapBiasRef;
  }

  export interface MapSearchSelection {
    sessionHandle: string;
    providerPlaceId: string;
  }

  export type EphemeralMapContent = { readonly [ephemeralProviderContent]: true };
  export type EphemeralMapSearchCandidate = MapSearchCandidate & EphemeralMapContent;
  export type MapSelectedPlace = EphemeralMapContent & {
    provider: "kakao" | "google";
    point: LatLngPoint;
    primaryText: string;
    secondaryText: string | null;
  };

  export type UserConfirmedPin = LatLngPoint & { readonly [userConfirmedPin]: true };
  export function confirmPinFromMapGesture(point: LatLngPoint): UserConfirmedPin;
  export function buildPersistedMapLocation(input: {
    label: string;
    pin: UserConfirmedPin;
  }): { address: string; lat: number; lng: number };
  ```

  검색 후보와 선택 결과는 저장 DTO와 호환되지 않는 branded `EphemeralMapContent`로 선언한다. 검색 결과는 지도 중심 이동에만 쓰고, 사용자가 지도에서 새로 탭하거나 드래그해 만든 `UserConfirmedPin`과 직접 입력한 별칭만 기존 장소/event/memo 저장 함수에 전달한다. Google 검색/주소/route text가 지도 밖에 보이는 모든 공통 container는 `MapAttribution`을 함께 렌더한다.

- [ ] **Step 9: 외부 URL helper를 구현한다**

  `buildExternalMapUrl(provider, kind, point, label)`만 사용하며 Kakao는 KR, Google은 현재 Google policy에서만 URL을 만든다. provider mismatch, `ZZ`·비표준 코드는 `null`을 반환한다.

- [ ] **Step 10: GREEN과 bundle lazy-load를 확인한다**

  Run: `node --test tests/googleWebLoader.test.ts tests/mapEndpoints.test.ts tests/mapExternalUrl.test.ts tests/mapAttribution.test.mjs tests/mapEphemeralContent.test.mjs tests/googleRegion.test.ts`

  Run: `npm run typecheck && npm run build`

- [ ] **Step 11: PWA Google adapter 커밋을 만든다**

  Commit: `feat: 해외 PWA에 Google 지도를 연결한다`

### Task 8: Android Google native 지도와 surface 수명주기 구현

**Files:**
- Create: `src/maps/nativeSurface.ts`
- Create: `src/maps/providers/google/GoogleNativeMapAdapter.ts`
- Create: `src/lib/native/googleMaps.ts`
- Create: `android/app/src/main/java/com/hyeni/calendar/GoogleMapsPreflightPlugin.java`
- Create: `android/app/src/test/java/com/hyeni/calendar/GoogleMapsPreflightPolicyTest.java`
- Create: `tests/googleNativeMapContract.test.mjs`
- Create: `tests/googleMapsGradleContract.test.mjs`
- Create: `tests/nativeMapTransparencyLease.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `android/app/build.gradle`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/java/com/hyeni/calendar/MainActivity.java`
- Modify: `src/maps/FamilyMap.tsx`
- Generated by sync: `android/capacitor.settings.gradle`
- Generated by sync: `android/app/capacitor.build.gradle`

**Interfaces:**
- Consumes: Manifest-only `MAPS_API_KEY`, GMS availability, DOM host rect, `MapScene`
- Produces: `GoogleNativeMapAdapter`, ref-counted transparent surface lease, configured/GMS preflight without key disclosure

- [ ] **Step 1: pinned dependency와 source-contract RED를 작성한다**

  `@capacitor/google-maps`가 exact `8.0.1`, peer `@capacitor/core >=8`인지 고정한다. pinned plugin source contract는 Android `create()`가 JS `apiKey`를 사용하지 않는다는 사실만 검증하고, `tests/googleMapsGradleContract.test.mjs`는 Google Maps SDK가 소비하는 `com.google.android.geo.API_KEY` metadata, Manifest placeholder 단일 주입, release key 누락 fail-fast와 secret 비출력을 검증한다. native 호출은 TypeScript 필수 필드를 만족시키기 위해 `apiKey: ""`만 전달한다.

- [ ] **Step 2: lifecycle/surface/GMS RED를 작성한다**

  create 실패, abort, duplicate destroy, provider switch, background/foreground, resize/scroll/visualViewport/orientation, bottom sheet/scrim touch 차단, GMS 없음, key 없음을 테스트한다. 첫 lease만 `#root → .hy-app → .hy-screen → host` 배경을 보존·투명화하고 마지막 lease의 `finally`에서 정확히 복원해야 한다.

- [ ] **Step 3: RED를 확인한다**

  Run: `node --test tests/googleNativeMapContract.test.mjs tests/googleMapsGradleContract.test.mjs tests/nativeMapTransparencyLease.test.ts`

- [ ] **Step 4: exact native plugin을 설치·동기화한다**

  Run: `npm install --save-exact @capacitor/google-maps@8.0.1`

  Run: `npx cap sync android`

  `android/capacitor.settings.gradle`과 `android/app/capacitor.build.gradle`은 생성 결과를 검토만 하고 수동 편집하지 않는다.

- [ ] **Step 5: Android key와 preflight를 구현한다**

  ```xml
  <meta-data
      android:name="com.google.android.geo.API_KEY"
      android:value="${MAPS_API_KEY}" />
  ```

  ```ts
  export interface GoogleMapsPreflightResult {
    configured: boolean;
    playServicesStatus: "available" | "missing" | "update_required" | "unsupported";
  }
  ```

  `android/app/build.gradle`은 `MAPS_API_KEY` Gradle property를 Manifest `${MAPS_API_KEY}`에만 넣는다. release task는 빈 값이면 실제 값을 출력하지 않고 실패하며 debug/test는 빈 metadata로 assemble 가능하다. Manifest에는 `com.google.android.geo.API_KEY` metadata를 추가한다. preflight plugin은 `{ configured, playServicesStatus }`만 반환하고 key 원문을 JS로 보내지 않는다.

- [ ] **Step 6: native adapter와 surface lease를 구현한다**

  ```ts
  const lease = acquireNativeMapTransparency(host);
  try {
    const map = await GoogleMap.create({ id, element: host, apiKey: "", config });
    if (signal.aborted || generation !== activeGeneration) await map.destroy();
  } catch (error) {
    lease.release();
    throw mapNativeError(error);
  }
  ```

  generation+`AbortSignal`로 늦은 create/update를 폐기하고 모든 listener/native view/transparent lease를 idempotent `destroy()`에서 정리한다. `ResizeObserver`, scroll, visual viewport, orientation에 host rect를 동기화하고 overlay가 열리면 `disableTouch()`, 닫히면 살아 있는 같은 generation에서만 `enableTouch()`한다.

- [ ] **Step 7: Android·JS GREEN을 확인한다**

  Run: `node --test tests/googleNativeMapContract.test.mjs tests/googleMapsGradleContract.test.mjs tests/nativeMapTransparencyLease.test.ts`

  Run from `android/`: `gradlew.bat --no-daemon testDebugUnitTest lintDebug assembleDebug`

  Expected: 빈 key debug는 build PASS이고 지도 create 전에 명시 unavailable. release key 누락 fail-fast 계약 테스트는 PASS하며 실제 key 값은 출력되지 않음.

- [ ] **Step 8: Android native 지도 커밋을 만든다**

  Commit: `feat: Android에 Google native 지도를 연결한다`

### Task 9: 모든 지도 소비 화면과 백그라운드 라벨을 공통 경계로 이관

**Files:**
- Create: `worker/lib/maps/labelResolver.ts`
- Create: `worker/tests/mapCronLabelResolver.test.mjs`
- Create: `tests/mapConsumerWiring.test.mjs`
- Create: `tests/mapPolicyNoUpstream.test.mjs`
- Create: `tests/mapPersistenceBoundary.test.mjs`
- Modify: `src/screens/parent/ParentLocation.tsx`
- Modify: `src/screens/feature/SosReceive.tsx`
- Modify: `src/screens/feature/PlaceForm.tsx`
- Modify: `src/screens/feature/DangerZoneForm.tsx`
- Modify: `src/components/MapPickerSheet.tsx`
- Modify: `src/components/MapPickerSheet.css`
- Modify: `src/screens/parent/EventForm.tsx`
- Modify: `src/screens/feature/RouteView.tsx`
- Modify: `src/screens/shared/MemoChat.tsx`
- Modify: `src/screens/child/overlays/RouteSheet.tsx`
- Modify: `src/screens/parent/ParentHome.tsx`
- Modify: `src/screens/parent/ParentFamily.tsx`
- Modify: `src/screens/parent/ChildDetail.tsx`
- Modify: `src/screens/feature/LocationStatus.tsx`
- Modify: `src/screens/feature/DailySafetyReport.tsx`
- Modify: `src/screens/feature/RemoteAudio.tsx`
- Modify: `src/queries/useLocationLabels.ts`
- Modify: `src/queries/useRoute.ts`
- Modify: `src/lib/api/endpoints/location.ts`
- Modify: `src/lib/api/endpoints/route.ts`
- Modify: `src/transform/routeExternalUrl.ts`
- Modify: `worker/lib/arrivalDetect.ts`
- Modify: `worker/cron/unregistered-stay-check.ts`
- Delete after move: `worker/shared/kakaoReverseGeocode.js`
- Modify: `tests/parentLocationScrubFocus.test.mjs`
- Modify: `tests/locationRouteAccuracy.test.ts`
- Modify: `tests/routeQualityMatrix.test.mjs`
- Modify: `tests/sharedRouteAccess.test.mjs`
- Modify: `tests/childRedesignWiring.test.ts`

**Interfaces:**
- Consumes: `FamilyMap`, `mapsApi`, canonical object refs, provider-neutral route/label response
- Produces: 화면 전수 이관과 지도 실패와 독립된 안전 상태

- [ ] **Step 1: 소비처 정적 RED를 작성한다**

  **Files**에 열거한 모든 시각 지도 소비처가 `FamilyMap`만 import하고, 비시각 위치 label 화면이 `useMaps`/공통 reverse만 쓰며, direct Kakao geocoder·`/api/kakao/*`·직접 Google/Kakao URL이 남으면 exact path와 함께 실패시킨다.

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test tests/mapConsumerWiring.test.mjs tests/mapPolicyNoUpstream.test.mjs tests/parentLocationScrubFocus.test.mjs tests/locationRouteAccuracy.test.ts tests/routeQualityMatrix.test.mjs`

- [ ] **Step 3: 부모 위치·이력 화면을 이관하고 즉시 확인한다**

  `ParentLocation`을 `FamilyMap`으로 바꾸고 scrub의 `recordedAt`, bounds, recenter, 마지막 좌표·정확도 표시를 보존한다.

  Run: `node --test tests/mapConsumerWiring.test.mjs tests/parentLocationScrubFocus.test.mjs`

- [ ] **Step 4: SOS 지도 화면을 이관하고 안전 폴백을 확인한다**

  `SosReceive`의 지도만 `FamilyMap`으로 바꾸며, 지도 unavailable에서도 좌표·측정시각·긴급 연락/소리/메시지 동선이 남는지 `mapPolicyNoUpstream` fixture로 확인한다.

  Run: `node --test tests/mapConsumerWiring.test.mjs tests/mapPolicyNoUpstream.test.mjs`

- [ ] **Step 5: 장소·위험구역 편집 지도를 이관한다**

  `PlaceForm`과 `DangerZoneForm`을 한 화면씩 바꾸고 각 변경 직후 `mapConsumerWiring`을 실행한다. key/quota/network 오류에서도 사용자 이름·반경·직접 확정한 핀을 보존하고 저장 성공으로 위장하지 않는다.

- [ ] **Step 6: 일정 장소 picker 상·하위 wiring을 함께 이관한다**

  `EventForm`과 `MapPickerSheet`/CSS를 함께 수정해 open/close/draft/선택 결과 계약을 유지한다. Google 검색 선택은 지도 중심만 이동하고, 별도의 사용자 지도 탭/드래그 뒤에만 `UserConfirmedPin`을 EventForm에 반환한다.

  Run: `node --test tests/mapConsumerWiring.test.mjs tests/progressIndicatorContract.test.mjs`

- [ ] **Step 7: 길찾기 화면과 overlay를 이관한다**

  `RouteView`와 `RouteSheet`를 공통 directions/외부 URL로 옮기고 `routeSource`, 5분 stale origin, unavailable/null metrics, client-only straight line 의미를 보존한다.

  Run: `node --test tests/locationRouteAccuracy.test.ts tests/routeQualityMatrix.test.mjs tests/sharedRouteAccess.test.mjs tests/childRedesignWiring.test.ts`

- [ ] **Step 8: 메모 위치 공유를 이관하고 byte 보존을 확인한다**

  `MemoChat`은 공통 reverse와 같은 `[[loc:lat,lng|label]]` 문법을 쓰고 Google 이름·주소·Place ID를 marker에 복사하지 않는다. 기존 marker fixture가 byte-for-byte 같고 새 기본 label은 locale의 “공유한 위치”인지 확인한다.

  Run: `node --test tests/mapPersistenceBoundary.test.mjs tests/memoPhotoTokenSafety.test.mjs`

- [ ] **Step 9: 검색과 기존 장소 저장 경계를 연결한다**

  `PlaceForm`, `DangerZoneForm`, `MapPickerSheet`의 검색/선택은 autocomplete session을 사용한다. Google 후보·Details는 메모리에서만 표시하고 `MapAttribution`을 같은 container에 둔다. 저장 직전 `buildPersistedMapLocation({ label, pin })`만 호출하며, `pin`은 검색 선택 좌표가 아니라 이후 지도 `onPick`/drag gesture에서 만든 `UserConfirmedPin`이어야 한다. 기존 saved place/event/memo schema에는 provider/Place ID/Google 주소 필드를 추가하지 않는다.

  Run: `node --test tests/mapPersistenceBoundary.test.mjs tests/mapAttribution.test.mjs`

- [ ] **Step 10: 비시각 위치 label을 이관한다**

  부모 홈·가족·자녀 상세·위치 상태·안심리포트·주변소리는 object-ref reverse를 사용한다. query key에 아이/측정시각을 포함해 활성 아이가 바뀌거나 과거 scrub 시 label이 섞이지 않게 한다. Google 역지오코드 주소를 지도 밖에 표시하는 각 visual container에는 `MapAttribution`을 함께 렌더하고, 일반 좌표/측정시각만 보일 때는 Google attribution을 잘못 붙이지 않는다.

- [ ] **Step 11: cron label resolver만 최소 이관한다**

  `arrivalDetect`와 미등록 체류가 직접 Kakao helper를 부르지 않게 하고 legacy `worker/shared/kakaoReverseGeocode.js`를 삭제한다. resolver가 family policy/secret을 읽고 미지원·자격 없음이면 locale별 일반 장소명만 반환한다. `registered-place-geofence-check.ts`와 20m/dwell/leave/dedupe 상태머신은 수정하지 않는다. reverse 실패는 geofence transition·SOS·위치 저장을 중단시키지 않는다.

- [ ] **Step 12: GREEN과 안전 회귀를 확인한다**

  Run: `node --test tests/mapConsumerWiring.test.mjs tests/mapPolicyNoUpstream.test.mjs tests/mapPersistenceBoundary.test.mjs tests/mapAttribution.test.mjs tests/parentLocationScrubFocus.test.mjs tests/locationRouteAccuracy.test.ts tests/routeQualityMatrix.test.mjs tests/sharedRouteAccess.test.mjs tests/childRedesignWiring.test.ts worker/tests/mapCronLabelResolver.test.mjs worker/tests/unregisteredArrivalSingleSource.test.mjs worker/tests/unregisteredStayNotificationSettings.test.mjs worker/tests/unregisteredStayPresenceDedupe.test.mjs worker/tests/registeredPlaceGeofence.test.mjs worker/tests/registeredPlacePresenceDedupe.test.mjs worker/tests/registeredPlaceLatency.test.mjs`

- [ ] **Step 13: 소비처 이관 커밋을 만든다**

  Commit: `refactor: 지도와 위치 화면을 국가별 공급자에 연결한다`

### Task 10: 새 지도 문구·CSP·개인정보·자격 없는 전체 검증 마감

**Files:**
- Create: `tests/mapI18nContract.test.mjs`
- Create: `tests/mapCspContract.test.mjs`
- Create: `tests/googleMapsReleaseReadiness.test.mjs`
- Create: `scripts/verify-google-maps-release-readiness.mjs`
- Create: `docs/operations/google-maps-release-readiness.md`
- Modify: `locales/ko/shared.json`
- Modify: `locales/en/shared.json`
- Modify: `locales/ja/shared.json`
- Modify: `locales/zh-CN/shared.json`
- Modify: `locales/zh-TW/shared.json`
- Modify: `locales/vi/shared.json`
- Modify: `locales/th/shared.json`
- Modify: `locales/id/shared.json`
- Modify: `locales/ms/shared.json`
- Modify: `locales/fil/shared.json`
- Modify: `locales/descriptions.json`
- Generated by `npm run i18n:build`: `src/i18n/generated/messageIds.ts`
- Generated by `npm run i18n:build`: `src/i18n/generated/catalogs/ko/shared.ts`
- Generated by `npm run i18n:build`: `src/i18n/generated/catalogs/en/shared.ts`
- Generated by `npm run i18n:build`: `src/i18n/generated/catalogs/ja/shared.ts`
- Generated by `npm run i18n:build`: `src/i18n/generated/catalogs/zh-CN/shared.ts`
- Generated by `npm run i18n:build`: `src/i18n/generated/catalogs/zh-TW/shared.ts`
- Generated by `npm run i18n:build`: `src/i18n/generated/catalogs/vi/shared.ts`
- Generated by `npm run i18n:build`: `src/i18n/generated/catalogs/th/shared.ts`
- Generated by `npm run i18n:build`: `src/i18n/generated/catalogs/id/shared.ts`
- Generated by `npm run i18n:build`: `src/i18n/generated/catalogs/ms/shared.ts`
- Generated by `npm run i18n:build`: `src/i18n/generated/catalogs/fil/shared.ts`
- Modify: `public/_headers`
- Modify: `tests/securityHeadersContract.test.mjs`
- Modify: `worker/routes/legal.ts`
- Modify: `worker/tests/legalCopy.test.mjs`
- Modify: `tests/onboardingLegalLinks.test.mjs`
- Modify: `scripts/final-browser-qa.mjs`
- Modify: `scripts/regression-safety.mjs`
- Modify: `scripts/wf-childinfo-location.workflow.js`
- Modify: `scripts/wf-error-audit.workflow.js`
- Modify: `scripts/wf-build-wave1.workflow.js`
- Modify: `docs/store/play-release-checklist.md`
- Modify: `docs/store/play-data-safety.md`
- Modify: `docs/store/play-listing.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: 공통 `MapErrorCode`, 실제 Google/Kakao 데이터 전달·보존 동작, 10 locale catalog
- Produces: 번역된 오류/경고, 최소 CSP, 정책/출시 readiness machine gate

- [ ] **Step 1: locale·attribution·CSP·공개 법적 링크 RED를 작성한다**

  10 locale에 다음 의미가 빠지지 않는지 검증한다: 국가 미확정, 중국/비활성 국가 미지원, provider key 없음, GMS 없음, stale 위치, quota, offline/network, 검색/주소/경로 실패, Google 도보 데이터 불완전, 재시도, 국가 설정 이동, locale/국가 변경 뒤 앱 다시 열기. `Google Maps` attribution은 catalog에 넣거나 번역하지 않고 exact text/`translate="no"`/가시성을 검사한다. 비로그인 `GET /terms`와 `GET /privacy`가 200이고 각각 Google Maps Platform 약관과 Google 개인정보처리방침 canonical link를 포함하는지도 고정한다.

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test tests/mapI18nContract.test.mjs tests/mapCspContract.test.mjs tests/securityHeadersContract.test.mjs tests/googleMapsReleaseReadiness.test.mjs tests/onboardingLegalLinks.test.mjs worker/tests/legalCopy.test.mjs`

- [ ] **Step 3: 10개 locale 원문과 description을 추가한다**

  부모·페어링·설정 문구는 존댓말, 아이 화면 문구는 반말을 유지한다. provider가 생성한 장소명/주소는 사용자 콘텐츠로 취급해 재번역하지 않는다. locale JSON과 `locales/descriptions.json`을 먼저 수정한 뒤 생성물은 다음 명령으로만 갱신한다.

  Run: `npm run i18n:build`

- [ ] **Step 4: CSP를 실제 lazy loader host로 최소 확장한다**

  현 정책에 이미 있는 Kakao/Daum wildcard와 `img-src https:`는 이번 기능에서 넓히거나 별도 보안 정리로 축소하지 않는다. Google 추가분만 공식 문서와 local Chrome/iPhone PWA의 CSP violation report에서 관측된 exact host로 제한하고 `*`, 새 `https:`, broad `*.google.com`을 추가하지 않는다. `index.html`에는 공급자별 무조건 preconnect를 다시 추가하지 않는다. local QA에서 Google route를 연 뒤 차단된 필수 resource 0건, 비지도 route의 Google 요청 0건을 확인한다.

- [ ] **Step 5: 공개 약관·개인정보처리방침을 Google 정책과 연결한다**

  `/terms`에는 `https://cloud.google.com/maps-platform/terms`, `/privacy`에는 `https://policies.google.com/privacy`를 사용자에게 보이는 링크로 넣고 로그인 없이 접근 가능하게 유지한다. 두 문서는 Google Maps Platform을 지도 표시·장소 검색·주소 변환·경로에 사용하는 목적과 Worker 비보존 범위를 실제 코드와 일치시킨다.

- [ ] **Step 6: 개인정보·법적 문구와 readiness 검사를 구현한다**

  Kakao/Google에 전달되는 좌표·검색어·목적, Worker 비보존, 외부 링크, Google 도보 경고를 `worker/routes/legal.ts`, `docs/store/play-data-safety.md`, `docs/store/play-listing.md`, Play checklist에 실제 코드와 맞춘다. readiness script는 secret 값을 읽거나 출력하지 않고 변수 존재 여부·allowlist 상태·migration marker·package version·Manifest placeholder·정적 경계만 검사한다.

- [ ] **Step 7: QA/회귀 스크립트의 Kakao 고정 계약을 공통 지도 계약으로 바꾼다**

  `final-browser-qa`, `regression-safety`, `wf-childinfo-location.workflow`, `wf-error-audit.workflow`, `wf-build-wave1.workflow`의 `/api/kakao/*`, `KakaoMap`, direct link 고정을 provider-neutral assertion으로 교체한다. KR fixture는 Kakao, 저장 가능 ISO 비한국 fixture는 Google, `ZZ`·비표준 코드는 no-call을 기대하게 한다.

- [ ] **Step 8: locale와 자격 없는 전체 자동 검증을 실행한다**

  Run: `npm run i18n:verify`

  Run: `npm run typecheck`

  Run: `npm run typecheck:worker`

  Run: `npm test` — 마지막 요약 `ℹ fail 0`.

  Run: `npm run test:worker` — 마지막 요약 `ℹ fail 0`.

  Run: `npm run build`

  Run from `android/`: `gradlew.bat --no-daemon testDebugUnitTest lintDebug assembleDebug`

  Run: `node scripts/verify-google-maps-release-readiness.mjs --mode=credential-free`

  Expected: 모든 자동 검증 PASS. Google 실자격/실API/국가 활성화는 `BLOCKED_BY_USER_CREDENTIALS`, 별도 시간대 선행 gate는 `BLOCKED_BY_TIMEZONE_GATE`로 명시하며 프로세스 성공을 글로벌 출시 승인으로 해석하지 않음.

- [ ] **Step 9: locale·정책 마감 커밋을 만든다**

  Commit: `feat: 글로벌 지도 번역과 출시 게이트를 마감한다`

### Task 11: 사용자 Google 자격 후 별도 테스트 가족으로 실API·출시 gate 통과

**Files:**
- Modify after evidence exists: `shared/mapPolicy.ts`
- Modify after evidence exists: `docs/operations/google-maps-release-readiness.md`
- Modify after evidence exists: `docs/store/play-release-checklist.md`
- Modify after evidence exists: `CLAUDE.md`
- Generated evidence only: `artifacts/google-maps-qa/2026-08-26/`

**Interfaces:**
- Consumes: 사용자가 만든 web/android/worker 전용 Google 자격, API restriction, 별도 테스트 가족
- Produces: 국가별 PASS/HOLD matrix와 글로벌 출시 여부; 자격·token·정밀 좌표는 증거에서 제외

- [ ] **Step 1: 사용자가 자격을 직접 준비한 뒤 존재만 확인한다**

  - PWA key: Maps JavaScript API만, 정확히 `https://hyenicalendar.com`, `https://www.hyenicalendar.com`, `https://hyeni-calendar.pages.dev`.
  - preview/staging: 운영 key의 wildcard가 아니라 별도 project/key와 exact staging origin.
  - Android key: Maps SDK for Android만, `com.hyeni.calendar` + debug/release/Play App Signing SHA-1.
  - Worker service account: Places Autocomplete/Details와 Geocoding은 Task 5의 exact narrow scopes만. Routes는 공식적으로 지원되는 최소 OAuth 경로가 실자격 preflight를 통과할 때만 활성화하고, 실패하면 Routes만 HOLD.
  - API별 quota cap과 budget alert. Budget alert가 차단 장치가 아님을 문서에 유지.

  키 값·service-account JSON·서명 비밀번호는 출력·복사·커밋하지 않는다.

- [ ] **Step 2: 거부 경계를 먼저 확인한다**

  허용하지 않은 REST API·OAuth scope는 403인지 확인한다. 허용하지 않은 web origin과 잘못된 Android SHA는 각 loader/SDK가 사용을 거부해 지도가 unavailable이 되고, 키/토큰이 노출되지 않으며 다른 공급자로 fallback하지 않는지를 확인한다. `CN`, `ZZ`, allowlist 밖 국가, GMS 없는 Android fixture는 SDK import/Worker upstream 0회와 명시 오류를 보여야 한다.

- [ ] **Step 3: 별도 테스트 가족에서 기능 matrix를 검증한다**

  플랫폼은 Chrome PWA, iPhone 홈 화면 PWA, Android debug, Play App Signing 설치본이다. 국가는 `KR`, `JP`, `TW`, `HK`, `SG`, `VN`, `TH`, `ID`, `MY`, `PH`; 각 국가에서 지도 표시, marker/circle/route, 검색→선택→직접 pin/별칭 저장, 역지오코딩, 도보 경로, 외부 링크, offline/403/429/5xx를 확인한다. Google content가 지도 밖에 보이는 검색·주소·route container마다 attribution 위치·대비·한 줄·`translate="no"`를 확인하고, 지도 안의 SDK attribution은 가려지지 않아야 한다.

- [ ] **Step 4: 위치·안전 불변식을 교차 확인한다**

  지도 SDK와 역지오코딩을 강제로 실패시켜도 GPS 측정시각·정확도, SOS 좌표/연락 동선, 등록장소 도착/출발, force ring·remote listen·메모가 계속 동작하는지 fixture와 테스트 계정에서 확인한다. 실사용 세 기기의 역할/세션/가족 국가는 바꾸지 않는다.

- [ ] **Step 5: locale과 지도 label matrix를 확인한다**

  앱 locale과 기기 locale이 다른 조합을 포함해 지도 control·검색·주소·오류·접근성 action을 확인한다. 지도 공급자 label과 주소를 앱 번역기로 재번역하지 않는다. Chrome과 iPhone PWA에서 CSP violation 0건, 비지도 route의 Google network 요청 0건을 기록한다.

- [ ] **Step 6: 별도 가족 시간대/DST 출시 gate 증거를 확인한다**

  이 지도 계획에서 quiet hours·retention·quota·일정/도착 코드를 수정하지 않는다. 별도 승인된 시간대 계획이 가족 현지 오전 8시, retention, 일별 위치 quota, quiet hours, 일정/도착 overlap, DST forward/backward를 통과했다는 evidence가 없으면 모든 non-KR 국가는 `HOLD`다.

- [ ] **Step 7: 정책·법률·비용 gate를 통과시킨다**

  실제 billing entity 주소를 기준으로 EEA 약관·개인정보 이전을 검토하고, Google/Kakao attribution, 개인정보처리방침, API dashboard의 quota/오류/비용을 확인한다. Google 원문 response·검색어·좌표가 D1 cache/로그/분석에 없는지 샘플링한다.

- [ ] **Step 8: 통과 국가만 allowlist에 열고 전체 검증을 반복한다**

  allowlist 변경은 자동으로 중국을 제외한 전 세계를 여는 wildcard가 아니라 Task 11에서 PASS한 국가 코드만 추가한다. 변경 후 Task 10의 전체 명령과 `node scripts/verify-google-maps-release-readiness.mjs --mode=release`를 다시 실행한다.

- [ ] **Step 9: 배포 전 사용자 승인을 받고 순서대로 적용한다**

  D1 preflight → additive migrations → readiness readback → Worker → Pages → Android 후보 순서다. 이 계획 자체는 배포 권한을 부여하지 않으므로 별도 승인 없이는 실행하지 않는다. 실사용 기기 debug 확인을 별도 승인받은 경우에만 A17은 `npm run android:install:debug -- RFKL40DP73J`, razr는 `npm run android:install:debug -- ZY22H9VTQD`, 역할을 먼저 확인한 S25는 `npm run android:install:debug -- R5CY521CFNZ`를 사용한다.

- [ ] **Step 10: 최종 증거 커밋과 출시 판정을 기록한다**

  각 국가를 `PASS|HOLD`와 이유로 기록하고, 하나라도 필수 항목이 실패하면 글로벌 출시는 `HOLD`다. 좌표·검색어·사용자 ID·키 없이 hash/version/status만 보존한다.

  Commit: `docs: Google 지도 국가별 출시 검증을 기록한다`

## 최종 완료 조건

- [ ] `npm run i18n:verify`가 계속 통과하고 비지도 기능은 번역/formatter 외 동작 변경이 없다.
- [ ] 화면과 공통 client에서 Kakao 직접 의존과 `/api/kakao/*` 호출이 사라지고 한국 adapter/legacy Worker shim에만 남는다.
- [ ] KR은 기존 Kakao 동작, 저장 가능 ISO 비한국 국가는 Google web/native, `ZZ`·비표준 코드는 외부 호출 없는 미지원 UI다.
- [ ] 검색·역지오코딩·도보 경로·외부 링크까지 같은 정책을 사용하며 지도 renderer만 Google인 혼합 상태가 없다.
- [ ] 지도 장애에서도 GPS·SOS·위치 이력·등록장소 상태머신이 계속 동작한다.
- [ ] 기존 장소/이벤트/메모/친구놀이 ID와 legacy bytes가 보존된다.
- [ ] Google Place ID·주소·provider metadata와 친구놀이 v2 schema를 업무 데이터에 새로 저장하지 않는다.
- [ ] Google 자격 분리·application/API restriction·quota·비용·로그/캐시 최소수집·법적 고지가 검증된다.
- [ ] 앱·Worker·Android 전체 자동 테스트와 별도 테스트 가족 실API matrix가 통과한다.
- [ ] 별도 가족 시간대/DST gate가 완료되고 증거가 연결돼 있다.
- [ ] 자격 미제공, 시간대 gate 미완료 또는 한 국가라도 필수 matrix 실패 시 “글로벌 출시 가능”으로 보고하지 않는다.

## 공식 구현 참고

- Maps JavaScript loader: https://developers.google.com/maps/documentation/javascript/load-maps-js-api
- Places autocomplete/session tokens: https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
- Place Details: https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places/get
- Geocoding v4 reverse: https://developers.google.com/maps/documentation/geocoding/reverse-geocoding
- Routes field masks: https://developers.google.com/maps/documentation/routes/choose_fields
- Android SDK key setup: https://developers.google.com/maps/documentation/android-sdk/config
- Capacitor Google Maps `8.0.1`: https://github.com/ionic-team/capacitor-google-maps/tree/262a5e4c49e71f0bd95400a67bac4b644513041f
