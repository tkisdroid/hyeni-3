# Task 8 리뷰 3차 수정 구현 보고서

## 기준과 범위

- 기준 커밋: `c163315`
- 작업 범위: 글로벌 웹 i18n Task 8 리뷰 3차의 Important 3건
- Worker 소스 및 Android 소스는 수정하지 않았다.
- 배포, 결제, 스토어, secret 변경은 수행하지 않았다.

## 수정 결과

### 1. glossary 보호어 `Premium` exact 계약

- `locales/glossary.json`의 `protectedTerms`에 있는 `Premium`을 정본으로 직접 읽어 감사한다.
- `billing.common.premium`, `billing.trialLock.title`은 비한국어 9개 locale에서 정확히 `Premium`이어야 하며, 한국어는 기존 `프리미엄`을 유지한다.
- 일본어·중국어 간체·중국어 번체·태국어의 번역된 등급명을 `Premium`으로 교정하고 생성 카탈로그를 동기화했다.
- 영어 동일값 exact 예외는 실제 계약에 맞춰 58개로 갱신했으며, 전체 locale 감사 위반은 0이다.
- 테스트는 glossary를 감사기 export와 독립적으로 직접 읽고 정본 보호어 제거·대문자 변형·locale 번역값 재도입을 모두 거부한다.
- RED: locale 품질 테스트 8개 중 2개 실패. 첫 실패는 일본어 `プレミアム`이 exact `Premium`과 달랐고, 보호어 계약 감사도 실패했다.
- GREEN: locale 품질 테스트 8/8 통과, Task 8 locale 18,387개 감사 통과.

### 2. `defaultIntl` TypeScript symbol 기반 AST 감사

- TypeScript `Program`·`TypeChecker`로 `withDefaultIntl`, `defaultKoreanIntl`, `IntlShape`의 실제 symbol 유래를 추적한다.
- inline descriptor뿐 아니라 `const descriptor`, `const id` shorthand, 구조 분해 `formatMessage`, 이름을 바꾼 구조 분해 alias, 안전한 const alias chain을 수집한다.
- 동일 이름의 무관한 객체 메서드와 무관한 구조 분해 alias는 symbol 유래가 다르므로 감사 대상에서 제외한다.
- mutable·computed·spread·ambiguous descriptor, 변경되거나 추가 사용된 descriptor, mutable intl 및 method alias 등 안전하게 해석할 수 없는 관련 호출은 `unsupported_format_message`로 fail-closed한다.
- 실제 저장소에서 importer 19개, fallback ID 248개, 동적 예외 12/12개를 그대로 발견하며 위반은 0이다. 동적 예외의 duplicate·stale 검사도 유지했다.
- RED 1: AST fixture 7개 중 3개 실패. const descriptor/id/구조 분해 alias 누락, 무관한 동명 메서드 오탐, 미지원 관련 호출 누락을 각각 재현했다.
- GREEN 1: symbol 유래 추적과 fail-closed 분류 후 7/7 통과.
- RED 2: 변경된 descriptor 안전성 fixture 추가 후 7개 중 1개 실패. 변경 전 literal을 잘못 안전한 ID로 수집하는 문제를 재현했다.
- GREEN 2: descriptor symbol의 선언·단일 사용 불변식을 추가해 7/7 통과.

### 3. 외부 `modulepreload` provenance fail-closed

- 초기 `modulepreload`를 provenance 검증 전에 필터링하지 않는다.
- `https:`, protocol-relative `//`, `data:` 외부 preload를 발견하면 검사할 수 없는 초기 코드가 있다는 명시적 오류로 즉시 실패한다.
- 로컬 preload의 provenance artifact, 해시·바이트·분류, stale/tamper, first-party 포함, 500KB 예산 계약은 그대로 유지한다.
- RED: route bundle 테스트 16개 중 3개 실패. 세 외부 preload fixture가 모두 조용히 제외되어 통과하던 문제를 재현했다.
- GREEN: 외부 preload 3종을 포함한 route bundle 테스트 16/16 통과.

## 최종 검증

- 집중 회귀: 38/38 통과
  - `tests/task8LocaleQuality.test.mjs`
  - `tests/defaultIntlFallback.test.mjs`
  - `tests/routeBundleBudget.test.mjs`
  - `tests/i18nChildScreens.test.mjs`
- 웹 전용 전체 회귀: Android 직접 테스트 28개를 basename 기준으로 제외한 정확히 241개 파일, 1,366/1,366 통과, 실패·skip·todo 0
- `npm run typecheck`: 통과
- `npm run typecheck:worker`: 통과
- `npm run test:worker`: 1,163/1,163 통과
- `node scripts/i18n/build-catalogs.mjs --check`: 최신 상태
- `node scripts/i18n/validate-catalogs.mjs`: 통과
- `node scripts/i18n/scan-client-error-surfaces.mjs`: 통과
- `node scripts/i18n/audit-task8-locales.mjs`: 18,387개 통과
- `npm run build`: 통과
  - 초기 자체 JS: 329,299/500,000B
  - provenance로 확인된 외부 i18n runtime: 240,492B
  - 초기 CSS: 30,849/40,000B
  - PWA precache: 414개 URL, 중복 0
- `git diff --check`: 통과(LF→CRLF 안내만 있음)
- 기준 커밋 대비 `android/`·`worker/` tracked 변경: 0

## 안전 준수와 과거 위반 구분

### 이번 3차 수정 라운드

- Android 디렉터리 읽기·검색·수정: 0회
- Gradle 실행: 0회
- ADB/기기/설치/실행/로그/세션 접근: 0회
- 금지된 Android 직접 테스트 28개 실행: 0회
- `npm test` 실행: 0회
- Worker는 허용된 typecheck·test만 실행했고 소스 수정은 0건이다.

### 이전 1차 라운드에서 발생한 위반(보존 기록)

- 실수로 `npm test`를 실행해 Android 소스 직접 테스트 28개를 실행했다.
- `./gradlew.bat :app:processReleaseMainManifest --no-daemon`을 1회 실행했다.
- 경고 이후에도 `remoteListenConsentSafety` 테스트 소스를 1회 더 읽었다.
- ADB/기기/세션 접근은 없었고 tracked Android/Worker 변경도 없었다.
- 위 이력은 이번 라운드의 준수 기록과 분리하며 삭제하거나 축소하지 않는다.

### 이전 2차 수정 라운드

- Android 디렉터리 접근, Gradle, ADB/기기 접근, 금지 테스트, `npm test` 실행은 모두 0회였다.
- Worker 소스 및 Android 소스의 tracked 변경은 0건이었다.

## 남은 한계

- 이번 범위는 자동 감사와 production build까지의 웹 검증이다. 실제 기기·Android·브라우저 수동 시각 검증과 배포는 수행하지 않았다.
