# 혜니캘린더 글로벌 버전 설계

- 작성일: 2026-08-15
- 상태: 사용자 승인 완료, 구현 전 설계 정본
- 대상: PWA 단일 코드베이스와 Capacitor Android 앱, Cloudflare Worker, Google Play 제출 자료
- 관련 정본: `AGENTS.md`, `CLAUDE.md`, `docs/market-expansion-plan.md`

## 목표

혜니캘린더를 하나의 앱과 하나의 백엔드로 운영하면서 다음을 달성한다.

1. 한국어, 영어, 일본어, 중국어 간체, 중국어 번체, 베트남어, 태국어, 인도네시아어, 말레이어, 필리핀어를 지원한다.
2. 최초 실행은 기기 언어를 따르고 이후 사용자가 기기별로 언어를 바꿀 수 있게 한다.
3. 부모와 아이가 같은 가족에 속해 있어도 각자 기기에서 서로 다른 언어를 사용할 수 있게 한다.
4. React 화면뿐 아니라 Android 네이티브 문구, Worker 알림, AI 응답, PWA 메타데이터, 법적 페이지와 Google Play 제출 자료까지 현지화한다.
5. Android는 Google Play Billing, iPhone·웹 PWA는 Paddle을 사용해 해외 결제를 제공한다.
6. 기존 Google Play·Toss 구독과 실사용 가족 데이터, 세션, 페어링, 위치·안전 계약을 훼손하지 않는다.
7. 한국 외 지역에서 시간대, 지도, 주소, 알림이 한국 기준으로 잘못 동작하지 않게 한다.

## 비목표와 출시 경계

- 네이티브 iOS 앱이나 App Store 결제를 새로 만들지 않는다. iPhone 정본은 계속 홈 화면 PWA다.
- v1.3.0 프로덕션에서 차단된 선생님 모드를 출시하지 않는다. 숨겨진 화면도 번역 누락 검사는 하되 기능 게이트는 유지한다.
- 중국 본토를 1차 공식 지원 지역이라고 홍보하지 않는다. 중국어 간체는 싱가포르·말레이시아와 중국어 사용자 지원을 포함하지만, 중국 본토는 FCM·로그인·지도·결제 공급자를 별도로 실증한 뒤 판단한다.
- 사용자가 입력한 이름, 가족 메모, 장소명, 주소 원문을 자동 번역하지 않는다.
- AI 번역 초안을 법률 검토나 원어민 검수 완료로 간주하지 않는다.
- 프로덕션 D1 파괴적 삭제, 실제 스토어 게시, 운영 시크릿 변경, 실제 결제를 자동 수행하지 않는다.
- S25에는 설치·실행·로그·세션 조회를 포함한 어떤 adb 접근도 하지 않는다.

## 확정한 핵심 결정

| 영역 | 확정안 |
|---|---|
| 국제화 엔진 | FormatJS/React Intl + ICU 메시지 |
| 원문 정본 | 한국어 |
| 런타임 폴백 | 선택 언어 → 영어 → 한국어 |
| 언어 저장 | 계정이 아닌 설치 기기별 저장 |
| 비한국어 브랜드 | `Hyeni Calendar` |
| Android 결제 | Google Play Billing 유지 |
| PWA 신규 결제 | Paddle, 공급자 승인과 도메인 심사 완료를 전제로 함 |
| 기존 웹 결제 | Toss 기존 구독의 갱신·해지·환불 보존, 신규 판매는 Paddle 전환 뒤 중단 |
| 한국 지도 | Kakao 유지 |
| 해외 지도 | Mapbox |
| 기존 가족 시간대·국가 | `Asia/Seoul`, `KR` 유지 |
| 신규 가족 시간대 | 생성 부모 기기의 검증된 IANA 시간대 |
| 공식 1차 QA 국가 | 한국, 일본, 대만, 홍콩, 싱가포르, 베트남, 태국, 인도네시아, 말레이시아, 필리핀 |

## 언어 매트릭스

| 앱 코드 | 언어 선택 표시 | Google Play 코드 | Mapbox 코드 | 브랜드 |
|---|---|---|---|---|
| `ko` | 한국어 | `ko-KR` | `ko` | 혜니캘린더 |
| `en` | English | `en-US` | `en` | Hyeni Calendar |
| `ja` | 日本語 | `ja-JP` | `ja` | Hyeni Calendar |
| `zh-CN` | 简体中文 | `zh-CN` | `zh-Hans` | Hyeni Calendar |
| `zh-TW` | 繁體中文 | `zh-TW` | `zh-Hant` | Hyeni Calendar |
| `vi` | Tiếng Việt | `vi` | `vi` | Hyeni Calendar |
| `th` | ไทย | `th` | `th` | Hyeni Calendar |
| `id` | Bahasa Indonesia | `id` | `id` | Hyeni Calendar |
| `ms` | Bahasa Melayu | `ms-MY` | `ms` | Hyeni Calendar |
| `fil` | Filipino | `fil` | `tl` | Hyeni Calendar |

앱 코드는 BCP 47에 맞춰 고정한다. 외부 공급자 코드가 다를 때만 경계 어댑터에서 변환한다. 저장된 앱 코드나 API 계약에 Mapbox·Play 전용 코드를 흘리지 않는다.

## 현재 구조에서 해결할 문제

- `src/i18n/messages.ts`는 일부 리포트 문구만 가지고 있고 실제 조회가 한국어만 반환한다.
- React 화면 대부분과 Android Java, Worker 알림·AI·법적 페이지에 사용자 노출 한국어가 직접 작성돼 있다.
- 여러 날짜·숫자 포맷이 `ko-KR`로 고정돼 있다.
- Android 리소스는 기본 `values/strings.xml`만 있고 언어별 리소스가 없다.
- PWA의 `<html lang>`, 앱 이름, 설명과 manifest가 한국어로 고정돼 있다.
- 푸시 토큰과 웹 푸시 구독에는 기기별 언어가 없어 같은 사용자에게 기기별 언어 알림을 보낼 수 없다.
- 지도 표시·검색·역지오코딩·외부 링크가 Kakao에 직접 결합돼 있다.
- 전화 가입과 OTP는 `+82`와 NCP SENS에 맞춰진 한국 전용 경로다.
- PWA 결제는 Toss·KRW에 강하게 결합돼 있으며 결제 공급자 CHECK 제약도 Google Play와 Toss만 허용한다.
- 법적 페이지는 한국어 배열을 Worker 코드에 직접 포함한다.

## 국제화 카탈로그 구조

