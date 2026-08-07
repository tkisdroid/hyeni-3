# 오늘 이동기록 시간 탐색과 지도 위치 가시성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부모가 오늘 이동기록의 시간 막대를 계속 움직이면서도 선택한 시각의 아이 마커를 패널에 가리지 않고 지도에서 즉시 확인하게 한다.

**Architecture:** 위치 이력의 시간 판정과 overlay rect 기반 지도 여백 계산을 순수 함수로 분리한다. 이동기록 패널은 시간 탐색 영역을 항상 유지하고 머문 곳 상세만 접으며, `KakaoMap`은 명시적 center에도 실제 viewport padding을 적용한다. `ParentLocation`은 DOM 실측값과 scrub 상태만 조정하고 API·Worker 계약은 바꾸지 않는다.

**Tech Stack:** React 19, TypeScript strict, Kakao Maps JavaScript SDK, 플레인 CSS 디자인 토큰, Node test runner, CDP 브라우저/A17 검증, Capacitor 8 Android

## Global Constraints

- 모든 응답·주석·커밋 메시지는 한국어로 작성한다.
- 부모 화면 문구는 존댓말을 유지한다.
- 위치 API, Worker, D1, 위치 수집 주기, 티어 판정은 변경하지 않는다.
- 선택 시각 이전에 실측점이 없으면 현재 위치를 과거 위치처럼 대체하지 않는다.
- range input은 첫 조작 뒤에도 화면과 포커스에 남고 44px 조작 영역과 `aria-valuetext="시각 · 위치"`를 유지한다.
- 머문 곳 상세의 자동 접힘은 선택 시각과 시간 막대를 숨기지 않는다.
- 지도 중심과 아이 마커 좌표는 분리하고, 명시적 center에도 실측 viewport padding을 적용한다.
- A17 `RFKL40DP73J` 부모 모드만 실기기 검증한다. `adb install -r`로 앱 데이터·세션을 보존한다.
- S25는 어떤 adb 접근도 하지 않고, razr도 이번 검증에서 접근하지 않는다.
- refresh 토큰은 읽거나 출력하거나 회전하지 않는다. SOS·소리 울리기·주변 소리는 실행하지 않는다.
- 앱 build에는 주 체크아웃 `.env`의 `VITE_*`만 프로세스 환경으로 주입하고 Cloudflare 자격값은 출력·복사하지 않는다.
- Pages 배포는 `.env`가 없는 임시 디렉터리에서 OAuth 자격으로 실행하며 Worker/D1은 배포하지 않는다.

---

### Task 1: 선택 시각과 지도 가시 영역 순수 계산

**Files:**
- Modify: `src/transform/locationHistoryScrub.ts`
- Modify: `src/transform/mapViewportPadding.ts`
- Test: `tests/locationHistoryScrub.test.ts`
- Test: `tests/mapViewportPadding.test.ts`

**Interfaces:**
- Consumes: 기존 `StayWindowLike`, `MapViewportPadding`, `normalizeMapViewportPadding`.
- Produces: `findStayIndexAtMs(stays, atMs): number | null`, `deriveHistoryMapViewportPadding(input): MapViewportPadding`, `getMapFocusPanOffset(padding): { x: number; y: number }`.

- [ ] **Step 1: 선택 시각 머문 곳 판정 실패 테스트를 작성한다**

`tests/locationHistoryScrub.test.ts`에 다음 테스트를 추가한다. 이 테스트가 막는 production break는 slider 시각이 머문 곳 안인데도 목록·지도 마커가 강조되지 않는 회귀다.

```ts
test("선택 시각이 포함된 머문 곳 인덱스를 경계까지 포함해 찾는다", () => {
  const stays = [
    { arrivalMs: 1_000, departureMs: 2_000 },
    { arrivalMs: 5_000, departureMs: 6_000 },
  ];

  assert.equal(findStayIndexAtMs(stays, 1_000), 0);
  assert.equal(findStayIndexAtMs(stays, 2_000), 0);
  assert.equal(findStayIndexAtMs(stays, 5_500), 1);
  assert.equal(findStayIndexAtMs(stays, 3_000), null);
});
```

