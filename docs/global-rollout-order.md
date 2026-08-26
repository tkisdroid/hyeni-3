# 글로벌화 작업 순서 (2026-08-25 갱신, main `17057c0` 기준)

> 정본 계획은 `docs/superpowers/plans/2026-08-15-global-version-program.md`(총괄)와 하위 5개 계획이다.
> 직전 세션 인수인계는 `docs/handoff-2026-08-25-i18n.md` — **먼저 읽을 것**. 이 문서는 그 위에서
> **전체 프로그램 단계 순서와 게이트·차단선**을 담당한다.
> 계획 문서와 충돌하면 계획을 우선하고 계획을 먼저 고친다.
> `docs/market-expansion-plan.md`는 완료 표기가 없는 시장 전망 문서이며 현재 구현 현실보다 뒤처져 있다(참고용).

## 한 줄 현황

**10개 언어 웹 i18n(하위 계획 Task 1~9)이 main에 전부 들어왔고, 2026-08-25에 Pages 배포와 브랜드 현지화(A안)까지 끝났다.**
사용자 노출 문구 이관 잔여는 0건이며 게이트는 전부 통과한다
(테스트 **1,974/1,974**, `i18n:verify` exit 0, Android `assembleDebug lintDebug testDebugUnitTest` BUILD SUCCESSFUL).
지금 막혀 있는 것은 **razr·S25 미연결로 인한 아이 화면 실기기 검증**과
**`eventCompanionPrompt` 분류 정책 결정**, 그리고 **스토어 전체 설명 9 locale 번역**이다.

| 축 | 상태 |
|---|---|
| 웹 런타임(locale 감지·저장·Provider·Boundary·ICU 포맷) | 완료 |
| 카탈로그(10 locale × 9 namespace) | 완료 |
| 부모·아이·기능 화면 문구 이관 | 완료 |
| 사용자 노출 literal 게이트 + 다국어 PWA manifest | 완료 (`pending-migration` 42 → 0, `exempt` 6) |
| Pages 배포 + 웹 PWA manifest 검증 | 완료 (2026-08-25) |
| **브랜드 locale별 현지화(A안)** | **완료 (2026-08-25 TK 승인)** |
| 부모 화면 실기기 검증(en·ja·vi) | **완료 — 원시 id 0건** |
| **Android 앱 이름·전체화면 문구 locale 리소스** | **완료 (values-* 9개 + localeConfig)** |
| **Play listing pack(앱 이름·짧은 설명)** | **완료 10 locale** |
| Play listing 전체 설명 | **9 locale 번역 대기**(blocker로 노출) |
| 아이 화면 실기기 검증 | 막힘 — razr·S25 미연결 |
| `eventCompanionPrompt` 꼬리말 | TK 결정 대기 (아래 3택) |
| 스토어 스크린샷 locale별 생성 | 미착수 |
| Worker 알림·법적 페이지·AI 답변 언어 | 미착수 |
| 국가·시간대·지도(Google Maps)·해외 로그인 | 설계 승인, 구현 미착수·Google 자격 미발급 |
| Paddle 글로벌 결제 | 미착수 |
| 번역 원어민 검수 | 미착수 (`locales/review-status.json` 90/90 `draft`) |

### 브랜드 표기 정본 (2026-08-25 TK 승인 A안)

고유명 `Hyeni`를 유지하고 "캘린더"에 해당하는 **일반명사만 현지어**로 쓴다. 음역(`ヘニ`·`慧尼` …)은 채택하지 않았다.

| locale | 브랜드 | | locale | 브랜드 |
|---|---|---|---|---|
| ko | 혜니캘린더 | | th | ปฏิทิน Hyeni |
| en | Hyeni Calendar | | id | Kalender Hyeni |
| ja | Hyeni カレンダー | | ms | Kalendar Hyeni |
| zh-CN | Hyeni 日历 | | fil | Kalendaryo Hyeni |
| zh-TW | Hyeni 日曆 | | vi | Lịch Hyeni |

⚠️ **캐릭터 이름 "혜니"의 음역(`ヘニ`·`惠妮`)은 브랜드가 아니다** — AI 친구 이름으로 이미 각 locale에 승인돼 있다
(`child.aiPersona.*.greeting`, `child.home.hyeniAlt`). 브랜드 감사에서 음역을 차단하면 캐릭터가 깨진다.

정본이 사는 곳은 다섯 군데이고 서로 일치해야 한다:
`src/i18n/locale.ts`의 `BRAND_NAMES` · `locales/manifest.json`의 `brandName` · `locales/glossary.json`의 `brand` ·
각 locale `core.brand.name`(+`core.brand.nameRich`는 일반명사만 강조) · `locales/<l>/android.json`의 `android.appName`.
`tests/task8LocaleQuality.test.mjs`가 앞의 셋을 한 표로 교차 검증한다.

A안을 강제하는 감사 규칙은 `scripts/i18n/audit-task8-locales.mjs`의 세 검사다.
- `brand_title` — `billing.subscription.hero.title` === `${brandName} Premium`
- `brand_missing` — ko에 브랜드가 든 id는 해당 locale 브랜드를 반드시 포함
- `brand_foreign` — 자기 것이 아닌 **다른 locale 브랜드 혼입 금지**(신설)

