# Task 6 오류 표면 scanner 구조 개선 구현 보고서

- 기준 커밋: `c8911eed10961ee14080ba095f72a774399877e6`
- 범위: scanner, scanner process fixture, 이 구현 보고서
- 배포·ADB·실기기·프로덕션 D1/Worker/Pages·시크릿·실결제: 수행하지 않음

## RED

구현 변경 전에 `tests/apiErrorSurfaceWiring.test.mjs`가 임시 저장소를 만들고 실제 scanner subprocess를 실행하도록 fixture를 추가했다. `raw_error_surface` stderr는 정규식으로 `{ path, line, snippet }` record로 파싱하고, positive fixture마다 전체 record 수와 `{ path, line }` 배열을 exact `deepEqual`한다.

첫 RED 명령은 `node --test tests/apiErrorSurfaceWiring.test.mjs`였고 56개 중 45개 통과, 11개 실패였다.

- `(view as { text: string }).text`, `(holder as Record<string, string>)["text"]`, `view!.text` assignment target 3개가 binding root를 찾지 못했다.
- parenthesized arrow/function IIFE와 as/non-null wrapper IIFE 4개가 실제 raw 반환값을 전파하지 못했다.
- `return <p>{(text = failure.message)}</p>`와 `show(text = failure.message)` 2개가 RHS를 실제 표시 결과로 판정하지 못했다.
- raw 값을 반환하는 중첩 함수 객체를 반환한 뒤 `makeReader().name`을 표시하는 안전 fixture 1개를 raw 값으로 오인했다.
- 바깥 callable이 중첩 IIFE의 실제 raw 결과를 직접 반환하는 fixture 1개를 놓쳤다.

compound assignment도 별도 TDD 주기로 고정했다. 해당 의미 처리를 제거한 상태에서 focused test는 61개 중 57개 통과, 4개 실패였다. 실패는 `+=`, `&&=`, `||=`, `??=` 표현식 결과의 직접 표시였다. 같은 RED에서 비교식과 `-=` 산술 결과가 raw 문자열로 broad-taint되지 않는 안전 fixture는 통과했다.

## 근본 원인과 설계

기존 `Set<Binding>` boolean taint는 사용자에게 지금 표시되는 raw 값과 호출 가능한 함수 객체를 구분하지 않았다. 함수 본문에 raw return이 있으면 함수 객체 자체까지 raw 값으로 만들었고, 반대로 wrapper 안의 callable을 실제 호출했을 때는 callee 의미를 해석하지 못했다. assignment target은 access chain과 wrapper를 서로 다른 순서 의존 helper로 벗겼으며, binary expression은 `=`이 RHS 값을 반환한다는 의미가 없었다.

이를 다음 공용 의미 모델로 교체했다.

- abstract value는 `displayRaw`와 `callables: Set<FunctionLikeNode>`를 별도로 보유한다. 함수 객체 자체는 `displayRaw=false`이며 callable target만 가진다.
- 함수 선언·함수식·화살표 함수·object method는 모두 callable target으로 표현한다. 호출할 때만 `callableReturnExpressions`가 해당 callable의 직접 return을 평가한다.
- 중첩 callable 선언의 return은 바깥 callable에 귀속하지 않는다. 다만 중첩 callable을 IIFE로 호출하면 callee target의 직접 return abstract value를 호출 결과에 합친다.
- parenthesized/as/type assertion/non-null/satisfies/await wrapper는 `transparentExpression` 한 곳에서 처리한다. 동일 규칙이 IIFE callee와 assignment root에 적용된다.
- 함수가 함수 객체를 반환하면 호출 결과는 callable target만 가지므로 `.name` 표시는 안전하다. 그 반환 함수를 다시 호출할 때에만 내부 raw return이 표시 taint가 된다.
- binding fixed point는 raw 값과 callable target 집합을 각각 병합한다. lexical binding identity와 exact imported/local sanitizer 판정은 기존대로 유지한다.
- `accessChainRoot`는 property/element access와 transparent wrapper를 순서와 무관하게 반복해서 벗긴다. 기존 array/object/default/nested/spread-rest 수집과 object property key 비오인은 유지한다.
- 단순 `=`과 comma는 실제 결과인 RHS만 평가한다. `+=`는 문자열 결합 가능성, `&&=`·`||=`·`??=`는 양쪽 실제 반환 가능성을 반영한다. 비교와 기타 산술 assignment는 raw 문자열로 확대하지 않는다.
- allowlist subject 전체 anchor, occurrence 소비, stale/overuse 검사는 변경하지 않았다. 새 sanitizer나 allowlist도 추가하지 않았다.