- [ ] **Step 2: 테스트가 export 부재로 실패하는지 확인한다**

Run: `node --test tests/locationHistoryScrub.test.ts`

Expected: FAIL because `findStayIndexAtMs` is not exported.

- [ ] **Step 3: 머문 곳 판정을 한 함수로 구현하고 기존 라벨 계산이 재사용하게 한다**

`src/transform/locationHistoryScrub.ts`에 다음 함수를 추가하고 `resolveScrubWhereLabel`의 `findIndex`를 이 함수 호출로 바꾼다.

```ts
export function findStayIndexAtMs(stays: readonly StayWindowLike[], atMs: number): number | null {
  if (!Number.isFinite(atMs)) return null;
  const index = stays.findIndex((stay) => stay.arrivalMs <= atMs && atMs <= stay.departureMs);
  return index >= 0 ? index : null;
}
```

- [ ] **Step 4: 머문 곳 테스트가 통과하는지 확인한다**

Run: `node --test tests/locationHistoryScrub.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: overlay 실측 여백과 center 이동량 실패 테스트를 작성한다**

`tests/mapViewportPadding.test.ts`에 hand-derived A17 수치를 사용한다. 같은 production change가 실패하게 할 항목은 panel top을 무시하거나 padding 방향을 뒤집는 구현이다.

```ts
test("A17 세로 화면의 도구막대와 패널 사이를 지도 가시 영역으로 남긴다", () => {
  assert.deepEqual(
    deriveHistoryMapViewportPadding({
      viewportWidth: 384,
      viewportHeight: 832,
      toolbarRect: { top: 64, right: 368, bottom: 156, left: 16 },
      panelRect: { top: 313, right: 368, bottom: 696, left: 16 },
      wideLayout: false,
    }),
    { top: 172, right: 24, bottom: 535, left: 24 },
  );
});

test("가로 화면은 왼쪽 패널만 피하고 center 이동량을 padding 차이로 계산한다", () => {
  const padding = deriveHistoryMapViewportPadding({
    viewportWidth: 844,
    viewportHeight: 390,
    toolbarRect: { top: 64, right: 408, bottom: 120, left: 16 },
    panelRect: { top: 96, right: 408, bottom: 374, left: 16 },
    wideLayout: true,
  });
  assert.deepEqual(padding, { top: 24, right: 24, bottom: 24, left: 424 });
  assert.deepEqual(getMapFocusPanOffset(padding), { x: -200, y: 0 });
});
```

- [ ] **Step 6: 두 새 함수가 없어 실패하는지 확인한다**

Run: `node --test tests/mapViewportPadding.test.ts`

Expected: FAIL because `deriveHistoryMapViewportPadding` and `getMapFocusPanOffset` are not exported.

- [ ] **Step 7: viewport rect 타입과 계산을 최소 구현한다**

`src/transform/mapViewportPadding.ts`에 다음 계약을 추가한다. 모든 입력은 기존 `safePadding`과 같은 방식으로 유한값·0 이상으로 정규화한다.

```ts
export interface MapViewportRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface HistoryMapViewportInput {
  viewportWidth: number;
  viewportHeight: number;
  toolbarRect: MapViewportRect;
  panelRect: MapViewportRect;
  wideLayout: boolean;
}

export function deriveHistoryMapViewportPadding(input: HistoryMapViewportInput): MapViewportPadding {
  const minVisible = 96;
  const viewportWidth = safePadding(input.viewportWidth);
  const viewportHeight = safePadding(input.viewportHeight);
  if (input.wideLayout) {
    const right = 24;
    const left = Math.min(
      safePadding(input.panelRect.right + 16),
      Math.max(0, viewportWidth - minVisible - right),
    );
    return { top: 24, right, bottom: 24, left };
  }
  const top = Math.min(
    safePadding(input.toolbarRect.bottom + 16),
    Math.max(0, viewportHeight - minVisible - 24),
  );
  const bottom = Math.min(
    safePadding(viewportHeight - input.panelRect.top + 16),
    Math.max(0, viewportHeight - minVisible - top),
  );
  return { top, right: 24, bottom, left: 24 };
}

