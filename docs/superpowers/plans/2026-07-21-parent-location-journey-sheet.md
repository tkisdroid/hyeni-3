# 부모 오늘 경로 여정 시트 구현 계획

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` while implementing each behavior and `superpowers:verification-before-completion` before claiming completion.

**Goal:** 부모가 오전 8시부터 현재까지의 경로를 한 개의 여정 시트에서 탐색하고, 특정 시각의 마지막 확인 위치와 오늘 머문 곳을 빠르고 정직하게 파악하게 한다.

**Architecture:** 원본 `LocationHistoryPoint[]`에서 시각 조회 결과를 계산하는 순수 변환 모듈을 추가한다. `ParentLocation`은 이 결과를 지도 아바타·위치 설명·활성 머문 곳에 연결하고, 기존 상단 시간 카드를 하단 여정 시트로 통합한다. `KakaoMap`은 지도 중심 좌표와 자녀 오버레이 좌표를 분리해 머문 곳을 선택해도 자녀 마커가 실제 이력점에 남게 한다.

**Tech Stack:** React 19, TypeScript strict, Vite 7, 플레인 CSS 디자인 토큰, TanStack Query, Kakao Maps SDK, Node `node:test`.

---

## 전역 제약

- 활성 아이는 `useActiveChild()`와 `?child=<user_id>` 우선순위를 그대로 사용한다. `children[0]` 폴백을 추가하지 않는다.
- 위치 조회 엔타이틀먼트가 미확정·실패이면 캐시 경로와 좌표를 계속 숨긴다.
- 선택한 과거 시각보다 미래인 위치점은 절대 사용하지 않는다.
- `is_estimated` 점과 정확도 미달 점을 정확한 위치처럼 표현하지 않는다.
- 기존 시트 드래그 접기, 클릭 방지, 키보드 펼치기, `prefers-reduced-motion` 동작을 유지한다.
- 새 라이브러리나 API, DB 변경은 없다.

### Task 1: 특정 시각 위치 판정 순수 함수 추가

**Files:**

- Create: `src/transform/locationHistoryMoment.ts`
- Create: `tests/locationHistoryMoment.test.ts`

**Step 1: 실패하는 테스트 작성**

`tests/locationHistoryMoment.test.ts`에 다음 계약을 실제 타입으로 작성한다.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_RECORD_GAP_WARNING_MS,
  buildHistoryHourMarks,
  resolveHistoryMoment,
} from "../src/transform/locationHistoryMoment.ts";
import type { LocationHistoryPoint } from "../src/lib/api/endpoints/location.ts";
import type { StayPoint } from "../src/transform/stayPoints.ts";

const point = (
  recordedAt: string,
  accuracyM: number | null = 12,
  estimated: boolean | number = false,
): LocationHistoryPoint => ({
  user_id: "child-a",
  lat: 37.5,
  lng: 127,
  recorded_at: recordedAt,
  accuracy_m: accuracyM,
  is_estimated: estimated,
});

test("선택 시각보다 미래인 점은 사용하지 않고 직전 점을 고른다", () => {
  const result = resolveHistoryMoment([
    point("2026-07-21T09:59:00.000Z"),
    point("2026-07-21T10:01:00.000Z"),
  ], "child-a", Date.parse("2026-07-21T10:00:00.000Z"), []);
  assert.equal(result.recordedMs, Date.parse("2026-07-21T09:59:00.000Z"));
});

test("5분을 초과한 기록 공백을 명시한다", () => {
  const result = resolveHistoryMoment(
    [point("2026-07-21T09:54:59.999Z")],
    "child-a",
    Date.parse("2026-07-21T10:00:00.000Z"),
    [],
  );
  assert.equal(result.hasGap, true);
  assert.equal(result.gapMs, HISTORY_RECORD_GAP_WARNING_MS + 1);
});

test("추정점과 저정확도 점을 신뢰 가능한 위치와 구분한다", () => {
  assert.equal(resolveHistoryMoment(
    [point("2026-07-21T10:00:00.000Z", 10, true)],
    "child-a",
    Date.parse("2026-07-21T10:00:00.000Z"),
    [],
  ).evidence, "estimated");
  assert.equal(resolveHistoryMoment(
    [point("2026-07-21T10:00:00.000Z", 100, false)],
    "child-a",
    Date.parse("2026-07-21T10:00:00.000Z"),
    [],
  ).evidence, "low_accuracy");
});

test("공백 없는 신뢰 위치가 머문 구간 안이면 해당 인덱스를 반환한다", () => {
  const stays: StayPoint[] = [{
    lat: 37.5,
    lng: 127,
    arrivalMs: Date.parse("2026-07-21T09:00:00.000Z"),
    departureMs: Date.parse("2026-07-21T11:00:00.000Z"),
    dwellMs: 7_200_000,
    pointCount: 3,
  }];
  const result = resolveHistoryMoment(
    [point("2026-07-21T10:00:00.000Z")],
    "child-a",
    Date.parse("2026-07-21T10:00:00.000Z"),
    stays,
  );
  assert.equal(result.stayIndex, 0);
});

test("시간 바로가기 눈금은 범위 안의 정시만 만들고 오프셋을 분 단위로 준다", () => {
  const startMs = new Date(2026, 6, 21, 8, 0).getTime();
  const endMs = new Date(2026, 6, 21, 11, 25).getTime();
  assert.deepEqual(buildHistoryHourMarks(startMs, endMs), [
    { offsetMinute: 0, label: "08:00" },
    { offsetMinute: 60, label: "09:00" },
    { offsetMinute: 120, label: "10:00" },
    { offsetMinute: 180, label: "11:00" },
  ]);
});
```

