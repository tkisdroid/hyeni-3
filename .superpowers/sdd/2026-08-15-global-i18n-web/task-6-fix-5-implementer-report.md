# Task 6 최종 수정 라운드 5 구현 보고서

- 기준 커밋: `7c3f6c14fad7101c30c38fe81038c5924d17e4ef`
- 범위: 라운드 4 독립 리뷰의 Important 3건
- 배포·ADB·실기기·시크릿·실결제: 수행하지 않음

## RED

구현 변경 전에 실제 scanner를 임시 저장소에 실행하는 fixture를 문법 계열별로 추가했다.

- 명령: `node --test tests/apiErrorSurfaceWiring.test.mjs`
- 최종 RED 기준: 45개 중 35개 통과, 10개 실패
- 실패한 assignment 흐름
  - `[text = fallback]`
  - `[[text]]`
  - object → array → 기본값 target과 object rest가 섞인 중첩 pattern
  - object property 안의 property target과 같은 array의 element target을 각각 별도 행에 렌더하는 중첩 pattern
- 실패한 callable 흐름
  - block-bodied arrow
  - `FunctionExpression`
  - `FunctionDeclaration`
  - object `MethodDeclaration`의 property-access/element-access 호출
- 실패한 allowlist 흐름
  - `(cleanAlertTitle(alert.message), failure.message)` comma sequence 혼합 표현식이 finding 없이 통과
- 기존에 이미 차단된 단순 assignment, array rest, concise arrow, arrow property의 property/element call은 최초부터 통과했고 회귀 fixture로 유지했다.
- object property key를 target binding으로 오인하지 않는 안전 fixture와, 중첩 함수의 raw return을 바깥 함수 return으로 오인하지 않는 안전 fixture도 최초부터 통과했다.

## GREEN 설계

### 1. 재귀 assignment target 수집

`assignmentTargetIdentifiers`를 공용 재귀 helper로 추가하고 tainted assignment의 왼쪽 처리를 모두 이 helper로 통일했다.

- `Identifier`: 해당 binding target
- `PropertyAccessExpression`/`ElementAccessExpression`: 변경되는 컨테이너의 root identifier
- 기본값 `BinaryExpression(=)`: 왼쪽 target만 재귀 수집하고 fallback 표현식은 target으로 보지 않음
- array literal/binding pattern: omitted element를 건너뛰고 모든 element를 재귀 수집
- object literal: shorthand는 이름, property assignment는 initializer만 수집하여 property key를 binding으로 오인하지 않음
- object binding pattern/`BindingElement`: 실제 `name`만 수집
- array spread/object spread/rest: spread expression을 재귀 수집
- parenthesized/as/type assertion/non-null wrapper: 내부 target을 재귀 수집

aggregate RHS가 tainted이면 각 target을 모두 tainted로 두는 기존 fail-safe 방향은 유지한다. fixture는 기본값, 중첩 array, object→array→기본값, array/object rest, property/element target을 실제 렌더 행별로 검증한다.

### 2. function-like 반환 taint

`isTrackedCallable`, `callableReturnExpressions`, `callableReturnsTainted`를 공용화했다.

- concise arrow는 expression body를 직접 반환식으로 취급한다.
- block-bodied arrow, `FunctionExpression`, `FunctionDeclaration`, object `MethodDeclaration`은 자신의 body에서 직접 귀속되는 `ReturnStatement.expression`만 수집한다.
- 반환식 탐색 중 다른 tracked function-like node를 만나면 그 경계에서 중단한다. 따라서 중첩 함수의 return이 바깥 callable의 반환으로 섞이지 않는다.
- 변수 initializer의 arrow/function expression, 함수 선언 binding, object method를 포함한 object binding에 동일 반환 taint 판정을 적용한다.
- 기존 identifier zero-arg call과 property/element receiver call 판정이 이 callable binding/object taint를 이어받는다.

함수가 다른 tainted callable을 반환하거나 호출하는 순서 의존성은 기존 fixed-point taint 수집 반복이 해소한다.

### 3. comma/sequence 반환 operand

`BinaryExpression`의 `CommaToken`을 명시적으로 처리하고 실제 표현식 결과인 오른쪽 operand만 taint 판정한다.

- `(cleanAlertTitle(alert.message), failure.message)`는 혼합 행 자체가 `raw_error_surface`가 되며 정확한 다음 행의 도메인 표현식만 allowlist occurrence를 소비한다.
- `(failure.message, "고정 문구")`는 실제 렌더 결과가 고정 문구이므로 false positive를 만들지 않는다.
- 기존 `&&`, `||`, `??`, `+` 처리와 덧셈/조건식/배열 exact finding, stale/overuse/direct raw 검사를 유지했다.
- 비교·관계·일반 boolean 연산자를 포괄적으로 taint하지 않았다.

## 변경 파일

- `scripts/i18n/scan-client-error-surfaces.mjs`
- `tests/apiErrorSurfaceWiring.test.mjs`
- `.superpowers/sdd/2026-08-15-global-i18n-web/task-6-fix-5-implementer-report.md`

root-scope exact sanitizer binding, exact-subject anchored allowlist, 웹 결제 `ApiError.code`, 기존 stale 테스트 파일은 변경하지 않았다.

## 검증

- focused 오류 표면: 45/45 통과
- `node scripts/i18n/scan-client-error-surfaces.mjs`: 통과
- `node scripts/i18n/build-catalogs.mjs`: 생성물 92개 생성
- `node scripts/i18n/validate-catalogs.mjs --check-generated`: 통과
- 전체 앱 `npm test`: 1,404/1,404 통과
- Worker 전체 `npm run test:worker`: 1,163/1,163 통과
- `npm run typecheck`: 통과
- `npm run typecheck:worker`: 통과
- `npm run build`: 통과, 2,223 modules, PWA precache 415개 중복 없음
- `git diff --check`: 통과

## 잔여 위험

- scanner는 TypeScript AST 기반 정적 게이트이며 런타임 reflection이나 동적 코드 생성까지 해석하는 완전한 interprocedural 분석기는 아니다.
- aggregate RHS와 object callable은 원소/메서드 단위가 아니라 컨테이너 단위로 taint한다. 일부 안전한 sibling까지 tainted가 될 수 있으나 오류 원문 비노출 게이트에서는 의도한 fail-safe 오탐 방향이다.
- callable return 분석은 각 함수의 직접 return만 귀속한다. 중첩 callable은 자신의 binding/object 분석에서 별도로 처리되며, 호출 그래프 전파는 fixed-point binding taint 범위에서 동작한다.
