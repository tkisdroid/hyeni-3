# Task 6 수정 라운드 4 구현 보고서

- 기준 커밋: `2b25eb24aa049da10715cf29cf4ae35fe1ddb1f6`
- 범위: 독립 리뷰 Important 3건만 수정
- 배포·ADB·실기기·시크릿·실결제: 수행하지 않음

## RED

구현을 바꾸기 전에 `tests/apiErrorSurfaceWiring.test.mjs`에 실제 scanner를 임시 저장소 fixture로 실행하는 회귀를 추가했다.

- 명령: `node --test tests/apiErrorSurfaceWiring.test.mjs`
- 최초 결과: 31개 중 22개 통과, 9개 실패
- 승인 경로 `src/screens/child/AiFriendChat.tsx` 내부의 중첩 `friendlyError` shadow가 raw `error.message`를 그대로 반환해도 scanner가 통과했다.
- 직접 배열 구조분해, tainted 배열 alias 뒤 구조분해, destructuring assignment가 모두 통과했다.
- tainted zero-arg arrow wrapper와 element-access method 호출 반환이 통과했다.
- property-access method receiver 경로는 기존 scanner가 이미 차단하고 있어 새 fixture도 최초부터 통과했다. 이번 수정에서 이 보호를 유지했다.
- allowlist 패턴과 raw 오류가 한 JSX finding의 덧셈·조건식·배열 안에 함께 있으면 혼합 finding이 occurrence를 먼저 소비하고, 뒤의 정확한 도메인 finding을 raw/overuse로 오판했다. 세 fixture 모두 기대한 혼합 행이 아니라 정확한 표현식 행을 보고해 실패했다.

## GREEN

### 1. 로컬 sanitizer 정본 binding

승인 파일과 함수 이름만 검사하던 로직을 제거했다. binding model을 만든 뒤 각 승인 파일의 root scope에서 실제 top-level 함수 선언 또는 함수식/화살표 함수 변수 선언을 한 번 resolve해 해당 binding 객체만 `approvedLocalBindings`에 담는다. 호출 identifier가 그 객체와 동일할 때만 sanitizer로 인정한다.

따라서 승인 파일 안이라도 component·block·catch 등 중첩 scope가 새로 선언한 동명 binding은 승인되지 않는다. import sanitizer의 imported name + module source + lexical binding 검증은 그대로 유지한다.

### 2. 배열 구조분해와 callable 반환 taint

- tainted initializer의 `ArrayBindingPattern`에 속한 모든 binding identifier로 taint를 보수적으로 전파한다.
- 배열 destructuring assignment의 각 target binding에도 taint를 전파한다.
- 일반 call에서 identifier callee binding 자체가 tainted이면 zero-arg 호출 결과도 tainted로 판정한다.
- property-access와 element-access method call 모두 receiver가 tainted이면 호출 결과도 tainted로 판정한다.
- 승인 sanitizer identifier는 위 일반 callable 판정보다 먼저 정확한 binding으로 확인하므로 안전 변환 결과는 기존대로 taint를 해제한다.

### 3. exact AST finding allowlist

allowlist 비교 대상을 finding 전체 줄의 substring이 아니라 AST finding의 실제 subject로 정의했다.

- JSX finding: 중괄호 내부 expression의 AST text
- display/new Error finding: call/new expression의 AST text
- 비교 전 연속 whitespace를 한 칸으로 정규화
- allowlist regex는 scanner가 강제로 `^(?:pattern)$` 전체 일치로 감싼다.

이에 따라 `cleanAlertTitle(a.message)`만 허용한 항목은 그 표현식 자체에만 일치한다. `cleanAlertTitle(a.message) + error.message`, 조건식, 배열처럼 raw operand를 같은 finding에 섞으면 occurrence를 소비하지 못하고 `raw_error_surface`가 남는다. 정확한 도메인 표현식은 별도로 occurrence를 소비하며 stale/overuse/direct raw 검사는 유지된다.

기존 allowlist 중 display call을 부분 문자열로 적었던 두 항목은 전체 call expression으로 좁혔다.

- AI 일정: `show(errorMessage, "⚠️")`
- 자녀 요건: `show(childRequirements.message|required.message, "🎂")`

Arrival/Danger/Admin 항목은 JSX subject 자체가 기존 패턴과 정확히 일치한다.

## 변경 파일

- `scripts/i18n/scan-client-error-surfaces.mjs`
- `scripts/i18n/client-error-surface-allowlist.json`
- `tests/apiErrorSurfaceWiring.test.mjs`
- `.superpowers/sdd/2026-08-15-global-i18n-web/task-6-fix-4-implementer-report.md`

웹 결제 `ApiError.code` 매핑과 라운드 3의 stale 테스트 정렬은 변경하지 않았다.

## 검증

- focused 오류 표면: 31/31 통과
- `node scripts/i18n/scan-client-error-surfaces.mjs`: 통과
- `node scripts/i18n/build-catalogs.mjs`: 생성물 92개 생성
- `node scripts/i18n/validate-catalogs.mjs --check-generated`: 통과
- 전체 앱 `npm test`: 1,390/1,390 통과
- Worker 전체 `npm run test:worker`: 1,163/1,163 통과
- `npm run typecheck`: 통과
- `npm run typecheck:worker`: 통과
- `npm run build`: 통과, 2,223 modules, PWA precache 415개 중복 없음
- `git diff --check`: 통과

## 잔여 위험

- scanner는 TypeScript AST 기반의 보수적 정적 게이트이며 완전한 interprocedural/type-aware 분석기는 아니다. 이번 리뷰가 지적한 top-level binding, 배열 구조분해, zero-arg callable, property/element receiver, 혼합 allowlist 경로는 실제 fixture로 고정했다.
- 배열 구조분해는 어느 원소가 raw인지 세밀하게 계산하지 않고 initializer 하나가 tainted이면 모든 target을 tainted로 처리한다. 이는 오류 원문 비노출 게이트에서 의도한 fail-safe 오탐 방향이다.
- allowlist 표현식의 구조나 표시 호출 인자가 바뀌면 exact matcher가 stale로 실패한다. 변경 시 도메인 근거와 occurrence를 다시 검토해야 한다.