**Step 2: 테스트가 모듈 부재로 실패하는지 확인**

Run: `node --test tests/locationHistoryMoment.test.ts`

Expected: `ERR_MODULE_NOT_FOUND`로 실패한다.

**Step 3: 최소 구현 작성**

`src/transform/locationHistoryMoment.ts`에 다음 공개 계약을 구현한다.

```ts
import type { LocationHistoryPoint } from "@/lib/api/endpoints/location";
import { isReliableLocationEvidence } from "./locationAccuracy";
import { parseServerTimestamp } from "./locationView";
import type { StayPoint } from "./stayPoints";

export const HISTORY_RECORD_GAP_WARNING_MS = 5 * 60_000;

export type HistoryMomentEvidence = "none" | "reliable" | "low_accuracy" | "estimated";

export interface HistoryMoment {
  point: LocationHistoryPoint | null;
  recordedMs: number | null;
  gapMs: number | null;
  hasGap: boolean;
  evidence: HistoryMomentEvidence;
  stayIndex: number | null;
}

export interface HistoryHourMark {
  offsetMinute: number;
  label: string;
}
```

구현 규칙은 다음과 같다.

- 선택 자녀, 유한 좌표, 파싱 가능한 `recorded_at`, `recordedMs <= selectedMs`인 행만 남긴다.
- 시간순 마지막 행을 선택한다. 행이 없으면 모든 nullable 필드를 `null`, `evidence: "none"`으로 반환한다.
- `is_estimated === true || is_estimated === 1`을 가장 먼저 `estimated`로 분류하고, 그 외는 `isReliableLocationEvidence`로 `reliable`/`low_accuracy`를 나눈다.
- `gapMs = Math.max(0, selectedMs - recordedMs)`, `hasGap = gapMs > HISTORY_RECORD_GAP_WARNING_MS`로 계산한다.
- `stayIndex`는 `evidence === "reliable"`, `!hasGap`, `arrivalMs <= selectedMs <= departureMs`를 모두 만족할 때만 반환한다.
- `buildHistoryHourMarks`는 로컬 시각 기준 시작 정시부터 종료 시각 이하의 매 정시를 만들고, `offsetMinute`는 시작으로부터 반올림 없는 정수 분으로 계산한다.