사용자 노출 콘텐츠는 저장소 루트의 공용 `locales/` 트리에서 관리한다. React, Worker, Android 생성기와 스토어 자료가 같은 언어 매니페스트와 용어집을 참조한다.

```text
locales/
  manifest.json
  glossary.json
  descriptions.json
  review-status.json
  ko/
    core.json
    onboarding.json
    parent.json
    child.json
    shared.json
    billing.json
    reports.json
    notifications.json
    android.json
    legal/
      privacy.md
      terms.md
      data-deletion.md
    store/
      listing.json
      products.json
      release-notes.json
  en/
  ja/
  zh-CN/
  zh-TW/
  vi/
  th/
  id/
  ms/
  fil/
```

### 메시지 ID와 타입

- `parent.home.safety.location.attention`처럼 의미가 안정적인 ID를 사용한다.
- 한국어 문장 자체나 화면 파일 경로를 ID로 사용하지 않는다.
- `descriptions.json`에는 화면, 부모/아이 역할, 변수 의미, 글자 제한과 어조를 기록한다.
- 생성 스크립트가 전체 ID와 변수 서명을 비교하고 TypeScript `MessageId` 타입을 만든다.
- ICU 변수와 plural/select 분기는 FormatJS 컴파일 단계에서 검증한다.
- 번역문에 임의 HTML을 허용하지 않는다. 강조·링크가 필요하면 허용된 React 구성요소 슬롯만 사용한다.
- 오류 코드는 번역하지 않고 안정적인 기계 코드로 유지하며 화면 경계에서 메시지 ID로 바꾼다.

### 카탈로그 로딩

- 온보딩, 오류 경계와 앱 셸에 필요한 `core` 카탈로그만 초기 로딩한다.
- 부모, 아이, 결제, 리포트처럼 큰 묶음은 해당 route가 열릴 때 동적 import한다.
- 선택 언어 카탈로그를 불러오는 동안 한국어 화면을 먼저 그리지 않고 로고 중심의 중립 splash를 유지한다.
- 선택 언어 묶음이 실패하면 영어 묶음을 불러오고, 영어도 실패할 때만 한국어를 사용한다.
- route 청크와 locale 청크는 `scripts/verify-route-bundle.mjs` 및 PWA precache 중복 검사를 계속 통과해야 한다.

### Provider 위치

국제화 Provider는 인증 전 온보딩과 오류 화면에도 적용돼야 하므로 `AuthProvider`와 route gate보다 바깥에 둔다. Query, 인증, 활성 아이 상태는 locale 객체를 정본으로 삼지 않는다. 언어 전환은 세션·가족·활성 아이를 초기화하지 않는다.

## 언어 감지와 기기별 저장

### PWA와 일반 웹

1. 유효한 `hyeni-locale-v1` 저장값
2. `navigator.languages`의 첫 지원 언어
3. 영어

### Android

1. Android 앱별 언어 설정의 명시값
2. 기존 WebView 저장값 이관
3. Android 시스템 언어
4. 영어

앱 내 언어 선택은 WebView 저장소와 Android 앱별 locale API를 함께 갱신한다. Android 시스템 설정에서 앱 언어가 바뀌면 시작과 foreground 복귀 때 다시 읽는다. Android Activity 재생성이 필요해도 API 세션·설치 ID·페어링 데이터는 삭제하지 않는다.

### 정규화 규칙

- `zh-Hans`, `zh-CN`, `zh-SG`는 `zh-CN`으로 정규화한다.
- `zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO`는 `zh-TW`로 정규화한다.
- bare `zh`는 script/region 단서를 먼저 보고 없으면 `zh-CN`으로 정규화한다.
- Android 레거시 `in`은 `id`, `tl`은 `fil`로 정규화한다.
- `en-*`, `ja-*`, `vi-*`, `th-*`, `id-*`, `ms-*`, `fil-*`은 각각 지원 기본 코드로 접는다.
- 지원하지 않는 언어는 영어로 폴백한다.

`document.documentElement.lang`은 선택 언어와 함께 갱신한다. 현재 10개 언어는 모두 LTR이지만 `dir` 결정은 locale 유틸에 두어 미래 확장을 막지 않는다.

### 언어 선택 UI

- 공개 온보딩과 부모·아이 설정에 동일한 언어 선택기를 제공한다.
- 언어 이름은 각 언어의 자칭 명칭으로 표시한다.
- 전환은 가능한 화면에서 즉시 반영하고 불필요한 전체 로그아웃이나 계정 갱신을 일으키지 않는다.
- 언어는 계정 프로필에 저장하지 않는다. 같은 계정의 여러 기기가 서로 다른 언어를 유지할 수 있어야 한다.

## 날짜·숫자·통화 포맷

- 날짜는 `Intl.DateTimeFormat`, 숫자는 `Intl.NumberFormat`, 상대 시간은 `Intl.RelativeTimeFormat`을 사용한다.
- 코드에 남은 고정 `ko-KR` 포맷을 제거하고 locale과 IANA time zone을 명시적으로 전달한다.
- 저장 형식은 바꾸지 않는다. 특히 `date_key`의 월이 0-indexed이며 비패딩인 기존 계약을 유지한다.
- 가격은 앱이 환산하지 않는다. Google Play `formattedPrice`와 Paddle의 formatted pricing preview만 사용자에게 표시한다.
- 사용자 입력 이름·메모·주소는 포맷하거나 번역하지 않는다.

## 부모·아이 어조

- 한국어 부모·페어링·구독 문구는 존댓말을 유지한다.
- 한국어 아이 모드는 반말과 짧고 안전한 표현을 유지한다.
- 다른 언어도 부모 화면은 정중하고 명확하게, 아이 화면은 친근하고 연령 적합하게 분리한다.
- 일본어의 경어, 태국어의 성별 종결 표현, 중국어 간체·번체 용어, 인도네시아어·말레이어의 유사어를 기계적으로 공용 처리하지 않는다.
- 안전 기능을 과장하거나 원격 권한 부여가 가능한 것처럼 번역하지 않는다.

## Android 네이티브 현지화

