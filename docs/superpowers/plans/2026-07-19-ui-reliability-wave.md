# UI Reliability Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 안전·로그인·다자녀·딥링크 화면이 실패 상태를 성공이나 빈 데이터로 위장하지 않고 역할에 맞는 복구 동선을 제공하게 한다.

**Architecture:** 순수 transform에서 상태·대상·fallback을 판정하고 React 화면은 query/mutation 상태를 입력해 결과만 렌더한다. 기존 API·DB 계약은 바꾸지 않으며 모든 행동 수정은 실패하는 회귀 테스트를 먼저 만든다.

**Tech Stack:** React 19, TypeScript strict, React Router 7, TanStack Query 5, Node test runner.

## Global Constraints

- 부모 문구는 존댓말, 아이 문구는 반말을 사용한다.
- 부모 세션에서 명시적 아이가 없으면 첫째나 전체 데이터로 폴백하지 않는다.
- 조회 실패를 `[]`, `0건`, `안전`, `가족 없음`으로 바꾸지 않는다.
- refresh 토큰, Worker API, D1 스키마를 변경하지 않는다.
- 테스트를 먼저 실패시킨 뒤 최소 구현을 적용한다.

---

### Task 1: 안심리포트 fail-closed 상태

**Files:**
- Modify: `src/transform/dailyReportView.ts`
- Modify: `src/screens/feature/DailySafetyReport.tsx`
- Modify: `src/screens/feature/DailySafetyReport.css`
- Test: `tests/dailyReportView.test.ts`
- Test: `tests/dailyReportReliability.test.mjs`

**Interfaces:**
- Consumes: `sourceState: "ready" | "loading" | "error"`.
- Produces: `DailyReportStatus = "safe" | "attention" | "danger" | "empty" | "unavailable"`.
- Invariant: `sourceState !== "ready"`이면 `safe`를 반환하지 않는다.

- [ ] **Step 1: 조회 실패가 안전으로 분류되지 않는 테스트를 추가한다.**

```ts
test("안전 데이터 조회 실패는 안전 상태로 표시하지 않는다", () => {
  const status = deriveDailyReportStatus({
    sourceState: "error",
    hasActiveChild: true,
    alerts: [],
    locationFreshness: "live",
    deviceSafetyLabel: "양호",
    deviceHasData: true,
  });
  assert.equal(status.status, "unavailable");
  assert.match(status.title, /확인하지 못했어요/);
});
```

- [ ] **Step 2: `node --test tests/dailyReportView.test.ts tests/dailyReportReliability.test.mjs`를 실행해 기존 status type과 화면 배선 때문에 실패함을 확인한다.**
- [ ] **Step 3: `deriveDailyReportStatus`에서 `error`를 `unavailable`, `loading`을 안전 판정 전 확인 상태로 처리한다.**
- [ ] **Step 4: `DailySafetyReport`가 alerts·위치·기기 query의 `isError`를 합쳐 오류 카드와 개별 `refetch()` 버튼을 렌더하고, 오류 중 수치·안전 문구를 숨기게 한다.**
- [ ] **Step 5: 같은 테스트와 `npm run typecheck`를 실행해 통과시킨다.**
- [ ] **Step 6: 변경 파일만 커밋한다.**

### Task 2: 주간 리포트와 가족 조회의 정직한 분기

**Files:**
- Create: `src/transform/queryTruthState.ts`
- Modify: `src/screens/feature/WeeklyFamilyReport.tsx`
- Modify: `src/screens/feature/WeeklyFamilyReport.css`
- Modify: `src/screens/onboarding/Onboarding.tsx`
- Modify: `src/screens/onboarding/Onboarding.css`
- Test: `tests/queryTruthState.test.ts`
- Test: `tests/reportAndOnboardingReliability.test.mjs`

**Interfaces:**
- Produces: `resolveQueryTruthState(states): "loading" | "error" | "ready"`.
- `routeAfterParentLogin`은 가족 응답이 `null`일 때만 connect로 이동하고 예외는 현재 login 단계의 재시도 오류로 남긴다.

- [ ] **Step 1: 하나라도 오류인 query 묶음은 `error`, 오류 없이 로딩이면 `loading`, 모두 성공이면 `ready`가 되는 테스트를 작성한다.**

```ts
test("오류를 빈 성공보다 우선한다", () => {
  assert.equal(resolveQueryTruthState([
    { isLoading: false, isError: false },
    { isLoading: false, isError: true },
  ]), "error");
});
```

- [ ] **Step 2: 화면 소스 계약 테스트에 `WeeklyFamilyReport`의 `isError`·`refetch`와 Onboarding의 catch 후 connect 금지를 추가하고 실패를 확인한다.**
- [ ] **Step 3: 주간 리포트는 `ready`일 때만 `summarizeWeeklyReport`를 노출하고 error 카드에서 네 query를 함께 재시도한다.**
- [ ] **Step 4: 부모 로그인 후 가족 조회가 실패하면 `가족 정보를 확인하지 못했어요. 다시 시도해 주세요.`를 표시하고 신규 가족 만들기 단계로 이동하지 않게 한다.**
- [ ] **Step 5: 관련 테스트와 typecheck를 실행하고 커밋한다.**

### Task 3: 준비물 대상 격리와 부모·아이 공용 길찾기

