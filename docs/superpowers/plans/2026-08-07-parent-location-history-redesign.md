# Parent Location History Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부모가 아이의 선택 날짜 이동선, 선택 시각의 위치 상태, 머문 장소와 체류 시간을 한 화면에서 빠르게 연결해 이해하도록 오늘 경로 화면을 재구성한다.

**Architecture:** `ParentLocation`은 기존 쿼리·티어·활성 아이·선택 상태를 계속 소유하고, 순수 요약 계산은 `locationJourneyView.ts`, 표시 UI는 `LocationHistoryToolbar`와 `LocationJourneyPanel`로 분리한다. `KakaoMap`에는 정규화된 viewport padding 계약만 추가해 상단 도구막대와 하단/좌측 패널 아래로 경로가 가려지지 않게 한다.

**Tech Stack:** React 19, TypeScript strict, React Router v7 HashRouter, TanStack Query, Kakao Maps SDK, lucide-react, plain CSS design tokens, Node 24 native TypeScript tests.

## Global Constraints

- API, Worker, D1, 위치 티어, 오전 8시 기준 날짜 범위 계약은 변경하지 않는다.
- 활성 아이 우선순위를 유지하고 `children[0]` 폴백을 추가하지 않는다.
- 위치 원본 좌표를 새 저장소에 복제하거나 analytics 이벤트를 추가하지 않는다.
- 부모 문구는 존댓말을 사용한다.
- 모든 조작 요소는 최소 44px이고, range는 시각·장소 상태를 `aria-valuetext`로 전달한다.
- portrait에서는 하단 전체 폭 패널, 720px 이상 landscape에서는 왼쪽 392px 패널을 사용한다.
- A17 `RFKL40DP73J` 부모 세션은 보존하고 S25에는 접근하지 않는다.
- 기존 dirty worktree의 사용자 변경은 되돌리거나 커밋에 섞지 않는다.

## File Structure

- Create: `src/transform/locationJourneyView.ts` — 경로 범위와 패널 콘텐츠 상태를 계산하는 순수 함수.
- Create: `src/transform/mapViewportPadding.ts` — Kakao bounds padding을 유효한 정수로 정규화.
- Create: `src/screens/parent/LocationHistoryToolbar.tsx` — 활성 아이와 날짜 이동만 표시.
- Create: `src/screens/parent/LocationJourneyPanel.tsx` — 경로 요약, 시간 따라보기, 머문 곳 타임라인, 상태 화면.
- Modify: `src/components/KakaoMap.tsx` — `viewportPadding` prop과 padded `setBounds` 적용.
- Modify: `src/screens/parent/ParentLocation.tsx` — 기존 드래그 시트 제거, 새 컴포넌트와 상태 연결.
- Modify: `src/screens/parent/ParentLocation.css` — 오늘 경로 전용 레이아웃·반응형·접근성 스타일 교체.
- Create: `tests/locationJourneyView.test.ts` — 순수 요약·상태 회귀.
- Create: `tests/mapViewportPadding.test.ts` — padding 정규화 회귀.
- Create: `tests/locationJourneyPanelContract.test.mjs` — 컴포넌트 문구·접근성·상호작용 계약.
- Modify: `tests/parentLocationScrubFocus.test.mjs` — 슬라이더가 패널을 숨기지 않고 지도 중심만 바꾸는 계약.
- Modify: `tests/parentLocationSheetDrag.test.mjs` — 드래그 제거와 명시적 펼치기 계약.
- Modify: `tests/mobileViewportCss.test.mjs` — portrait/landscape 패널 배치 계약.
- Conditional Modify: `tests/designSystemUsage.test.mjs`, `tests/gradientTextContrast.test.mjs` — `npm run verify`가 삭제된 `.pl-stay*` selector를 가리킬 때만 해당 항목을 새 `.pl-journey*` selector로 교체한다.

---

### Task 1: 경로 요약과 패널 상태 순수 모델

**Files:**
- Create: `src/transform/locationJourneyView.ts`
- Create: `tests/locationJourneyView.test.ts`

