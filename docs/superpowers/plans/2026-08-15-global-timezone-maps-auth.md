# Global Timezone Maps Auth Implementation Plan

> **실행 중지 안내(2026-08-26):** 이 계획의 Mapbox 관련 단계는 실행하지 않는다. 사용자가
> `KR=Kakao`, 승인된 비중국 국가=`Google Maps`, `CN/ZZ=미지원`으로 변경을 확정했다.
> 지도 구현은 `docs/superpowers/specs/2026-08-26-global-google-maps-location-design.md` 검토 승인 후 작성할
> 새 Google Maps 구현 계획을 따른다. 국가·시간대·인증의 비지도 계약은 새 계획에서 재사용한다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신규 가족의 국가·IANA 시간대를 명시적으로 저장하고 가족 현지 시간 기준 기능을 정확하게 계산하며, 한국 Kakao/해외 Mapbox 지도와 국가별 로그인 가용성을 기존 가족·장소·페어링 계약을 깨지 않고 제공한다.

**Architecture:** 가족의 `country_code`와 `time_zone`은 서버 정본으로 두고 기존 가족은 `KR`/`Asia/Seoul`로 보존한다. 시간 계산은 UTC timestamp를 저장한 채 목적별 zone resolver를 통과시키며, 한국 가격 정책처럼 의도적으로 KST인 규칙은 별도 정책 함수에 남긴다. 지도 소비 화면은 `FamilyMap`과 공급자 중립 장소 식별자를 사용하고, KR은 기존 Kakao adapter, 승인된 해외 국가는 Mapbox adapter를 선택한다. 인증 화면은 가족 국가가 정해지기 전 기기에서 명시 선택한 국가를 사용해 공급자 가용성만 제어하며, 서버 인증·아이 페어링 보안 계약은 그대로 유지한다.

**Tech Stack:** React 19, TypeScript strict, Cloudflare Worker/D1, Intl.DateTimeFormat, Temporal-compatible pure helpers, Kakao Maps SDK, Mapbox GL JS/Geocoding/Directions APIs, Capacitor 8, Node test runner

## Global Constraints

- 이 계획은 `2026-08-15-global-i18n-web.md` 전체 gate 통과 뒤 실행하며 새 지역·지도·인증 문구도 기존 locale catalog와 browser QA harness를 사용한다.
- 기존 가족은 migration 뒤에도 정확히 `KR`와 `Asia/Seoul`로 동작해야 한다. locale, IP, 전화번호로 기존 가족의 국가나 시간대를 추정해 덮어쓰지 않는다.
- 신규 가족은 지원 국가와 유효한 IANA time zone을 사용자가 명시적으로 선택해야 하며 브라우저 zone은 제안값일 뿐 서버 정본이 아니다.
- 초기 지도 QA 국가는 `KR`, `JP`, `TW`, `HK`, `SG`, `VN`, `TH`, `ID`, `MY`, `PH`다. 중국 본토(`CN`)는 초기 공식 지도 지원 국가에 포함하지 않는다.
- 지도 공급자는 `KR → kakao`, 위 해외 QA 국가 → `mapbox`다. 공급자 실패 시 다른 공급자의 잘못된 장소 ID로 자동 전환하지 않는다.
- `saved_places`, `academies`, `public_places`의 기존 식별자는 보존한다. legacy 행은 읽을 때만 Kakao로 해석하고 명시적 재저장 전에는 원본을 수정하지 않는다.
- 위치 좌표·주소·검색어·지도 토큰을 분석 이벤트나 구조화 로그에 기록하지 않는다. Mapbox secret token은 Worker에만 두고 브라우저에는 origin 제한 public token만 전달한다.
- UTC timestamp와 기존 0-indexed 비패딩 `date_key` 인코딩을 바꾸지 않는다. `date_key` 생성·해석은 계속 `src/transform/dateKey.ts` 경유다.
- 조용한 시간 `[start,end)` 경계, 긴급 우회 목록, 자녀별 식별자, 위치 티어, 장소 출입 상태머신과 10분 dedupe 계약을 유지한다.
- Google 로그인은 전체 지원 국가에서 노출한다. 한국 전화 OTP·Kakao·Naver는 `KR`에서만 노출한다. 아이 pair code 경로는 국가와 무관하게 유지한다.
- 프로덕션 D1 migration·Worker/Pages 배포·secret 변경·스토어 업로드는 이 계획의 자동 실행 범위가 아니다.
- 실기기 검증은 최종 승인 시 A17(`RFKL40DP73J`) 부모와 razr(`ZY22H9VTQD`) 아이만 `adb install -r`로 수행한다. S25에는 어떤 adb 접근도 하지 않는다.
- 기존 `output/store-ui-candidates-v1/`, `artifacts/`, 사용자 staged/unstaged 변경을 건드리거나 넓은 경로로 stage하지 않는다.
- 신규 `worker/tests/*.test.mjs`가 Worker TypeScript를 import하면 파일 첫 부분에서 `./helpers/tsModuleResolve.mjs`를 직접 import한다. 존재하지 않는 root 공용 loader를 CLI `--import`로 가정하지 않는다.

---

## File Structure

### New files

- `worker/db/global-family-context.sql` — 가족 국가·시간대 및 알림 설정 시간대 additive migration
- `worker/db/map-provider-place-ids.sql` — 기존 장소 테이블의 공급자 식별자 additive migration
- `worker/lib/region.ts` — 국가 allowlist, 기본 time zone, 지도 공급자 결정
- `worker/lib/timeZone.ts` — IANA zone 검증, 현지 날짜·분·하루 범위 순수 함수
- `worker/routes/mapbox.ts` — 인증된 geocoding/reverse/directions proxy
- `worker/lib/mapbox.ts` — Mapbox request builder, 응답 축소, timeout/error mapping
- `src/region/region.ts` — 클라이언트 국가·zone 타입, 선택 제안, 표시 model
- `src/transform/globalAuthAvailability.ts` — 국가별 로그인 수단 노출 순수 함수
- `src/maps/types.ts` — 지도/장소/경로 공급자 중립 계약
- `src/maps/provider.ts` — 가족 국가에서 지도 adapter 선택
- `src/maps/FamilyMap.tsx` — 소비 화면 공용 지도 facade
- `src/maps/providers/kakao/KakaoMapAdapter.tsx` — 기존 KakaoMap adapter
- `src/maps/providers/mapbox/MapboxMap.tsx` — Mapbox 지도 adapter
- `src/maps/providers/mapbox/mapbox.css` — Mapbox canvas/control 접근성 스타일
- `src/lib/mapboxMap.ts` — public token loader와 Worker geocoding client
- `src/screens/feature/RegionalSettings.tsx`
- `src/screens/feature/RegionalSettings.css`
- `docs/operations/global-time-boundaries.md` — zone별 정책 분류와 운영 확인 절차
- `docs/operations/mapbox-readiness.md` — 토큰 제한·개인정보·장애·비용 gate
- `docs/operations/global-auth-readiness.md` — Google 글로벌 로그인과 KR-only 인증 수단의 외부 설정 gate
- `tests/regionPolicy.test.ts`
- `tests/timeZonePolicy.test.ts`
- `tests/globalAuthAvailability.test.ts`
- `tests/mapProvider.test.ts`
- `tests/mapConsumerWiring.test.mjs`
- `worker/tests/globalFamilyContextMigration.test.mjs`
- `worker/tests/familyRegionRoutes.test.mjs`
- `worker/tests/notificationTimeZone.test.mjs`
- `worker/tests/mapProviderPlaceIdsMigration.test.mjs`
- `worker/tests/mapboxRoutes.test.mjs`