**Step 4: 단위 테스트 통과 확인**

Run: `node --test tests/locationHistoryMoment.test.ts`

Expected: 5개 테스트 PASS.

**Step 5: 커밋**

```powershell
git add src/transform/locationHistoryMoment.ts tests/locationHistoryMoment.test.ts
git commit -m "feat: 특정 시각 위치 판정 추가"
```

### Task 2: 지도 중심과 자녀 마커 좌표 분리

**Files:**

- Modify: `src/components/KakaoMap.tsx`
- Modify: `tests/mapPerf.test.ts`

**Step 1: 실패하는 소스 회귀 테스트 추가**

`tests/mapPerf.test.ts`에 다음 테스트를 추가한다.

```ts
test("KakaoMap 자녀 오버레이는 지도 중심이 아니라 자녀 좌표를 사용한다", () => {
  const map = read("src/components/KakaoMap.tsx");
  assert.match(map, /const childLatLng = new maps\.LatLng\(child\.lat, child\.lng\)/);
  assert.match(map, /position: childLatLng/);
  assert.doesNotMatch(map, /position: centerLatLng,[\s\S]{0,120}zIndex: 10/);
});
```

**Step 2: 테스트 실패 확인**

Run: `node --test tests/mapPerf.test.ts`

Expected: 새 테스트가 현재 `position: centerLatLng` 때문에 실패한다.

**Step 3: 최소 수정**

`KakaoMap.tsx`의 자녀 오버레이 블록 안에서만 다음 좌표를 만들고 사용한다.

```ts
const childLatLng = new maps.LatLng(child.lat, child.lng);
const overlay = new maps.CustomOverlay({
  position: childLatLng,
  content,
  yAnchor: 1,
  zIndex: 10,
});
```

지도 초기 중심·`setCenter`·머문 곳 중심 이동은 기존 `centerLatLng`을 그대로 사용한다.

**Step 4: 테스트 통과 확인**

Run: `node --test tests/mapPerf.test.ts`

Expected: 전체 PASS.

**Step 5: 커밋**

```powershell
git add src/components/KakaoMap.tsx tests/mapPerf.test.ts
git commit -m "fix: 지도 중심과 아이 위치 마커 분리"
```

### Task 3: 시간 선택을 오늘 경로 상태와 연결

**Files:**

- Modify: `src/screens/parent/ParentLocation.tsx`
- Modify: `tests/parentLocationUi.test.mjs`
- Modify: `tests/parentLocationSheetDrag.test.mjs`

**Step 1: 실패하는 UI 계약 테스트 추가**

다음 항목을 소스 회귀 테스트로 고정한다.

- `resolveHistoryMoment`, `buildHistoryHourMarks`를 import하고 원본 `visibleHistory`로 계산한다.
- range `step={1}`과 선택 시각을 포함한 `aria-label`을 사용한다.
- 시간 바로가기 버튼은 `setScrubOffsetMinute(mark.offsetMinute)`를 호출한다.
- 선택 시각 변경 시 수동 `selectedStayIdx`를 해제한다.
- `historyChildPoint`는 과거 조회 중 현재 `loc`으로 폴백하지 않는다.
- 시트는 `timedTrail.length > 0`이면 머문 곳이 0개여도 렌더된다.
- 기존 드래그·재열기 회귀는 계속 통과한다.

**Step 2: 기존 코드에서 실패 확인**

Run: `node --test tests/parentLocationUi.test.mjs tests/parentLocationSheetDrag.test.mjs`

Expected: 새 여정 시트·시각 판정 계약이 없어 FAIL.

**Step 3: 상태 계산을 순수 결과에 연결**

`ParentLocation.tsx`에서 다음 순서를 지킨다.

