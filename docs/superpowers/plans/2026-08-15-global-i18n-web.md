# Global I18n Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** React/PWA 전체 사용자 표면을 10개 지원 언어로 전환하고, 언어 감지·기기별 저장·영어→한국어 폴백·ICU 포맷·route별 lazy catalog·다국어 PWA metadata를 하나의 타입 안전한 정본으로 제공한다.

**Architecture:** 저장소 루트 `locales/`를 한국어 원문과 번역·설명·검수 상태의 정본으로 사용한다. 빌드 스크립트가 JSON/ICU를 검증해 TypeScript message ID와 locale별 namespace 청크를 생성한다. `LocaleProvider`는 인증보다 바깥에서 core를 로드하고 `LocaleBoundary`가 route namespace를 원자적으로 추가한다. PWA/Android 언어는 계정이 아닌 기기에 저장한다.

**Tech Stack:** React 19, TypeScript strict, React Intl/FormatJS, Intl Date/Number/RelativeTimeFormat, Vite dynamic import, vite-plugin-pwa injectManifest, Node test runner, Playwright/CDP

## Global Constraints

- 지원 locale 정본은 정확히 `ko`, `en`, `ja`, `zh-CN`, `zh-TW`, `vi`, `th`, `id`, `ms`, `fil`이다.
- 한국어 브랜드는 `혜니캘린더`, 비한국어 브랜드는 `Hyeni Calendar`다. package id와 아이콘은 바꾸지 않는다.
- `zh-Hans/zh-CN/zh-SG → zh-CN`, `zh-Hant/zh-TW/zh-HK/zh-MO → zh-TW`, `in → id`, `tl → fil` 규칙을 지킨다.
- 선택 언어 카탈로그 실패 시 namespace 전체를 영어, 영어도 실패하면 한국어로 읽는다. 선택 언어가 준비되기 전에 한국어 route를 먼저 노출하지 않는다.
- 사용자 이름·메모·주소·장소명은 번역하지 않는다. API error code는 안정적인 key로 유지하고 화면에서 message ID로 매핑한다.
- JSX text, aria/placeholder/title, toast/dialog, validation, API/native 오류 등 모든 사용자 노출 literal을 locale catalog로 옮긴다. 한국어만 찾는 검사로 완료를 판정하지 않는다.
- 한국어 부모·페어링·구독은 존댓말, 아이 모드는 반말이다. 다른 언어도 parent/child 문맥을 분리한다.
- 기존 `date_key` 저장 형식과 시간 의미를 이 계획에서 변경하지 않는다. time zone 정본은 별도 계획이 담당한다.
- 초기 JS route bundle 500,000-byte 예산과 PWA precache URL 중복 금지 검사를 유지한다.
- 기존 `output/store-ui-candidates-v1/`와 사용자 staged 변경을 건드리지 않는다.

---

## File Structure

### New files

- `locales/manifest.json` — locale 코드, 자칭명, 브랜드, Intl/Android/Mapbox 코드, runtime/release 활성 상태
- `locales/glossary.json` — 고정 브랜드·안전·결제·부모/아이 용어
- `locales/descriptions.json` — message 문맥, 역할, 변수, 등급, 글자 제한
- `locales/review-status.json` — locale/namespace별 `draft|reviewed|approved`
- `locales/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/{core,onboarding,parent,child,shared,billing,reports,notifications,android}.json`
- `src/i18n/locale.ts` — locale 타입·정규화·fallback·방향·브랜드
- `src/i18n/localeStorage.ts` — `hyeni-locale-v1` 기기 저장소와 감지 순서
- `src/i18n/catalog.ts` — 생성 청크 loader와 namespace 원자 fallback
- `src/i18n/LocaleProvider.tsx` — React Intl provider와 언어 전환 상태
- `src/i18n/LocaleBoundary.tsx` — route namespace 준비 gate
- `src/i18n/useLocale.ts` — locale/전환/format API
- `src/i18n/format.ts` — date/number/relative/currency formatter
- `src/i18n/documentMetadata.ts` — `<html lang/dir>`, title, description, manifest link 갱신
- `src/i18n/generated/messageIds.ts` — 생성된 `MessageId`와 변수 서명
- `src/i18n/generated/catalogLoaders.ts` — locale/namespace별 dynamic import map
- `src/i18n/generated/catalogs/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/{core,onboarding,parent,child,shared,billing,reports,notifications,android}.ts` — FormatJS 검증을 통과한 90개 청크
- `src/components/LanguageSelector.tsx`
- `src/components/LanguageSelector.css`
- `scripts/i18n/build-catalogs.mjs`
- `scripts/i18n/validate-catalogs.mjs`
- `scripts/i18n/scan-user-facing-literals.mjs`
- `scripts/i18n/scan-client-error-surfaces.mjs`
- `scripts/i18n/user-facing-literal-allowlist.json`
- `scripts/i18n/generate-pwa-manifests.mjs`
- `public/manifests/manifest.{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}.webmanifest` — 생성 산출물 10개
- `tests/localeNormalization.test.ts`
- `tests/i18nCatalogContract.test.mjs`
- `tests/localeRuntime.test.ts`
- `tests/i18nFormatting.test.ts`
- `tests/i18nUiWiring.test.mjs`
- `tests/pwaLocaleMetadata.test.mjs`
- `tests/userFacingLiteralScan.test.mjs`
- `tests/apiErrorLocalization.test.ts`
- `tests/apiErrorSurfaceWiring.test.mjs`

### Modified files

- `package.json`, `package-lock.json`
- `src/main.tsx`, `src/app/App.tsx`, `src/app/AppShell.tsx`
- `src/screens/Splash.tsx`, `src/app/ErrorBoundary.tsx`, `src/app/GlobalErrorListeners.tsx`
- `src/screens/onboarding/Onboarding.tsx`
- `src/screens/parent/*.tsx`
- `src/screens/child/*.tsx`, `src/screens/child/overlays/*.tsx`
- `src/screens/shared/MemoChat.tsx`
- `src/screens/feature/*.tsx`
- `src/screens/teacher/*.tsx`, `src/screens/admin/AdminAiPrompt.tsx`
- 사용자 문구를 가진 `src/components/**/*.tsx`, `src/transform/**/*.ts`, `src/lib/**/*.ts`
- `vite.config.ts`, `index.html`, `src/sw.ts`, `scripts/verify-route-bundle.mjs`
- 기존 `src/i18n/messages.ts`, `src/i18n/useMessage.ts`는 마지막 이관 태스크에서 삭제

