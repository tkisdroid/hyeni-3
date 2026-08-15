# Global Content Store Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱·법적 페이지·Google Play 제출 자료를 10개 locale로 완성하고 번역/법률 검수 증거, 개인정보 안전한 재현 가능 스크린샷, 최신 AAB 증거를 하나의 출시 gate로 묶되 Play Console 업로드나 production 배포는 수행하지 않는다.

**Architecture:** 한국어 source와 message context를 기준으로 번역 draft를 만들고 콘텐츠 등급별 review evidence가 있어야 상태를 승격한다. 공개 법적 문서는 locale별 source에서 escape-safe Worker data module로 생성하며 query/cookie/Accept-Language 순으로 선택한다. Store listing·상품·release note·caption은 기계 검증 가능한 JSON pack으로 관리하고, 고정 test family와 mock network로 새 `output/store-global-v1/`에 10개 locale 이미지를 생성한다. 제출 readiness는 콘텐츠·정책·서명 AAB 증거를 결합하지만 외부 심사/법률/서명/Console 단계는 운영자 승인 없이는 완료 처리하지 않는다.

**Tech Stack:** TypeScript/React, Cloudflare Worker, Node scripts/tests, Playwright CDP, Sharp, Android Gradle/Bundletool, Google Play Console content contracts

## Global Constraints

- 이 계획은 i18n web·native notification·region/timezone/map/auth·Paddle sandbox 계획의 구현과 관련 gate 통과 뒤 실행한다.
- 앱 locale은 정확히 `ko`, `en`, `ja`, `zh-CN`, `zh-TW`, `vi`, `th`, `id`, `ms`, `fil`; Play listing locale은 정확히 `ko-KR`, `en-US`, `ja-JP`, `zh-CN`, `zh-TW`, `vi`, `th`, `id`, `ms-MY`, `fil`이다.
- 한국어 브랜드는 `혜니캘린더`, 나머지 언어 브랜드는 `Hyeni Calendar`다. package id·앱 아이콘은 바꾸지 않는다.
- 사용자 이름·메모·사진·주소·장소명·위치 좌표는 번역하거나 Store 자료에 복사하지 않는다.
- 스크린샷은 고정 synthetic family만 사용한다. 실제 A17/razr/S25 화면, production API 응답, 실사용자 알림·지도·계정을 캡처하지 않는다.
- 기존 `output/store-ui-candidates-v1/`와 `output/store-safe-assets-v1/`를 덮어쓰지 않는다. 글로벌 결과는 새 `output/store-global-v1/`에만 쓴다.
- Tier A(안전·결제·법적)는 원어민+법률/도메인 검수 evidence 없이는 `approved`가 될 수 없다. Tier B(핵심 UI·Store)는 원어민 review가 필요하다. Tier C(AI/보조)는 문맥 포함 draft와 원어민 표본 검수 기준을 충족해야 한다.
- 번역 생성자가 review 상태를 자동으로 `reviewed`/`approved`로 올리지 않는다. reviewer 이름·연락처 대신 역할, 날짜, source hash, evidence reference만 저장한다.
- 법적 사업자명·주소·전화·지원 연락처, 일본 특정상거래법 표기와 국가별 법률 판단을 추측하지 않는다. 누락은 release blocker로 보여주고 빈 값으로 공개하지 않는다.
- 안전·위치·마이크·AI·UGC·아동·결제 고지는 현재 구현보다 넓은 기능을 약속하지 않는다. 주변소리의 아이 화면 지속 표시·1분 제한·감사 기록을 숨기지 않는다.
- Play listing과 이미지에는 가격·할인·순위·수상·다운로드 수·설치 CTA를 넣지 않는다. 실제 구현되지 않은 기능이나 무조건 전달되는 안전 기능처럼 표현하지 않는다.
- Data Safety와 reviewer guide는 third-party SDK/API까지 실제 데이터 흐름을 반영해야 하며 법률 전문가와 Play Console 운영자가 최종 확인한다.
- 서명 비밀번호는 사용자가 보이지 않는 입력으로 직접 제공한다. 에이전트는 자격 파일·환경변수 값을 읽거나 출력하지 않는다.
- production Worker/Pages/D1, Play Console 수정·업로드·제출·게시를 이 계획 실행에서 수행하지 않는다.
- 최종 실기기 검증은 별도 승인 시 A17(`RFKL40DP73J`) 부모와 razr(`ZY22H9VTQD`) 아이만 `adb install -r`로 하며 기존 역할·세션·페어링을 유지한다. S25에는 어떤 adb 접근도 하지 않는다.
- 사용자 staged/unstaged 변경을 포함하지 않도록 모든 commit은 태스크 파일을 정확히 명시한다.
- 신규 `worker/tests/*.test.mjs`가 Worker TypeScript를 import하면 파일 첫 부분에서 `./helpers/tsModuleResolve.mjs`를 직접 import한다. 존재하지 않는 root 공용 loader를 CLI `--import`로 가정하지 않는다.

---

## File Structure

### New files

