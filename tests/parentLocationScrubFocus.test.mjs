import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

const screen = read("src/screens/parent/ParentLocation.tsx");
const css = read("src/screens/parent/ParentLocation.css");
const map = read("src/components/KakaoMap.tsx");
const queries = read("src/queries/useLocation.ts");

test("시간대별 경로를 움직이면 패널을 유지하고 그 시각 위치를 지도 중심으로 잡는다", () => {
  const move = screen.slice(screen.indexOf("const moveScrubTo"), screen.indexOf("const followLatestAgain"));
  assert.match(move, /setScrubOffsetMinute\(clampHistoryOffsetMinute\(rawValue, historyMaxOffsetMinute\)\)/);
  assert.match(move, /setSelectedStayIdx\(null\)/);
  assert.doesNotMatch(move, /setHistoryPanelExpanded\(false\)/);
  assert.match(move, /setScrubFocusKey\(\(key\) => key \+ 1\)/);

  assert.match(screen, /onSliderChange=\{moveScrubTo\}/);
  assert.match(screen, /resolveHistoryMapCenter\(\{ followsLatest, stayCenter, scrubChildPoint \}\)/);
  assert.match(screen, /center=\{historyCenter\}/);
  assert.match(screen, /centerLevel=\{HISTORY_FOCUS_MAP_LEVEL\}/);
  assert.match(screen, /recenterKey=\{scrubFocusKey\}/);
});

test("최신 따라가기 상태에서는 지도 중심을 비워 하루 경로 전체를 보여준다", () => {
  assert.match(screen, /const followsLatest = scrubOffsetMinute == null;/);
  assert.match(screen, /onFollowLatest=\{followLatestAgain\}/);
});

test("30초 위치 폴링이 부모가 고른 시각과 접어 둔 시트를 되돌리지 않는다", () => {
  // 슬라이더 값: null = 최신 따라가기. 폴링으로 now 가 바뀌어도 선택 시각을 유지한다.
  assert.match(screen, /useState<number \| null>\(null\)/);
  assert.doesNotMatch(screen, /if \(activeView === "history"\) setScrubOffsetMinute\(historyMaxOffsetMinute\)/);
  assert.match(screen, /setScrubOffsetMinute\(null\);\s*\}, \[activeView, historyDayKey, selected\?\.id\]\)/s);
  // 패널 자동 펼침은 보기 전환에서만(머문 곳 수 변화로 다시 펼치지 않는다).
  assert.match(screen, /setHistoryPanelExpanded\(true\);\s*\}, \[activeView, historyDayKey, selected\?\.id\]\)/s);
  assert.doesNotMatch(screen, /\[activeView, stayPoints\.length\]/);
});

test("선택한 날짜의 경로 조회 범위는 하루 창으로 고정하고 신선도는 배경 폴링으로 유지한다", () => {
  assert.match(screen, /end: historyWindow\.queryEnd\.toISOString\(\)/);
  assert.match(screen, /useLocationHistory\(historyRange\.start, historyRange\.end, historyEnabled, 60_000\)/);
  assert.match(queries, /refetchIntervalMs\?: number/);
  assert.match(queries, /refetchInterval: refetchIntervalMs && refetchIntervalMs > 0 \? refetchIntervalMs : undefined/);
});

test("고른 시각에 아이가 어디였는지 화면과 접근성 이름에 함께 알린다", () => {
  assert.match(screen, /const scrubWhere = resolveScrubWhereLabel\(\{/);
  assert.match(screen, /lastPointMs: scrubChildPoint\?\.ms \?\? null/);
  assert.match(screen, /currentWhere=\{scrubWhere\}/);
  assert.match(screen, /currentTimeLabel=\{formatClockHM\(scrubMs\)\}/);
});

test("KakaoMap 은 명시적 center 를 bounds 로 덮지 않고 자녀 마커를 실제 좌표에 그린다", () => {
  assert.match(map, /if \(!center && route && route\.length >= 2\)/);
  assert.match(map, /\} else if \(!center && stays && stays\.length > 0\)/);
  assert.match(map, /position: new maps\.LatLng\(child\.lat, child\.lng\)/);
  // 포커스 확대는 더 넓게 보고 있을 때만(사용자 확대 존중).
  assert.match(map, /if \(mapRef\.current\.getLevel\(\) > centerLevel\) mapRef\.current\.setLevel\(centerLevel\)/);
});

test("오늘 경로 패널은 명시적 토글과 타임라인 간격을 제공한다", () => {
  assert.match(css, /\.pl-journey__toggle\s*\{[^}]*min-height: var\(--control-min-size\)/s);
  assert.match(css, /\.pl-journey__timeline\s*\{[^}]*gap: 8px/s);
  assert.match(css, /\.pl-journey__stay\s*\{[^}]*min-height: var\(--control-min-size\)/s);
  assert.doesNotMatch(css, /\.pl-stays--collapsed/);
});