1. `stayPoints`를 계산한 뒤 `historyMoment = resolveHistoryMoment(visibleHistory, selected?.user_id ?? null, scrubMs, stayPoints)`를 계산한다.
2. `historyChildPoint`는 `historyMoment.point`의 좌표만 사용하며 `activeView === "history"`에서 현재 위치 `loc`으로 폴백하지 않는다.
3. 역지오코딩 후보는 `historyMoment.evidence === "reliable"`인 점 한 개만 `ChildLocation` 형태로 안전하게 변환한다. `updated_at`은 원래 `recorded_at`을 사용한다.
4. 표시 문구 우선순위는 다음과 같이 고정한다.
   - `stayIndex`가 있으면 일정 겹침/저장장소 기반 `stayLabels[stayIndex]`.
   - 신뢰 점이면 저장장소/역지오코딩 위치명.
   - 기록 공백이면 위치명 뒤에 `HH:MM 마지막 기록 · 이후 기록 없음`을 붙인다.
   - `estimated`면 `추정 구간이라 정확한 장소를 확인할 수 없어요`.
   - `low_accuracy`면 `위치 정확도가 낮아 정확한 장소를 확인할 수 없어요`.
   - `none`이면 `이 시각 이전 위치 기록이 없어요`.
5. 자동 활성 머문 곳은 `historyMoment.stayIndex`, 수동 선택은 `selectedStayIdx`가 우선한다.
6. 시간 range 또는 시간 칩을 조작하는 공통 handler는 `setSelectedStayIdx(null)` 후 전달받은 분 오프셋으로 `setScrubOffsetMinute(nextOffsetMinute)`를 호출한다.
7. 머문 곳을 선택하면 기존처럼 지도 중심을 이동하고, 해당 머문 곳의 `arrivalMs`를 분 오프셋으로 계산해 시간 선택도 그 구간 안으로 옮긴다.

**Step 4: 상태 연결 테스트 통과 확인**

Run: `node --test tests/locationHistoryMoment.test.ts tests/parentLocationUi.test.mjs tests/parentLocationSheetDrag.test.mjs tests/mapPerf.test.ts`

Expected: 전체 PASS.

**Step 5: 커밋**

```powershell
git add src/screens/parent/ParentLocation.tsx tests/parentLocationUi.test.mjs tests/parentLocationSheetDrag.test.mjs
git commit -m "feat: 오늘 경로 특정 시각 조회 연결"
```

### Task 4: 상단 시간 카드를 하단 여정 시트로 통합

**Files:**

- Modify: `src/screens/parent/ParentLocation.tsx`
- Modify: `src/screens/parent/ParentLocation.css`
- Modify: `tests/mobileViewportCss.test.mjs`
- Create: `tests/parentLocationJourneySheet.test.mjs`

**Step 1: 실패하는 구조·스타일 회귀 테스트 작성**

`tests/parentLocationJourneySheet.test.mjs`에서 다음 구조를 확인한다.

- `pl-scrub` 상단 독립 카드가 사라진다.
- `pl-journey` 시트 안에 `pl-journey__time`, `pl-journey__marks`, `pl-journey__result`, `pl-journey__timeline`이 이 순서로 존재한다.
- 제목은 `오늘의 여정`, 머문 곳 수는 `곳` 단위로 표시한다.
- 각 머문 곳은 `pl-journey-stop` 버튼이고 번호·세로 연결선·장소·도착–출발·체류 배지를 가진다.
- 기록 공백, 추정, 저정확도 설명 영역에 `role="status"`와 `aria-live="polite"`가 있다.
- 시간 range는 분 단위이며 시간 칩이 키보드 버튼으로 제공된다.

`tests/mobileViewportCss.test.mjs`의 기존 `.pl-scrub { top: 108px }` 기대는 삭제하고 다음을 확인한다.

