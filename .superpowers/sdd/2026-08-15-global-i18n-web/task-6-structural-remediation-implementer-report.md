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
