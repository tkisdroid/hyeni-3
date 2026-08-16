# Task 6 오류 표면 스캐너 구조 개선 계획

## 승인과 기준

- 사용자 승인: 2026-08-16, 5회 breaker 이후 권장안 1번(추가 구조 개선)을 명시 선택.
- 코드 기준: `b998e4679841ac7a15b4b7ffb474dc576bd14923`.
- 목적: 후속 부모·아이·feature 문구 이관이 의존하는 repo-wide 오류 원문 비노출 게이트를 승인 가능한 상태로 복구한다.
- 범위: `scripts/i18n/scan-client-error-surfaces.mjs`, `tests/apiErrorSurfaceWiring.test.mjs`와 필요한 최소 보조 파일. 앱 화면·Worker 계약·결제 매핑·allowlist 범위는 변경하지 않는다.

## 구조적 문제

현재 boolean taint는 사용자에게 표시되는 값과 callable 객체·callable의 반환값을 섞어 해석한다. 그 결과 다음 경로가 남는다.

1. `(view as View).text`, `view!.text`, typed element access처럼 wrapper가 receiver에 붙은 assignment target의 root binding을 찾지 못한다.
2. 반환된 함수 객체는 raw 문자열이 아닌데도 tainted value로 오인하고, 반대로 parenthesized IIFE의 실제 raw 반환은 놓친다.
3. `text = failure.message` assignment expression은 실제 표현식 결과가 RHS인데 JSX/display sink finding이 되지 않는다.
4. positive fixture가 예상 raw finding의 정확한 행 집합과 개수를 고정하지 않는다.

## 구현 계약

### 1. 값과 호출 결과를 구분한다

- 함수 객체 자체를 사용자 표시 raw 값으로 취급하지 않는다.
- 함수 선언·함수식·화살표 함수·object method의 직접 반환 taint는 호출 결과에만 전파한다.
- parenthesized/as/non-null 등 wrapper 안의 callable과 IIFE도 같은 호출 결과 규칙을 사용한다.
- 중첩 callable의 return은 바깥 callable의 직접 반환으로 오인하지 않는다.
- 기존 exact imported/local sanitizer binding은 유지한다.

구현 방식은 bitmask, 별도 binding set, 작은 abstract value 등 자유지만 boolean 하나로 callable 객체와 반환값을 다시 합치지 않는다.

### 2. assignment target과 표현식 결과를 공용 의미로 처리한다

- access chain과 parenthesized/as/type-assertion/non-null wrapper를 순서와 무관하게 벗겨 root binding을 찾는다.
- array/object/default/nested/spread-rest/property-element target과 object property key 비오인을 유지한다.
- 단순 assignment expression의 결과는 RHS taint를 따른다. display되는 compound assignment는 실제 결과 의미에 맞게 명시 처리하고 무관한 boolean 비교까지 broad-taint하지 않는다.

### 3. allowlist 정확성을 유지한다

- finding AST subject 전체 일치, occurrence/stale/overuse 검사를 유지한다.
- broad sanitizer/allowlist를 추가하지 않는다.
- 기존 Arrival/Danger 도메인 데이터 예외와 `ApiError.code` 기반 웹 결제 매핑을 변경하지 않는다.

## RED fixture

실제 임시 저장소에서 scanner process를 실행하여 다음을 먼저 실패시킨다.

- wrapped property target: `(view as { text: string }).text`
- wrapped element target: `(holder as Record<string, string>)["text"]`
- non-null receiver target: `view!.text`
- 함수 객체 반환의 안전한 `.name` 표시
- parenthesized arrow/function IIFE의 raw 반환 표시
- `return <p>{(text = failure.message)}</p>`
- `show(text = failure.message)`
- raw finding record를 구조화해 예상 행 배열 및 전체 개수 `deepEqual`

동등 AST wrapper·call 형태를 공용 helper가 처리한다는 회귀도 필요한 만큼 추가한다.

## 검증

```powershell
node --test tests/apiErrorSurfaceWiring.test.mjs
node scripts/i18n/scan-client-error-surfaces.mjs
node scripts/i18n/build-catalogs.mjs
node scripts/i18n/validate-catalogs.mjs --check-generated
npm test
npm run test:worker
npm run typecheck
npm run typecheck:worker
npm run build
git diff --check
```

완료 기준은 focused·전체 회귀·카탈로그·타입 검사·프로덕션 빌드 통과, clean worktree, 새 독립 리뷰 `Approved`다.

## 안전 경계

- 배포, ADB, 실기기, 프로덕션 D1/Worker/Pages, 시크릿, 실결제 접근 금지.
- 테스트 삭제·완화, raw 오류 allowlist 추가, 사용자 문구/세션/결제 상태 변경 금지.
- 한 개의 한국어 구현 커밋과 구현 보고서를 남긴다.