## GREEN 검증

- `node --test tests/apiErrorSurfaceWiring.test.mjs`: 61/61 통과
- `node scripts/i18n/scan-client-error-surfaces.mjs`: 통과
- `node scripts/i18n/build-catalogs.mjs`: 생성물 92개 생성, tracked diff 없음
- `node scripts/i18n/validate-catalogs.mjs --check-generated`: 통과
- `npm test`: 1,420/1,420 통과(기존 1,404개 + 신규 scanner fixture 16개)
- `npm run test:worker`: 1,163/1,163 통과
- `npm run typecheck`: 통과
- `npm run typecheck:worker`: 통과
- `npm run build`: 통과, 2,223 modules, PWA precache 415개 중복 없음
- `git diff --check`: 통과

## 잔여 위험

- scanner는 TypeScript AST 기반 정적 게이트이며 런타임 reflection, 동적 코드 생성, 외부 함수 구현까지 해석하는 완전한 interprocedural 분석기는 아니다.
- object/array container는 member 단위가 아니라 포함된 raw 값과 callable target의 합집합을 보존한다. 안전한 sibling까지 보수적으로 전파될 수 있지만 false negative보다 false positive를 택한 기존 오류 비노출 정책과 일치한다.
- 알 수 없는 일반 함수에 raw 인수를 전달하면 반환값도 raw로 보는 기존 보수적 정책을 유지한다. 원문을 안전 문구로 바꾸는 함수는 계속 exact 승인 binding으로만 해제해야 한다.
- recursive callable 순환은 현재 평가 중인 callable target에서 끊는다. 직접 base return과 비순환 호출 경로는 fixed point와 return 평가로 계속 검출한다.

## 수정 라운드 1

### RED

독립 리뷰의 유일한 Important를 실제 scanner subprocess fixture로 재현했다.

- 명령: `node --test tests/apiErrorSurfaceWiring.test.mjs`
- 결과: 68개 중 63개 통과, 5개 실패
- false negative: `invoke(reader) { return reader(); }`에 raw-return arrow를 전달한 직접 표시
- false negative: `pass(reader) { return reader; }`가 반환한 callable의 연속 호출
- false negative: default/rest/destructured parameter로 전달한 callable 호출
- false negative: `setText(() => failure.message)` functional updater 뒤 state 렌더
- false positive: `makeReader(failure.message).name` 함수 객체 이름 표시

`makeReader(failure.message)()` 직접 호출과 변수 저장 후 호출 fixture는 RED에서 이미 통과했지만, 이는 closure 값을 보존해서가 아니라 tracked 함수의 raw 인자를 호출 결과에 무조건 합치던 잘못된 휴리스틱 덕분이었다. 수정 뒤 같은 fixture가 captured environment 기반으로 계속 통과해야 하는 회귀 항목으로 유지했다.

### 설계