### Modified files

- `cloudflare/schema_d1.sql`
- `worker/types.ts`, `worker/index.ts`, `worker/lib/healthReadiness.ts`
- `worker/routes/family.ts`, `worker/routes/notif-settings.ts`
- `worker/lib/notificationQuietHours.ts`, `worker/routes/push-notify.ts`
- 가족 현지 하루를 사용하는 `worker/routes/location.ts`, `worker/cron/location-history-retention.ts`, `worker/routes/rest-shim-rpc.ts`, `worker/lib/locationHistoryIngestQuota.ts`
- `worker/routes/ai-chat-data.ts`, `worker/routes/ai.ts`, `worker/routes/ai-proactive.ts`, `worker/routes/ai-child-chat.ts`, `worker/shared/aiCredits.js`, `worker/lib/webAiCreditBillingService.ts`, `worker/routes/google-play-verify.ts`
- `worker/lib/scheduleArrivalOverlap.ts`, `worker/lib/legacyScheduleAlertEvidence.ts`, `worker/shared/unregisteredStay.js`, `worker/cron/registered-place-geofence-check.ts`, `worker/cron/unregistered-stay-check.ts`
- `worker/routes/saved-places.ts`, `worker/routes/academies.ts`, `worker/routes/playdate.ts`
- `src/lib/api/endpoints/family.ts`, `src/lib/api/endpoints/notifications.ts`
- `src/queries/useFamily.ts`, `src/queries/useNotifications.ts`
- `src/screens/onboarding/Onboarding.tsx`, `src/screens/onboarding/Onboarding.css`
- `src/screens/parent/ParentSettings.tsx`, `src/app/App.tsx`
- `src/components/KakaoMap.tsx`, `src/components/MapPickerSheet.tsx`
- `src/screens/parent/ParentLocation.tsx`
- `src/screens/feature/PlaceForm.tsx`, `src/screens/feature/DangerZoneForm.tsx`, `src/screens/feature/RouteView.tsx`, `src/screens/feature/SosReceive.tsx`
- `src/screens/shared/MemoChat.tsx`, `src/screens/parent/ParentHome.tsx`
- `src/transform/locationHistoryWindow.ts`, `src/transform/notificationQuietHours.ts`, `src/transform/stickerBook.ts`
- `src/lib/api/endpoints/ai.ts`
- `src/lib/native/notificationQuietHours.ts`
- `android/app/src/main/java/com/hyeni/calendar/NotificationQuietHoursStore.java`
- `android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java`
- `android/app/src/test/java/com/hyeni/calendar/NotificationQuietHoursStoreTest.java`
- `package.json`, `package-lock.json`, `.env.example`, `src/vite-env.d.ts`, `src/config/env.ts`, `worker/.dev.vars.example`, `worker/wrangler.toml`

### Existing regression files that remain authoritative

- `src/transform/dateKey.ts`, `tests/memoThreadWindow.test.ts`, `tests/scheduleReliability.test.ts`
- `worker/lib/registeredPlacePresenceDedupe.ts`
- `worker/tests/registeredPlacePresenceDedupe.test.mjs`
- `worker/tests/registeredPlaceLatency.test.mjs`
- `tests/notificationQuietHours.test.ts`
- `worker/tests/notificationQuietHours.test.mjs`
- `tests/kakaoMapDomSafety.test.mjs`, `tests/mapPerf.test.ts`
- `tests/onboardingAuthAdoption.test.ts`, `worker/tests/oauthRouteSecurity.test.mjs`

### Task 1: 국가·시간대 정본과 additive schema

**Files:**
- Create: `worker/db/global-family-context.sql`
- Create: `worker/lib/region.ts`
- Create: `tests/regionPolicy.test.ts`
- Create: `worker/tests/globalFamilyContextMigration.test.mjs`
- Modify: `cloudflare/schema_d1.sql`
- Modify: `worker/lib/healthReadiness.ts`

- [ ] `tests/regionPolicy.test.ts`에 정확한 지원 국가, 국가별 기본 zone, 지도 공급자, `CN` 비지원 결과를 먼저 작성한다.

```ts
assert.deepEqual(SUPPORTED_COUNTRY_CODES, ["KR", "JP", "TW", "HK", "SG", "VN", "TH", "ID", "MY", "PH"]);
assert.equal(regionPolicy("KR").mapProvider, "kakao");
assert.equal(regionPolicy("JP").mapProvider, "mapbox");
assert.equal(regionPolicy("CN"), null);
```

- [ ] `worker/tests/globalFamilyContextMigration.test.mjs`에 빈 DB bootstrap, 기존 family/settings 행 보존, 적용 전 컬럼 preflight, 정확히 1회 적용, 적용 후 readiness 반복 검사, CHECK 거부를 작성한다. `ALTER TABLE ADD COLUMN` SQL 자체를 두 번 실행하는 것을 멱등으로 가정하지 않는다.
- [ ] 테스트를 실행해 새 모듈과 컬럼 부재로 실패하는지 확인한다.

Run: `node --test tests/regionPolicy.test.ts worker/tests/globalFamilyContextMigration.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` 또는 `no such column: country_code`로 실패.

- [ ] `worker/lib/region.ts`에 다음 정본을 구현한다. browser locale/IP 추론 API는 두지 않는다.

```ts
export type SupportedCountryCode = "KR" | "JP" | "TW" | "HK" | "SG" | "VN" | "TH" | "ID" | "MY" | "PH";
export type MapProvider = "kakao" | "mapbox";
export interface RegionPolicy { countryCode: SupportedCountryCode; defaultTimeZone: string; mapProvider: MapProvider }
export function parseSupportedCountryCode(value: unknown): SupportedCountryCode | null;
export function regionPolicy(countryCode: SupportedCountryCode): RegionPolicy;
```