**Files:**
- Modify: `src/transform/dailySupplyScope.ts`
- Modify: `src/screens/feature/Supplies.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/screens/feature/RouteView.tsx`
- Modify: `src/screens/feature/RouteView.css`
- Test: `tests/dailySupplyChildScope.test.ts`
- Test: `tests/sharedRouteAccess.test.mjs`

**Interfaces:**
- `resolveDailySupplyChildMemberId(members, role, userId, hint)`를 Supplies의 유일한 대상 resolver로 사용한다.
- `/route`는 `RequireAnyRole roles={["parent", "child"]}` 아래에 둔다.
- `RouteView`는 `role`로 `isChild`, `homePath`, 존댓말/반말 문구를 결정한다.

- [ ] **Step 1: 부모의 대상 미확정·잘못된 hint가 `null`, 아이 본인만 본인 member id가 되는 기존 transform 테스트를 확장한다.**
- [ ] **Step 2: `Supplies.tsx`가 대상 없을 때 전체 배열을 반환하지 않고 mutation을 막는 소스 테스트를 추가해 실패를 확인한다.**
- [ ] **Step 3: Supplies에서 `targetChildId ? filter : []`를 적용하고 loading/error/no-target를 서로 다른 상태 카드로 렌더한다.**
- [ ] **Step 4: `/route`를 부모 전용 목록에서 제거하고 부모·아이 공용 가드에 추가하는 테스트를 먼저 실패시킨 뒤 라우트를 이동한다.**
- [ ] **Step 5: RouteView의 홈 fallback, 안내 문구, toast를 역할별로 분기하고 유효한 child member가 없으면 위치·일정 query 결과를 표시하지 않는다.**
- [ ] **Step 6: 관련 테스트와 typecheck를 실행하고 커밋한다.**

### Task 4: 딥링크 안전 뒤로가기와 역할별 말투

**Files:**
- Create: `src/app/safeBack.ts`
- Create: `src/app/useSafeBack.ts`
- Modify: `src/screens/feature/Notifications.tsx`
- Modify: `src/screens/feature/DangerAlert.tsx`
- Modify: `src/screens/feature/SosReceive.tsx`
- Modify: `src/screens/parent/ParentFamily.tsx`
- Modify: `src/screens/feature/PlaydateAccept.tsx`
- Modify: `src/screens/feature/FriendPlay.tsx`
- Test: `tests/safeBack.test.ts`
- Test: `tests/roleCopyAndNavigation.test.mjs`

**Interfaces:**
- `resolveSafeBackTarget({ historyIndex, explicitFallback, role }): { kind: "history" } | { kind: "route"; to: string }`.
- 허용 fallback은 현재 역할 홈과 화면이 선언한 동일 역할 route뿐이다.

- [ ] **Step 1: history index 1 이상은 history, cold start index 0은 부모·아이 홈을 반환하는 순수 테스트를 작성한다.**
- [ ] **Step 2: `useSafeBack`이 `window.history.state?.idx`와 `homePathForRole`을 사용하도록 구현한다.**
- [ ] **Step 3: 알림·위험·SOS와 ParentFamily의 뒤로가기를 helper로 연결하고 cold start 소스 계약 테스트를 통과시킨다.**
- [ ] **Step 4: PlaydateAccept는 아이 반말, FriendPlay의 부모 toast는 존댓말이 되도록 테스트를 먼저 추가한 뒤 문구를 수정한다.**
- [ ] **Step 5: 관련 테스트와 typecheck를 실행하고 커밋한다.**

### Task 5: 로그인 busy·폼 오류와 공통 접근성 상태

**Files:**
- Create: `src/transform/loginForm.ts`
- Create: `src/components/ui/BusyLabel.tsx`
- Create: `src/components/ui/BusyLabel.css`
- Modify: `src/screens/onboarding/Onboarding.tsx`
- Modify: `src/screens/onboarding/Onboarding.css`
- Modify: `src/components/ui/Loading.css`
- Modify: `src/styles/global.css`
- Modify: `src/screens/feature/DangerZoneForm.tsx`
- Test: `tests/loginForm.test.ts`
- Test: `tests/asyncAndFocusUx.test.mjs`

**Interfaces:**
- `validateLoginForm({ loginId, password }): { loginId?: string; password?: string }`.
- `BusyLabel` props: `{ busy: boolean; idle: string; pending: string }`; busy면 `aria-hidden` spinner와 진행 문구를 함께 표시한다.

- [ ] **Step 1: 공백 ID와 공백 비밀번호를 각각 필드 오류로 반환하는 순수 테스트를 작성하고 실패를 확인한다.**
- [ ] **Step 2: 로그인 input에 `aria-invalid`, 오류 설명 `aria-describedby`, submit 시 첫 오류 focus를 연결하고 유효하지 않으면 API를 호출하지 않는다.**
- [ ] **Step 3: ID 로그인·소셜 로그인·가입 확인 버튼에 `BusyLabel`을 연결해 문자열만 바뀌는 상태를 spinner+문구로 교체한다.**
- [ ] **Step 4: 전역 `:focus-visible` ring과 읽을 수 있는 Loading label을 추가하고 `DangerZoneForm` switch의 accessible name을 보이는 label과 연결한다.**
- [ ] **Step 5: 관련 테스트, 전체 Node 테스트, typecheck를 실행하고 커밋한다.**