- Java에 직접 작성된 사용자 노출 문구를 Android string resource로 옮긴다.
- 기본 `values`와 영어·일본어·베트남어·태국어·말레이어 리소스를 생성하고, 중국어 script와 인도네시아어·필리핀어는 Android BCP 47 qualifier(`b+zh+Hans`, `b+zh+Hant`, `b+id`, `b+fil`)로 생성한다.
- `localeConfig`에는 앱 정본 코드 10개를 선언하고 레거시 qualifier 별칭이 필요한지는 지원 API에서 Gradle·실기기 테스트로 확정한다.
- Android 리소스의 정본은 `locales/<locale>/android.json`이고 생성된 XML은 diff와 lint로 검증한다.
- 알림 채널명, 권한 설명, force ring, SOS/emergency, 주변소리 Activity와 포그라운드 서비스 문구를 모두 포함한다.
- `NotificationTargetPolicy`, full-screen intent, 마이크 승인 증표, 1분 상한, 감사 기록과 quiet hours 계약은 문구 이동 때문에 바뀌지 않는다.
- Android가 지원하지 않는 locale 코드 별칭은 생성기 경계에서만 변환한다.

## PWA 메타데이터와 설치 이름

- `<html lang>`, 문서 title, description과 공유 메타데이터를 선택 언어에 맞춘다.
- 10개 locale manifest를 빌드에서 생성하고 설치 직전 선택 언어의 manifest link를 사용한다.
- manifest 이름은 한국어만 `혜니캘린더`, 나머지는 `Hyeni Calendar`를 사용한다.
- PWA shortcut 이름과 설명도 번역한다.
- Workbox `includeAssets`, manifest 아이콘과 precache URL 중복 금지 계약을 유지한다.
- 서비스 워커는 localStorage를 읽을 수 없으므로 초기화 메시지와 기존 세션 최소 정보 전달 경로에 locale을 함께 전달한다.

## 푸시·pending 알림 현지화

### 기기 endpoint locale

`fcm_tokens`와 `push_subscriptions`에 지원 locale만 허용하는 `locale` 컬럼을 추가한다.

- 기존 행은 `ko`로 시작해 현재 한국 사용자 동작을 보존한다.
- 토큰·구독 등록과 foreground 재동기화 때 현재 기기 locale을 upsert한다.
- 언어가 바뀌면 소유권 검증된 현재 endpoint 행만 갱신한다.
- 사용자 계정이나 가족 전체 언어를 endpoint locale로 덮어쓰지 않는다.

### 구조화 메시지

신규 알림의 정본은 다음 구조를 사용한다.

```json
{
  "messageKey": "notification.arrival.combined",
  "messageVersion": 1,
  "messageArgs": {
    "childName": "…",
    "fromPlace": "…",
    "toPlace": "…"
  }
}
```

- `messageArgs`는 알림 종류별 allowlist와 길이 제한을 적용한다.
- 기존 `pending_notifications.data` JSON에 구조화 필드를 넣고 title/body 컬럼은 구버전 호환용 한국어 값을 유지한다.
- 신규 클라이언트의 pending 조회는 message key를 현재 기기 언어로 렌더한다.
- Worker는 Web Push endpoint locale에 맞춘 title/body를 생성한다.
- Android는 구조화 필드와 native resource로 렌더하고, 구형 payload는 기존 title/body를 사용한다.
- 같은 사용자에게 여러 endpoint가 있으면 각각의 locale로 렌더한다.
- FCM 200이나 `delivered_at`을 기기 표시 증거로 간주하지 않고 기존 `acknowledged_at` 계약을 유지한다.

### 자유 콘텐츠와 AI

- 가족 메모, 사용자 입력 장소명, 주소와 AI 대화 원문은 endpoint마다 자동 번역하지 않는다.
- 사용자가 보낸 AI 요청에는 현재 app locale을 명시하고, AI 답변은 그 요청 언어로 생성한다.
- 서버 주도 proactive AI 메시지는 아이의 가장 최근 활성 endpoint locale을 사용하고, endpoint가 없으면 영어 다음 한국어로 폴백한다.
- 저장된 AI 답변은 하나의 대화 정본이므로 다른 기기에서 언어만 바꿨다고 재번역하지 않는다.
- 안전 시스템 프롬프트와 신고·차단 계약은 출력 언어와 무관하게 유지한다.

## 시간대 설계

언어, 국가와 시간대를 하나의 값으로 추정하지 않는다.

### 저장 경계

- `families.time_zone`: 가족 일정, date_key 경계, 오늘 리포트와 위치 이력의 가족 기준 시간대
- `notification_settings.time_zone`: 부모 본인과 활성 아이의 quiet hours 수신자별 시간대
- 모든 절대 timestamp: UTC 유지

기존 가족과 기존 notification settings는 `Asia/Seoul`을 유지한다. 신규 가족은 생성 부모 기기의 `Intl.DateTimeFormat().resolvedOptions().timeZone` 값을 서버가 IANA 이름으로 검증한 뒤 초기값으로 사용한다. 검증 실패 시 사용자가 국가·시간대를 선택하게 하고 영어 locale이나 IP만으로 추측하지 않는다.

### 동작 규칙

- 날짜형 일정은 시간대를 바꿔도 다른 날짜로 이동시키지 않는다.
- 향후 일정 알림과 cron 판정만 새 가족 시간대로 다시 계산한다.
- quiet hours는 기존 `[start,end)`와 시작=끝 거부 계약을 유지하되 계정별 time zone으로 판정한다.
- Free/reviewed 위치 이력의 오전 8시 오늘 경계는 기존 가족에는 KST 그대로이고 글로벌 가족에는 가족 time zone의 오전 8시로 확장한다.
- Premium 최근 30일 clamp와 UTC 절대 시각 정본은 유지한다.
- Google Play 가격 전환일처럼 이미 KST로 확정된 정책 시각은 가족 time zone으로 바꾸지 않는다.
- 화면에는 가족 시간대가 기기 시간대와 다를 때 시간대 레이블을 명시한다.

## 국가와 지도 공급자

### 가족 국가

`families.country_code`를 지도·주소 공급자 선택에 사용한다.

- 기존 가족은 `KR`로 유지한다.
- 신규 가족은 부모 온보딩에서 국가를 명시 선택하고 기기 locale은 추천값에만 사용한다.
- 언어 변경만으로 국가나 지도 공급자를 바꾸지 않는다.
- 해외 거주 한국어 가족과 한국 거주 영어 가족을 모두 지원한다.

### 지도 추상화

현재 `KakaoMap` 직접 의존을 provider-neutral 인터페이스로 감싼다.

```text
FamilyMapProvider
  ├─ 지도 렌더·viewport padding
  ├─ 마커·원·이동선·bounds
  ├─ 주소/키워드 검색
  ├─ 역지오코딩
  ├─ 도보 경로
  └─ 외부 지도 링크
```