- [ ] `worker/db/global-family-context.sql`에 `families.country_code TEXT NOT NULL DEFAULT 'KR'`, `families.time_zone TEXT NOT NULL DEFAULT 'Asia/Seoul'`, `notification_settings.time_zone TEXT NOT NULL DEFAULT 'Asia/Seoul'`만 additive로 추가한다. 지원 국가 CHECK를 기존 테이블 재구축으로 넣지 말고 route validator와 canonical bootstrap schema에 둔다.
- [ ] `cloudflare/schema_d1.sql`의 신규 설치 schema와 `worker/lib/healthReadiness.ts`의 required column 목록을 같은 계약으로 갱신한다.
- [ ] migration 테스트와 canonical/health 회귀를 통과시킨다.

Run: `node --test tests/regionPolicy.test.ts worker/tests/globalFamilyContextMigration.test.mjs worker/tests/canonicalSchemaBootstrap.test.mjs worker/tests/healthReadiness.test.mjs`

Expected: 전체 통과, 기존 행은 `KR|Asia/Seoul`.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
git diff --check -- worker/db/global-family-context.sql worker/lib/region.ts tests/regionPolicy.test.ts worker/tests/globalFamilyContextMigration.test.mjs cloudflare/schema_d1.sql worker/lib/healthReadiness.ts
git add -- worker/db/global-family-context.sql worker/lib/region.ts tests/regionPolicy.test.ts worker/tests/globalFamilyContextMigration.test.mjs cloudflare/schema_d1.sql worker/lib/healthReadiness.ts
git commit --only -- worker/db/global-family-context.sql worker/lib/region.ts tests/regionPolicy.test.ts worker/tests/globalFamilyContextMigration.test.mjs cloudflare/schema_d1.sql worker/lib/healthReadiness.ts -m "가족 국가와 시간대 정본을 추가한다"
```

### Task 2: 신규 가족 선택과 부모 지역 설정

**Files:**
- Create: `src/region/region.ts`
- Create: `src/screens/feature/RegionalSettings.tsx`
- Create: `src/screens/feature/RegionalSettings.css`
- Create: `worker/tests/familyRegionRoutes.test.mjs`
- Modify: `worker/routes/family.ts`
- Modify: `src/lib/api/endpoints/family.ts`
- Modify: `src/queries/useFamily.ts`
- Modify: `src/screens/onboarding/Onboarding.tsx`
- Modify: `src/screens/onboarding/Onboarding.css`
- Modify: `src/screens/parent/ParentSettings.tsx`
- Modify: `src/app/App.tsx`
- Modify: `tests/routeLazyLoading.test.mjs`
- Modify: `tests/routeQualityMatrix.test.mjs`
- Modify: `tests/helpers/routeContract.mjs`

- [ ] `worker/tests/familyRegionRoutes.test.mjs`에 신규 가족 setup의 country/zone 필수성, 잘못된 country/zone 400, existing family 불변, parent-only patch, 다른 가족 수정 403을 먼저 작성한다.
- [ ] `src/region/region.ts` 단위 테스트를 `tests/regionPolicy.test.ts`에 추가해 `Intl.DateTimeFormat().resolvedOptions().timeZone`은 제안값으로만 반환하고 명시 선택 전에는 `confirmed:false`임을 고정한다.
- [ ] 테스트를 실행해 request/response 필드 부재로 실패하는지 확인한다.

Run: `node --test tests/regionPolicy.test.ts worker/tests/familyRegionRoutes.test.mjs`

Expected: setup payload 또는 `/region` route 부재로 실패.

- [ ] `src/region/region.ts`에 `RegionDraft`, 국가별 zone 후보, Intl zone 제안, 표시 label model을 구현한다. 나라 이름 자체도 i18n message ID로 반환한다.

```ts
export interface RegionDraft {
  countryCode: SupportedCountryCode | null;
  timeZone: string | null;
  confirmed: boolean;
}
export function suggestRegion(deviceTimeZone: string | null): RegionDraft;
```

- [ ] `/api/family/setup`은 신규 family insert와 같은 transaction/batch에서 country/zone을 저장하고, 기존 family 재호출 시 값을 덮지 않도록 한다. 응답의 family shape에도 `countryCode`, `timeZone`을 추가한다.
- [ ] parent-only `PATCH /api/family/region`을 추가한다. 가족 country 변경은 map provider가 바뀔 수 있음을 응답에 명시하고, zone 변경은 이후 계산에만 적용하며 과거 UTC timestamp/date_key를 rewrite하지 않는다.
- [ ] 온보딩에서 부모가 가족 생성 전에 국가와 time zone을 명시 확인하도록 한다. 아이 pair flow와 기존 로그인 후 family가 있는 사용자는 이 단계를 거치지 않는다.
- [ ] `RegionalSettings`를 `/regional-settings` lazy route로 추가하고 부모 설정에 현재 국가/zone, 변경 영향, OS 설정을 자동 변경하지 않는다는 문구를 표시한다.
- [ ] route contract의 route 수·역할·lazy import 기대값을 실제 신규 route에 맞게 갱신한다.
- [ ] 테스트와 typecheck를 통과시킨다.

Run: `node --test tests/regionPolicy.test.ts tests/routeLazyLoading.test.mjs tests/routeQualityMatrix.test.mjs worker/tests/familyRegionRoutes.test.mjs && npm run typecheck`

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('src/region/region.ts','src/screens/feature/RegionalSettings.tsx','src/screens/feature/RegionalSettings.css','worker/tests/familyRegionRoutes.test.mjs','worker/routes/family.ts','src/lib/api/endpoints/family.ts','src/queries/useFamily.ts','src/screens/onboarding/Onboarding.tsx','src/screens/onboarding/Onboarding.css','src/screens/parent/ParentSettings.tsx','src/app/App.tsx','tests/routeLazyLoading.test.mjs','tests/routeQualityMatrix.test.mjs','tests/helpers/routeContract.mjs')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "가족 지역 선택과 설정 화면을 연결한다"
```

### Task 3: IANA time zone 계산과 조용한 시간

**Files:**
- Create: `worker/lib/timeZone.ts`
- Create: `tests/timeZonePolicy.test.ts`
- Create: `worker/tests/notificationTimeZone.test.mjs`
- Modify: `worker/lib/notificationQuietHours.ts`
- Modify: `worker/routes/notif-settings.ts`
- Modify: `worker/routes/push-notify.ts`
- Modify: `src/lib/api/endpoints/notifications.ts`
- Modify: `src/queries/useNotifications.ts`
- Modify: `src/queries/notificationQuietHoursRuntime.ts`
- Modify: `src/transform/notificationQuietHours.ts`
- Modify: `src/lib/native/notificationQuietHours.ts`
- Modify: `src/app/NativeBootstrap.tsx`
- Modify: `src/screens/feature/NotificationSettings.tsx`
- Modify: `src/screens/feature/NotificationSettings.css`
- Modify: `src/screens/child/ChildSettings.tsx`
- Modify: `android/app/src/main/java/com/hyeni/calendar/NotificationQuietHoursStore.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java`
- Modify: `android/app/src/test/java/com/hyeni/calendar/NotificationQuietHoursStoreTest.java`
- Modify: `android/app/src/test/java/com/hyeni/calendar/NotificationQuietHoursPolicyTest.java`
- Modify: `worker/tests/notificationQuietHours.test.mjs`
- Modify: `worker/tests/notificationQuietHoursWiring.test.mjs`
- Modify: `tests/androidNotificationQuietHoursWiring.test.mjs`
- Modify: `tests/notificationQuietHours.test.ts`
- Modify: `tests/notificationQuietHoursUi.test.mjs`
- Modify: `tests/notificationSettingsReliability.test.ts`

