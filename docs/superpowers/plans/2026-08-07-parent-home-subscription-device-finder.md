# 부모 홈 구독·아이 기기 찾기 재배치 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부모 홈 바로가기에 아이 기기 찾기를 노출하고 구독을 이용 상태별 가로형 카드로 분리한다.

**Architecture:** 기존 `useEntitlement()`의 확정 상태만 입력으로 받는 순수 구독 카드 변환기를 추가한다. 부모 홈은 변환 결과를 표시하고, 바로가기 데이터는 구독을 아이 기기 찾기로 교체하며 활성 아이 `user_id`를 `/remote-ring` route state로 전달한다.

**Tech Stack:** React 19, TypeScript strict, 플레인 CSS 디자인 토큰, React Router v7 HashRouter, Node test runner

## Global Constraints

- 모든 앱 문구는 부모모드 존댓말을 사용한다.
- 엔타이틀먼트가 미확정·오류이면 Free로 추정하지 않는다.
- 바로가기 4×2 순서는 `AI 일정 → 위치추적 → 친구놀이 → 장소관리 → 주변소리 → 안심리포트 → 아이 기기 찾기 → 알림`이다.
- 구독 카드는 바로가기 아래에 가로형으로 배치하고 모든 상태에서 `/subscription`으로 이동한다.
- 아이 기기 찾기는 활성 아이 `user_id`를 명시하며 소리 울리기를 자동 발사하지 않는다.
- 기존 3D 에셋, CSS 토큰, 8/12/16/20/24px 반경, 최소 44px 조작 영역, `hy-press`를 유지한다.

---

### Task 1: 구독 카드 상태 변환기

**Files:**
- Create: `src/transform/parentHomeSubscriptionCard.ts`
- Create: `tests/parentHomeSubscriptionCard.test.ts`

**Interfaces:**
- Consumes: `ready`, `isError`, `isPremium`, `planLabel`, `isTrial`, `trialDaysLeft`, `periodEnd`
- Produces: `resolveParentHomeSubscriptionCard(input): { title: string; description: string; meta: string; tone: "benefits" | "manage" | "neutral" }`

- [ ] **Step 1: 실패하는 순수 테스트 작성**

```ts
test("무료 가족은 구독 혜택 카드로 안내한다", () => {
  assert.deepEqual(resolveParentHomeSubscriptionCard({
    ready: true,
    isError: false,
    isPremium: false,
    planLabel: "무료 플랜",
    isTrial: false,
    trialDaysLeft: null,
    periodEnd: null,
  }), {
    title: "구독 시 혜택",
    description: "실시간 위치와 더 넉넉한 가족 기능을 확인해 보세요",
    meta: "현재 무료 플랜",
    tone: "benefits",
  });
});

test("미확정 오류는 무료로 강등하지 않는다", () => {
  assert.equal(resolveParentHomeSubscriptionCard({
    ready: false,
    isError: true,
    isPremium: false,
    planLabel: null,
    isTrial: false,
    trialDaysLeft: null,
    periodEnd: null,
  }).title, "구독 정보");
});
```

- [ ] **Step 2: RED 확인**

Run: `node --test --experimental-strip-types tests/parentHomeSubscriptionCard.test.ts`

Expected: `ERR_MODULE_NOT_FOUND` 또는 `resolveParentHomeSubscriptionCard` 미정의로 FAIL

- [ ] **Step 3: 최소 구현 작성**

```ts
export function resolveParentHomeSubscriptionCard(
  input: ParentHomeSubscriptionCardInput,
): ParentHomeSubscriptionCardView {
  if (!input.ready) {
    return {
      title: "구독 정보",
      description: input.isError ? "이용 상태를 확인하지 못했어요" : "이용 상태를 확인하고 있어요",
      meta: "구독 화면에서 다시 확인할 수 있어요",
      tone: "neutral",
    };
  }
  if (!input.isPremium) {
    return {
      title: "구독 시 혜택",
      description: "실시간 위치와 더 넉넉한 가족 기능을 확인해 보세요",
      meta: "현재 무료 플랜",
      tone: "benefits",
    };
  }
  return {
    title: "구독 관리",
    description: input.planLabel || "프리미엄 구독",
    meta: premiumMeta(input),
    tone: "manage",
  };
}

function premiumMeta(input: ParentHomeSubscriptionCardInput): string {
  if (input.isTrial && input.trialDaysLeft !== null) {
    return input.trialDaysLeft > 0 ? `무료 체험 ${input.trialDaysLeft}일 남음` : "무료 체험 종료일";
  }
  if (input.periodEnd) {
    const date = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(input.periodEnd);
    return `${date}까지 이용`;
  }
  return "프리미엄 이용 중";
}
```

- [ ] **Step 4: GREEN 확인**

Run: `node --test --experimental-strip-types tests/parentHomeSubscriptionCard.test.ts`