- `KR` 가족은 Kakao 지도·검색·역지오코딩과 기존 Kakao/OSRM 경로를 유지한다.
- 그 외 공식 QA 국가는 Mapbox GL JS, Search/Geocoding과 Directions를 사용한다.
- Mapbox 지도 label은 언어 매트릭스의 변환 코드를 사용한다.
- 지도 worldview는 가족 국가를 기준으로 명시하며 언어만 보고 정하지 않는다.
- 공개 Mapbox 토큰은 허용 origin과 앱으로 제한하고 서버 토큰은 Worker secret에만 둔다.
- 공급자 장애 시 마지막 위치를 새 위치처럼 보이지 않게 측정 시각·정확도와 함께 표시하고, 지도·주소를 불러오지 못했다는 상태를 정직하게 보여준다.

### 장소 식별자 이관

- 위도·경도는 계속 공용 정본이다.
- 기존 `kakao_place_id`를 삭제하거나 의미를 바꾸지 않는다.
- provider-neutral `provider`, `provider_place_id`를 추가한다.
- 기존 행은 Kakao legacy로 읽고 재저장할 때만 새 필드를 보강한다.
- 20m 중복 장소, saved place 우선, 도착·출발 상태머신과 10분 presence dedupe는 공급자 변경 때문에 달라지지 않는다.

### 공급자 개인정보 고지

Mapbox를 사용하는 경우 지도 조회 좌표, 주소 검색어와 역지오코딩 좌표가 외부 공급자에 전달될 수 있음을 개인정보처리방침에 반영한다. Kakao·OSRM 기존 고지도 유지한다.

## 로그인 범위

- 해외 부모의 기본 로그인은 Google로 제공한다.
- 전화 가입·OTP는 현재 `+82`와 NCP SENS 경로만 검증됐으므로 한국 휴대전화 전용이라고 표시하고 해외 국가에서는 숨긴다.
- Kakao·Naver 로그인은 한국 사용자용 보조 선택지로 유지한다.
- 아이는 현재 페어링 코드와 `#/onboarding?pair=…` 복구 흐름을 그대로 사용한다.
- 로그인 제공자 선택은 앱 언어만으로 강제하지 않고 가족 국가와 기능 가용성을 함께 본다.
- 중국 본토는 Google·FCM·결제·지도 대체 공급자를 실제 검증하기 전까지 공식 지원으로 표시하지 않는다.

## 결제 채널과 권한 정본

```text
Google Play ─┐
Paddle ──────┼→ 공급자 직접 검증 → 공급자 선점 → family_subscription → 가족 전체 권한
Toss 기존 ───┘
```

### 채널 매트릭스

| 실행 환경 | 신규 구독·AI 크레딧 | 가격 표시 | 관리 |
|---|---|---|---|
| Google Play Android | Google Play Billing | Play `formattedPrice` | Play 관리 화면 |
| iPhone·웹 PWA | Paddle | Paddle PricePreview formatted 값 | Paddle Customer Portal |
| 기존 Toss 가입 가족 | 신규 판매 없음 | 저장된 KRW 계약 | 기존 Toss 해지·환불 경로 |

- Play 배포 Android 앱에는 Paddle/Toss 구매 링크나 외부 결제 유도 문구를 넣지 않는다.
- 웹에서 구매한 가족 권한은 Android에서도 사용할 수 있지만 Android는 공급자 상태와 “가입한 웹에서 관리” 안내만 보여준다.
- PWA에서 Google Play 구독 가족이 로그인하면 권한을 제공하되 중복 Paddle 결제를 차단한다.
- Premium 권한은 계속 `family_subscription` 정본으로 판정한다.

### 공급자 선점

가족당 활성 결제 공급자는 하나만 허용한다.

- 공급자 집합은 `google_play`, `paddle`, `toss_web`이다.
- 결제 시작 전에 server-side reservation을 획득한다.
- 같은 공급자·같은 결제 intent 재시도는 멱등 허용한다.
- 다른 공급자가 active/reserved이면 신규 결제를 시작하지 않는다.
- 두 기기의 경합으로 실제 중복 결제가 생기면 entitlement를 덮어쓰지 않고 conflict와 `manual_review`로 격리한다.
- 운영자가 정본 공급자와 환불 상태를 확인하기 전 자동 해제·자동 이전하지 않는다.

기존 CHECK 제약이 Paddle을 허용하지 않는 테이블은 drop/rebuild하지 않는다. Paddle을 포함하는 v2 정본 테이블을 새로 만들고 기존 행을 복사·검증한 뒤 코드가 새 정본을 읽게 한다. 기존 테이블은 rollback 증거로 보존한다.

### Paddle 승인 게이트

Paddle의 계정, 제품, 도메인과 앱 카테고리 심사가 모두 통과하기 전에는 운영 checkout을 열지 않는다.

- 자녀 안전 목적, 부모·아이 관계, 아이 화면의 지속 표시, 주변소리 1분 제한과 감사 기록을 심사 자료로 제출한다.
- 무단 접근·spyware로 오인될 표현이나 숨김 기능을 만들지 않는다.
- `configured`, `sandbox`, `liveApproved`를 분리해 health에 비밀값 없이 노출한다.
- live 승인 실패 시 글로벌 PWA 신규 결제를 열지 않는다. 기존 Toss 구독과 Android Play 결제는 유지한다.
- Lemon Squeezy로 자동 전환하지 않고 별도 심사·설계 승인을 거친다.

### Paddle checkout intent

1. 인증된 active parent가 plan 또는 AI 크레딧 팩을 요청한다.
2. Worker가 정본 가족, 부모, provider reservation, 가족 체험 이력과 allowlisted price ID를 검증한다.
3. Worker가 만료되는 `paddle_checkout_intent`를 만들고 Paddle transaction을 server-side로 생성한다.
4. 클라이언트에는 불투명 intent/transaction ID와 공개 client token에 필요한 최소값만 전달한다.
5. Paddle `custom_data`에는 raw family/user ID 대신 서버가 조회할 수 있는 불투명 intent ID만 넣는다.
6. 브라우저 checkout 완료는 “확인 중” UX만 표시하며 entitlement를 지급하지 않는다.
7. 서명된 webhook과 Paddle API 재조회가 성공한 뒤에만 구독·크레딧을 확정한다.

결제 이메일은 Paddle checkout이 수집할 수 있지만 이메일 일치만으로 가족 권한을 연결하지 않는다. checkout intent의 서버 매핑과 현재 active parent 검증이 정본이다.

### Webhook과 재대사