### 이미 닫힌 판정 — 다시 조사하지 말 것

- **`feat/global-version` 브랜치 갈라짐**: 존재하지 않는다. 해당 작업은 main에 반영됐고
  `origin/merge/global-into-main-20260817`은 브랜치 전용 커밋 0인 stale ref다.
- **`AI_BUDDY_VOICE_HINT_LINE` 문구 이관 승인**: 계획의 Modified files가 `src/transform/**/*.ts`를 이미 허용하고
  Global Constraints가 모든 사용자 노출 literal의 catalog 이관을 요구하므로 TK 추가 승인 대상이 아니었다. 이관 완료.
- **위생 작업**: `src/i18n/messages.ts`·`useMessage.ts`·`tests/i18nMessages.test.ts` 삭제 완료,
  `descriptions.json` 손상 키 제거 완료, i18n npm script 4종(`i18n:build`/`i18n:manifests`/`i18n:scan`/`i18n:verify`) 추가 완료.

---

## 0단계 — TK 결정이 필요한 것

### `eventCompanionPrompt` 꼬리말을 어떻게 할지 (유일하게 남은 문구 결함)

**2026-08-25 코드 조사 결과 — 문구 이관과 분류 정책은 분리 가능하다.** 실제 범위는 알려진 것보다 훨씬 작다.

사용자에게 **직접 보이는** 한국어는 `KIND_ASK` 11개뿐이고, 소비처는 `src/transform/aiBuddyNudge.ts:114`
**한 곳**(`nextEventNudge`의 `tail`)이다. 같은 함수의 `line`은 이미 catalog id를 쓰고 `intl`도 이미 받는다.
남은 하드코딩은 두 곳이다:

```ts
// src/transform/aiBuddyNudge.ts:114 부근
const tail = eventCompanionAsk(input.nextEventTitle);          // ① KIND_ASK 11개(한국어)
fullLine: when ? `${when}에 ${title} 있어. ${tail}`             // ② 조사·서술어까지 하드코딩 템플릿
                : `오늘 ${title} 있어. ${tail}`,
```

같은 파일의 다른 함수는 **src 소비처가 0**이다(`eventCompanionGoLine` 0건, `eventCompanionSuggestions`·
`buildEventCompanionGreeting`은 테스트만). Worker가 쓰는 것은 분류·프롬프트 쪽이고
`worker/shared/aiEventContext.js`에는 **사용자 노출 문구가 없다**(`KIND_PROMPT_HINT`는 LLM에게 주는 지시문).
→ **문구 이관은 Worker를 건드리지 않는다.**

분류 정확도는 별개 문제다. 키워드 표가 한국어 전용이라 비한국어 제목은 `general`로 떨어지고,
그때 나오는 것은 틀린 말이 아니라 **덜 구체적인 말**(`general` = "어떤 날이 될까?")이다 — fail-soft다.

**정해야 할 것 — 아래 선택이 번역 작업량을 좌우한다:**

| 선택 | 뜻 | 필요한 문구 |
|---|---|---|
| ① locale별 키워드 표 | 언어마다 키워드 표를 둔다 | ask 11개 × 10 locale + 키워드 표 10개 언어 |
| ② LLM 분류 | 서버가 성격을 판정한다 | ask 11개 × 10 locale + Worker 변경 |
| ③ 한국어 locale 한정 노출 | 비한국어에서는 꼬리말을 뺀다 | **ask 번역 불필요**(ko만 유지) |

③을 택하면 ask 11개를 10개 언어로 번역하는 일이 헛일이 되므로, **결정 전에 구현을 시작하지 않는다.**
어느 쪽이든 ②번 `fullLine` 템플릿(조사 포함)은 catalog id로 옮겨야 한다.

---

## 문구를 고칠 때 반드시 지켜야 하는 순서 (모든 단계 공통)

`locales/<locale>/*.json` 10개만 고치면 화면에는 여전히 `child.aiChat.voice.speaking` 같은 **원시 id**가 보인다.
런타임이 읽는 것은 커밋된 생성물 `src/i18n/generated/catalogs/**`이고 빌드가 재생성하지 않는다.
**이 함정은 테스트로 잡히지 않는다 — 브라우저 육안 확인이 유일하다.**

1. **먼저 `locales/`를 검색한다** — 이전 task가 번역만 해 두고 컴포넌트를 재배선하지 않은 id가 실제로 있었다
   (위치 권한 고지 21개). `validate-catalogs`는 미사용 id를 잡지 못한다.
2. 10개 locale JSON 수정 (`ko en ja zh-CN zh-TW vi th id ms fil`). **정렬돼 있지 않으므로 새 키는 뒤에 append**한다.
3. `locales/descriptions.json`에 같은 키 추가(`namespace`·`audience`·`qualityTier`·`description` — 없으면
   `missing_description:<id>`로 생성 실패).
4. `npm run i18n:build` → `npm run i18n:verify` → `npm run build`