- `content/review-policy.json` — Tier A/B/C와 상태 승격 조건
- `content/review-evidence.schema.json` — locale/영역/source hash/evidence 계약
- `content/review-evidence.json` — 실제 확보된 검수 증거만 기록
- `legal/manifest.json` — 법적 문서 locale, revision, fallback, review 상태
- `legal/business-profile.json` — 현재 확인된 공통 사업자 필드와 누락 blocker
- `legal/market-readiness.json` — 국가별 법률/사업자 고지 준비 상태
- `legal/source/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/{privacy,terms,data-deletion}.json`
- `scripts/content/validate-review-status.mjs`
- `scripts/legal/build-legal-content.mjs`
- `scripts/legal/validate-legal-content.mjs`
- `worker/generated/legalContent.ts` — generator output, 직접 편집 금지
- `tests/contentReviewGate.test.mjs`
- `worker/tests/legalLocaleRoutes.test.mjs`
- `store/global/manifest.json` — Play locale mapping과 asset contract
- `store/global/source/ko-KR.json` — listing/source claims 정본
- `store/global/locales/{ko-KR,en-US,ja-JP,zh-CN,zh-TW,vi,th,id,ms-MY,fil}/listing.json`
- `store/global/locales/{ko-KR,en-US,ja-JP,zh-CN,zh-TW,vi,th,id,ms-MY,fil}/products.json`
- `store/global/locales/{ko-KR,en-US,ja-JP,zh-CN,zh-TW,vi,th,id,ms-MY,fil}/release-notes.json`
- `store/global/locales/{ko-KR,en-US,ja-JP,zh-CN,zh-TW,vi,th,id,ms-MY,fil}/screenshots.json`
- `store/global/reviewer-guide.json`
- `store/global/data-safety-evidence.json`
- `store/global/policy-declarations.json`
- `scripts/store/validate-global-store-pack.mjs`
- `scripts/store/create-global-store-assets.mjs`
- `scripts/store/scan-global-store-pii.mjs`
- `scripts/store/create-global-release-notes.mjs`
- `scripts/store/create-global-submission-index.mjs`
- `tests/globalStorePack.test.mjs`
- `tests/globalStoreAssets.test.mjs`
- `tests/globalStorePii.test.mjs`
- `tests/globalLegalDisclosure.test.mjs`
- `docs/store/global-release-checklist.md`
- `docs/store/global-reviewer-guide.md`
- `docs/store/global-data-safety.md`
- `docs/store/global-submission-index.md`
- `output/store-global-v1/{ko-KR,en-US,ja-JP,zh-CN,zh-TW,vi,th,id,ms-MY,fil}/*.png` — generated candidate images
- `output/store-global-v1/manifest.json` — hash/provenance/text inventory

### Modified files

- `worker/routes/legal.ts`
- `worker/index.ts` only if locale cookie/security header middleware needs explicit wiring
- `worker/tests/legalCopy.test.mjs`
- `package.json`
- `scripts/create-safe-store-ui-candidates.mjs` only to export reusable pure fixture helpers without changing v1 output
- `scripts/create-aab-evidence.mjs` only if global locale evidence is not represented
- `docs/store/play-listing.md`, `docs/store/play-data-safety.md`, `docs/store/play-release-checklist.md` — point to global pack while preserving historical v1.3.0 text
- `src/styles/tokens.css`, `src/styles/global.css` only for verified script/font fallback defects
- locale catalogs/review status created by the i18n/native plans

### Generated files never edited manually

- `worker/generated/legalContent.ts`
- `output/store-global-v1/**`
- `docs/store/global-submission-index.md`

### Task 1: 번역 등급·검수 증거 gate

**Files:**
- Create: `content/review-policy.json`
- Create: `content/review-evidence.schema.json`
- Create: `content/review-evidence.json`
- Create: `scripts/content/validate-review-status.mjs`
- Create: `tests/contentReviewGate.test.mjs`
- Modify: `locales/descriptions.json`
- Modify: `locales/review-status.json`
- Modify: `package.json`

- [ ] `tests/contentReviewGate.test.mjs`에 정확한 10 locale, 모든 message의 Tier, source hash mismatch, evidence 없는 status 승격, unknown reviewer role, stale review, 누락 namespace를 먼저 작성한다.
- [ ] Tier별 gate를 다음처럼 단언한다.

```text
A: native-language review + legal/domain review evidence → approved
B: native-language review evidence → reviewed 이상
C: context-complete draft + locale별 sampling evidence → reviewed 이상
```

- [ ] 테스트를 실행해 policy/validator 부재로 실패하는지 확인한다.

Run: `node --test tests/contentReviewGate.test.mjs`

Expected: `content/review-policy.json` 또는 validator import 부재로 실패.

- [ ] `content/review-policy.json`에 message namespace/ID pattern별 Tier와 필요한 reviewer role을 명시한다. safety, SOS, remote listen, location consent, billing, trial/refund, auth recovery, legal은 Tier A로 고정한다.
- [ ] evidence schema는 `{locale, scope, tier, sourceHash, targetHash, reviewerRole, reviewedAt, evidenceRef}`만 허용하고 free-form review content/개인 연락처를 금지한다.
- [ ] validator는 catalog와 Store/legal source의 hash가 evidence와 달라지면 status를 자동 하향 기록하지 않고 exit 1로 막아 사람이 재검수하게 한다.
- [ ] 번역 script는 오직 `draft`를 만들 수 있고 existing reviewed target을 덮지 못하도록 한다. 원어민 sample 비율은 Tier C message의 locale별 최소 20%와 안전에 인접한 AI 문구 전부로 정한다.
- [ ] `npm run validate:content-review` script를 추가하고 tests를 통과시킨다.

