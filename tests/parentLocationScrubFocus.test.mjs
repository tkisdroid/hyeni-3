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
const journey = read("src/screens/parent/LocationJourneyPanel.tsx");

test("이동 이력은 플로팅 카드와 시간 막대 없이 지도 아래 시간·장소 목록을 사용한다", () => {
  assert.match(screen, /pl-root\$\{activeView === "history" \? " pl-root--history" : ""\}/);
  assert.match(screen, /<LocationJourneyPanel/);
  assert.match(journey, /className="pl-visited"/);
  assert.match(journey, /<time>\{stay\.timeLabel\}<\/time>/);
  assert.match(journey, /<strong>\{stay\.placeLabel\}<\/strong>/);
  assert.doesNotMatch(journey, /type="range"|pl-journey__replay|pl-journey__toggle/);
  assert.match(css, /\.pl-root--history \.pl-map\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.pl-visited\s*\{[^}]*position:\s*relative/s);
});

test("다녀온 곳을 누르면 해당 장소를 지도 중심으로 보여준다", () => {
  assert.match(screen, /const \[selectedStayIdx, setSelectedStayIdx\] = useState<number \| null>\(null\)/);
  assert.match(screen, /const stayCenter = manuallySelectedStayIdx != null/);
  assert.match(screen, /center=\{historyCenter\}/);
  assert.match(screen, /onSelectStay=\{\(index\) => setSelectedStayIdx\(activeStayIdx === index \? null : index\)\}/);
});

test("선택한 날짜의 경로 조회 범위는 하루 창으로 고정하고 신선도는 배경 폴링으로 유지한다", () => {
  assert.match(screen, /end: historyWindow\.queryEnd\.toISOString\(\)/);
  assert.match(screen, /useLocationHistory\(historyRange\.start, historyRange\.end, historyEnabled, 60_000\)/);
  assert.match(queries, /refetchIntervalMs\?: number/);
  assert.match(queries, /refetchInterval: refetchIntervalMs && refetchIntervalMs > 0 \? refetchIntervalMs : undefined/);
});

test("등록 사진은 위치 칩과 상세 영역을 가득 채우고 네 액션은 3D 아이콘을 쓴다", () => {
  assert.match(screen, /data-photo=\{isUploadedPhoto\(selected\.photo_url\)\}/);
  assert.match(screen, /data-photo=\{isUploadedPhoto\(selected\?\.photo_url\)\}/);
  assert.match(css, /\.pl-sheet__avatar\[data-photo="true"\] img\s*\{\s*object-fit: cover/s);
  assert.match(screen, /ui\/chat-heart\.webp/);
  assert.match(screen, /ui\/clay\/location\.webp/);
  assert.match(screen, /ui\/clay\/remote-audio\.webp/);
  assert.match(screen, /ui\/phone-lavender\.webp/);
});

test("KakaoMap 은 명시적 center 를 bounds 로 덮지 않고 자녀 마커를 실제 좌표에 그린다", () => {
  assert.match(map, /if \(!center && route && route\.length >= 2\)/);
  assert.match(map, /\} else if \(!center && stays && stays\.length > 0\)/);
  assert.match(map, /position: new maps\.LatLng\(child\.lat, child\.lng\)/);
  assert.match(map, /getMapFocusPanOffset\(fitPadding\)/);
  assert.match(map, /mapRef\.current\.panBy\(focusPan\.x, focusPan\.y\)/);
  assert.match(map, /className = "km-child-marker__time"/);
  assert.match(map, /zIndex: child\.caption \? 40 : 10/);
  // 포커스 확대는 더 넓게 보고 있을 때만(사용자 확대 존중).
  assert.match(map, /if \(mapRef\.current\.getLevel\(\) > centerLevel\) mapRef\.current\.setLevel\(centerLevel\)/);
});

test("다녀온 곳 목록은 44px보다 큰 행과 단순 구분선을 제공한다", () => {
  assert.match(css, /\.pl-visited__row\s*\{[^}]*min-height: 68px/s);
  assert.match(css, /\.pl-visited__list li \+ li\s*\{[^}]*border-top:/s);
});