### Test/support files modified

- 문구를 직접 비교하는 `tests/*.test.*`와 `scripts/*.spec.ts`
- `scripts/final-browser-qa.mjs`, `scripts/create-safe-store-ui-candidates.mjs`

### Task 1: locale 정본과 감지 규칙

**Files:**
- Create: `locales/manifest.json`
- Create: `locales/glossary.json`
- Create: `locales/descriptions.json`
- Create: `locales/review-status.json`
- Create: `src/i18n/locale.ts`
- Create: `src/i18n/localeStorage.ts`
- Create: `tests/localeNormalization.test.ts`

- [ ] **Step 1: locale 정규화 실패 테스트를 작성한다**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLocale,
  localeFallbackChain,
  localeDirection,
  localizedBrandName,
  supportedLocales,
} from "../src/i18n/locale.ts";

test("지원 locale과 중국어·레거시 별칭을 정규화한다", () => {
  assert.deepEqual(supportedLocales, [
    "ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil",
  ]);
  assert.equal(normalizeLocale("zh-Hans-SG"), "zh-CN");
  assert.equal(normalizeLocale("zh-HK"), "zh-TW");
  assert.equal(normalizeLocale("in-ID"), "id");
  assert.equal(normalizeLocale("tl-PH"), "fil");
  assert.equal(normalizeLocale("fr-FR"), "en");
});

test("비한국어 폴백과 브랜드 계약을 지킨다", () => {
  assert.deepEqual(localeFallbackChain("vi"), ["vi", "en", "ko"]);
  assert.deepEqual(localeFallbackChain("ko"), ["ko", "en"]);
  assert.equal(localizedBrandName("ko"), "혜니캘린더");
  assert.equal(localizedBrandName("ja"), "Hyeni Calendar");
  assert.equal(localeDirection("th"), "ltr");
});
```

- [ ] **Step 2: 테스트를 실행해 모듈 부재 실패를 확인한다**

Run: `node --test tests/localeNormalization.test.ts`

Expected: `src/i18n/locale.ts`를 찾지 못해 FAIL.

- [ ] **Step 3: locale 타입과 순수 정규화 함수를 구현한다**

```ts
export const supportedLocales = [
  "ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil",
] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

const exact = new Set<string>(supportedLocales);

export function normalizeLocale(input: string | null | undefined): SupportedLocale {
  const raw = String(input ?? "").trim().replaceAll("_", "-");
  if (exact.has(raw)) return raw as SupportedLocale;
  const lower = raw.toLowerCase();
  if (lower === "in" || lower.startsWith("in-")) return "id";
  if (lower === "tl" || lower.startsWith("tl-")) return "fil";
  if (/^zh-(hant|tw|hk|mo)(-|$)/i.test(raw)) return "zh-TW";
  if (/^zh-(hans|cn|sg)(-|$)/i.test(raw)) return "zh-CN";
  if (lower === "zh") return "zh-CN";
  for (const locale of ["ko", "en", "ja", "vi", "th", "id", "ms", "fil"] as const) {
    if (lower === locale || lower.startsWith(`${locale}-`)) return locale;
  }
  return "en";
}

export function localeFallbackChain(locale: SupportedLocale): SupportedLocale[] {
  return locale === "ko" ? ["ko", "en"] : locale === "en" ? ["en", "ko"] : [locale, "en", "ko"];
}
```

- [ ] **Step 4: PWA 감지·저장 우선순위를 테스트하고 구현한다**

`localeStorage.ts` public API를 다음으로 고정한다.

```ts
export const LOCALE_STORAGE_KEY = "hyeni-locale-v1";

export interface LocaleStoragePort {
  read(): string | null;
  write(locale: SupportedLocale): void;
}

