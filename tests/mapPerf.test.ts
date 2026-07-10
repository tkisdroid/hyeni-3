import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("지도 호스트에 미리 연결한다(첫 진입 DNS+TLS 비용 제거)", () => {
  const html = read("index.html");
  for (const host of ["https://dapi.kakao.com", "https://t1.daumcdn.net", "https://mts.daumcdn.net"]) {
    assert.ok(html.includes(`rel="preconnect" href="${host}"`), `${host} preconnect 누락`);
  }
});

test("Kakao SDK 는 앱이 한가할 때 미리 받아 둔다", () => {
  const loader = read("src/lib/kakaoMap.ts");
  assert.match(loader, /export function warmKakaoMaps/);
  assert.match(loader, /requestIdleCallback/);
  // 이미 로드됐거나 로드 중이면 다시 받지 않는다.
  assert.match(loader, /if \(window\.kakao\?\.maps \|\| loadPromise\) return/);

  const shell = read("src/app/AppShell.tsx");
  assert.match(shell, /function useWarmKakaoMaps/);
  const parent = shell.slice(shell.indexOf("export function ParentShell"), shell.indexOf("export function ChildShell"));
  assert.match(parent, /useWarmKakaoMaps\(\)/);
  assert.match(shell.slice(shell.indexOf("export function ChildShell")), /useWarmKakaoMaps\(\)/);
});

test("지도가 그려지기 전에는 흰 사각형 대신 자리표시자를 보여준다", () => {
  const map = read("src/components/KakaoMap.tsx");
  assert.match(map, /const \[ready, setReady\] = useState\(false\)/);
  assert.match(map, /setReady\(true\)/);
  assert.match(map, /\{!ready && \(/);
  assert.match(map, /className="km-skeleton"/);

  const css = read("src/styles/components.css");
  assert.match(css, /\.km-skeleton\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,160}\.km-skeleton__shimmer[\s\S]{0,60}animation: none/);
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
  assert.match(rv, /직선 \$\{distanceLabel\(straightM\)\}/);
});