- [ ] `tests/timeZonePolicy.test.ts`에 유효/무효 IANA zone, 현지 날짜, DST forward/backward, 자정 경계, `[start,end)` 분 계산을 먼저 작성한다. 고정 offset 문자열을 IANA zone으로 받지 않는다.
- [ ] Worker/Android 회귀에 설정별 `timeZoneId`, 미설정 legacy `Asia/Seoul`, 긴급/SOS/미도착/위험/force-ring/remote-listen 우회를 추가한다. 부모 UI에는 수신 계정별 time zone 선택·저장을, 아이 UI에는 자기 계정 time zone 읽기 전용 표시를 단언한다.
- [ ] 테스트를 실행해 `minuteOfDayInTimeZone` 부재와 고정 KST 기대값으로 실패하는지 확인한다.

Run: `node --test tests/timeZonePolicy.test.ts tests/notificationQuietHours.test.ts worker/tests/notificationTimeZone.test.mjs worker/tests/notificationQuietHours.test.mjs worker/tests/notificationQuietHoursWiring.test.mjs`

Expected: 신규 time zone helper 부재로 실패.

- [ ] `worker/lib/timeZone.ts`를 formatter cache와 `formatToParts` 기반 순수 함수로 구현한다. 잘못된 zone은 저장 시 거부하고 runtime DB 오염은 fail-closed 상태로 반환한다.

```ts
export function isValidIanaTimeZone(value: unknown): value is string;
export function localDateParts(atMs: number, timeZone: string): { year: number; month: number; day: number };
export function minuteOfDayInTimeZone(atMs: number, timeZone: string): number;
export function zonedDayWindowUtc(localDate: string, timeZone: string, boundaryMinute?: number): { fromMs: number; toMs: number };
```

- [ ] `notification_settings.time_zone`을 읽기/쓰기 응답에 포함한다. 신규·legacy 설정의 초기값은 해당 `families.time_zone`으로 채우되, 이후 parent가 자기 계정과 활성 아이 계정에 유효한 IANA zone을 각각 저장할 수 있게 한다. Worker는 target user가 같은 family인지 다시 확인하고 지원하지 않거나 유효하지 않은 zone만 거부한다. parent 외 역할의 변경과 body의 임의 target/family 주입은 거부한다.
- [ ] `NotificationSettings`의 부모/활성 아이 대상 draft에 `timeZone`을 포함하고, 가족 zone과 기기 zone을 우선 후보로 보여준 뒤 IANA 검색 선택으로 확정한다. target을 바꿀 때 이전 target의 미저장 zone이 섞이지 않도록 session-bound source comparison에도 zone을 포함한다. `ChildSettings`는 서버가 반환한 자기 계정 zone과 quiet-hour 범위를 읽기 전용으로 보여준다.
- [ ] `minuteOfDayInSeoul` 호출을 `minuteOfDayInTimeZone(atMs, setting.timeZone)`으로 교체한다. 함수 이름을 호환 alias로 남기지 않아 새 호출이 다시 KST에 고정되지 않게 한다.
- [ ] Android `NotificationQuietHoursStore`의 session-bound payload에 `timeZoneId`를 필수로 포함하되 legacy payload에는 `Asia/Seoul`만 적용한다. `NotificationHelper`는 게시·채널·권한 검사보다 먼저 이 값을 사용한다.
- [ ] UI range label은 한국어 조합 함수가 아니라 i18n formatter가 받은 `HH:mm` 두 값을 message variable로 표시하도록 반환 model을 바꾼다.
- [ ] JS, Worker, Android tests를 통과시킨다.

Run:

```powershell
node --test tests/timeZonePolicy.test.ts tests/notificationQuietHours.test.ts tests/notificationQuietHoursUi.test.mjs tests/notificationSettingsReliability.test.ts tests/androidNotificationQuietHoursWiring.test.mjs worker/tests/notificationTimeZone.test.mjs worker/tests/notificationQuietHours.test.mjs worker/tests/notificationQuietHoursWiring.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Push-Location android
.\gradlew.bat testDebugUnitTest --tests com.hyeni.calendar.NotificationQuietHoursStoreTest --tests com.hyeni.calendar.NotificationQuietHoursPolicyTest
$gradleExit = $LASTEXITCODE
Pop-Location
if ($gradleExit -ne 0) { exit $gradleExit }
```

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('worker/lib/timeZone.ts','tests/timeZonePolicy.test.ts','worker/tests/notificationTimeZone.test.mjs','worker/lib/notificationQuietHours.ts','worker/routes/notif-settings.ts','worker/routes/push-notify.ts','src/lib/api/endpoints/notifications.ts','src/queries/useNotifications.ts','src/queries/notificationQuietHoursRuntime.ts','src/transform/notificationQuietHours.ts','src/lib/native/notificationQuietHours.ts','src/app/NativeBootstrap.tsx','src/screens/feature/NotificationSettings.tsx','src/screens/feature/NotificationSettings.css','src/screens/child/ChildSettings.tsx','android/app/src/main/java/com/hyeni/calendar/NotificationQuietHoursStore.java','android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java','android/app/src/test/java/com/hyeni/calendar/NotificationQuietHoursStoreTest.java','android/app/src/test/java/com/hyeni/calendar/NotificationQuietHoursPolicyTest.java','worker/tests/notificationQuietHours.test.mjs','worker/tests/notificationQuietHoursWiring.test.mjs','tests/androidNotificationQuietHoursWiring.test.mjs','tests/notificationQuietHours.test.ts','tests/notificationQuietHoursUi.test.mjs','tests/notificationSettingsReliability.test.ts')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "알림 조용한 시간을 계정별 시간대로 계산한다"
```

### Task 4: 가족 현지 하루 사용처 분류와 이관

**Files:**
- Create: `docs/operations/global-time-boundaries.md`
- Modify: `worker/routes/location.ts`
- Modify: `worker/cron/location-history-retention.ts`
- Modify: `worker/routes/push-notify.ts`
- Modify: `worker/lib/scheduleArrivalOverlap.ts`
- Modify: `worker/cron/registered-place-geofence-check.ts`
- Modify: `worker/cron/unregistered-stay-check.ts`
- Modify: `worker/routes/rest-shim-rpc.ts`
- Modify: `worker/lib/locationHistoryIngestQuota.ts`
- Modify: `worker/routes/ai-chat-data.ts`
- Modify: `worker/routes/ai.ts`
- Modify: `worker/routes/ai-proactive.ts`
- Modify: `worker/routes/ai-child-chat.ts`
- Modify: `worker/shared/aiCredits.js`
- Modify: `worker/lib/webAiCreditBillingService.ts`
- Modify: `worker/routes/google-play-verify.ts`
- Modify: `worker/lib/legacyScheduleAlertEvidence.ts`
- Modify: `worker/shared/unregisteredStay.js`
- Verify only: `worker/cron/teacher-notification-batch.ts` — production-disabled 한국 학교 일정은 `fixed_kst_policy`로 문서화하고 활성화하지 않는다.
- Verify only: `worker/lib/familyLifecycleFunnel.ts` — 운영 일별 분석 경계는 제품의 가족 날짜와 분리된 `fixed_kst_policy`로 문서화한다.
- Modify: `src/transform/locationHistoryWindow.ts`
- Modify: `src/transform/stickerBook.ts`
- Modify: `src/lib/api/endpoints/ai.ts`
- Modify: `src/screens/feature/DailySafetyReport.tsx`
- Modify: `src/screens/feature/WeeklyFamilyReport.tsx`
- Modify: `tests/timeZonePolicy.test.ts`
- Modify: `tests/locationHistoryWindow.test.ts`
- Modify: `tests/dailyReportView.test.ts`
- Modify: `tests/weeklyReportView.test.ts`
- Modify: `tests/memoThreadWindow.test.ts`
- Modify: `tests/scheduleReliability.test.ts`
- Modify: `worker/tests/locationHistoryRpcBatch.test.mjs`
- Modify: `worker/tests/locationHistoryRetention.test.mjs`
- Modify: `worker/tests/scheduleNotificationReliability.test.mjs`
- Modify: `worker/tests/registeredPlaceGeofence.test.mjs`
- Modify: `worker/tests/unregisteredStayNotificationSettings.test.mjs`
- Modify: `worker/tests/aiQuotaServerDate.test.mjs`
- Modify: `worker/tests/scheduleArrivalOverlap.test.mjs`
- Modify: `worker/tests/legacyScheduleAlertEvidence.test.mjs`

- [ ] `rg -n "Asia/Seoul|KST|\+ 9|9 \* 60|setHours\(|toLocaleDateString\(" src worker tests` 결과를 `docs/operations/global-time-boundaries.md` 표에 한 항목도 빠뜨리지 않고 분류한다.

분류는 다음 네 값만 사용한다.

| 분류 | 적용 zone | 예시 |
|---|---|---|
| `family_day` | `families.time_zone` | 오늘 경로, 오늘 리포트, 일정 리마인더 |
| `recipient_local` | `notification_settings.time_zone` | 조용한 시간 |
| `fixed_kst_policy` | `Asia/Seoul` | 2026-08-01 가격 grandfather 전환 시각 |
| `utc_duration` | UTC epoch | 5분 요청 창, 10분 dedupe, 60초 청취 상한 |

- [ ] 시간대별 location history 범위 테스트에 `Asia/Tokyo`, `Asia/Bangkok`, `Asia/Jakarta`, `Asia/Kuala_Lumpur`, DST 검증용 `America/Los_Angeles` 순수 helper 사례를 추가한다. 출시 국가에 DST가 없더라도 helper 회귀에는 DST를 포함한다.
- [ ] 일정/arrival/report cron 테스트에 같은 UTC 시각이 서로 다른 가족 local date로 분리되는 사례와 한 family 실패가 다른 family batch를 막지 않는 사례를 추가한다.
- [ ] AI 일일 quota·credit ledger와 위치 ingest quota는 인증된 가족의 zone으로 날짜를 계산하고, client가 보낸 날짜나 locale로 quota 경계를 바꾸지 못하게 한다. Google Play 가격 grandfather와 운영 KST 분석일은 그대로 두는 교차 테스트를 추가한다.
- [ ] 테스트를 실행해 KST 고정 결과로 실패하는지 확인한다.

Run: `node --test tests/timeZonePolicy.test.ts tests/locationHistoryWindow.test.ts tests/dailyReportView.test.ts tests/weeklyReportView.test.ts tests/memoThreadWindow.test.ts tests/scheduleReliability.test.ts worker/tests/locationHistoryRpcBatch.test.mjs worker/tests/locationHistoryRetention.test.mjs worker/tests/scheduleNotificationReliability.test.mjs worker/tests/registeredPlaceGeofence.test.mjs worker/tests/unregisteredStayNotificationSettings.test.mjs worker/tests/aiQuotaServerDate.test.mjs worker/tests/scheduleArrivalOverlap.test.mjs worker/tests/legacyScheduleAlertEvidence.test.mjs`

Expected: 신규 zone 단언이 KST 고정 결과와 달라 실패.

- [ ] `family_day`로 분류한 경로만 family zone으로 교체한다. 위치 티어의 오전 8시 시작은 `boundaryMinute=480`을 해당 family zone에 적용하고, 일정·AI 일일 quota·위치 ingest quota·체류 시각은 각 route가 인증 후 읽은 가족 zone을 필수 인자로 전달한다.
- [ ] `fixed_kst_policy`와 `utc_duration`은 이름이 드러나는 helper/상수로 유지하며 일반-purpose `nowInFamilyZone`으로 우회하지 않는다.
- [ ] date-only API가 family zone 없이는 호출되지 않도록 함수 인자에서 `timeZone`을 필수화한다. 기존 `date_key` 직렬화는 그대로 둔다.
- [ ] 문서 표의 각 항목에 바뀐 함수와 회귀 테스트 이름을 연결하고 미분류 검색 결과가 0인지 확인한다. 주석/문서에 의도적으로 남은 KST는 allowlist 표와 일치해야 한다.
- [ ] 전체 관련 회귀와 typecheck를 통과시킨다.

Run: `npm run typecheck && npm run test:worker && npm test`

Expected: repository의 현재 test script 계약대로 전체 통과.

- [ ] 이 태스크에서 실제로 수정한 시간 경계 파일만 명시해 커밋한다. `git status --short`에서 사용자 변경과 섞인 파일이 있으면 중단하고 해당 diff를 분리 검토한다.

### Task 5: 공급자 중립 지도 facade와 Kakao adapter

**Files:**
- Create: `src/maps/types.ts`
- Create: `src/maps/provider.ts`
- Create: `src/maps/FamilyMap.tsx`
- Create: `src/maps/providers/kakao/KakaoMapAdapter.tsx`
- Create: `tests/mapProvider.test.ts`
- Create: `tests/mapConsumerWiring.test.mjs`
- Modify: `src/components/KakaoMap.tsx`
- Modify: `src/components/MapPickerSheet.tsx`
- Modify: `src/screens/parent/ParentLocation.tsx`
- Modify: `src/screens/feature/PlaceForm.tsx`
- Modify: `src/screens/feature/DangerZoneForm.tsx`
- Modify: `src/screens/feature/RouteView.tsx`
- Modify: `src/screens/feature/SosReceive.tsx`
- Modify: `src/screens/shared/MemoChat.tsx`
- Modify: `src/screens/parent/ParentHome.tsx`

- [ ] `tests/mapProvider.test.ts`에 provider 선택, 공급자 식별자 discriminated union, 지원하지 않는 국가의 명시적 unavailable 결과를 먼저 작성한다.

```ts
type ProviderPlaceRef =
  | { provider: "kakao"; providerPlaceId: string }
  | { provider: "mapbox"; providerPlaceId: string };