export function resolveWebLocale(args: {
  storedLocale: string | null;
  navigatorLanguages: readonly string[];
}): SupportedLocale;
```

Tests must prove: valid stored value > first supported navigator language > `en`; invalid stored value does not hide a later supported navigator language.

- [ ] **Step 5: focused 검증과 커밋을 수행한다**

Run:

```powershell
node --test tests/localeNormalization.test.ts
npm run typecheck
git add -- locales/manifest.json locales/glossary.json locales/descriptions.json locales/review-status.json src/i18n/locale.ts src/i18n/localeStorage.ts tests/localeNormalization.test.ts
git commit --only -- locales/manifest.json locales/glossary.json locales/descriptions.json locales/review-status.json src/i18n/locale.ts src/i18n/localeStorage.ts tests/localeNormalization.test.ts -m "글로벌 locale 정본과 감지 규칙을 추가한다"
```

### Task 2: FormatJS 카탈로그 검사와 타입 생성

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `locales/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/{core,onboarding,parent,child,shared,billing,reports,notifications,android}.json`
- Create: `scripts/i18n/build-catalogs.mjs`
- Create: `scripts/i18n/validate-catalogs.mjs`
- Create: `src/i18n/generated/messageIds.ts`
- Create: `src/i18n/generated/catalogLoaders.ts`
- Create: `src/i18n/generated/catalogs/**/*.ts`
- Create: `tests/i18nCatalogContract.test.mjs`

- [ ] **Step 1: FormatJS 의존성을 설치한다**

Run:

```powershell
npm install --save-exact react-intl intl-messageformat
npm install --save-dev --save-exact @formatjs/cli @formatjs/icu-messageformat-parser
```

Expected: `package.json`과 lockfile만 변경되고 기존 앱 테스트는 아직 통과한다.

- [ ] **Step 2: 누락 ID·ICU 변수·금지 HTML 실패 테스트를 작성한다**

`tests/i18nCatalogContract.test.mjs`는 임시 fixture를 validator에 넘겨 다음 네 경우가 실패함을 단언한다.

```js
assert.equal(result.errors.includes("missing_id:vi:core:core.action.retry"), true);
assert.equal(result.errors.includes("extra_id:th:core:core.unknown"), true);
assert.equal(result.errors.includes("argument_mismatch:ja:core:core.greeting:name"), true);
assert.equal(result.errors.includes("forbidden_markup:id:core:core.help"), true);
```

- [ ] **Step 3: 테스트를 실행해 validator 부재 실패를 확인한다**

Run: `node --test tests/i18nCatalogContract.test.mjs`

Expected: `scripts/i18n/validate-catalogs.mjs` import 실패.

- [ ] **Step 4: 한국어 ID 정본과 설명 계약을 만든다**

초기 seed ID 형식은 다음을 지키고 이후 화면 이관에서 추가한다.

```json
{
  "core.brand.name": "혜니캘린더",
  "core.action.back": "뒤로",
  "core.action.retry": "다시 시도",
  "core.state.loading": "불러오는 중…",
  "core.error.unknown": "문제가 생겼어요. 잠시 후 다시 시도해 주세요."
}
```

`descriptions.json` entry:

```json
{
  "core.error.unknown": {
    "namespace": "core",
    "audience": "shared",
    "qualityTier": "B",
    "variables": {},
    "description": "원문 오류나 내부 코드를 노출하지 않는 공용 오류 안내"
  }
}
```

- [ ] **Step 5: generator와 validator를 구현한다**

필수 검증:

- 10개 locale × 9개 namespace 파일 존재
- 한국어 ID 집합과 각 locale ID 집합 동일
- ICU parser가 반환한 argument 이름 집합 동일
- `<script`, `javascript:`, inline event handler, allowlist 밖 URL 금지
- description의 namespace·변수 서명과 실제 메시지 일치
- 생성 파일 정렬과 개행 결정적

생성 loader의 형태를 고정한다.

```ts
export const catalogLoaders = {
  en: {
    core: () => import("./catalogs/en/core"),
    parent: () => import("./catalogs/en/parent"),
  },
} satisfies Record<SupportedLocale, Record<MessageNamespace, () => Promise<CatalogModule>>>;
```

- [ ] **Step 6: 10개 locale에 의미가 같은 draft를 작성한다**

한국어 → 영어 → 일본어/중국어/동남아 6개 언어 순서로 번역한다. 변수명·브랜드·부모/아이 어조를 `glossary.json`에 맞추고, 번역이 아직 외부 검수 전이라는 사실은 `review-status.json`에 `draft`로 기록한다. 한국어를 다른 locale에 복사해 parity만 통과시키는 것은 금지한다.

- [ ] **Step 7: 생성물 freshness와 focused test를 통과시킨다**

Run:

```powershell
node scripts/i18n/build-catalogs.mjs
node scripts/i18n/validate-catalogs.mjs --check-generated
node --test tests/i18nCatalogContract.test.mjs
npm run typecheck
```

Expected: 생성물 재실행 diff 0, 테스트 PASS.

- [ ] **Step 8: 태스크 파일만 커밋한다**

Commit 전 generator가 출력한 파일 inventory와 `git diff --name-only`를 대조한다. `locales`나 `src/i18n/generated` 디렉터리 자체를 인자로 넘기지 말고, 검토한 개별 JSON/TS 경로와 이 태스크의 explicit source/test paths만 `git commit --only --` 뒤에 나열해 `FormatJS 카탈로그 생성과 번역 계약을 구축한다`로 커밋한다.

### Task 3: LocaleProvider와 namespace 원자 fallback

**Files:**
- Create: `src/i18n/catalog.ts`
- Create: `src/i18n/LocaleProvider.tsx`
- Create: `src/i18n/LocaleBoundary.tsx`
- Create: `src/i18n/useLocale.ts`
- Modify: `src/main.tsx`
- Modify: `src/app/App.tsx`
- Create: `tests/localeRuntime.test.ts`
- Create: `tests/i18nUiWiring.test.mjs`

- [ ] **Step 1: fallback과 세션 보존 실패 테스트를 작성한다**

Test pure loader with injected functions:

```ts
const result = await loadNamespaceAtomically({
  locale: "vi",
  namespace: "parent",
  load: async (locale) => {
    if (locale === "vi") throw new Error("chunk_failed");
    return locale === "en" ? { "parent.title": "Family" } : { "parent.title": "가족" };
  },
});
assert.equal(result.resolvedLocale, "en");
assert.deepEqual(result.messages, { "parent.title": "Family" });
```

`i18nUiWiring` must initially fail because `LocaleProvider` is not outside `AuthProvider` and `routeElement` has no namespace argument.

- [ ] **Step 2: 실패를 확인한다**

Run:

```powershell
node --test tests/localeRuntime.test.ts tests/i18nUiWiring.test.mjs
```

Expected: missing module/wiring assertions FAIL.

- [ ] **Step 3: runtime provider를 구현한다**

Provider public contract:

```ts
export interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale(locale: SupportedLocale): Promise<void>;
  ensureNamespaces(namespaces: readonly MessageNamespace[]): Promise<void>;
  readyNamespaces: ReadonlySet<MessageNamespace>;
  loading: boolean;
}
```

`setLocale` 순서:

1. core 새 locale/fallback을 완전히 load
2. 저장소·document metadata 갱신
3. 현재 필요한 namespace 새 묶음 load
4. 한 번에 React Intl messages 교체
5. Auth/Query/active child storage는 건드리지 않음

- [ ] **Step 4: Provider를 Auth보다 바깥에 배치한다**

```tsx
createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
```

`App`의 `QueryProvider/AuthProvider` 순서는 유지한다.

- [ ] **Step 5: route namespace boundary를 배선한다**

```tsx
function routeElement(
  element: ReactElement,
  namespaces: readonly MessageNamespace[] = ["core"],
): ReactElement {
  return (
    <Suspense fallback={<RouteLoading />}>
      <LocaleBoundary namespaces={namespaces}>{element}</LocaleBoundary>
    </Suspense>
  );
}
```

Mapping:

- onboarding: `core,onboarding,shared`
- parent routes: `core,parent,shared`
- child routes: `core,child,shared`
- subscription/AI credit/trial lock: `core,billing,shared`
- daily/weekly/day summary: `core,reports,parent,shared`
- notifications/arrival/danger/SOS/remote: `core,notifications,parent|child,shared`
- teacher/admin: `core,shared`

- [ ] **Step 6: focused 검증과 커밋을 수행한다**

```powershell
node --test tests/localeRuntime.test.ts tests/i18nUiWiring.test.mjs
npm run typecheck
git add -- src/i18n/catalog.ts src/i18n/LocaleProvider.tsx src/i18n/LocaleBoundary.tsx src/i18n/useLocale.ts src/main.tsx src/app/App.tsx tests/localeRuntime.test.ts tests/i18nUiWiring.test.mjs
git commit --only -- src/i18n/catalog.ts src/i18n/LocaleProvider.tsx src/i18n/LocaleBoundary.tsx src/i18n/useLocale.ts src/main.tsx src/app/App.tsx tests/localeRuntime.test.ts tests/i18nUiWiring.test.mjs -m "인증 밖 locale runtime과 route 카탈로그를 연결한다"
```

### Task 4: 언어 선택 UI와 기기별 즉시 전환

**Files:**
- Create: `src/components/LanguageSelector.tsx`
- Create: `src/components/LanguageSelector.css`
- Modify: `src/screens/onboarding/Onboarding.tsx`
- Modify: `src/screens/parent/ParentSettings.tsx`
- Modify: `src/screens/child/ChildSettings.tsx`
- Modify: `src/app/NativeBootstrap.tsx` (Android 실제 sync는 native 계획에서 완성)
- Create: `tests/languageSelector.test.mjs`
- Create: `tests/localeSessionIsolation.test.mjs`

- [ ] **Step 1: 접근성·자칭 언어명·세션 격리 실패 테스트를 쓴다**

Assertions:

- `한국어`, `English`, `日本語`, `简体中文`, `繁體中文`, `Tiếng Việt`, `ไทย`, `Bahasa Indonesia`, `Bahasa Melayu`, `Filipino`
- control의 accessible name과 현재 선택 `aria-checked`
- 언어 변경 코드에 `clearApiSession`, `logout`, `setActiveChildId(null)`, `anonymousLogin` 없음
- 부모·아이 설정과 onboarding에 동일 component import

- [ ] **Step 2: 테스트 실패를 확인한다**

Run: `node --test tests/languageSelector.test.mjs tests/localeSessionIsolation.test.mjs`

Expected: component/import 부재 FAIL.

- [ ] **Step 3: 공용 selector를 구현한다**

```tsx
export function LanguageSelector({ tone }: { tone: "formal" | "child" }) {
  const { locale, setLocale } = useLocale();
  return (
    <fieldset className="hy-language" aria-label={tone === "child" ? "언어 고르기" : "언어 선택"}>
      {localeEntries.map((entry) => (
        <button
          type="button"
          role="radio"
          aria-checked={locale === entry.code}
          className="hy-language__option hy-press"
          onClick={() => void setLocale(entry.code)}
        >
          {entry.nativeName}
        </button>
      ))}
    </fieldset>
  );
}
```

실제 label도 catalog ID를 사용하며 위 코드는 구조 예시다. 44px target, keyboard focus, 200% 글자 크기에서 줄바꿈을 허용한다.

- [ ] **Step 4: onboarding과 두 역할 설정에 배선한다**

- onboarding 첫 화면에서 로그인/역할 선택 전 접근 가능
- ParentSettings의 설정 그룹에 존댓말 설명
- ChildSettings의 내 설정 그룹에 반말 설명
- 저장은 기기 local storage만 사용
- Android에서 `syncNativeAppLocale` hook을 호출하되 plugin 미구현이면 웹 전환은 성공

- [ ] **Step 5: focused 검증과 커밋을 수행한다**

```powershell
node --test tests/languageSelector.test.mjs tests/localeSessionIsolation.test.mjs
npm run typecheck
git add -- src/components/LanguageSelector.tsx src/components/LanguageSelector.css src/screens/onboarding/Onboarding.tsx src/screens/parent/ParentSettings.tsx src/screens/child/ChildSettings.tsx src/app/NativeBootstrap.tsx tests/languageSelector.test.mjs tests/localeSessionIsolation.test.mjs
git commit --only -- src/components/LanguageSelector.tsx src/components/LanguageSelector.css src/screens/onboarding/Onboarding.tsx src/screens/parent/ParentSettings.tsx src/screens/child/ChildSettings.tsx src/app/NativeBootstrap.tsx tests/languageSelector.test.mjs tests/localeSessionIsolation.test.mjs -m "온보딩과 역할별 설정에 기기 언어 선택을 추가한다"
```

### Task 5: locale/time-zone 명시 formatter로 이관

**Files:**
- Create: `src/i18n/format.ts`
- Modify: `src/transform/scheduleView.ts`
- Modify: `src/transform/locationView.ts`
- Modify: `src/transform/memoView.ts`
- Modify: `src/transform/notificationsView.ts`
- Modify: `src/transform/weeklyReportView.ts`
- Modify: `src/transform/familyView.ts`
- Modify: `src/screens/parent/ParentLocation.tsx`
- Modify: `src/screens/feature/DataSync.tsx`
- Modify: `src/screens/feature/RemoteAudioAudit.tsx`
- Modify: `src/screens/feature/Subscription.tsx`
- Modify: `src/screens/feature/TrialLock.tsx`
- Modify: `src/screens/feature/WeeklyFamilyReport.tsx`
- Modify: `src/transform/notificationQuietHours.ts`
- Modify: `src/transform/webAiCreditBilling.ts`
- Audit: `src/lib/feedbackDiagnostics.ts`, `src/lib/native/speech.ts`, `src/transform/eventPlaceSearch.ts` — 사용자 표시인지 protocol/diagnostic 값인지 분류하고 사용자 표시인 경우에만 formatter로 이관
- Create: `tests/i18nFormatting.test.ts`

- [ ] **Step 1: locale·time zone별 결과 실패 테스트를 쓴다**

```ts
assert.equal(formatNumber(12345, "en"), "12,345");
assert.equal(formatNumber(12345, "id"), "12.345");
assert.match(formatDateTime(instant, { locale: "ja", timeZone: "Asia/Tokyo" }), /2026/);
assert.match(formatDateTime(instant, { locale: "th", timeZone: "Asia/Bangkok" }), /2026/);
assert.equal(formatProviderPrice("$4.99", "en"), "$4.99");
```

`formatProviderPrice`는 공급자 문자열을 환산·재포맷하지 않고 그대로 반환해야 한다.

- [ ] **Step 2: 테스트 실패를 확인한 뒤 formatter를 구현한다**

Public API:

```ts
export function formatDateTime(
  value: Date | number | string,
  options: { locale: SupportedLocale; timeZone: string; dateStyle?: "short" | "medium"; timeStyle?: "short" },
): string;
export function formatNumber(value: number, locale: SupportedLocale): string;
export function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, locale: SupportedLocale): string;
export function formatProviderPrice(formattedPrice: string, locale: SupportedLocale): string;
```

- [ ] **Step 3: 고정 `ko-KR`와 로컬 getHours 포맷을 공용 formatter로 교체한다**

Run audit before and after:

```powershell
rg -n 'toLocale(Date|Time|String).*ko-KR|Intl\.(DateTimeFormat|NumberFormat|RelativeTimeFormat)\("ko|\.getHours\(\)' src
```

Expected after migration: 승인 allowlist 밖 0건. `date_key` encode/decode는 수정하지 않는다.

- [ ] **Step 4: 검증을 수행한다**

```powershell
node --test tests/i18nFormatting.test.ts tests/formattingAndMapCenter.test.ts
npm run typecheck
```

- [ ] **Step 5: 태스크 파일만 커밋한다**

위 Files 목록 중 실제 수정된 개별 경로만 검토한다. `src/transform`, `src/screens`, `tests` 디렉터리 인자를 금지하고 exact paths를 `git commit --only --` 뒤에 나열해 `날짜와 숫자 표시를 locale formatter로 통일한다`로 커밋한다.

### Task 6: core·shell·onboarding 문구 이관

**Files:**
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/ErrorBoundary.tsx`
- Modify: `src/app/GlobalErrorListeners.tsx`
- Modify: `src/components/ui/BusyLabel.tsx`
- Modify: `src/components/ui/Loading.tsx`
- Modify: `src/components/ui/OfflineBanner.tsx`
- Modify: `src/components/ui/QrCode.tsx`
- Modify: `src/components/ui/RouteLoading.tsx`
- Modify: `src/components/ui/ScreenQueryState.tsx`
- Modify: `src/components/ui/SectionHeader.tsx`
- Modify: `src/components/ui/StickerCelebration.tsx`
- Modify: `src/components/ui/TopBar.tsx`
- Modify: `src/screens/Splash.tsx`
- Modify: `src/screens/onboarding/Onboarding.tsx`
- Create: `src/i18n/apiError.ts`
- Create: `scripts/i18n/scan-client-error-surfaces.mjs`
- Modify: `src/lib/api/errors.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/lib/globalToast.ts`
- Modify: `src/auth/RequireGuest.tsx`, `src/auth/RequireRole.tsx`
- Modify: `locales/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/{core,onboarding,shared}.json`
- Create: `tests/i18nCoreScreens.test.mjs`
- Create: `tests/apiErrorLocalization.test.ts`
- Create: `tests/apiErrorSurfaceWiring.test.mjs`