export function getMapFocusPanOffset(padding: Partial<MapViewportPadding> | undefined): { x: number; y: number } {
  const normalized = normalizeMapViewportPadding(padding);
  return {
    x: (normalized.right - normalized.left) / 2,
    y: (normalized.bottom - normalized.top) / 2,
  };
}
```

- [ ] **Step 8: 순수 계산 테스트를 모두 통과시킨다**

Run: `node --test tests/mapViewportPadding.test.ts tests/locationHistoryScrub.test.ts`

Expected: all tests PASS.

- [ ] **Step 9: 순수 계산 변경을 커밋한다**

```bash
git add src/transform/locationHistoryScrub.ts src/transform/mapViewportPadding.ts tests/locationHistoryScrub.test.ts tests/mapViewportPadding.test.ts
git commit -m "이동기록 시각과 지도 가시 영역을 계산한다"
```

### Task 2: 시간 막대를 남기는 컴팩트 이동기록 패널

**Files:**
- Modify: `src/screens/parent/LocationJourneyPanel.tsx`
- Modify: `src/screens/parent/ParentLocation.css`
- Modify: `tests/locationJourneyPanelContract.test.mjs`
- Modify: `scripts/final-browser-qa.mjs`

**Interfaces:**
- Consumes: 기존 `LocationJourneyPanelProps`, `JourneyContentState`.
- Produces: `expanded`가 `#location-journey-stays`만 제어하고 `.pl-journey__replay`는 접힌 상태에서도 유지되는 패널.

- [ ] **Step 1: 실제 브라우저 QA에 접힘 후 시간 막대 유지 조건을 먼저 추가한다**

`scripts/final-browser-qa.mjs`의 `parent-location-history-interaction` 계측을 다음 의미로 바꾼다.

```js
const locationHistoryCollapsed = await cdp.evaluate(`(() => {
  const range = document.querySelector(".pl-journey__range");
  const stays = document.querySelector("#location-journey-stays");
  const rect = range?.getBoundingClientRect();
  return {
    expanded: document.querySelector(".pl-journey__toggle")?.getAttribute("aria-expanded"),
    staysHidden: Boolean(stays?.hidden),
    replayVisible: Boolean(rect && rect.width > 0 && rect.height >= 44),
  };
})()`);
```

판정은 `expanded === "false"`, `staysHidden === true`, `replayVisible === true`를 모두 요구한다. 현재 구현은 body 전체를 `hidden` 처리하므로 `replayVisible`이 false가 되어야 한다.

- [ ] **Step 2: 현재 build로 브라우저 QA가 기대한 이유로 실패하는지 확인한다**

Run: `npm run build && node scripts/final-browser-qa.mjs`

Expected: FAIL/problem at `parent-location-history-interaction` because collapsed replay is not visible.

- [ ] **Step 3: source contract를 상세 영역 기준으로 수정한다**

`tests/locationJourneyPanelContract.test.mjs`는 `aria-controls="location-journey-stays"`, `id="location-journey-stays"`, 상세 영역의 `hidden={!expanded}`를 요구하고 `.pl-journey__body`의 `hidden`은 금지한다. 현재 구현에서 실패를 확인한다.

- [ ] **Step 4: 패널에서 시간 탐색과 머문 곳 상세을 분리한다**

`LocationJourneyPanel.tsx`의 헤더를 다음처럼 분리한다.

```tsx
const hasStayDetails = state === "ready";
const headerContent = (
  <>
    <span className="pl-journey__toggle-copy">
      <strong>{dayLabel} 이동 기록</strong>
      <span>{copy ?? recordedRangeLabel ?? `${stayCount}곳에 머물렀어요`}</span>
    </span>
    {hasStayDetails && (
      <ChevronDown className="pl-journey__toggle-icon" size={22} strokeWidth={2.3} aria-hidden="true" />
    )}
  </>
);

{hasStayDetails ? (
  <button
    type="button"
    className="pl-journey__toggle hy-press"
    aria-expanded={expanded}
    aria-controls="location-journey-stays"
    onClick={onToggleExpanded}
  >
    {headerContent}
  </button>
) : (
  <div className="pl-journey__header">{headerContent}</div>
)}
```