추가 계약:
- **namespace는 그 컴포넌트를 쓰는 모든 라우트 그룹에 있어야 한다.** 공용 다이얼로그는 `shared`,
  ChildShell+PushShell 양쪽에 뜨는 `AiBuddyFab`·`ChildDock`은 `core`. 누락 시 콜드 스타트에서 원시 id가 보인다.
- `intl`을 받는 transform은 `withDefaultIntl` 계약을 따른다(마지막 인자 `providedIntl?: IntlShape`,
  본문 첫 줄 `const intl = withDefaultIntl(providedIntl)`). 선택 인자를 중간에 끼우면 기존 호출의 숫자 인자가 intl 자리로 들어간다.
- message id는 **정적**이어야 한다(템플릿·element access 조립은 `unclassified_dynamic_id`로 막힌다).
- 새 `withDefaultIntl` 호출자를 추가하면 `npm run i18n:build`로 `legacyKoreanMessages`를 재생성하고
  `tests/defaultIntlFallback.test.mjs`의 id 수·importer 수 기대값을 갱신한다.
- 브랜드명처럼 의도적으로 영어와 같은 값은 `scripts/i18n/audit-task8-locales.mjs`의 `identicalEnglishAllowlist`에 근거와 함께 등록한다.

---

## 1단계 — 실기기·PWA 육안 검증 (진행 중 — 부모/아이 화면은 로그인 대기)

**2026-08-25 진행 결과**

이 컴퓨터에는 `adb`·`JAVA_HOME`(jdk-21)이 있고 디스크 여유도 충분해 handoff가 말한 "다음 컴퓨터"에 해당한다.
기준선은 전부 통과했다:

| 게이트 | 결과 |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run i18n:verify` | exit 0, "이관 잔여 0건" |
| `npm test` | **1,957 / 1,957 (fail 0)** — handoff가 환경 사유로 본 `androidMergedManifestSecurity`도 통과 |
| `npm run build` | exit 0. JS 350,433/500,000 · CSS 44,996/48,000 · precache 471 중복 0 |
| `npx cap sync android` + `gradlew assembleDebug` | BUILD SUCCESSFUL, APK 15.09MB |
| A17 보존 설치 | `npm run android:install:debug -- RFKL40DP73J` → Success |

**온보딩 화면 locale 검증 통과**(A17 실기기, `scripts/verify-locale-screens-cdp.mjs`):
en·ja 전환 시 **원시 message id 0건**, `documentLang`·저장 locale 정확히 추종,
title이 ko=`혜니캘린더` / en·ja=`Hyeni Calendar`, 가로 overflow 0. 한국어 잔존은 언어 선택기의 `한국어`
자국어 명칭 1건(의도된 것). 검증 후 **ko로 복원 확인**.

✅ **부모 화면 검증 통과** — TK 로그인 뒤 en·ja·vi 로 전환해 `#/parent/home`·`#/account`·`#/subscription`·
`#/parent/settings`·`#/daily-report`·`#/parent/memo`·`#/parent/calendar`·`#/child-detail`·`#/notification-settings`·
`#/location-status` 를 돌았고 **원시 message id 0건 · 가로 overflow 0**, 검증 후 ko 복원까지 확인했다.

★ **실기기가 잡은 결함 1건**: `#/parent/home` 이 en·ja 에서 `billing.subscription.plan.annual` 을 **원시 id 로 표시**했다.
구독 카드 설명이 `entitlement.planLabelId`(billing namespace)를 번역하는데 부모 홈 라우트가 `billing` 을 선언하지 않았다.
→ `PARENT_HOME_NAMESPACES = ["core","parent","billing","shared"]` 신설, 회귀=`tests/parentHomeBillingNamespace.test.mjs`.
정적 배선 검사(`tests/i18nUiWiring.test.mjs`)는 transform 을 거쳐 흐르는 이 의존을 볼 수 없어 놓쳤다 — **실기기 검증의 값어치가 이것이다.**

⛔ **아이 화면은 아직 막혀 있다 — razr·S25 미연결.**
(과거 A17 세션 유실 기록은 아래에 남긴다. 같은 증상이 재발하면 절차가 같다.)
- WebView `hyeni-api-session-v1`이 없고 화면이 `#/onboarding`이다. 다른 localStorage 키는 살아 있어
  **설치가 지운 것이 아니라 이전부터 유실 상태**였다.
- AGENTS.md 세션 복구 절차대로 네이티브 push context를 읽었다: `role=parent`와 userId·familyId는 남았지만
  **`hasAccessToken:false`·`hasRefreshToken:false`** → `/auth/refresh` 복구 경로가 없다.
- 따라서 **TK가 직접 로그인해야 한다**(비밀번호는 사용자만 입력, 역할 전환·재페어링 금지).
  `account_device_sessions`(2026-08-20 이후 한 계정=한 활성 설치) 때문에 다른 기기에서 새로 로그인하며
  밀렸을 가능성이 있다.
- razr(`ZY22H9VTQD`)·S25(`R5CY521CFNZ`)는 **미연결**이라 아이 화면 검증도 대기 중이다.