assert.equal(resolveMapProvider("KR").kind, "ready");
assert.deepEqual(resolveMapProvider("CN"), { kind: "unsupported_country", countryCode: "CN" });
```

- [ ] `tests/mapConsumerWiring.test.mjs`에 지도 소비 화면이 `KakaoMap`/`loadKakaoMaps`를 직접 import하지 않고 `FamilyMap`/provider client만 사용한다는 정적 회귀를 작성한다. adapter 파일 자체는 allowlist한다.
- [ ] 테스트를 실행해 facade 부재와 direct imports로 실패하는지 확인한다.

Run: `node --test tests/mapProvider.test.ts tests/mapConsumerWiring.test.mjs tests/kakaoMapDomSafety.test.mjs tests/mapPerf.test.ts`

Expected: 신규 모듈 부재 또는 direct import 단언 실패.

- [ ] `src/maps/types.ts`에 `MapPoint`, `MapMarker`, `MapZone`, `MapStay`, `MapRoute`, `ProviderPlaceRef`, search/reverse result를 정의한다. user-entered label은 provider 번역 대상과 분리한다.
- [ ] `FamilyMap`은 `countryCode`, center, markers/zones/stays/route, selection callback을 받고 provider loading/error/unavailable UI를 공통 message ID로 렌더한다.
- [ ] 기존 `KakaoMap` 구현을 즉시 삭제하지 않고 `KakaoMapAdapter`가 감싸도록 한다. 기존 DOM safety와 lazy warm-up 동작이 그대로 통과한 뒤에만 소비 화면 direct import를 제거한다.
- [ ] 모든 소비 화면에 current family country를 명시적으로 전달한다. SOS에서 family context를 못 읽으면 지도를 억지로 서울에 띄우지 말고 좌표 텍스트와 재시도 상태를 보여준다.
- [ ] Kakao 회귀와 typecheck를 통과시킨다.

Run: `node --test tests/mapProvider.test.ts tests/mapConsumerWiring.test.mjs tests/kakaoMapDomSafety.test.mjs tests/mapPerf.test.ts && npm run typecheck`

Expected: 전체 통과, KR 화면 동작/성능 계약 불변.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('src/maps/types.ts','src/maps/provider.ts','src/maps/FamilyMap.tsx','src/maps/providers/kakao/KakaoMapAdapter.tsx','tests/mapProvider.test.ts','tests/mapConsumerWiring.test.mjs','src/components/KakaoMap.tsx','src/components/MapPickerSheet.tsx','src/screens/parent/ParentLocation.tsx','src/screens/feature/PlaceForm.tsx','src/screens/feature/DangerZoneForm.tsx','src/screens/feature/RouteView.tsx','src/screens/feature/SosReceive.tsx','src/screens/shared/MemoChat.tsx','src/screens/parent/ParentHome.tsx')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "지도 소비 화면을 공급자 중립 구조로 전환한다"
```

### Task 6: Mapbox 지도·검색·길찾기 adapter

**Files:**
- Create: `src/maps/providers/mapbox/MapboxMap.tsx`
- Create: `src/maps/providers/mapbox/mapbox.css`
- Create: `src/lib/mapboxMap.ts`
- Create: `worker/lib/mapbox.ts`
- Create: `worker/routes/mapbox.ts`
- Create: `worker/tests/mapboxRoutes.test.mjs`
- Create: `docs/operations/mapbox-readiness.md`
- Modify: `worker/types.ts`
- Modify: `worker/index.ts`
- Modify: `worker/.dev.vars.example`
- Modify: `worker/wrangler.toml`
- Modify: `.env.example`
- Modify: `src/vite-env.d.ts`
- Modify: `src/config/env.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/mapProvider.test.ts`

- [ ] Worker route 테스트에 무인증 401, 다른 가족 403, 지원 국가만 허용, query/coordinate bounds, abort timeout, upstream 429/5xx 축소, 토큰·좌표 로그 금지, locale/worldview allowlist를 먼저 작성한다.
- [ ] client 테스트에 Mapbox chunk lazy load, `VITE_MAPBOX_PUBLIC_TOKEN`/style 설정 누락 시 fail-closed, public token이 아닌 Worker secret의 client bundle 유입 금지, user locale의 Mapbox language tag mapping을 추가한다.
- [ ] 테스트를 실행해 route/adapter 부재로 실패하는지 확인한다.

Run: `node --test tests/mapProvider.test.ts worker/tests/mapboxRoutes.test.mjs`

Expected: 신규 모듈 부재로 실패.

- [ ] `mapbox-gl`을 exact version으로 설치하고 lockfile을 함께 갱신한다. 초기 route bundle에는 포함되지 않고 Mapbox family가 지도 route를 열 때만 import되는지 bundle test에 추가한다.

Run: `npm install --save-exact mapbox-gl`

Expected: `package.json`과 `package-lock.json`에 npm registry가 반환한 exact version 기록. 실행자는 설치 직전에 Mapbox 공식 changelog와 보안 공지를 확인하고 선택된 version을 태스크 기록에 남긴다.

- [ ] `worker/lib/mapbox.ts`에 8초 timeout, URLSearchParams request builder, allowlisted response fields만 반환하는 parser를 구현한다. secret token·raw upstream body·전체 URL을 error에 포함하지 않는다.
- [ ] 인증된 `/api/maps/mapbox/search`, `/reverse`, `/directions` route를 추가한다. 서버가 canonical family country를 읽어 Mapbox 국가인지 확인하고 request의 family/country 주장을 신뢰하지 않는다.
- [ ] `MapboxMap`은 public style/token 설정이 없으면 공통 unavailable UI로 닫는다. 화면 reader label, keyboard controls, reduced-motion, attribution을 제거하지 않는다.
- [ ] map labels에는 UI locale을 Mapbox-supported tag로 정규화하고 지도 결과 주소/장소명은 사용자 콘텐츠처럼 재번역하지 않는다.
- [ ] `docs/operations/mapbox-readiness.md`에 public token URL restriction, secret scope, 비용 경보/쿼터, 데이터 처리 고지, 장애 시 좌표-only 폴백, `CN` 미지원, sandbox 검증 증거를 체크박스로 작성한다.
- [ ] tests/typecheck/build를 통과시킨다.