기존 body는 정확히 두 군데만 구조적으로 바꾼다. `.pl-journey__body`에서 `id="location-journey-panel-body"`와 `hidden={!expanded}`를 제거한다. 기존 `state === "ready"` 분기 안의 `.pl-journey__stays`에 `id="location-journey-stays"`와 `hidden={!expanded}`를 추가한다. 그 사이의 loading/error/status/skeleton/replay JSX와 머문 곳 제목·ordered timeline은 이동하거나 문구를 바꾸지 않는다.

- [ ] **Step 5: 컴팩트 상태 CSS를 적용한다**

`.pl-journey__header`에 `.pl-journey__toggle`과 같은 grid, padding, background, text 스타일을 주되 버튼/press 전환은 주지 않는다. `.pl-journey__body`의 `hidden` 전제를 제거하고, `.pl-journey__stays[hidden] { display: none; }`를 명시한다. `.pl-journey--expanded .pl-journey__toggle-icon` 회전은 유지한다.

- [ ] **Step 6: contract와 브라우저 QA를 통과시킨다**

Run: `node --test tests/locationJourneyPanelContract.test.mjs && npm run build && node scripts/final-browser-qa.mjs`

Expected: component contract PASS and browser QA `parent-location-history-interaction` has no problem.

- [ ] **Step 7: 패널 변경을 커밋한다**

```bash
git add src/screens/parent/LocationJourneyPanel.tsx src/screens/parent/ParentLocation.css tests/locationJourneyPanelContract.test.mjs scripts/final-browser-qa.mjs
git commit -m "시간 막대를 남기고 머문 곳 상세만 접는다"
```

### Task 3: 명시적 지도 중심의 panel-aware 포커스와 시간 배지

**Files:**
- Modify: `src/components/KakaoMap.tsx`
- Modify: `src/screens/parent/ParentLocation.tsx`
- Modify: `scripts/final-browser-qa.mjs`
- Modify: `tests/parentLocationScrubFocus.test.mjs`
- Test: `tests/mapViewportPadding.test.ts`

**Interfaces:**
- Consumes: `getMapFocusPanOffset(viewportPadding)`.
- Produces: `MapChild.caption?: string`, center/recenter/padding 변경 시 `setCenter` + 확대 보정 + `panBy`, `.km-child-marker__time` 시간 배지.

- [ ] **Step 1: 브라우저 Kakao stub에 panBy 경계 계측을 추가한다**

`scripts/final-browser-qa.mjs`의 Kakao `Map` stub을 다음처럼 확장하고 `Overlay.setMap`이 HTML content를 map element에 붙였다가 제거하게 한다.

```js
class Map {
  constructor(element, options = {}) {
    this.element = element;
    this.center = options.center || new LatLng(0, 0);
    this.level = options.level || 4;
    window.__hyQaMapPanCalls = [];
  }
  setCenter(center) { this.center = center; }
  getCenter() { return this.center; }
  setLevel(level) { this.level = level; }
  getLevel() { return this.level; }
  panBy(x, y) { window.__hyQaMapPanCalls.push({ x, y }); }
  setBounds() {}
  relayout() {}
}
class Overlay {
  constructor(options = {}) { Object.assign(this, options); }
  setMap(map) {
    window.__hyQaOverlayContents ||= [];
    window.__hyQaOverlayContents = window.__hyQaOverlayContents.filter((item) => item !== this.content);
    if (map && this.content instanceof HTMLElement) window.__hyQaOverlayContents.push(this.content);
  }
}
```

시간 이동 뒤 QA는 마지막 pan call의 `y > 0`, `window.__hyQaOverlayContents` 안 `.km-child-marker__time` 존재, 배지 문구가 선택 시각과 일치함을 요구한다.