로그인·연결이 되면 확인할 항목은 아래와 같다. 언어를 en/ja 등으로 바꾼 뒤 **원시 message id가 보이지 않는지**,
특히 **콜드 스타트로 해당 화면에 바로 들어가** 확인한다.
⚠️ **hash만 바꿔 도는 스윕으로는 잡히지 않는다** — 앞 화면이 이미 그 namespace를 로드해 둔 상태라 누락이 드러나지 않는다.
화면마다 앱을 새로 띄워 해당 라우트로 직접 진입해야 한다.

- 아이 하단 독 3탭·SOS 라벨(`core.childDock.*`)
- 아이 위치/홈의 위치 권한 다이얼로그(`shared.locationPermission.*`, `copyMode="child"`)
- 온보딩의 같은 다이얼로그(`copyMode="formal"`)
- 부모 홈 구독 카드 4줄(`parent.home.subscriptionCard.*`)과 **종료일 날짜 형식**
- 부모 상세 화면 위 플로팅 AI 친구(PushShell 라우트에 `child` namespace가 없어 `core`로 옮긴 부분)
- 아이 스티커 상세·대화 날짜 구분선·기기명(삼성 접두어)·소셜 로그인 제공자 이름

한국어에서 **기존 문구가 바뀌지 않았는지**도 함께 본다(이관 시 화면 쪽 한국어를 정본으로 유지했다).
특히 구독 카드 종료일이 `2026년 10월 1일까지 이용` 형태를 유지하는지.

PWA는 설치 이름·설명이 언어를 따르는지 확인한다(`public/manifests/manifest.<locale>.webmanifest`).
⚠️ **네이티브는 Service Worker를 등록하지 않으므로 manifest 전환은 웹/PWA에서 확인한다.**

기준선:

```powershell
npm run typecheck
npm run i18n:verify   # "이관 잔여 0건" 기대 (2026-08-25 exit 0 확인)
npm test              # 1,957개 중 1,956 통과가 정상
npm run build
```

⚠️ `npm test`의 `tests/androidMergedManifestSecurity.test.mjs` 실패는 **JAVA_HOME 미설정 환경 사유**다.
Android SDK·JDK가 있는 컴퓨터에서는 통과해야 하고, 통과하지 않으면 그건 진짜 결함이다.
⚠️ `npm test`는 실패가 있어도 exit 0일 수 있으므로 `ℹ fail N` 요약 줄로 판정한다.

## 2단계 — Pages 배포 ✅ 완료 (2026-08-25)

`worker/.env`의 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`를 **저장소 밖 임시 디렉터리**에서 주입해 실행했다
(저장소 안에서는 루트 `.env`의 D1 전용 토큰이 자동 로드돼 실패한다). 값은 출력하지 않았고 끝난 뒤 env·임시 디렉터리를 정리했다.

```powershell
# 저장소 밖 디렉터리에서
node <repo>/node_modules/wrangler/bin/wrangler.js pages deploy <repo>/dist `
  --project-name=hyeni-calendar --branch=main --commit-dirty=true
```

결과: Uploaded 223 files (365 already uploaded), `_headers`·`_redirects` 업로드,
deployment = `https://46dcefa1.hyeni-calendar.pages.dev`. **Worker 변경이 없어 Worker 배포는 하지 않았다.**

**PWA manifest 검증 통과**: 10 locale × 2 origin(`hyeni-calendar.pages.dev`, `hyenicalendar.com`) 전부
HTTP 200 / `application/manifest+json`, `lang` 정확, `name`·`short_name`이 브랜드 규칙과 일치
(ko만 `혜니캘린더`, 나머지 `Hyeni Calendar`), `description`도 locale별 번역, icons 3개.
런타임 교체는 `src/i18n/documentMetadata.ts`의 `applyDocumentLocale`이 `#hyeni-manifest`·title·description·
`html lang/dir`를 함께 갱신한다.

ℹ️ **`<base href="/">` 관련 사실 정정**: `vite.config.ts`는 `base: "./"`이고 배포된 index.html에 `<base>`가 없다.
AGENTS.md는 "루트 asset URL과 `<base href="/">`를 유지"라고 적었지만, 실제 방어는 `scripts/write-oauth-callback-entry.mjs`가
`/oauth/callback` 엔트리의 asset을 **모두 루트 절대 경로로 재작성**하는 방식이다. 실측으로 `/oauth/callback` 200이고
참조가 `/manifests/…`·`/apple-touch-icon.png`·`/assets/mascot/wave.webp` 등 절대 경로이며 전부 200,
`/oauth/callback.html`은 308→`/oauth/callback`이다. 즉 목적(중첩 경로 자원 오해석 방지)은 달성돼 있고
**문서 문구와 구현 수단만 다르다** — 회귀가 아니다.

### 2026-08-26 재배포 — 브랜드 현지화 커밋 + 부모 홈 히어로 캐러셀

⚠️ **자격이 바뀌었다.** `worker/.env`의 `CLOUDFLARE_API_TOKEN`이 만료돼 `npm run deploy:worker`가
`Authentication error 10000`이다. 반면 OAuth 자격(`C:UsersTK.wranglerconfigdefault.toml`,
tkisdroid@gmail.com)은 살아 있고 `workers (write)`·`pages (write)`를 모두 갖는다. wrangler 4는 `.env`를 자동
로드해 OAuth를 덮어쓰므로 **빈 파일을 `--env-file`로 넘겨** 그 자동 로드를 대체했다. 토큰 값은 출력·복사하지
않았고, 만료 토큰 교체는 TK 몫이다.