- raw body와 `Paddle-Signature`를 endpoint secret으로 HMAC-SHA256 검증한다.
- timestamp tolerance와 timing-safe 비교로 위조·재생을 차단한다.
- Paddle `event_id`를 UNIQUE inbox에 저장해 멱등 처리한다.
- 5초 안에 응답할 수 있도록 수신 확정과 후속 처리를 분리하고 실패 상태는 재시도 가능하게 남긴다.
- `transaction.completed`, `subscription.created/updated/canceled`, adjustment와 payment failure 계열 이벤트를 처리한다.
- 이벤트의 발생 시각과 현재 Paddle entity를 함께 비교해 역순 webhook이 최신 상태를 되돌리지 못하게 한다.
- 앱 시작·foreground와 cron 대사에서 Paddle API를 다시 조회해 누락된 갱신·취소·환불을 복구한다.
- API key, webhook secret, checkout URL token과 결제수단 정보는 로그·분석·클라이언트 저장소에 남기지 않는다.

### entitlement 매핑

- `trialing`과 미래 trial 종료 시각이 함께 확인될 때만 앱 `trial`이다.
- `active`와 미래 current period end가 함께 확인될 때만 앱 `active`다.
- 공급자가 재시도를 진행 중인 `past_due`는 provider 상태와 미래 권한 종료 시각을 함께 확인할 때만 제한된 `grace`로 매핑한다.
- 종료 예정 취소는 기간 종료까지 Premium을 유지한다.
- 실제 canceled/expired 또는 현재 기간 전액 환불이 확인되면 권한을 닫는다.
- DB·Paddle API 판정 실패는 Premium을 새로 열지 않는 fail-closed다.

### 가격과 7일 체험

- Paddle 가격과 국가별 override는 운영자가 승인한 price ID allowlist로만 사용한다.
- 한국 월 4,900원·연 39,000원 유지 여부와 해외 국가별 가격은 Paddle 수수료·승인 뒤 별도 운영 표로 확정한다.
- 앱은 환율 계산이나 임의 반올림을 하지 않는다.
- 세금 포함 여부와 formatted total은 Paddle preview와 checkout을 일치시킨다.
- 7일 체험은 가족 평생 1회 정본을 Google Play, Paddle, 기존 Toss가 공유한다.
- 서버가 체험 가능 가족에만 Paddle 체험용 가격을 선택한다.
- Google Play는 지금처럼 Play가 반환한 eligible offer 중 무료 phase가 정확히 7일인 offerToken만 사용한다.

### 복원·해지·환불

- Google Play 복원은 기기 구매 조회 뒤 Worker가 Play API를 직접 재검증한다.
- Paddle 복원은 같은 앱 가족으로 로그인한 뒤 저장된 Paddle customer/subscription을 서버가 재조회한다.
- Paddle Customer Portal session은 사용자 탭 안에서 매번 새로 생성하고 top-level 브라우저로 연다. 임시 URL은 저장·캐시하지 않는다.
- Paddle 해지는 기본적으로 현재 결제 기간 종료 시점에 적용하고 webhook 뒤 권한 종료일을 갱신한다.
- 환불 요청은 adjustment `pending_approval`을 완료로 보이지 않게 하며 approved 뒤에만 권한과 재무 원장을 갱신한다.
- 기존 Toss는 현재 갱신·해지·환불과 보존 계약을 유지한다.
- 공동 부모는 권한 상태를 볼 수 있지만 checkout을 만든 결제 소유 부모만 해당 공급자 관리·환불 경로를 연다.

### AI 크레딧

- Android 신규 AI 크레딧은 기존 Google Play 일회성 상품을 사용한다.
- PWA 신규 AI 크레딧은 Paddle 일회성 상품을 사용한다.
- `transaction.completed` 재검증 뒤 purchase event claim, balance와 ledger를 하나의 D1 batch로 확정한다.
- 같은 Paddle event나 transaction 재전송은 중복 가산하지 않는다.
- 전액 환불이 승인되면 남은 해당 구매분을 회수하고 환불 원장을 기록한다. 이미 소비된 크레딧은 음수 잔액으로 안전 기능을 망가뜨리지 않고 별도 회수 불가 수치로 기록해 반복 악용을 운영 검토한다.
- 결제는 parent만 가능하며 child/teacher route에는 checkout을 노출하지 않는다.

## 번역 대상

다음 사용자 노출 표면을 모두 카탈로그 또는 locale 문서로 옮긴다.

- React 전체 route, 모달, toast, 빈 상태, 오류, 접근성 이름
- 부모 홈·아이 홈·일정·준비물·메모·위치·리포트·설정
- 온보딩·로그인·페어링·세션 복구
- 구독·체험·AI 크레딧·영수증·해지·환불 안내
- Android notification channel, FCM 표시, 전체화면 Activity, foreground service, 권한 안내
- Worker 일정·도착·출발·위험·기기 상태·메모·AI 알림
- PWA offline/update/install 문구와 manifest shortcut
- 개인정보처리방침, 이용약관, 데이터 삭제 페이지
- Google Play listing, 제품 설명, release notes, screenshot caption과 심사 설명

코드 식별자, 내부 error code, 테스트 fixture의 의도적 한국어, 개발 주석과 운영 문서는 사용자 노출 번역 대상이 아니다. 다만 사용자에게 그대로 전달될 수 있는 Worker error message와 Android log-derived message는 반드시 경계에서 차단한다.

## 번역 품질과 검수

| 등급 | 내용 | 출시 기준 |
|---|---|---|
| A | SOS, emergency, 위치, 주변소리, 권한, 결제, 환불, 개인정보, 약관 | 원어민 및 필요한 법률 검수 완료 |
| B | 온보딩, 핵심 기능, 알림, Play Store | 원어민 문맥 검수 완료 |
| C | 도움말, 빈 상태, 일반 설정 | AI 초안 + 문맥 검수 + 원어민 표본 검수 |

`review-status.json`은 locale·namespace별 `draft`, `reviewed`, `approved` 상태와 검수자를 기록하되 개인 이메일이나 계약 정보를 저장하지 않는다. A/B 등급이 `approved`가 아니면 글로벌 출시 체크리스트를 완료로 표시하지 않는다.

### 번역 작업 규칙

- 한국어 원문을 먼저 메시지 ID로 정리하고 변수·문맥을 확정한다.
- 영어를 첫 번째 완성 번역이자 비한국어 런타임 폴백으로 만든다.
- 나머지 8개 언어 초안을 만든 뒤 언어별 검수본과 변경 이력을 관리한다.
- 글자 수 제한, 부모/아이 어조, 안전 의미와 결제 용어를 용어집으로 고정한다.
- `Hyeni Calendar`, product ID, base plan ID, event type와 API 이름은 번역하지 않는다.
- 자유 콘텐츠를 번역하지 않는다는 원칙을 검수자 문맥에도 명시한다.