- `.pl-stays { animation: none; }`와 접힘 transform은 유지한다.
- `.pl-journey__marks`는 가로 스크롤되고 scrollbar를 숨긴다.
- `.pl-journey__timeline`은 제한 높이와 세로 overflow를 갖는다.
- `.pl-journey-stop__rail::after`가 세로 연결선을 만든다.
- 360px 이하에서 시트 좌우 여백·내부 패딩·체류 배지가 겹치지 않도록 조정한다.
- `prefers-reduced-motion`에서 새 강조 애니메이션을 끈다.

**Step 2: 테스트 실패 확인**

Run: `node --test tests/parentLocationJourneySheet.test.mjs tests/mobileViewportCss.test.mjs`

Expected: 새 클래스가 없어 FAIL.

**Step 3: 여정 시트 마크업 구현**

`timedTrail.length > 0`인 오늘 경로 화면에서 기존 `pl-stays` 컨테이너를 유지하되 내부를 다음 순서로 교체한다.

1. 드래그 grip.
2. `오늘의 여정` 제목과 `visibleStayPoints.length/stayPoints.length곳` 카운트.
3. 선택 시각과 1분 단위 range.
4. `buildHistoryHourMarks(historyWindow.startMs, historyWindow.endMs)`의 시간 칩 가로 목록.
5. 선택 시각의 위치명과 기록 상태를 보여주는 결과 스트립.
6. 이동선·추정 구간·머문 곳·일정 범례.
7. `visibleStayPoints` 세로 타임라인 또는 `아직 8분 이상 머문 곳이 없어요` 빈 상태.

접힌 재열기 버튼 문구는 `오늘의 여정 · HH:MM`으로 바꾸고 현재 선택 시각을 계속 보이게 한다.

**Step 4: 플레인 CSS 정리**

기존 디자인 토큰을 사용해 다음을 적용한다.

- 흰 배경 한 장과 구분선 중심으로 정리하고 개별 보라색 카드 배경을 제거한다.
- 현재 시각 결과만 `var(--mint-soft)` 또는 기존 안전 색 토큰으로 강조한다.
- 선택된 stop은 번호·텍스트 색·얇은 배경만 바꾸고 크기 변화는 쓰지 않는다.
- 시간 칩은 최소 44px 높이 클릭 영역을 확보한다.
- 시트 최대 높이는 지도 조작 영역이 남도록 `min(58vh, 520px)` 범위에서 제한한다.
- 목록은 시트 내부만 스크롤하고 바깥 지도의 터치 동작을 막지 않는다.

**Step 5: 회귀 테스트 통과 확인**

Run: `node --test tests/locationHistoryMoment.test.ts tests/parentLocationUi.test.mjs tests/parentLocationSheetDrag.test.mjs tests/parentLocationJourneySheet.test.mjs tests/mobileViewportCss.test.mjs tests/mapPerf.test.ts`

Expected: 전체 PASS.

**Step 6: 타입·프로덕션 빌드 확인**

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run build`

Expected: `tsc -b`, Vite build, route bundle 검증 모두 exit 0.

**Step 7: 커밋**

```powershell
git add src/screens/parent/ParentLocation.tsx src/screens/parent/ParentLocation.css tests/mobileViewportCss.test.mjs tests/parentLocationJourneySheet.test.mjs
git commit -m "feat: 오늘 경로를 여정 시트로 통합"
```

### Task 5: 브라우저와 허용된 A17에서 동작 검증

**Files:**

- Modify after validation: `AGENTS.md`
- Modify after validation: `CLAUDE.md`

**Step 1: 브라우저 개발 서버 실행**

Run: `npm run dev -- --host 127.0.0.1 --port 5199 --strictPort`

Expected: `http://127.0.0.1:5199`에서 서버가 실행된다.

**Step 2: 브라우저 수동·자동 확인**

`playwright` 스킬을 읽고 다음을 검증한다.