- [ ] **Step 1: hard-coded core 문구가 남아 실패하는 contract test를 작성한다**

Test exact files for React Intl `useIntl/FormattedMessage` or typed `useMessage`, and assert message API 밖의 사용자 노출 literal은 언어와 무관하게 없고 allowlist에는 protocol/data/accessibility 사유가 있는 항목만 남는지 확인한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test tests/i18nCoreScreens.test.mjs`

Expected: current hard-coded shell/onboarding strings make FAIL.

- [ ] **Step 3: core·onboarding 문구를 안정적 ID로 이관한다**

Rules:

- 변수는 ICU `{name}`, `{count, plural, ...}` 사용
- JSX 강조는 `intl.formatMessage` 문자열에 HTML을 넣지 않고 `<FormattedMessage values={{ strong: chunks => <strong>{chunks}</strong> }}>`의 allowlisted rich slot만 사용
- 내부 error code를 직접 표시하지 않음
- child pairing 안내는 기존 무손실 재페어링 의미 유지
- teacher production gate는 노출 정책 유지

- [ ] `ApiError`는 `status`와 bounded stable `code`를 분리하고 Worker의 자유 `message`를 사용자 문구로 신뢰하지 않게 한다. `localizeApiError(error, intl, tone)`은 allowlisted code mapping 뒤 역할별 generic network/4xx/5xx 메시지로 닫고 raw body·stack·token·내부 코드를 반환하지 않는다.
- [ ] 오류 surface scanner가 JSX/toast/dialog에서 `error.message`, `String(error)`, Worker `message`를 직접 렌더하는 기존 경로를 파일·행과 함께 실패시키게 한다. 도메인별 분기는 `ApiError.code`만 비교하고 최종 표시 문자열은 catalog ID로 만든다.

- [ ] **Step 4: 10개 locale draft를 함께 갱신하고 검사한다**

Run:

```powershell
node scripts/i18n/build-catalogs.mjs
node scripts/i18n/validate-catalogs.mjs --check-generated
node scripts/i18n/scan-client-error-surfaces.mjs
node --test tests/i18nCoreScreens.test.mjs tests/apiErrorLocalization.test.ts tests/apiErrorSurfaceWiring.test.mjs tests/onboardingSessionGuard.test.mjs tests/teacherProductionGate.test.mjs
npm run typecheck
```

- [ ] **Step 5: 태스크 범위를 커밋한다**

이 Task의 app 3개, ui 9개, Splash, Onboarding, API 오류 5개, auth 2개, locale 30개, 생성 catalog inventory, test 3개 경로를 하나씩 검토한다. 디렉터리/glob 인자를 쓰지 않고 exact paths만 `git commit --only --`에 넘겨 `공용 셸과 온보딩 문구를 다국어 카탈로그로 옮긴다`로 커밋한다.

### Task 7: 부모 화면과 공용 대화 문구 이관

**Files:**
- Modify: `src/screens/parent/ChildDetail.tsx`
- Modify: `src/screens/parent/EventForm.tsx`
- Modify: `src/screens/parent/ParentAccount.tsx`
- Modify: `src/screens/parent/ParentCalendar.tsx`
- Modify: `src/screens/parent/ParentFamily.tsx`
- Modify: `src/screens/parent/ParentHome.tsx`
- Modify: `src/screens/parent/ParentLocation.tsx`
- Modify: `src/screens/parent/ParentSettings.tsx`
- Modify: `src/screens/parent/SocialLinks.tsx`
- Modify: `src/screens/shared/MemoChat.tsx`
- Modify: `src/components/KakaoMap.tsx`
- Modify: `src/components/MapPickerSheet.tsx`
- Modify: `src/components/MessageSafetyDialog.tsx`
- Modify: `src/components/PremiumUpsell.tsx`
- Modify: `src/components/ReferralRewardPanel.tsx`
- Modify: `src/transform/adventureMap.ts`
- Modify: `src/transform/eventScope.ts`
- Modify: `src/transform/familyView.ts`
- Modify: `src/transform/locationTrustCopy.ts`
- Modify: `src/transform/locationView.ts`
- Modify: `src/transform/memoChatCopy.ts`
- Modify: `src/transform/memoQuickReplies.ts`
- Modify: `src/transform/notificationsView.ts`
- Modify: `src/transform/oauthProvider.ts`
- Modify: `src/transform/placeVisual.ts`
- Modify: `src/transform/premiumUpsell.ts`
- Modify: `src/transform/scheduleView.ts`
- Modify: `src/transform/secondChildGate.ts`
- Modify: `src/transform/tierPolicy.ts`
- Modify: `locales/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/{parent,shared,notifications}.json`
- Create: `tests/i18nParentScreens.test.mjs`

- [ ] **Step 1: 부모 route 파일별 literal inventory를 실패 테스트로 고정한다**

Expected failure report must name each file and first unallowlisted literal; count만 비교하지 않는다.

- [ ] **Step 2: 화면 묶음을 작은 순서로 이관한다**

Order:

1. `ParentHome`, `ParentSettings`, `ParentAccount`
2. `ParentCalendar`, `EventForm`
3. `ParentLocation`, `ChildDetail`, `ParentFamily`
4. `MemoChat`, `SocialLinks`

각 묶음 뒤 `node scripts/i18n/validate-catalogs.mjs`와 관련 기존 테스트를 실행한다. 활성 아이 우선순위, member id/user id, memo thread key는 변경하지 않는다.

- [ ] **Step 3: 부모 존댓말과 신뢰 문구 의미를 검증한다**

Run:

```powershell
node --test tests/i18nParentScreens.test.mjs tests/subscriptionTrustCopy.test.mjs tests/remoteAudioTrustCopy.test.mjs tests/activeChildFallback.test.mjs tests/memoChatRoleCopy.test.ts
npm run typecheck
```

- [ ] **Step 4: 부모 화면 범위를 커밋한다**

위 10개 명시 화면, 19개 component/transform 의존 파일, locale 30개, 생성 catalog inventory, test만 exact path로 검토한다. 디렉터리/glob 인자를 금지하고 `git commit --only --`로 `부모 화면과 가족 대화를 다국어로 이관한다`를 커밋한다.

### Task 8: 아이 화면·feature·보고서·결제 문구 이관

**Files:**
- Modify: `src/screens/child/AiFriendChat.tsx`
- Modify: `src/screens/child/AiFriendSetup.tsx`
- Modify: `src/screens/child/ChildHome.tsx`
- Modify: `src/screens/child/ChildLocationStatus.tsx`
- Modify: `src/screens/child/ChildSettings.tsx`
- Modify: `src/screens/child/ChildSos.tsx`
- Modify: `src/screens/child/ChildTimetable.tsx`
- Modify: `src/screens/child/StickerBook.tsx`
- Modify: `src/screens/child/overlays/CallSheet.tsx`
- Modify: `src/screens/child/overlays/Celebrate.tsx`
- Modify: `src/screens/child/overlays/ChildSheet.tsx`
- Modify: `src/screens/child/overlays/DaySheet.tsx`
- Modify: `src/screens/child/overlays/PlaydateSheet.tsx`
- Modify: `src/screens/child/overlays/RouteSheet.tsx`
- Modify: `src/screens/child/overlays/StickerDetail.tsx`
- Modify: `src/screens/feature/AiCredit.tsx`
- Modify: `src/screens/feature/AiSchedule.tsx`
- Modify: `src/screens/feature/AppUpdate.tsx`
- Modify: `src/screens/feature/ArrivalAlerts.tsx`
- Modify: `src/screens/feature/ChildInvite.tsx`
- Modify: `src/screens/feature/DailySafetyReport.tsx`
- Modify: `src/screens/feature/DangerAlert.tsx`
- Modify: `src/screens/feature/DangerZoneForm.tsx`
- Modify: `src/screens/feature/DataSync.tsx`
- Modify: `src/screens/feature/DaySummary.tsx`
- Modify: `src/screens/feature/FamilyConnection.tsx`
- Modify: `src/screens/feature/Feedback.tsx`
- Modify: `src/screens/feature/FriendPlay.tsx`
- Modify: `src/screens/feature/LocationSettings.tsx`
- Modify: `src/screens/feature/LocationStatus.tsx`
- Modify: `src/screens/feature/Notifications.tsx`
- Modify: `src/screens/feature/NotificationSettings.tsx`
- Modify: `src/screens/feature/PairingWizard.tsx`
- Modify: `src/screens/feature/PermDenied.tsx`
- Modify: `src/screens/feature/PhoneSetup.tsx`
- Modify: `src/screens/feature/PlaceForm.tsx`
- Modify: `src/screens/feature/PlaceManager.tsx`
- Modify: `src/screens/feature/PlaydateAccept.tsx`
- Modify: `src/screens/feature/ProfileEdit.tsx`
- Modify: `src/screens/feature/RemoteAudio.tsx`
- Modify: `src/screens/feature/RemoteAudioAudit.tsx`
- Modify: `src/screens/feature/RemoteRing.tsx`
- Modify: `src/screens/feature/RouteView.tsx`
- Modify: `src/screens/feature/SosReceive.tsx`
- Modify: `src/screens/feature/StickerSend.tsx`
- Modify: `src/screens/feature/Subscription.tsx`
- Modify: `src/screens/feature/Supplies.tsx`
- Modify: `src/screens/feature/TrialLock.tsx`
- Modify: `src/screens/feature/WeeklyFamilyReport.tsx`
- Modify: `src/screens/teacher/TeacherHome.tsx`
- Modify: `src/screens/teacher/TeacherNotice.tsx`
- Modify: `src/screens/teacher/TeacherReleaseGate.tsx`
- Modify: `src/screens/teacher/TeacherSettings.tsx`
- Modify: `src/screens/teacher/TeacherStudents.tsx`
- Modify: `src/screens/teacher/TeacherTimetable.tsx`
- Modify: `src/components/QrScanner.tsx`
- Modify: `src/screens/admin/AdminAiPrompt.tsx`
- Modify: `locales/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/{child,billing,reports,notifications,shared}.json`
- Create: `tests/i18nChildScreens.test.mjs`
- Create: `tests/i18nFeatureScreens.test.mjs`

- [ ] **Step 1: child tone과 핵심 안전/결제 의미 실패 테스트를 쓴다**

Assertions must cover:

- 한국어 child namespace의 정해진 반말 핵심 문구
- SOS가 Premium 혜택으로 번역되지 않음
- 주변소리의 아이 화면 지속 표시·1분 상한·감사 기록 의미
- Play/PWA 가격 문자열은 provider formatted 값을 삽입하는 변수일 뿐 catalog 고정 금액이 아님
- 빈 AI 응답은 저장된 답변인 척하지 않음

- [ ] **Step 2: 아이 화면을 먼저 이관한다**

AI 대화 원문·메모·이름은 번역하지 않는다. UI chrome, 버튼, 상태·오류만 catalog로 옮긴다. `ChildSos` pointer capture/3초 hold와 `ChildSettings` 반말은 유지한다.

- [ ] **Step 3: feature를 도메인 순서로 이관한다**

Order and namespaces:

1. 위치/장소/알림/SOS/원격: `notifications,parent,child,shared`
2. 일정/준비물/친구놀이/스티커: `parent,child,shared`
3. AI/리포트: `reports,parent,child,shared`
4. Subscription/TrialLock/AiCredit: `billing,parent,shared`
5. Feedback/DataSync/Profile/Phone/Account: `core,parent,shared`

- [ ] **Step 4: teacher/admin은 production gate를 유지하며 이관한다**

Teacher route를 production에 다시 노출하지 않는다. 운영자 prompt 원문은 번역하지 않고 관리 UI label만 번역한다.

- [ ] **Step 5: focused와 trust-copy 회귀를 실행한다**

```powershell
node scripts/i18n/build-catalogs.mjs
node --test tests/i18nChildScreens.test.mjs tests/i18nFeatureScreens.test.mjs tests/childSosCopy.test.mjs tests/subscriptionTrustCopy.test.mjs tests/remoteAudioTrustCopy.test.mjs tests/aiScheduleUxCopy.test.mjs tests/contentSafetyUx.test.mjs
npm run typecheck
```

- [ ] **Step 6: 태스크 범위를 커밋한다**

명시한 child 8개, overlay 7개, feature 34개, teacher 6개, QR/admin 2개, locale 50개, 생성 catalog inventory, 두 test만 exact path로 검토한다. 디렉터리/glob 인자를 금지하고 `git commit --only --`로 `아이와 기능 화면 문구를 10개 언어로 이관한다`를 커밋한다.

### Task 9: PWA metadata·manifest와 literal scanner

> **진행 상태(2026-08-25)** — 게이트·metadata·위생 작업은 완료, 문구 이관은 잔여.
>
> 완료: `scripts/i18n/scan-user-facing-literals.mjs`(AST 위치 기반 sink + 모듈 간 taint) ·
> `scripts/i18n/user-facing-literal-allowlist.json`(`exempt` 7 / `pending-migration` 42) ·
> `scripts/i18n/generate-pwa-manifests.mjs` + `public/manifests/*.webmanifest` 10개 ·
> `src/i18n/documentMetadata.ts` · `index.html`(`#hyeni-manifest`·`#hyeni-description`) ·
> `vite.config.ts`(단일 manifest 링크 보장) · `src/sw.ts`(`HYENI_LOCALE` locale 전용 채널) ·
> `package.json`(`i18n:scan`/`i18n:manifests`/`i18n:verify`) ·
> `src/i18n/messages.ts`·`useMessage.ts` 삭제 · `descriptions.json` 고아 키 제거와 재발 방지 게이트 ·
> `tests/userFacingLiteralScan.test.mjs`(9) · `tests/pwaLocaleMetadata.test.mjs`(11).
>
> **미완료(다음 작업 단위)**: allowlist 의 `pending-migration` 23건 = catalog 밖에 남은 실제 사용자 문구.
> 이 항목들은 면제가 아니라 결함 기록이며, 각 항목의 `migrateTo` 로 이관하면 항목을 지워야 한다
> (남겨 두면 `stale_allowlist` 로 실패한다). 남은 덩이는 `webBilling`(결제 실패 안내 17)·
> `parentHomeSubscriptionCard`(14)·`aiBuddyEmotion`(8)·`stickerBook`·`memoView`·`deviceLabel`·`PROVIDER_LABEL`·
> `eventSupplies`·`childHomeData`·AI 친구 말풍선(voiceHint/wander/nudge)이고, 순수 transform 의 시그니처 변경
> (`intl` 주입)과 해당 회귀 테스트 갱신이 함께 필요하다.
>
> **2026-08-25 추가 완료**: 위치 권한 prominent disclosure 다이얼로그 28개 슬롯 × 2톤 = 56개 id 를
> `shared.locationPermission.*` 로 이관했다. 아이 톤 21개는 이전 task 가 만들어 두고 재배선하지 않은 죽은
> `onboarding.locationDisclosure/backgroundPermission/permissionDenied.*` 번역을 재사용했고, 원본 21개 id 는
> 정본이 둘로 갈리지 않게 제거했다(카탈로그 210항목·description 21). 회귀는
> `tests/backgroundLocationDisclosure.test.mjs` 가 10개 언어 번역 실재·브랜드 표기·한국어 잔존 0을 함께 검증한다.

**Files:**
- Create: `src/i18n/documentMetadata.ts`
- Create: `scripts/i18n/generate-pwa-manifests.mjs`
- Create: `scripts/i18n/scan-user-facing-literals.mjs`
- Create: `scripts/i18n/user-facing-literal-allowlist.json`
- Create: `public/manifests/manifest.{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}.webmanifest`
- Modify: `vite.config.ts`
- Modify: `index.html`
- Modify: `src/sw.ts`
- Modify: `package.json`
- Modify: `scripts/verify-route-bundle.mjs`
- Delete: `src/i18n/messages.ts`
- Delete: `src/i18n/useMessage.ts`
- Create: `tests/pwaLocaleMetadata.test.mjs`
- Create: `tests/userFacingLiteralScan.test.mjs`

- [ ] **Step 1: manifest 브랜드·precache·literal 실패 테스트를 작성한다**

Assertions:

- `manifest.ko.webmanifest` name/short_name=`혜니캘린더`
- other 9 manifests name/short_name=`Hyeni Calendar`
- 각 manifest `lang` 정확
- 동일 icon URL이 Workbox precache에 중복되지 않음
- JavaScript/TSX의 message API 밖 사용자 노출 literal은 한국어·영어·숫자 조합을 포함해 allowlist 밖 0
- allowlist 각 항목은 파일+정규식+사유가 있고 사용되지 않는 항목은 실패

- [ ] **Step 2: 테스트 실패를 확인한다**

Run: `node --test tests/pwaLocaleMetadata.test.mjs tests/userFacingLiteralScan.test.mjs`

Expected: generator/scanner 부재와 현재 단일 Korean manifest 때문에 FAIL.

- [ ] **Step 3: 10개 manifest와 document metadata 갱신을 구현한다**

`index.html`에는 고정 id를 둔다.

```html
<link id="hyeni-manifest" rel="manifest" href="./manifests/manifest.en.webmanifest">
<meta id="hyeni-description" name="description" content="Family calendar and safety">
```

Runtime:

```ts
export function applyDocumentLocale(locale: SupportedLocale, metadata: LocaleMetadata): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDirection(locale);
  document.title = metadata.title;
  document.querySelector<HTMLMetaElement>("#hyeni-description")?.setAttribute("content", metadata.description);
  document.querySelector<HTMLLinkElement>("#hyeni-manifest")?.setAttribute("href", metadata.manifestHref);
}
```

Service Worker initialization message carries only locale and no account/session content.

- [ ] **Step 4: deterministic literal scanner를 구현한다**

Scanner scope:

- include `src/**/*.ts`, `src/**/*.tsx`, Worker user-message scanner는 native plan이 별도 확장
- exclude comments, tests, stable error code, regex/data labels listed with explicit rationale
- fail stale allowlist entries
- detect JSX text와 `aria-label|title|placeholder`, toast/dialog/validation API로 흐르는 string/template, 사용자 표시 model 필드; 단순 `rg` count나 한글 문자 탐지만 사용하지 않음

- [ ] **Step 5: old seed i18n을 제거하고 imports 0을 확인한다**

Run:

```powershell
rg -n 'i18n/messages|i18n/useMessage|getMessages\(' src tests
```

Expected: 0 results after replacing DailySafetyReport/WeeklyFamilyReport imports.

- [ ] **Step 6: 전체 앱 검증을 실행한다**

```powershell
node scripts/i18n/generate-pwa-manifests.mjs --check
node scripts/i18n/validate-catalogs.mjs --check-generated
node scripts/i18n/scan-user-facing-literals.mjs
node scripts/i18n/scan-client-error-surfaces.mjs
node --test tests/pwaLocaleMetadata.test.mjs tests/userFacingLiteralScan.test.mjs tests/pwaPrecacheManifest.test.mjs
npm test
npm run typecheck
npm run build
```

Expected: all exit 0, route bundle budget 유지.

- [ ] **Step 7: 최종 i18n 범위를 커밋한다**

이 Task의 explicit source/test paths, 10개 manifest, 삭제 2개, generator inventory에 기록된 i18n 산출물을 exact path로 검토한다. `public/manifests`, `src/i18n`, `scripts/i18n` 같은 디렉터리 인자를 금지하고 `git commit --only --`로 `다국어 PWA 메타데이터와 문구 누락 게이트를 완성한다`를 커밋한다.

### Task 10: 다국어 브라우저 QA와 최종 범위 감사

**Files:**
- Modify: `scripts/final-browser-qa.mjs`
- Create: `scripts/global-browser-qa.mjs`
- Create: `tests/globalBrowserQaHarness.test.mjs`

- [ ] **Step 1: locale/viewport/font-scale matrix parser 실패 테스트를 작성한다**

The harness must reject unsupported locale, duplicate output path, live API origin, and any fixture containing UUID/pair code from real accounts.

- [ ] **Step 2: mock-only QA harness를 구현한다**

Required routes per locale:

- onboarding
- parent home/calendar/location/memo/settings
- child home/memo/settings/SOS
- subscription/AI credit
- notification settings/remote audio
- daily/weekly reports

Required checks: console errors, horizontal overflow, clipped controls, empty accessible names, unresolved `{messageId}`, raw message IDs, pseudo-locale expansion.

- [ ] **Step 3: focused·full QA를 실행한다**

```powershell
node --test tests/globalBrowserQaHarness.test.mjs
node scripts/global-browser-qa.mjs --locales=ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil --viewports=320x800,390x844,448x998,844x390,1280x800 --font-scale=1,2
npm run verify
```

- [ ] **Step 4: scope audit를 수행한다**

Run:

```powershell
git diff --check
node scripts/i18n/validate-catalogs.mjs --check-generated
node scripts/i18n/scan-user-facing-literals.mjs
git status --short
```

Expected: i18n task files only; user pre-existing changes unchanged.

- [ ] **Step 5: QA harness를 커밋한다**

```powershell
git add -- scripts/final-browser-qa.mjs scripts/global-browser-qa.mjs tests/globalBrowserQaHarness.test.mjs
git commit --only -- scripts/final-browser-qa.mjs scripts/global-browser-qa.mjs tests/globalBrowserQaHarness.test.mjs -m "10개 언어 브라우저 품질 행렬을 자동화한다"
```