- callable abstract value의 `Set<FunctionLikeNode>`를 안정적으로 intern된 callable descriptor 집합으로 바꿨다. descriptor identity는 callable AST node와 invocation origin AST node 조합으로 고정하므로 fixed point 반복마다 새 identity를 만들지 않는다.
- descriptor는 호출별 `capturedValues` 환경을 가진다. 같은 call-site에서 분석 정보가 늘면 단조 병합하고 analysis revision을 올려 fixed point를 다시 순회한다.
- tracked callable 호출은 인자 abstract value를 parameter binding에 연결한 local environment를 만든 뒤 직접 return을 평가한다. 이 환경은 전역 `bindingValues`에 쓰지 않는다.
- default parameter는 인자와 initializer를 보수적으로 병합한다. rest는 남은 인자를 합치고, destructured parameter는 `bindingIdentifiers(parameter.name)`으로 실제 binding만 합쳐 property key를 binding으로 오인하지 않는다.
- callable return이 새 arrow/function/method이면 현재 local environment를 descriptor에 캡처한다. 따라서 raw 값을 캡처한 함수 객체의 `.name`은 안전하지만, 그 함수를 실제 호출하면 raw 반환을 검출한다.
- tracked callable은 raw 인자 자체를 결과 raw로 강제하지 않는다. callable의 실제 return abstract value만 사용한다. callable target이 없는 일반 함수에는 기존 raw-argument 보수 정책을 유지한다.
- recursive 경계는 descriptor가 아니라 callable AST node 기준 `activeCallables`로 차단해 서로 다른 call-site descriptor를 통한 재귀 우회를 막는다.
- React state setter의 함수 인자는 이전 state abstract value를 인자로 넣어 updater를 호출하고, updater의 실제 반환값을 state binding에 반영한다. 함수 객체 자체를 state raw 값으로 합치지 않는다.
- raw factory와 safe factory를 서로 다른 call-site에서 평가하는 안전 fixture를 추가해 captured environment가 전역 또는 다른 call-site로 오염되지 않음을 고정했다.

### GREEN 검증

- `node --test tests/apiErrorSurfaceWiring.test.mjs`: 69/69 통과
- `node scripts/i18n/scan-client-error-surfaces.mjs`: 통과
- `node scripts/i18n/build-catalogs.mjs`: 생성물 92개 생성, tracked diff 없음
- `node scripts/i18n/validate-catalogs.mjs --check-generated`: 통과
- `npm test`: 1,428/1,428 통과
- `npm run test:worker`: 1,163/1,163 통과
- `npm run typecheck`: 통과
- `npm run typecheck:worker`: 통과
- `npm run build`: 통과, 2,223 modules, PWA precache 415개 중복 없음
- `git diff --check`: 통과

### 잔여 위험

- descriptor는 call-site별로 분리하지만 같은 AST call-site가 반복 실행되는 런타임 값들은 하나의 단조 환경으로 합친다. 정적 게이트의 유한 수렴을 위한 보수적 선택이며 오탐 방향으로만 넓어진다.
- destructured parameter는 property별 정밀 추적 대신 전달 aggregate를 모든 실제 binding에 합친다. property key는 제외하지만 안전한 sibling binding이 함께 taint될 수 있다.
- 외부 구현을 알 수 없는 일반 함수가 callable 인자를 내부에서 호출하는지까지 추론하지 않는다. 기존과 같이 raw 값 인자만 보수적으로 반환 taint 처리하며, 저장소 안 tracked callable의 parameter·closure 흐름은 이번 라운드에서 직접 해석한다.

## 수정 라운드 2

### RED

독립 재검토의 새 Important 2건을 실제 scanner subprocess로 먼저 재현했다.

- 최초 명령: `node --test tests/apiErrorSurfaceWiring.test.mjs`
- 최초 결과: 75개 중 70개 통과, 5개 실패
- callable local binding: `identity(value)`의 `const result = value` alias 반환 누락
- callable local fixed point: parameter assignment → local alias chain → object destructuring 반환 누락
- returned local closure: `const reader = () => value; return reader`의 direct/stored 호출 2개 누락
- tracked+untracked 혼합: imported formatter alias와 safe tracked arrow의 조건식 callee가 raw 인자 보수 정책을 잃음