Expected: Free, Premium, trial, unknown, error 테스트 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/transform/parentHomeSubscriptionCard.ts tests/parentHomeSubscriptionCard.test.ts
git commit -m "부모 홈 구독 카드 상태를 분리한다"
```

### Task 2: 부모 홈 바로가기와 가로형 구독 카드

**Files:**
- Modify: `src/data/mock.ts`
- Modify: `src/screens/parent/ParentHome.tsx`
- Modify: `src/screens/parent/ParentHome.css`
- Modify: `tests/menuNavigationConsistency.test.mjs`
- Create: `tests/parentHomeSubscriptionEntry.test.mjs`

**Interfaces:**
- Consumes: `resolveParentHomeSubscriptionCard(...)`, `activeChild?.user_id`, 기존 `shortcuts`
- Produces: `/remote-ring` 진입 route state와 `.ph-subscription` 가로 카드

- [ ] **Step 1: 실패하는 홈 계약 테스트 작성**

```js
assert.deepEqual(labels, ["AI 일정", "위치추적", "친구놀이", "장소관리", "주변소리", "안심리포트", "아이 기기 찾기", "알림"]);
assert.match(home, /navigate\("\/remote-ring", \{ state: \{ childUserId: activeChild\?\.user_id \?\? undefined \} \}\)/);
assert.match(home, /className="hy-card ph-subscription hy-press"/);
assert.match(home, /subscriptionCard\.title/);
assert.match(home, /navigate\("\/subscription"\)/);
```

- [ ] **Step 2: RED 확인**

Run: `node --test tests/menuNavigationConsistency.test.mjs tests/parentHomeSubscriptionEntry.test.mjs`

Expected: 기존 `구독` 바로가기와 구독 카드 부재 때문에 FAIL

- [ ] **Step 3: 최소 UI 구현**

```tsx
const subscriptionCard = resolveParentHomeSubscriptionCard({
  ready: entitlement.ready,
  isError: entitlement.isError,
  isPremium: entitlement.isPremium,
  planLabel: entitlement.view?.planLabel ?? null,
  isTrial: entitlement.view?.isTrial ?? false,
  trialDaysLeft: entitlement.view?.trialDaysLeft ?? null,
  periodEnd: entitlement.view?.periodEnd ?? null,
});

const openShortcut = (label: string) => {
  if (label === "아이 기기 찾기") {
    navigate("/remote-ring", { state: { childUserId: activeChild?.user_id ?? undefined } });
    return;
  }
  navigate(shortcutRoutes[label]);
};
```

가로 카드에는 `ui/menu-subscription.webp`, `subscriptionCard.title/description/meta`, chevron을 렌더하고 `data-tone={subscriptionCard.tone}`을 부여한다. CSS는 기존 `.ph-memo`의 수평 구조를 따르되 별도 `.ph-subscription*` 클래스로 카드 배경과 라벤더/민트 상태색을 토큰화한다.

- [ ] **Step 4: GREEN 및 관련 계약 확인**

Run: `node --test --experimental-strip-types tests/parentHomeSubscriptionCard.test.ts tests/menuNavigationConsistency.test.mjs tests/parentHomeSubscriptionEntry.test.mjs tests/parentHomeReportEntry.test.mjs tests/pressFeedbackCoverage.test.mjs tests/colorContrastAndRadius.test.mjs`

Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/data/mock.ts src/screens/parent/ParentHome.tsx src/screens/parent/ParentHome.css tests/menuNavigationConsistency.test.mjs tests/parentHomeSubscriptionEntry.test.mjs
git commit -m "부모 홈에 아이 기기 찾기와 구독 카드를 배치한다"
```

### Task 3: 운영 문서와 최종 검증

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: 확정된 부모 홈 UI 계약
- Produces: 다음 에이전트가 바로가기 순서와 구독 상태 문구를 되돌리지 않게 하는 정본 지침

- [ ] **Step 1: 두 정본 문서에 동일 계약 기록**

```md
- 부모 홈 바로가기는 `AI 일정 → 위치추적 → 친구놀이 → 장소관리 → 주변소리 → 안심리포트 → 아이 기기 찾기 → 알림` 순서다. 구독은 그리드 아래 가로 카드로 분리하고 Free는 `구독 시 혜택`, Premium은 `구독 관리`, 미확정·오류는 `구독 정보`로 표시해 Free로 추정하지 않는다.
```

- [ ] **Step 2: 타입·빌드·관련 테스트 실행**

Run: `npm run typecheck`

Run: `npm run build`

Run: `node --test --experimental-strip-types tests/parentHomeSubscriptionCard.test.ts tests/menuNavigationConsistency.test.mjs tests/parentHomeSubscriptionEntry.test.mjs tests/parentHomeReportEntry.test.mjs tests/pressFeedbackCoverage.test.mjs tests/colorContrastAndRadius.test.mjs`

Expected: 모두 exit 0

- [ ] **Step 3: 브라우저 부모 홈 검증**

모의 API 하니스에서 384×832 부모 홈을 열고 `아이 기기 찾기`와 상태별 구독 카드가 보이는지, 4×2 그리드·가로 오버플로·44px 조작 영역·콘솔 오류를 확인한다. 기기 찾기 클릭은 `/remote-ring` 진입과 대상 아이 표시까지만 확인하고 발사 버튼은 누르지 않는다.

- [ ] **Step 4: Android 빌드·A17 읽기 전용 검증**

주 체크아웃 `.env`의 `VITE_*`만 프로세스에 주입해 `npm run build`, `npx cap sync android`, `./gradlew assembleDebug`를 실행한다. 같은 서명을 확인하고 A17에 `adb -s RFKL40DP73J install -r ...`로 설치한 뒤 부모 세션·가족 일치, 홈 UI, 구독 문구, 기기 찾기 대상만 확인한다. 소리 울리기는 발사하지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add AGENTS.md CLAUDE.md
git commit -m "부모 홈 구독과 기기 찾기 계약을 기록한다"
```
