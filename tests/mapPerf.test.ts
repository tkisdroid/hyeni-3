import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("지도 SDK 호스트는 실제 지도 진입 전에는 연결하지 않는다", () => {
  const html = read("index.html");
  for (const host of ["dapi.kakao.com", "maps.googleapis.com", "maps.gstatic.com"]) {
    assert.doesNotMatch(html, new RegExp(`rel=["']preconnect["'][^>]+${host.replaceAll(".", "\\.")}`));
  }
});

test("지도 공급자 SDK는 FamilyMap 선택 뒤에만 동적 로드한다", () => {
  const shell = read("src/app/AppShell.tsx");
  const parentHome = read("src/screens/parent/ParentHome.tsx");
  assert.doesNotMatch(shell, /warmKakaoMaps|loadKakaoMaps|loadGoogleMaps/);
  assert.doesNotMatch(parentHome, /warmKakaoMaps|loadKakaoMaps|loadGoogleMaps/);

  const familyMap = read("src/maps/FamilyMap.tsx");
  assert.match(familyMap, /lazy\(\(\) => import\("\.\/providers\/kakao\/KakaoMapAdapter"\)/);
  assert.match(familyMap, /lazy\(\(\) => import\("\.\/providers\/google\/GoogleMapAdapter"\)/);
  assert.match(familyMap, /policy\.provider === "kakao"/);
});

test("Kakao SDK 초기화가 한 번 실패해도 다음 사용자 시도에서 다시 불러올 수 있다", () => {
  const loader = read("src/maps/providers/kakao/loadKakaoMaps.ts");
  assert.match(loader, /retryKakaoMapLoad/);
  assert.match(loader, /\.catch\(\(error: unknown\) => \{/);
  assert.match(loader, /loadPromise = null;\s*throw error;/s);

  const map = read("src/maps/providers/kakao/KakaoMapAdapter.tsx");
  const koShared = JSON.parse(read("locales/ko/shared.json"));
  assert.match(map, /const \[retryKey, setRetryKey\] = useState\(0\)/);
  assert.match(map, /setRetryKey\(\(value\) => value \+ 1\)/);
  assert.match(map, /shared\.kakaoMap\.copy005/);
  assert.match(map, /shared\.kakaoMap\.copy004/);
  assert.equal(koShared["shared.kakaoMap.copy005"], "지도 다시 불러오기");
  assert.equal(koShared["shared.kakaoMap.copy004"], "인터넷 연결을 확인한 뒤 다시 시도해 주세요");
});

test("지도가 그려지기 전에는 흰 사각형 대신 자리표시자를 보여준다", () => {
  const map = read("src/maps/providers/kakao/KakaoMapAdapter.tsx");
  assert.match(map, /const \[ready, setReady\] = useState\(false\)/);
  assert.match(map, /setReady\(true\)/);
  assert.match(map, /\{!ready && \(/);
  assert.match(map, /className="km-skeleton"/);

  // 자리표시자는 지도 바탕색 위에 위치 로딩 마크 하나만 둔다(반짝임과 겹치면 표시자가 둘이 된다).
  assert.match(map, /<LoaderMark variant="location" \/>/);
  assert.doesNotMatch(map, /km-skeleton__shimmer/);

  const css = read("src/styles/components.css");
  assert.match(css, /\.km-skeleton\s*\{/);
  // 작은 썸네일 지도에서도 마크가 넘치지 않게 폭을 컨테이너 비율로 잡는다.
  assert.match(css, /\.km-skeleton\s*\{[^}]*--loader-mark-size:\s*clamp\(/s);
  // 움직임 줄이기 처리는 로딩 마크가 <picture> 정지 프레임으로 담당한다
  // (가드=tests/progressIndicatorContract.test.mjs).
  assert.match(read("src/components/ui/LoaderMark.tsx"), /media="\(prefers-reduced-motion: reduce\)"/);
});

test("길찾기 화면은 경로 API 를 기다리지 않고 지도를 먼저 그린다", () => {
  const rv = read("src/screens/feature/RouteView.tsx");
  // 출발·도착만 알면 즉시 지도. 폴리라인은 도착하면 얹는다.
  assert.match(rv, /\{originChild && destMarker \? \(/);
  assert.match(rv, /route=\{routeState === "ready" \? routePoints : \[\]\}/);
  // 경로를 찾는 동안은 지도 위 칩으로 알린다(흰 화면 금지).
  assert.match(rv, /routeState === "loading" && \(\s*<span className="rv-map-chip">/);
  assert.match(rv, /routeState === "error" && \(/);
  // 지도 위 폴리라인은 실 도보 경로일 때만 그린다(좌표 두 개를 이어 가짜 경로를 그리지 않는다).
  assert.ok(!/route=\{\[/.test(rv), "가짜 직선 폴리라인 금지");
  // 경로 API 가 죽으면 지도가 아니라 텍스트로만 "직선 …쯤"이라고 정직하게 강등한다.
  assert.match(rv, /직선 \$\{distanceLabel\(straight\.distanceM\)\}/);
  assert.match(rv, /\{ id: "shared\.routeView\.straightEstimate" \}/);
});

test("Kakao 지도 어댑터는 인라인 style 로 position 을 덮어쓰지 않는다(소비 화면 배치 파괴 금지)", () => {
  // 실기기 회귀: 래퍼에 인라인 position:relative 를 주자 .pl-map(absolute; inset:0)이 무력화돼
  // 부모 위치 화면의 지도가 크기 0 이 되어 아예 보이지 않았다.
  const map = read("src/maps/providers/kakao/KakaoMapAdapter.tsx");
  assert.ok(!/style=\{\{\s*position:/.test(map), "인라인 position 금지");
  assert.match(map, /className=\{`\$\{className\} km-host`\}/);
  assert.match(map, /<div ref=\{ref\} className="km-canvas" \/>/);

  const css = read("src/styles/components.css");
  assert.match(css, /\.km-host\s*\{\s*position: relative;\s*\}/);
  assert.match(css, /\.km-canvas\s*\{[^}]*position: absolute;[^}]*inset: 0;/s);
});