- 부모 세션에서 `오늘 경로` 진입 시 상단 독립 시간 카드가 없고 하단 여정 시트 하나만 보인다.
- 360×800, 390×844, 430×932 뷰포트에서 가로 overflow가 없다.
- 시간 range와 시간 칩을 바꾸면 지도 선·아이 마커·선택 시각·위치명이 함께 바뀐다.
- 5분 초과 공백과 추정/저정확도 fixture는 정확한 현재 위치처럼 표시되지 않는다.
- 머문 곳 선택은 지도만 해당 장소로 센터링하고 아이 마커는 실제 이력 좌표에 남는다.
- 시트 드래그 접기, 재열기, 키보드 Enter/Space가 동작한다.
- 콘솔 error와 uncaught exception이 없다.

**Step 3: Android 빌드와 A17 설치**

```powershell
npm run build
npx cap sync android
Set-Location C:\Users\TK\Desktop\hyeni-3\android
.\gradlew.bat lintDebug assembleDebug
Set-Location C:\Users\TK\Desktop\hyeni-3
adb -s RFKL40DP73J install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Expected: lint/build/install 모두 성공하고 A17 앱 데이터와 부모 세션이 유지된다. 다른 serial에는 어떤 adb 명령도 실행하지 않는다.

**Step 4: A17에서 부모 화면 확인**

- 로그아웃·역할 변경·재페어링 없이 기존 부모 세션으로 확인한다.
- `오늘 경로`에서 시간 선택, 머문 곳 선택, 접기/펼치기, 지도 이동을 확인한다.
- 상태바·하단 내비게이션·시트가 겹치지 않고 지도 조작 영역이 남는지 확인한다.
- A17에서만 필요한 최소 로그를 보되 access/refresh token을 출력하지 않는다.

**Step 5: 정본 문서 동기화**

`AGENTS.md`와 `CLAUDE.md`에 다음 운영 규칙을 같은 의미로 기록한다.

- 오늘 경로는 오전 8시 시작의 단일 여정 시트다.
- 특정 시각 조회는 미래점을 쓰지 않고 직전 기록을 사용한다.
- 5분 초과 공백·추정·저정확도는 명시한다.
- 지도 중심과 아이 마커 좌표는 독립이다.

Run: `rg -n "단일 여정 시트|미래점을|5분 초과|지도 중심" AGENTS.md CLAUDE.md`

Expected: 두 문서 모두 네 계약을 포함한다.

**Step 6: 최종 회귀와 커밋**

Run: `node --test tests/*.test.*`

Expected: 전체 PASS.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run build`

Expected: exit 0.

```powershell
git add AGENTS.md CLAUDE.md
git commit -m "docs: 오늘 경로 여정 시트 정본 동기화"
git status --short
```

Expected: status가 비어 있다.

### Task 6: 웹 배포와 원격 확인

**Files:**

- Verify only: `dist/`

**Step 1: 원격 저장소에 push**

Run: `git push origin main`

Expected: 모든 UI·테스트·문서 커밋이 `origin/main`에 올라간다.

**Step 2: `.env` 없는 디렉터리에서 Pages 배포**

```powershell
New-Item -ItemType Directory -Force -Path C:\Users\TK\AppData\Local\Temp\hyeni-pages-deploy-20260721 | Out-Null
Set-Location C:\Users\TK\AppData\Local\Temp\hyeni-pages-deploy-20260721
npx wrangler pages deploy C:\Users\TK\Desktop\hyeni-3\dist --project-name=hyeni-calendar --branch=main --commit-dirty=true
Set-Location C:\Users\TK\Desktop\hyeni-3
```

Expected: Pages deployment URL이 출력되고 배포 성공.

**Step 3: 프로덕션 스모크 확인**

`https://hyeni-calendar.pages.dev`에서 새 asset이 제공되는지 확인하고, 부모 세션을 파괴하지 않는 범위에서 오늘 경로 화면·콘솔 오류·가로 overflow를 다시 확인한다.