- [ ] **Step 2: 현재 KakaoMap이 panBy와 시간 배지를 만들지 않아 브라우저 QA가 실패하는지 확인한다**

Run: `npm run build && node scripts/final-browser-qa.mjs`

Expected: FAIL/problem at `parent-location-history-interaction` because pan calls and time badge are missing.

- [ ] **Step 3: MapChild와 focus key 계약을 추가한다**

`KakaoMap.tsx`의 child 타입에 `caption?: string`을 추가한다. `fitPaddingKey`와 `lastFitPaddingRef`를 둔다.

```ts
const fitPaddingKey = `${fitPadding.top}:${fitPadding.right}:${fitPadding.bottom}:${fitPadding.left}`;
const lastFitPaddingRef = useRef("");
```

명시적 center가 있고 center/recenter/padding 중 하나라도 바뀌면 `setCenter(centerLatLng)`, 기존 level 보정, 다음 pan을 순서대로 적용한다.

```ts
const pan = getMapFocusPanOffset(fitPadding);
if ((pan.x !== 0 || pan.y !== 0) && typeof mapRef.current.panBy === "function") {
  mapRef.current.panBy(pan.x, pan.y);
}
lastFitPaddingRef.current = fitPaddingKey;
```

새 지도 생성 시 명시적 center가 있으면 같은 보정을 1회 적용한다. padding만 바뀌어도 같은 좌표를 다시 `setCenter`한 뒤 보정하여 누적 drift를 막는다.

- [ ] **Step 4: 아이 마커를 머문 곳보다 위에 두고 선택 시각 배지를 렌더한다**

기존 overflow-hidden 원형을 outer wrapper와 avatar frame으로 분리한다.

```ts
const content = document.createElement("div");
content.className = "km-child-marker";
const avatarFrame = document.createElement("div");
avatarFrame.className = "km-child-marker__avatar";
avatarFrame.append(avatarImage);
if (child.caption) {
  const timeBadge = document.createElement("span");
  timeBadge.className = "km-child-marker__time";
  timeBadge.textContent = child.caption;
  content.append(timeBadge);
}
content.append(avatarFrame);
```

기존 danger/normal border·shadow는 `avatarFrame`에 유지하고, outer wrapper는 세로 grid와 `pointer-events:none`을 사용한다. overlay z-index는 `child.caption ? 40 : 10`으로 설정한다.

- [ ] **Step 5: ParentLocation이 과거 시각 배지를 전달하게 한다**

`historyChildMarker`를 만드는 memo에서 `followsLatest`가 false일 때 `caption: formatClockHM(scrubMs)`를 추가한다. memo dependency에 `followsLatest`와 `scrubMs`를 포함한다. `tests/parentLocationScrubFocus.test.mjs`는 이 exact prop 파생을 요구한다.

- [ ] **Step 6: focused tests와 브라우저 QA를 통과시킨다**

Run: `node --test tests/mapViewportPadding.test.ts tests/parentLocationScrubFocus.test.mjs && npm run build && node scripts/final-browser-qa.mjs`

Expected: tests PASS; time movement records positive mobile y pan and renders the selected-time badge.

- [ ] **Step 7: 지도 포커스 변경을 커밋한다**

```bash
git add src/components/KakaoMap.tsx src/screens/parent/ParentLocation.tsx scripts/final-browser-qa.mjs tests/parentLocationScrubFocus.test.mjs tests/mapViewportPadding.test.ts
git commit -m "선택 시각 마커를 지도 가시 영역에 맞춘다"
```

### Task 4: ParentLocation DOM 실측과 scrub 상태 통합

**Files:**
- Create: `src/screens/parent/useHistoryMapViewportPadding.ts`
- Modify: `src/screens/parent/LocationHistoryToolbar.tsx`
- Modify: `src/screens/parent/LocationJourneyPanel.tsx`
- Modify: `src/screens/parent/ParentLocation.tsx`
- Modify: `tests/parentLocationScrubFocus.test.mjs`
- Modify: `tests/parentLocationSheetDrag.test.mjs`
- Modify: `scripts/final-browser-qa.mjs`