인접 untracked-only 경계도 별도 RED로 확인했다.

- 미요약 component parameter `formatter(failure.message)`: 76개 중 75개 통과, 1개 실패
- imported `createFormatter()`가 반환한 값을 저장한 뒤 `formatter(failure.message)`: 77개 중 76개 통과, 1개 실패

tracked-only 함수가 raw 인자를 무시하고 안전 상수를 반환하는 fixture는 모든 RED에서 status 0을 유지했다.

### 설계

- callable body의 직접 `VariableDeclaration`과 simple assignment를 invocation-local environment에서 단조 fixed point로 평가하는 `propagateCallableEnvironment`를 추가했다.
- local 순회는 다른 function/arrow/method node에서 중단해 중첩 callable body의 local 선언을 바깥 호출 환경에 합치지 않는다. 분기들은 보수적으로 합류하고 선언 순서와 관계없이 수렴할 때까지 반복한다.
- global binding 수집과 call-local 수집이 같은 `propagateVariableDeclaration` 의미를 사용한다. identifier/array/object/destructured binding은 실제 binding identifier만 갱신하고 property key는 제외한다.
- call-local 값은 descriptor parameter/captured environment에서 시작하며 전역 `bindingValues`에 쓰지 않는다. parameter/local assignment와 alias chain은 local map에만 단조 병합된다.
- local arrow/function/method descriptor는 현재 invocation origin과 갱신된 local/parameter environment를 캡처한다. 따라서 local binding으로 반환된 closure도 direct/stored 호출에서 raw 값을 보존한다.
- abstract value에 `mayUntrackedCallable`을 추가했다. import·namespace import·외부 unresolved identifier·미요약 parameter·initializer 없는 variable을 명시적 untracked 후보로 나타내고 alias/조건식/배열·객체 합류에서 OR로 보존한다.
- tracked-only 호출은 계속 직접 return만 따른다. `mayUntrackedCallable` 후보가 포함된 호출만 raw 인자에 기존 보수 정책을 적용한다.
- untracked 호출 결과도 다시 callable일 수 있으므로 `mayUntrackedCallable`을 다음 호출까지 보존한다. 이를 통해 외부 factory → local variable → raw 인자 호출 경로가 empty value로 사라지지 않는다.
- 일반 data 값은 `displayRaw`로 바꾸지 않는다. unknown callable 성분은 실제 call expression에서 raw 인자와 만날 때에만 사용자 표시 raw 결과가 된다.

### GREEN 검증

- `node --test tests/apiErrorSurfaceWiring.test.mjs`: 77/77 통과
- `node scripts/i18n/scan-client-error-surfaces.mjs`: 통과
- `node scripts/i18n/build-catalogs.mjs`: 생성물 92개 생성, tracked diff 없음
- `node scripts/i18n/validate-catalogs.mjs --check-generated`: 통과
- `npm test`: 1,436/1,436 통과
- `npm run test:worker`: 1,163/1,163 통과
- `npm run typecheck`: 통과
- `npm run typecheck:worker`: 통과
- `npm run build`: 통과, 2,223 modules, PWA precache 415개 중복 없음
- `git diff --check`: 통과

### 잔여 위험

- callable local 분석은 직접 variable declaration과 simple assignment를 보수적으로 합류한다. loop/branch 실행 조건이나 assignment overwrite를 경로별로 제거하지 않으므로 안전한 분기 값이 함께 taint될 수 있다.
- destructured local은 aggregate 값을 각 실제 binding에 합친다. property key는 제외하지만 field-sensitive 정밀도는 의도적으로 두지 않는다.
- untracked 호출은 외부 구현을 알 수 없어 결과도 callable일 가능성을 보존한다. 이 성분 자체는 사용자 표시 raw가 아니며, 이후 raw 인자를 받는 호출에서만 보수 finding을 만든다.