Run: `node --test tests/mapProvider.test.ts tests/mapConsumerWiring.test.mjs worker/tests/mapboxRoutes.test.mjs && npm run typecheck && npm run build`

Expected: 전체 통과, route bundle budget 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('src/maps/providers/mapbox/MapboxMap.tsx','src/maps/providers/mapbox/mapbox.css','src/lib/mapboxMap.ts','worker/lib/mapbox.ts','worker/routes/mapbox.ts','worker/tests/mapboxRoutes.test.mjs','docs/operations/mapbox-readiness.md','worker/types.ts','worker/index.ts','worker/.dev.vars.example','worker/wrangler.toml','.env.example','src/vite-env.d.ts','src/config/env.ts','package.json','package-lock.json','tests/mapProvider.test.ts')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "해외 가족용 Mapbox 지도를 연결한다"
```

### Task 7: 장소 공급자 식별자 additive 이관

**Files:**
- Create: `worker/db/map-provider-place-ids.sql`
- Create: `worker/tests/mapProviderPlaceIdsMigration.test.mjs`
- Modify: `cloudflare/schema_d1.sql`
- Modify: `worker/lib/healthReadiness.ts`
- Modify: `worker/routes/saved-places.ts`
- Modify: `worker/routes/academies.ts`
- Modify: `worker/routes/playdate.ts`
- Modify: `src/lib/api/endpoints/location.ts`
- Modify: `src/lib/api/endpoints/schedule.ts`
- Modify: `src/lib/api/endpoints/playdate.ts`
- Modify: `src/queries/useLocation.ts`
- Modify: `src/queries/usePlaydate.ts`
- Modify: `worker/tests/canonicalSchemaBootstrap.test.mjs`
- Modify: `worker/tests/healthReadiness.test.mjs`
- Modify: `worker/tests/registeredPlacePresenceDedupe.test.mjs`
- Modify: `worker/tests/registeredPlaceLatency.test.mjs`
- Modify: `worker/tests/playdateSessionAtomicity.test.mjs`
- Modify: `worker/tests/savedPlaceRestShimGate.test.mjs`
- Modify: `worker/tests/academyDataPremiumAccess.test.mjs`

- [ ] migration 테스트에 기존 `saved_places.public_place_id`, `public_places.kakao_place_id`, academy location JSON 보존, 적용 전 컬럼 preflight와 정확히 1회 적용, 새 provider pair, partial-null 거부를 먼저 작성한다.
- [ ] route 테스트에 legacy row의 `{provider:'kakao', providerPlaceId:legacyId}` read view, 신규 Mapbox 저장, provider mismatch 거부, 명시적 재저장 전 DB 불변을 작성한다.
- [ ] geofence/dedupe 회귀에 provider가 달라도 내부 place identity와 `placeKey`가 안정적이며 20m 중복/10분 cooldown이 변하지 않는 사례를 추가한다.
- [ ] 테스트를 실행해 신규 컬럼 부재로 실패하는지 확인한다.

Run: `node --test worker/tests/mapProviderPlaceIdsMigration.test.mjs worker/tests/registeredPlacePresenceDedupe.test.mjs worker/tests/registeredPlaceLatency.test.mjs`

Expected: `no such column: provider` 또는 신규 단언 실패.

- [ ] `worker/db/map-provider-place-ids.sql`에 실제 schema 조사 결과에 따라 `saved_places`, `academies`, `public_places`에 `provider`, `provider_place_id`를 additive로 추가한다. 기존 `public_place_id` foreign/internal ID와 `kakao_place_id`는 삭제·rename하지 않는다.
- [ ] DB가 pair CHECK를 additive로 넣을 수 없는 기존 테이블은 route에서 `(둘 다 null) OR (둘 다 non-null)`을 검증하고 health readiness가 컬럼 존재를 확인한다.
- [ ] API는 새 discriminated union을 반환하되 legacy fields를 구버전 client 호환 기간 동안 유지한다. 신규 write는 family country의 provider와 일치해야 한다.
- [ ] playdate public place lookup을 `(provider, provider_place_id)`로 바꾸되 legacy Kakao row를 후보로 함께 조회한다. 중복 발견 시 파괴적 merge를 하지 않고 기존 internal `public_places.id`를 재사용한다.
- [ ] 전체 migration/장소/출입 회귀를 통과시킨다.

Run: `node --test worker/tests/mapProviderPlaceIdsMigration.test.mjs worker/tests/canonicalSchemaBootstrap.test.mjs worker/tests/healthReadiness.test.mjs worker/tests/registeredPlacePresenceDedupe.test.mjs worker/tests/registeredPlaceLatency.test.mjs worker/tests/playdateSessionAtomicity.test.mjs worker/tests/savedPlaceRestShimGate.test.mjs worker/tests/academyDataPremiumAccess.test.mjs && npm run typecheck:worker`

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('worker/db/map-provider-place-ids.sql','worker/tests/mapProviderPlaceIdsMigration.test.mjs','cloudflare/schema_d1.sql','worker/lib/healthReadiness.ts','worker/routes/saved-places.ts','worker/routes/academies.ts','worker/routes/playdate.ts','src/lib/api/endpoints/location.ts','src/lib/api/endpoints/schedule.ts','src/lib/api/endpoints/playdate.ts','src/queries/useLocation.ts','src/queries/usePlaydate.ts','worker/tests/canonicalSchemaBootstrap.test.mjs','worker/tests/healthReadiness.test.mjs','worker/tests/registeredPlacePresenceDedupe.test.mjs','worker/tests/registeredPlaceLatency.test.mjs','worker/tests/playdateSessionAtomicity.test.mjs','worker/tests/savedPlaceRestShimGate.test.mjs','worker/tests/academyDataPremiumAccess.test.mjs')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "장소에 지도 공급자 식별자를 보존한다"
```

### Task 8: 국가별 로그인 가용성과 페어링 불변식

**Files:**
- Create: `src/transform/globalAuthAvailability.ts`
- Create: `tests/globalAuthAvailability.test.ts`
- Modify: `src/screens/onboarding/Onboarding.tsx`
- Modify: `src/screens/onboarding/Onboarding.css`
- Modify: `tests/onboardingAuthAdoption.test.ts`
- Modify: `tests/onboardingSessionGuard.test.mjs`
- Modify: `worker/tests/oauthRouteSecurity.test.mjs`

- [ ] 순수 함수 테스트에 모든 지원 국가를 table-driven으로 추가한다. `KR`은 Google+phone+Kakao+Naver, 나머지는 Google만이며 pair code는 전 국가 `true`다.

```ts
assert.deepEqual(authAvailability("JP"), {
  google: true, phoneOtp: false, kakao: false, naver: false, childPairing: true,
});
```