**Interfaces:**
- Consumes: `deriveHistoryMapViewportPadding`, `findStayIndexAtMs`, Task 2 panel, Task 3 `MapChild.caption`.
- Produces: `useHistoryMapViewportPadding({ enabled, wideLayout, toolbarRef, panelRef }): MapViewportPadding`와 완성된 이동기록 탐색 흐름.

- [ ] **Step 1: ParentLocation 통합 기대를 먼저 실패하도록 갱신한다**

`tests/parentLocationScrubFocus.test.mjs`가 다음 동작을 요구하게 한다.

```js
assert.match(move, /setHistoryPanelExpanded\(false\)/);
assert.match(screen, /const scrubStayIdx = findStayIndexAtMs/);
assert.match(screen, /const activeStayIdx = manuallySelectedStayIdx \?\? scrubStayIdx/);
assert.match(screen, /useHistoryMapViewportPadding\(\{/);
assert.doesNotMatch(screen, /bottom: historyPanelExpanded \? 392 : 112/);
```

`tests/parentLocationSheetDrag.test.mjs`는 `historyPanelExpanded`가 머문 곳 상세 상태이고 range input은 panel 밖으로 제거되지 않는 현재 component 계약을 확인한다.

- [ ] **Step 2: 새 통합 테스트가 현재 코드에서 실패하는지 확인한다**

Run: `node --test tests/parentLocationScrubFocus.test.mjs tests/parentLocationSheetDrag.test.mjs`

Expected: FAIL because no auto-collapse, measured hook, scrub stay highlight, or caption exists.

- [ ] **Step 3: toolbar와 panel root ref를 받을 수 있게 한다**

두 presentational component prop에 다음을 추가하고 각 root `<section>`의 `ref`에 연결한다.

```ts
import type { Ref } from "react";

containerRef?: Ref<HTMLElement>;
```

- [ ] **Step 4: 실측 hook을 구현한다**

`useHistoryMapViewportPadding.ts`는 `useLayoutEffect`에서 toolbar/panel rect와 `window.innerWidth/innerHeight`를 읽고 `deriveHistoryMapViewportPadding`을 호출한다. 두 element를 `ResizeObserver`로 관찰하고 window `resize`에도 같은 `measure` 함수를 연결한다. 새 padding이 이전 네 숫자와 같으면 state를 갱신하지 않는다. observer 미지원 시 최초 측정과 resize만 사용한다. cleanup은 observer disconnect와 event listener 제거를 모두 수행한다.

기본값은 세로 `{ top: 176, right: 24, bottom: 536, left: 24 }`, 가로 `{ top: 24, right: 24, bottom: 24, left: 424 }`이며 DOM 실측 직후 대체된다.

- [ ] **Step 5: ParentLocation scrub 상태를 통합한다**

다음 변경을 한 번에 적용한다.

```ts
const scrubStayIdx = scrubChildPoint
  ? findStayIndexAtMs(stayPoints, Math.min(scrubMs, scrubChildPoint.ms))
  : null;
const manuallySelectedStayIdx =
  selectedStayIdx != null && selectedStayIdx < visibleStayPoints.length ? selectedStayIdx : null;
const activeStayIdx = manuallySelectedStayIdx ?? scrubStayIdx;

const historyChildPoint = scrubChildPoint
  ?? (followsLatest && loc ? { lat: loc.lat, lng: loc.lng } : null);

const moveScrubTo = (rawValue: number) => {
  setScrubOffsetMinute(clampHistoryOffsetMinute(rawValue, historyMaxOffsetMinute));
  setSelectedStayIdx(null);
  setHistoryPanelExpanded(false);
  setScrubFocusKey((key) => key + 1);
};
```

toolbar/panel refs와 hook을 연결하고 고정 `historyMapPadding` memo를 제거한다. Task 3에서 추가한 `historyChildMarker.caption`은 유지하되, explicit scrub에 실측점이 없으면 `historyChildPoint` 자체가 null이어서 과거 마커가 생기지 않게 한다.