**Interfaces:**
- Consumes: `readonly { ms: number }[]`, `isFetching`, `isError`, `stayCount`.
- Produces: `getJourneyRecordedRange(points): JourneyRecordedRange | null`.
- Produces: `resolveJourneyContentState(input): JourneyContentState` where state is `loading | error | empty | moving_only | ready`.

- [ ] **Step 1: Write the failing range and state tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  getJourneyRecordedRange,
  resolveJourneyContentState,
} from "../src/transform/locationJourneyView.ts";

test("경로 기록 범위는 유효 시각을 정렬해 첫 확인과 마지막 확인을 반환한다", () => {
  assert.deepEqual(
    getJourneyRecordedRange([{ ms: 30 }, { ms: Number.NaN }, { ms: 10 }, { ms: 20 }]),
    { startMs: 10, endMs: 30 },
  );
  assert.equal(getJourneyRecordedRange([]), null);
});

test("패널 상태는 오류·로딩·빈 기록·이동만·머문 곳 순서로 구분한다", () => {
  assert.equal(resolveJourneyContentState({ isFetching: false, isError: true, pointCount: 0, stayCount: 0 }), "error");
  assert.equal(resolveJourneyContentState({ isFetching: false, isError: true, pointCount: 4, stayCount: 1 }), "error");
  assert.equal(resolveJourneyContentState({ isFetching: true, isError: false, pointCount: 0, stayCount: 0 }), "loading");
  assert.equal(resolveJourneyContentState({ isFetching: false, isError: false, pointCount: 0, stayCount: 0 }), "empty");
  assert.equal(resolveJourneyContentState({ isFetching: false, isError: false, pointCount: 4, stayCount: 0 }), "moving_only");
  assert.equal(resolveJourneyContentState({ isFetching: true, isError: false, pointCount: 4, stayCount: 1 }), "ready");
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `node --test tests/locationJourneyView.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `locationJourneyView.ts`.

- [ ] **Step 3: Implement the minimal pure model**

```ts
export interface JourneyRecordedRange {
  startMs: number;
  endMs: number;
}

export type JourneyContentState = "loading" | "error" | "empty" | "moving_only" | "ready";

export function getJourneyRecordedRange(
  points: readonly { ms: number }[],
): JourneyRecordedRange | null {
  const times = points.map((point) => point.ms).filter(Number.isFinite).sort((a, b) => a - b);
  const startMs = times.at(0);
  const endMs = times.at(-1);
  return startMs == null || endMs == null ? null : { startMs, endMs };
}

export function resolveJourneyContentState(input: {
  isFetching: boolean;
  isError: boolean;
  pointCount: number;
  stayCount: number;
}): JourneyContentState {
  if (input.isError) return "error";
  if (input.isFetching && input.pointCount === 0) return "loading";
  if (input.pointCount === 0) return "empty";
  if (input.stayCount === 0) return "moving_only";
  return "ready";
}
```

- [ ] **Step 4: Run the focused test and typecheck**

Run: `node --test tests/locationJourneyView.test.ts && npm run typecheck`

Expected: both exit 0.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add src/transform/locationJourneyView.ts tests/locationJourneyView.test.ts
git commit -m "오늘 경로 표시 상태를 순수 모델로 분리한다"
```

### Task 2: 지도 bounds padding 계약

**Files:**
- Create: `src/transform/mapViewportPadding.ts`
- Create: `tests/mapViewportPadding.test.ts`
- Modify: `src/components/KakaoMap.tsx`

**Interfaces:**
- Produces: `MapViewportPadding { top; right; bottom; left }`.
- Produces: `normalizeMapViewportPadding(value): MapViewportPadding`.
- `KakaoMap` accepts `viewportPadding?: Partial<MapViewportPadding>` and applies it only to automatic bounds.

- [ ] **Step 1: Write failing padding normalization tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMapViewportPadding } from "../src/transform/mapViewportPadding.ts";

test("지도 padding은 음수·NaN을 0으로 낮추고 정수로 반올림한다", () => {
  assert.deepEqual(
    normalizeMapViewportPadding({ top: 120.4, right: -2, bottom: Number.NaN, left: 24.8 }),
    { top: 120, right: 0, bottom: 0, left: 25 },
  );
  assert.deepEqual(normalizeMapViewportPadding(undefined), { top: 0, right: 0, bottom: 0, left: 0 });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `node --test tests/mapViewportPadding.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `mapViewportPadding.ts`.

- [ ] **Step 3: Implement padding normalization**

```ts
export interface MapViewportPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function safePadding(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function normalizeMapViewportPadding(
  value: Partial<MapViewportPadding> | undefined,
): MapViewportPadding {
  return {
    top: safePadding(value?.top),
    right: safePadding(value?.right),
    bottom: safePadding(value?.bottom),
    left: safePadding(value?.left),
  };
}
```

- [ ] **Step 4: Wire padded bounds into `KakaoMap`**

Add the prop and normalized value:

```tsx
import {
  normalizeMapViewportPadding,
  type MapViewportPadding,
} from "@/transform/mapViewportPadding";

// 기존 destructuring 인자 목록의 `recenterKey` 다음에 `viewportPadding`을 추가한다.
// 기존 inline prop type의 `recenterKey?: number` 다음에 아래 필드를 추가한다.
viewportPadding?: Partial<MapViewportPadding>;

// 컴포넌트 본문에서 effect보다 먼저 정규화한다.
  const fitPadding = normalizeMapViewportPadding(viewportPadding);
```

Replace each automatic `setBounds(bounds)` call with:

```ts
mapRef.current.setBounds(
  bounds,
  fitPadding.top,
  fitPadding.right,
  fitPadding.bottom,
  fitPadding.left,
);
```

Add `viewportPadding?.top`, `viewportPadding?.right`, `viewportPadding?.bottom`, and `viewportPadding?.left` to the map effect dependency list. Explicit `center` behavior and one-stay `setCenter` remain unchanged.

- [ ] **Step 5: Run focused map and route tests**

Run: `node --test tests/mapViewportPadding.test.ts tests/locationRouteAccuracy.test.ts tests/parentLocationScrubFocus.test.mjs && npm run typecheck`

Expected: all focused tests and typecheck exit 0.

- [ ] **Step 6: Commit only map padding files**

```bash
git add src/transform/mapViewportPadding.ts src/components/KakaoMap.tsx tests/mapViewportPadding.test.ts
git commit -m "오늘 경로가 패널에 가리지 않도록 지도 여백을 지원한다"
```

### Task 3: 날짜 도구막대와 이동 타임라인 패널

**Files:**
- Create: `src/screens/parent/LocationHistoryToolbar.tsx`
- Create: `src/screens/parent/LocationJourneyPanel.tsx`
- Create: `tests/locationJourneyPanelContract.test.mjs`

**Interfaces:**
- `LocationHistoryToolbarProps` receives already formatted child/date values and date callbacks.
- `LocationJourneyPanelProps` receives display-only labels, `JourneyContentState`, `StayTimelineItem[]`, slider values, and callbacks.
- Neither component imports queries, auth context, entitlement, or API clients.

- [ ] **Step 1: Write the failing component contract test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const toolbar = readFileSync(new URL("../src/screens/parent/LocationHistoryToolbar.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/screens/parent/LocationJourneyPanel.tsx", import.meta.url), "utf8");

test("경로 도구막대는 아이와 날짜를 한 그룹에서 명시한다", () => {
  assert.match(toolbar, /aria-label="이동 기록 날짜 선택"/);
  assert.match(toolbar, /childName/);
  assert.match(toolbar, /onPrevious/);
  assert.match(toolbar, /onNext/);
});

test("타임라인 패널은 드래그 없이 명시적으로 펼치고 모든 상태를 정직하게 표시한다", () => {
  assert.match(panel, /aria-expanded=\{expanded\}/);
  assert.match(panel, /aria-controls="location-journey-panel-body"/);
  assert.match(panel, /8분 이상 머문 것으로 확인된 장소가 없어요/);
  assert.match(panel, /이 날은 확인된 이동 기록이 없어요/);
  assert.match(panel, /role=\{state === "error" \? "alert" : "status"\}/);
  assert.match(panel, /aria-valuetext=\{`\$\{currentTimeLabel\} · \$\{currentWhere\}`\}/);
  assert.doesNotMatch(panel, /onPointer|onTouch|setPointerCapture/);
});
```

- [ ] **Step 2: Run the test and confirm both files are missing**

Run: `node --test tests/locationJourneyPanelContract.test.mjs`

Expected: FAIL with `ENOENT` for `LocationHistoryToolbar.tsx`.

- [ ] **Step 3: Implement the toolbar interface and markup**

```tsx
export interface LocationHistoryToolbarProps {
  childName: string;
  childAvatarSrc: string;
  dayLabel: string;
  dateValue: string;
  minDateValue: string;
  maxDateValue: string;
  premiumOpen: boolean;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onDateChange: (value: string) => void;
}
```

Render a `.pl-history-toolbar` containing `.pl-history-toolbar__child`, previous button, `type=date` input with `aria-label="이동 기록 날짜 선택"`, next button, and a visible `.pl-history-toolbar__day` label. Use `ChevronLeft`/`ChevronRight`, `hy-network-avatar`, and `hy-press`; all three controls must have the shared 44px control token.

- [ ] **Step 4: Implement the panel interface and state branches**

```tsx
import type { JourneyContentState } from "@/transform/locationJourneyView";

export interface StayTimelineItem {
  id: string;
  order: number;
  placeLabel: string;
  timeLabel: string;
  dwellLabel: string;
  selected: boolean;
}

export interface LocationJourneyPanelProps {
  childName: string;
  dayLabel: string;
  state: JourneyContentState;
  expanded: boolean;
  recordedRangeLabel: string | null;
  stayCount: number;
  currentTimeLabel: string;
  currentWhere: string;
  sliderMax: number;
  sliderValue: number;
  followsLatest: boolean;
  stays: readonly StayTimelineItem[];
  onToggleExpanded: () => void;
  onSliderChange: (value: number) => void;
  onFollowLatest: () => void;
  onSelectStay: (index: number) => void;
  onRetry: () => void;
}
```

The panel root is `.pl-journey`, the toggle button exposes `aria-expanded` and `aria-controls="location-journey-panel-body"`, and the body id matches. Render status content with this exact mapping:

```ts
const stateCopy = {
  loading: "이동 기록을 불러오는 중…",
  error: "이동 기록을 불러오지 못했어요",
  empty: "이 날은 확인된 이동 기록이 없어요",
  moving_only: "8분 이상 머문 것으로 확인된 장소가 없어요",
  ready: null,
} as const;
```

Render the body as `<div id="location-journey-panel-body" hidden={!expanded}>` so keyboard and screen-reader focus cannot enter the collapsed content. For `moving_only` and `ready`, keep the replay range visible. Render each stay as a `<button>` inside an ordered timeline with order marker, place, time, and dwell label. Unknown locations arrive from the parent as `확인되지 않은 장소`.

- [ ] **Step 5: Run the contract test and typecheck**

Run: `node --test tests/locationJourneyPanelContract.test.mjs && npm run typecheck`

Expected: both exit 0.

- [ ] **Step 6: Commit the presentational components**

```bash
git add src/screens/parent/LocationHistoryToolbar.tsx src/screens/parent/LocationJourneyPanel.tsx tests/locationJourneyPanelContract.test.mjs
git commit -m "오늘 경로 도구막대와 이동 타임라인을 구성한다"
```

### Task 4: ParentLocation 통합과 드래그 시트 제거

**Files:**
- Modify: `src/components/KakaoMap.tsx`
- Modify: `src/screens/parent/ParentLocation.tsx`
- Modify: `src/screens/parent/ParentLocation.css`
- Modify: `tests/parentLocationScrubFocus.test.mjs`
- Modify: `tests/parentLocationSheetDrag.test.mjs`
- Modify: `tests/mobileViewportCss.test.mjs`

**Interfaces:**
- Consumes Task 1 `getJourneyRecordedRange`, `resolveJourneyContentState`.
- Consumes Task 2 `MapViewportPadding` through `KakaoMap.viewportPadding`.
- Consumes Task 3 `LocationHistoryToolbar`, `LocationJourneyPanel`, `StayTimelineItem`.
- Produces the existing `#/parent/location?view=history` behavior without query/API changes.

- [ ] **Step 1: Replace old drag expectations with failing explicit-panel tests**

Update `tests/parentLocationSheetDrag.test.mjs` to assert:

```js
test("오늘 경로 패널은 드래그 없이 명시적 버튼으로 펼치고 접는다", () => {
  assert.match(source, /const \[historyPanelExpanded, setHistoryPanelExpanded\] = useState\(true\)/);
  assert.match(source, /onToggleExpanded=\{\(\) => setHistoryPanelExpanded\(\(value\) => !value\)\}/);
  assert.doesNotMatch(source, /setPointerCapture|STAYS_DRAG_|onStaysPointer|onStaysTouch/);
  assert.match(source, /<LocationJourneyPanel/);
});
```

Update the scrub test so `moveScrubTo` still clears selected stay and increments `scrubFocusKey`, but explicitly does not call `setHistoryPanelExpanded(false)`.

Update `tests/mobileViewportCss.test.mjs` to require:

```js
assert.match(css, /\.pl-journey\s*\{[^}]*left:\s*16px[^}]*right:\s*16px[^}]*bottom:/s);
assert.match(css, /@media\s*\(min-width:\s*720px\)[\s\S]*\.pl-journey\s*\{[^}]*width:\s*392px[^}]*left:\s*16px/s);
assert.match(css, /\.pl-journey__toggle\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
```

- [ ] **Step 2: Run the three tests and confirm they fail against the old sheet**

Run: `node --test tests/parentLocationSheetDrag.test.mjs tests/parentLocationScrubFocus.test.mjs tests/mobileViewportCss.test.mjs`

Expected: FAIL because `LocationJourneyPanel` and `.pl-journey` do not exist and drag handlers remain.

- [ ] **Step 3: Replace drag state and handlers in `ParentLocation`**

Remove `ReactMouseEvent`, `ReactPointerEvent`, `ReactTouchEvent`, all `STAYS_DRAG_*` constants, drag refs, and drag handlers. Add:

```tsx
const [historyPanelExpanded, setHistoryPanelExpanded] = useState(true);
const [historyWideLayout, setHistoryWideLayout] = useState(false);

useEffect(() => {
  const media = window.matchMedia("(min-width: 720px) and (orientation: landscape)");
  const sync = () => setHistoryWideLayout(media.matches);
  sync();
  media.addEventListener("change", sync);
  return () => media.removeEventListener("change", sync);
}, []);
```

On active child, view, or history day change, reset selected stay and set the panel expanded. Do not change expansion during 60-second polling or slider movement.

- [ ] **Step 4: Build the panel view model in `ParentLocation`**

```tsx
const journeyRange = useMemo(() => getJourneyRecordedRange(timedTrail), [timedTrail]);
const journeyState = resolveJourneyContentState({
  isFetching: historyFetching,
  isError: historyError,
  pointCount: timedTrail.length,
  stayCount: stayPoints.length,
});
const journeyRangeLabel = journeyRange
  ? `${formatClockHM(journeyRange.startMs)}–${formatClockHM(journeyRange.endMs)}`
  : null;
const journeyStayItems = visibleStayPoints.map((stay, index) => ({
  id: `${stay.arrivalMs}-${index}`,
  order: index + 1,
  placeLabel: stayLabels[index] ?? "확인되지 않은 장소",
  timeLabel: `${formatClockHM(stay.arrivalMs)}–${formatClockHM(stay.departureMs)}`,
  dwellLabel: formatDwell(stay.dwellMs),
  selected: index === activeStayIdx,
}));
```

Keep `resolveHistoryMapCenter` and `resolveScrubWhereLabel` unchanged.

- [ ] **Step 5: Add responsive map padding and render the new components**

```tsx
const historyMapPadding = useMemo(
  () => historyWideLayout
    ? { top: 76, right: 24, bottom: 24, left: historyPanelExpanded ? 424 : 112 }
    : { top: 176, right: 24, bottom: historyPanelExpanded ? 392 : 112, left: 24 },
  [historyPanelExpanded, historyWideLayout],
);
```

Pass `viewportPadding={historyMapPadding}` only to the history `KakaoMap`. Render `LocationHistoryToolbar` when history is active and `LocationJourneyPanel` whenever history is active and history access is allowed, including loading, error, empty, and zero-stay states. Remove the old floating `pl-histmsg` branch and old `.pl-history-day`, `.pl-scrub`, `.pl-stays`, and `.pl-stays-reopen` JSX.

- [ ] **Step 6: Replace history CSS with the new stable layout**

Before the CSS edit, align map stay markers with the timeline. Move `const rootStyle = getComputedStyle(document.documentElement)` above the route/stay branches and use:

```ts
const routeColor = rootStyle.getPropertyValue("--mint-500").trim();
const stayColor = rootStyle.getPropertyValue(s.active ? "--mint-600" : "--mint-400").trim();
const stayShadow = s.active ? "rgba(8,118,83,.44)" : "rgba(49,196,141,.34)";
```

Use `stayColor` for the marker background, `stayShadow` for its shadow, and `--mint-400` for the fallback stay-to-stay line. Keep `textContent` DOM construction and route line behavior unchanged.

Use these layout constraints:

```css
.pl-history-toolbar {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 64px);
  left: 16px;
  right: 16px;
  z-index: 24;
  min-height: var(--control-min-size);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-20);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: var(--shadow-floating);
}

.pl-journey {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  z-index: 46;
  max-height: min(46vh, 420px);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-24);
  background: var(--bg-card);
  box-shadow: var(--shadow-floating);
  overflow: hidden;
}

.pl-journey__toggle { min-height: var(--control-min-size); }
.pl-journey__body { overflow-y: auto; overscroll-behavior: contain; }
.pl-journey__timeline { position: relative; display: grid; gap: 8px; }
.pl-journey__stay--selected { border-color: var(--mint-500); background: var(--mint-soft); }
.pl-journey__summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 12px 16px; }
.pl-journey__title { font: var(--type-body-lg-weight) var(--type-body-lg)/var(--type-body-lg-line-height) var(--font-sans); color: var(--fg-primary); }
.pl-journey__meta { color: var(--fg-muted); font-size: var(--type-caption); line-height: var(--type-caption-line-height); }
.pl-journey__replay { margin: 0 16px 12px; padding: 12px; border-radius: var(--radius-16); background: var(--mint-soft); }
.pl-journey__range { width: 100%; min-height: var(--control-min-size); accent-color: var(--mint-600); }
.pl-journey__stay { width: 100%; min-height: 64px; padding: 10px 12px; border: 1px solid var(--line-soft); border-radius: var(--radius-16); background: var(--bg-card); text-align: left; }
.pl-journey__status { min-height: 112px; padding: 20px 16px; display: grid; place-items: center; color: var(--fg-muted); text-align: center; }
.pl-journey__retry { min-height: var(--control-min-size); padding: 0 16px; border-radius: var(--radius-12); background: var(--mint-600); color: #fff; }
.pl-journey :focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .pl-history-toolbar,
  .pl-journey,
  .pl-journey__stay { transition: none; animation: none; }
}

@media (min-width: 720px) and (orientation: landscape) {
  .pl-history-toolbar { width: 392px; right: auto; }
  .pl-journey { width: 392px; left: 16px; right: auto; bottom: 16px; max-height: calc(100% - 96px); }
}
```

Add a three-row skeleton using `.pl-journey__skeleton-row` with heights `18px`, `44px`, and `64px`, `border-radius: var(--radius-12)`, a `linear-gradient(90deg, var(--bg-page), var(--bg-card), var(--bg-page))` background, and the existing `km-shimmer 1.4s ease-in-out infinite` animation. Delete old drag cursor, collapsed transform, pointer-event, and reopen-pill rules.

- [ ] **Step 7: Run integration tests and typecheck**

Run: `node --test tests/locationJourneyView.test.ts tests/mapViewportPadding.test.ts tests/locationJourneyPanelContract.test.mjs tests/parentLocationSheetDrag.test.mjs tests/parentLocationScrubFocus.test.mjs tests/mobileViewportCss.test.mjs tests/locationHistoryScrub.test.ts tests/locationTierUxContract.test.mjs && npm run typecheck`

Expected: all focused tests and typecheck exit 0.

- [ ] **Step 8: Commit the integrated redesign**

```bash
git add src/components/KakaoMap.tsx src/screens/parent/ParentLocation.tsx src/screens/parent/ParentLocation.css tests/parentLocationSheetDrag.test.mjs tests/parentLocationScrubFocus.test.mjs tests/mobileViewportCss.test.mjs
git commit -m "부모 오늘 경로를 이동 타임라인 중심으로 재설계한다"
```

### Task 5: 전체 회귀와 A17 시각 검증

**Files:**
- Modify only if a gate identifies a real regression: `tests/designSystemUsage.test.mjs`, `tests/gradientTextContrast.test.mjs`
- No production data or settings mutations.

**Interfaces:**
- Consumes the completed `#/parent/location?view=history` route.
- Produces evidence for type, unit, build, responsive, runtime, and physical-device quality gates.

- [ ] **Step 1: Run all app verification gates**

Run: `npm run verify`

Expected: typecheck, all app tests, production build, bundle budget, and PWA duplicate checks all exit 0. If class inventory or contrast tests fail because old `.pl-stay*` selectors were removed, update only the exact inventory entries to the new `.pl-journey*` selectors and rerun `npm run verify`.

- [ ] **Step 2: Run Worker gates to prove no backend regression**

Run: `npm run typecheck:worker && npm run test:worker`

Expected: Worker typecheck and all Worker tests exit 0; no Worker files should have changed.

- [ ] **Step 3: Run isolated mobile WebKit visual smoke**

Run the existing privacy-safe mobile WebKit smoke against the current production build:

```bash
node scripts/privacy-safe-webkit-pwa-smoke.mjs
```

Expected: service worker controlled, 390px viewport horizontal overflow 0, console/page errors 0, external request attempts 0.

- [ ] **Step 4: Build and sync the Android app without replacing live data**

Run: `npm run build && npx cap sync android && android/gradlew assembleDebug testDebugUnitTest lintDebug`

Expected: all commands exit 0. Do not uninstall the live app. Install only with `adb -s RFKL40DP73J install -r <apk>` when the installed signing certificate matches the APK certificate; otherwise keep the installed app untouched and use the production PWA/WebView evidence.

- [ ] **Step 5: Verify A17 parent route twice**

For exact serial `RFKL40DP73J`, preserve role/session and run `scripts/final-a17-cdp-smoke.mjs` with:

```powershell
$env:EXPECTED_ROLE='parent'
$env:ROUTE_SCOPE='all'
$env:ROUTE_WAIT_MS='2500'
$env:ROUTE_SETTLE_TIMEOUT_MS='10000'
```

Expected for both runs: `hasSession=true`, local/server role `parent`, family match true, history map ready true, horizontal overflow 0, small controls 0, runtime errors 0. Record the separately known analytics fail-soft only when the response remains exactly `503 premium_funnel_unavailable configured:false`; do not treat another 4xx/5xx as equivalent.

- [ ] **Step 6: Check A17 crash/ANR only for the verification window**

Use exact serial and `dumpsys activity exit-info com.hyeni.calendar`; parse only `process=com.hyeni.calendar`, timestamp, and reason. Expected after the verification start: Java crash 0, native crash 0, ANR 0. Do not store raw dumpsys, descriptions, or traces.

- [ ] **Step 7: Commit any exact test inventory corrections separately**

If Step 1 required test inventory changes:

```bash
git add tests/designSystemUsage.test.mjs tests/gradientTextContrast.test.mjs
git commit -m "오늘 경로 디자인 토큰 회귀 기준을 갱신한다"
```

If neither file changed, skip this commit.

- [ ] **Step 8: Final scope audit**

Run:

```bash
git diff --check
git status --short
git diff --name-only HEAD~4..HEAD
```

Expected: no whitespace errors; only the planned source/test/docs files are part of this redesign; pre-existing staged deletions and unrelated artifact changes remain untouched.