### 자동 번역 가드

빌드 또는 전용 검사에서 다음을 실패시킨다.

- 지원 locale의 누락·추가 message ID
- 언어별 ICU 변수 집합 불일치
- 컴파일되지 않는 plural/select 문법
- 번역문 안의 금지 HTML·script·URL
- allowlist 밖 사용자 노출 한국어 literal
- React/Worker의 고정 `ko-KR` 포맷
- Android Java의 사용자 노출 string literal
- Worker 알림의 직접 작성된 사용자 문구
- Play listing과 상품 설명 글자 제한 초과
- locale별 필수 스크린샷·release note 누락

개발 전용 장문 pseudo-locale을 제공해 약 30~40% 확장된 문구로 잘림을 찾는다. 이 locale은 manifest, 언어 선택과 Store에 노출하지 않는다.

## Google Play 제출 자료

### listing 언어

가능하면 main store listing 기본 언어를 `en-US`로 바꾸고 나머지 9개 언어를 직접 등록한다. 현재 Play Console이 기존 앱 기본 언어 변경을 허용하지 않거나 심사 위험이 있으면 `ko-KR` 기본을 보존하되 9개 수동 번역을 모두 제공하고 자동 번역에 의존하지 않는다.

각 locale에 다음을 준비한다.

- 앱 이름: 한국어 `혜니캘린더`, 그 외 `Hyeni Calendar`
- 80자 이내 short description
- 4,000자 이내 full description
- 버전별 “새로운 기능” 문구
- 월·연 구독 title/description
- AI 크레딧 30·80·200 title/description
- screenshot caption과 접근성 설명
- 원격청취·위치·AI·구독의 과장 없는 신뢰 문구

Play data safety의 사실 관계는 locale마다 달라지지 않는다. 내부 정본은 하나로 유지하고 사용자에게 보이는 정책 URL과 자유 설명만 필요한 언어로 제공한다.

### 이미지

- 실제 A17·razr 데이터나 실계정 이름·일정·위치를 Store 이미지에 사용하지 않는다.
- 익명화된 고정 test family와 위치 fixture로 Android 화면을 캡처한다.
- 10개 locale에서 같은 핵심 화면·상태를 재현한다.
- 문구가 들어간 screenshot과 caption은 locale별로 만든다.
- 텍스트 없는 icon/brand artwork는 공용으로 재사용할 수 있다.
- 기존 `output/store-ui-candidates-v1`의 사용자 변경은 덮어쓰지 않고 새 locale 출력 경로를 사용한다.
- screenshot 생성 manifest에 app commit, locale, viewport, fixture와 생성 시각을 기록한다.

### 심사 문서

- reviewer access와 기능 설명의 제출 정본은 영어로 만들고 한국어 내부 대조본을 둔다.
- background location, full-screen safety alerts, 주변소리 표시·1분 종료·감사 기록을 영어로 정확히 설명한다.
- 서명 AAB는 최신 앱 commit 뒤 사용자가 서명 비밀번호를 직접 입력해 다시 만들고 인증서·hash·mtime을 확인해야 한다.
- 에이전트는 Play Console에 실제 업로드·게시하지 않는다.

## 법적 페이지

`/privacy`, `/terms`, `/data-deletion`의 언어 선택 우선순위는 다음과 같다.

1. 검증된 `?lang=` 값
2. 앱에서 전달한 locale cookie 또는 공개 저장값
3. `Accept-Language`
4. 영어

- 모든 법적 페이지에 언어 선택기를 제공한다.
- locale별 URL과 canonical/hreflang 정보를 제공한다.
- 페이지 버전, 시행일과 번역 검수 상태를 명시한다.
- Paddle, Mapbox, Google Play, Kakao, OSRM, FCM, Web Push와 AI 처리 내용을 실제 데이터 흐름에 맞춰 갱신한다.
- 결제 이메일, 세금, 환불, 국제 데이터 이전, 아동·위치·마이크 데이터 처리와 보존을 고지한다.
- 법률 검수 전 번역본은 검토용이며 정식 법률 적합성을 주장하지 않는다.
- 일본 유료 판매에 필요한 사업자명·주소·전화번호 등 특정상거래법 표시값은 사용자가 제공한 검증 정보만 사용한다.
- 다른 QA 국가도 소비자, 개인정보와 아동 보호 요구사항을 jurisdiction checklist로 추적한다.

사업자명, 주소, 전화번호, 지원 이메일과 법률 대리인 정보가 없으면 추측하지 않고 명확한 미입력 blocker로 남긴다.

## 글꼴·레이아웃·접근성

- Jua가 모든 스크립트를 지원한다고 가정하지 않는다.
- 본문은 locale별 system font stack과 Noto 계열 fallback을 사용하고 브랜드 장식 폰트는 지원 glyph가 있을 때만 쓴다.
- CJK 줄바꿈, Thai 단어 분리, Vietnamese diacritic, 긴 Malay/Indonesian/Filipino 문구를 확인한다.
- 고정 높이 텍스트 상자를 줄이고 `overflow-wrap`과 유연한 grid/flex를 사용한다.
- 200% 글자 크기, 320px 폭, Android landscape와 PWA desktop을 검증한다.
- 언어 선택기, 결제, 취소, SOS와 권한 버튼은 44px 최소 조작 영역과 명확한 accessible name을 유지한다.
- locale 전환은 focus를 잃거나 screen reader live region을 과도하게 다시 읽지 않게 한다.

## 보안·개인정보 불변식

- locale과 time zone은 최소 환경 설정이며 계정 콘텐츠와 분리한다.
- endpoint locale 갱신은 현재 authenticated user와 registration instance 소유권을 검증한다.
- 알림 message args는 종류별 allowlist만 허용하고 토큰·원문 오류·자유 JSON을 넣지 않는다.
- Mapbox secret token은 클라이언트에 노출하지 않고 public token은 origin 제한을 건다.
- Paddle API key, webhook secret, portal token, transaction credential과 결제수단 정보는 클라이언트·로그·분석에 넣지 않는다.
- premium funnel은 기존 최소수집 계약을 유지하고 Paddle provider 지원 때문에 raw customer/family/payment 식별자를 추가하지 않는다.
- 주변소리, 위치, SOS, 차단·신고와 pending notification의 기존 안전·보안 계약을 완화하지 않는다.
- refresh token을 출력·복사·회전하거나 외부에서 재사용하지 않는다.

## 오류와 폴백

### 번역