```bash
# Worker (저장소 안에서도 가능 — .env 자동 로드만 끈다)
cd worker && npx wrangler deploy --env-file <빈 파일>
# Pages (기존대로 저장소 밖 디렉터리)
npx wrangler pages deploy <repo>/dist --project-name=hyeni-calendar --branch=main --commit-dirty=true
```

- Worker version `e7d3f97d-0465-4fac-9f6f-5adb0dc09391`. `/api/health` 200 `{"ok":true,"status":"ready"}`,
  신규 `GET /api/family/hero-carousel`·`GET|PUT /api/admin/hero-carousel` 무인증 401,
  관리자 응답 `Cache-Control: no-store`. **D1 migration 없음**(`app_global_settings`는 health 게이트가 이미 요구하는
  기존 테이블이고 컬럼 추가도 없다).
- Pages 배포 `https://f92088d0.hyeni-calendar.pages.dev`. 배포별 주소·고정 `hyeni-calendar.pages.dev`·브랜드
  `hyenicalendar.com` 세 곳 모두 entry `assets/index-CddDoYPh.js` 351,286 bytes · SHA-256
  `5294B5584FF75243665F599A740711958F6BE905AF0E24F3575F55B2CB0E65AF`, CSS `assets/index-DMuUhfUk.css` SHA-256
  `177583E46CE74CDA70B47B5F3139D3D674ABD5923F433B0E610A5279A41CE6F4`, Service Worker SHA-256
  `E52B64C834F7917529EBEF4253C5F0F6733E0858631E7592F9AAA6EF92D27AAF`가 로컬 `dist`와 일치하고 `/oauth/callback`도
  세 곳 모두 200이다.
- ⚠️ **검증 함정**: `dist/assets/index-*.js`는 여러 개라 glob `head -1`이 413바이트짜리 다른 청크를 집는다.
  진입 청크는 반드시 `dist/index.html`이 참조하는 파일명으로 골라 대조한다.

## 3단계 — Android·Worker 알림 현지화 (Android 앱 이름·전체화면 문구는 2026-08-25 완료)

정본 계획: `docs/superpowers/plans/2026-08-15-global-native-notifications.md`

**여기가 SOS 배포 차단선을 푸는 단계다.** 현재 부모 SOS 알림 문구는 **발신 아이 기기가 만들어 보낸다** —
`src/lib/api/endpoints/sos.ts`의 `SOS_TITLE = "🆘 도와줘요!"`와
`` const message = `${childName || "아이"}님이 SOS를 보냈어요` ``가 그대로 `POST /api/parent-alerts` body에 실린다.
아이가 언어를 바꾸면 **부모는 아이 언어(또는 한국어 고정) 알림을 받는다.**
그래서 수신자 endpoint locale 기반 Worker 구조화 알림과 **원자적으로 배포**해야 한다.

1. ~~`locales/*/android.json` 채우기~~ ✅ **완료** — 10 id × 10 locale.
2. ~~Android `values-*` 리소스 + `localeConfig`~~ ✅ **완료** — `npm run i18n:android` 가
   `scripts/i18n/generate-android-locales.mjs` 로 `values-<수식자>/strings.xml` 9개와 `res/xml/locales_config.xml` 을 만들고,
   `npm run i18n:verify` 가 `--check` 로 신선도를 본다. `AndroidManifest` 에 `android:localeConfig` 를 연결했다.
   현지화 리소스 10종 = `app_name`·`title_activity_main`·`push_alert_default_title`·
   `force_ring_{title,message_label,acknowledge,footer,countdown}`·`push_alert_{close,open_app}`.
   ⚠️ **리소스 수식자는 BCP-47 이 아니다** — 지역은 `zh-rCN`·`zh-rTW`, **Indonesian 은 legacy `in`**
   (`values-id` 로 두면 기기 언어가 인도네시아어일 때 매칭되지 않을 수 있다). `locales_config.xml` 은 반대로 BCP-47(`id`)이다.
   기본 `values/` 는 한국어를 유지하고 `values-ko` 는 만들지 않는다 — 대신 `verifySourceStringsXml()` 이
   `values/strings.xml` 과 ko 카탈로그의 일치를 강제해 정본이 둘로 갈리는 것을 막는다.
   lint `MissingTranslation` 은 blanket suppress 없이 해결했다: `package_name`·`custom_url_scheme` 은 기술 값이라
   `translatable="false"`, 나머지는 실제 사용자 문구라 번역했다. `%1$d` 서식 인자는 10 locale 동일해야 한다.
   회귀=`tests/androidLocaleResources.test.mjs`.
   ℹ️ Android 13+ 는 `localeConfig` 덕분에 **OS 설정 > 앱 > 언어**로 앱 언어를 바꿀 수 있다.