- [ ] **Step 6: 브라우저 QA에서 자동 접힘·강조·연속 조작을 확인한다**

첫 slider 이동 뒤 다음 사실을 한 계측으로 검사한다.

```js
{
  expanded: "false",
  staysHidden: true,
  replayVisible: true,
  rangeEnabled: true,
  followsLatest: "false",
  selectedStayCount: 1,
  selectedTimeBadge: selectedTime,
  panYPositive: true,
}
```

다른 값으로 range를 한 번 더 바꿔 `range.value`와 시간 문구가 다시 갱신되는지도 확인한다. `최신 위치` 클릭 뒤 `aria-pressed="true"`와 시간 배지 제거를 확인한다.

- [ ] **Step 7: focused integration, typecheck, 브라우저 QA를 통과시킨다**

Run:

```bash
node --test tests/locationHistoryScrub.test.ts tests/mapViewportPadding.test.ts tests/locationJourneyPanelContract.test.mjs tests/parentLocationScrubFocus.test.mjs tests/parentLocationSheetDrag.test.mjs tests/mobileViewportCss.test.mjs tests/locationRouteAccuracy.test.ts
npm run typecheck
npm run build
node scripts/final-browser-qa.mjs
```

Expected: all focused tests/typecheck/build PASS and browser report has 0 problems.

- [ ] **Step 8: 화면 통합을 커밋한다**

```bash
git add src/screens/parent/useHistoryMapViewportPadding.ts src/screens/parent/LocationHistoryToolbar.tsx src/screens/parent/LocationJourneyPanel.tsx src/screens/parent/ParentLocation.tsx tests/parentLocationScrubFocus.test.mjs tests/parentLocationSheetDrag.test.mjs scripts/final-browser-qa.mjs
git commit -m "시간 막대와 지도 위치를 동시에 확인하게 한다"
```

### Task 5: 정본 문서, 전체 회귀, A17, Pages 프로덕션

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Generated and ignored: `dist/`, Android debug APK, browser/PWA release evidence

**Interfaces:**
- Consumes: Tasks 1~4 완성 앱.
- Produces: 문서화된 운영 계약, A17 설치·실측 증거, 동일 dist의 Pages 프로덕션 배포.

- [ ] **Step 1: 정본 문서 두 곳에 새 회귀 규칙을 동기화한다**

기존 `시간대별 경로 조작 정본` 단락에 다음 의미를 추가한다.

```md
시간 막대를 움직이면 시간 탐색 카드는 유지하고 머문 곳 상세만 접는다. 명시적 지도 중심도 실제 toolbar/panel 실측 여백을 적용해 선택 시각 아이 마커를 가시 지도 영역에 두며, 해당 머문 곳과 지도 마커를 자동 강조한다. 선택 시각 이전에 기록이 없으면 현재 위치로 대체하지 않는다.
```

`CLAUDE.md`와 `AGENTS.md`의 문구·기기 제한이 서로 어긋나지 않는지 확인한다.

- [ ] **Step 2: 전체 앱 검증을 실행한다**

Run: `npm run verify`

Expected: typecheck, production build, route bundle/PWA checks exit 0 and every location-focused test PASS. 전체 app test의 현재 기준선 4건(`premiumUpsellWiring`, `releaseOperationsDocumentation`, `safeStoreUiCandidates`, `uiHarnessProcessSafety`)이 그대로 실패하면 새 실패가 0건인지 구분해 기록하며 이번 범위에서 무관한 테스트를 고치지 않는다.

- [ ] **Step 3: exact production dist 브라우저·PWA 검증을 실행한다**

Run:

```bash
node scripts/final-browser-qa.mjs
node scripts/pwa-runtime-qa.mjs
```

Expected: parent/child routes, 이동기록 상호작용, install/offline/safe update 모두 problems 0.

- [ ] **Step 4: VITE 값만 주입해 Android를 동기화·검증한다**