- route 카탈로그 실패는 영어 다음 한국어로 폴백하고 오류 코드를 진단에 남긴다.
- 번역 키 자체나 ICU 변수 값을 사용자에게 노출하지 않는다.
- 한 화면에서 선택 언어와 한국어가 무작위로 섞이지 않게 namespace 단위로 원자 전환한다.

### 시간대

- 유효하지 않은 time zone은 저장하지 않는다.
- 서버 time zone 계산이 실패하면 일정·quiet hours를 임의 KST로 처리하지 않고 해당 작업을 fail-closed하고 사용자에게 설정 확인을 요청한다.
- SOS·emergency와 강제 명령은 quiet hours 실패 때문에 차단하지 않는 기존 예외를 유지한다.

### 지도

- 지도 provider 실패를 위치 없음으로 위장하지 않는다.
- 마지막 실측 좌표·시각·정확도와 지도 표시 실패를 구분한다.
- 역지오코딩 실패 시 가짜 장소명을 만들지 않는다.

### 결제

- Paddle 미설정·미승인·schema 미적용은 `configured:false`로 checkout만 닫는다.
- 결제 분석 실패가 checkout·권한·안전 기능을 실패시키지 않는다.
- 결제 검증 실패는 Premium을 새로 열지 않는다.
- 기존 유효 entitlement 조회는 신규 checkout 장애와 분리한다.
- 공급자 conflict는 자동 덮어쓰기 없이 운영 검토 상태를 보여준다.

## 테스트 전략

구현은 회귀 테스트를 먼저 추가하는 TDD 순서를 따른다.

### 국제화 단위 테스트

- locale 정규화와 중국어 script/region 매핑
- PWA·Android 감지 우선순위와 기기별 저장
- 전체 message ID와 ICU variable parity
- locale별 plural/select 예제
- 날짜·숫자·통화 formatter의 locale·time zone
- 부모·아이 핵심 신뢰 문구 snapshot이 아닌 의미 기반 assertion
- 사용자 노출 hard-coded 한국어 scanner와 allowlist

### 시간대 테스트

- 기존 `Asia/Seoul` 가족의 결과 불변
- Tokyo, Taipei, Bangkok, Jakarta, Kuala Lumpur, Manila, Ho Chi Minh 시간대 경계
- DST가 있는 IANA time zone의 일정 cron·quiet hours
- 자정, 오전 8시 위치 이력 경계와 `[start,end)` quiet hours
- time zone 변경 뒤 날짜형 일정 불변과 향후 알림 재계산
- 가격 전환 KST 정책 시각 불변

### 알림 테스트

- 같은 user의 서로 다른 FCM/Web Push locale별 title/body
- pending의 message key/args와 구버전 한국어 title/body 호환
- targetUserId, familyId, targetRole 불변
- quiet hours, memo display permit, ACK와 delivery 계약 불변
- Android 8개 표시 경로의 native resource 적용
- 알 수 없는 message key와 변조된 args의 fail-closed

### 지도 테스트

- family country에 따른 Kakao/Mapbox 선택
- locale→Mapbox 코드와 worldview 매핑
- 기존 `kakao_place_id` 읽기·저장 호환
- saved place·academy 중복과 geofence 상태머신 불변
- provider 장애 시 stale 위치·지도 오류 분리
- 좌표나 secret token 로그 금지

### 결제 테스트

- Play Android에 외부 결제 URL·CTA가 없는 정적 회귀
- Paddle checkout intent 소유권·만료·price allowlist
- webhook raw signature, timestamp, replay와 timing-safe 비교
- 중복·역순·누락 webhook과 provider API 재대사
- Play/Paddle/Toss reservation 경합과 conflict 격리
- 가족 평생 1회 7일 체험
- trial/active/grace/cancelled/refund entitlement 경계
- Customer Portal URL 비저장과 결제 소유 부모 gate
- AI 크레딧 원자 claim·중복·환불 reversal
- secret·customer/payment token이 응답·로그·분석에 없는지 검증

### UI·Store 테스트

- 10개 locale의 온보딩, 부모 홈, 아이 홈, 설정, 위치, 결제와 법적 페이지 자동 순회
- 320/390/448px, landscape, desktop과 200% 글자 크기
- 가로 overflow, 버튼 잘림, 콘솔 오류와 접근성 이름
- Play title/short/full/release note 글자 수
- locale별 필수 screenshot과 제품 설명 존재
- PWA manifest·precache URL 중복 없음
- 한국어 `혜니캘린더`와 비한국어 `Hyeni Calendar` 브랜드 가드

### 전체 회귀

최소 다음 명령이 모두 exit 0이어야 한다.

```bash
npm run typecheck
npm run build
npm run typecheck:worker
npm run test:worker
cd android && ./gradlew test assembleDebug lint
```

프로젝트의 기존 로컬 앱 테스트, Worker 테스트, PWA route bundle, subscription trust copy, remote audio trust copy와 AI schedule UX copy 회귀도 함께 통과해야 한다.

## 단계적 이관과 배포 게이트

### 1. 기반

- locale manifest, FormatJS Provider, formatter와 누락 검사
- 기존 한국어 화면이 시각·동작상 바뀌지 않는 baseline
- locale/time zone/country의 additive schema와 소유권 테스트

### 2. 사용자 화면

- 온보딩과 공용 셸부터 route 단위로 카탈로그 이관
- 부모·아이·설정·결제·리포트를 순차 이관
- 카탈로그가 완성된 namespace만 언어 선택에서 활성화

### 3. 네이티브·Worker

- Android resource 생성과 locale bridge
- endpoint locale과 구조화 알림
- Worker 법적 페이지와 AI 출력 언어
- 구버전 payload 호환을 유지한 채 새 클라이언트 배포

### 4. 시간대·지도

- 기존 가족 `KR/Asia/Seoul` backfill을 먼저 검증
- provider-neutral 지도 경계 도입 뒤 한국 Kakao 결과 회귀
- Mapbox sandbox token으로 해외 fixture 검증
- 글로벌 신규 가족에만 country/time zone onboarding 활성화

### 5. 결제

- 새 provider v2 schema와 local D1 테스트
- Paddle sandbox product, checkout, webhook, portal, refund 대사
- Play license tester와 Toss legacy 충돌 검증
- Paddle live 승인·도메인·가격표 확인 뒤에만 PWA 신규 결제 전환

### 6. Store 준비

- 번역 검수 상태 확인
- 10개 locale screenshot과 listing pack 생성
- Play 내부 테스트용 최신 AAB 준비
- reviewer guide와 법적 운영 정보 확인

### 7. 최종 실기기