3. **`AppLocale` Capacitor 플러그인 구현** — **2026-08-25 A17 실기기로 확정**: 네이티브 브리지의
   `PluginHeaders` 20개에 `AppLocale`이 없고 `Capacitor.isPluginAvailable("AppLocale")`가 `false`다.
   `MainActivity`의 `registerPlugin` 14개에도 없고 android 소스에 문자열 0건이다.
   따라서 `src/app/NativeBootstrap.tsx`의 `getNativePlugin("AppLocale")`이 항상 `null`이고
   `syncNativeAppLocale()`은 **실제로 조용한 no-op**이다 — 웹에서 언어를 바꿔도 네이티브 알림 언어는 바뀌지 않는다.
   ⚠️ `Capacitor.Plugins`에 `AppLocale` 이름이 보이는 것은 **웹 프록시일 뿐 네이티브 구현의 증거가 아니다**
   (판정은 `PluginHeaders`/`isPluginAvailable`로 한다). 웹 배선과 테스트는 이미 있으므로 네이티브만 비어 있다.
4. Java 하드코딩 한국어 이관 — `LocationService`(43줄), `NotificationHelper`(25), `RemoteListenActivity`(24),
   `MyFirebaseMessagingService`(11), `ForceRingActivity`(9) 등. FGS 지속 알림·채널명·주변소리/강제 벨 전체화면 문구.
5. **알림 locale은 사용자 행이 아니라 endpoint 행(`fcm_tokens`/`push_subscriptions`)에 저장**하고 기존 행은 `ko` backfill.
   신규 알림은 allowlist된 `messageKey`/`messageVersion`/`messageArgs` 구조화 + 레거시 ko `title/body` 호환.
   `messageArgs`에 token·좌표·세션·메모/AI 원문을 넣지 않는다.
6. Worker 사용자 노출 문자열 이관 — 알림 제목/본문(`push-notify.ts`, `locationStaleness.js`, `unregisteredStay.js`,
   `registeredPlaceGeofence.js`·`dangerZoneGeofence.js` 등), AI 아이 대화 계열(`aiChildContext.js`,
   `aiToolResultReply.js`, `aiMemoryPolicy.js` … 조사 처리 로직 포함 — 난도 최상),
   `webAiCreditBilling.js`의 `toLocaleString("ko-KR")` + `원` 하드코딩(통화 현지화).

기존 안전 계약은 그대로 유지한다: `NotificationTargetPolicy` 3필드(`familyId`/`targetUserId`/`targetRole`),
`acknowledged_at` 교차 확인, quiet hours 예외(SOS·emergency·미도착·위험구역), `memoDisplayPermit`, 주변소리 60초 상한.

게이트 (⚠️ `generate-android-locales.mjs`와 아래 Worker 테스트 3종은 **아직 없는 산출물**이다 — 이 단계에서 만든다):

```powershell
npm run i18n:android -- --check
node --test worker/tests/notificationEndpointLocale.test.mjs worker/tests/notificationMessageCatalog.test.mjs worker/tests/localizedNotificationDelivery.test.mjs
npm run typecheck:worker
npm run test:worker
Push-Location android; .\gradlew.bat test lint assembleDebug; Pop-Location
```

## 4단계 — 국가·시간대·지도·해외 로그인

정본 계획: `docs/superpowers/plans/2026-08-15-global-timezone-maps-auth.md`

- 사용자 행에 `country_code` + IANA `time_zone` 추가. **기존 사용자는 migration 후 정확히 `KR`/`Asia/Seoul` 유지.**
  **locale·IP·전화번호로 시간대를 추정하지 않는다**(신규는 사용자가 명시 선택).
- 초기 QA 국가 = `KR JP TW HK SG VN TH ID MY PH` (**중국 본토 `CN` 제외**).
- 지도 = `KR→Kakao`, 승인된 비중국 국가 `Google Maps`, `CN/ZZ→미지원`. 런타임 오류로 다른 provider·다른
  장소 ID로 자동 전환하지 않는다. 웹은 origin 제한 키, Android는 package+SHA-1 제한 키, Worker는 지도 전용
  서비스 계정 OAuth를 분리한다. 정본=`docs/superpowers/specs/2026-08-26-global-google-maps-location-design.md`.
- 비한국 국가는 지도만으로 활성화하지 않는다. 가족 현지 오전 8시 위치 이력, retention·quota, 일정/도착 cron,
  quiet hours와 DST matrix가 모두 통과할 때까지 allowlist를 닫는다.
- 로그인 = **Google은 전 지역**, 전화 OTP·Kakao·Naver는 **`KR`만**. 아이 페어링 동선은 동일.
- 보존 불변식: UTC timestamp, 0-index 비패딩 `date_key`, quiet hours `[start,end)`, 위치 티어, 10분 dedupe.

## 5단계 — Paddle 글로벌 결제 (sandbox까지)

정본 계획: `docs/superpowers/plans/2026-08-15-global-paddle-billing.md`

- **Android 신규 결제 = Google Play / PWA 신규 결제·AI 크레딧 = Paddle.** Toss는 cutover 후 신규 checkout 금지, 기존만 갱신/취소/환불.
- provider는 `google_play|paddle|toss_web` 중 정확히 하나. 충돌은 자동 강등·환불 없이 `conflict`/`manual_review`로 닫는다.
- **7일 체험은 제공자 1곳만.** 가격은 Paddle `PricePreview`/checkout이 돌려준 formatted 값만 표시 —
  환율 계산·가격 ID 이름 해석·자체 반올림 금지.