PowerShell에서 주 체크아웃 `.env`를 줄 단위로 읽고 이름이 정확히 `VITE_`로 시작하는 항목만 현재 프로세스 환경에 설정한다. 값을 출력하지 않는다. `VITE_KAKAO_APP_KEY`가 설정됐다는 boolean만 확인한 뒤 실행한다.

```powershell
npm run build
npx cap sync android
Push-Location android
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
Pop-Location
```

Expected: all commands exit 0.

- [ ] **Step 5: A17 인증서와 세션을 보존해 설치한다**

exact serial에 대해서만 설치 전 APK/설치본 signing certificate SHA-256이 `202d9a706d6ce591f1b1e4a43bbddb67c4c5a5c41c60ea29de8165cc624c5816`인지 확인한다. 일치할 때만 실행한다.

Run: `adb -s RFKL40DP73J install -r android/app/build/outputs/apk/debug/app-debug.apk`

Expected: `Success`; `firstInstallTime` 보존; local/server role `parent`; family id match. 토큰 원문은 출력하지 않는다.

- [ ] **Step 6: A17에서 시작·중간·끝 시각을 연속 검증한다**

CDP는 DOM/상태 조작에만 쓰고 실제 화면은 `adb -s RFKL40DP73J exec-out screencap -p` 프레임버퍼로 확인한다. 각 시각에서 다음을 계측한다.

```json
{
  "rangeVisible": true,
  "rangeHeightAtLeast44": true,
  "detailsCollapsed": true,
  "markerFullyBetweenToolbarAndPanel": true,
  "elementAboveMarkerIsMarker": true,
  "timeBadgeMatchesSelectedTime": true,
  "horizontalOverflow": 0
}
```

머문 곳 구간에서는 `selectedStayCount=1`; 이동 구간에서는 `currentWhere="이동 중"`; 첫 기록 전에는 `currentWhere="기록 없음"`이고 과거 마커가 없어야 한다. 최신 위치 복귀 후 badge가 없어지고 `aria-pressed=true`인지 확인한다. 검사 뒤 최신 위치·펼친 상세 상태로 복원한다.

- [ ] **Step 7: A17 crash/ANR를 검증 구간에 한해 확인한다**

`scripts/android-exit-info-summary.mjs`를 exact A17 serial/검증 시작시각으로 실행한다. Java crash 0, native crash 0, ANR 0을 요구한다. raw trace, 세션, 위치 원문은 저장하지 않는다.

- [ ] **Step 8: 코드·문서 변경을 커밋하고 push한다**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "오늘 이동기록 시간 탐색 정본을 갱신한다"
git diff --check
git status --short --branch
git push
```

Expected: worktree clean and upstream ahead count 0.

- [ ] **Step 9: 검증한 exact dist를 Pages 프로덕션에 배포한다**

`.env`가 없는 새 임시 디렉터리에서 실행한다.

```powershell
npx wrangler pages deploy C:/Users/TK/Desktop/hyeni-3/.worktrees/parent-location-history-redesign/dist --project-name=hyeni-calendar --branch=main --commit-dirty=true
```

배포 전 현재 production deployment `b5a80284-8a05-4637-bad1-9d4f368b94a1`을 rollback 기준으로 다시 확인하고, 배포 뒤 새 deployment id·fixed URL·`https://hyeni-calendar.pages.dev`를 기록한다. Worker/D1은 건드리지 않는다.

- [ ] **Step 10: 배포 산출물 일치를 확인하고 배포 이력을 커밋한다**

local `dist/index.html` SHA-256과 entry JS/CSS 파일명을 fixed URL·production alias에서 각각 비교한다. 두 URL 모두 HTTP 200, CSP, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, manifest, service worker, assetlinks 200을 확인한다. 실제 id/hash만 `CLAUDE.md`에 기록하고 다음으로 마친다.

```bash
git add CLAUDE.md
git commit -m "오늘 이동기록 수정 배포 이력을 기록한다"
git push
git status --short --branch
```

Expected: production alias가 exact local dist와 일치하고 worktree clean/upstream ahead 0.
