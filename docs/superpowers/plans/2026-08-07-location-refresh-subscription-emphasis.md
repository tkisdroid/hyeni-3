# 위치 요청 피드백·구독 카드 강조 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부모 위치 화면의 요청 안내가 아이 프로필을 가리지 않게 하고 부모 홈 구독 카드를 상태별로 더 눈에 띄게 만든다.

**Architecture:** 위치 요청 진행 상태는 별도 절대배치 오버레이 대신 기존 활성 아이 칩의 표현 상태로 합친다. 구독 카드는 순수 resolver가 상태별 CTA 문구를 반환하고 ParentHome이 같은 버튼 안에서 이를 렌더링하며 CSS `data-tone` 변형이 시각 강도를 결정한다.

**Tech Stack:** React 19, TypeScript strict, 플레인 CSS 디자인 토큰, Node test runner, Vite production build, Capacitor 8 Android

## Global Constraints

- 모든 응답·주석·커밋 메시지는 한국어로 작성한다.
- 부모 화면 문구는 존댓말을 사용한다.
- Free·reviewed는 `구독 시 혜택`, Premium은 `구독 관리`, 미확정·오류는 `구독 정보`를 유지한다.
- 위치 요청 API·215초 확인 창·2.5초 폴링·티어별 요청 횟수는 변경하지 않는다.
- A17 `RFKL40DP73J`만 `adb install -r`로 검증하고 razr·S25에는 접근하지 않는다.
- 실제 기기 찾기 벨·SOS·주변소리는 실행하지 않는다.

---

### Task 1: 위치 요청 안내를 아이 프로필 칩에 통합

**Files:**
- Modify: `tests/parentLocationUi.test.mjs`
- Modify: `src/screens/parent/ParentLocation.tsx`
- Modify: `src/screens/parent/ParentLocation.css`

**Interfaces:**
- Consumes: `isRefreshingLocation`, `refreshOverlayTitle`, 현재 `selected` child
- Produces: `.pl-chip[data-refreshing]`, `.pl-chip__status`, `.pl-chip__spinner`

- [ ] **Step 1: 실패 회귀 테스트 작성**

  아이 프로필 칩 안에 `role="status"` 상태가 렌더되고 독립 `.pl-refreshing` 오버레이가 제거되며 CSS가 칩 내부 레이아웃만 사용하는지 검증한다.

- [ ] **Step 2: RED 확인**

  Run: `node --test tests/parentLocationUi.test.mjs`
  Expected: 기존 `.pl-refreshing` 구조 때문에 새 계약 테스트가 실패한다.

- [ ] **Step 3: 최소 구현**

  `ParentLocation.tsx`의 독립 진행 오버레이를 삭제하고 활성 아이 칩에 `data-refreshing`, 이름/상태 스택, spinner를 추가한다. CSS는 칩 너비 제한·말줄임·spinner만 정의하고 절대배치 진행창 스타일을 제거한다.

- [ ] **Step 4: GREEN 확인**

  Run: `node --test tests/parentLocationUi.test.mjs`
  Expected: PASS

- [ ] **Step 5: 커밋**

  `git commit -m "위치 요청 안내가 아이 프로필을 가리지 않게 한다"`

### Task 2: 구독 카드 상태별 CTA와 강조 스타일 구현

**Files:**
- Modify: `tests/parentHomeSubscriptionCard.test.ts`
- Modify: `src/transform/parentHomeSubscriptionCard.ts`
- Modify: `src/screens/parent/ParentHome.tsx`
- Modify: `src/screens/parent/ParentHome.css`
- Modify: `tests/designSystemUsage.test.mjs`

**Interfaces:**
- Consumes: `ParentHomeSubscriptionCardInput`
- Produces: `ParentHomeSubscriptionCardView.actionLabel: "혜택 보기" | "관리하기" | "확인하기"`

- [ ] **Step 1: 실패 상태 테스트 작성**

  Free·Premium·미확정 결과에 각각 `혜택 보기`·`관리하기`·`확인하기`가 포함되고 강조 카드 CSS가 토큰 기반 배경·테두리·그림자를 사용하는지 검증한다.

- [ ] **Step 2: RED 확인**

  Run: `node --test --experimental-strip-types tests/parentHomeSubscriptionCard.test.ts`
  Expected: `actionLabel` 누락으로 실패한다.

- [ ] **Step 3: 최소 구현**

  resolver에 `actionLabel`을 추가하고 ParentHome 카드의 기존 chevron 자리에 상태별 CTA capsule을 렌더한다. `benefits`는 보라–분홍 강조, `manage`는 민트 강조, `neutral`은 중립 스타일을 적용한다.

- [ ] **Step 4: GREEN 및 디자인 가드 확인**

  Run: `node --test --experimental-strip-types tests/parentHomeSubscriptionCard.test.ts tests/designSystemUsage.test.mjs`
  Expected: PASS

- [ ] **Step 5: 커밋**

  `git commit -m "부모 홈 구독 카드를 더 선명하게 강조한다"`

### Task 3: 브라우저·빌드·A17 검증과 문서 동기화

**Files:**
- Modify: `scripts/final-browser-qa.mjs`
- Modify: `tests/finalBrowserQaHarness.test.mjs`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `.pl-chip[data-refreshing]`, `.ph-subscription__action`, `data-tone`
- Produces: 무료·Premium 구독 강조와 위치 요청 비가림을 확인한 QA 보고서

- [ ] **Step 1: 브라우저 QA 실패 계약 추가 후 RED 확인**

  격리 QA가 무료·Premium CTA와 구독 카드 시각 속성을 확인하고, 위치 요청 fixture에서 독립 오버레이 부재와 프로필 칩 내부 상태를 확인하도록 테스트를 먼저 추가한다.

- [ ] **Step 2: QA 하니스와 운영 문서 갱신**

  새 DOM 계약을 검사하고 두 문서에 위치 상태 통합·구독 강조 규칙을 같은 문구로 기록한다.

- [ ] **Step 3: 관련 검증**

  Run: `npm run typecheck`

  Run: `node --test --experimental-strip-types tests/parentLocationUi.test.mjs tests/parentHomeSubscriptionCard.test.ts tests/finalBrowserQaHarness.test.mjs`

  Run: `npm run build && npm run qa:browser`

- [ ] **Step 4: Android·A17 검증**

  `npx cap sync android` 후 Android `testDebugUnitTest lintDebug assembleDebug`를 실행한다. A17 서명을 확인하고 `adb -s RFKL40DP73J install -r ...`로 설치한 뒤 부모 역할·홈·위치 화면을 읽기 전용으로 검증한다.

- [ ] **Step 5: 문서·검증 커밋과 푸시**

  `git commit -m "위치 요청과 구독 강조 검증 계약을 기록한다"`

  `git push`