- **Google Play 정책상 Android 앱 안에 Paddle/Toss CTA·URL·QR·가격표를 두지 않는다.**
- Paddle 심사 리스크: 아동 감시/spyware 오인 방지를 위해 아이 알림·화면 표시·1분 상한·감사 로그를 심사 자료에 그대로 제출한다.
- 이 단계 권한은 sandbox/preview까지다. **Paddle live 전환은 계획 실행 권한 밖.**

## 6단계 — 번역 검수·법적 페이지·스토어 묶음

정본 계획: `docs/superpowers/plans/2026-08-15-global-content-store-release.md`

**2026-08-25 완료분 — Play listing pack 기반**

- 정본 `store/global/source/ko-KR.json` — `docs/store/play-listing.md` v1.4.2 문안을 섹션·claim id 로 구조화했다.
- `npm run store:listing` (`scripts/store/build-global-listing.mjs`) 이 `store/global/locales/<listingLocale>/listing.json` 10개를 만든다.
  `npm run store:listing:check` 는 최신 여부와 제한 위반을 본다.
- 게이트: Play 필드 제한(앱 이름 30 · 짧은 설명 80 · 전체 설명 4000), 금지 표현 5종(가격·할인·순위·설치 CTA·절대 안전),
  **evidence 없는 `reviewStatus` 승격 차단**. 회귀=`tests/globalStoreListing.test.mjs`.
- **앱 이름은 `android.appName` 을 재사용한다** — 런처 이름과 스토어 이름이 갈리지 않는다.
- 짧은 설명은 10 locale 완역했다(80자 제한 때문에 5건을 축약).
- ⚠️ **전체 설명은 ko 만 source 이고 9개 locale 은 `translationStatus: "pending"` + 값 `null` 이다.**
  미번역을 한국어로 채우지 않는다 — 그러면 "번역됨"으로 보여 검수 없이 공개될 수 있다.
  생성기가 **blocker 9건으로 보고**하며, 이것이 남은 작업이다.

**남은 것**

- **`locales/review-status.json` 90/90 `draft` → 검수 승격.** 지금은 validator가 `draft` 이외를 오류로 거부하므로
  승격하려면 `scripts/i18n/validate-catalogs.mjs`와 `tests/localeHighRiskContract.test.mjs`를 함께 고쳐야 한다.
  - Tier A(안전·결제·법적) = 원어민 + 법률/도메인 검수 evidence 없이는 `approved` 불가
  - Tier B(핵심 UI·Store) = 원어민 review 필요 / Tier C(AI·보조) = 문맥 포함 draft + 원어민 표본
  - **번역 생성자가 `reviewed`/`approved`로 자동 승격 금지.** 저장하는 것은 역할·날짜·source hash·evidence reference뿐
    (reviewer 이름·연락처 저장 금지).
- **Worker 법적 페이지 다국어화** — `worker/routes/legal.ts`의 `/terms`·`/privacy`·`/data-deletion`이 한국어 단일이다.
  해외 스토어 심사 직결. locale별 source에서 escape-safe Worker data module을 생성하고
  query/cookie/Accept-Language 협상을 지원한다.
- **법정 사업자명·주소·전화·지원 연락처, 일본 특정상거래법 표기, 국가별 법률 판단을 추측하지 않는다.**
  누락은 release blocker로 노출하고 빈 값으로 공개하지 않는다.
- Play listing locale 10개 = `ko-KR en-US ja-JP zh-CN zh-TW vi th id ms-MY fil`.
  브랜드 = 한국어 `혜니캘린더` / 그 외 `Hyeni Calendar`, package id 불변, 보호어 `Premium` exact.
- 스크린샷은 **synthetic family + mock network**로 `output/store-global-v1/`에만 생성한다.
  **실기기 A17/razr/S25 화면·production API·실사용자 알림 캡처 금지.** 기존 `output/store-ui-candidates-v1/`·
  `store-safe-assets-v1/`은 byte-for-byte 건드리지 않는다.
- 개인정보·위치·마이크·AI·UGC·아동 안전 선언을 실제 구현보다 축소하지 않는다.
- 미국 진출 시 **COPPA + 주별 개인정보 규정 법무 검토**. ⚠️ **GDPR/EU는 저장소 계획에 아예 없다** — EU를 넣으려면 계획부터 추가해야 한다.

## 7단계 — 통합 회귀와 출시 차단선 판정

- 전체 회귀: `npm run typecheck` / `npm run i18n:verify` / `npm test` / `npm run build` /
  `npm run typecheck:worker` / `npm run test:worker` / `gradlew test lint assembleDebug`.
  **테스트 수는 실행 결과에서만 기록**하고 과거 수치를 복사하지 않는다.