Run: `npm run validate:content-review && node --test tests/contentReviewGate.test.mjs`

Expected: 현재 확보된 evidence 범위는 정확히 표시되고 승인되지 않은 locale/scope는 blocker로 exit 1. 테스트 fixture의 완전한 evidence는 exit 0.

- [ ] 초기 실행에서 실제 증거가 없는 항목을 `approved`로 채우지 않는다. blocker 결과를 다음 태스크 입력으로 보존한다.
- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('content/review-policy.json','content/review-evidence.schema.json','content/review-evidence.json','scripts/content/validate-review-status.mjs','tests/contentReviewGate.test.mjs','locales/descriptions.json','locales/review-status.json','package.json')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "글로벌 번역 검수 증거 gate를 추가한다"
```

### Task 2: locale별 법적 문서 정본과 안전한 generator

**Files:**
- Create: `legal/manifest.json`
- Create: `legal/business-profile.json`
- Create: `legal/market-readiness.json`
- Create: `legal/source/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/{privacy,terms,data-deletion}.json`
- Create: `scripts/legal/build-legal-content.mjs`
- Create: `scripts/legal/validate-legal-content.mjs`
- Create: `worker/generated/legalContent.ts`
- Create: `tests/globalLegalDisclosure.test.mjs`
- Modify: `package.json`

- [ ] 법적 validator tests에 10 locale×3 문서, section stable ID parity, required disclosure ID, HTML/script injection, placeholder/빈 사업자 필드, review evidence, revision/effective date를 먼저 작성한다.
- [ ] required disclosure를 의미 ID로 단언한다. 최소 목록은 `child_location`, `background_location`, `remote_audio_visible_60s_audit`, `ai_processing`, `ugc_report_block`, `data_deletion`, `google_play`, `paddle_new_web`, `toss_legacy`, `map_kakao`, `map_mapbox`, `cloudflare`, `fcm`, `openai`, `resend`, `ncp_sens`, `speech_provider`다.
- [ ] 테스트를 실행해 legal source/generator 부재로 실패하는지 확인한다.

Run: `node --test tests/globalLegalDisclosure.test.mjs`

Expected: legal manifest/source 부재로 실패.

- [ ] 현재 `worker/routes/legal.ts`의 한국어 META/sections를 `legal/source/ko`와 `business-profile.json`으로 손실 없이 옮긴 뒤 Paddle/Mapbox/해외 처리/country-timezone 변경을 실제 구현과 맞게 수정한다.
- [ ] 비한국어 brand는 `Hyeni Calendar`를 사용하고 각 문서에 번역된 section ID를 동일하게 유지한다. 사용자 데이터·법적 의미를 요약해 누락하지 않는다.
- [ ] `business-profile.json`에는 저장소에서 확인된 값만 넣는다. 일본 사업자명/주소/전화/가격·해지 고지 등 미확정 필드는 `null`과 blocker ID로 남기되 generator가 공개 본문에 `null`/placeholder를 렌더하지 않게 한다.
- [ ] `market-readiness.json`에 `legalReview`, `businessDisclosure`, `paddleApproval`, `mapDisclosure`를 각각 `blocked|reviewed|approved`로 분리한다. agent가 외부 증거 없이 승격하지 못하게 validator와 연결한다.
- [ ] generator는 JSON을 strict parse하고 모든 text를 Worker renderer에서 escape하는 readonly TypeScript data로 생성한다. source에 arbitrary HTML을 허용하지 않는다.
- [ ] Tier A 승인 전에도 개발 preview는 가능하되 `releaseReady:false` metadata가 명확히 남도록 한다.
- [ ] generator determinism과 disclosure tests를 통과시킨다.

Run: `node scripts/legal/build-legal-content.mjs && node scripts/legal/validate-legal-content.mjs --mode preview && node --test tests/globalLegalDisclosure.test.mjs`

Expected: 생성 파일 hash가 재실행 때 동일. preview는 draft를 보고하되 exit 0, `--mode release`는 미승인 법적 locale 때문에 exit 1.

- [ ] 이 태스크 파일만 검토·커밋한다. 30개 source file은 `legal/manifest.json`에 기록된 exact file list와 일치하는지 먼저 검증한다.

### Task 3: 공개 법적 페이지 locale negotiation과 브라우저 품질

**Files:**
- Modify: `worker/routes/legal.ts`
- Modify: `worker/tests/legalCopy.test.mjs`
- Create: `worker/tests/legalLocaleRoutes.test.mjs`
- Modify: `worker/index.ts`

- [ ] route tests에 `?lang` → `hyeni_locale` cookie → `Accept-Language` → English → Korean 순서와 중국어 alias mapping을 먼저 작성한다.
- [ ] 세 route(`/privacy`, `/terms`, `/data-deletion`) 모두 HTML `lang`, localized title/brand, language selector, canonical, 10개 `hreflang`, effective/revision, noindex 여부 정책을 단언한다.
- [ ] injection tests에 hostile query/header/cookie와 source special characters를 넣고 raw `<script>`, event handler, unescaped URL이 나오지 않는지 확인한다.
- [ ] desktop/mobile HTML smoke에 horizontal overflow, favicon 200, console error 0, keyboard language selector, visible focus를 추가한다.
- [ ] 테스트를 실행해 Korean-only output으로 실패하는지 확인한다.

Run: `node --test worker/tests/legalCopy.test.mjs worker/tests/legalLocaleRoutes.test.mjs`

Expected: locale negotiation 또는 HTML metadata 단언 실패.

- [ ] `legal.ts`가 generated data만 읽고 locale resolver를 통해 section을 선택하도록 바꾼다. unsupported locale은 English, English document runtime 손상은 Korean으로 fallback한다.
- [ ] selector는 GET query navigation만 사용하고 cookie에는 지원 locale만 `SameSite=Lax; Secure; Path=/; Max-Age=31536000`으로 저장한다. 인증/사용자 ID를 cookie에 넣지 않는다.
- [ ] 공개 페이지에 strict CSP, `X-Content-Type-Options`, `Referrer-Policy`, clickjacking 방지 header를 유지/추가하고 external tracker를 넣지 않는다.
- [ ] blocker가 있는 국가별 별도 고지 페이지는 공개하지 않고 global 공통 문서만 표시한다. 출시 국가 활성화는 readiness가 결정한다.
- [ ] route/browser tests와 Worker typecheck를 통과시킨다.

Run: `node --test worker/tests/legalCopy.test.mjs worker/tests/legalLocaleRoutes.test.mjs && npm run typecheck:worker`

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

```powershell
$taskFiles = @('worker/routes/legal.ts','worker/tests/legalCopy.test.mjs','worker/tests/legalLocaleRoutes.test.mjs','worker/index.ts')
git diff --check -- $taskFiles
git add -- $taskFiles
git commit --only -- $taskFiles -m "공개 법적 페이지를 10개 언어로 제공한다"
```

### Task 4: Google Play 10-locale listing pack

**Files:**
- Create: `store/global/manifest.json`
- Create: `store/global/source/ko-KR.json`
- Create: `store/global/locales/{ko-KR,en-US,ja-JP,zh-CN,zh-TW,vi,th,id,ms-MY,fil}/listing.json`
- Create: `store/global/locales/{ko-KR,en-US,ja-JP,zh-CN,zh-TW,vi,th,id,ms-MY,fil}/products.json`
- Create: `store/global/locales/{ko-KR,en-US,ja-JP,zh-CN,zh-TW,vi,th,id,ms-MY,fil}/release-notes.json`
- Create: `store/global/locales/{ko-KR,en-US,ja-JP,zh-CN,zh-TW,vi,th,id,ms-MY,fil}/screenshots.json`
- Create: `scripts/store/validate-global-store-pack.mjs`
- Create: `scripts/store/create-global-release-notes.mjs`
- Create: `tests/globalStorePack.test.mjs`
- Modify: `package.json`

- [ ] tests에 정확한 Play locale set, runtime mapping, brand, required fields, Unicode character limits를 먼저 작성한다.

```text
appName ≤ 30
shortDescription ≤ 80
fullDescription ≤ 4000
releaseNotes ≤ 500 Unicode characters
in-app product title ≤ 55, 권장 25
in-app product description ≤ 200
screenshot alt text ≤ 140
```

- [ ] metadata policy tests에 순위/수상/다운로드/기간 한정/가격/할인/설치 CTA token, keyword repetition, unsupported feature claim, Android external payment claim을 locale별 denylist+manual checklist로 추가한다.
- [ ] listing claim IDs가 구현 evidence와 연결되는지 단언한다. `family_calendar`, `parent_child_location`, `arrival_alert`, `sos`, `memo`, `ai_schedule`, `remote_audio`에는 각 한계/조건 disclosure ID가 따라야 한다.
- [ ] 테스트를 실행해 Store pack 부재로 실패하는지 확인한다.

Run: `node --test tests/globalStorePack.test.mjs`

Expected: manifest/listing files 부재로 실패.

- [ ] Korean source listing은 현재 앱 계약을 정직하게 반영하고 아래를 명시한다: 위치/알림은 권한·배터리·네트워크에 따라 지연, SOS는 긴급기관 대체 아님, remote listen은 프리미엄·아이 화면 표시·1분·감사, 안전 기본 기능은 무료.
- [ ] 9개 target listing을 context와 glossary로 작성한다. machine/AI draft는 `draft`로 남기고 Tier B 원어민 review evidence 없이 release pack을 통과시키지 않는다.
- [ ] app name은 `ko-KR=혜니캘린더`, 나머지 모두 `Hyeni Calendar` exact로 한다.
- [ ] product text는 Google Play 월/연 구독과 AI packs만 포함한다. Paddle/Toss는 Android product/localization 파일에 넣지 않는다. 가격은 product text에 하드코딩하지 않는다.
- [ ] release notes는 이 글로벌 build에서 실제 완료된 locale/timezone/map/notification 변화만 서술하고 홍보 CTA를 넣지 않는다. generator가 `<en-US>…</en-US>`처럼 실제 locale tag를 사용한 Play Console 복사용 파일도 만든다.
- [ ] validator가 source hash와 review evidence까지 검사하도록 연결하고 tests를 통과시킨다.

Run: `node scripts/store/validate-global-store-pack.mjs --mode preview && node scripts/store/create-global-release-notes.mjs && node --test tests/globalStorePack.test.mjs`

Expected: draft locale 목록을 명확히 출력하고 preview exit 0. `--mode release`는 native review 미완료 시 exit 1.

- [ ] 이 태스크 source/scripts/tests만 명시해 커밋한다. generated screenshots는 아직 만들지 않는다.

### Task 5: reviewer guide·Data Safety·정책 선언 pack

**Files:**
- Create: `store/global/reviewer-guide.json`
- Create: `store/global/data-safety-evidence.json`
- Create: `store/global/policy-declarations.json`
- Create: `docs/store/global-reviewer-guide.md`
- Create: `docs/store/global-data-safety.md`
- Create: `tests/globalStorePolicyPack.test.mjs`
- Modify: `docs/store/play-data-safety.md`
- Modify: `docs/store/play-release-checklist.md`

- [ ] tests에 로그인 제한 기능 접근 단계, parent/child 별도 review account 슬롯, OTP/페어링 설명, remote listen/FGS/full-screen/background location/usage access/CALL_PHONE/notification permission을 먼저 작성한다.
- [ ] `policy-declarations.json`은 `appCategory`, `storeTags`, `ads`, `targetAudience`, `contentRating`, `appAccess`, `backgroundLocation`, `foregroundService`, `fullScreenIntent`, `monitoringTool`, `dataSafetyOwner`, `supportContact`, `privacyUrl`, `deletionUrl`를 각각 현재 값·evidence·owner sign-off·blocker로 분리한다. 기존 `앱·육아(Parenting)`과 광고 없음도 코드/Console 운영자가 재확인하기 전 자동 승인하지 않는다.
- [ ] Data Safety evidence가 현재 코드와 data-flow inventory에 연결되는지 검사한다. 최소 provider는 Cloudflare, FCM, Google Play, Paddle(PWA), legacy Toss, Google/Kakao/Naver OAuth, Kakao Maps, Mapbox, routing provider, OpenAI, Resend, NCP SENS, OS/Web Speech다.
- [ ] 각 provider마다 `dataCategories`, `purpose`, `transient|stored`, `encryptedInTransit`, `deletion`, `evidenceRefs`, `reviewStatus`가 없으면 release test를 실패시킨다.
- [ ] Play Families/target audience는 앱이 아이 계정과 정밀 위치·마이크·사용정보를 처리한다는 사실을 숨기지 않고 운영자/법률 검토가 필요하다는 blocker를 단언한다.
- [ ] 테스트를 실행해 policy pack 부재로 실패하는지 확인한다.

Run: `node --test tests/globalStorePolicyPack.test.mjs`

Expected: policy JSON/docs 부재로 실패.

- [ ] reviewer guide에 fixed synthetic review family 생성/초기화 절차와 부모 PWA·아이 Android 경로를 적는다. production 사용자 계정이나 실사용 pair code를 문서에 넣지 않는다.
- [ ] 주변소리는 아이 탭 없이 시작되지만 아이 화면/알림 지속 표시, server approval token, 1분 상한, audit log가 있다는 정확한 검토 절차를 포함한다.
- [ ] Android 결제 검토에는 Play license tester만 적고 Paddle URL을 제공하지 않는다. PWA Paddle sandbox는 Play reviewer의 Android 결제 단계로 제시하지 않는다.
- [ ] Data Safety 문서는 현재 code evidence와 계약/DPA evidence를 구분한다. 계약 또는 법률 판단이 없는 provider를 “서비스 제공자 예외 확정”으로 표시하지 않는다.
- [ ] 2026-07-15 Play 정책 공지의 정확한 위치 disclosure/AI/미성년자 변경과 제출일 현재 정책을 운영자가 다시 확인할 checklist를 추가한다.
- [ ] 기존 한국 release 문서는 역사 기록으로 보존하고 상단에 global 정본 링크를 추가한다.
- [ ] tests를 통과시킨다.

Run: `node --test tests/globalStorePolicyPack.test.mjs tests/subscriptionTrustCopy.test.mjs tests/remoteAudioTrustCopy.test.mjs tests/childSosCopy.test.mjs`

Expected: 전체 통과.

- [ ] 이 태스크 파일만 검토·커밋한다.

### Task 6: 개인정보 안전한 10-locale Store 스크린샷 생성

**Files:**
- Create: `scripts/store/create-global-store-assets.mjs`
- Create: `scripts/store/scan-global-store-pii.mjs`
- Create: `tests/globalStoreAssets.test.mjs`
- Create: `tests/globalStorePii.test.mjs`
- Modify: `scripts/create-safe-store-ui-candidates.mjs` only to export pure reusable fixture helpers
- Verify only: `output/store-listing-assets-v1/play-icon-512.png`
- Verify only: `output/store-listing-assets-v1/play-feature-graphic-1024x500.png`
- Create: `output/store-global-v1/{ko-KR,en-US,ja-JP,zh-CN,zh-TW,vi,th,id,ms-MY,fil}/*.png` (generator output, 직접 편집 금지)
- Create: `output/store-global-v1/manifest.json` (generator output, 직접 편집 금지)

- [ ] asset tests에 exactly 10 locale×6 phone screenshots, 1080×1920, PNG 24-bit/no alpha, deterministic ordering, no overwrite of v1 directories를 먼저 작성한다. 공용 Play icon은 512×512, feature graphic은 1024×500인지 검사하고 locale별 manifest가 같은 검증 hash를 참조하게 한다.
- [ ] fixture tests에 fixed IDs/names, zero production network, no real coordinates/phone/email/token, stable mocked clock, locale-specific UI/caption, user content nontranslation을 추가한다.
- [ ] screenshot scenes를 다음 6개로 고정한다.

```text
01 parent home / free safety summary
02 family calendar / assigned child
03 child-specific family memo / synthetic content
04 parent location / synthetic map and visible accuracy-time caveat
05 daily safety report / premium detail
06 child home / SOS and family schedule
```

- [ ] 테스트를 실행해 generator/output 부재로 실패하는지 확인한다.

Run: `node --test tests/globalStoreAssets.test.mjs tests/globalStorePii.test.mjs`

Expected: generator/output contract 부재로 실패.

- [ ] 기존 candidate generator에서 fixture injection/readiness/hash helpers만 export하고 `SAFE_STORE_UI_CANDIDATE_DIR` 동작과 기존 files/hash expectations를 바꾸지 않는다.
- [ ] global generator는 fresh build와 local preview만 사용하고 모든 API/Map SDK/WebSocket/FCM request를 deterministic mock으로 차단한다. unexpected outbound request 한 건이면 실패한다.
- [ ] same synthetic values를 모든 locale에서 유지해 사용자 이름/메모가 번역되는 것처럼 보이지 않게 한다. UI chrome/caption/alt text만 locale별 source를 쓴다.
- [ ] 기존 Play icon/feature graphic은 사람의 시각 검토에서 언어 의존 텍스트·실사용 데이터가 없다고 확인된 경우에만 byte-for-byte 공용 재사용한다. `assets/11-store-listing/screenshot-app-A17.png`, `screenshot-app-razr.png`와 기타 실기기 캡처는 generator 입력 allowlist에서 명시적으로 거부한다.
- [ ] manifest에 source commit, dirty flag, dist hash, catalog hash, listing hash, fixture version, locale, route, role, tier, viewport, visible text inventory, PNG SHA-256, generatedAt을 기록한다. generatedAt은 pixels에 영향을 주지 않는다.
- [ ] PII scanner는 fixture allowlist 밖의 email/phone/JWT/UUID-like production ID/lat-lng/API key pattern과 production hostname request를 DOM text inventory/network log/manifest에서 검사한다. image만 보고 안전하다고 단정하지 않고 human visual review 상태도 별도 필드로 둔다.
- [ ] 10 locale assets를 새 output path에 생성하고 동일 commit에서 재실행한 PNG hashes가 일치하는지 확인한다.

Run: `npm run build && node scripts/store/create-global-store-assets.mjs && node scripts/store/scan-global-store-pii.mjs && node --test tests/globalStoreAssets.test.mjs tests/globalStorePii.test.mjs tests/safeStoreUiCandidates.test.mjs`

Expected: 전체 통과, 기존 v1 hash/파일 불변, 60개 새 PNG 생성.

- [ ] generated output은 용량·diff를 별도 검토하고 source/scripts와 분리 커밋한다. 현재 사용자 수정이 있는 `output/store-ui-candidates-v1/`는 stage하지 않는다.

### Task 7: 10-locale 시각·접근성·글꼴 QA

**Files:**
- Create: `docs/store/global-visual-qa.md`
- Modify: `src/styles/tokens.css` only if a verified font stack defect exists
- Modify: `src/styles/global.css` only if a verified overflow/glyph defect exists
- Modify: affected component CSS only after reproducing a locale defect
- Modify: `tests/globalStoreAssets.test.mjs`

- [ ] browser matrix를 `320×568`, `390×844`, `448×998`, landscape `844×390`, desktop `1280×800`, 200% text에서 10 locale로 실행한다.
- [ ] 각 route에서 horizontal overflow 0, clipped controls 0, missing glyph/tofu 0, console/page error 0, focus label 존재, dialog keyboard trap, reduced motion을 기계/수동 체크로 기록한다.
- [ ] CJK와 동남아 결합문자에 system font fallback을 사용하고 remote font load 실패가 텍스트를 숨기지 않는지 확인한다. locale별 별도 폰트 다운로드를 추가하기 전 bundle/privacy/license를 검토한다.
- [ ] 실패가 있으면 해당 locale+route+viewport를 최소 재현 test에 먼저 추가한 뒤 최소 CSS만 수정한다. 번역을 줄여 layout bug를 숨기지 않는다.
- [ ] screenshot caption이 이미지 면적 20%를 넘지 않고 Play 금지 CTA/가격/순위가 없는지 확인한다.
- [ ] first three screenshots에 실제 UI가 우선 보이고 동일 메시지가 반복되지 않는지 locale별 review한다.
- [ ] build/visual tests를 통과시킨다.

Run: `npm run build && node scripts/store/create-global-store-assets.mjs --verify-only && node --test tests/globalStoreAssets.test.mjs tests/mobileViewportCss.test.mjs`

Expected: 전체 통과.

- [ ] `docs/store/global-visual-qa.md`에 자동/수동 증거를 분리하고 확인하지 않은 locale은 체크하지 않는다.
- [ ] 실제 defect로 수정한 exact CSS/test/doc만 명시해 커밋한다.

### Task 8: 제출 index와 외부 blocker gate

**Files:**
- Create: `scripts/store/create-global-submission-index.mjs`
- Create: `docs/store/global-submission-index.md`
- Create: `docs/store/global-release-checklist.md`
- Modify: `store/global/manifest.json`
- Modify: `package.json`
- Modify: `tests/globalStorePack.test.mjs`
- Modify: `tests/globalStorePolicyPack.test.mjs`

- [ ] submission index tests에 모든 listing/product/release-note/screenshot/legal/policy 파일 hash, review status, blocker, evidence link를 먼저 작성한다.
- [ ] release mode가 다음 중 하나라도 없으면 exit 1인지 단언한다: Tier A/B evidence, Tier C sample, legal market readiness, Japanese business disclosure, Paddle live approval, Mapbox readiness, support email receive test, privacy/deletion URL 200, Data Safety owner sign-off.
- [ ] Play file limits/asset dimensions를 공식 값으로 상수화하고 source URL/확인일을 manifest에 기록한다.
- [ ] 테스트를 실행해 index generator 부재로 실패하는지 확인한다.

Run: `node --test tests/globalStorePack.test.mjs tests/globalStorePolicyPack.test.mjs`

Expected: submission index 단언 실패.

- [ ] generator가 locale별 복사 가능한 app name/short/full/release notes, product strings, screenshot paths/alt text, legal URLs, reviewer guide section을 하나의 Markdown index로 만든다.
- [ ] `global-release-checklist.md`는 `code`, `automated`, `human-language`, `legal`, `provider`, `console`, `signed-artifact`, `device` 증거를 별도 열로 두고 한 등급이 다른 등급을 대체하지 못하게 한다.
- [ ] blocker에는 책임 역할과 필요한 evidence 종류만 적고 deadline/승인 결과를 추측하지 않는다.
- [ ] preview index를 생성하고 draft/blocker가 정확히 보이는지 확인한다.

Run: `node scripts/store/create-global-submission-index.mjs --mode preview && node scripts/store/validate-global-store-pack.mjs --mode preview`

Expected: preview files 생성, 미완료 항목은 `BLOCKED`/`DRAFT`로 표시.

- [ ] release mode는 외부 evidence가 실제 채워진 뒤에만 실행한다.

Run: `node scripts/store/create-global-submission-index.mjs --mode release`

Expected before external approvals: exit 1 with secret-free blocker IDs. 모든 외부 증거 후: exit 0.

- [ ] source/generator/generated index/checklist만 명시해 커밋한다.

### Task 9: 최신 AAB 신선도·서명 증거

**Files:**
- Modify: `scripts/create-aab-evidence.mjs` only if locale evidence fields are missing
- Modify: `docs/store/global-release-checklist.md`
- Generate: `artifacts/release-evidence/YYYYMMDD-HHMMSS/` 아래의 evidence files only after operator-controlled signing
- Verify: `tests/releaseRecord.test.mjs`
- Verify: `tests/androidReleaseSigningWorkflow.test.mjs`
- Verify: `tests/releaseBuildSafety.test.mjs`

- [ ] AAB evidence tests에 source commit이 모든 global code/content commit 이후인지, clean build dist hash와 Capacitor packaged public hash 일치, 10 Android locale resources와 `locale_config.xml`, versionName/versionCode/package/signing certificate/permissions/ELF alignment을 추가한다.
- [ ] 기존 stale AAB가 디스크에 있어도 source SHA/mtime/hash가 현재 commit과 다르면 실패하는지 확인한다.
- [ ] unsigned debug/old release bundle을 Play-ready로 표시하지 않는지 확인한다.
- [ ] evidence tests를 먼저 실행한다.

Run: `node --test tests/releaseRecord.test.mjs tests/androidReleaseSigningWorkflow.test.mjs tests/releaseBuildSafety.test.mjs`

Expected: 기존 tests 통과; 신규 locale evidence를 추가했다면 현재 stale AAB fixture는 의도대로 실패.

- [ ] code/content가 모두 확정된 clean commit에서 `npm run build && npx cap sync android`를 실행하고 Android unit/assemble/lint를 통과시킨다.

Run:

```powershell
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npx cap sync android
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Push-Location android
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
$gradleExit = $LASTEXITCODE
Pop-Location
if ($gradleExit -ne 0) { exit $gradleExit }
```

Expected: 모두 성공.

- [ ] 운영자가 `scripts/build-android-release.ps1`의 interactive secure prompt로 비밀번호를 직접 입력하게 한다. 에이전트는 keystore credential file을 열거나 비밀번호 환경변수를 출력하지 않는다.
- [ ] 서명 release AAB가 생성된 뒤 existing `npm run release:aab-evidence` 계약으로 SHA-256, certificate, bundle manifest, source SHA, dist/package hash, mtime을 기록한다.
- [ ] AAB evidence source commit이 global submission index의 source commit과 exact match인지 확인한다.
- [ ] 이 단계는 AAB 준비까지만 한다. Play Console upload/track selection/submit/publish는 수행하지 않는다.
- [ ] artifact는 기존 사용자 `artifacts/` 변경과 충돌할 수 있으므로 자동 stage/commit하지 않고 운영자에게 경로와 recoverability를 보고한다.

### Task 10: 최종 사전 출시 검증과 제한된 실기기 handoff

**Files:**
- Modify: `docs/store/global-release-checklist.md`
- Modify: `docs/store/global-submission-index.md`
- No production/Console source mutation

- [ ] 전체 자동 검증을 실행한다.

Run: `npm run typecheck && npm run test && npm run build && npm run typecheck:worker && npm run test:worker`

Expected: 모두 exit 0.

- [ ] content/legal/store release validators를 실행한다.

Run: `npm run validate:content-review && node scripts/legal/validate-legal-content.mjs --mode release && node scripts/store/validate-global-store-pack.mjs --mode release && node scripts/store/scan-global-store-pii.mjs && node scripts/store/create-global-submission-index.mjs --mode release`

Expected before external reviews: blocker ID와 함께 exit 1이며 출시를 진행하지 않는다. 모든 실제 evidence 후: 전체 exit 0.

- [ ] 외부 승인과 서명 artifact가 모두 준비된 경우에만 사용자에게 A17/razr 실기기 검증 승인을 다시 확인한다. 승인 없이는 adb를 실행하지 않는다.
- [ ] 승인 후 `adb -s RFKL40DP73J install -r android/app/build/outputs/apk/debug/app-debug.apk`와 `adb -s ZY22H9VTQD install -r android/app/build/outputs/apk/debug/app-debug.apk`만 사용한다. 앱 데이터·역할·세션·페어링을 유지하고 로그아웃/역할 전환/재페어링/refresh token 접근을 하지 않는다.
- [ ] A17 부모 Android에서 locale switch/부모 화면/Play 전용 결제 경계, razr 아이에서 locale/native notification/child safety UI를 검증한다. 두 기기의 서로 다른 언어가 유지되고 구조화 알림이 각 endpoint locale로 보이는지 확인한다. 부모 iPhone PWA 경로는 허용된 실기기가 없으므로 mock-only 브라우저 행렬 증거와 별도로 구분하고 실기기 통과로 위장하지 않는다.
- [ ] 실결제 대신 Google Play license test와 Paddle sandbox만 사용한다. 테스트로 만든 server data/settings는 안전 불변식을 확인하고 원복한다.
- [ ] S25는 설치·실행·로그·세션 조회를 포함해 접근하지 않는다.
- [ ] production Worker/Pages/D1, Play Console listing/product/data-safety/track, store upload/publish를 수행하지 않고 submission pack과 남은 human/Console 단계만 handoff한다.
- [ ] 최종 `git status --short`, `git diff --check`, artifact hashes를 확인하고 사용자 기존 변경이 commit에 포함되지 않았음을 기록한다.

### Completion Gate

- [ ] 앱·Android·알림·법적·Store 콘텐츠의 exact 10 locale coverage와 fallback 검사가 통과한다.
- [ ] Tier A/B/C가 각 review evidence 규칙을 충족하며 source 변경 뒤 stale review가 없다.
- [ ] 공개 법적 세 페이지가 10 locale에서 올바른 lang/brand/disclosure로 열리고 법률·사업자 blocker가 해소됐다.
- [ ] Play app name/short/full/release/product/alt text limits와 metadata policy 검사가 통과한다.
- [ ] 60개 screenshot이 synthetic fixture, zero production network, PII scan, human visual review, deterministic hash를 갖는다.
- [ ] Data Safety/reviewer/policy pack이 현재 코드·provider evidence와 일치하고 operator/legal sign-off가 있다.
- [ ] latest signed AAB가 현재 global source commit·dist와 일치하며 사용자가 직접 입력한 signing flow로 증명됐다.
- [ ] 승인된 경우 A17/razr만 세션 보존 설치로 통과했고 S25에는 접근하지 않았다.
- [ ] production/Play Console/store에는 자동 변경이나 업로드가 없다.

## Implementation References

- Play listing field limits: `https://support.google.com/googleplay/android-developer/answer/9859152`
- Play localization: `https://support.google.com/googleplay/android-developer/answer/9844778`
- Play screenshot/feature graphic rules: `https://support.google.com/googleplay/android-developer/answer/9866151`
- Play release notes: `https://support.google.com/googleplay/android-developer/answer/9859348`
- Play review/app content: `https://support.google.com/googleplay/android-developer/answer/9859455`
- Play Data Safety: `https://support.google.com/googleplay/android-developer/answer/10787469`
- Play Families policy: `https://support.google.com/googleplay/android-developer/answer/9893335`