- [ ] UI 회귀에 국가 확인 전 소셜 로그인을 실행할 수 없음, 비한국 국가에서 +82 placeholder/한국 공급자 CTA 미노출, Google 실패 시 로컬 비밀번호가 글로벌 대안처럼 노출되지 않음을 추가한다.
- [ ] Worker 회귀로 UI 숨김이 server authorization 대체가 아니며 기존 OAuth state/nonce/account-link 규칙이 그대로 적용되는지 고정한다.
- [ ] 테스트를 실행해 availability helper 부재로 실패하는지 확인한다.

Run: `node --test tests/globalAuthAvailability.test.ts tests/onboardingAuthAdoption.test.ts tests/onboardingSessionGuard.test.mjs worker/tests/oauthRouteSecurity.test.mjs`

Expected: 신규 helper/UI 단언 실패.

- [ ] `globalAuthAvailability.ts`를 국가만 입력받는 순수 함수로 구현한다. locale을 국가로 대신 사용하지 않는다.
- [ ] 온보딩 로그인 UI를 availability model로 렌더하고, child pairing 진입은 모든 국가에서 유지한다. 한국 전화 OTP 데이터/국가코드 확장은 이번 범위에 포함하지 않는다.
- [ ] Google OAuth callback/deep-link는 기존 session adoption과 family region step으로 돌아오게 하고, provider link/merge 경로를 바꾸지 않는다.
- [ ] auth 전체 회귀와 typecheck를 통과시킨다.

Run: `node --test tests/globalAuthAvailability.test.ts tests/onboardingAuthAdoption.test.ts tests/onboardingSessionGuard.test.mjs tests/oauthAccountLink.test.ts worker/tests/oauthRouteSecurity.test.mjs worker/tests/oauthAccountDeletionSafety.test.mjs && npm run typecheck`

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('src/transform/globalAuthAvailability.ts','tests/globalAuthAvailability.test.ts','src/screens/onboarding/Onboarding.tsx','src/screens/onboarding/Onboarding.css','tests/onboardingAuthAdoption.test.ts','tests/onboardingSessionGuard.test.mjs','worker/tests/oauthRouteSecurity.test.mjs')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "국가별 로그인 수단을 명확히 제한한다"
```

### Task 9: 지역·시간·지도 통합 검증과 migration 준비

**Files:**
- Modify: `docs/operations/global-time-boundaries.md`
- Modify: `docs/operations/mapbox-readiness.md`
- Create: `docs/operations/global-auth-readiness.md`
- Modify: `worker/README.md`
- Modify: `scripts/global-browser-qa.mjs`
- Create: `tests/globalRegionBrowserQa.test.mjs`
- Verify only: `tests/regionPolicy.test.ts`
- Verify only: `tests/timeZonePolicy.test.ts`
- Verify only: `tests/mapProvider.test.ts`
- Verify only: `tests/globalAuthAvailability.test.ts`
- Verify only: `worker/tests/globalFamilyContextMigration.test.mjs`
- Verify only: `worker/tests/mapboxRoutes.test.mjs`
- Verify only: `worker/tests/mapProviderPlaceIdsMigration.test.mjs`

- [ ] 다음 matrix를 browser fixture로 검증하고 결과를 문서에 기록한다: `KR/ko/Kakao`, `JP/ja/Mapbox`, `TW/zh-TW/Mapbox`, `SG/en/Mapbox`, `VN/vi`, `TH/th`, `ID/id`, `MY/ms`, `PH/fil`. locale과 country가 엇갈린 `JP/en`, `KR/ja`도 포함한다.
- [ ] 각 fixture에서 가족 local date, 오전 8시 위치 history 경계, 조용한 시간, 지도 검색/선택/route, Google login visibility, child pairing visibility를 확인한다.
- [ ] network/console 검사에서 Kakao key가 비-KR 화면에 로드되지 않고 Mapbox secret/좌표가 log에 없으며 unsupported/timeout이 한국 지도 fallback으로 바뀌지 않는지 확인한다.
- [ ] `global-auth-readiness.md`에 Google OAuth consent screen publish 상태, Pages/Android redirect URI와 origin, 최소 scope, test-user 제한 여부, 계정 연결/삭제 지원 연락 경로를 evidence ID로 기록한다. Kakao/Naver/한국 OTP는 KR-only임을 적고 어떤 provider Console도 자동 변경하지 않는다.
- [ ] region browser harness의 실패 테스트를 먼저 작성하고 mock-only matrix를 실행한다.

Run: `node --test tests/globalRegionBrowserQa.test.mjs && node scripts/global-browser-qa.mjs --matrix=global-region --mock-only`

Expected: 모든 11개 country/locale 조합이 예상 provider/auth/시간대 UI를 보이고 production network 요청은 0건이다.
- [ ] migration 순서를 `global-family-context.sql → map-provider-place-ids.sql → Worker → Pages`로 문서화하고 각 SQL을 새 로컬 복제 DB에 정확히 1회 적용한 결과와 적용 후 반복 가능한 schema readiness 결과를 기록한다. 이미 대상 컬럼이 있으면 SQL 실행 전에 중단하며 production에는 실행하지 않는다.
- [ ] 전체 자동 검증을 실행한다.

Run: `npm run typecheck && npm run build && npm run typecheck:worker && npm run test:worker`

Expected: 모두 exit 0.

- [ ] Android quiet-hour 단위 테스트와 assemble/lint를 실행한다.

Run:

```powershell
Push-Location android
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
$gradleExit = $LASTEXITCODE
Pop-Location
if ($gradleExit -ne 0) { exit $gradleExit }
```

Expected: 모두 `BUILD SUCCESSFUL`.

- [ ] `git diff --check`와 `git status --short`를 확인하고 이 계획 밖 사용자 변경이 commit 대상에 포함되지 않았음을 확인한다.
- [ ] readiness 문서와 실제 수정 파일만 명시적으로 커밋한다. production migration, secret 설정, 배포, 기기 접근은 수행하지 않는다.

### Completion Gate

- [ ] 기존 가족/장소 row를 복제한 migration 테스트가 값 변경 0건으로 통과한다.
- [ ] 신규 가족은 explicit country/IANA zone 없이는 setup을 완료하지 못한다.
- [ ] family day/recipient local/fixed KST/UTC duration 사용처가 문서와 테스트로 전부 분류된다.
- [ ] KR은 Kakao 회귀가 그대로 통과하고 해외 QA 국가는 Mapbox를 사용하며 CN은 명시적으로 unsupported다.
- [ ] 장소 provider 식별자를 추가해도 출입 상태머신·dedupe·위치 티어·playdate 내부 ID가 변하지 않는다.
- [ ] 비한국 국가에는 Google 로그인과 아이 페어링만 노출되고 서버 auth 보안은 그대로다.
- [ ] production D1/Worker/Pages/secret/store와 S25에는 변화나 접근이 없다.