- 10개 locale × 5 viewport × font-scale 1·2 브라우저 행렬 → 콘솔 오류·가로 overflow·잘린 CTA·빈 accessible name 0건.
  ⚠️ QA 하니스는 **Chrome에 `--lang=ko-KR`과 `--accept-lang=ko-KR,ko`를 함께** 줘야 한다(앱은 `navigator.languages`를 읽는다).
  `localStorage`로 locale을 주입하지 않는다. Linux CI(en-US)에서 문구 12건 + PWA 앱 이름 1건이 실제로 red였다.
- CI 주의: `scripts/i18n/audit-task8-locales.mjs`가 `git show 4fc8b55:locales/ko/*.json`을 baseline으로 읽으므로
  `release-candidate.yml` 두 checkout에 `fetch-depth: 0`이 필요하다(`tests/releaseCiContract.test.mjs`가 강제).
- 미착수 HOLD 항목: **하위 계획 Task 10 locale/viewport·font-scale mock QA 하니스**.

### 외부 승인이 없으면 `GO`로 쓸 수 없는 것

- Paddle seller/category/domain live 승인과 price allowlist
- Google Maps web/Android 키·Worker 서비스 계정 제한 설정, API별 quota cap과 비용 예산
- A/B 등급 번역 원어민 검수, A 등급 법률 검수
- 사업자 법정 이름·주소·전화번호·지원 이메일, 일본 특정상거래법 검증
- Play Console 국가·상품·listing 운영자 확인
- 최신 clean commit 기반 **사용자가 직접 서명한** AAB (에이전트가 자격 파일을 읽어 자동 서명하지 않는다)

---

## 검증 도구

- `scripts/verify-locale-screens-cdp.mjs`(2026-08-25 추가) — 실기기 CDP로 언어를 **앱 UI 선택기로만** 바꾸고
  화면 텍스트에서 원시 message id를 찾는다. 판정 기준은 `locales/ko/*.json`의 실제 키 집합이라
  임의의 점 표기 문자열을 오탐하지 않는다. 끝나면 **원래 언어로 복원**하며 복원 실패도 exit 1로 알린다.
  세션·토큰은 읽지 않는다.

  ```powershell
  adb -s <serial> shell "am start -n com.hyeni.calendar/.MainActivity"
  adb -s <serial> shell "cat /proc/net/unix" | Select-String webview_devtools   # 소켓 이름 확인
  adb -s <serial> forward tcp:9222 localabstract:webview_devtools_remote_<pid>
  $env:LOCALES="en,ja"; $env:ROUTES="#/onboarding"; node scripts/verify-locale-screens-cdp.mjs
  ```

- `scripts/final-a17-cdp-smoke.mjs`는 기대 문구가 한국어로 하드코딩돼 있어 **locale 검증에는 쓸 수 없다**(ko 전용).
- `npm run i18n:verify` — 카탈로그·PWA manifest·**Android locale 리소스**·사용자 노출 literal·클라이언트 오류 표면을 한 번에 본다.
- `npm run i18n:android` / `npm run store:listing` — 생성물을 다시 만든다. 둘 다 `--check` 를 지원한다.
- 네이티브 플러그인 존재 판정은 `Capacitor.PluginHeaders` / `Capacitor.isPluginAvailable(name)`으로 한다.
  `Object.keys(Capacitor.Plugins)`는 웹 프록시까지 포함하므로 근거가 되지 않는다.

## 배포 차단선 요약

1. **알림 현지화 없이 다국어를 네이티브에 내보내지 않는다** — 부모 SOS 알림 문구를 발신 아이 기기가 만들기 때문에
   (`src/lib/api/endpoints/sos.ts`), 3단계(수신자 endpoint locale 알림)와 **원자적으로** 배포해야 한다.
2. 운영 D1 migration은 항상 **Worker 배포보다 먼저**, 정확히 1회.
3. 웹 배포는 저장소 루트 `.env`의 `CLOUDFLARE_API_TOKEN`(Pages 권한 없음)이 wrangler OAuth를 덮으므로
   **`.env`가 없는 디렉터리에서** 실행한다.
4. Play 업로드·게시와 Paddle live 전환은 운영자가 별도로 수행한다.

## 남은 잔여 부채 (단계와 별도로 추적)

- **한국어 키워드 매칭 표** — `transform/eventCompanionPrompt.ts`(152)·`childBelongings.ts`(59)·`aiBuddyEmotion.ts`·
  `stickerBook.ts`·`placeVisual.ts`. 번역이 아니라 **locale별 어휘 데이터 설계**가 필요하다(0단계 결정 대상).
- `src/lib/api/endpoints/family.ts`의 기본 이름 `"아이"`·`"부모"`는 표시가 아니라 **저장값**이 된다.
- literal scanner allowlist `exempt` 6건(사용자가 정한 AI 친구 이름·캐릭터 고유명·언어 선택기 고정 `Language` 라벨·
  페어링 코드 형식 `KID-XXXXXXXX`). 의도된 예외이며 근거가 파일에 기록돼 있다.
- 번역 품질은 정적 감사(`audit-task8-locales.mjs`)까지만이다. **실제 지역 화자 검수는 미수행.**
- literal scanner는 완전한 interprocedural/type-aware 분석기가 아니다(hook을 거쳐 흐르는 값은 taint 추적 밖 —
  `eventCompanionAsk` 꼬리말이 그 실례다).