- A17 부모와 razr 아이만 대상으로 `adb install -r`을 사용한다.
- 두 기기의 역할·세션·계정·페어링을 유지한다.
- 로그아웃, 역할 전환, 재페어링과 refresh token 조작을 하지 않는다.
- 실결제 대신 Play license test와 Paddle sandbox를 사용한다.
- S25에는 접근하지 않는다.

## 외부 입력과 차단 조건

다음은 저장소에서 추측할 수 없으므로 사용자가 제공하거나 외부 심사로 확정해야 한다.

- Paddle 판매자 계정 승인, 허용 제품 판정과 live domain 승인
- Paddle product/price ID, client token, API key와 webhook destination secret
- 국가별 월·연 구독 및 AI 크레딧 가격표
- Mapbox public token, Worker용 server token과 사용량 예산
- 사업자 법정 이름, 주소, 전화번호, 지원 이메일
- 일본 및 대상 국가 법률 검토 결과
- A/B 등급 번역의 원어민 검수 결과
- Google Play Console 국가·가격·상품·listing 적용과 실제 게시
- 출시 AAB 서명 비밀번호

시크릿과 서명 비밀번호는 사용자가 직접 입력한다. 에이전트는 자격 파일을 읽거나 값을 문서·로그에 복사하지 않는다.

## 완료 기준

- 10개 지원 locale에서 사용자 노출 카탈로그가 100% 존재하고 ICU·변수 검사가 통과한다.
- 부모와 아이가 같은 가족에서 서로 다른 기기 언어를 유지한다.
- React, Worker, Android 알림과 PWA 메타데이터가 선택 언어로 일관되게 표시된다.
- 기존 한국 가족, KST 일정, 위치·안전·페어링과 구독 동작에 회귀가 없다.
- 해외 신규 가족이 명시 국가·IANA time zone과 Mapbox로 지도·일정을 사용할 수 있다.
- Android 신규 결제는 Play만, PWA 신규 결제는 승인된 Paddle만 사용한다.
- Play/Paddle/Toss 중복 구독과 가족 체험 중복이 서버에서 차단된다.
- Paddle sandbox의 구매·복원·해지·환불·AI 크레딧 E2E가 통과한다.
- 10개 언어 Play listing, 제품 설명, release note와 익명 screenshot pack이 준비된다.
- A/B 번역과 법적 문서가 검수 전이면 “글로벌 출시 완료”라고 표시하지 않는다.
- 실제 Play 게시, 운영 시크릿 설정과 프로덕션 D1 적용은 별도 운영 승인 항목으로 남는다.

## 검토한 대안

### i18next/react-i18next

namespace와 lazy loading 생태계는 좋지만 날짜·숫자·통화와 Worker 공용 ICU 계약을 별도로 더 설계해야 한다. 이 앱은 일정·시간대·복수형·결제 포맷과 서버 알림 비중이 높아 FormatJS를 선택했다.

### 현재 자체 사전 확장

의존성은 가장 작지만 10개 언어의 복수형, 변수 서명, 추출, rich text와 누락 검사를 안전하게 유지하기 어렵다.

### Google Maps 단일 공급자

국제 장소 데이터는 강점이 있지만 현재 한국 지도·경로 동작을 보존하기 어렵고 중국어 worldview와 대상 언어 매핑을 별도 해결해야 한다. 한국 Kakao를 유지하고 해외 Mapbox를 추가하는 방식이 기존 사용자 위험이 낮다.

### Mapbox 단일 공급자

코드는 단순해지지만 한국 주소·장소·경로 품질과 현재 실사용 회귀 위험이 있다. country 기반 이중 provider를 선택했다.

### Stripe Managed Payments

현재 공식 지원 사업자 지역과 제품 제한이 이 앱에 맞지 않고 parental control 범주가 명시적 금지 대상이라 제외했다.

### Lemon Squeezy

한국 판매자 지원과 다국어 checkout 장점이 있지만 실제 청구 통화, 추가 국제·구독 수수료와 중국어 번체 checkout 한계가 있어 Paddle의 예비 대안으로만 남겼다.

### 기존 Toss를 글로벌 결제로 확장

현재 구현과 국내 결제 안정성은 유지할 수 있지만 해외 통화·세금·현지 결제수단과 Merchant of Record 요구를 충족하기 어렵다. 기존 구독 보존용으로 한정한다.

## 참고한 공식 자료

- FormatJS React Intl: https://formatjs.github.io/docs/react-intl/
- FormatJS ICU 메시지: https://formatjs.github.io/docs/intl-messageformat/
- Android 앱별 언어: https://developer.android.com/guide/topics/resources/app-languages
- Android BCP 47 리소스 qualifier: https://developer.android.com/guide/topics/resources/providing-resources
- Google Play 앱·스토어 현지화: https://support.google.com/googleplay/android-developer/answer/9844778?hl=en
- Google Play 스토어 권장사항: https://support.google.com/googleplay/android-developer/answer/13393723?hl=en
- Google Play 인앱 상품 번역: https://support.google.com/googleplay/android-developer/answer/1153481?hl=en
- Google Play 결제 정책: https://support.google.com/googleplay/android-developer/answer/10281818?hl=en
- Google Maps 국가별 지원: https://developers.google.com/maps/coverage
- Mapbox 국제화: https://docs.mapbox.com/help/dive-deeper/maps-internationalization/
- Mapbox 가격: https://www.mapbox.com/pricing
- Paddle 국가·세금 지원: https://developer.paddle.com/concepts/sell/supported-countries-locales/
- Paddle 현지 가격: https://developer.paddle.com/build/products/offer-localized-pricing/
- Paddle 가격 미리보기: https://developer.paddle.com/build/checkout/build-pricing-page/
- Paddle webhook 서명: https://developer.paddle.com/webhooks/about/signature-verification/
- Paddle subscription webhook: https://developer.paddle.com/webhooks/
- Paddle Customer Portal: https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/
- Paddle 환불: https://developer.paddle.com/build/transactions/create-transaction-adjustments/
- Paddle 판매 제한: https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle
- Stripe Managed Payments 지원·제한: https://docs.stripe.com/payments/managed-payments/how-it-works
- Lemon Squeezy 지원 국가: https://docs.lemonsqueezy.com/help/getting-started/supported-countries
- Lemon Squeezy 통화·수수료: https://docs.lemonsqueezy.com/help/payments/currencies, https://docs.lemonsqueezy.com/help/getting-started/fees
- 일본 Google Play 유료 판매 요구사항: https://support.google.com/googleplay/android-developer/answer/6223646?hl=en
